<p align="center">
  <img src="bin/assets/rasta-mark.svg" width="72" height="72" alt="Rasta">
</p>

<h1 align="center">Rasta — RTL Support for Codex &amp; T3 Code</h1>

<p align="center">Read Persian, Arabic and mixed right-to-left (RTL) text in Codex and T3 Code on macOS.</p>

<p align="center">
  <a href="https://github.com/amirmahdinezhad/rasta/releases/tag/v1.0.2"><img src="https://img.shields.io/badge/release-v1.0.2-ad8cf3" alt="Rasta 1.0.2 stable release"></a>
  <a href="https://github.com/amirmahdinezhad/rasta/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/amirmahdinezhad/rasta/ci.yml?branch=main&amp;label=tests" alt="Installer tests"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/amirmahdinezhad/rasta?color=79adeb" alt="MIT license"></a>
</p>

<p align="center">
  <a href="#english-documentation">English</a> ·
  <a href="#persian-documentation">Persian</a> ·
  <a href="#download">Download</a>
</p>

---

<a id="english-documentation"></a>

## English documentation

Rasta adds right-to-left (RTL) support for Persian, Arabic and mixed-language conversations in Codex and T3 Code on macOS, with a floating settings panel inside your coding app. Adjust Persian and English text direction, fonts and appearance while keeping each app’s settings and backups separate.

The project folder is `Rasta` and the CLI command is `rasta`.

### Features

- **Text direction** — automatic RTL, Force RTL and Default / RTL / LTR controls for individual assistant replies.
- **Typography** — bundled Vazir, custom TTF/OTF fonts, text size and line spacing.
- **Appearance** — light, dark and automatic themes; Lavender, Blue, Mint and Yellow accents shared with Setup.
- **Typing** — an optional `Shift+2` fix for entering `@`.
- **Updates & removal** — installed version, update summaries and an in-panel removal flow that reopens the same app.

<a id="download"></a>

### Download & install

**Requirements:** macOS 13.5 or later on Apple Silicon. The packaged installers do not require Node.js or a GitHub account.

| App | Tested app version | Installer |
| :--- | :---: | :--- |
| Codex | `26.1023.51421` | [Download Codex Setup](https://github.com/amirmahdinezhad/rasta/releases/download/v1.0.2/Rasta-1.0.2-darwin-arm64.zip) |
| T3 Code (Beta) | `0.1.4` | [Download T3 Setup](https://github.com/amirmahdinezhad/rasta/releases/download/v1.0.3/Rasta-T3-1.0.3-darwin-arm64.zip) |

1. Download and extract the ZIP for your app.
2. Open the Setup app for Codex or T3 Code, and choose **Install / Update Rasta**.
3. When preparation finishes, click **Launch**. Your app restarts with the RTL panel.

Open **Rasta Setup.app** for Codex or **Rasta T3 Setup.app** for T3 Code. The Codex installer is Rasta 1.0.2; the T3 installer is Rasta 1.0.3 for T3 Code 0.1.4.

### Update or remove

Use **Check for updates** in the panel to review an available release, then choose **Download update**. To uninstall, choose **Remove Rasta** and confirm; the original same-version app is restored and reopened.

An amber dot on the Rasta panel button indicates an available Rasta release, even while the panel is closed. Updates are checked at startup and every four hours. Opening the panel keeps the dot visible until installation begins or a successful check confirms that no update remains.

---

<a id="persian-documentation"></a>

<div dir="rtl" lang="fa">

## راهنمای فارسی

با Rasta می‌توانید جهت متن، فونت و ظاهر را از پنلی شناور داخل Codex و T3 Code تنظیم کنید. تنظیمات و نسخهٔ پشتیبان هر برنامه جدا نگه داشته می‌شوند.

### قابلیت‌ها

- **جهت متن** — تشخیص خودکار فارسی و انگلیسی، حالت اجباری RTL و انتخاب جهت هر پاسخ دستیار.
- **خوانایی** — فونت وزیر، افزودن فونت TTF/OTF، اندازهٔ متن و فاصلهٔ خطوط.
- **ظاهر** — تم روشن، تیره و خودکار؛ چهار رنگ یاسی، آبی، نعنایی و زرد، هماهنگ با نصب‌کننده.
- **تایپ** — اصلاح اختیاری ورود علامت `@` با کلیدهای `Shift+2`.
- **مدیریت RTL** — نمایش نسخه، خلاصهٔ تغییرات به‌روزرسانی و حذف از داخل پنل.

### دانلود و نصب

**پیش‌نیاز:** مک Apple Silicon با macOS 13.5 یا جدیدتر. برای نصب بستهٔ آماده به Node.js یا حساب GitHub نیاز ندارید.

- **نسخهٔ Codex:** [دانلود نصب‌کننده](https://github.com/amirmahdinezhad/rasta/releases/download/v1.0.2/Rasta-1.0.2-darwin-arm64.zip)
- **نسخهٔ T3 Code:** [دانلود نصب‌کننده](https://github.com/amirmahdinezhad/rasta/releases/download/v1.0.3/Rasta-T3-1.0.3-darwin-arm64.zip)

1. فایل ZIP مخصوص برنامهٔ خود را دانلود و باز کنید.
2. نصب‌کنندهٔ همان برنامه را اجرا و **Install / Update Rasta** را انتخاب کنید.
3. پس از آماده‌شدن، **Launch** را بزنید؛ برنامه دوباره باز می‌شود و پنل در دسترس قرار می‌گیرد.

### به‌روزرسانی و حذف

با **Check for updates** نسخهٔ تازه و خلاصهٔ تغییرات را ببینید؛ دانلود با انتخاب جداگانهٔ **Download update** شروع می‌شود.

برای حذف، **Remove Rasta** را انتخاب و تأیید کنید. نسخهٔ اصلی همان برنامه بازگردانده و دوباره باز می‌شود.

</div>
