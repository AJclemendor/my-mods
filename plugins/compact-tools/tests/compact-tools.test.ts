import { describe, expect, test } from "claude-code/testing";

function toolRow(tool: string, output: unknown) {
  return {
    plugin: "compact-tools", surface: "terminal", component: "ToolUse",
    props: {
      tool_use_id: tool, tool, output, input: { command: "fixture", file_path: "fixture.txt" },
      isRunning: false, isErrored: false, isInterrupted: false,
    },
  } as const;
}

describe("compact-tools", () => {
  test("sidebar controls replace the prompt button and keep toggling the same state", async ($, on) => {
    let visible = true;
    on("state.get", { plugin: "sidebar-controls", key: "visible" }, () => ({ value: { value: visible, version: 0 } }));
    on("ui.render", ($, e) => $.ui.resolve(e).Box({}));
    const pane = await $.ui.mount({
      plugin: "compact-tools", surface: "terminal", component: "Pane", requestId: "sidebar-controls",
      props: { title: "Mod controls", isFocused: false, bodyColumns: 28, placement: "dock", scroll: { offset: 0, bodyRows: 40 }, view: {} },
    });
    const band = await $.ui.mount({
      plugin: "compact-tools", surface: "terminal", component: "AbovePrompt",
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    });
    expect((await pane.find({ key: "toggle-compact-tools" }))?.text).toBe("Compact tools: ON");
    expect(await band.find({ key: "toggle-compact-tools" })).toBeUndefined();
    await pane.press({ key: "toggle-compact-tools" });
    expect((await pane.find({ key: "toggle-compact-tools" }))?.text).toBe("Compact tools: OFF");
    visible = false;
    await band.redraw();
    expect((await band.find({ key: "toggle-compact-tools" }))?.text).toBe("Compact tools: OFF");
    await pane.unmount();
    await band.unmount();
  });

  test("MCP calls hide nested arguments and summarize results without changing either", async ($) => {
    const input = { ref: { id: "private-ref" }, payload: { ops: [{ content: "PRIVATE_DOCUMENT_BODY".repeat(1000) }] } };
    const output = [{ type: "text", text: "Document updated\nBlock one\nBlock two" }];
    const before = JSON.stringify({ input, output });
    const target = toolRow("mcp__claude_ai_Claude_Docs__edit_doc", output);
    const ui = await $.ui.mount({ ...target, props: { ...target.props, input } });
    expect((await ui.find({ type: "Text", text: /MCP/ }))?.text).toBe("● claude ai Claude Docs · edit doc (MCP)");
    expect((await ui.find({ type: "Text", text: /⎿/ }))?.text).toBe("  ⎿ Document updated … +2 lines");
    expect(await ui.find({ type: "Text", text: /PRIVATE_DOCUMENT_BODY|private-ref|Block two/ })).toBeUndefined();
    expect(JSON.stringify({ input, output })).toBe(before);
    await ui.unmount();
  });

  test("MCP running calls stay compact before their arguments or result arrive", async ($) => {
    const target = toolRow("mcp__docs__edit_doc", undefined);
    const ui = await $.ui.mount({ ...target, props: { ...target.props, input: undefined, isRunning: true } });
    expect((await ui.find({ type: "Text" }))?.text).toBe("● docs · edit doc (MCP) · Running…");
    expect(await ui.find({ type: "Text", text: /⎿/ })).toBeUndefined();
    await ui.unmount();
  });

  test("MCP errors stay visibly failed and turning off restores native details", async ($, on) => {
    on("ui.render", ($, e) => $.ui.resolve(e).Text({ children: "FULL NATIVE MCP" }));
    const output = { isError: true, content: [{ type: "text", text: "Access denied\nTrace detail" }] };
    const ui = await $.ui.mount(toolRow("mcp__docs__edit_doc", output));
    expect((await ui.find({ type: "Text", text: /MCP/ }))?.text).toBe("✗ docs · edit doc (MCP)");
    expect((await ui.find({ type: "Text", text: /⎿/ }))?.text).toBe("  ⎿ Error · Access denied … +1 lines");
    await $.command.run({ command: "compact-tools", args: "off" });
    expect((await ui.find({ type: "Text" }))?.text).toBe("FULL NATIVE MCP");
    await ui.unmount();
  });

  test("MCP non-text results are counted and their standalone result is not duplicated", async ($) => {
    const output = { content: [{ type: "image", data: "PRIVATE_BASE64" }, { type: "resource", resource: { text: "PRIVATE_RESOURCE" } }] };
    const ui = await $.ui.mount(toolRow("mcp__docs__fetch", output));
    expect((await ui.find({ type: "Text", text: /⎿/ }))?.text).toBe("  ⎿ 2 non-text items");
    expect(await ui.find({ type: "Text", text: /PRIVATE/ })).toBeUndefined();
    const result = await $.ui.mount({ plugin: "compact-tools", surface: "terminal", component: "ToolResult", props: { tool: "mcp__docs__fetch", tool_use_id: "fetch", output, isErrored: false } });
    expect(await result.find({ type: "Text" })).toBeUndefined();
    await result.unmount();
    await ui.unmount();
  });

  test("MCP interruptions keep the native interruption marker", async ($, on) => {
    on("ui.render", ($, e) => $.ui.resolve(e).Text({ children: "NATIVE INTERRUPTED" }));
    const output = "[Request interrupted by user for tool use]";
    const target = toolRow("mcp__docs__edit_doc", output);
    const ui = await $.ui.mount({ ...target, props: { ...target.props, isErrored: true, isInterrupted: true } });
    expect((await ui.find({ type: "Text" }))?.text).toBe("NATIVE INTERRUPTED");
    const result = await $.ui.mount({ plugin: "compact-tools", surface: "terminal", component: "ToolResult", props: { tool: target.props.tool, tool_use_id: "edit", output, isErrored: true } });
    expect((await result.find({ type: "Text" }))?.text).toBe("NATIVE INTERRUPTED");
    await result.unmount();
    await ui.unmount();
  });

  test("Bash output is a single preview and the original result stays intact", async ($) => {
    const output = {
      stdout: Array.from({ length: 50 }, (_, i) => `LINE_${i + 1}`).join("\n"),
      stderr: "", interrupted: false, isImage: false,
    };
    const before = JSON.stringify(output);
    const ui = await $.ui.mount(toolRow("Bash", output));
    expect((await ui.find({ type: "Text", text: /⎿/ }))?.text).toBe("  ⎿ LINE_1 … +49 lines");
    expect(JSON.stringify(output)).toBe(before);
    await ui.unmount();
  });

  test("Edit and Write show counts without file contents", async ($) => {
    for (const [tool, output, label] of [
      ["Edit", { structuredPatch: [{ lines: ["-SECRET_OLD", "+SECRET_NEW", "+MORE"] }] }, "  ⎿ Added 2 lines, removed 1 line"],
      ["Write", { content: "SECRET_NEW\nMORE\n" }, "  ⎿ Wrote 2 lines"],
      ["Read", { type: "text", file: { numLines: 20, content: "PRIVATE", truncatedByTokenCap: true } }, "  ⎿ Read 20 lines (partial)"],
    ] as const) {
      const ui = await $.ui.mount(toolRow(tool, output));
      expect((await ui.find({ type: "Text", text: /⎿/ }))?.text).toBe(label);
      expect(await ui.find({ type: "Text", text: /SECRET|PRIVATE/ })).toBeUndefined();
      await ui.unmount();
    }
  });

  test("running Bash rows omit multi-line commands and show running state", async ($) => {
    const ui = await $.ui.mount({
      plugin: "compact-tools", surface: "terminal", component: "ToolUse",
      props: {
        tool_use_id: "running", tool: "Bash", input: { command: "printf secret\ncat file", description: "Read\nfiles" },
        isRunning: true, isErrored: false, isInterrupted: false,
      },
    });
    expect((await ui.find({ type: "Text" }))?.text).toBe("● Bash(Read files) · Running…");
    await ui.unmount();
  });

  test("other errors, unknown Bash errors, and staged edits retain native details", async ($, on) => {
    on("ui.render", ($, e) => $.ui.resolve(e).Text({ children: "NATIVE DETAILS" }));
    for (const props of [
      { tool_use_id: "error", tool: "Edit", output: "File not found", isErrored: true },
      { tool_use_id: "unknown-error", tool: "Bash", output: undefined, isErrored: true },
      { tool_use_id: "interrupted", tool: "Bash", output: "[Request interrupted by user for tool use]", isErrored: true },
      { tool_use_id: "interrupted-session", tool: "Bash", output: "[Tool call interrupted: the session ended before this call's result was recorded, so its outcome is unknown.]", isErrored: true },
      { tool_use_id: "staged", tool: "Edit", output: { staged: true, structuredPatch: [] }, isErrored: false },
      { tool_use_id: "unknown", tool: "NewTool", output: {}, isErrored: false },
    ]) {
      const ui = await $.ui.mount({ plugin: "compact-tools", surface: "terminal", component: "ToolResult", props });
      expect((await ui.find({ type: "Text" }))?.text).toBe("NATIVE DETAILS");
      await ui.unmount();
    }
  });

  test("Bash failures retain the exit code and first diagnostic without the error dump", async ($) => {
    const output = "Error: Exit code 2\n\u001b[31mERROR_LINE_1\u001b[0m\n" + Array.from({ length: 49 }, (_, i) => `ERROR_LINE_${i + 2}`).join("\n");
    const target = toolRow("Bash", output);
    const ui = await $.ui.mount({ ...target, props: { ...target.props, isErrored: true } });
    expect((await ui.find({ type: "Text", text: /Bash/ }))?.text).toBe("✗ Bash(fixture)");
    expect((await ui.find({ type: "Text", text: /⎿/ }))?.text).toBe("  ⎿ Exit code 2 · ERROR_LINE_1 … +49 lines");
    expect(await ui.find({ type: "Text", text: /ERROR_LINE_2|ERROR_LINE_50/ })).toBeUndefined();
    await ui.unmount();
  });

  test("Bash errors without exit codes and structured failures remain visibly failed", async ($) => {
    for (const [output, expected] of [
      ["Error: Permission denied\nDiagnostic details", "Error · Permission denied … +1 lines"],
      ["Exit code 127", "Exit code 127 · Command failed"],
      ["", "Error · Command failed"],
      [{ stdout: "context", stderr: "failure\ntrace", interrupted: false }, "Error · stderr · failure … +2 lines"],
    ] as const) {
      const target = toolRow("Bash", output);
      const ui = await $.ui.mount({ ...target, props: { ...target.props, isErrored: true } });
      expect((await ui.find({ type: "Text", text: /⎿/ }))?.text).toBe(`  ⎿ ${expected}`);
      await ui.unmount();
    }
  });

  test("turning the mod off restores full native Bash error rows and results", async ($, on) => {
    on("ui.render", ($, e) => $.ui.resolve(e).Text({ children: "FULL NATIVE ERROR" }));
    const output = "Error: Exit code 1\nfailure\ntrace";
    const target = toolRow("Bash", output);
    const row = await $.ui.mount({ ...target, props: { ...target.props, isErrored: true } });
    const result = await $.ui.mount({
      plugin: "compact-tools", surface: "terminal", component: "ToolResult",
      props: { tool_use_id: "Bash", tool: "Bash", output, isErrored: true },
    });
    expect(await row.find({ type: "Text", text: /Exit code 1 · failure/ })).toBeDefined();
    expect(await result.find({ type: "Text" })).toBeUndefined();
    await $.command.run({ command: "compact-tools", args: "off" });
    expect((await row.find({ type: "Text" }))?.text).toBe("FULL NATIVE ERROR");
    expect((await result.find({ type: "Text" }))?.text).toBe("FULL NATIVE ERROR");
    await row.unmount();
    await result.unmount();
  });

  test("standalone results do not duplicate the preview in the tool row", async ($) => {
    const ui = await $.ui.mount({
      plugin: "compact-tools", surface: "terminal", component: "ToolResult",
      props: {
        tool_use_id: "bash-result", tool: "Bash", isErrored: false,
        output: { stdout: "first\nsecond\nthird", stderr: "" },
      },
    });
    expect(await ui.find({ type: "Text" })).toBeUndefined();
    await ui.unmount();
  });

  test("the status button toggles the mod and follows slash-command changes", async ($, on) => {
    on("ui.render", { component: "AbovePrompt" }, ($, e) => $.ui.resolve(e).Box({}));
    const ui = await $.ui.mount({
      plugin: "compact-tools", surface: "terminal", component: "AbovePrompt",
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 },
    });
    expect((await ui.find({ key: "toggle-compact-tools" }))?.text).toBe("Compact tools: ON");
    await ui.press({ key: "toggle-compact-tools" });
    expect((await ui.find({ key: "toggle-compact-tools" }))?.text).toBe("Compact tools: OFF");
    await $.command.run({ command: "compact-tools", args: "on" });
    expect((await ui.find({ key: "toggle-compact-tools" }))?.text).toBe("Compact tools: ON");
    await ui.unmount();
  });

  test("the slash command switches mounted output back to native and back again", async ($, on) => {
    on("ui.render", ($, e) => $.ui.resolve(e).Text({ children: "NATIVE DETAILS" }));
    const ui = await $.ui.mount(toolRow("Write", { content: "a\nb" }));
    expect((await ui.find({ type: "Text", text: /⎿/ }))?.text).toBe("  ⎿ Wrote 2 lines");
    expect((await $.command.run({ command: "compact-tools", args: "off" })).text).toContain("off");
    expect((await ui.find({ type: "Text" }))?.text).toBe("NATIVE DETAILS");
    await $.command.run({ command: "compact-tools", args: "on" });
    expect((await ui.find({ type: "Text", text: /⎿/ }))?.text).toBe("  ⎿ Wrote 2 lines");
    await ui.unmount();
  });
});
