const enabledState = { plugin: "live-thinking", key: "enabled" };
const previewState = { plugin: "live-thinking", key: "preview" };
const MAX_PREVIEW_CHARS = 8000;

export function register(on) {
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    await $.state.set(previewState, null);
    await $.command.register({
      name: "live-thinking",
      description: "Toggle the live thinking preview above the prompt",
      argumentHint: "[on|off]",
      immediate: true,
    });
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
    const { value: preview } = await $.state.get(previewState);
    const { Box, Button, Text } = $.ui.resolve(e);
    const children = [original, Button({
      key: "toggle-live-thinking",
      label: `Live thinking: ${enabled ? "ON" : "OFF"}`,
      color: enabled ? "cyan" : "gray",
      onPress: async () => {
        const { value = true } = await $.state.get(enabledState);
        await $.state.set(enabledState, !value);
      },
    })];
    if (enabled && preview?.text) {
      const visible = previewTail(preview.text
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
        .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "")
        .replace(/\t/g, "  "));
      children.push(Box({
        key: "thinking-preview",
        height: Math.max(1, Math.min(8, e.props.maxRows - 3)),
        width: Math.max(1, e.props.bodyColumns),
        flexDirection: "column",
        justifyContent: "flex-end",
        overflow: "hidden",
        paddingLeft: 2,
        children: [Box({
          flexShrink: 0,
          children: [Text({ dimColor: true, children: visible })],
        })],
      }));
    }
    return Box({ flexDirection: "column", children });
  });
}

function previewTail(text) {
  const tail = text.slice(-MAX_PREVIEW_CHARS);
  return /^[\uDC00-\uDFFF]/.test(tail) ? tail.slice(1) : tail;
}
