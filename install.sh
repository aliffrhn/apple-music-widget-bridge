#!/bin/zsh

set -e

readonly LABEL="com.nomunyom.now-playing-sync"
readonly KEYCHAIN_SERVICE="nomunyom-now-playing"
readonly INSTALL_DIR="$HOME/Library/Application Support/NowPlayingSync"
readonly CONFIG_DIR="$HOME/.config/now-playing-sync"
readonly CONFIG_FILE="$CONFIG_DIR/config"
readonly PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
readonly SOURCE_DIR="${0:A:h}"
endpoint=""
artwork_enabled=1
stage_dir=""

cleanup() {
    [[ -n "$stage_dir" && -d "$stage_dir" ]] && /bin/rm -rf "$stage_dir"
}
trap cleanup EXIT

usage() {
    print -- "Usage: ./install.sh [--endpoint https://example.com/api/now-playing] [--no-artwork]"
}

if [[ "$(/usr/bin/uname -s)" != "Darwin" ]]; then
    print -u2 -- "This installer only supports macOS."
    exit 1
fi

for command in /bin/zsh /usr/bin/osascript /usr/bin/curl /usr/bin/security /bin/launchctl /usr/bin/plutil \
    /usr/bin/sips /usr/bin/file /usr/bin/xxd /bin/dd; do
    [[ -x "$command" ]] || { print -u2 -- "Required command is missing: $command"; exit 1; }
done

while (( $# )); do
    case "$1" in
        --endpoint)
            (( $# >= 2 )) || { print -u2 -- "--endpoint requires a URL."; usage >&2; exit 2; }
            shift
            endpoint="$1"
            ;;
        --no-artwork) artwork_enabled=0 ;;
        -h|--help) usage; exit 0 ;;
        *) print -u2 -- "Unknown option: $1"; usage >&2; exit 2 ;;
    esac
    shift
done

if [[ -z "$endpoint" ]]; then
    vared -p "Receiver HTTPS URL: " -c endpoint
fi
if [[ "$endpoint" != https://?* || "$endpoint" == *[[:space:]]* ]]; then
    print -u2 -- "The endpoint must be a valid HTTPS URL without whitespace."
    exit 1
fi

account=$(/usr/bin/id -un)
stage_dir=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/now-playing-install.XXXXXX")
/bin/chmod 700 "$stage_dir"
/usr/bin/install -m 700 "$SOURCE_DIR/now-playing.sh" "$stage_dir/now-playing.sh"
/usr/bin/install -m 700 "$SOURCE_DIR/sync-now-playing.sh" "$stage_dir/sync-now-playing.sh"
/usr/bin/install -m 700 "$SOURCE_DIR/artwork.sh" "$stage_dir/artwork.sh"
/usr/bin/install -m 700 "$SOURCE_DIR/doctor.sh" "$stage_dir/doctor.sh"
{
    print -r -- "NOW_PLAYING_ENDPOINT=$endpoint"
    print -r -- "KEYCHAIN_ACCOUNT=$account"
    print -r -- "NOW_PLAYING_ARTWORK_ENABLED=$artwork_enabled"
} > "$stage_dir/config"
/bin/chmod 600 "$stage_dir/config"

xml_path="${INSTALL_DIR//&/&amp;}"
xml_path="${xml_path//</&lt;}"
xml_path="${xml_path//>/&gt;}"
xml_path="${xml_path//\"/&quot;}"
replacement="${xml_path//&/\\&}/sync-now-playing.sh"
replacement="${replacement//|/\\|}"
/usr/bin/sed "s|__SYNC_SCRIPT__|$replacement|g" \
    "$SOURCE_DIR/com.nomunyom.now-playing-sync.plist.template" > "$stage_dir/agent.plist"
/bin/chmod 600 "$stage_dir/agent.plist"
/usr/bin/plutil -lint "$stage_dir/agent.plist" >/dev/null

print -- "Running the reader preflight (this may trigger an Automation permission prompt)..."
preflight="$stage_dir/preflight.json"
"$stage_dir/now-playing.sh" > "$preflight"
/usr/bin/plutil -convert json -o /dev/null -- "$preflight" >/dev/null 2>&1 || {
    print -u2 -- "The reader did not return valid JSON. Review Automation permission and try again."
    exit 1
}
print -- "Reader preflight returned valid JSON:"
/bin/cat "$preflight"
print

print -- "Enter the private write secret at the secure Keychain prompt."
print -- "The input is handled by macOS security(1) and will not appear in this script's arguments."
/usr/bin/security add-generic-password -U -a "$account" -s "$KEYCHAIN_SERVICE" \
    -l "Now Playing website write secret" -w

/bin/mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$HOME/Library/LaunchAgents"
/bin/chmod 700 "$INSTALL_DIR" "$CONFIG_DIR"
/usr/bin/install -m 700 "$stage_dir/now-playing.sh" "$INSTALL_DIR/now-playing.sh"
/usr/bin/install -m 700 "$stage_dir/sync-now-playing.sh" "$INSTALL_DIR/sync-now-playing.sh"
/usr/bin/install -m 700 "$stage_dir/artwork.sh" "$INSTALL_DIR/artwork.sh"
/usr/bin/install -m 700 "$stage_dir/doctor.sh" "$INSTALL_DIR/doctor.sh"
/usr/bin/install -m 600 "$stage_dir/config" "$CONFIG_FILE"
/usr/bin/install -m 600 "$stage_dir/agent.plist" "$PLIST"

uid=$(/usr/bin/id -u)
/bin/launchctl bootout "gui/$uid" "$PLIST" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "gui/$uid" "$PLIST"
/bin/launchctl enable "gui/$uid/$LABEL" 2>/dev/null || true
/bin/launchctl kickstart -k "gui/$uid/$LABEL"

print -- "Installed and started $LABEL."
(( artwork_enabled )) && print -- "Artwork uploads: enabled." || print -- "Artwork uploads: disabled."
print -- "Status: launchctl print gui/$uid/$LABEL"
print -- "Logs:   tail -f '$INSTALL_DIR/now-playing-sync.log'"
print -- "Test:   '$INSTALL_DIR/sync-now-playing.sh' --once"
print -- "Doctor: '$INSTALL_DIR/doctor.sh'"
print -- "If Music is unavailable, grant Automation access in System Settings > Privacy & Security > Automation, then restart the agent."
