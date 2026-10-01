const enabledState = { plugin: "compact-tools", key: "enabled" };
const supported = new Set(["Bash", "Read", "Edit", "Write"]);

export function register(on) {
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    await $.command.register({
      name: "compact-tools",
      description: "Toggle compact tool output; thinking stays in Claude's native display",
      argumentHint: "[on|off]",
      immediate: true,
    });
    return result;
  });

  on("command.run", { command: "compact-tools" }, async ($, e) => {
    const arg = e.args.trim().toLowerCase();
    if (arg && arg !== "on" && arg !== "off") {
      return { text: "Usage: /compact-tools [on|off]" };
    }
    const { value = true } = await $.state.get(enabledState);
    const enabled = arg ? arg === "on" : !value;
    await $.state.set(enabledState, enabled);
    return { text: `Compact tools ${enabled ? "on" : "off"}. Thinking display is unchanged.` };
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const original = await next(e);
    if (e.surface !== "terminal" || e.props.hasSurvey) return original;
    const { value = true } = await $.state.get(enabledState);
    const { Box, Button } = $.ui.resolve(e);
    return Box({
      flexDirection: "column",
      children: [original, Button({
        key: "toggle-compact-tools",
        label: `Compact tools: ${value ? "ON" : "OFF"}`,
        color: value ? "green" : "gray",
        onPress: async () => {
          const { value = true } = await $.state.get(enabledState);
          await $.state.set(enabledState, !value);
        },
      })],
    });
  });

  on("ui.render", { component: "ToolUse" }, async ($, e, next) => {
    const p = e.props;
    if (e.surface !== "terminal" || !supported.has(p.tool) || p.isErrored || p.isInterrupted) {
      return next(e);
    }
    const { value = true } = await $.state.get(enabledState);
    if (!value) return next(e);
    const label = toolLabel(p);
    if (label === null) return next(e);
    const result = resultLabel(p.tool, p.output);
    if (p.output !== undefined && result === null) return next(e);
    const { Box } = $.ui.resolve(e);
    return Box({
      flexDirection: "column",
      marginTop: 1,
      children: [row($, e, label, false), ...(result === null ? [] : [row($, e, `  ⎿ ${result}`, true)])],
    });
  });

  on("ui.render", { component: "ToolResult" }, async ($, e, next) => {
    const p = e.props;
    if (e.surface !== "terminal" || !supported.has(p.tool) || p.isErrored) return next(e);
    const { value = true } = await $.state.get(enabledState);
    if (!value) return next(e);
    const label = resultLabel(p.tool, p.output);
    if (label === null) return next(e);
    // Both layouts receive the result on ToolUse; the standalone result would repeat it.
    return $.ui.resolve(e).Box({});
  });
}

function toolLabel(p) {
  const input = p.input;
  if (!input || typeof input !== "object") return null;
  const label = p.tool === "Bash" ? input.description || input.command : input.file_path;
  if (typeof label !== "string") return null;
  return `● ${p.tool}(${oneLine(label)})${p.isRunning ? " · Running…" : ""}`;
}

function oneLine(value) {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
    .trim()
    .slice(0, 2000);
}

function row($, e, label, dimColor) {
  const { Box, Text } = $.ui.resolve(e);
  return Box({
    height: 1,
    children: [Text({ dimColor, wrap: "truncate-end", children: label })],
  });
}

function linesIn(text) {
  return text === "" ? 0 : text.replace(/\r?\n$/, "").split(/\r?\n/).length;
}

function lineCount(count) {
  return `${count} ${count === 1 ? "line" : "lines"}`;
}

function resultLabel(tool, output) {
  if (!output || typeof output !== "object") return null;
  if (output.staged || output.interrupted) return null;
  if (tool === "Bash") {
    if (typeof output.stdout !== "string" || typeof output.stderr !== "string") return null;
    const lines = [output.stderr, output.stdout].join("\n")
      .split(/\r?\n/).map(oneLine).filter(Boolean);
    const fallback = output.isImage ? "Image sent to Claude"
      : output.backgroundTaskId ? "Running in background"
      : output.bashEditDiff ? "File updated"
      : output.returnCodeInterpretation || "No output";
    return `${output.stderr.trim() ? "stderr · " : ""}${lines[0] || oneLine(fallback)}${lines.length > 1 ? ` … +${lines.length - 1} lines` : ""}`;
  }
  if (tool === "Edit") {
    if (!Array.isArray(output.structuredPatch)) return null;
    let added = 0, removed = 0;
    for (const hunk of output.structuredPatch) {
      for (const line of hunk.lines) {
        if (line.startsWith("+")) added++;
        if (line.startsWith("-")) removed++;
      }
    }
    return `Added ${lineCount(added)}, removed ${lineCount(removed)}`;
  }
  if (tool === "Write") {
    if (typeof output.content !== "string") return null;
    return `Wrote ${lineCount(linesIn(output.content))}`;
  }
  if (tool === "Read" && output.type === "text" && typeof output.file?.numLines === "number") {
    return `Read ${lineCount(output.file.numLines)}${output.file.truncatedByTokenCap ? " (partial)" : ""}`;
  }
  return null;
}
