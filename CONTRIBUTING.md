# Contributing to Apple Music Widget Bridge

Thanks for your interest in contributing. Bug reports, setup feedback, documentation fixes, widget improvements, compatible receiver adapters, and focused code changes are all useful.

## Ways to contribute

- **Report a bug** using the [bug report template](https://github.com/aliffrhn/apple-music-widget-bridge/issues/new?template=bug_report.yml).
- **Suggest an improvement** using the [feature request template](https://github.com/aliffrhn/apple-music-widget-bridge/issues/new?template=feature_request.yml).
- **Improve documentation** when a Mac, VPS, proxy, or website step is unclear.
- **Submit code** for a focused issue or a small self-contained improvement.

For anything larger than a small fix, please open an issue first so the approach and protocol impact can be discussed before implementation.

## Development setup

Requirements depend on the component:

- macOS with the Music app for publisher checks;
- Node.js 22 or newer for the receiver and widget tests; and
- Docker with Compose for the complete receiver smoke path.

```sh
git clone https://github.com/<your-username>/apple-music-widget-bridge.git
cd apple-music-widget-bridge

./tests/run.sh
(cd receiver && npm test)
(cd widget && npm test)
(cd widget/react && npm test)
(cd examples/react && npm ci && npm run build)
```

The shell checks require macOS. The Node.js tests can run on any supported platform.

## Project structure

```text
apple-music-widget-bridge/
├── now-playing.sh / artwork.sh   local, read-only Music app readers
├── sync-now-playing.sh           authenticated publisher loop
├── install.sh / uninstall.sh     per-user macOS lifecycle
├── receiver/                     standalone HTTP receiver and tests
├── widget/react/                 pixel-style aliffar.com React widget
├── widget/                       universal Web Component
├── examples/                     React, Nginx, and Caddy examples
├── tests/                        macOS publisher release checks
└── docs/                         protocol, permissions, and hosting guides
```

Keep the endpoint contract framework- and vendor-independent. Provider-specific integrations should remain optional adapters rather than requirements for the publisher or universal widget.

## Pull request workflow

1. Create a branch from `main`, such as `feat/short-description`, `fix/short-description`, or `docs/short-description`.
2. Keep the pull request focused on one change.
3. Run the checks relevant to the affected components.
4. Test the real flow when applicable: Music app → publisher → receiver → browser widget.
5. Use a clear imperative commit message, push your branch, and complete the pull request template.

CI runs the macOS publisher checks, Node.js tests, and React example build on every pull request to `main`.

## Releasing (maintainers)

1. Make sure every `package.json` has the new version: `node scripts/check-versions.mjs`.
2. Move the `[Unreleased]` entries in `CHANGELOG.md` under a `## [X.Y.Z] - YYYY-MM-DD` heading.
3. Commit, then tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.

The release workflow checks the versions against the tag, runs the tests, publishes the receiver image to `ghcr.io/aliffrhn/apple-music-widget-bridge-receiver`, and creates the GitHub release from the changelog section. After the first release, set the GHCR package visibility to public once in the package settings.

## Code and security guidelines

- Preserve compatibility with the versioned endpoint contract or document and test intentional changes.
- Treat track metadata as untrusted text and never inject it as raw HTML.
- Never log or commit write secrets, private endpoint URLs, Keychain output, or personal listening history.
- Keep new dependencies small and justified; the publisher is intentionally dependency-free.
- Add tests for new validation, protocol, storage, or presentation logic.

Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md), not a public issue.

## Questions

Ask setup and usage questions in [GitHub Discussions](https://github.com/aliffrhn/apple-music-widget-bridge/discussions). Use [issues](https://github.com/aliffrhn/apple-music-widget-bridge/issues) for reproducible bugs and concrete feature proposals, with enough context to identify the component and environment. Do not include secrets or private listening data.
