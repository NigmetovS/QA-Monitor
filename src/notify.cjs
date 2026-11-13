const fs = require('node:fs');
async function main() {
  if (!fs.existsSync('results.json')) { console.log('No results.json found'); return; }
  const results = JSON.parse(fs.readFileSync('results.json', 'utf8'));
  const stats = results.stats || {};
  const failed = (stats.unexpected || 0) + (stats.flaky || 0);
  const message = `QA Monitor report\nPassed: ${stats.expected || 0}\nFailed / flaky: ${failed}\nSkipped: ${stats.skipped || 0}\nRun: ${process.env.GITHUB_RUN_ID || 'local'}`;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) { console.log(message, '\nTelegram not configured; notification skipped.'); return; }
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message }),
  });
  if (!response.ok) throw new Error(`Telegram API returned ${response.status}`);
  console.log('Telegram notification sent');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
