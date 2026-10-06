// danmaku: Claude の作業に合わせて、プロンプトの上にニコニコ風の弾幕コメントを流す mod。
//
// - プロンプトを送る / ツールを呼ぶ / エラーが出る / ターンが終わる、に反応してコメントが流れる
// - 作業中にコメントが途切れたら、視聴者がつぶやいて埋める（間隔は density で変わる）
// - 描画は hooks/screen.tsx（Client）が自分の時計で行う。ここはコメントを $.state に積むだけ
// - /danmaku <コメント> で自分でも流せる（/danmaku red ue 神回 のようにコマンド付きで）

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { DanmakuComment, ScreenProps } from '../types'
import {
  COLORS,
  COMBO_AT,
  DEMO,
  ELAPSED_MINUTES,
  HELP,
  MILESTONES,
  aiPrompt,
  ambient,
  parseAiLines,
  parseUserComment,
  reactToCombo,
  reactToElapsed,
  reactToErrorStreak,
  reactToMilestone,
  reactToPrompt,
  reactToToolEnd,
  reactToToolOk,
  reactToToolStart,
  reactToTurnEnd,
} from './lines'
import type { Draft } from './lines'

const comments = atom({ plugin: 'danmaku', key: 'comments' } as const, [])
const isOff = atom({ plugin: 'danmaku', key: 'isOff' } as const, false)
const sweep = atom({ plugin: 'danmaku', key: 'sweep' } as const, 0)

/** 1コメントが画面を横切る時間 */
const SPEED_MS: Readonly<Record<string, number>> = { slow: 7000, normal: 5000, fast: 3500 }
/** ツール呼び出しにコメントが付く確率 */
const DENSITY: Readonly<Record<string, number>> = { low: 0.3, normal: 0.65, high: 1 }
/** 作業中、コメントがこの時間（の 0.75〜1.25 倍）途切れたら視聴者がつぶやく */
const QUIET_MS: Readonly<Record<string, number>> = { low: 4500, normal: 2500, high: 1200 }
/** つぶやくかどうかを見る間隔。粗いと QUIET_MS の揺らぎが秒単位に丸められてしまう */
const AMBIENT_TICK_MS = 250
/** 成功したツール呼び出しをほめる確率（density の確率に掛ける） */
const PRAISE_RATE = 0.35
/** このくらい前までのエラーは「さっきのエラー」 */
const ERROR_RECENT_MS = 15_000
/** BUSY_WINDOW_MS の間に BUSY_TOOLS 回ツールを呼んでいたら「手が速い」 */
const BUSY_WINDOW_MS = 10_000
const BUSY_TOOLS = 4
/** ue / shita の固定コメントが出ている時間 */
const FIXED_MS = 3000
/** 空き待ちで出るのが遅れる分の余裕 */
const SLACK_MS = 1800
const KEEP_MAX = 60
/** 自動コメントは RATE_WINDOW_MS あたり RATE_MAX 件まで */
const RATE_WINDOW_MS = 2000
const RATE_MAX = 8
/** 同じコメントを続けて流さないために覚えておく数 */
const RECENT_MAX = 24
/** /danmaku demo は（行数 × 2 - 1）件ずつ、DEMO_WAVE_MS おきに流す */
const DEMO_WAVE_MS = 2000

function intOption(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? Math.round(value) : Number.NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

function nameOption(value: unknown, table: Readonly<Record<string, number>>, fallback: string): string {
  return typeof value === 'string' && value in table ? value : fallback
}

/** register で options から決まる設定 */
const config = { lanes: 3, speed: 'normal', density: 'normal', durationMs: 5000, chance: 0.65, quietMs: 2500, aiViewers: false }

/** いまのターンの様子。サブエージェントの分は数えない */
type TurnLog = {
  startedAt: number
  tools: number
  errors: number
  errorStreak: number
  /** 続けて使っているツールと、続いた回数 */
  tool: string
  streak: number
  lastErrorAt: number
  toolTimes: number[]
  /** 次に言う経過時間の節目（ELAPSED_MINUTES の番号） */
  elapsedIdx: number
}

const freshTurn = (now: number): TurnLog => ({
  startedAt: now,
  tools: 0,
  errors: 0,
  errorStreak: 0,
  tool: '',
  streak: 0,
  lastErrorAt: Number.NEGATIVE_INFINITY,
  toolTimes: [],
  elapsedIdx: 0,
})

// ここから下のモジュール変数は、リロードで消えてもかまわないもの
let sweepTimer: Timer | undefined
let ambientTimer: Timer | undefined
let autoTimes: number[] = []
let lastEmitAt = 0
let quietMs = 2500
let recent: string[] = []
let turn = freshTurn(0)

const rand = () => Math.random()

/** 最近流したコメントと同じにならないよう、何度か引き直す */
function unlike(make: () => Draft[]): Draft[] {
  let drafts = make()
  for (let i = 0; i < 3 && drafts.some(d => recent.includes(d.text)); i++) drafts = make()
  return drafts
}

function lifeOf(c: DanmakuComment): number {
  return (c.pos === 'naka' ? config.durationMs : FIXED_MS) + SLACK_MS
}

async function emit($: EngineInterface, drafts: readonly Draft[], byUser: boolean): Promise<void> {
  if (drafts.length === 0) return
  if (await read($, isOff)) return
  const now = await $.clock.now()
  let list = drafts
  if (!byUser) {
    autoTimes = autoTimes.filter(t => now - t < RATE_WINDOW_MS)
    list = drafts.slice(0, Math.max(0, RATE_MAX - autoTimes.length))
    if (list.length === 0) return
    for (const _ of list) autoTimes.push(now)
  }
  lastEmitAt = now
  // 次のつぶやきまでの間を少し揺らして、一定のリズムにならないようにする
  quietMs = config.quietMs * (0.75 + 0.5 * rand())
  recent = [...recent, ...list.map(d => d.text)].slice(-RECENT_MAX)
  await update($, comments, current => {
    // id は時刻から作るので、/clear で一覧が空に戻っても前より小さくならない
    let id = current.reduce((max, c) => Math.max(max, c.id), now * 100)
    const fresh: DanmakuComment[] = list.map(d => ({
      id: ++id,
      text: d.text,
      color: d.color ?? null,
      pos: d.pos ?? 'naka',
      isBig: d.isBig ?? false,
      at: now,
    }))
    return [...current.filter(c => now - c.at < lifeOf(c)), ...fresh].slice(-KEEP_MAX)
  })
  // 最後のコメントが流れきったころに描き直して、帯をたたむ
  sweepTimer?.cancel()
  sweepTimer = $.clock.after(config.durationMs + SLACK_MS + 200, () => {
    void update($, sweep, n => n + 1)
  })
}

/** コメントで本体の動きを止めないように、失敗はデバッグログに流すだけ */
async function say($: EngineInterface, drafts: readonly Draft[], byUser = false): Promise<void> {
  try {
    await emit($, drafts, byUser)
  } catch (err) {
    $.ui.log(`danmaku: ${String(err)}`, { to: 'debug' })
  }
}

async function loadOff($: EngineInterface): Promise<void> {
  const saved = await $.store.get('isOff')
  await update($, isOff, () => saved === true)
}

async function aiReact($: EngineInterface, answer: string): Promise<void> {
  try {
    const reply = await $.model.complete({ model: 'haiku', prompt: aiPrompt(answer, 6), maxTokens: 300, timeoutMs: 20_000 })
    if (!reply.isAnswered) {
      $.ui.log(`danmaku: AI視聴者は今回お休み (${reply.reason})`, { to: 'debug' })
      return
    }
    // 1ターンに1回だけで件数も限られているので、直前の「おつ」の流量に削られないようにする
    await say($, parseAiLines(reply.text, rand), true)
  } catch (err) {
    $.ui.log(`danmaku: ${String(err)}`, { to: 'debug' })
  }
}

/** 作業中、毎秒呼ばれる。経過時間の節目を言い、コメントが途切れていたら視聴者がつぶやく */
async function tickAmbient($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const elapsedMs = now - turn.startedAt
  // 節目を飛ばしていたら、過ぎた中でいちばん新しいものだけ言う
  let minutes: number | undefined
  for (let m = ELAPSED_MINUTES[turn.elapsedIdx]; m !== undefined && elapsedMs >= m * 60_000; m = ELAPSED_MINUTES[turn.elapsedIdx]) {
    minutes = m
    turn.elapsedIdx += 1
  }
  if (minutes !== undefined) return say($, reactToElapsed(minutes, rand))
  if (now - lastEmitAt < quietMs) return
  const ctx = {
    elapsedMs,
    tools: turn.tools,
    isErrorRecent: now - turn.lastErrorAt < ERROR_RECENT_MS,
    isBusy: turn.toolTimes.filter(t => now - t < BUSY_WINDOW_MS).length >= BUSY_TOOLS,
  }
  const n = config.density === 'high' && rand() < 0.3 ? 2 : 1
  const drafts: Draft[] = []
  for (let i = 0; i < n; i++) drafts.push(...unlike(() => ambient(rand, ctx)))
  await say($, drafts)
}

function helpText(off: boolean): string {
  return HELP.replace('{state}', off ? 'オフ' : 'オン')
    .replace('{lanes}', String(config.lanes))
    .replace('{speed}', config.speed)
    .replace('{density}', config.density)
    .replace('{ai}', config.aiViewers ? '・AI視聴者あり' : '')
}

export const register: Register = (on, options) => {
  config.lanes = intOption(options.lanes, 3, 1, 5)
  config.speed = nameOption(options.speed, SPEED_MS, 'normal')
  config.density = nameOption(options.density, DENSITY, 'normal')
  config.durationMs = SPEED_MS[config.speed] ?? 5000
  config.chance = DENSITY[config.density] ?? 0.65
  config.quietMs = QUIET_MS[config.density] ?? 2500
  config.aiViewers = options.aiViewers === true
  autoTimes = []
  lastEmitAt = 0
  quietMs = config.quietMs
  recent = []
  turn = freshTurn(0)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'danmaku',
      description: '弾幕コメントを流す・止める（on / off / demo / コメント）',
      argumentHint: '[on|off|demo|コメント]',
      immediate: true,
    })
    await loadOff($)
    return next(e)
  })

  // /clear・/resume・/branch で $.state が初期値に戻るので、保存したオン/オフを読み直す
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await loadOff($)
    return next(e)
  })

  on('command.run', { command: 'danmaku' }, async ($, e) => {
    const arg = e.args.trim()
    const word = arg.toLowerCase()
    if (word === 'off') {
      await update($, isOff, () => true)
      await $.store.set('isOff', true)
      return { text: '弾幕をオフにしました。/danmaku on で再開します。' }
    }
    if (word === 'on') {
      await update($, isOff, () => false)
      await $.store.set('isOff', false)
      await say($, [{ text: '弾幕復活', color: COLORS.orange, pos: 'ue', isBig: true }], true)
      return { text: '弾幕をオンにしました。' }
    }
    if (word === '' || word === 'help') return { text: helpText(await read($, isOff)) }
    if (await read($, isOff)) return { text: '弾幕はオフです。/danmaku on でオンにできます。' }
    if (word === 'demo') {
      // 一度に流すと行が足りずに捨てられるので、行数に合わせて何回かに分ける
      const size = Math.max(1, 2 * config.lanes - 1)
      await say($, DEMO.slice(0, size), true)
      for (let k = 1; k * size < DEMO.length; k++) {
        const wave = DEMO.slice(k * size, (k + 1) * size)
        $.clock.after(k * DEMO_WAVE_MS, () => {
          void say($, wave, true)
        })
      }
      return {}
    }
    const draft = parseUserComment(arg)
    if (draft === undefined) return { text: 'コメントが空です。例: /danmaku red ue 神回' }
    await say($, [draft], true)
    return {}
  })

  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin.kind
    const isPerson = kind === 'composer' || kind === 'bridge' || kind === 'sdk'
    if (isPerson && !e.text.trimStart().startsWith('/')) {
      const hour = new Date(await $.clock.now()).getHours()
      await say($, reactToPrompt(e.text, rand, hour))
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    turn = freshTurn(await $.clock.now())
    ambientTimer?.cancel()
    ambientTimer = $.clock.every(AMBIENT_TICK_MS, () => {
      void tickAmbient($)
    })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Readonly<Record<string, unknown>>
    const isSubagent = e.agentId !== undefined
    const scale = isSubagent ? 0.4 : 1
    // 流量の上限で後ろから削られるので、一度きりの連発・節目を先に並べる
    const before: Draft[] = []
    if (!isSubagent) {
      const now = await $.clock.now()
      turn.tools += 1
      turn.streak = tool === turn.tool ? turn.streak + 1 : 1
      turn.tool = tool
      turn.toolTimes = [...turn.toolTimes.filter(t => now - t < BUSY_WINDOW_MS), now]
      if (COMBO_AT.includes(turn.streak)) before.push(...reactToCombo(tool, turn.streak, rand))
      if (MILESTONES.includes(turn.tools)) before.push(...reactToMilestone(turn.tools, rand))
    }
    if (rand() < config.chance * scale) before.push(...unlike(() => reactToToolStart(tool, input, rand)))
    await say($, before)

    const ran = await next(e)
    const outcome = { isError: ran.isError === true, isDenied: ran.deny !== undefined }
    const after = reactToToolEnd(tool, input, outcome, rand)
    if (!isSubagent && outcome.isError) {
      turn.errors += 1
      turn.errorStreak += 1
      turn.lastErrorAt = await $.clock.now()
      if (turn.errorStreak >= 2) after.push(...reactToErrorStreak(turn.errorStreak, rand))
    } else if (!isSubagent && !outcome.isDenied) {
      turn.errorStreak = 0
    }
    if (after.length === 0 && !outcome.isError && !outcome.isDenied && rand() < config.chance * PRAISE_RATE * scale) {
      after.push(...unlike(() => reactToToolOk(tool, input, rand)))
    }
    await say($, after)
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      ambientTimer?.cancel()
      ambientTimer = undefined
      // つぶやきはもう止まったので、締めのコメントが直前のつぶやきの流量に削られないようにする
      autoTimes = []
      await say($, reactToTurnEnd({ reason: e.reason, durationMs: e.durationMs, tools: turn.tools, errors: turn.errors }, rand))
      if (config.aiViewers && e.reason === 'answer' && e.answer.trim() !== '') {
        const answer = e.answer
        $.clock.after(10, () => {
          void aiReact($, answer)
        })
      }
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    if (e.props.hasSurvey) return next(e)
    if (await read($, isOff)) return next(e)
    const list = await read($, comments)
    await read($, sweep)
    const now = await $.clock.now()
    const live = list.filter(c => now - c.at < lifeOf(c))
    // 作業中か、まだ流れているコメントがあるときだけ帯を出す
    if (live.length === 0 && !e.props.isWorking) return next(e)

    const rows = Math.max(1, Math.min(config.lanes, e.props.maxRows))
    const props: ScreenProps = {
      surface: e.surface,
      cols: e.props.bodyColumns,
      lanes: rows,
      durationMs: config.durationMs,
      fixedMs: FIXED_MS,
      now,
      comments: live,
    }
    const theirs = await next(e)
    const { Box, Client } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Client key="screen" module="./screen.tsx" props={props} width="100%" height={rows} />
        {theirs}
      </Box>
    )
  })
}
