import { AppleMusicWidget, AppleMusicWidgetCard } from "@aliffrhn/apple-music-widget"

const demoData = {
  schemaVersion: 1,
  status: "playing",
  isPlaying: true,
  title: "Midnight on the Web",
  artist: "The Local Bridge",
  album: "Open Source Sessions",
  durationSeconds: 213,
  positionSeconds: 76,
  capturedAt: new Date().toISOString(),
  artworkUrl: "/demo-artwork.svg",
}

export default function App() {
  const endpoint = import.meta.env.VITE_NOW_PLAYING_ENDPOINT
  return (
    <main>
      <div className="demo-shell">
        <p className="demo-label">The widget from aliffar.com, now reusable.</p>
        {endpoint ? (
          <AppleMusicWidget endpoint={endpoint} ownerName="Alif" />
        ) : (
          <AppleMusicWidgetCard data={demoData} ownerName="Alif" />
        )}
      </div>
    </main>
  )
}
