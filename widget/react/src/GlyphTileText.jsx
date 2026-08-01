import { useEffect, useRef } from "react"
import { CHAR_COLS, CHAR_PITCH, FONT_ROWS, PIXEL_FONT, normalizeLine } from "./pixelFont.js"

const MIN_CELL = 4
const MAX_CELL = 9
const RASTER_ROWS = 12
const TYPE_STEP_MS = 80
const TYPE_CAP_MS = 2200
const HOLD_MS = 2600
const ERASE_STEP_MS = 45
const ERASE_CAP_MS = 1200
const GAP_MS = 350
const BLINK_MS = 530
const MARQUEE_PAUSE_MS = 450
const MARQUEE_SPEED_PX_PER_SECOND = 52
const ALPHA_THRESHOLD = 100
const INK = "#212529"
const FONT_STACK = 'Inter, "Inter Placeholder", system-ui, sans-serif'

// This is the portfolio widget's original type/hold/backspace animation. It
// types each line onto a pixel grid like retro game dialogue.
export default function GlyphTileText({ lines }) {
  const canvasRef = useRef(null)
  const linesKey = lines
    .filter((line) => typeof line === "string" && line.trim() !== "")
    .map((line) => normalizeLine(line.trim()))
    .join("\n")

  useEffect(() => {
    const canvas = canvasRef.current
    const textLines = linesKey === "" ? [] : linesKey.split("\n")
    if (!canvas || textLines.length === 0) return undefined

    const context = canvas.getContext("2d")
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    let size = { width: 0, height: 0 }
    let line = null
    let lineIndex = -1
    let lineStart = 0
    let frameId = 0

    const buildPixelLine = (chars) => {
      const maxCell = Math.min(MAX_CELL, Math.floor(size.height / FONT_ROWS))
      const fitChars = Math.max(1, Math.floor((size.width / MIN_CELL + 1) / CHAR_PITCH))
      const shouldTruncate = reducedMotion.matches && chars.length > fitChars
      const glyphs = shouldTruncate ? [...chars.slice(0, fitChars - 1), "…"] : chars
      const columnsNeeded = glyphs.length * CHAR_PITCH - 1
      const cell = Math.max(MIN_CELL, Math.min(maxCell, Math.floor(size.width / columnsNeeded)))
      const contentWidth = columnsNeeded * cell
      const overflow = contentWidth > size.width
      const xOffset = overflow ? 0 : Math.max(0, Math.floor((size.width - contentWidth) / 2))
      const yOffset = Math.floor((size.height - FONT_ROWS * cell) / 2)
      const marks = []

      glyphs.forEach((glyph, index) => {
        const bitmap = PIXEL_FONT[glyph] ?? PIXEL_FONT["?"]
        for (let row = 0; row < FONT_ROWS; row += 1) {
          for (let column = 0; column < CHAR_COLS; column += 1) {
            if (!(bitmap[row] & (1 << (CHAR_COLS - 1 - column)))) continue
            marks.push({
              x: xOffset + (index * CHAR_PITCH + column) * cell,
              y: yOffset + row * cell,
              step: index,
            })
          }
        }
      })

      return {
        marks,
        steps: glyphs.length,
        cell,
        xOffset,
        yOffset,
        hasCursor: true,
        scrollDistance: Math.max(0, contentWidth - size.width),
      }
    }

    // Non-Latin titles cannot map to the 5x7 font, so rasterize and sample
    // them onto the same tile grid.
    const buildRasterLine = (text) => {
      const cell = Math.max(3, Math.floor(size.height / RASTER_ROWS))
      const columns = Math.floor(size.width / cell)
      if (columns < 4) return { marks: [], steps: 1, cell, hasCursor: false, scrollDistance: 0 }

      const raster = document.createElement("canvas")
      raster.width = columns
      raster.height = RASTER_ROWS
      const rasterContext = raster.getContext("2d", { willReadFrequently: true })
      const setFont = (px) => {
        rasterContext.font = `700 ${px}px ${FONT_STACK}`
      }

      let fontPx = RASTER_ROWS - 1
      setFont(fontPx)
      while (fontPx > RASTER_ROWS * 0.7 && rasterContext.measureText(text).width > columns) {
        fontPx -= 0.5
        setFont(fontPx)
      }

      let label = text
      if (rasterContext.measureText(label).width > columns) {
        while (label.length > 1 && rasterContext.measureText(`${label}…`).width > columns) {
          label = label.slice(0, -1).trimEnd()
        }
        label = `${label}…`
      }

      rasterContext.textBaseline = "middle"
      rasterContext.fillStyle = "#000000"
      rasterContext.fillText(label, 0, RASTER_ROWS / 2 + 0.5)

      const image = rasterContext.getImageData(0, 0, columns, RASTER_ROWS).data
      const cells = []
      for (let column = 0; column < columns; column += 1) {
        for (let row = 0; row < RASTER_ROWS; row += 1) {
          if (image[(row * columns + column) * 4 + 3] >= ALPHA_THRESHOLD) cells.push({ column, row })
        }
      }
      if (cells.length === 0) return { marks: [], steps: 1, cell, hasCursor: false, scrollDistance: 0 }

      const minColumn = cells[0].column
      const maxColumn = cells.at(-1).column
      const shift = Math.floor((columns - (maxColumn - minColumn + 1)) / 2) - minColumn
      const yOffset = Math.floor((size.height - RASTER_ROWS * cell) / 2)
      const marks = cells.map(({ column, row }) => ({
        x: (column + shift) * cell,
        y: yOffset + row * cell,
        step: Math.floor((column - minColumn) / CHAR_PITCH),
      }))

      return { marks, steps: marks.at(-1).step + 1, cell, hasCursor: false, scrollDistance: 0 }
    }

    const buildLine = (text) => {
      const chars = [...text]
      const known = chars.filter((glyph) => PIXEL_FONT[glyph] !== undefined).length
      const built = known / chars.length >= 0.7 ? buildPixelLine(chars) : buildRasterLine(text)
      const steps = Math.max(1, built.steps)
      built.typeStep = Math.min(TYPE_STEP_MS, TYPE_CAP_MS / steps)
      built.typeDuration = steps * built.typeStep
      built.eraseStep = Math.min(ERASE_STEP_MS, ERASE_CAP_MS / steps)
      built.eraseDuration = steps * built.eraseStep
      built.holdDuration = built.scrollDistance > 0
        ? MARQUEE_PAUSE_MS * 2 + (built.scrollDistance / MARQUEE_SPEED_PX_PER_SECOND) * 1000
        : HOLD_MS
      built.total = built.typeDuration + built.holdDuration + built.eraseDuration + GAP_MS
      return built
    }

    const drawMarks = (revealedSteps, scrollOffset = 0) => {
      const tile = line.cell - (line.cell > 6 ? 2 : 1)
      context.fillStyle = INK
      line.marks.forEach((mark) => {
        if (mark.step < revealedSteps) context.fillRect(mark.x - scrollOffset, mark.y, tile, tile)
      })
    }

    const drawCursor = (slot, scrollOffset = 0) => {
      if (!line.hasCursor) return
      const x = line.xOffset + slot * CHAR_PITCH * line.cell - scrollOffset
      if (x + CHAR_COLS * line.cell > size.width) return
      const tile = line.cell - (line.cell > 6 ? 2 : 1)
      context.fillStyle = INK
      for (let row = 0; row < FONT_ROWS; row += 1) {
        for (let column = 0; column < CHAR_COLS; column += 1) {
          context.fillRect(x + column * line.cell, line.yOffset + row * line.cell, tile, tile)
        }
      }
    }

    const drawStaticLine = () => {
      line = buildLine(textLines[0])
      context.clearRect(0, 0, size.width, size.height)
      drawMarks(line.steps)
    }

    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      const deviceScale = window.devicePixelRatio || 1
      const backingWidth = Math.round(bounds.width * deviceScale)
      if (size.width === bounds.width && size.height === bounds.height && canvas.width === backingWidth) return

      size = { width: bounds.width, height: bounds.height }
      canvas.width = backingWidth
      canvas.height = Math.round(bounds.height * deviceScale)
      context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0)

      if (reducedMotion.matches) {
        drawStaticLine()
      } else {
        lineIndex -= 1
        line = null
      }
    }

    const render = (now) => {
      if (line === null || now - lineStart >= line.total) {
        lineIndex = (lineIndex + 1 + textLines.length) % textLines.length
        line = buildLine(textLines[lineIndex])
        lineStart = now
      }

      const elapsed = now - lineStart
      let revealedSteps
      let cursorVisible = true
      let scrollOffset = 0

      if (elapsed < line.typeDuration) {
        revealedSteps = Math.min(line.steps, Math.floor(elapsed / line.typeStep) + 1)
      } else if (elapsed < line.typeDuration + line.holdDuration) {
        revealedSteps = line.steps
        cursorVisible = Math.floor((elapsed - line.typeDuration) / BLINK_MS) % 2 === 0
        if (line.scrollDistance > 0) {
          const marqueeElapsed = Math.max(0, elapsed - line.typeDuration - MARQUEE_PAUSE_MS)
          const marqueeDuration = line.holdDuration - MARQUEE_PAUSE_MS * 2
          scrollOffset = Math.min(1, marqueeElapsed / marqueeDuration) * line.scrollDistance
        }
      } else if (elapsed < line.typeDuration + line.holdDuration + line.eraseDuration) {
        const erased = Math.floor((elapsed - line.typeDuration - line.holdDuration) / line.eraseStep) + 1
        revealedSteps = Math.max(0, line.steps - erased)
        cursorVisible = revealedSteps > 0
        scrollOffset = line.scrollDistance
      } else {
        revealedSteps = 0
        cursorVisible = false
      }

      context.clearRect(0, 0, size.width, size.height)
      drawMarks(revealedSteps, scrollOffset)
      if (cursorVisible) drawCursor(revealedSteps, scrollOffset)
      frameId = window.requestAnimationFrame(render)
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)
    resize()

    let running = false
    let inView = false
    const start = () => {
      if (running || reducedMotion.matches) return
      running = true
      frameId = window.requestAnimationFrame(render)
    }
    const stop = () => {
      if (!running) return
      running = false
      window.cancelAnimationFrame(frameId)
    }
    const updateRunning = () => {
      if (inView && !document.hidden) start()
      else stop()
    }

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting
      updateRunning()
    })
    intersectionObserver.observe(canvas)
    document.addEventListener("visibilitychange", updateRunning)

    return () => {
      stop()
      document.removeEventListener("visibilitychange", updateRunning)
      intersectionObserver.disconnect()
      resizeObserver.disconnect()
    }
  }, [linesKey])

  return <canvas className="amw-glyph-text" ref={canvasRef} aria-hidden="true" />
}
