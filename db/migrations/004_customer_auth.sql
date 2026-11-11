-- Append-only migration. Apply after 003 on Supabase PostgreSQL.
create table public.customer_accounts (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique check (phone_e164 ~ '^\+989[0-9]{9}$'),
  first_name text not null check (char_length(first_name) between 2 and 80),
  last_name text not null check (char_length(last_name) between 2 and 100),
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customer_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null check (phone_e164 ~ '^\+989[0-9]{9}$'),
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index customer_otp_phone_created_idx
  on public.customer_otp_challenges (phone_e164, created_at desc);

create table public.customer_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.customer_accounts(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+989[0-9]{9}$'),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  token_type text not null check (token_type in ('registration','access')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check ((token_type = 'registration' and account_id is null) or
         (token_type = 'access' and account_id is not null))
);
create index customer_sessions_account_idx
  on public.customer_sessions (account_id, expires_at desc)
  where token_type = 'access';

create table public.customer_auth_rate_limits (
  rate_key text primary key check (char_length(rate_key) between 32 and 160),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count between 1 and 1000)
);

alter table public.customer_accounts enable row level security;
alter table public.customer_otp_challenges enable row level security;
alter table public.customer_sessions enable row level security;
alter table public.customer_auth_rate_limits enable row level security;
revoke all on public.customer_accounts, public.customer_otp_challenges,
  public.customer_sessions, public.customer_auth_rate_limits from public, anon, authenticated;
grant all on public.customer_accounts, public.customer_otp_challenges,
  public.customer_sessions, public.customer_auth_rate_limits to service_role;

create or replace function public.create_customer_otp(
  p_phone_e164 text, p_code_hash text, p_ip_hash text
) returns table(challenge_id uuid)
language plpgsql security definer set search_path='' as $$
declare v_count integer; v_id uuid;
begin
  if p_phone_e164 !~ '^\+989[0-9]{9}$' or p_code_hash !~ '^[a-f0-9]{64}$'
     or p_ip_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_auth_request'; end if;
  insert into public.customer_auth_rate_limits as rl(rate_key, window_started_at, request_count)
  values ('ip:' || p_ip_hash, now(), 1)
  on conflict(rate_key) do update set
    window_started_at = case when rl.window_started_at <= now() - interval '1 hour' then now() else rl.window_started_at end,
    request_count = case when rl.window_started_at <= now() - interval '1 hour' then 1 else rl.request_count + 1 end
  returning request_count into v_count;
  if v_count > 5 then raise exception 'rate_limited'; end if;

  insert into public.customer_auth_rate_limits as rl(rate_key, window_started_at, request_count)
  values ('phone:' || md5(p_phone_e164), now(), 1)
  on conflict(rate_key) do update set
    window_started_at = case when rl.window_started_at <= now() - interval '1 hour' then now() else rl.window_started_at end,
    request_count = case when rl.window_started_at <= now() - interval '1 hour' then 1 else rl.request_count + 1 end
  returning request_count into v_count;
  if v_count > 3 then raise exception 'rate_limited'; end if;

  update public.customer_otp_challenges
     set consumed_at = now()
   where phone_e164 = p_phone_e164 and consumed_at is null;
  insert into public.customer_otp_challenges(phone_e164, code_hash, expires_at)
  values (p_phone_e164, p_code_hash, now() + interval '5 minutes')
  returning id into v_id;
  return query select v_id;
end; $$;

create or replace function public.revoke_customer_otp(p_challenge_id uuid)
returns void language sql security definer set search_path='' as $$
  update public.customer_otp_challenges set consumed_at = now() where id = p_challenge_id;
$$;

create or replace function public.verify_customer_otp(
  p_phone_e164 text, p_code_hash text, p_session_hash text
) returns table(is_new_user boolean, account_id uuid)
language plpgsql security definer set search_path='' as $$
declare v_challenge public.customer_otp_challenges; v_account uuid;
begin
  if p_phone_e164 !~ '^\+989[0-9]{9}$' or p_code_hash !~ '^[a-f0-9]{64}$'
     or p_session_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_auth_request'; end if;
  select * into v_challenge from public.customer_otp_challenges
   where phone_e164 = p_phone_e164 and consumed_at is null
   order by created_at desc limit 1 for update;
  if not found or v_challenge.expires_at <= now() then raise exception 'otp_expired'; end if;
  if v_challenge.attempts >= 5 then raise exception 'otp_locked'; end if;
  if v_challenge.code_hash <> p_code_hash then
    update public.customer_otp_challenges set attempts = attempts + 1 where id = v_challenge.id;
    return;
  end if;
  update public.customer_otp_challenges set consumed_at = now() where id = v_challenge.id;
  v_account := (
    select c.id
      from public.customer_accounts as c
     where c.phone_e164 = p_phone_e164
  );
  if v_account is null then
    insert into public.customer_sessions(phone_e164, token_hash, token_type, expires_at)
    values (p_phone_e164, p_session_hash, 'registration', now() + interval '15 minutes');
    return query select true, null::uuid;
  end if;
  insert into public.customer_sessions(account_id, phone_e164, token_hash, token_type, expires_at)
  select c.id, p_phone_e164, p_session_hash, 'access', now() + interval '30 days'
    from public.customer_accounts as c
   where c.phone_e164 = p_phone_e164
  returning customer_sessions.account_id into v_account;
  return query select false, v_account;
end; $$;

create or replace function public.register_customer(
  p_phone_e164 text, p_temp_hash text, p_first_name text, p_last_name text,
  p_marketing boolean, p_session_hash text
) returns table(account_id uuid)
language plpgsql security definer set search_path='' as $$
declare v_session public.customer_sessions; v_account uuid; v_first text; v_last text;
begin
  v_first := pg_catalog.btrim(coalesce(p_first_name, ''));
  v_last := pg_catalog.btrim(coalesce(p_last_name, ''));
  if p_phone_e164 !~ '^\+989[0-9]{9}$' or p_temp_hash !~ '^[a-f0-9]{64}$'
     or p_session_hash !~ '^[a-f0-9]{64}$' or char_length(v_first) not between 2 and 80
     or char_length(v_last) not between 2 and 100 then raise exception 'invalid_profile'; end if;
  select * into v_session from public.customer_sessions
   where token_hash = p_temp_hash and token_type = 'registration'
     and used_at is null and expires_at > now() for update;
  if not found or v_session.phone_e164 <> p_phone_e164 then raise exception 'registration_expired'; end if;
  if exists(select 1 from public.customer_accounts where phone_e164 = p_phone_e164) then
    raise exception 'account_exists';
  end if;
  insert into public.customer_accounts(phone_e164, first_name, last_name, marketing_consent, marketing_consent_at)
  values(p_phone_e164, v_first, v_last, coalesce(p_marketing, false),
         case when coalesce(p_marketing, false) then now() else null end)
  returning customer_accounts.id into v_account;
  update public.customer_sessions set used_at = now() where id = v_session.id;
  insert into public.customer_sessions(account_id, phone_e164, token_hash, token_type, expires_at)
  values(v_account, p_phone_e164, p_session_hash, 'access', now() + interval '30 days');
  return query select v_account;
end; $$;

revoke all on function public.create_customer_otp(text,text,text),
  public.revoke_customer_otp(uuid), public.verify_customer_otp(text,text,text),
  public.register_customer(text,text,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.create_customer_otp(text,text,text),
  public.revoke_customer_otp(uuid), public.verify_customer_otp(text,text,text),
  public.register_customer(text,text,text,text,boolean,text) to service_role;
