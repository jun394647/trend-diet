/**
 * 코치의 답을 화면에 그릴 모양으로 나눈다.
 *
 * 모델은 보통 줄글로 답하지만 가끔 `**굵게**`, `- 목록`, `1. 순서 목록`, `# 제목`을 섞는다.
 * 여기서는 그 몇 가지만 알아보고, 나머지 기호는 떼어 내 읽을 수 있는 글로 남긴다.
 * HTML을 만들지 않고 조각의 배열만 돌려주므로, 답에 태그가 들어 있어도 글자로만 보인다.
 * 답이 조금씩 채워지는 중이어도(닫히지 않은 `**` 등) 기호가 그대로 보이지 않게 한다.
 */

export interface Inline {
  text: string
  bold: boolean
}

export interface ListItem {
  /** 순서 목록에서 모델이 적은 번호. */
  n: number | null
  /** 한 단계 들여 쓴 항목인지. 더 깊은 들여쓰기는 한 단계로 본다. */
  nested: boolean
  inline: Inline[]
}

export type Block =
  | { type: 'p'; inline: Inline[] }
  | { type: 'h'; inline: Inline[] }
  | { type: 'ul'; items: ListItem[] }
  | { type: 'ol'; items: ListItem[] }

const NBSP = ' '

/** 숫자 뒤에 띄어 쓴 단위. 숫자와 단위 사이에서 줄이 바뀌지 않게 한다. */
const UNIT =
  /(\d)[ \t](?=(?:kcal|kg|g|mg|ml|mL|L|cm|km)(?![A-Za-z])|%|킬로칼로리|칼로리|킬로그램|그램|공기|그릇|접시|조각|인분|주|일|번|끼|개|잔|컵|분|시간)/g
/** 범위 표시 앞뒤의 빈칸(1,800 ~ 2,000). */
const RANGE = /(\d)[ \t]*([~∼])[ \t]*(?=\d)/g

function tidy(text: string): string {
  return text.replace(RANGE, `$1$2`).replace(UNIT, `$1${NBSP}`)
}

/** 굵게 말고는 쓰지 않는 글자 꾸밈 기호를 떼어 낸다. */
function stripInline(text: string): string {
  return (
    text
      // [글](주소)와 ![그림](주소)는 글만 남긴다. 주소로 이동하게 만들지 않는다.
      .replace(/!?\[([^\]\n]*)\]\((?:[^()\n]|\([^()\n]*\))*\)/g, '$1')
      // `코드`
      .replace(/`+([^`\n]+)`+/g, '$1')
      .replace(/`{3,}/g, '')
      // ~~취소선~~
      .replace(/~~([^~\n]+)~~/g, '$1')
  )
}

/** 낱말을 감싼 `*기울임*`, `_기울임_`의 기호만 뗀다. `2 * 3`이나 `snake_case`는 건드리지 않는다. */
function stripEmphasis(text: string): string {
  return text
    .replace(/(^|[\s(["'“‘])\*(?![\s*])([^*\n]*[^\s*])\*(?=$|[\s).,!?:;"'”’~]|[가-힣])/g, '$1$2')
    .replace(/(^|[\s(["'“‘])_(?![\s_])([^_\n]*[^\s_])_(?=$|[\s).,!?:;"'”’~]|[가-힣])/g, '$1$2')
}

/** 한 덩어리의 글을 굵은 부분과 아닌 부분으로 나눈다. */
export function parseInline(raw: string): Inline[] {
  const text = stripInline(raw)
    .replace(/__(?=\S)([^_\n]+?)__/g, '**$1**')
    // ***굵은 기울임***은 굵게로만 본다.
    .replace(/\*{3,}/g, '**')
  const parts = text.split('**')
  const out: Inline[] = []
  const push = (piece: string, bold: boolean) => {
    const t = tidy(stripEmphasis(piece))
    if (t === '') return
    const prev = out[out.length - 1]
    if (prev && prev.bold === bold) prev.text += t
    else out.push({ text: t, bold })
  }
  // 짝이 맞는 `**`만 굵게 한다. 짝 없이 남은 마지막 하나는 기호만 떼고 글은 그대로 둔다.
  const pairs = Math.floor((parts.length - 1) / 2)
  parts.forEach((piece, i) => {
    const bold = i % 2 === 1 && i <= pairs * 2 && piece.trim() !== ''
    push(piece, bold)
  })
  return out
}

const HEADING = /^\s{0,3}(?:#{1,6}\s+|#{2,6})(.*?)\s*#*\s*$/
const BULLET = /^(\s*)(?:[-*+•·▪◦‣–—])\s+(.*)$/
const ORDERED = /^(\s*)(\d{1,3})[.)]\s+(.*)$/
const RULE = /^\s*(?:[-*_=]\s*){3,}$/
const FENCE = /^\s*(?:```|~~~)/
const QUOTE = /^\s*(?:>\s?)+/
/** 표의 머리와 본문을 나누는 줄(|---|---|). */
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/

function cleanLine(line: string): string {
  let s = line.replace(QUOTE, '')
  // 표의 한 줄은 칸 사이를 가운뎃점으로 이어 한 줄 글로 만든다.
  if (/^\s*\|.*\|\s*$/.test(s)) {
    s = s
      .trim()
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c !== '')
      .join(' · ')
  }
  return s
}

/** 답 전체를 문단과 목록으로 나눈다. */
export function parseAnswer(source: string): Block[] {
  const blocks: Block[] = []
  /** 이어 쓰는 중인 문단의 줄들. */
  let para: string[] = []
  /** 빈 줄을 지났는지. 빈 줄을 사이에 둔 같은 종류의 목록은 하나로 잇는다. */
  let gap = false

  const flush = () => {
    if (para.length === 0) return
    const inline = parseInline(para.join('\n'))
    if (inline.length > 0) blocks.push({ type: 'p', inline })
    para = []
  }

  const lines = source.replace(/\r\n?/g, '\n').split('\u0000').join('').split('\n')
  for (const rawLine of lines) {
    if (FENCE.test(rawLine) || RULE.test(rawLine) || TABLE_RULE.test(rawLine)) {
      flush()
      gap = true
      continue
    }
    const line = cleanLine(rawLine).replace(/\s+$/, '')
    if (line.trim() === '') {
      flush()
      gap = true
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flush()
      // 제목 안의 굵게 표시는 뜻이 없으므로 기호만 뗀다.
      const inline = parseInline(heading[1].replace(/\*\*/g, '')).map((x) => ({ ...x, bold: false }))
      if (inline.length > 0) blocks.push({ type: 'h', inline })
      gap = false
      continue
    }

    const ordered = ORDERED.exec(line)
    const bullet = ordered ? null : BULLET.exec(line)
    if (ordered || bullet) {
      flush()
      const type = ordered ? 'ol' : 'ul'
      const indent = (ordered ? ordered[1] : bullet![1]).replace(/\t/g, '  ').length
      const body = ordered ? ordered[3] : bullet![2]
      const item: ListItem = {
        n: ordered ? Number(ordered[2]) : null,
        nested: false,
        inline: parseInline(body.replace(/^\[[ xX]\]\s+/, '')),
      }
      const prev = blocks[blocks.length - 1]
      const inList = prev && (prev.type === 'ul' || prev.type === 'ol') ? prev : null
      if (inList && indent >= 2 && (inList.type !== type || !gap)) {
        // 들여 쓴 항목은 종류가 달라도 앞 목록 안의 한 단계 아래 항목으로 둔다.
        item.nested = true
        inList.items.push(item)
      } else if (inList && inList.type === type) {
        item.nested = indent >= 2 && inList.items[inList.items.length - 1].nested
        inList.items.push(item)
      } else {
        blocks.push({ type, items: [item] })
      }
      gap = false
      continue
    }

    // 목록 바로 아래에 들여 쓴 줄은 그 항목에 이어 붙인다.
    const prev = blocks[blocks.length - 1]
    if (para.length === 0 && !gap && prev && (prev.type === 'ul' || prev.type === 'ol') && /^\s{2,}\S/.test(line)) {
      const lastItem = prev.items[prev.items.length - 1]
      const more = parseInline(line.trim())
      if (more.length > 0) {
        const tail = lastItem.inline[lastItem.inline.length - 1]
        if (tail && tail.bold === more[0].bold) {
          tail.text += ` ${more[0].text}`
          lastItem.inline.push(...more.slice(1))
        } else {
          more[0] = { ...more[0], text: ` ${more[0].text}` }
          lastItem.inline.push(...more)
        }
      }
      continue
    }

    para.push(line.trim())
    gap = false
  }
  flush()
  return blocks
}
