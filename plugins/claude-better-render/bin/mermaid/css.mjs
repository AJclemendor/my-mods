// Turns the CSS custom properties and color-mix() calls in beautiful-mermaid's
// SVG into plain colors. resvg reads neither, so without this every themed
// fill and stroke would be lost.
//
// The SVG declares its colors as custom properties: the root's style attribute
// sets --bg and --fg (and any of --line, --accent, --muted, --surface,
// --border), and a <style> rule derives the rest from them with color-mix().
// Each var() and color-mix() in the document is replaced by the color it
// evaluates to.

function parseColor(text) {
  const s = text.trim()
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s)
  if (hex) {
    let digits = hex[1]
    if (digits.length === 3 || digits.length === 4) digits = [...digits].map(c => c + c).join('')
    if (digits.length !== 6 && digits.length !== 8) return null
    const n = parseInt(digits.slice(0, 6), 16)
    const a = digits.length === 8 ? parseInt(digits.slice(6), 16) / 255 : 1
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a }
  }
  const rgb = /^rgba?\(([^)]*)\)$/i.exec(s)
  if (rgb) {
    const [r, g, b, a = '1'] = rgb[1].split(/[\s,/]+/).filter(Boolean)
    const alpha = a.endsWith('%') ? parseFloat(a) / 100 : Number(a)
    if ([r, g, b].some(v => !Number.isFinite(Number(v))) || !Number.isFinite(alpha)) return null
    return { r: Number(r), g: Number(g), b: Number(b), a: alpha }
  }
  return null
}

function formatColor(c) {
  const byte = v => Math.round(Math.min(255, Math.max(0, v)))
  if (c.a <= 0.001) return 'transparent'
  if (c.a >= 0.999) return '#' + [c.r, c.g, c.b].map(v => byte(v).toString(16).padStart(2, '0')).join('')
  return `rgba(${byte(c.r)},${byte(c.g)},${byte(c.b)},${Number(c.a.toFixed(3))})`
}

// color-mix(in srgb, A p%, B q%): percentages normalized to sum to 100%,
// channels interpolated premultiplied by alpha, and the alpha scaled down
// when the percentages sum to less than 100%, as CSS Color 5 defines it.
export function mixColors(a, p, b, q) {
  let pa = p
  let qb = q
  if (pa === undefined && qb === undefined) {
    pa = 0.5
    qb = 0.5
  } else if (pa === undefined) {
    pa = 1 - qb
  } else if (qb === undefined) {
    qb = 1 - pa
  }
  const sum = pa + qb
  if (sum <= 0) return { r: 0, g: 0, b: 0, a: 0 }
  const multiplier = Math.min(1, sum)
  pa /= sum
  qb /= sum
  const alpha = a.a * pa + b.a * qb
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 }
  const channel = key => (a[key] * a.a * pa + b[key] * b.a * qb) / alpha
  return { r: channel('r'), g: channel('g'), b: channel('b'), a: alpha * multiplier }
}

// The arguments of a CSS function, split at its top-level commas.
function splitArguments(inner) {
  const out = []
  let depth = 0
  let current = ''
  for (const c of inner) {
    if (c === '(') depth++
    if (c === ')') depth--
    if (c === ',' && depth === 0) {
      out.push(current.trim())
      current = ''
      continue
    }
    current += c
  }
  if (current.trim() !== '') out.push(current.trim())
  return out
}

// The call whose name starts at `start`: its inner text and the index after
// its closing parenthesis, or null when it never closes.
function callAt(text, start) {
  const open = text.indexOf('(', start)
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 }
  }
  return null
}

// Replaces every var() and color-mix() in `svg` with the color it evaluates
// to; `base` holds the custom properties to start from, such as { '--bg':
// '#282c34' }, and wins over the document's own declarations of them.
export function resolveCss(svg, base = {}) {
  const vars = new Map()
  for (const match of svg.matchAll(/(--[\w-]+)\s*:\s*([^;"}]+)/g)) vars.set(match[1], match[2].trim())
  for (const [name, value] of Object.entries(base)) vars.set(name, value)

  const resolving = new Set()
  const evaluate = expression => {
    const expr = expression.trim()
    if (expr.startsWith('var(')) {
      const call = callAt(expr, 0)
      if (call === null) return null
      const [name, ...fallback] = splitArguments(call.inner)
      if (vars.has(name) && !resolving.has(name)) {
        resolving.add(name)
        try {
          const value = evaluate(vars.get(name))
          if (value !== null) return value
        } finally {
          resolving.delete(name)
        }
      }
      return fallback.length > 0 ? evaluate(fallback.join(',')) : null
    }
    if (expr.startsWith('color-mix(')) {
      const call = callAt(expr, 0)
      if (call === null) return null
      const [, first, second] = splitArguments(call.inner)
      if (first === undefined || second === undefined) return null
      const part = text => {
        const m = /^(.*?)(?:\s+([\d.]+)%)?$/.exec(text.trim())
        const color = evaluate(m[1])
        return { color: color === null ? null : parseColor(color), share: m[2] === undefined ? undefined : Number(m[2]) / 100 }
      }
      const a = part(first)
      const b = part(second)
      if (a.color === null || b.color === null) return null
      return formatColor(mixColors(a.color, a.share, b.color, b.share))
    }
    return expr
  }

  let out = ''
  let at = 0
  const pattern = /var\(|color-mix\(/g
  for (;;) {
    pattern.lastIndex = at
    const match = pattern.exec(svg)
    if (match === null) break
    const call = callAt(svg, match.index)
    if (call === null) break
    const value = evaluate(svg.slice(match.index, call.end))
    out += svg.slice(at, match.index) + (value ?? 'none')
    at = call.end
  }
  return out + svg.slice(at)
}
