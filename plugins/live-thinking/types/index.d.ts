declare module "claude-code" {
  interface PluginState {
    "live-thinking": {
      enabled: boolean;
      preview: { text: string } | null;
    };
  }
}
