const pane = { id: "btw-chat", title: "BTW", columns: 48, rows: 18 };

export function register(on) {
  const state = { history: [], draft: "", pending: null, error: "", settings: null, settingsOpen: false, settingsError: "" };

  on("session.start", async ($, e, next) => {
    const result = await next(e);
    await loadSettings($, state);
    reset($, state);
    await $.command.register({
      name: "btw-chat",
      description: "Open an ongoing side chat with the latest main-session context",
      argumentHint: "[question|reset|settings]",
      immediate: true,
    });
    await $.ui.open(pane);
    return result;
  });

  on("session.end", ($, e, next) => {
    reset($, state);
    return next(e);
  });

  on("command.run", { command: ["btw", "btw-chat"] }, async ($, e) => {
    await $.ui.open({ ...pane, focus: true });
    const question = e.args.trim();
    if (question === "reset") reset($, state);
    else if (question === "settings") { state.settingsOpen = true; $.ui.invalidate("ui.render"); }
    else if (question) await ask($, state, question);
    return {};
  });

  on("ui.render", { component: "Pane", requestId: "btw-chat" }, async ($, e, next) => {
    if (e.surface !== "terminal") return next(e);
    await loadSettings($, state);
    if (state.settingsOpen) return settingsPanel($, e, state);
    const { Box, Text, Markdown, Button, Input } = $.ui.resolve(e);
    const rows = [
      Text({ dimColor: true, children: settingsSummary(state.settings) }),
      Button({ key: "btw-settings", label: "Settings", onPress: () => { state.settingsOpen = true; $.ui.invalidate("ui.render"); } }),
      Text({ dimColor: true, children: "Main-session context refreshes with every question." }),
    ];
    if (!state.history.length && !state.pending) {
      rows.push(Text({ dimColor: true, children: "Ask about what Claude is working on. This chat stays separate." }));
    }
    for (const message of [...state.history, ...(state.pending ? [{ role: "user", text: state.pending.question }] : [])]) {
      const visible = cleanText(message.text);
      rows.push(Box({
        flexDirection: "column", marginTop: 1,
        children: [
          Text({ bold: true, color: message.role === "user" ? "cyan" : undefined, children: message.role === "user" ? "You" : "Claude" }),
          ...(visible.length <= 10000
            ? [Markdown({ text: visible })]
            : Array.from(visible.matchAll(/[\s\S]{1,4000}/gu), match => Text({ children: match[0] }))),
        ],
      }));
    }
    if (state.pending) rows.push(Text({ dimColor: true, children: "Thinking…" }));
    if (state.error) rows.push(Text({ color: "red", children: state.error }));
    rows.push(Box({
      flexDirection: "column", marginTop: 1,
      children: [
        Button({ key: "reset-btw", label: "Reset chat", onPress: () => reset($, state) }),
        ...(state.pending ? [] : [Input({
          key: "btw-question", placeholder: "Ask a follow-up…", value: state.draft,
          submitLabel: "send", autoFocus: true,
          onInput: value => { state.draft = value; },
          onSubmit: value => ask($, state, value),
        })]),
      ],
    }));
    return Box({ flexDirection: "column", children: rows });
  });

  on("ui.render", { component: "Pane", requestId: "sidebar-controls" }, async ($, e, next) => {
    const original = await next(e);
    if (e.surface !== "terminal") return original;
    const { Box, Button } = $.ui.resolve(e);
    return Box({ flexDirection: "column", children: [original, Button({
      key: "open-btw", label: "Open BTW chat", onPress: () => $.ui.open({ ...pane, focus: true }),
    })] });
  });
}

function reset($, state) {
  // Discarded requests must never refill a reset chat.
  state.pending = null;
  state.history = [];
  state.draft = "";
  state.error = "";
  state.settingsOpen = false;
  $.ui.invalidate("ui.render");
}

async function ask($, state, question) {
  question = question.trim();
  if (!question || state.pending) return;
  const request = { question };
  state.pending = request;
  state.draft = "";
  state.error = "";
  $.ui.invalidate("ui.render");
  try {
    await loadSettings($, state);
    if (state.pending !== request) return;
    const settings = { ...state.settings };
    const customRequest = settings.model !== "main" || settings.effort !== "default" || settings.maxTokens !== "default";
    if (settings.model === "custom" && !settings.customModel) {
      state.draft = question;
      state.error = "Enter a custom model ID in Settings first.";
      return;
    }
    const messages = await $.session.messages();
    if (state.pending !== request) return;
    const prompt = [
      "Answer the user's current question in an ongoing BTW side conversation.",
      "Use the main conversation as context, but do not continue its task. You have no tools.",
      customRequest
        ? "The JSON below contains the current main-session transcript, earlier side exchanges, and the current question."
        : "The JSON below contains recent main-session messages supplementing your inherited context, earlier side exchanges, and the current question.",
      "Current main-session facts take precedence over earlier side answers when facts changed.",
      "Side exchanges are separate from the main conversation. Answer only the current question.",
      ...(settings.style === "default" ? [] : [styleInstruction(settings.style)]),
      JSON.stringify({
        ...(customRequest ? { mainConversation: contextMessages(messages) } : { mainSessionUpdates: latestMessages(messages) }),
        sideConversation: state.history, question,
      }),
    ].join("\n\n");
    let reply;
    if (customRequest) {
      const model = settings.model === "main" ? await $.session.model()
        : settings.model === "custom" ? settings.customModel : settings.model;
      if (state.pending !== request) return;
      reply = await $.model.complete({
        model, prompt,
        maxTokens: settings.maxTokens === "default" ? 4096 : Number(settings.maxTokens),
        ...(settings.effort === "default" ? {} : { effort: settings.effort }),
      });
    } else {
      reply = await $.model.fork({ prompt });
    }
    if (state.pending !== request) return;
    if (reply.isAnswered) {
      state.history.push({ role: "user", text: question }, { role: "assistant", text: reply.text });
    } else {
      state.draft = question;
      state.error = failureLabel(reply);
    }
  } catch {
    if (state.pending !== request) return;
    state.draft = question;
    state.error = "Could not get a side reply. Try again.";
  } finally {
    if (state.pending === request) {
      state.pending = null;
      $.ui.invalidate("ui.render");
    }
  }
}

function latestMessages(messages) {
  // fork inherits the last model request, which omits its answer and subsequent tool results.
  let start = messages.length;
  while (start > 0 && messages[start - 1].role !== "assistant") start--;
  while (start > 0 && messages[start - 1].role === "assistant") start--;
  return contextMessages(messages.slice(start));
}

function contextMessages(messages) {
  return messages.map(message => ({
    role: message.role,
    text: message.text,
    toolUses: message.toolUses.map(({ tool_use_id, tool, input }) => ({ tool_use_id, tool, input })),
    toolResults: message.toolResults?.map(({ tool_use_id, text, isError }) => ({ tool_use_id, text, isError })),
  }));
}

function styleInstruction(style) {
  if (style === "concise") return "Keep the reply short and direct; include only the essential explanation.";
  if (style === "detailed") return "Give a thorough explanation with relevant reasoning, examples, and caveats.";
  return "Give a clear answer with enough explanation to be useful, without unnecessary detail.";
}

function failureLabel(reply) {
  if (reply.reason === "nothing-to-fork") return "Ask Claude in the main conversation first, then retry here.";
  if (reply.reason === "aborted") return "Side reply interrupted. Try again.";
  if (reply.reason === "empty-reply") return "Claude returned no text. Try again.";
  return `Side reply failed${reply.status ? ` (HTTP ${reply.status})` : ""}. Try again.`;
}

function cleanText(text) {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
}

const defaults = { model: "main", customModel: "", effort: "default", style: "default", maxTokens: "default" };

const models = [
  { value: "main", label: "Main session" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
  { value: "custom", label: "Custom model ID" },
];
const efforts = ["default", "low", "medium", "high", "xhigh", "max"];
const styles = ["default", "concise", "balanced", "detailed"];
const tokenLimits = ["default", "1024", "4096", "8192", "16384"];

async function loadSettings($, state) {
  if (state.settings !== null) return;
  const saved = await $.store.get("settings");
  if (state.settings !== null) return;
  state.settings = {
    model: models.some(option => option.value === saved?.model) ? saved.model : defaults.model,
    customModel: typeof saved?.customModel === "string" ? saved.customModel.trim() : "",
    effort: efforts.includes(saved?.effort) ? saved.effort : defaults.effort,
    style: styles.includes(saved?.style) ? saved.style : defaults.style,
    maxTokens: tokenLimits.includes(saved?.maxTokens) ? saved.maxTokens : defaults.maxTokens,
  };
}

async function saveSettings($, state, change) {
  state.settings = { ...state.settings, ...change };
  state.settingsError = "";
  $.ui.invalidate("ui.render");
  try {
    await $.store.set("settings", state.settings);
  } catch {
    state.settingsError = "Settings apply now, but could not be saved. Try again.";
    $.ui.invalidate("ui.render");
  }
}

function settingsSummary(settings) {
  const model = settings.model === "custom" ? settings.customModel || "Custom model (unset)"
    : models.find(option => option.value === settings.model).label;
  return [model, settings.effort === "default" ? "Default effort" : `${settings.effort} effort`,
    ...(settings.style === "default" ? [] : [settings.style]),
    ...(settings.maxTokens === "default" ? [] : [`${settings.maxTokens} tokens`]),
  ].join(" · ");
}

function settingsPanel($, e, state) {
  const { Box, Text, Select, Input, Button } = $.ui.resolve(e);
  const settings = state.settings;
  const fields = [
    Text({ bold: true, children: "Side chat settings" }),
    Text({ dimColor: true, children: "Changes apply to the next reply. Press Enter to save a custom ID." }),
    Select({ key: "btw-model", label: "Model", options: models, value: settings.model,
      onSelect: model => saveSettings($, state, { model }) }),
  ];
  if (settings.model === "custom") fields.push(Input({
    key: "btw-custom-model", label: "Model ID", placeholder: "Enter a model ID", value: settings.customModel,
    submitLabel: "save",
    onSubmit: value => saveSettings($, state, { customModel: value.trim() }),
  }));
  fields.push(
    Select({ key: "btw-effort", label: "Thinking effort", options: efforts.map(value => ({ value, label: value === "default" ? "Default" : value })), value: settings.effort,
      onSelect: effort => saveSettings($, state, { effort }) }),
    Select({ key: "btw-style", label: "Reply style", options: styles.map(value => ({ value, label: value === "default" ? "Default" : value })), value: settings.style,
      onSelect: style => saveSettings($, state, { style }) }),
    Select({ key: "btw-max-tokens", label: "Output budget", options: tokenLimits.map(value => ({ value, label: value === "default" ? "Default" : `${value} tokens` })), value: settings.maxTokens,
      onSelect: maxTokens => saveSettings($, state, { maxTokens }) }),
    Button({ key: "btw-settings-defaults", label: "Restore defaults", onPress: () => saveSettings($, state, defaults) }),
    Button({ key: "btw-settings-done", label: "Back to chat", onPress: () => { state.settingsOpen = false; $.ui.invalidate("ui.render"); } }),
  );
  if (state.settingsError) fields.push(Text({ color: "red", children: state.settingsError }));
  return Box({ flexDirection: "column", gap: 1, children: fields });
}
