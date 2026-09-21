import { workflow, node, trigger, sticky, languageModel, outputParser, expr } from '@n8n/workflow-sdk';

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
            value: expr('{{ Object.entries({"DMCC - Dubai Multi Commodities Centre":["Retail","E-commerce","Food and Beverage","Logistics and Freight"],"JAFZA - Jebel Ali Free Zone":["Logistics and Freight","Retail","E-commerce","Food and Beverage"],"DAFZA - Dubai Airport Free Zone":["Logistics and Freight","E-commerce"],"Dubai South":["Logistics and Freight","E-commerce","Hospitality and Travel"],"Dubai Internet City":["Technology and Software","E-commerce"],"Dubai Media City":["Marketing and Advertising","Technology and Software"],"Dubai Silicon Oasis":["Technology and Software","E-commerce"],"IFZA - International Free Zone Authority":["Marketing and Advertising","E-commerce","Technology and Software","Hospitality and Travel","Food and Beverage","Retail"],"Meydan Free Zone":["Marketing and Advertising","E-commerce","Technology and Software","Hospitality and Travel"]}).flatMap(e => e[1].map(s => ({ free_zone: e[0], sector: s }))).sort(() => Math.random() - 0.5) }}')
          }
        ]
      }
    }
  },
  output: [{ combos: [{ free_zone: 'DMCC - Dubai Multi Commodities Centre', sector: 'Logistics and Freight' }] }]
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
  output: [{ free_zone: 'DMCC - Dubai Multi Commodities Centre', sector: 'Logistics and Freight' }]
});

const limitCombos = node({
  type: 'n8n-nodes-base.limit',
  version: 1,
  config: {
    name: 'Limit Combos Per Run',
    position: [560, 300],
    parameters: {
      maxItems: 20,
      keep: 'firstItems'
    }
  },
  output: [{ free_zone: 'DMCC - Dubai Multi Commodities Centre', sector: 'Logistics and Freight' }]
});

const openAiModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'GPT-5.4 Mini Web Search',
    position: [880, 600],
    parameters: {
      model: { __rl: true, mode: 'list', value: 'gpt-5.4-mini', cachedResultName: 'gpt-5.4-mini' },
      responsesApiEnabled: true,
      builtInTools: {
        webSearch: {
          searchContextSize: 'low',
          country: 'AE',
          city: 'Dubai',
          region: 'Dubai'
        }
      },
      options: {
        reasoningEffort: 'low',
        maxRetries: 0,
        timeout: 600000
      }
    },
    credentials: { openAiApi: { id: 'LcSKl7EB0pYld3oq', name: 'OpenAI account' } }
  }
});

const discoverySchema = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Discovered Companies Schema',
    position: [620, 600],
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{\n  "companies": [\n    {\n      "company_name": "Example Trading DMCC",\n      "website": "https://example.ae",\n      "free_zone": "DMCC - Dubai Multi Commodities Centre"\n    }\n  ]\n}',
      autoFix: true
    },
    subnodes: { model: openAiModel }
  }
});

const discoverCompanies = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Discover Companies In Zone',
    position: [760, 300],
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 5000,
    parameters: {
      promptType: 'define',
      text: expr('Sector: {{ $json.sector }}\nFree zone: {{ $json.free_zone }}\n\nList 3 companies operating in this sector that are registered in this Dubai Free Zone.'),
      hasOutputParser: true,
      options: {
        maxIterations: 10,
        batching: { batchSize: 1, delayBetweenBatches: 60000 },
        systemMessage: 'You identify companies registered in Dubai Free Zones. You have a web search tool. You MUST use it. Never answer from memory alone.\n\n' +
          'This is a DISCOVERY step only. Return just the company name, official website, and free zone. Do NOT research emails, phone numbers, or contacts — a later step does that. Keep this step fast.\n\n' +
          '## SCOPE\n' +
          'Include a company ONLY if it is registered, licensed, or operating in the specific Dubai Free Zone named in the user message.\n' +
          'REJECT companies from Abu Dhabi, Sharjah, Ajman, Ras Al Khaimah, Fujairah, Umm Al Quwain, any other emirate, or any other country.\n' +
          'REJECT Dubai mainland companies licensed by the DED (Department of Economy and Tourism). Free zone registration only.\n' +
          'A free zone entity carries a free zone legal suffix in its registered name: FZCO, FZE, FZ-LLC, FZ LLC, DMCC, DWC-LLC, or Limited. ' +
          'A name ending in plain LLC or L.L.C. is a mainland DED company, not a free zone one. REJECT it.\n' +
          'If the name you found carries no free zone suffix, find the full registered name that does. If there is none, OMIT the company.\n' +
          'Verify the free zone affiliation against the company website or the free zone member directory. If you cannot verify it, OMIT the company.\n\n' +
          '## FIELDS\n' +
          'company_name: The full official registered name, including the legal suffix (DMCC, FZ-LLC, FZE, Limited) when part of the name.\n' +
          'website: The official company website, full URL including https://. Not a directory listing, not LinkedIn, not an aggregator profile. A company with no findable official website should be omitted — the next step needs it.\n' +
          'free_zone: Copy the free zone name from the user message EXACTLY as written. Do not abbreviate, expand, or reword it.\n\n' +
          '## SECTOR\n' +
          'The user names a sector. Every company you return must genuinely operate in that sector as its primary business. A company that merely serves that sector does not count.\n' +
          'EXCLUDE company formation agents, business setup consultancies, corporate services providers, PRO service firms, and accounting or audit practices \u2014 unless the named sector is explicitly one of those. These firms dominate search results for free zone terms and are not what this list is for.\n\n' +
          '## RULES\n' +
          'NEVER invent a company, a name, or a website. Every entry must come from a real source you visited.\n' +
          'Do not return the same company twice.\n' +
          'Favour ordinary operating businesses over the largest and most famous names in the zone.\n' +
          'Return the number asked for. If you can only verify fewer, return fewer. Never pad the list to reach the target.\n' +
          'Return only the structured data in the required schema.'
      }
    },
    subnodes: { model: openAiModel, outputParser: discoverySchema }
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
    position: [1140, 600],
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{\n  "email": "careers@example.ae",\n  "industry": "Commodities Trading",\n  "point_of_contact": "Jane Doe, HR Manager",\n  "contact_number": "+971 4 000 0000"\n}',
      autoFix: true
    },
    subnodes: { model: openAiModel }
  }
});

const enrichCompany = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Enrich Company Contacts',
    position: [1080, 300],
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 5000,
    onError: 'continueRegularOutput',
    parameters: {
      promptType: 'define',
      text: expr('Company: {{ $json.company_name }}\nWebsite: {{ $json.website }}\nFree zone: {{ $json.free_zone }}\n\nFind the business email, primary industry, a named point of contact, and a phone number for this one company.'),
      hasOutputParser: true,
      options: {
        maxIterations: 10,
        batching: { batchSize: 1, delayBetweenBatches: 60000 },
        systemMessage: 'You find published contact details for one specific company. You have a web search tool. You MUST use it. Never answer from memory alone.\n\n' +
          'You are given one company, already verified as registered in a Dubai Free Zone. Do not question that. Do not research other companies. Find contact details for this company only.\n\n' +
          '## FIELDS\n' +
          'email: A publicly listed business email for this company. Prefer, in this order: HR, recruitment, careers, hiring, then a general business address.\n' +
          'industry: The primary industry or business activity.\n' +
          'point_of_contact: A publicly listed person. Prefer HR, Recruitment, Talent Acquisition or Hiring staff; then Founder, CEO, Director or Manager; then any other named company contact. Format as "Name, Role" when both are known.\n' +
          'contact_number: A publicly listed UAE phone number for this company, written in international format starting +971.\n' +
          'This company operates in Dubai. A foreign number is the WRONG number even when it appears on the website \u2014 a French mobile (+33), a US area code (+1), or any other country code is not this company\u0027s UAE contact. Output Not Found instead of a foreign number.\n' +
          'Check that the digits form a real UAE number: a landline is +971 4 followed by 7 digits, a mobile is +971 5X followed by 7 digits, a toll-free is 800 followed by 4 to 7 digits. If the number you found does not fit one of these shapes, it is malformed \u2014 output Not Found.\n\n' +
          '## WHERE TO LOOK\n' +
          "Check the company website's contact page, careers page, about page, team page, and footer. These are where published addresses actually live.\n" +
          '\n' +
          '## ANTI-FABRICATION — the most important rule\n' +
          'NEVER invent, guess, infer, extrapolate, or construct any value. Every value must have been read from a real source you actually visited.\n' +
          'You are specifically FORBIDDEN from building an email address out of a pattern. If the domain is example.ae, you must NOT output info@example.ae, hr@example.ae, or careers@example.ae unless you actually saw that exact address published on a real page.\n' +
          'You are specifically FORBIDDEN from guessing a phone number from a country or area code.\n' +
          'You are specifically FORBIDDEN from naming a person whose connection to this company you did not see stated.\n' +
          'When a field cannot be verified, output the exact string: Not Found\n' +
          'Returning Not Found is a CORRECT and GOOD answer. A plausible-looking invented email is a FAILURE. Never trade accuracy for completeness.\n\n' +
          '## EFFICIENCY\n' +
          'Do not spend unbounded effort. If a field resists verification after a reasonable search, record Not Found and finish.\n' +
          'Return only the structured data in the required schema. No commentary, no markdown, no source citations in the field values.'
      }
    },
    subnodes: { model: openAiModel, outputParser: contactSchema }
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
  '## Dubai Free Zone Company Research\n\n**Two phases.** `Discover Companies In Zone` makes one light call per free zone returning only names and websites. `Enrich Company Contacts` then makes one small call per company for email, industry, contact and phone. Every call stays bounded, so volume scales without hitting timeouts or rate limits.\n\n**Email is required, phone is not.** Rows without a real email address are dropped. `contact_number` may be `Not Found` and still saves.\n\n**Dedup keys on email domain**, after the filter, so only rows that reach the sheet are recorded as seen.\n\n**Sheet writes are RAW.** Do not switch to USER_ENTERED — phone numbers start with `+` and Sheets parses them as formulas, producing `#ERROR!`.\n\n**Pacing is the rate-limit guard.** A web-search call costs roughly 85k tokens, measured from run 129 where 2 calls used 170,430, against a fixed 200k tokens-per-minute ceiling. Both agents wait 60s between calls, so one call lands per rolling minute and the window peaks near 125k. 30s put two calls in a minute and failed. If a run hits a rate limit, raise `delayBetweenBatches` — do not change anything else first.\n\n**Zones and sectors are hand-matched.** `Define Zone And Sector Matrix` pairs each free zone only with sectors it genuinely hosts, then shuffles. Asking a zone for a sector it does not have makes the model search exhaustively and burns the token budget.\n\nTo test cheaply, lower `maxItems` in **Limit Combos Per Run**.',
  [appendToSheet],
  { color: 4, position: [0, -40], width: 760, height: 340 }
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
