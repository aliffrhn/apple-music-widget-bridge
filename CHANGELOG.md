# Changelog

All notable changes to this project will be documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.1] - 2026-10-21

### Changed

- The state response now uses `Cache-Control: no-cache` instead of allowing browsers to show a stale copy for up to 18 seconds, in both the Docker receiver and the Supabase adapter.
- Both widgets now poll every 5 seconds by default (was 10 and 15). The React hook, like the Web Component, no longer polls while the page is hidden and refreshes as soon as it becomes visible again.

### Fixed

- Conditional requests now match weak ETags (`W/"…"`) added by compressing proxies such as Cloudflare, so unchanged polls return `304` again.
- Running `install.sh` again with a different `--endpoint` now clears the publisher's upload bookkeeping (`last-successful-upload` and `uploaded-artwork-ids`), so the new receiver gets the current state and artwork immediately instead of waiting for the next track or playback change. Reinstalling with the same endpoint keeps it, and the local `last-known-track.json` is always kept.

## [0.2.0] - 2026-10-17

### Added

- Optional Supabase receiver adapter in `examples/supabase`: an Edge Function that implements the full endpoint contract, including public reads with CORS, plus a migration for its table and public artwork bucket, a setup and migration guide, and Deno tests that run in CI.

## [0.1.0] - 2026-10-17

First public release.

### Added

- Read-only macOS Music state and artwork publisher.
- Secure per-user LaunchAgent installation and Keychain secret storage.
- Version 1 framework-independent receiver contract.
- Standalone Docker receiver with persistent atomic file storage.
- The animated pixel-style React widget from aliffar.com, adapted to the public receiver contract.
- Universal Web Component for framework-independent integration.
- Nginx and Caddy VPS deployment examples.
- Installation doctor, security policy, and automated test suites.
- Publisher end-to-end test against an HTTPS receiver, a container build in CI, Dependabot, and a tag-driven release workflow that publishes the receiver image to GHCR.
- Rate limiting in the Nginx example.

### Changed

- The LaunchAgent label is now `io.github.aliffrhn.apple-music-widget-bridge` and the Keychain service is `apple-music-widget-bridge`. Running `install.sh` again migrates an existing installation.
- The publisher starts one JavaScript for Automation process per poll instead of three, which uses less CPU and battery.
- The receiver reads its version from `package.json`.

### Fixed

- The receiver no longer crashes when a request has a malformed `Host` header.
- The universal widget no longer shows a stale `playing` state as live after the Mac stops publishing.

[Unreleased]: https://github.com/aliffrhn/apple-music-widget-bridge/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/aliffrhn/apple-music-widget-bridge/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/aliffrhn/apple-music-widget-bridge/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/aliffrhn/apple-music-widget-bridge/releases/tag/v0.1.0
