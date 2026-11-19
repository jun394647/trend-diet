import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AiError, callAi } from '../ai/client'
import { useAi } from '../ai/store'
import App from '../App'
import { toHistory, useCoach } from '../components/ai/CoachStore'
import { today } from '../lib/date'
import { useStore } from '../store'
import { useSync } from '../sync/store'
import type { Profile } from '../types'
import Coach from './Coach'

vi.mock('../ai/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai/client')>()),
  callAi: vi.fn(),
  fetchAiStatus: vi.fn(async () => ({ configured: false, dailyLimit: 0 })),
}))

const profile: Profile = {
  heightCm: 175,
  birthYear: 1995,
  sex: 'M',
  activityFactor: 1.375,
  startWeightKg: 80,
  goalWeightKg: 72,
  weeklyLossKg: 0.5,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const mockCall = vi.mocked(callAi)
const answer = (text: string, used = 1) => ({ result: { answer: text }, usage: { used, limit: 40 } })

function signIn() {
  useAi.setState({ configured: true, checked: true })
  useSync.setState({ email: 'a@b.c', conflict: null })
}

function renderCoach() {
  return render(
    <MemoryRouter initialEntries={['/coach']}>
      <Routes>
        <Route path="/coach" element={<Coach />} />
        <Route path="/" element={<p>홈 화면</p>} />
        <Route path="/settings" element={<p>설정 화면</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

function type(text: string) {
  fireEvent.change(screen.getByLabelText('코치에게 물어볼 내용'), { target: { value: text } })
}

beforeEach(async () => {
  mockCall.mockReset()
  useCoach.getState().clear()
  await useStore.getState().resetAll()
  await useStore.getState().completeOnboarding(profile)
})

afterEach(() => {
  useAi.setState({ configured: false, checked: false, usage: null })
  useSync.setState({ email: null, conflict: null })
  window.location.hash = ''
})

describe('Coach', () => {
  it('처음에는 코치가 무엇을 보는지와 시작 질문 네 개를 보여 준다', () => {
    signIn()
    renderCoach()
    expect(screen.getByText(/최근 2주의 체중과 섭취 기록, 지금 계획을 보고 답해요/)).toBeInTheDocument()
    const starters = screen.getByRole('list', { name: '이런 걸 물어볼 수 있어요' })
    expect(within(starters).getAllByRole('button')).toHaveLength(4)
    expect(screen.getByText(/의학적 조언이 아니에요/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '새 대화' })).not.toBeInTheDocument()
    expect(mockCall).not.toHaveBeenCalled()
  })

  it('시작 질문을 누르면 바로 보낸다', async () => {
    signIn()
    mockCall.mockResolvedValue(answer('며칠은 그럴 수 있어요.'))
    renderCoach()
    fireEvent.click(screen.getByRole('button', { name: '체중이 며칠째 그대로인데 왜 그럴까요?' }))

    expect(screen.getByTestId('coach-msg-user')).toHaveTextContent('체중이 며칠째 그대로인데 왜 그럴까요?')
    expect(await screen.findByTestId('coach-msg-coach')).toHaveTextContent('며칠은 그럴 수 있어요.')
    expect(mockCall.mock.calls[0][0]).toMatchObject({
      task: 'ask',
      question: '체중이 며칠째 그대로인데 왜 그럴까요?',
      history: [],
      context: { today: today() },
    })
  })

  it('묻고 답을 받고, 두 번째 질문에는 앞의 대화를 함께 보낸다', async () => {
    signIn()
    let release: (v: ReturnType<typeof answer>) => void = () => {}
    mockCall.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
    renderCoach()

    type('회식이 있는데 어떻게 할까요?')
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))
    // 기다리는 동안: 코치 자리에 진행 표시, 보내기는 막힌다.
    expect(screen.getByRole('status')).toHaveTextContent('답을 쓰는 중이에요')
    expect(screen.getByLabelText('코치에게 물어볼 내용')).toHaveValue('')
    type('다음 질문')
    expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled()
    type('')

    release(answer('그날은 편하게 드세요.\n한 주 평균으로 보면 돼요.', 3))
    const first = await screen.findByTestId('coach-msg-coach')
    expect(first).toHaveTextContent('그날은 편하게 드세요.')
    // 마크다운으로 바꾸지 않고 줄바꿈만 그대로 둔다.
    expect(within(first).getByText(/그날은 편하게 드세요/).textContent).toBe('그날은 편하게 드세요.\n한 주 평균으로 보면 돼요.')
    expect(screen.getByTestId('coach-quota')).toHaveTextContent('오늘 AI를 37번 더 쓸 수 있어요')

    mockCall.mockResolvedValueOnce(answer('네, 괜찮아요.', 4))
    type('다음 날은요?')
    fireEvent.keyDown(screen.getByLabelText('코치에게 물어볼 내용'), { key: 'Enter' })
    await waitFor(() => expect(screen.getAllByTestId('coach-msg-coach')).toHaveLength(2))
    expect(mockCall).toHaveBeenCalledTimes(2)
    expect(mockCall.mock.calls[1][0]).toMatchObject({
      task: 'ask',
      question: '다음 날은요?',
      history: [
        { role: 'user', text: '회식이 있는데 어떻게 할까요?' },
        { role: 'assistant', text: '그날은 편하게 드세요.\n한 주 평균으로 보면 돼요.' },
      ],
    })
    expect(screen.getAllByTestId('coach-msg-user')).toHaveLength(2)
  })

  it('Shift+Enter와 한글 조합 중의 Enter는 보내지 않는다', () => {
    signIn()
    renderCoach()
    type('첫 줄')
    const input = screen.getByLabelText('코치에게 물어볼 내용')
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(mockCall).not.toHaveBeenCalled()
    expect(screen.queryByTestId('coach-msg-user')).not.toBeInTheDocument()
  })

  it('실패하면 코치 자리에 안내를 보여 주고, 다시 시도해도 질문이 겹치지 않는다', async () => {
    signIn()
    mockCall.mockRejectedValueOnce(new AiError('busy'))
    renderCoach()
    type('왜 체중이 안 줄죠?')
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('지금 응답이 늦어요')
    expect(alert.closest('li')).toHaveClass('coach-msg--coach')

    mockCall.mockResolvedValueOnce(answer('물이 차서 그럴 수 있어요.'))
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByTestId('coach-msg-coach')).toHaveTextContent('물이 차서 그럴 수 있어요.')
    expect(screen.getAllByTestId('coach-msg-user')).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mockCall).toHaveBeenCalledTimes(2)
    expect(mockCall.mock.calls[1][0]).toMatchObject({ question: '왜 체중이 안 줄죠?', history: [] })
  })

  it('대화는 화면을 나갔다 와도 남아 있고, 새 대화를 누르면 지워진다', async () => {
    signIn()
    mockCall.mockResolvedValue(answer('네.'))
    const { unmount } = renderCoach()
    type('질문 하나')
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))
    await screen.findByTestId('coach-msg-coach')
    unmount()

    renderCoach()
    expect(screen.getByTestId('coach-msg-user')).toHaveTextContent('질문 하나')
    expect(screen.getByTestId('coach-msg-coach')).toHaveTextContent('네.')
    fireEvent.click(screen.getByRole('button', { name: '새 대화' }))
    expect(screen.queryByTestId('coach-msg-user')).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: '이런 걸 물어볼 수 있어요' })).toBeInTheDocument()
  })

  it('답을 기다리다 화면을 나갔다 오면 같은 질문을 다시 물을 수 있다', async () => {
    signIn()
    mockCall.mockImplementationOnce(() => new Promise(() => {}))
    const { unmount } = renderCoach()
    type('질문 하나')
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))
    unmount()

    mockCall.mockResolvedValueOnce(answer('이제 답해요.'))
    renderCoach()
    fireEvent.click(screen.getByRole('button', { name: '다시 묻기' }))
    expect(await screen.findByTestId('coach-msg-coach')).toHaveTextContent('이제 답해요.')
    expect(screen.getAllByTestId('coach-msg-user')).toHaveLength(1)
  })

  it('글자 수는 한도에 가까워지면 보여 준다', () => {
    signIn()
    renderCoach()
    type('가'.repeat(100))
    expect(screen.queryByTestId('coach-counter')).not.toBeInTheDocument()
    type('가'.repeat(480))
    expect(screen.getByTestId('coach-counter')).toHaveTextContent('480/500')
    expect(screen.getByLabelText('코치에게 물어볼 내용')).toHaveAttribute('maxlength', '500')
  })

  it('로그인하지 않았으면 설명과 설정으로 가는 링크를 보여 준다', () => {
    useAi.setState({ configured: true, checked: true })
    renderCoach()
    expect(screen.getByText(/로그인하면 쓸 수 있어요/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '설정에서 로그인' })).toHaveAttribute('href', '/settings')
    expect(screen.queryByLabelText('코치에게 물어볼 내용')).not.toBeInTheDocument()
  })

  it('AI가 준비되지 않은 게 확인되면 홈으로 보낸다', () => {
    useAi.setState({ configured: false, checked: true })
    renderCoach()
    expect(screen.getByText('홈 화면')).toBeInTheDocument()
  })
})

describe('toHistory', () => {
  const msg = (id: number, role: 'user' | 'assistant', text: string) => ({ id, role, text })

  it('답을 받지 못한 질문은 빼고, 마지막 20개만 질문부터 시작하게 보낸다', () => {
    expect(toHistory([msg(1, 'user', '답 없는 질문'), msg(2, 'user', 'q'), msg(3, 'assistant', 'a'), msg(4, 'user', '끝')])).toEqual([
      { role: 'user', text: 'q' },
      { role: 'assistant', text: 'a' },
    ])

    const long = Array.from({ length: 30 }, (_, i) => msg(i, i % 2 === 0 ? 'user' : 'assistant', `m${i}`))
    const history = toHistory(long)
    expect(history).toHaveLength(20)
    expect(history[0]).toEqual({ role: 'user', text: 'm10' })
    expect(history[19]).toEqual({ role: 'assistant', text: 'm29' })
  })
})

describe('코치 탭', () => {
  it('AI가 꺼져 있으면 탭이 셋이고 코치 탭이 없다', async () => {
    useAi.setState({ configured: false, checked: true })
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: '주요 메뉴' })
    expect(within(nav).getAllByRole('link')).toHaveLength(3)
    expect(within(nav).queryByRole('link', { name: '코치' })).not.toBeInTheDocument()
  })

  it('로그인 전이어도 AI가 준비돼 있으면 코치 탭이 보이고, 누르면 안내 화면으로 간다', async () => {
    useAi.setState({ configured: true, checked: true })
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: '주요 메뉴' })
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['오늘', '추세', '코치', '설정'])
    fireEvent.click(within(nav).getByRole('link', { name: '코치' }))
    expect(await screen.findByRole('heading', { level: 1, name: '코치' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '설정에서 로그인' })).toBeInTheDocument()
  })

  it('쓸 수 있는 상태면 코치 탭이 보인다', async () => {
    signIn()
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: '주요 메뉴' })
    expect(within(nav).getByRole('link', { name: '코치' })).toBeInTheDocument()
  })
})
