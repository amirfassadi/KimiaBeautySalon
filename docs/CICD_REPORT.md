# گزارش آماده‌سازی CI/CD — 2026-11-12

## تغییرات

- GitHub Actions برای push/PR روی main و اجرای دستی: Node 22، npm ci/build/test/lint، تست فرمان انتشار و rollback، integration با PostgreSQL 18 موقت و نقش غیر-superuser.
- job انتشار فقط main و فقط با Variable صریح فعال می‌شود؛ کلید محدود SSH، بررسی اجباری کلید میزبان و محیط production دارد.
- روی VPS: build/test با کاربر kimia-deploy، helperهای root-owned ثابت، قفل انتشار، بررسی SHA اصلی، snapshot release، بکاپ DB+تصاویر، تغییر اتمیک symlink و health محلی/عمومی با rollback.
- migration، env، مدیر، Nginx و گواهی تغییری نمی‌کنند. SSH فقط یک Match محدود برای کاربر انتشار دریافت می‌کند.
- اسکریپت نصب و دستورهای کامل در CICD.md آمده است. helperهای root از مخزن خودکار به‌روزرسانی نمی‌شوند.

## نتیجهٔ تست محلی

محیط: Windows، Node v24.20.0، npm 11.19.0، Git Bash. CI برای Ubuntu و Node 22 تنظیم شده است.

| بررسی | نتیجه |
| --- | --- |
| npm run build | موفق |
| npm test | موفق؛ تمام آزمون‌های موجود، شامل PGlite |
| npm run lint | موفق |
| git diff --check | موفق |
| bash -n همهٔ اسکریپت‌های جدید | موفق |
| actionlint روی workflow | موفق؛ بدون خطا |
| scripts/test-deploy.sh | موفق؛ رد SHA/فرمان نامعتبر، health JSON، فعال‌سازی و rollback در شکست restart، health محلی و health عمومی |

تست rollback از filesystem/service doubles در پوشهٔ موقت استفاده می‌کند؛ روی systemd، /opt، SSH یا دیتابیس واقعی تغییری نمی‌دهد. اجرای PostgreSQL واقعی برای این تغییر CI محلی تکرار نشد؛ integration واقعی در workflow پیکربندی شده و نتیجه‌اش فقط پس از اجرای Actions قابل تأیید است. تست‌های واقعی PostgreSQL بازبینی طراحی قبلی در UI_REFRESH_REPORT.md ثبت شده‌اند.

## سابقهٔ بررسی و وضعیت اولیه

خروجی بعدی مالک نصب helper و کلید اختصاصی روی VPS و انتشار دستی موفق 4a39f9d را تأیید کرد: build/test/lint موفق، بکاپ در `/var/backups/kimia/deploy-20261111T203924Z-4a39f9d9e5463a93163c32791baa73d5fae01f65`، نسخهٔ قبلی 8089bc1، سرویس running و health محلی/HTTPS آماده با booking/customer auth غیرفعال. اولین تلاش health هنگام restart به connection refused رسید و retry بعدی موفق شد؛ rollback رخ نداد. زمان نام بکاپ UTC و مستقل از تاریخ محلی کاربر است.

بررسی مستقیم GitHub در 2026-11-12: [اجرای 43169915617](https://github.com/amirfassadi/KimiaBeautySalon/actions/runs/43169915617) برای push روی main در SHA `b1605144e0837dfed67f3a9c656b0146d7f1deac` موفق است. job تست شامل npm ci/build/test/lint، آزمون انتشار/rollback و integration واقعی PostgreSQL 18 همگی موفق‌اند. job انتشار `skipped` است؛ بنابراین موفقیت کل workflow به معنی انتشار موفق نیست. اجرای قدیمی 43096806518 برای 4a39f9d در زمان بررسی همچنان queued بود.

شرط branch و event برای اجرای جدید برقرار است؛ در نتیجه شرط `vars.KIMIA_DEPLOY_ENABLED == 'true'` در ارزیابی job برقرار نبوده است. مقدار تنظیمات و وجود Secrets از API عمومی قابل تأیید نیست و ابزار GitHub متصل امکان مدیریت Secrets/Variables ندارد. ثبت/بررسی دو Secret، فعال‌سازی Variable، تست SSH محدود، اجرای موفق job انتشار و پذیرش مرورگری همچنان باقی‌اند؛ مراحل در CICD.md آمده‌اند.

در همین بررسی، build/test/lint روی نسخهٔ محلی دارای تغییرات منتشرنشده نیز موفق بود؛ تست SEO هم اجرا شد. آزمون `scripts/test-deploy.sh` با Git Bash موفق بود. این نتیجهٔ محلی به معنی انتشار تغییرات محلی یا اجرای آن‌ها در GitHub نیست؛ main راه دور یک commit جلوتر از HEAD محلی است و به‌دلیل تغییرات موجود، merge یا انتشار خودکار انجام نشد.

## تأیید انتشار خودکار و به‌روزرسانی Actionها — 2026-11-12

- اجرای 43175763350 برای b160514: تست و SSH و health موفق؛ نسخه از قبل فعال بود و انتشار مجدد انجام نشد. پس از اصلاح انتقال کلید خصوصی به Secret، خطای libcrypto رفع شد.
- در commit `abb67cce71b4bc4249235dd08b0bac1d49149575` فقط دو مرجع Action در workflow تغییر کردند: checkout به v7.0.1 و setup-node به v7.1.0، هر دو با SHA کامل و runtime داخلی Node 24. Node برنامه در CI همان 22 است. تغییرات ESM و احراز هویت/کش در راهنماهای رسمی با ورودی‌های فعلی بررسی شدند؛ runner مشاهده‌شده 2.338.2 از حداقل 2.327.1 جدیدتر است.
- بررسی در worktree جدا بر پایهٔ main راه دور انجام شد تا تغییرات منتشرنشدهٔ SEO/رابط وارد انتشار نشوند. npm ci/build/test/lint، actionlint 1.7.12 و آزمون فرمان‌ها/rollback محلی موفق‌اند.
- [اجرای 43176250378](https://github.com/amirfassadi/KimiaBeautySalon/actions/runs/43176250378): job تست، شامل integration واقعی PostgreSQL 18، موفق است و هشدار Node 20 در لاگ آن وجود ندارد. لاگ job انتشار اجرای موفق build/test/lint روی VPS، بکاپ در `/var/backups/kimia/deploy-20261112T073612Z-abb67cce71b4bc4249235dd08b0bac1d49149575`، نسخهٔ قبلی b160514، فعال‌سازی abb67cc و `Public HTTPS health passed` را تأیید می‌کند. نخستین health بلافاصله پس از restart اتصال نگرفت؛ retry موفق شد و rollback رخ نداد.
- انتشار یک نسخهٔ تازه از طریق GitHub Actions اکنون تأیید شده است؛ پذیرش مرورگری پنل و محتوا و تمرین restore همچنان جداگانه باقی‌اند. مستندات این گزارش به‌صورت محلی به‌روز شدند؛ commit منتشرشده فقط workflow را تغییر داد.

محدودیت‌ها: بکاپ DB و تصاویر snapshot یکپارچهٔ مشترک ندارند؛ retention، نسخهٔ خارج سرور و تمرین restore هنوز لازم‌اند. schema migration عمداً خودکار نیست. اتصال clone به GitHub فرض می‌کند repository عمومی باقی می‌ماند.
