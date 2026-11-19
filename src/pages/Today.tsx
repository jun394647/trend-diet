import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import MealSheet from '../components/MealSheet'
import WeightCard from '../components/WeightCard'
import { fmtKcal } from '../components/today/format'
import { ChevronLeft, ChevronRight, TrashIcon } from '../components/today/icons'
import IntakeGauge from '../components/today/IntakeGauge'
import '../components/today/shared.css'
import WeekStrip from '../components/today/WeekStrip'
import { addDays, formatKorean, formatShort, today } from '../lib/date'
import { currentPlan } from '../lib/plan'
import { mySuggestions, type Suggestion } from '../lib/quickAdd'
import { isBackupDue, isCheckinDue, kcalOn, mealsOn } from '../lib/selectors'
import { intakeState, phaseOf, targetRange, weekOfPhase, weekStart, weekSummary } from '../lib/sustain'
import { useStore } from '../store'
import { useSync } from '../sync/store'
import type { DateStr, MealEntry } from '../types'
import './Today.css'

function mealLabel(m: MealEntry): string {
  if (m.name) return m.name
  return m.source === 'rough' ? '대충 입력' : '식사'
}

export default function Today() {
  const profile = useStore((s) => s.profile)
  const weights = useStore((s) => s.weights)
  const meals = useStore((s) => s.meals)
  const checkins = useStore((s) => s.checkins)
  const lastBackupAt = useStore((s) => s.lastBackupAt)
  // 계정에 동기화 중이면 백업 파일을 따로 권하지 않는다.
  const synced = useSync((s) => s.email !== null && s.conflict === null)
  const syncConflict = useSync((s) => s.conflict !== null)
  const removeMeal = useStore((s) => s.removeMeal)
  const favorites = useStore((s) => s.favorites)
  const addMeal = useStore((s) => s.addMeal)
  const logFavorite = useStore((s) => s.logFavorite)

  const todayStr = today()
  const [date, setDate] = useState<DateStr>(todayStr)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isToday = date === todayStr
  const canGoNext = date < todayStr

  const plan = useMemo(() => currentPlan(checkins), [checkins])
  const dayMeals = useMemo(() => mealsOn(meals, date), [meals, date])
  const eaten = useMemo(() => kcalOn(meals, date), [meals, date])
  const checkinDue = useMemo(() => isCheckinDue(checkins, todayStr), [checkins, todayStr])
  const backupDue = useMemo(
    () => isBackupDue(lastBackupAt, weights.length + meals.length > 0, new Date()),
    [lastBackupAt, weights.length, meals.length],
  )

  // 가장 자주 먹는 것 몇 가지는 시트를 열지 않고 바로 기록할 수 있게 한다.
  const quick = useMemo(() => mySuggestions({ meals, favorites }, '', 4), [meals, favorites])

  const target = plan?.targetKcal ?? 0
  const range = targetRange(target)
  const state = intakeState(eaten, target)
  // 보고 있는 날이 속한 주. 이번 주라면 오늘까지만 센다.
  const week = useMemo(() => {
    const end = addDays(weekStart(date), 6)
    return weekSummary({
      meals,
      weights,
      targetKcal: target,
      asOf: end > todayStr ? todayStr : end,
      inProgress: todayStr,
    })
  }, [meals, weights, target, date, todayStr])
  const isThisWeek = weekStart(date) === weekStart(todayStr)
  const maintaining = profile !== null && phaseOf(profile) === 'maintain'
  const rangeName = maintaining ? '유지 범위' : '목표 범위'

  function go(next: DateStr) {
    setDate(next > todayStr ? todayStr : next)
    setError(null)
  }

  async function onQuickLog(s: Suggestion) {
    setError(null)
    try {
      if (s.favoriteId) await logFavorite(s.favoriteId, date)
      else await addMeal({ date, kcal: s.kcal, name: s.name, source: 'favorite' })
    } catch {
      setError('기록하지 못했어요. 다시 시도해 주세요.')
    }
  }

  async function onRemoveMeal(id: string) {
    setError(null)
    try {
      await removeMeal(id)
    } catch {
      setError('삭제하지 못했어요. 다시 시도해 주세요.')
    }
  }

  return (
    <main className="page today">
      <header className="today-head">
        <button type="button" className="icon-btn" aria-label="이전 날" onClick={() => go(addDays(date, -1))}>
          <ChevronLeft />
        </button>
        <div className="today-title">
          <h1 className="page-title" aria-live="polite">
            {formatKorean(date)}
          </h1>
          {profile &&
            (maintaining ? (
              <span className="chip chip--good" data-testid="phase-chip">
                {profile.breakUntil ? `쉬어 가는 유지 기간 · ${formatShort(profile.breakUntil)}까지` : '유지 중'}
              </span>
            ) : (
              <span className="chip chip--accent" data-testid="phase-chip">
                감량 {weekOfPhase(profile, todayStr)}주차
              </span>
            ))}
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="다음 날"
          disabled={!canGoNext}
          onClick={() => go(addDays(date, 1))}
        >
          <ChevronRight />
        </button>
      </header>

      {!isToday && (
        <div className="today-jump">
          <button type="button" className="btn btn--ghost" onClick={() => go(todayStr)}>
            오늘로 돌아가기
          </button>
        </div>
      )}

      {isToday && checkinDue && (
        <div className="banner">
          <span>주간 체크인을 할 때가 됐어요</span>
          <Link className="btn" to="/checkin">
            체크인하기
          </Link>
        </div>
      )}

      {syncConflict && (
        <div className="banner">
          <span>로그인했어요. 이 기기와 계정의 기록을 어떻게 할지 정해 주세요.</span>
          <Link className="btn" to="/settings">
            정하러 가기
          </Link>
        </div>
      )}

      {isToday && backupDue && !synced && !syncConflict && (
        <div className="banner banner--warn">
          <span>기록은 이 기기에만 있어요. 백업 파일을 받아 두세요.</span>
          <Link className="btn" to="/settings">
            백업하기
          </Link>
        </div>
      )}

      <section className="panel today-hero" aria-labelledby="kcal-card-title">
        <h2 className="card-title" id="kcal-card-title">
          {isToday ? '오늘 먹은 양' : '이날 먹은 양'}
        </h2>
        <p className="big-num">
          <span data-testid="kcal-eaten">{fmtKcal(eaten)}</span>
          <span className="unit">kcal</span>
        </p>
        {plan !== null && (
          <>
            <IntakeGauge eaten={eaten} targetKcal={target} />
            <p className="today-hero-msg" data-testid="kcal-status">
              {state === 'in' && `${rangeName} 안이에요.`}
              {state === 'under' &&
                (isToday ? (
                  <>
                    <span className="num">
                      {fmtKcal(range.low - eaten)}~{fmtKcal(range.high - eaten)}
                    </span>{' '}
                    kcal 더 먹으면 {rangeName} 안이에요.
                  </>
                ) : (
                  `${rangeName}보다 ${fmtKcal(range.low - eaten)} kcal 적게 기록했어요.`
                ))}
              {state === 'over' && (
                <>
                  {rangeName}를 <span className="num">{fmtKcal(eaten - range.high)}</span> kcal 넘었어요.{' '}
                  {week.avgState === 'in'
                    ? '이번 주 평균은 범위 안이니 괜찮아요.'
                    : '하루쯤은 괜찮아요. 한 주 평균으로 봐요.'}
                </>
              )}
            </p>
          </>
        )}
      </section>

      <button type="button" className="btn btn--primary btn--block btn--lg" onClick={() => setSheetOpen(true)}>
        식사 추가
      </button>

      {quick.length > 0 && (
        <div className="quick" role="group" aria-label="자주 먹는 것 바로 기록">
          {quick.map((s) => (
            <button
              key={`${s.name}|${s.kcal}`}
              type="button"
              className="quick-btn"
              aria-label={`${s.name} ${fmtKcal(s.kcal)} kcal 바로 기록`}
              onClick={() => void onQuickLog(s)}
            >
              <span className="quick-name">{s.name}</span>
              <span className="quick-kcal num">{fmtKcal(s.kcal)}</span>
            </button>
          ))}
        </div>
      )}

      <section className="card" aria-labelledby="meals-card-title">
        <div className="section-head">
          <h2 className="card-title" id="meals-card-title">
            식사 기록
          </h2>
          {dayMeals.length > 0 && <span className="small muted">{dayMeals.length}건</span>}
        </div>
        {dayMeals.length === 0 ? (
          <p className="muted">
            {isToday ? '첫 끼를 기록해 볼까요? 대충 적어도 괜찮아요.' : '이날은 기록한 식사가 없어요.'}
          </p>
        ) : (
          <ul className="list meal-list">
            {dayMeals.map((m) => (
              <li key={m.id}>
                <span className="meal-name">{mealLabel(m)}</span>
                <span className="meal-kcal num">{fmtKcal(m.kcal)} kcal</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`${mealLabel(m)} ${fmtKcal(m.kcal)} kcal 삭제`}
                  onClick={() => void onRemoveMeal(m.id)}
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </section>

      {plan !== null && (
        <section className="card" aria-labelledby="week-card-title">
          <div className="section-head">
            <h2 className="card-title" id="week-card-title">
              {isThisWeek ? '이번 주' : `${formatShort(week.days[0].date)}~${formatShort(week.days[6].date)} 주`}
            </h2>
            <span className="chip" data-testid="week-count">
              기록 {week.recordedDays}/7일
            </span>
          </div>
          <WeekStrip week={week} targetKcal={target} selected={date} today={todayStr} onSelect={go} />
          <p className="week-summary" data-testid="week-summary">
            {week.avgKcal === null ? (
              '이 주에는 식사 기록이 아직 없어요.'
            ) : (
              <>
                {week.avgDays < week.mealDays ? '오늘을 뺀 ' : '기록한 '}
                {week.avgDays}일 평균 <b className="num">{fmtKcal(week.avgKcal)}</b> kcal로{' '}
                {week.avgState === 'in' && `${rangeName} 안이에요.`}
                {week.avgState === 'over' && `${rangeName}보다 조금 많아요.`}
                {week.avgState === 'under' && `${rangeName}보다 적어요. 너무 적게 먹으면 오래 가기 어려워요.`}
              </>
            )}
          </p>
        </section>
      )}

      <WeightCard key={date} date={date} />

      {sheetOpen && <MealSheet date={date} targetKcal={target} onClose={() => setSheetOpen(false)} />}
    </main>
  )
}
