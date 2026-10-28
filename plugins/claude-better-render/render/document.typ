// Inspired by Intelligent UI's cmarker/mitex pipeline. Model-authored Typst
// is never evaluated; raw-typst is disabled and the compiler root is private.
#import "@preview/cmarker:0.1.6"
#import "@preview/mitex:0.2.7": mitex
#let doc = json("document.json")
#let fg = rgb(doc.fg)
#let bg = rgb(doc.bg)
#let accent = rgb(doc.accent)
#set page(width: doc.width * 1pt, height: auto, margin: (x: 3pt, y: 4pt), fill: bg)
#set text(font: (doc.font, "New Computer Modern"), size: doc.size * 1pt, fill: fg, weight: doc.weight)
#set par(leading: 0.65em, spacing: 0.7em)
#set heading(numbering: none)
#show heading: set text(fill: accent)
#show link: set text(fill: accent)
#show raw: set text(font: (doc.font, "DejaVu Sans Mono"), size: doc.size * 0.9pt)
#show raw.where(block: true): it => block(width: 100%, inset: 6pt, stroke: 0.4pt + accent, radius: 3pt, it)
#show quote: it => block(inset: (left: 8pt), stroke: (left: 1pt + accent), it.body)
#set table(inset: 5pt, stroke: 0.4pt + accent)
#cmarker.render(doc.source, raw-typst: false,
  math: (source, block: false) => mitex(source, block: block),
  scope: (image: (..args) => text("[image — see original source]")))
