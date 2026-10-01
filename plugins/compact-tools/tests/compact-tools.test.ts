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

  test("errors and staged edits retain their native details", async ($, on) => {
    on("ui.render", ($, e) => $.ui.resolve(e).Text({ children: "NATIVE DETAILS" }));
    for (const props of [
      { tool_use_id: "error", tool: "Bash", output: "Exit code 1", isErrored: true },
      { tool_use_id: "staged", tool: "Edit", output: { staged: true, structuredPatch: [] }, isErrored: false },
      { tool_use_id: "unknown", tool: "NewTool", output: {}, isErrored: false },
    ]) {
      const ui = await $.ui.mount({ plugin: "compact-tools", surface: "terminal", component: "ToolResult", props });
      expect((await ui.find({ type: "Text" }))?.text).toBe("NATIVE DETAILS");
      await ui.unmount();
    }
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
