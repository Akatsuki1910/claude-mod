// コメント職人。イベントから流すコメントを選ぶ。$ は使わない純粋関数だけ。
// 下の配列（ネタ帳）を書き換えれば好きなノリにできます。{file} などはその場の値に置き換わります。

import type { DanmakuPos } from '../types'

/** これから流すコメントの下書き */
export type Draft = { text: string; color?: string | null; pos?: DanmakuPos; isBig?: boolean }

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
  return { ...d, text: d.text.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '') }
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
  out.push(...pickSome(PROMPT_LINES, 3, rand).map(l => draft(l)))
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
  const lines = special?.start ?? (kind !== undefined && rand() < 0.4 ? kind.lines : undefined) ?? TOOL_LINES[group] ?? TOOL_LINES.Other!
  return [tint(draft(pick(lines, rand), vars), rand)]
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
  return [tint(draft(pick(lines, rand), varsOf(tool, input)), rand)]
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
      out.push(...pickSome(OTSU_LINES, 4, rand).map(l => draft(l)))
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
  '嵐の前の静けさ', 'Now Loading...',
]

/** さっきエラーが出たとき */
export const AFTER_ERROR_LINES: readonly Line[] = [
  '切り替えていけ', 'まだ慌てる時間じゃない', '立て直せ', '次いこ次', '失敗は成功のもと', 'リトライ！',
  '想定内', '計画通り', 'こっからこっから', '落ち着いて', '気にすんな', 'そういう日もある', 'エラーは友達',
  'まだいける',
  { text: '負けるな', color: pink },
]

/** 作業が2分を超えたとき */
export const LONG_WORK_LINES: readonly Line[] = [
  '長丁場', '耐久配信', '作業用動画', 'まだ続く', '何分経った？', '水分補給しろ', 'トイレ行ってくる',
  'ここまで見た人挙手', '超大作の予感', 'お菓子補充', 'エンドレス', 'ストレッチしよ', '根気すごい',
  '休憩も大事',
]

/** ツールを立て続けに使っているとき */
export const BUSY_LINES: readonly Line[] = [
  '作業はえーよ', 'TAS', '倍速', '目が追いつかない', '残像だ', 'ﾊﾞﾊﾞﾊﾞﾊﾞ', 'RTA勢', '早送り？',
  'フルスロットル', 'キーボード壊れる', '怒涛の展開',
  { text: '無双', color: red },
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

/** つぶやきを選ぶための、いまの作業の様子 */
export type AmbientContext = { elapsedMs: number; tools: number; isErrorRecent: boolean; isBusy: boolean }

export function ambient(rand: Rand, ctx?: AmbientContext): Draft[] {
  let lines = AMBIENT_LINES
  if (ctx !== undefined) {
    const r = rand()
    if (ctx.isErrorRecent && r < 0.5) lines = AFTER_ERROR_LINES
    else if (ctx.tools === 0 && r < 0.45) lines = THINKING_LINES
    else if (ctx.isBusy && r < 0.4) lines = BUSY_LINES
    else if (ctx.elapsedMs > 2 * 60_000 && r < 0.3) lines = LONG_WORK_LINES
    else if (r >= 0.95) lines = WALL_LINES
  }
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

const AI_COLORS: ReadonlyArray<string | null> = [null, null, null, pink, cyan, orange, green]

export function parseAiLines(text: string, rand: Rand): Draft[] {
  return text
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*・•]|\d+[.)．]|[「『"])\s*/, '').replace(/[」』"]\s*$/, '').trim())
    .filter(line => line !== '' && !line.startsWith('<'))
    .slice(0, 8)
    .map(line => ({ text: oneLine(line, 20), color: pick(AI_COLORS, rand) }))
}

export const HELP = [
  'いまは{state}（{lanes}行・速さ {speed}・量 {density}{ai}）',
  '/danmaku <コメント>   自分でコメントを流す（例: /danmaku red ue 神回）',
  '/danmaku demo         お試しの弾幕を流す',
  '/danmaku off | on     弾幕を止める / 再開する',
  '色: white red pink orange yellow green cyan blue purple ／ 位置: ue shita naka ／ big',
].join('\n')
