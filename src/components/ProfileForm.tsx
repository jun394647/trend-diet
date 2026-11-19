import { useState } from 'react'
import {
  ACTIVITY_OPTIONS,
  PACE_OPTIONS,
  dailyDeficit,
  type ProfileDraft,
  type ProfileErrors,
  type ProfileField,
  type ProfileSection,
} from './profileFormModel'
import './ProfileForm.css'

/**
 * 속도 고르기. 온보딩과 설정이 같은 줄을 쓴다.
 * 줄마다 진짜 라디오 버튼이 들어 있어서 방향키로 옮겨 다닐 수 있다.
 */
function PaceField({
  name,
  value,
  onChange,
}: {
  name: string
  value: number
  onChange: (weeklyLossKg: number) => void
}) {
  const deficit = dailyDeficit(value)
  return (
    <fieldset className="pf-fieldset">
      <legend className="label">감량 속도</legend>
      <div className="pf-options">
        {PACE_OPTIONS.map((o) => {
          const rate = o.value > 0 ? `${o.value} kg/주` : null
          const hintId = `${name}-${o.value}-hint`
          return (
            <label key={o.value} className="pf-pace">
              <input
                type="radio"
                className="pf-pace-input"
                name={name}
                checked={value === o.value}
                onChange={() => onChange(o.value)}
                aria-label={rate ? `${o.label}, 일주일에 ${o.value}kg` : o.label}
                aria-describedby={hintId}
              />
              <span className="pf-pace-row">
                <span className="pf-pace-mark" aria-hidden="true" />
                <span className="pf-pace-text">
                  <span className="pf-pace-head">
                    <span className="pf-option-label">{o.label}</span>
                    {rate && <span className="pf-pace-rate num">{rate}</span>}
                    {o.recommended && <span className="chip chip--accent pf-pace-chip">추천</span>}
                  </span>
                  <span className="pf-option-hint" id={hintId}>
                    {o.hint}
                  </span>
                </span>
              </span>
            </label>
          )
        })}
      </div>
      <p className="small muted pf-pace-note" data-testid="pace-deficit" aria-live="polite">
        {value > 0 ? (
          <>
            하루에 쓰는 양보다 약 <b className="num">{deficit.toLocaleString('ko-KR')}</b>kcal 적게 먹는
            계획이에요.
          </>
        ) : (
          '하루에 쓰는 만큼 먹어서 체중을 그대로 두는 계획이에요.'
        )}
      </p>
    </fieldset>
  )
}

interface Props {
  draft: ProfileDraft
  onChange: (patch: Partial<ProfileDraft>) => void
  /** validateDraft 결과 전체. 어떤 오류를 보여 줄지는 이 컴포넌트가 정한다. */
  errors: ProfileErrors
  /** true면 아직 건드리지 않은 칸의 오류도 보여 준다(다음/저장을 누른 뒤). */
  showAllErrors?: boolean
  /** 보여 줄 묶음. 기본은 전부. */
  sections?: ProfileSection[]
  /** 현재 체중 칸을 숨긴다(설정 화면). */
  hideWeight?: boolean
  /** 한 화면에 폼이 여러 개일 때 id가 겹치지 않게 한다. */
  idPrefix?: string
}

const ALL_SECTIONS: ProfileSection[] = ['body', 'activity', 'goal']

export default function ProfileForm({
  draft,
  onChange,
  errors,
  showAllErrors = false,
  sections = ALL_SECTIONS,
  hideWeight = false,
  idPrefix = 'pf',
}: Props) {
  const [touched, setTouched] = useState<Partial<Record<ProfileField, boolean>>>({})
  const touch = (f: ProfileField) => setTouched((t) => (t[f] ? t : { ...t, [f]: true }))
  const errorOf = (f: ProfileField) => (showAllErrors || touched[f] ? errors[f] : undefined)
  const id = (name: string) => `${idPrefix}-${name}`

  const numberField = (opts: {
    field: 'birthYear' | 'heightCm' | 'weightKg' | 'goalWeightKg'
    label: string
    unit: string
    inputMode: 'numeric' | 'decimal'
    placeholder: string
    maxLength: number
  }) => {
    const err = errorOf(opts.field)
    return (
      <div className="field">
        <label htmlFor={id(opts.field)}>{opts.label}</label>
        <div className="pf-input-wrap">
          <input
            id={id(opts.field)}
            className="input"
            type="text"
            inputMode={opts.inputMode}
            autoComplete="off"
            maxLength={opts.maxLength}
            placeholder={opts.placeholder}
            value={draft[opts.field]}
            onChange={(ev) => onChange({ [opts.field]: ev.target.value })}
            onBlur={() => touch(opts.field)}
            aria-invalid={err ? true : undefined}
            aria-describedby={err ? id(`${opts.field}-error`) : undefined}
          />
          <span className="pf-unit" aria-hidden="true">
            {opts.unit}
          </span>
        </div>
        {err && (
          <p className="field-error" id={id(`${opts.field}-error`)} role="alert">
            {err}
          </p>
        )}
      </div>
    )
  }

  const sexError = errorOf('sex')

  return (
    <div className="stack pf">
      {sections.includes('body') && (
        <>
          <div className="field" role="group" aria-labelledby={id('sex-label')}>
            <span className="label" id={id('sex-label')}>
              성별
            </span>
            <div className="segmented">
              {(
                [
                  ['M', '남성'],
                  ['F', '여성'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={draft.sex === value}
                  onClick={() => onChange({ sex: value })}
                >
                  {label}
                </button>
              ))}
            </div>
            {sexError && (
              <p className="field-error" role="alert">
                {sexError}
              </p>
            )}
          </div>
          {numberField({
            field: 'birthYear',
            label: '태어난 해',
            unit: '년',
            inputMode: 'numeric',
            placeholder: '예: 1990',
            maxLength: 4,
          })}
          {numberField({
            field: 'heightCm',
            label: '키',
            unit: 'cm',
            inputMode: 'decimal',
            placeholder: '예: 170',
            maxLength: 5,
          })}
          {!hideWeight &&
            numberField({
              field: 'weightKg',
              label: '현재 체중',
              unit: 'kg',
              inputMode: 'decimal',
              placeholder: '예: 72.5',
              maxLength: 5,
            })}
        </>
      )}

      {sections.includes('activity') && (
        <div className="field" role="group" aria-labelledby={id('activity-label')}>
          <span className="label" id={id('activity-label')}>
            평소 활동량
          </span>
          <div className="pf-options">
            {ACTIVITY_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className="pf-option"
                aria-pressed={draft.activityFactor === o.value}
                onClick={() => onChange({ activityFactor: o.value })}
              >
                <span className="pf-option-label">{o.label}</span>
                <span className="pf-option-hint">{o.hint}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {sections.includes('goal') && (
        <>
          {numberField({
            field: 'goalWeightKg',
            label: '목표 체중',
            unit: 'kg',
            inputMode: 'decimal',
            placeholder: '예: 65',
            maxLength: 5,
          })}
          <PaceField
            name={id('pace')}
            value={draft.weeklyLossKg}
            onChange={(weeklyLossKg) => {
              onChange({ weeklyLossKg })
              // 속도를 바꾸면 목표 체중 오류가 생기거나 사라질 수 있어 바로 보여 준다.
              if (draft.goalWeightKg.trim() !== '') touch('goalWeightKg')
            }}
          />
        </>
      )}
    </div>
  )
}
