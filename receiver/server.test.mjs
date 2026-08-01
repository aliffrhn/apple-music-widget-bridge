import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHandler, normalizeState } from "./server.mjs";

const SECRET = "test-secret-with-at-least-thirty-two-characters";
const ID = "0123456789ABCDEF";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

function state(overrides = {}) {
  return {
    schemaVersion: 1,
    status: "playing",
    isPlaying: true,
    title: "Example Song",
    artist: "Example Artist",
    album: "Example Album",
    albumArtist: "Example Artist",
    genre: null,
    year: 2026,
    durationSeconds: 200,
    positionSeconds: 42,
    persistentId: ID,
    capturedAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "now-playing-receiver-test-"));
  const handler = await createHandler({ dataDirectory: directory, secret: SECRET, logger: { error() {} } });
  return { directory, handler };
}

function request(path, options = {}) {
  return new Request(`http://localhost${path}`, options);
}

function authenticated(body, headers = {}) {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-now-playing-secret": SECRET,
      ...headers,
    },
    body: typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body),
  };
}

test("normalizes the versioned public schema", () => {
  assert.deepEqual(normalizeState(state(), Date.parse("2026-08-01T12:01:00Z")), state());
});

test("rejects inconsistent or future state", () => {
  assert.throws(() => normalizeState(state({ isPlaying: false })), /isPlaying/);
  assert.throws(
    () => normalizeState(state({ capturedAt: "2030-01-01T00:00:00Z" }), Date.parse("2026-08-01T00:00:00Z")),
    /future/,
  );
});

test("health and initial state are public without exposing secrets", async (t) => {
  const { directory, handler } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const health = await handler(request("/api/now-playing/health"));
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, version: "0.1.0" });
  const current = await handler(request("/api/now-playing"));
  const body = await current.json();
  assert.equal(body.status, "unavailable");
  assert.equal(body.artworkUrl, null);
  assert.equal(JSON.stringify(body).includes(SECRET), false);
});

test("requires the write secret and validates content types", async (t) => {
  const { directory, handler } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const unauthorized = await handler(request("/api/now-playing", {
    method: "POST",
    headers: { "content-type": "application/json", "x-now-playing-secret": "wrong" },
    body: JSON.stringify(state()),
  }));
  assert.equal(unauthorized.status, 401);
  const unsupported = await handler(request("/api/now-playing", authenticated(state(), { "content-type": "text/plain" })));
  assert.equal(unsupported.status, 415);
});

test("stores state atomically and returns an ETag", async (t) => {
  const { directory, handler } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const update = await handler(request("/api/now-playing", authenticated(state())));
  assert.equal(update.status, 200);
  const stored = JSON.parse(await readFile(join(directory, "now-playing.json"), "utf8"));
  assert.equal(stored.title, "Example Song");
  const current = await handler(request("/api/now-playing"));
  assert.equal(current.status, 200);
  const etag = current.headers.get("etag");
  assert.ok(etag);
  const cached = await handler(request("/api/now-playing", { headers: { "if-none-match": etag } }));
  assert.equal(cached.status, 304);
});

test("rejects stale updates", async (t) => {
  const { directory, handler } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  await handler(request("/api/now-playing", authenticated(state({ capturedAt: "2026-08-01T12:01:00Z" }))));
  const stale = await handler(request("/api/now-playing", authenticated(state({ capturedAt: "2026-08-01T12:00:00Z" }))));
  assert.equal(stale.status, 409);
});

test("accepts only matching JPEG artwork and publishes a versioned URL", async (t) => {
  const { directory, handler } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  await handler(request("/api/now-playing", authenticated(state())));
  const artworkHeaders = {
    "content-type": "image/jpeg",
    "x-now-playing-secret": SECRET,
    "x-now-playing-action": "upload-artwork",
    "x-now-playing-persistent-id": ID,
  };
  const invalid = await handler(request("/api/now-playing", { method: "POST", headers: artworkHeaders, body: "not jpeg" }));
  assert.equal(invalid.status, 415);
  const upload = await handler(request("/api/now-playing", { method: "POST", headers: artworkHeaders, body: JPEG }));
  assert.equal(upload.status, 200);
  const current = await handler(request("/api/now-playing"));
  const publicState = await current.json();
  assert.match(publicState.artworkUrl, new RegExp(`id=${ID}`));
  const image = await handler(request(publicState.artworkUrl));
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), JPEG);
});

test("prevents old artwork from racing a newer track", async (t) => {
  const { directory, handler } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  await handler(request("/api/now-playing", authenticated(state({ capturedAt: "2026-08-01T12:00:00Z" }))));
  await handler(request("/api/now-playing", authenticated(state({
    capturedAt: "2026-08-01T12:01:00Z",
    persistentId: "FEDCBA9876543210",
  }))));
  const upload = await handler(request("/api/now-playing", {
    method: "POST",
    headers: {
      "content-type": "image/jpeg",
      "x-now-playing-secret": SECRET,
      "x-now-playing-action": "upload-artwork",
      "x-now-playing-persistent-id": ID,
    },
    body: JPEG,
  }));
  assert.equal(upload.status, 409);
});

test("enforces request size limits", async (t) => {
  const { directory, handler } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const response = await handler(request("/api/now-playing", authenticated("x".repeat(65 * 1024))));
  assert.equal(response.status, 413);
});
