import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import i18n from './i18n'
import App from './App.tsx'
import { hydrateUserSettings, loadLanguageSettings } from '@/lib/user-settings'
import { logger } from '@/lib/logger'

// Globalne handlery błędów — przechwytują nieobsłużone odrzucenia promise oraz
// błędy okna i kierują je do centralnego loggera (konsola + plik frontend.log).
window.addEventListener('unhandledrejection', (e) => {
  logger.error('[unhandledrejection]', (e as PromiseRejectionEvent).reason)
})
window.addEventListener('error', (e) => {
  logger.error('[window.error]', (e as ErrorEvent).message)
})

// Render po hydratacji wspólnych ustawień, by desktop i web UI startowały z tych
// samych wartości (zaokrąglanie, waluta, język itd.). Timeout chroni pierwszy
// paint, gdyby backend nie odpowiadał — wtedy startujemy z lokalnego cache.
const HYDRATE_TIMEOUT_MS = 3000

async function bootstrap(): Promise<void> {
  // Hydratacja ustawień NIGDY nie może zablokować renderu — inaczej awaria/zwłoka
  // backendu = białe okno. Wszystko opakowane w try/catch, render zawsze poniżej.
  try {
    await Promise.race([
      hydrateUserSettings(),
      new Promise((resolve) => setTimeout(resolve, HYDRATE_TIMEOUT_MS)),
    ])
    const { code } = loadLanguageSettings()
    if (i18n.language !== code) {
      await i18n.changeLanguage(code)
    }
  } catch (err) {
    console.error(
      '[bootstrap] settings hydration failed — rendering from local cache',
      err,
    )
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
