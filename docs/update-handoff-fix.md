# Update handoff and support migration

Each updater download uses its own temporary directory inside the authenticated job. A newer release discovered during handoff cannot reopen or erase the parent's archive. Exclusive file creation, signed manifests, checksums and app-target checks remain enforced.

The authenticated worker accepts a handoff in the directory that owns its runtime. Preparation reads the existing installation and original signed backup, but stages a replacement host pointing to the canonical `Rasta` or `Rasta T3` support directory. Neither the existing app nor its support directory moves during download or preparation.

Only after the user selects Launch and the app has exited does the worker atomically move the support directory and rebase mutable state, job and font paths. Original signed backup bundles and authenticated runtime bytes are not rewritten. A failed application commit restores the prior support paths and metadata.

A temporary directory bridge lets the old parent updater and progress window finish reading their job. After the replacement renderer confirms startup and old workers/windows exit, a bounded canonical helper removes that bridge and obsolete internal runtimes. It verifies the installed host, version, ready signal and bridge destination before cleanup. If takeover or shutdown is incomplete, it retains the bridge and backup for recovery. It never deletes a conflicting destination directory.

The new app uses only canonical Rasta paths. The canonical update registration replaces the previous per-app registration after installation succeeds. Codex and T3 data remain independent. Fresh installs already use canonical paths and do not need migration.

Regression checks cover a parent archive present during a second handoff; preservation of that parent archive; preparation and cancellation without moving state; both apps' signed native refresh and original-bundle rollback after migration; conflict refusal; rollback of metadata; cleanup waiting for old processes; and execution from paths containing spaces. Manual panel acceptance remains separate from these automated checks.
