// ====================================================
// SMART ABSEN ENTERPRISE - Halaman Absensi Guru/Wali
// ====================================================
// File ini menangani logika absensi manual oleh guru,
// wali kelas, dan guru piket. Membaca data dari
// localStorage yang sama dengan app.js utama.
// ====================================================

let GAS_URL = "URL_APPS_SCRIPT_ANDA_DISINI";

function loadGasUrl() {
    try {
        const settings = getData('appSettings', {});
        const driveConfig = getData('googleDriveConfig', null);
        if (driveConfig && driveConfig.gasUrl) {
            GAS_URL = driveConfig.gasUrl;
        } else if (settings.gasUrl) {
            GAS_URL = settings.gasUrl;
        }
    } catch(e) {
        console.log('GAS_URL not configured');
    }
}

// ===== STATE APLIKASI =====
let currentUser = null;            // Pengguna yang sedang login
let attendanceData = {};           // Data absensi sementara: { siswaId: { status, keterangan } }
let selectedKelasId = null;        // ID kelas yang sedang dipilih
let selectedTanggal = null;        // Tanggal yang sedang dipilih
let isEditMode = false;            // Mode edit (sudah pernah diinput sebelumnya)
let isSubmitting = false;          // Flag untuk mencegah submit ganda

// Template pesan WhatsApp
const waTemplates = {
    hadir: "Assalamualaikum, Ananda *{NAMA}* ({KELAS}) telah *HADIR* di sekolah pada {TANGGAL} pukul {WAKTU}. Terima kasih. - {SEKOLAH}",
    sakit: "Assalamualaikum, Ananda *{NAMA}* ({KELAS}) hari ini *SAKIT*. Ket: {KETERANGAN}. Mohon istirahat yang cukup. - {SEKOLAH}",
    izin: "Assalamualaikum, Ananda *{NAMA}* ({KELAS}) hari ini *IZIN*. Ket: {KETERANGAN}. Terima kasih konfirmasinya. - {SEKOLAH}",
    alfa: "Assalamualaikum, Ananda *{NAMA}* ({KELAS}) hari ini *TIDAK HADIR (ALFA)* pada {TANGGAL}. Mohon konfirmasi ke pihak sekolah. - {SEKOLAH}",
    terlambat: "Assalamualaikum, Ananda *{NAMA}* ({KELAS}) hari ini *TERLAMBAT* masuk sekolah. Mohon perhatian. - {SEKOLAH}"
};

// Konfigurasi warna status absensi
const statusConfig = {
    HADIR:     { label: 'H', warna: 'bg-green-500',     teks: 'text-white',  border: 'ring-green-300', ring: 'ring-2 ring-green-400 ring-offset-2', badge: 'bg-green-100 text-green-700' },
    SAKIT:     { label: 'S', warna: 'bg-yellow-400',    teks: 'text-white',  border: 'ring-yellow-300', ring: 'ring-2 ring-yellow-400 ring-offset-2', badge: 'bg-yellow-100 text-yellow-700' },
    IZIN:      { label: 'I', warna: 'bg-blue-500',      teks: 'text-white',  border: 'ring-blue-300', ring: 'ring-2 ring-blue-400 ring-offset-2', badge: 'bg-blue-100 text-blue-700' },
    ALFA:      { label: 'A', warna: 'bg-red-500',       teks: 'text-white',  border: 'ring-red-300', ring: 'ring-2 ring-red-400 ring-offset-2', badge: 'bg-red-100 text-red-700' },
    TERLAMBAT: { label: 'T', warna: 'bg-orange-500',    teks: 'text-white',  border: 'ring-orange-300', ring: 'ring-2 ring-orange-400 ring-offset-2', badge: 'bg-orange-100 text-orange-700' }
};

// Label peran pengguna
const roleLabels = { admin: 'Administrator', kepsek: 'Kepala Sekolah', piket: 'Guru Piket', wali: 'Wali Kelas', guru: 'Guru' };

// ===== 1. FUNGSI UTILITAS =====

/**
 * Mengambil data dari localStorage dengan fallback
 * @param {string} key - Kunci localStorage
 * @param {*} fallback - Nilai default jika tidak ditemukan
 * @returns {*} Data yang diambil atau fallback
 */
function getData(key, fallback) {
    try {
        const val = localStorage.getItem(key);
        return val ? JSON.parse(val) : fallback;
    } catch (e) {
        return fallback;
    }
}

/**
 * Menyimpan data ke localStorage
 * @param {string} key - Kunci localStorage
 * @param {*} data - Data yang akan disimpan
 */
function setData(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
}

/**
 * Menghasilkan ID unik
 * @returns {string} ID unik berbasis timestamp dan random
 */
function genId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

/**
 * Mendapatkan tanggal hari ini dalam format YYYY-MM-DD
 * @returns {string} Tanggal hari ini
 */
function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Mendapatkan waktu saat ini dalam format HH:MM:SS
 * @returns {string} Waktu saat ini
 */
function timeStr() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/**
 * Format tanggal YYYY-MM-DD ke format Indonesia
 * @param {string} dateStr - Tanggal dalam format YYYY-MM-DD
 * @returns {string} Tanggal dalam format Indonesia
 */
function formatTanggal(dateStr) {
    if (!dateStr) return '-';
    const bulan = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const hari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    return `${hari[dateObj.getDay()]}, ${parseInt(parts[2])} ${bulan[parseInt(parts[1]) - 1]} ${parts[0]}`;
}

/**
 * Menampilkan notifikasi toast
 * @param {string} message - Pesan yang ditampilkan
 * @param {string} type - Tipe toast: success, error, warning, info
 */
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const colors = {
        success: 'bg-green-500',
        error: 'bg-red-500',
        warning: 'bg-amber-500',
        info: 'bg-sky-500'
    };
    const icons = {
        success: 'fa-circle-check',
        error: 'fa-circle-xmark',
        warning: 'fa-triangle-exclamation',
        info: 'fa-circle-info'
    };

    const toast = document.createElement('div');
    toast.className = `${colors[type] || colors.success} text-white px-5 py-3 rounded-xl shadow-lg flex items-center gap-3 text-sm font-semibold min-w-[280px] max-w-[400px] transform transition-all duration-300 translate-y-[-20px] opacity-0`;
    toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.success}"></i><span>${message}</span>`;
    container.appendChild(toast);

    // Animasi masuk
    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-[-20px]', 'opacity-0');
        toast.classList.add('translate-y-0', 'opacity-100');
    });

    // Animasi keluar dan hapus setelah 3 detik
    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-[-20px]', 'opacity-0');
        setTimeout(() => {
            if (toast.parentNode) toast.remove();
        }, 300);
    }, 3000);
}

/**
 * Mendapatkan nama profil sekolah dari localStorage
 * @returns {string} Nama sekolah
 */
function getSchoolName() {
    const profile = getData('appProfile', {});
    return profile.name || 'Smart Absen Enterprise';
}

// ===== 2. INISIALISASI APLIKASI =====

/**
 * Inisialisasi saat halaman dimuat.
 * Mengecek apakah pengguna sudah login sebelumnya.
 */
document.addEventListener('DOMContentLoaded', function () {
    // Event listeners untuk login
    const btnLoginEl = document.getElementById('btnLogin');
    if (btnLoginEl) btnLoginEl.addEventListener('click', doLogin);

    const loginNipEl = document.getElementById('loginNip');
    if (loginNipEl) loginNipEl.addEventListener('keypress', function(e) { if(e.key==='Enter') doLogin(); });

    const loginPasswordEl = document.getElementById('loginPassword');
    if (loginPasswordEl) loginPasswordEl.addEventListener('keypress', function(e) { if(e.key==='Enter') doLogin(); });

    const loginRoleEl = document.getElementById('loginRole');
    if (loginRoleEl) loginRoleEl.addEventListener('change', function() {
        // Reset password field when role changes
        const passEl = document.getElementById('loginPassword');
        if (passEl) passEl.value = '';
    });

    // Event listener untuk logout
    const btnLogoutEl = document.getElementById('btnLogout');
    if (btnLogoutEl) btnLogoutEl.addEventListener('click', doLogout);

    // Event listener untuk btnKirim
    const btnKirimEl = document.getElementById('btnKirim');
    if (btnKirimEl) btnKirimEl.addEventListener('click', submitAttendance);

    // Event listeners untuk confirm/success modal
    const btnConfirmCancelEl = document.getElementById('btnConfirmCancel');
    if (btnConfirmCancelEl) btnConfirmCancelEl.addEventListener('click', cancelSubmit);
    const btnConfirmSubmitEl = document.getElementById('btnConfirmSubmit');
    if (btnConfirmSubmitEl) btnConfirmSubmitEl.addEventListener('click', confirmSubmit);
    const btnSuccessDoneEl = document.getElementById('btnSuccessDone');
    if (btnSuccessDoneEl) btnSuccessDoneEl.addEventListener('click', closeSuccessModal);
    const confirmModalOverlayEl = document.getElementById('confirmModalOverlay');
    if (confirmModalOverlayEl) confirmModalOverlayEl.addEventListener('click', cancelSubmit);
    const successModalOverlayEl = document.getElementById('successModalOverlay');
    if (successModalOverlayEl) successModalOverlayEl.addEventListener('click', closeSuccessModal);

    // Event listeners untuk selectKelas dan selectTanggal
    const selectKelasEl = document.getElementById('selectKelas');
    if (selectKelasEl) selectKelasEl.addEventListener('change', function() {
        if (this.value) loadStudents(this.value);
        else clearStudentList();
    });

    const selectTanggalEl = document.getElementById('selectTanggal');
    if (selectTanggalEl) selectTanggalEl.addEventListener('change', function() {
        if (selectedKelasId) loadStudents(selectedKelasId);
    });

    // Cek apakah pengguna sudah login
    const savedUser = getData('currentUser', null);
    if (savedUser && savedUser.id) {
        // Validasi role yang diizinkan
        const allowedRoles = ['guru', 'wali', 'piket'];
        if (allowedRoles.includes(savedUser.role)) {
            currentUser = savedUser;
            showAttendancePage();
            return;
        }
        // Role tidak diizinkan, hapus session
        setData('currentUser', null);
    }

    // Tampilkan halaman login
    showLoginPage();
});

// ===== 3. HALAMAN LOGIN =====

/**
 * Menampilkan halaman login dan sembunyikan halaman absensi
 */
function showLoginPage() {
    const loginPage = document.getElementById('loginPage');
    const attendancePage = document.getElementById('attendancePage');
    if (loginPage) loginPage.classList.remove('hidden');
    if (attendancePage) attendancePage.classList.add('hidden');
}

/**
 * Menampilkan halaman absensi dan sembunyikan halaman login
 */
function showAttendancePage() {
    const loginPage = document.getElementById('loginPage');
    const attendancePage = document.getElementById('attendancePage');
    if (loginPage) loginPage.classList.add('hidden');
    if (attendancePage) attendancePage.classList.remove('hidden');

    // Set informasi guru di header
    const guruNameEl = document.getElementById('guruName');
    const guruRoleEl = document.getElementById('guruRole');
    if (guruNameEl) guruNameEl.textContent = currentUser.nama;
    if (guruRoleEl) guruRoleEl.textContent = roleLabels[currentUser.role] || currentUser.role;

    // Set tanggal hari ini
    const currentDateEl = document.getElementById('currentDate');
    if (currentDateEl) currentDateEl.textContent = formatTanggal(todayStr());

    // Set tanggal di input tanggal
    const selectTanggalEl = document.getElementById('selectTanggal');
    if (selectTanggalEl) selectTanggalEl.value = todayStr();

    // Inisialisasi
    updateOnlineStatus();
    loadTeacherClasses();
    updateClock();
    setInterval(updateClock, 1000);
    checkOfflineQueue();
    loadGasUrl();
}

/**
 * Proses login guru/wali/piket
 * Membaca NIP, password, dan role dari form.
 * Memvalidasi terhadap dataPengguna di localStorage.
 */
function doLogin() {
    const nip = document.getElementById('loginNip').value.trim();
    const password = document.getElementById('loginPassword').value;
    const role = document.getElementById('loginRole').value;

    // Validasi input
    if (!nip) {
        showToast('NIP harus diisi!', 'error');
        return;
    }
    if (!role) {
        showToast('Pilih jabatan terlebih dahulu!', 'error');
        return;
    }

    // Hanya izinkan role guru, wali, piket
    const allowedRoles = ['guru', 'wali', 'piket'];
    if (!allowedRoles.includes(role)) {
        showToast('Jabatan tidak diizinkan di halaman ini!', 'error');
        return;
    }

    // Cek data pengguna di localStorage
    const penggunaList = getData('dataPengguna', []);
    let user = penggunaList.find(u => u.nip === nip && u.role === role);

    if (user) {
        // Pengguna ditemukan di dataPengguna
        if (user.password && user.password !== password) {
            showToast('Kata sandi salah!', 'error');
            return;
        }
        if (!user.aktif) {
            showToast('Akun Anda tidak aktif. Hubungi administrator.', 'error');
            return;
        }
        currentUser = { ...user };
    } else {
        // Tidak ditemukan, izinkan login dengan password default 123456
        if (password !== '123456') {
            showToast('Kata sandi salah! Default: 123456', 'error');
            return;
        }
        // Buat user sementara
        currentUser = {
            id: genId(),
            nama: nip,
            nip: nip,
            role: role,
            telepon: '',
            email: '',
            password: password,
            aktif: true,
            kelasIds: []
        };
        showToast('Login berhasil (akun belum terdaftar)', 'info');
    }

    // Simpan ke localStorage
    setData('currentUser', currentUser);

    // Pindah ke halaman absensi
    showAttendancePage();
    showToast(`Selamat datang, ${currentUser.nama}!`);
}

/**
 * Proses logout
 */
function doLogout() {
    if (!confirm('Yakin ingin keluar?')) return;
    setData('currentUser', null);
    currentUser = null;
    attendanceData = {};
    selectedKelasId = null;
    isEditMode = false;
    location.reload();
}

/**
 * Update tampilan jam digital
 */
function updateClock() {
    const now = new Date();
    const clockEl = document.getElementById('currentDate');
    // Jangan overwrite jika sudah ada tanggal info
    // Clock display bisa ditambahkan di elemen terpisah jika diperlukan
}

// ===== 4. LOAD KELAS GURU =====

/**
 * Memuat semua kelas yang ditugaskan kepada guru yang login.
 * Guru ditugaskan ke kelas melalui:
 * 1. kelas.waliKelasId === currentUser.id (wali kelas)
 * 2. currentUser.kelasIds berisi kelas.id (admin assign)
 * Guru piket dapat melihat SEMUA kelas.
 */
function loadTeacherClasses() {
    const selectKelas = document.getElementById('selectKelas');
    if (!selectKelas) return;

    const kelasList = getData('dataKelas', []);
    let assignedClasses = [];

    if (currentUser.role === 'piket') {
        // Guru piket bisa melihat semua kelas
        assignedClasses = kelasList;
    } else {
        // Guru / Wali: cari kelas yang ditugaskan
        assignedClasses = kelasList.filter(k => {
            // Cek apakah guru adalah wali kelas
            if (k.waliKelasId && k.waliKelasId === currentUser.id) return true;
            // Cek apakah kelas.id ada di kelasIds guru
            const userKelasIds = currentUser.kelasIds || [];
            if (userKelasIds.includes(k.id)) return true;
            // Cek juga di dataGuru jika currentUser tidak punya kelasIds
            if (!currentUser.kelasIds) {
                const guruList = getData('dataGuru', []);
                const guruData = guruList.find(g => g.id === currentUser.id);
                if (guruData && guruData.kelasIds && guruData.kelasIds.includes(k.id)) return true;
            }
            return false;
        });
    }

    // Sort kelas berdasarkan nama
    assignedClasses.sort((a, b) => a.nama.localeCompare(b.nama));

    // Populate dropdown
    if (assignedClasses.length === 0) {
        selectKelas.innerHTML = '<option value="">-- Tidak ada kelas --</option>';
        showToast('Anda belum ditugaskan mengelola kelas. Hubungi administrator.', 'warning');
    } else {
        selectKelas.innerHTML = '<option value="">-- Pilih Kelas --</option>' +
            assignedClasses.map(k => `<option value="${k.id}">${k.nama}${k.tingkat ? ' - ' + k.tingkat : ''}${k.jurusan ? ' ' + k.jurusan : ''}</option>`).join('');
    }

    // Jika hanya ada 1 kelas, auto-select
    if (assignedClasses.length === 1) {
        selectKelas.value = assignedClasses[0].id;
        loadStudents(assignedClasses[0].id);
    }
}

// ===== 5. LOAD SISWA =====

/**
 * Memuat daftar siswa untuk kelas yang dipilih
 * @param {string} kelasId - ID kelas yang dipilih
 */
function loadStudents(kelasId) {
    if (!kelasId) {
        clearStudentList();
        return;
    }

    selectedKelasId = kelasId;
    isEditMode = false;
    attendanceData = {};

    // Ambil tanggal yang dipilih
    const selectTanggal = document.getElementById('selectTanggal');
    selectedTanggal = selectTanggal ? selectTanggal.value : todayStr();

    // Filter siswa aktif di kelas ini
    const siswaList = getData('dataSiswa', []);
    const students = siswaList
        .filter(s => s.kelasId === kelasId && s.aktif === true)
        .sort((a, b) => a.nama.localeCompare(b.nama));

    if (students.length === 0) {
        clearStudentList();
        return;
    }

    // Set total siswa
    const totalEl = document.getElementById('totalSiswaCount');
    if (totalEl) totalEl.textContent = students.length + ' siswa';

    // Cek apakah absensi sudah pernah diinput (mode edit)
    checkAlreadySubmitted(kelasId, selectedTanggal, students);

    // Render daftar siswa
    renderStudentList(students);

    // Update ringkasan
    updateSummary();
}

/**
 * Mengosongkan daftar siswa
 */
function clearStudentList() {
    const studentListEl = document.getElementById('studentList');
    const emptyEl = document.getElementById('emptyStudentList');
    const totalEl = document.getElementById('totalSiswaCount');

    if (studentListEl) studentListEl.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (totalEl) totalEl.textContent = '0 siswa';

    attendanceData = {};
    updateSummary();
}

// ===== 6. RENDER DAFTAR SISWA =====

/**
 * Merender daftar siswa dengan tombol status absensi
 * @param {Array} students - Array siswa yang akan ditampilkan
 */
function renderStudentList(students) {
    const studentListEl = document.getElementById('studentList');
    const emptyEl = document.getElementById('emptyStudentList');

    if (!studentListEl) return;

    if (students.length === 0) {
        studentListEl.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');

    let html = '';

    students.forEach((siswa, index) => {
        const currentStatus = attendanceData[siswa.id]
            ? attendanceData[siswa.id].status
            : 'HADIR';
        const keterangan = attendanceData[siswa.id]
            ? (attendanceData[siswa.id].keterangan || '')
            : '';

        // Ikon gender
        const genderIcon = siswa.jenisKelamin === 'L'
            ? '<i class="fa-solid fa-mars text-blue-500"></i>'
            : '<i class="fa-solid fa-venus text-pink-500"></i>';

        // Tombol-tombol status
        const statusButtons = Object.entries(statusConfig).map(([key, cfg]) => {
            const isActive = currentStatus === key;
            const activeClass = isActive
                ? `${cfg.warna} ${cfg.teks} ${cfg.ring} transform scale-110 font-bold shadow-lg`
                : `bg-slate-100 text-slate-500 hover:bg-slate-200`;
            return `<button type="button"
                onclick="markStatus('${siswa.id}', '${key}')"
                class="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-200 ${activeClass}"
                title="${key === 'HADIR' ? 'Hadir' : key === 'SAKIT' ? 'Sakit' : key === 'IZIN' ? 'Izin' : key === 'ALFA' ? 'Alfa' : 'Terlambat'}">${cfg.label}</button>`;
        }).join('');

        html += `
        <div class="student-row bg-white rounded-xl p-4 mb-3 shadow-sm border border-slate-100 hover:shadow-md transition-shadow" data-siswa-id="${siswa.id}">
            <div class="flex items-center gap-3">
                <!-- Nomor urut -->
                <span class="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-xs font-bold text-slate-500 flex-shrink-0">${index + 1}</span>

                <!-- Info siswa -->
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                        <span class="font-semibold text-slate-800 text-sm truncate">${siswa.nama}</span>
                        <span class="text-xs">${genderIcon}</span>
                    </div>
                    <span class="text-xs text-slate-400 font-mono">NIS: ${siswa.nis}</span>
                </div>

                <!-- Tombol status -->
                <div class="flex items-center gap-2 flex-shrink-0">
                    ${statusButtons}
                </div>
            </div>

            <!-- Keterangan -->
            <div class="mt-2 ml-11">
                <input type="text"
                    placeholder="Tambah keterangan (opsional)..."
                    value="${escapeHtml(keterangan)}"
                    onchange="updateKeterangan('${siswa.id}', this.value)"
                    class="w-full text-xs p-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-300 focus:border-teal-400 transition text-slate-600 placeholder-slate-300"
                />
            </div>
        </div>`;
    });

    studentListEl.innerHTML = html;
}

/**
 * Meng-escape HTML untuk mencegah XSS
 * @param {string} str - String yang akan di-escape
 * @returns {string} String yang sudah di-escape
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ===== 7. TANDAI STATUS ABSENSI =====

/**
 * Menandai status absensi seorang siswa
 * @param {string} siswaId - ID siswa
 * @param {string} status - Status baru: HADIR, SAKIT, IZIN, ALFA, TERLAMBAT
 */
function markStatus(siswaId, status) {
    if (!attendanceData[siswaId]) {
        attendanceData[siswaId] = { status: 'HADIR', keterangan: '' };
    }

    attendanceData[siswaId].status = status;

    // Update tampilan tombol tanpa re-render seluruh list (performa)
    const row = document.querySelector(`[data-siswa-id="${siswaId}"]`);
    if (row) {
        const buttons = row.querySelectorAll('button');
        buttons.forEach(btn => {
            // Cari status dari onclick attribute
            const onclickAttr = btn.getAttribute('onclick') || '';
            const match = onclickAttr.match(/markStatus\('[^']+',\s*'([^']+)'\)/);
            if (match) {
                const btnStatus = match[1];
                const cfg = statusConfig[btnStatus];
                if (!cfg) return;

                if (btnStatus === status) {
                    // Tombol aktif
                    btn.className = `w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-200 ${cfg.warna} ${cfg.teks} ${cfg.ring} transform scale-110 font-bold shadow-lg`;
                } else {
                    // Tombol tidak aktif
                    btn.className = `w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-200 bg-slate-100 text-slate-500 hover:bg-slate-200`;
                }
            }
        });
    }

    // Update ringkasan
    updateSummary();
}

/**
 * Update keterangan untuk seorang siswa
 * @param {string} siswaId - ID siswa
 * @param {string} keterangan - Keterangan yang diisi
 */
function updateKeterangan(siswaId, keterangan) {
    if (!attendanceData[siswaId]) {
        attendanceData[siswaId] = { status: 'HADIR', keterangan: '' };
    }
    attendanceData[siswaId].keterangan = keterangan.trim();
}

// ===== 8. UPDATE RINGKASAN =====

/**
 * Menghitung dan memperbarui tampilan ringkasan absensi
 */
function updateSummary() {
    let hadir = 0, sakit = 0, izin = 0, alfa = 0, terlambat = 0;

    Object.values(attendanceData).forEach(item => {
        switch (item.status) {
            case 'HADIR': hadir++; break;
            case 'SAKIT': sakit++; break;
            case 'IZIN': izin++; break;
            case 'ALFA': alfa++; break;
            case 'TERLAMBAT': terlambat++; break;
        }
    });

    const setEl = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    setEl('summaryHadir', hadir);
    setEl('summarySakit', sakit);
    setEl('summaryIzin', izin);
    setEl('summaryAlfa', alfa);
    setEl('summaryTerlambat', terlambat);

    // Update warna ringkasan jika ada
    updateSummaryColors(hadir, sakit, izin, alfa, terlambat);
}

/**
 * Update warna elemen ringkasan
 */
function updateSummaryColors(hadir, sakit, izin, alfa, terlambat) {
    // Tambahkan efek visual pada angka ringkasan
    const setPulse = (id, count) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (count > 0) {
            el.classList.add('font-bold');
        } else {
            el.classList.remove('font-bold');
        }
    };
    setPulse('summaryHadir', hadir);
    setPulse('summarySakit', sakit);
    setPulse('summaryIzin', izin);
    setPulse('summaryAlfa', alfa);
    setPulse('summaryTerlambat', terlambat);
}

// ===== 9. AKSI CEPAT =====

/**
 * Menandai semua siswa dengan status tertentu
 * @param {string} status - Status yang akan diterapkan ke semua siswa
 */
function markAll(status) {
    if (!status || Object.keys(attendanceData).length === 0) {
        showToast('Tidak ada siswa yang ditampilkan', 'warning');
        return;
    }

    if (status === 'HADIR') {
        // Reset semua ke hadir
        Object.keys(attendanceData).forEach(siswaId => {
            attendanceData[siswaId].status = 'HADIR';
        });
        showToast('Semua siswa ditandai HADIR', 'info');
    } else {
        // Konfirmasi untuk status non-HADIR
        const statusLabel = { SAKIT: 'Sakit', IZIN: 'Izin', ALFA: 'Alfa', TERLAMBAT: 'Terlambat' };
        if (!confirm(`Tandai semua siswa sebagai ${statusLabel[status] || status}?`)) return;

        Object.keys(attendanceData).forEach(siswaId => {
            attendanceData[siswaId].status = status;
        });
        showToast(`Semua siswa ditandai ${statusLabel[status] || status}`, 'info');
    }

    // Re-render untuk update UI
    refreshCurrentStudentList();
    updateSummary();
}

/**
 * Reset semua status absensi ke HADIR
 */
function resetAttendance() {
    if (Object.keys(attendanceData).length === 0) return;
    if (!confirm('Reset semua status absensi ke Hadir?')) return;

    Object.keys(attendanceData).forEach(siswaId => {
        attendanceData[siswaId].status = 'HADIR';
        attendanceData[siswaId].keterangan = '';
    });

    refreshCurrentStudentList();
    updateSummary();
    showToast('Status absensi direset ke Hadir', 'info');
}

/**
 * Refresh tampilan list siswa tanpa mengubah data
 */
function refreshCurrentStudentList() {
    if (!selectedKelasId) return;
    const siswaList = getData('dataSiswa', []);
    const students = siswaList
        .filter(s => s.kelasId === selectedKelasId && s.aktif === true)
        .sort((a, b) => a.nama.localeCompare(b.nama));
    renderStudentList(students);
}

// ===== 10. CEK ABSENSI SUDAH PERNAH DIINPUT =====

/**
 * Cek apakah absensi untuk kelas dan tanggal tertentu sudah pernah diinput.
 * Jika ya, masuk mode edit dan muat data yang sudah ada.
 * @param {string} kelasId - ID kelas
 * @param {string} tanggal - Tanggal (YYYY-MM-DD)
 * @param {Array} students - Daftar siswa saat ini
 */
function checkAlreadySubmitted(kelasId, tanggal, students) {
    const absensiList = getData('dataAbsensi', []);
    const existingRecords = absensiList.filter(
        a => a.kelasId === kelasId && a.tanggal === tanggal
    );

    if (existingRecords.length > 0) {
        isEditMode = true;

        // Muat status yang sudah ada ke attendanceData
        students.forEach(siswa => {
            const existing = existingRecords.find(r => r.siswaId === siswa.id);
            if (existing) {
                attendanceData[siswa.id] = {
                    status: existing.status || 'HADIR',
                    keterangan: existing.keterangan || ''
                };
            } else {
                // Siswa baru yang belum ada di data absensi sebelumnya
                attendanceData[siswa.id] = { status: 'HADIR', keterangan: '' };
            }
        });

        showToast('Absensi sudah pernah diinput, mode edit aktif', 'info');
    } else {
        isEditMode = false;

        // Set default semua ke HADIR
        students.forEach(siswa => {
            attendanceData[siswa.id] = { status: 'HADIR', keterangan: '' };
        });
    }
}

// ===== 11. SUBMIT ABSENSI =====

/**
 * Kirim absensi. Menampilkan modal konfirmasi terlebih dahulu.
 */
async function submitAttendance() {
    if (isSubmitting) {
        showToast('Permintaan sedang diproses...', 'warning');
        return;
    }

    // Validasi
    if (!selectedKelasId) {
        showToast('Pilih kelas terlebih dahulu!', 'error');
        return;
    }

    if (Object.keys(attendanceData).length === 0) {
        showToast('Tidak ada data absensi untuk dikirim!', 'error');
        return;
    }

    const tanggal = selectedTanggal || todayStr();
    const kelasList = getData('dataKelas', []);
    const kelas = kelasList.find(k => k.id === selectedKelasId);
    const kelasNama = kelas ? kelas.nama : '-';

    // Hitung ringkasan
    const summary = buildSummaryText(kelasNama, tanggal);

    // Tampilkan modal konfirmasi
    const confirmKelas = document.getElementById('confirmKelas');
    const confirmSummary = document.getElementById('confirmSummary');
    if (confirmKelas) confirmKelas.textContent = kelasNama;
    if (confirmSummary) confirmSummary.innerHTML = summary;

    const confirmModal = document.getElementById('confirmModal');
    if (confirmModal) confirmModal.classList.remove('hidden');
}

/**
 * Proses pengiriman absensi setelah konfirmasi
 */
async function confirmSubmit() {
    // Sembunyikan modal konfirmasi
    const confirmModal = document.getElementById('confirmModal');
    if (confirmModal) confirmModal.classList.add('hidden');

    isSubmitting = true;

    // Disable tombol kirim
    const btnKirim = document.getElementById('btnKirim');
    if (btnKirim) {
        btnKirim.disabled = true;
        btnKirim.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Mengirim...';
    }

    try {
        const tanggal = selectedTanggal || todayStr();
        const waktu = timeStr();
        const kelasList = getData('dataKelas', []);
        const kelas = kelasList.find(k => k.id === selectedKelasId);
        const kelasNama = kelas ? kelas.nama : '-';
        const schoolName = getSchoolName();

        // Ambil data siswa lengkap
        const siswaList = getData('dataSiswa', []);

        // Bangun payload
        const payload = [];
        const absensiList = getData('dataAbsensi', []);

        Object.entries(attendanceData).forEach(([siswaId, data]) => {
            const siswa = siswaList.find(s => s.id === siswaId);
            if (!siswa) return;

            const record = {
                id: genId(),
                siswaId: siswaId,
                nis: siswa.nis,
                nama: siswa.nama,
                kelas: kelasNama,
                kelasId: selectedKelasId,
                tanggal: tanggal,
                waktuMasuk: waktu,
                status: data.status,
                keterangan: data.keterangan || '',
                dibuatOleh: currentUser ? currentUser.nama : 'Guru',
                dibuatOlehId: currentUser ? currentUser.id : '',
                sekolah: schoolName,
                waNomor: siswa.teleponOrtu || ''
            };

            payload.push(record);

            // Update atau tambah ke dataAbsensi di localStorage
            if (isEditMode) {
                const existIdx = absensiList.findIndex(
                    a => a.siswaId === siswaId && a.kelasId === selectedKelasId && a.tanggal === tanggal
                );
                if (existIdx >= 0) {
                    // Update record yang sudah ada
                    absensiList[existIdx] = {
                        ...absensiList[existIdx],
                        status: data.status,
                        keterangan: data.keterangan || '',
                        waktuMasuk: waktu,
                        dibuatOleh: currentUser ? currentUser.nama : 'Guru'
                    };
                } else {
                    // Record baru untuk siswa baru
                    absensiList.unshift(record);
                }
            } else {
                absensiList.unshift(record);
            }
        });

        // Simpan ke localStorage
        setData('dataAbsensi', absensiList);

        // Kirim ke GAS jika online dan URL sudah dikonfigurasi
        if (navigator.onLine && GAS_URL !== 'URL_APPS_SCRIPT_ANDA_DISINI') {
            try {
                await sendToGAS(payload);
                showSuccessModal(tanggal, kelasNama, false);
            } catch (error) {
                console.error('Gagal kirim ke GAS:', error);
                // Tambah ke antrian offline sebagai fallback
                addToOfflineQueue(payload);
                showSuccessModal(tanggal, kelasNama, true);
            }
        } else {
            // Mode offline
            addToOfflineQueue(payload);
            showSuccessModal(tanggal, kelasNama, true);
        }

    } catch (error) {
        console.error('Error submitAttendance:', error);
        showToast('Terjadi kesalahan saat menyimpan absensi!', 'error');
    } finally {
        isSubmitting = false;
        if (btnKirim) {
            btnKirim.disabled = false;
            btnKirim.innerHTML = '<i class="fa-solid fa-paper-plane mr-2"></i>Kirim Absensi';
        }
    }
}

/**
 * Batalkan pengiriman absensi
 */
function cancelSubmit() {
    const confirmModal = document.getElementById('confirmModal');
    if (confirmModal) confirmModal.classList.add('hidden');
}

/**
 * Kirim data absensi ke Google Apps Script
 * @param {Array} data - Array data absensi
 * @returns {Promise<Object>} Response dari GAS
 */
async function sendToGAS(data) {
    const response = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
            action: 'batch_absen_guru',
            data: data
        })
    });

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (result.status === 'error') {
        throw new Error(result.message || 'Error dari server');
    }

    // GAS akan otomatis mengirim notifikasi WA jika waEnable = true
    return result;
}

/**
 * Tampilkan modal sukses setelah absensi terkirim
 * @param {string} tanggal - Tanggal absensi
 * @param {string} kelasNama - Nama kelas
 * @param {boolean} isOffline - Apakah disimpan offline
 */
function showSuccessModal(tanggal, kelasNama, isOffline) {
    const successSummary = document.getElementById('successSummary');
    const successModal = document.getElementById('successModal');

    if (successSummary) {
        const summary = buildSummaryText(kelasNama, tanggal);
        successSummary.innerHTML = `
            <div class="text-center">
                <div class="w-16 h-16 bg-green-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                    <i class="fa-solid fa-check text-green-600 text-3xl"></i>
                </div>
                <h3 class="text-lg font-bold text-slate-800 mb-2">Absensi Berhasil Disimpan!</h3>
                ${isOffline ? '<p class="text-amber-600 text-sm mb-3"><i class="fa-solid fa-wifi-slash mr-1"></i>Tersimpan offline, akan dikirim saat online</p>' : ''}
                <div class="text-left bg-slate-50 rounded-lg p-3 text-sm">
                    <p class="font-semibold text-slate-700 mb-2">${kelasNama} - ${formatTanggal(tanggal)}</p>
                    ${summary}
                </div>
            </div>
        `;
    }

    if (successModal) {
        successModal.classList.remove('hidden');
    }

    if (isOffline) {
        showToast('Tersimpan offline, akan dikirim saat online', 'warning');
    } else {
        showToast('Absensi berhasil dikirim!', 'success');
    }
}

/**
 * Tutup modal sukses
 */
function closeSuccessModal() {
    const successModal = document.getElementById('successModal');
    if (successModal) successModal.classList.add('hidden');
}

/**
 * Bangun teks ringkasan absensi untuk modal
 * @param {string} kelasNama - Nama kelas
 * @param {string} tanggal - Tanggal
 * @returns {string} HTML ringkasan
 */
function buildSummaryText(kelasNama, tanggal) {
    let hadir = 0, sakit = 0, izin = 0, alfa = 0, terlambat = 0;

    Object.values(attendanceData).forEach(item => {
        switch (item.status) {
            case 'HADIR': hadir++; break;
            case 'SAKIT': sakit++; break;
            case 'IZIN': izin++; break;
            case 'ALFA': alfa++; break;
            case 'TERLAMBAT': terlambat++; break;
        }
    });

    const total = hadir + sakit + izin + alfa + terlambat;

    return `
        <div class="grid grid-cols-5 gap-2 text-center">
            <div class="bg-green-50 rounded-lg p-2">
                <div class="text-lg font-bold text-green-700">${hadir}</div>
                <div class="text-xs text-green-600">Hadir</div>
            </div>
            <div class="bg-yellow-50 rounded-lg p-2">
                <div class="text-lg font-bold text-yellow-700">${sakit}</div>
                <div class="text-xs text-yellow-600">Sakit</div>
            </div>
            <div class="bg-blue-50 rounded-lg p-2">
                <div class="text-lg font-bold text-blue-700">${izin}</div>
                <div class="text-xs text-blue-600">Izin</div>
            </div>
            <div class="bg-red-50 rounded-lg p-2">
                <div class="text-lg font-bold text-red-700">${alfa}</div>
                <div class="text-xs text-red-600">Alfa</div>
            </div>
            <div class="bg-orange-50 rounded-lg p-2">
                <div class="text-lg font-bold text-orange-700">${terlambat}</div>
                <div class="text-xs text-orange-600">Terlambat</div>
            </div>
        </div>
        <div class="mt-3 pt-3 border-t border-slate-200 text-center">
            <span class="text-slate-500 text-xs">Total: <strong>${total}</strong> siswa</span>
        </div>
    `;
}

// ===== 12. DUKUNGAN OFFLINE =====

/**
 * Tambah data ke antrian offline
 * @param {Array|Object} data - Data absensi yang akan ditambahkan ke antrian
 */
function addToOfflineQueue(data) {
    const queue = getData('offlineAbsenQueue', []);
    const items = Array.isArray(data) ? data : [data];

    items.forEach(item => {
        queue.push({
            ...item,
            queuedAt: new Date().toISOString(),
            retries: 0
        });
    });

    setData('offlineAbsenQueue', queue);
    checkOfflineQueue();
}

/**
 * Cek antrian offline dan update tampilan
 */
function checkOfflineQueue() {
    const queue = getData('offlineAbsenQueue', []);
    const btnSync = document.getElementById('btnSyncQueue');
    const queueCount = queue.length;

    if (btnSync) {
        if (queueCount > 0) {
            btnSync.classList.remove('hidden');
            btnSync.innerHTML = `<i class="fa-solid fa-cloud-arrow-up mr-2"></i>${queueCount} data menunggu sinkronisasi`;
        } else {
            btnSync.classList.add('hidden');
        }
    }
}

/**
 * Update status online/offline
 */
function updateOnlineStatus() {
    const offlineBanner = document.getElementById('offlineBanner');
    const onlineIndicator = document.getElementById('onlineIndicator');

    if (navigator.onLine) {
        if (offlineBanner) offlineBanner.classList.add('hidden');
        if (onlineIndicator) {
            onlineIndicator.classList.remove('bg-red-500');
            onlineIndicator.classList.add('bg-green-500');
            onlineIndicator.title = 'Online';
        }
        // Auto-sync saat kembali online
        syncOfflineQueue();
    } else {
        if (offlineBanner) offlineBanner.classList.remove('hidden');
        if (onlineIndicator) {
            onlineIndicator.classList.remove('bg-green-500');
            onlineIndicator.classList.add('bg-red-500');
            onlineIndicator.title = 'Offline';
        }
    }
}

/**
 * Event handler saat perangkat kembali online
 */
function handleOnline() {
    if (document.getElementById('offlineBanner')) {
        document.getElementById('offlineBanner').classList.add('hidden');
    }
    showToast('Koneksi internet kembali tersedia', 'success');
    syncOfflineQueue();
}

/**
 * Event handler saat perangkat offline
 */
function handleOffline() {
    if (document.getElementById('offlineBanner')) {
        document.getElementById('offlineBanner').classList.remove('hidden');
    }
    showToast('Anda sedang offline. Data akan tersimpan lokal.', 'warning');
}

// Listener untuk event online/offline
window.addEventListener('online', handleOnline);
window.addEventListener('offline', handleOffline);

/**
 * Sinkronisasi antrian offline ke GAS
 */
async function syncOfflineQueue() {
    const queue = getData('offlineAbsenQueue', []);
    if (queue.length === 0) return;

    // Cek apakah GAS_URL sudah dikonfigurasi
    if (GAS_URL === 'URL_APPS_SCRIPT_ANDA_DISINI') {
        console.log('GAS_URL belum dikonfigurasi, tidak dapat sinkronisasi');
        return;
    }

    if (!navigator.onLine) {
        console.log('Perangkat offline, tidak dapat sinkronisasi');
        return;
    }

    const btnSync = document.getElementById('btnSyncQueue');
    const offlineBanner = document.getElementById('offlineBanner');

    // Tampilkan status sinkronisasi
    if (offlineBanner) {
        offlineBanner.classList.remove('hidden');
        offlineBanner.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Menyinkronkan ' + queue.length + ' data...';
    }

    let successCount = 0;
    let failCount = 0;
    const remainingQueue = [];

    // Kirim satu per satu
    for (const item of queue) {
        try {
            const response = await fetch(GAS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'batch_absen_guru',
                    data: [item]
                })
            });

            if (response.ok) {
                const result = await response.json();
                if (result.status === 'success') {
                    successCount++;
                    continue; // Berhasil, tidak masuk remainingQueue
                }
            }
        } catch (error) {
            console.error('Gagal sync item:', error);
        }

        // Gagal, tambah retry counter
        item.retries = (item.retries || 0) + 1;

        // Batasi maksimal 5x retry
        if (item.retries < 5) {
            remainingQueue.push(item);
        } else {
            failCount++;
            console.warn('Item melebihi batas retry, dihapus dari antrian:', item);
        }
    }

    // Update antrian
    setData('offlineAbsenQueue', remainingQueue);

    // Update tampilan
    checkOfflineQueue();

    if (offlineBanner) {
        if (successCount > 0 && remainingQueue.length === 0) {
            offlineBanner.innerHTML = '<i class="fa-solid fa-check mr-2"></i>Semua data berhasil disinkronisasi!';
            setTimeout(() => offlineBanner.classList.add('hidden'), 3000);
        } else if (successCount > 0) {
            offlineBanner.innerHTML = `<i class="fa-solid fa-check mr-2"></i>${successCount} data berhasil. ${remainingQueue.length} masih menunggu.`;
            setTimeout(() => offlineBanner.classList.add('hidden'), 5000);
        } else {
            offlineBanner.innerHTML = '<i class="fa-solid fa-triangle-exclamation mr-2"></i>Gagal menyinkronkan data. Akan dicoba lagi nanti.';
            setTimeout(() => {
                if (navigator.onLine) offlineBanner.classList.add('hidden');
            }, 5000);
        }
    }

    if (successCount > 0) {
        showToast(`${successCount} data berhasil disinkronisasi!`, 'success');
    }
    if (failCount > 0) {
        showToast(`${failCount} data gagal dan dihapus dari antrian`, 'error');
    }
}

/**
 * Tombol manual untuk sync antrian offline
 */
function manualSync() {
    showToast('Memulai sinkronisasi...', 'info');
    syncOfflineQueue();
}

// ===== 13. PEMBARUAN TANGGAL =====

/**
 * Handler ketika tanggal dipilih ulang
 * Memuat ulang data absensi berdasarkan tanggal baru
 */
function onTanggalChange() {
    const selectTanggal = document.getElementById('selectTanggal');
    if (!selectTanggal) return;

    selectedTanggal = selectTanggal.value;
    if (selectedKelasId && selectedTanggal) {
        loadStudents(selectedKelasId);
    }
}

/**
 * Handler ketika kelas dipilih ulang
 * Memuat ulang daftar siswa
 */
function onKelasChange() {
    const selectKelas = document.getElementById('selectKelas');
    if (!selectKelas) return;

    const kelasId = selectKelas.value;
    if (kelasId) {
        loadStudents(kelasId);
    } else {
        clearStudentList();
    }
}

// ===== 14. PENCARIAN SISWA =====

/**
 * Filter daftar siswa berdasarkan pencarian nama/NIS
 */
function filterStudents() {
    if (!selectedKelasId) return;

    const searchInput = document.getElementById('searchStudent');
    const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';

    const siswaList = getData('dataSiswa', []);
    let students = siswaList
        .filter(s => s.kelasId === selectedKelasId && s.aktif === true)
        .sort((a, b) => a.nama.localeCompare(b.nama));

    if (keyword) {
        students = students.filter(s =>
            s.nama.toLowerCase().includes(keyword) ||
            s.nis.toLowerCase().includes(keyword)
        );
    }

    if (students.length === 0) {
        clearStudentList();
        const emptyEl = document.getElementById('emptyStudentList');
        if (emptyEl) emptyEl.innerHTML = `
            <div class="text-center py-8">
                <i class="fa-solid fa-search text-4xl text-slate-300 mb-3"></i>
                <p class="text-slate-400 text-sm">Tidak ada siswa yang cocok</p>
            </div>
        `;
    } else {
        renderStudentList(students);
    }
}

// ===== 15. TEMPLATE WA =====

/**
 * Generate pesan WA berdasarkan template
 * @param {string} type - Tipe template: hadir, sakit, izin, alfa, terlambat
 * @param {Object} data - Data siswa { nama, kelas, tanggal, waktu, keterangan }
 * @returns {string} Pesan WA yang sudah diformat
 */
function generateWaMessage(type, data) {
    const template = waTemplates[type] || waTemplates.hadir;
    const schoolName = getSchoolName();

    return template
        .replace('{NAMA}', data.nama || '-')
        .replace('{KELAS}', data.kelas || '-')
        .replace('{TANGGAL}', data.tanggal ? formatTanggal(data.tanggal) : '-')
        .replace('{WAKTU}', data.waktu || timeStr())
        .replace('{KETERANGAN}', data.keterangan || '-')
        .replace('{SEKOLAH}', schoolName);
}

// ===== 16. EXPORT / CETAK =====

/**
 * Generate teks ringkasan absensi untuk dicetak/dibagikan
 * @returns {string} Teks ringkasan
 */
function generateTextSummary() {
    if (!selectedKelasId || Object.keys(attendanceData).length === 0) return '';

    const tanggal = selectedTanggal || todayStr();
    const kelasList = getData('dataKelas', []);
    const kelas = kelasList.find(k => k.id === selectedKelasId);
    const kelasNama = kelas ? kelas.nama : '-';
    const schoolName = getSchoolName();

    let hadir = 0, sakit = 0, izin = 0, alfa = 0, terlambat = 0;
    Object.values(attendanceData).forEach(item => {
        switch (item.status) {
            case 'HADIR': hadir++; break;
            case 'SAKIT': sakit++; break;
            case 'IZIN': izin++; break;
            case 'ALFA': alfa++; break;
            case 'TERLAMBAT': terlambat++; break;
        }
    });

    const total = hadir + sakit + izin + alfa + terlambat;

    let text = `=== ABSENSI ${schoolName} ===\n`;
    text += `Tanggal : ${formatTanggal(tanggal)}\n`;
    text += `Kelas   : ${kelasNama}\n`;
    text += `Guru    : ${currentUser ? currentUser.nama : '-'}\n`;
    text += `-----------------------------\n`;
    text += `HADIR     : ${hadir}\n`;
    text += `TERLAMBAT : ${terlambat}\n`;
    text += `SAKIT     : ${sakit}\n`;
    text += `IZIN      : ${izin}\n`;
    text += `ALFA      : ${alfa}\n`;
    text += `-----------------------------\n`;
    text += `TOTAL     : ${total}\n`;

    // Detail per siswa
    text += `\n--- DETAIL ---\n`;
    const siswaList = getData('dataSiswa', []);
    let no = 1;
    Object.entries(attendanceData).forEach(([siswaId, data]) => {
        const siswa = siswaList.find(s => s.id === siswaId);
        if (!siswa) return;
        const statusLabel = {
            'HADIR': 'H', 'SAKIT': 'S', 'IZIN': 'I', 'ALFA': 'A', 'TERLAMBAT': 'T'
        };
        text += `${no++}. ${siswa.nama} (${siswa.nis}) - ${statusLabel[data.status] || data.status}`;
        if (data.keterangan) text += ` [${data.keterangan}]`;
        text += '\n';
    });

    return text;
}

/**
 * Salin ringkasan absensi ke clipboard
 */
function copySummary() {
    const text = generateTextSummary();
    if (!text) {
        showToast('Tidak ada data absensi untuk disalin', 'warning');
        return;
    }

    navigator.clipboard.writeText(text).then(() => {
        showToast('Ringkasan absensi berhasil disalin!', 'success');
    }).catch(() => {
        // Fallback untuk browser yang tidak mendukung clipboard API
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('Ringkasan absensi berhasil disalin!', 'success');
    });
}

/**
 * Bagikan ringkasan absensi (Web Share API)
 */
async function shareSummary() {
    const text = generateTextSummary();
    if (!text) {
        showToast('Tidak ada data absensi untuk dibagikan', 'warning');
        return;
    }

    if (navigator.share) {
        try {
            await navigator.share({
                title: `Absensi ${selectedTanggal || todayStr()}`,
                text: text
            });
        } catch (err) {
            if (err.name !== 'AbortError') {
                showToast('Gagal membagikan', 'error');
            }
        }
    } else {
        // Fallback: copy ke clipboard
        copySummary();
    }
}

// ===== 17. EVENT LISTENERS (TAMBAHAN) =====
// Catatan: Event listener utama sudah dipasang di Section 2 (DOMContentLoaded pertama).
// Bagian ini hanya untuk event listener tambahan yang tidak duplikat.

/**
 * Pasang event listener tambahan saat DOM siap
 */
document.addEventListener('DOMContentLoaded', function () {
    // Tombol sync manual
    const btnSyncQueue = document.getElementById('btnSyncQueue');
    if (btnSyncQueue) {
        btnSyncQueue.addEventListener('click', manualSync);
    }

    // Pencarian siswa (dengan debounce)
    const searchInput = document.getElementById('searchStudent');
    if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener('input', function () {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(filterStudents, 300);
        });
    }
});
