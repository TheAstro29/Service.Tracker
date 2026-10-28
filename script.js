// สำคัญ: ต้องมี "?app=service" ต่อท้ายเสมอ เพราะโปรเจกต์ Apps Script นี้ใช้ไฟล์ Code.gs ไฟล์เดียว
// รวม Panolyzer Management + Service Tracker ไว้ด้วยกัน แล้วใช้ query นี้แยกว่า request มาจากแอปไหน
// (ไม่มี ?app= หรือค่าอื่น = ถือเป็น Panolyzer Management ตามพฤติกรรมเดิม)
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzVzNPx9iTSbJwdaYH3YSNRuyaMgXel40oWfDlzY8KlMLXG2X5-1X63A9QBgF8JDD-z/exec?app=service";
let appData = [];
let currentMode = 'all';

// เก็บ cache ประวัติอะไหล่ที่เปลี่ยนของแต่ละเครื่อง โครงสร้าง: { [sn]: { PM1:[{name,qty,note,tech,logId}], PM2:[...], PM3:[...] } }
// โหลดแบบ lazy (เฉพาะตอนเปิดดูรายละเอียดเครื่องนั้นครั้งแรก) เพื่อไม่ต้องแก้ endpoint หลักที่โหลดข้อมูลทั้งหมด
let partsCache = {};

// รายการอะไหล่ที่พบบ่อยสำหรับ dropdown — ยังไม่เคยมีการบันทึกจริงมาก่อน จึงเปิดกว้างไว้ก่อนด้วยตัวเลือก "อื่นๆ (ระบุเอง)"
// ค่อยขยายรายการนี้ภายหลังตามอะไหล่ที่ช่างพิมพ์เองบ่อยๆ ในสนามจริง
const COMMON_PARTS = [
    'เซนเซอร์วัดความชื้น',
    'หลอดไฟ LED ภายในเครื่อง',
    'ฟิวส์ / ฟิวส์กันไฟกระชาก',
    'พัดลมระบายความร้อน',
    'สายไฟ',
    'สาย VGA',
    'สาย LAN',
    'สาย HDMI',
    'สาย USB'
];

// Toast แจ้งเตือนเล็กๆ มุมขวาบน ใช้แทน popup เต็มจอเวลาบันทึกสำเร็จ (ไม่บล็อกการใช้งานต่อ)
const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 2000,
    timerProgressBar: true
});

// 1. ผู้ใช้ปัจจุบัน + สิทธิ์ (admin / staff / guest) — หลังบ้านเป็นคนตรวจสิทธิ์จริงทุกคำสั่ง
// หน้าเว็บใช้แค่ซ่อน/แสดงปุ่มให้ตรงกับสิทธิ์ ไม่มีรหัส Admin เก็บในหน้าเว็บแล้ว
const ST_TOKEN_KEY = 'c2tech_service_token';
let stToken = '';
let currentUser = null;
try {
    stToken = localStorage.getItem(ST_TOKEN_KEY) || '';
    currentUser = stToken ? JSON.parse(localStorage.getItem('current_user') || 'null') : null;
} catch (e) { stToken = ''; currentUser = null; }
if (!currentUser) stToken = '';
let isAdmin = false;
let stRole = 'guest';
const ST_ROLE_LABEL = { admin: 'Admin', staff: 'Staff', guest: 'Guest' };

function stApplyRole() {
    stRole = currentUser ? (currentUser.role || 'staff') : 'guest';
    isAdmin = !!currentUser && stRole === 'admin';
    document.documentElement.dataset.role = currentUser ? stRole : 'none';
}
function stCanEdit() { return !!currentUser && (stRole === 'staff' || stRole === 'admin'); }
// เรียกก่อนทำงานที่ต้องแก้ข้อมูล — Guest จะเห็นข้อความบอกแทน
function stGuard() {
    if (stCanEdit()) return true;
    Swal.fire({ icon: 'info', title: 'ดูได้อย่างเดียว', text: 'บัญชี Guest ดูข้อมูลได้อย่างเดียว ถ้าต้องบันทึกงาน PM ให้ติดต่อ Admin เพื่อปรับสิทธิ์', confirmButtonColor: '#22392b', confirmButtonText: 'รับทราบ' });
    return false;
}
function stSaveSession(user, token) {
    currentUser = user;
    if (token) stToken = token;
    try {
        localStorage.setItem('current_user', JSON.stringify(currentUser));
        if (token) localStorage.setItem(ST_TOKEN_KEY, stToken);
    } catch (e) { }
    stApplyRole();
    updateUserProfileIcon();
}
function stClearSession() {
    currentUser = null; stToken = '';
    dbExtra = null;
    try {
        localStorage.removeItem('current_user');
        localStorage.removeItem(ST_TOKEN_KEY);
        localStorage.removeItem(CACHE_KEY); // ข้อมูลลูกค้าไม่ค้างในเครื่องหลังออกจากระบบ
    } catch (e) { }
    stApplyRole();
}
// ใส่ token ให้ทุกคำสั่งที่ส่งไปหลังบ้าน
function stBody(obj) { return JSON.stringify(Object.assign({}, obj, { token: stToken })); }
// ถ้าหลังบ้านบอกว่า session ใช้ไม่ได้แล้ว (หมดอายุ / ถูกเปลี่ยนสิทธิ์ / ปิดบัญชี) → กลับหน้าเข้าสู่ระบบ
async function stFetch(url, opts) {
    const res = await fetch(url, opts);
    try {
        const j = await res.clone().json();
        if (j && j.code === 'AUTH' && stToken) stSessionExpired(j.message);
    } catch (e) { }
    return res;
}
let stExpiredShown = false;
function stSessionExpired(msg) {
    if (stExpiredShown) return;
    stExpiredShown = true;
    stClearSession();
    appData = []; partsCache = {}; stSelected = null;
    try { Swal.close(); } catch (e) { }
    umClose(true); dbClose(); rpClose();
    stCloseDetail();
    render();
    stShowLogin(msg || 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
}
const CACHE_KEY = "c2tech_service_data_v1";

// โหลดข้อมูลที่ cache ไว้ล่าสุดมาโชว์ก่อนทันที (ระหว่างรอ fetch ข้อมูลใหม่จริงจาก Sheets)
// ช่วยเวลาเน็ตช้า/หลุดที่หน้างาน อย่างน้อยยังเห็นข้อมูลล่าสุดที่เคยโหลดได้ ไม่ใช่หน้าขาวรอเฉยๆ
function loadFromCache() {
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
            appData = JSON.parse(cached);
            render(); // ข้อมูลเก่าพร้อมอยู่ด้านหลังหน้าโหลด — หน้าโหลดจะปิดเองเมื่อครบเวลาขั้นต่ำ (ดู stSplash)
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
// ===== หน้าโหลดตอนเปิดแอป (splash) =====
// แสดงทุกครั้งที่เปิดแอปอย่างน้อย ST_SPLASH_MIN ms ให้เห็น animation ครบ ขั้นตอนเดินทีละขั้นตามเวลา
// และรอข้อมูลจริงถ้ายังโหลดไม่เสร็จ (ถ้ามีข้อมูลเก่าในเครื่อง ถือว่าพร้อมแล้ว ข้อมูลใหม่จะอัปเดตตามมาเองด้านหลัง)
// แตะหน้าจอเพื่อข้ามได้หลังข้อมูลพร้อม / กดรีเฟรชระหว่างใช้งานไม่ขึ้นหน้านี้
const ST_SPLASH_MIN = 2600;
const ST_SPLASH_STEP_MS = 750;
let stSplashActive = true;
let stSplashReady = false;
let stSplashPhase = 1;
let stSplashNotice = false;
let stSplashP3 = 0;
const stSplashStart = Date.now();
function stSplashTick() {
    if (!stSplashActive) return;
    const t = Date.now() - stSplashStart;
    // ขั้น 1 → 2 → 3 ตามเวลา แต่ขั้น 3 (ตรวจรอบ PM) จะเริ่มได้เมื่อข้อมูลมาแล้วเท่านั้น
    const want = t >= ST_SPLASH_STEP_MS * 2 && stSplashReady ? 3 : t >= ST_SPLASH_STEP_MS ? 2 : 1;
    if (want !== stSplashPhase) { stSplashPhase = want; stLoaderStep(want); if (want === 3) stSplashP3 = Date.now(); }
    // ปิดเมื่อครบเวลาขั้นต่ำ และขั้น "ตรวจรอบ PM" ได้โชว์อย่างน้อย 600ms (กรณีเน็ตช้า ข้อมูลมาทีหลัง)
    if (stSplashReady && stSplashPhase === 3 && t >= ST_SPLASH_MIN && Date.now() - stSplashP3 >= 600) { stSplashFinish(); return; }
    setTimeout(stSplashTick, 120);
}
function stSplashSetReady() {
    if (stSplashReady) return;
    stSplashReady = true;
    const n = appData.length;
    document.getElementById('loaderStatusText').innerText = n ? `พบ ${n} เครื่อง` : '';
}
function stSplashFinish() {
    if (!stSplashActive) return;
    stSplashActive = false;
    stLoaderStep(4);
    const el = document.getElementById('loading');
    setTimeout(() => { el.classList.add('ld-hide'); }, 300);
    setTimeout(() => {
        el.style.display = 'none'; el.classList.remove('ld-hide');
        if (!stToken) { const u = document.getElementById('lgUser'); if (u && !u.value && window.innerWidth >= 900) u.focus(); return; }
        if (stSplashNotice) checkNotice();
    }, 800);
}
document.getElementById('loading').addEventListener('click', () => { if (stSplashActive && stSplashReady) stSplashFinish(); });

// v3: loader เต็มจอแสดงเฉพาะตอนยังไม่มีข้อมูลในเครื่องเลย (เปิดครั้งแรก) — กดรีเฟรชทีหลังแค่หมุนไอคอนบนปุ่ม
function stLoaderStep(n, text) {
    document.querySelectorAll('#ldSteps li').forEach(li => {
        const s2 = +li.dataset.s;
        li.className = s2 < n ? 'ok' : s2 === n ? 'now' : '';
    });
    const bar = document.getElementById('ldBar');
    if (bar) bar.style.width = ({ 1: '18%', 2: '55%', 3: '88%', 4: '100%' })[n] || '12%';
    if (text !== undefined) document.getElementById('loaderStatusText').innerText = text;
}
function stHideLoader() {
    const el = document.getElementById('loading');
    if (el.style.display === 'none') return;
    stLoaderStep(4);
    setTimeout(() => { el.style.display = 'none'; }, 250);
}
function stSetUpdated() {
    const d = new Date();
    document.getElementById('stUpdated').innerText = 'อัปเดต ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
async function loadData(silent = false, skipLoader = false) {
    const fullLoader = !silent && !skipLoader && !appData.length && !stSplashActive;
    if (!silent) document.getElementById('refreshIcon').classList.add('fa-spin');
    if (fullLoader) { document.getElementById('loading').style.display = 'block'; stLoaderStep(1, ''); }
    try {
        if (!stToken) throw new Error('NO_SESSION');
        const res = await stFetch(SCRIPT_URL, { method: 'POST', body: stBody({ action: 'get_machines' }), headers: { "Content-Type": "text/plain;charset=utf-8" } });
        if (fullLoader) stLoaderStep(2);
        const j = await res.json();
        if (j.code === 'AUTH') throw new Error('NO_SESSION');
        if (j.status !== 'success' || !Array.isArray(j.machines)) throw new Error(j.message || 'โหลดข้อมูลไม่สำเร็จ');
        appData = j.machines;
        if (fullLoader) stLoaderStep(3, `พบ ${appData.length} เครื่อง`);
        render();
        stSetUpdated();
        stTrackOverdue(silent);
        dbRefreshOpen();
        localStorage.setItem(CACHE_KEY, JSON.stringify(appData)); // เก็บ cache ไว้ใช้ครั้งหน้า
        // แจ้งเตือนเสียง/popup เฉพาะตอนโหลดแบบเต็ม — ถ้าหน้าโหลดยังแสดงอยู่ รอให้ปิดก่อนค่อยเด้ง
        if (!silent) { if (stSplashActive) stSplashNotice = true; else checkNotice(); }
        stSplashSetReady();
    } catch (e) {
        if (e.message === 'NO_SESSION') { stSplashSetReady(); return; }
        console.error("Load data error:", e);
        if (!silent) Swal.fire('Error', 'โหลดข้อมูลไม่สำเร็จ (แสดงข้อมูลล่าสุดที่เคยบันทึกไว้แทน)', 'error');
        if (!appData.length) render();
        stSplashSetReady();
    }
    finally {
        if (!silent) document.getElementById('refreshIcon').classList.remove('fa-spin');
        if (fullLoader) stHideLoader();
    }
}

// ===== แจ้งเตือนงาน PM (v3) — สรุปตัวเลข + เครื่องที่ต้องไปก่อน แตะเพื่อเปิดเครื่องนั้น =====
// "ไม่ต้องเตือนอีกวันนี้" เก็บเป็นวันที่ใน localStorage (เฉพาะเครื่องนี้) วันถัดไปเตือนใหม่ตามปกติ
const ST_NOTICE_MUTE_KEY = 'c2tech_service_notice_mute';
const ST_NOTICE_SHOW = 4;
function stTodayKey() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function stNoticeMuted() { try { return localStorage.getItem(ST_NOTICE_MUTE_KEY) === stTodayKey(); } catch (e) { return false; } }
function stNoticeItems() {
    const rank = x => x.hasOverdue ? 0 : 1;
    return stMachines.filter(x => x.hasOverdue || x.hasUrgent)
        .sort((p, r) => rank(p) - rank(r) || p.sortKey - r.sortKey);
}
function checkNotice() {
    const items = stNoticeItems();
    if (!items.length || stNoticeMuted()) return;
    const over = stMachines.filter(x => x.hasOverdue).length;
    const urg = stMachines.filter(x => x.hasUrgent).length;
    const d = new Date();
    document.getElementById('ntHead').classList.toggle('warn', over === 0);
    document.getElementById('ntTitle').innerText = `มีงาน PM ต้องดำเนินการ ${items.length} เครื่อง`;
    document.getElementById('ntSub').innerText = `ข้อมูลล่าสุด ${stDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} น.`;
    document.getElementById('ntOver').innerText = over;
    document.getElementById('ntUrg').innerText = urg;
    document.querySelector('.nt-s.over').disabled = !over;
    document.querySelector('.nt-s.urg').disabled = !urg;
    document.getElementById('ntList').innerHTML = items.slice(0, ST_NOTICE_SHOW).map(x => {
        const urgent = !x.hasOverdue;
        return `<button type="button" class="nt-it${urgent ? ' urgent' : ''}" data-sn="${escapeHtml(x.sn)}" onclick="stNoticeOpen(this.dataset.sn)">
            <span class="nt-b"></span>
            <span class="nt-bd"><b>${stWords(x.client)}</b><span>${escapeHtml(x.location)}${x.next ? ' · PM' + x.next.idx : ''}${x.next && x.next.photo && !urgent ? ' · มีรูปแล้ว รอปิดงาน' : ''}</span></span>
            <span class="nt-d">${escapeHtml(x.dueShort)}<small>${x.next ? stDate(x.next.planned) : ''}</small></span>
            <i class="fas fa-chevron-right"></i></button>`;
    }).join('') + (items.length > ST_NOTICE_SHOW ? `<button type="button" class="nt-more" onclick="stNoticeGo('${over ? 'overdue' : 'urgent'}')">+ อีก ${items.length - ST_NOTICE_SHOW} เครื่อง · ดูทั้งหมด</button>` : '');
    const pri = document.getElementById('ntPrimary');
    pri.innerText = over ? 'ดูรายการที่เลยกำหนด' : 'ดูรายการใกล้กำหนด';
    pri.onclick = () => stNoticeGo(over ? 'overdue' : 'urgent');
    document.getElementById('ntMute').checked = false;
    document.getElementById('stNotice').hidden = false;
    document.body.classList.add('st-lock');
    setTimeout(() => document.getElementById('ntPrimary').focus(), 50);
    playNoticeSound();
}
function stNoticeClose() {
    const ov = document.getElementById('stNotice');
    if (ov.hidden) return;
    if (document.getElementById('ntMute').checked) { try { localStorage.setItem(ST_NOTICE_MUTE_KEY, stTodayKey()); } catch (e) { } }
    ov.hidden = true;
    if (!document.getElementById('stDetailWrap').classList.contains('open')) document.body.classList.remove('st-lock');
}
function stNoticeGo(mode) {
    stNoticeClose();
    currentMode = 'all';
    smartToggle(mode);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
function stNoticeOpen(sn) {
    stNoticeClose();
    toggleDetail(sn);
    const card = document.querySelector(`#serviceList .s-card[data-sn="${CSS.escape(sn)}"]`);
    if (card && stIsWide()) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
document.getElementById('stNotice').addEventListener('click', e => { if (e.target.id === 'stNotice') stNoticeClose(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') stNoticeClose(); });
// มือถือ: ปัดหัวแจ้งเตือนลงเพื่อปิด
(function () {
    const head = document.getElementById('ntHead'), sheet = document.querySelector('#stNotice .nt-sheet');
    let y0 = null;
    head.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; }, { passive: true });
    head.addEventListener('touchmove', e => { if (y0 === null) return; const dy = Math.max(0, e.touches[0].clientY - y0); sheet.style.transform = `translateY(${dy}px)`; }, { passive: true });
    head.addEventListener('touchend', e => {
        if (y0 === null) return;
        const dy = e.changedTouches[0].clientY - y0; y0 = null; sheet.style.transform = '';
        if (dy > 90) stNoticeClose();
    });
})();

// ===== รีเฟรชเงียบอัตโนมัติทุก 15 นาที + การ์ดแจ้งเตือนเมื่อมีเครื่องเลยกำหนดเพิ่ม =====
const ST_AUTO_REFRESH_MS = 15 * 60 * 1000;
let stLastLoadAt = Date.now();
let stKnownOverdue = null; // ชุด S/N ที่เลยกำหนดจากการโหลดครั้งก่อน
function stTrackOverdue(fromSilent) {
    const now = new Set(stMachines.filter(x => x.hasOverdue).map(x => x.sn));
    if (fromSilent && stKnownOverdue) {
        const added = stMachines.filter(x => now.has(x.sn) && !stKnownOverdue.has(x.sn));
        if (added.length && !stNoticeMuted()) stShowToast(added);
    }
    stKnownOverdue = now;
    stLastLoadAt = Date.now();
}
function stShowToast(added) {
    const t = document.getElementById('stToast');
    const x = added[0];
    t.innerHTML = `<span class="nt-ic"><i class="fas fa-clock"></i></span><span><b>มีเครื่องเลยกำหนดเพิ่ม ${added.length} เครื่อง</b><span>${escapeHtml(x.client)}${x.next ? ' · PM' + x.next.idx : ''} · แตะเพื่อดู</span></span><i class="fas fa-xmark nt-tx" aria-label="ปิด"></i>`;
    t.hidden = false;
    t.onclick = e => {
        t.hidden = true;
        if (e.target.classList.contains('nt-tx')) return;
        if (added.length === 1) toggleDetail(x.sn); else stNoticeGo('overdue');
    };
    playNoticeSound();
    clearTimeout(t._h);
    t._h = setTimeout(() => { t.hidden = true; }, 15000);
}
setInterval(() => {
    if (document.visibilityState === 'visible' && !stSplashActive && Date.now() - stLastLoadAt >= ST_AUTO_REFRESH_MS) loadData(true);
}, 60 * 1000);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !stSplashActive && Date.now() - stLastLoadAt >= ST_AUTO_REFRESH_MS) loadData(true);
});

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
// แบ่งข้อความเป็นคำตามช่องว่าง ให้เบราว์เซอร์ตัดบรรทัดที่ช่องว่างก่อน (ไม่ตัดกลางคำทับศัพท์ เช่น "อินเตอร์เนชั่นแนล")
// คำที่ยาวเกินบรรทัดจริงๆ ยังตัดภายในคำได้ตามปกติ (ดู .w ใน style.css)
function stWords(t) {
    return String(t == null ? '' : t).split(/(\s+)/).map(p => /^\s+$/.test(p) ? ' ' : p ? `<span class="w">${escapeHtml(p)}</span>` : '').join('');
}

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

// =========================================================================================
// v3 UI: คำนวณสถานะของแต่ละเครื่องครั้งเดียว แล้วใช้ทั้งรายการ (เรียงตามความเร่งด่วน) และแผงรายละเอียด
// กฎเดิมยังเหมือนเดิมทั้งหมด: ต้องปิด PM รอบก่อนก่อน / ต้องแนบรูปก่อนปิดงาน / ต้องมี GPS (handleCheck)
// =========================================================================================
let stMachines = [];
let stSelected = null; // S/N ของเครื่องที่เปิดดูอยู่
const ST_TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function stDate(d) { return d ? d.getDate() + ' ' + ST_TH_MONTH[d.getMonth()] + ' ' + String(d.getFullYear() + 543).slice(-2) : '-'; }
function stDay0(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function stDiffDays(d) { return Math.round((stDay0(d) - stDay0(new Date())) / 86400000); }
function stIsWide() { return window.innerWidth >= 1100; }

function stCompute(m) {
    const sn = (m["S/N Analyzer"] || m["SN"] || m["S/N"] || "").toString().trim();
    if (!sn || (m["Status"] || "").toUpperCase() === "TEST") return null;
    const now = new Date();
    const limit = new Date(); limit.setDate(now.getDate() + 7);
    const statusYearVal = (m["Status_Year"] || m["status_year"] || "").toString().trim();
    const x = {
        sn: sn, raw: m,
        client: m["ชื่อลูกค้า"] || m["Client name"] || "ไม่ระบุชื่อ",
        location: m["จังหวัด"] || m["Location"] || "ไม่ระบุจังหวัด",
        model: m["Model"] || "-", mode: m["Mode"] || "-", type: m["Type"] || "-",
        renew: statusYearVal.includes("ต่อรายปี"),
        pm3Done: !!m["PM3_Status"],
        steps: []
    };
    let prevStepDone = true;
    [1, 2, 3].forEach(idx => {
        const plannedDateVal = m[`PM${idx}_Date`];
        if (!plannedDateVal) return;
        const pDate = new Date(plannedDateVal);
        const doneVal = m[`PM${idx}_Status`];
        const isDone = !!doneVal;
        const base = isDone ? 'done' : (pDate < now ? 'overdue' : (pDate <= limit ? 'urgent' : 'plan'));
        const isLocked = !isDone && !prevStepDone;
        const photo = m[`PM${idx}_Photo`];
        x.steps.push({
            idx: idx, planned: pDate, done: isDone, doneDate: isDone ? new Date(doneVal) : null, base: base,
            locked: isLocked, needsPhoto: !isDone && !isLocked && !photo, photo: photo,
            gps: m[`PM${idx}_GPS`], tech: m[`PM${idx}_Tech`]
        });
        prevStepDone = isDone;
    });
    x.hasOverdue = x.steps.some(st => st.base === 'overdue');
    x.hasUrgent = x.steps.some(st => st.base === 'urgent');
    x.allDone = x.pm3Done || (x.steps.length > 0 && x.steps.every(st => st.done));
    x.status = x.hasOverdue ? 'overdue' : x.hasUrgent ? 'urgent' : x.allDone ? 'done' : 'plan';
    x.next = x.steps.find(st => !st.done) || null;
    const lastDone = x.steps.filter(st => st.done).pop();
    if (x.next) {
        const n = stDiffDays(x.next.planned);
        const nm = 'PM' + x.next.idx;
        x.dueLabel = n < 0 ? `${nm} เลย ${-n} วัน` : n === 0 ? `${nm} วันนี้` : `${nm} อีก ${n} วัน`;
        x.dueShort = n < 0 ? `เลย ${-n} วัน` : n === 0 ? 'วันนี้' : `อีก ${n} วัน`;
        x.dueSub = (n <= 0 && x.next.photo) ? 'มีรูปแล้ว · รอปิดงาน' : `แผน ${stDate(x.next.planned)}`;
        x.sortKey = x.next.planned.getTime();
    } else if (x.steps.length) {
        x.dueLabel = 'ครบ 3 รอบ'; x.dueShort = 'ครบรอบ';
        x.dueSub = lastDone && lastDone.doneDate ? `ล่าสุด ${stDate(lastDone.doneDate)}` : '';
        x.sortKey = -(lastDone && lastDone.doneDate ? lastDone.doneDate.getTime() : 0);
    } else {
        x.dueLabel = 'ยังไม่มีแผน PM'; x.dueShort = '-'; x.dueSub = ''; x.sortKey = Infinity;
    }
    x.search = [x.client, x.location, sn, x.model, x.mode, x.type].join(' ').toLowerCase();
    return x;
}

function render() {
    const isHideComplete = document.getElementById('hideCompleteSwitch').checked;
    // ซ่อนเครื่องที่ยังไม่มีวันนัด PM เลยสักรอบ (เช่น เครื่องใน stock ยังไม่ได้ติดตั้ง/ยังไม่เริ่มสัญญา)
    stMachines = appData.map(stCompute).filter(Boolean).filter(x => x.steps.length > 0).filter(x => !(isHideComplete && x.pm3Done));
    runFilters();
    renderDetail();
}

function stCardHtml(x) {
    const segs = [1, 2, 3].map(i => {
        const st = x.steps.find(s2 => s2.idx === i);
        const cls = !st ? 'none' : st.done ? 'done' : st.base;
        return `<div class="sc-seg ${cls}"><i></i><span>PM${i}${st && st.done ? ' ✓' : ''}</span></div>`;
    }).join('');
    const tags = [x.model, x.type, x.mode].filter(v => v && v !== '-').map(v => `<span class="sc-tag">${escapeHtml(v)}</span>`).join('') +
        (x.renew ? '<span class="sc-tag star"><i class="fas fa-star"></i> ต่อรายปี</span>' : '');
    const cardCls = x.status === 'overdue' ? 'card-overdue' : x.status === 'urgent' ? 'card-urgent' : x.status === 'done' ? 'card-done' : '';
    return `<button type="button" class="s-card ${cardCls}${x.sn === stSelected ? ' sel' : ''}" data-sn="${escapeHtml(x.sn)}" onclick="toggleDetail(this.dataset.sn)">
        <div class="sc-name"><b>${stWords(x.client)}</b><span>${escapeHtml(x.location)} · S/N ${escapeHtml(x.sn)}${x.renew ? ' · ★' : ''}</span><div class="sc-tags">${tags}</div></div>
        <div class="sc-trk">${segs}</div>
        <div class="sc-due ${x.status}"><b>${escapeHtml(stIsWide() || window.innerWidth > 860 ? x.dueLabel : x.dueShort)}</b><span>${escapeHtml(x.dueSub)}${!(stIsWide() || window.innerWidth > 860) && x.next ? ' · PM' + x.next.idx : ''}</span></div>
    </button>`;
}

function toggleDetail(sn) {
    stSelected = sn;
    document.querySelectorAll('#serviceList .s-card').forEach(c => c.classList.toggle('sel', c.dataset.sn === sn));
    renderDetail(true);
    if (!stIsWide()) {
        const wrap = document.getElementById('stDetailWrap');
        if (!wrap.classList.contains('open')) {
            wrap.classList.add('open');
            document.body.classList.add('st-lock');
            try { history.pushState({ stDetail: true }, ''); } catch (e) { }
        }
    }
    // โหลดประวัติอะไหล่แบบ lazy — เฉพาะตอนเปิดดูเครื่องนั้นครั้งแรก (เหมือนเดิม)
    if (!partsCache[sn]) loadPartsForMachine(sn);
}
function stCloseDetail(fromPop) {
    const wrap = document.getElementById('stDetailWrap');
    if (!wrap.classList.contains('open')) return;
    wrap.classList.remove('open');
    document.body.classList.remove('st-lock');
    if (!fromPop) { try { if (history.state && history.state.stDetail) history.back(); } catch (e) { } }
}
window.addEventListener('popstate', () => stCloseDetail(true));
window.addEventListener('resize', () => { if (stIsWide()) { document.body.classList.remove('st-lock'); document.getElementById('stDetailWrap').classList.remove('open'); } });

function stNeedPhoto(ev) {
    ev.preventDefault();
    Toast.fire({ icon: 'info', title: 'แนบรูปหน้างานก่อน จึงจะปิดงานได้' });
}

function renderDetail(resetScroll) {
    const box = document.getElementById('stDetail');
    if (!box) return;
    let x = stMachines.find(m2 => m2.sn === stSelected);
    if (!x && stIsWide()) {
        const firstCard = document.querySelector('#serviceList .s-card');
        if (firstCard) { stSelected = firstCard.dataset.sn; firstCard.classList.add('sel'); x = stMachines.find(m2 => m2.sn === stSelected); }
    }
    if (!x) {
        box.innerHTML = '<div class="st-detail-empty"><i class="fas fa-industry"></i><b>เลือกเครื่องเพื่อดูรายละเอียด</b><span>บันทึก PM แนบรูป อะไหล่ และหมายเหตุได้ที่นี่</span></div>';
        return;
    }
    // เก็บค่าที่กำลังพิมพ์/ตำแหน่งสกรอลไว้ ก่อนสร้างแผงใหม่ (render ถูกเรียกซ้ำหลังบันทึกทุกครั้ง)
    const oldBody = box.querySelector('.dt-body');
    const keepScroll = !resetScroll && oldBody ? oldBody.scrollTop : 0;
    const oldNote = document.getElementById(`n-${x.sn}`);
    const noteDraft = !resetScroll && oldNote ? oldNote.value : null;
    const oldRenew = document.getElementById(`renew-${x.sn}`);
    const renewDraft = !resetScroll && oldRenew ? oldRenew.value : '';
    const sn = x.sn;
    const snJs = escapeHtml(sn);
    const m = x.raw;

    const canEdit = stCanEdit();
    const stepsHtml = x.steps.map(st => {
        const key = 'PM' + st.idx;
        let pill, cls;
        if (st.done) { pill = '<span class="dt-pill done">เสร็จแล้ว</span>'; cls = 'done'; }
        else if (st.locked) { pill = `<span class="dt-pill locked"><i class="fas fa-lock"></i> รอ PM${st.idx - 1}</span>`; cls = 'locked'; }
        else {
            const n = stDiffDays(st.planned);
            const txt = n < 0 ? `เลย ${-n} วัน` : n === 0 ? 'ครบกำหนดวันนี้' : `อีก ${n} วัน`;
            pill = `<span class="dt-pill ${st.base}">${txt}</span>`; cls = st.base;
        }
        const links = (st.photo ? `<a href="${escapeHtml(st.photo)}" target="_blank" rel="noopener"><i class="fas fa-image"></i> ดูรูป</a>` : '') +
            (st.gps && st.gps !== 'No GPS' ? `<a href="${escapeHtml(st.gps)}" target="_blank" rel="noopener"><i class="fas fa-location-dot"></i> GPS</a>` : '');
        const parts = `<div class="parts-box">
                <div class="parts-label"><i class="fas fa-toolbox"></i> อะไหล่ที่เปลี่ยน (รอบนี้)</div>
                <div class="pt-list" id="parts-chips-${sn}-${key}">${buildPartsChipsHtml(sn, key)}</div>
                <div class="empty-note" id="parts-empty-${sn}-${key}" style="${(partsCache[sn] && partsCache[sn][key] && partsCache[sn][key].length) ? 'display:none;' : ''}">${partsCache[sn] ? 'ยังไม่มีการบันทึกอะไหล่ในรอบนี้' : 'กำลังโหลดรายการอะไหล่...'}</div>
                ${canEdit ? `<button type="button" class="add-part-btn" onclick="openAddPartForm('${snJs}', '${key}')"><i class="fas fa-plus"></i> เพิ่มอะไหล่</button>` : ''}
            </div>`;
        let body = '';
        if (st.done) {
            body = `<div class="dt-meta"><span>เข้าจริง ${stDate(st.doneDate)}</span>${st.tech ? `<span><i class="fas fa-user"></i> ${escapeHtml(st.tech)}</span>` : ''}${links}</div>
                ${parts}
                ${canEdit ? `<button type="button" class="btn-slip" onclick="printServiceSlip('${snJs}', ${st.idx})"><i class="fab fa-line"></i> สร้างรูปยืนยันงานส่ง LINE</button>` : ''}`;
        } else if (st.locked) {
            body = `<div class="dt-meta"><span>แผน ${stDate(st.planned)}</span><span>ปิดงาน PM${st.idx - 1} ให้เสร็จก่อน</span></div>`;
        } else if (!canEdit) {
            body = `<div class="dt-meta"><span>แผน ${stDate(st.planned)}</span>${links}</div>
                <div class="dt-ro-step"><i class="fas fa-hourglass-half"></i> ยังไม่ปิดงาน${st.photo ? ' · แนบรูปแล้ว' : ''}</div>
                ${parts}`;
        } else {
            const closeDisabled = st.needsPhoto;
            body = `<div class="dt-meta"><span>แผน ${stDate(st.planned)}</span>${links}</div>
                <div class="dt-box">
                    <div class="dt-req ${st.photo ? 'ok' : 'todo'}"><i>${st.photo ? '✓' : '1'}</i>แนบรูปหน้างาน<b>${st.photo ? 'แนบแล้ว' : 'ยังไม่มี'}</b></div>
                    <div class="dt-req"><i>2</i>บันทึกอะไหล่ที่เปลี่ยน (ถ้ามี)</div>
                    <div class="dt-req"><i>3</i>ปิดงาน (ยืนยันตำแหน่ง GPS)</div>
                    <button type="button" class="dt-btn${st.needsPhoto ? '' : ' ghost'}" onclick="capturePhotoForStep('${snJs}', '${key}')"><i class="fas fa-camera"></i> ${st.needsPhoto ? 'ถ่ายรูปหน้างาน' : 'ถ่ายรูปใหม่'}</button>
                    <input type="file" id="img-${sn}-${key}" accept="image/*" capture="environment" style="display:none" onchange="uploadPhotoByStep('${snJs}', '${key}', this)">
                    ${parts}
                    <button type="button" class="dt-btn dt-close${closeDisabled ? ' disabled' : ''}" onclick="${closeDisabled ? 'stNeedPhoto(event)' : `stOpenClose('${snJs}','${key}')`}">
                        <i class="fas fa-check"></i> ปิดงาน PM${st.idx}
                    </button>
                </div>`;
        }
        const kebab = st.done && isAdmin ? `<button type="button" class="dt-kebab" aria-label="เมนู Admin ของ PM${st.idx}" onclick="stStepMenu(event,'${snJs}',${st.idx})"><i class="fas fa-ellipsis"></i></button>` : '';
        return `<div class="dt-step ${cls}"><span class="dt-dot">${st.done ? '✓' : st.idx}</span><h3>PM รอบที่ ${st.idx} ${pill}${kebab}</h3>${body}</div>`;
    }).join('') || '<p class="dt-meta">ยังไม่มีแผน PM ของเครื่องนี้</p>';

    const renewUI = isAdmin ? `
        <div class="dt-section">
            <h4><i class="fas fa-rotate"></i> ต่ออายุ Service รายปี</h4>
            <p>เลือกวันเริ่มสัญญารอบใหม่ ระบบแสดงวันนัด PM 1–3 ให้ดูก่อนยืนยัน (ทุก 4 เดือน)</p>
            <div class="dt-renew">
                <input type="date" id="renew-${sn}" aria-label="วันที่เริ่มสัญญาใหม่" value="${escapeHtml(renewDraft)}" oninput="stRenewPreview('${snJs}')">
                <button type="button" class="btn-save" onclick="renewService('${snJs}')"><i class="fas fa-check"></i> เริ่มรอบใหม่</button>
            </div>
            <div class="rn-prev" id="renew-prev-${sn}"></div>
        </div>` : '';

    box.innerHTML = `
        <div class="dt-head">
            <button type="button" class="dt-back" onclick="stCloseDetail()"><i class="fas fa-chevron-left"></i> รายการเครื่อง</button>
            ${x.renew ? '<span class="dt-badge"><i class="fas fa-star"></i> ต่อรายปี</span>' : ''}
            <h2>${stWords(x.client)}</h2>
            <div class="dt-sub"><i class="fas fa-location-dot"></i> ${escapeHtml(x.location)} · S/N ${escapeHtml(sn)}</div>
            <div class="dt-kv"><div><small>Model</small><b>${escapeHtml(x.model)}</b></div><div><small>Type</small><b>${escapeHtml(x.type)}</b></div><div><small>Mode</small><b>${escapeHtml(x.mode)}</b></div></div>
        </div>
        <div class="dt-body">
            ${canEdit ? '' : '<div class="dt-ro"><i class="fas fa-eye"></i> โหมดดูอย่างเดียว (Guest)</div>'}
            <div class="dt-tl">${stepsHtml}</div>
            ${renewUI}
            ${canEdit ? `<div class="dt-section">
                <h4><i class="fas fa-note-sticky"></i> หมายเหตุ</h4>
                <textarea id="n-${sn}" rows="2" placeholder="เพิ่มหมายเหตุ..."></textarea>
                <div class="action-group"><button class="btn-save" onclick="updateNote('${snJs}', this)"><i class="fas fa-save"></i> บันทึกหมายเหตุ</button></div>
            </div>` : `<div class="dt-section">
                <h4><i class="fas fa-note-sticky"></i> หมายเหตุ</h4>
                <p class="dt-note-ro">${m["Admin_Note"] ? escapeHtml(m["Admin_Note"]) : '<span>ไม่มีหมายเหตุ</span>'}</p>
            </div>`}
            <details class="dt-section dt-acc" ${stOpenSec.has('hist:' + sn) ? 'open' : ''} ontoggle="stSecToggle(this,'hist','${snJs}')">
                <summary><i class="fas fa-clock-rotate-left"></i> ประวัติรอบสัญญาก่อน</summary><div id="hist-${sn}">${stHistCache[sn] ? stHistHtml(stHistCache[sn]) : ''}</div></details>
            ${isAdmin ? `<details class="dt-section dt-acc" ${stOpenSec.has('elog:' + sn) ? 'open' : ''} ontoggle="stSecToggle(this,'elog','${snJs}')">
                <summary><i class="fas fa-list-check"></i> ประวัติการแก้ไข <em>Admin</em></summary><div id="elog-${sn}">${stEditLogCache[sn] ? stEditLogHtml(stEditLogCache[sn]) : ''}</div></details>` : ''}
        </div>`;
    const noteEl = document.getElementById(`n-${sn}`);
    if (noteEl) noteEl.value = noteDraft !== null ? noteDraft : (m["Admin_Note"] || "");
    if (renewDraft) stRenewPreview(sn);
    box.querySelector('.dt-body').scrollTop = keepScroll;
}

// --- ระบบบันทึกอะไหล่ที่เปลี่ยนระหว่างเข้า PM ---


async function loadPartsForMachine(sn) {
    try {
        const res = await stFetch(SCRIPT_URL, {
            method: 'POST',
            body: stBody({ action: 'get_pm_parts', sn: sn }),
            headers: { "Content-Type": "text/plain;charset=utf-8" }
        });
        const data = await res.json();
        if (data.status === 'success') {
            partsCache[sn] = data.parts || { PM1: [], PM2: [], PM3: [] };
            renderPartsChips(sn);
        }
    } catch (e) {
        console.error("Load PM parts error:", e);
        // ไม่ต้องแจ้งเตือนผู้ใช้ — ถือเป็น enhancement เสริม ไม่ให้บล็อกการใช้งานหลักถ้าดึงไม่สำเร็จ
    }
}

// อัปเดตเฉพาะกล่องรายการอะไหล่ในการ์ดที่เปิดอยู่ (ไม่เรียก render() เต็มรูปแบบ กันปัญหาการ์ดพับ/เลื่อนจอกลับ)
function renderPartsChips(sn) {
    [1, 2, 3].forEach(idx => {
        const stepKey = 'PM' + idx;
        const chipsEl = document.getElementById(`parts-chips-${sn}-${stepKey}`);
        const emptyEl = document.getElementById(`parts-empty-${sn}-${stepKey}`);
        if (!chipsEl) return; // รอบนี้อาจถูกล็อกอยู่ จึงไม่มีกล่องอะไหล่แสดง
        chipsEl.innerHTML = buildPartsChipsHtml(sn, stepKey);
        const hasParts = (partsCache[sn] && partsCache[sn][stepKey] && partsCache[sn][stepKey].length);
        if (emptyEl) { emptyEl.style.display = hasParts ? 'none' : ''; emptyEl.innerText = 'ยังไม่มีการบันทึกอะไหล่ในรอบนี้'; }
    });
}


// ลบรายการอะไหล่ (สำหรับ Admin แก้ไขข้อมูลที่บันทึกผิดเท่านั้น)

// --- ใบยืนยันงานให้ลูกค้า: สร้างเป็นรูปภาพสำหรับส่ง LINE (เดิมเป็นเอกสารพิมพ์ เปลี่ยนเพราะช่างหน้างานไม่สะดวกปริ้น) ---
// ใช้เทคนิคเดียวกับปุ่ม "สร้างรูปสำหรับ LINE" ในหน้ารายงานสรุปของ Admin (renderLineImageReport ด้านล่าง)
async function printServiceSlip(sn, idx) {
    const m = appData.find(x => ((x["S/N Analyzer"] || x["SN"] || x["S/N"] || "").toString().trim()) === sn);
    if (!m) { Swal.fire('Error', 'ไม่พบข้อมูลเครื่องนี้', 'error'); return; }

    Swal.fire({ title: 'กำลังสร้างรูปภาพ...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    // ให้แน่ใจว่ามีข้อมูลอะไหล่ก่อนสร้างรูป (เผื่อผู้ใช้ยังไม่เคยกางรายละเอียดเครื่องนี้มาก่อน)
    if (!partsCache[sn]) {
        await loadPartsForMachine(sn);
    }

    const client = m["ชื่อลูกค้า"] || m["Client name"] || "ไม่ระบุชื่อ";
    const location = m["จังหวัด"] || m["Location"] || "ไม่ระบุจังหวัด";
    const stepKey = 'PM' + idx;
    const actualDateVal = m[`${stepKey}_Status`];
    const actualDate = actualDateVal ? formatThaiDate(actualDateVal) : '-';
    const techVal = m[`${stepKey}_Tech`] || '-';
    const gpsVal = m[`${stepKey}_GPS`];
    const photoUrl = m[`${stepKey}_Photo`];
    const parts = (partsCache[sn] && partsCache[sn][stepKey]) || [];

    const partsTxt = parts.length ? parts.map(p => `${escapeHtml(p.name)} ×${escapeHtml(p.qty || 1)}`).join(' · ') : 'ไม่มีการเปลี่ยนอะไหล่ในรอบนี้';
    const doneD = dbParse(actualDateVal);
    const doneTxt = doneD ? `${stDate(doneD)} ${String(doneD.getHours()).padStart(2, '0')}:${String(doneD.getMinutes()).padStart(2, '0')} น.` : actualDate;
    const nextPlan = idx < 3 ? dbParse(m[`PM${idx + 1}_Date`]) : null;
    const model = m["Model"] || '';

    // ลองโหลดรูปหน้างานก่อน (ถ้าโหลดไม่ได้ เช่น ติดสิทธิ์แชร์ไฟล์ จะขึ้นข้อความแทน ไม่ทำให้ทั้งใบพัง)
    let photoHtml = '';
    if (photoUrl) {
        const imgOk = await new Promise((resolve) => {
            const testImg = new Image();
            testImg.crossOrigin = 'anonymous';
            testImg.onload = () => resolve(true);
            testImg.onerror = () => resolve(false);
            testImg.src = toDriveImageUrl(photoUrl);
            setTimeout(() => resolve(false), 6000);
        });
        photoHtml = imgOk
            ? `<div class="sl-photo"><img crossorigin="anonymous" src="${escapeHtml(toDriveImageUrl(photoUrl))}" alt=""></div>`
            : `<div class="sl-photo none"><i class="fas fa-image"></i> มีรูปหน้างานแนบในระบบ</div>`;
    }
    const row = (k, v) => `<div class="sl-kv"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`;

    const card = document.createElement('div');
    card.className = 'sl-wrap';
    card.innerHTML = `<div class="sl-card" id="slipCard">
        <div class="sl-h"><img src="icons/icon-192.png" alt=""><div><b>ใบยืนยันการเข้า PM</b><small>C2TECH · บริษัท ซีทูเทค จำกัด</small></div></div>
        <div class="sl-ok"><i class="fas fa-circle-check"></i> PM รอบที่ ${idx} เสร็จเรียบร้อย</div>
        <div class="sl-b">
            ${row('ลูกค้า', client)}${row('สถานที่', location)}${row('เครื่อง', (model ? model + ' · ' : '') + sn)}${row('วันที่เข้า', doneTxt)}${row('ช่างผู้ดูแล', techVal)}
            ${row('ตำแหน่ง', (gpsVal && gpsVal !== 'No GPS') ? 'บันทึก GPS ที่หน้างานแล้ว' : '-')}
            ${photoHtml}
            <div class="sl-sec"><b>อะไหล่ที่เปลี่ยน</b><span>${partsTxt}</span></div>
            ${nextPlan ? `<div class="sl-sec"><b>นัดครั้งถัดไป</b><span>PM รอบที่ ${idx + 1} · ประมาณ ${stDate(nextPlan)}</span></div>` : '<div class="sl-sec"><b>สถานะสัญญา</b><span>ครบ 3 รอบของสัญญานี้แล้ว</span></div>'}
        </div>
        <div class="sl-f">สอบถาม 063-929-1999 · www.c2tech.app</div></div>`;
    document.body.appendChild(card);

    // ถ้ารูปทำให้ส่งออกไม่ได้ (เช่น ติดสิทธิ์ข้ามโดเมน) สร้างใหม่โดยตัดรูปออก
    const slipEl = card.querySelector('#slipCard'), slipOpt = { scale: 2, useCORS: true, backgroundColor: null };
    const snapSlip = async () => {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        const c = await html2canvas(slipEl, slipOpt);
        try { c.toDataURL('image/png'); return c; } catch (e) { slipEl.querySelectorAll('img').forEach(i => i.remove()); return html2canvas(slipEl, slipOpt); }
    };
    snapSlip().then(canvas => {
        card.remove();

        canvas.toBlob((blob) => {
            const fileName = `service_slip_${sn}_PM${idx}.png`;
            const imgUrl = canvas.toDataURL('image/png');
            const file = blob ? new File([blob], fileName, { type: 'image/png' }) : null;
            const canShareFile = !!(navigator.canShare && file && navigator.canShare({ files: [file] }));

            // แสดงตัวอย่างรูปให้ดูก่อนเสมอ — ไม่แชร์ทันทีโดยไม่ให้ดูก่อน
            // ถ้าเครื่องรองรับการแชร์ไฟล์ (Android/iOS รุ่นใหม่) จะมีปุ่ม "แชร์ไป LINE" เพิ่มมาให้เลือก
            Swal.fire({
                title: 'รูปยืนยันงานสำหรับส่ง LINE',
                html: `<img src="${imgUrl}" style="width:100%; border-radius:12px; box-shadow:0 4px 14px rgba(0,0,0,0.15);">`,
                confirmButtonText: canShareFile ? '<i class="fab fa-line"></i> แชร์ไป LINE' : '<i class="fas fa-download"></i> ดาวน์โหลดรูป',
                confirmButtonColor: '#06C755',
                showDenyButton: canShareFile,
                denyButtonText: '<i class="fas fa-download"></i> ดาวน์โหลด',
                denyButtonColor: '#22392b',
                showCancelButton: true,
                cancelButtonText: 'ปิด'
            }).then(async (result) => {
                if (result.isConfirmed && canShareFile) {
                    // ผู้ใช้ดูตัวอย่างแล้วกด "แชร์ไป LINE" — ค่อยเปิด share sheet ตอนนี้ (ต้องกดปุ่มเองเสมอ ตาม policy ของเบราว์เซอร์)
                    try {
                        await navigator.share({
                            files: [file],
                            title: 'ใบยืนยันการเข้าบริการ',
                            text: `ใบยืนยันการเข้าบริการ PM รอบที่ ${idx} — ${client}`
                        });
                    } catch (shareErr) {
                        // ผู้ใช้กดยกเลิกใน share sheet เอง — ไม่ต้องแจ้ง error
                    }
                } else if ((result.isConfirmed && !canShareFile) || result.isDenied) {
                    const link = document.createElement('a');
                    link.href = imgUrl;
                    link.download = fileName;
                    link.click();
                }
            });
        }, 'image/png');
    }).catch(err => {
        card.remove();
        Swal.fire('Error', 'สร้างรูปภาพไม่สำเร็จ: ' + err.message, 'error');
    });
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

// ฟังก์ชันสำหรับเริ่มรอบบริการใหม่ (Renew)
async function renewService(sn) {
    const dateInput = document.getElementById(`renew-${sn}`);
    const startDate = dateInput.value;

    if (!startDate) {
        Swal.fire('แจ้งเตือน', 'กรุณาเลือกวันที่เริ่มรอบใหม่', 'warning');
        return;
    }

    const rd = stRenewDates(startDate) || [];
    const confirm = await Swal.fire({
        title: 'ยืนยันเริ่มสัญญารอบใหม่?',
        html: `<div class="sw-form"><b class="sw-name">${stWords((stFindMachine(sn) || {}).client || sn)}</b><span class="sw-muted">เริ่มสัญญา ${stDate(new Date(startDate + 'T00:00:00'))}</span>
            <div class="rn-tl">${rd.map((x, i) => `<div><i>${i + 1}</i><span>PM รอบที่ ${i + 1}</span><b>${i ? '~' : ''}${stDate(x)}</b></div>`).join('')}</div>
            <div class="ss-warn"><i class="fas fa-circle-info"></i> ข้อมูล PM รอบปัจจุบันย้ายไปเก็บใน "ประวัติรอบสัญญาก่อน" ไม่หายไปไหน</div></div>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#22392b',
        confirmButtonText: 'ตกลง',
        cancelButtonText: 'ยกเลิก'
    });

    if (confirm.isConfirmed) {
        Swal.fire({ title: 'กำลังบันทึก...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        try {
            const response = await stFetch(SCRIPT_URL, {
                method: 'POST',
                body: stBody({
                    sn: sn,
                    action: 'renew_service',
                    startDate: startDate
                }),
                headers: { "Content-Type": "text/plain;charset=utf-8" }
            });
            const result = await response.json();

            if (result.status !== "success") {
                throw new Error(result.message || "ไม่สามารถต่ออายุสัญญาได้");
            }

            Swal.close();
            stDropCaches(sn);
            Toast.fire({ icon: 'success', title: 'เริ่มสัญญารอบใหม่แล้ว' });
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
        const response = await stFetch(SCRIPT_URL, {
            method: 'POST',
            body: stBody({ sn: sn, action: 'update_note', note: val }),
            headers: { "Content-Type": "text/plain;charset=utf-8" }
        });
        const result = await response.json();

        if (result.status !== "success") {
            throw new Error(result.message || "บันทึกไม่สำเร็จ");
        }

        // แจ้งเป็นแถบเล็กมุมจอ ไม่บังหน้าจอ + อัปเดตข้อมูลในเครื่องทันที
        const mm = appData.find(r => String(r["S/N Analyzer"] || r["SN"] || r["S/N"] || '').trim() === sn);
        if (mm) mm["Admin_Note"] = val;
        Toast.fire({ icon: 'success', title: 'บันทึกหมายเหตุแล้ว' });

    } catch (e) {
        console.error("Update note error:", e);
        Swal.fire({
            icon: 'error',
            title: 'เกิดข้อผิดพลาด',
            text: e.message || 'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง',
            confirmButtonColor: '#c8302f'
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
    const main = document.getElementById('serviceList');
    const q = document.getElementById('mainSearch').value.trim().toLowerCase();
    const isShowRenewOnly = document.getElementById('showRenewOnlySwitch').checked;
    const typeFilterVal = document.getElementById('typeFilter').value;
    const modeFilterVal = document.getElementById('modeFilter').value;

    // ตัวเลขสรุปนับจากทุกเครื่อง (เหมือนเดิม: เครื่องที่มี PM เลยกำหนด/ใกล้กำหนดอย่างน้อย 1 รอบ)
    document.getElementById('cnt-overdue').innerText = stMachines.filter(x => x.hasOverdue).length;
    document.getElementById('cnt-urgent').innerText = stMachines.filter(x => x.hasUrgent).length;
    document.getElementById('cnt-plan').innerText = stMachines.filter(x => x.status === 'plan').length;
    document.getElementById('cnt-done').innerText = stMachines.filter(x => x.status === 'done').length;
    document.getElementById('cnt-all').innerText = stMachines.length;

    const list = stMachines.filter(x => {
        const matchMode = currentMode === 'all' || (currentMode === 'overdue' && x.hasOverdue) || (currentMode === 'urgent' && x.hasUrgent) ||
            (currentMode === 'plan' && x.status === 'plan') || (currentMode === 'done' && x.status === 'done');
        return matchMode && (!q || x.search.includes(q)) && (!isShowRenewOnly || x.renew) &&
            (typeFilterVal === 'all' || x.type === typeFilterVal) && (modeFilterVal === 'all' || x.mode === modeFilterVal);
    });

    // สถานะชิป + ปุ่มล้าง
    document.querySelectorAll('#stChips .st-chip[data-f]').forEach(c => {
        const f = c.dataset.f;
        const on = f === 'renew' ? isShowRenewOnly : f === 'hidedone' ? document.getElementById('hideCompleteSwitch').checked :
            f.startsWith('type:') ? typeFilterVal === f.slice(5) : f.startsWith('mode:') ? modeFilterVal === f.slice(5) : false;
        c.classList.toggle('on', on);
    });
    const anyFilter = q || isShowRenewOnly || typeFilterVal !== 'all' || modeFilterVal !== 'all' || currentMode !== 'all' || document.getElementById('hideCompleteSwitch').checked;
    document.getElementById('stClear').classList.toggle('show', !!anyFilter);

    if (!appData.length) {
        main.innerHTML = '<div class="st-skel"></div><div class="st-skel"></div><div class="st-skel"></div>';
        return;
    }
    if (!list.length) {
        main.innerHTML = `<div class="st-empty"><i class="fas fa-magnifying-glass"></i><b>ไม่พบเครื่องที่ตรงกับตัวกรอง</b>${anyFilter ? 'ลองล้างตัวกรองหรือเปลี่ยนคำค้นหา' : ''}</div>`;
        return;
    }
    const groups = [['overdue', 'เลยกำหนด'], ['urgent', 'ใกล้กำหนด 7 วัน'], ['plan', 'ตามแผน'], ['done', 'ครบ 3 รอบแล้ว']];
    let html = '';
    groups.forEach(([key, label]) => {
        const items = list.filter(x => x.status === key).sort((p, r) => p.sortKey - r.sortKey);
        if (!items.length) return;
        html += `<div class="st-grp ${key}">${label} · ${items.length}</div>` + items.map(stCardHtml).join('');
    });
    const scrollY = window.scrollY;
    main.innerHTML = html;
    window.scrollTo(0, scrollY);
}

function smartToggle(m) {
    currentMode = (currentMode === m && m !== 'all') ? 'all' : m;
    document.querySelectorAll('.f-card').forEach(c => c.classList.remove('active-all', 'active-overdue', 'active-urgent', 'active-plan', 'active-done'));
    document.getElementById(`f-${currentMode}`).classList.add(`active-${currentMode}`);
    runFilters();
}
// ชิปตัวกรอง — เก็บค่าจริงไว้ใน select/checkbox ที่ซ่อนอยู่ (ชื่อเดิม) ให้โค้ดส่วนอื่นอ่านได้เหมือนเดิม
function stToggleChip(selectId, value) {
    const sel = document.getElementById(selectId);
    sel.value = sel.value === value ? 'all' : value;
    runFilters();
}
function stToggleSwitch(id) {
    const el = document.getElementById(id);
    el.checked = !el.checked;
    if (id === 'hideCompleteSwitch') render(); else runFilters();
}

/* =========================================================================================
   ระบบ User Login / โปรไฟล์ผู้ใช้ (คนละระบบกับ Admin)
========================================================================================= */

function stInitial(name) { return String(name || '?').trim().charAt(0) || '?'; }
function stAvatarHtml(u, cls) {
    const img = u && u.photo ? toDriveImageUrl(u.photo) : '';
    return img ? `<img class="${cls || 'st-av'}" src="${escapeHtml(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        : `<span class="${cls || 'st-av'}">${escapeHtml(stInitial(u && u.name))}</span>`;
}
function stRoleBadge(role) {
    const r = ST_ROLE_LABEL[role] ? role : 'staff';
    return `<span class="st-rb r-${r}">${ST_ROLE_LABEL[r]}</span>`;
}

function updateUserProfileIcon() {
    const btn = document.querySelector('.st-user');
    if (!btn) return;
    btn.innerHTML = currentUser
        ? `${stAvatarHtml(currentUser, 'st-av')}<span class="st-uname">${escapeHtml(currentUser.name || 'โปรไฟล์')}</span>${stRoleBadge(stRole)}<i class="fas fa-chevron-down st-ucaret"></i>`
        : `<span class="st-av"><i class="fas fa-user"></i></span><span class="st-uname">เข้าสู่ระบบ</span>`;
    btn.title = currentUser ? `${currentUser.name} (${ST_ROLE_LABEL[stRole]})` : 'เข้าสู่ระบบ';
}

function openUserProfileOrLogin() {
    if (currentUser) openUserMenu(); else stShowLogin();
}

// ===== เมนูผู้ใช้ (มุมขวาบน) — รวมเมนู Admin ไว้ที่นี่แทนปุ่มกุญแจเดิม =====
function openUserMenu() {
    let m = document.getElementById('stUmenu');
    if (!m) {
        m = document.createElement('div');
        m.id = 'stUmenu';
        m.className = 'st-umenu';
        m.addEventListener('click', e => { if (e.target === m) closeUserMenu(); });
        document.body.appendChild(m);
    }
    const adminItems = isAdmin ? `
        <div class="um-sep">Admin</div>
        <button type="button" onclick="closeUserMenu(); umOpen();"><i class="fas fa-users-gear"></i> จัดการผู้ใช้</button>
        <button type="button" onclick="closeUserMenu(); openPmDashboard();"><i class="fas fa-chart-column"></i> แดชบอร์ด PM</button>
        <button type="button" onclick="closeUserMenu(); openReportModal();"><i class="fas fa-file-lines"></i> สร้างรายงานสรุป</button>
        <button type="button" onclick="closeUserMenu(); setupDataValidationUI();"><i class="fas fa-shield-halved"></i> ตั้งค่าป้องกันข้อมูลผิด</button>` : '';
    m.innerHTML = `<div class="st-umenu-box" role="menu">
        <div class="st-umenu-head">${stAvatarHtml(currentUser, 'st-av lg')}<div><b>${escapeHtml(currentUser.name)}</b><span>@${escapeHtml(currentUser.username || '')} · ${stRoleBadge(stRole)}</span></div></div>
        ${stRole === 'guest' ? '<div class="st-umenu-note"><i class="fas fa-eye"></i> บัญชีนี้ดูข้อมูลได้อย่างเดียว</div>' : ''}
        <button type="button" onclick="closeUserMenu(); openUserProfileModal();"><i class="fas fa-id-badge"></i> โปรไฟล์ของฉัน</button>
        ${adminItems}
        <div class="um-sep"></div>
        <button type="button" class="danger" onclick="closeUserMenu(); logoutUser();"><i class="fas fa-right-from-bracket"></i> ออกจากระบบ</button>
    </div>`;
    m.hidden = false;
    requestAnimationFrame(() => m.classList.add('open'));
}
function closeUserMenu() {
    const m = document.getElementById('stUmenu');
    if (!m) return;
    m.classList.remove('open');
    m.hidden = true;
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeUserMenu(); });

// ===== หน้าเข้าสู่ระบบ (บังคับก่อนเห็นข้อมูล) =====
function stShowLogin(msg, noFocus) {
    let el = document.getElementById('stLogin');
    if (!el) {
        el = document.createElement('div');
        el.id = 'stLogin';
        el.className = 'st-login';
        el.innerHTML = `<form class="st-login-in" onsubmit="stDoLogin(event)" autocomplete="on">
            <div class="st-login-brand"><img src="icons/icon-192.png" alt="C2TECH Service"><h1>Service Tracker</h1><span>C2TECH · PM ANALYZER</span></div>
            <div class="st-login-box">
                <h2>เข้าสู่ระบบ</h2>
                <label class="st-field"><span>Username</span><input id="lgUser" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
                <label class="st-field"><span>รหัสผ่าน</span><span class="st-pw"><input id="lgPw" name="password" type="password" autocomplete="current-password" required><button type="button" aria-label="แสดงรหัสผ่าน" onclick="stTogglePw('lgPw', this)"><i class="fas fa-eye"></i></button></span></label>
                <div class="st-login-err" id="lgErr" role="alert" hidden></div>
                <button type="submit" class="st-login-btn" id="lgBtn">เข้าสู่ระบบ</button>
                <p class="st-login-hint">ลืมรหัสผ่าน? ติดต่อ Admin เพื่อรีเซ็ต<br>ระบบจำการเข้าสู่ระบบไว้ ${30} วัน</p>
            </div>
            <div class="st-login-foot">บริษัท ซีทูเทค จำกัด</div>
        </form>`;
        document.body.appendChild(el);
    }
    const err = document.getElementById('lgErr');
    err.hidden = !msg; err.innerText = msg || '';
    el.hidden = false;
    document.body.classList.add('st-login-on');
    stExpiredShown = false;
    if (!noFocus) setTimeout(() => { const u = document.getElementById('lgUser'); if (u && !u.value) u.focus(); }, 60);
}
function stHideLogin() {
    const el = document.getElementById('stLogin');
    if (el) el.hidden = true;
    document.body.classList.remove('st-login-on');
}
function stTogglePw(id, btn) {
    const inp = document.getElementById(id);
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.innerHTML = `<i class="fas fa-eye${show ? '-slash' : ''}"></i>`;
}
async function stDoLogin(ev) {
    ev.preventDefault();
    const username = document.getElementById('lgUser').value.trim();
    const password = document.getElementById('lgPw').value;
    const err = document.getElementById('lgErr');
    const btn = document.getElementById('lgBtn');
    if (!username || !password) { err.hidden = false; err.innerText = 'กรุณากรอก Username และรหัสผ่าน'; return; }
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> กำลังเข้าสู่ระบบ...';
    err.hidden = true;
    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'user_login', username, password }),
            headers: { "Content-Type": "text/plain;charset=utf-8" }
        });
        const res = await response.json();
        if (res.status !== 'success' || !res.token) throw new Error(res.message || 'เข้าสู่ระบบไม่สำเร็จ');
        document.getElementById('lgPw').value = '';
        stSaveSession(res.user, res.token);
        // ลำดับ: หน้าโหลด → เข้าสู่ระบบ → หน้าหลัก — โหลดข้อมูลบนหน้าเข้าสู่ระบบ แล้วค่อยเปิดหน้าหลักทีเดียว
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> กำลังโหลดข้อมูล...';
        stSplashActive = false;
        await loadData(false, true);
        stHideLogin();
        Toast.fire({ icon: 'success', title: `ยินดีต้อนรับ ${currentUser.name}` });
    } catch (e) {
        err.hidden = false;
        err.innerText = e.message === 'Failed to fetch' ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่' : e.message;
    } finally {
        btn.disabled = false; btn.innerText = 'เข้าสู่ระบบ';
    }
}
// ของเดิมบางจุดเรียก showLoginModal() — ชี้มาที่หน้าเข้าสู่ระบบใหม่
function showLoginModal() { stShowLogin(); }

// เช็คกับหลังบ้านว่าบัญชียังใช้ได้ + อัปเดตสิทธิ์ล่าสุด (Admin อาจเปลี่ยนสิทธิ์ระหว่างนี้)
async function stVerifySession() {
    if (!stToken) return;
    try {
        const res = await stFetch(SCRIPT_URL, { method: 'POST', body: stBody({ action: 'auth_me' }), headers: { "Content-Type": "text/plain;charset=utf-8" } });
        const j = await res.json();
        if (j.status === 'success' && j.user) {
            const roleChanged = j.user.role !== stRole;
            stSaveSession(j.user);
            if (roleChanged) render();
        }
    } catch (e) { /* ออฟไลน์ — ใช้ข้อมูลเดิมไปก่อน */ }
}

function logoutUser() {
    const tok = stToken;
    if (tok) fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'user_logout', token: tok }), headers: { "Content-Type": "text/plain;charset=utf-8" } }).catch(() => { });
    stClearSession();
    appData = []; partsCache = {}; stSelected = null;
    try { Swal.close(); } catch (e) { }
    umClose(true); dbClose(); rpClose();
    stCloseDetail();
    render();
    stShowLogin();
}

// อัปโหลดรูปโปรไฟล์ (ใช้ฟังก์ชันย่อรูป/อ่านไฟล์เดียวกับรูป PM แต่ action คนละตัว)
async function uploadUserPhoto(rawDataUrlOrFile) {
    const rawDataUrl = (rawDataUrlOrFile instanceof File) ? await readFileAsDataUrl(rawDataUrlOrFile) : rawDataUrlOrFile;
    const imageData = await resizeImageDataUrl(rawDataUrl, 500, 0.7);
    const response = await stFetch(SCRIPT_URL, {
        method: 'POST',
        body: stBody({ action: 'user_photo', image: imageData, fileName: `USER_${Date.now()}.jpg` }),
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

// ฟอร์มแก้ไขข้อมูลโปรไฟล์ (แยกจากบัตรพนักงานที่โชว์ด้านนอก เพื่อให้บัตรดูสะอาดสวยงาม)

/* =========================================================================================
   Admin: จัดการผู้ใช้งาน (หน้าเต็ม — PC: รายชื่อ + แผงแก้ไขด้านขวา / มือถือ: รายชื่อ + หน้าแก้ไขเต็มจอ)
========================================================================================= */
let umUsers = [];
let umFilter = 'all';
let umSel = null;      // userId ที่เลือก, 'new' = เพิ่มผู้ใช้ใหม่
let umDirty = false;

function umEl() {
    let el = document.getElementById('umPage');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'umPage';
    el.className = 'um';
    el.hidden = true;
    el.innerHTML = `
        <header class="um-top">
            <button type="button" class="um-back" onclick="umClose()"><i class="fas fa-chevron-left"></i> กลับ</button>
            <div class="um-title"><h2>จัดการผู้ใช้</h2><span id="umSum"></span></div>
            <button type="button" class="um-reload" onclick="umLoad()" title="โหลดใหม่" aria-label="โหลดใหม่"><i class="fas fa-rotate" id="umReloadIc"></i></button>
        </header>
        <div class="um-body">
            <section class="um-list">
                <div class="um-tb">
                    <label class="um-search"><i class="fas fa-search"></i><input type="search" id="umQ" placeholder="ค้นหาชื่อ / username / ตำแหน่ง" oninput="umRenderList()" autocomplete="off"></label>
                    <div class="um-chips" id="umChips"></div>
                    <button type="button" class="um-add" onclick="umOpenNew()"><i class="fas fa-user-plus"></i> <span>เพิ่มผู้ใช้</span></button>
                </div>
                <div class="um-head"><span>ผู้ใช้</span><span>ตำแหน่ง</span><span>สิทธิ์</span><span>สถานะ</span><span>เข้าใช้ล่าสุด</span></div>
                <div class="um-rows" id="umRows"></div>
            </section>
            <aside class="um-panel" id="umPanel"></aside>
        </div>`;
    document.body.appendChild(el);
    return el;
}
function umIsWide() { return window.innerWidth >= 900; }

async function umOpen() {
    if (!isAdmin) { Swal.fire({ icon: 'warning', title: 'สำหรับ Admin เท่านั้น' }); return; }
    const el = umEl();
    el.hidden = false;
    document.body.classList.add('um-on');
    umSel = null; umDirty = false;
    document.getElementById('umQ').value = '';
    umFilter = 'all';
    umRenderPanel();
    try { history.pushState({ um: true }, ''); } catch (e) { }
    await umLoad();
}
// เผื่อของเดิมเรียกชื่อเก่า
function openUserManagement() { umOpen(); }

function umClose(force, fromPop) {
    const el = document.getElementById('umPage');
    if (!el || el.hidden) return;
    if (!force && umDirty && !confirm('มีการแก้ไขที่ยังไม่บันทึก ต้องการออกจากหน้านี้ใช่ไหม?')) return;
    if (!fromPop) { try { if (history.state && history.state.um) history.back(); } catch (e) { } }
    el.hidden = true;
    el.classList.remove('panel-open');
    document.body.classList.remove('um-on');
    umDirty = false;
}
window.addEventListener('popstate', () => {
    const el = document.getElementById('umPage');
    if (!el || el.hidden) return;
    if (!umIsWide() && el.classList.contains('panel-open')) { umBackToList(); try { history.pushState({ um: true }, ''); } catch (e) { } return; }
    umClose(true, true);
});

async function umApi(body) {
    const res = await stFetch(SCRIPT_URL, { method: 'POST', body: stBody(body), headers: { "Content-Type": "text/plain;charset=utf-8" } });
    const j = await res.json();
    if (j.status !== 'success') throw new Error(j.message || 'ทำรายการไม่สำเร็จ');
    return j;
}

async function umLoad() {
    const ic = document.getElementById('umReloadIc');
    if (ic) ic.classList.add('fa-spin');
    if (!umUsers.length) document.getElementById('umRows').innerHTML = '<div class="um-skel"></div><div class="um-skel"></div><div class="um-skel"></div>';
    try {
        const j = await umApi({ action: 'user_list' });
        umUsers = j.users || [];
        umRenderList();
        if (umSel && umSel !== 'new' && !umDirty) umRenderPanel();
    } catch (e) {
        document.getElementById('umRows').innerHTML = `<div class="um-empty"><i class="fas fa-triangle-exclamation"></i><b>โหลดรายชื่อไม่สำเร็จ</b><span>${escapeHtml(e.message)}</span><button type="button" class="um-btn" onclick="umLoad()">ลองใหม่</button></div>`;
    } finally {
        if (ic) ic.classList.remove('fa-spin');
    }
}

function umAgo(iso) {
    if (!iso) return 'ยังไม่เคยเข้า';
    const d = new Date(iso); if (isNaN(d)) return '-';
    const s = (Date.now() - d.getTime()) / 1000;
    if (s < 120) return 'เมื่อสักครู่';
    if (s < 3600) return Math.floor(s / 60) + ' นาทีที่แล้ว';
    if (s < 86400) return Math.floor(s / 3600) + ' ชม.ที่แล้ว';
    const days = Math.floor(s / 86400);
    if (days === 1) return 'เมื่อวาน';
    if (days < 30) return days + ' วันที่แล้ว';
    return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}
function umIsSelf(u) { return currentUser && String(u.userId) === String(currentUser.userId); }

function umRenderList() {
    const q = (document.getElementById('umQ').value || '').trim().toLowerCase();
    const cnt = { all: umUsers.length, admin: 0, staff: 0, guest: 0, off: 0 };
    umUsers.forEach(u => { if (u.status === 'Inactive') cnt.off++; else cnt[u.role] = (cnt[u.role] || 0) + 1; });
    document.getElementById('umSum').innerText = `${cnt.all} คน · Admin ${cnt.admin} · Staff ${cnt.staff} · Guest ${cnt.guest}`;
    const chips = [['all', 'ทั้งหมด'], ['admin', 'Admin'], ['staff', 'Staff'], ['guest', 'Guest'], ['off', 'ปิดใช้งาน']];
    document.getElementById('umChips').innerHTML = chips.map(([k, l]) =>
        `<button type="button" class="um-chip${umFilter === k ? ' on' : ''}" onclick="umFilter='${k}';umRenderList()">${l}<b>${cnt[k] || 0}</b></button>`).join('');

    const list = umUsers.filter(u => {
        if (umFilter === 'off' && u.status !== 'Inactive') return false;
        if (['admin', 'staff', 'guest'].includes(umFilter) && (u.role !== umFilter || u.status === 'Inactive')) return false;
        if (!q) return true;
        return [u.name, u.username, u.position].some(v => String(v || '').toLowerCase().includes(q));
    }).sort((a, b) => (a.status === 'Inactive') - (b.status === 'Inactive') || ['admin', 'staff', 'guest'].indexOf(a.role) - ['admin', 'staff', 'guest'].indexOf(b.role) || String(a.name).localeCompare(String(b.name), 'th'));

    document.getElementById('umRows').innerHTML = list.map(u => `
        <button type="button" class="um-row${String(umSel) === String(u.userId) ? ' sel' : ''}${u.status === 'Inactive' ? ' off' : ''}" onclick="umSelect('${escapeHtml(u.userId)}')">
            <span class="um-who">${stAvatarHtml(u, 'st-av')}<span><b>${escapeHtml(u.name)}</b><small>@${escapeHtml(u.username)}${umIsSelf(u) ? ' · คุณ' : ''}<em class="um-m"> · ${escapeHtml(u.position || '-')}</em></small></span></span>
            <span class="um-pos">${escapeHtml(u.position || '-')}</span>
            <span class="um-role">${stRoleBadge(u.role)}</span>
            <span class="um-st${u.status === 'Inactive' ? ' x' : ''}"><i></i>${u.status === 'Inactive' ? 'ปิดใช้งาน' : 'ใช้งาน'}</span>
            <span class="um-last">${escapeHtml(umAgo(u.lastLogin))}</span>
        </button>`).join('') || `<div class="um-empty"><i class="fas fa-user-slash"></i><b>ไม่พบผู้ใช้</b><span>${q ? 'ลองค้นด้วยคำอื่น' : 'ยังไม่มีผู้ใช้ในกลุ่มนี้'}</span></div>`;
}

function umSelect(id) {
    if (umDirty && String(umSel) !== String(id) && !confirm('มีการแก้ไขที่ยังไม่บันทึก ต้องการทิ้งการแก้ไขใช่ไหม?')) return;
    umSel = id; umDirty = false;
    umRenderList();
    umRenderPanel();
    document.getElementById('umPanel').scrollTop = 0;
    document.getElementById('umPage').classList.add('panel-open');
}
function umOpenNew() { umSelect('new'); }
function umBackToList() {
    if (umDirty && !confirm('มีการแก้ไขที่ยังไม่บันทึก ต้องการทิ้งการแก้ไขใช่ไหม?')) return;
    umDirty = false;
    document.getElementById('umPage').classList.remove('panel-open');
    if (!umIsWide()) { umSel = null; umRenderList(); }
}

const UM_ROLE_INFO = {
    admin: ['Admin', 'ทำได้ทุกอย่าง: ต่อสัญญา ลบอะไหล่ รายงาน แดชบอร์ด และจัดการผู้ใช้'],
    staff: ['Staff · ช่าง', 'ถ่ายรูป ปิดงาน PM บันทึกอะไหล่และหมายเหตุ'],
    guest: ['Guest · ดูอย่างเดียว', 'ดูรายการเครื่อง ประวัติ และอะไหล่ได้ แก้ไขอะไรไม่ได้']
};
function umRolesHtml(cur, disabled) {
    return `<div class="um-roles" role="radiogroup" aria-label="สิทธิ์การใช้งาน">` + ['admin', 'staff', 'guest'].map(r => `
        <label class="um-roleopt${cur === r ? ' on' : ''}${disabled ? ' dis' : ''}">
            <input type="radio" name="umRole" value="${r}" ${cur === r ? 'checked' : ''} ${disabled ? 'disabled' : ''} onchange="umRoleChange(this)">
            <span class="rd"></span><span><b>${UM_ROLE_INFO[r][0]}</b><small>${UM_ROLE_INFO[r][1]}</small></span>
        </label>`).join('') + `</div>`;
}
function umRoleChange(inp) {
    document.querySelectorAll('.um-roleopt').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
    umMarkDirty();
}
function umMarkDirty() { umDirty = true; const b = document.getElementById('umSave'); if (b) b.disabled = false; }

function umFieldsHtml(u) {
    const bd = u && u.birthdate ? new Date(u.birthdate) : null;
    const bdv = bd && !isNaN(bd) ? `${bd.getFullYear()}-${String(bd.getMonth() + 1).padStart(2, '0')}-${String(bd.getDate()).padStart(2, '0')}` : '';
    const g = (u && u.gender) || '';
    return `<div class="um-grid">
        <label class="st-field wide"><span>ชื่อ-สกุล</span><input id="umName" value="${escapeHtml((u && u.name) || '')}" oninput="umMarkDirty()" maxlength="80"></label>
        <label class="st-field"><span>ตำแหน่ง</span><input id="umPos" value="${escapeHtml((u && u.position) || '')}" oninput="umMarkDirty()" maxlength="60" placeholder="เช่น ช่างเทคนิค"></label>
        <label class="st-field"><span>เพศ</span><select id="umGender" onchange="umMarkDirty()"><option value="">-</option>${['ชาย', 'หญิง', 'อื่นๆ'].map(x => `<option ${g === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="st-field wide"><span>วันเกิด</span><input type="date" id="umBirth" value="${bdv}" onchange="umMarkDirty()"></label>
    </div>`;
}

function umRenderPanel() {
    const p = document.getElementById('umPanel');
    if (!p) return;
    const back = `<button type="button" class="um-pback" onclick="umBackToList()"><i class="fas fa-chevron-left"></i> รายชื่อผู้ใช้</button>`;
    if (umSel === 'new') {
        p.innerHTML = `${back}
            <div class="um-ph"><span class="st-av lg"><i class="fas fa-user-plus"></i></span><div><b>เพิ่มผู้ใช้ใหม่</b><small>ระบบสุ่มรหัสผ่านเริ่มต้นให้</small></div></div>
            <div class="um-sec"><h4>บัญชี</h4>
                <label class="st-field"><span>Username <em>(ใช้ตอนเข้าสู่ระบบ เปลี่ยนภายหลังไม่ได้)</em></span><input id="umUser" autocapitalize="none" spellcheck="false" maxlength="30" placeholder="เช่น somchai" oninput="umMarkDirty()"></label>
                <p class="um-help">ภาษาอังกฤษ ตัวเลข จุด หรือขีด 3–30 ตัว</p>
            </div>
            <div class="um-sec"><h4>ข้อมูล</h4>${umFieldsHtml(null)}</div>
            <div class="um-sec"><h4>สิทธิ์การใช้งาน</h4>${umRolesHtml('staff', false)}</div>
            <div class="um-foot"><button type="button" class="um-btn pri" id="umSave" onclick="umCreate()"><i class="fas fa-user-plus"></i> สร้างผู้ใช้</button></div>`;
        return;
    }
    const u = umUsers.find(x => String(x.userId) === String(umSel));
    if (!u) {
        p.innerHTML = `<div class="um-pempty"><i class="fas fa-user-gear"></i><b>เลือกผู้ใช้เพื่อแก้ไข</b><span>เปลี่ยนสิทธิ์ ปิดบัญชี หรือรีเซ็ตรหัสผ่านได้ที่นี่</span></div>`;
        return;
    }
    const self = umIsSelf(u);
    const created = /^U\d{12,}$/.test(String(u.userId)) ? new Date(+String(u.userId).slice(1)).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '';
    p.innerHTML = `${back}
        <div class="um-ph">${stAvatarHtml(u, 'st-av lg')}<div><b>${stWords(u.name)}</b><small>@${escapeHtml(u.username)}${created ? ' · สร้างเมื่อ ' + created : ''} · เข้าใช้ ${escapeHtml(umAgo(u.lastLogin))}</small></div></div>
        ${self ? '<div class="um-note"><i class="fas fa-circle-info"></i> นี่คือบัญชีของคุณ — เปลี่ยนสิทธิ์/ปิดบัญชีตัวเองไม่ได้ ให้ Admin คนอื่นทำแทน</div>' : ''}
        <div class="um-sec"><h4>ข้อมูล</h4>${umFieldsHtml(u)}</div>
        <div class="um-sec"><h4>สิทธิ์การใช้งาน</h4>${umRolesHtml(u.role, self)}</div>
        <div class="um-sec"><label class="um-sw${self ? ' dis' : ''}"><span><b>เปิดใช้งานบัญชี</b><small>ปิดแล้วเข้าสู่ระบบไม่ได้ ประวัติงานยังอยู่ครบ</small></span>
            <input type="checkbox" id="umActive" ${u.status !== 'Inactive' ? 'checked' : ''} ${self ? 'disabled' : ''} onchange="umMarkDirty()"><i></i></label></div>
        <div class="um-foot"><button type="button" class="um-btn pri" id="umSave" onclick="umSaveEdit()" disabled><i class="fas fa-check"></i> บันทึกการเปลี่ยนแปลง</button></div>
        <div class="um-sec um-acts"><h4>การจัดการบัญชี</h4>
            <button type="button" class="um-act" onclick="umResetPw()"><i class="fas fa-key"></i><span><b>สุ่มรหัสผ่านใหม่</b><small>รหัสเดิมใช้ไม่ได้ทันที ทุกเครื่องต้องเข้าระบบใหม่</small></span></button>
            <button type="button" class="um-act" onclick="umForceLogout()"><i class="fas fa-mobile-screen"></i><span><b>บังคับออกจากระบบทุกเครื่อง</b><small>เช่น ทำมือถือหาย</small></span></button>
            ${self ? '' : `<button type="button" class="um-act danger" onclick="umDelete()"><i class="fas fa-trash"></i><span><b>ลบผู้ใช้ถาวร</b><small>แนะนำปิดใช้งานแทน ลบแล้วกู้คืนไม่ได้</small></span></button>`}
        </div>`;
}

function umReadFields() {
    return {
        name: document.getElementById('umName').value.trim(),
        position: document.getElementById('umPos').value.trim(),
        gender: document.getElementById('umGender').value,
        birthdate: document.getElementById('umBirth').value,
        role: (document.querySelector('input[name="umRole"]:checked') || {}).value
    };
}
function umBusy(btn, on, html) {
    if (!btn) return;
    if (on) { btn.dataset.html = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> กำลังบันทึก...'; }
    else { btn.disabled = false; btn.innerHTML = html || btn.dataset.html; }
}

async function umCreate() {
    const f = umReadFields();
    f.username = document.getElementById('umUser').value.trim();
    if (!/^[A-Za-z0-9._-]{3,30}$/.test(f.username)) { Swal.fire({ icon: 'warning', title: 'Username ไม่ถูกต้อง', text: 'ใช้ภาษาอังกฤษ ตัวเลข จุด หรือขีด 3–30 ตัว' }); return; }
    if (!f.name) { Swal.fire({ icon: 'warning', title: 'กรุณากรอกชื่อ-สกุล' }); return; }
    const btn = document.getElementById('umSave');
    umBusy(btn, true);
    try {
        const j = await umApi(Object.assign({ action: 'user_add' }, f));
        umDirty = false;
        await umLoad();
        umSel = j.userId; umRenderList(); umRenderPanel();
        umShowPassword('เพิ่มผู้ใช้สำเร็จ', f.name, j.username || f.username, j.generatedPassword);
    } catch (e) {
        umBusy(btn, false);
        Swal.fire({ icon: 'error', title: 'เพิ่มผู้ใช้ไม่สำเร็จ', text: e.message });
    }
}

async function umSaveEdit() {
    const u = umUsers.find(x => String(x.userId) === String(umSel));
    if (!u) return;
    const f = umReadFields();
    if (!f.name) { Swal.fire({ icon: 'warning', title: 'กรุณากรอกชื่อ-สกุล' }); return; }
    const body = { action: 'user_update', userId: u.userId, name: f.name, position: f.position, gender: f.gender, birthdate: f.birthdate };
    const act = document.getElementById('umActive');
    if (!umIsSelf(u)) { body.role = f.role; body.status = act.checked ? 'Active' : 'Inactive'; }
    const changes = [];
    if (body.role && body.role !== u.role) changes.push(`สิทธิ์ ${ST_ROLE_LABEL[u.role]} → <b>${ST_ROLE_LABEL[body.role]}</b>`);
    if (body.status && body.status !== (u.status || 'Active')) changes.push(body.status === 'Inactive' ? '<b>ปิดใช้งานบัญชี</b> (เข้าสู่ระบบไม่ได้)' : '<b>เปิดใช้งานบัญชี</b>');
    if (changes.length) {
        const c = await Swal.fire({
            icon: 'question', title: 'ยืนยันการเปลี่ยนแปลง',
            html: `<div class="um-cf"><b>${escapeHtml(u.name)}</b><ul>${changes.map(x => `<li>${x}</li>`).join('')}</ul><small>ผู้ใช้คนนี้จะต้องเข้าสู่ระบบใหม่ทุกเครื่อง</small></div>`,
            showCancelButton: true, confirmButtonText: 'ยืนยัน', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#22392b'
        });
        if (!c.isConfirmed) return;
    }
    const btn = document.getElementById('umSave');
    umBusy(btn, true);
    try {
        const j = await umApi(body);
        const i = umUsers.findIndex(x => String(x.userId) === String(u.userId));
        if (i > -1 && j.user) umUsers[i] = j.user;
        umDirty = false;
        if (umIsSelf(u) && j.user) { stSaveSession(Object.assign({}, currentUser, j.user)); }
        umRenderList(); umRenderPanel();
        Toast.fire({ icon: 'success', title: 'บันทึกแล้ว' });
    } catch (e) {
        umBusy(btn, false);
        Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: e.message });
    }
}

async function umResetPw() {
    const u = umUsers.find(x => String(x.userId) === String(umSel));
    if (!u) return;
    const c = await Swal.fire({ icon: 'warning', title: 'สุ่มรหัสผ่านใหม่?', html: `<b>${escapeHtml(u.name)}</b> จะใช้รหัสเดิมไม่ได้ และต้องเข้าสู่ระบบใหม่ทุกเครื่อง`, showCancelButton: true, confirmButtonText: 'สุ่มรหัสใหม่', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#b86a00' });
    if (!c.isConfirmed) return;
    Swal.fire({ title: 'กำลังสุ่มรหัส...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const j = await umApi({ action: 'user_reset_password', userId: u.userId });
        Swal.close();
        umShowPassword('รีเซ็ตรหัสผ่านแล้ว', u.name, j.username || u.username, j.generatedPassword);
        if (umIsSelf(u)) { stSessionExpired('คุณรีเซ็ตรหัสผ่านของตัวเอง กรุณาเข้าสู่ระบบด้วยรหัสใหม่'); }
    } catch (e) { Swal.fire({ icon: 'error', title: 'รีเซ็ตไม่สำเร็จ', text: e.message }); }
}

async function umForceLogout() {
    const u = umUsers.find(x => String(x.userId) === String(umSel));
    if (!u) return;
    const c = await Swal.fire({ icon: 'question', title: 'ออกจากระบบทุกเครื่อง?', html: `<b>${escapeHtml(u.name)}</b> ต้องเข้าสู่ระบบใหม่ด้วยรหัสเดิม`, showCancelButton: true, confirmButtonText: 'ยืนยัน', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#22392b' });
    if (!c.isConfirmed) return;
    try {
        await umApi({ action: 'user_force_logout', userId: u.userId });
        if (umIsSelf(u)) { stSessionExpired('ออกจากระบบทุกเครื่องแล้ว กรุณาเข้าสู่ระบบใหม่'); return; }
        Toast.fire({ icon: 'success', title: 'ออกจากระบบทุกเครื่องแล้ว' });
    } catch (e) { Swal.fire({ icon: 'error', title: 'ทำรายการไม่สำเร็จ', text: e.message }); }
}

async function umDelete() {
    const u = umUsers.find(x => String(x.userId) === String(umSel));
    if (!u) return;
    const c = await Swal.fire({
        icon: 'warning', title: 'ลบผู้ใช้ถาวร?',
        html: `<div class="um-cf">พิมพ์ <b>${escapeHtml(u.username)}</b> เพื่อยืนยันการลบ <b>${escapeHtml(u.name)}</b><small>ถ้าแค่ไม่ให้ใช้งานแล้ว แนะนำปิดใช้งานแทน (ประวัติยังอยู่และเปิดกลับได้)</small></div>`,
        input: 'text', inputAttributes: { autocapitalize: 'none', spellcheck: 'false' },
        showCancelButton: true, confirmButtonText: 'ลบถาวร', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#c8302f',
        preConfirm: v => { if (String(v || '').trim().toLowerCase() !== String(u.username).toLowerCase()) { Swal.showValidationMessage('พิมพ์ username ให้ตรงก่อน'); return false; } return true; }
    });
    if (!c.isConfirmed) return;
    try {
        await umApi({ action: 'user_delete', userId: u.userId });
        umUsers = umUsers.filter(x => String(x.userId) !== String(u.userId));
        umSel = null; umDirty = false;
        document.getElementById('umPage').classList.remove('panel-open');
        umRenderList(); umRenderPanel();
        Toast.fire({ icon: 'success', title: 'ลบผู้ใช้แล้ว' });
    } catch (e) { Swal.fire({ icon: 'error', title: 'ลบไม่สำเร็จ', text: e.message }); }
}

// แสดงรหัสผ่านครั้งเดียว — คัดลอกส่งให้ผู้ใช้เอง (ไม่ส่งรหัสผ่านผ่านลิงก์ใดๆ)
function umShowPassword(title, name, username, pw) {
    const msg = `Service Tracker (C2TECH)\nUsername: ${username}\nรหัสผ่าน: ${pw}\nเข้าสู่ระบบแล้วเปลี่ยนรหัสผ่านได้ที่ โปรไฟล์ของฉัน > แก้ไขข้อมูล`;
    Swal.fire({
        title: title,
        html: `<div class="um-pw">
            <div class="um-pw-who">${escapeHtml(name)} · <b>@${escapeHtml(username)}</b></div>
            <div class="um-pw-lab">รหัสผ่านเริ่มต้น</div>
            <div class="um-pw-val" id="umPwVal">${escapeHtml(pw)}</div>
            <div class="um-pw-btns"><button type="button" class="um-btn" id="umCpPw"><i class="fas fa-copy"></i> คัดลอกรหัส</button><button type="button" class="um-btn pri" id="umCpMsg"><i class="fas fa-message"></i> คัดลอกข้อความส่งผู้ใช้</button></div>
            <div class="um-pw-warn"><i class="fas fa-triangle-exclamation"></i> ปิดหน้าต่างนี้แล้วจะดูรหัสนี้อีกไม่ได้</div>
        </div>`,
        showConfirmButton: true, confirmButtonText: 'เสร็จแล้ว', confirmButtonColor: '#22392b', allowOutsideClick: false,
        didOpen: () => {
            // ใช้ข้อความบนปุ่มบอกผล (Toast ของ Swal จะปิดหน้าต่างรหัสนี้ทิ้ง)
            const cp = async (btn, t, label) => {
                try { await navigator.clipboard.writeText(t); btn.innerHTML = `<i class="fas fa-check"></i> ${label}`; btn.classList.add('done'); }
                catch (e) { btn.innerHTML = '<i class="fas fa-xmark"></i> คัดลอกไม่ได้ กรุณาจดเอง'; }
            };
            const b1 = document.getElementById('umCpPw'), b2 = document.getElementById('umCpMsg');
            b1.onclick = () => cp(b1, pw, 'คัดลอกรหัสแล้ว');
            b2.onclick = () => cp(b2, msg, 'คัดลอกแล้ว วางใน LINE ได้เลย');
        }
    });
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
                ระบบจะเพิ่ม dropdown ให้คอลัมน์เหล่านี้ในชีต Users (กันพิมพ์สิทธิ์ผิดตอนแก้ในชีตโดยตรง):
                <ul style="font-size:12px; margin:8px 0; padding-left:20px;">
                    <li><b>Users · Role:</b> admin / staff / guest</li>
                    <li><b>Users · Status:</b> Active / Inactive</li>
                    <li><b>Users · เพศ:</b> ชาย / หญิง / อื่นๆ (เตือนถ้าไม่ตรง)</li>
                </ul>
                <small style="color:#94a3b8;">ไม่กระทบข้อมูลเดิมที่มีอยู่แล้ว มีผลแค่ตอนแก้ไขค่าในเซลล์นั้นครั้งต่อไปเท่านั้น</small>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'ตั้งค่าเลย',
        confirmButtonColor: '#22392b',
        cancelButtonText: 'ยกเลิก'
    });
    if (!confirm.isConfirmed) return;

    Swal.fire({ title: 'กำลังตั้งค่า...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        const res = await stFetch(SCRIPT_URL, {
            method: 'POST',
            body: stBody({ action: 'setup_data_validation' }),
            headers: { "Content-Type": "text/plain;charset=utf-8" }
        });
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.message);

        await Swal.fire({
            icon: 'success',
            title: 'ตั้งค่าเรียบร้อย',
            html: `<div style="text-align:left; font-size:12px;">${(data.details || []).map(d => `• ${escapeHtml(d)}`).join('<br>')}</div>`,
            confirmButtonColor: '#22392b',
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
        title: '<i class="fas fa-toolbox" style="color:#22392b;"></i> เมนู Admin',
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

/* =========================================================================================
   Admin: แดชบอร์ด PM + สร้างรายงาน (v4)
   คำนวณจากข้อมูลเครื่องที่โหลดอยู่แล้ว (appData) + ประวัติรอบสัญญาก่อนๆ และอะไหล่ (report_extra)
   "ตรงเวลา" = ทำเสร็จไม่เกิน DB_GRACE_DAYS วันหลังวันนัด
========================================================================================= */
const DB_GRACE_DAYS = 7;
const DB_MONTH_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
let dbExtra = null;          // { history: [...], parts: [...] } จากหลังบ้าน
let dbExtraLoading = null;
let dbPeriod = { key: 'year', from: null, to: null };
let dbBreak = 'type';

// วันที่จากชีตมีหลายรูปแบบ (ISO, Date, dd/mm/yyyy hh:mm)
function dbParse(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    const s = String(v).trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2}))?/);
    if (m) { const d = new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)); return isNaN(d) ? null : d; }
    const d = new Date(s);
    return isNaN(d) ? null : d;
}
function dbDay0(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function dbDays(a, b) { return Math.round((dbDay0(a) - dbDay0(b)) / 86400000); }
function dbIso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function dbFmtRange(f, t) {
    if (f.getMonth() === 0 && f.getDate() === 1 && t.getMonth() === 11 && t.getDate() === 31 && f.getFullYear() === t.getFullYear()) return `ปี ${f.getFullYear() + 543}`;
    if (f.getFullYear() === t.getFullYear() && f.getMonth() === t.getMonth() && f.getDate() === 1 && t.getDate() === new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate())
        return `${DB_MONTH_FULL[f.getMonth()]} ${f.getFullYear() + 543}`;
    return `${stDate(f)} – ${stDate(t)}`;
}

function dbPeriodRange(key, from, to) {
    const now = new Date();
    const y = now.getFullYear(), mo = now.getMonth();
    if (key === 'month') return [new Date(y, mo, 1), new Date(y, mo + 1, 0, 23, 59, 59)];
    if (key === 'lastmonth') return [new Date(y, mo - 1, 1), new Date(y, mo, 0, 23, 59, 59)];
    if (key === 'quarter') { const q = Math.floor(mo / 3) * 3; return [new Date(y, q, 1), new Date(y, q + 3, 0, 23, 59, 59)]; }
    if (key === 'year') return [new Date(y, 0, 1), new Date(y, 11, 31, 23, 59, 59)];
    if (key === '12m') return [new Date(y, mo - 11, 1), new Date(y, mo + 1, 0, 23, 59, 59)];
    const f = from ? new Date(from + 'T00:00:00') : new Date(y, mo, 1);
    const t = to ? new Date(to + 'T23:59:59') : new Date(y, mo + 1, 0, 23, 59, 59);
    return f <= t ? [f, t] : [t, f];
}

async function dbLoadExtra(force) {
    if (dbExtra && !force) return dbExtra;
    if (dbExtraLoading) return dbExtraLoading;
    dbExtraLoading = (async () => {
        try {
            const res = await stFetch(SCRIPT_URL, { method: 'POST', body: stBody({ action: 'report_extra' }), headers: { "Content-Type": "text/plain;charset=utf-8" } });
            const j = await res.json();
            dbExtra = j.status === 'success' ? { history: j.history || [], parts: j.parts || [], ok: true } : { history: [], parts: [], ok: false, msg: j.message };
        } catch (e) { dbExtra = { history: [], parts: [], ok: false, msg: e.message }; }
        dbExtraLoading = null;
        return dbExtra;
    })();
    return dbExtraLoading;
}

// รวมงาน PM ทุกรายการ: รอบปัจจุบัน (จาก appData) + รอบสัญญาก่อนๆ (PM_History)
function dbEvents() {
    const machines = appData.map(stCompute).filter(Boolean).filter(x => x.steps.length > 0);
    const bySn = {};
    machines.forEach(x => { bySn[x.sn] = x; });
    const ev = [];
    machines.forEach(x => x.steps.forEach(st => ev.push({
        sn: x.sn, m: x, round: 'PM' + st.idx, planned: st.planned && !isNaN(st.planned) ? st.planned : null,
        done: st.done ? dbParse(x.raw['PM' + st.idx + '_Status']) : null, tech: String(st.tech || '').trim(), past: false
    })));
    ((dbExtra && dbExtra.history) || []).forEach(h => {
        const x = bySn[h.sn];
        if (!x) return; // เครื่องที่ไม่อยู่ในรายการแล้ว (เช่น Test) ไม่นับ
        const done = dbParse(h.done);
        if (!done) return;
        ev.push({ sn: h.sn, m: x, round: h.round, planned: dbParse(h.planned), done, tech: String(h.tech || '').trim(), past: true });
    });
    return { machines, ev };
}

function dbFilterMachine(x, flt) {
    if (!flt || flt === 'all') return true;
    if (flt === 'renew') return x.renew;
    return x.type === flt;
}

// คำนวณตัวเลขทั้งหมดของช่วงเวลา
function dbCompute(from, to, flt) {
    const { machines, ev: evAll } = dbEvents();
    const ms = machines.filter(x => dbFilterMachine(x, flt));
    const ev = evAll.filter(e => dbFilterMachine(e.m, flt));
    const inR = d => d && d >= from && d <= to;
    const done = ev.filter(e => inR(e.done)).sort((a, b) => b.done - a.done);
    done.forEach(e => { e.delay = e.planned ? dbDays(e.done, e.planned) : null; e.onTime = e.delay === null ? null : e.delay <= DB_GRACE_DAYS; });
    const withPlan = done.filter(e => e.delay !== null);
    const onTime = withPlan.filter(e => e.onTime).length;
    const avgDelay = withPlan.length ? withPlan.reduce((s, e) => s + e.delay, 0) / withPlan.length : null;

    // ช่วงเดียวกันปีก่อน
    const pf = new Date(from); pf.setFullYear(pf.getFullYear() - 1);
    const pt = new Date(to); pt.setFullYear(pt.getFullYear() - 1);
    const prevDone = ev.filter(e => e.done && e.done >= pf && e.done <= pt).length;
    const hasPrevData = ev.some(e => e.done && e.done < from);

    // สถานะ "ตอนนี้" (ไม่ขึ้นกับช่วงเวลา)
    const now = new Date();
    const open = [];
    ms.forEach(x => x.steps.forEach(st => { if (!st.done && st.planned && !isNaN(st.planned)) open.push({ m: x, st, days: dbDays(st.planned, now) }); }));
    const overdueNow = open.filter(o => o.days < 0).sort((a, b) => a.days - b.days);
    const due30 = open.filter(o => o.days >= 0 && o.days <= 30);

    // งาน ณ วันสิ้นสุดช่วง (สำหรับรายงานย้อนหลัง)
    const asOf = to < now ? to : now;
    const overdueAt = ev.filter(e => e.planned && e.planned < asOf && (!e.done || e.done > asOf) && !e.past).map(e => ({ m: e.m, round: e.round, planned: e.planned, days: dbDays(asOf, e.planned) })).sort((a, b) => b.days - a.days);
    const lim = new Date(asOf); lim.setDate(lim.getDate() + 7);
    const urgentAt = ev.filter(e => e.planned && e.planned >= asOf && e.planned <= lim && (!e.done || e.done > asOf) && !e.past).map(e => ({ m: e.m, round: e.round, planned: e.planned, days: dbDays(e.planned, asOf) })).sort((a, b) => a.days - b.days);

    // กราฟ: รายเดือน (ช่วงยาว) หรือรายสัปดาห์ (ช่วง ≤ 45 วัน)
    const spanDays = dbDays(to, from) + 1;
    const buckets = [];
    if (spanDays > 45) {
        let c = new Date(from.getFullYear(), from.getMonth(), 1);
        while (c <= to) {
            const e = new Date(c.getFullYear(), c.getMonth() + 1, 0, 23, 59, 59);
            buckets.push({ from: c, to: e, label: ST_TH_MONTH[c.getMonth()] + (from.getFullYear() !== to.getFullYear() ? ' ' + String(c.getFullYear() + 543).slice(-2) : ''), full: DB_MONTH_FULL[c.getMonth()] + ' ' + (c.getFullYear() + 543) });
            c = new Date(c.getFullYear(), c.getMonth() + 1, 1);
        }
    } else {
        let c = dbDay0(from);
        while (c <= to) {
            const e = new Date(c); e.setDate(e.getDate() + 6); e.setHours(23, 59, 59);
            const ee = e > to ? to : e;
            buckets.push({ from: c, to: ee, label: c.getDate() + '–' + ee.getDate() + ' ' + ST_TH_MONTH[ee.getMonth()], full: stDate(c) + ' – ' + stDate(ee) });
            c = new Date(ee); c.setDate(c.getDate() + 1); c.setHours(0, 0, 0, 0);
        }
    }
    buckets.forEach(b => {
        b.due = ev.filter(e => e.planned && e.planned >= b.from && e.planned <= b.to).length;
        b.done = ev.filter(e => e.done && e.done >= b.from && e.done <= b.to).length;
        b.cur = now >= b.from && now <= b.to;
    });

    // ผลงานรายช่าง
    const techMap = {};
    done.forEach(e => {
        const t = e.tech || 'ไม่ระบุชื่อ';
        const r = techMap[t] || (techMap[t] = { tech: t, count: 0, onTime: 0, planned: 0, delaySum: 0, jobs: [] });
        r.count++; r.jobs.push(e);
        if (e.delay !== null) { r.planned++; r.delaySum += e.delay; if (e.onTime) r.onTime++; }
    });
    const techs = Object.values(techMap).sort((a, b) => b.count - a.count || a.tech.localeCompare(b.tech, 'th'));

    // งาน 4 สัปดาห์ข้างหน้า
    const today = dbDay0(now);
    const weeks = [0, 1, 2, 3].map(i => {
        const f = new Date(today); f.setDate(f.getDate() + i * 7);
        const t = new Date(f); t.setDate(t.getDate() + 6);
        const items = open.filter(o => i === 0 ? o.days <= 6 : (o.days >= i * 7 && o.days <= i * 7 + 6));
        return { label: i === 0 ? 'สัปดาห์นี้' : (f.getMonth() === t.getMonth() ? `${f.getDate()}–${t.getDate()} ${ST_TH_MONTH[t.getMonth()]}` : `${f.getDate()} ${ST_TH_MONTH[f.getMonth()]} – ${t.getDate()} ${ST_TH_MONTH[t.getMonth()]}`), over: items.filter(o => o.days < 0).length, urg: items.filter(o => o.days >= 0 && o.days <= 7 && i === 0).length, plan: items.filter(o => !(o.days < 0) && !(o.days <= 7 && i === 0)).length, total: items.length };
    });

    // อะไหล่ในช่วง
    const msSet = new Set(ms.map(x => x.sn));
    const parts = ((dbExtra && dbExtra.parts) || []).map(p => ({ ...p, t: dbParse(p.time), m: machines.find(x => x.sn === p.sn) }))
        .filter(p => p.t && inR(p.t) && msSet.has(p.sn)).sort((a, b) => b.t - a.t);

    return {
        from, to, flt, machines: ms, done, onTime, withPlan: withPlan.length, avgDelay, prevDone, hasPrevData,
        overdueNow, due30, overdueAt, urgentAt, asOf, buckets, techs, weeks, parts,
        renewed: ms.filter(x => x.renew).length, hasHistory: !!(dbExtra && dbExtra.ok)
    };
}

function dbPct(n, d) { return d ? Math.round(n * 100 / d) + '%' : '-'; }
function dbDelayTxt(v) { if (v === null || v === undefined) return '-'; const r = Math.round(v * 10) / 10; return r === 0 ? 'ตรงวัน' : (r > 0 ? '+' : '') + r + ' วัน'; }

/* ---------- หน้าแดชบอร์ด ---------- */
function dbPageEl(id, title) {
    let el = document.getElementById(id);
    if (el) return el;
    el = document.createElement('div');
    el.id = id; el.className = 'um db'; el.hidden = true;
    document.body.appendChild(el);
    return el;
}
const DB_PERIODS = [['month', 'เดือนนี้'], ['quarter', 'ไตรมาสนี้'], ['year', 'ปีนี้'], ['12m', '12 เดือนล่าสุด'], ['custom', 'กำหนดเอง']];

async function openPmDashboard() {
    if (!isAdmin) { Swal.fire({ icon: 'warning', title: 'สำหรับ Admin เท่านั้น' }); return; }
    const el = dbPageEl('dbPage');
    el.hidden = false;
    document.body.classList.add('um-on');
    try { history.pushState({ db: true }, ''); } catch (e) { }
    dbRender();
    if (!dbExtra) { await dbLoadExtra(); if (!el.hidden) dbRender(); }
}
function dbClose(fromPop) {
    const el = document.getElementById('dbPage');
    if (!el || el.hidden) return;
    if (!fromPop) { try { if (history.state && history.state.db) history.back(); } catch (e) { } }
    el.hidden = true;
    if (!document.querySelector('.um:not([hidden])')) document.body.classList.remove('um-on');
}
window.addEventListener('popstate', () => { dbClose(true); rpClose(true); });

function dbSetPeriod(key) {
    dbPeriod.key = key;
    if (key === 'custom' && !dbPeriod.from) { const [f, t] = dbPeriodRange('month'); dbPeriod.from = dbIso(f); dbPeriod.to = dbIso(t); }
    dbRender();
}
function dbSetCustom() {
    dbPeriod.from = document.getElementById('dbFrom').value;
    dbPeriod.to = document.getElementById('dbTo').value;
    dbRender();
}

function dbBarsHtml(buckets, small) {
    const max = Math.max(1, ...buckets.map(b => Math.max(b.due, b.done)));
    const step = max <= 4 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : 10;
    const top = Math.ceil(max / step) * step;
    const grid = [];
    for (let v = step; v <= top; v += step) grid.push(`<div class="db-gl" style="bottom:${v / top * 100}%"><span>${v}</span></div>`);
    return `<div class="db-bars${small ? ' sm' : ''}">${grid.join('')}
        ${buckets.map(b => `<div class="db-m${b.cur ? ' cur' : ''}" title="${escapeHtml(b.full)}: ครบกำหนด ${b.due} · ทำเสร็จ ${b.done}">
            <i class="p" style="height:${b.due / top * 100}%"></i><i class="d" style="height:${b.done / top * 100}%"></i>
            <span class="db-tip">${escapeHtml(b.full)}<b>ครบกำหนด ${b.due} · ทำเสร็จ ${b.done}</b></span></div>`).join('')}</div>
        <div class="db-ml${buckets.length > 8 ? ' dense' : ''}">${buckets.map(b => `<span>${escapeHtml(b.label)}</span>`).join('')}</div>`;
}

function dbDonutHtml(ms) {
    const key = dbBreak;
    const get = x => key === 'type' ? x.type : key === 'mode' ? x.mode : x.location;
    const cnt = {};
    ms.forEach(x => { const k = get(x) && get(x) !== '-' ? get(x) : 'ไม่ระบุ'; cnt[k] = (cnt[k] || 0) + 1; });
    let rows = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
    if (rows.length > 4) { const rest = rows.slice(3).reduce((s, r) => s + r[1], 0); rows = rows.slice(0, 3).concat([['อื่นๆ', rest]]); }
    const colors = ['#3F654D', '#8fb39c', '#d9a441', '#b6bfba'];
    const total = ms.length || 1;
    let off = 25;
    const segs = rows.map((r, i) => { const len = r[1] / total * 100; const s = `<circle cx="21" cy="21" r="15.9" fill="none" stroke="${colors[i]}" stroke-width="6" stroke-dasharray="${Math.max(len - 0.8, 0.1)} ${100 - Math.max(len - 0.8, 0.1)}" stroke-dashoffset="${off}"/>`; off -= len; return s; }).join('');
    return `<div class="db-donut"><svg viewBox="0 0 42 42" role="img" aria-label="สัดส่วนเครื่อง"><circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--g-50)" stroke-width="6"/>${segs}<text x="21" y="23.2" text-anchor="middle">${ms.length}</text></svg>
        <div class="db-dl">${rows.map((r, i) => `<span><i style="background:${colors[i]}"></i><em>${escapeHtml(r[0])}</em><b>${r[1]}</b></span>`).join('')}</div></div>`;
}

function dbRender() {
    const el = document.getElementById('dbPage');
    if (!el) return;
    const [from, to] = dbPeriodRange(dbPeriod.key, dbPeriod.from, dbPeriod.to);
    const R = dbCompute(from, to, 'all');
    const diff = R.done.length - R.prevDone;
    const maxT = Math.max(1, ...R.techs.map(t => t.count));
    const maxW = Math.max(1, ...R.weeks.map(w => w.total));
    const oldest = R.overdueNow[0];
    const upd = document.getElementById('stUpdated') ? document.getElementById('stUpdated').innerText : '';
    const focus = R.overdueNow.concat(R.due30.filter(o => o.days <= 7).sort((a, b) => a.days - b.days)).slice(0, 6);
    el.innerHTML = `
        <header class="um-top">
            <button type="button" class="um-back" onclick="dbClose()"><i class="fas fa-chevron-left"></i> กลับ</button>
            <div class="um-title"><h2>แดชบอร์ด PM</h2><span>${escapeHtml(dbFmtRange(from, to))} · ${R.machines.length} เครื่อง${upd ? ' · ' + escapeHtml(upd) : ''}</span></div>
            <button type="button" class="db-rpbtn" onclick="openReportModal()"><i class="fas fa-file-lines"></i> <span>สร้างรายงาน</span></button>
        </header>
        <div class="db-bar"><div class="db-seg" role="tablist">${DB_PERIODS.map(([k, l]) => `<button type="button" class="${dbPeriod.key === k ? 'on' : ''}" onclick="dbSetPeriod('${k}')">${l}</button>`).join('')}</div>
            ${dbPeriod.key === 'custom' ? `<div class="db-custom"><input type="date" id="dbFrom" value="${dbPeriod.from}" onchange="dbSetCustom()" aria-label="ตั้งแต่"><span>ถึง</span><input type="date" id="dbTo" value="${dbPeriod.to}" onchange="dbSetCustom()" aria-label="ถึง"></div>` : ''}
            ${dbExtra === null ? '<span class="db-hint"><i class="fas fa-circle-notch fa-spin"></i> กำลังรวมประวัติรอบสัญญาก่อน...</span>' : (!R.hasHistory ? '<span class="db-hint warn"><i class="fas fa-circle-info"></i> ยังไม่รวมประวัติรอบสัญญาก่อน (อัปเดต Code.gs เพื่อดูครบ)</span>' : '')}
        </div>
        <div class="db-body">
            <div class="db-kpis">
                <div class="db-k"><small><i class="dt ok"></i>PM ที่ทำเสร็จ</small><b>${R.done.length}</b><em>${R.hasPrevData ? (diff === 0 ? 'เท่ากับช่วงเดียวกันปีก่อน' : `<span class="${diff > 0 ? 'up' : 'dn'}">${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}</span> จากช่วงเดียวกันปีก่อน`) : 'ยังไม่มีข้อมูลปีก่อนให้เทียบ'}</em></div>
                <div class="db-k"><small>ทำตรงเวลา</small><b>${dbPct(R.onTime, R.withPlan)}</b><em>${R.withPlan ? `${R.onTime} จาก ${R.withPlan} งาน ภายใน ${DB_GRACE_DAYS} วันหลังวันนัด` : 'ยังไม่มีงานในช่วงนี้'}</em></div>
                <div class="db-k"><small>เฉลี่ยเทียบวันนัด</small><b>${R.avgDelay === null ? '-' : dbDelayTxt(R.avgDelay).replace(' วัน', '<span class="u"> วัน</span>')}</b><em>ค่าลบ = ทำก่อนวันนัด</em></div>
                <div class="db-k r"><small><i class="dt red"></i>เลยกำหนดตอนนี้</small><b>${R.overdueNow.length}</b><em>${oldest ? `เก่าสุดเลย ${-oldest.days} วัน` : 'ไม่มีงานค้าง'}</em></div>
                <div class="db-k a"><small><i class="dt amb"></i>ครบกำหนดใน 30 วัน</small><b>${R.due30.length}</b><em>ต่อรายปีแล้ว ${R.renewed} / ${R.machines.length} เครื่อง</em></div>
            </div>
            <div class="db-g2">
                <section class="db-card"><h3>งานครบกำหนด vs ทำเสร็จ <small>${R.buckets.length > 0 && dbDays(to, from) > 45 ? 'รายเดือน' : 'รายสัปดาห์'}</small></h3>
                    <div class="db-leg"><span><i class="p"></i>ครบกำหนด</span><span><i class="d"></i>ทำเสร็จ</span><span class="r">กรอบประ = ช่วงปัจจุบัน</span></div>
                    ${dbBarsHtml(R.buckets)}</section>
                <section class="db-card"><h3>ผลงานรายช่าง <small>จำนวนงาน · % ตรงเวลา</small></h3>
                    ${R.techs.length ? `<div class="db-tech">${R.techs.map((t, i) => `<button type="button" class="db-tr" onclick="dbTechJobs(${i})">
                        <span class="nm"><span class="st-av">${escapeHtml(stInitial(t.tech))}</span><span>${escapeHtml(t.tech)}</span></span>
                        <span class="db-tb"><i style="width:${t.count / maxT * 100}%"></i></span>
                        <span class="v"><b>${t.count}</b><small>${dbPct(t.onTime, t.planned)}</small></span></button>`).join('')}</div>
                        <p class="db-foot">ชื่อตามที่บันทึกตอนปิดงาน · แตะชื่อเพื่อดูรายการงาน</p>` : '<div class="db-empty">ยังไม่มีงานที่ทำเสร็จในช่วงนี้</div>'}</section>
            </div>
            <div class="db-g3">
                <section class="db-card"><h3>งานที่ต้องไป 4 สัปดาห์ข้างหน้า <small>วางคิวช่าง</small></h3>
                    <div class="db-wk">${R.weeks.map(w => `<div class="db-wr"><span>${escapeHtml(w.label)}</span><span class="db-stack">${w.over ? `<i class="red" style="width:${w.over / maxW * 100}%"></i>` : ''}${w.urg ? `<i class="amb" style="width:${w.urg / maxW * 100}%"></i>` : ''}${w.plan ? `<i class="pl" style="width:${w.plan / maxW * 100}%"></i>` : ''}</span><b>${w.total}</b></div>`).join('')}</div>
                    <div class="db-leg"><span><i class="red"></i>เลยกำหนด</span><span><i class="amb"></i>ใน 7 วัน</span><span><i class="pl"></i>ตามแผน</span></div></section>
                <section class="db-card"><h3>ต้องไปก่อน <small>${R.overdueNow.length} เลยกำหนด</small></h3>
                    ${focus.length ? `<div class="db-list">${focus.map(o => `<button type="button" class="db-it" data-sn="${escapeHtml(o.m.sn)}" onclick="dbOpenMachine(this.dataset.sn)">
                        <i class="dt ${o.days < 0 ? 'red' : 'amb'}"></i><span class="bd"><b>${stWords(o.m.client)}</b><small>${escapeHtml(o.m.location)} · PM${o.st.idx}${o.days <= 0 && o.st.photo ? ' · มีรูปแล้ว รอปิดงาน' : ''}</small></span>
                        <span class="d ${o.days < 0 ? 'red' : 'amb'}">${o.days < 0 ? `เลย ${-o.days} วัน` : o.days === 0 ? 'วันนี้' : `อีก ${o.days} วัน`}</span></button>`).join('')}</div>` : '<div class="db-empty"><i class="fas fa-circle-check"></i> ไม่มีงานค้างหรือใกล้กำหนด</div>'}</section>
                <section class="db-card"><h3>สัดส่วนเครื่อง <small>${R.machines.length} เครื่องที่มีแผน PM</small></h3>
                    <div class="db-chips">${[['type', 'ประเภท'], ['mode', 'โหมด'], ['loc', 'จังหวัด']].map(([k, l]) => `<button type="button" class="${dbBreak === k ? 'on' : ''}" onclick="dbBreak='${k}';dbRender()">${l}</button>`).join('')}</div>
                    ${dbDonutHtml(R.machines)}</section>
            </div>
        </div>`;
    el._R = R;
}
function dbOpenMachine(sn) {
    dbClose();
    setTimeout(() => toggleDetail(sn), 80);
}
function dbTechJobs(i) {
    const R = document.getElementById('dbPage')._R;
    const t = R && R.techs[i];
    if (!t) return;
    Swal.fire({
        title: escapeHtml(t.tech),
        html: `<div class="db-jobs"><p>${t.count} งาน · ตรงเวลา ${dbPct(t.onTime, t.planned)} · เฉลี่ย ${dbDelayTxt(t.planned ? t.delaySum / t.planned : null)}</p>
            ${t.jobs.map(e => `<div class="db-job"><span><b>${stWords(e.m.client)}</b><small>${escapeHtml(e.round)} · ${stDate(e.done)}${e.past ? ' · รอบสัญญาก่อน' : ''}</small></span><em class="${e.onTime === false ? 'late' : ''}">${dbDelayTxt(e.delay)}</em></div>`).join('')}</div>`,
        confirmButtonText: 'ปิด', confirmButtonColor: '#22392b', width: 480
    });
}

/* ---------- สร้างรายงาน ---------- */
const RP_SECTIONS = [['kpi', 'สรุปตัวเลข'], ['chart', 'กราฟครบกำหนด vs ทำเสร็จ'], ['tech', 'ผลงานรายช่าง'], ['overdue', 'เครื่องที่เลยกำหนด'], ['urgent', 'ใกล้กำหนด 7 วัน'], ['done', 'PM ที่ทำเสร็จในช่วงนี้'], ['parts', 'อะไหล่ที่เปลี่ยนในช่วงนี้'], ['sign', 'ช่องลงชื่อ']];
const RP_PERIODS = [['month', 'เดือนนี้'], ['lastmonth', 'เดือนที่แล้ว'], ['quarter', 'ไตรมาสนี้'], ['year', 'ปีนี้'], ['custom', 'กำหนดเอง']];
let rpState = { key: 'lastmonth', from: '', to: '', flt: 'all', sec: { kpi: 1, chart: 1, tech: 1, overdue: 1, urgent: 1, done: 1, parts: 0, sign: 1 } };
try { const sv = JSON.parse(localStorage.getItem('c2tech_report_opts') || 'null'); if (sv && sv.sec) rpState = Object.assign(rpState, { key: sv.key || rpState.key, flt: sv.flt || 'all', sec: Object.assign(rpState.sec, sv.sec) }); } catch (e) { }
function rpSave() { try { localStorage.setItem('c2tech_report_opts', JSON.stringify({ key: rpState.key, flt: rpState.flt, sec: rpState.sec })); } catch (e) { } }

async function openReportModal() {
    if (!isAdmin) { Swal.fire({ icon: 'warning', title: 'สำหรับ Admin เท่านั้น' }); return; }
    const el = dbPageEl('rpPage');
    el.classList.add('rp');
    el.hidden = false;
    document.body.classList.add('um-on');
    try { history.pushState({ rp: true }, ''); } catch (e) { }
    if (rpState.key === 'custom' && !rpState.from) { const [f, t] = dbPeriodRange('lastmonth'); rpState.from = dbIso(f); rpState.to = dbIso(t); }
    rpRenderShell();
    rpUpdate();
    if (!dbExtra) { await dbLoadExtra(); if (!el.hidden) rpUpdate(); }
}
function rpClose(fromPop) {
    const el = document.getElementById('rpPage');
    if (!el || el.hidden) return;
    if (!fromPop) { try { if (history.state && history.state.rp) history.back(); } catch (e) { } }
    el.hidden = true;
    if (!document.querySelector('.um:not([hidden])')) document.body.classList.remove('um-on');
}

function rpRenderShell() {
    const el = document.getElementById('rpPage');
    el.innerHTML = `
        <header class="um-top">
            <button type="button" class="um-back" onclick="rpClose()"><i class="fas fa-chevron-left"></i> กลับ</button>
            <div class="um-title"><h2>สร้างรายงาน</h2><span>ตัวอย่างด้านขวาตรงกับที่จะพิมพ์</span></div>
        </header>
        <div class="rp-body">
            <aside class="rp-set">
                <div class="rp-grp"><h4>ช่วงเวลา</h4><div class="rp-pills" id="rpPeriods"></div>
                    <div class="rp-dr" id="rpDr"><label class="st-field"><span>ตั้งแต่</span><input type="date" id="rpFrom" onchange="rpCustom()"></label><label class="st-field"><span>ถึง</span><input type="date" id="rpTo" onchange="rpCustom()"></label></div></div>
                <div class="rp-grp"><h4>หัวข้อในรายงาน</h4><div class="rp-ck" id="rpSecs"></div></div>
                <div class="rp-grp"><h4>เครื่องที่รวม</h4><div class="rp-pills" id="rpFlt"></div></div>
                <div class="rp-acts">
                    <button type="button" class="um-btn pri" onclick="rpPrint()"><i class="fas fa-print"></i> พิมพ์ / บันทึก PDF</button>
                    <div class="rp-acts2"><button type="button" class="um-btn rp-line" onclick="rpLineImage()"><i class="fab fa-line"></i> รูปสำหรับ LINE</button><button type="button" class="um-btn" onclick="rpCsv()"><i class="fas fa-file-csv"></i> Excel (.csv)</button></div>
                </div>
            </aside>
            <section class="rp-prev" id="rpPrev"><div class="rp-paper" id="rpPaper"></div></section>
        </div>`;
}
function rpSetPeriod(k) {
    rpState.key = k;
    if (k === 'custom' && !rpState.from) { const [f, t] = dbPeriodRange('lastmonth'); rpState.from = dbIso(f); rpState.to = dbIso(t); }
    rpSave(); rpUpdate();
}
function rpCustom() { rpState.from = document.getElementById('rpFrom').value; rpState.to = document.getElementById('rpTo').value; rpUpdate(); }
function rpToggle(k) { rpState.sec[k] = rpState.sec[k] ? 0 : 1; rpSave(); rpUpdate(); }
function rpSetFlt(f) { rpState.flt = f; rpSave(); rpUpdate(); }

function rpRange() { return dbPeriodRange(rpState.key, rpState.from, rpState.to); }

function rpUpdate() {
    const [from, to] = rpRange();
    if (rpState.key !== 'custom') { rpState.from = dbIso(from); rpState.to = dbIso(to); }
    const R = dbCompute(from, to, rpState.flt);
    document.getElementById('rpPeriods').innerHTML = RP_PERIODS.map(([k, l]) => `<button type="button" class="${rpState.key === k ? 'on' : ''}" onclick="rpSetPeriod('${k}')">${l}</button>`).join('');
    document.getElementById('rpFrom').value = rpState.from; document.getElementById('rpTo').value = rpState.to;
    document.getElementById('rpDr').classList.toggle('ro', rpState.key !== 'custom');
    document.getElementById('rpFrom').disabled = document.getElementById('rpTo').disabled = rpState.key !== 'custom';
    const cnt = { kpi: '4 ช่อง', tech: R.techs.length + ' คน', overdue: R.overdueAt.length, urgent: R.urgentAt.length, done: R.done.length, parts: dbExtra && dbExtra.ok ? R.parts.length : '…' };
    document.getElementById('rpSecs').innerHTML = RP_SECTIONS.map(([k, l]) => `<label class="rp-ckl"><input type="checkbox" ${rpState.sec[k] ? 'checked' : ''} onchange="rpToggle('${k}')"><i></i><span>${l}</span>${cnt[k] !== undefined ? `<small>${cnt[k]}</small>` : ''}</label>`).join('');
    document.getElementById('rpFlt').innerHTML = [['all', 'ทุกเครื่อง'], ['Lab', 'Lab'], ['Real-time', 'Real-time'], ['renew', 'ต่อรายปี']].map(([k, l]) => `<button type="button" class="${rpState.flt === k ? 'on' : ''}" onclick="rpSetFlt('${k}')">${l}</button>`).join('');
    document.getElementById('rpPaper').innerHTML = rpDocHtml(R);
    document.getElementById('rpPage')._R = R;
    rpFit();
}
// ตัวอย่างเป็นกระดาษ A4 กว้างจริง (794px) แล้วย่อให้พอดีจอ — หน้าตาเหมือนตอนพิมพ์ทุกขนาดจอ
function rpFit() {
    const prev = document.getElementById('rpPrev'), paper = document.getElementById('rpPaper');
    if (!prev || !paper) return;
    const cs = getComputedStyle(prev);
    const avail = prev.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    paper.style.zoom = Math.min(1, Math.max(0.3, avail / 794)).toFixed(3);
}
window.addEventListener('resize', () => { const r = document.getElementById('rpPage'); if (r && !r.hidden) rpFit(); });

function rpFltLabel(f) { return f === 'all' ? '' : f === 'renew' ? 'เฉพาะเครื่องต่อรายปี' : 'เฉพาะ ' + f; }

// เนื้อหารายงาน (ใช้ทั้งตัวอย่างและตอนพิมพ์)
function rpDocHtml(R) {
    const S = rpState.sec;
    const asOfTxt = stDate(R.asOf);
    const by = currentUser ? escapeHtml(currentUser.name) : '';
    const tbl = (head, rows, empty) => `<table class="rp-t"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${head.length}" class="rp-none">${empty}</td></tr>`}</tbody></table>`;
    // กราฟในรายงาน: 6 ช่วงล่าสุดของช่วงที่เลือก (ถ้าช่วงสั้น ใช้ 6 เดือนย้อนหลังถึงวันสิ้นสุด)
    let chartB = R.buckets;
    if (R.buckets.length < 4) {
        const f6 = new Date(R.to.getFullYear(), R.to.getMonth() - 5, 1);
        chartB = dbCompute(f6, R.to, R.flt).buckets;
    }
    chartB = chartB.slice(-12);
    let h = `<div class="rp-hd"><img src="icons/icon-192.png" alt=""><div><h1>รายงานสรุปงาน PM</h1><small>Service Tracker · บริษัท ซีทูเทค จำกัด</small></div>
        <div class="rp-hr">ช่วง ${escapeHtml(dbFmtRange(R.from, R.to))}${rpFltLabel(R.flt) ? '<br>' + escapeHtml(rpFltLabel(R.flt)) : ''}<br>ออกรายงาน ${stDate(new Date())}${by ? ' · โดย ' + by : ''}</div></div>`;
    if (S.kpi) h += `<div class="rp-kp"><div><b class="ok">${R.done.length}</b><span>PM ทำเสร็จ</span></div><div><b>${dbPct(R.onTime, R.withPlan)}</b><span>ตรงเวลา (${R.onTime}/${R.withPlan}) ภายใน ${DB_GRACE_DAYS} วัน</span></div><div><b class="red">${R.overdueAt.length}</b><span>เลยกำหนด ณ ${asOfTxt}</span></div><div><b class="amb">${R.urgentAt.length}</b><span>ใกล้กำหนด 7 วัน</span></div></div>`;
    if (S.chart) h += `<h5>ครบกำหนด vs ทำเสร็จ</h5><div class="rp-chart">${dbBarsHtml(chartB, true)}<div class="db-leg"><span><i class="p"></i>ครบกำหนด</span><span><i class="d"></i>ทำเสร็จ</span></div></div>`;
    if (S.tech) h += `<h5>ผลงานรายช่าง</h5>` + tbl(['ช่าง', 'งาน', 'ตรงเวลา', 'เฉลี่ยเทียบวันนัด'], R.techs.map(t => `<tr><td>${escapeHtml(t.tech)}</td><td class="n">${t.count}</td><td class="n">${dbPct(t.onTime, t.planned)}</td><td class="n">${dbDelayTxt(t.planned ? t.delaySum / t.planned : null)}</td></tr>`), 'ไม่มีงานในช่วงนี้');
    if (S.overdue) h += `<h5>เครื่องที่เลยกำหนด ณ ${asOfTxt} (${R.overdueAt.length})</h5>` + tbl(['ลูกค้า', 'จังหวัด', 'S/N', 'รอบ', 'วันนัด', 'เลยมา'], R.overdueAt.map(o => `<tr><td>${stWords(o.m.client)}</td><td>${escapeHtml(o.m.location)}</td><td class="sn">${escapeHtml(o.m.sn)}</td><td>${o.round}</td><td class="n">${stDate(o.planned)}</td><td class="n red">${o.days} วัน</td></tr>`), 'ไม่มีเครื่องเลยกำหนด');
    if (S.urgent) h += `<h5>ใกล้กำหนดภายใน 7 วัน (${R.urgentAt.length})</h5>` + tbl(['ลูกค้า', 'จังหวัด', 'S/N', 'รอบ', 'วันนัด'], R.urgentAt.map(o => `<tr><td>${stWords(o.m.client)}</td><td>${escapeHtml(o.m.location)}</td><td class="sn">${escapeHtml(o.m.sn)}</td><td>${o.round}</td><td class="n">${stDate(o.planned)}</td></tr>`), 'ไม่มี');
    if (S.done) h += `<h5>PM ที่ทำเสร็จในช่วงนี้ (${R.done.length})</h5>` + tbl(['วันที่ทำ', 'ลูกค้า', 'S/N', 'รอบ', 'ช่าง', 'เทียบวันนัด'], R.done.map(e => `<tr><td class="n">${stDate(e.done)}</td><td>${stWords(e.m.client)}</td><td class="sn">${escapeHtml(e.sn)}</td><td>${e.round}</td><td>${escapeHtml(e.tech || '-')}</td><td class="n${e.onTime === false ? ' red' : ''}">${dbDelayTxt(e.delay)}</td></tr>`), 'ไม่มีงานในช่วงนี้');
    if (S.parts) h += `<h5>อะไหล่ที่เปลี่ยนในช่วงนี้ (${R.parts.length})</h5>` + (dbExtra && dbExtra.ok ? tbl(['วันที่', 'ลูกค้า', 'S/N', 'รอบ', 'อะไหล่', 'จำนวน', 'ผู้บันทึก'], R.parts.map(p => `<tr><td class="n">${stDate(p.t)}</td><td>${stWords(p.m ? p.m.client : '-')}</td><td class="sn">${escapeHtml(p.sn)}</td><td>${escapeHtml(p.round)}</td><td>${stWords(p.name)}</td><td class="n">${escapeHtml(p.qty)}</td><td>${escapeHtml(p.tech || '-')}</td></tr>`), 'ไม่มีการเปลี่ยนอะไหล่ในช่วงนี้') : `<p class="rp-none">${dbExtra === null ? 'กำลังโหลดรายการอะไหล่...' : 'โหลดรายการอะไหล่ไม่ได้ (อัปเดต Code.gs ก่อน)'}</p>`);
    if (S.sign) h += `<div class="rp-sig"><div>ผู้จัดทำรายงาน</div><div>ผู้รับทราบ</div></div>`;
    return h;
}

function rpPrint() {
    const R = document.getElementById('rpPage')._R;
    const area = document.getElementById('printReportArea');
    area.innerHTML = `<div class="rp-paper rp-print">${rpDocHtml(R)}</div>`;
    document.body.classList.add('rp-printing');
    const done = () => { document.body.classList.remove('rp-printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { window.print(); setTimeout(done, 1500); }, 250);
}

function rpCsv() {
    const R = document.getElementById('rpPage')._R;
    const q = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const d = x => x ? dbIso(x) : '';
    const lines = [];
    const add = arr => lines.push(arr.map(q).join(','));
    add(['รายงานสรุปงาน PM', dbFmtRange(R.from, R.to), rpFltLabel(R.flt)]);
    add([]);
    add(['ส่วน', 'วันที่ทำ', 'วันนัด', 'เทียบวันนัด (วัน)', 'ลูกค้า', 'จังหวัด', 'S/N', 'รอบ', 'ช่าง', 'อะไหล่', 'จำนวน']);
    R.done.forEach(e => add(['PM ที่ทำเสร็จ', d(e.done), d(e.planned), e.delay === null ? '' : e.delay, e.m.client, e.m.location, e.sn, e.round, e.tech, '', '']));
    R.overdueAt.forEach(o => add(['เลยกำหนด', '', d(o.planned), o.days, o.m.client, o.m.location, o.m.sn, o.round, '', '', '']));
    R.urgentAt.forEach(o => add(['ใกล้กำหนด', '', d(o.planned), '', o.m.client, o.m.location, o.m.sn, o.round, '', '', '']));
    if (rpState.sec.parts) R.parts.forEach(p => add(['อะไหล่', d(p.t), '', '', p.m ? p.m.client : '', p.m ? p.m.location : '', p.sn, p.round, p.tech, p.name, p.qty]));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }); // BOM ให้ Excel อ่านภาษาไทยได้
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `service_report_${rpState.from}_${rpState.to}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function rpLineImage() {
    const R = document.getElementById('rpPage')._R;
    const top = R.techs.slice(0, 3);
    const urgentList = R.overdueAt.slice(0, 3);
    const card = document.createElement('div');
    card.className = 'rp-linewrap';
    card.innerHTML = `<div id="lineImageCard" class="rp-line">
        <div class="h"><img src="icons/icon-192.png" alt=""><div><b>สรุปงาน PM · ${escapeHtml(dbFmtRange(R.from, R.to))}</b><small>Service Tracker${rpFltLabel(R.flt) ? ' · ' + escapeHtml(rpFltLabel(R.flt)) : ''}</small></div></div>
        <div class="big"><b>${R.done.length}</b><span>งาน PM ทำเสร็จ<br>ตรงเวลา ${dbPct(R.onTime, R.withPlan)}</span></div>
        <div class="g3"><div><b class="red">${R.overdueAt.length}</b><span>เลยกำหนด</span></div><div><b class="amb">${R.urgentAt.length}</b><span>ใกล้กำหนด</span></div><div><b>${R.renewed}</b><span>ต่อรายปี</span></div></div>
        ${top.length ? `<div class="sb"><h6>ผลงานช่าง</h6>${top.map(t => `<div class="lr"><span>${escapeHtml(t.tech)}</span><b>${t.count} งาน</b></div>`).join('')}</div>` : ''}
        ${urgentList.length ? `<div class="sb"><h6>ต้องตามด่วน</h6>${urgentList.map(o => `<div class="lr r"><span>${escapeHtml(o.m.client)} · ${o.round}</span><b>เลย ${o.days} วัน</b></div>`).join('')}${R.overdueAt.length > 3 ? `<div class="lr more">+ อีก ${R.overdueAt.length - 3} เครื่อง</div>` : ''}</div>` : ''}
        <div class="ft">C2TECH SERVICE TRACKER · ออกเมื่อ ${stDate(new Date())}</div></div>`;
    document.body.appendChild(card);
    Swal.fire({ title: 'กำลังสร้างรูป...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    const wait = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    const snap = () => html2canvas(document.getElementById('lineImageCard'), { scale: 2, backgroundColor: null, useCORS: true }).then(c => c.toDataURL('image/png'));
    // ถ้ารูปโลโก้ทำให้ส่งออกไม่ได้ (เช่นเปิดจากไฟล์ในเครื่อง) ลองใหม่โดยไม่ใส่โลโก้
    wait.then(snap).catch(() => { const im = card.querySelector('img'); if (im) im.remove(); return snap(); }).then(imgUrl => {
        card.remove();
        Swal.fire({
            title: 'รูปสรุปสำหรับ LINE',
            html: `<img src="${imgUrl}" alt="รูปสรุป" style="width:100%;max-width:360px;border-radius:14px;box-shadow:0 4px 14px rgba(0,0,0,0.15);">`,
            confirmButtonText: '<i class="fas fa-download"></i> ดาวน์โหลดรูป', confirmButtonColor: '#22392b',
            showCancelButton: true, cancelButtonText: 'ปิด'
        }).then(r => {
            if (!r.isConfirmed) return;
            const link = document.createElement('a');
            link.href = imgUrl; link.download = `service_summary_${rpState.from}_${rpState.to}.png`; link.click();
        });
    }).catch(err => { card.remove(); Swal.fire('Error', 'สร้างรูปไม่สำเร็จ: ' + err.message, 'error'); });
}

// ข้อมูลเครื่องโหลดใหม่ → อัปเดตหน้าที่เปิดอยู่
function dbRefreshOpen() {
    const d = document.getElementById('dbPage'); if (d && !d.hidden) dbRender();
    const r = document.getElementById('rpPage'); if (r && !r.hidden) rpUpdate();
}

/* =========================================================================================
   v5 — แผ่นเลื่อน (sheet) กลาง, กล้อง, ปิดงาน PM, อะไหล่, โปรไฟล์, ประวัติ, Admin ยกเลิกปิดงาน/เปลี่ยนรูป
========================================================================================= */
let stSheetZ = 2100;
// แผ่นเลื่อนขึ้นจากด้านล่าง (มือถือ) / หน้าต่างกลางจอ (PC) — ใช้ร่วมทุกฟีเจอร์ใหม่
function stSheet(html, opts = {}) {
    const ov = document.createElement('div');
    ov.className = 'ss-ov';
    ov.style.zIndex = ++stSheetZ;
    ov.innerHTML = `<div class="ss${opts.wide ? ' wide' : ''}" role="dialog" aria-modal="true"><span class="ss-grab" aria-hidden="true"></span><div class="ss-in"></div></div>`;
    const box = ov.querySelector('.ss-in');
    box.innerHTML = html;
    document.body.appendChild(ov);
    document.body.classList.add('st-lock');
    requestAnimationFrame(() => ov.classList.add('open'));
    const api = {
        el: box, ov,
        set(h) { box.innerHTML = h; },
        close(val) {
            if (api.closed) return; api.closed = true;
            document.removeEventListener('keydown', onKey);
            ov.classList.remove('open');
            setTimeout(() => { ov.remove(); if (!document.querySelector('.ss-ov') && !document.getElementById('stDetailWrap').classList.contains('open')) document.body.classList.remove('st-lock'); }, 200);
            if (opts.onClose) opts.onClose(val);
        }
    };
    const onKey = e => { if (e.key === 'Escape' && !opts.lock && ov === [...document.querySelectorAll('.ss-ov')].pop()) api.close(); };
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', e => { if (e.target === ov && !opts.lock) api.close(); });
    return api;
}

async function stApi(body) {
    const res = await stFetch(SCRIPT_URL, { method: 'POST', body: stBody(body), headers: { "Content-Type": "text/plain;charset=utf-8" } });
    return res.json();
}

// เมนูเล็กลอยข้างปุ่ม ⋯
function stPop(ev, items) {
    ev.stopPropagation();
    document.querySelectorAll('.st-pop').forEach(p => p.remove());
    const r = ev.currentTarget.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.className = 'st-pop';
    pop.innerHTML = items.map((it, i) => `<button type="button" data-i="${i}" class="${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}><i class="fas ${it.icon}"></i><span>${escapeHtml(it.label)}${it.hint ? `<small>${escapeHtml(it.hint)}</small>` : ''}</span></button>`).join('');
    document.body.appendChild(pop);
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
    pop.style.top = (r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
    const off = e => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', off, true); } };
    setTimeout(() => document.addEventListener('click', off, true), 0);
    pop.querySelectorAll('button').forEach(b => b.onclick = () => { pop.remove(); document.removeEventListener('click', off, true); items[+b.dataset.i].run(); });
}

function stTimeShort(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return '';
    const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const diff = stDiffDays(d);
    return diff === 0 ? 'วันนี้ ' + hm : diff === -1 ? 'เมื่อวาน ' + hm : stDate(d);
}
function stAddMonths(d, n) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
function stFindMachine(sn) { return stMachines.find(m2 => m2.sn === sn) || appData.map(stCompute).filter(Boolean).find(m2 => m2.sn === sn); }

/* ---------- กล้องถ่ายรูป (เต็มจอ) ---------- */
// upload(dataUrl) → Promise (throw เมื่อส่งไม่สำเร็จ) · คืนค่า true เมื่อส่งสำเร็จ / null เมื่อปิด
function stCamera(opts) {
    return new Promise(resolve => {
        const el = document.createElement('div');
        el.className = 'cam2';
        el.innerHTML = `
            <div class="cam2-top"><button type="button" class="cam2-x" aria-label="ปิด"><i class="fas fa-xmark"></i> ปิด</button><span>${escapeHtml(opts.title || '')}</span></div>
            <div class="cam2-view"><video playsinline muted autoplay></video><img alt="รูปที่ถ่าย" hidden><div class="cam2-guide">${escapeHtml(opts.hint || 'ให้เห็นตัวเครื่องและป้าย S/N')}</div><div class="cam2-msg" hidden></div></div>
            <div class="cam2-bot">
                <div class="cam2-shoot"><label class="cam2-side"><i class="fas fa-images"></i><span>อัลบั้ม</span><input type="file" accept="image/*" hidden></label>
                    <button type="button" class="cam2-shut" aria-label="ถ่ายรูป"><i></i></button>
                    <button type="button" class="cam2-side cam2-flip"><i class="fas fa-camera-rotate"></i><span>สลับกล้อง</span></button></div>
                <div class="cam2-review" hidden><div class="cam2-st"></div><div class="cam2-bar" hidden><i></i></div>
                    <div class="cam2-btns"><button type="button" class="cam2-b ghost cam2-retake"><i class="fas fa-rotate-left"></i> ถ่ายใหม่</button><button type="button" class="cam2-b cam2-use"><i class="fas fa-check"></i> ใช้รูปนี้</button></div></div>
            </div>`;
        document.body.appendChild(el);
        document.body.classList.add('st-lock');
        const $ = s => el.querySelector(s);
        const video = $('video'), img = $('img');
        let stream = null, facing = 'environment', shot = null, busy = false;
        const stop = () => { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } };
        const finish = v => { stop(); el.remove(); if (!document.querySelector('.ss-ov') && !document.getElementById('stDetailWrap').classList.contains('open')) document.body.classList.remove('st-lock'); resolve(v); };
        const msg = t => { const m = $('.cam2-msg'); m.hidden = !t; m.innerHTML = t || ''; };
        async function start() {
            stop(); msg('');
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { noCam(); return; }
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1600 } }, audio: false });
                video.srcObject = stream; video.hidden = false;
            } catch (e) { noCam(); }
        }
        function noCam() {
            video.hidden = true;
            msg('<i class="fas fa-camera-slash"></i><b>เปิดกล้องในแอปไม่ได้</b><span>ใช้ปุ่ม "อัลบั้ม" ด้านล่างเพื่อถ่ายหรือเลือกรูปแทน</span>');
            $('.cam2-shut').disabled = true;
        }
        function review(dataUrl) {
            shot = dataUrl; img.src = dataUrl; img.hidden = false; video.hidden = true; $('.cam2-guide').hidden = true; msg('');
            $('.cam2-shoot').hidden = true; $('.cam2-review').hidden = false; $('.cam2-st').innerText = ''; $('.cam2-bar').hidden = true;
            $('.cam2-use').disabled = false; $('.cam2-use').innerHTML = '<i class="fas fa-check"></i> ใช้รูปนี้';
            if (stream) video.pause();
        }
        $('.cam2-x').onclick = () => { if (!busy) finish(null); };
        $('.cam2-flip').onclick = () => { facing = facing === 'environment' ? 'user' : 'environment'; start(); };
        $('.cam2-shut').onclick = () => {
            const c = document.createElement('canvas');
            c.width = video.videoWidth || 1280; c.height = video.videoHeight || 960;
            c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
            review(c.toDataURL('image/jpeg', 0.88));
        };
        $('input[type=file]').onchange = async e => { const f = e.target.files && e.target.files[0]; if (f) review(await readFileAsDataUrl(f)); e.target.value = ''; };
        $('.cam2-retake').onclick = () => {
            if (busy) return;
            shot = null; img.hidden = true; $('.cam2-guide').hidden = false; $('.cam2-shoot').hidden = false; $('.cam2-review').hidden = true;
            if (stream) { video.hidden = false; video.play(); } else start();
        };
        $('.cam2-use').onclick = async () => {
            if (busy || !shot) return;
            busy = true;
            const btn = $('.cam2-use'); btn.disabled = true; $('.cam2-retake').disabled = true;
            $('.cam2-bar').hidden = false;
            try {
                $('.cam2-st').innerText = 'กำลังย่อรูป...';
                const small = await resizeImageDataUrl(shot, 1000, 0.7);
                const kb = Math.round(small.length * 0.75 / 1024);
                $('.cam2-st').innerText = `กำลังส่งรูป ${kb} KB...`;
                btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> กำลังส่ง';
                await opts.upload(small);
                busy = false;
                finish(true);
            } catch (err) {
                busy = false;
                $('.cam2-bar').hidden = true;
                $('.cam2-st').innerHTML = `<span class="err"><i class="fas fa-triangle-exclamation"></i> ส่งไม่สำเร็จ: ${escapeHtml(err.message || 'เชื่อมต่อไม่ได้')} · รูปยังอยู่ กดส่งอีกครั้งได้</span>`;
                btn.disabled = false; $('.cam2-retake').disabled = false;
                btn.innerHTML = '<i class="fas fa-rotate-right"></i> ส่งอีกครั้ง';
            }
        };
        start();
    });
}

async function stPostPhoto(sn, pmStep, img) {
    const j = await stApi({ sn, action: 'photo', pmStep, image: img, fileName: `PM_IMG_${sn}_${pmStep}_${Date.now()}.jpg` });
    if (j.status !== 'success') throw new Error(j.message || 'อัปโหลดไม่สำเร็จ');
    return j;
}

async function capturePhotoForStep(sn, pmStep) {
    if (!stGuard()) return;
    const x = stFindMachine(sn);
    const ok = await stCamera({ title: `${pmStep} · ${x ? x.client : sn}`, upload: img => stPostPhoto(sn, pmStep, img) });
    if (ok) { Toast.fire({ icon: 'success', title: 'อัปโหลดรูปแล้ว' }); loadData(true); }
}

// ทางสำรอง: เลือกไฟล์จากปุ่มเดิม (กรณีเปิดกล้องในแอปไม่ได้เลย)
async function uploadImageForStep(sn, pmStep, rawDataUrlOrFile) {
    if (!stGuard()) return;
    Swal.fire({ title: 'กำลังส่งรูป...', html: '<div class="sw-bar"><i></i></div>', allowOutsideClick: false, showConfirmButton: false });
    try {
        const raw = (rawDataUrlOrFile instanceof File) ? await readFileAsDataUrl(rawDataUrlOrFile) : rawDataUrlOrFile;
        await stPostPhoto(sn, pmStep, await resizeImageDataUrl(raw, 1000, 0.7));
        Swal.close();
        Toast.fire({ icon: 'success', title: 'อัปโหลดรูปแล้ว' });
        loadData(true);
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'อัปโหลดไม่สำเร็จ', text: err.message || 'กรุณาลองใหม่อีกครั้ง' });
    }
}

/* ---------- ปิดงาน PM (แผ่นเลื่อน) ---------- */
function stGpsTips() {
    return `<div class="cp-tips">
        <div class="cp-row"><i class="w">1</i><span><b>เปิด Location ของมือถือ</b><small>และอนุญาตให้เว็บนี้ใช้ตำแหน่ง (ตั้งค่าเบราว์เซอร์ › สิทธิ์ของเว็บไซต์)</small></span></div>
        <div class="cp-row"><i class="w">2</i><span><b>ออกไปที่โล่ง หรือใกล้หน้าต่าง</b><small>ในอาคารโรงสีสัญญาณมักอ่อน</small></span></div>
        <div class="cp-row"><i class="w">3</i><span><b>เปิด Wi-Fi หรือเน็ตมือถือไว้</b><small>ช่วยให้หาตำแหน่งได้เร็วขึ้น</small></span></div></div>`;
}

async function stOpenClose(sn, key) {
    if (!stGuard()) return;
    const x = stFindMachine(sn);
    const idx = +key.slice(2);
    const st = x && x.steps.find(s2 => s2.idx === idx);
    if (!st) return;
    if (!partsCache[sn]) loadPartsForMachine(sn).then(() => paint());
    let gps = null, gpsErr = null, watch = null, timer = null, saving = false, done = null;
    const sh = stSheet('', { lock: false, onClose: () => { if (watch !== null) navigator.geolocation.clearWatch(watch); clearTimeout(timer); } });

    function partsInfo() {
        const list = (partsCache[sn] && partsCache[sn][key]) || null;
        if (!list) return 'กำลังโหลด...';
        if (!list.length) return 'ไม่มี (ไม่บังคับ)';
        return `${list.length} รายการ · ${list.reduce((s, p) => s + (+p.qty || 1), 0)} ชิ้น`;
    }
    function paint() {
        if (sh.closed) return;
        if (done) {
            const next = idx < 3 ? stAddMonths(new Date(), 4) : null;
            sh.set(`<div class="cp-ok"><span class="cp-big"><i class="fas fa-check"></i></span><h3>ปิดงาน ${key} แล้ว</h3>
                <p>${stTimeShort(done.time)}${done.acc ? ` · GPS ±${done.acc} ม.` : ''}${next ? `<br>นัด PM${idx + 1} ครั้งถัดไปประมาณ ${stDate(next)}` : '<br>ครบ 3 รอบของสัญญานี้แล้ว'}</p>
                <button type="button" class="ss-btn line" id="cpSlip"><i class="fab fa-line"></i> สร้างรูปยืนยันงานส่ง LINE</button>
                <button type="button" class="ss-btn ghost" id="cpDone">เสร็จ</button></div>`);
            sh.el.querySelector('#cpSlip').onclick = () => { sh.close(); printServiceSlip(sn, idx); };
            sh.el.querySelector('#cpDone').onclick = () => sh.close();
            return;
        }
        if (gpsErr) {
            sh.set(`<h3 class="ss-h">ยังหาตำแหน่งไม่ได้</h3><p class="ss-sub">${escapeHtml(gpsErr)}<br>ระบบต้องมีตำแหน่ง GPS ถึงจะปิดงานได้</p>${stGpsTips()}
                <button type="button" class="ss-btn pri" id="cpRetry"><i class="fas fa-location-crosshairs"></i> ลองหาตำแหน่งอีกครั้ง</button>
                <button type="button" class="ss-btn ghost" id="cpCancel">ยกเลิก</button>`);
            sh.el.querySelector('#cpRetry').onclick = () => { gpsErr = null; startGps(); paint(); };
            sh.el.querySelector('#cpCancel').onclick = () => sh.close();
            return;
        }
        const gpsTxt = gps ? `ได้ตำแหน่งแล้ว ±${gps.acc} ม.` : (gps === null && watch !== null ? 'กำลังหาตำแหน่ง...' : 'กำลังขอสิทธิ์ใช้ตำแหน่ง...');
        sh.set(`<h3 class="ss-h">ปิดงาน ${key}</h3><p class="ss-sub">${stWords(x.client)} · บันทึกในนาม <b>${escapeHtml(currentUser.name)}</b></p>
            <div class="cp-row"><i class="${st.photo ? 'y' : 'w'}">${st.photo ? '✓' : '!'}</i><span><b>รูปหน้างาน</b><small>${st.photo ? 'แนบแล้ว' : 'ยังไม่มีรูป'}</small></span>${st.photo ? `<a href="${escapeHtml(st.photo)}" target="_blank" rel="noopener">ดูรูป</a>` : ''}</div>
            <div class="cp-row"><i class="y">✓</i><span><b>อะไหล่ที่เปลี่ยน</b><small id="cpParts">${partsInfo()}</small></span><button type="button" class="cp-link" id="cpEditParts">${(partsCache[sn] && (partsCache[sn][key] || []).length) ? 'แก้' : 'เพิ่ม'}</button></div>
            <div class="cp-row"><i class="${gps ? 'y' : 's'}">${gps ? '✓' : '<span class="fas fa-location-crosshairs"></span>'}</i><span class="grow"><b>ตำแหน่ง GPS</b><small>${gpsTxt}${gps && gps.acc > 100 ? ' (ไม่ค่อยแม่น แต่ใช้ได้)' : ''}</small>${gps ? '' : '<span class="cp-bar"><em></em></span>'}</span></div>
            <button type="button" class="ss-btn pri" id="cpGo" ${gps && st.photo && !saving ? '' : 'disabled'}>${saving ? '<i class="fas fa-circle-notch fa-spin"></i> กำลังบันทึก...' : gps ? `<i class="fas fa-check"></i> ยืนยันปิดงาน ${key}` : 'รอตำแหน่ง GPS...'}</button>
            <button type="button" class="ss-btn ghost" id="cpCancel" ${saving ? 'disabled' : ''}>ยกเลิก</button>`);
        sh.el.querySelector('#cpCancel').onclick = () => sh.close();
        sh.el.querySelector('#cpEditParts').onclick = () => stPartsPicker(sn, key, () => paint());
        sh.el.querySelector('#cpGo').onclick = save;
    }
    function accept(pos) {
        const acc = Math.round(pos.coords.accuracy || 0);
        if (!gps || acc < gps.acc) gps = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc };
        if (gps.acc <= 50 && watch !== null) { navigator.geolocation.clearWatch(watch); watch = -1; clearTimeout(timer); }
        paint();
    }
    function startGps() {
        gps = null;
        if (!navigator.geolocation) { gpsErr = 'เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง'; paint(); return; }
        watch = navigator.geolocation.watchPosition(accept, err => {
            if (err.code === 1) { navigator.geolocation.clearWatch(watch); watch = null; clearTimeout(timer); gpsErr = 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง'; paint(); }
        }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 });
        clearTimeout(timer);
        // 20 วินาทียังไม่ได้เลย → ลองแบบเร็ว (Wi-Fi/เครือข่าย) อีกครั้ง ก่อนบอกว่าหาไม่ได้
        timer = setTimeout(() => {
            if (gps) return;
            navigator.geolocation.getCurrentPosition(accept, () => { if (!gps) { if (watch !== null && watch >= 0) navigator.geolocation.clearWatch(watch); watch = null; gpsErr = 'หาตำแหน่งไม่ได้ (สัญญาณ GPS ไม่พอ)'; paint(); } }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 });
        }, 20000);
    }
    async function save() {
        if (saving || !gps) return;
        saving = true; paint();
        if (watch !== null && watch >= 0) navigator.geolocation.clearWatch(watch);
        clearTimeout(timer);
        try {
            const logTime = new Date().toISOString();
            const j = await stApi({ sn, action: 'complete_pm', pmStep: key, gps: `https://maps.google.com/?q=${gps.lat},${gps.lng}`, techName: currentUser.name, logTime });
            if (j.status !== 'success') throw new Error(j.message || 'บันทึกไม่สำเร็จ');
            done = { time: logTime, acc: gps.acc };
            saving = false; paint();
            loadData(true);
        } catch (e) {
            saving = false; paint();
            Swal.fire({ icon: 'error', title: 'ปิดงานไม่สำเร็จ', text: e.message || 'กรุณาลองใหม่อีกครั้ง' });
        }
    }
    startGps();
    paint();
}
// ชื่อเดิม (ปุ่มของเวอร์ชันก่อน)
async function handleCheck(box, sn, stepKey) { if (box) box.checked = false; stOpenClose(sn, stepKey); }

/* ---------- อะไหล่: เลือกหลายรายการ + ตะกร้า ---------- */
let stPartNames = null;
async function stLoadPartNames() {
    if (stPartNames) return stPartNames;
    try { const j = await stApi({ action: 'get_part_names' }); stPartNames = j.status === 'success' ? (j.names || []) : []; } catch (e) { stPartNames = []; }
    return stPartNames;
}
function stPartsPicker(sn, key, after) {
    if (!stGuard()) return;
    const x = stFindMachine(sn);
    const basket = new Map(); // name → { qty, note, noteOpen }
    let q = '', saving = false;
    const sh = stSheet('', { wide: true });
    const all = () => {
        const freq = (stPartNames || []);
        const set = new Map();
        COMMON_PARTS.forEach(n => set.set(n, 0));
        freq.forEach(f => set.set(f.name, f.count));
        return [...set.entries()].map(([name, count]) => ({ name, count }));
    };
    function chip(n) {
        const b = basket.get(n);
        return `<button type="button" class="pp-chip${b ? ' on' : ''}" data-n="${escapeHtml(n)}">${stWords(n)}${b ? `<span class="c">${b.qty}</span>` : ''}</button>`;
    }
    function paint() {
        const list = all();
        const qq = q.trim().toLowerCase();
        let body = '';
        if (qq) {
            const hits = list.filter(p => p.name.toLowerCase().includes(qq)).sort((a, b) => b.count - a.count);
            const exact = list.some(p => p.name.toLowerCase() === qq);
            body = `<div class="pp-lab">ผลการค้นหา</div><div class="pp-chips">${hits.map(p => chip(p.name)).join('')}${exact ? '' : `<button type="button" class="pp-chip new" data-new="1"><i class="fas fa-plus"></i> เพิ่ม "${escapeHtml(q.trim())}" เป็นชื่อใหม่</button>`}</div>`;
        } else {
            const top = list.filter(p => p.count > 0).sort((a, b) => b.count - a.count).slice(0, 8);
            const rest = list.filter(p => !top.includes(p)).sort((a, b) => a.name.localeCompare(b.name, 'th'));
            body = (top.length ? `<div class="pp-lab">ใช้บ่อย <em>จากที่ช่างบันทึกไว้</em></div><div class="pp-chips">${top.map(p => chip(p.name)).join('')}</div>` : '') +
                `<div class="pp-lab">อะไหล่ทั้งหมด${stPartNames === null ? ' <em>กำลังโหลดรายการ...</em>' : ''}</div><div class="pp-chips">${rest.map(p => chip(p.name)).join('')}</div>`;
        }
        const items = [...basket.entries()];
        const total = items.reduce((s, [, v]) => s + v.qty, 0);
        const bask = items.length ? items.map(([n, v]) => `<div class="pp-bi" data-n="${escapeHtml(n)}"><div class="nm"><b>${stWords(n)}</b>${v.noteOpen ? `<input class="pp-note" maxlength="200" placeholder="หมายเหตุ เช่น ตำแหน่งที่เปลี่ยน" value="${escapeHtml(v.note)}">` : `<button type="button" class="pp-addnote">${v.note ? escapeHtml(v.note) : '+ หมายเหตุ'}</button>`}</div>
            <div class="pp-stp"><button type="button" data-d="-1" aria-label="ลด">−</button><b>${v.qty}</b><button type="button" data-d="1" aria-label="เพิ่ม">+</button></div><button type="button" class="pp-del" aria-label="เอาออก"><i class="fas fa-xmark"></i></button></div>`).join('')
            : '<div class="pp-empty"><i class="fas fa-basket-shopping"></i> แตะชื่ออะไหล่ด้านบนเพื่อเพิ่ม · แตะซ้ำเพิ่มจำนวน</div>';
        const focusSearch = document.activeElement && document.activeElement.id === 'ppQ';
        const caret = focusSearch ? document.activeElement.selectionStart : null;
        sh.set(`<div class="pp-head"><div><h3 class="ss-h">เพิ่มอะไหล่ที่เปลี่ยน</h3><p class="ss-sub">${stWords(x ? x.client : sn)} · ${key}</p></div><button type="button" class="ss-x" aria-label="ปิด"><i class="fas fa-xmark"></i></button></div>
            <div class="pp-grid"><div class="pp-pick"><label class="pp-search"><i class="fas fa-search"></i><input id="ppQ" placeholder="ค้นหาหรือพิมพ์ชื่ออะไหล่" autocomplete="off" value="${escapeHtml(q)}"></label>${body}</div>
            <div class="pp-cart"><div class="pp-lab">ในตะกร้า · ${items.length} รายการ</div><div class="pp-bask">${bask}</div>
            <div class="pp-foot"><span>บันทึกในนาม<b>${escapeHtml(currentUser.name)}</b></span><button type="button" class="ss-btn pri" id="ppSave" ${items.length && !saving ? '' : 'disabled'}>${saving ? '<i class="fas fa-circle-notch fa-spin"></i> กำลังบันทึก...' : `บันทึก ${items.length || ''} รายการ${total > items.length ? ` (${total} ชิ้น)` : ''}`}</button></div></div></div>`);
        const el = sh.el;
        el.querySelector('.ss-x').onclick = () => { if (!basket.size || confirm('ยังไม่ได้บันทึก ต้องการปิดใช่ไหม?')) sh.close(); };
        const qi = el.querySelector('#ppQ');
        qi.oninput = () => { q = qi.value; paint(); };
        qi.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const nw = el.querySelector('.pp-chip.new') || el.querySelector('.pp-chips .pp-chip'); if (nw) nw.click(); } };
        if (focusSearch) { qi.focus(); try { qi.setSelectionRange(caret, caret); } catch (e) { } }
        el.querySelectorAll('.pp-chip').forEach(b => b.onclick = () => {
            const n = b.dataset.new ? q.trim().slice(0, 120) : b.dataset.n;
            if (!n) return;
            const v = basket.get(n);
            if (v) v.qty = Math.min(999, v.qty + 1); else basket.set(n, { qty: 1, note: '', noteOpen: false });
            if (b.dataset.new) q = '';
            paint();
        });
        el.querySelectorAll('.pp-bi').forEach(row => {
            const n = row.dataset.n, v = basket.get(n);
            row.querySelectorAll('.pp-stp button').forEach(b => b.onclick = () => { v.qty = Math.max(1, Math.min(999, v.qty + (+b.dataset.d))); paint(); });
            row.querySelector('.pp-del').onclick = () => { basket.delete(n); paint(); };
            const an = row.querySelector('.pp-addnote');
            if (an) an.onclick = () => { v.noteOpen = true; paint(); const inp = sh.el.querySelector(`.pp-bi[data-n="${CSS.escape(n)}"] .pp-note`); if (inp) inp.focus(); };
            const ni = row.querySelector('.pp-note');
            if (ni) { ni.oninput = () => { v.note = ni.value; }; ni.onblur = () => { v.noteOpen = false; setTimeout(paint, 0); }; }
        });
        el.querySelector('#ppSave').onclick = save;
    }
    async function save() {
        if (saving || !basket.size) return;
        saving = true; paint();
        const items = [...basket.entries()].map(([name, v]) => ({ name, qty: v.qty, note: v.note.trim() }));
        try {
            let saved = [];
            let j = await stApi({ action: 'log_pm_parts', sn, pmStep: key, items, techName: currentUser.name });
            if (j.status !== 'success' && /Unknown Action/i.test(j.message || '')) {
                // หลังบ้านยังเป็นเวอร์ชันเก่า: บันทึกทีละรายการ
                for (const it of items) {
                    const r = await stApi({ action: 'log_pm_part', sn, pmStep: key, partName: it.name, qty: it.qty, note: it.note, techName: currentUser.name, logTime: new Date().toISOString() });
                    if (r.status !== 'success') throw new Error(r.message || 'บันทึกไม่สำเร็จ');
                    saved.push(r.part || { logId: r.logId, name: it.name, qty: it.qty, note: it.note, tech: currentUser.name, time: new Date().toISOString(), userId: currentUser.userId });
                }
            } else if (j.status !== 'success') throw new Error(j.message || 'บันทึกไม่สำเร็จ');
            else saved = j.parts || [];
            if (!partsCache[sn]) partsCache[sn] = { PM1: [], PM2: [], PM3: [] };
            partsCache[sn][key] = (partsCache[sn][key] || []).concat(saved);
            if (stPartNames) items.forEach(it => { const f = stPartNames.find(p => p.name === it.name); if (f) f.count++; else stPartNames.push({ name: it.name, count: 1 }); });
            renderPartsChips(sn);
            sh.close();
            Toast.fire({ icon: 'success', title: `บันทึกอะไหล่ ${saved.length} รายการแล้ว` });
            if (after) after();
        } catch (e) {
            saving = false; paint();
            Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: e.message || 'กรุณาลองใหม่อีกครั้ง' });
        }
    }
    paint();
    if (!stPartNames) stLoadPartNames().then(() => { if (!sh.closed) paint(); });
    setTimeout(() => { const qi = sh.el.querySelector('#ppQ'); if (qi && window.innerWidth >= 900) qi.focus(); }, 80);
}
function openAddPartForm(sn, stepKey) { stPartsPicker(sn, stepKey); }

function stCanEditPart(p, stepDone) {
    if (isAdmin) return true;
    return stRole === 'staff' && !!p.userId && !!currentUser && String(p.userId) === String(currentUser.userId) && !stepDone;
}
function stStepDone(sn, key) {
    const x = stFindMachine(sn);
    const st = x && x.steps.find(s2 => 'PM' + s2.idx === key);
    return !!(st && st.done);
}
function buildPartsChipsHtml(sn, stepKey) {
    const list = (partsCache[sn] && partsCache[sn][stepKey]) || [];
    const done = stStepDone(sn, stepKey);
    return list.map(p => {
        const meta = [p.tech, stTimeShort(p.time), p.note].filter(Boolean).map(escapeHtml).join(' · ');
        const can = stCanEditPart(p, done) && p.logId;
        return `<div class="pt-row"><span class="pt-q">×${escapeHtml(p.qty || 1)}</span><span class="pt-nm"><b>${stWords(p.name)}</b>${meta ? `<small>${meta}</small>` : ''}</span>${can ? `<button type="button" class="pt-k" aria-label="จัดการรายการนี้" onclick="stPartMenu(event,'${escapeHtml(sn)}','${stepKey}','${escapeHtml(p.logId)}')"><i class="fas fa-ellipsis"></i></button>` : ''}</div>`;
    }).join('');
}
function stPartMenu(ev, sn, key, logId) {
    stPop(ev, [
        { icon: 'fa-pen', label: 'แก้จำนวน / หมายเหตุ', run: () => stEditPart(sn, key, logId) },
        { icon: 'fa-trash', label: 'ลบรายการนี้', danger: true, run: () => deletePart(sn, key, logId) }
    ]);
}
async function stEditPart(sn, key, logId) {
    const p = ((partsCache[sn] || {})[key] || []).find(z => String(z.logId) === String(logId));
    if (!p) return;
    let qty = +p.qty || 1;
    const r = await Swal.fire({
        title: 'แก้รายการอะไหล่',
        html: `<div class="sw-form"><b class="sw-name">${stWords(p.name)}</b>
            <div class="pp-stp big"><button type="button" id="eqM" aria-label="ลด">−</button><b id="eqV">${qty}</b><button type="button" id="eqP" aria-label="เพิ่ม">+</button></div>
            <label class="st-field"><span>หมายเหตุ</span><input id="eqN" maxlength="200" value="${escapeHtml(p.note || '')}" placeholder="ไม่บังคับ"></label></div>`,
        showCancelButton: true, confirmButtonText: 'บันทึก', cancelButtonText: 'ยกเลิก',
        didOpen: () => {
            const v = document.getElementById('eqV');
            document.getElementById('eqM').onclick = () => { qty = Math.max(1, qty - 1); v.innerText = qty; };
            document.getElementById('eqP').onclick = () => { qty = Math.min(999, qty + 1); v.innerText = qty; };
        },
        preConfirm: () => ({ qty, note: document.getElementById('eqN').value.trim() })
    });
    if (!r.isConfirmed) return;
    try {
        const j = await stApi({ action: 'update_pm_part', logId, qty: r.value.qty, note: r.value.note });
        if (j.status !== 'success') throw new Error(j.message || 'บันทึกไม่สำเร็จ');
        Object.assign(p, { qty: r.value.qty, note: r.value.note });
        renderPartsChips(sn);
        Toast.fire({ icon: 'success', title: 'แก้รายการแล้ว' });
    } catch (e) { Swal.fire({ icon: 'error', title: 'แก้ไม่สำเร็จ', text: e.message }); }
}
async function deletePart(sn, key, logId) {
    const p = ((partsCache[sn] || {})[key] || []).find(z => String(z.logId) === String(logId));
    if (!p) return;
    const c = await Swal.fire({
        icon: 'warning', title: 'ลบรายการอะไหล่นี้?',
        html: `${stWords(p.name)} ×${escapeHtml(p.qty || 1)} · ${key}<br><small>ลบแล้วจะบันทึกไว้ในประวัติการแก้ไข</small>`,
        showCancelButton: true, confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#c8302f', reverseButtons: true
    });
    if (!c.isConfirmed) return;
    try {
        const j = await stApi({ action: 'delete_pm_part', logId });
        if (j.status !== 'success') throw new Error(j.message || 'ลบไม่สำเร็จ');
        partsCache[sn][key] = (partsCache[sn][key] || []).filter(z => String(z.logId) !== String(logId));
        renderPartsChips(sn);
        Toast.fire({ icon: 'success', title: 'ลบรายการแล้ว' });
    } catch (e) { Swal.fire({ icon: 'error', title: 'ลบไม่สำเร็จ', text: e.message }); }
}

/* ---------- โปรไฟล์ของฉัน ---------- */
function openUserProfileModal() {
    if (!currentUser) return;
    const u = currentUser;
    const bd = u.birthdate ? new Date(u.birthdate) : null;
    const sh = stSheet(`<div class="pf-card">
        <div class="pf-head"><button type="button" class="ss-x light" aria-label="ปิด"><i class="fas fa-xmark"></i></button>
            <span class="pf-av" id="pfAv">${stAvatarHtml(u, 'pf-img')}</span><h3>${stWords(u.name)}</h3><p>${escapeHtml(u.position || 'ยังไม่ระบุตำแหน่ง')}</p>${stRoleBadge(stRole)}</div>
        <div class="pf-body">
            <div class="pf-kv"><span>Username</span><b>${escapeHtml(u.username || '-')}</b></div>
            <div class="pf-kv"><span>เพศ · อายุ</span><b>${escapeHtml([u.gender, u.age != null ? u.age + ' ปี' : ''].filter(Boolean).join(' · ') || '-')}</b></div>
            <div class="pf-kv"><span>วันเกิด</span><b>${bd && !isNaN(bd) ? stDate(bd) : '-'}</b></div>
            <div class="pf-btns"><label class="ss-btn ghost"><i class="fas fa-images"></i> เปลี่ยนรูป<input type="file" accept="image/*" hidden id="pfPhoto"></label><button type="button" class="ss-btn pri" id="pfEdit"><i class="fas fa-pen"></i> แก้ไขข้อมูล</button></div>
            <button type="button" class="ss-btn ghost" id="pfPw"><i class="fas fa-key"></i> เปลี่ยนรหัสผ่าน</button>
            <button type="button" class="ss-btn danger-t" id="pfOut"><i class="fas fa-right-from-bracket"></i> ออกจากระบบ</button>
        </div></div>`);
    const el = sh.el;
    el.querySelector('.ss-x').onclick = () => sh.close();
    el.querySelector('#pfEdit').onclick = () => { sh.close(); openUserProfileEditModal(); };
    el.querySelector('#pfPw').onclick = () => { sh.close(); stChangePassword(); };
    el.querySelector('#pfOut').onclick = () => { sh.close(); logoutUser(); };
    el.querySelector('#pfPhoto').onchange = async e => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        const av = el.querySelector('#pfAv');
        try {
            av.classList.add('busy');
            const url = await uploadUserPhoto(f);
            const j = await stApi({ action: 'user_edit', photo: url });
            if (j.status !== 'success') throw new Error(j.message || 'บันทึกรูปไม่สำเร็จ');
            stSaveSession(Object.assign({}, currentUser, j.user || { photo: url }));
            av.innerHTML = stAvatarHtml(currentUser, 'pf-img');
            Toast.fire({ icon: 'success', title: 'เปลี่ยนรูปโปรไฟล์แล้ว' });
        } catch (err) { Swal.fire({ icon: 'error', title: 'เปลี่ยนรูปไม่สำเร็จ', text: err.message }); }
        finally { av.classList.remove('busy'); e.target.value = ''; }
    };
}
function openUserProfileEditModal() {
    const u = currentUser;
    const bd = u.birthdate ? new Date(u.birthdate) : null;
    const bdv = bd && !isNaN(bd) ? `${bd.getFullYear()}-${String(bd.getMonth() + 1).padStart(2, '0')}-${String(bd.getDate()).padStart(2, '0')}` : '';
    const sh = stSheet(`<div class="pp-head"><div><h3 class="ss-h">แก้ไขข้อมูลส่วนตัว</h3><p class="ss-sub">@${escapeHtml(u.username || '')}</p></div><button type="button" class="ss-x" aria-label="ปิด"><i class="fas fa-xmark"></i></button></div>
        <div class="um-grid">
            <label class="st-field wide"><span>ชื่อ-สกุล</span><input id="peName" maxlength="80" value="${escapeHtml(u.name || '')}"></label>
            <label class="st-field"><span>ตำแหน่ง</span><input id="pePos" maxlength="60" value="${escapeHtml(u.position || '')}"></label>
            <label class="st-field"><span>เพศ</span><select id="peG"><option value="">-</option>${['ชาย', 'หญิง', 'อื่นๆ'].map(g => `<option ${u.gender === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
            <label class="st-field wide"><span>วันเกิด <em id="peAge">${u.age != null ? 'อายุ ' + u.age + ' ปี' : ''}</em></span><input type="date" id="peBd" value="${bdv}"></label>
        </div>
        <button type="button" class="ss-btn pri" id="peSave">บันทึก</button>`);
    const el = sh.el;
    el.querySelector('.ss-x').onclick = () => { sh.close(); openUserProfileModal(); };
    el.querySelector('#peBd').onchange = e => { const a = calculateAgeJS(e.target.value); el.querySelector('#peAge').innerText = a != null ? 'อายุ ' + a + ' ปี' : ''; };
    el.querySelector('#peSave').onclick = async () => {
        const v = { name: el.querySelector('#peName').value.trim(), position: el.querySelector('#pePos').value.trim(), gender: el.querySelector('#peG').value, birthdate: el.querySelector('#peBd').value };
        if (!v.name) { Toast.fire({ icon: 'warning', title: 'กรุณากรอกชื่อ-สกุล' }); return; }
        const b = el.querySelector('#peSave'); b.disabled = true; b.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> กำลังบันทึก...';
        try {
            const j = await stApi(Object.assign({ action: 'user_edit' }, v));
            if (j.status !== 'success') throw new Error(j.message || 'บันทึกไม่สำเร็จ');
            stSaveSession(Object.assign({}, currentUser, j.user || Object.assign(v, { age: calculateAgeJS(v.birthdate) })));
            sh.close();
            Toast.fire({ icon: 'success', title: 'บันทึกโปรไฟล์แล้ว' });
            openUserProfileModal();
        } catch (e) { b.disabled = false; b.innerText = 'บันทึก'; Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: e.message }); }
    };
}
function stChangePassword() {
    const sh = stSheet(`<div class="pp-head"><div><h3 class="ss-h">เปลี่ยนรหัสผ่าน</h3><p class="ss-sub">${escapeHtml(currentUser.name)}</p></div><button type="button" class="ss-x" aria-label="ปิด"><i class="fas fa-xmark"></i></button></div>
        <label class="st-field"><span>รหัสผ่านปัจจุบัน</span><span class="st-pw"><input type="password" id="cpw0" autocomplete="current-password"><button type="button" aria-label="แสดงรหัสผ่าน" onclick="stTogglePw('cpw0',this)"><i class="fas fa-eye"></i></button></span></label>
        <label class="st-field"><span>รหัสผ่านใหม่</span><span class="st-pw"><input type="password" id="cpw1" autocomplete="new-password"><button type="button" aria-label="แสดงรหัสผ่าน" onclick="stTogglePw('cpw1',this)"><i class="fas fa-eye"></i></button></span></label>
        <label class="st-field"><span>ยืนยันรหัสผ่านใหม่</span><input type="password" id="cpw2" autocomplete="new-password"></label>
        <ul class="pw-rules"><li id="pwr1">อย่างน้อย 8 ตัวอักษร</li><li id="pwr2">ตรงกันทั้ง 2 ช่อง</li><li id="pwr3">ไม่ซ้ำรหัสเดิม</li></ul>
        <div class="ss-warn"><i class="fas fa-circle-info"></i> เปลี่ยนแล้ว อุปกรณ์อื่นที่เข้าระบบไว้ต้องเข้าใหม่</div>
        <button type="button" class="ss-btn pri" id="cpwSave" disabled>บันทึกรหัสผ่านใหม่</button>`);
    const el = sh.el, $ = s => el.querySelector(s);
    $('.ss-x').onclick = () => { sh.close(); openUserProfileModal(); };
    const check = () => {
        const a = $('#cpw0').value, b = $('#cpw1').value, c = $('#cpw2').value;
        const r1 = b.length >= 8, r2 = !!b && b === c, r3 = !!b && b !== a;
        $('#pwr1').className = r1 ? 'ok' : ''; $('#pwr2').className = r2 ? 'ok' : ''; $('#pwr3').className = r3 ? 'ok' : '';
        $('#cpwSave').disabled = !(a && r1 && r2 && r3);
    };
    ['#cpw0', '#cpw1', '#cpw2'].forEach(s => $(s).oninput = check);
    $('#cpwSave').onclick = async () => {
        const b = $('#cpwSave'); b.disabled = true; b.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> กำลังบันทึก...';
        try {
            const j = await stApi({ action: 'user_edit', currentPassword: $('#cpw0').value, newPassword: $('#cpw1').value });
            if (j.status !== 'success') throw new Error(j.message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ');
            stSaveSession(Object.assign({}, currentUser, j.user || {}), j.token);
            sh.close();
            Toast.fire({ icon: 'success', title: 'เปลี่ยนรหัสผ่านแล้ว' });
        } catch (e) { b.innerText = 'บันทึกรหัสผ่านใหม่'; check(); Swal.fire({ icon: 'error', title: 'เปลี่ยนไม่สำเร็จ', text: e.message }); }
    };
}

/* ---------- ต่ออายุสัญญา: ดูวันนัดก่อนยืนยัน ---------- */
function stRenewDates(v) {
    if (!v) return null;
    const s = new Date(v + 'T00:00:00');
    if (isNaN(s)) return null;
    return [stAddMonths(s, 4), stAddMonths(s, 8), stAddMonths(s, 12)];
}
function stRenewPreview(sn) {
    const inp = document.getElementById(`renew-${sn}`), box = document.getElementById(`renew-prev-${sn}`);
    if (!inp || !box) return;
    const d = stRenewDates(inp.value);
    box.innerHTML = d ? `<div class="rn-tl">${d.map((x, i) => `<div><i>${i + 1}</i><span>PM รอบที่ ${i + 1}</span><b>${i ? '~' : ''}${stDate(x)}</b></div>`).join('')}</div><small>รอบ 2–3 คำนวณใหม่จากวันที่ปิดงานจริง · ข้อมูล PM รอบปัจจุบันย้ายไปเก็บใน "ประวัติรอบสัญญาก่อน"</small>` : '';
}

/* ---------- ประวัติรอบสัญญาก่อน + ประวัติการแก้ไข ---------- */
const stHistCache = {}, stEditLogCache = {};
const stOpenSec = new Set();
function stSecToggle(el, kind, sn) {
    const k = kind + ':' + sn;
    if (el.open) { stOpenSec.add(k); kind === 'hist' ? stLoadHistory(sn) : stLoadEditLog(sn); } else stOpenSec.delete(k);
}
async function stLoadHistory(sn, force) {
    const box = document.getElementById(`hist-${sn}`);
    if (stHistCache[sn] && !force) { if (box) box.innerHTML = stHistHtml(stHistCache[sn]); return; }
    if (box) box.innerHTML = '<p class="dt-muted"><i class="fas fa-circle-notch fa-spin"></i> กำลังโหลด...</p>';
    try {
        const j = await stApi({ action: 'get_pm_history', sn });
        if (j.status !== 'success') throw new Error(j.message);
        stHistCache[sn] = j.history || [];
    } catch (e) { if (box) box.innerHTML = `<p class="dt-muted">โหลดไม่สำเร็จ: ${escapeHtml(e.message || '')}</p>`; return; }
    const b2 = document.getElementById(`hist-${sn}`);
    if (b2) b2.innerHTML = stHistHtml(stHistCache[sn]);
}
function stHistHtml(rows) {
    if (!rows.length) return '<p class="dt-muted">ยังไม่มีรอบสัญญาก่อน (ยังไม่เคยต่ออายุ)</p>';
    const by = {};
    rows.forEach(r => { (by[r.renewalCycle] = by[r.renewalCycle] || []).push(r); });
    return Object.keys(by).sort((a, b) => b - a).map((c, i) => {
        const list = by[c].sort((a, b) => String(a.pmRound).localeCompare(String(b.pmRound)));
        return `<details class="hs-cy" ${i === 0 ? 'open' : ''}><summary><b>สัญญารอบที่ ${escapeHtml(c)}</b><span>${list.length} รอบ PM</span></summary>
            ${list.map(r => { const d = dbParse(r.statusDate); return `<div class="hs-r"><b>${escapeHtml(r.pmRound)}</b><span>${d ? stDate(d) : '-'}${r.tech ? ' · ' + escapeHtml(r.tech) : ''}</span>${r.photoUrl ? `<a href="${escapeHtml(r.photoUrl)}" target="_blank" rel="noopener"><i class="fas fa-image"></i> รูป</a>` : ''}</div>`; }).join('')}</details>`;
    }).join('');
}
const ST_EDIT_LABEL = { undo_pm: 'ยกเลิกการปิดงาน', replace_photo: 'เปลี่ยนรูปหน้างาน', renew_service: 'ต่ออายุสัญญา', delete_pm_part: 'ลบอะไหล่', update_pm_part: 'แก้รายการอะไหล่' };
async function stLoadEditLog(sn, force) {
    const box = document.getElementById(`elog-${sn}`);
    if (stEditLogCache[sn] && !force) { if (box) box.innerHTML = stEditLogHtml(stEditLogCache[sn]); return; }
    if (box) box.innerHTML = '<p class="dt-muted"><i class="fas fa-circle-notch fa-spin"></i> กำลังโหลด...</p>';
    try {
        const j = await stApi({ action: 'get_edit_log', sn });
        if (j.status !== 'success') throw new Error(j.message);
        stEditLogCache[sn] = j.log || [];
    } catch (e) { if (box) box.innerHTML = `<p class="dt-muted">โหลดไม่สำเร็จ (อัปเดต Code.gs ก่อน)</p>`; return; }
    const b2 = document.getElementById(`elog-${sn}`);
    if (b2) b2.innerHTML = stEditLogHtml(stEditLogCache[sn]);
}
function stEditLogHtml(rows) {
    if (!rows.length) return '<p class="dt-muted">ยังไม่มีการแก้ไข</p>';
    return rows.map(r => {
        const d = r.detail || {};
        const what = (ST_EDIT_LABEL[r.action] || r.action) + (d.step ? ' ' + d.step : d.round ? ' ' + d.round : '');
        const extra = d.reason ? 'เหตุผล: ' + d.reason : d.part ? d.part + (d.qty ? ' (' + d.qty + ')' : '') : d.startDate ? 'เริ่ม ' + d.startDate : '';
        return `<div class="el-r"><b>${escapeHtml(what)}</b> · ${escapeHtml(r.actor || '')} · ${stTimeShort(r.time)}${extra ? `<br>${escapeHtml(extra)}` : ''}</div>`;
    }).join('');
}
function stDropCaches(sn) { delete stEditLogCache[sn]; delete stHistCache[sn]; }

/* ---------- Admin: เมนูรอบที่ปิดแล้ว ---------- */
function stStepMenu(ev, sn, idx) {
    const x = stFindMachine(sn);
    const nextDone = x && x.steps.some(s2 => s2.idx > idx && s2.done);
    stPop(ev, [
        { icon: 'fa-image', label: 'เปลี่ยนรูปหน้างาน', run: () => stReplacePhoto(sn, idx) },
        { icon: 'fa-rotate-left', label: `ยกเลิกการปิดงาน PM${idx}`, danger: true, disabled: nextDone, hint: nextDone ? `ต้องยกเลิก PM${idx + 1} ก่อน` : '', run: () => stUndoPm(sn, idx) }
    ]);
}
async function stReplacePhoto(sn, idx) {
    if (!isAdmin) return;
    const key = 'PM' + idx;
    const x = stFindMachine(sn);
    const r = await Swal.fire({
        title: `เปลี่ยนรูป ${key}`, html: `${stWords(x ? x.client : sn)}<br><small>รูปเดิมย้ายไปถังขยะ Drive (กู้คืนได้ 30 วัน)</small>`,
        input: 'text', inputLabel: 'เหตุผล (จำเป็น)', inputPlaceholder: 'เช่น รูปไม่เห็นป้าย S/N',
        showCancelButton: true, confirmButtonText: 'ถ่าย/เลือกรูปใหม่', cancelButtonText: 'ยกเลิก',
        inputValidator: v => (!v || v.trim().length < 3) ? 'กรุณาระบุเหตุผล' : undefined
    });
    if (!r.isConfirmed) return;
    const reason = r.value.trim();
    const ok = await stCamera({
        title: `เปลี่ยนรูป ${key} · ${x ? x.client : sn}`,
        upload: async img => { const j = await stApi({ action: 'replace_photo', sn, pmStep: key, image: img, reason }); if (j.status !== 'success') throw new Error(j.message || 'เปลี่ยนรูปไม่สำเร็จ'); }
    });
    if (ok) { stDropCaches(sn); Toast.fire({ icon: 'success', title: `เปลี่ยนรูป ${key} แล้ว` }); loadData(true); }
}
async function stUndoPm(sn, idx) {
    if (!isAdmin) return;
    const key = 'PM' + idx;
    const x = stFindMachine(sn);
    Swal.fire({ title: 'กำลังตรวจข้อมูล...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    let info;
    try {
        info = await stApi({ action: 'undo_info', sn, pmStep: key });
        if (info.status !== 'success') throw new Error(info.message || 'ตรวจข้อมูลไม่ได้');
        Swal.close();
    } catch (e) { Swal.fire({ icon: 'error', title: 'ทำรายการไม่ได้', text: e.message }); return; }
    const nexts = idx === 1 ? [2, 3] : idx === 2 ? [3] : [];
    const plan = dbParse(info.plan);
    const fmtIso = d => d ? dbIso(d) : '';
    const restoreRows = nexts.map(k => {
        const kk = `PM${k}_Date`;
        if (info.snapshot) {
            const d = dbParse(info.snapshot[kk]);
            return `<li>วันนัด PM${k} กลับเป็น <b>${d ? stDate(d) : 'ว่าง (ยังไม่มีวันนัด)'}</b></li>`;
        }
        const sug = plan ? stAddMonths(plan, 4 * (k - idx)) : null;
        return `<li class="ud-in"><span>วันนัด PM${k}</span><input type="date" data-k="${kk}" value="${fmtIso(sug)}" aria-label="วันนัด PM${k}"></li>`;
    }).join('');
    const doneD = dbParse(info.done);
    const sh = stSheet(`<h3 class="ss-h danger">ยกเลิกการปิดงาน ${key}?</h3><p class="ss-sub">${stWords(x ? x.client : sn)} · ปิดโดย ${escapeHtml(info.tech || '-')} ${doneD ? stDate(doneD) : ''}</p>
        <div class="ud-chg"><b>สิ่งที่จะเปลี่ยน</b><ul><li>${key} กลับเป็น "ยังไม่ปิดงาน"</li><li>ล้างวันที่เข้า ชื่อช่าง และ GPS ของ ${key}</li>${restoreRows}</ul>
            <b>คงไว้</b><ul><li>รูปหน้างาน และรายการอะไหล่ของ ${key}</li></ul></div>
        ${nexts.length && !info.snapshot ? '<div class="ss-warn"><i class="fas fa-circle-info"></i> งานนี้ปิดก่อนมีระบบจดวันนัดเดิม ระบบเสนอวันจากรอบสัญญา ตรวจหรือแก้ก่อนยืนยัน (เว้นว่าง = ไม่มีวันนัด)</div>' : ''}
        <label class="st-field"><span>เหตุผล (จำเป็น)</span><textarea id="udR" rows="2" maxlength="300" placeholder="เช่น กดปิดงานผิดเครื่อง"></textarea></label>
        <div class="ss-warn"><i class="fas fa-triangle-exclamation"></i> รูปยืนยันงานที่ส่ง LINE ไปแล้วดึงกลับไม่ได้ แจ้งลูกค้าเองถ้าจำเป็น</div>
        <button type="button" class="ss-btn red" id="udGo" disabled>ยืนยันยกเลิกการปิดงาน</button><button type="button" class="ss-btn ghost" id="udNo">ไม่ยกเลิก</button>`);
    const el = sh.el;
    const rIn = el.querySelector('#udR'), go = el.querySelector('#udGo');
    rIn.oninput = () => { go.disabled = rIn.value.trim().length < 3; };
    el.querySelector('#udNo').onclick = () => sh.close();
    go.onclick = async () => {
        const body = { action: 'undo_pm', sn, pmStep: key, reason: rIn.value.trim(), expectDone: info.done };
        if (!info.snapshot && nexts.length) { body.restoreDates = {}; el.querySelectorAll('input[data-k]').forEach(i => { body.restoreDates[i.dataset.k] = i.value; }); }
        go.disabled = true; go.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> กำลังยกเลิก...';
        try {
            const j = await stApi(body);
            if (j.status !== 'success') throw new Error(j.message || 'ยกเลิกไม่สำเร็จ');
            sh.close(); stDropCaches(sn);
            Toast.fire({ icon: 'success', title: `ยกเลิกการปิดงาน ${key} แล้ว` });
            loadData(true);
        } catch (e) { go.disabled = false; go.innerText = 'ยืนยันยกเลิกการปิดงาน'; Swal.fire({ icon: 'error', title: 'ยกเลิกไม่สำเร็จ', text: e.message }); }
    };
}

// เปิดแอป: มี session → splash + โหลดข้อมูล (และเช็คสิทธิ์ล่าสุดกับหลังบ้าน) / ไม่มี → หน้าเข้าสู่ระบบ
stApplyRole();
updateUserProfileIcon();
if (stToken) {
    const hasCachedData = loadFromCache();
    if (hasCachedData) stSplashSetReady();
    stLoaderStep(1);
    stSplashTick();
    loadData(false, hasCachedData);
    stVerifySession();
} else {
    // ยังไม่ได้เข้าระบบ: แสดงหน้าโหลดครบ animation ก่อน แล้วค่อยเปิดหน้าเข้าสู่ระบบ (เตรียมไว้ใต้หน้าโหลด)
    try { localStorage.removeItem(CACHE_KEY); } catch (e) { }
    const ls = document.querySelectorAll('#ldSteps li');
    if (ls[1]) ls[1].lastChild.textContent = 'ตรวจสอบบัญชีผู้ใช้';
    if (ls[2]) ls[2].lastChild.textContent = 'เตรียมหน้าเข้าสู่ระบบ';
    render();
    stShowLogin('', true);
    stLoaderStep(1);
    stSplashSetReady();
    document.getElementById('loaderStatusText').innerText = '';
    stSplashTick();
}

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

// ทางเลือกสำรอง: ใช้ file picker ปกติ (input[type=file]) — ใช้เมื่อเปิดกล้องในแอปไม่ได้เท่านั้น
async function uploadPhotoByStep(sn, pmStep, input) {
    if (!input.files || input.files.length === 0) return;
    await uploadImageForStep(sn, pmStep, input.files[0]);
    input.value = ''; // เคลียร์ไว้เผื่อเลือกไฟล์เดิมซ้ำได้อีกครั้ง
}

// --- กล้องถ่ายรูปในแอป (แก้ปัญหา capture="environment" ของ input file ไม่เสถียรบน Android บางเครื่อง) ---

// เปิด modal กล้องถ่ายรูป คืนค่าเป็น Data URL ของรูปที่ถ่าย, null ถ้ายกเลิก, หรือ 'FALLBACK' ถ้าเปิดกล้องไม่ได้

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
    document.querySelectorAll('.f-card').forEach(c => c.classList.remove('active-all', 'active-overdue', 'active-urgent', 'active-plan', 'active-done'));
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