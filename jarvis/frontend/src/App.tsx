import { lazy, Suspense, useEffect } from 'react'
import { useStore } from './store'
import { Hud } from './components/Hud'
import { Reactor } from './components/Reactor'
import { Conversation } from './components/Conversation'
import { Composer } from './components/Composer'
import { QuickActions } from './components/QuickActions'
import { SystemMonitor } from './components/SystemMonitor'
import { ConfirmDialog } from './components/ConfirmDialog'
import { Toast } from './components/Toast'

// Settings is only loaded when opened.
const SettingsPanel = lazy(() => import('./components/SettingsPanel'))

export default function App() {
  const settingsOpen = useStore((s) => s.settingsOpen)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false)
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(!useStore.getState().settingsOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSettingsOpen])

  return (
    <div className="app">
      <div className="bg-grid" aria-hidden />
      <Hud />
      <main className="layout">
        <aside className="col col-left">
          <SystemMonitor />
          <QuickActions />
        </aside>
        <section className="col col-center">
          <Reactor />
          <Composer />
        </section>
        <aside className="col col-right">
          <Conversation />
        </aside>
      </main>
      <ConfirmDialog />
      <Toast />
      {settingsOpen && (
        <Suspense fallback={<div className="panel-loading">Loading settings…</div>}>
          <SettingsPanel onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}
