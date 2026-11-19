import { armOnLaunch, OPEN_ON_LAUNCH_KEY, onRelaunch, openOnLaunchEnabled, resetOpenOnLaunch, setOpenOnLaunch, takeLaunchOpen } from './openOnLaunch'

const setVisibility = (v: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  localStorage.removeItem(OPEN_ON_LAUNCH_KEY)
  resetOpenOnLaunch()
  vi.useRealTimers()
})

describe('앱을 열면 식사 추가부터', () => {
  it('프로필이 있는 상태로 열면 한 번만 연다', () => {
    armOnLaunch(true)
    expect(takeLaunchOpen()).toBe(true)
    expect(takeLaunchOpen()).toBe(false)
  })

  it('화면이 먼저 그려져 기다리고 있으면 열 차례가 됐을 때 알린다', () => {
    const cb = vi.fn()
    const off = onRelaunch(cb)
    armOnLaunch(true)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(takeLaunchOpen()).toBe(true)
    off()
  })

  it('방금 시작 설정을 한 경우에는 열지 않는다', () => {
    armOnLaunch(false)
    expect(takeLaunchOpen()).toBe(false)
  })

  it('설정에서 끄면 열지 않는다', () => {
    setOpenOnLaunch(false)
    expect(openOnLaunchEnabled()).toBe(false)
    armOnLaunch(true)
    expect(takeLaunchOpen()).toBe(false)
    setOpenOnLaunch(true)
    expect(openOnLaunchEnabled()).toBe(true)
  })

  it('30분 넘게 다른 일을 하다 돌아오면 다시 연다. 잠깐 다녀온 것은 아니다', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-04T09:00:00'))
    armOnLaunch(true)
    takeLaunchOpen()
    const cb = vi.fn()
    const off = onRelaunch(cb)

    setVisibility('hidden')
    vi.setSystemTime(new Date('2026-03-04T09:05:00'))
    setVisibility('visible')
    expect(takeLaunchOpen()).toBe(false)
    expect(cb).not.toHaveBeenCalled()

    setVisibility('hidden')
    vi.setSystemTime(new Date('2026-03-04T09:40:00'))
    setVisibility('visible')
    expect(cb).toHaveBeenCalledTimes(1)
    expect(takeLaunchOpen()).toBe(true)
    off()
  })
})
