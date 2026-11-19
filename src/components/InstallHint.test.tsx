import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initInstall, isHintDismissed, recordUsageDay, resetInstallForTest } from '../pwa/install'
import { fireInstallPrompt, useIphone, useStandalone } from '../pwa/install.testkit'
import InstallHint from './InstallHint'

const useTwoDays = () => {
  recordUsageDay(new Date(2026, 10, 18))
  recordUsageDay(new Date(2026, 10, 19))
}

describe('InstallHint', () => {
  beforeEach(() => {
    localStorage.clear()
    initInstall()
    resetInstallForTest()
  })
  afterEach(() => vi.restoreAllMocks())

  it('처음 쓰는 날에는 설치할 수 있어도 보이지 않는다', () => {
    recordUsageDay()
    const { container } = render(<InstallHint />)
    act(() => {
      fireInstallPrompt()
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('이틀 썼어도 설치할 수 없는 브라우저에서는 보이지 않는다', () => {
    useTwoDays()
    const { container } = render(<InstallHint />)
    expect(container).toBeEmptyDOMElement()
  })

  it('서로 다른 이틀을 쓴 뒤 설치할 수 있으면 보이고, 설치를 누르면 창을 띄운 뒤 사라진다', async () => {
    useTwoDays()
    render(<InstallHint />)
    let fired!: ReturnType<typeof fireInstallPrompt>
    act(() => {
      fired = fireInstallPrompt('dismissed')
    })
    expect(screen.getByRole('complementary', { name: '앱 설치 제안' })).toHaveTextContent('홈 화면에 설치')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '홈 화면에 설치하기' }))
    })
    expect(fired.prompt).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(isHintDismissed()).toBe(true)
  })

  it('닫으면 다시는 뜨지 않는다', () => {
    useTwoDays()
    const first = render(<InstallHint />)
    act(() => {
      fireInstallPrompt()
    })
    fireEvent.click(screen.getByRole('button', { name: '설치 제안 닫기' }))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    first.unmount()

    const again = render(<InstallHint />)
    act(() => {
      fireInstallPrompt()
    })
    expect(again.container).toBeEmptyDOMElement()
  })

  it('iOS에서는 방법 시트를 열고, 시트를 닫으면 제안도 끝난다', () => {
    useTwoDays()
    useIphone()
    resetInstallForTest()
    render(<InstallHint />)
    fireEvent.click(screen.getByRole('button', { name: '홈 화면에 추가하는 방법 보기' }))
    expect(screen.getByRole('dialog', { name: '홈 화면에 추가하기' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '알겠어요' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(isHintDismissed()).toBe(true)
  })

  it('이미 홈 화면 앱으로 열려 있으면 보이지 않는다', () => {
    useTwoDays()
    useIphone()
    const restore = useStandalone()
    try {
      resetInstallForTest()
      const { container } = render(<InstallHint />)
      expect(container).toBeEmptyDOMElement()
    } finally {
      restore()
    }
  })
})
