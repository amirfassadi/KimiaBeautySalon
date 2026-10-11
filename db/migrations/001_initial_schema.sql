-- Kimia Beauty & Atelier — PostgreSQL initial schema
-- Apply once to a new Supabase PostgreSQL database using its SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.service_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  name_fa text not null,
  description_fa text,
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.service_categories(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,80}$'),
  name_fa text not null,
  description_fa text,
  duration_minutes smallint check (duration_minutes is null or duration_minutes between 10 and 720),
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists services_active_order_idx on public.services (is_active, category_id, sort_order);

create table if not exists public.staff_members (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  role_title text,
  bio text,
  avatar_url text,
  is_active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ISO weekday: 1=Monday … 7=Sunday. Friday (5) is closed per salon schedule.
create table if not exists public.business_hours (
  iso_weekday smallint primary key check (iso_weekday between 1 and 7),
  opens_at time,
  closes_at time,
  is_closed boolean not null default false,
  check ((is_closed and opens_at is null and closes_at is null) or
         (not is_closed and opens_at is not null and closes_at is not null and closes_at > opens_at)
  )
);

create table if not exists public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10)),
  service_id uuid references public.services(id) on delete set null,
  customer_name text not null check (char_length(customer_name) between 2 and 100),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{8,14}$'),
  preferred_time_text text check (preferred_time_text is null or char_length(preferred_time_text) <= 120),
  note text check (note is null or char_length(note) <= 700),
  status text not null default 'new' check (status in ('new','contacted','confirmed','declined','converted','spam')),
  source text not null default 'website' check (source in ('website','instagram','phone','walk_in','other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists booking_requests_status_created_idx on public.booking_requests (status, created_at desc);
create index if not exists booking_requests_phone_created_idx on public.booking_requests (phone_e164, created_at desc);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  booking_request_id uuid unique references public.booking_requests(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  staff_member_id uuid references public.staff_members(id) on delete set null,
  customer_name text not null,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{8,14}$'),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('confirmed','completed','cancelled','no_show')),
  internal_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists appointments_staff_time_idx on public.appointments (staff_member_id, starts_at, ends_at) where status = 'confirmed';
create index if not exists appointments_time_idx on public.appointments (starts_at) where status = 'confirmed';

create table if not exists public.gallery_items (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references public.services(id) on delete set null,
  image_url text not null,
  alt_text_fa text not null,
  caption_fa text,
  is_published boolean not null default false,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists gallery_published_order_idx on public.gallery_items (is_published, sort_order);

create table if not exists public.booking_rate_limits (
  ip_hash text primary key check (char_length(ip_hash) between 32 and 128),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count between 1 and 1000)
);
create index if not exists booking_rate_limits_window_idx on public.booking_rate_limits (window_started_at);

insert into public.service_categories (slug, name_fa, description_fa, sort_order) values
  ('makeup', 'میکاپ و گریم', 'میکاپ عروس و گریم تخصصی', 10),
  ('hair', 'خدمات مو', 'کوتاهی، رنگ و خدمات زیبایی مو', 20),
  ('nails', 'خدمات ناخن', 'کاشت، طراحی و رسیدگی به ناخن', 30),
  ('eyes', 'ابرو و مژه', 'خدمات زیبایی ابرو و مژه', 40),
  ('skin', 'مراقبت پوست', 'خدمات مراقبت و زیبایی پوست', 50),
  ('atelier', 'آتلیهٔ عکاسی', 'هماهنگی جلسه‌های عکاسی پرتره', 60)
on conflict (slug) do nothing;

insert into public.services (category_id, slug, name_fa, sort_order)
select c.id, c.slug, c.name_fa, c.sort_order
from public.service_categories c
where c.slug in ('makeup','hair','nails','eyes','skin','atelier')
on conflict (slug) do nothing;

insert into public.business_hours (iso_weekday, opens_at, closes_at, is_closed) values
  (1, '09:00', '18:00', false),
  (2, '09:00', '18:00', false),
  (3, '09:00', '18:00', false),
  (4, '09:00', '18:00', false),
  (5, null, null, true),
  (6, '09:00', '18:00', false),
  (7, '09:00', '18:00', false)
on conflict (iso_weekday) do nothing;

alter table public.service_categories enable row level security;
alter table public.services enable row level security;
alter table public.staff_members enable row level security;
alter table public.business_hours enable row level security;
alter table public.booking_requests enable row level security;
alter table public.appointments enable row level security;
alter table public.gallery_items enable row level security;
alter table public.booking_rate_limits enable row level security;

-- Public reads are limited to published catalog content. No direct public access to customer records.
drop policy if exists service_categories_public_read on public.service_categories;
create policy service_categories_public_read on public.service_categories for select to anon, authenticated using (is_active);
drop policy if exists services_public_read on public.services;
create policy services_public_read on public.services for select to anon, authenticated using (is_active);
drop policy if exists business_hours_public_read on public.business_hours;
create policy business_hours_public_read on public.business_hours for select to anon, authenticated using (true);
drop policy if exists gallery_public_read on public.gallery_items;
create policy gallery_public_read on public.gallery_items for select to anon, authenticated using (is_published);

revoke all on public.booking_requests, public.appointments, public.booking_rate_limits from anon, authenticated;
grant select on public.service_categories, public.services, public.business_hours, public.gallery_items to anon, authenticated;

create or replace function public.create_booking_request(
  p_customer_name text,
  p_phone_e164 text,
  p_service_slug text,
  p_preferred_time_text text default null,
  p_note text default null,
  p_ip_hash text default null
)
returns table (request_id uuid, reference_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service_id uuid;
  v_count integer;
  v_request_id uuid;
  v_reference text;
  v_name text := pg_catalog.btrim(coalesce(p_customer_name, ''));
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_time text := nullif(pg_catalog.btrim(coalesce(p_preferred_time_text, '')), '');
begin
  if pg_catalog.char_length(v_name) < 2 or pg_catalog.char_length(v_name) > 100 then
    raise exception using errcode = '22023', message = 'invalid_name';
  end if;
  if p_phone_e164 is null or p_phone_e164 !~ '^\+[1-9][0-9]{8,14}$' then
    raise exception using errcode = '22023', message = 'invalid_phone';
  end if;
  if p_service_slug is null or pg_catalog.char_length(p_service_slug) > 80 then
    raise exception using errcode = '22023', message = 'invalid_service';
  end if;
  if v_time is not null and pg_catalog.char_length(v_time) > 120 then
    raise exception using errcode = '22023', message = 'invalid_preferred_time';
  end if;
  if v_note is not null and pg_catalog.char_length(v_note) > 700 then
    raise exception using errcode = '22023', message = 'invalid_note';
  end if;
  if p_ip_hash is null or pg_catalog.char_length(p_ip_hash) < 32 then
    raise exception using errcode = '22023', message = 'invalid_request';
  end if;

  select s.id into v_service_id
    from public.services s
   where s.slug = p_service_slug and s.is_active = true;
  if v_service_id is null then
    raise exception using errcode = '22023', message = 'service_unavailable';
  end if;

  delete from public.booking_rate_limits
   where window_started_at < pg_catalog.now() - interval '2 days';

  insert into public.booking_rate_limits as rl (ip_hash, window_started_at, request_count)
  values (p_ip_hash, pg_catalog.now(), 1)
  on conflict (ip_hash) do update
    set window_started_at = case
          when rl.window_started_at <= pg_catalog.now() - interval '1 hour' then pg_catalog.now()
          else rl.window_started_at end,
        request_count = case
          when rl.window_started_at <= pg_catalog.now() - interval '1 hour' then 1
          else rl.request_count + 1 end
  returning request_count into v_count;
  if v_count > 5 then
    raise exception using errcode = 'P0001', message = 'rate_limited';
  end if;

  insert into public.booking_requests
    (service_id, customer_name, phone_e164, preferred_time_text, note, source)
  values
    (v_service_id, v_name, p_phone_e164, v_time, v_note, 'website')
  returning id, reference_code into v_request_id, v_reference;

  return query select v_request_id, v_reference;
end;
$$;

revoke all on function public.create_booking_request(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_booking_request(text, text, text, text, text, text) to service_role;
