// pg parses connectionString after other options, so a password supplied as a
// separate Pool option can be overwritten by an empty password in the URL.
export function postgresConfig(env, options = {}) {
  let url;
  try { url = new URL(env.DATABASE_URL); } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol.');
  }
  if (typeof env.DATABASE_PASSWORD === 'string' && env.DATABASE_PASSWORD.length > 0) {
    // Encode explicitly: URL.password preserves existing percent escapes, while
    // a literal percent sign in the supplied password must remain literal.
    url.password = encodeURIComponent(env.DATABASE_PASSWORD);
    url.searchParams.delete('password');
  }
  return {...options, connectionString: url.href};
}
