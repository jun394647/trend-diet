import { targetRange } from '../../lib/sustain'
import { fmtKcal } from './format'

/**
 * 먹은 양이 목표 범위의 어디쯤인지 보여 주는 가로 눈금.
 * 꿀색 띠가 목표 범위이고, 밝은 막대가 지금까지 먹은 양이다.
 */
export default function IntakeGauge({ eaten, targetKcal }: { eaten: number; targetKcal: number }) {
  const { low, high } = targetRange(targetKcal)
  const max = Math.max(high * 1.3, eaten * 1.06)
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`

  return (
    <div
      className="gauge"
      role="img"
      aria-label={`먹은 양 ${fmtKcal(eaten)} kcal, 목표 범위 ${fmtKcal(low)}에서 ${fmtKcal(high)} kcal`}
    >
      <div className="gauge-track">
        <div className="gauge-band" style={{ left: pct(low), width: `calc(${pct(high)} - ${pct(low)})` }} />
        {eaten > 0 && <div className="gauge-fill" style={{ width: pct(eaten) }} />}
        {eaten > 0 && <div className="gauge-dot" style={{ left: pct(eaten) }} />}
      </div>
      <div className="gauge-scale num" aria-hidden="true">
        <span style={{ left: pct(low) }}>{fmtKcal(low)}</span>
        <span style={{ left: pct(high) }}>{fmtKcal(high)}</span>
      </div>
    </div>
  )
}
