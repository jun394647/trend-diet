import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast, useToasts } from '../pwa/toastStore'
import ToastRegion from './Toast'

describe('ToastRegion', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToasts.setState({ toasts: [] })
  })
  afterEach(() => vi.useRealTimers())

  it('알림이 없어도 화면 낭독기용 영역은 있다', () => {
    render(<ToastRegion />)
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toBeEmptyDOMElement()
  })

  it('알림을 보여 주고 시간이 지나면 스스로 내린다', () => {
    render(<ToastRegion />)
    act(() => {
      toast('다시 연결됐어요')
    })
    expect(screen.getByRole('status')).toHaveTextContent('다시 연결됐어요')
    act(() => {
      vi.advanceTimersByTime(3999)
    })
    expect(screen.getByText('다시 연결됐어요')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByText('다시 연결됐어요')).not.toBeInTheDocument()
  })

  it('셋을 연달아 띄워도 둘까지만 보인다', () => {
    render(<ToastRegion />)
    act(() => {
      toast('하나')
      toast('둘')
      toast('셋')
    })
    expect(screen.queryByText('하나')).not.toBeInTheDocument()
    expect(screen.getByText('둘')).toBeInTheDocument()
    expect(screen.getByText('셋')).toBeInTheDocument()
  })

  it('버튼을 누르면 동작을 실행하고 알림을 내린다', () => {
    const undo = vi.fn()
    render(<ToastRegion />)
    act(() => {
      toast('지웠어요', { action: { label: '되돌리기', onClick: undo } })
    })
    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    expect(undo).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('지웠어요')).not.toBeInTheDocument()
  })
})
