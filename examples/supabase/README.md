# Supabase receiver adapter

An optional receiver for people who would rather not run a VPS. It is a single Supabase Edge Function that implements the [receiver endpoint contract](../../docs/endpoint-contract.md), so the Mac publisher, the [Web Component](../../widget/now-playing-widget.js), and the [React widget](../../widget/react) work with it unchanged.

| Piece | Name |
| --- | --- |
| Edge Function | `bridge-now-playing` |
| State table | `public.bridge_now_playing` (one row) |
| Artwork bucket | `bridge-now-playing-artwork` (public) |
| Write secret | `BRIDGE_NOW_PLAYING_WRITE_SECRET` |

Every name has a `bridge` prefix, so the adapter can run in a project that already has other functions, tables, or buckets, including an earlier custom now-playing setup.

The function provides the same routes as the [Docker receiver](../../receiver), under its function URL:

| Request | Purpose |
| --- | --- |
| `POST /functions/v1/bridge-now-playing` | Authenticated state update or artwork upload from the Mac |
| `GET` or `HEAD /functions/v1/bridge-now-playing` | Public state with `schemaVersion` and `artworkUrl`, plus `ETag` and CORS |
| `GET /functions/v1/bridge-now-playing/artwork?id=…` | Redirects to the current artwork, or `404` once the track has changed |
| `GET /functions/v1/bridge-now-playing/health` | `{"ok": true, "version": "…"}` |

It rejects state updates whose `capturedAt` is older than the stored state, and artwork whose persistent ID no longer matches the current track. Both checks are single conditional database updates, so they also hold when several function instances run at once.

`artworkUrl` points straight at the public Storage object, so images are served by the Storage CDN without invoking the function. Each object path includes the persistent ID and a SHA-256 of the image, so a URL never shows a different track's artwork. The function deletes the previous object after new artwork is linked.

> [!NOTE]
> Supabase can pause free projects after a period of inactivity. A paused project returns errors to the publisher and the widget, which then shows its offline state, until you restore the project from the dashboard. Use a paid plan, or check on the project, if the widget must stay up.

## 1. Create a project

Create a project in the [Supabase dashboard](https://supabase.com/dashboard). Note its project reference, the `<project-ref>` part of `https://<project-ref>.supabase.co`. The examples below use `<project-ref>` as a placeholder.

Install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) and sign in:

```sh
supabase login
```

Run the remaining CLI commands from this directory:

```sh
cd examples/supabase
supabase link --project-ref <project-ref>
```

## 2. Create the table and bucket

For a project that already has migrations from another repository, follow [Migrating from a custom Supabase setup](#migrating-from-a-custom-supabase-setup) instead. Otherwise, apply [`supabase/migrations/20261017000000_bridge_now_playing.sql`](supabase/migrations/20261017000000_bridge_now_playing.sql):

```sh
supabase db push
```

Alternatively, paste the file into the dashboard's SQL Editor and run it. The migration is safe to run more than once.

It creates the single-row state table with Row Level Security enabled and no policies, and revokes all table privileges from the `anon` and `authenticated` roles. Only the function, which uses the service role, can read or write the row. Visitors read the state through the function's public `GET` route instead.

It also creates the public `bridge-now-playing-artwork` bucket, limited to JPEG files up to 2 MiB. Public buckets serve objects by URL without a policy. The migration adds no `storage.objects` policies, so anonymous clients cannot upload, replace, list, or delete artwork.

## 3. Set the write secret

Generate a secret of at least 32 characters and store it as a function secret. Keep it out of your shell history by putting it in a temporary file:

```sh
umask 077
printf 'BRIDGE_NOW_PLAYING_WRITE_SECRET=%s\n' "$(openssl rand -hex 32)" > .env.bridge
cat .env.bridge
supabase secrets set --env-file .env.bridge
```

Keep the value available for step 5, then delete the file with `rm .env.bridge`. You can also add the secret under **Edge Functions → Secrets** in the dashboard.

Until the secret is set, the function answers write requests with `503` and still serves public reads.

The function finds the project URL and service key through environment variables that Supabase sets automatically (`SUPABASE_URL`, and `SUPABASE_SECRET_KEYS` or `SUPABASE_SERVICE_ROLE_KEY`). Do not add those yourself.

## 4. Deploy the function

```sh
supabase functions deploy bridge-now-playing --no-verify-jwt
```

JWT verification must be off. The publisher authenticates with the `X-Now-Playing-Secret` header rather than a Supabase JWT, and widgets read anonymously. The included [`supabase/config.toml`](supabase/config.toml) sets `verify_jwt = false` too, so later deploys keep it off.

Check it from any computer:

```sh
curl https://<project-ref>.supabase.co/functions/v1/bridge-now-playing/health
curl https://<project-ref>.supabase.co/functions/v1/bridge-now-playing
```

The first state response reports `"status": "unavailable"` until the Mac publishes.

## 5. Point the publisher at the function

From the repository root on the Mac:

```zsh
./install.sh --endpoint 'https://<project-ref>.supabase.co/functions/v1/bridge-now-playing'
```

Enter the write secret from step 3 when macOS opens the Keychain prompt, then verify:

```zsh
"$HOME/Library/Application Support/NowPlayingSync/doctor.sh"
"$HOME/Library/Application Support/NowPlayingSync/sync-now-playing.sh" --once
```

If the publisher is already installed for another receiver, running `install.sh` again with the new endpoint replaces it.

## 6. Point the widget at the function

Use the full function URL as the widget endpoint. The function sends `Access-Control-Allow-Origin: *` on public reads, so any website can read it. Writes still require the secret.

```html
<now-playing-widget
  endpoint="https://<project-ref>.supabase.co/functions/v1/bridge-now-playing"
  owner-name="Your name"
></now-playing-widget>
```

```jsx
<AppleMusicWidget
  endpoint="https://<project-ref>.supabase.co/functions/v1/bridge-now-playing"
  ownerName="Your name"
/>
```

Every widget poll and every publisher update is one Edge Function invocation. With many visitors, raise `refresh-seconds` (or the React `pollInterval`) and check your plan's invocation quota. See the [widget integration guide](../../docs/widget-integration.md) for the rest of the options.

## Migrating from a custom Supabase setup

If a project already runs its own now-playing function, tables, or bucket, the adapter can be added alongside them and swapped in without downtime:

1. **Deploy alongside.** Copy `supabase/migrations/20261017000000_bridge_now_playing.sql` into the project's own migrations folder and the `supabase/functions/bridge-now-playing` folder into its functions folder, and add the `[functions.bridge-now-playing]` section from [`supabase/config.toml`](supabase/config.toml) to its `config.toml`. Then push the migration, set the secret, and deploy as in steps 2 to 4 from the project's own directory. Running `supabase db push` from this directory against a project with its own migration history fails, because the CLI cannot find the project's earlier migrations here; pasting the SQL into the SQL Editor also works. Nothing the adapter creates shares a name with the existing setup.
2. **Test with one update.** Switch the installed publisher to the new function, send one update, and read it back:

   ```zsh
   ./install.sh --endpoint 'https://<project-ref>.supabase.co/functions/v1/bridge-now-playing'
   "$HOME/Library/Application Support/NowPlayingSync/sync-now-playing.sh" --once
   curl https://<project-ref>.supabase.co/functions/v1/bridge-now-playing
   ```

   The response should show the current track and, once artwork has uploaded, an `artworkUrl`. Until step 3 the website keeps showing the last state the old function stored. To roll back, run `install.sh` again with the old endpoint.
3. **Switch the widget.** Change the website to read the function URL with one of the repository widgets instead of reading the old table or function.
4. **Retire the old function.** Once the website no longer uses it, delete the old function, then drop its tables and empty and delete its bucket if nothing else needs them.

## Development

The handler is split so it can be tested without Supabase:

- [`handler.ts`](supabase/functions/bridge-now-playing/handler.ts) holds the routing and validation for the endpoint contract and works with any storage backend.
- [`supabase.ts`](supabase/functions/bridge-now-playing/supabase.ts) stores state and artwork through the Supabase REST and Storage APIs, with no third-party dependencies.
- [`index.ts`](supabase/functions/bridge-now-playing/index.ts) connects them and starts the server.

The tests run the real store against an in-memory fake of the PostgREST and Storage endpoints. They need [Deno](https://docs.deno.com/runtime/getting_started/installation/) 2. From the repository root:

```sh
deno test examples/supabase
```

To try the function locally with Docker, run `supabase start`, then `supabase functions serve --env-file <file>` with a file that sets `BRIDGE_NOW_PLAYING_WRITE_SECRET`.
