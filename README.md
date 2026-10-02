# My mods

Claude Code mods by AJclemendor.

| Plugin | What it does |
| --- | --- |
| [compact-tools](plugins/compact-tools) | Compact tool output, including MCP calls and Bash errors. |
| [live-thinking](plugins/live-thinking) | Stream thinking summaries inline in the conversation. |
| [sidebar-controls](plugins/sidebar-controls) | Put both ON/OFF controls in a top-right sidebar. |

## Install compact-tools

This marketplace is public. Anyone can install it without a repository invitation.

Run these inside Claude Code:

```text
/plugin marketplace add AJclemendor/my-mods
/plugin install compact-tools@my-mods
/reload-plugins
```

The **Compact tools: ON** button appears above the terminal prompt. Click it to switch between compact and native tool output, or use `/compact-tools on`, `/compact-tools off`, or `/compact-tools` to toggle. Each session starts ON.

Requires Claude Code 2.1.287 or later. The mod API can change between releases; this version was tested on 2.1.287 in classic and fullscreen terminal layouts.

## Install live-thinking

```text
/plugin marketplace add AJclemendor/my-mods
/plugin install live-thinking@my-mods
/reload-plugins
```

Thinking summaries stream inline after the latest conversation message or tool result. The **Live thinking: ON/OFF** button stays above the prompt; use it or `/live-thinking on` and `/live-thinking off` to control the preview. The temporary text clears when Claude moves to text or tools, and the completed thinking block remains in the normal transcript.

It works on the main conversation and can run alongside compact-tools or by itself. Enable thinking summaries as described below so the provider returns text for the preview. See the [live-thinking README](plugins/live-thinking) for details.

## Install sidebar-controls

```text
/plugin marketplace add AJclemendor/my-mods
/plugin install sidebar-controls@my-mods
/reload-plugins
```

This separate plugin installs compatible versions of compact-tools and live-thinking and moves their buttons into a 28-column sidebar at the top right. Thinking and tool output stay inline in the conversation. Close the sidebar to return the buttons above the prompt; `/sidebar-controls on` reopens it, and `/sidebar-controls off` closes it.

Claude automatically shows the sidebar in wide fullscreen terminals, normally from 144 columns. If it is waiting for space, the original buttons remain available. Running `/sidebar-controls on` explicitly opens it: fullscreen terminals from 110 columns dock it on the right; narrower or classic terminals place it above the prompt. See the [sidebar-controls README](plugins/sidebar-controls) for details.

## What it changes

- Bash: one result line plus a count of hidden lines, with stderr first.
- Failed Bash calls: a red error row with the exit code when available, the first diagnostic, and a count of hidden lines.
- Edit and Write: line counts instead of expanded diffs and file contents.
- Text Read: number of lines read.
- MCP calls: tool name without the JSON arguments, plus the first result line and a count of hidden lines. Non-text results are counted; errors remain visibly failed.
- Running calls: a running indicator.
- A blank line before each tool call keeps it separate from preceding thinking or text.

Errors outside Bash and MCP, interrupted calls, staged changes, unknown tools, and unsupported built-in result formats keep their native rendering. Turning compact tools OFF restores full arguments and results, including errors. The mod does not modify tool calls, stored results, model-visible content, account selection, or permission settings. It makes no model or network calls.

## Show thinking summaries too

The plugin controls tool display. Thinking visibility remains a native Claude setting. To match the visible-thinking layout, merge these keys into your existing `~/.claude/settings.json` and restart Claude:

```json
{
  "showThinkingSummaries": true,
  "verbose": true
}
```

Turning compact tools OFF restores native tool output while leaving thinking visibility as you configured it. Installing the mod does not overwrite your settings.

## If the toggle does not appear

Check `/plugin` for an enabled `compact-tools@my-mods`, run `/reload-plugins`, and restart if needed. Update Claude if your version is older than 2.1.287. A disabled hooks setting or managed organization policy can prevent mods from loading.

During testing, one 2.1.287 installation still required the early-access flag. If your build reports that hooks modules are turned off by its rollout switch, try launching that session with:

```sh
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude
```

This is a compatibility workaround for that build, not a way to bypass managed policy. Current Claude documentation says mods are on by default in 2.1.287 and later and the old flag is ignored.

## Update or remove

Update the marketplace and plugin from the `/plugin` interface. From a shell:

```sh
claude plugin marketplace update my-mods
claude plugin update compact-tools@my-mods
claude plugin update live-thinking@my-mods
claude plugin update sidebar-controls@my-mods
```

Reload plugins or restart the session afterward. To remove it, run `claude plugin uninstall compact-tools@my-mods`.

## Development

```sh
git clone https://github.com/AJclemendor/my-mods.git
cd my-mods
claude plugin validate . --strict
claude plugin validate ./plugins/compact-tools --strict
claude plugin test ./plugins/compact-tools
claude plugin validate ./plugins/live-thinking --strict
claude plugin test ./plugins/live-thinking
claude plugin validate ./plugins/sidebar-controls --strict
claude plugin test ./plugins/sidebar-controls
```

For a local session with all three plugins, run `claude --plugin-dir ./plugins`. Runtime tests cover summaries, preservation of results, running states, errors, native fallback, duplicate result suppression, controls, and streaming thinking. Offline terminal replays also verify MCP success and error calls in classic and fullscreen layouts, and sidebar placement, closing, reopening, and mouse toggling.

[Claude marketplace documentation](https://code.claude.com/docs/en/plugin-marketplaces) · [Mods documentation](https://code.claude.com/docs/en/plugins/mods/overview)
