import { useRegisterSW } from 'virtual:pwa-register/react'

// Shows "update ready" instead of reloading on its own, so a walk is never interrupted.
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null
  return (
    <div className="update-toast" role="status">
      <span className="grow">UPDATE READY</span>
      <button onClick={() => updateServiceWorker(true)}>Reload</button>
      <button onClick={() => setNeedRefresh(false)}>Later</button>
    </div>
  )
}
