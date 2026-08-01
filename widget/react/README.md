# Pixel-style React widget

This is the actual visual design used on [aliffar.com](https://aliffar.com/#about), separated from the private portfolio and adapted to Apple Music Widget Bridge's public HTTP contract.

It includes:

- configurable owner wording instead of a hardcoded name;
- pixel-canvas labels and rotating title, artist, and album text;
- stepped equalizer and segmented progress animation;
- artwork loading and fallback states;
- freshness, paused, recent, and offline presentation; and
- recoverable polling without a Supabase dependency.

Copy `src` into a React application and render:

```jsx
import AppleMusicWidget from "./apple-music-widget/AppleMusicWidget.jsx"

<AppleMusicWidget
  endpoint="/api/now-playing"
  ownerName="Your name"
  pollInterval={15_000}
/>
```

The receiver's write secret must never be included in the React application. The component reads only the public `GET` endpoint.

Use `AppleMusicWidgetCard` when data comes from an existing application state instead of the included polling hook. See [`examples/react`](../../examples/react) for a runnable demo.
