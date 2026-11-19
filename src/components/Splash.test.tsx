import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import html from '../../index.html?raw'
import Splash from './Splash'

describe('Splash', () => {
  it('앱 이름을 보여 주고, 불러오는 중임을 화면 낭독기에 알린다', () => {
    render(<Splash />)
    expect(screen.getByRole('status', { name: '불러오는 중' })).toHaveTextContent('추세 다이어트')
  })

  it('index.html에 미리 그려 둔 스플래시와 구조가 같다', () => {
    const { container } = render(<Splash />)
    const splash = container.firstElementChild!
    expect(html).toContain(`class="${splash.className}"`)
    for (const child of splash.children) expect(html).toContain(`class="${child.getAttribute('class')}"`)
    // 표식의 선 모양도 같아야 넘어갈 때 어긋나 보이지 않는다.
    expect(html).toContain(`d="${splash.querySelector('path')!.getAttribute('d')}"`)
    expect(html).toContain(splash.querySelector('p')!.textContent)
  })
})
