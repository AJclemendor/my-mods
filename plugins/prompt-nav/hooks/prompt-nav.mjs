import { ownOrigins, emptyState, track, trackRow, candidates } from "./stops.mjs";

export function register(on) {
  let state = emptyState();

  // Full-height panes leave this row free for the navigation added below.
  on("state.get", { plugin: "prompt-nav", key: "paneRows" }, () => ({ value: { value: 1, version: 0 } }));

  on("session.start", async ($, e, next) => {
    const result = await next(e);
    state = emptyState();
    return result;
  });

  on("session.end", ($, e, next) => { state = emptyState(); return next(e); });
  on("session.compact", async ($, e, next) => { const result = await next(e); state = emptyState(); return result; });

  // Track the end of the transcript as well as its prompts: a visible final
  // reply or turn footer tells Next chat that there is nothing below to visit.
  on("ui.render", { component: ["UserMessage", "AssistantMessage", "ToolUse", "ToolResult", "ToolGroup", "CommandOutput", "TurnDuration"] }, async ($, e, next) => {
    const result = await next(e);
    if (e.surface === "terminal") {
      trackRow(state, `${e.component}:${e.requestId}`, e.props.onScreen);
      if (e.component === "UserMessage" && ownOrigins.has(e.props.origin?.kind)) track(state, e.requestId, e.props.onScreen);
    }
    return result;
  });

  on("ui.render", { component: ["AbovePrompt", "Pane"] }, async ($, e, next) => {
    const original = await next(e);
    if (e.surface !== "terminal" || e.props.hasSurvey || e.props.view?.agentId || original?.type === "engine") return original;
    const { Box, Button } = $.ui.resolve(e);
    const arrows = [
      Button({ key: "prompt-nav-up", plain: true, color: "cyan", label: "Prev chat", onPress: () => jump($, state, -1) }),
      Button({ key: "prompt-nav-down", plain: true, color: "cyan", label: "Next chat", onPress: () => jump($, state, 1) }),
    ];
    // Give the longer labels their own row so they never cover the pane's tabs
    // or controls, including in the narrow Mod controls pane.
    if (e.component === "Pane") {
      return Box({ flexDirection: "column", children: [
        Box({ flexDirection: "row", justifyContent: "flex-end", gap: 2, children: arrows }), original] });
    }
    if ((await $.ui.panes()).some(pane => pane.isShown)) return original;
    return Box({ flexDirection: "column", children: [
      Box({ flexDirection: "row", justifyContent: "flex-end", gap: 2, children: arrows }), original,
    ] });
  });
}

async function jump($, state, step) {
  for (const id of candidates(state, step)) {
    const { deny } = await $.ui.scroll({ to: { requestId: id }, block: "start" });
    if (!deny) { state.landed = id; return; }
  }
}
