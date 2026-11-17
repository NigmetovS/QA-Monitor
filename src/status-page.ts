import type { SiteSnapshot, SiteStatus } from '../reporters/collector';
import { siteStats, type HistoryEntry } from './history';

const TZ = process.env.REPORT_TZ || 'Asia/Almaty';
const BARS = 48; // последние 48 проверок

const LABEL: Record<SiteStatus, string> = { up: 'Работает', degraded: 'Есть замечания', down: 'Не работает' };

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtTime(iso: string | Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  }).format(new Date(iso));
}

function pct(value: number | null): string {
  if (value === null) return '—';
  if (value === 100 || value === 0) return `${value}%`;
  return `${value.toFixed(2)}%`;
}

function ms(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toLocaleString('ru-RU')} мс`;
}

function timeline(history: HistoryEntry[], siteId: string): string {
  const points = history.filter(e => e.sites[siteId]).slice(-BARS);
  const empty = Array.from({ length: BARS - points.length }, () => '<i class="bar none" title="Нет данных"></i>').join('');
  const bars = points.map(e => {
    const p = e.sites[siteId];
    return `<i class="bar ${p.s}" title="${esc(fmtTime(e.at))} — ${LABEL[p.s]}${p.ms ? ', ' + p.ms + ' мс' : ''}"></i>`;
  }).join('');
  return `<div class="timeline" role="img" aria-label="История последних проверок">${empty}${bars}</div>
    <div class="axis"><span>${points.length ? esc(fmtTime(points[0].at)) : ''}</span><span>сейчас</span></div>`;
}

function siteCard(site: SiteSnapshot, history: HistoryEntry[], now: Date): string {
  const day = siteStats(history, site.id, 24, now);
  const week = siteStats(history, site.id, 24 * 7, now);
  const month = siteStats(history, site.id, 24 * 30, now);

  const ssl = site.sslDaysLeft === undefined ? '' :
    `<div class="metric"><span>SSL</span><b class="${site.sslDaysLeft < 14 ? 'warn' : ''}">${site.sslDaysLeft} дн.</b></div>`;

  const notes = [
    ...site.problems.map(p => `<li class="down">${esc(p)}</li>`),
    ...site.warnings.map(w => `<li class="degraded">${esc(w)}</li>`)
  ].join('');

  const checks = site.checks.map(c =>
    `<li><span class="dot ${c.status === 'passed' ? 'up' : c.status === 'failed' ? 'down' : 'none'}"></span>${esc(c.title)}</li>`
  ).join('');

  const link = /^https?:\/\//.test(site.url) && !/127\.0\.0\.1|localhost/.test(site.url)
    ? `<a href="${esc(site.url)}" target="_blank" rel="noopener">${esc(site.url.replace(/^https?:\/\//, ''))}</a>`
    : `<span>${esc(site.url)}</span>`;

  return `
  <article class="card">
    <header>
      <div><h2>${esc(site.name)}</h2>${link}</div>
      <span class="pill ${site.status}">${LABEL[site.status]}</span>
    </header>
    ${timeline(history, site.id)}
    <div class="metrics">
      <div class="metric"><span>Аптайм 24 ч</span><b>${pct(day.uptime)}</b></div>
      <div class="metric"><span>7 дней</span><b>${pct(week.uptime)}</b></div>
      <div class="metric"><span>30 дней</span><b>${pct(month.uptime)}</b></div>
      ${site.responseMs !== undefined || day.avgMs !== null ? `
      <div class="metric"><span>Ответ сейчас</span><b>${ms(site.responseMs)}</b></div>
      <div class="metric"><span>Средний, 24 ч</span><b>${ms(day.avgMs)}</b></div>` : ''}
      ${ssl}
    </div>
    ${notes ? `<ul class="notes">${notes}</ul>` : ''}
    <details><summary>Проверки (${site.checks.length})</summary><ul class="checks">${checks}</ul></details>
  </article>`;
}

export function buildStatusPage(snapshots: SiteSnapshot[], history: HistoryEntry[], opts: { runUrl?: string | null; now?: Date } = {}): string {
  const now = opts.now ?? new Date();
  const down = snapshots.filter(s => s.status === 'down').length;
  const degraded = snapshots.filter(s => s.status === 'degraded').length;
  const overall: SiteStatus = down ? 'down' : degraded ? 'degraded' : 'up';
  const headline = down
    ? `Не работает: ${down} из ${snapshots.length}`
    : degraded ? `Работает, есть замечания: ${degraded}` : 'Все сервисы работают';

  const order: Record<SiteStatus, number> = { down: 0, degraded: 1, up: 2 };
  const cards = [...snapshots]
    .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name))
    .map(s => siteCard(s, history, now)).join('');

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Статус сервисов — QA Monitor</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--text:#1b2230;--muted:#667085;--line:#e4e7ec;--up:#12b76a;--degraded:#f79009;--down:#f04438;--none:#d0d5dd;--accent:#175cd3}
@media (prefers-color-scheme:dark){:root{--bg:#0f1320;--card:#171c2b;--text:#e6e9f0;--muted:#98a2b3;--line:#283044;--none:#344054;--accent:#84adff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:920px;margin:0 auto;padding:32px 16px 48px}
.top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:20px}
.brand{font-weight:700;letter-spacing:-.01em;font-size:18px}
.brand small{display:block;font-weight:400;color:var(--muted);font-size:13px}
.updated{color:var(--muted);font-size:13px}
.banner{display:flex;align-items:center;gap:12px;padding:18px 20px;border-radius:14px;color:#fff;font-weight:600;font-size:18px;margin-bottom:24px}
.banner.up{background:var(--up)}.banner.degraded{background:var(--degraded)}.banner.down{background:var(--down)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:16px}
.card header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px}
.card h2{margin:0;font-size:17px}
.card header a,.card header span{color:var(--muted);font-size:13px;text-decoration:none;word-break:break-all}
.card header a:hover{color:var(--accent)}
.pill{flex:none;padding:4px 10px;border-radius:999px;font-size:13px;font-weight:600;color:#fff!important}
.pill.up{background:var(--up)}.pill.degraded{background:var(--degraded)}.pill.down{background:var(--down)}
.timeline{display:flex;gap:2px;height:34px}
.bar{flex:1;border-radius:3px;background:var(--none)}
.bar.up{background:var(--up)}.bar.degraded{background:var(--degraded)}.bar.down{background:var(--down)}
.axis{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;margin:4px 0 14px}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
.metric{border:1px solid var(--line);border-radius:10px;padding:8px 12px}
.metric span{display:block;color:var(--muted);font-size:12px}
.metric b{font-size:16px;font-variant-numeric:tabular-nums}
.metric b.warn{color:var(--degraded)}
.notes{margin:14px 0 0;padding:0;list-style:none}
.notes li{padding:8px 12px;border-radius:8px;margin-top:6px;font-size:14px;border-left:4px solid}
.notes li.down{border-color:var(--down);background:color-mix(in srgb,var(--down) 10%,transparent)}
.notes li.degraded{border-color:var(--degraded);background:color-mix(in srgb,var(--degraded) 12%,transparent)}
details{margin-top:12px;color:var(--muted);font-size:14px}
summary{cursor:pointer}
.checks{list-style:none;padding:6px 0 0;margin:0}
.checks li{display:flex;align-items:center;gap:8px;padding:2px 0;color:var(--text)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--none);flex:none}
.dot.up{background:var(--up)}.dot.down{background:var(--down)}
footer{color:var(--muted);font-size:13px;text-align:center;margin-top:28px}
footer a{color:var(--accent)}
@media (max-width:520px){.banner{font-size:16px}.timeline{gap:1px;height:28px}}
</style>
</head>
<body>
<main>
  <div class="top">
    <div class="brand">QA Monitor<small>Автоматический мониторинг сайтов и бизнес-сценариев</small></div>
    <div class="updated">Обновлено: ${esc(fmtTime(now))}</div>
  </div>
  <div class="banner ${overall}">${esc(headline)}</div>
  ${cards || '<p>Нет данных о проверках.</p>'}
  <footer>
    Проверки браузером (Playwright) по расписанию · время — ${esc(TZ)}
    ${opts.runUrl ? ` · <a href="${esc(opts.runUrl)}">подробный отчёт запуска</a>` : ''}
  </footer>
</main>
</body>
</html>`;
}
