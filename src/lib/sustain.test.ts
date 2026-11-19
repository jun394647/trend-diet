import type { Checkin, MealEntry, Profile, WeightEntry } from '../types'
import { addDays } from './date'
import {
  buildCheckinReview,
  effectiveWeeklyLoss,
  intakeState,
  phaseOf,
  progress,
  recentWeeklyRate,
  slowerPace,
  targetRange,
  weekOfPhase,
  weekStart,
  weekSummary,
} from './sustain'

const meal = (date: string, kcal: number, i = 0): MealEntry => ({
  id: `${date}-${i}`,
  date,
  kcal,
  source: 'exact',
  createdAt: `${date}T12:00:00.000Z`,
})

const base: Profile = {
  heightCm: 175,
  birthYear: 1995,
  sex: 'M',
  activityFactor: 1.55,
  startWeightKg: 80,
  goalWeightKg: 72,
  weeklyLossKg: 0.5,
  createdAt: '2026-01-05T00:00:00.000Z',
}

const checkin = (date: string, targetKcal = 2000, tdee = 2550, trendKg = 80): Checkin => ({
  date,
  kind: 'weekly',
  trendKg,
  estimatedTdee: tdee,
  targetKcal,
  createdAt: '',
})

/** start부터 days일 동안 매일 kcal을 먹고 체중이 하루 kgPerDay씩 변하는 기록. */
function series(start: string, days: number, kcal: number, startKg: number, kgPerDay: number) {
  const weights: WeightEntry[] = []
  const meals: MealEntry[] = []
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i)
    weights.push({ date: d, kg: startKg + kgPerDay * i })
    meals.push(meal(d, kcal))
  }
  return { weights, meals, last: addDays(start, days - 1) }
}

describe('목표 범위', () => {
  it('목표 위아래 100kcal까지는 범위 안이다', () => {
    expect(targetRange(2000)).toEqual({ low: 1900, high: 2100 })
    expect(intakeState(1900, 2000)).toBe('in')
    expect(intakeState(2100, 2000)).toBe('in')
    expect(intakeState(2101, 2000)).toBe('over')
    expect(intakeState(1899, 2000)).toBe('under')
  })
})

describe('주간 요약', () => {
  it('한 주는 월요일에 시작한다', () => {
    expect(weekStart('2026-01-05')).toBe('2026-01-05') // 월
    expect(weekStart('2026-01-08')).toBe('2026-01-05') // 목
    expect(weekStart('2026-01-11')).toBe('2026-01-05') // 일
  })

  it('하루를 넘겨도 한 주 평균이 범위 안이면 범위 안으로 본다', () => {
    const s = weekSummary({
      meals: [meal('2026-01-05', 1900), meal('2026-01-06', 2500), meal('2026-01-07', 1750)],
      weights: [{ date: '2026-01-08', kg: 80 }],
      targetKcal: 2000,
      asOf: '2026-01-08',
    })
    expect(s.days.map((d) => d.state)).toEqual(['in', 'over', 'under', 'none', 'future', 'future', 'future'])
    expect(s.avgKcal).toBe(2050)
    expect(s.avgState).toBe('in')
    expect(s.mealDays).toBe(3)
    expect(s.recordedDays).toBe(4)
  })

  it('기록하지 않은 날은 평균에서 빼고, 기록이 없으면 평균도 없다', () => {
    const s = weekSummary({ meals: [meal('2026-01-01', 3000)], weights: [], targetKcal: 2000, asOf: '2026-01-08' })
    expect(s.avgKcal).toBeNull()
    expect(s.avgState).toBe('none')
  })

  it('아직 다 먹지 않은 오늘은 평균에서 뺀다', () => {
    const args = {
      meals: [meal('2026-01-05', 2000), meal('2026-01-06', 2100), meal('2026-01-07', 600)],
      weights: [],
      targetKcal: 2000,
      asOf: '2026-01-07',
    }
    expect(weekSummary(args).avgKcal).toBe(1567)
    const s = weekSummary({ ...args, inProgress: '2026-01-07' })
    expect(s.avgKcal).toBe(2050)
    expect(s.avgDays).toBe(2)
    expect(s.mealDays).toBe(3)
    // 오늘이 이미 범위에 들었으면 평균에 넣는다.
    const full = weekSummary({ ...args, meals: [...args.meals, meal('2026-01-07', 1400, 1)], inProgress: '2026-01-07' })
    expect(full.avgDays).toBe(3)
    // 오늘 기록뿐이면 그대로 쓴다.
    const only = weekSummary({ ...args, meals: [meal('2026-01-07', 600)], inProgress: '2026-01-07' })
    expect(only.avgKcal).toBe(600)
  })

  it('하루에 여러 끼는 합산한다', () => {
    const s = weekSummary({
      meals: [meal('2026-01-05', 900, 0), meal('2026-01-05', 1100, 1)],
      weights: [],
      targetKcal: 2000,
      asOf: '2026-01-05',
    })
    expect(s.days[0].kcal).toBe(2000)
  })
})

describe('단계', () => {
  it('단계 정보가 없는 예전 프로필은 감량 속도로 단계를 정한다', () => {
    expect(phaseOf(base)).toBe('lose')
    expect(phaseOf({ ...base, weeklyLossKg: 0 })).toBe('maintain')
  })

  it('유지 기간에는 감량 속도를 적용하지 않는다', () => {
    expect(effectiveWeeklyLoss(base)).toBe(0.5)
    expect(effectiveWeeklyLoss({ ...base, phase: 'maintain' })).toBe(0)
  })

  it('몇 주째인지는 단계를 시작한 날부터 센다', () => {
    expect(weekOfPhase(base, '2026-01-05')).toBe(1)
    expect(weekOfPhase(base, '2026-01-11')).toBe(1)
    expect(weekOfPhase(base, '2026-01-12')).toBe(2)
    expect(weekOfPhase({ ...base, phaseStartedAt: '2026-03-02' }, '2026-03-09')).toBe(2)
  })

  it('한 단계 느린 속도를 찾는다', () => {
    expect(slowerPace(0.75)).toBe(0.5)
    expect(slowerPace(0.5)).toBe(0.25)
    expect(slowerPace(0.25)).toBeNull()
  })
})

describe('진행 상황', () => {
  it('뺀 양, 남은 양, 다음 1kg 단계를 알려 준다', () => {
    const p = progress({ startKg: 80, goalKg: 72, trendKg: 78.3 })
    expect(p.lostKg).toBeCloseTo(1.7, 10)
    expect(p.remainingKg).toBeCloseTo(6.3, 10)
    expect(p.ratio).toBeCloseTo(1.7 / 8, 10)
    expect(p.nextStepKg).toBe(78)
  })
  it('딱 떨어지는 체중이면 그 아래 1kg이 다음 단계다', () => {
    expect(progress({ startKg: 80, goalKg: 72, trendKg: 78 }).nextStepKg).toBe(77)
  })
  it('다음 단계는 목표보다 낮아지지 않는다', () => {
    expect(progress({ startKg: 80, goalKg: 72.5, trendKg: 72.8 }).nextStepKg).toBe(72.5)
  })
  it('목표에 닿으면 다음 단계가 없다', () => {
    const p = progress({ startKg: 80, goalKg: 72, trendKg: 71.9 })
    expect(p.nextStepKg).toBeNull()
    expect(p.ratio).toBe(1)
  })
  it('시작보다 늘었으면 진행은 0이다', () => {
    expect(progress({ startKg: 80, goalKg: 72, trendKg: 81 }).ratio).toBe(0)
  })
})

it('최근 2주 추세로 주당 변화를 구한다', () => {
  const { weights, last } = series('2026-01-05', 120, 2000, 90, -0.1)
  expect(recentWeeklyRate(weights, last)).toBeCloseTo(-0.7, 1)
  expect(recentWeeklyRate([{ date: '2026-01-05', kg: 80 }], '2026-01-06')).toBeNull()
})

describe('체크인 선택지', () => {
  const ids = (r: ReturnType<typeof buildCheckinReview>) => r!.options.map((o) => o.id)

  it('기록이 부족하고 달라질 게 없으면 그대로 두는 선택지만 있다', () => {
    const r = buildCheckinReview({
      profile: base,
      weights: [{ date: '2026-01-05', kg: 80 }],
      meals: [],
      checkins: [checkin('2026-01-05', 2000)],
      asOf: '2026-01-12',
    })!
    expect(r.estimate.basis).toBe('insufficient')
    // 추정치는 그대로지만 체중 기준 목표 계산은 다시 하므로 keep은 항상 마지막에 있다.
    expect(r.options[r.options.length - 1]).toMatchObject({ id: 'keep', targetKcal: 2000, estimatedTdee: 2550 })
  })

  it('기록이 충분하면 새 추정치에 맞춘 선택지를 먼저 권한다', () => {
    const { weights, meals, last } = series('2026-01-05', 30, 2000, 80, 0)
    const r = buildCheckinReview({ profile: base, weights, meals, checkins: [checkin('2026-01-05', 2000, 2550)], asOf: last })!
    expect(ids(r)).toEqual(['adaptive', 'keep'])
    expect(r.options[0].recommended).toBe(true)
    expect(r.options[0].estimatedTdee).toBeLessThan(2550)
    expect(r.options[1]).toMatchObject({ targetKcal: 2000, estimatedTdee: 2550, recommended: false })
  })

  it('최근 섭취가 목표를 크게 넘으면 속도를 늦추는 선택지를 먼저 권한다', () => {
    const { weights, meals, last } = series('2026-01-05', 30, 2400, 80, 0)
    const r = buildCheckinReview({ profile: base, weights, meals, checkins: [checkin('2026-01-05', 2000, 2550)], asOf: last })!
    expect(ids(r)[0]).toBe('slower')
    const slower = r.options[0]
    const adaptive = r.options.find((o) => o.id === 'adaptive')!
    expect(slower.profilePatch).toEqual({ weeklyLossKg: 0.25 })
    expect(slower.weeklyLossKg).toBe(0.25)
    expect(slower.targetKcal).toBeGreaterThan(adaptive.targetKcal)
  })

  it('가장 느린 속도에서는 더 늦추라고 하지 않는다', () => {
    const { weights, meals, last } = series('2026-01-05', 30, 2600, 80, 0)
    const r = buildCheckinReview({
      profile: { ...base, weeklyLossKg: 0.25 },
      weights,
      meals,
      checkins: [checkin('2026-01-05', 2000, 2550)],
      asOf: last,
    })!
    expect(ids(r)).not.toContain('slower')
  })

  it('감량이 10주를 넘으면 2주 유지 기간을 먼저 권한다', () => {
    const { weights, meals, last } = series('2026-01-05', 78, 2000, 80, -0.02)
    const r = buildCheckinReview({ profile: base, weights, meals, checkins: [checkin(addDays(last, -7), 2000, 2550)], asOf: last })!
    expect(r.weekOfPhase).toBe(12)
    expect(ids(r)[0]).toBe('break')
    const brk = r.options[0]
    expect(brk.profilePatch).toEqual({ phase: 'maintain', phaseStartedAt: last, breakUntil: addDays(last, 14) })
    expect(brk.weeklyLossKg).toBe(0)
    // 유지 기간의 목표는 추정 소비 칼로리와 같다(10 단위 반올림).
    expect(Math.abs(brk.targetKcal - brk.estimatedTdee)).toBeLessThanOrEqual(5)
  })

  it('유지 기간이 끝나면 감량을 다시 시작하는 선택지를 권한다', () => {
    const { weights, meals, last } = series('2026-03-02', 15, 2500, 78, 0)
    const profile: Profile = { ...base, phase: 'maintain', phaseStartedAt: '2026-03-02', breakUntil: '2026-03-16' }
    const r = buildCheckinReview({ profile, weights, meals, checkins: [checkin('2026-03-09', 2550, 2550, 78)], asOf: last })!
    expect(last).toBe('2026-03-16')
    expect(ids(r)[0]).toBe('resume')
    expect(r.options[0].profilePatch).toEqual({ phase: 'lose', phaseStartedAt: last, breakUntil: null })
    expect(r.options[0].targetKcal).toBeLessThan(r.options[0].estimatedTdee)
  })

  it('유지 기간이 아직 남았으면 다시 시작하라고 하지 않는다', () => {
    const { weights, meals, last } = series('2026-03-02', 8, 2500, 78, 0)
    const profile: Profile = { ...base, phase: 'maintain', phaseStartedAt: '2026-03-02', breakUntil: '2026-03-16' }
    const r = buildCheckinReview({ profile, weights, meals, checkins: [checkin('2026-03-02', 2550, 2550, 78)], asOf: last })!
    expect(ids(r)).not.toContain('resume')
  })

  it('추세 체중이 목표에 닿으면 유지로 넘어가는 선택지를 권한다', () => {
    const { weights, meals, last } = series('2026-01-05', 30, 2000, 71.5, 0)
    const r = buildCheckinReview({ profile: base, weights, meals, checkins: [checkin('2026-01-05', 2000, 2550, 72.5)], asOf: last })!
    expect(r.goalReached).toBe(true)
    expect(ids(r)[0]).toBe('maintain')
    expect(r.options[0].profilePatch).toMatchObject({ phase: 'maintain', breakUntil: null })
    expect(ids(r)).not.toContain('break')
    expect(ids(r)).not.toContain('slower')
  })

  it('체중의 주당 1%보다 빨리 빠지면 알려 준다', () => {
    const { weights, meals, last } = series('2026-01-05', 120, 1500, 95, -0.15)
    const r = buildCheckinReview({ profile: base, weights, meals, checkins: [checkin(addDays(last, -7), 1900, 2500)], asOf: last })!
    expect(r.tooFast).toBe(true)
  })

  it('체크인 기록이 없으면 만들지 않는다', () => {
    expect(buildCheckinReview({ profile: base, weights: [], meals: [], checkins: [], asOf: '2026-01-12' })).toBeNull()
  })
})
