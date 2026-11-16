import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { diffDays, today } from '../lib/date'
import { buildCheckinProposal } from '../lib/plan'
import { isCheckinDue, latestCheckin } from '../lib/selectors'
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
  if (r === 0) return '변화 없음'
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toLocaleString('ko-KR')}kcal`
}

export default function Checkin() {
  const profile = useStore((s) => s.profile)
  const weights = useStore((s) => s.weights)
  const meals = useStore((s) => s.meals)
  const checkins = useStore((s) => s.checkins)
  const saveCheckin = useStore((s) => s.saveCheckin)
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  const asOf = today()
  const proposal = useMemo(
    () => (profile ? buildCheckinProposal({ profile, weights, meals, checkins, asOf }) : null),
    [profile, weights, meals, checkins, asOf],
  )
  const last = useMemo(() => latestCheckin(checkins), [checkins])

  if (!proposal || !last) {
    return (
      <main className="page">
        <h1 className="page-title">주간 체크인</h1>
        <div className="card stack">
          <p>아직 체크인할 계획이 없어요. 먼저 기본 정보를 입력해 주세요.</p>
          <Link to="/" className="btn btn--primary btn--block checkin-link">
            홈으로 가기
          </Link>
        </div>
      </main>
    )
  }

  const { previous, estimate, target, trendKg, trendChangeKg } = proposal
  const due = isCheckinDue(checkins, asOf)
  const daysSince = diffDays(last.date, asOf)
  const insufficient = estimate.basis === 'insufficient'
  const tdeeDiff = estimate.tdee - previous.tdee
  const targetDiff = target.targetKcal - previous.targetKcal
  const sameTarget = targetDiff === 0
  const sinceLabel = last.kind === 'initial' ? '시작한 뒤로' : '지난 체크인 뒤로'

  const save = async (plan: { estimatedTdee: number; targetKcal: number }) => {
    if (saving) return
    setSaving(true)
    setError(false)
    try {
      await saveCheckin({ date: asOf, trendKg, ...plan })
      navigate('/')
    } catch {
      setError(true)
      setSaving(false)
    }
  }
  const accept = () => save({ estimatedTdee: estimate.tdee, targetKcal: target.targetKcal })
  const keep = () => save({ estimatedTdee: previous.tdee, targetKcal: previous.targetKcal })

  return (
    <main className="page checkin-page">
      <h1 className="page-title">주간 체크인</h1>
      <p className="muted">
        지난 기록으로 실제 소비 칼로리를 다시 추정하고, 그에 맞춰 하루 목표 칼로리를 조정해요.
      </p>

      {!due && (
        <p className="banner checkin-note" role="note">
          {daysSince <= 0 ? (
            <>오늘 이미 계획을 정했어요. 체크인은 일주일에 한 번을 권장하지만, 지금 다시 해도 괜찮아요.</>
          ) : (
            <>
              마지막 체크인이 <span className="num">{daysSince}</span>일 전이에요. 일주일에 한 번을 권장하지만, 지금 해도
              괜찮아요.
            </>
          )}
        </p>
      )}

      <section className="card" aria-labelledby="checkin-summary-title">
        <h2 className="card-title" id="checkin-summary-title">
          지난 기간 요약
        </h2>
        <ul className="list checkin-stats">
          <li>
            <span className="muted">추세 체중</span>
            {trendKg !== null ? (
              <span className="checkin-value">
                <span className="num">{trendKg.toFixed(1)}</span>kg
              </span>
            ) : (
              <span className="muted small">체중 기록이 없어요</span>
            )}
          </li>
          {trendChangeKg !== null && (
            <li>
              <span className="muted">{sinceLabel} 변화</span>
              <span className="checkin-value">
                <span className="num">{signed(trendChangeKg, 2)}</span>kg
              </span>
            </li>
          )}
          <li>
            <span className="muted">
              하루 평균 섭취
              {estimate.avgIntake !== null && (
                <span className="small checkin-sub">
                  기록한 <span className="num">{estimate.loggedDays}</span>일 기준
                </span>
              )}
            </span>
            {estimate.avgIntake !== null ? (
              <span className="checkin-value">
                <span className="num">{kcal(estimate.avgIntake)}</span>kcal
              </span>
            ) : (
              <span className="muted small">식사 기록이 없어요</span>
            )}
          </li>
          <li>
            <span className="muted">체중 기록</span>
            <span className="checkin-value">
              <span className="num">{estimate.weighIns}</span>회
            </span>
          </li>
        </ul>
        <p className="small muted checkin-foot">
          섭취량과 체중 기록 횟수는 최근 <span className="num">{WINDOW_DAYS}</span>일 기준이에요.
        </p>
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
          <span className="visually-hidden">에서</span>
          <span className="num checkin-new">{kcal(estimate.tdee)}</span>
          <span className="muted">kcal</span>
        </p>
        <p className="small muted num">{insufficient ? '이전 추정치 유지' : signedKcal(tdeeDiff)}</p>

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

      <section className="card" aria-labelledby="checkin-target-title">
        <h2 className="card-title" id="checkin-target-title">
          새 목표
        </h2>
        <p className="small muted">
          지금 목표 <span className="num">{kcal(previous.targetKcal)}</span>kcal
        </p>
        <p className="big-num checkin-hero">
          <span data-testid="checkin-target">{kcal(target.targetKcal)}</span>
          <span className="checkin-unit">kcal</span>
        </p>
        <p className="small muted num">{sameTarget ? '지금 목표와 같아요' : `지금보다 ${signedKcal(targetDiff)}`}</p>
        {target.lossCapped && (
          <p className="small checkin-explain">
            너무 빠른 감량은 몸에 무리가 될 수 있어서, 감량 속도를 체중의 1%/주(주{' '}
            <span className="num">{target.appliedWeeklyLossKg.toFixed(2)}</span>kg)로 낮췄어요.
          </p>
        )}
        {target.flooredAtMin && (
          <p className="small checkin-explain">
            계산한 값이 너무 낮아서 안전 하한선에 맞췄어요. 이보다 적게 먹는 건 권하지 않아요.
          </p>
        )}
      </section>

      {error && (
        <p className="banner banner--danger" role="alert">
          저장하지 못했어요. 잠시 뒤에 다시 시도해 주세요.
        </p>
      )}

      <div className="stack">
        {sameTarget ? (
          <button type="button" className="btn btn--primary btn--block" disabled={saving} onClick={accept}>
            확인
          </button>
        ) : (
          <>
            <button type="button" className="btn btn--primary btn--block" disabled={saving} onClick={accept}>
              새 목표로 바꾸기
            </button>
            <button type="button" className="btn btn--block" disabled={saving} onClick={keep}>
              지금 목표 유지하기
            </button>
          </>
        )}
        <p className="small muted checkin-actions-note">
          {sameTarget
            ? '확인하면 체크인이 기록되고, 다음 체크인은 일주일 뒤예요.'
            : '어느 쪽을 골라도 체크인이 기록되고, 다음 체크인은 일주일 뒤예요.'}
        </p>
      </div>
    </main>
  )
}
