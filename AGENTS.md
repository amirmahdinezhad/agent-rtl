# Agent RTL workflows

For desktop releases, compatibility checks or RTL broken after an update:

- If the user names T3/T3 Code or Codex, inspect that app directly.
- If no app is named, ask "Which app has a new version: T3 or Codex?" and wait.
- Read the target version/build from the actual bundle and ASAR, not the CLI.
- Preserve original app logic, download verification, signing and rollback.
  Keep Codex integrity active and retain T3's vendor integrity setting.
- Keep each app's state, backups, jobs, packages and update feeds independent.
- Finish local diagnosis, fixes, relevant tests and candidate preparation.
  The user performs Launch and manual acceptance; do not close or replace the
  original app yourself. Automated tests do not establish manual acceptance.
- Publish only with explicit GitHub authorization and manual acceptance for
  app packages. Use `--prerelease --latest=false` for prereleases and verify
  published downloads separately from local candidates.

## Product scope

Support the Codex and T3 Code desktop apps on macOS. Keep distribution focused
on their graphical installers; add other app targets or web distributions only
when the user explicitly requests them.

## Language policy

Write all app and Setup labels, descriptions, errors, CLI output, release notes,
code comments, agent instructions and documentation in English. The only Persian
guide belongs in the `persian-documentation` section of the root `README.md`.
Keep that section separate from the English guide. Persian/Arabic text used as
RTL test data, reading samples, font names or character-matching logic is content,
not explanatory copy; preserve it where required to verify RTL behavior. Write
instructions surrounding those samples in English.

Before completing a change, run `npm run test:language` and the relevant tests.
Maintain the language check's narrow sample exceptions when adding RTL fixtures.
