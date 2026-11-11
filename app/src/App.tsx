import { useEffect, useRef, useState } from 'react'
import { controller } from './app/controller'
import { useApp } from './app/useApp'
import { HistoryScreen } from './ui/HistoryScreen'
import { MapScreen } from './ui/MapScreen'
import type { Pin, StreetInfo } from './ui/MapView'
import { LockOverlay, NoteSheet, PinSheet, StreetSheet, Toast, WalkSummarySheet } from './ui/Overlays'
import { DebugScreen, SettingsScreen } from './ui/SettingsScreen'
import { StatsScreen } from './ui/StatsScreen'
import { UpdatePrompt } from './ui/UpdatePrompt'

type Screen = 'map' | 'stats' | 'history' | 'settings' | 'debug'

export default function App() {
  const s = useApp()
  const [screen, setScreen] = useState<Screen>('map')
  const [noteOpen, setNoteOpen] = useState(false)
  const [pin, setPin] = useState<Pin | null>(null)
  const [street, setStreet] = useState<StreetInfo | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)

  useEffect(() => void controller.init(), [])

  return (
    <div className={`shell${s.settings.scanlines ? ' scanlines' : ''}`}>
      {/* The map stays mounted so it keeps its state while other screens are open. */}
      <div className="map-screen" hidden={screen !== 'map'}>
        <MapScreen onPin={setPin} onStreet={setStreet} />
      </div>
      {screen === 'stats' && <StatsScreen go={setScreen} />}
      {screen === 'history' && <HistoryScreen onBack={() => setScreen('stats')} />}
      {screen === 'settings' && <SettingsScreen onBack={() => setScreen('stats')} onDebug={() => setScreen('debug')} />}
      {screen === 'debug' && <DebugScreen onBack={() => setScreen('settings')} />}

      <nav className="nav">
        <button aria-pressed={screen === 'map'} onClick={() => setScreen('map')}>
          Map
        </button>
        <button aria-pressed={screen !== 'map'} onClick={() => setScreen('stats')}>
          Stats
        </button>
        <button onClick={() => setNoteOpen(true)}>Note</button>
        <button onClick={() => photoInput.current?.click()}>Photo</button>
        <button className="lock-btn" onClick={() => controller.setLocked(true)}>
          Lock
        </button>
      </nav>
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void controller.addPhoto(f)
        }}
      />

      {noteOpen && <NoteSheet onClose={() => setNoteOpen(false)} />}
      {pin && <PinSheet pin={pin} onClose={() => setPin(null)} />}
      {street && <StreetSheet info={street} onClose={() => setStreet(null)} />}
      <WalkSummarySheet />
      <Toast />
      <UpdatePrompt />
      {s.locked && <LockOverlay />}
    </div>
  )
}
