import { workflow, node, trigger, expr, ifElse, sticky } from '@n8n/workflow-sdk';

const SHEET_DOC = { __rl: true, mode: 'id', value: '17-xFB3WbayS_cWPAXaLX_u8KBe_VlaDh3o4OksKsyNY', cachedResultName: 'UpSpark Prospects (US + UAE)' };
const SHEET_TAB = { __rl: true, mode: 'id', value: '1226409885', cachedResultName: 'Prospects' };
const GSHEETS = { googleSheetsOAuth2Api: { id: 'OH1NGutCEKtPnrEt', name: 'Google Sheets account' } };

const everyMinute = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.2,
  config: { name: 'Every Minute', parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } } }
});

const readSheet = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Read Prospects Sheet',
    parameters: { resource: 'sheet', operation: 'read', documentId: SHEET_DOC, sheetName: SHEET_TAB, options: {} },
    credentials: GSHEETS
  },
  output: [{ row_number: 2, company_name: 'X', email: 'info@x.com', subject: 'X: an idea', send: 'Yes', sent_at: '', approved_at: '' }]
});

const plan = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Plan Actions', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: `
// send = Yes  -> first time seen: stamp approved_at (the 5-minute grace period starts; switch back to No to cancel)
//             -> approved_at older than 5 min and not sent yet: send (max 10 per Dubai day, 2 per run)
// send != Yes -> clear approved_at so a later Yes restarts the 5-minute wait
const DELAY_MS = 5 * 60 * 1000, DAILY = 10, PER_RUN = 2;
const now = $now.setZone('Asia/Dubai');
const today = now.toISODate();
const rows = $input.all().map(i => i.json);
const isSent = v => /^\\d{4}-\\d{2}-\\d{2}/.test(String(v || ''));
const sentToday = rows.filter(r => String(r.sent_at || '').startsWith(today)).length;
const sentEmails = new Set(rows.filter(r => isSent(r.sent_at)).map(r => String(r.email || '').trim().toLowerCase()));
let budget = Math.max(0, Math.min(PER_RUN, DAILY - sentToday));
const out = [];
const seen = new Set();
for (const r of rows) {
  const yes = String(r.send || '').trim().toLowerCase() === 'yes';
  const approved = String(r.approved_at || '').trim();
  const done = String(r.sent_at || '').trim();
  if (!yes) {
    if (approved && !done) out.push({ json: { action: 'mark', row_number: r.row_number, approved_at: '', sent_at: '' } });
    continue;
  }
  if (done) continue;
  if (!approved) { out.push({ json: { action: 'mark', row_number: r.row_number, approved_at: now.toISO(), sent_at: '' } }); continue; }
  if (Date.now() - Date.parse(approved) < DELAY_MS) continue;
  const e = String(r.email || '').trim().toLowerCase();
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(e)) { out.push({ json: { action: 'mark', row_number: r.row_number, approved_at: approved, sent_at: 'SKIPPED - invalid email' } }); continue; }
  if (sentEmails.has(e) || seen.has(e)) { out.push({ json: { action: 'mark', row_number: r.row_number, approved_at: approved, sent_at: 'SKIPPED - email already sent' } }); continue; }
  if (budget <= 0) continue; // waits for the next run / next day
  budget--;
  seen.add(e);
  const company = String(r.company_name || '').trim();
  const subject = String(r.subject || '').trim() || (company ? company + ': a quick idea for your website' : 'A quick idea for your website');
  out.push({ json: { action: 'send', row_number: r.row_number, approved_at: approved, email: e, domain: e.split('@')[1], company, subject } });
}
return out;
` } },
  output: [{ action: 'send', row_number: 2, approved_at: '2026-09-28T20:00:00.000+04:00', email: 'info@x.com', domain: 'x.com', company: 'X', subject: 'X: an idea' }]
});

const isSend = ifElse({
  version: 2.2,
  config: {
    name: 'Send Now?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.action }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'send' }],
        combinator: 'and'
      }
    }
  }
});

const ROW_SCHEMA = [
  { id: 'row_number', displayName: 'row_number', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true, readOnly: true },
  { id: 'sent_at', displayName: 'sent_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
  { id: 'approved_at', displayName: 'approved_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false }
];

const markRow = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Update Row Status',
    parameters: {
      resource: 'sheet', operation: 'update', documentId: SHEET_DOC, sheetName: SHEET_TAB,
      columns: { mappingMode: 'defineBelow', value: { row_number: expr('{{ $json.row_number }}'), approved_at: expr('{{ $json.approved_at }}'), sent_at: expr('{{ $json.sent_at }}') }, matchingColumns: ['row_number'], schema: ROW_SCHEMA },
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
const src = $('Plan Actions').item.json;
const j = $json || {};
const ok = j.Status === 0 && Array.isArray(j.Answer) && j.Answer.some(a => a.type === 15 && !/^0 \\.?$/.test(String(a.data).trim()));
return { json: { ...src, mx_ok: ok } };
` } },
  output: [{ row_number: 2, email: 'info@x.com', company: 'X', subject: 'X: an idea', approved_at: '', mx_ok: true }]
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

const getBody = node({
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

const restore = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Emails To Send', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: `
const tag = '{'.repeat(2) + 'company_name' + '}'.repeat(2);
const body = String($('Get Email Body').first().json.data || '');
return $('Check Mail Server').all().map(i => i.json).filter(j => j.mx_ok).map(j => ({ json: { ...j, html: body.split(tag).join(j.company || 'there') } }));
` } },
  output: [{ row_number: 2, email: 'info@x.com', subject: 'X', html: '<p>x</p>', approved_at: '' }]
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
      html: expr('{{ $json.html }}'),
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
      columns: { mappingMode: 'defineBelow', value: { row_number: expr("{{ $('Emails To Send').item.json.row_number }}"), approved_at: expr("{{ $('Emails To Send').item.json.approved_at }}"), sent_at: expr("{{ $now.setZone('Asia/Dubai').toFormat('yyyy-MM-dd HH:mm') }}") }, matchingColumns: ['row_number'], schema: ROW_SCHEMA },
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
      columns: { mappingMode: 'defineBelow', value: { row_number: expr("{{ $('Emails To Send').item.json.row_number }}"), approved_at: expr("{{ $('Emails To Send').item.json.approved_at }}"), sent_at: expr("{{ 'ERROR - ' + String(($json.error && ($json.error.message || $json.error)) || 'send failed').slice(0, 150) }}") }, matchingColumns: ['row_number'], schema: ROW_SCHEMA },
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
      columns: { mappingMode: 'defineBelow', value: { row_number: expr('{{ $json.row_number }}'), approved_at: expr('{{ $json.approved_at }}'), sent_at: 'SKIPPED - domain cannot receive email' }, matchingColumns: ['row_number'], schema: ROW_SCHEMA },
      options: { cellFormat: 'RAW' }
    },
    credentials: GSHEETS
  },
  output: [{ row_number: 2 }]
});

const note = sticky(
  '## Approve & Send: UpSpark Outreach\n\nPick **Yes** in the **send** dropdown. Within a minute the row gets an **approved_at** time; about **5 minutes** later the email is sent (switch back to **No** before then to cancel). **No** or empty = never sent.\n\nMax **10 per day** (Dubai time), 2 per minute. Subject = the row\'s **subject**; body = assets/email/upspark_outreach.html from the repo with the company name filled in. Skips invalid/duplicate emails and domains with no mail server; writes the send time, SKIPPED or ERROR into **sent_at** so a row is never emailed twice. No AI is used here.',
  [plan, sendEmail],
  { color: 4 }
);

export default workflow('upspark-outreach-send-v2', 'Approve & Send: UpSpark Outreach (Yes + 5 min)')
  .add(everyMinute)
  .to(readSheet.to(plan.to(isSend
    .onTrue(mxLookup.to(checkMx.to(canReceive
      .onTrue(getBody.to(restore.to(sendEmail.to(markSent).onError(markError))))
      .onFalse(markNoMx))))
    .onFalse(markRow))))
  .add(note);
