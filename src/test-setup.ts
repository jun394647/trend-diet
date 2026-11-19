import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'

// 화면 테스트는 식사 추가 창이 닫힌 상태에서 시작한다고 가정한다. 앱을 열면 창부터 여는 동작은 따로 시험한다.
try {
  localStorage.setItem('trend-diet:open-meal-on-launch', 'off')
} catch {
  // 저장소가 없는 환경이면 그대로 둔다.
}
