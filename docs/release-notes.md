# Rasta 1.0.2

- Introduce the Rasta name and logo throughout both macOS installers and the settings panel.
- Use consistent Rasta text for preparation, installation, updates and removal. The panel title is now simply Rasta, with a larger launcher icon.
- Simplify the desktop codebase by removing OpenCode, the generic ASAR patcher, the web userscript and unused font-scanning code.
- Provide separate installers for Codex `26.1023.51421` (build `22530`) and T3 Code (Beta) `0.1.3`, preserving independent settings, backups and signed update manifests.
- Preserve original app logic, signing checks and rollback; Codex integrity remains active and T3 retains its vendor integrity setting.

Requires macOS 13.5+ on Apple Silicon. Packages are ad hoc signed and are not notarized by Apple. This is a prerelease and does not replace the latest stable release.

On 2026-10-29, the user confirmed that both apps work with the local candidates built from `51a2746c2d2e8464ceb49600c2ec5e3eee36e980`. The 1.0.2 packages retain that behavioral code; version metadata, update feeds, release notes and download links are updated. Detailed sign-in/passkey and detached-window checks were not reported separately. Launch of the packages downloaded from this GitHub release remains a separate user verification step.

Release provenance includes the exact source commit, automated checks, package hashes and runtime verification. Both downloads and their Ed25519 manifests are verified again after publication.
