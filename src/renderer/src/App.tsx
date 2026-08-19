import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import Map from './components/Map'

function App(): React.JSX.Element {
  const [version, setVersion] = useState<string | null>(null)
  const [isAboutOpen, setIsAboutOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [isBackingUp, setIsBackingUp] = useState(false)
  const [selected43Archive, setSelected43Archive] = useState<string | null>(null)
  const [selectedBackupFile, setSelectedBackupFile] = useState<string | null>(null)

  const openImportDialog = (): void => {
    setSelected43Archive(null)
    setSelectedBackupFile(null)
    setIsImportOpen(true)
  }

  const browse43FilesArchive = async (): Promise<void> => {
    const selectedFile = await window.api?.browse43FilesArchive()

    if (selectedFile) {
      setSelected43Archive(selectedFile)
    }
  }

  const browseBackupFile = async (): Promise<void> => {
    const selectedFile = await window.api?.browseBackupFile()

    if (selectedFile) {
      setSelectedBackupFile(selectedFile)
    }
  }

  const handleBackup = async (): Promise<void> => {
    if (isBackingUp || !window.api) {
      return
    }

    setIsBackingUp(true)

    try {
      await window.api.backupDatabase()
    } catch (error) {
      console.error('Unable to back up the database', error)
    } finally {
      setIsBackingUp(false)
    }
  }

  useEffect(() => {
    void window.api?.getAppVersion().then(setVersion)
  }, [])

  useEffect(() => {
    if (!isAboutOpen && !isImportOpen) {
      return
    }

    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsAboutOpen(false)
        setIsImportOpen(false)
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isAboutOpen, isImportOpen])

  return (
    <main className="app-shell">
      <header className="app-header">
        <span className="brand-mark" aria-hidden="true">T</span>
        <nav className="app-nav" aria-label="เมนูหลัก">
          <button type="button" onClick={openImportDialog}>นำเข้า</button>
          <button type="button">จัดการชั้นข้อมูล</button>
          <button type="button" disabled={isBackingUp} onClick={() => void handleBackup()}>
            {isBackingUp ? 'กำลังสำรอง...' : 'สำรองข้อมูล'}
          </button>
          <button type="button">ตั้งค่า</button>
          <button type="button" onClick={() => setIsAboutOpen(true)}>เกี่ยวกับ</button>
        </nav>
      </header>

      <section className="workspace" aria-label="Map workspace">
        <Map />
      </section>

      {isImportOpen && (
        <div
          className="about-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsImportOpen(false)
            }
          }}
        >
          <section
            className="import-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-title"
          >
            <header className="import-dialog-header">
              <h2 id="import-title">นำเข้าข้อมูล</h2>
              <button
                type="button"
                aria-label="ปิดหน้าต่างนำเข้าข้อมูล"
                onClick={() => setIsImportOpen(false)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <div className="import-dialog-body">
              <button
                type="button"
                className="import-option-button"
                autoFocus
                onClick={() => void browse43FilesArchive()}
              >
                นำเข้า 43 แฟ้ม
              </button>
              {selected43Archive && (
                <p className="import-selected-file" title={selected43Archive} aria-live="polite">
                  {selected43Archive}
                </p>
              )}
              <button
                type="button"
                className="import-option-button"
                onClick={() => void browseBackupFile()}
              >
                นำเข้าข้อมูลสำรอง
              </button>
              {selectedBackupFile && (
                <p className="import-selected-file" title={selectedBackupFile} aria-live="polite">
                  {selectedBackupFile}
                </p>
              )}
            </div>
          </section>
        </div>
      )}

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
