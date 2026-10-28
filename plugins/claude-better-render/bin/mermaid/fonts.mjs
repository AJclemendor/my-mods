// Picks the font files resvg draws a diagram's text with: a sans-serif face
// for labels, a monospace face for class members, and fallbacks for scripts
// the first two lack (Hangul, kana, Han). resvg is given these files alone,
// which keeps it from scanning every system font on each picture.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { facesOf, findFontFile, fontDirs } from './font-metrics.mjs'

// Candidates in order of preference: [file, family]. A family left out is
// read from the file. Helvetica Neue comes before San Francisco on macOS
// because resvg draws a variable font's default weight only, and the labels
// use medium and bold.
const SANS = [
  ['/System/Library/Fonts/HelveticaNeue.ttc', 'Helvetica Neue'],
  ['/System/Library/Fonts/Helvetica.ttc', 'Helvetica'],
  ['/System/Library/Fonts/Supplemental/Arial.ttf', 'Arial'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'DejaVu Sans'],
  ['/usr/share/fonts/TTF/DejaVuSans.ttf', 'DejaVu Sans'],
  ['/usr/share/fonts/dejavu/DejaVuSans.ttf', 'DejaVu Sans'],
  ['/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf', 'DejaVu Sans'],
  ['/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf', 'Noto Sans'],
  ['/usr/share/fonts/noto/NotoSans-Regular.ttf', 'Noto Sans'],
  ['/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', 'Liberation Sans'],
  ['/usr/share/fonts/liberation/LiberationSans-Regular.ttf', 'Liberation Sans'],
]
const MONO = [
  ['/System/Library/Fonts/Menlo.ttc', 'Menlo'],
  ['/System/Library/Fonts/Monaco.ttf', 'Monaco'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 'DejaVu Sans Mono'],
  ['/usr/share/fonts/TTF/DejaVuSansMono.ttf', 'DejaVu Sans Mono'],
  ['/usr/share/fonts/dejavu/DejaVuSansMono.ttf', 'DejaVu Sans Mono'],
  ['/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf', 'Liberation Mono'],
]
const FALLBACKS = [
  ['/System/Library/Fonts/AppleSDGothicNeo.ttc', 'Apple SD Gothic Neo'],
  ['/System/Library/Fonts/Hiragino Sans GB.ttc', 'Hiragino Sans GB'],
  ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 'Noto Sans CJK KR'],
  ['/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc', 'Noto Sans CJK KR'],
  ['/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc', 'Noto Sans CJK KR'],
]

function firstExisting(candidates) {
  for (const [file, family] of candidates) {
    if (!fs.existsSync(file)) continue
    return { file, family: family ?? facesOf(file)[0]?.family ?? path.basename(file) }
  }
  return undefined
}

// `font` is `auto` or a family name the user chose; a name not installed
// falls back to the automatic choice.
export function pickFonts({ font = 'auto', home = os.homedir(), platform = process.platform } = {}) {
  let sans
  if (font !== 'auto' && font.trim() !== '') {
    const file = findFontFile(font.trim(), fontDirs(home, platform))
    if (file !== undefined) sans = { file, family: font.trim() }
  }
  sans ??= firstExisting(SANS)
  const mono = firstExisting(MONO)
  const fallbacks = FALLBACKS.filter(([file]) => fs.existsSync(file)).map(([file, family]) => ({ file, family }))
  const all = [sans, mono, ...fallbacks].filter(Boolean)
  return {
    sans,
    mono,
    files: [...new Set(all.map(entry => entry.file))],
    sansStack: [sans, ...fallbacks].filter(Boolean).map(entry => `'${entry.family}'`).concat('sans-serif').join(', '),
    monoStack: [mono, ...fallbacks].filter(Boolean).map(entry => `'${entry.family}'`).concat('monospace').join(', '),
  }
}
