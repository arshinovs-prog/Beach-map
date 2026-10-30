import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ensureAnonymousSession } from './lib/anonymousAuth'

async function bootstrap() {
  const rootElement = document.getElementById('root')
  if (!rootElement) throw new Error('Не найден корневой элемент #root')

  try {
    await ensureAnonymousSession()
  } catch (error) {
    // Keep the map usable even if anonymous auth is temporarily unavailable.
    console.error('Не удалось создать анонимную сессию Supabase:', error)
  }

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
