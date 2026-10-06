// 弾幕の配置と描画に使う純粋関数。
// 描画スレッドで動く screen.tsx と、テストの両方から読み込む（$ は使わない）。

import type { DanmakuComment, DanmakuPos } from '../types'

/** 端末で2セルを占める文字（東アジアの全角・ワイド文字と絵文字）の範囲 */
const WIDE: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0],
  [0x23f3, 0x23f3], [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f],
  [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5],
  [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5],
  [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728],
  [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f],
  [0xff00, 0xff60], [0xffe0, 0xffe6], [0x16fe0, 0x16fe4], [0x17000, 0x18cff], [0x1b000, 0x1b2ff],
  [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a],
  [0x1f200, 0x1f251], [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff], [0x1f900, 0x1f9ff],
  [0x1fa70, 0x1faff], [0x20000, 0x3fffd],
]

/** 幅0の文字（結合文字・ゼロ幅文字・異体字セレクタ） */
const ZERO: ReadonlyArray<readonly [number, number]> = [
  [0x0300, 0x036f], [0x1ab0, 0x1aff], [0x1dc0, 0x1dff], [0x200b, 0x200f], [0x2028, 0x202e],
  [0x2060, 0x206f], [0x20d0, 0x20ff], [0xfe00, 0xfe0f], [0xfe20, 0xfe2f], [0xfeff, 0xfeff],
  [0xe0000, 0xe0fff],
]

function inRanges(cp: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  let lo = 0
  let hi = ranges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const range = ranges[mid]!
    if (cp < range[0]) hi = mid - 1
    else if (cp > range[1]) lo = mid + 1
    else return true
  }
  return false
}

/** 1文字が端末で何セル使うか */
export function charWidth(cp: number): 0 | 1 | 2 {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0
  if (cp < 0x300) return 1
  if (inRanges(cp, ZERO)) return 0
  return inRanges(cp, WIDE) ? 2 : 1
}

/** 文字列が端末で何セル使うか */
export function textWidth(text: string): number {
  let width = 0
  for (const ch of text) width += charWidth(ch.codePointAt(0) ?? 0)
  return width
}

/** 制御文字・ゼロ幅文字を落とし、空白を1つにまとめる */
export function sanitize(text: string): string {
  let out = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d) out += ' '
    else if (charWidth(cp) > 0) out += ch
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** 幅 max セルに収まるように切り、はみ出したら … を付ける */
export function clipToWidth(text: string, max: number): string {
  if (textWidth(text) <= max) return text
  let out = ''
  let width = 0
  for (const ch of text) {
    const w = charWidth(ch.codePointAt(0) ?? 0)
    if (width + w > max - 1) break
    out += ch
    width += w
  }
  return out + '…'
}

// ---- 1行ぶんの合成 ----

/** 行に置く1コメント。x は左端からのセル位置（負なら左にはみ出している） */
export type Placed = { x: number; text: string; color: string | null; isBig: boolean }

/** 同じ見た目が続く区間。描画では Text 1つになる */
export type Seg = { text: string; color: string | null; isBig: boolean }

/**
 * コメントを幅 width の1行に重ねて置き、見た目ごとの区間に分ける。
 * 後に置いたものが上に来る。全角文字が端で切れるときや、上書きで半分だけ
 * 残るときは空白にして、行の幅が width からずれないようにする。
 */
export function composeRow(items: readonly Placed[], width: number): Seg[] {
  // glyph[i]: そのセルの文字。'' は直前の全角文字の右半分、' ' は空白
  const glyph: string[] = new Array<string>(width).fill(' ')
  // owner[i]: そのセルを描いたコメントの番号。-1 は空白
  const owner: number[] = new Array<number>(width).fill(-1)
  const blank = (i: number) => {
    glyph[i] = ' '
    owner[i] = -1
  }

  items.forEach((item, k) => {
    let p = Math.round(item.x)
    for (const ch of item.text) {
      if (p >= width) break
      const w = charWidth(ch.codePointAt(0) ?? 0)
      if (w === 0) continue
      const end = p + w
      if (end > 0) {
        const from = Math.max(0, p)
        const to = Math.min(width, end)
        for (let i = from; i < to; i++) {
          // 全角文字の右半分を上書きするなら、その左半分も消す
          if (glyph[i] === '' && i > 0) blank(i - 1)
          // 全角文字の左半分を上書きするなら、その右半分も消す
          if (i + 1 < width && glyph[i + 1] === '' && i === to - 1) blank(i + 1)
        }
        if (p < 0 || end > width) {
          // 端で切れる文字は描かない
          for (let i = from; i < to; i++) blank(i)
        } else {
          glyph[p] = ch
          owner[p] = k
          if (w === 2) {
            glyph[p + 1] = ''
            owner[p + 1] = k
          }
        }
      }
      p = end
    }
  })

  const segs: Seg[] = []
  for (let i = 0; i < width; i++) {
    const ch = glyph[i]!
    if (ch === '') continue
    const k = owner[i]!
    const item = k >= 0 ? items[k] : undefined
    const color = item?.color ?? null
    const isBig = item?.isBig ?? false
    const last = segs[segs.length - 1]
    if (last !== undefined && last.color === color && last.isBig === isBig) last.text += ch
    else segs.push({ text: ch, color, isBig })
  }
  // 行末の空白は描かなくてよい
  const tail = segs[segs.length - 1]
  if (tail !== undefined && tail.color === null && !tail.isBig) {
    tail.text = tail.text.replace(/ +$/, '')
    if (tail.text === '') segs.pop()
  }
  return segs
}

// ---- 弾幕の進行 ----

/** 同じ行で前のコメントとの間に空けるセル数 */
export const GAP = 2
/** 空きを待つ最長時間。過ぎても入れなければ、そのコメントは流さない（重ねると読めなくなるため） */
export const MAX_WAIT_MS = 4000
/** 1コメントの最大幅（セル） */
export const MAX_COMMENT_CELLS = 40
const MAX_WAITING = 40
const MAX_FLIGHTS = 80

/**
 * overhang は、流れるコメントを左端の外へ幅の何倍ぶん出るまで残すか（既定 0）。
 * Desktop は文字をプロポーショナルフォントで描き、半角の W などはセルより太いので、見えているうちに消さない
 */
export type ScreenConfig = { cols: number; lanes: number; durationMs: number; fixedMs: number; overhang?: number }

/** 画面に出ているコメント。born は描画スレッド側の時刻（ミリ秒） */
export type Flight = {
  id: number
  text: string
  color: string | null
  isBig: boolean
  pos: DanmakuPos
  w: number
  lane: number
  born: number
}

/** 空きを待っているコメント */
export type Waiting = Omit<Flight, 'lane' | 'born'> & { since: number }

/** Client が持つ状態 */
export type ScreenModel = {
  t: number
  seen: number
  flights: Flight[]
  waiting: Waiting[]
  cfg: ScreenConfig
}

export function emptyModel(cfg: ScreenConfig): ScreenModel {
  return { t: 0, seen: 0, flights: [], waiting: [], cfg }
}

export function sameConfig(a: ScreenConfig, b: ScreenConfig): boolean {
  return (
    a.cols === b.cols &&
    a.lanes === b.lanes &&
    a.durationMs === b.durationMs &&
    a.fixedMs === b.fixedMs &&
    (a.overhang ?? 0) === (b.overhang ?? 0)
  )
}

export function isIdle(model: ScreenModel): boolean {
  return model.flights.length === 0 && model.waiting.length === 0
}

/** 流れるコメントの左端の位置。右端 cols から始まり、durationMs で -w まで進む */
export function flowX(f: Pick<Flight, 'born' | 'w'>, t: number, cfg: ScreenConfig): number {
  return cfg.cols - ((cfg.cols + f.w) * (t - f.born)) / cfg.durationMs
}

function isAlive(f: Flight, t: number, cfg: ScreenConfig): boolean {
  if (f.pos !== 'naka') return t - f.born < cfg.fixedMs
  // flowX が -w * (1 + overhang) になるまで
  const overhang = cfg.overhang ?? 0
  return t - f.born < (cfg.durationMs * (cfg.cols + f.w * (1 + overhang))) / (cfg.cols + f.w)
}

/**
 * 幅 w の新しいコメントを今この行に流して、ほかのコメントにぶつからないか。
 *
 * 流れるコメントとは: 前のコメントが右端から出きっていて、かつ前のコメントが
 * 左端に消えるまでに追いつかなければよい（どちらも等速なので両端の時刻だけ見れば足りる）。
 * 固定コメント（ue / shita）とは: その位置に届く前に固定コメントが消えればよい。
 */
export function fitsFlow(lane: readonly Flight[], w: number, t: number, cfg: ScreenConfig): boolean {
  const { cols, durationMs } = cfg
  for (const f of lane) {
    const age = t - f.born
    if (f.pos === 'naka') {
      if (age >= durationMs) continue
      const tail = flowX(f, t, cfg) + f.w
      if (tail + GAP > cols) return false
      const remaining = durationMs - age
      const head = cols - ((cols + w) * remaining) / durationMs
      if (head < GAP) return false
    } else {
      const expiresAt = f.born + cfg.fixedMs
      if (expiresAt <= t) continue
      const right = Math.floor((cols - f.w) / 2) + f.w + GAP
      const reachAt = t + ((cols - right) * durationMs) / (cols + w)
      if (reachAt < expiresAt) return false
    }
  }
  return true
}

function flowLane(flights: readonly Flight[], w: number, t: number, cfg: ScreenConfig): number | undefined {
  for (let lane = 0; lane < cfg.lanes; lane++) {
    if (fitsFlow(flights.filter(f => f.lane === lane), w, t, cfg)) return lane
  }
  return undefined
}

function fixedLane(flights: readonly Flight[], pos: DanmakuPos, t: number, cfg: ScreenConfig): number {
  const order = Array.from({ length: cfg.lanes }, (_, i) => (pos === 'shita' ? cfg.lanes - 1 - i : i))
  const fixed = flights.filter(f => f.pos !== 'naka' && isAlive(f, t, cfg))
  for (const lane of order) {
    if (!fixed.some(f => f.lane === lane)) return lane
  }
  // 全部埋まっていたら、いちばん古い固定コメントと入れ替える
  const oldest = fixed.reduce((a, b) => (b.born < a.born ? b : a))
  return oldest.lane
}

/** 待ち行列のコメントを、空いている行に出す。待ちすぎたものは捨てる */
export function spawn(model: ScreenModel): ScreenModel {
  if (model.waiting.length === 0) return model
  const { t, cfg } = model
  let flights = model.flights
  const waiting: Waiting[] = []
  // 固定コメントは待たずに出るので先に置き、流れるコメントがそれを避けられるようにする
  const queue = [...model.waiting.filter(w => w.pos !== 'naka'), ...model.waiting.filter(w => w.pos === 'naka')]
  for (const item of queue) {
    const lane = item.pos === 'naka' ? flowLane(flights, item.w, t, cfg) : fixedLane(flights, item.pos, t, cfg)
    if (lane === undefined) {
      if (t - item.since < MAX_WAIT_MS) waiting.push(item)
      continue
    }
    if (item.pos !== 'naka') flights = flights.filter(f => f.pos === 'naka' || f.lane !== lane)
    const { since: _since, ...rest } = item
    flights = [...flights, { ...rest, lane, born: t }]
  }
  return { ...model, flights: flights.slice(-MAX_FLIGHTS), waiting }
}

/** 届いたコメントのうち未処理のもの（id が seen より大きい）を待ち行列に入れる */
export function ingest(model: ScreenModel, comments: readonly DanmakuComment[]): ScreenModel {
  const fresh = comments.filter(c => c.id > model.seen).sort((a, b) => a.id - b.id)
  const last = fresh[fresh.length - 1]
  if (last === undefined) return model
  const max = Math.max(4, Math.min(MAX_COMMENT_CELLS, model.cfg.cols - 2))
  const added: Waiting[] = fresh.flatMap(c => {
    const text = clipToWidth(sanitize(c.text), max)
    if (text === '') return []
    return [{ id: c.id, text, color: c.color, isBig: c.isBig, pos: c.pos, w: textWidth(text), since: model.t }]
  })
  const waiting = [...model.waiting, ...added].slice(-MAX_WAITING)
  return spawn({ ...model, seen: last.id, waiting })
}

/**
 * 時計を1コマで進める幅を、実時間 now から決める。wall はモデルの時刻に当たる実時間（undefined なら測り直し）。
 * 遅れて来たコマは遅れた分まで（maxMs まで）進める。早く来たコマも tickMs 進め、先に進んだ分は wall に持ち越して
 * 次に遅れたときに差し引く。実時間がほとんど進まない時計（テスト）では、いつも tickMs ずつ進む
 */
export function stepClock(wall: number | undefined, now: number, tickMs: number, maxMs: number): { dt: number; wall: number } {
  if (wall === undefined) return { dt: tickMs, wall: now }
  const dt = Math.min(maxMs, Math.max(tickMs, now - wall))
  return { dt, wall: Math.max(now, wall + dt) }
}

/** 時間を dt ミリ秒進め、流れ終わったものを消し、待っているものを出す */
export function advance(model: ScreenModel, dt: number): ScreenModel {
  const t = model.t + dt
  const flights = model.flights.filter(f => isAlive(f, t, model.cfg))
  return spawn({ ...model, t, flights })
}

// ---- Client の時計 ----

/**
 * Client が持つ状態。wall はモデルの時刻に当たる実時間（時計が止まっていた直後は undefined）、
 * tickAt は最後に時計を進めた実時間
 */
export type ScreenState = { model: ScreenModel; wall: number | undefined; tickAt: number }

/** タイマーで時計を1コマ進める。ページが重くてタイマーが遅れても、弾幕が遅れないように実時間に合わせる */
export function tick(state: ScreenState, now: number, tickMs: number, maxMs: number): ScreenState {
  const { dt, wall } = stepClock(state.wall, now, tickMs, maxMs)
  return { model: advance(state.model, dt), wall, tickAt: now }
}

/** 新しいコメントなどで model が変わった。止まっていた時計は、ここから測り直す */
export function replaceModel(state: ScreenState, model: ScreenModel, now: number): ScreenState {
  return isIdle(state.model) ? { model, wall: undefined, tickAt: now } : { ...state, model }
}

/**
 * 描く瞬間のモデルの時刻。タイマーと画面の書き換えは周期がずれるので、
 * 最後に時計を進めてからの実時間を、1コマ分まで足す
 */
export function drawTime(state: ScreenState, now: number, tickMs: number): number {
  return state.model.t + Math.min(tickMs, Math.max(0, now - state.tickAt))
}

/** 今の状態を、行ごとの区間に描き出す */
export function frameRows(model: ScreenModel): Seg[][] {
  const { cfg, t } = model
  const rows: Placed[][] = Array.from({ length: cfg.lanes }, () => [])
  // 流れるコメントを先に、固定コメントを上に重ねる
  const ordered = [...model.flights.filter(f => f.pos === 'naka'), ...model.flights.filter(f => f.pos !== 'naka')]
  for (const f of ordered) {
    const row = rows[f.lane]
    if (row === undefined) continue
    const x = f.pos === 'naka' ? flowX(f, t, cfg) : Math.floor((cfg.cols - f.w) / 2)
    row.push({ x, text: f.text, color: f.color, isBig: f.isBig })
  }
  return rows.map(items => composeRow(items, cfg.cols))
}

// ---- Desktop 用: 1セル未満の位置で置く ----

/**
 * Desktop に置く1片。x はセル単位の小数で、画面の外にはみ出していてもよい（描く側で切れる）。
 * clip があれば、セル範囲 [from, to) の外は描かない。
 * Desktop は文字をプロポーショナルフォントで描くので空白で位置を作れず、片ごとに x に置く。
 */
export type Piece = {
  x: number
  text: string
  color: string | null
  isBig: boolean
  isFixed: boolean
  clip?: readonly [number, number]
}

/**
 * 流れるコメントを、固定コメントの下 holes を避けて、見える範囲ごとの片にする。
 * 文字では切らずに範囲で切るので、穴にかかっても残りの文字の位置は動かない。
 * 文字はセルの幅の (1 + overhang) 倍まで右へはみ出すとみなし、その分も穴で切る。範囲の両端は画面の外まで広げる。
 */
export function clipAround(item: Placed, holes: ReadonlyArray<readonly [number, number]>, cols: number, overhang = 0): Piece[] {
  const piece: Piece = { x: item.x, text: item.text, color: item.color, isBig: item.isBig, isFixed: false }
  const reach = item.x + textWidth(item.text) * (1 + overhang)
  if (reach <= 0 || item.x >= cols) return []
  // かかる穴を左から並べ、重なる穴はまとめる
  const hits: [number, number][] = []
  for (const [from, to] of holes.filter(([from, to]) => item.x < to && reach > from).sort((a, b) => a[0] - b[0])) {
    const last = hits[hits.length - 1]
    if (last !== undefined && from <= last[1]) last[1] = Math.max(last[1], to)
    else hits.push([from, to])
  }
  if (hits.length === 0) return [piece]
  // [左端, 穴1の左, 穴1の右, 穴2の左, ..., 右端] の偶数番目から次までが見える範囲。
  // 右端は、領域の幅のセルに入りきらない端数（1セル未満）の分も含める
  const edges = [Math.min(0, item.x), ...hits.flat(), Math.max(cols + 1, reach)]
  const pieces: Piece[] = []
  for (let i = 0; i + 1 < edges.length; i += 2) {
    const from = edges[i]!
    const to = edges[i + 1]!
    if (from < to && from < reach && to > item.x) pieces.push({ ...piece, clip: [from, to] })
  }
  return pieces
}

/** 今の状態を、行ごとの片に描き出す（Desktop 用）。流れるコメントを先に、固定コメントを後に並べる */
export function framePieces(model: ScreenModel): Piece[][] {
  const { cfg, t } = model
  return Array.from({ length: cfg.lanes }, (_, lane) => {
    const here = model.flights.filter(f => f.lane === lane)
    const fixed = here
      .filter(f => f.pos !== 'naka')
      // 描くときは中央に寄せるので、穴も真ん中に開ける（ターミナルのように切り捨てない）
      .map(f => ({ x: (cfg.cols - f.w) / 2, text: f.text, color: f.color, isBig: f.isBig, isFixed: true }))
    const holes = fixed.map(f => [f.x, f.x + textWidth(f.text)] as const)
    const flowing = here
      .filter(f => f.pos === 'naka')
      .flatMap(f =>
        clipAround({ x: flowX(f, t, cfg), text: f.text, color: f.color, isBig: f.isBig }, holes, cfg.cols, cfg.overhang),
      )
    return [...flowing, ...fixed]
  })
}
