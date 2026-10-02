const pane = { id: "sidebar-controls", title: "Mod controls", columns: 28, rows: 3 };

export function register(on) {
  // Compute visibility from the host instead of storing a flag that could outlive this plugin.
  on("state.get", { plugin: "sidebar-controls", key: "visible" }, async ($) => {
    const visible = (await $.ui.panes()).some(item => item.id === pane.id && item.isPlaced);
    return { value: { value: visible, version: 0 } };
  });

  on("session.start", async ($, e, next) => {
    const result = await next(e);
    await $.command.register({ name: "sidebar-controls", description: "Open or close the mod controls sidebar", argumentHint: "[on|off]", immediate: true });
    await $.ui.open(pane);
    $.ui.invalidate("ui.render");
    return result;
  });

  on("command.run", { command: "sidebar-controls" }, async ($, e) => {
    const arg = e.args.trim().toLowerCase();
    if (arg && arg !== "on" && arg !== "off") return { text: "Usage: /sidebar-controls [on|off]" };
    const isOpen = (await $.ui.panes()).some(item => item.id === pane.id);
    const open = arg ? arg === "on" : !isOpen;
    if (open) await $.ui.open(pane);
    else await $.ui.close({ id: pane.id });
    $.ui.invalidate("ui.render");
    return { text: open ? "Mod controls sidebar open." : "Mod controls returned above the prompt." };
  });

  on("ui.close", { id: "sidebar-controls" }, async ($, e, next) => {
    const result = await next(e);
    $.ui.invalidate("ui.render");
    return result;
  });

  on("ui.render", { component: "Pane", requestId: "sidebar-controls" }, async ($, e, next) => {
    const original = await next(e);
    return $.ui.resolve(e).Box({ flexDirection: "column", children: [original] });
  });

  // Include the original control band when a pane open/close invalidates this mod's sites.
  on("ui.render", { component: "AbovePrompt" }, ($, e, next) => next(e));
}
