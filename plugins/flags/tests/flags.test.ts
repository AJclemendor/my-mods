import { describe, expect, mock, test } from "claude-code/testing";

const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const message = (text: string) => ({ role: "assistant" as const, text, toolUses: [] });
const answer = (flags: any[] = [], resolved: any[] = []) => ({ isAnswered: true as const, text: JSON.stringify({ flags, resolved }), usage });
const first = { key: "scope", kind: "attention", text: "The gateway change is outside the requested scope.", evidence: "I also changed the gateway" };
const second = { key: "test", kind: "uncertain", text: "The completion claim has no test result to support it.", evidence: "All done without running tests" };
const third = { key: "decision", kind: "decision", text: "The migration deletes archived records; confirm the retention requirement.", evidence: "The migration deletes archived records" };
const payload = (prompt: string) => JSON.parse(prompt.slice(prompt.lastIndexOf("\n\n") + 2));
const recordKey = (flag: any) => `flag:${JSON.stringify(["/fixture", flag.key, flag.text, flag.evidence])}`;
const pane = (surface: "terminal" | "desktop" = "terminal") => ({ plugin: "flags", surface, component: "Pane" as const, requestId: "flags",
  props: { title: "Flags", isFocused: true, bodyColumns: 54, placement: surface === "desktop" ? "inline" as const : "dock" as const, scroll: { offset: 0, bodyRows: 45 }, view: {} } });
function host(on: any, saved: any = {}, customStore = false) {
  const stored: Record<string, any> = structuredClone(saved);
  if (!customStore) {
    // Match the production store's key limit; mock.store does not enforce it.
    const checkKey = (key: string) => { if (!key || key.length > 256) throw new Error("Store key exceeds 256 characters"); };
    on("store.keys", () => ({ value: Object.keys(stored) }));
    on("store.get", ($: any, e: any) => { checkKey(e.key); return { value: structuredClone(stored[e.key]) }; });
    on("store.set", ($: any, e: any) => { checkKey(e.key); stored[e.key] = structuredClone(e.value); return { value: undefined }; });
    on("store.delete", ($: any, e: any) => { checkKey(e.key); delete stored[e.key]; return { value: undefined }; });
  }
  mock.env(on, { HOME: "/fixture" });
  const clock = mock.clock(on);
  const opened: any[] = [], closed: any[] = [];
  on("session.cwd", () => ({ value: "/fixture" }));
  const state = { active: ["terminal"] as string[], messages: [message([first.evidence, second.evidence, third.evidence].join(". "))] };
  on("session.surfaces", () => ({ value: state.active }));
  on("session.start", ($: any, e: any) => ({ cwd: e.cwd }));
  on("session.attach", ($: any, e: any) => ({ clientId: e.clientId }));
  on("session.detach", ($: any, e: any) => ({ clientId: e.clientId }));
  on("command.register", () => ({ value: undefined }));
  on("ui.open", ($: any, e: any) => { opened.push(e); return { value: { isPlaced: true } }; });
  on("ui.close", ($: any, e: any) => { closed.push(e); return { value: undefined }; });
  on("fs.list", () => ({ value: [] }));
  on("turn.start", ($: any, e: any) => ({ turnId: e.turnId }));
  on("turn.complete", () => ({ text: "" }));
  on("session.messages", () => ({ value: state.messages }));
  return { clock, opened, closed, state, stored };
}

for (const surface of ["terminal", "desktop"] as const) describe(`Flags on ${surface}`, () => {
  test("long flags can be dismissed and rated within the production storage limit", async ($, on) => {
    const h = host(on);
    const flags = ["dismiss", "good", "bad"].map(action => ({
      key: action, kind: "attention", text: `Important ${action}: ${"Long detailed finding. ".repeat(30).trim()}`,
      evidence: `Evidence for ${action}: ${"Detailed supporting quote. ".repeat(20).trim()}`,
    }));
    h.state.messages = [message(flags.map(f => f.evidence).join("\n"))];
    on("model.fork", () => ({ value: answer(flags) }));
    const ui = await $.ui.mount(pane(surface));
    await $.command.run({ command: "flags", args: "check" });
    for (const flag of flags) {
      expect(recordKey(flag).length > 256).toBe(true);
      await ui.press({ key: `${flag.key}:${flag.key}` });
      expect(await ui.find({ key: `dismiss:${flag.key}` })).toBeUndefined();
    }
    const entries = Object.entries(h.stored).filter(([key]) => key.startsWith("flag:"));
    expect(entries.length).toBe(3);
    for (const [key, entry] of entries) {
      expect(key.length <= 256).toBe(true);
      expect(entry.flag).toEqual(flags.find(f => f.key === entry.action));
    }
    await $.command.run({ command: "flags", args: "check" });
    expect(await ui.find({ type: "Text", text: "No flags to review." })).toBeDefined();
    await ui.unmount();
  });

  test("one review shows multiple flags, copy is plain, and Good/Bad immediately save and dismiss", async ($, on) => {
    host(on);
    let calls = 0; const copies: any[] = [], prompts: any[] = [];
    on("model.fork", ($, e) => { calls++; prompts.push(payload(e.prompt)); return { value: answer([first, second, third]) }; });
    on("prompt.submit", () => { throw new Error("Must not send a main-chat message"); });
    on("ui.copy", ($, e) => { copies.push(e); return { value: { isCopied: true } }; });
    const ui = await $.ui.mount(pane(surface));
    await $.command.run({ command: "flags", args: "check" });
    for (const flag of [first, second, third]) expect(await ui.find({ key: `dismiss:${flag.key}` })).toBeDefined();
    await ui.press({ key: "copy:scope" });
    expect(copies).toEqual([{ text: `${first.text}\n\n${first.evidence}`, surface }]);
    expect(await ui.find({ key: "dismiss:scope" })).toBeDefined();
    await ui.press({ key: "good:scope" }); await ui.press({ key: "bad:test" }); await ui.press({ key: "dismiss:decision" });
    expect(calls).toBe(1);
    for (const flag of [first, second, third]) expect(await ui.find({ key: `dismiss:${flag.key}` })).toBeUndefined();
    await $.command.run({ command: "flags", args: "check" });
    expect(prompts[1].dismissed).toEqual([first, second, third]);
    expect(prompts[1].flagFeedback).toEqual([{ rating: "good", flag: first }, { rating: "bad", flag: second }]);
    expect(await ui.find({ type: "Text", text: "No flags to review." })).toBeDefined();
    await ui.press({ key: "settings" }); await ui.press({ key: "saved" });
    expect(await ui.find({ type: "Text", text: "Saved feedback & dismissals (3)" })).toBeDefined();
    await ui.unmount();
  });
});

describe("Flag review state", () => {
  test("persisted dismissal suppresses reworded evidence in this project and Forget permits it again", async ($, on) => {
    const renamed = { ...first, key: "new-name", text: "Different phrasing", evidence: "I also changed the gateway" };
    host(on, { [recordKey(first)]: { scope: "/fixture", action: "dismiss", flag: first } });
    on("model.fork", () => ({ value: answer([renamed]) }));
    const ui = await $.ui.mount(pane());
    await $.command.run({ command: "flags", args: "check" });
    expect(await ui.find({ key: "dismiss:new-name" })).toBeUndefined();
    await ui.press({ key: "settings" }); await ui.press({ key: "saved" });
    await ui.press({ key: `forget:${recordKey(first)}` });
    await $.command.run({ command: "flags", args: "check" });
    expect(await ui.find({ key: "dismiss:new-name" })).toBeDefined();
    await ui.unmount();
  });
  test("saved feedback calibrates across projects but dismissal does not hide other projects' flags", async ($, on) => {
    host(on, { [recordKey(first)]: { scope: "/different-project", action: "bad", flag: first } });
    const prompts: any[] = [];
    on("model.fork", ($, e) => { prompts.push(payload(e.prompt)); return { value: answer([first]) }; });
    const ui = await $.ui.mount(pane());
    await $.command.run({ command: "flags", args: "check" });
    expect(prompts[0].dismissed).toEqual([]);
    expect(prompts[0].flagFeedback).toEqual([{ rating: "bad", flag: first }]);
    expect(await ui.find({ key: "dismiss:scope" })).toBeDefined();
    await ui.unmount();
  });
  test("a failed save leaves the flag visible and retry saves both feedback and dismissal", async ($, on) => {
    host(on, {}, true); const stored: any = {}; let fail = true;
    on("store.keys", () => ({ value: Object.keys(stored) }));
    on("store.get", ($, e) => ({ value: stored[e.key] }));
    on("store.set", ($, e) => { if (fail) throw new Error("Disk unavailable"); stored[e.key] = e.value; return { value: undefined }; });
    on("model.fork", () => ({ value: answer([first]) }));
    const ui = await $.ui.mount(pane());
    await $.command.run({ command: "flags", args: "check" });
    await ui.press({ key: "good:scope" });
    expect(await ui.find({ key: "dismiss:scope" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /Could not save this action/ })).toBeDefined();
    fail = false; await ui.press({ key: "good:scope" });
    expect(Object.values(stored).find((entry: any) => entry.flag?.key === first.key)?.action).toBe("good");
    expect(await ui.find({ key: "dismiss:scope" })).toBeUndefined();
    await ui.unmount();
  });
  test("a rating discards results from a review that did not see it", async ($, on) => {
    host(on); let calls = 0;
    let release: (value: any) => void = () => {}, entered: () => void = () => {};
    const waiting = new Promise(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    on("model.fork", async () => { if (++calls === 1) return { value: answer([first]) }; entered(); return { value: await waiting as any }; });
    const ui = await $.ui.mount(pane());
    await $.command.run({ command: "flags", args: "check" });
    const work = $.command.run({ command: "flags", args: "check" });
    await started; await ui.press({ key: "bad:scope" }); release(answer([second])); await work;
    expect(await ui.find({ key: "dismiss:test" })).toBeUndefined();
    expect(await ui.find({ key: "dismiss:scope" })).toBeUndefined();
    await ui.unmount();
  });
  test("no polling when idle; changed activity is checked once and unchanged turn events are skipped", async ($, on) => {
    const { clock, state } = host(on); let calls = 0;
    state.messages = [message("Work is underway")];
    on("model.fork", () => { calls++; return { value: answer() }; });
    await $.session.start({ cwd: "/fixture", surface: "terminal", isInteractive: true });
    await clock.advance(1000); expect(calls).toBe(1);
    await clock.advance(600000); expect(calls).toBe(1);
    await $.turn.start({ turnId: "unchanged", text: "continue" }); await clock.advance(30000); expect(calls).toBe(1);
    state.messages = [message("The migration is underway")];
    await $.turn.start({ turnId: "changed", text: "continue" }); await clock.advance(30000); expect(calls).toBe(2);
    await clock.advance(600000); expect(calls).toBe(2);
  });
  test("empty sessions and subagent work do not trigger model requests", async ($, on) => {
    const { clock, state } = host(on); let calls = 0;
    state.messages = [];
    on("model.fork", () => { calls++; return { value: answer() }; });
    await $.session.start({ cwd: "/fixture", surface: "terminal", isInteractive: true });
    await clock.advance(1000);
    await $.turn.start({ turnId: "sub", agentId: "other", text: "work" }); await clock.advance(60000);
    expect(calls).toBe(0);
  });
  test("invalid flags are skipped without losing valid ones and resolutions require new evidence", async ($, on) => {
    const { state } = host(on); let result = answer([first, { ...second, evidence: "Fabricated evidence" }, third]);
    on("model.fork", () => ({ value: result }));
    const ui = await $.ui.mount(pane());
    await $.command.run({ command: "flags", args: "check" });
    expect(await ui.find({ key: "dismiss:scope" })).toBeDefined();
    expect(await ui.find({ key: "dismiss:decision" })).toBeDefined();
    expect(await ui.find({ key: "dismiss:test" })).toBeUndefined();
    result = answer([], [{ key: first.key, evidence: first.evidence }]);
    await $.command.run({ command: "flags", args: "check" }); expect(await ui.find({ key: "dismiss:scope" })).toBeDefined();
    state.messages = [message(`${first.evidence}. I reverted the gateway change.`)];
    result = answer([], [{ key: first.key, evidence: "I reverted the gateway change." }]);
    await $.command.run({ command: "flags", args: "check" }); expect(await ui.find({ key: "dismiss:scope" })).toBeUndefined();
    expect(await ui.find({ key: "dismiss:decision" })).toBeDefined();
    await ui.unmount();
  });
  test("custom effort uses full text and session instructions; prompt export includes saved calibration", async ($, on) => {
    host(on, { settings: { model: "custom-model", effort: "high" }, [recordKey(first)]: { scope: "/fixture", action: "good", flag: first } });
    on("prompt.compose", () => ({ sections: [{ id: "system", scope: "shared", text: "PROJECT_INSTRUCTIONS" }] }));
    const requests: any[] = [], writes: any[] = [], copies: any[] = [];
    on("model.complete", ($, e) => { requests.push(e); return { value: answer() }; });
    on("fs.write", ($, e) => { writes.push(e); return { value: undefined }; });
    on("ui.copy", ($, e) => { copies.push(e); return { value: { isCopied: true } }; });
    const ui = await $.ui.mount(pane("desktop"));
    await $.command.run({ command: "flags", args: "check" });
    expect(requests[0].model).toBe("custom-model"); expect(requests[0].effort).toBe("high");
    expect(requests[0].system).toContain("PROJECT_INSTRUCTIONS");
    expect(payload(requests[0].prompt).mainConversation[0].text).toContain(third.evidence);
    await ui.press({ key: "settings" }); await ui.press({ key: "prompt" }); await ui.press({ key: "copy-path" });
    expect(writes[0].path).toBe("/fixture/.claude/flags/review-guidance.txt");
    expect(writes[0].text).toContain(first.text); expect(writes[0].text).toContain("Return only JSON");
    expect(copies[0]).toEqual({ text: writes[0].path, surface: "desktop" });
    await ui.unmount();
  });
  test("headless sessions wait for Desktop and explicit off survives reconnection", async ($, on) => {
    const h = host(on); h.state.active = []; let calls = 0;
    on("model.fork", () => { calls++; return { value: answer() }; });
    await $.session.start({ cwd: "/fixture", surface: "sdk", isInteractive: false }); await h.clock.advance(60000); expect(calls).toBe(0);
    h.state.active = ["desktop"]; await $.session.attach({ clientId: "desk", surface: "desktop" }); await h.clock.advance(1000); expect(calls).toBe(1);
    await $.command.run({ command: "flags", args: "off" });
    const count = h.opened.length;
    h.state.active = []; await $.session.detach({ clientId: "desk", surface: "desktop" });
    h.state.active = ["desktop"]; await $.session.attach({ clientId: "desk2", surface: "desktop" });
    await h.clock.advance(60000); expect(h.opened.length).toBe(count); expect(calls).toBe(1);
  });
  test("narrow terminal pauses then resumes when docked space returns", async ($, on) => {
    const h = host(on); let calls = 0;
    on("model.fork", () => { calls++; return { value: answer() }; });
    on("ui.render", { component: "PromptHint" }, ($, e) => $.ui.resolve(e).Text({ children: "hint" }));
    const narrow = await $.ui.mount({ ...pane(), props: { ...pane().props, placement: "inline" } });
    await h.clock.advance(1); await $.command.run({ command: "flags", args: "check" }); expect(calls).toBe(0);
    await narrow.unmount();
    const wide = await $.ui.mount({ plugin: "flags", surface: "terminal", component: "PromptHint", requestId: "hint", viewport: { columns: 160, rows: 50, isFullscreen: true }, props: {} } as any);
    await h.clock.advance(1001); expect(calls).toBe(1);
    await wide.unmount();
  });
  test("sidebar actions do not redraw unrelated transcript rows", async ($, on) => {
    host(on); let draws = 0;
    on("ui.render", { component: "UserMessage" }, ($, e) => { draws++; return $.ui.resolve(e).Text({ children: e.props.text }); });
    const transcript = await $.ui.mount({ plugin: "flags", surface: "terminal", component: "UserMessage", requestId: "old", props: { text: "Earlier", origin: { kind: "composer" }, isExpanded: true, onScreen: null } });
    const ui = await $.ui.mount(pane()); await transcript.find({ type: "Text", text: "Earlier" }); const before = draws;
    await ui.press({ key: "settings" }); await ui.press({ key: "prompt" });
    await transcript.find({ type: "Text", text: "Earlier" }); expect(draws).toBe(before);
    await ui.unmount(); await transcript.unmount();
  });
  test("changes in tool result text are included in the next review", async ($, on) => {
    const { clock, state } = host(on);
    const messages: any[] = [{ role: "assistant", text: "", toolUses: [{ tool_use_id: "check", tool: "Bash", input: { command: "test" } }] }];
    state.messages = messages;
    const prompts: any[] = [];
    on("model.fork", ($, e) => { prompts.push(payload(e.prompt)); return { value: answer() }; });
    await $.session.start({ cwd: "/fixture", surface: "terminal", isInteractive: true }); await clock.advance(1000);
    messages[0].toolUses[0].text = "CHECK_FAILED"; messages[0].toolUses[0].isError = true;
    await $.turn.start({ turnId: "result", text: "continue" }); await clock.advance(30000);
    expect(prompts.length).toBe(2);
    expect(prompts[1].mainSessionUpdates[0].toolUses[0].text).toBe("CHECK_FAILED");
  });
  test("distinct concerns can share a supporting quote", async ($, on) => {
    host(on);
    const other = { ...second, evidence: first.evidence };
    on("model.fork", () => ({ value: answer([first, other]) }));
    const ui = await $.ui.mount(pane()); await $.command.run({ command: "flags", args: "check" });
    expect(await ui.find({ key: "dismiss:scope" })).toBeDefined();
    expect(await ui.find({ key: "dismiss:test" })).toBeDefined();
    await ui.unmount();
  });
  test("a failed review does not retry while idle", async ($, on) => {
    const { clock } = host(on); let calls = 0;
    on("model.fork", () => { calls++; return { value: { isAnswered: false, reason: "empty-reply" } }; });
    await $.session.start({ cwd: "/fixture", surface: "terminal", isInteractive: true }); await clock.advance(1000);
    await $.turn.start({ turnId: "same", text: "continue" }); await clock.advance(600000);
    expect(calls).toBe(1);
    await $.command.run({ command: "flags", args: "check" }); expect(calls).toBe(2);
  });
  test("a narrow terminal does not close a connected Desktop panel", async ($, on) => {
    const h = host(on); h.state.active = ["desktop", "terminal"];
    on("model.fork", () => ({ value: answer([first]) }));
    await $.session.start({ cwd: "/fixture", surface: "desktop", isInteractive: true });
    const desktop = await $.ui.mount(pane("desktop"));
    const terminal = await $.ui.mount({ ...pane(), props: { ...pane().props, placement: "inline" } });
    await h.clock.advance(1000);
    expect(h.closed.length).toBe(0); expect(await desktop.find({ key: "dismiss:scope" })).toBeDefined();
    await terminal.unmount(); await desktop.unmount();
  });

});
