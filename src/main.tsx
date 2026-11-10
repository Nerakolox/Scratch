import { createRoot } from 'react-dom/client'
import App from './app/App'
import './styles/index.css'
import { applyCurrentTheme } from './shared/theme'
import { OAuthRelay } from './features/backup/oauth/OAuthRelay'

applyCurrentTheme()

const params = new URLSearchParams(window.location.search)
const isOAuthRelay =
  Boolean(window.opener) && (params.has('code') || params.has('error'))

const root = document.getElementById('root')
if (!root) throw new Error('Root element missing')
createRoot(root).render(isOAuthRelay ? <OAuthRelay /> : <App />)
