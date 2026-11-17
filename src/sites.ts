import fs from 'node:fs';
import path from 'node:path';

export type Site = {
  id: string;
  name: string;
  url: string;
  enabled?: boolean;
  /** Текст, который обязан быть на странице (проверка контента). */
  expectText?: string;
  /** Порог «медленно», мс. По умолчанию 3000. */
  slowMs?: number;
};

export const DEFAULT_SLOW_MS = 3000;
export const SSL_WARN_DAYS = 14;

/**
 * Список сайтов берётся из переменной SITES_JSON (секрет GitHub — чтобы
 * адреса клиентов не лежали в публичном репозитории), иначе из sites.json.
 */
export function loadSites(): Site[] {
  const raw = process.env.SITES_JSON?.trim()
    || fs.readFileSync(path.join(__dirname, '..', 'sites.json'), 'utf8');

  const parsed = JSON.parse(raw);
  const list: Site[] = Array.isArray(parsed) ? parsed : parsed.sites;

  if (!Array.isArray(list)) {
    throw new Error('SITES_JSON / sites.json: ожидается { "sites": [...] }');
  }

  const ids = new Set<string>();
  for (const site of list) {
    if (!site.id || !site.name || !site.url) {
      throw new Error(`Сайт без id/name/url: ${JSON.stringify(site)}`);
    }
    if (ids.has(site.id)) throw new Error(`Повторяется id сайта: ${site.id}`);
    ids.add(site.id);
  }

  return list.filter(site => site.enabled !== false);
}
