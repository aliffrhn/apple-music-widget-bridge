<div align="center">

# Apple Music Widget Bridge

**Build your own live Apple Music widget with a Mac, a receiver you own (a VPS or a free Supabase project), and the website you already have.**

[![CI](https://github.com/aliffrhn/apple-music-widget-bridge/actions/workflows/test.yml/badge.svg)](https://github.com/aliffrhn/apple-music-widget-bridge/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/github/license/aliffrhn/apple-music-widget-bridge)](LICENSE)
[![macOS](https://img.shields.io/badge/publisher-macOS-000000.svg?logo=apple)](now-playing.sh)
[![Node.js 22+](https://img.shields.io/badge/receiver-Node.js%2022%2B-339933.svg?logo=node.js&logoColor=white)](receiver)
[![Supabase](https://img.shields.io/badge/receiver-Supabase-3FCF8E.svg?logo=supabase&logoColor=white)](examples/supabase)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Live widget](https://aliffar.com/#about) · [Quick start](#quick-start) · [Choose a receiver](#choose-a-receiver) · [How it works](#architecture) · [Use your own design](#use-your-own-design) · [Contributing](#contributing) · [Security](SECURITY.md)

</div>

I wanted a live music widget on my personal website, so I built a self-hosted bridge that sends what is playing in the Music app on my Mac to the web.

Use the included macOS publisher, a receiver on your own VPS or Supabase project, and a framework-independent widget to build your own version—without integrating MusicKit, creating an Xcode project, or running a centralized service.

```text
Music app on your Mac → your receiver (VPS or Supabase) → your website widget
```

See the idea running on [aliffar.com](https://aliffar.com/#about). The GIF below was recorded directly from the deployed widget.

<img src="docs/assets/aliffar-apple-music-widget.gif" alt="The animated Apple Music widget from aliffar.com" width="480">

The pixel-style React widget shown above is now included in this repository, adapted from the real component on my website and made configurable for other people.

> [!IMPORTANT]
> This is a now-playing metadata bridge, not an Apple Music web player. It does not bypass an Apple Music subscription, download audio, or control playback.

## Why this exists

A full Apple Music API integration uses MusicKit identifiers, signed developer tokens, and Apple developer credentials. That is useful when an application needs catalog search or playback, but it is a lot of machinery for a personal “what I am listening to” card.

This project takes a narrower route. It reads the current track from the built-in macOS Music app through read-only Apple Events, publishes that state to an endpoint you own, and renders it on your website.

## What is included

- **macOS publisher:** dependency-free `zsh` scripts and a per-user LaunchAgent.
- **Two receivers, same contract:** a small Node.js service with Docker Compose for a VPS, or a Supabase Edge Function with a Postgres table and Storage bucket if you would rather not run a server.
- **The aliffar.com React widget:** the animated pixel-style card from the live website, adapted to the public receiver API.
- **Universal widget:** a dependency-free Web Component for plain HTML and non-React sites.
- **VPS examples:** Nginx and Caddy reverse-proxy configurations.
- **Tests and security documentation:** checks for both the local publisher and public receiver.

The components communicate through a [documented, versioned HTTP contract](docs/endpoint-contract.md). You can replace the receiver or widget without changing the Mac publisher.

## Architecture

```text
┌────────────────────────────── Mac ──────────────────────────────┐
│ Music.app → read-only Apple Events → background publisher       │
└───────────────────────────────────┬─────────────────────────────┘
                                    │ authenticated HTTPS POST
                                    ▼
┌──────────────────── Your receiver (pick one) ───────────────────┐
│ VPS:      reverse proxy → Node.js receiver → JSON + artwork     │
│ Supabase: Edge Function → Postgres row + Storage artwork        │
└───────────────────────────────────┬─────────────────────────────┘
                                    │ public HTTPS GET
                                    ▼
                         any website or framework
```

There is no project-operated cloud service. Each user controls their receiver, secret, published data, and website.

## Choose a receiver

Both receivers implement the same [endpoint contract](docs/endpoint-contract.md), so the Mac publisher and both widgets work with either one, and you can switch later by running `install.sh` again with the new endpoint.

| | VPS with Docker | Supabase |
| --- | --- | --- |
| You need | a server with Docker, a domain, and HTTPS (Nginx or Caddy) | a Supabase account; the free plan works |
| Runs as | `receiver/` in Docker Compose, behind your reverse proxy | the `bridge-now-playing` Edge Function |
| Stores | one JSON file and one image in a Docker volume | one Postgres row and one image in a public Storage bucket |
| Endpoint | `https://example.com/api/now-playing` | `https://<project-ref>.supabase.co/functions/v1/bridge-now-playing` |
| Good to know | nothing to pause or meter | free projects can pause after inactivity; each widget poll is one function call |
| Guide | [Self-hosting guide](docs/self-hosting.md) | [Supabase adapter guide](examples/supabase) |

[aliffar.com](https://aliffar.com/#about) runs on the Supabase receiver.

## Quick start

### 1. Start the receiver

#### Option A: VPS with Docker

On a VPS with Docker and Docker Compose:

```sh
git clone https://github.com/aliffrhn/apple-music-widget-bridge.git
cd apple-music-widget-bridge
cp .env.example .env
openssl rand -hex 32
```

Put the generated secret in `.env`, then start the receiver:

```sh
chmod 600 .env
docker compose up -d --build
curl http://127.0.0.1:8787/api/now-playing/health
```

The service listens only on VPS loopback. Add HTTPS using the provided [Nginx](examples/nginx/now-playing.conf) or [Caddy](examples/caddy/Caddyfile) example. The public endpoint should be:

```text
https://example.com/api/now-playing
```

See the complete [VPS self-hosting guide](docs/self-hosting.md).

#### Option B: Supabase

Create a project in the [Supabase dashboard](https://supabase.com/dashboard), install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), and deploy from [`examples/supabase`](examples/supabase):

```sh
cd examples/supabase
supabase login
supabase link --project-ref <project-ref>
supabase db push
supabase functions deploy bridge-now-playing --no-verify-jwt
```

Generate a secret with `openssl rand -hex 32` and add it as `BRIDGE_NOW_PLAYING_WRITE_SECRET` under **Edge Functions → Secrets** in the dashboard. The public endpoint is:

```text
https://<project-ref>.supabase.co/functions/v1/bridge-now-playing
```

See the complete [Supabase adapter guide](examples/supabase), including how to add it to a project that already has other tables and functions.

### 2. Install the Mac publisher

Clone the same repository on the Mac and run it with your receiver's endpoint from step 1:

```zsh
./install.sh --endpoint 'https://example.com/api/now-playing'
```

Enter the same write secret when macOS displays the secure Keychain prompt. The first read may also trigger an Automation permission prompt for the Music app.

Check the installation:

```zsh
"$HOME/Library/Application Support/NowPlayingSync/doctor.sh"
"$HOME/Library/Application Support/NowPlayingSync/sync-now-playing.sh" --once
```

### 3. Add the widget

For React, copy [`widget/react/src`](widget/react/src) into your application and render the real aliffar.com design:

```jsx
import AppleMusicWidget from "./apple-music-widget/AppleMusicWidget.jsx"

<AppleMusicWidget endpoint="/api/now-playing" ownerName="Your name" />
```

Run the complete [React example](examples/react) to see it with demo data:

```sh
cd examples/react
npm install
npm run dev
```

For plain HTML or another framework, copy the universal [`widget/now-playing-widget.js`](widget/now-playing-widget.js) component into the website and load it:

```html
<script type="module" src="/assets/now-playing-widget.js"></script>

<now-playing-widget
  endpoint="/api/now-playing"
  owner-name="Alif"
  refresh-seconds="5"
></now-playing-widget>
```

Or load a pinned release straight from jsDelivr instead of copying the file:

```html
<script type="module" src="https://cdn.jsdelivr.net/gh/aliffrhn/apple-music-widget-bridge@v0.2.1/widget/now-playing-widget.js"></script>
```

With the Supabase receiver, or a VPS on another domain, use the full endpoint URL instead of `/api/now-playing`. Both receivers allow public cross-origin reads.

It works with plain HTML, WordPress, Vue, Svelte, Astro, and other frameworks that support custom elements. See the [widget integration guide](docs/widget-integration.md) for both options.

## Use your own design

The included widget is optional. Any site can read:

```http
GET https://example.com/api/now-playing
```

```json
{
  "schemaVersion": 1,
  "status": "playing",
  "isPlaying": true,
  "title": "Example Song",
  "artist": "Example Artist",
  "album": "Example Album",
  "durationSeconds": 213.4,
  "positionSeconds": 42.1,
  "capturedAt": "2026-08-01T12:00:00.000Z",
  "artworkUrl": "/api/now-playing/artwork?id=0123456789ABCDEF&v=abc123"
}
```

The full schema is in [the endpoint contract](docs/endpoint-contract.md). The public response contains no secret.

## Mac publisher details

The publisher:

- reads title, artist, album, playback state, duration, position, and persistent ID;
- extracts and normalizes current artwork to a web-safe JPEG;
- uploads state changes immediately and heartbeats every 30 seconds while playing;
- runs as a per-user `launchd` agent;
- stores the endpoint configuration with mode `600` and the write secret in macOS Keychain;
- keeps credentials and track metadata out of logs;
- opens no listening port and never controls playback.

Requirements are macOS, the built-in Music app, standard macOS command-line tools, and an HTTPS receiver. The publisher needs no third-party package, `sudo`, Xcode project, code signing, or Apple Music API token.

Read the current local state without uploading:

```zsh
./now-playing.sh
```

Install without artwork publishing:

```zsh
./install.sh --endpoint 'https://example.com/api/now-playing' --no-artwork
```

To switch receivers, run `install.sh` again with the new `--endpoint`. When the endpoint differs from the installed one, the installer clears the record of what was already uploaded, so the new receiver gets the current state and artwork right away instead of waiting for the next track change. Reinstalling with the same endpoint keeps that record.

## Receiver security

Both included receivers:

- compare the write secret in constant time;
- accept state and artwork only through authenticated `POST` requests;
- limit JSON to 64 KiB and artwork to 2 MiB;
- validate the state schema and JPEG signature;
- reject stale events and artwork for a previous track;
- return public data with ETags and `no-cache` revalidation, so unchanged polls get a small `304`.

The Docker receiver also writes files atomically, drops container capabilities, and uses a read-only container filesystem; keep it behind HTTPS and bound to VPS loopback. The Supabase receiver keeps its table private with Row Level Security and no public policies, serves reads only through the function, and allows no anonymous writes to its artwork bucket.

Never put the write secret in frontend code. Read [SECURITY.md](SECURITY.md) before publishing listening activity.

## Repository layout

```text
.
├── now-playing.sh                 local Music reader
├── artwork.sh                     local artwork reader
├── sync-now-playing.sh            authenticated publisher loop
├── install.sh / uninstall.sh      macOS lifecycle
├── doctor.sh                      installation diagnostics
├── receiver/                      Docker/VPS receiver and tests
├── widget/react/                  real pixel-style aliffar.com React widget
├── widget/now-playing-widget.js   universal Web Component
├── examples/react/                runnable React example
├── examples/nginx/                Nginx reverse proxy
├── examples/caddy/                Caddy reverse proxy
├── examples/supabase/             Supabase Edge Function receiver and tests
├── docs/                          protocol and setup guides
└── compose.yaml                   Docker receiver stack
```

## Development and tests

Publisher checks require macOS:

```zsh
./tests/run.sh
```

Receiver and widget tests require Node.js 22 or newer:

```sh
cd receiver && npm test
cd ../widget && npm test
cd react && npm test
cd ../../examples/react && npm ci && npm run build
```

The Supabase adapter tests require [Deno](https://docs.deno.com/runtime/getting_started/installation/) 2 and run from the repository root:

```sh
deno test examples/supabase
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance.

## Contributing

Contributions are welcome—bug reports, setup improvements, new receiver adapters, widget designs, documentation fixes, and focused pull requests all help.

1. Read the [Contributing Guide](CONTRIBUTING.md).
2. Check the [open issues](https://github.com/aliffrhn/apple-music-widget-bridge/issues) or open one to discuss a larger idea.
3. Fork the repository, create a focused branch, and send a pull request.

Please also follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately as described in the [Security Policy](SECURITY.md).

## Limitations

- The publisher is macOS-only and reads the Music app on the same Mac.
- You still need a receiver: your own VPS, or a Supabase project (free projects can pause after inactivity).
- Both receivers store only the current state and artwork, not listening history.
- The included widgets use polling rather than a persistent Realtime connection.
- Album artwork can be copyrighted; each operator is responsible for how it is displayed.
- Music, Apple Music, and MusicKit are Apple trademarks. This independent project is not endorsed by Apple.

## Uninstall the Mac publisher

```zsh
./uninstall.sh
```

This removes only the integration's LaunchAgent, installed scripts, private state, logs, configuration, and Keychain item. It does not use `sudo` or remove unrelated files.

## License

[MIT](LICENSE)

## Acknowledgments

- The macOS Music app and Apple Events provide the local now-playing state.
- The pixel-style widget began as the music card on [aliffar.com](https://aliffar.com/#about).
- Everyone who tests the bridge on a different VPS, Supabase project, proxy, or website framework.

---

<div align="center">

If this helps you build your own music widget, consider giving the project a ⭐—it helps other personal-site builders find it.

</div>
