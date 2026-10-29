# Claude Better Render

AJ's terminal-only Claude Code mod with normal Claude text by default, optional
themed Markdown, Mermaid diagrams, inline tool images and pasted-image previews. One renderer coordinates
these features, so several plugins do not compete to redraw the same reply.

## Install

Install Node.js 20.9+ for image and diagram rendering. On macOS:

```sh
brew install node
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

The **Mod controls** sidebar includes **Better Render: ON/OFF**. Click it to
toggle the whole mod; it shares the saved state used by `/render on` and
`/render off`. Use `/sidebar-controls on` if the sidebar is closed.

| Command | Behavior |
| --- | --- |
| `/render on` / `/render off` | Enable or restore the previous/native rendering. |
| `/render mode native` | Default: keep Claude’s original text rendering; append Mermaid previews and keep tool images. |
| `/render mode text` | Themed text, code and tables, plus graphical diagrams when supported and Unicode fallback otherwise. |
| `/render theme terminal` | Follow terminal colors where they can be detected. |
| `/render theme github-light` | Choose one of the bundled Prismantis palettes. |
| `/render images on` / `off` | Show/hide pictures returned by tools or sent as attachments. |
| `/render mermaid on` / `off` | Draw diagrams or keep their source. |
| `/render preview on` / `off` | Enable/disable pasted-image thumbnails before sending. |
| `/render tools inherit` / `cards` | Keep existing tool formatting, or surround it with a themed card. |
| `/render copy` | Copy the exact original text of the last rendered reply. |
| `/render doctor` | Show dependency status, image capability and the most recent rendering failure. |

Normal Claude text is the default. `/render mode text` opts into Prismantis
Markdown styling using ordinary terminal text, with source-copy controls.
Mermaid previews remain graphical where supported. The saved transcript and
model-visible results remain unchanged.

Typesetting, graphical paragraphs, font controls, and size controls were removed
in 0.1.3. Old `auto` and `typeset` preferences migrate to native mode. Mermaid
previews appear after the unchanged native reply, preserving its source.

## Terminal support

Ghostty and kitty are the primary graphical targets. The mod measures their font
and palette where possible. Other terminals get themed text unless image output
has explicitly been enabled through Claude's supported environment setting.
`NO_COLOR` disables graphical rendering. In tmux/screen, text fallback is the
default; explicitly enabled image passthrough depends on the terminal and host.
SSH sessions cannot assume that a remote font configuration matches the viewer.

Node runs the local rendering worker. Mermaid renders diagrams; sharp converts
JPEG and WebP images to bounded PNG previews. No external document compiler is
used. Dependencies are installed with the plugin, and rendering makes no extra
model requests. Use Claude's normal plugin update flow.

PNG, JPEG and WebP previews are supported. Images are content-keyed, fitted to the
available width and transferred as bounded PNGs. Very large/invalid files keep
their original tool row or file link. Markdown image URLs are not fetched by the
renderer. Code fences are never executed.

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

- **[Intelligent UI](https://github.com/razorback16/cc-intelligent-ui)** by razorback16 — inspiration for the original rendering integration; its typesetting code and bundled packages have since been removed.
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

The worker tests execute Mermaid and image conversion locally, including malformed input,
same-size image replacement and width limits. The terminal replay uses an
isolated Claude configuration and a local fake API; it makes no paid API calls.
