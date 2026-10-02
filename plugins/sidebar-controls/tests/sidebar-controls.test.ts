import { describe, expect, test } from "claude-code/testing";

const BAND = {
  plugin: "sidebar-controls", surface: "terminal", component: "AbovePrompt",
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const;

const reader = {
  name: "reader",
  register(on: any) {
    on("ui.render", { component: "AbovePrompt" }, async ($: any, e: any) => {
      const { value } = await $.state.get({ plugin: "sidebar-controls", key: "visible" });
      return $.ui.resolve(e).Text({ children: value ? "sidebar" : "prompt" });
    });
  },
};

describe("sidebar-controls", () => {
  test("opening requests a 28-column pane without taking keyboard focus", async ($, on) => {
    let opened: unknown;
    on("ui.panes", () => ({ value: [] }));
    on("ui.open", ($, e) => { opened = e; return { value: { isPlaced: true } }; });
    await $.command.run({ command: "sidebar-controls", args: "on" });
    expect(opened).toEqual({ id: "sidebar-controls", title: "Mod controls", columns: 28, rows: 3 });
  });

  test("toggle closes the controls pane without closing another pane", async ($, on) => {
    let closed = "";
    on("ui.panes", () => ({ value: [{ id: "sidebar-controls", title: "Mod controls", isPlaced: true, isFocused: false, isShown: true }, { id: "other", title: "Other", isPlaced: true, isFocused: false, isShown: false }] }));
    on("ui.close", ($, e) => { closed = e.id; return { value: undefined }; });
    await $.command.run({ command: "sidebar-controls", args: "" });
    expect(closed).toBe("sidebar-controls");
  });

  test("invalid commands leave the layout alone", async ($, on) => {
    let changed = false;
    on("ui.open", () => { changed = true; return { value: { isPlaced: true } }; });
    on("ui.close", () => { changed = true; return { value: undefined }; });
    expect((await $.command.run({ command: "sidebar-controls", args: "maybe" })).text).toBe("Usage: /sidebar-controls [on|off]");
    expect(changed).toBe(false);
  });

  test("a pane waiting for terminal space does not hide the prompt controls", { plugins: [reader] }, async ($, on) => {
    let placed = false;
    on("ui.panes", () => ({ value: [{ id: "sidebar-controls", title: "Mod controls", isPlaced: placed, isFocused: false, isShown: placed }] }));
    const band = await $.ui.mount({ ...BAND, plugin: "reader" });
    expect((await band.find({ type: "Text" }))?.text).toBe("prompt");
    placed = true;
    await band.redraw();
    expect((await band.find({ type: "Text" }))?.text).toBe("sidebar");
    await band.unmount();
  });

  test("closing redraws the prompt controls using the host's current pane state", { plugins: [reader] }, async ($, on) => {
    let open = true;
    on("ui.panes", () => ({ value: open ? [{ id: "sidebar-controls", title: "Mod controls", isPlaced: true, isFocused: false, isShown: true }] : [] }));
    on("ui.close", () => { open = false; return { value: undefined }; });
    const band = await $.ui.mount({ ...BAND, plugin: "reader" });
    expect((await band.find({ type: "Text" }))?.text).toBe("sidebar");
    await $.command.run({ command: "sidebar-controls", args: "off" });
    expect((await band.find({ type: "Text" }))?.text).toBe("prompt");
    await band.unmount();
  });
});
