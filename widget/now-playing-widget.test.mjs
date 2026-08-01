import assert from "node:assert/strict";
import test from "node:test";
import { estimatePosition, formatTime, normalizePublicState } from "./now-playing-widget.js";

test("formats playback time", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(125.9), "2:05");
  assert.equal(formatTime(-10), "0:00");
});

test("estimates playing position and clamps it to duration", () => {
  const capturedAt = "2026-08-01T12:00:00.000Z";
  assert.equal(estimatePosition({ isPlaying: true, positionSeconds: 30, durationSeconds: 100, capturedAt }, Date.parse("2026-08-01T12:00:05Z")), 35);
  assert.equal(estimatePosition({ isPlaying: true, positionSeconds: 98, durationSeconds: 100, capturedAt }, Date.parse("2026-08-01T12:00:05Z")), 100);
  assert.equal(estimatePosition({ isPlaying: false, positionSeconds: 30, durationSeconds: 100, capturedAt }, Date.parse("2026-08-01T12:00:05Z")), 30);
});

test("normalizes a public receiver response and resolves artwork URLs", () => {
  const value = normalizePublicState({
    schemaVersion: 1,
    status: "playing",
    isPlaying: true,
    title: "Song",
    artist: "Artist",
    album: "Album",
    durationSeconds: 120,
    positionSeconds: 10,
    capturedAt: "2026-08-01T12:00:00Z",
    artworkUrl: "/api/now-playing/artwork?id=1",
  }, "https://example.com/api/now-playing");
  assert.equal(value.artworkUrl, "https://example.com/api/now-playing/artwork?id=1");
});

test("rejects unsupported schemas", () => {
  assert.throws(() => normalizePublicState({ schemaVersion: 2 }), /Unsupported/);
});
