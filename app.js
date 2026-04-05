// ====================================================
// SMART ABSEN ENTERPRISE v2.0 - Aplikasi Absensi Profesional
// ====================================================



// ===== 1. PWA & OFFLINE =====
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

// ===== 2. STATE APLIKASI =====
let currentUserRole = '';
let currentUser = null;
let logs = JSON.parse(localStorage.getItem('localLogs')) || [];
let offlineQueue = JSON.parse(localStorage.getItem('offlineQueue')) || [];
let allPages = ['dashboard-page','scan-page','students-page','kelas-page','guru-page','rekap-page','settings-page','profile-page','print-area'];

const defaultSettings = {
    timeLate: "07:15", timeOut: "14:00", timeClose: "08:00", timeOutEnd: "16:00",
    waMasuk: "Assalamualaikum, Ananda *[NAMA]* ([KELAS]) telah HADIR tepat waktu pukul *[WAKTU]*. Terima kasih.",
    waTelat: "Assalamualaikum, Ananda *[NAMA]* ([KELAS]) tercatat TERLAMBAT tiba pukul *[WAKTU]*. Mohon perhatian.",
    waPulang: "Ananda *[NAMA]* ([KELAS]) telah PULANG pukul *[WAKTU]*. Sampai jumpa besok.",
    waAlfa: "Ananda *[NAMA]* ([KELAS]) tidak hadir hari ini ([TANGGAL]). Mohon konfirmasi ke pihak sekolah.",
    waEnable: false, waAdmin: "", autoPulang: false, weekend: true
};

const defaultProfile = {
    name: 'Smart Absen Enterprise', logo: 'https://ui-avatars.com/api/?name=SA&background=0d9488&color=fff&size=200&bold=true',
    npsn: '', tahunAjaran: '2025/2026', alamat: '', kota: '', telp: '', email: '', kepsek: '', nipKepsek: ''
};

// ===== 3. DATA HELPERS =====
function getData(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch(e) { return fallback; }
}
function setData(key, data) { localStorage.setItem(key, JSON.stringify(data)); }

function getSiswa() { return getData('dataSiswa', []); }
function setSiswa(d) { setData('dataSiswa', d); }
function getKelas() { return getData('dataKelas', []); }
function setKelas(d) { setData('dataKelas', d); }
function getGuru() { return getData('dataGuru', []); }
function setGuru(d) { setData('dataGuru', d); }
function getSettings() { return getData('appSettings', defaultSettings); }
function getProfile() { return getData('appProfile', defaultProfile); }
function getAbsensi() { return getData('dataAbsensi', []); }
function setAbsensi(d) { setData('dataAbsensi', d); }
function getJadwal() { return getData('dataJadwal', []); }
function setJadwal(d) { setData('dataJadwal', d); }
function getPengguna() { return getData('dataPengguna', []); }
function setPengguna(d) { setData('dataPengguna', d); }

function genId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); }
function todayStr() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

// ===== 4. TOAST NOTIFICATION =====
function showToast(message, type='success') {
    const container = document.getElementById('toastContainer');
    const colors = {
        success: 'bg-green-500', error: 'bg-red-500', warning: 'bg-amber-500', info: 'bg-primary-500'
    };
    const icons = {
        success: 'fa-circle-check', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info'
    };
    const toast = document.createElement('div');
    toast.className = `toast ${colors[type]} text-white px-5 py-3 rounded-xl shadow-lg flex items-center gap-3 text-sm font-semibold min-w-[280px]`;
    toast.innerHTML = `<i class="fa-solid ${icons[type]}"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { if(toast.parentNode) toast.remove(); }, 3000);
}

// ===== 5. RBAC & NAVIGATION =====
const roleLabels = { admin: 'Administrator', kepsek: 'Kepala Sekolah', piket: 'Guru Piket', wali: 'Wali Kelas', guru: 'Guru' };

const menuConfig = {
    admin: [
        { id: 'dashboard-page', icon: 'fa-chart-line', text: 'Dashboard' },
        { id: 'scan-page', icon: 'fa-id-card', text: 'Mesin Absensi' },
        { id: 'students-page', icon: 'fa-user-graduate', text: 'Data Siswa' },
        { id: 'kelas-page', icon: 'fa-chalkboard', text: 'Data Kelas' },
        { id: 'guru-page', icon: 'fa-user-tie', text: 'Data Guru' },
        { id: 'rekap-page', icon: 'fa-table-list', text: 'Rekap Absensi' },
        { id: 'settings-page', icon: 'fa-sliders', text: 'Pengaturan Sistem' },
        { id: 'profile-page', icon: 'fa-user-circle', text: 'Profil Saya' }
    ],
    kepsek: [
        { id: 'dashboard-page', icon: 'fa-chart-line', text: 'Dashboard' },
        { id: 'rekap-page', icon: 'fa-table-list', text: 'Rekap Absensi' },
        { id: 'students-page', icon: 'fa-user-graduate', text: 'Data Siswa' },
        { id: 'profile-page', icon: 'fa-user-circle', text: 'Profil Saya' }
    ],
    piket: [
        { id: 'dashboard-page', icon: 'fa-chart-line', text: 'Dashboard' },
        { id: 'scan-page', icon: 'fa-id-card', text: 'Mesin Absensi' },
        { id: 'profile-page', icon: 'fa-user-circle', text: 'Profil Saya' }
    ],
    wali: [
        { id: 'dashboard-page', icon: 'fa-chart-line', text: 'Dashboard' },
        { id: 'students-page', icon: 'fa-user-graduate', text: 'Data Siswa Kelas' },
        { id: 'rekap-page', icon: 'fa-table-list', text: 'Rekap Kelas' },
        { id: 'profile-page', icon: 'fa-user-circle', text: 'Profil Saya' }
    ],
    guru: [
        { id: 'dashboard-page', icon: 'fa-chart-line', text: 'Dashboard' },
        { id: 'scan-page', icon: 'fa-id-card', text: 'Mesin Absensi' },
        { id: 'profile-page', icon: 'fa-user-circle', text: 'Profil Saya' }
    ]
};

// ===== 6. LOGIN =====
document.getElementById('btnLogin').addEventListener('click', doLogin);
document.getElementById('adminPassword').addEventListener('keypress', e => { if(e.key==='Enter') doLogin(); });

function doLogin() {
    const nip = document.getElementById('loginNip').value.trim();
    const pass = document.getElementById('adminPassword').value;
    const role = document.getElementById('loginRole').value;
    
    // Cek pengguna terdaftar
    const penggunaList = getPengguna();
    let user = penggunaList.find(u => u.nip === nip);
    
    if (user) {
        if (user.password !== pass) return showToast('Kata sandi salah!', 'error');
        if (user.role !== role) return showToast('Jabatan tidak sesuai dengan NIP!', 'error');
        currentUser = user;
        currentUserRole = user.role;
    } else {
        // Login default untuk demo
        if (pass !== '123456') return showToast('Kata sandi salah! Default: 123456', 'error');
        currentUser = { id: genId(), nama: roleLabels[role], nip: nip || role.toUpperCase(), role: role, telepon: '', email: '' };
        currentUserRole = role;
    }
    
    setData('currentUser', currentUser);
    document.getElementById('login-page').classList.add('hidden');
    document.getElementById('sidebar').classList.remove('hidden');
    
    setupSidebar();
    initSystem();
    showPage(menuConfig[currentUserRole][0].id);
    showToast(`Selamat datang, ${currentUser.nama}!`);
}

function setupSidebar() {
    const badge = document.getElementById('userRoleBadge');
    badge.innerText = roleLabels[currentUserRole] || currentUserRole.toUpperCase();
    const badgeColors = { admin:'bg-rose-500', kepsek:'bg-amber-500', piket:'bg-primary-600', wali:'bg-green-600', guru:'bg-slate-600' };
    badge.className = `text-[10px] mt-2 px-3 py-1 rounded-full inline-block font-bold tracking-wider uppercase text-white ${badgeColors[currentUserRole]||'bg-slate-600'}`;
    
    document.getElementById('sidebarUserName').innerText = currentUser.nama;
    document.getElementById('sidebarUserRole').innerText = roleLabels[currentUserRole];
    document.getElementById('sidebarAvatar').innerText = currentUser.nama.charAt(0).toUpperCase();
    
    const menuUl = document.getElementById('navMenu');
    menuUl.innerHTML = '';
    menuConfig[currentUserRole].forEach((item, i) => {
        const li = document.createElement('li');
        li.innerHTML = `<a href="#" onclick="showPage('${item.id}');return false;" class="sidebar-link flex items-center px-4 py-3 rounded-xl text-slate-400 text-sm font-medium transition" data-page="${item.id}"><i class="fa-solid ${item.icon} w-6 text-center mr-3 text-base"></i>${item.text}</a>`;
        menuUl.appendChild(li);
    });
}

function logout() {
    if(!confirm('Yakin ingin keluar dari sistem?')) return;
    setData('currentUser', null);
    location.reload();
}

// ===== 7. PAGE NAVIGATION =====
function showPage(id) {
    allPages.forEach(p => { const el = document.getElementById(p); if(el) el.classList.add('hidden'); });
    const target = document.getElementById(id);
    if(target) { target.classList.remove('hidden'); target.classList.add('fade-in'); }

function loadAllSettings() {
    loadSettings();
    loadProfileSettings();
    renderJadwalList();
    loadDatabaseConfig(); // Tambahkan pemanggilan ini
}

// Tambahkan blok fungsi Database ini tepat di bawah loadAllSettings()
function getGasUrl() {
    const dbConfig = JSON.parse(localStorage.getItem('dbConfig')) || {};
    return dbConfig.gasUrl || ''; 
}

function getSheetCetakUrl() {
    const dbConfig = JSON.parse(localStorage.getItem('dbConfig')) || {};
    return dbConfig.sheetCetakUrl || '';
}

function loadDatabaseConfig() {
    const dbConfig = JSON.parse(localStorage.getItem('dbConfig')) || {};
    if(document.getElementById('inputGasUrl')) document.getElementById('inputGasUrl').value = dbConfig.gasUrl || '';
    if(document.getElementById('inputSheetCetakUrl')) document.getElementById('inputSheetCetakUrl').value = dbConfig.sheetCetakUrl || '';
}

window.saveDatabaseConfig = function() {
    const gasUrl = document.getElementById('inputGasUrl').value.trim();
    const sheetCetakUrl = document.getElementById('inputSheetCetakUrl').value.trim();
    if(!gasUrl) return showToast('URL Google Apps Script wajib diisi!', 'error');
    
    localStorage.setItem('dbConfig', JSON.stringify({ gasUrl, sheetCetakUrl }));
    showToast('Database berhasil dihubungkan!', 'success');
};

    // Update sidebar active
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    const activeLink = document.querySelector(`.sidebar-link[data-page="${id}"]`);
    if(activeLink) activeLink.classList.add('active');
    
    // Refresh data on page change
    if(id === 'dashboard-page') updateDashboardUI();
    if(id === 'students-page') renderSiswaTable();
    if(id === 'kelas-page') renderKelasCards();
    if(id === 'guru-page') renderGuruTable();
    if(id === 'rekap-page') { initRekapDates(); loadRekapData(); }
    if(id === 'settings-page') loadAllSettings();
    if(id === 'profile-page') loadProfilePage();
    if(id === 'scan-page') setTimeout(() => document.getElementById('scannerInput').focus(), 300);
}

// ===== 8. INITIALIZATION =====
function initSystem() {
    updateOnlineStatus();
    loadProfile();
    loadSettings();
    updateDashboardUI();
    setInterval(updateClock, 1000);
    updateClock();
    
    // Seed demo data jika kosong
    if(getKelas().length === 0) seedDemoData();
}

function updateClock() {
    const now = new Date();
    const el = document.getElementById('clockDisplay');
    if(el) el.innerText = now.toLocaleTimeString('id-ID');
    const dateEl = document.getElementById('dateDisplay');
    if(dateEl) dateEl.innerText = now.toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}

// ===== 9. SEED DEMO DATA =====
function seedDemoData() {
    // Kelas
    const kelasData = [
        { id:genId(), nama:'10-A', tingkat:'10', jurusan:'', waliKelasId:'', tahunAjaran:'2025/2026' },
        { id:genId(), nama:'10-B', tingkat:'10', jurusan:'', waliKelasId:'', tahunAjaran:'2025/2026' },
        { id:genId(), nama:'11-A', tingkat:'11', jurusan:'IPA', waliKelasId:'', tahunAjaran:'2025/2026' },
        { id:genId(), nama:'11-B', tingkat:'11', jurusan:'IPS', waliKelasId:'', tahunAjaran:'2025/2026' },
        { id:genId(), nama:'12-A', tingkat:'12', jurusan:'IPA', waliKelasId:'', tahunAjaran:'2025/2026' },
    ];
    setKelas(kelasData);
    
    // Guru / Pengguna
    const guruData = [
        { id:genId(), nama:'Drs. Ahmad Sudirman, M.Pd', nip:'0001', role:'admin', telepon:'081234567890', email:'admin@sekolah.id', password:'123456', aktif:true },
        { id:genId(), nama:'Siti Rahmawati, S.Pd', nip:'0002', role:'wali', telepon:'081234567891', email:'siti@sekolah.id', password:'123456', aktif:true },
        { id:genId(), nama:'Budi Santoso, S.Pd', nip:'0003', role:'piket', telepon:'081234567892', email:'budi@sekolah.id', password:'123456', aktif:true },
        { id:genId(), nama:'Dra. Fatimah Zahra', nip:'0004', role:'kepsek', telepon:'081234567893', email:'kepsek@sekolah.id', password:'123456', aktif:true },
        { id:genId(), nama:'Eko Prasetyo, S.Pd', nip:'0005', role:'guru', telepon:'081234567894', email:'eko@sekolah.id', password:'123456', aktif:true },
        { id:genId(), nama:'Rina Wulandari, S.Pd', nip:'0006', role:'wali', telepon:'081234567895', email:'rina@sekolah.id', password:'123456', aktif:true },
    ];
    setGuru(guruData);
    setPengguna(guruData);
    
    // Siswa
    const namaSiswa = [
        'Muhammad Rizky','Ahmad Fauzan','Dimas Prayoga','Rafi Aditya','Bayu Saputra',
        'Aisyah Putri','Siti Nurhaliza','Dewi Lestari','Anisa Rahma','Zahra Amelia',
        'Farel Aditya','Galih Pratama','Hendra Wijaya','Irfan Maulana','Joko Widodo',
        'Kartika Sari','Lina Marlina','Maya Angelina','Nadia Putri','Olivia Chen'
    ];
    const siswaData = [];
    namaSiswa.forEach((nama, i) => {
        const kelas = kelasData[i % kelasData.length];
        siswaData.push({
            id: genId(), nis: String(1001+i), nama: nama, jenisKelamin: i < 10 ? 'L' : 'P',
            kelasId: kelas.id, kelasNama: kelas.nama, noOrtu: 'Ortu ' + nama.split(' ')[0],
            teleponOrtu: '08130000' + String(1001+i), alamat: 'Jl. Contoh No. ' + (i+1),
            aktif: true
        });
    });
    setSiswa(siswaData);
    
    // Jadwal default
    const jadwalData = [
        { id:genId(), nama:'Jam 1', mulai:'07:00', selesai:'07:45' },
        { id:genId(), nama:'Jam 2', mulai:'07:45', selesai:'08:30' },
        { id:genId(), nama:'Jam 3', mulai:'08:30', selesai:'09:15' },
        { id:genId(), nama:'Istirahat', mulai:'09:15', selesai:'09:30' },
        { id:genId(), nama:'Jam 4', mulai:'09:30', selesai:'10:15' },
        { id:genId(), nama:'Jam 5', mulai:'10:15', selesai:'11:00' },
        { id:genId(), nama:'Istirahat 2', mulai:'11:00', selesai:'11:15' },
        { id:genId(), nama:'Jam 6', mulai:'11:15', selesai:'12:00' },
        { id:genId(), nama:'Jam 7', mulai:'12:00', selesai:'12:45' },
        { id:genId(), nama:'Jam 8', mulai:'12:45', selesai:'13:30' },
    ];
    setJadwal(jadwalData);
}

// ===== 10. PROFIL & PENGATURAN =====
function loadProfile() {
    const p = getProfile();
    document.getElementById('sidebarSchoolName').innerText = p.name;
    document.getElementById('sidebarLogo').src = p.logo;
    document.getElementById('printSchoolName').innerText = 'KARTU ABSENSI - ' + p.name;
    const addrEl = document.getElementById('printSchoolAddr');
    if(addrEl) addrEl.innerText = p.alamat ? p.alamat + (p.kota ? ', ' + p.kota : '') : '';
}

document.getElementById('uploadLogo')?.addEventListener('change', e => {
    const reader = new FileReader();
    reader.onloadend = () => { document.getElementById('previewLogo').src = reader.result; };
    if(e.target.files[0]) reader.readAsDataURL(e.target.files[0]);
});

function loadSettings() {
    const s = getSettings();
    const ids = ['timeLate','timeOut','timeClose','timeOutEnd','waMasuk','waTelat','waPulang','waAlfa'];
    ids.forEach(id => { const el = document.getElementById(id); if(el) el.value = s[id] || ''; });
    const checks = ['settingAutoPulang','settingWeekend','settingWaEnable'];
    checks.forEach(id => { const el = document.getElementById(id); if(el) el.checked = !!s[id.replace('setting','').toLowerCase()]; });
    const waAdmin = document.getElementById('settingWaAdmin'); if(waAdmin) waAdmin.value = s.waAdmin || '';
}

function loadAllSettings() {
    loadSettings();
    loadProfileSettings();
    renderJadwalList();
}

function loadProfileSettings() {
    const p = getProfile();
    document.getElementById('inputSchoolName').value = p.name;
    document.getElementById('previewLogo').src = p.logo;
    document.getElementById('inputNPSN').value = p.npsn || '';
    document.getElementById('inputTahunAjaran').value = p.tahunAjaran || '';
    document.getElementById('inputAlamat').value = p.alamat || '';
    document.getElementById('inputKota').value = p.kota || '';
    document.getElementById('inputTelp').value = p.telp || '';
    document.getElementById('inputEmail').value = p.email || '';
    document.getElementById('inputKepsek').value = p.kepsek || '';
    document.getElementById('inputNIPKepsek').value = p.nipKepsek || '';
}

window.saveSettings = function() {
    const s = {
        timeLate: document.getElementById('timeLate').value,
        timeOut: document.getElementById('timeOut').value,
        timeClose: document.getElementById('timeClose').value,
        timeOutEnd: document.getElementById('timeOutEnd').value,
        waMasuk: document.getElementById('waMasuk').value,
        waTelat: document.getElementById('waTelat').value,
        waPulang: document.getElementById('waPulang').value,
        waAlfa: document.getElementById('waAlfa').value,
        autoPulang: document.getElementById('settingAutoPulang').checked,
        weekend: document.getElementById('settingWeekend').checked,
        waEnable: document.getElementById('settingWaEnable').checked,
        waAdmin: document.getElementById('settingWaAdmin').value
    };
    setData('appSettings', s);
    showToast('Pengaturan berhasil disimpan!');
};

window.saveProfile = function() {
    const p = {
        name: document.getElementById('inputSchoolName').value,
        logo: document.getElementById('previewLogo').src,
        npsn: document.getElementById('inputNPSN').value,
        tahunAjaran: document.getElementById('inputTahunAjaran').value,
        alamat: document.getElementById('inputAlamat').value,
        kota: document.getElementById('inputKota').value,
        telp: document.getElementById('inputTelp').value,
        email: document.getElementById('inputEmail').value,
        kepsek: document.getElementById('inputKepsek').value,
        nipKepsek: document.getElementById('inputNIPKepsek').value
    };
    setData('appProfile', p);
    loadProfile();
    showToast('Profil sekolah berhasil disimpan!');
};

window.switchSettingsTab = function(tab) {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.remove('hidden');
    document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
};

// ===== KONFIGURASI DATABASE (SaaS) =====
function loadAllSettings() {
    loadSettings();
    loadProfileSettings();
    renderJadwalList();
    loadDatabaseConfig();
}

function getGasUrl() {
    const dbConfig = JSON.parse(localStorage.getItem('dbConfig')) || {};
    return dbConfig.gasUrl || ''; 
}

function getSheetCetakUrl() {
    const dbConfig = JSON.parse(localStorage.getItem('dbConfig')) || {};
    return dbConfig.sheetCetakUrl || '';
}

function loadDatabaseConfig() {
    const dbConfig = JSON.parse(localStorage.getItem('dbConfig')) || {};
    if(document.getElementById('inputGasUrl')) document.getElementById('inputGasUrl').value = dbConfig.gasUrl || '';
    if(document.getElementById('inputSheetCetakUrl')) document.getElementById('inputSheetCetakUrl').value = dbConfig.sheetCetakUrl || '';
}

window.saveDatabaseConfig = function() {
    const gasUrl = document.getElementById('inputGasUrl').value.trim();
    const sheetCetakUrl = document.getElementById('inputSheetCetakUrl').value.trim();
    if(!gasUrl) return showToast('URL Google Apps Script wajib diisi!', 'error');
    
    localStorage.setItem('dbConfig', JSON.stringify({ gasUrl, sheetCetakUrl }));
    showToast('Database berhasil dihubungkan!', 'success');
};

// ===== 11. JADWAL PELAJARAN =====
function renderJadwalList() {
    const jadwal = getJadwal();
    const container = document.getElementById('jadwalList');
    if(!container) return;
    if(jadwal.length === 0) {
        container.innerHTML = '<p class="text-slate-400 text-sm text-center py-6">Belum ada jadwal</p>';
        return;
    }
    container.innerHTML = jadwal.map((j, i) => `
        <div class="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
            <span class="w-8 h-8 bg-primary-100 text-primary-700 rounded-lg flex items-center justify-center text-xs font-bold">${i+1}</span>
            <input type="text" value="${j.nama}" onchange="updateJadwalItem('${j.id}','nama',this.value)" class="flex-1 p-2 border border-slate-200 rounded-lg text-sm input-modern">
            <input type="time" value="${j.mulai}" onchange="updateJadwalItem('${j.id}','mulai',this.value)" class="p-2 border border-slate-200 rounded-lg text-sm input-modern">
            <span class="text-slate-400 text-sm">-</span>
            <input type="time" value="${j.selesai}" onchange="updateJadwalItem('${j.id}','selesai',this.value)" class="p-2 border border-slate-200 rounded-lg text-sm input-modern">
            <button onclick="deleteJadwalItem('${j.id}')" class="text-red-400 hover:text-red-600 transition"><i class="fa-solid fa-trash text-sm"></i></button>
        </div>
    `).join('');
}

window.addJamPelajaran = function() {
    const jadwal = getJadwal();
    jadwal.push({ id: genId(), nama: `Jam ${jadwal.length+1}`, mulai: '00:00', selesai: '00:00' });
    setJadwal(jadwal);
    renderJadwalList();
};

window.updateJadwalItem = function(id, field, value) {
    const jadwal = getJadwal();
    const item = jadwal.find(j => j.id === id);
    if(item) { item[field] = value; setJadwal(jadwal); }
};

window.deleteJadwalItem = function(id) {
    let jadwal = getJadwal();
    jadwal = jadwal.filter(j => j.id !== id);
    setJadwal(jadwal);
    renderJadwalList();
};

window.saveJadwal = function() {
    showToast('Jadwal pelajaran berhasil disimpan!');
};

// ===== 12. PROFIL PENGGUNA =====
function loadProfilePage() {
    if(!currentUser) return;
    document.getElementById('profileNama').value = currentUser.nama;
    document.getElementById('profileNip').value = currentUser.nip;
    document.getElementById('profileTelp').value = currentUser.telepon || '';
    document.getElementById('profileEmail').value = currentUser.email || '';
    document.getElementById('profileRole').value = roleLabels[currentUserRole] || currentUserRole;
}

window.saveProfilPengguna = function() {
    currentUser.nama = document.getElementById('profileNama').value;
    currentUser.telepon = document.getElementById('profileTelp').value;
    currentUser.email = document.getElementById('profileEmail').value;
    setData('currentUser', currentUser);
    
    // Update in pengguna list
    const list = getPengguna();
    const idx = list.findIndex(u => u.id === currentUser.id);
    if(idx >= 0) { list[idx] = { ...list[idx], ...currentUser }; setPengguna(list); }
    
    setupSidebar();
    showToast('Profil berhasil diperbarui!');
};

window.changePassword = function() {
    const old = document.getElementById('oldPass').value;
    const baru = document.getElementById('newPass').value;
    if(old !== '123456' && old !== (currentUser.password || '123456')) return showToast('Kata sandi lama salah!', 'error');
    if(baru.length < 4) return showToast('Kata sandi minimal 4 karakter!', 'warning');
    currentUser.password = baru;
    setData('currentUser', currentUser);
    const list = getPengguna();
    const idx = list.findIndex(u => u.id === currentUser.id);
    if(idx >= 0) { list[idx].password = baru; setPengguna(list); }
    document.getElementById('oldPass').value = '';
    document.getElementById('newPass').value = '';
    showToast('Kata sandi berhasil diubah!');
};

// ===== 13. SCANNER & ABSENSI LOGIC =====
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
document.getElementById('manualNIS')?.addEventListener('keypress', e => { if(e.key==='Enter') manualScan(); });

window.manualScan = function() {
    const nis = document.getElementById('manualNIS').value.trim();
    if(nis) { processScan(nis); document.getElementById('manualNIS').value = ''; }
};

function getStatusMode() {
    const s = getSettings();
    const now = new Date();
    const curMin = now.getHours() * 60 + now.getMinutes();
    const parseM = t => { const p = t.split(':'); return parseInt(p[0])*60 + parseInt(p[1]); };
    const day = now.getDay();
    
    if(s.weekend && (day === 0 || day === 6)) return 'LIBUR';
    if(curMin >= parseM(s.timeOutEnd || '16:00')) return 'TUTUP';
    if(curMin >= parseM(s.timeOut)) return "PULANG";
    if(curMin >= parseM(s.timeClose || '08:00')) return "TUTUP_MASUK";
    if(curMin > parseM(s.timeLate)) return "TERLAMBAT";
    return "HADIR";
}

function processScan(nis) {
    const timeStr = new Date().toLocaleTimeString('id-ID');
    const tanggal = todayStr();
    const statusSaatIni = getStatusMode();
    
    // Cari siswa
    const siswaList = getSiswa();
    const siswa = siswaList.find(s => s.nis === nis);
    
    if(!siswa) {
        displayScanRes('Siswa Tidak Dikenal', 'NIS: ' + nis, 'GAGAL');
        return;
    }
    
    if(!siswa.aktif) {
        displayScanRes(siswa.nama, 'Siswa Non-Aktif', 'NONAKTIF');
        return;
    }
    
    if(statusSaatIni === 'LIBUR') {
        displayScanRes(siswa.nama, 'Hari Libur', 'LIBUR');
        return;
    }
    
    if(statusSaatIni === 'TUTUP') {
        displayScanRes(siswa.nama, 'Absensi Sudah Ditutup', 'TUTUP');
        return;
    }
    
    // Cek sudah absen hari ini
    const absensiList = getAbsensi();
    const todayAbsen = absensiList.find(a => a.siswaId === siswa.id && a.tanggal === tanggal);
    
    if(statusSaatIni === 'PULANG') {
        if(todayAbsen) {
            // Update jam pulang
            todayAbsen.waktuPulang = timeStr;
            todayAbsen.status = 'PULANG';
            setAbsensi(absensiList);
            displayScanRes(siswa.nama, siswa.kelasNama, 'PULANG');
        } else {
            // Belum absen masuk
            displayScanRes(siswa.nama, 'Belum absen masuk', 'WARNING');
        }
    } else {
        if(todayAbsen) {
            displayScanRes(siswa.nama, 'Sudah absen hari ini', 'DUPlikAT');
            return;
        }
        
        const newAbsen = {
            id: genId(), siswaId: siswa.id, nis: siswa.nis, nama: siswa.nama,
            kelas: siswa.kelasNama, tanggal: tanggal, waktuMasuk: timeStr, waktuPulang: '',
            status: statusSaatIni === 'TUTUP_MASUK' ? 'TERLAMBAT' : statusSaatIni,
            keterangan: '', dibuatOleh: currentUser ? currentUser.nama : 'System'
        };
        absensiList.unshift(newAbsen);
        setAbsensi(absensiList);
        
        // Tambah ke localLogs untuk dashboard
        logs.unshift({ waktu: timeStr, nis: siswa.nis, nama: siswa.nama, kelas: siswa.kelasNama, status: newAbsen.status, tanggal: tanggal });
        setData('localLogs', logs);
        
        displayScanRes(siswa.nama, siswa.kelasNama, statusSaatIni === 'TUTUP_MASUK' ? 'TERLAMBAT' : statusSaatIni);
        
        // Kirim ke GAS jika online
        if(navigator.onLine && GAS_URL !== 'URL_APPS_SCRIPT_ANDA_DISINI') {
            fetch(GAS_URL, { method:'POST', body:JSON.stringify({action:'absen',nis:siswa.nis,waktu:timeStr,statusMode:newAbsen.status}) }).catch(()=>{});
        }
    }
    
    // Update recent scans
    renderRecentScans();
    updateDashboardUI();
}

function displayScanRes(nama, kelas, status) {
    const resDiv = document.getElementById('scanResult');
    resDiv.classList.remove('hidden');
    document.getElementById('studentName').innerText = nama;
    document.getElementById('studentNIS').innerText = kelas;
    
    const iconDiv = document.getElementById('scanResultIcon');
    const badge = document.getElementById('scanBadge');
    
    const statusConfig = {
        'HADIR': { color:'bg-green-100 text-green-700', icon:'fa-circle-check text-green-600', bg:'bg-green-50', text:'HADIR TEPAT WAKTU' },
        'TERLAMBAT': { color:'bg-amber-100 text-amber-700', icon:'fa-clock text-amber-600', bg:'bg-amber-50', text:'TERLAMBAT' },
        'PULANG': { color:'bg-purple-100 text-purple-700', icon:'fa-right-from-bracket text-purple-600', bg:'bg-purple-50', text:'PULANG' },
        'GAGAL': { color:'bg-red-100 text-red-700', icon:'fa-circle-xmark text-red-600', bg:'bg-red-50', text:'TIDAK DIKENAL' },
        'LIBUR': { color:'bg-slate-100 text-slate-700', icon:'fa-calendar-xmark text-slate-600', bg:'bg-slate-50', text:'HARI LIBUR' },
        'TUTUP': { color:'bg-red-100 text-red-700', icon:'fa-lock text-red-600', bg:'bg-red-50', text:'DITUTUP' },
        'WARNING': { color:'bg-amber-100 text-amber-700', icon:'fa-triangle-exclamation text-amber-600', bg:'bg-amber-50', text:'PERINGATAN' },
        'DUPLIKAT': { color:'bg-slate-100 text-slate-700', icon:'fa-clone text-slate-600', bg:'bg-slate-50', text:'SUDAH ABSEN' },
        'NONAKTIF': { color:'bg-red-100 text-red-700', icon:'fa-user-slash text-red-600', bg:'bg-red-50', text:'NON-AKTIF' },
    };
    
    const cfg = statusConfig[status] || statusConfig['GAGAL'];
    badge.className = `px-5 py-2 rounded-full text-sm font-bold ${cfg.color}`;
    badge.innerText = cfg.text;
    iconDiv.className = `w-16 h-16 ${cfg.bg} rounded-full mx-auto mb-3 flex items-center justify-center`;
    iconDiv.innerHTML = `<i class="fa-solid ${cfg.icon} text-2xl"></i>`;
    
    setTimeout(() => resDiv.classList.add('hidden'), 4000);
}

function renderRecentScans() {
    const container = document.getElementById('recentScans');
    if(!container) return;
    const todayLogs = logs.filter(l => l.tanggal === todayStr()).slice(0, 8);
    if(todayLogs.length === 0) {
        container.innerHTML = '<p class="text-slate-500 text-xs text-center py-2">Belum ada scan hari ini</p>';
        return;
    }
    container.innerHTML = todayLogs.map(l => {
        const statusColor = l.status.includes('HADIR') ? 'text-green-400' : l.status.includes('TERLAMBAT') ? 'text-amber-400' : 'text-purple-400';
        return `<div class="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2"><span class="text-white text-xs font-medium">${l.nama}</span><div class="text-right"><span class="text-white/40 text-xs">${l.waktu}</span><span class="${statusColor} text-xs font-bold ml-2">${l.status}</span></div></div>`;
    }).join('');
}

// ===== 14. OFFLINE SYNC =====
async function syncData() {
    if(offlineQueue.length === 0) return;
    const banner = document.getElementById('offlineBanner');
    banner.classList.remove('hidden');
    banner.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i> Menyinkronkan ${offlineQueue.length} data...`;
    try {
        if(GAS_URL !== 'URL_APPS_SCRIPT_ANDA_DISINI') {
            const res = await fetch(GAS_URL, { method:'POST', body:JSON.stringify({action:'sync_batch',data:offlineQueue}) });
            const result = await res.json();
            if(result.status === 'success') {
                offlineQueue = []; setData('offlineQueue', []);
                banner.innerHTML = `<i class="fa-solid fa-check mr-2"></i> Sinkronisasi berhasil!`;
                setTimeout(() => banner.classList.add('hidden'), 3000);
            }
        }
    } catch(e) {
        banner.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-2"></i> Gagal sinkronisasi.`;
        document.getElementById('btnSync').classList.remove('hidden');
    }
}

// ===== 15. DASHBOARD =====
function updateDashboardUI() {
    const todayLogs = logs.filter(l => l.tanggal === todayStr());
    let tHadir=0, tTelat=0, tPulang=0, tIzin=0;
    todayLogs.forEach(l => {
        if(l.status.includes('HADIR')) tHadir++;
        else if(l.status.includes('TERLAMBAT')) tTelat++;
        else if(l.status.includes('PULANG')) tPulang++;
        else tIzin++;
    });
    
    const el = (id) => document.getElementById(id);
    if(el('dashTotal')) el('dashTotal').innerText = tHadir + tTelat + tPulang;
    if(el('dashTepat')) el('dashTepat').innerText = tHadir;
    if(el('dashTelat')) el('dashTelat').innerText = tTelat;
    if(el('dashPulang')) el('dashPulang').innerText = tPulang;
    if(el('dashIzin')) el('dashIzin').innerText = tIzin;
    
    const totalSiswa = getSiswa().filter(s => s.aktif).length;
    const totalKelas = getKelas().length;
    if(el('dashTotalSiswa')) el('dashTotalSiswa').innerText = totalSiswa;
    if(el('dashTotalKelas')) el('dashTotalKelas').innerText = totalKelas;
    if(el('dashPersen')) {
        const persen = totalSiswa > 0 ? Math.round(((tHadir+tTelat+tPulang) / totalSiswa) * 100) : 0;
        el('dashPersen').innerText = persen + '%';
    }
    if(el('dashLogCount')) el('dashLogCount').innerText = todayLogs.length + ' entri hari ini';
    if(el('dashDate')) el('dashDate').innerText = new Date().toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    
    // Recent logs table
    const tbody = el('recentLogs');
    if(tbody) {
        if(todayLogs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-400"><i class="fa-solid fa-inbox text-3xl mb-2 block"></i>Belum ada aktivitas hari ini</td></tr>';
        } else {
            tbody.innerHTML = todayLogs.slice(0, 20).map(l => {
                const statusBadge = l.status.includes('HADIR') ? '<span class="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs font-bold">Hadir</span>' :
                    l.status.includes('TERLAMBAT') ? '<span class="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full text-xs font-bold">Terlambat</span>' :
                    l.status.includes('PULANG') ? '<span class="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full text-xs font-bold">Pulang</span>' :
                    '<span class="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full text-xs font-bold">' + l.status + '</span>';
                return `<tr class="table-row border-b border-slate-50"><td class="p-4 text-slate-500">${l.waktu}</td><td class="p-4 font-mono text-xs">${l.nis||'-'}</td><td class="p-4 font-semibold">${l.nama}</td><td class="p-4">${l.kelas||'-'}</td><td class="p-4">${statusBadge}</td></tr>`;
            }).join('');
        }
    }
}

// ===== 16. DATA SISWA (CRUD) =====
function renderSiswaTable() {
    let siswaList = getSiswa();
    const search = document.getElementById('searchSiswa').value.toLowerCase();
    const filterKelas = document.getElementById('filterKelas').value;
    const filterStatus = document.getElementById('filterStatus').value;
    
    if(search) siswaList = siswaList.filter(s => s.nama.toLowerCase().includes(search) || s.nis.includes(search));
    if(filterKelas) siswaList = siswaList.filter(s => s.kelasId === filterKelas);
    if(filterStatus === 'aktif') siswaList = siswaList.filter(s => s.aktif);
    if(filterStatus === 'nonaktif') siswaList = siswaList.filter(s => !s.aktif);
    
    // Wali kelas hanya lihat kelas sendiri
    if(currentUserRole === 'wali') {
        const guru = getGuru().find(g => g.id === currentUser.id);
        if(guru) {
            const kelasWali = getKelas().find(k => k.waliKelasId === guru.id);
            if(kelasWali) siswaList = siswaList.filter(s => s.kelasId === kelasWali.id);
        }
    }
    
    // Populate filter dropdown
    const kelasSelect = document.getElementById('filterKelas');
    const currentVal = kelasSelect.value;
    kelasSelect.innerHTML = '<option value="">Semua Kelas</option>' + getKelas().map(k => `<option value="${k.id}">${k.nama}</option>`).join('');
    kelasSelect.value = currentVal;
    
    // Populate modal dropdown
    const inputKelas = document.getElementById('inputKelas');
    if(inputKelas) inputKelas.innerHTML = '<option value="">-- Pilih Kelas --</option>' + getKelas().map(k => `<option value="${k.id}">${k.nama}</option>`).join('');
    
    const tbody = document.getElementById('tableDataSiswa');
    const emptyEl = document.getElementById('emptySiswa');
    const countEl = document.getElementById('siswaCount');
    
    if(countEl) countEl.innerText = siswaList.length + ' siswa terdaftar';
    
    if(siswaList.length === 0) {
        tbody.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
    }
    emptyEl.classList.add('hidden');
    
    const isAdmin = currentUserRole === 'admin';
    tbody.innerHTML = siswaList.map(s => {
        const statusBadge = s.aktif ? '<span class="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs font-bold">Aktif</span>' : '<span class="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-bold">Non-Aktif</span>';
        const aksi = isAdmin ? `
            <button onclick="editSiswa('${s.id}')" class="text-primary-600 hover:text-primary-800 px-2 py-1 rounded-lg hover:bg-primary-50 transition text-xs font-semibold"><i class="fa-solid fa-pen-to-square mr-1"></i>Edit</button>
            <button onclick="deleteSiswa('${s.id}')" class="text-red-500 hover:text-red-700 px-2 py-1 rounded-lg hover:bg-red-50 transition text-xs font-semibold"><i class="fa-solid fa-trash mr-1"></i>Hapus</button>
            <button onclick="showSingleBarcode('${s.nis}','${s.nama}','${s.kelasNama}')" class="text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg hover:bg-slate-100 transition text-xs font-semibold"><i class="fa-solid fa-barcode"></i></button>
        ` : `<button onclick="showSingleBarcode('${s.nis}','${s.nama}','${s.kelasNama}')" class="text-primary-600 hover:text-primary-800 px-2 py-1 rounded-lg hover:bg-primary-50 transition text-xs font-semibold"><i class="fa-solid fa-barcode mr-1"></i>Barcode</button>`;
        
        return `<tr class="table-row border-b border-slate-50">
            <td class="p-4 font-mono text-xs text-slate-500">${s.nis}</td>
            <td class="p-4 font-semibold">${s.nama}</td>
            <td class="p-4">${s.kelasNama}</td>
            <td class="p-4">${s.jenisKelamin === 'L' ? '<span class="text-primary-600 font-semibold">L</span>' : '<span class="text-pink-600 font-semibold">P</span>'}</td>
            <td class="p-4 text-slate-500 text-xs">${s.teleponOrtu || '-'}</td>
            <td class="p-4">${statusBadge}</td>
            <td class="p-4 text-center space-x-1">${aksi}</td>
        </tr>`;
    }).join('');
    
    // Hide add button for non-admin
    const btnAdd = document.getElementById('btnAddSiswa');
    if(btnAdd) btnAdd.style.display = isAdmin ? '' : 'none';
}

window.openModalSiswa = function(id) {
    document.getElementById('editSiswaId').value = '';
    document.getElementById('modalSiswaTitle').innerText = 'Tambah Siswa Baru';
    document.getElementById('inputNIS').value = '';
    document.getElementById('inputNama').value = '';
    document.getElementById('inputJK').value = 'L';
    document.getElementById('inputOrtu').value = '';
    document.getElementById('inputTelpOrtu').value = '';
    document.getElementById('inputAlamatSiswa').value = '';
    renderSiswaTable(); // refresh dropdown
    document.getElementById('modalSiswa').classList.remove('hidden');
};

window.editSiswa = function(id) {
    const siswa = getSiswa().find(s => s.id === id);
    if(!siswa) return;
    document.getElementById('editSiswaId').value = id;
    document.getElementById('modalSiswaTitle').innerText = 'Edit Siswa';
    document.getElementById('inputNIS').value = siswa.nis;
    document.getElementById('inputNama').value = siswa.nama;
    document.getElementById('inputJK').value = siswa.jenisKelamin;
    document.getElementById('inputKelas').value = siswa.kelasId;
    document.getElementById('inputOrtu').value = siswa.noOrtu;
    document.getElementById('inputTelpOrtu').value = siswa.teleponOrtu;
    document.getElementById('inputAlamatSiswa').value = siswa.alamat;
    document.getElementById('modalSiswa').classList.remove('hidden');
};

window.closeModalSiswa = function() { document.getElementById('modalSiswa').classList.add('hidden'); };

window.saveSiswa = function() {
    const editId = document.getElementById('editSiswaId').value;
    const nis = document.getElementById('inputNIS').value.trim();
    const nama = document.getElementById('inputNama').value.trim();
    const kelasId = document.getElementById('inputKelas').value;
    
    if(!nis || !nama || !kelasId) return showToast('NIS, Nama, dan Kelas wajib diisi!', 'error');
    
    const kelas = getKelas().find(k => k.id === kelasId);
    const siswaList = getSiswa();
    
    // Cek duplikat NIS
    const dupNIS = siswaList.find(s => s.nis === nis && s.id !== editId);
    if(dupNIS) return showToast('NIS sudah terdaftar!', 'error');
    
    if(editId) {
        const idx = siswaList.findIndex(s => s.id === editId);
        if(idx >= 0) {
            siswaList[idx] = { ...siswaList[idx], nis, nama, jenisKelamin: document.getElementById('inputJK').value,
                kelasId, kelasNama: kelas ? kelas.nama : '', noOrtu: document.getElementById('inputOrtu').value,
                teleponOrtu: document.getElementById('inputTelpOrtu').value, alamat: document.getElementById('inputAlamatSiswa').value };
            setSiswa(siswaList);
            showToast('Data siswa berhasil diperbarui!');
        }
    } else {
        siswaList.push({
            id: genId(), nis, nama, jenisKelamin: document.getElementById('inputJK').value,
            kelasId, kelasNama: kelas ? kelas.nama : '', noOrtu: document.getElementById('inputOrtu').value,
            teleponOrtu: document.getElementById('inputTelpOrtu').value, alamat: document.getElementById('inputAlamatSiswa').value, aktif: true
        });
        setSiswa(siswaList);
        showToast('Siswa baru berhasil ditambahkan!');
    }
    closeModalSiswa();
    renderSiswaTable();
};

window.deleteSiswa = function(id) {
    if(!confirm('Yakin ingin menghapus siswa ini?')) return;
    let siswaList = getSiswa().filter(s => s.id !== id);
    setSiswa(siswaList);
    // Also delete absensi
    let absensiList = getAbsensi().filter(a => a.siswaId !== id);
    setAbsensi(absensiList);
    renderSiswaTable();
    showToast('Siswa berhasil dihapus!');
};

// ===== 17. DATA KELAS (CRUD) =====
function renderKelasCards() {
    const kelasList = getKelas();
    const siswaList = getSiswa();
    const guruList = getGuru();
    
    // Populate wali kelas dropdown
    const waliSelect = document.getElementById('inputWaliKelas');
    if(waliSelect) waliSelect.innerHTML = '<option value="">-- Pilih Wali Kelas --</option>' + guruList.map(g => `<option value="${g.id}">${g.nama} (${roleLabels[g.role] || g.role})</option>`).join('');
    
    const container = document.getElementById('kelasCards');
    const emptyEl = document.getElementById('emptyKelas');
    
    if(kelasList.length === 0) { container.innerHTML = ''; emptyEl.classList.remove('hidden'); return; }
    emptyEl.classList.add('hidden');
    
    container.innerHTML = kelasList.map(k => {
        const totalSiswa = siswaList.filter(s => s.kelasId === k.id && s.aktif).length;
        const wali = guruList.find(g => g.id === k.waliKelasId);
        const todayAbsen = getAbsensi().filter(a => a.tanggal === todayStr() && kelasList.find(kk => kk.id === siswaList.find(s => s.id === a.siswaId)?.kelasId)?.id === k.id);
        const hadir = todayAbsen.filter(a => a.status === 'HADIR' || a.status === 'TERLAMBAT').length;
        const persen = totalSiswa > 0 ? Math.round((hadir/totalSiswa)*100) : 0;
        
        const colors = ['from-primary-500 to-teal-600', 'from-slate-600 to-slate-700', 'from-amber-500 to-orange-600', 'from-purple-500 to-indigo-600', 'from-rose-500 to-pink-600'];
        const colorIdx = kelasList.indexOf(k) % colors.length;
        
        return `<div class="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden stat-card">
            <div class="bg-gradient-to-r ${colors[colorIdx]} p-5 text-white">
                <div class="flex items-center justify-between">
                    <div>
                        <h3 class="text-xl font-black">Kelas ${k.nama}</h3>
                        <p class="text-sm text-white/70 mt-0.5">${k.tingkat ? 'Tingkat ' + k.tingkat : ''} ${k.jurusan ? '- ' + k.jurusan : ''}</p>
                    </div>
                    <div class="text-right">
                        <p class="text-2xl font-black">${totalSiswa}</p>
                        <p class="text-xs text-white/70">Siswa</p>
                    </div>
                </div>
            </div>
            <div class="p-5 space-y-3">
                <div class="flex items-center justify-between text-sm">
                    <span class="text-slate-500"><i class="fa-solid fa-user-tie mr-1.5 text-slate-400"></i> Wali Kelas</span>
                    <span class="font-semibold text-slate-700">${wali ? wali.nama : '<span class="text-slate-400">Belum ditentukan</span>'}</span>
                </div>
                <div class="flex items-center justify-between text-sm">
                    <span class="text-slate-500"><i class="fa-solid fa-chart-simple mr-1.5 text-slate-400"></i> Kehadiran Hari Ini</span>
                    <span class="font-bold ${persen >= 80 ? 'text-green-600' : persen >= 60 ? 'text-amber-600' : 'text-red-600'}">${persen}% (${hadir}/${totalSiswa})</span>
                </div>
                <div class="flex gap-2 pt-2">
                    <button onclick="editKelas('${k.id}')" class="flex-1 text-center py-2 rounded-xl bg-slate-50 hover:bg-primary-50 text-slate-600 hover:text-primary-600 text-xs font-semibold transition"><i class="fa-solid fa-pen-to-square mr-1"></i>Edit</button>
                    <button onclick="viewKelasDetail('${k.id}')" class="flex-1 text-center py-2 rounded-xl bg-slate-50 hover:bg-primary-50 text-slate-600 hover:text-primary-600 text-xs font-semibold transition"><i class="fa-solid fa-users mr-1"></i>Detail</button>
                    <button onclick="deleteKelas('${k.id}')" class="flex-1 text-center py-2 rounded-xl bg-slate-50 hover:bg-red-50 text-slate-600 hover:text-red-600 text-xs font-semibold transition"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        </div>`;
    }).join('');
}

window.openModalKelas = function() {
    document.getElementById('editKelasId').value = '';
    document.getElementById('modalKelasTitle').innerText = 'Tambah Kelas Baru';
    document.getElementById('inputNamaKelas').value = '';
    document.getElementById('inputJurusan').value = '';
    document.getElementById('inputWaliKelas').value = '';
    renderKelasCards(); // refresh dropdown
    document.getElementById('modalKelas').classList.remove('hidden');
};

window.editKelas = function(id) {
    const kelas = getKelas().find(k => k.id === id);
    if(!kelas) return;
    document.getElementById('editKelasId').value = id;
    document.getElementById('modalKelasTitle').innerText = 'Edit Kelas';
    document.getElementById('inputNamaKelas').value = kelas.nama;
    document.getElementById('inputTingkat').value = kelas.tingkat;
    document.getElementById('inputJurusan').value = kelas.jurusan;
    renderKelasCards(); // refresh dropdown
    setTimeout(() => { document.getElementById('inputWaliKelas').value = kelas.waliKelasId || ''; }, 50);
    document.getElementById('modalKelas').classList.remove('hidden');
};

window.closeModalKelas = function() { document.getElementById('modalKelas').classList.add('hidden'); };

window.saveKelas = function() {
    const editId = document.getElementById('editKelasId').value;
    const nama = document.getElementById('inputNamaKelas').value.trim();
    if(!nama) return showToast('Nama kelas wajib diisi!', 'error');
    
    const kelasList = getKelas();
    const dup = kelasList.find(k => k.nama === nama && k.id !== editId);
    if(dup) return showToast('Nama kelas sudah ada!', 'error');
    
    if(editId) {
        const idx = kelasList.findIndex(k => k.id === editId);
        if(idx >= 0) {
            kelasList[idx] = { ...kelasList[idx], nama, tingkat: document.getElementById('inputTingkat').value,
                jurusan: document.getElementById('inputJurusan').value, waliKelasId: document.getElementById('inputWaliKelas').value };
            setKelas(kelasList);
            showToast('Kelas berhasil diperbarui!');
        }
    } else {
        kelasList.push({ id: genId(), nama, tingkat: document.getElementById('inputTingkat').value,
            jurusan: document.getElementById('inputJurusan').value, waliKelasId: document.getElementById('inputWaliKelas').value, tahunAjaran: getProfile().tahunAjaran || '2025/2026' });
        setKelas(kelasList);
        showToast('Kelas baru berhasil ditambahkan!');
    }
    closeModalKelas();
    renderKelasCards();
};

window.deleteKelas = function(id) {
    const siswaCount = getSiswa().filter(s => s.kelasId === id).length;
    if(siswaCount > 0) return showToast(`Tidak bisa menghapus kelas! Masih ada ${siswaCount} siswa.`, 'error');
    if(!confirm('Yakin ingin menghapus kelas ini?')) return;
    setKelas(getKelas().filter(k => k.id !== id));
    renderKelasCards();
    showToast('Kelas berhasil dihapus!');
};

window.viewKelasDetail = function(id) {
    const kelas = getKelas().find(k => k.id === id);
    const siswaList = getSiswa().filter(s => s.kelasId === id);
    if(!kelas) return;
    let info = `=== KELAS ${kelas.nama} ===\n\n`;
    siswaList.forEach((s,i) => { info += `${i+1}. ${s.nis} - ${s.nama} (${s.jenisKelamin}) ${s.aktif?'':'[NON-AKTIF]'}\n`; });
    info += `\nTotal: ${siswaList.length} siswa`;
    alert(info);
};

// ===== 18. DATA GURU (CRUD) =====
function renderGuruTable() {
    const guruList = getGuru();
    const tbody = document.getElementById('tableDataGuru');
    const emptyEl = document.getElementById('emptyGuru');
    
    if(guruList.length === 0) { tbody.innerHTML = ''; emptyEl.classList.remove('hidden'); return; }
    emptyEl.classList.add('hidden');
    
    tbody.innerHTML = guruList.map(g => {
        const roleBadge = {
            admin: '<span class="bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full text-xs font-bold">Administrator</span>',
            kepsek: '<span class="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full text-xs font-bold">Kepala Sekolah</span>',
            piket: '<span class="bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full text-xs font-bold">Guru Piket</span>',
            wali: '<span class="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs font-bold">Wali Kelas</span>',
            guru: '<span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full text-xs font-bold">Guru</span>'
        };
        const statusDot = g.aktif !== false ? '<span class="inline-block w-2 h-2 bg-green-500 rounded-full mr-1"></span>' : '<span class="inline-block w-2 h-2 bg-red-500 rounded-full mr-1"></span>';
        return `<tr class="table-row border-b border-slate-50">
            <td class="p-4 font-mono text-xs text-slate-500">${g.nip}</td>
            <td class="p-4 font-semibold">${g.nama}</td>
            <td class="p-4">${roleBadge[g.role] || g.role}</td>
            <td class="p-4 text-slate-500 text-xs">${g.telepon || '-'}</td>
            <td class="p-4 text-slate-500 text-xs">${g.email || '-'}</td>
            <td class="p-4 text-center">${statusDot}${g.aktif !== false ? 'Aktif' : 'Non-Aktif'}</td>
            <td class="p-4 text-center space-x-1">
                <button onclick="editGuru('${g.id}')" class="text-primary-600 hover:text-primary-800 px-2 py-1 rounded-lg hover:bg-primary-50 transition text-xs font-semibold"><i class="fa-solid fa-pen-to-square mr-1"></i>Edit</button>
                <button onclick="deleteGuru('${g.id}')" class="text-red-500 hover:text-red-700 px-2 py-1 rounded-lg hover:bg-red-50 transition text-xs font-semibold"><i class="fa-solid fa-trash mr-1"></i>Hapus</button>
            </td>
        </tr>`;
    }).join('');
}

window.openModalGuru = function() {
    document.getElementById('editGuruId').value = '';
    document.getElementById('modalGuruTitle').innerText = 'Tambah Guru Baru';
    document.getElementById('inputNIPGuru').value = '';
    document.getElementById('inputNamaGuru').value = '';
    document.getElementById('inputRoleGuru').value = 'guru';
    document.getElementById('inputTelpGuru').value = '';
    document.getElementById('inputEmailGuru').value = '';
    document.getElementById('modalGuru').classList.remove('hidden');
};

window.editGuru = function(id) {
    const guru = getGuru().find(g => g.id === id);
    if(!guru) return;
    document.getElementById('editGuruId').value = id;
    document.getElementById('modalGuruTitle').innerText = 'Edit Guru';
    document.getElementById('inputNIPGuru').value = guru.nip;
    document.getElementById('inputNamaGuru').value = guru.nama;
    document.getElementById('inputRoleGuru').value = guru.role;
    document.getElementById('inputTelpGuru').value = guru.telepon || '';
    document.getElementById('inputEmailGuru').value = guru.email || '';
    document.getElementById('modalGuru').classList.remove('hidden');
};

window.closeModalGuru = function() { document.getElementById('modalGuru').classList.add('hidden'); };

window.saveGuru = function() {
    const editId = document.getElementById('editGuruId').value;
    const nip = document.getElementById('inputNIPGuru').value.trim();
    const nama = document.getElementById('inputNamaGuru').value.trim();
    if(!nip || !nama) return showToast('NIP dan Nama wajib diisi!', 'error');
    
    const guruList = getGuru();
    const dup = guruList.find(g => g.nip === nip && g.id !== editId);
    if(dup) return showToast('NIP sudah terdaftar!', 'error');
    
    if(editId) {
        const idx = guruList.findIndex(g => g.id === editId);
        if(idx >= 0) {
            guruList[idx] = { ...guruList[idx], nip, nama, role: document.getElementById('inputRoleGuru').value,
                telepon: document.getElementById('inputTelpGuru').value, email: document.getElementById('inputEmailGuru').value };
            setGuru(guruList);
            setPengguna(guruList);
            showToast('Data guru berhasil diperbarui!');
        }
    } else {
        guruList.push({ id: genId(), nip, nama, role: document.getElementById('inputRoleGuru').value,
            telepon: document.getElementById('inputTelpGuru').value, email: document.getElementById('inputEmailGuru').value,
            password: '123456', aktif: true });
        setGuru(guruList);
        setPengguna(guruList);
        showToast('Guru baru berhasil ditambahkan!');
    }
    closeModalGuru();
    renderGuruTable();
};

window.deleteGuru = function(id) {
    if(!confirm('Yakin ingin menghapus guru ini?')) return;
    setGuru(getGuru().filter(g => g.id !== id));
    setPengguna(getPengguna().filter(g => g.id !== id));
    renderGuruTable();
    showToast('Guru berhasil dihapus!');
};

// ===== 19. REKAP ABSENSI =====
function initRekapDates() {
    const today = todayStr();
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const from = weekAgo.toISOString().split('T')[0];
    document.getElementById('rekapFrom').value = from;
    document.getElementById('rekapTo').value = today;
    
    const rekapKelas = document.getElementById('rekapKelas');
    rekapKelas.innerHTML = '<option value="">Semua Kelas</option>' + getKelas().map(k => `<option value="${k.id}">${k.nama}</option>`).join('');
    
    // Wali kelas: only their class
    if(currentUserRole === 'wali') {
        const guru = getGuru().find(g => g.id === currentUser?.id);
        if(guru) {
            const kelasWali = getKelas().find(k => k.waliKelasId === guru.id);
            if(kelasWali) rekapKelas.value = kelasWali.id;
        }
    }
}

function loadRekapData() {
    const from = document.getElementById('rekapFrom').value;
    const to = document.getElementById('rekapTo').value;
    const kelasId = document.getElementById('rekapKelas').value;
    const status = document.getElementById('rekapStatus').value;
    
    let absensiList = getAbsensi();
    if(from) absensiList = absensiList.filter(a => a.tanggal >= from);
    if(to) absensiList = absensiList.filter(a => a.tanggal <= to);
    if(status) absensiList = absensiList.filter(a => a.status === status);
    if(kelasId) absensiList = absensiList.filter(a => {
        const siswa = getSiswa().find(s => s.id === a.siswaId);
        return siswa && siswa.kelasId === kelasId;
    });
    
    // Summary
    let sHadir=0, sTelat=0, sIzin=0, sSakit=0, sAlfa=0;
    absensiList.forEach(a => {
        if(a.status==='HADIR') sHadir++;
        else if(a.status==='TERLAMBAT') sTelat++;
        else if(a.status==='IZIN') sIzin++;
        else if(a.status==='SAKIT') sSakit++;
        else if(a.status==='ALFA') sAlfa++;
    });
    
    const summaryEl = document.getElementById('rekapSummary');
    summaryEl.innerHTML = `
        <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-100 text-center"><p class="text-xs text-slate-500 font-semibold">Hadir</p><p class="text-xl font-black text-green-600">${sHadir}</p></div>
        <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-100 text-center"><p class="text-xs text-slate-500 font-semibold">Terlambat</p><p class="text-xl font-black text-amber-600">${sTelat}</p></div>
        <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-100 text-center"><p class="text-xs text-slate-500 font-semibold">Izin</p><p class="text-xl font-black text-blue-600">${sIzin}</p></div>
        <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-100 text-center"><p class="text-xs text-slate-500 font-semibold">Sakit</p><p class="text-xl font-black text-purple-600">${sSakit}</p></div>
        <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-100 text-center"><p class="text-xs text-slate-500 font-semibold">Alfa</p><p class="text-xl font-black text-red-600">${sAlfa}</p></div>
    `;
    
    const tbody = document.getElementById('rekapTableBody');
    const emptyEl = document.getElementById('emptyRekap');
    const isAdmin = currentUserRole === 'admin';
    
    if(absensiList.length === 0) {
        tbody.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
    }
    emptyEl.classList.add('hidden');
    
    tbody.innerHTML = absensiList.map((a, i) => {
        const statusBadge = {
            'HADIR': 'bg-green-100 text-green-700', 'TERLAMBAT': 'bg-amber-100 text-amber-700', 'IZIN': 'bg-blue-100 text-blue-700',
            'SAKIT': 'bg-purple-100 text-purple-700', 'ALFA': 'bg-red-100 text-red-700', 'PULANG': 'bg-indigo-100 text-indigo-700'
        };
        const badge = statusBadge[a.status] || 'bg-slate-100 text-slate-700';
        const aksi = isAdmin ? `<button onclick="editAbsen('${a.id}')" class="text-primary-600 hover:text-primary-800 px-2 py-1 rounded-lg hover:bg-primary-50 transition text-xs font-semibold"><i class="fa-solid fa-pen text-xs"></i></button>` : '';
        return `<tr class="table-row border-b border-slate-50">
            <td class="p-3 text-slate-400">${i+1}</td>
            <td class="p-3 text-xs">${a.tanggal}</td>
            <td class="p-3 font-mono text-xs">${a.nis||'-'}</td>
            <td class="p-3 font-semibold">${a.nama}</td>
            <td class="p-3">${a.kelas||'-'}</td>
            <td class="p-3 text-xs">${a.waktuMasuk||'-'}</td>
            <td class="p-3 text-xs">${a.waktuPulang||'-'}</td>
            <td class="p-3"><span class="px-2 py-0.5 rounded-full text-xs font-bold ${badge}">${a.status}</span></td>
            <td class="p-3 text-xs text-slate-500">${a.keterangan||'-'}</td>
            <td class="p-3 text-center">${aksi}</td>
        </tr>`;
    }).join('');
}

window.editAbsen = function(id) {
    const absen = getAbsensi().find(a => a.id === id);
    if(!absen) return;
    document.getElementById('editAbsenId').value = id;
    document.getElementById('editAbsenStatus').value = absen.status;
    document.getElementById('editAbsenKeterangan').value = absen.keterangan || '';
    document.getElementById('modalEditAbsen').classList.remove('hidden');
};

window.closeModalEditAbsen = function() { document.getElementById('modalEditAbsen').classList.add('hidden'); };

window.saveEditAbsen = function() {
    const id = document.getElementById('editAbsenId').value;
    const absensiList = getAbsensi();
    const idx = absensiList.findIndex(a => a.id === id);
    if(idx >= 0) {
        absensiList[idx].status = document.getElementById('editAbsenStatus').value;
        absensiList[idx].keterangan = document.getElementById('editAbsenKeterangan').value;
        setAbsensi(absensiList);
        showToast('Absensi berhasil diperbarui!');
        loadRekapData();
    }
    closeModalEditAbsen();
};

// ===== 20. EXPORT =====
window.exportToDapodik = function() {
    const absensiList = getAbsensi().filter(a => a.tanggal === todayStr());
    if(absensiList.length === 0) return showToast('Belum ada data absensi hari ini!', 'warning');
    
    const data = absensiList.map((a, i) => ({
        "No": i+1, "Tanggal": a.tanggal, "NIS": a.nis,
        "Nama Peserta Didik": a.nama, "Kelas": a.kelas, "Jam Masuk": a.waktuMasuk, "Jam Pulang": a.waktuPulang,
        "Kehadiran": (a.status==='HADIR'||a.status==='TERLAMBAT') ? "Hadir" : a.status
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dapodik");
    XLSX.writeFile(wb, `Dapodik_${todayStr()}.xlsx`);
    showToast('File Dapodik berhasil diekspor!');
};

window.exportRekap = function() {
    const from = document.getElementById('rekapFrom').value;
    const to = document.getElementById('rekapTo').value;
    let absensiList = getAbsensi();
    if(from) absensiList = absensiList.filter(a => a.tanggal >= from);
    if(to) absensiList = absensiList.filter(a => a.tanggal <= to);
    
    if(absensiList.length === 0) return showToast('Tidak ada data untuk diekspor!', 'warning');
    
    const data = absensiList.map((a, i) => ({
        "No": i+1, "Tanggal": a.tanggal, "NIS": a.nis, "Nama": a.nama, "Kelas": a.kelas,
        "Jam Masuk": a.waktuMasuk, "Jam Pulang": a.waktuPulang, "Status": a.status, "Keterangan": a.keterangan
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rekap Absensi");
    XLSX.writeFile(wb, `Rekap_Absensi_${from}_${to}.xlsx`);
    showToast('File rekap berhasil diekspor!');
};

// ===== 21. BARCODE (FIX: Render Canvas In-Memory) =====

// Helper: render barcode ke canvas di dalam memori, tanpa harus masuk ke DOM
function renderBarcodeToImage(nis, options) {
    try {
        const canvas = document.createElement('canvas');
        // Pastikan nis dikonversi menjadi String dengan String(nis)
        JsBarcode(canvas, String(nis), { format: "CODE128", ...options });
        return canvas.toDataURL('image/png');
    } catch(e) {
        console.error('Barcode render error:', e);
        return null;
    }
}

window.showSingleBarcode = function(nis, nama, kelas) {
    document.getElementById('modalStudentName').innerText = nama;
    document.getElementById('modalStudentClass').innerText = 'Kelas ' + kelas;
    
    // 1. Tampilkan di Modal (SVG)
    JsBarcode("#singleBarcode", String(nis), { format:"CODE128", width:3, height:80, displayValue:true, fontSize:14 });
    document.getElementById('barcodeModal').classList.remove('hidden');
    
    // 2. Siapkan untuk Print (Image Base64)
    const barcodeImg = renderBarcodeToImage(String(nis), { width:2, height:60, displayValue:true, fontSize:14 });
    
    document.getElementById('massBarcodeContainer').innerHTML = `
        <div class="text-center p-6 border-2 border-slate-800 rounded-xl w-80 mx-auto mb-4 print-card">
            <p class="text-xs text-slate-500 mb-1" style="font-size:10px;">KARTU ABSENSI SISWA</p>
            <h3 class="font-bold text-lg">${nama}</h3>
            <p class="text-sm mb-1">Kelas: ${kelas}</p>
            <p class="text-xs text-slate-500 mb-4" style="font-size:11px;">NIS: ${nis}</p>
            ${barcodeImg ? `<img src="${barcodeImg}" style="width:250px;height:auto;margin:0 auto;" />` : `<svg id="printSingle"></svg>`}
        </div>`;
    
    if(!barcodeImg) {
        try { JsBarcode("#printSingle", String(nis), { width:2, height:60, displayValue:true }); } catch(e) {}
    }
};

window.printBarcodePerClass = function() {
    const selectedClass = document.getElementById('filterKelas').value;
    if(!selectedClass) return showToast('Pilih kelas terlebih dahulu!', 'warning');
    const siswaList = getSiswa().filter(s => s.kelasId === selectedClass && s.aktif);
    if(siswaList.length === 0) return showToast('Tidak ada siswa aktif di kelas ini!', 'warning');
    
    let html = '';
    siswaList.forEach((s, i) => {
        // Render setiap kartu
        const barcodeImg = renderBarcodeToImage(String(s.nis), { width:2, height:50, displayValue:true, fontSize:12 });
        // Tambahkan "break-inside-avoid" agar kartu tidak terpotong ke halaman berikutnya
        html += `<div class="text-center p-4 border-2 border-slate-800 rounded-xl mb-4 print-card break-inside-avoid" style="page-break-inside: avoid;">
            <p class="text-xs text-slate-500 mb-1" style="font-size:10px;">KARTU ABSENSI SISWA</p>
            <h3 class="font-bold text-base">${s.nama}</h3>
            <p class="text-xs font-semibold" style="font-size:12px;">Kelas: ${s.kelasNama}</p>
            <p class="text-xs text-slate-500 mb-3" style="font-size:10px;">NIS: ${s.nis}</p>
            ${barcodeImg ? `<img src="${barcodeImg}" style="width:220px;height:auto;margin:0 auto;" />` : `<svg id="mb-${i}"></svg>`}
        </div>`;
    });
    
    document.getElementById('massBarcodeContainer').innerHTML = html;
    
    // Fallback jika SVG
    siswaList.forEach((s, i) => {
        const svgEl = document.getElementById('mb-' + i);
        if(svgEl && svgEl.innerHTML === '') {
            try { JsBarcode(svgEl, String(s.nis), { width:2, height:50, displayValue:true }); } catch(e) {}
        }
    });
    
    // Memberikan jeda lebih lama agar browser memuat gambar dengan sempurna sebelum nge-print
    setTimeout(() => window.print(), 500);
};
