# Integrate the widget

The receiver exposes standard JSON over HTTP, so it is independent of the site's framework.

## Pixel-style React widget from aliffar.com

The animated widget shown in the main README lives in [`widget/react`](../widget/react). It contains the stepped equalizer, pixel typography, artwork loader, segmented progress bar, and stale/offline presentation used by the real website.

Copy `widget/react/src` into a React application, then render:

```jsx
import AppleMusicWidget from "./apple-music-widget/AppleMusicWidget.jsx"

<AppleMusicWidget endpoint="/api/now-playing" ownerName="Your name" />
```

It reads the public receiver directly; Supabase and other frontend SDKs are not required. See the runnable [`examples/react`](../examples/react) project.

## Universal Web Component

Copy [`widget/now-playing-widget.js`](../widget/now-playing-widget.js) into the site's assets and load it as a module:

```html
<script type="module" src="/assets/now-playing-widget.js"></script>

<now-playing-widget
  endpoint="/api/now-playing"
  owner-name="Alif"
  refresh-seconds="10"
></now-playing-widget>
```

This works in plain HTML, WordPress templates, Astro, Vue, Svelte, React, and other frameworks that render custom elements. Its design is intentionally simpler than the portfolio React widget.

The component uses Shadow DOM to isolate its internal styles. Customize the public CSS variables:

```css
now-playing-widget {
  --now-playing-background: #111216;
  --now-playing-foreground: #ffffff;
  --now-playing-muted: #a7a9b2;
  --now-playing-accent: #ff375f;
  --now-playing-radius: 24px;
  --now-playing-width: 440px;
}
```

Wording can be changed through `playing-label`, `paused-label`, `stopped-label`, and `idle-label`. Without custom labels, `owner-name="Alif"` produces “Alif is listening to” while playing.

## Completely custom design

Fetch the public endpoint and render the response with the framework of your choice:

```js
const response = await fetch("/api/now-playing");
const nowPlaying = await response.json();

console.log(nowPlaying.title, nowPlaying.artist, nowPlaying.artworkUrl);
```

Use `positionSeconds` as the position at `capturedAt`. While `isPlaying` is true, add the elapsed time since `capturedAt` and clamp the result to `durationSeconds`. This creates a smooth progress bar without polling every second.

Treat all track metadata as untrusted text. Use `textContent` or normal framework text interpolation; never insert it as raw HTML. The included component follows this rule.

## Cross-domain websites

Public `GET` and `HEAD` responses include `Access-Control-Allow-Origin: *`. The authenticated `POST` endpoint is not intended for browsers. Keep the write secret only in macOS Keychain and the receiver environment.
