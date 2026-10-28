# T3 and Codex update checks

| Request | Workflow |
| --- | --- |
| Names T3 or T3 Code | Start the [T3 workflow](t3-update-workflow.md) directly. |
| Names Codex | Start the [Codex workflow](codex-update-workflow.md) directly. |
| Names both apps | Run both with separate candidates and reports. |
| Does not name an app, such as "a new version is out" | Ask "Which app has a new version: T3 or Codex?" and wait. |
| Asks to edit the workflow | Edit documentation only. |

App names are case-insensitive. Chat history or the open app does not replace the user's answer. Read the target version from the actual bundle.

Order: diagnose and fix, run automated tests, prepare a local candidate, let the user Launch, record manual acceptance, then obtain explicit publishing authorization. This workflow does not create continuous monitoring.
