# Contributing

Thanks for helping improve Apple Music Widget Bridge.

## Before opening a pull request

Run the checks that apply to your change:

```sh
./tests/run.sh
cd receiver && npm test
cd ../widget && npm test
cd react && npm test
cd ../../examples/react && npm ci && npm run build
```

The shell checks require macOS because the publisher integrates with the Music app. Receiver and widget tests run on Node.js 22 or newer on any supported operating system.

Keep the core endpoint contract framework- and vendor-independent. Provider-specific receivers should be optional adapters, not requirements for the macOS publisher or universal widget.

For security reports, follow [`SECURITY.md`](SECURITY.md) instead of opening a public issue with exploit details or secrets.
