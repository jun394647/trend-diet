/**
 * 앱을 열면 식사 추가 창부터 보여 준다. 기록을 빨리 하게 하려는 것이다.
 *
 * "앱을 열었다"로 보는 경우:
 *  - 앱을 처음 불러왔고, 그때 이미 시작 설정(프로필)이 끝나 있을 때. 방금 온보딩을 마친 경우는 넣지 않는다.
 *  - 앱을 닫지 않고 다른 일을 하다가 30분 넘게 지나 돌아왔을 때(휴대폰에 설치한 앱은 대개 이렇게 다시 열린다).
 * 설정에서 끌 수 있고, 그 선택은 이 기기에 남는다.
 */

/** 이 기기에 남기는 설정의 이름. 값은 'off'일 때만 끈 것이다. */
export const OPEN_ON_LAUNCH_KEY = 'trend-diet:open-meal-on-launch'
/** 이만큼 넘게 다른 일을 하다 돌아오면 다시 연 것으로 본다. */
export const REOPEN_AFTER_MS = 30 * 60 * 1000

export function openOnLaunchEnabled(): boolean {
  try {
    return localStorage.getItem(OPEN_ON_LAUNCH_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setOpenOnLaunch(on: boolean): void {
  try {
    if (on) localStorage.removeItem(OPEN_ON_LAUNCH_KEY)
    else localStorage.setItem(OPEN_ON_LAUNCH_KEY, 'off')
  } catch {
    // 저장하지 못해도 이번에는 그대로 둔다.
  }
}

let armed = false
let hiddenAt: number | null = null
let listening = false
const listeners = new Set<() => void>()

/** 앱이 처음 기록을 다 읽은 뒤 한 번 부른다. 그때 프로필이 있어야만 열 준비를 한다. */
export function armOnLaunch(hasProfile: boolean): void {
  armed = hasProfile && openOnLaunchEnabled()
  // 홈 화면이 이미 그려져 있으면 바로 알린다(기록을 읽는 것과 화면을 그리는 것 중 어느 쪽이 먼저 끝날지 모른다).
  if (armed) listeners.forEach((cb) => cb())
  if (listening || typeof document === 'undefined') return
  listening = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now()
    } else if (hiddenAt !== null && Date.now() - hiddenAt > REOPEN_AFTER_MS && openOnLaunchEnabled()) {
      armed = true
      listeners.forEach((cb) => cb())
    }
  })
}

/** 열 차례면 true를 돌려주고 차례를 쓴다. 한 번 연 뒤에는 다시 열 때까지 false다. */
export function takeLaunchOpen(): boolean {
  if (!armed) return false
  armed = false
  return true
}

/** 열 차례가 됐을 때(처음 열었을 때와 다시 돌아왔을 때) 불린다. 해제 함수를 돌려준다. */
export function onRelaunch(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** 테스트용. */
export function resetOpenOnLaunch(): void {
  armed = false
  hiddenAt = null
}
