import { describe, expect, mock, test } from "claude-code/testing";

const PANE = {
  plugin: "btw-chat", surface: "terminal", component: "Pane", requestId: "btw-chat",
  props: { title: "BTW", isFocused: true, bodyColumns: 48, placement: "dock", scroll: { offset: 0, bodyRows: 35 }, view: {} },
} as const;
const USAGE = { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 };
const answer = (text: string) => ({ isAnswered: true as const, text, usage: USAGE });
const message = (role: "user" | "assistant", text: string) => ({ role, text, toolUses: [] });
const payload = (prompt: string) => JSON.parse(prompt.slice(prompt.lastIndexOf("\n\n") + 2));

describe("btw-chat", () => {
  test("follow-ups refresh main context and retain side history without submitting a main turn", async ($, on) => {
    mock.store(on);
    on("ui.open", () => ({ value: { isPlaced: true } }));
    let messages = [message("user", "Main question"), message("assistant", "LATEST_MAIN_REPLY_ONE")];
    const requests: any[] = [];
    on("session.messages", () => ({ value: messages }));
    on("model.fork", ($, e) => { requests.push(payload(e.prompt)); return { value: answer(`SIDE_ANSWER_${requests.length}`) }; });
    on("prompt.submit", () => { throw new Error("Side chat submitted a main prompt"); });
    on("session.append", () => { throw new Error("Side chat wrote the main transcript"); });
    const ui = await $.ui.mount(PANE);
    await ui.input({ key: "btw-question", text: "FIRST_SIDE_QUESTION" });
    expect(requests[0].mainSessionUpdates).toEqual([message("assistant", "LATEST_MAIN_REPLY_ONE")]);
    expect(requests[0].sideConversation).toEqual([]);
    expect((await ui.find({ type: "Markdown", text: "SIDE_ANSWER_1" }))?.text).toBe("SIDE_ANSWER_1");
    messages = [...messages, message("user", "Main follow-up"), message("assistant", "LATEST_MAIN_REPLY_TWO")];
    const before = JSON.stringify(messages);
    await ui.input({ key: "btw-question", text: "SECOND_SIDE_QUESTION" });
    expect(requests[1].mainSessionUpdates).toEqual([message("assistant", "LATEST_MAIN_REPLY_TWO")]);
    expect(requests[1].sideConversation).toEqual([
      { role: "user", text: "FIRST_SIDE_QUESTION" }, { role: "assistant", text: "SIDE_ANSWER_1" },
    ]);
    expect(requests[1].question).toBe("SECOND_SIDE_QUESTION");
    expect(JSON.stringify(messages)).toBe(before);
    await ui.unmount();
  });

  test("the latest context includes split replies, tool inputs and newly arrived tool results", async ($, on) => {
    mock.store(on);
    on("ui.open", () => ({ value: { isPlaced: true } }));
    const tool = { tool_use_id: "read-1", tool: "Read", input: { file_path: "current.rs" } };
    const result = { tool_use_id: "read-1", text: "LATEST_FILE_CONTENT", isError: false };
    const tail = [message("assistant", "Checking the file"), { role: "assistant", text: "", toolUses: [tool] }, { role: "user", text: "", toolUses: [], toolResults: [result] }];
    on("session.messages", () => ({ value: [message("user", "Already in the cached prefix"), ...tail] }));
    let sent: any;
    on("model.fork", ($, e) => { sent = payload(e.prompt); return { value: answer("The file changed") }; });
    const ui = await $.ui.mount(PANE);
    await ui.input({ key: "btw-question", text: "What just changed?" });
    expect(sent.mainSessionUpdates).toEqual(tail);
    await ui.unmount();
  });

  test("reset clears only side history and the next question still gets fresh main context", async ($, on) => {
    mock.store(on);
    on("ui.open", () => ({ value: { isPlaced: true } }));
    const requests: any[] = [];
    on("session.messages", () => ({ value: [message("assistant", "MAIN_STAYS")] }));
    on("model.fork", ($, e) => { requests.push(payload(e.prompt)); return { value: answer("SIDE_ANSWER") }; });
    const ui = await $.ui.mount(PANE);
    await ui.input({ key: "btw-question", text: "OLD_SIDE_QUESTION" });
    await ui.press({ key: "reset-btw" });
    expect(await ui.find({ type: "Markdown", text: "OLD_SIDE_QUESTION" })).toBeUndefined();
    await ui.input({ key: "btw-question", text: "NEW_SIDE_QUESTION" });
    expect(requests[1].sideConversation).toEqual([]);
    expect(requests[1].mainSessionUpdates[0].text).toBe("MAIN_STAYS");
    await ui.unmount();
  });

  test("reset during an answer discards the stale reply without clearing the next request", async ($, on) => {
    mock.store(on);
    on("ui.open", () => ({ value: { isPlaced: true } }));
    on("session.messages", () => ({ value: [message("assistant", "Main")] }));
    let release: (value: any) => void = () => {};
    let started: () => void = () => {};
    const entered = new Promise<void>(resolve => { started = resolve; });
    const waiting = new Promise(resolve => { release = resolve; });
    let count = 0;
    on("model.fork", async () => {
      if (++count === 1) { started(); return { value: await waiting as any }; }
      return { value: answer("NEW_ANSWER") };
    });
    const ui = await $.ui.mount(PANE);
    const first = ui.input({ key: "btw-question", text: "OLD_QUESTION" });
    await entered;
    await $.command.run({ command: "btw", args: "reset" });
    await $.command.run({ command: "btw", args: "NEW_QUESTION" });
    release(answer("STALE_ANSWER"));
    await first;
    expect(await ui.find({ type: "Markdown", text: "STALE_ANSWER" })).toBeUndefined();
    expect((await ui.find({ type: "Markdown", text: "NEW_ANSWER" }))?.text).toBe("NEW_ANSWER");
    expect(await ui.find({ type: "Text", text: "Thinking…" })).toBeUndefined();
    await ui.unmount();
  });

  test("API errors preserve the question for retry and do not become conversation history", async ($, on) => {
    mock.store(on);
    on("ui.open", () => ({ value: { isPlaced: true } }));
    on("session.messages", () => ({ value: [message("assistant", "Main")] }));
    const requests: any[] = [];
    on("model.fork", ($, e) => {
      requests.push(payload(e.prompt));
      return { value: requests.length === 1 ? { isAnswered: false, reason: "api-error", status: 429, error: "rate_limit", usage: USAGE } : answer("Recovered") };
    });
    const ui = await $.ui.mount(PANE);
    await ui.input({ key: "btw-question", text: "RETRY_QUESTION" });
    expect((await ui.find({ key: "btw-question" }))?.text).toBe("RETRY_QUESTION");
    expect((await ui.find({ type: "Text", text: /HTTP 429/ }))?.text).toContain("HTTP 429");
    await ui.input({ key: "btw-question", text: "RETRY_QUESTION" });
    expect(requests[1].sideConversation).toEqual([]);
    expect(await ui.find({ type: "Text", text: /HTTP 429/ })).toBeUndefined();
    await ui.unmount();
  });

  test("btw and btw-chat open the same ongoing chat and reset without transcript output", async ($, on) => {
    mock.store(on);
    const opened: any[] = [];
    on("ui.open", ($, e) => { opened.push(e); return { value: { isPlaced: true } }; });
    on("session.messages", () => ({ value: [message("assistant", "Main")] }));
    let requests = 0;
    on("model.fork", () => { requests++; return { value: answer("SIDE_ANSWER") }; });
    const ui = await $.ui.mount(PANE);
    expect(await $.command.run({ command: "btw", args: "Question" })).toEqual({});
    expect(requests).toBe(1);
    expect(await $.command.run({ command: "btw-chat", args: "" })).toEqual({});
    expect((await ui.find({ type: "Markdown", text: "SIDE_ANSWER" }))?.text).toBe("SIDE_ANSWER");
    expect(await $.command.run({ command: "btw", args: "reset" })).toEqual({});
    expect(requests).toBe(1);
    expect(await ui.find({ type: "Markdown", text: "SIDE_ANSWER" })).toBeUndefined();
    expect(opened.at(-1)).toEqual({ id: "btw-chat", title: "BTW", columns: 48, rows: 18, focus: true });
    await ui.unmount();
  });

  test("empty inputs make no request and a new main session gives an actionable message", async ($, on) => {
    mock.store(on);
    on("ui.open", () => ({ value: { isPlaced: true } }));
    on("session.messages", () => ({ value: [] }));
    let count = 0;
    on("model.fork", () => { count++; return { value: { isAnswered: false, reason: "nothing-to-fork" } }; });
    const ui = await $.ui.mount(PANE);
    await ui.input({ key: "btw-question", text: "   " });
    expect(count).toBe(0);
    await ui.input({ key: "btw-question", text: "Question" });
    expect((await ui.find({ type: "Text", text: /main conversation first/ }))?.text).toContain("main conversation first");
    expect((await ui.find({ key: "btw-question" }))?.text).toBe("Question");
    await ui.unmount();
  });

  test("long replies render without dropping text or changing the saved answer", async ($, on) => {
    mock.store(on);
    on("ui.open", () => ({ value: { isPlaced: true } }));
    on("session.messages", () => ({ value: [message("assistant", "Main")] }));
    const long = "\u001b[31m" + "😃".repeat(6000) + "LAST_LINE\u001b[0m";
    const requests: any[] = [];
    on("model.fork", ($, e) => { requests.push(payload(e.prompt)); return { value: answer(long) }; });
    const ui = await $.ui.mount(PANE);
    await ui.input({ key: "btw-question", text: "Question" });
    expect((await ui.find({ type: "Text", text: /LAST_LINE/ }))?.text).toContain("LAST_LINE");
    await ui.input({ key: "btw-question", text: "Follow up" });
    expect(requests[1].sideConversation[1].text).toBe(long);
    await ui.unmount();
  });

  test("side settings select the request model, effort, style and cap while retaining the full fresh transcript", async ($, on) => {
    let saved: any = undefined;
    on("store.get", () => ({ value: saved }));
    on("store.set", ($, e) => { saved = e.value; return { value: undefined }; });
    let messages = [message("user", "EARLY_MAIN_CONTEXT"), message("assistant", "LATEST_MAIN_CONTEXT")];
    on("session.messages", () => ({ value: messages }));
    on("config.set", () => { throw new Error("Side settings changed main settings"); });
    on("model.fork", () => { throw new Error("Custom model used a main-model fork"); });
    const requests: any[] = [];
    on("model.complete", ($, e) => { requests.push(e); return { value: answer("CUSTOM_ANSWER") }; });
    const ui = await $.ui.mount(PANE);
    await ui.press({ key: "btw-settings" });
    await ui.select({ key: "btw-model", value: "sonnet" });
    await ui.select({ key: "btw-effort", value: "high" });
    await ui.select({ key: "btw-style", value: "concise" });
    await ui.select({ key: "btw-max-tokens", value: "8192" });
    await ui.press({ key: "btw-settings-done" });
    await ui.input({ key: "btw-question", text: "CUSTOM_QUESTION" });
    expect(requests[0].model).toBe("sonnet");
    expect(requests[0].effort).toBe("high");
    expect(requests[0].maxTokens).toBe(8192);
    expect(requests[0].prompt).toContain("Keep the reply short and direct");
    expect(payload(requests[0].prompt).mainConversation).toEqual(messages);
    messages = [...messages, message("user", "NEW_MAIN_PROMPT"), message("assistant", "NEW_MAIN_REPLY")];
    await ui.input({ key: "btw-question", text: "FOLLOW_UP" });
    expect(payload(requests[1].prompt).mainConversation).toEqual(messages);
    expect(payload(requests[1].prompt).sideConversation).toEqual([
      { role: "user", text: "CUSTOM_QUESTION" }, { role: "assistant", text: "CUSTOM_ANSWER" },
    ]);
    await ui.press({ key: "reset-btw" });
    await ui.input({ key: "btw-question", text: "AFTER_RESET" });
    expect(requests[2].model).toBe("sonnet");
    expect(payload(requests[2].prompt).sideConversation).toEqual([]);
    expect(saved).toEqual({ model: "sonnet", customModel: "", effort: "high", style: "concise", maxTokens: "8192" });
    await ui.unmount();
  });

  test("saved overrides reload and Main session follows later main-model changes", async ($, on) => {
    mock.store(on, { settings: { model: "main", effort: "low", style: "detailed", maxTokens: "default" } });
    on("session.messages", () => ({ value: [message("assistant", "Main")] }));
    let mainModel = "claude-model-one";
    on("session.model", () => ({ value: mainModel }));
    const requests: any[] = [];
    on("model.complete", ($, e) => { requests.push(e); return { value: answer("Answer") }; });
    const ui = await $.ui.mount(PANE);
    expect((await ui.find({ type: "Text", text: /Main session · low effort/ }))?.text).toContain("detailed");
    await ui.input({ key: "btw-question", text: "First" });
    mainModel = "claude-model-two";
    await ui.input({ key: "btw-question", text: "Second" });
    expect(requests.map(request => request.model)).toEqual(["claude-model-one", "claude-model-two"]);
    expect(requests[1].effort).toBe("low");
    expect(requests[1].maxTokens).toBe(4096);
    expect(requests[1].prompt).toContain("thorough explanation");
    await ui.unmount();
  });

  test("a custom ID is required, saved, and sent exactly to the session client", async ($, on) => {
    let saved: any = undefined;
    on("store.get", () => ({ value: saved }));
    on("store.set", ($, e) => { saved = e.value; return { value: undefined }; });
    on("session.messages", () => ({ value: [message("assistant", "Main")] }));
    let model = "";
    on("model.complete", ($, e) => { model = e.model; return { value: answer("Answer") }; });
    const ui = await $.ui.mount(PANE);
    await ui.press({ key: "btw-settings" });
    await ui.select({ key: "btw-model", value: "custom" });
    await ui.press({ key: "btw-settings-done" });
    await ui.input({ key: "btw-question", text: "Question" });
    expect(model).toBe("");
    expect((await ui.find({ type: "Text", text: /custom model ID/ }))?.text).toContain("Settings");
    await ui.press({ key: "btw-settings" });
    await ui.input({ key: "btw-custom-model", text: "  claude-custom-model  " });
    await ui.press({ key: "btw-settings-done" });
    expect((await ui.find({ key: "btw-question" }))?.text).toBe("Question");
    await ui.input({ key: "btw-question", text: "Question" });
    expect(model).toBe("claude-custom-model");
    expect((saved as any).customModel).toBe("claude-custom-model");
    await ui.unmount();
  });

  test("restoring defaults returns to the cached main-model fork without clearing the side chat", async ($, on) => {
    let saved: any = { model: "haiku", effort: "max", style: "balanced", maxTokens: "1024" };
    on("store.get", () => ({ value: saved }));
    on("store.set", ($, e) => { saved = e.value; return { value: undefined }; });
    on("session.messages", () => ({ value: [message("assistant", "Main")] }));
    on("model.complete", () => ({ value: answer("HAIKU_ANSWER") }));
    let forked: any;
    on("model.fork", ($, e) => { forked = payload(e.prompt); return { value: answer("MAIN_ANSWER") }; });
    const ui = await $.ui.mount(PANE);
    await ui.input({ key: "btw-question", text: "First" });
    await ui.press({ key: "btw-settings" });
    await ui.press({ key: "btw-settings-defaults" });
    await ui.press({ key: "btw-settings-done" });
    await ui.input({ key: "btw-question", text: "Second" });
    expect(forked.sideConversation).toEqual([{ role: "user", text: "First" }, { role: "assistant", text: "HAIKU_ANSWER" }]);
    expect(saved).toEqual({ model: "main", customModel: "", effort: "default", style: "default", maxTokens: "default" });
    await ui.unmount();
  });

  test("reply-style-only changes retain the native fork and settings can open by command", async ($, on) => {
    mock.store(on);
    on("ui.open", () => ({ value: { isPlaced: true } }));
    on("session.messages", () => ({ value: [message("assistant", "Main")] }));
    let prompt = "";
    on("model.fork", ($, e) => { prompt = e.prompt; return { value: answer("Answer") }; });
    const ui = await $.ui.mount(PANE);
    await $.command.run({ command: "btw", args: "settings" });
    await ui.select({ key: "btw-style", value: "balanced" });
    await ui.press({ key: "btw-settings-done" });
    await ui.input({ key: "btw-question", text: "Question" });
    expect(prompt).toContain("without unnecessary detail");
    expect(payload(prompt).mainSessionUpdates).toEqual([message("assistant", "Main")]);
    await ui.unmount();
  });
});
