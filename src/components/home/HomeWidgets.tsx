import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { addDays, diffDays, formatShort } from '../../lib/date'
import { buildInsights, type InsightTone } from '../../lib/insights'
import { latestCheckin, CHECKIN_INTERVAL_DAYS } from '../../lib/selectors'
import { effectiveWeeklyLoss, phaseOf, progress, recentWeeklyRate } from '../../lib/sustain'
import { projectGoalDate } from '../../lib/tdee'
import { computeTrend, trendAt } from '../../lib/trend'
import { useStore } from '../../store'
import type { DateStr } from '../../types'
import Sparkline from './Sparkline'
import './HomeWidgets.css'

const kg = (n: number) => (Math.round(n * 10) / 10).toFixed(1)
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${kg(Math.abs(n))}`

const TONE_LABEL: Record<InsightTone, string> = { gentle: '살펴볼 것', info: '알아 두면 좋아요', good: '잘되고 있어요' }

/**
 * 홈 화면의 위젯 묶음: 체중 추세, 목표까지, 알아낸 것, 꾸준함, 다음 체크인.
 * 오늘 기준으로 계산하고, 모두 기기 안의 기록만 쓴다(AI 호출 없음).
 */
export default function HomeWidgets({ today, targetKcal }: { today: DateStr; targetKcal: number }) {
  const profile = useStore((s) => s.profile)
  const weights = useStore((s) => s.weights)
  const meals = useStore((s) => s.meals)
  const checkins = useStore((s) => s.checkins)

  const trend = useMemo(() => computeTrend(weights), [weights])
  const trendNow = useMemo(() => trendAt(trend, today), [trend, today])
  const spark = useMemo(() => {
    const from = addDays(today, -27)
    return trend.filter((p) => p.date >= from && p.date <= today).map((p) => p.trend)
  }, [trend, today])
  const rate = useMemo(() => recentWeeklyRate(weights, today), [weights, today])
  const insights = useMemo(
    () => (profile ? buildInsights({ profile, weights, meals, targetKcal, asOf: today }) : []),
    [profile, weights, meals, targetKcal, today],
  )
  const loggedDays = useMemo(() => {
    const set = new Set<DateStr>()
    for (const m of meals) set.add(m.date)
    for (const w of weights) set.add(w.date)
    return Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).map((d) => ({ date: d, on: set.has(d) }))
  }, [meals, weights, today])

  if (!profile) return null
  const prog = trendNow === null ? null : progress({ startKg: profile.startWeightKg, goalKg: profile.goalWeightKg, trendKg: trendNow })
  const loss = effectiveWeeklyLoss(profile)
  const eta =
    trendNow !== null && phaseOf(profile) === 'lose' && loss > 0
      ? projectGoalDate({ trendKg: trendNow, goalKg: profile.goalWeightKg, weeklyLossKg: loss, from: today })
      : null
  const last = latestCheckin(checkins)
  const daysLeft = last ? CHECKIN_INTERVAL_DAYS - diffDays(last.date, today) : null
  const recorded = loggedDays.filter((d) => d.on).length

  return (
    <section className="widgets" aria-label="한눈에 보기">
      <Link to="/trend" className="widget" aria-label="체중 추세 자세히 보기">
        <span className="widget-label">체중 추세</span>
        {trendNow === null ? (
          <p className="widget-empty">체중을 기록하면 추세가 나와요.</p>
        ) : (
          <>
            <p className="widget-num">
              {kg(trendNow)}
              <span className="unit">kg</span>
            </p>
            <Sparkline values={spark} label={`최근 4주 추세, 지금 ${kg(trendNow)}kg`} />
            <p className="widget-sub num">{rate === null ? '2주 더 재면 속도가 나와요' : `주 ${signed(rate)} kg`}</p>
          </>
        )}
      </Link>

      <Link to="/trend" className="widget" aria-label="목표까지 자세히 보기">
        <span className="widget-label">목표까지</span>
        {prog === null ? (
          <p className="widget-empty">목표 {kg(profile.goalWeightKg)}kg</p>
        ) : (
          <>
            <p className="widget-num">
              {prog.remainingKg > 0 ? kg(prog.remainingKg) : '0.0'}
              <span className="unit">kg 남음</span>
            </p>
            <div
              className="goal-bar"
              role="progressbar"
              aria-label="시작부터 목표까지 진행"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(prog.ratio * 100)}
            >
              <span className="goal-bar-fill" style={{ width: `${Math.max(2, prog.ratio * 100)}%` }} />
            </div>
            <p className="widget-sub num">
              {Math.round(prog.ratio * 100)}% ·{' '}
              {eta ? `${formatShort(eta)}쯤` : prog.remainingKg === 0 ? '목표에 닿았어요' : `목표 ${kg(profile.goalWeightKg)}kg`}
            </p>
          </>
        )}
      </Link>

      <div className="widget widget--wide widget--insights" data-testid="insights">
        <span className="widget-label">알아낸 것</span>
        {insights.length === 0 ? (
          <p className="widget-empty">며칠 기록이 쌓이면 흐름을 알려 드릴게요.</p>
        ) : (
          <ul className="insights">
            {insights.map((x) => (
              <li key={x.id} className={`insight insight--${x.tone}`}>
                <span className="insight-dot" aria-hidden="true" />
                <div>
                  <p className="insight-title">
                    <span className="visually-hidden">{TONE_LABEL[x.tone]}: </span>
                    {x.title}
                  </p>
                  <p className="insight-body">{x.body}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="widget" data-testid="consistency">
        <span className="widget-label">최근 7일 기록</span>
        <p className="widget-num">
          {recorded}
          <span className="unit">/ 7일</span>
        </p>
        <div className="dots" aria-hidden="true">
          {loggedDays.map((d) => (
            <span key={d.date} className={`dot${d.on ? ' is-on' : ''}${d.date === today ? ' is-today' : ''}`} />
          ))}
        </div>
      </div>

      <Link to="/checkin" className={`widget${daysLeft !== null && daysLeft <= 0 ? ' widget--accent' : ''}`} aria-label="주간 체크인으로 가기">
        <span className="widget-label">주간 체크인</span>
        {daysLeft === null ? (
          <p className="widget-empty">계획이 아직 없어요.</p>
        ) : daysLeft <= 0 ? (
          <>
            <p className="widget-num widget-num--sm">지금</p>
            <p className="widget-sub">할 수 있어요</p>
          </>
        ) : (
          <>
            <p className="widget-num">
              {daysLeft}
              <span className="unit">일 뒤</span>
            </p>
            <p className="widget-sub">{formatShort(addDays(today, daysLeft))}</p>
          </>
        )}
      </Link>
    </section>
  )
}
