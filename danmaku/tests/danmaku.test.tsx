import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { DanmakuComment, ScreenProps } from '../types'
import {
  MAX_WAIT_MS,
  advance,
  clipAround,
  composeRow,
  drawTime,
  emptyModel,
  flowX,
  framePieces,
  frameRows,
  ingest,
  replaceModel,
  sanitize,
  stepClock,
  textWidth,
  tick,
} from '../hooks/layout'
import type { ScreenConfig, ScreenState } from '../hooks/layout'
import * as lines from '../hooks/lines'
import {
  AFTER_ERROR_LINES,
  BASH_SPECIAL,
  BG_AMBIENT_LINES,
  BG_COUNT_LINES,
  BG_DONE_LINES,
  BG_FAIL_LINES,
  BG_LAUNCH_LINES,
  BG_PARALLEL_LINES,
  BG_START_LINES,
  COLORS,
  COMBO_BY_GROUP,
  COMBO_LINES,
  DEMO,
  DENIED_LINES,
  ELAPSED_LINES,
  ERROR_LINES,
  ERROR_STREAK_LINES,
  FILE_KINDS,
  LONG_PROMPT_LINES,
  MILESTONE_LINES,
  NO_TOOLS_LINES,
  OTSU_LINES,
  PROMPT_TOPICS,
  SHORT_PROMPT_LINES,
  THINKING_LINES,
  TIME_LINES,
  TOUGH_TURN_LINES,
  WAVE_LINES,
  ambient,
  isBackgroundLaunch,
  isPersistentCommand,
  parseTaskNotification,
  parseUserComment,
  reactToPrompt,
  reactToToolEnd,
  reactToBackgroundStart,
  reactToTurnEnd,
  testFailed,
} from '../hooks/lines'
import type { Draft, Line } from '../hooks/lines'

const SURFACES = ['terminal', 'desktop'] as const

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

const textOf = (n: unknown): string =>
  typeof n === 'string' ? n : ((n as Node).children ?? []).map(textOf).join('')

/** Desktop の片が置かれたセル位置。窓（overflow hidden の Box）に入っていれば、中の Box の marginLeft も足す */
const xOf = (k: Node): number => {
  const inner = (k.children ?? []).find((c): c is Node => typeof c !== 'string' && (c as Node).type === 'Box')
  return Number(k.props?.left ?? 0) + Number(k.props?.marginLeft ?? 0) + Number(inner?.props?.marginLeft ?? 0)
}

/**
 * Client が描いた木を、行ごとの文字列にする。
 * Desktop の木は片ごとの絶対配置なので、その位置（中央寄せは cols の真ん中）に置き、
 * ターミナルと同じ規則（composeRow）でセルに並べ直す
 */
const rowsOf = (tree: unknown, cols: number): string[] => {
  const root = tree as Node
  const kids = (root.children ?? []).filter((k): k is Node => typeof k !== 'string')
  if (!kids.some(k => k.props?.position === 'absolute')) return kids.map(textOf)
  return Array.from({ length: Number(root.props?.height) }, (_, lane) => {
    const items = kids
      .filter(k => k.props?.top === lane)
      .map(k => {
        const text = textOf(k)
        const isFixed = k.props?.justifyContent === 'center'
        const x = isFixed ? Math.floor((cols - textWidth(text)) / 2) : xOf(k)
        return { x, text, color: null, isBig: false }
      })
    return composeRow(items, cols)
      .map(seg => seg.text)
      .join('')
  })
}

/** row の中で text が始まるセル位置 */
const colOf = (row: string, text: string): number => {
  const i = row.indexOf(text)
  return i < 0 ? -1 : textWidth(row.slice(0, i))
}

const texts = (list: ReadonlyArray<string | Draft>): string[] => list.map(l => (typeof l === 'string' ? l : l.text))

/** 置き換え文字（{n} など）を埋めた本文 */
const filled = (list: ReadonlyArray<string | Draft>, vars: Record<string, string>): string[] =>
  texts(list).map(t => t.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? ''))

/** pool のコメントそのものか、語尾や頭に言葉が足されたもの（lines.vary）か */
const isFrom = (list: ReadonlyArray<string | Draft>, vars: Record<string, string> = {}) => {
  const bases = filled(list, vars)
  return (text: string) =>
    bases.some(b => text === b || text === b + b || lines.SUFFIXES.some(x => text === b + x) || lines.PREFIXES.some(x => text === x + b))
}

const runCommand = ($: Engine, args: string) =>
  $.command.run({ command: 'danmaku', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })

function band(isWorking: boolean, bodyColumns = 60) {
  return {
    plugin: 'danmaku',
    component: 'AbovePrompt' as const,
    props: { hasSurvey: false, isWorking, maxRows: 12, bodyColumns, scroll: { offset: 0, bodyRows: 12 }, view: {} },
    viewport: { columns: bodyColumns + 5, rows: 30 },
  }
}

/** エンジンの代わり: 時計とストアはメモリ、帯にはエンジン自身は何も描かない。設定の Stop フックはない */
function world(on: On) {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('classic.Stop', () => ({}))
  on('classic.SubagentStop', () => ({}))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  return clock
}

/** 帯に渡っているコメント（作業中の帯を描かせて、Client の props から読む） */
async function onAir($: Engine): Promise<DanmakuComment[]> {
  const ui = await $.ui.mount({ ...band(true), surface: 'terminal' })
  const client = await ui.find({ type: 'Client' })
  await ui.unmount()
  return (client?.props.props as ScreenProps | undefined)?.comments ?? []
}

/** 前に読んだ分を除いて、新しく帯に渡ったコメントを返す関数を作る */
function freshOnAir($: Engine): () => Promise<string[]> {
  const seen = new Set<number>()
  return async () => {
    const out: string[] = []
    for (const c of await onAir($)) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      out.push(c.text)
    }
    return out
  }
}

/** classic.Stop が渡す、裏で動いている作業 */
const bgTask = (id: string, type: string, command?: string) => ({
  id,
  type,
  status: 'running',
  description: command ?? id,
  ...(command === undefined ? {} : { command }),
})

/** 裏の作業が終わったときに届く知らせ */
const notice = (id: string, status: string) =>
  `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n<summary>done</summary>\n</task-notification>`

/** 裏の作業を待っているときに流れうるコメント（{n} は 1〜3） */
const BG_TEXTS = [
  ...texts(BG_AMBIENT_LINES),
  ...texts(BG_START_LINES),
  ...['1', '2', '3'].flatMap(n => filled(BG_COUNT_LINES, { n })),
  ...['2', '3'].flatMap(n => filled(BG_PARALLEL_LINES, { n })),
]
const isBgText = isFrom(BG_TEXTS)

/** {n} にありそうな回数を入れた本文すべて */
const anyN = (list: readonly Line[]) => [1, 2, 3, 5, 8, 9, 10, 11, 12, 20].flatMap(n => filled(list, { n: String(n), tool: 'Read' }))
const ALL_COMBOS = [...anyN(COMBO_LINES), ...anyN(COMBO_BY_GROUP.Read ?? [])]
const ALL_MILESTONES = anyN(MILESTONE_LINES)
const ALL_STREAKS = anyN(ERROR_STREAK_LINES)

/**
 * スリープ明けのように時刻だけが飛ぶ時計。clock.every の1周期は tick() を呼んだときだけ進む
 * （mock.clock は飛ばした分の周期を全部鳴らすので、節目を飛ばす場面を作れない）
 */
function sleepyClock(on: On) {
  let now = 1_000_000
  let due: Array<() => void> = []
  on('clock.now', () => ({ value: now }))
  on('clock.after', () => ({ value: undefined }))
  on('clock.every', () => new Promise(resolve => due.push(() => resolve({ value: undefined }))))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  return {
    jump: (ms: number) => {
      now += ms
    },
    tick: async () => {
      const ready = due
      due = []
      for (const resolve of ready) resolve()
      await new Promise(r => setTimeout(r, 20))
    },
  }
}

const cfg: ScreenConfig = { cols: 40, lanes: 3, durationMs: 4000, fixedMs: 3000 }
const comment = (id: number, text: string, extra: Partial<DanmakuComment> = {}): DanmakuComment => ({
  id,
  text,
  color: null,
  pos: 'naka',
  isBig: false,
  at: 0,
  ...extra,
})

describe('layout', () => {
  test('全角・半角の幅を数える', () => {
    expect(textWidth('abc')).toBe(3)
    expect(textWidth('草')).toBe(2)
    expect(textWidth('ｗｗ')).toBe(4)
    expect(textWidth('ﾜｸﾜｸ')).toBe(4)
    expect(textWidth('（ ´∀｀）')).toBe(9)
  })

  test('端にかかる全角文字は空白になり、行の幅は変わらない', () => {
    const left = composeRow([{ x: -1, text: '草草', color: null, isBig: false }], 6)
    expect(left.map(s => s.text).join('')).toBe(' 草')
    const right = composeRow([{ x: 5, text: '草', color: COLORS.green, isBig: false }], 6)
    expect(right).toEqual([])
  })

  test('全角文字の片側を上書きしたら、残りの半分は空白になる', () => {
    const segs = composeRow(
      [
        { x: 0, text: 'あいう', color: null, isBig: false },
        { x: 1, text: 'X', color: COLORS.red, isBig: true },
      ],
      6,
    )
    expect(segs).toEqual([
      { text: ' ', color: null, isBig: false },
      { text: 'X', color: COLORS.red, isBig: true },
      { text: 'いう', color: null, isBig: false },
    ])
    expect(textWidth(segs.map(s => s.text).join(''))).toBe(6)
  })

  test('コメントは右端から入って左へ流れ、流れきったら消える', () => {
    let m = ingest(emptyModel(cfg), [comment(1, 'おつ')])
    expect(m.flights).toHaveLength(1)
    expect(frameRows(m)[0]).toEqual([])
    m = advance(m, 1000)
    const row = frameRows(m)[0]!.map(s => s.text).join('')
    expect(colOf(row, 'おつ')).toBe(29)
    m = advance(m, 3000)
    expect(m.flights).toHaveLength(0)
  })

  test('同時に来たコメントは別の行に分かれ、行が足りなければ空くまで待つ', () => {
    const two = ingest(emptyModel(cfg), [comment(1, 'あいうえお'), comment(2, 'かきくけこ')])
    expect(two.flights.map(f => f.lane)).toEqual([0, 1])

    const oneLane = { ...cfg, lanes: 1 }
    let m = ingest(emptyModel(oneLane), [comment(1, 'あいうえお'), comment(2, 'かきくけこ')])
    expect(m.flights).toHaveLength(1)
    expect(m.waiting).toHaveLength(1)
    for (let i = 0; i < 60 && m.waiting.length > 0; i++) m = advance(m, 50)
    expect(m.waiting).toHaveLength(0)
    expect(m.flights.map(f => f.lane)).toEqual([0, 0])
  })

  test('弾幕が多くても、同じ行のコメント同士は重ならない', () => {
    const wide = { ...cfg, cols: 60 }
    let m = ingest(emptyModel(wide), DEMO.map((d, i) => comment(i + 1, d.text, { pos: d.pos ?? 'naka' })))
    for (let i = 0; i < 160; i++) {
      m = advance(m, 50)
      for (let lane = 0; lane < wide.lanes; lane++) {
        const spans = m.flights
          .filter(f => f.lane === lane && f.pos === 'naka')
          .map(f => ({ x: Math.round(flowX(f, m.t, wide)), w: f.w }))
          .sort((a, b) => a.x - b.x)
        for (let k = 1; k < spans.length; k++) expect(spans[k]!.x).toBeGreaterThanOrEqual(spans[k - 1]!.x + spans[k - 1]!.w)
      }
    }
    expect(m.waiting).toHaveLength(0)
  })

  test('入る余地がないまま待ちすぎたコメントは流さない', () => {
    const narrow = { ...cfg, cols: 20, lanes: 1 }
    let m = ingest(emptyModel(narrow), Array.from({ length: 30 }, (_, i) => comment(i + 1, 'ながいコメント')))
    const ids = new Set<number>()
    for (let t = 0; t <= MAX_WAIT_MS + 200; t += 50) {
      for (const f of m.flights) ids.add(f.id)
      m = advance(m, 50)
    }
    expect(m.waiting).toHaveLength(0)
    expect(ids.size).toBeLessThan(30)
    expect(ids.size).toBeGreaterThan(1)
  })

  test('Desktop の片は小数のセル位置に置き、端からはみ出した文字も落とさない', () => {
    const m = ingest(emptyModel(cfg), [comment(1, 'おつ')])
    const [mid, edge] = [advance(m, 1010), advance(m, 3900)]
    for (const at of [mid, edge]) {
      expect(framePieces(at)[0]).toEqual([
        { x: flowX(at.flights[0]!, at.t, cfg), text: 'おつ', color: null, isBig: false, isFixed: false },
      ])
    }
    expect(Number.isInteger(framePieces(mid)[0]![0]!.x)).toBe(false)
    expect(framePieces(edge)[0]![0]!.x).toBeLessThan(0)
  })

  test('固定コメントにかかる流れるコメントは、文字を切らずに、穴の左右の窓で切る', () => {
    const item = { x: 2.5, text: 'あいうえおかきくけこ', color: null, isBig: false }
    const piece = { ...item, isFixed: false }
    expect(clipAround(item, [[8, 12]], 30)).toEqual([
      { ...piece, clip: [0, 8] },
      { ...piece, clip: [12, 31] },
    ])
    // 重なる穴はまとめて抜く
    expect(clipAround(item, [[5, 15], [8, 10]], 30)).toEqual([
      { ...piece, clip: [0, 5] },
      { ...piece, clip: [15, 31] },
    ])
    // セルより太い文字も、穴にかかる分は切る
    expect(clipAround({ ...item, text: 'WW' }, [[5, 8]], 30)).toEqual([{ ...piece, text: 'WW' }])
    expect(clipAround({ ...item, text: 'WW' }, [[5, 8]], 30, 1)).toEqual([{ ...piece, text: 'WW', clip: [0, 5] }])
    // 穴にかからなければ窓はいらない。画面の外に出きったら描かない
    expect(clipAround(item, [[25, 28]], 30)).toEqual([piece])
    expect(clipAround({ ...item, x: -20 }, [], 30)).toEqual([])
    expect(clipAround({ ...item, x: 30 }, [], 30)).toEqual([])
    // 頭が穴に入っていれば、右の窓だけ
    expect(clipAround({ ...item, x: 8.5, text: 'あい' }, [[8, 12]], 30)).toEqual([
      { ...piece, x: 8.5, text: 'あい', clip: [12, 31] },
    ])
  })

  test('Desktop では、流れるコメントを幅の2倍ぶん左端の外へ出るまで残す', () => {
    // 幅 4 のコメントは x = -8 で消える: 4000 * (40 + 8) / 44 ≒ 4364ms
    const desk = { ...cfg, overhang: 1 }
    const m = ingest(emptyModel(desk), [comment(1, 'WWWW')])
    const late = advance(m, 4300)
    expect(late.flights).toHaveLength(1)
    expect(framePieces(late)[0]).toHaveLength(1)
    expect(advance(m, 4400).flights).toHaveLength(0)
    // ターミナル（overhang なし）は x = -4 で消える
    expect(advance(ingest(emptyModel(cfg), [comment(1, 'WWWW')]), 4000).flights).toHaveLength(0)
  })

  test('時計は実時間に合わせて進み、テストの時計では1コマずつ進む', () => {
    // 測り直しの最初のコマと、実時間がほとんど進まない時計では tickMs ずつ
    expect(stepClock(undefined, 500, 16, 100)).toEqual({ dt: 16, wall: 500 })
    let wall: number | undefined = 500
    for (let i = 1; i <= 10; i++) {
      const step = stepClock(wall, 500 + i * 0.03, 16, 100)
      expect(step.dt).toBe(16)
      wall = step.wall
    }
    // 遅れて来たコマは遅れた分まで進め、すぐ後の早いコマで進みすぎた分は、次に遅れたときに差し引く
    expect(stepClock(100, 130, 16, 100)).toEqual({ dt: 30, wall: 130 })
    expect(stepClock(130, 132, 16, 100)).toEqual({ dt: 16, wall: 146 })
    expect(stepClock(146, 168, 16, 100)).toEqual({ dt: 22, wall: 168 })
    // 長く止まっていたら上限まで
    expect(stepClock(0, 5000, 16, 100)).toEqual({ dt: 100, wall: 5000 })
    // 16ms の格子で、ときどき遅れて来るタイマーでも、進んだ時間の合計は実時間とほぼ同じ
    let w: number | undefined
    let sum = 0
    let now = 0
    for (let k = 0; k < 600; k++) {
      now = k * 16 + (k % 7 === 3 ? 13 : k % 5 === 1 ? 2 : 0)
      const step = stepClock(w, now, 16, 100)
      if (w !== undefined) sum += step.dt
      w = step.wall
    }
    expect(Math.abs(sum - now)).toBeLessThanOrEqual(16)
  })

  test('タイマーが遅れたり拍を飛ばしたりしても、描く時刻は戻らず、なめらかに実時間を追う', () => {
    // 16ms の格子で鳴るタイマー（5% の拍は 5〜30ms 遅れ、遅れすぎた拍は飛ばす）と、60Hz の画面の書き換え
    let seed = 7
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647
    const fires: number[] = []
    for (let beat = 16; beat < 61_000; ) {
      const fire = beat + (rand() < 0.05 ? 5 + rand() * 25 : rand() * 0.3)
      fires.push(fire)
      while (beat <= fire) beat += 16
    }
    const long = { ...cfg, cols: 60, durationMs: 1e9 }
    let state: ScreenState = { model: ingest(emptyModel(long), [comment(1, 'わこつ')]), wall: undefined, tickAt: 0 }
    let i = 0
    let shown: number | undefined
    let even = 0
    for (let frame = 1; frame <= 3600; frame++) {
      const now = (frame * 1000) / 60 + 0.5
      while (i < fires.length && fires[i]! <= now) state = tick(state, fires[i++]!, 16, 100)
      const t = drawTime(state, now, 16)
      if (shown !== undefined) {
        expect(t).toBeGreaterThanOrEqual(shown)
        if (Math.abs(t - shown - 1000 / 60) <= 0.5) even += 1
      }
      // 先に進みすぎず（1コマまで）、遅れても取り戻す
      expect(t - now).toBeLessThanOrEqual(16.5)
      expect(now - t).toBeLessThan(100)
      shown = t
    }
    // 遅れていないところでは、画面の書き換えごとに同じだけ進む
    expect(even / 3599).toBeGreaterThan(0.8)
  })

  test('早く来たコマのあとに遅れたコマが来ても、描く時刻は1コマ分までしか先へ足さないので戻らない', () => {
    const m = ingest(emptyModel({ ...cfg, durationMs: 1e9 }), [comment(1, 'わこつ')])
    const early = tick({ model: m, wall: 0, tickAt: 0 }, 10, 16, 100)
    const late = tick(early, 40, 16, 100)
    expect(drawTime(early, 39, 16)).toBe(32)
    expect(drawTime(late, 41, 16)).toBe(41)
  })

  test('止まっていた時計は、新しいコメントが来たときに測り直す', () => {
    const busy = ingest(emptyModel(cfg), [comment(1, 'わこつ')])
    const more = ingest(busy, [comment(2, '草')])
    expect(replaceModel({ model: emptyModel(cfg), wall: 100, tickAt: 100 }, busy, 5000)).toEqual({ model: busy, wall: undefined, tickAt: 5000 })
    expect(replaceModel({ model: busy, wall: 100, tickAt: 90 }, more, 5000)).toEqual({ model: more, wall: 100, tickAt: 90 })
  })

  test('どのコマでも、Desktop の片は固定コメントにかからず、同じ行で重ならない', () => {
    const wide = { ...cfg, cols: 60 }
    const eps = 1e-9
    let m = ingest(emptyModel(wide), DEMO.map((d, i) => comment(i + 1, d.text, { pos: d.pos ?? 'naka', isBig: d.isBig ?? false })))
    for (let i = 0; i < 480; i++) {
      m = advance(m, 16)
      if (i === 60) m = ingest(m, [comment(100, '【お題】ログインのバグを直して', { pos: 'ue' })])
      for (const pieces of framePieces(m)) {
        const fixed = pieces.filter(p => p.isFixed)
        expect(fixed.length).toBeLessThanOrEqual(1)
        expect(pieces.slice(pieces.length - fixed.length).every(p => p.isFixed)).toBe(true)
        const flowing = pieces.filter(p => !p.isFixed)
        for (const p of flowing) {
          // 見えるのは、コメントのセルと窓の重なり。そこは固定コメントにかからない
          const from = Math.max(p.x, p.clip?.[0] ?? -Infinity)
          const to = Math.min(p.x + textWidth(p.text), p.clip?.[1] ?? Infinity)
          expect(from).toBeLessThan(to)
          expect(p.x).toBeLessThan(wide.cols)
          expect(p.x + textWidth(p.text)).toBeGreaterThan(0)
          for (const f of fixed) expect(to <= f.x + eps || from >= f.x + textWidth(f.text) - eps).toBe(true)
        }
        // 窓で分かれた片は同じ位置にある。コメント同士は重ならない
        const spans = [...new Map(flowing.map(p => [p.x, p.x + textWidth(p.text)] as const)).entries()].sort((a, b) => a[0] - b[0])
        spans.forEach(([x], k) => {
          if (k > 0) expect(x).toBeGreaterThanOrEqual(spans[k - 1]![1] - eps)
        })
      }
    }
  })

  test('ue コメントは上の行の真ん中に固定で出る', () => {
    const m = ingest(emptyModel(cfg), [comment(1, '神回', { pos: 'ue', color: COLORS.orange })])
    const row = frameRows(m)[0]!
    expect(row[0]).toEqual({ text: ' '.repeat(18), color: null, isBig: false })
    expect(row[1]).toEqual({ text: '神回', color: COLORS.orange, isBig: false })
    expect(framePieces(m)[0]).toEqual([{ x: 18, text: '神回', color: COLORS.orange, isBig: false, isFixed: true }])
    expect(advance(m, 3000).flights).toHaveLength(0)
  })

  test('すでに見た id のコメントは二度流さない', () => {
    const m = ingest(emptyModel(cfg), [comment(5, 'わこつ')])
    expect(ingest(m, [comment(5, 'わこつ'), comment(3, 'old')])).toBe(m)
  })
})

describe('lines', () => {
  test('ニコニコのコマンドを読む', () => {
    expect(parseUserComment('red ue 神回')).toEqual({ text: '神回', color: COLORS.red, pos: 'ue' })
    expect(parseUserComment('big 8888')).toEqual({ text: '8888', isBig: true })
    expect(parseUserComment('red')).toEqual({ text: 'red' })
    expect(parseUserComment('   ')).toBeUndefined()
  })

  test('ツールの結果ごとに反応が変わる', () => {
    const r = () => 0
    const ng = texts(BASH_SPECIAL.find(s => s.re.test('npm test'))!.ng!)
    const failed = reactToToolEnd('Bash', { command: 'npm test' }, { isError: true, isDenied: false }, r)
    expect(failed.every(d => ng.includes(d.text))).toBe(true)
    const ok = reactToToolEnd('Read', { file_path: '/a/b.ts' }, { isError: false, isDenied: false }, r)
    expect(ok).toEqual([])
    const err = reactToToolEnd('Read', { file_path: '/a/b.ts' }, { isError: true, isDenied: false }, r)
    expect(err.every(d => texts(ERROR_LINES).includes(d.text))).toBe(true)
    const denied = reactToToolEnd('Edit', {}, { isError: false, isDenied: true }, r)
    expect(texts(DENIED_LINES)).toContain(denied[0]!.text)
  })
  test('ネタ帳はどれも空でなく、短く、描けない文字や置き換え忘れがない', () => {
    const vars = { file: 'login.test.ts', cmd: 'npm run build', q: 'TODO', tool: 'Read', n: '12', min: '10', topic: 'ログイン' }
    const pools: Array<[string, readonly Line[]]> = []
    const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
    for (const [name, value] of Object.entries(lines)) {
      const head: unknown = Array.isArray(value) ? value[0] : undefined
      if (typeof head === 'string' || (isObject(head) && 'text' in head)) pools.push([name, value as Line[]])
      else if (isObject(head) && 're' in head) {
        ;(value as Array<{ re: RegExp; lines?: Line[]; start?: Line[]; ok?: Line[]; ng?: Line[] }>).forEach((entry, i) => {
          expect(entry.re.global || entry.re.sticky).toBe(false)
          for (const key of ['lines', 'start', 'ok', 'ng'] as const) {
            const list = entry[key]
            if (list !== undefined) pools.push([`${name}[${i}].${key}`, list])
          }
        })
      } else if (isObject(value) && !Array.isArray(value) && name !== 'COLORS') {
        for (const [key, list] of Object.entries(value)) pools.push([`${name}.${key}`, list as Line[]])
      }
    }
    expect(pools.length).toBeGreaterThan(60)
    const colors = new Set(Object.values(COLORS))
    const all = new Set<string>()
    for (const [name, list] of pools) {
      expect([name, list.length > 0]).toEqual([name, true])
      const seen = new Set<string>()
      for (const line of list) {
        const d: Draft = typeof line === 'string' ? { text: line } : line
        const [text] = filled([d], vars)
        all.add(d.text)
        // 同じネタ帳に同じコメントは2つ置かない
        expect([name, d.text, seen.has(d.text)]).toEqual([name, d.text, false])
        seen.add(d.text)
        expect([name, text, sanitize(text!) === text]).toEqual([name, text, true])
        expect([name, text, textWidth(text!) <= 32]).toEqual([name, text, true])
        expect([name, text, /[{}]/.test(text!)]).toEqual([name, text, false])
        // 絵文字は端末によって幅が変わるので使わない
        expect([name, text, [...text!].some(ch => (ch.codePointAt(0) ?? 0) >= 0x1f000)]).toEqual([name, text, false])
        if (d.color !== undefined) expect(colors.has(d.color)).toBe(true)
        if (d.pos !== undefined && d.pos !== 'naka') expect(['DEMO', 'OTSU_BANNERS']).toContain(name)
      }
    }
    // 種類を増やした分が減っていないか
    expect(all.size).toBeGreaterThan(800)
  })

  test('Bash のコマンドとファイル名で反応が変わる', () => {
    const startOf = (command: string) => texts(BASH_SPECIAL.find(s => s.re.test(command))?.start ?? [])
    const okOf = (command: string) => texts(BASH_SPECIAL.find(s => s.re.test(command))?.ok ?? [])
    expect(startOf('rm -rf node_modules')).toContain('ヒエッ')
    expect(startOf('git push --force origin main')).toContain('勇者現る')
    expect(startOf('git push origin main')).toContain('プッシュ！')
    expect(startOf('git push origin main')).not.toContain('勇者現る')
    for (const command of ['npm test', 'npx vitest run', 'pytest -q', 'go test ./...', 'claude plugin test ./danmaku']) {
      expect([command, okOf(command).includes('8888888888')]).toEqual([command, true])
    }
    expect(startOf('npm run build')).toContain('ビルド待機')
    for (const command of ['git rebase main', 'git status', 'npm install', 'docker compose up', 'cat README.md', 'ls -la']) {
      expect([command, startOf(command).length > 0]).toEqual([command, true])
    }
    const kindOf = (name: string) => FILE_KINDS.findIndex(k => k.re.test(name))
    for (const name of ['login.test.ts', 'package.json', 'README.md', 'Dockerfile', 'main.py', 'style.css', '.env', 'App.tsx']) {
      expect([name, kindOf(name) >= 0]).toEqual([name, true])
    }
    expect(kindOf('login.test.ts')).not.toBe(kindOf('login.ts'))
  })

  test('プロンプトの長さや時間帯にも反応する', () => {
    const r = () => 0
    const lateNight = reactToPrompt('ログインのバグを直して', r, 2).map(d => d.text)
    expect(lateNight.some(t => texts(TIME_LINES.lateNight).includes(t))).toBe(true)
    const morning = reactToPrompt('ログインのバグを直して', r, 7).map(d => d.text)
    expect(morning.some(t => texts(TIME_LINES.morning).includes(t))).toBe(true)
    // 時間帯のあいさつは、ときどきだけ
    expect(reactToPrompt('ログインのバグを直して', () => 0.99, 7).some(d => texts(TIME_LINES.morning).includes(d.text))).toBe(false)
    expect(reactToPrompt('直して', r).some(d => texts(SHORT_PROMPT_LINES).includes(d.text))).toBe(true)
    expect(reactToPrompt('仕様'.repeat(101), r).some(d => texts(LONG_PROMPT_LINES).includes(d.text))).toBe(true)
  })

  test('ターンの終わり方と、作業中のつぶやきの様子で反応が変わる', () => {
    const half = () => 0.5
    const quiet = reactToTurnEnd({ reason: 'answer', durationMs: 20_000, tools: 0, errors: 3 }, half).map(d => d.text)
    expect(quiet.some(t => texts(NO_TOOLS_LINES).includes(t))).toBe(true)
    expect(quiet.some(t => texts(TOUGH_TURN_LINES).includes(t))).toBe(true)
    expect(quiet.some(isFrom(OTSU_LINES))).toBe(true)
    const r = () => 0
    const base = { elapsedMs: 10_000, tools: 3, isErrorRecent: false, isBusy: false }
    expect(isFrom(AFTER_ERROR_LINES)(ambient(r, { ...base, isErrorRecent: true })[0]!.text)).toBe(true)
    expect(isFrom(THINKING_LINES)(ambient(r, { ...base, tools: 0 })[0]!.text)).toBe(true)
    expect(ambient(r)).toHaveLength(1)
  })

  test('裏の作業の知らせを読み、裏に回る呼び出しを見分ける', () => {
    expect(parseTaskNotification(notice('wjdmcc8dm', 'completed'))).toEqual({ id: 'wjdmcc8dm', status: 'completed', isFinished: true })
    expect(parseTaskNotification(notice('b2', 'FAILED'))).toEqual({ id: 'b2', status: 'failed', isFinished: true })
    expect(parseTaskNotification('<task-notification><task-id>m1</task-id><event>ok</event></task-notification>')).toEqual({
      id: 'm1',
      status: '',
      isFinished: false,
    })
    expect(isBackgroundLaunch('Bash', { command: 'npm run build', run_in_background: true })).toBe(true)
    expect(isBackgroundLaunch('Bash', { command: 'npm run build' })).toBe(false)
    expect(isBackgroundLaunch('Agent', { prompt: 'x' })).toBe(true)
    expect(isBackgroundLaunch('Agent', { prompt: 'x', run_in_background: false })).toBe(false)
    expect(isBackgroundLaunch('Workflow', {})).toBe(true)
  })

  test('終わらない裏方（開発サーバーなど）だけを見分け、テストの出力から失敗に気づく', () => {
    for (const command of ['npm run dev', 'npm start', 'npx vite', 'docker compose up', 'rails s', 'python manage.py runserver', 'tsc -w', 'npx jest --watchAll', 'tail -f app.log', 'cd web && npm run dev']) {
      expect([command, isPersistentCommand(command)]).toEqual([command, true])
    }
    for (const command of ['npm test > /dev/null 2>&1', 'cd server && npm test', 'go test ./server/...', 'npm run build:dev', 'npx vite build', 'docker compose up -d', 'npm run test -- --watch=false', 'until grep -q Ready dev.log; do sleep 1; done']) {
      expect([command, isPersistentCommand(command)]).toEqual([command, false])
    }
    expect(testFailed('Tests  2 failed | 10 passed')).toBe(true)
    expect(testFailed(' FAIL  src/a.test.ts')).toBe(true)
    expect(testFailed('Tests  12 passed\n0 failed')).toBe(false)
  })

  test('お題から言葉を拾い、コマンドを短くする', () => {
    expect(lines.extractTopics('弾幕の種類足りないから増やして欲しい')).toEqual(['弾幕', '種類'])
    expect(lines.extractTopics('ログインのバグを直して')).toEqual(['ログイン', 'バグ'])
    expect(lines.extractTopics('Fix the README for the danmaku plugin')).toEqual(['README', 'danmaku', 'plugin'])
    expect(lines.shortCommand('cd src && npm run build -- --watch')).toBe('npm run build')
    expect(lines.shortCommand('NODE_ENV=test npx vitest run')).toBe('npx vitest run')
    expect(lines.shortCommand('git status')).toBe('git status')
    expect(lines.shortCommand('python3 scripts/gen.py')).toBe('python3')
  })

  test('言い回しのゆらぎは、もとの文を残したまま語尾か頭に足すだけで、お題や顔文字や壁にはさわらない', () => {
    let seed = 3
    const r = () => (seed = (seed * 48271) % 2147483647) / 2147483647
    for (let i = 0; i < 300; i++) {
      const d = lines.vary({ text: 'おつかれ' }, r)
      expect(isFrom(['おつかれ'])(d.text)).toBe(true)
      for (const text of ['【お題】ログイン', '$ npm test', '(・∀・)', 'ｗｗｗｗｗｗｗ', 'わかる？', 'テスト落ちてて草']) {
        expect(lines.vary({ text }, r).text).toBe(text)
      }
      expect(lines.vary({ text: 'わこつ', pos: 'ue' }, r).text).toBe('わこつ')
    }
  })

  test('裏の作業が1つだけのときは「並列」のような言い方をしない', () => {
    let seed = 1
    const r = () => (seed = (seed * 48271) % 2147483647) / 2147483647
    const parallel = filled(BG_PARALLEL_LINES, { n: '1' })
    for (let i = 0; i < 500; i++) {
      for (const d of reactToBackgroundStart(1, r)) expect(parallel).not.toContain(d.text)
      const [d] = ambient(r, { elapsedMs: 0, tools: 0, isErrorRecent: false, isBusy: false, isBackground: true, backgroundTasks: 1 })
      expect(parallel).not.toContain(d!.text)
    }
  })

  test('ツールの種類ごとのネタ帳は toolGroup の名前で引け、成功したツールにはほめ言葉がある', () => {
    const tools = ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'WebFetch', 'Agent', 'TodoWrite', 'AskUserQuestion', 'ExitPlanMode', 'Skill', 'Workflow', 'Monitor', 'mcp__x__y', 'Zzz']
    const groups = new Set(tools.map(lines.toolGroup))
    const tables = [
      ['TOOL_LINES', lines.TOOL_LINES],
      ['TOOL_OK_LINES', lines.TOOL_OK_LINES],
      ['COMBO_BY_GROUP', COMBO_BY_GROUP],
    ] as const
    for (const [name, table] of tables) {
      for (const key of Object.keys(table)) expect([name, key, groups.has(key)]).toEqual([name, key, true])
    }
    const ok = lines.reactToToolOk('Read', { file_path: '/a/b.ts' }, () => 0)
    expect(ok).toHaveLength(1)
    expect(isFrom(lines.TOOL_OK_LINES.Read ?? [], { file: 'b.ts' })(ok[0]!.text)).toBe(true)
  })
})

describe('band', () => {
  test('何も流れていないときは帯を出さない', async ($, on) => {
    world(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...band(false), surface })
      expect(await ui.find({ type: 'Client' })).toBeUndefined()
      expect(await ui.find({ key: 'engine' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('作業中は帯を出し、ほかの mod が描いたものも残す', async ($, on) => {
    world(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...band(true), surface })
      expect(await ui.find({ type: 'Client' })).toBeDefined()
      expect(await ui.find({ key: 'engine' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('設定の行数と速さが帯に効く', { options: { lanes: 2, speed: 'fast' } }, async ($, on) => {
    world(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...band(true), surface })
      const client = await ui.find({ type: 'Client' })
      expect(client?.props.height).toBe(2)
      expect((client?.props.props as ScreenProps).durationMs).toBe(3500)
      await ui.unmount()
    }
  })

  test('/danmaku demo の弾幕が右から左へ流れる', async ($, on) => {
    world(on)
    const done = await $.command.run({
      command: 'danmaku',
      args: 'demo',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 80 },
    })
    expect(done.text).toBeUndefined()
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...band(false), surface })
      await ui.resize({ columns: 60, rows: 3 })
      await ui.advance(1000)
      const before = rowsOf(await ui.drawn({ in: 'screen' }), 60)
      expect(before).toHaveLength(3)
      const row = before.find(r => r.includes('わこつ'))
      expect(row).toBeDefined()
      expect(before.join('')).toContain('弾幕テスト')
      const x1 = colOf(row!, 'わこつ')
      await ui.advance(500)
      const after = rowsOf(await ui.drawn({ in: 'screen' }), 60)
      const x2 = colOf(after.find(r => r.includes('わこつ')) ?? '', 'わこつ')
      expect(x2).toBeLessThan(x1)
      expect(x2).toBeGreaterThanOrEqual(0)
      for (const r of after) expect(textWidth(r)).toBeLessThanOrEqual(60)
      await ui.unmount()
    }
  })

  test('Desktop で流れるコメントが固定コメントの下をくぐるときは、穴の左右の窓で切り、位置は動かさない', async ($, on) => {
    world(on)
    const run = (args: string) =>
      $.command.run({ command: 'danmaku', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
    await run('わこつわこつわこつ')
    const ui = await $.ui.mount({ ...band(false), surface: 'desktop' })
    await ui.resize({ columns: 60, rows: 3 })
    await ui.advance(1000)
    await run('ue 神回')
    await ui.advance(1504)
    const kids = ((await ui.drawn({ in: 'screen' })) as Node).children as Node[]
    const fixed = kids.find(k => textOf(k) === '神回')
    expect(fixed?.props?.top).toBe(0)
    // 幅 18 のコメントが x ≒ 21 にあり、神回の穴 [28, 32) にかかっている
    const windows = kids.filter(k => textOf(k) === 'わこつわこつわこつ')
    expect(windows.map(k => [k.props?.top, k.props?.overflow, k.props?.marginLeft, k.props?.width])).toEqual([
      [0, 'hidden', 0, 28],
      [0, 'hidden', 32, 29],
    ])
    // テスト中も実時間を読むので、引っかかったときに1コマ（最大 100ms ≒ 1.6セル）余分に進むことがある
    const [left, right] = windows.map(xOf)
    expect(left!).toBeGreaterThan(19)
    expect(left!).toBeLessThan(23)
    expect(Math.abs(left! - right!)).toBeLessThan(1e-9)
    await ui.unmount()
  })

  test('Desktop では空白で位置を作らず、固定コメントは中央寄せ・流れるコメントは1セル未満ずつ動かす', async ($, on) => {
    world(on)
    await $.command.run({ command: 'danmaku', args: 'demo', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
    const ui = await $.ui.mount({ ...band(false), surface: 'desktop' })
    await ui.resize({ columns: 60, rows: 3 })
    await ui.advance(1000)
    const tree = (await ui.drawn({ in: 'screen' })) as Node
    // 同じコメントを 16ms ずつ進めたモデルと、同じ行・ほぼ同じ位置に置かれている
    const props = (await ui.find({ type: 'Client' }))?.props.props as ScreenProps
    let m = ingest(emptyModel({ cols: 60, lanes: 3, durationMs: props.durationMs, fixedMs: props.fixedMs }), props.comments)
    for (let t = 16; t <= 1000; t += 16) m = advance(m, 16)
    const want = framePieces(m)
      .flatMap((row, lane) => row.map(p => ({ ...p, lane })))
      .find(p => p.text === 'わこつ')!
    const kids = (tree.children ?? []) as Node[]
    expect(kids.length).toBeGreaterThan(0)
    for (const k of kids) {
      expect(k.props?.position).toBe('absolute')
      expect(Number.isInteger(k.props?.top)).toBe(true)
      expect(textOf(k).startsWith(' ')).toBe(false)
    }
    const fixed = kids.find(k => textOf(k) === '弾幕テスト')
    expect(fixed?.props).toMatchObject({ left: 0, right: 0, justifyContent: 'center' })
    // 固定コメントは流れるコメントより後に置き、上に重ねる
    const firstFixed = kids.findIndex(k => k.props?.justifyContent === 'center')
    expect(kids.slice(firstFixed).every(k => k.props?.justifyContent === 'center')).toBe(true)
    const wakotsu = (tree: unknown) => ((tree as Node).children as Node[]).find(k => textOf(k) === 'わこつ')!
    expect(wakotsu(tree).props?.top).toBe(want.lane)
    expect(Math.abs(xOf(wakotsu(tree)) - want.x)).toBeLessThan(2)
    const x1 = xOf(wakotsu(tree))
    await ui.advance(32)
    const step = x1 - xOf(wakotsu(await ui.drawn({ in: 'screen' })))
    expect(step).toBeGreaterThan(0.1)
    expect(step).toBeLessThan(1)
    // 左端から幅の分（6セル）出ても、セルより太い文字が見えているかもしれないので、幅の2倍出るまで描く
    await ui.advance(4168)
    expect(xOf(wakotsu(await ui.drawn({ in: 'screen' })))).toBeLessThan(-6)
    await ui.unmount()
  })
})

describe('events', () => {
  test('テストが落ちると草が生え、ツールの結果はそのまま返る', { options: { density: 'high' } }, async ($, on) => {
    world(on)
    on('tool.call', () => ({ isError: true as const, result: 'FAIL', text: 'FAIL' }))
    const ran = await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(ran).toMatchObject({ isError: true, text: 'FAIL' })
    const value = await onAir($)
    const said = value.map(c => c.text)
    const special = BASH_SPECIAL.find(s => s.re.test('npm test'))!
    expect(said.some(isFrom(special.start))).toBe(true)
    expect(said.some(t => texts(special.ng!).includes(t))).toBe(true)
  })

  test('/danmaku off で止まり、on で戻る', async ($, on) => {
    world(on)
    on('tool.call', () => ({ isError: true as const, result: 'x', text: 'x' }))
    const off = await $.command.run({ command: 'danmaku', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
    expect(off.text).toContain('オフ')
    await $.tool.call({ tool: 'Bash', command: 'false' })
    expect(await onAir($)).toHaveLength(0)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...band(true), surface })
      expect(await ui.find({ type: 'Client' })).toBeUndefined()
      await ui.unmount()
    }
    await $.command.run({ command: 'danmaku', args: 'on', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
    const value = await onAir($)
    expect(value.map(c => c.text)).toContain('弾幕復活')
  })

  test('自分のコメントをコマンド付きで流せる', async ($, on) => {
    world(on)
    await $.command.run({ command: 'danmaku', args: 'red ue 神回', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
    const value = await onAir($)
    expect(value).toHaveLength(1)
    expect(value[0]).toMatchObject({ text: '神回', color: COLORS.red, pos: 'ue' })
  })

  test('プロンプトを送るとお題と挨拶が流れる', async ($, on) => {
    world(on)
    on('prompt.submit', (_$, e) => ({ text: e.text }))
    await $.prompt.submit({ text: 'ログインのバグを直して', origin: { kind: 'composer' }, wait: false })
    const value = await onAir($)
    const said = value.map(c => c.text)
    expect(said).toContain('【お題】ログインのバグを直して')
    const topics = PROMPT_TOPICS.filter(t => t.re.test('ログインのバグを直して'))
    expect(topics.some(t => texts(t.lines).includes('バグ回きた'))).toBe(true)
    expect(said.some(t => topics.some(topic => texts(topic.lines).includes(t)))).toBe(true)
  })

  test('ターンが終わるとおつが流れる。サブエージェントのターンでは流さない', async ($, on) => {
    world(on)
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    await $.turn.complete({ answer: 'done', durationMs: 20_000, isAborted: false, turnId: 'sub', reason: 'answer', agentId: 'a1' })
    expect(await onAir($)).toHaveLength(0)
    await $.turn.complete({ answer: 'done', durationMs: 20_000, isAborted: false, turnId: 't1', reason: 'answer' })
    const value = await onAir($)
    expect(value.some(c => isFrom(OTSU_LINES)(c.text))).toBe(true)
  })

  test('AI視聴者をオンにすると、回答に反応したコメントが流れる', { options: { aiViewers: true } }, async ($, on) => {
    const clock = world(on)
    const usage = { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    on('model.complete', () => ({ value: { isAnswered: true as const, text: '1. ログイン直ってて草\n- 有能', usage } }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    await $.turn.complete({ answer: 'ログインのバグを直しました', durationMs: 20_000, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.advance(50)
    await clock.settle()
    const value = await onAir($)
    const said = value.map(c => c.text)
    expect(said).toContain('ログイン直ってて草')
    expect(said).toContain('有能')
  })
  // 画面を流れているコメント（横切る 5 秒の 8 割より新しいもの）が density ごとの数を下回ったら、
  // 前のコメントから 4 秒 / その数（の 0.75〜1.25 倍）空けて、次の見回り（250ms ごと）でつぶやく
  for (const [density, floor, minGap] of [
    ['low', 1, 3000],
    ['normal', 3, 1000],
    ['high', 5, 750],
  ] as const) {
    test(`作業中は静かでも弾幕が途切れず、density ${density} では ${floor} 件ほど流れ続ける`, { options: { density }, timeoutMs: 30_000 }, async ($, on) => {
      const clock = world(on)
      on('turn.start', (_$, e) => ({ turnId: e.turnId }))
      await $.turn.start({ text: '調べて', turnId: 't1' })
      const ats = new Set<number>()
      // 盛り上がり（40秒より後）が入らないところまで見る
      for (let t = 1000; t <= 38_000; t += 1000) {
        await clock.advance(1000)
        const now = clock.now()
        const live = await onAir($)
        for (const c of live) ats.add(c.at)
        if (t >= 6000) {
          const flowing = live.filter(c => c.pos === 'naka' && now - c.at < 5000).length
          expect([density, t, flowing >= Math.max(1, floor - 1)]).toEqual([density, t, true])
        }
      }
      const sorted = [...ats].sort((a, b) => a - b)
      for (let k = 1; k < sorted.length; k++) {
        expect(sorted[k]! - sorted[k - 1]!).toBeGreaterThanOrEqual(minGap)
        expect(sorted[k]! - sorted[k - 1]!).toBeLessThanOrEqual(5000)
      }
    })
  }

  test('作業中はときどき盛り上がって、何件かまとめて流れる', { timeoutMs: 30_000 }, async ($, on) => {
    const clock = world(on)
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    await $.turn.start({ text: '調べて', turnId: 't1' })
    const waves = texts(WAVE_LINES)
    const byAt = new Map<number, Set<string>>()
    for (let t = 0; t < 85_000; t += 1000) {
      await clock.advance(1000)
      for (const c of await onAir($)) {
        if (!waves.includes(c.text)) continue
        byAt.set(c.at, new Set([...(byAt.get(c.at) ?? []), c.text]))
      }
    }
    expect([...byAt.values()].some(set => set.size >= 3)).toBe(true)
  })

  test('作業が1分を超えると経過時間を言い、ターンが終わるとつぶやきは止まる', async ($, on) => {
    const clock = world(on)
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    await $.turn.start({ text: '調べて', turnId: 't1' })
    await clock.advance(60_500)
    const said = (await onAir($)).map(c => c.text)
    expect(said.some(t => filled(ELAPSED_LINES, { min: '1' }).includes(t))).toBe(true)
    await $.turn.complete({ answer: 'done', durationMs: 60_500, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.advance(20_000)
    expect(await onAir($)).toHaveLength(0)
  })

  test('同じツールが続くと連発に、ツールの回数が節目に来るとコンボに反応する', { options: { density: 'high' } }, async ($, on) => {
    const clock = world(on)
    on('tool.call', () => ({ result: 'ok', text: 'ok' }))
    const said: string[] = []
    for (let i = 1; i <= 10; i++) {
      await $.tool.call({ tool: 'Read', file_path: `/src/file${i}.ts` })
      if (i === 3 || i === 10) said.push(...(await onAir($)).map(c => c.text))
      await clock.advance(1000)
    }
    const combos = [...filled(COMBO_LINES, { n: '3', tool: 'Read' }), ...filled(COMBO_BY_GROUP.Read ?? [], { n: '3', tool: 'Read' })]
    expect(said.some(t => combos.includes(t))).toBe(true)
    expect(said.some(t => filled(MILESTONE_LINES, { n: '10' }).includes(t))).toBe(true)
  })

  test('続けて失敗すると、連続エラーに反応する', async ($, on) => {
    world(on)
    on('tool.call', () => ({ isError: true as const, result: 'x', text: 'x' }))
    await $.tool.call({ tool: 'Read', file_path: '/a/missing.ts' })
    await $.tool.call({ tool: 'Read', file_path: '/a/missing2.ts' })
    const said = (await onAir($)).map(c => c.text)
    expect(said.some(t => filled(ERROR_STREAK_LINES, { n: '2' }).includes(t))).toBe(true)
  })

  test('/danmaku demo は何回かに分けて全部流れる', async ($, on) => {
    const clock = world(on)
    await runCommand($, 'demo')
    const seen = new Set((await onAir($)).map(c => c.text))
    expect(seen.size).toBeLessThan(DEMO.length)
    for (let t = 0; t < DEMO.length * 300; t += 500) {
      await clock.advance(500)
      for (const c of await onAir($)) seen.add(c.text)
    }
    expect([...seen].sort()).toEqual(texts(DEMO).sort())
  })
  test('スリープ明けで経過時間の節目をいくつも飛ばしたら、いちばん新しいものだけ1回言う', async ($, on) => {
    const clock = sleepyClock(on)
    mock.store(on)
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    await $.turn.start({ text: '調べて', turnId: 't1' })
    clock.jump(6 * 60_000)
    await clock.tick()
    await clock.tick()
    await clock.tick()
    const said = (await onAir($)).map(c => c.text)
    expect(said.filter(t => filled(ELAPSED_LINES, { min: '5' }).includes(t))).toHaveLength(1)
    for (const min of ['1', '3']) expect(said.some(t => filled(ELAPSED_LINES, { min }).includes(t))).toBe(false)
  })

  test('サブエージェントのツール呼び出しは、連発・節目・ターンのツール数に数えない', { options: { density: 'high' } }, async ($, on) => {
    const clock = world(on)
    on('tool.call', () => ({ result: 'ok', text: 'ok' }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    const fresh = freshOnAir($)
    const said: string[] = []
    for (let i = 1; i <= 15; i++) {
      await $.tool.call({ tool: 'Read', file_path: `/src/file${i}.ts`, agentId: 'a1' })
      said.push(...(await fresh()))
      await clock.advance(2000)
    }
    expect(said.filter(t => ALL_COMBOS.includes(t) || ALL_MILESTONES.includes(t))).toEqual([])
    await $.turn.complete({ answer: 'done', durationMs: 20_000, isAborted: false, turnId: 't1', reason: 'answer' })
    const end = await fresh()
    expect(end.some(t => texts(NO_TOOLS_LINES).includes(t))).toBe(true)
    expect(end.some(t => texts(lines.MANY_TOOLS_LINES).includes(t))).toBe(false)
  })

  test('新しいターンでは、連発・ツール数・連続エラーを数え直す', { options: { density: 'high' } }, async ($, on) => {
    const clock = world(on)
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('tool.call', (_$, e) =>
      String((e as { file_path?: unknown }).file_path).includes('ng')
        ? { isError: true as const, result: 'x', text: 'x' }
        : { result: 'ok', text: 'ok' },
    )
    const fresh = freshOnAir($)
    await $.turn.start({ text: '調べて', turnId: 't1' })
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'ng1']) await $.tool.call({ tool: 'Read', file_path: `/src/${name}.ts` })
    await $.turn.complete({ answer: 'done', durationMs: 20_000, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.advance(10_000)
    await fresh()
    // 数え直していなければ、2ターン目の1回目で8連発・2連続エラー、3回目で10回の節目になる
    await $.turn.start({ text: '続けて', turnId: 't2' })
    await $.tool.call({ tool: 'Read', file_path: '/src/ng2.ts' })
    expect((await fresh()).filter(t => ALL_COMBOS.includes(t) || ALL_STREAKS.includes(t))).toEqual([])
    await $.tool.call({ tool: 'Read', file_path: '/src/g.ts' })
    await $.tool.call({ tool: 'Read', file_path: '/src/h.ts' })
    const third = await fresh()
    const combo3 = [...filled(COMBO_LINES, { n: '3', tool: 'Read' }), ...filled(COMBO_BY_GROUP.Read ?? [], { n: '3', tool: 'Read' })]
    expect(third.some(t => combo3.includes(t))).toBe(true)
    expect(third.filter(t => ALL_MILESTONES.includes(t))).toEqual([])
  })

  test('連続エラーは成功で途切れ、拒否では途切れない', async ($, on) => {
    const clock = world(on)
    on('tool.call', (_$, e) => {
      const path = String((e as { file_path?: unknown }).file_path)
      if (path.includes('deny')) return { deny: 'no' }
      if (path.includes('ng')) return { isError: true as const, result: 'x', text: 'x' }
      return { result: 'ok', text: 'ok' }
    })
    const fresh = freshOnAir($)
    const call = async (name: string) => {
      await $.tool.call({ tool: 'Read', file_path: `/a/${name}.ts` })
      const out = await fresh()
      await clock.advance(2000)
      return out
    }
    await call('ng1')
    await call('ok')
    expect((await call('ng2')).filter(t => ALL_STREAKS.includes(t))).toEqual([])
    await call('deny')
    expect((await call('ng3')).some(t => filled(ERROR_STREAK_LINES, { n: '2' }).includes(t))).toBe(true)
  })

  test('長くて苦戦したターンのあとでも、AI視聴者のコメントは流量の上限で落ちない', { options: { aiViewers: true } }, async ($, on) => {
    const clock = world(on)
    const usage = { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    on('model.complete', () => ({ value: { isAnswered: true as const, text: 'ログイン直ってて草\nAI視聴者その2', usage } }))
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('tool.call', (_$, e) =>
      String((e as { file_path?: unknown }).file_path).includes('ng')
        ? { isError: true as const, result: 'x', text: 'x' }
        : { result: 'ok', text: 'ok' },
    )
    await $.turn.start({ text: '直して', turnId: 't1' })
    for (let i = 0; i < 15; i++) await $.tool.call({ tool: 'Read', file_path: i % 5 === 0 ? `/src/ng${i}.ts` : `/src/f${i}.ts` })
    await clock.advance(5000)
    // 4分・ツール15回・エラー3回: 長丁場 + 働きすぎ + 苦戦 + おつ4 (+ ときどき上のバナー) = 7〜8件
    await $.turn.complete({ answer: 'ログインのバグを直しました', durationMs: 4 * 60_000, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.advance(1500)
    const said = (await onAir($)).map(c => c.text)
    expect(said).toContain('ログイン直ってて草')
    expect(said).toContain('AI視聴者その2')
    expect(said.some(t => texts(lines.LONG_TURN_LINES).includes(t))).toBe(true)
    expect(said.some(t => texts(TOUGH_TURN_LINES).includes(t))).toBe(true)
  })
  test('ターンが終わっても裏の作業が続いている間はつぶやき続け、終わった知らせで止まる', async ($, on) => {
    const clock = world(on)
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('prompt.submit', (_$, e) => ({ text: e.text }))
    const fresh = freshOnAir($)
    await $.turn.start({ text: 'ビルドして', turnId: 't1' })
    await $.turn.complete({ answer: '裏でビルドしています', durationMs: 20_000, isAborted: false, turnId: 't1', reason: 'answer' })
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [bgTask('b1', 'shell', 'npm run build')] })
    await clock.advance(3000)
    await fresh()
    const said: string[] = []
    for (let t = 0; t < 30_000; t += 1000) {
      await clock.advance(1000)
      said.push(...(await fresh()))
    }
    // 静かになっても、裏の作業を待つ間は流れ続ける
    expect(said.length).toBeGreaterThan(10)
    expect(said.some(t => isBgText(t))).toBe(true)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...band(false), surface })
      expect(await ui.find({ type: 'Client' })).toBeDefined()
      await ui.unmount()
    }
    await $.prompt.submit({ text: notice('b1', 'completed'), origin: { kind: 'task-notification' }, wait: false })
    expect((await fresh()).some(t => texts(BG_DONE_LINES).includes(t))).toBe(true)
    await clock.advance(20_000)
    expect(await onAir($)).toHaveLength(0)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...band(false), surface })
      expect(await ui.find({ type: 'Client' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('裏の作業が失敗した知らせにも反応する', async ($, on) => {
    world(on)
    on('prompt.submit', (_$, e) => ({ text: e.text }))
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [bgTask('b2', 'shell', 'npm test')] })
    await $.prompt.submit({ text: notice('b2', 'failed'), origin: { kind: 'task-notification' }, wait: false })
    expect((await onAir($)).some(c => texts(BG_FAIL_LINES).includes(c.text))).toBe(true)
  })

  test('開発サーバーのような終わらない裏方は、待たない', async ($, on) => {
    const clock = world(on)
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    await $.turn.start({ text: 'サーバー立てて', turnId: 't1' })
    await $.turn.complete({ answer: '起動しました', durationMs: 20_000, isAborted: false, turnId: 't1', reason: 'answer' })
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [bgTask('s1', 'shell', 'npm run dev'), bgTask('s2', 'shell', 'tail -f app.log')] })
    await clock.advance(15_000)
    expect(await onAir($)).toHaveLength(0)
  })

  test('裏のサブエージェントが終わったら、一覧を見て気づいて止まる', async ($, on) => {
    const clock = world(on)
    let status = 'running'
    on('agent.list', () => ({ value: [{ id: 'a1', description: '調査', type: 'Explore', status }] }))
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    await $.turn.start({ text: '調べて', turnId: 't1' })
    await $.turn.complete({ answer: '調べています', durationMs: 20_000, isAborted: false, turnId: 't1', reason: 'answer' })
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [bgTask('a1', 'subagent')] })
    await clock.advance(20_000)
    expect((await onAir($)).length).toBeGreaterThan(0)
    status = 'completed'
    await clock.advance(6000)
    await clock.advance(10_000)
    expect(await onAir($)).toHaveLength(0)
  })

  test('ターンの終わりにワークフローが動いていれば、終わった知らせまでつぶやく', async ($, on) => {
    const clock = world(on)
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('prompt.submit', (_$, e) => ({ text: e.text }))
    on('tool.call', () => ({ result: 'ok', text: 'ok' }))
    await $.turn.start({ text: '調べて', turnId: 't1' })
    await $.turn.complete({ answer: '調べています', durationMs: 20_000, isAborted: false, turnId: 't1', reason: 'answer' })
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [bgTask('w1', 'workflow')] })
    await $.tool.call({ tool: 'Read', file_path: '/src/a.ts', agentId: 'wf-agent' })
    await clock.advance(20_000)
    expect((await onAir($)).length).toBeGreaterThan(0)
    await $.prompt.submit({ text: notice('w1', 'completed'), origin: { kind: 'task-notification' }, wait: false })
    await clock.advance(30_000)
    expect(await onAir($)).toHaveLength(0)
  })

  test('裏に回すと反応し、テストが通ると盛り上がる', async ($, on) => {
    const clock = world(on)
    on('tool.call', () => ({ result: 'ok', text: 'ok' }))
    await $.tool.call({ tool: 'Bash', command: 'npm run build', run_in_background: true })
    expect((await onAir($)).some(c => texts(BG_LAUNCH_LINES).includes(c.text))).toBe(true)
    await clock.advance(2500)
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect((await onAir($)).filter(c => texts(WAVE_LINES).includes(c.text)).length).toBeGreaterThanOrEqual(2)
  })

  test('裏に回したテストや、出力に失敗があるテストでは盛り上がらない', async ($, on) => {
    const clock = world(on)
    on('tool.call', (_$, e) =>
      String((e as { command?: unknown }).command).includes('tail')
        ? { result: 'Tests  2 failed | 10 passed', text: 'Tests  2 failed | 10 passed' }
        : { result: 'Command running in background', text: 'Command running in background' },
    )
    const special = BASH_SPECIAL.find(s => s.re.test('npm test'))!
    const waves = texts(WAVE_LINES).filter(t => !texts(special.ok ?? []).includes(t))
    const fresh = freshOnAir($)
    await $.tool.call({ tool: 'Bash', command: 'npm test', run_in_background: true })
    const launched = await fresh()
    expect(launched.filter(t => waves.includes(t) || texts(special.ok ?? []).includes(t))).toEqual([])
    await clock.advance(2500)
    await $.tool.call({ tool: 'Bash', command: 'npx vitest run 2>&1 | tail -40' })
    const piped = await fresh()
    expect(piped.filter(t => waves.includes(t))).toEqual([])
    expect(piped.some(t => texts(special.ng ?? []).includes(t))).toBe(true)
  })
  test('しばらくは同じコメントを繰り返さない', { timeoutMs: 60_000 }, async ($, on) => {
    const clock = world(on)
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('prompt.submit', (_$, e) => ({ text: e.text }))
    await $.prompt.submit({ text: 'ログインのバグを直して', origin: { kind: 'composer' }, wait: false })
    await $.turn.start({ text: 'ログインのバグを直して', turnId: 't1' })
    const fresh = freshOnAir($)
    const said: string[] = []
    for (let t = 0; t < 10 * 60_000; t += 1000) {
      await clock.advance(1000)
      said.push(...(await fresh()))
    }
    expect(said.length).toBeGreaterThan(300)
    // 直前の 60 件と同じコメントは、ほとんど出ない
    const repeats = said.filter((t, i) => said.slice(Math.max(0, i - 60), i).includes(t)).length
    expect(repeats / said.length).toBeLessThan(0.05)
    expect(new Set(said).size / said.length).toBeGreaterThan(0.6)
  })

  test('お題の言葉やさわっているファイルにも触れる', { timeoutMs: 30_000 }, async ($, on) => {
    const clock = world(on)
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('prompt.submit', (_$, e) => ({ text: e.text }))
    on('tool.call', () => ({ result: 'ok', text: 'ok' }))
    await $.prompt.submit({ text: 'ログインのバグを直して', origin: { kind: 'composer' }, wait: false })
    await $.turn.start({ text: 'ログインのバグを直して', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/src/auth/session.ts' })
    const fresh = freshOnAir($)
    const said: string[] = []
    for (let t = 0; t < 90_000; t += 1000) {
      await clock.advance(1000)
      said.push(...(await fresh()))
    }
    const about = said.filter(t => !t.startsWith('【') && (t.includes('ログイン') || t.includes('バグ') || t.includes('session.ts')))
    expect(about.length).toBeGreaterThan(2)
  })

  test('AI実況をオンにすると、作業中にいまの様子へのコメントが混ざる。間隔はあける', { options: { aiChatter: true }, timeoutMs: 30_000 }, async ($, on) => {
    const clock = world(on)
    let calls = 0
    let prompt = ''
    const usage = { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    on('model.complete', (_$, e) => {
      calls += 1
      prompt = String((e as { prompt?: unknown }).prompt)
      return { value: { isAnswered: true as const, text: `session.ts読んでる${calls}\nログインまだ？${calls}\n3. 直りそう${calls}`, usage } }
    })
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('prompt.submit', (_$, e) => ({ text: e.text }))
    on('tool.call', () => ({ result: 'ok', text: 'ok' }))
    await $.prompt.submit({ text: 'ログインのバグを直して', origin: { kind: 'composer' }, wait: false })
    await $.turn.start({ text: 'ログインのバグを直して', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/src/auth/session.ts' })
    const fresh = freshOnAir($)
    const said: string[] = []
    for (let t = 0; t < 200_000; t += 1000) {
      await clock.advance(1000)
      said.push(...(await fresh()))
      if (t === 100_000) await $.tool.call({ tool: 'Bash', command: 'npm test' })
    }
    expect(prompt).toContain('session.ts')
    expect(prompt).toContain('ログインのバグを直して')
    expect(said.some(t => t.startsWith('session.ts読んでる'))).toBe(true)
    expect(said).toContain('直りそう1')
    // 90 秒おき、新しい動きがあったときだけ
    expect(calls).toBeGreaterThanOrEqual(2)
    expect(calls).toBeLessThanOrEqual(3)
  })

  test('AI実況がオフなら、作業中に AI を呼ばない', { timeoutMs: 30_000 }, async ($, on) => {
    const clock = world(on)
    let calls = 0
    on('model.complete', () => {
      calls += 1
      return { value: { isAnswered: false as const, reason: 'off' } }
    })
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    await $.turn.start({ text: '調べて', turnId: 't1' })
    await clock.advance(200_000)
    expect(calls).toBe(0)
  })
})

describe('background', () => {
  const endTurn = ($: Engine, turnId = 't1') =>
    $.turn.complete({ answer: 'x', durationMs: 20_000, isAborted: false, turnId, reason: 'answer' })
  const setup = (on: On) => {
    const clock = world(on)
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('prompt.submit', (_$, e) => ({ text: e.text }))
    on('tool.call', () => ({ result: 'ok', text: 'ok' }))
    return clock
  }

  test('Stop が turn.complete より先に来ても、裏の作業を待ってつぶやく', async ($, on) => {
    const clock = setup(on)
    const fresh = freshOnAir($)
    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [bgTask('b1', 'shell', 'npm run build')] })
    await endTurn($)
    await clock.advance(3000)
    expect((await fresh()).some(t => isBgText(t))).toBe(true)
    await clock.advance(20_000)
    expect((await onAir($)).length).toBeGreaterThan(0)
  })

  test('ターン中に届いた知らせと、空の Stop で止まる', async ($, on) => {
    const clock = setup(on)
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [bgTask('b1', 'shell', 'npm run build')] })
    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.prompt.submit({ text: notice('b1', 'completed'), origin: { kind: 'task-notification' }, wait: false })
    await clock.advance(5000)
    await endTurn($)
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
    await clock.advance(20_000)
    expect(await onAir($)).toHaveLength(0)
  })

  test('SubagentStop で裏のサブエージェントが外れたら止まる', async ($, on) => {
    const clock = setup(on)
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [bgTask('a1', 'subagent')] })
    await clock.advance(5000)
    expect((await onAir($)).length).toBeGreaterThan(0)
    await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'a1', agent_transcript_path: '/x', agent_type: 'Explore', background_tasks: [bgTask('a1', 'subagent')] })
    await clock.advance(15_000)
    expect(await onAir($)).toHaveLength(0)
  })

  test('動きのないまま 30 分たったら待つのをやめる', { timeoutMs: 60_000 }, async ($, on) => {
    const clock = setup(on)
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [bgTask('b1', 'shell', 'npm run build')] })
    await clock.advance(29 * 60_000)
    expect((await onAir($)).length).toBeGreaterThan(0)
    await clock.advance(2 * 60_000)
    expect(await onAir($)).toHaveLength(0)
  })

  test('オフのときは裏の作業を待っていても流さず、帯も出さない', async ($, on) => {
    const clock = setup(on)
    await runCommand($, 'off')
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [bgTask('b1', 'shell', 'npm run build')] })
    await clock.advance(10_000)
    expect(await onAir($)).toHaveLength(0)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...band(false), surface })
      expect(await ui.find({ type: 'Client' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('知らない id の知らせでは、ほかの作業を待ち続ける', async ($, on) => {
    const clock = setup(on)
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [bgTask('b1', 'shell', 'npm run build')] })
    await $.prompt.submit({ text: notice('zzz', 'completed'), origin: { kind: 'task-notification' }, wait: false })
    await clock.advance(20_000)
    expect((await onAir($)).length).toBeGreaterThan(0)
  })

  test('裏に何もないとき、エンジンの分身（メモリ）のツール呼び出しでは裏モードにならない', async ($, on) => {
    const clock = setup(on)
    await $.turn.start({ text: 'x', turnId: 't1' })
    await endTurn($)
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
    await $.tool.call({ tool: 'Write', file_path: '/home/u/.claude/memory/MEMORY.md', content: 'x', agentId: 'mem-fork' })
    await clock.advance(20_000)
    expect(await onAir($)).toHaveLength(0)
  })

  test('裏のサブエージェントが終わって知らせのターンも終われば、すぐ止まる', async ($, on) => {
    const clock = setup(on)
    await $.turn.start({ text: 'x', turnId: 't1' })
    await endTurn($)
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [bgTask('a1', 'subagent')] })
    await clock.advance(5000)
    await $.tool.call({ tool: 'Read', file_path: '/a.ts', agentId: 'a1' })
    await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'a1', agent_transcript_path: '/x', agent_type: 'Explore', background_tasks: [] })
    await $.prompt.submit({ text: notice('a1', 'completed'), origin: { kind: 'task-notification' }, wait: false })
    await $.turn.start({ text: 'n', turnId: 't2' })
    await clock.advance(3000)
    await endTurn($, 't2')
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
    await clock.advance(8000)
    const fresh = freshOnAir($)
    await fresh()
    await clock.advance(10_000)
    expect(await fresh()).toEqual([])
  })

  test('ワークフローが一覧にあれば、分身の動きで 30 分を延ばす', { timeoutMs: 60_000 }, async ($, on) => {
    const clock = setup(on)
    await $.turn.start({ text: 'x', turnId: 't1' })
    await endTurn($)
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [bgTask('w1', 'workflow')] })
    await clock.advance(25 * 60_000)
    await $.tool.call({ tool: 'Read', file_path: '/a.ts', agentId: 'wf-agent' })
    await clock.advance(10 * 60_000)
    expect((await onAir($)).length).toBeGreaterThan(0)
  })

  test('一覧に載り続けるだけの作業（拾えなかった開発サーバーなど）では、待つ時間を延ばさない', { timeoutMs: 60_000 }, async ($, on) => {
    const clock = setup(on)
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [bgTask('s1', 'shell', 'go run ./cmd/api')] })
    await clock.advance(31 * 60_000)
    expect(await onAir($)).toHaveLength(0)
    await $.turn.start({ text: 'x', turnId: 't2' })
    await endTurn($, 't2')
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [bgTask('s1', 'shell', 'go run ./cmd/api')] })
    await clock.advance(20_000)
    expect(await onAir($)).toHaveLength(0)
  })
})
