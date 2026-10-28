// Reads one JSON request on stdin and writes one JSON answer on stdout:
//
//   { items: [{ key, source, math: [{ start, end, text }], kind: 'png' | 'text', maxColumns, maxRows }], outDir,
//     rowPx, cellRatio, lineEm, textScale, theme, overrides: { bg, fg, ... },
//     terminal: { background, foreground }, prefersDark, font }
//   -> { results: [{ key, file, columns, rows } | { key, text, columns, rows } | { key, error }] }
//
// Each result is also written to `<outDir>/<key>.json`, the mod's cache, and
// each picture to `<outDir>/<key>.png`.
import fs from 'node:fs'
import path from 'node:path'

import { renderPicture, renderText } from './diagram.mjs'

const request = JSON.parse(fs.readFileSync(0, 'utf8'))
fs.mkdirSync(request.outDir, { recursive: true })
const results = []
for (const item of request.items) {
  let result
  try {
    result = item.kind === 'text' ? renderText(item) : renderPicture(item, request)
  } catch (error) {
    result = { key: item.key, error: String(error?.message ?? error).split('\n')[0].slice(0, 200) }
  }
  fs.writeFileSync(path.join(request.outDir, item.key + '.json'), JSON.stringify(result))
  results.push(result)
}
process.stdout.write(JSON.stringify({ results }))
