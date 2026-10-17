// Implements the receiver endpoint contract (docs/endpoint-contract.md) on
// top of a storage backend, so the same routing and validation can run on
// Supabase Edge Functions or in tests.

export const VERSION = "0.2.0";

const JSON_LIMIT = 64 * 1024;
const ARTWORK_LIMIT = 2 * 1024 * 1024;
const STATUSES = new Set(["playing", "paused", "stopped", "not_open", "unavailable"]);
const TEXT_FIELDS = ["title", "artist", "album", "albumArtist", "genre"] as const;

export type Status = "playing" | "paused" | "stopped" | "not_open" | "unavailable";

export interface NowPlayingState {
  schemaVersion: 1;
  status: Status;
  isPlaying: boolean;
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  genre: string | null;
  year: number | null;
  durationSeconds: number | null;
  positionSeconds: number | null;
  persistentId: string | null;
  capturedAt: string;
}

export interface StoredState {
  state: NowPlayingState;
  artworkPersistentId: string | null;
  artworkPath: string | null;
}

export interface Store {
  readState(): Promise<StoredState | null>;
  // Saves the state unless the stored capturedAt is newer. Returns false for
  // a stale update.
  writeState(state: NowPlayingState): Promise<boolean>;
  uploadArtwork(path: string, bytes: Uint8Array): Promise<void>;
  // Points the current state at the artwork only while its persistent ID
  // still matches. Returns false when the track has changed.
  linkArtwork(persistentId: string, path: string): Promise<boolean>;
  deleteArtwork(path: string): Promise<void>;
  artworkUrl(path: string): string;
}

export interface HandlerOptions {
  store: Store;
  secret: string | undefined;
  logger?: { error?: (message: string, details?: Record<string, unknown>) => void };
  // Lets slow cleanup outlive the response, such as EdgeRuntime.waitUntil.
  waitUntil?: (promise: Promise<unknown>) => void;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const encoder = new TextEncoder();

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function secretMatches(expected: string, supplied: string | null): Promise<boolean> {
  if (typeof supplied !== "string" || supplied.length === 0 || supplied.length > 1024) return false;
  const [left, right] = await Promise.all([sha256(encoder.encode(expected)), sha256(encoder.encode(supplied))]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
      "referrer-policy": "no-referrer",
      ...headers,
    },
  });
}

function nullableText(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 512) {
    throw new HttpError(400, `${field} must be null or a string no longer than 512 characters`);
  }
  return value;
}

function nullableNumber(value: unknown, field: string, maximum: number): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new HttpError(400, `${field} is outside the supported range`);
  }
  return value;
}

export function normalizeState(input: unknown, now = Date.now()): NowPlayingState {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "The request body must be a JSON object");
  }
  const body = input as Record<string, unknown>;
  if (body.schemaVersion !== undefined && body.schemaVersion !== 1) {
    throw new HttpError(400, "Unsupported schemaVersion");
  }
  if (typeof body.status !== "string" || !STATUSES.has(body.status)) {
    throw new HttpError(400, "Invalid playback status");
  }
  if (typeof body.isPlaying !== "boolean" || body.isPlaying !== (body.status === "playing")) {
    throw new HttpError(400, "isPlaying must match the playback status");
  }
  const captured = typeof body.capturedAt === "string" ? Date.parse(body.capturedAt) : NaN;
  if (!Number.isFinite(captured) || captured > now + 5 * 60 * 1000) {
    throw new HttpError(400, "capturedAt must be a valid timestamp and not be in the future");
  }

  const text = Object.fromEntries(
    TEXT_FIELDS.map((field) => [field, nullableText(body[field] ?? null, field)]),
  ) as Record<(typeof TEXT_FIELDS)[number], string | null>;

  let year: number | null;
  if (body.year === null || body.year === undefined) {
    year = null;
  } else if (Number.isInteger(body.year) && (body.year as number) > 0 && (body.year as number) <= 9999) {
    year = body.year as number;
  } else {
    throw new HttpError(400, "year must be null or a positive integer");
  }

  let persistentId: string | null;
  if (body.persistentId === null || body.persistentId === undefined) {
    persistentId = null;
  } else if (typeof body.persistentId === "string" && /^[0-9a-f]{8,64}$/i.test(body.persistentId)) {
    persistentId = body.persistentId.toUpperCase();
  } else {
    throw new HttpError(400, "persistentId must be null or 8-64 hexadecimal characters");
  }

  return {
    schemaVersion: 1,
    status: body.status as Status,
    isPlaying: body.isPlaying,
    ...text,
    year,
    durationSeconds: nullableNumber(body.durationSeconds ?? null, "durationSeconds", 7 * 24 * 60 * 60),
    positionSeconds: nullableNumber(body.positionSeconds ?? null, "positionSeconds", 7 * 24 * 60 * 60),
    persistentId,
    capturedAt: new Date(captured).toISOString(),
  };
}

export function emptyState(): NowPlayingState {
  return {
    schemaVersion: 1,
    status: "unavailable",
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
    capturedAt: new Date(0).toISOString(),
  };
}

async function readBody(request: Request, limit: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, "Request body is too large");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new HttpError(413, "Request body is too large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function validJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function mediaType(request: Request): string | undefined {
  return request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
}

function currentArtwork(stored: StoredState | null): string | null {
  const persistentId = stored?.state.persistentId;
  if (!persistentId || stored.artworkPersistentId !== persistentId || !stored.artworkPath) return null;
  return stored.artworkPath;
}

// Supabase passes requests to the function as /<function-name>/<route>. The
// optional /functions/v1 prefix covers proxies that forward the public path.
// Ignoring the function name keeps the routes working under any slug.
function routeOf(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "functions" && segments[1] === "v1") segments.splice(0, 2);
  if (segments.length === 0) return null;
  return segments.slice(1).join("/");
}

export function createHandler({ store, secret, logger = console, waitUntil }: HandlerOptions) {
  const secretConfigured = typeof secret === "string" && secret.length >= 32;
  if (!secretConfigured) {
    logger.error?.("BRIDGE_NOW_PLAYING_WRITE_SECRET must contain at least 32 characters; writes are disabled");
  }

  function defer(promise: Promise<unknown>) {
    const guarded = promise.catch(() => logger.error?.("receiver_artwork_cleanup_failed"));
    if (waitUntil) waitUntil(guarded);
    return waitUntil ? Promise.resolve() : guarded;
  }

  async function updateState(request: Request): Promise<Response> {
    if (mediaType(request) !== "application/json") {
      throw new HttpError(415, "State updates must use application/json");
    }
    const bytes = await readBody(request, JSON_LIMIT);
    let input: unknown;
    try {
      input = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new HttpError(400, "The request body is not valid JSON");
    }
    const state = normalizeState(input);
    if (!await store.writeState(state)) {
      throw new HttpError(409, "The update is older than the currently stored state");
    }
    return jsonResponse({ ok: true }, 200, { "cache-control": "no-store" });
  }

  async function uploadArtwork(request: Request): Promise<Response> {
    if (mediaType(request) !== "image/jpeg") {
      throw new HttpError(415, "Artwork must be an image/jpeg upload");
    }
    const persistentId = request.headers.get("x-now-playing-persistent-id")?.toUpperCase();
    if (!persistentId || !/^[0-9A-F]{8,64}$/.test(persistentId)) {
      throw new HttpError(400, "Invalid artwork persistent ID");
    }
    const bytes = await readBody(request, ARTWORK_LIMIT);
    if (!validJpeg(bytes)) throw new HttpError(415, "Artwork bytes are not a JPEG image");

    const stored = await store.readState();
    if (stored?.state.persistentId !== persistentId) {
      throw new HttpError(409, "Artwork does not match the current track");
    }
    // Content-addressed paths make each public URL immutable, so the storage
    // CDN can cache it and a stale URL never shows another track's artwork.
    const path = `${persistentId}/${hex(await sha256(bytes))}.jpg`;
    if (currentArtwork(stored) === path) return jsonResponse({ ok: true }, 200, { "cache-control": "no-store" });

    await store.uploadArtwork(path, bytes);
    if (!await store.linkArtwork(persistentId, path)) {
      await defer(store.deleteArtwork(path));
      throw new HttpError(409, "Artwork does not match the current track");
    }
    if (stored.artworkPath && stored.artworkPath !== path) await defer(store.deleteArtwork(stored.artworkPath));
    return jsonResponse({ ok: true }, 200, { "cache-control": "no-store" });
  }

  async function publicState(request: Request): Promise<Response> {
    const stored = await store.readState();
    const path = currentArtwork(stored);
    const body = { ...(stored?.state ?? emptyState()), artworkUrl: path ? store.artworkUrl(path) : null };
    const serialized = JSON.stringify(body);
    const etag = `"${hex(await sha256(encoder.encode(serialized)))}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { etag, "access-control-allow-origin": "*" } });
    }
    return new Response(request.method === "HEAD" ? null : serialized, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=3, s-maxage=5, stale-while-revalidate=15",
        "access-control-allow-origin": "*",
        "x-content-type-options": "nosniff",
        etag,
      },
    });
  }

  // artworkUrl already points at the public Storage object. This route gives
  // clients a receiver-relative URL that 404s once the track has changed.
  async function artworkRedirect(url: URL): Promise<Response> {
    const stored = await store.readState();
    const path = currentArtwork(stored);
    const id = url.searchParams.get("id")?.toUpperCase();
    if (!path || !id || id !== stored?.state.persistentId) throw new HttpError(404, "Artwork was not found");
    return new Response(null, {
      status: 302,
      headers: {
        location: store.artworkUrl(path),
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    });
  }

  return async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = routeOf(url.pathname);
    const read = request.method === "GET" || request.method === "HEAD";
    try {
      if (route === null) throw new HttpError(404, "Not found");

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            allow: "GET, HEAD, POST, OPTIONS",
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, HEAD, OPTIONS",
          },
        });
      }

      if (read && route === "health") {
        return jsonResponse(
          { ok: true, version: VERSION },
          200,
          { "cache-control": "no-store", "access-control-allow-origin": "*" },
        );
      }

      if (read && route === "") return await publicState(request);
      if (read && route === "artwork") return await artworkRedirect(url);

      if (request.method === "POST" && route === "") {
        if (!secretConfigured) throw new HttpError(503, "The receiver write secret is not configured");
        if (!await secretMatches(secret as string, request.headers.get("x-now-playing-secret"))) {
          throw new HttpError(401, "Invalid write credentials");
        }
        const action = request.headers.get("x-now-playing-action");
        if (action === "upload-artwork") return await uploadArtwork(request);
        if (action !== null) throw new HttpError(400, "Unsupported X-Now-Playing-Action value");
        return await updateState(request);
      }

      if (route === "" || route === "artwork" || route === "health") {
        return jsonResponse({ error: "Method not allowed" }, 405, { allow: "GET, HEAD, POST, OPTIONS" });
      }
      throw new HttpError(404, "Not found");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) logger.error?.("receiver_request_failed", { method: request.method, path: url.pathname });
      return jsonResponse(
        { error: status === 500 ? "Internal server error" : (error as Error).message },
        status,
        { "cache-control": "no-store" },
      );
    }
  };
}
