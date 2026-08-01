import { useEffect, useRef } from "react"
import { CHAR_COLS, CHAR_PITCH, FONT_ROWS, PIXEL_FONT, normalizeLine } from "./pixelFont.js"

export default function PixelText({ text, cell = 2, className = "" }) {
  const canvasRef = useRef(null)
  const label = normalizeLine(typeof text === "string" ? text : String(text))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || label === "") return
    const context = canvas.getContext("2d")
    const glyphs = [...label].map((glyph) => (PIXEL_FONT[glyph] ? glyph : "?"))
    const width = (glyphs.length * CHAR_PITCH - 1) * cell
    const height = FONT_ROWS * cell
    const deviceScale = window.devicePixelRatio || 1
    const tile = cell >= 3 ? cell - 1 : cell

    canvas.style.width = `${width}px`
    canvas.style.maxWidth = "100%"
    canvas.style.height = "auto"
    canvas.width = Math.round(width * deviceScale)
    canvas.height = Math.round(height * deviceScale)
    context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0)
    context.clearRect(0, 0, width, height)
    context.fillStyle = getComputedStyle(canvas).color

    glyphs.forEach((glyph, index) => {
      const bitmap = PIXEL_FONT[glyph]
      for (let row = 0; row < FONT_ROWS; row += 1) {
        for (let column = 0; column < CHAR_COLS; column += 1) {
          if (bitmap[row] & (1 << (CHAR_COLS - 1 - column))) {
            context.fillRect((index * CHAR_PITCH + column) * cell, row * cell, tile, tile)
          }
        }
      }
    })
  }, [label, cell])

  if (label === "") return null
  return <canvas className={`amw-pixel-text ${className}`.trim()} ref={canvasRef} aria-hidden="true" />
}
