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
import './WeightChart.css'
import './IntakeChart.css'

export interface IntakeDatum {
  date: DateStr
  /** 기록이 없는 날은 null (막대를 그리지 않는다). */
  kcal: number | null
}

const tickStyle = { fill: 'var(--text-2)', fontSize: 12 }
const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

const STATE_FILL: Record<IntakeState, string> = {
  in: 'var(--accent)',
  over: 'var(--warn)',
  under: 'color-mix(in srgb, var(--accent) 45%, var(--bg))',
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
  return (
    <div className="chart-tip">
      <div className="chart-tip-date">{formatKorean(d.date)}</div>
      <div className="chart-tip-row">
        <span>섭취</span>
        <span className="num">{fmt(d.kcal)} kcal</span>
      </div>
      {targetKcal !== undefined && <div className="chart-tip-state">{STATE_TEXT[intakeState(d.kcal, targetKcal)]}</div>}
    </div>
  )
}

/**
 * 하루 섭취 막대 차트. 꿀색 띠가 목표 범위이고, 막대 끝이 띠 안에 있으면 범위 안이다.
 * 막대 색은 범위 안/많음/적음을 나타내지만, 같은 내용을 툴팁과 범례의 글자로도 알려 준다.
 */
export default function IntakeChart({ data, targetKcal }: { data: IntakeDatum[]; targetKcal?: number }) {
  const range = targetKcal !== undefined ? targetRange(targetKcal) : null
  let max = range?.high ?? 0
  for (const d of data) if (d.kcal !== null) max = Math.max(max, d.kcal)
  // 눈금이 고르게 떨어지도록 축 끝을 1,000 단위로 맞춘다.
  const top = Math.max(1000, Math.ceil((max * 1.05) / 1000) * 1000)
  const yTicks = Array.from({ length: top / 1000 + 1 }, (_, i) => i * 1000)

  return (
    <div className="intake-chart">
      <div className="intake-chart-plot" aria-hidden="true">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barCategoryGap="22%">
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => formatShort(d)}
              interval="preserveStartEnd"
              minTickGap={36}
              tick={tickStyle}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <YAxis
              domain={[0, top]}
              width={44}
              ticks={yTicks}
              tickFormatter={(v: number) => v.toLocaleString('ko-KR')}
              tick={tickStyle}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<IntakeTip targetKcal={targetKcal} />} cursor={{ fill: 'var(--surface-2)' }} />
            {range && <ReferenceArea y1={range.low} y2={range.high} fill="var(--mark-soft)" fillOpacity={1} stroke="none" />}
            {range && <ReferenceLine y={range.low} stroke="var(--mark)" strokeWidth={1.5} strokeDasharray="5 4" />}
            {range && <ReferenceLine y={range.high} stroke="var(--mark)" strokeWidth={1.5} strokeDasharray="5 4" />}
            <Bar dataKey="kcal" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false}>
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
