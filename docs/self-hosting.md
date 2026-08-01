# Self-host the receiver on a VPS

The included receiver is a small, dependency-free Node.js service packaged with Docker. It stores one current state document and one current artwork file. It does not need a database.

## 1. Prepare the service

On the VPS:

```sh
git clone https://github.com/aliffrhn/apple-music-widget-bridge.git
cd apple-music-widget-bridge
cp .env.example .env
openssl rand -hex 32
```

Put the generated value in `.env` as `NOW_PLAYING_WRITE_SECRET`, then restrict the file:

```sh
chmod 600 .env
docker compose up -d --build
curl http://127.0.0.1:8787/api/now-playing/health
```

The Compose configuration binds to `127.0.0.1`, drops Linux capabilities, uses a read-only container filesystem, and persists data in the `now-playing-data` volume. Do not expose port 8787 directly to the internet.

## 2. Add HTTPS through the existing web server

Use either [`examples/nginx/now-playing.conf`](../examples/nginx/now-playing.conf) or [`examples/caddy/Caddyfile`](../examples/caddy/Caddyfile) as a starting point. The public URL should become:

```text
https://example.com/api/now-playing
```

Verify it externally:

```sh
curl https://example.com/api/now-playing/health
curl https://example.com/api/now-playing
```

The health response contains only the receiver version. The public state endpoint never includes the write secret.

## 3. Install the publisher on the Mac

Run this from the cloned repository on the Mac:

```zsh
./install.sh --endpoint 'https://example.com/api/now-playing'
```

When macOS opens the secure Keychain prompt, enter the same secret from the VPS `.env` file. Then verify everything:

```zsh
"$HOME/Library/Application Support/NowPlayingSync/doctor.sh"
"$HOME/Library/Application Support/NowPlayingSync/sync-now-playing.sh" --once
```

## 4. Add the widget

Follow [the widget integration guide](widget-integration.md). For a same-domain website, keep the default `/api/now-playing` endpoint. Cross-domain public reads are also supported with CORS.

## Operations

View service status and logs:

```sh
docker compose ps
docker compose logs --tail 100 now-playing
```

Deploy an update:

```sh
git pull --ff-only
docker compose up -d --build
```

The named volume survives normal container replacement. Back up the volume if keeping the last published state matters, although the Mac will republish it automatically while running.

## Security notes

- Keep `.env` out of version control and readable only by the VPS administrator.
- Terminate TLS with a valid public certificate.
- Leave the receiver bound to loopback and expose it only through the HTTPS reverse proxy.
- Never include `NOW_PLAYING_WRITE_SECRET` in website JavaScript.
- Rotate the secret by updating both the VPS `.env` and the macOS Keychain item.
- The public endpoint intentionally exposes the current track and artwork. Do not deploy it if listening activity should remain private.
