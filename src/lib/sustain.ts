/**
 * 오래 이어 갈 수 있는 다이어트를 위한 규칙들.
 *  - 하루 목표는 한 점이 아니라 범위다.
 *  - 하루가 아니라 한 주의 평균으로 본다.
 *  - 감량 기간이 길어지면 유지 기간으로 쉬어 가고, 목표에 닿으면 유지로 넘어간다.
 *  - 힘들어 보이면 칼로리를 더 깎는 대신 속도를 늦추는 선택지를 준다.
 */
import type { Checkin, DateStr, MealEntry, Phase, Profile, WeightEntry } from '../types'
import { addDays, diffDays, parseDate } from './date'
import { latestCheckin } from './selectors'
import { computeTarget, estimateTdee, type TdeeEstimate } from './tdee'
import { computeTrend, trendAt } from './trend'

/** 목표 칼로리 위아래로 이만큼은 목표 범위 안으로 본다. */
export const TARGET_BAND = 100
/** 감량을 이만큼(주) 이어 가면 유지 기간을 권한다. */
export const BREAK_AFTER_WEEKS = 10
/** 쉬어 가는 유지 기간의 길이(일). */
export const BREAK_DAYS = 14
/** 최근 섭취가 목표보다 이만큼 넘게 많으면 속도를 늦추는 선택지를 낸다. */
export const STRUGGLE_MARGIN = 150
/** 고를 수 있는 감량 속도(kg/주). */
export const PACES = [0.25, 0.5, 0.75] as const

export interface Range {
  low: number
  high: number
}

export function targetRange(targetKcal: number): Range {
  return { low: targetKcal - TARGET_BAND, high: targetKcal + TARGET_BAND }
}

export type IntakeState = 'in' | 'over' | 'under'

export function intakeState(kcal: number, targetKcal: number): IntakeState {
  const { low, high } = targetRange(targetKcal)
  return kcal > high ? 'over' : kcal < low ? 'under' : 'in'
}

/** 그 날이 속한 주의 월요일. */
export function weekStart(date: DateStr): DateStr {
  const dow = parseDate(date).getDay() // 0 = 일요일
  return addDays(date, -((dow + 6) % 7))
}

export interface WeekDay {
  date: DateStr
  /** 식사 기록이 없는 날은 null. */
  kcal: number | null
  weighed: boolean
  /** 'none'은 식사 기록이 없는 지난 날 또는 오늘, 'future'는 아직 오지 않은 날. */
  state: IntakeState | 'none' | 'future'
}

export interface WeekSummary {
  days: WeekDay[]
  /** 식사를 기록한 날 수. */
  mealDays: number
  /** 평균을 낼 때 센 날 수. 아직 다 먹지 않은 오늘은 빠질 수 있다. */
  avgDays: number
  /** 식사나 체중 중 하나라도 기록한 날 수. */
  recordedDays: number
  /** 식사를 기록한 날들의 하루 평균. 기록이 없으면 null. */
  avgKcal: number | null
  avgState: IntakeState | 'none'
}

/**
 * asOf가 속한 주(월~일)를 요약한다. 기록하지 않은 날은 평균에서 뺀다.
 * inProgress로 넘긴 날(보통 오늘)은 아직 범위에 못 미쳤고 다른 기록이 있으면 평균에서 뺀다.
 * 하루가 끝나기 전의 적은 섭취량 때문에 한 주 평균이 낮게 보이는 것을 막기 위해서다.
 */
export function weekSummary(args: {
  meals: MealEntry[]
  weights: WeightEntry[]
  targetKcal: number
  asOf: DateStr
  inProgress?: DateStr
}): WeekSummary {
  const { meals, weights, targetKcal, asOf, inProgress } = args
  const start = weekStart(asOf)
  const perDay = new Map<DateStr, number>()
  for (const m of meals) perDay.set(m.date, (perDay.get(m.date) ?? 0) + m.kcal)
  const weighed = new Set(weights.map((w) => w.date))

  const days: WeekDay[] = []
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i)
    const kcal = perDay.get(date) ?? null
    days.push({
      date,
      kcal,
      weighed: weighed.has(date),
      state: date > asOf ? 'future' : kcal === null ? 'none' : intakeState(kcal, targetKcal),
    })
  }
  const logged = days.filter((d) => d.kcal !== null)
  const settled = logged.filter((d) => !(d.date === inProgress && d.state === 'under'))
  const counted = settled.length > 0 ? settled : logged
  const avgKcal =
    counted.length > 0 ? Math.round(counted.reduce((s, d) => s + (d.kcal ?? 0), 0) / counted.length) : null
  return {
    days,
    mealDays: logged.length,
    avgDays: counted.length,
    recordedDays: days.filter((d) => d.kcal !== null || d.weighed).length,
    avgKcal,
    avgState: avgKcal === null ? 'none' : intakeState(avgKcal, targetKcal),
  }
}

export function phaseOf(profile: Profile): Phase {
  return profile.phase ?? (profile.weeklyLossKg > 0 ? 'lose' : 'maintain')
}

/** 지금 단계에서 실제로 적용하는 주당 감량 속도. 유지 기간에는 0. */
export function effectiveWeeklyLoss(profile: Profile): number {
  return phaseOf(profile) === 'lose' ? profile.weeklyLossKg : 0
}

export function phaseStart(profile: Profile): DateStr {
  return profile.phaseStartedAt ?? profile.createdAt.slice(0, 10)
}

/** 지금 단계가 몇 주째인지. 첫 주가 1. */
export function weekOfPhase(profile: Profile, asOf: DateStr): number {
  return Math.floor(Math.max(0, diffDays(phaseStart(profile), asOf)) / 7) + 1
}

/** 한 단계 느린 속도. 이미 가장 느리면 null. */
export function slowerPace(weeklyLossKg: number): number | null {
  const slower = PACES.filter((p) => p < weeklyLossKg - 1e-9)
  return slower.length > 0 ? slower[slower.length - 1] : null
}

/** 최근 days일 동안 식사를 기록한 날의 평균 섭취. */
export function recentIntake(
  meals: MealEntry[],
  asOf: DateStr,
  days = 7,
): { loggedDays: number; avgKcal: number | null } {
  const from = addDays(asOf, -(days - 1))
  const perDay = new Map<DateStr, number>()
  for (const m of meals) {
    if (m.date < from || m.date > asOf) continue
    perDay.set(m.date, (perDay.get(m.date) ?? 0) + m.kcal)
  }
  const loggedDays = perDay.size
  const avgKcal =
    loggedDays > 0 ? Math.round([...perDay.values()].reduce((a, b) => a + b, 0) / loggedDays) : null
  return { loggedDays, avgKcal }
}

/** 최근 2주 추세 체중의 주당 변화(kg/주). 음수면 감량. 2주 전 기록이 없으면 null. */
export function recentWeeklyRate(weights: WeightEntry[], asOf: DateStr): number | null {
  const trend = computeTrend(weights)
  const now = trendAt(trend, asOf)
  const before = trendAt(trend, addDays(asOf, -14))
  return now === null || before === null ? null : (now - before) / 2
}

/** 목표까지의 진행 상황과 다음 단계(1kg 단위). */
export function progress(args: { startKg: number; goalKg: number; trendKg: number }): {
  /** 0~1. 시작 체중보다 늘었으면 0. */
  ratio: number
  lostKg: number
  remainingKg: number
  /** 다음으로 닿을 1kg 단위 체중. 목표에 닿았으면 null. */
  nextStepKg: number | null
} {
  const { startKg, goalKg, trendKg } = args
  const total = startKg - goalKg
  const lostKg = startKg - trendKg
  const remainingKg = Math.max(0, trendKg - goalKg)
  const ratio = total > 0 ? Math.min(1, Math.max(0, lostKg / total)) : remainingKg === 0 ? 1 : 0
  let nextStepKg: number | null = null
  if (remainingKg > 0) {
    const whole = Math.ceil(trendKg) - 1
    nextStepKg = Math.max(goalKg, whole)
  }
  return { ratio, lostKg, remainingKg, nextStepKg }
}

export type CheckinOptionId = 'maintain' | 'break' | 'resume' | 'slower' | 'adaptive' | 'keep'

/**
 * 주간 체크인에서 고를 수 있는 선택지 하나.
 *  - maintain: 목표 체중에 닿아 유지로 넘어간다.
 *  - break: 감량이 길어져 2주 유지 기간을 갖는다.
 *  - resume: 유지 기간을 마치고 감량을 다시 시작한다.
 *  - slower: 감량 속도를 한 단계 늦춘다.
 *  - adaptive: 지금 계획 그대로, 새로 추정한 소비 칼로리에 맞춘다.
 *  - keep: 아무것도 바꾸지 않는다.
 */
export interface CheckinOption {
  id: CheckinOptionId
  /** 이 선택지를 고르면 프로필에 덮어쓸 값. 프로필을 바꾸지 않으면 null. */
  profilePatch: Partial<Profile> | null
  estimatedTdee: number
  targetKcal: number
  /** 이 선택지에서의 주당 감량 속도(kg). */
  weeklyLossKg: number
  recommended: boolean
}

export interface CheckinReview {
  asOf: DateStr
  previous: { tdee: number; targetKcal: number }
  estimate: TdeeEstimate
  trendKg: number | null
  /** 지난 체크인 시점 대비 추세 체중 변화(kg). */
  trendChangeKg: number | null
  /** 최근 2주 추세의 주당 변화(kg/주). */
  weeklyRateKg: number | null
  /** 최근 7일 평균 섭취와 기록 일수. */
  recent: { loggedDays: number; avgKcal: number | null }
  phase: Phase
  weekOfPhase: number
  /** 추세 체중이 목표 체중에 닿았는지. */
  goalReached: boolean
  /** 감량이 체중의 주당 1%보다 빠른지. */
  tooFast: boolean
  /** 첫 번째가 권하는 선택지다. */
  options: CheckinOption[]
}

/** 주간 체크인에 보여 줄 요약과 선택지를 만든다. 저장은 하지 않는다. */
export function buildCheckinReview(args: {
  profile: Profile
  weights: WeightEntry[]
  meals: MealEntry[]
  checkins: Checkin[]
  asOf: DateStr
}): CheckinReview | null {
  const { profile, weights, meals, checkins, asOf } = args
  const last = latestCheckin(checkins)
  if (!last) return null

  const previous = { tdee: last.estimatedTdee, targetKcal: last.targetKcal }
  const estimate = estimateTdee({ weights, meals, prevTdee: previous.tdee, asOf })
  const trendKg = trendAt(computeTrend(weights), asOf)
  const weightKg = trendKg ?? profile.startWeightKg
  const phase = phaseOf(profile)
  const recent = recentIntake(meals, asOf)
  const weeklyRateKg = recentWeeklyRate(weights, asOf)
  const goalReached = phase === 'lose' && trendKg !== null && trendKg <= profile.goalWeightKg
  const tooFast = phase === 'lose' && weeklyRateKg !== null && -weeklyRateKg > weightKg * 0.01

  const option = (
    id: CheckinOptionId,
    patch: Partial<Profile> | null,
    tdee: number,
    fixedTarget?: number,
  ): CheckinOption => {
    const next = { ...profile, ...patch }
    const loss = effectiveWeeklyLoss(next)
    const targetKcal =
      fixedTarget ?? computeTarget({ tdee, weeklyLossKg: loss, sex: profile.sex, weightKg }).targetKcal
    return { id, profilePatch: patch, estimatedTdee: tdee, targetKcal, weeklyLossKg: loss, recommended: false }
  }

  const options: CheckinOption[] = []
  if (goalReached) {
    options.push(option('maintain', { phase: 'maintain', phaseStartedAt: asOf, breakUntil: null }, estimate.tdee))
  } else if (phase === 'maintain') {
    const breakOver = profile.breakUntil != null && asOf >= profile.breakUntil
    if (breakOver && profile.weeklyLossKg > 0 && weightKg > profile.goalWeightKg) {
      options.push(option('resume', { phase: 'lose', phaseStartedAt: asOf, breakUntil: null }, estimate.tdee))
    }
  } else {
    if (weekOfPhase(profile, asOf) > BREAK_AFTER_WEEKS) {
      options.push(
        option(
          'break',
          { phase: 'maintain', phaseStartedAt: asOf, breakUntil: addDays(asOf, BREAK_DAYS) },
          estimate.tdee,
        ),
      )
    }
    const slower = slowerPace(profile.weeklyLossKg)
    const struggling =
      recent.loggedDays >= 4 && recent.avgKcal !== null && recent.avgKcal > previous.targetKcal + STRUGGLE_MARGIN
    if (struggling && slower !== null) {
      options.push(option('slower', { weeklyLossKg: slower }, estimate.tdee))
    }
  }

  const adaptive = option('adaptive', null, estimate.tdee)
  const changed = adaptive.targetKcal !== previous.targetKcal || estimate.tdee !== previous.tdee
  if (changed) options.push(adaptive)
  options.push(option('keep', null, previous.tdee, previous.targetKcal))

  options[0].recommended = true
  return {
    asOf,
    previous,
    estimate,
    trendKg,
    trendChangeKg: trendKg !== null && last.trendKg !== null ? trendKg - last.trendKg : null,
    weeklyRateKg,
    recent,
    phase,
    weekOfPhase: weekOfPhase(profile, asOf),
    goalReached,
    tooFast,
    options,
  }
}
