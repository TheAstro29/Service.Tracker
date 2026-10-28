# Service Tracker — PROJECT.md

ระบบติดตามงาน PM (Preventive Maintenance) ของเครื่อง AI Panolyzer สำหรับทีมช่าง บริษัท ซีทูเทค จำกัด

> อัปเดตล่าสุด: 28 ต.ค. 2569 · เวอร์ชันหน้าเว็บ `?v=20261028h`

---

## 1. ภาพรวม

| ส่วน | รายละเอียด |
|---|---|
| หน้าเว็บ | Static HTML/CSS/JS ไม่มี build step: `index.html` `style.css` `script.js` `manifest.json` `icons/` |
| หลังบ้าน | Google Apps Script โปรเจกต์ **Panolyzer_Service** (ใช้ร่วมกับแอปอื่น ดูข้อ 3) |
| ฐานข้อมูล | Google Sheet ก้อนเดียวกับ Panolyzer Management (`SPREADSHEET_ID` ใน Code.gs) |
| รูปภาพ | Google Drive โฟลเดอร์ `FOLDER_ID` (รูปหน้างาน PM + รูปโปรไฟล์) |
| ไลบรารี (CDN) | SweetAlert2 11, Chart.js 4.4.4 (โหลดไว้แต่หน้าใหม่ไม่ใช้แล้ว), html2canvas 1.4.1, Font Awesome 6.5.2, Google Fonts (Chakra Petch, Sarabun) |
| ธีม | C2TECH CI: เขียว `#3F654D` / `#22392b`, ตัวอักษร Chakra Petch |

### ที่อยู่ไฟล์บนเครื่อง

- หน้าเว็บ: `C:\Users\C2TECH\OneDrive\Desktop\C2TECH Http\Service Tracker\`
- Code.gs ฉบับล่าสุด (สำเนาสำหรับวางใน Apps Script): ไฟล์ `Code.gs` ในโฟลเดอร์เดียวกัน
- โฟลเดอร์ `backup-before-<งาน>-<วันที่>\` = ไฟล์ก่อนแก้แต่ละรอบ (ไม่ต้องอัปโหลดขึ้นโฮสต์)
- โฟลเดอร์นี้ไม่มี git และอยู่ใน OneDrive (OneDrive อาจย้อนไฟล์ได้ ตรวจไฟล์หลังแก้ทุกครั้ง)

---

## 2. ลำดับการเข้าแอป

```
เปิดแอป
 ├─ มี token ในเครื่อง → หน้าโหลด (splash) → หน้าหลัก (ตรวจสิทธิ์ล่าสุดกับหลังบ้านเบื้องหลัง)
 └─ ไม่มี token      → หน้าโหลด → หน้าเข้าสู่ระบบ → (โหลดข้อมูลบนหน้าเข้าสู่ระบบ) → หน้าหลัก
```

- หน้าโหลดแสดงอย่างน้อย `ST_SPLASH_MIN` = 2600 ms แตะเพื่อข้ามได้เมื่อพร้อม
- ถ้า token หมดอายุ / ถูกยกเลิก ระหว่างใช้งาน → `stSessionExpired()` ล้างข้อมูลในเครื่อง แล้วกลับหน้าเข้าสู่ระบบ
- ออกจากระบบ = ลบ token, ข้อมูลผู้ใช้ และ cache ข้อมูลเครื่องออกจากเครื่อง

---

## 3. Code.gs ใช้ร่วมกันหลายแอป (สำคัญ)

โปรเจกต์ Apps Script **Panolyzer_Service** ต้องมี 2 ไฟล์ — **ห้ามลบไฟล์ใด**

| ไฟล์ | หน้าที่ |
|---|---|
| `Code.gs` | router กลาง + Panolyzer + Service Tracker + Color Sorter |
| `AddMachine.gs` | คำสั่ง `add_machine` ของ C2-Loop (ต้นฉบับอยู่ใน `Panolyzer-main\AddMachine.gs`) |

Routing ด้วย query `?app=`

| แอป | URL | ผู้เรียก | หมายเหตุ |
|---|---|---|---|
| Panolyzer Management | URL เดิม (หรือ `?app=panolyzer`) | หน้าเว็บ Panolyzer-main, C2-Loop Cloud Functions | ใช้รหัส Admin กลาง `ADMIN_PASSWORD` |
| Color Sorter | `?app=colorsorter` | C2-Loop Cloud Functions | ใช้รหัส Admin กลาง |
| Service Tracker | `?app=service` | แอปนี้ | ใช้ระบบบัญชีผู้ใช้ + token |

ข้อควรระวัง
- Apps Script รวม `.gs` ทุกไฟล์เป็น scope เดียว ห้ามประกาศชื่อฟังก์ชัน/ค่าคงที่ซ้ำข้ามไฟล์
- `add_machine` ถูกเรียกใน `doPost` ก่อนแยกแอป (ตามที่ AddMachine.gs กำหนด)
- แก้ส่วน Service Tracker ต้องไม่กระทบ Panolyzer / Color Sorter — ทดสอบทั้ง 3 แอปหลัง deploy
- `ADMIN_PASSWORD` ยังใช้กับ Panolyzer / Color Sorter (และ secret ฝั่ง C2-Loop) ถ้าจะเปลี่ยนต้องเปลี่ยนทุกที่พร้อมกัน **ห้ามใส่รหัสนี้ในเอกสารหรือแชท**

---

## 4. Google Sheet

ทุกคอลัมน์หาจาก **ชื่อหัวตาราง** ไม่ใช้ตำแหน่งตายตัว (ยกเว้น 10 คอลัมน์แรกของ Users และชีต log ที่ระบบสร้างเอง)

### `Panolyzer Data` (ใช้ร่วมกับ Panolyzer)
`S/N Analyzer`, `Client name`, `Location`, `Model`, `Mode`, `Type`, `Status`, `Status_Year`, `Admin_Note`,
`PM1_Date` `PM1_Status` `PM1_Photo` `PM1_GPS` `PM1_Tech` (และ PM2 / PM3 แบบเดียวกัน)

- `PMn_Date` = วันนัด · `PMn_Status` = วันที่ปิดงานจริง (ISO) · ว่าง = ยังไม่ปิด
- เครื่องที่ไม่มีวันนัด PM เลย (เช่นเครื่องใน stock) ไม่แสดงในแอป · `Status = TEST` ไม่นับ
- ปิด PM1 → คำนวณ PM2 = +4 เดือน, PM3 = +8 เดือน จากวันปิดงาน · ปิด PM2 → PM3 = +4 เดือน

### `Users`
คอลัมน์ 1–10 (ตำแหน่งตายตัว): `UserID` `Username` `Full Name` `PasswordHash` `Salt` `Photo` `Position` `Gender` `Birthdate` `Status`
คอลัมน์เสริม (หาจากชื่อหัว ถ้าไม่มีระบบเพิ่มต่อท้ายเอง): `Role` `TokenVer` `LastLogin`

- `Role`: `admin` / `staff` / `guest` · ช่องว่าง = staff
- `Status`: `Active` / `Inactive`
- `TokenVer`: เลขรุ่นของ session — เพิ่มขึ้นเมื่อเปลี่ยนสิทธิ์ / ปิดบัญชี / รีเซ็ตรหัส / บังคับออก → token เดิมใช้ไม่ได้ทันที
- ชีตจริงมีคอลัมน์ K อีก 1 คอลัมน์ (ข้อมูลเวลา) ระบบไม่แตะ

### ชีตที่ระบบสร้างเอง
| ชีต | คอลัมน์ |
|---|---|
| `PM_Parts_Log` | LogID, S/N, PM_Round, Part_Name, Qty, Note, Tech, Timestamp, UserID |
| `PM_History` | HistoryID, S/N, PM_Round, PM_Date, Status_Date, GPS, Photo_URL, Tech, Renewal_Cycle, Archived_At |
| `Audit_Log` | Timestamp, Actor, Actor_Role, Action, Target (S/N หรือ username), Detail (JSON) |

- `PM_History` เขียนตอนต่ออายุสัญญา (เก็บ PM รอบเดิมก่อนล้าง)
- `Audit_Log` บันทึก: complete_pm (พร้อมวันนัดเดิมไว้ใช้ยกเลิก), undo_pm, replace_photo, renew_service, update/delete_pm_part, user_add/update/reset_password/force_logout/delete, setup_data_validation
- `PM_Parts_Log` รายการที่บันทึกก่อนมีคอลัมน์ UserID → แก้/ลบได้เฉพาะ Admin

---

## 5. สิทธิ์ผู้ใช้ (ตรวจที่หลังบ้านทุกคำสั่ง)

| ทำอะไร | Guest | Staff | Admin |
|---|:-:|:-:|:-:|
| ดูรายการเครื่อง ประวัติ อะไหล่ | ✓ | ✓ | ✓ |
| แก้โปรไฟล์ / รหัสผ่านตัวเอง | ✓ | ✓ | ✓ |
| ถ่ายรูป ปิดงาน PM แก้หมายเหตุ | | ✓ | ✓ |
| เพิ่มอะไหล่ | | ✓ | ✓ |
| แก้/ลบอะไหล่ | | ของตัวเอง ก่อนปิดงานรอบนั้น | ทุกรายการ ทุกเมื่อ |
| ต่อสัญญา แดชบอร์ด รายงาน | | | ✓ |
| ยกเลิกการปิดงาน / เปลี่ยนรูปรอบที่ปิดแล้ว | | | ✓ |
| จัดการผู้ใช้ | | | ✓ |

กติกากันพลาด
- เปลี่ยนสิทธิ์ / ปิดบัญชี / ลบบัญชี **ของตัวเอง** ไม่ได้
- ต้องมี Admin ที่ใช้งานอยู่อย่างน้อย 1 คน
- ยกเลิกการปิดงานได้เฉพาะรอบล่าสุดที่ปิด และต้องใส่เหตุผล

### ระบบยืนยันตัวตน
- `user_login` → token แบบลงลายเซ็น HMAC (`uid|ver|exp`) อายุ `SESSION_DAYS` = 30 วัน · secret เก็บใน Script Properties `ST_SESSION_SECRET` (สร้างเองครั้งแรก)
- ทุกคำสั่งส่ง `token` ใน body (POST text/plain JSON) · หลังบ้านอ่านสิทธิ์/สถานะจากชีตทุกครั้ง
- รหัสผ่าน: SHA-256 วนซ้ำ `PW_ITERATIONS` = 1000 รอบ (prefix `v2$`) · รหัสแบบเก่าอัปเกรดให้เองตอน login
- กรอกผิด 5 ครั้ง พัก 15 นาที (CacheService) · รหัสใหม่ขั้นต่ำ 8 ตัว
- username ไม่สนตัวพิมพ์เล็ก/ใหญ่ · ใช้ a-z 0-9 . _ - ได้ 3–30 ตัว

### `SERVICE_LEGACY_MODE` (บรรทัดค่าคงที่ใน Code.gs)
- `true` = หน้าเว็บตัวเก่ายังใช้ได้ (ไม่ต้อง login / รหัส Admin กลาง) **ช่วงเปลี่ยนผ่านเท่านั้น**
- `false` = Service Tracker ต้อง login ทุกคำสั่ง, GET `?app=service` ปิด
- **งานค้าง:** เปลี่ยนเป็น `false` แล้ว deploy ใหม่ หลังทุกเครื่องใช้หน้าเว็บใหม่แล้ว

---

## 6. คำสั่ง API (`?app=service`, POST)

| คำสั่ง | สิทธิ์ขั้นต่ำ | หน้าที่ |
|---|---|---|
| `user_login` | – | เข้าสู่ระบบ → `{ user, token, expiresAt }` |
| `auth_me` / `user_logout` | guest | ตรวจ session / ออกจากระบบ |
| `get_machines` | guest | รายการเครื่องทั้งหมด |
| `get_pm_parts` | guest | อะไหล่ของเครื่อง `{ PM1:[], PM2:[], PM3:[] }` |
| `get_pm_history` | guest | ประวัติรอบสัญญาก่อน |
| `user_edit` / `user_photo` | guest | แก้โปรไฟล์ตัวเอง (เปลี่ยนรหัสคืน token ใหม่) / อัปโหลดรูปโปรไฟล์ |
| `photo` | staff | อัปโหลดรูปหน้างาน (เฉพาะรอบที่ยังไม่ปิด) |
| `complete_pm` | staff | ปิดงาน (ต้องมีรูป + GPS, ปิดตามลำดับ, ชื่อช่างจาก session) |
| `update_note` | staff | หมายเหตุเครื่อง (`Admin_Note`) |
| `log_pm_parts` / `log_pm_part` | staff | บันทึกอะไหล่หลายรายการ / ทีละรายการ (แบบเก่า) |
| `update_pm_part` / `delete_pm_part` | staff* | แก้/ลบอะไหล่ (*ตรวจเจ้าของ + รอบยังไม่ปิด, Admin ได้ทั้งหมด) |
| `get_part_names` | staff | ชื่ออะไหล่เรียงตามความถี่ |
| `renew_service` | admin | ต่อสัญญา (เก็บ PM เดิมลง PM_History แล้วตั้ง PM1 ใหม่) |
| `undo_info` / `undo_pm` | admin | ข้อมูลก่อนยกเลิก / ยกเลิกการปิดงาน (คืนวันนัดเดิมจาก Audit_Log หรือวันที่ Admin ยืนยัน) |
| `replace_photo` | admin | เปลี่ยนรูปรอบที่ปิดแล้ว (รูปเดิมไปถังขยะ Drive 30 วัน) |
| `get_edit_log` | admin | ประวัติการแก้ไขของเครื่อง |
| `pm_stats`, `service_report_data` | admin | ข้อมูลแบบเก่า (หน้าใหม่ไม่ได้ใช้แล้ว) |
| `report_extra` | admin | ประวัติรอบก่อน + อะไหล่ทั้งหมด สำหรับแดชบอร์ด/รายงาน |
| `setup_data_validation` | admin | dropdown ในชีต Users (Role / Status / เพศ) |
| `user_list` `user_add` `user_update` `user_reset_password` `user_force_logout` `user_delete` | admin | จัดการผู้ใช้ |

รูปแบบ error: `{ status: "error", message, code? }` · `code: "AUTH"` = ต้องเข้าระบบใหม่, `"FORBIDDEN"` = สิทธิ์ไม่พอ, `"NEED_DATES"` = ต้องยืนยันวันนัดก่อนยกเลิก
คำสั่งที่เขียนข้อมูลใช้ `LockService` กันชนกัน

---

## 7. หน้าเว็บ — แผนที่โค้ด (`script.js`)

| ส่วน | ฟังก์ชันหลัก |
|---|---|
| Session / สิทธิ์ | `stApplyRole` `stCanEdit` `stGuard` `stBody` `stFetch` `stSaveSession` `stClearSession` `stSessionExpired` |
| หน้าโหลด | `stSplashTick` `stSplashSetReady` `stSplashFinish` `stLoaderStep` |
| เข้าสู่ระบบ / เมนูผู้ใช้ | `stShowLogin` `stDoLogin` `stVerifySession` `logoutUser` `openUserMenu` |
| ข้อมูล / รายการ | `loadData` `stCompute` `render` `runFilters` `stCardHtml` `toggleDetail` `renderDetail` |
| แจ้งเตือน | `checkNotice` `stTrackOverdue` `stShowToast` (รีเฟรชอัตโนมัติทุก 15 นาที) |
| คอมโพเนนต์กลาง | `stSheet` (แผ่นเลื่อน/หน้าต่าง) · `stPop` (เมนู ⋯) · `stApi` · `stWords` (ตัดคำที่ช่องว่าง) |
| กล้อง / รูป | `stCamera` `capturePhotoForStep` `stPostPhoto` `uploadImageForStep` `resizeImageDataUrl` |
| ปิดงาน PM | `stOpenClose` (GPS ด้วย watchPosition, รับเมื่อ ±50 ม. หรือดีที่สุด, สำรองแบบเร็วหลัง 20 วิ) |
| อะไหล่ | `stPartsPicker` `buildPartsChipsHtml` `stPartMenu` `stEditPart` `deletePart` `stCanEditPart` |
| รูปยืนยันงาน LINE | `printServiceSlip` (html2canvas + Web Share API) |
| โปรไฟล์ | `openUserProfileModal` `openUserProfileEditModal` `stChangePassword` |
| ต่อสัญญา | `renewService` `stRenewPreview` `stRenewDates` |
| ประวัติ | `stLoadHistory` `stLoadEditLog` (เปิดดูแบบพับ/กาง, cache ต่อเครื่อง) |
| Admin รอบที่ปิดแล้ว | `stStepMenu` `stUndoPm` `stReplacePhoto` |
| จัดการผู้ใช้ | `umOpen` `umRenderList` `umRenderPanel` `umCreate` `umSaveEdit` `umResetPw` `umForceLogout` `umDelete` |
| แดชบอร์ด | `openPmDashboard` `dbCompute` `dbRender` (คำนวณจาก appData + `report_extra`) |
| รายงาน | `openReportModal` `rpUpdate` `rpDocHtml` `rpPrint` `rpLineImage` `rpCsv` |

ค่าที่ปรับได้
- `DB_GRACE_DAYS` = 7 → นิยาม "ตรงเวลา" (ทำเสร็จไม่เกิน 7 วันหลังวันนัด)
- `COMMON_PARTS` → รายชื่ออะไหล่เริ่มต้น
- `ST_SPLASH_MIN` → เวลาแสดงหน้าโหลดขั้นต่ำ

localStorage (เฉพาะเครื่อง)
- `c2tech_service_token`, `current_user` — session
- `c2tech_service_data_v1` — cache ข้อมูลเครื่อง (ลบเมื่อออกจากระบบ)
- `c2tech_service_notice_mute` — "ไม่ต้องเตือนอีกวันนี้"
- `c2tech_report_opts` — ตัวเลือกหน้าสร้างรายงาน

z-index: รายละเอียดเครื่อง 900 · หน้าเต็ม (จัดการผู้ใช้/แดชบอร์ด/รายงาน) 1000 · เมนูผู้ใช้ 1040 · แผ่นเลื่อน 2100+ · แจ้งเตือน PM 2500 · เข้าสู่ระบบ 2900 · กล้อง/หน้าโหลด 3000 · เมนู ⋯ 3100 · SweetAlert 3200

---

## 8. วิธี Deploy

**หลังบ้าน (เมื่อ Code.gs เปลี่ยน)**
1. คัดลอกโค้ดปัจจุบันใน Apps Script เก็บไว้ก่อน (สำรอง)
2. วาง `Code.gs` ใหม่ทับไฟล์ Code.gs ใน Apps Script (เก็บ `AddMachine.gs` ไว้)
3. Deploy → Manage deployments → แก้ไข deployment เดิม → Version: **New version** → Deploy (URL ไม่เปลี่ยน)
4. ทดสอบ Service Tracker + Panolyzer + Color Sorter (C2-Loop)

**หน้าเว็บ**
1. อัปโหลด `index.html` `script.js` `style.css` (ไม่ต้องอัปโหลดโฟลเดอร์ backup)
2. เปลี่ยนเลข `?v=` ใน index.html ทุกครั้งที่แก้ เพื่อให้เบราว์เซอร์โหลดไฟล์ใหม่

**ลำดับ:** deploy Code.gs ก่อนเสมอ แล้วค่อยอัปโหลดหน้าเว็บ (หน้าเว็บใหม่เรียกคำสั่งที่ Code.gs เก่าไม่มี)

**ตั้ง Admin คนแรก:** พิมพ์ `admin` ในคอลัมน์ Role ของตัวเองในชีต Users แล้วออก-เข้าระบบใหม่

---

## 9. การทดสอบ

ทดสอบด้วยการจำลอง Apps Script ใน Node.js (จำลอง SpreadsheetApp, Utilities, CacheService, PropertiesService, LockService, DriveApp) แล้วโหลด Code.gs ตัวจริงมารัน + Playwright ทดสอบหน้าเว็บบน PC/มือถือ โดยให้ request ไปยัง Code.gs ตัวจำลอง

ชุดทดสอบที่ผ่านแล้ว (28 ต.ค. 69): สิทธิ์/ token (69 ข้อ), Panolyzer + Color Sorter + add_machine (18), ชีต Users ที่มีคอลัมน์แทรก (6), อะไหล่ + ยกเลิกปิดงาน + เปลี่ยนรูป (29)
ยังไม่ได้ทดสอบกับ Apps Script จริง — ทดสอบด้วยมือหลัง deploy ทุกครั้ง

เช็คลิสต์หลัง deploy
- [ ] เข้าระบบ Admin / Staff / Guest ได้ และเห็นเมนูตามสิทธิ์
- [ ] ถ่ายรูป → เพิ่มอะไหล่ → ปิดงาน PM (GPS) → สร้างรูปส่ง LINE
- [ ] Admin: ยกเลิกการปิดงาน + เปลี่ยนรูป + ดูประวัติการแก้ไข
- [ ] แดชบอร์ด / รายงาน PDF / รูป LINE / CSV
- [ ] Panolyzer Management แก้ข้อมูลเครื่องได้ · C2-Loop เบิก/คืน/เพิ่มเครื่องได้

---

## 10. ประวัติการเปลี่ยนแปลง (28 ต.ค. 2569)

| รอบ | สิ่งที่ทำ | backup |
|---|---|---|
| redesign | ออกแบบหน้าหลัก + แผงรายละเอียดใหม่ (frontend อย่างเดียว) | `backup-before-redesign-20261028` |
| splash | หน้าโหลดแสดงนานขึ้น เห็น animation ครบ | `backup-before-splash-20261028` |
| notice | ระบบแจ้งเตือนงาน PM ใหม่ + toast + รีเฟรชอัตโนมัติ | `backup-before-notice-20261028` |
| hide-nopm | ซ่อนเครื่องที่ไม่มีวันนัด PM | `backup-before-hide-nopm-20261028` |
| roles | สิทธิ์ 3 ระดับ + token + หน้าจัดการผู้ใช้ + หน้าเข้าสู่ระบบ + ตัดคำภาษาไทย | `backup-before-roles-20261028` |
| roles fix | คง `add_machine` ของ C2-Loop · หาคอลัมน์ Role/TokenVer จากชื่อหัว | – |
| dashboard | แดชบอร์ดและหน้าสร้างรายงานใหม่ + `report_extra` | `backup-before-dashboard-20261028` |
| v5 | อะไหล่แบบตะกร้า, ปิดงานหน้าเดียว, กล้องใหม่, รูป LINE ใหม่, โปรไฟล์, ต่อสัญญาดูวันก่อน, ประวัติ, Admin ยกเลิกปิดงาน/เปลี่ยนรูป, ธีมกล่องแจ้งเตือน | `backup-before-v5-20261028` |
| order | ลำดับเปิดแอป หน้าโหลด → เข้าสู่ระบบ → หน้าหลัก | `backup-before-order-20261028` |

---

## 11. งานค้าง / ไอเดียต่อไป

- [ ] เปลี่ยน `SERVICE_LEGACY_MODE = false` แล้ว deploy (หลังทุกเครื่องใช้หน้าเว็บใหม่)
- [ ] เปลี่ยนรหัส Admin กลาง (ใช้ใน Panolyzer, Color Sorter, secret C2-Loop) — รหัสเคยถูกวางในแชท
- [ ] ข้อมูลเครื่องผ่าน Panolyzer (URL เดิม) ยังเปิดอ่านได้โดยไม่ต้อง login (อยู่นอกขอบเขต Service Tracker)
- [ ] หน้า "ตั้งค่าป้องกันข้อมูลผิด" ได้แค่ธีมใหม่ ยังไม่ได้ออกแบบหน้าใหม่
- [ ] เอา Chart.js และฟังก์ชันเก่าที่ไม่ใช้แล้วออก (`openAdminMenu`, `pm_stats`/`service_report_data` ฝั่งหน้าเว็บ) เพื่อให้ไฟล์เล็กลง
- [ ] Audit_Log โตขึ้นทุกครั้งที่ปิดงาน — พิจารณาเก็บถาวร/ย้ายแถวเก่าเมื่อเกินหลายพันแถว
- [ ] (ตัดสินใจแล้วว่าไม่ทำ) เชื่อมการเปลี่ยนอะไหล่กับสต็อก C2-Loop — ซับซ้อนเกินไปสำหรับผู้ใช้
