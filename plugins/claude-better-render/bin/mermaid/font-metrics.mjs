// Works out the terminal font's cell geometry the way the terminal does, so
// the mod can size diagram pictures to whole cells without the user
// measuring anything. Adapted from latex-inline's bin/font-metrics.mjs (MIT,
// the same author). `terminalCell({ terminal })`, with `ghostty` or `kitty`,
// answers `{ ok: true, family, file, size, cell_aspect, baseline,
// line_height }`, or `{ ok: false, reason }` when the font can't be worked
// out. It reads the terminal's config file and the headers of installed font
// files, and nothing else.
//
// Ghostty (and cmux, which reads Ghostty's config) sizes a cell from the
// font's tables: the widest advance among printable ASCII is the width, and
// ascent + descent + line gap the height, both rounded to whole pixels at the
// font size times the display scale; the baseline sits where the font's
// box, centered in that rounded height, puts it. This follows Ghostty's own
// computation (MIT), in src/font/Metrics.zig and the face code of v1.3.1
// (linked in the README).
// kitty rounds differently, so for kitty the unrounded design metrics stand in.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Ghostty's built-in font, used when the config names none.
const JETBRAINS_MONO = { unitsPerEm: 1000, ascent: 1020, descent: -300, lineGap: 0, maxAsciiAdvance: 600 }
const FONT_FILE = /\.(ttf|otf|ttc|otc)$/i

// The pixel cell Ghostty draws for these unit metrics at `points` on a
// display with this backing scale, as the three numbers the mod takes.
export function ghosttyCell(metrics, points, scale) {
  const pxPerEm = points * scale
  const pxPerUnit = pxPerEm / metrics.unitsPerEm
  const faceWidth = metrics.maxAsciiAdvance * pxPerUnit
  const faceHeight = (metrics.ascent - metrics.descent + metrics.lineGap) * pxPerUnit
  const cellWidth = Math.round(faceWidth)
  const cellHeight = Math.round(faceHeight)
  const faceBaseline = (metrics.lineGap / 2 - metrics.descent) * pxPerUnit
  const cellBaseline = Math.round(faceBaseline - (cellHeight - faceHeight) / 2)
  return {
    cell_aspect: cellHeight / cellWidth,
    baseline: (cellHeight - cellBaseline) / cellHeight,
    line_height: cellHeight / pxPerEm,
  }
}

// The same three numbers from the design metrics alone, with no rounding.
export function designCell(metrics) {
  const height = metrics.ascent - metrics.descent + metrics.lineGap
  return {
    cell_aspect: height / metrics.maxAsciiAdvance,
    baseline: (metrics.ascent + metrics.lineGap / 2) / height,
    line_height: height / metrics.unitsPerEm,
  }
}

function unquote(value) {
  return value.replace(/^"(.*)"$/, '$1').trim()
}

// Ghostty's config lines are `key = value`. Repeating font-family adds a
// fallback font after the earlier ones, and an empty value clears the list.
export function parseGhosttyConfig(text) {
  let families = []
  let fontSize
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const value = unquote(line.slice(eq + 1).trim())
    if (key === 'font-family') families = value === '' ? [] : [...families, value]
    if (key === 'font-size' && Number.isFinite(Number(value)) && value !== '') fontSize = Number(value)
  }
  return { fontFamily: families[0], fontSize }
}

// kitty.conf lines are `key value`; font_family is a bare name or, from
// kitty 0.36, `family="Name" style=...`.
export function parseKittyConfig(text) {
  let fontFamily
  let fontSize
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const [key, ...rest] = line.split(/\s+/)
    const value = rest.join(' ')
    if (key === 'font_family') {
      const named = /family=(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(value)
      fontFamily = named ? (named[1] ?? named[2] ?? named[3]) : unquote(value)
      if (fontFamily === 'monospace' || fontFamily === 'auto') fontFamily = undefined
    }
    if (key === 'font_size' && Number.isFinite(Number(value))) fontSize = Number(value)
  }
  return { fontFamily, fontSize }
}

// --- Reading font files: only the headers and the tables named here. ---

function readBytes(fd, offset, length) {
  const buffer = Buffer.alloc(length)
  const read = fs.readSync(fd, buffer, 0, length, offset)
  return buffer.subarray(0, read)
}

// Table records of each face in the file: one face, or several in a collection.
function faceTables(fd) {
  const header = readBytes(fd, 0, 12)
  if (header.length < 12) return []
  const offsets = []
  if (header.toString('latin1', 0, 4) === 'ttcf') {
    const count = header.readUInt32BE(8)
    const list = readBytes(fd, 12, 4 * count)
    for (let i = 0; i < count; i++) offsets.push(list.readUInt32BE(4 * i))
  } else {
    offsets.push(0)
  }
  return offsets.map(offset => {
    const directory = readBytes(fd, offset, 12)
    const numTables = directory.readUInt16BE(4)
    const records = readBytes(fd, offset + 12, 16 * numTables)
    const tables = new Map()
    for (let i = 0; i < numTables; i++) {
      const tag = records.toString('latin1', 16 * i, 16 * i + 4)
      tables.set(tag, { offset: records.readUInt32BE(16 * i + 8), length: records.readUInt32BE(16 * i + 12) })
    }
    return tables
  })
}

function table(fd, tables, tag) {
  const record = tables.get(tag)
  return record ? readBytes(fd, record.offset, record.length) : undefined
}

// Family and style names, English first: the typographic names (16, 17)
// where the font has them, else the legacy ones (1, 2).
function faceNames(fd, tables) {
  const data = table(fd, tables, 'name')
  if (!data || data.length < 6) return { family: undefined, style: undefined }
  const count = data.readUInt16BE(2)
  const stringOffset = data.readUInt16BE(4)
  const found = new Map()
  for (let i = 0; i < count; i++) {
    const at = 6 + 12 * i
    if (at + 12 > data.length) break
    const platform = data.readUInt16BE(at)
    const language = data.readUInt16BE(at + 4)
    const nameId = data.readUInt16BE(at + 6)
    const length = data.readUInt16BE(at + 8)
    const start = stringOffset + data.readUInt16BE(at + 10)
    if (![1, 2, 16, 17].includes(nameId) || start + length > data.length) continue
    const isEnglish = (platform === 3 && language === 0x409) || (platform === 1 && language === 0) || platform === 0
    if (!isEnglish || found.has(nameId)) continue
    const bytes = data.subarray(start, start + length)
    found.set(nameId, platform === 1 ? bytes.toString('latin1') : bytes.swap16().toString('utf16le'))
  }
  return { family: found.get(16) ?? found.get(1), style: found.get(17) ?? found.get(2) }
}

// Glyph ids of printable ASCII from the cmap's Unicode subtable (format 4 or 12).
function asciiGlyphs(cmap) {
  const subtables = cmap.readUInt16BE(2)
  let chosen
  for (let i = 0; i < subtables; i++) {
    const platform = cmap.readUInt16BE(4 + 8 * i)
    const encoding = cmap.readUInt16BE(6 + 8 * i)
    const offset = cmap.readUInt32BE(8 + 8 * i)
    const isUnicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))
    const format = cmap.readUInt16BE(offset)
    if (isUnicode && (format === 4 || format === 12) && (chosen === undefined || format === 4)) chosen = { offset, format }
  }
  if (chosen === undefined) return []
  const glyphs = []
  const { offset, format } = chosen
  for (let code = 32; code < 127; code++) {
    if (format === 12) {
      const groups = cmap.readUInt32BE(offset + 12)
      for (let g = 0; g < groups; g++) {
        const at = offset + 16 + 12 * g
        const first = cmap.readUInt32BE(at)
        if (code >= first && code <= cmap.readUInt32BE(at + 4)) glyphs.push(cmap.readUInt32BE(at + 8) + code - first)
      }
      continue
    }
    const segCount = cmap.readUInt16BE(offset + 6) / 2
    const ends = offset + 14
    const starts = ends + 2 * segCount + 2
    const deltas = starts + 2 * segCount
    const rangeOffsets = deltas + 2 * segCount
    for (let s = 0; s < segCount; s++) {
      if (code > cmap.readUInt16BE(ends + 2 * s)) continue
      const start = cmap.readUInt16BE(starts + 2 * s)
      if (code < start) break
      const delta = cmap.readInt16BE(deltas + 2 * s)
      const rangeOffset = cmap.readUInt16BE(rangeOffsets + 2 * s)
      if (rangeOffset === 0) {
        glyphs.push((code + delta) & 0xffff)
      } else {
        const glyph = cmap.readUInt16BE(rangeOffsets + 2 * s + rangeOffset + 2 * (code - start))
        if (glyph !== 0) glyphs.push((glyph + delta) & 0xffff)
      }
      break
    }
  }
  return glyphs
}

function metricsOf(fd, tables) {
  const head = table(fd, tables, 'head')
  const hhea = table(fd, tables, 'hhea')
  const hmtx = table(fd, tables, 'hmtx')
  const cmap = table(fd, tables, 'cmap')
  if (!head || !hhea || !hmtx || !cmap) return undefined
  const os2 = table(fd, tables, 'OS/2')
  const hheaMetrics = [hhea.readInt16BE(4), hhea.readInt16BE(6), hhea.readInt16BE(8)]
  let vertical = hheaMetrics
  if (os2 && os2.length >= 78) {
    const typo = [os2.readInt16BE(68), os2.readInt16BE(70), os2.readInt16BE(72)]
    const useTypoMetrics = (os2.readUInt16BE(62) & (1 << 7)) !== 0
    if (useTypoMetrics) vertical = typo
    else if (hheaMetrics[0] === 0 && hheaMetrics[1] === 0) vertical = typo[0] !== 0 || typo[1] !== 0 ? typo : [os2.readUInt16BE(74), -os2.readUInt16BE(76), 0]
  }
  const longMetrics = hhea.readUInt16BE(34)
  const advance = glyph => hmtx.readUInt16BE(4 * Math.min(glyph, longMetrics - 1))
  const advances = asciiGlyphs(cmap).map(advance)
  if (advances.length === 0) return undefined
  return {
    unitsPerEm: head.readUInt16BE(18),
    ascent: vertical[0],
    descent: vertical[1],
    lineGap: vertical[2],
    maxAsciiAdvance: Math.max(...advances),
  }
}

// Every face of a font file, with its names; a file that isn't a font gives none.
export function facesOf(file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    return faceTables(fd).map(tables => ({ ...faceNames(fd, tables), tables }))
  } catch {
    return []
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

// The unit metrics of the face named `family` in the file (its first face
// when no family is given).
export function readFontMetrics(file, family) {
  const fd = fs.openSync(file, 'r')
  try {
    const faces = faceTables(fd).map(tables => ({ ...faceNames(fd, tables), tables }))
    const wanted = family?.toLowerCase()
    const face =
      faces.find(f => f.family?.toLowerCase() === wanted && /regular|book|normal/i.test(f.style ?? '')) ??
      faces.find(f => f.family?.toLowerCase() === wanted) ??
      faces[0]
    return face ? metricsOf(fd, face.tables) : undefined
  } finally {
    fs.closeSync(fd)
  }
}

function fontFiles(dir, depth = 0) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return depth < 4 ? fontFiles(full, depth + 1) : []
    return FONT_FILE.test(entry.name) ? [full] : []
  })
}

// The file holding `family`'s regular face, searching `dirs` in order.
export function findFontFile(family, dirs) {
  const wanted = family.toLowerCase()
  let fallback
  for (const dir of dirs) {
    for (const file of fontFiles(dir).sort()) {
      for (const face of facesOf(file)) {
        if (face.family?.toLowerCase() !== wanted) continue
        if (/regular|book|normal/i.test(face.style ?? '')) return file
        fallback ??= file
      }
    }
  }
  return fallback
}

export function fontDirs(home, platform) {
  if (platform === 'darwin') {
    return [path.join(home, 'Library/Fonts'), '/Library/Fonts', '/System/Library/Fonts', '/System/Library/Fonts/Supplemental']
  }
  return [path.join(home, '.local/share/fonts'), path.join(home, '.fonts'), '/usr/local/share/fonts', '/usr/share/fonts']
}

export function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

// Ghostty reads its XDG config, then on macOS the Application Support one,
// each as `config` and `config.ghostty`; later lines win.
export function ghosttyConfigText(home, xdgConfigHome, platform) {
  const xdg = xdgConfigHome || path.join(home, '.config')
  const files = [path.join(xdg, 'ghostty/config'), path.join(xdg, 'ghostty/config.ghostty')]
  if (platform === 'darwin') {
    const support = path.join(home, 'Library/Application Support/com.mitchellh.ghostty')
    files.push(path.join(support, 'config'), path.join(support, 'config.ghostty'))
  }
  return files.map(readIfExists).join('\n')
}

export function terminalCell({
  terminal,
  home = os.homedir(),
  xdgConfigHome = process.env.XDG_CONFIG_HOME,
  platform = process.platform,
}) {
  // Macs draw at a 2x backing scale, other systems mostly at 1x; the scale
  // only moves where the pixel rounding falls.
  const scale = platform === 'darwin' ? 2 : 1
  if (terminal === 'ghostty') {
    const config = parseGhosttyConfig(ghosttyConfigText(home, xdgConfigHome, platform))
    const size = config.fontSize ?? (platform === 'darwin' ? 13 : 12)
    if (config.fontFamily === undefined) {
      return { ok: true, family: 'JetBrains Mono (built in)', size, ...ghosttyCell(JETBRAINS_MONO, size, scale) }
    }
    const file = findFontFile(config.fontFamily, fontDirs(home, platform))
    if (file === undefined) return { ok: false, reason: `font "${config.fontFamily}" not found in the font folders` }
    const metrics = readFontMetrics(file, config.fontFamily)
    if (metrics === undefined) return { ok: false, reason: `could not read the metrics of ${file}` }
    return { ok: true, family: config.fontFamily, file, size, ...ghosttyCell(metrics, size, scale) }
  }
  if (terminal === 'kitty') {
    const xdg = xdgConfigHome || path.join(home, '.config')
    const config = parseKittyConfig(readIfExists(path.join(xdg, 'kitty/kitty.conf')))
    if (config.fontFamily === undefined) return { ok: false, reason: 'kitty.conf names no font_family' }
    const file = findFontFile(config.fontFamily, fontDirs(home, platform))
    if (file === undefined) return { ok: false, reason: `font "${config.fontFamily}" not found in the font folders` }
    const metrics = readFontMetrics(file, config.fontFamily)
    if (metrics === undefined) return { ok: false, reason: `could not read the metrics of ${file}` }
    return { ok: true, family: config.fontFamily, file, size: config.fontSize ?? 11, ...designCell(metrics) }
  }
  return { ok: false, reason: `no font rules for terminal "${terminal}"` }
}
