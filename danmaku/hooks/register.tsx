// danmaku: Claude の作業に合わせて、プロンプトの上にニコニコ風の弾幕コメントを流す mod。
//
// - プロンプトを送る / ツールを呼ぶ / エラーが出る / ターンが終わる、に反応してコメントが流れる
// - 作業中は、画面を流れるコメントが減ったら視聴者がつぶやいて埋める（何件保つかは density で変わる）。ときどき盛り上がる
// - 同じコメントばかりにならないよう、しばらく流していないものを選び、お題の言葉やさわっているファイルにも触れる
// - ターンが終わっても裏で作業（バックグラウンドのシェル・サブエージェント・ワークフロー）が続いていれば、終わるまでつぶやく
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
  chatterPrompt,
  extractTopics,
  fileName,
  isBackgroundLaunch,
  isPersistentCommand,
  isTestCommand,
  parseAiLines,
  parseTaskNotification,
  parseUserComment,
  reactToBackgroundLaunch,
  reactToBackgroundStart,
  reactToCombo,
  reactToElapsed,
  reactToErrorStreak,
  reactToMilestone,
  reactToPrompt,
  reactToTaskNotification,
  reactToToolEnd,
  reactToToolOk,
  reactToToolStart,
  reactToTurnEnd,
  shortCommand,
  testFailed,
  wave,
} from './lines'
import type { Draft } from './lines'

const comments = atom({ plugin: 'danmaku', key: 'comments' } as const, [])
const isOff = atom({ plugin: 'danmaku', key: 'isOff' } as const, false)
const sweep = atom({ plugin: 'danmaku', key: 'sweep' } as const, 0)

/** 1コメントが画面を横切る時間 */
const SPEED_MS: Readonly<Record<string, number>> = { slow: 7000, normal: 5000, fast: 3500 }
/** ツール呼び出しにコメントが付く確率 */
const DENSITY: Readonly<Record<string, number>> = { low: 0.3, normal: 0.65, high: 1 }
/**
 * 作業中と裏の作業を待つ間、画面を流れているコメント（横切る時間の 8 割より新しいもの）がこの数を下回ったら、視聴者がつぶやいて足す。
 * つぶやき同士の間は、横切る時間の 8 割をこの数で割った長さ（の 0.75〜1.25 倍）
 */
const FLOOR: Readonly<Record<string, number>> = { low: 1, normal: 3, high: 5 }
/** つぶやくかどうかを見る間隔。粗いと間の揺らぎが丸められてしまう */
const AMBIENT_TICK_MS = 250
/** 盛り上がり（何件かまとめて流れる）の間隔は WAVE_MIN_MS〜WAVE_MIN_MS + WAVE_SPAN_MS */
const WAVE_MIN_MS = 40_000
const WAVE_SPAN_MS = 40_000
/** 盛り上がりで流す件数 */
const WAVE_SIZE: Readonly<Record<string, number>> = { low: 2, normal: 4, high: 6 }
/** 成功したツール呼び出しをほめる確率（density の確率に掛ける） */
const PRAISE_RATE = 0.35
/** このくらい前までのエラーは「さっきのエラー」 */
const ERROR_RECENT_MS = 15_000
/** BUSY_WINDOW_MS の間に BUSY_TOOLS 回ツールを呼んでいたら「手が速い」 */
const BUSY_WINDOW_MS = 10_000
const BUSY_TOOLS = 4
/** 裏の作業があるとき、分身（サブエージェント・ワークフローの分身）が動いてからまだ続いているとみなす時間 */
const BG_ACTIVITY_MS = 30_000
/** 裏の作業を最初に見てから（分身が動いていればその時から）これだけたったら待つのをやめる */
const BG_MAX_MS = 30 * 60_000
/** 裏のサブエージェントがまだ動いているか、$.agent.list() で確かめる間隔 */
const BG_POLL_MS = 5000
/** ue / shita の固定コメントが出ている時間 */
const FIXED_MS = 3000
/** 空き待ちで出るのが遅れる分の余裕 */
const SLACK_MS = 1800
const KEEP_MAX = 60
/** 自動コメントは RATE_WINDOW_MS あたり RATE_MAX 件まで */
const RATE_WINDOW_MS = 2000
const RATE_MAX = 8
/** このくらい前（件数）までに流したコメントは、なるべく繰り返さない */
const RECENT_MAX = 300
/** 候補をいくつ作って、最近流していないものを選ぶか */
const FRESH_TRIES = 8
/** 作業中の実況（aiChatter）を頼む間隔 */
const CHATTER_MS = 90_000
/** 作業の様子を、AI の実況に見せるために覚えておく数 */
const ACTIVITY_MAX = 20
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
const config = { lanes: 3, speed: 'normal', density: 'normal', durationMs: 5000, chance: 0.65, floor: 3, aiViewers: false, aiChatter: false }

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
/** 次のつぶやきまでに空ける時間 */
let gapMs = 1333
/** 流しているコメント（naka）を出した時刻 */
let flowAts: number[] = []
/** 流したコメントと、それが何件目だったか */
let shown = new Map<string, number>()
let shownCount = 0
/** お題から拾った言葉と、最近さわったファイル・走らせたコマンド（つぶやきのテンプレートに入る） */
let topics: string[] = []
let recentFiles: string[] = []
let recentCmds: string[] = []
/** 作業の様子（AI の実況に見せる）と、それが何件たまったか */
let activity: string[] = []
let activityCount = 0
let chatterAt = Number.NEGATIVE_INFINITY
let chatterSeen = 0
let isChattering = false
/** AI が書いた実況のうち、まだ流していないもの */
let aiQueue: Draft[] = []
let turn = freshTurn(0)
let inTurn = false
let nextWaveAt = Number.POSITIVE_INFINITY
/** 裏で動いている作業。id → 種類（shell / subagent / workflow / monitor ...） */
let bgTasks = new Map<string, string>()
/** 裏の作業が続いていると最後に分かった時刻 */
let bgSeenAt = Number.NEGATIVE_INFINITY
/** 裏の作業を最初に一覧で見た時刻。一覧に載り続けるだけでは待ち時間を延ばさない（拾えなかった開発サーバーで、いつまでも待たない） */
let bgFirstSeen = new Map<string, number>()
/** メインでないループ（サブエージェント・ワークフローの分身）のツール呼び出しを最後に見た時刻 */
let bgActivityAt = Number.NEGATIVE_INFINITY
let bgPolledAt = Number.NEGATIVE_INFINITY

const rand = () => Math.random()

/** drafts のうちいちばん最近流したものが、何件前だったか（流したことがなければ無限大） */
function ageOf(drafts: readonly Draft[]): number {
  let age = Number.POSITIVE_INFINITY
  for (const d of drafts) {
    const at = shown.get(d.key ?? d.text)
    if (at !== undefined) age = Math.min(age, shownCount - at)
  }
  return age
}

/** 候補をいくつか作り、しばらく流していないもの（どれも最近なら、いちばん前に流したもの）を選ぶ */
function freshest(make: () => Draft[]): Draft[] {
  let best = make()
  let bestAge = ageOf(best)
  for (let i = 1; i < FRESH_TRIES && bestAge <= RECENT_MAX; i++) {
    const next = make()
    const age = ageOf(next)
    if (age > bestAge) {
      best = next
      bestAge = age
    }
  }
  return best
}

/** 最近のものを後ろに、重ならないように足す */
const remember = (list: readonly string[], item: string, max = 5): string[] => [...list.filter(x => x !== item), item].slice(-max)

function note(line: string): void {
  activity = [...activity, line].slice(-ACTIVITY_MAX)
  activityCount += 1
}

function lifeOf(c: DanmakuComment): number {
  return (c.pos === 'naka' ? config.durationMs : FIXED_MS) + SLACK_MS
}

/**
 * メインのターンは終わったが、裏で作業が続いているか。
 * 分身の動きだけでは決めない（メモリや要約のためのエンジンの分身も動くので）。ターンの終わりの一覧に載っているものだけ待つ
 */
function isBackground(now: number): boolean {
  if (inTurn || bgTasks.size === 0) return false
  return now - bgActivityAt < BG_ACTIVITY_MS || now - bgSeenAt < BG_MAX_MS
}

function nextGap(): number {
  return ((config.durationMs * 0.8) / config.floor) * (0.75 + 0.5 * rand())
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
  gapMs = nextGap()
  flowAts = [...flowAts.filter(t => now - t < config.durationMs), ...list.filter(d => (d.pos ?? 'naka') === 'naka').map(() => now)]
  for (const d of list) shown.set(d.key ?? d.text, ++shownCount)
  if (shown.size > 4 * RECENT_MAX) shown = new Map([...shown].filter(([, at]) => shownCount - at <= RECENT_MAX))
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

/** 作業中の実況（aiChatter）。いままでの作業の様子を Haiku に見せて、視聴者のコメントを書いてもらう */
async function chatter($: EngineInterface): Promise<void> {
  try {
    const reply = await $.model.complete({ model: 'haiku', prompt: chatterPrompt(activity, 10), maxTokens: 400, timeoutMs: 20_000 })
    if (reply.isAnswered) aiQueue = [...aiQueue, ...parseAiLines(reply.text, rand, 12)].slice(-24)
    else $.ui.log(`danmaku: AI実況は今回お休み (${reply.reason})`, { to: 'debug' })
  } catch (err) {
    $.ui.log(`danmaku: ${String(err)}`, { to: 'debug' })
  } finally {
    isChattering = false
  }
}

/** 作業中か裏の作業を待っている間だけ、つぶやきの見回りを回す */
function syncAmbient($: EngineInterface, now: number): void {
  const want = inTurn || isBackground(now)
  if (want && ambientTimer === undefined) {
    ambientTimer = $.clock.every(AMBIENT_TICK_MS, () => {
      void tickAmbient($)
    })
  } else if (!want && ambientTimer !== undefined) {
    ambientTimer.cancel()
    ambientTimer = undefined
  }
}

/** 裏で動いている作業の一覧を受け取る。終わらない裏方（開発サーバーなど）は数えない。新しい作業が来たときだけ、待つ時間を数え直す */
function setBackground(tasks: ReadonlyArray<{ id: string; type: string; status?: string; command?: string; description?: string }>, now: number): void {
  const live = tasks
    .filter(t => t.status === undefined || t.status === 'running' || t.status === 'pending')
    .filter(t => !(t.type === 'shell' && isPersistentCommand(t.command ?? t.description ?? '')))
  const isNew = live.some(t => !bgFirstSeen.has(t.id))
  bgFirstSeen = new Map(live.map(t => [t.id, bgFirstSeen.get(t.id) ?? now]))
  bgTasks = new Map(live.map(t => [t.id, t.type]))
  if (isNew) bgSeenAt = now
}

/** 裏のサブエージェントが終わっていたら一覧から外す。まだ動いていれば、待ち続ける */
async function pollAgents($: EngineInterface, now: number): Promise<void> {
  if (now - bgPolledAt < BG_POLL_MS || ![...bgTasks.values()].includes('subagent')) return
  bgPolledAt = now
  try {
    const agents = await $.agent.list()
    for (const [id, type] of bgTasks) {
      if (type !== 'subagent') continue
      const agent = agents.find(a => a.id === id)
      if (agent === undefined) continue
      if (agent.status === 'running') bgSeenAt = now
      else bgTasks.delete(id)
    }
  } catch (err) {
    $.ui.log(`danmaku: ${String(err)}`, { to: 'debug' })
  }
}

/**
 * 作業中と、裏の作業を待っている間、250ms ごとに呼ばれる。
 * 経過時間の節目を言い、ときどき盛り上がり、流れているコメントが減ったら視聴者がつぶやく
 */
async function tickAmbient($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  if (!inTurn) {
    await pollAgents($, now)
    if (!isBackground(now)) {
      bgTasks.clear()
      return syncAmbient($, now)
    }
  }
  const elapsedMs = now - turn.startedAt
  if (inTurn) {
    // 節目を飛ばしていたら、過ぎた中でいちばん新しいものだけ言う
    let minutes: number | undefined
    for (let m = ELAPSED_MINUTES[turn.elapsedIdx]; m !== undefined && elapsedMs >= m * 60_000; m = ELAPSED_MINUTES[turn.elapsedIdx]) {
      minutes = m
      turn.elapsedIdx += 1
    }
    if (minutes !== undefined) return say($, freshest(() => reactToElapsed(minutes, rand)))
    if (now >= nextWaveAt) {
      // さっきエラーが出たばかりなら、盛り上がるのは落ち着いてから
      if (now - turn.lastErrorAt < ERROR_RECENT_MS) nextWaveAt = turn.lastErrorAt + ERROR_RECENT_MS
      else {
        nextWaveAt = now + WAVE_MIN_MS + WAVE_SPAN_MS * rand()
        return say($, freshest(() => wave(rand, WAVE_SIZE[config.density] ?? 4)))
      }
    }
  }
  if (inTurn && config.aiChatter && !isChattering && now - chatterAt >= CHATTER_MS && activityCount > chatterSeen) {
    isChattering = true
    chatterAt = now
    chatterSeen = activityCount
    void chatter($)
  }
  const flowing = flowAts.filter(t => now - t < config.durationMs * 0.8).length
  if (flowing >= config.floor || now - lastEmitAt < gapMs) return
  // AI の実況があれば、ふつうのつぶやきに混ぜて流す
  const ai = aiQueue.length > 0 && rand() < 0.6 ? aiQueue.shift() : undefined
  if (ai !== undefined) return say($, [ai])
  const ctx = {
    elapsedMs,
    tools: turn.tools,
    isErrorRecent: inTurn && now - turn.lastErrorAt < ERROR_RECENT_MS,
    isBusy: inTurn && turn.toolTimes.filter(t => now - t < BUSY_WINDOW_MS).length >= BUSY_TOOLS,
    isBackground: !inTurn,
    backgroundTasks: bgTasks.size,
    topics,
    files: recentFiles,
    cmds: recentCmds,
    canReply: now - lastEmitAt < 2500,
  }
  await say($, freshest(() => ambient(rand, ctx)))
}

function helpText(off: boolean): string {
  return HELP.replace('{state}', off ? 'オフ' : 'オン')
    .replace('{lanes}', String(config.lanes))
    .replace('{speed}', config.speed)
    .replace('{density}', config.density)
    .replace('{ai}', [config.aiViewers ? '・AI視聴者' : '', config.aiChatter ? '・AI実況' : ''].join(''))
}

export const register: Register = (on, options) => {
  config.lanes = intOption(options.lanes, 3, 1, 5)
  config.speed = nameOption(options.speed, SPEED_MS, 'normal')
  config.density = nameOption(options.density, DENSITY, 'normal')
  config.durationMs = SPEED_MS[config.speed] ?? 5000
  config.chance = DENSITY[config.density] ?? 0.65
  config.floor = FLOOR[config.density] ?? 3
  config.aiViewers = options.aiViewers === true
  config.aiChatter = options.aiChatter === true
  autoTimes = []
  lastEmitAt = 0
  gapMs = nextGap()
  flowAts = []
  shown = new Map()
  shownCount = 0
  topics = []
  recentFiles = []
  recentCmds = []
  activity = []
  activityCount = 0
  chatterAt = Number.NEGATIVE_INFINITY
  chatterSeen = 0
  isChattering = false
  aiQueue = []
  turn = freshTurn(0)
  inTurn = false
  nextWaveAt = Number.POSITIVE_INFINITY
  bgTasks = new Map()
  bgSeenAt = Number.NEGATIVE_INFINITY
  bgFirstSeen = new Map()
  bgActivityAt = Number.NEGATIVE_INFINITY
  bgPolledAt = Number.NEGATIVE_INFINITY

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
        const part = DEMO.slice(k * size, (k + 1) * size)
        $.clock.after(k * DEMO_WAVE_MS, () => {
          void say($, part, true)
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
      topics = extractTopics(e.text)
      note(`お題: ${e.text.replace(/\s+/g, ' ').trim().slice(0, 80)}`)
      await say($, freshest(() => reactToPrompt(e.text, rand, hour)))
    } else if (kind === 'task-notification') {
      // 裏の作業が終わった（または何か知らせてきた）
      const now = await $.clock.now()
      const notice = parseTaskNotification(e.text)
      if (notice.isFinished && notice.id !== undefined) bgTasks.delete(notice.id)
      if (bgTasks.size > 0) bgSeenAt = now
      await say($, freshest(() => reactToTaskNotification(notice.status, rand)))
      syncAmbient($, now)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    turn = freshTurn(now)
    inTurn = true
    aiQueue = []
    nextWaveAt = now + WAVE_MIN_MS + WAVE_SPAN_MS * rand()
    syncAmbient($, now)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Readonly<Record<string, unknown>>
    const isSubagent = e.agentId !== undefined
    const scale = isSubagent ? 0.4 : 1
    const now = await $.clock.now()
    // 流量の上限で後ろから削られるので、一度きりの連発・節目を先に並べる
    const before: Draft[] = []
    if (isSubagent) {
      // ターンの終わりの一覧に裏の作業があり、分身がまだ動いているなら、それは続いている
      if (!inTurn && bgTasks.size > 0) {
        bgActivityAt = now
        bgSeenAt = now
        syncAmbient($, now)
      }
    } else {
      turn.tools += 1
      turn.streak = tool === turn.tool ? turn.streak + 1 : 1
      turn.tool = tool
      turn.toolTimes = [...turn.toolTimes.filter(t => now - t < BUSY_WINDOW_MS), now]
      const file = fileName(input)
      if (file !== undefined) recentFiles = remember(recentFiles, file)
      const command = typeof input.command === 'string' ? shortCommand(input.command) : ''
      if (command !== '') recentCmds = remember(recentCmds, command)
      if (COMBO_AT.includes(turn.streak)) before.push(...freshest(() => reactToCombo(tool, turn.streak, rand)))
      if (MILESTONES.includes(turn.tools)) before.push(...freshest(() => reactToMilestone(turn.tools, rand)))
      if (isBackgroundLaunch(tool, input)) before.push(...freshest(() => reactToBackgroundLaunch(rand)))
    }
    if (rand() < config.chance * scale) before.push(...freshest(() => reactToToolStart(tool, input, rand)))
    await say($, before)

    const ran = await next(e)
    // 裏に回したものは、走り出しただけ。結果は終わったときの知らせで分かる
    const isLaunch = isBackgroundLaunch(tool, input)
    const isTestRun = !isLaunch && isTestCommand(tool, input)
    // `npm test | tail` のように終了コードが隠れても、出力に失敗の跡があれば失敗とみなす
    const outcome = {
      isError: ran.isError === true || (isTestRun && testFailed(ran.text ?? '')),
      isDenied: ran.deny !== undefined,
    }
    const after = isLaunch && !outcome.isError && !outcome.isDenied ? [] : freshest(() => reactToToolEnd(tool, input, outcome, rand))
    if (!isSubagent) {
      const what = fileName(input) ?? (typeof input.command === 'string' ? shortCommand(input.command) : '')
      note(`${tool}${what === '' ? '' : ` ${what}`}${outcome.isError ? ' → エラー' : outcome.isDenied ? ' → 拒否' : ''}`)
    }
    if (!isSubagent && outcome.isError) {
      turn.errors += 1
      turn.errorStreak += 1
      turn.lastErrorAt = await $.clock.now()
      if (turn.errorStreak >= 2) after.push(...freshest(() => reactToErrorStreak(turn.errorStreak, rand)))
    } else if (!isSubagent && !outcome.isDenied) {
      turn.errorStreak = 0
    }
    if (!outcome.isError && !outcome.isDenied && isTestRun) {
      // テストが通ったら盛り上がる
      after.push(...freshest(() => wave(rand, Math.max(1, (WAVE_SIZE[config.density] ?? 4) - 1))))
    } else if (!isLaunch && after.length === 0 && !outcome.isError && !outcome.isDenied && rand() < config.chance * PRAISE_RATE * scale) {
      after.push(...freshest(() => reactToToolOk(tool, input, rand)))
    }
    await say($, after)
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      inTurn = false
      nextWaveAt = Number.POSITIVE_INFINITY
      // 作業中のつぶやきはここで区切るので、締めのコメントが直前のつぶやきの流量に削られないようにする
      autoTimes = []
      const summary = { reason: e.reason, durationMs: e.durationMs, tools: turn.tools, errors: turn.errors }
      await say($, freshest(() => reactToTurnEnd(summary, rand)))
      syncAmbient($, now)
      if (config.aiViewers && e.reason === 'answer' && e.answer.trim() !== '') {
        const answer = e.answer
        $.clock.after(10, () => {
          void aiReact($, answer)
        })
      }
    }
    return result
  })

  // メインのターンの終わりに、まだ裏で動いている作業の一覧が来る
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    try {
      const now = await $.clock.now()
      setBackground(e.background_tasks ?? [], now)
      if (bgTasks.size > 0) {
        const n = bgTasks.size
        // 「おつ」の流れのあとに言う
        $.clock.after(RATE_WINDOW_MS + 100, () => {
          if (isBackground(now + RATE_WINDOW_MS)) void say($, freshest(() => reactToBackgroundStart(n, rand)))
        })
      }
      syncAmbient($, now)
    } catch (err) {
      $.ui.log(`danmaku: ${String(err)}`, { to: 'debug' })
    }
    return result
  })

  // サブエージェントが止まった。裏の作業の一覧も新しくなる
  on('classic.SubagentStop', async ($, e, next) => {
    const result = await next(e)
    try {
      const now = await $.clock.now()
      if (!inTurn && e.background_tasks !== undefined) setBackground(e.background_tasks, now)
      bgTasks.delete(e.agent_id)
      syncAmbient($, now)
    } catch (err) {
      $.ui.log(`danmaku: ${String(err)}`, { to: 'debug' })
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
    // 作業中か、裏の作業を待っているか、まだ流れているコメントがあるときだけ帯を出す
    if (live.length === 0 && !e.props.isWorking && !isBackground(now)) return next(e)

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
