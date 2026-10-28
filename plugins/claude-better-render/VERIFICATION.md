# Verification — 0.1.1

Tested on macOS with Claude Code 2.1.312, Node 22 and Typst 0.15.1.

- 197 Claude hook tests pass across all ten plugins in this repository, including
  15 Better Render tests and five plugin-h tests.
- Ten worker tests pass with the real Typst and Mermaid renderers. These cover
  malformed PNGs, same-size file replacement, narrow layouts, draft height limits,
  math/tables, diagram errors, raw Typst fences and document file isolation.
- An isolated terminal replay passes using a local fixture API: Read-image output,
  streaming Markdown/math/Mermaid/code, diagnostic status, text/auto switching and
  the settings pane. The captured output contains actual kitty graphics commands.
  It does not use a paid model or any real profile credentials.
- JPEG and WebP fixtures convert successfully to bounded PNG previews.
- Generated document and Mermaid PNGs were visually inspected. Direct application
  screenshot inspection was unavailable; no claim is made that every terminal,
  multiplexer, scroll history or font combination has been visually tested.
- Strict local manifest/hook validation passes. Marketplace-directory icon advice
  is separate from local validation; this is distributed through my-mods.

Regression coverage includes exact-source copying, native on/off behavior,
settings controls, incomplete fences, Desktop passthrough, long-reply fallback,
live-thinking composition, render deduplication, failed jobs, tool-image ownership,
clear during an in-flight job, draft deletion, per-session draft identity, and
plugin-h visibility. The release uses a versioned disk cache.

Running sessions must reload plugins or restart to load newly installed files.
