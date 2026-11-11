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

## موارد اجرا‌نشده

نصب روی VPS، ثبت کلیدها و Secrets، فعال‌سازی Variable، اجرای واقعی workflow و پذیرش انتشار همچنان وابسته به خروجی مالک‌اند. موفقیت local به معنی موفقیت انتشار تولید نیست. این تغییر طرح ظاهری جدید را مستقلاً روی VPS فعال نکرده است.

محدودیت‌ها: بکاپ DB و تصاویر snapshot یکپارچهٔ مشترک ندارند؛ retention، نسخهٔ خارج سرور و تمرین restore هنوز لازم‌اند. schema migration عمداً خودکار نیست. اتصال clone به GitHub فرض می‌کند repository عمومی باقی می‌ماند.
