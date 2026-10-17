declare module "claude-code" {
  interface PluginState {
    handoff: {
      launch: StateFamily<{ prompt: string; model: string; effort: string } | null>;
      agent: StateFamily<{ model: string; effort: string } | null>;
    };
  }
}
