import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initInstall, resetInstallForTest } from '../pwa/install'
import { fireInstallPrompt, useIphone, useStandalone } from '../pwa/install.testkit'
import InstallEntry from './InstallEntry'

describe('InstallEntry', () => {
  beforeEach(() => {
    localStorage.clear()
    initInstall()
    resetInstallForTest()
  })
  afterEach(() => vi.restoreAllMocks())

  it('설치할 수 없는 브라우저에서는 아무것도 그리지 않는다', () => {
    const { container } = render(<InstallEntry />)
    expect(container).toBeEmptyDOMElement()
  })

  it('설치할 수 있으면 구획을 보여 주고, 누르면 설치 창을 띄운다', async () => {
    render(<InstallEntry />)
    let fired!: ReturnType<typeof fireInstallPrompt>
    act(() => {
      fired = fireInstallPrompt()
    })
    expect(screen.getByRole('heading', { level: 2, name: '홈 화면에 설치' })).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '홈 화면에 설치하기' }))
    })
    expect(fired.prompt).toHaveBeenCalledTimes(1)
  })

  it('iOS에서는 방법을 시트로 알려 주고, 닫으면 포커스를 돌려준다', () => {
    useIphone()
    resetInstallForTest()
    render(<InstallEntry />)
    const open = screen.getByRole('button', { name: '홈 화면에 추가하는 방법 보기' })
    open.focus()
    fireEvent.click(open)
    const dialog = screen.getByRole('dialog', { name: '홈 화면에 추가하기' })
    expect(dialog).toHaveTextContent('공유 버튼을 눌러요.')
    expect(dialog).toHaveTextContent('홈 화면에 추가를 골라요.')
    expect(screen.getByRole('button', { name: '알겠어요' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(open).toHaveFocus()
  })

  it('다른 앱 안의 브라우저에서는 Safari로 열라고 알려 준다', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) Mobile/15E148 KAKAOTALK 11.0.0')
    resetInstallForTest()
    render(<InstallEntry />)
    fireEvent.click(screen.getByRole('button', { name: '홈 화면에 추가하는 방법 보기' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Safari로 연 다음')
  })

  it('이미 홈 화면 앱으로 열려 있으면 아무것도 그리지 않는다', () => {
    useIphone()
    const restore = useStandalone()
    try {
      resetInstallForTest()
      const { container } = render(<InstallEntry />)
      expect(container).toBeEmptyDOMElement()
    } finally {
      restore()
    }
  })
})
