/** Điểm khởi động giao diện. */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SessionProvider } from './lib/session.tsx'
import { App } from './App.tsx'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Không tìm thấy phần tử #root trong index.html')

createRoot(container).render(
  <StrictMode>
    <SessionProvider>
      <App />
    </SessionProvider>
  </StrictMode>,
)
