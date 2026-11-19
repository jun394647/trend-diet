import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AiError, callAi } from '../../ai/client'
import type { MealEstimate } from '../../ai/contract'
import { prepareImage } from '../../ai/image'
import { aiAvailability, quotaLeft, useAi } from '../../ai/store'
import { today } from '../../lib/date'
import type { FoodDbFile } from '../../lib/foodSearch'
import { useStore } from '../../store'
import { useSync } from '../../sync/store'
import type { Profile } from '../../types'
import MealSheet from '../MealSheet'

vi.mock('../../ai/client', async (original) => ({
  ...(await original<typeof import('../../ai/client')>()),
  callAi: vi.fn(),
}))
vi.mock('../../ai/image', async (original) => ({
  ...(await original<typeof import('../../ai/image')>()),
  prepareImage: vi.fn(),
}))

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
  useAi.setState({ configured: false, checked: false, usage: null, usageDate: null, forbidden: false })
  useSync.setState({ email: null, conflict: null })
})

describe('로그인하지 않았을 때', () => {
  it('로그인 안내 한 줄만 보여 주고 AI 버튼은 보여 주지 않는다', () => {
    open()
    expect(screen.getByText(/로그인하면 사진이나 말로 적은 식사를 AI가 어림잡아 줘요\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '설정에서 로그인' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: PHOTO_BUTTON })).not.toBeInTheDocument()
    type('김치찌개랑 밥')
    expect(screen.queryByRole('button', { name: AI_BUTTON })).not.toBeInTheDocument()
    fireEvent.submit(entry().closest('form')!)
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
    fireEvent.submit(entry().closest('form')!)
    expect(callAiMock).not.toHaveBeenCalled()
    expect(await screen.findByText(NO_MATCH)).toBeInTheDocument()
    // 긴 안내와 겹치는 힌트는 보여 주지 않는다.
    expect(screen.queryByText(/맞는 음식이 없어요/)).not.toBeInTheDocument()
    expect(screen.queryByText(/이름 뒤에 숫자를 붙여 바로/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: AI_BUTTON })).toHaveClass('btn--primary')
    fireEvent.submit(entry().closest('form')!)
    expect(callAiMock).toHaveBeenCalledWith({ task: 'meal-text', text: '김치찌개랑 밥' }, expect.anything())
    expect(await screen.findByRole('list', { name: 'AI가 나눈 음식' })).toBeInTheDocument()
  })

  it('숫자를 붙여 적으면 AI를 부르지 않고 바로 기록한다', async () => {
    open()
    type('김치찌개 550')
    expect(screen.queryByRole('button', { name: AI_BUTTON })).not.toBeInTheDocument()
    fireEvent.submit(entry().closest('form')!)
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
    expect(await screen.findByRole('alert')).toHaveTextContent('지금 응답이 늦어요')
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
    expect(await screen.findByRole('alert')).toHaveTextContent('40회')
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다시 적기' }))
    expect(entry()).toHaveValue(TEXT)
  })

  it('기다리는 중에 취소하면 적어 둔 글 그대로 입력 칸으로 돌아간다', async () => {
    let signal: AbortSignal | undefined
    callAiMock.mockImplementation((_request, s) => {
      signal = s
      return new Promise(() => {})
    })
    open()
    type(TEXT)
    askAi()
    expect(screen.getByRole('status')).toHaveTextContent('칼로리를 어림잡는 중이에요')
    expect(screen.getByText('취소해도 이번 한 번은 쓴 것으로 세요.')).toBeInTheDocument()
    expect(screen.queryByLabelText('음식 이름이나 칼로리')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(entry()).toHaveValue(TEXT)
    expect(signal?.aborted).toBe(true)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(meals()).toHaveLength(0)
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
    fireEvent.click(screen.getByRole('button', { name: '칼로리 어림잡기' }))
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
  })

  it('덧붙인 말이 없으면 note 없이 보낸다', async () => {
    callAiMock.mockResolvedValue({ result: estimate, usage })
    open()
    pick()
    fireEvent.click(await screen.findByRole('button', { name: '칼로리 어림잡기' }))
    expect(callAiMock).toHaveBeenCalledWith(
      { task: 'meal-photo', imageBase64: base64, mediaType: 'image/jpeg' },
      expect.anything(),
    )
  })

  it('기다리다 취소하면 보내기 전 단계로, 돌아가기를 누르면 입력 칸으로 가고 미리 보기 주소를 풀어 준다', async () => {
    callAiMock.mockImplementation(() => new Promise(() => {}))
    open()
    type('적어 둔 글')
    pick()
    fireEvent.change(await screen.findByLabelText(/덧붙일 말/), { target: { value: '국물은 남겼어요' } })
    fireEvent.click(screen.getByRole('button', { name: '칼로리 어림잡기' }))
    expect(screen.getByRole('status')).toHaveTextContent('사진을 보고')
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.getByLabelText(/덧붙일 말/)).toHaveValue('국물은 남겼어요')
    expect(revoke).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '돌아가기' }))
    expect(entry()).toHaveValue('적어 둔 글')
    expect(revoke).toHaveBeenCalledWith('blob:preview')
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
    fireEvent.submit(entry().closest('form')!)
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
    fireEvent.submit(entry().closest('form')!)
    expect(callAiMock).not.toHaveBeenCalled()
  })

  it("'계란 2'는 2 kcal로 기록하지 않고 글로 본다", async () => {
    open()
    type('계란 2')
    expect(screen.queryByTestId('entry-submit')).not.toBeInTheDocument()
    await screen.findByText(NO_MATCH)
    expect(screen.getByRole('button', { name: AI_BUTTON })).toHaveClass('btn--primary')
    expect(meals()).toHaveLength(0)
    // 숫자만 적은 것과 넉넉한 숫자는 그대로 바로 기록한다.
    type('계란 150')
    expect(screen.getByTestId('entry-submit')).toHaveTextContent('계란 · 150 kcal 기록하기')
    type('2')
    expect(screen.getByTestId('entry-submit')).toHaveTextContent('2 kcal 기록하기')
  })

  it('입력 칸의 예시와 안내가 AI를 쓸 수 있는 상태에 맞게 나온다', () => {
    open()
    expect(entry()).toHaveAttribute('placeholder', '예: 550 · 김치찌개 550 · 김치찌개랑 밥 한 공기')
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

      expect(await screen.findByRole('alert')).toHaveTextContent('1건은 기록했고, 남은 2건을 저장하지 못했어요')
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
  it('오늘 횟수를 다 쓰면 AI 버튼 대신 안내 한 줄을 보여 준다', async () => {
    signIn()
    useAi.setState({ usage: { used: 40, limit: 40 } })
    open()
    expect(
      screen.getByText('오늘 AI 횟수를 다 썼어요. 내일 다시 쓸 수 있어요. 숫자를 직접 적거나 대충 기록은 그대로 쓸 수 있어요.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: PHOTO_BUTTON })).not.toBeInTheDocument()
    expect(screen.queryByText(/번 남았어요/)).not.toBeInTheDocument()
    type('없는음식')
    expect(await screen.findByText(/맞는 음식이 없어요/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: AI_BUTTON })).not.toBeInTheDocument()
    fireEvent.submit(entry().closest('form')!)
    expect(callAiMock).not.toHaveBeenCalled()
  })

  it('남은 횟수는 10번 이하일 때만 알려 준다', () => {
    signIn()
    useAi.setState({ usage: { used: 29, limit: 40 } })
    const view = open()
    expect(screen.queryByText(/번 남았어요/)).not.toBeInTheDocument()
    view.unmount()
    useAi.setState({ usage: { used: 33, limit: 40 } })
    open()
    expect(screen.getByText('오늘 7번 남았어요')).toBeInTheDocument()
  })

  it('기록을 어떻게 할지 정하지 않았으면 설정으로 안내한다', () => {
    useSync.setState({ email: 'a@b.c', conflict: { localCount: 3, remoteCount: 5 } })
    open()
    expect(screen.getByText(/기록을 어떻게 할지 정하면 AI를 쓸 수 있어요/)).toBeInTheDocument()
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
    fireEvent.click(await screen.findByRole('button', { name: '칼로리 어림잡기' }))
    expect(await screen.findByText('사진에서 음식을 알아보지 못했어요. 다른 사진으로 해 주세요.')).toBeInTheDocument()
    expect(screen.getByText('사진이 너무 어두워요.')).toBeInTheDocument()
  })
})
