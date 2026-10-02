# Live thinking

See Claude's thinking summary stream inline in the conversation, before the completed block appears.

```text
/plugin marketplace add AJclemendor/my-mods
/plugin install live-thinking@my-mods
/reload-plugins
```

The **Live thinking: ON/OFF** button above the prompt controls the preview. You can also use `/live-thinking`, `/live-thinking on`, or `/live-thinking off`. Each session starts ON. It works independently of compact-tools, and both plugins can be loaded together.

Install [sidebar-controls](../sidebar-controls) to move the ON/OFF button into a top-right sidebar. Thinking remains inline in the conversation; closing the sidebar returns the button above the prompt.

The preview appears after the latest user message, assistant message, or tool result. Only the toggle occupies the area above the prompt. The preview clears when the response moves to text or a tool call, finishes, fails, or is cancelled. Claude's completed thinking block remains in the normal transcript. The preview shows the main conversation's thinking; it does not mix in background subagent streams.

## Enable thinking summaries

This plugin displays the summary chunks Claude supplies. It cannot display thinking text that the provider omits or has not sent yet. Enable native thinking summaries by merging these keys into your existing `~/.claude/settings.json` and restarting Claude:

```json
{
  "showThinkingSummaries": true,
  "verbose": true
}
```

For a single session, use `claude --verbose --thinking-display summarized`. See the [marketplace README](../../README.md#if-the-toggle-does-not-appear) if your Claude build has not enabled the mod runtime.

## Behavior and validation

The plugin observes `turn.step` and passes every chunk and the final result through unchanged. It observes `session.append` to position the preview without changing stored messages. It does not make model requests, modify prompts, alter thinking signatures, or write thinking to files. It retains the latest 8,000 characters for the temporary preview; the normal response stream is not truncated.

The plugin targets Claude Code 2.1.287's terminal API. Its tests cover inline rendering, incremental updates before response completion, block transitions, toggling, subagent isolation, overlapping responses, errors, cancellation, bounded previews, and preserving the response stream. Offline terminal replays verified placement after user messages, assistant text, and real Read tool results in classic and fullscreen layouts, including alongside compact-tools. Run the runtime tests with:

```sh
claude plugin validate ./plugins/live-thinking --strict
claude plugin test ./plugins/live-thinking
```
