# Plugin strip visibility

`/plugin-h` toggles the bottom plugin strip completely off or back on, including
Claude's “plugin panel hidden” hint. `/plugin-h hide` and `/plugin-h show` set its
visibility explicitly. The preference is saved per Claude configuration/account.

The first session starts with the strip visible. Claude controls its own
expanded/collapsed setting; if restored as collapsed, click its hint or press
Ctrl+X then Ctrl+A to expand it.

Only the terminal's AbovePrompt strip is hidden. Buddy and Mod controls sidebars,
inline thinking, tool formatting, slash commands, and native surveys remain
available. This does not suppress unrelated clipboard notifications.

Load this plugin alongside compact-tools, live-thinking, sidebar-controls, and
claude-buddy. Its dependencies ensure it runs before those mods. Other mods that
wrap the same strip may require an additional dependency to establish ordering.

Tested using Claude Code 2.1.295. No model calls are made by this mod.
