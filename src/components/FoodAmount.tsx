import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { kcalFor, nutrientFor, type IndexedFood } from '../lib/foodSearch'
import { MAX_ENTRY_KCAL as MAX_KCAL } from '../lib/quickAdd'
import { fmtKcal } from './today/format'
import './FoodAmount.css'

const MAX_AMOUNT = 5000

export const fmtAmount = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

interface Props {
  picked: IndexedFood
  busy: boolean
  onBack: () => void
  onLog: (meal: { name: string; kcal: number }) => void
}

/** 음식 DB에서 고른 음식의 먹은 양을 정해 기록한다. */
export default function FoodAmount({ picked, busy, onBack, onLog }: Props) {
  const [amountText, setAmountText] = useState(() => fmtAmount(picked.servingSize ?? 100))
  const [amountError, setAmountError] = useState<string | null>(null)
  const amountRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    amountRef.current?.focus()
    amountRef.current?.select()
  }, [])

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
    onLog({ name: title.slice(0, 40), kcal })
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
        <button type="button" className="btn btn--ghost food-picked-back" onClick={onBack}>
          다른 음식 찾기
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
          {kcal !== null ? (
            <>
              {fmtKcal(kcal)}
              <span className="food-total-unit"> kcal</span>
            </>
          ) : (
            '—'
          )}
        </span>
      </div>
      {macros.length > 0 && (
        <dl className="food-macros">
          {macros.map(([label, v]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className="num">
                {v}
                <span className="food-macro-unit">g</span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
        기록하기
      </button>
    </form>
  )
}
