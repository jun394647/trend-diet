import type { Checkin, DateStr, MealEntry, Profile, WeightEntry } from '../types'
import { parseDate } from './date'
import { latestCheckin } from './selectors'
import { effectiveWeeklyLoss } from './sustain'
import { computeTarget, estimateTdee, initialTdee, type TargetResult, type TdeeEstimate } from './tdee'
import { computeTrend, trendAt } from './trend'

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

export interface CheckinProposal {
  asOf: DateStr
  previous: Plan
  estimate: TdeeEstimate
  target: TargetResult
  /** 현재 추세 체중. 체중 기록이 없으면 null. */
  trendKg: number | null
  /** 지난 체크인 시점 대비 추세 체중 변화(kg). 비교할 수 없으면 null. */
  trendChangeKg: number | null
}

/** 주간 체크인 제안을 만든다. 저장은 하지 않는다. */
export function buildCheckinProposal(args: {
  profile: Profile
  weights: WeightEntry[]
  meals: MealEntry[]
  checkins: Checkin[]
  asOf: DateStr
}): CheckinProposal | null {
  const { profile, weights, meals, checkins, asOf } = args
  const last = latestCheckin(checkins)
  if (!last) return null
  const previous: Plan = { tdee: last.estimatedTdee, targetKcal: last.targetKcal }
  const estimate = estimateTdee({ weights, meals, prevTdee: previous.tdee, asOf })
  const trendKg = trendAt(computeTrend(weights), asOf)
  const target = computeTarget({
    tdee: estimate.tdee,
    weeklyLossKg: effectiveWeeklyLoss(profile),
    sex: profile.sex,
    weightKg: trendKg ?? profile.startWeightKg,
  })
  const trendChangeKg = trendKg !== null && last.trendKg !== null ? trendKg - last.trendKg : null
  return { asOf, previous, estimate, target, trendKg, trendChangeKg }
}
