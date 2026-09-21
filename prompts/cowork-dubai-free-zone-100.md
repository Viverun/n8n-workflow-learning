# Cowork prompt — fill the sheet with 100 Dubai Free Zone companies

Paste everything below the line into Claude Cowork. It needs the Google Sheets
connector enabled and web search available.

---

Research Dubai Free Zone companies and add 100 new rows to my Google Sheet.

**Sheet:** https://docs.google.com/spreadsheets/d/137eRLDfGQGix-DeDY768ydDJycjUTgRNQzxDu0G70eA/edit
**Tab:** `Companies`
**Columns, in this exact order:** company_name, website, email, industry, free_zone, point_of_contact, contact_number

## Before you start

Read the rows already in the tab. Those companies are done — do not research or
re-add any of them. Match on the email domain, not the company name, because the
same company shows up under different spellings and casings.

## What counts as a target

A company registered, licensed, or operating in one of these **Dubai** free zones,
operating in one of the sectors paired with it. Work the pairs in a mixed order so
the result is not 30 rows of one zone:

| Free zone | Sectors to look for |
|---|---|
| DMCC - Dubai Multi Commodities Centre | Retail, E-commerce, Food and Beverage, Logistics and Freight |
| JAFZA - Jebel Ali Free Zone | Logistics and Freight, Retail, E-commerce, Food and Beverage |
| DAFZA - Dubai Airport Free Zone | Logistics and Freight, E-commerce |
| Dubai South | Logistics and Freight, E-commerce, Hospitality and Travel |
| Dubai Internet City | Technology and Software, E-commerce |
| Dubai Media City | Marketing and Advertising, Technology and Software |
| Dubai Silicon Oasis | Technology and Software, E-commerce |
| IFZA - International Free Zone Authority | Marketing and Advertising, E-commerce, Technology and Software, Hospitality and Travel, Food and Beverage, Retail |
| Meydan Free Zone | Marketing and Advertising, E-commerce, Technology and Software, Hospitality and Travel |

These pairings are deliberate. Do not ask a zone for a sector not listed next to it —
DIFC and Dubai Healthcare City are excluded entirely because they host finance and
healthcare, not these sectors.

## Hard scope rules

- Dubai only. Reject Abu Dhabi, Sharjah, Ajman, Ras Al Khaimah, Fujairah, Umm Al
  Quwain, any other emirate, any other country.
- Free zone only. Reject Dubai mainland companies licensed by the DED.
- A genuine free zone entity carries a free zone legal suffix in its registered
  name: **FZCO, FZE, FZ-LLC, FZ LLC, DMCC, DWC-LLC, Limited**. A name ending in
  plain **LLC** or **L.L.C.** is a mainland company — reject it.
- Exclude company formation agents, business setup consultancies, corporate
  services providers, PRO service firms, and accounting or audit practices. They
  dominate search results for free zone terms and are not what this list is for.
- Verify the free zone claim against the company's own website or the free zone's
  member directory. If you cannot verify it, skip the company.

## The seven fields

- **company_name** — full official registered name including the legal suffix.
- **website** — official company website, full URL with https://. Not a directory
  listing, not LinkedIn, not an aggregator profile. No website, no row.
- **email** — a publicly listed business email. Prefer HR, recruitment, careers or
  hiring addresses; otherwise a general business address. **A row without a real
  email does not go in the sheet.**
- **industry** — the primary business activity.
- **free_zone** — the zone name exactly as written in the table above.
- **point_of_contact** — a publicly listed person, formatted `Name, Role`. Prefer
  HR / Recruitment / Talent Acquisition / Hiring; then Founder, CEO, Director,
  Manager; then any named contact.
- **contact_number** — a **UAE** number starting `+971`, in international format.
  A landline is `+971 4` plus 7 digits, a mobile `+971 5X` plus 7 digits, a
  toll-free `800` plus 4–7 digits. A foreign number is the wrong number even when
  it is printed on the site — write `Not Found` instead. Optional: `Not Found` is
  fine here and the row still goes in.

## The rule that matters most

**Never invent, guess, infer, or construct a value.** Every value must have been
read from a page you actually opened.

- You are forbidden from building an email from a domain pattern. If the domain is
  `example.ae`, do **not** write `info@example.ae` or `hr@example.ae` unless you
  saw that exact address published on a real page.
- You are forbidden from guessing a phone number from a country or area code.
- You are forbidden from naming a person whose connection to the company you did
  not see stated.

When a field cannot be verified, write the exact string `Not Found`.
`Not Found` is a correct answer. A plausible-looking invented email is a failure.

Look on the company's contact page, careers page, about page, team page, and footer —
that is where published addresses actually live.

## How to work

Go in batches of 10. After each batch, append those rows to the sheet and tell me
how many you have added so far, so I can see progress rather than waiting for all
100 at once. If a batch yields fewer than 10 verifiable companies, say so and move
to the next zone/sector pair rather than padding the list.

When you are done, give me a one-line count of rows added and how many companies you
looked at but rejected, with the most common reason.
