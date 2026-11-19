/**
 * 홈 화면의 "알아낸 것" 위젯에 보여 줄 짧은 관찰. AI를 쓰지 않고 기록만으로 계산한다.
 * 판단하거나 다그치지 않는다: 관찰을 말하고, 할 만한 작은 것 하나를 덧붙이는 정도로 쓴다.
 */
import type { DateStr, MealEntry, Profile, WeightEntry } from '../types.ts'
import { addDays, parseDate } from './date.ts'
import { effectiveWeeklyLoss, phaseOf, targetRange } from './sustain.ts'
import { computeTrend, trendAt } from './trend.ts'

export type InsightTone = 'good' | 'info' | 'gentle'

export interface Insight {
  id: string
  tone: InsightTone
  title: string
  body: string
}

/** 이보다 범위를 벗어나야 평균이 높다·낮다고 말한다(kcal). */
export const AVG_MARGIN = 150
/** 주말과 평일 평균이 이만큼 차이 나야 말한다(kcal). */
export const WEEKEND_GAP = 300
/** 체중을 이만큼 안 재면 알려 준다(일). */
export const WEIGH_GAP_DAYS = 4

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')
const fmtKg = (n: number) => (Math.round(n * 10) / 10).toFixed(1)

function dailyTotals(meals: MealEntry[]): Map<DateStr, number> {
  const m = new Map<DateStr, number>()
  for (const e of meals) m.set(e.date, (m.get(e.date) ?? 0) + e.kcal)
  return m
}

const avg = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length)

/** from부터 to까지(둘 다 포함) 날짜 목록. */
function days(from: DateStr, to: DateStr): DateStr[] {
  const out: DateStr[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

const isWeekend = (d: DateStr) => {
  const dow = parseDate(d).getDay()
  return dow === 0 || dow === 6
}

/**
 * 지금 보여 줄 만한 관찰을 중요한 순서로 최대 limit개 돌려준다.
 * 오늘은 아직 끝나지 않았으므로 섭취 평균에는 넣지 않는다.
 */
export function buildInsights(args: {
  profile: Profile
  weights: WeightEntry[]
  meals: MealEntry[]
  targetKcal: number
  asOf: DateStr
  limit?: number
}): Insight[] {
  const { profile, weights, meals, targetKcal, asOf, limit = 3 } = args
  const totals = dailyTotals(meals)
  const range = targetRange(targetKcal)
  const maintaining = phaseOf(profile) === 'maintain'
  const rangeName = maintaining ? '유지 범위' : '목표 범위'
  const out: Insight[] = []

  // ── 최근 7일 섭취(오늘 제외) ──
  const last7 = days(addDays(asOf, -7), addDays(asOf, -1))
  const logged7 = last7.filter((d) => totals.has(d)).map((d) => totals.get(d)!)
  const avg7 = avg(logged7)
  if (avg7 !== null && logged7.length >= 4) {
    if (avg7 < range.low - AVG_MARGIN) {
      out.push({
        id: 'under',
        tone: 'gentle',
        title: `최근 평균이 ${rangeName}보다 낮아요`,
        body: `기록한 ${logged7.length}일 평균 ${fmt(avg7)} kcal로, 범위 아래쪽보다 ${fmt(range.low - avg7)} kcal 적어요. 너무 적게 먹으면 오래 이어 가기 어려워요. 간식 하나를 더해도 괜찮아요.`,
      })
    } else if (avg7 > range.high + AVG_MARGIN) {
      out.push({
        id: 'over',
        tone: 'info',
        title: `최근 평균이 ${rangeName}보다 높아요`,
        body: `기록한 ${logged7.length}일 평균 ${fmt(avg7)} kcal예요. 자주 먹는 메뉴 하나를 조금 가볍게 바꾸는 정도면 충분해요.`,
      })
    } else {
      out.push({
        id: 'in-range',
        tone: 'good',
        title: `최근 평균이 ${rangeName} 근처예요`,
        body: `기록한 ${logged7.length}일 평균 ${fmt(avg7)} kcal로, 범위 ${fmt(range.low)}~${fmt(range.high)}에 가까워요. 지금처럼 이어 가면 돼요.`,
      })
    }
  }

  // ── 체중 추세 ──
  const trend = computeTrend(weights)
  const now = trendAt(trend, asOf)
  const before = trendAt(trend, addDays(asOf, -14))
  const hasRecentWeight = weights.some((w) => w.date > addDays(asOf, -14) && w.date <= asOf)
  if (now !== null && before !== null && hasRecentWeight) {
    const rate = (now - before) / 2
    const plan = effectiveWeeklyLoss(profile)
    if (maintaining) {
      if (Math.abs(rate) <= 0.15) {
        out.push({ id: 'trend-steady', tone: 'good', title: '체중이 잘 유지되고 있어요', body: `최근 2주 추세 변화가 주 ${fmtKg(Math.abs(rate))} kg 안쪽이에요.` })
      }
    } else if (rate < 0 && plan > 0) {
      const ratio = -rate / plan
      out.push(
        ratio >= 0.6
          ? { id: 'trend-on-pace', tone: 'good', title: '계획한 속도로 내려가고 있어요', body: `최근 2주 추세가 주 ${fmtKg(-rate)} kg씩 줄었어요. 계획은 주 ${fmtKg(plan)} kg이에요.` }
          : { id: 'trend-slow', tone: 'info', title: '계획보다 느리지만 내려가고 있어요', body: `최근 2주 추세가 주 ${fmtKg(-rate)} kg씩 줄었어요. 더 줄이기보다 기록을 꾸준히 이어 가면 체크인에서 목표가 알맞게 다시 맞춰져요.` },
      )
    } else if (rate > 0.1) {
      out.push({
        id: 'trend-up',
        tone: 'info',
        title: '최근 2주 추세가 조금 올랐어요',
        body: `주 ${fmtKg(rate)} kg 정도예요. 하루 체중은 수분과 소금에 따라 크게 오르내리니, 며칠 더 재 보며 추세를 봐요.`,
      })
    }
  }

  // ── 체중을 한동안 안 쟀음 ──
  const lastWeigh = weights.filter((w) => w.date <= asOf).reduce<DateStr | null>((m, w) => (m === null || w.date > m ? w.date : m), null)
  if (lastWeigh !== null) {
    const gap = Math.round((parseDate(asOf).getTime() - parseDate(lastWeigh).getTime()) / 86_400_000)
    if (gap >= WEIGH_GAP_DAYS) {
      out.push({
        id: 'weigh-gap',
        tone: 'gentle',
        title: `체중을 ${gap}일째 안 쟀어요`,
        body: '아침에 한 번 재 두면 추세가 더 정확해져요. 매일이 아니어도 괜찮아요.',
      })
    }
  }

  // ── 주말과 평일(최근 4주, 오늘 제외) ──
  const last28 = days(addDays(asOf, -28), addDays(asOf, -1))
  const weekend = last28.filter((d) => isWeekend(d) && totals.has(d)).map((d) => totals.get(d)!)
  const weekday = last28.filter((d) => !isWeekend(d) && totals.has(d)).map((d) => totals.get(d)!)
  const weekendDays = last28.filter(isWeekend).length
  const avgWe = avg(weekend)
  const avgWd = avg(weekday)
  if (avgWe !== null && avgWd !== null && weekend.length >= 3 && weekday.length >= 6 && avgWe - avgWd >= WEEKEND_GAP) {
    out.push({
      id: 'weekend-high',
      tone: 'info',
      title: '주말에 더 먹는 편이에요',
      body: `최근 4주 주말 평균이 평일보다 ${fmt(avgWe - avgWd)} kcal 많아요. 한 주 평균으로 보면 평일에 조금씩 나눠 맞출 수 있어요.`,
    })
  } else if (weekday.length >= 6 && weekend.length <= Math.floor(weekendDays / 3)) {
    out.push({
      id: 'weekend-gap',
      tone: 'gentle',
      title: '주말 기록이 자주 비어요',
      body: '주말에 한 끼만이라도 대충 기록해 두면 한 주 평균이 더 정확해져요.',
    })
  }

  // ── 꾸준함(이번 주 7일, 오늘 포함) ──
  const recorded = days(addDays(asOf, -6), asOf).filter((d) => totals.has(d) || weights.some((w) => w.date === d)).length
  if (recorded === 7) {
    out.push({ id: 'streak-7', tone: 'good', title: '7일 내내 기록했어요', body: '기록이 쌓일수록 소비 칼로리 추정이 정확해져요.' })
  }

  // 중요한 순서: 마음 써야 할 것 → 알면 좋은 것 → 잘하고 있는 것. 같은 무게면 위에서 넣은 순서.
  const rank: Record<InsightTone, number> = { gentle: 0, info: 1, good: 2 }
  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => rank[a.x.tone] - rank[b.x.tone] || a.i - b.i)
    .slice(0, limit)
    .map(({ x }) => x)
}
