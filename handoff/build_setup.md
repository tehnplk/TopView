# การ Build Windows Setup

โปรเจกต์ใช้ `electron-vite` สำหรับ compile แอป และใช้ `electron-builder` ร่วมกับ NSIS เพื่อสร้าง Windows Setup แบบ x64

## สิ่งที่ต้องมี

- Node.js และ npm
- ติดตั้ง dependencies ด้วย `npm install`

## สร้าง Setup

รันจากโฟลเดอร์โปรเจกต์:

```powershell
npm run build:win
```

คำสั่งนี้จะตรวจ TypeScript, build แอป และสร้าง installer ที่:

```text
dist/TopView-0.1.0-Setup.exe
```

หากต้องการเฉพาะ packaged app สำหรับทดสอบโดยไม่สร้าง installer:

```powershell
npm run pack:win
```

ไฟล์สำหรับเปิดทดสอบจะอยู่ที่ `dist/win-unpacked/TopView.exe`

## ข้อควรทราบ

- การตั้งค่า build อยู่ใน [`package.json`](../package.json)
- PGlite และ PostGIS ถูกกำหนด `asarUnpack` เพื่อให้ไฟล์ WASM/data ทำงานหลังติดตั้ง
- ฐานข้อมูลผู้ใช้เก็บใน AppData และไม่ได้รวมอยู่ใน installer
- Setup ยังไม่มี Code Signing Certificate จึงอาจแสดงคำเตือน Windows SmartScreen
- หาก smoke test แล้วโปรแกรมปิดทันที ให้ตรวจและลบ `ELECTRON_RUN_AS_NODE=1` ออกจาก environment ของ process ที่ใช้เปิดแอป

ตรวจ checksum ของ installer ได้ด้วย:

```powershell
Get-FileHash .\dist\TopView-0.1.0-Setup.exe -Algorithm SHA256
```

## Suggested skills

- `computer-use`: เปิดตรวจ installer และหน้าจอ packaged app บน Windows
- `playwright-cli`: ทดสอบการทำงานของ renderer และแผนที่ก่อนสร้าง release
