# Security policy

## Reporting a vulnerability

Please use GitHub private vulnerability reporting for security issues when it is available on this repository. If it is unavailable, open an issue that requests a private contact channel, but do not include secrets, personal listening data, or working exploit details in the public issue.

Reports should include the affected script or component, expected impact, reproduction conditions, and any suggested mitigation. Please allow time to investigate before publishing details.

## Security model

This project is a self-hosted publisher, not a centralized service. Each installation sends now-playing data to an HTTPS endpoint selected by that user and authenticates with that user's private shared secret.

The local publisher:

- opens no listening port;
- reads only the current Music app track and playback state;
- stores the shared secret in macOS Keychain;
- keeps local configuration, state, logs, and temporary artwork private to the user; and
- does not intentionally log credentials or track metadata.

The included receiver is a separate trust boundary. It implements authentication, body limits, schema and image validation, stale-event protection, atomic storage, and safe public response headers. Operators remain responsible for TLS termination, proxy-level rate limits, host access, backups, retention, and deciding whether the resulting now-playing feed is public.

The public `GET` routes intentionally expose the current track and artwork. The authenticated `POST` route must remain protected by a unique secret of at least 32 random characters. That secret belongs only in macOS Keychain and the receiver environment; it must never be included in the widget or other browser code.

## Supported versions

Security fixes are provided on the latest release line. Until the first stable release, the project should be treated as beta software and users should review changes before updating.
