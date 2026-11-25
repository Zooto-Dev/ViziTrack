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
import { TaskPanel } from './components/TaskPanel'
import { StatusBar } from './components/StatusBar'
import { Boot } from './components/Boot'
import { Help } from './components/Help'

// Settings is only loaded when opened.
const SettingsPanel = lazy(() => import('./components/SettingsPanel'))

export default function App() {
  const settingsOpen = useStore((s) => s.settingsOpen)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const theme = useStore((s) => s.settings?.theme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme || 'tactical'
  }, [theme])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false)
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (e.key === '?' && !typing) useStore.getState().setHelpOpen(!useStore.getState().helpOpen)
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
      <div className="scanlines" aria-hidden />
      <div className="frame" aria-hidden>
        <i className="c tl" />
        <i className="c tr" />
        <i className="c bl" />
        <i className="c br" />
      </div>
      <Hud />
      <main className="layout">
        <aside className="col col-left">
          <SystemMonitor />
          <TaskPanel />
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
      <StatusBar />
      <ConfirmDialog />
      <Toast />
      {settingsOpen && (
        <Suspense fallback={<div className="panel-loading">Loading settings…</div>}>
          <SettingsPanel onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
      <Help />
      <Boot />
    </div>
  )
}
