# Verification — 0.1.4

Tested on macOS with Claude Code 2.1.312 and Node 22.

- 19 Better Render hook tests cover native text preservation, old-preference
  migration, removal of typesetting/font/size commands, optional text styling,
  exact-source copying, settings, incomplete fences, Desktop passthrough,
  live-thinking composition, failed/stale jobs, tool-image ownership and drafts.
- Nine real worker tests cover PNG validation, same-size file replacement,
  narrow layouts, draft height limits, Mermaid graphics/text and invalid input,
  symlinked startup, rejection of document jobs, and JPEG/WebP conversion.
- The isolated terminal replay uses a local fixture API and tests Read images,
  unchanged native text, optional Markdown styling, diagrams and settings.
  Captured terminal output contains actual kitty graphics commands.
- The worker has no Typst invocation or document renderer. The bundled templates
  and Typst packages have been deleted. Image conversion uses sharp.

Running sessions must reload plugins or restart to load newly installed files.

The sidebar-toggle test verifies persistence, command synchronization, preservation
of existing controls, remounting while disabled, and terminal-only display.
