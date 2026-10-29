# Rasta workflows

For desktop releases, compatibility checks or RTL broken after an update:

- If the user names T3/T3 Code or Codex, inspect that app directly.
- If no app is named, ask "Which app has a new version: T3 or Codex?" and wait.
- Read the target version/build from the actual bundle and ASAR.
- Preserve original app logic, download verification, signing and rollback.
  Keep Codex integrity active and retain T3's vendor integrity setting.
- Keep each app's state, backups, jobs, packages and update feeds independent.
- Finish local diagnosis, fixes, relevant tests and candidate preparation.
  The user performs Launch and manual acceptance; do not close or replace the
  original app yourself. Automated tests do not establish manual acceptance.
- For every release, provide the user with files and steps to test the update
  from the previous Rasta version inside the app's panel. If that version cannot
  install on the current app, prepare a local-only compatibility test package.
  Keep the previous version installed until the user starts the panel update;
  Setup must not upgrade it during initial installation.
- Manual release acceptance must explicitly confirm the update dot on the
  closed panel button, Refresh offering the intended new version, and the
  in-panel upgrade completing with the new version shown and the app working.
  Test unpublished candidates through a separate signed test feed; after
  publication, have the user repeat the check through the production feed.
  Record these results separately from general installation acceptance.
- Publish only with explicit GitHub authorization and manual acceptance for
  app packages. Use `--prerelease --latest=false` for prereleases and verify
  published downloads separately from local candidates.

## Private development and public promotion

- Work on local `develop`, tracking `development/develop` in the private
  `amirmahdinezhad/rasta-beta` repository. Push implementation, fixes and workflow
  changes there first. Public `origin` is `amirmahdinezhad/rasta`.
- After each completed change, run language and relevant tests, commit and push
  to private `develop`, and monitor the `Private development Beta` workflow until
  both signed app packages and their private feeds are verified. The user tests
  through panel Refresh and Launch; the agent handles builds, uploads and feeds.
- Keep public branches, stable feeds and public app packages unchanged until the
  user explicitly accepts the exact candidate and authorizes public promotion.
- Before changing CI, preparing a Beta, or promoting an accepted candidate, read
  `docs/development-workflow.md` and use its scripts. Promotion transfers the exact
  tested source commit and ZIP bytes; it never rebuilds accepted installers.
- Record acceptance separately for Codex and T3: closed-panel update dot,
  Refresh offering the candidate, panel upgrade completion, displayed version
  and normal app behavior. Agent checks never substitute for these observations.

## Product scope

Support the Codex and T3 Code desktop apps on macOS. Installation uses the
graphical Setup apps; updates and removal use the in-app panel. Keep runtime
helpers internal to these graphical flows. Add other app targets or web
distributions only when the user explicitly requests them.

## Language policy

Write all app and Setup labels, descriptions, errors, service output, release notes,
code comments, agent instructions and documentation in English. The only Persian
guide belongs in the `persian-documentation` section of the root `README.md`.
Keep that section separate from the English guide. Persian/Arabic text used as
RTL test data, reading samples, font names or character-matching logic is content,
not explanatory copy; preserve it where required to verify RTL behavior. Write
instructions surrounding those samples in English.

Before completing a change, run `npm run test:language` and the relevant tests.
Maintain the language check's narrow sample exceptions when adding RTL fixtures.
