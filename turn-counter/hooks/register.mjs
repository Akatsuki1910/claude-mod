// ホスト側に置く値。このファイルがホットリロードされても消えない
const turns = { plugin: "turn-counter", key: "turns" };

export function register(on) {
  on("turn.complete", async ($, e, next) => {
    const r = await next(e);
    if (!e.agentId) {
      // サブエージェントのターンは数えない
      const { value = 0 } = await $.state.get(turns);
      await $.state.set(turns, value + 1);
    }
    return r;
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const { value = 0 } = await $.state.get(turns); // 描画中のgetが、再描画の購読になる
    if (value === 0) return next(e);
    const { Text } = $.ui.resolve(e);
    return Text({
      dimColor: true,
      children: `ここまで ${value} ターン目`,
    });
  });
}
