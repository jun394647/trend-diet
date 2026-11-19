import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { MealEstimate } from '../../ai/contract'
import type { AiCallState } from '../../ai/useAiCall'
import { MAX_ENTRY_KCAL } from '../../lib/quickAdd'
import { fmtKcal } from '../today/format'
import { AiDisclaimer, AiErrorNote, AiLoading, AiTag } from './AiBits'
import './MealAiReview.css'

/** AI에 보낼 것. 적은 글이거나, 줄여 둔 사진이다. */
export type MealAiSource =
  | { kind: 'text'; text: string }
  | { kind: 'photo'; base64: string; mediaType: 'image/jpeg'; previewUrl: string }

export interface MealAiLogItem {
  /** 결과 안에서의 순번. 일부만 저장됐을 때 어느 줄이 저장됐는지 알리는 데 쓴다. */
  id: number
  name: string
  kcal: number
}

interface Props {
  source: MealAiSource
  state: AiCallState<MealEstimate>
  /** 기록을 저장하는 중이면 true. */
  busy: boolean
  /** 이미 기록한 줄의 id. 일부만 저장된 뒤 다시 기록할 때 두 번 들어가지 않게 목록에서 뺀다. */
  savedIds?: readonly number[]
  /** AI에 보낸다. 사진이면 덧붙인 말을 함께 넘긴다. 다시 시도할 때도 쓴다. */
  onSend: (note?: string) => void
  /** 기다리는 중에 그만둔다. */
  onCancel: () => void
  /** 입력 칸으로 돌아간다. */
  onBack: () => void
  onLog: (items: MealAiLogItem[]) => void
}

/**
 * AI로 식사를 기록하는 단계. 식사 추가 시트에서 입력 칸 자리에 대신 보여 준다.
 *  - 사진이면 먼저 덧붙일 말을 받고, 확인한 뒤에야 보낸다.
 *  - 결과가 오면 음식별로 고치거나 뺀 뒤 한 번에 기록한다.
 */
export default function MealAiReview({ source, state, busy, savedIds = NO_IDS, onSend, onCancel, onBack, onLog }: Props) {
  const [note, setNote] = useState('')
  const titleRef = useRef<HTMLHeadingElement>(null)
  const isPhoto = source.kind === 'photo'
  const backLabel = isPhoto ? '돌아가기' : '다시 적기'
  const empty = state.status === 'done' && state.data.items.length === 0
  const stage = state.status === 'done' ? (empty ? 'empty' : 'result') : state.status

  // 단계가 바뀌면 제목으로 포커스를 옮겨, 화면을 읽어 주는 도구가 새 내용을 알 수 있게 한다.
  useEffect(() => {
    titleRef.current?.focus()
  }, [stage])

  const title =
    stage === 'result'
      ? 'AI가 어림잡은 칼로리'
      : stage === 'empty'
        ? '칼로리를 어림잡지 못했어요'
        : isPhoto
          ? '사진으로 칼로리 어림잡기'
          : 'AI로 칼로리 어림잡기'

  const sendNote = () => onSend(note.trim() || undefined)

  return (
    <section className="stack mealai" aria-labelledby="mealai-title">
      <h3 ref={titleRef} className="mealai-title" id="mealai-title" tabIndex={-1}>
        {title}
      </h3>

      {source.kind === 'photo' ? (
        <img
          className={stage === 'idle' ? 'mealai-photo' : 'mealai-photo mealai-photo--small'}
          src={source.previewUrl}
          alt="고른 사진"
        />
      ) : (
        <p className="mealai-quote muted">{source.text}</p>
      )}

      {stage === 'idle' && isPhoto && (
        <form
          className="stack"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            sendNote()
          }}
        >
          <div className="field">
            <label htmlFor="mealai-note">
              덧붙일 말<span className="ai-optional"> (안 적어도 돼요)</span>
            </label>
            <input
              id="mealai-note"
              className="input"
              autoComplete="off"
              enterKeyHint="go"
              maxLength={200}
              placeholder="예: 밥은 반만 먹었어요"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn--primary btn--block btn--lg mealai-go">
            <span aria-hidden="true">
              <AiTag />
            </span>
            칼로리 어림잡기
          </button>
          <p className="small muted">어림잡기를 누르면 이 사진을 AI에 보내요. 누르기 전에는 보내지 않아요.</p>
          <button type="button" className="btn btn--ghost btn--block" onClick={onBack}>
            {backLabel}
          </button>
        </form>
      )}

      {stage === 'loading' && (
        <>
          <AiLoading label={isPhoto ? '사진을 보고 칼로리를 어림잡는 중이에요' : '적은 내용으로 칼로리를 어림잡는 중이에요'} />
          <button type="button" className="btn btn--ghost btn--block" onClick={onCancel}>
            취소
          </button>
          <p className="small muted mealai-cancel-note">취소해도 이번 한 번은 쓴 것으로 세요.</p>
        </>
      )}

      {state.status === 'error' && (
        <>
          <AiErrorNote error={state.error} onRetry={sendNote} />
          <button type="button" className="btn btn--ghost btn--block" onClick={onBack}>
            {backLabel}
          </button>
        </>
      )}

      {state.status === 'done' && empty && (
        <>
          <p className="mealai-note">
            {isPhoto
              ? '사진에서 음식을 알아보지 못했어요. 다른 사진으로 해 주세요.'
              : '음식을 알아보지 못했어요. 무엇을 얼마나 먹었는지 조금 더 적어 주세요.'}
          </p>
          {state.data.note.trim() && <p className="small muted">{state.data.note.trim()}</p>}
          <button type="button" className="btn btn--block" onClick={onBack}>
            {backLabel}
          </button>
        </>
      )}

      {state.status === 'done' && !empty && (
        <ResultForm data={state.data} busy={busy} savedIds={savedIds} backLabel={backLabel} onBack={onBack} onLog={onLog} />
      )}
    </section>
  )
}

const NO_IDS: readonly number[] = []

interface Row {
  id: number
  name: string
  amount: string
  low: boolean
  /** AI가 처음 준 값. 뺐다가 다시 넣을 때 되돌린다. */
  estimate: number
  kcalText: string
  included: boolean
}

const clampKcal = (n: number) => (Number.isFinite(n) ? Math.min(MAX_ENTRY_KCAL, Math.max(0, Math.round(n))) : 0)
const rowKcal = (r: Row) => Number(r.kcalText || 0)

function toRows(data: MealEstimate): Row[] {
  return data.items.map((item, id) => {
    const estimate = clampKcal(item.kcal)
    return {
      id,
      name: item.name.trim().slice(0, 40) || '이름 없는 음식',
      amount: item.amount.trim(),
      low: item.confidence === 'low',
      estimate,
      kcalText: estimate > 0 ? String(estimate) : '',
      included: estimate > 0,
    }
  })
}

interface ResultProps {
  data: MealEstimate
  busy: boolean
  savedIds: readonly number[]
  backLabel: string
  onBack: () => void
  onLog: (items: MealAiLogItem[]) => void
}

function ResultForm({ data, busy, savedIds, backLabel, onBack, onLog }: ResultProps) {
  const [allRows, setRows] = useState(() => toRows(data))
  // 이미 기록한 줄은 목록에서 뺀다. 다시 기록해도 두 번 들어가지 않는다.
  const rows = allRows.filter((r) => !savedIds.includes(r.id))

  const patch = (id: number, change: (r: Row) => Row) => setRows((rs) => rs.map((r) => (r.id === id ? change(r) : r)))

  // 칼로리를 지우거나 0으로 두면 빠지고, 숫자를 적으면 다시 들어간다.
  const onKcal = (id: number, raw: string) => {
    const kcalText = raw.replace(/\D/g, '').slice(0, 4)
    patch(id, (r) => ({ ...r, kcalText, included: Number(kcalText || 0) > 0 }))
  }

  const onToggle = (id: number) =>
    patch(id, (r) => {
      if (r.included) return { ...r, included: false }
      const kcalText = rowKcal(r) > 0 ? r.kcalText : r.estimate > 0 ? String(r.estimate) : r.kcalText
      return { ...r, kcalText, included: Number(kcalText || 0) > 0 }
    })

  const included = rows.filter((r) => r.included && rowKcal(r) > 0)
  const total = included.reduce((sum, r) => sum + rowKcal(r), 0)
  const tooBig = included.some((r) => rowKcal(r) > MAX_ENTRY_KCAL)
  const note = data.note.trim()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy || tooBig || included.length === 0) return
    onLog(included.map((r) => ({ id: r.id, name: r.name, kcal: rowKcal(r) })))
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <ul className="list mealai-items" aria-label="AI가 나눈 음식">
        {rows.map((r) => {
          const kcal = rowKcal(r)
          const on = r.included && kcal > 0
          return (
            <li key={r.id} className={on ? undefined : 'mealai-item--off'}>
              <label className="mealai-item-main">
                <input type="checkbox" checked={on} onChange={() => onToggle(r.id)} />
                <span className="mealai-item-text">
                  <span className="mealai-item-name">{r.name}</span>
                  <span className="mealai-item-meta">
                    {r.amount && <span className="small muted">{r.amount}</span>}
                    {r.low && <span className="chip mealai-chip">덜 확실해요</span>}
                    {!on && (
                      <span className="small muted">{kcal > 0 ? '기록하지 않아요' : '칼로리를 적으면 기록해요'}</span>
                    )}
                  </span>
                </span>
              </label>
              <span className="mealai-kcal">
                <input
                  className="input num mealai-kcal-input"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label={`${r.name} 칼로리`}
                  aria-invalid={on && kcal > MAX_ENTRY_KCAL ? true : undefined}
                  value={r.kcalText}
                  onChange={(e) => onKcal(r.id, e.target.value)}
                />
                <span className="small muted" aria-hidden="true">
                  kcal
                </span>
              </span>
            </li>
          )
        })}
      </ul>

      {tooBig && (
        <p className="field-error" role="alert">
          한 건에 1~{fmtKcal(MAX_ENTRY_KCAL)} kcal까지 기록할 수 있어요.
        </p>
      )}

      {note && <p className="mealai-note">{note}</p>}

      {/* 합계와 기록 버튼은 목록이 길어도 늘 보이게 시트 아래에 붙여 둔다. */}
      <div className="mealai-footer">
        <div className="mealai-total">
          <span className="muted">기록할 칼로리</span>
          <span className="mealai-total-kcal num" data-testid="mealai-total">
            {fmtKcal(total)}
            <span className="unit">kcal</span>
          </span>
        </div>
        <button
          type="submit"
          className="btn btn--primary btn--block btn--lg"
          disabled={busy || tooBig || included.length === 0}
        >
          {included.length === 0 ? '기록할 음식을 골라 주세요' : `${included.length}건 기록하기`}
        </button>
      </div>
      <AiDisclaimer>실제와 다를 수 있어요. 숫자를 눌러 고칠 수 있어요.</AiDisclaimer>
      <button type="button" className="btn btn--ghost btn--block" onClick={onBack}>
        {backLabel}
      </button>
    </form>
  )
}
