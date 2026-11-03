// コメント職人。イベントから流すコメントを選ぶ。$ は使わない純粋関数だけ。
// 下の配列（ネタ帳）を書き換えれば好きなノリにできます。{file} などはその場の値に置き換わります。

import type { DanmakuPos } from '../types'

/**
 * これから流すコメントの下書き。key は同じネタかどうかを見分ける鍵で、
 * {file} などを埋める前・語尾のゆらぎを足す前の文（繰り返しを避けるときに使う）
 */
export type Draft = { text: string; color?: string | null; pos?: DanmakuPos; isBig?: boolean; key?: string }

/** 0以上1未満を返す乱数。テストでは固定値を渡す */
export type Rand = () => number

export type ColorName = 'white' | 'red' | 'pink' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple'

/** ニコニコのコマンド色。明るい背景でも暗い背景でも読める中間色にしてある（white は端末の既定色） */
export const COLORS: Readonly<Record<ColorName, string | null>> = {
  white: null,
  red: '#ff4d4f',
  pink: '#ff7eb6',
  orange: '#ff9f1a',
  yellow: '#e6c200',
  green: '#3cc85a',
  cyan: '#22b8cf',
  blue: '#4c7dff',
  purple: '#b26bff',
}

const { red, pink, orange, yellow, green, cyan, blue, purple } = COLORS

export function pick<T>(list: readonly T[], rand: Rand): T {
  const item = list[Math.min(list.length - 1, Math.floor(rand() * list.length))]
  if (item === undefined) throw new Error('pick: empty list')
  return item
}

/** list から重ならないように n 個選ぶ */
export function pickSome<T>(list: readonly T[], n: number, rand: Rand): T[] {
  const pool = [...list]
  const out: T[] = []
  while (out.length < n && pool.length > 0) {
    const i = Math.min(pool.length - 1, Math.floor(rand() * pool.length))
    out.push(pool.splice(i, 1)[0]!)
  }
  return out
}

export type Line = string | Draft

function draft(line: Line, vars: Record<string, string> = {}): Draft {
  const d = typeof line === 'string' ? { text: line } : line
  return { ...d, key: d.key ?? d.text, text: d.text.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '') }
}

/** 色のないコメントに、ときどき色を付ける */
const TINTS: ReadonlyArray<string | null> = [pink, orange, yellow, green, cyan, blue, purple]

function tint(d: Draft, rand: Rand, chance = 0.12): Draft {
  if ((d.color ?? null) !== null || rand() >= chance) return d
  return { ...d, color: pick(TINTS, rand) }
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const chars = [...flat]
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : flat
}

function rawBasename(path: unknown): string {
  if (typeof path !== 'string' || path === '') return ''
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

function basename(path: unknown): string {
  const name = rawBasename(path)
  return name === '' ? 'ファイル' : oneLine(name, 18)
}

/** ツール呼び出しがさわっているファイルの名前（なければ undefined） */
export function fileName(input: Readonly<Record<string, unknown>>): string | undefined {
  const name = rawBasename(input.file_path ?? input.notebook_path)
  return name === '' ? undefined : oneLine(name, 18)
}

// ---- プロンプト ----

export const PROMPT_LINES: readonly Line[] = [
  'わこつ', 'きたー！', '待機', 'wktk', '初見', 'お題きた', 'はじまった', 'うぽつ',
  { text: 'キタ━(ﾟ∀ﾟ)━!', color: yellow },
  '今北産業', '一番乗り', '待ってた', 'わこわこ', '枠取りおつ', '間に合った', '通知から来た', '正座待機',
  '今日は何作るの？', 'お題把握', '案件きた', '出勤おつ', '作業配信きた', '待ちくたびれた', '常連です',
  'ROM専です', '見に来た', '開幕', '期待', '今日もがんばろ', '乗り遅れた？', 'ｶﾞﾀｯ', 'こんちゃ',
  { text: '配信開始！', color: orange },
  { text: 'きちゃ！', color: pink },
  '席確保',
]

/** プロンプトの中身で反応を変える。当たったものから2つまで使う */
export const PROMPT_TOPICS: ReadonlyArray<{ re: RegExp; lines: readonly Line[] }> = [
  {
    re: /弾幕|danmaku|ニコ(?:ニコ|動|生)|niconico|視聴者|コメ(?:ント)?(?:が|の)?(?:流れ|途切れ|種類)|(?:流れる|流す)コメント/i,
    lines: [
      '呼んだ？', '俺らの話で草', 'メタ回', '弾幕職人きた', 'もっと流せ', '画面埋めろ', '俺らが主役',
      'コメ増量たすかる',
    ],
  },
  {
    re: /セキュリティ|脆弱性|security|\bvuln|\bcve\b|\bxss\b|\bcsrf\b|インジェクション|injection|認証|認可|\bauth\b|\boauth\b|パスワード|password|暗号|\bsecrets?\b|漏洩/i,
    lines: [
      'セキュリティ回', 'セキュ意識高い', '脆弱性こわい', '鉄壁', '穴ふさげ', 'ハッカー対策',
      'パスワード晒すなよ',
    ],
  },
  {
    re: /\bdb\b|database|データベース|sql|postgres|mongo|redis|\bmigrat|マイグレ|クエリ(?!パラメ)|prisma|\borm\b|supabase|firebase|dynamodb/i,
    lines: [
      'DB回', 'SQL職人', 'マイグレこわい', '本番DB触るな', 'インデックス貼れ', 'JOIN芸', 'DROP禁止',
    ],
  },
  {
    re: /\bgit\b|github|gitlab|merge|マージ(?!ン)|rebase|リベース|conflict|コンフリクト|競合|ブランチ|branch|cherry-pick|プルリク|pull request|\bPR\b|コミット|\bcommit|stash|スタッシュ/i,
    lines: [
      'git回きた', 'コンフリクト地獄', 'マージ祭り', 'リベース職人', 'ブランチ芸', '履歴きれいに',
      'force pushはやめろ',
    ],
  },
  {
    re: /デプロイ|deploy|リリース|release|本番|\bprod(?:uction)?\b|ステージング|staging|\bci\b|パイプライン|pipeline|publish|公開/i,
    lines: [
      'デプロイ回', '本番こわい', '金曜デプロイ？', 'リリースwktk', 'ロールバック用意', 'CI緑になれ', '出荷よー',
    ],
  },
  {
    re: /(?<![大新原典定雛])型(?!番)|typescript|\btypes?\b|\btsc\b|ジェネリクス|\bgenerics?\b/i,
    lines: [
      '型回きた', '型パズル開幕', 'anyは甘え', '型安全えらい', '型職人ニキ', 'ジェネリクス沼', '型が強い',
    ],
  },
  {
    re: /(?<!プ)レビュー|\breview|\blgtm\b|コードチェック|見てほしい|見て欲しい|見てもらえ|コードを見て/i,
    lines: [
      'レビュー回',
      { text: 'LGTM', color: green },
      '辛口レビュー', '指摘ニキ', 'nitです', 'レビュワーの鑑', 'マサカリ待機',
    ],
  },
  {
    re: /環境構築|セットアップ|\bsetup\b|set up|\binstall|インストール|導入|初期設定|\binit\b|\bvenv\b|\bnvm\b|docker|依存関係|dependenc/i,
    lines: [
      '環境構築回', '沼の予感', 'ここが鬼門', 'バージョン地獄', '動けば勝ち', '手順書くれ', 'PATH通せ',
    ],
  },
  {
    re: /翻訳|英語|英訳|和訳|translat|\bi18n\b|多言語|ローカライズ|locali[sz]/i,
    lines: [
      '翻訳回', '英語つよい', 'バイリンガルか', 'ﾍﾟﾗﾍﾟﾗ', 'i18n職人', '世界進出', '多言語えらい',
    ],
  },
  {
    re: /命名|名前|naming|rename|リネーム|名付け|変数名|関数名|ネーミング/i,
    lines: [
      '命名回', '名前は大事', '略しすぎ注意', 'hoge禁止', '一番むずいやつ', '名は体を表す', '命名会議はじまる',
    ],
  },
  {
    re: /ゲーム|game|テトリス|シューティング|\brpg\b|\bunity\b|godot|ドット絵|\bsprites?\b/i,
    lines: [
      'ゲーム回！', '神ゲーの予感', 'バカゲー希望', '遊ばせて', 'テストプレイ要員', '実況はよ', 'RTA待機',
    ],
  },
  {
    re: /バグ|不具合|bug|(?<!pre|suf)fix(?!ture)|(?<!書き|やり|見|言い|作り|立て)直して|エラー|error|治して|なおして|おかしい|動かない|壊れ|crash|クラッシュ|落ちる|落ちた|例外|exception|\bbroken\b|うまくいかない/i,
    lines: [
      'バグ回きた', 'デバッグ回', '原因なんやろ', '虫退治', '再現できる？', 'console.log職人', 'それは仕様',
      '直れー',
    ],
  },
  {
    re: /(?<!コン)テスト|\btest|_test\b|pytest|vitest|unittest|\bjest\b|\bspecs?\b|カバレッジ|coverage|\btdd\b|\be2e\b|モック|\bmocks?\b/i,
    lines: [
      'テスト回', 'テストえらい', 'カバレッジ大事', 'TDDかな', '赤→緑', '品質の鬼', 'テストは裏切らない',
      'モック職人',
    ],
  },
  {
    re: /パフォーマンス|高速|速く|爆速|遅い|遅延|遅く|重い|最適化|軽量化|performance|\bperf\b|optimi[sz]|\bslow\b|\bfaster\b|メモリ|memory|キャッシュ|cache/i,
    lines: [
      'パフォーマンス回', '高速化ニキ', '爆速にしよう', 'まず計測', 'ボトルネックどこ？', 'メモリ食いすぎ',
      '速さは正義',
    ],
  },
  {
    re: /\bui\b|\bux\b|デザイン|design|\bcss\b|scss|tailwind|スタイル|style|見た目|レイアウト|layout|色(?![々ん])|カラー|colou?r|フォント|font|アニメーション|animation|ボタン|button|画面|余白|マージン|margin|padding|パディング|かわいく/i,
    lines: [
      'デザイン回', '見た目大事', 'おしゃれ', 'センス問われる', 'CSS芸人', '1px戦争', 'かわいくして', '余白すき',
    ],
  },
  {
    re: /ドキュメント|readme|\bdocs?\b|documentation|マニュアル|\bmanual\b|仕様書|説明書|jsdoc|changelog|\bwiki\b|\.md\b/i,
    lines: [
      'ドキュメント回', 'README職人', '未来の自分へ', '誰も読まないやつ', 'docsえらい', '文章力たかい',
      '後世に残る',
    ],
  },
  {
    re: /リファクタ|refactor|整理|きれいに|綺麗に|共通化|simplif|シンプルに|読みやすく|clean ?code/i,
    lines: [
      'リファクタ回', 'きれいにしよう', 'お掃除回', '負債返済', 'スパゲッティ解体', '美しい…', '差分でかそう',
    ],
  },
  {
    re: /削除|(?<!解|取り|打ち|取)消[しす]|消去|remove|delete|\brm\b|いらない|要らない|不要|撤去|捨て|clean ?up|クリーンアップ|片付け/i,
    lines: [
      '断捨離回', '消すの？', 'さよなら…', 'バッサリ', '供養', '行数マイナスは正義', '消しすぎ注意',
    ],
  },
  {
    re: /\bmods?\b|プラグイン|plugin|拡張機能|アドオン|\badd-?ons?\b|改造/i,
    lines: [
      'mod回', 'mod文化すき', '魔改造', '拡張機能職人', 'プラグイン沼', 'バニラ派です', 'mod入れたら最強',
    ],
  },
  {
    re: /\bAI\b|\bLLMs?\b|claude|gpt|openai|gemini|プロンプト|prompt|エージェント|\bagents?\b|機械学習|人工知能|chatbot|チャットボット/i,
    lines: [
      'AI回', 'AIがAIを作る', 'メタくて草', 'プロンプト職人', '同業者で草', 'シンギュラリティ', '人類の夜明け',
    ],
  },
  {
    re: /急ぎ|至急|(?<!お)はよ(?:して|しろ|せい|[!！ｗw]|\s*$)|はよはよ|\basap\b|urgent|急いで|早く|はやく|今すぐ|超特急|巻きで/i,
    lines: [
      '急げｗ', '締め切り近そう', '納期ヒエッ', '巻きで', '焦るな', 'デスマの予感', '時間ないｗ',
    ],
  },
  {
    re: /調査|調べ|investigat|なぜ|なんで(?!も)|何で(?!も)|\bwhy\b|原因|理由|どうして|分析|analy[sz]|突き止め|特定して/i,
    lines: [
      '調査回', '探偵きた', '真相究明', '謎解き回', '犯人はどこだ', '証拠集め中', '迷宮入りしそう',
    ],
  },
  {
    re: /説明|教えて|解説|explain|わかりやすく|分かりやすく|って何|ってなに|とは何|仕組み|\bhow\b|\bwhat(?:'s| is)\b/i,
    lines: [
      '解説回', '授業きた', '先生！', 'メモ取ります', '勉強になる', 'ノート用意した', '初心者助かる',
    ],
  },
  {
    re: /新機能|機能追加|追加|実装|作っ|作り|作る|作成|つくって|増やして|\bfeature\b|\badd\b|implement|\bcreate\b|\bnew\b|(?:が|を|も)(?:欲しい|ほしい)/i,
    lines: [
      '新機能きた', '実装回', '作るぞー', '神機能の予感', '仕様きた', '完成が楽しみ', 'ゼロイチ回',
    ],
  },
  {
    re: /ありがと|thank|感謝|サンキュ|\bthx\b|\bty\b|助かる|助かった|お疲れ|おつかれ/i,
    lines: [
      '礼儀正しい', 'えらい', '育ちがいい', 'いい人', 'こちらこそ', 'ええ子や', '優しい世界',
    ],
  },
  {
    re: /お願い|おねがい|please|\bpls\b|\bplz\b|頼む|頼み|たのむ|よろしく|宜しく/i,
    lines: [
      '頼まれたｗ', 'お願いきた', '任せろ', '受注しました', 'かしこまり！', '腰が低い', '丁寧で草',
    ],
  },
  {
    re: /[?？]\s*$|(?:ですか|ますか|でしょうか|かな)[。.]?\s*$/,
    lines: [
      '質問回', 'それな', 'いい質問', '気になる', 'たしかに', 'なんでだろ', '誰か詳しい人',
    ],
  },
]

export const LONG_PROMPT_LINES: readonly Line[] = [
  '長文きた', '仕様書かな', '熱量すごい', '三行で頼む', '気合い入ってる',
]

export const SHORT_PROMPT_LINES: readonly Line[] = [
  '一言で草', '簡潔', '短っ', '以心伝心', '察して系',
]

export type TimeOfDay = 'morning' | 'day' | 'evening' | 'night' | 'lateNight'

export const TIME_LINES: Readonly<Record<TimeOfDay, readonly Line[]>> = {
  morning: [
    'おはよう', '朝活えらい', '早起きか', '朝から作業', 'コーヒー飲んだ？',
  ],
  day: [
    'こんにちは', '昼休み？', '仕事中に見てる', '昼から作業', 'お昼食べた？',
  ],
  evening: [
    'こんばんは', '仕事終わりか', '夜の部開幕', '晩酌しながら見てる', 'ご飯食べた？',
  ],
  night: [
    '夜ふかし勢', '明日大丈夫？', 'もうこんな時間', '寝る前に1本', '夜の作業はかどる',
  ],
  lateNight: [
    '深夜テンション', 'まだ起きてて草', '寝ろ', '丑三つ時', '徹夜？', '健康に悪いぞ',
  ],
}

export function timeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 10) return 'morning'
  if (hour >= 10 && hour < 17) return 'day'
  if (hour >= 17 && hour < 22) return 'evening'
  if (hour >= 22) return 'night'
  return 'lateNight'
}

/**
 * hour（0〜23）を渡すと、ときどき時間帯のあいさつも混ぜる。
 * 流量の上限で後ろから削られるので、中身に合わせたコメントを先に、ありふれたあいさつを後に並べる
 */
export function reactToPrompt(text: string, rand: Rand, hour?: number): Draft[] {
  const out: Draft[] = []
  const topics = PROMPT_TOPICS.filter(t => t.re.test(text))
  for (const topic of pickSome(topics, 2, rand)) out.push(draft(pick(topic.lines, rand)))
  const length = [...text.trim()].length
  if (length > 200) out.push(draft(pick(LONG_PROMPT_LINES, rand)))
  else if (length > 0 && length <= 6) out.push(draft(pick(SHORT_PROMPT_LINES, rand)))
  if (hour !== undefined && rand() < 0.3) out.push(draft(pick(TIME_LINES[timeOfDay(hour)], rand)))
  out.push(...pickSome(PROMPT_LINES, 3, rand).map(l => vary(draft(l), rand)))
  const head = oneLine(text, 16)
  if (head !== '') out.unshift({ text: `【お題】${head}`, color: orange, pos: 'ue' })
  return out
}

// ---- ツール呼び出し ----

export const TOOL_LINES: Readonly<Record<string, readonly Line[]>> = {
  Read: [
    '熟読ニキ', '{file} 読んでる', '読むの速すぎて草', '精読助かる', 'そこ読むんか', 'ふむふむ', '予習えらい',
    '速読ニキ', '読書タイム', '下調べ大事', '{file} 見せて', '中身チェック', '読解力たかい', '把握はやい',
    'インプット中', 'そこ気になってた', '何書いてあるん？', 'ﾍﾟﾗﾍﾟﾗ', '行間も読んでそう', '(・ω・)ｼﾞｰ',
    'どれどれ', '読んでから書く派', '{file} 大事そう', '目grepしてそう', '全部読む気か', '{file} か…', 'ﾁﾗｯ',
    { text: '慎重派すき', color: pink },
  ],
  Edit: [
    '書き換えたｗ', '神編集', '{file} 改造中', '職人芸', '差分きれい', 'そこ変えるんか', '迷いがない',
    '手が速い', '修正きた', '{file} いじってる', '外科手術', 'ピンポイント修正', '大胆で草', '慎重な一手',
    'その手があったか', '置換芸', 'ちょい足し', 'ﾎﾟﾁﾎﾟﾁ', 'え、そこ？', '伏線回収', '{file} 生まれ変わる',
    'リフォームきた',
    { text: '匠の技', color: orange },
    '天才の手つき', '何が変わるんだ', '{file} 直すんか', '直せ直せー',
    { text: '魔改造で草', color: green },
  ],
  Write: [
    '{file} 爆誕', '新規ファイルきた', '一発で書いてて草', '生成はやい', '書き下ろしきた', '誕生おめ',
    'ゼロから書いた', '{file} はじめまして', '新作きた', 'ファイル錬成',
    { text: '創造神', color: yellow, isBig: true },
    '名前のセンスよ', 'タイピング音すごそう', 'ﾄﾞﾝｯ', '量産体制', '白紙から強い', '筆が速い',
    'ファイル増えたｗ', 'もう完成してて草', '一筆書き', '構想どおり？', '＼(^o^)／',
  ],
  Bash: [
    '黒い画面きた', 'コマンド職人', 'ターミナル芸',
    { text: '$ {cmd}', color: cyan },
    'ｶﾀｶﾀｯﾀｰﾝ', 'ハッカーっぽい', 'シェル芸', '実行！', '何が出るかな', '結果待ち', 'フラグ立った', '黒魔術',
    'ログ流れてる？', 'CUIの民', '手慣れてる', '祈りのEnter', 'exit 0 頼む', 'ワンライナーすき', 'それ打つんか',
    '動くかな', 'GUI使わない派', '{cmd} 叩いてる',
  ],
  Search: [
    '検索はやい', '探し物？', 'grep職人', '見つかるかな', '{q} 探してる', 'どこだー', '宝探し',
    'ワイルドカード芸', 'ローラー作戦', '捜索隊', '検索芸', 'ｷｮﾛｷｮﾛ', 'しらみつぶし', '索敵中',
    { text: '名探偵きた', color: blue },
    'ファイル迷子？', '目星ついてそう', '{q} 狙いか', '(´・ω・`)ﾄﾞｺ?', '正規表現ニキ', '探索ニキ',
    '一瞬で見つけそう',
  ],
  Web: [
    'ググってて草', 'ネットの海へ', '調べものえらい', '情報収集ニキ', 'ググり力たかい', 'ネットサーフィン',
    '{q} 調べてる', '公式ドキュメント派', 'ソースどこ？', 'リサーチ回', '情報強者', '最新情報助かる', 'ﾈｯﾄﾐﾃﾙ',
    '{q} 気になる', '裏取りえらい', '回線大丈夫？', 'ネットの集合知', 'ページ開いた',
  ],
  Agent: [
    '影分身の術', '部下に投げたｗ', 'サブエージェント召喚', '分身きた', '増えたｗ', '丸投げで草', '援軍きた',
    'チーム戦', 'いってらっしゃい', '並列処理', '分業えらい', '人海戦術', '上司ムーブ', 'もう一人の自分',
    '任せた！', '外注きた',
    { text: 'Claude軍団', color: purple },
    'ｿﾞﾛｿﾞﾛ',
  ],
  Todo: [
    '計画性の鬼', 'ToDo管理えらい', '段取り八分', '几帳面', 'リスト更新', 'チェック入れた', '進捗どうですか',
    '着々と', '見える化助かる', '一個ずつ', 'PM適性ある', 'やること増えた', '優先順位えらい', 'タスク消化中',
  ],
  Ask: [
    '質問タイム', '選択肢きた', 'アンケートきた', 'どれにする？',
    { text: '視聴者参加型', color: pink },
    'Aで', '1番！', '迷う', '聞くのえらい', '確認大事', '全部で', 'B一択',
  ],
  Plan: [
    '計画きた', 'プラン発表', '設計図きた', '作戦会議', '軍師ムーブ', '戦略家', '考えてから動く派',
    '全体像きた', '設計大事', '急がば回れ',
    { text: '計画通り', color: purple },
    '承認まち？',
  ],
  Skill: [
    'スキル発動！', '必殺技きた',
    { text: '奥義', color: red, isBig: true },
    '覚醒', '専門家モード', '秘伝の書', 'MP足りる？', 'レベルアップ', '技名かっこいい', 'チート級',
  ],
  Mcp: [
    '外部連携きた', 'MCP職人', '{tool} !?',
    { text: 'コラボ回', color: pink },
    'ゲスト出演', '{tool} 呼んだ', 'つながった', 'API叩いてる', '異世界通信', '拡張機能きた', '連携えらい',
    '外の力借りた',
  ],
  Other: [
    '{tool} !?', 'なにそれ', '新技きた',
    { text: '謎ツール', color: purple },
    '{tool} 便利そう', 'レア技', '隠し機能？', '引き出し多い', 'kwsk', '見たことない',
  ],
  Workflow: [
    '軍団召喚', 'エージェント祭り', '総力戦', '分身の術・極', '全軍出撃',
    { text: 'オールスター', color: yellow },
    'レイドバトル', 'ギルド結成', 'ﾜﾗﾜﾗ出てきた', 'もはや会社', '司令塔きた',
    { text: '総攻撃開始', color: red },
  ],
  Monitor: [
    '監視班配置', '張り込み開始', '見張り番', 'ログ監視ニキ', '双眼鏡スタンバイ',
    { text: '警戒態勢', color: orange },
    '目を光らせてる', '刑事ドラマかな', 'あんパン買ってくる', '定点観測',
  ],
}

/** ふつうに成功したツール呼び出しに、ときどき付けるほめ言葉 */
export const TOOL_OK_LINES: Readonly<Record<string, readonly Line[]>> = {
  Read: [
    '読了', '完全に理解した', '把握', '勉強家', '頭に入った？', '吸収はやい', 'インプット完了', '予習ばっちり',
  ],
  Edit: [
    'きれいに直った', 'いい差分', 'ナイス修正', 'スッキリした', '美しい', '修正おつ', 'GJ', '天才か', 'お見事',
    { text: '匠', color: orange, isBig: true },
  ],
  Write: [
    '完成！', '書き上げた', '書けた', '筆が速い', 'いい出来', 'ﾊﾟﾁﾊﾟﾁ', '888', 'ナイス',
    { text: '保存完了', color: pink },
  ],
  Bash: [
    '動いた！', 'exit 0', '無事', 'ヨシ！', 'スムーズ', 'さすが', '手際いい', 'ﾎｯ', 'ナイスコマンド',
    { text: '成功！', color: green },
  ],
  Search: [
    '検索おつ', '結果きた', 'いい嗅覚', 'どうだった？', '探索完了', '手際いい', 'ｻｰﾁ完了',
    { text: '捜索隊GJ', color: yellow },
  ],
  Web: [
    '情報ゲット', '収穫あり', '勉強になる', '賢くなった', '物知り', 'ソースあった', '帰還', 'ネットつよい',
  ],
  Agent: [
    '部下有能', 'おかえり', '報告きた', '仕事はやい', 'ナイス連携', '分身おつ', 'チームの勝利', '優勝',
    '頼れる',
  ],
  Todo: [
    '整理完了', '見通しよし', '進捗いいね', '一歩前進', '着実', 'リストきれい', '順調',
  ],
}

/** Read / Edit / Write のファイル名（basename）で反応を変える。最初に当たったものを使う */
export const FILE_KINDS: ReadonlyArray<{ re: RegExp; lines: readonly Line[] }> = [
  {
    re: /\.(test|spec)\.|^test_.+\.py$|_test\.(go|py)$|Tests?\.(swift|kt|java)$/,
    lines: [
      'テストきた', 'テスト職人', 'テスト大事', '{file} 通るかな', 'テスト駆動？',
      { text: 'テストは裏切らない', color: green },
    ],
  },
  {
    re: /^package\.json$/,
    lines: [
      '依存関係チェック', 'package.json きた', 'バージョン上げる？', 'scripts見てそう', 'npmの心臓部',
      '依存多そう',
    ],
  },
  {
    re: /^(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|composer\.lock|uv\.lock|go\.sum)$/,
    lines: [
      'ロックファイルで草', '誰も読まないやつ',
      { text: '触るな危険', color: red },
      '差分えぐそう', 'コンフリクトの元', 'スクロール地獄',
    ],
  },
  {
    re: /^(CLAUDE|AGENTS)(\.local)?\.md$/i,
    lines: [
      '自分の取説で草', '己を知る', '掟の書', 'メタい', 'ルールブック', '自己紹介きた',
    ],
  },
  {
    re: /^readme(\..+)?$/i,
    lines: [
      'READMEきた', '取説きた', 'まず説明書から', 'ドキュメント大事', '未来の自分のため', '親切設計',
    ],
  },
  {
    re: /^\.env(?!.*\.(?:example|sample|template|dist)$|\.d\.ts$)(?:\.[\w.-]+)?$/i,
    lines: [
      { text: '秘密ファイル!?', color: red },
      '見ちゃダメ', 'キー漏らすなよ', 'ヒエッ', '取り扱い注意', 'モザイク必要？',
    ],
  },
  {
    re: /^\.\w*ignore$/i,
    lines: [
      '無視リスト', 'node_modules除外', '見なかったことに', 'スルー力', 'コミット事故防止',
    ],
  },
  {
    re: /^(Dockerfile|Containerfile)(\..+)?$|^(docker-)?compose(\..+)?\.ya?ml$/i,
    lines: [
      'クジラきた', 'コンテナ職人', 'イメージ重そう', 'ビルド長そう', 'インフラ回', 'Docker芸',
    ],
  },
  {
    re: /\.config\.[cm]?[jt]s$|^[jt]sconfig.*\.json$|^\.(eslint|prettier|babel|stylelint)rc/i,
    lines: [
      '設定いじり', '設定沼', 'コンフィグ職人', '{file} 魔境', 'ルール厳しそう', 'Lint警察',
    ],
  },
  {
    re: /\.ya?ml$/i,
    lines: [
      'YAML職人', 'インデント地獄', 'スペース数えて', 'CIの気配', '設定ファイルきた', 'YAMLこわい',
    ],
  },
  {
    re: /\.json[c5]?$/i,
    lines: [
      'JSONきた', 'カンマ1個で死ぬ', 'ネスト深そう', 'データの塊', '末尾カンマこわい', '{file} 中身多そう',
    ],
  },
  {
    re: /\.(md|mdx|markdown)$/i,
    lines: [
      'ドキュメント回', '文章力たかい', 'マークダウン職人', '見出しきれい', '読み物きた',
    ],
  },
  {
    re: /\.[cm]?tsx?$/i,
    lines: [
      'TSきた', '型職人', '型安全えらい', 'anyは禁止な', '型パズル', '{file} 型強そう',
    ],
  },
  {
    re: /\.[cm]?jsx?$/i,
    lines: [
      'JSきた', '素のJSで草', 'undefined注意', '型なし勢', 'JS職人', 'セミコロン派？',
    ],
  },
  {
    re: /\.(py|pyi|ipynb)$|^(requirements.*\.txt|pyproject\.toml)$/i,
    lines: [
      'Pythonきた', '蛇きた', 'インデント命', 'py職人', 'import多そう', '読みやすい言語',
    ],
  },
  {
    re: /\.go$|^go\.mod$/i,
    lines: [
      'Goきた', 'if err != nil', 'Gopherかわいい', 'シンプルいいね', 'goroutine芸',
    ],
  },
  {
    re: /\.rs$|^Cargo\.toml$/i,
    lines: [
      'Rustきた',
      { text: 'カニきた', color: orange },
      '借用チェッカー', '所有権こわい', 'unsafeやめろ', 'コンパイラ先生',
    ],
  },
  {
    re: /\.(rb|rake|erb)$|^(Gemfile|Rakefile)$/i,
    lines: [
      'Rubyきた',
      { text: '宝石きた', color: red },
      'end多くて草', 'メタプロ芸', 'Rails勢？',
    ],
  },
  {
    re: /\.(java|kt|kts)$|^pom\.xml$|^build\.gradle$/i,
    lines: [
      'JVM勢きた', 'ぬるぽ', 'ｶﾞｯ', 'クラス名長そう', 'Factory芸', 'Gradle重い',
    ],
  },
  {
    re: /\.swift$/i,
    lines: [
      'Swiftきた', 'iOS回', 'guard let 職人', 'オプショナル芸', 'Xcode重そう',
    ],
  },
  {
    re: /\.(c|h|cc|cpp|cxx|hpp|hh)$|^CMakeLists\.txt$/i,
    lines: [
      'C言語きた', 'ポインタこわい', 'セグフォ注意', 'メモリ職人', 'ガチ勢きた', '低レイヤー回',
    ],
  },
  {
    re: /\.(sh|bash|zsh|fish|ps1)$|^\.(bash|zsh)rc$/i,
    lines: [
      'sh職人', 'スクリプトきた', '自動化えらい', 'chmod忘れずに', 'クォート地獄', 'シバン大事',
    ],
  },
  {
    re: /\.(css|scss|sass|less|styl)$/i,
    lines: [
      'CSS職人', '中央寄せ芸', 'デザイン回', '見た目大事', '!important禁止', 'z-index戦争',
    ],
  },
  {
    re: /\.(html?|vue|svelte)$/i,
    lines: [
      'HTMLきた', 'タグ職人', 'divだらけ？', 'マークアップ芸', '画面作る回', '閉じタグ大事',
    ],
  },
  {
    re: /\.(sql|prisma)$/i,
    lines: [
      'SQL職人', 'DB触るのか', 'マイグレーション？', 'SELECT *',
      { text: 'DROPはやめろ', color: red },
      'JOIN芸',
    ],
  },
  {
    re: /\.(png|jpe?g|gif|svg|webp|ico|bmp|avif)$/i,
    lines: [
      '画像きた', '絵心ある', '見えてるの？', 'アイコンかな', 'お絵かき回', '画像読めるんか',
    ],
  },
]

export function toolGroup(tool: string): string {
  if (tool.startsWith('mcp__')) return 'Mcp'
  switch (tool) {
    case 'Read':
    case 'NotebookRead':
      return 'Read'
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'Edit'
    case 'Write':
      return 'Write'
    case 'Bash':
    case 'PowerShell':
      return 'Bash'
    case 'Grep':
    case 'Glob':
    case 'LS':
      return 'Search'
    case 'WebSearch':
    case 'WebFetch':
      return 'Web'
    case 'Agent':
    case 'Task':
      return 'Agent'
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return 'Todo'
    case 'AskUserQuestion':
      return 'Ask'
    case 'EnterPlanMode':
    case 'ExitPlanMode':
      return 'Plan'
    case 'Skill':
      return 'Skill'
    case 'Workflow':
      return 'Workflow'
    case 'Monitor':
      return 'Monitor'
    default:
      return 'Other'
  }
}

/** テストを走らせるコマンド。pytest などの名前はコマンドの頭（npx・uv run などの後ろも可）にあるときだけ数える */
const TEST_RE =
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|(?:^|[\n;&|(])\s*(?:\w+=\S*\s+)*(?:(?:npx|bunx|pnpx|uvx)\s+|(?:pnpm|yarn)\s+(?:exec\s+|dlx\s+)?|bun\s+(?:x\s+|run\s+)?|(?:uv|poetry|pipenv)\s+run\s+|python3?\s+-m\s+|bundle\s+exec\s+|(?:\.\/)?node_modules\/\.bin\/)?(?:pytest|jest|vitest|mocha|rspec|phpunit)(?![\w.-])|\bgo\s+test\b|\bcargo\s+test\b|\b(mvn|gradle)\s+test\b|\bplugin\s+test\b|\bplaywright\s+test\b|\bcypress\s+run\b|\b(?:swift|dotnet|deno)\s+test\b/

/** Bash の中身で反応を変える。最初に当たったものを使う */
export const BASH_SPECIAL: ReadonlyArray<{ re: RegExp; start: readonly Line[]; ok?: readonly Line[]; ng?: readonly Line[] }> = [
  { // rm-rf
    re: /\brm\s+(?:-[a-zA-Z]*(?:[rR][a-zA-Z]*f|f[a-zA-Z]*[rR])|-[rR]\s+-f\b|-f\s+-[rR]\b|--recursive\s+--force\b|--force\s+--recursive\b)/,
    start: [
      { text: 'ヒエッ', color: red },
      { text: 'rm -rf はやめろ', color: red },
      '消すな消すなｗ',
      { text: '逃げて', color: red, isBig: true },
      '((((；ﾟДﾟ))))', 'パス確認した？', 'バックアップは？', '全部消える…',
    ],
    ok: [
      '跡形もない', '消えた…', '無事か？', 'さよなら',
    ],
    ng: [
      '消せなくて草', '命拾い', 'セーフ', '止まってよかった',
    ],
  },
  { // git-reset-hard
    re: /\bgit\s+(?:-[Cc]\s+\S+\s+|--?\w[\w-]*(?:=\S+)?\s+)*(?:reset\b[^\n;&|]*\s--hard\b|clean\s+(?:-\w*f|--force\b))/,
    start: [
      { text: '全部捨てる気!?', color: red },
      '変更が消える', '歴史改変きた', 'なかったことに', 'ヒィッ', '時間遡行', '思い切りがいい',
    ],
    ok: [
      'きれいさっぱり', '何もなかった', '虚無', 'reflogあるし',
    ],
    ng: [
      '戻せなくて草', '踏みとどまった', 'セーフ？',
    ],
  },
  { // git-push-force
    re: /\bgit\s+(?:-[Cc]\s+\S+\s+|--?\w[\w-]*(?:=\S+)?\s+)*push\b[^\n;&|]*\s(?:--force|-f)\b/,
    start: [
      { text: '強制プッシュで草', color: green },
      'やめろｗ', '勇者現る',
      { text: 'force!?', color: red, isBig: true },
      '歴史が書き換わる', 'チームが泣く', '上書きニキ',
    ],
    ok: [
      '押し通したｗ', '力こそパワー', '強い', 'やりやがった',
    ],
    ng: [
      '弾かれてて草', '守られた', '保護ブランチ強い',
    ],
  },
  { // git-push
    re: /\bgit\s+(?:-[Cc]\s+\S+\s+|--?\w[\w-]*(?:=\S+)?\s+)*push\b/,
    start: [
      'プッシュ！', '本番いくぞ', '祈れ', 'いってらっしゃい', 'リモートへ', 'CI走るぞ', 'ドキドキ',
    ],
    ok: [
      'プッシュ成功', 'おめ', '世界に公開',
      { text: '888888', color: yellow },
      '＼(^o^)／', 'CI頼む',
    ],
    ng: [
      'リジェクトで草', 'pullしてから', 'non-fast-forward', '弾かれた',
    ],
  },
  { // git-commit
    re: /\bgit\s+(?:-[Cc]\s+\S+\s+|--?\w[\w-]*(?:=\S+)?\s+)*commit(?![\w-])/,
    start: [
      'コミット！', 'コミットえらい', 'セーブポイント', 'メッセージ丁寧', '記録します', 'こまめでえらい',
    ],
    ok: [
      'コミットおめ', '888', 'セーブ完了', '歴史に刻まれた', 'きれいな履歴',
    ],
    ng: [
      'hookに怒られた', 'コミット失敗で草', '何もステージしてない？', 'pre-commit強い',
    ],
  },
  { // test
    re: TEST_RE,
    start: [
      'テスト来た', '頼む…', '祈祷中', '緊張の瞬間', '全部通れ', 'ﾄﾞｷﾄﾞｷ', '赤か緑か', '(-人-)',
    ],
    ok: [
      { text: '8888888888', color: yellow, isBig: true },
      'テスト通った！',
      { text: '緑！', color: green },
      '神', 'オールグリーン', '有能',
      { text: '完全勝利', color: orange },
    ],
    ng: [
      { text: 'テスト落ちてて草', color: green },
      { text: '赤い…', color: red },
      'ドンマイ', '知ってた', 'あーあ', 'flaky説', 'テストが正しい',
    ],
  },
  { // claude
    re: /(?:^|[\n;&|(])\s*(?:npx\s+)?claude(?=\s|$)/,
    start: [
      { text: '自分を呼んでて草', color: green },
      { text: 'Claude in Claude', color: purple },
      '入れ子で草', 'メタ回', '本人登場', '自問自答', 'クローン召喚', 'マトリョーシカ',
    ],
    ok: [
      '連携プレー', '息ぴったり', '本人より有能？',
    ],
    ng: [
      '自分に断られてて草', 'ケンカした？', '仲間割れ',
    ],
  },
  { // install
    re: /\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|ci)\b|\bpip(?:3|x)?\s+install\b|\buv\s+(?:add|sync|pip\s+install)\b|\bpoetry\s+(?:add|install)\b|\bbrew\s+(?:install|reinstall|upgrade|tap)\b|\bcargo\s+(?:add|install)\b|\bgo\s+(?:get|install)\b|\bgem\s+install\b|\bbundle\s+install\b|\bcomposer\s+(?:install|require)\b|\bapt(?:-get)?\s+install\b|\bpod\s+install\b/,
    start: [
      '依存地獄の予感', 'インストール待機', 'パッケージ重そう', 'パッケージ増えた', 'ブラックホール',
      '依存更新', 'ダウンロード祭り',
    ],
    ok: [
      '入った', '依存解決！', 'インストール完了', '環境整った',
    ],
    ng: [
      '依存地獄で草', '入らなくて草', 'バージョン衝突', '依存解決失敗',
    ],
  },
  { // lint
    re: /(?:^|[\n;&|(])\s*(?:(?:npx|bunx|pnpx|uvx)\s+|(?:pnpm|yarn)\s+(?:exec\s+|dlx\s+)?|(?:uv|poetry|pipenv)\s+run\s+|python3?\s+-m\s+|bundle\s+exec\s+)?(?:eslint|prettier|biome|oxlint|ruff|rubocop|gofmt|rustfmt|golangci-lint|stylelint|flake8|pylint|black|isort|swiftlint|swiftformat|shellcheck|ktlint|clang-format|dprint)(?![\w.-])|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:lint|format|fmt)\b|\b(?:go\s+(?:fmt|vet)|cargo\s+(?:fmt|clippy))\b/,
    start: [
      'リンター先生', 'お行儀チェック', '整形タイム', 'インデント警察', 'Lint職人', 'きれい好き',
    ],
    ok: [
      '警告ゼロ', '美しい', 'お行儀よし', '整った',
    ],
    ng: [
      '怒られてて草', '警告の嵐', 'セミコロン…', '赤線だらけ',
    ],
  },
  { // typecheck
    re: /\btsc\b[^\n;&|]*--noEmit\b|(?:^|[\n;&|(])\s*(?:(?:npx|bunx|uvx)\s+|(?:pnpm|yarn)\s+(?:exec\s+)?|(?:uv|poetry)\s+run\s+|python3?\s+-m\s+)?(?:mypy|pyright|basedpyright|vue-tsc|svelte-check)(?![\w.-])|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:typecheck|type-check|check-types|tsc)\b|\b(?:cargo|deno)\s+check\b/,
    start: [
      '型チェック', '型の神に祈る', 'any禁止な', '型警察きた', '型は友達',
    ],
    ok: [
      '型安全', 'エラー0', '型完璧', '安心感ある',
    ],
    ng: [
      '型エラーで草', 'anyで逃げるな', '型パズル開始', 'undefinedかも',
    ],
  },
  { // sudo
    re: /\bsudo\b/,
    start: [
      { text: 'sudoはあかん', color: red },
      '管理者権限きた', 'パスワード！', '神の力', 'root降臨', '強権発動',
    ],
  },
  { // build
    re: /\b(?:npm|pnpm|yarn|bun)\s[^\n;&|]*?\bbuild\b|\b(?:cargo|go|vite|next|nuxt|nuxi|astro|swift|dotnet|docker|compose|bazel|turbo|nx|zig|uv|poetry|hatch|flutter|ng|sbt|hugo)\s+build\b|\btsc\b|(?:^|[\n;&|(])\s*(?:npx\s+)?(?:webpack|esbuild|rollup|parcel|tsup|xcodebuild|cmake|make|gradle|(?:\.\/)?gradlew|mvn|ninja|msbuild)(?![\w.-])|\bpython3?\s+-m\s+build\b/,
    start: [
      'ビルド待機', 'コンパイル中…', 'ﾋﾞﾙﾄﾞﾁｭｳ', 'コーヒータイム', '待つしかない', 'ファン回ってそう',
    ],
    ok: [
      'ビルド通った', 'えらい', 'ビルド職人', 'バイナリ爆誕', '一発ビルド',
    ],
    ng: [
      { text: 'ビルド失敗で草', color: green },
      '型エラーかな', 'リンカエラー？', 'クリーンビルドしろ', 'ログ長すぎ',
    ],
  },
  { // dev-server
    re: /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview)\b|(?:^|[\n;&|(])\s*(?:(?:npx|bunx)\s+)?(?:vite|nodemon|live-server|http-server|uvicorn|gunicorn|serve)(?=\s|$)(?!\s+build)|\b(?:next|nuxt|nuxi|astro|remix|ng|hugo|jekyll|expo)\s+(?:dev|start|serve|server)\b|\brails\s+s(?:erver)?\b|\bpython3?\s+-m\s+http\.server\b|\bmanage\.py\s+runserver\b|\bflask\s+run\b|\bartisan\s+serve\b|\bphp\s+-S\b/,
    start: [
      'サーバー起動', 'localhost来た', 'ポート開放', 'ホットリロード', 'dev鯖きた', '3000番かな',
    ],
    ok: [
      '起動した', '見に行こう', '動いてる',
    ],
    ng: [
      'ポート使用中で草', 'EADDRINUSE', '起動失敗', '先客がいる',
    ],
  },
  { // git-rebase
    re: /\bgit\s+(?:-[Cc]\s+\S+\s+|--?\w[\w-]*(?:=\S+)?\s+)*rebase\b/,
    start: [
      'リベースきた', '履歴整形', 'コンフリクト予感', '覚悟はいいか', '一直線にする',
    ],
    ok: [
      'きれいな一本道', 'リベース職人', '無傷で草',
    ],
    ng: [
      { text: 'コンフリクト祭り', color: red },
      '<<<<<<< HEAD', '--abortしよ', '泥沼回',
    ],
  },
  { // git-merge
    re: /\bgit\s+(?:-[Cc]\s+\S+\s+|--?\w[\w-]*(?:=\S+)?\s+)*merge(?![\w-])/,
    start: [
      'マージきた', '合流', '統合の時', '衝突するなよ', '運命の合体',
    ],
    ok: [
      'きれいに合流', 'マージ成功', 'Fast-forward',
    ],
    ng: [
      'コンフリクトで草', '衝突事故', '手動解決回', 'どっち残す？',
    ],
  },
  { // git-pull
    re: /\bgit\s+(?:-[Cc]\s+\S+\s+|--?\w[\w-]*(?:=\S+)?\s+)*(?:pull|fetch)\b/,
    start: [
      '最新化', '同期中', 'pullえらい', 'みんなの変更', '何が来るかな',
    ],
    ok: [
      '最新になった', 'up to date', '追いついた',
    ],
    ng: [
      'divergedで草', '競合きた', '取れなくて草',
    ],
  },
  { // git-clone
    re: /\bgit\s+(?:-[Cc]\s+\S+\s+|--?\w[\w-]*(?:=\S+)?\s+)*clone\b/,
    start: [
      'クローン！', 'リポジトリ召喚', 'でかそう', '新しいおもちゃ', 'ソース読むぞ',
    ],
    ok: [
      '届いた', '手元に来た', 'クローン成功',
    ],
    ng: [
      'リポジトリないｗ', '権限なさそう', 'URL違う？',
    ],
  },
  { // git-stash
    re: /\bgit\s+(?:-[Cc]\s+\S+\s+|--?\w[\w-]*(?:=\S+)?\s+)*stash(?!\s+(?:pop|apply|list|show|drop|clear)\b)/,
    start: [
      '一旦しまう', 'stash芸', '退避えらい', 'ポケットへ', '後で出す',
    ],
    ok: [
      '収納完了', '机が片付いた', '退避完了',
    ],
    ng: [
      'stash失敗', 'しまえなくて草', 'pop事故',
    ],
  },
  { // git-checkout
    re: /\bgit\s+(?:-[Cc]\s+\S+\s+|--?\w[\w-]*(?:=\S+)?\s+)*(?:checkout(?!\s+(?:--\s|\.(?:\s|$)))|switch)\b/,
    start: [
      'ブランチ移動', '世界線移動', 'ブランチ切るの？', '寄り道', 'どこ行くの',
    ],
    ok: [
      '移動完了', '新しい世界線', 'ブランチ職人',
    ],
    ng: [
      '移動できなくて草', '未コミットあるよ', 'そんなブランチない',
    ],
  },
  { // git-tag
    re: /\bgit\s+(?:-[Cc]\s+\S+\s+|--?\w[\w-]*(?:=\S+)?\s+)*tag\s+(?!-[ld]\b|--list\b|--delete\b)\S/,
    start: [
      'タグ打ち', 'リリースきた', 'バージョン上がる', 'v1.0.0？',
    ],
    ok: [
      'リリースおめ', '刻まれた', 'リリース888',
    ],
    ng: [
      'タグ被りで草', 'もうあるよ', 'タグ打ち失敗',
    ],
  },
  { // git-add
    re: /\bgit\s+(?:-[Cc]\s+\S+\s+|--?\w[\w-]*(?:=\S+)?\s+)*add\b/,
    start: [
      'ステージング', 'git add .', '選別中', '全部入れる？', '準備中',
    ],
  },
  { // gh-pr
    re: /(?:^|[\n;&|(])\s*gh\s+pr\s+create\b/,
    start: [
      'PRきた', 'レビューして', 'PR職人', 'LGTM待ち', 'プルリク！',
    ],
    ok: [
      'PR立った', 'LGTM', 'マージ待ち',
    ],
    ng: [
      'PR失敗で草', 'pushした？', 'ブランチ違う？',
    ],
  },
  { // gh
    re: /(?:^|[\n;&|(])\s*gh\s+\w/,
    start: [
      'GitHub CLI', 'gh使いこなしてる', 'Issue見る？', 'CI確認', 'gh職人',
    ],
    ng: [
      '認証切れ？', 'gh拗ねてる', 'API制限？',
    ],
  },
  { // docker
    re: /(?:^|[\s;&|(])(?:docker|podman)(?:-compose)?(?=\s|$)/,
    start: [
      'コンテナきた', 'クジラ', '環境ごと持ってく', 'イメージでかそう', 'Dockerfile芸', 'コンテナ職人',
    ],
    ok: [
      'ヨシ', '動いた！', 'クジラ元気',
    ],
    ng: [
      'デーモン寝てて草', 'Docker起動して', 'イメージなくて草',
    ],
  },
  { // infra
    re: /(?:^|[\n;&|(])\s*(?:kubectl|helm|terraform|tofu|pulumi|minikube|aws|gcloud|az|vercel|netlify|heroku|wrangler|flyctl)(?=\s|$)/,
    start: [
      'インフラ触ってる', '本番環境？', '請求書が怖い', 'クラウド課金', 'クラウド職人', 'YAML地獄',
      '本番触る？',
    ],
    ok: [
      'インフラ無事', 'ヨシ！', '本番生きてる',
    ],
    ng: [
      { text: 'インフラ炎上', color: red },
      'ロールバック！', '障害報告書',
    ],
  },
  { // curl
    re: /\b(?:curl|wget)\b/,
    start: [
      'ダウンロード中', '通信きた', 'API叩いてる', 'HTTP職人', 'リクエスト送信', 'レスポンス待ち',
    ],
    ok: [
      '200 OK', '返事きた', 'JSON来た',
    ],
    ng: [
      '404で草', 'つながらない', 'タイムアウト',
    ],
  },
  { // oneliner
    re: /\b(?:python3?|node|ruby|perl|bun)\s+(?:-[ce]\b|(?:-\s+)?<<)/,
    start: [
      'ワンライナー芸', '一行で済ます', '-c職人', 'その場で実行', 'クォート地獄',
    ],
    ok: [
      '動いたｗ', '一行で勝った', '美しい一行',
    ],
    ng: [
      'エスケープ地獄', '構文エラー？', 'クォート事故',
    ],
  },
  { // script-run
    re: /(?:^|[\n;&|(])\s*(?:python3?|node|deno(?:\s+run)?|bun(?:\s+run)?|ts-node|tsx|ruby|uv\s+run|npx\s+(?:tsx|ts-node)|bash|sh|zsh)\s[^\n;&|]*?\.(?:py|[cm]?js|[cm]?ts|rb|sh)(?!\w)|(?:^|[\n;&|(])\s*\.\/[\w./-]+/,
    start: [
      'スクリプト実行', '動くかな？', '走らせる', 'いけー', '自作ツール？', 'ﾜｸﾃｶ',
    ],
    ok: [
      '動いた', '完走', 'ちゃんと動く',
    ],
    ng: [
      '例外で草', 'スタックトレース', '落ちたｗ',
    ],
  },
  { // npx
    re: /(?:^|[\n;&|(])\s*(?:npx|bunx|pnpx|uvx|pnpm\s+dlx|yarn\s+dlx)(?=\s)/,
    start: [
      '知らないパッケージ実行', '何を召喚した？', 'npx芸', 'とりあえずnpx', '信用して大丈夫？',
    ],
    ok: [
      '使い捨て便利', 'さくっと完了', '便利すぎ',
    ],
    ng: [
      'パッケージなくて草', 'npxガチャ外れ', 'E404で草',
    ],
  },
  { // ssh
    re: /(?:^|[\n;&|(])\s*(?:ssh|scp|sftp|rsync|mosh)(?=\s)/,
    start: [
      'リモート接続', '遠征', 'サーバー入る', '別世界へ', '鍵はある？',
    ],
    ok: [
      '入れた', '転送完了', 'おかえり',
    ],
    ng: [
      '鍵違いで草', '接続拒否', '門前払い',
    ],
  },
  { // kill
    re: /(?:^|[\n;&|(])\s*(?:kill|pkill|killall)(?=\s)|\bxargs\s+(?:-\w+\s+)*kill\b/,
    start: [
      { text: '強制終了', color: red },
      'プロセス退治', 'kill -9 は最終手段', '成仏して', '容赦ない', 'ゾンビ狩り',
    ],
    ok: [
      '成仏した', 'いなくなった', '( ˘ω˘ )',
    ],
    ng: [
      'まだ生きてる', 'しぶとくて草', 'No such process',
    ],
  },
  { // chmod
    re: /(?:^|[\n;&|(])\s*(?:chmod|chown|chgrp)(?=\s)/,
    start: [
      '権限いじり', '+x 付与', '777はやめろ', 'パーミッション職人', '実行できるように',
    ],
  },
  { // git-status
    re: /\bgit\s+(?:-[Cc]\s+\S+\s+|--?\w[\w-]*(?:=\S+)?\s+)*(?:status|diff|log|show|blame|reflog|shortlog|branch)\b/,
    start: [
      '状況確認えらい', 'git職人', '差分チェック', '何が変わった？', 'ログ眺め', '慎重派',
    ],
  },
  { // heredoc
    re: /\bcat\b[^\n;&|]*<</,
    start: [
      'ヒアドキュメント芸', 'EOFまで一気', 'Write使えｗ', '力技で草', 'catで書いてる',
    ],
  },
  { // grep
    re: /(?:^|[\n;&|(])\s*(?:grep|egrep|rg|ag|ack|find|fd)(?=\s)/,
    start: [
      '検索芸', 'パイプ職人', 'どこだー', '正規表現ニキ', '干し草の中の針', 'あった？',
    ],
    ok: [
      '検索おわり', '結果きた', 'どうだった？',
    ],
    ng: [
      '0件で草', 'なかった…', 'スペル違う？',
    ],
  },
  { // sed
    re: /(?:^|[\n;&|(])\s*(?:sed|awk|gawk|perl\s+-[pi])(?=\s)/,
    start: [
      'sed職人', '置換芸', 'awk使い', '正規表現ニキ', 'パイプ職人',
    ],
  },
  { // cat
    re: /(?:^|[\n;&|(])\s*(?:cat|head|tail|less|more|bat|wc)(?=\s)/,
    start: [
      '覗き見', 'catで読む派', 'Read使えｗ', '中身チェック', 'じっくり', '全部読むの？',
    ],
  },
  { // mkdir
    re: /(?:^|[\n;&|(])\s*(?:mkdir|touch)(?=\s)/,
    start: [
      'フォルダ作成', '新居', '整理整頓', '箱を用意', 'touch芸',
    ],
  },
  { // mv-cp
    re: /(?:^|[\n;&|(])\s*(?:mv|cp|ln)(?=\s)/,
    start: [
      'お引っ越し', 'コピペ職人', '移動中', 'バックアップ？', 'どこへ行く',
    ],
    ng: [
      'ファイルなくて草', 'パス違う？', '上書き注意',
    ],
  },
  { // echo
    re: /(?:^|[\n;&|(])\s*(?:echo|printf)(?=\s|$)/,
    start: [
      'echo芸', 'しゃべった', 'printfデバッグ', 'こんにちは世界', '独り言', '叫んでて草',
    ],
  },
  { // sleep
    re: /(?:^|[\n;&|(])\s*sleep(?=\s)/,
    start: [
      '待機で草', '寝た', 'お昼寝タイム', 'zzz', '休憩えらい', '( ˘ω˘ )ｽﾔｧ',
    ],
  },
  { // open
    re: /(?:^|[\n;&|(])\s*open(?=\s)/,
    start: [
      'ブラウザ開いた', '画面見せて', 'Finder召喚', '開けゴマ', '目視確認',
    ],
  },
  { // cd
    re: /^\s*(?:cd(?:\s[^\n;&|]*)?|pwd\s*)$/,
    start: [
      '迷子で草', 'ここどこ', 'cdだけｗ', '散歩中', '現在地確認', '(´・ω・`)',
    ],
  },
  { // ls
    re: /(?:^|[\n;&|(])\s*(?:ls|tree|eza|exa)(?=\s|$)/,
    start: [
      'とりあえずls', 'ls好きすぎ', '部屋の確認', 'ファイル一覧', '何がある？', 'お宅訪問',
    ],
  },
]

export const ERROR_LINES: readonly Line[] = [
  { text: '草', color: green, isBig: true },
  { text: '大草原', color: green },
  'ｗｗｗｗｗ', 'あっ…', 'エラー芸', 'ドンマイ', 'やらかしたｗ', '知ってた', 'エラー吐いてて草',
  { text: 'ｴﾗｰ', color: red },
  'お約束', 'ﾌｧｯ!?', 'そうはならんやろ', 'どうしてこうなった', '想定内', '平常運転', '(´・ω・`)', 'ログ読も',
  'ｱｯｱｯ', '盛大にコケたｗ', 'これは草', 'あちゃー', 'ナイスエラー', '再挑戦はよ', 'うわぁ', '失敗は成功の母',
  'デバッグ回の予感', 'ここから巻き返す', 'エラーかわいい', 'あーあ', '落ち着いて', '見なかったことに',
]

export const DENIED_LINES: readonly Line[] = [
  '拒否られてて草', '許可おりず', '権限なくて草', 'おあずけｗ', '却下ｗ', '門前払いで草', 'NGくらった',
  'ユーザー強い', '信用されてなくて草', 'ﾀﾞﾒｪ…', 'しょぼーん', '慎重派ニキ',
  { text: '通行止め', color: red },
  '待てできてえらい', '別ルートで行こ',
]

function varsOf(tool: string, input: Readonly<Record<string, unknown>>): Record<string, string> {
  const command = typeof input.command === 'string' ? input.command : ''
  const query = [input.pattern, input.query, input.url].find(v => typeof v === 'string')
  return {
    tool: oneLine(tool.replace(/^mcp__/, ''), 18),
    file: basename(input.file_path ?? input.notebook_path ?? input.path),
    cmd: oneLine(command, 18),
    q: oneLine(typeof query === 'string' ? query : '', 12),
  }
}

/** 長いヒアドキュメントなどで正規表現が重くならないよう、頭のほうだけ見る */
const BASH_SCAN_CHARS = 1000

function bashSpecial(input: Readonly<Record<string, unknown>>) {
  const command = typeof input.command === 'string' ? input.command.slice(0, BASH_SCAN_CHARS) : ''
  return BASH_SPECIAL.find(s => s.re.test(command))
}

/** テストの出力に失敗の跡があるか（`npm test | tail` のように終了コードが隠れていても気づく） */
const TEST_FAILED_RE = /\b[1-9]\d*\s+(?:failed|failing|failures?)\b|^\s*FAIL\b|\bFAILED\b/m

export function testFailed(output: string): boolean {
  return TEST_FAILED_RE.test(output)
}

/** テストを走らせる Bash か */
export function isTestCommand(tool: string, input: Readonly<Record<string, unknown>>): boolean {
  return toolGroup(tool) === 'Bash' && typeof input.command === 'string' && TEST_RE.test(input.command.slice(0, BASH_SCAN_CHARS))
}

function fileKind(input: Readonly<Record<string, unknown>>) {
  const name = rawBasename(input.file_path ?? input.notebook_path ?? input.path)
  return name === '' ? undefined : FILE_KINDS.find(k => k.re.test(name))
}

const FILE_GROUPS: ReadonlySet<string> = new Set(['Read', 'Edit', 'Write'])

/** ツールを呼ぶ直前のコメント。ファイルの種類が分かれば、ときどきそれに反応する */
export function reactToToolStart(tool: string, input: Readonly<Record<string, unknown>>, rand: Rand): Draft[] {
  const vars = varsOf(tool, input)
  const group = toolGroup(tool)
  const special = group === 'Bash' ? bashSpecial(input) : undefined
  const kind = FILE_GROUPS.has(group) ? fileKind(input) : undefined
  const lines =
    special?.start ??
    (kind !== undefined && rand() < 0.4 ? kind.lines : undefined) ??
    // さわっているファイルや、走らせたコマンドそのものにも触れる
    (FILE_GROUPS.has(group) && fileName(input) !== undefined && rand() < 0.3 ? FILE_TEMPLATES : undefined) ??
    (group === 'Bash' && vars.cmd !== '' && rand() < 0.25 ? CMD_TEMPLATES : undefined) ??
    TOOL_LINES[group] ??
    TOOL_LINES.Other!
  return [vary(tint(draft(pick(lines, rand), vars), rand), rand)]
}

export type ToolOutcome = { isError: boolean; isDenied: boolean }

/** ツールが終わったあとのコメント。成功した普通の呼び出しには何も言わない（ほめるのは reactToToolOk） */
export function reactToToolEnd(tool: string, input: Readonly<Record<string, unknown>>, outcome: ToolOutcome, rand: Rand): Draft[] {
  if (outcome.isDenied) return [draft(pick(DENIED_LINES, rand))]
  const special = toolGroup(tool) === 'Bash' ? bashSpecial(input) : undefined
  if (outcome.isError) {
    const lines = special?.ng ?? ERROR_LINES
    return pickSome(lines, 2, rand).map(l => draft(l))
  }
  if (special?.ok !== undefined) return pickSome(special.ok, 2, rand).map(l => draft(l))
  return []
}

/** 成功したツール呼び出しへのほめ言葉。そのツールにネタがなければ何も言わない */
export function reactToToolOk(tool: string, input: Readonly<Record<string, unknown>>, rand: Rand): Draft[] {
  const lines = TOOL_OK_LINES[toolGroup(tool)]
  if (lines === undefined || lines.length === 0) return []
  return [vary(tint(draft(pick(lines, rand), varsOf(tool, input)), rand), rand)]
}

// ---- 連発・連続エラー・節目 ----

/** 同じ種類のツールが何回続いたら反応するか */
export const COMBO_AT: readonly number[] = [3, 5, 8, 12, 20, 30]
/** 1ターンのツール呼び出し回数の節目 */
export const MILESTONES: readonly number[] = [10, 20, 30, 50, 75, 100, 150, 200]
/** 作業を始めてからの経過時間（分）の節目 */
export const ELAPSED_MINUTES: readonly number[] = [1, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120]

/** 同じツールが続いたとき。{n} は回数、{tool} はツール名 */
export const COMBO_LINES: readonly Line[] = [
  '{tool} {n}連発', '{n}コンボ', '連打で草', '{tool}好きすぎ', 'また{tool}か', 'またそれｗ', '同じの{n}回目',
  'ループ芸', '{tool}祭り',
  { text: '{n}連撃', color: orange },
  '気に入ったんか', '{tool}職人', '擦りすぎ', '{n}連チャン', 'しつこくて草',
]

export const COMBO_BY_GROUP: Readonly<Record<string, readonly Line[]>> = {
  Read: [
    '読みすぎ', '読書家', 'まだ読む？', '{n}冊目', '図書館かな', '精読マラソン',
  ],
  Edit: [
    '編集ラッシュ', '直しまくり', '{n}回目の修正', '手直し職人', '差分祭り',
    { text: 'エディタ燃えてる', color: orange },
  ],
  Write: [
    'ファイル量産', '{n}個目の新作', '書き下ろしラッシュ', '生成工場', '筆がノッてる', '出版社かな',
  ],
  Bash: [
    'コマンド連打', 'ハッカーかな', '{n}コマンド目', 'ターミナル住人', '黒い画面好きすぎ',
    { text: 'シェル芸人', color: cyan },
  ],
  Search: [
    '探しすぎ', '検索{n}連発', '見つからんのか', '捜索隊', '迷子？', 'ｻｰﾁｻｰﾁ',
  ],
  Web: [
    'ググりすぎ', 'ネットサーフィン', '{n}ページ目', '調べ魔', '検索沼', 'タブ開きすぎ',
  ],
  Agent: [
    '分身しすぎ', '{n}体目', '部下多すぎて草', '軍団できた', 'マネージャー業', '人海戦術',
  ],
}

/** エラーが続いたとき。{n} は何回続いたか */
export const ERROR_STREAK_LINES: readonly Line[] = [
  { text: '{n}連続エラーで草', color: green },
  { text: '沼', color: purple, isBig: true },
  'ハマってて草', '負けるな', '{n}連敗中', 'エラー{n}連発', '次こそ正直', 'ループしてない？',
  { text: 'ふんばれ', color: pink },
  { text: '{n}連続はやばい', color: red },
  '抜け出せない', '{n}れんさ！',
]

/** ツール呼び出し回数の節目。{n} は回数 */
export const MILESTONE_LINES: readonly Line[] = [
  { text: '{n}コンボ！', color: orange, isBig: true },
  'ツール{n}回目',
  { text: '{n}HIT', color: yellow, isBig: true },
  { text: '祝{n}回', color: pink },
  '{n}回突破',
  { text: '{n}到達！', color: cyan },
  '記念すべき{n}回', '{n}回目きた', '実績解除：{n}回',
  { text: 'まだ止まらない', color: red },
  'ノッてきた',
]

/** 経過時間の節目。{min} は分 */
export const ELAPSED_LINES: readonly Line[] = [
  '{min}分経過', '開始から{min}分',
  { text: '{min}分耐久', color: orange },
  { text: '祝{min}分', color: yellow },
  'もう{min}分か', '{min}分がんばってる', '{min}分見てる',
  { text: '【時報】{min}分', color: cyan },
  '{min}分ずっと作業', '{min}分ノンストップ', '{min}分あっという間',
]

export function reactToCombo(tool: string, n: number, rand: Rand): Draft[] {
  const own = COMBO_BY_GROUP[toolGroup(tool)]
  const lines = own !== undefined && own.length > 0 && rand() < 0.5 ? own : COMBO_LINES
  return [tint(draft(pick(lines, rand), { n: String(n), tool: oneLine(tool.replace(/^mcp__/, ''), 18) }), rand)]
}

export function reactToErrorStreak(n: number, rand: Rand): Draft[] {
  return [draft(pick(ERROR_STREAK_LINES, rand), { n: String(n) })]
}

export function reactToMilestone(n: number, rand: Rand): Draft[] {
  return [tint(draft(pick(MILESTONE_LINES, rand), { n: String(n) }), rand, 0.5)]
}

export function reactToElapsed(minutes: number, rand: Rand): Draft[] {
  return [tint(draft(pick(ELAPSED_LINES, rand), { min: String(minutes) }), rand, 0.5)]
}

// ---- ターン ----

export const OTSU_LINES: readonly Line[] = [
  'おつ', '乙', 'おつかれー',
  { text: '8888888', color: yellow },
  'うぽつ', '神回', 'おつおつ', 'おつでした', '有能',
  { text: '優勝', color: yellow },
  'GG', '天才か', 'ナイス', '助かった', 'ありがてぇ', '見応えあった', '次回も期待', 'いい回だった', 'ﾊﾟﾁﾊﾟﾁ',
  '＼(^o^)／', '( ˘ω˘ )', '仕事はやい', '完走おめ', 'お見事', '満足', 'グッジョブ',
  { text: 'つよい', color: cyan },
  { text: '尊い', color: pink },
  'リピ確定', 'さすが', 'ﾉｼ', '神対応', '感動した',
]

/** ターン終了時にときどき上に出す */
export const OTSU_BANNERS: readonly Draft[] = [
  { text: 'おつかれさまでした！', color: orange, pos: 'ue', isBig: true },
  { text: '本日の配信は終了しました', color: yellow, pos: 'ue', isBig: true },
  { text: '次回も見てね', color: orange, pos: 'ue', isBig: true },
  { text: 'ご視聴ありがとうございました', color: yellow, pos: 'ue', isBig: true },
  { text: '本日の作業完了！', color: orange, pos: 'ue', isBig: true },
  { text: 'ミッション完了！', color: yellow, pos: 'ue', isBig: true },
]

export const ABORTED_LINES: readonly Line[] = [
  'あっ', '止められてて草', '中断ｗ', 'ストップ！', '放送事故', '待ったかかった', 'ﾌﾞﾂｯ', '強制終了で草',
  'え、終わり？', '急ブレーキ',
  { text: 'カット！', color: yellow },
  '方針転換かな', 'いいところだったのに',
]

export const TURN_ERROR_LINES: readonly Line[] = [
  '鯖落ち？', 'エラーで草', '回線…', '放送事故', '固まった？', 'F5連打', 'しばらくお待ちください', 'API不調？',
  '再起動はよ',
  { text: '通信エラー', color: red },
  'ぐぬぬ',
]

export const REFUSAL_LINES: readonly Line[] = [
  '断られてて草', 'お断りされた', 'NGワード？', 'きっぱり断った', '線引きしっかり', 'ガード固い',
  'それはダメらしい', '真面目か',
]

/** 3分以上かかったターン */
export const LONG_TURN_LINES: readonly Line[] = [
  '長丁場おつ', '大作', '見届けた', '耐久配信だった', 'マラソン完走',
  { text: '大河ドラマ', color: yellow },
  '映画一本分', 'ガチ回', '根気すごい', '途中で寝てた',
]

/** 8秒かからなかったターン */
export const QUICK_TURN_LINES: readonly Line[] = [
  'はやい', '即答で草', '速すぎ', '一瞬', '秒で終わった',
  { text: 'RTA', color: cyan },
  '早業', '見逃した', '光の速さ', '瞬殺',
]

/** ツールを15回以上使ったターン */
export const MANY_TOOLS_LINES: readonly Line[] = [
  '働きすぎ', 'ツール使いまくりで草', '社畜の鑑', 'フル稼働', '手数の暴力', '休んで', 'ワーカホリック',
  '残業おつ', '労働の鬼',
  { text: 'MVP', color: yellow },
]

/** ツールを1回も使わなかったターン */
export const NO_TOOLS_LINES: readonly Line[] = [
  '口だけで解決', 'トークだけ回', '雑談回', '手ぶらで草', '知識で殴る', 'ノーツール縛り', '喋りで勝負',
  '物知りニキ',
]

/** エラーを3回以上出しながら終わったターン */
export const TOUGH_TURN_LINES: readonly Line[] = [
  '苦戦したね', '泥臭い回', 'よく立て直した', '試行錯誤おつ', 'エラーまみれ', '茨の道だった',
  { text: '粘り勝ち', color: orange },
  '七転び八起き',
]

export type TurnSummary = {
  reason: 'answer' | 'aborted' | 'refusal' | 'error'
  durationMs: number
  tools: number
  errors?: number
}

export function reactToTurnEnd(turn: TurnSummary, rand: Rand): Draft[] {
  switch (turn.reason) {
    case 'aborted':
      return pickSome(ABORTED_LINES, 2, rand).map(l => draft(l))
    case 'error':
      return pickSome(TURN_ERROR_LINES, 2, rand).map(l => draft(l))
    case 'refusal':
      return pickSome(REFUSAL_LINES, 1, rand).map(l => draft(l))
    case 'answer': {
      // 流量の上限で後ろから削られるので、このターンならではのコメントを「おつ」より先に並べる
      const out: Draft[] = []
      if (turn.durationMs > 3 * 60_000) out.push(draft(pick(LONG_TURN_LINES, rand)))
      else if (turn.durationMs < 8_000) out.push(draft(pick(QUICK_TURN_LINES, rand)))
      if (turn.tools >= 15) out.push(draft(pick(MANY_TOOLS_LINES, rand)))
      else if (turn.tools === 0) out.push(draft(pick(NO_TOOLS_LINES, rand)))
      if ((turn.errors ?? 0) >= 3) out.push(draft(pick(TOUGH_TURN_LINES, rand)))
      out.push(...pickSome(OTSU_LINES, 4, rand).map(l => vary(draft(l), rand)))
      if (rand() < 0.35) out.unshift(pick(OTSU_BANNERS, rand))
      return out
    }
  }
}

// ---- 待ち時間のつぶやき ----

export const AMBIENT_LINES: readonly Line[] = [
  'じー', '見守ってる', '作業用BGM欲しい', '実況スレから来ました', '1コメ', '有能', '天才か', '頼もしい',
  '安心感ある', '落ち着く', 'ずっと見てられる', '手際いい', '癒し', '尊い', 'いいぞー', 'その調子', 'ファイト',
  '応援してる', '静かだな', '過疎ってる？', 'わかる', 'あるある', 'これは期待', 'いい流れ', '安定感',
  'プロの犯行',
  { text: '職人の朝は早い', color: orange },
  'nice', 'kwsk', '後方腕組み勢', 'お茶おいしい', 'ポテチ開けた', '正座で見てる', 'これ何の配信？',
  'タイムシフトから', 'リピート確定', 'ここテストに出る', 'メモメモ', 'ほぼ毎日見てる', '手元見たい',
  'タイピング音すき', 'じわじわくる',
  { text: 'Claudeくん推せる', color: pink },
  '来週も見る', 'うまい', 'さすが', 'すこ', 'ｿﾜｿﾜ', 'ドキドキ', '集中してる', '邪魔しないように', '小声で応援',
  '平和', 'まったり', '作業捗る', '一緒に作業してる', '地味に好き', '玄人好み', 'ゆっくりでいいよ',
  '寝落ちしそう', '(・∀・)', '(´・ω・`)', '(ﾟ∀ﾟ)', '( ˘ω˘ )', '＼(^o^)／', '(｀・ω・´)', '(・ω・)',
  'ヽ(・∀・)ﾉ', '(っ´ω`c)', '(´-ω-`)', '（＾ω＾）', '(*´ω｀*)',
]

/** まだツールを使わずに考えているとき */
export const THINKING_LINES: readonly Line[] = [
  '長考', '脳内会議中', 'ひらめき待ち', '頭フル回転', '考えてる考えてる', '熟考タイム', 'うーん…',
  '何か企んでる', 'ゾーン入った', 'ぐるぐる', '計算中', '知恵熱でそう', '寝てる？', '溜めてる',
  '嵐の前の静けさ', 'Now Loading...', '長考に入りました', '次の一手は…', '静寂…', '将棋の解説欲しい',
  '封じ手かな', 'ﾁｯﾁｯﾁｯ', '頭の中ではもう100行', '読み筋いくつあるんだ', '沈黙が長い', '黙考', 'この間がすき',
  '思考の海に潜った', '何を思いついたんだ', '答えはもう出てそう', '腕組みしてそう', '天井とにらめっこ',
  '脳内ペン回し', 'ホワイトボード貸そうか', 'ここが一番大事なとこ', '熟成中', '言葉を選ぶ時間', 'ｶﾁｺﾁｶﾁｺﾁ',
  '推理パート', '方針決まった？', '(-_-)ｳｰﾝ', '(´・_・`)ﾝｰ', '試験前の顔', '選択肢を消去法で',
  '頭の中で付箋貼ってる', '構想5年みたいな顔', '瞑想タイム', '悟り開きそう', 'アイデア降りてこい',
  '電球まだ光らない', '唸れ脳みそ', 'ムムッ', 'ファン回る音する', '問題文読み直してる？', '地図を広げてる段階',
  'ここで間違えると痛い', '溜め技くる', 'チャージ中', '長い詠唱', '思考ログ公開して', '考察班集合',
  '初手Bashと見た', '最初はRead派に1票', '初手で性格出る', '様子見', 'お、止まった', 'ﾎﾟｸﾎﾟｸﾎﾟｸ',
  '間の取り方が玄人', '俺なら即ググる', '何パターン考えてるの', 'プランA、B、C…', '精神統一',
  '誰か急かしてる？', '沈黙は金', '……', 'ん？', '脳内タブ何個あるの', '長考に好手なしって言うけど',
  '次のセリフ待ち', '静かな立ち上がり', 'いきなり動かないの偉い',
  { text: '考え中', color: cyan },
  { text: 'ｷｭｲｰﾝ', color: blue },
  { text: '何か来るぞ', color: orange },
  { text: '今は種まき', color: green },
  '考えてるだけで絵になる', '黙ってても強者感', 'これは長くなるぞ', 'まだ動かんｗ', '息止めて見てる',
  'AIも迷うんだな', 'ここで質問返しされたら笑う', '考え事してる猫みたい', '書く前に考えるの大事',
  'さあどう出るか', '設計図まだ白紙',
]

/** さっきエラーが出たとき */
export const AFTER_ERROR_LINES: readonly Line[] = [
  '切り替えていけ', 'まだ慌てる時間じゃない', '立て直せ', '次いこ次', '失敗は成功のもと', 'リトライ！',
  '想定内', '計画通り', 'こっからこっから', '落ち着いて', '気にすんな', 'そういう日もある', 'エラーは友達',
  'まだいける',
  { text: '負けるな', color: pink },
  'ログの3行目が怪しい', 'はい深呼吸', '電源抜いて挿し直せ', 'わかる、それ俺もなった', '画面が真っ赤',
  'トレースが巻物級', '英語だけど読めば分かる', 'typoじゃね？', '閉じカッコ数えて', '大文字小文字かも',
  'キャッシュのせいでは', 'node_modules焼こう', '俺の環境では動く', '昨日は動いてたのに', 'お祓い案件',
  '塩まいとく', '今日は仏滅', '大丈夫、誰も見てない', 'いや全員見てたよ', 'スクショした', '切り抜き確定',
  'エラー出てからが勝負', '良いエラーだ', '仮説ひとつ消えた', 'むしろ前進', '泣くな', '(つд⊂)', 'ｵﾛｵﾛ', 'ｱﾜﾜﾜ',
  'ﾋﾞｸｯ', '心臓に悪い', '一瞬ヒヤッとした', 'エラー文そのまま検索', '同じ症状の人いそう',
  '去年の自分を見てるよう', '新人時代思い出す', '胃がキリキリ', '人のエラー見ると安心する', '仲間だな',
  '一発で通ったら逆に怖い', 'ブレークポイントの出番', '変数を疑え', '二分探索の時間だ', '一個前に戻すのもあり',
  '焦りは禁物', 'エラー文が呪文', '草も生えない', '再現するならまだ勝てる', '赤字は伸びしろ', '修行パート',
  '序盤の負けイベ', '残機1減った', 'セーブしてた？', '撤退も勇気', '一回寝よ', '朝やったら一瞬で直る',
  '散歩すると直る説', 'アヒルに話しかけて', '誰でもやるやつ', '何が起きた？', '言わんこっちゃない',
  'フラグ回収お見事', '(・_・;)', 'Σ(・□・;)', 'ノーエラー回は幻', 'メッセージ親切じゃん', 'ノーカンノーカン',
  { text: 'いける、次は通る', color: orange },
  { text: 'ここで折れるな', color: pink },
  { text: '赤字注意報', color: red },
  'エラー吐くのも仕事のうち', 'バグの方から来てくれた', '派手にいったなｗ',
]

/** 作業が2分を超えたとき */
export const LONG_WORK_LINES: readonly Line[] = [
  '長丁場', '耐久配信', '作業用動画', 'まだ続く', '何分経った？', '水分補給しろ', 'トイレ行ってくる',
  'ここまで見た人挙手', '超大作の予感', 'お菓子補充', 'エンドレス', 'ストレッチしよ', '根気すごい',
  '休憩も大事', '長編になってきた', '途中から見た人いる？', '肩こってきた', '終わりが見えない', '第3章突入',
  '映画なら中盤', '最初のお題なんだっけ', '冒頭の記憶が遠い', '前回までのあらすじ', '今来た人に説明して',
  'カフェイン切れそう', '冷めたお茶すする', 'ご飯炊ける音で我に返る', '正座やめよ', '目薬さしとこ',
  '腰がやばい', 'スマホが熱々', '通勤中に見始めたのに', '昼休み終わる', '寝る前にちょっとのつもりが',
  '気づいたら見入ってた', '時間が溶けていく', '何合目？', '地下何階まで行くの', '一回コミットしとけ',
  'その集中力わけて', 'AIは疲れ知らずか', '骨太な回', '大工事', '年末の大掃除', '夏休みの宿題',
  '卒論書けそうな長さ', 'そろそろ山場か', '長いけど飽きない', '起きたらまだやってた', '二周目勢です',
  '最初から見てる勢', '皆勤賞いただきます', '最後まで付き合う', '完走したら赤飯', 'ピザ頼んだ',
  '作業BGM一周した', 'ラジオ感覚で聞いてる', 'シークバーが仕事してない', '時計二度見', 'お題そんな重かったっけ',
  '思ったより大物', 'あと何話あるの', '湯船で視聴中', '( -_-)ﾉ旦~', 'もう少しで終わる気がする',
  '手が止まらないのすごい',
  { text: '長期戦の構え', color: orange },
  { text: '体力ゲージまだ満タン', color: green },
  { text: 'まだ序章説', color: purple },
  'この配信いつ終わる？', '一句詠めそう', '長えｗ', 'おやつ二回目', '充電あと8%', '長いのは丁寧な証拠',
  '画面焼けしそう',
]

/** ツールを立て続けに使っているとき */
export const BUSY_LINES: readonly Line[] = [
  '作業はえーよ', 'TAS', '倍速', '目が追いつかない', '残像だ', 'ﾊﾞﾊﾞﾊﾞﾊﾞ', 'RTA勢', '早送り？',
  'フルスロットル', 'キーボード壊れる', '怒涛の展開',
  { text: '無双', color: red },
  '指が見えない', '作業量えぐい', 'コメントが追いつかん', '手元どうなってんの', '千手観音かな',
  'ログが滝のよう', '一時停止して', '0.5倍速で見たい', 'もう何してるかわからん', '置いてかないで',
  '待って待って', '速い速い速い', 'ﾀﾞﾀﾞﾀﾞﾀﾞ', '連射機能付きか', 'ブレーキどこ', '暖機運転終了',
  '本気出してきた', '今日イチのキレ', 'ベルトコンベア', 'わんこそば状態', 'リズムゲー始まった',
  'フルコンボいけ', 'BPM高すぎ', '摩擦で発火しそう', '手首大丈夫？', '速すぎて逆に落ち着く',
  '見てるだけで疲れる', '情報の洪水', 'ついていけてる人いる？', '3行前がもう昔', '瞬きしたら終わってた',
  '一瞬で3個やった', '手さばきが異次元', 'ガトリング', '雨あられ', 'まだ上がるのか', '4速入った', '(ﾟдﾟ)ﾎﾟｶｰﾝ',
  '(@_@)', 'はっや', 'ちょ、速', 'どこで息継ぎしてるの', '作業密度バグってる', 'APMいくつだよ', '一人で三人分',
  '休憩という概念がない', '弾幕より速いの反則', 'ログ読む前に次いってる', '新幹線通過中',
  { text: '疾風迅雷', color: cyan },
  { text: 'フィーバータイム', color: red, isBig: true },
  { text: 'ﾋﾞｭﾝﾋﾞｭﾝ', color: blue },
  'これ録画して後で見る', '動体視力ためされてる', 'いま何個やった？', '目が乾く', 'スクロールバーが縮む',
  '工場見学ツアー', '俺の一日分が一瞬', 'ポップコーン食べ忘れ',
]

/** たまに流れる、同じ文字を並べた弾幕 */
export const WALL_LINES: readonly Line[] = [
  { text: 'ｗｗｗｗｗｗｗｗｗｗｗｗ', color: green },
  { text: '88888888888888', color: yellow },
  { text: 'ｷﾀ━━━(ﾟ∀ﾟ)━━━!!', color: yellow, isBig: true },
  { text: 'うおおおおおおおおお', color: orange },
  { text: '↑↑↑↑ここすき↑↑↑↑', color: pink },
  { text: '草草草草草草草草草草', color: green },
  { text: 'ﾜｰﾜｰﾜｰﾜｰﾜｰﾜｰ', color: cyan },
  { text: '神神神神神神神神神神', color: purple },
  { text: '！！！！！！！！！！', color: red },
  { text: 'wktkwktkwktk', color: blue },
]

// 作業中のつぶやきのジャンル。いろいろな人が見ている感じを出すため、ジャンルを先に選んでから中身を選ぶ

/** 視聴者の雑談（ごはん・天気・仕事など、作業と関係ない話） */
export const SMALLTALK_LINES: readonly Line[] = [
  '晩ごはん麻婆豆腐', 'ポテサラにりんご賛成', '新作プリン当たりだったわ', 'のり塩しか勝たん',
  '湯切り失敗して麺が床に', 'エナドリ二本目いきます', '白湯がしみる…', '実家から柿どっさり', 'ピザ頼んじゃった',
  '納豆まぜまぜ中', 'おにぎりの具なに派？', '夜食のラーメンは罪の味', '冷凍うどん万能説',
  'たこ焼きひっくり返すの楽しい', '卵かけご飯で十分', 'ミルクティーに砂糖3杯', '寿司食いてえ',
  '弁当の唐揚げは最後派', '梅干しすっぱっ', 'お茶こぼしたｱｯ', 'カレーは二日目が本番', 'グミ硬すぎて顎が死ぬ',
  'もぐもぐ', '昨日3時間しか寝てない', '二度寝は正義', '昼寝したら夕方', '目覚まし五個かけてる',
  '布団から出られん', 'ねむ', 'まぶたが重力に負けそう', 'あくび止まらん', '寝坊して朝ごはん抜き',
  '(つд⊂)ｺﾞｼｺﾞｼ', '雨の音すき', '外、台風みたいな風', '傘忘れた人です', '洗濯物ぬれた…', '湿気で髪が爆発',
  { text: '雷鳴ってビクッ', color: yellow },
  '部屋寒くない？', 'エアコンの温度で家族と冷戦中', '晴れたから布団干した', '窓開けたら虫が侵入',
  '電車で見てる勢', '満員電車でぺちゃんこ', '一駅乗り過ごした', 'バス全然来ないんだけど',
  '自転車パンクしたんだが', '明日のプレゼン資料白紙', 'レポートあと二千字', '課題しながらﾁﾗ見',
  '上司からチャットきたｺﾜｲ', '定時ダッシュ成功', '残業確定のお知らせ', 'テスト前なのに何してんだ',
  '来週から研修か', '有給とった', '在宅最高', '会議延びすぎでは', 'バイト終わり', 'シフト表見て絶望',
  '部活でへとへと', '塾の自習室から', '経費精算は明日の自分へ', '月曜こないで', '昼休みあと5分',
  { text: '給料日', color: yellow },
  '金欠', '猫が膝の上で寝ちゃって動けない', 'インコが着信音マネする', '猫にキーボード踏まれてjjjjj',
  'ハムスター脱走事件', '金魚がエサくれダンス', '犬の寝言かわよ', '亀の日光浴タイム',
  '犬が自分のしっぽ追ってるｗ',
  { text: 'メダカに赤ちゃん誕生', color: green },
  'セールでまた積んだ',
  { text: 'ガチャ爆死', color: purple },
  'デイリー消化がもはや義務', 'スタミナあふれさせがち', 'ランクマ五連敗', '押し入れから古いゲーム機',
  'パズルゲーにハマり中', '机の上が地層', 'モニター増設計画', '椅子ギシギシ問題', '加湿器が給水しろって',
  'サボテンすら枯らせる才能', '掃除しなきゃなー', 'ゴミ出し忘れてた…', '宅配きたので離席', '隣で工事ガガガガ',
  'スマホの充電あと3%', 'Wi-Fiがカクカク', '冷蔵庫開けて何しに来たか忘れた', '財布がレシートでパンパン',
  '個人開発止まってる', 'ブログ三日坊主', '自作キーボード組んでる', 'ポートフォリオ作り中',
  '資格の勉強サボり中', '英単語帳ひらいたまま', '腕立て10回で限界', '編み物しながら', 'プラモの塗装乾き待ち',
  '家計簿つけなきゃ', '自分のPRも溜まってる', '子ども寝かしつけ完了', '親に何見てるか聞かれた',
  '米10キロ担いで帰宅', '美容院いつ行こう', '歯医者の予約あしたか…', 'しゃっくりが長期戦',
  'くしゃみ出そうで出ない', '小指をタンスの角に', 'ただいま', '風呂上がり', '散歩してこよ',
  'みんなの推し調味料は？', '今どこから見てる？', '誰か起きてる人ー', '明日って祝日だっけ？',
  'レジで小銭ぶちまけ', '腹へったー', '今日ちょっといい日', '筋肉痛', '二日酔い', '鼻水ずるずる(´Д｀)',
  '目が乾く',
]

/** いろいろな言い方の応援 */
export const CHEER_LINES: readonly Line[] = [
  '信じて待つのみ', '君ならやれる', '最後まで見届けるぞ', '焦らず一歩ずつ', '肩の力抜いてこ',
  '一回深呼吸しよっか', '丁寧なのが一番', '今日はいける気がする', '背中そっと押しとく', '画面に向かって合掌',
  '朝まで付き合うよ', '地道が最強', '応援うちわ作ってきた', 'ペンライト両手持ち', '届けこのエール',
  '勝ち筋、見えた', '迷ったら戻ればいい', 'やり直しは何度でも', '差し入れのおにぎり置いとく', '頼りにしてます',
  'きっとうまくいく', '今日も味方です', '気合い注入', '元気おすそわけ', '勝利の舞を奉納', 'ご武運を',
  '勝手に応援団長', '横断幕できあがり', 'ちゃんと進んでるよ', '見てる人いるからね', '一生推す', '主役は君だ',
  '伸びしろしかない', 'ここが踏ん張りどころ', 'いつも通りでOK', '無理しないでね', '勝ったらケーキな',
  '祝杯の準備しとこ', 'ゴールは近いぞ', 'あとひと押し',
  { text: 'えいえいおー', color: red },
  { text: '押せ押せ！', color: orange },
  '余裕っしょ', '自信持っていいよ、ほんとに', '元気もらってるのはこっち', 'がんばる姿すき',
  '応援コメ連投するね', '一緒に走ってる気分', 'いよいよ見せ場', '心の中で旗ぶんぶん', '君のペースでいい',
  'そのまま突き抜けろ',
  { text: '希望の光', color: yellow },
  '結果は後からついてくる', '外野からテレパシー', 'よし、いこう', '胸を張れ', 'ｶﾞﾝﾊﾞｯ!',
  { text: '託した', color: orange, isBig: true },
  'ﾌﾚｰ(*´∀｀)ﾉ',
  { text: 'このコメントが届きますように', color: pink },
  'こまめなセーブ大事', '地元の星', '画面の向こうで拍手', '頼んだぞ', 'うまくいかなくても好きだよ',
  'ここまで来たのが既に偉業', '褒め言葉ストック済み', '詰まったらお茶休憩', 'GO!GO!',
]

/** 配信そのものへの実況・ツッコミ */
export const PLAY_BY_PLAY_LINES: readonly Line[] = [
  'さて本題か', 'おっと方向転換', '情報量えぐ', '何が起きてるの', '素人目にもすごい', 'お手並み拝見', 'Σ(ﾟдﾟ)',
  '有識者いる?', '解説席あいてます', '迷わず行くね', '判断はやっ', '今の間なに?', '黙々とやってる',
  '淡々としてて好き', '無言の圧', 'いろいろ開いてる', '順調っぽいな', '雲行きが…', 'ナイス判断',
  '何合目くらい?', 'これ伏線？', 'フットワークが軽快', 'そっち行くんだ', '意外なルート', '回り道も味',
  '見てるこっちが緊張', 'あ、空気が変わった', '一気に進んだ', '牛歩だけど確実', '地味パート',
  'パズル組んでる感じ', '準備運動かな', 'ここから加速しそう', 'テンポいいの気持ちいい', 'リズム出てきた',
  '無駄ゼロ', '手数多いな', '腰を据えてるね', '慎重だね', '石橋叩いて渡るタイプ', '堅実', '大胆だな',
  '攻めるねぇ', '守りの姿勢', 'ひと呼吸タイム', 'なんか良さそう', 'なにこれすご', 'ふむ', 'へぇ', 'ほう…',
  'おっ', 'おや', 'ほんまか', 'うそやん', 'さっきの何だったの',
  { text: '脳の処理落ち', color: blue },
  'まるで料理番組', '何もわからんけど楽しい', '雰囲気で見てる', 'カタカナ語の嵐', 'いま誰のターンなの', 'ﾀﾀﾀﾀｯ',
  'ドキュメンタリーみ', '現場からは以上です', 'カメラさん寄って', '生放送の緊張感', '要チェックや',
  '目が離せない', '( ´_ゝ`)ﾌｰﾝ', 'ログが流れていく',
  { text: '文字の滝', color: cyan },
  'スクロールバーちっさ', '今の高等テクでは', '完全に置いてけぼり', '想像の斜め上', '王道の攻め',
  '本気モード突入', '見てるだけなのに疲れたｗ', '急に真顔で草', '視線が右往左往', 'どこに向かってるのか楽しみ',
  'ここ録画しとけばよかった', 'これは長くなるぞ', '一旦様子見か', 'そろそろ山場', '設計図が見えてる人の動き',
  '体感まだ序盤', '(・_・;)', 'ここBGM変わるとこ', 'ハラハラ',
]

/** プログラマのあるある・小ネタ */
export const DEV_TALK_LINES: readonly Line[] = [
  'vimの閉じ方まだググる', ':wqをSlackに誤爆', 'Emacsはもはや住処', '拡張入れすぎてVS Codeが亀',
  'エディタ戦争、もう飽きた',
  { text: 'nanoで何が悪いんだ', color: cyan },
  '結局メモ帳最強説', 'タブ派、ここにいます', 'スペース2つ以外は異端', 'data2_final_v3', 'tmpが本番で生きてる',
  'utilsが育ちすぎる問題', '変数a,b,cは事件', 'flgって書くのやめよ',
  { text: 'isNotDisabledは罪', color: purple },
  'コミットメッセージ「修正」', 'git blameしたら犯人自分', '.DS_Storeまた混入', 'squash派とmerge派の溝',
  'wipコミット47連', 'mainに直pushは禁忌', 'CIでだけ落ちるの何なん', 'YAMLのインデントで事故',
  'リトライで通るテストは信用ゼロ', 'CI40分待ちは拷問',
  { text: '金曜17時以降のリリース禁止', color: red },
  '続きは月曜の自分が', '金曜だぞ', '誰も触れない聖域ファイル', '3000行の関数、実在します',
  '「なぜか動く」ってコメント', '書いた人もう退職済み', 'jQueryまだ現役です', 'goto文…', 'コメントと実装が真逆',
  'TODO: 2015年', 'READMEだけ3年前', 'ドキュメントは生もの', '社内Wikiは墓場', 'その会議、メールでよくない？',
  '見積もりは3倍しとけ', '「ちょっと直すだけ」が一番重い', '残り1割に9割', 'ﾃﾞｽﾏｰﾁ', 'エナドリは寿命の前借り',
  'コーヒー切れでIQ半減', '椅子にだけは金かけろ', '腰をいたわれ', '自作キーボード沼へようこそ',
  '赤軸か茶軸か論争', 'ショートカット覚えると世界変わる', 'マウス触ったら負け', 'ダークモード以外ありえん',
  'ライトモード派、肩身せまい', '回答が11年前のやつ', '「解決しました」だけの人', 'ググれば勝ち',
  '人間よりAIのレビューが丁寧', '補完に先を読まれる日々', 'AIについ敬語つかう', 'モノレポ移行、3ヶ月コース',
  'node_modulesは異次元', '依存のアプデは月曜に', 'semverを信じすぎるな', 'セミコロン戦争まだやる？',
  'ASIに命あずける勇気', 'null安全は人類の希望', 'null≠undefined', 'NaNは自分と等しくない',
  { text: 'タイムゾーンは魔物', color: orange },
  '夏時間、誰得なの', 'とりあえずUTCで保存', 'うるう年テスト書いた？', '2038年問題、あと12年', '正規表現は呪文',
  '後読みとか誰が読むの', '配列は0から数えろ', '<= と < で丸1日', 'フェンスポスト問題',
  'とりあえずキャッシュ消せ', '再起動した？', 'ログを読め、話はそれからだ',
  { text: 'ラバーダックに話しかけろ', color: yellow },
  'ステップ実行で日が暮れる', 'console.log消し忘れ', '0.1+0.2≠0.3', '文字化けはだいたいSJIS', 'UTF-8一択',
  '全角スペースは見えない敵', '僕の環境では動きます', 'Dockerなら動く、は幻想', '深夜のコードは翌朝読め',
  'nitsだけで30件', '動く。なぜ', 'アラートは寝た瞬間に鳴る', 'オンコール週は風呂もスマホ持参',
  'ステージングでは平和だった', 'ポストモーテムは文学', '車輪の再発明は楽しいぞ', '小さく作って小さく出せ',
  'YAGNIって言いたいだけ', 'DRYしすぎも地獄', '継承より合成', 'マジックナンバー42',
  { text: '空のcatchは犯罪', color: red },
  'evalは悪', 'カバレッジ100%は宗教', 'テストのないコードは祈り', '3日前の自分が一番の敵', '仕様変更は突然に',
  '「軽微な修正」とは', '言語なんてただの方言', 'Lispの括弧で溺れる夢', 'z-index: 99999',
  { text: 'Excel方眼紙は文化遺産', color: green },
  '仕様です(震え声)', 'LGTM(見てない)', 'N+1', '// FIXME', 'segfault', '∞ループ', 'wontfix', 'sudo !!',
  '身に覚えが…', '_(:3」∠)_', 'ｺﾞﾌｯ', '耳が痛い',
  { text: '胃が…', color: purple },
  'ｸﾞｻｯ',
  { text: 'ﾌﾞｰﾒﾗﾝ', color: orange, isBig: true },
]

/** 配信者やほかの視聴者への質問 */
export const QUESTION_LINES: readonly Line[] = [
  'これ何言語？', 'フォント何使ってるの', '配色テーマ教えて', 'キーボード何使ってる？', 'これ仕事の案件？',
  '趣味で作ってるやつ?', 'で、何作ってるんだっけ', '途中参加です、今どこ', 'これOSS？', 'リポジトリ非公開？',
  { text: 'Claudeくん何年目？', color: pink },
  'AIに全部任せて平気？', '中の人いる?', '寝なくて大丈夫なの', '1日何時間やってるん', 'テスト書くコツ教えて',
  'モックってどこまで使う？',
  { text: 'タブ派？スペース派？', color: cyan },
  'vimキーバインド勢？', 'Mac？Windows？', 'WSLでも動く?', 'Nodeのバージョンいくつ', 'npmかpnpmかbunか',
  '型って書いたほうがいい？', '初心者お断り配信？', '独学でもいけるかな', '入門書のおすすめ求む',
  '何から勉強すればいい', 'アーカイブは？', '今日何時までやる予定', '次回いつ？', 'ここ質問OK？',
  'さっきのコマンド何', '今なにが起きた？', 'それで直るの何故', 'え、それ本番用??', '会社で使ってもOK?',
  'ライセンス何？', '自分のPCでも可能？', 'メモリ何GB？', 'Copilotと比べてどう？', 'AIって嘘つかない？',
  '間違えたら誰が直すの', '見てるだけで上達するもん？', 'どうしたらそんな速さに', 'コメントは英語で書く？',
  '変数名ローマ字はアリ？', '正規表現どこで覚えた', 'rebase派？merge派？', 'コミットはどの粒度で？',
  '1PRって何行まで？', 'レビュー担当って誰', 'CIは何？Actions？', 'これ何分で終わりそう？',
  { text: 'エラーってどこから読む？', color: yellow },
  'デバッガ使わない主義？', '環境変数ってどこに書く？', '結局Reactが正解？', 'フロントとバックどっち寄り',
  '文系でもなれますか', '何歳から始めた？', '誰か解説プリーズ', 'これってすごいこと？', '今の笑うとこ？',
  '待って、どういうこと', 'えっ、なぜ', 'ん？', '？？？', '推し言語は？',
  { text: '一番つらかったバグは？', color: orange },
  '最近気になってる技術とか', 'この弾幕どうやって出してる', '英語読めないと無理？',
]

/** 視聴者の自分語り */
export const VIEWER_STORY_LINES: readonly Line[] = [
  '昨日これで終電アウト', 'うちまだFTPでデプロイ',
  { text: '新人のとき本番DB消した', color: red },
  '先輩のvimrc丸パクリ', '初PRでコメント80件', '卒論のコードは封印済み', 'ガラケーアプリ作ってた世代',
  '面接のFizzBuzzで詰んだ', '今日リリース日でガクブル', '上司も見てるらしい', '有給とって正座待機',
  '寝かしつけ終わって参戦', '通勤電車から', 'Scratch出身です', '文系卒、転職3年目', '40で未経験から入ったよ',
  '定年後の趣味がこれ', '現役高校生！', '課題やらずに見てるｗ', '明日締め切りなのに…', '社食でこっそり',
  { text: '猫がEnter押して本番反映', color: pink },
  '昔は全部Perlだったなぁ', '前の会社、レビュー文化ゼロ', '社内システムがPHP5', 'タイムゾーンで請求ずれた事件',
  'ハッカソンで優勝経験あり', '去年の年末年始はオンコール', '社内LT、来週デビュー', '引き継ぎ資料が付箋1枚',
  'コメントに前任者の愚痴', 'テスト書いたら神扱い', 'ビルド待ち＝筋トレタイム', 'セミコロン1個に2時間',
  'CSVをExcelで開いて事故', 'typo1文字で始末書', '前の現場、zipでバージョン管理', 'マクロおじさんと呼ばれてる',
  '初めて動いた時ちょっと泣いた', 'キーボード3台目突入', '腱鞘炎でトラックボール民に',
  '在宅で3日誰とも話してない',
  { text: '酔ってpushした過去がある', color: purple },
  '金曜デプロイ→土曜出勤', '中学の頃はHTML手打ち勢', 'うちAI使用禁止なんだよね', '今日はじめてgit触った！',
  'Dockerとはまだ冷戦中', 'rebaseもう怖くないぞ', '趣味はRustの同人誌', '研修でこの配信が教材',
  '夜勤明けの朝ごはん中', '病院の待合室から',
  { text: '海外から見てるよ', color: cyan },
  '時差でこっちは朝5時', '育休中に勉強再開', '娘にPython教えてる', '父はCOBOL一筋40年', '祖母はVLOOKUPの達人',
  '前職はパン屋', '新しい現場3日目', '来月から転職先でReact', '15年やっても命名で悩む',
  '同じエラーで昨日3時間沼', 'うちのリポジトリ8GB', 'インターン先がまさにこれ', 'バイト先のシフト表を自作',
  '徹夜デプロイの夜(遠い目)', 'さっきまで障害対応、今は癒し', 'それ私', 'うちもｗ', '実話です', '前科あり',
]

/** 直前のコメントへの返事 */
export const REPLY_LINES: readonly Line[] = [
  '↑それ', '↑たぶん同い年', '↑わかりみ', '↑IQたっか', '↑急にどうした', '↑ほんこれ', '↑せやな', '↑それはそう',
  '>>いやいや', '↑何言ってんだｗ', '↑既出', '↑ナイスツッコミ', '↑言うと思ったわ', '↑誰がうまいこと言えと',
  '↑落ち着け', '↑知ってる定期', '>>それ俺も', '↑解釈一致',
  { text: '↑その発想はなかった', color: yellow },
  '↑詳しすぎワロタ', '↑有識者いて助かる', '↑いや、それは違くない？', '↑お、おう', '↑ﾅﾆｿﾚ',
  '↑ちょっと分かる自分が嫌', '↑今それ言う？', '↑本職の人？', '↑ちょっと黙ってｗ', '↑人の心とかないんか',
  '↑そこ拾うんかい',
  { text: '↑名言製造機', color: orange },
  '↑ブーメラン', '↑ログに残しとくわ', '↑えっ', '↑はいはい解散', '↑それ何年前の話？', '↑俺の代弁者',
  '>>違う、そうじゃなくて', '↑( ﾟдﾟ)ﾎﾟｶｰﾝ', '↑一理あるかも', '↑あとで職員室な', '↑首もげるほど頷く',
  '↑ここ笑うとこ？', '↑この人好き', '>>マジレスすると…',
]

/** いまの作業に触れるつぶやき。{topic} はお題の言葉、{file} はさわっているファイル、{cmd} は走らせたコマンド、{n} はツールを使った回数、{min} は経過分 */
export const TOPIC_TEMPLATES: readonly Line[] = [
  '今日は{topic}の日か', '{topic}と聞いて駆けつけた', '{topic}って地味に体力勝負', 'うちの{topic}も見てほしい',
  '{topic}だけで1時間語れる', '昨日{topic}で泣いた', '{topic}…ｺﾞｸﾘ', '{topic}かぁ',
  { text: '{topic}！', color: orange },
  'え、{topic}やるの？', '{topic}とは（哲学）', '{topic}の民、集合', '実は{topic}初見です',
  '{topic}わからんの俺だけ？', '先輩が{topic}担当でさ', '{topic}は奥が深いぞ', '{topic}で検索したらここ',
  'あ～{topic}なつかし', '{topic}ってなんだっけ', '{topic}に一票', 'わりと{topic}きらいじゃない',
  '{topic}の気配…！',
  { text: '推し{topic}', color: pink },
  '{topic}、震えて待つ', '{topic}ガチ勢おる？', 'ついに{topic}に手を出すか', '{topic}、好きな人多いよね',
  '卒研も{topic}だったわ', '{topic}？名前だけは…', '新人の頃{topic}で詰んだ', '{topic}なんてノリでいけるよ',
  { text: '{topic}の時間だあああ', color: yellow },
  '{topic}とか言われても', '{topic}には苦い思い出が', '職場で{topic}押し付けられ中', '{topic}って響きが好き',
  '{topic}チョットデキル', '{topic}でご飯3杯', '夢に{topic}出てきそう', 'もう{topic}怖くないもん',
  '今日の主役：{topic}', '{topic}ってそういう…', 'それ{topic}の話？', '{topic}目当ての者です',
  '{topic}、お手並み拝見', '{topic}沼へようこそ', 'ぼくも{topic}やる！', '{topic}って一生終わらん',
  '{topic}、甘く見てたかも', '{topic}、ほほう',
  { text: '{topic}編スタート', color: cyan },
  'なるほど、{topic}からか', '{topic}で人生変わる説', '{topic}の質問していい？', '{topic}、昨日ググったとこ',
  '通りすがりの{topic}おじさん', '宿題の{topic}やらなきゃ', 'なんか{topic}かわいいね',
  '{topic}で炎上した過去あり', '{topic}ってだけでワクワク', '誰か{topic}のプロ来てくれ',
  '{topic}の話になると早口',
]
export const FILE_TEMPLATES: readonly Line[] = [
  'ほのかに{file}の香り…', '{file}、君に決めた', '{file}って誰が書いたの', 'うわ、{file}だ…',
  '{file}くん今日も元気',
  { text: '{file}ちゃん出番です', color: pink },
  '{file}聖地巡礼', 'そこ{file}なんだ', '来世は{file}に住みたい', '{file}は嘘をつかない', '{file}...なるほどね',
  '{file}の命運やいかに', '最後は{file}を信じろ', 'うちにも{file}あるわ', '{file}にコメント少なそう',
  '{file}の過去を語ってくれ', '{file}来たら勝ち確', '今日も{file}は平和', 'みんな{file}ガン見',
  '{file}って長いの？', '{file}か、渋い選択', '{file}がんばれー',
  { text: '{file}、たぶん主犯', color: purple },
  '{file}をよろしく', 'ここで{file}登場', '{file}の気持ちで見てる', '{file}知ってる、あれね',
  'ようこそ{file}へ', '{file}にお邪魔～', '{file}、出世したな', '{file}って何担当？', '{file}は触らぬ神に…',
  '{file}、保存した？', 'とりあえず{file}拝んどこ', '{file}いい名前じゃん', '{file}に何が起きるのか',
  '{file}頼むぞ',
  { text: '{file}の歴史が動く', color: orange },
  '{file}って改行コード何？', '{file}のblame見たい', '懐かしの{file}じゃん', '{file}で事故る未来見えた',
  '{file}…ああ、あいつか', '{file}の壁は厚いぞ', '{file}!?', 'あ、{file}', '{file}のタブ幅、何派？',
]
export const CMD_TEMPLATES: readonly Line[] = [
  '{cmd}たのむ', '{cmd}で全部わかる', 'お、{cmd}出た！', '{cmd}ってどう読むの', '当方{cmd}信者です',
  '{cmd}はもう手癖', '{cmd}を打つ指、速っ', '{cmd}終わるまで息止め中', '{cmd}ってそう使うのか',
  'ターミナルに{cmd}の文字',
  { text: '{cmd}、通れ！', color: orange },
  '俺も{cmd}しとこ', 'その{cmd}いいね', '{cmd}の打鍵音が好き', 'ひとまず{cmd}で一息',
  { text: '{cmd}に祈りを込めて', color: purple },
  '{cmd}は基本', '{cmd}、今日覚えたやつ', '{cmd}…ふーん', '{cmd}履歴に残しとく', '{cmd}、エイリアス化しよ',
  'ここで{cmd}か、手堅い', '{cmd}、見慣れた光景', '{cmd}の出力長そう', '迷ったら{cmd}', '{cmd}、毎回やる派',
  'ちょ、{cmd}って', '{cmd}で何見るの', '初手{cmd}', '{cmd}、正直よく知らない', '{cmd}の返事待ち',
  '{cmd}かーなるほど', '黙って{cmd}打つタイプ', '{cmd}に何度救われたか', '{cmd}に頼りすぎ説', '今の{cmd}見た？',
]
export const COUNT_TEMPLATES: readonly Line[] = [
  '{n}手目、まだ序盤', '本日{n}アクション目です', '操作ログ{n}件', '{n}手先まで読んでる', '{n}って数字、好き',
  'ここまで{n}手、ノーミス', '{n}操作、異常なし', '{n}手詰めかな', '{n}回動いて息切れなし',
  { text: 'カウンター{n}', color: cyan },
  '階段{n}段目', '{n}杯目のコーヒー', '{n}匹目のひつじ',
  { text: '{n}ターン目の攻防', color: orange },
  'スタンプ{n}個たまった', '{n}駅目、まだ乗る', '今ので{n}カウント', '{n}球目、振りかぶって',
  '打数{n}、打率高め',
  { text: '経験値{n}獲得', color: yellow },
  '{n}コマ目の展開', '数えてたら{n}になってた', '{n}枚目のカード', '花火{n}発、たまや～', '{n}個の作業を積んだ',
  '{n}回目で数えるのやめた', '{n}って多いの？少ないの？', '{n}、正の字で記録中', '{n}回呼ばれて嫌な顔せず',
  'ｶﾁｬｶﾁｬ、{n}個目', 'いま{n}で合ってる？', '{n}回目、腹へった', '自己ベスト{n}更新中', '{n}回ぶんの信頼',
]
export const MINUTE_TEMPLATES: readonly Line[] = [
  '{min}分の集中力', '体感だと{min}秒', '{min}分でここまで来た', '{min}分前の自分に見せたい',
  '{min}分画面にくぎ付け', '{min}分コース', '真剣な顔して{min}分経つ', '{min}分か、水飲も',
  '{min}分前に来た新参です', '{min}分溶けた', '入室して{min}分、まだ見る', '気づけば{min}分',
  '{min}分？時計二度見', '{min}分ってカップ麺何個分', 'この進捗で{min}分とは', '{min}分、トイレ我慢中',
  { text: 'この{min}分に感謝', color: yellow },
  '{min}分見たし、そろそろ寝る', '{min}分一緒にいた仲', '作業{min}分目に突入', 'お茶が冷めた({min}分)',
  '{min}分ぶりにまばたき', '{min}分座りっぱなし', '{min}分で一区切り？', '{min}分計測中ﾋﾟｯ',
  '{min}分目のClaude', 'えっ、{min}分しか経ってない', '{min}分ぶんの拍手を', '{min}分の旅、まだ途中',
  'あと{min}分は余裕', '{min}分で語彙力ゼロ',
  { text: '配信{min}分目', color: cyan },
  '{min}分、声出さずに応援', '{min}分ぶんの記憶がない', '{min}分、録画回してる', '{min}分記念におやつ',
  '{min}分だと!?',
  { text: '{min}分、ウォームアップ完了', color: orange },
  '{min}分なのに中身が濃厚', '{min}分経っても全然飽きん', '{min}分で肩バキバキ', '推しを{min}分摂取。満足',
]

/** ジャンルと、選ばれる重み */
const GENRES: ReadonlyArray<readonly [readonly Line[], number]> = [
  [AMBIENT_LINES, 4],
  [SMALLTALK_LINES, 3],
  [PLAY_BY_PLAY_LINES, 3],
  [DEV_TALK_LINES, 3],
  [CHEER_LINES, 2],
  [QUESTION_LINES, 2],
  [VIEWER_STORY_LINES, 2],
]

function pickGenre(rand: Rand): readonly Line[] {
  const total = GENRES.reduce((sum, [, w]) => sum + w, 0)
  let r = rand() * total
  for (const [lines, w] of GENRES) {
    if (r < w) return lines
    r -= w
  }
  return AMBIENT_LINES
}

/** つぶやきを選ぶための、いまの作業の様子 */
export type AmbientContext = {
  elapsedMs: number
  tools: number
  isErrorRecent: boolean
  isBusy: boolean
  /** メインのターンは終わり、裏の作業が終わるのを待っている */
  isBackground?: boolean
  /** 裏で動いている作業の数（分からなければ 0） */
  backgroundTasks?: number
  /** お題から拾った言葉、さわっているファイル、走らせたコマンド。つぶやきのテンプレートに入る */
  topics?: readonly string[]
  files?: readonly string[]
  cmds?: readonly string[]
  /** 直前のコメントに返事してよいか */
  canReply?: boolean
}

/** いまの作業に触れるつぶやき。入れられる材料がなければ undefined */
function aboutNow(ctx: AmbientContext, rand: Rand): Draft | undefined {
  const minutes = Math.floor(ctx.elapsedMs / 60_000)
  const choices: Array<() => Draft> = []
  const topic = ctx.topics ?? []
  const files = ctx.files ?? []
  const cmds = ctx.cmds ?? []
  if (topic.length > 0) choices.push(() => draft(pick(TOPIC_TEMPLATES, rand), { topic: pick(topic, rand) }))
  if (files.length > 0) choices.push(() => draft(pick(FILE_TEMPLATES, rand), { file: pick(files, rand) }))
  if (cmds.length > 0) choices.push(() => draft(pick(CMD_TEMPLATES, rand), { cmd: pick(cmds, rand) }))
  if (ctx.tools >= 3) choices.push(() => draft(pick(COUNT_TEMPLATES, rand), { n: String(ctx.tools) }))
  if (minutes >= 1) choices.push(() => draft(pick(MINUTE_TEMPLATES, rand), { min: String(minutes) }))
  return choices.length === 0 ? undefined : pick(choices, rand)()
}

export function ambient(rand: Rand, ctx?: AmbientContext): Draft[] {
  if (ctx === undefined) return [vary(tint(draft(pick(AMBIENT_LINES, rand)), rand), rand)]
  if (ctx.canReply === true && rand() < 0.06) return [draft(pick(REPLY_LINES, rand))]
  let lines: readonly Line[] | undefined
  if (ctx.isBackground === true) {
    const count = ctx.backgroundTasks ?? 0
    const r = rand()
    if (r < 0.4) lines = BG_AMBIENT_LINES
    else if (count > 0 && r < 0.48) return [tint(bgCount(count, rand), rand)]
  } else if (ctx.isErrorRecent && rand() < 0.4) lines = AFTER_ERROR_LINES
  else if (ctx.tools === 0 && rand() < 0.3) lines = THINKING_LINES
  else if (ctx.isBusy && rand() < 0.3) lines = BUSY_LINES
  else if (ctx.elapsedMs > 2 * 60_000 && rand() < 0.2) lines = LONG_WORK_LINES
  if (lines === undefined && rand() < 0.22) {
    const now = aboutNow(ctx, rand)
    if (now !== undefined) return [tint(now, rand)]
  }
  if (lines === undefined) lines = rand() < 0.03 ? WALL_LINES : pickGenre(rand)
  return [vary(tint(draft(pick(lines, rand)), rand), rand)]
}

// ---- 言い回しのゆらぎ ----

/** ときどき語尾に付く */
export const SUFFIXES: readonly string[] = ['ｗ', 'ｗｗ', 'ｗｗｗ', '笑', '！', '…', '（小声）', '（震え声）', '(・∀・)', '(´・ω・`)', '( ˘ω˘ )', 'ﾜﾛﾀ']

/** ときどき頭に付く */
export const PREFIXES: readonly string[] = ['いや', 'てか', 'え、', 'ガチで', 'まって', 'ほんと', 'なんか', 'やっぱ']

/** 語尾がもう記号や笑いで終わっているもの・顔文字・壁にはさわらない */
const SETTLED_RE = /[ｗw草！!？?…。」）)ー〜~]$|[(（][^)）]*[)）]|(.)\1{3,}|^[$【>↑]/

/** 同じコメントでも見た目が少し変わるように、ときどき語尾や頭に言葉を足す */
export function vary(d: Draft, rand: Rand): Draft {
  if ((d.pos ?? 'naka') !== 'naka' || SETTLED_RE.test(d.text)) return d
  const r = rand()
  const chars = [...d.text]
  if (r < 0.15) return { ...d, text: d.text + pick(SUFFIXES, rand) }
  if (r < 0.21 && chars.length >= 3 && /[ぁ-んァ-ヶ]/.test(d.text)) return { ...d, text: pick(PREFIXES, rand) + d.text }
  if (r < 0.24 && chars.length <= 4) return { ...d, text: d.text + d.text }
  return d
}

// ---- いまの作業から言葉を拾う ----

/** お題から拾わない、ありふれた言葉 */
const COMMON_WORDS: ReadonlySet<string> = new Set([
  '対応', '修正', '実装', '作成', '追加', '削除', '変更', '確認', '説明', '以下', '今回', '問題', '場合', '部分', '必要', '方法', '機能', '感じ', '自分', '全部', '一部', '最初', '最後', '現在', '今日',
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'please', 'can', 'you', 'make', 'add', 'fix', 'use', 'file', 'files', 'code', 'some', 'more', 'all', 'not', 'are', 'was', 'have', 'should',
])

/** 漢字語のすぐ後に来ても、送り仮名ではない（助詞の）ひらがな */
const PARTICLES = 'のをがはにでともへやかな'
/** 漢字語のあとの「して」「する」「させ」。ただし「直して」「消して」のような一字の動詞は除く */
const SURU = 'しすさせ'
const SU_VERB_KANJI = '直出消戻回返残渡試探話移押指隠壊崩起落写映貸外通足減増見任寄載乗'

/** プロンプトから、つぶやきに使えそうな言葉（カタカナ語・漢字語・英単語）を拾う */
export function extractTopics(text: string): string[] {
  // コードブロック・URL・環境変数・パス・長い英数字（鍵のようなもの）は拾わない。パスはファイル名だけ残す
  const plain = text
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/\S+:\/\/\S+/g, ' ')
    .replace(/\b\w+=\S+/g, ' ')
    .replace(/\S*[\\/]\S*/g, m => m.split(/[\\/]/).filter(Boolean).pop() ?? ' ')
    .replace(/[\x21-\x7e]{20,}/g, ' ')
  const out: string[] = []
  for (const m of plain.matchAll(/([ァ-ヶー]{2,10}|[一-龯々]{2,7}|[A-Za-z][A-Za-z0-9.+#-]{2,15})([ぁ-ん]?)/g)) {
    let w = (m[1] ?? '').replace(/[.-]+$/, '')
    const next = m[2] ?? ''
    // 「種類足りない」の「足」のように、送り仮名の前の漢字は落とす（「自動生成して」のようなする動詞はそのまま）
    const isSuru = SURU.includes(next) && !SU_VERB_KANJI.includes([...w].pop() ?? '')
    if (/^[一-龯々]/.test(w) && next !== '' && !PARTICLES.includes(next) && !isSuru) w = [...w].slice(0, -1).join('')
    if ([...w].length < 2 || w.startsWith('ー') || COMMON_WORDS.has(w.toLowerCase()) || out.includes(w)) continue
    out.push(w)
    if (out.length >= 6) break
  }
  return out
}

/** つぶやきに入れる、短いコマンド名（頭の cd や環境変数は飛ばして、最初の2語まで） */
export function shortCommand(command: string): string {
  const last = command.split(/&&|;|\|\|/).map(s => s.trim()).filter(s => s !== '' && !/^cd\s/.test(s))[0] ?? ''
  const words = last.split(/\s+/).filter(w => !/^\w+=/.test(w))
  const long = words[0] === 'npx' || words[0] === 'sudo' || words[1] === 'run'
  const head = words.slice(0, long ? 3 : 2).filter(w => !w.startsWith('-') && !w.includes('/'))
  return oneLine(head.join(' '), 14)
}

// ---- 盛り上がり ----

/** ときどき何件かまとめて流れる、盛り上がりのコメント */
export const WAVE_LINES: readonly Line[] = [
  'うおおお', 'きたああ',
  { text: 'いけえええ', color: orange },
  { text: '神', color: purple, isBig: true },
  'ここすき',
  { text: '鳥肌', color: cyan },
  { text: '熱い', color: red },
  '！！！',
  { text: '(ﾟ∀ﾟ)ｷﾀｺﾚ!!', color: yellow, isBig: true },
  '88888',
  { text: '８８８８８', color: yellow },
  'ﾊﾟﾁﾊﾟﾁﾊﾟﾁ', 'ｗｗｗ', 'wwwwww', '草ｗｗｗ',
  { text: 'ｗｗｗｗｗｗ', color: green },
  'すげえええ', 'やばい', 'えぐい', 'つよすぎ', '震えた', '天才', 'ﾌｫｫｫｫ', 'ｶｯｹｪｪｪ', '祭りだああ', 'まじか',
  '最高', '泣いた', '神展開', 'ｲｲﾈ!',
  { text: '伝説の始まり', color: pink },
  { text: 'ぶち上がる', color: blue },
]

/** 盛り上がり。n 件がまとめて流れる */
export function wave(rand: Rand, n: number): Draft[] {
  return pickSome(WAVE_LINES, n, rand).map(l => tint(draft(l), rand, 0.3))
}

// ---- 裏の作業（バックグラウンドのシェル・サブエージェント・ワークフロー） ----

/** 裏で何かを走らせたとき */
export const BG_LAUNCH_LINES: readonly Line[] = [
  '裏で走らせた', 'バックグラウンド送り',
  { text: '別働隊出撃', color: orange },
  '放置プレイ開始', '並行作業きた', '裏方へGO', '仕込み完了', '投げっぱなしｗ', 'マルチタスク民',
  '裏ルート開通',
  { text: '水面下で始動', color: cyan },
  '裏で何か始まった', 'ﾎﾟｲｯ', 'ながら作業きた',
]

/** ターンは終わったが、裏で作業が続いているとき */
export const BG_START_LINES: readonly Line[] = [
  { text: '延長戦', color: yellow },
  'まだ終わりじゃない', '裏で続行中', '本番はこれから', '枠延長きた', 'アンコール待ち', '帰るのはまだ早い',
  { text: '第二部開幕', color: orange },
  'おつ…じゃなかった', '居残り組', 'Cパートあるやつ', '席立つなよ',
]

/** 裏の作業が終わるのを待っている間のつぶやき */
export const BG_AMBIENT_LINES: readonly Line[] = [
  '裏で作業中', '待ち時間', '進捗どう？', '放置ゲーかな', 'コーヒー淹れてくる', '分身たち元気？',
  { text: '見守り隊', color: pink },
  'ロード画面', 'まだかなー', '表は静か', 'ここ待合室？', '回ってる回ってる', '音沙汰なし', '生きてる？',
  '耐久待機', '気長に待つ', 'カップ麺待ち', '裏方がんばれ',
  { text: '果報は寝て待て', color: yellow },
  'しりとりする？', '雑談タイム', 'BGMだけ流れてる', '配信者どこ行った', '画面止まってる？', 'ﾁｸﾀｸﾁｸﾀｸ',
  '( ˘ω˘ )ｳﾄｳﾄ', '(´・ω・`)ﾋﾏ', '(´ー`)ﾏｯﾀﾘ', '(´-`).｡oO', '裏の様子見たい', 'プログレスバー欲しい',
  '何%まで来た？', '今のうちに風呂', '飯食ってくる', '幕間', 'CMタイム', '放置で育つ', '待つのも仕事',
  '裏で汗かいてそう', '焦らすねぇ',
  { text: '待機列', color: cyan },
  '今北、何待ち？', 'もうすぐかな', '通知まだ？', 'あと何分？', '舞台裏', 'ビルドって長いよね',
  '歯磨きしてくる', '洗い物済ませとく', '待ってる間に一品作った', '麺伸びた', 'お湯沸いた', '猫が膝に乗った',
  '犬の散歩行ってくる', 'ただいま、どうなった？', 'おかえり、まだだよ', '留守番してる', '中の人お茶してそう',
  '小人さんが作業中', '舞台袖から音する', '(´ε｀ )', '(-ω-)ｸﾞｰ', '実況なしの時間', '止まってはないはず',
  '環境映像', '焚き火動画の趣', '水槽眺めてる気分', 'どこから見てる？', 'こっちは北海道', '一旦離席',
  '戻りました', '待機勢集合', '見てる鍋は煮えない', '寝かせるほど美味い', 'オーブン覗きたい', '発酵中',
  '洗濯機の残り時間みたい', 'レンジの前で待つやつ', '時計見ちゃう', '1分が1時間', '終わったら起こして',
  '通知オン済み', 'たぶん今70%', '体感あと5分', '「もうすぐ」は信用しない', '差し入れ置いとくね',
  '栄養ドリンク置き配', '縁の下の力持ち', 'エンドロールに名前を', '表は平和、裏は戦場', '今のうちに宿題やる',
  '好きなエディタ選手権', 'タブ派？スペース派？', 'vim派は挙手', '推し言語を語ろう', '隣の人こんばんは',
  '点呼とろう', 'お座りして待つ', '整理券配布中', '番号札は42番', '合否発表前の気分', '成功しますように',
  'ﾅﾑﾅﾑ', '誰か一発ギャグ', '静かすぎて不安', '裏の進捗を想像で補う', '放課後みたいな空気',
  'エレベーター待ちの沈黙', 'アイス2本目', '二度寝チャンス', '待ってる人多くて草',
  { text: '信じてるからな', color: cyan },
  { text: 'スタッフさん感謝', color: pink },
  { text: '静かなる戦い', color: purple },
  'この画面もう暗記済み', 'ｳｨｰﾝ…', '見てない間に終われ', '晩ごはん報告会',
]

/** {n} は裏で動いている作業の数 */
export const BG_COUNT_LINES: readonly Line[] = [
  '裏で{n}個動いてる', '残り{n}',
  { text: 'あと{n}件！', color: orange },
  '{n}タスク待ち', '裏で{n}件稼働中', '待ち{n}件',
]

/** {n} が 2 以上のときだけ使う */
export const BG_PARALLEL_LINES: readonly Line[] = [
  '{n}並列で草', '{n}本同時進行', '分身{n}体稼働中', '裏に{n}人いる',
  { text: '{n}窓配信', color: cyan },
]

/** 裏で動いている作業の数を言う */
function bgCount(n: number, rand: Rand): Draft {
  return draft(pick(n >= 2 ? [...BG_COUNT_LINES, ...BG_PARALLEL_LINES] : BG_COUNT_LINES, rand), { n: String(n) })
}

/** 裏の作業が終わった */
export const BG_DONE_LINES: readonly Line[] = [
  '完了通知きた', '裏組おつ', '帰還報告', '終わったー',
  { text: '任務完了', color: green },
  '待った甲斐あった', '放置勝ち', 'ﾋﾟｺｰﾝ', '結果発表きた', '無事帰ってきた', '片付いた',
  { text: '裏ミッション達成', color: yellow },
  '裏で終わってた', '一報きた',
]

/** 裏の作業が失敗した */
export const BG_FAIL_LINES: readonly Line[] = [
  '裏で事故ってて草', '失敗通知…', '撃沈', '帰ってこなかった',
  { text: '殉職', color: purple },
  '裏で爆発してる',
  { text: '【悲報】裏で失敗', color: red },
  '見てないとこでコケた', '散ったか…', 'ログ確認はよ', '別働隊全滅', '(´；ω；`)',
]

/** 裏の作業が止められた */
export const BG_KILLED_LINES: readonly Line[] = [
  '強制送還ｗ', '打ち切りエンド', '止められた', 'お役御免', '裏方クビで草', '解散！',
  { text: 'KILL', color: red },
  '撤収', '安らかに',
]

/** 裏の作業からの、終わったのではない知らせ（モニターの通知など） */
export const BG_NOTICE_LINES: readonly Line[] = ['通知きた', '何か来た', '報告きた', '動きあり', '続報きた', 'お知らせ']

/**
 * 終わらない裏方（開発サーバー・watch・tail -f など）のコマンドか。こういうものは待ち時間に数えない。
 * /dev/null への付け替えや、cd などの前置きは見ずに、最後のコマンドだけで決める
 */
const PERSISTENT_RE =
  /(?<![\w/.:@-])(?:dev|serve|server|runserver|start|preview|watch)(?![\w/:-])|\b(?:start|serve|dev):(?:dev|watch|debug|local)\b|--watch(?:All)?\b(?!=false)|--reload\b|\b(?:tsc|tsx|esbuild|webpack|rollup|babel|sass|tailwindcss)\b[^;&|]*\s-w\b|\btail\s+-[fF]\b|(?<![\w-])(?:nodemon|live-server|vite(?!\s+build)|uvicorn|gunicorn|flask\s+run|streamlit\s+run|rails\s+s(?:erver)?|jupyter|ngrok|storybook(?!\s+build)|docker[ -]compose\s+up(?![^;&|]*\s-d\b))\b|\bhttp\.server\b|\bphp\s+-S\b/

export function isPersistentCommand(command: string): boolean {
  const last = command.replace(/\d?>>?\s*\/dev\/null/g, '').split(/&&|;|\|\|/).pop() ?? ''
  return PERSISTENT_RE.test(last)
}

/** 裏に回る呼び出しか。Agent は止めない限り裏で動く */
export function isBackgroundLaunch(tool: string, input: Readonly<Record<string, unknown>>): boolean {
  if (tool === 'Workflow' || tool === 'Monitor') return true
  if (tool === 'Agent') return input.run_in_background !== false
  return input.run_in_background === true
}

export function reactToBackgroundLaunch(rand: Rand): Draft[] {
  return [tint(draft(pick(BG_LAUNCH_LINES, rand)), rand)]
}

/** ターンの終わりに、裏でまだ n 個の作業が動いているとき */
export function reactToBackgroundStart(n: number, rand: Rand): Draft[] {
  const out = [draft(pick(BG_START_LINES, rand))]
  if (rand() < 0.5) out.push(bgCount(n, rand))
  return out
}

/** 終わったことを表す状態 */
const FINISHED: ReadonlySet<string> = new Set(['completed', 'failed', 'error', 'killed', 'stopped', 'cancelled', 'canceled'])

export type TaskNotice = { id: string | undefined; status: string; isFinished: boolean }

/** 裏の作業の知らせ（<task-notification>）から、どの作業がどうなったかを読む */
export function parseTaskNotification(text: string): TaskNotice {
  const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(text)?.[1]
  const status = (/<status>\s*([^<\s]+)\s*<\/status>/.exec(text)?.[1] ?? '').toLowerCase()
  return { id, status, isFinished: FINISHED.has(status) }
}

export function reactToTaskNotification(status: string, rand: Rand): Draft[] {
  const lines =
    status === 'completed'
      ? BG_DONE_LINES
      : status === 'failed' || status === 'error'
        ? BG_FAIL_LINES
        : FINISHED.has(status)
          ? BG_KILLED_LINES
          : BG_NOTICE_LINES
  return [tint(draft(pick(lines, rand)), rand)]
}

// ---- 自分で流すコメント ----

const POSITIONS: readonly DanmakuPos[] = ['naka', 'ue', 'shita']

/**
 * `/danmaku red ue 神回` のように、先頭のコマンド（色・位置・big）を読む。
 * コマンドだけでコメントが空なら undefined。
 */
export function parseUserComment(args: string): Draft | undefined {
  const tokens = args.trim().split(/\s+/).filter(t => t !== '')
  const out: Draft = { text: '' }
  while (tokens.length > 1) {
    const token = tokens[0]!.toLowerCase()
    if (token in COLORS) out.color = COLORS[token as ColorName]
    else if ((POSITIONS as readonly string[]).includes(token)) out.pos = token as DanmakuPos
    else if (token === 'big') out.isBig = true
    else if (token === 'small' || token === 'medium') out.isBig = false
    else break
    tokens.shift()
  }
  out.text = tokens.join(' ')
  return out.text === '' ? undefined : out
}

export const DEMO: readonly Draft[] = [
  { text: 'わこつ' },
  { text: '弾幕テスト', color: orange, pos: 'ue', isBig: true },
  { text: '今北産業' },
  { text: 'ｗｗｗｗｗｗｗｗｗｗ', color: green },
  { text: '888888888888', color: yellow },
  { text: '神回の予感', color: red, isBig: true },
  { text: 'かわいい', color: pink },
  { text: '正座待機', color: purple },
  { text: '(・∀・)' },
  { text: '型職人ニキ', color: blue },
  { text: '脳内会議中' },
  { text: 'rm -rf はやめろ', color: red },
  { text: '有能', color: orange, isBig: true },
  { text: 'ここすき' },
  { text: '後方腕組み勢' },
  { text: '天才か', color: yellow },
  { text: '＼(^o^)／' },
  { text: '弾幕職人きた', color: cyan },
  { text: 'GG', color: cyan },
  { text: 'おつ', color: purple, pos: 'shita' },
]

// ---- AI 視聴者（オプション） ----

export function aiPrompt(answer: string, n: number): string {
  const tail = [...answer.trim()].slice(-1200).join('')
  return [
    'あなたはニコニコ動画の生放送を見ている視聴者の集団です。配信者はAIアシスタントの「Claude」で、ユーザーの依頼を片付けて、いま次の発言をしました。',
    '',
    '<発言>',
    tail,
    '</発言>',
    '',
    `この発言を見た視聴者が画面に流すコメントを${n}個書いてください。`,
    '- 1行に1コメント。番号・記号・かぎかっこ・説明は付けない',
    '- 各コメントは2〜14文字。発言の具体的な中身（ファイル名、直したもの、結果など）に反応する',
    '- 「草」「ｗ」「888」「乙」「神」「有能」などのネットスラングを自然に混ぜる',
    '- 誹謗中傷や下品な表現は書かない',
  ].join('\n')
}

/** 作業中の実況（aiChatter）。いままでの作業の様子を見せて、視聴者のコメントを書いてもらう */
export function chatterPrompt(activity: readonly string[], n: number): string {
  return [
    'あなたはニコニコ動画の生放送を見ている、いろいろな視聴者の集団です。配信者はAIアシスタントの「Claude」で、いまユーザーの依頼で作業しています。',
    '',
    '<作業の様子（古い順）>',
    ...activity.slice(-15).map(line => `- ${line}`),
    '</作業の様子>',
    '',
    `この様子を見ている視聴者が画面に流すコメントを${n}個書いてください。`,
    '- 1行に1コメント。番号・記号・かぎかっこ・説明は付けない',
    '- 各コメントは2〜16文字。作業の具体的な中身（ファイル名、コマンド、エラー、お題の言葉）に触れるものを半分以上にする',
    '- 実況・ツッコミ・質問・応援・雑談・あるある・自分語りなど、別々の人が書いたように口調と長さと語尾をばらばらにする',
    '- 「草」「ｗ」で終わるのは2個まで。誹謗中傷や下品な表現は書かない',
  ].join('\n')
}

const AI_COLORS: ReadonlyArray<string | null> = [null, null, null, pink, cyan, orange, green]

export function parseAiLines(text: string, rand: Rand, max = 8): Draft[] {
  return text
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*・•]|\d+[.)．]|[「『"])\s*/, '').replace(/[」』"]\s*$/, '').trim())
    .filter(line => line !== '' && !line.startsWith('<'))
    .slice(0, max)
    .map(line => ({ text: oneLine(line, 20), color: pick(AI_COLORS, rand) }))
}

export const HELP = [
  'いまは{state}（{lanes}行・速さ {speed}・量 {density}{ai}）',
  '/danmaku <コメント>   自分でコメントを流す（例: /danmaku red ue 神回）',
  '/danmaku demo         お試しの弾幕を流す',
  '/danmaku off | on     弾幕を止める / 再開する',
  '色: white red pink orange yellow green cyan blue purple ／ 位置: ue shita naka ／ big',
].join('\n')
