import { describe, expect, test } from "claude-code/testing";

const event = {
  surface: "terminal", component: "AbovePrompt", requestId: "band",
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const;

describe("plugin-h", () => {
  test("hides the strip as a native site and toggles back to other mods", async ($, on) => {
    on("store.set", () => ({ value: undefined }));
    on("ui.render", { component: "AbovePrompt" }, ($, e) => $.ui.resolve(e).Text({ children: "Controls" }));
    expect((await $.ui.render(event)).type).toBe("Text");
    await $.command.run({ command: "plugin-h", args: "" });
    expect(await $.ui.render(event)).toEqual({ type: "engine", ref: 0 });
    await $.command.run({ command: "plugin-h", args: "" });
    expect((await $.ui.render(event)).type).toBe("Text");
  });

  test("explicit hide is idempotent and saves the preference", async ($, on) => {
    const saved: unknown[] = [];
    on("store.set", ($, e) => { saved.push(e); return { value: undefined }; });
    await $.command.run({ command: "plugin-h", args: "hide" });
    await $.command.run({ command: "plugin-h", args: "hide" });
    expect(await $.ui.render(event)).toEqual({ type: "engine", ref: 0 });
    expect(saved.length).toBe(2);
    await $.command.run({ command: "plugin-h", args: "show" });
    expect(saved).toEqual([
      { key: "hidden", value: true },
      { key: "hidden", value: true },
      { key: "hidden", value: false },
    ]);
  });

  test("hidden mode still yields to native surveys and nonterminal surfaces", async ($, on) => {
    on("store.set", () => ({ value: undefined }));
    on("ui.render", { component: "AbovePrompt" }, ($, e) => $.ui.resolve(e).Text({ children: "Keep this" }));
    await $.command.run({ command: "plugin-h", args: "hide" });
    expect((await $.ui.render({ ...event, props: { ...event.props, hasSurvey: true } })).type).toBe("Text");
    expect((await $.ui.render({ ...event, surface: "desktop" })).type).toBe("Text");
  });

  test("invalid arguments do not change visibility or storage", async ($, on) => {
    let written = false;
    on("store.set", () => { written = true; return { value: undefined }; });
    on("ui.render", { component: "AbovePrompt" }, ($, e) => $.ui.resolve(e).Text({ children: "Controls" }));
    expect((await $.command.run({ command: "plugin-h", args: "maybe" })).text).toBe("Usage: /plugin-h [hide|show|toggle]");
    expect(written).toBe(false);
    expect((await $.ui.render(event)).type).toBe("Text");
  });
});
