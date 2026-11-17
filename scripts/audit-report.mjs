#!/usr/bin/env node
// Отчёт экспресс-аудита для клиента: один самодостаточный HTML-файл на сайт
// (скриншоты встроены) + сводка по всем сайтам для презентации.
//
//   npm run audit:report -- [папка-с-результатами] [--contact "Имя · +7 ... · @telegram"]
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const contactIdx = args.indexOf('--contact');
const contact = contactIdx >= 0 ? args.splice(contactIdx, 2)[1] : (process.env.AUDIT_CONTACT || '');
const ROOT = path.resolve(args[0] || 'audit-results');

const SEVERITY = {
  critical: { label: 'Критично', weight: 25, order: 0 },
  important: { label: 'Важно', weight: 10, order: 1 },
  advice: { label: 'Рекомендация', weight: 3, order: 2 }
};

const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sec = ms => (ms / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' с';
const short = u => { try { const x = new URL(u); return (x.hostname + x.pathname).replace(/\/$/, '').slice(0, 80); } catch { return String(u).slice(0, 80); } };

/** Страница-заглушка защиты от ботов: данные недостоверны, нужна ручная проверка. */
export function isBlocked(r) {
  return /секундочку|just a moment|checking your browser|ddos-guard|attention required/i.test(r.seo?.title || '');
}

// Служебные сообщения браузера, не влияющие на работу сайта.
const BENIGN_ERRORS = /OTP retrieval|Permissions policy violation|requestStorageAccess|ResizeObserver loop/i;

/** Превращает сырые данные аудита в понятные владельцу бизнеса выводы. */
export function findIssues(r) {
  const issues = [];
  const add = (severity, id, title, impact, details = []) => issues.push({ severity, id, title, impact, details });
  const d = r.desktop || {};
  const m = r.mobile || {};

  if (isBlocked(r)) return issues;

  if (d.error || (d.status && d.status >= 400)) {
    add('critical', 'down', 'Главная страница не открылась',
      'Покупатель видит ошибку вместо магазина — продажи останавливаются.',
      [d.error || `HTTP ${d.status}`]);
    return issues;
  }

  const https = String(r.url).startsWith('https://');
  if (https && (r.ssl?.error && r.ssl.error !== 'timeout' || r.ssl?.authorized === false)) {
    add('critical', 'ssl-invalid', 'Проблема с SSL-сертификатом',
      'Браузер показывает «Небезопасное подключение» — большинство посетителей уйдут.', [r.ssl.error]);
  } else if (https && typeof r.ssl?.daysLeft === 'number' && r.ssl.daysLeft < 21) {
    add(r.ssl.daysLeft < 7 ? 'critical' : 'important', 'ssl-expiring', `SSL-сертификат истекает через ${r.ssl.daysLeft} дн.`,
      'Если его не продлить вовремя, сайт будет помечен как опасный.');
  }

  if (r.httpsRedirect === false) {
    add('important', 'no-https-redirect', 'Нет автоматического перехода на HTTPS',
      'По адресу http:// сайт открывается без защиты — браузер помечает его «Не защищено».');
  }

  const mLoad = m.timing?.loadMs || m.wallMs;
  const dLoad = d.timing?.loadMs || d.wallMs;
  if (mLoad > 5000) {
    add(mLoad > 8000 ? 'critical' : 'important', 'slow-mobile', `Медленно на телефоне: ${sec(mLoad)}`,
      'По данным Google, при загрузке дольше 3 секунд более половины мобильных посетителей уходят.');
  }
  if (dLoad > 4000) {
    add('important', 'slow-desktop', `Медленно на компьютере: ${sec(dLoad)}`,
      'Медленный сайт теряет покупателей и хуже ранжируется в поиске.');
  }
  if (d.transferKB > 5000) {
    add('important', 'heavy', `Тяжёлая страница: ${(d.transferKB / 1024).toFixed(1)} МБ`,
      'На мобильном интернете это долго и дорого для покупателя.',
      (d.heavyImages || []).slice(0, 5).map(i => `${short(i.url)} — ${i.kb} КБ`));
  } else if ((d.heavyImages || []).length >= 3) {
    add('advice', 'heavy-images', `Неоптимизированные изображения: ${d.heavyImages.length}`,
      'Картинки весят больше 300 КБ — их можно сжать без потери качества.',
      d.heavyImages.slice(0, 5).map(i => `${short(i.url)} — ${i.kb} КБ`));
  }

  const jsErrors = [...new Set([...(d.pageErrors || []), ...(m.pageErrors || [])])].filter(e => !BENIGN_ERRORS.test(e));
  if (jsErrors.length) {
    add('important', 'js-errors', `Ошибки JavaScript: ${jsErrors.length}`,
      'Такие ошибки часто ломают кнопки, фильтры, корзину или оформление заказа.', jsErrors.slice(0, 5));
  }
  const consoleErr = [...new Set(d.consoleErrors || [])].filter(e => !jsErrors.includes(e) && !BENIGN_ERRORS.test(e));
  if (consoleErr.length >= 3) {
    add('advice', 'console-errors', `Ошибки в консоли браузера: ${consoleErr.length}`,
      'Признак технических неполадок: что-то на странице не загрузилось или не сработало.', consoleErr.slice(0, 5));
  }

  const failedOwn = (d.failedRequests || []).filter(f => f.firstParty);
  if (failedOwn.length) {
    add('important', 'failed-requests', `Не загружаются файлы сайта: ${failedOwn.length}`,
      'Отсутствующие картинки, стили или скрипты — страница может выглядеть сломанной.',
      failedOwn.slice(0, 6).map(f => `${short(f.url)} — ${f.status}`));
  }

  const failedImages = (d.failedRequests || []).filter(f => !f.firstParty && /ORB|ERR_|^4\d\d/.test(String(f.status)));
  const imageHosts = [...new Set(failedImages.map(f => { try { return new URL(f.url).hostname; } catch { return f.url; } }))];
  if (failedImages.length >= 2) {
    add('important', 'external-images', `Не загружаются файлы со сторонних сайтов: ${failedImages.length}`,
      'Часть картинок или файлов подгружается с чужих хостингов и не отображается у покупателей — на их месте пустые блоки.',
      imageHosts.slice(0, 5));
  }

  const broken = r.links?.broken || [];
  if (broken.length) {
    add(broken.length >= 3 ? 'important' : 'advice', 'broken-links', `Битые ссылки с главной: ${broken.length} из ${r.links.checked}`,
      'Покупатель нажимает и попадает на ошибку — теряется доверие и продажа.',
      broken.slice(0, 6).map(b => `${short(b.url)} — ${b.status}`));
  }

  if ((r.mixedContent || []).length) {
    add('important', 'mixed-content', 'Смешанный контент (HTTP на HTTPS-странице)',
      'Браузер может блокировать такие файлы и убирать значок защищённого соединения.', r.mixedContent.slice(0, 5).map(short));
  }

  if (!r.seo?.viewport) {
    add('critical', 'no-viewport', 'Сайт не адаптирован под телефоны',
      'На телефоне страница отображается мелко, как на компьютере. Большинство покупателей заходит с телефона.');
  } else if ((m.overflowPx || 0) > 10) {
    add('important', 'overflow', 'На телефоне страница шире экрана',
      `Контент вылезает за край на ${m.overflowPx}px — появляется горизонтальная прокрутка, вёрстка «едет».`);
  }

  if (r.search) {
    // Ошибка автоматического ввода (например, поле перекрыто всплывающим окном) —
    // не доказательство поломки, такие случаи проверяются вручную.
    if (r.search.error) {
      // без вывода
    } else if (r.search.found && r.search.noResults) {
      add('important', 'search-empty', `Поиск не нашёл товары по запросу «${r.search.query}»`,
        'Покупатель ищет популярный товар и видит «ничего не найдено» — хотя товар может быть в каталоге.');
    }
  } else if (r.features && !r.features.search && r.features.catalogLinks > 10) {
    add('advice', 'no-search', 'На главной не найден поиск по товарам',
      'Покупателям сложнее найти нужный товар в большом каталоге.');
  }

  const f = r.features || {};
  if (f && !f.whatsapp && !f.telegram && !(f.chat || []).length && !(f.phone || []).length) {
    add('advice', 'no-contact', 'Нет быстрой связи с главной (телефон, WhatsApp, чат)',
      'В Казахстане многие покупатели предпочитают уточнить детали в WhatsApp перед покупкой.');
  }

  const seoMissing = [];
  if (!r.seo?.title) seoMissing.push('заголовок страницы (title)');
  if (!r.seo?.description) seoMissing.push('описание (meta description)');
  if (r.seo && r.seo.h1Count === 0) seoMissing.push('главный заголовок H1');
  if (r.seo && r.seo.h1Count > 1) seoMissing.push(`несколько H1 (${r.seo.h1Count})`);
  if (seoMissing.length) {
    add('advice', 'seo', 'SEO-основа требует внимания',
      'Влияет на то, как сайт выглядит и находится в Google и Яндексе.', seoMissing);
  }
  if (r.images?.total >= 5 && r.images.missingAlt / r.images.total > 0.3) {
    add('advice', 'alt', `У ${r.images.missingAlt} из ${r.images.total} изображений нет описания (alt)`,
      'Минус для поиска по картинкам и доступности сайта.');
  }

  const s = r.security || {};
  const headersMissing = [];
  if (!s.hsts) headersMissing.push('Strict-Transport-Security');
  if (!s.xContentTypeOptions) headersMissing.push('X-Content-Type-Options');
  if (!s.frameProtection) headersMissing.push('защита от встраивания (X-Frame-Options)');
  if (headersMissing.length >= 2) {
    add('advice', 'security-headers', 'Не настроены базовые заголовки безопасности',
      'Простая настройка сервера, снижающая риск подмены страниц и кликджекинга.', headersMissing);
  }
  const versionLeak = [s.server, s.poweredBy].filter(v => v && /\d/.test(v));
  if (versionLeak.length) {
    add('advice', 'version-leak', 'Сервер сообщает версии ПО',
      'Версии в ответах сервера облегчают поиск известных уязвимостей. Их стоит скрыть.', versionLeak);
  }

  return issues.sort((a, b) => SEVERITY[a.severity].order - SEVERITY[b.severity].order);
}

const NICHE_CASES = {
  'цветы': [
    ['Выбор даты и времени доставки', 'В оформлении заказа можно выбрать дату и интервал; прошедшие даты недоступны.'],
    ['Пиковые дни (14 февраля, 8 марта)', 'Каталог и оформление работают; проверка учащается в праздничные дни.']
  ],
  'зоотовары': [
    ['Фильтры каталога (бренд, вес, возраст)', 'Фильтр сужает список, товары соответствуют выбранным параметрам.'],
    ['Наличие популярного корма', 'Карточка ходового товара показывает цену и наличие.']
  ],
  'косметика': [
    ['Фильтр по бренду', 'Список товаров обновляется, бренд в карточках совпадает.'],
    ['Акции и промокоды', 'Промокод применяется в корзине, сумма пересчитывается.']
  ]
};

/** Тест-кейсы мониторинга под функции, найденные на сайте. Все — без реальных заказов и оплат. */
export function testCases(r) {
  const f = r.features || {};
  const cases = [['Главная страница доступна', 'Открывается за разумное время, без ошибок, SSL действителен.']];
  if (f.search) cases.push([`Поиск по запросу «${r.search?.query || 'популярный товар'}»`, 'Находятся товары с ценами, страница результатов без ошибок.']);
  if (f.catalogLinks > 0) cases.push(['Переход в категорию каталога', 'Открывается список товаров с ценами и фото.']);
  if (f.cart) {
    cases.push(['Карточка товара', 'Есть цена, фото, наличие и кнопка «В корзину».']);
    cases.push(['Добавление в корзину', 'Счётчик и сумма корзины обновляются.']);
    cases.push(['Оформление заказа (без отправки)', 'Форма открывается, обязательные поля проверяются, способы доставки доступны.']);
  }
  if (f.kaspi) cases.push(['Оплата через Kaspi', 'Способ оплаты Kaspi отображается на шаге оплаты.']);
  if (f.whatsapp) cases.push(['Кнопка WhatsApp', 'Ссылка ведёт на действующий номер магазина.']);
  if ((f.phone || []).length) cases.push(['Телефон на сайте', 'Номер кликабелен и в правильном формате.']);
  if ((f.chat || []).length) cases.push([`Онлайн-чат (${f.chat.join(', ')})`, 'Виджет загружается и открывается.']);
  if (f.login) cases.push(['Вход в личный кабинет', 'Страница входа открывается, форма работает (тестовый аккаунт).']);
  cases.push(['Мобильная версия', 'Меню, поиск и корзина доступны на телефоне, вёрстка не «едет».']);
  cases.push(...(NICHE_CASES[r.niche] || []));
  return cases.map(([title, expected], i) => ({ id: `TC-${String(i + 1).padStart(2, '0')}`, title, expected }));
}

export function score(issues) {
  return Math.max(0, 100 - issues.reduce((s, i) => s + SEVERITY[i.severity].weight, 0));
}

function img(dir, file) {
  const p = path.join(dir, file || '');
  if (!file || !fs.existsSync(p)) return '';
  return `data:image/jpeg;base64,${fs.readFileSync(p).toString('base64')}`;
}

function report(r, dir) {
  if (isBlocked(r)) {
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Экспресс-аудит — ${esc(r.name)}</title>
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 16px;color:#1b2230;background:#f6f7f9}</style></head>
<body><h1>${esc(r.name)}</h1><p>Сайт закрыт защитой от автоматических посетителей (страница «${esc(r.seo?.title)}»), поэтому экспресс-аудит не выполнен. Нужна ручная проверка или проверка с разрешения владельца.</p></body></html>`;
  }
  const issues = findIssues(r);
  const total = score(issues);
  const grade = total >= 85 ? 'good' : total >= 60 ? 'mid' : 'bad';
  const d = r.desktop || {}, m = r.mobile || {};
  const f = r.features || {};
  const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Almaty' }).format(new Date(r.auditedAt));

  const yes = v => v ? '<span class="ok">есть</span>' : '<span class="no">нет</span>';
  const featureRows = [
    ['Поиск по товарам', f.search ? '<span class="ok">есть</span>' : '<span class="no">не найден</span>'],
    ['Корзина', yes(f.cart)],
    ['Личный кабинет', yes(f.login)],
    ['Телефон (кликабельный)', yes((f.phone || []).length)],
    ['WhatsApp', yes(f.whatsapp)],
    ['Онлайн-чат', (f.chat || []).length ? `<span class="ok">${esc(f.chat.join(', '))}</span>` : '<span class="no">нет</span>'],
    ['Kaspi (оплата/рассрочка)', yes(f.kaspi)],
    ['Версия на казахском', yes(f.langSwitch)]
  ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');

  const issueHtml = issues.length ? issues.map(i => `
    <li class="issue ${i.severity}">
      <div class="tag">${SEVERITY[i.severity].label}</div>
      <h3>${esc(i.title)}</h3>
      <p>${esc(i.impact)}</p>
      ${i.details.length ? `<details><summary>Подробности</summary><ul>${i.details.map(x => `<li><code>${esc(x)}</code></li>`).join('')}</ul></details>` : ''}
    </li>`).join('') : '<li class="issue none"><h3>Явных проблем не найдено</h3><p>Главная страница в хорошем состоянии. Постоянный мониторинг поможет удержать этот уровень.</p></li>';

  const shots = [['desktop', 'Компьютер', d.screenshot], ['mobile', 'Телефон', m.screenshot], ['search', `Поиск «${r.search?.query || ''}»`, r.search?.screenshot]]
    .map(([cls, label, file]) => { const src = img(dir, file); return src ? `<figure class="${cls}"><img src="${src}" alt="${esc(label)}"><figcaption>${esc(label)}</figcaption></figure>` : ''; })
    .join('');

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Экспресс-аудит — ${esc(r.name)}</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--text:#1b2230;--muted:#667085;--line:#e4e7ec;--good:#12b76a;--mid:#f79009;--bad:#f04438;--accent:#175cd3}
@media (prefers-color-scheme:dark){:root{--bg:#0f1320;--card:#171c2b;--text:#e6e9f0;--muted:#98a2b3;--line:#283044;--accent:#84adff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:920px;margin:0 auto;padding:32px 16px 56px}
.head{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:24px}
.head h1{margin:0;font-size:26px;letter-spacing:-.01em}.head p{margin:2px 0 0;color:var(--muted)}
.score{display:flex;align-items:center;gap:12px}.ring{width:84px;height:84px;border-radius:50%;display:grid;place-items:center;font-size:26px;font-weight:700;color:#fff}
.ring.good{background:var(--good)}.ring.mid{background:var(--mid)}.ring.bad{background:var(--bad)}.score small{color:var(--muted);max-width:140px;line-height:1.3}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:16px}
h2{font-size:18px;margin:0 0 12px}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.metric{border:1px solid var(--line);border-radius:10px;padding:10px 12px}.metric span{display:block;color:var(--muted);font-size:12px}.metric b{font-size:18px;font-variant-numeric:tabular-nums}
.issues{list-style:none;margin:0;padding:0}
.issue{border:1px solid var(--line);border-left:5px solid var(--muted);border-radius:10px;padding:12px 16px;margin-bottom:10px}
.issue.critical{border-left-color:var(--bad)}.issue.important{border-left-color:var(--mid)}.issue.advice{border-left-color:var(--accent)}.issue.none{border-left-color:var(--good)}
.issue h3{margin:2px 0 4px;font-size:16px}.issue p{margin:0;color:var(--muted)}
.tag{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.issue.critical .tag{color:var(--bad)}.issue.important .tag{color:var(--mid)}.issue.advice .tag{color:var(--accent)}
details{margin-top:6px}summary{cursor:pointer;color:var(--accent);font-size:14px}details ul{margin:6px 0 0;padding-left:18px}code{font-size:12px;word-break:break-all}
table{width:100%;border-collapse:collapse}td{padding:7px 0;border-bottom:1px solid var(--line)}td:last-child{text-align:right}
.ok{color:var(--good);font-weight:600}.no{color:var(--muted)}
.shots{display:grid;grid-template-columns:2fr 1fr;gap:12px;align-items:start}.shots figure{margin:0}.shots img{width:100%;border:1px solid var(--line);border-radius:10px;display:block}
.shots .search{grid-column:1/-1}figcaption{color:var(--muted);font-size:13px;margin-top:4px}
.offer{background:var(--accent);color:#fff;border:0}.offer h2{color:#fff}.offer ul{margin:8px 0 0;padding-left:18px}.offer p{margin:8px 0 0}
.note{color:var(--muted);font-size:13px;margin:-6px 0 16px}
.cases td{text-align:left;vertical-align:top;padding:8px 8px 8px 0}.cases td:first-child{white-space:nowrap;width:64px}
.foot{color:var(--muted);font-size:13px;text-align:center;margin-top:20px}
@media (max-width:600px){.shots{grid-template-columns:1fr}.head h1{font-size:22px}}
</style></head><body><main>
<div class="head">
  <div><h1>Экспресс-аудит сайта ${esc(r.name)}</h1><p>${esc(short(r.url))} · ${esc(date)}</p></div>
  <div class="score"><div class="ring ${grade}">${total}</div><small>Оценка технического состояния из 100</small></div>
</div>

<section class="card"><h2>Ключевые показатели</h2><div class="metrics">
  <div class="metric"><span>Загрузка, телефон</span><b>${m.timing?.loadMs ? sec(m.timing.loadMs) : '—'}</b></div>
  <div class="metric"><span>Загрузка, компьютер</span><b>${d.timing?.loadMs ? sec(d.timing.loadMs) : '—'}</b></div>
  <div class="metric"><span>Вес страницы</span><b>${d.transferKB ? (d.transferKB / 1024).toFixed(1) + ' МБ' : '—'}</b></div>
  <div class="metric"><span>Запросов</span><b>${d.requests ?? '—'}</b></div>
  <div class="metric"><span>SSL действует</span><b>${typeof r.ssl?.daysLeft === 'number' ? r.ssl.daysLeft + ' дн.' : '—'}</b></div>
  <div class="metric"><span>Битых ссылок</span><b>${r.links ? `${r.links.broken.length} / ${r.links.checked}` : '—'}</b></div>
</div></section>

<p class="note">Скорость измерена одним визитом с сервера за пределами Казахстана; у покупателей в Казахстане она может быть выше. Вес страницы от расположения не зависит.</p>

<section class="card"><h2>Что мы нашли</h2><ul class="issues">${issueHtml}</ul></section>

<section class="card"><h2>Как сайт видят покупатели</h2><div class="shots">${shots}</div></section>

<section class="card"><h2>Функции главной страницы</h2><table>${featureRows}</table>
${(r.platform || []).length ? `<p class="no" style="margin:10px 0 0">Платформа: ${esc(r.platform.join(', '))}</p>` : ''}</section>

<section class="card"><h2>Сценарии мониторинга для вашего сайта</h2>
<p class="no" style="margin:0 0 10px">Что мы будем проверять реальным браузером по расписанию. Без реальных заказов и оплат — только с вашего разрешения.</p>
<table class="cases">${testCases(r).map(c => `<tr><td><b>${c.id}</b></td><td><b>${esc(c.title)}</b><br><span class="no">${esc(c.expected)}</span></td></tr>`).join('')}</table></section>

<section class="card offer"><h2>Что дальше</h2>
<p>Это разовая проверка одной страницы. Проблемы на сайте появляются после каждого обновления, смены хостинга или плагина — и обычно их первыми замечают покупатели.</p>
<ul>
  <li>Проверяем ключевые сценарии покупки (поиск → товар → корзина → оформление) реальным браузером каждые несколько часов</li>
  <li>Сообщаем в Telegram сразу, как обнаружим поломку — со скриншотом и видео</li>
  <li>Следим за скоростью, SSL и доступностью; еженедельный отчёт и статус-страница</li>
</ul>
${contact ? `<p><b>${esc(contact)}</b></p>` : ''}
</section>

<p class="foot">Проверка выполнена автоматически: один визит на главную страницу с компьютера и телефона, как обычный посетитель. Без нагрузки на сайт и без попыток взлома.</p>
</main></body></html>`;
}

const dirs = fs.existsSync(ROOT) ? fs.readdirSync(ROOT).filter(n => fs.existsSync(path.join(ROOT, n, 'result.json'))) : [];
if (!dirs.length) {
  console.error(`Нет результатов в ${ROOT}. Сначала запустите: npm run audit -- https://...`);
  process.exit(1);
}

const summary = [];
for (const name of dirs) {
  const dir = path.join(ROOT, name);
  const r = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  const issues = findIssues(r);
  fs.writeFileSync(path.join(dir, 'report.html'), report(r, dir));
  summary.push({ site: name, name: r.name, niche: r.niche, blocked: isBlocked(r), score: isBlocked(r) ? null : score(issues),
    testCases: isBlocked(r) ? [] : testCases(r),
    metrics: { mobileLoadMs: r.mobile?.timing?.loadMs ?? null, desktopLoadMs: r.desktop?.timing?.loadMs ?? null, weightKB: r.desktop?.transferKB ?? null, sslDays: r.ssl?.daysLeft ?? null }, issues: issues.map(i => ({ severity: i.severity, id: i.id, title: i.title })) });
  console.log(`${isBlocked(r) ? '  —' : String(score(issues)).padStart(3)}  ${name}  (${issues.length} замечаний) → ${path.relative(process.cwd(), path.join(dir, 'report.html'))}`);
}
fs.writeFileSync(path.join(ROOT, 'findings.json'), JSON.stringify(summary, null, 2));
