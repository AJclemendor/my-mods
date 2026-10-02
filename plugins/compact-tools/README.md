# Compact tools

Compact Bash, Read, Edit, Write, and MCP output for Claude Code's terminal, with a visible ON/OFF toggle above the prompt. Run `/compact-tools` to toggle, or `/compact-tools on` and `/compact-tools off`.

Failed Bash calls show a compact red error row with their exit code when available and first diagnostic. Turn the mod off to see full error output.

MCP calls show the server and tool name without dumping their JSON arguments. Results show the first text line and a hidden-line count, or a count of non-text items. Failures are marked red, and interrupted calls keep their native interruption marker. The complete arguments and results still reach the tool and model and remain in the transcript; turning the mod off restores their full display.

Install [sidebar-controls](../sidebar-controls) to move the ON/OFF button into a top-right sidebar. Closing the sidebar returns it above the prompt.

Install from the marketplace:

```text
/plugin marketplace add AJclemendor/my-mods
/plugin install compact-tools@my-mods
/reload-plugins
```

Thinking visibility is configured separately in Claude's settings. See the [marketplace README](https://github.com/AJclemendor/my-mods#show-thinking-summaries-too) for setup, compatibility, and update instructions.
