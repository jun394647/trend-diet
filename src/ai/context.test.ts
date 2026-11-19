import type { Checkin, MealEntry, Profile } from '../types'
import { CoachContextSchema } from './contract'
import { buildCoachContext } from './context'

const profile: Profile = {
  heightCm: 175,
  birthYear: 1996,
  sex: 'M',
  activityFactor: 1.55,
  startWeightKg: 80,
  goalWeightKg: 72,
  weeklyLossKg: 0.5,
  createdAt: '2026-01-05T00:00:00.000Z',
}
const checkin: Checkin = { date: '2026-01-05', kind: 'initial', trendKg: 80, estimatedTdee: 2700, targetKcal: 2150, createdAt: '' }
const meal = (id: string, date: string, name: string | undefined, kcal: number): MealEntry => ({
  id,
  date,
  name,
  kcal,
  source: 'exact',
  createdAt: `${date}T12:00:00.000Z`,
})

describe('buildCoachContext', () => {
  const args = {
    profile,
    weights: [
      { date: '2026-01-05', kg: 80 },
      { date: '2026-01-19', kg: 79 },
    ],
    meals: [meal('a', '2026-01-18', '점심', 700), meal('b', '2026-01-19', '점심', 650), meal('c', '2026-01-19', undefined, 300)],
    favorites: [],
    checkins: [checkin],
    asOf: '2026-01-19',
  }

  it('계약에 맞는 요약을 만든다', () => {
    const ctx = buildCoachContext(args)!
    expect(() => CoachContextSchema.parse(ctx)).not.toThrow()
    expect(ctx).toMatchObject({
      today: '2026-01-19',
      phase: 'lose',
      weekOfPhase: 3,
      age: 30,
      targetKcal: 2150,
      targetLow: 2050,
      targetHigh: 2250,
      estimatedTdee: 2700,
      todayKcal: 950,
      weeklyLossKg: 0.5,
    })
  })

  it('최근 14일을 오래된 날부터 넣고, 기록 없는 날은 null로 둔다', () => {
    const ctx = buildCoachContext(args)!
    expect(ctx.days).toHaveLength(14)
    expect(ctx.days[0]).toEqual({ date: '2026-01-06', kcal: null, weightKg: null })
    expect(ctx.days[12]).toEqual({ date: '2026-01-18', kcal: 700, weightKg: null })
    expect(ctx.days[13]).toEqual({ date: '2026-01-19', kcal: 950, weightKg: 79 })
  })

  it('오늘 먹은 것과 자주 먹는 것을 넣는다', () => {
    const ctx = buildCoachContext(args)!
    expect(ctx.todayMeals).toEqual([
      { name: '점심', kcal: 650 },
      { name: '이름 없는 식사', kcal: 300 },
    ])
    expect(ctx.frequentMeals[0]).toMatchObject({ name: '점심', count: 2 })
  })

  it('유지 기간에는 적용 감량 속도가 0이다', () => {
    const ctx = buildCoachContext({ ...args, profile: { ...profile, phase: 'maintain', breakUntil: '2026-02-01' } })!
    expect(ctx).toMatchObject({ phase: 'maintain', weeklyLossKg: 0, breakUntil: '2026-02-01' })
  })

  it('계획이 없으면 만들지 않는다', () => {
    expect(buildCoachContext({ ...args, checkins: [] })).toBeNull()
  })
})
