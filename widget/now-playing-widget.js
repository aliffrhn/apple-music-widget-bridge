const DEFAULT_ENDPOINT = "/api/now-playing";

export function formatTime(value) {
  const seconds = Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function estimatePosition(state, now = Date.now()) {
  const position = Number.isFinite(state?.positionSeconds) ? state.positionSeconds : 0;
  const duration = Number.isFinite(state?.durationSeconds) ? state.durationSeconds : 0;
  if (!state?.isPlaying) return Math.min(position, duration || position);
  const capturedAt = Date.parse(state.capturedAt);
  const elapsed = Number.isFinite(capturedAt) ? Math.max(0, (now - capturedAt) / 1000) : 0;
  return Math.min(position + elapsed, duration || position + elapsed);
}

export function normalizePublicState(input, responseUrl) {
  if (!input || typeof input !== "object" || input.schemaVersion !== 1) {
    throw new Error("Unsupported now-playing response");
  }
  const statuses = new Set(["playing", "paused", "stopped", "not_open", "unavailable"]);
  if (!statuses.has(input.status) || typeof input.isPlaying !== "boolean") {
    throw new Error("Invalid now-playing response");
  }
  const artworkUrl = input.artworkUrl
    ? new URL(input.artworkUrl, responseUrl ?? globalThis.location?.href ?? "http://localhost").href
    : null;
  return {
    schemaVersion: 1,
    status: input.status,
    isPlaying: input.isPlaying,
    title: typeof input.title === "string" ? input.title : null,
    artist: typeof input.artist === "string" ? input.artist : null,
    album: typeof input.album === "string" ? input.album : null,
    durationSeconds: Number.isFinite(input.durationSeconds) ? input.durationSeconds : null,
    positionSeconds: Number.isFinite(input.positionSeconds) ? input.positionSeconds : null,
    capturedAt: typeof input.capturedAt === "string" ? input.capturedAt : new Date(0).toISOString(),
    artworkUrl,
  };
}

const styles = `
  :host {
    --now-playing-background: #171719;
    --now-playing-foreground: #f6f6f7;
    --now-playing-muted: #a5a5aa;
    --now-playing-accent: #fa2d48;
    --now-playing-radius: 22px;
    --now-playing-width: 420px;
    display: block;
    width: min(100%, var(--now-playing-width));
    color: var(--now-playing-foreground);
    font: 500 14px/1.35 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  .card {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
    gap: 18px;
    align-items: center;
    min-height: 128px;
    padding: 18px;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--now-playing-foreground) 10%, transparent);
    border-radius: var(--now-playing-radius);
    background: var(--now-playing-background);
    box-shadow: 0 18px 50px rgb(0 0 0 / 18%);
  }
  .artwork-wrap {
    width: 92px;
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: calc(var(--now-playing-radius) - 8px);
    background: color-mix(in srgb, var(--now-playing-foreground) 8%, transparent);
  }
  .artwork { width: 100%; height: 100%; object-fit: cover; display: block; }
  .artwork[hidden] { display: none; }
  .placeholder { display: grid; width: 100%; height: 100%; place-items: center; color: var(--now-playing-muted); }
  .placeholder svg { width: 34px; height: 34px; fill: currentColor; }
  .content { min-width: 0; }
  .eyebrow { margin: 0 0 7px; color: var(--now-playing-muted); font-size: 12px; letter-spacing: .02em; }
  .title, .artist { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title { font-size: 18px; font-weight: 720; letter-spacing: -.02em; }
  .artist { margin-top: 3px; color: var(--now-playing-muted); font-weight: 450; }
  .progress { height: 3px; margin-top: 15px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--now-playing-foreground) 15%, transparent); }
  .progress-value { width: 0; height: 100%; border-radius: inherit; background: var(--now-playing-accent); transition: width 250ms linear; }
  .times { display: flex; justify-content: space-between; margin-top: 5px; color: var(--now-playing-muted); font-size: 10px; font-variant-numeric: tabular-nums; }
  .message { grid-column: 1 / -1; padding: 13px 4px; color: var(--now-playing-muted); text-align: center; }
  @media (max-width: 360px) {
    .card { grid-template-columns: 72px minmax(0, 1fr); gap: 14px; padding: 14px; min-height: 104px; }
    .artwork-wrap { width: 72px; }
  }
  @media (prefers-reduced-motion: reduce) { .progress-value { transition: none; } }
`;

function createElement(tag, className) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
}

export const NowPlayingWidget = typeof HTMLElement === "undefined" ? null : class extends HTMLElement {
  static observedAttributes = ["endpoint", "owner-name", "refresh-seconds"];

  constructor() {
    super();
    this.state = null;
    this.timer = null;
    this.progressTimer = null;
    this.controller = null;
    this.requestInFlight = false;
    this.root = this.attachShadow({ mode: "open" });
    this.handleVisibility = () => {
      if (document.visibilityState === "visible") this.refresh();
    };
  }

  connectedCallback() {
    this.build();
    if (!this.state) this.renderMessage("Loading now playing…");
    document.addEventListener("visibilitychange", this.handleVisibility);
    this.start();
  }

  disconnectedCallback() {
    document.removeEventListener("visibilitychange", this.handleVisibility);
    clearInterval(this.timer);
    clearTimeout(this.progressTimer);
    this.controller?.abort();
  }

  attributeChangedCallback() {
    if (!this.isConnected) return;
    this.start();
  }

  build() {
    if (this.card) return;
    const style = createElement("style");
    style.textContent = styles;
    this.card = createElement("section", "card");
    this.card.setAttribute("part", "card");

    const artworkWrap = createElement("div", "artwork-wrap");
    this.artwork = createElement("img", "artwork");
    this.artwork.alt = "";
    this.artwork.loading = "lazy";
    this.artwork.hidden = true;
    this.artwork.addEventListener("error", () => {
      this.artwork.hidden = true;
      this.placeholder.hidden = false;
    });
    this.placeholder = createElement("div", "placeholder");
    this.placeholder.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6Z"/></svg>';
    artworkWrap.append(this.artwork, this.placeholder);

    const content = createElement("div", "content");
    this.eyebrow = createElement("p", "eyebrow");
    this.titleElement = createElement("p", "title");
    this.artistElement = createElement("p", "artist");
    const progress = createElement("div", "progress");
    progress.setAttribute("role", "progressbar");
    this.progress = progress;
    this.progressValue = createElement("div", "progress-value");
    progress.append(this.progressValue);
    const times = createElement("div", "times");
    this.elapsed = createElement("span");
    this.duration = createElement("span");
    times.append(this.elapsed, this.duration);
    content.append(this.eyebrow, this.titleElement, this.artistElement, progress, times);
    this.card.append(artworkWrap, content);
    this.root.append(style, this.card);
  }

  get endpoint() {
    return this.getAttribute("endpoint") || DEFAULT_ENDPOINT;
  }

  get refreshMilliseconds() {
    const seconds = Number(this.getAttribute("refresh-seconds") || 10);
    return Math.min(300, Math.max(5, Number.isFinite(seconds) ? seconds : 10)) * 1000;
  }

  start() {
    clearInterval(this.timer);
    this.refresh();
    this.timer = setInterval(() => {
      if (document.visibilityState !== "hidden") this.refresh();
    }, this.refreshMilliseconds);
  }

  async refresh() {
    if (this.requestInFlight) return;
    this.requestInFlight = true;
    this.controller?.abort();
    this.controller = new AbortController();
    const timeout = setTimeout(() => this.controller.abort(), 8000);
    try {
      const response = await fetch(this.endpoint, {
        headers: { accept: "application/json" },
        signal: this.controller.signal,
      });
      if (!response.ok) throw new Error(`Now-playing request failed with HTTP ${response.status}`);
      this.state = normalizePublicState(await response.json(), response.url);
      this.render();
      this.dispatchEvent(new CustomEvent("now-playing-update", { detail: this.state }));
    } catch (error) {
      if (error.name !== "AbortError" && !this.state) this.renderMessage("Now playing is temporarily unavailable");
      this.dispatchEvent(new CustomEvent("now-playing-error", { detail: error }));
    } finally {
      clearTimeout(timeout);
      this.requestInFlight = false;
    }
  }

  renderMessage(message) {
    this.card.replaceChildren();
    const element = createElement("div", "message");
    element.textContent = message;
    this.card.append(element);
  }

  render() {
    if (!this.state?.title) {
      const idle = this.getAttribute("idle-label") || "Nothing playing right now";
      this.renderMessage(idle);
      return;
    }
    if (!this.artwork?.isConnected) {
      this.card.replaceChildren();
      this.card = null;
      this.root.replaceChildren();
      this.build();
    }
    const owner = this.getAttribute("owner-name")?.trim();
    if (this.state.isPlaying) {
      this.eyebrow.textContent = this.getAttribute("playing-label") || (owner ? `${owner} is listening to` : "Now playing");
    } else if (this.state.status === "paused") {
      this.eyebrow.textContent = this.getAttribute("paused-label") || (owner ? `${owner} paused on` : "Paused");
    } else {
      this.eyebrow.textContent = this.getAttribute("stopped-label") || (owner ? `${owner} last played` : "Last played");
    }
    this.titleElement.textContent = this.state.title;
    this.artistElement.textContent = this.state.artist || this.state.album || "Unknown artist";
    this.artwork.alt = this.state.album ? `Artwork for ${this.state.album}` : "Current track artwork";
    this.artwork.hidden = !this.state.artworkUrl;
    this.placeholder.hidden = Boolean(this.state.artworkUrl);
    if (this.state.artworkUrl && this.artwork.src !== this.state.artworkUrl) this.artwork.src = this.state.artworkUrl;
    this.tick();
  }

  tick() {
    clearTimeout(this.progressTimer);
    if (!this.state?.title || !this.progress?.isConnected) return;
    const position = estimatePosition(this.state);
    const duration = this.state.durationSeconds || 0;
    const percentage = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
    this.progressValue.style.width = `${percentage}%`;
    this.progress.setAttribute("aria-valuemin", "0");
    this.progress.setAttribute("aria-valuemax", String(duration));
    this.progress.setAttribute("aria-valuenow", String(Math.floor(position)));
    this.elapsed.textContent = formatTime(position);
    this.duration.textContent = formatTime(duration);
    this.progressTimer = setTimeout(() => this.tick(), 500);
  }
};

if (NowPlayingWidget && !customElements.get("now-playing-widget")) {
  customElements.define("now-playing-widget", NowPlayingWidget);
}
