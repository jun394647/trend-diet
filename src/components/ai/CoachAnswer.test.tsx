import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CoachAnswer from './CoachAnswer'
import { parseAnswer, parseInline } from './CoachAnswerFormat'

const NBSP = ' '

/** 블록을 '종류: 글' 한 줄로 줄여 비교하기 쉽게 한다. */
function shape(text: string): string[] {
  return parseAnswer(text).map((b) =>
    b.type === 'p' || b.type === 'h'
      ? `${b.type}: ${b.inline.map((x) => (x.bold ? `[${x.text}]` : x.text)).join('')}`
      : `${b.type}: ${b.items
          .map((it) => `${it.nested ? '>' : ''}${it.n ?? '-'} ${it.inline.map((x) => (x.bold ? `[${x.text}]` : x.text)).join('')}`)
          .join(' | ')}`,
  )
}

describe('parseInline', () => {
  it('짝이 맞는 **만 굵게 한다', () => {
    expect(parseInline('앞 **가운데** 뒤')).toEqual([
      { text: '앞 ', bold: false },
      { text: '가운데', bold: true },
      { text: ' 뒤', bold: false },
    ])
    expect(parseInline('**하나** 그리고 **둘**').filter((x) => x.bold).map((x) => x.text)).toEqual(['하나', '둘'])
    expect(parseInline('__밑줄 굵게__도 같아요')[0]).toEqual({ text: '밑줄 굵게', bold: true })
  })

  it('짝이 없는 **는 기호만 떼고 글은 남긴다', () => {
    expect(parseInline('이건 **끝나지 않은 굵게')).toEqual([{ text: '이건 끝나지 않은 굵게', bold: false }])
    expect(parseInline('**하나** 그리고 **둘')).toEqual([
      { text: '하나', bold: true },
      { text: ' 그리고 둘', bold: false },
    ])
    expect(parseInline('**')).toEqual([])
    expect(parseInline('****')).toEqual([])
    expect(parseInline('** **')).toEqual([{ text: ' ', bold: false }])
  })

  it('기울임, 코드, 취소선, 링크는 기호를 떼고 글만 남긴다', () => {
    expect(parseInline('*천천히* 가도 돼요')).toEqual([{ text: '천천히 가도 돼요', bold: false }])
    expect(parseInline('`2,000kcal`쯤이에요')).toEqual([{ text: '2,000kcal쯤이에요', bold: false }])
    expect(parseInline('~~틀린 말~~ 맞는 말')).toEqual([{ text: '틀린 말 맞는 말', bold: false }])
    expect(parseInline('[여기](https://example.com/a_(b))를 보세요')).toEqual([{ text: '여기를 보세요', bold: false }])
    expect(parseInline('***둘 다***')).toEqual([{ text: '둘 다', bold: true }])
  })

  it('글 안의 곱셈표나 밑줄은 건드리지 않는다', () => {
    expect(parseInline('2 * 3 * 4는 24')).toEqual([{ text: '2 * 3 * 4는 24', bold: false }])
    expect(parseInline('snake_case_name')).toEqual([{ text: 'snake_case_name', bold: false }])
  })

  it('숫자와 띄어 쓴 단위 사이에서 줄이 바뀌지 않게 한다', () => {
    expect(parseInline('하루 2,150 kcal쯤')[0].text).toBe(`하루 2,150${NBSP}kcal쯤`)
    expect(parseInline('일주일에 0.5 kg, 2 주 동안')[0].text).toBe(`일주일에 0.5${NBSP}kg, 2${NBSP}주 동안`)
    expect(parseInline('1,800 ~ 2,000 kcal')[0].text).toBe(`1,800~2,000${NBSP}kcal`)
    // 단위가 아닌 낱말은 그대로 둔다.
    expect(parseInline('2 korean bbq')[0].text).toBe('2 korean bbq')
    expect(parseInline('3 끼니가 아니라 3 곳')[0].text).toBe(`3${NBSP}끼니가 아니라 3 곳`)
  })
})

describe('parseAnswer', () => {
  it('빈 줄로 문단을 나누고, 한 줄만 띄운 곳은 문단 안의 줄바꿈으로 둔다', () => {
    expect(shape('첫 문단이에요.\n같은 문단의 둘째 줄.\n\n\n둘째 문단이에요.')).toEqual([
      'p: 첫 문단이에요.\n같은 문단의 둘째 줄.',
      'p: 둘째 문단이에요.',
    ])
  })

  it('점 목록과 순서 목록을 알아본다', () => {
    expect(shape('이렇게 해 보세요.\n- 물 마시기\n- **단백질** 먼저\n* 천천히 먹기\n\n1. 먼저 기록\n2) 그다음 확인')).toEqual([
      'p: 이렇게 해 보세요.',
      'ul: - 물 마시기 | - [단백질] 먼저 | - 천천히 먹기',
      'ol: 1 먼저 기록 | 2 그다음 확인',
    ])
  })

  it('빈 줄을 사이에 둔 같은 목록은 하나로 잇고, 번호는 모델이 적은 대로 둔다', () => {
    expect(shape('1. 하나\n\n2. 둘\n\n사이 글\n\n3. 셋')).toEqual(['ol: 1 하나 | 2 둘', 'p: 사이 글', 'ol: 3 셋'])
  })

  it('들여 쓴 항목과 이어지는 줄을 앞 항목에 붙인다', () => {
    expect(shape('- 큰 항목\n  - 작은 항목\n- 다음 항목\n  이어지는 설명')).toEqual([
      'ul: - 큰 항목 | >- 작은 항목 | - 다음 항목 이어지는 설명',
    ])
  })

  it('제목의 #은 떼고 한 줄로 두며, 가로줄과 코드 울타리는 버린다', () => {
    expect(shape('## 이번 주 요약\n내용이에요.\n\n---\n\n### **굵은 제목** ###\n```\n코드처럼 적은 글\n```')).toEqual([
      'h: 이번 주 요약',
      'p: 내용이에요.',
      'h: 굵은 제목',
      'p: 코드처럼 적은 글',
    ])
    // 번호처럼 쓴 #1은 제목이 아니다.
    expect(shape('#1 순위는 물이에요')).toEqual(['p: #1 순위는 물이에요'])
  })

  it('인용 표시와 표의 세로줄은 떼어 읽을 수 있는 글로 둔다', () => {
    expect(shape('> 인용한 말\n\n| 끼니 | 칼로리 |\n|---|---|\n| 아침 | 400 kcal |')).toEqual([
      'p: 인용한 말',
      'p: 끼니 · 칼로리',
      `p: 아침 · 400${NBSP}kcal`,
    ])
  })

  it('목록 표시처럼 보이지만 아닌 줄은 문단으로 둔다', () => {
    expect(shape('-5kg이 목표예요\n2024년에 시작했어요\n**굵게**로 시작하는 줄')).toEqual([
      'p: -5kg이 목표예요\n2024년에 시작했어요\n[굵게]로 시작하는 줄',
    ])
  })

  it('빈 답과 기호뿐인 답은 아무것도 만들지 않는다', () => {
    expect(parseAnswer('')).toEqual([])
    expect(parseAnswer('  \n\n \r\n')).toEqual([])
    expect(parseAnswer('**\n---\n```')).toEqual([])
  })

  it('쓰는 중이라 덜 끝난 답도 기호 없이 보여 준다', () => {
    expect(shape('**핵심')).toEqual(['p: 핵심'])
    expect(shape('- 하나\n- **둘')).toEqual(['ul: - 하나 | - 둘'])
    expect(shape('1. 하나\n2.')).toEqual(['ol: 1 하나', 'p: 2.'])
  })

  it('아주 길거나 이상한 입력에도 멈추지 않는다', () => {
    const long = 'ㅋ'.repeat(5000)
    expect(shape(long)).toEqual([`p: ${long}`])
    const stars = '*'.repeat(2001)
    expect(() => parseAnswer(stars)).not.toThrow()
    const brackets = '['.repeat(3000) + '('.repeat(3000)
    const started = performance.now()
    expect(() => parseAnswer(`${brackets}\n${'- '.repeat(2000)}\n${'_'.repeat(3000)} ${'`'.repeat(3000)}`)).not.toThrow()
    expect(performance.now() - started).toBeLessThan(1000)
  })
})

describe('CoachAnswer', () => {
  it('문단, 굵게, 목록을 요소로 그린다', () => {
    const { container } = render(
      <CoachAnswer text={'멈춘 건 **아니에요**.\n\n- 물 마시기\n- 기록하기\n\n1. 먼저\n2. 다음'} />,
    )
    expect(container.querySelectorAll('p')).toHaveLength(1)
    expect(container.querySelector('strong')).toHaveTextContent('아니에요')
    const lists = screen.getAllByRole('list')
    expect(lists).toHaveLength(2)
    expect(lists[0].tagName).toBe('UL')
    expect(within(lists[0]).getAllByRole('listitem')).toHaveLength(2)
    expect(lists[1].tagName).toBe('OL')
    expect(within(lists[1]).getAllByRole('listitem')[1]).toHaveTextContent('2.다음')
    // 기호는 남지 않는다.
    expect(container.textContent).not.toMatch(/\*\*|^- /m)
  })

  it('꾸밈이 없는 문단은 글 한 덩어리로 두고 줄바꿈을 지킨다', () => {
    render(<CoachAnswer text={'그날은 편하게 드세요.\n한 주 평균으로 보면 돼요.'} />)
    const p = screen.getByText(/그날은 편하게 드세요/)
    expect(p.tagName).toBe('P')
    expect(p.childNodes).toHaveLength(1)
    expect(p.textContent).toBe('그날은 편하게 드세요.\n한 주 평균으로 보면 돼요.')
  })

  it('태그가 들어 있어도 글자로만 보여 주고 요소를 만들지 않는다', () => {
    const hostile = '<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n**<b onclick="x()">굵게</b>**\n[눌러요](javascript:alert(1))'
    const { container } = render(<CoachAnswer text={hostile} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('[onclick], [onerror]')).toBeNull()
    expect(container.textContent).toContain('<script>alert(1)</script>')
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(container.querySelector('strong')).toHaveTextContent('<b onclick="x()">굵게</b>')
    // 링크는 글만 남고 주소는 사라진다.
    expect(container.textContent).toContain('눌러요')
    expect(container.textContent).not.toContain('javascript:')
  })

  it('빈 글이면 빈 자리만 그리고, 글이 채워지면 그만큼 다시 그린다', () => {
    const { container, rerender } = render(<CoachAnswer text="" />)
    expect(container.querySelector('.ca')).toBeEmptyDOMElement()
    rerender(<CoachAnswer text="최근 2주 **추" />)
    expect(container.textContent).toBe('최근 2주 추')
    rerender(<CoachAnswer text={'최근 2주 **추세**는 줄고 있어요.\n\n- 하나'} />)
    expect(container.querySelector('strong')).toHaveTextContent('추세')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })
})
