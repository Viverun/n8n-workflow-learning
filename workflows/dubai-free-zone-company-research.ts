import { workflow, node, trigger, sticky, languageModel, tool, outputParser, expr, fromAi } from '@n8n/workflow-sdk';

const startTrigger = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Start Research Run', position: [0, 300] },
  output: [{}]
});

const defineMatrix = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Define Zone And Sector Matrix',
    position: [200, 300],
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'combos',
            name: 'combos',
            type: 'array',
            value: expr('{{ Object.entries({"DMCC - Dubai Multi Commodities Centre":{"url":"https://dmcc.ae/business-directory","sectors":["E-commerce","Logistics and Freight"]},"JAFZA - Jebel Ali Free Zone":{"url":"https://www.jafza.ae/search/","sectors":["Logistics and Freight","Retail","E-commerce","Food and Beverage"]},"DAFZA - Dubai Airport Free Zone":{"url":null,"sectors":["Logistics and Freight","E-commerce"]},"Dubai South":{"url":"https://dubaisouth.my.salesforce-sites.com/CompanyDirectory","sectors":["Logistics and Freight","E-commerce","Hospitality and Travel"]},"Dubai Internet City":{"url":"https://www.dic.ae/the-community/community-directory","sectors":["Technology and Software","E-commerce"]},"Dubai Media City":{"url":"https://dmc.ae/the-community/community-directory","sectors":["Marketing and Advertising","Technology and Software"]},"Dubai Silicon Oasis":{"url":"https://dso.ae/business-directory","sectors":["Technology and Software","E-commerce"]},"IFZA - International Free Zone Authority":{"url":null,"sectors":["Marketing and Advertising","E-commerce","Technology and Software","Hospitality and Travel","Food and Beverage","Retail"]},"Meydan Free Zone":{"url":null,"sectors":["Marketing and Advertising","E-commerce","Technology and Software","Hospitality and Travel"]} }).flatMap(e => e[1].sectors.map(s => ({ free_zone: e[0], sector: s, directory_url: e[1].url }))).sort(() => Math.random() - 0.5) }}')
          }
        ]
      }
    }
  },
  output: [{ combos: [{ free_zone: 'DMCC - Dubai Multi Commodities Centre', sector: 'Logistics and Freight', directory_url: 'https://dmcc.ae/business-directory' }] }]
});

const splitMatrix = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: {
    name: 'Split Matrix',
    position: [400, 300],
    parameters: {
      fieldToSplitOut: 'combos',
      include: 'noOtherFields',
      options: {}
    }
  },
  output: [{ free_zone: 'DMCC - Dubai Multi Commodities Centre', sector: 'Logistics and Freight', directory_url: 'https://dmcc.ae/business-directory' }]
});

const limitCombos = node({
  type: 'n8n-nodes-base.limit',
  version: 1,
  config: {
    name: 'Limit Combos Per Run',
    position: [560, 300],
    parameters: {
      maxItems: 3,
      keep: 'firstItems'
    }
  },
  output: [{ free_zone: 'DMCC - Dubai Multi Commodities Centre', sector: 'Logistics and Freight', directory_url: 'https://dmcc.ae/business-directory' }]
});

const azureModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatAzureOpenAi',
  version: 1,
  config: {
    name: 'Azure GPT-5 Mini',
    position: [880, 620],
    parameters: {
      model: 'gpt-5-mini',
      options: {
        timeout: 120000,
        maxRetries: 5
      }
    },
    credentials: { azureOpenAiApi: { id: 'RlTrqkjqaMvSzEIK', name: 'Azure Open AI account' } }
  }
});

const tavilySearch = tool({
  type: '@n8n/mcp-registry.tavily',
  version: 1.1,
  config: {
    name: 'Tavily Web Search',
    position: [700, 780],
    parameters: {
      include: 'selected',
      includeTools: ['tavily_search'],
      options: { timeout: 60000 }
    },
    credentials: { tavilyMcpOAuth2Api: { id: 'RdHnIwJ9wpXKYzQG', name: 'Tavily account' } }
  }
});

const firecrawlScrape = tool({
  type: 'n8n-nodes-base.httpRequestTool',
  version: 4.5,
  config: {
    name: 'Firecrawl Scrape Page',
    position: [1060, 780],
    parameters: {
      method: 'POST',
      url: 'https://api.firecrawl.dev/v2/scrape',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpCustomAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: {
        url: fromAi('url', 'The exact page URL to read, including https://'),
        formats: ['markdown'],
        onlyMainContent: true
      },
      options: {}
    },
    credentials: { httpCustomAuth: { id: 'KcVS45MRr31BDDAY', name: 'FireCrawl Web Crawl' } }
  }
});

const discoverySchema = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Discovered Companies Schema',
    position: [620, 620],
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{\n  "companies": [\n    {\n      "company_name": "Example Trading DMCC",\n      "website": "https://example.ae",\n      "free_zone": "DMCC - Dubai Multi Commodities Centre"\n    }\n  ]\n}',
      autoFix: true
    },
    subnodes: { model: azureModel }
  }
});

const discoverCompanies = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Discover Companies In Zone',
    position: [760, 300],
    retryOnFail: false,
    onError: 'continueRegularOutput',
    parameters: {
      promptType: 'define',
      text: expr('Sector: {{ $json.sector }}\nFree zone: {{ $json.free_zone }}\nDirectory URL: {{ $json.directory_url || "none available" }}\n\nName 1 company operating in this sector that is registered in this Dubai Free Zone.'),
      hasOutputParser: true,
      options: {
        maxIterations: 10,
        batching: { batchSize: 1, delayBetweenBatches: 5000 },
        systemMessage: 'You identify companies registered in Dubai Free Zones. You have two tools: Firecrawl Scrape Page (reads the literal content of one exact URL) and Tavily Web Search (searches the web). Never answer from memory alone — every company must come from a page you actually read or a search you actually ran.\n\n' +
          'This is a DISCOVERY step only. Return just the company name, official website, and free zone. Do NOT research emails, phone numbers, or contacts — a later step does that. Keep this step fast.\n\n' +
          '## WHERE TO LOOK FIRST\n' +
          'The user message gives a Directory URL when this free zone publishes its own public company directory. If one is given, your FIRST action must be to scrape it with Firecrawl Scrape Page. Read the result for a company whose listed activity or category matches the requested sector. A company found this way is already verified — the directory listing itself is the proof, so you do not need to search further for it.\n' +
          'Only fall back to Tavily Web Search if: the Directory URL is "none available", the scrape did not return a usable list of companies (a bare search box with no results, unrendered JavaScript, or a blocked page), or nothing in the directory matches the sector. In that case, use the search budget below.\n\n' +
          '## SCOPE\n' +
          'Include a company ONLY if it is registered, licensed, or operating in the specific Dubai Free Zone named in the user message.\n' +
          'REJECT companies from Abu Dhabi, Sharjah, Ajman, Ras Al Khaimah, Fujairah, Umm Al Quwain, any other emirate, or any other country.\n' +
          'REJECT Dubai mainland companies licensed by the DED (Department of Economy and Tourism). Free zone registration only.\n' +
          'A free zone entity carries a free zone legal suffix in its registered name: FZCO, FZE, FZ-LLC, FZ LLC, DMCC, DWC-LLC, or Limited. ' +
          'A name ending in plain LLC or L.L.C. is a mainland DED company, not a free zone one. REJECT it.\n' +
          'If the name you found carries no free zone suffix, find the full registered name that does. If there is none, OMIT the company.\n' +
          'Verify the free zone affiliation against the company website or the free zone member directory. If two searches do not confirm one specific candidate, DROP that candidate and move to a different company — do not keep searching for the same name.\n\n' +
          '## FIELDS\n' +
          'company_name: The full official registered name, including the legal suffix (DMCC, FZ-LLC, FZE, Limited) when part of the name.\n' +
          'website: The official company website, full URL including https://. Not a directory listing, not LinkedIn, not an aggregator profile. A company with no findable official website should be omitted — the next step needs it.\n' +
          'free_zone: Copy the free zone name from the user message EXACTLY as written. Do not abbreviate, expand, or reword it.\n\n' +
          '## SECTOR\n' +
          'The user names a sector. Every company you return must genuinely operate in that sector as its primary business. A company that merely serves that sector does not count.\n' +
          'EXCLUDE company formation agents, business setup consultancies, corporate services providers, PRO service firms, and accounting or audit practices — unless the named sector is explicitly one of those. These firms dominate search results for free zone terms and are not what this list is for.\n\n' +
          '## RULES\n' +
          'NEVER invent a company, a name, or a website. Every entry must come from a real source you visited.\n' +
          'Do not return the same company twice.\n' +
          'Favour ordinary operating businesses over the largest and most famous names in the zone.\n' +
          'Return the number asked for. If you can only verify fewer, return fewer. Never pad the list to reach the target.\n\n' +
          '## SEARCH BUDGET — ONE CANDIDATE AT A TIME (Tavily Web Search only; the directory scrape above does not count against this)\n' +
          'Never spend more than 2 Tavily Web Search calls trying to verify a single candidate company. If it has not verified after 2 searches, ABANDON that name completely and try a different company — do not repeat or rephrase a query for a name that is not working out. Chasing one stubborn candidate is the main way this task fails.\n' +
          'You have at most 6 Tavily Web Search calls in total for this whole task. Count them as you go. Your 6th search must be your last — after it, whatever you know, immediately call the final-answer tool.\n\n' +
          '## WHEN TO STOP AND GIVE UP\n' +
          'STOP SEARCHING the moment the budget above tells you to, and call the final-answer tool immediately — with a verified company if you found one, or an EMPTY companies array if not. An empty result is a correct, expected outcome for a hard zone/sector combination — it is NOT a failure, and it is far better than exhausting your iterations without ever answering. Never keep searching hoping the next query will work.\n\n' +
          'Return only the structured data in the required schema.'
      }
    },
    subnodes: { model: azureModel, tools: [firecrawlScrape, tavilySearch], outputParser: discoverySchema }
  },
  output: [{
    output: {
      companies: [{
        company_name: 'Example Trading DMCC',
        website: 'https://example.ae',
        free_zone: 'DMCC - Dubai Multi Commodities Centre'
      }]
    }
  }]
});

const splitDiscovered = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: {
    name: 'Split Discovered Companies',
    position: [860, 300],
    parameters: {
      fieldToSplitOut: 'output.companies',
      include: 'noOtherFields',
      options: {}
    }
  },
  output: [{
    company_name: 'Example Trading DMCC',
    website: 'https://example.ae',
    free_zone: 'DMCC - Dubai Multi Commodities Centre'
  }]
});

const contactSchema = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Company Contact Schema',
    position: [1140, 620],
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{\n  "email": "careers@example.ae",\n  "industry": "Commodities Trading",\n  "point_of_contact": "Jane Doe, HR Manager",\n  "contact_number": "+971 4 000 0000"\n}',
      autoFix: true
    },
    subnodes: { model: azureModel }
  }
});

const enrichCompany = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Enrich Company Contacts',
    position: [1080, 300],
    retryOnFail: false,
    onError: 'continueRegularOutput',
    parameters: {
      promptType: 'define',
      text: expr('Company: {{ $json.company_name }}\nWebsite: {{ $json.website }}\nFree zone: {{ $json.free_zone }}\n\nFind the business email, primary industry, a named point of contact, and a phone number for this one company.'),
      hasOutputParser: true,
      options: {
        maxIterations: 10,
        batching: { batchSize: 1, delayBetweenBatches: 5000 },
        systemMessage: 'You find published contact details for one specific company. You have two tools: Firecrawl Scrape Page (reads the literal text of one exact URL) and Tavily Web Search (searches the web to find which exact subpage to scrape). You MUST scrape at least one real page of this company’s site before reporting any contact detail. Never answer from memory alone.\n\n' +
          'You are given one company, already verified as registered in a Dubai Free Zone. Do not question that. Do not research other companies. Find contact details for this company only.\n\n' +
          '## FIELDS\n' +
          'email: A publicly listed business email for this company. Prefer, in this order: HR, recruitment, careers, hiring, then a general business address.\n' +
          'industry: The primary industry or business activity.\n' +
          'point_of_contact: A publicly listed person. Prefer HR, Recruitment, Talent Acquisition or Hiring staff; then Founder, CEO, Director or Manager; then any other named company contact. Format as "Name, Role" when both are known.\n' +
          'contact_number: A publicly listed UAE phone number for this company, written in international format starting +971.\n' +
          'This company operates in Dubai. A foreign number is the WRONG number even when it appears on the website — a French mobile (+33), a US area code (+1), or any other country code is not this company’s UAE contact. Output Not Found instead of a foreign number.\n' +
          'Check that the digits form a real UAE number: a landline is +971 4 followed by 7 digits, a mobile is +971 5X followed by 7 digits, a toll-free is 800 followed by 4 to 7 digits. If the number you found does not fit one of these shapes, it is malformed — output Not Found.\n\n' +
          '## WHERE TO LOOK\n' +
          'Start by scraping the homepage with Firecrawl Scrape Page. If the contact, careers, or team information is not there, use Tavily Web Search with a site-restricted query (for example: site:domain.com contact OR careers) to find the right subpage URL, then scrape that exact URL. Likely paths: /contact, /careers, /about, /team, and the page footer.\n\n' +
          '## ANTI-FABRICATION — the most important rule\n' +
          'NEVER invent, guess, infer, extrapolate, or construct any value. Every value must have been read from a real page you actually scraped.\n' +
          'You are specifically FORBIDDEN from building an email address out of a pattern. If the domain is example.ae, you must NOT output info@example.ae, hr@example.ae, or careers@example.ae unless you actually saw that exact address published on a scraped page.\n' +
          'You are specifically FORBIDDEN from guessing a phone number from a country or area code.\n' +
          'You are specifically FORBIDDEN from naming a person whose connection to this company you did not see stated.\n' +
          'When a field cannot be verified, output the exact string: Not Found\n' +
          'Returning Not Found is a CORRECT and GOOD answer. A plausible-looking invented email is a FAILURE. Never trade accuracy for completeness.\n\n' +
          '## EFFICIENCY\n' +
          'Do not spend unbounded effort. If a field resists verification after a reasonable search, record Not Found and finish.\n' +
          'Return only the structured data in the required schema. No commentary, no markdown, no source citations in the field values.'
      }
    },
    subnodes: { model: azureModel, tools: [firecrawlScrape, tavilySearch], outputParser: contactSchema }
  },
  output: [{
    output: {
      email: 'careers@example.ae',
      industry: 'Commodities Trading',
      point_of_contact: 'Jane Doe, HR Manager',
      contact_number: '+971 4 000 0000'
    }
  }]
});

const flattenRecord = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Flatten Company Record',
    position: [1320, 300],
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'company_name', name: 'company_name', type: 'string', value: expr('{{ $("Split Discovered Companies").item.json.company_name }}') },
          { id: 'website', name: 'website', type: 'string', value: expr('{{ $("Split Discovered Companies").item.json.website }}') },
          { id: 'email', name: 'email', type: 'string', value: expr('{{ $json.output?.email }}') },
          { id: 'industry', name: 'industry', type: 'string', value: expr('{{ $json.output?.industry }}') },
          { id: 'free_zone', name: 'free_zone', type: 'string', value: expr('{{ $("Split Discovered Companies").item.json.free_zone }}') },
          { id: 'point_of_contact', name: 'point_of_contact', type: 'string', value: expr('{{ $json.output?.point_of_contact }}') },
          { id: 'contact_number', name: 'contact_number', type: 'string', value: expr('{{ $json.output?.contact_number }}') }
        ]
      }
    }
  },
  output: [{
    company_name: 'Example Trading DMCC',
    website: 'https://example.ae',
    email: 'careers@example.ae',
    industry: 'Commodities Trading',
    free_zone: 'DMCC - Dubai Multi Commodities Centre',
    point_of_contact: 'Jane Doe, HR Manager',
    contact_number: '+971 4 000 0000'
  }]
});

const requireEmail = node({
  type: 'n8n-nodes-base.filter',
  version: 2.3,
  config: {
    name: 'Require Verified Email',
    position: [1520, 300],
    parameters: {
      conditions: {
        options: { caseSensitive: false, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [
          { id: 'email-present', leftValue: expr('{{ $json.email }}'), rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } },
          { id: 'email-looks-real', leftValue: expr('{{ $json.email }}'), rightValue: '@', operator: { type: 'string', operation: 'contains' } }
        ],
        combinator: 'and'
      },
      looseTypeValidation: true,
      options: { ignoreCase: true }
    }
  },
  output: [{
    company_name: 'Example Trading DMCC',
    website: 'https://example.ae',
    email: 'careers@example.ae',
    industry: 'Commodities Trading',
    free_zone: 'DMCC - Dubai Multi Commodities Centre',
    point_of_contact: 'Jane Doe, HR Manager',
    contact_number: 'Not Found'
  }]
});

const dropDuplicates = node({
  type: 'n8n-nodes-base.removeDuplicates',
  version: 2,
  config: {
    name: 'Drop Companies Already Saved',
    position: [1720, 300],
    parameters: {
      operation: 'removeItemsSeenInPreviousExecutions',
      logic: 'removeItemsWithAlreadySeenKeyValues',
      dedupeValue: expr('{{ $json.email.trim().toLowerCase().split("@")[1] }}'),
      options: { scope: 'workflow', historySize: 10000 }
    }
  },
  output: [{
    company_name: 'Example Trading DMCC',
    website: 'https://example.ae',
    email: 'careers@example.ae',
    industry: 'Commodities Trading',
    free_zone: 'DMCC - Dubai Multi Commodities Centre',
    point_of_contact: 'Jane Doe, HR Manager',
    contact_number: 'Not Found'
  }]
});

const appendToSheet = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Append Companies To Sheet',
    position: [1920, 300],
    parameters: {
      resource: 'sheet',
      operation: 'append',
      documentId: { __rl: true, mode: 'list', value: '137eRLDfGQGix-DeDY768ydDJycjUTgRNQzxDu0G70eA', cachedResultName: 'Dubai Free Zone Companies', cachedResultUrl: 'https://docs.google.com/spreadsheets/d/137eRLDfGQGix-DeDY768ydDJycjUTgRNQzxDu0G70eA/edit' },
      sheetName: { __rl: true, mode: 'list', value: '1458845809', cachedResultName: 'Companies', cachedResultUrl: 'https://docs.google.com/spreadsheets/d/137eRLDfGQGix-DeDY768ydDJycjUTgRNQzxDu0G70eA/edit#gid=1458845809' },
      columns: {
        mappingMode: 'autoMapInputData',
        value: {},
        schema: [
          { id: 'company_name', displayName: 'company_name', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'website', displayName: 'website', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'email', displayName: 'email', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'industry', displayName: 'industry', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'free_zone', displayName: 'free_zone', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'point_of_contact', displayName: 'point_of_contact', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'contact_number', displayName: 'contact_number', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false }
        ]
      },
      options: { cellFormat: 'RAW', handlingExtraData: 'insertInNewColumn' }
    },
    credentials: { googleSheetsOAuth2Api: { id: 'OH1NGutCEKtPnrEt', name: 'Google Sheets account' } }
  },
  output: [{ company_name: 'Example Trading DMCC', row_number: 2 }]
});

const setupNote = sticky(
  '## Dubai Free Zone Company Research\n\n**Azure OpenAI + real tools, not built-in search.** `Azure GPT-5 Mini` has no server-side web search of its own, so both agents get explicit tools instead: **Firecrawl Scrape Page** and **Tavily Web Search**. This is real agentic tool-calling — `maxIterations` now genuinely applies.\n\n**Directory-first discovery, to protect Tavily credits (1000/month).** `Define Zone And Sector Matrix` attaches each free zone\'s own public company directory URL where one exists (DMCC, JAFZA, Dubai South, Dubai Internet City, Dubai Media City, Dubai Silicon Oasis). `Discover Companies In Zone` scrapes that directory FIRST with Firecrawl — near-zero Tavily cost — and only falls back to a budget-capped Tavily search (max 2 calls per candidate, 6 total) when there is no directory (IFZA, DAFZA, Meydan Free Zone) or the scrape doesn\'t surface a sector match. Earlier runs without this cap burned ~10 Tavily searches per item by fixating on one hard-to-verify candidate instead of moving on — the per-candidate and total caps fix that.\n\n**Enrichment is scrape-first too.** `Enrich Company Contacts` reads the company\'s own site with Firecrawl first, falling back to Tavily only to locate the right subpage (e.g. /contact, /careers) when the homepage doesn\'t have it.\n\n**Tavily uses the native MCP integration, not a hand-built HTTP call.** `Tavily Web Search` is `@n8n/mcp-registry.tavily`, scoped to the `tavily_search` tool via the `Tavily account` (`tavilyMcpOAuth2Api`) credential.\n\n**Firecrawl has no native n8n node**, so `Firecrawl Scrape Page` stays a generic HTTP Request Tool (`genericAuthType: httpCustomAuth`) against the `FireCrawl Web Crawl` credential.\n\n**Separate quota from the old OpenAI rate-limit saga.** Azure OpenAI is billed and rate-limited independently of the OpenAI account that forced one-company-per-run pacing. Pacing here starts conservative (`delayBetweenBatches: 5000`) — raise `Limit Combos Per Run` gradually after a clean run, watching for errors at each step.\n\n**Zones and sectors are hand-matched.** `Define Zone And Sector Matrix` pairs each free zone only with sectors it genuinely hosts, then shuffles. DIFC and Dubai Healthcare City are deliberately absent — no overlap with the seven target sectors.\n\n**DMCC\'s directory terms note it should not be used for email/telephone marketing** — scraping it anyway was an explicit call by the workflow owner, not an oversight.\n\n**Scope tests that bite:** discovery rejects names ending in plain LLC (a mainland DED marker) while accepting real free zone suffixes such as DWC-LLC, FZCO and FZE; enrichment requires a +971 phone in a valid UAE shape and writes Not Found otherwise.\n\n**Email required, phone optional.** Dedup keys on email domain, after the filter.\n\n**Sheet writes are RAW.** Do not switch to USER_ENTERED — phone numbers start with `+` and Sheets parses them as formulas.',
  [appendToSheet],
  { color: 4, position: [0, -40], width: 820, height: 460 }
);

export default workflow('dubai-free-zone-company-research', 'Dubai Free Zone Company Research')
  .add(startTrigger)
  .to(defineMatrix)
  .to(splitMatrix)
  .to(limitCombos)
  .to(discoverCompanies)
  .to(splitDiscovered)
  .to(enrichCompany)
  .to(flattenRecord)
  .to(requireEmail)
  .to(dropDuplicates)
  .to(appendToSheet)
  .add(setupNote);
