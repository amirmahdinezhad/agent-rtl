#!/bin/bash
# Public bootstrap: only download and open Setup. Installation still needs Launch.
# Pins come from the verified Ed25519 manifest for v1.0.0; see docs/installation.md.
ARTL_INSTALL_VERSION='1.0.0'
ARTL_INSTALL_URL='https://github.com/amirmahdinezhad/agent-rtl/releases/download/v1.0.0/Agent-RTL-1.0.0-darwin-arm64.zip'
ARTL_INSTALL_SIZE='43567614'
ARTL_INSTALL_SHA256='33070eb713f47db40fc984529b2c89fd65e91871d89ab032ba93a64e7392e81e'

# All UI state lives in the installer's subshell. Plain output works in logs,
# narrow terminals and TERM=dumb; NO_COLOR retains the layout without ANSI colors.
artl_ui_init() {
    ARTL_UI_TTY=false ARTL_UI_RICH=false ARTL_UI_STAGE=''
    ARTL_UI_ACCENT='' ARTL_UI_GREEN='' ARTL_UI_RED='' ARTL_UI_BOLD='' ARTL_UI_RESET=''
    ARTL_UI_WIDTH=${COLUMNS:-}
    if [ -t 1 ]; then
        ARTL_UI_TTY=true
        if [ -z "$ARTL_UI_WIDTH" ]; then ARTL_UI_WIDTH=$(tput cols 2>/dev/null || true); fi
    fi
    if [[ ! "$ARTL_UI_WIDTH" =~ ^[0-9]{1,3}$ ]]; then ARTL_UI_WIDTH=72; fi
    ARTL_UI_WIDTH=$((10#$ARTL_UI_WIDTH))
    if (( ARTL_UI_WIDTH > 72 )); then ARTL_UI_WIDTH=72; fi
    if (( ARTL_UI_WIDTH < 24 )); then ARTL_UI_WIDTH=24; fi
    if [ "$ARTL_UI_TTY" = true ] && [ "${TERM:-dumb}" != dumb ]; then
        if (( ARTL_UI_WIDTH >= 54 )); then ARTL_UI_RICH=true; fi
        if [ -z "${NO_COLOR:-}" ]; then
            ARTL_UI_ACCENT=$'\033[35m' ARTL_UI_GREEN=$'\033[32m' ARTL_UI_RED=$'\033[31m'
            ARTL_UI_BOLD=$'\033[1m' ARTL_UI_RESET=$'\033[0m'
        fi
    fi
}

# Box content is English ASCII to keep alignment reliable in macOS terminals.
# Use a single wrapped stream so long instructions also fit narrow windows.
artl_ui_box() {
    local title=$1
    shift
    local inner=$((ARTL_UI_WIDTH - 4)) line rule
    if [ "$ARTL_UI_RICH" = true ]; then
        printf -v rule '%*s' "$((ARTL_UI_WIDTH - 2))" ''
        rule=${rule// /─}
        printf '\n%s╭%s╮%s\n' "$ARTL_UI_ACCENT" "$rule" "$ARTL_UI_RESET"
        { printf '%s\n\n' "$title"; printf '%s\n' "$@"; } | fold -s -w "$inner" |
            while IFS= read -r line; do
                printf '%s│%s %-*s %s│%s\n' "$ARTL_UI_ACCENT" "$ARTL_UI_RESET" "$inner" "$line" "$ARTL_UI_ACCENT" "$ARTL_UI_RESET"
            done
        printf '%s╰%s╯%s\n' "$ARTL_UI_ACCENT" "$rule" "$ARTL_UI_RESET"
    else
        printf '\n%s%s%s\n' "$ARTL_UI_BOLD" "$title" "$ARTL_UI_RESET"
        printf '%s\n' "$@" | fold -s -w "$ARTL_UI_WIDTH"
    fi
}

artl_ui_step() {
    ARTL_UI_STAGE=$2
    printf ' %s[%s/4] %s%s' "$ARTL_UI_ACCENT" "$1" "$2" "$ARTL_UI_RESET"
}

artl_ui_done() {
    printf ' %sOK%s\n' "$ARTL_UI_GREEN" "$ARTL_UI_RESET"
}

# A successful open request is a handoff, not proof of patch installation.
artl_ui_next() {
    local download_only=$1
    if [ "$download_only" = true ]; then
        artl_ui_box 'NEXT: OPEN SETUP' \
            'Open Agent RTL Setup.app from Downloads.' \
            'Then: Update RTL / Download update -> Launch.'
    else
        artl_ui_box 'NEXT: CONTINUE IN SETUP' \
            'In Setup, click Update RTL or Download update.' \
            'When ready, click Launch to restart Codex.'
    fi
    artl_ui_approval
}

# LaunchServices can return success while Gatekeeper blocks the app.
# Always offer this handoff; never infer a visible window from open's exit code.
artl_ui_approval() {
    artl_ui_box 'IF MACOS BLOCKS SETUP' \
        'This beta is not notarized by Apple.' \
        'No window? System Settings > Privacy & Security >' \
        'Security > Open Anyway for Agent RTL Setup.' \
        'Only approve if you trust this app, then open Setup again.'
    if [ "$ARTL_UI_RICH" = true ] && [ -n "$ARTL_UI_ACCENT" ]; then
        # OSC 8 is clickable in terminals that support hyperlinks.
        printf '\n\033]8;;x-apple.systempreferences:com.apple.preference.security?Privacy\033\\[ Open Privacy & Security ]\033]8;;\033\\\n'
    fi
    printf "\nOpen that settings page with:\n  open 'x-apple.systempreferences:com.apple.preference.security?Privacy'\n"
}

artl_ui_saved() {
    printf '\nOpen the saved app:\n  open %q\n' "$1"
}

# Preview uses the same layout and handoff copy, without downloading or opening apps.
artl_ui_preview() {
    printf '\n%sAGENT RTL | PREVIEW%s (no download or app launch)\n\n' "$ARTL_UI_BOLD" "$ARTL_UI_RESET"
    artl_ui_step 1 'Check your Mac'
    artl_ui_done
    artl_ui_step 2 'Download Setup'
    printf ' [##########] 100%% (sample)'
    artl_ui_done
    artl_ui_step 3 'Verify and prepare Setup'
    artl_ui_done
    artl_ui_step 4 'Request Setup opening'
    artl_ui_done
    artl_ui_next false
}

artl_install_error() {
    printf '\n%sAgent RTL: %s%s\n' "${ARTL_UI_RED:-}" "$*" "${ARTL_UI_RESET:-}" >&2
    if [ -n "${ARTL_UI_STAGE:-}" ]; then
        printf 'Stopped at: %s\n' "$ARTL_UI_STAGE" >&2
    fi
    printf 'Help: https://github.com/amirmahdinezhad/agent-rtl/blob/main/docs/installation.md\n' >&2
    return 1
}

# Runs in a subshell so traps and shell options do not affect a caller sourcing it.
artl_install_main() (
    set -eu
    umask 077
    artl_ui_init
    local download_only=false
    case "${1:-}" in
        '') ;;
        --download-only) download_only=true ;;
        --preview) artl_ui_preview; exit 0 ;;
        --help|-h)
            printf 'Usage: bash install.sh [--download-only | --preview]\nDownload verified Agent RTL Setup for Apple Silicon (macOS 13.5+).\nCodex changes only after you click Launch in Setup.\nUse --preview to see the terminal guide without downloading or opening apps.\n'
            exit 0 ;;
        *) artl_install_error 'Unknown option. Use --help.'; exit 1 ;;
    esac
    if [ "$#" -gt 1 ]; then artl_install_error 'Too many options. Use --help.'; exit 1; fi
    printf '\n%sAGENT RTL %s%s\n\n' "$ARTL_UI_BOLD" "$ARTL_INSTALL_VERSION" "$ARTL_UI_RESET"
    artl_ui_step 1 'Check your Mac'
    if [ "$(uname -s)" != Darwin ]; then
        artl_install_error 'This installer requires macOS 13.5 or newer.'; exit 1
    fi
    local major minor rest os_version
    os_version=$(sw_vers -productVersion)
    IFS=. read -r major minor rest <<< "$os_version"
    if [[ ! "$major" =~ ^[0-9]+$ || ! "${minor:-0}" =~ ^[0-9]+$ ]]; then
        artl_install_error 'Could not determine your macOS version.'; exit 1
    fi
    if (( major < 13 || (major == 13 && ${minor:-0} < 5) )); then
        artl_install_error 'Update macOS to 13.5 or newer, then try again.'; exit 1
    fi
    # hw.optional.arm64 identifies Apple Silicon even in a Rosetta terminal.
    if [ "$(uname -m)" != arm64 ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" != 1 ]; then
        artl_install_error 'This release supports Apple Silicon (M-series Macs). An Intel installer is not available.'; exit 1
    fi
    if [ "$(id -u)" = 0 ]; then
        artl_install_error 'Run this command as your normal user, without sudo.'; exit 1
    fi
    artl_ui_done

    # Bash 3.2 may unwind function locals before EXIT when bash -c exits early.
    # These variables belong to this isolated subshell so the trap can still read them.
    work='' destination='' keep=false
    # Remove only folders created by this invocation. Keep the app once verified,
    # including if LaunchServices fails, so the user can retry from Finder.
    trap 'if [ -n "$work" ]; then rm -rf -- "$work"; fi; if [ "$keep" = false ] && [ -n "$destination" ]; then rm -rf -- "$destination"; fi' EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM HUP
    work=$(mktemp -d "${TMPDIR:-/tmp}/agent-rtl-download.XXXXXX")
    local archive="$work/Agent-RTL.zip"
    artl_ui_step 2 'Download Setup'
    local -a curl_display=(--silent)
    if [ "$ARTL_UI_TTY" = true ]; then curl_display=(--progress-bar); printf '\n'; fi
    if ! curl --fail --location --show-error "${curl_display[@]}" --proto '=https' --proto-redir '=https' \
        --connect-timeout 20 --max-time 600 --retry 2 --max-filesize "$ARTL_INSTALL_SIZE" \
        --output "$archive" "$ARTL_INSTALL_URL"; then
        artl_install_error 'Download failed. Check your connection and try the same command again.'; exit 1
    fi
    artl_ui_done
    artl_ui_step 3 'Verify and prepare Setup'
    local actual_size actual_hash
    actual_size=$(wc -c < "$archive" | tr -d '[:space:]')
    if [ "$actual_size" != "$ARTL_INSTALL_SIZE" ]; then
        artl_install_error 'The download is incomplete or has changed. Nothing was opened.'; exit 1
    fi
    actual_hash=$(shasum -a 256 "$archive")
    actual_hash=${actual_hash%% *}
    if [ "$actual_hash" != "$ARTL_INSTALL_SHA256" ]; then
        artl_install_error 'Download verification failed. Nothing was opened. Download again from the project release page.'; exit 1
    fi

    # curl does not set browser quarantine. Preserve the normal macOS approval
    # path explicitly, for command-line downloads as well as browser downloads.
    local quarantine="0083;$(printf '%x' "$(date +%s)");Agent RTL;"
    if ! xattr -w com.apple.quarantine "$quarantine" "$archive"; then
        artl_install_error 'Could not preserve macOS download approval. Use the browser download instead.'; exit 1
    fi
    mkdir -p "$HOME/Downloads"
    destination=$(mktemp -d "$HOME/Downloads/Agent-RTL-$ARTL_INSTALL_VERSION.XXXXXX")
    if ! ditto -x -k "$archive" "$destination"; then
        artl_install_error 'Could not unpack Setup. Check available disk space and try again.'; exit 1
    fi
    local setup="$destination/Agent RTL Setup.app"
    if [ ! -d "$setup" ] || [ -L "$setup" ]; then
        artl_install_error 'The download does not contain Agent RTL Setup.app.'; exit 1
    fi
    if ! codesign --verify --deep --strict "$setup"; then
        artl_install_error 'The Setup app signature is invalid. Nothing was opened.'; exit 1
    fi
    if ! xattr -r -w com.apple.quarantine "$quarantine" "$setup"; then
        artl_install_error 'Could not preserve macOS approval for Setup. Use the browser download instead.'; exit 1
    fi
    keep=true
    artl_ui_done
    if [ "$download_only" = true ]; then
        artl_ui_step 4 'Ready to open Setup'
        artl_ui_done
        artl_ui_next true
        artl_ui_saved "$setup"
        exit 0
    fi
    artl_ui_step 4 'Request Setup opening'
    if ! open "$setup"; then
        artl_ui_saved "$setup"
        artl_ui_approval
        artl_install_error 'macOS could not open Setup. Open the saved app from Finder or use the command above.'; exit 1
    fi
    artl_ui_done
    artl_ui_next false
    artl_ui_saved "$setup"
)

# Also supports bash -c "$(curl ...)"; sourcing exposes functions for fixture tests.
if [ -z "${BASH_SOURCE[0]:-}" ] || [ "${BASH_SOURCE[0]}" = "$0" ]; then
    artl_install_main "$@"
fi
