import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import IntakeChart from '../components/IntakeChart'
import type { IntakeDatum } from '../components/IntakeChart'
import WeightChart from '../components/WeightChart'
import { addDays, diffDays, formatKorean, formatShort, parseDate, today } from '../lib/date'
import { currentPlan } from '../lib/plan'
import { CHECKIN_INTERVAL_DAYS, isCheckinDue, latestCheckin } from '../lib/selectors'
import { projectGoalDate } from '../lib/tdee'
import { computeTrend } from '../lib/trend'
import { useStore } from '../store'
import './Trend.css'

const RANGES = [
  { key: '2w', label: '2주', days: 14, phrase: '최근 2주' },
  { key: '1m', label: '1개월', days: 30, phrase: '최근 1개월' },
  { key: '3m', label: '3개월', days: 90, phrase: '최근 3개월' },
  { key: 'all', label: '전체', days: null, phrase: '전체 기간' },
] as const
type RangeKey = (typeof RANGES)[number]['key']

/** 부호를 붙인 숫자. 반올림해서 0이면 부호 없이 돌려준다. */
function signed(n: number, digits: number): string {
  const abs = Math.abs(n).toFixed(digits)
  if (Number(abs) === 0) return abs
  return `${n > 0 ? '+' : '−'}${abs}`
}

function monthDay(date: string, asOf: string): string {
  const d = parseDate(date)
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일`
  return d.getFullYear() === parseDate(asOf).getFullYear() ? md : `${d.getFullYear()}년 ${md}`
}

export default function Trend() {
  const profile = useStore((s) => s.profile)
  const weights = useStore((s) => s.weights)
  const meals = useStore((s) => s.meals)
  const checkins = useStore((s) => s.checkins)
  const [rangeKey, setRangeKey] = useState<RangeKey>('1m')

  const asOf = today()
  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[1]
  const goalKg = profile?.goalWeightKg

  const allPoints = useMemo(() => computeTrend(weights), [weights])
  const current = allPoints.length > 0 ? allPoints[allPoints.length - 1] : null

  const from = useMemo(() => {
    if (range.days !== null) return addDays(asOf, -(range.days - 1))
    let first = asOf
    for (const w of weights) if (w.date < first) first = w.date
    for (const m of meals) if (m.date < first) first = m.date
    return first
  }, [range.days, asOf, weights, meals])

  const visible = useMemo(() => allPoints.filter((p) => p.date >= from), [allPoints, from])

  const change = useMemo(() => {
    if (visible.length < 2) return null
    const first = visible[0]
    const last = visible[visible.length - 1]
    const span = diffDays(first.date, last.date)
    if (span <= 0) return null
    const delta = last.trend - first.trend
    return { first, last, delta, perWeek: (delta / span) * 7 }
  }, [visible])

  const intake = useMemo(() => {
    const perDay = new Map<string, number>()
    for (const m of meals) {
      if (m.date < from || m.date > asOf) continue
      perDay.set(m.date, (perDay.get(m.date) ?? 0) + m.kcal)
    }
    const data: IntakeDatum[] = []
    const n = diffDays(from, asOf)
    for (let i = 0; i <= n; i++) {
      const date = addDays(from, i)
      data.push({ date, kcal: perDay.get(date) ?? null })
    }
    let sum = 0
    for (const v of perDay.values()) sum += v
    return { data, loggedDays: perDay.size, avg: perDay.size > 0 ? Math.round(sum / perDay.size) : null }
  }, [meals, from, asOf])

  const plan = useMemo(() => currentPlan(checkins), [checkins])
  const last = useMemo(() => latestCheckin(checkins), [checkins])
  const due = isCheckinDue(checkins, asOf)
  const daysLeft = last ? CHECKIN_INTERVAL_DAYS - diffDays(last.date, asOf) : null

  const remaining = current && goalKg !== undefined ? current.trend - goalKg : null
  const reached = remaining !== null && remaining <= 0
  const weeklyLossKg = profile?.weeklyLossKg ?? 0
  const projected =
    current && goalKg !== undefined && !reached && weeklyLossKg > 0
      ? projectGoalDate({ trendKg: current.trend, goalKg, weeklyLossKg, from: asOf })
      : null

  // 목표 방향으로 움직였을 때만 색으로 강조한다. 감량 자체를 빨갛게 표시하지 않는다.
  const towardGoal =
    change !== null &&
    goalKg !== undefined &&
    Math.abs(change.delta) >= 0.05 &&
    (goalKg - change.first.trend) * change.delta > 0

  const caption = change
    ? `${range.phrase}(${formatShort(change.first.date)}~${formatShort(change.last.date)}) 동안 추세 체중이 ${change.first.trend.toFixed(1)}kg에서 ${change.last.trend.toFixed(1)}kg으로 ${
        Math.abs(change.delta) < 0.05
          ? '거의 변하지 않았어요'
          : `${Math.abs(change.delta).toFixed(1)}kg ${change.delta < 0 ? '줄었어요' : '늘었어요'}`
      }.`
    : null

  return (
    <main className="page trend-page">
      <h1 className="page-title">추세</h1>

      <div className="segmented" role="group" aria-label="기간 선택">
        {RANGES.map((r) => (
          <button key={r.key} type="button" aria-pressed={r.key === rangeKey} onClick={() => setRangeKey(r.key)}>
            {r.label}
          </button>
        ))}
      </div>

      <section className="card" aria-labelledby="trend-summary-title">
        <h2 className="card-title" id="trend-summary-title">
          현재 추세 체중
        </h2>
        {current ? (
          <>
            <p className="big-num">
              <span data-testid="trend-current">{current.trend.toFixed(1)}</span>
              <span className="trend-unit">kg</span>
            </p>
            <p className="small muted trend-hint">하루하루의 오르내림을 걸러 낸 실제 체중 흐름이에요.</p>
            <ul className="list trend-stats">
              <li>
                <span className="muted">{range.phrase} 변화</span>
                {change ? (
                  <span className={`num trend-stat-value${towardGoal ? ' trend-good' : ''}`}>
                    {signed(change.delta, 1)}kg
                  </span>
                ) : (
                  <span className="muted small">기록이 더 필요해요</span>
                )}
              </li>
              <li>
                <span className="muted">주간 속도</span>
                {change ? (
                  <span className="num trend-stat-value">{signed(change.perWeek, 2)}kg/주</span>
                ) : (
                  <span className="muted small">기록이 더 필요해요</span>
                )}
              </li>
              {remaining !== null && goalKg !== undefined && (
                <li>
                  <span className="muted">
                    목표 <span className="num">{goalKg.toFixed(1)}</span>kg까지
                  </span>
                  {reached ? (
                    <span className="trend-stat-value trend-good">도달했어요</span>
                  ) : (
                    <span className="num trend-stat-value">{remaining.toFixed(1)}kg 남음</span>
                  )}
                </li>
              )}
            </ul>
            {reached && <p className="small muted trend-projection">추세 체중이 목표 체중에 도달했어요.</p>}
            {projected && (
              <p className="small muted trend-projection">
                주 <span className="num">{weeklyLossKg}</span>kg씩 줄이는 이 속도면 약{' '}
                <span className="num">{monthDay(projected, asOf)}</span>쯤 목표에 도달해요. 어디까지나 예상이에요.
              </p>
            )}
          </>
        ) : (
          <p className="muted">아직 체중 기록이 없어요. 오늘 화면에서 체중을 기록해 보세요.</p>
        )}
      </section>

      <section className="card" aria-labelledby="trend-chart-title">
        <h2 className="card-title" id="trend-chart-title">
          체중 변화
        </h2>
        {weights.length < 2 ? (
          <div className="trend-empty">
            <p>체중을 이틀 이상 기록하면 추세선이 나타나요.</p>
            <p className="small muted">매일 조금씩 달라지는 숫자 대신, 실제로 어느 쪽으로 가고 있는지 보여 드려요.</p>
          </div>
        ) : visible.length < 2 ? (
          <div className="trend-empty">
            <p>이 기간에는 체중 기록이 부족해요.</p>
            <p className="small muted">더 긴 기간을 선택하거나 체중을 며칠 더 기록해 보세요.</p>
          </div>
        ) : (
          <>
            <WeightChart points={visible} goalKg={goalKg} />
            {caption && <p className="small muted trend-caption">{caption}</p>}
          </>
        )}
      </section>

      <section className="card" aria-labelledby="trend-intake-title">
        <h2 className="card-title" id="trend-intake-title">
          하루 섭취 칼로리
        </h2>
        {intake.avg === null ? (
          <p className="muted">이 기간에는 식사 기록이 없어요.</p>
        ) : (
          <>
            <IntakeChart data={intake.data} targetKcal={plan?.targetKcal} />
            <p className="small muted trend-caption">
              기록한 <span className="num">{intake.loggedDays}</span>일 평균{' '}
              <span className="num">{intake.avg.toLocaleString('ko-KR')}</span>kcal
              {plan && (
                <>
                  , 목표는 <span className="num">{plan.targetKcal.toLocaleString('ko-KR')}</span>kcal예요
                </>
              )}
              . 기록하지 않은 날은 막대가 없어요.
            </p>
          </>
        )}
      </section>

      {plan && last && (
        <section className="card" aria-labelledby="trend-plan-title">
          <h2 className="card-title" id="trend-plan-title">
            현재 계획
          </h2>
          <ul className="list trend-stats">
            <li>
              <span className="muted">하루 목표</span>
              <span className="num trend-stat-value">{plan.targetKcal.toLocaleString('ko-KR')}kcal</span>
            </li>
            <li>
              <span className="muted">추정 소비 칼로리</span>
              <span className="num trend-stat-value">{plan.tdee.toLocaleString('ko-KR')}kcal</span>
            </li>
            <li>
              <span className="muted">{last.kind === 'initial' ? '계획 시작일' : '마지막 체크인'}</span>
              <span className="num">{formatKorean(last.date)}</span>
            </li>
            <li>
              <span className="muted">다음 체크인</span>
              {daysLeft !== null && daysLeft > 0 ? (
                <span>
                  <span className="num">{daysLeft}</span>일 뒤
                </span>
              ) : (
                <span className="trend-stat-value">지금 할 수 있어요</span>
              )}
            </li>
          </ul>
          <Link
            to="/checkin"
            className={`btn btn--block trend-cta ${due ? 'btn--primary' : 'trend-cta--early'}`}
          >
            {due ? '주간 체크인 하기' : '미리 체크인하기'}
          </Link>
          <p className="small muted trend-cta-note">
            {due
              ? '지난 기록을 바탕으로 목표 칼로리를 다시 맞춰요.'
              : '체크인은 일주일에 한 번을 권장하지만, 원하면 미리 할 수 있어요.'}
          </p>
        </section>
      )}
    </main>
  )
}
