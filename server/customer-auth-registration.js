import {createHash} from 'node:crypto';
import {validateCustomerProfile} from './customer-auth-validation.js';
import {
  generateOpaqueCredential,
  hashOpaqueCredential,
  validateOpaqueCredential,
} from './customer-auth-credentials.js';

async function phoneLock(client, phone) {
  const phoneKey = createHash('sha256').update(`kimia:otp:phone:${phone}`, 'utf8').digest('hex');
  await client.query(
    'select pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`kimia_customer_otp:phone:${phoneKey}`],
  );
}

export function createCustomerRegistrationService({pool} = {}) {
  if (!pool || typeof pool.connect !== 'function') {
    return {register: async () => ({ok: false, code: 'auth_unavailable'})};
  }
  return {
    async register({profile, registrationCredential, previousCredential, previousCredentials} = {}) {
      const profileResult = validateCustomerProfile(profile);
      if (!profileResult.ok) return {ok: false, code: 'invalid_profile'};
      if (!validateOpaqueCredential(registrationCredential)) {
        return {ok: false, code: 'registration_proof_missing'};
      }

      const proofHash = hashOpaqueCredential(registrationCredential);
      const oldCredentials = [];
      if (Array.isArray(previousCredentials)) oldCredentials.push(...previousCredentials);
      else if (previousCredential) oldCredentials.push(previousCredential);
      let client = null;
      try {
        client = await pool.connect();
        await client.query('begin');

        const preliminary = await client.query(
          `select phone_e164,expires_at,used_at,revoked_at
             from public.kimia_customer_registration_proofs
            where proof_hash=$1`,
          [proofHash],
        );
        const proof = preliminary.rows[0];
        if (!proof) {
          await client.query('rollback');
          return {ok: false, code: 'registration_proof_missing'};
        }

        await phoneLock(client, proof.phone_e164);
        const timeResult = await client.query('select clock_timestamp() as clock_now');
        const now = new Date(timeResult.rows[0]?.clock_now);
        if (!Number.isFinite(now.getTime())) throw new Error('Database time unavailable.');
        const nowIso = now.toISOString();

        const lockedProof = await client.query(
          `select id,phone_e164,expires_at,used_at,revoked_at
             from public.kimia_customer_registration_proofs
            where proof_hash=$1
            for update`,
          [proofHash],
        );
        const current = lockedProof.rows[0];
        if (!current) {
          await client.query('rollback');
          return {ok: false, code: 'registration_proof_missing'};
        }
        if (current.used_at || current.revoked_at) {
          await client.query('rollback');
          return {ok: false, code: 'registration_proof_missing'};
        }
        if (new Date(current.expires_at).getTime() <= now.getTime()) {
          await client.query('rollback');
          return {ok: false, code: 'registration_expired'};
        }

        const existing = await client.query(
          'select id from public.kimia_customer_accounts where phone_e164=$1',
          [current.phone_e164],
        );
        if (existing.rows[0]) {
          await client.query(
            'update public.kimia_customer_registration_proofs set used_at=$1 where id=$2',
            [nowIso, current.id],
          );
          for (const credential of oldCredentials) {
            if (!credential ||
                !validateOpaqueCredential(credential.raw) ||
                credential.type !== 'access') continue;
            const previousHash = hashOpaqueCredential(credential.raw);
            if (previousHash) {
              await client.query(
                'update public.kimia_customer_access_sessions set revoked_at=$1 where token_hash=$2',
                [nowIso, previousHash],
              );
            }
          }
          await client.query('commit');
          return {ok: false, code: 'account_exists', recovery_action: 'login'};
        }

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
            if (previousHash === proofHash) continue;
            await client.query(
              `update public.kimia_customer_registration_proofs
                  set revoked_at=$1
                where proof_hash=$2 and used_at is null and revoked_at is null`,
              [nowIso, previousHash],
            );
          }
        }

        const account = await client.query(
          `insert into public.kimia_customer_accounts
             (phone_e164,first_name,last_name,marketing_consent,marketing_consent_at)
           values ($1,$2,$3,$4,$5)
           returning id`,
          [
            current.phone_e164,
            profileResult.value.first_name,
            profileResult.value.last_name,
            profileResult.value.marketing,
            profileResult.value.marketing ? nowIso : null,
          ],
        );
        const accountId = account.rows[0]?.id;
        if (!accountId) throw new Error('Account creation did not return an ID.');

        const referral = profileResult.value.referral;
        const referralDeclared = referral.discovery_channel !== 'not_reported' ||
          referral.site_referrer.status !== 'not_reported' ||
          referral.salon_referrer.status !== 'not_reported';
        await client.query(
          `insert into public.kimia_customer_referrals
             (customer_account_id,site_discovery_channel,
              site_declaration_status,site_declaration_kind,site_declaration_value,
              salon_declaration_status,salon_declaration_kind,salon_declaration_value,
              same_referrer_declared,declaration_recorded_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz)`,
          [
            accountId,
            referral.discovery_channel,
            referral.site_referrer.status,
            referral.site_referrer.kind,
            referral.site_referrer.value,
            referral.salon_referrer.status,
            referral.salon_referrer.kind,
            referral.salon_referrer.value,
            referral.same_referrer,
            referralDeclared ? nowIso : null,
          ],
        );

        await client.query(
          'update public.kimia_customer_registration_proofs set used_at=$1 where id=$2',
          [nowIso, current.id],
        );

        const rawCredential = generateOpaqueCredential();
        const credentialHash = hashOpaqueCredential(rawCredential);
        await client.query(
          `insert into public.kimia_customer_access_sessions
             (account_id,phone_e164,token_hash,expires_at,created_at)
           values ($1,$2,$3,$4::timestamptz,$5::timestamptz)`,
          [
            accountId,
            current.phone_e164,
            credentialHash,
            new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            nowIso,
          ],
        );

        await client.query('commit');
        return {
          ok: true,
          account_id: accountId,
          credential: {type: 'access', raw: rawCredential},
          user: {
            phone_e164: current.phone_e164,
            first_name: profileResult.value.first_name,
            last_name: profileResult.value.last_name,
            marketing: profileResult.value.marketing,
          },
        };
      } catch (error) {
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
