const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwTreMfsLHYUq7TEW8nu7brQKyuLL-ALyRRa4pdzNFopY-TlRg4UXo3Ei4AVLk-KOv0/exec?app=service";
let appData = [];
let currentMode = 'all';

// Toast แจ้งเตือนเล็กๆ มุมขวาบน ใช้แทน popup เต็มจอเวลาบันทึกสำเร็จ (ไม่บล็อกการใช้งานต่อ)
const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 2000,
    timerProgressBar: true
});

// 1. กำหนดรหัสผ่านและการเข้าถึง
let isAdmin = false;
let adminPasswordCache = ''; // เก็บรหัสไว้ใน memory เท่านั้น เพื่อส่งให้ backend เช็คซ้ำทุกครั้งที่ Renew
const _0x1a2b = "MTkwOTE1MTI="

// ผู้ใช้งานที่ login อยู่ปัจจุบัน (คนละระบบกับ Admin) — เก็บไว้ใน localStorage ให้จำ session ไว้ข้ามการเปิดแอปใหม่
let currentUser = JSON.parse(localStorage.getItem('current_user') || 'null');

// ฟังก์ชันเข้าสู่ระบบ Admin
async function adminAuth() {
    if (isAdmin) {
        isAdmin = false;
        adminPasswordCache = '';
        document.getElementById('lockIcon').className = 'fas fa-lock admin-login-btn';
        document.getElementById('adminMenuIcon').style.display = 'none';
        Swal.fire({ icon: 'info', title: 'ออกจากระบบ Admin', timer: 1000, showConfirmButton: false });
        render();
        return;
    }

    const { value: password } = await Swal.fire({
        title: 'Admin Access',
        html: passwordFieldHtml('admin-pw-input', 'Password'),
        confirmButtonColor: '#1b4332',
        showCancelButton: true,
        cancelButtonText: 'ยกเลิก',
        didOpen: () => wireTogglePassword('admin-pw-input'),
        preConfirm: () => document.getElementById('admin-pw-input').value
    });

    if (password === undefined) return; // กดยกเลิก

    if (btoa(password) === _0x1a2b) {
        isAdmin = true;
        adminPasswordCache = password;
        document.getElementById('lockIcon').className = 'fas fa-lock-open admin-login-btn active';
        document.getElementById('adminMenuIcon').style.display = 'inline-flex';
        Swal.fire({ icon: 'success', title: 'ยินดีต้อนรับ Admin', timer: 1000, showConfirmButton: false });
        render();
    } else if (password) {
        Swal.fire({ icon: 'error', title: 'รหัสผ่านไม่ถูกต้อง' });
    }
}
const CACHE_KEY = "c2tech_service_data_v1";

// โหลดข้อมูลที่ cache ไว้ล่าสุดมาโชว์ก่อนทันที (ระหว่างรอ fetch ข้อมูลใหม่จริงจาก Sheets)
// ช่วยเวลาเน็ตช้า/หลุดที่หน้างาน อย่างน้อยยังเห็นข้อมูลล่าสุดที่เคยโหลดได้ ไม่ใช่หน้าขาวรอเฉยๆ
function loadFromCache() {
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
            appData = JSON.parse(cached);
            render();
            document.getElementById('loading').style.display = 'none';
            return true; // มี cache ให้แสดงแล้ว — ใช้บอก loadData() ว่าไม่ต้องโชว์ loader ซ้ำตอนโหลดจริงตามมา
        }
    } catch (e) {
        console.error("Load cache error:", e);
    }
    return false;
}

// skipLoader = true: ใช้ตอนเปิดแอปครั้งแรกที่ loadFromCache() แสดงข้อมูลเก่าให้เห็นไปแล้ว จะได้ไม่ต้องกระพริบ
// loader เต็มจอซ้ำอีกรอบระหว่างรอข้อมูลจริงจาก Sheets (เดิมกระพริบทุกครั้งที่เปิดแอปทั้งที่มี cache อยู่แล้ว)
// ไม่กระทบ checkNotice() ซึ่งยังทำงานตามปกติ (อิง silent เท่านั้น) เพราะอยากให้แจ้งเตือนเสียงตอนเปิดแอปเหมือนเดิม
async function loadData(silent = false, skipLoader = false) {
    if (!silent && !skipLoader) {
        document.getElementById('refreshIcon').classList.add('fa-spin');
        document.getElementById('loading').style.display = 'block';
    }
    try {
        const res = await fetch(SCRIPT_URL);
        appData = await res.json();
        render();
        localStorage.setItem(CACHE_KEY, JSON.stringify(appData)); // เก็บ cache ไว้ใช้ครั้งหน้า
        if (!silent) checkNotice(); // แจ้งเตือนเสียง/popup เฉพาะตอนโหลดแบบเต็ม ไม่ใช่ตอน silent refresh
    } catch (e) {
        console.error("Load data error:", e);
        if (!silent) Swal.fire('Error', 'โหลดข้อมูลไม่สำเร็จ (แสดงข้อมูลล่าสุดที่เคยบันทึกไว้แทน)', 'error');
    }
    finally {
        if (!silent && !skipLoader) {
            document.getElementById('refreshIcon').classList.remove('fa-spin');
            document.getElementById('loading').style.display = 'none';
        }
    }
}

function checkNotice() {
    const overdueCount = parseInt(document.getElementById('cnt-overdue').innerText) || 0;
    const urgentCount = parseInt(document.getElementById('cnt-urgent').innerText) || 0;

    if (overdueCount > 0 || urgentCount > 0) {
        playNoticeSound();

        Swal.fire({
            // --- แก้ไขบรรทัดนี้เพื่อปรับขนาด Font ---
            title: '<span style="font-size: 24px; font-weight: 800;">พบรายการต้องดำเนินการ!</span>',
            html: `
                        <div style="text-align: left; padding: 10px;">
                            <p style="color: #e11d48; font-weight: bold; font-size: 18px;">🔴 เลยกำหนด: ${overdueCount} รายการ</p>
                            <p style="color: #fb8500; font-weight: bold; font-size: 18px;">🟠 ใกล้กำหนด (7 วัน): ${urgentCount} รายการ</p>
                        </div>
                    `,
            icon: overdueCount > 0 ? 'error' : 'warning',
            confirmButtonText: 'รับทราบ (ปิดเสียง)',
            confirmButtonColor: '#1b4332',
        });
    }
}

function playNoticeSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        // ฟังก์ชันช่วยสร้างเสียงสั้นๆ
        const play = (freq, time) => {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.type = 'sine'; // ใช้เสียงใสๆ
            o.frequency.value = freq;
            g.gain.setValueAtTime(0.1, audioCtx.currentTime + time);
            g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + time + 0.1);
            o.connect(g);
            g.connect(audioCtx.destination);
            o.start(audioCtx.currentTime + time);
            o.stop(audioCtx.currentTime + time + 0.1);
        };

        // เล่น 2 จังหวะ (ติ๊ด-ตึ๊ด)
        play(1000, 0);
        play(1200, 0.15);

        // ปิด AudioContext หลังเสียงเล่นจบ (เสียงจบที่ 0.15+0.1=0.25s เผื่อเวลาไว้หน่อยเป็น 400ms)
        // เดิมไม่เคยปิดเลย เปิดแอปทิ้งไว้นานๆ แล้วมีรายการเลยกำหนด/ใกล้กำหนดขึ้นมาเรื่อยๆ (เช่น auto-refresh)
        // จะสร้าง AudioContext ใหม่ทุกครั้งโดยไม่ปิดของเก่า สะสมจนชนขีดจำกัดที่เบราว์เซอร์อนุญาต (เช่น ~6 บน Chrome)
        // แล้วเสียงแจ้งเตือนจะเงียบไปเฉยๆ โดยไม่มี error ให้เห็น
        setTimeout(() => { audioCtx.close().catch(() => {}); }, 400);

    } catch (e) {
        console.log("Audio play error:", e);
    }
}

// ป้องกัน XSS: escape อักขระที่มีความหมายพิเศษใน HTML ก่อนแสดงผลข้อมูลที่มาจาก Sheets/ฟอร์ม
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// สร้าง HTML ของช่องกรอกรหัสผ่านที่มีปุ่มรูปตาไว้ดู/ซ่อนรหัสผ่านที่พิมพ์ ใช้ร่วมกันได้ทุกฟอร์มในแอป
// หลังใส่ html นี้แล้ว ต้องเรียก wireTogglePassword(id) ใน didOpen ของ Swal ด้วยเสมอ ไม่งั้นปุ่มจะไม่ทำงาน
function passwordFieldHtml(id, placeholder, style, autocomplete) {
    return `
        <div style="position:relative; ${style || 'margin:0;'}">
            <input type="password" id="${id}" class="swal2-input" placeholder="${escapeHtml(placeholder)}" style="margin:0; width:100%; padding-right:42px;" autocomplete="${autocomplete || 'off'}">
            <button type="button" id="${id}-toggle" tabindex="-1" style="position:absolute; right:8px; top:0; bottom:0; background:none; border:none; color:#94a3b8; cursor:pointer; font-size:15px; padding:0 8px;">
                <i class="fas fa-eye"></i>
            </button>
        </div>
    `;
}

// เชื่อมปุ่มรูปตาให้ทำงานจริง (สลับ type ระหว่าง password/text) — เรียกใน didOpen ของ Swal
function wireTogglePassword(inputId) {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(`${inputId}-toggle`);
    if (!input || !btn) return;
    btn.onclick = () => {
        const willShow = input.type === 'password';
        input.type = willShow ? 'text' : 'password';
        btn.innerHTML = willShow ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
    };
}

// แปลง Google Drive URL แบบ "หน้า Preview" (.../file/d/ID/view) ให้เป็น URL แบบ direct-image
// (lh3.googleusercontent.com) ที่ใช้กับ <img src="..."> ได้จริง — เผื่อมีรูปเก่าที่เคยเก็บ URL ผิดแบบไว้ก่อนแก้บั๊ก
// ถ้า url ไม่ตรง pattern นี้ (เช่นเป็น URL ที่ถูกต้องอยู่แล้ว) จะคืนค่าเดิมโดยไม่แก้อะไร
function toDriveImageUrl(url) {
    if (!url) return url;
    const match = String(url).match(/\/file\/d\/([^/]+)/);
    if (match && match[1]) {
        return `https://lh3.googleusercontent.com/d/${match[1]}`;
    }
    return url;
}

function render() {
    const main = document.getElementById('serviceList');
    // จำไว้ก่อนล้าง DOM ว่าการ์ดไหนกำลังกางรายละเอียดอยู่ + ตำแหน่งสกรอลปัจจุบัน — เพราะ render() ถูกเรียกซ้ำ
    // ทุกครั้งหลังบันทึกข้อมูลสำเร็จ (ผ่าน loadData(true)) ถ้าไม่จำไว้ การ์ดที่เพิ่งเปิดดู/กำลังกรอกอยู่จะปิดตัวเอง
    // และหน้าจอเด้งกลับไปบนสุดทุกครั้งที่ติ๊กเช็ค PM หรืออัปโหลดรูป ทั้งที่ผู้ใช้ยังทำงานกับการ์ดนั้นอยู่
    const openSns = Array.from(main.querySelectorAll('.detail-mode.show')).map(el => el.id.replace('detail-', ''));
    const scrollY = window.scrollY;
    main.innerHTML = '';
    const now = new Date();
    const limit = new Date(); limit.setDate(now.getDate() + 7);
    const isHideComplete = document.getElementById('hideCompleteSwitch') ? document.getElementById('hideCompleteSwitch').checked : false;



    appData.forEach(m => {
        const sn = (m["S/N Analyzer"] || m["SN"] || m["S/N"] || "").toString().trim();
        if (!sn || (m["Status"] || "").toUpperCase() === "TEST") return;
        if (isHideComplete && !!m["PM3_Status"]) return;

        const modeVal = m["Mode"] || "-"; // เช่น Paddy, Milled rice
        const typeVal = m["Type"] || "-"; // เช่น Lab, Real-time
        const client = m["ชื่อลูกค้า"] || m["Client name"] || "ไม่ระบุชื่อ";
        const location = m["จังหวัด"] || m["Location"] || "ไม่ระบุจังหวัด";
        const modelVal = m["Model"] || "-";
        const statusYearVal = (m["Status_Year"] || m["status_year"] || "").toString().trim();
        const isRenewed = statusYearVal.includes("ต่อรายปี");
        let stepsHTML = '';
        let cardState = '';
        let prevStepDone = true; // PM1 ไม่มีเงื่อนไขก่อนหน้า จึงเริ่มที่ true

        [1, 2, 3].forEach((idx) => {
            const plannedDateVal = m[`PM${idx}_Date`];
            const activeDateVal = m[`PM${idx}_Status`];
            const photoUrl = m[`PM${idx}_Photo`];
            const gpsVal = m[`PM${idx}_GPS`];
            const techVal = m[`PM${idx}_Tech`];
            if (!plannedDateVal) return;
            const pDate = new Date(plannedDateVal);
            const isDone = !!activeDateVal;
            const actualDate = isDone ? new Date(activeDateVal).toLocaleDateString('en-GB') : '';
            const baseState = isDone ? 'done' : (pDate < now ? 'overdue' : (pDate <= limit ? 'urgent' : ''));

            // ป้องกันการกดข้ามขั้น: ต้องปิดงาน PM ก่อนหน้าให้เสร็จก่อน ถึงจะเปิดให้กด checkbox รอบนี้ได้
            const isLocked = !isDone && !prevStepDone;
            // บังคับให้แนบรูปหน้างานก่อน จึงจะติ๊กเช็คปิดงานได้ (กันลืมถ่ายรูปหลักฐาน)
            const needsPhoto = !isDone && !isLocked && !photoUrl;

            // สำคัญ: ใส่ locked/needs-photo เป็น class "เสริม" ต่อจาก baseState เสมอ ห้ามเขียนทับ overdue/urgent เดิม
            // เพราะ runFilters() นับจำนวนเลยกำหนด/ใกล้กำหนดจาก class .pm-step.overdue / .pm-step.urgent ตรงๆ
            // ถ้าเขียนทับ จะทำให้รายการที่เลยกำหนดแต่ยังไม่แนบรูป (ซึ่งเป็นเกือบทุกรายการ) หายไปจากการนับทันที
            let stepState = baseState;
            if (isLocked) stepState += ' locked';
            else if (needsPhoto) stepState += ' needs-photo';

            if (!isDone && !isLocked) {
                if (baseState === 'overdue') cardState = 'card-overdue';
                else if (baseState === 'urgent' && cardState !== 'card-overdue') cardState = 'card-urgent';
            }

            const checkboxTitle = isLocked ? `ต้องปิดงาน PM${idx - 1} ให้เสร็จก่อน` : (needsPhoto ? 'ต้องแนบรูปหน้างานก่อน' : '');

            stepsHTML += `
                    <div class="pm-step ${stepState}">
                        <input type="checkbox" onchange="handleCheck(this,'${sn}','PM${idx}')" ${isDone ? 'checked disabled' : ''} ${(isLocked || needsPhoto) ? 'disabled' : ''} title="${checkboxTitle}">
                        <div class="step-info">
                            <div style="font-weight: 700; display:flex; align-items:center; gap:6px;">
                                PM รอบที่ ${idx}
                                ${isLocked ? `<span style="font-size:10px; font-weight:700; color:#94a3b8; background:#f1f5f9; padding:2px 8px; border-radius:999px;"><i class="fas fa-lock"></i> รอ PM${idx - 1}</span>` : ''}
                                ${needsPhoto ? `<span style="font-size:10px; font-weight:700; color:#c2410c; background:#ffedd5; padding:2px 8px; border-radius:999px;"><i class="fas fa-camera"></i> ต้องแนบรูปก่อน</span>` : ''}
                            </div>
                            <div style="font-size: 11px; color: var(--text-sub);">แผน: ${pDate.toLocaleDateString('en-GB')}</div>
                            ${isDone ? `<div style="font-size: 11px; color: var(--success); font-weight: bold;"><i class="fas fa-check-circle"></i> เข้าจริง: ${actualDate}</div>` : ''}
                            ${isDone && techVal ? `<div style="font-size: 11px; color: var(--text-sub);"><i class="fas fa-user"></i> ผู้ปฏิบัติงาน: ${escapeHtml(techVal)}</div>` : ''}
                            ${photoUrl ? `<a href="${escapeHtml(photoUrl)}" target="_blank" style="color:var(--secondary); font-size:11px; text-decoration:none; margin-top:3px; display:inline-block;"><i class="fas fa-image"></i> ดูรูปงาน</a>` : ''}
                            ${gpsVal && gpsVal !== 'No GPS' ? `<a href="${escapeHtml(gpsVal)}" target="_blank" style="color:#4285F4; font-size:11px; text-decoration:none; margin-top:3px; margin-left:8px; display:inline-block;"><i class="fas fa-map-marker-alt"></i> ดูตำแหน่ง GPS</a>` : ''}
                            ${isLocked ? `<div style="font-size:11px; color:#94a3b8; margin-top:4px;"><i class="fas fa-circle-info"></i> ต้องปิดงาน PM${idx - 1} ให้เสร็จก่อน จึงจะบันทึกรอบนี้ได้</div>` : ''}
                            ${!isDone && !isLocked ? `
                                <div style="margin-top:5px;">
                                    <button onclick="capturePhotoForStep('${sn}', 'PM${idx}')" style="font-size:11px; padding:5px 10px; border-radius:6px; border:none; background:${needsPhoto ? '#c2410c' : '#475569'}; color:#fff; font-weight:700; cursor:pointer;">
                                        <i class="fas fa-camera"></i> ${needsPhoto ? 'แนบรูปหน้างาน (บังคับ)' : 'ถ่ายรูปใหม่'}
                                    </button>
                                    <input type="file" id="img-${sn}-PM${idx}" accept="image/*" capture="environment" style="display:none" onchange="uploadPhotoByStep('${sn}', 'PM${idx}', this)">
                                </div>
                            ` : ''} 
                        </div>
                    </div>`;

            prevStepDone = isDone;
        });

        const card = document.createElement('div');
        card.className = `s-card ${cardState}`;
        card.setAttribute('data-sn', sn);
        card.setAttribute('data-renew', isRenewed);
        card.setAttribute('data-mode', modeVal);
        card.setAttribute('data-type', typeVal);

        // สร้างส่วน UI ของ Renew โดยเช็คเงื่อนไข isAdmin
        const renewUI = isAdmin ? `
                <div style="margin-top:15px; border-top:1px dashed var(--border); padding-top:12px;">
                    <label style="font-size:11px; font-weight:800; color:var(--primary); display:flex; align-items:center; gap:6px;"><i class="fas fa-rotate"></i> ต่ออายุ Service รายปี</label>
                    <div style="font-size:10.5px; color:var(--text-sub); margin-top:2px;">ระบุ "วันที่เริ่มสัญญารอบใหม่" ระบบจะคำนวณวันนัด PM 1-3 ให้อัตโนมัติ (ทุก 4 เดือน)</div>
                    <label for="renew-${sn}" style="font-size:10.5px; font-weight:700; color:var(--text-sub); display:block; margin-top:8px;">วันที่เริ่มสัญญาใหม่</label>
                    <div class="action-group" style="margin-top:4px;">
                        <input type="date" id="renew-${sn}" style="flex:2; padding:10px; border-radius:var(--r-md); border:1.5px solid var(--border); font-family:'Sarabun'; font-size:13px;">
                        <button class="btn-save" onclick="renewService('${sn}')" style="background:var(--secondary); flex:1;"><i class="fas fa-check"></i> เริ่มรอบใหม่</button>
                    </div>
                </div>` : '';

        card.innerHTML = `
                    ${isRenewed ? '<div class="status-badge"><i class="fas fa-star"></i> ต่อรายปี</div>' : ''} 
                    <div class="client-header">
                        <div class="client-info" onclick="toggleDetail('${sn}')">
                            <div class="client-avatar"><i class="fas fa-industry"></i></div>
                            <div>
                                <div class="client-name">${escapeHtml(client)}</div>
                                <div class="client-loc"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(location)} &nbsp;•&nbsp; S/N: ${escapeHtml(sn)}</div>
                            </div>
                        </div>
                    </div>
                    <button class="toggle-btn" onclick="toggleDetail('${sn}')" id="btn-${sn}">
                        <i class="fas fa-chevron-down"></i> ดูรายละเอียดและบันทึก
                    </button>
                    <div class="detail-mode" id="detail-${sn}">
                        <div class="device-info">
                            <div class="info-row"><span class="info-label">S/N</span><span class="info-val">${escapeHtml(sn)}</span></div>
                            <div class="info-row"><span class="info-label">Model</span><span class="info-val">${escapeHtml(modelVal)}</span></div>
                            <div class="info-row">
                                <span class="info-label">Mode / Type</span>
                                <span class="info-val">
                                    <span style="color: var(--secondary);">${escapeHtml(modeVal)}</span> / 
                                    <span style="color: var(--info);">${escapeHtml(typeVal)}</span>
                                </span>
                            </div>
                        </div>
                        <div class="pm-steps">${stepsHTML}</div>

                    <!-- ใส่ส่วน Renew UI ที่ประมวลผลแล้วตรงนี้ -->
                    ${renewUI}

                    <textarea id="n-${sn}" rows="2" placeholder="เพิ่มหมายเหตุ...">${escapeHtml(m["Admin_Note"]) || ""}</textarea>
                    <div class="action-group">
                        <button class="btn-save" style="flex: 1;" onclick="updateNote('${sn}', this)">
                            <i class="fas fa-save"></i> บันทึกหมายเหตุ
                        </button>
                    </div>
                </div>`;
        main.appendChild(card);
    });
    runFilters();

    // คืนสถานะการ์ดที่เปิดค้างไว้ก่อนหน้า + ตำแหน่งสกรอล กลับมาเหมือนเดิมหลังสร้าง DOM ใหม่เสร็จ
    openSns.forEach((sn) => {
        const el = document.getElementById(`detail-${sn}`);
        const btn = document.getElementById(`btn-${sn}`);
        if (el) el.classList.add('show');
        if (btn) btn.innerHTML = '<i class="fas fa-chevron-up"></i> ปิดรายละเอียด';
    });
    window.scrollTo(0, scrollY);
}

function toggleDetail(sn) {
    const el = document.getElementById(`detail-${sn}`);
    const btn = document.getElementById(`btn-${sn}`);
    el.classList.toggle('show');
    btn.innerHTML = el.classList.contains('show')
        ? '<i class="fas fa-chevron-up"></i> ปิดรายละเอียด'
        : '<i class="fas fa-chevron-down"></i> ดูรายละเอียดและบันทึก';
}

// ดึงพิกัด GPS จริงจากเบราว์เซอร์ แปลงเป็นลิงก์ Google Maps ให้กดดูตำแหน่งได้ทันที
// คืนค่าเป็น { link, reason } — reason จะเป็น null ถ้าสำเร็จ หรือมีข้อความอธิบายถ้าล้มเหลว (ไม่ใช่แค่ 'No GPS' เงียบๆแบบเดิม)
// กลยุทธ์: ลองแบบ high-accuracy (GPS ดาวเทียม) ก่อน ถ้า timeout/ล้มเหลว จะลองซ้ำแบบ low-accuracy (Wi-Fi/เครือข่าย เร็วกว่า)
// เพราะบนมือถือ Android การหา GPS ครั้งแรกในตึก/โรงงานมักใช้เวลานาน ทำให้ timeout สั้นเกินไปแบบเดิมพลาดบ่อย
function getGpsLink() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            resolve({ link: 'No GPS', reason: 'เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง (GPS)' });
            return;
        }

        const describeError = (err) => {
            if (err.code === 1) return 'ไม่ได้รับอนุญาตสิทธิ์เข้าถึงตำแหน่ง — กรุณาเปิดสิทธิ์ Location ให้เว็บนี้ในตั้งค่าเบราว์เซอร์';
            if (err.code === 2) return 'หาตำแหน่งไม่ได้ (สัญญาณ GPS ไม่พอ ลองออกไปที่โล่งๆ หรือเปิด Wi-Fi/เครือข่ายมือถือไว้)';
            if (err.code === 3) return 'หาตำแหน่งช้าเกินไป (timeout)';
            return 'ไม่สามารถระบุตำแหน่งได้';
        };

        const tryLowAccuracy = (firstErr) => {
            navigator.geolocation.getCurrentPosition(
                (pos) => resolve({ link: `https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`, reason: null }),
                (err2) => resolve({ link: 'No GPS', reason: describeError(firstErr || err2) }),
                { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
            );
        };

        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ link: `https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`, reason: null }),
            (err) => {
                if (err.code === 1) { resolve({ link: 'No GPS', reason: describeError(err) }); return; } // Deny แล้วไม่ต้องลองซ้ำ (ไม่มีประโยชน์)
                tryLowAccuracy(err); // timeout/หาไม่เจอ -> ลองซ้ำแบบเร็วกว่า
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
    });
}

// --- ฟังก์ชันบันทึกข้อมูลพร้อม GPS จริงและชื่อผู้ปฏิบัติงาน (ต้อง login ก่อนเท่านั้น) ---
async function handleCheck(box, sn, stepKey) {
    if (!box.checked) return;

    if (!currentUser) {
        box.checked = false;
        const doLogin = await Swal.fire({
            icon: 'info',
            title: 'ต้องเข้าสู่ระบบก่อน',
            text: 'กรุณาเข้าสู่ระบบด้วยบัญชีของคุณก่อน จึงจะบันทึกการเข้า PM ได้ (เพื่อระบุตัวผู้ปฏิบัติงานให้ถูกต้อง)',
            showCancelButton: true,
            confirmButtonText: 'เข้าสู่ระบบ',
            confirmButtonColor: '#1b4332',
            cancelButtonText: 'ยกเลิก'
        });
        if (doLogin.isConfirmed) await showLoginModal();
        return;
    }

    const confirm = await Swal.fire({
        title: 'ยืนยันปิดงาน?',
        html: `<p style="margin:0; color:#475569;">บันทึกในนามของ <b>${escapeHtml(currentUser.name)}</b> ใช่หรือไม่?</p>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#1b4332',
        confirmButtonText: 'ตกลง',
        cancelButtonText: 'ยกเลิก'
    });

    if (!confirm.isConfirmed) { box.checked = false; return; }

    const techName = currentUser.name;

    // บังคับให้ต้องได้ตำแหน่ง GPS จริงก่อนถึงจะบันทึกปิดงานได้ — วนลองใหม่ได้ไม่จำกัดครั้ง หรือกดยกเลิกออกได้ทุกเมื่อ
    let gpsResult = null;
    while (true) {
        Swal.fire({
            title: 'กำลังตรวจสอบตำแหน่ง GPS...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        gpsResult = await getGpsLink();

        if (!gpsResult.reason) break; // ได้ตำแหน่งสำเร็จ ออกจาก loop ไปบันทึกต่อได้

        const retry = await Swal.fire({
            icon: 'error',
            title: 'ไม่สามารถระบุตำแหน่ง GPS ได้',
            html: `${escapeHtml(gpsResult.reason)}<br><br><b>ระบบกำหนดให้ต้องมีตำแหน่ง GPS จึงจะบันทึกปิดงานได้</b>`,
            showCancelButton: true,
            confirmButtonText: 'ลองอีกครั้ง',
            confirmButtonColor: '#1b4332',
            cancelButtonText: 'ยกเลิก'
        });

        if (!retry.isConfirmed) {
            box.checked = false;
            return; // ผู้ใช้เลือกยกเลิก ไม่บันทึกอะไรเลย
        }
        // เลือก "ลองอีกครั้ง" -> วน loop กลับไปขอ GPS ใหม่
    }

    Swal.update({ title: 'กำลังบันทึก...' });

    try {
        // สร้างวันปัจจุบันในรูปแบบ ค.ศ.
        const now = new Date();
        const formattedDate = now.toISOString(); // ใช้ ISO 8601 กันความกำกวมเรื่อง DD/MM vs MM/DD ตาม locale ของสเปรดชีต

        // ปรับให้เหมือนกับฟังก์ชัน renewService และ photo เพื่อความเสถียร
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                sn: sn,
                action: 'complete_pm',
                pmStep: stepKey,
                gps: gpsResult.link,
                techName: techName,
                logTime: formattedDate
            }),
            headers: { "Content-Type": "text/plain;charset=utf-8" } // ใช้ text/plain เลี่ยงปัญหา CORS Preflight (ไม่ต้องใช้ no-cors)
        });
        const result = await response.json();

        if (result.status !== "success") {
            throw new Error(result.message || "บันทึกไม่สำเร็จ");
        }

        Swal.close();
        Toast.fire({ icon: 'success', title: 'บันทึกสำเร็จ (พร้อม GPS)' });
        loadData(true);
    } catch (e) {
        console.error("Complete PM error:", e);
        Swal.fire('Error', e.message || 'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง', 'error');
        box.checked = false;
    }
}

// ฟังก์ชันสำหรับเริ่มรอบบริการใหม่ (Renew)
async function renewService(sn) {
    const dateInput = document.getElementById(`renew-${sn}`);
    const startDate = dateInput.value;

    if (!startDate) {
        Swal.fire('แจ้งเตือน', 'กรุณาเลือกวันที่เริ่มรอบใหม่', 'warning');
        return;
    }

    const confirm = await Swal.fire({
        title: 'ยืนยันเริ่มรอบใหม่?',
        text: `เครื่อง S/N: ${sn} จะเริ่มนับรอบใหม่จากวันที่ ${startDate}`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#2d6a4f',
        confirmButtonText: 'ตกลง',
        cancelButtonText: 'ยกเลิก'
    });

    if (confirm.isConfirmed) {
        Swal.fire({ title: 'กำลังบันทึก...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        try {
            const response = await fetch(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({
                    sn: sn,
                    action: 'renew_service',
                    startDate: startDate,
                    adminPassword: adminPasswordCache
                }),
                headers: { "Content-Type": "text/plain;charset=utf-8" }
            });
            const result = await response.json();

            if (result.status !== "success") {
                throw new Error(result.message || "ไม่สามารถต่ออายุสัญญาได้");
            }

            Swal.close();
            Toast.fire({ icon: 'success', title: 'เริ่มรอบใหม่สำเร็จ' });
            loadData(true);
        } catch (e) {
            console.error("Renew error:", e);
            Swal.fire('Error', e.message || 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้', 'error');
        }
    }
}

async function updateNote(sn, btn) {
    const val = document.getElementById(`n-${sn}`).value;

    // เปลี่ยนสถานะปุ่มเป็นกำลังโหลดพร้อม Animation หมุนวน
    const oldHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin-custom"></i> กำลังบันทึก...';

    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ sn: sn, action: 'update_note', note: val }),
            headers: { "Content-Type": "text/plain;charset=utf-8" }
        });
        const result = await response.json();

        if (result.status !== "success") {
            throw new Error(result.message || "บันทึกไม่สำเร็จ");
        }

        // ปรับการแจ้งเตือนกลับมาไว้กลางจอ
        await Swal.fire({
            icon: 'success',
            title: 'บันทึกข้อมูลเรียบร้อย',
            text: 'หมายเหตุสำหรับ S/N: ' + sn + ' ถูกอัปเดตแล้ว',
            confirmButtonColor: '#1b4332', // สีเขียว C2TECH
            confirmButtonText: 'ตกลง'
        });

    } catch (e) {
        console.error("Update note error:", e);
        Swal.fire({
            icon: 'error',
            title: 'เกิดข้อผิดพลาด',
            text: e.message || 'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง',
            confirmButtonColor: '#d00000'
        });
    } finally {
        // คืนค่าปุ่มกลับมาเป็นปกติ
        btn.disabled = false;
        btn.innerHTML = oldHtml;
    }
}

// --- ส่วนที่ปรับปรุงในฟังก์ชัน runFilters ---
// หน่วงเวลา 250ms ก่อน filter จริง ลดภาระตอนพิมพ์เร็วๆ ในเครื่องที่มีข้อมูลเยอะ
let filterDebounceTimer;
function debouncedRunFilters() {
    clearTimeout(filterDebounceTimer);
    filterDebounceTimer = setTimeout(runFilters, 250);
}

function runFilters() {
    const q = document.getElementById('mainSearch').value.toLowerCase();
    const cards = document.querySelectorAll('.s-card');
    const isShowRenewOnly = document.getElementById('showRenewOnlySwitch').checked;
    const typeFilterVal = document.getElementById('typeFilter').value;
    const modeFilterVal = document.getElementById('modeFilter').value;

    let cO = 0, cU = 0;

    cards.forEach(card => {
        const hasOverdue = card.querySelectorAll('.pm-step.overdue').length > 0;
        const hasUrgent = card.querySelectorAll('.pm-step.urgent').length > 0;
        const isRenewCard = card.getAttribute('data-renew') === 'true'; // ดึงค่าจาก attribute

        if (hasOverdue) cO++;
        if (hasUrgent) cU++;

        // ใช้ textContent แทน innerText — innerText ต้องคำนวณ layout/สไตล์จริงของ DOM ก่อนถึงจะอ่านค่าได้
        // (forced synchronous reflow) ส่วน textContent อ่านจากโครงสร้าง DOM ตรงๆ ไม่ต้องรอ layout เลย
        // ผลลัพธ์ข้อความที่ได้เหมือนกันในเคสนี้ (ไม่มีการซ่อนข้อความด้วย CSS ในการ์ด) แต่เร็วกว่ามากเวลามีหลายสิบการ์ด
        const text = card.textContent.toLowerCase();
        const matchSearch = text.includes(q);
        const matchMode = (currentMode === 'all') ||
            (currentMode === 'overdue' && hasOverdue) ||
            (currentMode === 'urgent' && hasUrgent);

        // *** ปรับเงื่อนไขตรงนี้เพื่อให้ Switch RENEW ทำงานร่วมกับ Filter อื่นได้ ***
        const matchRenew = !isShowRenewOnly || (isShowRenewOnly && isRenewCard);

        // ตัวกรอง Type (Lab/Real-time) และ Mode (Milled rice/Paddy)
        const matchType = (typeFilterVal === 'all') || (card.getAttribute('data-type') === typeFilterVal);
        const matchModeVal = (modeFilterVal === 'all') || (card.getAttribute('data-mode') === modeFilterVal);

        if (matchSearch && matchMode && matchRenew && matchType && matchModeVal) {
            card.style.display = 'flex';
        } else {
            card.style.display = 'none';
        }
    });

    document.getElementById('cnt-overdue').innerText = cO;
    document.getElementById('cnt-urgent').innerText = cU;
    document.getElementById('cnt-all').innerText = cards.length;
}

function smartToggle(m) {
    currentMode = (currentMode === m && m !== 'all') ? 'all' : m;
    document.querySelectorAll('.f-card').forEach(c => c.classList.remove('active-all', 'active-overdue', 'active-urgent'));
    document.getElementById(`f-${currentMode}`).classList.add(`active-${currentMode}`);
    runFilters();
}

/* =========================================================================================
   ระบบ User Login / โปรไฟล์ผู้ใช้ (คนละระบบกับ Admin)
========================================================================================= */

function updateUserProfileIcon() {
    const icon = document.getElementById('userProfileIcon');
    if (!icon) return;
    if (currentUser) {
        icon.className = 'fas fa-circle-check admin-login-btn active';
        icon.title = `เข้าสู่ระบบเป็น: ${currentUser.name}`;
    } else {
        icon.className = 'fas fa-user-circle admin-login-btn';
        icon.title = 'เข้าสู่ระบบ / โปรไฟล์';
    }
}

function openUserProfileOrLogin() {
    if (currentUser) {
        openUserProfileModal();
    } else {
        showLoginModal();
    }
}

async function showLoginModal() {
    const result = await Swal.fire({
        title: '<i class="fas fa-id-badge" style="color:#1b4332;"></i> เข้าสู่ระบบ',
        html: `
            <input id="login-username" class="swal2-input" placeholder="Username" style="margin:0 0 10px;" autocomplete="username">
            ${passwordFieldHtml('login-password', 'รหัสผ่าน', 'margin:0;', 'current-password')}
        `,
        confirmButtonText: 'เข้าสู่ระบบ',
        confirmButtonColor: '#1b4332',
        showCancelButton: true,
        cancelButtonText: 'ยกเลิก',
        didOpen: () => wireTogglePassword('login-password'),
        preConfirm: () => {
            const username = document.getElementById('login-username').value.trim();
            const password = document.getElementById('login-password').value;
            if (!username || !password) {
                Swal.showValidationMessage('กรุณากรอก Username และรหัสผ่าน');
                return false;
            }
            return { username, password };
        }
    });

    if (!result.isConfirmed) return;

    Swal.fire({ title: 'กำลังเข้าสู่ระบบ...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'user_login', username: result.value.username, password: result.value.password }),
            headers: { "Content-Type": "text/plain;charset=utf-8" }
        });
        const res = await response.json();
        if (res.status !== 'success') throw new Error(res.message || 'เข้าสู่ระบบไม่สำเร็จ');

        currentUser = res.user;
        localStorage.setItem('current_user', JSON.stringify(currentUser));
        updateUserProfileIcon();
        Swal.close();
        Toast.fire({ icon: 'success', title: `ยินดีต้อนรับ ${currentUser.name}` });
    } catch (err) {
        console.error('Login error:', err);
        Swal.fire({ icon: 'error', title: 'เข้าสู่ระบบไม่สำเร็จ', text: err.message });
    }
}

function logoutUser() {
    currentUser = null;
    localStorage.removeItem('current_user');
    updateUserProfileIcon();
    Swal.close();
    Toast.fire({ icon: 'info', title: 'ออกจากระบบแล้ว' });
}

// อัปโหลดรูปโปรไฟล์ (ใช้ฟังก์ชันย่อรูป/อ่านไฟล์เดียวกับรูป PM แต่ action คนละตัว)
async function uploadUserPhoto(rawDataUrlOrFile) {
    const rawDataUrl = (rawDataUrlOrFile instanceof File) ? await readFileAsDataUrl(rawDataUrlOrFile) : rawDataUrlOrFile;
    const imageData = await resizeImageDataUrl(rawDataUrl, 500, 0.7);
    const response = await fetch(SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'user_photo', image: imageData, fileName: `USER_${Date.now()}.jpg` }),
        headers: { "Content-Type": "text/plain;charset=utf-8" }
    });
    const result = await response.json();
    if (result.status !== 'success') throw new Error(result.message || 'อัปโหลดรูปไม่สำเร็จ');
    return result.url;
}

function calculateAgeJS(birthdateStr) {
    if (!birthdateStr) return null;
    const bd = new Date(birthdateStr);
    if (isNaN(bd.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - bd.getFullYear();
    const m = today.getMonth() - bd.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) age--;
    return age;
}

// การ์ดบัตรพนักงาน (view mode) — กดปุ่ม "แก้ไขข้อมูล" เพื่อเปิดฟอร์มแก้ไขแยกต่างหาก
function openUserProfileModal() {
    const genderIcon = currentUser.gender === 'ชาย' ? 'fa-mars' : (currentUser.gender === 'หญิง' ? 'fa-venus' : 'fa-genderless');
    const birthDisplay = currentUser.birthdate
        ? new Date(currentUser.birthdate).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })
        : '-';

    Swal.fire({
        html: `
            <div style="max-width:360px; margin:0 auto; border-radius:20px; overflow:hidden; box-shadow:0 14px 34px rgba(27,67,50,0.35); font-family:'Sarabun',sans-serif;">
                <div style="background:linear-gradient(155deg, #1b4332 0%, #2d6a4f 100%); padding:26px 20px 22px; text-align:center; color:#fff; position:relative;">
                    <div style="position:absolute; top:12px; right:16px; font-size:9px; letter-spacing:1.5px; opacity:.55; font-weight:700;">C2TECH</div>
                    <div style="font-size:10px; letter-spacing:2.5px; text-transform:uppercase; opacity:.6; margin-bottom:16px;">Service Tracker · Staff ID</div>
                    <img id="profile-photo-preview" src="${toDriveImageUrl(currentUser.photo) || 'https://placehold.co/100x100/1b4332/ffffff?text=' + encodeURIComponent(currentUser.name.charAt(0))}"
                         style="width:92px; height:92px; border-radius:50%; object-fit:cover; border:3px solid #ffb703; background:#fff; box-shadow:0 4px 12px rgba(0,0,0,0.25);">
                    <div style="font-size:19px; font-weight:800; margin-top:14px; letter-spacing:.2px;">${escapeHtml(currentUser.name)}</div>
                    <div style="font-size:12.5px; opacity:.85; margin-top:3px;">${escapeHtml(currentUser.position || 'ยังไม่ระบุตำแหน่ง')}</div>
                </div>
                <div style="background:#fff; padding:18px 22px 22px; text-align:left;">
                    <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom:12px; margin-bottom:14px; border-bottom:1.5px dashed #e2e8f0;">
                        <span style="font-size:10px; letter-spacing:1.5px; color:#94a3b8; text-transform:uppercase; font-weight:700;">Username</span>
                        <span style="font-size:14px; font-weight:800; color:#1b4332; font-family:'Courier New',monospace; background:#f0fdf4; padding:3px 10px; border-radius:6px;">${escapeHtml(currentUser.username || '-')}</span>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; font-size:13px;">
                        <div>
                            <div style="font-size:10px; color:#94a3b8; text-transform:uppercase; letter-spacing:.5px; font-weight:700;"><i class="fas ${genderIcon}"></i> เพศ</div>
                            <div style="font-weight:700; margin-top:3px;">${escapeHtml(currentUser.gender || '-')}</div>
                        </div>
                        <div>
                            <div style="font-size:10px; color:#94a3b8; text-transform:uppercase; letter-spacing:.5px; font-weight:700;"><i class="fas fa-cake-candles"></i> อายุ</div>
                            <div style="font-weight:700; margin-top:3px;">${currentUser.age ?? '-'} ปี</div>
                        </div>
                        <div style="grid-column:span 2;">
                            <div style="font-size:10px; color:#94a3b8; text-transform:uppercase; letter-spacing:.5px; font-weight:700;"><i class="fas fa-gift"></i> วันเกิด</div>
                            <div style="font-weight:700; margin-top:3px;">${birthDisplay}</div>
                        </div>
                    </div>

                    <div style="display:flex; gap:8px; margin-top:20px;">
                        <button type="button" id="profile-change-photo-btn" style="flex:1; background:#475569; color:#fff; border:none; padding:11px; border-radius:10px; font-weight:700; font-size:12.5px; cursor:pointer;">
                            <i class="fas fa-images"></i> เปลี่ยนรูป
                        </button>
                        <button type="button" id="profile-open-edit-btn" style="flex:1; background:#1b4332; color:#fff; border:none; padding:11px; border-radius:10px; font-weight:700; font-size:12.5px; cursor:pointer;">
                            <i class="fas fa-pen"></i> แก้ไขข้อมูล
                        </button>
                    </div>
                    <input type="file" id="profile-photo-input" accept="image/*" style="display:none;">
                    <button type="button" onclick="logoutUser()" style="width:100%; background:none; border:none; color:#e11d48; font-weight:700; cursor:pointer; font-size:12.5px; margin-top:14px; padding:4px;">
                        <i class="fas fa-right-from-bracket"></i> ออกจากระบบ
                    </button>
                </div>
            </div>
        `,
        width: '360px',
        padding: 0,
        background: 'transparent',
        showConfirmButton: false,
        showCloseButton: true,
        customClass: {
            popup: 'profile-card-popup',
            closeButton: 'profile-card-close-btn'
        },
        didOpen: () => {
            document.getElementById('profile-change-photo-btn').onclick = () => {
                document.getElementById('profile-photo-input').click(); // เปิด "เลือกรูปจากอัลบั้ม" ของเครื่องโดยตรง (ไม่บังคับกล้อง เหมือนรูปหน้างาน PM)
            };

            document.getElementById('profile-photo-input').onchange = async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                try {
                    const preview = await readFileAsDataUrl(file);
                    document.getElementById('profile-photo-preview').src = preview; // โชว์พรีวิวก่อนอัปโหลดจริง
                    const url = await uploadUserPhoto(file);
                    await fetch(SCRIPT_URL, {
                        method: 'POST',
                        body: JSON.stringify({ action: 'user_edit', userId: currentUser.userId, photo: url }),
                        headers: { "Content-Type": "text/plain;charset=utf-8" }
                    });
                    currentUser.photo = url;
                    localStorage.setItem('current_user', JSON.stringify(currentUser));
                    document.getElementById('profile-photo-preview').src = url;
                    Toast.fire({ icon: 'success', title: 'เปลี่ยนรูปโปรไฟล์แล้ว' });
                } catch (err) {
                    Swal.fire({ icon: 'error', title: 'เปลี่ยนรูปไม่สำเร็จ', text: err.message });
                } finally {
                    e.target.value = ''; // เคลียร์ไว้เผื่อเลือกไฟล์เดิมซ้ำได้อีกครั้ง
                }
            };

            document.getElementById('profile-open-edit-btn').onclick = () => {
                openUserProfileEditModal();
            };
        }
    });
}

// ฟอร์มแก้ไขข้อมูลโปรไฟล์ (แยกจากบัตรพนักงานที่โชว์ด้านนอก เพื่อให้บัตรดูสะอาดสวยงาม)
function openUserProfileEditModal() {
    const birthVal = currentUser.birthdate ? new Date(currentUser.birthdate).toISOString().split('T')[0] : '';

    Swal.fire({
        title: '<i class="fas fa-pen" style="color:#1b4332;"></i> แก้ไขข้อมูลส่วนตัว',
        html: `
            <div style="text-align:left;">
                <div style="font-size:11px; font-weight:800; color:#1b4332; text-transform:uppercase; letter-spacing:.5px; margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid #eef2f0;">
                    <i class="fas fa-id-card"></i> ข้อมูลส่วนตัว
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <div>
                        <label style="font-size:12px; font-weight:700;">ชื่อ-สกุล</label>
                        <input id="profile-name" class="swal2-input" style="margin:4px 0 0; width:100%; height:38px;" value="${escapeHtml(currentUser.name)}">
                    </div>
                    <div>
                        <label style="font-size:12px; font-weight:700;">ตำแหน่ง</label>
                        <input id="profile-position" class="swal2-input" style="margin:4px 0 0; width:100%; height:38px;" value="${escapeHtml(currentUser.position || '')}">
                    </div>
                    <div>
                        <label style="font-size:12px; font-weight:700;">เพศ</label>
                        <select id="profile-gender" class="swal2-select" style="margin:4px 0 0; width:100%; height:38px;">
                            <option value="ชาย" ${currentUser.gender === 'ชาย' ? 'selected' : ''}>ชาย</option>
                            <option value="หญิง" ${currentUser.gender === 'หญิง' ? 'selected' : ''}>หญิง</option>
                            <option value="อื่นๆ" ${currentUser.gender === 'อื่นๆ' ? 'selected' : ''}>อื่นๆ</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:12px; font-weight:700;">วันเกิด</label>
                        <input type="date" id="profile-birthdate" class="swal2-input" style="margin:4px 0 0; width:100%; height:38px;" value="${birthVal}">
                    </div>
                </div>
            </div>
            <div id="profile-age-display" style="margin-top:8px; font-size:12px; color:#64748b; text-align:left;">อายุ: ${calculateAgeJS(birthVal) ?? '-'} ปี (คำนวณอัตโนมัติจากวันเกิดที่กรอกด้านบน)</div>
            <hr style="margin:14px 0; border-color:#e2e8f0;">
            <div style="text-align:left;">
                <div style="font-size:11px; font-weight:800; color:#c2410c; text-transform:uppercase; letter-spacing:.5px; margin-bottom:8px;">
                    <i class="fas fa-lock"></i> เปลี่ยนรหัสผ่าน (เว้นว่างไว้ถ้าไม่ต้องการเปลี่ยน)
                </div>
                ${passwordFieldHtml('profile-current-pw', 'รหัสผ่านปัจจุบัน', 'margin:0 0 8px;', 'current-password')}
                ${passwordFieldHtml('profile-new-pw', 'รหัสผ่านใหม่', 'margin:0;', 'new-password')}
            </div>
        `,
        width: '480px',
        showCancelButton: true,
        confirmButtonText: 'บันทึก',
        confirmButtonColor: '#1b4332',
        cancelButtonText: 'ยกเลิก',
        didOpen: () => {
            wireTogglePassword('profile-current-pw');
            wireTogglePassword('profile-new-pw');
            document.getElementById('profile-birthdate').addEventListener('change', (e) => {
                document.getElementById('profile-age-display').innerText = `อายุ: ${calculateAgeJS(e.target.value) ?? '-'} ปี (คำนวณอัตโนมัติจากวันเกิด)`;
            });
        },
        preConfirm: () => {
            const newPw = document.getElementById('profile-new-pw').value;
            const curPw = document.getElementById('profile-current-pw').value;
            if (newPw && !curPw) {
                Swal.showValidationMessage('กรุณากรอกรหัสผ่านปัจจุบัน เพื่อยืนยันก่อนเปลี่ยนรหัสผ่านใหม่');
                return false;
            }
            return {
                name: document.getElementById('profile-name').value.trim(),
                position: document.getElementById('profile-position').value.trim(),
                gender: document.getElementById('profile-gender').value,
                birthdate: document.getElementById('profile-birthdate').value,
                currentPassword: curPw,
                newPassword: newPw
            };
        }
    }).then(async (result) => {
        if (!result.isConfirmed) { openUserProfileModal(); return; } // ยกเลิก -> กลับไปโชว์บัตรเหมือนเดิม
        try {
            const response = await fetch(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({ action: 'user_edit', userId: currentUser.userId, ...result.value }),
                headers: { "Content-Type": "text/plain;charset=utf-8" }
            });
            const res = await response.json();
            if (res.status !== 'success') throw new Error(res.message || 'บันทึกไม่สำเร็จ');

            currentUser.name = result.value.name;
            currentUser.position = result.value.position;
            currentUser.gender = result.value.gender;
            currentUser.birthdate = result.value.birthdate;
            currentUser.age = calculateAgeJS(result.value.birthdate);
            localStorage.setItem('current_user', JSON.stringify(currentUser));
            updateUserProfileIcon();
            Toast.fire({ icon: 'success', title: 'บันทึกโปรไฟล์เรียบร้อย' });
            openUserProfileModal(); // กลับไปโชว์บัตรที่อัปเดตแล้ว
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: err.message });
        }
    });
}

/* =========================================================================================
   Admin: จัดการผู้ใช้งาน
========================================================================================= */

async function openUserManagement() {
    if (!isAdmin) { Swal.fire({ icon: 'warning', title: 'สิทธิ์ไม่เพียงพอ', text: 'กรุณาล็อกอินเป็น Admin ก่อน' }); return; }

    Swal.fire({ title: 'กำลังโหลด...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    let users = [];
    try {
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'user_list', adminPassword: adminPasswordCache }),
            headers: { "Content-Type": "text/plain;charset=utf-8" }
        });
        const result = await res.json();
        if (result.status !== 'success') throw new Error(result.message);
        users = result.users || [];
    } catch (e) {
        Swal.fire('Error', e.message || 'โหลดรายชื่อผู้ใช้ไม่สำเร็จ', 'error');
        return;
    }

    const rowsHtml = users.map(u => `
        <tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:8px;"><img src="${toDriveImageUrl(u.photo) || 'https://placehold.co/32x32?text=%20'}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;background:#eee;"></td>
            <td style="padding:8px; text-align:left; font-size:13px;">
                <b>${escapeHtml(u.name)}</b> <span style="font-size:10px; color:#1b4332; background:#e8f5e9; padding:1px 6px; border-radius:999px; font-family:monospace;">@${escapeHtml(u.username)}</span> ${u.status === 'Inactive' ? '<span style="color:#94a3b8;font-size:10px;">(ปิดใช้งาน)</span>' : ''}<br>
                <small style="color:#94a3b8;">${escapeHtml(u.position || '-')} · ${u.age ?? '-'} ปี</small>
            </td>
            <td style="padding:8px; white-space:nowrap;">
                <button onclick="resetUserPassword('${u.userId}','${escapeHtml(u.name)}')" title="สุ่มรหัสผ่านใหม่" style="font-size:11px; padding:5px 7px; border-radius:5px; border:none; background:#f39c12; color:#fff; cursor:pointer; margin-right:3px;"><i class="fas fa-key"></i></button>
                <button onclick="deleteUserConfirm('${u.userId}','${escapeHtml(u.name)}')" title="ลบผู้ใช้" style="font-size:11px; padding:5px 7px; border-radius:5px; border:none; background:#e74c3c; color:#fff; cursor:pointer;"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');

    Swal.fire({
        title: `<i class="fas fa-users-gear" style="color:#1b4332;"></i> จัดการผู้ใช้งาน`,
        html: `
            <div style="text-align:left; font-size:11px; color:#94a3b8; margin-bottom:10px;">
                ผู้ใช้ทั้งหมด ${users.length} คน &nbsp;·&nbsp;
                <i class="fas fa-key" style="color:#f39c12;"></i> สุ่มรหัสผ่านใหม่ &nbsp;
                <i class="fas fa-trash" style="color:#e74c3c;"></i> ลบผู้ใช้
            </div>
            <button onclick="addUserModal()" style="width:100%; background:#27ae60; color:#fff; border:none; padding:10px; border-radius:8px; font-weight:700; margin-bottom:12px; cursor:pointer;">
                <i class="fas fa-user-plus"></i> เพิ่มผู้ใช้ใหม่
            </button>
            <div style="max-height:340px; overflow-y:auto; text-align:left;">
                <table style="width:100%; font-size:13px; border-collapse:collapse;">${rowsHtml || '<tr><td style="padding:20px; color:#94a3b8;">ยังไม่มีผู้ใช้ในระบบ</td></tr>'}</table>
            </div>
        `,
        width: '480px',
        showConfirmButton: false,
        showCloseButton: true
    });
}

async function addUserModal() {
    const result = await Swal.fire({
        title: '<i class="fas fa-user-plus" style="color:#27ae60;"></i> เพิ่มผู้ใช้ใหม่',
        html: `
            <div style="text-align:left;">
                <div style="margin-bottom:14px;">
                    <div style="font-size:11px; font-weight:800; color:#1b4332; text-transform:uppercase; letter-spacing:.5px; margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid #eef2f0;">
                        <i class="fas fa-key"></i> ข้อมูลสำหรับเข้าสู่ระบบ
                    </div>
                    <label style="font-size:12px; font-weight:700; color:#555;">Username (สำหรับ login เท่านั้น)</label>
                    <input id="nu-username" class="swal2-input" style="width:100%; height:38px; margin:4px 0 0;" autocomplete="off" placeholder="เช่น somchai01">
                </div>

                <div>
                    <div style="font-size:11px; font-weight:800; color:#1b4332; text-transform:uppercase; letter-spacing:.5px; margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid #eef2f0;">
                        <i class="fas fa-id-card"></i> ข้อมูลส่วนตัว
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                        <div style="grid-column:span 2;">
                            <label style="font-size:12px; font-weight:700; color:#555;">ชื่อ-สกุล</label>
                            <input id="nu-name" class="swal2-input" style="width:100%; height:38px; margin:4px 0 0;" placeholder="เช่น สมชาย ใจดี">
                        </div>
                        <div style="grid-column:span 2;">
                            <label style="font-size:12px; font-weight:700; color:#555;">ตำแหน่ง</label>
                            <input id="nu-position" class="swal2-input" style="width:100%; height:38px; margin:4px 0 0;" placeholder="เช่น ช่างเทคนิค">
                        </div>
                        <div>
                            <label style="font-size:12px; font-weight:700; color:#555;">เพศ</label>
                            <select id="nu-gender" class="swal2-select" style="width:100%; height:38px; margin:4px 0 0;">
                                <option value="ชาย">ชาย</option>
                                <option value="หญิง">หญิง</option>
                                <option value="อื่นๆ">อื่นๆ</option>
                            </select>
                        </div>
                        <div>
                            <label style="font-size:12px; font-weight:700; color:#555;">วันเกิด</label>
                            <input type="date" id="nu-birthdate" class="swal2-input" style="width:100%; height:38px; margin:4px 0 0;">
                        </div>
                    </div>
                </div>
            </div>
        `,
        width: '460px',
        confirmButtonText: 'เพิ่มผู้ใช้ (สุ่มรหัสผ่านให้)',
        confirmButtonColor: '#1b4332',
        showCancelButton: true,
        cancelButtonText: 'ยกเลิก',
        preConfirm: () => {
            const username = document.getElementById('nu-username').value.trim();
            const name = document.getElementById('nu-name').value.trim();
            if (!username) { Swal.showValidationMessage('กรุณากรอก Username สำหรับ login'); return false; }
            if (!name) { Swal.showValidationMessage('กรุณากรอกชื่อ-สกุล'); return false; }
            return {
                username,
                name,
                position: document.getElementById('nu-position').value.trim(),
                gender: document.getElementById('nu-gender').value,
                birthdate: document.getElementById('nu-birthdate').value
            };
        }
    });

    if (!result.isConfirmed) return;

    try {
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'user_add', adminPassword: adminPasswordCache, ...result.value }),
            headers: { "Content-Type": "text/plain;charset=utf-8" }
        });
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.message);

        await Swal.fire({
            icon: 'success',
            title: 'เพิ่มผู้ใช้เรียบร้อย',
            html: `รหัสผ่านที่สุ่มให้:<br><b style="font-size:22px; letter-spacing:2px; color:#1b4332;">${escapeHtml(data.generatedPassword)}</b><br><br><small style="color:#94a3b8;">กรุณาคัดลอกไปให้ผู้ใช้คนนี้ทันที ระบบจะไม่แสดงรหัสนี้ซ้ำอีก</small>`,
            confirmButtonText: 'รับทราบ',
            confirmButtonColor: '#1b4332'
        });
        openUserManagement();
    } catch (e) {
        Swal.fire('Error', e.message || 'เพิ่มผู้ใช้ไม่สำเร็จ', 'error');
    }
}

async function resetUserPassword(userId, name) {
    const confirmReset = await Swal.fire({
        icon: 'question',
        title: `สุ่มรหัสผ่านใหม่ให้ ${name}?`,
        text: 'รหัสผ่านเดิมจะใช้ไม่ได้ทันที',
        showCancelButton: true,
        confirmButtonText: 'ยืนยัน',
        confirmButtonColor: '#f39c12',
        cancelButtonText: 'ยกเลิก'
    });
    if (!confirmReset.isConfirmed) return;

    try {
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'user_reset_password', adminPassword: adminPasswordCache, userId }),
            headers: { "Content-Type": "text/plain;charset=utf-8" }
        });
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.message);

        await Swal.fire({
            icon: 'success',
            title: 'สุ่มรหัสผ่านใหม่แล้ว',
            html: `รหัสผ่านใหม่ของ <b>${escapeHtml(name)}</b>:<br><b style="font-size:22px; letter-spacing:2px; color:#1b4332;">${escapeHtml(data.generatedPassword)}</b>`,
            confirmButtonText: 'รับทราบ',
            confirmButtonColor: '#1b4332'
        });
    } catch (e) {
        Swal.fire('Error', e.message || 'สุ่มรหัสผ่านไม่สำเร็จ', 'error');
    }
}

async function deleteUserConfirm(userId, name) {
    const confirmDel = await Swal.fire({
        icon: 'warning',
        title: `ลบผู้ใช้ ${name}?`,
        text: 'ข้อมูลของผู้ใช้นี้จะถูกลบออกจากระบบทันที (ประวัติ PM ที่บันทึกไปแล้วจะยังอยู่)',
        showCancelButton: true,
        confirmButtonText: 'ลบเลย',
        confirmButtonColor: '#e74c3c',
        cancelButtonText: 'ยกเลิก'
    });
    if (!confirmDel.isConfirmed) return;

    try {
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'user_delete', adminPassword: adminPasswordCache, userId }),
            headers: { "Content-Type": "text/plain;charset=utf-8" }
        });
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.message);
        Toast.fire({ icon: 'success', title: 'ลบผู้ใช้เรียบร้อย' });
        openUserManagement();
    } catch (e) {
        Swal.fire('Error', e.message || 'ลบผู้ใช้ไม่สำเร็จ', 'error');
    }
}

/* =========================================================================================
   Admin: Dashboard สรุปจำนวนครั้งที่เข้า PM ต่อคน
========================================================================================= */

let pmDashboardChart = null;

/* =========================================================================================
   Admin: ตั้งค่า Data Validation (กันกรอกข้อมูลผิดในชีต)
========================================================================================= */

async function setupDataValidationUI() {
    if (!isAdmin) { Swal.fire({ icon: 'warning', title: 'สิทธิ์ไม่เพียงพอ', text: 'กรุณาล็อกอินเป็น Admin ก่อน' }); return; }

    const confirm = await Swal.fire({
        icon: 'question',
        title: 'ตั้งค่า Data Validation?',
        html: `
            <div style="text-align:left; font-size:13px;">
                ระบบจะเพิ่ม dropdown บังคับเลือกให้กับคอลัมน์เหล่านี้ (กันกรอกข้อมูลผิดตอนแก้ในชีตโดยตรง):
                <ul style="font-size:12px; margin:8px 0; padding-left:20px;">
                    <li><b>Panolyzer Data:</b> Status, Model, Mode, Type</li>
                    <li><b>Machine_History:</b> Status, Result, Mode</li>
                    <li><b>Users:</b> Gender, Status</li>
                </ul>
                <small style="color:#94a3b8;">ไม่กระทบข้อมูลเดิมที่มีอยู่แล้ว มีผลแค่ตอนแก้ไขค่าในเซลล์นั้นครั้งต่อไปเท่านั้น</small>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'ตั้งค่าเลย',
        confirmButtonColor: '#1b4332',
        cancelButtonText: 'ยกเลิก'
    });
    if (!confirm.isConfirmed) return;

    Swal.fire({ title: 'กำลังตั้งค่า...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'setup_data_validation', adminPassword: adminPasswordCache }),
            headers: { "Content-Type": "text/plain;charset=utf-8" }
        });
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.message);

        await Swal.fire({
            icon: 'success',
            title: 'ตั้งค่าเรียบร้อย',
            html: `<div style="text-align:left; font-size:12px;">${(data.details || []).map(d => `• ${escapeHtml(d)}`).join('<br>')}</div>`,
            confirmButtonColor: '#1b4332',
            confirmButtonText: 'รับทราบ'
        });
    } catch (e) {
        Swal.fire('Error', e.message || 'ตั้งค่าไม่สำเร็จ', 'error');
    }
}

/* =========================================================================================
   Admin: ระบบ Report สรุปผล Service Tracker (PDF สำหรับพิมพ์ + รูปภาพสำหรับ LINE)
========================================================================================= */

function formatThaiDate(isoOrDateStr) {
    const d = new Date(isoOrDateStr);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

function openAdminMenu() {
    if (!isAdmin) { Swal.fire({ icon: 'warning', title: 'สิทธิ์ไม่เพียงพอ' }); return; }

    Swal.fire({
        title: '<i class="fas fa-toolbox" style="color:#1b4332;"></i> เมนู Admin',
        html: `
            <div style="text-align:left; display:flex; flex-direction:column; gap:8px;">
                <button onclick="Swal.close(); openPmDashboard();" class="admin-menu-item">
                    <i class="fas fa-chart-column"></i> แดชบอร์ด PM
                </button>
                <button onclick="Swal.close(); openUserManagement();" class="admin-menu-item">
                    <i class="fas fa-users-gear"></i> จัดการผู้ใช้งาน
                </button>
                <button onclick="Swal.close(); openReportModal();" class="admin-menu-item">
                    <i class="fas fa-file-lines"></i> สร้างรายงานสรุป
                </button>
                <button onclick="Swal.close(); setupDataValidationUI();" class="admin-menu-item">
                    <i class="fas fa-shield-halved"></i> ตั้งค่าป้องกันข้อมูลผิด
                </button>
            </div>
        `,
        showConfirmButton: false,
        showCloseButton: true,
        width: '340px'
    });
}

async function openReportModal() {
    if (!isAdmin) { Swal.fire({ icon: 'warning', title: 'สิทธิ์ไม่เพียงพอ', text: 'กรุณาล็อกอินเป็น Admin ก่อน' }); return; }

    const today = new Date().toISOString().split('T')[0];
    const firstOfMonth = new Date();
    firstOfMonth.setDate(1);
    const firstOfMonthStr = firstOfMonth.toISOString().split('T')[0];

    function validateReportDates() {
        const start = document.getElementById('report-start').value;
        const end = document.getElementById('report-end').value;
        if (!start || !end) { Swal.showValidationMessage('กรุณาเลือกช่วงวันที่ให้ครบ'); return false; }
        if (start > end) { Swal.showValidationMessage('วันเริ่มต้นต้องมาก่อนวันสิ้นสุด'); return false; }
        return { start, end };
    }

    const result = await Swal.fire({
        title: '<i class="fas fa-file-lines" style="color:#1b4332;"></i> สร้างรายงานสรุป',
        html: `
            <div style="text-align:left;">
                <label style="font-size:12px; font-weight:700;">ช่วงวันที่เริ่มต้น</label>
                <input type="date" id="report-start" class="swal2-input" style="width:100%; height:38px; margin:4px 0 12px;" value="${firstOfMonthStr}">
                <label style="font-size:12px; font-weight:700;">ช่วงวันที่สิ้นสุด</label>
                <input type="date" id="report-end" class="swal2-input" style="width:100%; height:38px; margin:4px 0;" value="${today}">
            </div>
        `,
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '<i class="fas fa-file-pdf"></i> PDF สำหรับพิมพ์',
        denyButtonText: '<i class="fas fa-image"></i> รูปสำหรับ LINE',
        cancelButtonText: 'ยกเลิก',
        confirmButtonColor: '#1b4332',
        denyButtonColor: '#00b900',
        preConfirm: validateReportDates,
        preDeny: validateReportDates
    });

    if (result.isConfirmed) {
        await generateReport(result.value.start, result.value.end, 'pdf');
    } else if (result.isDenied) {
        await generateReport(result.value.start, result.value.end, 'image');
    }
}

async function generateReport(start, end, format) {
    Swal.fire({ title: 'กำลังรวบรวมข้อมูล...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'service_report_data', adminPassword: adminPasswordCache, startDate: start, endDate: end }),
            headers: { "Content-Type": "text/plain;charset=utf-8" }
        });
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.message);
        if (data.report.error) throw new Error(data.report.error);

        Swal.close();

        if (format === 'pdf') {
            renderPdfReport(data.report);
        } else {
            renderLineImageReport(data.report);
        }
    } catch (e) {
        Swal.fire('Error', e.message || 'สร้างรายงานไม่สำเร็จ', 'error');
    }
}

// --- แบบที่ 1: PDF สำหรับพิมพ์เสนอเจ้านาย (ใช้ browser print + CSS @media print) ---
function renderPdfReport(report) {
    const totalOverdue = report.overdueList.length;
    const totalUrgent = report.urgentList.length;
    const totalCompleted = report.completedList.length;

    const rowsCompleted = report.completedList.map(r => `
        <tr>
            <td>${formatThaiDate(r.completedDate)}</td>
            <td>${escapeHtml(r.sn)}</td>
            <td>${escapeHtml(r.client)}</td>
            <td>${escapeHtml(r.step)}</td>
            <td>${escapeHtml(r.tech)}</td>
        </tr>
    `).join('') || `<tr><td colspan="5" style="text-align:center; color:#999;">ไม่มีข้อมูลในช่วงนี้</td></tr>`;

    const rowsOverdue = report.overdueList.map(r => `
        <tr>
            <td>${escapeHtml(r.sn)}</td>
            <td>${escapeHtml(r.client)}</td>
            <td>${escapeHtml(r.location)}</td>
            <td>${escapeHtml(r.step)}</td>
            <td>${formatThaiDate(r.plannedDate)}</td>
        </tr>
    `).join('') || `<tr><td colspan="5" style="text-align:center; color:#999;">ไม่มีเครื่องเลยกำหนด</td></tr>`;

    const container = document.getElementById('printReportArea');
    container.innerHTML = `
        <div class="print-page">
            <div class="print-header">
                <img src="icons/icon-512.png" class="print-logo">
                <div>
                    <div class="print-title">C2TECH Service Tracker</div>
                    <div class="print-subtitle">รายงานสรุปผลการดำเนินงาน</div>
                </div>
            </div>
            <div class="print-meta">
                ช่วงวันที่: ${formatThaiDate(report.startDate)} — ${formatThaiDate(report.endDate)} &nbsp;|&nbsp; ออกรายงานเมื่อ: ${formatThaiDate(new Date())}
                ${currentUser ? ` &nbsp;|&nbsp; จัดทำโดย: ${escapeHtml(currentUser.name)}` : ''}
            </div>

            <div class="print-kpi-grid">
                <div class="print-kpi"><div class="print-kpi-val" style="color:#16a34a;">${totalCompleted}</div><div class="print-kpi-lab">PM สำเร็จในช่วงนี้</div></div>
                <div class="print-kpi"><div class="print-kpi-val" style="color:#e11d48;">${totalOverdue}</div><div class="print-kpi-lab">เลยกำหนด (ณ วันสิ้นสุดช่วง)</div></div>
                <div class="print-kpi"><div class="print-kpi-val" style="color:#fb8500;">${totalUrgent}</div><div class="print-kpi-lab">ใกล้กำหนด (ภายใน 7 วัน)</div></div>
                <div class="print-kpi"><div class="print-kpi-val" style="color:#c9960c;">${report.totalRenewed}</div><div class="print-kpi-lab">ต่ออายุแล้ว (สะสม)</div></div>
            </div>

            <div class="print-section-title">รายการเครื่องที่เลยกำหนด PM</div>
            <table class="print-table">
                <thead><tr><th>S/N</th><th>ลูกค้า</th><th>สถานที่</th><th>รอบ</th><th>วันแผน</th></tr></thead>
                <tbody>${rowsOverdue}</tbody>
            </table>

            <div class="print-section-title">ประวัติ PM ที่ทำสำเร็จในช่วงนี้ (${totalCompleted} รายการ)</div>
            <table class="print-table">
                <thead><tr><th>วันที่ทำ</th><th>S/N</th><th>ลูกค้า</th><th>รอบ</th><th>ผู้ปฏิบัติงาน</th></tr></thead>
                <tbody>${rowsCompleted}</tbody>
            </table>

            <div class="print-signature">
                <div><div class="print-sign-line"></div><div class="print-sign-label">ผู้จัดทำรายงาน</div></div>
                <div><div class="print-sign-line"></div><div class="print-sign-label">ผู้รับทราบ (ผู้บริหาร)</div></div>
            </div>
        </div>
    `;

    setTimeout(() => window.print(), 250); // หน่วงเล็กน้อยให้ browser render รูป/layout ก่อนเปิดหน้าต่างพิมพ์
}

// --- แบบที่ 2: รูปภาพสำหรับส่ง LINE (ใช้ html2canvas แปลง HTML card เป็น PNG) ---
function renderLineImageReport(report) {
    const totalOverdue = report.overdueList.length;
    const totalUrgent = report.urgentList.length;
    const totalCompleted = report.completedList.length;
    const top3 = report.leaderboard.slice(0, 3);
    const medals = ['🥇', '🥈', '🥉'];

    const cardHtml = `
        <div id="lineImageCard" style="width:400px; padding:26px 22px; background:linear-gradient(160deg,#1b4332,#0d2a1f); font-family:'Sarabun',sans-serif; color:#fff;">
            <div style="text-align:center; margin-bottom:18px;">
                <img src="icons/icon-512.png" style="width:56px; height:56px; border-radius:14px;">
                <div style="font-size:16px; font-weight:800; margin-top:8px;">สรุปผล Service Tracker</div>
                <div style="font-size:11px; opacity:.7; margin-top:2px;">${formatThaiDate(report.startDate)} — ${formatThaiDate(report.endDate)}</div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:18px;">
                <div style="background:rgba(255,255,255,0.08); border-radius:14px; padding:14px; text-align:center;">
                    <div style="font-size:26px; font-weight:800; color:#4ade80;">${totalCompleted}</div>
                    <div style="font-size:10px; opacity:.75; margin-top:2px;">PM สำเร็จ</div>
                </div>
                <div style="background:rgba(255,255,255,0.08); border-radius:14px; padding:14px; text-align:center;">
                    <div style="font-size:26px; font-weight:800; color:#fb7185;">${totalOverdue}</div>
                    <div style="font-size:10px; opacity:.75; margin-top:2px;">เลยกำหนด</div>
                </div>
                <div style="background:rgba(255,255,255,0.08); border-radius:14px; padding:14px; text-align:center;">
                    <div style="font-size:26px; font-weight:800; color:#fdba74;">${totalUrgent}</div>
                    <div style="font-size:10px; opacity:.75; margin-top:2px;">ใกล้กำหนด</div>
                </div>
                <div style="background:rgba(255,255,255,0.08); border-radius:14px; padding:14px; text-align:center;">
                    <div style="font-size:26px; font-weight:800; color:#ffb703;">${report.totalRenewed}</div>
                    <div style="font-size:10px; opacity:.75; margin-top:2px;">ต่ออายุสะสม</div>
                </div>
            </div>
            ${top3.length > 0 ? `
            <div style="background:rgba(255,255,255,0.06); border-radius:14px; padding:14px;">
                <div style="font-size:11px; font-weight:700; letter-spacing:.5px; opacity:.7; margin-bottom:10px; text-transform:uppercase;">Top ผู้ทำ PM สูงสุด</div>
                ${top3.map((t, i) => `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:5px 0; ${i < top3.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,0.08);' : ''}">
                        <span style="font-size:13px;">${medals[i]} ${escapeHtml(t.tech)}</span>
                        <span style="font-size:13px; font-weight:800; color:#ffb703;">${t.count} ครั้ง</span>
                    </div>
                `).join('')}
            </div>` : ''}
            <div style="text-align:center; margin-top:18px; font-size:10px; opacity:.5;">C2TECH SERVICE TRACKER · ${formatThaiDate(new Date())}</div>
        </div>
    `;

    const temp = document.createElement('div');
    temp.style.position = 'fixed';
    temp.style.left = '-9999px';
    temp.innerHTML = cardHtml;
    document.body.appendChild(temp);

    Swal.fire({ title: 'กำลังสร้างรูปภาพ...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    html2canvas(document.getElementById('lineImageCard'), { scale: 2 }).then(canvas => {
        document.body.removeChild(temp);
        const imgUrl = canvas.toDataURL('image/png');

        Swal.fire({
            title: 'รูปสรุปสำหรับ LINE',
            html: `<img src="${imgUrl}" style="width:100%; border-radius:12px; box-shadow:0 4px 14px rgba(0,0,0,0.15);">`,
            confirmButtonText: '<i class="fas fa-download"></i> ดาวน์โหลดรูป',
            confirmButtonColor: '#1b4332',
            showCancelButton: true,
            cancelButtonText: 'ปิด'
        }).then((result) => {
            if (result.isConfirmed) {
                const link = document.createElement('a');
                link.href = imgUrl;
                link.download = `service_report_${report.startDate}_to_${report.endDate}.png`;
                link.click();
            }
        });
    }).catch(err => {
        document.body.removeChild(temp);
        Swal.fire('Error', 'สร้างรูปภาพไม่สำเร็จ: ' + err.message, 'error');
    });
}

async function openPmDashboard() {
    if (!isAdmin) { Swal.fire({ icon: 'warning', title: 'สิทธิ์ไม่เพียงพอ', text: 'กรุณาล็อกอินเป็น Admin ก่อน' }); return; }

    Swal.fire({ title: 'กำลังโหลดข้อมูล...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    let records = [];
    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'pm_stats' }),
            headers: { "Content-Type": "text/plain;charset=utf-8" }
        });
        const result = await response.json();
        records = result.records || [];
    } catch (e) {
        Swal.fire('Error', 'โหลดข้อมูลไม่สำเร็จ', 'error');
        return;
    }

    const currentYear = new Date().getFullYear();
    const years = [...new Set(records.map(r => r.year))];
    if (!years.includes(currentYear)) years.push(currentYear);
    years.sort((a, b) => b - a);

    const monthNames = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

    Swal.fire({
        title: 'แดชบอร์ด PM รายบุคคล',
        html: `
            <div style="display:flex; gap:8px; margin-bottom:14px; justify-content:center; flex-wrap:wrap;">
                <select id="dash-year" class="swal2-select" style="height:36px; margin:0;">
                    ${years.map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>ปี ${y}</option>`).join('')}
                </select>
                <select id="dash-mode" class="swal2-select" style="height:36px; margin:0;">
                    <option value="year">รวมทั้งปี</option>
                    <option value="month">รายเดือน</option>
                </select>
                <select id="dash-month" class="swal2-select" style="height:36px; margin:0; display:none;">
                    ${monthNames.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}
                </select>
            </div>
            <div id="dash-empty" style="display:none; color:#94a3b8; padding:40px 0;">ไม่มีข้อมูลในช่วงที่เลือก</div>
            <div style="height:280px;"><canvas id="dash-chart"></canvas></div>
        `,
        width: '600px',
        showConfirmButton: false,
        showCloseButton: true,
        didOpen: () => {
            const renderChart = () => {
                const year = parseInt(document.getElementById('dash-year').value);
                const mode = document.getElementById('dash-mode').value;
                const month = parseInt(document.getElementById('dash-month').value || '1');

                const filtered = records.filter(r => r.year === year && (mode === 'year' || r.month === month));
                const counts = {};
                filtered.forEach(r => { counts[r.tech] = (counts[r.tech] || 0) + 1; });
                const labels = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
                const chartData = labels.map(l => counts[l]);

                document.getElementById('dash-empty').style.display = labels.length === 0 ? 'block' : 'none';
                document.getElementById('dash-chart').style.display = labels.length === 0 ? 'none' : 'block';

                if (pmDashboardChart) pmDashboardChart.destroy();
                if (labels.length === 0) return;

                pmDashboardChart = new Chart(document.getElementById('dash-chart'), {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{ label: 'จำนวนครั้งที่เข้า PM', data: chartData, backgroundColor: '#2d6a4f', borderRadius: 6 }]
                    },
                    options: {
                        indexAxis: 'y',
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: { x: { ticks: { stepSize: 1 } } }
                    }
                });
            };

            document.getElementById('dash-mode').onchange = (e) => {
                document.getElementById('dash-month').style.display = e.target.value === 'month' ? 'inline-block' : 'none';
                renderChart();
            };
            document.getElementById('dash-year').onchange = renderChart;
            document.getElementById('dash-month').onchange = renderChart;
            renderChart();
        },
        willClose: () => {
            if (pmDashboardChart) { pmDashboardChart.destroy(); pmDashboardChart = null; }
        }
    });
}

updateUserProfileIcon();
const hasCachedData = loadFromCache();
loadData(false, hasCachedData);

// อ่านไฟล์เป็น Data URL (ใช้กับ fallback file input)
function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ย่อขนาดรูปก่อนส่ง (ทั้งจากกล้องในแอปและจากไฟล์ที่เลือก) ให้ผ่าน POST ได้ไวและประหยัดพื้นที่ Drive
function resizeImageDataUrl(dataUrl, maxWidth = 800, quality = 0.6) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const w = Math.min(maxWidth, img.width);
            canvas.width = w;
            canvas.height = img.height * (w / img.width);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = dataUrl;
    });
}

// ฟังก์ชันกลางสำหรับย่อรูป+ส่งขึ้น Drive ใช้ร่วมกันทั้งจากกล้องในแอปและ fallback file picker
async function uploadImageForStep(sn, pmStep, rawDataUrlOrFile) {
    if (!currentUser) {
        Swal.fire({ icon: 'warning', title: 'ต้องเข้าสู่ระบบก่อน', text: 'กรุณาเข้าสู่ระบบก่อนอัปโหลดรูป' });
        return;
    }
    Swal.fire({ title: 'กำลังอัปโหลด...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const rawDataUrl = (rawDataUrlOrFile instanceof File)
            ? await readFileAsDataUrl(rawDataUrlOrFile)
            : rawDataUrlOrFile;

        const imageData = await resizeImageDataUrl(rawDataUrl, 800, 0.6);

        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                sn: sn,
                action: 'photo',
                pmStep: pmStep,
                image: imageData,
                fileName: `PM_IMG_${sn}_${pmStep}_${Date.now()}.jpg`
            }),
            headers: { "Content-Type": "text/plain;charset=utf-8" }
        });
        const result = await response.json();

        if (result.status !== "success") {
            throw new Error(result.message || "อัปโหลดไม่สำเร็จ");
        }

        Swal.close();
        Toast.fire({ icon: 'success', title: 'อัปโหลดรูปสำเร็จ' });
        loadData(true);
    } catch (err) {
        console.error("Upload photo by step error:", err);
        Swal.fire({ icon: 'error', title: 'อัปโหลดไม่สำเร็จ', text: err.message || 'กรุณาลองใหม่อีกครั้ง' });
    }
}

// ทางเลือกสำรอง: ใช้ file picker ปกติ (input[type=file]) — ใช้เมื่อเปิดกล้องในแอปไม่ได้เท่านั้น
async function uploadPhotoByStep(sn, pmStep, input) {
    if (!input.files || input.files.length === 0) return;
    await uploadImageForStep(sn, pmStep, input.files[0]);
    input.value = ''; // เคลียร์ไว้เผื่อเลือกไฟล์เดิมซ้ำได้อีกครั้ง
}

// --- กล้องถ่ายรูปในแอป (แก้ปัญหา capture="environment" ของ input file ไม่เสถียรบน Android บางเครื่อง) ---
async function capturePhotoForStep(sn, pmStep) {
    if (!currentUser) {
        const doLogin = await Swal.fire({
            icon: 'info',
            title: 'ต้องเข้าสู่ระบบก่อน',
            text: 'กรุณาเข้าสู่ระบบก่อนแนบรูปหน้างาน เพื่อระบุตัวผู้ปฏิบัติงานให้ถูกต้อง',
            showCancelButton: true,
            confirmButtonText: 'เข้าสู่ระบบ',
            confirmButtonColor: '#1b4332',
            cancelButtonText: 'ยกเลิก'
        });
        if (doLogin.isConfirmed) await showLoginModal();
        return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        // เบราว์เซอร์นี้ไม่รองรับกล้องในเว็บ -> fallback ไปใช้ file picker ปกติทันที
        document.getElementById(`img-${sn}-${pmStep}`).click();
        return;
    }

    const captureResult = await openCameraCapture();

    if (captureResult === 'FALLBACK') {
        document.getElementById(`img-${sn}-${pmStep}`).click();
        return;
    }
    if (!captureResult) return; // ผู้ใช้กดยกเลิก

    await uploadImageForStep(sn, pmStep, captureResult);
}

// เปิด modal กล้องถ่ายรูป คืนค่าเป็น Data URL ของรูปที่ถ่าย, null ถ้ายกเลิก, หรือ 'FALLBACK' ถ้าเปิดกล้องไม่ได้
function openCameraCapture() {
    return new Promise((resolve) => {
        let stream = null;
        let capturedDataUrl = null;
        let cameraFailed = false;

        Swal.fire({
            title: 'ถ่ายรูปหน้างาน',
            html: `
                <div style="position:relative; background:#000; border-radius:12px; overflow:hidden;">
                    <video id="cam-video" autoplay playsinline muted style="width:100%; max-height:55vh; display:block; background:#000;"></video>
                    <img id="cam-preview" style="width:100%; max-height:55vh; display:none; object-fit:contain; background:#000;">
                </div>
                <div id="cam-shutter-group" style="margin-top:14px;">
                    <button id="cam-shutter-btn" type="button" style="background:#1b4332; color:#fff; border:none; width:60px; height:60px; border-radius:50%; font-size:20px; cursor:pointer;">
                        <i class="fas fa-camera"></i>
                    </button>
                </div>
                <div id="cam-retake-group" style="display:none; margin-top:14px;">
                    <button id="cam-retake-btn" type="button" style="background:#64748b; color:#fff; border:none; padding:10px 18px; border-radius:10px; cursor:pointer; font-weight:700;">
                        <i class="fas fa-rotate-left"></i> ถ่ายใหม่
                    </button>
                </div>
                <div style="font-size:11px; color:#94a3b8; margin-top:10px;">ถ้าเปิดกล้องไม่ติด ระบบจะสลับไปใช้ปุ่มเลือกไฟล์แทนให้อัตโนมัติ</div>
            `,
            width: '480px',
            showCancelButton: true,
            showConfirmButton: true,
            confirmButtonText: 'ใช้รูปนี้',
            confirmButtonColor: '#1b4332',
            cancelButtonText: 'ยกเลิก',
            allowOutsideClick: false,
            didOpen: async () => {
                const video = document.getElementById('cam-video');
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
                    video.srcObject = stream;
                } catch (err) {
                    console.error('Camera error:', err);
                    cameraFailed = true;
                    Swal.close();
                    return;
                }

                document.getElementById('cam-shutter-btn').onclick = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = video.videoWidth || 800;
                    canvas.height = video.videoHeight || 600;
                    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
                    capturedDataUrl = canvas.toDataURL('image/jpeg', 0.85);

                    document.getElementById('cam-preview').src = capturedDataUrl;
                    document.getElementById('cam-preview').style.display = 'block';
                    video.style.display = 'none';
                    document.getElementById('cam-shutter-group').style.display = 'none';
                    document.getElementById('cam-retake-group').style.display = 'block';
                };

                document.getElementById('cam-retake-btn').onclick = () => {
                    capturedDataUrl = null;
                    document.getElementById('cam-preview').style.display = 'none';
                    video.style.display = 'block';
                    document.getElementById('cam-shutter-group').style.display = 'block';
                    document.getElementById('cam-retake-group').style.display = 'none';
                };
            },
            preConfirm: () => {
                if (!capturedDataUrl) {
                    Swal.showValidationMessage('กรุณากดปุ่มถ่ายรูปก่อน');
                    return false;
                }
                return capturedDataUrl;
            },
            willClose: () => {
                if (stream) stream.getTracks().forEach(t => t.stop()); // ปิดกล้องเสมอตอนออกจาก modal (สำคัญมาก ไม่งั้นกล้องค้างเปิดอยู่)
            }
        }).then((result) => {
            if (cameraFailed) { resolve('FALLBACK'); return; }
            if (result.isConfirmed) resolve(result.value);
            else resolve(null);
        });
    });
}

function clearAllFilters() {
    // 1. ล้างช่องค้นหา (ID ในไฟล์นี้คือ mainSearch)
    const mainSearch = document.getElementById('mainSearch');
    if (mainSearch) mainSearch.value = '';

    // 2. ปิด Switch 'RENEW'
    const renewSwitch = document.getElementById('showRenewOnlySwitch');
    if (renewSwitch) renewSwitch.checked = false;

    // 3. ปลด Checkbox 'COMPLETE'
    const hideCompleteSwitch = document.getElementById('hideCompleteSwitch');
    if (hideCompleteSwitch) hideCompleteSwitch.checked = false;

    // 3.5 รีเซ็ต filter Type/Mode
    const typeFilter = document.getElementById('typeFilter');
    if (typeFilter) typeFilter.value = 'all';
    const modeFilter = document.getElementById('modeFilter');
    if (modeFilter) modeFilter.value = 'all';

    // 4. รีเซ็ตปุ่ม Filter ด้านบนให้กลับมาที่ 'ทั้งหมด'
    currentMode = 'all';
    document.querySelectorAll('.f-card').forEach(c => c.classList.remove('active-all', 'active-overdue', 'active-urgent'));
    document.getElementById('f-all').classList.add('active-all');

    // 5. เรียกประมวลผลใหม่
    render();

    // แจ้งเตือนเล็กน้อย
    Swal.fire({
        icon: 'success',
        title: 'ล้างตัวกรองทั้งหมดแล้ว',
        timer: 800,
        showConfirmButton: false,
        toast: true,
        position: 'top-end'
    });
}