import type { DateStr, MealEntry, Profile, Sex, WeightEntry } from '../types'
import { addDays, diffDays } from './date'
import { computeTrend } from './trend'

/** 체지방 1kg에 해당하는 열량 근사값. */
export const KCAL_PER_KG = 7700
/** 적응형 추정에 쓰는 기간(일). */
export const WINDOW_DAYS = 21
/** 추정에 필요한 최소 식사 기록 일수. */
export const MIN_LOGGED_DAYS = 10
/** 추정에 필요한 최소 체중 기록 횟수. */
export const MIN_WEIGH_INS = 5
/** 추세 변화를 볼 최소 간격(일). */
export const MIN_SPAN_DAYS = 7
/** 새 추정치를 반영하는 비율. 나머지는 이전 추정치를 유지한다. */
export const BLEND = 0.3
/** 주당 감량 속도 상한: 체중의 1%. */
export const MAX_WEEKLY_LOSS_RATIO = 0.01

export const MIN_KCAL: Record<Sex, number> = { F: 1200, M: 1500 }

/** Mifflin-St Jeor 기초대사량. */
export function bmr(sex: Sex, weightKg: number, heightCm: number, age: number): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'M' ? 5 : -161)
}

export function initialTdee(profile: Profile, weightKg: number, year: number): number {
  const age = year - profile.birthYear
  return Math.round(bmr(profile.sex, weightKg, profile.heightCm, age) * profile.activityFactor)
}

export interface TdeeEstimate {
  tdee: number
  /** 'adaptive'면 기록으로 추정한 값, 'insufficient'면 기록이 부족해 이전 값을 유지한 것. */
  basis: 'adaptive' | 'insufficient'
  loggedDays: number
  weighIns: number
  /** 기간 내 하루 평균 섭취(기록한 날만). 기록이 없으면 null. */
  avgIntake: number | null
  /** 기간 내 추세 체중 변화(kg). 계산 불가면 null. */
  trendDeltaKg: number | null
}

/**
 * 최근 기간의 섭취량과 추세 체중 변화로 실제 소비 칼로리를 추정한다.
 * 식사 기록이 없는 날은 0kcal로 치지 않고 평균에서 제외한다.
 */
export function estimateTdee(args: {
  weights: WeightEntry[]
  meals: MealEntry[]
  prevTdee: number
  asOf: DateStr
}): TdeeEstimate {
  const { weights, meals, prevTdee, asOf } = args
  const from = addDays(asOf, -(WINDOW_DAYS - 1))

  const perDay = new Map<DateStr, number>()
  for (const m of meals) {
    if (m.date < from || m.date > asOf) continue
    perDay.set(m.date, (perDay.get(m.date) ?? 0) + m.kcal)
  }
  const loggedDays = perDay.size
  const avgIntake =
    loggedDays > 0 ? [...perDay.values()].reduce((a, b) => a + b, 0) / loggedDays : null

  // 추세는 전체 기록으로 계산해 기간 시작점의 값이 안정되게 한다.
  const inWindow = computeTrend(weights.filter((w) => w.date <= asOf)).filter(
    (p) => p.date >= from,
  )
  const weighIns = inWindow.length
  const first = inWindow[0]
  const last = inWindow[inWindow.length - 1]
  const span = first && last ? diffDays(first.date, last.date) : 0
  const trendDeltaKg = first && last && span > 0 ? last.trend - first.trend : null

  const enough =
    avgIntake !== null &&
    trendDeltaKg !== null &&
    loggedDays >= MIN_LOGGED_DAYS &&
    weighIns >= MIN_WEIGH_INS &&
    span >= MIN_SPAN_DAYS

  if (!enough) {
    return { tdee: Math.round(prevTdee), basis: 'insufficient', loggedDays, weighIns, avgIntake, trendDeltaKg }
  }

  const raw = avgIntake - (trendDeltaKg * KCAL_PER_KG) / span
  const clamped = Math.min(6000, Math.max(800, raw))
  const tdee = Math.round((1 - BLEND) * prevTdee + BLEND * clamped)
  return { tdee, basis: 'adaptive', loggedDays, weighIns, avgIntake, trendDeltaKg }
}

export interface TargetResult {
  targetKcal: number
  /** 실제 적용된 주당 감량 속도(상한 적용 후). */
  appliedWeeklyLossKg: number
  /** 감량 속도가 상한에 걸려 줄었는지. */
  lossCapped: boolean
  /** 목표 칼로리가 하한에 걸렸는지. */
  flooredAtMin: boolean
}

export function computeTarget(args: {
  tdee: number
  weeklyLossKg: number
  sex: Sex
  weightKg: number
}): TargetResult {
  const { tdee, weeklyLossKg, sex, weightKg } = args
  const cap = weightKg * MAX_WEEKLY_LOSS_RATIO
  const requested = Math.max(0, weeklyLossKg)
  const applied = Math.min(requested, cap)
  const raw = tdee - (applied * KCAL_PER_KG) / 7
  const floor = MIN_KCAL[sex]
  const targetKcal = Math.round(Math.max(floor, raw) / 10) * 10
  return {
    targetKcal,
    appliedWeeklyLossKg: applied,
    lossCapped: applied < requested,
    flooredAtMin: raw < floor,
  }
}

/** 현재 추세 체중과 감량 속도로 목표 체중 도달 예상일을 구한다. 계산할 수 없으면 null. */
export function projectGoalDate(args: {
  trendKg: number
  goalKg: number
  weeklyLossKg: number
  from: DateStr
}): DateStr | null {
  const { trendKg, goalKg, weeklyLossKg, from } = args
  if (trendKg <= goalKg) return from
  if (weeklyLossKg <= 0) return null
  const days = Math.ceil(((trendKg - goalKg) / weeklyLossKg) * 7)
  return addDays(from, days)
}
