import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import IntakeChart from '../components/IntakeChart'
import type { IntakeDatum } from '../components/IntakeChart'
import WeightChart from '../components/WeightChart'
import { addDays, diffDays, formatKorean, formatShort, parseDate, today } from '../lib/date'
import { currentPlan } from '../lib/plan'
import { CHECKIN_INTERVAL_DAYS, isCheckinDue, latestCheckin } from '../lib/selectors'
import { effectiveWeeklyLoss, intakeState, phaseOf, progress, targetRange, weekOfPhase } from '../lib/sustain'
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

const fmtKcal = (n: number) => Math.round(n).toLocaleString('ko-KR')

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

  const plan = useMemo(() => currentPlan(checkins), [checkins])
  const last = useMemo(() => latestCheckin(checkins), [checkins])
  const due = useMemo(() => isCheckinDue(checkins, asOf), [checkins, asOf])
  const daysLeft = last ? CHECKIN_INTERVAL_DAYS - diffDays(last.date, asOf) : null
  const targetKcal = plan?.targetKcal

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
    const counts = { in: 0, over: 0, under: 0 }
    for (const v of perDay.values()) {
      sum += v
      if (targetKcal !== undefined) counts[intakeState(v, targetKcal)]++
    }
    return { data, counts, loggedDays: perDay.size, avg: perDay.size > 0 ? Math.round(sum / perDay.size) : null }
  }, [meals, from, asOf, targetKcal])

  const phase = profile ? phaseOf(profile) : null
  const prog = useMemo(
    () =>
      profile && current
        ? progress({ startKg: profile.startWeightKg, goalKg: profile.goalWeightKg, trendKg: current.trend })
        : null,
    [profile, current],
  )
  const reached = prog !== null && prog.remainingKg === 0
  // 시작 체중이 목표보다 높을 때만 시작→목표 눈금이 의미가 있다.
  const hasSpan = profile !== null && profile.startWeightKg > profile.goalWeightKg

  const weeklyLossKg = profile ? effectiveWeeklyLoss(profile) : 0
  const projected =
    phase === 'lose' && current && goalKg !== undefined && !reached && weeklyLossKg > 0
      ? projectGoalDate({ trendKg: current.trend, goalKg, weeklyLossKg, from: asOf })
      : null
  const breakUntil = phase === 'maintain' ? (profile?.breakUntil ?? null) : null

  const caption = change
    ? `${range.phrase}(${formatShort(change.first.date)}~${formatShort(change.last.date)}) 동안 추세 체중이 ${change.first.trend.toFixed(1)} kg에서 ${change.last.trend.toFixed(1)} kg으로 ${
        Math.abs(change.delta) < 0.05
          ? '거의 변하지 않았어요'
          : `${Math.abs(change.delta).toFixed(1)} kg ${change.delta < 0 ? '줄었어요' : '늘었어요'}`
      }.`
    : null

  function progressLine(): string {
    if (!profile || !prog || !current) return ''
    if (reached) {
      return phase === 'maintain'
        ? '목표 체중에 닿았어요. 이제는 이 근처에 머무는 게 목표예요.'
        : '목표 체중에 닿았어요. 다음 체크인에서 유지로 넘어갈 수 있어요.'
    }
    const lost = Number(prog.lostKg.toFixed(1))
    const head =
      lost > 0
        ? `시작보다 ${lost.toFixed(1)} kg 줄었어요`
        : lost < 0
          ? `지금은 시작보다 ${Math.abs(lost).toFixed(1)} kg 높아요`
          : '시작 체중과 거의 같아요'
    if (prog.nextStepKg === null) return `${head}.`
    const toNext = Math.max(0.1, current.trend - prog.nextStepKg).toFixed(1)
    const stepName = prog.nextStepKg <= profile.goalWeightKg ? '목표' : '다음 단계'
    return `${head} · ${stepName} ${prog.nextStepKg.toFixed(1)} kg까지 ${toNext} kg`
  }

  return (
    <main className="page trend-page">
      <h1 className="page-title">추세</h1>

      <section className="panel trend-hero" aria-labelledby="trend-summary-title">
        <h2 className="card-title" id="trend-summary-title">
          현재 추세 체중
        </h2>
        {current ? (
          <>
            <p className="big-num">
              <span data-testid="trend-current">{current.trend.toFixed(1)}</span>
              <span className="trend-unit">kg</span>
            </p>
            {profile && prog && (
              <>
                {hasSpan && (
                  <div
                    className="trend-progress"
                    role="img"
                    aria-label={`시작 ${profile.startWeightKg.toFixed(1)} kg에서 목표 ${profile.goalWeightKg.toFixed(1)} kg까지 ${Math.round(prog.ratio * 100)}% 왔어요`}
                  >
                    <div className="trend-progress-track">
                      {prog.ratio > 0 && (
                        <div className="trend-progress-fill" style={{ width: `${prog.ratio * 100}%` }} />
                      )}
                      <div
                        className="trend-progress-now"
                        style={{ left: `clamp(8px, ${prog.ratio * 100}%, calc(100% - 8px))` }}
                      />
                    </div>
                    <div className="trend-progress-ends num" aria-hidden="true">
                      <span>시작 {profile.startWeightKg.toFixed(1)}</span>
                      <span>목표 {profile.goalWeightKg.toFixed(1)}</span>
                    </div>
                  </div>
                )}
                <p className="trend-hero-msg num" data-testid="trend-progress">
                  {progressLine()}
                </p>
              </>
            )}
            <p className="small trend-hero-hint">하루하루의 오르내림을 걸러 낸 체중의 흐름이에요.</p>
          </>
        ) : (
          <p className="trend-hero-msg">아직 체중 기록이 없어요. 오늘 화면에서 체중을 기록해 보세요.</p>
        )}
      </section>

      <div className="segmented" role="group" aria-label="기간 선택">
        {RANGES.map((r) => (
          <button key={r.key} type="button" aria-pressed={r.key === rangeKey} onClick={() => setRangeKey(r.key)}>
            {r.label}
          </button>
        ))}
      </div>

      <section className="card" aria-labelledby="trend-chart-title">
        <h2 className="card-title" id="trend-chart-title">
          체중 변화
        </h2>
        {weights.length < 2 ? (
          <div className="trend-empty">
            <p>체중을 이틀 이상 기록하면 추세선이 나타나요.</p>
            <p className="small muted">매일 조금씩 달라지는 숫자 대신, 어느 쪽으로 가고 있는지 보여 드려요.</p>
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
            {change && (
              <dl className="trend-facts">
                <div>
                  <dt>{range.phrase} 변화</dt>
                  <dd className="num" data-testid="trend-change">
                    {signed(change.delta, 1)} kg
                  </dd>
                </div>
                <div>
                  <dt>주간 속도</dt>
                  <dd className="num" data-testid="trend-rate">
                    {signed(change.perWeek, 2)} kg/주
                  </dd>
                </div>
              </dl>
            )}
          </>
        )}
        {projected && (
          <p className="small muted trend-projection" data-testid="trend-projection">
            주 <span className="num">{weeklyLossKg}</span> kg씩 줄이는 지금 계획대로면{' '}
            <span className="num">{monthDay(projected, asOf)}</span>쯤 목표 체중에 닿을 것 같아요. 어디까지나
            예상이라 달라질 수 있어요.
          </p>
        )}
        {breakUntil && (
          <p className="small muted trend-projection" data-testid="trend-projection">
            {breakUntil > asOf ? (
              <>
                지금은 쉬어 가는 유지 기간이에요. <span className="num">{monthDay(breakUntil, asOf)}</span>부터 감량을
                다시 시작해요.
              </>
            ) : (
              '쉬어 가는 유지 기간이 끝났어요. 다음 체크인에서 감량을 다시 시작할 수 있어요.'
            )}
          </p>
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
            <IntakeChart data={intake.data} targetKcal={targetKcal} />
            <p className="small muted trend-caption" data-testid="intake-caption">
              기록한 <span className="num">{intake.loggedDays}</span>일 평균{' '}
              <span className="num">{fmtKcal(intake.avg)}</span> kcal
              {targetKcal !== undefined && (
                <>
                  {' · '}범위 안 <span className="num">{intake.counts.in}</span>일 · 많음{' '}
                  <span className="num">{intake.counts.over}</span>일 · 적음{' '}
                  <span className="num">{intake.counts.under}</span>일
                </>
              )}
              . 기록하지 않은 날은 막대가 없어요.
            </p>
          </>
        )}
      </section>

      {profile && plan && last && (
        <section className="card" aria-labelledby="trend-plan-title">
          <div className="trend-plan-head">
            <h2 className="card-title" id="trend-plan-title">
              지금 계획
            </h2>
            {phase === 'maintain' ? (
              <span className="chip chip--good" data-testid="phase-chip">
                {profile.breakUntil ? `쉬어 가는 유지 기간 · ${formatShort(profile.breakUntil)}까지` : '유지 중'}
              </span>
            ) : (
              <span className="chip chip--accent" data-testid="phase-chip">
                감량 {weekOfPhase(profile, asOf)}주차
              </span>
            )}
          </div>
          <dl className="trend-facts trend-facts--plan">
            <div>
              <dt>{phase === 'maintain' ? '하루 유지 범위' : '하루 목표 범위'}</dt>
              <dd className="num" data-testid="plan-range">
                {fmtKcal(targetRange(plan.targetKcal).low)}~{fmtKcal(targetRange(plan.targetKcal).high)} kcal
              </dd>
            </div>
            <div>
              <dt>추정 소비 칼로리</dt>
              <dd className="num">{fmtKcal(plan.tdee)} kcal</dd>
            </div>
            <div>
              <dt>{last.kind === 'initial' ? '계획 시작일' : '마지막 체크인'}</dt>
              <dd className="num">{formatKorean(last.date)}</dd>
            </div>
            <div>
              <dt>다음 체크인</dt>
              <dd data-testid="plan-next">
                {daysLeft !== null && daysLeft > 0 ? (
                  <>
                    <span className="num">{daysLeft}</span>일 뒤
                  </>
                ) : (
                  '지금 할 수 있어요'
                )}
              </dd>
            </div>
          </dl>
          <Link to="/checkin" className={`btn btn--block trend-cta${due ? ' btn--primary btn--lg' : ''}`}>
            {due ? '주간 체크인 하기' : '미리 체크인하기'}
          </Link>
          <p className="small muted trend-cta-note">
            {due
              ? '지난 한 주를 돌아보고 다음 한 주를 어떻게 갈지 정해요.'
              : '체크인은 일주일에 한 번을 권하지만, 원하면 미리 해도 괜찮아요.'}
          </p>
        </section>
      )}
    </main>
  )
}
