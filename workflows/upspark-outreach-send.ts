import { workflow, node, trigger, expr, ifElse, sticky } from '@n8n/workflow-sdk';

const SHEET_DOC = { __rl: true, mode: 'id', value: '17-xFB3WbayS_cWPAXaLX_u8KBe_VlaDh3o4OksKsyNY', cachedResultName: 'UpSpark Prospects (US + UAE)' };
const SHEET_TAB = { __rl: true, mode: 'id', value: '1226409885', cachedResultName: 'Prospects' };
const GSHEETS = { googleSheetsOAuth2Api: { id: 'OH1NGutCEKtPnrEt', name: 'Google Sheets account' } };
const ROW_SCHEMA = [
  { id: 'row_number', displayName: 'row_number', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true, readOnly: true },
  { id: 'sent_at', displayName: 'sent_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false }
];

const every30 = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.2,
  config: { name: 'Every 30 Minutes', parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 30 }] } } }
});

const getTemplate = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Get Email Body',
    executeOnce: true,
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
    executeOnce: true,
    parameters: { resource: 'sheet', operation: 'read', documentId: SHEET_DOC, sheetName: SHEET_TAB, options: {} },
    credentials: GSHEETS
  },
  output: [{ row_number: 2, company_name: 'X', country: 'United States', email: 'info@x.com', subject: 'X: an idea', send: 'Yes', sent_at: '' }]
});

const pick = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Pick Approved Rows', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: `
// Rows marked send=Yes and not yet sent. Max 10 per Dubai day, 2 per run, only 09:00-18:00 Dubai time.
const DAILY = 10, PER_RUN = 2;
const now = $now.setZone('Asia/Dubai');
if (now.hour < 9 || now.hour >= 18) return [];
const rows = $input.all().map(i => i.json);
const today = now.toISODate();
const isSent = v => /^\\d{4}-\\d{2}-\\d{2}/.test(String(v || ''));
const sentToday = rows.filter(r => String(r.sent_at || '').startsWith(today)).length;
const sentEmails = new Set(rows.filter(r => isSent(r.sent_at)).map(r => String(r.email || '').trim().toLowerCase()));
const cap = Math.max(0, Math.min(PER_RUN, DAILY - sentToday));
const out = [];
const seen = new Set();
for (const r of rows) {
  if (out.filter(o => !o.json.skip).length >= cap) break;
  if (String(r.send || '').trim().toLowerCase() !== 'yes') continue;
  if (String(r.sent_at || '').trim()) continue;
  const e = String(r.email || '').trim().toLowerCase();
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(e)) { out.push({ json: { row_number: r.row_number, email: e, skip: 'SKIPPED - invalid email' } }); continue; }
  if (sentEmails.has(e) || seen.has(e)) { out.push({ json: { row_number: r.row_number, email: e, skip: 'SKIPPED - email already sent' } }); continue; }
  seen.add(e);
  const company = String(r.company_name || '').trim();
  const subject = String(r.subject || '').trim() || (company ? company + ': a quick idea for your website' : 'A quick idea for your website');
  out.push({ json: { row_number: r.row_number, email: e, domain: e.split('@')[1], company, subject, skip: '' } });
}
return out;
` } },
  output: [{ row_number: 2, email: 'info@x.com', domain: 'x.com', company: 'X', subject: 'X: an idea', skip: '' }]
});

const skipRow = ifElse({
  version: 2.2,
  config: {
    name: 'Skip Row?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.skip }}'), operator: { type: 'string', operation: 'notEmpty', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

const markSkipped = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Mark Skipped',
    parameters: {
      resource: 'sheet', operation: 'update', documentId: SHEET_DOC, sheetName: SHEET_TAB,
      columns: { mappingMode: 'defineBelow', value: { row_number: expr('{{ $json.row_number }}'), sent_at: expr('{{ $json.skip }}') }, matchingColumns: ['row_number'], schema: ROW_SCHEMA },
      options: { cellFormat: 'RAW' }
    },
    credentials: GSHEETS
  },
  output: [{ row_number: 2 }]
});

const mxLookup = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'MX Lookup',
    onError: 'continueRegularOutput',
    parameters: { method: 'GET', url: expr("{{ 'https://dns.google/resolve?type=MX&name=' + $json.domain }}"), options: { timeout: 15000 } }
  },
  output: [{ Status: 0, Answer: [{ type: 15, data: '10 mx.x.com.' }] }]
});

const checkMx = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Check Mail Server', parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: `
const src = $('Pick Approved Rows').item.json;
const j = $json || {};
const ok = j.Status === 0 && Array.isArray(j.Answer) && j.Answer.some(a => a.type === 15 && !/^0 \\.?$/.test(String(a.data).trim()));
return { json: { ...src, mx_ok: ok } };
` } },
  output: [{ row_number: 2, email: 'info@x.com', company: 'X', subject: 'X: an idea', mx_ok: true }]
});

const canReceive = ifElse({
  version: 2.2,
  config: {
    name: 'Can Receive Mail?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.mx_ok }}'), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

const sendEmail = node({
  type: 'n8n-nodes-base.emailSend',
  version: 2.1,
  config: {
    name: 'Send Email',
    onError: 'continueErrorOutput',
    parameters: {
      resource: 'email',
      operation: 'send',
      fromEmail: 'UpSpark <marketing@upspark.net>',
      toEmail: expr('{{ $json.email }}'),
      subject: expr('{{ $json.subject }}'),
      emailFormat: 'html',
      html: expr("{{ $('Get Email Body').first().json.data.split('{'.repeat(2) + 'company_name' + '}'.repeat(2)).join($json.company || 'there') }}"),
      options: { appendAttribution: false }
    },
    credentials: { smtp: { id: 'URYotWhOU6Ejz9BW', name: 'SMTP account' } }
  },
  output: [{ accepted: ['info@x.com'] }]
});

const markSent = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Mark Sent',
    parameters: {
      resource: 'sheet', operation: 'update', documentId: SHEET_DOC, sheetName: SHEET_TAB,
      columns: { mappingMode: 'defineBelow', value: { row_number: expr("{{ $('Check Mail Server').item.json.row_number }}"), sent_at: expr("{{ $now.setZone('Asia/Dubai').toFormat('yyyy-MM-dd HH:mm') }}") }, matchingColumns: ['row_number'], schema: ROW_SCHEMA },
      options: { cellFormat: 'RAW' }
    },
    credentials: GSHEETS
  },
  output: [{ row_number: 2 }]
});

const markError = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Mark Send Error',
    parameters: {
      resource: 'sheet', operation: 'update', documentId: SHEET_DOC, sheetName: SHEET_TAB,
      columns: { mappingMode: 'defineBelow', value: { row_number: expr("{{ $('Check Mail Server').item.json.row_number }}"), sent_at: expr("{{ 'ERROR - ' + String(($json.error && ($json.error.message || $json.error)) || 'send failed').slice(0, 150) }}") }, matchingColumns: ['row_number'], schema: ROW_SCHEMA },
      options: { cellFormat: 'RAW' }
    },
    credentials: GSHEETS
  },
  output: [{ row_number: 2 }]
});

const markNoMx = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Mark No Mail Server',
    parameters: {
      resource: 'sheet', operation: 'update', documentId: SHEET_DOC, sheetName: SHEET_TAB,
      columns: { mappingMode: 'defineBelow', value: { row_number: expr('{{ $json.row_number }}'), sent_at: 'SKIPPED - domain cannot receive email' }, matchingColumns: ['row_number'], schema: ROW_SCHEMA },
      options: { cellFormat: 'RAW' }
    },
    credentials: GSHEETS
  },
  output: [{ row_number: 2 }]
});

const note = sticky(
  '## Approve & Send: UpSpark Outreach (10/day)\n\nThe team reviews rows in **UpSpark Prospects (US + UAE)** (edit the AI subject if wanted) and sets **send** to **Yes**. Every 30 min, 09:00-18:00 Dubai time, this emails up to 2 approved rows, max **10 per day**, from marketing@upspark.net. Subject = the row\'s personalized **subject** column; body = assets/email/upspark_outreach.html from the repo (company_name placeholder is filled in).\n\nSkips invalid/duplicate emails and domains with no mail server; writes the send time, SKIPPED or ERROR into **sent_at** so a row is never emailed twice.\n\n**Keep unpublished until the real email body is in the repo.**',
  [pick, sendEmail],
  { color: 4 }
);

export default workflow('upspark-outreach-send', 'Approve & Send: UpSpark Outreach (10/day)')
  .add(every30)
  .to(getTemplate.to(readSheet.to(pick.to(skipRow
    .onTrue(markSkipped)
    .onFalse(mxLookup.to(checkMx.to(canReceive
      .onTrue(sendEmail.to(markSent).onError(markError))
      .onFalse(markNoMx))))))))
  .add(note);
