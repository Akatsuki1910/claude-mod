/** コメントの位置。naka は右から左へ流れる。ue / shita は上下に固定で数秒出る */
export type DanmakuPos = 'naka' | 'ue' | 'shita'

/** 弾幕コメント1件 */
export type DanmakuComment = {
  id: number
  text: string
  /** 文字色。null は端末の既定色 */
  color: string | null
  pos: DanmakuPos
  /** 太字で目立たせる */
  isBig: boolean
  /** 投稿時刻（ミリ秒） */
  at: number
}

/** 描画用の Client（hooks/screen.tsx）に渡す props */
export type ScreenProps = {
  /** どこに描くか。desktop は文字をプロポーショナルフォントで描くので、空白で位置を作れない */
  surface: 'terminal' | 'desktop'
  cols: number
  lanes: number
  durationMs: number
  fixedMs: number
  now: number
  comments: DanmakuComment[]
}

declare module 'claude-code' {
  interface PluginState {
    danmaku: {
      comments: DanmakuComment[]
      isOff: boolean
      sweep: number
    }
  }
}
