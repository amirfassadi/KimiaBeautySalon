# گزارش ثبت Git و بررسی push

تاریخ: ۲۰۲۶/۱۱/۲۸
شاخهٔ محلی نهایی: `codex/black-friday-offer`
Remote مقصد: `origin` — `https://github.com/amirfassadi/KimiaBeautySalon.git`
HEAD پیش از commit مستندات: `053ab7aff4d53e0c2b8317a952e5cbd522f75fa6`.
**وضعیت push: انجام نشد؛ commitها فقط محلی‌اند.** push عمداً اجرا نشد، چون نبود اتصال انتشار خودکار خارج از مخزن قابل اثبات نبود.

## Commitهای محصول

| شناسه | موضوع |
|---|---|
| `14d8a83f327037d985a0eab5df32b7eb8f963a85` | `Improve salon SEO and campaign image delivery` — SEO، مسیر انتشار امن تصویر کمپین و آزمون regression |
| `053ab7aff4d53e0c2b8317a952e5cbd522f75fa6` | `Add gated customer auth and referral tracking` — ورود/ثبت‌نام محدود مشتری، ثبت معرف، migrationهای افزایشی 006/007 و آزمون‌های وابسته |

تغییرهای محصول در دو commit مستقل ثبت شدند؛ تغییرات SEO و تصویر در commit اول کامل‌اند و کد احراز هویت/معرف و migrationهای موردنیاز در commit دوم. مستندات و شواهد منتخب همراه گزارش حاضر در commit مستندات جداگانه قرار می‌گیرند.

## اعتبارسنجی محلی

| بررسی | نتیجه |
|---|---|
| `npm ci` | موفق؛ ۰ آسیب‌پذیری در audit. هشدار npm دربارهٔ install script بستهٔ esbuild دیده شد؛ build بعد از نصب موفق بود. |
| `npm run build` | موفق؛ Worker محلی ساخته شد. |
| `npm test` | موفق؛ تمام آزمون‌های package script، از جمله آزمون‌های auth/OTP/referral، migration runner، Worker، SEO و startup گذشتند. |
| `npm run lint` | موفق؛ `tsc --noEmit` بدون خطا. |
| `npx tsc --noEmit` | موفق. |
| `node scripts/test-seo.mjs` | موفق؛ آزمون regression SEO. |
| پیش‌نمایش `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort` | پاسخ `200 text/html` از `http://127.0.0.1:5173/`; فرایند پس از بررسی متوقف شد. |
| `npm run test:postgres` | فرمان موفق شد، اما هر دو آزمون اتصال PostgreSQL واقعی را به‌دلیل نبود `KIMIA_TEST_DATABASE_URL` مخصوص پایگاه موقت محلی **skip** کردند. نتیجهٔ اجرای قبلی PostgreSQL 18 در [گزارش بازبینی](./CUSTOMER_AUTH_REVIEW_FA.md) مربوط به ۲۰۲۶/۱۱/۲۷ است و اجرای امروز محسوب نمی‌شود. |
| `git diff --cached --check` | بدون خطای whitespace برای مجموعه‌های محصول؛ پایان‌خط‌های CRLF چند فایل هشدار عادی Git داشتند. |

در این نوبت هیچ دیتابیس واقعی، migration، SMS واقعی، preview عمومی، deploy یا merge اجرا نشد. gateهای ورود/ثبت‌نام و لینک عمومی در `.env.example` خاموش‌اند. شواهد مرورگر و محدودیت‌های قبلی در [CUSTOMER_AUTH_HANDOFF.md](./CUSTOMER_AUTH_HANDOFF.md) و [CUSTOMER_AUTH_REVIEW_FA.md](./CUSTOMER_AUTH_REVIEW_FA.md) حفظ شده‌اند؛ آزمون مرورگر در این نوبت دوباره اجرا نشد.

## فایل‌های باقی‌مانده و علت کنارگذاشتن

این فایل‌ها عمداً stage یا commit نشده‌اند و در کاردرخت باقی می‌مانند:

| مسیر | محتوا / علت |
|---|---|
| `real data/` | `2.jpg`, `3.mp4`, `5783061146834244355.jpg`, `5783061146834244357.jpg`, `IMG_5983.mp4`, `IMG_5987.mp4`, `Untitled.jpg`؛ تصاویر/ویدئوهای واقعی خارج از مخزن، صریحاً خارج از scope ثبت و بالقوه حاوی دادهٔ حساس. |
| `seo/kbkimiabeauty.ir-Performance-on-Search-2026-11-27.zip` | آرشیو ورودی/گزارش SEO؛ کل پوشهٔ `seo/` طبق دستور ثبت نشد. |
| `prompts/` | ورودی‌ها و artefactهای فرایند، نه وابستگی محصول: `01-auth-audit.md`, `02-backend-decision.md`, `03-auth-contract.md`, `04-auth-configuration.md`, `05-auth-schema.md`, `05b-auth-migration-runner.md`, `06-auth-validation.md`, `07-auth-sms-adapter.md`, `08-auth-otp-reservation.md`, `08b-auth-otp-send.md`, `09-auth-otp-verification.md`, `10-auth-registration.md`, `11-auth-session-api.md`, `12-auth-logout.md`, `13-auth-login-page.md`, `14-auth-registration-page.md`, `15-auth-account-flow.md`, `16-auth-final-verification.md`, `17-staff-access-design.md`, `BATCH_REPORT.md`, `BATCH_REVIEW.md`, `COPILOT_SEO_HANDOFF.md`, `KimiaBeauty_Audit_2026-11-24.zip`, `KimiaBeauty_Instagram_Followup_2026-11-24.zip`, `Perform a comprehensive, evidence-b.txt`, `R2-credential-cleanup.md`, `README.md`, `RUN_AUTH_BATCH.md`, `_task-template.md`. آرشیوهای ورودی و متن‌های prompt/گردش‌کار برای build یا اجرای قابلیت لازم نیستند. |
| `docs/customer-auth-review-assets/customer-account-mobile.png`, `docs/customer-auth-review-assets/customer-login-mobile.png` | تصاویر قدیمی/تکراری که در گزارش‌های منتخب ارجاع نشده‌اند؛ هفت تصویر ارجاع‌شده بررسی بصری و در commit مستندات ثبت می‌شوند. |

هیچ فایل محیط واقعی، credential، فایل `real data/`, آرشیو ورودی، `node_modules/` یا `dist/` وارد commit نشده است. `.env.example` فقط نمونه و gateهای خاموش دارد. تصاویر آزمون ثبت‌شده، بعد از مشاهده، شامل داده‌های ساختگی harness هستند.

## بررسی انتشار خودکار و تصمیم push

- در [workflow انتشار](../.github/workflows/vps.yml)، رویداد push فقط برای `main` تنظیم شده؛ pull requestهای مقصد `main` تست می‌شوند. job انتشار علاوه بر شرط رویداد، فقط روی `refs/heads/main` و با `vars.KIMIA_DEPLOY_ENABLED == 'true'` اجرا می‌شود.
- GitHub Actions فقط یک workflow فعال (`Test and deploy Kimia`) نشان داد. اجرای `#14` روی `main` با SHA `e7890b4ada355df6c5c15a112abe43d59aeeec41` در ۲۰۲۶/۱۱/۲۴، هم test و هم deploy را با موفقیت گذراند؛ اجرای `#13` برای SHA قبلی `9a60c014318c3e7847b497ce765c3fa179fe0dbf` نیز job انتشار موفق داشت. این شواهد نشان می‌دهند push به `main` ممکن است انتشار واقعی ایجاد کند.
- `git ls-remote --heads origin` شاخهٔ `codex/black-friday-offer` را نشان نداد؛ مقصد جاری روی GitHub فقط main و دو شاخهٔ دیگرِ فهرست‌شده بود. GitHub Actions برای شاخهٔ کاری فعلی run نداشت.
- [تنظیم Sites](../.openai/hosting.json) شناسهٔ پروژهٔ موجود را حفظ می‌کند و پیکربندی branch-trigger ندارد؛ README می‌گوید منبع انتشار Sites به‌صورت داخلی مدیریت می‌شود. بااین‌حال، تنظیمات GitHub repository webhooks، deploy keys/variables و اتصال بیرونی Sites از دسترسی‌های این بررسی قابل خواندن نبودند.
- بنابراین می‌توان گفت workflow مخزن برای push به شاخهٔ `codex/*` انتشار را شروع نمی‌کند، اما عدم انتشار از webhook یا اتصال بیرونی را نمی‌توان تأیید کرد. برای رعایت شرط امن‌بودن، **push حتی به شاخهٔ کاری هم انجام نشد**. اطلاعات لازم برای بازبینی بعدی: دسترسی فقط‌خواندنی به تنظیمات Webhooks/Deployments مخزن و تنظیمات اتصال/trigger پروژهٔ Sites، یا تأیید مالک مبنی بر نبود trigger انتشار برای این شاخه.

## وضعیت نهایی

- Commitهای محصول: شناسه‌ها و موضوع‌ها در جدول بالا.
- Commit گزارش و مستندات: محلی، روی `codex/black-friday-offer`.
- Remote destination: `origin`؛ شاخهٔ remote هم‌نام هنوز وجود ندارد.
- Push: **انجام نشد و تلاش ناموفقی هم ثبت نشد**؛ عمداً به‌دلیل ابهام در triggerهای خارج از مخزن.
- Deploy، merge، پیامک واقعی و migration روی پایگاه واقعی: **هیچ‌کدام انجام نشدند**.
- موفقیت build/test یا هر commit/push، تأیید عملکرد سایت اصلی یا انتشار آن نیست.
