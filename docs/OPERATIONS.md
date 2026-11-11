# Kimia operations and database activation

> این صفحه تنظیمات مسیر میزبانی موجود Sites/PostgREST را شرح می‌دهد. برای استقرار مستقل جدید روی VPS، به [راهنمای self-hosting](./SELF_HOSTING.md) و [گزارش وضعیت](./SELF_HOSTING_REPORT.md) مراجعه کنید. دستورهای این بخش به‌تنهایی VPS را راه‌اندازی نمی‌کنند.

## Implemented

- Black, forest green and gold Persian RTL website, server-rendered service pages, canonical URLs, descriptions, Open Graph, BeautySalon/Service structured data, sitemap and crawler rules.
- `/admin`: ChatGPT sign-in plus a server-side administrator allowlist. Visitors do not become administrators by signing in. Every admin API call is authorized. Writes require same-origin requests. Admin pages have no-store/noindex headers.
- Admin editing for services, category selection, SEO content, staff, business hours, salon address/phone/hero/logo and gallery. Image files use the Sites R2 `BUCKET` binding. JPEG/PNG/WebP are checked for file signature and capped at 5 MiB. Gallery publication requires a recorded consent checkbox. Unpublished uploads are served only to authorized admins.
- Booking: consent, contact validation, request key, database rate limiting, retry idempotency, confirmation/cancellation and staff overlap checks. Approval is an atomic PostgreSQL RPC; the salon must call the customer to communicate the approved time. Customer tracking requires the reference code and the same phone; only status and scheduled times are returned, with database-backed throttling. No SMS/WhatsApp sending service is connected.
- Customer authentication is intentionally inactive. Migration `004_customer_auth.sql`, the `/api/auth/*` Worker contracts and SMS settings are retained as future work; do not apply migration 004 or configure/enable `AUTH_CUSTOMER_ENABLED`, SMS or sessions yet.

## Activate PostgreSQL persistence

No production PostgreSQL credentials were supplied. The published site remains in setup mode, and it does not claim to save bookings while unconfigured.

For Supabase PostgreSQL:

1. Create/select a PostgreSQL project.
2. Apply `001_initial_schema.sql`, then `002_admin_booking.sql` and `003_booking_tracking.sql` to the same database. Keep `004_customer_auth.sql` unapplied until customer authentication is explicitly activated. Migration 002 also fixes an ambiguity in the legacy registration RPC found during PostgreSQL testing. Do not modify applied migrations.
3. Configure `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, a randomly generated `RATE_LIMIT_SALT` and `PUBLIC_BASE_URL` as server environment secrets for the launch content and admin panel. `PUBLIC_BASE_URL` must be the final HTTPS origin; the admin Settings form can also persist it with the site content. Do not configure `AUTH_SMS_URL`, `AUTH_SMS_TOKEN` or `AUTH_CUSTOMER_ENABLED` for this launch; customer authentication remains inactive. Prefer a modern `sb_secret_` key. Legacy JWT service-role keys are supported. Never put keys in the repository or browser.
4. Retain/configure `ADMIN_EMAILS` or `ADMIN_USER_IDS` from verified Sites identity. The hosted deployment currently configures the site owner's verified account email. Grant additional admin accounts only intentionally; this build does not include an admin invitation UI.
5. Deploy, sign in at `/admin`, create real service, gallery, salon and hours content, verify each gallery consent/publication flag, and check the public service pages, contact links, canonical origin, robots and sitemap. Do not advertise booking or customer accounts in this launch.
6. Establish encrypted database backups and retention/erasure rules before general release. Photo permission must be obtained outside the software and then recorded in the gallery form.

Sites auto-provisions the R2 binding on deployment. R2 stores file bytes; PostgreSQL stores gallery metadata and booking records. Pending uploads not attached to gallery or logo are private orphan files; garbage collection is not automated in this version. Current admin lists are capped at the latest 200 records; pagination is a follow-up before higher-volume use.

A Sites Worker cannot make a raw TCP PostgreSQL connection; do not expose port 5432 to the public to connect that Worker. A separate self-hosted Node adapter is now prepared for VPS operation; it binds locally and connects to PostgreSQL using `DATABASE_URL`. Its code has not been installed or accepted on the user's VPS, and it does not automatically transfer Supabase data or R2 image bytes.

## Crawlers and release

`/robots.txt` permits public pages for search/AI crawlers and excludes admin/API routes. `/sitemap.xml` lists public service pages. This does not bypass private hosting authentication: the current owner-private Site cannot be indexed until its audience is explicitly made public. No ranking or recommendation is guaranteed.

Services currently come from the provided site/brochure catalog. The Instagram page could not be retrieved; no new Instagram-derived service claims were invented. Photos are concept assets until replaced by the owner through the panel. No prices, reviews, ratings or claimed certifications were fabricated.

## Validation

`npm ci`, `npm run build`, `npm test`.

Database tests use PostgreSQL compiled to WASM (PGlite), including pgcrypto. All three migrations are executed; tests cover consent, replay/idempotency conflict, atomic confirmation, overlap rejection/rollback, cancellation, audit entries and restricted anonymous access. Worker tests cover admin authorization, cross-origin writes, config gating, service SEO, crawler endpoints, image routes and JavaScript syntax. This is not a live Supabase or VPS acceptance test. Visual browser QA was unavailable in the managed environment.
