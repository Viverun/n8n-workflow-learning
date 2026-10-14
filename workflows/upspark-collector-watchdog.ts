import { workflow, node, trigger, expr, ifElse, sticky } from '@n8n/workflow-sdk';

const daily = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.2,
  config: { name: 'Daily 8:15am Dubai', parameters: { rule: { interval: [{ triggerAtHour: 8, triggerAtMinute: 15 }] } } }
});

const readSheet = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Read Prospects Sheet',
    alwaysOutputData: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      resource: 'sheet',
      operation: 'read',
      documentId: { __rl: true, mode: 'id', value: '17-xFB3WbayS_cWPAXaLX_u8KBe_VlaDh3o4OksKsyNY', cachedResultName: 'UpSpark Prospects (US + UAE)' },
      sheetName: { __rl: true, mode: 'id', value: '1226409885', cachedResultName: 'Prospects' },
      options: {}
    },
    credentials: { googleSheetsOAuth2Api: { id: 'OH1NGutCEKtPnrEt', name: 'Google Sheets account' } }
  },
  output: [{ row_number: 2, company_name: 'X', email: 'info@x.com', sent_at: '' }]
});

const compare = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Compare With Yesterday', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: `
// Remembers yesterday's row count (workflow static data, kept between scheduled runs) and flags a day with no new rows.
const rows = $input.all().map(i => i.json).filter(r => r.company_name && r.email);
const count = rows.length;
const unsent = rows.filter(r => !String(r.sent_at || '').trim()).length;
const state = $getWorkflowStaticData('global');
const prev = typeof state.lastCount === 'number' ? state.lastCount : null;
state.lastCount = count;
state.lastCheck = new Date().toISOString();
const added = prev === null ? null : count - prev;
return [{ json: { count, unsent, prev, added, alert: prev !== null && added <= 0 } }];
` } },
  output: [{ count: 120, unsent: 80, prev: 100, added: 20, alert: false }]
});

const shouldAlert = ifElse({
  version: 2.2,
  config: {
    name: 'No New Rows?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.alert }}'), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

const sendAlert = node({
  type: 'n8n-nodes-base.emailSend',
  version: 2.1,
  config: {
    name: 'Send Alert',
    parameters: {
      resource: 'email',
      operation: 'send',
      fromEmail: 'marketing@upspark.net',
      toEmail: 'tech@careersnextstep.com',
      subject: '[ACTION] UpSpark collector added no new prospects in the last 24h',
      emailFormat: 'html',
      html: expr("{{ '<p>The <b>UpSpark Prospect Collector</b> added no new rows to the <b>UpSpark Prospects (US + UAE)</b> sheet in the last 24 hours.</p><p>Rows in sheet: <b>' + $json.count + '</b> (yesterday: ' + $json.prev + '). Not yet sent: <b>' + $json.unsent + '</b>.</p><p>Likely causes: Tavily credits used up or paused (see Pipeline Monitor), the search plan exhausted, or an error in the collector. Open the collector\\'s executions in n8n to check.</p>' }}"),
      options: { appendAttribution: false }
    },
    credentials: { smtp: { id: 'URYotWhOU6Ejz9BW', name: 'SMTP account' } }
  },
  output: [{ accepted: ['tech@careersnextstep.com'] }]
});

const note = sticky(
  '## UpSpark Collector Watchdog\n\nEvery day at 8:15am Dubai: counts rows in the UpSpark Prospects sheet and compares with yesterday. If nothing was added, emails tech@careersnextstep.com so a stalled collector never goes unnoticed. The first run only records the starting count.',
  [compare],
  { color: 4 }
);

export default workflow('upspark-collector-watchdog', 'UpSpark Collector Watchdog')
  .add(daily)
  .to(readSheet.to(compare.to(shouldAlert.onTrue(sendAlert))))
  .add(note);
