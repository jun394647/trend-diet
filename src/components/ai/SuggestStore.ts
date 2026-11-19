import { create } from 'zustand'
import type { AiError } from '../../ai/client'
import type { CoachContext, Suggestions } from '../../ai/contract'
import { useSync } from '../../sync/store'
import type { DateStr } from '../../types'
import { callAiOnce } from './CoachCall'

export const MAX_WISH = 100
/** 서버가 받는 '빼고 싶은 음식'의 최대 개수와 이름 길이(contract.ts와 같다). */
const MAX_AVOID = 12
const MAX_AVOID_NAME = 60
const MAX_ROWS = 3

export type SuggestRow = Suggestions['suggestions'][number]

/**
 * 오늘 받은 식사 추천.
 * 요청은 화면이 아니라 여기서 보내고 결과도 여기 두므로, 오늘 화면을 나갔다 와도 남아 있다.
 */
interface SuggestState {
  /** 아래 값들이 어느 날의 것인지. 날이 바뀌면 없는 것으로 본다. */
  date: DateStr | null
  /** 화면에 보여 줄 추천(최대 3개). 아직 받은 적이 없으면 null. */
  rows: SuggestRow[] | null
  note: string
  /**
   * 추천을 받은 뒤로 기록이 그대로라면 오늘 먹은 양이 이 값이어야 한다.
   * 요청할 때의 먹은 양에, 추천을 눌러 기록한 양을 더한 값이다. 다르면 다른 기록이 바뀐 것이다.
   */
  expectedKcal: number
  /** 기록한 추천(rows의 순서). */
  logged: number[]
  /** 지금 기록하는 중인 추천. 한 번 누른 것이 두 번 기록되지 않게 막는다. */
  logging: number[]
  /** 오늘 이미 추천받은 이름들. 다음 요청에서 빼 달라고 보낸다. 새것부터 12개까지. */
  avoid: string[]
  wish: string
  pending: boolean
  error: AiError | null
}

const EMPTY: SuggestState = {
  date: null,
  rows: null,
  note: '',
  expectedKcal: 0,
  logged: [],
  logging: [],
  avoid: [],
  wish: '',
  pending: false,
  error: null,
}

export const useSuggest = create<SuggestState>(() => EMPTY)

/** 계정이 바뀌거나 비울 때마다 올린다. 그 전에 보낸 요청의 답은 버린다. */
let epoch = 0

export function resetSuggest(): void {
  epoch++
  useSuggest.setState(EMPTY)
}

// 추천은 그 계정의 기록으로 만든 것이다. 로그아웃하거나 계정이 바뀌면 남기지 않는다.
useSync.subscribe((s, prev) => {
  if (s.email !== prev.email) resetSuggest()
})

export function setSuggestWish(wish: string): void {
  useSuggest.setState({ wish: wish.slice(0, MAX_WISH) })
}

function mergeAvoid(prev: string[], names: string[]): string[] {
  const next = prev.filter((n) => !names.includes(n))
  for (const name of names) {
    const n = name.trim().slice(0, MAX_AVOID_NAME)
    if (n && !next.includes(n)) next.push(n)
  }
  return next.slice(-MAX_AVOID)
}

/** 추천을 요청한다. 이미 기다리는 중이면 아무 일도 하지 않는다. */
export async function requestSuggestions(date: DateStr, context: CoachContext): Promise<void> {
  const before = useSuggest.getState()
  if (before.pending) return
  // 어제의 추천과 피할 이름은 오늘로 가져오지 않는다.
  const base = before.date === date ? before : { ...EMPTY, wish: before.wish }
  const wish = base.wish.trim()
  const mine = epoch
  useSuggest.setState({ ...base, date, pending: true, error: null })
  try {
    const result = await callAiOnce({
      task: 'suggest',
      context,
      ...(wish ? { wish } : {}),
      ...(base.avoid.length > 0 ? { avoid: base.avoid } : {}),
    })
    if (mine !== epoch) return
    const rows = result.suggestions.filter((s) => s.kcal > 0).slice(0, MAX_ROWS)
    useSuggest.setState((s) => ({
      rows,
      note: result.note,
      expectedKcal: context.todayKcal,
      logged: [],
      logging: [],
      avoid: mergeAvoid(
        s.avoid,
        rows.map((r) => r.name),
      ),
      pending: false,
      error: null,
    }))
  } catch (e) {
    if (mine !== epoch) return
    // 앞서 받은 추천이 있으면 그대로 둔다.
    useSuggest.setState({ pending: false, error: e as AiError })
  }
}

/**
 * 추천 하나를 기록한다. log는 실제로 식사를 저장하는 일.
 * 이미 기록했거나 기록하는 중이면 아무 일도 하지 않는다. 저장하지 못하면 false.
 */
export async function logSuggestion(index: number, log: (row: SuggestRow, kcal: number) => Promise<unknown>): Promise<boolean> {
  const s = useSuggest.getState()
  const row = s.rows?.[index]
  if (!row || s.logged.includes(index) || s.logging.includes(index)) return true
  const mine = epoch
  const rows = s.rows
  const kcal = Math.round(row.kcal)
  useSuggest.setState({ logging: [...s.logging, index] })
  let ok = true
  try {
    await log(row, kcal)
  } catch {
    ok = false
  }
  // 기다리는 사이에 추천이 바뀌었으면 그 목록의 표시는 건드리지 않는다.
  if (mine !== epoch || useSuggest.getState().rows !== rows) return ok
  useSuggest.setState((cur) => ({
    logging: cur.logging.filter((i) => i !== index),
    ...(ok ? { logged: [...cur.logged, index], expectedKcal: cur.expectedKcal + kcal } : {}),
  }))
  return ok
}
