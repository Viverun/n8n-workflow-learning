import { workflow, node, trigger, expr, ifElse, sticky } from '@n8n/workflow-sdk';

const TABLE = { __rl: true, mode: 'id', value: 'eCofqKArePAmw7L0', cachedResultName: 'Bayt Hiring Companies' };
const STATE = { __rl: true, mode: 'id', value: 'SYA6ZfpQu3pGxGG8', cachedResultName: 'Pipeline Monitor State' };

const manualStart = trigger({ type: 'n8n-nodes-base.manualTrigger', version: 1, config: { name: 'Manual Start' } });
const every5 = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.2,
  config: { name: 'Every 5 Minutes', parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } } }
});

const getState = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Get Credit State',
    alwaysOutputData: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: STATE,
      filters: { conditions: [{ keyName: 'state_key', condition: 'eq', keyValue: 'credits' }] },
      limit: 1
    }
  },
  output: [{ state_key: 'credits', credits_ok: true }]
});

const creditsOk = ifElse({
  version: 2.2,
  config: {
    name: 'Credits Available?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.credits_ok === true }}'), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

const getAll = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Get Hiring Companies',
    parameters: { resource: 'row', operation: 'get', dataTableId: TABLE, returnAll: true }
  },
  output: [{ bayt_company_url: 'https://www.bayt.com/en/company/x-1/', company_name: 'X', enrichment_status: null, claimed_at: null }]
});

const pick = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Pick Next Batch', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "\n// Enrich only as many as the sheet needs: stop once there are 40 verified, unsynced companies waiting.\nconst BUFFER = 40;\nconst PER_RUN = 5;\nconst STALE_MS = 20 * 60 * 1000;\nconst EXCLUDE = /recruit|consultan|staffing|manpower|human resource|\\bhr\\b|talent|placement|headhunt|outsourc|executive search|careers?\\b|jobs?\\b|employment|confidential|michael page|page group|hays\\b|robert walters|robert half|adecco|randstad|kelly services|charterhouse|cooper fitch|nadia global|bayt/i;\nconst looksReal = n => /^[A-Za-z0-9][^\"()|*\\n]{1,79}$/.test(n);\nconst nk = n => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '');\n// one-time retry of rows processed by the first test versions (before the parser fixes)\nconst RETRY_BEFORE = Date.parse('2026-09-24T17:25:35Z');\n// one-time re-check of rows whose email failed the stricter rules added later (foreign office, training address, generic-name match)\nconst RECHECK_BEFORE = Date.parse('2026-09-24T20:41:49Z');\nconst RECHECK = ['https://www.bayt.com/en/company/cisco-0-2114710/', 'bayt:palo-alto-networks', 'https://www.bayt.com/en/company/ericsson-0-2114867/', 'https://www.bayt.com/en/company/emagine-solutions-fze-1792817/', 'bayt:intelligent-solutions', 'https://www.bayt.com/en/company/ibm-979198/'];\nconst isRetry = r => r.enrichment_status === 'done' && (new Date(r.updatedAt).getTime() < RETRY_BEFORE || (RECHECK.includes(r.bayt_company_url) && new Date(r.updatedAt).getTime() < RECHECK_BEFORE));\nconst rows = $input.all();\nconst waiting = rows.filter(r => r.json.email_status === 'Verified' && r.json.sheet_synced !== true).length;\nif (waiting >= BUFFER) return [];\n// a company name already handled (done or being worked) is not enriched again under another Bayt URL\nconst handled = new Set(rows.filter(r => (r.json.enrichment_status === 'done' && !isRetry(r.json)) || r.json.enrichment_status === 'in_progress').map(r => nk(r.json.company_name)));\nconst now = Date.now();\nconst fresh = [], stale = [];\nfor (const it of rows) {\n  const r = it.json;\n  const name = String(r.company_name || '').trim();\n  if (!looksReal(name) || EXCLUDE.test(name)) continue;\n  if (r.enrichment_status === 'done' && !isRetry(r)) continue;\n  if (r.enrichment_status === 'in_progress') {\n    const t = r.claimed_at ? new Date(r.claimed_at).getTime() : 0;\n    if (now - t > STALE_MS) stale.push(it);\n    continue;\n  }\n  if (handled.has(nk(name))) continue;\n  handled.add(nk(name));\n  fresh.push(it);\n}\nreturn fresh.concat(stale).slice(0, PER_RUN).map(it => ({ json: { bayt_company_url: it.json.bayt_company_url, company_name: it.json.company_name } }));\n" } },
  output: [{ bayt_company_url: 'https://www.bayt.com/en/company/x-1/', company_name: 'X' }]
});

const claim = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Claim Companies',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: TABLE,
      matchType: 'anyCondition',
      filters: { conditions: [{ keyName: 'bayt_company_url', condition: 'eq', keyValue: expr('{{ $json.bayt_company_url }}') }] },
      columns: { mappingMode: 'defineBelow', value: { enrichment_status: 'in_progress', claimed_at: expr('{{ $now.toISO() }}') } }
    }
  },
  output: [{ id: 1 }]
});

const restore = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Batch To Search', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "return $('Pick Next Batch').all().map(i => ({ json: i.json }));" } },
  output: [{ bayt_company_url: 'https://www.bayt.com/en/company/x-1/', company_name: 'X' }]
});

const tavily = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Tavily Search',
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: 'https://api.tavily.com/search',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpCustomAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr("{{ JSON.stringify({ query: $json.company_name + ' UAE contact email', max_results: 8, search_depth: 'basic' }) }}"),
      options: { timeout: 30000, batching: { batch: { batchSize: 1, batchInterval: 1000 } } }
    },
    credentials: { httpCustomAuth: { id: 'H0523I2799CH71fw', name: 'Tavily Web Search' } }
  },
  output: [{ results: [{ url: 'https://x.com', content: 'hr@x.com' }] }]
});

const parse = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Parse Search Results', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "// Pair each Tavily response with its company, pick the official website, collect emails seen in snippets.\nconst picked = $('Pick Next Batch').all();\nconst res = $input.all();\nconst AGG = /linkedin|bayt\\.com|facebook|instagram|twitter|(^|\\.)x\\.com|glassdoor|indeed|gulftalent|naukri|zoominfo|rocketreach|crunchbase|wikipedia|yellowpages|dnb\\.com|apollo\\.io|signalhire|lusha|contactout|youtube|tiktok|bloomberg|reuters|zawya|ambitionbox|comparably|craft\\.co|owler|cbinsights|pitchbook|leadiq|datanyze|emis\\.com|kompass|hidubai|yello\\.ae|dubizzle|gov\\.ae|tracxn|f6s|clutch\\.co|goodfirms|google\\.|medium\\.com|github\\.com|wellfound|builtin|jobs?\\.|careers?\\.|workable|lever\\.co|greenhouse|smartrecruiters|myworkday|dubaichamber|dnb\\.|opencorporates|bizapedia|trustpilot|amazon\\.|apple\\.com/i;\nconst STOP = new Set(['llc','l','c','fze','fzco','fz','inc','ltd','limited','group','the','plc','co','company','dmcc','se','uae','me','middle','east','and','of','international','global','holding','holdings']);\nconst GENERIC = new Set(['solutions','solution','technologies','technology','tech','services','service','systems','system','consulting','consultancy','consultants','digital','software','networks','network','partners','trading','enterprises','enterprise','industries','innovations','innovation','labs','lab','media','smart','general','management','intelligent','intelligence','data','cloud','security','info','information','business','worldwide','world','group','agency','hotels','resorts','collection','institute','university','bank','capital','investments']);\nconst norm = s => String(s || '').normalize('NFD').replace(/[\\\u0300-\\\u036f]/g, '').toLowerCase();\nconst rootOf = host => {\n  const p = host.toLowerCase().replace(/^www\\./, '').split('.');\n  if (p.length >= 3 && /^(co|com|net|org|gov|ac|edu)$/.test(p[p.length - 2]) && p[p.length - 1].length === 2) return p.slice(-3).join('.');\n  return p.slice(-2).join('.');\n};\nconst label = host => rootOf(host).split('.')[0];\nconst hostOf = u => { const m = String(u || '').match(/^https?:\\/\\/([^\\/?#:]+)/i); return m ? m[1].toLowerCase() : ''; };\nconst AGENCY = /recruitment (agency|services?|company|solutions|consultan|firm)|staffing (agency|company|solutions|services)|manpower (supply|services|agency)|headhunting|executive search/i;\nconst UAE = /\\bu\\.?a\\.?e\\b|dubai|abu dhabi|united arab emirates|sharjah|ajman|ras al khaimah|fujairah/i;\nconst EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/g;\nconst out = [];\nfor (let i = 0; i < picked.length; i++) {\n  const c = picked[i].json;\n  const r = (res[i] && res[i].json) || {};\n  const base = { bayt_company_url: c.bayt_company_url, company_name: c.company_name };\n  if (r.error || !Array.isArray(r.results)) {\n    out.push({ json: { ...base, tavily_error: true, error_text: String(r.error && (r.error.message || r.error) || 'no results').slice(0, 200) } });\n    continue;\n  }\n  const tokens = norm(c.company_name).replace(/[^a-z0-9 ]+/g, ' ').split(/\\s+/).filter(t => t.length >= 3 && !STOP.has(t) && !GENERIC.has(t));\n  const joined = norm(c.company_name).replace(/[^a-z0-9 ]+/g, ' ').split(/\\s+/).filter(t => t && !STOP.has(t)).join('');\n  const key = tokens.slice().sort((a, b) => b.length - a.length)[0] || '';\n  // names made only of generic words (e.g. \"Intelligent Solutions\") match many unrelated companies worldwide\n  const genericName = tokens.length === 0;\n  // rank candidate hosts: exact company-name domain > domain starting with the name > domain containing the key word\n  let site = '', best = 0;\n  for (const x of r.results) {\n    const host = hostOf(x.url);\n    if (!host || AGG.test(host)) continue;\n    const lab = label(host).replace(/[^a-z0-9]/g, '');\n    let s = 0;\n    if (joined && lab === joined) s = 3;\n    else if (joined && (lab.startsWith(joined) || joined.startsWith(lab)) && lab.length >= 3 && Math.abs(lab.length - joined.length) <= 4) s = 2;\n    else if (key && lab.includes(key) && lab.length <= key.length + 5) s = 1;\n    if (s > best) { best = s; site = 'https://' + rootOf(host); }\n  }\n  const emails = [];\n  let agency = false, uae = false;\n  if (site) {\n    const lab = label(hostOf(site));\n    // only trust text that comes from the company's own website (directories show fake example addresses)\n    for (const x of r.results) {\n      if (label(hostOf(x.url)) !== lab) continue;\n      const txt = String(x.content || '') + ' ' + String(x.title || '');\n      if (AGENCY.test(txt)) agency = true;\n      if (UAE.test(txt)) uae = true;\n      for (const e of txt.match(EMAIL) || []) {\n        const d = e.split('@')[1].toLowerCase();\n        if (label(d) === lab && !emails.includes(e.toLowerCase())) emails.push(e.toLowerCase());\n      }\n    }\n  }\n  out.push({ json: { ...base, tavily_error: false, site, site_label: site ? label(hostOf(site)) : '', snippet_emails: emails, agency, uae: genericName ? /\\.ae$/.test(site) : (uae || /\\.ae$/.test(site)), generic_name: genericName } });\n}\nreturn out;\n" } },
  output: [{ bayt_company_url: 'u', company_name: 'X', tavily_error: false, site: 'https://x.com', site_label: 'x', snippet_emails: [] }]
});

const tavFailed = ifElse({
  version: 2.2,
  config: {
    name: 'Tavily Failed?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.tavily_error === true }}'), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

const release = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Release Claim',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: TABLE,
      matchType: 'anyCondition',
      filters: { conditions: [{ keyName: 'bayt_company_url', condition: 'eq', keyValue: expr('{{ $json.bayt_company_url }}') }] },
      columns: { mappingMode: 'defineBelow', value: { enrichment_status: 'pending' } }
    }
  },
  output: [{ id: 1 }]
});

const pause = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Pause For Tavily',
    executeOnce: true,
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: STATE,
      matchType: 'anyCondition',
      filters: { conditions: [{ keyName: 'state_key', condition: 'eq', keyValue: 'credits' }] },
      columns: { mappingMode: 'defineBelow', value: { tavily_blocked: true, credits_ok: false, blocked_at: expr('{{ $now.toISO() }}') } }
    }
  },
  output: [{ id: 1 }]
});

const buildUrls = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Build Page URLs', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "// One fetch item per page to read: homepage + common contact paths (free, direct HTTP).\nconst out = [];\nfor (const it of $input.all()) {\n  const c = it.json;\n  const paths = c.site ? ['', '/contact-us', '/contact', '/en/contact-us'] : [];\n  if (!paths.length) out.push({ json: { bayt_company_url: c.bayt_company_url, url: 'https://invalid.invalid/' } });\n  for (const p of paths) out.push({ json: { bayt_company_url: c.bayt_company_url, url: c.site + p } });\n}\nreturn out;\n" } },
  output: [{ bayt_company_url: 'u', url: 'https://x.com/contact-us' }]
});

const fetchPages = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Fetch Pages (free)',
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: expr('{{ $json.url }}'),
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'User-Agent', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
        { name: 'Accept', value: 'text/html,application/xhtml+xml' }
      ] },
      options: {
        timeout: 15000,
        response: { response: { responseFormat: 'text', outputPropertyName: 'data' } },
        batching: { batch: { batchSize: 4, batchInterval: 300 } }
      }
    }
  },
  output: [{ data: '<html>hr@x.com</html>' }]
});

const choose = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Choose Best Email', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "// Combine snippet + page emails per company, keep only the company's own domain, rank, pick one.\nconst companies = $('Parse Search Results').all().map(i => i.json).filter(c => !c.tavily_error);\nconst urls = $('Build Page URLs').all().map(i => i.json);\nconst pages = $input.all().map(i => i.json);\nconst EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/g;\nconst PHONE = /(?:\\+|00)\\s?971[\\s\\-().0-9]{7,16}\\d/g;\nconst rootLabel = d => {\n  const p = d.toLowerCase().replace(/^www\\./, '').split('.');\n  if (p.length >= 3 && /^(co|com|net|org|gov|ac|edu)$/.test(p[p.length - 2]) && p[p.length - 1].length === 2) return p[p.length - 3];\n  return p[p.length - 2] || p[0];\n};\nconst BAD = /^(no-?reply|do-?not-?reply|privacy|data-?protection|dpo|gdpr|compliance|chiefcomplianceofficer|legal|abuse|csirt|cert|security|webmaster|postmaster|hostmaster|press|pr|globalpr|media|investors?|ir|foundation|governmentaffairs|unsubscribe|example|test|user|name|email|your|someone|admin|wordpress|sentry|jane|john|doe|first|last|firstname|lastname|registrar|admissions|accounts?|finance|billing|invoices?|payroll|procurement|tender|learn|learning|training|academy|education|events?|webinars?|orders?|returns|shop|store|enduser)\\b/i;\n// addresses for another country's office (e.g. sbsc-japan-enduser@, x@eg.ibm.com) are not the UAE contact\nconst FOREIGN_NAMES = new Set(['japan','china','india','usa','uk','europe','apac','asia','latam','germany','france','spain','italy','brazil','mexico','canada','australia','singapore','korea','turkey','egypt','saudi','ksa','qatar','kuwait','bahrain','oman','pakistan','africa','nigeria','kenya','philippines','indonesia','malaysia','thailand','vietnam','russia','poland','netherlands','sweden','israel','jordan','lebanon','morocco','americas','nordics','benelux','dach','anz']);\nconst FOREIGN_CODES = new Set(['jp','cn','in','us','uk','eu','de','fr','es','it','br','mx','ca','au','sg','kr','tr','eg','sa','qa','kw','bh','om','pk','za','ng','ke','ph','id','my','th','vn','ru','pl','nl','se','il','jo','lb','ma']);\nconst ROLE = /career|jobs?|hr|recruit|talent|hiring|people|info|contact|hello|enquir|inquir|sales|business|office|support|team|uae|dubai|abudhabi|middleeast|mena|meta|emea|gcc|\\bme\\b/;\nconst foreign = e => {\n  const [l, d] = e.split('@');\n  const sub = d.toLowerCase().split('.');\n  const subLabels = sub.slice(0, Math.max(0, sub.length - 2));\n  return l.split(/[._\\-+]/).some(t => FOREIGN_NAMES.has(t)) || subLabels.some(t => FOREIGN_CODES.has(t) || FOREIGN_NAMES.has(t));\n};\n// a named person's address is only trusted on a UAE (.ae) domain; elsewhere it could be anyone worldwide\nconst personalAbroad = e => { const [l, d] = e.split('@'); return !ROLE.test(l) && /^[a-z]+[._][a-z]+$/.test(l) && !/\\.ae$/.test(d); };\nconst score = e => {\n  const l = e.split('@')[0];\n  let s = 10;\n  if (/career|jobs?|hr|recruit|talent|hiring|people/.test(l)) s = 50;\n  else if (/info|contact|hello|enquir|inquir|sales|business|office|support/.test(l)) s = 30;\n  if (/uae|dubai|abudhabi|\\bme\\b|mena|middleeast|gcc|ae$/.test(l)) s += 20;\n  return s;\n};\nconst AGENCY = /recruitment (agency|services?|company|solutions|consultan|firm)|staffing (agency|company|solutions|services)|manpower (supply|services|agency)|headhunting|executive search/i;\nconst UAE = /\\bu\\.?a\\.?e\\b|dubai|abu dhabi|united arab emirates|sharjah|ajman|ras al khaimah|fujairah/i;\nconst byCo = {};\nfor (let i = 0; i < urls.length; i++) {\n  const k = urls[i].bayt_company_url;\n  const html = String((pages[i] && pages[i].data) || '').replace(/&#64;|&#x40;|%40|\\s?\\[at\\]\\s?|\\s?\\(at\\)\\s?/gi, '@');\n  const b = byCo[k] || (byCo[k] = { emails: [], phones: [], src: {}, agency: false, uae: false });\n  if (UAE.test(html.replace(/<[^>]+>/g, ' '))) b.uae = true;\n  if (AGENCY.test(html.slice(0, 20000).replace(/<[^>]+>/g, ' '))) b.agency = true;\n  for (const e of html.match(EMAIL) || []) { const x = e.toLowerCase(); if (!b.emails.includes(x)) { b.emails.push(x); b.src[x] = urls[i].url; } }\n  for (const p of html.match(PHONE) || []) { const x = p.replace(/\\s+/g, ' ').trim(); if (!b.phones.includes(x)) b.phones.push(x); }\n}\nreturn companies.map(c => {\n  const b = byCo[c.bayt_company_url] || { emails: [], phones: [], src: {} };\n  const lab = c.site_label;\n  const cands = [...(c.snippet_emails || []), ...b.emails]\n    .filter((e, i, a) => a.indexOf(e) === i)\n    .filter(e => lab && rootLabel(e.split('@')[1]) === lab)\n    .filter(e => !BAD.test(e.split('@')[0]) && !/\\.(png|jpe?g|gif|svg|webp|css|js)$/.test(e))\n    .filter(e => !foreign(e) && !personalAbroad(e));\n  cands.sort((a, b2) => score(b2) - score(a));\n  const isAgency = b.agency || c.agency === true;\n  // the site must show a UAE presence, otherwise it is probably a same-name company elsewhere\n  const inUae = c.generic_name === true ? c.uae === true : (c.uae === true || b.uae === true);\n  const email = (isAgency || !inUae) ? '' : (cands[0] || '');\n  return { json: {\n    bayt_company_url: c.bayt_company_url,\n    company_name: c.company_name,\n    website: c.site || '',\n    email,\n    email_status: email ? 'Verified' : 'Not Found',\n    contact_number: email ? (b.phones[0] || '') : '',\n    source: isAgency ? 'Recruitment agency - skipped' : !inUae ? 'No UAE presence on site - skipped' : email ? ((c.snippet_emails || []).includes(email) ? 'Search Snippet' : (b.src[email] || '')) : ''\n  }};\n});\n" } },
  output: [{ bayt_company_url: 'u', company_name: 'X', website: 'https://x.com', email: 'hr@x.com', email_status: 'Verified', contact_number: '', source: 'Search Snippet' }]
});

const save = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Save Result',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: TABLE,
      matchType: 'anyCondition',
      filters: { conditions: [{ keyName: 'bayt_company_url', condition: 'eq', keyValue: expr('{{ $json.bayt_company_url }}') }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          enrichment_status: 'done',
          email_status: expr('{{ $json.email_status }}'),
          email: expr('{{ $json.email }}'),
          website: expr('{{ $json.website }}'),
          contact_number: expr('{{ $json.contact_number }}')
        }
      }
    }
  },
  output: [{ id: 1 }]
});

const note = sticky(
  '## Bayt Hiring Enrichment (deterministic, no AI)\n\nEvery 5 minutes, only while Pipeline Monitor says credits are OK, takes up to 5 Bayt tech-hiring companies: 1 Tavily search each ("<company> UAE contact email"), picks the official website (skips LinkedIn/job boards/directories, host must contain the company name), then reads the homepage + contact pages for free. Only emails on the company\'s own domain are accepted; privacy/noreply/press addresses are dropped; careers/HR > info/contact. Recruitment agencies are skipped. Stops once 40 verified companies are waiting for the sheet. Tavily errors release the claim and pause all enrichment via the shared credit flag.',
  [pick, parse, choose],
  { color: 6 }
);

export default workflow('bayt-hiring-enrichment-v2', 'Bayt Hiring Enrichment: Deterministic Email Finder')
  .add(manualStart)
  .to(getState)
  .add(every5)
  .to(getState)
  .add(getState.to(creditsOk.onTrue(getAll.to(pick.to(claim.to(restore.to(tavily.to(parse.to(tavFailed.onTrue(release.to(pause)).onFalse(buildUrls.to(fetchPages.to(choose.to(save)))))))))))))
  .add(note);
