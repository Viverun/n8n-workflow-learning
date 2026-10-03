import { workflow, node, trigger, expr, ifElse, sticky, languageModel } from '@n8n/workflow-sdk';

const SHEET_DOC = { __rl: true, mode: 'id', value: '17-xFB3WbayS_cWPAXaLX_u8KBe_VlaDh3o4OksKsyNY', cachedResultName: 'UpSpark Prospects (US + UAE)' };
const SHEET_TAB = { __rl: true, mode: 'id', value: '1226409885', cachedResultName: 'Prospects' };
const QUERY_LOG = { __rl: true, mode: 'id', value: 'ZNo98vHGTHiAGHK3', cachedResultName: 'UpSpark Prospect Queries' };
const STATE = { __rl: true, mode: 'id', value: 'SYA6ZfpQu3pGxGG8', cachedResultName: 'Pipeline Monitor State' };
const GSHEETS = { googleSheetsOAuth2Api: { id: 'OH1NGutCEKtPnrEt', name: 'Google Sheets account' } };

const manualStart = trigger({ type: 'n8n-nodes-base.manualTrigger', version: 1, config: { name: 'Manual Start' } });
const every3h = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.2,
  config: { name: 'Every 3 Hours', parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 3 }] } } }
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
        conditions: [{ leftValue: expr('{{ $json.credits_ok !== false }}'), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

// empty sheet (headers only) returns no rows; the picker still has to run
const readSheet = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Read Prospects Sheet',
    executeOnce: true,
    alwaysOutputData: true,
    parameters: { resource: 'sheet', operation: 'read', documentId: SHEET_DOC, sheetName: SHEET_TAB, options: {} },
    credentials: GSHEETS
  },
  output: [{ row_number: 2, company_name: 'X', country: 'United States', email: 'info@x.com', website: 'https://x.com' }]
});

const getLog = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Get Query Log',
    executeOnce: true,
    alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'get', dataTableId: QUERY_LOG, returnAll: true }
  },
  output: [{ query_key: 'dental clinic|Dubai', status: 'claimed' }]
});

const pick = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Pick Next Queries', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: `
// Segment x city search plan. Each combination is searched once; the query log records what has been used.
const PER_RUN = 3;
// Operations-heavy businesses: the natural buyers for workflow automation, system integration and AI
const SEGMENTS = ['logistics company','freight forwarding company','accounting firm','bookkeeping firm','wholesale distributor','property management company','recruitment agency','insurance broker','manufacturing company','multi-location clinic group'];
const UAE = ['Dubai','Abu Dhabi','Sharjah','Ajman','Ras Al Khaimah'];
const US = ['New York','Los Angeles','Chicago','Houston','Miami','Austin','Dallas','San Francisco','Seattle','Atlanta','Boston','Denver','Phoenix','Philadelphia','San Diego'];
// alternate UAE and US so both countries fill up together
const plan = [];
for (const s of SEGMENTS) {
  const ae = UAE.map(c => ({ segment: s, city: c, country: 'United Arab Emirates' }));
  const us = US.map(c => ({ segment: s, city: c, country: 'United States' }));
  const n = Math.max(ae.length, us.length);
  for (let i = 0; i < n; i++) { if (us[i]) plan.push(us[i]); if (ae[i]) plan.push(ae[i]); }
}
// interleave segments too, so one run does not spend the whole day on one industry
const bySeg = {};
for (const q of plan) (bySeg[q.segment] = bySeg[q.segment] || []).push(q);
const order = [];
for (let i = 0; order.length < plan.length; i++) for (const s of SEGMENTS) if (bySeg[s][i]) order.push(bySeg[s][i]);
const log = $('Get Query Log').all().map(i => i.json).filter(r => r.query_key);
// Rate-limit guard (protects Tavily + Azure OpenAI if several runs start at once, e.g. manual + schedule):
// 1) run lock: if another run claimed queries in the last 20 minutes, this run does nothing
// 2) daily budget: at most 24 searches (and so at most ~144 AI subject calls) per Dubai day
const LOCK_MS = 20 * 60 * 1000, DAILY_QUERIES = 24;
const nowMs = Date.now();
if (log.some(r => r.claimed_at && nowMs - new Date(r.claimed_at).getTime() < LOCK_MS)) return [];
const today = $now.setZone('Asia/Dubai').toISODate();
const usedToday = log.filter(r => r.claimed_at && DateTime.fromISO(new Date(r.claimed_at).toISOString()).setZone('Asia/Dubai').toISODate() === today).length;
if (usedToday >= DAILY_QUERIES) return [];
const used = new Set(log.map(r => r.query_key));
return order
  .map(q => ({ ...q, query_key: q.segment + '|' + q.city }))
  .filter(q => !used.has(q.query_key))
  .slice(0, Math.min(PER_RUN, DAILY_QUERIES - usedToday))
  .map(q => ({ json: q }));
` } },
  output: [{ query_key: 'dental clinic|Dubai', segment: 'dental clinic', city: 'Dubai', country: 'United Arab Emirates' }]
});

const logClaim = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Log Query Used',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: QUERY_LOG,
      columns: {
        mappingMode: 'defineBelow',
        value: {
          query_key: expr('{{ $json.query_key }}'),
          segment: expr('{{ $json.segment }}'),
          city: expr('{{ $json.city }}'),
          country: expr('{{ $json.country }}'),
          status: 'claimed',
          claimed_at: expr('{{ $now.toISO() }}')
        },
        schema: [
          { id: 'query_key', displayName: 'query_key', required: false, defaultMatch: false, display: true, type: 'string', readOnly: false, removed: false },
          { id: 'segment', displayName: 'segment', required: false, defaultMatch: false, display: true, type: 'string', readOnly: false, removed: false },
          { id: 'city', displayName: 'city', required: false, defaultMatch: false, display: true, type: 'string', readOnly: false, removed: false },
          { id: 'country', displayName: 'country', required: false, defaultMatch: false, display: true, type: 'string', readOnly: false, removed: false },
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', readOnly: false, removed: false },
          { id: 'claimed_at', displayName: 'claimed_at', required: false, defaultMatch: false, display: true, type: 'dateTime', readOnly: false, removed: false }
        ]
      }
    }
  },
  output: [{ id: 1 }]
});

const restore = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Queries To Search', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "return $('Pick Next Queries').all().map(i => ({ json: i.json }));" } },
  output: [{ query_key: 'dental clinic|Dubai', segment: 'dental clinic', city: 'Dubai', country: 'United Arab Emirates' }]
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
      jsonBody: expr("{{ JSON.stringify({ query: $json.segment + ' in ' + $json.city + ' ' + ($json.country === 'United States' ? 'USA' : 'UAE') + ' official website contact email', max_results: 15, search_depth: 'basic' }) }}"),
      options: { timeout: 30000, batching: { batch: { batchSize: 1, batchInterval: 1000 } } }
    },
    credentials: { httpCustomAuth: { id: 'H0523I2799CH71fw', name: 'Tavily Web Search' } }
  },
  output: [{ results: [{ url: 'https://x.com', title: 'X Dental', content: 'info@x.com' }] }]
});

const candidates = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Pick Company Sites', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: `
// Turn each search result into a candidate company website. Directories, listicles, social and marketplaces are dropped,
// as are domains already in the sheet.
const queries = $('Pick Next Queries').all().map(i => i.json);
const res = $input.all();
const AGG = /linkedin|facebook|instagram|twitter|(^|\\.)x\\.com|tiktok|youtube|pinterest|reddit|quora|yelp|tripadvisor|zomato|talabat|deliveroo|ubereats|doordash|grubhub|opentable|zocdoc|healthgrades|webmd|vitals\\.com|bbb\\.org|angi|thumbtack|houzz|homeadvisor|porch\\.com|bark\\.com|clutch\\.co|goodfirms|designrush|sortlist|upcity|expertise\\.com|threebestrated|glassdoor|indeed|bayt|naukri|crunchbase|zoominfo|rocketreach|apollo\\.io|dnb\\.|opencorporates|bizapedia|manta\\.com|yellowpages|yell\\.com|hidubai|yello\\.ae|dubizzle|propertyfinder|bayut|zillow|realtor\\.com|redfin|trulia|timeout|eater|infatuation|forbes|medium\\.com|wikipedia|google\\.|apple\\.com|amazon\\.|etsy|shopify\\.com|wix\\.com|squarespace|wordpress\\.com|blogspot|gov|\\.edu|news|magazine|guide|directory|listings?\\b|top10|best|mapquest|foursquare|nextdoor|groupon|fresha|booksy|vagaro|mindbody|classpass|avvo|justia|findlaw|lawyers\\.com|martindale|superlawyers|g2\\.com|capterra|producthunt|ycombinator|wellfound|builtin|f6s|tracxn|magnitt|wamda|gulfnews|khaleejtimes|thenationalnews|arabianbusiness|zawya|bloomberg|reuters|techcrunch|entrepreneur|inc\\.com|upwork|fiverr/i;
const rootOf = host => {
  const p = host.toLowerCase().replace(/^www\\./, '').split('.');
  if (p.length >= 3 && /^(co|com|net|org|gov|ac|edu)$/.test(p[p.length - 2]) && p[p.length - 1].length === 2) return p.slice(-3).join('.');
  return p.slice(-2).join('.');
};
const hostOf = u => { const m = String(u || '').match(/^https?:\\/\\/([^\\/?#:]+)/i); return m ? m[1].toLowerCase() : ''; };
const known = new Set();
for (const r of $('Read Prospects Sheet').all().map(i => i.json)) {
  if (r.website) known.add(rootOf(hostOf(r.website) || String(r.website)));
  if (r.email && String(r.email).includes('@')) known.add(rootOf(String(r.email).split('@')[1]));
}
const NOT_COMPANY_TITLE = /\\b(directory|directories|listings?|lists?|leads?|database|marketplace|job board|jobs|vacancies|firms in|companies in|agencies in|brokers in|near me|top \\d+|best \\d+|compare|reviews)\\b/i;
const NOT_COMPANY_HOST = /(^|[.-])(leads?|lists?|directory|jobs?|careers?|hiring|reviews?|compare|finder)([.-]|$)|yellowpages|bizben|openmart|selling\\.com|leadz|leadstal|gulfleads|publicleads|cpalist|drjob/i;
const PER_QUERY = 6;
const out = [];
for (let i = 0; i < queries.length; i++) {
  const q = queries[i];
  const r = (res[i] && res[i].json) || {};
  if (!Array.isArray(r.results)) continue;
  let n = 0;
  for (const x of r.results) {
    if (n >= PER_QUERY) break;
    const host = hostOf(x.url);
    if (!host || AGG.test(host)) continue;
    // "10 best dentists in Miami" style pages are articles, not a company homepage
    if (/\\b(top|best)\\s+\\d+|\\d+\\s+best\\b|\\blist of\\b|\\branking/i.test(String(x.title || ''))) continue;
    // directories, lead lists, job boards and "firms in <city>" pages are not companies we can sell to
    if (NOT_COMPANY_TITLE.test(String(x.title || '')) || NOT_COMPANY_HOST.test(host)) continue;
    const root = rootOf(host);
    if (known.has(root)) continue;
    known.add(root);
    n++;
    out.push({ json: { ...q, site: 'https://' + (host.startsWith('www.') ? host : root), root, search_title: String(x.title || ''), search_snippet: String(x.content || '').slice(0, 600) } });
  }
}
return out;
` } },
  output: [{ query_key: 'dental clinic|Dubai', segment: 'dental clinic', city: 'Dubai', country: 'United Arab Emirates', site: 'https://x.com', root: 'x.com', search_title: 'X', search_snippet: '' }]
});

const buildUrls = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Build Page URLs', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: `
// homepage + common contact pages, read for free with plain HTTP
const out = [];
for (const it of $input.all()) for (const p of ['', '/contact', '/contact-us']) out.push({ json: { root: it.json.root, url: it.json.site + p } });
return out;
` } },
  output: [{ root: 'x.com', url: 'https://x.com/contact' }]
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
  output: [{ data: '<html>info@x.com</html>' }]
});

const extract = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Extract Company + Email', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: `
// Per site: company name, a contact email on the company's own domain, the country, and a short text snippet for the subject.
const sites = $('Pick Company Sites').all().map(i => i.json);
const urls = $('Build Page URLs').all().map(i => i.json);
const pages = $input.all().map(i => i.json);
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/g;
const label = d => { const p = d.toLowerCase().replace(/^www\\./, '').split('.'); if (p.length >= 3 && /^(co|com|net|org)$/.test(p[p.length - 2]) && p[p.length - 1].length === 2) return p[p.length - 3]; return p[p.length - 2] || p[0]; };
const BAD = /^(no-?reply|do-?not-?reply|privacy|data-?protection|dpo|gdpr|compliance|legal|abuse|security|webmaster|postmaster|hostmaster|press|media|investors?|ir|unsubscribe|example|test|user|name|email|your|yourname|someone|admin|wordpress|sentry|jane|john|doe|first|last|firstname|lastname|careers?|jobs|hr|recruit\\w*|billing|invoices?|accounts?|payroll|returns|orders?)\\b/i;
const score = e => {
  const l = e.split('@')[0];
  if (/^(info|hello|hi|contact|contactus|enquir|inquir|sales|business|office|team|general|mail)/.test(l)) return 50;
  if (/support|help|care|service/.test(l)) return 30;
  return 20;
};
const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&#8211;|&ndash;|&#8212;|&mdash;/g, '-').replace(/&#[0-9]+;/g, ' ').replace(/&[a-z]+;/g, ' ');
const text = h => decode(String(h || '').replace(/<script[\\s\\S]*?<\\/script>|<style[\\s\\S]*?<\\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\\s+/g, ' ').trim();
const meta = (h, re) => { const m = String(h || '').match(re); return m ? decode(m[1]).trim() : ''; };
const UAE_RE = /\\bu\\.?a\\.?e\\b|dubai|abu dhabi|sharjah|ajman|ras al khaimah|united arab emirates|\\+971|\\b00971/i;
const US_RE = /\\bUSA\\b|United States|\\+1[\\s.(-]*\\d{3}|\\(\\d{3}\\)\\s?\\d{3}-\\d{4}|\\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\\s+\\d{5}\\b/;
const cleanName = (raw, lab) => {
  let parts = decode(raw).split(/\\s[|\\-:\\u2013\\u2014\\u00b7]\\s|\\s\\|\\s?|\\u2013|\\u2014/).map(s => s.trim()).filter(Boolean);
  parts = parts.filter(p => !/^(home|homepage|welcome|contact( us)?|about( us)?)$/i.test(p) && p.length <= 60);
  const key = lab.replace(/[^a-z0-9]/g, '');
  const scored = parts.map(p => ({ p, s: (p.toLowerCase().replace(/[^a-z0-9]/g, '').includes(key.slice(0, 5)) ? 2 : 0) + (p.split(' ').length <= 5 ? 1 : 0) }));
  scored.sort((a, b) => b.s - a.s);
  return scored.length ? scored[0].p.replace(/^welcome to\\s+/i, '') : '';
};
const byRoot = {};
for (let i = 0; i < urls.length; i++) {
  const k = urls[i].root;
  const html = String((pages[i] && pages[i].data) || '');
  const b = byRoot[k] || (byRoot[k] = { html: [], emails: [] });
  if (html.length < 200) continue;
  b.html.push(html);
  const h = html.replace(/&#64;|&#x40;|%40|\\s?\\[at\\]\\s?|\\s?\\(at\\)\\s?/gi, '@');
  for (const e of h.match(EMAIL) || []) { const x = e.toLowerCase().replace(/^mailto:/, ''); if (!b.emails.includes(x)) b.emails.push(x); }
}
const seenEmail = new Set();
const out = [];
for (const s of sites) {
  const b = byRoot[s.root];
  if (!b || !b.html.length) continue;
  const home = b.html[0];
  const lab = label(s.root);
  const emails = b.emails
    .filter(e => label(e.split('@')[1]) === lab)
    .filter(e => !BAD.test(e.split('@')[0]) && !/\\.(png|jpe?g|gif|svg|webp|css|js)$/.test(e))
    .sort((a, c) => score(c) - score(a));
  const email = emails[0];
  if (!email || seenEmail.has(email)) continue;
  const all = b.html.map(text).join(' ');
  const isUae = UAE_RE.test(all) || /\\.ae$/.test(s.root);
  const isUs = US_RE.test(all) || new RegExp(s.city, 'i').test(all);
  let country = '';
  if (s.country === 'United Arab Emirates') country = isUae ? 'United Arab Emirates' : '';
  else country = isUs && !(/\\.ae$/.test(s.root)) ? 'United States' : (isUae ? 'United Arab Emirates' : '');
  if (!country) continue;
  // last guard against directory / lead-list sites that slipped through
  const rawTitle = meta(home, /<title[^>]*>([^<]+)<\\/title>/i);
  if (/\\b(directory|listings?|leads?|database|job board|jobs|firms in|companies in|near me)\\b/i.test(rawTitle)) continue;
  const name = cleanName(meta(home, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i), lab)
    || cleanName(meta(home, /<title[^>]*>([^<]+)<\\/title>/i), lab)
    || lab.charAt(0).toUpperCase() + lab.slice(1);
  const desc = meta(home, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i) || meta(home, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i);
  const hints = [];
  if (!/<meta[^>]+name=["']viewport/i.test(home)) hints.push('site is not mobile-optimised');
  const yr = (all.match(/(?:©|&copy;|copyright)\\s*(?:\\d{4}\\s*[-–]\\s*)?(20\\d{2})/i) || [])[1];
  if (yr && Number(yr) <= new Date().getFullYear() - 2) hints.push('footer copyright is ' + yr);
  if (!/wa\\.me|whatsapp|calendly|book(ing)? (now|online|an appointment)|schedule (a|your)/i.test(home)) hints.push('no online booking or WhatsApp button');
  seenEmail.add(email);
  out.push({ json: {
    company_name: name.slice(0, 80),
    country,
    email,
    website: 'https://' + s.root,
    segment: s.segment,
    city: s.city,
    about: (desc || s.search_snippet || all.slice(0, 400)).slice(0, 500),
    hints: hints.join('; ')
  }});
}
return out;
` } },
  output: [{ company_name: 'X Dental', country: 'United Arab Emirates', email: 'info@x.com', website: 'https://x.com', segment: 'dental clinic', city: 'Dubai', about: 'Family dental care in JLT', hints: '' }]
});

const azureModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatAzureOpenAi',
  version: 1,
  config: {
    name: 'Azure GPT-5 Mini',
    parameters: { model: 'gpt-5-mini', options: { timeout: 60000, maxRetries: 5 } },
    credentials: { azureOpenAiApi: { id: 'RlTrqkjqaMvSzEIK', name: 'Azure Open AI account' } }
  }
});

const writeSubject = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm',
  version: 1.9,
  config: {
    name: 'Write Personalized Subject',
    onError: 'continueRegularOutput',
    parameters: {
      promptType: 'define',
      text: expr('Company: {{ $json.company_name }}\nType of business: {{ $json.segment }}\nCity: {{ $json.city }}, {{ $json.country }}\nWhat their website says: {{ $json.about }}\nObservations about their website: {{ $json.hints || "none" }}\n\nWrite the subject line.'),
      messages: { messageValues: [{ type: 'SystemMessagePromptTemplate', message: "You write cold-email subject lines for UpSpark, an IT solutions, automation and growth company (workflow automation, system integration, AI solutions, custom software and dashboards, social media packages, marketing email outreach).\n\nRules:\n- Output ONLY the subject line: one line, no quotes, no label, no emojis.\n- It MUST contain the exact company name as given.\n- 40 to 75 characters.\n- Lead with a short, benefit-oriented action phrase, in the style of: \"Grow your business\", \"Automate your workflow\", \"Save hours every week\", \"Scale your outreach\", \"Streamline your operations\", \"Grow your reach online\". Then tie it to the company and one relevant area for this type of business (e.g. invoicing, reporting, shipment updates, tenant requests, candidate follow-ups, policy renewals, order processing, social media, email campaigns).\n- Vary the opening phrase and structure between companies; do not always use the same one.\n- Talk about the company\'s operations, growth and team, never about getting them more patients.\n- Professional and plain, not hype. No ALL CAPS, no \"!\", no words like free, guarantee, offer, discount, urgent, act now, 100%.\n- Never claim facts you were not given.\n\nExamples of the style (do not copy):\nAutomate your workflow at Harbor Logistics: shipment updates on autopilot\nGrow your business, Atlas Accounting: less admin, more clients\nSave hours every week at Crestview Property Management\nScale your outreach, Nova Recruitment: smarter candidate follow-ups\nStreamline operations at Delta Insurance Brokers with automation" }] },
      batching: { batchSize: 1, delayBetweenBatches: 1500 }
    },
    subnodes: { model: azureModel }
  },
  output: [{ text: 'X Dental: more online bookings from JLT patients?' }]
});

const finalize = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Check Subject', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: `
// Keep the AI subject only if it is one clean line containing the company name; otherwise use a rotating template.
const src = $('Extract Company + Email').all().map(i => i.json);
const res = $input.all().map(i => i.json);
const FALLBACK = [
  n => 'Automate your workflow at ' + n,
  n => 'Grow your business, ' + n + ': less admin, more growth',
  n => 'Save hours every week at ' + n,
  n => 'Streamline your operations at ' + n
];
const SPAM = /\\b(free|guarantee|offer|discount|urgent|act now|100%|winner|cash)\\b|!/i;
return src.map((c, i) => {
  let s = String((res[i] && res[i].text) || '').split('\\n').map(x => x.trim()).filter(Boolean)[0] || '';
  s = s.replace(/^subject\\s*:\\s*/i, '').replace(/^["'\\u201c\\u2018]+|["'\\u201d\\u2019]+$/g, '').trim();
  const ok = s && s.length <= 90 && s.toLowerCase().includes(c.company_name.toLowerCase()) && !SPAM.test(s);
  const subject = ok ? s : FALLBACK[(c.email.length + i) % FALLBACK.length](c.company_name);
  return { json: { company_name: c.company_name, country: c.country, email: c.email, subject, website: c.website, segment: c.segment } };
});
` } },
  output: [{ company_name: 'X Dental', country: 'United Arab Emirates', email: 'info@x.com', subject: 'X Dental: more online bookings?', website: 'https://x.com', segment: 'dental clinic' }]
});

const append = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Add To Prospects Sheet',
    parameters: {
      resource: 'sheet',
      operation: 'append',
      documentId: SHEET_DOC,
      sheetName: SHEET_TAB,
      columns: {
        mappingMode: 'defineBelow',
        value: {
          company_name: expr('{{ $json.company_name }}'),
          country: expr('{{ $json.country }}'),
          email: expr('{{ $json.email }}'),
          subject: expr('{{ $json.subject }}'),
          website: expr('{{ $json.website }}'),
          segment: expr('{{ $json.segment }}')
        },
        schema: [
          { id: 'company_name', displayName: 'company_name', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'country', displayName: 'country', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'email', displayName: 'email', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'subject', displayName: 'subject', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'website', displayName: 'website', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'segment', displayName: 'segment', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'send', displayName: 'send', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'sent_at', displayName: 'sent_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }
        ]
      },
      options: { cellFormat: 'RAW' }
    },
    credentials: GSHEETS
  },
  output: [{ company_name: 'X Dental' }]
});

const note = sticky(
  '## UpSpark Prospect Collector (US + UAE)\n\nEvery 3 hours (while Pipeline Monitor says credits are OK) takes the next 2 unused searches from a segment x city plan (15 segments: clinics, real estate, restaurants, salons, law firms, gyms, e-commerce/Shopify, startups, SaaS, agencies, consultancies, interior design, construction; 10 US cities + Dubai / Abu Dhabi / Sharjah). 1 Tavily search each, directories/listicles/social dropped, then the company homepage + contact pages are read for free.\n\nKept only when: an email on the company\'s own domain is found (privacy/noreply/HR addresses dropped, info@/hello@/sales@ preferred) and the site confirms the country. Azure GPT writes a personalized subject containing the company name (checked; falls back to a template).\n\nAppends company_name, country, email, subject, website, segment to the **UpSpark Prospects (US + UAE)** sheet. No emails are sent here.',
  [pick, extract, writeSubject],
  { color: 6 }
);

export default workflow('upspark-prospect-collector', 'UpSpark Prospect Collector (US + UAE)')
  .add(manualStart)
  .to(getState)
  .add(every3h)
  .to(getState)
  .add(getState.to(creditsOk.onTrue(readSheet.to(getLog.to(pick.to(logClaim.to(restore.to(tavily.to(candidates.to(buildUrls.to(fetchPages.to(extract.to(writeSubject.to(finalize.to(append)))))))))))))))
  .add(note);
