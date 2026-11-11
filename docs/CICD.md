# انتشار خودکار کیمیا روی VPS

مقصد فقط `kbkimiabeauty.ir` روی `87.107.54.244` است. Workflow پس از push به main یا اجرای دستی روی main، نصب تمیز، build، تست‌های برنامه، lint، آزمون rollback و integration با PostgreSQL 18 موقت را اجرا می‌کند. فقط پس از موفقیت همهٔ آن‌ها، همان SHA از طریق SSH محدود به VPS فرستاده می‌شود.

انتشار تا زمانی که متغیر `KIMIA_DEPLOY_ENABLED=true` ثبت نشده، غیرفعال است؛ تست‌ها از همین حالا اجرا می‌شوند. هیچ رمز دیتابیس یا مدیر وارد GitHub نمی‌شود. فقط کلید اختصاصی انتشار و کلید عمومی میزبان در Secrets نگهداری می‌شوند.

## ۱. نصب اولیه و انتشار فعلی — داخل SSH سرور با کاربر amir

پیش‌نیازها همین نصب فعلی هستند: سرویس سالم `kimia` روی 3018، env موجود، PostgreSQL، HTTPS و symlink معتبر `/opt/kimia/current`. این دستورها تنظیم Nginx، گواهی، env و migrationها را تغییر نمی‌دهند. برای SSH فقط یک تنظیم Match مخصوص `kimia-deploy` اضافه می‌شود؛ `sshd -t` پیش از reload اجرا می‌شود.

```sh
cd "$HOME/kimia-edb12bc"
git status --short
```

اگر تغییر محلی دارد، ادامه ندهید و خروجی را برای بررسی بفرستید. در صورت تمیزبودن:

```sh
git fetch origin
git checkout --detach origin/main
npm ci && npm run build && npm test && npm run lint
bash scripts/test-deploy.sh
```

کلید مخصوص همین انتشار بسازید؛ کلید موجود را بازنویسی نکنید:

```sh
install -d -m 0700 "$HOME/.ssh"
test ! -e "$HOME/.ssh/kimia-actions" && ssh-keygen -t ed25519 -N '' -C kimia-github-actions -f "$HOME/.ssh/kimia-actions"
sudo bash deploy/ci/install.sh "$HOME/.ssh/kimia-actions.pub"
```

نصب‌کننده یک کاربر مجزا بدون دسترسی به env برنامه ایجاد می‌کند. کلید فقط فرمان `deploy <SHA>` را می‌پذیرد؛ shell تعاملی، forwarding و اجرای sudo عمومی ندارد. helperهای حساس با مالکیت root خارج از مخزن نصب می‌شوند. تغییر helperهای انتشار در آینده به نصب دستی دوباره نیاز دارد؛ پوش کد نمی‌تواند آن‌ها را به‌عنوان root تغییر دهد.

اولین انتشار نسخهٔ جدید را همین حالا انجام دهید:

```sh
revision=$(git rev-parse HEAD)
sudo /usr/local/sbin/kimia-deploy "$revision"
sudo systemctl status kimia --no-pager -l
curl --fail --show-error https://kbkimiabeauty.ir/api/health
```

helper در کاربر جدا clone/build/test می‌کند، snapshot فقط‌خواندنی release می‌سازد، از دیتابیس و تصاویر در `/var/backups/kimia/deploy-*` بکاپ و checksum می‌گیرد، سپس symlink را اتمیک عوض می‌کند و فقط `kimia` را restart می‌کند. سلامت محلی و HTTPS باید دقیقاً وضعیت آماده و دو قابلیت غیرفعال را نشان دهد. شکست restart یا health باعث برگشت symlink و restart نسخهٔ قبلی می‌شود. شکست بکاپ مانع فعال‌سازی است. داده‌های مدیر، تصاویر ثبت‌شده و env حفظ می‌شوند.

## ۲. اتصال GitHub — فقط در تنظیمات خود GitHub

در مخزن `amirfassadi/KimiaBeautySalon`، مسیر Settings → Secrets and variables → Actions، دو **Repository secret** بسازید:

| نام | مقدار |
| --- | --- |
| `KIMIA_SSH_KEY` | تمام محتوای فایل خصوصی `~/.ssh/kimia-actions`، شامل BEGIN و END |
| `KIMIA_SSH_KNOWN_HOSTS` | یک خط کلید میزبان از دستور بعدی |

برای نمایش کلید خصوصی فقط در ترمینال خودتان:

```sh
cat "$HOME/.ssh/kimia-actions"
```

**کلید خصوصی را در چت، گزارش، فایل مخزن یا issue نفرستید.** آن را مستقیم در Secret گیت‌هاب قرار دهید. رمز مدیر و دیتابیس همچنان فقط روی VPS می‌مانند.

خط known_hosts را از فایل معتبر خود سرور بگیرید؛ بررسی کلید میزبان خاموش نمی‌شود:

```sh
sudo awk '{print "[87.107.54.244]:22022 " $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub
```

سپس در تب **Variables** یک Repository variable بسازید:

```text
KIMIA_DEPLOY_ENABLED = true
```

در Settings → Environments، محیط `production` را ایجاد کنید و Deployment branches را فقط `main` قرار دهید. برای انتشار خودکار بدون توقف، reviewer اجباری تعیین نکنید. در Actions، workflow **Test and deploy Kimia** را روی branch main با **Run workflow** اجرا کنید. پس از آن هر push به main خودکار تست و منتشر می‌شود. PRها فقط تست دارند و به کلید انتشار دسترسی نمی‌گیرند.

اگر repository خصوصی شد، clone عمومی VPS دیگر کار نمی‌کند؛ قبل از آن دسترسی read-only جدا برای مخزن تنظیم کنید. کلید انتشار VPS برای خواندن GitHub نیست.

## کنترل انتشار و برگشت

- برای توقف انتشار خودکار، Variable را `false` کنید؛ تست‌ها ادامه دارند.
- انتشارها هم در GitHub و هم با flock روی VPS سری می‌شوند؛ SHA که دیگر head اصلی نیست رد می‌شود.
- migration به‌صورت خودکار اجرا نمی‌شود؛ تغییر schema نیازمند انتشار جدا و برنامهٔ سازگاری/بکاپ است.
- بکاپ DB و تصاویر در زمان فعال‌بودن سایت گرفته می‌شود؛ snapshot تراکنشی یکپارچهٔ DB+فایل نیست. برای بازیابی کامل، هنوز تمرین restore و سیاست نگهداری/نسخهٔ خارج VPS لازم است.
- releaseها و بکاپ‌ها خودکار حذف نمی‌شوند. فضای دیسک را بررسی و نگهداری نسخه‌ها را برنامه‌ریزی کنید.
- اجرای دوبارهٔ SHA فعال و سالم موفق می‌شود و انتشار تکراری ندارد. retry نسخهٔ ساخته‌شده‌ای که فعال نیست متوقف می‌شود؛ ابتدا وضعیت سرویس و علت شکست قبلی را بررسی کنید.
- برای rollback دستی، مسیر `Previous release` در log را به‌عنوان مقصد symlink انتخاب کنید و سرویس `kimia` را restart کنید؛ دیتابیس را برای rollback رابط کاربری restore نکنید.

معیار پذیرش: اجرای سبز Actions، سرویس running، HTTPS health آماده، نمایش طرح جدید در موبایل/دسکتاپ و ورود مدیر همراه با ماندگاری محتوای موجود. موفقیت محلی جای اجرای واقعی روی VPS را نمی‌گیرد.

## مرجع

Actionها با SHA کامل ثابت شده‌اند و کلید انتشار فقط در job اصلی استفاده می‌شود؛ مبنا: [راهنمای امنیت GitHub Actions](https://docs.github.com/en/actions/reference/security/secure-use).
