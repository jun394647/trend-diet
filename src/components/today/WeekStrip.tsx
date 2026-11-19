import type { CSSProperties } from 'react'
import { parseDate } from '../../lib/date'
import { targetRange, type WeekSummary } from '../../lib/sustain'
import type { DateStr } from '../../types'
import { fmtKcal } from './format'

const DOW = ['일', '월', '화', '수', '목', '금', '토']
const STATE_TEXT = { in: '범위 안', over: '범위보다 많음', under: '범위보다 적음', none: '식사 기록 없음', future: '' }

interface Props {
  week: WeekSummary
  targetKcal: number
  selected: DateStr
  today: DateStr
  onSelect: (date: DateStr) => void
}

/** 한 주를 일곱 칸으로 보여 준다. 가로 띠가 목표 범위이고, 막대가 띠에 닿으면 범위 안이다. */
export default function WeekStrip({ week, targetKcal, selected, today, onSelect }: Props) {
  const { low, high } = targetRange(targetKcal)
  const max = Math.max(high * 1.25, ...week.days.map((d) => (d.kcal ?? 0) * 1.05))
  const pct = (v: number) => (v / max) * 100

  return (
    <div className="week">
      <div className="week-plot">
        <div
          className="week-band"
          style={{ '--lo': pct(low) / 100, '--hi': pct(high) / 100 } as CSSProperties}
          aria-hidden="true"
        />
        {week.days.map((d, i) => {
          const dow = DOW[parseDate(d.date).getDay()]
          const future = d.state === 'future'
          const label = future
            ? `${dow}요일`
            : `${dow}요일, ${d.kcal === null ? STATE_TEXT.none : `${fmtKcal(d.kcal)} kcal, ${STATE_TEXT[d.state]}`}${d.weighed ? ', 체중 기록함' : ''}`
          return (
            <button
              key={d.date}
              type="button"
              className={`week-day week-day--${d.state}${d.date === selected ? ' is-selected' : ''}${d.date === today ? ' is-today' : ''}`}
              disabled={future}
              aria-label={label}
              aria-pressed={d.date === selected}
              onClick={() => onSelect(d.date)}
            >
              <span
                className="week-bar-slot"
                aria-hidden="true"
                style={{ '--h': `${Math.max(4, pct(d.kcal ?? 0))}%`, '--i': i } as CSSProperties}
              >
                {d.kcal !== null ? (
                  <>
                    {/* 고른 날은 막대 위에 그날 먹은 양을 작게 적는다. */}
                    {d.date === selected && <span className="week-val num">{fmtKcal(d.kcal)}</span>}
                    <span className="week-bar" />
                  </>
                ) : (
                  !future && <span className="week-empty" />
                )}
              </span>
              <span className="week-dow" aria-hidden="true">
                {dow}
              </span>
              <span className={`week-weighed${d.weighed ? ' is-on' : ''}`} aria-hidden="true" />
            </button>
          )
        })}
      </div>
      <p className="week-legend small muted" aria-hidden="true">
        <span className="week-legend-band" /> 목표 범위
        <span className="week-legend-dot" /> 체중 잰 날
      </p>
    </div>
  )
}
