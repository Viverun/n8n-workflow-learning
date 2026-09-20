import { workflow, node, trigger, sticky, expr } from '@n8n/workflow-sdk';

const startSetup = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Run Setup Once', position: [0, 300] },
  output: [{}]
});

const createSpreadsheet = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Create Spreadsheet',
    position: [240, 300],
    parameters: {
      resource: 'spreadsheet',
      operation: 'create',
      title: 'Dubai Free Zone Companies',
      sheetsUi: {
        sheetValues: [
          { title: 'Companies', hidden: false }
        ]
      },
      options: {}
    },
    credentials: { googleSheetsOAuth2Api: { id: 'OH1NGutCEKtPnrEt', name: 'Google Sheets account' } }
  },
  output: [{ spreadsheetId: '1AbCdEfGhIjKlMnOpQrStUvWxYz', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit' }]
});

const writeHeaders = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Write Header Row',
    position: [480, 300],
    parameters: {
      method: 'PUT',
      url: expr('https://sheets.googleapis.com/v4/spreadsheets/{{ $json.spreadsheetId }}/values/Companies!A1:G1'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleSheetsOAuth2Api',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'valueInputOption', value: 'RAW' }
        ]
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: '{\n  "values": [\n    ["company_name", "website", "email", "industry", "free_zone", "point_of_contact", "contact_number"]\n  ]\n}',
      options: {}
    },
    credentials: { googleSheetsOAuth2Api: { id: 'OH1NGutCEKtPnrEt', name: 'Google Sheets account' } }
  },
  output: [{ spreadsheetId: '1AbCdEfGhIjKlMnOpQrStUvWxYz', updatedRange: 'Companies!A1:G1', updatedColumns: 7 }]
});

const setupNote = sticky(
  '## One-time setup\n\nCreates the **Dubai Free Zone Companies** spreadsheet with a `Companies` tab and writes the seven header columns.\n\nAlready run once, producing spreadsheet `137eRLDfGQGix-DeDY768ydDJycjUTgRNQzxDu0G70eA`, which **Dubai Free Zone Company Research** now points at.\n\nSafe to leave here as a record. Running it again creates a second, separate spreadsheet.',
  [createSpreadsheet],
  { color: 3, position: [0, 40], width: 620, height: 200 }
);

export default workflow('dubai-free-zone-sheet-setup', 'Dubai Free Zone Sheet Setup')
  .add(startSetup)
  .to(createSpreadsheet)
  .to(writeHeaders)
  .add(setupNote);
