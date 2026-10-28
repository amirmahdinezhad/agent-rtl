# ساخت، تست و انتشار

برای توسعه: Node.js مطابق `package.json`؛ برای Setup: macOS، Xcode Command Line Tools و runtime مستقل Node به‌همراه مجوز آن. مسیر runtime را با `ARTL_PORTABLE_NODE` و در صورت نیاز `ARTL_NODE_LICENSE` تعیین کنید؛ در صورت وجود، Node همراه Codex خودکار پیدا می‌شود.

```sh
npm ci
npm run build:userscript
npm test
npm run test:gui
ARTL_LOCAL_CANDIDATE=1 npm run build:gui
npm run test:installer
npm run test:events
```

برای T3، ساخت و تست نصب/رویداد با `ARTL_TARGET=t3` و `ARTL_GUI_OUTPUT` برابر مسیر مطلق `dist/Agent RTL T3 Setup.app` انجام شود؛ تست GUI/font با `ARTL_TEST_TARGET=t3` اجرا شود. خروجی پیش‌فرض Codex، `dist/Agent RTL Setup.app` است. candidate محلی با `ARTL_LOCAL_CANDIDATE=1` فید دریافت ندارد تا دقیقاً runtime داخل بسته تست شود.

تست‌های مرورگر به `ARTL_PLAYWRIGHT_MODULE` (مسیر مطلق `playwright/index.mjs`) و در صورت نیاز `ARTL_CHROMIUM_EXECUTABLE` نیاز دارند. `test:codex-content` و `test:design` را با `ARTL_USE_CODEX_CSS=1` و fixture DOM متناسب با نسخهٔ هدف اجرا کنید. `test:t3-design`، CSS اپ نصب‌شده و payload سورس فعلی را می‌خواند؛ `ARTL_T3_ASAR` مسیر آرشیو مستقل را تعیین می‌کند. `test:codex-native` فقط کپی staging آماده‌شده را اجرا می‌کند و به manifest آن نیاز دارد.

`npm run clean` خروجی‌های قابل بازسازی `dist/` و helper کامپایل‌شده را حذف می‌کند؛ سورس، وابستگی‌ها و state اپ‌ها حفظ می‌شوند. ابتدا شواهد candidate مورد نیاز را بیرون `dist/` نگه دارید.

## نصب و سازگاری

[فلو آپدیت اپ‌ها](app-update-workflow.md) مرجع تشخیص و پذیرش است. main/preload اصلی حفظ می‌شوند؛ staging، خروج کامل پس از Launch کاربر، جایگزینی تراکنشی، امضا/integrity و rollback الزامی‌اند. launchd فقط بررسی محدود هنگام تغییر فایل‌ها/ورود انجام می‌دهد؛ پردازش دائمی ندارد. حذف RTL ثبت رویداد را هم پاک می‌کند.

فهرست نسخه‌های بررسی‌شده و کلید عمومی در `bin/release-config.json` است؛ `feedUrl` مربوط به Codex و `t3FeedUrl` مربوط به T3 است. بسته و manifest دو اپ مستقل‌اند؛ T3 از فید رسمی Codex استفاده نمی‌کند. دانلود فقط از میزبان مجاز و پس از بررسی امضای Ed25519، اندازه و SHA-256 پذیرفته می‌شود.

## انتشار

۱. پذیرش دستی و دستور صریح انتشار کاربر را ثبت کنید؛ کلید خصوصی بیرون مخزن بماند.
۲. نسخه، lockfile، فهرست سازگاری، فید، لینک‌ها و userscript را هماهنگ کنید؛ commit/push و CI همان commit باید قبول باشند. `npm pack --dry-run` محتوای پکیج را نشان می‌دهد.
۳. Setup مستقل هر اپ را بدون `ARTL_LOCAL_CANDIDATE` بسازید؛ امضا، نسخه و تطبیق runtime با سورس را بررسی و ZIP کنید.
۴. با `npm run release:manifest -- --artifact <zip> --repo <owner/repo> --platform darwin-arm64 --tag <tag> --output <json>`، متغیرهای `ARTL_RELEASE_PRIVATE_KEY_FILE` و `ARTL_RELEASE_PUBLIC_KEY` manifest را امضا کنید. برای T3، `--target t3` و نام `agent-rtl-t3-release.json`؛ برای Codex، `agent-rtl-release.json` استفاده شود.
۵. هر دو ZIP/manifest را با commit دقیق و `gh release create ... --prerelease --latest=false --notes-file docs/release-notes.md` منتشر کنید؛ کانال آزمایشی latest نیست. انتشار تولیدِ notarized با اجرای دستی workflow امضا/notarization با Developer ID و secrets اپل می‌گذرد؛ در وضعیت فعلی workflow تولید فقط Codex را می‌سازد.
۶. فایل‌های منتشرشده را دوباره دانلود و امضا/هش/نسخه/target را بررسی کنید. سپس pinهای `install.sh` و fixture امضاشدهٔ `test/fixtures/installer-release.json` را به‌روز و تست کنید. [نصب و Launch واقعی GitHub](installation.md#تست-بستهٔ-github) جدا ثبت شود.

خلاصهٔ درون‌اپی: `--notes <json>` آرایه‌ای از حداکثر سه رشتهٔ ۱۲۰ کاراکتری و بدون خط جدید می‌پذیرد؛ نمایش پیش از دانلود است و دانلود با کلیک جدا شروع می‌شود. manifest قدیمی بدون خلاصه همچنان پشتیبانی می‌شود.

شماره‌گذاری این مخزن از `1.0.0` شروع شده است. انتشار اولیه با tag `v1.0.0` و `--latest` انجام شد؛ انتشارهای آزمایشی بعدی با `--prerelease --latest=false` منتشر می‌شوند؛ بسته‌ها امضای محلی و بدون notarization هستند. کاربران نسخه‌های شماره‌گذاری قبلی باید Setup جدید را دستی دریافت کنند؛ مقایسهٔ نسخهٔ updater، کاهش شمارهٔ نسخه را آپدیت تلقی نمی‌کند.
