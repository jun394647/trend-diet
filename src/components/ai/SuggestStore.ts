import { create } from 'zustand'
import type { AiError } from '../../ai/client'
import type { CoachContext, Suggestions } from '../../ai/contract'
import { useStore } from '../../store'
import { useSync } from '../../sync/store'
import type { DateStr, MealEntry } from '../../types'
import { callAiOnce, errorToKeep } from './CoachCall'

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
  /** 추천을 요청할 때의 오늘 먹은 양. 여기에 추천을 눌러 기록한 양을 더한 것과 지금이 다르면 다른 기록이 바뀐 것이다. */
  baseKcal: number
  /**
   * 눌러서 기록한 추천(rows의 순서 → 그때 만든 식사의 id).
   * 그 식사가 지금도 기록에 있는지는 loggedRows로 본다. 지웠으면 다시 기록할 수 있다.
   */
  logged: Record<number, string>
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
  baseKcal: 0,
  logged: {},
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

/** 식사 기록에 남는 칼로리(정수). */
const mealKcal = (row: SuggestRow) => Math.round(row.kcal)

/** 이 추천을 눌러 기록했을 때 생기는 식사와 같은 모양인지. */
function isMealOf(m: MealEntry, row: SuggestRow, date: DateStr | null): boolean {
  return m.source === 'ai' && m.date === date && m.kcal === mealKcal(row) && (m.name ?? '') === row.name.trim()
}

/**
 * 추천 가운데 지금도 기록에 남아 있는 것들(rows의 순서).
 * 기록할 때 만든 식사를 id로 찾고, id를 알아내지 못했을 때는 날짜·이름·칼로리가 같은 AI 식사로 찾는다.
 */
export function loggedRows(state: Pick<SuggestState, 'date' | 'rows' | 'logged'>, meals: MealEntry[]): number[] {
  const out: number[] = []
  for (const [key, mealId] of Object.entries(state.logged)) {
    const index = Number(key)
    const row = state.rows?.[index]
    if (!row) continue
    const found = mealId
      ? meals.some((m) => m.id === mealId)
      : meals.some((m) => isMealOf(m, row, state.date))
    if (found) out.push(index)
  }
  return out
}

/** 추천을 받은 뒤로 다른 기록이 그대로라면 오늘 먹은 양이 이 값이어야 한다. */
export function expectedKcal(state: Pick<SuggestState, 'date' | 'rows' | 'logged' | 'baseKcal'>, meals: MealEntry[]): number {
  return loggedRows(state, meals).reduce((sum, i) => sum + mealKcal(state.rows![i]), state.baseKcal)
}

/**
 * 추천을 요청한다. 같은 날의 요청을 이미 기다리는 중이면 아무 일도 하지 않는다.
 * 기다리던 것이 어제의 요청이면(자정을 넘긴 경우) 그 답은 버리고 오늘 것을 새로 보낸다.
 */
export async function requestSuggestions(date: DateStr, context: CoachContext): Promise<void> {
  const before = useSuggest.getState()
  if (before.pending && before.date === date) return
  if (before.pending) epoch++
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
      baseKcal: context.todayKcal,
      logged: {},
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
    useSuggest.setState({ pending: false, error: errorToKeep(e as AiError) })
  }
}

/**
 * 추천 하나를 기록한다. log는 실제로 식사를 저장하는 일.
 * 이미 기록해 둔 것이 남아 있거나 기록하는 중이면 아무 일도 하지 않는다. 저장하지 못하면 false.
 */
export async function logSuggestion(index: number, log: (row: SuggestRow, kcal: number) => Promise<unknown>): Promise<boolean> {
  const s = useSuggest.getState()
  const row = s.rows?.[index]
  if (!row || s.logging.includes(index) || loggedRows(s, useStore.getState().meals).includes(index)) return true
  const mine = epoch
  const rows = s.rows
  const kcal = mealKcal(row)
  const known = new Set(useStore.getState().meals.map((m) => m.id))
  useSuggest.setState({ logging: [...s.logging, index] })
  let ok = true
  try {
    await log(row, kcal)
  } catch {
    ok = false
  }
  // 기다리는 사이에 추천이 바뀌었으면 그 목록의 표시는 건드리지 않는다.
  if (mine !== epoch || useSuggest.getState().rows !== rows) return ok
  // 방금 생긴 식사를 기억해 둔다. 나중에 그 식사를 지우면 이 추천을 다시 기록할 수 있다.
  const created = useStore
    .getState()
    .meals.find((m) => !known.has(m.id) && isMealOf(m, row, s.date))
  useSuggest.setState((cur) => ({
    logging: cur.logging.filter((i) => i !== index),
    ...(ok ? { logged: { ...cur.logged, [index]: created?.id ?? '' } } : {}),
  }))
  return ok
}
