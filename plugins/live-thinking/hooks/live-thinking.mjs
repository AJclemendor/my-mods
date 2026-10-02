const enabledState = { plugin: "live-thinking", key: "enabled" };
const previewState = { plugin: "live-thinking", key: "preview" };
const anchorState = { plugin: "live-thinking", key: "anchor" };
const MAX_PREVIEW_CHARS = 8000;

export function register(on) {
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    await $.state.set(previewState, null);
    await $.state.set(anchorState, null);
    await $.command.register({
      name: "live-thinking",
      description: "Toggle live thinking inline in the conversation",
      argumentHint: "[on|off]",
      immediate: true,
    });
    return result;
  });

  on("session.append", async ($, e, next) => {
    const result = await next(e);
    if (e.agentId || result.deny) return result;
    const message = result.message ?? e.message;
    const blocks = message.content;
    if (message.type === "user" || message.type === "assistant") {
      const last = blocks.at(-1);
      if (last?.type === "tool_result") {
        await $.state.set(anchorState, { kind: "tool", id: last.tool_use_id });
      } else if (last?.type === "tool_use") {
        await $.state.set(anchorState, { kind: "tool", id: last.id });
      } else if (last?.type === "text" && !message.isMeta) {
        await $.state.set(anchorState, { kind: message.type, id: e.uuid });
      }
    }
    return result;
  });

  on("command.run", { command: "live-thinking" }, async ($, e) => {
    const arg = e.args.trim().toLowerCase();
    if (arg && arg !== "on" && arg !== "off") return { text: "Usage: /live-thinking [on|off]" };
    const { value = true } = await $.state.get(enabledState);
    const enabled = arg ? arg === "on" : !value;
    await $.state.set(enabledState, enabled);
    return { text: `Live thinking ${enabled ? "on" : "off"}.` };
  });

  on("turn.step", async function* ($, e, next) {
    if (e.agentId) return yield* next(e);
    let version = null;
    let text = "";
    let block = null;

    async function publish(value, first = false) {
      if (!first && version === null) return;
      try {
        const written = await $.state.set(previewState, value, first ? undefined : { ifVersion: version });
        version = written.isSet ? written.version : null;
      } catch {
        // A failed preview must not drop a response chunk or stop the model stream.
        version = null;
      }
    }

    await publish(null, true);
    const stream = next(e);
    let completed = false;
    try {
      while (true) {
        const entry = await stream.next();
        if (entry.done) {
          completed = true;
          return entry.value;
        }
        const chunk = entry.value;
        if (chunk.kind === "thinking" && chunk.text) {
          if (chunk.index !== block) {
            text = "";
            block = chunk.index;
          }
          text = previewTail(text + chunk.text);
          await publish({ text });
        } else if (text && (chunk.kind === "text" || chunk.kind === "tool" || chunk.kind === "stop")) {
          text = "";
          block = null;
          await publish(null);
        }
        yield chunk;
      }
    } finally {
      try {
        if (!completed) await stream.return();
      } finally {
        // Only the stream that still owns this version can clear the preview.
        await publish(null);
      }
    }
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const original = await next(e);
    if (e.surface !== "terminal" || e.props.hasSurvey || e.props.view?.agentId) return original;
    const { value: enabled = true } = await $.state.get(enabledState);
    const { Box, Button } = $.ui.resolve(e);
    const children = [original, Button({
      key: "toggle-live-thinking",
      label: `Live thinking: ${enabled ? "ON" : "OFF"}`,
      color: enabled ? "cyan" : "gray",
      onPress: async () => {
        const { value = true } = await $.state.get(enabledState);
        await $.state.set(enabledState, !value);
      },
    })];
    return Box({ flexDirection: "column", children });
  });

  on("ui.render", async ($, e, next) => {
    if (e.surface !== "terminal" || !["UserMessage", "AssistantMessage", "ToolResult", "ToolGroup"].includes(e.component)) {
      return next(e);
    }
    const { value: anchor } = await $.state.get(anchorState);
    if (!isAnchor(e, anchor)) return next(e);
    const original = await next(e);
    const { value: enabled = true } = await $.state.get(enabledState);
    const { value: preview } = await $.state.get(previewState);
    if (!enabled || !preview?.text) return original;
    const visible = previewTail(preview.text
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "")
      .replace(/\t/g, "  "));
    const { Box, Text } = $.ui.resolve(e);
    return Box({
      flexDirection: "column",
      children: [original, Box({
        marginTop: 1,
        flexDirection: "row",
        children: [Text({ dimColor: true, children: "∴ " }), Box({
          key: "thinking-preview",
          flexShrink: 1,
          children: [Text({ dimColor: true, children: visible })],
        })],
      })],
    });
  });
}

function isAnchor(e, anchor) {
  if (!anchor) return false;
  if (anchor.kind === "user") return e.component === "UserMessage" && e.requestId === anchor.id;
  if (anchor.kind === "assistant") return e.component === "AssistantMessage" && e.requestId === anchor.id;
  if (e.component === "ToolResult") return e.props.tool_use_id === anchor.id;
  return e.component === "ToolGroup" && e.props.calls.some(call => call.tool_use_id === anchor.id);
}

function previewTail(text) {
  const tail = text.slice(-MAX_PREVIEW_CHARS);
  return /^[\uDC00-\uDFFF]/.test(tail) ? tail.slice(1) : tail;
}
