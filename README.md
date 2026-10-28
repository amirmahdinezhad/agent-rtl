# Agent RTL

پنل راست‌به‌چپ فارسی با فونت، اندازهٔ متن، تم، رنگ و جهت مستقل پاسخ‌ها.

نسخهٔ **۱٫۰٫۰** برای macOS 13.5+ و مک‌های Apple Silicon:

| اپ | نسخهٔ بررسی‌شده | دانلود | راهنما |
| --- | --- | --- | --- |
| Codex | `26.1023.50603` | [Setup Codex](https://github.com/amirmahdinezhad/agent-rtl/releases/download/v1.0.0/Agent-RTL-1.0.0-darwin-arm64.zip) | [Codex](docs/codex.md) |
| T3 Code (Beta) | `0.1.3` | [Setup T3](https://github.com/amirmahdinezhad/agent-rtl/releases/download/v1.0.0/Agent-RTL-T3-1.0.0-darwin-arm64.zip) | [T3](docs/t3.md) |

ZIP مربوط به اپ را باز کنید، Setup را اجرا و پس از آماده‌سازی **Launch** را بزنید. Node.js یا ورود به GitHub لازم نیست. بسته‌ها امضای محلی دارند و تأیید اپل ندارند؛ [رفع مسدودشدن نصب](docs/installation.md).

فونت، تم، چهار accent با Lavender پیش‌فرض، تاگل‌های سفید و حذف با تأیید داخل پنل در هر دو اپ مشترک‌اند. تنظیمات و backup هر اپ جداست. **Remove RTL** همان اپ را بدون پچ دوباره باز می‌کند؛ فایل‌های Downloads باقی می‌مانند.

[تغییرات نسخه](docs/release-notes.md) · [توسعه و انتشار](docs/updates.md) · [فلو آپدیت T3 و Codex](docs/app-update-workflow.md)

توسعه: `npm ci`، سپس `npm test`. ساخت Setup به macOS و Xcode نیاز دارد؛ [مشارکت و ساختار پروژه](CONTRIBUTING.md). مجوز کد [MIT](LICENSE) و مجوز فونت همراه [OFL](bin/assets/Vazir-OFL.txt) است. گزارش مشکل: [Issues](https://github.com/amirmahdinezhad/agent-rtl/issues).
