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

// ฟังก์ชันเข้าสู่ระบบ
async function adminAuth() {
    if (isAdmin) {
        isAdmin = false;
        adminPasswordCache = '';
        document.getElementById('lockIcon').className = 'fas fa-lock admin-login-btn';
        Swal.fire({ icon: 'info', title: 'ออกจากระบบ Admin', timer: 1000, showConfirmButton: false });
        render();
        return;
    }

    const { value: password } = await Swal.fire({
        title: 'Admin Access',
        input: 'password',
        inputLabel: 'กรุณาใส่รหัสผ่าน',
        inputPlaceholder: 'Password',
        confirmButtonColor: '#1b4332'
    });

    if (password === undefined) return; // กดยกเลิก

    if (btoa(password) === _0x1a2b) {
        isAdmin = true;
        adminPasswordCache = password;
        document.getElementById('lockIcon').className = 'fas fa-lock-open admin-login-btn active';
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
        }
    } catch (e) {
        console.error("Load cache error:", e);
    }
}

async function loadData(silent = false) {
    if (!silent) {
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
        if (!silent) {
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

function render() {
    const main = document.getElementById('serviceList');
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
                            ${photoUrl ? `<a href="${photoUrl}" target="_blank" style="color:var(--secondary); font-size:11px; text-decoration:none; margin-top:3px; display:inline-block;"><i class="fas fa-image"></i> ดูรูปงาน</a>` : ''} 
                            ${gpsVal && gpsVal !== 'No GPS' ? `<a href="${gpsVal}" target="_blank" style="color:#4285F4; font-size:11px; text-decoration:none; margin-top:3px; margin-left:8px; display:inline-block;"><i class="fas fa-map-marker-alt"></i> ดูตำแหน่ง GPS</a>` : ''}
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
                    <label style="font-size:11px; font-weight:800; color:var(--primary); display:flex; align-items:center; gap:6px;"><i class="fas fa-rotate"></i> ต่ออายุ Service รายปี (ระบุวันที่เริ่ม)</label>
                    <div class="action-group" style="margin-top:8px;">
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
// ถ้าเบราว์เซอร์ไม่รองรับ หรือผู้ใช้ไม่อนุญาต จะคืนค่า 'No GPS' แทน (ไม่ทำให้การบันทึกล้มเหลว)
function getGpsLink() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) return resolve('No GPS');
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve(`https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`),
            () => resolve('No GPS'), // ผู้ใช้กด Deny หรือหาตำแหน่งไม่ได้
            { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 }
        );
    });
}

// --- ฟังก์ชันบันทึกข้อมูลพร้อม GPS จริงและชื่อช่างผู้ปฏิบัติงาน ---
async function handleCheck(box, sn, stepKey) {
    if (!box.checked) return;

    const savedTechName = localStorage.getItem('tech_name') || '';

    const confirm = await Swal.fire({
        title: 'ยืนยันปิดงาน?',
        html: `
            <p style="margin-bottom:12px; color:#475569;">คุณต้องการบันทึกการเข้าบริการในครั้งนี้ใช่หรือไม่?</p>
            <input id="swal-tech-name" class="swal2-input" placeholder="ชื่อช่างผู้ปฏิบัติงาน" value="${escapeHtml(savedTechName)}" style="margin:0;">
        `,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#1b4332',
        confirmButtonText: 'ตกลง',
        cancelButtonText: 'ยกเลิก',
        preConfirm: () => document.getElementById('swal-tech-name').value.trim()
    });

    if (!confirm.isConfirmed) { box.checked = false; return; }

    const techName = confirm.value;
    if (techName) localStorage.setItem('tech_name', techName); // จำชื่อไว้ ไม่ต้องพิมพ์ซ้ำครั้งหน้า

    Swal.fire({
        title: 'กำลังตรวจสอบตำแหน่ง GPS...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    const gpsLink = await getGpsLink();
    Swal.update({ title: 'กำลังบันทึก...' });

    try {
        // สร้างวันปัจจุบันในรูปแบบ ค.ศ.
        const now = new Date();
        const formattedDate = now.toLocaleDateString('en-GB') + ' ' + now.toLocaleTimeString('en-GB');

        // ปรับให้เหมือนกับฟังก์ชัน renewService และ photo เพื่อความเสถียร
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                sn: sn,
                action: 'complete_pm',
                pmStep: stepKey,
                gps: gpsLink,
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
        Toast.fire({ icon: 'success', title: 'บันทึกสำเร็จ' });
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

        const text = card.innerText.toLowerCase();
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

loadFromCache();
loadData();

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