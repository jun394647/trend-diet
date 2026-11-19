import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { diffDays, formatKorean, today } from '../lib/date'
import { isCheckinDue, latestCheckin } from '../lib/selectors'
import { buildCheckinReview, targetRange } from '../lib/sustain'
import type { CheckinOption, CheckinOptionId, CheckinReview } from '../lib/sustain'
import { BLEND, MIN_LOGGED_DAYS, MIN_SPAN_DAYS, MIN_WEIGH_INS, WINDOW_DAYS } from '../lib/tdee'
import { useStore } from '../store'
import './Checkin.css'

const kcal = (n: number) => Math.round(n).toLocaleString('ko-KR')

/** 부호를 붙인 숫자. 반올림해서 0이면 부호 없이 돌려준다. */
function signed(n: number, digits: number): string {
  const abs = Math.abs(n).toFixed(digits)
  if (Number(abs) === 0) return abs
  return `${n > 0 ? '+' : '−'}${abs}`
}

function signedKcal(n: number): string {
  const r = Math.round(n)
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toLocaleString('ko-KR')} kcal`
}

interface OptionCopy {
  title: string
  why: string
  /** 이 선택지를 골랐을 때 확인 버튼에 쓰는 말. */
  action: string
}

function optionCopy(option: CheckinOption, review: CheckinReview): OptionCopy {
  switch (option.id) {
    case 'maintain':
      return {
        title: '유지로 넘어가기',
        why: '목표 체중에 닿았어요. 이제는 쓰는 만큼 먹으면서 지금 체중을 지켜요. 뺀 체중이 오래 가는 건 이 기간 덕분이에요.',
        action: '유지로 넘어가기',
      }
    case 'break': {
      const until = option.profilePatch?.breakUntil
      return {
        title: '2주 쉬어 가기',
        why: `감량을 ${review.weekOfPhase}주째 이어 왔어요. ${until ? `${formatKorean(until)}까지 ` : ''}2주 동안 쓰는 만큼 먹고, 그 뒤에 다시 시작해요. 적게 먹는 기간이 길어질수록 이어 가기 어려워져요.`,
        action: '2주 유지 기간 시작하기',
      }
    }
    case 'resume':
      return {
        title: '감량 다시 시작하기',
        why: `쉬어 가는 기간이 끝났어요. 전과 같은 주 ${option.weeklyLossKg} kg 속도로 다시 시작해요.`,
        action: '감량 다시 시작하기',
      }
    case 'slower': {
      const over = review.recent.avgKcal !== null ? review.recent.avgKcal - review.previous.targetKcal : null
      return {
        title: `주 ${option.weeklyLossKg} kg으로 늦추기`,
        why: `${over !== null && over > 0 ? `최근 평균 섭취가 목표보다 ${kcal(over)} kcal 많았어요. ` : ''}더 참는 대신 속도를 늦춰서 목표를 올려요. 빠르지만 못 지키는 속도보다 이어 갈 수 있는 속도가 나아요.`,
        action: `주 ${option.weeklyLossKg} kg으로 늦추기`,
      }
    }
    case 'adaptive':
      return {
        title: '새 추정치에 맞추기',
        why: '계획은 그대로 두고, 새로 추정한 소비 칼로리에 맞춰 목표만 고쳐요.',
        action: '새 목표로 바꾸기',
      }
    case 'keep':
      return {
        title: '이번 주는 그대로',
        why: '아무것도 바꾸지 않고 지금 목표로 한 주 더 가요.',
        action: '이대로 유지하기',
      }
  }
}

export default function Checkin() {
  const profile = useStore((s) => s.profile)
  const weights = useStore((s) => s.weights)
  const meals = useStore((s) => s.meals)
  const checkins = useStore((s) => s.checkins)
  const applyCheckinOption = useStore((s) => s.applyCheckinOption)
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const [pickedId, setPickedId] = useState<CheckinOptionId | null>(null)

  const asOf = today()
  const review = useMemo(
    () => (profile ? buildCheckinReview({ profile, weights, meals, checkins, asOf }) : null),
    [profile, weights, meals, checkins, asOf],
  )
  const last = useMemo(() => latestCheckin(checkins), [checkins])
  const due = useMemo(() => isCheckinDue(checkins, asOf), [checkins, asOf])

  if (!review || !last) {
    return (
      <main className="page">
        <h1 className="page-title">주간 체크인</h1>
        <p>아직 체크인할 계획이 없어요. 먼저 기본 정보를 입력해 주세요.</p>
        <Link to="/" className="btn btn--primary btn--block btn--lg">
          홈으로 가기
        </Link>
      </main>
    )
  }

  const { previous, estimate, trendKg, trendChangeKg, recent, options } = review
  const selected = options.find((o) => o.id === pickedId) ?? options[0]
  const onlyKeep = options.length === 1
  const daysSince = diffDays(last.date, asOf)
  const insufficient = estimate.basis === 'insufficient'
  const tdeeDiff = estimate.tdee - previous.tdee
  const sinceLabel = last.kind === 'initial' ? '시작할 때보다' : '지난 체크인보다'

  const confirm = async () => {
    if (saving) return
    setSaving(true)
    setError(false)
    try {
      await applyCheckinOption(asOf, trendKg, selected)
      navigate('/')
    } catch {
      setError(true)
      setSaving(false)
    }
  }

  return (
    <main className="page checkin-page">
      <header className="checkin-head">
        <h1 className="page-title">주간 체크인</h1>
        <p className="muted">지난 한 주를 돌아보고, 다음 한 주를 어떻게 갈지 한 가지만 정해요.</p>
      </header>

      {!due && (
        <p className="banner checkin-note" role="note">
          {daysSince <= 0 ? (
            <>오늘 이미 계획을 정했어요. 체크인은 일주일에 한 번을 권하지만, 지금 다시 해도 괜찮아요.</>
          ) : (
            <>
              마지막 체크인이 <span className="num">{daysSince}</span>일 전이에요. 일주일에 한 번을 권하지만, 지금 해도
              괜찮아요.
            </>
          )}
        </p>
      )}

      <section className="panel checkin-hero" aria-labelledby="checkin-summary-title">
        <h2 className="card-title" id="checkin-summary-title">
          지금 추세 체중
        </h2>
        {trendKg !== null ? (
          <>
            <p className="big-num">
              <span data-testid="checkin-trend">{trendKg.toFixed(1)}</span>
              <span className="checkin-unit">kg</span>
            </p>
            {trendChangeKg !== null && (
              <p className="checkin-hero-change" data-testid="checkin-change">
                {Number(Math.abs(trendChangeKg).toFixed(1)) === 0 ? (
                  `${sinceLabel} 거의 그대로예요`
                ) : (
                  <>
                    {sinceLabel} <span className="num">{signed(trendChangeKg, 1)}</span> kg
                  </>
                )}
              </p>
            )}
          </>
        ) : (
          <p className="checkin-hero-change">아직 체중 기록이 없어요.</p>
        )}
        <dl className="checkin-hero-facts">
          <div>
            <dt>최근 7일 평균 섭취</dt>
            <dd data-testid="checkin-recent">
              {recent.avgKcal !== null ? (
                <>
                  <span className="num">{kcal(recent.avgKcal)}</span> kcal · 기록{' '}
                  <span className="num">{recent.loggedDays}</span>일
                </>
              ) : (
                '식사 기록이 없어요'
              )}
            </dd>
          </div>
          <div>
            <dt>지금 단계</dt>
            <dd data-testid="checkin-phase">
              {review.phase === 'lose' ? (
                <>
                  감량 <span className="num">{review.weekOfPhase}</span>주차
                </>
              ) : (
                '유지 기간'
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className="card" aria-labelledby="checkin-tdee-title">
        <h2 className="card-title" id="checkin-tdee-title">
          추정 소비 칼로리
        </h2>
        <p className="checkin-change">
          <span className="num muted">{kcal(previous.tdee)}</span>
          <span className="checkin-arrow" aria-hidden="true">
            →
          </span>
          <span className="checkin-sr">에서</span>
          <span className="num checkin-new">{kcal(estimate.tdee)}</span>
          <span className="muted checkin-change-unit">kcal</span>
        </p>
        <p className="small muted num">
          {insufficient ? '이전 추정치 그대로' : tdeeDiff === 0 ? '변화 없음' : signedKcal(tdeeDiff)}
        </p>

        {insufficient ? (
          <div className="checkin-explain">
            <p>기록이 아직 부족해서 이전 추정치를 그대로 둘게요.</p>
            <p className="small muted">
              최근 <span className="num">{WINDOW_DAYS}</span>일 동안 아래만큼 기록이 쌓이면 실제 소비 칼로리를 계산할 수
              있어요.
            </p>
            <ul className="list checkin-needs small">
              <li>
                <span>
                  식사 기록 <span className="num">{MIN_LOGGED_DAYS}</span>일 이상
                </span>
                <span className="num muted">지금 {estimate.loggedDays}일</span>
              </li>
              <li>
                <span>
                  체중 기록 <span className="num">{MIN_WEIGH_INS}</span>회 이상
                </span>
                <span className="num muted">지금 {estimate.weighIns}회</span>
              </li>
              <li>
                <span>
                  첫 체중 기록과 마지막 기록 사이 <span className="num">{MIN_SPAN_DAYS}</span>일 이상
                </span>
              </li>
            </ul>
          </div>
        ) : (
          <p className="small muted checkin-explain">
            최근 <span className="num">{WINDOW_DAYS}</span>일의 평균 섭취량과 추세 체중 변화로 계산했어요. 값이 갑자기
            바뀌지 않도록 새 계산 결과는 한 번에 <span className="num">{Math.round(BLEND * 100)}</span>%만 반영해요.
          </p>
        )}
      </section>

      {review.tooFast && (
        <p className="banner banner--warn checkin-note" role="note" data-testid="checkin-too-fast">
          요즘 체중이 한 주에 체중의 1%보다 빠르게 줄고 있어요.{' '}
          {options[0].targetKcal > previous.targetKcal
            ? '그래서 새 목표를 조금 더 높게 잡았어요. 조금 더 먹어도 괜찮아요.'
            : '조금 더 먹어도 괜찮아요. 천천히 빼야 오래 가요.'}
        </p>
      )}

      <section className="card" aria-labelledby="checkin-choice-title">
        <h2 className="card-title" id="checkin-choice-title">
          다음 한 주
        </h2>
        {onlyKeep ? (
          <p data-testid="checkin-nochange">
            달라질 게 없어요. 지금 목표{' '}
            <span className="num">
              {kcal(targetRange(previous.targetKcal).low)}~{kcal(targetRange(previous.targetKcal).high)}
            </span>{' '}
            kcal 그대로 한 주 더 가요.
          </p>
        ) : (
          <div className="checkin-options" role="radiogroup" aria-labelledby="checkin-choice-title">
            {options.map((o) => {
              const copy = optionCopy(o, review)
              const range = targetRange(o.targetKcal)
              const diff = o.targetKcal - previous.targetKcal
              const isSelected = o.id === selected.id
              return (
                <label
                  key={o.id}
                  className={`checkin-option${isSelected ? ' is-selected' : ''}`}
                  data-testid={`option-${o.id}`}
                >
                  <input
                    type="radio"
                    name="checkin-option"
                    value={o.id}
                    checked={isSelected}
                    disabled={saving}
                    onChange={() => setPickedId(o.id)}
                  />
                  <span className="checkin-option-mark" aria-hidden="true" />
                  <span className="checkin-option-body">
                    <span className="checkin-option-head">
                      <span className="checkin-option-title">{copy.title}</span>
                      {o.recommended && <span className="chip chip--accent">추천</span>}
                    </span>
                    <span className="checkin-option-target">
                      <span className="num" data-testid={`option-${o.id}-range`}>
                        {kcal(range.low)}~{kcal(range.high)} kcal
                      </span>
                      <span className="small muted num">
                        {diff === 0 ? '지금 목표와 같아요' : `지금보다 ${signedKcal(diff)}`}
                      </span>
                    </span>
                    <span className="small muted checkin-option-why">{copy.why}</span>
                  </span>
                </label>
              )
            })}
          </div>
        )}
      </section>

      {error && (
        <p className="banner banner--danger" role="alert">
          저장하지 못했어요. 잠시 뒤에 다시 시도해 주세요.
        </p>
      )}

      <div className="stack">
        <button
          type="button"
          className="btn btn--primary btn--block btn--lg"
          disabled={saving}
          onClick={() => void confirm()}
          data-testid="checkin-confirm"
        >
          {onlyKeep ? '확인' : optionCopy(selected, review).action}
        </button>
        <p className="small muted checkin-actions-note">
          {onlyKeep
            ? '확인하면 체크인이 기록되고, 다음 체크인은 일주일 뒤예요.'
            : '어느 쪽을 골라도 체크인이 기록되고, 다음 체크인은 일주일 뒤예요.'}
        </p>
      </div>
    </main>
  )
}
