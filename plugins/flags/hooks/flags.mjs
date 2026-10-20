import { observer, reviewPrompt, contextMessages, latestMessages, evidenceText, parseReview, validFlag, repeatsDismissedFlag, cleanText } from "./context.mjs";
import { latestModels } from "./models.mjs";

const pane = { id: "flags", title: "Flags", columns: 54, rows: 22 };
const defaults = { enabled: true, model: "main", effort: "default", cadence: "30" };
const labels = { attention: "Heads up", decision: "Your decision", insight: "You should know", uncertain: "Uncertain" };
const supported = surface => surface === "terminal" || surface === "desktop";
const redraw = $ => $.ui.invalidate("ui.render");
const recordKey = (scope, flag) => `flag:${JSON.stringify([scope, flag.key, flag.text, flag.evidence])}`;

export function register(on) {
  const s = { prefs: null, loading: null, scope: "", records: [], flags: [], context: [], page: "flags", error: "", notice: "",
    timer: null, request: null, revision: 0, reviewed: -1, snapshot: null, generation: 0, writing: false,
    desktop: false, headless: false, spacePaused: false, layout: null, layoutTimer: null, dockColumns: 0, catalog: [] };

  on("session.start", async ($, e, next) => {
    const result = await next(e);
    await load($, s);
    await $.command.register({ name: "flags", description: "Open the flags sidebar", argumentHint: "[on|off|settings|check]", immediate: true });
    await surfaces($, s, true);
    return result;
  });
  on("session.attach", async ($, e, next) => {
    const result = await next(e); await load($, s); await surfaces($, s, true); return result;
  });
  on("session.detach", async ($, e, next) => {
    const result = await next(e); await load($, s); await surfaces($, s, false); return result;
  });
  on("session.end", ($, e, next) => {
    stop(s); s.flags = []; s.snapshot = null; s.context = []; s.reviewed = -1; return next(e);
  });
  on("prompt.context", async ($, e, next) => {
    const result = await next(e); s.context = result.blocks; return result;
  });
  on("turn.start", async ($, e, next) => {
    const result = await next(e); if (!e.agentId) { await load($, s); changed($, s); } return result;
  });
  on("session.append", async ($, e, next) => {
    const result = await next(e);
    if (!e.agentId && !result.deny && e.origin.kind !== "plugin" && ["user", "assistant", "attachment"].includes(result.message.type)) {
      await load($, s); changed($, s);
    }
    return result;
  });
  on("turn.complete", async ($, e, next) => {
    const result = await next(e); if (!e.agentId) { await load($, s); changed($, s, true); } return result;
  });
  on("command.run", { command: "flags" }, async ($, e) => {
    await load($, s);
    const arg = e.args.trim();
    if (!["", "on", "off", "settings", "check"].includes(arg)) return { text: "Usage: /flags [on|off|settings|check]" };
    if (arg === "off") { await toggle($, s, false); return {}; }
    await toggle($, s, true);
    s.page = arg === "settings" ? "settings" : "flags";
    if (arg === "settings") await catalog($, s);
    if (arg === "check") { s.revision++; await review($, s, true); }
    redraw($);
    return s.spacePaused ? { text: "Flags will resume when the fullscreen terminal has room for a side panel." } : {};
  });
  on("ui.close", { id: "flags" }, async ($, e, next) => {
    const result = await next(e);
    if (e.origin.kind === "person") { await load($, s); await save($, s, { enabled: false }); stop(s); }
    return result;
  });
  // Watch layout, never transcript rows. Hovering the panel does not read files,
  // call a model, or invalidate unrelated message components.
  on("ui.render", { component: ["AbovePrompt", "PromptHint", "Pane"] }, async ($, e, next) => {
    if (supported(e.surface)) { await load($, s); layout($, s, e); }
    return next(e);
  });
  on("ui.render", { component: "Pane", requestId: "flags" }, async ($, e, next) => {
    if (!supported(e.surface)) return next(e);
    await load($, s);
    return s.spacePaused ? $.ui.resolve(e).Box({}) : render($, e, s);
  });
}

async function load($, s) {
  if (s.prefs) return;
  if (s.loading) return s.loading;
  s.loading = (async () => {
    const prefs = await $.store.get("settings");
    s.scope = await $.session.cwd();
    await records($, s);
    s.prefs = { ...defaults,
      enabled: typeof prefs?.enabled === "boolean" ? prefs.enabled : true,
      model: typeof prefs?.model === "string" && prefs.model.trim() ? prefs.model : "main",
      effort: ["default", "low", "medium", "high", "xhigh", "max"].includes(prefs?.effort) ? prefs.effort : "default",
      cadence: ["10", "30", "60", "120"].includes(prefs?.cadence) ? prefs.cadence : "30" };
  })();
  try { await s.loading; } finally { s.loading = null; }
}

async function records($, s) {
  const all = [];
  for (const key of await $.store.keys()) {
    if (!key.startsWith("flag:")) continue;
    const value = await $.store.get(key);
    if (value && validFlag(value.flag) && typeof value.scope === "string" && ["good", "bad", "dismiss"].includes(value.action)) all.push({ ...value, storeKey: key });
  }
  s.records = all;
}
const dismissed = s => s.records.filter(r => r.scope === s.scope).map(r => r.flag);
const feedback = s => s.records.filter(r => r.action !== "dismiss").map(r => ({ rating: r.action, flag: r.flag }));

function stop(s) {
  s.timer?.cancel(); s.timer = null;
  s.layoutTimer?.cancel(); s.layoutTimer = null;
  s.request = null; s.generation++;
}
async function save($, s, change) {
  try {
    const prefs = { ...s.prefs, ...change };
    await $.store.set("settings", prefs);
    s.prefs = prefs; s.error = ""; s.generation++;
    return true;
  } catch { s.error = "Could not save settings. Try again."; return false; }
  finally { redraw($); }
}
async function toggle($, s, enabled) {
  if (s.prefs.enabled !== enabled && !await save($, s, { enabled })) return;
  if (!enabled) { stop(s); await $.ui.close({ id: pane.id }); }
  else if (!s.spacePaused && !s.headless) { await $.ui.open({ ...pane, focus: true }); schedule($, s, 1000); }
  redraw($);
}
async function surfaces($, s, open) {
  const active = await $.session.surfaces();
  const wasHeadless = s.headless, wasDesktop = s.desktop;
  s.desktop = active.includes("desktop"); s.headless = !active.some(supported);
  if (s.desktop || wasDesktop) { s.layoutTimer?.cancel(); s.layoutTimer = null; s.layout = null; s.dockColumns = 0; s.spacePaused = false; }
  if (s.headless) stop(s);
  else if (s.prefs.enabled && !s.spacePaused) {
    if (open && (!wasDesktop || wasHeadless)) await $.ui.open(pane);
    schedule($, s, 1000);
  }
}
function layout($, s, e) {
  if (e.surface === "desktop") {
    s.desktop = true; s.headless = false; s.spacePaused = false;
    s.layoutTimer?.cancel(); s.layoutTimer = null; s.layout = null; return;
  }
  if (s.desktop) return;
  if (e.component === "Pane") s.dockColumns = e.props.placement === "dock" ? (e.props.bodyColumns || 0) + 1 : 0;
  const own = e.component === "Pane" && e.requestId === pane.id;
  const inline = own && e.props.placement === "inline";
  if (own && (!inline || s.spacePaused)) return;
  if (!own && !["AbovePrompt", "PromptHint"].includes(e.component)) return;
  if ((typeof e.viewport?.isFullscreen !== "boolean" || !e.viewport.columns) && !inline) return;
  const columns = (e.viewport?.columns || 0) + (e.viewport?.isFullscreen ? s.dockColumns : 0);
  const key = `${e.viewport?.isFullscreen}:${columns}:${inline}`;
  if (s.layout?.key === key) return;
  const fits = !inline && e.viewport?.isFullscreen === true && columns >= 110;
  s.layout = { key, fits };
  s.layoutTimer?.cancel(); s.layoutTimer = null;
  if (!fits) { s.spacePaused = true; s.timer?.cancel(); s.timer = null; s.request = null; s.generation++; }
  if (!s.prefs.enabled || (fits && !s.spacePaused)) return;
  const current = s.layout;
  s.layoutTimer = $.clock.after(0, async () => {
    s.layoutTimer = null;
    if (!s.prefs.enabled || s.layout !== current) return;
    if (!fits) await $.ui.close({ id: pane.id });
    else if ((await $.ui.open(pane)).isPlaced && s.layout === current) { s.spacePaused = false; schedule($, s, 1000); }
    redraw($);
  });
}
function changed($, s, urgent = false) { s.revision++; schedule($, s, urgent ? 1000 : Number(s.prefs.cadence) * 1000, urgent); }
function schedule($, s, delay, urgent = false) {
  if (!s.prefs.enabled || s.headless || s.spacePaused || s.request || s.revision <= s.reviewed) return;
  if (s.timer && !urgent) return;
  s.timer?.cancel();
  s.timer = $.clock.after(delay, () => { s.timer = null; return review($, s); });
}

async function review($, s, force = false) {
  if (!s.prefs.enabled || s.headless || s.spacePaused || s.request || s.writing || (!force && s.revision <= s.reviewed)) return;
  s.timer?.cancel(); s.timer = null;
  const request = { revision: s.revision, generation: s.generation };
  s.request = request;
  try {
    const messages = await $.session.messages();
    if (!messages.some(m => m.text.trim() || m.toolUses.length || m.toolResults?.length)) return;
    const snapshot = JSON.stringify(contextMessages(messages));
    if (!force && snapshot === s.snapshot) return;
    await records($, s);
    const existing = [...s.flags];
    const custom = s.prefs.model !== "main" || s.prefs.effort !== "default";
    const data = { ...(custom ? { mainConversation: contextMessages(messages), sessionContext: s.context } : { mainSessionUpdates: latestMessages(messages) }),
      openFlags: existing, dismissed: dismissed(s), flagFeedback: feedback(s) };
    const prompt = `${observer}\n\n${reviewPrompt}\n\n${JSON.stringify(data)}`;
    if (s.request !== request || request.generation !== s.generation) return;
    // Mark the attempted snapshot too: errors do not create paid idle retries.
    s.snapshot = snapshot;
    let reply;
    if (custom) {
      const model = s.prefs.model === "main" ? await $.session.model() : s.prefs.model;
      const system = await $.prompt.compose();
      if (s.request !== request || request.generation !== s.generation) return;
      reply = await $.model.complete({ model, prompt, system: `${system.sections.map(x => x.text).join("\n\n")}\n\n${observer}`, maxTokens: 4096,
        ...(s.prefs.effort === "default" ? {} : { effort: s.prefs.effort }) });
    } else reply = await $.model.fork({ prompt });
    if (s.request !== request || request.generation !== s.generation) return;
    if (!reply.isAnswered) { s.error = "Could not check flags. Try Check now."; return; }
    const result = parseReview(reply.text, evidenceText(messages, [], s.context), existing);
    // Refresh actions from other sessions before applying the reply.
    await records($, s);
    if (s.request !== request || request.generation !== s.generation || s.writing) return;
    s.flags = s.flags.filter(f => !result.resolved.some(r => r.key === f.key) && !repeatsDismissedFlag(f, dismissed(s)));
    for (const flag of result.flags) {
      if (!repeatsDismissedFlag(flag, dismissed(s)) && !s.flags.some(old => old.key === flag.key || old.text === flag.text)) s.flags.push(flag);
    }
    s.error = "";
  } catch { if (s.request === request) s.error = "Could not verify this review. Existing flags are still here; try Check now."; }
  finally {
    if (s.request === request) { s.reviewed = request.revision; s.request = null; schedule($, s, Number(s.prefs.cadence) * 1000); redraw($); }
  }
}

async function act($, s, flag, action) {
  if (s.writing || !s.flags.includes(flag)) return;
  s.writing = true; s.generation++; s.error = "";
  try {
    const entry = { scope: s.scope, flag, action };
    const key = recordKey(s.scope, flag);
    // One write commits both rating and dismissal. Independent keys prevent a
    // read/modify/write of an entire feedback array from losing another flag.
    await $.store.set(key, entry);
    s.records = [...s.records.filter(r => r.storeKey !== key), { ...entry, storeKey: key }];
    s.flags = s.flags.filter(f => f !== flag);
    s.notice = "";
  } catch { s.error = "Could not save this action. The flag is still here; try again."; }
  finally { s.writing = false; redraw($); }
}
async function copy($, s, text, surface) {
  try { s.notice = (await $.ui.copy({ text, surface })).isCopied ? "Copied." : "Could not copy. Try again."; }
  catch { s.notice = "Could not copy. Try again."; }
  redraw($);
}
function guidance(s) { return `${observer}\n\n${reviewPrompt}\n\n${JSON.stringify({ dismissed: dismissed(s), flagFeedback: feedback(s) }, null, 2)}`; }
async function exportPrompt($, s, surface) {
  try {
    const config = await $.env.get("CLAUDE_CONFIG_DIR") || `${await $.env.get("HOME")}/.claude`;
    const path = `${config}/flags/review-guidance.txt`;
    await $.fs.write(path, `Flags review guidance snapshot. Each review also receives the current conversation and open flags. Editing this export does not change the mod.\n\n${guidance(s)}\n`);
    const copied = (await $.ui.copy({ text: path, surface })).isCopied;
    s.notice = `${copied ? "Path copied" : "Exported"}: ${path}`;
  } catch { s.error = "Could not export the prompt. Try again."; }
  redraw($);
}
async function catalog($, s) {
  if (s.catalog.length) return;
  try {
    const config = await $.env.get("CLAUDE_CONFIG_DIR") || `${await $.env.get("HOME")}/.claude`;
    const dir = `${config}/cache/model-catalog`;
    const files = (await $.fs.list(dir)).filter(f => f.kind === "file" && f.name.endsWith("-cc.json")).sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const file of files.slice(0, 5)) {
      const cached = JSON.parse(await $.fs.read(`${dir}/${file.name}`));
      if (cached.catalog?.surface === "cc" && Array.isArray(cached.catalog?.config?.models)) {
        s.catalog = cached.catalog.config.models.filter(m => typeof m.id === "string" && typeof m.name === "string"); break;
      }
    }
  } catch { /* Cached catalog is optional. */ }
}

function render($, e, s) {
  const { Box, Text, Button } = $.ui.resolve(e);
  const row = children => Box({ flexDirection: "row", flexWrap: "wrap", gap: 1, children });
  const go = page => { s.page = page; s.notice = ""; redraw($); };
  const body = [];
  if (s.page === "flags") {
    body.push(row([Text({ bold: true, children: `Flags${s.flags.length ? ` (${s.flags.length})` : ""}` }),
      Button({ key: "settings", label: "Settings", onPress: async () => { await catalog($, s); go("settings"); } })]));
    if (!s.flags.length) body.push(Text({ dimColor: true, children: "No flags to review." }));
    for (const flag of s.flags) body.push(Box({ flexDirection: "column", gap: 1, ...(e.surface === "desktop" ? { borderStyle: "round", borderDimColor: true, padding: "sm" } : {}), children: [
      Text({ bold: true, children: labels[flag.kind] }), Text({ children: flag.text }), Text({ dimColor: true, children: flag.evidence }),
      row([Button({ key: `good:${flag.key}`, label: "Good", onPress: () => act($, s, flag, "good") }),
        Button({ key: `bad:${flag.key}`, label: "Bad", onPress: () => act($, s, flag, "bad") }),
        Button({ key: `dismiss:${flag.key}`, label: "Dismiss", onPress: () => act($, s, flag, "dismiss") }),
        Button({ key: `copy:${flag.key}`, label: "Copy", onPress: press => copy($, s, `${flag.text}\n\n${flag.evidence}`, press.surface) })]) ] }));
  } else {
    body.push(row([Button({ key: "back", label: "Back to flags", onPress: () => go("flags") }),
      Button({ key: "settings", label: "Settings", onPress: () => go("settings") })]));
    if (s.page === "settings") {
      const choice = (field, title, options) => Box({ flexDirection: "column", children: [Text({ bold: true, children: title }), row(options.map(o => Button({
        key: `${field}:${o.value}`, label: `${s.prefs[field] === o.value ? "✓ " : ""}${o.label}`,
        onPress: async () => { if (await save($, s, { [field]: o.value })) { s.timer?.cancel(); s.timer = null; schedule($, s, Number(s.prefs.cadence) * 1000); } } }))) ] });
      body.push(choice("model", "Model", [{ value: "main", label: "Follow Claude" }, ...latestModels(s.catalog).map(m => ({ value: m.id, label: m.name }))]),
        choice("effort", "Effort", ["default", "low", "medium", "high", "xhigh", "max"].map(value => ({ value, label: value }))),
        choice("cadence", "Check changed activity every", ["10", "30", "60", "120"].map(value => ({ value, label: `${value}s` }))),
        Text({ dimColor: true, children: "Checks use model usage. Unchanged activity does not trigger another check." }),
        row([Button({ key: "saved", label: "Saved feedback & dismissals", onPress: async () => { await records($, s); go("saved"); } }),
          Button({ key: "prompt", label: "View prompt", onPress: () => go("prompt") })]),
        row([Button({ key: "check", label: "Check now", onPress: async () => { s.revision++; await review($, s, true); } }),
          Button({ key: "off", label: "Turn off", onPress: () => toggle($, s, false) })]));
    } else if (s.page === "saved") {
      body.push(Text({ bold: true, children: `Saved feedback & dismissals (${s.records.length})` }));
      for (const r of s.records) body.push(Box({ flexDirection: "column", gap: 1, children: [
        Text({ bold: true, children: r.action === "dismiss" ? "Dismissed" : r.action === "good" ? "Good" : "Bad" }),
        Text({ children: r.flag.text }), Text({ dimColor: true, children: r.scope }),
        Button({ key: `forget:${r.storeKey}`, label: "Forget", onPress: async () => {
          if (s.writing) return; s.writing = true; s.generation++;
          try { await $.store.delete(r.storeKey); s.records = s.records.filter(x => x.storeKey !== r.storeKey); s.error = ""; }
          catch { s.error = "Could not forget this entry. Try again."; }
          finally { s.writing = false; redraw($); }
        } }) ] }));
    } else body.push(Text({ children: guidance(s) }), Button({ key: "copy-path", label: "Copy path", onPress: press => exportPrompt($, s, press.surface) }));
  }
  if (s.error) body.push(Text({ color: "red", children: s.error }));
  if (s.notice) body.push(Text({ dimColor: true, children: s.notice }));
  return Box({ flexDirection: "column", gap: 1, ...(e.surface === "desktop" ? { width: "100%", padding: "md", alignItems: "stretch" } : {}), children: body });
}
