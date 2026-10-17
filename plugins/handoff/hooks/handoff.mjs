import { threadTitle } from "./naming.mjs";

const pane = { id: "handoff-settings", title: "Handoff settings", columns: 58, rows: 24 };
const defaults = { model: "claude-fable-5-1", effort: "inherit" };
const efforts = ["inherit", "low", "medium", "high", "xhigh", "max"];
const models = [
  { value: "inherit", label: "Main session" },
  { value: "claude-fable-5-1", label: "Fable 5.1" },
  { value: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { value: "claude-opus-5-5", label: "Opus 5.5" },
];
const currentTask = "Continue and complete the current task or latest agreed plan from the inherited conversation. Use the latest user instructions, decisions, and constraints to determine the intended work. The user invoked /handoff to have you carry that work through to completion without restating the task. If the conversation contains no identifiable actionable task, ask one focused clarification instead of inventing work.";

export const instructions = `Complete the requested task end to end in exactly one new, isolated git worktree.
Create one new branch from the latest remote main (fetch main first) and use that branch and worktree for all implementation, checks, and fixes. Do not base the branch on the parent's feature branch or create additional worktrees. Keep the parent's working directory, branch, and uncommitted changes intact. Translate paths from the inherited conversation to your worktree and re-read files before editing.
Implement the task, run the relevant tests and checks, review the diff, commit the completed changes, and push the branch. Open a pull request with main as its base (for GitHub, use gh pr create --base main). Do not merge the PR. Report the PR link, branch, worktree path, and validation results back here. If main is unavailable or a required step is blocked, report the specific blocker instead of substituting a different base or claiming success.`;

export function register(on) {
  const state = { settings: null, error: "", custom: "", saving: Promise.resolve() };

  on("session.start", async ($, e, next) => {
    const result = await next(e);
    await $.command.register({ name: "handoff", description: "Hand off the current task in one new worktree and open a PR against main", argumentHint: "[task]" });
    await $.command.register({ name: "handoff-settings", description: "Set the default model and effort for handoffs", immediate: true });
    return result;
  });

  on("command.run", { command: "handoff-settings" }, async ($) => {
    state.settings = normalize(await $.store.get("settings"));
    state.error = "";
    state.custom = "";
    await $.ui.open({ ...pane, focus: true });
    return {};
  });

  on("command.run", { command: "handoff" }, async ($, e) => {
    const explicitTask = e.args.trim();
    const task = explicitTask || currentTask;
    await state.saving;
    const settings = normalize(await $.store.get("settings"));
    const id = crypto.randomUUID();
    // Commands queue behind the current command. Defer one tick so the native
    // launcher can run after /handoff has returned instead of deadlocking it.
    $.clock.after(1, async () => { try {
      const title = await threadTitle($, explicitTask);
      // Native /subtask names the thread from the first three prompt words.
      const prompt = `${title}\n\n${task}\n\nHandoff instructions:\n${instructions}\n\n[handoff:${id}]`;
      // Host state survives reloads without sharing agent IDs across sessions.
      await $.state.set({ plugin: "handoff", key: "launch", id }, { prompt, ...settings });
      // Keep the native full-context fork, task list, and result delivery.
      // command.run already prints the native command's result in the transcript.
      await $.command.run({ command: "subtask", args: prompt });
    } catch (error) {
      await $.state.set({ plugin: "handoff", key: "launch", id }, null);
      await $.ui.log(`Handoff could not start: ${error instanceof Error ? error.message : String(error)}`);
    } });
    return {};
  });

  on("turn.start", async ($, e, next) => {
    if (e.agentId) {
      const id = e.text.match(/\[handoff:([a-f0-9-]{36})\]\s*$/)?.[1];
      if (id) {
        const { value: launch } = await $.state.get({ plugin: "handoff", key: "launch", id });
        if (launch && e.text.trimEnd().endsWith(launch.prompt)) {
          await $.state.set({ plugin: "handoff", key: "agent", id: e.agentId }, { model: launch.model, effort: launch.effort });
          await $.state.set({ plugin: "handoff", key: "launch", id }, null);
        }
      }
    }
    return next(e);
  });

  on("turn.step", async function* ($, e, next) {
    if (!e.agentId) return yield* next(e);
    const { value: settings } = await $.state.get({ plugin: "handoff", key: "agent", id: e.agentId });
    if (!settings) return yield* next(e);
    // A native fork inherits the parent's model at launch. Override only this
    // agent's requests, never the session config or an unrelated subtask.
    return yield* next({ ...e,
      ...(settings.model === "inherit" ? {} : { model: settings.model }),
      ...(settings.effort === "inherit" ? {} : { effort: settings.effort }),
    });
  });

  on("ui.render", { component: "Pane", requestId: pane.id }, async ($, e, next) => {
    if (e.surface !== "terminal") return next(e);
    if (!state.settings) state.settings = normalize(await $.store.get("settings"));
    const { Box, Text, Button, Input } = $.ui.resolve(e);
    const settings = state.settings;
    const choices = (key, options, selected, change) => Box({ flexDirection: "row", flexWrap: "wrap", gap: 1,
      children: options.map(option => Button({ key: `${key}-${option.value}`, label: `${option.value === selected ? "✓ " : ""}${option.label}`, onPress: () => save($, state, change(option.value)) })),
    });
    return Box({ flexDirection: "column", gap: 1, children: [
      Text({ bold: true, children: "Handoff settings" }),
      Text({ dimColor: true, children: "Saved automatically for future handoffs in this Claude profile." }),
      Text({ bold: true, children: "Default model" }),
      choices("handoff-model", models, settings.model, model => ({ model })),
      Text({ dimColor: true, children: `Selected: ${models.find(model => model.value === settings.model)?.label || settings.model}` }),
      Text({ bold: true, children: "Thinking effort" }),
      choices("handoff-effort", efforts.map(value => ({ value, label: value === "inherit" ? "Main session" : value })), settings.effort, effort => ({ effort })),
      Text({ dimColor: true, children: `Selected effort: ${settings.effort === "inherit" ? "Follow main session" : settings.effort} · applies to new handoffs` }),
      Input({ key: "handoff-custom-model", label: "Custom model ID", placeholder: "Full model ID; Enter to save", value: state.custom,
        onInput: value => { state.custom = value; },
        onSubmit: value => {
          const model = value.trim();
          if (!validModel(model)) { state.error = "Enter a full model ID without spaces."; $.ui.invalidate("ui.render"); return; }
          return save($, state, { model });
        },
      }),
      Text({ bold: true, children: "Included with every task" }),
      Text({ children: "One new worktree and branch from the latest remote main. Implement, test, commit, push, and open a PR against main. Report the PR link and results." }),
      ...(state.error ? [Text({ color: "red", children: state.error })] : []),
      Button({ key: "handoff-defaults", label: "Restore defaults", onPress: () => save($, state, defaults) }),
      Button({ key: "handoff-close", label: "Close", onPress: () => $.ui.close({ id: pane.id }) }),
    ] });
  });
}

function validModel(value) {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,199}$/.test(value);
}

function normalize(settings) {
  return {
    model: validModel(settings?.model) ? settings.model : defaults.model,
    effort: efforts.includes(settings?.effort) ? settings.effort : defaults.effort,
  };
}

function save($, state, change) {
  // Serialize clicks and merge with the saved value to retain changes made by
  // another session. A failed write keeps the last saved settings visible.
  state.saving = state.saving.then(async () => {
    try {
      const settings = { ...normalize(await $.store.get("settings")), ...change };
      await $.store.set("settings", settings);
      state.settings = settings;
      state.error = "";
    } catch {
      state.error = "Could not save settings. Try again.";
    }
    $.ui.invalidate("ui.render");
  });
  return state.saving;
}
