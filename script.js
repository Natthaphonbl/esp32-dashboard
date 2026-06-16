// ====================================================
//  1. MQTT CONFIG
// ====================================================
const brokerUrl = 'wss://526d6759062b4d98897490d0f892c560.s1.eu.hivemq.cloud:8884/mqtt';
const mqttOptions = { username: 'Mr.Wat_Farm', password: 'Nut@1105' };
const client = mqtt.connect(brokerUrl, mqttOptions);

// ====================================================
//  2. STATE
// ====================================================
// commandState  = สิ่งที่เว็บสั่ง (true/false)
// confirmedState = สิ่งที่ ESP32 ยืนยันกลับมา (true/false/null)
const zoneCommand   = {}; // { 1: true/false, ... }
const zoneConfirmed = {}; // { 1: true/false/null, ... }
let espOnline = false;
let lastSeenTime = null;

// timeout รอ feedback 5 วิ ถ้าไม่มาแสดง mismatch
const FEEDBACK_TIMEOUT_MS = 5000;
const feedbackTimers = {};

// ====================================================
//  3. MQTT EVENTS
// ====================================================
client.on('connect', () => {
    updateMqttStatus(true);

    // Subscribe ทุก topic ที่ต้องการ
    client.subscribe('esp32/sensor');
    client.subscribe('esp32/device/status');
    client.subscribe('esp32/+/status'); // feedback จาก relay
});

client.on('error', () => updateMqttStatus(false));
client.on('offline', () => updateMqttStatus(false));

client.on('message', (topic, message) => {
    const msg = message.toString();

    // ---- ESP32 device online/offline ----
    if (topic === 'esp32/device/status') {
        setEspStatus(msg === 'online');
        return;
    }

    // ---- Sensor data ----
    if (topic === 'esp32/sensor') {
        try {
            const data = JSON.parse(msg);

            // อัปเดตเวลาที่เห็น ESP ล่าสุด
            lastSeenTime = new Date();
            setEspStatus(true);
            updateLastSeen();

            // อัปเดต sensor
            const temp = parseFloat(data.temperature).toFixed(1);
            const hum  = parseFloat(data.humidity).toFixed(1);
            document.getElementById('temp').innerText = temp;
            document.getElementById('hum').innerText  = hum;
            document.getElementById('temp-fill').style.width = Math.min((temp / 50) * 100, 100) + '%';
            document.getElementById('hum-fill').style.width  = Math.min(hum, 100) + '%';

            // อัปเดต device info
            if (data.wifi_rssi !== undefined) updateWifiInfo(data.wifi_rssi, data.wifi_ip, data.uptime_s);

            // ถ้า ESP ส่ง zones array มาพร้อม sensor → อัปเดตสถานะทั้งหมด
            if (data.zones && Array.isArray(data.zones)) {
                data.zones.forEach((state, idx) => {
                    applyConfirmedState(idx + 1, state === 1);
                });
            }
        } catch (e) {
            console.error('Invalid JSON:', e);
        }
        return;
    }

    // ---- Relay feedback: esp32/zoneN/status ----
    const match = topic.match(/^esp32\/zone(\d+)\/status$/);
    if (match) {
        const zoneNum  = parseInt(match[1]);
        const isOn     = msg === '1';
        applyConfirmedState(zoneNum, isOn);
    }
});

// ====================================================
//  4. BUILD ZONE UI
// ====================================================
const zonesContainer = document.getElementById('zones-container');
for (let i = 1; i <= 8; i++) {
    zoneCommand[i]   = false;
    zoneConfirmed[i] = null;

    zonesContainer.innerHTML += `
        <div class="zone-card" id="zone-card-${i}">
            <div class="zone-header">
                <div class="zone-title">
                    <div class="zone-num">${String(i).padStart(2,'0')}</div>
                    <div>
                        <h3>โซนที่ ${i}</h3>
                        <div class="zone-status-text off" id="zone-status-text-${i}">ปิดอยู่</div>
                    </div>
                </div>
                <label class="switch" id="switch-label-${i}">
                    <input type="checkbox" id="toggle-${i}" onchange="sendToggle(${i}, this.checked)">
                    <span class="slider"></span>
                </label>
            </div>

            <!-- Feedback indicator -->
            <div class="feedback-row">
                <div class="feedback-dot" id="fb-dot-${i}"></div>
                <span class="feedback-text" id="fb-text-${i}">รอสถานะจาก ESP32...</span>
            </div>

            <!-- Timer -->
            <div class="timer-section">
                <div class="timer-header">
                    <span class="timer-title">⏱ ตั้งเวลา</span>
                    <label class="timer-enable-toggle">
                        <label class="mini-switch">
                            <input type="checkbox" id="timer-enable-${i}" checked onchange="toggleTimer(${i}, this.checked)">
                            <span class="mini-slider"></span>
                        </label>
                        <span id="timer-enable-text-${i}">เปิดใช้งาน</span>
                    </label>
                </div>
                <div class="timer-body" id="timer-body-${i}">
                    <div class="timer-row">
                        <span class="timer-label">🟢 เวลาเปิด</span>
                        <input type="time" id="time-on-${i}">
                    </div>
                    <div class="timer-row">
                        <span class="timer-label">🔴 เวลาปิด</span>
                        <input type="time" id="time-off-${i}">
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ====================================================
//  5. ส่งคำสั่ง → SET PENDING
// ====================================================
function sendToggle(zoneNum, isChecked) {
    // บันทึกคำสั่งที่ส่ง
    zoneCommand[zoneNum] = isChecked;

    // แสดงสถานะ "กำลังส่ง..." (pending)
    setPendingState(zoneNum, isChecked);

    const topic = `esp32/zone${zoneNum}/cmd`;
    client.publish(topic, isChecked ? '1' : '0');
    console.log(`📤 ส่งคำสั่ง ${isChecked ? 'เปิด' : 'ปิด'} → ${topic}`);

    // ตั้ง timeout รอ feedback
    clearTimeout(feedbackTimers[zoneNum]);
    feedbackTimers[zoneNum] = setTimeout(() => {
        // ถ้ายังไม่มี feedback → แสดง mismatch
        if (zoneConfirmed[zoneNum] !== zoneCommand[zoneNum]) {
            setMismatchState(zoneNum);
        }
    }, FEEDBACK_TIMEOUT_MS);
}

// ====================================================
//  6. รับ FEEDBACK จาก ESP32 → UPDATE UI
// ====================================================
function applyConfirmedState(zoneNum, isOn) {
    zoneConfirmed[zoneNum] = isOn;
    clearTimeout(feedbackTimers[zoneNum]);

    const toggle = document.getElementById(`toggle-${zoneNum}`);
    if (toggle) toggle.checked = isOn;

    const cmd = zoneCommand[zoneNum];
    const confirmed = isOn;

    if (cmd === confirmed || cmd === undefined) {
        // ✅ ตรงกัน
        setConfirmedState(zoneNum, isOn);
    } else {
        // ❌ ไม่ตรงกัน (สั่งแล้วแต่ relay ไม่ตอบสนอง)
        setMismatchState(zoneNum);
    }
}

// ====================================================
//  7. UI STATE HELPERS
// ====================================================
function setPendingState(zoneNum, intendedOn) {
    const card       = document.getElementById(`zone-card-${zoneNum}`);
    const statusText = document.getElementById(`zone-status-text-${zoneNum}`);
    const switchEl   = document.getElementById(`switch-label-${zoneNum}`);
    const fbDot      = document.getElementById(`fb-dot-${zoneNum}`);
    const fbText     = document.getElementById(`fb-text-${zoneNum}`);

    card.className      = 'zone-card pending';
    switchEl.className  = 'switch pending';
    statusText.className = 'zone-status-text pending';
    statusText.innerText = intendedOn ? 'กำลังเปิด... ⏳' : 'กำลังปิด... ⏳';
    fbDot.className     = 'feedback-dot pending';
    fbText.innerText    = 'รอการยืนยันจาก ESP32...';
    fbText.style.color  = 'var(--yellow)';
}

function setConfirmedState(zoneNum, isOn) {
    const card       = document.getElementById(`zone-card-${zoneNum}`);
    const statusText = document.getElementById(`zone-status-text-${zoneNum}`);
    const switchEl   = document.getElementById(`switch-label-${zoneNum}`);
    const fbDot      = document.getElementById(`fb-dot-${zoneNum}`);
    const fbText     = document.getElementById(`fb-text-${zoneNum}`);

    if (isOn) {
        card.className       = 'zone-card active';
        statusText.className = 'zone-status-text on';
        statusText.innerText = 'กำลังทำงาน 🟢';
        fbDot.className      = 'feedback-dot confirmed';
        fbText.innerText     = '✅ ESP32 ยืนยัน: วาล์วเปิดแล้ว';
        fbText.style.color   = 'var(--green)';
    } else {
        card.className       = 'zone-card';
        statusText.className = 'zone-status-text off';
        statusText.innerText = 'ปิดอยู่';
        fbDot.className      = 'feedback-dot';
        fbText.innerText     = 'ESP32 ยืนยัน: วาล์วปิดแล้ว';
        fbText.style.color   = 'var(--text-muted)';
    }
    switchEl.className = 'switch';
}

function setMismatchState(zoneNum) {
    const card       = document.getElementById(`zone-card-${zoneNum}`);
    const statusText = document.getElementById(`zone-status-text-${zoneNum}`);
    const fbDot      = document.getElementById(`fb-dot-${zoneNum}`);
    const fbText     = document.getElementById(`fb-text-${zoneNum}`);
    const switchEl   = document.getElementById(`switch-label-${zoneNum}`);

    card.className       = 'zone-card';
    switchEl.className   = 'switch';
    statusText.className = 'zone-status-text pending';
    statusText.innerText = '⚠️ ไม่ตอบสนอง';
    fbDot.className      = 'feedback-dot mismatch';
    fbText.innerText     = '❌ ไม่ได้รับการยืนยันจาก ESP32';
    fbText.style.color   = 'var(--red)';
}

// ====================================================
//  8. ESP32 DEVICE STATUS
// ====================================================
function setEspStatus(online) {
    espOnline = online;
    const espStatusEl = document.getElementById('esp-status');
    const espDotEl    = document.getElementById('esp-dot');

    if (online) {
        espStatusEl.innerText   = 'Online';
        espStatusEl.className   = 'ds-value online';
        espDotEl.className      = 'ds-dot online';
    } else {
        espStatusEl.innerText   = 'Offline';
        espStatusEl.className   = 'ds-value offline';
        espDotEl.className      = 'ds-dot offline';

        // ถ้า ESP offline ให้แสดง warning ทุกโซน
        for (let i = 1; i <= 8; i++) {
            const fbText = document.getElementById(`fb-text-${i}`);
            const fbDot  = document.getElementById(`fb-dot-${i}`);
            if (fbText) { fbText.innerText = '⚠️ ESP32 ออฟไลน์'; fbText.style.color = 'var(--yellow)'; }
            if (fbDot)  fbDot.className = 'feedback-dot mismatch';
        }
    }
}

function updateWifiInfo(rssi, ip, uptimeSec) {
    // แปลง RSSI เป็นความแรงสัญญาณ
    let rssiText = `${rssi} dBm`;
    if (rssi >= -50)       rssiText += ' (ดีมาก 📶)';
    else if (rssi >= -65)  rssiText += ' (ดี 📶)';
    else if (rssi >= -75)  rssiText += ' (พอใช้ 📶)';
    else                   rssiText += ' (อ่อน ⚠️)';

    document.getElementById('wifi-rssi').innerText = rssiText;
    document.getElementById('wifi-ip').innerText   = ip || '--';

    // แปลง uptime วินาที → h:mm:ss
    if (uptimeSec !== undefined) {
        const h = Math.floor(uptimeSec / 3600);
        const m = Math.floor((uptimeSec % 3600) / 60);
        const s = uptimeSec % 60;
        document.getElementById('uptime').innerText =
            `${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
    }
}

function updateLastSeen() {
    if (!lastSeenTime) return;
    const now    = new Date();
    const diffMs = now - lastSeenTime;
    const diffS  = Math.floor(diffMs / 1000);
    const el     = document.getElementById('last-seen');
    if (!el) return;
    el.innerText = diffS < 5 ? 'เมื่อกี้' : `${diffS} วินาทีที่แล้ว`;
}
setInterval(updateLastSeen, 5000);

// ====================================================
//  9. MQTT STATUS
// ====================================================
function updateMqttStatus(connected) {
    const badge = document.getElementById('status');
    if (connected) {
        badge.innerHTML = '<span class="status-dot"></span> เชื่อมต่อสำเร็จ';
        badge.classList.add('connected');
    } else {
        badge.innerHTML = '<span class="status-dot"></span> ขาดการเชื่อมต่อ';
        badge.classList.remove('connected');
        setEspStatus(false);
    }
}

// ====================================================
//  10. TIMER TOGGLE
// ====================================================
function toggleTimer(zoneNum, isEnabled) {
    const body = document.getElementById(`timer-body-${zoneNum}`);
    const text = document.getElementById(`timer-enable-text-${zoneNum}`);
    if (isEnabled) {
        body.classList.remove('disabled');
        text.innerText    = 'เปิดใช้งาน';
        text.style.color  = '';
    } else {
        body.classList.add('disabled');
        text.innerText    = 'ปิดใช้งาน';
        text.style.color  = 'var(--red)';
        document.getElementById(`time-on-${zoneNum}`).value  = '';
        document.getElementById(`time-off-${zoneNum}`).value = '';
    }
}

// ====================================================
//  11. CLOCK + TIMER SCHEDULER
// ====================================================
function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2,'0');
    const m = String(now.getMinutes()).padStart(2,'0');
    const s = String(now.getSeconds()).padStart(2,'0');
    document.getElementById('clock').innerText = `${h}:${m}:${s}`;
}
setInterval(updateClock, 1000);
updateClock();

setInterval(() => {
    const now = new Date();
    const currentTime = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');

    for (let i = 1; i <= 8; i++) {
        if (!document.getElementById(`timer-enable-${i}`).checked) continue;

        const timeOn  = document.getElementById(`time-on-${i}`).value;
        const timeOff = document.getElementById(`time-off-${i}`).value;
        const toggle  = document.getElementById(`toggle-${i}`);

        if (timeOn  && currentTime === timeOn  && !toggle.checked) { toggle.checked = true;  sendToggle(i, true); }
        if (timeOff && currentTime === timeOff &&  toggle.checked) { toggle.checked = false; sendToggle(i, false); }
    }
}, 30000);