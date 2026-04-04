// Konfigurasi
const GAS_URL = "URL_APPS_SCRIPT_ANDA_DISINI"; 

// 1. PWA & OFFLINE DETECTION
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

function updateOnlineStatus() {
    const banner = document.getElementById('offlineBanner');
    const btnSync = document.getElementById('btnSync');
    if (navigator.onLine) {
        banner.classList.add('hidden');
        syncData();
    } else {
        banner.classList.remove('hidden');
        btnSync.classList.add('hidden');
    }
}

// State Aplikasi
let currentUserRole = '';
let logs = JSON.parse(localStorage.getItem('localLogs')) || []; 
let offlineQueue = JSON.parse(localStorage.getItem('offlineQueue')) || [];
const defaultSettings = { timeLate: "07:15", timeOut: "14:00", waMasuk: "Ananda [NAMA] HADIR pukul [WAKTU].", waTelat: "Ananda [NAMA] TERLAMBAT (Tiba: [WAKTU])." };

// 2. RBAC & NAVIGATION
const menuConfig = {
    admin: [
        { id: 'dashboard-page', icon: 'fa-chart-line', text: 'Dashboard & Rekap' },
        { id: 'scan-page', icon: 'fa-id-card', text: 'Mesin Tap' },
        { id: 'students-page', icon: 'fa-users', text: 'Data Siswa' },
        { id: 'settings-page', icon: 'fa-sliders', text: 'Pengaturan' },
        { id: 'profile-page', icon: 'fa-building', text: 'Profil Instansi' }
    ],
    piket: [{ id: 'scan-page', icon: 'fa-id-card', text: 'Mesin Tap' }],
    wali: [{ id: 'dashboard-page', icon: 'fa-chart-line', text: 'Dashboard' }, { id: 'students-page', icon: 'fa-users', text: 'Data Kelasku' }]
};

document.getElementById('btnLogin').addEventListener('click', () => {
    const pass = document.getElementById('adminPassword').value;
    if(pass !== '123') return alert('Password Salah! (Gunakan 123)'); // Password Dummy
    
    currentUserRole = document.getElementById('loginRole').value;
    document.getElementById('login-page').classList.add('hidden');
    document.getElementById('sidebar').classList.remove('hidden');
    
    // Set Badge Color
    const badge = document.getElementById('userRoleBadge');
    badge.innerText = currentUserRole.toUpperCase();
    badge.className = `text-xs mt-1 px-3 py-1 rounded-full font-bold text-white ${currentUserRole === 'admin' ? 'bg-red-600' : currentUserRole === 'piket' ? 'bg-blue-600' : 'bg-green-600'}`;

    // Build Menu
    const menuUl = document.getElementById('navMenu');
    menuUl.innerHTML = '';
    menuConfig[currentUserRole].forEach(item => {
        menuUl.innerHTML += `<li><a href="#" onclick="showPage('${item.id}')" class="flex items-center p-3 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white transition"><i class="fa-solid ${item.icon} w-8"></i> ${item.text}</a></li>`;
    });

    initSystem();
    showPage(menuConfig[currentUserRole][0].id);
});

function showPage(id) {
    ['dashboard-page', 'scan-page', 'students-page', 'settings-page', 'profile-page', 'print-area'].forEach(p => {
        const el = document.getElementById(p);
        if(el) el.classList.add('hidden');
    });
    document.getElementById(id).classList.remove('hidden');
    
    if(id === 'scan-page') setTimeout(() => document.getElementById('scannerInput').focus(), 500);
}

// 3. INITIALIZATION & STORAGE LOGIC
function initSystem() {
    updateOnlineStatus();
    loadProfile();
    loadSettings();
    updateDashboardUI();
    setInterval(() => {
        document.getElementById('clockDisplay').innerText = new Date().toLocaleTimeString('id-ID') + " WIB";
    }, 1000);
}

// Pengaturan
function loadSettings() {
    const s = JSON.parse(localStorage.getItem('appSettings')) || defaultSettings;
    document.getElementById('timeLate').value = s.timeLate;
    document.getElementById('timeOut').value = s.timeOut;
    document.getElementById('waMasuk').value = s.waMasuk;
    document.getElementById('waTelat').value = s.waTelat;
}
window.saveSettings = function() {
    const s = {
        timeLate: document.getElementById('timeLate').value, timeOut: document.getElementById('timeOut').value,
        waMasuk: document.getElementById('waMasuk').value, waTelat: document.getElementById('waTelat').value
    };
    localStorage.setItem('appSettings', JSON.stringify(s));
    alert('Pengaturan Disimpan!');
};

// Profil Sekolah
document.getElementById('uploadLogo')?.addEventListener('change', e => {
    const reader = new FileReader();
    reader.onloadend = () => document.getElementById('previewLogo').src = reader.result;
    if(e.target.files[0]) reader.readAsDataURL(e.target.files[0]);
});
function loadProfile() {
    const p = JSON.parse(localStorage.getItem('appProfile')) || { name: 'SEKOLAH DEMO', logo: 'https://ui-avatars.com/api/?name=SD&background=3b82f6&color=fff' };
    document.getElementById('sidebarSchoolName').innerText = p.name;
    document.getElementById('inputSchoolName').value = p.name;
    document.getElementById('printSchoolName').innerText = "KARTU ABSEN - " + p.name;
    document.getElementById('sidebarLogo').src = p.logo;
    document.getElementById('previewLogo').src = p.logo;
}
window.saveProfile = function() {
    const p = { name: document.getElementById('inputSchoolName').value, logo: document.getElementById('previewLogo').src };
    localStorage.setItem('appProfile', JSON.stringify(p));
    loadProfile();
    alert('Profil Disimpan!');
};

// 4. SCANNER & OFFLINE QUEUE LOGIC
document.getElementById('scannerInput')?.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        if(this.value.trim() !== '') processScan(this.value.trim());
        this.value = ''; 
    }
});
document.addEventListener('click', () => {
    const s = document.getElementById('scannerInput');
    if(s && !document.getElementById('scan-page').classList.contains('hidden')) s.focus();
});

function getStatusMode() {
    const s = JSON.parse(localStorage.getItem('appSettings')) || defaultSettings;
    const now = new Date();
    const curMin = now.getHours() * 60 + now.getMinutes();
    const parseM = t => parseInt(t.split(':')[0])*60 + parseInt(t.split(':')[1]);
    
    if(curMin >= parseM(s.timeOut)) return "PULANG";
    if(curMin > parseM(s.timeLate)) return "TERLAMBAT";
    return "HADIR";
}

async function processScan(nis) {
    const timeStr = new Date().toLocaleTimeString('id-ID');
    const statusSaatIni = getStatusMode();

    // UI Feedback Cepat
    const resDiv = document.getElementById('scanResult');
    resDiv.classList.remove('hidden');
    document.getElementById('studentName').innerText = "Memproses " + nis + "...";
    
    const payload = { action: "absen", nis: nis, waktu: timeStr, statusMode: statusSaatIni };

    // Jika Offline, masuk antrean
    if (!navigator.onLine) {
        offlineQueue.push(payload);
        localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue));
        
        displayScanRes("Siswa " + nis, statusSaatIni + " (Offline)");
        logs.unshift({ waktu: timeStr, nama: "Siswa " + nis, status: statusSaatIni });
        localStorage.setItem('localLogs', JSON.stringify(logs));
        updateDashboardUI();
        return;
    }

    // Jika Online, kirim ke Google Sheets
    try {
        const response = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify(payload) });
        const data = await response.json();
        if(data.status === 'success') {
            displayScanRes(data.nama, statusSaatIni);
            logs.unshift({ waktu: timeStr, nama: data.nama, status: statusSaatIni });
            localStorage.setItem('localLogs', JSON.stringify(logs));
            updateDashboardUI();
        } else {
            displayScanRes("Siswa Tidak Dikenal!", "GAGAL");
        }
    } catch (e) {
        displayScanRes("Error Jaringan", "GAGAL");
    }
}

function displayScanRes(nama, status) {
    document.getElementById('studentName').innerText = nama;
    const badge = document.getElementById('scanBadge');
    badge.innerText = status;
    badge.className = `px-6 py-2 rounded-full text-lg font-bold ${status.includes('HADIR')?'bg-green-100 text-green-700': (status.includes('TERLAMBAT')?'bg-yellow-100 text-yellow-700':'bg-purple-100 text-purple-700')}`;
    setTimeout(() => document.getElementById('scanResult').classList.add('hidden'), 3500);
}

// 5. SINKRONISASI BATCH OFFLINE
async function syncData() {
    if(offlineQueue.length === 0) return;
    const banner = document.getElementById('offlineBanner');
    banner.classList.remove('hidden');
    banner.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i> Menyinkronkan ${offlineQueue.length} data...`;

    try {
        const res = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: "sync_batch", data: offlineQueue }) });
        const result = await res.json();
        if(result.status === 'success') {
            offlineQueue = [];
            localStorage.setItem('offlineQueue', JSON.stringify([]));
            banner.innerHTML = `<i class="fa-solid fa-check mr-2"></i> Sinkronisasi berhasil!`;
            setTimeout(() => banner.classList.add('hidden'), 3000);
        }
    } catch (e) {
        banner.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-2"></i> Gagal sinkronisasi.`;
        document.getElementById('btnSync').classList.remove('hidden');
    }
}

// 6. DASHBOARD & EXPORT DAPODIK
function updateDashboardUI() {
    let html = ''; let tHadir = 0, tTelat = 0, tPulang = 0;
    logs.forEach(log => {
        if(log.status.includes('HADIR')) tHadir++;
        if(log.status.includes('TERLAMBAT')) tTelat++;
        if(log.status.includes('PULANG')) tPulang++;
    });
    
    logs.slice(0, 15).forEach(log => {
        let color = log.status.includes('HADIR') ? 'text-green-600 font-bold' : (log.status.includes('TERLAMBAT') ? 'text-yellow-600 font-bold' : 'text-slate-600');
        html += `<tr class="border-b"><td class="p-4">${log.waktu}</td><td class="p-4 font-bold text-slate-800">${log.nama}</td><td class="p-4 ${color}">${log.status}</td></tr>`;
    });
    
    document.getElementById('recentLogs').innerHTML = html;
    document.getElementById('dashTotal').innerText = tHadir + tTelat;
    document.getElementById('dashTepat').innerText = tHadir;
    document.getElementById('dashTelat').innerText = tTelat;
    document.getElementById('dashPulang').innerText = tPulang;
}

window.exportToDapodik = function() {
    const data = logs.map((l, i) => ({ "No": i+1, "Tanggal": new Date().toLocaleDateString('id-ID'), "Nama Peserta Didik": l.nama, "Kehadiran": l.status.includes('HADIR')||l.status.includes('TERLAMBAT') ? "Hadir" : "Pulang" }));
    if(data.length===0) return alert("Belum ada data!");
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dapodik");
    XLSX.writeFile(wb, `Dapodik_${new Date().toLocaleDateString('id-ID')}.xlsx`);
}

// 7. BARCODE GENERATOR (Single & Mass)
window.showSingleBarcode = function(nis, nama, kelas) {
    document.getElementById('modalStudentName').innerText = nama;
    document.getElementById('modalStudentClass').innerText = kelas;
    JsBarcode("#singleBarcode", nis, { format: "CODE128", width: 3, height: 80, displayValue: true });
    document.getElementById('barcodeModal').classList.remove('hidden');
    
    // Set for single print
    document.getElementById('massBarcodeContainer').innerHTML = `<div class="text-center p-4 border-2 border-black rounded-xl w-80 mx-auto"><h3 class="font-bold text-lg">${nama}</h3><p class="text-sm mb-4">Kelas: ${kelas}</p><svg id="printSingle"></svg></div>`;
    JsBarcode("#printSingle", nis, { width: 2, height: 60 });
};

window.printBarcodePerClass = function() {
    // Dummy filter logic
    const selectedClass = document.getElementById('filterKelas').value;
    const dummySiswa = [{nis:'101122',nama:'Ahmad Budi',kelas:'10-A'}, {nis:'101123',nama:'Siti Aisyah',kelas:'10-B'}];
    const targetData = dummySiswa.filter(s => s.kelas === selectedClass);
    
    let html = '';
    targetData.forEach((s, i) => {
        html += `<div class="text-center p-4 border-2 border-dashed border-black rounded-xl mb-4"><h3 class="font-bold text-xl">${s.nama}</h3><p class="text-sm font-bold">Kelas: ${s.kelas}</p><svg id="mb-${i}"></svg></div>`;
    });
    
    document.getElementById('massBarcodeContainer').innerHTML = html;
    targetData.forEach((s, i) => JsBarcode(`#mb-${i}`, s.nis, { width: 2, height: 60, displayValue: true }));
    window.print();
};
