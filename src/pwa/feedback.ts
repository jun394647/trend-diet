import { dismissToast, toast } from './toastStore'

// 새 버전을 받아 화면을 새로 띄우기 직전에 남기는 표시. 새로 뜬 화면이 읽고 지운다.
const UPDATED_KEY = 'trend-diet:updated'

export const UPDATED_MESSAGE = '새 버전으로 바뀌었어요'
export const OFFLINE_MESSAGE = '오프라인이에요. 기록은 이 기기에 저장돼요.'
export const ONLINE_MESSAGE = '다시 연결됐어요'

/** 자동 업데이트로 화면을 새로 띄우기 직전에 부른다(main.tsx). */
export function markUpdateReload(): void {
  try {
    sessionStorage.setItem(UPDATED_KEY, '1')
  } catch {
    // 저장소를 못 쓰면 알림만 건너뛴다.
  }
}

/** 방금 자동 업데이트로 새로 뜬 화면인지 한 번만 알려 준다. */
export function consumeUpdateReload(): boolean {
  try {
    if (sessionStorage.getItem(UPDATED_KEY) === null) return false
    sessionStorage.removeItem(UPDATED_KEY)
    return true
  } catch {
    return false
  }
}

/**
 * 업데이트와 연결 상태를 알림으로 알려 준다. 앱이 뜰 때 한 번 부르고, 돌려받은 함수로 정리한다.
 * - 자동 업데이트 직후: "새 버전으로 바뀌었어요"
 * - 연결이 끊기면(끊긴 채로 열었을 때도): "오프라인이에요. 기록은 이 기기에 저장돼요."
 * - 끊겼다가 돌아오면: "다시 연결됐어요"
 */
export function startPwaFeedback(): () => void {
  if (consumeUpdateReload()) toast(UPDATED_MESSAGE)

  let wasOffline = typeof navigator !== 'undefined' && navigator.onLine === false
  let offlineToast: number | null = wasOffline ? toast(OFFLINE_MESSAGE, { duration: 6000 }) : null

  const onOffline = () => {
    wasOffline = true
    offlineToast = toast(OFFLINE_MESSAGE, { duration: 6000 })
  }
  const onOnline = () => {
    if (!wasOffline) return
    wasOffline = false
    // 아직 떠 있는 오프라인 알림은 이제 틀린 말이므로 내리고 바꿔 띄운다.
    if (offlineToast !== null) dismissToast(offlineToast)
    offlineToast = null
    toast(ONLINE_MESSAGE)
  }
  window.addEventListener('offline', onOffline)
  window.addEventListener('online', onOnline)
  return () => {
    window.removeEventListener('offline', onOffline)
    window.removeEventListener('online', onOnline)
  }
}
