# Prompt nav

Two buttons beside the mod controls: **Prev chat** jumps back to the previous
prompt you sent; **Next chat** goes forward to the next one. Each jump puts the
prompt at the top of the screen, with Claude's reply below it. **Next chat** does
nothing when the transcript's end is already visible.

```text
/plugin marketplace add AJclemendor/my-mods
/plugin install prompt-nav@my-mods
/reload-plugins
```

The buttons have their own row at the top right of each sidebar pane. They stay
available on Mod controls, Claude Buddy, and other pane tabs without covering
those panes' controls. When no pane is shown they appear above the prompt.
Buddy leaves room for the navigation row on both **Chat** and **Max**, including
when its message input has focus.

## How it decides where to go

Stops are your own prompts: what you typed, or sent from a phone or the web.
Background-task notifications and messages from other agents are skipped.

The direction is relative to what is on screen:

- **Prev chat** goes to the nearest prompt whose top is above the screen. A prompt partly
  scrolled off the top is the first stop, so you land on its start.
- **Next chat** goes to the next prompt after the one at the top of the screen.
- Inside a long reply with no prompt visible, Prev chat returns to the prompt that reply
  answers and Next chat goes to the one after it.

A prompt the transcript no longer shows (rewound, or replaced by `/clear`) is
skipped for the next one in the same direction. At the first or last prompt the
button does nothing.

## Limits

- Made for fullscreen, where Claude Code owns the scrolling. In classic mode the
  conversation lives in your terminal's own scrollback; that layout is untested.
- The buttons hide while an agent's transcript is open from the tasks list, and
  during native surveys.
- Prompt order is learned as Claude draws each prompt, in conversation order.
  Nothing is stored; a new session starts fresh.

## Development

```sh
claude plugin validate ./plugins/prompt-nav --strict
claude plugin test ./plugins/prompt-nav
# Real fullscreen terminal, offline, no paid requests. Requires pyte.
python3 plugins/prompt-nav/tests/terminal_check.py
```

The runtime tests cover placement and stop selection. The test kit cannot scroll
a real transcript, so the terminal check drives Claude Code in a PTY against a
local fake API: three prompts with long replies, then Prev chat three times, then Next chat twice, checking which
prompt lands at the top each time, that the buttons hold the same cell on the Mod
controls and Claude Buddy tabs, and that they work from the Buddy tab.

Tested with Claude Code 2.1.300.
