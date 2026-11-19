import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_TOASTS, dismissToast, toast, useToasts } from './toastStore'

const messages = () => useToasts.getState().toasts.map((t) => t.message)

describe('toast', () => {
  beforeEach(() => useToasts.setState({ toasts: [] }))

  it('부르면 알림이 하나 쌓인다', () => {
    toast('저장했어요')
    expect(messages()).toEqual(['저장했어요'])
    expect(useToasts.getState().toasts[0].duration).toBe(4000)
  })

  it('두 개까지만 보여 주고, 더 오면 오래된 것부터 내린다', () => {
    toast('하나')
    toast('둘')
    toast('셋')
    expect(messages()).toEqual(['둘', '셋'])
    expect(messages()).toHaveLength(MAX_TOASTS)
  })

  it('같은 문구는 겹쳐 쌓지 않는다', () => {
    toast('오프라인이에요')
    toast('다른 알림')
    toast('오프라인이에요')
    expect(messages()).toEqual(['다른 알림', '오프라인이에요'])
  })

  it('버튼이 있으면 더 오래 떠 있고, 시간을 직접 정할 수도 있다', () => {
    toast('지웠어요', { action: { label: '되돌리기', onClick: () => {} } })
    toast('잠깐', { duration: 1000 })
    const [withAction, short] = useToasts.getState().toasts
    expect(withAction.duration).toBe(7000)
    expect(withAction.action?.label).toBe('되돌리기')
    expect(short.duration).toBe(1000)
  })

  it('id로 내릴 수 있다', () => {
    const id = toast('하나')
    toast('둘')
    dismissToast(id)
    expect(messages()).toEqual(['둘'])
  })
})
