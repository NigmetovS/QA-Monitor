#!/usr/bin/env node
// Задачи по работе с клиентами + напоминания в Telegram.
// Хранилище — таблица client_tasks в Supabase (приватно, репозиторий публичный).
//
//   npm run tasks                                   — список открытых задач
//   npm run tasks -- add "Клиент" "Что сделать" 2026-11-25 ["заметка"]
//   npm run tasks -- done 12                        — отметить выполненной
//   npm run tasks -- move 12 2026-11-30             — перенести срок
//   npm run tasks -- remind                         — отправить напоминание в Telegram
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const TZ = process.env.REPORT_TZ || 'Asia/Almaty';
const UPCOMING_DAYS = 7;

function db() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY (в .env или секретах GitHub).');
    process.exit(1);
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function check(error) {
  if (error) {
    console.error('Supabase:', error.message);
    if (/client_tasks/.test(error.message)) console.error('Выполните supabase/schema.sql в Supabase → SQL Editor.');
    process.exit(1);
  }
}

// Сегодняшняя дата в часовом поясе пользователя, YYYY-MM-DD.
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

function addDays(date, days) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function human(date) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'));
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') || Number.isNaN(Date.parse(value))) {
    console.error(`Дата должна быть в формате ГГГГ-ММ-ДД, получено: ${value}`);
    process.exit(1);
  }
  return value;
}

async function openTasks() {
  const { data, error } = await db().from('client_tasks')
    .select('id, client, title, due_date, notes')
    .eq('done', false)
    .order('due_date', { ascending: true, nullsFirst: false });
  check(error);
  return data;
}

function group(tasks) {
  const t = today();
  const soon = addDays(t, UPCOMING_DAYS);
  return {
    overdue: tasks.filter(x => x.due_date && x.due_date < t),
    today: tasks.filter(x => x.due_date === t),
    upcoming: tasks.filter(x => x.due_date && x.due_date > t && x.due_date <= soon),
    later: tasks.filter(x => !x.due_date || x.due_date > soon)
  };
}

async function list() {
  const tasks = await openTasks();
  if (!tasks.length) return console.log('Открытых задач нет 🎉');
  const g = group(tasks);
  const print = (title, items) => {
    if (!items.length) return;
    console.log(`\n${title}`);
    for (const x of items) console.log(`  #${x.id}  [${x.client}] ${x.title}${x.due_date ? `  — до ${x.due_date}` : ''}`);
  };
  print('🔴 Просрочено', g.overdue);
  print('🟡 Сегодня', g.today);
  print(`🟢 Ближайшие ${UPCOMING_DAYS} дней`, g.upcoming);
  print('⚪ Позже / без срока', g.later);
}

async function add([client, title, due, notes]) {
  if (!client || !title) {
    console.error('Использование: npm run tasks -- add "Клиент" "Задача" [ГГГГ-ММ-ДД] ["заметка"]');
    process.exit(1);
  }
  const { data, error } = await db().from('client_tasks')
    .insert({ client, title, due_date: due ? validDate(due) : null, notes: notes ?? null })
    .select('id').single();
  check(error);
  console.log(`Добавлено: #${data.id}`);
}

async function update(id, patch, label) {
  if (!/^\d+$/.test(id ?? '')) { console.error('Укажите номер задачи, например: done 12'); process.exit(1); }
  const { data, error } = await db().from('client_tasks').update(patch).eq('id', Number(id)).select('id, title');
  check(error);
  if (!data.length) { console.error(`Задача #${id} не найдена`); process.exit(1); }
  console.log(`${label}: #${id} ${data[0].title}`);
}

async function remind() {
  const tasks = await openTasks();
  const g = group(tasks);
  const isMonday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: TZ }).format(new Date()) === 'Mon';

  // Нечего срочного — не беспокоим. По понедельникам — обзор недели всё равно.
  if (!g.overdue.length && !g.today.length && !(isMonday && tasks.length)) {
    console.log('Срочных задач нет — напоминание не отправлено');
    return;
  }

  const line = x => `• <b>${esc(x.client)}</b>: ${esc(x.title)}${x.due_date ? ` <i>(до ${human(x.due_date)})</i>` : ''}`;
  const lines = [`📋 <b>Задачи по клиентам — ${human(today())}</b>`];
  const section = (title, items) => { if (items.length) lines.push('', `<b>${title}</b>`, ...items.slice(0, 15).map(line)); };

  section(`🔴 Просрочено (${g.overdue.length})`, g.overdue);
  section(`🟡 Сегодня (${g.today.length})`, g.today);
  section(`🟢 На неделе (${g.upcoming.length})`, g.upcoming);
  if (g.later.length) lines.push('', `Ещё задач позже: ${g.later.length}`);
  lines.push('', 'Отметить: <code>npm run tasks -- done &lt;id&gt;</code> или в Supabase → client_tasks');

  const text = lines.join('\n');
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId } = process.env;
  if (!token || !chatId) {
    console.log(text.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
    console.log('\n(Telegram не настроен — напоминание выведено в консоль)');
    return;
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
  console.log('Напоминание отправлено в Telegram');
}

const [command = 'list', ...args] = process.argv.slice(2);
const commands = {
  list: () => list(),
  add: () => add(args),
  done: () => update(args[0], { done: true, done_at: new Date().toISOString() }, 'Выполнено'),
  move: () => update(args[0], { due_date: validDate(args[1]) }, `Срок перенесён на ${args[1]}`),
  remind: () => remind()
};

if (!commands[command]) {
  console.error(`Неизвестная команда: ${command}. Доступно: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}
commands[command]().catch(error => { console.error(error.message); process.exit(1); });
