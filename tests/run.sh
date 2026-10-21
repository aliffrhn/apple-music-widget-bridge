#!/bin/zsh

setopt NO_UNSET PIPE_FAIL

readonly ROOT_DIR="${0:A:h:h}"
readonly TEST_DIR=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/now-playing-tests.XXXXXX")
typeset -i passed=0 failed=0

cleanup() {
    /bin/rm -rf "$TEST_DIR"
}
trap cleanup EXIT

record_pass() {
    print -- "ok - $1"
    passed=$((passed + 1))
}

record_fail() {
    print -u2 -- "not ok - $1"
    failed=$((failed + 1))
}

expect_status() {
    local name="$1" expected="$2"
    shift 2
    "$@" > "$TEST_DIR/command.out" 2>&1
    local actual=$?
    if (( actual == expected )); then
        record_pass "$name"
    else
        print -u2 -- "Expected exit $expected, received $actual: $(<"$TEST_DIR/command.out")"
        record_fail "$name"
    fi
}

test_syntax() {
    local script
    for script in "$ROOT_DIR"/*.sh "$ROOT_DIR"/tests/*.sh; do
        /bin/zsh -n "$script" || return 1
    done
    /usr/bin/plutil -lint "$ROOT_DIR/io.github.aliffrhn.apple-music-widget-bridge.plist.template" >/dev/null
}

if test_syntax; then
    record_pass "shell and plist syntax"
else
    record_fail "shell and plist syntax"
fi

if "$ROOT_DIR/now-playing.sh" > "$TEST_DIR/now-playing.json" && \
    /usr/bin/plutil -convert json -o /dev/null -- "$TEST_DIR/now-playing.json" >/dev/null 2>&1; then
    record_pass "reader always returns valid JSON"
else
    record_fail "reader always returns valid JSON"
fi

if [[ "$(/usr/bin/plutil -extract schemaVersion raw -- "$TEST_DIR/now-playing.json" 2>/dev/null)" == "1" ]]; then
    record_pass "reader emits protocol schema version 1"
else
    record_fail "reader emits protocol schema version 1"
fi

expect_status "artwork rejects relative destinations" 2 \
    "$ROOT_DIR/artwork.sh" relative-artwork

print -r -- "must survive" > "$TEST_DIR/existing-artwork"
expect_status "artwork rejects existing destinations" 2 \
    "$ROOT_DIR/artwork.sh" "$TEST_DIR/existing-artwork"
if [[ "$(<"$TEST_DIR/existing-artwork")" == "must survive" ]]; then
    record_pass "artwork preserves existing destination content"
else
    record_fail "artwork preserves existing destination content"
fi

readonly FAKE_HOME="$TEST_DIR/home"
/bin/mkdir -p "$FAKE_HOME/Library/Application Support/NowPlayingSync"
print -r -- "must survive" > "$FAKE_HOME/Library/Application Support/NowPlayingSync/sentinel"

expect_status "installer help exits safely" 0 \
    /usr/bin/env HOME="$FAKE_HOME" "$ROOT_DIR/install.sh" --help
expect_status "installer rejects unknown options" 2 \
    /usr/bin/env HOME="$FAKE_HOME" "$ROOT_DIR/install.sh" --unknown
expect_status "installer rejects invalid endpoints before writing" 1 \
    /usr/bin/env HOME="$FAKE_HOME" "$ROOT_DIR/install.sh" --endpoint http://example.com

# Reinstalling for a different receiver must forget what the old receiver was sent.
readonly RESET_HOME="$TEST_DIR/reset-home"
readonly RESET_DIR="$RESET_HOME/Library/Application Support/NowPlayingSync"
seed_receiver_state() {
    /bin/rm -rf "$RESET_HOME"
    /bin/mkdir -p "$RESET_DIR" "$RESET_HOME/.config/now-playing-sync"
    [[ -n "$1" ]] && print -r -- "NOW_PLAYING_ENDPOINT=$1" > "$RESET_HOME/.config/now-playing-sync/config"
    print -r -- "1" > "$RESET_DIR/last-successful-upload"
    print -r -- "0123456789ABCDEF" > "$RESET_DIR/uploaded-artwork-ids"
    print -r -- '{"title":"Kept"}' > "$RESET_DIR/last-known-track.json"
}
run_reset() {
    /usr/bin/env HOME="$RESET_HOME" NOW_PLAYING_INSTALLER_TEST_RESET="$1" "$ROOT_DIR/install.sh" >/dev/null 2>&1
}
receiver_state_present() {
    [[ -f "$RESET_DIR/last-successful-upload" && -f "$RESET_DIR/uploaded-artwork-ids" ]]
}
receiver_state_absent() {
    [[ ! -e "$RESET_DIR/last-successful-upload" && ! -e "$RESET_DIR/uploaded-artwork-ids" ]]
}
last_track_kept() {
    [[ "$(<"$RESET_DIR/last-known-track.json")" == '{"title":"Kept"}' ]]
}

seed_receiver_state "https://old.example.com/api/now-playing"
if run_reset "https://new.example.com/api/now-playing" && receiver_state_absent && last_track_kept; then
    record_pass "installer resets upload state when the endpoint changes"
else
    record_fail "installer resets upload state when the endpoint changes"
fi

seed_receiver_state "https://same.example.com/api/now-playing"
if run_reset "https://same.example.com/api/now-playing" && receiver_state_present && last_track_kept; then
    record_pass "installer keeps upload state when the endpoint is unchanged"
else
    record_fail "installer keeps upload state when the endpoint is unchanged"
fi

seed_receiver_state ""
if run_reset "https://new.example.com/api/now-playing" && receiver_state_absent && last_track_kept; then
    record_pass "installer resets upload state when no previous config exists"
else
    record_fail "installer resets upload state when no previous config exists"
fi

expect_status "uninstaller help exits safely" 0 \
    /usr/bin/env HOME="$FAKE_HOME" "$ROOT_DIR/uninstall.sh" --help
expect_status "uninstaller rejects unknown options" 2 \
    /usr/bin/env HOME="$FAKE_HOME" "$ROOT_DIR/uninstall.sh" --keep-keychian
if [[ "$(<"$FAKE_HOME/Library/Application Support/NowPlayingSync/sentinel")" == "must survive" ]]; then
    record_pass "safe installer and uninstaller paths preserve existing data"
else
    record_fail "safe installer and uninstaller paths preserve existing data"
fi

expect_status "doctor help exits safely" 0 \
    /usr/bin/env HOME="$FAKE_HOME" "$ROOT_DIR/doctor.sh" --help
expect_status "doctor rejects unknown options" 2 \
    /usr/bin/env HOME="$FAKE_HOME" "$ROOT_DIR/doctor.sh" --unknown

print -r -- "NOW_PLAYING_ENDPOINT=https://example.com/api/now-playing" > "$TEST_DIR/invalid-config"
print -r -- "KEYCHAIN_ACCOUNT=test-account-that-does-not-exist" >> "$TEST_DIR/invalid-config"
print -r -- "NOW_PLAYING_ARTWORK_ENABLED=2" >> "$TEST_DIR/invalid-config"
/bin/chmod 600 "$TEST_DIR/invalid-config"
expect_status "sync rejects invalid artwork configuration" 1 \
    /usr/bin/env NOW_PLAYING_CONFIG="$TEST_DIR/invalid-config" \
    NOW_PLAYING_INSTALL_DIR="$TEST_DIR/runtime" \
    "$ROOT_DIR/sync-now-playing.sh" --once

# End-to-end publish: fake Music readers -> sync-now-playing.sh -> HTTPS receiver.
run_publisher_e2e() {
    local e2e="$TEST_DIR/e2e" secret="e2e-secret-with-at-least-thirty-two-characters"
    local account="now-playing-e2e" port="" receiver_pid="" attempt
    /bin/mkdir -p "$e2e/data" "$e2e/runtime"

    /usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=localhost" \
        -keyout "$e2e/key.pem" -out "$e2e/cert.pem" \
        -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
        -addext "extendedKeyUsage=serverAuth" >/dev/null 2>&1 || return 1

    /usr/bin/security create-keychain -p e2e "$e2e/test.keychain" >/dev/null 2>&1 || return 1
    /usr/bin/security add-generic-password -a "$account" -s "apple-music-widget-bridge" \
        -w "$secret" "$e2e/test.keychain" >/dev/null 2>&1 || return 1

    cat > "$e2e/reader.sh" <<READER
#!/bin/zsh
print -r -- '{"schemaVersion":1,"status":"playing","isPlaying":true,"title":"E2E Song","artist":"E2E Artist","album":"E2E Album","albumArtist":null,"genre":null,"year":2026,"durationSeconds":200,"positionSeconds":12,"persistentId":"0123456789ABCDEF","capturedAt":"'\$(/bin/date -u '+%Y-%m-%dT%H:%M:%S.000Z')'"}'
READER
    cat > "$e2e/artwork.sh" <<'ARTWORK'
#!/bin/zsh
printf '\xff\xd8\xff\xe0\x00\x10\xff\xd9' > "$1"
print -r -- '{"status":"ok","contentType":"image/jpeg","byteCount":8}'
ARTWORK
    /bin/chmod 700 "$e2e/reader.sh" "$e2e/artwork.sh"

    NOW_PLAYING_WRITE_SECRET="$secret" node "$ROOT_DIR/tests/https-receiver.mjs" \
        "$e2e/key.pem" "$e2e/cert.pem" "$e2e/data" "$e2e/port" &
    receiver_pid=$!
    for attempt in {1..50}; do
        [[ -s "$e2e/port" ]] && break
        /bin/sleep 0.1
    done
    port=$(<"$e2e/port")

    {
        print -r -- "NOW_PLAYING_ENDPOINT=https://localhost:$port/api/now-playing"
        print -r -- "KEYCHAIN_ACCOUNT=$account"
        print -r -- "NOW_PLAYING_ARTWORK_ENABLED=1"
    } > "$e2e/config"
    /bin/chmod 600 "$e2e/config"

    local result=0
    /usr/bin/env CURL_CA_BUNDLE="$e2e/cert.pem" \
        NOW_PLAYING_CONFIG="$e2e/config" \
        NOW_PLAYING_INSTALL_DIR="$e2e/runtime" \
        NOW_PLAYING_READER="$e2e/reader.sh" \
        NOW_PLAYING_ARTWORK_READER="$e2e/artwork.sh" \
        NOW_PLAYING_KEYCHAIN="$e2e/test.keychain" \
        "$ROOT_DIR/sync-now-playing.sh" --once >/dev/null 2>&1 || result=1

    if (( result == 0 )); then
        CURL_CA_BUNDLE="$e2e/cert.pem" /usr/bin/curl --silent --fail \
            "https://localhost:$port/api/now-playing" > "$e2e/public.json" || result=1
    fi
    if (( result == 0 )); then
        [[ "$(/usr/bin/plutil -extract title raw -- "$e2e/public.json" 2>/dev/null)" == "E2E Song" ]] || result=1
        [[ "$(/usr/bin/plutil -extract artworkUrl raw -- "$e2e/public.json" 2>/dev/null)" == /api/now-playing/artwork* ]] || result=1
        # The log must not contain the secret or track metadata.
        if /usr/bin/grep -q -e "$secret" -e "E2E Song" "$e2e/runtime/now-playing-sync.log" 2>/dev/null; then
            result=1
        fi
    fi

    kill "$receiver_pid" 2>/dev/null
    wait "$receiver_pid" 2>/dev/null
    /usr/bin/security delete-keychain "$e2e/test.keychain" >/dev/null 2>&1
    return $result
}

if ! command -v node >/dev/null 2>&1; then
    print -- "skip - publisher end-to-end upload (Node.js is not installed)"
elif run_publisher_e2e; then
    record_pass "publisher uploads state and artwork to an HTTPS receiver"
else
    record_fail "publisher uploads state and artwork to an HTTPS receiver"
fi

print -- "$passed passed, $failed failed"
(( failed == 0 ))
