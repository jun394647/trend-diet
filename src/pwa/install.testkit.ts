import { vi } from 'vitest'

export const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'

/** 테스트에서 Chromium의 설치 가능 이벤트를 흉내 낸다. */
export function fireInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const prompt = vi.fn(() => Promise.resolve())
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome }),
  })
  window.dispatchEvent(event)
  return { prompt, event }
}

export function useIphone() {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE_UA)
}

/** 홈 화면 앱으로 열린 상태(iOS의 navigator.standalone)를 흉내 낸다. 돌려받은 함수로 되돌린다. */
export function useStandalone(): () => void {
  Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
  return () => {
    delete (navigator as { standalone?: boolean }).standalone
  }
}
