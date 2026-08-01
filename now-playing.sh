#!/bin/zsh

# Read-only Apple Music state reader. stdout is always one JSON object.
/usr/bin/osascript -l JavaScript <<'JXA'
function safe(readProperty) {
    try {
        var value = readProperty();
        return value === undefined ? null : value;
    } catch (_) {
        return null;
    }
}

function textOrNull(value) {
    if (value === null || value === undefined) return null;
    return String(value);
}

function numberOrNull(value) {
    if (value === null || value === "" || typeof value === "boolean") return null;
    var number = Number(value);
    return isFinite(number) ? number : null;
}

function positiveIntegerOrNull(value) {
    var number = numberOrNull(value);
    return number !== null && number > 0 ? Math.floor(number) : null;
}

function emptyPayload(status, capturedAt) {
    return {
        schemaVersion: 1,
        status: status,
        isPlaying: false,
        title: null,
        artist: null,
        album: null,
        albumArtist: null,
        genre: null,
        year: null,
        durationSeconds: null,
        positionSeconds: null,
        persistentId: null,
        capturedAt: capturedAt
    };
}

function main() {
    var capturedAt = new Date().toISOString();
    var music;

    try {
        music = Application("/System/Applications/Music.app");
        if (!music.running()) return emptyPayload("not_open", capturedAt);
    } catch (_) {
        return emptyPayload("unavailable", capturedAt);
    }

    var rawState = safe(function () { return music.playerState(); });
    if (rawState === null) return emptyPayload("unavailable", capturedAt);

    var state = String(rawState).toLowerCase();
    var status = state === "playing" ? "playing" :
        state === "paused" ? "paused" :
        state === "stopped" ? "stopped" : "unavailable";
    var result = emptyPayload(status, capturedAt);
    result.isPlaying = status === "playing";

    if (status === "unavailable") return result;

    var track = safe(function () { return music.currentTrack(); });
    function trackProperty(name) {
        if (track === null) return null;
        return safe(function () {
            var property = track[name];
            return typeof property === "function" ? property() : property;
        });
    }

    result.title = textOrNull(trackProperty("name"));
    result.artist = textOrNull(trackProperty("artist"));
    result.album = textOrNull(trackProperty("album"));
    result.albumArtist = textOrNull(trackProperty("albumArtist"));
    result.genre = textOrNull(trackProperty("genre"));
    result.year = positiveIntegerOrNull(trackProperty("year"));
    result.durationSeconds = numberOrNull(trackProperty("duration"));
    result.positionSeconds = numberOrNull(safe(function () { return music.playerPosition(); }));
    result.persistentId = textOrNull(trackProperty("persistentID"));
    return result;
}

try {
    JSON.stringify(main());
} catch (_) {
    JSON.stringify(emptyPayload("unavailable", new Date().toISOString()));
}
JXA
