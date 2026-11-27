import {createHash} from 'node:crypto';
import {hashOpaqueCredential, validateOpaqueCredential} from './customer-auth-credentials.js';

export async function findCustomerSession(pool, rawToken) {
  if (!pool || typeof pool.query !== 'function' ||
      !validateOpaqueCredential(rawToken)) return null;
  const hash = hashOpaqueCredential(rawToken);
  const result = await pool.query(
    `select a.id,a.phone_e164,a.first_name,a.last_name,a.marketing_consent,
            s.expires_at
       from public.kimia_customer_access_sessions s
       join public.kimia_customer_accounts a on a.id=s.account_id
      where s.token_hash=$1
        and s.revoked_at is null
        and s.expires_at>clock_timestamp()`,
    [hash],
  );
  const row = result.rows[0];
  return row ? {
    id: row.id,
    phone_e164: row.phone_e164,
    first_name: row.first_name,
    last_name: row.last_name,
    marketing: row.marketing_consent,
  } : null;
}
