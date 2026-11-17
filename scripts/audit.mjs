#!/usr/bin/env node
// Экспресс-аудит сайта: один визит на главную как обычный посетитель
// (компьютер + телефон), без нагрузки и без попыток взлома.
//
//   npm run audit -- https://shop.kz [https://other.kz ...]
//   npm run audit -- --config audit-sites.json      (список: [{ "url", "name", "query" }])
//
// Результат: audit-results/<домен>/result.json + скриншоты.
// Отчёт для клиента: npm run audit:report
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import { chromium, devices } from '@playwright/test';

const OUT = path.resolve(process.env.AUDIT_OUT || 'audit-results');
const MAX_LINKS = 25;
const NAV_TIMEOUT = 45_000;

const SEARCH_SELECTORS = [
  'input[type="search"]',
  'input[name="q"]', 'input[name="query"]', 'input[name="search"]', 'input[name="s"]',
  'input[name*="search" i]', 'input[placeholder*="поиск" i]', 'input[placeholder*="search" i]',
  'input[placeholder*="найти" i]', 'input[placeholder*="іздеу" i]'
];

const CHAT_WIDGETS = {
  'JivoSite': /jivosite|jivo\.ru|code\.jivo/i,
  'Bitrix24': /bitrix24|b24-/i,
  'Wazzup': /wazzup/i,
  'Tawk.to': /tawk\.to/i,
  'Chatra': /chatra/i,
  'Carrot quest': /carrotquest/i,
  'Talk-Me': /talk-me/i,
  'Envybox': /envybox/i
};

function parseArgs(argv) {
  const sites = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config') {
      const list = JSON.parse(fs.readFileSync(argv[++i], 'utf8'));
      sites.push(...(Array.isArray(list) ? list : list.sites));
    } else if (/^https?:\/\//.test(argv[i])) {
      sites.push({ url: argv[i] });
    }
  }
  return sites;
}

function slug(url) {
  return new URL(url).hostname.replace(/^www\./, '');
}

function sslInfo(host) {
  return new Promise(resolve => {
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 15_000 }, () => {
      const cert = socket.getPeerCertificate();
      const result = {
        authorized: socket.authorized,
        error: socket.authorizationError ? String(socket.authorizationError) : null,
        daysLeft: cert?.valid_to ? Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000) : null,
        issuer: cert?.issuer?.O || cert?.issuer?.CN || null,
        validTo: cert?.valid_to || null
      };
      socket.end();
      resolve(result);
    });
    socket.on('timeout', () => { socket.destroy(); resolve({ error: 'timeout' }); });
    socket.on('error', e => resolve({ error: e.message }));
  });
}

async function visit(browser, url, contextOptions, label, dir) {
  const context = await browser.newContext({ ...contextOptions, ignoreHTTPSErrors: true, locale: 'ru-RU' });
  const page = await context.newPage();
  const host = new URL(url).hostname.replace(/^www\./, '');
  const isFirstParty = u => { try { return new URL(u).hostname.replace(/^www\./, '').endsWith(host); } catch { return false; } };

  const consoleErrors = [];
  const pageErrors = [];
  const failed = [];
  const responses = [];

  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 300)));
  page.on('requestfailed', r => {
    const reason = r.failure()?.errorText || 'failed';
    if (!/ERR_ABORTED|NS_BINDING_ABORTED/.test(reason)) failed.push({ url: r.url().slice(0, 200), status: reason, firstParty: isFirstParty(r.url()) });
  });
  page.on('response', r => {
    const len = Number(r.headers()['content-length'] || 0);
    responses.push({ url: r.url(), status: r.status(), type: r.request().resourceType(), bytes: len });
    if (r.status() >= 400) failed.push({ url: r.url().slice(0, 200), status: r.status(), firstParty: isFirstParty(r.url()) });
  });

  const started = Date.now();
  let response = null;
  let error = null;
  try {
    response = await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT });
  } catch (e) {
    error = String(e.message || e).split('\n')[0];
  }
  const wallMs = Date.now() - started;
  // Даём догрузиться ленивым скриптам, но недолго.
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});

  const timing = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    if (!n) return null;
    return {
      ttfbMs: Math.round(n.responseStart),
      domContentLoadedMs: Math.round(n.domContentLoadedEventEnd),
      loadMs: Math.round(n.loadEventEnd),
      transferBytes: performance.getEntriesByType('resource').reduce((s, r) => s + (r.transferSize || 0), n.transferSize || 0)
    };
  }).catch(() => null);

  const layout = await page.evaluate(() => ({
    overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth)
  })).catch(() => ({}));

  const shot = `${label}.jpg`;
  await page.screenshot({ path: path.join(dir, shot), type: 'jpeg', quality: 60 }).catch(() => {});

  const bytesFromHeaders = responses.reduce((s, r) => s + r.bytes, 0);
  const heavyImages = responses
    .filter(r => r.type === 'image' && r.bytes > 300_000)
    .map(r => ({ url: r.url.slice(0, 200), kb: Math.round(r.bytes / 1024) }))
    .slice(0, 10);

  return {
    context, page, response, error,
    data: {
      error,
      status: response?.status() ?? null,
      finalUrl: page.url(),
      wallMs,
      timing,
      requests: responses.length,
      transferKB: Math.round(Math.max(timing?.transferBytes || 0, bytesFromHeaders) / 1024),
      heavyImages,
      overflowPx: layout.overflowPx ?? null,
      consoleErrors: [...new Set(consoleErrors)].slice(0, 10),
      pageErrors: [...new Set(pageErrors)].slice(0, 10),
      failedRequests: failed.slice(0, 20),
      screenshot: shot
    }
  };
}

async function inspectPage(page) {
  return page.evaluate(({ SEARCH_SELECTORS, CHAT_WIDGETS }) => {
    const $$ = s => Array.from(document.querySelectorAll(s));
    const text = (document.body?.innerText || '').slice(0, 200_000);
    const html = document.documentElement.outerHTML;
    const links = $$('a[href]').map(a => a.getAttribute('href') || '');
    const visible = el => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden'; };

    const meta = n => document.querySelector(`meta[name="${n}"]`)?.getAttribute('content') || null;
    const images = $$('img');
    const searchInputs = SEARCH_SELECTORS.flatMap(s => $$(s));
    const scripts = $$('script[src]').map(s => s.src).join(' ') + ' ' + $$('script:not([src])').map(s => s.textContent.slice(0, 3000)).join(' ');

    const platform = [];
    if (/\/bitrix\//.test(html)) platform.push('1С-Битрикс');
    if (/wp-content|wp-includes/.test(html)) platform.push(/woocommerce/i.test(html) ? 'WordPress + WooCommerce' : 'WordPress');
    if (/tildacdn|tilda\.ws/.test(html)) platform.push('Tilda');
    if (/insales/i.test(html)) platform.push('InSales');
    if (/cdn\.shopify/.test(html)) platform.push('Shopify');
    if (/catalog\/view\/(theme|javascript)/.test(html)) platform.push('OpenCart');
    if (/\/_next\/static/.test(html)) platform.push('Next.js');
    if (/__NUXT__|\/_nuxt\//.test(html)) platform.push('Nuxt');
    if (/joomla/i.test(html)) platform.push('Joomla');
    if (/data-wf-site|webflow/i.test(html)) platform.push('Webflow');

    const chat = Object.entries(CHAT_WIDGETS).filter(([, re]) => new RegExp(re).test(scripts)).map(([n]) => n);

    return {
      seo: {
        title: document.title || null,
        description: meta('description'),
        h1Count: $$('h1').length,
        lang: document.documentElement.lang || null,
        viewport: meta('viewport'),
        canonical: document.querySelector('link[rel="canonical"]')?.href || null,
        ogImage: document.querySelector('meta[property="og:image"]')?.content || null
      },
      images: {
        total: images.length,
        missingAlt: images.filter(i => !i.hasAttribute('alt') || !i.getAttribute('alt').trim()).length
      },
      mixedContent: location.protocol === 'https:'
        ? [...$$('img[src^="http:"]').map(e => e.src), ...$$('script[src^="http:"]').map(e => e.src), ...$$('link[href^="http:"][rel="stylesheet"]').map(e => e.href)].slice(0, 10)
        : [],
      platform,
      features: {
        search: searchInputs.some(visible) ? 'visible' : searchInputs.length ? 'hidden' : null,
        cart: links.some(h => /cart|basket|korzin|корзин/i.test(h)) || /корзина|себет/i.test(text),
        login: links.some(h => /login|auth|personal|account|lk\b|кабинет/i.test(h)) || /войти|личный кабинет/i.test(text),
        phone: links.filter(h => h.startsWith('tel:')).slice(0, 3),
        whatsapp: links.some(h => /wa\.me|whatsapp/i.test(h)),
        telegram: links.some(h => /t\.me\//i.test(h)),
        instagram: links.some(h => /instagram\.com/i.test(h)),
        kaspi: /kaspi/i.test(html),
        callbackForm: $$('form').some(f => f.querySelector('input[type="tel"], input[name*="phone" i], input[name*="tel" i]')),
        chat,
        langSwitch: links.some(h => /(^|\/)(kz|kk)(\/|$)|lang=(kz|kk)/i.test(h)) || /\bҚаз|\bKAZ\b|\bҚАЗ\b/.test(text),
        catalogLinks: links.filter(h => /catalog|category|collection|katalog|product/i.test(h)).length
      },
      internalLinks: [...new Set(links
        .map(h => { try { return new URL(h, location.href); } catch { return null; } })
        .filter(u => u && u.hostname === location.hostname && /^https?:$/.test(u.protocol))
        .filter(u => !/cart|basket|korzin|logout|login|auth|personal|compare|wishlist|favorite|add|delete|remove|\.(jpg|png|pdf|zip)$/i.test(u.pathname + u.search))
        .map(u => { u.hash = ''; return u.href; }))]
    };
  }, { SEARCH_SELECTORS, CHAT_WIDGETS: Object.fromEntries(Object.entries(CHAT_WIDGETS).map(([k, v]) => [k, v.source])) });
}

async function checkLinks(context, urls) {
  const broken = [];
  let checked = 0;
  for (const url of urls.slice(0, MAX_LINKS)) {
    checked++;
    try {
      const r = await context.request.get(url, { timeout: 20_000, maxRedirects: 5, failOnStatusCode: false });
      if (r.status() >= 400) broken.push({ url, status: r.status() });
    } catch (e) {
      broken.push({ url, status: String(e.message).split('\n')[0].slice(0, 80) });
    }
    await new Promise(r => setTimeout(r, 300)); // бережно к сайту
  }
  return { checked, total: urls.length, broken };
}

async function trySearch(page, query, dir) {
  if (!query) return null;
  const input = await (async () => {
    for (const s of SEARCH_SELECTORS) {
      const loc = page.locator(s);
      const count = await loc.count();
      for (let i = 0; i < count; i++) if (await loc.nth(i).isVisible().catch(() => false)) return loc.nth(i);
    }
    return null;
  })();
  if (!input) return { query, found: false };

  const before = page.url();
  try {
    await input.click({ timeout: 5_000 });
    await input.fill(query, { timeout: 5_000 });
    await Promise.all([
      page.waitForLoadState('load', { timeout: 20_000 }).catch(() => {}),
      input.press('Enter')
    ]);
    await page.waitForTimeout(2_500);
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    const result = await page.evaluate(() => {
      const t = document.body?.innerText || '';
      return {
        noResults: /ничего не найдено|не найдено|нет результатов|ничего не нашлось|по вашему запросу.*не|no results|nothing found|табылмады/i.test(t),
        priceMentions: (t.match(/\d[\d\s]*\s?(₸|тг|тенге|KZT)/gi) || []).length
      };
    });
    await page.screenshot({ path: path.join(dir, 'search.jpg'), type: 'jpeg', quality: 60 }).catch(() => {});
    return { query, found: true, navigated: page.url() !== before, resultUrl: page.url(), ...result, screenshot: 'search.jpg' };
  } catch (e) {
    return { query, found: true, error: String(e.message).split('\n')[0].slice(0, 200) };
  }
}

async function auditSite(browser, site) {
  const url = site.url;
  const dir = path.join(OUT, slug(url));
  fs.mkdirSync(dir, { recursive: true });
  console.log(`\n▶ ${url}`);

  const result = { url, name: site.name || slug(url), niche: site.niche || null, auditedAt: new Date().toISOString() };

  // 1. Компьютер
  const desktop = await visit(browser, url, { viewport: { width: 1366, height: 800 } }, 'desktop', dir);
  result.desktop = desktop.data;
  const headers = desktop.response ? await desktop.response.allHeaders() : {};
  result.security = {
    hsts: !!headers['strict-transport-security'],
    xContentTypeOptions: !!headers['x-content-type-options'],
    csp: !!headers['content-security-policy'],
    frameProtection: !!headers['x-frame-options'] || /frame-ancestors/.test(headers['content-security-policy'] || ''),
    server: headers['server'] || null,
    poweredBy: headers['x-powered-by'] || null
  };

  if (!desktop.error) {
    Object.assign(result, await inspectPage(desktop.page).catch(e => ({ inspectError: e.message })));
    result.links = await checkLinks(desktop.context, result.internalLinks || []);
    delete result.internalLinks;
    result.search = await trySearch(desktop.page, site.query, dir);
  }
  await desktop.context.close();

  // 2. Телефон
  const { defaultBrowserType, ...iphone } = devices['iPhone 13'];
  const mobile = await visit(browser, url, iphone, 'mobile', dir);
  result.mobile = mobile.data;
  await mobile.context.close();

  // 3. HTTPS и сертификат
  const host = new URL(url).hostname;
  result.ssl = await sslInfo(host);
  try {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const r = await ctx.request.get(`http://${host}/`, { timeout: 20_000, maxRedirects: 5, failOnStatusCode: false });
    result.httpsRedirect = r.url().startsWith('https://');
    await ctx.close();
  } catch (e) {
    result.httpsRedirect = null;
  }

  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(`  статус ${result.desktop.status ?? result.desktop.error} · ${result.desktop.timing?.loadMs ?? '—'} мс (ПК) · ${result.mobile.timing?.loadMs ?? '—'} мс (тел.) · битых ссылок ${result.links?.broken.length ?? '—'}`);
  return result;
}

const sites = parseArgs(process.argv.slice(2));
if (!sites.length) {
  console.error('Укажите адреса: npm run audit -- https://shop.kz  или  --config audit-sites.json');
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const summary = [];
for (const site of sites) {
  try {
    summary.push(await auditSite(browser, site));
  } catch (e) {
    console.error(`  ошибка аудита: ${e.message}`);
    summary.push({ url: site.url, name: site.name, fatal: e.message });
  }
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`\nГотово: ${OUT}`);
