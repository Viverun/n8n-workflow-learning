import { workflow, node, trigger, sticky, languageModel, outputParser, expr } from '@n8n/workflow-sdk';

const startTrigger = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Start Research Run', position: [0, 300] },
  output: [{}]
});

const defineZones = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Define Dubai Free Zones',
    position: [220, 300],
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'zones',
            name: 'zones',
            type: 'array',
            value: expr('{{ ["DMCC - Dubai Multi Commodities Centre", "JAFZA - Jebel Ali Free Zone", "DIFC - Dubai International Financial Centre", "Dubai Internet City", "Dubai Media City", "DAFZA - Dubai Airport Free Zone", "Dubai Silicon Oasis", "Dubai South", "IFZA - International Free Zone Authority", "Meydan Free Zone", "Dubai Healthcare City"] }}')
          }
        ]
      }
    }
  },
  output: [{ zones: ['DMCC - Dubai Multi Commodities Centre', 'JAFZA - Jebel Ali Free Zone'] }]
});

const splitZones = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: {
    name: 'Split Zones',
    position: [440, 300],
    parameters: {
      fieldToSplitOut: 'zones',
      include: 'noOtherFields',
      options: { destinationFieldName: 'free_zone' }
    }
  },
  output: [{ free_zone: 'DMCC - Dubai Multi Commodities Centre' }]
});

const openAiModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'GPT-5.4 Mini Web Search',
    position: [620, 540],
    parameters: {
      model: { __rl: true, mode: 'list', value: 'gpt-5.4-mini', cachedResultName: 'gpt-5.4-mini' },
      responsesApiEnabled: true,
      builtInTools: {
        webSearch: {
          searchContextSize: 'high',
          country: 'AE',
          city: 'Dubai',
          region: 'Dubai'
        }
      },
      options: {
        reasoningEffort: 'medium',
        maxRetries: 3,
        timeout: 180000
      }
    },
    credentials: { openAiApi: { id: 'LcSKl7EB0pYld3oq', name: 'OpenAI account' } }
  }
});

const companySchema = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Company Records Schema',
    position: [820, 540],
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{\n  "companies": [\n    {\n      "company_name": "Example Trading DMCC",\n      "website": "https://example.ae",\n      "email": "careers@example.ae",\n      "industry": "Commodities Trading",\n      "free_zone": "DMCC - Dubai Multi Commodities Centre",\n      "point_of_contact": "Jane Doe, HR Manager",\n      "contact_number": "+971 4 000 0000"\n    }\n  ]\n}',
      autoFix: true
    },
    subnodes: { model: openAiModel }
  }
});

const researchAgent = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Research Free Zone Companies',
    position: [680, 300],
    parameters: {
      promptType: 'define',
      text: expr('Find 10 companies registered in this Dubai Free Zone: {{ $json.free_zone }}\n\nUse the web search tool for every company. Return only companies whose affiliation with this exact free zone you have verified from a real source.'),
      hasOutputParser: true,
      options: {
        maxIterations: 30,
        batching: { batchSize: 1, delayBetweenBatches: 2000 },
        systemMessage: 'You are a B2B research analyst who compiles verified company records for Dubai Free Zone companies. You have a web search tool. You MUST use it. You must never answer from memory alone.\n\n' +
          '## SCOPE — Dubai Free Zones only\n' +
          'Include a company ONLY if it is registered, licensed, or operating in the specific Dubai Free Zone named in the user message.\n' +
          'REJECT companies from Abu Dhabi, Sharjah, Ajman, Ras Al Khaimah, Fujairah, Umm Al Quwain, any other emirate, or any other country.\n' +
          'REJECT Dubai mainland companies licensed by the DED (Department of Economy and Tourism). Free zone registration only.\n' +
          'If you cannot verify that a company belongs to the named Dubai Free Zone, OMIT that company entirely. Do not include it with a guess.\n\n' +
          '## FIELDS — collect all seven for every company\n' +
          'company_name: The full official registered company name, including the legal suffix (DMCC, FZ-LLC, FZE, Limited) when it is part of the name.\n' +
          'website: The official company website. Full URL including https://. Not a directory listing, not a LinkedIn page, not an aggregator profile.\n' +
          'industry: The primary industry or business activity of the company.\n' +
          'free_zone: Copy the free zone name from the user message EXACTLY as written. Do not abbreviate, expand, or reword it.\n' +
          'email: A publicly listed business email. Prefer, in this order: HR, recruitment, careers, hiring, then a general business address such as info@ or contact@.\n' +
          'point_of_contact: A publicly listed person. Prefer, in this order: HR, Recruitment, Talent Acquisition, or Hiring staff; then Founder, CEO, Director, or Manager; then any other relevant named company contact. Format as "Name, Role" when both are known.\n' +
          'contact_number: A publicly listed company or relevant contact phone number, in international format where possible.\n\n' +
          '## FIELD PRIORITY\n' +
          "email is the most valuable field. Records that reach the end of this pipeline without a real email address are DISCARDED and never saved, so spend your research effort on finding and confirming a genuine published email for every company. Check the company's contact page, careers page, about page, and footer.\n" +
          'This is a reason to research email thoroughly. It is NEVER a reason to invent one. An invented email is far worse than a discarded record.\n' +
          'contact_number is OPTIONAL. Not Found is completely acceptable there and the record will still be saved.\n\n' +
          '## ANTI-FABRICATION — this is the most important rule\n' +
          'NEVER invent, guess, infer, extrapolate, or construct any value. Every value you output must have been read from a real source you actually visited.\n' +
          'You are specifically FORBIDDEN from building an email address out of a pattern. If the domain is example.ae, you must NOT output info@example.ae, hr@example.ae, or careers@example.ae unless you actually saw that exact address published.\n' +
          'You are specifically FORBIDDEN from guessing a phone number from a country or area code.\n' +
          'You are specifically FORBIDDEN from naming a person whose connection to the company you did not see stated.\n' +
          'When a field cannot be verified, output the exact string: Not Found\n' +
          'A record full of Not Found values is a CORRECT and GOOD answer. A record with a plausible-looking invented email is a FAILURE. Never trade accuracy for completeness.\n\n' +
          '## OTHER RULES\n' +
          'Prefer the official company website. Free zone member directories are acceptable for confirming free zone affiliation.\n' +
          'Do not include the same company twice. Check company_name against the records you have already produced.\n' +
          'Aim for 10 companies. If you can only verify fewer, return fewer. Never pad the list with unverified entries to reach the target.\n' +
          'Return only the structured data in the required schema. No commentary, no markdown, no extra fields, no source citations in the field values.'
      }
    },
    subnodes: { model: openAiModel, outputParser: companySchema }
  },
  output: [{
    output: {
      companies: [{
        company_name: 'Example Trading DMCC',
        website: 'https://example.ae',
        email: 'careers@example.ae',
        industry: 'Commodities Trading',
        free_zone: 'DMCC - Dubai Multi Commodities Centre',
        point_of_contact: 'Jane Doe, HR Manager',
        contact_number: '+971 4 000 0000'
      }]
    }
  }]
});

const splitCompanies = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: {
    name: 'Split Companies Into Rows',
    position: [940, 300],
    parameters: {
      fieldToSplitOut: 'output.companies',
      include: 'noOtherFields',
      options: {}
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

const dropDuplicates = node({
  type: 'n8n-nodes-base.removeDuplicates',
  version: 2,
  config: {
    name: 'Drop Companies Already Saved',
    position: [1160, 300],
    parameters: {
      operation: 'removeItemsSeenInPreviousExecutions',
      logic: 'removeItemsWithAlreadySeenKeyValues',
      dedupeValue: expr('{{ $json.company_name }}'),
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
    contact_number: '+971 4 000 0000'
  }]
});

const requireEmail = node({
  type: 'n8n-nodes-base.filter',
  version: 2.3,
  config: {
    name: 'Require Verified Email',
    position: [1380, 300],
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
      options: { ignoreCase: true, looseTypeValidation: true }
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
    position: [1600, 300],
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
      options: { cellFormat: 'USER_ENTERED', handlingExtraData: 'insertInNewColumn' }
    },
    credentials: { googleSheetsOAuth2Api: { id: 'OH1NGutCEKtPnrEt', name: 'Google Sheets account' } }
  },
  output: [{ company_name: 'Example Trading DMCC', row_number: 2 }]
});

const setupNote = sticky(
  '## Dubai Free Zone Company Research\n\nTarget sheet is already wired up: **Dubai Free Zone Companies** \u2192 `Companies` tab, headers written. Nothing to pick.\n\n**Email is required, phone is not.** `Require Verified Email` drops any company without a real email address, so fewer rows reach the sheet than the agent researches. `contact_number` may be `Not Found` and will still be saved.\n\nTo test cheaply, edit **Define Dubai Free Zones** and cut the list down to a single zone before running. The full list is 11 zones \u00d7 ~10 companies, and every run costs OpenAI web-search tokens.\n\nRe-runs never duplicate: `Drop Companies Already Saved` remembers `company_name` across executions.',
  [appendToSheet],
  { color: 4, position: [0, -20], width: 720, height: 300 }
);

export default workflow('dubai-free-zone-company-research', 'Dubai Free Zone Company Research')
  .add(startTrigger)
  .to(defineZones)
  .to(splitZones)
  .to(researchAgent)
  .to(splitCompanies)
  .to(dropDuplicates)
  .to(requireEmail)
  .to(appendToSheet)
  .add(setupNote);
