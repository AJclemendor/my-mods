# BTW chat

An ongoing side conversation in a BTW sidebar tab. Every question uses the current main session's context plus your earlier side exchanges. Reset clears the side conversation while keeping access to the main session.

Run `/btw` to open and focus the tab, or `/btw <question>` to ask directly. Type follow-ups in the tab's input. Click **Reset chat** or run `/btw reset` to start a fresh side conversation. `/btw-chat` accepts the same arguments.

When enabled, this mod handles `/btw` in place of the native overlay. Closing the tab keeps its history; `/btw` reopens it. The history lives in memory until reset, plugin reload, exit, or switching/clearing the main session. It is never written into the main conversation. An answer still in flight when you reset is discarded; the underlying request may finish in the background.

The tab shares Claude's sidebar area with other panes, including Mod controls. The controls pane also gets an **Open BTW chat** button. The chat requests 48 columns when docked and 18 rows above the prompt in classic or narrow terminals. Escape returns keyboard focus to the main prompt without closing the tab.

## Settings

Click **Settings** in the tab or run `/btw settings`:

- **Model:** follow the main session, use Opus, Sonnet, or Haiku, or enter a custom model ID. Press Enter to save a custom ID. Aliases resolve through Claude Code and use the session's provider and credentials.
- **Thinking effort:** Default, low, medium, high, xhigh, or max. Claude Code only sends effort to models that support it.
- **Reply style:** Default, concise, balanced, or detailed.
- **Output budget:** Default, 1,024, 4,096, 8,192, or 16,384 tokens. This requests a token budget for the reply. Claude Code may adjust the actual API cap for the selected model.

Selections save in the plugin's store under the current Claude profile and survive restarts and plugin reloads. They affect the next side reply; an in-flight reply keeps the choices it started with. **Reset chat** preserves settings. **Restore defaults** restores the main-model defaults and keeps the side history. Main-session settings are never changed.

## Context and replies

With the main model and default effort and output budget, each ask makes a tool-free `model.fork` request through the session's own client and credentials, reusing its current model and cached main-conversation prefix when available. It also reads the latest transcript on every ask and supplies the newest assistant messages and subsequent tool results, since the cached request predates its own answer. Reply style can change while keeping this path. Side history is included until you reset it; no exchanges are silently dropped.

Choosing another model, effort, or output budget uses `model.complete`, because the fork API cannot override those settings. Every such request receives a fresh text snapshot of the main conversation and its tool inputs/results, plus side history. It does not inherit the main request's prompt cache, system prompt, or image blocks. Main session still resolves the current main model on every ask when effort or the cap alone is overridden. Default effort then means that model's default, and Default output budget is 4,096 tokens.

Context is refreshed when you send a question. It includes completed text and tool results; an answer cannot see main-session changes that arrive after its request starts, or unfinished streaming text. Newly returned images are not added by the text supplement. On the default fork path, images become part of the inherited request after the main model consumes them. The side reply appears when complete. The main task can continue while you ask and read side replies.

A new or cleared main session needs a main-model response before a side request can fork it; custom settings can answer using the transcript already available. If the request fails, the question remains in the input for retry and the error stays out of side history.

## Install

From a checkout:

```sh
claude --plugin-dir ./plugins/btw-chat
```

For the whole collection, use `claude --plugin-dir ./plugins`. This mod works without sidebar-controls; when both are loaded they share the same sidebar through separate tabs.

## Verify

```sh
claude plugin validate ./plugins/btw-chat --strict
claude plugin test ./plugins/btw-chat
# Requires the Python package pyte.
python3 plugins/btw-chat/tests/terminal_check.py
```

The runtime suite covers refreshed context, follow-ups, recent tool results, reset during an in-flight request, retryable failures, command routing, long replies, and saved settings. Terminal checks use a local mock API to verify the real pane, `/btw`, reset, model and effort selection, plugin reload, and separation from the main transcript without paid requests.
