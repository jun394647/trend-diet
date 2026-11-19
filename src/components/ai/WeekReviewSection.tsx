import { useState } from 'react'
import type { AiRequest, WeekReview } from '../../ai/contract'
import { useAiCall } from '../../ai/useAiCall'
import type { DateStr } from '../../types'
import { AiDisclaimer, AiErrorNote, AiLoading, AiTag } from './AiBits'
import { useCoachContext } from './CoachHooks'
import { cacheWeekReview, cachedWeekReview } from './WeekReviewCache'
import './WeekReviewSection.css'

type WeekReviewRequest = Extract<AiRequest, { task: 'week-review' }>

/** 주간 체크인의 'AI 돌아보기' 구획. 버튼을 눌러야 호출한다. */
export default function WeekReviewSection({ date }: { date: DateStr }) {
  const context = useCoachContext(date)
  const { state, run } = useAiCall<WeekReviewRequest>()
  const [review, setReview] = useState<WeekReview | null>(() => cachedWeekReview(date))

  if (!context && !review) return null

  async function ask() {
    if (!context) return
    const result = await run({ task: 'week-review', context })
    if (result) {
      cacheWeekReview(date, result)
      setReview(result)
    }
  }

  return (
    <section className="card week-review" aria-labelledby="week-review-title">
      <h2 className="card-title" id="week-review-title">
        <AiTag /> 돌아보기
      </h2>

      {review ? (
        <div className="week-review-body" data-testid="week-review">
          <p className="week-review-headline">{review.headline}</p>
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
            <div className="well week-review-next">
              <h3 className="week-review-sub">다음 한 주에 해 볼 것</h3>
              <p>{review.nextStep}</p>
            </div>
          )}
          <AiDisclaimer>AI가 최근 2주 기록을 읽고 쓴 글이라 실제와 다를 수 있어요. 의학적 조언은 아니에요.</AiDisclaimer>
        </div>
      ) : state.status === 'loading' ? (
        <AiLoading label="최근 2주를 돌아보는 중이에요" />
      ) : (
        <div className="week-review-body">
          <p className="muted">
            최근 2주의 기록을 읽고, 잘된 점과 다음 한 주에 해 볼 한 가지를 짧게 적어 드려요.
          </p>
          {state.status === 'error' && <AiErrorNote error={state.error} onRetry={() => void ask()} />}
          <button type="button" className="btn week-review-ask" onClick={() => void ask()}>
            AI로 돌아보기
          </button>
        </div>
      )}
    </section>
  )
}
