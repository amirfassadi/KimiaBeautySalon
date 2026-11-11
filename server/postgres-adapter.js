const TABLES = Object.freeze({
  site_settings: new Set(['id', 'content', 'updated_at']),
  service_categories: new Set(['id', 'slug', 'name_fa', 'description_fa', 'sort_order', 'is_active', 'created_at', 'updated_at']),
  services: new Set(['id', 'category_id', 'slug', 'name_fa', 'description_fa', 'details_fa', 'duration_minutes', 'sort_order', 'is_active', 'seo_title', 'seo_description', 'created_at', 'updated_at']),
  staff_members: new Set(['id', 'display_name', 'role_title', 'bio', 'avatar_url', 'is_active', 'sort_order', 'created_at', 'updated_at']),
  business_hours: new Set(['iso_weekday', 'opens_at', 'closes_at', 'is_closed']),
  gallery_items: new Set(['id', 'service_id', 'image_url', 'alt_text_fa', 'caption_fa', 'is_published', 'consent_confirmed', 'sort_order', 'created_at', 'updated_at']),
  booking_requests: new Set(['id', 'reference_code', 'service_id', 'customer_name', 'phone_e164', 'preferred_time_text', 'note', 'status', 'source', 'request_key', 'request_fingerprint', 'consent_at', 'preferred_at', 'created_at', 'updated_at']),
  appointments: new Set(['id', 'booking_request_id', 'service_id', 'staff_member_id', 'customer_name', 'phone_e164', 'starts_at', 'ends_at', 'status', 'internal_note', 'created_at', 'updated_at']),
});
const FILTER_COLUMNS = Object.freeze({
  site_settings: new Set(['id']),
  services: new Set(['is_active', 'id', 'slug']),
  staff_members: new Set(['is_active', 'id']),
  business_hours: new Set(['iso_weekday']),
  gallery_items: new Set(['is_published', 'consent_confirmed', 'image_url', 'service_id', 'id']),
  booking_requests: new Set(['id', 'status']),
  appointments: new Set(['id', 'status']),
});
const ORDER_COLUMNS = Object.freeze({
  services: new Set(['sort_order', 'created_at']),
  service_categories: new Set(['sort_order']),
  staff_members: new Set(['sort_order']),
  business_hours: new Set(['iso_weekday']),
  gallery_items: new Set(['sort_order', 'created_at']),
  booking_requests: new Set(['created_at']),
  appointments: new Set(['starts_at', 'created_at']),
});

function assertIdentifier(identifier, allowed, label) {
  if (!allowed?.has(identifier)) throw new Error(`Unsupported database ${label}.`);
  return `"${identifier}"`;
}

function parseEq(value) {
  if (!value.startsWith('eq.')) throw new Error('Unsupported database filter.');
  return value.slice(3);
}

function parseSelect(columns, table) {
  if (!columns || columns === '*') return '*';
  return columns.split(',').map(column => assertIdentifier(column, TABLES[table], 'column')).join(', ');
}

function addFilters(table, params, values) {
  const clauses = [];
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit'].includes(key)) continue;
    const column = assertIdentifier(key, FILTER_COLUMNS[table], 'filter');
    const value = parseEq(raw);
    if (value === 'true' || value === 'false') values.push(value === 'true');
    else values.push(value);
    clauses.push(`${column} = $${values.length}`);
  }
  return clauses.length ? ` where ${clauses.join(' and ')}` : '';
}

function parseLimit(value) {
  if (value === null) return null;
  if (!/^(?:0|[1-9]\d{0,2})$/.test(value) || Number(value) > 200) throw new Error('Unsupported database limit.');
  return Number(value);
}

function parseOrder(table, value) {
  if (!value) return '';
  const match = /^([a-z_]+)\.(asc|desc)$/.exec(value);
  if (!match) throw new Error('Unsupported database order.');
  return ` order by ${assertIdentifier(match[1], ORDER_COLUMNS[table], 'order')} ${match[2]}`;
}

function parsePath(path) {
  const url = new URL(path, 'http://localhost');
  if (!url.pathname.startsWith('/')) throw new Error('Invalid database path.');
  return {pathname: url.pathname.slice(1), params: url.searchParams};
}

function safePayload(table, payload) {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw new Error('Invalid database payload.');
  const keys = Object.keys(payload);
  if (!keys.length) throw new Error('Empty database payload.');
  for (const key of keys) assertIdentifier(key, TABLES[table], 'column');
  return keys;
}

async function tableRequest(pool, table, method, params, body) {
  const name = assertIdentifier(table, new Set(Object.keys(TABLES)), 'table');
  if (method === 'GET') {
    const values = [];
    const columns = parseSelect(params.get('select'), table);
    const filters = addFilters(table, params, values);
    const order = parseOrder(table, params.get('order'));
    const limit = parseLimit(params.get('limit'));
    const limitClause = limit === null ? '' : ` limit ${limit}`;
    return (await pool.query(`select ${columns} from public.${name}${filters}${order}${limitClause}`, values)).rows;
  }
  if (method !== 'POST' && method !== 'PATCH') throw new Error('Unsupported database method.');
  const keys = safePayload(table, body);
  const bodyValues = keys.map(key => body[key]);
  const columns = keys.map(key => assertIdentifier(key, TABLES[table], 'column'));
  if (method === 'POST') {
    const placeholders = keys.map((_, index) => `$${index + 1}`);
    return (await pool.query(`insert into public.${name} (${columns.join(', ')}) values (${placeholders.join(', ')}) returning *`, bodyValues)).rows;
  }
  const filterValues = [];
  const filters = addFilters(table, params, filterValues);
  if (!filters) throw new Error('An update filter is required.');
  const filterClause = filters.replace(/\$(\d+)/g, (_, index) => `$${Number(index) + keys.length}`);
  return (await pool.query(`update public.${name} set ${columns.map((column, index) => `${column} = $${index + 1}`).join(', ')}${filterClause} returning *`, [...bodyValues, ...filterValues])).rows;
}

async function rpcRequest(pool, functionName, method, body) {
  if (method !== 'POST') throw new Error('Unsupported database method.');
  const rpcArguments = {
    create_booking_v2: ['p_customer_name', 'p_phone_e164', 'p_service_slug', 'p_preferred_time_text', 'p_note', 'p_ip_hash', 'p_request_key', 'p_consent', 'p_preferred_at'],
    lookup_booking: ['p_reference_code', 'p_phone_e164', 'p_ip_hash'],
    manage_booking: ['p_request_id', 'p_action', 'p_actor_id', 'p_staff_id', 'p_starts_at', 'p_ends_at'],
  };
  const args = Object.hasOwn(rpcArguments, functionName) ? rpcArguments[functionName] : null;
  if (!args || !body || Object.keys(body).some(key => !args.includes(key))) throw new Error('Unsupported database function.');
  const values = args.map(key => body[key] ?? null);
  const placeholders = args.map((_, index) => `$${index + 1}`).join(', ');
  if (functionName === 'manage_booking') {
    const result = await pool.query(`select public.${functionName}(${placeholders}) as result`, values);
    return result.rows[0]?.result ?? null;
  }
  return (await pool.query(`select * from public.${functionName}(${placeholders})`, values)).rows;
}

export function createPostgresAdapter(pool) {
  return async function query(path, {method = 'GET', body} = {}) {
    const {pathname, params} = parsePath(path);
    if (pathname.startsWith('rpc/')) return rpcRequest(pool, pathname.slice(4), method, body);
    return tableRequest(pool, pathname, method, params, body);
  };
}

export const adapterInternals = {parseEq, parseLimit, parseOrder};
