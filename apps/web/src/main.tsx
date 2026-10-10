/** Điểm khởi động giao diện. */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SessionProvider } from './lib/session.tsx'
import { I18nProvider, applyDocumentLang, createWebI18n } from './lib/i18n.tsx'
import { App } from './App.tsx'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Không tìm thấy phần tử #root trong index.html')

// Ngôn ngữ được khởi tạo TRƯỚC khi vẽ giao diện, và `lang` của thẻ `<html>` được đặt
// ngay: nếu để sau, lần vẽ đầu tiên sẽ hiện tiếng Việt rồi mới nhảy sang tiếng Anh.
const i18n = createWebI18n()
applyDocumentLang(i18n.language === 'en' ? 'en' : 'vi')

createRoot(container).render(
  <StrictMode>
    <I18nProvider instance={i18n}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </I18nProvider>
  </StrictMode>,
)
