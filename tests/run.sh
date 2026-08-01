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
    /usr/bin/plutil -lint "$ROOT_DIR/com.nomunyom.now-playing-sync.plist.template" >/dev/null
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

print -- "$passed passed, $failed failed"
(( failed == 0 ))
