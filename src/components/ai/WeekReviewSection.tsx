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
  // 횟수를 다 썼을 때는 횟수 안내만 보여 준다. 앞서 남은 실패 안내를 그 곁에 두지 않는다.
  const shownError = ai === 'limit' ? null : error
  const errorHasAction = shownError !== null && (isRetryable(shownError) || shownError.code === 'unauthorized')

  return (
    <section className="card week-review" aria-labelledby="week-review-title">
      <h2 className="card-title" id="week-review-title">
        <AiTag /> 돌아보기
      </h2>

      {ai === 'login' ? (
        <AiLoginHint benefit="AI가 최근 2주를 돌아봐 줘요" />
      ) : (
        <div className="week-review-body">
          {!review && (ai !== 'limit' || pending) && (
            <p className="small muted">기본 정보와 최근 2주 기록을 AI에 보내, 잘된 점과 해 볼 만한 한 가지를 짧게 받아요.</p>
          )}

          {/* 기다리는 말만 알리는 자리. 늘 그려 두어야 화면 낭독기가 새로 들어온 글을 읽는다. */}
          {/* 결과는 이 밖에 두고 초점을 옮겨 알린다. 안에 두면 초점과 알림으로 두 번 읽힌다. */}
          <div className="week-review-status" role="status">
            {!review && pending && (
              <p className="ai-loading week-review-wait">
                <span className="ai-loading-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                최근 2주를 돌아보는 중이에요
              </p>
            )}
          </div>

          {/* 기다리는 동안에는 받을 글과 같은 모양의 자리 표시를 둔다. 답이 와도 아래 구획이 덜 움직인다. */}
          {!review && pending && (
            <div className="week-review-skeleton" aria-hidden="true">
              <span className="skeleton week-review-sk-head" />
              <span className="skeleton week-review-sk-head week-review-sk--w60" />
              <span className="skeleton week-review-sk-label" />
              <span className="skeleton week-review-sk-line week-review-sk--w85" />
              <span className="skeleton week-review-sk-line week-review-sk--w70" />
              <span className="skeleton week-review-sk-label" />
              <span className="skeleton week-review-sk-line week-review-sk--w90" />
              <span className="skeleton week-review-sk-line week-review-sk--w60" />
              <span className="week-review-sk-next">
                <span className="skeleton week-review-sk-label" />
                <span className="skeleton week-review-sk-line week-review-sk--w90" />
                <span className="skeleton week-review-sk-line week-review-sk--w45" />
              </span>
            </div>
          )}

          {review && (
            <div className="week-review-result" data-testid="week-review">
              <p className="week-review-headline" ref={headlineRef} tabIndex={-1}>
                {review.headline}
              </p>
              {review.wins.length > 0 && (
                <div className="week-review-group week-review-group--wins">
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
                <div className="week-review-group week-review-group--obs">
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
          )}

          {!review && !pending && (
            <>
              {shownError !== null && <AiErrorNote error={shownError} onRetry={ai === 'ready' ? ask : undefined} />}
              {ai === 'conflict' && <AiConflictHint />}
              {ai === 'limit' && <AiLimitNote fallback="아래에서 다음 한 주는 그대로 정할 수 있어요." />}
              {ai === 'ready' && !errorHasAction && (
                // 구획 제목에 이미 AI 표시가 있어 버튼 안에는 두지 않고, 읽어 주는 이름에만 밝힌다.
                <button type="button" className="btn week-review-ask" aria-label="AI로 최근 2주 돌아보기" onClick={ask}>
                  최근 2주 돌아보기
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
