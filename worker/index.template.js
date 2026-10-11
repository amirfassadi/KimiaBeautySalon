const PAGE_HTML = __PAGE_HTML__;
const MEDIA_BASE64 = {
  "/media/atelier.webp": __HERO_BASE64__,
  "/media/portrait.webp": __PORTRAIT_BASE64__,
  "/media/session.webp": __SESSION_BASE64__,
};
const SERVICES = new Set(["makeup", "hair", "nails", "eyes", "skin", "atelier"]);
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
function normalizeDigits(value) {
  return String(value ?? "").replace(/[۰-۹٠-٩]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩".indexOf(d) % 10));
}
function normalizeIranianPhone(value) {
  let phone = normalizeDigits(value).replace(/[^0-9+]/g, "");
  if (phone.startsWith("0098")) phone = "+98" + phone.slice(4);
  else if (phone.startsWith("98")) phone = "+" + phone;
  else if (phone.startsWith("09")) phone = "+98" + phone.slice(1);
  else if (phone.startsWith("9") && phone.length === 10) phone = "+98" + phone;
  return /^\+[1-9][0-9]{8,14}$/.test(phone) ? phone : null;
}
async function digestIp(ip, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${ip || "unknown"}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
function secureHeaders(headers = {}) {
  return {
    ...headers,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self' 'unsafe-inline'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  };
}
function configReady(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY && env.RATE_LIMIT_SALT);
}

async function createBooking(request, env) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ message: "درخواست معتبر نیست." }, 403);
  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (declaredSize > 12_000) return json({ message: "حجم اطلاعات ارسالی زیاد است." }, 413);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return json({ message: "نوع درخواست معتبر نیست." }, 415);

  let input;
  try {
    const raw = await request.text();
    if (raw.length > 12_000) return json({ message: "حجم اطلاعات ارسالی زیاد است." }, 413);
    input = JSON.parse(raw);
  } catch {
    return json({ message: "اطلاعات درخواست قابل‌خواندن نیست." }, 400);
  }
  if (typeof input?.website === "string" && input.website.trim()) return json({ ok: true }, 202);

  const customerName = String(input?.name ?? "").trim().replace(/\s+/g, " ");
  const phone = normalizeIranianPhone(input?.phone);
  const serviceSlug = String(input?.service ?? "");
  const preferredTime = String(input?.preferred_time ?? "").trim().slice(0, 120) || null;
  const note = String(input?.note ?? "").trim().slice(0, 700) || null;
  if (customerName.length < 2 || customerName.length > 100) return json({ message: "نام را درست وارد کن." }, 400);
  if (!phone) return json({ message: "شمارهٔ موبایل معتبر وارد کن." }, 400);
  if (!SERVICES.has(serviceSlug)) return json({ message: "موضوع درخواست را انتخاب کن." }, 400);
  if (!configReady(env)) return json({ code: "database_not_configured" }, 503);

  const ipHash = await digestIp(request.headers.get("cf-connecting-ip"), env.RATE_LIMIT_SALT);
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  let response;
  try {
    response = await fetch(`${base}/rest/v1/rpc/create_booking_request`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "apikey": env.SUPABASE_SECRET_KEY,
        "accept": "application/json",
      },
      body: JSON.stringify({
        p_customer_name: customerName,
        p_phone_e164: phone,
        p_service_slug: serviceSlug,
        p_preferred_time_text: preferredTime,
        p_note: note,
        p_ip_hash: ipHash,
      }),
    });
  } catch {
    return json({ message: "ارتباط با سامانهٔ نوبت‌دهی برقرار نشد." }, 502);
  }
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    if (response.status === 429 || errorText.includes("rate_limited")) return json({ message: "تعداد درخواست‌ها زیاد شده؛ کمی بعد دوباره تلاش کن." }, 429);
    if (errorText.includes("invalid_name")) return json({ message: "نام را درست وارد کن." }, 400);
    if (errorText.includes("invalid_phone")) return json({ message: "شمارهٔ موبایل معتبر وارد کن." }, 400);
    if (errorText.includes("service_unavailable")) return json({ message: "این خدمت فعلاً برای نوبت‌دهی فعال نیست." }, 400);
    return json({ message: "ثبت درخواست انجام نشد؛ لطفاً دوباره تلاش کن." }, 502);
  }
  const payload = await response.json().catch(() => null);
  const row = Array.isArray(payload) ? payload[0] : payload;
  if (!row?.request_id) return json({ message: "پاسخ سامانهٔ نوبت‌دهی کامل نبود." }, 502);
  return json({ ok: true, request_id: row.request_id, reference_code: row.reference_code }, 201);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    if (method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return new Response(PAGE_HTML, { headers: secureHeaders({ "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" }) });
    }
    if (method === "GET" && Object.hasOwn(MEDIA_BASE64, url.pathname)) {
      const bytes = Uint8Array.from(atob(MEDIA_BASE64[url.pathname]), (char) => char.charCodeAt(0));
      return new Response(bytes, { headers: secureHeaders({ "content-type": "image/webp", "cache-control": "public, max-age=31536000, immutable" }) });
    }
    if (url.pathname === "/api/health" && method === "GET") {
      return json({ ok: true, booking_enabled: configReady(env) });
    }
    if (url.pathname === "/api/bookings" && method === "POST") return createBooking(request, env);
    if (url.pathname.startsWith("/api/")) return json({ message: "این مسیر پیدا نشد." }, 404);
    return new Response("Not found", { status: 404, headers: secureHeaders({ "content-type": "text/plain; charset=utf-8" }) });
  },
};
