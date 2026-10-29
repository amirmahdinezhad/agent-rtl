# Rasta 1.0.3 for T3 Code

- Support T3 Code 0.1.4 with original app logic and rollback preserved.
- Show installed and required T3 versions before installation.
- Keep an update dot on the Rasta button when a newer Rasta release is available.

Requires T3 Code 0.1.4, macOS 13.5+ and Apple Silicon. Update T3 through its own updater first, then run Rasta T3 Setup and choose Launch. The Setup version is 1.0.3; the T3 version is 0.1.4.

On 2026-10-29 the user confirmed that the corrected Setup message appeared, updated T3 and reported that everything worked. The user then explicitly authorized publication. This records general manual acceptance, without claiming additional individual checks.

This release packages the accepted candidate code; release version, signed feed configuration and release documentation change for publication. The local candidate ZIP had been removed, so the package is reconstructed from the retained earlier candidate with the tested compatibility fix and corrected Setup source, retaining the original per-app support directories. Setup is rebuilt from that source. Codex packages and its signed manifest remain unchanged.

Packages are ad hoc signed and are not Apple notarized.
