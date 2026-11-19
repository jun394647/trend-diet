import { useState } from 'react'
import { openOnLaunchEnabled, setOpenOnLaunch } from '../pwa/openOnLaunch'

/** 설정 화면의 "앱을 열면 식사 추가부터" 스위치. 이 기기에만 남는다. */
export default function OpenOnLaunchSetting() {
  const [on, setOn] = useState(() => openOnLaunchEnabled())
  return (
    <section className="card stack" aria-labelledby="st-launch-title">
      <h2 className="st-title" id="st-launch-title">
        앱을 열 때
      </h2>
      <label className="launch-toggle">
        <span>
          <span className="launch-toggle-title">식사 추가 창부터 열기</span>
          <span className="small muted">앱을 열거나 30분 넘게 지나 돌아오면 바로 먹은 것을 적을 수 있어요.</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked)
            setOpenOnLaunch(e.target.checked)
          }}
        />
      </label>
    </section>
  )
}
