import type { WeekReview } from '../../ai/contract'
import type { DateStr } from '../../types'

/** 같은 날 화면을 나갔다 돌아와도 다시 호출하지 않도록 기억해 둔다. 새로 고치면 사라진다. */
const cache = new Map<DateStr, WeekReview>()

export function cachedWeekReview(date: DateStr): WeekReview | null {
  return cache.get(date) ?? null
}

export function cacheWeekReview(date: DateStr, review: WeekReview): void {
  cache.clear()
  cache.set(date, review)
}

export function clearWeekReviewCache(): void {
  cache.clear()
}
