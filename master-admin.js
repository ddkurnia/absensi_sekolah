/**
 * =====================================================
 * Smart Absen Enterprise - Master Admin Panel
 * master-admin.js
 * =====================================================
 * Panel admin utama untuk pemilik aplikasi.
 * Mengelola banyak sekolah, konfigurasi WA API, dll.
 * Menggunakan localStorage sebagai penyimpanan sementara.
 * =====================================================
 */

// ============================================
// KONSTANTA & KONFIGURASI
// ============================================
const MASTER_KEY = 'smartabsen2026';
const LS_PREFIX = 'master_';

// Key localStorage
const LS_SCHOOLS = LS_PREFIX + 'schools';
const LS_REGISTRATIONS = LS_PREFIX + 'registrations';
const LS_FIREBASE = LS_PREFIX + 'firebaseConfig';
const LS_SETTINGS = LS_PREFIX + 'settings';
const LS_LOG = LS_PREFIX + 'activityLog';
const LS_SESSION = LS_PREFIX + 'session';

// ============================================
// DATA DEFAULT
// ============================================
const DEFAULT_SETTINGS = {
    appVersion: '2.0',
    maintenanceMode: false,
    maxSchools: 100,
    waDefaultProvider: 'fonnte'
};

const DEFAULT_FIREBASE = {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
    databaseURL: ''
};

// Template konfigurasi WA API Provider
const WA_PROVIDERS = {
    fonnte: {
        name: 'FONNTE',
        defaultUrl: 'https://api.fonnte.com/send',
        description: 'Layanan WhatsApp API dari Fonnte. Gunakan API Key dari dashboard Fonnte.',
        keyLabel: 'API Key',
        needsDeviceId: false
    },
    wablas: {
        name: 'WABLAS',
        defaultUrl: 'https://crown.wablas.com/api/send',
        description: 'Layanan WhatsApp API dari Wablas. Gunakan Token dari dashboard Wablas.',
        keyLabel: 'Token',
        needsDeviceId: true
    },
    waha: {
        name: 'WAHA',
        defaultUrl: 'https://your-waha-instance/api/sendText',
        description: 'Layanan WAHA (WhatsApp HTTP API) self-hosted. Deploy instance sendiri.',
        keyLabel: 'API Key',
        needsDeviceId: false
    },
    custom: {
        name: 'Custom',
        defaultUrl: '',
        description: 'Gunakan provider WhatsApp API custom Anda. Masukkan URL dan key sesuai provider.',
        keyLabel: 'API Key / Token',
        needsDeviceId: false
    }
};

// ============================================
// VARIABEL STATE
// ============================================
let currentSection = 'dashboardSection';
let currentRegFilter = 'all';
let selectedWaSchoolId = null;
let confirmCallback = null;

// ============================================
// INISIALISASI
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    // Cek sesi login
    checkSession();

    // Clock update
    updateClock();
    setInterval(updateClock, 1000);

    // Enter pada input login
    document.getElementById('masterKeyInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') masterLogin();
    });
});

// ============================================
// SESSION & LOGIN
// ============================================

/** Cek apakah sudah login sebelumnya */
function checkSession() {
    const session = localStorage.getItem(LS_SESSION);
    if (session === 'active') {
        showMainApp();
    }
}

/** Proses login master admin */
function masterLogin() {
    const inputKey = document.getElementById('masterKeyInput').value.trim();

    if (!inputKey) {
        showWarning('Masukkan master key terlebih dahulu');
        document.getElementById('masterKeyInput').focus();
        return;
    }

    if (inputKey !== MASTER_KEY) {
        showError('Master key salah! Akses ditolak.');
        document.getElementById('masterKeyInput').value = '';
        document.getElementById('masterKeyInput').focus();
        return;
    }

    // Simpan sesi
    localStorage.setItem(LS_SESSION, 'active');

    // Log aktivitas
    addActivityLog('login', 'Super Admin berhasil login ke panel master');

    // Tampilkan aplikasi utama
    showMainApp();
    showSuccess('Selamat datang, Super Admin!');
}

/** Logout */
function masterLogout() {
    addActivityLog('logout', 'Super Admin logout dari panel master');
    localStorage.removeItem(LS_SESSION);

    // Reset tampilan
    document.getElementById('masterMainApp').classList.add('hidden');
    document.getElementById('masterLoginPage').classList.remove('hidden');
    document.getElementById('masterKeyInput').value = '';

    // Reset ke dashboard
    navigateTo('dashboardSection', document.querySelector('[data-section="dashboardSection"]'));
}

/** Tampilkan aplikasi utama setelah login */
function showMainApp() {
    document.getElementById('masterLoginPage').classList.add('hidden');
    document.getElementById('masterMainApp').classList.remove('hidden');

    // Load semua data
    loadDashboard();
    updatePendingBadge();
}

// ============================================
// NAVIGASI
// ============================================

/** Navigasi ke section tertentu */
function navigateTo(sectionId, linkEl) {
    // Sembunyikan semua section
    const sections = document.querySelectorAll('main section');
    sections.forEach(function(sec) {
        sec.classList.add('hidden');
    });

    // Tampilkan section yang dipilih
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
        targetSection.classList.remove('hidden');
        // Re-trigger animasi
        targetSection.classList.remove('animate-fade-in');
        void targetSection.offsetWidth; // force reflow
        targetSection.classList.add('animate-fade-in');
    }

    // Update sidebar active state
    const links = document.querySelectorAll('.sidebar-link');
    links.forEach(function(link) {
        link.classList.remove('active');
    });
    if (linkEl) {
        linkEl.classList.add('active');
    }

    // Update judul halaman
    const titles = {
        'dashboardSection': 'Dashboard',
        'registrasiSection': 'Registrasi Admin',
        'kelolaSection': 'Kelola Sekolah',
        'waApiSection': 'Pengaturan WhatsApp API',
        'firebaseSection': 'Konfigurasi Firebase',
        'settingsSection': 'Pengaturan Aplikasi',
        'logSection': 'Riwayat Aktivitas'
    };
    document.getElementById('pageTitle').textContent = titles[sectionId] || 'Dashboard';
    currentSection = sectionId;

    // Load data section tertentu
    switch (sectionId) {
        case 'dashboardSection':
            loadDashboard();
            break;
        case 'registrasiSection':
            loadRegistrations();
            break;
        case 'kelolaSection':
            loadSchools();
            break;
        case 'waApiSection':
            loadWaApiPage();
            break;
        case 'firebaseSection':
            loadFirebaseConfig();
            break;
        case 'settingsSection':
            loadAppSettings();
            break;
        case 'logSection':
            loadActivityLog();
            break;
    }

    // Tutup sidebar mobile
    closeSidebar();

    return false;
}

/** Toggle sidebar pada mobile */
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('hidden');
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.remove('open');
    overlay.classList.add('hidden');
}

// ============================================
// DASHBOARD
// ============================================

/** Load data dashboard */
function loadDashboard() {
    const schools = getSchools();
    const registrations = getRegistrations();
    const pendingRegs = registrations.filter(function(r) { return r.status === 'pending'; });
    const activeSchools = schools.filter(function(s) { return s.status === 'active'; });
    const waActive = schools.filter(function(s) { return s.waApi && s.waApi.enabled; });

    // Hitung provider terpakai
    const usedProviders = new Set();
    schools.forEach(function(s) {
        if (s.waApi && s.waApi.provider) {
            usedProviders.add(s.waApi.provider);
        }
    });

    // Update stat cards
    document.getElementById('statTotalSchools').textContent = schools.length;
    document.getElementById('statTotalTeachers').textContent = schools.reduce(function(sum, s) { return sum + (s.totalGuru || 0); }, 0);
    document.getElementById('statTotalStudents').textContent = schools.reduce(function(sum, s) { return sum + (s.totalSiswa || 0); }, 0);
    document.getElementById('statPendingReg').textContent = pendingRegs.length;
    document.getElementById('statWaActive').textContent = waActive.length;
    document.getElementById('statSuspended').textContent = schools.filter(function(s) { return s.status === 'suspended'; }).length;
    document.getElementById('statWaProviders').textContent = usedProviders.size;

    // Update pending badge di sidebar
    updatePendingBadge();

    // Load aktivitas terbaru
    loadRecentActivity();

    // Load sekolah terbaru
    loadRecentSchools();
}

/** Load aktivitas terbaru di dashboard */
function loadRecentActivity() {
    const logs = getActivityLog();
    const container = document.getElementById('recentActivityList');

    if (logs.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-400 text-center py-8">Belum ada aktivitas</p>';
        return;
    }

    const recent = logs.slice(0, 8);
    container.innerHTML = recent.map(function(log) {
        return '<div class="flex items-start gap-3">' +
            '<div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ' + getLogIconBg(log.action) + '">' +
                '<i class="' + getLogIcon(log.action) + ' text-xs"></i>' +
            '</div>' +
            '<div class="flex-1 min-w-0">' +
                '<p class="text-sm text-gray-700 truncate">' + escapeHtml(log.detail) + '</p>' +
                '<p class="text-xs text-gray-400 mt-0.5">' + formatDateTime(log.timestamp) + '</p>' +
            '</div>' +
        '</div>';
    }).join('');
}

/** Load sekolah terbaru di dashboard */
function loadRecentSchools() {
    const schools = getSchools();
    const container = document.getElementById('recentSchoolsList');

    if (schools.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-400 text-center py-8">Belum ada sekolah</p>';
        return;
    }

    const recent = schools.slice(0, 8);
    container.innerHTML = recent.map(function(school) {
        const statusBadge = getStatusBadge(school.status);
        const waBadge = (school.waApi && school.waApi.enabled) ?
            '<span class="text-xs text-green-600"><i class="fab fa-whatsapp mr-1"></i>WA Aktif</span>' :
            '<span class="text-xs text-gray-400"><i class="fab fa-whatsapp mr-1"></i>WA Off</span>';

        return '<div class="flex items-center justify-between py-2">' +
            '<div class="flex items-center gap-3 min-w-0">' +
                '<div class="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">' +
                    '<i class="fas fa-school text-violet-500 text-xs"></i>' +
                '</div>' +
                '<div class="min-w-0">' +
                    '<p class="text-sm font-medium text-gray-700 truncate">' + escapeHtml(school.nama) + '</p>' +
                    '<p class="text-xs text-gray-400">' + escapeHtml(school.kodeSekolah) + '</p>' +
                '</div>' +
            '</div>' +
            '<div class="flex items-center gap-2 flex-shrink-0 ml-2">' +
                waBadge + statusBadge +
            '</div>' +
        '</div>';
    }).join('');
}

// ============================================
// REGISTRASI ADMIN
// ============================================

/** Load semua data registrasi */
function loadRegistrations() {
    const registrations = getRegistrations();
    const tbody = document.getElementById('registrationsTableBody');

    // Filter berdasarkan tab aktif
    const filtered = currentRegFilter === 'all' ?
        registrations :
        registrations.filter(function(r) { return r.status === currentRegFilter; });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-12 text-gray-400">' +
            '<i class="fas fa-inbox text-3xl mb-2 block"></i>Tidak ada registrasi' +
            '</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(function(reg) {
        const statusBadge = getRegStatusBadge(reg.status);
        let actions = '';

        if (reg.status === 'pending') {
            actions = '<div class="flex items-center justify-center gap-1">' +
                '<button onclick="approveRegistration(\'' + reg.id + '\')" class="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition" title="Setujui">' +
                    '<i class="fas fa-check"></i>' +
                '</button>' +
                '<button onclick="rejectRegistration(\'' + reg.id + '\')" class="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition" title="Tolak">' +
                    '<i class="fas fa-times"></i>' +
                '</button>' +
            '</div>';
        } else if (reg.status === 'rejected') {
            actions = '<div class="flex items-center justify-center gap-1">' +
                '<button onclick="approveRegistration(\'' + reg.id + '\')" class="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition" title="Setujui ulang">' +
                    '<i class="fas fa-redo"></i>' +
                '</button>' +
                '<button onclick="deleteRegistration(\'' + reg.id + '\')" class="p-1.5 text-gray-400 hover:bg-gray-50 rounded-lg transition" title="Hapus">' +
                    '<i class="fas fa-trash"></i>' +
                '</button>' +
            '</div>';
        } else {
            actions = '<span class="text-xs text-gray-400">-</span>';
        }

        return '<tr class="border-t border-gray-50 hover:bg-gray-50/50 transition">' +
            '<td class="px-4 py-3 text-xs text-gray-500">' + formatDate(reg.tanggalDaftar) + '</td>' +
            '<td class="px-4 py-3 font-medium text-gray-700">' + escapeHtml(reg.nama) + '</td>' +
            '<td class="px-4 py-3"><span class="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md font-mono">' + escapeHtml(reg.kodeSekolah) + '</span></td>' +
            '<td class="px-4 py-3">' +
                '<p class="text-sm text-gray-700">' + escapeHtml(reg.adminNama) + '</p>' +
                '<p class="text-xs text-gray-400">' + escapeHtml(reg.adminEmail || '-') + '</p>' +
            '</td>' +
            '<td class="px-4 py-3">' + statusBadge + '</td>' +
            '<td class="px-4 py-3">' + actions + '</td>' +
        '</tr>';
    }).join('');
}

/** Filter registrasi berdasarkan tab */
function filterRegistrations(filter, btnEl) {
    currentRegFilter = filter;

    // Update tab aktif
    document.querySelectorAll('.reg-tab').forEach(function(tab) {
        tab.classList.remove('border-violet-500', 'text-violet-700');
        tab.classList.add('border-transparent', 'text-gray-500');
    });
    if (btnEl) {
        btnEl.classList.remove('border-transparent', 'text-gray-500');
        btnEl.classList.add('border-violet-500', 'text-violet-700');
    }

    loadRegistrations();
}

/** Setujui registrasi sekolah */
function approveRegistration(regId) {
    const registrations = getRegistrations();
    const regIndex = registrations.findIndex(function(r) { return r.id === regId; });

    if (regIndex === -1) {
        showError('Registrasi tidak ditemukan');
        return;
    }

    const reg = registrations[regIndex];

    // Konfirmasi
    showConfirm(
        'Setujui Registrasi',
        'Apakah Anda ingin menyetujui registrasi <strong>' + escapeHtml(reg.nama) + '</strong>?<br>Sekolah akan ditambahkan ke daftar sekolah aktif.',
        function() {
            // Buat sekolah baru dari data registrasi
            const newSchool = {
                id: generateId(),
                nama: reg.nama,
                kodeSekolah: reg.kodeSekolah,
                gasUrl: '',
                sheetUrl: '',
                adminNama: reg.adminNama,
                adminNip: reg.adminNip || '',
                adminEmail: reg.adminEmail || '',
                status: 'active',
                tanggalDaftar: reg.tanggalDaftar,
                totalGuru: 0,
                totalSiswa: 0,
                waApi: {
                    enabled: false,
                    provider: '',
                    apiUrl: '',
                    apiKey: '',
                    deviceId: '',
                    lastTest: null,
                    lastTestStatus: null
                }
            };

            // Simpan sekolah baru
            const schools = getSchools();
            schools.push(newSchool);
            localStorage.setItem(LS_SCHOOLS, JSON.stringify(schools));

            // Update status registrasi
            registrations[regIndex].status = 'approved';
            localStorage.setItem(LS_REGISTRATIONS, JSON.stringify(registrations));

            // Log
            addActivityLog('approve_school', 'Menyetujui registrasi sekolah: ' + reg.nama);

            // Refresh
            loadRegistrations();
            updatePendingBadge();
            showSuccess('Registrasi ' + reg.nama + ' berhasil disetujui!');
        }
    );
}

/** Tolak registrasi sekolah */
function rejectRegistration(regId) {
    const registrations = getRegistrations();
    const reg = registrations.find(function(r) { return r.id === regId; });

    if (!reg) {
        showError('Registrasi tidak ditemukan');
        return;
    }

    showConfirm(
        'Tolak Registrasi',
        'Apakah Anda ingin menolak registrasi <strong>' + escapeHtml(reg.nama) + '</strong>?',
        function() {
            reg.status = 'rejected';
            localStorage.setItem(LS_REGISTRATIONS, JSON.stringify(registrations));
            addActivityLog('reject_school', 'Menolak registrasi sekolah: ' + reg.nama);
            loadRegistrations();
            updatePendingBadge();
            showWarning('Registrasi ' + reg.nama + ' ditolak');
        }
    );
}

/** Hapus registrasi */
function deleteRegistration(regId) {
    const registrations = getRegistrations();
    const reg = registrations.find(function(r) { return r.id === regId; });

    if (!reg) return;

    showConfirm(
        'Hapus Registrasi',
        'Hapus data registrasi <strong>' + escapeHtml(reg.nama) + '</strong> secara permanen?',
        function() {
            const filtered = registrations.filter(function(r) { return r.id !== regId; });
            localStorage.setItem(LS_REGISTRATIONS, JSON.stringify(filtered));
            addActivityLog('delete_registration', 'Menghapus registrasi: ' + reg.nama);
            loadRegistrations();
            updatePendingBadge();
            showSuccess('Registrasi berhasil dihapus');
        }
    );
}

/** Update badge pending di sidebar */
function updatePendingBadge() {
    const registrations = getRegistrations();
    const pending = registrations.filter(function(r) { return r.status === 'pending'; });
    const badge = document.getElementById('badgePending');

    if (pending.length > 0) {
        badge.textContent = pending.length;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

// ============================================
// KELOLA SEKOLAH
// ============================================

/** Load semua sekolah ke grid */
function loadSchools() {
    const schools = getSchools();
    const container = document.getElementById('schoolsGrid');

    if (schools.length === 0) {
        container.innerHTML = '<div class="bg-white rounded-xl border border-gray-100 shadow-sm p-8 text-center text-gray-400 lg:col-span-2">' +
            '<i class="fas fa-school text-4xl mb-3 block"></i>Belum ada sekolah terdaftar' +
            '</div>';
        return;
    }

    container.innerHTML = schools.map(function(school) {
        const statusBadge = getStatusBadge(school.status);
        const waStatus = (school.waApi && school.waApi.enabled) ?
            '<span class="inline-flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full"><i class="fab fa-whatsapp"></i>WA Aktif</span>' :
            '<span class="inline-flex items-center gap-1 text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full"><i class="fab fa-whatsapp"></i>WA Off</span>';
        const waProvider = (school.waApi && school.waApi.provider) ?
            '<span class="text-xs text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">' + WA_PROVIDERS[school.waApi.provider].name + '</span>' : '';

        return '<div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition">' +
            '<div class="flex items-start justify-between mb-3">' +
                '<div class="flex items-center gap-3">' +
                    '<div class="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center">' +
                        '<i class="fas fa-school text-violet-600"></i>' +
                    '</div>' +
                    '<div>' +
                        '<h4 class="font-semibold text-gray-800 text-sm">' + escapeHtml(school.nama) + '</h4>' +
                        '<p class="text-xs text-gray-400 font-mono">' + escapeHtml(school.kodeSekolah) + '</p>' +
                    '</div>' +
                '</div>' +
                statusBadge +
            '</div>' +
            '<div class="space-y-2 mb-4">' +
                '<div class="flex items-center gap-2 text-xs text-gray-500">' +
                    '<i class="fas fa-user-tie w-4 text-center text-gray-400"></i>' +
                    '<span>' + escapeHtml(school.adminNama) + '</span>' +
                    '<span class="text-gray-300">|</span>' +
                    '<span>' + escapeHtml(school.adminEmail || '-') + '</span>' +
                '</div>' +

            '</div>' +
            '<div class="flex items-center justify-between">' +
                '<div class="flex items-center gap-2">' +
                    waStatus + ' ' + waProvider +
                '</div>' +
                '<div class="flex items-center gap-1">' +
                    '<button onclick="openSchoolDetail(\'' + school.id + '\')" class="p-1.5 text-gray-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition" title="Detail">' +
                        '<i class="fas fa-eye text-xs"></i>' +
                    '</button>' +
                    '<button onclick="editSchool(\'' + school.id + '\')" class="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition" title="Edit">' +
                        '<i class="fas fa-pen text-xs"></i>' +
                    '</button>' +
                    '<button onclick="toggleSchoolStatus(\'' + school.id + '\')" class="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition" title="' + (school.status === 'active' ? 'Suspend' : 'Aktifkan') + '">' +
                        '<i class="fas fa-' + (school.status === 'active' ? 'pause' : 'play') + ' text-xs"></i>' +
                    '</button>' +
                    '<button onclick="deleteSchool(\'' + school.id + '\')" class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition" title="Hapus">' +
                        '<i class="fas fa-trash text-xs"></i>' +
                    '</button>' +
                '</div>' +
            '</div>' +
        '</div>';
    }).join('');
}

/** Pencarian dan filter sekolah */
function searchSchools() {
    const query = document.getElementById('searchSchoolInput').value.toLowerCase();
    const statusFilter = document.getElementById('filterSchoolStatus').value;
    const schools = getSchools();
    const container = document.getElementById('schoolsGrid');

    let filtered = schools;
    if (query) {
        filtered = filtered.filter(function(s) {
            return s.nama.toLowerCase().includes(query) ||
                   s.kodeSekolah.toLowerCase().includes(query) ||
                   s.adminNama.toLowerCase().includes(query) ||
                   s.adminEmail.toLowerCase().includes(query);
        });
    }
    if (statusFilter !== 'all') {
        filtered = filtered.filter(function(s) { return s.status === statusFilter; });
    }

    if (filtered.length === 0) {
        container.innerHTML = '<div class="bg-white rounded-xl border border-gray-100 shadow-sm p-8 text-center text-gray-400 lg:col-span-2">' +
            '<i class="fas fa-search text-3xl mb-2 block"></i>Sekolah tidak ditemukan</div>';
        return;
    }

    // Re-render dengan data terfilter (sederhana: load ulang lalu sembunyikan yang tidak match)
    container.innerHTML = '';
    filtered.forEach(function(school) {
        // Gunakan pola render yang sama dengan loadSchools
        const statusBadge = getStatusBadge(school.status);
        const waStatus = (school.waApi && school.waApi.enabled) ?
            '<span class="inline-flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full"><i class="fab fa-whatsapp"></i>WA Aktif</span>' :
            '<span class="inline-flex items-center gap-1 text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full"><i class="fab fa-whatsapp"></i>WA Off</span>';
        const waProvider = (school.waApi && school.waApi.provider) ?
            '<span class="text-xs text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">' + WA_PROVIDERS[school.waApi.provider].name + '</span>' : '';

        container.innerHTML += '<div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition">' +
            '<div class="flex items-start justify-between mb-3">' +
                '<div class="flex items-center gap-3">' +
                    '<div class="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center">' +
                        '<i class="fas fa-school text-violet-600"></i>' +
                    '</div>' +
                    '<div><h4 class="font-semibold text-gray-800 text-sm">' + escapeHtml(school.nama) + '</h4>' +
                    '<p class="text-xs text-gray-400 font-mono">' + escapeHtml(school.kodeSekolah) + '</p></div>' +
                '</div>' + statusBadge +
            '</div>' +
            '<div class="space-y-2 mb-4">' +
                '<div class="flex items-center gap-2 text-xs text-gray-500"><i class="fas fa-user-tie w-4 text-center text-gray-400"></i>' +
                '<span>' + escapeHtml(school.adminNama) + '</span></div>' +
            '</div>' +
            '<div class="flex items-center justify-between">' +
                '<div class="flex items-center gap-2">' + waStatus + ' ' + waProvider + '</div>' +
                '<div class="flex items-center gap-1">' +
                    '<button onclick="editSchool(\'' + school.id + '\')" class="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"><i class="fas fa-pen text-xs"></i></button>' +
                    '<button onclick="toggleSchoolStatus(\'' + school.id + '\')" class="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition"><i class="fas fa-' + (school.status === 'active' ? 'pause' : 'play') + ' text-xs"></i></button>' +
                    '<button onclick="deleteSchool(\'' + school.id + '\')" class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"><i class="fas fa-trash text-xs"></i></button>' +
                '</div>' +
            '</div></div>';
    });
}

/** Buka modal tambah sekolah */
function openSchoolModal(editId) {
    const modal = document.getElementById('schoolModal');
    document.getElementById('schoolEditId').value = editId || '';

    if (editId) {
        // Mode edit
        const schools = getSchools();
        const school = schools.find(function(s) { return s.id === editId; });
        if (!school) return;

        document.getElementById('schoolModalTitle').innerHTML = '<i class="fas fa-pen text-violet-500 mr-2"></i>Edit Sekolah';
        document.getElementById('schoolNama').value = school.nama;
        document.getElementById('schoolKode').value = school.kodeSekolah;
        document.getElementById('schoolAdminNama').value = school.adminNama || '';
        document.getElementById('schoolAdminNip').value = school.adminNip || '';
        document.getElementById('schoolAdminEmail').value = school.adminEmail || '';

        // Update Google Drive status display
        const driveStatus = document.getElementById('schoolDriveStatus');
        if (driveStatus) {
            if (school.gasUrl) {
                driveStatus.innerHTML = '<i class="fa-solid fa-circle-check text-green-500 mr-1"></i> Status: <span class="font-semibold text-green-700">GAS Terhubung</span>';
            } else {
                driveStatus.innerHTML = '<i class="fa-solid fa-circle-info mr-1"></i> Status: <span class="font-semibold text-slate-600">Belum dikonfigurasi oleh admin sekolah</span>';
            }
        }
    } else {
        // Mode tambah
        document.getElementById('schoolModalTitle').innerHTML = '<i class="fas fa-plus text-violet-500 mr-2"></i>Tambah Sekolah';
        document.getElementById('schoolNama').value = '';
        document.getElementById('schoolKode').value = '';
        document.getElementById('schoolAdminNama').value = '';
        document.getElementById('schoolAdminNip').value = '';
        document.getElementById('schoolAdminEmail').value = '';

        // Reset Google Drive status
        const driveStatusAdd = document.getElementById('schoolDriveStatus');
        if (driveStatusAdd) {
            driveStatusAdd.innerHTML = '<i class="fa-solid fa-circle-info mr-1"></i> Status: <span class="font-semibold text-slate-600">Belum dikonfigurasi oleh admin sekolah</span>';
        }
    }

    modal.classList.remove('hidden');
}

function closeSchoolModal() {
    document.getElementById('schoolModal').classList.add('hidden');
}

/** Simpan sekolah (tambah atau edit) */
function saveSchool() {
    const editId = document.getElementById('schoolEditId').value;
    const nama = document.getElementById('schoolNama').value.trim();
    const kodeSekolah = document.getElementById('schoolKode').value.trim().toUpperCase();
    const adminNama = document.getElementById('schoolAdminNama').value.trim();
    const adminNip = document.getElementById('schoolAdminNip').value.trim();
    const adminEmail = document.getElementById('schoolAdminEmail').value.trim();

    // Validasi
    if (!nama) {
        showWarning('Nama sekolah wajib diisi');
        document.getElementById('schoolNama').focus();
        return;
    }
    if (!kodeSekolah) {
        showWarning('Kode sekolah wajib diisi');
        document.getElementById('schoolKode').focus();
        return;
    }

    const schools = getSchools();

    // Cek duplikat kode
    const duplicate = schools.find(function(s) {
        return s.kodeSekolah === kodeSekolah && s.id !== editId;
    });
    if (duplicate) {
        showError('Kode sekolah "' + kodeSekolah + '" sudah digunakan oleh ' + duplicate.nama);
        return;
    }

    if (editId) {
        // Mode edit
        const idx = schools.findIndex(function(s) { return s.id === editId; });
        if (idx === -1) {
            showError('Sekolah tidak ditemukan');
            return;
        }

        schools[idx].nama = nama;
        schools[idx].kodeSekolah = kodeSekolah;
        schools[idx].adminNama = adminNama;
        schools[idx].adminNip = adminNip;
        schools[idx].adminEmail = adminEmail;

        localStorage.setItem(LS_SCHOOLS, JSON.stringify(schools));
        addActivityLog('edit_school', 'Mengedit data sekolah: ' + nama);
        showSuccess('Data sekolah berhasil diperbarui');
    } else {
        // Cek limit sekolah
        const settings = getSettings();
        if (schools.length >= settings.maxSchools) {
            showError('Jumlah sekolah sudah mencapai batas maksimal (' + settings.maxSchools + ')');
            return;
        }

        // Mode tambah
        const newSchool = {
            id: generateId(),
            nama: nama,
            kodeSekolah: kodeSekolah,
            adminNama: adminNama,
            adminNip: adminNip,
            adminEmail: adminEmail,
            status: 'active',
            tanggalDaftar: new Date().toISOString().split('T')[0],
            totalGuru: 0,
            totalSiswa: 0,
            waApi: {
                enabled: false,
                provider: '',
                apiUrl: '',
                apiKey: '',
                deviceId: '',
                lastTest: null,
                lastTestStatus: null
            }
        };

        schools.push(newSchool);
        localStorage.setItem(LS_SCHOOLS, JSON.stringify(schools));
        addActivityLog('add_school', 'Menambahkan sekolah baru: ' + nama);
        showSuccess('Sekolah ' + nama + ' berhasil ditambahkan!');
    }

    closeSchoolModal();
    loadSchools();
}

/** Edit sekolah */
function editSchool(schoolId) {
    openSchoolModal(schoolId);
}

/** Toggle status sekolah (aktif/suspend) */
function toggleSchoolStatus(schoolId) {
    const schools = getSchools();
    const school = schools.find(function(s) { return s.id === schoolId; });
    if (!school) return;

    const newStatus = school.status === 'active' ? 'suspended' : 'active';
    const actionText = newStatus === 'active' ? 'mengaktifkan' : 'mensuspend';

    showConfirm(
        (newStatus === 'active' ? 'Aktifkan Sekolah' : 'Suspend Sekolah'),
        'Apakah Anda ingin ' + actionText + ' sekolah <strong>' + escapeHtml(school.nama) + '</strong>?',
        function() {
            school.status = newStatus;
            localStorage.setItem(LS_SCHOOLS, JSON.stringify(schools));
            addActivityLog(newStatus === 'active' ? 'activate_school' : 'suspend_school',
                actionText + ' sekolah: ' + school.nama);
            loadSchools();
            showSuccess('Sekolah berhasil ' + actionText);
        }
    );
}

/** Hapus sekolah */
function deleteSchool(schoolId) {
    const schools = getSchools();
    const school = schools.find(function(s) { return s.id === schoolId; });
    if (!school) return;

    showConfirm(
        'Hapus Sekolah',
        'Hapus sekolah <strong>' + escapeHtml(school.nama) + '</strong> secara permanen?<br>Data WA API juga akan dihapus.',
        function() {
            const filtered = schools.filter(function(s) { return s.id !== schoolId; });
            localStorage.setItem(LS_SCHOOLS, JSON.stringify(filtered));
            addActivityLog('delete_school', 'Menghapus sekolah: ' + school.nama);
            loadSchools();
            showSuccess('Sekolah berhasil dihapus');
        }
    );
}

/** Buka modal detail sekolah */
function openSchoolDetail(schoolId) {
    const schools = getSchools();
    const school = schools.find(function(s) { return s.id === schoolId; });
    if (!school) return;

    document.getElementById('schoolDetailTitle').innerHTML =
        '<i class="fas fa-school text-violet-500 mr-2"></i>' + escapeHtml(school.nama);

    const statusBadge = getStatusBadge(school.status);
    const waConfig = school.waApi || {};
    const waStatusHtml = waConfig.enabled ?
        '<span class="text-sm text-green-600"><i class="fab fa-whatsapp mr-1"></i>WA Aktif</span>' :
        '<span class="text-sm text-gray-400"><i class="fab fa-whatsapp mr-1"></i>WA Nonaktif</span>';
    const providerHtml = waConfig.provider ?
        '<span class="text-sm text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">' + WA_PROVIDERS[waConfig.provider].name + '</span>' : '-';

    const content = '<div class="space-y-4">' +
        // Info utama
        '<div class="grid grid-cols-2 gap-4">' +
            '<div class="bg-gray-50 rounded-xl p-4">' +
                '<p class="text-xs text-gray-400 mb-1">Kode Sekolah</p>' +
                '<p class="text-sm font-mono font-semibold text-gray-800">' + escapeHtml(school.kodeSekolah) + '</p>' +
            '</div>' +
            '<div class="bg-gray-50 rounded-xl p-4">' +
                '<p class="text-xs text-gray-400 mb-1">Status</p>' +
                '<p class="mt-1">' + statusBadge + '</p>' +
            '</div>' +
            '<div class="bg-gray-50 rounded-xl p-4">' +
                '<p class="text-xs text-gray-400 mb-1">Tanggal Daftar</p>' +
                '<p class="text-sm font-medium text-gray-800">' + formatDate(school.tanggalDaftar) + '</p>' +
            '</div>' +
            '<div class="bg-gray-50 rounded-xl p-4">' +
                '<p class="text-xs text-gray-400 mb-1">Guru / Siswa</p>' +
                '<p class="text-sm font-medium text-gray-800">' + (school.totalGuru || 0) + ' / ' + (school.totalSiswa || 0) + '</p>' +
            '</div>' +
        '</div>' +
        // Admin
        '<div class="border border-gray-100 rounded-xl p-4">' +
            '<h4 class="text-sm font-semibold text-gray-700 mb-3"><i class="fas fa-user-tie text-violet-500 mr-1"></i> Informasi Admin</h4>' +
            '<div class="space-y-1">' +
                '<p class="text-sm text-gray-600"><span class="text-gray-400 w-24 inline-block">Nama:</span>' + escapeHtml(school.adminNama || '-') + '</p>' +
                '<p class="text-sm text-gray-600"><span class="text-gray-400 w-24 inline-block">NIP:</span>' + escapeHtml(school.adminNip || '-') + '</p>' +
                '<p class="text-sm text-gray-600"><span class="text-gray-400 w-24 inline-block">Email:</span>' + escapeHtml(school.adminEmail || '-') + '</p>' +
            '</div>' +
        '</div>' +
        // Google Drive Status
        '<div class="border border-gray-100 rounded-xl p-4">' +
            '<h4 class="text-sm font-semibold text-gray-700 mb-3"><i class="fa-brands fa-google-drive text-violet-500 mr-1"></i> Integrasi Google Drive</h4>' +
            '<div class="space-y-2">' +
                '<div class="flex items-center gap-2">' +
                    (school.gasUrl ?
                        '<span class="text-xs text-green-600"><i class="fa-solid fa-circle-check mr-1"></i> GAS Terhubung</span>' :
                        '<span class="text-xs text-slate-400"><i class="fa-solid fa-circle-xmark mr-1"></i> GAS Belum dikonfigurasi</span>') +
                '</div>' +
                (school.gasUrl ?
                    '<p class="text-xs font-mono text-slate-500 break-all">' + escapeHtml(school.gasUrl) + '</p>' : '') +
                '<p class="text-xs text-slate-400"><i class="fa-solid fa-info-circle mr-1"></i> Dikelola oleh admin sekolah di panel pengaturan sekolah</p>' +
            '</div>' +
        '</div>' +
        // WA API Info
        '<div class="border border-gray-100 rounded-xl p-4">' +
            '<h4 class="text-sm font-semibold text-gray-700 mb-3"><i class="fab fa-whatsapp text-green-500 mr-1"></i> WhatsApp API</h4>' +
            '<div class="grid grid-cols-2 gap-3">' +
                '<div><p class="text-xs text-gray-400">Status</p><p class="mt-0.5">' + waStatusHtml + '</p></div>' +
                '<div><p class="text-xs text-gray-400">Provider</p><p class="mt-0.5">' + providerHtml + '</p></div>' +
                '<div class="col-span-2"><p class="text-xs text-gray-400">API URL</p><p class="text-xs font-mono text-gray-600 break-all">' + (escapeHtml(waConfig.apiUrl) || '-') + '</p></div>' +
                '<div class="col-span-2"><p class="text-xs text-gray-400">API Key</p><p class="text-xs font-mono text-gray-600">' + (waConfig.apiKey ? '••••••••••••' : '-') + '</p></div>' +
                (waConfig.deviceId ? '<div><p class="text-xs text-gray-400">Device ID</p><p class="text-xs font-mono text-gray-600">' + escapeHtml(waConfig.deviceId) + '</p></div>' : '') +
                (waConfig.lastTest ? '<div><p class="text-xs text-gray-400">Terakhir Test</p><p class="text-xs text-gray-600">' + formatDateTime(waConfig.lastTest) + (waConfig.lastTestStatus ? ' <span class="' + (waConfig.lastTestStatus === 'success' ? 'text-green-600' : 'text-red-600') + '">' + (waConfig.lastTestStatus === 'success' ? '✓ Berhasil' : '✗ Gagal') + '</span>' : '') + '</p></div>' : '') +
            '</div>' +
        '</div>' +
    '</div>';

    document.getElementById('schoolDetailContent').innerHTML = content;
    document.getElementById('schoolDetailModal').classList.remove('hidden');
}

function closeSchoolDetailModal() {
    document.getElementById('schoolDetailModal').classList.add('hidden');
}

// ============================================
// PENGATURAN WA API
// ============================================

/** Load halaman pengaturan WA API */
function loadWaApiPage() {
    const schools = getSchools();
    const container = document.getElementById('waSchoolList');

    if (schools.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-400 text-center py-6">Tidak ada sekolah terdaftar</p>';
        return;
    }

    container.innerHTML = schools.map(function(school) {
        const waEnabled = school.waApi && school.waApi.enabled;
        const isSelected = school.id === selectedWaSchoolId;
        const waProvider = school.waApi && school.waApi.provider ?
            WA_PROVIDERS[school.waApi.provider].name : '';

        return '<button onclick="selectWaSchool(\'' + school.id + '\')"' +
            ' class="w-full text-left p-3 rounded-xl border transition flex items-center gap-3 ' +
            (isSelected ? 'border-violet-500 bg-violet-50' : 'border-gray-100 hover:border-violet-200 hover:bg-violet-50/50') + '">' +
            '<div class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ' +
                (waEnabled ? 'bg-green-100' : 'bg-gray-100') + '">' +
                '<i class="' + (waEnabled ? 'fab fa-whatsapp text-green-600' : 'fas fa-school text-gray-400') + ' text-sm"></i>' +
            '</div>' +
            '<div class="flex-1 min-w-0">' +
                '<p class="text-sm font-medium text-gray-700 truncate">' + escapeHtml(school.nama) + '</p>' +
                '<p class="text-xs text-gray-400 truncate">' +
                    (waEnabled ?
                        '<span class="text-green-600">WA Aktif</span> · ' + waProvider :
                        '<span>WA Nonaktif</span>') +
                '</p>' +
            '</div>' +
            (isSelected ? '<i class="fas fa-check-circle text-violet-500"></i>' : '') +
        '</button>';
    }).join('');
}

/** Pilih sekolah untuk konfigurasi WA API */
function selectWaSchool(schoolId) {
    selectedWaSchoolId = schoolId;
    const schools = getSchools();
    const school = schools.find(function(s) { return s.id === schoolId; });

    if (!school) return;

    // Update highlight di daftar sekolah
    loadWaApiPage();

    // Tampilkan form
    document.getElementById('waPlaceholder').classList.add('hidden');
    document.getElementById('waApiForm').classList.remove('hidden');

    // Set nama sekolah di header
    document.getElementById('waSelectedSchoolName').textContent = school.nama;

    // Load konfigurasi WA
    const waConfig = school.waApi || {};
    document.getElementById('waEnabledToggle').checked = waConfig.enabled || false;
    document.getElementById('waProviderSelect').value = waConfig.provider || '';
    document.getElementById('waApiUrlInput').value = waConfig.apiUrl || '';
    document.getElementById('waApiKeyInput').value = waConfig.apiKey || '';
    document.getElementById('waDeviceIdInput').value = waConfig.deviceId || '';

    // Tampilkan info provider
    onWaProviderChange();

    // Tampilkan status test terakhir
    if (waConfig.lastTest) {
        const resultDiv = document.getElementById('waTestResult');
        resultDiv.classList.remove('hidden');
        document.getElementById('waTestResultTime').textContent = formatDateTime(waConfig.lastTest);

        if (waConfig.lastTestStatus === 'success') {
            resultDiv.className = 'rounded-xl p-4 text-sm bg-green-50 text-green-700';
            document.getElementById('waTestResultIcon').className = 'fas fa-check-circle';
            document.getElementById('waTestResultText').textContent = 'Test terakhir berhasil';
        } else {
            resultDiv.className = 'rounded-xl p-4 text-sm bg-red-50 text-red-700';
            document.getElementById('waTestResultIcon').className = 'fas fa-times-circle';
            document.getElementById('waTestResultText').textContent = 'Test terakhir gagal';
        }
    } else {
        document.getElementById('waTestResult').classList.add('hidden');
    }
}

/** Handle perubahan provider WA */
function onWaProviderChange() {
    const provider = document.getElementById('waProviderSelect').value;
    const infoDiv = document.getElementById('waProviderInfo');
    const urlInput = document.getElementById('waApiUrlInput');

    if (!provider || !WA_PROVIDERS[provider]) {
        infoDiv.classList.add('hidden');
        urlInput.placeholder = 'https://api.example.com/send';
        document.getElementById('waDeviceIdInput').parentElement.style.display = '';
        return;
    }

    const providerInfo = WA_PROVIDERS[provider];

    // Tampilkan info provider
    infoDiv.classList.remove('hidden');
    document.getElementById('waProviderInfoTitle').textContent = providerInfo.name + ' - ' + providerInfo.keyLabel;
    document.getElementById('waProviderInfoDesc').textContent = providerInfo.description;

    // Auto-fill URL default
    if (providerInfo.defaultUrl && !urlInput.value) {
        urlInput.value = providerInfo.defaultUrl;
        urlInput.placeholder = providerInfo.defaultUrl;
    }

    // Tampilkan/sembunyikan device ID
    const deviceIdParent = document.getElementById('waDeviceIdInput').parentElement;
    if (providerInfo.needsDeviceId) {
        deviceIdParent.style.display = '';
    } else {
        deviceIdParent.style.display = provider === 'custom' ? '' : 'none';
    }
}

/** Toggle visibilitas API Key */
function toggleApiKeyVisibility() {
    const input = document.getElementById('waApiKeyInput');
    const icon = document.getElementById('waApiKeyEyeIcon');

    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fas fa-eye-slash text-sm';
    } else {
        input.type = 'password';
        icon.className = 'fas fa-eye text-sm';
    }
}

/** Simpan konfigurasi WA API untuk sekolah tertentu */
function saveWaApiConfig() {
    if (!selectedWaSchoolId) {
        showWarning('Pilih sekolah terlebih dahulu');
        return;
    }

    const provider = document.getElementById('waProviderSelect').value;
    const apiUrl = document.getElementById('waApiUrlInput').value.trim();
    const apiKey = document.getElementById('waApiKeyInput').value.trim();
    const deviceId = document.getElementById('waDeviceIdInput').value.trim();
    const enabled = document.getElementById('waEnabledToggle').checked;

    // Validasi dasar
    if (enabled) {
        if (!provider) {
            showWarning('Pilih provider WA API terlebih dahulu');
            document.getElementById('waProviderSelect').focus();
            return;
        }
        if (!apiUrl) {
            showWarning('API URL wajib diisi');
            document.getElementById('waApiUrlInput').focus();
            return;
        }
        if (!apiKey) {
            showWarning('API Key wajib diisi');
            document.getElementById('waApiKeyInput').focus();
            return;
        }
    }

    const schools = getSchools();
    const schoolIndex = schools.findIndex(function(s) { return s.id === selectedWaSchoolId; });
    if (schoolIndex === -1) {
        showError('Sekolah tidak ditemukan');
        return;
    }

    const schoolName = schools[schoolIndex].nama;

    // Update konfigurasi WA API
    schools[schoolIndex].waApi = {
        enabled: enabled,
        provider: provider,
        apiUrl: apiUrl,
        apiKey: apiKey,
        deviceId: deviceId,
        lastTest: schools[schoolIndex].waApi ? schools[schoolIndex].waApi.lastTest : null,
        lastTestStatus: schools[schoolIndex].waApi ? schools[schoolIndex].waApi.lastTestStatus : null
    };

    localStorage.setItem(LS_SCHOOLS, JSON.stringify(schools));

    // Log aktivitas
    addActivityLog('save_wa_config',
        'Menyimpan konfigurasi WA API untuk ' + schoolName +
        (enabled ? ' (Aktif - ' + (WA_PROVIDERS[provider] ? WA_PROVIDERS[provider].name : provider) + ')' : ' (Nonaktif)'));

    // Refresh UI
    loadWaApiPage();
    selectWaSchool(selectedWaSchoolId);

    showSuccess('Konfigurasi WA API untuk ' + schoolName + ' berhasil disimpan!');
}

/** Toggle enable/disable WA untuk sekolah */
function toggleWaEnabled() {
    // Ini dipanggil saat toggle berubah.
    // Konfigurasi akan disimpan saat tombol "Simpan" ditekan.
    // Untuk auto-save, kita bisa langsung simpan:
    if (!selectedWaSchoolId) return;

    const enabled = document.getElementById('waEnabledToggle').checked;
    const schools = getSchools();
    const schoolIndex = schools.findIndex(function(s) { return s.id === selectedWaSchoolId; });
    if (schoolIndex === -1) return;

    if (!schools[schoolIndex].waApi) {
        schools[schoolIndex].waApi = {
            enabled: false, provider: '', apiUrl: '', apiKey: '',
            deviceId: '', lastTest: null, lastTestStatus: null
        };
    }

    schools[schoolIndex].waApi.enabled = enabled;
    localStorage.setItem(LS_SCHOOLS, JSON.stringify(schools));

    addActivityLog('toggle_wa',
        (enabled ? 'Mengaktifkan' : 'Menonaktifkan') + ' WA untuk ' + schools[schoolIndex].nama);

    loadWaApiPage();
    showSuccess('WA ' + (enabled ? 'diaktifkan' : 'dinonaktifkan') + ' untuk ' + schools[schoolIndex].nama);
}

/** Buka modal test WA */
function testWaApi() {
    if (!selectedWaSchoolId) {
        showWarning('Pilih sekolah terlebih dahulu');
        return;
    }

    const provider = document.getElementById('waProviderSelect').value;
    const apiUrl = document.getElementById('waApiUrlInput').value.trim();
    const apiKey = document.getElementById('waApiKeyInput').value.trim();

    if (!provider) {
        showWarning('Pilih provider terlebih dahulu');
        return;
    }
    if (!apiUrl || !apiKey) {
        showWarning('API URL dan API Key wajib diisi untuk test');
        return;
    }

    // Buka modal input nomor
    document.getElementById('waTestNumber').value = '';
    document.getElementById('waTestLoading').classList.add('hidden');
    document.getElementById('waTestModalResult').classList.add('hidden');
    document.getElementById('waTestModal').classList.remove('hidden');
}

function closeWaTestModal() {
    document.getElementById('waTestModal').classList.add('hidden');
}

/** Eksekusi test WA */
async function executeWaTest() {
    const phoneNumber = document.getElementById('waTestNumber').value.trim();

    if (!phoneNumber) {
        showWarning('Masukkan nomor WA tujuan');
        document.getElementById('waTestNumber').focus();
        return;
    }

    // Validasi format nomor (sederhana)
    if (!/^[0-9]{10,15}$/.test(phoneNumber)) {
        showWarning('Format nomor tidak valid. Gunakan format: 6281234567890');
        return;
    }

    // Tampilkan loading
    document.getElementById('waTestLoading').classList.remove('hidden');
    document.getElementById('waTestModalResult').classList.add('hidden');

    const provider = document.getElementById('waProviderSelect').value;
    const apiUrl = document.getElementById('waApiUrlInput').value.trim();
    const apiKey = document.getElementById('waApiKeyInput').value.trim();
    const deviceId = document.getElementById('waDeviceIdInput').value.trim();

    // Siapkan payload berdasarkan provider
    let fetchOptions;
    let testSuccess = false;
    let testMessage = '';

    try {
        if (provider === 'fonnte') {
            // FONNTE API
            fetchOptions = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': apiKey
                },
                body: JSON.stringify({
                    target: phoneNumber,
                    message: '🔔 *Test Smart Absen Enterprise*\n\nPesan test berhasil dikirim!\n\nWaktu: ' + new Date().toLocaleString('id-ID') + '\nProvider: FONNTE',
                    countryCode: '62'
                })
            };
        } else if (provider === 'wablas') {
            // WABLAS API
            fetchOptions = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': apiKey
                },
                body: JSON.stringify({
                    phone: phoneNumber,
                    message: '🔔 *Test Smart Absen Enterprise*\n\nPesan test berhasil dikirim!\n\nWaktu: ' + new Date().toLocaleString('id-ID') + '\nProvider: WABLAS',
                    deviceId: deviceId || '1'
                })
            };
        } else if (provider === 'waha') {
            // WAHA API
            fetchOptions = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    session: deviceId || 'default',
                    chatId: phoneNumber + '@s.whatsapp.net',
                    text: '🔔 *Test Smart Absen Enterprise*\n\nPesan test berhasil dikirim!\n\nWaktu: ' + new Date().toLocaleString('id-ID') + '\nProvider: WAHA'
                })
            };
            // WAHA menggunakan basic auth jika apiKey diberikan
            if (apiKey) {
                fetchOptions.headers['Authorization'] = 'Basic ' + btoa(apiKey);
            }
        } else {
            // Custom provider - generic format
            fetchOptions = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + apiKey
                },
                body: JSON.stringify({
                    phone: phoneNumber,
                    message: '🔔 *Test Smart Absen Enterprise*\n\nPesan test berhasil dikirim!\n\nWaktu: ' + new Date().toLocaleString('id-ID') + '\nProvider: Custom',
                    deviceId: deviceId || ''
                })
            };
        }

        // Kirim request
        const response = await fetch(apiUrl, fetchOptions);
        const result = await response.json();

        // Cek hasil berdasarkan provider
        if (provider === 'fonnte') {
            testSuccess = result.status === true;
            testMessage = testSuccess ? 'Pesan berhasil dikirim!' : (result.reason || 'Gagal mengirim pesan');
        } else if (provider === 'wablas') {
            testSuccess = result.status === true || result.code === 200;
            testMessage = testSuccess ? 'Pesan berhasil dikirim!' : (result.message || 'Gagal mengirim pesan');
        } else if (provider === 'waha') {
            testSuccess = response.ok;
            testMessage = testSuccess ? 'Pesan berhasil dikirim!' : 'Gagal mengirim pesan: ' + response.statusText;
        } else {
            testSuccess = response.ok;
            testMessage = testSuccess ? 'Pesan berhasil dikirim!' : 'Gagal mengirim pesan';
        }
    } catch (error) {
        testSuccess = false;
        testMessage = 'Error: ' + error.message;
    }

    // Sembunyikan loading
    document.getElementById('waTestLoading').classList.add('hidden');

    // Tampilkan hasil
    const resultDiv = document.getElementById('waTestModalResult');
    resultDiv.classList.remove('hidden');

    if (testSuccess) {
        resultDiv.className = 'rounded-xl p-4 text-sm bg-green-50 text-green-700';
        resultDiv.innerHTML = '<div class="flex items-center gap-2">' +
            '<i class="fas fa-check-circle text-lg"></i>' +
            '<div><p class="font-semibold">Berhasil!</p><p class="text-xs text-green-600 mt-0.5">' + escapeHtml(testMessage) + '</p></div>' +
        '</div>';
    } else {
        resultDiv.className = 'rounded-xl p-4 text-sm bg-red-50 text-red-700';
        resultDiv.innerHTML = '<div class="flex items-center gap-2">' +
            '<i class="fas fa-times-circle text-lg"></i>' +
            '<div><p class="font-semibold">Gagal</p><p class="text-xs text-red-600 mt-0.5">' + escapeHtml(testMessage) + '</p></div>' +
        '</div>';
    }

    // Update status test di data sekolah
    const schools = getSchools();
    const schoolIndex = schools.findIndex(function(s) { return s.id === selectedWaSchoolId; });
    if (schoolIndex !== -1) {
        if (!schools[schoolIndex].waApi) {
            schools[schoolIndex].waApi = { enabled: false, provider: '', apiUrl: '', apiKey: '', deviceId: '', lastTest: null, lastTestStatus: null };
        }
        schools[schoolIndex].waApi.lastTest = new Date().toISOString();
        schools[schoolIndex].waApi.lastTestStatus = testSuccess ? 'success' : 'failed';
        localStorage.setItem(LS_SCHOOLS, JSON.stringify(schools));
    }

    // Log
    addActivityLog('test_wa',
        'Test WA API untuk ' + (schools[schoolIndex] ? schools[schoolIndex].nama : 'Unknown') + ': ' + (testSuccess ? 'Berhasil' : 'Gagal - ' + testMessage));

    // Update test result di form
    if (selectedWaSchoolId && schools[schoolIndex]) {
        const waTestResult = document.getElementById('waTestResult');
        waTestResult.classList.remove('hidden');
        document.getElementById('waTestResultTime').textContent = 'Baru saja';
        if (testSuccess) {
            waTestResult.className = 'rounded-xl p-4 text-sm bg-green-50 text-green-700';
            document.getElementById('waTestResultIcon').className = 'fas fa-check-circle';
            document.getElementById('waTestResultText').textContent = 'Test berhasil (' + formatDateTime(new Date().toISOString()) + ')';
        } else {
            waTestResult.className = 'rounded-xl p-4 text-sm bg-red-50 text-red-700';
            document.getElementById('waTestResultIcon').className = 'fas fa-times-circle';
            document.getElementById('waTestResultText').textContent = 'Test gagal (' + formatDateTime(new Date().toISOString()) + ')';
        }
    }
}

// ============================================
// FIREBASE CONFIG
// ============================================

/** Load konfigurasi Firebase ke form */
function loadFirebaseConfig() {
    const config = getFirebaseConfig();

    document.getElementById('fbApiKey').value = config.apiKey || '';
    document.getElementById('fbAuthDomain').value = config.authDomain || '';
    document.getElementById('fbProjectId').value = config.projectId || '';
    document.getElementById('fbStorageBucket').value = config.storageBucket || '';
    document.getElementById('fbMessagingSenderId').value = config.messagingSenderId || '';
    document.getElementById('fbAppId').value = config.appId || '';
    document.getElementById('fbDatabaseURL').value = config.databaseURL || '';

    // Update status info di pengaturan
    const firebaseStatus = document.getElementById('infoFirebaseStatus');
    if (config.apiKey && config.projectId) {
        firebaseStatus.innerHTML = '<span class="text-green-600"><i class="fas fa-check-circle mr-1"></i>Terkonfigurasi</span>';
    } else {
        firebaseStatus.innerHTML = '<span class="text-amber-600"><i class="fas fa-exclamation-circle mr-1"></i>Belum dikonfigurasi</span>';
    }
}

/** Simpan konfigurasi Firebase */
function saveFirebaseConfig() {
    const config = {
        apiKey: document.getElementById('fbApiKey').value.trim(),
        authDomain: document.getElementById('fbAuthDomain').value.trim(),
        projectId: document.getElementById('fbProjectId').value.trim(),
        storageBucket: document.getElementById('fbStorageBucket').value.trim(),
        messagingSenderId: document.getElementById('fbMessagingSenderId').value.trim(),
        appId: document.getElementById('fbAppId').value.trim(),
        databaseURL: document.getElementById('fbDatabaseURL').value.trim()
    };

    if (!config.apiKey || !config.projectId) {
        showWarning('Minimal API Key dan Project ID wajib diisi!');
        return;
    }

    localStorage.setItem(LS_FIREBASE, JSON.stringify(config));
    addActivityLog('save_firebase', 'Menyimpan konfigurasi Firebase (Project: ' + config.projectId + ')');
    showSuccess('Konfigurasi Firebase berhasil disimpan! Menguji koneksi...');

    // Update status
    loadFirebaseConfig();

    // Auto test koneksi setelah simpan
    setTimeout(function() {
        testFirebaseConnection();
    }, 500);
}

/** Test koneksi Firebase */
async function testFirebaseConnection() {
    const config = getFirebaseConfig();

    if (!config.apiKey || !config.projectId) {
        showError('Konfigurasi Firebase belum lengkap. Isi minimal API Key dan Project ID.');
        return;
    }

    showInfo('Menguji koneksi ke Firebase...');

    try {
        // Load Firebase SDK dynamically
        if (!window.firebase || !firebase.apps || !firebase.apps.length) {
            await new Promise((resolve, reject) => {
                const s1 = document.createElement('script');
                s1.src = 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js';
                s1.onload = () => {
                    const s2 = document.createElement('script');
                    s2.src = 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js';
                    s2.onload = () => {
                        try {
                            if (!firebase.apps.length) firebase.initializeApp(config);
                            resolve();
                        } catch(e) { reject(e); }
                    };
                    s2.onerror = () => reject(new Error('Gagal memuat Firebase Auth SDK'));
                    document.head.appendChild(s2);
                };
                s1.onerror = () => reject(new Error('Gagal memuat Firebase SDK'));
                document.head.appendChild(s1);
            });
        }

        // Test: try to fetch Auth settings from Firebase
        const auth = firebase.auth();
        const response = await fetch('https://identitytoolkit.googleapis.com/v1/projects/' + config.projectId + '/accounts:createAuthUri?key=' + config.apiKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                identifier: 'test@example.com',
                continueUri: window.location.href
            })
        });

        if (response.ok || response.status === 400) {
            // 400 is expected (test email not registered) but it means Firebase is reachable
            showSuccess('Koneksi Firebase BERHASIL! Project "' + config.projectId + '" terhubung dengan baik.');
            addActivityLog('test_firebase', 'Test koneksi Firebase BERHASIL (Project: ' + config.projectId + ')');
        } else {
            const errData = await response.json().catch(() => ({}));
            showError('Gagal terhubung ke Firebase. Pastikan API Key dan Project ID benar. Error: ' + (errData.error?.message || response.statusText));
            addActivityLog('test_firebase', 'Test koneksi Firebase GAGAL (Project: ' + config.projectId + ')');
        }

    } catch (error) {
        showError('Gagal menguji koneksi: ' + error.message);
        addActivityLog('test_firebase', 'Test koneksi Firebase GAGAL: ' + error.message);
    }
}

// ============================================
// PENGATURAN APP
// ============================================

/** Load pengaturan aplikasi ke form */
function loadAppSettings() {
    const settings = getSettings();
    const schools = getSchools();

    document.getElementById('settingAppVersion').value = settings.appVersion || '2.0';
    document.getElementById('settingMaxSchools').value = settings.maxSchools || 100;
    document.getElementById('settingWaDefaultProvider').value = settings.waDefaultProvider || 'fonnte';
    document.getElementById('settingMaintenance').checked = settings.maintenanceMode || false;

    // Update info
    document.getElementById('infoCurrentVersion').textContent = settings.appVersion || '2.0';
    document.getElementById('infoTotalSchools').textContent = schools.length;
    document.getElementById('infoAvailableSlots').textContent = Math.max(0, (settings.maxSchools || 100) - schools.length);
}

/** Simpan pengaturan aplikasi */
function saveAppSettings() {
    const settings = {
        appVersion: document.getElementById('settingAppVersion').value.trim() || '2.0',
        maxSchools: parseInt(document.getElementById('settingMaxSchools').value) || 100,
        waDefaultProvider: document.getElementById('settingWaDefaultProvider').value,
        maintenanceMode: document.getElementById('settingMaintenance').checked
    };

    localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
    addActivityLog('save_settings', 'Menyimpan pengaturan aplikasi (v' + settings.appVersion + ')');
    showSuccess('Pengaturan berhasil disimpan!');

    // Refresh info
    loadAppSettings();
}

/** Toggle maintenance mode */
function toggleMaintenance() {
    const enabled = document.getElementById('settingMaintenance').checked;
    const settings = getSettings();
    settings.maintenanceMode = enabled;
    localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));

    addActivityLog('toggle_maintenance',
        'Mode maintenance ' + (enabled ? 'diaktifkan' : 'dinonaktifkan'));

    showToast(enabled ? 'warning' : 'success',
        enabled ? '⚠️ Mode Maintenance Aktif! Semua sekolah tidak bisa mengakses aplikasi.' :
                  '✅ Mode Maintenance dinonaktifkan. Aplikasi kembali normal.');
}

/** Export semua data */
function exportAllData() {
    const data = {
        schools: getSchools(),
        registrations: getRegistrations(),
        firebaseConfig: getFirebaseConfig(),
        settings: getSettings(),
        activityLog: getActivityLog(),
        exportDate: new Date().toISOString(),
        version: '1.0'
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'smart-absen-enterprise-backup-' + new Date().toISOString().split('T')[0] + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    addActivityLog('export_data', 'Export semua data master admin');
    showSuccess('Data berhasil diexport!');
}

/** Konfirmasi reset semua data */
function confirmResetData() {
    showConfirm(
        'Reset Semua Data',
        '⚠️ Tindakan ini akan <strong>menghapus SEMUA data</strong> termasuk sekolah, registrasi, konfigurasi Firebase, dan log aktivitas.<br><br><strong>Data tidak dapat dikembalikan!</strong>',
        function() {
            localStorage.removeItem(LS_SCHOOLS);
            localStorage.removeItem(LS_REGISTRATIONS);
            localStorage.removeItem(LS_FIREBASE);
            localStorage.removeItem(LS_SETTINGS);
            localStorage.removeItem(LS_LOG);

            // Set default
            localStorage.setItem(LS_SETTINGS, JSON.stringify(DEFAULT_SETTINGS));

            addActivityLog('reset_data', 'SEMUA DATA direset oleh Super Admin');
            showSuccess('Semua data berhasil direset');

            // Load ulang
            if (currentSection === 'settingsSection') loadAppSettings();
        }
    );
}

// ============================================
// RIWAYAT AKTIVITAS
// ============================================

/** Load log aktivitas */
function loadActivityLog() {
    const logs = getActivityLog();
    const container = document.getElementById('activityLogList');
    const dateFilter = document.getElementById('logDateFilter').value;

    let filtered = logs;
    if (dateFilter) {
        filtered = logs.filter(function(log) {
            return log.timestamp && log.timestamp.startsWith(dateFilter);
        });
    }

    if (filtered.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-400 text-center py-8">Belum ada aktivitas tercatat</p>';
        return;
    }

    container.innerHTML = filtered.map(function(log, index) {
        return '<div class="flex items-start gap-3 p-3 rounded-xl hover:bg-gray-50 transition">' +
            '<div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ' + getLogIconBg(log.action) + '">' +
                '<i class="' + getLogIcon(log.action) + ' text-xs"></i>' +
            '</div>' +
            '<div class="flex-1 min-w-0">' +
                '<div class="flex items-center gap-2">' +
                    '<span class="text-xs font-medium px-2 py-0.5 rounded-full ' + getLogActionBadge(log.action) + '">' + getLogActionLabel(log.action) + '</span>' +
                '</div>' +
                '<p class="text-sm text-gray-700 mt-1">' + escapeHtml(log.detail) + '</p>' +
                '<p class="text-xs text-gray-400 mt-0.5">' + formatDateTime(log.timestamp) + '</p>' +
            '</div>' +
        '</div>';
    }).join('');
}

/** Filter log berdasarkan tanggal */
function filterActivityLog() {
    loadActivityLog();
}

/** Hapus semua log aktivitas */
function clearActivityLog() {
    showConfirm(
        'Hapus Semua Log',
        'Hapus semua riwayat aktivitas?',
        function() {
            localStorage.setItem(LS_LOG, JSON.stringify([]));
            loadActivityLog();
            showSuccess('Log aktivitas berhasil dihapus');
        }
    );
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================

/** Tampilkan toast notification */
function showToast(type, message, duration) {
    duration = duration || 4000;
    const container = document.getElementById('masterToastContainer');

    const icons = {
        success: 'fas fa-check-circle',
        error: 'fas fa-times-circle',
        warning: 'fas fa-exclamation-triangle',
        info: 'fas fa-info-circle'
    };
    const colors = {
        success: 'bg-green-500',
        error: 'bg-red-500',
        warning: 'bg-amber-500',
        info: 'bg-blue-500'
    };

    const toast = document.createElement('div');
    toast.className = 'toast-enter pointer-events-auto flex items-start gap-3 bg-white rounded-xl shadow-lg border border-gray-100 p-4 max-w-sm';
    toast.innerHTML = '<div class="w-6 h-6 rounded-full ' + colors[type] + ' flex items-center justify-center flex-shrink-0 mt-0.5">' +
        '<i class="' + icons[type] + ' text-white text-xs"></i>' +
    '</div>' +
    '<p class="text-sm text-gray-700 flex-1">' + message + '</p>' +
    '<button onclick="this.parentElement.remove()" class="text-gray-400 hover:text-gray-600 flex-shrink-0">' +
        '<i class="fas fa-times text-xs"></i>' +
    '</button>';

    container.appendChild(toast);

    // Auto-remove
    setTimeout(function() {
        toast.classList.remove('toast-enter');
        toast.classList.add('toast-exit');
        setTimeout(function() {
            if (toast.parentElement) toast.remove();
        }, 300);
    }, duration);
}

/** Shortcut toast helpers */
function showSuccess(message) { showToast('success', message); }
function showError(message) { showToast('error', message); }
function showWarning(message) { showToast('warning', message); }
function showInfo(message) { showToast('info', message); }

// ============================================
// MODAL KONFIRMASI
// ============================================

/** Tampilkan modal konfirmasi */
function showConfirm(title, message, callback, btnText) {
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalMessage').innerHTML = message;
    document.getElementById('confirmModalBtn').textContent = btnText || 'Ya, Lanjutkan';
    confirmCallback = callback;
    document.getElementById('confirmModalBtn').onclick = function() {
        closeConfirmModal();
        if (confirmCallback) confirmCallback();
    };
    document.getElementById('confirmModal').classList.remove('hidden');
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.add('hidden');
    confirmCallback = null;
}

// ============================================
// DATA HELPERS (localStorage)
// ============================================

/** Ambil data sekolah dari localStorage */
function getSchools() {
    try {
        return JSON.parse(localStorage.getItem(LS_SCHOOLS)) || [];
    } catch (e) {
        return [];
    }
}

/** Ambil data registrasi dari localStorage */
function getRegistrations() {
    try {
        return JSON.parse(localStorage.getItem(LS_REGISTRATIONS)) || [];
    } catch (e) {
        return [];
    }
}

/** Ambil konfigurasi Firebase dari localStorage */
function getFirebaseConfig() {
    try {
        return JSON.parse(localStorage.getItem(LS_FIREBASE)) || Object.assign({}, DEFAULT_FIREBASE);
    } catch (e) {
        return Object.assign({}, DEFAULT_FIREBASE);
    }
}

/** Ambil pengaturan aplikasi dari localStorage */
function getSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem(LS_SETTINGS));
        return saved ? Object.assign({}, DEFAULT_SETTINGS, saved) : Object.assign({}, DEFAULT_SETTINGS);
    } catch (e) {
        return Object.assign({}, DEFAULT_SETTINGS);
    }
}

/** Ambil log aktivitas dari localStorage */
function getActivityLog() {
    try {
        return JSON.parse(localStorage.getItem(LS_LOG)) || [];
    } catch (e) {
        return [];
    }
}

/** Tambah log aktivitas */
function addActivityLog(action, detail) {
    const logs = getActivityLog();
    logs.unshift({
        timestamp: new Date().toISOString(),
        action: action,
        detail: detail,
        user: 'Super Admin'
    });

    // Batasi hanya 500 entri terakhir
    if (logs.length > 500) {
        logs.length = 500;
    }

    localStorage.setItem(LS_LOG, JSON.stringify(logs));
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/** Generate ID unik */
function generateId() {
    return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/** Escape HTML untuk mencegah XSS */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
}

/** Format tanggal (YYYY-MM-DD → DD/MM/YYYY) */
function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
    } catch (e) {
        return dateStr;
    }
}

/** Format tanggal dan waktu */
function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('id-ID', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    } catch (e) {
        return dateStr;
    }
}

/** Update jam di top bar */
function updateClock() {
    const el = document.getElementById('masterClock');
    if (el) {
        const now = new Date();
        el.textContent = now.toLocaleDateString('id-ID', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    }
}

/** Dapatkan badge status sekolah */
function getStatusBadge(status) {
    const badges = {
        active: '<span class="text-xs font-medium px-2.5 py-0.5 rounded-full badge-active"><i class="fas fa-check-circle mr-1"></i>Aktif</span>',
        suspended: '<span class="text-xs font-medium px-2.5 py-0.5 rounded-full badge-suspended"><i class="fas fa-pause-circle mr-1"></i>Suspended</span>',
        pending: '<span class="text-xs font-medium px-2.5 py-0.5 rounded-full badge-pending"><i class="fas fa-clock mr-1"></i>Pending</span>'
    };
    return badges[status] || badges.pending;
}

/** Dapatkan badge status registrasi */
function getRegStatusBadge(status) {
    const badges = {
        approved: '<span class="text-xs font-medium px-2.5 py-0.5 rounded-full badge-active"><i class="fas fa-check-circle mr-1"></i>Disetujui</span>',
        rejected: '<span class="text-xs font-medium px-2.5 py-0.5 rounded-full badge-rejected"><i class="fas fa-times-circle mr-1"></i>Ditolak</span>',
        pending: '<span class="text-xs font-medium px-2.5 py-0.5 rounded-full badge-pending"><i class="fas fa-clock mr-1"></i>Menunggu</span>'
    };
    return badges[status] || badges.pending;
}

/** Dapatkan ikon untuk tipe log */
function getLogIcon(action) {
    const icons = {
        login: 'fas fa-right-to-bracket',
        logout: 'fas fa-right-from-bracket',
        add_school: 'fas fa-plus',
        edit_school: 'fas fa-pen',
        delete_school: 'fas fa-trash',
        approve_school: 'fas fa-check',
        reject_school: 'fas fa-times',
        activate_school: 'fas fa-play',
        suspend_school: 'fas fa-pause',
        delete_registration: 'fas fa-trash',
        save_wa_config: 'fab fa-whatsapp',
        toggle_wa: 'fab fa-whatsapp',
        test_wa: 'fab fa-whatsapp',
        save_firebase: 'fas fa-fire',
        test_firebase: 'fas fa-plug',
        save_settings: 'fas fa-gear',
        toggle_maintenance: 'fas fa-wrench',
        export_data: 'fas fa-download',
        reset_data: 'fas fa-trash'
    };
    return icons[action] || 'fas fa-circle';
}

/** Dapatkan warna background untuk ikon log */
function getLogIconBg(action) {
    const bgs = {
        login: 'bg-blue-100 text-blue-600',
        logout: 'bg-gray-100 text-gray-600',
        add_school: 'bg-green-100 text-green-600',
        edit_school: 'bg-amber-100 text-amber-600',
        delete_school: 'bg-red-100 text-red-600',
        approve_school: 'bg-green-100 text-green-600',
        reject_school: 'bg-red-100 text-red-600',
        activate_school: 'bg-green-100 text-green-600',
        suspend_school: 'bg-amber-100 text-amber-600',
        delete_registration: 'bg-red-100 text-red-600',
        save_wa_config: 'bg-green-100 text-green-600',
        toggle_wa: 'bg-green-100 text-green-600',
        test_wa: 'bg-green-100 text-green-600',
        save_firebase: 'bg-orange-100 text-orange-600',
        test_firebase: 'bg-orange-100 text-orange-600',
        save_settings: 'bg-violet-100 text-violet-600',
        toggle_maintenance: 'bg-amber-100 text-amber-600',
        export_data: 'bg-blue-100 text-blue-600',
        reset_data: 'bg-red-100 text-red-600'
    };
    return bgs[action] || 'bg-gray-100 text-gray-600';
}

/** Dapatkan label untuk tipe aksi log */
function getLogActionLabel(action) {
    const labels = {
        login: 'Login',
        logout: 'Logout',
        add_school: 'Tambah',
        edit_school: 'Edit',
        delete_school: 'Hapus',
        approve_school: 'Setujui',
        reject_school: 'Tolak',
        activate_school: 'Aktifkan',
        suspend_school: 'Suspend',
        delete_registration: 'Hapus Reg',
        save_wa_config: 'WA Config',
        toggle_wa: 'WA Toggle',
        test_wa: 'WA Test',
        save_firebase: 'Firebase',
        test_firebase: 'Firebase Test',
        save_settings: 'Settings',
        toggle_maintenance: 'Maintenance',
        export_data: 'Export',
        reset_data: 'Reset'
    };
    return labels[action] || action;
}

/** Dapatkan badge warna untuk tipe aksi log */
function getLogActionBadge(action) {
    const badges = {
        login: 'bg-blue-50 text-blue-700',
        logout: 'bg-gray-100 text-gray-600',
        add_school: 'bg-green-50 text-green-700',
        edit_school: 'bg-amber-50 text-amber-700',
        delete_school: 'bg-red-50 text-red-700',
        approve_school: 'bg-green-50 text-green-700',
        reject_school: 'bg-red-50 text-red-700',
        activate_school: 'bg-green-50 text-green-700',
        suspend_school: 'bg-amber-50 text-amber-700',
        delete_registration: 'bg-red-50 text-red-700',
        save_wa_config: 'bg-green-50 text-green-700',
        toggle_wa: 'bg-green-50 text-green-700',
        test_wa: 'bg-green-50 text-green-700',
        save_firebase: 'bg-orange-50 text-orange-700',
        test_firebase: 'bg-orange-50 text-orange-700',
        save_settings: 'bg-violet-50 text-violet-700',
        toggle_maintenance: 'bg-amber-50 text-amber-700',
        export_data: 'bg-blue-50 text-blue-700',
        reset_data: 'bg-red-50 text-red-700'
    };
    return badges[action] || 'bg-gray-100 text-gray-600';
}

// ============================================
// DATA SEED (Contoh data awal untuk demo)
// ============================================

/** Seed data contoh jika localStorage kosong */
function seedDemoData() {
    // Cek apakah sudah ada data
    if (getSchools().length > 0 || getRegistrations().length > 0) return;

    // Data contoh sekolah
    const demoSchools = [
        {
            id: generateId(),
            nama: 'SMA Negeri 1 Jakarta',
            kodeSekolah: 'SMAN1JKT',
            gasUrl: 'https://script.google.com/macros/s/DEMO_GAS_1/exec',
            sheetUrl: 'https://docs.google.com/spreadsheets/d/DEMO_SHEET_1',
            adminNama: 'Ahmad Fauzi',
            adminNip: '198501012010011001',
            adminEmail: 'ahmad.fauzi@sman1jkt.sch.id',
            status: 'active',
            tanggalDaftar: '2026-01-15',
            totalGuru: 45,
            totalSiswa: 920,
            waApi: {
                enabled: true,
                provider: 'fonnte',
                apiUrl: 'https://api.fonnte.com/send',
                apiKey: 'demo_fonnte_key_123',
                deviceId: '',
                lastTest: new Date().toISOString(),
                lastTestStatus: 'success'
            }
        },
        {
            id: generateId(),
            nama: 'SMP Negeri 3 Bandung',
            kodeSekolah: 'SMPN3BDG',
            gasUrl: 'https://script.google.com/macros/s/DEMO_GAS_2/exec',
            sheetUrl: 'https://docs.google.com/spreadsheets/d/DEMO_SHEET_2',
            adminNama: 'Siti Nurhaliza',
            adminNip: '199001012015012001',
            adminEmail: 'siti.nurhaliza@smpn3bdg.sch.id',
            status: 'active',
            tanggalDaftar: '2026-02-10',
            totalGuru: 32,
            totalSiswa: 680,
            waApi: {
                enabled: false,
                provider: '',
                apiUrl: '',
                apiKey: '',
                deviceId: '',
                lastTest: null,
                lastTestStatus: null
            }
        },
        {
            id: generateId(),
            nama: 'SMK Negeri 2 Surabaya',
            kodeSekolah: 'SMKN2SBY',
            gasUrl: '',
            sheetUrl: '',
            adminNama: 'Budi Santoso',
            adminNip: '198703052011011002',
            adminEmail: 'budi.santoso@smkn2sby.sch.id',
            status: 'suspended',
            tanggalDaftar: '2026-03-01',
            totalGuru: 28,
            totalSiswa: 540,
            waApi: {
                enabled: true,
                provider: 'wablas',
                apiUrl: 'https://crown.wablas.com/api/send',
                apiKey: 'demo_wablas_token_456',
                deviceId: 'device_001',
                lastTest: new Date(Date.now() - 86400000).toISOString(),
                lastTestStatus: 'failed'
            }
        }
    ];

    // Data contoh registrasi
    const demoRegistrations = [
        {
            id: generateId(),
            nama: 'SMA Negeri 5 Yogyakarta',
            kodeSekolah: 'SMAN5YK',
            adminNama: 'Dewi Lestari',
            adminNip: '199205102018022001',
            adminEmail: 'dewi.lestari@sman5yk.sch.id',
            status: 'pending',
            tanggalDaftar: new Date().toISOString().split('T')[0]
        },
        {
            id: generateId(),
            nama: 'SMP Negeri 1 Semarang',
            kodeSekolah: 'SMPN1SMG',
            adminNama: 'Rizki Pratama',
            adminNip: '199310012019031001',
            adminEmail: 'rizki.pratama@smpn1smg.sch.id',
            status: 'pending',
            tanggalDaftar: new Date(Date.now() - 86400000 * 2).toISOString().split('T')[0]
        },
        {
            id: generateId(),
            nama: 'SMK Negeri 1 Medan',
            kodeSekolah: 'SMKN1MDN',
            adminNama: 'Hendra Wijaya',
            adminNip: '198805012012011003',
            adminEmail: 'hendra.wijaya@smkn1mdn.sch.id',
            status: 'rejected',
            tanggalDaftar: '2026-02-28'
        }
    ];

    localStorage.setItem(LS_SCHOOLS, JSON.stringify(demoSchools));
    localStorage.setItem(LS_REGISTRATIONS, JSON.stringify(demoRegistrations));

    // Tambahkan log awal
    const initLogs = [
        { timestamp: new Date(Date.now() - 86400000 * 7).toISOString(), action: 'add_school', detail: 'Menambahkan sekolah baru: SMA Negeri 1 Jakarta', user: 'Super Admin' },
        { timestamp: new Date(Date.now() - 86400000 * 5).toISOString(), action: 'add_school', detail: 'Menambahkan sekolah baru: SMP Negeri 3 Bandung', user: 'Super Admin' },
        { timestamp: new Date(Date.now() - 86400000 * 3).toISOString(), action: 'save_wa_config', detail: 'Menyimpan konfigurasi WA API untuk SMA Negeri 1 Jakarta (Aktif - FONNTE)', user: 'Super Admin' },
        { timestamp: new Date(Date.now() - 86400000 * 3).toISOString(), action: 'test_wa', detail: 'Test WA API untuk SMA Negeri 1 Jakarta: Berhasil', user: 'Super Admin' },
        { timestamp: new Date(Date.now() - 86400000 * 2).toISOString(), action: 'suspend_school', detail: 'mensuspend sekolah: SMK Negeri 2 Surabaya', user: 'Super Admin' },
        { timestamp: new Date(Date.now() - 86400000 * 1).toISOString(), action: 'save_settings', detail: 'Menyimpan pengaturan aplikasi (v2.0)', user: 'Super Admin' },
        { timestamp: new Date(Date.now() - 3600000).toISOString(), action: 'login', detail: 'Super Admin berhasil login ke panel master', user: 'Super Admin' }
    ];
    localStorage.setItem(LS_LOG, JSON.stringify(initLogs));
}

// Jalankan seed saat halaman pertama kali dimuat
seedDemoData();
