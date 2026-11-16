import type { MealEntry, WeightEntry } from '../types'
import { addDays } from './date'
import { bmr, computeTarget, estimateTdee, projectGoalDate } from './tdee'

const meal = (date: string, kcal: number, i = 0): MealEntry => ({
  id: `${date}-${i}`,
  date,
  kcal,
  source: 'exact',
  createdAt: `${date}T12:00:00.000Z`,
})

/** start부터 days일 동안 매일 dailyKcal을 먹고 체중이 하루 kgPerDay씩 변하는 기록을 만든다. */
function series(start: string, days: number, dailyKcal: number, startKg: number, kgPerDay: number) {
  const weights: WeightEntry[] = []
  const meals: MealEntry[] = []
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i)
    weights.push({ date: d, kg: startKg + kgPerDay * i })
    meals.push(meal(d, dailyKcal))
  }
  return { weights, meals, last: addDays(start, days - 1) }
}

describe('bmr', () => {
  it('Mifflin-St Jeor 공식과 일치한다', () => {
    expect(bmr('M', 80, 180, 30)).toBe(10 * 80 + 6.25 * 180 - 5 * 30 + 5)
    expect(bmr('F', 60, 165, 30)).toBe(10 * 60 + 6.25 * 165 - 5 * 30 - 161)
  })
})

describe('estimateTdee', () => {
  it('기록이 부족하면 이전 값을 유지한다', () => {
    const { weights, meals, last } = series('2026-01-01', 5, 2000, 80, 0)
    const r = estimateTdee({ weights, meals, prevTdee: 2400, asOf: last })
    expect(r.basis).toBe('insufficient')
    expect(r.tdee).toBe(2400)
    expect(r.loggedDays).toBe(5)
  })

  it('체중이 그대로면 섭취량 쪽으로 30%만 이동한다', () => {
    const { weights, meals, last } = series('2026-01-01', 30, 2000, 80, 0)
    const r = estimateTdee({ weights, meals, prevTdee: 2400, asOf: last })
    expect(r.basis).toBe('adaptive')
    expect(r.tdee).toBe(Math.round(0.7 * 2400 + 0.3 * 2000))
  })

  it('체중이 줄고 있으면 섭취량보다 높게 추정한다', () => {
    // 오래 지속된 일정한 감량이면 추세선 기울기도 하루 -0.1kg에 수렴한다.
    const { weights, meals, last } = series('2026-01-01', 120, 2000, 90, -0.1)
    const r = estimateTdee({ weights, meals, prevTdee: 2000, asOf: last })
    const raw = (r.tdee - 0.7 * 2000) / 0.3
    expect(raw).toBeGreaterThan(2700)
    expect(raw).toBeLessThan(2800)
  })

  it('식사 기록이 없는 날은 평균에서 제외한다', () => {
    const { weights, meals, last } = series('2026-01-01', 30, 2000, 80, 0)
    const sparse = meals.filter((_, i) => i % 2 === 0)
    const r = estimateTdee({ weights, meals: sparse, prevTdee: 2000, asOf: last })
    expect(r.avgIntake).toBe(2000)
    expect(r.tdee).toBe(2000)
  })

  it('하루에 여러 끼를 기록하면 합산한다', () => {
    const { weights, meals, last } = series('2026-01-01', 30, 1000, 80, 0)
    const doubled = [...meals, ...meals.map((m) => ({ ...m, id: `${m.id}-b` }))]
    const r = estimateTdee({ weights, meals: doubled, prevTdee: 2000, asOf: last })
    expect(r.avgIntake).toBe(2000)
  })

  it('기준일 이후의 기록은 쓰지 않는다', () => {
    const { weights, meals } = series('2026-01-01', 30, 2000, 80, 0)
    const r = estimateTdee({ weights, meals, prevTdee: 2400, asOf: '2026-01-05' })
    expect(r.loggedDays).toBe(5)
    expect(r.basis).toBe('insufficient')
  })

  it('비현실적인 값은 범위 안으로 자른다', () => {
    const { weights, meals, last } = series('2026-01-01', 30, 20000, 80, 0)
    const r = estimateTdee({ weights, meals, prevTdee: 2000, asOf: last })
    expect(r.tdee).toBe(Math.round(0.7 * 2000 + 0.3 * 6000))
  })
})

describe('computeTarget', () => {
  it('주당 0.5kg 감량이면 하루 550kcal를 뺀다', () => {
    const r = computeTarget({ tdee: 2500, weeklyLossKg: 0.5, sex: 'M', weightKg: 80 })
    expect(r.targetKcal).toBe(1950)
    expect(r.lossCapped).toBe(false)
    expect(r.flooredAtMin).toBe(false)
  })

  it('감량 속도는 체중의 1%를 넘지 않는다', () => {
    const r = computeTarget({ tdee: 3000, weeklyLossKg: 1.5, sex: 'M', weightKg: 80 })
    expect(r.appliedWeeklyLossKg).toBeCloseTo(0.8, 10)
    expect(r.lossCapped).toBe(true)
    expect(r.targetKcal).toBe(2120)
  })

  it('하한선 아래로 내려가지 않는다', () => {
    const f = computeTarget({ tdee: 1500, weeklyLossKg: 0.5, sex: 'F', weightKg: 55 })
    expect(f.targetKcal).toBe(1200)
    expect(f.flooredAtMin).toBe(true)
    const m = computeTarget({ tdee: 1800, weeklyLossKg: 0.7, sex: 'M', weightKg: 75 })
    expect(m.targetKcal).toBe(1500)
  })

  it('유지 목표면 소비 칼로리와 같다', () => {
    expect(computeTarget({ tdee: 2234, weeklyLossKg: 0, sex: 'F', weightKg: 60 }).targetKcal).toBe(2230)
  })
})

describe('projectGoalDate', () => {
  it('남은 체중과 속도로 날짜를 계산한다', () => {
    expect(projectGoalDate({ trendKg: 80, goalKg: 78, weeklyLossKg: 0.5, from: '2026-01-01' })).toBe(
      '2026-01-29',
    )
  })
  it('이미 도달했으면 오늘', () => {
    expect(projectGoalDate({ trendKg: 70, goalKg: 70, weeklyLossKg: 0.5, from: '2026-01-01' })).toBe(
      '2026-01-01',
    )
  })
  it('유지 목표면 계산하지 않는다', () => {
    expect(projectGoalDate({ trendKg: 80, goalKg: 70, weeklyLossKg: 0, from: '2026-01-01' })).toBeNull()
  })
})
