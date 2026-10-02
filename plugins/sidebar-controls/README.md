# Sidebar controls

Move the Compact tools and Live thinking ON/OFF buttons into a sidebar at the top right of Claude Code. This plugin changes where the controls appear; thinking and tool output remain inline in the conversation.

```text
/plugin marketplace add AJclemendor/my-mods
/plugin install sidebar-controls@my-mods
/reload-plugins
```

Installing this plugin also installs compatible versions of compact-tools and live-thinking. Update older copies if Claude reports a dependency version mismatch.

The sidebar requests 28 columns and opens without taking keyboard focus. Click either button to toggle its mod. The existing `/compact-tools` and `/live-thinking` commands still work.

- `/sidebar-controls on`: open the sidebar.
- `/sidebar-controls off`: close it and return the buttons above the prompt.
- `/sidebar-controls`: toggle it open or closed.

The sidebar uses a full-height column, not a floating corner overlay. Claude normally opens it automatically from 144 columns in fullscreen mode. Below that width it can wait for space, leaving the original buttons above the prompt. An explicit `/sidebar-controls on` opens it at any width: fullscreen mode docks it from 110 columns; narrower terminals and classic mode place the pane above the prompt. Claude remembers manually opened panes and may subsequently open them automatically from 110 columns. Resizing the pane can override the requested width.

Closing the pane with its close button also restores the original controls. Disabling or uninstalling this plugin restores their normal placement after reload; the other two mods continue working.

Tested with Claude Code 2.1.287. The runtime tests cover open/close commands and visibility; terminal replays verify top-right placement, mouse toggling, and returning controls to the prompt when closed.

```sh
claude plugin validate ./plugins/sidebar-controls --strict
claude plugin test ./plugins/sidebar-controls
```
