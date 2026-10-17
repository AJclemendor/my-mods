import { describe, expect, mock, test } from "claude-code/testing";

const PANE = { plugin: "buddy", surface: "terminal", component: "Pane", requestId: "claude-buddy",
  props: { title: "Claude Buddy", isFocused: true, bodyColumns: 54, placement: "dock", scroll: { offset: 0, bodyRows: 45 }, view: {} } } as const;
const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 };
const reply = (text: string) => ({ isAnswered: true as const, text, usage });
const digest = (summary: string | null = "Claude is checking the change.", flags: any[] = [], resolved: any[] = [], log: any = null) => reply(JSON.stringify({ summary, log, flags, resolved }));
const milestone = (key: string, text: string, evidence = text) => ({ key, kind: "milestone", text, evidence });
const message = (role: "user" | "assistant", text: string) => ({ role, text, toolUses: [] });
const payload = (prompt: string) => JSON.parse(prompt.slice(prompt.lastIndexOf("\n\n") + 2));

function host(on: any, settings: any = {}, files: any[] = [], toasts: boolean[] = [], panes: any = {}, stored: any = {}) {
  if (stored !== false) mock.store(on, { settings: { version: 3, mode: "companion", model: "main", ...settings }, ...stored });
  mock.env(on, { HOME: "/fixture" });
  on("fs.list", () => ({ value: files }));
  const clock = mock.clock(on);
  on("ui.open", ($: any, e: any) => { panes.opened?.push(e.id); return { value: { isPlaced: true } }; });
  on("ui.close", ($: any, e: any) => { panes.closed?.push(e.id); return { value: undefined }; });
  on("ui.focus", () => ({}));
  on("ui.toast", () => { toasts.push(true); return { value: undefined }; });
  on("ui.scroll", () => ({}));
  on("turn.start", ($: any, e: any) => ({ turnId: e.turnId }));
  on("turn.complete", () => ({ text: "" }));
  on("session.model", () => ({ value: "claude-main-model" }));
  return clock;
}

async function expectLogCount(ui: any, count: number) {
  await ui.press({ key: "buddy-page-log" });
  const text = count ? `Last ${count} ${count === 1 ? "summary" : "summaries"} · newest first` : "No summaries yet.";
  expect(await ui.find({ type: "Text", text })).toBeDefined();
  await ui.press({ key: "buddy-page-information" });
}

describe("Claude Buddy", () => {
  test("sidebar interactions do not invalidate unrelated transcript rows", async ($, on) => {
    host(on);
    let transcriptDraws = 0;
    on("ui.render", { component: "UserMessage" }, ($, e) => {
      transcriptDraws++;
      return $.ui.resolve(e).Text({ children: e.props.text });
    });
    const transcript = await $.ui.mount({ plugin: "buddy", surface: "terminal", component: "UserMessage", requestId: "old-prompt",
      props: { text: "An earlier prompt", origin: { kind: "composer" }, isExpanded: true, onScreen: null } });
    const ui = await $.ui.mount(PANE);
    await transcript.find({ type: "Text", text: "An earlier prompt" });
    const before = transcriptDraws;
    await ui.press({ key: "buddy-page-chat" });
    await transcript.find({ type: "Text", text: "An earlier prompt" });
    await ui.press({ key: "buddy-settings" });
    await transcript.find({ type: "Text", text: "An earlier prompt" });
    expect(transcriptDraws).toBe(before);
    await transcript.unmount();
    await ui.unmount();
  });

  test("Settings lists every saved rating and can edit or delete feedback from older sessions", async ($, on) => {
    const first = { key: "first", kind: "attention", text: "First example", evidence: "First evidence" };
    const second = { key: "second", kind: "decision", text: "Second example", evidence: "Second evidence" };
    host(on, {}, [], [], {}, { flagFeedback: [
      { rating: "good", note: "Keep consequences", flag: first },
      { rating: "bad", note: "Too obvious", flag: second },
    ] });
    const prompts: any[] = [];
    on("session.messages", () => ({ value: [message("assistant", "Work continues")] }));
    on("model.fork", ($, e) => { prompts.push(payload(e.prompt)); return { value: digest(null) }; });
    const ui = await $.ui.mount(PANE);
    await ui.press({ key: "buddy-settings" });
    await ui.press({ key: "buddy-saved-feedback" });
    expect(await ui.find({ type: "Text", text: "Saved feedback (2)" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "Note: Keep consequences" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "Note: Too obvious" })).toBeDefined();
    await ui.press({ key: "feedback-edit:0" });
    expect(await ui.find({ key: "buddy-feedback-save" })).toBeUndefined();
    expect(await ui.find({ key: "buddy-feedback-cancel" })).toBeUndefined();
    await ui.input({ key: "buddy-feedback-note", text: "Useful when the tradeoff is hidden", kind: "change" });
    await ui.press({ key: "buddy-feedback-good" });
    expect(await ui.find({ type: "Text", text: "Note: Useful when the tradeoff is hidden" })).toBeDefined();
    await ui.press({ key: "feedback-delete:0" });
    expect(await ui.find({ type: "Text", text: "Saved feedback (1)" })).toBeDefined();
    await ui.press({ key: "buddy-page-information" });
    await ui.press({ key: "buddy-update" });
    expect(prompts[0].flagFeedback).toEqual([{ rating: "good", note: "Keep consequences", flag: first }]);
    await ui.unmount();
  });

  test("prompt view and Copy path include the real review instructions and all saved guidance", async ($, on) => {
    const flag = { key: "scope", kind: "attention", text: "Scope example", evidence: "Scope evidence" };
    host(on, {}, [], [], {}, { flagFeedback: [{ rating: "bad", note: "Skip routine reads", flag }], known: ["I understand caching"] });
    const writes: any[] = [], copies: any[] = [];
    on("fs.write", ($, e) => { writes.push(e); return { value: undefined }; });
    on("ui.copy", ($, e) => { copies.push(e); return { value: { isCopied: true } }; });
    const ui = await $.ui.mount(PANE);
    await ui.press({ key: "buddy-settings" });
    await ui.press({ key: "buddy-saved-feedback" });
    await ui.press({ key: "buddy-view-prompt" });
    expect(await ui.find({ type: "Text", text: /flagFeedback contains examples/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /Skip routine reads/ })).toBeDefined();
    await ui.press({ key: "buddy-copy-prompt-path" });
    expect(writes[0].path).toBe("/fixture/.claude/buddy/review-guidance.txt");
    expect(writes[0].text).toContain("Return only JSON");
    expect(writes[0].text).toContain("Skip routine reads");
    expect(writes[0].text).toContain("I understand caching");
    expect(copies).toEqual([{ text: "/fixture/.claude/buddy/review-guidance.txt", surface: "terminal" }]);
    expect(await ui.find({ type: "Text", text: /Path copied:/ })).toBeDefined();
    await ui.unmount();
  });

  test("rating a flag during a review dismisses it and holds new flags until the review has seen the rating", async ($, on) => {
    const clock = host(on);
    const first = { key: "first", kind: "attention", text: "The gateway change is outside scope.", evidence: "I also changed the gateway" };
    const second = { key: "second", kind: "attention", text: "The API change is outside scope.", evidence: "I also changed the API" };
    on("session.messages", () => ({ value: [message("assistant", `${first.evidence}. ${second.evidence}.`)] }));
    let release: (value: any) => void = () => {};
    let entered: () => void = () => {};
    const started = new Promise<void>(resolve => { entered = resolve; });
    const waiting = new Promise(resolve => { release = resolve; });
    const prompts: any[] = [];
    on("model.fork", async ($, e) => {
      prompts.push(payload(e.prompt));
      if (prompts.length === 1) return { value: digest(null, [first]) };
      if (prompts.length === 2) { entered(); return { value: await waiting as any }; }
      return { value: digest(null) };
    });
    const ui = await $.ui.mount(PANE);
    await ui.press({ key: "buddy-update" });
    const work = $.command.run({ command: "buddy", args: "update" });
    await started;
    await ui.press({ key: "bad:first" });
    release(digest(null, [second]));
    await work;
    expect(await ui.find({ key: "bad:second" })).toBeUndefined();
    await clock.advance(30000);
    expect(prompts[2].flagFeedback[0].rating).toBe("bad");
    expect(prompts[2].dismissed).toEqual([first]);
    expect(await ui.find({ key: "dismiss:first" })).toBeUndefined();
    await ui.unmount();
  });

  test("Good and Bad immediately save and dismiss flags without opening an editor or sending chat", async ($, on) => {
    host(on, { activityLog: false });
    const first = { key: "scope", kind: "attention", text: "The gateway change is outside scope.", evidence: "I also changed the gateway" };
    const second = { key: "api", kind: "attention", text: "The API change is outside scope.", evidence: "I also changed the API" };
    let flag = first;
    on("session.messages", () => ({ value: [message("assistant", `${first.evidence}. ${second.evidence}.`)] }));
    on("prompt.submit", () => { throw new Error("Feedback must not submit a main prompt"); });
    const prompts: any[] = [];
    on("model.fork", ($, e) => { prompts.push(payload(e.prompt)); return { value: digest(null, [flag]) }; });
    const ui = await $.ui.mount(PANE);
    await ui.press({ key: "buddy-update" });
    await ui.press({ key: "good:scope" });
    expect(prompts.length).toBe(1);
    expect(await ui.find({ key: "buddy-feedback-note" })).toBeUndefined();
    expect(await ui.find({ key: "buddy-feedback-save" })).toBeUndefined();
    expect(await ui.find({ key: "buddy-feedback-cancel" })).toBeUndefined();
    expect(await ui.find({ key: "dismiss:scope" })).toBeUndefined();
    await ui.press({ key: "buddy-update" });
    expect(prompts[1].flagFeedback).toEqual([{ rating: "good", note: "", flag: first }]);
    expect(prompts[1].dismissed).toEqual([first]);
    expect(await ui.find({ key: "dismiss:scope" })).toBeUndefined();
    flag = second;
    await ui.press({ key: "buddy-update" });
    await ui.press({ key: "bad:api" });
    expect(prompts.length).toBe(3);
    expect(await ui.find({ key: "dismiss:api" })).toBeUndefined();
    await ui.press({ key: "buddy-update" });
    expect(prompts[3].flagFeedback).toEqual([
      { rating: "good", note: "", flag: first },
      { rating: "bad", note: "", flag: second },
    ]);
    expect(prompts[3].dismissed).toEqual([first, second]);
    expect(await ui.find({ key: "dismiss:api" })).toBeUndefined();
    await ui.press({ key: "buddy-settings" });
    await ui.press({ key: "buddy-saved-feedback" });
    expect(await ui.find({ type: "Text", text: "Saved feedback (2)" })).toBeDefined();
    await ui.unmount();
  });

  test("saved feedback is loaded in another session and a quick rating preserves its note", async ($, on) => {
    const flag = { key: "scope", kind: "attention", text: "The gateway change is outside scope.", evidence: "I also changed the gateway" };
    host(on, {}, [], [], {}, { flagFeedback: [null, { rating: "bad", note: "I asked for this scope.", flag, at: 123 }] });
    on("session.messages", () => ({ value: [message("assistant", flag.evidence)] }));
    const prompts: any[] = [];
    on("model.fork", ($, e) => { prompts.push(payload(e.prompt)); return { value: digest(null, [flag]) }; });
    const ui = await $.ui.mount(PANE);
    await ui.press({ key: "buddy-update" });
    expect(prompts[0].flagFeedback).toEqual([{ rating: "bad", note: "I asked for this scope.", flag }]);
    expect((await ui.find({ key: "bad:scope" }))?.text).toBe("✓ Bad");
    await ui.press({ key: "good:scope" });
    expect(await ui.find({ key: "dismiss:scope" })).toBeUndefined();
    await ui.press({ key: "buddy-update" });
    expect(prompts[1].flagFeedback).toEqual([{ rating: "good", note: "I asked for this scope.", flag }]);
    await ui.unmount();
  });

  test("a failed quick rating keeps the flag available and retries on Good", async ($, on) => {
    host(on, {}, [], [], {}, false);
    const saved: any = { settings: { version: 3, mode: "companion", model: "main" } };
    let fail = true;
    on("store.get", ($, e) => ({ value: saved[e.key] }));
    on("store.set", ($, e) => {
      if (e.key === "flagFeedback" && fail) throw new Error("Disk unavailable");
      saved[e.key] = e.value; return { value: undefined };
    });
    const flag = { key: "scope", kind: "attention", text: "The gateway change is outside scope.", evidence: "I also changed the gateway" };
    on("session.messages", () => ({ value: [message("assistant", flag.evidence)] }));
    on("model.fork", () => ({ value: digest(null, [flag]) }));
    const ui = await $.ui.mount(PANE);
    await ui.press({ key: "buddy-update" });
    await ui.press({ key: "good:scope" });
    expect(await ui.find({ type: "Text", text: /Could not save feedback/ })).toBeDefined();
    expect((await ui.find({ key: "good:scope" }))?.text).toBe("Good");
    expect(saved.flagFeedback).toBeUndefined();
    fail = false;
    await ui.press({ key: "good:scope" });
    expect(saved.flagFeedback[0].rating).toBe("good");
    expect(saved.flagFeedback[0].note).toBe("");
    expect(await ui.find({ key: "dismiss:scope" })).toBeUndefined();
    expect(await ui.find({ type: "Text", text: /Could not save feedback/ })).toBeUndefined();
    await ui.unmount();
  });

  test("saved activity-off keeps flags and chat working, discards summaries, and can be switched back on", async ($, on) => {
    const clock = host(on, { activityLog: false, cadence: "120" });
    const progress = "The schema migration is complete and its tests passed.";
    const flag = { key: "scope", kind: "attention", text: "The gateway is outside the requested scope.", evidence: "I also changed the gateway" };
    on("session.messages", () => ({ value: [message("assistant", `${progress} ${flag.evidence}`)] }));
    const prompts: any[] = [];
    on("model.fork", ($, e) => {
      if (!e.prompt.includes("Return only JSON")) return { value: reply("SIDE_CHAT_STILL_WORKS") };
      prompts.push(payload(e.prompt));
      return { value: digest(progress, [flag], [], milestone("migration", progress)) };
    });
    const ui = await $.ui.mount(PANE);
    await $.turn.start({ turnId: "migration", text: "Migrate" });
    await clock.advance(60000);
    expect((await ui.find({ key: "buddy-update" }))?.text).toBe("check flags");
    await ui.press({ key: "buddy-update" });
    expect(prompts[0].activityLogEnabled).toBe(false);
    expect(prompts[0].logContext.eligible).toBe(false);
    expect(await ui.find({ key: "dismiss:scope" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /^(Now|Log)$/ })).toBeUndefined();
    expect(await ui.find({ type: "Markdown", text: progress })).toBeUndefined();
    await $.command.run({ command: "buddy", args: "Explain the scope" });
    expect(await ui.find({ type: "Markdown", text: "SIDE_CHAT_STILL_WORKS" })).toBeDefined();
    await ui.press({ key: "buddy-settings" });
    expect((await ui.find({ key: "buddy-activity-log-false" }))?.text).toBe("✓ Off");
    await ui.press({ key: "buddy-activity-log-true" });
    await ui.press({ key: "buddy-page-information" });
    expect(await ui.find({ type: "Text", text: "Now" })).toBeDefined();
    await expectLogCount(ui, 0);
    await ui.press({ key: "buddy-update" });
    expect(prompts[1].activityLogEnabled).toBe(true);
    await expectLogCount(ui, 1);
    await ui.unmount();
  });

  test("switching activity off and on preserves history but cannot restore an in-flight activity update", async ($, on) => {
    const clock = host(on, { cadence: "120" });
    const first = "The schema migration is complete.";
    const stale = "The second migration has finished.";
    const flag = { key: "scope", kind: "attention", text: "The gateway is outside scope.", evidence: "I also changed the gateway" };
    on("session.messages", () => ({ value: [message("assistant", `${first} ${stale} ${flag.evidence}`)] }));
    let release: (value: any) => void = () => {};
    let entered: () => void = () => {};
    const started = new Promise<void>(resolve => { entered = resolve; });
    const waiting = new Promise(resolve => { release = resolve; });
    let calls = 0;
    on("model.fork", async () => {
      if (++calls === 1) return { value: digest(first, [], [], milestone("first", first)) };
      entered(); return { value: await waiting as any };
    });
    const ui = await $.ui.mount(PANE);
    await $.turn.start({ turnId: "migration", text: "Migrate" });
    await clock.advance(60000);
    await ui.press({ key: "buddy-update" });
    const work = $.command.run({ command: "buddy", args: "update" });
    await started;
    await ui.press({ key: "buddy-settings" });
    await ui.press({ key: "buddy-activity-log-false" });
    await ui.press({ key: "buddy-page-information" });
    expect(await ui.find({ type: "Text", text: /^(Now|Log)$/ })).toBeUndefined();
    await ui.press({ key: "buddy-settings" });
    await ui.press({ key: "buddy-activity-log-true" });
    await ui.press({ key: "buddy-page-information" });
    release(digest(stale, [flag], [], milestone("stale", stale)));
    await work;
    expect(await ui.find({ key: "dismiss:scope" })).toBeDefined();
    expect(await ui.find({ type: "Markdown", text: stale })).toBeUndefined();
    await expectLogCount(ui, 1);
    expect(await ui.find({ type: "Markdown", text: first })).toBeDefined();
    await ui.unmount();
  });

  test("a long turn finishing after reload can log its result even when its start was not observed", async ($, on) => {
    const clock = host(on);
    const result = "The schema upgrade is complete and all migration tests passed.";
    on("session.messages", () => ({ value: [message("user", "Upgrade the schema"), message("assistant", result)] }));
    on("model.fork", () => ({ value: digest(null, [], [], milestone("upgrade-complete", result)) }));
    const ui = await $.ui.mount(PANE);
    await $.turn.complete({ turnId: "already-running", answer: result, durationMs: 180000, isAborted: false, reason: "answer" });
    await clock.advance(1000);
    await expectLogCount(ui, 1);
    await ui.press({ key: "buddy-page-log" });
    expect(await ui.find({ type: "Markdown", text: result })).toBeDefined();
    await ui.unmount();
  });

  test("short lookups never enter the log, even after waiting or explicitly updating; flags still work", async ($, on) => {
    const clock = host(on);
    const status = "Claude confirmed todo/todo.md exists and is waiting for you to say what to do with it.\n- 2,772 lines; first item: red prod-lane clippy in matching";
    const flag = { key: "scope", kind: "attention", text: "The command would also delete the archive.", evidence: "The command also deletes the archive" };
    on("session.messages", () => ({ value: [message("user", "Does todo.md exist?"), message("assistant", `${status}. ${flag.evidence}`)] }));
    on("model.fork", () => ({ value: digest(status, [flag], [], milestone("file-found", status, "2,772 lines")) }));
    const ui = await $.ui.mount(PANE);
    await $.turn.start({ turnId: "lookup", text: "Does todo.md exist?" });
    await $.turn.complete({ turnId: "lookup", answer: "Yes", durationMs: 2000, isAborted: false, reason: "answer" });
    await clock.advance(1000);
    expect(await ui.find({ key: "dismiss:scope" })).toBeDefined();
    await expectLogCount(ui, 0);
    await clock.advance(120000);
    await ui.press({ key: "buddy-update" });
    await expectLogCount(ui, 0);
    await ui.unmount();
  });

  test("long turns log only explicit new supported developments, not each changed status", async ($, on) => {
    const clock = host(on, { cadence: "120" });
    const routine = "Claude is pulling every heading and priority tag from todo.md to answer your request; no reply written yet.\n- Roughly 75 items in seven sections, four P1";
    const discovery = "Production uses schema v1, but the migration requires schema v3.";
    const completion = "Added the schema upgrade and all migration tests passed.";
    let messages = [message("user", "Fix the migration"), message("assistant", routine)];
    on("session.messages", () => ({ value: messages }));
    const prompts: any[] = [];
    const replies = [
      digest(routine),
      digest("Still checking headings"),
      digest("The migration needs an upgrade first", [], [], milestone("schema-mismatch", discovery)),
      digest("Inspecting the remaining files"),
      digest(null, [], [], milestone("reworded-key", "The production schema is too old for this migration.", discovery)),
      digest(null, [], [], milestone("unsupported", "All deployed", "Deployment succeeded")),
      digest(null, [], [], milestone("upgrade-tested", completion)),
    ];
    on("model.fork", ($, e) => { prompts.push(payload(e.prompt)); return { value: replies.shift()! }; });
    const ui = await $.ui.mount(PANE);
    await $.turn.start({ turnId: "migration", text: "Fix the migration" });
    await clock.advance(30000);
    await ui.press({ key: "buddy-update" });
    expect(prompts[0].logContext.eligible).toBe(false);
    await clock.advance(30000);
    await ui.press({ key: "buddy-update" });
    expect(prompts[1].logContext.eligible).toBe(true);
    await expectLogCount(ui, 0);
    messages = [...messages, message("assistant", discovery)];
    await ui.press({ key: "buddy-update" });
    await expectLogCount(ui, 1);
    await ui.press({ key: "buddy-update" });
    expect(prompts[3].recentLog[0].text).toBe(discovery);
    await ui.press({ key: "buddy-update" });
    await ui.press({ key: "buddy-update" });
    await expectLogCount(ui, 1);
    expect(await ui.find({ type: "Text", text: /could not verify/ })).toBeUndefined();
    messages = [...messages, message("assistant", completion)];
    await $.turn.complete({ turnId: "migration", answer: completion, durationMs: 90000, isAborted: false, reason: "answer" });
    await clock.advance(1000);
    await expectLogCount(ui, 2);
    await ui.press({ key: "buddy-page-log" });
    expect((await ui.findAll({ type: "Markdown" })).map(item => item.text)).toEqual([completion, discovery]);
    await ui.unmount();
  });

  test("old-turn facts cannot be logged as current progress and subagent starts do not reset the main timer", async ($, on) => {
    const clock = host(on, { cadence: "120" });
    const old = "The first feature is complete.";
    const fresh = "The second feature passed all its tests.";
    on("session.messages", () => ({ value: [message("user", "First task"), message("assistant", old), message("user", "Second task"), message("assistant", fresh)] }));
    const prompts: any[] = [];
    const replies = [digest(null, [], [], milestone("old", old)), digest(null, [], [], milestone("fresh", fresh))];
    on("model.fork", ($, e) => { prompts.push(payload(e.prompt)); return { value: replies.shift()! }; });
    const ui = await $.ui.mount(PANE);
    await $.turn.start({ turnId: "main", text: "Second task" });
    await clock.advance(60000);
    await $.turn.start({ turnId: "child", agentId: "subagent", text: "Help" });
    await ui.press({ key: "buddy-update" });
    expect(prompts[0].logContext.eligible).toBe(true);
    expect(JSON.stringify(prompts[0].currentTurnConversation)).not.toContain(old);
    await expectLogCount(ui, 0);
    await ui.press({ key: "buddy-update" });
    await expectLogCount(ui, 1);
    await ui.unmount();
  });

  test("empty sessions make no review requests or idle log entries", async ($, on) => {
    const clock = host(on);
    on("session.messages", () => ({ value: [] }));
    let calls = 0;
    on("model.fork", () => { calls++; return { value: digest("No session activity yet") }; });
    const ui = await $.ui.mount(PANE);
    await $.turn.start({ turnId: "empty", text: "" });
    await clock.advance(30000);
    await ui.press({ key: "buddy-update" });
    expect(calls).toBe(0);
    await expectLogCount(ui, 0);
    expect(await ui.find({ type: "Text", text: /could not verify/ })).toBeUndefined();
    await ui.unmount();
  });

  test("automatic intervals skip an unchanged transcript but actual work and explicit Update now are reviewed", async ($, on) => {
    const clock = host(on);
    let messages = [message("assistant", "Work started")];
    on("session.messages", () => ({ value: messages }));
    let calls = 0;
    on("model.fork", () => { calls++; return { value: digest("Work started") }; });
    const ui = await $.ui.mount(PANE);
    await $.turn.start({ turnId: "first", text: "Work" });
    await clock.advance(30000);
    expect(calls).toBe(1);
    await $.turn.start({ turnId: "duplicate-event", text: "Work" });
    await clock.advance(30000);
    expect(calls).toBe(1);
    messages = [...messages, message("assistant", "The check passed")];
    await $.turn.start({ turnId: "new-work", text: "Continue" });
    await clock.advance(30000);
    expect(calls).toBe(2);
    await ui.press({ key: "buddy-update" });
    expect(calls).toBe(3);
    await ui.unmount();
  });

  test("idle and no-change summaries leave the real log intact while supported flags still update", async ($, on) => {
    const clock = host(on, { cadence: "120" });
    const flag = { key: "scope", kind: "attention", text: "Review the gateway scope.", evidence: "I also changed the gateway" };
    on("session.messages", () => ({ value: [message("assistant", `${flag.evidence}. The gateway change was reverted. Implemented the requested change. Claude has not started the tests; implementation is complete.`)] }));
    const responses = [
      digest("Implemented the requested change", [], [], milestone("implemented", "Implemented the requested change")),
      digest("No session activity yet; Claude has not started any work in this conversation.", [flag]),
      digest(null, [], [{ key: "scope", evidence: "The gateway change was reverted" }]),
      digest("Claude has not started the tests; implementation is complete.", [], [], milestone("testing", "Claude has not started the tests; implementation is complete.")),
    ];
    on("model.fork", () => ({ value: responses.shift()! }));
    const ui = await $.ui.mount(PANE);
    await $.turn.start({ turnId: "implementation", text: "Implement the change" });
    await clock.advance(60000);
    await ui.press({ key: "buddy-update" });
    await ui.press({ key: "buddy-update" });
    expect(await ui.find({ type: "Markdown", text: /No session activity/ })).toBeUndefined();
    await expectLogCount(ui, 1);
    expect(await ui.find({ key: "dismiss:scope" })).toBeDefined();
    await ui.press({ key: "buddy-update" });
    expect(await ui.find({ key: "dismiss:scope" })).toBeUndefined();
    await expectLogCount(ui, 1);
    expect(await ui.find({ type: "Text", text: /could not verify/ })).toBeUndefined();
    await ui.press({ key: "buddy-update" });
    await expectLogCount(ui, 2);
    expect(await ui.find({ type: "Markdown", text: /implementation is complete/ })).toBeDefined();
    await ui.unmount();
  });

  test("a narrow terminal pauses the pane and reviews, then widening resumes with chat and flags intact", async ($, on) => {
    const opened: string[] = [], closed: string[] = [];
    const clock = host(on, {}, [], [], { opened, closed });
    on("ui.render", { component: "PromptHint" }, ($, e) => $.ui.resolve(e).Text({ children: "Main prompt" }));
    const resize = (columns: number, isFullscreen = true) => $.ui.render({ surface: "terminal", component: "PromptHint", requestId: "main-prompt",
      viewport: { columns, rows: 50, isFullscreen }, props: { hint: "Main prompt", isDraft: false, isWorking: false } } as any);
    const flag = { key: "scope", kind: "attention", text: "Check the gateway scope.", evidence: "I also changed the gateway" };
    let messages = [message("assistant", flag.evidence)];
    on("session.messages", () => ({ value: messages }));
    let calls = 0;
    on("model.fork", ($, e) => { calls++; return { value: e.prompt.includes("Return only JSON") ? digest("Progress", [flag]) : reply("Saved answer") }; });
    const ui = await $.ui.mount(PANE);
    await resize(160);
    await $.ui.render({ surface: "terminal", component: "Pane", requestId: "claude-buddy",
      viewport: { columns: 105, rows: 45, isFullscreen: true }, props: PANE.props });
    await clock.advance(0);
    expect(closed).toEqual([]);
    await ui.input({ key: "buddy-question", text: "Remember this question" });
    await $.command.run({ command: "buddy", args: "update" });
    await resize(100);
    await $.ui.render({ surface: "terminal", component: "Pane", requestId: "claude-buddy",
      viewport: { columns: 100, rows: 50, isFullscreen: true }, props: { ...PANE.props, placement: "inline" } });
    await clock.advance(0);
    expect(closed).toEqual(["claude-buddy"]);
    const pausedCalls = calls;
    expect((await $.command.run({ command: "buddy", args: "update" })).text).toContain("paused");
    messages = [...messages, message("assistant", "New work while the pane was paused")];
    await $.turn.start({ turnId: "paused-work", text: "Work continues" });
    await clock.advance(60000);
    expect(calls).toBe(pausedCalls);
    await resize(160);
    await clock.advance(1000);
    expect(opened.length).toBeGreaterThan(0);
    expect(calls).toBe(pausedCalls + 1);
    expect(await ui.find({ key: "dismiss:scope" })).toBeDefined();
    await ui.press({ key: "buddy-page-chat" });
    expect(await ui.find({ type: "Markdown", text: "Saved answer" })).toBeDefined();
    await ui.unmount();
  });

  test("inline placement closes Buddy and a manual off survives widening", async ($, on) => {
    const opened: string[] = [], closed: string[] = [];
    const clock = host(on, {}, [], [], { opened, closed });
    let calls = 0;
    on("model.fork", () => { calls++; return { value: digest() }; });
    const ui = await $.ui.mount({ ...PANE, viewport: { columns: 100, rows: 50, isFullscreen: true }, props: { ...PANE.props, placement: "inline" } });
    await clock.advance(0);
    expect(closed.length).toBe(1);
    expect(await ui.find({ key: "buddy-question" })).toBeUndefined();
    await $.command.run({ command: "buddy", args: "off" });
    await ui.unmount();
    const wide = await $.ui.mount({ ...PANE, viewport: { columns: 160, rows: 50, isFullscreen: true } });
    await clock.advance(60000);
    expect(opened.length).toBe(0);
    expect(calls).toBe(0);
    await wide.unmount();
  });

  test("ordinary activity is batched for 30 seconds, uses the newest context, and idle time makes no requests", async ($, on) => {
    const clock = host(on);
    let messages = [message("assistant", "FIRST")];
    on("session.messages", () => ({ value: messages }));
    const prompts: string[] = [];
    on("model.fork", ($, e) => { prompts.push(e.prompt); return { value: digest() }; });
    const ui = await $.ui.mount(PANE);
    await $.turn.start({ turnId: "first", text: "FIRST" });
    await clock.advance(20000);
    messages = [...messages, message("assistant", "LATEST")];
    await $.turn.start({ turnId: "latest", text: "LATEST" });
    await clock.advance(9999);
    expect(prompts.length).toBe(0);
    await clock.advance(1);
    expect(prompts.length).toBe(1);
    expect(prompts[0]).toContain("LATEST");
    expect((await ui.find({ type: "Markdown", text: "Claude is checking the change." }))?.text).toBe("Claude is checking the change.");
    await clock.advance(120000);
    expect(prompts.length).toBe(1);
    await ui.unmount();
  });

  test("a failed turn is reviewed promptly but is never a flag by itself; a model observation stays open until new evidence resolves it", async ($, on) => {
    const clock = host(on);
    let messages = [message("assistant", "Tests failed in gateway and I will stop here")];
    on("session.messages", () => ({ value: messages }));
    let count = 0;
    const stuck = { key: "stuck", kind: "attention", text: "Claude stopped after the gateway tests failed.", evidence: "I will stop here" };
    on("model.fork", () => ({ value: ++count === 1 ? digest("Checking the failure", [stuck]) : digest("Tests now pass", [], [{ key: "stuck", evidence: "All gateway tests passed" }]) }));
    const ui = await $.ui.mount(PANE);
    await $.turn.start({ turnId: "bad-test", text: "Run tests" });
    await $.turn.complete({ turnId: "bad-test", answer: "", durationMs: 100, isAborted: false, reason: "error" });
    expect(await ui.find({ type: "Text", text: /Main turn ended/ })).toBeUndefined();
    expect(await ui.find({ key: "buddy-nudge" })).toBeUndefined();
    expect(count).toBe(0);
    await clock.advance(1000);
    expect(count).toBe(1);
    expect((await ui.find({ key: "buddy-page-information" }))?.text).toContain("1");
    await ui.press({ key: "buddy-page-information" });
    expect(await ui.find({ key: "dismiss:stuck" })).toBeDefined();
    messages = [...messages, message("assistant", "All gateway tests passed")];
    await $.turn.start({ turnId: "passing", text: "All gateway tests passed" });
    await clock.advance(30000);
    expect(await ui.find({ key: "dismiss:stuck" })).toBeUndefined();
    await ui.unmount();
  });

  test("ungrounded warnings are rejected and previous observations are preserved", async ($, on) => {
    host(on);
    on("session.messages", () => ({ value: [message("assistant", "Files were updated")] }));
    let count = 0;
    on("model.fork", () => ({ value: ++count === 1 ? digest("Files changed") : digest("Invented update", [{ key: "fake", kind: "attention", text: "Production broke", evidence: "OUTAGE THAT NEVER HAPPENED" }]) }));
    const ui = await $.ui.mount(PANE);
    await ui.press({ key: "buddy-update" });
    await ui.press({ key: "buddy-update" });
    expect(await ui.find({ type: "Markdown", text: "Files changed" })).toBeDefined();
    expect(await ui.find({ key: "dismiss:fake" })).toBeUndefined();
    expect((await ui.find({ type: "Text", text: /could not verify/ }))?.text).toContain("Previous observations remain");
    await ui.unmount();
  });

  test("an API failure names the error kind and hints at the cause", async ($, on) => {
    host(on, { model: "claude-opus-5-5" });
    on("prompt.compose", () => ({ sections: [] }));
    on("session.messages", () => ({ value: [message("assistant", "MAIN")] }));
    let failure: any = { isAnswered: false, reason: "api-error", status: 400, error: "invalid_request", usage };
    on("model.complete", () => ({ value: failure }));
    const ui = await $.ui.mount(PANE);
    await ui.press({ key: "buddy-update" });
    expect((await ui.find({ type: "Text", text: /HTTP 400, invalid_request/ }))?.text).toContain("Follow Claude");
    failure = { isAnswered: false, reason: "api-error", status: 529, error: "overloaded", usage };
    await ui.press({ key: "buddy-update" });
    expect((await ui.find({ type: "Text", text: /HTTP 529, overloaded/ }))?.text).toContain("Try again shortly");
    await ui.unmount();
  });

  for (const model of ["main", "claude-custom"]) {
    test(`dismissed concerns stay hidden across changed keys, wording and kinds with ${model}`, async ($, on) => {
      host(on, { model });
      on("prompt.compose", () => ({ sections: [] }));
      const flag = { key: "gateway-scope", kind: "attention", text: "Scope grew to the gateway without being asked.", evidence: "I also rewrote the gateway" };
      const repeats = [
        { key: "GATEWAY_scope", kind: "decision", text: "Decide whether to keep the expanded scope.", evidence: "The gateway is now included" },
        { key: "extra-work", kind: "uncertain", text: "SCOPE grew to the gateway\nwithout being asked!", evidence: "The gateway is now included" },
        { key: "unrequested-rewrite", kind: "insight", text: "The gateway rewrite adds work beyond the request.", evidence: "I ALSO rewrote the gateway." },
      ];
      const different = { key: "unverified-tests", kind: "attention", text: "The success claim has no test results.", evidence: "I skipped the tests but everything works" };
      on("session.messages", () => ({ value: [message("assistant", [flag, ...repeats, different].map(item => item.evidence).join("\n"))] }));
      const prompts: string[] = [];
      const responses = [flag, ...repeats, different];
      const respond = ($: any, e: any) => {
        prompts.push(e.prompt);
        return { value: digest("Reviewing the work", [responses[prompts.length - 1]]) };
      };
      on("model.fork", respond);
      on("model.complete", respond);
      const ui = await $.ui.mount(PANE);
      await ui.press({ key: "buddy-update" });
      await ui.press({ key: "buddy-page-information" });
      await ui.press({ key: "dismiss:gateway-scope" });
      // Resetting only the side chat must not forget an acknowledged concern.
      await $.command.run({ command: "buddy", args: "reset" });
      for (let i = 0; i < repeats.length; i++) {
        await $.command.run({ command: "buddy", args: "update" });
        expect(payload(prompts[i + 1]).dismissed).toEqual([flag]);
        await ui.press({ key: "buddy-page-information" });
        expect((await ui.find({ type: "Text", text: /Nothing needs/ }))?.text).toContain("attention");
      }
      await $.command.run({ command: "buddy", args: "update" });
      await ui.press({ key: "buddy-page-information" });
      expect(await ui.find({ key: "dismiss:unverified-tests" })).toBeDefined();
      await ui.unmount();
    });
  }

  test("a dismissal during a review defers its flags until a fresh review sees the dismissed concern", async ($, on) => {
    const clock = host(on);
    const flag = { key: "scope", kind: "attention", text: "The gateway rewrite is outside the requested scope.", evidence: "I also rewrote the gateway" };
    const repeat = { key: "extra-work", kind: "decision", text: "Do you want to keep the unrequested gateway changes?", evidence: "The gateway is now included" };
    const different = { key: "tests", kind: "attention", text: "The success claim has no test results.", evidence: "I skipped the tests but everything works" };
    on("session.messages", () => ({ value: [message("assistant", [flag, repeat, different].map(item => item.evidence).join("\n"))] }));
    let release: (value: any) => void = () => {};
    let entered: () => void = () => {};
    const started = new Promise<void>(resolve => { entered = resolve; });
    const waiting = new Promise(resolve => { release = resolve; });
    const prompts: string[] = [];
    on("model.fork", async ($, e) => {
      prompts.push(e.prompt);
      if (prompts.length === 2) { entered(); return { value: await waiting as any }; }
      return { value: digest("Fresh progress", [prompts.length === 1 ? flag : different]) };
    });
    const ui = await $.ui.mount(PANE);
    await ui.press({ key: "buddy-update" });
    const work = $.command.run({ command: "buddy", args: "update" });
    await started;
    expect(payload(prompts[1]).dismissed).toEqual([]);
    await ui.press({ key: "buddy-page-information" });
    await ui.press({ key: "dismiss:scope" });
    release(digest("Progress during dismissal", [repeat]));
    await work;
    expect((await ui.find({ type: "Text", text: /Nothing needs/ }))?.text).toContain("attention");
    await ui.press({ key: "buddy-page-information" });
    expect(await ui.find({ type: "Markdown", text: "Progress during dismissal" })).toBeDefined();
    await clock.advance(30000);
    expect(prompts.length).toBe(3);
    expect(payload(prompts[2]).dismissed).toEqual([flag]);
    await ui.press({ key: "buddy-page-information" });
    expect(await ui.find({ key: "dismiss:tests" })).toBeDefined();
    expect(await ui.find({ key: "buddy-flag-go:extra-work" })).toBeUndefined();
    await ui.unmount();
  });

  test("I know this is saved, sent on later checks, and suppresses the same insight", async ($, on) => {
    host(on);
    on("session.messages", () => ({ value: [message("assistant", "One-off requests pay a cache write cost")] }));
    const flag = { key: "cache-cost", kind: "insight", text: "One-off requests can cost more with caching.", evidence: "One-off requests pay a cache write cost" };
    const prompts: string[] = [];
    on("model.fork", ($, e) => { prompts.push(e.prompt); return { value: digest("Caching changed", [flag]) }; });
    const ui = await $.ui.mount(PANE);
    await ui.press({ key: "buddy-update" });
    await ui.press({ key: "buddy-page-information" });
    await ui.press({ key: "known:cache-cost" });
    await ui.press({ key: "buddy-page-information" });
    await ui.press({ key: "buddy-update" });
    expect(payload(prompts[1]).knownTopics).toContain(flag.text);
    expect(payload(prompts[1]).dismissed).toEqual([flag]);
    await ui.press({ key: "buddy-page-information" });
    expect(await ui.find({ key: "known:cache-cost" })).toBeUndefined();
    expect((await ui.find({ type: "Text", text: /Nothing needs/ }))?.text).toContain("attention");
    await ui.unmount();
  });

  test("switching off invalidates an in-flight update, stops timers and restores native btw", async ($, on) => {
    const clock = host(on);
    on("session.messages", () => ({ value: [message("assistant", "Main")] }));
    let release: (value: any) => void = () => {};
    let entered: () => void = () => {};
    const started = new Promise<void>(resolve => { entered = resolve; });
    const waiting = new Promise(resolve => { release = resolve; });
    let count = 0;
    on("model.fork", async () => { count++; entered(); return { value: await waiting as any }; });
    on("command.run", () => ({ text: "NATIVE BTW" }));
    const ui = await $.ui.mount(PANE);
    const work = $.command.run({ command: "buddy", args: "update" });
    await started;
    await $.command.run({ command: "claude-buddy", args: "off" });
    release(digest("STALE_SUMMARY"));
    await work;
    await $.turn.start({ turnId: "off", text: "More work while off" });
    await clock.advance(60000);
    expect(count).toBe(1);
    expect(await ui.find({ type: "Markdown", text: "STALE_SUMMARY" })).toBeUndefined();
    expect((await $.command.run({ command: "btw", args: "Question" })).text).toBe("NATIVE BTW");
    await ui.unmount();
  });

  test("chat keeps follow-ups and refreshes context without writing the main conversation", async ($, on) => {
    host(on);
    let messages = [message("assistant", "MAIN_ONE")];
    on("session.messages", () => ({ value: messages }));
    on("prompt.submit", () => { throw new Error("Buddy submitted a main task"); });
    const prompts: string[] = [];
    on("model.fork", ($, e) => { prompts.push(e.prompt); return { value: reply("SIDE_ANSWER") }; });
    const ui = await $.ui.mount(PANE);
    await ui.input({ key: "buddy-question", text: "FIRST_QUESTION" });
    messages = [message("assistant", "MAIN_TWO")];
    await ui.input({ key: "buddy-question", text: "Follow up" });
    expect(prompts[1]).toContain("MAIN_TWO");
    expect(payload(prompts[1]).sideConversation).toEqual([{ role: "user", text: "FIRST_QUESTION" }, { role: "assistant", text: "SIDE_ANSWER" }]);
    await ui.press({ key: "buddy-reset" });
    await ui.input({ key: "buddy-question", text: "New question" });
    expect(payload(prompts[2]).sideConversation).toEqual([]);
    await ui.unmount();
  });

  test("inline model and settings buttons apply to requests with the full available text and instructions", async ($, on) => {
    host(on);
    on("session.messages", () => ({ value: [message("user", "EARLY_CONTEXT"), message("assistant", "LATEST_CONTEXT")] }));
    on("prompt.compose", () => ({ sections: [{ id: "system", scope: "shared", text: "MAIN_SYSTEM_INSTRUCTIONS" }] }));
    let request: any;
    on("model.complete", ($, e) => { request = e; return { value: reply("CUSTOM_ANSWER") }; });
    const ui = await $.ui.mount(PANE);
    await ui.press({ key: "buddy-settings" });
    expect((await ui.find({ type: "Text", text: /Selected model/ }))?.text).toContain("claude-main-model");
    await ui.press({ key: "buddy-model-claude-opus-5-5" });
    await ui.press({ key: "buddy-effort-high" });
    await ui.press({ key: "buddy-cadence-60" });
    await ui.press({ key: "buddy-style-detailed" });
    expect(await ui.find({ type: "Select" })).toBeUndefined();
    expect((await ui.find({ key: "buddy-effort-high" }))?.text).toBe("✓ high");
    expect((await ui.find({ key: "buddy-cadence-60" }))?.text).toBe("✓ 60 sec");
    expect((await ui.find({ key: "buddy-style-detailed" }))?.text).toBe("✓ detailed");
    await ui.press({ key: "buddy-done" });
    await ui.input({ key: "buddy-question", text: "Question" });
    expect(request.model).toBe("claude-opus-5-5");
    expect(request.effort).toBe("high");
    expect(request.prompt).toContain("at most fourteen short lines");
    expect(request.system).toContain("MAIN_SYSTEM_INSTRUCTIONS");
    expect(request.prompt).toContain("EARLY_CONTEXT");
    expect(request.prompt).toContain("LATEST_CONTEXT");
    await ui.press({ key: "buddy-settings" });
    expect((await ui.find({ key: "buddy-model-claude-opus-5-5" }))?.text).toBe("✓ Opus 5.5");
    await ui.unmount();
  });

  test("final turns update promptly, while subagent events cannot create a summary loop", async ($, on) => {
    const clock = host(on);
    on("session.messages", () => ({ value: [message("assistant", "Final response")] }));
    let count = 0;
    on("model.fork", () => { count++; return { value: digest() }; });
    const ui = await $.ui.mount(PANE);
    await $.turn.start({ turnId: "main", text: "Task" });
    await $.turn.complete({ turnId: "main", answer: "Done", durationMs: 500, isAborted: false, reason: "answer" });
    await clock.advance(1000);
    expect(count).toBe(1);
    await $.turn.complete({ turnId: "child", agentId: "subagent", answer: "Done", durationMs: 200, isAborted: false, reason: "answer" });
    await clock.advance(60000);
    expect(count).toBe(1);
    await ui.unmount();
  });

  test("headless sessions do not make background model calls", async ($, on) => {
    const clock = host(on);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.surfaces", () => ({ value: [] }));
    on("command.register", () => ({ value: undefined }));
    let count = 0;
    on("model.fork", () => { count++; return { value: digest() }; });
    await $.session.start({ cwd: "/fixture", surface: null, isInteractive: false });
    await $.turn.start({ turnId: "headless", text: "Task" });
    await clock.advance(60000);
    expect(count).toBe(0);
  });

  test("inline models choose the latest family versions and honor their supported effort choices", async ($, on) => {
    host(on, { effort: "high" }, [{ name: "current-cc.json", kind: "file", mtimeMs: 5, size: 500, isLink: false }]);
    on("fs.read", () => ({ value: JSON.stringify({ catalog: { surface: "cc", config: { models: [
      { id: "claude-fable-5", name: "Fable 5", thinking: { type: "effort" } },
      { id: "claude-fable-5-1", name: "Fable 5.1", thinking: { type: "none" } },
      { id: "claude-sonnet-5-5", name: "Sonnet 5.5", thinking: { type: "effort", effort_options: [{ id: "low" }, { id: "high" }] } },
      { id: "claude-sonnet-5", name: "Sonnet 5", thinking: { type: "effort" } },
      { id: "claude-opus-5-9", name: "Opus 5.9", thinking: { type: "effort" } },
      { id: "claude-opus-5-10", name: "Opus 5.10", thinking: { type: "effort" } },
      { id: "claude-haiku-4-5", name: "Haiku 4.5", thinking: { type: "none" } },
    ] } } }) }));
    const ui = await $.ui.mount(PANE);
    await ui.press({ key: "buddy-settings" });
    const models = (await ui.findAll({ type: "Button" })).filter(item => item.key?.startsWith("buddy-model-"));
    expect(models.map(item => item.text)).toEqual(["Fable 5.1", "Sonnet 5.5", "Opus 5.10"]);
    expect(await ui.find({ key: "buddy-models" })).toBeUndefined();
    await ui.press({ key: "buddy-model-claude-fable-5-1" });
    expect(await ui.find({ key: "buddy-effort" })).toBeUndefined();
    expect((await ui.find({ type: "Text", text: /does not offer an effort/ }))?.text).toContain("does not offer");
    await ui.press({ key: "buddy-model-claude-sonnet-5-5" });
    expect(await ui.find({ key: "buddy-effort-low" })).toBeDefined();
    expect(await ui.find({ key: "buddy-effort-high" })).toBeDefined();
    expect(await ui.find({ key: "buddy-effort-max" })).toBeUndefined();
    expect((await ui.find({ key: "buddy-effort-default" }))?.text).toBe("✓ default");
    await ui.unmount();
  });

  test("session mechanics never become flags or toasts: measure, compaction, failed turns and tool errors only mark activity", async ($, on) => {
    const toasts: boolean[] = [];
    const clock = host(on, {}, [], toasts);
    on("session.measure", ($, e) => ({ changed: e.changed }));
    on("session.compact", ($, e) => ({ messages: e.messages }));
    on("session.messages", () => ({ value: [message("assistant", "Working")] }));
    let count = 0;
    on("model.fork", () => { count++; return { value: digest("Still working") }; });
    const ui = await $.ui.mount(PANE);
    await $.session.measure({ context: { tokens: 950, window: 1000, percent: 95 }, rateLimits: [{ percentUsed: 100 }], changed: ["context", "rateLimits"] } as any);
    await $.session.compact({ trigger: "auto", messages: [message("user", "Summary of earlier work")] } as any);
    await $.turn.start({ turnId: "main", text: "Task" });
    await $.turn.complete({ turnId: "main", answer: "", durationMs: 100, isAborted: false, reason: "error" });
    await clock.advance(1000);
    expect(count).toBe(1);
    expect(toasts.length).toBe(0);
    expect(await ui.find({ key: "buddy-nudge" })).toBeUndefined();
    await ui.press({ key: "buddy-page-information" });
    expect((await ui.find({ type: "Text", text: /Nothing needs/ }))?.text).toContain("attention");
    await ui.unmount();
  });

  test("Max keeps Flags and Now while Log has its own history and unread indicator", async ($, on) => {
    const clock = host(on, { cadence: "120" });
    const flag = { key: "scope", kind: "attention", text: "The gateway change is outside the requested scope.", evidence: "I also changed the gateway" };
    let messages = [message("assistant", flag.evidence)];
    on("session.messages", () => ({ value: messages }));
    let count = 0;
    on("model.fork", () => ({ value: ++count === 1
      ? digest("First update", [flag], [], milestone("first", "First update", flag.evidence))
      : digest("Latest update", [], [], milestone("latest", "Latest update", "The next step is complete")) }));
    const ui = await $.ui.mount(PANE);
    expect((await ui.find({ key: "buddy-page-log" }))?.text).toBe("Log");
    expect(await ui.find({ key: "buddy-page-now" })).toBeUndefined();
    expect(await ui.find({ key: "buddy-page-flags" })).toBeUndefined();
    expect((await ui.find({ key: "buddy-page-chat" }))?.text).toBe("Chat");
    expect((await ui.find({ key: "buddy-page-information" }))?.text).toBe("Max");
    expect(await ui.find({ type: "Text", text: "No summaries yet." })).toBeUndefined();
    expect(await ui.find({ type: "Text", text: /Nothing needs/ })).toBeDefined();
    await ui.press({ key: "buddy-page-log" });
    expect(await ui.find({ type: "Text", text: "No summaries yet." })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /^(Flags|Now)$/ })).toBeUndefined();
    await ui.press({ key: "buddy-page-information" });
    await $.turn.start({ turnId: "first-step", text: "Start working" });
    await clock.advance(60000);
    await $.command.run({ command: "buddy", args: "update" });
    expect((await ui.find({ key: "buddy-page-information" }))?.text).toBe("Max 1");
    expect((await ui.find({ key: "buddy-page-log" }))?.text).toBe("Log●");
    await ui.press({ key: "buddy-page-log" });
    expect((await ui.find({ key: "buddy-page-log" }))?.text).toBe("Log");
    messages = [...messages, message("assistant", "The next step is complete")];
    await $.turn.start({ turnId: "more-work", text: "Keep working" });
    await clock.advance(120000);
    expect((await ui.find({ key: "buddy-page-information" }))?.text).toBe("Max 1●");
    expect((await ui.find({ key: "buddy-page-log" }))?.text).toBe("Log");
    expect((await ui.findAll({ type: "Markdown" })).map(item => item.text)).toEqual(["Latest update", "First update"]);
    await ui.press({ key: "buddy-page-information" });
    expect((await ui.find({ key: "buddy-page-information" }))?.text).toBe("Max 1");
    expect((await ui.findAll({ type: "Text", text: /^(Flags|Now|Log)$/ })).map(item => item.text)).toEqual(["Flags", "Now"]);
    expect((await ui.findAll({ type: "Markdown" })).map(item => item.text)).toEqual([flag.text, "Latest update"]);
    await ui.press({ key: "dismiss:scope" });
    expect(await ui.find({ type: "Text", text: /Nothing needs/ })).toBeDefined();
    expect((await ui.findAll({ type: "Markdown" })).map(item => item.text)).toEqual(["Latest update"]);
    await ui.press({ key: "buddy-page-log" });
    expect((await ui.findAll({ type: "Markdown" })).map(item => item.text)).toEqual(["Latest update", "First update"]);
    await ui.press({ key: "buddy-settings" });
    await ui.press({ key: "buddy-activity-log-false" });
    expect(await ui.find({ key: "buddy-page-log" })).toBeUndefined();
    await ui.press({ key: "buddy-done" });
    expect(await ui.find({ type: "Text", text: "Flags" })).toBeDefined();
    await ui.press({ key: "buddy-settings" });
    await ui.press({ key: "buddy-activity-log-true" });
    await ui.press({ key: "buddy-page-log" });
    expect((await ui.findAll({ type: "Markdown" })).map(item => item.text)).toEqual(["Latest update", "First update"]);
    await ui.press({ key: "buddy-settings" });
    await ui.press({ key: "buddy-mode-chat" });
    expect(await ui.find({ key: "buddy-page-log" })).toBeUndefined();
    await ui.press({ key: "buddy-done" });
    expect(await ui.find({ type: "Text", text: /Chat only · replies/ })).toBeDefined();
    await ui.unmount();
  });

  test("copy sends the entire flag and evidence to the clipboard without submitting chat or dismissing it", async ($, on) => {
    host(on);
    const flag = { key: "scope", kind: "attention", text: "The gateway rewrite is outside the requested scope.", evidence: "Full evidence with a quote: \"gateway\"\n" + "More supporting detail. ".repeat(30) + "END_OF_EVIDENCE" };
    on("session.messages", () => ({ value: [message("assistant", flag.evidence)] }));
    let modelCalls = 0, chatWrites = 0;
    on("model.fork", () => { modelCalls++; return { value: digest("Reviewing scope", [flag]) }; });
    on("prompt.submit", () => { chatWrites++; throw new Error("Copy must not submit a prompt"); });
    on("prompt.fill", () => { chatWrites++; throw new Error("Copy must not fill the main prompt"); });
    const copies: any[] = [];
    on("ui.copy", ($, e) => { copies.push(e); return { value: { isCopied: true } }; });
    const ui = await $.ui.mount(PANE);
    await ui.press({ key: "buddy-update" });
    await ui.press({ key: "buddy-page-information" });
    expect((await ui.find({ key: "copy:scope" }))?.text).toBe("Copy to clipboard");
    expect(await ui.find({ type: "Text", text: /END_OF_EVIDENCE/ })).toBeUndefined();
    await ui.press({ key: "copy:scope" });
    expect(copies).toEqual([{ text: `${flag.text}\n\nEvidence:\n${flag.evidence}`, surface: "terminal" }]);
    expect(await ui.find({ type: "Text", text: "Copied to clipboard." })).toBeDefined();
    expect(await ui.find({ key: "dismiss:scope" })).toBeDefined();
    expect(modelCalls).toBe(1);
    expect(chatWrites).toBe(0);
    await ui.unmount();
  });

  for (const failure of ["unavailable", "throws"]) {
    test(`clipboard ${failure} shows a retryable error instead of a false success`, async ($, on) => {
      host(on);
      const flag = { key: "scope", kind: "attention", text: "Review the gateway scope.", evidence: "I also changed the gateway" };
      on("session.messages", () => ({ value: [message("assistant", flag.evidence)] }));
      on("model.fork", () => ({ value: digest("Reviewing scope", [flag]) }));
      let count = 0;
      on("ui.copy", () => {
        if (++count > 1) return { value: { isCopied: true } };
        if (failure === "throws") throw new Error("Clipboard failed");
        return { value: { isCopied: false, reason: "no-clipboard" } };
      });
      const ui = await $.ui.mount(PANE);
      await ui.press({ key: "buddy-update" });
      await ui.press({ key: "buddy-page-information" });
      await ui.press({ key: "copy:scope" });
      expect(await ui.find({ type: "Text", text: /Could not copy/ })).toBeDefined();
      expect(await ui.find({ type: "Text", text: "Copied to clipboard." })).toBeUndefined();
      expect(await ui.find({ key: "dismiss:scope" })).toBeDefined();
      await ui.press({ key: "copy:scope" });
      expect(await ui.find({ type: "Text", text: "Copied to clipboard." })).toBeDefined();
      expect(await ui.find({ type: "Text", text: /Could not copy/ })).toBeUndefined();
      await ui.unmount();
    });
  }

  test("the flag pager walks model observations one card at a time, newest first", async ($, on) => {
    host(on);
    on("session.messages", () => ({ value: [message("assistant", "Scope grew to the gateway and tests were skipped")] }));
    const flags = [
      { key: "scope", kind: "attention", text: "Scope grew to the gateway without being asked.", evidence: "Scope grew to the gateway" },
      { key: "tests", kind: "attention", text: "Tests were skipped before the claim of success.", evidence: "tests were skipped" },
    ];
    let count = 0;
    on("model.fork", () => ({ value: ++count === 1 ? digest("Reviewing scope", flags) : digest("Reviewing tests", [flags[1]]) }));
    const ui = await $.ui.mount(PANE);
    await ui.press({ key: "buddy-update" });
    await ui.press({ key: "buddy-page-information" });
    // One review lands at most one observation, so the second flag of the first digest never appears.
    expect(await ui.find({ key: "dismiss:scope" })).toBeDefined();
    expect(await ui.find({ key: "dismiss:tests" })).toBeUndefined();
    expect(await ui.find({ key: "buddy-flag-next" })).toBeUndefined();
    await ui.press({ key: "buddy-page-information" });
    await ui.press({ key: "buddy-update" });
    await ui.press({ key: "buddy-page-information" });
    expect(await ui.find({ key: "dismiss:tests" })).toBeDefined();
    expect(await ui.find({ key: "buddy-flag-go:scope" })).toBeDefined();
    await ui.press({ key: "buddy-flag-next" });
    expect(await ui.find({ key: "dismiss:scope" })).toBeDefined();
    expect(await ui.find({ key: "buddy-flag-go:tests" })).toBeDefined();
    await ui.press({ key: "dismiss:scope" });
    await ui.press({ key: "dismiss:tests" });
    expect((await ui.find({ type: "Text", text: /Nothing needs/ }))?.text).toContain("attention");
    await ui.unmount();
  });

  test("open observations cap at ten, and a dropped flag is not a dismissal and can return", async ($, on) => {
    host(on);
    on("session.messages", () => ({ value: [message("assistant", "A SHARED evidence quote.")] }));
    const flags = Array.from({ length: 11 }, (_, i) => ({ key: `f${i + 1}`, kind: "attention", text: `Observation ${i + 1} needs a look.`, evidence: "SHARED evidence quote" }));
    const prompts: string[] = [];
    on("model.fork", ($, e) => {
      prompts.push(e.prompt);
      const flag = prompts.length <= 11 ? flags[prompts.length - 1] : prompts.length === 12 ? flags[0] : undefined;
      return { value: digest("Reviewing", flag ? [flag] : []) };
    });
    const keys = (list: any[]) => list.map((flag: any) => flag.key);
    const ui = await $.ui.mount(PANE);
    for (let i = 0; i < 10; i++) await ui.press({ key: "buddy-update" });
    await ui.press({ key: "buddy-page-information" });
    expect((await ui.find({ type: "Text", text: /1 \/ 10/ }))?.text).toContain("1 / 10");
    await ui.press({ key: "buddy-flag-prev" });
    expect(await ui.find({ key: "dismiss:f1" })).toBeDefined();
    await $.command.run({ command: "buddy", args: "update" });
    // The eleventh review still saw f1..f10; it lands f11 and f1 drops out.
    expect(keys(payload(prompts[10]).openFlags)).toEqual(keys(flags.slice(0, 10)));
    await ui.press({ key: "buddy-page-information" });
    await ui.press({ key: "buddy-flag-next" });
    expect((await ui.find({ type: "Text", text: /1 \/ 10/ }))?.text).toContain("1 / 10");
    expect(await ui.find({ key: "dismiss:f11" })).toBeDefined();
    await ui.press({ key: "buddy-flag-prev" });
    expect(await ui.find({ key: "dismiss:f2" })).toBeDefined();
    expect(await ui.find({ key: "dismiss:f1" })).toBeUndefined();
    // f1 returns like any new flag: the twelfth review sees f2..f11 with nothing marked dismissed, and f2 is the next to drop.
    await $.command.run({ command: "buddy", args: "update" });
    expect(keys(payload(prompts[11]).openFlags)).toEqual(keys(flags.slice(1)));
    expect(payload(prompts[11]).dismissed).toEqual([]);
    await ui.press({ key: "buddy-page-information" });
    await ui.press({ key: "buddy-flag-next" });
    expect(await ui.find({ key: "dismiss:f1" })).toBeDefined();
    await $.command.run({ command: "buddy", args: "update" });
    expect(keys(payload(prompts[12]).openFlags)).toEqual([...keys(flags.slice(2)), "f1"]);
    await ui.unmount();
  });

  test("session instruction blocks can ground consequential observations", async ($, on) => {
    host(on);
    on("prompt.context", ($, e) => ({ blocks: e.blocks }));
    on("session.messages", () => ({ value: [message("assistant", "Changed publication ordering")] }));
    on("model.fork", () => ({ value: digest("Ordering changed", [{ key: "durability", kind: "attention", text: "Check the publication change against the durability rule.", evidence: "Durability must precede publication." }]) }));
    await $.prompt.context({ blocks: [{ name: "claudeMd", text: "Durability must precede publication." }] });
    const ui = await $.ui.mount(PANE);
    await ui.press({ key: "buddy-update" });
    await ui.press({ key: "buddy-page-information" });
    expect(await ui.find({ key: "explain:durability" })).toBeDefined();
    await ui.unmount();
  });

  test("saved chat-only mode stays silent through startup and important events while btw questions get fresh context", async ($, on) => {
    const toasts: boolean[] = [];
    const clock = host(on, { mode: "chat" }, [], toasts);
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.surfaces", () => ({ value: ["terminal"] }));
    on("command.register", () => ({ value: undefined }));
    on("session.measure", ($, e) => ({ changed: e.changed }));
    let messages = [message("assistant", "MAIN_ONE")];
    on("session.messages", () => ({ value: messages }));
    const prompts: string[] = [];
    on("model.fork", ($, e) => { prompts.push(e.prompt); return { value: reply("CHAT_ANSWER") }; });
    await $.session.start({ cwd: "/fixture", surface: "terminal", isInteractive: true });
    const ui = await $.ui.mount(PANE);
    await $.turn.start({ turnId: "main", text: "Task" });
    await $.turn.complete({ turnId: "main", answer: "", durationMs: 100, isAborted: false, reason: "error" });
    await $.session.measure({ context: { tokens: 950, window: 1000, percent: 95 }, rateLimits: [{ percentUsed: 100 }], changed: ["context", "rateLimits"] } as any);
    await clock.advance(120000);
    expect(prompts.length).toBe(0);
    expect(toasts.length).toBe(0);
    expect(await ui.find({ key: "buddy-update" })).toBeUndefined();
    expect(await ui.find({ key: "dismiss:turn:main" })).toBeUndefined();
    expect((await ui.find({ type: "Text", text: /Chat only · replies/ }))?.text).toContain("when you ask");
    await $.command.run({ command: "btw", args: "FIRST_QUESTION" });
    messages = [...messages, message("assistant", "MAIN_TWO")];
    await ui.input({ key: "buddy-question", text: "Follow up" });
    expect(prompts[1]).toContain("MAIN_TWO");
    expect(payload(prompts[1]).sideConversation).toEqual([{ role: "user", text: "FIRST_QUESTION" }, { role: "assistant", text: "CHAT_ANSWER" }]);
    expect(payload(prompts[1]).openFlags).toEqual([]);
    await clock.advance(120000);
    expect(prompts.length).toBe(2);
    await $.command.run({ command: "buddy", args: "update" });
    expect(prompts.length).toBe(3);
    expect(prompts[2]).toContain("Give me a brief summary");
    await ui.unmount();
  });

  test("switching to chat-only discards a pending review and switching back catches up without losing chat", async ($, on) => {
    const clock = host(on);
    let messages = [message("assistant", "MAIN_ONE")];
    on("session.messages", () => ({ value: messages }));
    let release: (value: any) => void = () => {};
    let entered: () => void = () => {};
    const started = new Promise<void>(resolve => { entered = resolve; });
    const waiting = new Promise(resolve => { release = resolve; });
    let count = 0;
    on("model.fork", async () => {
      if (++count === 1) return { value: reply("PRESERVED_CHAT") };
      if (count === 2) { entered(); return { value: await waiting as any }; }
      return { value: digest("FRESH_SUMMARY") };
    });
    const ui = await $.ui.mount(PANE);
    await ui.input({ key: "buddy-question", text: "Question" });
    const work = $.command.run({ command: "buddy", args: "update" });
    await started;
    await $.command.run({ command: "buddy", args: "settings" });
    await ui.press({ key: "buddy-mode-chat" });
    expect((await ui.find({ key: "buddy-mode-chat" }))?.text).toBe("✓ Chat only (BTW)");
    expect((await ui.find({ key: "buddy-mode-companion" }))?.text).toBe("Companion");
    expect(await ui.find({ key: "buddy-cadence" })).toBeUndefined();
    release(digest("STALE_SUMMARY"));
    await work;
    await clock.advance(60000);
    expect(count).toBe(2);
    messages = [message("assistant", "MAIN_TWO")];
    await ui.press({ key: "buddy-mode-companion" });
    expect((await ui.find({ key: "buddy-mode-companion" }))?.text).toBe("✓ Companion");
    expect((await ui.find({ key: "buddy-mode-chat" }))?.text).toBe("Chat only (BTW)");
    await ui.press({ key: "buddy-done" });
    expect(await ui.find({ type: "Markdown", text: "PRESERVED_CHAT" })).toBeDefined();
    await ui.press({ key: "buddy-page-information" });
    expect(await ui.find({ type: "Markdown", text: "STALE_SUMMARY" })).toBeUndefined();
    await clock.advance(1000);
    expect(count).toBe(3);
    expect(await ui.find({ type: "Markdown", text: "FRESH_SUMMARY" })).toBeDefined();
    await ui.unmount();
  });

  test("questions asked while a reply is pending queue up and go out in order with the earlier exchange", async ($, on) => {
    host(on);
    on("session.messages", () => ({ value: [message("assistant", "MAIN")] }));
    let release: (value: any) => void = () => {};
    let entered: () => void = () => {};
    const started = new Promise<void>(resolve => { entered = resolve; });
    const waiting = new Promise(resolve => { release = resolve; });
    const prompts: string[] = [];
    on("model.fork", async ($, e) => {
      prompts.push(e.prompt);
      if (prompts.length === 1) { entered(); return { value: await waiting as any }; }
      return { value: reply("SECOND_ANSWER") };
    });
    const ui = await $.ui.mount(PANE);
    const first = $.command.run({ command: "buddy", args: "FIRST_QUESTION" });
    await started;
    await ui.input({ key: "buddy-question", text: "SECOND_QUESTION" });
    expect(prompts.length).toBe(1);
    expect((await ui.find({ type: "Text", text: /thinking/ }))?.text).toContain("thinking");
    expect((await ui.find({ type: "Text", text: /queued/ }))?.text).toContain("queued");
    release(reply("FIRST_ANSWER"));
    await first;
    expect(prompts.length).toBe(2);
    expect(prompts[1]).toContain("SECOND_QUESTION");
    expect(payload(prompts[1]).sideConversation).toEqual([{ role: "user", text: "FIRST_QUESTION" }, { role: "assistant", text: "FIRST_ANSWER" }]);
    expect(await ui.find({ type: "Markdown", text: "SECOND_ANSWER" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /queued/ })).toBeUndefined();
    await ui.unmount();
  });

  test("the chat pages older exchanges off the top and keeps the newest in view", async ($, on) => {
    host(on);
    on("session.messages", () => ({ value: [message("assistant", "MAIN")] }));
    let count = 0;
    on("model.fork", () => ({ value: reply(`ANSWER_${++count} ` + "long reply text ".repeat(40)) }));
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 22 } } });
    for (let i = 1; i <= 4; i++) await ui.input({ key: "buddy-question", text: `QUESTION_${i}` });
    expect(await ui.find({ type: "Markdown", text: /ANSWER_4/ })).toBeDefined();
    expect(await ui.find({ type: "Markdown", text: /ANSWER_1 / })).toBeUndefined();
    expect(await ui.find({ key: "buddy-chat-newer" })).toBeUndefined();
    await ui.press({ key: "buddy-chat-older" });
    expect(await ui.find({ type: "Markdown", text: /ANSWER_4/ })).toBeUndefined();
    expect(await ui.find({ key: "buddy-chat-newer" })).toBeDefined();
    await ui.input({ key: "buddy-question", text: "QUESTION_5" });
    expect(await ui.find({ type: "Markdown", text: /ANSWER_5/ })).toBeDefined();
    await ui.unmount();
  });

  test("changing mode leaves a requested chat reply in flight", async ($, on) => {
    host(on);
    on("session.messages", () => ({ value: [message("assistant", "MAIN")] }));
    let release: (value: any) => void = () => {};
    let entered: () => void = () => {};
    const started = new Promise<void>(resolve => { entered = resolve; });
    const waiting = new Promise(resolve => { release = resolve; });
    on("model.fork", async () => { entered(); return { value: await waiting as any }; });
    const ui = await $.ui.mount(PANE);
    const work = $.command.run({ command: "buddy", args: "My question" });
    await started;
    await $.command.run({ command: "buddy", args: "settings" });
    await ui.press({ key: "buddy-mode-chat" });
    expect((await ui.find({ key: "buddy-mode-chat" }))?.text).toBe("✓ Chat only (BTW)");
    expect((await ui.find({ key: "buddy-mode-companion" }))?.text).toBe("Companion");
    release(reply("REQUESTED_ANSWER"));
    await work;
    await ui.press({ key: "buddy-done" });
    expect(await ui.find({ type: "Markdown", text: "REQUESTED_ANSWER" })).toBeDefined();
    await ui.unmount();
  });

  for (const [label, settings] of [["an empty store", undefined], ["a saved mode from before settings version 2", { mode: "companion" }], ["a version 1 store", { version: 1, mode: "companion" }]] as const) {
    test(`chat only is the default with ${label}`, async ($, on) => {
      mock.store(on, settings ? { settings } : {});
      mock.env(on, { HOME: "/fixture" });
      mock.clock(on);
      on("ui.open", () => ({ value: { isPlaced: true } }));
      on("ui.scroll", () => ({}));
      on("session.model", () => ({ value: "claude-main-model" }));
      on("session.messages", () => ({ value: [message("assistant", "MAIN")] }));
      const ui = await $.ui.mount(PANE);
      expect((await ui.find({ type: "Text", text: /Chat only · replies/ }))?.text).toContain("when you ask");
      expect(await ui.find({ key: "buddy-page-information" })).toBeUndefined();
      await ui.unmount();
    });
  }

  for (const [label, settings, expected] of [
    ["an empty store", undefined, "claude-opus-5-5"],
    ["a version 2 store that saved the old main default", { version: 2, mode: "companion", model: "main" }, "claude-opus-5-5"],
    ["a version 2 store that chose a model", { version: 2, mode: "companion", model: "claude-fable-5-1" }, "claude-fable-5-1"],
    ["a version 3 store that chose Follow Claude", { version: 3, mode: "companion", model: "main" }, "claude-main-model (following Claude)"],
  ] as const) {
    test(`the selected model with ${label} is ${expected}`, async ($, on) => {
      mock.store(on, settings ? { settings } : {});
      mock.env(on, { HOME: "/fixture" });
      mock.clock(on);
      on("fs.list", () => ({ value: [] }));
      on("ui.open", () => ({ value: { isPlaced: true } }));
      on("ui.scroll", () => ({}));
      on("session.model", () => ({ value: "claude-main-model" }));
      const ui = await $.ui.mount(PANE);
      await ui.press({ key: "buddy-settings" });
      expect((await ui.find({ type: "Text", text: /^Selected model:/ }))?.text).toBe(`Selected model: ${expected}`);
      await ui.unmount();
    });
  }
});
