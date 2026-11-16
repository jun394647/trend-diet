import type { DateStr, WeightEntry } from '../types'
import { diffDays } from './date'

export interface TrendPoint {
  date: DateStr
  kg: number
  trend: number
}

/** 하루당 평활 계수. 작을수록 추세선이 완만하다. */
export const TREND_ALPHA = 0.1

/**
 * 지수이동평균으로 추세 체중을 계산한다.
 * 기록이 빠진 날이 있으면 그 간격만큼 계수를 키워, 매일 잰 경우와 같은 속도로 따라가게 한다.
 */
export function computeTrend(entries: WeightEntry[], alpha = TREND_ALPHA): TrendPoint[] {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date))
  const out: TrendPoint[] = []
  let prev: TrendPoint | null = null
  for (const e of sorted) {
    if (!prev) {
      prev = { date: e.date, kg: e.kg, trend: e.kg }
    } else {
      const gap = Math.max(1, diffDays(prev.date, e.date))
      const a = 1 - Math.pow(1 - alpha, gap)
      prev = { date: e.date, kg: e.kg, trend: prev.trend + a * (e.kg - prev.trend) }
    }
    out.push(prev)
  }
  return out
}

/** 해당 날짜 이전(포함) 가장 최근의 추세값. 없으면 null. */
export function trendAt(points: TrendPoint[], date: DateStr): number | null {
  let v: number | null = null
  for (const p of points) {
    if (p.date > date) break
    v = p.trend
  }
  return v
}
