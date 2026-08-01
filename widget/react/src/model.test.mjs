import assert from "node:assert/strict"
import test from "node:test"
import { estimatePosition, formatTime, getPresentation } from "./model.js"

const NOW = Date.parse("2026-08-01T12:02:00Z")

test("formats time and extrapolates active progress", () => {
  assert.equal(formatTime(125.8), "2:05")
  assert.equal(estimatePosition({
    positionSeconds: 40,
    durationSeconds: 100,
    capturedAt: "2026-08-01T12:01:50Z",
  }, NOW, true), 50)
})

test("clamps progress to duration", () => {
  assert.equal(estimatePosition({
    positionSeconds: 98,
    durationSeconds: 100,
    capturedAt: "2026-08-01T12:01:50Z",
  }, NOW, true), 100)
})

test("uses configurable owner labels and freshness", () => {
  assert.deepEqual(
    getPresentation({ status: "playing", capturedAt: "2026-08-01T12:01:30Z" }, NOW, false, "Maya"),
    { label: "Maya is vibing to", tone: "playing", isCurrentPlaying: true },
  )
  assert.equal(
    getPresentation({ status: "paused", capturedAt: "2026-08-01T12:01:30Z" }, NOW, false, "Maya").label,
    "Maya hit pause on",
  )
  assert.equal(
    getPresentation({ status: "playing", capturedAt: "2026-08-01T11:00:00Z" }, NOW, false, "Maya").tone,
    "offline",
  )
})
