create table public.kimia_referral_people (
  id uuid primary key default gen_random_uuid(),
  display_name text not null
    check (char_length(display_name) between 2 and 150),
  person_kind text not null
    check (person_kind in ('customer','staff','external')),
  created_by_admin_id uuid not null
    references public.kimia_admins(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.kimia_customer_referrals (
  customer_account_id uuid primary key
    references public.kimia_customer_accounts(id) on delete restrict,
  site_discovery_channel text not null default 'not_reported'
    check (site_discovery_channel in
      ('not_reported','unknown','personal_referral','instagram','search','walk_in','other')),
  site_declaration_status text not null default 'not_reported'
    check (site_declaration_status in ('not_reported','unknown','none','pending')),
  site_declaration_kind text
    check (site_declaration_kind is null or site_declaration_kind in ('name','code')),
  site_declaration_value text,
  salon_declaration_status text not null default 'not_reported'
    check (salon_declaration_status in ('not_reported','unknown','none','pending')),
  salon_declaration_kind text
    check (salon_declaration_kind is null or salon_declaration_kind in ('name','code')),
  salon_declaration_value text,
  same_referrer_declared boolean not null default false,
  declaration_recorded_at timestamptz,
  site_verification_status text not null default 'not_reviewed'
    check (site_verification_status in ('not_reviewed','unknown','none','confirmed')),
  site_referrer_person_id uuid
    references public.kimia_referral_people(id) on delete restrict,
  site_introduced_on date,
  salon_verification_status text not null default 'not_reviewed'
    check (salon_verification_status in ('not_reviewed','unknown','none','confirmed')),
  salon_referrer_person_id uuid
    references public.kimia_referral_people(id) on delete restrict,
  salon_introduced_on date,
  same_referrer_confirmed boolean not null default false,
  recorded_by_admin_id uuid
    references public.kimia_admins(id) on delete restrict,
  recorded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (site_declaration_status = 'pending' and
      site_declaration_kind is not null and site_declaration_value is not null and
      char_length(site_declaration_value) between 2 and 120) or
    (site_declaration_status <> 'pending' and
      site_declaration_kind is null and site_declaration_value is null)
  ),
  check (
    (salon_declaration_status = 'pending' and
      salon_declaration_kind is not null and salon_declaration_value is not null and
      char_length(salon_declaration_value) between 2 and 120) or
    (salon_declaration_status <> 'pending' and
      salon_declaration_kind is null and salon_declaration_value is null)
  ),
  check (
    not same_referrer_declared or
      (site_declaration_status = salon_declaration_status and
       site_declaration_kind is not distinct from salon_declaration_kind and
       site_declaration_value is not distinct from salon_declaration_value)
  ),
  check (
    (site_verification_status = 'confirmed' and site_referrer_person_id is not null) or
    (site_verification_status <> 'confirmed' and site_referrer_person_id is null and site_introduced_on is null)
  ),
  check (
    (salon_verification_status = 'confirmed' and salon_referrer_person_id is not null) or
    (salon_verification_status <> 'confirmed' and salon_referrer_person_id is null and salon_introduced_on is null)
  ),
  check (
    not same_referrer_confirmed or
      (site_verification_status = salon_verification_status and
       site_referrer_person_id is not distinct from salon_referrer_person_id)
  ),
  check ((recorded_by_admin_id is null) = (recorded_at is null))
);
create index kimia_customer_referrals_recorded_idx
  on public.kimia_customer_referrals (recorded_at desc);

create table public.kimia_customer_referral_history (
  id uuid primary key default gen_random_uuid(),
  customer_account_id uuid not null
    references public.kimia_customer_accounts(id) on delete restrict,
  event_type text not null check (event_type in ('recorded','confirmed','corrected')),
  actor_admin_id uuid not null
    references public.kimia_admins(id) on delete restrict,
  change_reason text check (change_reason is null or char_length(change_reason) <= 500),
  previous_state jsonb,
  new_state jsonb not null,
  created_at timestamptz not null default now()
);
create index kimia_customer_referral_history_customer_idx
  on public.kimia_customer_referral_history (customer_account_id, created_at desc);

alter table public.kimia_referral_people enable row level security;
alter table public.kimia_customer_referrals enable row level security;
alter table public.kimia_customer_referral_history enable row level security;

revoke all on public.kimia_referral_people,
  public.kimia_customer_referrals,
  public.kimia_customer_referral_history
  from public, anon, authenticated, service_role;

grant all on public.kimia_referral_people,
  public.kimia_customer_referrals,
  public.kimia_customer_referral_history
  to current_user;
