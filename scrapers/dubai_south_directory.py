#!/usr/bin/env python3
"""Deterministic scraper for the public Dubai South company directory.

Reproduces the site's Salesforce Visualforce / RichFaces pagination protocol
over plain HTTP requests (no browser automation): GET the directory, then
repeatedly POST the "Next >" control with the ViewState carried forward from
the most recently received response.

The site exposes no direct "jump to page N" request -- the only proven way
forward is the sequential Next chain -- so --resume still walks every page
from 1 onward on each run. It skips re-writing pages already present in the
output file rather than re-fetching the whole directory from scratch after a
crash, which keeps a resumed run from losing or duplicating data even though
it can't skip the network calls themselves.

Usage:
    python3 dubai_south_directory.py
    python3 dubai_south_directory.py --resume
    python3 dubai_south_directory.py --limit 5 --debug --verbose
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import random
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

URL = "https://dubaisouth.my.salesforce-sites.com/CompanyDirectory"

VIEWSTATE_FIELDS = (
    "com.salesforce.visualforce.ViewState",
    "com.salesforce.visualforce.ViewStateVersion",
    "com.salesforce.visualforce.ViewStateMAC",
)

SENSITIVE_KEYS = {
    "com.salesforce.visualforce.ViewState",
    "com.salesforce.visualforce.ViewStateMAC",
}

CSV_FIELDS = [
    "page",
    "operating_name",
    "license_number",
    "legal_type",
    "address",
    "activities",
    "managers",
    "license_issue_date",
    "license_expiry_date",
]

log = logging.getLogger("dubai_south_scraper")


class PaginationError(RuntimeError):
    """Raised when a response doesn't match the reverse-engineered protocol."""


@dataclass
class ScraperConfig:
    output_file: Path = Path("dubai_south_companies.csv")
    state_file: Path = Path("dubai_south_scraper_state.json")
    debug_dir: Optional[Path] = None
    delay_seconds: float = 1.5
    jitter_seconds: float = 0.5
    max_attempts: int = 3
    retry_backoff: float = 2.0
    request_timeout: int = 30
    limit_pages: Optional[int] = None
    resume: bool = False


def redact_payload(payload: dict) -> dict:
    """Copy of a request payload safe to print or log."""
    return {k: ("<redacted>" if k in SENSITIVE_KEYS else v) for k, v in payload.items()}


def redact_html(html: str) -> str:
    """Copy of a response body safe to persist for debugging."""
    soup = BeautifulSoup(html, "lxml")
    for key in SENSITIVE_KEYS:
        for element in soup.find_all("input", {"name": key}):
            element["value"] = "<redacted>"
    return str(soup)


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )
    })
    retry = Retry(
        total=3,
        connect=3,
        read=3,
        status=3,
        backoff_factor=1.0,
        status_forcelist=(500, 502, 503, 504),
        allowed_methods=("GET", "POST"),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def parse_page_info(html: str) -> tuple[Optional[int], Optional[int]]:
    match = re.search(r"Displaying\s*-\s*Page\s*(\d+)\s*of\s*(\d+)", html, re.IGNORECASE)
    if not match:
        return None, None
    return int(match.group(1)), int(match.group(2))


def extract_state(soup: BeautifulSoup) -> dict:
    state = {}
    for field_name in VIEWSTATE_FIELDS:
        element = soup.find("input", {"name": field_name})
        if element is None:
            raise PaginationError(f"Missing required state field: {field_name}")
        state[field_name] = element.get("value", "")
    return state


def extract_next_button(soup: BeautifulSoup) -> Optional[dict]:
    button = soup.find("input", {"type": "submit", "value": "Next >"})
    if button is None:
        return None
    return {"name": button.get("name"), "value": button.get("value")}


def parse_companies(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    companies = []
    data_columns = len(CSV_FIELDS) - 1  # exclude the "page" column we add ourselves
    for row in soup.find_all("tr"):
        cells = row.find_all(["td", "th"], recursive=False)
        if len(cells) != data_columns:
            continue
        values = [cell.get_text(" ", strip=True) for cell in cells]
        if values[0] in ("", "Operating Name"):
            continue
        companies.append({
            "operating_name": values[0],
            "license_number": values[1],
            "legal_type": values[2],
            "address": values[3],
            "activities": values[4],
            "managers": values[5],
            "license_issue_date": values[6],
            "license_expiry_date": values[7],
        })
    return companies


class DubaiSouthScraper:
    def __init__(self, config: ScraperConfig):
        self.config = config
        self.session = build_session()
        self.seen_license_numbers: set[str] = set()
        self.last_completed_page = 0

    def _debug_dump(self, label: str, html: str) -> None:
        if not self.config.debug_dir:
            return
        self.config.debug_dir.mkdir(parents=True, exist_ok=True)
        (self.config.debug_dir / f"{label}.html").write_text(redact_html(html), encoding="utf-8")

    def _sleep(self) -> None:
        time.sleep(self.config.delay_seconds + random.uniform(0, self.config.jitter_seconds))

    def _load_resume_state(self) -> None:
        if not self.config.resume or not self.config.state_file.exists():
            if self.config.resume:
                log.info("No state file at %s; starting fresh.", self.config.state_file)
            return
        state = json.loads(self.config.state_file.read_text(encoding="utf-8"))
        self.last_completed_page = state.get("last_completed_page", 0)
        self.seen_license_numbers = set(state.get("license_numbers_seen", []))
        log.info(
            "Resuming: last completed page %d, %d license numbers already recorded.",
            self.last_completed_page,
            len(self.seen_license_numbers),
        )

    def _save_checkpoint(self, page: int) -> None:
        self.last_completed_page = page
        self.config.state_file.write_text(
            json.dumps({
                "last_completed_page": page,
                "license_numbers_seen": sorted(self.seen_license_numbers),
            }),
            encoding="utf-8",
        )

    def _ensure_output_file(self) -> None:
        if self.config.resume and self.config.output_file.exists():
            return
        with self.config.output_file.open("w", newline="", encoding="utf-8") as f:
            csv.DictWriter(f, fieldnames=CSV_FIELDS).writeheader()

    def _write_rows(self, page: int, companies: list[dict]) -> int:
        new_rows = 0
        with self.config.output_file.open("a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
            for company in companies:
                license_number = company["license_number"]
                if license_number in self.seen_license_numbers:
                    log.warning("Duplicate license number %s on page %d; skipping row.", license_number, page)
                    continue
                self.seen_license_numbers.add(license_number)
                writer.writerow({"page": page, **company})
                new_rows += 1
        return new_rows

    def _fetch_next_page(self, state: dict, next_button: dict, expected_page: int) -> requests.Response:
        payload = {
            "j_id0:j_id1": "j_id0:j_id1",
            "j_id0:j_id1:out:j_id8:j_id9:j_id11": "Company",
            "j_id0:j_id1:out:j_id8:j_id15:j_id18": "",
            next_button["name"]: next_button["value"],
            **state,
        }
        attempt = 0
        while True:
            attempt += 1
            log.debug("POST %s (attempt %d) payload=%s", URL, attempt, redact_payload(payload))
            response = self.session.post(
                URL,
                data=payload,
                headers={
                    "Referer": URL,
                    "Origin": "https://dubaisouth.my.salesforce-sites.com",
                    "X-Requested-With": "XMLHttpRequest",
                },
                timeout=self.config.request_timeout,
            )
            response.raise_for_status()
            page, _ = parse_page_info(response.text)
            if page == expected_page:
                return response
            if attempt >= self.config.max_attempts:
                raise PaginationError(
                    f"Expected page {expected_page} after Next, got {page!r} "
                    f"after {attempt} attempt(s)."
                )
            backoff = self.config.retry_backoff ** attempt
            log.warning(
                "Pagination mismatch (expected %d, got %r); retrying in %.1fs (attempt %d/%d).",
                expected_page, page, backoff, attempt, self.config.max_attempts,
            )
            time.sleep(backoff)

    def run(self) -> None:
        self._load_resume_state()
        self._ensure_output_file()

        log.info("Requesting initial directory page...")
        response = self.session.get(URL, timeout=self.config.request_timeout)
        response.raise_for_status()
        html = response.text
        self._debug_dump("page_0001", html)

        page, total_pages = parse_page_info(html)
        if page is None:
            raise PaginationError("Could not determine page count from the initial GET.")
        log.info("Directory has %d pages (%d already recorded).", total_pages, self.last_completed_page)

        total_new_rows = 0
        while True:
            soup = BeautifulSoup(html, "lxml")
            page, total_pages = parse_page_info(html)
            if page is None:
                raise PaginationError("Could not determine the current page number.")

            stop_at = total_pages if self.config.limit_pages is None else min(total_pages, self.config.limit_pages)

            if page > self.last_completed_page:
                companies = parse_companies(html)
                new_rows = self._write_rows(page, companies)
                total_new_rows += new_rows
                self._save_checkpoint(page)
                log.info("Page %d/%d -> %d companies (%d new).", page, total_pages, len(companies), new_rows)
            else:
                log.info("Page %d/%d already recorded; fast-forwarding.", page, total_pages)

            if page >= stop_at:
                break

            state = extract_state(soup)
            next_button = extract_next_button(soup)
            if next_button is None:
                raise PaginationError(f"Next button missing on page {page}; cannot continue.")

            self._sleep()
            next_response = self._fetch_next_page(state, next_button, page + 1)
            html = next_response.text
            self._debug_dump(f"page_{page + 1:04d}", html)

        log.info(
            "Done. %d new row(s) written this run. Total rows recorded: %d. Output: %s",
            total_new_rows, len(self.seen_license_numbers), self.config.output_file,
        )


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Deterministic scraper for the Dubai South company directory.")
    parser.add_argument("--output", type=Path, default=Path("dubai_south_companies.csv"), help="CSV output path.")
    parser.add_argument("--state-file", type=Path, default=Path("dubai_south_scraper_state.json"), help="Checkpoint file path.")
    parser.add_argument("--resume", action="store_true", help="Resume from the last checkpoint instead of starting over.")
    parser.add_argument("--limit", type=int, default=None, help="Stop after this many pages (for testing).")
    parser.add_argument("--delay", type=float, default=1.5, help="Base delay between requests, in seconds.")
    parser.add_argument("--debug", action="store_true", help="Save each response's HTML (ViewState redacted) under ./debug_pages/.")
    parser.add_argument("--verbose", action="store_true", help="Enable debug-level logging.")
    return parser


def main() -> None:
    args = build_arg_parser().parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    config = ScraperConfig(
        output_file=args.output,
        state_file=args.state_file,
        debug_dir=Path("debug_pages") if args.debug else None,
        delay_seconds=args.delay,
        limit_pages=args.limit,
        resume=args.resume,
    )

    scraper = DubaiSouthScraper(config)
    try:
        scraper.run()
    except KeyboardInterrupt:
        log.warning(
            "Interrupted. Progress through page %d is saved; re-run with --resume to continue.",
            scraper.last_completed_page,
        )
        raise SystemExit(130)
    except (PaginationError, requests.exceptions.RequestException) as exc:
        log.error("Scrape failed: %s", exc)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
