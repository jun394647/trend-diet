import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import type { AiRequest } from '../ai/contract'
import { ImageError, prepareImage } from '../ai/image'
import { useAiAvailability } from '../ai/useAiAvailability'
import { useAiCall } from '../ai/useAiCall'
import { formatKorean } from '../lib/date'
import { loadFoodDb, type FoodDb } from '../lib/foodDb'
import { kcalFor, searchFoods, type IndexedFood } from '../lib/foodSearch'
import { MAX_ENTRY_KCAL, mySuggestions, parseEntry, previousDayMeals, type Suggestion } from '../lib/quickAdd'
import { ROUGH_PORTIONS, roughKcal } from '../lib/selectors'
import type { RoughSize } from '../lib/selectors'
import { useStore } from '../store'
import type { DateStr, MealSource } from '../types'
import { AiLoginHint, AiTag } from './ai/AiBits'
import MealAiReview, { type MealAiLogItem, type MealAiSource } from './ai/MealAiReview'
import FoodAmount, { fmtAmount } from './FoodAmount'
import { fmtKcal } from './today/format'
import { TrashIcon } from './today/icons'
import './today/shared.css'
import './MealSheet.css'

const ROUGH_SIZES: RoughSize[] = ['small', 'medium', 'large']

type MealAiRequest = Extract<AiRequest, { task: 'meal-text' | 'meal-photo' }>
/** AI에 보내는 글의 최대 길이. 서버가 받는 한도(500자)보다 짧게 둔다. */
const AI_TEXT_MAX = 200
// TODO: MealSource에 'ai'가 들어가면 이 변환은 지운다.
const AI_SOURCE: MealSource = 'ai'

function CameraIcon() {
  return (
    <svg
      className="meal-ai-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}

interface Props {
  date: DateStr
  targetKcal: number
  onClose: () => void
}

type DbState = { status: 'idle' | 'loading' | 'error' } | { status: 'ready'; db: FoodDb }

function servingLabel(f: IndexedFood): string {
  return f.servingSize !== null
    ? `1회 ${fmtAmount(f.servingSize)}${f.unit} · ${fmtKcal(kcalFor(f, f.servingSize))} kcal`
    : `100${f.unit}당 ${fmtKcal(f.kcalPer100)} kcal`
}

/**
 * 식사 추가 시트. 입력 칸 하나로 모든 방식을 처리한다.
 *  - '550' 또는 '김치찌개 550': 바로 기록
 *  - '김치찌개': 전에 먹은 것과 음식 DB에서 찾기
 *  - 비워 두면: 자주 먹는 것, 어제처럼, 대충 기록
 * AI를 쓸 수 있으면 여기에 두 가지가 더해진다: 말로 적은 식사를 계산하기, 사진으로 기록하기.
 */
export default function MealSheet({ date, targetKcal, onClose }: Props) {
  const meals = useStore((s) => s.meals)
  const favorites = useStore((s) => s.favorites)
  const addMeal = useStore((s) => s.addMeal)
  const removeFavorite = useStore((s) => s.removeFavorite)
  const logFavorite = useStore((s) => s.logFavorite)

  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<IndexedFood | null>(null)
  const [dbState, setDbState] = useState<DbState>({ status: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const availability = useAiAvailability()
  const aiCall = useAiCall<MealAiRequest>()
  const [aiSource, setAiSource] = useState<MealAiSource | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const previewUrlRef = useRef<string | null>(null)
  const refocusInput = useRef(false)

  const sheetRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // 열릴 때 포커스를 입력 칸으로 옮기고, 닫히면 원래 자리로 돌려준다.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (inputRef.current) inputRef.current.focus()
    else sheetRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      opener?.focus()
    }
  }, [])

  const entry = useMemo(() => parseEntry(query), [query])
  const deferredQuery = useDeferredValue(query)
  const searchText = entry.kind === 'text' ? entry.text : entry.kind === 'named' ? entry.name : ''

  // 음식 DB는 이름을 처음 적을 때 불러온다.
  const wantsDb = searchText !== ''
  const [dbAttempt, setDbAttempt] = useState(0)
  const dbRequested = useRef(-1)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      releasePreview()
    }
  }, [])

  // AI 단계에서 돌아오면 입력 칸에서 바로 이어 적을 수 있게 한다.
  useEffect(() => {
    if (aiSource === null && refocusInput.current) {
      refocusInput.current = false
      inputRef.current?.focus()
    }
  }, [aiSource])
  useEffect(() => {
    // 같은 시도를 두 번 시작하지 않는다. 상태가 바뀌어도 진행 중인 요청은 취소하지 않는다.
    if (!wantsDb || dbRequested.current === dbAttempt) return
    dbRequested.current = dbAttempt
    setDbState({ status: 'loading' })
    loadFoodDb().then(
      (db) => mounted.current && setDbState({ status: 'ready', db }),
      () => mounted.current && setDbState({ status: 'error' }),
    )
  }, [wantsDb, dbAttempt])

  const mine = useMemo(
    () => mySuggestions({ meals, favorites }, searchText, searchText === '' ? 8 : 5),
    [meals, favorites, searchText],
  )
  const dbResult = useMemo(() => {
    const parsed = parseEntry(deferredQuery)
    const text = parsed.kind === 'text' ? parsed.text : ''
    return dbState.status === 'ready' && text !== '' ? searchFoods(dbState.db.index, text, 20) : null
  }, [dbState, deferredQuery])
  const yesterday = useMemo(() => previousDayMeals(meals, date), [meals, date])
  const todayHasMeals = useMemo(() => meals.some((m) => m.date === date), [meals, date])

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
      onClose()
    } catch {
      setError('저장하지 못했어요. 다시 시도해 주세요.')
      setBusy(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (entry.kind === 'kcal') {
      void run(() => addMeal({ date, kcal: entry.kcal, source: 'exact' }))
    } else if (entry.kind === 'named') {
      void run(() => addMeal({ date, kcal: entry.kcal, name: entry.name, source: 'exact' }))
    } else if (entry.kind === 'text' && aiReady && !busy && !photoBusy) {
      const source: MealAiSource = { kind: 'text', text: entry.text.slice(0, AI_TEXT_MAX) }
      setError(null)
      setPhotoError(null)
      setAiSource(source)
      sendAi(source)
    }
  }

  function releasePreview() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
  }

  function sendAi(source: MealAiSource, note?: string) {
    void aiCall.run(
      source.kind === 'text'
        ? { task: 'meal-text', text: source.text }
        : { task: 'meal-photo', imageBase64: source.base64, mediaType: source.mediaType, ...(note ? { note } : {}) },
    )
  }

  /** AI 단계를 끝내고 입력 칸으로 돌아간다. 적어 둔 글은 그대로 둔다. */
  function closeAi() {
    aiCall.reset()
    releasePreview()
    refocusInput.current = true
    setError(null)
    setAiSource(null)
  }

  /** 기다리다 그만둔다. 글이면 입력 칸으로, 사진이면 보내기 전 단계로 돌아간다. */
  function cancelAi() {
    if (aiSource?.kind === 'photo') aiCall.reset()
    else closeAi()
  }

  async function onPhotoPicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // 같은 사진을 다시 골라도 change가 일어나게 비워 둔다.
    e.target.value = ''
    if (!file || photoBusy) return
    setPhotoBusy(true)
    setPhotoError(null)
    try {
      const image = await prepareImage(file)
      if (!mounted.current) {
        URL.revokeObjectURL(image.previewUrl)
        return
      }
      releasePreview()
      previewUrlRef.current = image.previewUrl
      setError(null)
      setAiSource({ kind: 'photo', ...image })
    } catch (err) {
      if (mounted.current) {
        setPhotoError(err instanceof ImageError ? err.message : '사진을 준비하지 못했어요. 다른 사진으로 해 주세요.')
      }
    } finally {
      if (mounted.current) setPhotoBusy(false)
    }
  }

  function logAiItems(items: MealAiLogItem[]) {
    void run(async () => {
      for (const item of items) await addMeal({ date, kcal: item.kcal, name: item.name, source: AI_SOURCE })
    })
  }

  function logSuggestion(s: Suggestion) {
    void run(() =>
      s.favoriteId ? logFavorite(s.favoriteId, date) : addMeal({ date, kcal: s.kcal, name: s.name, source: 'favorite' }),
    )
  }

  function logYesterday() {
    void run(async () => {
      for (const m of yesterday) await addMeal({ date, kcal: m.kcal, name: m.name, source: m.source })
    })
  }

  function onRough(size: RoughSize) {
    const { label } = ROUGH_PORTIONS[size]
    void run(() => addMeal({ date, kcal: roughKcal(size, targetKcal), name: `대충 입력 · ${label}`, source: 'rough' }))
  }

  async function onRemoveFavorite(id: string) {
    setError(null)
    try {
      await removeFavorite(id)
      setConfirmId(null)
    } catch {
      setError('삭제하지 못했어요. 다시 시도해 주세요.')
    }
  }

  const aiReady = availability === 'ready'
  const canSubmit = entry.kind === 'kcal' || entry.kind === 'named'
  const canAskAi = aiReady && entry.kind === 'text'
  const yesterdayKcal = yesterday.reduce((s, m) => s + m.kcal, 0)

  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={sheetRef} className="sheet meal-sheet" role="dialog" aria-modal="true" aria-label="식사 추가" tabIndex={-1}>
        <div className="meal-sheet-head">
          <div>
            <h2 className="meal-sheet-title">식사 추가</h2>
            <p className="small muted">{formatKorean(date)}</p>
          </div>
          <button type="button" className="btn btn--ghost meal-sheet-close" onClick={onClose}>
            닫기
          </button>
        </div>

        {aiSource ? (
          <MealAiReview
            source={aiSource}
            state={aiCall.state}
            busy={busy}
            onSend={(note) => sendAi(aiSource, note)}
            onCancel={cancelAi}
            onBack={closeAi}
            onLog={logAiItems}
          />
        ) : picked ? (
          <FoodAmount
            picked={picked}
            busy={busy}
            onBack={() => setPicked(null)}
            onLog={(meal) => void run(() => addMeal({ date, kcal: meal.kcal, name: meal.name, source: 'search' }))}
          />
        ) : (
          <>
            <form className="stack" onSubmit={onSubmit} noValidate>
              <div className="field">
                <label htmlFor="meal-entry">음식 이름이나 칼로리</label>
                <input
                  ref={inputRef}
                  id="meal-entry"
                  className="input"
                  autoComplete="off"
                  enterKeyHint={canSubmit ? 'done' : canAskAi ? 'go' : 'search'}
                  maxLength={aiReady ? AI_TEXT_MAX : 60}
                  placeholder="예: 550 · 김치찌개 550 · 김치찌개"
                  value={query}
                  aria-describedby="meal-entry-hint"
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setConfirmId(null)
                    setError(null)
                  }}
                />
              </div>

              {canSubmit && (
                <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy} data-testid="entry-submit">
                  {entry.kind === 'named' ? `${entry.name} · ` : ''}
                  {fmtKcal(entry.kcal)} kcal 기록하기
                </button>
              )}
              {canAskAi && (
                <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy || photoBusy}>
                  <span aria-hidden="true">
                    <AiTag />
                  </span>
                  AI로 칼로리 계산
                </button>
              )}

              <p className="small muted" id="meal-entry-hint">
                {entry.kind === 'empty' &&
                  (aiReady
                    ? '숫자만 적으면 칼로리로 기록해요. 먹은 것을 말하듯 적으면 AI가 칼로리를 계산해 줘요.'
                    : '숫자만 적으면 칼로리로 기록해요. 이름을 적으면 전에 먹은 것과 음식 목록에서 찾아요.')}
                {entry.kind === 'kcal' && '이름을 붙이려면 김치찌개 550처럼 이름을 앞에 적어 주세요.'}
                {entry.kind === 'named' && '한 번 기록하면 다음부터 자주 먹는 것에 떠요.'}
                {entry.kind === 'text' && '칼로리를 알면 이름 뒤에 숫자를 붙여 바로 기록할 수 있어요.'}
              </p>
              {entry.kind === 'invalid' && (
                <p className="field-error" role="alert">
                  한 번에 1~{fmtKcal(MAX_ENTRY_KCAL)} kcal까지 기록할 수 있어요.
                </p>
              )}
            </form>

            {availability === 'login' && <AiLoginHint what="AI로 칼로리 계산하기" />}
            {aiReady && (
              <div className="meal-ai-entry">
                <input
                  ref={fileRef}
                  className="meal-ai-file"
                  type="file"
                  accept="image/*"
                  tabIndex={-1}
                  aria-hidden="true"
                  data-testid="meal-photo-input"
                  onChange={(e) => void onPhotoPicked(e)}
                />
                <button
                  type="button"
                  className="btn btn--block"
                  disabled={busy}
                  onClick={() => {
                    if (!photoBusy) fileRef.current?.click()
                  }}
                >
                  <CameraIcon />
                  사진으로 기록
                </button>
                {photoBusy && (
                  <p className="small muted" role="status">
                    사진을 준비하는 중이에요
                  </p>
                )}
                {photoError && (
                  <p className="field-error" role="alert">
                    {photoError}
                  </p>
                )}
                <p className="small muted">적은 글이나 고른 사진은 칼로리를 어림잡는 데만 쓰려고 AI에 보내요.</p>
              </div>
            )}

            {mine.length > 0 && (
              <section aria-labelledby="mine-title">
                <h3 className="card-title" id="mine-title">
                  {searchText === '' ? '자주 먹는 것' : '전에 먹은 것'}
                </h3>
                <ul className="list fav-list">
                  {mine.map((s) =>
                    s.favoriteId !== null && confirmId === s.favoriteId ? (
                      <li key={`${s.name}|${s.kcal}`}>
                        <div className="fav-confirm">
                          <span className="fav-confirm-text">'{s.name}'을(를) 목록에서 지울까요?</span>
                          <div className="fav-confirm-actions">
                            <button type="button" className="btn" onClick={() => setConfirmId(null)}>
                              취소
                            </button>
                            <button
                              type="button"
                              className="btn btn--danger"
                              onClick={() => void onRemoveFavorite(s.favoriteId!)}
                            >
                              삭제
                            </button>
                          </div>
                        </div>
                      </li>
                    ) : (
                      <li key={`${s.name}|${s.kcal}`}>
                        <button
                          type="button"
                          className="fav-log"
                          disabled={busy}
                          aria-label={`${s.name} ${fmtKcal(s.kcal)} kcal 기록`}
                          onClick={() => logSuggestion(s)}
                        >
                          <span className="fav-name">{s.name}</span>
                          <span className="fav-kcal num">{fmtKcal(s.kcal)} kcal</span>
                        </button>
                        {/* 따로 저장해 둔 항목만 지울 수 있다. 먹은 기록에서 온 항목은 기록이 남아 있는 한 다시 뜬다. */}
                        {s.favoriteId !== null && !s.inHistory && (
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`${s.name} 목록에서 지우기`}
                            onClick={() => setConfirmId(s.favoriteId)}
                          >
                            <TrashIcon />
                          </button>
                        )}
                      </li>
                    ),
                  )}
                </ul>
              </section>
            )}

            {searchText !== '' && entry.kind === 'text' && (
              <section aria-labelledby="db-title">
                <h3 className="card-title" id="db-title">
                  음식 목록에서 찾기
                </h3>
                {dbState.status === 'loading' && <p className="muted">음식 목록을 불러오는 중이에요…</p>}
                {dbState.status === 'error' && (
                  <div className="stack">
                    <p className="field-error" role="alert">
                      음식 목록을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.
                    </p>
                    <button type="button" className="btn" onClick={() => setDbAttempt((n) => n + 1)}>
                      다시 불러오기
                    </button>
                  </div>
                )}
                {dbResult && dbResult.total === 0 && (
                  <p className="muted">
                    '{searchText}'에 맞는 음식이 없어요. 포장 가공식품은 들어 있지 않아요. 칼로리를 알면 이름 뒤에
                    숫자를 붙여 주세요.
                  </p>
                )}
                {dbResult && dbResult.items.length > 0 && (
                  <>
                    <ul className="list food-results" aria-label="검색 결과">
                      {dbResult.items.map((f, i) => (
                        <li key={`${f.name}|${f.tag}|${f.kcalPer100}|${f.servingSize}|${i}`}>
                          <button type="button" className="food-result" onClick={() => setPicked(f)}>
                            <span className="food-result-main">
                              <span className="food-result-name">{f.name}</span>
                              {f.tag && <span className="food-result-tag">{f.tag}</span>}
                            </span>
                            <span className="small muted num">{servingLabel(f)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <p className="small muted entry-source">
                      {dbResult.total > dbResult.items.length &&
                        `${dbResult.total.toLocaleString('ko-KR')}건 중 ${dbResult.items.length}건만 보여요. `}
                      출처: 식품의약품안전처 식품영양성분 데이터({dbState.status === 'ready' && dbState.db.updated} 기준).
                      조리법과 양에 따라 실제 값은 달라요.
                    </p>
                  </>
                )}
              </section>
            )}

            {entry.kind === 'empty' && (
              <>
                {yesterday.length > 0 && !todayHasMeals && (
                  <button type="button" className="btn btn--block" disabled={busy} onClick={logYesterday}>
                    전날 먹은 {yesterday.length}건 그대로 기록 · {fmtKcal(yesterdayKcal)} kcal
                  </button>
                )}
                <section aria-labelledby="rough-title">
                  <h3 className="card-title" id="rough-title">
                    잘 모르겠으면 대충
                  </h3>
                  <div className="rough-grid">
                    {ROUGH_SIZES.map((size) => (
                      <button
                        key={size}
                        type="button"
                        className="rough-btn"
                        disabled={busy || roughKcal(size, targetKcal) <= 0}
                        onClick={() => onRough(size)}
                      >
                        <span className="rough-label">{ROUGH_PORTIONS[size].label}</span>
                        <span className="rough-kcal num">{fmtKcal(roughKcal(size, targetKcal))} kcal</span>
                      </button>
                    ))}
                  </div>
                  <p className="small muted entry-source">
                    한 끼를 하루 목표의 일부로 어림잡아요. 정확하지 않아도 기록해 두는 편이 좋아요.
                  </p>
                </section>
              </>
            )}
          </>
        )}

        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
