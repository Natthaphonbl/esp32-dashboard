// 1. ตั้งค่า MQTT (รหัสของคุณ)
const brokerUrl = 'wss://526d6759062b4d98897490d0f892c560.s1.eu.hivemq.cloud:8884/mqtt'; 
const options = {
    username: 'Mr.Wat_Farm',
    password: 'Nut@1105'
};

const client = mqtt.connect(brokerUrl, options);

// เมื่อเชื่อมต่อสำเร็จ
client.on('connect', () => {
    const statusBadge = document.getElementById('status');
    statusBadge.innerText = 'เชื่อมต่อสำเร็จ 🟢';
    statusBadge.style.backgroundColor = '#d4edda';
    statusBadge.style.color = '#155724';
    
    client.subscribe('esp32/sensor'); // รอรับค่าอุณหภูมิความชื้น
});

// เมื่อได้รับข้อมูลจาก ESP32
client.on('message', (topic, message) => {
    if (topic === 'esp32/sensor') {
        try {
            const data = JSON.parse(message.toString());
            document.getElementById('temp').innerText = parseFloat(data.temperature).toFixed(1);
            document.getElementById('hum').innerText = parseFloat(data.humidity).toFixed(1);
        } catch (e) {
            console.error("Invalid JSON data");
        }
    }
});

// 2. สร้างหน้า UI สำหรับ 8 โซนอัตโนมัติ
const zonesContainer = document.getElementById('zones-container');
for (let i = 1; i <= 8; i++) {
    const zoneHTML = `
        <div class="zone-card">
            <div class="zone-header">
                <h3>📍 โซนที่ ${i}</h3>
                <label class="switch">
                    <input type="checkbox" id="toggle-${i}" onchange="toggleZone(${i}, this.checked)">
                    <span class="slider"></span>
                </label>
            </div>
            <div class="timer-section">
                <div class="timer-row">
                    <span>🕒 เวลาเปิด:</span>
                    <input type="time" id="time-on-${i}">
                </div>
                <div class="timer-row">
                    <span>🛑 เวลาปิด:</span>
                    <input type="time" id="time-off-${i}">
                </div>
            </div>
        </div>
    `;
    zonesContainer.innerHTML += zoneHTML;
}

// 3. ฟังก์ชันส่งคำสั่งเปิด-ปิด (ส่งไปที่ Topic แยกกัน เช่น esp32/zone1/cmd)
function toggleZone(zoneNum, isChecked) {
    const state = isChecked ? '1' : '0';
    const topic = `esp32/zone${zoneNum}/cmd`;
    client.publish(topic, state);
    console.log(`ส่งคำสั่ง: ${state} ไปที่หัวข้อ ${topic}`);
}

// 4. ระบบตั้งเวลาเช็คทุกๆ 1 นาที (ทำงานบนเบราว์เซอร์)
setInterval(() => {
    const now = new Date();
    const currentTime = String(now.getHours()).padStart(2, '0') + ":" + String(now.getMinutes()).padStart(2, '0');
    
    for (let i = 1; i <= 8; i++) {
        const timeOn = document.getElementById(`time-on-${i}`).value;
        const timeOff = document.getElementById(`time-off-${i}`).value;
        const toggleBtn = document.getElementById(`toggle-${i}`);

        // ตรวจสอบเวลาเปิด
        if (timeOn && currentTime === timeOn && !toggleBtn.checked) {
            toggleBtn.checked = true;
            toggleZone(i, true);
        }
        // ตรวจสอบเวลาปิด
        if (timeOff && currentTime === timeOff && toggleBtn.checked) {
            toggleBtn.checked = false;
            toggleZone(i, false);
        }
    }
}, 60000);