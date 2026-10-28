# فلو آپدیت T3 Code

با «نسخه جدید T3 اومده» یا «بررسی سازگاری T3 رو اجرا کن» شروع کن. درخواست بدون نام اپ از [انتخاب اپ](app-update-workflow.md) می‌گذرد.

۱. `AGENTS.md`، [راهنمای T3](t3.md)، [انتشار](updates.md)، گزارش قبلی و تنظیمات را بخوان؛ تغییرات موجود را حفظ و در شاخهٔ `codex/` کار کن. مسیر، هویت، نسخه/build واقعی bundle/ASAR، Agent RTL، macOS و معماری را ثبت کن؛ نسخهٔ CLI یا Codex مبنا نیست.
۲. نسخه و دریافت رسمی T3 را با شرایط دستگاه تطبیق بده. حذف پچ، تغییر ساختار، محدودیت سازگاری و خطای دریافت را جدا تشخیص بده؛ فید Codex متعلق به T3 نیست. نسخهٔ بررسی‌نشده را سازگار اعلام نکن و محدودیت دسترسی را ثبت کن.
۳. main/preload، Electron API، scheme و مسیرهای تو‌در‌توی چت، HTML/CSP، assetها، DOM/composer و شناسهٔ پاسخ، CSS، native modules، integrity، امضا و قابلیت‌های Team ID را مقایسه کن. منطق اصلی و rollback حفظ شوند؛ وضعیت غیرفعال integrity رسمی T3 حفظ شود و الزام فعال Codex ضعیف نشود.
۴. کد مشترک و تفاوت‌های محدود resolver/context/target را اصلاح کن؛ تست رگرسیون Codex انجام بده. storage، فونت، runtime، backup، job، feed و حذف T3 مستقل باشند. `supportedT3Versions` فقط نسخهٔ بررسی‌شده را بپذیرد؛ payload مشترک نیازمند بازتولید userscript است.
۵. `npm test` و `test:gui` مشترک، سپس GUI/font در حالت `ARTL_TEST_TARGET=t3` و `test/t3-design-smoke.mjs` با CSS/DOM واقعی همان T3 را اجرا کن. fixture پذیرش اپ واقعی نیست؛ تست اجرا‌نشده و علتش ثبت شود.
۶. با `ARTL_TARGET=t3 ARTL_LOCAL_CANDIDATE=1` و خروجی صریح، Setup/ZIP مستقل بساز؛ `test:installer` و `test:events` را با `ARTL_TARGET=t3` روی همان Setup اجرا کن. target بسته/manifest برابر t3 و feed محلی غیرفعال باشد. نسخه، commit پایه، diff کامل، هش سورس/ZIP، امضا، حفظ منطق اصلی و تطبیق runtime ثبت شوند.
۷. گزارش `docs/compatibility/t3-<version>.md` و Setup دقیق را تحویل بده؛ اپ اصلی را خودت نبند یا جایگزین نکن. Launch را کاربر انجام می‌دهد.
۸. [چک‌لیست دستی مشترک](codex-update-workflow.md#چک‌لیست-تست-دستی-کاربر) را با نام/مسیر/build/candidate مربوط به T3 اجرا کن؛ مسیر تو‌در‌توی چت، جدابودن جهت پاسخ بین محیط‌ها، Touch ID/passkey و دست‌نخوردن Codex نیز بررسی شوند. state پیش‌فرض: `~/Library/Application Support/Agent RTL T3/`.
۹. نتیجهٔ هر مورد، شواهد status/renderer-ready، امضا/integrity و محدودیت‌ها ثبت شود؛ گزارش کلی تأیید جزئی نیست. Remove RTL نسخهٔ اصلی همان T3 را برگرداند؛ backup قدیمی روی آپدیت جدید جایگزین نشود. تغییر مؤثر پس از پذیرش، candidate و تست تازه می‌خواهد.

پذیرش دستی و مجوز صریح GitHub دو شرط جدا هستند. پس از هر دو، [مراحل انتشار](updates.md) با بسته، feed و manifest مستقل T3 اجرا شود. انتشار آزمایشی `--prerelease --latest=false` است؛ دانلود/آپدیت GitHub جدا تست شود. انتشار یک اپ تأیید دیگری نیست.
