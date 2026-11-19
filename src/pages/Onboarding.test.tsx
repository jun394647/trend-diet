import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { today } from '../lib/date'
import { useStore } from '../store'
import Onboarding from './Onboarding'

const birthYear = String(new Date().getFullYear() - 30)

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const pickPace = (name: string | RegExp) => fireEvent.click(screen.getByRole('radio', { name }))
const fmt = (n: number) => n.toLocaleString('ko-KR')

function fillBody(weight = '80') {
  click('남성')
  type('태어난 해', birthYear)
  type('키', '175')
  type('현재 체중', weight)
}

beforeEach(async () => {
  // jsdom에는 scrollTo가 구현되어 있지 않다.
  vi.stubGlobal('scrollTo', vi.fn())
  await useStore.getState().resetAll()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Onboarding', () => {
  it('단계를 끝까지 진행하면 프로필과 첫 계획이 저장된다', async () => {
    render(<Onboarding />)

    expect(screen.getByText(/이 기기에만 저장/)).toBeInTheDocument()
    click('시작하기')

    fillBody()
    click('다음')

    click(/주 3~5회 운동/)
    click('다음')

    type('목표 체중', '72')
    // 보통(0.5kg)이 미리 골라져 있고, 그 속도의 하루 적자를 알려 준다.
    expect(screen.getByRole('radio', { name: /보통/ })).toBeChecked()
    expect(screen.getByTestId('pace-deficit')).toHaveTextContent('약 550kcal 적게')
    click('다음')

    // 결과 미리보기
    expect(screen.getByRole('heading', { name: '이렇게 시작해요' })).toBeInTheDocument()
    expect(screen.getByTestId('tdee-kcal').textContent).toMatch(/kcal/)
    expect(screen.getByText(/의학적 조언이 아니에요/)).toBeInTheDocument()
    expect(screen.getByText('목표 체중 도달 예상')).toBeInTheDocument()
    expect(screen.getByText(/한 주 평균으로 봐요/)).toBeInTheDocument()
    expect(screen.getByText(/10주쯤 이어지면 2주 쉬어 가기/)).toBeInTheDocument()
    const shown = screen.getByTestId('target-range').textContent

    click('이 계획으로 시작하기')

    await waitFor(() => expect(useStore.getState().profile).not.toBeNull())
    const s = useStore.getState()
    expect(s.profile).toMatchObject({
      sex: 'M',
      birthYear: Number(birthYear),
      heightCm: 175,
      startWeightKg: 80,
      goalWeightKg: 72,
      activityFactor: 1.55,
      weeklyLossKg: 0.5,
      phase: 'lose',
      phaseStartedAt: today(),
      breakUntil: null,
    })
    expect(s.checkins).toHaveLength(1)
    expect(s.checkins[0].kind).toBe('initial')
    expect(s.weights).toEqual([{ date: today(), kg: 80 }])
    // 화면에 보여 준 목표와 저장된 목표가 같아야 한다.
    const target = s.checkins[0].targetKcal
    expect(target).toBeGreaterThan(1000)
    expect(target).toBeLessThan(s.checkins[0].estimatedTdee)
    expect(shown).toBe(`${fmt(target - 100)}~${fmt(target + 100)}`)
  })

  it('유지를 고르면 유지 단계로 저장하고 목표를 소비 칼로리에 맞춘다', async () => {
    render(<Onboarding />)
    click('시작하기')
    fillBody()
    click('다음')
    click('다음')

    type('목표 체중', '80')
    pickPace('유지')
    expect(screen.getByTestId('pace-deficit')).toHaveTextContent('쓰는 만큼 먹어서')
    click('다음')

    expect(screen.getByText('하루 유지 범위')).toBeInTheDocument()
    expect(screen.queryByText(/쉬어 가기/)).not.toBeInTheDocument()
    expect(screen.queryByText('목표 체중 도달 예상')).not.toBeInTheDocument()

    click('이 계획으로 시작하기')

    await waitFor(() => expect(useStore.getState().profile).not.toBeNull())
    const s = useStore.getState()
    expect(s.profile).toMatchObject({ weeklyLossKg: 0, phase: 'maintain', phaseStartedAt: today(), breakUntil: null })
    expect(s.checkins[0].targetKcal).toBe(Math.round(s.checkins[0].estimatedTdee / 10) * 10)
  })

  it('범위를 벗어난 값이 있으면 오류를 보여 주고 다음으로 넘어가지 않는다', () => {
    render(<Onboarding />)
    click('시작하기')

    click('여성')
    type('태어난 해', birthYear)
    type('키', '50')
    type('현재 체중', '60')
    click('다음')

    expect(screen.getByText('키는 100~250cm 사이로 입력해 주세요.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '몸 정보를 알려 주세요' })).toBeInTheDocument()
    expect(useStore.getState().profile).toBeNull()

    // 고치면 넘어간다.
    type('키', '160')
    click('다음')
    expect(screen.getByRole('heading', { name: '평소에 얼마나 움직이나요?' })).toBeInTheDocument()
  })

  it('목표 체중이 현재 체중보다 높으면 유지를 고르기 전까지 막는다', () => {
    render(<Onboarding />)
    click('시작하기')
    fillBody('70')
    click('다음')
    click('다음')

    type('목표 체중', '75')
    click('다음')
    expect(screen.getByText(/목표 체중이 현재 체중\(70kg\)보다 높아요/)).toBeInTheDocument()

    pickPace('유지')
    click('다음')
    expect(screen.getByRole('heading', { name: '이렇게 시작해요' })).toBeInTheDocument()
  })

  it('이전으로 돌아가도 입력한 값이 남아 있고, 감량 속도가 낮춰지면 알려 준다', () => {
    render(<Onboarding />)
    click('시작하기')
    fillBody('60')
    click('다음')
    click('이전')
    expect(screen.getByLabelText('현재 체중')).toHaveValue('60')
    expect(screen.getByRole('button', { name: '남성' })).toHaveAttribute('aria-pressed', 'true')

    click('다음')
    click('다음')
    type('목표 체중', '55')
    pickPace(/빠르게/)
    expect(screen.getByTestId('pace-deficit')).toHaveTextContent('약 830kcal 적게')
    click('다음')
    // 60kg의 1%는 0.6kg
    expect(screen.getByText(/체중의 1%\(0.6kg\)까지만/)).toBeInTheDocument()
  })
})
