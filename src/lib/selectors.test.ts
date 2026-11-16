import type { Checkin, MealEntry } from '../types'
import { isBackupDue, isCheckinDue, kcalOn, roughKcal, streak } from './selectors'

const meal = (date: string, kcal: number): MealEntry => ({
  id: `${date}-${kcal}`,
  date,
  kcal,
  source: 'exact',
  createdAt: `${date}T00:00:00.000Z`,
})
const checkin = (date: string): Checkin => ({
  date,
  kind: 'weekly',
  trendKg: 80,
  estimatedTdee: 2400,
  targetKcal: 1900,
  createdAt: '',
})

it('roughKcal은 목표의 비율을 10 단위로 준다', () => {
  expect(roughKcal('small', 1850)).toBe(370)
  expect(roughKcal('medium', 1850)).toBe(560)
  expect(roughKcal('large', 1850)).toBe(830)
})

it('kcalOn은 해당 날짜만 합산한다', () => {
  expect(kcalOn([meal('2026-01-01', 300), meal('2026-01-01', 500), meal('2026-01-02', 900)], '2026-01-01')).toBe(800)
})

describe('streak', () => {
  it('오늘 기록이 있으면 오늘부터 센다', () => {
    const meals = [meal('2026-01-03', 1), meal('2026-01-02', 1)]
    expect(streak([{ date: '2026-01-01', kg: 80 }], meals, '2026-01-03')).toBe(3)
  })
  it('오늘 기록이 없으면 어제까지의 연속 일수', () => {
    expect(streak([], [meal('2026-01-02', 1), meal('2026-01-01', 1)], '2026-01-03')).toBe(2)
  })
  it('끊기면 0', () => {
    expect(streak([], [meal('2026-01-01', 1)], '2026-01-03')).toBe(0)
  })
})

describe('isCheckinDue', () => {
  it('마지막 체크인 후 7일이 지나면 true', () => {
    expect(isCheckinDue([checkin('2026-01-01')], '2026-01-07')).toBe(false)
    expect(isCheckinDue([checkin('2026-01-01')], '2026-01-08')).toBe(true)
  })
  it('체크인이 없으면 false', () => {
    expect(isCheckinDue([], '2026-01-08')).toBe(false)
  })
  it('가장 최근 체크인 기준으로 본다', () => {
    expect(isCheckinDue([checkin('2026-01-08'), checkin('2026-01-01')], '2026-01-10')).toBe(false)
  })
})

describe('isBackupDue', () => {
  const now = new Date('2026-01-10T00:00:00Z')
  it('데이터가 없으면 알리지 않는다', () => {
    expect(isBackupDue(null, false, now)).toBe(false)
  })
  it('백업한 적이 없으면 알린다', () => {
    expect(isBackupDue(null, true, now)).toBe(true)
  })
  it('7일이 지나면 알린다', () => {
    expect(isBackupDue('2026-01-04T00:00:00Z', true, now)).toBe(false)
    expect(isBackupDue('2026-01-03T00:00:00Z', true, now)).toBe(true)
  })
})
