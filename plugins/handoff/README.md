# Handoff

`/handoff` hands off the current task or latest agreed plan from your chat without requiring you to type it again. It runs the native `/subtask` command with the full available conversation context, your saved model and effort, and these instructions: complete the task in exactly one new worktree, create its branch from the latest remote `main`, implement and validate the change, commit and push, and open a pull request against `main`. The subtask reports back through Claude's normal task system. You can optionally use `/handoff <task>` to specify different work.

Each handoff first makes a tool-free Haiku 5.5 request to name the thread from the explicit task and recent chat text. It asks for a concrete three-word title such as “Fix order routing,” which becomes the native thread name. The naming request uses low effort, a 512-token output cap, and an eight-second timeout. It receives at most the last 12 nonempty user/assistant messages, capped at 2,000 characters each; this does not limit the full context inherited by the working agent. If naming fails or returns an invalid title, the handoff still starts with a short fallback name. Existing threads are not renamed.

`/handoff-settings` opens clickable model and **Thinking effort** controls directly below the model buttons. Choose Main session, low, medium, high, xhigh, or max; the selected effort is shown beneath the buttons. Changes save automatically per Claude profile and apply to future handoffs. The default working model is Fable 5.1; effort inherits from the main session. The model buttons offer Fable 5.1, Sonnet 5.5, and Opus 5.5; a custom model ID can also be entered. These settings govern the working agent; naming always uses Haiku 5.5. Effort supports low, medium, high, xhigh, and max, subject to the selected model's capabilities. Settings do not change the main session or ordinary `/subtask` calls. A running handoff retains its selected overrides across plugin reloads.

The worktree and PR steps are instructions to the subtask, not git operations performed by the plugin. The normal Claude permissions and model availability still apply. Missing `main`, git access, or PR credentials should be reported as blockers. The PR is opened, not merged. If the chat contains no identifiable task, the subtask asks a focused clarification. Native limitations (such as coordinator sessions) are reported by `/subtask`.

Install from this marketplace and reload:

```text
/plugin install handoff@my-mods
/reload-plugins
/handoff-settings
/handoff
```

Test with `claude plugin test ./plugins/handoff` and validate with `claude plugin validate ./plugins/handoff --strict`. The offline terminal check uses a local mock API to verify the native subtask, inherited context, model and effort overrides, settings persistence, and unchanged main-session behavior without paid requests or opening real PRs.
