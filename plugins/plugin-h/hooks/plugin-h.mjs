export function register(on) {
  let hidden = false;

  on("state.get", { plugin: "plugin-h", key: "hidden" }, () => ({ value: { value: hidden, version: 0 } }));

  on("session.start", async ($, e, next) => {
    const result = await next(e);
    hidden = (await $.store.get("hidden")) === true;
    await $.command.register({
      name: "plugin-h",
      description: "Hide or restore the bottom plugin strip, including its collapsed hint",
      argumentHint: "[hide|show|toggle]",
      immediate: true,
    });
    $.ui.invalidate("ui.render");
    return result;
  });

  on("command.run", { command: "plugin-h" }, async ($, e) => {
    const arg = e.args.trim().toLowerCase();
    if (!["", "hide", "show", "toggle"].includes(arg)) {
      return { text: "Usage: /plugin-h [hide|show|toggle]" };
    }
    const value = arg === "hide" ? true : arg === "show" ? false : !hidden;
    await $.store.set("hidden", value);
    hidden = value;
    $.ui.invalidate("ui.render");
    return { text: hidden ? "Bottom plugin strip hidden. /plugin-h restores it." : "Bottom plugin strip restored." };
  });

  on("ui.render", { component: "AbovePrompt" }, ($, e, next) => {
    if (!hidden || e.surface !== "terminal" || e.props.hasSurvey) return next(e);
    // An empty Box still counts as plugin content and retains the host's
    // collapse hint. Restore the native empty site instead. Dependencies
    // place this hook outside the installed mods that contribute controls.
    return { type: "engine", ref: 0 };
  });
}
