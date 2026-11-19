// @vitest-environment node
import Anthropic from '@anthropic-ai/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TASKS, sampleRequests, sampleResults } from './fixtures.ts'
import {
  EFFORT,
  FALLBACK_BETA,
  MAX_TOKENS,
  MODEL,
  buildParams,
  createCallModel,
  mapSdkError,
  tidyResult,
  type ParseFn,
  type ParsedLike,
} from './model.ts'

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
    expect(p.max_tokens).toBe(MAX_TOKENS)
    expect(p.betas).toEqual([FALLBACK_BETA])
    expect(p.fallbacks).toBe('default')
    const oc = p.output_config as { effort: string; format: { type: string; schema: unknown } }
    expect(oc.effort).toBe(EFFORT[task])
    expect(oc.format.type).toBe('json_schema')
    expect(oc.format.schema).toBeTruthy()
    expect(typeof p.system).toBe('string')
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

  it('effort는 가벼운 일에 low, 돌아보기와 질문에 medium이다', () => {
    expect(EFFORT).toEqual({ 'meal-text': 'low', 'meal-photo': 'low', suggest: 'low', 'week-review': 'medium', ask: 'medium', nudge: 'low' })
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
