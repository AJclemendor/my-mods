import { describe, expect, test } from "claude-code/testing";

const STEP = { turnId: "turn-main", index: 0, model: "test-model", messageCount: 1 };
const RESULT = { turnId: STEP.turnId, index: 0, answer: "Done", toolUses: [], stopReason: "end_turn", usage: null } as const;
const BAND = {
  plugin: "live-thinking", surface: "terminal", component: "AbovePrompt",
  props: { hasSurvey: false, isWorking: true, maxRows: 14, bodyColumns: 100, scroll: { offset: 0, bodyRows: 14 }, view: {} },
} as const;

describe("live-thinking", () => {
  test("renders each thinking chunk before the response completes and preserves the stream", async ($, on) => {
    const chunks = [
      { kind: "thinking", index: 0, text: "First thought. " },
      { kind: "thinking", index: 0, text: "Next thought." },
      { kind: "text", index: 1, text: "Done" },
      { kind: "stop", stopReason: "end_turn", usage: null },
    ] as const;
    let requests = 0;
    on("turn.step", async function* () {
      requests++;
      yield* chunks;
      return RESULT;
    });
    on("ui.render", { component: "AbovePrompt" }, ($, e) => $.ui.resolve(e).Box({}));
    const ui = await $.ui.mount(BAND);
    const stream = $.turn.step(STEP);
    expect((await stream.next()).value).toEqual(chunks[0]);
    expect((await ui.find({ key: "thinking-preview" }))?.text).toBe("First thought. ");
    expect((await stream.next()).value).toEqual(chunks[1]);
    expect((await ui.find({ key: "thinking-preview" }))?.text).toBe("First thought. Next thought.");
    expect((await stream.next()).value).toEqual(chunks[2]);
    expect(await ui.find({ key: "thinking-preview" })).toBeUndefined();
    expect((await stream.next()).value).toEqual(chunks[3]);
    expect(await stream.next()).toEqual({ done: true, value: RESULT });
    expect(requests).toBe(1);
    await ui.unmount();
  });

  test("new blocks replace the preview and tool calls clear it", async ($, on) => {
    on("turn.step", async function* () {
      yield { kind: "thinking", index: 0, text: "Old block" };
      yield { kind: "thinking", index: 1, text: "New block" };
      yield { kind: "tool", index: 2, id: "read", name: "Read" };
      return RESULT;
    });
    on("ui.render", { component: "AbovePrompt" }, ($, e) => $.ui.resolve(e).Box({}));
    const ui = await $.ui.mount(BAND);
    const stream = $.turn.step(STEP);
    await stream.next();
    await stream.next();
    expect((await ui.find({ key: "thinking-preview" }))?.text).toBe("New block");
    await stream.next();
    expect(await ui.find({ key: "thinking-preview" })).toBeUndefined();
    await stream.next();
    await ui.unmount();
  });

  test("button and slash command hide and restore the current preview", async ($, on) => {
    on("turn.step", async function* () {
      yield { kind: "thinking", index: 0, text: "Still thinking" };
      return RESULT;
    });
    on("ui.render", { component: "AbovePrompt" }, ($, e) => $.ui.resolve(e).Text({ children: "OTHER MOD" }));
    const ui = await $.ui.mount(BAND);
    const stream = $.turn.step(STEP);
    await stream.next();
    expect(await ui.find({ type: "Text", text: "OTHER MOD" })).toBeDefined();
    await ui.press({ key: "toggle-live-thinking" });
    expect((await ui.find({ key: "toggle-live-thinking" }))?.text).toBe("Live thinking: OFF");
    expect(await ui.find({ key: "thinking-preview" })).toBeUndefined();
    await $.command.run({ command: "live-thinking", args: "on" });
    expect((await ui.find({ key: "thinking-preview" }))?.text).toBe("Still thinking");
    await stream.next();
    expect(await ui.find({ key: "thinking-preview" })).toBeUndefined();
    await ui.unmount();
  });

  test("subagent thinking does not replace or clear the main preview", async ($, on) => {
    on("turn.step", async function* ($, e) {
      yield { kind: "thinking", index: 0, text: e.agentId ? "Child thought" : "Main thought" };
      return { ...RESULT, turnId: e.turnId };
    });
    on("ui.render", { component: "AbovePrompt" }, ($, e) => $.ui.resolve(e).Box({}));
    const ui = await $.ui.mount(BAND);
    const main = $.turn.step(STEP);
    await main.next();
    const child = $.turn.step({ ...STEP, turnId: "turn-child", agentId: "child" });
    expect((await child.next()).value).toEqual({ kind: "thinking", index: 0, text: "Child thought" });
    await child.next();
    expect((await ui.find({ key: "thinking-preview" }))?.text).toBe("Main thought");
    await main.next();
    await ui.unmount();
  });

  test("an older stream finishing cannot erase a newer preview", async ($, on) => {
    on("turn.step", async function* ($, e) {
      yield { kind: "thinking", index: 0, text: e.turnId };
      return { ...RESULT, turnId: e.turnId };
    });
    on("ui.render", { component: "AbovePrompt" }, ($, e) => $.ui.resolve(e).Box({}));
    const ui = await $.ui.mount(BAND);
    const older = $.turn.step(STEP);
    await older.next();
    const newer = $.turn.step({ ...STEP, turnId: "newer" });
    await newer.next();
    await older.next();
    expect((await ui.find({ key: "thinking-preview" }))?.text).toBe("newer");
    await newer.next();
    await ui.unmount();
  });

  test("a failed state hook does not drop chunks or change the result", async ($, on) => {
    const chunk = { kind: "thinking", index: 0, text: "Keep this" } as const;
    on("state.set", { plugin: "live-thinking" }, () => { throw new Error("Preview unavailable"); });
    on("turn.step", async function* () { yield chunk; return RESULT; });
    const stream = $.turn.step(STEP);
    expect((await stream.next()).value).toEqual(chunk);
    expect(await stream.next()).toEqual({ done: true, value: RESULT });
  });

  test("an engine stream failure clears its preview and remains an error", async ($, on) => {
    on("turn.step", async function* () {
      yield { kind: "thinking", index: 0, text: "Partial thought" };
      throw new Error("Source failed");
    });
    on("ui.render", { component: "AbovePrompt" }, ($, e) => $.ui.resolve(e).Box({}));
    const ui = await $.ui.mount(BAND);
    const stream = $.turn.step(STEP);
    await stream.next();
    let message = "";
    try { await stream.next(); } catch (error) { message = (error as Error).message; }
    expect(message).toContain("no implementation for turn.step");
    expect(await ui.find({ key: "thinking-preview" })).toBeUndefined();
    await ui.unmount();
  });

  test("closing a response closes the underlying stream and clears its preview", async ($, on) => {
    let closed = false;
    on("turn.step", async function* () {
      try {
        yield { kind: "thinking", index: 0, text: "Interrupted thought" };
        yield { kind: "thinking", index: 0, text: "More" };
        return RESULT;
      } finally { closed = true; }
    });
    on("ui.render", { component: "AbovePrompt" }, ($, e) => $.ui.resolve(e).Box({}));
    const ui = await $.ui.mount(BAND);
    const stream = $.turn.step(STEP);
    await stream.next();
    await stream.return(RESULT);
    expect(closed).toBe(true);
    expect(await ui.find({ key: "thinking-preview" })).toBeUndefined();
    await ui.unmount();
  });

  test("large previews stay bounded without truncating the forwarded thinking", async ($, on) => {
    const text = "BEGIN" + "x".repeat(40000) + "LATEST";
    on("turn.step", async function* () { yield { kind: "thinking", index: 0, text }; return RESULT; });
    on("ui.render", { component: "AbovePrompt" }, ($, e) => $.ui.resolve(e).Box({}));
    const ui = await $.ui.mount(BAND);
    const stream = $.turn.step(STEP);
    expect((await stream.next()).value).toEqual({ kind: "thinking", index: 0, text });
    const visible = (await ui.find({ key: "thinking-preview" }))?.text ?? "";
    expect(visible.length).toBeLessThanOrEqual(8000);
    expect(visible.endsWith("LATEST")).toBe(true);
    expect(visible.includes("BEGIN")).toBe(false);
    await stream.next();
    await ui.unmount();
  });
});
