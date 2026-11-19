import type { Checkin, DateStr, Profile } from '../types.ts'
import { parseDate } from './date.ts'
import { latestCheckin } from './selectors.ts'
import { effectiveWeeklyLoss } from './sustain.ts'
import { computeTarget, initialTdee } from './tdee.ts'

export interface Plan {
  tdee: number
  targetKcal: number
}

/** 현재 적용 중인 계획(가장 최근 체크인). 체크인이 없으면 null. */
export function currentPlan(checkins: Checkin[]): Plan | null {
  const c = latestCheckin(checkins)
  return c ? { tdee: c.estimatedTdee, targetKcal: c.targetKcal } : null
}

/** 온보딩 직후의 첫 계획. 공식 기반 추정치를 쓴다. */
export function buildInitialCheckin(profile: Profile, date: DateStr): Checkin {
  const tdee = initialTdee(profile, profile.startWeightKg, parseDate(date).getFullYear())
  const target = computeTarget({
    tdee,
    weeklyLossKg: effectiveWeeklyLoss(profile),
    sex: profile.sex,
    weightKg: profile.startWeightKg,
  })
  return {
    date,
    kind: 'initial',
    trendKg: profile.startWeightKg,
    estimatedTdee: tdee,
    targetKcal: target.targetKcal,
    createdAt: new Date().toISOString(),
  }
}
