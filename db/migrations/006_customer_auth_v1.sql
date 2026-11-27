-- Standalone customer authentication schema. Prepared but not registered by
-- the migration runner; migration 004 is historical and is never adopted here.

create table public.kimia_customer_accounts (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique
    check (phone_e164 ~ '^\+989[0-9]{9}$'),
  first_name text not null
    check (char_length(first_name) between 2 and 80),
  last_name text not null
    check (char_length(last_name) between 2 and 100),
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (marketing_consent or marketing_consent_at is null),
  unique (id, phone_e164)
);

create table public.kimia_customer_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null
    check (phone_e164 ~ '^\+989[0-9]{9}$'),
  code_hash char(64) not null
    check (code_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  attempts smallint not null default 0
    check (attempts between 0 and 5),
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (consumed_at is null or revoked_at is null)
);
create index kimia_customer_otp_phone_created_idx
  on public.kimia_customer_otp_challenges (phone_e164, created_at desc);
create index kimia_customer_otp_active_idx
  on public.kimia_customer_otp_challenges (phone_e164, expires_at)
  where consumed_at is null and revoked_at is null;

create table public.kimia_customer_registration_proofs (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null
    check (phone_e164 ~ '^\+989[0-9]{9}$'),
  proof_hash char(64) not null unique
    check (proof_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (used_at is null or revoked_at is null)
);
create index kimia_customer_registration_phone_idx
  on public.kimia_customer_registration_proofs (phone_e164, created_at desc);
create index kimia_customer_registration_active_idx
  on public.kimia_customer_registration_proofs (proof_hash)
  where used_at is null and revoked_at is null;

create table public.kimia_customer_access_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  phone_e164 text not null
    check (phone_e164 ~ '^\+989[0-9]{9}$'),
  token_hash char(64) not null unique
    check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  foreign key (account_id, phone_e164)
    references public.kimia_customer_accounts(id, phone_e164) on delete cascade
);
create index kimia_customer_access_account_idx
  on public.kimia_customer_access_sessions (account_id, expires_at desc);
create index kimia_customer_access_active_idx
  on public.kimia_customer_access_sessions (token_hash)
  where revoked_at is null;

-- Append-only send events support rolling-hour counting and a separate
-- latest-event lookup for resend cooldown. They are not fixed-window counters.
create table public.kimia_customer_send_events (
  id uuid primary key default gen_random_uuid(),
  key_type text not null
    check (key_type in ('phone','trusted_ip')),
  key_hash char(64) not null
    check (key_hash ~ '^[a-f0-9]{64}$'),
  phone_e164 text
    check (phone_e164 is null or phone_e164 ~ '^\+989[0-9]{9}$'),
  created_at timestamptz not null default now()
);
create index kimia_customer_send_events_rolling_idx
  on public.kimia_customer_send_events (key_type, key_hash, created_at desc);
create index kimia_customer_send_events_cleanup_idx
  on public.kimia_customer_send_events (created_at);

alter table public.kimia_customer_accounts enable row level security;
alter table public.kimia_customer_otp_challenges enable row level security;
alter table public.kimia_customer_registration_proofs enable row level security;
alter table public.kimia_customer_access_sessions enable row level security;
alter table public.kimia_customer_send_events enable row level security;

revoke all on public.kimia_customer_accounts,
  public.kimia_customer_otp_challenges,
  public.kimia_customer_registration_proofs,
  public.kimia_customer_access_sessions,
  public.kimia_customer_send_events
  from public, anon, authenticated, service_role;

-- The migration runs as the dedicated application database role, which owns
-- these tables. That owner retains direct pool access; no API role or RPC role
-- receives table privileges and no SECURITY DEFINER function is introduced.
grant all on public.kimia_customer_accounts,
  public.kimia_customer_otp_challenges,
  public.kimia_customer_registration_proofs,
  public.kimia_customer_access_sessions,
  public.kimia_customer_send_events
  to current_user;
