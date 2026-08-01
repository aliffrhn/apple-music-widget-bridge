# React example

This is the pixel-style widget used on [aliffar.com](https://aliffar.com/#about), adapted to the public receiver contract and configurable for other sites.

```sh
npm install
npm run dev
```

Without configuration, the example displays local demo data. To connect it to a receiver:

```sh
VITE_NOW_PLAYING_ENDPOINT=https://example.com/api/now-playing npm run dev
```

Use the reusable component in a React application:

```jsx
import { AppleMusicWidget } from "@aliffrhn/apple-music-widget"

<AppleMusicWidget endpoint="/api/now-playing" ownerName="Your name" />
```

The component polls the framework-independent endpoint, extrapolates progress locally, handles stale/offline states, and never receives the private write secret.
