// Apply the approved schedule once; later admin edits remain authoritative.
const REVISION = 'all-days-10-19-2026-11-24';

export async function applyBusinessHours(pool) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const {rows} = await client.query('select content from public.site_settings where id=true for update');
    if (!rows[0]) throw new Error('Salon settings are missing.');
    if (rows[0].content.business_hours_revision !== REVISION) {
      await client.query(`insert into public.business_hours (iso_weekday, opens_at, closes_at, is_closed)
        select day, time '10:00', time '19:00', false from generate_series(1, 7) as day
        on conflict (iso_weekday) do update set opens_at=excluded.opens_at,
          closes_at=excluded.closes_at, is_closed=excluded.is_closed`);
      await client.query(`update public.site_settings
        set content=content || jsonb_build_object('business_hours_revision', $1::text), updated_at=now()
        where id=true`, [REVISION]);
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
