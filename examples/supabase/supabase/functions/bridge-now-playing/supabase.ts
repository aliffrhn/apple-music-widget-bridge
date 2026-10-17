// Stores receiver state in one Postgres row and artwork in a public Storage
// bucket, using the Supabase REST APIs directly so the function has no
// third-party dependencies.

import type { NowPlayingState, Status, Store, StoredState } from "./handler.ts";

export const TABLE = "bridge_now_playing";
export const BUCKET = "bridge-now-playing-artwork";
const ROW_ID = "current";

export interface SupabaseStoreOptions {
  url: string;
  key: string;
  table?: string;
  bucket?: string;
  fetch?: typeof fetch;
}

interface Row {
  id: string;
  status: Status;
  is_playing: boolean;
  title: string | null;
  artist: string | null;
  album: string | null;
  album_artist: string | null;
  genre: string | null;
  year: number | null;
  duration_seconds: number | null;
  position_seconds: number | null;
  persistent_id: string | null;
  captured_at: string;
  artwork_persistent_id: string | null;
  artwork_path: string | null;
}

function toRow(state: NowPlayingState) {
  return {
    status: state.status,
    is_playing: state.isPlaying,
    title: state.title,
    artist: state.artist,
    album: state.album,
    album_artist: state.albumArtist,
    genre: state.genre,
    year: state.year,
    duration_seconds: state.durationSeconds,
    position_seconds: state.positionSeconds,
    persistent_id: state.persistentId,
    captured_at: state.capturedAt,
  };
}

function fromRow(row: Row): StoredState {
  return {
    state: {
      schemaVersion: 1,
      status: row.status,
      isPlaying: row.is_playing,
      title: row.title,
      artist: row.artist,
      album: row.album,
      albumArtist: row.album_artist,
      genre: row.genre,
      year: row.year,
      durationSeconds: row.duration_seconds,
      positionSeconds: row.position_seconds,
      persistentId: row.persistent_id,
      capturedAt: new Date(row.captured_at).toISOString(),
    },
    artworkPersistentId: row.artwork_persistent_id,
    artworkPath: row.artwork_path,
  };
}

export function createSupabaseStore({
  url,
  key,
  table = TABLE,
  bucket = BUCKET,
  fetch: fetchImpl = fetch,
}: SupabaseStoreOptions): Store {
  if (!url || !key) throw new Error("SUPABASE_URL and a service role or secret key are required");
  const base = url.replace(/\/+$/, "");
  const auth = { apikey: key, authorization: `Bearer ${key}` };

  async function call(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
    const response = await fetchImpl(`${base}${path}`, { ...init, headers: { ...auth, ...init.headers } });
    if (!response.ok) {
      await response.body?.cancel();
      // The path never contains the key, so it is safe to report.
      throw new Error(`Supabase request ${init.method ?? "GET"} ${path.split("?", 1)[0]} failed with HTTP ${response.status}`);
    }
    return response;
  }

  function rows(filters: Record<string, string>) {
    return `/rest/v1/${table}?${new URLSearchParams({ id: `eq.${ROW_ID}`, ...filters })}`;
  }

  async function update(filters: Record<string, string>, values: Record<string, unknown>): Promise<Row[]> {
    const response = await call(rows(filters), {
      method: "PATCH",
      headers: { "content-type": "application/json", prefer: "return=representation" },
      body: JSON.stringify(values),
    });
    return await response.json();
  }

  return {
    async readState() {
      const response = await call(rows({ select: "*" }), { headers: { accept: "application/json" } });
      const [row] = await response.json() as Row[];
      return row ? fromRow(row) : null;
    },

    async writeState(state) {
      // A single conditional UPDATE keeps the stale check atomic across
      // concurrent function instances.
      const values = toRow(state);
      if ((await update({ captured_at: `lte.${state.capturedAt}` }, values)).length > 0) return true;
      // Nothing matched: either the stored state is newer, or the singleton
      // row was deleted. Recreate a missing row; a duplicate means stale.
      const response = await call(`/rest/v1/${table}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          prefer: "resolution=ignore-duplicates,return=representation",
        },
        body: JSON.stringify({ id: ROW_ID, ...values }),
      });
      return (await response.json() as Row[]).length > 0;
    },

    async uploadArtwork(path, bytes) {
      await call(`/storage/v1/object/${bucket}/${path}`, {
        method: "POST",
        headers: {
          "content-type": "image/jpeg",
          "cache-control": "max-age=31536000",
          "x-upsert": "true",
        },
        body: bytes as BodyInit,
      });
    },

    async linkArtwork(persistentId, path) {
      const linked = await update(
        { persistent_id: `eq.${persistentId}` },
        { artwork_persistent_id: persistentId, artwork_path: path },
      );
      return linked.length > 0;
    },

    async deleteArtwork(path) {
      await call(`/storage/v1/object/${bucket}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefixes: [path] }),
      });
    },

    artworkUrl(path) {
      return `${base}/storage/v1/object/public/${bucket}/${path}`;
    },
  };
}
