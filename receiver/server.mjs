import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const VERSION = "0.1.0";
const STATE_PATH = "/api/now-playing";
const ARTWORK_PATH = "/api/now-playing/artwork";
const HEALTH_PATH = "/api/now-playing/health";
const JSON_LIMIT = 64 * 1024;
const ARTWORK_LIMIT = 2 * 1024 * 1024;
const STATUSES = new Set(["playing", "paused", "stopped", "not_open", "unavailable"]);
const TEXT_FIELDS = ["title", "artist", "album", "albumArtist", "genre"];
const NULLABLE_FIELDS = [
  ...TEXT_FIELDS,
  "year",
  "durationSeconds",
  "positionSeconds",
  "persistentId",
];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest();
}

function secretMatches(expected, supplied) {
  if (typeof supplied !== "string" || supplied.length === 0 || supplied.length > 1024) return false;
  return timingSafeEqual(sha256(expected), sha256(supplied));
}

function jsonResponse(body, status = 200, headers = {}) {
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

function nullableText(value, field) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 512) {
    throw new HttpError(400, `${field} must be null or a string no longer than 512 characters`);
  }
  return value;
}

function nullableNumber(value, field, maximum) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new HttpError(400, `${field} is outside the supported range`);
  }
  return value;
}

export function normalizeState(input, now = Date.now()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "The request body must be a JSON object");
  }
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1) {
    throw new HttpError(400, "Unsupported schemaVersion");
  }
  if (!STATUSES.has(input.status)) throw new HttpError(400, "Invalid playback status");
  if (typeof input.isPlaying !== "boolean" || input.isPlaying !== (input.status === "playing")) {
    throw new HttpError(400, "isPlaying must match the playback status");
  }
  const captured = Date.parse(input.capturedAt);
  if (!Number.isFinite(captured) || captured > now + 5 * 60 * 1000) {
    throw new HttpError(400, "capturedAt must be a valid timestamp and not be in the future");
  }

  const state = {
    schemaVersion: 1,
    status: input.status,
    isPlaying: input.isPlaying,
  };
  for (const field of TEXT_FIELDS) state[field] = nullableText(input[field] ?? null, field);

  if (input.year === null || input.year === undefined) {
    state.year = null;
  } else if (Number.isInteger(input.year) && input.year > 0 && input.year <= 9999) {
    state.year = input.year;
  } else {
    throw new HttpError(400, "year must be null or a positive integer");
  }

  state.durationSeconds = nullableNumber(input.durationSeconds ?? null, "durationSeconds", 7 * 24 * 60 * 60);
  state.positionSeconds = nullableNumber(input.positionSeconds ?? null, "positionSeconds", 7 * 24 * 60 * 60);
  if (input.persistentId === null || input.persistentId === undefined) {
    state.persistentId = null;
  } else if (typeof input.persistentId === "string" && /^[0-9a-f]{8,64}$/i.test(input.persistentId)) {
    state.persistentId = input.persistentId.toUpperCase();
  } else {
    throw new HttpError(400, "persistentId must be null or 8-64 hexadecimal characters");
  }
  state.capturedAt = new Date(captured).toISOString();
  return state;
}

async function readBody(request, limit) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, "Request body is too large");
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new HttpError(413, "Request body is too large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function atomicWrite(path, data) {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, data, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

class Store {
  constructor(dataDirectory) {
    this.directory = dataDirectory;
    this.statePath = join(dataDirectory, "now-playing.json");
    this.artworkMetaPath = join(dataDirectory, "artwork.json");
    this.state = null;
    this.artwork = null;
    this.queue = Promise.resolve();
  }

  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    try {
      this.state = normalizeState(JSON.parse(await readFile(this.statePath, "utf8")));
    } catch {
      this.state = null;
    }
    try {
      const artwork = JSON.parse(await readFile(this.artworkMetaPath, "utf8"));
      if (
        typeof artwork.persistentId === "string" &&
        typeof artwork.filename === "string" &&
        /^artwork-[0-9a-f]{64}\.jpg$/.test(artwork.filename) &&
        typeof artwork.etag === "string"
      ) {
        await readFile(join(this.directory, artwork.filename));
        this.artwork = artwork;
      }
    } catch {
      this.artwork = null;
    }
  }

  serialize(operation) {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => {});
    return result;
  }

  async setState(state) {
    return this.serialize(async () => {
      if (this.state && Date.parse(state.capturedAt) < Date.parse(this.state.capturedAt)) {
        throw new HttpError(409, "The update is older than the currently stored state");
      }
      await atomicWrite(this.statePath, `${JSON.stringify(state)}\n`);
      this.state = state;
    });
  }

  async setArtwork(persistentId, bytes) {
    return this.serialize(async () => {
      if (!this.state?.persistentId || this.state.persistentId !== persistentId) {
        throw new HttpError(409, "Artwork does not match the current track");
      }
      const digest = createHash("sha256").update(bytes).digest("hex");
      const filename = `artwork-${digest}.jpg`;
      const path = join(this.directory, filename);
      try {
        await readFile(path);
      } catch {
        await atomicWrite(path, bytes);
      }
      const previous = this.artwork?.filename;
      const metadata = {
        persistentId,
        filename,
        contentType: "image/jpeg",
        etag: `\"${digest}\"`,
      };
      await atomicWrite(this.artworkMetaPath, `${JSON.stringify(metadata)}\n`);
      this.artwork = metadata;
      if (previous && previous !== filename) await unlink(join(this.directory, previous)).catch(() => {});
      return metadata;
    });
  }

  publicState() {
    const state = this.state ?? {
      schemaVersion: 1,
      status: "unavailable",
      isPlaying: false,
      ...Object.fromEntries(NULLABLE_FIELDS.map((field) => [field, null])),
      capturedAt: new Date(0).toISOString(),
    };
    const hasArtwork = Boolean(
      state.persistentId && this.artwork && this.artwork.persistentId === state.persistentId,
    );
    return {
      ...state,
      artworkUrl: hasArtwork
        ? `${ARTWORK_PATH}?id=${encodeURIComponent(state.persistentId)}&v=${this.artwork.filename.slice(8, 20)}`
        : null,
    };
  }

  async getArtwork(persistentId) {
    if (
      !persistentId ||
      !this.artwork ||
      this.artwork.persistentId !== persistentId ||
      this.state?.persistentId !== persistentId
    ) return null;
    return { ...this.artwork, bytes: await readFile(join(this.directory, this.artwork.filename)) };
  }
}

function validJpeg(bytes) {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export async function createHandler({ dataDirectory, secret, logger = console }) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("NOW_PLAYING_WRITE_SECRET must contain at least 32 characters");
  }
  const store = new Store(dataDirectory);
  await store.initialize();

  return async function handler(request) {
    const url = new URL(request.url);
    try {
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

      if ((request.method === "GET" || request.method === "HEAD") && url.pathname === HEALTH_PATH) {
        return jsonResponse(
          { ok: true, version: VERSION },
          200,
          { "cache-control": "no-store", "access-control-allow-origin": "*" },
        );
      }

      if ((request.method === "GET" || request.method === "HEAD") && url.pathname === STATE_PATH) {
        const body = store.publicState();
        const serialized = JSON.stringify(body);
        const etag = `\"${createHash("sha256").update(serialized).digest("hex")}\"`;
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

      if ((request.method === "GET" || request.method === "HEAD") && url.pathname === ARTWORK_PATH) {
        const artwork = await store.getArtwork(url.searchParams.get("id"));
        if (!artwork) throw new HttpError(404, "Artwork was not found");
        if (request.headers.get("if-none-match") === artwork.etag) {
          return new Response(null, { status: 304, headers: { etag: artwork.etag } });
        }
        return new Response(request.method === "HEAD" ? null : artwork.bytes, {
          headers: {
            "content-type": artwork.contentType,
            "content-length": String(artwork.bytes.length),
            "cache-control": "public, max-age=86400, immutable",
            "access-control-allow-origin": "*",
            "x-content-type-options": "nosniff",
            etag: artwork.etag,
          },
        });
      }

      if (request.method === "POST" && url.pathname === STATE_PATH) {
        if (!secretMatches(secret, request.headers.get("x-now-playing-secret"))) {
          throw new HttpError(401, "Invalid write credentials");
        }
        if (request.headers.get("x-now-playing-action") === "upload-artwork") {
          if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "image/jpeg") {
            throw new HttpError(415, "Artwork must be an image/jpeg upload");
          }
          const persistentId = request.headers.get("x-now-playing-persistent-id")?.toUpperCase();
          if (!persistentId || !/^[0-9A-F]{8,64}$/.test(persistentId)) {
            throw new HttpError(400, "Invalid artwork persistent ID");
          }
          const bytes = await readBody(request, ARTWORK_LIMIT);
          if (!validJpeg(bytes)) throw new HttpError(415, "Artwork bytes are not a JPEG image");
          await store.setArtwork(persistentId, bytes);
          return jsonResponse({ ok: true }, 200, { "cache-control": "no-store" });
        }

        if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") {
          throw new HttpError(415, "State updates must use application/json");
        }
        const bytes = await readBody(request, JSON_LIMIT);
        let input;
        try {
          input = JSON.parse(bytes.toString("utf8"));
        } catch {
          throw new HttpError(400, "The request body is not valid JSON");
        }
        const state = normalizeState(input);
        await store.setState(state);
        return jsonResponse({ ok: true }, 200, { "cache-control": "no-store" });
      }

      if (url.pathname.startsWith(STATE_PATH)) {
        return jsonResponse({ error: "Method not allowed" }, 405, { allow: "GET, HEAD, POST, OPTIONS" });
      }
      throw new HttpError(404, "Not found");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) logger.error?.("receiver_request_failed", { method: request.method, path: url.pathname });
      return jsonResponse(
        { error: status >= 500 ? "Internal server error" : error.message },
        status,
        { "cache-control": "no-store" },
      );
    }
  };
}

export async function createReceiver(options) {
  const handler = await createHandler(options);
  const server = createServer(async (request, response) => {
    const origin = `http://${request.headers.host ?? "localhost"}`;
    const webRequest = new Request(new URL(request.url ?? "/", origin), {
      method: request.method,
      headers: request.headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request,
      duplex: "half",
    });
    const webResponse = await handler(webRequest);
    response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
    if (webResponse.body) {
      for await (const chunk of webResponse.body) response.write(chunk);
    }
    response.end();
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number.parseInt(process.env.PORT ?? "8787", 10);
  const dataDirectory = process.env.NOW_PLAYING_DATA_DIR ?? "/data";
  const secret = process.env.NOW_PLAYING_WRITE_SECRET;
  const server = await createReceiver({ dataDirectory, secret });
  server.listen(port, host, () => console.log(`Now Playing receiver listening on http://${host}:${port}`));
  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
