import { create } from 'zustand'
import type { AiError } from '../../ai/client'
import { WeekReviewSchema, type CoachContext, type WeekReview } from '../../ai/contract'
import { useSync } from '../../sync/store'
import type { DateStr } from '../../types'
import { callAiOnce } from './CoachCall'

/**
 * 주간 돌아보기의 요청과 결과.
 * 요청은 화면이 아니라 여기서 보내므로, 기다리다 다른 화면으로 가도 답이 오면 남는다.
 * 결과는 계정과 날짜로 묶어 기기에 적어 두어, 같은 날 새로 고쳐도 다시 호출하지 않는다.
 */
interface WeekReviewState {
  /** 지금 담고 있는 요청이나 결과의 주인(계정 + 날짜). */
  key: string | null
  review: WeekReview | null
  pending: boolean
  error: AiError | null
}

const STORAGE_KEY = 'trend-diet:week-review'
const EMPTY: WeekReviewState = { key: null, review: null, pending: false, error: null }

export const useWeekReview = create<WeekReviewState>(() => EMPTY)

/** 계정이 바뀌거나 비울 때마다 올린다. 그 전에 보낸 요청의 답은 버린다. */
let epoch = 0

export function weekReviewKey(email: string | null, date: DateStr): string | null {
  return email ? `${email}|${date}` : null
}

function readStored(): { key: string; review: WeekReview } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { key?: unknown; review?: unknown }
    const review = WeekReviewSchema.safeParse(parsed.review)
    return typeof parsed.key === 'string' && review.success ? { key: parsed.key, review: review.data } : null
  } catch {
    return null
  }
}

function writeStored(value: { key: string; review: WeekReview } | null): void {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 저장하지 못해도 이번 화면에서는 그대로 보여 줄 수 있다.
  }
}

/** 지금 로그인한 계정이 이 날짜에 받아 둔 돌아보기. 없으면 null. */
export function cachedWeekReview(date: DateStr): WeekReview | null {
  const key = weekReviewKey(useSync.getState().email, date)
  if (!key) return null
  const s = useWeekReview.getState()
  if (s.key === key && s.review) return s.review
  const stored = readStored()
  return stored && stored.key === key ? stored.review : null
}

/** 돌아보기를 요청한다. 이미 기다리는 중이면 아무 일도 하지 않는다. */
export async function requestWeekReview(date: DateStr, context: CoachContext, recommendation?: string): Promise<void> {
  const key = weekReviewKey(useSync.getState().email, date)
  if (!key || useWeekReview.getState().pending) return
  const mine = epoch
  useWeekReview.setState({ key, review: null, pending: true, error: null })
  try {
    const review = await callAiOnce({
      task: 'week-review',
      context,
      ...(recommendation ? { recommendation: recommendation.slice(0, 200) } : {}),
    })
    if (mine !== epoch) return
    writeStored({ key, review })
    useWeekReview.setState({ key, review, pending: false, error: null })
  } catch (e) {
    if (mine !== epoch) return
    useWeekReview.setState({ key, review: null, pending: false, error: e as AiError })
  }
}

/** 받아 둔 돌아보기와 기다리던 요청을 모두 잊는다. */
export function clearWeekReviewCache(): void {
  epoch++
  useWeekReview.setState(EMPTY)
  writeStored(null)
}

// 돌아보기는 그 계정의 기록으로 쓴 글이다. 로그아웃하거나 계정이 바뀌면 남기지 않는다.
// 앱을 켠 직후의 로그인 복원(없음 → 같은 계정)에서는 기기에 적어 둔 것을 그대로 둔다.
useSync.subscribe((s, prev) => {
  if (s.email === prev.email) return
  epoch++
  useWeekReview.setState(EMPTY)
  const stored = readStored()
  if (stored && (prev.email !== null || stored.key.slice(0, stored.key.lastIndexOf('|')) !== s.email)) writeStored(null)
})
