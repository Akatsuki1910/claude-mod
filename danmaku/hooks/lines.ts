// コメント職人。イベントから流すコメントを選ぶ。$ は使わない純粋関数だけ。

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

const { red, pink, orange, yellow, green, cyan, purple } = COLORS

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

type Line = string | Draft

function draft(line: Line, vars: Record<string, string> = {}): Draft {
  const d = typeof line === 'string' ? { text: line } : line
  return { ...d, text: d.text.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '') }
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const chars = [...flat]
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : flat
}

function basename(path: unknown): string {
  if (typeof path !== 'string' || path === '') return 'ファイル'
  const parts = path.split(/[\\/]/)
  return oneLine(parts[parts.length - 1] || path, 18)
}

// ---- プロンプト ----

export const PROMPT_LINES: readonly Line[] = [
  'わこつ', 'きたー！', '待機', 'wktk', '初見', 'お題きた', 'はじまった', 'うぽつ',
  { text: 'キタ━(ﾟ∀ﾟ)━!', color: yellow },
]

const PROMPT_TOPICS: ReadonlyArray<{ re: RegExp; lines: readonly Line[] }> = [
  { re: /バグ|不具合|bug|fix|直して|エラー|error/i, lines: ['バグ回きた', 'デバッグ回', '原因なんやろ'] },
  { re: /テスト|test/i, lines: ['テスト回', 'テストえらい'] },
  { re: /リファクタ|refactor|整理/i, lines: ['リファクタ回', 'きれいにしよう'] },
  { re: /急ぎ|至急|はよ|asap|urgent/i, lines: ['急げｗ', '締め切り近そう'] },
  { re: /ありがと|thank/i, lines: ['礼儀正しい', 'えらい'] },
  { re: /[?？]\s*$/, lines: ['質問回', 'それな'] },
]

export function reactToPrompt(text: string, rand: Rand): Draft[] {
  const out = pickSome(PROMPT_LINES, 2, rand).map(l => draft(l))
  const topic = PROMPT_TOPICS.find(t => t.re.test(text))
  if (topic !== undefined) out.push(draft(pick(topic.lines, rand)))
  const head = oneLine(text, 16)
  if (head !== '') out.unshift({ text: `【お題】${head}`, color: orange, pos: 'ue' })
  return out
}

// ---- ツール呼び出し ----

export const TOOL_LINES: Readonly<Record<string, readonly Line[]>> = {
  Read: ['熟読ニキ', '{file} 読んでる', '読むの速すぎて草', '精読助かる', 'そこ読むんか', 'ふむふむ', '予習えらい'],
  Edit: ['書き換えたｗ', '神編集', '{file} 改造中', '職人芸', '差分きれい', 'そこ変えるんか', '迷いがない', '手が速い'],
  Write: ['{file} 爆誕', '新規ファイルきた', '一発で書いてて草', '生成はやい', '書き下ろしきた'],
  Bash: ['黒い画面きた', 'コマンド職人', 'ターミナル芸', { text: '$ {cmd}', color: cyan }, 'ｶﾀｶﾀｯﾀｰﾝ'],
  Search: ['検索はやい', '探し物？', 'grep職人', '見つかるかな', '{q} 探してる'],
  Web: ['ググってて草', 'ネットの海へ', '調べものえらい', '情報収集ニキ'],
  Agent: ['影分身の術', '部下に投げたｗ', 'サブエージェント召喚', '分身きた', '増えたｗ'],
  Todo: ['計画性の鬼', 'ToDo管理えらい', '段取り八分', '几帳面'],
  Ask: ['質問タイム', '選択肢きた', 'アンケートきた', 'どれにする？'],
  Plan: ['計画きた', 'プラン発表', '設計図きた'],
  Skill: ['スキル発動！', '必殺技きた'],
  Mcp: ['外部連携きた', 'MCP職人', '{tool} !?'],
  Other: ['{tool} !?', 'なにそれ', '新技きた'],
}

function toolGroup(tool: string): string {
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

const TEST_RE =
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(pytest|jest|vitest|mocha|rspec|phpunit)\b|\bgo\s+test\b|\bcargo\s+test\b|\b(mvn|gradle)\s+test\b|\bplugin\s+test\b/

/** Bash の中身で反応を変える。最初に当たったものを使う */
export const BASH_SPECIAL: ReadonlyArray<{ re: RegExp; start: readonly Line[]; ok?: readonly Line[]; ng?: readonly Line[] }> = [
  {
    re: /\brm\s+-[a-zA-Z]*([rR][a-zA-Z]*f|f[a-zA-Z]*[rR])/,
    start: [{ text: 'ヒエッ', color: red }, { text: 'rm -rf はやめろ', color: red }, '消すな消すなｗ'],
  },
  {
    re: /\bgit\s+push\b.*(\s--force\b|\s-f\b)/,
    start: [{ text: '強制プッシュで草', color: green }, 'やめろｗ', '勇者現る'],
  },
  { re: /\bgit\s+push\b/, start: ['プッシュ！', '本番いくぞ', '祈れ'], ok: ['プッシュ成功', 'おめ'] },
  { re: /\bgit\s+commit\b/, start: ['コミット！', 'コミットえらい'], ok: ['コミットおめ', '888'] },
  {
    re: TEST_RE,
    start: ['テスト来た', '頼む…', '祈祷中', '緊張の瞬間'],
    ok: [{ text: '8888888888', color: yellow, isBig: true }, 'テスト通った！', { text: '緑！', color: green }, '神'],
    ng: [{ text: 'テスト落ちてて草', color: green }, { text: '赤い…', color: red }, 'ドンマイ', '知ってた'],
  },
  {
    re: /\b(npm|pnpm|yarn|bun)\s+(i|install|add)\b|\bpip3?\s+install\b|\bbrew\s+install\b|\bcargo\s+add\b|\bgo\s+get\b/,
    start: ['依存地獄の予感', 'インストール待機', 'node_modules重そう'],
  },
  { re: /\bsudo\b/, start: [{ text: 'sudoはあかん', color: red }, '管理者権限きた'] },
  {
    re: /\b(build|tsc|webpack|make)\b/,
    start: ['ビルド待機', 'コンパイル中…'],
    ok: ['ビルド通った', 'えらい'],
    ng: [{ text: 'ビルド失敗で草', color: green }, '型エラーかな'],
  },
  { re: /\bdocker\b/, start: ['コンテナきた', 'クジラ'] },
  { re: /\b(curl|wget)\b/, start: ['ダウンロード中', '通信きた'] },
  { re: /\bgit\s+(status|diff|log)\b/, start: ['状況確認えらい', 'git職人'] },
  { re: /^\s*ls\b/, start: ['とりあえずls', 'ls好きすぎ'] },
]

export const ERROR_LINES: readonly Line[] = [
  { text: '草', color: green, isBig: true },
  { text: '大草原', color: green },
  'ｗｗｗｗｗ', 'あっ…', 'エラー芸', 'ドンマイ', 'やらかしたｗ', '知ってた', 'エラー吐いてて草',
]

export const DENIED_LINES: readonly Line[] = ['拒否られてて草', '許可おりず', '権限なくて草', 'おあずけｗ']

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

function bashSpecial(input: Readonly<Record<string, unknown>>) {
  const command = typeof input.command === 'string' ? input.command : ''
  return BASH_SPECIAL.find(s => s.re.test(command))
}

/** ツールを呼ぶ直前のコメント */
export function reactToToolStart(tool: string, input: Readonly<Record<string, unknown>>, rand: Rand): Draft[] {
  const vars = varsOf(tool, input)
  const group = toolGroup(tool)
  const special = group === 'Bash' ? bashSpecial(input) : undefined
  const lines = special?.start ?? TOOL_LINES[group] ?? TOOL_LINES.Other!
  return [draft(pick(lines, rand), vars)]
}

export type ToolOutcome = { isError: boolean; isDenied: boolean }

/** ツールが終わったあとのコメント。成功した普通の呼び出しには何も言わない */
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

// ---- ターン ----

export const OTSU_LINES: readonly Line[] = [
  'おつ', '乙', 'おつかれー', { text: '8888888', color: yellow }, 'うぽつ', '神回', 'おつおつ', 'おつでした',
]

export type TurnSummary = { reason: 'answer' | 'aborted' | 'refusal' | 'error'; durationMs: number; tools: number }

export function reactToTurnEnd(turn: TurnSummary, rand: Rand): Draft[] {
  switch (turn.reason) {
    case 'aborted':
      return pickSome(['あっ', '止められてて草', '中断ｗ', 'ストップ！', '放送事故'], 2, rand).map(l => draft(l))
    case 'error':
      return pickSome(['鯖落ち？', 'エラーで草', '回線…', '放送事故'], 2, rand).map(l => draft(l))
    case 'refusal':
      return pickSome(['断られてて草', 'お断りされた'], 1, rand).map(l => draft(l))
    case 'answer': {
      const out = pickSome(OTSU_LINES, 3, rand).map(l => draft(l))
      if (turn.durationMs > 3 * 60_000) out.push(draft(pick(['長丁場おつ', '大作', '見届けた'], rand)))
      else if (turn.durationMs < 8_000) out.push(draft(pick(['はやい', '即答で草', '速すぎ'], rand)))
      if (turn.tools >= 15) out.push(draft(pick(['働きすぎ', 'ツール使いまくりで草', '社畜の鑑'], rand)))
      if (rand() < 0.35) out.unshift({ text: 'おつかれさまでした！', color: orange, pos: 'ue', isBig: true })
      return out
    }
  }
}

// ---- 待ち時間のつぶやき ----

export const AMBIENT_LINES: readonly Line[] = [
  '考え中…', 'かわいい', 'まだかな', '見てる', 'ここすき', 'かしこい', 'wktk', 'がんばれー',
  '（ ´∀｀）', 'ﾜｸﾜｸ', '待機', 'ほう', 'なるほど', { text: '弾幕薄いよ！', color: pink },
]

export function ambient(rand: Rand): Draft[] {
  return [draft(pick(AMBIENT_LINES, rand))]
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
  { text: 'きたー！' },
  { text: '草', color: green, isBig: true },
  { text: '8888888888', color: yellow },
  { text: '熟読ニキ' },
  { text: 'rm -rf はやめろ', color: red },
  { text: 'かわいい', color: pink },
  { text: '神回' },
  { text: 'コマンド職人', color: cyan },
  { text: '（ ´∀｀）' },
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
