// Reads one JSON request on stdin, `{ terminal, prefersDark }` with `ghostty`
// or `kitty`, and writes one JSON answer: the font's cell geometry
// (font-metrics.mjs) and the terminal's colors (terminal-colors.mjs), each
// `{ ok: true, ... }` or `{ ok: false, reason }`.
import fs from 'node:fs'

import { terminalCell } from './font-metrics.mjs'
import { terminalColors } from './terminal-colors.mjs'

const settle = work => {
  try {
    return work()
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) }
  }
}

let request = {}
try {
  request = JSON.parse(fs.readFileSync(0, 'utf8'))
} catch {
  // An unreadable request is answered as a terminal with no rules.
}
process.stdout.write(
  JSON.stringify({
    cell: settle(() => terminalCell({ terminal: request.terminal })),
    colors: settle(() => terminalColors({ terminal: request.terminal, prefersDark: request.prefersDark !== false })),
  }),
)
