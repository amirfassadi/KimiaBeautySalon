create or replace function public.lookup_booking(p_reference_code text,p_phone_e164 text,p_ip_hash text)
returns table(status text,starts_at timestamptz,ends_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
 if p_reference_code !~ '^[A-F0-9]{10}$' or p_phone_e164 !~ '^\+989[0-9]{9}$' or p_ip_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_lookup';end if;
 insert into public.booking_rate_limits as rl(ip_hash,window_started_at,request_count) values('lookup:'||p_ip_hash,now(),1)
 on conflict(ip_hash) do update set window_started_at=case when rl.window_started_at <= now()-interval '1 hour' then now() else rl.window_started_at end,request_count=case when rl.window_started_at <= now()-interval '1 hour' then 1 else rl.request_count+1 end returning request_count into v_count;
 if v_count>10 then raise exception 'rate_limited';end if;
 return query select b.status,a.starts_at,a.ends_at from public.booking_requests b left join public.appointments a on a.booking_request_id=b.id where b.reference_code=p_reference_code and b.phone_e164=p_phone_e164;
end;$$;
revoke all on function public.lookup_booking(text,text,text) from public,anon,authenticated;
grant execute on function public.lookup_booking(text,text,text) to service_role;
