// Draws one Mermaid diagram: as a PNG sized to whole terminal cells, or as
// Unicode box drawing. beautiful-mermaid lays the diagram out (as SVG, or as
// text), css.mjs turns its themed colors into plain ones, and resvg
// rasterizes the SVG.
//
// A picture is padded to an exact number of cells: the terminal stretches a
// picture to fill its box, so a box that matches the picture's own aspect
// keeps the diagram undistorted. Its labels are drawn at `textScale` times
// the terminal's text size, shrunk when the diagram would be wider than
// `maxColumns`.
//
// The packages are the plugin's own node_modules, which Claude Code installs
// from package-lock.json when the plugin is installed.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { THEMES, parseMermaid, renderMermaidASCII, renderMermaidSVG } from 'beautiful-mermaid'

import { resolveCss } from './css.mjs'
import { pickFonts } from './fonts.mjs'

const require = createRequire(import.meta.url)
const { Resvg } = require('@resvg/resvg-js')

// beautiful-mermaid draws node labels at 13px: the size matched to the
// terminal's text.
const LABEL_PX = 13
// The most cells an Image may span either way.
const MAX_CELLS = 255
// The least a diagram is shrunk to fit the screen's height, as a share of
// its labels' size.
const MIN_SHRINK = 0.6
// Canvas padding around the diagram, in the SVG's px; a card gets more.
const PADDING = 8
const CARD_PADDING = 20
const COLOR_KEYS = ['bg', 'fg', 'line', 'accent', 'muted', 'surface', 'border']

// Scripts the label font may lack: Hangul, kana, Han and the rest of CJK.
const WIDE_SCRIPT = /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/

// Combining marks, which the terminal draws over the letter before them in
// no cell of their own: accents, and the arrow of a vector.
const COMBINING = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]+/g

// Terminal cells a line of text takes: Hangul, CJK and emoji take two,
// combining marks none.
export function cellWidth(text) {
  let width = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    if (ch.replace(COMBINING, '') === '' || (c >= 0x200b && c <= 0x200f)) continue
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x1f300 && c <= 0x1faff)
    width += wide ? 2 : 1
  }
  return width
}

// Colors when the theme is `auto` and the terminal's are unknown, by
// Claude Code's theme.
const DARK = { bg: '#282c34', fg: '#e8e8e8' }
const LIGHT = { bg: '#ffffff', fg: '#24292f' }
// The `auto` theme's accent (arrow heads, chart series): Claude's orange.
const CLAUDE_ORANGE = '#d77757'

function isLight(hex) {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140
}

// The colors a diagram is drawn in, and whether it sits on a card of its own.
// `auto` draws on the terminal's background in its text color, with Claude's
// orange for arrow heads, and no card: the picture's transparent pixels show
// the terminal itself. A named theme
// (one of beautiful-mermaid's) brings its own background, drawn as a card.
// `overrides` (bg, fg, line, accent, muted, surface, border) win over both.
export function diagramColors({ theme = 'auto', overrides = {}, terminal = {}, prefersDark = true } = {}) {
  const preset = theme !== 'auto' ? THEMES[theme] : undefined
  let colors
  if (preset) {
    colors = { ...preset }
  } else {
    const fallback = prefersDark ? DARK : LIGHT
    const bg = terminal.background ?? fallback.bg
    const fg = terminal.foreground ?? (terminal.background ? (isLight(bg) ? LIGHT.fg : DARK.fg) : fallback.fg)
    colors = { bg, fg, accent: CLAUDE_ORANGE }
  }
  for (const key of COLOR_KEYS) if (typeof overrides[key] === 'string') colors[key] = overrides[key]
  return { colors, card: preset !== undefined, theme: preset ? theme : 'auto' }
}

// The SVG with plain colors, no web font import and the chosen fonts.
export function prepareSvg(svg, colors, fonts) {
  const base = {}
  for (const name of COLOR_KEYS) if (colors[name]) base['--' + name] = colors[name]
  return resolveCss(svg, base)
    .replace(/@import url\([^)]*\);?/g, '')
    .replace(/(text\s*\{\s*font-family:)[^;}]*/g, `$1 ${fonts.sansStack}`)
    .replace(/(\.mono\s*\{\s*font-family:)[^;}]*/g, `$1 ${fonts.monoStack}`)
}

// How big the picture is drawn: the scale from the SVG's px to the
// picture's, and the cells it fills. A diagram wider than `maxColumns` is
// shrunk to fit; one taller than `maxRows` is shrunk toward it, but its
// labels no smaller than MIN_SHRINK of their size, so a long diagram stays
// readable and scrolls.
export function fitToCells({ width, height }, request, maxColumns, maxRows = MAX_CELLS) {
  const rowPx = request.rowPx
  const cellPx = rowPx / request.cellRatio
  const fontPx = rowPx / request.lineEm
  const natural = (fontPx * request.textScale) / LABEL_PX
  let scale = natural
  const columnsLimit = Math.max(1, Math.min(MAX_CELLS, maxColumns))
  if (width * scale > columnsLimit * cellPx) scale = (columnsLimit * cellPx) / width
  const rowsLimit = Math.max(1, Math.min(MAX_CELLS, maxRows))
  if (height * scale > rowsLimit * rowPx) scale = Math.min(scale, Math.max((rowsLimit * rowPx) / height, natural * MIN_SHRINK))
  if (height * scale > MAX_CELLS * rowPx) scale = (MAX_CELLS * rowPx) / height
  const columns = Math.max(1, Math.min(columnsLimit, Math.ceil((width * scale) / cellPx - 1e-6)))
  const rows = Math.max(1, Math.min(MAX_CELLS, Math.ceil((height * scale) / rowPx - 1e-6)))
  return { scale, columns, rows, pixelWidth: Math.round(columns * cellPx), pixelHeight: rows * rowPx, fontPx }
}

// What parseMermaid reads of a diagram, its labels aside, or undefined when
// it can't read the diagram.
function structureOf(source) {
  try {
    const graph = parseMermaid(source)
    const subgraph = sub => [sub.id, sub.nodeIds, sub.children.map(subgraph)]
    return JSON.stringify({
      direction: graph.direction,
      nodes: [...graph.nodes.values()].map(node => [node.id, node.shape]),
      edges: graph.edges.map(edge => [edge.source, edge.target, edge.style, edge.hasArrowStart, edge.hasArrowEnd, edge.label === undefined]),
      subgraphs: graph.subgraphs.map(subgraph),
    })
  } catch {
    return undefined
  }
}

// Characters that are syntax in some diagram's labels: a bracket ends a
// label or a list, a comma or a semicolon divides one, a bar or a quote
// ends one.
const LABEL_SYNTAX = /[[\](){},;|"]/g

// The word that names a diagram's kind: its first, past blank lines and
// comments.
function kindOf(source) {
  const line = source.split('\n').find(row => row.trim() !== '' && !row.trim().startsWith('%%')) ?? ''
  return line.trim().split(/\s+/)[0] ?? ''
}

// A diagram's source with the formulas the mod found in it put in as their
// Unicode text, one at a time and only where the diagram keeps its
// structure: the text can hold a bracket or a bar, which can end a label or
// turn it into another shape. It can't be escaped instead: beautiful-mermaid
// decodes no entity codes, and ends a `[…]` label at its first `]` even inside
// quotes. A diagram parseMermaid reads must read the same with it. A sequence diagram, whose labels run to the end of their line,
// takes every formula. Another diagram takes one whose text adds no
// character that is syntax in a label: `\binom{n}{k}` reads as C(n, k), whose
// comma would split an XY chart's category in two.
export function withMath(source, math = []) {
  const base = structureOf(source)
  const lineLabels = base === undefined && kindOf(source) === 'sequenceDiagram'
  let out = source
  let shift = 0
  for (const { start, end, text } of math) {
    const tex = source.slice(start, end)
    const tried = out.slice(0, start + shift) + text + out.slice(end + shift)
    const keeps = base !== undefined ? structureOf(tried) === base : lineLabels || [...text.matchAll(LABEL_SYNTAX)].every(([ch]) => tex.includes(ch))
    if (!keeps) continue
    out = tried
    shift += text.length - (end - start)
  }
  return out
}

export function renderPicture(item, request) {
  const { colors, card } = diagramColors(request)
  const source = withMath(item.source, item.math)
  const raw = renderMermaidSVG(source, {
    ...Object.fromEntries(COLOR_KEYS.filter(key => colors[key]).map(key => [key, colors[key]])),
    transparent: true,
    padding: card ? CARD_PADDING : PADDING,
  })
  const viewBox = /viewBox="([^"]+)"/.exec(raw)
  const [, , width, height] = (viewBox?.[1] ?? '0 0 0 0').split(/\s+/).map(Number)
  if (!(width > 0 && height > 0)) throw new Error('nothing to draw')

  const fonts = pickFonts({ font: request.font })
  if (!WIDE_SCRIPT.test(source)) fonts.files = [fonts.sans?.file, fonts.mono?.file].filter(Boolean)
  const svg = prepareSvg(raw, colors, fonts)
  const fit = fitToCells({ width, height }, request, item.maxColumns, item.maxRows)
  const drawnWidth = width * fit.scale
  const drawnHeight = height * fit.scale
  const x = (fit.pixelWidth - drawnWidth) / 2
  const y = (fit.pixelHeight - drawnHeight) / 2
  const inner = svg.replace(/^<svg[^>]*>/, `<svg x="${x}" y="${y}" width="${drawnWidth}" height="${drawnHeight}" viewBox="0 0 ${width} ${height}">`)
  const radius = Math.round(fit.fontPx * 0.5)
  const backdrop = card ? `<rect x="${x}" y="${y}" width="${drawnWidth}" height="${drawnHeight}" rx="${radius}" ry="${radius}" fill="${colors.bg}"/>` : ''
  // The page takes the SVG namespace the diagram itself declares.
  const namespace = /xmlns="([^"]+)"/.exec(raw)?.[1] ?? ''
  const page = `<svg xmlns="${namespace}" width="${fit.pixelWidth}" height="${fit.pixelHeight}" viewBox="0 0 ${fit.pixelWidth} ${fit.pixelHeight}">${backdrop}${inner}</svg>`
  const png = new Resvg(page, {
    fitTo: { mode: 'original' },
    font: { loadSystemFonts: false, fontFiles: fonts.files, defaultFontFamily: fonts.sans?.family ?? 'sans-serif' },
  })
    .render()
    .asPng()
  const file = path.join(request.outDir, item.key + '.png')
  fs.writeFileSync(file, png)
  return { key: item.key, file, columns: fit.columns, rows: fit.rows }
}

// beautiful-mermaid gives a character one cell per UTF-16 unit: a combining
// mark gets a cell the terminal does not draw, and a letter beyond the BMP,
// such as 𝒜, two where the terminal draws one. Spaces after them fill those
// cells, so the box lines after them stay in their columns.
function fillCells(art) {
  let out = ''
  let owed = 0
  for (const ch of art) {
    const drawn = cellWidth(ch)
    if (drawn > 0 && owed > 0) {
      out += ' '.repeat(owed)
      owed = 0
    }
    out += ch
    owed += Math.max(0, ch.length - drawn)
  }
  return out + ' '.repeat(owed)
}

export function renderText(item) {
  const art = fillCells(renderMermaidASCII(withMath(item.source, item.math), { colorMode: 'none' })).replace(/\s+$/g, '')
  const lines = art.split('\n').map(line => line.replace(/\s+$/, ''))
  const columns = Math.max(0, ...lines.map(cellWidth))
  if (columns === 0) throw new Error('nothing to draw')
  if (columns > item.maxColumns) throw new Error(`${columns} columns wide, wider than the ${item.maxColumns} there are`)
  return { key: item.key, text: lines.join('\n'), columns, rows: lines.length }
}
