import { useEffect, useMemo, useRef, useState } from 'react'
import ProfileForm, {
  SECTION_FIELDS,
  draftToProfileFields,
  emptyDraft,
  parseNum,
  validateDraft,
  type ProfileDraft,
  type ProfileSection,
} from '../components/ProfileForm'
import { parseDate, today } from '../lib/date'
import { buildInitialCheckin } from '../lib/plan'
import { KCAL_PER_KG, computeTarget, projectGoalDate } from '../lib/tdee'
import { useStore } from '../store'
import type { Profile } from '../types'
import './Onboarding.css'

const STEPS = ['welcome', 'body', 'activity', 'goal', 'result'] as const
type Step = (typeof STEPS)[number]

const TITLES: Record<Step, string> = {
  welcome: '추세 다이어트',
  body: '몸 정보를 알려 주세요',
  activity: '평소에 얼마나 움직이나요?',
  goal: '목표를 정해 주세요',
  result: '이렇게 시작해요',
}

const FORM_STEPS: Partial<Record<Step, ProfileSection>> = {
  body: 'body',
  activity: 'activity',
  goal: 'goal',
}

const kcal = (n: number) => n.toLocaleString('ko-KR')

function formatFullDate(s: string): string {
  const d = parseDate(s)
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
}

function buildProfile(draft: ProfileDraft): Profile {
  return {
    ...draftToProfileFields(draft),
    startWeightKg: parseNum(draft.weightKg),
    createdAt: new Date().toISOString(),
  }
}

export default function Onboarding() {
  const [stepIndex, setStepIndex] = useState(0)
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft)
  const [attempted, setAttempted] = useState<Partial<Record<Step, boolean>>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)

  const step = STEPS[stepIndex]
  const section = FORM_STEPS[step]
  const date = today()
  const errors = useMemo(
    () => validateDraft(draft, { year: parseDate(date).getFullYear() }),
    [draft, date],
  )

  // 단계가 바뀌면 화면 맨 위로 올리고, 화면 낭독기가 새 제목을 읽도록 초점을 옮긴다.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    window.scrollTo?.(0, 0)
    titleRef.current?.focus()
  }, [stepIndex])

  const goNext = () => {
    if (section) {
      const hasError = SECTION_FIELDS[section].some((f) => errors[f])
      if (hasError) {
        setAttempted((a) => ({ ...a, [step]: true }))
        return
      }
    }
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))
  }

  const goBack = () => {
    setSaveError(null)
    setStepIndex((i) => Math.max(i - 1, 0))
  }

  const confirm = async () => {
    if (Object.keys(errors).length > 0) return
    setSaving(true)
    setSaveError(null)
    try {
      await useStore.getState().completeOnboarding(buildProfile(draft))
      // 저장되면 App이 메인 화면으로 바꾸므로 여기서 더 할 일은 없다.
    } catch {
      setSaveError('저장하지 못했어요. 잠시 뒤에 다시 시도해 주세요.')
      setSaving(false)
    }
  }

  return (
    <main className="page page--no-tabbar ob">
      <header className="ob-header">
        <div
          className="ob-progress"
          role="progressbar"
          aria-label="설정 진행 단계"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={stepIndex + 1}
          aria-valuetext={`${STEPS.length}단계 중 ${stepIndex + 1}단계`}
        >
          {STEPS.map((s, i) => (
            <span key={s} className={i <= stepIndex ? 'ob-dot ob-dot--on' : 'ob-dot'} />
          ))}
        </div>
        <h1 className="page-title ob-title" ref={titleRef} tabIndex={-1}>
          {TITLES[step]}
        </h1>
      </header>

      {step === 'welcome' && (
        <section className="stack ob-body">
          <p className="ob-lead">
            매일 체중과 먹은 칼로리를 기록하면, 들쭉날쭉한 체중을 추세선으로 다듬어 보여 주고 내 몸이
            실제로 쓰는 칼로리를 계산해 매주 알맞은 목표 칼로리를 알려 줘요.
          </p>
          <p className="banner">기록은 이 기기에만 저장돼요. 가입이나 로그인은 필요 없어요.</p>
          <p className="muted small">시작하기 전에 몇 가지만 여쭤볼게요. 1분이면 끝나요.</p>
        </section>
      )}

      {section && (
        <section className="ob-body">
          {step === 'body' && (
            <p className="muted ob-desc">하루에 쓰는 칼로리를 어림하는 데 사용해요.</p>
          )}
          {step === 'activity' && (
            <p className="muted ob-desc">
              가장 가까운 것을 하나 골라 주세요. 기록이 쌓이면 실제 값으로 맞춰 가니 정확하지 않아도
              괜찮아요.
            </p>
          )}
          {step === 'goal' && (
            <p className="muted ob-desc">현재 체중은 {draft.weightKg.trim()}kg이에요.</p>
          )}
          <ProfileForm
            key={step}
            draft={draft}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            errors={errors}
            showAllErrors={attempted[step] === true}
            sections={[section]}
            idPrefix="ob"
          />
        </section>
      )}

      {step === 'result' && <Result draft={draft} date={date} valid={Object.keys(errors).length === 0} />}

      {saveError && (
        <p className="banner banner--danger" role="alert">
          {saveError}
        </p>
      )}

      <footer className="ob-actions">
        {stepIndex > 0 && (
          <button type="button" className="btn" onClick={goBack} disabled={saving}>
            이전
          </button>
        )}
        {step === 'result' ? (
          <button
            type="button"
            className="btn btn--primary ob-next"
            onClick={() => void confirm()}
            disabled={saving || Object.keys(errors).length > 0}
          >
            {saving ? '저장하는 중…' : '이 계획으로 시작하기'}
          </button>
        ) : (
          <button type="button" className="btn btn--primary ob-next" onClick={goNext}>
            {step === 'welcome' ? '시작하기' : '다음'}
          </button>
        )}
      </footer>
    </main>
  )
}

function Result({ draft, date, valid }: { draft: ProfileDraft; date: string; valid: boolean }) {
  if (!valid) {
    return (
      <p className="banner banner--warn" role="alert">
        입력한 값에 확인할 부분이 있어요. 이전 단계로 돌아가 고쳐 주세요.
      </p>
    )
  }

  const profile = buildProfile(draft)
  const checkin = buildInitialCheckin(profile, date)
  const target = computeTarget({
    tdee: checkin.estimatedTdee,
    weeklyLossKg: profile.weeklyLossKg,
    sex: profile.sex,
    weightKg: profile.startWeightKg,
  })
  const losing = profile.weeklyLossKg > 0
  // 하한에 걸리면 실제 감량 속도가 달라지므로 실제 적자 기준으로 다시 계산한다.
  const effectiveWeeklyLoss = target.flooredAtMin
    ? Math.max(0, ((checkin.estimatedTdee - checkin.targetKcal) * 7) / KCAL_PER_KG)
    : target.appliedWeeklyLossKg
  const goalDate =
    losing && profile.startWeightKg > profile.goalWeightKg && effectiveWeeklyLoss > 0
      ? projectGoalDate({
          trendKg: profile.startWeightKg,
          goalKg: profile.goalWeightKg,
          weeklyLossKg: effectiveWeeklyLoss,
          from: date,
        })
      : null
  const appliedLabel = `${Math.round(target.appliedWeeklyLossKg * 100) / 100}kg`

  return (
    <section className="stack ob-body">
      <div className="card ob-result">
        <p className="card-title">하루 목표 칼로리</p>
        <p className="big-num" data-testid="target-kcal">
          {kcal(checkin.targetKcal)}
          <span className="ob-unit">kcal</span>
        </p>
        <p className="muted small">
          {losing
            ? '하루에 이만큼 먹으면 목표한 속도로 빠질 것으로 예상해요.'
            : '체중 유지가 목표라서 쓰는 만큼 먹는 계획이에요.'}
        </p>
      </div>

      <div className="card">
        <ul className="list">
          <li>
            <span className="muted">예상 하루 소비 칼로리</span>
            <strong className="num" data-testid="tdee-kcal">
              {kcal(checkin.estimatedTdee)}kcal
            </strong>
          </li>
          <li>
            <span className="muted">일주일에 뺄 체중</span>
            <strong className="num">{losing ? appliedLabel : '유지'}</strong>
          </li>
          {goalDate && (
            <li>
              <span className="muted">목표 체중 도달 예상</span>
              <strong className="num">{formatFullDate(goalDate)}쯤</strong>
            </li>
          )}
        </ul>
      </div>

      {target.lossCapped && (
        <p className="banner banner--warn">
          고른 속도가 체중에 비해 빨라서, 일주일에 체중의 1%({appliedLabel})까지만 빼도록 낮췄어요.
        </p>
      )}
      {target.flooredAtMin && (
        <p className="banner banner--warn">
          계산한 값이 너무 낮아서 목표를 안전한 최소 섭취량인 {kcal(checkin.targetKcal)}kcal로
          맞췄어요. 그래서 고른 속도보다 천천히 빠질 수 있어요.
        </p>
      )}

      <p className="muted small">
        키, 체중, 나이, 활동량으로 계산한 추정치이며 의학적 조언이 아니에요. 기록이 쌓이면 매주 실제
        변화에 맞춰 다시 계산해요.
      </p>
    </section>
  )
}
