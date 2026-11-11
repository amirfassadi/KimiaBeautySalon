# Kimia Beauty Salon & Atelier — Frontend Redesign Handoff

## 1. Overview & Creative Direction

This handoff documents the visual and structural redesign of **سالن زیبایی کیمیا (Kimia Beauty & Atelier)**, including customer registration/login interface and Persian typography refinement.

### Brand Identity & Feeling
- **Concept:** Kimia unites premium beauty styling (makeup, hair, skin, nails, brows/lashes) with an intimate portrait photography atelier under one roof in Sadeghiyeh, Tehran.
- **Atmosphere:** An intimate, contemporary luxury atelier: warm, artistic, confident, and welcoming.
- **Palette System:**
  - Deep forest green (`#10271D`)
  - Near-black forest green (`#070F0C`)
  - Warm luxury ivory (`#FAF6F0` / `#F5F0E7`)
  - Champagne gold (`#D8B675` / `#EBD5A8`)
  - Restrained sage accents (`#1E382B`, `#2C4A3B`)

---

## 2. Persian Typography & Artistic Calligraphy Direction

The typographic system pairs a modern high-legibility sans-serif base with an artistic Persian calligraphic display face.

### A. Body & Interface Foundation: Estedad
- **Role:** Body text, navigation links, buttons, booking flow, registration forms, service cards, and admin dashboard.
- **Font:** Estedad Variable WebFont (`Estedad[wght].woff2`, `Estedad-Regular`, `Estedad-Medium`, `Estedad-SemiBold`)
- **Author:** Amin Abedi (https://github.com/aminabedi68/Estedad)
- **License:** SIL Open Font License (OFL) Version 1.1 (`src/assets/fonts/OFL.txt`)
- **Delivery:** Embedded in Worker artifact, served at `/fonts/Estedad-wght.woff2` with jsDelivr CDN fallback.
- **Rules:** Minimum 16px body on mobile to prevent iOS zooming; strictly no artificial letter-spacing on cursive Persian text.

### B. Artistic Calligraphy Display: Katibeh
- **Role:** Hero main headline (`.hero h1`), Kimia's Persian brand title (`.brand-name`), and editorial philosophy quote (`.philosophy-quote`).
- **Font:** Katibeh (`Katibeh-Regular.woff2`)
- **Origin & Typography:** Authentic Iranian display face blending Thuluth and Naskh calligraphic traditions, originally designed by Borna Rayaneh and adapted for modern web by Google Fonts (https://fonts.google.com/specimen/Katibeh).
- **License:** SIL Open Font License (OFL) Version 1.1.
- **Persian Script Fidelity:** Flawlessly shapes Persian-specific characters (ی، ک، گ، چ، پ، ژ), zero-width non-joiners (half-spaces / نیم‌فاصله), and complex ligatures without artifacting.
- **Delivery:** Embedded locally in `src/assets/fonts/Katibeh-Regular.woff2` and served directly from Worker `/fonts/Katibeh.woff2` with Google Fonts WOFF2 fallback.
- **Vertical Clearance & Dot Protection:**
  - Persian calligraphy features steep ascenders and deep descenders with prominent diacritical dots.
  - Generous line-height (`1.55` in hero headline, `1.85` in philosophy quote, `1.35` in brand title) and vertical padding (`padding: 6px 0` / `8px 0`) prevent ascenders, descenders, and dots from ever clipping.
  - Sizing and line wrapping are tuned separately for desktop (`clamp(52px, 7.8vw, 92px)`) and mobile (`clamp(38px, 9.5vw, 52px)`).
  - Preserves natural cursive connections with `letter-spacing: normal` (never uses artificial letter spacing on Persian text).

---

## 3. Customer Registration & Login (Frontend Interface)

A customer account dialog has been added to provide an intuitive mobile-number and verification-code authentication experience.

### User Journey Stages
1. **Desktop & Mobile Entry Points:**
   - Desktop Header: «ورود / ثبت‌نام» button next to the appointment booking CTA.
   - Mobile Navigation: «ورود / ثبت‌نام مشتریان» menu item.
2. **Stage A: Phone Number Entry (`#accountPhoneForm`):**
   - Title: *«به کیمیا خوش آمدی»*
   - Explanatory microcopy for viewing appointments and atelier sessions.
   - Iranian mobile input (`autocomplete="tel"`, `inputmode="tel"`).
   - Normalizes Persian, Arabic, and Latin digits consistently; validates against Iranian mobile format (`09...`).
   - Action: *«دریافت کد تأیید»*.
3. **Stage B: Verification Code Entry (`#accountOtpForm`):**
   - Single accessible input with `autocomplete="one-time-code"`, `inputmode="numeric"`, `maxlength="6"`.
   - Displays the normalized destination phone number with an *«ویرایش شماره»* action to edit the number.
   - Resend button disabled until a real SMS delivery operation succeeds.
4. **Stage C: Complete Registration Profile (`#accountRegisterForm`):**
   - Collects customer first name and last name.
   - No passwords or intrusive personal information required.
   - Links to Privacy Policy (`/privacy`).
   - Separate, unchecked marketing notification consent checkbox.
5. **Development Visual Preview Switcher:**
   - Explicitly labeled development review bar:
     `[پیش‌نمایش بصری گام‌های ورود و عضویت: ۱. شماره موبایل | ۲. کد تأیید | ۳. تکمیل مشخصات]`
   - Allows designers and engineers to inspect all 3 visual stages in preview mode without simulating fake authentication or storing dummy data.

### Offline Behavior & Scope Isolation
- Customer authentication remains disabled in the frontend (`customerAuthAdapter.isConfigured() === false`); it does not call `/api/auth/*`.
- The Worker contracts and append-only migration 004 are retained for a future activation, but migration 004 must not be applied to production yet.
- The UI displays an honest “به‌زودی فعال می‌شود” message. No OTP, SMS, session or customer account is created.
- No fake SMS is dispatched, no universal test codes are accepted, no fake sessions are created, and no credentials or tokens are stored in `localStorage`.
- Customer account entry remains strictly isolated from Sites-based administrator authentication.
- Browsing services, reading FAQ, submitting appointment requests, and tracking existing requests do NOT require registration.

### Proposed Backend Integration Contracts (for VS Code)
When implementing SMS gateway and session management in the backend:
- `POST /api/auth/otp/send`: `{ phone: string }` → Sends 6-digit OTP via SMS with rate limiting.
- `POST /api/auth/otp/verify`: `{ phone: string, code: string }` → Validates OTP, returns `{ is_new_user: boolean, session_token?: string, temp_token?: string }`.
- `POST /api/auth/register`: `{ phone: string, temp_token: string, first_name: string, last_name: string, marketing: boolean }` → Persists customer profile and issues session cookie.

---

## 4. Changed Files Summary

| File | Purpose of Modifications |
| --- | --- |
| `src/index.html` | Integrated Estedad (`--sans`) and Katibeh (`--calligraphy`) fonts; applied calligraphy to brand title, hero h1, and editorial philosophy quote with vertical clearance; added customer registration & login modal (`#accountDialog`) with 3-stage journey (Phone, OTP, Profile), dev preview switcher, and desktop/mobile header triggers. Preserved booking form, tracking, concept gallery dialog, and all existing features. |
| `src/admin.html` | Updated typography to Estedad font; preserved all existing form IDs, tables, controls, and script controllers. |
| `worker/platform.js` | Updated `simplePage` (used for `/services/:slug`, `/privacy`, and 404/403 pages) with Estedad typography. |
| `worker/index.template.js` | Added `/fonts/Estedad-wght.woff2` and `/fonts/Katibeh.woff2` to `MEDIA_BASE64` with MIME type resolution (`font/woff2`); updated CSP font-src and style-src to allow `fonts.gstatic.com` and `cdn.jsdelivr.net`. |
| `scripts/build-worker.mjs` | Injected local `Estedad-wght.woff2` and `Katibeh-Regular.woff2` base64 into Worker artifact during `npm run build`. |
| `scripts/vite-preview.mjs` | Removed `X-Frame-Options: DENY` and adjusted CSP `frame-ancestors` in local preview adapter only, allowing Google AI Studio to embed the page in its development iframe while preserving strict production security headers. |
| `src/assets/fonts/` | Downloaded local font files (`Katibeh-Regular.woff2`, `Estedad-wght.woff2`, `Estedad-Regular.woff2`, `Estedad-Medium.woff2`, `Estedad-SemiBold.woff2`) and SIL Open Font License (`OFL.txt`). |
| `package.json` | Added `"lint": "tsc --noEmit"` and generated clean `package-lock.json`. |
| `docs/FRONTEND_HANDOFF.md` | Comprehensive architectural, design, typographic licensing, and integration documentation. |

---

## 5. Preserved Architecture & API Contracts

No backend functionality was removed or simplified. All existing contracts remain fully operational:

- **Public Endpoints:**
  - `GET /`: Serves server-rendered HTML with injected SEO meta, JSON-LD schema, dynamic services catalog, operating hours, and gallery items.
  - `GET /fonts/Estedad-wght.woff2`: Serves local variable font asset with immutable caching.
  - `GET /services/:slug`: Server-rendered dedicated SEO service page with Schema.org `Service` structured data.
  - `GET /privacy`: Server-rendered privacy statement with transparent customer data handling guidelines.
  - `GET /api/health`: Returns `{ ok: true, booking_enabled: boolean }`.
  - `POST /api/bookings`: Processes booking requests with idempotency key (`request_key`), consent confirmation, rate limiting IP hash, honeypot protection, and transactional PostgreSQL conflict resolution.
  - `POST /api/bookings/lookup`: Checks appointment status by 10-character reference code and phone number.
- **Admin API (`/api/admin/*`):**
  - Session verification (`/api/admin/session`), data retrieval (`/api/admin/data`), booking management (`/api/admin/booking`), catalog, team, business hours, and site settings.
- **Database Migrations:**
  - `db/migrations/001_initial_schema.sql`, `002_admin_booking.sql`, `003_booking_tracking.sql` preserved without modification.

---

## 6. Verification & Automated Testing Report

All automated test suites and validation tools were executed and confirmed passing:

1. **Production Worker Build:**
   ```bash
   npm run build
   # Output: Built /app/applet/dist/server/index.js
   ```
2. **Automated Test Suite (`npm test`):**
   - `scripts/validate-artifact.mjs`: Worker artifact is valid ESM and targets hosting manifest.
   - `scripts/test-worker.mjs`: Route tests passed (`/`, `/media/portrait.webp`, `/api/health`, `/api/bookings` gate & validation).
   - `scripts/test-admin.mjs`: Admin authorization, cross-origin write rejection, setup gate, crawler paths, service SEO canonical/JSON-LD, and client JavaScript syntax execution in `vm.Script`.
   - `scripts/test-database.mjs`: PGlite PostgreSQL WASM test suite passed (migrations 001–003, consent enforcement, idempotency, slot conflicts, audit logging, and anonymous security).
3. **TypeScript Validation (`npx tsc --noEmit` & `npm run lint`):**
   - 0 TypeScript errors.
   - 0 linting errors.
4. **Local Preview HTTP Validation:**
   - `GET /` → HTTP 200 (HTML rendered with Vite HMR client and Estedad font)
   - `GET /fonts/Estedad-wght.woff2` → HTTP 200 (`content-type: font/woff2`)
   - `GET /services/makeup` → HTTP 200 (Dedicated service page)
   - `GET /privacy` → HTTP 200 (Privacy statement)
   - `GET /api/health` → HTTP 200 (`{"ok":true,"booking_enabled":false}`)
5. **Responsive Viewport & Dialog Checks:**
   - Account dialog tested for desktop centered card layout and mobile bottom-sheet presentation.
   - Focus management verified: opens on trigger, focuses first input, closes on ESC or backdrop click, returns focus to trigger button.
   - 16px body font size avoids auto-zooming on mobile devices.
