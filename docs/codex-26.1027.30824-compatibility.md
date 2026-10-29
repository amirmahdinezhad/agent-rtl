# Codex 26.1027.30824 compatibility candidate

The installed Codex bundle at `/Applications/ChatGPT.app` was version
`26.1023.51421`, build `22530`, with Rasta `1.1.8`. The installed T3 Code
bundle was `0.1.5`, also with Rasta `1.1.8`. Both installed archives were
hashed before testing. During preparation, the installed Codex bundle was
observed updating to the official new version; its ASAR exactly matches the
verified vendor download. T3 remained unchanged. The agent did not close,
replace or install either original app.

## Official source and isolated checks

The official Codex appcast offers `26.1027.30824`, build `22943`, for Apple
Silicon. Its full ZIP is 764868937 bytes, with SHA-256
`79018bcdcc141902d9a0e61950ec207f71951941db4165f8a0dc2dc8f0dcc883`.
The download passes the appcast's Ed25519 archive signature check against
the existing vendor key. Strict deep bundle verification confirms the
OpenAI identity and Team ID `2DC432GLL2`.

The downloaded bundle and ASAR both identify version `26.1027.30824` and
build `22943`. The original main entry is `.vite/build/early-bootstrap.js`.
The isolated patched copy retains all 16337 original JavaScript files
byte-for-byte and the entire original archive data area. Native ASAR
integrity remains enabled; only 32 native digest metadata bytes change.
The staged copy passes strict deep signature and digest verification.

The new build uses a hashed CSS filename rather than the previous
`app-initial`, `app-primary` and `app-shared` naming. Presentation tests now
read stylesheet links from the actual main and detached HTML entry points.
Content, per-message direction and panel tests pass with the new vendor CSS.
An isolated native launch also passes interface mounting, widget controls,
saved settings, custom Persian glyph rendering, question choices and queued
message checks. These automated checks do not establish manual acceptance.

T3 retains its separate package, state, backups and feed, targeting `0.1.5`.
Its real-CSS test confirms the version is in the header and all four Accent
color boxes are square. Both packages include the restored refresh icon and
unchanged pointer while checking. Public stable distribution stays unchanged.

## Manual panel update from the previous runtime

Use the private Beta workflow in [development-workflow.md](development-workflow.md).
Keep the previous Rasta runtime installed until starting its panel upgrade.

1. Codex was subsequently observed at the new official version with the old
   Rasta patch removed. Install the local-only compatibility Setup at
   `dist/compatibility/codex-26.1027.30824/previous-rasta/Rasta Setup.app`.
   It retains Rasta `1.1.8`, supports the new Codex host and has no initial
   release feed, so initial Setup cannot upgrade to the candidate. Select
   Launch yourself. Record this baseline installation separately.
2. In that previous runtime, enable the authenticated owner's Beta channel.
   Close the panel and confirm the update dot. Select Check for updates
   (Refresh) and confirm the exact candidate version from its local test guide.
3. Start Download update from the panel and complete the upgrade, selecting
   Launch yourself. Confirm the new version below Rasta in the header and
   normal Codex behavior, including mixed-language content and saved fonts.
4. Confirm square Accent color selection boxes, the circular-arrow check
   icon and unchanged mouse pointer during the explicit update check.
5. In T3 `0.1.5`, update directly from its existing Rasta `1.1.8` panel through
   its independent Beta feed. Repeat and record all panel observations for
   T3 separately; no new T3 host compatibility Setup is needed.

Record closed-panel dot, offered version, panel upgrade completion, displayed
version and normal behavior separately for each app. Public promotion requires
explicit acceptance of the exact source and ZIP bytes plus GitHub authorization.
Repeat production-feed acceptance separately after promotion.
