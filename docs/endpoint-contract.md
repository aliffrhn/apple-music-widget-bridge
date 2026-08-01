# Receiver endpoint contract

Protocol version 1 uses one base URL for private publisher writes and public widget reads. The included receiver uses:

```text
https://example.com/api/now-playing
```

Alternative receiver implementations can use any platform as long as they preserve this HTTP contract.

## State update

```http
POST /api/now-playing
Content-Type: application/json
X-Now-Playing-Secret: <shared secret>
```

The JSON body has the following shape:

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | integer | `1` for this contract |
| `status` | string | `playing`, `paused`, `stopped`, `not_open`, or `unavailable` |
| `isPlaying` | boolean | `true` only when `status` is `playing` |
| `title` | string or null | Current or last known track title |
| `artist` | string or null | Current or last known artist |
| `album` | string or null | Current or last known album |
| `albumArtist` | string or null | Current or last known album artist |
| `genre` | string or null | Current or last known genre |
| `year` | integer or null | Positive release year when Music provides it |
| `durationSeconds` | number or null | Track duration |
| `positionSeconds` | number or null | Position captured at `capturedAt` |
| `persistentId` | string or null | Music's local persistent ID for the track |
| `capturedAt` | ISO 8601 string | Time the local state was read |

Return any `2xx` response when the update has been accepted. The response body is ignored. Receivers should reject an update older than the currently stored `capturedAt` value so a delayed request cannot replace a newer track.

## Artwork upload

After a successful state update for a new persistent ID, the client may send a second request:

```http
POST /api/now-playing
Content-Type: image/jpeg
X-Now-Playing-Secret: <shared secret>
X-Now-Playing-Action: upload-artwork
X-Now-Playing-Persistent-Id: 0123456789ABCDEF

<raw JPEG bytes>
```

The image is normalized to approximately 600×600 and is no larger than 2 MiB. Validate the JPEG signature instead of trusting only `Content-Type`. Accept artwork only when its persistent ID still matches the current state; this prevents a slow upload for the previous song from replacing the new song's artwork.

A successful artwork response must be valid JSON:

```json
{"ok": true}
```

Treat the persistent ID as an opaque local identifier, not as a globally unique Apple catalog ID.

## Public state read

```http
GET /api/now-playing
Accept: application/json
```

The response contains the state fields above plus an `artworkUrl` string or `null`:

```json
{
  "schemaVersion": 1,
  "status": "playing",
  "isPlaying": true,
  "title": "Example Song",
  "artist": "Example Artist",
  "album": "Example Album",
  "albumArtist": "Example Artist",
  "genre": null,
  "year": 2026,
  "durationSeconds": 213.4,
  "positionSeconds": 42.1,
  "persistentId": "0123456789ABCDEF",
  "capturedAt": "2026-08-01T12:00:00.000Z",
  "artworkUrl": "/api/now-playing/artwork?id=0123456789ABCDEF&v=abc123"
}
```

Public responses must never contain the write secret. Supporting `HEAD`, `ETag`, conditional requests, short cache headers, and public read-only CORS is recommended.

## Artwork read

The widget reads the exact URL returned in `artworkUrl`. A receiver must return `404` if the requested identifier no longer matches stored artwork rather than returning artwork for a different track.

## Health check

The included receiver provides:

```http
GET /api/now-playing/health
```

```json
{"ok": true, "version": "0.1.0"}
```

This route is recommended but optional for custom receivers.

## Retry behavior

- State updates retry connection failures, HTTP `408`, `425`, `429`, and `5xx` responses.
- Artwork uploads retry connection failures and non-`4xx` failures up to three attempts.
- Artwork `4xx` responses are treated as receiver or authentication errors and are not retried during that poll.
- The client uses short timeouts, so acknowledge accepted uploads promptly.

## Receiver security checklist

- Require HTTPS on the public URL.
- Compare the shared secret in constant time.
- Return `401` or `403` for invalid credentials.
- Restrict JSON bodies to a small size and artwork bodies to 2 MiB.
- Validate every state field and the actual JPEG signature.
- Reject stale state and mismatched artwork updates.
- Escape all track fields before rendering them in HTML.
- Apply proxy-level rate limits appropriate for the deployment without logging secrets or bodies.
- Store only the history you intend to expose.
