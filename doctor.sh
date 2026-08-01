#!/bin/zsh

setopt NO_UNSET PIPE_FAIL

readonly LABEL="com.nomunyom.now-playing-sync"
readonly INSTALL_DIR="${NOW_PLAYING_INSTALL_DIR:-$HOME/Library/Application Support/NowPlayingSync}"
readonly READER="${NOW_PLAYING_READER:-$INSTALL_DIR/now-playing.sh}"
readonly CONFIG_FILE="${NOW_PLAYING_CONFIG:-$HOME/.config/now-playing-sync/config}"
readonly KEYCHAIN_SERVICE="nomunyom-now-playing"
typeset -i passed=0 failed=0 warned=0
endpoint=""
keychain_account=""

pass() { print -- "✓ $1"; passed=$((passed + 1)); }
fail() { print -- "✗ $1"; failed=$((failed + 1)); }
warn() { print -- "! $1"; warned=$((warned + 1)); }

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    print -- "Usage: ./doctor.sh"
    print -- "Checks the installed reader, private configuration, Keychain secret, receiver, and LaunchAgent."
    exit 0
fi
if (( $# )); then
    print -u2 -- "Usage: ./doctor.sh"
    exit 2
fi

if [[ "$(/usr/bin/uname -s)" == "Darwin" ]]; then
    pass "Running on macOS"
else
    fail "The publisher requires macOS"
fi

if [[ -x "$READER" ]]; then
    reader_result=$(/usr/bin/mktemp "${TMPDIR:-/tmp}/now-playing-doctor.XXXXXX")
    trap '/bin/rm -f "$reader_result"' EXIT
    if "$READER" > "$reader_result" 2>/dev/null && \
        /usr/bin/plutil -convert json -o /dev/null -- "$reader_result" >/dev/null 2>&1; then
        pass "Music reader returned valid JSON"
    else
        fail "Music reader failed; review macOS Automation permission"
    fi
else
    fail "Installed Music reader was not found at $READER"
fi

if [[ -f "$CONFIG_FILE" ]]; then
    permissions=$(/usr/bin/stat -f '%Lp' "$CONFIG_FILE" 2>/dev/null || print "unknown")
    if [[ "$permissions" == "600" ]]; then
        pass "Private configuration has mode 600"
    else
        fail "Private configuration must have mode 600 (found $permissions)"
    fi
    while IFS= read -r line; do
        case "$line" in
            NOW_PLAYING_ENDPOINT=*) endpoint="${line#NOW_PLAYING_ENDPOINT=}" ;;
            KEYCHAIN_ACCOUNT=*) keychain_account="${line#KEYCHAIN_ACCOUNT=}" ;;
        esac
    done < "$CONFIG_FILE"
    if [[ "$endpoint" == https://?* && "$endpoint" != *[[:space:]]* ]]; then
        pass "Receiver endpoint uses HTTPS"
    else
        fail "Receiver endpoint is missing or invalid"
    fi
else
    fail "Private configuration was not found at $CONFIG_FILE"
fi

if [[ -n "$keychain_account" ]] && /usr/bin/security find-generic-password \
    -a "$keychain_account" -s "$KEYCHAIN_SERVICE" -w >/dev/null 2>&1; then
    pass "Write secret is available in macOS Keychain"
else
    fail "Write secret is unavailable in macOS Keychain"
fi

if [[ -n "$endpoint" ]]; then
    health_url="${endpoint%/}/health"
    health_status=$(/usr/bin/curl --proto '=https' --silent --output /dev/null --write-out '%{http_code}' \
        --connect-timeout 5 --max-time 8 "$health_url" 2>/dev/null)
    [[ -n "$health_status" ]] || health_status="000"
    if [[ "$health_status" == "200" ]]; then
        pass "Receiver health endpoint is reachable"
    else
        warn "Receiver health check returned HTTP $health_status (optional for custom receivers)"
    fi
fi

uid=$(/usr/bin/id -u)
if /bin/launchctl print "gui/$uid/$LABEL" >/dev/null 2>&1; then
    pass "Background sync LaunchAgent is loaded"
else
    fail "Background sync LaunchAgent is not loaded"
fi

print
print -- "$passed passed, $warned warnings, $failed failed"
(( failed == 0 ))
