import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatKorean, formatShort } from '../lib/date'
import { intakeState, targetRange, type IntakeState } from '../lib/sustain'
import type { DateStr } from '../types'
import { AxisTickX, AxisTickY } from './WeightChart'
import './WeightChart.css'
import './IntakeChart.css'

export interface IntakeDatum {
  date: DateStr
  /** 기록이 없는 날은 null (막대를 그리지 않는다). */
  kcal: number | null
}

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')
/** 체중 차트의 세로축 너비와 같다. */
const Y_AXIS_WIDTH = 40
const HEIGHT = 184

const STATE_FILL: Record<IntakeState, string> = {
  in: 'var(--accent)',
  over: 'var(--warn)',
  under: 'color-mix(in srgb, var(--accent) 42%, var(--bg))',
}
const STATE_TEXT: Record<IntakeState, string> = {
  in: '목표 범위 안',
  over: '목표 범위보다 많음',
  under: '목표 범위보다 적음',
}

function IntakeTip({
  active,
  payload,
  targetKcal,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: IntakeDatum }>
  targetKcal?: number
}) {
  const d = payload?.[0]?.payload
  if (!active || !d || d.kcal === null) return null
  const state = targetKcal !== undefined ? intakeState(d.kcal, targetKcal) : null
  return (
    <div className="chart-tip">
      <div className="chart-tip-date">{formatKorean(d.date)}</div>
      <div className="chart-tip-row chart-tip-row--main">
        <span>섭취</span>
        <span className="num">
          {fmt(d.kcal)}
          <small> kcal</small>
        </span>
      </div>
      {state && (
        <div className="chart-tip-state">
          <span className={`intake-key intake-key--${state}`} aria-hidden="true" />
          {STATE_TEXT[state]}
        </div>
      )}
    </div>
  )
}

/** 첫날과 마지막 날을 포함해 고르게 떨어진 날짜 눈금. */
function evenDates(data: IntakeDatum[], count: number): DateStr[] {
  const last = data.length - 1
  if (last <= 0) return data.map((d) => d.date)
  const n = Math.min(count, data.length)
  const out: DateStr[] = []
  for (let i = 0; i < n; i++) out.push(data[Math.round((last * i) / (n - 1))].date)
  return out
}

/**
 * 하루 섭취 막대 차트. 꿀색 띠가 목표 범위이고, 막대 끝이 띠 안에 있으면 범위 안이다.
 * 막대 색은 범위 안/많음/적음을 나타내지만, 같은 내용을 툴팁과 범례의 글자로도 알려 준다.
 */
export default function IntakeChart({ data, targetKcal }: { data: IntakeDatum[]; targetKcal?: number }) {
  const range = targetKcal !== undefined ? targetRange(targetKcal) : null
  let max = range?.high ?? 0
  for (const d of data) if (d.kcal !== null) max = Math.max(max, d.kcal)
  // 눈금은 1,000 단위로 두고, 많아지면 한 칸을 넓힌다.
  // 축 끝은 500 단위로 잡아, 가장 큰 막대 위에 빈 칸이 한 줄씩 남지 않게 한다.
  const top = Math.max(1000, Math.ceil((max * 1.03) / 500) * 500)
  const yStep = top > 4500 ? 2000 : 1000
  const yTicks: number[] = []
  for (let v = 0; v <= top; v += yStep) yTicks.push(v)
  const xTicks = evenDates(data, 4)
  // 날이 많아 막대가 가늘어지면 모서리도 덜 둥글린다.
  const radius = data.length > 45 ? 1.5 : 3

  return (
    <div className="intake-chart">
      <div className="intake-chart-plot" aria-hidden="true">
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <BarChart data={data} margin={{ top: 12, right: 10, bottom: 0, left: 0 }} barCategoryGap={data.length > 45 ? '16%' : '30%'}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="date"
              ticks={xTicks}
              interval={0}
              tick={<AxisTickX format={(d) => formatShort(String(d))} />}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              height={28}
            />
            <YAxis
              domain={[0, top]}
              width={Y_AXIS_WIDTH}
              ticks={yTicks}
              tick={<AxisTickY format={(v) => v.toLocaleString('ko-KR')} />}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              content={<IntakeTip targetKcal={targetKcal} />}
              cursor={{ fill: 'var(--text-2)', fillOpacity: 0.1 }}
              animationDuration={120}
              offset={14}
              wrapperStyle={{ outline: 'none', zIndex: 2 }}
            />
            {range && <ReferenceArea y1={range.low} y2={range.high} fill="var(--mark-soft)" fillOpacity={1} stroke="none" />}
            {range && <ReferenceLine y={range.low} stroke="var(--mark)" strokeOpacity={0.75} strokeWidth={1} strokeDasharray="4 3" />}
            {range && <ReferenceLine y={range.high} stroke="var(--mark)" strokeOpacity={0.75} strokeWidth={1} strokeDasharray="4 3" />}
            <Bar className="intake-chart-bars" dataKey="kcal" radius={[radius, radius, 0, 0]} maxBarSize={14} isAnimationActive={false}>
              {data.map((d) => (
                <Cell
                  key={d.date}
                  fill={
                    d.kcal !== null && targetKcal !== undefined
                      ? STATE_FILL[intakeState(d.kcal, targetKcal)]
                      : 'var(--accent)'
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {range && (
        <ul className="chart-legend" aria-label="범례">
          <li>
            <span className="intake-key intake-key--band" aria-hidden="true" />
            목표 범위{' '}
            <span className="num">
              {fmt(range.low)}~{fmt(range.high)}
            </span>
          </li>
          <li>
            <span className="intake-key intake-key--in" aria-hidden="true" />
            범위 안
          </li>
          <li>
            <span className="intake-key intake-key--over" aria-hidden="true" />
            많음
          </li>
          <li>
            <span className="intake-key intake-key--under" aria-hidden="true" />
            적음
          </li>
        </ul>
      )}
    </div>
  )
}
