import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import MealSheet from '../components/MealSheet'
import WeightCard from '../components/WeightCard'
import { fmtKcal } from '../components/today/format'
import { ChevronLeft, ChevronRight, TrashIcon } from '../components/today/icons'
import '../components/today/shared.css'
import { addDays, formatKorean, today } from '../lib/date'
import { currentPlan } from '../lib/plan'
import { isBackupDue, isCheckinDue, kcalOn, mealsOn, streak } from '../lib/selectors'
import { useStore } from '../store'
import type { DateStr, MealEntry } from '../types'
import { useSync } from '../sync/store'
import './Today.css'

function mealLabel(m: MealEntry): string {
  if (m.name) return m.name
  return m.source === 'rough' ? '대충 입력' : '식사'
}

export default function Today() {
  const weights = useStore((s) => s.weights)
  const meals = useStore((s) => s.meals)
  const checkins = useStore((s) => s.checkins)
  const lastBackupAt = useStore((s) => s.lastBackupAt)
  // 계정에 동기화 중이면 백업 파일을 따로 권하지 않는다.
  const synced = useSync((s) => s.email !== null && s.conflict === null)
  const removeMeal = useStore((s) => s.removeMeal)

  const todayStr = today()
  const [date, setDate] = useState<DateStr>(todayStr)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isToday = date === todayStr
  const canGoNext = date < todayStr

  const plan = useMemo(() => currentPlan(checkins), [checkins])
  const dayMeals = useMemo(() => mealsOn(meals, date), [meals, date])
  const eaten = useMemo(() => kcalOn(meals, date), [meals, date])
  const streakDays = useMemo(() => streak(weights, meals, todayStr), [weights, meals, todayStr])
  const checkinDue = useMemo(() => isCheckinDue(checkins, todayStr), [checkins, todayStr])
  const backupDue = useMemo(
    () => isBackupDue(lastBackupAt, weights.length + meals.length > 0, new Date()),
    [lastBackupAt, weights.length, meals.length],
  )

  const target = plan?.targetKcal ?? 0
  const remaining = target - eaten
  const over = plan !== null && remaining < 0
  const pct = target > 0 ? Math.min(100, Math.round((eaten / target) * 100)) : 0

  function go(next: DateStr) {
    setDate(next > todayStr ? todayStr : next)
    setError(null)
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
    <main className="page">
      <header className="today-head">
        <button
          type="button"
          className="icon-btn"
          aria-label="이전 날"
          onClick={() => go(addDays(date, -1))}
        >
          <ChevronLeft />
        </button>
        <h1 className="page-title" aria-live="polite">
          {formatKorean(date)}
        </h1>
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

      {isToday && backupDue && !synced && (
        <div className="banner banner--warn">
          <span>기록은 이 기기에만 있어요. 백업 파일을 받아 두세요.</span>
          <Link className="btn" to="/settings">
            백업하기
          </Link>
        </div>
      )}

      <section className="card" aria-labelledby="kcal-card-title">
        <h2 className="card-title" id="kcal-card-title">
          {plan === null ? '섭취 칼로리' : over ? '목표를 넘은 양' : '남은 칼로리'}
        </h2>
        <p className={`big-num${over ? ' kcal-hero--over' : ''}`}>
          <span data-testid="kcal-hero">
            {plan === null ? fmtKcal(eaten) : over ? `+${fmtKcal(-remaining)}` : fmtKcal(remaining)}
          </span>
          <span className="unit">kcal</span>
        </p>
        {plan !== null && (
          <>
            <div
              className="kcal-bar"
              role="progressbar"
              aria-label="목표 대비 섭취량"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <div
                className={`kcal-bar-fill${over ? ' kcal-bar-fill--over' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="small muted">
              목표 <span className="num">{fmtKcal(target)}</span> · 섭취{' '}
              <span className="num" data-testid="kcal-eaten">
                {fmtKcal(eaten)}
              </span>{' '}
              kcal
            </p>
            {over && (
              <p className="small muted" style={{ marginTop: 4 }}>
                하루쯤 넘어도 괜찮아요. 목표는 주간 추세를 보고 다시 맞춰요.
              </p>
            )}
          </>
        )}
      </section>

      <button
        type="button"
        className="btn btn--primary btn--block add-meal"
        onClick={() => setSheetOpen(true)}
      >
        식사 추가
      </button>

      <section className="card" aria-labelledby="meals-card-title">
        <div className="meals-head">
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

      <WeightCard key={date} date={date} />

      {streakDays >= 2 && (
        <p className="small muted streak">
          <span className="num">{streakDays}</span>일 연속 기록 중
        </p>
      )}

      {sheetOpen && (
        <MealSheet date={date} targetKcal={target} onClose={() => setSheetOpen(false)} />
      )}
    </main>
  )
}
