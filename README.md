<h1 align="center" dir="ltr">Agent RTL</h1>

<p align="center" dir="rtl">
پنل فارسی راست‌به‌چپ برای Codex و T3 Code
<br>
فونت دلخواه، نمایش خوانا و جهت مستقل پاسخ‌ها
</p>

<div dir="rtl">

## دریافت نسخهٔ ۱٫۰٫۰

برای **مک‌های Apple Silicon** با **macOS 13.5 یا جدیدتر**. نصب به Node.js یا حساب GitHub نیاز ندارد.

| برنامه | نسخهٔ بررسی‌شده | دانلود |
| :--- | :---: | :---: |
| [Codex](docs/codex.md) | `26.1023.50603` | [دریافت Setup](https://github.com/amirmahdinezhad/agent-rtl/releases/download/v1.0.0/Agent-RTL-1.0.0-darwin-arm64.zip) |
| [T3 Code (Beta)](docs/t3.md) | `0.1.3` | [دریافت Setup](https://github.com/amirmahdinezhad/agent-rtl/releases/download/v1.0.0/Agent-RTL-T3-1.0.0-darwin-arm64.zip) |

## نصب در سه مرحله

1. فایل ZIP مخصوص برنامهٔ خود را دانلود و باز کنید.
2. برنامهٔ **Setup** داخل آن را اجرا و **Install / Update RTL** را انتخاب کنید.
3. پس از آماده‌شدن، **Launch** را بزنید؛ برنامه دوباره باز می‌شود و پنل در دسترس قرار می‌گیرد.

> بسته‌ها امضای محلی دارند و تأیید اپل ندارند. اگر macOS مانع اجرا شد، [راهنمای رفع مشکل نصب](docs/installation.md#رفع-مشکل) را ببینید.

## امکانات پنل

- **جهت متن:** نمایش خودکار فارسی و انگلیسی، حالت اجباری RTL و جهت جداگانه برای هر پاسخ.
- **خوانایی:** افزودن فونت، تنظیم اندازهٔ متن و فاصلهٔ خطوط.
- **ظاهر:** تم روشن و تیره، چهار رنگ و Lavender به‌عنوان رنگ پیش‌فرض.
- **تایپ:** اصلاح ورود علامت `@` با کلیدهای `Shift+2`.

تنظیمات و نسخهٔ پشتیبان Codex و T3 جدا نگه داشته می‌شوند.

## حذف RTL

از داخل پنل، **Remove RTL** را انتخاب و تأیید کنید. همان برنامه بدون پچ دوباره باز می‌شود؛ اطلاعات برنامه و فایل‌های Downloads حفظ می‌شوند.

## راهنما و توسعه

[نصب و رفع مشکل](docs/installation.md) · [تغییرات نسخه](docs/release-notes.md) · [گزارش مشکل](https://github.com/amirmahdinezhad/agent-rtl/issues)

[مشارکت در پروژه](CONTRIBUTING.md) · [ساخت و انتشار](docs/updates.md) · [بررسی آپدیت اپ‌ها](docs/app-update-workflow.md)

برای شروع توسعه، وابستگی‌ها را نصب و تست‌ها را اجرا کنید. ساخت Setup به macOS و ابزارهای خط فرمان Xcode نیاز دارد.

</div>

```sh
npm ci
npm test
```

<div dir="rtl">

مجوز کد: [MIT](LICENSE) · مجوز فونت همراه: [OFL](bin/assets/Vazir-OFL.txt)

</div>
