# Flags

A standalone, focused flag sidebar for Claude Code's terminal and local Code sessions in Claude Desktop. No Buddy dependency, side chat, activity summaries, or log.

```text
/plugin install flags@my-mods
/reload-plugins
/flags
```

The sidebar opens automatically while enabled. `/flags off` stops monitoring and closes it; `/flags on` reopens it. `/flags settings` opens Settings, and `/flags check` requests a review immediately.

Every card has four actions:

- **Good**: save a positive example for future reviews and dismiss the flag.
- **Bad**: save a negative example for future reviews and dismiss the flag.
- **Dismiss**: acknowledge the concern without rating it.
- **Copy**: copy just the flag and supporting quote; no plugin name or category.

There is no save/cancel step. A failed save keeps the flag available for retry. Ratings calibrate future prompts; they do not train a model. Dismissals survive reloads and sessions in the same project directory. Feedback examples apply throughout that Claude profile. Settings exposes every saved rating/dismissal with a Forget action and the actual review prompt with a Copy path export. An exported prompt is a snapshot, not a configuration file.

## Review behavior

The rules come from Buddy's flag reviewer: consequential mistakes, blockers, hidden tradeoffs, unexpected scope, unsupported completion claims, and knowledge that affects a real decision. Routine tool activity, handled failures, obvious facts, speculative risks, and already acknowledged concerns should not produce flags. Silence is normal. Each review can raise multiple independent concerns; related concerns should be combined. All open flags appear in the scrolling panel, without a one-card carousel or silently dropping older cards.

Every accepted flag needs a supporting quote present in the supplied evidence. A flag only resolves automatically with a different supporting quote; omission from a review does not remove it. Quote matching establishes that the text exists, not that the model's interpretation is correct. Exact normalized matches suppress dismissed concerns in code; semantic paraphrases are additionally suppressed through the review instructions.

Monitoring defaults to every 30 seconds **when activity changed**, with a prompt check after a main turn finishes. No idle polling or automatic retries of unchanged activity. Settings offers 10/30/60/120 seconds, model selection, and effort. The default follows the main model with an inherited-context, tool-free fork plus fresh transcript updates. Selecting a separate model or effort sends the available text transcript, tool inputs/results, and session instructions; that path does not include image blocks. Reviews consume model usage and cannot independently inspect files, run checks, or alter the main conversation.

The pane pauses in a terminal without room for a vertical dock and resumes when space returns. Desktop uses its native pane layout. Sidebar rendering does not read the store repeatedly, run reviews, or subscribe to transcript rows. Open flags are session-local; saved ratings, dismissals, and preferences persist per Claude profile. No preferences or history are imported from Buddy.

## Development

```sh
claude plugin validate ./plugins/flags --strict
claude plugin test ./plugins/flags
```

The tests use mocked model replies and exercise both surface renderers, multiple flags per review, all four actions, persistence, failures, stale reviews, evidence validation, idle suppression, prompt export, and terminal resizing. They verify behavior rather than real-model flag quality.
