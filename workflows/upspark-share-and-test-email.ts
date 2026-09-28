import { workflow, node, trigger, expr, sticky } from '@n8n/workflow-sdk';

const SHEET_ID = '17-xFB3WbayS_cWPAXaLX_u8KBe_VlaDh3o4OksKsyNY';
const GSHEETS = { googleSheetsOAuth2Api: { id: 'OH1NGutCEKtPnrEt', name: 'Google Sheets account' } };
const TEST_TO = 'khanjamilahmed202@gmail.com';

const start = trigger({ type: 'n8n-nodes-base.manualTrigger', version: 1, config: { name: 'Run Once' } });

const share = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Share Sheet (anyone with link = editor)',
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: 'https://www.googleapis.com/drive/v3/files/' + SHEET_ID + '/permissions',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleSheetsOAuth2Api',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: '{"role":"writer","type":"anyone","allowFileDiscovery":false}',
      options: { timeout: 20000 }
    },
    credentials: GSHEETS
  },
  output: [{ id: 'anyoneWithLink', type: 'anyone', role: 'writer' }]
});

const owner = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Sheet Owner Account',
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: 'https://www.googleapis.com/drive/v3/about?fields=user',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleSheetsOAuth2Api',
      options: { timeout: 20000 }
    },
    credentials: GSHEETS
  },
  output: [{ user: { emailAddress: 'owner@example.com' } }]
});

const getBody = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Get Email Body',
    parameters: {
      method: 'GET',
      url: 'https://raw.githubusercontent.com/Viverun/n8n-workflow-learning/claude/compassionate-curie-9053ac/assets/email/upspark_outreach.html',
      options: { timeout: 20000 }
    }
  },
  output: [{ data: '<html>Hi team</html>' }]
});

const readSheet = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Read Prospects Sheet',
    parameters: {
      resource: 'sheet',
      operation: 'read',
      documentId: { __rl: true, mode: 'id', value: SHEET_ID },
      sheetName: { __rl: true, mode: 'id', value: '1226409885' },
      options: {}
    },
    credentials: GSHEETS
  },
  output: [{ row_number: 2, company_name: '209 NYC Dental', subject: '209 NYC Dental: more bookings?' }]
});

const build = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Build Test Email', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: `
// One email only, to the internal test address. Uses the first prospect row's real subject + company name.
const row = $input.all().map(i => i.json).find(r => r.company_name) || { company_name: 'Example Company', subject: 'Example Company: a quick idea for your website' };
const tag = '{'.repeat(2) + 'company_name' + '}'.repeat(2);
const html = String($('Get Email Body').first().json.data || '').split(tag).join(row.company_name);
return [{ json: { to: 'khanjamilahmed202@gmail.com', subject: '[TEST] ' + (row.subject || row.company_name), html, company: row.company_name } }];
` } },
  output: [{ to: 'test@example.com', subject: '[TEST] X', html: '<p>x</p>', company: 'X' }]
});

const send = node({
  type: 'n8n-nodes-base.emailSend',
  version: 2.1,
  config: {
    name: 'Send Test Email',
    parameters: {
      resource: 'email',
      operation: 'send',
      fromEmail: 'UpSpark <marketing@upspark.net>',
      toEmail: expr('{{ $json.to }}'),
      subject: expr('{{ $json.subject }}'),
      emailFormat: 'html',
      html: expr('{{ $json.html }}'),
      options: { appendAttribution: false }
    },
    credentials: { smtp: { id: 'URYotWhOU6Ejz9BW', name: 'SMTP account' } }
  },
  output: [{ accepted: ['test@example.com'] }]
});

const note = sticky(
  '## One-off: share sheet + test email\n\n1. Shares **UpSpark Prospects (US + UAE)** so anyone with the link can edit.\n2. Reports which Google account owns the sheet.\n3. Sends ONE test email from marketing@upspark.net to ' + TEST_TO + ' using the first prospect row\'s personalized subject (prefixed [TEST]) and the draft body. No prospect is emailed and no sheet row is changed.',
  [share, send],
  { color: 3 }
);

export default workflow('upspark-share-and-test-email', 'UpSpark: Share Sheet + Test Email')
  .add(start)
  .to(share.to(owner.to(getBody.to(readSheet.to(build.to(send))))))
  .add(note);
