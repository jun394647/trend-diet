import { useMemo } from 'react'
import { parseAnswer, type Inline, type ListItem } from './CoachAnswerFormat'
import './CoachAnswer.css'

function renderInline(inline: Inline[]) {
  // 굵은 부분이 없으면 글자만 둔다(문단 하나가 글 한 덩어리).
  return inline.map((x, i) => (x.bold ? <strong key={i}>{x.text}</strong> : x.text))
}

function Items({ items, ordered }: { items: ListItem[]; ordered: boolean }) {
  return items.map((item, i) => (
    <li key={i} className={item.nested ? 'ca-item ca-item--nested' : 'ca-item'}>
      {/* 번호와 점은 꾸밈이다. 목록이라는 것과 순서는 ol/ul이 알려 준다. */}
      <span className={ordered && item.n !== null ? 'ca-marker ca-marker--num' : 'ca-marker'} aria-hidden="true">
        {ordered && item.n !== null ? `${item.n}.` : ''}
      </span>
      <span className="ca-item-text">{renderInline(item.inline)}</span>
    </li>
  ))
}

/**
 * 코치의 답 한 개. 문단, 굵게, 목록만 꾸미고 나머지는 글 그대로 보여 준다.
 * text가 조금씩 채워져도 그때그때 있는 만큼 그린다.
 */
export default function CoachAnswer({ text }: { text: string }) {
  const blocks = useMemo(() => parseAnswer(text), [text])
  return (
    <div className="ca">
      {blocks.map((b, i) => {
        if (b.type === 'p') {
          return (
            <p key={i} className="ca-p">
              {renderInline(b.inline)}
            </p>
          )
        }
        if (b.type === 'h') {
          return (
            <p key={i} className="ca-h">
              <strong>{renderInline(b.inline)}</strong>
            </p>
          )
        }
        const ordered = b.type === 'ol'
        // 목록 표시를 CSS로 지워도 화면 낭독기가 목록으로 읽도록 role을 적어 둔다.
        return ordered ? (
          <ol key={i} className="ca-list ca-list--ol" role="list">
            <Items items={b.items} ordered />
          </ol>
        ) : (
          <ul key={i} className="ca-list" role="list">
            <Items items={b.items} ordered={false} />
          </ul>
        )
      })}
    </div>
  )
}
