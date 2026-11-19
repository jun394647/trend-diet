import { intakeState, targetRange } from '../../lib/sustain'
import { fmtKcal } from './format'

/**
 * 먹은 양이 목표 범위의 어디쯤인지 보여 주는 가로 눈금.
 * 꿀색 구간이 목표 범위이고, 밝은 막대와 그 끝의 표식이 지금까지 먹은 양이다.
 */
export default function IntakeGauge({ eaten, targetKcal }: { eaten: number; targetKcal: number }) {
  const { low, high } = targetRange(targetKcal)
  const max = Math.max(high * 1.3, eaten * 1.06)
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`
  const band = { left: pct(low), width: `calc(${pct(high)} - ${pct(low)})` }

  return (
    <div
      className={`gauge gauge--${intakeState(eaten, targetKcal)}`}
      role="img"
      aria-label={`먹은 양 ${fmtKcal(eaten)} kcal, 목표 범위 ${fmtKcal(low)}에서 ${fmtKcal(high)} kcal`}
    >
      <div className="gauge-track">
        <div className="gauge-band" style={band} />
        {eaten > 0 && <div className="gauge-fill" style={{ width: pct(eaten) }} />}
        {/* 범위의 양 끝 눈금은 막대 위에 그려, 막대가 범위에 들어가도 어디부터 어디까지인지 보이게 한다. */}
        <div className="gauge-band-ends" style={band} />
        {eaten > 0 && <div className="gauge-dot" style={{ left: pct(eaten) }} />}
      </div>
      {/* 범위가 좁아 양 끝 숫자를 따로 두면 겹치므로 구간 가운데 아래에 한 번만 적는다. */}
      <div className="gauge-scale num" aria-hidden="true">
        <span className="gauge-zero">0</span>
        <span className="gauge-range" style={{ left: `clamp(56px, ${pct(targetKcal)}, calc(100% - 56px))` }}>
          {fmtKcal(low)}~{fmtKcal(high)}
        </span>
      </div>
    </div>
  )
}
