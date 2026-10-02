declare module "claude-code" {
  interface PluginState {
    "sidebar-controls": { visible: boolean };
    "live-thinking": {
      enabled: boolean;
      preview: { text: string } | null;
      anchor: { kind: "user" | "assistant" | "tool"; id: string } | null;
    };
  }
}
