import { useEffect, useId, useMemo, useState } from "react"
import GlyphTileText from "./GlyphTileText.jsx"
import PixelText from "./PixelText.jsx"
import { useNowPlaying } from "./useNowPlaying.js"
import { estimatePosition, formatTime, getPresentation } from "./model.js"
import "./styles.css"

const PROGRESS_SEGMENTS = 20

function StatusChip({ label, live }) {
  return (
    <span className="amw-status" aria-live={live ? "polite" : undefined}>
      <span className="amw-eq" aria-hidden="true"><span /><span /><span /></span>
      <PixelText text={label} />
      <span className="amw-sr-only">{label}</span>
    </span>
  )
}

export default function AppleMusicWidget({
  endpoint = "/api/now-playing",
  ownerName = "",
  pollInterval = 15_000,
  className = "",
}) {
  const { data, isOffline } = useNowPlaying(endpoint, pollInterval)
  return <AppleMusicWidgetCard data={data} isOffline={isOffline} ownerName={ownerName} className={className} />
}

export function AppleMusicWidgetCard({
  data,
  isOffline = false,
  ownerName = "",
  className = "",
}) {
  const [now, setNow] = useState(Date.now)
  const [failedArtworkUrl, setFailedArtworkUrl] = useState(null)
  const [loadedArtworkUrl, setLoadedArtworkUrl] = useState(null)
  const titleId = useId()

  useEffect(() => {
    if (!data) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [data])

  const view = useMemo(
    () => (data ? getPresentation(data, now, isOffline, ownerName) : null),
    [data, now, isOffline, ownerName],
  )

  if (!data?.title) return null

  const position = estimatePosition(data, now, view.isCurrentPlaying)
  const duration = Number.isFinite(data.durationSeconds) ? data.durationSeconds : null
  const progress = duration && duration > 0 ? Math.min(100, (position / duration) * 100) : 0
  const title = data.title
  const artist = data.artist || "Apple Music"
  const artworkUrl = data.artworkUrl && data.artworkUrl !== failedArtworkUrl ? data.artworkUrl : null
  const artworkReady = artworkUrl !== null && loadedArtworkUrl === artworkUrl
  const classes = ["apple-music-widget", `amw-card--${view.tone}`, className].filter(Boolean).join(" ")

  return (
    <article className={classes} aria-labelledby={titleId}>
      <div className={artworkReady ? "amw-artwork-frame is-ready" : "amw-artwork-frame"}>
        <div className="amw-artwork-placeholder" aria-hidden="true"><span className="amw-artwork-note" /></div>
        {artworkUrl && (
          <img
            className="amw-artwork"
            src={artworkUrl}
            alt={data.album ? `Album artwork for ${data.album}` : `Artwork for ${title}`}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoadedArtworkUrl(artworkUrl)}
            onError={() => setFailedArtworkUrl(artworkUrl)}
          />
        )}
      </div>
      <div className="amw-main">
        <StatusChip label={view.label} live />
        <GlyphTileText lines={[title, artist, data.album]} />
        <h2 className="amw-sr-only" id={titleId}>{title}</h2>
        <p className="amw-sr-only">{data.album ? `${artist}, ${data.album}` : artist}</p>
        <div className="amw-progress-row">
          <span><span className="amw-sr-only">Current position {formatTime(position)}</span><PixelText text={formatTime(position)} /></span>
          <div
            className="amw-progress"
            role="progressbar"
            aria-label={`Progress for ${title}`}
            aria-valuemin="0"
            aria-valuemax={duration ?? undefined}
            aria-valuenow={duration === null ? undefined : Math.round(position)}
            aria-valuetext={duration === null
              ? `${formatTime(position)} elapsed`
              : `${formatTime(position)} of ${formatTime(duration)}`}
          >
            {Array.from({ length: PROGRESS_SEGMENTS }, (_, index) => {
              const filled = Math.round((progress / 100) * PROGRESS_SEGMENTS)
              const cellClasses = ["amw-progress-cell"]
              if (index < filled) cellClasses.push("is-filled")
              if (view.isCurrentPlaying && filled > 0 && index === filled - 1) cellClasses.push("is-head")
              return <span key={index} className={cellClasses.join(" ")} />
            })}
          </div>
          <span><span className="amw-sr-only">{duration === null ? "Duration unavailable" : `Duration ${formatTime(duration)}`}</span><PixelText text={duration === null ? "-:-" : formatTime(duration)} /></span>
        </div>
      </div>
    </article>
  )
}
