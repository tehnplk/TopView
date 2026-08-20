# ฐานข้อมูล GIS

TopView ใช้ **PGlite** ร่วมกับ **PostGIS** เป็นฐานข้อมูล PostgreSQL แบบฝังในแอป จึงไม่ต้องตั้งค่า host, port, username หรือ password และไม่ต้องเปิด PostgreSQL Server แยกต่างหาก

## การเชื่อมต่อ

จุดเชื่อมต่อหลักอยู่ที่ [`src/main/database.ts`](../src/main/database.ts) ในฟังก์ชัน `getDatabase()`:

```ts
const database = new PGlite({
  dataDir: join(app.getPath('userData'), 'topview-pglite'),
  extensions: { postgis }
})

await database.waitReady
```

- ฐานข้อมูลถูกเก็บถาวรใต้โฟลเดอร์ `userData/topview-pglite` ของ Electron
- บน Windows โฟลเดอร์ `userData` ปกติอยู่ใต้ `%APPDATA%` โดยชื่อโฟลเดอร์ขึ้นกับชื่อแอป
- `getDatabase()` คืน instance เดิมตลอดอายุ process เพื่อไม่ให้เปิดฐานข้อมูลซ้ำ
- ฐานข้อมูลและตารางจะถูกสร้างอัตโนมัติเมื่อเปิดแอป
- PGlite ไม่ได้เปิด PostgreSQL network server จึงใช้ `psql` เชื่อมผ่าน `localhost` ไม่ได้

เมนู `สำรองข้อมูล` เรียก `database.dumpDataDir('gzip')` และเขียน snapshot เป็นไฟล์ `topview_yyyymmddhhiiss.tar.gz` ตามเวลาไทย UTC+7 ลงใน `%USERPROFILE%\.topview` โดยไม่เขียนทับไฟล์สำรองเดิม

เมนู `นำเข้า > นำเข้าข้อมูลสำรอง` เลือกไฟล์ `.tar.gz` แล้ว restore ด้วย `loadDataDir` ตามขั้นตอนนี้:

1. ตรวจชนิดไฟล์และ gzip signature
2. สร้างไฟล์สำรองของฐานข้อมูลปัจจุบันอัตโนมัติ
3. เปิดไฟล์สำรองใน staging directory และตรวจตาราง `gis_data`, `config` และ PostGIS
4. ปิดฐานข้อมูลเดิมและสลับ staging directory เข้ามาใช้งาน
5. เปิดและตรวจฐานข้อมูลใหม่อีกครั้ง
6. หากล้มเหลวหลังเริ่มสลับฐานข้อมูล ระบบจะ rollback กลับฐานเดิมอัตโนมัติ

main process ส่งสถานะแต่ละขั้นผ่าน IPC `database:restore-progress` เพื่อแสดง progress bar ใน renderer และหน้าแผนที่จะ reload หลัง restore สำเร็จ

หากต้องการดู path จริงระหว่างพัฒนา ให้ตรวจค่าจาก main process:

```ts
console.log(app.getPath('userData'))
```

## โครงสร้างตาราง

### `gis_data`

| คอลัมน์ | ชนิด | รายละเอียด |
|---|---|---|
| `id` | `INTEGER IDENTITY` | Primary key |
| `spatial` | `geometry(Geometry, 4326)` | รูปร่างเชิงพื้นที่ในพิกัด WGS84 |
| `info` | `JSONB` | ข้อมูลประกอบ feature ค่าเริ่มต้น `{}` |
| `created_at` | `TIMESTAMPTZ` | วันเวลาที่สร้าง |

โค้ดปัจจุบันรองรับ GeoJSON ชนิด `Point` และ `Polygon` โดยพิกัดต้องเรียงเป็น `[longitude, latitude]`

### `config`

| คอลัมน์ | ชนิด | รายละเอียด |
|---|---|---|
| `id` | `INTEGER IDENTITY` | Primary key |
| `name` | `TEXT UNIQUE` | ชื่อ config เช่น `GISTDA_API_KEY` |
| `value` | `TEXT` | ค่าของ config |

## การจัดการข้อมูลใน main process

เรียก `getDatabase()` แล้วใช้ parameterized query เสมอ:

```ts
const database = await getDatabase()
const result = await database.query(
  'SELECT id, info FROM gis_data WHERE id = $1',
  [featureId]
)
```

### เพิ่ม feature

ใช้ฟังก์ชัน `saveGisGeometry(geometry, info)` ซึ่งทำ SQL ลักษณะนี้:

```sql
INSERT INTO gis_data (spatial, info)
VALUES (
  ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
  $2::jsonb
)
RETURNING id;
```

### อ่าน feature ทั้งหมด

ใช้ `listGisGeometry()` โดยแปลง PostGIS geometry กลับเป็น GeoJSON:

```sql
SELECT id, ST_AsGeoJSON(spatial) AS spatial, info
FROM gis_data
WHERE spatial IS NOT NULL
ORDER BY id;
```

### แก้ไขข้อมูลประกอบ

ใช้ `updateGisFeatureInfo(id, info)`:

```sql
UPDATE gis_data
SET info = $2::jsonb
WHERE id = $1
RETURNING id, info;
```

`info` ต้องเป็น JSON object และโค้ดจำกัดขนาดข้อมูลที่ serialize แล้วไม่เกิน 65,536 ตัวอักษร

### ลบ feature

ใช้ `deleteGisFeature(id)`:

```sql
DELETE FROM gis_data
WHERE id = $1
RETURNING id;
```

### บันทึก config

ตัวอย่างเพิ่มหรือแก้ไข config โดยไม่เก็บค่าลับไว้ใน source code:

```ts
const database = await getDatabase()

await database.query(
  `INSERT INTO config (name, value)
   VALUES ($1, $2)
   ON CONFLICT (name)
   DO UPDATE SET value = EXCLUDED.value`,
  ['GISTDA_API_KEY', apiKey]
)
```

อ่านค่าด้วย `getConfigValue(name)`

## การเรียกจาก renderer

เพื่อความปลอดภัย renderer ไม่เชื่อมฐานข้อมูลโดยตรง เส้นทางการทำงานคือ:

```text
React renderer
  -> window.api (contextBridge)
  -> ipcRenderer.invoke(...)
  -> ipcMain.handle(...)
  -> ฟังก์ชันใน src/main/database.ts
  -> PGlite/PostGIS
```

API ที่มีอยู่ใน [`src/preload/index.ts`](../src/preload/index.ts):

- `window.api.saveGisGeometry(geometry, info)`
- `window.api.listGisGeometry()`
- `window.api.updateGisFeatureInfo(id, info)`
- `window.api.deleteGisFeature(id)`

IPC handlers อยู่ใน [`src/main/index.ts`](../src/main/index.ts) หากเพิ่มคำสั่งฐานข้อมูลใหม่ ควรเพิ่ม type ใน `src/shared/gis.ts`, ฟังก์ชันใน `database.ts`, IPC handler ใน main และ API ที่อนุญาตใน preload ตามลำดับ

## ข้อควรระวัง

- ใช้ `$1`, `$2` และ parameter array แทนการต่อ SQL string จากข้อมูลผู้ใช้
- ตรวจสอบ geometry และ `info` ก่อนบันทึกเสมอ
- ใช้ SRID `4326` ให้ตรงกับข้อมูล GeoJSON และ Leaflet
- อย่า expose instance ของ PGlite หรือ API SQL ทั่วไปให้ renderer
- ก่อนแก้โครงสร้างตารางที่มีข้อมูลจริง ควรสำรองโฟลเดอร์ `topview-pglite` ขณะปิดแอป
