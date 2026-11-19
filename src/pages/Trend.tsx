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

/** 줄 바꿈 없는 공백. 숫자와 단위를 한 줄에 묶을 때 쓴다. */
const NB = '\u00A0'

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

/** 아직 그릴 것이 없을 때 차트 자리에 두는 흐린 밑그림. 꾸밈이라 읽어 주지 않는다. */
function GhostLine() {
  return (
    <svg className="trend-ghost" viewBox="0 0 280 96" aria-hidden="true">
      <path className="trend-ghost-grid" d="M0 12H280M0 48H280M0 84H280" />
      <path className="trend-ghost-line" d="M4 26C60 30 86 40 130 50S214 66 268 72" />
      <circle className="trend-ghost-end" cx="268" cy="72" r="4" />
    </svg>
  )
}

function GhostBars() {
  const heights = [44, 58, 50, 0, 62, 54, 40, 60, 0, 52, 56, 46]
  return (
    <svg className="trend-ghost" viewBox="0 0 280 96" aria-hidden="true">
      <path className="trend-ghost-grid" d="M0 12H280M0 48H280M0 84H280" />
      {heights.map((h, i) =>
        h > 0 ? <rect key={i} className="trend-ghost-bar" x={10 + i * 22} y={84 - h} width="10" height={h} rx="3" /> : null,
      )}
    </svg>
  )
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

  // 차트를 글로 옮긴 한 문장. 숫자와 단위 사이에서 줄이 바뀌지 않게 그 사이만 줄 바꿈 없는 공백(NB)으로 적는다.
  const caption = change
    ? `${range.phrase}(${formatShort(change.first.date)}~${formatShort(change.last.date)}) 동안 추세 체중이 ${change.first.trend.toFixed(1)}${NB}kg에서 ${change.last.trend.toFixed(1)}${NB}kg으로 ${
        Math.abs(change.delta) < 0.05
          ? '거의 변하지 않았어요'
          : `${Math.abs(change.delta).toFixed(1)}${NB}kg ${change.delta < 0 ? '줄었어요' : '늘었어요'}`
      }.`
    : null

  /** 패널의 한마디. 뒤쪽(다음 단계까지 남은 양)이 있으면 줄을 나눠 적는다. */
  function progressLine(): { head: string; tail: string | null } {
    if (!profile || !prog || !current) return { head: '', tail: null }
    if (reached) {
      return {
        head:
          phase === 'maintain'
            ? '목표 체중에 닿았어요. 이제는 이 근처에 머무는 게 목표예요.'
            : '목표 체중에 닿았어요. 다음 체크인에서 유지로 넘어갈 수 있어요.',
        tail: null,
      }
    }
    const lost = Number(prog.lostKg.toFixed(1))
    const head =
      lost > 0
        ? `시작보다 ${lost.toFixed(1)} kg 줄었어요`
        : lost < 0
          ? `지금은 시작보다 ${Math.abs(lost).toFixed(1)} kg 높아요`
          : '시작 체중과 거의 같아요'
    if (prog.nextStepKg === null) return { head: `${head}.`, tail: null }
    const toNext = Math.max(0.1, current.trend - prog.nextStepKg).toFixed(1)
    const stepName = prog.nextStepKg <= profile.goalWeightKg ? '목표' : '다음 단계'
    return { head, tail: `${stepName} ${prog.nextStepKg.toFixed(1)} kg까지 ${toNext} kg` }
  }
  const line = progressLine()

  // 시작과 목표 사이의 눈금. 너무 촘촘해지지 않게 간격을 고른다.
  const scaleTicks: number[] = []
  if (profile && hasSpan) {
    const total = profile.startWeightKg - profile.goalWeightKg
    const step = [1, 2, 5, 10, 20].find((v) => total / v <= 12) ?? 50
    for (let kg = Math.ceil(profile.goalWeightKg / step) * step; kg < profile.startWeightKg; kg += step) {
      const at = (profile.startWeightKg - kg) / total
      if (at > 0.02 && at < 0.98) scaleTicks.push(at)
    }
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
                        style={{ left: `clamp(7px, ${prog.ratio * 100}%, calc(100% - 7px))` }}
                      />
                    </div>
                    <div className="trend-progress-scale" aria-hidden="true">
                      {scaleTicks.map((at) => (
                        <span key={at} style={{ left: `${at * 100}%` }} />
                      ))}
                    </div>
                    <div className="trend-progress-ends" aria-hidden="true">
                      <span>
                        시작 <b className="num">{profile.startWeightKg.toFixed(1)}</b>
                      </span>
                      <span>
                        목표 <b className="num">{profile.goalWeightKg.toFixed(1)}</b>
                      </span>
                    </div>
                  </div>
                )}
                <p className="trend-hero-msg num" data-testid="trend-progress">
                  <span className="trend-hero-msg-line">{line.head}</span>
                  {line.tail !== null && (
                    <>
                      <span className="trend-hero-msg-sep"> · </span>
                      <span className="trend-hero-msg-line trend-hero-msg-tail">{line.tail}</span>
                    </>
                  )}
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
            <GhostLine />
            <p>체중을 이틀 이상 기록하면 추세선이 나타나요.</p>
            <p className="small muted">매일 조금씩 달라지는 숫자 대신, 어느 쪽으로 가고 있는지 보여 드려요.</p>
          </div>
        ) : visible.length < 2 ? (
          <div className="trend-empty">
            <GhostLine />
            <p>이 기간에는 체중 기록이 부족해요.</p>
            <p className="small muted">더 긴 기간을 선택하거나 체중을 며칠 더 기록해 보세요.</p>
          </div>
        ) : (
          <>
            <WeightChart points={visible} goalKg={goalKg} />
            {caption && <p className="small muted trend-caption num">{caption}</p>}
            {change && (
              <dl className="trend-facts">
                <div>
                  <dt>{range.phrase} 변화</dt>
                  <dd data-testid="trend-change">
                    <span className="num">{signed(change.delta, 1)}</span>
                    <span className="trend-fact-unit"> kg</span>
                  </dd>
                </div>
                <div>
                  <dt>주간 속도</dt>
                  <dd data-testid="trend-rate">
                    <span className="num">{signed(change.perWeek, 2)}</span>
                    <span className="trend-fact-unit"> kg/주</span>
                  </dd>
                </div>
              </dl>
            )}
          </>
        )}
        {projected && (
          <p className="small muted trend-projection" data-testid="trend-projection">
            <span className="trend-nowrap">
              주 <span className="num">{weeklyLossKg}</span> kg씩
            </span>{' '}
            줄이는 지금 계획대로면{' '}
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
          <div className="trend-empty trend-empty--bars">
            <GhostBars />
            <p>이 기간에는 식사 기록이 없어요.</p>
          </div>
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
              <dd data-testid="plan-range">
                <span className="num">
                  {fmtKcal(targetRange(plan.targetKcal).low)}~{fmtKcal(targetRange(plan.targetKcal).high)}
                </span>
                <span className="trend-fact-unit"> kcal</span>
              </dd>
            </div>
            <div>
              <dt>추정 소비 칼로리</dt>
              <dd>
                <span className="num">{fmtKcal(plan.tdee)}</span>
                <span className="trend-fact-unit"> kcal</span>
              </dd>
            </div>
            <div>
              <dt>{last.kind === 'initial' ? '계획 시작일' : '마지막 체크인'}</dt>
              <dd className="trend-fact-text num">{formatKorean(last.date)}</dd>
            </div>
            <div>
              <dt>다음 체크인</dt>
              <dd className="trend-fact-text" data-testid="plan-next">
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
