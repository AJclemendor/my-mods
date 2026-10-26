import { describe, expect, mock, test } from "claude-code/testing";

const PANE = { plugin: "buddy", surface: "desktop", component: "Pane", requestId: "claude-buddy",
  viewport: { columns: 80, rows: 50, isFullscreen: false },
  props: { title: "Claude Buddy", isFocused: true, bodyColumns: 48, placement: "inline", scroll: { offset: 0, bodyRows: 30 }, view: {} } } as const;
const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const reply = (text: string) => ({ isAnswered: true as const, text, usage });
const message = (role: "user" | "assistant", text: string) => ({ role, text, toolUses: [] });
const payload = (prompt: string) => JSON.parse(prompt.slice(prompt.lastIndexOf("\n\n") + 2));

function host(on: any, settings: any = {}) {
  mock.store(on, { settings: { version: 3, mode: "companion", model: "main", cadence: "120", ...settings } });
  mock.env(on, { HOME: "/fixture" });
  const clock = mock.clock(on);
  const opened: any[] = [], closed: any[] = [];
  on("ui.open", ($: any, e: any) => { opened.push(e); return { value: { isPlaced: true } }; });
  on("ui.close", ($: any, e: any) => { closed.push(e); return { value: undefined }; });
  on("ui.scroll", () => ({}));
  on("ui.focus", () => ({}));
  on("fs.list", () => ({ value: [] }));
  on("session.model", () => ({ value: "claude-main-model" }));
  on("turn.start", ($: any, e: any) => ({ turnId: e.turnId }));
  on("turn.complete", () => ({ text: "" }));
  on("session.start", ($: any, e: any) => ({ cwd: e.cwd }));
  on("session.attach", ($: any, e: any) => ({ clientId: e.clientId }));
  on("session.detach", ($: any, e: any) => ({ clientId: e.clientId }));
  on("command.register", () => ({ value: undefined }));
  return { clock, opened, closed };
}

describe("Buddy on Desktop", () => {
  test("desktop startup opens the pane and monitors without terminal fullscreen dimensions", async ($, on) => {
    const h = host(on);
    on("session.surfaces", () => ({ value: ["desktop"] }));
    on("session.messages", () => ({ value: [message("assistant", "Migration completed")] }));
    let calls = 0;
    on("model.fork", () => { calls++; return { value: reply(JSON.stringify({ summary: "Migration completed", flags: [], resolved: [], log: null })) }; });
    await $.session.start({ cwd: "/fixture", surface: "desktop", isInteractive: true });
    const ui = await $.ui.mount(PANE);
    await h.clock.advance(1000);
    expect(h.opened.some(e => e.id === "claude-buddy")).toBe(true);
    expect(h.closed.length).toBe(0);
    expect(calls).toBe(1);
    expect(await ui.find({ key: "buddy-page-information" })).toBeDefined();
    await h.clock.advance(120000);
    expect(calls).toBe(1);
    await ui.unmount();
  });

  test("late desktop attachment starts monitoring, detach stops it, and manual off survives reconnect", async ($, on) => {
    const h = host(on);
    let surfaces: any[] = [];
    let messages = [message("assistant", "First development")];
    on("session.surfaces", () => ({ value: surfaces }));
    on("session.messages", () => ({ value: messages }));
    let calls = 0;
    on("model.fork", () => { calls++; return { value: reply(JSON.stringify({ summary: null, flags: [], resolved: [], log: null })) }; });
    await $.session.start({ cwd: "/fixture", surface: null, isInteractive: false });
    await h.clock.advance(120000);
    expect(calls).toBe(0);
    surfaces = ["desktop"];
    await $.session.attach({ surface: "desktop", clientId: "app" });
    await h.clock.advance(1000);
    expect(calls).toBe(1);
    surfaces = [];
    await $.session.detach({ surface: "desktop", clientId: "app", reason: "detach" });
    messages = [...messages, message("assistant", "Next development")];
    await $.turn.start({ turnId: "next", text: "Continue" });
    await h.clock.advance(120000);
    expect(calls).toBe(1);
    surfaces = ["desktop"];
    await $.session.attach({ surface: "desktop", clientId: "app" });
    await h.clock.advance(1000);
    expect(calls).toBe(2);
    await $.command.run({ command: "buddy", args: "off" });
    const opens = h.opened.length;
    await $.session.attach({ surface: "desktop", clientId: "second-window" });
    await h.clock.advance(120000);
    expect(h.opened.length).toBe(opens);
    expect(calls).toBe(2);
  });

  test("Max, Log, clipboard feedback and clickable settings work on Desktop", async ($, on) => {
    const h = host(on);
    const evidence = "The full migration suite passed.";
    const flag = { key: "review", kind: "decision", text: "Choose when to deploy the migration.", evidence };
    on("session.messages", () => ({ value: [message("assistant", evidence)] }));
    const copies: any[] = [], writes: any[] = [];
    on("ui.copy", ($, e) => { copies.push(e); return { value: { isCopied: true } }; });
    on("fs.write", ($, e) => { writes.push(e); return { value: undefined }; });
    on("model.fork", ($, e) => ({ value: e.prompt.includes("Return only JSON") ? reply(JSON.stringify({
      summary: evidence, flags: [flag], resolved: [], log: { key: "migration", kind: "milestone", text: evidence, evidence },
    })) : reply("The migration is ready.") }));
    const ui = await $.ui.mount(PANE);
    await $.turn.start({ turnId: "migration", text: "Migrate" });
    await h.clock.advance(60000);
    await ui.press({ key: "buddy-update" });
    expect(await ui.find({ type: "Text", text: "Flags" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "Now" })).toBeDefined();
    await ui.press({ key: "copy:review" });
    expect(copies[0]).toEqual({ text: `${flag.text}\n\nEvidence:\n${evidence}`, surface: "desktop" });
    await ui.press({ key: "good:review" });
    expect(await ui.find({ key: "dismiss:review" })).toBeUndefined();
    await ui.press({ key: "buddy-page-log" });
    expect(await ui.find({ type: "Markdown", text: evidence })).toBeDefined();
    await ui.press({ key: "buddy-settings" });
    await ui.press({ key: "buddy-saved-feedback" });
    expect(await ui.find({ type: "Text", text: "Saved feedback (1)" })).toBeDefined();
    await ui.press({ key: "buddy-copy-prompt-path" });
    expect(copies.at(-1).surface).toBe("desktop");
    expect(writes[0].text).toContain(flag.text);
    await ui.press({ key: "buddy-settings" });
    await ui.press({ key: "buddy-activity-log-false" });
    await ui.press({ key: "buddy-done" });
    expect(await ui.find({ key: "buddy-page-log" })).toBeUndefined();
    await ui.unmount();
  });

  test("desktop chat keeps long replies scrollable and refreshes context on follow-ups", async ($, on) => {
    host(on, { mode: "chat" });
    let messages = [message("assistant", "CONTEXT_ONE")];
    const sent: any[] = [];
    on("session.messages", () => ({ value: messages }));
    on("model.fork", ($, e) => { sent.push(payload(e.prompt)); return { value: reply(`ANSWER_${sent.length} ` + "long reply ".repeat(100)) }; });
    const ui = await $.ui.mount(PANE);
    await ui.input({ key: "buddy-question", text: "FIRST_QUESTION" });
    messages = [...messages, message("assistant", "CONTEXT_TWO")];
    await ui.input({ key: "buddy-question", text: "SECOND_QUESTION" });
    expect(sent[1].mainSessionUpdates[0].text).toContain("CONTEXT");
    expect(JSON.stringify(sent[1])).toContain("CONTEXT_TWO");
    expect(sent[1].sideConversation.length).toBe(2);
    expect(await ui.find({ type: "Markdown", text: /ANSWER_1/ })).toBeDefined();
    expect(await ui.find({ type: "Markdown", text: /ANSWER_2/ })).toBeDefined();
    expect(await ui.find({ key: "buddy-chat-older" })).toBeUndefined();
    await ui.press({ key: "buddy-reset" });
    expect(await ui.find({ type: "Markdown", text: /ANSWER_1/ })).toBeUndefined();
    await ui.unmount();
  });

  test("a narrow attached terminal cannot close the desktop pane", async ($, on) => {
    const h = host(on, { mode: "chat" });
    on("ui.render", { component: "PromptHint" }, ($, e) => $.ui.resolve(e).Box({}));
    const ui = await $.ui.mount(PANE);
    await $.ui.render({ surface: "terminal", component: "PromptHint", viewport: { columns: 70, rows: 30, isFullscreen: false },
      props: { isDraft: false, isWorking: false, hint: "", } });
    await h.clock.advance(0);
    expect(h.closed.length).toBe(0);
    expect(await ui.find({ key: "buddy-question" })).toBeDefined();
    await ui.unmount();
  });
});
