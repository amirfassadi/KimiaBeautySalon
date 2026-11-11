# راهنمای میزبانی مستقل KimiaBeautySalon

این راهنما مسیر استقرار مستقل روی Debian 12 و دامنهٔ `kbkimiabeauty.ir` را توضیح می‌دهد. دستورها برای اجرای دستی هستند؛ اجرای آن‌ها روی VPS، تغییر DNS، نصب Nginx/HTTPS یا مهاجرت داده در این تغییر انجام نشده است. پیش از هر مرحله، مقصد را با `hostnamectl`, `psql --version` و `systemctl status nginx` تأیید کنید. به سایت‌های دیگر Nginx، به‌ویژه `dgm.co.ir`، دست نزنید.

## معماری و محدوده

- Production با Node.js پشتیبانی‌شده اجرا می‌شود؛ `vite` و `npm run preview` فقط ابزار توسعه‌اند.
- Node به PostgreSQL از طریق `DATABASE_URL` و pool بستهٔ `pg` وصل می‌شود. اتصال مستقیم PostgreSQL فقط به localhost است.
- دیتابیس باید با نقش اختصاصی غیر superuser به نام `kimia_app` اجرا شود. نقش‌های سازگاری `anon`, `authenticated`, و `service_role` برای grantهای migrationهای تاریخی لازم‌اند و نباید مجوز ورود داشته باشند.
- ترتیب migrationها: `001_initial_schema.sql`, `002_admin_booking.sql`, `003_booking_tracking.sql`, سپس `005_self_hosted_admin.sql`. Migration `004_customer_auth.sql` عمداً خارج از مسیر است؛ OTP، حساب مشتری، SMS، پرداخت و نوبت‌دهی عمومی غیرفعال می‌مانند.
- مدیر با رمز scrypt و session سمت سرور احراز هویت می‌شود. ایجاد/تغییر مدیر با دستور تعاملی انجام می‌شود؛ ورود از طریق Sites و هدرهای هویتی ارسالی کاربر در این مسیر قابل اعتماد نیستند.
- فایل‌های تصویر در `UPLOAD_DIR` دائمی، خارج از release، ذخیره می‌شوند. فقط تصاویر منتشرشده با رضایت ثبت‌شده و لوگوی ثبت‌شده عمومی‌اند.
- `/api/health` اتصال SQL و ثبت هر چهار migration موردنیاز را بررسی می‌کند و اطلاعات اتصال را برنمی‌گرداند.

## ۰. بررسی‌های بی‌تغییر روی VPS

ابتدا مطمئن شوید نشست SSH روی همان میزبان مقصد است:

```sh
hostnamectl
cat /etc/debian_version
psql --version
sudo systemctl is-active nginx
sudo systemctl is-active postgresql
sudo ss -ltnp
```

دسترسی عمومی DNS را از خود سرور و ترجیحاً یک شبکهٔ بیرونی بررسی کنید. BIND محلی پاسخ‌گو بودن به‌تنهایی انتشار عمومی را ثابت نمی‌کند:

```sh
dig @1.1.1.1 NS kbkimiabeauty.ir
dig @1.1.1.1 A kbkimiabeauty.ir
dig @1.1.1.1 A www.kbkimiabeauty.ir
```

دامنه باید به IP مقصد برسد و پورت‌های TCP 80 و 443 از اینترنت قابل دسترس باشند. اگر DNS یا دسترسی شبکه تأیید نشد، برای Certbot ادامه ندهید. پیش از انتخاب پورت محلی، آزادبودن 3018 را بررسی کنید:

```sh
sudo ss -ltnp | grep ':3018' || true
```

خروجی برای 3018 باید خالی باشد. پورت‌های 80 و 443 متعلق به Nginx موجود هستند و فایل جدید باید فقط دو نام دامنهٔ کیمیا را اضافه کند.

## ۱. نصب Node.js و ابزارهای لازم

نسخهٔ Node.js باید نسخهٔ LTS پشتیبانی‌شده و حداقل 22 باشد؛ بستهٔ Debian 12 ممکن است قدیمی‌تر باشد. نمونهٔ نصب Node.js 22 از مخزن امضاشدهٔ NodeSource:

```sh
sudo apt update
sudo apt install -y ca-certificates curl gnupg git
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | sudo gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
sudo chmod 0644 /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
  | sudo tee /etc/apt/sources.list.d/nodesource.list >/dev/null
sudo apt update
sudo apt install -y nodejs
node --version
npm --version
```

پیش از افزودن repository، اثر انگشت کلید و دستورهای جاری را با مستندات رسمی NodeSource تطبیق دهید. ادامه فقط با Node.js پشتیبانی‌شده مجاز است.

## ۲. ساخت کاربر، مسیرهای پایدار و release

```sh
sudo adduser --system --group --home /var/lib/kimia --no-create-home kimia
sudo install -d -o root -g kimia -m 0750 /opt/kimia/releases
sudo install -d -o root -g kimia -m 0750 /etc/kimia
sudo install -d -o kimia -g kimia -m 0750 /var/lib/kimia/uploads
```

از branch/revision مورد تأیید مالک استفاده کنید؛ `main` را بدون بررسی وضعیت مخزن فرض نکنید. `RELEASE` را با نام یکتای همان revision جایگزین کنید. چون کاربر `amir` به `/opt/kimia` دسترسی نوشتن ندارد، clone و build ابتدا در home او انجام می‌شود:

```sh
sudo -u amir git clone https://github.com/amirfassadi/KimiaBeautySalon.git /home/amir/kimia-RELEASE
cd /home/amir/kimia-RELEASE
npm ci
npm run build
npm test
npm run lint
sudo mv /home/amir/kimia-RELEASE /opt/kimia/releases/RELEASE
```

موفقیت `npm run build` باید `dist/server/index.js` را بسازد. سپس دسترسی فقط‌خواندنی برای سرویس فراهم و symlink جاری ساخته شود:

```sh
sudo chown -R root:kimia /opt/kimia/releases/RELEASE
sudo chmod -R u=rwX,g=rX,o= /opt/kimia/releases/RELEASE
sudo ln -sfnT /opt/kimia/releases/RELEASE /opt/kimia/current
```

## ۳. نقش‌ها و دیتابیس PostgreSQL

نسخه و سرویس را مستقل تأیید کنید؛ وجود یک دیتابیس PostgreSQL فعال به‌تنهایی نسخهٔ 18 را ثابت نمی‌کند:

```sh
sudo -u postgres psql -d postgres -c 'select version()'
sudo -u postgres psql -d postgres -c \
  "select rolname, rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname in ('anon','authenticated','service_role','kimia_app')"
```

اگر نقش‌های `anon`, `authenticated` یا `service_role` از قبل وجود دارند، آن‌ها را تغییر ندهید. فقط نقش‌های غایب را به شکل `NOLOGIN` ایجاد کنید. اگر `kimia_app` از قبل وجود دارد، ویژگی‌ها و مالکیت آن را بررسی کنید؛ آن را بی‌بررسی بازتعریف نکنید.

برای نصب تازه، در `psql` با نقش postgres:

```sql
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE kimia_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
\password kimia_app
CREATE DATABASE kimia OWNER kimia_app ENCODING 'UTF8';
REVOKE CONNECT, TEMPORARY ON DATABASE kimia FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE kimia TO kimia_app;
\q
```

خط‌های نقش‌های سازگاری را فقط در صورت نبودن نقش اجرا کنید. `\password` رمز را تعاملی می‌گیرد و آن را در آرگومان فرمان قرار نمی‌دهد. مطمئن شوید `pg_hba.conf` دسترسی password/SCRAM را فقط برای `kimia` از `127.0.0.1/32` فراهم می‌کند؛ PostgreSQL را به اینترنت bind یا پورت 5432 را عمومی نکنید. فقط اگر تنظیم فعلی اجازه نمی‌دهد، یک قاعدهٔ host محدود برای همان دیتابیس/نقش/loopback اضافه و سپس تنظیم را بررسی و reload کنید؛ تنظیمات سایر دیتابیس‌ها را تغییر ندهید.

### تست اختیاری PostgreSQL واقعی محلی

برای اجرای integration test واقعی، یک دیتابیس جدا و دورریختنی با prefix `kimia_test_` در کلاستر **آزمایشی محلی** بسازید؛ هیچ دیتابیس موجود را به‌عنوان هدف تست انتخاب نکنید. تست فقط به `KIMIA_TEST_DATABASE_URL` نگاه می‌کند، loopback و نام دیتابیس را اعتبارسنجی می‌کند، هیچ دیتابیسی نمی‌سازد/حذف نمی‌کند و داده‌های موردآزمون را در همان دیتابیس نگه می‌دارد. نام‌های `kimia`, `production`, یا URL غیرمحلی رد می‌شوند. تست به نقش‌های compatibility از پیش موجود نیاز دارد.

نمونهٔ setup فقط در کلاستر محلی اختصاص‌یافته به تست:

```sh
sudo -u postgres createdb --owner=kimia_app kimia_test_standalone
install -m 0600 /dev/null "$HOME/.pgpass"
${EDITOR:-vi} "$HOME/.pgpass"
```

در `.pgpass` فقط ورودی host/port/db/user همان تست را قرار دهید و فایل را با permission `0600` نگه دارید؛ رمز را در shell history یا URL نگذارید. سپس در release:

```sh
export KIMIA_TEST_DATABASE_URL=postgresql://kimia_app@127.0.0.1:5432/kimia_test_standalone
npm run test:postgres
unset KIMIA_TEST_DATABASE_URL
```

فرمان ابتدا build می‌کند، بعد migrations و اجرای دوباره، login/logout، CRUD خدمت، انتشار/مخفی‌کردن تصویر و ماندگاری DB/session/file پس از restart را آزمایش می‌کند. در نبود متغیر صریح، اسکریپت بدون اتصال یا تغییر دیتابیس skip می‌شود. اجرای تست، ردیف‌های تصادفی آزمون را در DB نگه می‌دارد؛ آن DB را فقط پس از بررسی و با ابزار DBA مدیریت کنید. این فرمان در PostgreSQL 18 واقعی اجرا نشده مگر صریحاً در گزارش آزمون مقصد ثبت شده باشد.

برای schema تازه، migration runner را با نقش برنامه اجرا کنید، نه `postgres`:

```sh
sudo install -o root -g kimia -m 0640 .env.example /etc/kimia/kimia.env
sudoedit /etc/kimia/kimia.env
```

در فایل فقط تنظیم‌های standalone را مقداردهی کنید:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3018
PUBLIC_BASE_URL=https://kbkimiabeauty.ir
DATABASE_URL=postgresql://kimia_app@127.0.0.1:5432/kimia
DATABASE_PASSWORD=رمز-قوی-و-URL-safe-نقش-kimia_app
UPLOAD_DIR=/var/lib/kimia/uploads
ALLOWED_HOSTS=kbkimiabeauty.ir,www.kbkimiabeauty.ir,localhost,127.0.0.1
```

رمز را با password manager بسازید، ترجیحاً فقط حروف و ارقام، و فقط در prompt `\password` و فایل محدودشده وارد کنید. آن را در دستور shell، Git، ticket یا log قرار ندهید. `SUPABASE_*`, `ADMIN_*`, OTP/SMS و `AUTH_CUSTOMER_ENABLED` برای self-hosted فعال نیستند و نباید تنظیم شوند.

رمز جداگانه توسط server/postgres-config.js در حافظه به تنظیم اتصال اعمال می‌شود؛ آن را به‌صورت دستی در URL قرار ندهید. اگر از نسخه قبل از این اصلاح استفاده می‌کنید و خطای `client password must be a string` می‌گیرید، release اصلاح‌شده را نصب کنید؛ غیرفعال‌کردن SCRAM یا تبدیل pg_hba به trust راه‌حل این خطا نیست.

اکنون migrationها را اجرا کنید. فایل env فقط در process محیطی خوانده می‌شود و مقدار رمز در آرگومان فرمان نیست:

```sh
sudo -u kimia sh -c 'set -a; . /etc/kimia/kimia.env; set +a; cd /opt/kimia/current; node server/migrate.js'
```

معیار موفقیت، فهرست دقیق `001_initial_schema.sql, 002_admin_booking.sql, 003_booking_tracking.sql, 005_self_hosted_admin.sql` و exit code صفر است. Runner از advisory lock، checksum و ثبت ترتیب استفاده می‌کند؛ اجرای دوباره فقط checksumها را تأیید می‌کند. آن را با `--adopt-existing` فقط طبق بخش بعدی اجرا کنید.

### دیتابیس دارای داده یا schema قبلی

ابتدا backup بگیرید. Runner بدون گزینهٔ صریح، migration history گمشده را خودکار نمی‌پذیرد. `--adopt-existing` فقط schema کامل migrationهای 001 تا 003 را می‌پذیرد که جدول‌ها و functionهای مورد انتظار متعلق به `kimia_app` باشند:

```sh
sudo -u kimia sh -c 'set -a; . /etc/kimia/kimia.env; set +a; cd /opt/kimia/current; node server/migrate.js --adopt-existing'
```

اگر schema ناقص، متعلق به نقش دیگر، شامل جدول/ردپای migration 004، یا دارای migration ناشناخته/خارج از ترتیب باشد، Runner متوقف می‌شود. ownership را کورکورانه تغییر ندهید و migrationهای اعمال‌شده را ویرایش یا حذف نکنید. ابتدا backup و restore آزمایشی به یک دیتابیس جدید انجام دهید، مالکیت و schema را بررسی کنید، سپس برنامهٔ انتقال جداگانه تهیه کنید. این پروژه محتوای PostgreSQL/Supabase یا bytes فضای R2 را خودکار به VPS منتقل نمی‌کند؛ رکوردها و فایل‌ها باید با برنامهٔ جدا، تطبیق checksum و آزمون پذیرش منتقل شوند.

## ۴. ساخت مدیر اولیه

پس از migration موفق، مدیر را با CLI تعاملی ایجاد کنید:

```sh
sudo -u kimia sh -c 'set -a; . /etc/kimia/kimia.env; set +a; cd /opt/kimia/current; node server/bootstrap-admin.js'
```

یک ایمیل مجاز وارد کنید و رمز حداقل 14 نویسه‌ای را دوبار در ورودی مخفی وارد کنید. رمز در CLI arguments یا پاسخ HTTP قرار نمی‌گیرد. اجرای مجدد برای تغییر رمز، sessionهای قبلی همان مدیر را باطل می‌کند. هیچ مدیر یا رمز پیش‌فرضی وجود ندارد.

## ۵. systemd و health check محلی

قبل از نصب سرویس، پورت 3018 را مجدداً بررسی کنید و فقط اگر خالی است ادامه دهید. سپس:

```sh
sudo cp /opt/kimia/current/deploy/systemd/kimia.service /etc/systemd/system/kimia.service
sudo systemctl daemon-reload
sudo systemctl enable --now kimia
sudo systemctl status kimia --no-pager
curl --fail --show-error http://127.0.0.1:3018/api/health
```

پاسخ آماده باید `ok:true`, `database_ready:true`, `booking_enabled:false`, `customer_auth_enabled:false` داشته باشد. خروجی دیگر یا HTTP غیر 200 یعنی برای Nginx/HTTPS آماده نیست. بررسی log:

```sh
sudo journalctl -u kimia -n 50 --no-pager
```

سرویس با کاربر غیر root `kimia`، bind فقط روی loopback، حافظهٔ محدود و دایرکتوری نوشتنی `/var/lib/kimia` اجرا می‌شود. proxy headers فقط وقتی socket peer خود loopback است مورد اعتمادند.

## ۶. Nginx اختصاصی و HTTPS

ابتدا فقط vhost موقت ACME را نصب کنید؛ فایل موجود برای هیچ سایت دیگری را بازنویسی نکنید:

```sh
sudo install -d -o root -g root -m 0755 /var/lib/letsencrypt/.well-known/acme-challenge
sudo cp /opt/kimia/current/deploy/nginx/kbkimiabeauty.ir-acme.conf /etc/nginx/sites-available/kbkimiabeauty.ir
sudo ln -s /etc/nginx/sites-available/kbkimiabeauty.ir /etc/nginx/sites-enabled/kbkimiabeauty.ir
sudo nginx -t
sudo systemctl reload nginx
```

اگر `nginx -t` ناموفق شد، توقف کنید و فقط علت مربوط به فایل جدید را بررسی کنید؛ فایل vhost یا سرویس دیگر را تغییر ندهید. Certbot را نصب کنید و challenge را فقط پس از تأیید DNS عمومی اجرا کنید:

```sh
sudo apt install -y certbot
sudo certbot certonly --webroot -w /var/lib/letsencrypt \
  --cert-name kbkimiabeauty.ir -d kbkimiabeauty.ir -d www.kbkimiabeauty.ir
```

پس از صدور موفق گواهی برای هر دو نام، vhost کامل را جایگزین کنید:

```sh
sudo cp /opt/kimia/current/deploy/nginx/kbkimiabeauty.ir.conf /etc/nginx/sites-available/kbkimiabeauty.ir
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --cert-name kbkimiabeauty.ir --dry-run
sudo systemctl list-timers --all | grep certbot
```

Nginx روی 80 به HTTPS دامنهٔ اصلی هدایت می‌کند، `www` را به apex می‌فرستد، درخواست‌ها را فقط به `127.0.0.1:3018` proxy می‌کند و upload را به 5 MiB محدود می‌کند. تنظیم `X-Forwarded-For` از خود Nginx بازنویسی می‌شود. PostgreSQL از proxy عبور نمی‌کند.
خروجی timer باید زمان اجرای بعدی Certbot را نشان دهد؛ اگر timer فعال وجود ندارد، ابتدا وجود unit را بررسی کنید و فقط در صورت نصب‌شدن آن `sudo systemctl enable --now certbot.timer` را اجرا کنید. تمدید خودکار را با dry-run و بررسی renewal log تأیید کنید.

### Hook تمدید گواهی

Certbot فقط پس از تمدید موفق deploy hookها را اجرا می‌کند. hook مخزن فقط lineage دقیق گواهی `kbkimiabeauty.ir` و وجود هر دو نام دامنه را می‌پذیرد؛ سپس به‌ترتیب `nginx -t` و reload انجام می‌دهد. آن را با دسترسی root نصب کنید:

```sh
sudo install -d -o root -g root -m 0755 /etc/letsencrypt/renewal-hooks/deploy
sudo install -o root -g root -m 0755 \
  /opt/kimia/current/deploy/certbot/50-kimia-nginx-reload.sh \
  /etc/letsencrypt/renewal-hooks/deploy/50-kimia-nginx-reload
sudo sh -n /etc/letsencrypt/renewal-hooks/deploy/50-kimia-nginx-reload
sudo certbot --version
sudo certbot renew --cert-name kbkimiabeauty.ir --dry-run
```

dry-run نباید گواهی یا پیکربندی سایت دیگری را تغییر دهد. برای اثبات نصب و شرایط hook، مسیر و مجوز را بررسی کنید و renewal log/system journal را ببینید:

```sh
sudo ls -l /etc/letsencrypt/renewal-hooks/deploy/50-kimia-nginx-reload
sudo journalctl -u certbot.service -n 100 --no-pager
```

نسخهٔ Certbot نصب‌شده روی VPS گزینهٔ `--run-deploy-hooks` را نمی‌پذیرد. dry-run بالا اعتبارسنجی و تمدید آزمایشی را بررسی می‌کند و اثبات اجرای deploy hook نیست. پس از موفقیت آن، hook نصب‌شده را جداگانه و با مشخصات گواهی واقعی کیمیا تست کنید:

```sh
sudo env RENEWED_LINEAGE=/etc/letsencrypt/live/kbkimiabeauty.ir \
  RENEWED_DOMAINS='kbkimiabeauty.ir www.kbkimiabeauty.ir' \
  /etc/letsencrypt/renewal-hooks/deploy/50-kimia-nginx-reload
```

این تست مستقل ابتدا `nginx -t` و سپس reload graceful انجام می‌دهد و گواهی را تعویض یا تمدید نمی‌کند؛ شاهد فراخوانی خودکار hook توسط Certbot نیست. در تمدید واقعی، Certbot فایل اجرایی نصب‌شده در renewal-hooks/deploy را فراخوانی می‌کند و خود hook گواهی‌های دیگر را نادیده می‌گیرد. در نسخه‌های جدیدتر، پس از تأیید وجود گزینه در help، می‌توان dry-run را همراه `--run-deploy-hooks` اجرا کرد. نیازی به ارتقای اجباری Certbot یا تغییر گواهی‌های سایر سایت‌ها نیست.

## ۷. پذیرش و محتوای واقعی

```sh
curl --fail --show-error https://kbkimiabeauty.ir/api/health
curl -I https://www.kbkimiabeauty.ir/
curl --fail --show-error https://kbkimiabeauty.ir/robots.txt
curl --fail --show-error https://kbkimiabeauty.ir/sitemap.xml
```

سپس در مرورگر وارد `/admin/login` شوید و این مسیر را با دادهٔ آزمایشی و بعد محتوای تأییدشدهٔ مالک اجرا کنید: افزودن خدمت، آپلود تصویر، ثبت مجوز انتشار، انتشار، مشاهده در سایت و صفحهٔ خدمت، ویرایش، مخفی‌کردن و تأیید 404/حذف از sitemap برای خدمت غیرفعال. کاربر غیرمدیر، request با هدر هویت Sites جعلی، و درخواست cross-site نباید مجوز بگیرند. در پنل نام، تلفن، نشانی، ساعات، لوگو، تصویر اصلی، متن و اطلاعات SEO/Google Search Console را اصلاح کنید. از تصاویر مفهومی به‌عنوان نمونه‌کار واقعی استفاده نکنید.

سامانهٔ Sites قدیمی را این راهنما تغییر نمی‌دهد. قبل از عمومی‌کردن نسخهٔ VPS، مالک باید دربارهٔ خاموش‌کردن نسخهٔ قبلی یا redirect/canonical آن تصمیم بگیرد تا محتوای تکراری نماند؛ هیچ تنظیم audience یا انتشار خودکار انجام نشود.

## ۸. بکاپ، بازیابی و به‌روزرسانی

برای backup روزانه/دوره‌ای از دیتابیس و تصاویر:

```sh
sudo sh /opt/kimia/current/deploy/backup.sh /var/backups/kimia
sudo sha256sum -c /var/backups/kimia/kimia-<UTC_TIMESTAMP>.sha256
```

اسکریپت dump سفارشی PostgreSQL، tar تصاویر و manifest checksum می‌سازد و فایل‌ها را با mode محدود نگه می‌دارد. مسیر بکاپ را روی فضای امن و جداگانه با رمزگذاری و retention مناسب منتقل کنید. اجرای backup به‌تنهایی اثبات بازیابی‌پذیری نیست؛ restore دوره‌ای روی دیتابیس و مسیر تصویر جدید را آزمایش کنید.

بازیابی دیتابیس فقط به نام تازهٔ `kimia_restore_*` انجام می‌شود و دیتابیس فعال را حذف نمی‌کند:

```sh
sudo sh /opt/kimia/current/deploy/restore-db-to-new.sh kimia_restore_20260101 /path/to/verified.dump
```

برای تصاویر نیز ابتدا archive و manifest را تأیید و محتویات را پیش از extract بررسی کنید:

```sh
sudo sha256sum -c /var/backups/kimia/kimia-<UTC_TIMESTAMP>.sha256
sudo tar -tzf /var/backups/kimia/kimia-images-<UTC_TIMESTAMP>.tar.gz
sudo install -d -o kimia -g kimia -m 0750 /var/lib/kimia/uploads.restore
sudo tar --extract --gzip --file=/var/backups/kimia/kimia-images-<UTC_TIMESTAMP>.tar.gz \
  --directory=/var/lib/kimia/uploads.restore
sudo chown -R kimia:kimia /var/lib/kimia/uploads.restore
```

آرشیو را فقط اگر فهرستش شامل نام‌های UUID تصویری مورد انتظار است استخراج کنید؛ ابتدا به مسیر staging جدید extract کنید، نه روی upload directory فعال. پس از تطبیق DB و فایل‌ها، در پنجرهٔ نگهداری مسیر `UPLOAD_DIR` را به مقصد staging تغییر دهید و سرویس را restart کنید.

پیش از جابه‌جایی برنامه، نسخهٔ فعلی را نگه دارید:

```sh
readlink -f /opt/kimia/current
sudo systemctl stop kimia
```

release جدید را در دایرکتوری جدید clone کنید، به‌ترتیب `npm ci`, `npm run build`, `npm test`, `npm run lint` را اجرا کنید، مالکیت/مجوزهای release را تنظیم کنید و سپس `ln -sfnT` را برای جابه‌جایی `current` اجرا کنید. ساخت باید پیش از تست انجام شود، چون تست‌ها فایل تولیدشدهٔ `dist/server/index.js` را وارد می‌کنند. migrationهای افزایشی را فقط بعد از backup و بررسی compatibility اجرا کنید؛ migration برگشت‌زننده یا حذف داده وجود ندارد. بعد از هر تغییر:

```sh
sudo systemctl start kimia
sudo systemctl status kimia --no-pager
curl --fail --show-error http://127.0.0.1:3018/api/health
```

برای rollback کد، symlink را به release قبلی برگردانید و سرویس را restart کنید. schema را خودکار rollback نکنید؛ اگر migration جدید ناسازگار بود، سرویس را متوقف نگه دارید و از دیتابیس backupشده به یک دیتابیس تازه restore کنید، سپس پس از بررسی مالکیت/مجوز، DSN را با برنامهٔ تأییدشده تغییر دهید. فایل‌های تصویر و DB را با هم و از یک نقطهٔ زمانی بازیابی کنید.

## مواردی که فقط روی محیط واقعی قابل تأییدند

نسخه/مجوز واقعی PostgreSQL 18، roleها و `pg_hba.conf`، فضای آزاد پورت‌ها، DNS عمومی، دسترسی firewall، صدور/تمدید Certbot، backup خارج‌سرور، انتقال محتوای Supabase و فایل‌های R2، ورود مدیر و آزمون مرورگر روی دامنه باید توسط مالک روی VPS بررسی شوند. موفقیت تست‌های محلی/PGlite یا این راهنما هیچ‌یک از آن‌ها را تأیید نمی‌کند.
