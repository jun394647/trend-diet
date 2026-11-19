import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { ImageError, prepareImage } from '../ai/image'
import { useAiAvailability } from '../ai/useAiAvailability'
import { formatKorean } from '../lib/date'
import { loadFoodDb, type FoodDb } from '../lib/foodDb'
import { kcalFor, searchFoods, type IndexedFood } from '../lib/foodSearch'
import { MAX_ENTRY_KCAL, mySuggestions, parseEntry, previousDayMeals, type Suggestion } from '../lib/quickAdd'
import { ROUGH_PORTIONS, roughKcal } from '../lib/selectors'
import type { RoughSize } from '../lib/selectors'
import { useStore } from '../store'
import type { DateStr, MealSource } from '../types'
import { AiConflictHint, AiLimitNote, AiLoginHint, AiQuotaLeft, AiTag } from './ai/AiBits'
import MealAiReview, { type MealAiLogItem, type MealAiSource } from './ai/MealAiReview'
import {
  discardMealPhoto,
  dismissMealText,
  isKeptPhoto,
  markMealAiSaved,
  requestMealPhoto,
  requestMealText,
  setMealPhoto,
  useMealAi,
} from './ai/MealAiStore'
import FoodAmount, { fmtAmount } from './FoodAmount'
import { fmtKcal } from './today/format'
import { ChevronRight, TrashIcon } from './today/icons'
import './today/shared.css'
import './MealSheet.css'

const ROUGH_SIZES: RoughSize[] = ['small', 'medium', 'large']

/** AI에 보내는 글의 최대 길이. 서버가 받는 한도(500자)보다 짧게 둔다. */
const AI_TEXT_MAX = 200
const AI_SOURCE: MealSource = 'ai'
/** AI를 쓸 수 있을 때, 이름 뒤 숫자가 이보다 작으면 칼로리인지 양인지 사용자가 고르게 한다('계란 2'). */
const AI_MIN_NAMED_KCAL = 20
/** Tab으로 옮겨 갈 수 있는 것들. 포커스를 시트 안에 가둘 때 쓴다. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

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
 * AI를 쓸 수 있으면 여기에 두 가지가 더해진다: 말로 적은 식사를 어림잡기, 사진으로 어림잡기.
 * 돈이 드는 AI보다 내 기록과 음식 목록을 먼저 보여 주고, AI는 직접 눌렀을 때만 부른다.
 * 어림잡기 요청과 결과는 MealAiStore가 맡는다. 시트를 닫거나 취소해도 보낸 요청은 끝까지 받는다.
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
  const textSlot = useMealAi((s) => s.text)
  const photoSlot = useMealAi((s) => s.photo)
  /** 지금 보고 있는 AI 단계. null이면 입력 칸이다. */
  const [view, setView] = useState<'text' | 'photo' | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const refocusInput = useRef(false)
  const aiSlot = view === 'text' ? (textSlot?.detached ? null : textSlot) : view === 'photo' ? photoSlot : null
  const aiSource = useMemo<MealAiSource | null>(
    () =>
      view === 'text' && textSlot && !textSlot.detached
        ? { kind: 'text', text: textSlot.text }
        : view === 'photo' && photoSlot
          ? { kind: 'photo', ...photoSlot.image }
          : null,
    [view, textSlot, photoSlot],
  )
  const inAi = aiSource !== null

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
        return
      }
      // aria-modal인 동안 Tab이 뒤의 화면으로 나가지 않게, 시트 안에서 돌게 한다.
      const sheet = sheetRef.current
      if (e.key !== 'Tab' || !sheet) return
      const items = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (items.length === 0) {
        e.preventDefault()
        sheet.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const outside = !(active instanceof Node) || !sheet.contains(active)
      if (e.shiftKey ? outside || active === first || active === sheet : outside || active === last) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
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

  const aiReady = availability === 'ready'
  const minNamedKcal = aiReady ? AI_MIN_NAMED_KCAL : 0
  const entry = useMemo(() => parseEntry(query, { minNamedKcal }), [query, minNamedKcal])
  const deferredQuery = useDeferredValue(query)
  const searchText = entry.kind === 'text' ? entry.text : entry.kind === 'named' || entry.kind === 'ambiguous' ? entry.name : ''

  // 음식 DB는 이름을 처음 적을 때 불러온다.
  const wantsDb = searchText !== ''
  const [dbAttempt, setDbAttempt] = useState(0)
  const dbRequested = useRef(-1)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    // 다시 보여 줄 것이 없는 사진(보내지 않았거나, 실패했거나, 어제 것)은 남기지 않는다.
    const dropLeftover = () => {
      const photo = useMealAi.getState().photo
      if (photo && !isKeptPhoto(photo)) discardMealPhoto()
    }
    dropLeftover()
    return () => {
      mounted.current = false
      // 기다리는 요청은 끊지 않는다. 글은 받아 두었다가 같은 글을 다시 물을 때, 사진은 시트를 다시 열 때 보여 준다.
      dropLeftover()
      dismissMealText()
    }
  }, [])

  // AI 단계에서 돌아오면 입력 칸에서 바로 이어 적을 수 있게 한다.
  useEffect(() => {
    if (!inAi && refocusInput.current) {
      refocusInput.current = false
      inputRef.current?.focus()
    }
  }, [inAi])
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
    const parsed = parseEntry(deferredQuery, { minNamedKcal })
    const text = parsed.kind === 'text' ? parsed.text : ''
    return dbState.status === 'ready' && text !== '' ? searchFoods(dbState.db.index, text, 20) : null
  }, [dbState, deferredQuery, minNamedKcal])
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
    } else if (aiPrimary) {
      // Enter는 음식 목록을 다 불러왔고 내 기록에도 목록에도 없을 때만 AI로 이어진다. 찾은 것이 있으면 그쪽이 먼저다.
      askAi()
    }
  }

  /**
   * 적은 글을 AI에 보낸다. 방금 같은 글로 받아 둔 어림값이 있으면 다시 부르지 않고,
   * 앞서 보낸 같은 글의 답을 아직 기다리는 중이면 그 요청을 이어서 본다.
   */
  function askAi() {
    if (aiText === null || !aiReady || busy || photoBusy || waitingOther) return
    setError(null)
    setPhotoError(null)
    requestMealText(aiText)
    setView('text')
  }

  /** 보낸다. 실패한 뒤 다시 시도할 때도 쓴다. 사진이면 덧붙인 말을 함께 보낸다. */
  function sendAi(note?: string) {
    setError(null)
    if (view === 'photo') requestMealPhoto(note)
    else if (textSlot) requestMealText(textSlot.text)
  }

  function leaveAi() {
    refocusInput.current = true
    setError(null)
    setView(null)
  }

  /** AI 단계를 끝내고 입력 칸으로 돌아간다. 적어 둔 글은 그대로 둔다. 사진과 그 결과는 버린다. */
  function closeAi() {
    if (view === 'photo') discardMealPhoto()
    else dismissMealText()
    leaveAi()
  }

  /**
   * 기다리다 그만두고 입력 칸으로 돌아간다. 보낸 요청은 끊지 않는다(이미 횟수에 들어갔다).
   * 글의 답은 받아 두었다가 같은 글을 다시 물을 때, 사진의 답은 입력 칸 아래에서 이어 볼 수 있게 한다.
   */
  function cancelAi() {
    if (view === 'text') dismissMealText()
    leaveAi()
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
      setError(null)
      setMealPhoto(image)
      setView('photo')
    } catch (err) {
      if (mounted.current) {
        setPhotoError(err instanceof ImageError ? err.message : '사진을 준비하지 못했어요. 다른 사진으로 해 주세요.')
      }
    } finally {
      if (mounted.current) setPhotoBusy(false)
    }
  }

  /** 고른 음식을 차례로 기록한다. 중간에 실패하면 저장된 줄은 목록에서 빼고, 몇 건이 저장됐는지 알린다. */
  async function logAiItems(items: MealAiLogItem[]) {
    if (busy || view === null) return
    const kind = view
    setBusy(true)
    setError(null)
    const saved: number[] = []
    try {
      for (const item of items) {
        await addMeal({ date, kcal: item.kcal, name: item.name, source: AI_SOURCE })
        saved.push(item.id)
      }
      // 기록한 결과는 더 남겨 두지 않는다. 같은 글의 어림값은 다시 물을 때를 위해 그대로 둔다.
      if (kind === 'photo') discardMealPhoto()
      else dismissMealText()
      onClose()
    } catch {
      markMealAiSaved(kind, saved)
      setError(
        saved.length > 0
          ? `${saved.length}건은 기록했고, 남은 ${items.length - saved.length}건을 저장하지 못했어요. 남은 것만 다시 기록해 주세요.`
          : '저장하지 못했어요. 다시 시도해 주세요.',
      )
      setBusy(false)
    }
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
    void run(() => addMeal({ date, kcal: roughKcal(size, targetKcal), name: `대충 기록 · ${label}`, source: 'rough' }))
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

  const canSubmit = entry.kind === 'kcal' || entry.kind === 'named'
  const isText = entry.kind === 'text'
  // 이름 뒤에 범위를 벗어난 숫자를 붙였다('회식 6000'). 검색은 하지만 Enter로 AI를 부르지는 않는다.
  const outOfRange = entry.kind === 'text' && entry.outOfRange === true
  /** AI에 보낼 글. 글이 아니면 null. */
  const aiText = entry.kind === 'text' || entry.kind === 'ambiguous' ? entry.text.slice(0, AI_TEXT_MAX) : null
  // 앞서 보낸 다른 글의 답을 아직 기다리는 중이면 새로 보내지 않는다.
  const waitingOther = textSlot?.call.status === 'loading' && aiText !== null && textSlot.text !== aiText
  const aiDisabled = busy || photoBusy || waitingOther
  // 음식 목록을 아직 불러오는 중이거나, 방금 적은 글의 검색이 끝나지 않았다.
  const dbPending = isText && (dbState.status === 'idle' || dbState.status === 'loading' || deferredQuery !== query)
  // 음식 목록을 실제로 다 불러와 찾아봤는데 없다. 불러오지 못했거나 불러오는 중이면 '없다'고 하지 않는다.
  const dbNoMatch = isText && dbState.status === 'ready' && !dbPending && dbResult !== null && dbResult.total === 0
  const noLocal = dbNoMatch && mine.length === 0
  // 돈이 들지 않는 길이 먼저다. 목록을 다 찾아봐도 없을 때만 AI가 입력 칸 바로 아래 강조 버튼이 되고, Enter로 이어진다.
  const aiPrimary = aiReady && noLocal && !outOfRange
  const aiSecondary = aiReady && isText && !aiPrimary
  // AI를 쓸 수 있는데 음식 목록에 없으면, 긴 안내 대신 입력 칸 아래 한 줄로 알린다.
  const aiNoMatch = aiReady && dbNoMatch
  // AI를 쓸 수 없고 찾은 것도 없으면, 막다른 화면이 되지 않게 대충 기록을 함께 보여 준다.
  const showRough = entry.kind === 'empty' || (!aiReady && noLocal)
  // 받아 둔 사진 결과(또는 아직 기다리는 사진). 기록하거나 버리기 전에는 새 사진으로 덮어쓰지 않는다.
  const keptPhoto = isKeptPhoto(photoSlot) ? photoSlot : null
  const yesterdayKcal = yesterday.reduce((s, m) => s + m.kcal, 0)

  // AI로 가는 길: (글을 적었고 찾은 것이 있을 때) 어림잡기 버튼, 사진 버튼, 남은 횟수, 무엇을 보내는지 한 줄.
  const waitingNote = waitingOther && (
    <p className="small muted" role="status">
      앞서 보낸 글을 어림잡는 중이에요. 끝나면 이 글도 보낼 수 있어요.
    </p>
  )
  const aiEntry = (
    <div className="meal-ai-entry">
      {aiSecondary && (
        <button type="button" className="btn btn--block" aria-label="AI로 칼로리 어림잡기" disabled={aiDisabled} onClick={askAi}>
          <AiTag />
          칼로리 어림잡기
        </button>
      )}
      {aiSecondary && waitingNote}
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
      {!keptPhoto && (
        <button
          type="button"
          className="btn btn--block"
          disabled={busy}
          onClick={() => {
            if (!photoBusy) fileRef.current?.click()
          }}
        >
          <CameraIcon />
          사진으로 어림잡기
        </button>
      )}
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
      <p className="small muted">적은 글과 고른 사진은 칼로리를 어림잡을 때만 AI에 보내요.</p>
      <AiQuotaLeft />
    </div>
  )
  // AI 버튼이 있을 자리. 쓸 수 없을 때는 같은 자리에 이유를 한 줄로 알린다.
  const aiPlace = aiReady ? (
    aiEntry
  ) : availability === 'login' ? (
    <AiLoginHint benefit="사진이나 말로 적은 식사를 AI가 어림잡아 줘요" />
  ) : availability === 'conflict' ? (
    <AiConflictHint />
  ) : availability === 'limit' ? (
    <AiLimitNote fallback="칼로리를 직접 적거나 대충 기록하는 건 그대로 할 수 있어요." />
  ) : null
  const roughSection = (
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
            <span className="rough-kcal num">
              {fmtKcal(roughKcal(size, targetKcal))}
              <span className="rough-unit"> kcal</span>
            </span>
          </button>
        ))}
      </div>
      <p className="small muted entry-source">한 끼를 하루 목표의 일부로 어림잡아요. 정확하지 않아도 기록해 두는 편이 좋아요.</p>
    </section>
  )

  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        // AI 단계에서는 바깥을 잘못 눌러 받은 결과를 잃지 않게 한다. Esc와 닫기 버튼으로는 닫힌다.
        if (e.target === e.currentTarget && !inAi) onClose()
      }}
    >
      <div ref={sheetRef} className="sheet meal-sheet" role="dialog" aria-modal="true" aria-label="식사 추가" tabIndex={-1}>
        <div className="sheet-grabber" aria-hidden="true" />
        <div className="meal-sheet-head">
          <div>
            <h2 className="meal-sheet-title">식사 추가</h2>
            <p className="small muted">{formatKorean(date)}</p>
          </div>
          <button type="button" className="btn btn--ghost meal-sheet-close" onClick={onClose}>
            닫기
          </button>
        </div>

        {aiSource && aiSlot ? (
          <MealAiReview
            source={aiSource}
            state={aiSlot.call}
            busy={busy}
            savedIds={aiSlot.savedIds}
            saveError={error}
            initialNote={view === 'photo' ? photoSlot?.note : undefined}
            onSend={sendAi}
            onCancel={cancelAi}
            onBack={closeAi}
            onLog={(items) => void logAiItems(items)}
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
                  enterKeyHint={canSubmit ? 'done' : aiPrimary ? 'go' : 'search'}
                  maxLength={aiReady ? AI_TEXT_MAX : 60}
                  placeholder={aiReady ? '예: 550 · 김치찌개랑 밥' : '예: 550 · 김치찌개 550'}
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
              {aiPrimary && (
                <button
                  type="submit"
                  className="btn btn--primary btn--block btn--lg"
                  aria-label="AI로 칼로리 어림잡기"
                  disabled={aiDisabled}
                >
                  <AiTag />
                  칼로리 어림잡기
                </button>
              )}
              {aiPrimary && waitingNote}
              {/* 숫자가 칼로리인지 양인지 알 수 없다. 둘 다 보여 주고, Enter로는 어느 쪽도 하지 않는다. */}
              {entry.kind === 'ambiguous' && (
                <div className="meal-entry-choices">
                  <button
                    type="button"
                    className="btn btn--block btn--lg"
                    disabled={busy}
                    data-testid="entry-as-kcal"
                    onClick={() => void run(() => addMeal({ date, kcal: entry.kcal, name: entry.name, source: 'exact' }))}
                  >
                    {entry.name} · {fmtKcal(entry.kcal)} kcal 기록하기
                  </button>
                  <button
                    type="button"
                    className="btn btn--block btn--lg"
                    aria-label="AI로 칼로리 어림잡기"
                    disabled={aiDisabled}
                    onClick={askAi}
                  >
                    <AiTag />
                    칼로리 어림잡기
                  </button>
                  {waitingNote}
                </div>
              )}

              <p className="small muted" id="meal-entry-hint">
                {entry.kind === 'empty' &&
                  (aiReady
                    ? '숫자만 적으면 바로 기록해요. 이름을 적으면 전에 먹은 것과 음식 목록에서 찾고, AI로 어림잡을 수도 있어요.'
                    : '숫자만 적으면 칼로리로 기록해요. 이름을 적으면 전에 먹은 것과 음식 목록에서 찾아요.')}
                {entry.kind === 'kcal' && '이름을 붙이려면 김치찌개 550처럼 이름을 앞에 적어 주세요.'}
                {entry.kind === 'named' && '한 번 기록하면 다음부터 자주 먹는 것에 떠요.'}
                {entry.kind === 'ambiguous' && '뒤의 숫자가 칼로리인지 양인지 알 수 없어요. 맞는 쪽을 눌러 주세요.'}
                {entry.kind === 'text' &&
                  (aiNoMatch
                    ? '음식 목록에는 없어요. AI로 어림잡거나, 칼로리를 알면 뒤에 숫자를 붙여 주세요.'
                    : '칼로리를 알면 이름 뒤에 숫자를 붙여 바로 기록할 수 있어요.')}
              </p>
              {(entry.kind === 'invalid' || outOfRange) && (
                <p className="field-error" role="alert">
                  한 번에 1~{fmtKcal(MAX_ENTRY_KCAL)} kcal까지 기록할 수 있어요.
                </p>
              )}
            </form>

            {/* 돈을 들여 받은 사진 결과는 기록하거나 버릴 때까지 남겨 두고, 시트를 다시 열면 이어 볼 수 있게 한다. */}
            {keptPhoto && (
              <div className="meal-ai-kept" role="group" aria-label="받아 둔 사진 결과">
                <p className="small">
                  {keptPhoto.call.status === 'loading' ? '보낸 사진을 어림잡는 중이에요' : '방금 어림잡은 사진 결과가 있어요'}
                </p>
                <div className="meal-ai-kept-actions">
                  <button type="button" className="btn" disabled={busy} onClick={() => setView('photo')}>
                    이어서 보기
                  </button>
                  {keptPhoto.call.status !== 'loading' && (
                    <button type="button" className="btn btn--ghost" disabled={busy} onClick={discardMealPhoto}>
                      버리기
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 글을 적는 중에는 내 기록과 음식 목록이 먼저 나오고, AI와 사진(또는 쓸 수 없는 이유)은 그 뒤에 온다. */}
            {!isText && aiPlace}

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
                          <span className="fav-kcal num">
                            {fmtKcal(s.kcal)}
                            <span className="fav-unit"> kcal</span>
                          </span>
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

            {searchText !== '' && entry.kind === 'text' && !aiNoMatch && (
              <section aria-labelledby="db-title">
                <h3 className="card-title" id="db-title">
                  음식 목록에서 찾기
                </h3>
                {dbState.status === 'loading' && (
                  <>
                    <p className="small muted">음식 목록을 불러오는 중이에요…</p>
                    <div className="food-skeleton" aria-hidden="true">
                      <span className="skeleton" />
                      <span className="skeleton" />
                      <span className="skeleton" />
                    </div>
                  </>
                )}
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
                  <p className="small muted">'{searchText}'에 맞는 음식이 없어요. 포장 가공식품은 들어 있지 않아요.</p>
                )}
                {dbResult && dbResult.items.length > 0 && (
                  <>
                    <ul className="list food-results" aria-label="검색 결과">
                      {dbResult.items.map((f, i) => (
                        <li key={`${f.name}|${f.tag}|${f.kcalPer100}|${f.servingSize}|${i}`}>
                          <button type="button" className="food-result" onClick={() => setPicked(f)}>
                            <span className="food-result-text">
                              <span className="food-result-main">
                                <span className="food-result-name">{f.name}</span>
                                {f.tag && <span className="food-result-tag">{f.tag}</span>}
                              </span>
                              <span className="small muted num">{servingLabel(f)}</span>
                            </span>
                            <ChevronRight />
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

            {isText && aiPlace}

            {entry.kind === 'empty' && yesterday.length > 0 && !todayHasMeals && (
              <button type="button" className="btn btn--block" disabled={busy} onClick={logYesterday}>
                전날 먹은 {yesterday.length}건 그대로 기록 · {fmtKcal(yesterdayKcal)} kcal
              </button>
            )}
            {showRough && roughSection}
          </>
        )}

        {/* AI 결과를 기록하다 난 오류는 그 화면의 기록 버튼 위에 보여 준다. */}
        {error && !inAi && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
