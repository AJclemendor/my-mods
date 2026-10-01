# My mods

Claude Code mods by AJclemendor.

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

## What it changes

- Bash: one result line plus a count of hidden lines, with stderr first.
- Edit and Write: line counts instead of expanded diffs and file contents.
- Text Read: number of lines read.
- Running calls: a running indicator.
- A blank line before each tool call keeps it separate from preceding thinking or text.

Errors, interrupted calls, staged changes, unknown tools, and unsupported result formats keep their native rendering. The mod does not modify tool calls, stored results, model-visible content, account selection, or permission settings. It makes no model or network calls.

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
```

Reload plugins or restart the session afterward. To remove it, run `claude plugin uninstall compact-tools@my-mods`.

## Development

```sh
git clone https://github.com/AJclemendor/my-mods.git
cd my-mods
claude plugin validate . --strict
claude plugin validate ./plugins/compact-tools --strict
claude plugin test ./plugins/compact-tools
```

For a local session, run `claude --plugin-dir ./plugins/compact-tools`. The seven included runtime tests cover summaries, preservation of results, running states, native fallback, duplicate result suppression, the status button, and the slash-command toggle. Terminal replays also verified thinking visibility and compact results in classic and fullscreen layouts.

[Claude marketplace documentation](https://code.claude.com/docs/en/plugin-marketplaces) · [Mods documentation](https://code.claude.com/docs/en/plugins/mods/overview)
