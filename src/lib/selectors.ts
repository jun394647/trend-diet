import type { Checkin, DateStr, MealEntry, WeightEntry } from '../types.ts'
import { addDays, diffDays } from './date.ts'

/** 대충 입력의 크기별 비율(하루 목표 대비). */
export const ROUGH_PORTIONS = {
  small: { label: '적게', ratio: 0.2 },
  medium: { label: '보통', ratio: 0.3 },
  large: { label: '많이', ratio: 0.45 },
} as const
export type RoughSize = keyof typeof ROUGH_PORTIONS

export function roughKcal(size: RoughSize, targetKcal: number): number {
  return Math.round((targetKcal * ROUGH_PORTIONS[size].ratio) / 10) * 10
}

/** 주간 체크인 주기(일). */
export const CHECKIN_INTERVAL_DAYS = 7
/** 백업 권장 주기(일). */
export const BACKUP_INTERVAL_DAYS = 7

export function latestCheckin(checkins: Checkin[]): Checkin | null {
  if (checkins.length === 0) return null
  return [...checkins].sort((a, b) => a.date.localeCompare(b.date))[checkins.length - 1]
}

export function isCheckinDue(checkins: Checkin[], asOf: DateStr): boolean {
  const last = latestCheckin(checkins)
  if (!last) return false
  return diffDays(last.date, asOf) >= CHECKIN_INTERVAL_DAYS
}

export function mealsOn(meals: MealEntry[], date: DateStr): MealEntry[] {
  return meals
    .filter((m) => m.date === date)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function kcalOn(meals: MealEntry[], date: DateStr): number {
  return meals.reduce((sum, m) => (m.date === date ? sum + m.kcal : sum), 0)
}

export function weightOn(weights: WeightEntry[], date: DateStr): number | null {
  return weights.find((w) => w.date === date)?.kg ?? null
}

/**
 * 연속 기록 일수. 체중이나 식사 중 하나라도 기록한 날을 기록한 날로 본다.
 * 오늘 아직 기록이 없으면 어제까지의 연속 일수를 돌려준다.
 */
export function streak(weights: WeightEntry[], meals: MealEntry[], asOf: DateStr): number {
  const days = new Set<DateStr>()
  for (const w of weights) days.add(w.date)
  for (const m of meals) days.add(m.date)
  let cursor = days.has(asOf) ? asOf : addDays(asOf, -1)
  let n = 0
  while (days.has(cursor)) {
    n++
    cursor = addDays(cursor, -1)
  }
  return n
}

export function isBackupDue(lastBackupAt: string | null, hasData: boolean, now: Date): boolean {
  if (!hasData) return false
  if (!lastBackupAt) return true
  const days = (now.getTime() - new Date(lastBackupAt).getTime()) / 86_400_000
  return days >= BACKUP_INTERVAL_DAYS
}
