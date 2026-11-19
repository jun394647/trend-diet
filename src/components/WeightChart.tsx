import { useMemo } from 'react'
import {
  Area,
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
const Y_PAD_KG = 0.3
/** 세로축 글자가 차지하는 너비. 섭취 차트와 같아야 두 차트의 그림 영역이 나란히 선다. */
const Y_AXIS_WIDTH = 40
const HEIGHT = 232

interface TickProps {
  x?: number | string
  y?: number | string
  index?: number
  visibleTicksCount?: number
  payload?: { value?: number | string }
}

/**
 * 가로축 눈금 글자. 섭취 차트도 함께 쓴다.
 * edges를 주면 첫 글자는 왼쪽, 마지막 글자는 오른쪽에 맞춰 그림 영역의 양 끝과 나란히 둔다(점이 끝에 닿는 선 차트용).
 */
export function AxisTickX({
  x,
  y,
  index,
  visibleTicksCount,
  payload,
  format,
  edges = false,
}: TickProps & { format: (v: string | number) => string; edges?: boolean }) {
  const last = (visibleTicksCount ?? 0) - 1
  const anchor = !edges ? 'middle' : index === 0 ? 'start' : index === last && last > 0 ? 'end' : 'middle'
  return (
    <text className="chart-tick" x={Number(x)} y={Number(y) + 12} textAnchor={anchor}>
      {format(payload?.value ?? '')}
    </text>
  )
}

/** 세로축 눈금 글자. 구획 제목과 같은 왼쪽 끝에 맞춘다. */
export function AxisTickY({ y, payload, format }: TickProps & { format: (v: number) => string }) {
  return (
    <text className="chart-tick" x={0} y={Number(y)} dy="0.35em" textAnchor="start">
      {format(Number(payload?.value))}
    </text>
  )
}

function ChartTip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: Datum }> }) {
  const d = payload?.[0]?.payload
  if (!active || !d) return null
  return (
    <div className="chart-tip">
      <div className="chart-tip-date">{formatKorean(d.date)}</div>
      <div className="chart-tip-row chart-tip-row--main">
        <span>
          <i className="chart-tip-key chart-tip-key--trend" aria-hidden="true" />
          추세
        </span>
        <span className="num">
          {d.trend.toFixed(1)}
          <small> kg</small>
        </span>
      </div>
      <div className="chart-tip-row">
        <span>
          <i className="chart-tip-key chart-tip-key--raw" aria-hidden="true" />
          측정
        </span>
        <span className="num">
          {d.kg.toFixed(1)}
          <small> kg</small>
        </span>
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

/** 눈금이 0.5나 1, 2처럼 읽기 쉬운 간격으로 서너 줄만 서게 축 범위를 고른다. */
function niceScale(lo: number, hi: number): { domain: [number, number]; ticks: number[]; step: number } {
  const step = [0.5, 1, 2, 5, 10, 20].find((s) => Math.ceil(hi / s) - Math.floor(lo / s) <= 4) ?? 50
  const min = Math.floor(lo / step) * step
  const max = Math.max(min + step, Math.ceil(hi / step) * step)
  const ticks: number[] = []
  for (let v = min; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 10) / 10)
  return { domain: [min, max], ticks, step }
}

/** 목표선의 이름표. 선 바로 위(목표가 위쪽에 있으면 바로 아래) 왼쪽 끝에 두고, 뒤에 바탕색 테두리를 둘러 다른 표시와 겹쳐도 읽히게 한다. */
function GoalLabel({ viewBox, text, below }: { viewBox?: { x?: number; y?: number }; text: string; below: boolean }) {
  if (viewBox?.x == null || viewBox.y == null) return null
  return (
    <text className="chart-goal-label" x={viewBox.x + 2} y={viewBox.y + (below ? 15 : -7)} textAnchor="start">
      {text}
    </text>
  )
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

  const { domain, yTicks, step, goalVisible, ticks } = useMemo(() => {
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
    const scale = niceScale(lo - Y_PAD_KG, hi + Y_PAD_KG)
    const ticks = data.length > 0 ? evenTicks(data[0].t, data[data.length - 1].t, 4) : []
    return { domain: scale.domain, yTicks: scale.ticks, step: scale.step, goalVisible, ticks }
  }, [data, goalKg])

  if (data.length === 0) return null
  const lastIndex = data.length - 1
  // 목표선이 위쪽에 있으면 글자를 선 아래에, 아래쪽에 있으면 선 위에 둔다. 추세선 끝점이 있는 오른쪽은 피한다.
  const goalAbove = goalKg !== undefined && goalKg > (domain[0] + domain[1]) / 2

  return (
    <div className="weight-chart">
      <div className="weight-chart-plot" aria-hidden="true">
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <ComposedChart data={data} margin={{ top: 12, right: 10, bottom: 0, left: 0 }}>
            <defs>
              {/* 추세선 아래를 아주 옅게 받쳐 주는 면. 아래로 갈수록 사라져 축 바닥에 덩어리가 생기지 않는다. */}
              <linearGradient id="weight-chart-fade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--accent)" stopOpacity="0.14" />
                <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              ticks={ticks}
              tick={<AxisTickX edges format={(t) => formatShort(toDateStr(new Date(Number(t))))} />}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              height={28}
              interval={0}
            />
            <YAxis
              domain={domain}
              allowDataOverflow
              width={Y_AXIS_WIDTH}
              ticks={yTicks}
              tick={<AxisTickY format={(v) => (step < 1 ? v.toFixed(1) : String(v))} />}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              content={<ChartTip />}
              cursor={{ stroke: 'var(--text-2)', strokeOpacity: 0.45, strokeWidth: 1 }}
              animationDuration={120}
              offset={14}
              wrapperStyle={{ outline: 'none', zIndex: 2 }}
            />
            <Area
              className="weight-chart-area"
              dataKey="trend"
              type="monotone"
              stroke="none"
              fill="url(#weight-chart-fade)"
              fillOpacity={1}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
              tooltipType="none"
            />
            {goalVisible && goalKg !== undefined && (
              <ReferenceLine
                y={goalKg}
                stroke="var(--mark)"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                label={<GoalLabel text={`목표 ${goalKg.toFixed(1)} kg`} below={goalAbove} />}
              />
            )}
            <Line
              name="측정"
              dataKey="kg"
              stroke="none"
              dot={{ r: 2.25, fill: 'var(--text-2)', fillOpacity: 0.42, stroke: 'none' }}
              activeDot={{ r: 3.5, fill: 'var(--text-2)', stroke: 'var(--bg)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
            <Line
              className="weight-chart-trend"
              name="추세"
              dataKey="trend"
              type="monotone"
              stroke="var(--accent)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={(p: { cx?: number; cy?: number; index?: number }) =>
                p.index === lastIndex && p.cx != null && p.cy != null ? (
                  <circle
                    key="end"
                    className="weight-chart-end"
                    cx={p.cx}
                    cy={p.cy}
                    r={5}
                    fill="var(--accent)"
                    stroke="var(--bg)"
                    strokeWidth={2.5}
                  />
                ) : (
                  <g key={`p${p.index}`} />
                )
              }
              activeDot={{ r: 4.5, fill: 'var(--accent)', stroke: 'var(--bg)', strokeWidth: 2.5 }}
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
          <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true">
            <circle cx="4" cy="6" r="2.5" fill="var(--text-2)" fillOpacity="0.45" />
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
