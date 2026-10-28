# Contributing to Agent RTL

Development requires the Node.js version specified in `package.json`. Building Setup requires macOS and Xcode Command Line Tools.

```sh
npm ci
npm run build:userscript
npm test
npm run test:language
npm run test:gui
```

- Work on a separate branch; add a relevant regression test for a bug fix.
- Edit the shared payload in `bin/payloads/desktop-payload.js` and regenerate the userscript. Check both Codex and T3 tests.
- Keep app copy, comments, release notes and documentation in English. The root README's Persian guide is the only translated guide. RTL fixtures and reading samples may contain Persian/Arabic content; their instructions stay English. Follow [the language policy](AGENTS.md#language-policy).
- Bug reports should include app name/version/build, Agent RTL version, macOS/architecture, reproduction steps and expected/actual results. Remove chat content and account information.
- Fixture tests do not replace real-app acceptance. The user performs Launch; publishing requires explicit authorization.

Structure: `bin/` contains CLI/runtime code, `native/` the AppKit UI, `tools/` build/release tools, `test/` tests and `docs/` guides. Build output is in `dist/`.

[Project instructions](AGENTS.md) · [Security reports](SECURITY.md)
