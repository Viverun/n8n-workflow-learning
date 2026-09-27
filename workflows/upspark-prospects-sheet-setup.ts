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
      title: 'UpSpark Prospects (US + UAE)',
      sheetsUi: {
        sheetValues: [
          { title: 'Prospects', hidden: false }
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
      url: expr('https://sheets.googleapis.com/v4/spreadsheets/{{ $json.spreadsheetId }}/values/Prospects!A1:H1'),
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
      jsonBody: '{\n  "values": [\n    ["company_name", "country", "email", "subject", "website", "segment", "send", "sent_at"]\n  ]\n}',
      options: {}
    },
    credentials: { googleSheetsOAuth2Api: { id: 'OH1NGutCEKtPnrEt', name: 'Google Sheets account' } }
  },
  output: [{ spreadsheetId: '1AbCdEfGhIjKlMnOpQrStUvWxYz', updatedRange: 'Prospects!A1:H1', updatedColumns: 8 }]
});

const setupNote = sticky(
  '## One-time setup\n\nCreates the **UpSpark Prospects (US + UAE)** spreadsheet with a `Prospects` tab and the header row:\ncompany_name, country, email, subject, website, segment, send, sent_at.\n\nThe collector and the sender point at the spreadsheet this produced. Running it again creates a second, separate spreadsheet.',
  [createSpreadsheet],
  { color: 3, position: [0, 40], width: 620, height: 200 }
);

export default workflow('upspark-prospects-sheet-setup', 'UpSpark Prospects Sheet Setup')
  .add(startSetup)
  .to(createSpreadsheet)
  .to(writeHeaders)
  .add(setupNote);
