# claude-mod

```sh
claude --plugin-dir ./turn-counter
claude plugin validate ./turn-counter
```

## danmaku

Claude の作業に合わせて、プロンプトの上にニコニコ風の弾幕コメントを流す mod。詳しくは [danmaku/README.md](./danmaku/README.md)。

入れ方（どのプロジェクトでも、ターミナルでも Claude Desktop の Code タブでも流れます）:

```sh
claude plugin marketplace add Akatsuki1910/claude-mod
claude plugin install danmaku@my-mods    # 起動したら /danmaku demo
```

開発するとき:

```sh
claude --plugin-dir ./danmaku
claude plugin validate ./danmaku
claude plugin test ./danmaku
```

## Link

<https://zenn.dev/nogu66/articles/claude-mods-complete-guide>
