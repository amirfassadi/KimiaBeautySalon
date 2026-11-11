# چک‌لیست راه‌اندازی KimiaBeautySalon روی VPS

مقصد برنامه‌ریزی‌شده: Debian 12 / PostgreSQL 18 / Nginx، دامنهٔ اصلی `https://kbkimiabeauty.ir`. فقط مواردی که در سطح مشخص‌شده واقعاً بررسی شده‌اند تیک خورده‌اند. تست محلی یا PGlite تأیید تولید نیست.

## آمادگی کد — بررسی محلی

- [x] سرور مستقل Node و PostgreSQL pool با `DATABASE_URL` پیاده‌سازی شده؛ تست با PGlite انجام شد.
- [x] migration runner مستقل، ثبت checksum/ترتیب، advisory lock، adoption محافظت‌شده و عدم اجرای migration 004 پیاده‌سازی و با PGlite تست شد.
- [x] احراز هویت مستقل مدیر، hash رمز، session قابل ابطال، throttling، same-origin و رد هدر هویت Sites پیاده‌سازی و تست شد.
- [x] ذخیرهٔ disk-based تصاویر خارج از release و کنترل انتشار در مسیر مستقل تست شد.
- [x] `www` به apex redirect می‌شود و canonical/schema/sitemap/robots از دامنهٔ ثابت standalone استفاده می‌کنند؛ اختلاف دامنهٔ پنل با دامنهٔ اصلی تست شد.
- [x] بستهٔ systemd، Nginx، env نمونه، backup و restore به DB جدید آماده شده‌اند؛ روی VPS نصب یا اجرا نشده‌اند.
- [x] مسیر عمومی عضویت مشتری، SMS، پرداخت و درخواست/پیگیری آنلاین نوبت در حالت مستقل غیرفعال است؛ migration 004 اجرا نمی‌شود.
- [x] مسیر CRUD خدمت، صفحهٔ عمومی/غیرفعال، تصویر و ماندگاری پس از restart با تست محلی PGlite پوشش داده شد.

## تست محلی

- [x] اصلاح و تست شروع واقعی CLI production از لینک current با --preserve-symlinks-main؛ تست regression شروع سرویس، health 200 و صفحه ورود 200 با PostgreSQL/SCRAM محلی تأیید شدند. وضعیت systemd روی VPS جداگانه بررسی شود.

- [x] اصلاح دریافت DATABASE_PASSWORD در pg برای هر سه ابزار سرور/migration/مدیر؛ تست regression رمز و نویسه‌های خاص اضافه شد.
- [x] migration CLI و integration با PostgreSQL 18.6 واقعی و احراز هویت اجباری SCRAM موفق بودند؛ اتصال بدون رمز در همان کلاستر رد شد. آزمون‌های قبلی با trust، تأیید SCRAM محسوب نمی‌شوند.

- [x] `npm run build` پاس شد.
- [x] `npm test` پاس شد؛ PGlite WASM است، نه PostgreSQL 18 واقعی.
- [x] `npm run lint` پاس شد (`tsc --noEmit`).
- [x] مرورگر محلی: صفحهٔ عمومی و نمای ایستای پنل/ورود در اندازه‌های دسکتاپ و موبایل باز و overflow افقی بررسی شد؛ این تأیید عملکرد API یا production نیست.
- [x] پذیرش عملکردی محلی Chrome متصل به backend مستقل و PostgreSQL 18.6: ورود، ایجاد خدمت از فرم، آپلود WebP با file input، انتشار، نمایش در صفحه خدمت و خروج موفق؛ بررسی موبایل/دسکتاپ و تصاویر صفحه اصلی دسکتاپ و پنل موبایل انجام شد. این تأیید VPS نیست.
- [x] بازبینی Codex: نصب تازه و اجرای دوباره migrations با PostgreSQL واقعی 18.6 محلی Windows و نقش kimia_app غیر-superuser موفق بود؛ این تأیید VPS لینوکسی نیست.
- [x] بازبینی Codex: گردش HTTP واقعی ورود مدیر، رد جعل هویت، ایجاد خدمت، آپلود/انتشار/مخفی‌کردن تصویر، حفظ داده و session پس از restart برنامه و ابطال session در logout با PostgreSQL 18.6 موفق بود.
- [ ] نصب/اجرای محلی systemd، Nginx، Certbot، backup/restore واقعی و DNS تست نشده‌اند.
- [x] syntax check اسکریپت‌های backup/restore با `bash -n` از طریق Git Bash پاس شد.
- [x] محافظ migration تفکیک presence از completeness را انجام می‌دهد؛ regression همهٔ جدول‌های 001 بدون تابع `create_booking_request` و عدم ایجاد history/اشیاء دیتابیس/تغییر داده با PGlite پاس شد.
- [x] deploy hook محدود به lineage گواهی Kimia و هر دو hostname اضافه شد؛ syntax با `bash -n` تأیید شد. اجرای renewal واقعی یا reload Nginx انجام نشده است.
- [x] تست اختیاری PostgreSQL واقعی با الزام `KIMIA_TEST_DATABASE_URL` محلی و نام دیتابیس `kimia_test_*` اضافه شد؛ بدون تنظیم، اتصال یا تغییر دیتابیس نمی‌کند.
- [x] `npm run test:postgres` بدون env صریح اجرا و به‌صورت امن skip شد؛ اتصال واقعی در این نوبت انجام نشد.
- [x] بازبینی نهایی Codex: `npm run test:postgres` با env صریح روی دیتابیس آزمایشی مجزای PostgreSQL 18.6 واقعاً اجرا و دوباره اجرا شد؛ هر دو موفق بودند. تست logout با cookie قدیمی و آپلود تصویر واقعی تقویت شد.
- [x] regression schema ناقص در PostgreSQL 18.6 واقعی رد شد، بدون ایجاد history/relation یا تغییر تعداد داده قبلی.
- [x] منطق hook با فرمان‌های شبیه‌سازی‌شده تست شد؛ گواهی نامرتبط و نبود www مدیریت شدند و شکست nginx -t مانع reload شد. تمدید واقعی VPS همچنان انجام‌نشده است.

## موارد باز در بازبینی Codex — تکمیل کد

- [x] اصلاح تشخیص schema ناقص؛ اکنون پیش از هر DDL رد می‌شود و regression test داده/history/اشیاء را بررسی می‌کند.
- [x] تکمیل hook محدود به گواهی کیمیا؛ Nginx test precedes reload.
- [x] اصلاح ترتیب نصب تازه و به‌روزرسانی به npm ci، build، test، lint در راهنما؛ تست به dist نیاز دارد.
- [x] اجرای اسکریپت‌های backup/restore با sudo sh در راهنما، بدون وابستگی به بیت اجرایی فایل‌های Git.
- [x] ثبت تست قابل‌تکرار PostgreSQL واقعی اختیاری و regression برای schema ناقص. اجرای این تست در نوبت جاری انجام نشد.

## وابسته به VPS/مالک — قبل از راه‌اندازی

- [ ] تأیید نسخهٔ واقعی PostgreSQL 18، نقش `kimia_app` غیر-superuser، نقش‌های سازگاری و اتصال localhost.
- [ ] تأیید DNS عمومی apex و www روی IP مقصد، پورت 3018 آزاد و دسترسی 80/443.
- [ ] ساخت کاربر سرویس، مسیرهای دائمی، تکمیل env محافظت‌شده و نصب release.
- [ ] Backup schema/data موجود؛ سپس migrationهای 001, 002, 003, 005 به‌ترتیب. Migration 004 نباید اجرا شود.
- [ ] تصمیم‌گیری و اجرای برنامهٔ جداگانه برای انتقال دادهٔ Supabase و bytes تصاویر R2؛ انتقال فعلی خودکار نیست.
- [ ] ایجاد مدیر با CLI و آزمون ورود، خروج، کاربر غیرمجاز، CSRF و جعل هدر.
- [ ] نصب فقط vhost کیمیا، صدور گواهی هر دو hostname، تست renew و healthcheck واقعی.
- [ ] بارگذاری محتوای واقعی و تصاویر دارای مجوز، آزمون کامل پنل تا صفحهٔ عمومی و پذیرش SEO/contact.
- [ ] تصمیم مالک دربارهٔ خاموش‌کردن یا canonical/redirect نسخهٔ قدیمی Sites برای جلوگیری از محتوای تکراری.
- [ ] backup خارج‌سرور و restore دوره‌ای DB + تصاویر با checksum تأیید شود.
- [ ] تأیید Search Console و ارسال sitemap پس از انتشار عمومی.

## وضعیت تولید

هیچ اتصال VPS، migration تولید، تغییر secret، تغییر DNS/Nginx، صدور HTTPS، انتقال داده یا انتشار انجام نشده است. تکمیل و محدودیت‌ها در [SELF_HOSTING_REPORT.md](./SELF_HOSTING_REPORT.md) و مراحل اجرایی در [SELF_HOSTING.md](./SELF_HOSTING.md) است.
