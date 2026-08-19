# แนวทางโครงสร้าง Codebase สำหรับการขยายระบบ

เอกสารนี้กำหนดขอบเขตความรับผิดชอบของแต่ละส่วนใน TopView เพื่อให้เพิ่ม feature ได้โดยไม่ทำให้ Electron main process, IPC และ React UI ผูกกันแน่นเกินไป

รายละเอียดเฉพาะเรื่องให้ดูเพิ่มเติมที่:

- [`handoff/database_gis.md`](./database_gis.md) — PGlite, PostGIS, CRUD, backup และ restore
- [`handoff/build_setup.md`](./build_setup.md) — build, package และ Windows Setup

## โครงสร้างปัจจุบัน

```text
src/
├─ main/                 Electron main process
│  ├─ index.ts           สร้าง window และลงทะเบียน IPC
│  ├─ database.ts        PGlite/PostGIS และงาน backup/restore
│  └─ gistdaWms.ts       GISTDA WMS proxy/config
├─ preload/
│  └─ index.ts           contextBridge API ที่ renderer เรียกได้
├─ renderer/
│  ├─ index.html
│  └─ src/
│     ├─ App.tsx         app shell, navbar และ modal ระดับแอป
│     ├─ components/
│     │  └─ Map.tsx      Leaflet map และเครื่องมือ GIS
│     └─ styles.css
└─ shared/
   └─ gis.ts             type/DTO ที่ใช้ข้าม process
```

## กติกาการแบ่งความรับผิดชอบ

### `src/main`

รับผิดชอบสิ่งที่ต้องใช้สิทธิ์ของระบบปฏิบัติการหรือ Node.js:

- สร้างและควบคุม `BrowserWindow`
- เปิด native dialog และอ่าน/เขียนไฟล์
- เชื่อมต่อและแก้ไข PGlite/PostGIS
- เรียก external service หรือทำ local proxy
- ตรวจสอบ input จาก IPC ก่อนทำงานเสมอ

ไม่ควรมี React component, DOM logic หรือ state ของหน้าจอใน main process

### `src/preload`

เป็น security boundary ระหว่าง renderer และ main process:

- expose เฉพาะ method ที่ UI ต้องใช้ผ่าน `contextBridge`
- ใช้ชื่อ method ที่สื่อความหมาย เช่น `backupDatabase()` ไม่ expose `ipcRenderer.invoke()` ตรงๆ
- event subscription ต้องคืนฟังก์ชัน unsubscribe
- ห้าม expose filesystem, shell, database instance หรือ generic SQL API

คงการตั้งค่า `contextIsolation: true`, `nodeIntegration: false` และ `sandbox: true`

### `src/renderer`

รับผิดชอบ UI และ interaction เท่านั้น:

- React state, modal, progress และข้อความที่ผู้ใช้เห็น
- Leaflet layer, marker, drawing และการแสดง feature
- เรียก native/database operation ผ่าน `window.api`
- ไม่ import `electron`, `node:*`, PGlite หรือ secret/config โดยตรง

เมื่อ component เริ่มดูแลหลายเรื่อง ให้แยกตาม feature แทนการเพิ่มโค้ดต่อใน `App.tsx` หรือ `Map.tsx`

### `src/shared`

เก็บ contract ที่ใช้ได้ทั้ง main, preload และ renderer:

- request/response DTO
- geometry และ feature types
- progress event types
- IPC channel constants เมื่อจำนวน channel เพิ่มขึ้น

ไฟล์ใน `shared` ต้องไม่มี Electron, React, Node.js หรือ side effect

## รูปแบบ IPC

ใช้ชื่อ channel แบบ namespace:

```text
app:get-version
gis-data:list
gis-data:save
database:backup
database:restore
database:restore-progress
import:browse-43-files
```

แนวทางเพิ่ม IPC ใหม่:

1. เพิ่ม request/response type ใน `src/shared`
2. เขียน service/repository ใน `src/main`
3. ลงทะเบียน handler ใน main process
4. expose method แบบจำกัดขอบเขตใน preload
5. เรียก method ผ่าน `window.api` จาก renderer
6. ทดสอบ validation, success, error และ unsubscribe ของ event

ข้อมูลจาก renderer ต้องรับเป็น `unknown` ที่ main process แล้ว validate ก่อนใช้ อย่าเชื่อ type ของ TypeScript เพียงอย่างเดียว เพราะ IPC เป็น runtime boundary

## โครงสร้างเป้าหมายเมื่อระบบใหญ่ขึ้น

ไม่จำเป็นต้องย้ายทั้งหมดทันที ให้แยกเมื่อมี feature ใหม่หรือไฟล์เดิมเริ่มแก้ยาก:

```text
src/
├─ main/
│  ├─ app/
│  │  └─ createWindow.ts
│  ├─ ipc/
│  │  ├─ registerAppHandlers.ts
│  │  ├─ registerDatabaseHandlers.ts
│  │  └─ registerImportHandlers.ts
│  ├─ database/
│  │  ├─ client.ts
│  │  ├─ migrations.ts
│  │  ├─ gisRepository.ts
│  │  └─ backupService.ts
│  └─ services/
│     └─ gistdaWmsService.ts
├─ preload/
│  └─ index.ts
├─ renderer/src/
│  ├─ app/
│  │  └─ AppShell.tsx
│  ├─ features/
│  │  ├─ map/
│  │  ├─ import/
│  │  ├─ backup/
│  │  ├─ layers/
│  │  └─ settings/
│  ├─ components/ui/
│  ├─ hooks/
│  └─ styles/
└─ shared/
   ├─ contracts/
   └─ ipcChannels.ts
```

## หลักการออกแบบเพื่อ scale

- แยก UI, orchestration และ database operation ออกจากกัน
- ให้ main process บาง: handler รับ input แล้วส่งต่อ service
- รวม SQL ไว้ใน repository/database layer ไม่กระจายไว้ใน IPC handler
- migration ต้องรันซ้ำได้และไม่ทำลายข้อมูลเดิมโดยไม่ตั้งใจ
- งานที่ใช้เวลานานส่ง progress event และต้องมีสถานะ success/error ชัดเจน
- operation ที่แทนที่ข้อมูลต้องมี confirmation, safety backup และ rollback
- อย่าเก็บ API key หรือข้อมูลลับใน source, renderer หรือ log
- ใช้ parameterized SQL และ validate path ก่อนอ่าน เขียน ลบ หรือย้ายไฟล์
- หลีกเลี่ยง global state ใน renderer; state ที่ใช้เฉพาะ feature ควรอยู่ใน feature นั้น
- ใช้ error message ภาษาไทยสำหรับผู้ใช้ และเก็บ technical detail ไว้ใน main-process log

## แนวทางทดสอบ

- `npm run typecheck` ทุกครั้งที่แก้ contract, preload หรือ IPC
- `npm run build` ก่อนส่งงาน เพื่อทดสอบ main, preload และ renderer พร้อมกัน
- database integration test ใช้ PGlite data directory ชั่วคราวและลบทิ้งหลังทดสอบ
- ทดสอบ backup/restore แบบ round trip พร้อม geometry, JSONB และ config
- ทดสอบ renderer interaction เช่น modal, focus, progress และ Leaflet ด้วย browser/E2E test
- ทดสอบ native dialog และ packaged app บน Windows จริงก่อน release

## Suggested skills

- `scrutinize` — ตรวจเส้นทาง IPC, database restore และงานที่มีความเสี่ยงต่อข้อมูล
- `playwright-cli` — ทดสอบ React renderer, modal และ interaction ของแผนที่
- `computer-use` — ตรวจ native dialog, packaged Electron app และ Windows Setup
- `frontend-design` — ใช้เมื่อเพิ่มหรือปรับ UI ที่ต้องรักษาภาษาภาพของ TopView
