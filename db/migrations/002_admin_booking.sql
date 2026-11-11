-- Append-only migration. Apply after 001 on Supabase PostgreSQL.
create table public.site_settings (
 id boolean primary key default true check(id),
 content jsonb not null default '{}'::jsonb check (jsonb_typeof(content)='object'),
 updated_at timestamptz not null default now()
);
alter table public.site_settings enable row level security;
revoke all on public.site_settings from anon, authenticated;
insert into public.site_settings(id) values(true);

alter table public.services add column seo_title text;
alter table public.services add column seo_description text;
alter table public.services add column details_fa text;
alter table public.gallery_items add column consent_confirmed boolean not null default false;
alter table public.gallery_items add column updated_at timestamptz not null default now();
alter table public.booking_requests add column request_key uuid unique;
alter table public.booking_requests add column request_fingerprint text;
alter table public.booking_requests add column consent_at timestamptz;
alter table public.booking_requests add column preferred_at timestamptz;

create table public.admin_audit (
 id uuid primary key default gen_random_uuid(), actor_id text not null,
 action text not null, entity_id uuid, created_at timestamptz not null default now()
);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon,authenticated;
grant all on public.site_settings,public.services,public.service_categories,public.staff_members,public.business_hours,public.gallery_items,public.booking_requests,public.appointments,public.booking_rate_limits,public.admin_audit to service_role;

-- Correct the legacy RPC RETURNING ambiguity without changing migration 001.
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

  insert into public.booking_requests as inserted
    (service_id, customer_name, phone_e164, preferred_time_text, note, source)
  values
    (v_service_id, v_name, p_phone_e164, v_time, v_note, 'website')
  returning inserted.id, inserted.reference_code into v_request_id, v_reference;

  return query select v_request_id, v_reference;
end;
$$;

revoke all on function public.create_booking_request(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_booking_request(text, text, text, text, text, text) to service_role;

create or replace function public.create_booking_v2(
 p_customer_name text,p_phone_e164 text,p_service_slug text,p_preferred_time_text text,
 p_note text,p_ip_hash text,p_request_key uuid,p_consent boolean,p_preferred_at timestamptz default null
) returns table(request_id uuid,reference_code text)
language plpgsql security definer set search_path='' as $$
declare v_old public.booking_requests;v_id uuid;v_code text;v_fingerprint text;v_local timestamp;
begin
 if p_consent is distinct from true or p_request_key is null then raise exception 'consent_required';end if;
 v_fingerprint:=pg_catalog.md5(pg_catalog.concat_ws('|',p_customer_name,p_phone_e164,p_service_slug,p_preferred_time_text,p_note,p_preferred_at));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_key::text,0));
 select * into v_old from public.booking_requests where request_key=p_request_key;
 if found then
  if v_old.request_fingerprint is distinct from v_fingerprint then raise exception 'idempotency_conflict';end if;
  return query select v_old.id,v_old.reference_code;return;
 end if;
 if p_preferred_at is not null then
  v_local:=p_preferred_at at time zone 'Asia/Tehran';
  if p_preferred_at < now() or not exists(select 1 from public.business_hours where iso_weekday=extract(isodow from v_local) and not is_closed and v_local::time >= opens_at and v_local::time < closes_at) then raise exception 'invalid_preferred_time';end if;
 end if;
 select b.request_id,b.reference_code into v_id,v_code from public.create_booking_request(p_customer_name,p_phone_e164,p_service_slug,p_preferred_time_text,p_note,p_ip_hash) b;
 update public.booking_requests set request_key=p_request_key,request_fingerprint=v_fingerprint,consent_at=now(),preferred_at=p_preferred_at where id=v_id;
 return query select v_id,v_code;
end;$$;
revoke all on function public.create_booking_v2(text,text,text,text,text,text,uuid,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.create_booking_v2(text,text,text,text,text,text,uuid,boolean,timestamptz) to service_role;

create or replace function public.manage_booking(p_request_id uuid,p_action text,p_actor_id text,p_staff_id uuid default null,p_starts_at timestamptz default null,p_ends_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_request public.booking_requests;v_appointment uuid;v_local timestamp;v_end timestamp;
begin
 if p_actor_id is null or length(p_actor_id)=0 then raise exception 'unauthorized';end if;
 select * into v_request from public.booking_requests where id=p_request_id for update;
 if not found then raise exception 'request_not_found';end if;
 if p_action='confirm' then
  if v_request.status not in ('new','contacted') then raise exception 'invalid_transition';end if;
  if p_staff_id is null or p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at or p_starts_at<now() then raise exception 'invalid_time';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_staff_id::text,1));
  if not exists(select 1 from public.staff_members where id=p_staff_id and is_active) then raise exception 'invalid_staff';end if;
  v_local:=p_starts_at at time zone 'Asia/Tehran';v_end:=p_ends_at at time zone 'Asia/Tehran';
  if v_local::date<>v_end::date or not exists(select 1 from public.business_hours where iso_weekday=extract(isodow from v_local) and not is_closed and v_local::time>=opens_at and v_end::time<=closes_at) then raise exception 'outside_business_hours';end if;
  if exists(select 1 from public.appointments where staff_member_id=p_staff_id and status='confirmed' and starts_at<p_ends_at and ends_at>p_starts_at) then raise exception 'slot_conflict';end if;
  insert into public.appointments(booking_request_id,service_id,staff_member_id,customer_name,phone_e164,starts_at,ends_at) values(v_request.id,v_request.service_id,p_staff_id,v_request.customer_name,v_request.phone_e164,p_starts_at,p_ends_at) returning id into v_appointment;
  update public.booking_requests set status='converted',updated_at=now() where id=p_request_id;
 elsif p_action='contacted' and v_request.status='new' then
  update public.booking_requests set status='contacted',updated_at=now() where id=p_request_id;
 elsif p_action='decline' and v_request.status in ('new','contacted') then
  update public.booking_requests set status='declined',updated_at=now() where id=p_request_id;
 elsif p_action='cancel' and v_request.status='converted' then
  update public.appointments set status='cancelled',updated_at=now() where booking_request_id=p_request_id and status='confirmed';
  update public.booking_requests set status='declined',updated_at=now() where id=p_request_id;
 else raise exception 'invalid_transition';end if;
 insert into public.admin_audit(actor_id,action,entity_id) values(p_actor_id,p_action,p_request_id);
 return jsonb_build_object('ok',true,'appointment_id',v_appointment);
end;$$;
revoke all on function public.manage_booking(uuid,text,text,uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.manage_booking(uuid,text,text,uuid,timestamptz,timestamptz) to service_role;

-- Public visibility also requires the salon's recorded publication consent.
drop policy if exists gallery_public_read on public.gallery_items;
create policy gallery_public_read on public.gallery_items for select to anon,authenticated using (is_published and consent_confirmed);
