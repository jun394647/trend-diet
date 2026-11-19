import { addDays, parseDate } from '../lib/date.ts'
import { currentPlan } from '../lib/plan.ts'
import { mySuggestions } from '../lib/quickAdd.ts'
import { effectiveWeeklyLoss, phaseOf, recentWeeklyRate, targetRange, weekOfPhase } from '../lib/sustain.ts'
import { computeTrend, trendAt } from '../lib/trend.ts'
import type { Checkin, DateStr, Favorite, MealEntry, Profile, WeightEntry } from '../types.ts'
import type { CoachContext } from './contract.ts'

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * AI에게 넘길 내 상황 요약을 만든다. 계획이 아직 없으면 null.
 * 이름, 이메일 같은 식별 정보는 넣지 않고, 기록은 최근 14일만 넣는다.
 */
export function buildCoachContext(args: {
  profile: Profile
  weights: WeightEntry[]
  meals: MealEntry[]
  favorites: Favorite[]
  checkins: Checkin[]
  asOf: DateStr
}): CoachContext | null {
  const { profile, weights, meals, favorites, checkins, asOf } = args
  const plan = currentPlan(checkins)
  if (!plan) return null

  const perDay = new Map<DateStr, number>()
  for (const m of meals) perDay.set(m.date, (perDay.get(m.date) ?? 0) + m.kcal)
  const weightOn = new Map(weights.map((w) => [w.date, w.kg]))
  const days = []
  for (let i = 13; i >= 0; i--) {
    const date = addDays(asOf, -i)
    days.push({ date, kcal: perDay.get(date) ?? null, weightKg: weightOn.get(date) ?? null })
  }

  const trend = trendAt(computeTrend(weights), asOf)
  const rate = recentWeeklyRate(weights, asOf)
  const range = targetRange(plan.targetKcal)
  return {
    today: asOf,
    phase: phaseOf(profile),
    weekOfPhase: weekOfPhase(profile, asOf),
    breakUntil: profile.breakUntil ?? null,
    sex: profile.sex,
    age: parseDate(asOf).getFullYear() - profile.birthYear,
    heightCm: profile.heightCm,
    startWeightKg: profile.startWeightKg,
    goalWeightKg: profile.goalWeightKg,
    weeklyLossKg: effectiveWeeklyLoss(profile),
    targetKcal: plan.targetKcal,
    targetLow: range.low,
    targetHigh: range.high,
    estimatedTdee: plan.tdee,
    trendKg: trend === null ? null : round1(trend),
    weeklyRateKg: rate === null ? null : Math.round(rate * 100) / 100,
    todayKcal: perDay.get(asOf) ?? 0,
    days,
    frequentMeals: mySuggestions({ meals, favorites }, '', 10).map((s) => ({ name: s.name, kcal: s.kcal, count: s.count })),
    todayMeals: meals
      .filter((m) => m.date === asOf)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, 30)
      .map((m) => ({ name: m.name ?? '이름 없는 식사', kcal: m.kcal })),
  }
}
