/** 작은 추세선. 값이 2개 미만이면 아무것도 그리지 않는다. */
export default function Sparkline({ values, height = 44, label }: { values: number[]; height?: number; label: string }) {
  if (values.length < 2) return null
  const w = 100
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pad = 4
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, pad + (1 - (v - min) / span) * (height - pad * 2)] as const)
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const area = `${line} L${w},${height} L0,${height} Z`
  const [ex, ey] = pts[pts.length - 1]
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path className="spark-area" d={area} />
      <path className="spark-line" d={line} vectorEffect="non-scaling-stroke" />
      <circle className="spark-dot" cx={ex} cy={ey} r="3.2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
