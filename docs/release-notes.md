# Rasta 1.0.1

- Support Codex `26.1023.51421` (build `22530`); reinstall RTL after the official app update.
- Keep the original main/preload files and CSP unchanged, preserving app logic and integrity checks.
- Provide a separate T3 Code (Beta) `0.1.3` package with the same behavior and the updated Rasta version.

Requires macOS 13.5+ and Apple Silicon. Packages are ad hoc signed and are not notarized by Apple. This is a prerelease and does not change the latest release.

On 2026-10-29, the user confirmed that both Codex and T3 work correctly with the local Rasta candidates built from commit `51a2746c2d2e8464ceb49600c2ec5e3eee36e980`. This is general manual acceptance of both apps; detailed sign-in/passkey and detached-window checks were not reported separately. Installation and launch of any newly published GitHub package still require separate verification.

Automated checks cover the target app version, GUI, fonts, response direction, installation/removal, and update events. The release provenance records the results and exact source commit.
