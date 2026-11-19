import { useEffect, useMemo, useRef } from 'react'
import { useAiAvailability } from '../../ai/useAiAvailability'
import { useSync } from '../../sync/store'
import type { DateStr } from '../../types'
import { AiConflictHint, AiDisclaimer, AiErrorNote, AiLimitNote, AiLoginHint, AiQuotaLeft, AiTag } from './AiBits'
import { isRetryable } from './CoachCall'
import { useCoachContext } from './CoachHooks'
import { cachedWeekReview, requestWeekReview, useWeekReview, weekReviewKey } from './WeekReviewCache'
import './WeekReviewSection.css'

/**
 * 주간 체크인의 'AI 돌아보기' 구획. 버튼을 눌러야 호출한다.
 * recommendation은 앱이 이번 체크인에서 권하는 선택지. AI의 조언이 그것과 어긋나지 않게 함께 보낸다.
 */
export default function WeekReviewSection({ date, recommendation }: { date: DateStr; recommendation?: string }) {
  const ai = useAiAvailability()
  const context = useCoachContext(date)
  const email = useSync((s) => s.email)
  const store = useWeekReview()
  const key = weekReviewKey(email, date)
  const mine = key !== null && store.key === key
  const pending = mine && store.pending
  const error = mine ? store.error : null
  // 이번에 받은 것이 없으면 같은 날 받아 기기에 적어 둔 것을 찾아본다.
  const stored = mine ? store.review : null
  const review = useMemo(() => stored ?? (key ? cachedWeekReview(date) : null), [stored, key, date])

  // 기다리던 답이 이 화면에서 도착했을 때만 한 줄 요약으로 초점을 옮긴다. 돌아와서 다시 볼 때는 옮기지 않는다.
  const headlineRef = useRef<HTMLParagraphElement>(null)
  const wasPending = useRef(pending)
  useEffect(() => {
    if (wasPending.current && !pending && review) headlineRef.current?.focus()
    wasPending.current = pending
  }, [pending, review])

  if (ai === 'off') return null
  if (ai !== 'login' && !context && !review) return null

  function ask() {
    if (!context || ai !== 'ready') return
    void requestWeekReview(date, context, recommendation)
  }

  // 실패 안내에 '다시 시도'나 로그인 링크가 있으면 같은 자리에 버튼을 하나 더 두지 않는다.
  const errorHasAction = error !== null && (isRetryable(error) || error.code === 'unauthorized')

  return (
    <section className="card week-review" aria-labelledby="week-review-title">
      <h2 className="card-title" id="week-review-title">
        <AiTag /> 돌아보기
      </h2>

      {ai === 'login' ? (
        <AiLoginHint benefit="AI가 지난 2주를 돌아봐 줘요" />
      ) : (
        <div className="week-review-body">
          {!review && (
            <p className="small muted">최근 2주 기록을 읽고, 잘된 점과 해 볼 만한 한 가지를 짧게 적어요.</p>
          )}

          {/* 기다리는 말과 결과를 같은 자리에서 알린다. 늘 그려 두어야 화면 낭독기가 바뀐 내용을 읽는다. */}
          <div className="week-review-status" role="status">
            {review ? (
              <div className="week-review-result" data-testid="week-review">
                <p className="week-review-headline" ref={headlineRef} tabIndex={-1}>
                  {review.headline}
                </p>
                {review.wins.length > 0 && (
                  <div>
                    <h3 className="week-review-sub" id="week-review-wins">
                      잘된 점
                    </h3>
                    <ul className="week-review-list" aria-labelledby="week-review-wins">
                      {review.wins.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {review.observations.length > 0 && (
                  <div>
                    <h3 className="week-review-sub" id="week-review-obs">
                      눈에 띄는 점
                    </h3>
                    <ul className="week-review-list" aria-labelledby="week-review-obs">
                      {review.observations.map((o, i) => (
                        <li key={i}>{o}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {review.nextStep && (
                  <div className="week-review-next">
                    <h3 className="week-review-sub">해 볼 만한 한 가지</h3>
                    <p>{review.nextStep}</p>
                  </div>
                )}
                <AiDisclaimer>AI가 최근 2주 기록을 읽고 쓴 글이라 실제와 다를 수 있어요. 의학적 조언은 아니에요.</AiDisclaimer>
              </div>
            ) : pending ? (
              // AiLoading과 같은 모양. 이 자리가 이미 role="status"라 한 번만 읽히도록 역할은 겹쳐 두지 않는다.
              <p className="ai-loading week-review-wait">
                <span className="ai-loading-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                최근 2주를 돌아보는 중이에요
              </p>
            ) : null}
          </div>

          {!review && !pending && (
            <>
              {error !== null && <AiErrorNote error={error} onRetry={ai === 'ready' ? ask : undefined} />}
              {ai === 'conflict' && <AiConflictHint />}
              {ai === 'limit' && <AiLimitNote fallback="아래에서 다음 한 주는 그대로 정할 수 있어요." />}
              {ai === 'ready' && !errorHasAction && (
                <button type="button" className="btn week-review-ask" onClick={ask}>
                  <AiTag /> 돌아보기 받기
                </button>
              )}
              {ai === 'ready' && <AiQuotaLeft />}
            </>
          )}
        </div>
      )}
    </section>
  )
}
