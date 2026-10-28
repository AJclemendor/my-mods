# Claude Better Render

AJ's terminal-only Claude Code mod for typeset replies, themed Markdown, Mermaid
diagrams, inline tool images and pasted-image previews. One renderer coordinates
these features, so several plugins do not compete to redraw the same reply.

## Install

Install Node.js 18+ and Typst 0.15+ for graphical rendering. On macOS:

```sh
brew install node typst
```

Then in Claude Code:

```text
/plugin install better-render --marketplace AJclemendor/my-mods
/reload-plugins
```

The npm dependencies are pinned in `package-lock.json`; the plugin installer
installs them. Start a new session if the new command is not listed after reload.
The plugin's technical ID is `better-render`, since Claude reserves names that
start with `claude-`. It does not draw in Desktop, regular Chat, or IDE surfaces.

## Use

`/render` opens settings and a live preview. `/render demo` opens a larger example.
`/better-render` is an alias for `/render`.

| Command | Behavior |
| --- | --- |
| `/render on` / `/render off` | Enable or restore the previous/native rendering. |
| `/render mode auto` | Render supported blocks as graphics, with text during rendering and on errors. |
| `/render mode text` | Themed text, code, tables and Unicode diagrams. Tool image previews still follow the images setting. |
| `/render mode typeset` | Request graphical document blocks; unsupported terminals and failed blocks still fall back to text. |
| `/render theme terminal` | Follow terminal colors where they can be detected. |
| `/render theme github-light` | Choose one of the bundled Prismantis palettes. |
| `/render font terminal` | Follow the detected terminal font. |
| `/render font Berkeley Mono` | Use an installed font for graphical text. |
| `/render size 120` | Set typeset text size (75–160%). Native text still uses the terminal font size. |
| `/render images on` / `off` | Show/hide pictures returned by tools or sent as attachments. |
| `/render mermaid on` / `off` | Draw diagrams or keep their source. |
| `/render preview on` / `off` | Enable/disable pasted-image thumbnails before sending. |
| `/render tools inherit` / `cards` | Keep existing tool formatting, or surround it with a themed card. |
| `/render copy` | Copy the exact original text of the last rendered reply. |
| `/render doctor` | Show dependency status, image capability and the most recent rendering failure. |

Every reply has **Copy reply** and **Source view** controls. Code, diagrams and
tables also have source-copy controls. Settings persist per Claude profile.
The source view is ordinary selectable text. Graphical paragraphs are images:
native drag-selection across them is not a reliable way to copy text; use these
controls. The saved transcript and the model's tool results remain unchanged.

## Terminal support

Ghostty and kitty are the primary graphical targets. The mod measures their font
and palette where possible. Other terminals get themed text unless image output
has explicitly been enabled through Claude's supported environment setting.
`NO_COLOR` disables graphical rendering. In tmux/screen, text fallback is the
default; explicitly enabled image passthrough depends on the terminal and host.
SSH sessions cannot assume that a remote font configuration matches the viewer.

Node runs the local rendering worker; Typst handles Markdown/math and image
conversion. Mermaid's renderer and the Typst Markdown/math packages are shipped
locally. No extra model requests are made. There is no custom auto-updater and no
first-render package download. Use Claude's normal plugin update flow.

PNG, JPEG and WebP previews are supported. Images are content-keyed, fitted to the
available width and transferred as bounded PNGs. Very large/invalid files keep
their original tool row or file link. Markdown image URLs are not fetched by the
renderer. Raw `typst` code fences are displayed as code, never evaluated.

## Works with AJ's existing mods

Compact-tools keeps ownership of tool summaries in `inherit` mode. Live-thinking
can wrap the reply without being replaced. Buddy, flags, Handoff and prompt-nav
stay independent. Plugin-h 0.1.1 exposes its hidden state so `/plugin-h hide` also
suppresses draft thumbnails; it does not hide images inside the transcript.

Do not enable the standalone upstream renderers alongside this combined one:
several own the same assistant-message drawing. A foreign renderer that removes
the native drawing entirely takes precedence rather than being silently erased.

## Credits

This mod builds on and takes inspiration from excellent community projects:

- **[Intelligent UI](https://github.com/razorback16/cc-intelligent-ui)** by razorback16 — typeset-answer architecture, image conversion, and local Typst packages.
- **[Prismantis](https://github.com/NahumLitvin/prismantis)** by Nahum Litvin — adapted Markdown parser, themed text/table/code renderers, palettes and Unicode diagrams.
- **[Mermaid Inline](https://github.com/dazebug/mermaid-inline)** by dazebug — adapted diagram rendering and terminal font/color measurement.
- **[Inline Images](https://github.com/kbrianps/claude-inline-images)** by Brian Pravato — tool-image preview design and result formats.
- **[Claude Image View](https://github.com/jarrodwatts/claude-image-view)** by Jarrod Watts — pasted-image preview design and cache discovery.

AJ maintains the integration and its fixes. This is not an official release from
those authors. Versions, commit IDs, original notices and dependency licenses
are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `licenses/`.

## Development

```sh
npm ci --ignore-scripts
claude plugin validate . --strict
claude plugin test .
npm run test:worker
uv run --with pyte python tests/terminal_check.py
```

The worker tests execute Typst and Mermaid locally, including malformed input,
same-size image replacement and width limits. The terminal replay uses an
isolated Claude configuration and a local fake API; it makes no paid API calls.
