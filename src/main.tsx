import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ensureAnonymousSession } from './lib/anonymousAuth'

async function bootstrap() {
  const rootElement = document.getElementById('root')
  if (!rootElement) throw new Error('Не найден корневой элемент #root')

  let authTimeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      ensureAnonymousSession(),
      new Promise<never>((_, reject) => {
        authTimeout = setTimeout(() => reject(new Error('Таймаут инициализации авторизации')), 8000)
      }),
    ])
  } catch (error) {
    // Keep the map usable even if anonymous auth is temporarily unavailable.
    console.error('Не удалось создать анонимную сессию Supabase:', error)
  } finally {
    if (authTimeout) clearTimeout(authTimeout)
  }

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
