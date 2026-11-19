import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AiError, aiErrorMessage, callAi } from '../ai/client'
import { useAi } from '../ai/store'
import App from '../App'
import { AI_TIMEOUT_MS } from '../components/ai/CoachCall'
import { resetCoach, toHistory, useCoach } from '../components/ai/CoachStore'
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
const startersName = '이런 걸 물어볼 수 있어요. 누르면 입력 칸에 들어가요.'
const busyText = aiErrorMessage('busy')
const limitNote = /오늘 AI 횟수를 다 썼어요/
const sendButton = () => screen.getByRole('button', { name: '보내기' })

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

const input = () => screen.getByLabelText('코치에게 물어볼 내용')

function type(text: string) {
  fireEvent.change(input(), { target: { value: text } })
}

function sendText(text: string) {
  type(text)
  fireEvent.click(screen.getByRole('button', { name: '보내기' }))
}

/** 손가락으로 쓰는 기기인 것처럼 꾸민다. */
function stubPointer(coarse: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: coarse && query === '(pointer: coarse)', media: query })),
  )
}

const scrollIntoView = vi.fn()

beforeEach(async () => {
  mockCall.mockReset()
  resetCoach()
  scrollIntoView.mockReset()
  // jsdom에는 scrollIntoView가 없다.
  Element.prototype.scrollIntoView = scrollIntoView
  await useStore.getState().resetAll()
  await useStore.getState().completeOnboarding(profile)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  useAi.setState({ configured: false, checked: false, usage: null, usageDate: null, forbidden: false })
  useSync.setState({ email: null, conflict: null })
  resetCoach()
  window.location.hash = ''
})

describe('Coach', () => {
  it('처음에는 무엇을 AI에 보내는지와 시작 질문 네 개를 보여 주고, 대화 자리는 미리 그려 둔다', () => {
    signIn()
    renderCoach()
    expect(
      screen.getByText('코치는 내 기본 정보와 최근 2주의 체중·식사 기록, 지금 계획을 AI에 보내 답을 받아요.'),
    ).toBeInTheDocument()
    expect(screen.getByText(startersName)).toBeVisible()
    const starters = screen.getByRole('list', { name: startersName })
    expect(within(starters).getAllByRole('button')).toHaveLength(4)
    expect(within(starters).getByRole('button', { name: '지금 감량 속도가 저한테 맞는 걸까요?' })).toBeInTheDocument()
    expect(within(starters).getByRole('button', { name: '어제 많이 먹었는데 괜찮을까요?' })).toBeInTheDocument()
    expect(screen.getByText(/의학적 조언이 아니에요/)).toBeInTheDocument()
    // 화살표 같은 그림 없이 글만 있는 버튼이다(누르면 이동하는 줄처럼 보이지 않게).
    expect(starters.querySelector('svg')).toBeNull()
    expect(sendButton()).toHaveAttribute('aria-disabled', 'true')
    expect(sendButton()).toBeEnabled()
    expect(screen.queryByRole('button', { name: '대화 지우기' })).not.toBeInTheDocument()
    expect(screen.queryByText('대화는 앱을 새로 열면 지워져요.')).not.toBeInTheDocument()
    const log = screen.getByRole('log', { name: '대화' })
    expect(log).toHaveAttribute('aria-live', 'polite')
    expect(log).toBeEmptyDOMElement()
    expect(mockCall).not.toHaveBeenCalled()
  })

  it('유지 기간에는 감량 속도 대신 유지에 대한 시작 질문을 보여 준다', () => {
    useStore.setState((st) => ({ profile: { ...st.profile!, phase: 'maintain' } }))
    signIn()
    renderCoach()
    const starters = screen.getByRole('list', { name: startersName })
    expect(within(starters).getAllByRole('button')).toHaveLength(4)
    expect(within(starters).queryByRole('button', { name: /감량 속도/ })).not.toBeInTheDocument()
    expect(within(starters).getByRole('button', { name: '유지 기간에는 어떻게 먹는 게 좋을까요?' })).toBeInTheDocument()
  })

  it('시작 질문을 누르면 보내지 않고 입력 칸에 넣고 초점을 옮긴다', async () => {
    signIn()
    mockCall.mockResolvedValue(answer('며칠은 그럴 수 있어요.'))
    renderCoach()
    fireEvent.click(screen.getByRole('button', { name: '체중이 며칠째 그대로인데 왜 그럴까요?' }))

    expect(mockCall).not.toHaveBeenCalled()
    expect(screen.queryByTestId('coach-msg-user')).not.toBeInTheDocument()
    expect(input()).toHaveValue('체중이 며칠째 그대로인데 왜 그럴까요?')
    expect(input()).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: '보내기' }))
    expect(screen.getByTestId('coach-msg-user')).toHaveTextContent('체중이 며칠째 그대로인데 왜 그럴까요?')
    expect(await screen.findByTestId('coach-msg-coach')).toHaveTextContent('며칠은 그럴 수 있어요.')
    expect(mockCall).toHaveBeenCalledTimes(1)
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

    sendText('회식이 있는데 어떻게 할까요?')
    // 기다리는 동안: 코치 자리에 진행 표시, 보내기는 막힌다. 대화 자리 안에는 따로 알리는 역할을 두지 않는다.
    const log = screen.getByRole('log')
    expect(within(log).getByTestId('coach-msg-wait')).toHaveTextContent('답을 쓰는 중이에요')
    expect(within(log).queryByRole('status')).not.toBeInTheDocument()
    expect(input()).toHaveValue('')
    type('다음 질문')
    expect(sendButton()).toHaveAttribute('aria-disabled', 'true')
    fireEvent.keyDown(input(), { key: 'Enter' })
    fireEvent.click(sendButton())
    expect(mockCall).toHaveBeenCalledTimes(1)
    expect(screen.getAllByTestId('coach-msg-user')).toHaveLength(1)
    type('')

    release(answer('그날은 편하게 드세요.\n한 주 평균으로 보면 돼요.', 3))
    const first = await screen.findByTestId('coach-msg-coach')
    expect(log).toContainElement(first)
    expect(first).toHaveTextContent('그날은 편하게 드세요.')
    // 마크다운으로 바꾸지 않고 줄바꿈만 그대로 둔다.
    expect(within(first).getByText(/그날은 편하게 드세요/).textContent).toBe('그날은 편하게 드세요.\n한 주 평균으로 보면 돼요.')
    // 횟수가 넉넉할 때는 남은 횟수를 말하지 않는다.
    expect(screen.queryByText(/번 남았어요/)).not.toBeInTheDocument()

    mockCall.mockResolvedValueOnce(answer('네, 괜찮아요.', 32))
    type('다음 날은요?')
    fireEvent.keyDown(input(), { key: 'Enter' })
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
    expect(within(screen.getByTestId('coach-meta')).getByText(/8번/)).toBeInTheDocument()
  })

  it('Shift+Enter와 한글 조합 중의 Enter는 보내지 않는다', () => {
    signIn()
    renderCoach()
    type('첫 줄')
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true })
    expect(mockCall).not.toHaveBeenCalled()
    expect(screen.queryByTestId('coach-msg-user')).not.toBeInTheDocument()
  })

  it('손가락으로 쓰는 기기에서는 Enter가 줄바꿈이고 버튼으로만 보낸다', async () => {
    stubPointer(true)
    signIn()
    mockCall.mockResolvedValue(answer('네.'))
    renderCoach()
    type('첫 줄')
    expect(input()).toHaveAttribute('enterkeyhint', 'enter')
    // 기본 동작(줄바꿈)을 막지 않으면 fireEvent가 true를 돌려준다.
    expect(fireEvent.keyDown(input(), { key: 'Enter' })).toBe(true)
    expect(mockCall).not.toHaveBeenCalled()
    expect(screen.queryByTestId('coach-msg-user')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '보내기' }))
    expect(await screen.findByTestId('coach-msg-coach')).toHaveTextContent('네.')
    expect(mockCall).toHaveBeenCalledTimes(1)
  })

  it('마우스와 키보드를 쓰는 기기에서는 Enter로 보낸다', async () => {
    stubPointer(false)
    signIn()
    mockCall.mockResolvedValue(answer('네.'))
    renderCoach()
    type('질문')
    expect(input()).toHaveAttribute('enterkeyhint', 'send')
    expect(fireEvent.keyDown(input(), { key: 'Enter' })).toBe(false)
    expect(await screen.findByTestId('coach-msg-coach')).toHaveTextContent('네.')
  })

  it('실패하면 코치 자리에 안내를 보여 주고, 다시 시도해도 질문이 겹치지 않는다', async () => {
    signIn()
    mockCall.mockRejectedValueOnce(new AiError('busy'))
    renderCoach()
    sendText('왜 체중이 안 줄죠?')

    const note = await screen.findByText(busyText)
    expect(note.closest('li')).toHaveClass('coach-msg--coach')
    // 대화 자리가 이미 바뀐 내용을 읽어 주므로, 안에 alert를 또 두지 않는다.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    mockCall.mockResolvedValueOnce(answer('물이 차서 그럴 수 있어요.'))
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByTestId('coach-msg-coach')).toHaveTextContent('물이 차서 그럴 수 있어요.')
    expect(screen.getAllByTestId('coach-msg-user')).toHaveLength(1)
    expect(screen.queryByText(busyText)).not.toBeInTheDocument()
    expect(mockCall).toHaveBeenCalledTimes(2)
    expect(mockCall.mock.calls[1][0]).toMatchObject({ question: '왜 체중이 안 줄죠?', history: [] })
  })

  it('55초 안에 답이 오지 않으면 기다리기를 그만두고 늦는다고 알린다', async () => {
    vi.useFakeTimers()
    signIn()
    mockCall.mockImplementationOnce(() => new Promise(() => {}))
    renderCoach()
    sendText('질문 하나')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AI_TIMEOUT_MS - 1000)
    })
    expect(screen.getByTestId('coach-msg-wait')).toHaveTextContent('답을 쓰는 중이에요')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(screen.getByTestId('coach-msg-wait')).toHaveTextContent(busyText)
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
    expect(mockCall.mock.calls[0][1]?.aborted).toBe(true)
  })

  it('대화는 화면을 나갔다 와도 남아 있고, 대화 지우기는 한 번 물어본 뒤에 지운다', async () => {
    signIn()
    mockCall.mockResolvedValue(answer('네.'))
    const { unmount } = renderCoach()
    sendText('질문 하나')
    await screen.findByTestId('coach-msg-coach')
    unmount()

    renderCoach()
    expect(screen.getByTestId('coach-msg-user')).toHaveTextContent('질문 하나')
    expect(screen.getByTestId('coach-msg-coach')).toHaveTextContent('네.')

    expect(screen.getByText('대화는 앱을 새로 열면 지워져요.')).toBeInTheDocument()
    const clear = screen.getByRole('button', { name: '대화 지우기' })
    fireEvent.click(clear)
    expect(screen.getByText('대화를 지우고 새로 시작할까요?')).toBeInTheDocument()
    expect(clear).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.queryByText('대화를 지우고 새로 시작할까요?')).not.toBeInTheDocument()
    expect(screen.getByTestId('coach-msg-user')).toBeInTheDocument()
    // 취소하면 초점이 '대화 지우기'로 돌아온다. 그 버튼은 초점을 받을 수 있는 상태여야 한다.
    expect(clear).toBeEnabled()
    expect(clear).toHaveFocus()

    fireEvent.click(clear)
    fireEvent.click(screen.getByRole('button', { name: '지우기' }))
    expect(screen.queryByTestId('coach-msg-user')).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: startersName })).toBeInTheDocument()
    expect(screen.queryByText('대화를 지우고 새로 시작할까요?')).not.toBeInTheDocument()
    expect(screen.queryByText('대화는 앱을 새로 열면 지워져요.')).not.toBeInTheDocument()
    expect(input()).toHaveFocus()
  })

  it('시작 질문은 이미 적어 둔 글을 덮어쓰지 않고 다음 줄에 덧붙인다', () => {
    signIn()
    renderCoach()
    type('요즘 야식을 자주 먹어요. ')
    fireEvent.click(screen.getByRole('button', { name: '어제 많이 먹었는데 괜찮을까요?' }))
    expect(input()).toHaveValue('요즘 야식을 자주 먹어요.\n어제 많이 먹었는데 괜찮을까요?')
    expect(input()).toHaveFocus()
    expect(mockCall).not.toHaveBeenCalled()
  })

  it('보낸 뒤에도 보내기 버튼은 초점을 잃지 않는다(disabled가 되지 않는다)', async () => {
    signIn()
    mockCall.mockImplementationOnce(() => new Promise(() => {}))
    renderCoach()
    type('질문 하나')
    sendButton().focus()
    fireEvent.click(sendButton())
    expect(sendButton()).toHaveAttribute('aria-disabled', 'true')
    expect(sendButton()).toBeEnabled()
    expect(sendButton()).toHaveFocus()
  })

  it('답을 기다리는 중에는 대화를 지울 수 없다', () => {
    signIn()
    mockCall.mockImplementationOnce(() => new Promise(() => {}))
    renderCoach()
    sendText('질문 하나')
    const clear = screen.getByRole('button', { name: '대화 지우기' })
    expect(clear).toHaveAttribute('aria-disabled', 'true')
    expect(clear).toBeEnabled()
    fireEvent.click(clear)
    expect(screen.queryByText('대화를 지우고 새로 시작할까요?')).not.toBeInTheDocument()
    act(() => useCoach.getState().clear())
    expect(screen.getByTestId('coach-msg-user')).toBeInTheDocument()
    expect(useCoach.getState().pending).toBe(true)
  })

  it('답을 기다리다 화면을 나가도 요청은 이어지고, 돌아오면 답이 대화에 있다', async () => {
    signIn()
    let release: (v: ReturnType<typeof answer>) => void = () => {}
    mockCall.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
    const { unmount } = renderCoach()
    sendText('질문 하나')
    unmount()
    expect(mockCall.mock.calls[0][1]?.aborted).toBe(false)

    // 다른 화면에 있는 동안 돌아오면 아직 기다리는 중으로 보인다.
    const back = renderCoach()
    expect(screen.getByTestId('coach-msg-wait')).toHaveTextContent('답을 쓰는 중이에요')
    back.unmount()

    release(answer('이제 답해요.'))
    await waitFor(() => expect(useCoach.getState().messages).toHaveLength(2))
    renderCoach()
    expect(screen.getByTestId('coach-msg-coach')).toHaveTextContent('이제 답해요.')
    expect(screen.getAllByTestId('coach-msg-user')).toHaveLength(1)
    expect(mockCall).toHaveBeenCalledTimes(1)
  })

  it('기다리는 중에 또 보내도 한 번만 호출한다', () => {
    signIn()
    mockCall.mockImplementation(() => new Promise(() => {}))
    renderCoach()
    sendText('질문 하나')
    const context = (mockCall.mock.calls[0][0] as { context: Parameters<ReturnType<typeof useCoach.getState>['send']>[0] }).context
    act(() => {
      useCoach.getState().send(context, '겹친 질문')
      useCoach.getState().retry(context)
    })
    expect(mockCall).toHaveBeenCalledTimes(1)
    expect(screen.getAllByTestId('coach-msg-user')).toHaveLength(1)
  })

  it('적다 만 글은 다른 화면에 다녀와도 남아 있다', () => {
    signIn()
    const { unmount } = renderCoach()
    type('적다 만 질문')
    unmount()
    renderCoach()
    expect(input()).toHaveValue('적다 만 질문')
  })

  it('오늘 횟수를 다 썼으면 입력 칸과 보내기를 막고, 시작 질문 없이 안내를 보여 준다', () => {
    signIn()
    useAi.setState({ usage: { used: 40, limit: 40 }, usageDate: today() })
    act(() => useCoach.getState().setDraft('적어 둔 질문'))
    renderCoach()
    expect(input()).toBeDisabled()
    expect(input()).toHaveAttribute('placeholder', '내일 다시 물어볼 수 있어요')
    expect(sendButton()).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(sendButton())
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(mockCall).not.toHaveBeenCalled()
    expect(screen.queryByTestId('coach-msg-user')).not.toBeInTheDocument()
    expect(screen.getByText(limitNote)).toBeInTheDocument()
    expect(screen.queryByText(/0번/)).not.toBeInTheDocument()
    expect(screen.queryByText(startersName)).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: startersName })).not.toBeInTheDocument()
    // 무엇을 AI에 보내는지는 그대로 알려 준다.
    expect(screen.getByText(/AI에 보내 답을 받아요/)).toBeInTheDocument()
  })

  it('횟수를 다 썼다는 실패는 실패로 남기지 않고, 횟수 안내 하나만 보여 준다', async () => {
    signIn()
    mockCall.mockRejectedValueOnce(new AiError('limit', { used: 40, limit: 40 }))
    renderCoach()
    sendText('질문 하나')
    await waitFor(() => expect(useCoach.getState().pending).toBe(false))
    expect(useCoach.getState().error).toBeNull()
    expect(screen.getAllByText(limitNote)).toHaveLength(1)
    expect(screen.queryByTestId('coach-msg-wait')).not.toBeInTheDocument()
    // 보낸 질문은 대화에 남아 있다.
    expect(screen.getByTestId('coach-msg-user')).toHaveTextContent('질문 하나')
  })

  it('실패 안내가 남아 있을 때 횟수를 다 쓰면, 실패 안내와 다시 시도는 감추고 횟수 안내만 보여 준다', async () => {
    signIn()
    mockCall.mockRejectedValueOnce(new AiError('busy'))
    renderCoach()
    sendText('질문 하나')
    expect(await screen.findByText(busyText)).toBeInTheDocument()

    // 다른 화면의 AI 기능으로 남은 횟수를 다 썼다.
    act(() => useAi.getState().setUsage({ used: 40, limit: 40 }))
    expect(screen.queryByText(busyText)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
    expect(screen.getAllByText(limitNote)).toHaveLength(1)
  })

  it('횟수를 다 쓴 상태에서 대화를 지우면 막힌 입력 칸 대신 제목으로 초점을 옮긴다', async () => {
    signIn()
    mockCall.mockResolvedValueOnce(answer('네.', 40))
    renderCoach()
    sendText('질문 하나')
    await screen.findByTestId('coach-msg-coach')
    expect(input()).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '대화 지우기' }))
    fireEvent.click(screen.getByRole('button', { name: '지우기' }))
    expect(screen.queryByTestId('coach-msg-user')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: '코치' })).toHaveFocus()
  })

  it('로그인이 풀려 실패하면 설정에서 로그인하는 링크를 보여 준다', async () => {
    signIn()
    mockCall.mockRejectedValueOnce(new AiError('unauthorized'))
    renderCoach()
    sendText('질문 하나')
    expect(await screen.findByRole('link', { name: '설정에서 로그인' })).toHaveAttribute('href', '/settings')
  })

  it('대화하던 중에 이 계정은 쓸 수 없다는 답이 오면 홈으로 보내지 않고 그 자리에서 알린다', async () => {
    signIn()
    mockCall.mockRejectedValueOnce(new AiError('forbidden'))
    const { unmount } = renderCoach()
    sendText('질문 하나')
    expect(await screen.findByRole('alert')).toHaveTextContent('이 계정은 AI 기능을 쓸 수 없어요.')
    expect(screen.queryByText('홈 화면')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '오늘 화면으로 가기' })).toHaveAttribute('href', '/')
    expect(screen.queryByLabelText('코치에게 물어볼 내용')).not.toBeInTheDocument()
    unmount()

    // 한 번 알린 뒤 다시 들어오면 처음부터 쓸 수 없는 것과 같이 홈으로 보낸다.
    renderCoach()
    expect(screen.getByText('홈 화면')).toBeInTheDocument()
  })

  it('답을 기다리는 사이에 계정이 바뀌면 앞 계정의 사용량과 사용 불가 표시를 새 계정에 남기지 않는다', async () => {
    signIn()
    let release: (v: ReturnType<typeof answer>) => void = () => {}
    let fail: (e: unknown) => void = () => {}
    mockCall
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
      .mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
    const context = { today: today() } as Parameters<ReturnType<typeof useCoach.getState>['send']>[0]

    act(() => useCoach.getState().send(context, '질문 하나'))
    act(() => useSync.setState({ email: 'other@b.c' }))
    await act(async () => {
      release(answer('앞 계정의 답', 40))
    })
    expect(useAi.getState().usage).toBeNull()
    expect(useCoach.getState().messages).toEqual([])

    act(() => useCoach.getState().send(context, '질문 둘'))
    act(() => useSync.setState({ email: 'third@b.c' }))
    await act(async () => {
      fail(new AiError('forbidden', { used: 40, limit: 40 }))
    })
    expect(useAi.getState().forbidden).toBe(false)
    expect(useAi.getState().usage).toBeNull()
    expect(useCoach.getState()).toMatchObject({ messages: [], error: null, pending: false })
  })

  it('로그아웃하거나 계정이 바뀌면 대화와 적던 글을 지우고, 늦게 온 답도 넣지 않는다', async () => {
    signIn()
    let release: (v: ReturnType<typeof answer>) => void = () => {}
    mockCall.mockResolvedValueOnce(answer('네.')).mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
    renderCoach()
    sendText('질문 하나')
    await screen.findByTestId('coach-msg-coach')
    sendText('질문 둘')
    type('적다 만 글')

    act(() => useSync.setState({ email: 'other@b.c' }))
    expect(screen.queryByTestId('coach-msg-user')).not.toBeInTheDocument()
    expect(input()).toHaveValue('')

    await act(async () => {
      release(answer('앞 계정의 답'))
    })
    expect(useCoach.getState().messages).toEqual([])
    expect(useCoach.getState().pending).toBe(false)
  })

  it('새 말이 생기면 대화 끝의 표식을 입력창 위로 올리고, 표식은 대화 구획 안에 있다', async () => {
    signIn()
    mockCall.mockResolvedValue(answer('네.'))
    const { container } = renderCoach()
    const end = container.querySelector('.coach-end')!
    expect(end.parentElement).toHaveClass('coach-body')
    expect(end.parentElement!.lastElementChild).toBe(end)
    // 입력창 아래에 따로 놓인 요소가 없어야 한다(남은 횟수 줄 아래에 틈을 만들지 않는다).
    expect(container.querySelector('main')!.lastElementChild).toHaveClass('coach-composer')

    sendText('질문 하나')
    await screen.findByTestId('coach-msg-coach')
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'end' })
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(end)
  })

  it('화면보다 긴 답은 끝이 아니라 답의 첫 줄을 보여 준다', async () => {
    signIn()
    mockCall.mockResolvedValue(answer('아주 긴 답'))
    renderCoach()
    // 입력창 위로 500px이 보이는데 답은 900px인 상황.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('coach-msg--coach') ? 900 : 80
    })
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return { top: this.classList.contains('coach-composer') ? 500 : 0 } as DOMRect
    })
    sendText('질문 하나')
    const reply = await screen.findByTestId('coach-msg-coach')
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'start' })
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(reply)
  })

  it('글자 수는 한도에 가까워지면 보여 준다', () => {
    signIn()
    renderCoach()
    type('가'.repeat(100))
    expect(screen.queryByTestId('coach-counter')).not.toBeInTheDocument()
    type('가'.repeat(480))
    expect(screen.getByTestId('coach-counter')).toHaveTextContent('480/500')
    // 낱글자 span의 aria-label은 화면 낭독기가 읽지 않는다. 보이는 글만 둔다.
    expect(screen.getByTestId('coach-counter')).not.toHaveAttribute('aria-label')
    expect(input()).toHaveAttribute('maxlength', '500')
  })

  it('로그인하지 않았으면 로그인하면 되는 일과 설정으로 가는 링크를 보여 준다', () => {
    useAi.setState({ configured: true, checked: true })
    renderCoach()
    expect(screen.getByText(/로그인하면 코치에게 궁금한 것을 물어볼 수 있어요/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '설정에서 로그인' })).toHaveAttribute('href', '/settings')
    expect(screen.queryByLabelText('코치에게 물어볼 내용')).not.toBeInTheDocument()
  })

  it('기록을 어떻게 할지 정하지 않았으면 입력창 대신 정하러 가는 안내를 보여 준다', () => {
    useAi.setState({ configured: true, checked: true })
    useSync.setState({ email: 'a@b.c', conflict: { localCount: 1, remoteCount: 2 } })
    renderCoach()
    expect(screen.getByRole('link', { name: '설정에서 정하기' })).toHaveAttribute('href', '/settings')
    expect(screen.queryByLabelText('코치에게 물어볼 내용')).not.toBeInTheDocument()
  })

  it('계획이 아직 없으면 오늘 화면으로 가는 링크를 보여 준다', async () => {
    await useStore.getState().resetAll()
    signIn()
    renderCoach()
    expect(screen.getByRole('link', { name: '오늘 화면으로 가기' })).toHaveAttribute('href', '/')
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
