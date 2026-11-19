/**
 * 쓰이는 중인 구조화 응답(JSON 글)을 읽을 수 있는 데까지 읽어, 화면에 미리 보여 줄 모양으로 만든다.
 * 모델은 JSON을 앞에서부터 한 조각씩 쓰므로 중간에는 언제나 덜 닫힌 JSON이다.
 */
import type { AiPartialMap, AiStreamTask } from '../../src/ai/contract.ts'

const DROP = Symbol('drop')
const WS = ' \n\r\t'
const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff

/**
 * 덜 끝난 JSON을 너그럽게 읽는다. 쓰이다 만 문자열은 쓰인 데까지, 객체와 배열은 들어온 항목까지 돌려준다.
 * 쓰이다 만 숫자와 true/false/null, 값이 아직 없는 키는 뺀다(120의 12를 값으로 보여 주지 않으려고).
 * 읽을 것이 없거나 JSON이 아니면 undefined.
 */
export function parsePartialJson(src: string): unknown {
  let i = 0
  const end = (): boolean => i >= src.length
  const skip = (): void => {
    while (!end() && WS.includes(src[i])) i++
  }
  /** 더 읽지 않는다. 형식이 어긋났을 때 지금까지 읽은 것만 남긴다. */
  const stop = (): typeof DROP => {
    i = src.length
    return DROP
  }

  function string(): { text: string; closed: boolean } {
    i++ // 여는 따옴표
    let text = ''
    while (!end()) {
      const c = src[i]
      if (c === '"') {
        i++
        return { text, closed: true }
      }
      if (c !== '\\') {
        text += c
        i++
        continue
      }
      const e = src[i + 1]
      if (e === undefined) break
      if (e === 'u') {
        const hex = src.slice(i + 2, i + 6)
        if (hex.length < 4) break
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          stop()
          break
        }
        text += String.fromCharCode(Number.parseInt(hex, 16))
        i += 6
        continue
      }
      if (!(e in ESCAPES)) {
        stop()
        break
      }
      text += ESCAPES[e]
      i += 2
    }
    i = src.length
    // 짝을 아직 못 만난 앞쪽 대리 문자는 깨진 글자로 보이므로 뺀다.
    if (text && isHighSurrogate(text.charCodeAt(text.length - 1))) text = text.slice(0, -1)
    return { text, closed: false }
  }

  function array(): unknown[] {
    i++
    const out: unknown[] = []
    for (;;) {
      skip()
      if (end()) return out
      if (src[i] === ']') {
        i++
        return out
      }
      if (src[i] === ',') {
        i++
        continue
      }
      const v = value()
      if (v === DROP) return out
      out.push(v)
    }
  }

  function object(): Record<string, unknown> {
    i++
    const out: Record<string, unknown> = {}
    for (;;) {
      skip()
      if (end()) return out
      if (src[i] === '}') {
        i++
        return out
      }
      if (src[i] === ',') {
        i++
        continue
      }
      if (src[i] !== '"') {
        stop()
        return out
      }
      const key = string()
      if (!key.closed) return out
      skip()
      if (end()) return out
      if (src[i] !== ':') {
        stop()
        return out
      }
      i++
      const v = value()
      if (v === DROP) return out
      if (key.text !== '__proto__') out[key.text] = v
    }
  }

  function value(): unknown {
    skip()
    if (end()) return DROP
    const c = src[i]
    if (c === '{') return object()
    if (c === '[') return array()
    if (c === '"') return string().text
    const m = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(src.slice(i, i + 40))
    // 뒤에 구분하는 글자가 와야 다 쓰인 값이다.
    if (!m || i + m[0].length >= src.length) return stop()
    i += m[0].length
    return JSON.parse(m[0]) as unknown
  }

  const v = value()
  return v === DROP ? undefined : v
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)
const texts = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v)) return undefined
  const out = v.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
  return out.length > 0 ? out : undefined
}

/** 지금까지 쓰인 글에서 화면에 미리 보여 줄 부분을 꺼낸다. 아직 보여 줄 것이 없으면 null. */
export function partialResult<T extends AiStreamTask>(task: T, soFar: string): AiPartialMap[T] | null
export function partialResult(task: AiStreamTask, soFar: string): AiPartialMap[AiStreamTask] | null {
  const parsed = parsePartialJson(soFar)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const o = parsed as Record<string, unknown>
  if (task === 'ask') {
    const answer = text(o.answer)
    return answer ? { answer } : null
  }
  const out: AiPartialMap['week-review'] = {}
  const headline = text(o.headline)
  const wins = texts(o.wins)
  const observations = texts(o.observations)
  const nextStep = text(o.nextStep)
  if (headline) out.headline = headline
  if (wins) out.wins = wins
  if (observations) out.observations = observations
  if (nextStep) out.nextStep = nextStep
  return Object.keys(out).length > 0 ? out : null
}
