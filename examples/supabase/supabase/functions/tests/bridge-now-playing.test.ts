import { assert, assertEquals, assertMatch, assertThrows } from "jsr:@std/assert@1";
import { createHandler, normalizeState, VERSION } from "../bridge-now-playing/handler.ts";
import { BUCKET, createSupabaseStore, TABLE } from "../bridge-now-playing/supabase.ts";

const SECRET = "test-secret-with-at-least-thirty-two-characters";
const KEY = "test-service-role-key";
const SUPABASE_URL = "https://project.supabase.test";
const ID = "0123456789ABCDEF";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
const OTHER_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x20, 0xff, 0xd9]);

function state(overrides: Record<string, unknown> = {}) {
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

type Row = Record<string, unknown>;

function seedRow(): Row {
  return {
    id: "current",
    status: "unavailable",
    is_playing: false,
    title: null,
    artist: null,
    album: null,
    album_artist: null,
    genre: null,
    year: null,
    duration_seconds: null,
    position_seconds: null,
    persistent_id: null,
    captured_at: "1970-01-01T00:00:00+00:00",
    artwork_persistent_id: null,
    artwork_path: null,
  };
}

// Emulates the PostgREST and Storage endpoints the store uses, with the same
// filter semantics as the database, so the real store code is exercised.
function fakeSupabase() {
  const db = { row: seedRow() as Row | null, failReads: false };
  const objects = new Map<string, Uint8Array>();
  const calls: string[] = [];

  function matches(row: Row, params: URLSearchParams) {
    for (const [column, filter] of params) {
      if (column === "select") continue;
      const [operator, ...rest] = filter.split(".");
      const value = rest.join(".");
      if (operator === "eq" && row[column] !== value) return false;
      if (operator === "lte" && !(Date.parse(row[column] as string) <= Date.parse(value))) return false;
    }
    return true;
  }

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push(`${request.method} ${url.pathname}`);
    if (request.headers.get("apikey") !== KEY || request.headers.get("authorization") !== `Bearer ${KEY}`) {
      return json({ message: "Invalid API key" }, 401);
    }

    if (url.pathname === `/rest/v1/${TABLE}`) {
      if (db.failReads) return json({ message: "unavailable" }, 503);
      const row = db.row;
      if (request.method === "GET") return json(row && matches(row, url.searchParams) ? [row] : []);
      if (request.method === "PATCH") {
        if (!row || !matches(row, url.searchParams)) return json([]);
        Object.assign(row, await request.json());
        return json([row]);
      }
      if (request.method === "POST") {
        assertMatch(request.headers.get("prefer") ?? "", /resolution=ignore-duplicates/);
        if (row) return json([], 201);
        db.row = { ...seedRow(), ...(await request.json()) };
        return json([db.row], 201);
      }
    }

    const publicPrefix = `/storage/v1/object/public/${BUCKET}/`;
    if (request.method === "GET" && url.pathname.startsWith(publicPrefix)) {
      const bytes = objects.get(url.pathname.slice(publicPrefix.length));
      return bytes
        ? new Response(bytes as BodyInit, { headers: { "content-type": "image/jpeg" } })
        : json({ error: "not_found" }, 400);
    }
    const objectPrefix = `/storage/v1/object/${BUCKET}/`;
    if (request.method === "POST" && url.pathname.startsWith(objectPrefix)) {
      assertEquals(request.headers.get("x-upsert"), "true");
      assertEquals(request.headers.get("content-type"), "image/jpeg");
      objects.set(url.pathname.slice(objectPrefix.length), new Uint8Array(await request.arrayBuffer()));
      return json({ Key: url.pathname.slice("/storage/v1/object/".length) });
    }
    if (request.method === "DELETE" && url.pathname === `/storage/v1/object/${BUCKET}`) {
      const { prefixes } = await request.json() as { prefixes: string[] };
      for (const path of prefixes) objects.delete(path);
      return json([]);
    }
    return json({ message: "unexpected request" }, 500);
  };

  return { db, objects, calls, fetch: fetchImpl as typeof fetch };
}

function fixture({ secret }: { secret: string | undefined } = { secret: SECRET }) {
  const supabase = fakeSupabase();
  const store = createSupabaseStore({ url: SUPABASE_URL, key: KEY, fetch: supabase.fetch });
  const handler = createHandler({ store, secret, logger: { error() {} } });
  return { supabase, handler };
}

// Supabase passes requests to the function as /<function-name>/<route>.
function request(path: string, options: RequestInit = {}) {
  return new Request(`http://localhost/bridge-now-playing${path}`, options);
}

function authenticated(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-now-playing-secret": SECRET,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

function artwork(bytes: Uint8Array | string, persistentId = ID): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "image/jpeg",
      "x-now-playing-secret": SECRET,
      "x-now-playing-action": "upload-artwork",
      "x-now-playing-persistent-id": persistentId,
    },
    body: bytes as BodyInit,
  };
}

Deno.test("normalizes the versioned public schema", () => {
  assertEquals<unknown>(normalizeState(state(), Date.parse("2026-08-01T12:01:00Z")), state());
});

Deno.test("rejects inconsistent or future state", () => {
  assertThrows(() => normalizeState(state({ isPlaying: false })), Error, "isPlaying");
  assertThrows(
    () => normalizeState(state({ capturedAt: "2030-01-01T00:00:00Z" }), Date.parse("2026-08-01T00:00:00Z")),
    Error,
    "future",
  );
});

Deno.test("health and initial state are public without exposing secrets", async () => {
  const { handler } = fixture();
  const health = await handler(request("/health"));
  assertEquals(health.status, 200);
  assertEquals(await health.json(), { ok: true, version: VERSION });
  const current = await handler(request(""));
  assertEquals(current.headers.get("access-control-allow-origin"), "*");
  const body = await current.json();
  assertEquals(body.schemaVersion, 1);
  assertEquals(body.status, "unavailable");
  assertEquals(body.capturedAt, "1970-01-01T00:00:00.000Z");
  assertEquals(body.artworkUrl, null);
  assertEquals(JSON.stringify(body).includes(SECRET), false);
  assertEquals(JSON.stringify(body).includes(KEY), false);
});

Deno.test("requires the write secret and validates content types", async () => {
  const { handler } = fixture();
  const unauthorized = await handler(request("", {
    method: "POST",
    headers: { "content-type": "application/json", "x-now-playing-secret": "wrong" },
    body: JSON.stringify(state()),
  }));
  assertEquals(unauthorized.status, 401);
  const missing = await handler(request("", { method: "POST", headers: { "content-type": "application/json" } }));
  assertEquals(missing.status, 401);
  const unsupported = await handler(request("", authenticated(state(), { "content-type": "text/plain" })));
  assertEquals(unsupported.status, 415);
  const invalid = await handler(request("", authenticated(state({ status: "rewinding" }))));
  assertEquals(invalid.status, 400);
});

Deno.test("refuses writes until a long enough secret is configured", async () => {
  for (const secret of [undefined, "too-short"]) {
    const { supabase, handler } = fixture({ secret });
    const response = await handler(request("", authenticated(state(), { "x-now-playing-secret": secret ?? "" })));
    assertEquals(response.status, 503);
    assertEquals(supabase.db.row?.title, null);
    assertEquals((await handler(request(""))).status, 200);
  }
});

Deno.test("stores state and returns an ETag", async () => {
  const { supabase, handler } = fixture();
  const update = await handler(request("", authenticated(state({ persistentId: "0123456789abcdef" }))));
  assertEquals(update.status, 200);
  assertEquals(await update.json(), { ok: true });
  assertEquals(supabase.db.row?.title, "Example Song");
  assertEquals(supabase.db.row?.album_artist, "Example Artist");
  assertEquals(supabase.db.row?.persistent_id, ID);
  const current = await handler(request(""));
  assertEquals(current.status, 200);
  assertEquals(await current.json(), { ...state(), artworkUrl: null });
  const etag = current.headers.get("etag");
  assert(etag);
  const cached = await handler(request("", { headers: { "if-none-match": etag } }));
  assertEquals(cached.status, 304);
  const head = await handler(request("", { method: "HEAD" }));
  assertEquals(head.status, 200);
  assertEquals(head.headers.get("etag"), etag);
  assertEquals(await head.text(), "");
});

Deno.test("rejects stale updates", async () => {
  const { supabase, handler } = fixture();
  await handler(request("", authenticated(state({ capturedAt: "2026-08-01T12:01:00Z", title: "Newer" }))));
  const stale = await handler(request("", authenticated(state({ capturedAt: "2026-08-01T12:00:00Z", title: "Older" }))));
  assertEquals(stale.status, 409);
  assertEquals(supabase.db.row?.title, "Newer");
  const same = await handler(request("", authenticated(state({ capturedAt: "2026-08-01T12:01:00Z", title: "Same time" }))));
  assertEquals(same.status, 200);
});

Deno.test("recreates the state row if it was deleted", async () => {
  const { supabase, handler } = fixture();
  supabase.db.row = null;
  assertEquals((await (await handler(request(""))).json()).status, "unavailable");
  const update = await handler(request("", authenticated(state())));
  assertEquals(update.status, 200);
  const recreated = supabase.db.row as Row | null;
  assertEquals(recreated?.id, "current");
  assertEquals(recreated?.title, "Example Song");
});

Deno.test("accepts only matching JPEG artwork and publishes a Storage URL", async () => {
  const { supabase, handler } = fixture();
  await handler(request("", authenticated(state())));
  const wrongType = await handler(request("", { ...artwork(JPEG), headers: { ...artwork(JPEG).headers, "content-type": "image/png" } }));
  assertEquals(wrongType.status, 415);
  const invalid = await handler(request("", artwork("not jpeg")));
  assertEquals(invalid.status, 415);
  const badId = await handler(request("", artwork(JPEG, "not-hex")));
  assertEquals(badId.status, 400);
  assertEquals(supabase.objects.size, 0);

  const upload = await handler(request("", artwork(JPEG)));
  assertEquals(upload.status, 200);
  assertEquals(await upload.json(), { ok: true });
  const publicState = await (await handler(request(""))).json();
  assertMatch(publicState.artworkUrl, new RegExp(`^${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${ID}/[0-9a-f]{64}\\.jpg$`));
  const image = await supabase.fetch(publicState.artworkUrl, { headers: { apikey: KEY, authorization: `Bearer ${KEY}` } });
  assertEquals(image.status, 200);
  assertEquals(new Uint8Array(await image.arrayBuffer()), JPEG);

  const redirect = await handler(request(`/artwork?id=${ID}`));
  assertEquals(redirect.status, 302);
  assertEquals(redirect.headers.get("location"), publicState.artworkUrl);
  assertEquals((await handler(request("/artwork?id=FEDCBA9876543210"))).status, 404);
});

Deno.test("prevents old artwork from racing a newer track", async () => {
  const { supabase, handler } = fixture();
  await handler(request("", authenticated(state({ capturedAt: "2026-08-01T12:00:00Z" }))));
  await handler(request("", authenticated(state({
    capturedAt: "2026-08-01T12:01:00Z",
    persistentId: "FEDCBA9876543210",
  }))));
  const upload = await handler(request("", artwork(JPEG)));
  assertEquals(upload.status, 409);
  assertEquals(supabase.objects.size, 0);
});

Deno.test("removes an upload that loses the race with a track change", async () => {
  const { supabase, handler } = fixture();
  await handler(request("", authenticated(state())));
  // Change the track between the handler's match check and the link update.
  const racingFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const response = await supabase.fetch(input, init);
    const { method, url } = new Request(input, init);
    if (method === "POST" && new URL(url).pathname.startsWith("/storage/")) {
      supabase.db.row!.persistent_id = "FEDCBA9876543210";
    }
    return response;
  }) as typeof fetch;
  const store = createSupabaseStore({ url: SUPABASE_URL, key: KEY, fetch: racingFetch });
  const racing = createHandler({ store, secret: SECRET, logger: { error() {} } });
  const upload = await racing(request("", artwork(JPEG)));
  assertEquals(upload.status, 409);
  assertEquals(supabase.objects.size, 0);
  assertEquals(supabase.db.row?.artwork_path, null);
});

Deno.test("hides artwork after a track change and replaces the old object", async () => {
  const { supabase, handler } = fixture();
  await handler(request("", authenticated(state({ capturedAt: "2026-08-01T12:00:00Z" }))));
  await handler(request("", artwork(JPEG)));
  const [firstPath] = supabase.objects.keys();

  const nextId = "FEDCBA9876543210";
  await handler(request("", authenticated(state({ capturedAt: "2026-08-01T12:04:00Z", persistentId: nextId }))));
  assertEquals((await (await handler(request(""))).json()).artworkUrl, null);
  assertEquals((await handler(request(`/artwork?id=${ID}`))).status, 404);

  assertEquals((await handler(request("", artwork(OTHER_JPEG, nextId)))).status, 200);
  assertEquals([...supabase.objects.keys()].length, 1);
  assertEquals(supabase.objects.has(firstPath), false);
  assertMatch((await (await handler(request(""))).json()).artworkUrl, new RegExp(`/${nextId}/`));
});

Deno.test("skips re-uploading identical artwork", async () => {
  const { supabase, handler } = fixture();
  await handler(request("", authenticated(state())));
  await handler(request("", artwork(JPEG)));
  const uploads = supabase.calls.filter((call) => call.startsWith("POST /storage/")).length;
  assertEquals((await handler(request("", artwork(JPEG)))).status, 200);
  assertEquals(supabase.calls.filter((call) => call.startsWith("POST /storage/")).length, uploads);
});

Deno.test("enforces request size limits", async () => {
  const { handler } = fixture();
  const response = await handler(request("", authenticated("x".repeat(65 * 1024))));
  assertEquals(response.status, 413);
  const large = await handler(request("", artwork(new Uint8Array(2 * 1024 * 1024 + 1))));
  assertEquals(large.status, 413);
});

Deno.test("routes under any function name and supports CORS preflight", async () => {
  const { handler } = fixture();
  const renamed = await handler(new Request("http://localhost/functions/v1/now-playing/health"));
  assertEquals(renamed.status, 200);
  const preflight = await handler(request("", { method: "OPTIONS" }));
  assertEquals(preflight.status, 204);
  assertEquals(preflight.headers.get("access-control-allow-origin"), "*");
  assertEquals((await handler(request("", { method: "PUT" }))).status, 405);
  assertEquals((await handler(request("/unknown"))).status, 404);
  assertEquals((await handler(new Request("http://localhost/"))).status, 404);
});

Deno.test("hides backend failures behind a generic error", async () => {
  const { supabase, handler } = fixture();
  supabase.db.failReads = true;
  const response = await handler(request(""));
  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: "Internal server error" });
});
