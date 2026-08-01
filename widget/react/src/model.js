const ONE_MINUTE = 60 * 1000
const PLAYING_FRESH_WINDOW = 2 * ONE_MINUTE
const RECENT_WINDOW = 30 * ONE_MINUTE

export function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return "0:00"
  const seconds = Math.floor(value)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

export function estimatePosition(data, now, isCurrentPlaying) {
  const stored = Number.isFinite(data?.positionSeconds) ? data.positionSeconds : 0
  const duration = Number.isFinite(data?.durationSeconds) ? data.durationSeconds : null
  const capturedAt = Date.parse(data?.capturedAt)
  const elapsed = isCurrentPlaying && Number.isFinite(capturedAt)
    ? Math.max(0, (now - capturedAt) / 1000)
    : 0
  const estimate = Math.max(0, stored + elapsed)
  return duration === null ? estimate : Math.min(estimate, duration)
}

export function getPresentation(data, now, isOffline, ownerName = "") {
  const capturedAt = Date.parse(data?.capturedAt)
  const age = Number.isFinite(capturedAt) ? Math.max(0, now - capturedAt) : Number.POSITIVE_INFINITY
  const owner = ownerName.trim()
  const withOwner = (phrase) => (owner ? `${owner} ${phrase}` : phrase[0].toUpperCase() + phrase.slice(1))

  if (isOffline) return { label: withOwner("last played"), tone: "offline", isCurrentPlaying: false }
  if (data.status === "playing" && age < PLAYING_FRESH_WINDOW) {
    return { label: withOwner("is vibing to"), tone: "playing", isCurrentPlaying: true }
  }
  if (data.status === "playing" && age < RECENT_WINDOW) {
    return { label: withOwner("just played"), tone: "recent", isCurrentPlaying: false }
  }
  if (data.status === "paused" && age < RECENT_WINDOW) {
    return { label: withOwner("hit pause on"), tone: "paused", isCurrentPlaying: false }
  }
  return { label: withOwner("last played"), tone: "offline", isCurrentPlaying: false }
}
