import { useEffect, useRef, useState } from "react"

const DEFAULT_POLL_INTERVAL = 15_000

export function normalizeNowPlaying(input, responseUrl) {
  if (!input || input.schemaVersion !== 1) throw new Error("Unsupported now-playing response")
  return {
    schemaVersion: 1,
    status: input.status,
    isPlaying: Boolean(input.isPlaying),
    title: typeof input.title === "string" ? input.title : null,
    artist: typeof input.artist === "string" ? input.artist : null,
    album: typeof input.album === "string" ? input.album : null,
    albumArtist: typeof input.albumArtist === "string" ? input.albumArtist : null,
    genre: typeof input.genre === "string" ? input.genre : null,
    year: Number.isInteger(input.year) ? input.year : null,
    durationSeconds: Number.isFinite(input.durationSeconds) ? input.durationSeconds : null,
    positionSeconds: Number.isFinite(input.positionSeconds) ? input.positionSeconds : null,
    persistentId: typeof input.persistentId === "string" ? input.persistentId : null,
    artworkUrl: input.artworkUrl ? new URL(input.artworkUrl, responseUrl).href : null,
    capturedAt: input.capturedAt,
  }
}

export function useNowPlaying(endpoint = "/api/now-playing", pollInterval = DEFAULT_POLL_INTERVAL) {
  const [state, setState] = useState({
    data: null,
    loading: true,
    error: null,
    isOffline: typeof navigator !== "undefined" && !navigator.onLine,
  })
  const requestInFlight = useRef(false)

  useEffect(() => {
    let active = true
    let activeController = null

    const fetchNowPlaying = async () => {
      if (!active || requestInFlight.current || !navigator.onLine) return
      requestInFlight.current = true
      activeController = new AbortController()
      const timeout = window.setTimeout(() => activeController?.abort(), 8000)
      try {
        const response = await fetch(endpoint, {
          headers: { accept: "application/json" },
          signal: activeController.signal,
        })
        if (!response.ok) throw new Error(`Now-playing request failed with HTTP ${response.status}`)
        const data = normalizeNowPlaying(await response.json(), response.url)
        if (!active) return
        setState({ data, loading: false, error: null, isOffline: false })
      } catch (error) {
        if (!active || error.name === "AbortError") return
        setState((current) => ({
          ...current,
          loading: false,
          error: "Now playing is temporarily unavailable.",
        }))
      } finally {
        window.clearTimeout(timeout)
        requestInFlight.current = false
      }
    }

    const handleOnline = () => {
      setState((current) => ({ ...current, isOffline: false }))
      fetchNowPlaying()
    }
    const handleOffline = () => setState((current) => ({ ...current, isOffline: true }))

    fetchNowPlaying()
    const timer = window.setInterval(fetchNowPlaying, Math.max(5000, pollInterval))
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      active = false
      activeController?.abort()
      requestInFlight.current = false
      window.clearInterval(timer)
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [endpoint, pollInterval])

  return state
}
