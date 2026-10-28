# Credits and third-party notices

Claude Better Render is assembled and maintained by AJclemendor. It is an independent project, not an official Anthropic product. The following projects made it possible. Their authors do not endorse or maintain this combination.

## Intelligent UI

[razorback16/cc-intelligent-ui](https://github.com/razorback16/cc-intelligent-ui), version 0.3.4, commit `18f2e67b1765f2abffc05e8daa4a7039f669de38`. MIT licensed.

Typesetting design; adapted image conversion template; cmarker and mitex package distribution.

## Prismantis

[NahumLitvin/prismantis](https://github.com/NahumLitvin/prismantis), version 0.36.0, commit `ed085d7c7d649241025a739d398f00c2d3b0c9a9`. MIT licensed.

Adapted pure Markdown parser, themed text/table/code rendering, palettes and Unicode diagrams.

## Mermaid Inline

[dazebug/mermaid-inline](https://github.com/dazebug/mermaid-inline), version 0.1.3, commit `95fe13c4ed4eb9c6163d1abf09fd8212281c5bd0`. MIT licensed.

Adapted graphical diagram renderer and terminal font/color measurement.

## Inline Images

[kbrianps/claude-inline-images](https://github.com/kbrianps/claude-inline-images), version 0.2.0, commit `ced2e2cfeb4214ccd8b2f42df432232bc359a8cb`. MIT licensed.

Image-preview design and tool-result format handling; rewritten validated PNG and cache handling.

## Claude Image View

[jarrodwatts/claude-image-view](https://github.com/jarrodwatts/claude-image-view), version 0.2.0, commit `370b8e7bc0708bebe9762e63534f7ca18bc3e802`. MIT licensed.

Paste discovery and preview design; rewritten session-scoped polling and image cache.

Original MIT notices are retained in `licenses/`. Prismantis dependency and palette notices are in `licenses/prismantis-third-party.md`. Its vendored Prism and beautiful-mermaid code retains its own license headers.

The Typst packages `cmarker 0.1.6` (MIT) and `mitex 0.2.7` (Apache-2.0) retain their complete sources, license files and notices in `render/packages/preview/`. No CeTZ or other LGPL package is bundled. This package does not redistribute fonts installed on your computer.

Node dependencies are pinned in package-lock.json. Their notices accompany the installed packages: beautiful-mermaid (MIT), @resvg/resvg-js (MPL-2.0), and pngjs (MIT); platform-specific resvg binaries retain their upstream licenses.
