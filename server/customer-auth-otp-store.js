import {createHash} from 'node:crypto';
import net from 'node:net';
import {normalizeCustomerPhone} from './customer-auth-validation.js';

export const OTP_RESERVATION_POLICY = Object.freeze({
  otpExpiresSeconds: 5 * 60,
  resendCooldownSeconds: 60,
  phoneLimit: 3,
  ipLimit: 5,
  rollingWindowSeconds: 60 * 60,
});

const sha256 = value => createHash('sha256').update(value).digest('hex');

function ipv6Groups(value) {
  let text = value;
  if (text.includes('.')) {
    const tail = text.slice(text.lastIndexOf(':') + 1);
    if (net.isIP(tail) !== 4) return null;
    const octets = tail.split('.').map(Number);
    text = text.slice(0, text.lastIndexOf(':')) +
      `:${((octets[0] << 8) | octets[1]).toString(16)}:` +
      `${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (halves.length === 2 && missing < 1) return null;
  const groups = halves.length === 2
    ? [...left, ...Array(missing).fill('0'), ...right]
    : left;
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
  return groups.map(group => Number.parseInt(group, 16));
}

export function normalizeTrustedClientIp(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (!value || value.includes('%')) return null;
  if (net.isIP(value) === 4) return value;
  if (net.isIP(value) !== 6) return null;
  const groups = ipv6Groups(value);
  if (!groups) return null;
  if (groups.slice(0, 5).every(group => group === 0) &&
      groups[5] === 0xffff) {
    const high = groups[6];
    const low = groups[7];
    return `${(high >>> 8) & 255}.${high & 255}.${(low >>> 8) & 255}.${low & 255}`;
  }
  return groups.map(group => group.toString(16)).join(':');
}

function phoneKey(phone) {
  return sha256(`kimia:otp:phone:${phone}`);
}

function ipKey(ip) {
  return sha256(`kimia:otp:trusted_ip:${ip}`);
}

function secondsUntil(timestamp, now) {
  return Math.max(1, Math.ceil((timestamp - now) / 1000));
}

function databaseTime(row) {
  const value = row?.clock_now || row?.now || row?.db_now || row?.current_timestamp;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date;
}

function timestampText(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return String(value);
}

async function advisoryLock(client, namespace, key) {
  await client.query(
    'select pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`kimia_customer_otp:${namespace}:${key}`],
  );
}

export function createCustomerOtpStore({pool} = {}) {
  if (!pool || typeof pool.connect !== 'function') {
    return {
      reserve: async () => ({ok: false, code: 'auth_unavailable'}),
      revoke: async () => ({ok: false, code: 'auth_unavailable'}),
    };
  }

  return {
    async reserve({phone, trustedIp, codeHash} = {}) {
      const phoneResult = normalizeCustomerPhone(phone);
      if (!phoneResult.ok) return {ok: false, code: 'invalid_phone'};
      if (typeof codeHash !== 'string' || !/^[a-f0-9]{64}$/.test(codeHash)) {
        return {ok: false, code: 'invalid_code_hash'};
      }
      const ip = normalizeTrustedClientIp(trustedIp);
      if (!ip) return {ok: false, code: 'invalid_ip'};

      const canonicalPhone = phoneResult.value;
      const phoneKeyHash = phoneKey(canonicalPhone);
      const ipKeyHash = ipKey(ip);
      let client = null;

      try {
        client = await pool.connect();
        await client.query('begin');
        await advisoryLock(client, 'phone', phoneKeyHash);
        await advisoryLock(client, 'ip', ipKeyHash);

        const timeResult = await client.query(
          'select clock_timestamp() as clock_now',
        );
        const now = databaseTime(timeResult.rows[0]);
        if (!now) throw new Error('Database time unavailable.');
        const nowIso = now.toISOString();

        const phoneWindow = await client.query(
          `select count(*)::int as request_count,
                  min(created_at) as oldest_at,
                  max(created_at) as latest_at
             from public.kimia_customer_send_events
            where key_type='phone'
              and key_hash=$1
              and created_at > $2::timestamptz - interval '1 hour'`,
          [phoneKeyHash, nowIso],
        );
        const ipWindow = await client.query(
          `select count(*)::int as request_count,
                  min(created_at) as oldest_at,
                  max(created_at) as latest_at
             from public.kimia_customer_send_events
            where key_type='trusted_ip'
              and key_hash=$1
              and created_at > $2::timestamptz - interval '1 hour'`,
          [ipKeyHash, nowIso],
        );

        const phoneStats = phoneWindow.rows[0];
        const ipStats = ipWindow.rows[0];
        let retryAfterSeconds = 0;

        if (phoneStats.latest_at) {
          const latest = new Date(phoneStats.latest_at).getTime();
          if (latest > now.getTime() - OTP_RESERVATION_POLICY.resendCooldownSeconds * 1000) {
            retryAfterSeconds = Math.max(retryAfterSeconds,
              secondsUntil(latest + OTP_RESERVATION_POLICY.resendCooldownSeconds * 1000, now.getTime()));
          }
        }
        if (phoneStats.request_count >= OTP_RESERVATION_POLICY.phoneLimit) {
          const oldest = new Date(phoneStats.oldest_at).getTime();
          retryAfterSeconds = Math.max(retryAfterSeconds,
            secondsUntil(oldest + OTP_RESERVATION_POLICY.rollingWindowSeconds * 1000, now.getTime()));
        }
        if (ipStats.request_count >= OTP_RESERVATION_POLICY.ipLimit) {
          const oldest = new Date(ipStats.oldest_at).getTime();
          retryAfterSeconds = Math.max(retryAfterSeconds,
            secondsUntil(oldest + OTP_RESERVATION_POLICY.rollingWindowSeconds * 1000, now.getTime()));
        }

        if (retryAfterSeconds > 0) {
          await client.query('rollback');
          return {ok: false, code: 'rate_limited', retry_after_seconds: retryAfterSeconds};
        }

        await client.query(
          `update public.kimia_customer_otp_challenges
              set revoked_at=$1
            where phone_e164=$2
              and consumed_at is null
              and revoked_at is null`,
          [nowIso, canonicalPhone],
        );

        const challenge = await client.query(
          `insert into public.kimia_customer_otp_challenges
             (phone_e164,code_hash,expires_at,attempts,created_at)
           values ($1,$2,$3::timestamptz + interval '5 minutes',0,$3::timestamptz)
           returning id,expires_at,created_at`,
          [canonicalPhone, codeHash, nowIso],
        );

        await client.query(
          `insert into public.kimia_customer_send_events
             (key_type,key_hash,phone_e164,created_at)
           values ('phone',$1,$2,$3::timestamptz)`,
          [phoneKeyHash, canonicalPhone, nowIso],
        );
        await client.query(
          `insert into public.kimia_customer_send_events
             (key_type,key_hash,created_at)
           values ('trusted_ip',$1,$2::timestamptz)`,
          [ipKeyHash, nowIso],
        );

        await client.query('commit');
        const row = challenge.rows[0];
        return {
          ok: true,
          reservation_id: row.id,
          expires_at: timestampText(row.expires_at),
          created_at: timestampText(row.created_at),
        };
      } catch {
        if (client) {
          try { await client.query('rollback'); } catch {}
        }
        return {ok: false, code: 'auth_unavailable'};
      } finally {
        if (client) client.release();
      }
    },

    async revoke(reservationId) {
      if (typeof reservationId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reservationId)) {
        return {ok: false, code: 'invalid_reservation_id'};
      }
      let client = null;
      try {
        client = await pool.connect();
        await client.query('begin');
        const result = await client.query(
          `update public.kimia_customer_otp_challenges
              set revoked_at=clock_timestamp()
            where id=$1
              and consumed_at is null
              and revoked_at is null
            returning id`,
          [reservationId.toLowerCase()],
        );
        await client.query('commit');
        return {ok: true, revoked: result.rows.length === 1};
      } catch {
        if (client) {
          try { await client.query('rollback'); } catch {}
        }
        return {ok: false, code: 'auth_unavailable'};
      } finally {
        if (client) client.release();
      }
    },
  };
}
