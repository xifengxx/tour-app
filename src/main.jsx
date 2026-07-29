import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { useRegisterSW } from 'virtual:pwa-register/react'
import './index.css'
import App from './App.jsx'

// PWA update prompt
function PWAUpdater() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      if (r) {
        setInterval(() => r.update(), 60 * 60 * 1000); // check every hour
      }
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-3 bg-card border border-border rounded-xl shadow-lg flex items-center gap-3">
      <span className="text-sm text-white">有新版本可用</span>
      <button
        onClick={() => updateServiceWorker(true)}
        className="px-3 py-1 bg-primary text-primary-foreground rounded-lg text-xs font-semibold"
      >
        更新
      </button>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <PWAUpdater />
  </StrictMode>,
)
