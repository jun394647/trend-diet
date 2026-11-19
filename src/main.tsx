import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 공통 스타일을 화면별 스타일(App이 불러옴)보다 먼저 불러와, 화면 쪽 규칙이 이기게 한다.
import '@fontsource-variable/bricolage-grotesque/wght.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
