#!/bin/zsh

# Extract the current Music track's first artwork without controlling playback.
# Usage: ./artwork.sh /private/path/to/artwork

setopt NO_UNSET PIPE_FAIL

destination="${1:-}"
if [[ -z "$destination" || "$destination" != /* ]]; then
    /usr/bin/osascript -l JavaScript -e 'JSON.stringify({status:"invalid_destination",contentType:null,byteCount:null})'
    exit 2
fi

destination_dir="${destination:h}"
if [[ ! -d "$destination_dir" ]]; then
    /usr/bin/osascript -l JavaScript -e 'JSON.stringify({status:"invalid_destination",contentType:null,byteCount:null})'
    exit 2
fi

if [[ -e "$destination" || -L "$destination" ]]; then
    /usr/bin/osascript -l JavaScript -e 'JSON.stringify({status:"destination_exists",contentType:null,byteCount:null})'
    exit 2
fi

work_file=$(/usr/bin/mktemp "$destination_dir/.now-playing-artwork.XXXXXX")
decoded_file=""
normalized_file=""
/bin/chmod 600 "$work_file"
cleanup() {
    [[ -n "$work_file" ]] && /bin/rm -f "$work_file"
    [[ -n "$decoded_file" ]] && /bin/rm -f "$decoded_file"
    [[ -n "$normalized_file" ]] && /bin/rm -f "$normalized_file"
}
trap cleanup EXIT

result=$(/usr/bin/osascript -l JavaScript -e '
    ObjC.import("Foundation");

    function safe(readValue) {
        try { return readValue(); } catch (_) { return null; }
    }

    function run(argv) {
        var destination = argv[0];
        var music = Application("/System/Applications/Music.app");
        if (!music.running()) return "not_open";

        var track = safe(function () { return music.currentTrack(); });
        if (track === null) return "no_track";

        var artworks = safe(function () { return track.artworks(); });
        if (artworks === null) return "permission_denied";
        if (artworks.length === 0) return "no_artwork";

        var artwork = artworks[0];
        var originalData = safe(function () { return artwork.rawData(); });
        var renderedData = safe(function () { return artwork.data(); });

        // Music normally bridges rawData as NSData. Some releases expose data
        // as NSImage instead, so retain a TIFF fallback for compatibility.
        try {
            if (originalData && originalData.writeToFileAtomically(destination, true)) return "ok";
        } catch (_) {}
        try {
            var bridgedData = $.NSData.dataWithData(originalData);
            if (bridgedData && bridgedData.writeToFileAtomically(destination, true)) return "ok";
        } catch (_) {}
        try {
            var tiffData = renderedData.TIFFRepresentation;
            if (tiffData && tiffData.writeToFileAtomically(destination, true)) return "ok";
        } catch (_) {}
        return "unavailable";
    }' "$work_file" 2>/dev/null) || result="unavailable"

if [[ "$result" != "ok" || ! -s "$work_file" ]]; then
    /usr/bin/osascript -l JavaScript -e \
        'function run(argv){return JSON.stringify({status:argv[0],contentType:null,byteCount:null})}' \
        "$result"
    [[ "$result" == "not_open" || "$result" == "no_track" || "$result" == "no_artwork" ]] && exit 0
    exit 1
fi

# Music may bridge raw Apple-event data as: 'tdta'($FFD8...FFD9$).
# Decode that hex envelope into the original image bytes using macOS xxd.
prefix=$(/usr/bin/head -c 8 "$work_file" 2>/dev/null || true)
if [[ "$prefix" == "'"????"'(\$" ]]; then
    decoded_file=$(/usr/bin/mktemp "$destination_dir/.now-playing-artwork.XXXXXX")
    /bin/chmod 600 "$decoded_file"
    if ! /bin/dd if="$work_file" bs=8 skip=1 2>/dev/null | /usr/bin/xxd -r -p > "$decoded_file"; then
        /usr/bin/osascript -l JavaScript -e 'JSON.stringify({status:"decode_failed",contentType:null,byteCount:null})'
        exit 1
    fi
    /bin/mv -f "$decoded_file" "$work_file"
    decoded_file=""
fi

/bin/chmod 600 "$work_file"
content_type=$(/usr/bin/file -b --mime-type "$work_file" 2>/dev/null || print "application/octet-stream")
byte_count=$(/usr/bin/stat -f '%z' "$work_file" 2>/dev/null || print 0)
if [[ "$content_type" != image/* ]]; then
    /usr/bin/osascript -l JavaScript -e 'JSON.stringify({status:"unsupported_data",contentType:null,byteCount:null})'
    exit 1
fi

# Normalize to a web-safe JPEG around 600x600. This also keeps uploads well
# below the Edge Function's 2 MiB limit for unusually large embedded artwork.
normalized_file=$(/usr/bin/mktemp "$destination_dir/.now-playing-artwork-normalized.XXXXXX")
/bin/chmod 600 "$normalized_file"
if ! /usr/bin/sips -Z 600 -s format jpeg -s formatOptions 85 \
    "$work_file" --out "$normalized_file" >/dev/null 2>&1; then
    /usr/bin/osascript -l JavaScript -e 'JSON.stringify({status:"normalize_failed",contentType:null,byteCount:null})'
    exit 1
fi
/bin/mv -f "$normalized_file" "$work_file"
normalized_file=""
/bin/chmod 600 "$work_file"
content_type=$(/usr/bin/file -b --mime-type "$work_file" 2>/dev/null || print "application/octet-stream")
byte_count=$(/usr/bin/stat -f '%z' "$work_file" 2>/dev/null || print 0)
if [[ "$content_type" != "image/jpeg" || "$byte_count" != <1-2097152> ]]; then
    /usr/bin/osascript -l JavaScript -e 'JSON.stringify({status:"normalized_image_invalid",contentType:null,byteCount:null})'
    exit 1
fi

# Refuse to replace a file that appeared while extraction was in progress.
if [[ -e "$destination" || -L "$destination" ]]; then
    /usr/bin/osascript -l JavaScript -e 'JSON.stringify({status:"destination_exists",contentType:null,byteCount:null})'
    exit 2
fi
if ! /bin/mv -n "$work_file" "$destination" || [[ -e "$work_file" ]]; then
    /usr/bin/osascript -l JavaScript -e 'JSON.stringify({status:"destination_exists",contentType:null,byteCount:null})'
    exit 2
fi
work_file=""
/bin/chmod 600 "$destination"
/usr/bin/osascript -l JavaScript -e '
    function run(argv) {
        return JSON.stringify({
            status: "ok",
            contentType: argv[0],
            byteCount: Number(argv[1])
        });
    }' "$content_type" "$byte_count"
