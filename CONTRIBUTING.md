# مشارکت در Agent RTL

برای توسعه، Node.js مطابق `package.json` لازم است؛ ساخت Setup به macOS و Xcode Command Line Tools نیاز دارد.

```sh
npm ci
npm run build:userscript
npm test
npm run test:gui
```

- تغییرات را در شاخهٔ جدا انجام دهید؛ برای رفع باگ، تست رگرسیون مرتبط اضافه کنید.
- payload مشترک را در `bin/payloads/desktop-payload.js` ویرایش و userscript را بازتولید کنید؛ تست‌های Codex و T3 را بررسی کنید.
- گزارش باگ شامل نام/نسخه/build اپ، نسخهٔ Agent RTL، macOS/معماری، مراحل بازتولید و نتیجهٔ مورد انتظار/واقعی باشد؛ متن چت و اطلاعات حساب را حذف کنید.
- تست fixture جای پذیرش اپ واقعی نیست. Launch را کاربر انجام می‌دهد؛ انتشار نیازمند دستور صریح اوست.

ساختار: `bin/` کد CLI و runtime، `native/` رابط AppKit، `tools/` ساخت و انتشار، `test/` تست‌ها، `docs/` راهنماها. خروجی ساخت در `dist/` است.

[ساخت و انتشار](docs/updates.md) · [بررسی آپدیت اپ‌ها](docs/app-update-workflow.md) · [گزارش امنیتی](SECURITY.md)
