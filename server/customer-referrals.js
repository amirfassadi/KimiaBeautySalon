const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DISCOVERY_CHANNELS = new Set([
  'not_reported',
  'unknown',
  'personal_referral',
  'instagram',
  'search',
  'walk_in',
  'other',
]);
const ATTRIBUTION_STATUSES = new Set(['unknown', 'none', 'confirmed']);
const PERSON_KINDS = new Set(['customer', 'staff', 'external']);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

function validatePerson(entry) {
  if (!isPlainObject(entry) ||
      Object.keys(entry).some(key => !['status', 'name', 'person_kind', 'introduced_on'].includes(key)) ||
      !ATTRIBUTION_STATUSES.has(entry.status)) return null;
  const introducedOn = validDate(entry.introduced_on);
  if (introducedOn === undefined) return null;
  if (entry.status !== 'confirmed') {
    if (entry.name !== undefined || entry.person_kind !== undefined || introducedOn) return null;
    return {status: entry.status, introduced_on: null, person: null};
  }
  if (typeof entry.name !== 'string' ||
      /[\p{Cc}\u2028\u2029]/u.test(entry.name) ||
      !PERSON_KINDS.has(entry.person_kind)) return null;
  const name = entry.name.trim();
  const length = Array.from(name).length;
  if (length < 2 || length > 150) return null;
  return {
    status: 'confirmed',
    introduced_on: introducedOn,
    person: {display_name: name, person_kind: entry.person_kind},
  };
}

export function validateCustomerReferralAdminInput(input) {
  try {
    if (!isPlainObject(input) ||
        Object.keys(input).some(key =>
          !['discovery_channel', 'site_referrer', 'salon_referrer', 'change_reason'].includes(key))) {
      return {ok: false, code: 'invalid_referral'};
    }
    if (!DISCOVERY_CHANNELS.has(input.discovery_channel)) {
      return {ok: false, code: 'invalid_referral'};
    }
    const site = validatePerson(input.site_referrer);
    if (!site || !isPlainObject(input.salon_referrer) ||
        Object.keys(input.salon_referrer).some(key =>
          !['same_as_site', 'status', 'name', 'person_kind', 'introduced_on'].includes(key))) {
      return {ok: false, code: 'invalid_referral'};
    }
    const sameAsSite = input.salon_referrer.same_as_site === true;
    let salon;
    if (sameAsSite) {
      if (site.status !== 'confirmed') return {ok: false, code: 'invalid_referral'};
      if (Object.hasOwn(input.salon_referrer, 'status') ||
          Object.hasOwn(input.salon_referrer, 'name') ||
          Object.hasOwn(input.salon_referrer, 'person_kind')) {
        return {ok: false, code: 'invalid_referral'};
      }
      const introducedOn = validDate(input.salon_referrer.introduced_on);
      if (introducedOn === undefined) return {ok: false, code: 'invalid_referral'};
      salon = {...site, introduced_on: site.status === 'confirmed' ? introducedOn : null};
    } else {
      salon = validatePerson(input.salon_referrer);
      if (!salon) return {ok: false, code: 'invalid_referral'};
    }
    const changeReason = input.change_reason === undefined ? null : input.change_reason;
    if (changeReason !== null &&
        (typeof changeReason !== 'string' ||
         /[\p{Cc}\u2028\u2029]/u.test(changeReason) ||
         Array.from(changeReason.trim()).length > 500)) {
      return {ok: false, code: 'invalid_referral'};
    }
    return {
      ok: true,
      value: {
        discovery_channel: input.discovery_channel,
        site,
        salon,
        same_as_site: sameAsSite,
        change_reason: changeReason?.trim() || null,
      },
    };
  } catch {
    return {ok: false, code: 'invalid_referral'};
  }
}

function referralSnapshot(row) {
  if (!row) return null;
  return {
    discovery_channel: row.site_discovery_channel,
    customer_declaration: {
      site: {
        status: row.site_declaration_status,
        kind: row.site_declaration_kind,
        value: row.site_declaration_value,
      },
      salon: {
        status: row.salon_declaration_status,
        kind: row.salon_declaration_kind,
        value: row.salon_declaration_value,
      },
      same_referrer: row.same_referrer_declared,
      recorded_at: row.declaration_recorded_at,
    },
    site: {
      status: row.site_verification_status,
      person: row.site_person_id ? {
        id: row.site_person_id,
        name: row.site_person_name,
        kind: row.site_person_kind,
      } : null,
      introduced_on: row.site_introduced_on,
    },
    salon: {
      status: row.salon_verification_status,
      person: row.salon_person_id ? {
        id: row.salon_person_id,
        name: row.salon_person_name,
        kind: row.salon_person_kind,
      } : null,
      introduced_on: row.salon_introduced_on,
    },
    same_referrer_confirmed: row.same_referrer_confirmed,
    recorded_by_admin_id: row.recorded_by_admin_id,
    recorded_at: row.recorded_at,
  };
}

const REFERRAL_SELECT = `
  select r.*,
         site_person.id as site_person_id,
         site_person.display_name as site_person_name,
         site_person.person_kind as site_person_kind,
         salon_person.id as salon_person_id,
         salon_person.display_name as salon_person_name,
         salon_person.person_kind as salon_person_kind
    from public.kimia_customer_referrals r
    left join public.kimia_referral_people site_person
      on site_person.id=r.site_referrer_person_id
    left join public.kimia_referral_people salon_person
      on salon_person.id=r.salon_referrer_person_id`;

export function createCustomerReferralAdminService({pool} = {}) {
  return {
    async list(search = '') {
      if (typeof search !== 'string' || Array.from(search.trim()).length > 100) {
        return {ok: false, code: 'invalid_search'};
      }
      const query = search.trim();
      const result = await pool.query(
        `select a.id,a.phone_e164,a.first_name,a.last_name,a.created_at,
                r.site_discovery_channel,
                r.site_declaration_status,r.site_declaration_kind,r.site_declaration_value,
                r.salon_declaration_status,r.salon_declaration_kind,r.salon_declaration_value,
                r.same_referrer_declared,
                coalesce(r.site_verification_status,'not_reviewed') as site_verification_status,
                site_person.display_name as site_referrer_name,
                site_person.person_kind as site_referrer_kind,
                r.site_introduced_on,
                coalesce(r.salon_verification_status,'not_reviewed') as salon_verification_status,
                salon_person.display_name as salon_referrer_name,
                salon_person.person_kind as salon_referrer_kind,
                r.salon_introduced_on,r.same_referrer_confirmed,
                r.recorded_at,admin.email as recorded_by
           from public.kimia_customer_accounts a
           left join public.kimia_customer_referrals r on r.customer_account_id=a.id
           left join public.kimia_referral_people site_person
             on site_person.id=r.site_referrer_person_id
           left join public.kimia_referral_people salon_person
             on salon_person.id=r.salon_referrer_person_id
           left join public.kimia_admins admin on admin.id=r.recorded_by_admin_id
          where $1='' or a.phone_e164 ilike '%' || $1 || '%'
             or a.first_name ilike '%' || $1 || '%'
             or a.last_name ilike '%' || $1 || '%'
          order by a.created_at desc
          limit 50`,
        [query],
      );
      return {ok: true, customers: result.rows};
    },

    async history(customerId) {
      if (typeof customerId !== 'string' || !UUID.test(customerId)) {
        return {ok: false, code: 'invalid_customer'};
      }
      const result = await pool.query(
        `select h.id,h.event_type,h.change_reason,h.previous_state,h.new_state,h.created_at,
                admin.email as actor_email
           from public.kimia_customer_referral_history h
           join public.kimia_admins admin on admin.id=h.actor_admin_id
          where h.customer_account_id=$1
          order by h.created_at desc,h.id desc
          limit 100`,
        [customerId.toLowerCase()],
      );
      return {ok: true, history: result.rows};
    },

    async save({customerId, actorId, input} = {}) {
      if (typeof customerId !== 'string' || !UUID.test(customerId) ||
          typeof actorId !== 'string' || !UUID.test(actorId)) {
        return {ok: false, code: 'invalid_referral'};
      }
      const validation = validateCustomerReferralAdminInput(input);
      if (!validation.ok) return validation;
      const referral = validation.value;
      let client = null;
      try {
        if (typeof pool?.connect !== 'function') throw new Error('Transactional pool required.');
        client = await pool.connect();
        await client.query('begin');
        const account = await client.query(
          'select id from public.kimia_customer_accounts where id=$1 for update',
          [customerId.toLowerCase()],
        );
        if (!account.rows[0]) {
          await client.query('rollback');
          return {ok: false, code: 'customer_not_found'};
        }
        const existing = await client.query(
          `${REFERRAL_SELECT}
            where r.customer_account_id=$1
            for update of r`,
          [customerId.toLowerCase()],
        );
        const previous = referralSnapshot(existing.rows[0]);
        const clock = await client.query('select clock_timestamp() as clock_now');
        const now = new Date(clock.rows[0]?.clock_now);
        if (!Number.isFinite(now.getTime())) throw new Error('Database time unavailable.');
        const nowIso = now.toISOString();

        async function createPerson(person) {
          if (!person) return null;
          const result = await client.query(
            `insert into public.kimia_referral_people
               (display_name,person_kind,created_by_admin_id)
             values ($1,$2,$3)
             returning id`,
            [person.display_name, person.person_kind, actorId.toLowerCase()],
          );
          return result.rows[0]?.id || null;
        }

        const sitePersonId = await createPerson(referral.site.person);
        const salonPersonId = referral.same_as_site
          ? sitePersonId
          : await createPerson(referral.salon.person);
        if (referral.site.person && !sitePersonId ||
            referral.salon.person && !salonPersonId) {
          throw new Error('Referral identity creation failed.');
        }

        await client.query(
          `insert into public.kimia_customer_referrals
             (customer_account_id,site_discovery_channel,
              site_verification_status,site_referrer_person_id,site_introduced_on,
              salon_verification_status,salon_referrer_person_id,salon_introduced_on,
              same_referrer_confirmed,recorded_by_admin_id,recorded_at,updated_at)
           values ($1,$2,$3,$4,$5::date,$6,$7,$8::date,$9,$10,$11::timestamptz,$11::timestamptz)
           on conflict (customer_account_id) do update set
             site_discovery_channel=excluded.site_discovery_channel,
             site_verification_status=excluded.site_verification_status,
             site_referrer_person_id=excluded.site_referrer_person_id,
             site_introduced_on=excluded.site_introduced_on,
             salon_verification_status=excluded.salon_verification_status,
             salon_referrer_person_id=excluded.salon_referrer_person_id,
             salon_introduced_on=excluded.salon_introduced_on,
             same_referrer_confirmed=excluded.same_referrer_confirmed,
             recorded_by_admin_id=excluded.recorded_by_admin_id,
             recorded_at=excluded.recorded_at,
             updated_at=excluded.updated_at`,
          [
            customerId.toLowerCase(),
            referral.discovery_channel,
            referral.site.status,
            sitePersonId,
            referral.site.introduced_on,
            referral.salon.status,
            salonPersonId,
            referral.salon.introduced_on,
            referral.same_as_site,
            actorId.toLowerCase(),
            nowIso,
          ],
        );
        const saved = await client.query(
          `${REFERRAL_SELECT}
            where r.customer_account_id=$1`,
          [customerId.toLowerCase()],
        );
        const next = referralSnapshot(saved.rows[0]);
        const previouslyReviewed = previous &&
          (previous.site.status !== 'not_reviewed' || previous.salon.status !== 'not_reviewed');
        const previouslyConfirmed = previous &&
          (previous.site.status === 'confirmed' || previous.salon.status === 'confirmed');
        const nowConfirmed = next.site.status === 'confirmed' || next.salon.status === 'confirmed';
        let eventType = 'corrected';
        if (!previous || (!previouslyReviewed && !nowConfirmed)) eventType = 'recorded';
        else if (nowConfirmed && !previouslyConfirmed) eventType = 'confirmed';
        await client.query(
          `insert into public.kimia_customer_referral_history
             (customer_account_id,event_type,actor_admin_id,change_reason,previous_state,new_state)
           values ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
          [
            customerId.toLowerCase(),
            eventType,
            actorId.toLowerCase(),
            referral.change_reason,
            JSON.stringify(previous),
            JSON.stringify(next),
          ],
        );
        await client.query('commit');
        return {ok: true, referral: next};
      } catch {
        if (client) try { await client.query('rollback'); } catch {}
        return {ok: false, code: 'auth_unavailable'};
      } finally {
        if (client) client.release();
      }
    },
  };
}
