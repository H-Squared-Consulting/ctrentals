import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { LayoutProvider } from './contexts/LayoutContext'
import { App } from './App'
import './app.css'

// Service worker caches Supabase Storage images locally to bypass the
// forced `no-cache` revalidation that the public bucket endpoint emits.
// UUID-keyed image URLs mean we never have to invalidate entries.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((err) => {
    console.warn('[sw] registration failed:', err);
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <LayoutProvider>
          <App />
        </LayoutProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
