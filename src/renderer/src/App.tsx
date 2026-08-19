import { useEffect, useState } from 'react'
import Map from './components/Map'

function App(): React.JSX.Element {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    void window.api?.getAppVersion().then(setVersion)
  }, [])

  return (
    <main className="app-shell">
      <header className="app-header">
        <span className="brand-mark" aria-hidden="true">T</span>
        <h1>TopView</h1>
        {version && <span className="version">v{version}</span>}
      </header>

      <section className="workspace" aria-label="Map workspace">
        <Map />
      </section>
    </main>
  )
}

export default App
