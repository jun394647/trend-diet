import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { formatKorean } from '../lib/date'
import { ROUGH_PORTIONS, roughKcal } from '../lib/selectors'
import { targetRange } from '../lib/sustain'
import type { RoughSize } from '../lib/selectors'
import { useStore } from '../store'
import type { DateStr } from '../types'
import { fmtKcal } from './today/format'
import FoodSearch from './FoodSearch'
import { TrashIcon } from './today/icons'
import './today/shared.css'
import './MealSheet.css'

type Mode = 'search' | 'exact' | 'favorite' | 'rough'

const MODES: { id: Mode; label: string }[] = [
  { id: 'favorite', label: '즐겨찾기' },
  { id: 'search', label: '검색' },
  { id: 'exact', label: '직접 입력' },
  { id: 'rough', label: '대충 입력' },
]

const ROUGH_SIZES: RoughSize[] = ['small', 'medium', 'large']
const MIN_KCAL = 1
const MAX_KCAL = 5000

interface Props {
  date: DateStr
  targetKcal: number
  onClose: () => void
}

export default function MealSheet({ date, targetKcal, onClose }: Props) {
  const favorites = useStore((s) => s.favorites)
  const addMeal = useStore((s) => s.addMeal)
  const addFavorite = useStore((s) => s.addFavorite)
  const removeFavorite = useStore((s) => s.removeFavorite)
  const logFavorite = useStore((s) => s.logFavorite)

  const [mode, setMode] = useState<Mode>(() => (favorites.length > 0 ? 'favorite' : 'exact'))
  const [kcalText, setKcalText] = useState('')
  const [name, setName] = useState('')
  const [saveFav, setSaveFav] = useState(false)
  const [kcalError, setKcalError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const sheetRef = useRef<HTMLDivElement>(null)
  const kcalRef = useRef<HTMLInputElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const sortedFavorites = useMemo(
    () =>
      [...favorites].sort(
        (a, b) => b.useCount - a.useCount || b.lastUsedAt.localeCompare(a.lastUsedAt),
      ),
    [favorites],
  )

  // 열릴 때 포커스를 시트 안으로 옮기고, 닫히면 원래 자리로 돌려준다.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (kcalRef.current) kcalRef.current.focus()
    else sheetRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      opener?.focus()
    }
  }, [])

  // 직접 입력으로 바꾸면 바로 숫자를 칠 수 있게 한다.
  useEffect(() => {
    if (mode === 'exact') kcalRef.current?.focus()
  }, [mode])

  const hasName = name.trim() !== ''
  const range = targetRange(targetKcal)

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
      onClose()
    } catch {
      setError('저장하지 못했어요. 다시 시도해 주세요.')
      setBusy(false)
    }
  }

  function onSubmitExact(e: FormEvent) {
    e.preventDefault()
    const t = kcalText.trim()
    const kcal = /^\d+$/.test(t) ? Number(t) : NaN
    if (!(kcal >= MIN_KCAL && kcal <= MAX_KCAL)) {
      setKcalError(`${MIN_KCAL}~${fmtKcal(MAX_KCAL)} 사이의 숫자로 적어 주세요.`)
      kcalRef.current?.focus()
      return
    }
    const trimmed = name.trim()
    void run(async () => {
      await addMeal({ date, kcal, name: trimmed || undefined, source: 'exact' })
      if (saveFav && trimmed) await addFavorite(trimmed, kcal)
    })
  }

  function onRough(size: RoughSize) {
    const { label } = ROUGH_PORTIONS[size]
    void run(() =>
      addMeal({
        date,
        kcal: roughKcal(size, targetKcal),
        name: `대충 입력 · ${label}`,
        source: 'rough',
      }),
    )
  }

  async function onRemoveFavorite(id: string) {
    setError(null)
    try {
      await removeFavorite(id)
      setConfirmId(null)
    } catch {
      setError('삭제하지 못했어요. 다시 시도해 주세요.')
    }
  }

  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={sheetRef}
        className="sheet meal-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="식사 추가"
        tabIndex={-1}
      >
        <div className="meal-sheet-head">
          <div>
            <h2 className="meal-sheet-title">식사 추가</h2>
            <p className="small muted">{formatKorean(date)}</p>
          </div>
          <button type="button" className="btn btn--ghost meal-sheet-close" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="segmented" role="group" aria-label="입력 방식">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={mode === m.id}
              onClick={() => {
                setMode(m.id)
                setConfirmId(null)
                setError(null)
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'search' && (
          <FoodSearch
            busy={busy}
            onLog={(meal, saveFavorite) =>
              void run(async () => {
                await addMeal({ date, kcal: meal.kcal, name: meal.name, source: 'search' })
                if (saveFavorite) await addFavorite(meal.name, meal.kcal)
              })
            }
          />
        )}

        {mode === 'exact' && (
          <form className="stack" onSubmit={onSubmitExact} noValidate>
            <div className="field">
              <label htmlFor="meal-kcal">칼로리 (kcal)</label>
              <input
                ref={kcalRef}
                id="meal-kcal"
                className="input num"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                placeholder="예: 550"
                value={kcalText}
                aria-invalid={kcalError ? true : undefined}
                aria-describedby={kcalError ? 'meal-kcal-error' : undefined}
                onChange={(e) => {
                  setKcalText(e.target.value)
                  setKcalError(null)
                }}
              />
              {kcalError && (
                <p className="field-error" id="meal-kcal-error" role="alert">
                  {kcalError}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="meal-name">이름 (선택)</label>
              <input
                id="meal-name"
                className="input"
                autoComplete="off"
                maxLength={40}
                placeholder="예: 김치찌개"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <label className={`meal-check${hasName ? '' : ' meal-check--disabled'}`}>
              <input
                type="checkbox"
                checked={saveFav && hasName}
                disabled={!hasName}
                onChange={(e) => setSaveFav(e.target.checked)}
              />
              <span>
                즐겨찾기에 저장
                {!hasName && <span className="small muted"> · 이름을 적으면 켤 수 있어요</span>}
              </span>
            </label>
            <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
              기록하기
            </button>
          </form>
        )}

        {mode === 'favorite' &&
          (sortedFavorites.length === 0 ? (
            <div className="stack">
              <p className="muted">
                아직 즐겨찾기가 없어요. 직접 입력에서 이름을 적고 '즐겨찾기에 저장'을 켜면 다음부터
                한 번에 기록할 수 있어요.
              </p>
              <button type="button" className="btn btn--block" onClick={() => setMode('exact')}>
                직접 입력으로 가기
              </button>
            </div>
          ) : (
            <ul className="list fav-list">
              {sortedFavorites.map((f) =>
                confirmId === f.id ? (
                  <li key={f.id}>
                    <div className="fav-confirm">
                      <span className="fav-confirm-text">'{f.name}' 즐겨찾기를 삭제할까요?</span>
                      <div className="fav-confirm-actions">
                        <button type="button" className="btn" onClick={() => setConfirmId(null)}>
                          취소
                        </button>
                        <button
                          type="button"
                          className="btn btn--danger"
                          onClick={() => void onRemoveFavorite(f.id)}
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  </li>
                ) : (
                  <li key={f.id}>
                    <button
                      type="button"
                      className="fav-log"
                      disabled={busy}
                      aria-label={`${f.name} ${fmtKcal(f.kcal)} kcal 기록`}
                      onClick={() => void run(() => logFavorite(f.id, date))}
                    >
                      <span className="fav-name">{f.name}</span>
                      <span className="fav-kcal num">{fmtKcal(f.kcal)} kcal</span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`${f.name} 즐겨찾기 삭제`}
                      onClick={() => setConfirmId(f.id)}
                    >
                      <TrashIcon />
                    </button>
                  </li>
                ),
              )}
            </ul>
          ))}

        {mode === 'rough' && (
          <div className="stack">
            <div className="rough-grid">
              {ROUGH_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  className="rough-btn"
                  disabled={busy || roughKcal(size, targetKcal) <= 0}
                  onClick={() => onRough(size)}
                >
                  <span className="rough-label">{ROUGH_PORTIONS[size].label}</span>
                  <span className="rough-kcal num">{fmtKcal(roughKcal(size, targetKcal))} kcal</span>
                </button>
              ))}
            </div>
            <p className="small muted">
              하루 목표 범위{' '}
              <span className="num">
                {fmtKcal(range.low)}~{fmtKcal(range.high)}
              </span>{' '}
              kcal에 맞춰 어림잡은 양이에요. 정확하지 않아도 적어 두면 한 주 평균을 볼 수 있어요.
            </p>
          </div>
        )}

        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
