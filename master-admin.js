// ====================================================
// SMART ABSEN ENTERPRISE - MASTER ADMIN v4.0
// Developer Panel - Firebase Management & School Approval
// ====================================================

// ===== 1. CONSTANTS =====
const DEFAULT_SUPER_ADMIN_KEY = 'smartabsen2026';
const APP_VERSION = '4.0';

// ===== 2. STATE =====
let db = null;
let firebaseAppInstance = null;
let firebaseReady = false;
let activityLog = [];
let currentFilter = 'all';
let allRegistrations = [];
let allSchools = [];
let appConfigData = null;

// ===== 3. INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    initFirebaseFromStorage();
    setupLoginListeners();
});

function setupLoginListeners() {
    document.getElementById('btnMasterLogin').addEventListener('click', doLogin);
    document.getElementById('masterPassword').addEventListener('keypress', e => { if (e.key === 'Enter') doLogin(); });
}

// ===== 4. FIREBASE FUNCTIONS =====

function initFirebaseFromStorage() {
    const savedConfig = localStorage.getItem('masterFirebaseConfig');
    if (savedConfig) {
        try {
            const config = JSON.parse(savedConfig);
            populateFirebaseForm(config);
            initializeFirebase(config);
        } catch (e) {
            console.error('Failed to parse saved Firebase config:', e);
            updateLoginFirebaseStatus(false);
        }
    } else {
        updateLoginFirebaseStatus(false);
    }
}

async function initializeFirebase(config) {
    if (!config || !config.apiKey || config.apiKey === 'YOUR_API_KEY_HERE') {
        firebaseReady = false;
        updateLoginFirebaseStatus(false);
        updateFirebaseConnectionUI(false);
        return false;
    }
    try {
        if (firebaseAppInstance) {
            try { firebaseAppInstance.delete(); } catch (e) {}
        }
        firebaseAppInstance = firebase.initializeApp(config);
        db = firebase.firestore();
        await db.enablePersistence({ synchronizeTabs: true }).catch(err => {
            console.warn('Firestore persistence error:', err.code);
        });
        firebaseReady = true;
        updateLoginFirebaseStatus(true);
        updateFirebaseConnectionUI(true);
        console.log('Master Admin: Firebase initialized');
        return true;
    } catch (error) {
        console.error('Firebase init error:', error);
        firebaseReady = false;
        updateLoginFirebaseStatus(false);
        updateFirebaseConnectionUI(false);
        showToast('Gagal menghubungkan Firebase: ' + error.message, 'error');
        return false;
    }
}

function updateLoginFirebaseStatus(connected) {
    const dot = document.getElementById('loginFbDot');
    const text = document.getElementById('loginFbText');
    if (dot && text) {
        if (connected) {
            dot.className = 'w-2 h-2 rounded-full bg-green-400';
            text.className = 'text-green-400';
            text.textContent = 'Firebase Terhubung';
        } else {
            dot.className = 'w-2 h-2 rounded-full bg-slate-500';
            text.className = 'text-slate-400';
            text.textContent = 'Firebase Belum Dikonfigurasi';
        }
    }
}

function updateFirebaseConnectionUI(connected) {
    const dot = document.getElementById('fbConnDot');
    const text = document.getElementById('fbConnText');
    if (dot && text) {
        if (connected) {
            dot.className = 'w-3 h-3 rounded-full bg-green-400 animate-pulse';
            text.className = 'text-sm text-green-700 font-semibold';
            text.innerHTML = '<i class="fa-solid fa-check-circle mr-1"></i> Firebase Terhubung & Aktif';
        } else {
            dot.className = 'w-3 h-3 rounded-full bg-red-400';
            text.className = 'text-sm text-red-600 font-semibold';
            text.innerHTML = '<i class="fa-solid fa-times-circle mr-1"></i> Firebase Tidak Terhubung';
        }
    }
}

function populateFirebaseForm(config) {
    if (!config) return;
    const fields = {
        cfgApiKey: config.apiKey,
        cfgAuthDomain: config.authDomain,
        cfgProjectId: config.projectId,
        cfgStorageBucket: config.storageBucket,
        cfgSenderId: config.messagingSenderId,
        cfgAppId: config.appId
    };
    Object.keys(fields).forEach(id => {
        const el = document.getElementById(id);
        if (el && fields[id]) el.value = fields[id];
    });
}

function getFirebaseConfigFromForm() {
    return {
        apiKey: document.getElementById('cfgApiKey').value.trim(),
        authDomain: document.getElementById('cfgAuthDomain').value.trim(),
        projectId: document.getElementById('cfgProjectId').value.trim(),
        storageBucket: document.getElementById('cfgStorageBucket').value.trim(),
        messagingSenderId: document.getElementById('cfgSenderId').value.trim(),
        appId: document.getElementById('cfgAppId').value.trim()
    };
}

// ===== 5. LOGIN SYSTEM =====

async function doLogin() {
    const password = document.getElementById('masterPassword').value.trim();
    if (!password) return showToast('Masukkan Super Admin Key!', 'warning');

    // Get stored key or use default
    let storedKey = DEFAULT_SUPER_ADMIN_KEY;

    // If Firebase is ready, try to get key from Firestore
    if (firebaseReady && db) {
        try {
            const doc = await db.collection('appConfig').doc('config').get();
            if (doc.exists && doc.data().superAdminKey) {
                storedKey = doc.data().superAdminKey;
            }
        } catch (e) {
            console.warn('Could not fetch super admin key from Firestore:', e);
        }
    }

    if (password !== storedKey) {
        showToast('Super Admin Key salah!', 'error');
        return;
    }

    // Login success
    document.getElementById('login-page').classList.add('hidden');
    document.getElementById('sidebar').classList.remove('hidden');
    showPage('dashboard-page');
    showToast('Selamat datang, Super Admin!');

    // Load all data
    await refreshAllData();
}

function doLogout() {
    if (!confirm('Yakin ingin keluar dari Master Admin Panel?')) return;
    document.getElementById('masterPassword').value = '';
    document.getElementById('sidebar').classList.add('hidden');
    document.getElementById('login-page').classList.remove('hidden');
    allRegistrations = [];
    allSchools = [];
    activityLog = [];
}

// ===== 6. TOAST NOTIFICATION =====
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const colors = {
        success: 'bg-green-500', error: 'bg-red-500', warning: 'bg-amber-500', info: 'bg-violet-500'
    };
    const icons = {
        success: 'fa-circle-check', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info'
    };
    const toast = document.createElement('div');
    toast.className = `toast ${colors[type]} text-white px-5 py-3 rounded-xl shadow-lg flex items-center gap-3 text-sm font-semibold min-w-[280px]`;
    toast.innerHTML = `<i class="fa-solid ${icons[type]}"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3000);
}

// ===== 7. PAGE NAVIGATION =====

function showPage(id) {
    const allPages = ['dashboard-page', 'registrations-page', 'schools-page', 'firebase-page', 'appconfig-page', 'activity-page'];
    allPages.forEach(p => { const el = document.getElementById(p); if (el) el.classList.add('hidden'); });
    const target = document.getElementById(id);
    if (target) { target.classList.remove('hidden'); target.classList.add('fade-in'); }

    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    const activeLink = document.querySelector(`.sidebar-link[data-page="${id}"]`);
    if (activeLink) activeLink.add('active');

    if (id === 'dashboard-page') updateDashboard();
    if (id === 'registrations-page') renderRegistrationsTable();
    if (id === 'schools-page') renderSchoolsTable();
    if (id === 'firebase-page') updateFirebaseConnectionUI(firebaseReady);
    if (id === 'appconfig-page') loadAppConfigPage();
    if (id === 'activity-page') renderActivityLog();
}

// ===== 8. MODAL HELPERS =====

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// ===== 9. DASHBOARD =====

function updateDashboard() {
    // Date
    const now = new Date();
    document.getElementById('dashDate').textContent = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    // Stats
    document.getElementById('statTotalSchools').textContent = allSchools.length;
    document.getElementById('statActiveSchools').textContent = allSchools.filter(s => s.isActive !== false).length;
    document.getElementById('statTotalRegs').textContent = allRegistrations.length;
    document.getElementById('statPendingRegs').textContent = allRegistrations.filter(r => r.status === 'pending').length;
    document.getElementById('statRejectedRegs').textContent = allRegistrations.filter(r => r.status === 'rejected').length;

    // Firebase status
    document.getElementById('dashFbStatus').textContent = firebaseReady ? 'Online' : 'Offline';
    document.getElementById('dashFbStatus').className = firebaseReady ? 'text-2xl font-black mt-1 text-green-300' : 'text-2xl font-black mt-1 text-red-300';

    // App mode
    const isMaintenance = appConfigData && appConfigData.maintenanceMode;
    document.getElementById('dashAppMode').textContent = isMaintenance ? 'Maintenance' : 'Normal';
    document.getElementById('dashAppMode').className = isMaintenance ? 'text-2xl font-black mt-1 text-amber-300' : 'text-2xl font-black mt-1 text-green-300';

    // Pending badge
    const pendingCount = allRegistrations.filter(r => r.status === 'pending').length;
    const badge = document.getElementById('pendingBadge');
    if (pendingCount > 0) {
        badge.classList.remove('hidden');
        badge.textContent = pendingCount;
    } else {
        badge.classList.add('hidden');
    }

    // Recent registrations table
    const recentBody = document.getElementById('recentRegsTable');
    const emptyEl = document.getElementById('emptyRecentRegs');
    const recent = [...allRegistrations].sort((a, b) => {
        const ta = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : new Date(0);
        const tb = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date(0);
        return tb - ta;
    }).slice(0, 10);

    if (recent.length === 0) {
        recentBody.innerHTML = '';
        emptyEl.classList.remove('hidden');
    } else {
        emptyEl.classList.add('hidden');
        recentBody.innerHTML = recent.map(r => {
            const date = r.createdAt ? (r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt)) : null;
            const dateStr = date ? date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
            const statusBadge = getStatusBadge(r.status);
            return `<tr class="border-b border-slate-50 table-row">
                <td class="p-4 text-xs text-slate-500">${dateStr}</td>
                <td class="p-4 font-semibold">${escHtml(r.nama)}</td>
                <td class="p-4">${escHtml(r.sekolah)}</td>
                <td class="p-4 font-mono text-xs">${escHtml(r.nip)}</td>
                <td class="p-4">${statusBadge}</td>
            </tr>`;
        }).join('');
    }
}

function getStatusBadge(status) {
    const badges = {
        pending: '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 uppercase">Pending</span>',
        approved: '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-green-100 text-green-700 uppercase">Disetujui</span>',
        rejected: '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-red-100 text-red-700 uppercase">Ditolak</span>'
    };
    return badges[status] || `<span class="text-xs text-slate-400">${escHtml(status)}</span>`;
}

// ===== 10. REGISTRATIONS MANAGEMENT =====

function filterRegistrations(filter) {
    currentFilter = filter;
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.className = 'tab-btn px-4 py-2 rounded-xl text-sm font-semibold bg-white text-slate-600 border border-slate-200';
    });
    const activeBtn = document.querySelector(`.tab-btn[data-filter="${filter}"]`);
    if (activeBtn) {
        activeBtn.className = 'tab-btn px-4 py-2 rounded-xl text-sm font-semibold bg-violet-600 text-white shadow';
    }
    renderRegistrationsTable();
}

function renderRegistrationsTable() {
    const body = document.getElementById('registrationsTableBody');
    const emptyEl = document.getElementById('emptyRegistrations');
    const search = document.getElementById('searchRegistrations').value.toLowerCase();

    let filtered = allRegistrations;
    if (currentFilter !== 'all') {
        filtered = filtered.filter(r => r.status === currentFilter);
    }
    if (search) {
        filtered = filtered.filter(r =>
            (r.nama || '').toLowerCase().includes(search) ||
            (r.sekolah || '').toLowerCase().includes(search) ||
            (r.nip || '').toLowerCase().includes(search)
        );
    }

    // Sort by date
    filtered.sort((a, b) => {
        const ta = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : new Date(0);
        const tb = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date(0);
        return tb - ta;
    });

    // Update counts
    document.getElementById('countAll').textContent = allRegistrations.length;
    document.getElementById('countPending').textContent = allRegistrations.filter(r => r.status === 'pending').length;
    document.getElementById('countApproved').textContent = allRegistrations.filter(r => r.status === 'approved').length;
    document.getElementById('countRejected').textContent = allRegistrations.filter(r => r.status === 'rejected').length;

    if (filtered.length === 0) {
        body.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
    }

    emptyEl.classList.add('hidden');
    body.innerHTML = filtered.map(r => {
        const date = r.createdAt ? (r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt)) : null;
        const dateStr = date ? date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
        const statusBadge = getStatusBadge(r.status);
        const isPending = r.status === 'pending';

        let actionsHtml = '';
        if (isPending) {
            actionsHtml = `
                <button onclick="openApproveModal('${r.id}')" class="px-2 py-1.5 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 text-xs font-semibold transition mr-1" title="Setujui">
                    <i class="fa-solid fa-check mr-1"></i>Setujui
                </button>
                <button onclick="openRejectModal('${r.id}')" class="px-2 py-1.5 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 text-xs font-semibold transition" title="Tolak">
                    <i class="fa-solid fa-times mr-1"></i>Tolak
                </button>`;
        } else {
            const approvedDate = r.approvedAt ? (r.approvedAt.toDate ? r.approvedAt.toDate() : new Date(r.approvedAt)) : null;
            const rejectedDate = r.rejectedAt ? (r.rejectedAt.toDate ? r.rejectedAt.toDate() : new Date(r.rejectedAt)) : null;
            const detailDate = approvedDate || rejectedDate;
            const detailStr = detailDate ? detailDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
            actionsHtml = `<span class="text-xs text-slate-400">${detailStr}</span>`;
        }

        return `<tr class="border-b border-slate-50 table-row">
            <td class="p-4 text-xs text-slate-500 whitespace-nowrap">${dateStr}</td>
            <td class="p-4 font-semibold">${escHtml(r.nama)}</td>
            <td class="p-4 font-mono text-xs">${escHtml(r.nip)}</td>
            <td class="p-4">${escHtml(r.sekolah)}</td>
            <td class="p-4 text-xs">${escHtml(r.telp || '-')}</td>
            <td class="p-4">${statusBadge}</td>
            <td class="p-4 text-center whitespace-nowrap">${actionsHtml}</td>
        </tr>`;
    }).join('');
}

function openApproveModal(regId) {
    const reg = allRegistrations.find(r => r.id === regId);
    if (!reg) return;

    document.getElementById('approveDetail').innerHTML = `
        <p><strong>Nama:</strong> ${escHtml(reg.nama)}</p>
        <p><strong>NIP:</strong> ${escHtml(reg.nip)}</p>
        <p><strong>Sekolah:</strong> ${escHtml(reg.sekolah)}</p>
        <p><strong>Telepon:</strong> ${escHtml(reg.telp || '-')}</p>
    `;
    document.getElementById('btnConfirmApprove').onclick = () => approveRegistration(regId);
    openModal('modalApprove');
}

function openRejectModal(regId) {
    const reg = allRegistrations.find(r => r.id === regId);
    if (!reg) return;

    document.getElementById('rejectDetail').innerHTML = `
        <p><strong>Nama:</strong> ${escHtml(reg.nama)}</p>
        <p><strong>NIP:</strong> ${escHtml(reg.nip)}</p>
        <p><strong>Sekolah:</strong> ${escHtml(reg.sekolah)}</p>
    `;
    document.getElementById('rejectReason').value = '';
    document.getElementById('btnConfirmReject').onclick = () => {
        const reason = document.getElementById('rejectReason').value.trim();
        rejectRegistration(regId, reason);
    };
    openModal('modalReject');
}

async function approveRegistration(regId) {
    if (!firebaseReady || !db) return showToast('Firebase tidak terhubung!', 'error');
    
    const btn = document.getElementById('btnConfirmApprove');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Memproses...';

    try {
        const regRef = db.collection('registrations').doc(regId);
        const regDoc = await regRef.get();
        if (!regDoc.exists) {
            showToast('Data registrasi tidak ditemukan!', 'error');
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-check mr-1"></i> Setujui';
            return;
        }
        const regData = regDoc.data();

        // Check NIP uniqueness in schools
        const existingSchool = await db.collection('schools').where('nip', '==', regData.nip).limit(1).get();
        if (!existingSchool.empty) {
            showToast('NIP sudah terdaftar sebagai sekolah!', 'error');
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-check mr-1"></i> Setujui';
            return;
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

        addActivityLog('approve', `Menyetujui registrasi ${regData.nama} (${regData.sekolah})`);
        closeModal('modalApprove');
        showToast('Registrasi berhasil disetujui!');
        await refreshAllData();
    } catch (e) {
        console.error('Approve error:', e);
        showToast('Gagal menyetujui: ' + e.message, 'error');
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check mr-1"></i> Setujui';
}

async function rejectRegistration(regId, reason) {
    if (!firebaseReady || !db) return showToast('Firebase tidak terhubung!', 'error');

    const btn = document.getElementById('btnConfirmReject');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Memproses...';

    try {
        const regRef = db.collection('registrations').doc(regId);
        const regDoc = await regRef.get();
        if (!regDoc.exists) {
            showToast('Data registrasi tidak ditemukan!', 'error');
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-ban mr-1"></i> Tolak';
            return;
        }
        const regData = regDoc.data();

        await regRef.update({
            status: 'rejected',
            rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
            rejectReason: reason || 'Tidak disebutkan'
        });

        addActivityLog('reject', `Menolak registrasi ${regData.nama} (${regData.sekolah}). Alasan: ${reason || 'Tidak disebutkan'}`);
        closeModal('modalReject');
        showToast('Registrasi ditolak.', 'info');
        await refreshAllData();
    } catch (e) {
        console.error('Reject error:', e);
        showToast('Gagal menolak: ' + e.message, 'error');
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-ban mr-1"></i> Tolak';
}

// ===== 11. SCHOOLS MANAGEMENT =====

function renderSchoolsTable() {
    const body = document.getElementById('schoolsTableBody');
    const emptyEl = document.getElementById('emptySchools');
    const search = document.getElementById('searchSchools').value.toLowerCase();
    const statusFilter = document.getElementById('filterSchoolStatus').value;

    let filtered = allSchools;
    if (statusFilter === 'active') filtered = filtered.filter(s => s.isActive !== false);
    else if (statusFilter === 'inactive') filtered = filtered.filter(s => s.isActive === false);
    if (search) {
        filtered = filtered.filter(s =>
            (s.sekolah || '').toLowerCase().includes(search) ||
            (s.nama || '').toLowerCase().includes(search) ||
            (s.nip || '').toLowerCase().includes(search)
        );
    }

    if (filtered.length === 0) {
        body.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
    }

    emptyEl.classList.add('hidden');
    body.innerHTML = filtered.map((s, i) => {
        const isActive = s.isActive !== false;
        const hasGas = s.gasUrl && s.gasUrl.length > 5;
        const hasSheet = s.sheetUrl && s.sheetUrl.length > 5;
        const statusBadge = isActive
            ? '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-green-100 text-green-700 uppercase">Aktif</span>'
            : '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-red-100 text-red-700 uppercase">Non-Aktif</span>';
        const gasBadge = hasGas
            ? '<span class="text-green-600 text-xs" title="' + escHtml(s.gasUrl) + '"><i class="fa-solid fa-check-circle"></i> Terhubung</span>'
            : '<span class="text-slate-400 text-xs"><i class="fa-solid fa-times-circle"></i> Belum</span>';
        const sheetBadge = hasSheet
            ? '<span class="text-green-600 text-xs" title="' + escHtml(s.sheetUrl) + '"><i class="fa-solid fa-check-circle"></i> Ada</span>'
            : '<span class="text-slate-400 text-xs"><i class="fa-solid fa-times-circle"></i> Belum</span>';

        return `<tr class="border-b border-slate-50 table-row">
            <td class="p-4 text-xs text-slate-400 font-semibold">${i + 1}</td>
            <td class="p-4">
                <p class="font-semibold">${escHtml(s.sekolah || '-')}</p>
            </td>
            <td class="p-4 text-sm">${escHtml(s.nama || '-')}</td>
            <td class="p-4 font-mono text-xs">${escHtml(s.nip || '-')}</td>
            <td class="p-4">${gasBadge}</td>
            <td class="p-4">${sheetBadge}</td>
            <td class="p-4">${statusBadge}</td>
            <td class="p-4 text-center whitespace-nowrap">
                <button onclick="openEditSchoolModal('${s.id}')" class="px-2 py-1.5 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200 text-xs font-semibold transition mr-1" title="Edit">
                    <i class="fa-solid fa-pen mr-1"></i>Edit
                </button>
                <button onclick="openDeleteSchoolModal('${s.id}')" class="px-2 py-1.5 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 text-xs font-semibold transition" title="Hapus">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        </tr>`;
    }).join('');
}

function openEditSchoolModal(schoolId) {
    const school = allSchools.find(s => s.id === schoolId);
    if (!school) return;

    document.getElementById('editSchoolId').value = schoolId;
    document.getElementById('editSchoolNama').value = school.sekolah || '';
    document.getElementById('editSchoolAdmin').value = school.nama || '';
    document.getElementById('editSchoolNip').value = school.nip || '';
    document.getElementById('editSchoolTelp').value = school.telp || '';
    document.getElementById('editSchoolGasUrl').value = school.gasUrl || '';
    document.getElementById('editSchoolSheetUrl').value = school.sheetUrl || '';
    document.getElementById('editSchoolPassword').value = '';
    document.getElementById('editSchoolActive').checked = school.isActive !== false;
    document.getElementById('editSchoolTitle').textContent = school.sekolah || school.nama;
    openModal('modalEditSchool');
}

async function saveSchoolConfig() {
    if (!firebaseReady || !db) return showToast('Firebase tidak terhubung!', 'error');

    const schoolId = document.getElementById('editSchoolId').value;
    const data = {
        telp: document.getElementById('editSchoolTelp').value.trim(),
        gasUrl: document.getElementById('editSchoolGasUrl').value.trim(),
        sheetUrl: document.getElementById('editSchoolSheetUrl').value.trim(),
        isActive: document.getElementById('editSchoolActive').checked
    };

    const newPassword = document.getElementById('editSchoolPassword').value.trim();
    if (newPassword) {
        data.password = newPassword;
    }

    try {
        await db.collection('schools').doc(schoolId).update(data);
        const school = allSchools.find(s => s.id === schoolId);
        addActivityLog('edit', `Mengedit konfigurasi sekolah: ${school ? school.sekolah : schoolId}`);
        closeModal('modalEditSchool');
        showToast('Konfigurasi sekolah berhasil disimpan!');
        await refreshAllData();
    } catch (e) {
        console.error('Save school config error:', e);
        showToast('Gagal menyimpan: ' + e.message, 'error');
    }
}

function openDeleteSchoolModal(schoolId) {
    const school = allSchools.find(s => s.id === schoolId);
    if (!school) return;

    document.getElementById('deleteSchoolDetail').innerHTML = `
        <p class="font-semibold text-red-800">${escHtml(school.sekolah || school.nama)}</p>
        <p class="text-sm text-red-600 mt-1">Admin: ${escHtml(school.nama)} | NIP: ${escHtml(school.nip)}</p>
    `;
    document.getElementById('btnConfirmDeleteSchool').onclick = () => deleteSchool(schoolId);
    openModal('modalDeleteSchool');
}

async function deleteSchool(schoolId) {
    if (!firebaseReady || !db) return showToast('Firebase tidak terhubung!', 'error');

    const btn = document.getElementById('btnConfirmDeleteSchool');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menghapus...';

    try {
        const school = allSchools.find(s => s.id === schoolId);
        await db.collection('schools').doc(schoolId).delete();
        addActivityLog('delete', `Menghapus sekolah: ${school ? school.sekolah : schoolId}`);
        closeModal('modalDeleteSchool');
        showToast('Sekolah berhasil dihapus.', 'info');
        await refreshAllData();
    } catch (e) {
        console.error('Delete school error:', e);
        showToast('Gagal menghapus: ' + e.message, 'error');
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-trash mr-1"></i> Ya, Hapus';
}

// ===== 12. FIREBASE CONFIG MANAGEMENT =====

async function testFirebaseConnection() {
    const config = getFirebaseConfigFromForm();
    if (!config.apiKey) return showToast('API Key wajib diisi!', 'warning');

    showToast('Menguji koneksi Firebase...', 'info');

    try {
        // Temporarily initialize
        if (firebaseAppInstance) {
            try { firebaseAppInstance.delete(); } catch (e) {}
            firebaseAppInstance = null;
        }

        const tempApp = firebase.initializeApp(config, 'test-connection');
        const tempDb = tempDb = tempApp.firestore();
        // Try a simple read
        await tempDb.collection('appConfig').doc('config').get().catch(() => {});
        
        await tempApp.delete();
        showToast('Koneksi Firebase berhasil!', 'success');
    } catch (e) {
        console.error('Test connection error:', e);
        // Clean up
        try {
            const testApp = firebase.apps.find(a => a.name === 'test-connection');
            if (testApp) await testApp.delete();
        } catch (err) {}
        showToast('Koneksi gagal: ' + e.message, 'error');
    }
}

async function saveFirebaseConfig() {
    const config = getFirebaseConfigFromForm();
    if (!config.apiKey) return showToast('API Key wajib diisi!', 'warning');
    if (!config.projectId) return showToast('Project ID wajib diisi!', 'warning');

    showToast('Menyimpan konfigurasi...', 'info');

    // Save to localStorage
    localStorage.setItem('masterFirebaseConfig', JSON.stringify(config));

    // Reinitialize Firebase
    const success = await initializeFirebase(config);
    if (success) {
        addActivityLog('config', 'Konfigurasi Firebase diperbarui');
        showToast('Konfigurasi Firebase berhasil disimpan & terhubung!', 'success');
    } else {
        showToast('Konfigurasi disimpan tetapi gagal terhubung.', 'warning');
    }
}

function clearFirebaseConfig() {
    if (!confirm('Yakin ingin menghapus konfigurasi Firebase?')) return;

    localStorage.removeItem('masterFirebaseConfig');
    
    // Clear form
    ['cfgApiKey', 'cfgAuthDomain', 'cfgProjectId', 'cfgStorageBucket', 'cfgSenderId', 'cfgAppId'].forEach(id => {
        document.getElementById(id).value = '';
    });

    // Reset Firebase
    if (firebaseAppInstance) {
        try { firebaseAppInstance.delete(); } catch (e) {}
        firebaseAppInstance = null;
    }
    db = null;
    firebaseReady = false;
    updateFirebaseConnectionUI(false);
    addActivityLog('config', 'Konfigurasi Firebase dihapus');
    showToast('Konfigurasi Firebase berhasil dihapus.', 'info');
}

// ===== 13. APP CONFIG =====

async function loadAppConfigPage() {
    if (!firebaseReady || !db) {
        document.getElementById('cfgSuperAdminKey').value = DEFAULT_SUPER_ADMIN_KEY;
        document.getElementById('cfgMaintenance').checked = false;
        return;
    }

    try {
        const doc = await db.collection('appConfig').doc('config').get();
        if (doc.exists) {
            const data = doc.data();
            appConfigData = data;
            document.getElementById('cfgSuperAdminKey').value = data.superAdminKey || DEFAULT_SUPER_ADMIN_KEY;
            document.getElementById('cfgMaintenance').checked = !!data.maintenanceMode;
            document.getElementById('cfgBroadcastMsg').value = data.broadcastMessage || '';
        } else {
            appConfigData = { superAdminKey: DEFAULT_SUPER_ADMIN_KEY, maintenanceMode: false };
            document.getElementById('cfgSuperAdminKey').value = DEFAULT_SUPER_ADMIN_KEY;
            document.getElementById('cfgMaintenance').checked = false;
        }
    } catch (e) {
        console.error('Load app config error:', e);
        document.getElementById('cfgSuperAdminKey').value = DEFAULT_SUPER_ADMIN_KEY;
    }
}

async function saveSuperAdminKey() {
    const newKey = document.getElementById('cfgSuperAdminKey').value.trim();
    if (!newKey || newKey.length < 4) return showToast('Key minimal 4 karakter!', 'warning');

    if (firebaseReady && db) {
        try {
            await db.collection('appConfig').doc('config').set({
                superAdminKey: newKey,
                maintenanceMode: document.getElementById('cfgMaintenance').checked,
                broadcastMessage: document.getElementById('cfgBroadcastMsg').value.trim(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                version: APP_VERSION
            }, { merge: true });
            addActivityLog('config', 'Super Admin Key diperbarui');
            showToast('Super Admin Key berhasil disimpan ke Firebase!', 'success');
        } catch (e) {
            showToast('Gagal menyimpan: ' + e.message, 'error');
        }
    } else {
        showToast('Firebase tidak terhubung. Key hanya disimpan di localStorage.', 'warning');
    }
}

async function toggleMaintenance() {
    const isMaintenance = document.getElementById('cfgMaintenance').checked;

    if (firebaseReady && db) {
        try {
            await db.collection('appConfig').doc('config').set({
                maintenanceMode: isMaintenance,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            addActivityLog('config', `Maintenance mode ${isMaintenance ? 'diaktifkan' : 'dinonaktifkan'}`);
            showToast(`Maintenance mode ${isMaintenance ? 'diaktifkan' : 'dinonaktifkan'}!`, isMaintenance ? 'warning' : 'success');
        } catch (e) {
            document.getElementById('cfgMaintenance').checked = !isMaintenance;
            showToast('Gagal mengubah: ' + e.message, 'error');
        }
    } else {
        document.getElementById('cfgMaintenance').checked = !isMaintenance;
        showToast('Firebase tidak terhubung!', 'error');
    }
}

async function saveBroadcastMessage() {
    const msg = document.getElementById('cfgBroadcastMsg').value.trim();
    if (!msg) return showToast('Pesan broadcast kosong!', 'warning');

    if (firebaseReady && db) {
        try {
            await db.collection('appConfig').doc('config').set({
                broadcastMessage: msg,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            addActivityLog('broadcast', `Pesan broadcast dikirim: "${msg.substring(0, 50)}..."`);
            showToast('Pesan broadcast berhasil dikirim!', 'success');
        } catch (e) {
            showToast('Gagal mengirim: ' + e.message, 'error');
        }
    } else {
        showToast('Firebase tidak terhubung!', 'error');
    }
}

async function clearBroadcastMessage() {
    if (firebaseReady && db) {
        try {
            await db.collection('appConfig').doc('config').set({
                broadcastMessage: '',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            document.getElementById('cfgBroadcastMsg').value = '';
            addActivityLog('broadcast', 'Pesan broadcast dihapus');
            showToast('Pesan broadcast berhasil dihapus!', 'success');
        } catch (e) {
            showToast('Gagal menghapus: ' + e.message, 'error');
        }
    } else {
        showToast('Firebase tidak terhubung!', 'error');
    }
}

// ===== 14. ACTIVITY LOG =====

function addActivityLog(type, message) {
    activityLog.unshift({
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        type: type,
        message: message,
        timestamp: new Date().toISOString()
    });
    // Keep max 200 entries
    if (activityLog.length > 200) activityLog = activityLog.slice(0, 200);
    // Save to localStorage
    localStorage.setItem('masterActivityLog', JSON.stringify(activityLog));
}

function renderActivityLog() {
    const body = document.getElementById('activityLogBody');
    const emptyEl = document.getElementById('emptyActivityLog');

    if (activityLog.length === 0) {
        body.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
    }

    emptyEl.classList.add('hidden');
    body.innerHTML = activityLog.map(log => {
        const date = new Date(log.timestamp);
        const dateStr = date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        const typeIcons = {
            approve: '<span class="w-7 h-7 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0"><i class="fa-solid fa-check text-green-600 text-xs"></i></span>',
            reject: '<span class="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0"><i class="fa-solid fa-times text-red-600 text-xs"></i></span>',
            edit: '<span class="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0"><i class="fa-solid fa-pen text-blue-600 text-xs"></i></span>',
            delete: '<span class="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0"><i class="fa-solid fa-trash text-red-600 text-xs"></i></span>',
            config: '<span class="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0"><i class="fa-solid fa-gear text-violet-600 text-xs"></i></span>',
            broadcast: '<span class="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0"><i class="fa-solid fa-bullhorn text-amber-600 text-xs"></i></span>'
        };
        const icon = typeIcons[log.type] || typeIcons.config;

        return `<tr class="border-b border-slate-50 table-row">
            <td class="p-4 text-xs text-slate-500 whitespace-nowrap">${dateStr}</td>
            <td class="p-4">${icon}</td>
            <td class="p-4 text-sm">${escHtml(log.message)}</td>
        </tr>`;
    }).join('');
}

function loadActivityLogFromStorage() {
    try {
        activityLog = JSON.parse(localStorage.getItem('masterActivityLog')) || [];
    } catch (e) {
        activityLog = [];
    }
}

// ===== 15. DATA REFRESH =====

async function refreshAllData() {
    if (!firebaseReady || !db) return;
    showToast('Memuat data...', 'info');
    await Promise.all([
        loadRegistrations(),
        loadSchools(),
        loadAppConfig()
    ]);
    loadActivityLogFromStorage();
    updateDashboard();
}

async function refreshSchools() {
    if (!firebaseReady || !db) return;
    showToast('Memuat data sekolah...', 'info');
    await loadSchools();
    renderSchoolsTable();
}

function refreshActivityLog() {
    loadActivityLogFromStorage();
    renderActivityLog();
    showToast('Log aktivitas diperbarui.', 'info');
}

async function loadRegistrations() {
    if (!firebaseReady || !db) { allRegistrations = []; return; }
    try {
        const snap = await db.collection('registrations').orderBy('createdAt', 'desc').get();
        allRegistrations = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
        console.error('Load registrations error:', e);
        allRegistrations = [];
    }
}

async function loadSchools() {
    if (!firebaseReady || !db) { allSchools = []; return; }
    try {
        const snap = await db.collection('schools').orderBy('createdAt', 'desc').get();
        allSchools = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
        console.error('Load schools error:', e);
        allSchools = [];
    }
}

async function loadAppConfig() {
    if (!firebaseReady || !db) { appConfigData = null; return; }
    try {
        const doc = await db.collection('appConfig').doc('config').get();
        appConfigData = doc.exists ? doc.data() : null;
    } catch (e) {
        console.error('Load app config error:', e);
        appConfigData = null;
    }
}

// ===== 16. UTILITIES =====

function escHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ===== INIT =====
loadActivityLogFromStorage();
