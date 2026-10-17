// Supabase Edge Function entry point. Deploy with JWT verification disabled:
// the publisher authenticates with X-Now-Playing-Secret and widgets read
// anonymously.

import { createHandler } from "./handler.ts";
import { createSupabaseStore } from "./supabase.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

// Prefer the newer secret API key and fall back to the legacy service role key.
function adminKey(): string | undefined {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, unknown>;
      if (typeof parsed.default === "string") return parsed.default;
    } catch {
      console.error("SUPABASE_SECRET_KEYS is not valid JSON");
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}

const handler = createHandler({
  store: createSupabaseStore({ url: Deno.env.get("SUPABASE_URL") ?? "", key: adminKey() ?? "" }),
  secret: Deno.env.get("BRIDGE_NOW_PLAYING_WRITE_SECRET"),
  waitUntil: typeof EdgeRuntime === "undefined" ? undefined : (promise) => EdgeRuntime.waitUntil(promise),
});

Deno.serve(handler);
