# Claude Buddy

A sidebar companion for an active Claude Code session. By default it is a side chat that answers questions about the session without interrupting the main task; in Companion mode it also summarizes new activity on a cadence and keeps the occasional observation. It stays quiet while idle. It runs while Claude Code is open, including long-running tasks; it is not a separate background daemon.

The plugin's install ID is `buddy`; Claude Code reserves plugin IDs beginning with `claude-`. Its sidebar title is **Claude Buddy**, and its toggle command is `/claude-buddy`.

## Desktop and terminal

Version 0.1.12 supports both the terminal and local sessions in Claude Desktop's **Code** tab. Install `buddy@my-mods` and run `/reload-plugins`, then `/buddy`. The Desktop pane has padded content, wrapping tabs, labeled You/Max messages, a multiline composer, and naturally scrolling chat history. Max, Log, settings, feedback, and clipboard actions work on both surfaces. It does not customize the app's regular Chat or Cowork interfaces.

Desktop connections can arrive after the engine starts; Buddy begins monitoring when Desktop attaches and pauses automatic checks when no supported interface remains attached. A second connection does not steal the pane from another mod. Saved settings continue to use the same Claude profile.

## Use

- `/claude-buddy`: toggle Buddy on or off.
- `/claude-buddy on` or `/claude-buddy off`: set it explicitly.
- `/buddy`: open and focus the sidebar.
- `/buddy <question>`: ask a question, or type in the input at the bottom of the pane.
- `/buddy update`: request a summary now.
- `/buddy companion` or `/buddy chat`: switch between Companion and Chat only.
- `/buddy settings`: open model and cadence settings.
- `/buddy reset`: reset the side conversation, keeping observations and settings.

In the terminal, Buddy only opens as a vertical dock. If the terminal becomes too narrow and would place Buddy above the prompt, Buddy closes its pane and pauses automatic reviews. It resumes when the fullscreen terminal has enough room to dock it again, preserving chat, flags, and settings. Classic terminal layout stays paused. Desktop uses the app's own pane layout instead of terminal width rules. Turning Buddy off yourself keeps it off after resizing or reconnecting.

The Mod controls pane has a **Claude Buddy: ON/OFF** button and an observation count. Without that pane, the button appears above the main prompt. Closing Buddy's pane switches monitoring off. Returning with `/buddy` catches up on new activity. While Buddy is on, `/btw` opens its chat; when it is off, `/btw` uses Claude's native overlay.

Load Buddy instead of `btw-chat`: both handle `/btw`. The local `claude-b` launcher loads Buddy; the older mod remains available separately.

## Layout

The pane has three tabs in Companion mode, with configuration behind **Settings**:

- **Chat**: the side conversation, newest at the bottom beside the input. Exchanges that do not fit page off the top behind `‹ older`; asking a new question returns to the newest page, and a reply that lands while you are reading older pages offers `↓ new reply` instead of moving you. A question sent while a reply is pending is shown as `· queued` and goes out when the current one finishes.
- **Max**: **Flags → Now**, in that order. Flags show one observation at a time in a card colored by kind, with its evidence, a pager, and links to other open observations. Now shows the monitoring status, running tools, latest progress summary, and Update now control, including when no flags are open.
- **Log**: the latest ten meaningful progress updates with their timestamps, newest first. Idle placeholders and no-change reviews add nothing.

New flags and current-status updates mark Max; new log entries mark Log; new chat replies mark Chat. Each tab clears its own unread indicator when opened. Buddy never switches tabs for an automatic update. The count on Max is the number of open flags. **Settings** controls mode, model, effort, cadence, and reply style. Chat only mode shows just **Chat** and **Settings**.

In the terminal, with Prompt nav enabled, **Prev chat** and **Next chat** sit above Buddy's tabs on Chat, Max, and Log. Buddy reserves space for that row so focusing its input keeps the navigation visible. Prompt nav is a separate terminal-only plugin.

**Log** is separate from the current status in **Now**. A main turn must run for at least one minute before it can contribute a log entry, including its final result. Short lookups and the time spent waiting between turns do not qualify; Update now does not bypass this rule. Even during a long turn, an entry needs a useful new milestone, consequential discovery or decision, verified result, or actual blocker. Routine reads, heading and priority inventories, file sizes, plans to begin, drafting status, and waiting for the next instruction should produce no entry. An empty log is fine.

In **Settings → Activity & log**, click **Off** to hide Now and Log and stop collecting new activity summaries and log entries. Flags still receive automatic reviews, and side chat stays available. The choice is saved for this Claude profile. Click **On** to resume; earlier entries are retained for the current session, but updates received while off are not saved.

Each proposed entry must quote evidence from the current turn. Reviews receive the recent log to avoid repeating its meaning, and repeated keys, wording, or evidence are suppressed for the whole session, even after an entry leaves the ten-item display. Flags are reviewed independently and can still appear during short turns. Whether a supported development is useful enough remains the reviewing model's judgment.

## What Buddy watches

Routine changes are grouped into one update rather than one request per tool; the end of a main turn gets an earlier review. Every observation is the model's judgment of the conversation. Nothing mechanical is ever a flag: not a tool call or its result or error, a failed command, a permission prompt, a question Claude asks, a turn ending, compaction, or context and usage levels. The transcript shows those and Claude handles its own; Buddy speaks up only about a consequence, such as Claude being stuck, working around a failure, changing scope, or claiming something it did not verify.

The model reviews the actual conversation for consequential missed decisions, unverified claims, scope changes, risky actions that were proposed or taken, and important tradeoffs or constraints. This extends the built-in **You should know** approach: explain consequences in plain language, calibrate to what the user already understands, avoid trivia and repeated topics, and stay silent when nothing deserves a flag. Routine progress summaries are separate from that higher threshold for observations.

Observations remain visible until supported new evidence resolves them or you dismiss them. At most ten stay open; when an eleventh arrives the oldest is dropped. A dropped observation is not a dismissal, so the model can raise it again if it stays relevant. Each model-generated observation needs a quote present in the available transcript or event facts. A resolution needs different evidence from the original warning. Unsupported or malformed updates leave the previous observations in place and show an error; they never silently replace them with an all-clear.

- **Explain** asks Buddy about the observation in the side conversation.
- **Copy to clipboard** copies the full observation and its supporting evidence, including text shortened in the card, without a Claude Buddy heading or flag-type label. It shows whether copying succeeded; it does not send a message or dismiss the flag.
- **Dismiss** acknowledges that concern for this session. Later reviews receive its text and evidence so they can avoid raising the same topic under a new key or wording. Matching keys, text, or source quotes are also suppressed locally, ignoring case, spacing, and punctuation. A review already running when you dismiss cannot add flags until a fresh review has seen the dismissal. Different concerns can still appear.
- **I know this** saves an understood topic for future sessions and removes that insight.
- **Good / Bad** immediately saves the rating and dismisses the flag. Existing notes are preserved; no chat message is sent. If saving fails, the flag stays available so you can retry.

Saved feedback stays in this Claude profile across sessions and reloads. Future reviews receive the rated examples and your notes to calibrate what kinds of flags are helpful. Good is not a request to repeat that warning, and Bad is not a blanket ban on an entire topic. Saving feedback makes no model request by itself. If a review was already running, its new flags wait until a fresh review has seen the feedback.

**Settings → Saved feedback & prompt** lists every saved rating, original flag, evidence, and note, newest first. Use **Edit** to add or change a note, then press Enter to save it. Clicking **Good / Bad** saves the current note and rating and dismisses any matching flag. Use **Delete** to remove an example from future guidance. **View prompt** shows the actual review instructions together with all saved feedback and known topics; each review also receives the current transcript, flags, and progress separately. **Copy path** exports a readable snapshot to `buddy/review-guidance.txt` under the current Claude configuration directory and copies that path. Copy it again to refresh the snapshot after edits; change saved guidance in Settings.

Observations mark the Max tab and wait there; there are no toasts. Each review adds at most one observation, and most add none. Evidence matching checks that a quote exists; it cannot establish that every model interpretation is correct or guarantee every issue is caught.

## Models and context

Settings shows three model buttons inline: the latest **Fable**, **Sonnet**, and **Opus** versions in this Claude profile's cached model catalog. There is no separate model picker. Choosing a model also updates the available thinking-effort buttons; an unsupported saved effort resets to Default. The selected model's catalog notice, such as a usage-credit requirement, appears beneath the choices. If no catalog is available, the built-in choices are Fable 5.1, Sonnet 5.5, and Opus 5.5. Existing saved model selections are kept until you choose another model.

The default model is **Opus 5.5** (`claude-opus-5-5`), whatever model the main session runs. A saved Follow Claude choice from before this default (settings version 3) moves to Opus 5.5; any other saved model is kept.

**Follow Claude** with Default effort uses a tool-free fork of the main model's last request, including its system prompt and inherited content. Every request also reads the newest transcript text, covering the main reply and tool results that arrived after that cached request.

A different model or effort uses a separate completion with all available main-transcript text, tool inputs and results, current session context blocks, and the composed session instructions. The mod API cannot pass image blocks to this completion, so settings labels the distinction. It does not silently crop the transcript; a context-limit failure is reported, and the failure message names the API's error kind (for example `HTTP 400, invalid_request`) and points to Follow Claude when the conversation no longer fits the chosen model. After main-session compaction, earlier material is available through Claude's compacted context rather than the full original transcript. Unfinished streaming text and future events are not available to either request mode.

Side questions include earlier side exchanges, the current summary, open observations, and the latest main context. Neither the conversation nor automatic updates are appended to the main transcript. Buddy's model cannot execute tools or change files; the Copy path control exports the requested guidance snapshot. The main session's model and settings stay unchanged.

## Settings and lifetime

Under **Mode**, click **Companion** (automatic summaries and alerts) or **Chat only (BTW)**, the default. Both choices are buttons; a green check marks the active one. Chat only makes no background model requests, generates no monitoring flags or toasts, and shows just the side conversation. Every question still reads the latest main-session context. Switching modes keeps the chat, model, and other settings; the mode is saved across sessions. Returning to Companion schedules a fresh review. Old monitoring observations are hidden in Chat only, and an automatic review already in flight is discarded when switching to it. `/buddy update` in Chat only acts as an explicit request for a summary in the chat.

Mode, thinking effort, routine update frequency, and chat reply style all use clickable buttons, with a green check on each selected value. Buttons wrap to fit narrower panes. The latest Fable, Sonnet, and Opus model choices are on the same settings page. Routine updates can run every 10, 30, 60, or 120 seconds; important events are coalesced over a shorter delay. A review that finds nothing meaningfully new keeps the previous summary rather than rewording it. Short automatic summaries have their own fixed instruction. Settings and known topics persist under the current Claude profile; chat, observations, dismissals, and the latest ten updates live in memory until session exit, switching/clearing the session, or plugin reload.

Empty sessions make no monitoring requests. Before an automatic review, Buddy compares the available transcript, running tools, and acknowledged flags with the last successful review; unchanged intervals make no model request. **Update now** can explicitly recheck an unchanged conversation. Reviews may return no new summary, and idle boilerplate stays out of Now and Log. Headless sessions do not monitor. An in-flight request may finish after switching off or resetting chat, but its discarded result cannot refill the old view. New activity arriving during a review is handled by a subsequent review. Subagent notifications and Buddy's own completions do not generate summary loops.

## Development

```sh
claude --plugin-dir ./plugins/claude-buddy
claude plugin validate ./plugins/claude-buddy --strict
claude plugin test ./plugins/claude-buddy
# Requires pyte.
python3 plugins/claude-buddy/tests/terminal_check.py
```

Runtime tests cover batching, idle behavior, stale requests, evidence validation, dismissed concerns and in-flight dismissals, known topics, inline model selection, clickable settings, empty and unchanged review intervals, idle log suppression, follow-ups, the Max page and separate Log tab, clipboard success and failure, context/usage indicators, and headless isolation. Offline terminal checks exercise real Bash errors, automatic summaries, concurrent chat, model selection, reload, and stopping monitoring in classic and fullscreen layouts without paid requests.
