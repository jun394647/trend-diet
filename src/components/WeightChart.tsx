import { useMemo } from 'react'
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatKorean, formatShort, parseDate, toDateStr } from '../lib/date'
import type { TrendPoint } from '../lib/trend'
import './WeightChart.css'

interface Datum {
  t: number
  date: string
  kg: number
  trend: number
}

/** 목표 체중이 보이는 데이터에서 이 범위(kg) 안에 있을 때만 축에 포함한다. */
const GOAL_NEAR_KG = 3
const Y_PAD_KG = 0.5

const tickStyle = { fill: 'var(--text-2)', fontSize: 12 }

function ChartTip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: Datum }> }) {
  const d = payload?.[0]?.payload
  if (!active || !d) return null
  return (
    <div className="chart-tip">
      <div className="chart-tip-date">{formatKorean(d.date)}</div>
      <div className="chart-tip-row">
        <span>측정</span>
        <span className="num">{d.kg.toFixed(1)} kg</span>
      </div>
      <div className="chart-tip-row">
        <span>추세</span>
        <span className="num">{d.trend.toFixed(1)} kg</span>
      </div>
    </div>
  )
}

function evenTicks(min: number, max: number, count: number): number[] {
  if (max <= min) return [min]
  const day = 86_400_000
  const days = Math.round((max - min) / day)
  const n = Math.min(count, days + 1)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const offset = Math.round((days * i) / (n - 1))
    const d = parseDate(toDateStr(new Date(min)))
    d.setDate(d.getDate() + offset)
    out.push(d.getTime())
  }
  return out
}

/**
 * 체중 차트. 추세선이 주인공이고, 날마다 잰 값은 흐린 점으로만 둔다.
 * 추세선의 끝점(지금 위치)만 크게 찍는다.
 */
export default function WeightChart({ points, goalKg }: { points: TrendPoint[]; goalKg?: number }) {
  const data = useMemo<Datum[]>(
    () => points.map((p) => ({ t: parseDate(p.date).getTime(), date: p.date, kg: p.kg, trend: p.trend })),
    [points],
  )

  const { domain, goalVisible, ticks } = useMemo(() => {
    let lo = Infinity
    let hi = -Infinity
    for (const d of data) {
      lo = Math.min(lo, d.kg, d.trend)
      hi = Math.max(hi, d.kg, d.trend)
    }
    const goalVisible = goalKg !== undefined && goalKg >= lo - GOAL_NEAR_KG && goalKg <= hi + GOAL_NEAR_KG
    if (goalVisible) {
      lo = Math.min(lo, goalKg)
      hi = Math.max(hi, goalKg)
    }
    const domain: [number, number] = [
      Math.floor((lo - Y_PAD_KG) * 2) / 2,
      Math.ceil((hi + Y_PAD_KG) * 2) / 2,
    ]
    const ticks = data.length > 0 ? evenTicks(data[0].t, data[data.length - 1].t, 4) : []
    return { domain, goalVisible, ticks }
  }, [data, goalKg])

  if (data.length === 0) return null
  const lastIndex = data.length - 1
  // 목표선이 위쪽에 있으면 글자를 선 아래에, 아래쪽에 있으면 선 위에 둔다. 추세선 끝점이 있는 오른쪽은 피한다.
  const goalAbove = goalKg !== undefined && goalKg > (domain[0] + domain[1]) / 2

  return (
    <div className="weight-chart">
      <div className="weight-chart-plot" aria-hidden="true">
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              ticks={ticks}
              tickFormatter={(t: number) => formatShort(toDateStr(new Date(t)))}
              tick={tickStyle}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <YAxis
              domain={domain}
              allowDataOverflow
              width={44}
              tickCount={5}
              tickFormatter={(v: number) => v.toFixed(1)}
              tick={tickStyle}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<ChartTip />} cursor={{ stroke: 'var(--text-2)', strokeDasharray: '3 3' }} />
            {goalVisible && goalKg !== undefined && (
              <ReferenceLine
                y={goalKg}
                stroke="var(--mark)"
                strokeWidth={1.5}
                strokeDasharray="6 4"
                label={{
                  value: `목표 ${goalKg.toFixed(1)} kg`,
                  position: goalAbove ? 'insideTopLeft' : 'insideBottomLeft',
                  fill: 'var(--text-2)',
                  fontSize: 12,
                }}
              />
            )}
            <Line
              name="측정"
              dataKey="kg"
              stroke="none"
              dot={{ r: 2.5, fill: 'var(--text-2)', fillOpacity: 0.45, stroke: 'none' }}
              activeDot={{ r: 4, fill: 'var(--text-2)', stroke: 'var(--bg)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
            <Line
              name="추세"
              dataKey="trend"
              type="monotone"
              stroke="var(--accent)"
              strokeWidth={2}
              strokeLinecap="round"
              dot={(p: { cx?: number; cy?: number; index?: number }) =>
                p.index === lastIndex && p.cx != null && p.cy != null ? (
                  <circle
                    key="end"
                    cx={p.cx}
                    cy={p.cy}
                    r={5}
                    fill="var(--accent)"
                    stroke="var(--bg)"
                    strokeWidth={2}
                  />
                ) : (
                  <g key={`p${p.index}`} />
                )
              }
              activeDot={{ r: 5, fill: 'var(--accent)', stroke: 'var(--bg)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="chart-legend" aria-label="범례">
        <li>
          <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden="true">
            <line x1="1" y1="6" x2="19" y2="6" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
            <circle cx="20" cy="6" r="4" fill="var(--accent)" stroke="var(--bg)" strokeWidth="2" />
          </svg>
          추세 (끝점이 지금)
        </li>
        <li>
          <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
            <circle cx="5" cy="6" r="2.5" fill="var(--text-2)" fillOpacity="0.45" />
          </svg>
          잰 값
        </li>
        {goalKg !== undefined && (
          <li>
            <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true">
              <line x1="1" y1="6" x2="19" y2="6" stroke="var(--mark)" strokeWidth="1.5" strokeDasharray="5 3" />
            </svg>
            {goalVisible ? '목표' : `목표 ${goalKg.toFixed(1)} kg (범위 밖)`}
          </li>
        )}
      </ul>
    </div>
  )
}
