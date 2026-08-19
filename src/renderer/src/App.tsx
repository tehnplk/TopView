import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import Map from './components/Map'

function App(): React.JSX.Element {
  const [version, setVersion] = useState<string | null>(null)
  const [isAboutOpen, setIsAboutOpen] = useState(false)

  useEffect(() => {
    void window.api?.getAppVersion().then(setVersion)
  }, [])

  useEffect(() => {
    if (!isAboutOpen) {
      return
    }

    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsAboutOpen(false)
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isAboutOpen])

  return (
    <main className="app-shell">
      <header className="app-header">
        <span className="brand-mark" aria-hidden="true">T</span>
        <nav className="app-nav" aria-label="เมนูหลัก">
          <button type="button">นำเข้า</button>
          <button type="button">จัดการชั้นข้อมูล</button>
          <button type="button">สำรองข้อมูล</button>
          <button type="button">ตั้งค่า</button>
          <button type="button" onClick={() => setIsAboutOpen(true)}>เกี่ยวกับ</button>
        </nav>
      </header>

      <section className="workspace" aria-label="Map workspace">
        <Map />
      </section>

      {isAboutOpen && (
        <div
          className="about-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsAboutOpen(false)
            }
          }}
        >
          <section
            className="about-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-title"
            aria-describedby="about-description"
          >
            <header className="about-dialog-header">
              <span className="about-brand-mark" aria-hidden="true">T</span>
              <div>
                <h2 id="about-title">TopView</h2>
                <span>Desktop GIS Application</span>
              </div>
              <button
                type="button"
                aria-label="ปิดหน้าต่างเกี่ยวกับ"
                onClick={() => setIsAboutOpen(false)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <div className="about-dialog-body">
              <p id="about-description">
                แอปพลิเคชันแผนที่สำหรับจัดการและแสดงข้อมูลเชิงพื้นที่
              </p>
              <dl>
                <div>
                  <dt>เวอร์ชัน</dt>
                  <dd>{version ? `v${version}` : '—'}</dd>
                </div>
                <div>
                  <dt>แพลตฟอร์ม</dt>
                  <dd>Windows Desktop</dd>
                </div>
              </dl>

              <section className="about-developer" aria-labelledby="about-developer-title">
                <h3 id="about-developer-title">เกี่ยวกับผู้พัฒนา</h3>
                <p className="about-developer-name">นายอุเทน จาดยางโทน</p>
                <p>นักสาธารณสุขชำนาญการ</p>
                <p>กลุ่มงานสุขภาพดิจิทัล</p>
                <p>สำนักงานสาธารณสุขจังหวัดพิษณุโลก</p>
                <p>โทรศัพท์ 055xxxxxx</p>
              </section>
            </div>

            <footer className="about-dialog-footer">
              <button type="button" autoFocus onClick={() => setIsAboutOpen(false)}>
                ปิด
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
