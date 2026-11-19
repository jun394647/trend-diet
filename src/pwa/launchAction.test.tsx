import { render, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { useLaunchAction } from './launchAction'
import type { LaunchAction } from './launchAction'

let go: (to: string) => void = () => {}

function Probe() {
  const launch = useLaunchAction()
  const [seen, setSeen] = useState<LaunchAction[]>([])
  const { search } = useLocation()
  go = useNavigate()
  useEffect(() => {
    if (launch) setSeen((list) => [...list, launch])
  }, [launch])
  return (
    <p>
      <span data-testid="seen">{seen.join(',')}</span>
      <span data-testid="search">{search}</span>
    </p>
  )
}

const open = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Probe />
    </MemoryRouter>,
  )

describe('useLaunchAction', () => {
  it('바로가기 없이 열면 아무것도 전달하지 않는다', () => {
    open('/')
    expect(screen.getByTestId('seen')).toHaveTextContent('')
  })

  it('식사 추가 바로가기를 한 번만 전달하고 주소에서 지운다', () => {
    open('/?action=add-meal')
    expect(screen.getByTestId('seen')).toHaveTextContent(/^add-meal$/)
    expect(screen.getByTestId('search')).toHaveTextContent('')
  })

  it('체중 기록 바로가기를 전달하고, 다른 값은 그대로 둔다', () => {
    open('/?action=weight&date=2026-11-19')
    expect(screen.getByTestId('seen')).toHaveTextContent(/^weight$/)
    expect(screen.getByTestId('search')).toHaveTextContent('?date=2026-11-19')
  })

  it('모르는 값은 전달하지 않고 지운다', () => {
    open('/?action=delete-everything')
    expect(screen.getByTestId('seen')).toHaveTextContent('')
    expect(screen.getByTestId('search')).toHaveTextContent('')
  })

  it('앱을 켜 둔 채 같은 바로가기를 다시 눌러도 또 전달한다', () => {
    open('/?action=add-meal')
    act(() => go('/?action=add-meal'))
    expect(screen.getByTestId('seen')).toHaveTextContent(/^add-meal,add-meal$/)
  })
})
