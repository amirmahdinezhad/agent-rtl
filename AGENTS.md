# Agent RTL workflows

For desktop releases, compatibility checks or RTL broken after an update, follow
[the app update workflow](docs/app-update-workflow.md).

- Named T3/T3 Code or Codex: start that app's workflow directly.
- Unnamed app: ask "Which app has a new version: T3 or Codex?" and wait.
- Editing the workflow is a documentation task, not an update run.

Finish local diagnosis, fixes, tests and candidate preparation. The user performs
Launch and manual acceptance. Publish only with explicit GitHub authorization;
passing automated tests alone is insufficient.

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
