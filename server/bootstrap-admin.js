import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Pool} from 'pg';
import {hashPassword} from './passwords.js';

function askVisible(question) {
  const readline = createInterface({input: process.stdin, output: process.stdout});
  return new Promise(resolve => readline.question(question, answer => {
    readline.close();
    resolve(answer.trim());
  }));
}

function askHidden(question) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('A real interactive terminal is required to enter the password safely.');
  }
  process.stdout.write(question);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error, result) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(result);
    };
    const onData = chunk => {
      for (const byte of chunk) {
        if (byte === 3) return finish(new Error('Password input cancelled.'));
        if (byte === 13 || byte === 10) return finish(null, value);
        if (byte === 8 || byte === 127) {
          value = value.slice(0, -1);
          continue;
        }
        if (byte >= 32 && byte <= 126 && value.length < 1024) value += String.fromCharCode(byte);
      }
    };
    process.stdin.on('data', onData);
  });
}

export async function provisionAdmin(pool, email, password) {
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error('Enter a valid administrator email address.');
  }
  if (password.length < 14 || password.length > 1024) throw new Error('Use a password of 14 to 1024 characters.');
  const passwordHash = await hashPassword(password);
  const result = await pool.query(
    `insert into public.kimia_admins(email,password_hash)
     values($1,$2)
     on conflict ((lower(email))) do update set
       password_hash=excluded.password_hash,
       password_changed_at=now(),
       disabled_at=null
     returning id`,
    [normalizedEmail, passwordHash],
  );
  await pool.query('delete from public.kimia_admin_sessions where admin_id=$1', [result.rows[0].id]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required. No account was created.');
    process.exitCode = 2;
  } else {
    const pool = new Pool({connectionString: process.env.DATABASE_URL, password: process.env.DATABASE_PASSWORD || undefined, max: 1, application_name: 'kimia-admin-provision'});
    try {
      const email = await askVisible('Administrator email: ');
      const password = await askHidden('New password (input hidden): ');
      const confirmation = await askHidden('Repeat password (input hidden): ');
      if (password !== confirmation) throw new Error('Passwords do not match.');
      await provisionAdmin(pool, email, password);
      console.log('Administrator credential created or rotated; existing sessions were revoked.');
    } catch (error) {
      console.error(`Administrator provisioning failed: ${error.message}`);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  }
}
