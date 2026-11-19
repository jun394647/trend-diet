import type { MealEntry, Profile, WeightEntry } from '../types'
import { addDays } from './date'
import { buildInsights } from './insights'

const base: Profile = {
  heightCm: 175,
  birthYear: 1995,
  sex: 'M',
  activityFactor: 1.55,
  startWeightKg: 80,
  goalWeightKg: 72,
  weeklyLossKg: 0.5,
  createdAt: '2026-01-01T00:00:00.000Z',
}
const ASOF = '2026-03-04' // 수요일
const meal = (date: string, kcal: number, i = 0): MealEntry => ({ id: `${date}-${i}`, date, kcal, source: 'exact', createdAt: `${date}T12:00:00.000Z` })
/** asOf 전날부터 n일 동안 매일 kcal을 먹은 기록. */
const eatDays = (n: number, kcal: number | ((d: string) => number | null)) => {
  const out: MealEntry[] = []
  for (let i = 1; i <= n; i++) {
    const d = addDays(ASOF, -i)
    const k = typeof kcal === 'function' ? kcal(d) : kcal
    if (k !== null) out.push(meal(d, k))
  }
  return out
}
/** asOf까지 n일 동안 하루 perDay씩 변하는 체중. */
const weighDays = (n: number, startKg: number, perDay: number): WeightEntry[] =>
  Array.from({ length: n }, (_, i) => ({ date: addDays(ASOF, -(n - 1 - i)), kg: startKg + perDay * i }))
const ids = (args: Parameters<typeof buildInsights>[0]) => buildInsights(args).map((x) => x.id)
const run = (over: Partial<Parameters<typeof buildInsights>[0]>) =>
  ids({ profile: base, weights: [], meals: [], targetKcal: 2000, asOf: ASOF, limit: 10, ...over })

describe('buildInsights', () => {
  it('기록이 없으면 아무것도 말하지 않는다', () => {
    expect(run({})).toEqual([])
  })

  it('최근 7일 평균을 범위와 비교한다(오늘은 빼고, 4일 이상 기록했을 때만)', () => {
    expect(run({ meals: eatDays(7, 2000) })).toContain('in-range')
    expect(run({ meals: eatDays(7, 1500) })).toContain('under')
    expect(run({ meals: eatDays(7, 2400) })).toContain('over')
    expect(run({ meals: eatDays(3, 1500) })).toEqual([])
    // 오늘 아직 적게 먹은 것은 평균에 넣지 않는다.
    expect(run({ meals: [...eatDays(7, 2000), meal(ASOF, 300)] })).toContain('in-range')
  })

  it('낮을 때의 문장은 더 줄이라고 하지 않는다', () => {
    const [x] = buildInsights({ profile: base, weights: [], meals: eatDays(7, 1500), targetKcal: 2000, asOf: ASOF })
    expect(x.body).toContain('오래 이어 가기 어려워요')
    expect(x.body).not.toMatch(/줄이|덜 /)
  })

  it('체중 추세가 계획대로면 칭찬하고, 느리면 더 줄이라는 대신 기록을 권한다', () => {
    expect(run({ weights: weighDays(30, 80, -0.08) })).toContain('trend-on-pace')
    const slow = buildInsights({ profile: base, weights: weighDays(30, 80, -0.02), meals: [], targetKcal: 2000, asOf: ASOF, limit: 10 })
    expect(slow.map((x) => x.id)).toContain('trend-slow')
    expect(slow.find((x) => x.id === 'trend-slow')!.body).toContain('더 줄이기보다')
    expect(run({ weights: weighDays(30, 80, 0.03) })).toContain('trend-up')
  })

  it('유지 기간에는 감량 속도 대신 유지되는지를 본다', () => {
    const r = run({ profile: { ...base, phase: 'maintain' }, weights: weighDays(30, 76, 0) })
    expect(r).toContain('trend-steady')
    expect(r).not.toContain('trend-slow')
  })

  it('체중을 4일 이상 안 쟀으면 알려 준다', () => {
    const w = weighDays(20, 80, -0.05).filter((x) => x.date <= addDays(ASOF, -5))
    expect(run({ weights: w })).toContain('weigh-gap')
    expect(run({ weights: weighDays(20, 80, -0.05) })).not.toContain('weigh-gap')
  })

  it('주말에 많이 먹는 흐름과 주말 기록 공백을 구분한다', () => {
    const isWe = (d: string) => [0, 6].includes(new Date(d + 'T00:00:00').getDay())
    expect(run({ meals: eatDays(28, (d) => (isWe(d) ? 2600 : 1900)) })).toContain('weekend-high')
    expect(run({ meals: eatDays(28, (d) => (isWe(d) ? null : 2000)) })).toContain('weekend-gap')
  })

  it('7일 내내 기록했으면 알려 준다', () => {
    expect(run({ meals: [...eatDays(6, 2000), meal(ASOF, 500)] })).toContain('streak-7')
  })

  it('마음 써야 할 것을 먼저, 최대 limit개만 준다', () => {
    const r = buildInsights({
      profile: base,
      weights: weighDays(20, 80, -0.08).filter((x) => x.date <= addDays(ASOF, -5)),
      meals: eatDays(7, 1500),
      targetKcal: 2000,
      asOf: ASOF,
    })
    expect(r.length).toBeLessThanOrEqual(3)
    expect(r[0].tone).toBe('gentle')
    expect(r.map((x) => x.tone)).toEqual([...r.map((x) => x.tone)].sort((a, b) => ['gentle', 'info', 'good'].indexOf(a) - ['gentle', 'info', 'good'].indexOf(b)))
  })
})
