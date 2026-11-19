import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OFFLINE_MESSAGE, ONLINE_MESSAGE, UPDATED_MESSAGE, consumeUpdateReload, markUpdateReload, startPwaFeedback } from './feedback'
import { useToasts } from './toastStore'

const messages = () => useToasts.getState().toasts.map((t) => t.message)

describe('업데이트와 연결 알림', () => {
  let stop: (() => void) | undefined
  beforeEach(() => {
    useToasts.setState({ toasts: [] })
    sessionStorage.clear()
  })
  afterEach(() => {
    stop?.()
    stop = undefined
    vi.restoreAllMocks()
  })

  it('업데이트 표시는 한 번만 읽힌다', () => {
    expect(consumeUpdateReload()).toBe(false)
    markUpdateReload()
    expect(consumeUpdateReload()).toBe(true)
    expect(consumeUpdateReload()).toBe(false)
  })

  it('자동 업데이트 직후에만 새 버전 알림을 띄운다', () => {
    stop = startPwaFeedback()
    expect(messages()).toEqual([])
    stop()
    markUpdateReload()
    stop = startPwaFeedback()
    expect(messages()).toEqual([UPDATED_MESSAGE])
  })

  it('연결이 끊기면 알리고, 돌아오면 그 알림을 내리고 다시 알린다', () => {
    stop = startPwaFeedback()
    window.dispatchEvent(new Event('offline'))
    expect(messages()).toEqual([OFFLINE_MESSAGE])
    window.dispatchEvent(new Event('online'))
    expect(messages()).toEqual([ONLINE_MESSAGE])
  })

  it('끊긴 적이 없으면 연결 알림은 띄우지 않는다', () => {
    stop = startPwaFeedback()
    window.dispatchEvent(new Event('online'))
    expect(messages()).toEqual([])
  })

  it('끊긴 채로 열면 바로 알린다', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    stop = startPwaFeedback()
    expect(messages()).toEqual([OFFLINE_MESSAGE])
  })

  it('정리한 뒤에는 더 알리지 않는다', () => {
    startPwaFeedback()()
    window.dispatchEvent(new Event('offline'))
    expect(messages()).toEqual([])
  })

  it('저장소를 못 써도 멈추지 않는다', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => markUpdateReload()).not.toThrow()
    expect(consumeUpdateReload()).toBe(false)
  })
})
