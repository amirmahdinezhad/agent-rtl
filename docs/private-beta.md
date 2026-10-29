# Owner-only Beta updates

Stable updates remain public and do not require a GitHub account. Beta uses the private `amirmahdinezhad/rasta-beta` repository. Only the repository owner's GitHub user ID `17439071` is authorized. A matching account name alone is insufficient.

The panel shows the Beta updates switch only after GitHub authenticates that account and confirms the repository is private and owned by the same user. Each app stores its channel preference independently. Selecting Beta, reading its signed feed and downloading its package require fresh authorization. Logout, another account, a public repository or an unavailable credential helper fail closed; Stable checks remain available. No GitHub token is placed in the app, source, feed or release package. The owner-only transport uses the existing GitHub CLI sign-in on the test Mac.

The private `beta` release holds separate signed Codex and T3 feeds. Those feeds reference versioned private release assets. Publish private test releases with `--prerelease --latest=false`. Keep public stable feeds unchanged until manual acceptance. Retain each accepted ZIP and its SHA-256 for promotion without rebuilding.

Existing installations can receive the first channel-enabled package through a temporary private feed configured only on the test Mac. Preserve the old runtime and app until the user starts the panel update and selects Launch. Save original feed configurations for rollback. Do not copy credentials into this bootstrap configuration.

For each app, test: hidden Beta controls for an unauthorized account; an authenticated owner can select Beta; the closed panel shows an update dot; Refresh offers the intended version; and the panel upgrade completes with the new version shown and normal app behavior. Test Stable separately after public promotion.

Private hosting controls future access to downloads. A previously public prerelease may already have been downloaded, and a downloaded desktop app can be copied. Withdrawing its public release does not revoke copies already obtained.
