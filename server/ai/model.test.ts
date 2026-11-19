// @vitest-environment node
import Anthropic from '@anthropic-ai/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TASKS, sampleRequests, sampleResults } from './fixtures.ts'
import {
  EFFORT,
  FALLBACK_BETA,
  MODEL,
  MODEL_RULES,
  TASK_DEFAULTS,
  buildParams,
  buildStreamParams,
  createCallModel,
  envSuffix,
  mapSdkError,
  taskConfig,
  tidyResult,
  type ModelId,
  type ParseFn,
  type ParsedLike,
  type StreamEventLike,
  type StreamFn,
  type StreamedLike,
} from './model.ts'
import type { ModelTask } from './prompts.ts'

const usage = { input_tokens: 1200, output_tokens: 340 }
const reply = (over: Partial<ParsedLike>): ParsedLike => ({ stop_reason: 'end_turn', parsed_output: null, model: MODEL, usage, ...over })

let logs: string[] = []
beforeEach(() => {
  logs = []
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  })
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildParams', () => {
  it.each(TASKS)('%s: 모델, effort, 구조화 출력, fallback을 계약대로 보낸다', (task) => {
    const p = buildParams(sampleRequests[task]) as unknown as Record<string, unknown>
    expect(p.model).toBe('claude-opus-5-5')
    expect(p.max_tokens).toBe(TASK_DEFAULTS[task].maxTokens)
    expect(p.betas).toEqual([FALLBACK_BETA])
    expect(p.fallbacks).toBe('default')
    const oc = p.output_config as { effort: string; format: { type: string; schema: unknown } }
    expect(oc.effort).toBe(EFFORT[task])
    expect(oc.format.type).toBe('json_schema')
    expect(oc.format.schema).toBeTruthy()
    // 시스템 프롬프트는 글 그대로 보내거나(캐시 안 함), 캐시 표시를 붙인 글 블록 하나로 보낸다.
    if (TASK_DEFAULTS[task].cacheSystem) {
      expect(p.system).toEqual([{ type: 'text', text: expect.any(String), cache_control: { type: 'ephemeral' } }])
    } else {
      expect(typeof p.system).toBe('string')
    }
    expect(Array.isArray(p.messages)).toBe(true)
  })

  it('이 모델이 거절하는 파라미터는 보내지 않는다', () => {
    for (const task of TASKS) {
      const p = buildParams(sampleRequests[task]) as unknown as Record<string, unknown>
      for (const key of ['thinking', 'temperature', 'top_p', 'top_k', 'tool_choice', 'tools', 'stream']) {
        expect(p).not.toHaveProperty(key)
      }
      expect(JSON.stringify(p)).not.toContain('budget_tokens')
      const messages = p.messages as { role: string }[]
      expect(messages[messages.length - 1].role).toBe('user')
    }
  })

  it('effort는 모든 task에서 low다(프로덕션 비교에서 질이 같고 훨씬 빨랐다)', () => {
    expect(EFFORT).toEqual({ 'meal-text': 'low', 'meal-photo': 'low', suggest: 'low', 'week-review': 'low', ask: 'low', nudge: 'low' })
  })

  it('상한(max_tokens)은 task마다 다르고, 프로덕션에서 잰 출력(최대 880토큰)의 몇 배다', () => {
    for (const c of Object.values(TASK_DEFAULTS)) {
      expect(c.maxTokens).toBeGreaterThanOrEqual(4000)
      expect(c.maxTokens).toBeLessThanOrEqual(8000)
    }
  })

  it('시스템 프롬프트 캐시는 이어서 묻는 코치 질문에만 쓴다', () => {
    const cached = (Object.keys(TASK_DEFAULTS) as ModelTask[]).filter((t) => TASK_DEFAULTS[t].cacheSystem)
    expect(cached).toEqual(['ask'])
  })
})

describe('task별 설정', () => {
  it('기본값은 모든 task가 지금의 모델이고, 생각하기는 켜 둔다', () => {
    for (const task of Object.keys(TASK_DEFAULTS) as ModelTask[]) {
      expect(taskConfig(task, {})).toEqual(TASK_DEFAULTS[task])
      expect(TASK_DEFAULTS[task].model).toBe(MODEL)
      expect(TASK_DEFAULTS[task].thinking).toBe('on')
    }
  })

  it('환경변수 이름은 AI_MODEL_<TASK>처럼 대문자와 밑줄로 쓴다', () => {
    expect((Object.keys(TASK_DEFAULTS) as ModelTask[]).map(envSuffix)).toEqual(['MEAL_TEXT', 'MEAL_PHOTO', 'SUGGEST', 'WEEK_REVIEW', 'ASK', 'NUDGE'])
  })

  it('환경변수로 task 하나의 모델, effort, 생각하기를 바꾼다. 다른 task는 그대로다', () => {
    const env = { AI_MODEL_MEAL_TEXT: ' claude-haiku-5-5 ', AI_EFFORT_MEAL_TEXT: 'MEDIUM', AI_THINKING_MEAL_TEXT: 'off', AI_EFFORT_ASK: 'low' }
    expect(taskConfig('meal-text', env)).toEqual({ ...TASK_DEFAULTS['meal-text'], model: 'claude-haiku-5-5', effort: 'medium', thinking: 'off' })
    expect(taskConfig('ask', env)).toEqual({ ...TASK_DEFAULTS.ask, effort: 'low' })
    expect(taskConfig('meal-photo', env)).toEqual(TASK_DEFAULTS['meal-photo'])
  })

  it('모르는 모델 이름과 값은 무시하고 기본값을 쓴다', () => {
    const env = { AI_MODEL_SUGGEST: 'claude-haiku-9', AI_EFFORT_SUGGEST: 'max', AI_THINKING_SUGGEST: 'maybe' }
    expect(taskConfig('suggest', env)).toEqual(TASK_DEFAULTS.suggest)
  })

  it('모델마다 받는 파라미터만 보낸다', () => {
    const req = sampleRequests['meal-text']
    const params = (model: ModelId, thinking: 'on' | 'off') =>
      buildParams(req, { ...TASK_DEFAULTS['meal-text'], model, thinking }) as unknown as Record<string, unknown>

    // Opus 5.5: 생각하기를 끌 수 없다. off라고 해도 thinking을 보내지 않는다.
    expect(params('claude-opus-5-5', 'off')).not.toHaveProperty('thinking')
    expect(params('claude-opus-5-5', 'off').fallbacks).toBe('default')
    // Sonnet 5.5: disabled는 400이다. 끄려면 between_tools를 보낸다.
    expect(params('claude-sonnet-5-5', 'off').thinking).toEqual({ type: 'between_tools' })
    expect(params('claude-sonnet-5-5', 'on')).not.toHaveProperty('thinking')
    expect(params('claude-sonnet-5-5', 'on').betas).toEqual([FALLBACK_BETA])
    // Haiku 5.5: disabled를 받는다. 서버 쪽 fallback이 없어 그 파라미터와 베타 헤더를 보내지 않는다.
    expect(params('claude-haiku-5-5', 'off').thinking).toEqual({ type: 'disabled' })
    expect(params('claude-haiku-5-5', 'on')).not.toHaveProperty('thinking')
    expect(params('claude-haiku-5-5', 'on')).not.toHaveProperty('fallbacks')
    expect(params('claude-haiku-5-5', 'on')).not.toHaveProperty('betas')
    expect(Object.keys(MODEL_RULES)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'])
  })

  it('사람이 기다리는 task는 fast mode를 쓰고, 배경 작업(nudge)은 쓰지 않는다. 켜도 받는 모델에만 보낸다', () => {
    const req = sampleRequests.ask
    for (const task of ['meal-text', 'meal-photo', 'suggest', 'week-review', 'ask'] as ModelTask[]) expect(TASK_DEFAULTS[task].speed).toBe('fast')
    expect(TASK_DEFAULTS.nudge.speed).toBe('standard')
    expect((buildParams(req) as unknown as Record<string, unknown>).speed).toBe('fast')
    expect(taskConfig('ask', { AI_SPEED_ASK: 'standard' }).speed).toBe('standard')
    expect(taskConfig('ask', { AI_SPEED_ASK: 'turbo' }).speed).toBe('fast')
    expect(buildParams(req, { ...TASK_DEFAULTS.ask, speed: 'standard' })).not.toHaveProperty('speed')
    const fast = (model: ModelId) => buildParams(req, { ...TASK_DEFAULTS.ask, model, speed: 'fast' }) as unknown as Record<string, unknown>
    expect(fast('claude-opus-5-5').speed).toBe('fast')
    expect(fast('claude-sonnet-5-5')).not.toHaveProperty('speed')
    expect(fast('claude-haiku-5-5')).not.toHaveProperty('speed')
  })

  it('callModel은 환경변수로 바꾼 모델로 부르고 로그에 남긴다', async () => {
    const parse = vi.fn<ParseFn>(async () => reply({ parsed_output: sampleResults.suggest, model: 'claude-haiku-5-5' }))
    const call = createCallModel(parse, undefined, { AI_MODEL_SUGGEST: 'claude-haiku-5-5' })
    expect(await call({ request: sampleRequests.suggest, userId: 'u' })).toEqual({ ok: true, result: sampleResults.suggest })
    expect((parse.mock.calls[0][0] as { model: string }).model).toBe('claude-haiku-5-5')
    expect(JSON.parse(logs[0])).toMatchObject({ task: 'suggest', model: 'claude-haiku-5-5', effort: 'low', streamed: false })
  })
})

// ── 조금씩 받기 ────────────────────────────────────────────────

const textEvent = (text: string): StreamEventLike => ({ type: 'content_block_delta', delta: { type: 'text_delta', text } })

/** 글을 조각으로 흘려보내는 가짜 스트림. 조각 사이에 한 박자씩 쉰다. */
function fakeStream(pieces: (string | Error)[], final: Partial<StreamedLike> = {}, seen?: { signal?: AbortSignal; params?: unknown }): StreamFn {
  return (params, { signal }) => {
    if (seen) Object.assign(seen, { signal, params })
    let text = ''
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: 'message_start' }
        yield { type: 'content_block_start' }
        for (const piece of pieces) {
          await new Promise((r) => setTimeout(r, 1))
          if (piece instanceof Error) throw piece
          text += piece
          yield textEvent(piece)
        }
        yield { type: 'message_delta', delta: { stop_reason: 'end_turn' } }
      },
      finalMessage: async () => ({ stop_reason: 'end_turn', model: MODEL, usage, content: [{ type: 'text', text }], ...final }),
    }
  }
}
const neverParse: ParseFn = async () => {
  throw new Error('parse를 부르면 안 된다')
}

describe('createCallModel: 조금씩 받기', () => {
  it('ask: 답이 쓰이는 대로 알리고, 끝나면 한 덩어리로 받았을 때와 같은 결과를 돌려준다', async () => {
    const seen: { params?: unknown } = {}
    const partials: unknown[] = []
    const call = createCallModel(neverParse, fakeStream(['{"ans', 'wer":"외식 날은 ', '범위 위쪽까지 ', '써도 괜찮아요."', '}'], {}, seen))
    const out = await call({ request: sampleRequests.ask, userId: 'u', onPartial: (p) => partials.push(p) })
    expect(out).toEqual({ ok: true, result: { answer: '외식 날은 범위 위쪽까지 써도 괜찮아요.' } })
    expect(partials).toEqual([{ answer: '외식 날은 ' }, { answer: '외식 날은 범위 위쪽까지 ' }, { answer: '외식 날은 범위 위쪽까지 써도 괜찮아요.' }])
    // 모델이 읽는 요청은 한 덩어리로 받을 때와 같다. 형식에서 SDK의 parse만 뺀다.
    const sent = seen.params as { output_config: { format: Record<string, unknown> } }
    const whole = buildParams(sampleRequests.ask) as unknown as { output_config: { format: { schema: unknown } } }
    expect(sent.output_config.format).toEqual({ type: 'json_schema', schema: whole.output_config.format.schema })
    expect({ ...sent, output_config: null }).toEqual({ ...buildStreamParams(sampleRequests.ask), output_config: null })
    expect(JSON.stringify({ ...sent, output_config: null })).toBe(JSON.stringify({ ...whole, output_config: null }))
    const log = JSON.parse(logs[0]) as Record<string, unknown>
    expect(log).toMatchObject({ task: 'ask', streamed: true, result: 'ok', in: 1200, out: 340 })
    expect(typeof log.firstEventMs).toBe('number')
    expect(typeof log.firstTextMs).toBe('number')
  })

  it('week-review: headline부터 차례로 채워진다', async () => {
    const whole = JSON.stringify(sampleResults['week-review'])
    const pieces = whole.match(/[\s\S]{1,9}/g) ?? []
    const partials: { headline?: string; wins?: string[]; nextStep?: string }[] = []
    const call = createCallModel(neverParse, fakeStream(pieces))
    const out = await call({ request: sampleRequests['week-review'], userId: 'u', onPartial: (p) => partials.push(p as (typeof partials)[number]) })
    expect(out).toEqual({ ok: true, result: sampleResults['week-review'] })
    expect(partials.length).toBeGreaterThan(5)
    expect(Object.keys(partials[0])).toEqual(['headline'])
    expect(sampleResults['week-review'].headline.startsWith(partials[0].headline ?? 'x')).toBe(true)
    expect(partials[partials.length - 1]).toEqual(sampleResults['week-review'])
    // 같은 내용을 두 번 알리지 않는다.
    const keys = partials.map((p) => JSON.stringify(p))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('onPartial이 없거나 조금씩 받을 수 없는 task면 한 덩어리로 받는다', async () => {
    const stream = vi.fn<StreamFn>(fakeStream(['{}']))
    // ask와 suggest는 effort가 같아서 상한(max_tokens)으로 어느 요청인지 가른다.
    const parse = vi.fn<ParseFn>(async ({ max_tokens }) =>
      reply({ parsed_output: max_tokens === TASK_DEFAULTS.suggest.maxTokens ? sampleResults.suggest : sampleResults.ask }),
    )
    const call = createCallModel(parse, stream)
    expect((await call({ request: sampleRequests.ask, userId: 'u' })).ok).toBe(true)
    expect((await call({ request: sampleRequests.suggest, userId: 'u', onPartial: () => {} })).ok).toBe(true)
    expect(stream).not.toHaveBeenCalled()
    expect(parse).toHaveBeenCalledTimes(2)
    // stream 함수 없이 만든 callModel도 onPartial을 받으면 한 덩어리로 받는다.
    expect((await createCallModel(parse)({ request: sampleRequests.ask, userId: 'u', onPartial: () => {} })).ok).toBe(true)
  })

  it('도중에 끊기면 계약의 사유로 돌려준다. 그 전에 알린 것은 부른 쪽이 버린다', async () => {
    const partials: unknown[] = []
    const call = createCallModel(neverParse, fakeStream(['{"answer":"외식 날은 ', new Anthropic.APIConnectionError({ message: 'reset' })]))
    const out = await call({ request: sampleRequests.ask, userId: 'u', onPartial: (p) => partials.push(p) })
    expect(out).toEqual({ ok: false, error: 'busy' })
    expect(partials).toEqual([{ answer: '외식 날은 ' }])
    expect(JSON.parse(logs[0])).toMatchObject({ streamed: true, result: 'busy', errorClass: 'APIConnectionError' })
  })

  it('도중에 거절되면 쓰이던 글이 있어도 refused다', async () => {
    const call = createCallModel(neverParse, fakeStream(['{"answer":"외식'], { stop_reason: 'refusal' }))
    expect(await call({ request: sampleRequests.ask, userId: 'u', onPartial: () => {} })).toEqual({ ok: false, error: 'refused' })
  })

  it('max_tokens로 끊기거나 끝난 글이 형식에 맞지 않으면 failed다', async () => {
    const cut = createCallModel(neverParse, fakeStream(['{"answer":"외식 날은'], { stop_reason: 'max_tokens' }))
    expect(await cut({ request: sampleRequests.ask, userId: 'u', onPartial: () => {} })).toEqual({ ok: false, error: 'failed' })
    const broken = createCallModel(neverParse, fakeStream(['{"answer":"외식 날은']))
    expect(await broken({ request: sampleRequests.ask, userId: 'u', onPartial: () => {} })).toEqual({ ok: false, error: 'failed' })
    const blank = createCallModel(neverParse, fakeStream(['{"answer":"  "}']))
    expect(await blank({ request: sampleRequests.ask, userId: 'u', onPartial: () => {} })).toEqual({ ok: false, error: 'failed' })
  })

  it('서버가 도중에 다른 모델로 넘겨 글이 두 블록으로 오면 이어 붙여 읽는다', async () => {
    const stream = fakeStream(['{"answer":"외식 날은 ', '괜찮아요."}'], {
      model: 'claude-sonnet-5-5',
      content: [{ type: 'text', text: '{"answer":"외식 날은 ' }, { type: 'fallback' }, { type: 'text', text: '괜찮아요."}' }],
    })
    const out = await createCallModel(neverParse, stream)({ request: sampleRequests.ask, userId: 'u', onPartial: () => {} })
    expect(out).toEqual({ ok: true, result: { answer: '외식 날은 괜찮아요.' } })
    expect(JSON.parse(logs[0])).toMatchObject({ model: MODEL, servedBy: 'claude-sonnet-5-5' })
  })

  it('기다리던 쪽이 떠나면(signal) 호출을 그만둔다', async () => {
    const gone = new AbortController()
    const seen: { signal?: AbortSignal } = {}
    const stream: StreamFn = (_params, { signal }) => {
      seen.signal = signal
      return {
        async *[Symbol.asyncIterator]() {
          yield textEvent('{"answer":"외식')
          // 실제 SDK처럼, 신호가 오면 기다리던 읽기가 APIUserAbortError로 끝난다.
          await new Promise<void>((_, reject) => {
            const stop = () => reject(new Anthropic.APIUserAbortError())
            if (signal.aborted) stop()
            else signal.addEventListener('abort', stop)
          })
        },
        finalMessage: async () => ({ stop_reason: 'end_turn', content: [] }),
      }
    }
    const pending = createCallModel(neverParse, stream)({ request: sampleRequests.ask, userId: 'u', signal: gone.signal, onPartial: () => gone.abort() })
    expect(await pending).toEqual({ ok: false, error: 'busy' })
    expect(seen.signal?.aborted).toBe(true)
  })

  it('조금씩 받을 때도 로그에 사용자의 글과 답을 남기지 않는다', async () => {
    const secret = '비밀스러운질문'
    const call = createCallModel(neverParse, fakeStream(['{"answer":"비밀스러운답"}']))
    await call({ request: { ...sampleRequests.ask, question: secret }, userId: 'user-42', onPartial: () => {} })
    expect(logs.join('\n')).not.toContain(secret)
    expect(logs.join('\n')).not.toContain('비밀스러운답')
  })
})

describe('createCallModel', () => {
  it.each(TASKS)('%s: parsed_output을 결과로 돌려준다', async (task) => {
    const parse = vi.fn<ParseFn>(async () => reply({ parsed_output: sampleResults[task] }))
    const out = await createCallModel(parse)({ request: sampleRequests[task], userId: 'user-1' })
    expect(out).toEqual({ ok: true, result: sampleResults[task] })
    expect(parse).toHaveBeenCalledTimes(1)
    expect(parse.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('refusal이면 내용이 있어도 refused다', async () => {
    const parse: ParseFn = async () => reply({ stop_reason: 'refusal', parsed_output: sampleResults.ask })
    expect(await createCallModel(parse)({ request: sampleRequests.ask, userId: 'u' })).toEqual({ ok: false, error: 'refused' })
  })

  it('max_tokens로 끊기면 failed다', async () => {
    const parse: ParseFn = async () => reply({ stop_reason: 'max_tokens', parsed_output: sampleResults.ask })
    expect(await createCallModel(parse)({ request: sampleRequests.ask, userId: 'u' })).toEqual({ ok: false, error: 'failed' })
  })

  it('parsed_output이 null이거나 스키마에 맞지 않으면 failed다', async () => {
    for (const parsed_output of [null, undefined, { answer: 3 }, { answer: '  ' }, 'text']) {
      const parse: ParseFn = async () => reply({ parsed_output })
      expect(await createCallModel(parse)({ request: sampleRequests.ask, userId: 'u' })).toEqual({ ok: false, error: 'failed' })
    }
  })

  it('SDK가 던지면 계약의 사유로 바꿔 돌려준다', async () => {
    const parse: ParseFn = async () => {
      throw new Anthropic.RateLimitError(429, undefined, 'slow down', new Headers())
    }
    expect(await createCallModel(parse)({ request: sampleRequests.suggest, userId: 'u' })).toEqual({ ok: false, error: 'busy' })
  })

  it('로그에 task, 사용자 id, 걸린 시간, 토큰, stop_reason을 남기고 사용자의 글과 사진은 남기지 않는다', async () => {
    const secret = '비밀스러운김치찌개'
    const image = 'QUJD'.repeat(60)
    const call = createCallModel(async () => reply({ parsed_output: sampleResults['meal-text'] }))
    await call({ request: { task: 'meal-text', text: secret }, userId: 'user-42' })
    await call({ request: { task: 'meal-photo', imageBase64: image, mediaType: 'image/png', note: secret }, userId: 'user-42' })
    await createCallModel(async () => {
      throw new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'bad param' } }, undefined, new Headers())
    })({ request: { task: 'meal-text', text: secret }, userId: 'user-42' })

    expect(logs).toHaveLength(3)
    const first = JSON.parse(logs[0]) as Record<string, unknown>
    expect(first).toMatchObject({ task: 'meal-text', user: 'user-42', stop: 'end_turn', in: 1200, out: 340, result: 'ok' })
    expect(typeof first.ms).toBe('number')
    expect(JSON.parse(logs[2])).toMatchObject({ result: 'failed', status: 400, errorClass: 'BadRequestError' })
    const all = logs.join('\n')
    expect(all).not.toContain(secret)
    expect(all).not.toContain(image)
  })
})

describe('mapSdkError', () => {
  const h = new Headers()
  it.each([
    ['RateLimitError', new Anthropic.RateLimitError(429, undefined, 'm', h), 'busy'],
    ['OverloadedError(529)', Anthropic.APIError.generate(529, { type: 'error', error: { type: 'overloaded_error', message: 'm' } }, 'm', h), 'busy'],
    ['InternalServerError(500)', new Anthropic.InternalServerError(500, undefined, 'm', h), 'busy'],
    ['503', Anthropic.APIError.generate(503, undefined, 'm', h), 'busy'],
    ['APIConnectionError', new Anthropic.APIConnectionError({ message: 'm' }), 'busy'],
    ['APIConnectionTimeoutError', new Anthropic.APIConnectionTimeoutError(), 'busy'],
    ['APIUserAbortError', new Anthropic.APIUserAbortError(), 'busy'],
    ['AbortSignal 시간 초과', new DOMException('timed out', 'TimeoutError'), 'busy'],
    ['AuthenticationError', new Anthropic.AuthenticationError(401, undefined, 'm', h), 'not_configured'],
    ['PermissionDeniedError', new Anthropic.PermissionDeniedError(403, undefined, 'm', h), 'not_configured'],
    ['BadRequestError', new Anthropic.BadRequestError(400, undefined, 'm', h), 'failed'],
    ['NotFoundError', new Anthropic.NotFoundError(404, undefined, 'm', h), 'failed'],
    ['스트림 안의 overloaded_error', new Anthropic.APIError(undefined, { type: 'error', error: { type: 'overloaded_error', message: 'm' } }, undefined, h), 'busy'],
    ['스트림 안의 api_error', new Anthropic.APIError(undefined, { type: 'error', error: { type: 'api_error', message: 'm' } }, undefined, h), 'busy'],
    ['스트림 안의 invalid_request_error', new Anthropic.APIError(undefined, { type: 'error', error: { type: 'invalid_request_error', message: 'm' } }, undefined, h), 'failed'],
    ['그 밖의 오류', new Error('x'), 'failed'],
    ['오류가 아닌 값', 'x', 'failed'],
  ] as const)('%s → %s', (_name, error, code) => {
    expect(mapSdkError(error)).toBe(code)
  })

  it('SDK가 상태 코드로 만든 오류도 같은 클래스로 잡힌다', () => {
    expect(Anthropic.APIError.generate(429, undefined, 'm', h)).toBeInstanceOf(Anthropic.RateLimitError)
    expect(mapSdkError(Anthropic.APIError.generate(401, undefined, 'm', h))).toBe('not_configured')
    expect(mapSdkError(Anthropic.APIError.generate(400, undefined, 'm', h))).toBe('failed')
  })
})

describe('tidyResult', () => {
  it('칼로리는 10 단위로, 이름은 40자 안으로 다듬는다', () => {
    const out = tidyResult('meal-text', {
      items: [{ name: ` ${'가'.repeat(60)}`, amount: '1인분', kcal: 254.6, confidence: 'low' }],
      note: '가정',
    })
    expect(out).toEqual({ items: [{ name: '가'.repeat(40), amount: '1인분', kcal: 250, confidence: 'low' }], note: '가정' })
    expect(tidyResult('suggest', { suggestions: [{ name: '국밥', kcal: -5, why: '이유' }], note: '' })).toEqual({
      suggestions: [{ name: '국밥', kcal: 0, why: '이유' }],
      note: '',
    })
  })

  it('다른 task의 모양이면 null이다', () => {
    expect(tidyResult('week-review', sampleResults.ask)).toBeNull()
    expect(tidyResult('meal-photo', sampleResults.suggest)).toBeNull()
  })
})

describe('실제 SDK 클라이언트로 조금씩 받기(네트워크는 가짜)', () => {
  const sse = (events: Record<string, unknown>[]): string => events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join('')
  const messageEvents = (pieces: string[], blocksBefore: Record<string, unknown>[] = []): Record<string, unknown>[] => [
    {
      type: 'message_start',
      message: { id: 'msg_1', type: 'message', role: 'assistant', model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2360, output_tokens: 1 } },
    },
    ...blocksBefore,
    { type: 'content_block_start', index: blocksBefore.length / 2, content_block: { type: 'text', text: '' } },
    ...pieces.map((text) => ({ type: 'content_block_delta', index: blocksBefore.length / 2, delta: { type: 'text_delta', text } })),
    { type: 'content_block_stop', index: blocksBefore.length / 2 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 880 } },
    { type: 'message_stop' },
  ]

  function clientWith(body: string) {
    const sent: { url: string; headers: Headers; body: Record<string, unknown> }[] = []
    const fetchFake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      sent.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> })
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_1' } })
    }
    const client = new Anthropic({ apiKey: 'sk-test', maxRetries: 0, fetch: fetchFake as typeof fetch })
    const call = createCallModel(
      (params, options) => client.beta.messages.parse(params, options),
      (params, options) => client.beta.messages.stream(params, options),
    )
    return { call, sent }
  }

  it('SDK의 stream()이 내는 사건에서 글을 모으고, 끝난 메시지에서 결과와 토큰 수를 읽는다', async () => {
    const { call, sent } = clientWith(sse(messageEvents(['{"answer":"외식 날은 ', '범위 위쪽까지 써도 ', '괜찮아요."}'])))
    const partials: unknown[] = []
    const out = await call({ request: sampleRequests.ask, userId: 'u', onPartial: (p) => partials.push(p) })
    expect(out).toEqual({ ok: true, result: { answer: '외식 날은 범위 위쪽까지 써도 괜찮아요.' } })
    expect(partials).toEqual([{ answer: '외식 날은 ' }, { answer: '외식 날은 범위 위쪽까지 써도 ' }, { answer: '외식 날은 범위 위쪽까지 써도 괜찮아요.' }])
    expect(JSON.parse(logs[0])).toMatchObject({ streamed: true, result: 'ok', stop: 'end_turn', in: 2360, out: 880, servedBy: MODEL })

    expect(sent).toHaveLength(1)
    expect(sent[0].url).toContain('/v1/messages')
    expect(sent[0].headers.get('anthropic-beta')).toContain(FALLBACK_BETA)
    const body = sent[0].body as { stream: boolean; model: string; max_tokens: number; fallbacks: string; output_config: { effort: string; format: Record<string, unknown> } }
    expect(body).toMatchObject({ stream: true, model: MODEL, max_tokens: TASK_DEFAULTS.ask.maxTokens, fallbacks: 'default' })
    expect(body).not.toHaveProperty('betas')
    expect(body).not.toHaveProperty('thinking')
    expect(body.output_config.effort).toBe(TASK_DEFAULTS.ask.effort)
    expect(Object.keys(body.output_config.format).sort()).toEqual(['schema', 'type'])
  })

  it('도중에 다른 모델로 넘어간 응답(fallback 블록)도 읽는다', async () => {
    const before = [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"answer":"외식 날은 ' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'fallback', from: { model: MODEL }, to: { model: 'claude-sonnet-5-5' }, trigger: { type: 'refusal', category: null } },
      },
      { type: 'content_block_stop', index: 1 },
    ]
    const events = messageEvents(['괜찮아요."}'])
    const tail = events.slice(1).map((e) => ('index' in e ? { ...e, index: 2 } : e))
    const { call } = clientWith(sse([events[0], ...before, ...tail]))
    const partials: unknown[] = []
    const out = await call({ request: sampleRequests.ask, userId: 'u', onPartial: (p) => partials.push(p) })
    expect(out).toEqual({ ok: true, result: { answer: '외식 날은 괜찮아요.' } })
    expect(partials[partials.length - 1]).toEqual({ answer: '외식 날은 괜찮아요.' })
    expect(JSON.parse(logs[0])).toMatchObject({ servedBy: 'claude-sonnet-5-5' })
  })

  it('스트림 안에서 오류 사건이 오면 계약의 사유로 바꾼다', async () => {
    const events = messageEvents(['{"answer":"외식'])
    const cut = [...events.slice(0, 3), { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]
    const { call } = clientWith(sse(cut))
    expect(await call({ request: sampleRequests.ask, userId: 'u', onPartial: () => {} })).toEqual({ ok: false, error: 'busy' })
  })
})
