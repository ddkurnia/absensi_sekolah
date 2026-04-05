// ====================================================
// SMART ABSEN ENTERPRISE v4.0 - GAS + Firebase Architecture
// Multi-tenant school attendance system
// Firebase = "Brain" (registrations, schools, appConfig)
// Google Apps Script = Per-school database
// ====================================================

// ===== 1. CONSTANTS & FIREBASE CONFIG =====
const DEVELOPER_FIREBASE_CONFIG = {
    apiKey: "YOUR_API_KEY_HERE",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};
const SUPER_ADMIN_PASSWORD = "smartabsen2026";

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

// ===== 2. PWA & OFFLINE =====
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
        syncOfflineData();
    } else {
        banner.classList.remove('hidden');
        btnSync.classList.add('hidden');
    }
}

// ===== 3. STATE MANAGEMENT =====
let currentUserRole = '';
let currentUser = null;
let isSuperAdmin = false;
let logs = JSON.parse(localStorage.getItem('localLogs')) || [];
let offlineQueue = JSON.parse(localStorage.getItem('offlineQueue')) || [];
let allPages = ['dashboard-page','scan-page','students-page','kelas-page','guru-page','rekap-page','settings-page','profile-page','panduan-url-page','print-area'];

// Firebase State (Brain only - no Firebase Auth)
let db = null;
let firebaseReady = false;
let firebaseAppInstance = null;

// School Config (from Firebase schools collection)
let schoolConfig = null; // {gasUrl, sheetUrl, nama, sekolah, nip, isActive}

// Data cache (synced from GAS)
let siswaCache = [];
let kelasCache = [];
let guruCache = [];
let absensiCache = [];
let settingsCache = defaultSettings;
let profileCache = defaultProfile;
let jadwalCache = [];

function getData(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch(e) { return fallback; }
}
function setData(key, data) { localStorage.setItem(key, JSON.stringify(data)); }

function getSiswa() { return siswaCache.length > 0 ? siswaCache : getData('dataSiswa', []); }
function setSiswa(d) { siswaCache = d; setData('dataSiswa', d); }
function getKelas() { return kelasCache.length > 0 ? kelasCache : getData('dataKelas', []); }
function setKelas(d) { kelasCache = d; setData('dataKelas', d); }
function getGuru() { return guruCache.length > 0 ? guruCache : getData('dataGuru', []); }
function setGuru(d) { guruCache = d; setData('dataGuru', d); }
function getPengguna() { return getGuru(); }
function setPengguna(d) { setGuru(d); }
function getSettings() { return settingsCache; }
function getProfile() { return profileCache; }
function getAbsensi() { return absensiCache.length > 0 ? absensiCache : getData('dataAbsensi', []); }
function setAbsensi(d) { absensiCache = d; setData('dataAbsensi', d); }
function getJadwal() { return jadwalCache.length > 0 ? jadwalCache : getData('dataJadwal', []); }
function setJadwal(d) { jadwalCache = d; setData('dataJadwal', d); }

function genId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); }
function todayStr() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

// ===== 4. FIREBASE FUNCTIONS (Brain) =====

async function initFirebase() {
    if (!DEVELOPER_FIREBASE_CONFIG.apiKey || DEVELOPER_FIREBASE_CONFIG.apiKey === 'YOUR_API_KEY_HERE') {
        firebaseReady = false;
        updateFirebaseStatusUI();
        return false;
    }
    try {
        if (firebaseAppInstance) {
            try { firebaseAppInstance.delete(); } catch(e) {}
        }
        firebaseAppInstance = firebase.initializeApp(DEVELOPER_FIREBASE_CONFIG);
        db = firebase.firestore();
        await db.enablePersistence({ synchronizeTabs: true }).catch(err => {
            console.warn('Firestore persistence error:', err.code);
        });
        firebaseReady = true;
        updateFirebaseStatusUI();
        console.log('Firebase (Brain) initialized successfully');
        return true;
    } catch (error) {
        console.error('Firebase init error:', error);
        firebaseReady = false;
        updateFirebaseStatusUI();
        return false;
    }
}

function updateFirebaseStatusUI() {
    const dot = document.getElementById('fbStatusDot');
    const text = document.getElementById('fbStatusText');
    if (dot && text) {
        if (firebaseReady) {
            dot.className = 'w-2 h-2 rounded-full bg-green-400';
            text.className = 'text-green-400';
            text.textContent = 'Server Terhubung';
        } else {
            dot.className = 'w-2 h-2 rounded-full bg-slate-500';
            text.className = 'text-slate-400';
            text.textContent = 'Mode Demo (Server tidak dikonfigurasi)';
        }
    }
    const sDot = document.getElementById('fbSettingsDot');
    const sText = document.getElementById('fbSettingsStatus');
    if (sDot && sText) {
        if (firebaseReady) {
            sDot.className = 'w-3 h-3 rounded-full bg-green-300';
            sText.className = 'text-green-200';
            sText.textContent = 'Firebase Brain: Online | GAS: ' + (schoolConfig && schoolConfig.gasUrl ? 'Terhubung' : 'Belum dikonfigurasi');
        } else {
            sDot.className = 'w-3 h-3 rounded-full bg-white/30';
            sText.className = 'text-white/70';
            sText.textContent = 'Mode Demo Lokal';
        }
    }
}

// --- Registration ---
async function submitRegistration(data) {
    if (!firebaseReady || !db) {
        showToast('Server belum dikonfigurasi. Hubungi developer.', 'error');
        return false;
    }
    try {
        const docRef = db.collection('registrations').doc();
        await docRef.set({
            ...data,
            status: 'pending',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            approvedAt: null,
            rejectedAt: null,
            rejectReason: ''
        });
        return true;
    } catch(e) {
        console.error('submitRegistration error:', e);
        showToast('Gagal mengirim registrasi: ' + e.message, 'error');
        return false;
    }
}

async function checkRegistrationStatus(nip) {
    if (!firebaseReady || !db) return null;
    try {
        const snap = await db.collection('registrations').where('nip', '==', nip).orderBy('createdAt', 'desc').limit(1).get();
        if (snap.empty) return { status: 'not_found' };
        const doc = snap.docs[0];
        return { id: doc.id, ...doc.data() };
    } catch(e) {
        console.error('checkRegistrationStatus error:', e);
        return null;
    }
}

async function getSchoolConfig(nip) {
    if (!firebaseReady || !db) return null;
    try {
        const snap = await db.collection('schools').where('nip', '==', nip).limit(1).get();
        if (snap.empty) return null;
        const doc = snap.docs[0];
        return { id: doc.id, ...doc.data() };
    } catch(e) {
        console.error('getSchoolConfig error:', e);
        return null;
    }
}

// --- Super Admin Functions ---
async function loadPendingRegistrations() {
    if (!firebaseReady || !db) return [];
    try {
        const snap = await db.collection('registrations').where('status', '==', 'pending').orderBy('createdAt', 'desc').get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {
        console.error('loadPendingRegistrations error:', e);
        return [];
    }
}

async function approveRegistration(regId) {
    if (!firebaseReady || !db) return false;
    try {
        const regRef = db.collection('registrations').doc(regId);
        const regDoc = await regRef.get();
        if (!regDoc.exists) return false;
        const regData = regDoc.data();

        // Check NIP uniqueness in schools
        const existingSchool = await db.collection('schools').where('nip', '==', regData.nip).limit(1).get();
        if (!existingSchool.empty) {
            showToast('NIP sudah terdaftar sebagai sekolah!', 'error');
            return false;
        }

        // Create school document
        await db.collection('schools').doc().set({
            nama: regData.nama,
            nip: regData.nip,
            sekolah: regData.sekolah,
            telp: regData.telp || '',
            gasUrl: '',
            sheetUrl: '',
            password: regData.password,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            isActive: true
        });

        // Update registration status
        await regRef.update({
            status: 'approved',
            approvedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return true;
    } catch(e) {
        console.error('approveRegistration error:', e);
        showToast('Gagal menyetujui: ' + e.message, 'error');
        return false;
    }
}

async function rejectRegistration(regId, reason) {
    if (!firebaseReady || !db) return false;
    try {
        await db.collection('registrations').doc(regId).update({
            status: 'rejected',
            rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
            rejectReason: reason || ''
        });
        return true;
    } catch(e) {
        console.error('rejectRegistration error:', e);
        return false;
    }
}

async function loadApprovedSchools() {
    if (!firebaseReady || !db) return [];
    try {
        const snap = await db.collection('schools').orderBy('createdAt', 'desc').get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {
        console.error('loadApprovedSchools error:', e);
        return [];
    }
}

async function updateSchoolConfig(schoolId, data) {
    if (!firebaseReady || !db) return false;
    try {
        await db.collection('schools').doc(schoolId).update(data);
        return true;
    } catch(e) {
        console.error('updateSchoolConfig error:', e);
        return false;
    }
}

async function deleteSchool(schoolId) {
    if (!firebaseReady || !db) return false;
    try {
        await db.collection('schools').doc(schoolId).delete();
        return true;
    } catch(e) {
        console.error('deleteSchool error:', e);
        return false;
    }
}

async function loadAppConfig() {
    if (!firebaseReady || !db) return null;
    try {
        const doc = await db.collection('appConfig').doc('config').get();
        if (doc.exists) return doc.data();
        return { superAdminKey: SUPER_ADMIN_PASSWORD, maintenanceMode: false };
    } catch(e) {
        return null;
    }
}

async function saveAppConfig(data) {
    if (!firebaseReady || !db) return false;
    try {
        await db.collection('appConfig').doc('config').set(data);
        return true;
    } catch(e) {
        return false;
    }
}

// ===== 5. GAS FUNCTIONS (Per-School Database) =====

function getGasUrl() {
    if (schoolConfig && schoolConfig.gasUrl) return schoolConfig.gasUrl;
    const dbConfig = JSON.parse(localStorage.getItem('dbConfig')) || {};
    return dbConfig.gasUrl || '';
}

function getSheetCetakUrl() {
    if (schoolConfig && schoolConfig.sheetUrl) return schoolConfig.sheetUrl;
    const dbConfig = JSON.parse(localStorage.getItem('dbConfig')) || {};
    return dbConfig.sheetCetakUrl || '';
}

async function gasRequest(action, data) {
    const gasUrl = getGasUrl();
    if (!gasUrl) {
        console.warn('GAS URL not configured. Running in demo mode.');
        return null;
    }
    if (!navigator.onLine) {
        console.warn('Offline. Queuing action:', action);
        offlineQueue.push({ action, data, timestamp: new Date().toISOString() });
        setData('offlineQueue', offlineQueue);
        return null;
    }
    try {
        const payload = { action, ...data };
        const res = await fetch(gasUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        return result;
    } catch(e) {
        console.error('GAS request error:', action, e);
        offlineQueue.push({ action, data, timestamp: new Date().toISOString() });
        setData('offlineQueue', offlineQueue);
        return null;
    }
}

async function gasAuth(nip, password, role) {
    const result = await gasRequest('auth', { nip, password, role });
    return result;
}

async function gasGetSiswa() {
    const result = await gasRequest('get_siswa', {});
    if (result && result.status === 'success' && result.data) {
        setSiswa(result.data);
        return result.data;
    }
    return getSiswa();
}

async function gasAddSiswa(data) {
    const result = await gasRequest('add_siswa', { data });
    if (result && result.status === 'success') {
        await gasGetSiswa();
        return true;
    }
    return false;
}

async function gasUpdateSiswa(data) {
    const result = await gasRequest('update_siswa', { data });
    if (result && result.status === 'success') {
        await gasGetSiswa();
        return true;
    }
    return false;
}

async function gasDeleteSiswa(nis) {
    const result = await gasRequest('delete_siswa', { nis });
    if (result && result.status === 'success') {
        await gasGetSiswa();
        return true;
    }
    return false;
}

async function gasGetKelas() {
    const result = await gasRequest('get_kelas', {});
    if (result && result.status === 'success' && result.data) {
        setKelas(result.data);
        return result.data;
    }
    return getKelas();
}

async function gasAddKelas(data) {
    const result = await gasRequest('add_kelas', { data });
    if (result && result.status === 'success') {
        await gasGetKelas();
        return true;
    }
    return false;
}

async function gasUpdateKelas(data) {
    const result = await gasRequest('update_kelas', { data });
    if (result && result.status === 'success') {
        await gasGetKelas();
        return true;
    }
    return false;
}

async function gasDeleteKelas(id) {
    const result = await gasRequest('delete_kelas', { id });
    if (result && result.status === 'success') {
        await gasGetKelas();
        return true;
    }
    return false;
}

async function gasGetGuru() {
    const result = await gasRequest('get_guru', {});
    if (result && result.status === 'success' && result.data) {
        setGuru(result.data);
        setPengguna(result.data);
        return result.data;
    }
    return getGuru();
}

async function gasAddGuru(data) {
    const result = await gasRequest('add_guru', { data });
    if (result && result.status === 'success') {
        await gasGetGuru();
        return true;
    }
    return false;
}

async function gasUpdateGuru(data) {
    const result = await gasRequest('update_guru', { data });
    if (result && result.status === 'success') {
        await gasGetGuru();
        return true;
    }
    return false;
}

async function gasDeleteGuru(nip) {
    const result = await gasRequest('delete_guru', { nip });
    if (result && result.status === 'success') {
        await gasGetGuru();
        return true;
    }
    return false;
}

async function gasAbsen(nis, waktu, statusMode) {
    const result = await gasRequest('absen', { nis, waktu, statusMode });
    if (result && result.status === 'success') {
        return result;
    }
    return null;
}

async function gasGetAbsensi(dari, sampai) {
    const result = await gasRequest('get_absensi', { dari, sampai });
    if (result && result.status === 'success' && result.data) {
        setAbsensi(result.data);
        return result.data;
    }
    return getAbsensi();
}

async function gasDashboard() {
    const result = await gasRequest('dashboard', {});
    if (result && result.status === 'success' && result.data) {
        return result.data;
    }
    return null;
}

// ===== 6. TOAST NOTIFICATION =====
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

// ===== 7. RBAC & NAVIGATION =====
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
        { id: 'panduan-url-page', icon: 'fa-link', text: 'Panduan URL' },
        { id: 'profile-page', icon: 'fa-user-circle', text: 'Profil Saya' }
    ],
    kepsek: [
        { id: 'dashboard-page', icon: 'fa-chart-line', text: 'Dashboard' },
        { id: 'rekap-page', icon: 'fa-table-list', text: 'Rekap Absensi' },
        { id: 'students-page', icon: 'fa-user-graduate', text: 'Data Siswa' },
        { id: 'panduan-url-page', icon: 'fa-link', text: 'Panduan URL' },
        { id: 'profile-page', icon: 'fa-user-circle', text: 'Profil Saya' }
    ],
    piket: [
        { id: 'dashboard-page', icon: 'fa-chart-line', text: 'Dashboard' },
        { id: 'scan-page', icon: 'fa-id-card', text: 'Mesin Absensi' },
        { id: 'panduan-url-page', icon: 'fa-link', text: 'Panduan URL' },
        { id: 'profile-page', icon: 'fa-user-circle', text: 'Profil Saya' }
    ],
    wali: [
        { id: 'dashboard-page', icon: 'fa-chart-line', text: 'Dashboard' },
        { id: 'students-page', icon: 'fa-user-graduate', text: 'Data Siswa Kelas' },
        { id: 'rekap-page', icon: 'fa-table-list', text: 'Rekap Kelas' },
        { id: 'panduan-url-page', icon: 'fa-link', text: 'Panduan URL' },
        { id: 'profile-page', icon: 'fa-user-circle', text: 'Profil Saya' }
    ],
    guru: [
        { id: 'dashboard-page', icon: 'fa-chart-line', text: 'Dashboard' },
        { id: 'scan-page', icon: 'fa-id-card', text: 'Mesin Absensi' },
        { id: 'panduan-url-page', icon: 'fa-link', text: 'Panduan URL' },
        { id: 'profile-page', icon: 'fa-user-circle', text: 'Profil Saya' }
    ]
};

// ===== 8. LOGIN SYSTEM =====
if(getKelas().length === 0) seedDemoData();
checkFirstRun();
initFirebase().then(() => {
    console.log('Firebase (Brain) init attempt complete. Ready:', firebaseReady);
});

document.getElementById('btnLogin').addEventListener('click', doLogin);
document.getElementById('adminPassword').addEventListener('keypress', e => { if(e.key==='Enter') doLogin(); });

async function doLogin() {
    const nip = document.getElementById('loginNip').value.trim();
    const pass = document.getElementById('adminPassword').value;
    const role = document.getElementById('loginRole').value;

    if(!nip) return showToast('NIP / ID Pegawai wajib diisi!', 'warning');
    if(!pass) return showToast('Kata sandi wajib diisi!', 'warning');

    // ---- FIREBASE + GAS MODE ----
    if (firebaseReady && db) {
        try {
            // Check if it's demo user (NIP 0001) with demo mode
            if (nip === '0001' && pass === '123456') {
                const penggunaList = getPengguna();
                const localUser = penggunaList.find(u => u.nip === nip);
                if (localUser) {
                    currentUser = localUser;
                    currentUserRole = localUser.role;
                    schoolConfig = null;
                    finishLogin();
                    return;
                }
            }

            // Check Firebase for approved school with matching admin NIP
            const schoolDataFromDb = await getSchoolConfig(nip);
            if (!schoolDataFromDb) {
                // Check registration status
                const regStatus = await checkRegistrationStatus(nip);
                if (regStatus && regStatus.status === 'pending') {
                    showToast('Registrasi Anda masih menunggu persetujuan dari developer.', 'warning');
                    return;
                } else if (regStatus && regStatus.status === 'rejected') {
                    showToast('Registrasi Anda ditolak. Alasan: ' + (regStatus.rejectReason || 'Tidak disebutkan'), 'error');
                    return;
                }
                showToast('NIP tidak terdaftar. Silakan daftar atau cek NIP Anda.', 'error');
                return;
            }

            if (!schoolDataFromDb.isActive) {
                showToast('Sekolah Anda dinonaktifkan. Hubungi developer.', 'error');
                return;
            }

            // Check password
            if (schoolDataFromDb.password !== pass) {
                showToast('Kata sandi salah!', 'error');
                return;
            }

            // Get school config
            schoolConfig = schoolDataFromDb;
            setData('schoolConfig', schoolConfig);

            // Try GAS authentication
            if (schoolConfig.gasUrl) {
                const gasResult = await gasAuth(nip, pass, role);
                if (gasResult && gasResult.status === 'success' && gasResult.user) {
                    currentUser = gasResult.user;
                    currentUserRole = gasResult.user.role || role;
                    // Cache guru data from GAS response
                    if (gasResult.guru) setGuru(gasResult.guru);
                    if (gasResult.siswa) setSiswa(gasResult.siswa);
                    if (gasResult.kelas) setKelas(gasResult.kelas);
                    if (gasResult.absensi) setAbsensi(gasResult.absensi);
                    if (gasResult.settings) settingsCache = { ...defaultSettings, ...gasResult.settings };
                    if (gasResult.profile) profileCache = { ...defaultProfile, ...gasResult.profile };
                } else {
                    // GAS failed, but school config is valid - login as admin with school data
                    currentUser = {
                        id: schoolDataFromDb.id,
                        nama: schoolDataFromDb.nama,
                        nip: schoolDataFromDb.nip,
                        role: 'admin',
                        telepon: schoolDataFromDb.telp || ''
                    };
                    currentUserRole = 'admin';
                    showToast('GAS belum dikonfigurasi. Mode lokal aktif.', 'info');
                }
            } else {
                // No GAS URL yet, login as admin locally
                currentUser = {
                    id: schoolDataFromDb.id,
                    nama: schoolDataFromDb.nama,
                    nip: schoolDataFromDb.nip,
                    role: 'admin',
                    telepon: schoolDataFromDb.telp || ''
                };
                currentUserRole = 'admin';
                showToast('GAS URL belum dikonfigurasi. Silakan setting di Pengaturan.', 'info');
            }

            // Set profile from school config
            profileCache = { ...defaultProfile, name: schoolConfig.sekolah || schoolConfig.nama };
            setData('appProfile', profileCache);

            finishLogin();
            return;
        } catch(error) {
            console.error('Login error:', error);
            showToast('Error login: ' + error.message, 'error');
            return;
        }
    }

    // ---- DEMO / LOCAL MODE (no Firebase) ----
    const penggunaList = getPengguna();
    let user = penggunaList.find(u => u.nip === nip);

    if (user) {
        if(user.password === undefined || user.password === null || user.password === '') {
            user.password = '123456';
            setPengguna(penggunaList);
        }
        if (user.password !== pass) return showToast('Kata sandi salah!', 'error');
        if (user.aktif === false) return showToast('Akun dinonaktifkan. Hubungi administrator.', 'error');
        if (user.role !== role && role !== 'admin') return showToast('Jabatan tidak sesuai dengan NIP! Pilih: ' + roleLabels[user.role], 'error');
        currentUser = user;
        currentUserRole = user.role;
    } else {
        showToast('NIP tidak terdaftar di sistem lokal.', 'error');
        return;
    }

    schoolConfig = null;
    finishLogin();
}

function finishLogin() {
    setData('currentUser', currentUser);
    if (schoolConfig) setData('schoolConfig', schoolConfig);
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
    const badgeColors = { superadmin:'bg-purple-600', admin:'bg-rose-500', kepsek:'bg-amber-500', piket:'bg-primary-600', wali:'bg-green-600', guru:'bg-slate-600' };
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
    isSuperAdmin = false;
    schoolConfig = null;
    location.reload();
}

// ===== 9. REGISTRATION SYSTEM =====
function toggleRegisterForm() {
    const form = document.getElementById('registerForm');
    if(form) {
        form.classList.toggle('hidden');
        document.getElementById('btnShowRegister').classList.toggle('hidden');
    }
}

window.checkRegStatus = async function() {
    const nip = document.getElementById('loginNip').value.trim();
    if (!nip) return showToast('Masukkan NIP terlebih dahulu!', 'warning');
    if (!firebaseReady) return showToast('Server belum dikonfigurasi.', 'error');

    showToast('Memeriksa status registrasi...', 'info');
    const status = await checkRegistrationStatus(nip);
    if (!status) {
        showToast('Gagal memeriksa status.', 'error');
        return;
    }
    if (status.status === 'not_found') {
        showToast('NIP tidak ditemukan dalam registrasi.', 'warning');
    } else if (status.status === 'pending') {
        showToast('Registrasi Anda masih MENUNGGU persetujuan developer.', 'info');
    } else if (status.status === 'approved') {
        showToast('Registrasi Anda sudah DISETUJUI! Silakan login.', 'success');
    } else if (status.status === 'rejected') {
        showToast('Registrasi Anda DITOLAK. Alasan: ' + (status.rejectReason || 'Tidak disebutkan'), 'error');
    }
};

window.doRegister = async function() {
    const nama = document.getElementById('regNama').value.trim();
    const nip = document.getElementById('regNip').value.trim();
    const pass = document.getElementById('regPassword').value;
    const pass2 = document.getElementById('regPassword2').value;
    const sekolah = document.getElementById('regSekolah').value.trim();
    const telp = document.getElementById('regTelp').value.trim();

    if(!nama) return showToast('Nama lengkap wajib diisi!', 'warning');
    if(!nip) return showToast('NIP wajib diisi!', 'warning');
    if(nip.length < 3) return showToast('NIP minimal 3 karakter!', 'warning');
    if(!sekolah) return showToast('Nama sekolah wajib diisi!', 'warning');
    if(!pass) return showToast('Kata sandi wajib diisi!', 'warning');
    if(pass.length < 4) return showToast('Kata sandi minimal 4 karakter!', 'warning');
    if(pass !== pass2) return showToast('Kata sandi tidak cocok!', 'error');

    // ---- FIREBASE REGISTRATION (pending approval) ----
    if (firebaseReady && db) {
        showToast('Mengirim registrasi...', 'info');
        const success = await submitRegistration({ nama, nip, sekolah, telp, password: pass });
        if (success) {
            showToast('Registrasi berhasil! Menunggu persetujuan dari developer. Anda akan dihubungi.', 'success');
            toggleRegisterForm();
            return;
        }
        return;
    }

    // ---- LOCAL MODE (demo) ----
    const penggunaList = getPengguna();
    if(penggunaList.find(u => u.nip === nip)) return showToast('NIP sudah terdaftar! Gunakan NIP lain.', 'error');

    const newAdmin = {
        id: genId(), nama: nama, nip: nip, role: 'admin',
        telepon: telp, email: '', password: pass, aktif: true, sekolah: sekolah
    };
    penggunaList.push(newAdmin);
    setPengguna(penggunaList);
    setGuru(penggunaList);

    if(sekolah) {
        const p = getProfile();
        p.name = sekolah;
        setData('appProfile', p);
    }

    showToast('Registrasi berhasil (mode demo)! Silakan login dengan NIP: ' + nip, 'success');
    document.getElementById('loginNip').value = nip;
    document.getElementById('adminPassword').value = pass;
    toggleRegisterForm();
};

function checkFirstRun() {
    const registered = localStorage.getItem('appRegistered');
    if(!registered) {
        const hint = document.getElementById('registerHint');
        if(hint) hint.classList.remove('hidden');
    }
}

// ===== 10. SUPER ADMIN (MOVED TO master-admin.html) =====
// Super admin panel telah dipindahkan ke file master-admin.html yang terpisah.
// Gunakan master-admin.html untuk mengelola registrasi sekolah, konfigurasi Firebase, dll.

// ===== 11. PAGE NAVIGATION =====
function showPage(id) {
    allPages.forEach(p => { const el = document.getElementById(p); if(el) el.classList.add('hidden'); });
    const target = document.getElementById(id);
    if(target) { target.classList.remove('hidden'); target.classList.add('fade-in'); }

    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    const activeLink = document.querySelector(`.sidebar-link[data-page="${id}"]`);
    if(activeLink) activeLink.classList.add('active');

    if(id === 'dashboard-page') updateDashboardUI();
    if(id === 'students-page') renderSiswaTable();
    if(id === 'kelas-page') renderKelasCards();
    if(id === 'guru-page') renderGuruTable();
    if(id === 'rekap-page') { initRekapDates(); loadRekapData(); }
    if(id === 'settings-page') loadAllSettings();
    if(id === 'profile-page') loadProfilePage();
    if(id === 'panduan-url-page') loadPanduanPage();
    if(id === 'scan-page') setTimeout(() => document.getElementById('scannerInput').focus(), 300);
}

// ===== 12. INITIALIZATION =====
async function initSystem() {
    updateOnlineStatus();
    await loadProfile();
    await loadSettingsFromCache();
    updateDashboardUI();
    setInterval(updateClock, 1000);
    updateClock();

    // Sync data from GAS if configured
    if (schoolConfig && schoolConfig.gasUrl && navigator.onLine) {
        syncDataFromGAS();
    }
}

async function syncDataFromGAS() {
    try {
        await Promise.all([
            gasGetSiswa(),
            gasGetKelas(),
            gasGetGuru(),
            gasGetAbsensi(todayStr(), todayStr())
        ]);
        updateDashboardUI();
        console.log('Data synced from GAS');
    } catch(e) {
        console.warn('GAS sync failed, using cached data:', e);
    }
}

function updateClock() {
    const now = new Date();
    const el = document.getElementById('clockDisplay');
    if(el) el.innerText = now.toLocaleTimeString('id-ID');
    const dateEl = document.getElementById('dateDisplay');
    if(dateEl) dateEl.innerText = now.toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}

async function loadSettingsFromCache() {
    settingsCache = getData('appSettings', defaultSettings);
    profileCache = getData('appProfile', defaultProfile);
}

// ===== 13. SEED DEMO DATA =====
function seedDemoData() {
    const kelasData = [
        { id:genId(), nama:'10-A', tingkat:'10', jurusan:'', waliKelasId:'', tahunAjaran:'2025/2026' },
        { id:genId(), nama:'10-B', tingkat:'10', jurusan:'', waliKelasId:'', tahunAjaran:'2025/2026' },
        { id:genId(), nama:'11-A', tingkat:'11', jurusan:'IPA', waliKelasId:'', tahunAjaran:'2025/2026' },
        { id:genId(), nama:'11-B', tingkat:'11', jurusan:'IPS', waliKelasId:'', tahunAjaran:'2025/2026' },
        { id:genId(), nama:'12-A', tingkat:'12', jurusan:'IPA', waliKelasId:'', tahunAjaran:'2025/2026' },
    ];
    setKelas(kelasData);

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

// ===== 14. PROFILE & SETTINGS =====
async function loadProfile() {
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

async function loadSettings() {
    const s = getSettings();
    const ids = ['timeLate','timeOut','timeClose','timeOutEnd','waMasuk','waTelat','waPulang','waAlfa'];
    ids.forEach(id => { const el = document.getElementById(id); if(el) el.value = s[id] || ''; });
    const checks = ['settingAutoPulang','settingWeekend','settingWaEnable'];
    checks.forEach(id => { const el = document.getElementById(id); if(el) el.checked = !!s[id.replace('setting','').toLowerCase()]; });
    const waAdmin = document.getElementById('settingWaAdmin'); if(waAdmin) waAdmin.value = s.waAdmin || '';
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

window.saveSettings = async function() {
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
    settingsCache = s;
    setData('appSettings', s);

    // Try to save to GAS
    if (getGasUrl()) {
        await gasRequest('save_settings', { data: s });
    }

    showToast('Pengaturan berhasil disimpan!');
};

window.saveProfile = async function() {
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
    profileCache = p;
    setData('appProfile', p);
    await loadProfile();
    showToast('Profil sekolah berhasil disimpan!');
};

window.switchSettingsTab = function(tab) {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.remove('hidden');
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
    if (tabBtn) tabBtn.classList.add('active');

    if (tab === 'firebase') {
        updateFirebaseStatusUI();
    }
    if (tab === 'database') {
        loadDatabaseConfig();
    }
};

function loadDatabaseConfig() {
    if(document.getElementById('inputGasUrl')) document.getElementById('inputGasUrl').value = getGasUrl();
    if(document.getElementById('inputSheetCetakUrl')) document.getElementById('inputSheetCetakUrl').value = getSheetCetakUrl();
}

window.saveDatabaseConfig = async function() {
    const gasUrl = document.getElementById('inputGasUrl').value.trim();
    const sheetCetakUrl = document.getElementById('inputSheetCetakUrl').value.trim();

    if(!gasUrl) return showToast('URL Google Apps Script wajib diisi!', 'error');

    // Save locally
    localStorage.setItem('dbConfig', JSON.stringify({ gasUrl, sheetCetakUrl }));

    // Update school config in Firebase if we have a school ID
    if (schoolConfig && schoolConfig.id && firebaseReady) {
        await updateSchoolConfig(schoolConfig.id, { gasUrl, sheetUrl: sheetCetakUrl });
        schoolConfig.gasUrl = gasUrl;
        schoolConfig.sheetUrl = sheetCetakUrl;
        setData('schoolConfig', schoolConfig);
    } else if (schoolConfig) {
        schoolConfig.gasUrl = gasUrl;
        schoolConfig.sheetUrl = sheetCetakUrl;
        setData('schoolConfig', schoolConfig);
    }

    showToast('Database berhasil dihubungkan! Data akan disinkronkan.', 'success');

    // Trigger sync
    if (navigator.onLine) {
        syncDataFromGAS();
    }
};

// --- Stubs for legacy HTML buttons (Firebase config is now hardcoded) ---
window.connectFirebase = function() {
    showToast('Firebase sudah dikonfigurasi (hardcoded). Tidak perlu koneksi manual.', 'info');
    initFirebase();
};
window.disconnectFirebase = function() {
    showToast('Firebase tidak bisa diputuskan dalam arsitektur baru. Firebase adalah "Brain" sistem.', 'warning');
};
window.testFirebaseConnection = async function() {
    const resultDiv = document.getElementById('firebaseTestResult');
    if (resultDiv) {
        if (firebaseReady) {
            resultDiv.classList.remove('hidden');
            resultDiv.innerHTML = `
                <div class="space-y-3">
                    <div class="flex items-center gap-3 text-green-600 font-bold">
                        <i class="fa-solid fa-circle-check text-xl"></i>
                        <span>Firebase Brain Terhubung!</span>
                    </div>
                    <div class="text-sm text-slate-600 space-y-1">
                        <p><i class="fa-solid fa-server mr-2 text-slate-400"></i>Project: <strong>${DEVELOPER_FIREBASE_CONFIG.projectId}</strong></p>
                        <p><i class="fa-solid fa-brain mr-2 text-slate-400"></i>Mode: Firebase Brain + GAS Per-School</p>
                        <p><i class="fa-solid fa-database mr-2 text-slate-400"></i>Firestore: <span class="text-green-600 font-semibold">Online</span></p>
                    </div>
                </div>
            `;
        } else {
            resultDiv.classList.remove('hidden');
            resultDiv.innerHTML = `
                <div class="flex items-center gap-3 text-red-600 font-bold">
                    <i class="fa-solid fa-circle-xmark text-xl"></i>
                    <span>Firebase Belum Dikonfigurasi!</span>
                </div>
                <p class="text-sm text-slate-500 mt-2">Ubah DEVELOPER_FIREBASE_CONFIG di app.js baris pertama.</p>
            `;
        }
    }
};

// ===== 15. JADWAL PELAJARAN =====
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

// ===== 16. PROFIL PENGGUNA =====
function loadProfilePage() {
    if(!currentUser) return;
    document.getElementById('profileNama').value = currentUser.nama;
    document.getElementById('profileNip').value = currentUser.nip;
    document.getElementById('profileTelp').value = currentUser.telepon || '';
    document.getElementById('profileEmail').value = currentUser.email || '';
    document.getElementById('profileRole').value = roleLabels[currentUserRole] || currentUserRole;
}

window.saveProfilPengguna = async function() {
    currentUser.nama = document.getElementById('profileNama').value;
    currentUser.telepon = document.getElementById('profileTelp').value;
    currentUser.email = document.getElementById('profileEmail').value;
    setData('currentUser', currentUser);

    // Try update via GAS
    if (getGasUrl() && currentUser.nip) {
        await gasUpdateGuru({
            nip: currentUser.nip,
            nama: currentUser.nama,
            telepon: currentUser.telepon,
            email: currentUser.email
        });
    }

    const list = getPengguna();
    const idx = list.findIndex(u => u.nip === currentUser.nip);
    if(idx >= 0) { list[idx] = { ...list[idx], nama: currentUser.nama, telepon: currentUser.telepon, email: currentUser.email }; setPengguna(list); }

    setupSidebar();
    showToast('Profil berhasil diperbarui!');
};

window.changePassword = async function() {
    const old = document.getElementById('oldPass').value;
    const baru = document.getElementById('newPass').value;
    if(old !== currentUser.password) return showToast('Kata sandi lama salah!', 'error');
    if(baru.length < 4) return showToast('Kata sandi minimal 4 karakter!', 'warning');
    currentUser.password = baru;
    setData('currentUser', currentUser);

    // Update in GAS
    if (getGasUrl() && currentUser.nip) {
        await gasUpdateGuru({ nip: currentUser.nip, password: baru });
    }

    // Update in Firebase schools collection
    if (schoolConfig && schoolConfig.id && firebaseReady) {
        await updateSchoolConfig(schoolConfig.id, { password: baru });
    }

    document.getElementById('oldPass').value = '';
    document.getElementById('newPass').value = '';
    showToast('Kata sandi berhasil diubah!');
};

// ===== 17. SCANNER & ATTENDANCE LOGIC =====
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

async function processScan(nis) {
    const timeStr = new Date().toLocaleTimeString('id-ID');
    const tanggal = todayStr();
    const statusSaatIni = getStatusMode();

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

    const absensiList = getAbsensi();
    const todayAbsen = absensiList.find(a => a.nis === nis && a.tanggal === tanggal);

    if(statusSaatIni === 'PULANG') {
        if(todayAbsen) {
            todayAbsen.waktuPulang = timeStr;
            todayAbsen.status = 'PULANG';
            setAbsensi(absensiList);

            // Send to GAS
            if (getGasUrl() && navigator.onLine) {
                gasAbsen(nis, timeStr, 'PULANG');
            } else {
                offlineQueue.push({ action: 'absen', data: { nis, waktu: timeStr, statusMode: 'PULANG' } });
                setData('offlineQueue', offlineQueue);
            }

            displayScanRes(siswa.nama, siswa.kelasNama, 'PULANG');
        } else {
            displayScanRes(siswa.nama, 'Belum absen masuk', 'WARNING');
        }
    } else {
        if(todayAbsen) {
            displayScanRes(siswa.nama, 'Sudah absen hari ini', 'DUPLIKAT');
            return;
        }

        const newAbsen = {
            id: genId(), siswaId: siswa.id, nis: siswa.nis, nama: siswa.nama,
            kelas: siswa.kelasNama, tanggal: tanggal, waktuMasuk: timeStr, waktuPulang: '',
            status: statusSaatIni === 'TUTUP_MASUK' ? 'TERLAMBAT' : statusSaatIni,
            keterangan: '', dibuatOleh: currentUser ? currentUser.nama : 'System'
        };

        // Send to GAS
        if (getGasUrl() && navigator.onLine) {
            gasAbsen(nis, timeStr, newAbsen.status);
        } else {
            offlineQueue.push({ action: 'absen', data: { nis, waktu: timeStr, statusMode: newAbsen.status } });
            setData('offlineQueue', offlineQueue);
        }

        absensiList.unshift(newAbsen);
        setAbsensi(absensiList);

        logs.unshift({ waktu: timeStr, nis: siswa.nis, nama: siswa.nama, kelas: siswa.kelasNama, status: newAbsen.status, tanggal: tanggal });
        setData('localLogs', logs);

        displayScanRes(siswa.nama, siswa.kelasNama, statusSaatIni === 'TUTUP_MASUK' ? 'TERLAMBAT' : statusSaatIni);
    }

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

// ===== 18. OFFLINE SYNC =====
// Alias for HTML button onclick
function syncData() { syncOfflineData(); }

async function syncOfflineData() {
    if(offlineQueue.length === 0) return;
    const banner = document.getElementById('offlineBanner');
    banner.classList.remove('hidden');
    banner.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i> Menyinkronkan ${offlineQueue.length} data...`;

    const gasUrl = getGasUrl();
    if(gasUrl) {
        try {
            const res = await fetch(gasUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'sync_batch', data: offlineQueue })
            });
            const result = await res.json();
            if(result.status === 'success') {
                offlineQueue = [];
                setData('offlineQueue', []);
                banner.innerHTML = `<i class="fa-solid fa-check mr-2"></i> Sinkronisasi berhasil!`;
                // Refresh data from GAS
                syncDataFromGAS();
                setTimeout(() => banner.classList.add('hidden'), 3000);
            } else {
                throw new Error('Sync failed');
            }
        } catch(e) {
            banner.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-2"></i> Gagal sinkronisasi. Coba lagi.`;
            document.getElementById('btnSync').classList.remove('hidden');
        }
    } else {
        banner.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-2"></i> Gagal: GAS URL belum dikonfigurasi.`;
        document.getElementById('btnSync').classList.remove('hidden');
        setTimeout(() => { if(navigator.onLine) banner.classList.add('hidden'); }, 5000);
    }
}

// ===== 19. DASHBOARD =====
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

// ===== 20. DATA SISWA CRUD (via GAS) =====
function renderSiswaTable() {
    let siswaList = getSiswa();
    const search = document.getElementById('searchSiswa').value.toLowerCase();
    const filterKelas = document.getElementById('filterKelas').value;
    const filterStatus = document.getElementById('filterStatus').value;

    if(search) siswaList = siswaList.filter(s => s.nama.toLowerCase().includes(search) || s.nis.includes(search));
    if(filterKelas) siswaList = siswaList.filter(s => s.kelasId === filterKelas);
    if(filterStatus === 'aktif') siswaList = siswaList.filter(s => s.aktif);
    if(filterStatus === 'nonaktif') siswaList = siswaList.filter(s => !s.aktif);

    if(currentUserRole === 'wali') {
        const guru = getGuru().find(g => g.nip === currentUser?.nip || g.id === currentUser?.id);
        if(guru) {
            const kelasWali = getKelas().find(k => k.waliKelasId === guru.id || k.waliKelasId === guru.nip);
            if(kelasWali) siswaList = siswaList.filter(s => s.kelasId === kelasWali.id);
        }
    }

    const kelasSelect = document.getElementById('filterKelas');
    const currentVal = kelasSelect.value;
    kelasSelect.innerHTML = '<option value="">Semua Kelas</option>' + getKelas().map(k => `<option value="${k.id}">${k.nama}</option>`).join('');
    kelasSelect.value = currentVal;

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

    const canEdit = currentUserRole === 'admin';
    tbody.innerHTML = siswaList.map(s => {
        const statusBadge = s.aktif ? '<span class="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs font-bold">Aktif</span>' : '<span class="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-bold">Non-Aktif</span>';
        const aksi = canEdit ? `
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

    const btnAdd = document.getElementById('btnAddSiswa');
    if(btnAdd) btnAdd.style.display = canEdit ? '' : 'none';
}

window.openModalSiswa = function() {
    document.getElementById('editSiswaId').value = '';
    document.getElementById('modalSiswaTitle').innerText = 'Tambah Siswa Baru';
    document.getElementById('inputNIS').value = '';
    document.getElementById('inputNama').value = '';
    document.getElementById('inputJK').value = 'L';
    document.getElementById('inputOrtu').value = '';
    document.getElementById('inputTelpOrtu').value = '';
    document.getElementById('inputAlamatSiswa').value = '';
    renderSiswaTable();
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

window.saveSiswa = async function() {
    const editId = document.getElementById('editSiswaId').value;
    const nis = document.getElementById('inputNIS').value.trim();
    const nama = document.getElementById('inputNama').value.trim();
    const kelasId = document.getElementById('inputKelas').value;

    if(!nis || !nama || !kelasId) return showToast('NIS, Nama, dan Kelas wajib diisi!', 'error');

    const kelas = getKelas().find(k => k.id === kelasId);
    const siswaList = getSiswa();

    const dupNIS = siswaList.find(s => s.nis === nis && s.id !== editId);
    if(dupNIS) return showToast('NIS sudah terdaftar!', 'error');

    if(editId) {
        const idx = siswaList.findIndex(s => s.id === editId);
        if(idx >= 0) {
            const updated = { ...siswaList[idx], nis, nama, jenisKelamin: document.getElementById('inputJK').value,
                kelasId, kelasNama: kelas ? kelas.nama : '', noOrtu: document.getElementById('inputOrtu').value,
                teleponOrtu: document.getElementById('inputTelpOrtu').value, alamat: document.getElementById('inputAlamatSiswa').value };
            siswaList[idx] = updated;
            setSiswa(siswaList);

            if (getGasUrl()) {
                const success = await gasUpdateSiswa(updated);
                if (success) showToast('Data siswa berhasil diperbarui!');
                else showToast('Data disimpan lokal. Sinkronisasi tertunda.', 'info');
            } else {
                showToast('Data siswa berhasil diperbarui (lokal)!');
            }
        }
    } else {
        const newSiswa = {
            id: genId(), nis, nama, jenisKelamin: document.getElementById('inputJK').value,
            kelasId, kelasNama: kelas ? kelas.nama : '', noOrtu: document.getElementById('inputOrtu').value,
            teleponOrtu: document.getElementById('inputTelpOrtu').value, alamat: document.getElementById('inputAlamatSiswa').value, aktif: true
        };
        siswaList.push(newSiswa);
        setSiswa(siswaList);

        if (getGasUrl()) {
            const success = await gasAddSiswa(newSiswa);
            if (success) showToast('Siswa baru berhasil ditambahkan!');
            else showToast('Data disimpan lokal. Sinkronisasi tertunda.', 'info');
        } else {
            showToast('Siswa baru berhasil ditambahkan (lokal)!');
        }
    }
    closeModalSiswa();
    renderSiswaTable();
};

window.deleteSiswa = async function(id) {
    if(!confirm('Yakin ingin menghapus siswa ini?')) return;
    const siswa = getSiswa().find(s => s.id === id);
    let siswaList = getSiswa().filter(s => s.id !== id);
    setSiswa(siswaList);

    if (getGasUrl() && siswa) {
        await gasDeleteSiswa(siswa.nis);
    }

    let absensiList = getAbsensi().filter(a => a.siswaId !== id);
    setAbsensi(absensiList);
    renderSiswaTable();
    showToast('Siswa berhasil dihapus!');
};

// ===== 21. DATA KELAS CRUD (via GAS) =====
function renderKelasCards() {
    const kelasList = getKelas();
    const siswaList = getSiswa();
    const guruList = getGuru();

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
    renderKelasCards();
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
    renderKelasCards();
    setTimeout(() => { document.getElementById('inputWaliKelas').value = kelas.waliKelasId || ''; }, 50);
    document.getElementById('modalKelas').classList.remove('hidden');
};

window.closeModalKelas = function() { document.getElementById('modalKelas').classList.add('hidden'); };

window.saveKelas = async function() {
    const editId = document.getElementById('editKelasId').value;
    const nama = document.getElementById('inputNamaKelas').value.trim();
    if(!nama) return showToast('Nama kelas wajib diisi!', 'error');

    const kelasList = getKelas();
    const dup = kelasList.find(k => k.nama === nama && k.id !== editId);
    if(dup) return showToast('Nama kelas sudah ada!', 'error');

    if(editId) {
        const idx = kelasList.findIndex(k => k.id === editId);
        if(idx >= 0) {
            const updated = { ...kelasList[idx], nama, tingkat: document.getElementById('inputTingkat').value,
                jurusan: document.getElementById('inputJurusan').value, waliKelasId: document.getElementById('inputWaliKelas').value };
            kelasList[idx] = updated;
            setKelas(kelasList);
            if (getGasUrl()) await gasUpdateKelas(updated);
            showToast('Kelas berhasil diperbarui!');
        }
    } else {
        const newKelas = { id: genId(), nama, tingkat: document.getElementById('inputTingkat').value,
            jurusan: document.getElementById('inputJurusan').value, waliKelasId: document.getElementById('inputWaliKelas').value, tahunAjaran: getProfile().tahunAjaran || '2025/2026' };
        kelasList.push(newKelas);
        setKelas(kelasList);
        if (getGasUrl()) await gasAddKelas(newKelas);
        showToast('Kelas baru berhasil ditambahkan!');
    }
    closeModalKelas();
    renderKelasCards();
};

window.deleteKelas = async function(id) {
    const siswaCount = getSiswa().filter(s => s.kelasId === id).length;
    if(siswaCount > 0) return showToast(`Tidak bisa menghapus kelas! Masih ada ${siswaCount} siswa.`, 'error');
    if(!confirm('Yakin ingin menghapus kelas ini?')) return;
    const kelasList = getKelas().filter(k => k.id !== id);
    setKelas(kelasList);
    if (getGasUrl()) await gasDeleteKelas(id);
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

// ===== 22. DATA GURU CRUD (via GAS) =====
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
                <button onclick="resetPasswordGuru('${g.id}')" class="text-amber-600 hover:text-amber-800 px-2 py-1 rounded-lg hover:bg-amber-50 transition text-xs font-semibold"><i class="fa-solid fa-key mr-1"></i>Sandi</button>
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
    document.getElementById('inputPasswordGuru').value = '';
    document.getElementById('inputPasswordGuru').removeAttribute('disabled');
    document.getElementById('pwdRequiredHint').classList.remove('hidden');
    document.getElementById('pwdEditHint').classList.add('hidden');
    document.getElementById('inputNIPGuru').removeAttribute('disabled');
    document.getElementById('modalGuru').classList.remove('hidden');
};

window.editGuru = function(id) {
    const guru = getGuru().find(g => g.id === id || g.nip === id);
    if(!guru) return;
    document.getElementById('editGuruId').value = guru.id || id;
    document.getElementById('modalGuruTitle').innerText = 'Edit Guru';
    document.getElementById('inputNIPGuru').value = guru.nip;
    document.getElementById('inputNIPGuru').setAttribute('disabled', 'true');
    document.getElementById('inputNamaGuru').value = guru.nama;
    document.getElementById('inputRoleGuru').value = guru.role;
    document.getElementById('inputTelpGuru').value = guru.telepon || '';
    document.getElementById('inputEmailGuru').value = guru.email || '';
    document.getElementById('inputPasswordGuru').value = '';
    document.getElementById('inputPasswordGuru').removeAttribute('disabled');
    document.getElementById('pwdRequiredHint').classList.add('hidden');
    document.getElementById('pwdEditHint').classList.remove('hidden');
    document.getElementById('modalGuru').classList.remove('hidden');
};

window.closeModalGuru = function() { document.getElementById('modalGuru').classList.add('hidden'); };

window.saveGuru = async function() {
    const editId = document.getElementById('editGuruId').value;
    const nip = document.getElementById('inputNIPGuru').value.trim();
    const nama = document.getElementById('inputNamaGuru').value.trim();
    const role = document.getElementById('inputRoleGuru').value;
    const password = document.getElementById('inputPasswordGuru').value;
    if(!nip || !nama) return showToast('NIP dan Nama wajib diisi!', 'error');
    if(!editId && !password) return showToast('Kata sandi wajib diisi untuk guru baru!', 'error');
    if(password && password.length < 4) return showToast('Kata sandi minimal 4 karakter!', 'error');

    const guruList = getGuru();
    const dup = guruList.find(g => g.nip === nip && g.id !== editId);
    if(dup) return showToast('NIP sudah terdaftar!', 'error');

    if(editId) {
        const idx = guruList.findIndex(g => g.id === editId);
        if(idx >= 0) {
            const updated = { ...guruList[idx], nip, nama, role,
                telepon: document.getElementById('inputTelpGuru').value, email: document.getElementById('inputEmailGuru').value };
            // Only update password if a new one is provided
            if(password) updated.password = password;
            updated.aktif = updated.aktif !== false;
            guruList[idx] = updated;
            setGuru(guruList);
            if (getGasUrl()) await gasUpdateGuru(updated);
            showToast('Data guru berhasil diperbarui!');
        }
    } else {
        const newGuru = { id: genId(), nip, nama, role,
            telepon: document.getElementById('inputTelpGuru').value, email: document.getElementById('inputEmailGuru').value,
            password: password, aktif: true };
        guruList.push(newGuru);
        setGuru(guruList);
        if (getGasUrl()) await gasAddGuru(newGuru);
        showToast('Guru baru berhasil ditambahkan!');
    }
    closeModalGuru();
    renderGuruTable();
};

window.resetPasswordGuru = async function(id) {
    const newPwd = prompt('Masukkan kata sandi baru (min. 4 karakter):');
    if(!newPwd) return;
    if(newPwd.length < 4) return showToast('Kata sandi minimal 4 karakter!', 'error');
    const guruList = getGuru();
    const idx = guruList.findIndex(g => g.id === id);
    if(idx >= 0) {
        guruList[idx].password = newPwd;
        setGuru(guruList);
        if (getGasUrl()) await gasUpdateGuru(guruList[idx]);
        showToast('Kata sandi guru berhasil direset!');
    }
};

window.togglePwdVisibility = function(inputId, btn) {
    const input = document.getElementById(inputId);
    if(input.type === 'password') {
        input.type = 'text';
        btn.innerHTML = '<i class="fa-solid fa-eye-slash text-sm"></i>';
    } else {
        input.type = 'password';
        btn.innerHTML = '<i class="fa-solid fa-eye text-sm"></i>';
    }
};

window.deleteGuru = async function(id) {
    if(!confirm('Yakin ingin menghapus guru ini?')) return;
    const guru = getGuru().find(g => g.id === id);
    const guruList = getGuru().filter(g => g.id !== id);
    setGuru(guruList);
    if (getGasUrl() && guru) await gasDeleteGuru(guru.nip);
    renderGuruTable();
    showToast('Guru berhasil dihapus!');
};

// ===== 23. REKAP ABSENSI =====
function initRekapDates() {
    const today = todayStr();
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const from = weekAgo.toISOString().split('T')[0];
    document.getElementById('rekapFrom').value = from;
    document.getElementById('rekapTo').value = today;

    const rekapKelas = document.getElementById('rekapKelas');
    rekapKelas.innerHTML = '<option value="">Semua Kelas</option>' + getKelas().map(k => `<option value="${k.id}">${k.nama}</option>`).join('');

    if(currentUserRole === 'wali') {
        const guru = getGuru().find(g => g.id === currentUser?.id || g.nip === currentUser?.nip);
        if(guru) {
            const kelasWali = getKelas().find(k => k.waliKelasId === guru.id || k.waliKelasId === guru.nip);
            if(kelasWali) rekapKelas.value = kelasWali.id;
        }
    }
}

async function loadRekapData() {
    const from = document.getElementById('rekapFrom').value;
    const to = document.getElementById('rekapTo').value;
    const kelasId = document.getElementById('rekapKelas').value;
    const status = document.getElementById('rekapStatus').value;

    // Try fetching from GAS if configured
    if (getGasUrl() && navigator.onLine && from && to) {
        await gasGetAbsensi(from, to);
    }

    let absensiList = getAbsensi();
    if(from) absensiList = absensiList.filter(a => a.tanggal >= from);
    if(to) absensiList = absensiList.filter(a => a.tanggal <= to);
    if(status) absensiList = absensiList.filter(a => a.status === status);
    if(kelasId) absensiList = absensiList.filter(a => {
        const siswa = getSiswa().find(s => s.id === a.siswaId || s.nis === a.nis);
        return siswa && siswa.kelasId === kelasId;
    });

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

window.saveEditAbsen = async function() {
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

// ===== 24. EXPORT =====
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

window.exportToGoogleSheet = function() {
    const sheetUrl = getSheetCetakUrl();
    if(!sheetUrl) {
        return showToast('URL Google Sheet belum disetting di menu Pengaturan Sistem > Integrasi Database!', 'warning');
    }
    const from = document.getElementById('rekapFrom').value;
    const to = document.getElementById('rekapTo').value;
    showToast('Membuka Google Sheet untuk melihat/mengekspor rekap...', 'info');
    // Open sheet with optional date range parameters in URL hash
    const urlHash = (from && to) ? `#range=${from}_${to}` : '';
    window.open(sheetUrl + urlHash, '_blank');
};

// ===== 25. BARCODE =====
window.showSingleBarcode = function(nis, nama, kelas) {
    const sheetUrl = getSheetCetakUrl();
    if(!sheetUrl) {
        return showToast('URL Sheet Cetak belum disetting di menu Pengaturan Sistem > Integrasi Database!', 'warning');
    }
    showToast('Membuka database pusat untuk cetak...', 'info');
    window.open(sheetUrl, '_blank');
};

window.printBarcodePerClass = function() {
    const selectedClass = document.getElementById('filterKelas').value;
    if(!selectedClass) return showToast('Pilih kelas terlebih dahulu!', 'warning');

    const sheetUrl = getSheetCetakUrl();
    if(!sheetUrl) {
        return showToast('URL Sheet Cetak belum disetting di menu Pengaturan Sistem > Integrasi Database!', 'warning');
    }
    showToast('Membuka Google Sheets... Silakan tekan Ctrl+P di sana.', 'info');
    window.open(sheetUrl, '_blank');
};

// ===== 17. PANDUAN URL GAS & SHEET =====
function loadPanduanPage() {
    const currentGasUrl = getGasUrl();
    const currentSheetUrl = getSheetCetakUrl();

    // Set input values
    const gasInput = document.getElementById('panduanGasUrl');
    const sheetInput = document.getElementById('panduanSheetUrl');
    if (gasInput) gasInput.value = currentGasUrl;
    if (sheetInput) sheetInput.value = currentSheetUrl;

    // Update status
    updatePanduanStatus(currentGasUrl);

    // Show/hide external links
    const sheetLink = document.getElementById('panduanSheetLink');
    const gasLink = document.getElementById('panduanGasLink');
    if (sheetLink) {
        if (currentSheetUrl) {
            sheetLink.href = currentSheetUrl;
            sheetLink.classList.remove('hidden');
        } else {
            sheetLink.classList.add('hidden');
        }
    }
    if (gasLink) {
        if (currentGasUrl) {
            // Extract script ID from GAS URL to create Apps Script editor link
            const match = currentGasUrl.match(/\/macros\/s\/([^/]+)/);
            if (match) {
                gasLink.href = 'https://script.google.com/d/' + match[1] + '/edit';
                gasLink.classList.remove('hidden');
            } else {
                gasLink.classList.add('hidden');
            }
        } else {
            gasLink.classList.add('hidden');
        }
    }

    // Hide test result
    const testResult = document.getElementById('gasTestResult');
    if (testResult) testResult.classList.add('hidden');
}

function updatePanduanStatus(gasUrl) {
    const icon = document.getElementById('panduanStatusIcon');
    const title = document.getElementById('panduanStatusTitle');
    const desc = document.getElementById('panduanStatusDesc');
    const badge = document.getElementById('panduanStatusBadge');

    if (gasUrl && gasUrl.length > 10) {
        if (icon) icon.className = 'w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center';
        if (icon) icon.innerHTML = '<i class="fa-solid fa-plug-circle-check text-2xl text-green-600"></i>';
        if (title) title.textContent = 'Terhubung ke Google Apps Script';
        if (desc) desc.textContent = 'Data absensi akan disinkronkan ke Google Sheet sekolah.';
        if (badge) badge.className = 'px-4 py-2 rounded-full text-xs font-bold bg-green-100 text-green-700';
        if (badge) badge.textContent = 'ONLINE';
    } else {
        if (icon) icon.className = 'w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center';
        if (icon) icon.innerHTML = '<i class="fa-solid fa-plug-circle-xmark text-2xl text-slate-400"></i>';
        if (title) title.textContent = 'Belum Terhubung';
        if (desc) desc.textContent = 'Google Apps Script belum dikonfigurasi. Data menggunakan mode lokal.';
        if (badge) badge.className = 'px-4 py-2 rounded-full text-xs font-bold bg-slate-100 text-slate-500';
        if (badge) badge.textContent = 'OFFLINE';
    }
}

window.savePanduanUrl = async function() {
    const gasUrl = document.getElementById('panduanGasUrl').value.trim();
    const sheetUrl = document.getElementById('panduanSheetUrl').value.trim();

    if (!gasUrl) {
        return showToast('URL Google Apps Script wajib diisi!', 'error');
    }

    // Validate GAS URL format
    if (!gasUrl.includes('script.google.com')) {
        return showToast('Format URL GAS tidak valid. Pastikan URL dimulai dengan https://script.google.com/macros/s/...', 'error');
    }

    // Show loading
    showToast('Menyimpan konfigurasi...', 'info');

    // Save locally
    localStorage.setItem('dbConfig', JSON.stringify({ gasUrl, sheetCetakUrl: sheetUrl }));

    // Update school config in Firebase if available
    if (schoolConfig && schoolConfig.id && firebaseReady) {
        await updateSchoolConfig(schoolConfig.id, { gasUrl, sheetUrl: sheetUrl });
        schoolConfig.gasUrl = gasUrl;
        schoolConfig.sheetUrl = sheetUrl;
        setData('schoolConfig', schoolConfig);
    } else if (schoolConfig) {
        schoolConfig.gasUrl = gasUrl;
        schoolConfig.sheetUrl = sheetUrl;
        setData('schoolConfig', schoolConfig);
    }

    // Update status display
    updatePanduanStatus(gasUrl);

    // Show/hide external links
    const sheetLink = document.getElementById('panduanSheetLink');
    const gasLink = document.getElementById('panduanGasLink');
    if (sheetLink && sheetUrl) {
        sheetLink.href = sheetUrl;
        sheetLink.classList.remove('hidden');
    }
    if (gasLink && gasUrl) {
        const match = gasUrl.match(/\/macros\/s\/([^/]+)/);
        if (match) {
            gasLink.href = 'https://script.google.com/d/' + match[1] + '/edit';
            gasLink.classList.remove('hidden');
        }
    }

    showToast('Database berhasil dihubungkan! Data akan disinkronkan.', 'success');

    // Trigger sync
    if (navigator.onLine) {
        syncDataFromGAS();
    }
};

window.resetPanduanUrl = function() {
    if (!confirm('Yakin ingin menghapus konfigurasi URL GAS & Sheet? Data akan kembali ke mode lokal.')) return;

    // Clear local config
    localStorage.removeItem('dbConfig');

    // Clear school config URLs if in Firebase mode
    if (schoolConfig && schoolConfig.id && firebaseReady) {
        updateSchoolConfig(schoolConfig.id, { gasUrl: '', sheetUrl: '' });
        schoolConfig.gasUrl = '';
        schoolConfig.sheetUrl = '';
        setData('schoolConfig', schoolConfig);
    } else if (schoolConfig) {
        schoolConfig.gasUrl = '';
        schoolConfig.sheetUrl = '';
        setData('schoolConfig', schoolConfig);
    }

    // Update UI
    const gasInput = document.getElementById('panduanGasUrl');
    const sheetInput = document.getElementById('panduanSheetUrl');
    if (gasInput) gasInput.value = '';
    if (sheetInput) sheetInput.value = '';
    updatePanduanStatus('');

    const sheetLink = document.getElementById('panduanSheetLink');
    const gasLink = document.getElementById('panduanGasLink');
    if (sheetLink) sheetLink.classList.add('hidden');
    if (gasLink) gasLink.classList.add('hidden');

    showToast('Koneksi database telah direset. Mode lokal aktif.', 'info');
};

window.testGasConnection = async function() {
    const gasUrl = document.getElementById('panduanGasUrl').value.trim();
    const testResult = document.getElementById('gasTestResult');
    const btnTest = document.getElementById('btnTestGas');

    if (!gasUrl) {
        if (testResult) {
            testResult.classList.remove('hidden');
            testResult.className = 'mt-2 p-3 rounded-xl text-sm bg-red-50 text-red-700 border border-red-200';
            testResult.innerHTML = '<i class="fa-solid fa-times-circle mr-2"></i>Masukkan URL GAS terlebih dahulu!';
        }
        return;
    }

    if (!navigator.onLine) {
        if (testResult) {
            testResult.classList.remove('hidden');
            testResult.className = 'mt-2 p-3 rounded-xl text-sm bg-amber-50 text-amber-700 border border-amber-200';
            testResult.innerHTML = '<i class="fa-solid fa-wifi mr-2"></i>Tidak ada koneksi internet. Tidak dapat melakukan test.';
        }
        return;
    }

    // Show loading state
    if (btnTest) {
        btnTest.disabled = true;
        btnTest.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Testing...';
    }
    if (testResult) {
        testResult.classList.remove('hidden');
        testResult.className = 'mt-2 p-3 rounded-xl text-sm bg-slate-50 text-slate-600 border border-slate-200';
        testResult.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Menguji koneksi ke Google Apps Script...';
    }

    try {
        const res = await fetch(gasUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'ping' })
        });

        if (res.ok) {
            const data = await res.json().catch(() => null);
            if (testResult) {
                testResult.classList.remove('hidden');
                testResult.className = 'mt-2 p-3 rounded-xl text-sm bg-green-50 text-green-700 border border-green-200';
                testResult.innerHTML = '<i class="fa-solid fa-check-circle mr-2"></i><strong>Koneksi Berhasil!</strong> Google Apps Script merespon dengan baik.' +
                    (data ? ' Response: <code class="bg-green-100 px-1.5 py-0.5 rounded text-xs">' + JSON.stringify(data).substring(0, 80) + '</code>' : '');
            }
            updatePanduanStatus(gasUrl);
        } else {
            if (testResult) {
                testResult.classList.remove('hidden');
                testResult.className = 'mt-2 p-3 rounded-xl text-sm bg-red-50 text-red-700 border border-red-200';
                testResult.innerHTML = '<i class="fa-solid fa-times-circle mr-2"></i><strong>Gagal!</strong> Server merespon dengan status ' + res.status + '. Pastikan URL benar dan deployment aktif.';
            }
        }
    } catch(e) {
        if (testResult) {
            testResult.classList.remove('hidden');
            testResult.className = 'mt-2 p-3 rounded-xl text-sm bg-red-50 text-red-700 border border-red-200';
            testResult.innerHTML = '<i class="fa-solid fa-times-circle mr-2"></i><strong>Koneksi Gagal!</strong> ' + e.message +
                '<br><span class="text-xs mt-1 block">Pastikan: (1) URL benar, (2) Deploy sebagai Web App, (3) Akses set ke "Anyone".</span>';
        }
    } finally {
        if (btnTest) {
            btnTest.disabled = false;
            btnTest.innerHTML = '<i class="fa-solid fa-stethoscope mr-1"></i> Test';
        }
    }
};

// ===== 18. ALL SETTINGS LOADER =====
function loadAllSettings() {
    loadSettings();
    loadProfileSettings();
    loadDatabaseConfig();
    updateFirebaseStatusUI();
    renderJadwalList();
}

// ===== 27. CHECK SAVED SESSION =====
(function checkSavedSession() {
    const saved = getData('currentUser', null);
    if (saved && saved.nama) {
        // Check if Firebase school config is available
        const savedSchool = getData('schoolConfig', null);
        if (savedSchool) {
            schoolConfig = savedSchool;
        }
        // Don't auto-login - require re-authentication for security
    }
})();
