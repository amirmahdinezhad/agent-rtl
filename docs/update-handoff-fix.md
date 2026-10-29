# Update handoff fix candidate

Rasta 1.0.4 downloads successfully, but its worker rejects jobs created in the support directory of an earlier installation. Renaming the default support directory broke the handoff before staging or app replacement.

The fix retains the support directory that owns an authenticated updater runtime. Standalone Setup locates an installed host through the actual ASAR package entry and uses that installation’s support directory. New installations keep the Rasta defaults. No historical brand strings are embedded in the resolver. Job path validation still rejects another installation’s jobs.

The native Setup queries the same resolver for fonts, appearance, status and cancellation paths. Existing backups stay in place. No automatic app replacement or state migration is performed.

Regression tests exercise both targets from a differently named support directory, including real worker startup, preparation, explicit-install waiting and cancellation. They also verify standalone discovery and rejection of foreign jobs.

The 1.0.5 installers are test candidates for the v1.0.5-beta.1 prerelease. The user authorized a public GitHub prerelease and opt-in testing only on their existing Codex and T3 installations. Stable publication and manual acceptance of this correction remain pending. The exact prerelease ZIP bytes must be retained for stable promotion. Testing a direct Setup installation does not establish acceptance of an upgrade from the panel. Before publication, use a separate signed test feed to verify the closed-panel update dot, Refresh offering 1.0.5 and the in-panel upgrade completing with 1.0.5 shown and normal app behavior. Production-feed acceptance must be recorded separately afterward.
