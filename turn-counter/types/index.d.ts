export type TurnCount = number;

declare module "claude-code" {
  interface PluginState {
    "turn-counter": { turns: TurnCount };
  }
}
