import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AiError, callAi } from '../../ai/client'
import type { MealEstimate } from '../../ai/contract'
import { prepareImage } from '../../ai/image'
import { aiAvailability, quotaLeft, useAi } from '../../ai/store'
import { useAiCall } from '../../ai/useAiCall'
import { addDays, today } from '../../lib/date'
import { loadFoodDb } from '../../lib/foodDb'
import type { FoodDbFile } from '../../lib/foodSearch'
import { useStore } from '../../store'
import { useSync } from '../../sync/store'
import type { Profile } from '../../types'
import MealSheet from '../MealSheet'
import { resetMealAi, useMealAi } from './MealAiStore'

vi.mock('../../ai/client', async (original) => ({
  ...(await original<typeof import('../../ai/client')>()),
  callAi: vi.fn(),
}))
vi.mock('../../ai/image', async (original) => ({
  ...(await original<typeof import('../../ai/image')>()),
  prepareImage: vi.fn(),
}))
// 음식 목록은 한 번 받으면 남는다. 불러오지 못한 경우를 볼 때만 한 번 실패하게 한다.
vi.mock('../../lib/foodDb', async (original) => {
  const real = await original<typeof import('../../lib/foodDb')>()
  return { ...real, loadFoodDb: vi.fn(real.loadFoodDb) }
})

const callAiMock = vi.mocked(callAi)
const prepareImageMock = vi.mocked(prepareImage)

const file: FoodDbFile = {
  source: '테스트',
  updated: '2026-09-29',
  items: [['김치찌개', '외식', 61, 400, 'g', 3, 3.8, 3.8]],
}

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

const estimate: MealEstimate = {
  items: [
    { name: '김치찌개', amount: '1인분', kcal: 250, confidence: 'high' },
    { name: '쌀밥', amount: '1공기(210g)', kcal: 300, confidence: 'high' },
    { name: '계란말이', amount: '2조각', kcal: 120, confidence: 'low' },
  ],
  note: '계란말이는 두 조각으로 봤어요.',
}
const usage = { used: 1, limit: 40 }
const TEXT = '점심에 김치찌개랑 밥 한 공기, 계란말이 조금'

let onClose: ReturnType<typeof vi.fn<() => void>>
const open = () =>
  render(
    <MemoryRouter>
      <MealSheet date={today()} targetKcal={2000} onClose={onClose} />
    </MemoryRouter>,
  )
const entry = () => screen.getByLabelText('음식 이름이나 칼로리')
const type = (value: string) => fireEvent.change(entry(), { target: { value } })
const meals = () => useStore.getState().meals
const signIn = () => useSync.setState({ email: 'a@b.c', conflict: null })
const SEND_PHOTO = 'AI로 칼로리 어림잡기'
const KEPT = '방금 어림잡은 사진 결과가 있어요'
const submitEntry = () => fireEvent.submit(entry().closest('form')!)
/** 테스트가 원하는 때에 답을 주는 callAi. */
function deferCallAi() {
  const calls: { signal?: AbortSignal; resolve: (v: { result: MealEstimate; usage: { used: number; limit: number } }) => void; reject: (e: unknown) => void }[] = []
  callAiMock.mockImplementation(
    (_request, signal) =>
      new Promise((resolve, reject) => {
        calls.push({ signal, resolve: resolve as never, reject })
      }),
  )
  return calls
}
/** 음식 목록은 그대로 주고, GET /api/ai에는 status를 준다. */
const stubFetch = (status: () => unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({ ok: true, json: async () => (url === '/api/ai' ? status() : file) })),
  )
const statusCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/ai').length
const AI_BUTTON = 'AI로 칼로리 어림잡기'
const PHOTO_BUTTON = '사진으로 어림잡기'
const NO_MATCH = '음식 목록에는 없어요. AI로 어림잡거나, 칼로리를 알면 뒤에 숫자를 붙여 주세요.'
const askAi = () => fireEvent.click(screen.getByRole('button', { name: AI_BUTTON }))

beforeEach(async () => {
  onClose = vi.fn<() => void>()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => file })))
  await useStore.getState().resetAll()
  await useStore.getState().completeOnboarding(profile)
  useAi.setState({ configured: true, checked: true })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  callAiMock.mockReset()
  prepareImageMock.mockReset()
  useSync.setState({ email: null, conflict: null, ready: true })
  useAi.setState({ configured: false, checked: false, usage: null, usageDate: null, forbidden: false })
  resetMealAi()
})

describe('로그인하지 않았을 때', () => {
  it('로그인 안내 한 줄만 보여 주고 AI 버튼은 보여 주지 않는다', () => {
    open()
    expect(screen.getByText(/로그인하면 사진이나 말로 적은 식사를 AI가 어림잡아 줘요\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '설정에서 로그인' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: PHOTO_BUTTON })).not.toBeInTheDocument()
    type('김치찌개랑 밥')
    expect(screen.queryByRole('button', { name: AI_BUTTON })).not.toBeInTheDocument()
    submitEntry()
    expect(callAiMock).not.toHaveBeenCalled()
  })
})

describe('말로 적어 기록하기', () => {
  beforeEach(signIn)

  it('적은 글을 보내 음식별로 받고, 고치고 뺀 뒤 기록한다', async () => {
    callAiMock.mockResolvedValue({ result: estimate, usage })
    open()
    // 비어 있을 때는 어림잡기 버튼이 없고 사진 버튼만 있다.
    expect(screen.queryByRole('button', { name: AI_BUTTON })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: PHOTO_BUTTON })).toBeInTheDocument()

    type(TEXT)
    // 전에 쓰던 음식 목록 찾기는 그대로 남는다.
    expect(screen.getByRole('heading', { name: '음식 목록에서 찾기' })).toBeInTheDocument()
    askAi()
    expect(callAiMock).toHaveBeenCalledWith({ task: 'meal-text', text: TEXT }, expect.anything())

    const list = await screen.findByRole('list', { name: 'AI가 나눈 음식' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('1공기(210g)')).toBeInTheDocument()
    expect(screen.getAllByText('덜 확실해요')).toHaveLength(1)
    expect(screen.getByText('계란말이는 두 조각으로 봤어요.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'AI가 어림잡은 칼로리' })).toBeInTheDocument()
    expect(screen.getByText('실제와 다를 수 있어요. 숫자를 눌러 고칠 수 있어요.')).toBeInTheDocument()
    expect(screen.getByTestId('mealai-total')).toHaveTextContent('670kcal')
    expect(screen.getByRole('button', { name: '3건 기록하기' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('쌀밥 칼로리'), { target: { value: '150' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /계란말이/ }))
    expect(screen.getByRole('checkbox', { name: /계란말이/ })).not.toBeChecked()
    expect(screen.getByTestId('mealai-total')).toHaveTextContent('400kcal')

    fireEvent.click(screen.getByRole('button', { name: '2건 기록하기' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(meals()).toHaveLength(2)
    expect(meals()[0]).toMatchObject({ date: today(), name: '김치찌개', kcal: 250, source: 'ai' })
    expect(meals()[1]).toMatchObject({ date: today(), name: '쌀밥', kcal: 150, source: 'ai' })
  })

  it('칼로리를 지우거나 0으로 두면 빠지고, 다 빼면 기록할 수 없다', async () => {
    callAiMock.mockResolvedValue({ result: { ...estimate, items: estimate.items.slice(0, 2) }, usage })
    open()
    type(TEXT)
    askAi()
    await screen.findByRole('list', { name: 'AI가 나눈 음식' })

    fireEvent.change(screen.getByLabelText('김치찌개 칼로리'), { target: { value: '' } })
    expect(screen.getByRole('checkbox', { name: /김치찌개/ })).not.toBeChecked()
    expect(screen.getByRole('button', { name: '1건 기록하기' })).toBeEnabled()
    expect(screen.getByTestId('mealai-total')).toHaveTextContent('300kcal')

    fireEvent.change(screen.getByLabelText('쌀밥 칼로리'), { target: { value: '0' } })
    expect(screen.getByRole('button', { name: '기록할 음식을 골라 주세요' })).toBeDisabled()

    // 다시 넣으면 AI가 처음 준 값으로 돌아온다.
    fireEvent.click(screen.getByRole('checkbox', { name: /김치찌개/ }))
    expect(screen.getByLabelText('김치찌개 칼로리')).toHaveValue('250')
    expect(screen.getByRole('button', { name: '1건 기록하기' })).toBeEnabled()
    expect(screen.getByTestId('mealai-total')).toHaveTextContent('250kcal')

    // 한 건의 한도를 넘으면 기록을 막고 이유를 알려 준다.
    fireEvent.change(screen.getByLabelText('김치찌개 칼로리'), { target: { value: '6000' } })
    expect(screen.getByRole('alert')).toHaveTextContent('1~5,000 kcal')
    expect(screen.getByRole('button', { name: /1건 기록/ })).toBeDisabled()
    expect(meals()).toHaveLength(0)
  })

  it('내 기록에도 음식 목록에도 없을 때만 Enter가 AI로 이어진다', async () => {
    callAiMock.mockResolvedValue({ result: estimate, usage })
    open()
    type('김치찌개랑 밥')
    // 음식 목록을 불러오는 동안에는 Enter로 AI를 부르지 않는다.
    submitEntry()
    expect(callAiMock).not.toHaveBeenCalled()
    expect(await screen.findByText(NO_MATCH)).toBeInTheDocument()
    // 긴 안내와 겹치는 힌트는 보여 주지 않는다.
    expect(screen.queryByText(/맞는 음식이 없어요/)).not.toBeInTheDocument()
    expect(screen.queryByText(/이름 뒤에 숫자를 붙여 바로/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: AI_BUTTON })).toHaveClass('btn--primary')
    submitEntry()
    expect(callAiMock).toHaveBeenCalledWith({ task: 'meal-text', text: '김치찌개랑 밥' }, expect.anything())
    expect(await screen.findByRole('list', { name: 'AI가 나눈 음식' })).toBeInTheDocument()
  })

  it('숫자를 붙여 적으면 AI를 부르지 않고 바로 기록한다', async () => {
    open()
    type('김치찌개 550')
    expect(screen.queryByRole('button', { name: AI_BUTTON })).not.toBeInTheDocument()
    submitEntry()
    await waitFor(() => expect(meals()).toHaveLength(1))
    expect(meals()[0]).toMatchObject({ name: '김치찌개', kcal: 550, source: 'exact' })
    expect(callAiMock).not.toHaveBeenCalled()
  })

  it('음식을 찾지 못하면 설명을 보여 주고, 다시 적기로 돌아간다', async () => {
    callAiMock.mockResolvedValue({ result: { items: [], note: '음식에 대한 내용이 아니라서 계산하지 못했어요.' }, usage })
    open()
    type('오늘 날씨가 좋네요')
    askAi()
    expect(await screen.findByText('음식에 대한 내용이 아니라서 계산하지 못했어요.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '칼로리를 어림잡지 못했어요' })).toBeInTheDocument()
    expect(screen.getByText('음식을 알아보지 못했어요. 무엇을 얼마나 먹었는지 조금 더 적어 주세요.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /기록/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다시 적기' }))
    expect(entry()).toHaveValue('오늘 날씨가 좋네요')
    expect(entry()).toHaveFocus()
  })

  it('실패하면 이유를 알려 주고, 다시 시도하면 결과를 보여 준다', async () => {
    callAiMock.mockRejectedValueOnce(new AiError('busy')).mockResolvedValueOnce({ result: estimate, usage })
    open()
    type(TEXT)
    askAi()
    expect(await screen.findByRole('alert')).toHaveTextContent('응답이 늦어져 받지 못했어요. 다시 해 볼 수 있어요.')
    expect(screen.getByRole('button', { name: '다시 적기' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('list', { name: 'AI가 나눈 음식' })).toBeInTheDocument()
    expect(callAiMock).toHaveBeenCalledTimes(2)
    expect(callAiMock).toHaveBeenLastCalledWith({ task: 'meal-text', text: TEXT }, expect.anything())
  })

  it('다시 시도할 수 없는 실패에서도 입력 칸으로 돌아갈 수 있다', async () => {
    callAiMock.mockRejectedValue(new AiError('limit', { used: 40, limit: 40 }))
    open()
    type(TEXT)
    askAi()
    expect(await screen.findByRole('alert')).toHaveTextContent('오늘 AI 횟수(40번)를 다 썼어요. 내일 다시 쓸 수 있어요.')
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다시 적기' }))
    expect(entry()).toHaveValue(TEXT)
  })

  it('기다리는 중에 취소하면 적어 둔 글 그대로 입력 칸으로 돌아가고, 보낸 요청은 끊지 않는다', async () => {
    const calls = deferCallAi()
    open()
    type(TEXT)
    askAi()
    expect(screen.getByRole('status')).toHaveTextContent('칼로리를 어림잡는 중이에요')
    expect(screen.getByText('취소해도 오늘 횟수에서 한 번이 줄어요.')).toBeInTheDocument()
    expect(screen.queryByLabelText('음식 이름이나 칼로리')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(entry()).toHaveValue(TEXT)
    expect(entry()).toHaveFocus()
    expect(calls[0].signal?.aborted).toBe(false)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(meals()).toHaveLength(0)

    // 같은 글을 다시 누르면 새로 보내지 않고, 기다리던 요청을 이어서 본다.
    askAi()
    expect(callAiMock).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('칼로리를 어림잡는 중이에요')
    fireEvent.click(screen.getByRole('button', { name: '취소' }))

    // 답이 오면 횟수를 고치고 받아 둔다. 화면은 입력 칸에 그대로 있다.
    await act(async () => calls[0].resolve({ result: estimate, usage: { used: 5, limit: 40 } }))
    expect(useAi.getState().usage).toEqual({ used: 5, limit: 40 })
    expect(entry()).toHaveValue(TEXT)
    expect(useMealAi.getState().text).toBeNull()

    // 같은 글을 다시 물으면 또 부르지 않는다.
    askAi()
    expect(await screen.findByRole('list', { name: 'AI가 나눈 음식' })).toBeInTheDocument()
    expect(callAiMock).toHaveBeenCalledTimes(1)
  })

  it('답을 기다리는 동안에는 다른 글을 또 보내지 않는다', async () => {
    const calls = deferCallAi()
    open()
    type(TEXT)
    askAi()
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    type('떡볶이랑 순대')
    await screen.findByText(NO_MATCH)
    expect(screen.getByRole('button', { name: AI_BUTTON })).toBeDisabled()
    expect(screen.getByText('앞서 보낸 글을 어림잡는 중이에요. 끝나면 이 글도 보낼 수 있어요.')).toBeInTheDocument()
    submitEntry()
    expect(callAiMock).toHaveBeenCalledTimes(1)

    await act(async () => calls[0].resolve({ result: estimate, usage }))
    expect(screen.getByRole('button', { name: AI_BUTTON })).toBeEnabled()
    askAi()
    expect(callAiMock).toHaveBeenCalledTimes(2)
    expect(callAiMock).toHaveBeenLastCalledWith({ task: 'meal-text', text: '떡볶이랑 순대' }, expect.anything())
  })

  it('기다리는 중에 시트를 닫아도 답을 받아 두어, 다시 열어 같은 글을 물으면 또 부르지 않는다', async () => {
    const calls = deferCallAi()
    const view = open()
    type(TEXT)
    askAi()
    fireEvent.keyDown(document, { key: 'Escape' })
    view.unmount()
    expect(calls[0].signal?.aborted).toBe(false)
    await act(async () => calls[0].resolve({ result: estimate, usage: { used: 9, limit: 40 } }))
    expect(useAi.getState().usage).toEqual({ used: 9, limit: 40 })

    open()
    type(TEXT)
    askAi()
    expect(await screen.findByRole('list', { name: 'AI가 나눈 음식' })).toBeInTheDocument()
    expect(callAiMock).toHaveBeenCalledTimes(1)
  })

  it('취소한 요청이 실패로 끝나도 화면에는 나타나지 않고, 다시 물으면 새로 보낸다', async () => {
    const calls = deferCallAi()
    open()
    type(TEXT)
    askAi()
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    await act(async () => calls[0].reject(new AiError('busy', { used: 3, limit: 40 })))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(useAi.getState().usage).toEqual({ used: 3, limit: 40 })
    askAi()
    expect(callAiMock).toHaveBeenCalledTimes(2)
  })
})

describe('사진으로 기록하기', () => {
  const photo = new File(['fake'], 'lunch.jpg', { type: 'image/jpeg' })
  const base64 = 'A'.repeat(200)
  let revoke: ReturnType<typeof vi.fn<(url: string) => void>>
  const pick = () => fireEvent.change(screen.getByTestId('meal-photo-input'), { target: { files: [photo] } })

  beforeEach(() => {
    signIn()
    revoke = vi.fn<(url: string) => void>()
    URL.revokeObjectURL = revoke
    prepareImageMock.mockResolvedValue({ base64, mediaType: 'image/jpeg', previewUrl: 'blob:preview' })
  })

  it('고른 뒤 확인하기 전에는 보내지 않고, 덧붙인 말과 함께 보낸다', async () => {
    callAiMock.mockResolvedValue({ result: estimate, usage })
    open()
    const input = screen.getByTestId('meal-photo-input')
    expect(input).toHaveAttribute('accept', 'image/*')
    expect(input).not.toHaveAttribute('capture')
    pick()

    expect(await screen.findByRole('img', { name: '고른 사진' })).toHaveAttribute('src', 'blob:preview')
    expect(screen.getByRole('heading', { name: '사진으로 칼로리 어림잡기' })).toBeInTheDocument()
    expect(prepareImageMock).toHaveBeenCalledWith(photo)
    expect(callAiMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/덧붙일 말/), { target: { value: '밥은 반만 먹었어요' } })
    fireEvent.click(screen.getByRole('button', { name: SEND_PHOTO }))
    expect(callAiMock).toHaveBeenCalledWith(
      { task: 'meal-photo', imageBase64: base64, mediaType: 'image/jpeg', note: '밥은 반만 먹었어요' },
      expect.anything(),
    )

    await screen.findByRole('list', { name: 'AI가 나눈 음식' })
    fireEvent.click(screen.getByRole('button', { name: '3건 기록하기' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(meals().map((m) => [m.name, m.kcal, m.source])).toEqual([
      ['김치찌개', 250, 'ai'],
      ['쌀밥', 300, 'ai'],
      ['계란말이', 120, 'ai'],
    ])
    // 기록한 결과는 남겨 두지 않는다.
    expect(useMealAi.getState().photo).toBeNull()
    expect(revoke).toHaveBeenCalledWith('blob:preview')
  })

  it('덧붙인 말이 없으면 note 없이 보낸다', async () => {
    callAiMock.mockResolvedValue({ result: estimate, usage })
    open()
    pick()
    fireEvent.click(await screen.findByRole('button', { name: SEND_PHOTO }))
    expect(callAiMock).toHaveBeenCalledWith(
      { task: 'meal-photo', imageBase64: base64, mediaType: 'image/jpeg' },
      expect.anything(),
    )
  })

  it('보내기 전에 돌아가기를 누르면 입력 칸으로 가고 미리 보기 주소를 풀어 준다', async () => {
    open()
    type('적어 둔 글')
    pick()
    fireEvent.click(await screen.findByRole('button', { name: '돌아가기' }))
    expect(entry()).toHaveValue('적어 둔 글')
    expect(revoke).toHaveBeenCalledWith('blob:preview')
    expect(callAiMock).not.toHaveBeenCalled()
    expect(screen.queryByText(KEPT)).not.toBeInTheDocument()
  })

  it('기다리다 취소해도 요청은 끊기지 않고, 답이 오면 입력 칸 아래에서 이어 볼 수 있다', async () => {
    const calls = deferCallAi()
    open()
    type('적어 둔 글')
    pick()
    fireEvent.change(await screen.findByLabelText(/덧붙일 말/), { target: { value: '국물은 남겼어요' } })
    fireEvent.click(screen.getByRole('button', { name: SEND_PHOTO }))
    expect(screen.getByRole('status')).toHaveTextContent('사진을 보고')
    expect(screen.getByText('취소해도 오늘 횟수에서 한 번이 줄어요.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '취소' }))

    expect(entry()).toHaveValue('적어 둔 글')
    expect(calls[0].signal?.aborted).toBe(false)
    expect(revoke).not.toHaveBeenCalled()
    // 기다리는 동안에는 새 사진을 고르지 못하고, 버릴 수도 없다.
    expect(screen.getByText('보낸 사진을 어림잡는 중이에요')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: PHOTO_BUTTON })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '버리기' })).not.toBeInTheDocument()

    await act(async () => calls[0].resolve({ result: estimate, usage: { used: 2, limit: 40 } }))
    expect(useAi.getState().usage).toEqual({ used: 2, limit: 40 })
    expect(screen.getByText(KEPT)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '이어서 보기' }))
    expect(screen.getByRole('list', { name: 'AI가 나눈 음식' })).toBeInTheDocument()
    expect(callAiMock).toHaveBeenCalledTimes(1)
  })

  it('받은 사진 결과는 시트를 닫았다 열어도 남고, 이어서 보거나 버릴 수 있다', async () => {
    callAiMock.mockResolvedValue({ result: estimate, usage })
    const view = open()
    pick()
    fireEvent.click(await screen.findByRole('button', { name: SEND_PHOTO }))
    await screen.findByRole('list', { name: 'AI가 나눈 음식' })
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    view.unmount()
    expect(revoke).not.toHaveBeenCalled()

    const again = open()
    expect(screen.getByText(KEPT)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: PHOTO_BUTTON })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '이어서 보기' }))
    expect(screen.getByRole('list', { name: 'AI가 나눈 음식' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '고른 사진' })).toHaveAttribute('src', 'blob:preview')
    expect(callAiMock).toHaveBeenCalledTimes(1)
    again.unmount()

    // 횟수를 다 써서 AI 버튼이 사라져도 받아 둔 결과는 볼 수 있다.
    useAi.setState({ usage: { used: 40, limit: 40 } })
    open()
    expect(screen.getByText(KEPT)).toBeInTheDocument()
    useAi.setState({ usage })

    // 버리면 사라지고, 다시 사진을 고를 수 있다.
    fireEvent.click(screen.getByRole('button', { name: '버리기' }))
    expect(screen.queryByText(KEPT)).not.toBeInTheDocument()
    expect(revoke).toHaveBeenCalledWith('blob:preview')
    expect(await screen.findByRole('button', { name: PHOTO_BUTTON })).toBeInTheDocument()
    expect(useMealAi.getState().photo).toBeNull()
  })

  it('사진 결과에서 돌아가면 결과를 버린다고 버튼에 적어 둔다', async () => {
    callAiMock.mockResolvedValue({ result: estimate, usage })
    open()
    pick()
    fireEvent.click(await screen.findByRole('button', { name: SEND_PHOTO }))
    await screen.findByRole('list', { name: 'AI가 나눈 음식' })
    expect(screen.queryByRole('button', { name: '돌아가기' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '결과 버리고 돌아가기' }))
    expect(entry()).toHaveFocus()
    expect(revoke).toHaveBeenCalledWith('blob:preview')
    expect(screen.queryByText(KEPT)).not.toBeInTheDocument()
  })

  it('어제 받은 사진 결과와 다른 계정의 결과는 다시 보여 주지 않는다', async () => {
    callAiMock.mockResolvedValue({ result: estimate, usage })
    const view = open()
    pick()
    fireEvent.click(await screen.findByRole('button', { name: SEND_PHOTO }))
    await screen.findByRole('list', { name: 'AI가 나눈 음식' })
    view.unmount()

    const kept = useMealAi.getState().photo!
    useMealAi.setState({ photo: { ...kept, date: addDays(today(), -1) } })
    const stale = open()
    expect(screen.queryByText(KEPT)).not.toBeInTheDocument()
    expect(useMealAi.getState().photo).toBeNull()
    stale.unmount()

    useMealAi.setState({ photo: { ...kept, date: today() } })
    useSync.setState({ email: 'other@b.c' })
    expect(useMealAi.getState().photo).toBeNull()
    open()
    expect(screen.queryByText(KEPT)).not.toBeInTheDocument()
  })

  it('사진 결과를 일부만 저장했으면, 시트를 닫았다 열어도 저장된 줄은 다시 기록하지 않는다', async () => {
    callAiMock.mockResolvedValue({ result: estimate, usage })
    const realAddMeal = useStore.getState().addMeal
    useStore.setState({
      addMeal: async (m) => {
        if (m.name === '쌀밥') throw new Error('저장 실패')
        await realAddMeal(m)
      },
    })
    try {
      const view = open()
      pick()
      fireEvent.click(await screen.findByRole('button', { name: SEND_PHOTO }))
      await screen.findByRole('list', { name: 'AI가 나눈 음식' })
      fireEvent.click(screen.getByRole('button', { name: '3건 기록하기' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('1건은 기록했고')
      view.unmount()
    } finally {
      useStore.setState({ addMeal: realAddMeal })
    }
    open()
    fireEvent.click(screen.getByRole('button', { name: '이어서 보기' }))
    expect(screen.queryByLabelText('김치찌개 칼로리')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '2건 기록하기' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(meals().map((m) => m.name)).toEqual(['김치찌개', '쌀밥', '계란말이'])
  })

  it('시트가 닫힐 때도 미리 보기 주소를 풀어 준다', async () => {
    const view = open()
    pick()
    await screen.findByRole('img', { name: '고른 사진' })
    view.unmount()
    expect(revoke).toHaveBeenCalledWith('blob:preview')
  })

  it('사진을 준비하지 못하면 이유를 알려 주고 입력 칸에 머문다', async () => {
    const { ImageError } = await import('../../ai/image')
    prepareImageMock.mockRejectedValue(new ImageError('사진 파일만 쓸 수 있어요.'))
    open()
    pick()
    expect(await screen.findByRole('alert')).toHaveTextContent('사진 파일만 쓸 수 있어요.')
    expect(entry()).toBeInTheDocument()
    expect(callAiMock).not.toHaveBeenCalled()
  })
})

describe('돈이 들지 않는 길이 먼저', () => {
  beforeEach(signIn)

  it('음식 목록에 있으면 AI는 결과 뒤의 보조 버튼이 되고 Enter로는 부르지 않는다', async () => {
    callAiMock.mockResolvedValue({ result: estimate, usage })
    open()
    type('김치')
    const results = await screen.findByRole('list', { name: '검색 결과' })
    const ai = screen.getByRole('button', { name: AI_BUTTON })
    expect(ai).not.toHaveClass('btn--primary')
    expect(results.compareDocumentPosition(ai) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    submitEntry()
    expect(callAiMock).not.toHaveBeenCalled()
    // 직접 누르면 부른다.
    fireEvent.click(ai)
    expect(callAiMock).toHaveBeenCalledWith({ task: 'meal-text', text: '김치' }, expect.anything())
  })

  it('전에 먹은 것에 있으면 그것이 먼저 나오고 Enter로는 AI를 부르지 않는다', async () => {
    await useStore.getState().addMeal({ date: today(), kcal: 480, name: '엄마표 잡채', source: 'exact' })
    open()
    type('잡채')
    await screen.findByText(NO_MATCH)
    const mine = screen.getByRole('button', { name: '엄마표 잡채 480 kcal 기록' })
    const ai = screen.getByRole('button', { name: AI_BUTTON })
    expect(ai).not.toHaveClass('btn--primary')
    expect(mine.compareDocumentPosition(ai) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    submitEntry()
    expect(callAiMock).not.toHaveBeenCalled()
  })

  it("'계란 2'처럼 이름 뒤에 작은 숫자만 붙이면 두 가지를 다 보여 주고, Enter로는 어느 쪽도 하지 않는다", async () => {
    callAiMock.mockResolvedValue({ result: estimate, usage })
    open()
    type('계란 2')
    expect(screen.queryByTestId('entry-submit')).not.toBeInTheDocument()
    const asKcal = screen.getByRole('button', { name: '계란 · 2 kcal 기록하기' })
    const ai = screen.getByRole('button', { name: AI_BUTTON })
    expect(asKcal).toHaveAttribute('type', 'button')
    expect(ai).toHaveAttribute('type', 'button')
    expect(asKcal).not.toHaveClass('btn--primary')
    expect(ai).not.toHaveClass('btn--primary')
    expect(screen.getByText('뒤의 숫자가 칼로리인지 양인지 알 수 없어요. 맞는 쪽을 눌러 주세요.')).toBeInTheDocument()
    // 음식 목록을 다 불러온 뒤에도 Enter는 아무것도 하지 않는다.
    await act(async () => {})
    submitEntry()
    expect(callAiMock).not.toHaveBeenCalled()
    expect(meals()).toHaveLength(0)

    // AI를 누르면 숫자까지 적은 글 그대로 보낸다.
    fireEvent.click(ai)
    expect(callAiMock).toHaveBeenCalledWith({ task: 'meal-text', text: '계란 2' }, expect.anything())
    await screen.findByRole('list', { name: 'AI가 나눈 음식' })
    fireEvent.click(screen.getByRole('button', { name: '다시 적기' }))

    // 칼로리로 기록하기를 누르면 그 숫자 그대로 기록한다.
    type('아메리카노 10')
    fireEvent.click(screen.getByRole('button', { name: '아메리카노 · 10 kcal 기록하기' }))
    await waitFor(() => expect(meals()).toHaveLength(1))
    expect(meals()[0]).toMatchObject({ name: '아메리카노', kcal: 10, source: 'exact' })
    expect(callAiMock).toHaveBeenCalledTimes(1)
  })

  it('kcal을 붙여 밝힌 숫자는 작아도 그대로 기록한다', async () => {
    open()
    type('제로콜라 5kcal')
    expect(screen.getByTestId('entry-submit')).toHaveTextContent('제로콜라 · 5 kcal 기록하기')
    expect(screen.queryByRole('button', { name: AI_BUTTON })).not.toBeInTheDocument()
    submitEntry()
    await waitFor(() => expect(meals()).toHaveLength(1))
    expect(meals()[0]).toMatchObject({ name: '제로콜라', kcal: 5, source: 'exact' })
    expect(callAiMock).not.toHaveBeenCalled()
  })

  it("'회식 6000'처럼 범위를 벗어난 숫자를 붙이면 이유를 알려 주고, Enter로 AI를 부르지 않는다", async () => {
    open()
    type('회식 6000')
    expect(screen.getByRole('alert')).toHaveTextContent('한 번에 1~5,000 kcal까지 기록할 수 있어요.')
    await screen.findByText(NO_MATCH)
    const ai = screen.getByRole('button', { name: AI_BUTTON })
    expect(ai).not.toHaveClass('btn--primary')
    expect(ai).toHaveAttribute('type', 'button')
    submitEntry()
    expect(callAiMock).not.toHaveBeenCalled()
    expect(meals()).toHaveLength(0)
  })

  it('음식 목록을 불러오지 못했으면 Enter로 AI를 부르지 않는다', async () => {
    vi.mocked(loadFoodDb).mockRejectedValueOnce(new Error('offline'))
    open()
    type('김치찌개랑 밥')
    expect(await screen.findByText(/음식 목록을 불러오지 못했어요/)).toBeInTheDocument()
    submitEntry()
    expect(callAiMock).not.toHaveBeenCalled()
    // 직접 누르는 버튼은 남아 있다.
    const ai = screen.getByRole('button', { name: AI_BUTTON })
    expect(ai).not.toHaveClass('btn--primary')
    expect(ai).toHaveAttribute('type', 'button')
  })

  it('넉넉한 숫자와 숫자만 적은 것은 그대로 바로 기록한다', () => {
    open()
    type('계란 150')
    expect(screen.getByTestId('entry-submit')).toHaveTextContent('계란 · 150 kcal 기록하기')
    type('2')
    expect(screen.getByTestId('entry-submit')).toHaveTextContent('2 kcal 기록하기')
  })

  it('입력 칸의 예시와 안내가 AI를 쓸 수 있는 상태에 맞게 나온다', () => {
    open()
    expect(entry()).toHaveAttribute('placeholder', '예: 550 · 김치찌개랑 밥')
    expect(
      screen.getByText('숫자만 적으면 바로 기록해요. 이름을 적으면 전에 먹은 것과 음식 목록에서 찾고, AI로 어림잡을 수도 있어요.'),
    ).toBeInTheDocument()
    expect(screen.getByText('적은 글과 고른 사진은 칼로리를 어림잡을 때만 AI에 보내요.')).toBeInTheDocument()
  })
})

describe('받은 결과를 잃지 않기', () => {
  beforeEach(signIn)

  it('AI 단계에서는 바깥을 눌러도 닫히지 않고, Esc와 닫기로는 닫힌다', async () => {
    callAiMock.mockResolvedValue({ result: estimate, usage })
    open()
    type(TEXT)
    askAi()
    await screen.findByRole('list', { name: 'AI가 나눈 음식' })
    fireEvent.click(screen.getByRole('dialog', { name: '식사 추가' }).parentElement!)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('같은 글을 다시 물으면 AI를 또 부르지 않고, 글이 바뀌면 다시 부른다', async () => {
    callAiMock.mockResolvedValue({ result: estimate, usage })
    const view = open()
    type(TEXT)
    askAi()
    await screen.findByRole('list', { name: 'AI가 나눈 음식' })
    fireEvent.click(screen.getByRole('button', { name: '다시 적기' }))
    expect(entry()).toHaveValue(TEXT)
    askAi()
    expect(await screen.findByRole('list', { name: 'AI가 나눈 음식' })).toBeInTheDocument()
    expect(callAiMock).toHaveBeenCalledTimes(1)

    // 시트를 닫았다 열어도 남아 있다.
    view.unmount()
    open()
    type(`  ${TEXT} `)
    askAi()
    expect(await screen.findByRole('list', { name: 'AI가 나눈 음식' })).toBeInTheDocument()
    expect(callAiMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '다시 적기' }))
    type(`${TEXT} 그리고 김`)
    askAi()
    expect(callAiMock).toHaveBeenCalledTimes(2)
  })

  it('로그아웃하면 받아 둔 어림값을 지운다', async () => {
    callAiMock.mockResolvedValue({ result: estimate, usage })
    const view = open()
    type(TEXT)
    askAi()
    await screen.findByRole('list', { name: 'AI가 나눈 음식' })
    view.unmount()
    useSync.setState({ email: null })
    signIn()
    open()
    type(TEXT)
    askAi()
    expect(callAiMock).toHaveBeenCalledTimes(2)
  })

  it('여러 건 중 하나가 실패하면 저장된 것은 목록에서 빼고, 다시 기록해도 두 번 들어가지 않는다', async () => {
    callAiMock.mockResolvedValue({ result: estimate, usage })
    const realAddMeal = useStore.getState().addMeal
    let failNext = true
    useStore.setState({
      addMeal: async (m) => {
        if (m.name === '쌀밥' && failNext) {
          failNext = false
          throw new Error('저장 실패')
        }
        await realAddMeal(m)
      },
    })
    try {
      open()
      type(TEXT)
      askAi()
      await screen.findByRole('list', { name: 'AI가 나눈 음식' })
      fireEvent.click(screen.getByRole('button', { name: '3건 기록하기' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('1건은 기록했고, 남은 2건을 저장하지 못했어요')
      // 목록이 길어도 보이게, 늘 붙어 있는 아래 칸의 기록 버튼 바로 위에 둔다.
      const footer = screen.getByTestId('mealai-total').closest('.mealai-footer')!
      expect(footer).toContainElement(alert)
      const submit = within(footer as HTMLElement).getByRole('button', { name: '2건 기록하기' })
      expect(alert.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(screen.getAllByRole('alert')).toHaveLength(1)
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.queryByLabelText('김치찌개 칼로리')).not.toBeInTheDocument()
      expect(screen.getByTestId('mealai-total')).toHaveTextContent('420kcal')

      fireEvent.click(screen.getByRole('button', { name: '2건 기록하기' }))
      await waitFor(() => expect(onClose).toHaveBeenCalled())
      expect(meals().map((m) => m.name)).toEqual(['김치찌개', '쌀밥', '계란말이'])
    } finally {
      useStore.setState({ addMeal: realAddMeal })
    }
  })
})

describe('횟수와 계정 상태', () => {
  const LIMIT = '오늘 AI 횟수를 다 썼어요. 내일 다시 쓸 수 있어요. 칼로리를 직접 적거나 대충 기록하는 건 그대로 할 수 있어요.'
  const after = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

  it('오늘 횟수를 다 쓰면 AI 버튼이 있던 자리에 안내 한 줄을 보여 주고, 막다른 화면이 되지 않게 한다', async () => {
    signIn()
    useAi.setState({ usage: { used: 40, limit: 40 } })
    open()
    expect(screen.getByText(LIMIT)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: PHOTO_BUTTON })).not.toBeInTheDocument()
    expect(screen.queryByText(/번 더 쓸 수 있어요/)).not.toBeInTheDocument()
    expect(entry()).toHaveAttribute('placeholder', '예: 550 · 김치찌개 550')

    // 찾은 것이 있으면 안내는 그 결과 아래에 온다.
    type('김치')
    const results = await screen.findByRole('list', { name: '검색 결과' })
    expect(after(results, screen.getByText(LIMIT))).toBe(true)
    expect(screen.queryByRole('button', { name: /^보통/ })).not.toBeInTheDocument()

    // 찾은 것이 없으면 짧게 알리고, 안내와 대충 기록을 그 아래에 둔다.
    type('없는음식')
    const none = await screen.findByText("'없는음식'에 맞는 음식이 없어요. 포장 가공식품은 들어 있지 않아요.")
    expect(after(none, screen.getByText(LIMIT))).toBe(true)
    expect(after(screen.getByText(LIMIT), screen.getByRole('button', { name: /^보통/ }))).toBe(true)
    expect(screen.getAllByText(/숫자를 붙여/)).toHaveLength(1)
    expect(screen.queryByRole('button', { name: AI_BUTTON })).not.toBeInTheDocument()
    submitEntry()
    expect(callAiMock).not.toHaveBeenCalled()
  })

  it('로그인하지 않았을 때도 안내는 결과 아래에 오고, 찾은 것이 없으면 대충 기록을 함께 보여 준다', async () => {
    open()
    type('김치')
    const results = await screen.findByRole('list', { name: '검색 결과' })
    const hint = screen.getByText(/로그인하면 사진이나 말로 적은 식사를 AI가 어림잡아 줘요\./)
    expect(after(results, hint)).toBe(true)
    type('없는음식')
    await screen.findByText("'없는음식'에 맞는 음식이 없어요. 포장 가공식품은 들어 있지 않아요.")
    expect(screen.getByRole('button', { name: /^가볍게|^보통/ })).toBeInTheDocument()
  })

  it('남은 횟수는 10번 이하일 때만 알려 준다', () => {
    signIn()
    useAi.setState({ usage: { used: 29, limit: 40 } })
    const view = open()
    expect(screen.queryByText(/번 더 쓸 수 있어요/)).not.toBeInTheDocument()
    view.unmount()
    useAi.setState({ usage: { used: 33, limit: 40 } })
    open()
    expect(screen.getByText('AI를 오늘 7번 더 쓸 수 있어요')).toBeInTheDocument()
  })

  it('로그인 상태를 아직 되살리는 중이면 로그인 안내를 보여 주지 않는다', () => {
    useSync.setState({ ready: false })
    open()
    expect(screen.queryByText(/로그인하면/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: PHOTO_BUTTON })).not.toBeInTheDocument()
    act(() => useSync.setState({ ready: true }))
    expect(screen.getByText(/로그인하면/)).toBeInTheDocument()
  })

  it('기록을 어떻게 할지 정하지 않았으면 설정으로 안내한다', () => {
    useSync.setState({ email: 'a@b.c', conflict: { localCount: 3, remoteCount: 5 } })
    open()
    expect(screen.getByText(/이 기기와 계정의 기록 중 어느 쪽을 쓸지 정하면 AI를 쓸 수 있어요\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '설정에서 정하기' })).toHaveAttribute('href', '/settings')
    expect(screen.queryByRole('link', { name: '설정에서 로그인' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: PHOTO_BUTTON })).not.toBeInTheDocument()
  })

  it('이 계정은 쓸 수 없다는 답을 받으면 그 뒤로는 AI를 숨긴다', async () => {
    signIn()
    callAiMock.mockRejectedValue(new AiError('forbidden'))
    open()
    type(TEXT)
    askAi()
    expect(await screen.findByRole('alert')).toHaveTextContent('이 계정은 AI 기능을 쓸 수 없어요.')
    expect(useAi.getState().forbidden).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '다시 적기' }))
    expect(screen.queryByRole('button', { name: AI_BUTTON })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: PHOTO_BUTTON })).not.toBeInTheDocument()
    // 계정이 바뀌면 다시 확인한다.
    useSync.setState({ email: null })
    expect(useAi.getState().forbidden).toBe(false)
  })

  it('aiAvailability는 off → conflict → login → limit → ready 순서로 정한다', () => {
    expect(aiAvailability(false, true)).toBe('off')
    expect(aiAvailability(true, false)).toBe('login')
    expect(aiAvailability(true, true)).toBe('ready')
    expect(aiAvailability(true, true, { forbidden: true })).toBe('off')
    expect(aiAvailability(true, true, { conflict: true, quotaLeft: 0 })).toBe('conflict')
    expect(aiAvailability(true, false, { conflict: true, quotaLeft: 0 })).toBe('login')
    expect(aiAvailability(true, true, { quotaLeft: 0 })).toBe('limit')
    expect(aiAvailability(true, true, { quotaLeft: null })).toBe('ready')
    expect(aiAvailability(true, true, { quotaLeft: 3 })).toBe('ready')
    expect(quotaLeft(null)).toBeNull()
    expect(quotaLeft({ used: 33, limit: 40 })).toBe(7)
    expect(quotaLeft({ used: 41, limit: 40 })).toBe(0)
  })
})

describe('사진에서 음식을 찾지 못했을 때', () => {
  it('사진에 맞는 안내와 AI가 덧붙인 말을 보여 준다', async () => {
    signIn()
    URL.revokeObjectURL = vi.fn<(url: string) => void>()
    prepareImageMock.mockResolvedValue({ base64: 'A'.repeat(200), mediaType: 'image/jpeg', previewUrl: 'blob:preview' })
    callAiMock.mockResolvedValue({ result: { items: [], note: '사진이 너무 어두워요.' }, usage })
    open()
    fireEvent.change(screen.getByTestId('meal-photo-input'), {
      target: { files: [new File(['fake'], 'lunch.jpg', { type: 'image/jpeg' })] },
    })
    fireEvent.click(await screen.findByRole('button', { name: SEND_PHOTO }))
    expect(await screen.findByText('사진에서 음식을 알아보지 못했어요. 다른 사진으로 해 주세요.')).toBeInTheDocument()
    expect(screen.getByText('사진이 너무 어두워요.')).toBeInTheDocument()
    // 음식을 찾지 못한 결과는 남겨 둘 것이 없다.
    cleanup()
    expect(useMealAi.getState().photo).toBeNull()
    open()
    expect(screen.queryByText(KEPT)).not.toBeInTheDocument()
  })
})

describe('오늘 쓴 횟수', () => {
  const status = (used?: number) => ({ configured: true, dailyLimit: 40, ...(used === undefined ? {} : { used }) })

  it('처음 확인할 때 오늘 쓴 횟수를 받아 두고, 로그인하면 그 계정의 횟수를 다시 받아 온다', async () => {
    let used: number | undefined = undefined
    stubFetch(() => status(used))
    useAi.setState({ configured: false, checked: false })
    await useAi.getState().check()
    expect(useAi.getState()).toMatchObject({ configured: true, checked: true, usage: null })
    // 이미 확인했으면 다시 묻지 않는다.
    await useAi.getState().check()
    expect(statusCalls()).toBe(1)

    used = 12
    signIn()
    await waitFor(() => expect(useAi.getState().usage).toEqual({ used: 12, limit: 40 }))
    expect(useAi.getState().usageDate).toBe(today())
    expect(statusCalls()).toBe(2)

    // 계정이 바뀌면 앞 계정의 횟수는 바로 지우고 새로 받아 온다.
    used = 3
    useSync.setState({ email: 'other@b.c' })
    expect(useAi.getState().usage).toBeNull()
    await waitFor(() => expect(useAi.getState().usage).toEqual({ used: 3, limit: 40 }))

    // 로그아웃하면 지우기만 한다.
    useSync.setState({ email: null })
    expect(useAi.getState().usage).toBeNull()
    await act(async () => {})
    expect(statusCalls()).toBe(3)
  })

  it('확인하는 사이에 계정이 바뀌면 앞 계정의 횟수를 새 계정에 쓰지 않는다', async () => {
    const answers: ((used: number) => void)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            answers.push((used) => resolve({ ok: true, json: async () => status(used) }))
          }),
      ),
    )
    signIn()
    await waitFor(() => expect(answers).toHaveLength(1))
    useSync.setState({ email: 'other@b.c' })
    await waitFor(() => expect(answers).toHaveLength(2))
    await act(async () => answers[0](40))
    expect(useAi.getState().usage).toBeNull()
    await act(async () => answers[1](7))
    expect(useAi.getState().usage).toEqual({ used: 7, limit: 40 })
  })

  it('다시 확인하다 실패해도 쓰던 AI 기능을 끄지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))))
    signIn()
    await useAi.getState().check(true)
    expect(useAi.getState().configured).toBe(true)
  })

  it('알던 횟수가 어제 것이면 화면을 열 때 오늘 횟수를 다시 받아 온다', async () => {
    stubFetch(() => status(1))
    signIn()
    await waitFor(() => expect(useAi.getState().usage).toEqual({ used: 1, limit: 40 }))
    useAi.setState({ usage: { used: 40, limit: 40 }, usageDate: addDays(today(), -1) })
    const before = statusCalls()
    open()
    // 어제 다 쓴 횟수 때문에 막히지 않는다.
    expect(screen.getByRole('button', { name: PHOTO_BUTTON })).toBeInTheDocument()
    await waitFor(() => expect(useAi.getState()).toMatchObject({ usage: { used: 1, limit: 40 }, usageDate: today() }))
    expect(statusCalls()).toBe(before + 1)
  })

  it('useAiCall도 기다리는 사이에 계정이 바뀌면 횟수와 사용 불가 표시를 쓰지 않는다', async () => {
    signIn()
    const calls = deferCallAi()
    const { result } = renderHook(() => useAiCall())
    let done!: Promise<unknown>
    act(() => {
      done = result.current.run({ task: 'meal-text', text: TEXT })
    })
    useSync.setState({ email: 'other@b.c' })
    await act(async () => {
      calls[0].resolve({ result: estimate, usage: { used: 39, limit: 40 } })
      await done
    })
    expect(useAi.getState().usage).toBeNull()
    expect(result.current.state.status).toBe('idle')

    act(() => {
      done = result.current.run({ task: 'meal-text', text: TEXT })
    })
    useSync.setState({ email: 'third@b.c' })
    await act(async () => {
      calls[1].reject(new AiError('forbidden', { used: 40, limit: 40 }))
      await done
    })
    expect(useAi.getState()).toMatchObject({ usage: null, forbidden: false })
  })
})

describe('결과 화면의 배치와 이름', () => {
  beforeEach(signIn)

  it('어림값이라는 말은 AI가 덧붙인 말 바로 아래, 기록 버튼보다 앞에 온다', async () => {
    callAiMock.mockResolvedValue({ result: estimate, usage })
    open()
    type(TEXT)
    askAi()
    await screen.findByRole('list', { name: 'AI가 나눈 음식' })
    const note = screen.getByText('계란말이는 두 조각으로 봤어요.')
    const disclaimer = screen.getByText('실제와 다를 수 있어요. 숫자를 눌러 고칠 수 있어요.')
    const footer = screen.getByTestId('mealai-total').closest('.mealai-footer')!
    expect(note.nextElementSibling).toBe(disclaimer)
    expect(disclaimer.nextElementSibling).toBe(footer)
    expect(footer.nextElementSibling).toBe(screen.getByRole('button', { name: '다시 적기' }))
  })

  it('AI 단계에서도 Tab은 시트 안에서만 돈다', async () => {
    callAiMock.mockResolvedValue({ result: estimate, usage })
    open()
    type(TEXT)
    askAi()
    await screen.findByRole('list', { name: 'AI가 나눈 음식' })
    // 단계 제목은 포커스를 받지만 Tab으로 들르는 자리는 아니다.
    expect(screen.getByRole('heading', { name: 'AI가 어림잡은 칼로리' })).toHaveFocus()
    screen.getByRole('button', { name: '다시 적기' }).focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('button', { name: '닫기' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: '다시 적기' })).toHaveFocus()
  })
})
