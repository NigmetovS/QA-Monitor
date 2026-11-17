// Запускает проверки на «сломанном» демо-магазине — чтобы показать клиенту
// алерт, скриншот и видео падения. Затем обычный `npm test` покажет восстановление.
// Режим: node scripts/demo-broken.mjs [checkout|cart] [аргументы playwright]  (по умолчанию checkout)
import { spawnSync } from 'node:child_process';

const fault = process.argv[2] || 'checkout';

// Если демо-сервер уже запущен (npm run demo), Playwright переиспользует его — без поломки.
try {
  await fetch('http://127.0.0.1:4173/health', { signal: AbortSignal.timeout(1000) });
  console.error('Демо-сервер уже запущен (npm run demo). Остановите его и повторите.');
  process.exit(1);
} catch { /* сервер не запущен — это то, что нужно */ }

console.log(`Демо-магазин запускается с поломкой: ${fault}\n`);
const result = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(3)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, DEMO_FAULT: fault }
});
process.exit(result.status ?? 1);
