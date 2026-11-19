import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * 홈 화면 아이콘을 길게 눌러 고르는 바로가기가 요청하는 동작.
 * 주소는 `#/?action=add-meal`, `#/?action=weight` (vite.config.ts의 manifest.shortcuts와 짝이다).
 */
export type LaunchAction = 'add-meal' | 'weight'

export const LAUNCH_PARAM = 'action'

const parse = (value: string | null): LaunchAction | null => (value === 'add-meal' || value === 'weight' ? value : null)

/**
 * 바로가기로 열렸으면 요청된 동작을 한 번만 돌려준다. 그 밖에는 늘 null이다.
 * 읽은 뒤에는 주소에서 지우므로, 새로 고치거나 뒤로 돌아와도 다시 실행되지 않는다.
 *
 *   const launch = useLaunchAction()
 *   useEffect(() => {
 *     if (launch === 'add-meal') setSheetOpen(true)
 *   }, [launch])
 *
 * 라우터 안에서만 쓸 수 있다.
 */
export function useLaunchAction(): LaunchAction | null {
  const [params, setParams] = useSearchParams()
  const [action, setAction] = useState<LaunchAction | null>(null)
  const requested = params.get(LAUNCH_PARAM)

  useEffect(() => {
    if (requested === null) return
    const next = parse(requested)
    if (next) setAction(next)
    setParams(
      (prev) => {
        const rest = new URLSearchParams(prev)
        rest.delete(LAUNCH_PARAM)
        return rest
      },
      { replace: true },
    )
  }, [requested, setParams])

  // 한 번 전달했으면 비운다. 앱을 켜 둔 채 같은 바로가기를 다시 눌러도 또 전달된다.
  useEffect(() => {
    if (action !== null) setAction(null)
  }, [action])

  return action
}
