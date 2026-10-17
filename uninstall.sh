#!/bin/zsh

set -e

readonly LABEL="io.github.aliffrhn.apple-music-widget-bridge"
readonly KEYCHAIN_SERVICE="apple-music-widget-bridge"
# Names used before the 0.1.0 open-source release; migrated and cleaned up.
readonly LEGACY_LABEL="com.nomunyom.now-playing-sync"
readonly LEGACY_KEYCHAIN_SERVICE="nomunyom-now-playing"
readonly INSTALL_DIR="$HOME/Library/Application Support/NowPlayingSync"
readonly CONFIG_DIR="$HOME/.config/now-playing-sync"
readonly CONFIG_FILE="$CONFIG_DIR/config"
readonly PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
readonly LEGACY_PLIST="$HOME/Library/LaunchAgents/$LEGACY_LABEL.plist"
keep_keychain=0

usage() {
    print -- "Usage: ./uninstall.sh [--keep-keychain]"
}

while (( $# )); do
    case "$1" in
        --keep-keychain) keep_keychain=1 ;;
        -h|--help) usage; exit 0 ;;
        *) print -u2 -- "Unknown option: $1"; usage >&2; exit 2 ;;
    esac
    shift
done

if [[ "$(/usr/bin/uname -s)" != "Darwin" ]]; then
    print -u2 -- "This uninstaller only supports macOS."
    exit 1
fi

uid=$(/usr/bin/id -u)
/bin/launchctl bootout "gui/$uid" "$PLIST" >/dev/null 2>&1 || \
    /bin/launchctl bootout "gui/$uid/$LABEL" >/dev/null 2>&1 || true
/bin/rm -f "$PLIST"
/bin/launchctl bootout "gui/$uid" "$LEGACY_PLIST" >/dev/null 2>&1 || \
    /bin/launchctl bootout "gui/$uid/$LEGACY_LABEL" >/dev/null 2>&1 || true
/bin/rm -f "$LEGACY_PLIST"
/bin/rm -rf "$INSTALL_DIR"
/bin/rm -f "$CONFIG_FILE"
/bin/rmdir "$CONFIG_DIR" 2>/dev/null || true

if (( ! keep_keychain )); then
    account=$(/usr/bin/id -un)
    /usr/bin/security delete-generic-password -a "$account" -s "$KEYCHAIN_SERVICE" >/dev/null 2>&1 || true
    /usr/bin/security delete-generic-password -a "$account" -s "$LEGACY_KEYCHAIN_SERVICE" >/dev/null 2>&1 || true
fi

print -- "Uninstalled $LABEL."
(( keep_keychain )) && print -- "The Keychain secret was retained."
