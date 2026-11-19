// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { sampleResults } from './fixtures.ts'
import { parsePartialJson, partialResult } from './partial.ts'

describe('parsePartialJson', () => {
  it('다 쓰인 JSON은 JSON.parse와 같다', () => {
    for (const v of [{ a: 1, b: [true, null, 'x', -2.5e3], c: { d: '가"나\\다\n' } }, [], {}, 'str', sampleResults['meal-text']]) {
      expect(parsePartialJson(JSON.stringify(v))).toEqual(v)
      expect(parsePartialJson(JSON.stringify(v, null, 2))).toEqual(v)
    }
  })

  it('어디서 끊겨도 던지지 않고, 그때까지 읽은 것은 끝난 값의 앞부분이다', () => {
    const whole = JSON.stringify(sampleResults['week-review'])
    for (let n = 0; n <= whole.length; n++) {
      const got = parsePartialJson(whole.slice(0, n)) as Record<string, unknown> | undefined
      if (got === undefined) continue
      for (const [key, v] of Object.entries(got)) {
        const full = (sampleResults['week-review'] as Record<string, unknown>)[key]
        if (typeof v === 'string') expect((full as string).startsWith(v)).toBe(true)
        else expect((full as string[]).slice(0, (v as string[]).length - 1)).toEqual((v as string[]).slice(0, -1))
      }
    }
  })

  it('쓰이다 만 문자열은 쓰인 데까지, 값이 없는 키와 쓰이다 만 숫자는 뺀다', () => {
    expect(parsePartialJson('{"answer":"외식 날은')).toEqual({ answer: '외식 날은' })
    expect(parsePartialJson('{"answer"')).toEqual({})
    expect(parsePartialJson('{"answer":')).toEqual({})
    expect(parsePartialJson('{"ans')).toEqual({})
    expect(parsePartialJson('{"kcal":12')).toEqual({})
    expect(parsePartialJson('{"kcal":120,"ok":tr')).toEqual({ kcal: 120 })
    expect(parsePartialJson('{"items":[{"name":"밥","kcal":310},{"name":"김')).toEqual({ items: [{ name: '밥', kcal: 310 }, { name: '김' }] })
    expect(parsePartialJson('')).toBeUndefined()
    expect(parsePartialJson('   ')).toBeUndefined()
  })

  it('끊긴 이스케이프와 짝 없는 대리 문자는 보여 주지 않는다', () => {
    expect(parsePartialJson('{"a":"줄\\')).toEqual({ a: '줄' })
    expect(parsePartialJson('{"a":"줄\\n다음')).toEqual({ a: '줄\n다음' })
    expect(parsePartialJson('{"a":"x\\u00')).toEqual({ a: 'x' })
    expect(parsePartialJson('{"a":"x\\ud83d')).toEqual({ a: 'x' })
    expect(parsePartialJson('{"a":"x\\ud83d\\ude00')).toEqual({ a: 'x😀' })
    expect(parsePartialJson(`{"a":"x${'😀'.slice(0, 1)}`)).toEqual({ a: 'x' })
  })

  it('JSON이 아닌 글은 읽은 데까지만 남긴다', () => {
    expect(parsePartialJson('안녕하세요')).toBeUndefined()
    expect(parsePartialJson('{"a":"x", oops')).toEqual({ a: 'x' })
    expect(parsePartialJson('{"a":"x\\q')).toEqual({ a: 'x' })
    expect(parsePartialJson('{"__proto__":{"x":1},"a":1}')).toEqual({ a: 1 })
  })
})

describe('partialResult', () => {
  it('ask: 답의 글자가 나오기 전에는 null이다', () => {
    expect(partialResult('ask', '')).toBeNull()
    expect(partialResult('ask', '{"answer":"')).toBeNull()
    expect(partialResult('ask', '{"answer":" ')).toBeNull()
    expect(partialResult('ask', '{"answer":"네, ')).toEqual({ answer: '네, ' })
    expect(partialResult('ask', '{"answer":3')).toBeNull()
    expect(partialResult('ask', '["answer"]')).toBeNull()
  })

  it('week-review: 쓰인 필드만, 글과 글 목록으로만 돌려준다', () => {
    expect(partialResult('week-review', '{"headline":"주 평균이')).toEqual({ headline: '주 평균이' })
    expect(partialResult('week-review', '{"headline":"주 평균이 범위 안","wins":["6일을 기록했어요.","')).toEqual({
      headline: '주 평균이 범위 안',
      wins: ['6일을 기록했어요.'],
    })
    expect(partialResult('week-review', '{"headline":"요약","wins":[1,"잘된 점"],"observations":"글","extra":"x"}')).toEqual({ headline: '요약', wins: ['잘된 점'] })
    expect(partialResult('week-review', '{"wins":[')).toBeNull()
  })
})
