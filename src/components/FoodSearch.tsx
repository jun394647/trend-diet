import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { loadFoodDb, type FoodDb } from '../lib/foodDb'
import { kcalFor, nutrientFor, searchFoods, type IndexedFood } from '../lib/foodSearch'
import { fmtKcal } from './today/format'
import './FoodSearch.css'

const MAX_KCAL = 5000
const MAX_AMOUNT = 5000

interface Props {
  busy: boolean
  /** 고른 음식을 기록한다. saveFavorite가 true면 즐겨찾기에도 넣는다. */
  onLog: (meal: { name: string; kcal: number }, saveFavorite: boolean) => void
}

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; db: FoodDb }

const fmtAmount = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

function servingLabel(f: IndexedFood): string {
  return f.servingSize !== null
    ? `1회 ${fmtAmount(f.servingSize)}${f.unit} · ${fmtKcal(kcalFor(f, f.servingSize))} kcal`
    : `100${f.unit}당 ${fmtKcal(f.kcalPer100)} kcal`
}

export default function FoodSearch({ busy, onLog }: Props) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<IndexedFood | null>(null)
  const [amountText, setAmountText] = useState('')
  const [saveFav, setSaveFav] = useState(false)
  const [amountError, setAmountError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const amountRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    loadFoodDb().then(
      (db) => alive && setLoad({ status: 'ready', db }),
      () => alive && setLoad({ status: 'error' }),
    )
    return () => {
      alive = false
    }
  }, [attempt])

  useEffect(() => {
    if (picked) amountRef.current?.focus()
    else inputRef.current?.focus()
  }, [picked])

  const deferredQuery = useDeferredValue(query)
  const result = useMemo(
    () => (load.status === 'ready' ? searchFoods(load.db.index, deferredQuery) : { items: [], total: 0 }),
    [load, deferredQuery],
  )

  function pick(f: IndexedFood) {
    setPicked(f)
    setAmountText(fmtAmount(f.servingSize ?? 100))
    setAmountError(null)
    setSaveFav(false)
  }

  if (picked) {
    const amount = Number(amountText.trim().replace(',', '.'))
    const valid = Number.isFinite(amount) && amount > 0 && amount <= MAX_AMOUNT
    const kcal = valid ? kcalFor(picked, amount) : null
    const title = picked.tag && !['가정식', '외식', '급식', '원재료'].includes(picked.tag)
      ? `${picked.name} (${picked.tag})`
      : picked.name
    const presets =
      picked.servingSize !== null
        ? [
            { label: '반', value: picked.servingSize / 2 },
            { label: '1회분', value: picked.servingSize },
            { label: '1.5배', value: picked.servingSize * 1.5 },
            { label: '2배', value: picked.servingSize * 2 },
          ]
        : [50, 100, 200, 300].map((v) => ({ label: `${v}${picked.unit}`, value: v }))
    const macros = valid
      ? ([
          ['탄수화물', nutrientFor(picked.carbPer100, amount)],
          ['단백질', nutrientFor(picked.proteinPer100, amount)],
          ['지방', nutrientFor(picked.fatPer100, amount)],
        ] as const).filter(([, v]) => v !== null)
      : []

    const submit = (e: FormEvent) => {
      e.preventDefault()
      if (!valid || kcal === null) {
        setAmountError(`0보다 크고 ${fmtKcal(MAX_AMOUNT)}${picked.unit} 이하인 숫자로 적어 주세요.`)
        amountRef.current?.focus()
        return
      }
      if (kcal < 1 || kcal > MAX_KCAL) {
        setAmountError(`한 번에 1~${fmtKcal(MAX_KCAL)} kcal까지 기록할 수 있어요.`)
        return
      }
      onLog({ name: title.slice(0, 40), kcal }, saveFav)
    }

    return (
      <form className="stack" onSubmit={submit} noValidate>
        <div className="food-picked">
          <div>
            <p className="food-picked-name">{picked.name}</p>
            <p className="small muted">
              {picked.tag && `${picked.tag} · `}100{picked.unit}당 {fmtKcal(picked.kcalPer100)} kcal
            </p>
          </div>
          <button type="button" className="btn btn--ghost food-picked-back" onClick={() => setPicked(null)}>
            다시 검색
          </button>
        </div>

        <div className="field">
          <label htmlFor="food-amount">먹은 양 ({picked.unit})</label>
          <input
            ref={amountRef}
            id="food-amount"
            className="input num"
            inputMode="decimal"
            autoComplete="off"
            value={amountText}
            aria-invalid={amountError ? true : undefined}
            aria-describedby={amountError ? 'food-amount-error' : undefined}
            onChange={(e) => {
              setAmountText(e.target.value)
              setAmountError(null)
            }}
          />
          <div className="food-presets" role="group" aria-label="양 빠르게 고르기">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                className="btn food-preset"
                aria-pressed={valid && Math.abs(amount - p.value) < 0.05}
                onClick={() => {
                  setAmountText(fmtAmount(Math.round(p.value * 10) / 10))
                  setAmountError(null)
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          {amountError && (
            <p className="field-error" id="food-amount-error" role="alert">
              {amountError}
            </p>
          )}
        </div>

        <div className="food-total">
          <span className="muted">기록할 칼로리</span>
          <span className="food-total-kcal num" data-testid="food-kcal">
            {kcal !== null ? `${fmtKcal(kcal)} kcal` : '—'}
          </span>
        </div>
        {macros.length > 0 && (
          <p className="small muted num">
            {macros.map(([label, v]) => `${label} ${v}g`).join(' · ')}
          </p>
        )}

        <label className="meal-check">
          <input type="checkbox" checked={saveFav} onChange={(e) => setSaveFav(e.target.checked)} />
          <span>이 양으로 즐겨찾기에 저장</span>
        </label>
        <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
          기록하기
        </button>
      </form>
    )
  }

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="food-query">음식 이름</label>
        <input
          ref={inputRef}
          id="food-query"
          className="input"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder="예: 김치찌개, 바나나, 카페 라떼"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {load.status === 'loading' && <p className="muted">음식 목록을 불러오는 중이에요…</p>}
      {load.status === 'error' && (
        <div className="stack">
          <p className="field-error" role="alert">
            음식 목록을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.
          </p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setLoad({ status: 'loading' })
              setAttempt((n) => n + 1)
            }}
          >
            다시 불러오기
          </button>
        </div>
      )}

      {load.status === 'ready' && query.trim() === '' && (
        <p className="small muted">
          음식 {load.db.index.length.toLocaleString('ko-KR')}가지에서 찾아요. 포장 가공식품은 들어
          있지 않아서, 없으면 직접 입력을 써 주세요.
        </p>
      )}

      {load.status === 'ready' && query.trim() !== '' && result.total === 0 && (
        <p className="muted">
          '{query.trim()}'에 맞는 음식이 없어요. 더 짧게 검색하거나 직접 입력을 써 주세요.
        </p>
      )}

      {result.items.length > 0 && (
        <>
          <ul className="list food-results" aria-label="검색 결과">
            {result.items.map((f, i) => (
              <li key={`${f.name}|${f.tag}|${f.kcalPer100}|${f.servingSize}|${i}`}>
                <button type="button" className="food-result" onClick={() => pick(f)}>
                  <span className="food-result-main">
                    <span className="food-result-name">{f.name}</span>
                    {f.tag && <span className="food-result-tag">{f.tag}</span>}
                  </span>
                  <span className="small muted num">{servingLabel(f)}</span>
                </button>
              </li>
            ))}
          </ul>
          {result.total > result.items.length && (
            <p className="small muted">
              {result.total.toLocaleString('ko-KR')}건 중 {result.items.length}건만 보여요. 더
              구체적으로 검색해 보세요.
            </p>
          )}
        </>
      )}

      {load.status === 'ready' && (
        <p className="small muted">
          출처: 식품의약품안전처 식품영양성분 데이터({load.db.updated} 기준). 조리법과 양에 따라
          실제 값은 달라요.
        </p>
      )}
    </div>
  )
}
