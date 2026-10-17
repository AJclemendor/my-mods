import { describe, expect, test } from "claude-code/testing";
import { emptyState, track, trackRow, candidates } from "../hooks/stops.mjs";

const PANE = { plugin: "prompt-nav", surface: "terminal", component: "Pane", requestId: "sidebar-controls",
  props: { title: "Mod controls", isFocused: false, bodyColumns: 28, placement: "dock", scroll: { offset: 0, bodyRows: 3 }, view: {} } } as const;
const BAND = { plugin: "prompt-nav", surface: "terminal", component: "AbovePrompt", requestId: "band",
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as const;

const whole = { first: 0, last: 2, of: 3 };

const shownPane = { id: "claude-buddy", title: "Claude Buddy", isPlaced: true, isFocused: false, isShown: true };

function controls(on: any, panes: any[] = []) {
  on("ui.panes", () => ({ value: panes }));
  on("ui.render", { component: "Pane" }, ($: any, e: any) => $.ui.resolve(e).Text({ children: `${e.props.title} body` }));
  on("ui.render", { component: "AbovePrompt" }, ($: any, e: any) => $.ui.resolve(e).Text({ children: "Compact tools: ON" }));
}

describe("prompt-nav controls", () => {
  test("every pane has a separate navigation row with Prev chat and Next chat", async ($, on) => {
    controls(on, [shownPane]);
    for (const [requestId, title] of [["sidebar-controls", "Mod controls"], ["claude-buddy", "Claude Buddy"]]) {
      const ui = await $.ui.mount({ ...PANE, requestId, props: { ...PANE.props, title } });
      expect(await ui.find({ type: "Text", text: `${title} body` })).toBeDefined();
      expect((await ui.find({ key: "prompt-nav-up" }))?.text).toBe("Prev chat");
      expect((await ui.find({ key: "prompt-nav-down" }))?.text).toBe("Next chat");
      await ui.unmount();
    }
  });

  test("above the prompt only while no pane is showing them", async ($, on) => {
    let panes: any[] = [shownPane];
    on("ui.panes", () => ({ value: panes }));
    on("ui.render", { component: "AbovePrompt" }, ($: any, e: any) => $.ui.resolve(e).Text({ children: "Controls" }));
    const band = await $.ui.mount(BAND);
    expect(await band.find({ key: "prompt-nav-up" })).toBeUndefined();
    panes = [];
    await band.redraw();
    expect(await band.find({ key: "prompt-nav-up" })).toBeDefined();
    await band.unmount();
  });

  test("an agent's transcript in view and native surveys get no arrows", async ($, on) => {
    controls(on);
    const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, view: { agentId: "a1" } } });
    expect(await pane.find({ key: "prompt-nav-up" })).toBeUndefined();
    await pane.unmount();
    const agent = await $.ui.mount({ ...BAND, props: { ...BAND.props, view: { agentId: "a1" } } });
    expect(await agent.find({ key: "prompt-nav-up" })).toBeUndefined();
    await agent.unmount();
    const survey = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true } });
    expect(await survey.find({ key: "prompt-nav-up" })).toBeUndefined();
    await survey.unmount();
  });

  test("prompt rows draw unchanged", async ($, on) => {
    on("ui.render", { component: "UserMessage" }, ($: any, e: any) => $.ui.resolve(e).Text({ children: e.props.text }));
    const drawn = await $.ui.render({ surface: "terminal", component: "UserMessage", requestId: "u1",
      props: { text: "hello", origin: { kind: "composer" }, isExpanded: true, onScreen: whole } } as any);
    expect(drawn).toMatchObject({ type: "Text" });
  });
});

describe("prompt-nav stops", () => {
  function session(...rows: [string, any][]) {
    const state = emptyState();
    for (const [id, seen] of rows) track(state, id, seen);
    return state;
  }

  test("Next chat stays still at the bottom even when several prompts are visible", () => {
    const state = session(["p1", whole], ["p2", whole], ["p3", whole]);
    trackRow(state, "last-reply", { first: 0, last: 4, of: 5 });
    expect(candidates(state, 1)).toEqual([]);
    expect(candidates(state, -1)).toEqual(["p2", "p1"]);
    trackRow(state, "last-reply", null);
    expect(candidates(state, 1)).toEqual(["p2", "p3"]);
  });

  test("Prev chat starts at the latest sent prompt below a long final answer", () => {
    const state = session(["p1", null], ["p2", null], ["p3", null]);
    trackRow(state, "last-reply", { first: 40, last: 79, of: 80 });
    expect(candidates(state, -1)).toEqual(["p3", "p2", "p1"]);
    expect(candidates(state, 1)).toEqual([]);
  });

  test("up walks back from the prompt at the top and down walks forward", () => {
    const state = session(["p1", null], ["p2", null], ["p3", whole]);
    expect(candidates(state, -1)).toEqual(["p2", "p1"]);
    state.landed = "p2"; track(state, "p2", whole);
    expect(candidates(state, -1)).toEqual(["p1"]);
    expect(candidates(state, 1)).toEqual(["p3"]);
  });

  test("the prompt a jump landed on is the reference even when an earlier one still shows", () => {
    const state = session(["p1", null], ["p2", whole], ["p3", whole]);
    state.landed = "p3";
    expect(candidates(state, -1)[0]).toBe("p2");
    expect(candidates(state, 1)).toEqual([]);
  });

  test("a prompt partly scrolled away is the first stop up, not skipped", () => {
    const state = session(["p1", null], ["p2", { first: 1, last: 2, of: 3 }]);
    expect(candidates(state, -1)[0]).toBe("p2");
    expect(candidates(state, 1)).toEqual([]);
  });

  test("inside a long reply, up returns to the prompt that scrolled off the top", () => {
    const state = session(["p1", null], ["p2", null], ["p3", null], ["p2", whole], ["p2", { first: 2, last: 2, of: 3 }], ["p2", null]);
    expect(candidates(state, -1)).toEqual(["p2", "p1"]);
    expect(candidates(state, 1)).toEqual(["p3"]);
  });

  test("a prompt that scrolled off the bottom bounds the viewport from below", () => {
    const state = session(["p1", null], ["p2", null], ["p2", { first: 0, last: 0, of: 3 }], ["p2", null]);
    expect(candidates(state, -1)).toEqual(["p1"]);
    expect(candidates(state, 1)).toEqual(["p2"]);
  });

  test("with nothing known about the viewport, up starts from the newest prompt", () => {
    const state = session(["p1", null], ["p2", null]);
    expect(candidates(state, -1)).toEqual(["p2", "p1"]);
    expect(candidates(state, 1)).toEqual([]);
  });

  test("the newest prompt, pushed off screen before it was ever reported in view, is the first stop up", () => {
    const state = session(["p1", null], ["p2", whole], ["p2", { first: 2, last: 2, of: 3 }], ["p2", null], ["p3", null]);
    expect(candidates(state, -1)).toEqual(["p3", "p2", "p1"]);
    expect(candidates(state, 1)).toEqual([]);
  });

  test("candidates keep going past a refused prompt", () => {
    const state = session(["p1", null], ["p2", null], ["p3", null], ["p4", whole]);
    expect(candidates(state, -1)).toEqual(["p3", "p2", "p1"]);
  });
});
