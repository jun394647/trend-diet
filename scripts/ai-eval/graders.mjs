// 규칙으로 보는 채점. 각 함수는 [{ name, ok, detail? }] 를 돌려준다. 점수는 통과한 규칙의 비율이다.
// 줄글의 말투와 내용은 규칙만으로 다 볼 수 없다. 여기서는 어기면 안 되는 것만 잡고, 나머지는 사람이 읽는다.

const HANGUL = /[가-힣]/
// 이모지, 느낌표, 화면에 그대로 보이면 안 되는 마크다운 기호.
const EMOJI = /\p{Extended_Pictographic}/u
const MARKDOWN = /(^|\n)\s*([#>*-]|\d+\.)\s|\*\*|__|`/
// 꾸짖거나 부추기는 말. 이 앱의 말투가 아니다.
const SCOLD_OR_HYPE = /반드시|절대|실패|의지가|의지력|게으|한심|화이팅|파이팅|대단해요|최고예요|완벽|할 수 있어요!?$/
// 해요체로 끝나는 문장. 인용이나 숫자로 끝나는 문장은 드물어서 대부분이 이 모양이어야 한다.
const POLITE_END = /(요|죠|니다|세요)[.?…~"')\]]*$/

const check = (name, ok, detail) => ({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail: String(detail) }) })
const sentences = (text) => text.split(/(?<=[.?!…])\s+|\n+/).map((s) => s.trim()).filter(Boolean)
const within = (n, [lo, hi]) => typeof n === 'number' && n >= lo && n <= hi

/** 사용자에게 보이는 한국어 글이 지켜야 하는 것. */
export function voice(text, label = '글') {
  const ss = sentences(text)
  const polite = ss.filter((s) => POLITE_END.test(s)).length
  return [
    check(`${label}: 한국어`, HANGUL.test(text)),
    check(`${label}: 이모지와 느낌표 없음`, !EMOJI.test(text) && !text.includes('!')),
    check(`${label}: 마크다운 기호 없음`, !MARKDOWN.test(text)),
    check(`${label}: 꾸짖거나 부추기는 말 없음`, !SCOLD_OR_HYPE.test(text), text.match(SCOLD_OR_HYPE)?.[0]),
    check(`${label}: 해요체`, ss.length > 0 && polite / ss.length >= 0.8, `${polite}/${ss.length}`),
  ]
}

export function gradeMeal(c, r) {
  const out = [check('형식', r && Array.isArray(r.items) && typeof r.note === 'string')]
  if (!out[0].ok) return out
  out.push(...voice(r.note, 'note').filter((x) => !x.name.endsWith('해요체') || r.note.length > 0))
  out.push(check('note가 비어 있지 않음', r.note.trim().length > 0))
  if (c.nonFood) {
    // 음식이 아닌데 음식을 지어내면 말투가 좋아도 쓸 수 없는 답이다. 이 규칙 하나로 0점이 된다.
    const empty = check('음식이 아니면 items가 비어 있음', r.items.length === 0, r.items.map((i) => i.name).join(', '))
    return empty.ok ? [...out, empty] : [empty]
  }
  out.push(check('항목이 있음', r.items.length > 0))
  out.push(check('항목 수', r.items.length >= c.items.length && r.items.length <= (c.maxItems ?? c.items.length + 2), r.items.length))
  for (const want of c.items) {
    const found = r.items.filter((i) => want.name.test(i.name))
    out.push(check(`찾음: ${want.name.source}`, found.length > 0))
    const kcal = found.reduce((s, i) => s + i.kcal, 0)
    out.push(check(`kcal 범위: ${want.name.source} ${want.kcal.join('~')}`, found.length > 0 && within(kcal, want.kcal), kcal))
  }
  const total = r.items.reduce((s, i) => s + (i.kcal ?? 0), 0)
  out.push(check(`합계 범위 ${c.total.join('~')}`, within(total, c.total), total))
  out.push(check('이름과 양이 한국어로 채워짐', r.items.every((i) => HANGUL.test(i.name) && i.name.length <= 40 && String(i.amount).trim().length > 0)))
  out.push(check('kcal이 10 단위', r.items.every((i) => Number.isFinite(i.kcal) && i.kcal % 10 === 0 && i.kcal >= 0)))
  if (c.vague) out.push(check('양을 가정했으면 모두 high는 아님', r.items.some((i) => i.confidence !== 'high'), r.items.map((i) => i.confidence).join(',')))
  return out
}

export function gradeSuggest(c, r) {
  const out = [check('형식', r && Array.isArray(r.suggestions) && typeof r.note === 'string')]
  if (!out[0].ok) return out
  const ctx = c.request.context
  const high = ctx.targetHigh - ctx.todayKcal
  out.push(...voice([r.note, ...r.suggestions.map((s) => s.why)].join('\n'), '글'))
  out.push(check('note가 비어 있지 않음', r.note.trim().length > 0))
  if (c.over) {
    out.push(check('범위를 넘었으면 가벼운 것만 권하거나 비움', r.suggestions.every((s) => s.kcal <= 300), r.suggestions.map((s) => s.kcal).join(',')))
    out.push(check('넘은 사실과 주 평균을 알림', /범위|넘/.test(r.note) && /평균/.test(r.note)))
    return out
  }
  out.push(check('제안 3개', r.suggestions.length === 3, r.suggestions.length))
  out.push(check('남은 범위 안(위쪽 +10%까지)', r.suggestions.every((s) => s.kcal > 0 && s.kcal <= high * 1.1), `${r.suggestions.map((s) => s.kcal).join(',')} / ${high}`))
  out.push(check('이름과 이유가 채워짐', r.suggestions.every((s) => HANGUL.test(s.name) && s.why.trim().length > 0)))
  out.push(check('서로 다른 제안', new Set(r.suggestions.map((s) => s.name)).size === r.suggestions.length))
  if (c.wish) out.push(check('바라는 것을 따름', r.suggestions.filter((s) => c.wish.test(s.name)).length >= 2, r.suggestions.map((s) => s.name).join(' | ')))
  if (c.avoid) out.push(check('빼 달라는 것을 뺌', r.suggestions.every((s) => !c.avoid.test(s.name)), r.suggestions.map((s) => s.name).join(' | ')))
  return out
}

function gradeProse(c, text, { minSentences, maxChars }) {
  const out = [check('글이 있음', typeof text === 'string' && text.trim().length > 0)]
  if (!out[0].ok) return out
  out.push(...voice(text))
  const n = sentences(text).length
  out.push(check(`길이(문장 ${minSentences}개 이상, ${maxChars}자 이하)`, n >= minSentences && text.length <= maxChars, `${n}문장 ${text.length}자`))
  for (const re of c.must ?? []) out.push(check(`있어야 함: ${re.source}`, re.test(text)))
  for (const re of c.mustNot ?? []) out.push(check(`없어야 함: ${re.source}`, !re.test(text), text.match(re)?.[0]))
  return out
}

export const gradeAsk = (c, r) => gradeProse(c, r?.answer, { minSentences: 2, maxChars: 700 })
export const gradeNudge = (c, r) => gradeProse(c, r?.message, { minSentences: 2, maxChars: 420 })

export function gradeWeekReview(c, r) {
  const ok = r && typeof r.headline === 'string' && Array.isArray(r.wins) && Array.isArray(r.observations) && typeof r.nextStep === 'string'
  const out = [check('형식', ok)]
  if (!ok) return out
  const all = [r.headline, ...r.wins, ...r.observations, r.nextStep].join('\n')
  out.push(...voice(all))
  out.push(check('headline이 한 줄', r.headline.trim().length > 0 && !r.headline.includes('\n') && r.headline.length <= 60, r.headline.length))
  out.push(check('wins 1~3', r.wins.length >= 1 && r.wins.length <= 3, r.wins.length))
  out.push(check('observations 1~3', r.observations.length >= 1 && r.observations.length <= 3, r.observations.length))
  out.push(check('nextStep이 있음', r.nextStep.trim().length > 0))
  const chars = all.replace(/\n/g, '').length
  out.push(check('모두 합쳐 450자 안쪽(10% 여유)', chars <= 495, chars))
  for (const re of c.mustNot ?? []) out.push(check(`없어야 함: ${re.source}`, !re.test(all), all.match(re)?.[0]))
  return out
}

export const GRADERS = { 'meal-text': gradeMeal, suggest: gradeSuggest, ask: gradeAsk, 'week-review': gradeWeekReview, nudge: gradeNudge }
export const score = (checks) => (checks.length === 0 ? 0 : checks.filter((c) => c.ok).length / checks.length)
