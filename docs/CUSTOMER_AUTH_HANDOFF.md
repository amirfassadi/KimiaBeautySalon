# تحویل نهایی بازبینی محلی ورود مشتری و ثبت معرف

این سند snapshot بازبینی محلی در ۲۰۲۶/۱۱/۲۷ و وضعیت پیش از ثبت Git را نگه می‌دارد. وضعیت نهایی commit و push در [گزارش ثبت Git](./CUSTOMER_AUTH_GIT_HANDOFF_FA.md) آمده است.

**نتیجه: پذیرش محلی موفق** برای سناریوهای اجراشده؛ این نتیجه جایگزین بازبینی مستقل، آزمون تولید یا مجوز فعال‌سازی عمومی نیست.
تاریخ: ۲۰۲۶/۱۱/۲۷
شاخه: `codex/black-friday-offer`
HEAD: `9a60c014318c3e7847b497ce765c3fa179fe0dbf`
وضعیت: تغییرهای worktree ثبت‌نشده‌اند؛ چیزی stage یا commit نشده است.
انتشار: push، deploy، SMS واقعی و migration روی پایگاه واقعی انجام نشدند.

## جمع‌بندی

بازبینی نهایی کد و آزمون‌های محلی مسیر مشتری جدید/بازگشتی، OTP، انقضا، نشست و خروج، فرم مدیریتی معرف و history را پوشش داد. در این دور ایراد جدیدی در کد تأیید نشد و فایل پیاده‌سازی تغییر نکرد. راهنمای VPS اصلاح شد تا معیار migrationهای مورد انتظار، `007_customer_referrals.sql` را هم داشته باشد؛ گزارش‌ها و شواهد تصویری نیز به‌روز شدند. یافتهٔ قدیمی انقضای proof در [CUSTOMER_AUTH_REVIEW_FA.md](./CUSTOMER_AUTH_REVIEW_FA.md) با محل کد و آزمون بازتولید ثبت شده و اصلاح آن در آزمون‌های تازه گذشت.

گیت‌های عمومی ورود و preview باید خاموش بمانند. harness فقط روی loopback، با پایگاه موقت و SMS ساختگیِ تزریق‌شده در ابزار تست اجرا شد؛ صفحهٔ عمومی برای دریافت OTP یا دورزدن ورود اضافه نشده است.

## اعتبارسنجی

| فرمان/روش | نتیجه |
|---|---|
| `npm run build` | موفق. |
| `npm test` | موفق؛ همهٔ آزمون‌های package script گذشتند. |
| `npm run lint` | موفق؛ `tsc --noEmit` بدون خطا. |
| `npm run test:postgres` | اجرای نهایی روی PostgreSQL 18 موقت و جداشده موفق؛ integration و concurrency/rollback/outage گذشتند. تلاش اول فقط به‌دلیل نقش‌های test ایجادنشده متوقف شد؛ پس از ایجاد نقش‌های لازم در همان cluster دورریختنی، آزمون کامل موفق شد. |
| `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort` | سرور آماده شد؛ GET `http://127.0.0.1:5173/` پاسخ `200 text/html` داد. سرور متوقف شد. |
| `node scripts/run-customer-auth-browser-preview.mjs` | مسیر واقعی Node روی loopback با PGlite و SMS ساختگی در چند harness موقت اجرا شد؛ پس از آزمون listenerها متوقف شدند. |

جزئیات دقیق HTTP statusها، سناریوها، خطوط کد و محدودیت‌ها در [گزارش بازبینی](./CUSTOMER_AUTH_REVIEW_FA.md) است. `npm ci` لازم نشد؛ dependency manifest تغییر داده نشد. `npx tsc --noEmit` جداگانه اجرا نشد، اما همان بررسی با `npm run lint` اجرا شد.

## مرورگر و شواهد تصویری

- شمارش معکوس کامل ۶۰ ثانیه و resend واقعی: درخواست اول و resend هر دو `202`؛ کد دوم متفاوت بود.
- کد اشتباه `401` و OTP منقضی `410`؛ اصلاح شماره در فرم قابل‌دسترسی بود.
- ثبت مشتری جدید، ورود مشتری قبلی، ثبت با همان معرف سایت/سالن و ثبت بدون معرف موفق شدند.
- تأیید و اصلاح مدیریتی معرف بیرونی در history ثبت شد؛ تاریخ سایت و سالن جدا ماند.
- cookie نشست قبلی پس از جایگزینی `401` و cookie جدید `200` گرفت.
- Reload، Back پس از خروج، عدم نمایش profile قدیمی، font محلی و focus صفحه‌کلید بررسی شدند.
- اندازه‌های CSS اندازه‌گیری‌شده: موبایل `312px` و دسکتاپ `1152px`; در صفحات ورود، ثبت‌نام و مدیریت معرف overflow افقی مشاهده نشد.

تصاویر شامل دادهٔ ساختگی harness هستند؛ OTP/token و دادهٔ واقعی در آن‌ها نیست:

- [ورود مشتری — موبایل](./customer-auth-review-assets/customer-login-final-mobile.png)
- [ورود مشتری — دسکتاپ](./customer-auth-review-assets/customer-login-desktop.png)
- [ثبت‌نام — موبایل](./customer-auth-review-assets/customer-register-mobile.png)
- [ثبت‌نام — دسکتاپ](./customer-auth-review-assets/customer-register-desktop.png)
- [حساب مشتری — موبایل](./customer-auth-review-assets/customer-account-final-mobile.png)
- [مدیریت معرف — موبایل](./customer-auth-review-assets/customer-referrals-admin-mobile.png)
- [مدیریت معرف — دسکتاپ](./customer-auth-review-assets/customer-referrals-admin-desktop.png)

## محدودیت‌ها و گام‌های مالک/زیرساخت

- دستگاه فیزیکی، صفحه‌خوان واقعی، مرورگرهای متعدد و axe/Lighthouse اجرا نشدند.
- مرورگر از PGlite استفاده کرد؛ آزمون concurrency جداگانه روی PostgreSQL واقعیِ موقت بود، نه browser با PostgreSQL.
- provider/SMS واقعی، secrets عملیاتی، reverse proxy، داده و latency تولید، migration واقعی و نسخهٔ deployشده بررسی نشدند.
- برای فعال‌سازی عمومی، مالک باید provider، provisioning secret، rate-limit/monitoring، migration و rollout را جداگانه تأیید کند. هیچ‌یک در این کار فعال نشد.
- بررسی SEO/performance این گزارش اندازه‌گیری تولید نیست. هیچ بهبود production ادعا نمی‌شود.
- پنل پرسنل، آلبوم، حقوق، پورسانت و کارهای مالی خارج از محدوده‌اند.

## فایل‌های پیشنهادی برای commit

این فهرست پیشنهاد دسته‌بندی‌شده است، نه stage خودکار. فایل‌های پیاده‌سازی عمدتاً پیش از این دور در worktree موجود بودند؛ مالکیت همهٔ آن تغییرها را نمی‌توان به بازبینی حاضر نسبت داد. فایل `real data/`، credential، فایل محیط واقعی، archiveهای audit، خروجی `dist/` و `node_modules/` نباید وارد commit شوند.

### گروه A — احراز هویت و معرف

**مهاجرت‌ها و سرور**

`.env.example`, `README.md`, `docs/SELF_HOSTING.md`, `package.json`, `scripts/build-worker.mjs`,
`db/migrations/006_customer_auth_v1.sql`, `db/migrations/007_customer_referrals.sql`,
`server/business-hours.js`, `server/customer-auth-config.js`, `server/customer-auth-cookies.js`, `server/customer-auth-credentials.js`, `server/customer-auth-http.js`, `server/customer-auth-otp-crypto.js`, `server/customer-auth-otp-send.js`, `server/customer-auth-otp-store.js`, `server/customer-auth-otp-verification.js`, `server/customer-auth-registration.js`, `server/customer-auth-session.js`, `server/customer-auth-sms.js`, `server/customer-auth-validation.js`, `server/customer-referrals.js`, `server/index.js`, `server/migrate.js`.

**صفحات و آزمون‌ها**

`src/admin.html`, `src/customer-account.html`, `src/customer-login.html`, `src/customer-register.html`,
`scripts/run-customer-auth-browser-preview.mjs`, `scripts/test-customer-auth-config.mjs`, `scripts/test-customer-auth-http.mjs`, `scripts/test-customer-auth-otp-send.mjs`, `scripts/test-customer-auth-otp-store.mjs`, `scripts/test-customer-auth-otp-verification.mjs`, `scripts/test-customer-auth-postgres-concurrency.mjs`, `scripts/test-customer-auth-r1-integration.mjs`, `scripts/test-customer-auth-registration.mjs`, `scripts/test-customer-auth-schema.mjs`, `scripts/test-customer-auth-sms.mjs`, `scripts/test-customer-auth-validation.mjs`, `scripts/test-migration-006-runner.mjs`, `scripts/test-postgres-integration.mjs`, `scripts/test-self-hosted.mjs`.

وابستگی: migration `007` به ساختار auth در `006` وابسته است؛ `server/index.js` به هر دو migration و سرویس‌های `server/customer-auth-*`/`server/customer-referrals.js` وابسته است؛ فرم مدیر به API و migration `007` وابسته است؛ `package.json` فرمان `test:postgres` را به تست‌های PostgreSQL وصل می‌کند.

### گروه B — SEO و تصویر کمپینِ موجود

`src/index.html`, `worker/platform.js`, `src/assets/black-friday-haircut-crop.webp`, `scripts/test-seo.mjs`.

وابستگی: تصویر crop به صفحهٔ خانه وابسته است؛ آزمون SEO و `scripts/build-worker.mjs` با تغییرهای `src/index.html` و `worker/platform.js` هم‌نسخه بمانند. `scripts/build-worker.mjs` در گروه A مشترک است و باید فقط یک بار commit شود. سایر فایل‌های این گروه از commit احراز هویت مستقل قابل ثبت‌اند.

### گروه C — تحویل، قراردادها و تصاویر آزمون

`docs/CUSTOMER_AUTH_HANDOFF.md`, `docs/CUSTOMER_AUTH_REVIEW_FA.md`, `docs/FUTURE_STAFF_AND_REFERRALS.md`, `docs/REFERRAL_REQUIREMENTS.md`,
`docs/customer-auth-review-assets/customer-account-final-mobile.png`, `docs/customer-auth-review-assets/customer-account-mobile.png`, `docs/customer-auth-review-assets/customer-login-desktop.png`, `docs/customer-auth-review-assets/customer-login-final-mobile.png`, `docs/customer-auth-review-assets/customer-login-mobile.png`, `docs/customer-auth-review-assets/customer-register-desktop.png`, `docs/customer-auth-review-assets/customer-register-mobile.png`, `docs/customer-auth-review-assets/customer-referrals-admin-desktop.png`, `docs/customer-auth-review-assets/customer-referrals-admin-mobile.png`,
`prompts/03-auth-contract.md`, `prompts/BATCH_REPORT.md`, `prompts/BATCH_REVIEW.md`, `prompts/R2-credential-cleanup.md`, `prompts/README.md`, `prompts/COPILOT_SEO_HANDOFF.md`.

وابستگی: این گروه runtime dependency ندارد. `prompts/COPILOT_SEO_HANDOFF.md` تحویل جداگانهٔ کار SEO است و می‌تواند در commit مستندات مستقل بماند. Promptهای تاریخی دیگر و archiveهای ورودی برای اجرای محصول لازم نیستند؛ در فهرست پیشنهادی نیامده‌اند.

## وضعیت ثبت و انتشار

- شاخه و commit: `codex/black-friday-offer` / `9a60c014318c3e7847b497ce765c3fa179fe0dbf`
- تغییرها uncommitted و unstaged هستند؛ commit ساخته نشده است.
- هیچ push، deploy یا migration روی پایگاه واقعی انجام نشده است.
- پیش از commit، فایل‌های پیشنهادی را دستی با تغییرهای موجود مقایسه کنید؛ از `git add .` استفاده نکنید.
