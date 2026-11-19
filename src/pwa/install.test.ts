import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dismissHint,
  initInstall,
  isHintDismissed,
  isInAppBrowser,
  isIos,
  isStandalone,
  promptInstall,
  recordUsageDay,
  resetInstallForTest,
  usageDayCount,
  useInstallMode,
} from './install'
import { fireInstallPrompt, useIphone, useStandalone } from './install.testkit'
import { useToasts } from './toastStore'

describe('설치 상태', () => {
  beforeEach(() => {
    localStorage.clear()
    useToasts.setState({ toasts: [] })
    initInstall()
    resetInstallForTest()
  })
  afterEach(() => vi.restoreAllMocks())

  it('설치 이벤트가 없고 iOS도 아니면 권하지 않는다', () => {
    expect(renderHook(() => useInstallMode()).result.current).toBe('none')
  })

  it('설치 이벤트를 받아 두었다가, 누르면 브라우저 설치 창을 띄운다', async () => {
    const { result } = renderHook(() => useInstallMode())
    let fired!: ReturnType<typeof fireInstallPrompt>
    act(() => {
      fired = fireInstallPrompt('accepted')
    })
    expect(fired.event.defaultPrevented).toBe(true)
    expect(result.current).toBe('prompt')
    let accepted = false
    await act(async () => {
      accepted = await promptInstall()
    })
    expect(accepted).toBe(true)
    expect(fired.prompt).toHaveBeenCalledTimes(1)
    // 받아 둔 이벤트는 한 번만 쓸 수 있다.
    expect(result.current).toBe('none')
    expect(await promptInstall()).toBe(false)
  })

  it('설치 창에서 취소하면 false를 돌려준다', async () => {
    act(() => {
      fireInstallPrompt('dismissed')
    })
    expect(await promptInstall()).toBe(false)
  })

  it('설치가 끝나면 더 권하지 않고 알림을 띄운다', () => {
    const { result } = renderHook(() => useInstallMode())
    act(() => {
      fireInstallPrompt()
      window.dispatchEvent(new Event('appinstalled'))
    })
    expect(result.current).toBe('installed')
    expect(useToasts.getState().toasts.map((t) => t.message)).toEqual(['홈 화면에 설치했어요'])
  })

  it('iOS에서는 방법 안내로 권한다', () => {
    useIphone()
    resetInstallForTest()
    expect(isIos()).toBe(true)
    expect(renderHook(() => useInstallMode()).result.current).toBe('ios')
  })

  it('iPadOS는 Mac이라고 알리지만 터치로 가려낸다', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true })
    try {
      expect(isIos()).toBe(true)
    } finally {
      delete (navigator as { maxTouchPoints?: number }).maxTouchPoints
    }
  })

  it('이미 홈 화면 앱으로 열려 있으면 iOS여도 권하지 않는다', () => {
    useIphone()
    const restore = useStandalone()
    try {
      resetInstallForTest()
      expect(isStandalone()).toBe(true)
      expect(renderHook(() => useInstallMode()).result.current).toBe('installed')
    } finally {
      restore()
    }
  })

  it('display-mode: standalone도 설치된 것으로 본다', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(display-mode: standalone)' }))
    try {
      expect(isStandalone()).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('다른 앱 안의 브라우저를 알아본다', () => {
    expect(isInAppBrowser()).toBe(false)
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 KAKAOTALK 11.0.0')
    expect(isInAppBrowser()).toBe(true)
  })
})

describe('쓴 날 세기와 제안 닫기', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('같은 날은 한 번만 센다', () => {
    recordUsageDay(new Date(2026, 10, 19, 9))
    recordUsageDay(new Date(2026, 10, 19, 22))
    expect(usageDayCount()).toBe(1)
    recordUsageDay(new Date(2026, 10, 20, 7))
    expect(usageDayCount()).toBe(2)
  })

  it('필요한 만큼만 남긴다', () => {
    for (let day = 1; day <= 5; day++) recordUsageDay(new Date(2026, 10, day))
    expect(usageDayCount()).toBe(2)
    expect(JSON.parse(localStorage.getItem('trend-diet:usage-days') ?? '[]')).toEqual(['2026-11-04', '2026-11-05'])
  })

  it('저장된 값이 깨져 있어도 0으로 본다', () => {
    localStorage.setItem('trend-diet:usage-days', '{oops')
    expect(usageDayCount()).toBe(0)
    localStorage.setItem('trend-diet:usage-days', '"2026-11-19"')
    expect(usageDayCount()).toBe(0)
  })

  it('제안을 닫으면 기억한다', () => {
    expect(isHintDismissed()).toBe(false)
    dismissHint()
    expect(isHintDismissed()).toBe(true)
  })

  it('저장소를 못 쓰면 제안을 아예 보여 주지 않는다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(isHintDismissed()).toBe(true)
    expect(usageDayCount()).toBe(0)
    expect(() => recordUsageDay()).not.toThrow()
    expect(() => dismissHint()).not.toThrow()
  })
})
