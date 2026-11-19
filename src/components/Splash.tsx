import { useId } from 'react'

/**
 * 앱 표식. 도형은 scripts/make-icons.mjs가 출력하는 값(viewBox 64)을 그대로 옮긴 것이다.
 * 스플래시와 설치 안내에서 함께 쓴다.
 */
export function BrandMark({ className }: { className?: string }) {
  const ground = useId()
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={ground} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#262968" />
          <stop offset="1" stopColor="#171940" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14.5" fill={`url(#${ground})`} />
      <path
        d="M13.72 23.04C15.63 23.94 21.67 27.73 25.19 28.42C28.71 29.1 31.04 25.25 34.87 27.16C38.69 29.07 45.92 37.76 48.13 39.88"
        fill="none"
        stroke="#fff"
        strokeWidth="5.2"
        strokeLinecap="round"
      />
      <circle cx="48.13" cy="39.88" r="6.9" fill="#1b1d4c" />
      <circle cx="48.13" cy="39.88" r="4.84" fill="#f2b84e" />
    </svg>
  )
}

/**
 * 기록을 읽어 오는 동안 보이는 첫 화면.
 * index.html에 같은 마크업이 미리 들어 있고(스타일도 거기 있다), React가 뜨면 이 컴포넌트가 그 자리를 그대로 이어받는다.
 * 그래서 두 곳의 구조와 클래스 이름은 똑같아야 한다.
 */
export default function Splash() {
  return (
    <div className="splash" role="status" aria-label="불러오는 중">
      <BrandMark className="splash-mark" />
      <p className="splash-name">추세 다이어트</p>
    </div>
  )
}
