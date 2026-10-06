// 弾幕を描く Client の surface module。描画スレッドで動き、$ は持たない。
// hooks/register.tsx から props でコメントを受け取り、自分の時計で右から左へ流す。

import type { ClientSurface } from 'claude-code'

import type { ScreenProps } from '../types'
import { drawTime, emptyModel, frameRows, framePieces, ingest, isIdle, replaceModel, sameConfig, tick } from './layout'
import type { Piece, ScreenConfig, ScreenState } from './layout'

/** 1コマの長さ。ターミナルは1セルずつしか動けないので 20fps、Desktop は1セル未満で置けるので 60fps（ページの下限が16ms） */
const TICK_MS = { terminal: 50, desktop: 16 } as const
/** ページが重くて時計が遅れたとき、1コマで進める時間の上限 */
const MAX_STEP_MS = 100

/** 実時間。performance がない環境に備えて Date.now でも動くようにしておく */
const clockNow = () => (typeof performance === 'object' && performance !== null ? performance.now() : Date.now())

export default function Screen(props: ScreenProps, surface: ClientSurface<ScreenState>) {
  const { Box, Text } = surface.elements
  const cfg: ScreenConfig = {
    cols: Math.max(8, surface.columns > 0 ? surface.columns : props.cols),
    lanes: Math.max(1, props.lanes),
    durationMs: Math.max(500, props.durationMs),
    fixedMs: Math.max(500, props.fixedMs),
    overhang: props.surface === 'desktop' ? 1 : 0,
  }
  const tickMs = TICK_MS[props.surface]

  let state = surface.state
  if (state === undefined) {
    // 初回だけ時計を回す。何も流れていない間は再描画しない
    surface.every(tickMs, () => {
      const current = surface.state
      if (current === undefined || isIdle(current.model)) return
      surface.setState(tick(current, clockNow(), tickMs, MAX_STEP_MS))
    })
    state = { model: ingest(emptyModel(cfg), props.comments), wall: undefined, tickAt: clockNow() }
    surface.setState(state)
  } else {
    let next = sameConfig(state.model.cfg, cfg) ? state.model : { ...state.model, cfg }
    next = ingest(next, props.comments)
    if (next !== state.model) {
      state = replaceModel(state, next, clockNow())
      surface.setState(state)
    }
  }
  const { model } = state

  const label = (text: string, color: string | null, isBig: boolean) =>
    color === null ? (
      <Text bold={isBig} wrap="truncate">
        {text}
      </Text>
    ) : (
      <Text color={color} bold={isBig} wrap="truncate">
        {text}
      </Text>
    )

  if (props.surface === 'desktop') {
    // Desktop は文字をプロポーショナルフォントで描くので、空白の幅が1セル（1ch）より狭い。
    // 空白で位置を作ると左に寄るため、片ごとに置き、固定コメントは中央に寄せる。
    // left は整数しか取らないが marginLeft は小数を取るので、流れるコメントは marginLeft で1セル未満まで動かす。
    // Client の中では親の Box が基準にならないので、top / left は Client の領域の左上から数える。
    const pieces = framePieces({ ...model, t: drawTime(state, clockNow(), tickMs) }).flatMap((row, lane) =>
      row.map(piece => ({ ...piece, lane })),
    )
    // 後の Box ほど上に描かれるので、固定コメントを最後に置いて上に重ねる
    const ordered = [...pieces.filter(piece => !piece.isFixed), ...pieces.filter(piece => piece.isFixed)]
    const flowing = (piece: Piece & { lane: number }) => {
      if (piece.clip === undefined) {
        return (
          <Box position="absolute" top={piece.lane} left={0} marginLeft={piece.x} height={1}>
            {label(piece.text, piece.color, piece.isBig)}
          </Box>
        )
      }
      // 固定コメントの下を抜くため、見える範囲の窓に入れて、はみ出た分を切る
      const [from, to] = piece.clip
      return (
        <Box position="absolute" top={piece.lane} left={0} marginLeft={from} width={to - from} height={1} overflow="hidden">
          <Box marginLeft={piece.x - from} flexShrink={0}>
            {label(piece.text, piece.color, piece.isBig)}
          </Box>
        </Box>
      )
    }
    return (
      <Box flexDirection="column" height={cfg.lanes} overflow="hidden">
        {ordered.map(piece =>
          piece.isFixed ? (
            <Box position="absolute" top={piece.lane} left={0} right={0} height={1} justifyContent="center">
              {label(piece.text, piece.color, piece.isBig)}
            </Box>
          ) : (
            flowing(piece)
          ),
        )}
      </Box>
    )
  }

  const rows = frameRows(model)
  return (
    <Box flexDirection="column" height={cfg.lanes} overflow="hidden">
      {rows.map(segs => (
        <Box flexDirection="row" height={1} overflow="hidden">
          {segs.length === 0 ? <Text> </Text> : segs.map(seg => label(seg.text, seg.color, seg.isBig))}
        </Box>
      ))}
    </Box>
  )
}
