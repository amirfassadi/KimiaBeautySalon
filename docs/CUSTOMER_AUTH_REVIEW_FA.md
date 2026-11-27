# گزارش بازبینی نهایی محلی ورود مشتری و ثبت معرف

این سند نتایج بازبینی و وضعیت مخزن در ۲۰۲۶/۱۱/۲۷ را ثبت می‌کند؛ برای وضعیت نهایی commit و push به [گزارش ثبت Git](./CUSTOMER_AUTH_GIT_HANDOFF_FA.md) مراجعه کنید.

تاریخ: ۲۰۲۶/۱۱/۲۷
**نتیجه: پذیرش محلی موفق** برای جریان‌های آزمایش‌شده؛ این نتیجه تأیید مستقل امنیتی یا آمادگی تولید نیست.
دامنه: بازبینی کد و آزمون مسیر واقعی Node با پایگاه موقت، SMS ساختگیِ تزریق‌شده در harness و مدیر آزمایشی.

در این دور ایراد جدیدی در کد احراز هویت یا ثبت معرف تأیید نشد و فایل پیاده‌سازی تغییر نکرد. یک ناهماهنگی مستنداتی در فهرست migrationهای مورد انتظار راهنمای VPS اصلاح شد تا migration معرف `007` هم درج شود؛ گزارش‌ها و تصاویر نیز تازه شدند. تغییرهای قبلی مخزن، از جمله SEO، رزرو، ورود مدیر و رسانه‌ها حفظ شدند؛ مالکیت تک‌تک تغییرهای قبلی را نمی‌توان به این دور نسبت داد.

## یافته‌ها

| # | شدت | محل | یافته | وضعیت و اطمینان |
|---|---|---|---|---|
| — | — | — | در بازبینی فعلی آسیب‌پذیری حل‌نشده و قابل‌بازتولید تأیید نشد. | اطمینان بالا؛ مسیرهای اصلی با تست‌های خودکار و سرور محلی بررسی شدند. |

### سابقهٔ یافتهٔ اصلاح‌شده

در بازبینی پیشین، مقایسهٔ انقضای proof ثبت‌نام در guard صفحه با ساعت پایگاه داده انجام نمی‌شد. این مورد در [server/index.js:330](../server/index.js#L330) اصلاح شد و آزمون اختلاف ساعت به [scripts/test-customer-auth-r1-integration.mjs:242](../scripts/test-customer-auth-r1-integration.mjs#L242) افزوده شد. آزمون تازهٔ `npm test` و جریان ثبت‌نام مرورگری نشان دادند proof معتبر مصرف می‌شود و proof منقضی اجازهٔ تکمیل ثبت‌نام نمی‌دهد. این یافته بسته است و آسیب‌پذیری جاری محسوب نمی‌شود.

## شواهد کد و روش بازتولید

| کنترل | محل کد | شواهد بازبینی و روش |
|---|---|---|
| خاموش‌بودن پیش‌فرض و گیت preview | [server/customer-auth-http.js:126](../server/customer-auth-http.js#L126) و [server/customer-auth-http.js:138](../server/customer-auth-http.js#L138) | مسیرهای مشتری به فعال‌بودن گیت‌ها، نشست مدیر preview و readiness نیاز دارند. با پیکربندی پیش‌فرض و درخواست بدون مدیر، مسیر محصول قابل ورود نیست؛ `npm test` آزمون config/HTTP را اجرا کرد. |
| انقضا، مصرف یک‌باره و جایگزینی اعتبارنامه | [server/customer-auth-otp-verification.js:64](../server/customer-auth-otp-verification.js#L64)، [server/customer-auth-otp-verification.js:137](../server/customer-auth-otp-verification.js#L137)، [server/customer-auth-session.js:15](../server/customer-auth-session.js#L15) | قفل تراکنشی شماره، بررسی زمان پایگاه داده، مصرف challenge و ابطال نشست قبلی بررسی شد. در آزمون مرورگر، پس از صدور نشست تازه، `/api/auth/me` با cookie قدیمی `401` و با cookie جدید `200` داد؛ آزمون concurrency در PostgreSQL نیز موفق بود. |
| خروج اتمیک و قواعد درخواست | [server/customer-auth-http.js:67](../server/customer-auth-http.js#L67)، [server/customer-auth-http.js:77](../server/customer-auth-http.js#L77)، [server/customer-auth-http.js:248](../server/customer-auth-http.js#L248) | Origin، نوع JSON، اندازهٔ بدنه، روش مجاز، transaction و پاک‌شدن cookie بررسی شدند. خروج مرورگری به `/login` برگشت و Back اطلاعات قبلی را نشان نداد. |
| انقضای proof صفحهٔ ثبت‌نام | [server/index.js:330](../server/index.js#L330) | query با زمان پایگاه داده، مصرف/ابطال proof و redirect در مسیر Node بررسی شدند. proof منقضی در آزمون مرورگر پاسخ `410` گرفت. |
| جداسازی مدیر از مشتری و API معرف | [server/index.js:415](../server/index.js#L415) و [server/index.js:428](../server/index.js#L428) | مسیر مدیریتی پس از بررسی نشست مدیر ارائه می‌شود. در آزمون واقعی، پس از خروج مدیر، درخواست مشتری‌تنها به API معرف `401` گرفت. برای دسترسی مجدد به صفحهٔ preview باید مدیر وارد شود. |
| تأیید، اصلاح و تاریخچهٔ معرف | [server/customer-referrals.js:201](../server/customer-referrals.js#L201)، [server/customer-referrals.js:218](../server/customer-referrals.js#L218)، [db/migrations/007_customer_referrals.sql:18](../db/migrations/007_customer_referrals.sql#L18) | راه آشنایی، اعلام مشتری، معرف تأییدشده، وضعیت «نامشخص/بدون معرف» و تاریخچه جدا هستند. شخص بیرونی ثبت شد؛ تأیید و اصلاح مدیر دو رکورد تاریخچه ساختند. ورودی نام همسان در تست‌ها ادغام خودکار نشد. |
| قید داده و دسترسی مستقیم | [db/migrations/007_customer_referrals.sql:101](../db/migrations/007_customer_referrals.sql#L101) | جدول تاریخچه و قیدهای RLS/revoke در migration افزایشی بررسی شدند؛ migrationهای قبلی تغییر نکرده‌اند. |

ناهماهنگی مستنداتیِ مرتبط: معیار فهرست migrationهای مورد انتظار در [docs/SELF_HOSTING.md:174](./SELF_HOSTING.md#L174) migration `007_customer_referrals.sql` را حذف کرده بود؛ فهرست اکنون با runner و آزمون PostgreSQL همسان است. این مورد مستنداتی اصلاح شد و آسیب‌پذیری امنیتی نبود.

## آزمون‌های اجراشده

| فرمان یا روش | نتیجه |
|---|---|
| `npm run build` | موفق؛ artefact محلی ساخته شد. |
| `npm test` | موفق؛ تمام آزمون‌های تعریف‌شده در package script، شامل auth، OTP، registration، migration، referral، Worker، admin، SEO و startup گذشتند. |
| `npm run lint` | موفق؛ `tsc --noEmit` بدون خطا. |
| `npm run test:postgres` | در اجرای نهایی موفق؛ PostgreSQL 18 موقت، UTF-8/locale `C`، پورت `55439` و دیتابیس `kimia_test_customer_auth` روی loopback. `kimia_app` نقش غیر-superuser و بدون `BYPASSRLS` بود. تست integration، مهاجرت تکرارپذیر و concurrency/rollback/outage/جایگزینی نشست گذشتند؛ cluster متوقف و حذف شد. |
| تلاش نخست `npm run test:postgres` | پیش از اجرای integration متوقف شد، چون cluster تازه نقش‌های لازم `anon`، `authenticated` و `service_role` را نداشت. این پیش‌نیاز در cluster دورریختنی ایجاد شد و اجرای دوم موفق بود؛ هیچ نقشی یا تغییری به پایگاه واقعی اعمال نشد. |
| `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort` و GET صفحهٔ اصلی | Vite آماده شد و GET `http://127.0.0.1:5173/` پاسخ `200 text/html` داد. پس از SIGINT عمدی برای توقف، shell کد `1` برگرداند؛ listener بسته شد و خطای startup/HTTP نبود. |
| `node scripts/run-customer-auth-browser-preview.mjs` | چند harness جداگانه فقط روی `127.0.0.1` اجرا شدند. handler واقعی standalone Node، migrationها، PGlite موقت، مدیر آزمایشی و SMS ساختگیِ تزریق‌شده استفاده شد؛ کد OTP یا token در گزارش ثبت نشد. پس از آزمون، listenerها و پوشه‌های موقت متوقف و پاک شدند؛ فرایندهای متصل پس از SIGINT کد خروج `1` دادند. |
| `git diff --check -- . ':(exclude)real data/**'` | موفق؛ whitespace error گزارش نشد. Git فقط هشدارهای پایان‌خط CRLF→LF را برای چند فایل کاری موجود چاپ کرد. |

### نتیجهٔ مسیر مرورگر

- ورود مدیر آزمایشی، مشتری جدید، ثبت‌نام و حساب مشتری؛ همچنین ورود مشتری ازپیش‌موجود اجرا شد.
- شمارش معکوس کامل ۶۰ ثانیه صبر شد. ارسال مجدد پاسخ `202` داد و کد جدید با قبلی متفاوت بود. کد نادرست `401`، کد منقضی `410` و اصلاح شماره در فرم بررسی شد.
- ثبت با معرف یکسان برای سایت و سالن، ثبت بدون معرف، و جدا بودن «ثبت نشده»، «نامشخص» و «بدون معرف شخصی» بررسی شد.
- مدیر معرف بیرونی را تأیید و سپس اصلاح کرد؛ تاریخ‌های اولیهٔ سایت/سالن جدا ماندند و history شامل دو رویداد و دلیل اصلاح بود.
- برای جایگزینی نشست، cookie قبلی پس از تأیید دوباره دیگر معتبر نبود (`401`) و cookie جدید معتبر بود (`200`).
- Reload، Back پس از خروج، پاک‌شدن اطلاعات profile، جلوگیری از نمایش صفحهٔ ثبت‌نام بعد از مصرف proof و جداسازی customer/admin بررسی شدند.
- در emulation موبایل، عرض واقعی محتوای CSS اندازه‌گیری‌شده `312px` و در دسکتاپ `1152px` بود؛ overflow افقی در صفحات ورود، ثبت‌نام و مدیریت معرف مشاهده نشد. فونت محلی Estedad و focus صفحه‌کلید (outline قابل مشاهده) تأیید شدند.
- یک کلیک مختصات‌محور در پنل مرورگر محدود timeout شد؛ همان سناریو با submit فرم در مرورگر و بررسی پاسخ‌های شبکه تکرار و موفق شد. این timeout نتیجهٔ آزمون کد یا نشانهٔ خطای محصول نبود.

### تصاویر پاک‌سازی‌شده

تصاویر از حساب/نام‌های ساختگی harness هستند؛ OTP، token و اطلاعات واقعی مشتری در آن‌ها نیست:

- [ورود مشتری — موبایل نهایی](./customer-auth-review-assets/customer-login-final-mobile.png)
- [ورود مشتری — دسکتاپ](./customer-auth-review-assets/customer-login-desktop.png)
- [ثبت‌نام — موبایل](./customer-auth-review-assets/customer-register-mobile.png)
- [ثبت‌نام — دسکتاپ](./customer-auth-review-assets/customer-register-desktop.png)
- [حساب مشتری — موبایل](./customer-auth-review-assets/customer-account-final-mobile.png)
- [مدیریت معرف — موبایل](./customer-auth-review-assets/customer-referrals-admin-mobile.png)
- [مدیریت معرف — دسکتاپ](./customer-auth-review-assets/customer-referrals-admin-desktop.png)

## انجام‌نشده‌ها و محدودیت

- دستگاه فیزیکی، صفحه‌کلید/صفحه‌خوان واقعی، مرورگرهای متعدد، axe/Lighthouse و آزمون مستقل usability انجام نشدند؛ emulation مرورگر جایگزین آن‌ها نیست.
- مرورگر از PGlite استفاده کرد؛ آزمون PostgreSQL واقعی فقط بخش integration/concurrency را در cluster موقت پوشش داد. browser+PostgreSQL به‌صورت یکپارچه اجرا نشد.
- تنظیمات reverse proxy، secrets و cookieهای میزبان عملیاتی، provider/SMS واقعی، logهای تولید، latency تولید و رفتار نسخهٔ مستقر مستقلاً بررسی نشدند.
- هیچ SMS واقعی، migration پایگاه واقعی، فعال‌سازی عمومی، push یا deploy انجام نشد. گیت‌های عمومی باید خاموش بمانند.
- بررسی performance/SEO این گزارش، اندازه‌گیری تولید نیست و بهبود استقرار را اثبات نمی‌کند.

## تصمیم‌های باقی‌ماندهٔ مالک/زیرساخت

برای هر فعال‌سازی عمومی، مالک باید جداگانه provider پیامک، provisioning امن secretها، سیاست rate-limit/monitoring، زمان و روش migration و rollout را تأیید کند. هیچ‌یک از این موارد با پذیرش محلی فعال نمی‌شود. پنل پرسنل، آلبوم، حقوق، پورسانت و سایر قابلیت‌های مالی خارج از محدوده‌اند.

## وضعیت مخزن

- شاخه: `codex/black-friday-offer`
- commit فعلی: `9a60c014318c3e7847b497ce765c3fa179fe0dbf`
- تغییرها staged یا commit نشده‌اند؛ commit جدید ساخته نشد.
- push، deploy و migration روی پایگاه واقعی انجام نشد.
