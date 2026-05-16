const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzfxSIbcQXsUYr4NQ58UmrfsfgTv9wvoJkzDHHqKtuKWxzmXLTwtC9gzbLBS3U4moH9/exec";
let appData = [];
let currentMode = 'all';

// 1. กำหนดรหัสผ่านและการเข้าถึง
let isAdmin = false;
const _0x1a2b = "MTkwOTE1MTI="

// ฟังก์ชันเข้าสู่ระบบ
async function adminAuth() {
    if (isAdmin) {
        isAdmin = false;
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

    if (btoa(password) === _0x1a2b) {
        isAdmin = true;
        document.getElementById('lockIcon').className = 'fas fa-lock-open admin-login-btn active';
        Swal.fire({ icon: 'success', title: 'ยินดีต้อนรับ Admin', timer: 1000, showConfirmButton: false });
        render();
    } else if (password) {
        Swal.fire({ icon: 'error', title: 'รหัสผ่านไม่ถูกต้อง' });
    }
}
async function loadData() {
    document.getElementById('refreshIcon').classList.add('fa-spin');
    document.getElementById('loading').style.display = 'block';
    try {
        const res = await fetch(SCRIPT_URL);
        appData = await res.json();
        render();
        // --- เพิ่มบรรทัดนี้ ---
        checkNotice();
        // -------------------
    } catch (e) { Swal.fire('Error', 'โหลดข้อมูลไม่สำเร็จ', 'error'); }
    finally {
        document.getElementById('refreshIcon').classList.remove('fa-spin');
        document.getElementById('loading').style.display = 'none';
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

        [1, 2, 3].forEach((idx) => {
            const plannedDateVal = m[`PM${idx}_Date`];
            const activeDateVal = m[`PM${idx}_Status`];
            const photoUrl = m[`PM${idx}_Photo`];
            if (!plannedDateVal) return;
            const pDate = new Date(plannedDateVal);
            const isDone = !!activeDateVal;
            const actualDate = isDone ? new Date(activeDateVal).toLocaleDateString('en-GB') : '';
            let stepState = isDone ? 'done' : (pDate < now ? 'overdue' : (pDate <= limit ? 'urgent' : ''));

            if (!isDone) {
                if (stepState === 'overdue') cardState = 'card-overdue';
                else if (stepState === 'urgent' && cardState !== 'card-overdue') cardState = 'card-urgent';
            }

            stepsHTML += `
                    <div class="pm-step ${stepState}">
                        <input type="checkbox" onchange="handleCheck(this,'${sn}','PM${idx}')" ${isDone ? 'checked disabled' : ''}>
                        <div class="step-info">
                            <div style="font-weight: 700;">PM รอบที่ ${idx}</div>
                            <div style="font-size: 11px; color: var(--text-sub);">แผน: ${pDate.toLocaleDateString('en-GB')}</div>
                            ${isDone ? `<div style="font-size: 11px; color: var(--success); font-weight: bold;"><i class="fas fa-check-circle"></i> เข้าจริง: ${actualDate}</div>` : ''}
                            ${photoUrl ? `<a href="${photoUrl}" target="_blank" style="color:var(--secondary); font-size:11px; text-decoration:none; margin-top:3px; display:inline-block;"><i class="fas fa-image"></i> ดูรูปงาน</a>` : ''} 
                            ${!isDone ? `
                                <div style="margin-top:5px;">
                                    <button onclick="document.getElementById('img-${sn}-PM${idx}').click()" style="font-size:10px; padding:2px 8px; border-radius:5px; border:1px solid #ccc; background:#fff;">
                                        <i class="fas fa-camera"></i> แนบรูป PM${idx}
                                    </button>
                                    <input type="file" id="img-${sn}-PM${idx}" accept="image/*" style="display:none" onchange="uploadPhotoByStep('${sn}', 'PM${idx}', this)">
                                </div>
                            ` : ''} 
                        </div>
                    </div>`;
        });

        const card = document.createElement('div');
        card.className = `s-card ${cardState}`;
        card.setAttribute('data-sn', sn);
        card.setAttribute('data-renew', isRenewed);

        // สร้างส่วน UI ของ Renew โดยเช็คเงื่อนไข isAdmin
        const renewUI = isAdmin ? `
                <div style="margin-top:15px; border-top:1px dashed #ccc; padding-top:10px;">
                    <label style="font-size:11px; font-weight:800; color:var(--primary)">ต่ออายุ Service รายปี (ระบุวันที่เริ่ม)</label>
                    <div class="action-group" style="display:flex; gap:5px; margin-top:5px;">
                        <input type="date" id="renew-${sn}" style="flex:2; padding:8px; border-radius:8px; border:1px solid #ddd;">
                        <button class="btn-save" onclick="renewService('${sn}')" style="background:var(--secondary); flex:1; padding:8px;">เริ่มรอบใหม่</button>
                    </div>
                </div>` : '';

        card.innerHTML = `
                    ${isRenewed ? '<div class="status-badge">ต่อรายปี</div>' : ''} 
                    <div class="client-header">
                        <div class="client-info" onclick="toggleDetail('${sn}')">
                            <div class="client-name">${client}</div>
                            <div class="client-loc"><i class="fas fa-map-marker-alt"></i> ${location} | S/N: ${sn}</div>
                        </div>
                    </div>
                    <button class="toggle-btn" onclick="toggleDetail('${sn}')" id="btn-${sn}">
                        <i class="fas fa-chevron-down"></i> ดูรายละเอียดและบันทึก
                    </button>
                    <div class="detail-mode" id="detail-${sn}">
                        <div class="device-info">
                            <div class="info-row"><span class="info-label">S/N:</span><span class="info-val">${sn}</span></div>
                            <div class="info-row"><span class="info-label">Model:</span><span class="info-val">${modelVal}</span></div>
                            <!-- ส่วนที่เพิ่มใหม่ -->
                            <div class="info-row">
                                <span class="info-label">Mode / Type:</span>
                                <span class="info-val">
                                    <span style="color: var(--secondary);">${modeVal}</span> / 
                                    <span style="color: #4285F4;">${typeVal}</span>
                                </span>
                            </div>
                        </div>
                        <div class="pm-steps">${stepsHTML}</div>

                    <!-- ใส่ส่วน Renew UI ที่ประมวลผลแล้วตรงนี้ -->
                    ${renewUI}

                    <textarea id="n-${sn}" rows="2" placeholder="เพิ่มหมายเหตุ...">${m["Admin_Note"] || ""}</textarea>
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

// --- ฟังก์ชันบันทึกข้อมูลแบบปิด GPS ---
async function handleCheck(box, sn, stepKey) {
    if (!box.checked) return;

    const confirm = await Swal.fire({
        title: 'ยืนยันปิดงาน?',
        text: "คุณต้องการบันทึกการเข้าบริการในครั้งนี้ใช่หรือไม่?",
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#1b4332',
        confirmButtonText: 'ตกลง',
        cancelButtonText: 'ยกเลิก'
    });

    if (confirm.isConfirmed) {
        Swal.fire({
            title: 'กำลังบันทึก...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        try {
            // สร้างวันปัจจุบันในรูปแบบ ค.ศ.
            const now = new Date();
            const formattedDate = now.toLocaleDateString('en-GB') + ' ' + now.toLocaleTimeString('en-GB');

            // ปรับให้เหมือนกับฟังก์ชัน renewService และ photo เพื่อความเสถียร
            await fetch(SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors', // เพิ่มตรงนี้เพื่อกัน Error บน Google Sites
                body: JSON.stringify({
                    sn: sn,
                    action: 'complete_pm',
                    pmStep: stepKey,
                    gps: "No GPS",
                    logTime: formattedDate
                })
            });
            Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ', timer: 1500, showConfirmButton: false });
            loadData();
        } catch (e) {
            Swal.fire('Error', 'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง', 'error');
            box.checked = false;
        }
    } else { box.checked = false; }
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
            await fetch(SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors', // สำคัญสำหรับ Google Sites
                body: JSON.stringify({
                    sn: sn,
                    action: 'renew_service',
                    startDate: startDate
                })
            });

            setTimeout(() => {
                Swal.fire({ icon: 'success', title: 'เริ่มรอบใหม่สำเร็จ', timer: 1500, showConfirmButton: false });
                loadData();
            }, 2000); // หน่วงเวลา 2 วินาที
        } catch (e) {
            Swal.fire('Error', 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้', 'error');
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
        await fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({ sn: sn, action: 'update_note', note: val })
        });

        // ปรับการแจ้งเตือนกลับมาไว้กลางจอ
        await Swal.fire({
            icon: 'success',
            title: 'บันทึกข้อมูลเรียบร้อย',
            text: 'หมายเหตุสำหรับ S/N: ' + sn + ' ถูกอัปเดตแล้ว',
            confirmButtonColor: '#1b4332', // สีเขียว C2TECH
            confirmButtonText: 'ตกลง'
        });

    } catch (e) {
        Swal.fire({
            icon: 'error',
            title: 'เกิดข้อผิดพลาด',
            text: 'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง',
            confirmButtonColor: '#d00000'
        });
    } finally {
        // คืนค่าปุ่มกลับมาเป็นปกติ
        btn.disabled = false;
        btn.innerHTML = oldHtml;
    }
}

async function uploadMultiplePhotos(sn, input) {
    if (!input.files || input.files.length === 0) return;
    const files = Array.from(input.files);

    const btn = input.nextElementSibling;
    const oldHtml = btn.innerHTML;
    btn.disabled = true;

    Swal.fire({
        title: 'กำลังอัปโหลด...',
        text: `เตรียมอัปโหลดทั้งหมด ${files.length} รูป`,
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    let successCount = 0;
    for (let i = 0; i < files.length; i++) {
        try {
            const imageData = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        let w = img.width; let h = img.height;
                        // ปรับความกว้างเป็น 1000px เพื่อลดขนาดไฟล์ให้ส่งผ่าน iframe ได้ง่ายขึ้น
                        if (w > 1000) { h = h * (1000 / w); w = 1000; }
                        canvas.width = w; canvas.height = h;
                        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                        resolve(canvas.toDataURL('image/jpeg', 0.8)); // ใช้ Quality 0.8 เพื่อความประหยัดเนื้อที่
                    };
                    img.src = e.target.result;
                };
                reader.readAsDataURL(files[i]);
            });

            // การส่ง fetch แบบปรับปรุงเพื่อ Google Sites
            await fetch(SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors', // สำคัญ: ช่วยให้ข้ามข้อจำกัด CORS บน Google Sites ได้
                body: JSON.stringify({
                    sn: sn,
                    action: 'photo',
                    image: imageData,
                    fileName: `IMG_${sn}_${Date.now()}_${i + 1}.jpg`
                })
            });

            successCount++;
            Swal.update({ text: `ส่งรูปที่ ${successCount} จาก ${files.length} แล้ว...` });
        } catch (e) {
            console.error("Upload error:", e);
        }
    }

    Swal.fire({
        icon: 'success',
        title: 'ดำเนินการเสร็จสิ้น',
        text: `ส่งข้อมูลรูปภาพ ${successCount} รูปเรียบร้อย`,
        timer: 2000,
        showConfirmButton: false
    });

    btn.disabled = false;
    btn.innerHTML = oldHtml;
    input.value = '';
}

// --- ส่วนที่ปรับปรุงในฟังก์ชัน runFilters ---
function runFilters() {
    const q = document.getElementById('mainSearch').value.toLowerCase();
    const cards = document.querySelectorAll('.s-card');
    const isShowRenewOnly = document.getElementById('showRenewOnlySwitch').checked;

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

        if (matchSearch && matchMode && matchRenew) {
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

loadData();

async function uploadPhotoByStep(sn, pmStep, input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];

    Swal.fire({ title: 'กำลังอัปโหลด...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    const reader = new FileReader();
    reader.onload = async (e) => {
        const img = new Image();
        img.onload = async () => {
            const canvas = document.createElement('canvas');
            // ปรับลดเหลือ 800px เพื่อให้ส่งผ่าน iframe ได้ชัวร์ๆ
            let w = 800;
            canvas.width = w;
            canvas.height = img.height * (w / img.width);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

            // ปรับคุณภาพเหลือ 0.6 (ประหยัดพื้นที่และส่งไวขึ้น)
            const imageData = canvas.toDataURL('image/jpeg', 0.6);

            await fetch(SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors', // โหมดนี้จะไม่ส่ง Error กลับมาที่หน้าเว็บ ทำให้ดูเหมือนบันทึกสำเร็จ
                body: JSON.stringify({
                    sn: sn,
                    action: 'photo',
                    pmStep: pmStep,
                    image: imageData,
                    fileName: `PM_IMG_${sn}_${pmStep}_${Date.now()}.jpg`
                })
            });

            // หน่วงเวลาเพื่อให้แน่ใจว่าระบบหลังบ้านทำงานเสร็จ
            setTimeout(() => {
                Swal.fire({ icon: 'success', title: 'ส่งข้อมูลแล้ว', timer: 1500, showConfirmButton: false });
                loadData();
            }, 2000);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
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