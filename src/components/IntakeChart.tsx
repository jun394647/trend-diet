import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatKorean, formatShort } from '../lib/date'
import type { DateStr } from '../types'
import './WeightChart.css'
import './IntakeChart.css'

export interface IntakeDatum {
  date: DateStr
  /** 기록이 없는 날은 null (막대를 그리지 않는다). */
  kcal: number | null
}

const tickStyle = { fill: 'var(--text-2)', fontSize: 12 }

function IntakeTip({
  active,
  payload,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: IntakeDatum }>
}) {
  const d = payload?.[0]?.payload
  if (!active || !d || d.kcal === null) return null
  return (
    <div className="chart-tip">
      <div className="chart-tip-date">{formatKorean(d.date)}</div>
      <div className="chart-tip-row">
        <span>섭취</span>
        <span className="num">{d.kcal.toLocaleString('ko-KR')}kcal</span>
      </div>
    </div>
  )
}

export default function IntakeChart({ data, targetKcal }: { data: IntakeDatum[]; targetKcal?: number }) {
  let max = targetKcal ?? 0
  for (const d of data) if (d.kcal !== null) max = Math.max(max, d.kcal)
  const top = Math.max(500, Math.ceil((max * 1.1) / 500) * 500)

  return (
    <div className="intake-chart-plot" aria-hidden="true">
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap={2}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => formatShort(d)}
            interval="preserveStartEnd"
            minTickGap={36}
            tick={tickStyle}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            tickMargin={6}
          />
          <YAxis
            domain={[0, top]}
            width={44}
            tickCount={4}
            tickFormatter={(v: number) => v.toLocaleString('ko-KR')}
            tick={tickStyle}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<IntakeTip />} cursor={{ fill: 'var(--surface-2)' }} />
          <Bar
            dataKey="kcal"
            fill="var(--accent)"
            fillOpacity={0.7}
            radius={[2, 2, 0, 0]}
            maxBarSize={16}
            isAnimationActive={false}
          />
          {targetKcal !== undefined && (
            <ReferenceLine
              y={targetKcal}
              stroke="var(--text-2)"
              strokeDasharray="6 4"
              label={{
                value: `목표 ${targetKcal.toLocaleString('ko-KR')}`,
                position: 'insideBottomRight',
                fill: 'var(--text-2)',
                fontSize: 12,
              }}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
