-- QA Monitor: схема Supabase.
-- Выполните целиком в Supabase → SQL Editor. Скрипт можно запускать повторно.

-- 1. Сайты (checks.site_id ссылается на sites.id; заполняется автоматически) ---
create table if not exists public.sites (
  id         text primary key,
  name       text,
  url        text,
  created_at timestamptz not null default now()
);

alter table public.sites
  add column if not exists name       text,
  add column if not exists url        text,
  add column if not exists created_at timestamptz not null default now();

-- 2. История проверок ---------------------------------------------------------
create table if not exists public.checks (
  id            bigint generated always as identity primary key,
  checked_at    timestamptz not null default now(),
  site_id       text not null,
  test_name     text not null,
  status        text not null,
  duration_ms   integer,
  error_message text
);

alter table public.checks
  add column if not exists checked_at    timestamptz not null default now(),
  add column if not exists site_name     text,
  add column if not exists url           text,
  add column if not exists http_status   integer,
  add column if not exists response_ms   integer,
  add column if not exists ssl_days_left integer,
  add column if not exists warnings      text,
  add column if not exists run_id        text;

create index if not exists checks_site_checked_idx on public.checks (site_id, checked_at desc);

-- 3. Задачи по клиентам (напоминания в Telegram) -------------------------------
-- Храним здесь, а не в репозитории: репозиторий публичный.
create table if not exists public.client_tasks (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  client     text not null default 'Общее',
  title      text not null,
  due_date   date,
  done       boolean not null default false,
  done_at    timestamptz,
  notes      text
);

alter table public.client_tasks
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists client     text not null default 'Общее',
  add column if not exists due_date   date,
  add column if not exists done       boolean not null default false,
  add column if not exists done_at    timestamptz,
  add column if not exists notes      text;

create index if not exists client_tasks_open_idx on public.client_tasks (done, due_date);

-- 4. Доступ только через service_role (GitHub Actions / локальные скрипты).
-- RLS без политик = публичный anon-ключ ничего не прочитает.
alter table public.sites enable row level security;
alter table public.checks enable row level security;
alter table public.client_tasks enable row level security;

-- 5. Стартовый план (добавляется, только если задач ещё нет).
insert into public.client_tasks (client, title, due_date)
select * from (values
  ('Платформа', 'Выполнить schema.sql и проверить секреты GitHub (Telegram, Supabase, Heartbeat)', current_date + 1),
  ('Платформа', 'Ручной запуск QA Monitor: проверить алерт, сводку и статус-страницу', current_date + 1),
  ('Продажи',   'Составить список 10 потенциальных клиентов (интернет-магазины, сервисы с онлайн-оплатой)', current_date + 3),
  ('Продажи',   'Подготовить шаблон письменного разрешения на мониторинг и договор пилота', current_date + 5),
  ('Продажи',   'Отправить 5 предложений о пилотном аудите с фиксированной ценой', current_date + 7),
  ('Продажи',   'Провести первую демонстрацию: статус-страница + демонстрация падения (DEMO_FAULT)', current_date + 10)
) as seed(client, title, due_date)
where not exists (select 1 from public.client_tasks);
