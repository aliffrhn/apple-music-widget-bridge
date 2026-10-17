# Changelog

All notable changes to this project will be documented here.

## [Unreleased]

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
