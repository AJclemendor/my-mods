import { latestModels } from "./models.mjs";
import { observer, summarizePrompt, contextMessages, latestMessages, currentTurnMessages, evidenceText, parseDigest, progressSummary, progressEntry, repeatsDismissedFlag, cleanText, oneLine } from "./context.mjs";

const pane = { id: "claude-buddy", title: "Claude Buddy", columns: 54, rows: 22 };
// Settings version 2 made chat only the default; a saved mode from before it was the old default, not a choice, so it is not carried over.
// Settings version 3 made Opus 5.5 the default model; a saved "main" from before it was likewise the old default, so it moves to Opus 5.5.
const settingsVersion = 3;
const defaultModel = "claude-opus-5-5";
const defaults = { version: settingsVersion, enabled: true, mode: "chat", activityLog: true, model: defaultModel, effort: "default", cadence: "30", replyStyle: "concise", favorites: [] };
const kinds = {
  attention: { label: "Heads up", glyph: "!", color: "yellow" },
  decision: { label: "Your decision", glyph: "?", color: "magenta" },
  insight: { label: "You should know", glyph: "i", color: "cyan" },
  uncertain: { label: "Uncertain", glyph: "~", color: "gray" },
};
const companionPages = ["chat", "information", "log"];
const settingsPages = ["settings", "feedback", "prompt"];
const replyShape = {
  concise: "Reply in two to five short lines; one line when one answers it.",
  balanced: "Reply in at most eight short lines.",
  detailed: "Reply in at most fourteen short lines, still only what the question needs.",
};
const chatQueueLimit = 5;
const flagLimit = 10;
const logAfterMs = 60_000;

export function register(on) {
  const state = {
    prefs: null, enabled: false, page: "information", previousPage: "information", summary: "", summaryAt: 0, updates: [], flags: [], dismissed: [], known: [],
    history: [], draft: "", summaryError: "", chatError: "", settingsError: "", flagCopy: null, auto: null, chat: null, chatQueue: [], timer: null,
    revision: 0, reviewed: -1, reviewedSnapshot: null, activityVersion: 0, mainTurn: null, workTurn: null, logHistory: [], activity: new Map(), context: [], flagIndex: 0, chatPage: 0, unseen: {}, urgent: false, headless: false,
    catalog: [], catalogLoaded: false, catalogStatus: "", spacePaused: false, layout: null, layoutTimer: null, dockColumns: 0,
    feedback: [], feedbackDraft: null, feedbackVersion: 0, feedbackBusy: false, feedbackError: "", promptCopy: null,
  };

  on("session.start", async ($, e, next) => {
    const result = await next(e);
    await load($, state);
    await $.command.register({ name: "claude-buddy", description: "Toggle Buddy or ask a side question", argumentHint: "[on|off|companion|chat|settings|update|reset|question]", immediate: true });
    await $.command.register({ name: "buddy", description: "Open Claude Buddy or ask a side question", argumentHint: "[question|companion|chat|settings]", immediate: true });
    state.headless = !(await $.session.surfaces()).includes("terminal");
    if (!state.headless && state.enabled && !state.spacePaused) {
      await $.ui.open(pane);
      schedule($, state, 1000);
    }
    return result;
  });

  on("session.end", ($, e, next) => {
    stop(state);
    state.layoutTimer?.cancel(); state.layoutTimer = null; state.layout = null; state.spacePaused = false; state.dockColumns = 0;
    state.summary = ""; state.summaryAt = 0; state.updates = []; state.flags = []; state.dismissed = [];
    state.history = []; state.draft = ""; state.summaryError = ""; state.chatError = ""; state.flagCopy = null; state.context = []; state.activity.clear();
    state.feedbackDraft = null;
    state.mainTurn = null; state.workTurn = null; state.logHistory = []; state.revision = 0; state.reviewed = -1; state.reviewedSnapshot = null; state.urgent = false; state.chatQueue = []; state.unseen = {}; state.flagIndex = 0; state.chatPage = 0;
    return next(e);
  });

  on("prompt.context", async ($, e, next) => {
    const result = await next(e);
    state.context = result.blocks;
    return result;
  });

  on("turn.start", async ($, e, next) => {
    const result = await next(e);
    if (e.agentId) return result;
    state.mainTurn = e.turnId;
    state.workTurn = { id: e.turnId, startedAt: await now($), elapsedMs: null };
    await load($, state);
    changed($, state);
    return result;
  });

  on("session.append", async ($, e, next) => {
    const result = await next(e);
    if (e.agentId || result.deny || e.origin.kind === "plugin") return result;
    await load($, state);
    if (state.prefs.mode === "chat") return result;
    if (["user", "assistant", "attachment"].includes(result.message.type)) changed($, state);
    return result;
  });

  on("tool.call", async ($, e, next) => {
    if (e.agentId || state.prefs?.mode === "chat") return next(e);
    const label = `${e.tool}${e.input?.description ? `: ${oneLine(e.input.description)}` : ""}`;
    state.activity.set(e.tool_use_id, label);
    $.ui.invalidate("ui.render");
    try { return await next(e); }
    finally {
      state.activity.delete(e.tool_use_id);
      $.ui.invalidate("ui.render");
    }
  });

  // The end of a main turn is the one event reviewed promptly; everything else waits for the routine cadence.
  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    if (e.agentId || (state.workTurn && e.turnId !== state.workTurn.id)) return result;
    // A reload can miss turn.start; the host still reports that turn's actual
    // duration at completion, so a long turn can keep its final milestone.
    state.workTurn ??= { id: e.turnId, startedAt: 0, elapsedMs: null };
    state.workTurn.elapsedMs = e.durationMs;
    state.mainTurn = null;
    changed($, state, true);
    return result;
  });

  on("command.run", { command: ["claude-buddy", "buddy", "btw"] }, async ($, e, next) => {
    await load($, state);
    if (e.command === "btw" && !state.enabled) return next(e);
    const arg = e.args.trim();
    if (arg === "off" || (e.command === "claude-buddy" && !arg && state.enabled)) { await toggle($, state, false); return {}; }
    await toggle($, state, true, true);
    if (state.spacePaused) return { text: "Max is paused until there is room for a docked sidebar. Widen the fullscreen terminal to resume." };
    if (arg === "settings") go($, state, "settings");
    else if (arg === "companion" || arg === "chat") { await save($, state, { mode: arg }); go($, state, homePage(state)); }
    else if (arg === "reset") resetChat($, state);
    else if (arg === "update") {
      if (state.prefs.mode === "chat") await ask($, state, "Give me a brief summary of the current main-session progress.");
      else { go($, state, "information"); state.revision++; await summarize($, state, true); }
    }
    else if (arg && arg !== "on") await ask($, state, arg);
    $.ui.invalidate("ui.render");
    return {};
  });

  on("ui.close", { id: "claude-buddy" }, async ($, e, next) => {
    const result = await next(e);
    if (e.origin.kind === "person") { state.enabled = false; stop(state); await save($, state, { enabled: false }); }
    $.ui.invalidate("ui.render");
    return result;
  });

  // PromptHint still reports resizes when the control band or our pane is hidden.
  // Do not subscribe to transcript rows: every sidebar invalidation would redraw
  // the entire conversation as well.
  on("ui.render", { component: ["AbovePrompt", "PromptHint", "Pane"] }, async ($, e, next) => {
    if (e.surface === "terminal") { await load($, state); observeLayout($, state, e); }
    return next(e);
  });

  on("ui.render", { component: "Pane", requestId: "claude-buddy" }, async ($, e, next) => {
    if (e.surface !== "terminal") return next(e);
    await load($, state);
    if (state.spacePaused) return $.ui.resolve(e).Box({});
    return renderPane($, e, state);
  });

  on("ui.render", { component: ["AbovePrompt", "Pane"] }, async ($, e, next) => {
    if (e.component === "Pane" && e.requestId !== "sidebar-controls") return next(e);
    const original = await next(e);
    if (e.surface !== "terminal" || e.props.hasSurvey) return original;
    await load($, state);
    if (e.component === "AbovePrompt") {
      const { value } = await $.state.get({ plugin: "sidebar-controls", key: "visible" });
      if (value) return original;
    }
    const { Box, Button } = $.ui.resolve(e);
    return Box({ flexDirection: "column", children: [original, Button({
      key: "toggle-buddy", label: `Claude Buddy: ${state.enabled ? state.spacePaused ? "PAUSED · widen window" : state.prefs.mode === "chat" ? "CHAT ONLY" : "ON" : "OFF"}${state.enabled && !state.spacePaused && state.prefs.mode !== "chat" && state.flags.length ? ` · ${state.flags.length} to review` : ""}`,
      color: state.enabled ? "cyan" : "gray", onPress: () => toggle($, state, !state.enabled, true),
    })] });
  });
}

async function load($, state) {
  if (state.prefs) return;
  const saved = await $.store.get("settings");
  const known = await $.store.get("known");
  const feedback = await $.store.get("flagFeedback");
  if (state.prefs) return;
  state.prefs = {
    version: settingsVersion,
    enabled: typeof saved?.enabled === "boolean" ? saved.enabled : true,
    mode: saved?.version >= 2 && saved.mode === "companion" ? "companion" : "chat",
    activityLog: typeof saved?.activityLog === "boolean" ? saved.activityLog : true,
    model: typeof saved?.model === "string" && saved.model.trim() && (saved.model !== "main" || saved.version >= 3) ? saved.model : defaultModel,
    effort: ["default", "low", "medium", "high", "xhigh", "max"].includes(saved?.effort) ? saved.effort : "default",
    cadence: ["10", "30", "60", "120"].includes(saved?.cadence) ? saved.cadence : "30",
    replyStyle: ["concise", "balanced", "detailed"].includes(saved?.replyStyle) ? saved.replyStyle : "concise",
    favorites: Array.isArray(saved?.favorites) ? saved.favorites.filter(value => typeof value === "string" && value.trim()) : [],
  };
  state.enabled = state.prefs.enabled;
  state.known = Array.isArray(known) ? known.filter(value => typeof value === "string") : [];
  state.feedback = validFeedback(feedback);
  state.page = state.previousPage = homePage(state);
}

function homePage(state) { return state.prefs?.mode === "chat" ? "chat" : "information"; }

function go($, state, page) {
  if (settingsPages.includes(page)) { if (!settingsPages.includes(state.page)) state.previousPage = state.page; }
  else state.previousPage = page;
  state.page = page;
  delete state.unseen[page];
  $.ui.invalidate("ui.render");
}

function arrived(state, page) { if (state.page !== page) state.unseen[page] = true; }

function observeLayout($, state, e) {

  if (e.component === "Pane") {
    state.dockColumns = e.props.placement === "dock" ? (e.props.bodyColumns || 0) + 1 : 0;
  }
  const ownPane = e.component === "Pane" && e.requestId === pane.id;
  const inline = ownPane && e.props.placement === "inline";
  // The host reports transcript width after subtracting the dock. Restore its
  // measured width for resize checks; inline placement is authoritative.
  if (ownPane && (!inline || state.spacePaused)) return;
  if (!ownPane && !["AbovePrompt", "PromptHint"].includes(e.component)) return;
  const viewport = e.viewport;
  if (typeof viewport?.isFullscreen !== "boolean" || !viewport.columns) {
    if (!inline) return;
  }
  const columns = (viewport?.columns || 0) + (viewport?.isFullscreen ? state.dockColumns : 0);
  const key = viewport ? `${viewport.isFullscreen}:${columns}` : "inline";
  if (state.layout?.key === key && !(inline && !state.spacePaused)) return;
  const fits = !inline && viewport?.isFullscreen === true && columns >= 110;
  state.layout = { key, fits };
  state.layoutTimer?.cancel(); state.layoutTimer = null;
  if (!fits) {
    state.spacePaused = true;
    state.timer?.cancel(); state.timer = null;
    state.auto = null;
  }
  if (!state.enabled || (fits && !state.spacePaused)) return;
  const layout = state.layout;
  state.layoutTimer = $.clock.after(0, async () => {
    state.layoutTimer = null;
    if (!state.enabled || state.layout !== layout) return;
    if (!layout.fits) await $.ui.close({ id: pane.id });
    else await reopenForSpace($, state);
    $.ui.invalidate("ui.render");
  });
}

async function reopenForSpace($, state) {
  const opened = await $.ui.open(pane);
  if (!state.enabled || !state.layout?.fits || !opened.isPlaced) return;
  state.spacePaused = false;
  state.revision++;
  if (state.chatQueue.length && !state.chat) await ask($, state, state.chatQueue.shift());
  else schedule($, state, 1000);
}

async function save($, state, change) {
  const previousMode = state.prefs.mode;
  if (typeof change.activityLog === "boolean" && change.activityLog !== state.prefs.activityLog) state.activityVersion++;
  state.prefs = { ...state.prefs, ...change };
  if (state.prefs.mode !== previousMode) {
    state.timer?.cancel(); state.timer = null;
    state.auto = null;
    state.urgent = state.prefs.mode === "companion";
    if (state.urgent) { state.revision++; schedule($, state, 1000); }
    if (!companionPages.includes(state.previousPage) || (state.prefs.mode === "chat" && state.previousPage !== "chat")) state.previousPage = homePage(state);
    if (companionPages.includes(state.page)) state.page = state.previousPage;
  }
  if (!state.prefs.activityLog) {
    if (state.previousPage === "log") state.previousPage = homePage(state);
    if (state.page === "log") state.page = homePage(state);
  }
  state.settingsError = "";
  $.ui.invalidate("ui.render");
  try { await $.store.set("settings", state.prefs); }
  catch { state.settingsError = "Using these settings, but saving failed."; $.ui.invalidate("ui.render"); }
}

function stop(state) {
  state.timer?.cancel(); state.timer = null;
  state.layoutTimer?.cancel(); state.layoutTimer = null;
  state.auto = null; state.chat = null; state.chatQueue = [];
}

async function toggle($, state, enabled, focus = false) {
  await load($, state);
  const wasEnabled = state.enabled;
  state.enabled = enabled;
  if (!enabled) { stop(state); await $.ui.close({ id: pane.id }); }
  else if (state.spacePaused) {
    if (state.layout?.fits) await reopenForSpace($, state);
  }
  else {
    await $.ui.open({ ...pane, ...(focus ? { focus: true } : {}) });
    if (!wasEnabled) { state.revision++; schedule($, state, 1000); }
  }
  if (state.prefs.enabled !== enabled) await save($, state, { enabled });
  $.ui.invalidate("ui.render");
}

function changed($, state, important = false) {
  if (state.prefs?.mode === "chat") return;
  state.revision++;
  state.urgent ||= important;
  schedule($, state, important ? 1000 : Number(state.prefs?.cadence || "30") * 1000, important);
  $.ui.invalidate("ui.render");
}

function schedule($, state, delay, important = false) {
  if (state.headless || !state.enabled || state.spacePaused || state.prefs?.mode === "chat" || state.auto || state.chat || state.revision <= state.reviewed) return;
  if (state.timer && !important) return;
  state.timer?.cancel();
  state.timer = $.clock.after(delay, () => { state.timer = null; return summarize($, state); });
}

function addFlag($, state, flag, at) {
  if (state.prefs?.mode === "chat") return;
  if (repeatsDismissedFlag(flag, state.dismissed) || (flag.kind === "insight" && state.known.includes(flag.text)) || state.flags.some(old => old.key === flag.key || old.text === flag.text)) return;
  state.flags.push({ ...flag, at });
  // The list stays bounded so a long session cannot bury a new observation under stale ones; a dropped flag is not a dismissal and may return.
  if (state.flags.length > flagLimit) state.flags = state.flags.slice(-flagLimit);
  // A new observation only marks its tab: no toast, no page change. Reading it is the human's call.
  arrived(state, "information");
  if (state.page === "information" && state.flagIndex > 0) state.flagIndex++;
  $.ui.invalidate("ui.render");
}

async function now($) { try { return await $.clock.now(); } catch { return 0; } }

function scrollToEnd($) { try { Promise.resolve($.ui.scroll({ in: pane.id, to: "end" })).catch(() => {}); } catch { /* The engine scrolls when it can; the chat is readable either way. */ } }

async function modelReply($, state, request, task) {
  const prefs = { ...state.prefs };
  const messages = await $.session.messages();
  if (!state.enabled || (state.auto !== request && state.chat !== request)) return null;
  if (state.auto === request && !messages.some(message => message.text.trim() || message.toolUses.length || message.toolResults?.length) && !state.activity.size) return null;
  if (state.auto === request) {
    request.snapshot = JSON.stringify([contextMessages(messages), [...state.activity], state.dismissed, state.known, state.feedback]);
    if (!request.force && request.snapshot === state.reviewedSnapshot) return null;
  }
  const custom = prefs.model !== "main" || prefs.effort !== "default";
  const context = state.context;
  let logContext;
  let turnMessages;
  if (state.auto === request) {
    request.workTurn = state.workTurn;
    const elapsedMs = request.workTurn ? request.workTurn.elapsedMs ?? Math.max(0, (await now($)) - request.workTurn.startedAt) : 0;
    request.logEligible = request.activityLog && !!request.workTurn && elapsedMs >= logAfterMs;
    turnMessages = currentTurnMessages(messages);
    request.logEvidence = evidenceText(turnMessages, []);
    logContext = { eligible: request.logEligible, elapsedSeconds: Math.floor(elapsedMs / 1000), isRunning: !!state.mainTurn };
    if (!state.enabled || state.auto !== request) return null;
  }
  const data = {
    ...(custom ? { mainConversation: contextMessages(messages), sessionContext: context } : { mainSessionUpdates: latestMessages(messages) }),
    previousSummary: prefs.mode === "chat" ? "" : state.summary,
    ...(logContext ? { activityLogEnabled: request.activityLog, logContext, currentTurnConversation: contextMessages(turnMessages), recentLog: state.updates } : {}),
    openFlags: prefs.mode === "chat" ? [] : state.flags.map(({ at, ...flag }) => flag), dismissed: [...state.dismissed], knownTopics: state.known,
    flagFeedback: state.feedback.map(({ rating, note, flag }) => ({ rating, note, flag })),
    sideConversation: state.history, currentActivity: prefs.mode === "chat" ? [] : [...state.activity.values()],
  };
  const prompt = `${observer}\n\n${task}\n\n${JSON.stringify(data)}`;
  let reply;
  if (custom) {
    const model = prefs.model === "main" ? await $.session.model() : prefs.model;
    const system = await $.prompt.compose();
    if (!state.enabled || (state.auto !== request && state.chat !== request)) return null;
    reply = await $.model.complete({ model, prompt, system: `${system.sections.map(section => section.text).join("\n\n")}\n\n${observer}`,
      maxTokens: state.auto === request ? 2048 : 4096,
      ...(prefs.effort === "default" ? {} : { effort: prefs.effort }),
    });
  } else reply = await $.model.fork({ prompt });
  return { reply, evidence: evidenceText(messages, data.openFlags, context), flags: data.openFlags };
}

async function summarize($, state, force = false) {
  if (!state.enabled || state.spacePaused || state.prefs?.mode === "chat" || state.auto || state.chat || state.revision <= state.reviewed) return;
  state.timer?.cancel(); state.timer = null;
  const request = { revision: state.revision, dismissedCount: state.dismissed.length, force,
    activityLog: state.prefs.activityLog, activityVersion: state.activityVersion, feedbackVersion: state.feedbackVersion };
  state.urgent = false;
  state.auto = request;
  $.ui.invalidate("ui.render");
  try {
    const result = await modelReply($, state, request, summarizePrompt);
    if (!result || state.auto !== request) return;
    if (!result.reply.isAnswered) { state.summaryError = failureLabel(result.reply); return; }
    const digest = parseDigest(result.reply.text, result.evidence, result.flags);
    const summaryAt = await now($);
    if (state.auto !== request) return;
    const collectActivity = state.prefs.activityLog && request.activityLog && state.activityVersion === request.activityVersion;
    const summary = collectActivity ? progressSummary(digest.summary) : null;
    if (summary !== null && summary !== state.summary) {
      state.summary = summary;
      state.summaryAt = summaryAt;
      arrived(state, "information");
    }
    const entry = collectActivity && request.logEligible && state.workTurn === request.workTurn
      ? progressEntry(digest.log, request.logEvidence, state.logHistory) : null;
    if (entry) {
      const update = { ...entry, at: summaryAt };
      state.logHistory.push(update);
      state.updates = [...state.updates.slice(-9), update];
      arrived(state, "log");
    }
    state.flags = state.flags.filter(flag => !digest.resolved.some(item => item.key === flag.key));
    // An in-flight review did not see the dismissal; let the next review reconsider
    // its observations with that context, while keeping this progress summary.
    if (request.dismissedCount === state.dismissed.length && request.feedbackVersion === state.feedbackVersion) {
      for (const flag of digest.flags) addFlag($, state, flag, summaryAt);
    }
    state.reviewedSnapshot = request.snapshot;
    state.summaryError = "";
  } catch { if (state.auto === request) state.summaryError = "Buddy could not verify this update. Previous observations remain visible; try Update now."; }
  finally {
    if (state.auto === request) {
      state.reviewed = request.revision;
      state.auto = null;
      schedule($, state, state.urgent ? 1000 : Number(state.prefs.cadence) * 1000);
      $.ui.invalidate("ui.render");
    }
  }
}

async function ask($, state, question) {
  if (state.spacePaused) return;
  question = question.trim();
  if (!question) return;
  state.draft = ""; state.chatError = "";
  if (!settingsPages.includes(state.page) || state.prefs.mode === "chat") go($, state, "chat");
  if (state.chat) {
    if (state.chatQueue.length < chatQueueLimit && !state.chatQueue.includes(question)) state.chatQueue.push(question);
    $.ui.invalidate("ui.render");
    return;
  }
  state.timer?.cancel(); state.timer = null;
  const request = { question };
  state.chat = request; state.chatPage = 0;
  $.ui.invalidate("ui.render");
  scrollToEnd($);
  try {
    const result = await modelReply($, state, request, `Answer this side question using the latest session context and prior side exchanges. ${replyShape[state.prefs.replyStyle]} Answer the question itself first; add a consequence or caveat only when it changes what the human should do, and say plainly when you are unsure. The reply is read in a narrow side pane about 50 characters wide: short lines, bullets over paragraphs, no headings, tables, or preamble.\nQuestion: ${question}`);
    if (!result || state.chat !== request) return;
    if (result.reply.isAnswered) {
      state.history.push({ role: "user", text: question }, { role: "assistant", text: result.reply.text });
      arrived(state, "chat");
      if (state.page === "chat" && state.chatPage > 0) state.unseen.chat = true;
    }
    else { state.draft = question; state.chatError = failureLabel(result.reply); }
  } catch { if (state.chat === request) { state.draft = question; state.chatError = "Buddy could not answer. Check the model setting and retry."; } }
  finally {
    if (state.chat === request) {
      state.chat = null;
      $.ui.invalidate("ui.render");
      if (state.page === "chat" && state.chatPage === 0) scrollToEnd($);
      if (state.chatQueue.length && state.enabled && !state.spacePaused) await ask($, state, state.chatQueue.shift());
      else schedule($, state, state.urgent ? 1000 : Number(state.prefs.cadence) * 1000);
    }
  }
}

function resetChat($, state) {
  state.chat = null; state.chatQueue = []; state.history = []; state.draft = ""; state.chatError = ""; state.chatPage = 0;
  go($, state, "chat");
  schedule($, state, Number(state.prefs.cadence) * 1000);
}

const failureHints = {
  model_not_found: "Choose another model in settings.",
  rate_limit: "Try again shortly.", overloaded: "Try again shortly.", server_error: "Try again shortly.",
  authentication_failed: "Check this profile's account or credentials.", billing_error: "Check this profile's account or credentials.",
  account_on_hold: "Check this profile's account or credentials.", verification_required: "Check this profile's account or credentials.",
  oauth_org_not_allowed: "Check this profile's account or credentials.", cloud_credential_error: "Check this profile's account or credentials.",
};

function failureLabel(reply) {
  if (reply.reason === "nothing-to-fork") return "Waiting for Claude's first main-session reply.";
  if (reply.reason === "aborted") return "Buddy's request was interrupted. Try again.";
  const hint = reply.error === "invalid_request" || (reply.status === 400 && !reply.error)
    ? "The main conversation may be too long for this model; Follow Claude forks the main model with its full context."
    : failureHints[reply.error] || "Try again or choose another model.";
  const detail = [reply.status ? `HTTP ${reply.status}` : "", reply.error && reply.error !== "unknown" ? reply.error : ""].filter(Boolean).join(", ");
  return `Buddy request failed (${detail || "no response"}). ${hint}`;
}

const pacific = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", hour12: true });
function clock(at) { return at ? pacific.format(new Date(at)) : ""; }

function clip(text, width) { const line = oneLine(text); return line.length > width ? `${line.slice(0, Math.max(0, width - 1))}…` : line; }

// Rows a text takes when wrapped at `width`, a close estimate for paging; the engine does the real wrapping.
function rowsOf(text, width) { return cleanText(text).split("\n").reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / Math.max(1, width))), 0); }

function blocks(ui, text) {
  const visible = cleanText(text);
  return visible.length <= 10000 ? [ui.Markdown({ text: visible })]
    : Array.from(visible.matchAll(/[\s\S]{1,4000}/gu), match => ui.Text({ children: match[0] }));
}

// A glyph in a fixed gutter beside wrapping text, the row shape every list here uses.
function gutter(ui, glyph, content, width = 2) {
  return ui.Box({ flexDirection: "row", children: [ui.Box({ width, flexShrink: 0, children: [glyph] }), ui.Box({ flexGrow: 1, flexShrink: 1, flexDirection: "column", children: Array.isArray(content) ? content : [content] })] });
}

async function renderPane($, e, state) {
  const ui = $.ui.resolve(e);
  const { Box, Text } = ui;
  const cols = e.props.bodyColumns || pane.columns;
  const { value: navigationRows } = await $.state.get({ plugin: "prompt-nav", key: "paneRows" });
  // Navigation wraps this pane. Include its row in the height budget so focus
  // can reveal our input without scrolling the navigation out of view.
  const rows = Math.max(1, (e.props.scroll?.bodyRows || pane.rows) - (!e.props.view?.agentId && navigationRows === 1 ? 1 : 0));
  const rule = Text({ dimColor: true, children: "─".repeat(cols) });
  const body = state.page === "settings" ? await renderSettings($, e, state)
    : state.page === "feedback" ? renderSavedFeedback($, e, state, cols)
    : state.page === "prompt" ? renderPrompt($, e, state)
    : state.page === "chat" ? renderChat($, e, state, cols, rows)
    : state.page === "log" ? renderLog($, e, state)
    : await renderInformation($, e, state, cols);
  // The body grows to fill the pane so the input sits on its last row; a taller tree scrolls as before.
  // The chat hugs the input like a transcript does; every other page reads from the top.
  const children = [renderStrip($, e, state), rule];
  if (state.prefs.mode === "chat" && state.page === "chat") children.push(Text({ dimColor: true, children: "○ Chat only · replies when you ask" }));
  children.push(Box({ flexGrow: 1, flexDirection: "column", justifyContent: state.page === "chat" ? "flex-end" : "flex-start", children: [body] }));
  if (!settingsPages.includes(state.page)) children.push(renderFooter($, e, state, rule));
  return Box({ flexDirection: "column", minHeight: rows, children });
}

function renderStrip($, e, state) {
  const { Box, Text, Button } = $.ui.resolve(e);
  const pages = state.prefs.mode === "chat" ? ["chat"] : companionPages.filter(page => page !== "log" || state.prefs.activityLog);
  const labels = { information: `Max${state.flags.length ? ` ${state.flags.length}` : ""}`, chat: "Chat", log: "Log" };
  const children = [];
  for (const page of pages) {
    if (children.length) children.push(Text({ dimColor: true, children: "│" }));
    children.push(Button({ key: `buddy-page-${page}`, plain: true, dimColor: state.page !== page, label: `${labels[page]}${state.unseen[page] ? "●" : ""}`, onPress: () => go($, state, page) }));
  }
  children.push(Text({ dimColor: true, children: "│" }), Button({ key: "buddy-settings", plain: true, dimColor: !settingsPages.includes(state.page), label: "Settings", onPress: () => go($, state, "settings") }));
  return Box({ flexDirection: "row", gap: 1, children });
}

function renderFooter($, e, state, rule) {
  const { Box, Text, Button, Input } = $.ui.resolve(e);
  const children = [rule];
  if (state.chatError) children.push(Text({ color: "yellow", wrap: "truncate-end", children: state.chatError }));
  // The field keeps what the person typed until the hook draws a different `value`, so the draft is redrawn as it
  // is typed: a send then draws "" against the typed text and the field empties.
  children.push(Input({ key: "buddy-question", value: state.draft, placeholder: "Ask about this session…", submitLabel: "send", autoFocus: true,
    onInput: value => { state.draft = value; $.ui.invalidate("ui.render"); }, onSubmit: value => { void ask($, state, value); } }));
  if (state.page === "chat" && (state.history.length || state.chat)) children.push(Button({ key: "buddy-reset", plain: true, dimColor: true, label: "reset chat", onPress: () => resetChat($, state) }));
  return Box({ flexDirection: "column", children });
}

async function renderNow($, e, state, cols) {
  const ui = $.ui.resolve(e);
  const { Box, Text, Button } = ui;
  const status = state.auto ? ["◐", "cyan", "Reviewing…"] : state.summaryError ? ["!", "yellow", "Review needs retry"] : state.revision > state.reviewed ? ["○", "cyan", "New activity to review"] : ["●", "green", "Watching"];
  const model = state.prefs.model === "main" ? await $.session.model() : state.prefs.model;
  const rows = [
    Box({ flexDirection: "row", justifyContent: "space-between", children: [
      Box({ flexDirection: "row", gap: 1, children: [Text({ color: status[1], children: status[0] }), Text({ children: status[2] })] }),
      Text({ dimColor: true, wrap: "truncate-start", children: `${clip(model, 24)} · ${state.prefs.cadence}s` }),
    ] }),
    Box({ flexDirection: "row", gap: 1, children: [
      Button({ key: "buddy-update", plain: true, dimColor: true, label: state.prefs.activityLog ? "update now" : "check flags", onPress: () => { go($, state, "information"); state.revision++; return summarize($, state, true); } }),
      Button({ key: "buddy-off", plain: true, dimColor: true, label: "off", onPress: () => toggle($, state, false) }),
    ] }),
  ];
  if (state.prefs.activityLog) {
    if (state.activity.size) rows.push(Text({ dimColor: true, wrap: "truncate-end", children: `▶ ${[...state.activity.values()].join(" · ")}` }));
    rows.push(Box({ height: 1 }));
    rows.push(...(state.summary ? blocks(ui, state.summary) : [Text({ dimColor: true, children: "I'll summarize as Claude works." })]));
  }
  if (state.summaryError) rows.push(Box({ height: 1 }), Text({ color: "yellow", children: state.summaryError }));
  return Box({ flexDirection: "column", children: rows });
}

async function renderInformation($, e, state, cols) {
  const { Box, Text } = $.ui.resolve(e);
  return Box({ flexDirection: "column", children: [
    Text({ bold: true, children: "Flags" }),
    ...(state.feedbackError ? [Text({ color: "yellow", children: state.feedbackError })] : []),
    renderFlags($, e, state, cols),
    Box({ marginTop: 1, flexDirection: "column", children: [
      ...(state.prefs.activityLog ? [Text({ bold: true, children: "Now" })] : []),
      await renderNow($, e, state, cols),
    ] }),
  ] });
}

async function copyFlag($, state, flag, surface) {
  const copy = { key: flag.key, message: "Copying…", isError: false };
  state.flagCopy = copy;
  $.ui.invalidate("ui.render");
  const text = `${cleanText(flag.text)}\n\nEvidence:\n${cleanText(flag.evidence)}`;
  try {
    const result = await $.ui.copy({ text, surface });
    copy.isError = !result.isCopied;
    copy.message = result.isCopied ? "Copied to clipboard." : "Could not copy. Try again or select the flag text to copy manually.";
  } catch {
    copy.isError = true;
    copy.message = "Could not copy. Try again or select the flag text to copy manually.";
  }
  if (state.flagCopy === copy) $.ui.invalidate("ui.render");
}

function feedbackId(flag) { return JSON.stringify([flag.kind, flag.text, flag.evidence]); }

function validFeedback(value) {
  return Array.isArray(value) ? value.filter(item => item && ["good", "bad"].includes(item.rating)
    && typeof item.note === "string" && item.flag && Object.hasOwn(kinds, item.flag.kind)
    && [item.flag.key, item.flag.text, item.flag.evidence].every(field => typeof field === "string" && field.trim())) : [];
}

async function editFeedback($, state, flag, rating) {
  if (state.feedbackDraft?.saving || state.feedbackBusy) return;
  const saved = state.feedback.find(item => feedbackId(item.flag) === feedbackId(flag));
  const { key, kind, text, evidence } = flag;
  state.feedbackDraft = { flag: { key, kind, text, evidence }, rating, note: saved?.note || "", saving: false, error: "" };
  $.ui.invalidate("ui.render");
  await $.ui.open({ ...pane, focus: true });
  try { await $.ui.focus({ requestId: pane.id, key: "buddy-feedback-note" }); }
  catch { /* Hosts without element focus still expose the clickable note field. */ }
}

async function rateFlag($, state, flag, rating) {
  const { key, kind, text, evidence } = flag;
  return saveFeedback($, state, { flag: { key, kind, text, evidence }, rating }, true);
}

async function saveFeedback($, state, draft, dismiss = false) {
  if ((!dismiss && state.feedbackDraft !== draft) || draft.saving || state.feedbackBusy) return;
  draft.saving = true; draft.error = "";
  state.feedbackBusy = true; state.feedbackError = "";
  $.ui.invalidate("ui.render");
  try {
    const saved = validFeedback(await $.store.get("flagFeedback"));
    // A quick rating preserves any note already saved for this example.
    const note = draft.note ?? saved.find(item => feedbackId(item.flag) === feedbackId(draft.flag))?.note ?? "";
    const entry = { flag: draft.flag, rating: draft.rating, note: cleanText(note).trim(), at: await now($) };
    const feedback = [...saved.filter(item => feedbackId(item.flag) !== feedbackId(entry.flag)), entry];
    await $.store.set("flagFeedback", feedback);
    state.feedback = feedback;
    state.promptCopy = null;
    state.feedbackVersion++;
    // A review already in flight has not seen this calibration. Its progress
    // can finish, but new flags wait for a review that has seen the feedback.
    if (state.auto) state.revision++;
    if (dismiss) dismissFlag($, state, draft.flag);
    if (state.feedbackDraft === draft) state.feedbackDraft = null;
  } catch {
    if (state.feedbackDraft === draft) draft.error = "Could not save feedback. Your note is still here; try again.";
    else state.feedbackError = "Could not save feedback. Click Good or Bad to try again.";
  } finally {
    draft.saving = false;
    state.feedbackBusy = false;
  }
  $.ui.invalidate("ui.render");
}

function renderFeedbackEditor($, e, state, cols) {
  const { Box, Text, Input, Button } = $.ui.resolve(e);
  const draft = state.feedbackDraft;
  const save = () => saveFeedback($, state, draft);
  return Box({ key: "buddy-feedback", flexDirection: "column", marginTop: 1, children: [
    Text({ bold: true, children: `${draft.rating === "good" ? "Good" : "Bad"} flag · optional note` }),
    Text({ dimColor: true, children: clip(draft.flag.text, cols - 2) }),
    Box({ flexDirection: "row", gap: 1, children: ["good", "bad"].map(rating => Button({
      key: `buddy-feedback-${rating}`, label: `${draft.rating === rating ? "✓ " : ""}${rating === "good" ? "Good" : "Bad"}`,
      onPress: () => { if (!draft.saving) { draft.rating = rating; return saveFeedback($, state, draft, true); } },
    })) }),
    Input({ key: "buddy-feedback-note", value: draft.note, autoFocus: true,
      placeholder: draft.rating === "good" ? "What was useful? (optional)" : "What was unhelpful? (optional)", submitLabel: "save note",
      onInput: value => { if (!draft.saving) { draft.note = value; $.ui.invalidate("ui.render"); } },
      onSubmit: value => { if (!draft.saving) { draft.note = value; return save(); } },
    }),
    Text({ dimColor: true, children: draft.saving ? "Saving…" : "Press Enter to save the note." }),
    ...(draft.error ? [Text({ color: "yellow", children: draft.error })] : []),
  ] });
}

async function openSavedFeedback($, state) {
  const feedback = validFeedback(await $.store.get("flagFeedback"));
  if (JSON.stringify(feedback) !== JSON.stringify(state.feedback)) {
    state.feedback = feedback; state.feedbackVersion++; state.promptCopy = null;
    if (state.auto) state.revision++;
  }
  state.feedbackError = "";
  go($, state, "feedback");
  try { await $.ui.scroll({ in: pane.id, to: "start" }); } catch { /* The pane remains navigable. */ }
}

async function deleteFeedback($, state, entry) {
  if (state.feedbackBusy || state.feedbackDraft?.saving) return;
  state.feedbackBusy = true; state.feedbackError = "";
  try {
    const saved = validFeedback(await $.store.get("flagFeedback"));
    const feedback = saved.filter(item => feedbackId(item.flag) !== feedbackId(entry.flag));
    await $.store.set("flagFeedback", feedback);
    state.feedback = feedback; state.feedbackVersion++; state.promptCopy = null;
    if (state.auto) state.revision++;
    if (state.feedbackDraft && feedbackId(state.feedbackDraft.flag) === feedbackId(entry.flag)) state.feedbackDraft = null;
  } catch { state.feedbackError = "Could not delete feedback. Try again."; }
  state.feedbackBusy = false;
  $.ui.invalidate("ui.render");
}

function guidanceText(state) {
  return `${observer}\n\n${summarizePrompt}\n\n${JSON.stringify({
    activityLogEnabled: state.prefs.activityLog,
    knownTopics: state.known,
    flagFeedback: state.feedback.map(({ rating, note, flag }) => ({ rating, note, flag })),
  }, null, 2)}`;
}

async function copyPromptPath($, state, surface) {
  const copy = { message: "Exporting prompt…", error: false };
  state.promptCopy = copy;
  $.ui.invalidate("ui.render");
  try {
    const config = await $.env.get("CLAUDE_CONFIG_DIR") || `${await $.env.get("HOME")}/.claude`;
    const path = `${config}/buddy/review-guidance.txt`;
    const preamble = "Claude Buddy review instructions and saved guidance\nSnapshot exported from Settings. Each review also receives the current session transcript, flags, and progress. Editing this snapshot does not change Buddy; edit saved feedback in Settings.\n\n";
    await $.fs.write(path, preamble + guidanceText(state) + "\n");
    const result = await $.ui.copy({ text: path, surface });
    copy.error = !result.isCopied;
    copy.message = result.isCopied ? `Path copied: ${path}` : `Exported to ${path}. Could not copy; select the path to copy it.`;
  } catch { copy.error = true; copy.message = "Could not export or copy the prompt path. Try again."; }
  $.ui.invalidate("ui.render");
}

function promptCopyStatus(ui, state) {
  return state.promptCopy ? [ui.Text({ color: state.promptCopy.error ? "yellow" : "green", children: state.promptCopy.message })] : [];
}

function renderSavedFeedback($, e, state, cols) {
  const ui = $.ui.resolve(e);
  const { Box, Text, Button } = ui;
  const children = [
    Text({ bold: true, children: `Saved feedback (${state.feedback.length})` }),
    Box({ flexDirection: "row", flexWrap: "wrap", gap: 1, children: [
      Button({ key: "buddy-feedback-back", label: "Back to Settings", onPress: () => go($, state, "settings") }),
      Button({ key: "buddy-view-prompt", label: "View prompt", onPress: () => go($, state, "prompt") }),
      Button({ key: "buddy-copy-prompt-path", label: "Copy path", onPress: press => copyPromptPath($, state, press.surface) }),
    ] }),
    Text({ dimColor: true, children: "All saved ratings and notes for this profile. Copy path exports the review instructions and saved guidance." }),
    ...promptCopyStatus(ui, state),
    ...(state.feedbackError ? [Text({ color: "yellow", children: state.feedbackError })] : []),
    ...(state.feedbackDraft ? [renderFeedbackEditor($, e, state, cols)] : []),
  ];
  if (!state.feedback.length) children.push(Text({ dimColor: true, children: "No saved feedback yet. Use Good or Bad on a flag." }));
  [...state.feedback].reverse().forEach((entry, index) => {
    children.push(Box({ flexDirection: "column", marginTop: 1, children: [
      Text({ bold: true, color: entry.rating === "good" ? "green" : "red", children: entry.rating === "good" ? "Good" : "Bad" }),
      ...blocks(ui, entry.flag.text),
      Text({ dimColor: true, children: `Evidence: ${entry.flag.evidence}` }),
      Text({ children: entry.note ? `Note: ${entry.note}` : "No note." }),
      Box({ flexDirection: "row", gap: 1, children: [
        Button({ key: `feedback-edit:${index}`, label: "Edit", onPress: () => editFeedback($, state, entry.flag, entry.rating) }),
        Button({ key: `feedback-delete:${index}`, label: "Delete", onPress: () => deleteFeedback($, state, entry) }),
      ] }),
    ] }));
  });
  return Box({ flexDirection: "column", gap: 1, children });
}

function renderPrompt($, e, state) {
  const ui = $.ui.resolve(e);
  return ui.Box({ flexDirection: "column", gap: 1, children: [
    ui.Text({ bold: true, children: "Review instructions & saved guidance" }),
    ui.Box({ flexDirection: "row", flexWrap: "wrap", gap: 1, children: [
      ui.Button({ key: "buddy-prompt-back", label: "Back to saved feedback", onPress: () => go($, state, "feedback") }),
      ui.Button({ key: "buddy-copy-prompt-path", label: "Copy path", onPress: press => copyPromptPath($, state, press.surface) }),
    ] }),
    ui.Text({ dimColor: true, children: "These are the review instructions and saved preferences used by Buddy. Each review also receives the current transcript, open flags, and progress. Copy path exports this view as a readable snapshot." }),
    ...promptCopyStatus(ui, state),
    ui.Text({ children: guidanceText(state) }),
  ] });
}

function dismissFlag($, state, flag, markKnown = false) {
  if (markKnown) state.known.push(flag.text);
  const { at, ...dismissed } = flag;
  state.dismissed.push(dismissed);
  state.flags = state.flags.filter(item => !repeatsDismissedFlag(item, [dismissed]));
  state.flagCopy = null;
  if (state.auto) state.revision++;
  $.ui.invalidate("ui.render");
  return markKnown ? $.store.set("known", state.known) : undefined;
}

function renderFlags($, e, state, cols) {
  const ui = $.ui.resolve(e);
  const { Box, Text, Button } = ui;
  const list = [...state.flags].reverse();
  if (!list.length) return Box({ flexDirection: "column", children: [Box({ height: 1 }), Text({ dimColor: true, children: "Nothing needs your attention right now." })] });
  state.flagIndex = Math.min(Math.max(0, state.flagIndex), list.length - 1);
  const flag = list[state.flagIndex];
  const kind = kinds[flag.kind];
  const feedback = state.feedback.find(item => feedbackId(item.flag) === feedbackId(flag));
  const move = step => { state.flagIndex = (state.flagIndex + step + list.length) % list.length; $.ui.invalidate("ui.render"); };
  const rows = [
    Box({ flexDirection: "row", justifyContent: "space-between", children: [
      Box({ flexDirection: "row", gap: 1, children: list.length > 1 ? [
        Button({ key: "buddy-flag-prev", plain: true, label: "‹", onPress: () => move(-1) }),
        Text({ children: `${state.flagIndex + 1} / ${list.length}` }),
        Button({ key: "buddy-flag-next", plain: true, label: "›", onPress: () => move(1) }),
      ] : [Text({ dimColor: true, children: "1 / 1" })] }),
      Text({ dimColor: true, children: clock(flag.at) }),
    ] }),
    Box({ flexDirection: "column", borderStyle: "round", borderColor: kind.color, paddingX: 1, children: [
      Text({ bold: true, color: kind.color, children: kind.label }),
      Box({ height: 1 }),
      ...blocks(ui, flag.text),
      ...(oneLine(flag.evidence) === oneLine(flag.text) || flag.text.includes(oneLine(flag.evidence)) ? [] : [Box({ height: 1 }), Text({ dimColor: true, children: `"${clip(flag.evidence, (cols - 6) * 2)}"` })]),
    ] }),
    Box({ flexDirection: "row", gap: 2, paddingLeft: 1, children: [
      Button({ key: `explain:${flag.key}`, label: "Explain", onPress: () => ask($, state, `Explain this observation and its consequence: ${flag.text}`) }),
      Button({ key: `dismiss:${flag.key}`, label: "Dismiss", onPress: () => dismissFlag($, state, flag) }),
      ...(flag.kind !== "insight" ? [] : [Button({ key: `known:${flag.key}`, label: "I know this", onPress: () => dismissFlag($, state, flag, true) })]),
    ] }),
    Box({ flexDirection: "column", paddingLeft: 1, children: [
      Button({ key: `copy:${flag.key}`, label: "Copy to clipboard", onPress: press => copyFlag($, state, flag, press.surface) }),
      ...(state.flagCopy?.key !== flag.key ? [] : [Text({ color: state.flagCopy.isError ? "yellow" : "green", children: state.flagCopy.message })]),
    ] }),
    Box({ flexDirection: "row", flexWrap: "wrap", gap: 1, paddingLeft: 1, children: [
      Button({ key: `good:${flag.key}`, label: `${feedback?.rating === "good" ? "✓ " : ""}Good`, color: "green", onPress: () => rateFlag($, state, flag, "good") }),
      Button({ key: `bad:${flag.key}`, label: `${feedback?.rating === "bad" ? "✓ " : ""}Bad`, color: "red", onPress: () => rateFlag($, state, flag, "bad") }),
    ] }),
    ...(feedback ? [Text({ dimColor: true, children: feedback.note ? `Saved note: ${feedback.note}` : "Feedback saved for future flags." })] : []),
  ];
  const others = list.map((item, index) => [item, index]).filter(([, index]) => index !== state.flagIndex).slice(0, 4);
  if (others.length) {
    rows.push(Box({ height: 1 }), Text({ dimColor: true, children: "Also open" }));
    for (const [item, index] of others) rows.push(Box({ paddingLeft: 1, children: [gutter(ui, Text({ color: kinds[item.kind].color, children: kinds[item.kind].glyph }),
      Button({ key: `buddy-flag-go:${item.key}`, plain: true, dimColor: true, label: clip(item.text, cols - 4), onPress: () => { state.flagIndex = index; $.ui.invalidate("ui.render"); } }))] }));
  }
  return Box({ flexDirection: "column", children: rows });
}

function renderChat($, e, state, cols, rows) {
  const ui = $.ui.resolve(e);
  const { Box, Text, Button } = ui;
  const width = cols - 2;
  const items = [];
  for (let i = 0; i + 1 < state.history.length; i += 2) items.push({ question: state.history[i].text, answer: state.history[i + 1].text });
  if (state.chat) items.push({ question: state.chat.question, pending: true });
  for (const question of state.chatQueue) items.push({ question, queued: true });
  if (!items.length) return Box({ flexDirection: "column", children: [Text({ dimColor: true, children: "Ask about what Claude is doing. Replies stay out of the main conversation." })] });
  const height = item => rowsOf(item.question, width) + (item.answer ? rowsOf(item.answer, width) + 1 : item.pending ? 2 : 0) + 1;
  const budget = Math.max(4, rows - 8);
  const pages = [];
  let current = [], used = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const need = height(items[i]);
    if (current.length && used + need > budget) { pages.unshift(current); current = []; used = 0; }
    current.unshift(items[i]); used += need;
  }
  pages.unshift(current);
  state.chatPage = Math.min(Math.max(0, state.chatPage), pages.length - 1);
  const shown = pages[pages.length - 1 - state.chatPage];
  const older = pages.slice(0, pages.length - 1 - state.chatPage).reduce((n, page) => n + page.length, 0);
  const turn = step => { state.chatPage = Math.min(Math.max(0, state.chatPage + step), pages.length - 1); if (state.chatPage === 0) delete state.unseen.chat; $.ui.invalidate("ui.render"); };
  const nav = [];
  if (older) nav.push(Button({ key: "buddy-chat-older", plain: true, dimColor: true, label: `‹ older · ${older} more`, onPress: () => turn(1) }));
  if (state.chatPage > 0) nav.push(Button({ key: "buddy-chat-newer", plain: true, dimColor: true, label: "newer ›", onPress: () => turn(-1) }));
  if (state.chatPage > 0 && state.unseen.chat) nav.push(Button({ key: "buddy-chat-latest", plain: true, label: "↓ new reply", onPress: () => turn(-state.chatPage) }));
  // One blank row between exchanges, none before the first or after the last; the pager row only when it has buttons.
  const children = nav.length ? [Box({ flexDirection: "row", gap: 2, justifyContent: "flex-end", marginBottom: 1, children: nav })] : [];
  shown.forEach((item, index) => {
    children.push(Box({ flexDirection: "column", marginTop: index ? 1 : 0, children: [
      gutter(ui, Text({ color: "cyan", bold: true, children: "›" }), Box({ flexDirection: "row", gap: 1, children: [Text({ bold: true, children: cleanText(item.question) }), ...(item.queued ? [Text({ dimColor: true, children: "· queued" })] : [])] })),
      ...(item.pending ? [Box({ marginTop: 1, paddingLeft: 2, children: [Text({ dimColor: true, children: "◐ thinking…" })] })]
        : item.answer ? [Box({ marginTop: 1, children: [gutter(ui, Text({ color: "magenta", children: "◆" }), blocks(ui, item.answer))] })] : []),
    ] }));
  });
  return Box({ flexDirection: "column", children });
}

function renderLog($, e, state) {
  const ui = $.ui.resolve(e);
  const { Box, Text } = ui;
  if (!state.updates.length) return Box({ flexDirection: "column", children: [Box({ height: 1 }), Text({ dimColor: true, children: "No summaries yet." })] });
  const children = [Text({ dimColor: true, children: `Last ${state.updates.length} ${state.updates.length === 1 ? "summary" : "summaries"} · newest first` }), Box({ height: 1 })];
  for (const update of [...state.updates].reverse()) {
    children.push(gutter(ui, Text({ dimColor: true, children: clock(update.at) || "   —   " }), gutter(ui, Text({ color: "cyan", children: "◆" }), blocks(ui, update.text)), 10), Box({ height: 1 }));
  }
  return Box({ flexDirection: "column", children });
}

async function loadCatalog($, state) {
  state.catalog = [];
  state.catalogLoaded = true;
  state.catalogStatus = "Model catalog unavailable; showing built-in model choices.";
  try {
    const config = await $.env.get("CLAUDE_CONFIG_DIR") || `${await $.env.get("HOME")}/.claude`;
    const folder = `${config}/cache/model-catalog`;
    const files = (await $.fs.list(folder)).filter(file => file.kind === "file" && file.name.endsWith("-cc.json")).sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const file of files.slice(0, 5)) {
      const cached = JSON.parse(await $.fs.read(`${folder}/${file.name}`));
      if (cached.catalog?.surface !== "cc" || !Array.isArray(cached.catalog?.config?.models)) continue;
      state.catalog = cached.catalog.config.models.filter(model => typeof model.id === "string" && typeof model.name === "string").map(model => ({
        id: model.id, name: model.name, note: model.badge?.message || model.notice?.text || "",
        efforts: model.thinking?.type === "none" ? [] : model.thinking?.effort_options?.map(option => option.id),
      }));
      state.catalogStatus = "Claude Code's cached account catalog. Availability is checked by Claude when you send.";
      break;
    }
  } catch { /* The model cache is optional; aliases and exact IDs still work. */ }
}

function choiceButtons(ui, key, label, options, selected, onSelect) {
  const { Box, Text, Button } = ui;
  return Box({ key, flexDirection: "column", children: [
    Text({ children: label }),
    Box({ flexDirection: "row", flexWrap: "wrap", gap: 1, children: options.map(({ value, label }) => Button({
      key: `${key}-${value}`, label: `${value === selected ? "✓ " : ""}${label || value}`,
      color: value === selected ? "green" : undefined,
      onPress: () => value === selected ? undefined : onSelect(value),
    })) }),
  ] });
}

async function renderSettings($, e, state) {
  const ui = $.ui.resolve(e);
  const { Box, Text, Button } = ui;
  if (!state.catalogLoaded) await loadCatalog($, state);
  const mainModel = await $.session.model();
  const selected = state.catalog.find(model => model.id === state.prefs.model);
  const back = () => go($, state, state.previousPage);
  return Box({ flexDirection: "column", gap: 1, children: [
    Text({ bold: true, children: "Buddy settings" }),
    Button({ key: "buddy-saved-feedback", label: `Saved feedback & prompt (${state.feedback.length})`, onPress: () => openSavedFeedback($, state) }),
    choiceButtons(ui, "buddy-mode", "Mode", [{ value: "companion", label: "Companion" }, { value: "chat", label: "Chat only (BTW)" }], state.prefs.mode, mode => save($, state, { mode })),
    Text({ dimColor: true, children: state.prefs.mode === "chat" ? "Only answers when you ask. No automatic summaries or alerts." : state.prefs.activityLog ? "Automatic summaries and important-event alerts, plus side chat." : "Automatic flags and side chat. Activity and log are off." }),
    choiceButtons(ui, "buddy-activity-log", "Activity & log", [{ value: true, label: "On" }, { value: false, label: "Off" }], state.prefs.activityLog, activityLog => save($, state, { activityLog })),
    Text({ children: `Selected model: ${state.prefs.model === "main" ? mainModel + " (following Claude)" : state.prefs.model}` }),
    choiceButtons(ui, "buddy-model", "Model", latestModels(state.catalog).map(model => ({ value: model.id, label: model.name })), state.prefs.model, model => {
      const entry = state.catalog.find(item => item.id === model);
      const unsupportedEffort = entry?.efforts && !entry.efforts.includes(state.prefs.effort);
      return save($, state, { model, ...(unsupportedEffort ? { effort: "default" } : {}) });
    }),
    ...(selected?.note ? [Text({ dimColor: true, children: selected.note })] : []),
    Text({ dimColor: true, children: state.prefs.model === "main" && state.prefs.effort === "default" ? "Full inherited session context + latest text updates" : "Current text transcript + session instructions; no image blocks" }),
    ...(selected?.efforts?.length === 0 ? [Text({ dimColor: true, children: "Thinking effort: this model does not offer an effort control." })]
      : [choiceButtons(ui, "buddy-effort", "Thinking effort", ["default", ...(selected?.efforts || ["low", "medium", "high", "xhigh", "max"])].map(value => ({ value })), state.prefs.effort, effort => save($, state, { effort }))]),
    ...(state.prefs.mode === "chat" ? [] : [choiceButtons(ui, "buddy-cadence", "Routine updates", ["10", "30", "60", "120"].map(value => ({ value, label: `${value} sec` })), state.prefs.cadence, cadence => save($, state, { cadence }))]),
    choiceButtons(ui, "buddy-style", "Chat replies", ["concise", "balanced", "detailed"].map(value => ({ value })), state.prefs.replyStyle, replyStyle => save($, state, { replyStyle })),
    Text({ dimColor: true, children: "Settings are saved for this Claude profile. Chat keeps the latest main-session context in either mode." }),
    Box({ flexDirection: "row", flexWrap: "wrap", gap: 1, children: [
      Button({ key: "buddy-done", label: "Back to Buddy", onPress: back }),
      Button({ key: "buddy-defaults", label: "Restore defaults", onPress: () => save($, state, { ...defaults, enabled: state.enabled, favorites: state.prefs.favorites }) }),
      Button({ key: "buddy-settings-off", label: "Off", onPress: () => toggle($, state, false) }),
    ] }),
    ...(state.settingsError ? [Text({ color: "yellow", children: state.settingsError })] : []),
  ] });
}
