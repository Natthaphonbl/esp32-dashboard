// 1. ตั้งค่า MQTT
const brokerUrl = 'wss://526d6759062b4d98897490d0f892c560.s1.eu.hivemq.cloud:8884/mqtt'; 
const options = {
    username: 'Mr.Wat_Farm',
    password: 'Nut@1105'
};

const client = mqtt.connect(brokerUrl, options);

// เมื่อเชื่อมต่อสำเร็จ
client.on('connect', () => {
    const statusBadge = document.getElementById('status');
    statusBadge.innerHTML = '<span class="status-dot"></span> เชื่อมต่อสำเร็จ';
    statusBadge.classList.add('connected');
    client.subscribe('esp32/sensor');
});

client.on('error', () => {
    const statusBadge = document.getElementById('status');
    statusBadge.innerHTML = '<span class="status-dot"></span> ไม่สามารถเชื่อมต่อได้';
});

// เมื่อได้รับข้อมูลจาก ESP32
client.on('message', (topic, message) => {
    if (topic === 'esp32/sensor') {
        try {
            const data = JSON.parse(message.toString());
            const temp = parseFloat(data.temperature).toFixed(1);
            const hum = parseFloat(data.humidity).toFixed(1);
            document.getElementById('temp').innerText = temp;
            document.getElementById('hum').innerText = hum;

            // อัปเดต progress bar
            const tempPct = Math.min((temp / 50) * 100, 100);
            const humPct = Math.min(hum, 100);
            document.getElementById('temp-fill').style.width = tempPct + '%';
            document.getElementById('hum-fill').style.width = humPct + '%';
        } catch (e) {
            console.error("Invalid JSON data");
        }
    }
});

// 2. อัปเดตนาฬิกา
function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    document.getElementById('clock').innerText = `${h}:${m}:${s}`;
}
setInterval(updateClock, 1000);
updateClock();

// 3. สร้าง UI สำหรับ 8 โซน
const zonesContainer = document.getElementById('zones-container');
for (let i = 1; i <= 8; i++) {
    const zoneHTML = `
        <div class="zone-card" id="zone-card-${i}">
            <div class="zone-header">
                <div class="zone-title">
                    <div class="zone-num">${String(i).padStart(2,'0')}</div>
                    <div>
                        <h3>โซนที่ ${i}</h3>
                        <div class="zone-status-text" id="zone-status-text-${i}">ปิดอยู่</div>
                    </div>
                </div>
                <label class="switch">
                    <input type="checkbox" id="toggle-${i}" onchange="toggleZone(${i}, this.checked)">
                    <span class="slider"></span>
                </label>
            </div>
            <div class="timer-section">
                <div class="timer-header">
                    <span class="timer-title">⏱ ตั้งเวลา</span>
                    <label class="timer-enable-toggle" title="เปิด/ปิดการใช้งานตั้งเวลา">
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
    zonesContainer.innerHTML += zoneHTML;
}

// 4. เปิด-ปิดโซน
function toggleZone(zoneNum, isChecked) {
    const state = isChecked ? '1' : '0';
    const topic = `esp32/zone${zoneNum}/cmd`;
    client.publish(topic, state);
    console.log(`ส่งคำสั่ง: ${state} → ${topic}`);

    // อัปเดต UI
    const card = document.getElementById(`zone-card-${zoneNum}`);
    const statusText = document.getElementById(`zone-status-text-${zoneNum}`);
    if (isChecked) {
        card.classList.add('active');
        statusText.innerText = 'กำลังทำงาน 🟢';
        statusText.style.color = 'var(--green)';
    } else {
        card.classList.remove('active');
        statusText.innerText = 'ปิดอยู่';
        statusText.style.color = '';
    }
}

// 5. เปิด-ปิดฟังก์ชันตั้งเวลา
function toggleTimer(zoneNum, isEnabled) {
    const body = document.getElementById(`timer-body-${zoneNum}`);
    const text = document.getElementById(`timer-enable-text-${zoneNum}`);
    if (isEnabled) {
        body.classList.remove('disabled');
        text.innerText = 'เปิดใช้งาน';
        text.style.color = '';
    } else {
        body.classList.add('disabled');
        text.innerText = 'ปิดใช้งาน';
        text.style.color = 'var(--red)';
        // ล้างค่าเวลาเมื่อปิดฟังก์ชัน
        document.getElementById(`time-on-${zoneNum}`).value = '';
        document.getElementById(`time-off-${zoneNum}`).value = '';
    }
}

// 6. ระบบตั้งเวลา (เช็คทุก 30 วินาที)
setInterval(() => {
    const now = new Date();
    const currentTime = String(now.getHours()).padStart(2, '0') + ":" + String(now.getMinutes()).padStart(2, '0');

    for (let i = 1; i <= 8; i++) {
        // ข้ามถ้าปิดฟังก์ชันตั้งเวลา
        const timerEnabled = document.getElementById(`timer-enable-${i}`).checked;
        if (!timerEnabled) continue;

        const timeOn = document.getElementById(`time-on-${i}`).value;
        const timeOff = document.getElementById(`time-off-${i}`).value;
        const toggleBtn = document.getElementById(`toggle-${i}`);

        if (timeOn && currentTime === timeOn && !toggleBtn.checked) {
            toggleBtn.checked = true;
            toggleZone(i, true);
        }
        if (timeOff && currentTime === timeOff && toggleBtn.checked) {
            toggleBtn.checked = false;
            toggleZone(i, false);
        }
    }
}, 30000);