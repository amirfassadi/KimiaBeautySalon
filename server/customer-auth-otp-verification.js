import {createHash} from 'node:crypto';
import {normalizeCustomerPhone, validateOtpFormat} from './customer-auth-validation.js';
import {hashCustomerOtp} from './customer-auth-otp-crypto.js';
import {
  generateOpaqueCredential,
  hashOpaqueCredential,
  validateOpaqueCredential,
  constantTimeHexEqual,
} from './customer-auth-credentials.js';

function secretBytes(secret) {
  if (typeof secret === 'string') return Buffer.from(secret, 'utf8');
  if (secret instanceof Uint8Array) return Buffer.from(secret);
  return null;
}

function phoneKey(phone) {
  return createHash('sha256').update(`kimia:otp:phone:${phone}`, 'utf8').digest('hex');
}

function secondsUntilExpiry(expiresAt, now) {
  const expiry = new Date(expiresAt).getTime();
  return Number.isFinite(expiry) ? Math.max(1, Math.ceil((expiry - now) / 1000)) : null;
}

async function advisoryLock(client, phone) {
  await client.query(
    'select pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`kimia_customer_otp:phone:${phoneKey(phone)}`],
  );
}

export function createOtpVerificationService({pool, hashSecret} = {}) {
  const secretBuffer = secretBytes(hashSecret);
  if (!pool || typeof pool.connect !== 'function' ||
      !secretBuffer || secretBuffer.length < 32) {
    return {
      verify: async () => ({ok: false, code: 'auth_unavailable'}),
    };
  }

  return {
    async verify({phone, code, previousCredential, previousCredentials} = {}) {
      const phoneResult = normalizeCustomerPhone(phone);
      if (!phoneResult.ok) return {ok: false, code: 'invalid_phone'};
      const otpResult = validateOtpFormat(code);
      if (!otpResult.ok) return {ok: false, code: 'invalid_otp_format'};

      const hashResult = hashCustomerOtp({
        secret: secretBuffer,
        phone: phoneResult.value,
        code: otpResult.value,
      });
      if (!hashResult.ok) return {ok: false, code: 'auth_unavailable'};

      const oldCredentials = [];
      if (Array.isArray(previousCredentials)) oldCredentials.push(...previousCredentials);
      else if (previousCredential) oldCredentials.push(previousCredential);

      let client = null;
      try {
        client = await pool.connect();
        await client.query('begin');
        await advisoryLock(client, phoneResult.value);

        const timeResult = await client.query('select clock_timestamp() as clock_now');
        const now = new Date(timeResult.rows[0]?.clock_now);
        if (!Number.isFinite(now.getTime())) throw new Error('Database time unavailable.');
        const nowIso = now.toISOString();

        const challengeResult = await client.query(
          `select id,code_hash,attempts,expires_at,consumed_at,revoked_at
             from public.kimia_customer_otp_challenges
            where phone_e164=$1
              and consumed_at is null
              and revoked_at is null
            order by created_at desc
            limit 1
            for update`,
          [phoneResult.value],
        );
        const challenge = challengeResult.rows[0];
        if (!challenge) {
          await client.query('rollback');
          return {ok: false, code: 'otp_expired'};
        }
        if (new Date(challenge.expires_at).getTime() <= now.getTime()) {
          await client.query('rollback');
          return {ok: false, code: 'otp_expired'};
        }
        if (challenge.attempts >= 5) {
          await client.query('rollback');
          const retryAfter = secondsUntilExpiry(challenge.expires_at, now.getTime());
          if (!retryAfter) throw new Error('Challenge expiry unavailable.');
          return {
            ok: false,
            code: 'otp_locked',
            remaining_attempts: 0,
            retry_after_seconds: retryAfter,
          };
        }

        const matches = constantTimeHexEqual(challenge.code_hash, hashResult.value);
        if (!matches) {
          const attempts = Number(challenge.attempts) + 1;
          await client.query(
            'update public.kimia_customer_otp_challenges set attempts=$1 where id=$2',
            [attempts, challenge.id],
          );
          await client.query('commit');
          if (attempts >= 5) {
            const retryAfter = secondsUntilExpiry(challenge.expires_at, now.getTime());
            if (!retryAfter) throw new Error('Challenge expiry unavailable.');
            return {
              ok: false,
              code: 'otp_locked',
              remaining_attempts: 0,
              retry_after_seconds: retryAfter,
            };
          }
          return {ok: false, code: 'otp_invalid', remaining_attempts: 5 - attempts};
        }

        await client.query(
          'update public.kimia_customer_otp_challenges set consumed_at=$1 where id=$2',
          [nowIso, challenge.id],
        );

        for (const credential of oldCredentials) {
          if (!credential ||
              !validateOpaqueCredential(credential.raw) ||
              !['access', 'registration'].includes(credential.type)) continue;
          const previousHash = hashOpaqueCredential(credential.raw);
          if (!previousHash) continue;
          if (credential.type === 'access') {
            await client.query(
              'update public.kimia_customer_access_sessions set revoked_at=$1 where token_hash=$2',
              [nowIso, previousHash],
            );
          } else {
            await client.query(
              `update public.kimia_customer_registration_proofs
                  set revoked_at=$1
                where proof_hash=$2 and used_at is null and revoked_at is null`,
              [nowIso, previousHash],
            );
          }
        }

        const accountResult = await client.query(
          'select id,first_name,last_name,marketing_consent from public.kimia_customer_accounts where phone_e164=$1',
          [phoneResult.value],
        );
        const account = accountResult.rows[0];
        const rawCredential = generateOpaqueCredential();
        const credentialHash = hashOpaqueCredential(rawCredential);

        if (account) {
          await client.query(
            `insert into public.kimia_customer_access_sessions
               (account_id,phone_e164,token_hash,expires_at,created_at)
             values ($1,$2,$3,$4::timestamptz,$5::timestamptz)`,
            [account.id, phoneResult.value, credentialHash,
              new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
              nowIso],
          );
          await client.query('commit');
          return {
            ok: true,
            is_new_user: false,
            user: {phone_e164: phoneResult.value, first_name: account.first_name,
              last_name: account.last_name, marketing: account.marketing_consent},
            credential: {type: 'access', raw: rawCredential},
          };
        }

        await client.query(
          `insert into public.kimia_customer_registration_proofs
             (phone_e164,proof_hash,expires_at,created_at)
           values ($1,$2,$3::timestamptz,$4::timestamptz)`,
          [phoneResult.value, credentialHash,
            new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
            nowIso],
        );
        await client.query('commit');
        return {
          ok: true,
          is_new_user: true,
          user: {phone_e164: phoneResult.value},
          credential: {type: 'registration', raw: rawCredential},
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
  };
}
