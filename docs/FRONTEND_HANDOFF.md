# Kimia Beauty Salon & Atelier — Frontend Redesign Handoff

## 1. Overview & Creative Direction

This handoff documents the visual and structural redesign of **سالن زیبایی کیمیا (Kimia Beauty & Atelier)**.

### Brand Identity & Feeling
- **Concept:** Kimia unites premium beauty styling (makeup, hair, skin, nails, brows/lashes) with an intimate portrait photography atelier under one roof.
- **Atmosphere:** An intimate, contemporary luxury atelier: warm, artistic, confident, and welcoming.
- **Palette System:**
  - Deep forest green (`#10271D`)
  - Near-black forest green (`#070F0C`)
  - Warm luxury ivory (`#FAF6F0` / `#F5F0E7`)
  - Champagne gold (`#D8B675` / `#EBD5A8`)
  - Restrained sage accents (`#1E382B`, `#2C4A3B`)
- **Typography:**
  - Persian Primary: **Vazirmatn** (Google Fonts, weights 300 to 800) with optimized Persian letterforms and RTL leading.
  - Latin Details: **Cormorant Garamond** (Google Fonts, weights 400 & 600, italic) for seals, monograms, kicker subtitles, and Latin coordinates.

---

## 2. Changed Files

| File | Purpose of Modifications |
| --- | --- |
| `src/index.html` | Complete visual redesign of the customer-facing experience: refined header & wordmark seal, editorial hero with tailored atmospheric overlays, narrative philosophy section, warm ivory services cards with dual actions, dark emerald photography atelier spotlight, concept mood gallery with accessible modal dialog, 3-step experience journey, responsive 3-stage booking request flow with real-time feedback, appointment tracking module, FAQ accordion, contact & Google Maps route card, and mobile floating contact bar. |
| `src/admin.html` | Cohesive luxury restyling of the administrator workspace. Aligned with the deep emerald palette, refined tabs, structured cards, accessible focus rings, and high-contrast forms, while preserving 100% of the existing DOM IDs, form field names, and script controllers. |
| `worker/platform.js` | Elevated `simplePage` template with Vazirmatn typography and brand styling for supporting pages (`/services/:slug`, `/privacy`, error states). Added `HEAD` HTTP method support for public routes to ensure seamless monitoring and curl inspection. |
| `scripts/vite-preview.mjs` | Adjusted `X-Frame-Options` and `Content-Security-Policy: frame-ancestors` in the local development preview adapter ONLY so Google AI Studio can cleanly embed the preview in its development iframe. The production Worker retains strict security headers (`DENY` / `frame-ancestors 'none'`) untouched. |
| `package-lock.json` | Generated clean npm lockfile; removed extraneous `bun.lock` in accordance with repository normalization standards. |
| `docs/FRONTEND_HANDOFF.md` | Comprehensive architectural and design documentation for ongoing development in VS Code with GitHub Copilot. |

---

## 3. Preserved Architecture & API Contracts

No backend functionality was removed or simplified. All existing contracts remain fully operational:

- **Public Endpoints:**
  - `GET /`: Serves server-rendered HTML with injected SEO meta, JSON-LD schema, dynamic services catalog, operating hours, and gallery items.
  - `GET /services/:slug`: Server-rendered dedicated SEO service page with Schema.org `Service` structured data.
  - `GET /privacy`: Server-rendered privacy statement with transparent customer data handling guidelines.
  - `GET /api/health`: Returns `{ ok: true, booking_enabled: boolean }`.
  - `POST /api/bookings`: Processes booking requests with idempotency key (`request_key`), consent confirmation, rate limiting IP hash, honeypot protection, and transactional PostgreSQL conflict resolution.
  - `POST /api/bookings/lookup`: Checks appointment status by 10-character reference code and phone number.
- **Admin API (`/api/admin/*`):**
  - Session verification (`/api/admin/session`)
  - Data retrieval (`/api/admin/data`)
  - Booking status transitions (`/api/admin/booking` — actions: `contacted`, `confirm`, `decline`, `cancel`)
  - Service catalog management (`/api/admin/services`)
  - Gallery items management (`/api/admin/gallery_items`)
  - Team members management (`/api/admin/staff_members`)
  - Business hours management (`/api/admin/business_hours`)
  - Site settings update (`/api/admin/settings`)
  - Image upload to R2 (`/api/admin/upload`)
- **Database Migrations:**
  - `db/migrations/001_initial_schema.sql`: Core schema, settings, services, staff, gallery.
  - `db/migrations/002_admin_booking.sql`: Booking lifecycle, admin audit logging, atomic `manage_booking` function.
  - `db/migrations/003_booking_tracking.sql`: Public lookup function `lookup_booking` with strict field isolation and rate limiting.

---

## 4. Concept Assets & Transparent Attribution

All three images under `src/assets/` and `/media/` are conceptual design visuals:
- `/media/atelier.webp` (`src/assets/kimia-atelier.webp`): Atelier interior mood.
- `/media/portrait.webp` (`src/assets/portrait.webp`): Portrait session styling mood.
- `/media/session.webp` (`src/assets/atelier-session.webp`): Lighting and photography session mood.

**Attribution & Transparency Notice:**
Every public-facing display of these images includes an explicit label:
- Visual badge: `تصویر مفهومی` (Concept Imagery)
- Alt text & caption: Explicitly identifies that these represent design mood and are not actual Kimia customers or salon interiors.
- Genuine client photographs are only displayed when uploaded via the admin panel with verified consent (`consent_confirmed = true` and `is_published = true`) and rendered inside `<div class="real-gallery">__REAL_GALLERY__</div>`.

---

## 5. Verification & Testing Report

All automated tests and validation scripts were executed and passed cleanly:

1. **Production Worker Build:**
   ```bash
   npm run build
   # Output: Built /app/applet/dist/server/index.js
   ```
2. **Automated Test Suite:**
   ```bash
   npm test
   # 1. validate-artifact.mjs: Worker artifact is valid ESM and targets existing hosting manifest.
   # 2. test-worker.mjs: Route tests passed (homepage, media webp, health, configuration gate, input validation).
   # 3. test-admin.mjs: Admin authorization, cross-origin writes, setup gate, crawler paths, service SEO, and client VM syntax passed.
   # 4. test-database.mjs: PostgreSQL/WASM (PGlite): migrations 001-003, consent, idempotency, confirmation, slot conflict, cancellation, audit, and anonymous access passed.
   ```
3. **TypeScript Validation:**
   ```bash
   npx tsc --noEmit
   # Output: Clean (0 errors)
   ```
4. **Local Preview HTTP Validation:**
   - `GET /` → HTTP 200 (Full HTML rendered with Vite HMR client)
   - `HEAD /` → HTTP 200 (Proper header negotiation)
   - `GET /services/makeup` → HTTP 200 (Refined luxury service page)
   - `GET /privacy` → HTTP 200 (Cohesive privacy policy page)
   - `GET /media/portrait.webp` → HTTP 200 (Image served with immutable cache)
   - `GET /api/health` → HTTP 200 (`{"ok":true,"booking_enabled":false}`)
5. **Responsive Viewport Checks:**
   - **360px & 390px (Mobile):** Single-column layout, compact typography, accessible 44px touch targets, mobile floating action bar with direct phone call and booking shortcut, non-overlapping bottom padding.
   - **768px (Tablet):** 2-column service grid, stacked atelier editorial split, refined form layout.
   - **1024px (Small Desktop / Laptop):** 3-column service grid, 1.05:0.95 atelier layout, 3-card concept gallery.
   - **1440px (Large Desktop):** Maximum shell constraint at 1240px, balanced whitespace, crisp typography.

---

## 6. Follow-Up Backend Tasks (for VS Code & Copilot)

For the next development phase in VS Code:
1. **Hosting & Production Deployment:**
   - Deploy Cloudflare Worker (`npm run build`).
   - Configure secrets in the production environment: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `RATE_LIMIT_SALT`, `ADMIN_USER_IDS`, `ADMIN_EMAILS`.
2. **Database Migrations:**
   - Run migrations `001_initial_schema.sql`, `002_admin_booking.sql`, and `003_booking_tracking.sql` in sequence against the live PostgreSQL / Supabase database.
3. **Admin Sign-in Portability:**
   - When deploying beyond the Sites hosting provider, implement an auth adapter (e.g., Auth0, Supabase Auth, or session cookies) to replace Sites' `oai-authenticated-user-id` header validation.
4. **Dynamic Booking Hours Synchronization:**
   - Currently, form time slots are defaults; they can be hooked directly to live business hours from `business_hours` table.
