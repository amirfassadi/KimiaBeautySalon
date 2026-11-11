-- Self-hosted administrator authentication. This migration deliberately does
-- not include or activate customer authentication (migration 004).
create table public.kimia_admins (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  created_at timestamptz not null default now(),
  password_changed_at timestamptz not null default now(),
  disabled_at timestamptz
);
create unique index kimia_admins_email_lower_idx on public.kimia_admins (lower(email));

create table public.kimia_admin_sessions (
  token_hash char(64) primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  admin_id uuid not null references public.kimia_admins(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index kimia_admin_sessions_expiry_idx on public.kimia_admin_sessions (expires_at);

create table public.kimia_admin_login_limits (
  key_hash char(64) primary key check (key_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  failed_attempts smallint not null check (failed_attempts between 1 and 6)
);

alter table public.kimia_admins enable row level security;
alter table public.kimia_admin_sessions enable row level security;
alter table public.kimia_admin_login_limits enable row level security;
revoke all on public.kimia_admins, public.kimia_admin_sessions, public.kimia_admin_login_limits
  from public, anon, authenticated, service_role;

grant execute on function public.create_booking_v2(text,text,text,text,text,text,uuid,boolean,timestamptz)
  to current_user;
grant execute on function public.lookup_booking(text,text,text) to current_user;
grant execute on function public.manage_booking(uuid,text,text,uuid,timestamptz,timestamptz)
  to current_user;
