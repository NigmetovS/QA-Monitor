# QA Monitor MVP

An initial sellable demo of automated browser monitoring using Playwright. The default target is a **local demo shop**; do not point tests at third-party sites without permission.

## Requirements
- Node.js 20+ (recommended 22)
- npm

## Run on Windows PowerShell
```powershell
npm install
npx playwright install chromium
npm test
```

Playwright automatically starts the local demo server. Open the HTML report:
```powershell
npx playwright show-report
```

To run the demo site yourself:
```powershell
npm run demo
```
Then visit http://127.0.0.1:4173.

## Notifications
Create a Telegram bot using @BotFather, get the chat ID for a chat that has started the bot, and set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` as environment variables (or GitHub Actions secrets). Do not commit credentials.

PowerShell example (values are placeholders):
```powershell
$env:TELEGRAM_BOT_TOKEN="YOUR_TOKEN"
$env:TELEGRAM_CHAT_ID="YOUR_CHAT_ID"
npm test
npm run test:notify
```

If credentials are absent, notification prints to console only.

## GitHub Actions
Push this directory as a repository. Open Actions > QA Monitor > Run workflow. The schedule is 04:00 UTC daily (09:00 in Kazakhstan, UTC+5), but GitHub schedules are best-effort and can be delayed. Add Telegram credentials under Settings > Secrets and variables > Actions. Reports are stored as workflow artifacts for 14 days.

## Client onboarding (authorized staging environments only)
1. Obtain written permission and an agreed test environment.
2. Document 3–5 critical business scenarios, test accounts and safe test data.
3. Replace demo tests in `tests/critical-flows.spec.ts` with client-specific selectors and assertions.
4. Prefer non-destructive scenarios; do not submit real purchases or payments.
5. Keep client secrets in environment variables or repository secrets, never in code.
6. Define check frequency, response time, and data retention in the service agreement.

## MVP limitations
- No multi-tenant dashboard or customer authentication.
- No SLA or guaranteed detection of every defect.
- GitHub Actions scheduling is not suitable for strict minute-by-minute uptime guarantees.
- Each client's private checks should be isolated and credential access restricted.
- Avoid storing personal data in screenshots, traces and artifacts.

## Commercial next steps
Sell a fixed-scope paid audit before building a full SaaS. Track hours per setup, false alerts, monthly service costs, and recurring revenue.
