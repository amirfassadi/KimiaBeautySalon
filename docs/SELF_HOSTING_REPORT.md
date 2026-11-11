# گزارش آماده‌سازی self-hosted کیمیا

## پیشرفت نصب VPS توسط مالک — 2026-11-11

شواهد این بخش خروجی فرمان‌های ارسالی مالک از SSH هستند؛ Codex به VPS متصل نشده است.

- Node.js 22.23.4، npm 10.9.9 و Git 2.39.5 نصب شدند. نصب وابستگی‌ها، build، npm test و lint روی Debian موفق بودند.
- DNS عمومی دامنه اصلی و www به 87.107.54.244 پاسخ داد؛ پورت 3018 پیش از نصب خالی بود.
- PostgreSQL 18.6، دیتابیس تازه kimia، مالک/نقش kimia_app غیر-superuser و اتصال TCP رمزی روی 127.0.0.1 تأیید شدند.
- release 8089bc1 نصب و migrationهای 001,002,003,005 موفق اجرا شدند؛ 004 اجرا نشد. مدیر مستقل با CLI ساخته شد.
- فرمان systemd روی VPS با --preserve-symlinks-main اصلاح شد؛ وضعیت active(running)، listener روی 127.0.0.1:3018 و health با database_ready:true تأیید شدند.
- گواهی برای apex و www صادر شد؛ Nginx اختصاصی با nginx -t موفق فعال شد. HTTPS health موفق و HTTP/www با 301 به دامنه اصلی هدایت شدند.
- hook تمدید نصب شده، اما فرمان تست همراه --run-deploy-hooks توسط Certbot مقصد رد شد. راهنمای تست به dry-run سازگار و تست جداگانه hook اصلاح شد؛ نتیجه این دو تست هنوز دریافت نشده است.
- پذیرش مرورگری دامنه، ورود واقعی مدیر در مرورگر، محتوای نهایی، SEO نهایی و backup/restore هنوز تأیید نشده‌اند. سایت از نظر سرویس و HTTPS فعال است؛ تکمیل لانچ محتوا هنوز باقی است.

## اصلاح شروع سرویس از لینک current — 2026-11-11

خروج موفق بدون listener روی VPS ناشی از تطبیق رشته‌ای process.argv[1] با import.meta.url در entrypoint بود: Node فایل اصلی را به مسیر واقعی release resolve می‌کرد، ولی argv مسیر لینک current را نگه می‌داشت. با این اختلاف، بدنه شروع برنامه اجرا نمی‌شد.

- ExecStart سرویس با گزینه `--preserve-symlinks-main` اصلاح شد؛ مسیر current و معماری جابه‌جایی releaseها حفظ می‌شوند.
- تست regression جدید scripts/test-service-startup.mjs همان فرمان را از یک لینک موقت اجرا می‌کند و اثبات می‌کند startup واقعاً اجرا می‌شود، نه خروج خاموش با کد صفر. این تست به npm test اضافه شد.
- اجرای واقعی CLI production با همان گزینه و مسیر لینک، PostgreSQL 18.6 با SCRAM و DATABASE_PASSWORD انجام شد؛ سرویس listener ایجاد کرد، health برابر HTTP 200 با database_ready:true بود و صفحه ورود نیز HTTP 200 داد. lint و diff check موفق بودند.
- اصلاح سرویس موجود VPS فقط به تغییر ExecStart، daemon-reload و restart نیاز دارد؛ تغییر رمز یا اجرای دوباره migration لازم نیست. نتیجه restart روی VPS باید جدا تأیید شود.

## اصلاح اتصال رمزی PostgreSQL — 2026-11-11

خطای اجرای migration روی VPS (`client password must be a string`) در کد بازتولید شد: pg هنگام پردازش connectionString بدون رمز، گزینهٔ جداگانه password را با مقدار خالی URL جایگزین می‌کرد. رمز DATABASE_PASSWORD الزاماً اشتباه نبود. آزمون PostgreSQL واقعی قبلی از کلاستر محلی trust استفاده می‌کرد و این مسیر احراز هویت را پوشش نمی‌داد.

- تنظیم اتصال در server/postgres-config.js مشترک شد؛ DATABASE_PASSWORD با encoding درست در URL اتصال داخل حافظه اعمال می‌شود و در فایل یا لاگ نوشته نمی‌شود. سرور، migration CLI و ساخت مدیر از همین تابع استفاده می‌کنند.
- تست regression در scripts/test-postgres-config.mjs با خود Client کتابخانه pg، رمز جداگانه، نویسه‌های خاص، اولویت رمز و خطاهای بدون افشای URL را پوشش می‌دهد و در npm test اجرا می‌شود.
- تست اختیاری واقعی، KIMIA_TEST_DATABASE_PASSWORD را هم پشتیبانی می‌کند.
- build، npm test و lint موفق بودند.
- در کلاستر کاملاً جدا PostgreSQL 18.6 محلی، نقش برنامه رمز SCRAM داشت و اتصال بدون رمز عمداً رد شد. migration CLI با DATABASE_PASSWORD واقعی و تمام آزمون integration شامل ورود مدیر، محتوا، تصویر، restart و logout موفق بودند. این آزمون دیگر trust برای نقش برنامه نبود؛ نقش مدیریت آزمایش فقط روی کلاستر موقت خودمان trust داشت.
- فایل secret کاربر، دیتابیس و تنظیمات VPS در این اصلاح تغییر نکردند. روی VPS باید release اصلاح‌شده دریافت و با همان فایل env موجود اجرا شود.

## نتیجه نهایی بازبینی Codex — 2026-11-11

**کد برای شروع نصب کنترل‌شده روی VPS آماده است؛ خود محیط تولید هنوز نصب یا تأیید نشده است.** این بخش نتیجه جدیدتر است و محدودیت‌های تاریخی بخش‌های پایین را در موارد هم‌پوشان به‌روز می‌کند.

- build، مجموعه تست‌های پیش‌فرض و lint موفق بودند.
- `npm run test:postgres` واقعاً روی PostgreSQL 18.6 محلی Windows، کلاستر موقت جدا در پورت 55439 و دیتابیس آزمایشی `kimia_test_review_final` با نقش غیر-superuser اجرا و موفق شد؛ اجرای دوباره نیز موفق بود.
- regression قبلی روی دیتابیس جدا با همه جدول‌های 001 و تابع حذف‌شده بازتولید شد: runner اکنون پیش از ایجاد history یا relation جدید متوقف می‌شود و تعداد رکوردهای قبلی تغییر نمی‌کند.
- تست integration تقویت شد: تصویر واقعی WebP آپلود می‌شود و logout با cookie قدیمی بررسی می‌شود تا ابطال session سمت سرور اثبات شود.
- Chrome headless واقعاً به backend مستقل و PostgreSQL متصل شد. ورود، ایجاد خدمت از فرم پنل، آپلود WebP با file input، ثبت مجوز و انتشار از فرم، نمایش تصویر در صفحه خدمت، خروج و منع ورود مجدد بدون session موفق بودند. overflow افقی در صفحه اصلی موبایل/دسکتاپ و پنل موبایل بررسی شد؛ تصاویر پنل موبایل و صفحه اصلی دسکتاپ نیز بازبینی شدند. این تست روی loopback بود و پذیرش دامنه/HTTPS تولید نیست.
- syntax هر سه فایل shell بررسی شد. منطق hook با فرمان‌های Nginx/systemctl شبیه‌سازی‌شده تست شد: گواهی دیگر نادیده گرفته شد، نبود www رد شد، nginx -t پیش از reload اجرا شد و شکست آن مانع reload شد. Nginx/Certbot واقعی در این محیط اجرا نشدند.
- راهنمای Certbot به نام صریح گواهی کیمیا و dry-run محدود به همان گواهی اصلاح شد؛ جلوگیری از دسترسی CONNECT عمومی به دیتابیس اختصاصی در دستور نصب تازه اضافه شد.
- مراحل باقی‌مانده، نصب و پذیرش روی VPS طبق SELF_HOSTING.md هستند؛ PostgreSQL سرویس واقعی سیستم و VPS کاربر تغییر نکردند. migration 004 فعال نشد.

گزارش‌های پایین سابقه مراحل قبلی را حفظ می‌کنند؛ عبارت‌های «تست واقعی اجرا نشد» در آن بخش‌ها مربوط به همان نوبت قبلی‌اند.

## بازبینی Codex — 2026-11-11

وضعیت: مسیر اصلی اجرای مستقل با PostgreSQL واقعی محلی تأیید شد، اما به‌دلیل ایراد محافظ migration و نبود hook بارگذاری مجدد گواهی، هنوز برای نصب نهایی VPS تأیید نشده است. تغییرات محلی تا رفع این موارد push نشده‌اند.

- build، همه تست‌های موجود و lint دوباره موفق بودند.
- یک کلاستر کاملاً جدا PostgreSQL 18.6 روی Windows و 127.0.0.1:55439 ساخته شد؛ به VPS یا سرویس PostgreSQL موجود سیستم دست زده نشد.
- نقش غیر-superuser kimia_app و دیتابیس آزمایشی جدا استفاده شد؛ migrations 001,002,003,005 و اجرای دوباره runner موفق بودند. 004 اجرا نشد.
- مسیر HTTP واقعی ورود مدیر، رد هدر Sites جعلی، ایجاد خدمت و نمایش عمومی، آپلود عکس، انتشار در صفحه خدمت، مخفی‌کردن و منع دسترسی فایل، حفظ داده و session پس از restart برنامه و logout موفق بود. این تست، پذیرش مرورگری یا تأیید Linux/VPS نیست.
- ایراد بازتولیدشده: پس از اجرای 001 در دیتابیس آزمایشی دیگر و حذف تابع create_booking_request، همه جدول‌های 001 موجود بودند ولی runner به‌جای توقف، نصب تازه را ادامه داد. migrationMarkers در این حالت [false,false,false] برمی‌گرداند. نصب تازه باید فقط در صورت نبود هرگونه جدول برنامه مجاز باشد.
- برای صدور webroot، hook reload کردن Nginx پس از تمدید موفق گواهی کیمیا هنوز وجود ندارد و باید محدود به همین گواهی اضافه شود.
- ترتیب build پیش از test و اجرای اسکریپت‌ها با sudo sh در SELF_HOSTING.md اصلاح شد.
- آزمون PostgreSQL واقعی فعلاً از اسکریپت موقت اجرا شده؛ افزودن مسیر تست قابل تکرار و regression مورد ناقص‌بودن schema لازم است.

بخش‌های پایین گزارش اولیه اجراکننده هستند؛ در موارد هم‌پوشان، این بخش نتیجه جدیدتر است.

## تکمیل بازبینی Codex — 2026-11-11

- محافظ migration اصلاح شد: وجود اشیای اختصاصی برنامه از کامل‌بودن markerهای migration جدا بررسی می‌شود. نصب تازه فقط در نبود جدول/functionهای برنامه و نبود history مجاز است؛ history خالی، schema ناقص، تابع 001 حذف‌شده، migration خارج ترتیب، 004 و schema نامعتبر پیش از تغییر متوقف می‌شوند. `--adopt-existing` همچنان فقط برای schema کامل 001–003 و با تأیید صریح/مالکیت مجاز است.
- تست regression با PGlite: تمام جدول‌های 001 وجود دارند ولی `create_booking_request` حذف شده است؛ runner رد می‌کند، history یا هیچ relation/function جدیدی نمی‌سازد، دادهٔ قبلی را تغییر نمی‌دهد و تابع حذف‌شده را بازنمی‌سازد. حالت history خالی و رد migration 004 نیز تست شد. Migrationهای 001–004 تغییر نکردند و 004 فعال نشد.
- hook تمدید در `deploy/certbot/50-kimia-nginx-reload.sh` اضافه شد. فقط lineage دقیق گواهی apex کیمیا با هر دو hostname را می‌پذیرد، سپس `nginx -t` و reload ترتیبی اجرا می‌کند. دستور نصب و بررسی webroot/deploy hook در راهنمای self-hosting درج شد.
- integration test قابل‌تکرار واقعی در `scripts/test-postgres-integration.mjs` و `npm run test:postgres` اضافه شد. بدون `KIMIA_TEST_DATABASE_URL` هیچ اتصال یا تغییر دیتابیس ندارد؛ با تنظیم صریح فقط localhost و دیتابیس `kimia_test_*` را می‌پذیرد و خودش دیتابیس ایجاد/حذف نمی‌کند. تست، migrations/rerun، admin login/logout، CRUD خدمت، انتشار/مخفی‌کردن تصویر و ماندگاری پس از restart را اجرا می‌کند.
- تست PostgreSQL واقعی در این نوبت اجرا نشد: `KIMIA_TEST_DATABASE_URL` تنظیم نبود. تست PGlite موجود اجرا شد. PostgreSQL 18.6 و HTTP واقعیِ گزارش قبلی Codex در بخش قبلی ثبت شده‌اند و این اجرای جدید محسوب نمی‌شوند.
- اعتبارسنجی محلی: `npm run build`, `npm test`, `npm run lint`, `bash -n` برای hook و دو اسکریپت backup/restore، و `git diff --check` موفق شدند. اجرای Certbot/Nginx و reload واقعی انجام نشد.

## وضعیت

**کد و بستهٔ راه‌اندازی محلی آمادهٔ بازبینی‌اند؛ محیط تولید آماده یا تأییدشده نیست.** هیچ اتصال به VPS، اجرای migration واقعی، تنظیم secret/DNS/Nginx، صدور گواهی، انتقال داده، انتشار، commit یا push انجام نشده است. دامنه، IP و مشخصات VPS در این گزارش صرفاً اطلاعات اعلام‌شدهٔ کاربرند.

## تغییرات اصلی

- اجرای مستقل Node/Worker و health check دیتابیس: `server/index.js`.
- PostgreSQL parameterized adapter با allowlist جدول/فیلد/فیلتر: `server/postgres-adapter.js`.
- migration runner با advisory lock، checksum، ترتیب نسخه‌ها، جلوگیری از adoption ناخواسته و رد 004: `server/migrate.js`.
- رمز scrypt، session دیتابیسی، logout، same-origin و throttle ورود اتمی: `server/passwords.js`, `server/admin-auth.js`.
- ابزار تعاملی ساخت/تغییر مدیر: `server/bootstrap-admin.js`.
- ذخیرهٔ disk-based تصاویر، outside-release و قواعد publication در لایهٔ standalone: `server/index.js`.
- جدول‌های مدیر مستقل (005 בלבד؛ 004 اجرا نمی‌شود): `db/migrations/005_self_hosted_admin.sql`.
- صفحهٔ ورود مستقل و خروج پنل: `src/admin-login.html`, `src/admin.html`.
- سرویس systemd، دو پیکربندی Nginx، backup و restore غیرمخرب به دیتابیس جدید: `deploy/`.
- تست‌های مستقل روی PGlite و اتصال به `npm test`: `scripts/test-self-hosted.mjs`, `package.json`.
- تست اختیاری اتصال واقعی به دیتابیس آزمایشی loopback: `scripts/test-postgres-integration.mjs`, `npm run test:postgres`.
- env نمونه: `.env.example`.
- راهنمای اجرا، checklist مقصد جدید و این گزارش: `docs/SELF_HOSTING.md`, `docs/LAUNCH_CHECKLIST.md`.

## معماری

Node.js فقط روی `127.0.0.1:3018` bind می‌شود؛ Nginx مجزای دامنهٔ کیمیا reverse proxy است. فقط peer loopback اجازه می‌دهد proxy headers برای scheme/IP معتبر باشند. هدرهای هویت Sites از درخواست حذف و هویت مدیر فقط پس از تطبیق session سمت سرور به Worker تزریق می‌شود. فایل تصویر خارج از release در `UPLOAD_DIR` ذخیره می‌شود؛ PostgreSQL شامل دادهٔ سایت، metadata، مدیر و session است.

Runner به ترتیب 001, 002, 003, 005 را اجرا می‌کند و 004 را رد می‌کند. برای schema قبلی adoption فقط با `--adopt-existing` و پس از بررسی کامل/مالکیت انجام می‌شود؛ schema ناقص یا history خارج از ترتیب رد می‌شود. تنظیم محیط، نقش‌ها و دیتابیس واقعی توسط این کار انجام نشده است.

## تست‌های اجراشده

- `npm run build` — موفق.
- `npm test` — موفق؛ شامل تست‌های Worker، پنل، محتوا/SEO، PGlite مهاجرت‌های قبلی، auth OTP غیرفعال، و مسیر مستقل.
- `npm run lint` — موفق (`tsc --noEmit`).
- تست standalone با PGlite: اجرای migrations 001–003 و 005، rerun/checksum، adoption و حفظ داده، رد schema ناقص/غیرترتیبی/004، admin login ناموفق/موفق/موازی، محدودیت تلاش، session/انقضا/logout، CSRF، جعل هدر Sites، CRUD خدمات، publication تصویر و persistence پس از restart.
- تست redirect `www` با هدر Host واقعی و تست اختلاف `public_base_url` پنل با canonical دامنهٔ self-hosted.
- مرورگر محلی: صفحهٔ عمومی و نمای ایستای پنل/ورود در اندازه‌های دسکتاپ و موبایل باز شدند و overflow افقی مشاهده نشد. API پنل در این روش file/Vite به backend standalone وصل نبود و فونت محلی در `file:` با خطای دسترسی بارگذاری نشد؛ بنابراین این بررسی پذیرش بصری/عملکردی کامل نیست.
- `bash -n deploy/backup.sh` و `bash -n deploy/restore-db-to-new.sh` — موفق از طریق Git Bash؛ `git diff --check` نیز موفق بود. Nginx/Certbot در این محیط نصب نیستند.

PGlite، PostgreSQL کامپایل‌شده به WASM است؛ این تست‌ها تأیید PostgreSQL 18 واقعی یا مجوزهای نقش‌های VPS نیستند.

## انجام‌نشده و محدودیت

- مرورگر موبایل/دسکتاپ روی دامنهٔ production، و پذیرش عملکردی پنل متصل به PostgreSQL واقعی انجام/تأیید نشده است.
- DNS عمومی، IP، SSH، Nginx موجود، PostgreSQL 18، firewall، Certbot، timer تمدید، health check روی VPS و free-port بررسی نشده‌اند.
- داده‌های واقعی Supabase و bytes فضای R2 به سرور انتقال داده نشده‌اند. برای مهاجرت داده/عکس‌ها به برنامه و آزمون restore جداگانه نیاز است.
- مدیر قبلی Sites قابل انتقال فرض نشده؛ مدیر مستقل باید بعد از نصب با CLI امن ساخته شود.
- نسخهٔ Sites قدیمی فعال/غیرفعال نشده؛ مالک باید برای جلوگیری از محتوای تکراری دربارهٔ audience/redirect تصمیم بگیرد.
- اجرای دستی دستورهای مستندشده، provisioning عمومی، ثبت Search Console و پشتیبان‌گیری خارج‌سرور باقی مانده‌اند.

## تنظیمات موردنیاز در مقصد (نام‌ها، بدون secret)

`NODE_ENV`, `HOST`, `PORT`, `PUBLIC_BASE_URL`, `DATABASE_URL`, `DATABASE_PASSWORD`, `UPLOAD_DIR`, `ALLOWED_HOSTS`. نیاز به نقش دیتابیس غیر-superuser `kimia_app`, نقش‌های سازگاری `anon`/`authenticated`/`service_role`، Nginx، دامنه‌های apex و www، دسترسی HTTP/HTTPS و مسیر پایدار ذخیره‌سازی وجود دارد. هیچ‌یک از این تنظیم‌ها در محیط تولید در این کار مقداردهی نشده‌اند.

## مراحل باقی‌مانده به‌ترتیب

1. در VPS نسخهٔ واقعی Debian/PostgreSQL، DNS عمومی، Nginx فعال و free port 3018 را بررسی کنید.
2. Node.js LTS، کاربر `kimia`، مسیر release و `/var/lib/kimia/uploads` را طبق [SELF_HOSTING.md](./SELF_HOSTING.md) آماده کنید.
3. نقش‌های دیتابیس را پس از بازرسی ایجاد کنید، DB را بسازید و env را با مجوز محدود تنظیم کنید.
4. build/test/lint را روی release اجرا و migrations 001–003, 005 را فقط روی دیتابیس مقصد، پس از backup، اعمال کنید؛ migration 004 ممنوع است.
5. مدیر را با CLI بسازید، systemd را فعال کنید و health محلی را بررسی کنید.
6. ابتدا vhost ACME مستقل را اضافه کنید؛ پس از DNS و challenge موفق، HTTPS را فعال و `nginx -t`/renewal dry-run را تأیید کنید.
7. محتوای مجاز و تصاویر واقعی را وارد کنید؛ گردش کار پنل، امنیت، sitemap، تماس و SEO را روی دامنهٔ نهایی بپذیرید.
8. backup/restore را آزمایش کنید، نسخهٔ Sites و سیاست canonical را با مالک هماهنگ کنید و سپس دربارهٔ انتشار تصمیم بگیرید.

## ریسک‌ها و بازگشت

- هر migration دارای checksum است و فایل migration اعمال‌شده نباید تغییر کند. rollback دیتابیس خودکار وجود ندارد.
- قبل از schema/content migration از PostgreSQL و تصاویر backup بگیرید؛ restore به DB جدید انجام می‌شود تا منبع تغییر نکند.
- برای rollback برنامه، symlink `current` را به release قبلی برگردانید. اگر schema جدید ناسازگار بود، سرویس را متوقف و backup را به دیتابیس تازه restore کنید؛ حذف دیتابیس فعال انجام ندهید.
- loss یا mismatch میان backup فایل‌ها و دیتابیس ممکن است لینک تصویرها را خراب کند؛ هر دو باید از مجموعهٔ زمانی منطبق restore شوند.

## اولین اقدام روی VPS

پس از اتصال SSH، فقط این فرمان‌های خواندنی را اجرا و خروجی نسخه/وضعیت را نگه دارید:

```sh
hostnamectl
cat /etc/debian_version
sudo -u postgres psql -d postgres -c 'select version()'
sudo systemctl is-active nginx
sudo ss -ltnp
dig @1.1.1.1 A kbkimiabeauty.ir
dig @1.1.1.1 A www.kbkimiabeauty.ir
```

اگر نام میزبان، PostgreSQL مقصد، DNS یا آزادبودن پورت 3018 با اطلاعات مالک تطبیق نداشت، پیش از هر تغییر توقف کنید.
