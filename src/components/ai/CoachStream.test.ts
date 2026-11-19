/**
 * 조금씩 오는 답이 저장소에 어떻게 들어가는지. 서버 응답만 가짜(SSE)로 두고,
 * 브라우저 쪽 경로(callAi → callAiOnce → 저장소)는 실제 코드를 그대로 지난다.
 */
import { AI_STREAM_MIME, type AiRequest, type CoachContext, type WeekReview } from '../../ai/contract'
import { useAi } from '../../ai/store'
import { useSync } from '../../sync/store'
import { AI_TIMEOUT_MS } from './CoachCall'
import { resetCoach, useCoach } from './CoachStore'
import { clearWeekReviewCache, requestWeekReview, useWeekReview } from './WeekReviewCache'

const getSession = vi.hoisted(() => vi.fn())
vi.mock('../../sync/supabase', () => ({ supabase: { auth: { getSession } }, createRemote: vi.fn() }))

const ctx = { today: '2026-11-19' } as CoachContext
const usage = (used: number) => ({ used, limit: 40 })

interface Sent {
  body: AiRequest
  headers: Record<string, string>
  signal: AbortSignal
  send: (event: unknown) => void
  end: () => void
  fail: (e: unknown) => void
}

/** 요청마다 본문을 조금씩 흘려보낼 수 있는 가짜 서버. */
function fakeServer() {
  const sent: Sent[] = []
  const encoder = new TextEncoder()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      // 계정이 바뀌면 앱이 상태(GET)를 다시 묻는다. 그 요청은 여기서 다루는 것이 아니다.
      if (init.method !== 'POST') return Response.json({ configured: true, dailyLimit: 40 })
      let controller!: ReadableStreamDefaultController<Uint8Array>
      const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) })
      const signal = init.signal as AbortSignal
      // 실제 fetch처럼, 취소되면 읽던 본문이 AbortError로 끝난다.
      signal.addEventListener('abort', () => {
        try {
          controller.error(new DOMException('aborted', 'AbortError'))
        } catch {
          // 이미 닫혔다.
        }
      })
      sent.push({
        body: JSON.parse(String(init.body)) as AiRequest,
        headers: init.headers as Record<string, string>,
        signal,
        send: (event) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)),
        end: () => controller.close(),
        fail: (e) => controller.error(e),
      })
      return new Response(body, { status: 200, headers: { 'Content-Type': `${AI_STREAM_MIME}; charset=utf-8` } })
    }),
  )
  return sent
}

/** 밀려 있는 약속들을 처리한다(가짜 시계를 쓰는 동안에도 통한다). */
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await vi.advanceTimersByTimeAsync(0)
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

const coach = () => useCoach.getState()
const texts = () => coach().messages.map((m) => `${m.role}:${m.text}`)

beforeEach(() => {
  vi.useFakeTimers()
  getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
  useSync.setState({ email: 'a@b.c' })
  useAi.setState({ configured: true, checked: true, usage: null, usageDate: null, forbidden: false })
  resetCoach()
  clearWeekReviewCache()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  getSession.mockReset()
})

describe('코치: 답이 조금씩 채워진다', () => {
  it('첫 글자가 오기 전에는 내 질문이 마지막이고, 오기 시작하면 코치의 메시지가 생겨 자라난다', async () => {
    const sent = fakeServer()
    coach().send(ctx, '외식이 있어요')
    await settle()
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toMatchObject({ task: 'ask', question: '외식이 있어요', history: [] })
    expect(sent[0].headers.Accept).toContain(AI_STREAM_MIME)
    expect(texts()).toEqual(['user:외식이 있어요'])
    expect(coach().pending).toBe(true)

    // 횟수를 썼다는 것만 온 때: 아직 보여 줄 글이 없다.
    sent[0].send({ type: 'start', usage: usage(3) })
    await settle()
    expect(texts()).toEqual(['user:외식이 있어요'])

    sent[0].send({ type: 'partial', result: { answer: '외식 날은' } })
    await settle()
    expect(texts()).toEqual(['user:외식이 있어요', 'assistant:외식 날은'])
    expect(coach().pending).toBe(true)
    const id = coach().messages[1].id

    await vi.advanceTimersByTimeAsync(800)
    sent[0].send({ type: 'partial', result: { answer: '외식 날은 범위 위쪽까지 써도' } })
    await settle()
    expect(texts()).toEqual(['user:외식이 있어요', 'assistant:외식 날은 범위 위쪽까지 써도'])
    expect(coach().messages[1].id).toBe(id)
    expect(coach().pending).toBe(true)
    // 쓰이는 동안에는 새 질문을 받지 않는다.
    coach().send(ctx, '또 물어볼게요')
    expect(sent).toHaveLength(1)

    sent[0].send({ type: 'done', ok: true, result: { answer: '외식 날은 범위 위쪽까지 써도 괜찮아요.' }, usage: usage(3) })
    await settle()
    // 끝나면 한 덩어리로 받았을 때와 같은 상태다.
    expect(texts()).toEqual(['user:외식이 있어요', 'assistant:외식 날은 범위 위쪽까지 써도 괜찮아요.'])
    expect(coach().messages[1].id).toBe(id)
    expect(coach().pending).toBe(false)
    expect(coach().error).toBeNull()
    expect(useAi.getState().usage).toEqual(usage(3))

    // 다음 질문에는 완성된 답이 이전 대화로 간다.
    coach().send(ctx, '그럼 다음 날은요')
    await settle()
    expect(sent[1].body).toMatchObject({
      question: '그럼 다음 날은요',
      history: [
        { role: 'user', text: '외식이 있어요' },
        { role: 'assistant', text: '외식 날은 범위 위쪽까지 써도 괜찮아요.' },
      ],
    })
  })

  it('한 글자도 오기 전에 끝난 답도 그대로 들어간다', async () => {
    const sent = fakeServer()
    coach().send(ctx, '질문')
    await settle()
    sent[0].send({ type: 'done', ok: true, result: { answer: '네.' }, usage: usage(1) })
    await settle()
    expect(texts()).toEqual(['user:질문', 'assistant:네.'])
    expect(coach().pending).toBe(false)
  })

  it.each([
    ['error 사건', (s: Sent) => s.send({ type: 'error', ok: false, error: 'busy', usage: usage(4) }), 'busy'],
    ['거절', (s: Sent) => s.send({ type: 'error', ok: false, error: 'refused', usage: usage(4) }), 'refused'],
    ['끝맺지 못하고 끊김', (s: Sent) => s.end(), 'busy'],
    ['네트워크 오류', (s: Sent) => s.fail(new TypeError('network error')), 'busy'],
  ] as const)('도중에 실패하면(%s) 쓰이던 답을 거두고 예전과 같은 실패 상태가 된다', async (_name, breakIt, code) => {
    const sent = fakeServer()
    coach().send(ctx, '외식이 있어요')
    await settle()
    sent[0].send({ type: 'start', usage: usage(4) })
    sent[0].send({ type: 'partial', result: { answer: '외식 날은 범위' } })
    await settle()
    expect(texts()).toHaveLength(2)

    breakIt(sent[0])
    await settle()
    // 마지막이 다시 내 질문이다. 화면은 그 아래에 실패 안내와 '다시 시도'를 보여 준다.
    expect(texts()).toEqual(['user:외식이 있어요'])
    expect(coach().pending).toBe(false)
    expect(coach().error?.code).toBe(code)
    // 횟수는 이미 썼다. 도중에 끊겨도 남은 횟수는 맞게 고쳐진다.
    expect(useAi.getState().usage).toEqual(usage(4))

    // 다시 시도하면 질문을 또 넣지 않고, 쓰이다 만 답은 이전 대화에 없다.
    coach().retry(ctx)
    await settle()
    expect(sent[1].body).toMatchObject({ question: '외식이 있어요', history: [] })
    sent[1].send({ type: 'partial', result: { answer: '외식 날은' } })
    sent[1].send({ type: 'done', ok: true, result: { answer: '외식 날은 괜찮아요.' }, usage: usage(5) })
    await settle()
    expect(texts()).toEqual(['user:외식이 있어요', 'assistant:외식 날은 괜찮아요.'])
    expect(coach().error).toBeNull()
  })

  it('글이 오던 중이라도 55초가 지나면 그만두고 busy로 알린다. 늦게 온 글은 넣지 않는다', async () => {
    const sent = fakeServer()
    coach().send(ctx, '외식이 있어요')
    await settle()
    sent[0].send({ type: 'start', usage: usage(2) })
    sent[0].send({ type: 'partial', result: { answer: '외식 날은' } })
    await settle()
    expect(texts()).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(AI_TIMEOUT_MS - 1000)
    expect(coach().pending).toBe(true)
    expect(sent[0].signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    await settle()
    expect(sent[0].signal.aborted).toBe(true)
    expect(coach().pending).toBe(false)
    expect(coach().error?.code).toBe('busy')
    expect(texts()).toEqual(['user:외식이 있어요'])
  })

  it('받는 도중에 계정이 바뀌면 대화를 비우고, 앞 계정의 글과 사용량을 새 계정에 넣지 않는다', async () => {
    const sent = fakeServer()
    coach().send(ctx, '외식이 있어요')
    await settle()
    sent[0].send({ type: 'start', usage: usage(7) })
    sent[0].send({ type: 'partial', result: { answer: '외식 날은' } })
    await settle()
    expect(texts()).toHaveLength(2)

    useSync.setState({ email: 'other@b.c' })
    expect(coach().messages).toEqual([])
    expect(coach().pending).toBe(false)

    sent[0].send({ type: 'partial', result: { answer: '외식 날은 범위 위쪽까지' } })
    await settle()
    expect(coach().messages).toEqual([])
    sent[0].send({ type: 'done', ok: true, result: { answer: '외식 날은 범위 위쪽까지 써도 괜찮아요.' }, usage: usage(7) })
    await settle()
    expect(coach().messages).toEqual([])
    expect(coach().pending).toBe(false)
    expect(coach().error).toBeNull()
    expect(useAi.getState().usage).toBeNull()

    // 새 계정의 질문은 따로 간다. 앞 계정의 늦은 글이 여기에 섞이지 않는다.
    coach().send(ctx, '새 계정의 질문')
    await settle()
    sent[1].send({ type: 'partial', result: { answer: '네' } })
    await settle()
    expect(texts()).toEqual(['user:새 계정의 질문', 'assistant:네'])
  })

  it('로그아웃해도 마찬가지로 비운다', async () => {
    const sent = fakeServer()
    coach().send(ctx, '외식이 있어요')
    await settle()
    sent[0].send({ type: 'partial', result: { answer: '외식 날은' } })
    await settle()
    useSync.setState({ email: null })
    sent[0].send({ type: 'error', ok: false, error: 'busy', usage: usage(7) })
    await settle()
    expect(coach().messages).toEqual([])
    expect(coach().error).toBeNull()
    expect(useAi.getState().usage).toBeNull()
  })

  it('서버가 조금씩 보내 주지 않으면(예전 서버) 한 덩어리로 받아 예전처럼 넣는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, result: { answer: '네.' }, usage: usage(1) })))
    coach().send(ctx, '질문')
    await settle()
    expect(texts()).toEqual(['user:질문', 'assistant:네.'])
    expect(coach().pending).toBe(false)
  })
})

describe('주간 돌아보기: 쓰이는 대로 partial에 채워진다', () => {
  const date = '2026-11-19'
  const review: WeekReview = { headline: '주 평균이 범위 안이었어요.', wins: ['6일을 기록했어요.'], observations: ['토요일에 높았어요.'], nextStep: '아침을 기록해 보세요.' }
  const state = () => useWeekReview.getState()

  it('headline부터 차례로 채워지고, 끝나면 review가 되고 partial은 비운다', async () => {
    const sent = fakeServer()
    void requestWeekReview(date, ctx, '2주 쉬어 가기')
    await settle()
    expect(sent[0].body).toMatchObject({ task: 'week-review', recommendation: '2주 쉬어 가기' })
    expect(sent[0].headers.Accept).toContain(AI_STREAM_MIME)
    expect(state()).toMatchObject({ pending: true, review: null, partial: null })

    sent[0].send({ type: 'start', usage: usage(2) })
    sent[0].send({ type: 'partial', result: { headline: '주 평균이' } })
    await settle()
    expect(state()).toMatchObject({ pending: true, review: null, partial: { headline: '주 평균이' } })

    sent[0].send({ type: 'partial', result: { headline: review.headline, wins: ['6일을'] } })
    await settle()
    expect(state().partial).toEqual({ headline: review.headline, wins: ['6일을'] })

    sent[0].send({ type: 'done', ok: true, result: review, usage: usage(2) })
    await settle()
    expect(state()).toMatchObject({ key: `a@b.c|${date}`, review, partial: null, pending: false, error: null })
    expect(useAi.getState().usage).toEqual(usage(2))
    // 기기에는 완성된 것만 적는다.
    expect(JSON.parse(localStorage.getItem('trend-diet:week-review') ?? 'null')).toEqual({ key: `a@b.c|${date}`, review })
  })

  it('도중에 실패하면 partial을 비우고 실패를 남긴다. 기기에는 아무것도 적지 않는다', async () => {
    const sent = fakeServer()
    void requestWeekReview(date, ctx)
    await settle()
    sent[0].send({ type: 'partial', result: { headline: '주 평균이' } })
    await settle()
    expect(state().partial).toEqual({ headline: '주 평균이' })
    sent[0].end()
    await settle()
    expect(state()).toMatchObject({ review: null, partial: null, pending: false })
    expect(state().error?.code).toBe('busy')
    expect(localStorage.getItem('trend-diet:week-review')).toBeNull()
  })

  it('55초가 지나면 그만두고, 계정이 바뀌면 앞 계정의 글을 보여 주지 않는다', async () => {
    const sent = fakeServer()
    void requestWeekReview(date, ctx)
    await settle()
    sent[0].send({ type: 'partial', result: { headline: '주 평균이' } })
    await settle()
    await vi.advanceTimersByTimeAsync(AI_TIMEOUT_MS)
    await settle()
    expect(sent[0].signal.aborted).toBe(true)
    expect(state()).toMatchObject({ partial: null, pending: false })
    expect(state().error?.code).toBe('busy')

    void requestWeekReview(date, ctx)
    await settle()
    sent[1].send({ type: 'partial', result: { headline: '주 평균이' } })
    await settle()
    useSync.setState({ email: 'other@b.c' })
    expect(state()).toMatchObject({ key: null, review: null, partial: null, pending: false })
    sent[1].send({ type: 'partial', result: { headline: '주 평균이 범위 안' } })
    sent[1].send({ type: 'done', ok: true, result: review, usage: usage(3) })
    await settle()
    expect(state()).toMatchObject({ key: null, review: null, partial: null, pending: false, error: null })
    expect(localStorage.getItem('trend-diet:week-review')).toBeNull()
  })
})
