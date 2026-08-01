#!/bin/zsh

setopt NO_UNSET PIPE_FAIL

readonly INSTALL_DIR="${NOW_PLAYING_INSTALL_DIR:-$HOME/Library/Application Support/NowPlayingSync}"
readonly READER="${NOW_PLAYING_READER:-$INSTALL_DIR/now-playing.sh}"
readonly ARTWORK_READER="${NOW_PLAYING_ARTWORK_READER:-$INSTALL_DIR/artwork.sh}"
readonly CONFIG_FILE="${NOW_PLAYING_CONFIG:-$HOME/.config/now-playing-sync/config}"
readonly STATE_FILE="${NOW_PLAYING_STATE_FILE:-$INSTALL_DIR/last-successful-upload}"
readonly LAST_TRACK_FILE="${NOW_PLAYING_LAST_TRACK_FILE:-$INSTALL_DIR/last-known-track.json}"
readonly ARTWORK_CACHE_FILE="${NOW_PLAYING_ARTWORK_CACHE_FILE:-$INSTALL_DIR/uploaded-artwork-ids}"
readonly LOG_FILE="${NOW_PLAYING_LOG_FILE:-$INSTALL_DIR/now-playing-sync.log}"
readonly KEYCHAIN_SERVICE="nomunyom-now-playing"
readonly POLL_SECONDS=5
readonly HEARTBEAT_SECONDS=30

typeset -g endpoint="" keychain_account="" write_secret="" artwork_enabled=1
typeset -g current_temp="" reader_error_temp=""
typeset -g shutting_down=0 once_mode=0
typeset -g last_fingerprint="" last_sent_epoch=0 last_invalid_log=0 unavailable_logged=0

rotate_log_if_needed() {
    [[ -f "$LOG_FILE" ]] || return 0
    local size=$(/usr/bin/stat -f '%z' "$LOG_FILE" 2>/dev/null || print 0)
    (( size < 1048576 )) && return 0
    /bin/mv -f "$LOG_FILE.1" "$LOG_FILE.2" 2>/dev/null || true
    /bin/mv -f "$LOG_FILE" "$LOG_FILE.1" 2>/dev/null || true
}

log_message() {
    rotate_log_if_needed
    /bin/mkdir -p "$INSTALL_DIR"
    /bin/chmod 700 "$INSTALL_DIR" 2>/dev/null || true
    print -r -- "$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ') $1" >> "$LOG_FILE"
    /bin/chmod 600 "$LOG_FILE" 2>/dev/null || true
}

cleanup_temp_files() {
    [[ -n "$current_temp" ]] && /bin/rm -f "$current_temp"
    [[ -n "$reader_error_temp" ]] && /bin/rm -f "$reader_error_temp"
}

unavailable_payload() {
    local captured_at=$(/bin/date -u '+%Y-%m-%dT%H:%M:%S.000Z')
    print -r -- "{\"schemaVersion\":1,\"status\":\"unavailable\",\"isPlaying\":false,\"title\":null,\"artist\":null,\"album\":null,\"albumArtist\":null,\"genre\":null,\"year\":null,\"durationSeconds\":null,\"positionSeconds\":null,\"persistentId\":null,\"capturedAt\":\"$captured_at\"}"
}

load_config() {
    if [[ ! -f "$CONFIG_FILE" ]]; then
        print -u2 -- "Missing configuration: $CONFIG_FILE. Run install.sh first."
        return 1
    fi
    /bin/chmod 600 "$CONFIG_FILE" 2>/dev/null || {
        print -u2 -- "Could not restrict permissions on $CONFIG_FILE."
        return 1
    }
    while IFS= read -r line; do
        case "$line" in
            NOW_PLAYING_ENDPOINT=*) endpoint="${line#NOW_PLAYING_ENDPOINT=}" ;;
            KEYCHAIN_ACCOUNT=*) keychain_account="${line#KEYCHAIN_ACCOUNT=}" ;;
            NOW_PLAYING_ARTWORK_ENABLED=*) artwork_enabled="${line#NOW_PLAYING_ARTWORK_ENABLED=}" ;;
        esac
    done < "$CONFIG_FILE"
    if [[ "$endpoint" != https://* || -z "$keychain_account" || "$artwork_enabled" != [01] ]]; then
        print -u2 -- "Invalid private configuration. Run install.sh again."
        return 1
    fi
    write_secret=$(/usr/bin/security find-generic-password \
        -a "$keychain_account" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null) || {
        print -u2 -- "The Keychain item '$KEYCHAIN_SERVICE' could not be read. Run install.sh again."
        return 1
    }
    if [[ -z "$write_secret" || "$write_secret" == *$'\n'* || "$write_secret" == *$'\r'* ]]; then
        print -u2 -- "The Keychain secret is empty or contains a line break."
        return 1
    fi
}

validate_json() {
    # macOS plutil's lint mode is XML-only on some releases; conversion parses JSON.
    /usr/bin/plutil -convert json -o /dev/null -- "$1" >/dev/null 2>&1
}

preserve_last_track() {
    local payload_file="$1" merged_temp
    merged_temp=$(/usr/bin/mktemp "${TMPDIR:-/tmp}/now-playing-merged.XXXXXX")
    /bin/chmod 600 "$merged_temp"
    if ! /usr/bin/osascript -l JavaScript -e '
        ObjC.import("Foundation");
        function readJSON(path) {
            var raw = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null).js;
            return JSON.parse(raw);
        }
        function run(argv) {
            var payload = readJSON(argv[0]);
            var cachePath = argv[1];
            var fields = ["title", "artist", "album", "albumArtist", "genre", "year",
                "durationSeconds", "positionSeconds", "persistentId"];
            var hasTrack = payload.title !== null && payload.title !== undefined && payload.title !== "";

            if (hasTrack) {
                var cached = {};
                fields.forEach(function (field) {
                    cached[field] = payload[field] === undefined ? null : payload[field];
                });
                $(JSON.stringify(cached)).writeToFileAtomicallyEncodingError(
                    cachePath, true, $.NSUTF8StringEncoding, null
                );
            } else if ($.NSFileManager.defaultManager.fileExistsAtPath(cachePath)) {
                try {
                    var previous = readJSON(cachePath);
                    fields.forEach(function (field) {
                        if (payload[field] === null || payload[field] === undefined || payload[field] === "") {
                            payload[field] = previous[field] === undefined ? null : previous[field];
                        }
                    });
                } catch (_) {
                    // Ignore a damaged cache; the live reader payload remains valid.
                }
            }
            return JSON.stringify(payload);
        }' "$payload_file" "$LAST_TRACK_FILE" > "$merged_temp" 2>/dev/null; then
        /bin/rm -f "$merged_temp"
        return 1
    fi
    if ! validate_json "$merged_temp"; then
        /bin/rm -f "$merged_temp"
        return 1
    fi
    /bin/mv -f "$merged_temp" "$payload_file"
    [[ -f "$LAST_TRACK_FILE" ]] && /bin/chmod 600 "$LAST_TRACK_FILE"
    return 0
}

json_field() {
    /usr/bin/osascript -l JavaScript -e '
        ObjC.import("Foundation");
        function run(argv) {
            var raw = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null).js;
            var value = JSON.parse(raw);
            var field = value[argv[1]];
            return field === null || field === undefined ? "" : String(field);
        }' "$1" "$2" 2>/dev/null
}

fingerprint_json() {
    /usr/bin/osascript -l JavaScript -e '
        ObjC.import("Foundation");
        function run(argv) {
            var raw = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null).js;
            var v = JSON.parse(raw);
            var allowed = ["playing", "paused", "stopped", "not_open", "unavailable"];
            if (v.schemaVersion !== 1 || allowed.indexOf(v.status) < 0 || typeof v.isPlaying !== "boolean" || !v.capturedAt) throw Error("schema");
            return JSON.stringify([v.status, v.persistentId, v.title, v.artist, v.album]);
        }' "$1" 2>/dev/null
}

load_last_success() {
    [[ -f "$STATE_FILE" ]] || return 0
    IFS= read -r last_sent_epoch < "$STATE_FILE" || last_sent_epoch=0
    IFS= read -r last_fingerprint < <(/usr/bin/sed -n '2p' "$STATE_FILE") || last_fingerprint=""
    [[ "$last_sent_epoch" == <-> ]] || last_sent_epoch=0
}

save_last_success() {
    local fingerprint="$1" epoch="$2" state_temp="$STATE_FILE.tmp.$$"
    {
        print -r -- "$epoch"
        print -r -- "$fingerprint"
    } > "$state_temp"
    /bin/chmod 600 "$state_temp"
    /bin/mv -f "$state_temp" "$STATE_FILE"
    last_sent_epoch=$epoch
    last_fingerprint=$fingerprint
}

is_temporary_status() {
    [[ "$1" == "000" || "$1" == "408" || "$1" == "425" || "$1" == "429" || "$1" == 5* ]]
}

artwork_was_uploaded() {
    local persistent_id="$1" cached_id=""
    [[ -f "$ARTWORK_CACHE_FILE" ]] || return 1
    IFS= read -r cached_id < "$ARTWORK_CACHE_FILE" || return 1
    [[ "$cached_id" == "$persistent_id" ]]
}

remember_uploaded_artwork() {
    local persistent_id="$1" cache_temp="$ARTWORK_CACHE_FILE.tmp.$$"
    print -r -- "$persistent_id" > "$cache_temp"
    /bin/chmod 600 "$cache_temp"
    /bin/mv -f "$cache_temp" "$ARTWORK_CACHE_FILE"
}

upload_artwork_file() {
    local artwork_file="$1" persistent_id="$2" content_type="$3"
    local max_attempts=3 attempt=1 delay=1 http_code curl_exit response_file escaped_secret
    response_file=$(/usr/bin/mktemp "${TMPDIR:-/tmp}/now-playing-artwork-response.XXXXXX")
    /bin/chmod 600 "$response_file"
    escaped_secret="${write_secret//\\/\\\\}"
    escaped_secret="${escaped_secret//\"/\\\"}"

    while (( attempt <= max_attempts )); do
        http_code=$(print -r -- "header = \"X-Now-Playing-Secret: $escaped_secret\"" | \
            /usr/bin/curl --config - --silent --show-error --output "$response_file" \
                --write-out '%{http_code}' --request POST \
                --proto '=https' \
            --header 'X-Now-Playing-Action: upload-artwork' \
            --header "X-Now-Playing-Persistent-Id: $persistent_id" \
            --header "Content-Type: $content_type" \
            --connect-timeout 5 --max-time 20 \
            --data-binary "@$artwork_file" --url "$endpoint" 2>/dev/null)
        curl_exit=$?
        [[ -z "$http_code" ]] && http_code="000"

        if [[ "$http_code" == <200-299> && $curl_exit -eq 0 ]]; then
            if validate_json "$response_file" && \
                [[ "$(/usr/bin/plutil -extract ok raw -- "$response_file" 2>/dev/null)" == "true" ]]; then
                /bin/rm -f "$response_file"
                return 0
            fi
            log_message "Artwork upload returned an invalid success response."
            /bin/rm -f "$response_file"
            return 1
        fi

        if (( curl_exit == 0 )) && [[ "$http_code" == 4* ]]; then
            log_message "Artwork upload rejected by server (HTTP $http_code); client/server contract needs review."
            /bin/rm -f "$response_file"
            return 1
        fi
        if (( attempt < max_attempts )); then
            log_message "Temporary artwork upload failure (HTTP $http_code); retry $attempt/$((max_attempts - 1))."
            /bin/sleep "$delay"
            delay=$((delay * 2))
        else
            log_message "Temporary artwork upload failure (HTTP $http_code); retry limit reached."
        fi
        attempt=$((attempt + 1))
    done
    /bin/rm -f "$response_file"
    return 1
}

upload_artwork_if_needed() {
    local payload_file="$1" persistent_id artwork_file result_file artwork_status content_type byte_count
    (( artwork_enabled )) || return 0
    [[ -x "$ARTWORK_READER" ]] || return 0
    persistent_id=$(json_field "$payload_file" persistentId)
    [[ "$persistent_id" =~ "^[[:xdigit:]]{8,32}$" ]] || return 0
    persistent_id="${(U)persistent_id}"
    artwork_was_uploaded "$persistent_id" && return 0

    artwork_file=$(/usr/bin/mktemp "${TMPDIR:-/tmp}/now-playing-artwork.XXXXXX")
    result_file=$(/usr/bin/mktemp "${TMPDIR:-/tmp}/now-playing-artwork-result.XXXXXX")
    /bin/rm -f "$artwork_file"
    /bin/chmod 600 "$result_file"
    if ! "$ARTWORK_READER" "$artwork_file" > "$result_file" 2>/dev/null || ! validate_json "$result_file"; then
        log_message "Artwork extraction failed."
        /bin/rm -f "$artwork_file" "$result_file"
        return 1
    fi

    artwork_status=$(json_field "$result_file" status)
    if [[ "$artwork_status" == "no_artwork" || "$artwork_status" == "no_track" || "$artwork_status" == "not_open" ]]; then
        /bin/rm -f "$artwork_file" "$result_file"
        return 0
    fi
    if [[ "$artwork_status" != "ok" || ! -s "$artwork_file" ]]; then
        log_message "Artwork extraction unavailable ($artwork_status)."
        /bin/rm -f "$artwork_file" "$result_file"
        return 1
    fi

    content_type=$(json_field "$result_file" contentType)
    byte_count=$(json_field "$result_file" byteCount)
    if [[ "$content_type" != "image/jpeg" && "$content_type" != "image/png" ]] || \
        [[ "$byte_count" != <1-2097152> ]]; then
        log_message "Artwork extraction produced an unsupported file."
        /bin/rm -f "$artwork_file" "$result_file"
        return 1
    fi

    if upload_artwork_file "$artwork_file" "$persistent_id" "$content_type"; then
        remember_uploaded_artwork "$persistent_id"
        log_message "Artwork upload succeeded."
    fi
    /bin/rm -f "$artwork_file" "$result_file"
}

upload_payload() {
    local payload_file="$1" max_attempts="${2:-4}" attempt=1 delay=1 http_code curl_exit escaped_secret
    escaped_secret="${write_secret//\\/\\\\}"
    escaped_secret="${escaped_secret//\"/\\\"}"
    while (( attempt <= max_attempts )); do
        # Supplying the sensitive header over stdin keeps it out of curl's argv.
        http_code=$(print -r -- "header = \"X-Now-Playing-Secret: $escaped_secret\"" | \
            /usr/bin/curl --config - --silent --show-error --output /dev/null \
                --write-out '%{http_code}' --request POST \
                --proto '=https' \
                --header 'Content-Type: application/json' \
                --connect-timeout 5 --max-time 12 \
                --data-binary "@$payload_file" --url "$endpoint" 2>/dev/null)
        curl_exit=$?
        [[ "$http_code" == <200-299> && $curl_exit -eq 0 ]] && return 0

        [[ -z "$http_code" ]] && http_code="000"
        if (( curl_exit == 0 )) && ! is_temporary_status "$http_code"; then
            log_message "Upload rejected by server (HTTP $http_code); not retrying this poll."
            return 1
        fi
        if (( attempt < max_attempts )); then
            log_message "Temporary upload failure (HTTP $http_code); retry $attempt/$((max_attempts - 1))."
            /bin/sleep "$delay"
            delay=$((delay * 2))
        else
            log_message "Temporary upload failure (HTTP $http_code); retry limit reached."
        fi
        attempt=$((attempt + 1))
    done
    return 1
}

final_upload_and_exit() {
    (( shutting_down )) && return
    shutting_down=1
    trap - INT TERM HUP
    log_message "Shutdown requested; attempting final unavailable state."
    if [[ -n "$write_secret" && -n "$endpoint" ]]; then
        local final_temp=$(/usr/bin/mktemp "${TMPDIR:-/tmp}/now-playing-final.XXXXXX")
        /bin/chmod 600 "$final_temp"
        unavailable_payload > "$final_temp"
        preserve_last_track "$final_temp" || true
        upload_payload "$final_temp" 1 || true
        /bin/rm -f "$final_temp"
    fi
    cleanup_temp_files
    log_message "Process stopped."
    exit 0
}

trap final_upload_and_exit INT TERM HUP
trap cleanup_temp_files EXIT

[[ "${1:-}" == "--once" ]] && once_mode=1
load_config || exit 1
/bin/mkdir -p "$INSTALL_DIR"
/bin/chmod 700 "$INSTALL_DIR"
load_last_success
if (( once_mode )); then
    log_message "Process started (one-upload mode)."
else
    log_message "Process started."
fi

while true; do
    current_temp=$(/usr/bin/mktemp "${TMPDIR:-/tmp}/now-playing-current.XXXXXX")
    reader_error_temp=$(/usr/bin/mktemp "${TMPDIR:-/tmp}/now-playing-reader-error.XXXXXX")
    /bin/chmod 600 "$current_temp" "$reader_error_temp"

    if ! "$READER" > "$current_temp" 2> "$reader_error_temp" || ! validate_json "$current_temp"; then
        local_now=$(/bin/date +%s)
        if (( local_now - last_invalid_log >= 30 )); then
            log_message "Invalid local reader JSON; check Automation permission and run the reader manually."
            last_invalid_log=$local_now
        fi
        cleanup_temp_files
        current_temp="" reader_error_temp=""
        (( once_mode )) && exit 1
        /bin/sleep "$POLL_SECONDS"
        continue
    fi

    if ! preserve_last_track "$current_temp"; then
        log_message "Could not apply the private last-track cache; using the live reader payload."
    fi

    fingerprint=$(fingerprint_json "$current_temp")
    if [[ -z "$fingerprint" ]]; then
        log_message "Reader JSON did not match the expected schema."
        cleanup_temp_files
        current_temp="" reader_error_temp=""
        (( once_mode )) && exit 1
        /bin/sleep "$POLL_SECONDS"
        continue
    fi

    player_status=$(json_field "$current_temp" status)
    if [[ "$player_status" == "unavailable" && $unavailable_logged -eq 0 ]]; then
        log_message "Music state unavailable. If this persists, allow Automation access in System Settings > Privacy & Security > Automation."
        unavailable_logged=1
    elif [[ "$player_status" != "unavailable" ]]; then
        unavailable_logged=0
    fi

    now_epoch=$(/bin/date +%s)
    should_upload=0 reason=""
    if (( once_mode )); then
        should_upload=1 reason="manual test"
    elif [[ "$fingerprint" != "$last_fingerprint" ]]; then
        should_upload=1 reason="state change"
    elif [[ "$player_status" == "playing" ]] && (( now_epoch - last_sent_epoch >= HEARTBEAT_SECONDS )); then
        should_upload=1 reason="playing heartbeat"
    fi

    if (( should_upload )); then
        log_message "Detected $reason ($player_status)."
        upload_succeeded=0
        if upload_payload "$current_temp"; then
            save_last_success "$fingerprint" "$now_epoch"
            log_message "Upload succeeded ($player_status)."
            upload_artwork_if_needed "$current_temp" || true
            upload_succeeded=1
        fi
    fi

    cleanup_temp_files
    current_temp="" reader_error_temp=""
    if (( once_mode )); then
        log_message "One-upload mode finished."
        (( upload_succeeded )) && exit 0 || exit 1
    fi
    /bin/sleep "$POLL_SECONDS"
done
