/**
 * ============================================================
 *  SMART ABSEN ENTERPRISE v2.0 — MASTER ADMIN SERVICE
 * ============================================================
 *  Panel admin master untuk mengelola semua sekolah terdaftar.
 *  Login menggunakan Email + Password (Firebase Auth).
 *  Hanya email masterAdminEmail yang dapat mengakses panel ini.
 *  Data sekolah diambil dari koleksi `users` (role = 'admin').
 *  Konfigurasi WhatsApp disimpan di `system_config/whatsapp`.
 * ============================================================
 */

// ==========================================
// UTILITY FUNCTIONS (globals)
// ==========================================

/**
 * Format tanggal ke string lokal Indonesia
 */
function formatDate(date) {
  if (!date) return '-';
  try {
    var d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) {
    return '-';
  }
}

/**
 * Generate random ID
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

/**
 * Toast notification
 */
function showToast(message, type) {
  type = type || 'info';
  var existing = document.getElementById('toast-container');
  if (!existing) {
    existing = document.createElement('div');
    existing.id = 'toast-container';
    existing.style.cssText = 'position:fixed; top:20px; right:20px; z-index:100000; display:flex; flex-direction:column; gap:8px;';
    document.body.appendChild(existing);
  }

  var colors = {
    success: 'bg-emerald-600',
    error: 'bg-red-600',
    warning: 'bg-amber-500',
    info: 'bg-blue-600'
  };
  var icons = {
    success: 'fa-check-circle',
    error: 'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info: 'fa-info-circle'
  };

  var toast = document.createElement('div');
  toast.className = 'animate-slide-in';
  toast.style.cssText = 'padding:14px 20px; border-radius:12px; color:white; font-size:14px; font-weight:500; display:flex; align-items:center; gap:10px; box-shadow:0 8px 24px rgba(0,0,0,0.2); min-width:280px; max-width:420px;';
  toast.innerHTML = '<i class="fa-solid ' + (icons[type] || icons.info) + '"></i><span>' + message + '</span>';
  toast.classList.add(colors[type] || colors.info);

  existing.appendChild(toast);
  setTimeout(function() {
    toast.style.transition = 'opacity 0.3s, transform 0.3s';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100px)';
    setTimeout(function() { toast.remove(); }, 300);
  }, 3500);
}

/**
 * Show modal overlay
 */
function showModal(title, contentHtml) {
  var overlay = document.getElementById('masterModalOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'masterModalOverlay';
    overlay.style.cssText = 'position:fixed; inset:0; z-index:9000; background:rgba(15,23,42,0.6); backdrop-filter:blur(4px); display:flex; align-items:center; justify-content:center; padding:20px;';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = '<div style="background:white; border-radius:20px; box-shadow:0 25px 60px rgba(0,0,0,0.25); max-width:560px; width:100%; max-height:85vh; overflow-y:auto;">' +
    '<div style="padding:20px 24px; border-bottom:1px solid #f1f5f9; display:flex; align-items:center; justify-content:space-between;">' +
      '<h3 style="font-size:17px; font-weight:700; color:#1e293b;">' + title + '</h3>' +
      '<button onclick="closeMasterModal()" style="width:32px; height:32px; border-radius:8px; border:none; background:#f1f5f9; color:#64748b; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:14px;"><i class="fa-solid fa-xmark"></i></button>' +
    '</div>' +
    '<div style="padding:24px;">' + contentHtml + '</div>' +
  '</div>';
  overlay.style.display = 'flex';
  overlay.onclick = function(e) { if (e.target === overlay) closeMasterModal(); };
}

function closeMasterModal() {
  var overlay = document.getElementById('masterModalOverlay');
  if (overlay) overlay.style.display = 'none';
}

/**
 * Translate Firebase Auth error codes to Indonesian messages
 */
function getFirebaseErrorMessage(code, fallback) {
  switch (code) {
    case 'auth/user-not-found': return 'Email tidak terdaftar di sistem';
    case 'auth/wrong-password': return 'Password salah. Silakan coba lagi.';
    case 'auth/invalid-email': return 'Format email tidak valid';
    case 'auth/too-many-requests': return 'Terlalu banyak percobaan login. Coba lagi nanti.';
    case 'auth/invalid-credential': return 'Email atau password salah';
    case 'auth/network-request-failed': return 'Gagal terhubung ke server. Periksa koneksi internet.';
    case 'auth/weak-password': return 'Password terlalu lemah. Minimal 6 karakter.';
    case 'auth/email-already-in-use': return 'Email sudah terdaftar';
    default: return 'Gagal masuk: ' + (fallback || code);
  }
}

// ==========================================
// FIREBASE INITIALIZER
// ==========================================

/**
 * Initialize Firebase app from config.js
 */
function initFirebase() {
  if (firebase.apps.length === 0) {
    firebase.initializeApp(SMART_ABSEN_CONFIG.firebase);
  }
}

// ==========================================
// MASTER ADMIN SERVICE
// ==========================================

class MasterAdminService {
  constructor() {
    this.db = null;
    this.currentUser = null;
    this.schools = [];
    this.filteredSchools = [];
    this.stats = {
      totalSchools: 0,
      activeSchools: 0,
      inactiveSchools: 0,
      totalStudents: 0,
      totalTeachers: 0,
      totalClasses: 0,
      totalAttendance: 0,
      averageAttendance: 0,
    };
    this.activityLog = [];
    this.isInitialized = false;
    this.currentFilter = 'all';
    this.currentSort = { field: 'schoolName', direction: 'asc' };
    this.searchQuery = '';
    this.whatsappConfig = null;
  }

  // ────────────────────────────────
  // INITIALIZATION
  // ────────────────────────────────

  async init() {
    try {
      this.showLoading('Memulai sistem...');

      // 1. Validate config
      if (typeof isConfigReady === 'function' && !isConfigReady()) {
        var errors = typeof validateConfig === 'function' ? validateConfig() : [];
        throw new Error('Konfigurasi belum lengkap:\n' + errors.join('\n'));
      }

      // 2. Initialize Firebase
      initFirebase();
      this.db = firebase.firestore();

      // 3. Check Firebase auth state
      var authUser = await this.checkAuth();
      if (!authUser) {
        this.hideLoading();
        this.showLoginPage();
        return false;
      }

      // 4. Verify master admin email
      var masterEmail = SMART_ABSEN_CONFIG.app.masterAdminEmail;
      if (authUser.email.toLowerCase() !== masterEmail.toLowerCase()) {
        this.hideLoading();
        showAccessDenied(authUser.email, masterEmail);
        return false;
      }

      // 5. Store current user
      this.currentUser = {
        uid: authUser.uid,
        email: authUser.email,
        name: 'Master Admin',
        role: 'master_admin',
      };
      localStorage.setItem('smart_absen_admin_user', JSON.stringify(this.currentUser));

      // 6. Load activity log from localStorage
      this.loadActivityLog();

      // 7. Load schools from users collection
      await this.loadSchools();

      // 8. Load WhatsApp config
      await this.loadWhatsAppConfig();

      // 9. Calculate global stats
      await this.calculateGlobalStats();

      // 10. Show dashboard
      this.isInitialized = true;
      this.hideLoading();
      this.showAdminPanel();
      return true;

    } catch (error) {
      console.error('Init error:', error);
      this.hideLoading();
      showToast('Gagal memuat: ' + error.message, 'error');
      return false;
    }
  }

  // ────────────────────────────────
  // AUTHENTICATION
  // ────────────────────────────────

  async checkAuth() {
    return new Promise((resolve) => {
      var unsubscribe = firebase.auth().onAuthStateChanged((user) => {
        unsubscribe();
        resolve(user);
      });
    });
  }

  async signInWithEmail(email, password) {
    var result = await firebase.auth().signInWithEmailAndPassword(email, password);
    return result.user;
  }

  async signOut() {
    try {
      await firebase.auth().signOut();
      localStorage.removeItem('smart_absen_admin_user');
      this.currentUser = null;
      this.schools = [];
      this.isInitialized = false;
      this.showLoginPage();
      showToast('Berhasil keluar dari sistem');
    } catch (error) {
      showToast('Gagal logout: ' + error.message, 'error');
    }
  }

  // ────────────────────────────────
  // SCHOOL MANAGEMENT
  // ────────────────────────────────

  async loadSchools() {
    try {
      this.showLoading('Memuat data sekolah...');

      // Load from users collection where role = 'admin'
      var snapshot = await this.db.collection('users')
        .where('role', '==', 'admin')
        .get();

      this.schools = [];
      snapshot.forEach((doc) => {
        var data = doc.data();
        this.schools.push({
          id: doc.id,
          uid: doc.id,
          schoolName: data.schoolName || data.name || 'Tanpa Nama',
          schoolAddress: data.schoolAddress || '-',
          email: data.email || '-',
          sheetId: data.sheetId || '',
          folderId: data.folderId || '',
          spreadsheetUrl: data.spreadsheetUrl || '',
          googleDriveConnected: data.googleDriveConnected || false,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          isActive: data.isActive !== false,
          settings: data.settings || {},
        });
      });

      // Sort alphabetically
      this.schools.sort(function(a, b) {
        return (a.schoolName || '').localeCompare(b.schoolName || '');
      });

      this.applyFiltersAndSort();
      this.hideLoading();
      return this.schools;
    } catch (error) {
      this.hideLoading();
      console.error('Load schools error:', error);
      showToast('Gagal memuat data sekolah: ' + error.message, 'error');
      return [];
    }
  }

  async getSchool(schoolId) {
    try {
      var doc = await this.db.collection('users').doc(schoolId).get();
      if (!doc.exists) throw new Error('Sekolah tidak ditemukan');
      var data = doc.data();
      return {
        id: doc.id,
        uid: doc.id,
        schoolName: data.schoolName || data.name || 'Tanpa Nama',
        schoolAddress: data.schoolAddress || '-',
        email: data.email || '-',
        sheetId: data.sheetId || '',
        folderId: data.folderId || '',
        spreadsheetUrl: data.spreadsheetUrl || '',
        googleDriveConnected: data.googleDriveConnected || false,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        isActive: data.isActive !== false,
        settings: data.settings || {},
      };
    } catch (error) {
      console.error('Get school error:', error);
      throw error;
    }
  }

  async updateSchool(schoolId, data) {
    try {
      data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      await this.db.collection('users').doc(schoolId).update(data);
      var idx = this.schools.findIndex((s) => s.id === schoolId);
      if (idx >= 0) {
        this.schools[idx] = { ...this.schools[idx], ...data };
      }
      this.addActivityLog('update', 'Memperbarui data sekolah: ' + (this.schools[idx] ? this.schools[idx].schoolName : schoolId));
      showToast('Data sekolah berhasil diperbarui');
      return true;
    } catch (error) {
      console.error('Update school error:', error);
      showToast('Gagal memperbarui: ' + error.message, 'error');
      return false;
    }
  }

  async toggleSchoolStatus(schoolId) {
    try {
      var school = this.schools.find((s) => s.id === schoolId);
      if (!school) return;
      var newStatus = !school.isActive;
      var confirmMsg = newStatus
        ? 'Aktifkan sekolah "' + school.schoolName + '"?\nSekolah akan dapat mengakses sistem kembali.'
        : 'Nonaktifkan sekolah "' + school.schoolName + '"?\nSekolah tidak akan dapat mengakses sistem.';

      if (!confirm(confirmMsg)) return;

      await this.db.collection('users').doc(schoolId).update({
        isActive: newStatus,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      school.isActive = newStatus;
      this.addActivityLog(newStatus ? 'activate' : 'deactivate', (newStatus ? 'Mengaktifkan' : 'Menonaktifkan') + ' sekolah: ' + school.schoolName);
      showToast('Sekolah ' + (newStatus ? 'diaktifkan' : 'dinonaktifkan'));
      this.applyFiltersAndSort();
      return true;
    } catch (error) {
      showToast('Gagal mengubah status: ' + error.message, 'error');
      return false;
    }
  }

  async deleteSchool(schoolId) {
    try {
      var school = this.schools.find((s) => s.id === schoolId);
      if (!school) return;

      showModal('Konfirmasi Hapus', '<div class="text-center">' +
        '<div class="text-5xl mb-4" style="font-size:48px;">&#9888;&#65039;</div>' +
        '<p class="text-lg font-semibold" style="color:#dc2626; font-weight:600;">Hapus Sekolah?</p>' +
        '<p style="color:#475569;"><strong>' + school.schoolName + '</strong></p>' +
        '<p style="color:#64748b; font-size:14px;">Email: ' + school.email + '</p>' +
        '<div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:12px; text-align:left; font-size:13px; color:#92400e; margin:16px 0;">' +
          '<i class="fa-solid fa-triangle-exclamation" style="margin-right:4px;"></i>' +
          'Tindakan ini akan menonaktifkan sekolah dari sistem. Data absensi tidak akan dihapus.' +
        '</div>' +
        '<div style="display:flex; gap:12px; justify-content:center;">' +
          '<button onclick="closeMasterModal()" style="padding:10px 20px; border-radius:8px; border:none; background:#e2e8f0; color:#475569; font-weight:600; cursor:pointer;">Batal</button>' +
          '<button onclick="masterAdmin.confirmDeleteSchool(\'' + schoolId + '\')" style="padding:10px 20px; border-radius:8px; border:none; background:#dc2626; color:white; font-weight:600; cursor:pointer;">Ya, Hapus</button>' +
        '</div>' +
      '</div>');
    } catch (error) {
      showToast('Gagal menghapus: ' + error.message, 'error');
    }
  }

  async confirmDeleteSchool(schoolId) {
    try {
      closeMasterModal();
      var school = this.schools.find((s) => s.id === schoolId);
      await this.db.collection('users').doc(schoolId).update({
        isActive: false,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      if (school) {
        school.isActive = false;
        this.addActivityLog('delete', 'Menonaktifkan sekolah: ' + school.schoolName);
      }
      showToast('Sekolah berhasil dinonaktifkan');
      this.applyFiltersAndSort();
      await this.calculateGlobalStats();
      this.refreshUI();
    } catch (error) {
      showToast('Gagal menghapus: ' + error.message, 'error');
    }
  }

  // ────────────────────────────────
  // SCHOOL STATISTICS
  // ────────────────────────────────

  async calculateGlobalStats() {
    this.stats = {
      totalSchools: this.schools.length,
      activeSchools: 0,
      inactiveSchools: 0,
      totalStudents: 0,
      totalTeachers: 0,
      totalClasses: 0,
      totalAttendance: 0,
      averageAttendance: 0,
    };

    this.schools.forEach((school) => {
      if (school.isActive) {
        this.stats.activeSchools++;
      } else {
        this.stats.inactiveSchools++;
      }
      var settings = school.settings || {};
      this.stats.totalStudents += settings.total_siswa || 0;
      this.stats.totalTeachers += settings.total_guru || 0;
      this.stats.totalClasses += settings.total_kelas || 0;
    });

    this.stats.averageAttendance = this.stats.totalSchools > 0
      ? Math.round((this.stats.activeSchools / this.stats.totalSchools) * 100)
      : 0;

    return this.stats;
  }

  async getSchoolStats(schoolId) {
    try {
      var school = await this.getSchool(schoolId);
      return {
        totalSiswa: school.settings.total_siswa || 0,
        totalGuru: school.settings.total_guru || 0,
        totalKelas: school.settings.total_kelas || 0,
        todayAttendance: null,
      };
    } catch (error) {
      console.error('Get school stats error:', error);
      return { totalSiswa: 0, totalGuru: 0, totalKelas: 0, todayAttendance: null };
    }
  }

  // ────────────────────────────────
  // SCHOOL ACTIONS
  // ────────────────────────────────

  async openSchoolSheet(schoolId) {
    try {
      var school = await this.getSchool(schoolId);
      if (school.spreadsheetUrl) {
        window.open(school.spreadsheetUrl, '_blank');
      } else if (school.sheetId) {
        window.open('https://docs.google.com/spreadsheets/d/' + school.sheetId + '/edit', '_blank');
      } else {
        showToast('Sekolah belum memiliki spreadsheet', 'warning');
      }
    } catch (error) {
      showToast('Gagal membuka spreadsheet: ' + error.message, 'error');
    }
  }

  async viewSchoolData(schoolId) {
    try {
      var school = await this.getSchool(schoolId);
      var statusHtml = school.isActive
        ? '<span style="color:#059669;">&#9679; Aktif</span>'
        : '<span style="color:#dc2626;">&#9679; Nonaktif</span>';

      var modalContent =
        '<div style="display:flex; flex-direction:column; gap:12px;">' +
          '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:14px;">' +
            '<div style="background:#f8fafc; border-radius:8px; padding:12px;">' +
              '<div style="color:#64748b; font-size:11px; margin-bottom:4px;">Email Admin</div>' +
              '<div style="font-weight:600;">' + school.email + '</div>' +
            '</div>' +
            '<div style="background:#f8fafc; border-radius:8px; padding:12px;">' +
              '<div style="color:#64748b; font-size:11px; margin-bottom:4px;">Status</div>' +
              '<div style="font-weight:600;">' + statusHtml + '</div>' +
            '</div>' +
            '<div style="background:#f8fafc; border-radius:8px; padding:12px;">' +
              '<div style="color:#64748b; font-size:11px; margin-bottom:4px;">Total Siswa</div>' +
              '<div style="font-weight:600; font-size:18px;">' + (school.settings.total_siswa || 0) + '</div>' +
            '</div>' +
            '<div style="background:#f8fafc; border-radius:8px; padding:12px;">' +
              '<div style="color:#64748b; font-size:11px; margin-bottom:4px;">Total Guru</div>' +
              '<div style="font-weight:600; font-size:18px;">' + (school.settings.total_guru || 0) + '</div>' +
            '</div>' +
            '<div style="background:#f8fafc; border-radius:8px; padding:12px;">' +
              '<div style="color:#64748b; font-size:11px; margin-bottom:4px;">Total Kelas</div>' +
              '<div style="font-weight:600; font-size:18px;">' + (school.settings.total_kelas || 0) + '</div>' +
            '</div>' +
            '<div style="background:#f8fafc; border-radius:8px; padding:12px;">' +
              '<div style="color:#64748b; font-size:11px; margin-bottom:4px;">Tahun Ajaran</div>' +
              '<div style="font-weight:600;">' + (school.settings.tahun_ajaran || '-') + '</div>' +
            '</div>' +
          '</div>' +
          '<div style="background:#eff6ff; border-radius:8px; padding:12px;">' +
            '<div style="color:#64748b; font-size:11px; margin-bottom:4px;">Alamat</div>' +
            '<div style="font-weight:600;">' + (school.schoolAddress || '-') + '</div>' +
          '</div>' +
          '<div style="background:#f8fafc; border-radius:8px; padding:12px;">' +
            '<div style="color:#64748b; font-size:11px; margin-bottom:4px;">Terdaftar Sejak</div>' +
            '<div style="font-weight:600;">' + (school.createdAt ? formatDate(school.createdAt) : '-') + '</div>' +
          '</div>' +
          '<div style="display:flex; gap:10px; justify-content:flex-end; margin-top:8px;">' +
            '<button onclick="closeMasterModal()" style="padding:10px 20px; border-radius:8px; border:none; background:#e2e8f0; color:#475569; font-weight:600; cursor:pointer;">Tutup</button>' +
            (school.spreadsheetUrl ? '<a href="' + school.spreadsheetUrl + '" target="_blank" style="padding:10px 20px; border-radius:8px; background:#059669; color:white; font-weight:600; text-decoration:none; display:inline-flex; align-items:center; gap:6px;"><i class="fa-solid fa-table"></i> Buka Spreadsheet</a>' : '') +
          '</div>' +
        '</div>';

      showModal('Data Sekolah: ' + school.schoolName, modalContent);
    } catch (error) {
      showToast('Gagal memuat data: ' + error.message, 'error');
    }
  }

  async resetSchoolData(schoolId) {
    try {
      var school = await this.getSchool(schoolId);
      if (!school) return;

      showModal('Reset Data Sekolah', '<div style="text-align:center;">' +
        '<div style="font-size:48px; margin-bottom:16px;">&#128680;</div>' +
        '<p style="font-size:18px; font-weight:600; color:#dc2626;">Peringatan: Tindakan Berbahaya!</p>' +
        '<div style="background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:16px; text-align:left; font-size:14px; color:#991b1b; margin:16px 0;">' +
          '<p style="font-weight:600; margin-bottom:8px;">Anda akan menghapus SEMUA data di sekolah:</p>' +
          '<p style="font-weight:700;">' + school.schoolName + '</p>' +
          '<ul style="margin-top:8px; list-style:disc; padding-left:20px;">' +
            '<li>Semua data siswa akan dihapus</li>' +
            '<li>Semua data guru akan dihapus</li>' +
            '<li>Semua data kelas akan dihapus</li>' +
            '<li>Semua data absensi akan dihapus</li>' +
          '</ul>' +
        '</div>' +
        '<div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:12px; font-size:13px; color:#92400e;">' +
          '<i class="fa-solid fa-triangle-exclamation" style="margin-right:4px;"></i>' +
          'Tindakan ini <strong>TIDAK DAPAT dibatalkan</strong>.' +
        '</div>' +
        '<div style="display:flex; gap:12px; justify-content:center; margin-top:16px;">' +
          '<button onclick="closeMasterModal()" style="padding:10px 20px; border-radius:8px; border:none; background:#e2e8f0; color:#475569; font-weight:600; cursor:pointer;">Batal</button>' +
          '<button onclick="closeMasterModal(); masterAdmin.executeReset(\'' + schoolId + '\')" style="padding:10px 20px; border-radius:8px; border:none; background:#dc2626; color:white; font-weight:600; cursor:pointer;">Ya, Hapus Semua Data</button>' +
        '</div>' +
      '</div>');
    } catch (error) {
      showToast('Gagal: ' + error.message, 'error');
    }
  }

  async executeReset(schoolId) {
    try {
      if (!confirm('PERHATIAN!\n\nAnda yakin ingin menghapus semua data sekolah ini?\nTindakan ini TIDAK DAPAT dibatalkan!')) return;
      if (!confirm('Konfirmasi sekali lagi: HAPUS SEMUA DATA?')) return;

      var school = await this.getSchool(schoolId);
      if (!school) {
        showToast('Sekolah tidak ditemukan', 'error');
        return;
      }

      // Reset Firestore settings
      await this.db.collection('users').doc(schoolId).update({
        'settings.total_siswa': 0,
        'settings.total_guru': 0,
        'settings.total_kelas': 0,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      this.addActivityLog('reset', 'Reset semua data sekolah: ' + school.schoolName);
      showToast('Data sekolah berhasil direset');
      await this.loadSchools();
      await this.calculateGlobalStats();
      this.refreshUI();
    } catch (error) {
      showToast('Gagal reset data: ' + error.message, 'error');
    }
  }

  // ────────────────────────────────
  // SEARCH & FILTER
  // ────────────────────────────────

  searchSchools(query) {
    this.searchQuery = query.toLowerCase().trim();
    this.applyFiltersAndSort();
    return this.filteredSchools;
  }

  filterSchools(status) {
    this.currentFilter = status;
    this.applyFiltersAndSort();
    return this.filteredSchools;
  }

  sortSchools(field, direction) {
    this.currentSort = { field: field, direction: direction || 'asc' };
    this.applyFiltersAndSort();
    return this.filteredSchools;
  }

  applyFiltersAndSort() {
    var result = this.schools.slice();

    // Apply search
    if (this.searchQuery) {
      result = result.filter(function(s) {
        return s.schoolName.toLowerCase().includes(this.searchQuery) ||
          s.email.toLowerCase().includes(this.searchQuery) ||
          s.schoolAddress.toLowerCase().includes(this.searchQuery);
      }.bind(this));
    }

    // Apply filter
    if (this.currentFilter === 'active') {
      result = result.filter(function(s) { return s.isActive; });
    } else if (this.currentFilter === 'inactive') {
      result = result.filter(function(s) { return !s.isActive; });
    }

    // Apply sort
    var sortField = this.currentSort.field;
    var sortDir = this.currentSort.direction;
    result.sort(function(a, b) {
      var valA, valB;
      switch (sortField) {
        case 'schoolName':
          valA = a.schoolName.toLowerCase();
          valB = b.schoolName.toLowerCase();
          break;
        case 'email':
          valA = a.email.toLowerCase();
          valB = b.email.toLowerCase();
          break;
        case 'totalStudents':
          valA = (a.settings || {}).total_siswa || 0;
          valB = (b.settings || {}).total_siswa || 0;
          break;
        case 'createdAt':
          valA = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : new Date(0);
          valB = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date(0);
          break;
        default:
          valA = a.schoolName.toLowerCase();
          valB = b.schoolName.toLowerCase();
      }
      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    this.filteredSchools = result;
  }

  // ────────────────────────────────
  // REGISTRATION
  // ────────────────────────────────

  async addManualSchool(schoolData) {
    try {
      var schoolName = schoolData.schoolName;
      var email = schoolData.email;
      var address = schoolData.address;
      if (!schoolName || !email) {
        showToast('Nama sekolah dan email wajib diisi', 'error');
        return false;
      }

      var existing = this.schools.find(function(s) { return s.email.toLowerCase() === email.toLowerCase(); });
      if (existing) {
        showToast('Email sudah terdaftar untuk sekolah lain', 'error');
        return false;
      }

      var schoolId = generateId();

      var schoolDoc = {
        uid: schoolId,
        name: schoolName,
        schoolName: schoolName,
        schoolAddress: address || '',
        email: email,
        role: 'admin',
        sheetId: '',
        folderId: '',
        spreadsheetUrl: '',
        googleDriveConnected: false,
        isActive: true,
        settings: {
          tahun_ajaran: '2025/2026',
          whatsapp_enabled: false,
          school_hours: { start: '07:00', end: '15:00' },
          total_siswa: 0,
          total_guru: 0,
          total_kelas: 0,
        },
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };

      await this.db.collection('users').doc(schoolId).set(schoolDoc);

      this.schools.push({
        id: schoolId,
        uid: schoolId,
        schoolName: schoolName,
        schoolAddress: address || '',
        email: email,
        role: 'admin',
        sheetId: '',
        folderId: '',
        spreadsheetUrl: '',
        googleDriveConnected: false,
        isActive: true,
        settings: schoolDoc.settings,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      this.applyFiltersAndSort();
      await this.calculateGlobalStats();
      this.addActivityLog('add', 'Menambahkan sekolah baru: ' + schoolName);
      showToast('Sekolah berhasil ditambahkan');
      this.refreshUI();
      return true;
    } catch (error) {
      showToast('Gagal menambahkan sekolah: ' + error.message, 'error');
      return false;
    }
  }

  async sendSchoolInvitation(email, schoolName) {
    try {
      var baseUrl = window.location.origin + window.location.pathname.replace('master-admin.html', '');
      var invitationLink = baseUrl + '?ref=' + encodeURIComponent(email) + '&school=' + encodeURIComponent(schoolName);

      var invitationId = generateId();
      await this.db.collection('invitations').doc(invitationId).set({
        email: email,
        schoolName: schoolName,
        link: invitationLink,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        status: 'sent',
        sentBy: this.currentUser.email,
      });

      this.addActivityLog('invite', 'Mengirim undangan ke ' + email + ' (' + schoolName + ')');

      var waMessage = 'Halo, Anda diundang untuk mendaftarkan sekolah "' + schoolName + '" di Smart Absen Enterprise.\n\nLink pendaftaran:\n' + invitationLink;
      var waUrl = 'https://wa.me/?text=' + encodeURIComponent(waMessage);

      showModal('Undangan Terkirim', '<div style="text-align:center;">' +
        '<div style="font-size:48px; margin-bottom:12px;">&#128231;</div>' +
        '<p style="font-size:18px; font-weight:600; color:#059669;">Undangan berhasil dibuat!</p>' +
        '</div>' +
        '<div style="background:#f8fafc; border-radius:8px; padding:16px; margin-top:16px;">' +
          '<div style="font-size:13px; color:#64748b; margin-bottom:8px;">Kirim link berikut ke <strong>' + email + '</strong>:</div>' +
          '<div style="background:white; border:1px solid #e2e8f0; border-radius:8px; padding:12px; font-size:13px; font-family:monospace; word-break:break-all; color:#2563eb; user-select:all;">' + invitationLink + '</div>' +
        '</div>' +
        '<div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-top:16px;">' +
          '<button onclick="navigator.clipboard.writeText(\'' + invitationLink + '\').then(function(){showToast(\'Link disalin!\')})" style="padding:10px 16px; border-radius:8px; border:none; background:#2563eb; color:white; font-weight:600; cursor:pointer; font-size:13px;"><i class="fa-solid fa-copy" style="margin-right:4px;"></i> Salin Link</button>' +
          '<a href="' + waUrl + '" target="_blank" style="padding:10px 16px; border-radius:8px; background:#059669; color:white; font-weight:600; text-decoration:none; font-size:13px; display:inline-flex; align-items:center; gap:4px;"><i class="fa-brands fa-whatsapp"></i> Kirim via WhatsApp</a>' +
          '<a href="mailto:' + email + '?subject=' + encodeURIComponent('Undangan Smart Absen Enterprise') + '&body=' + encodeURIComponent(waMessage) + '" style="padding:10px 16px; border-radius:8px; background:#475569; color:white; font-weight:600; text-decoration:none; font-size:13px; display:inline-flex; align-items:center; gap:4px;"><i class="fa-solid fa-envelope"></i> Kirim Email</a>' +
        '</div>' +
        '<div style="text-align:center; margin-top:16px;">' +
          '<button onclick="closeMasterModal()" style="padding:10px 20px; border-radius:8px; border:none; background:#e2e8f0; color:#475569; font-weight:600; cursor:pointer;">Tutup</button>' +
        '</div>'
      );
    } catch (error) {
      showToast('Gagal mengirim undangan: ' + error.message, 'error');
    }
  }

  // ────────────────────────────────
  // WHATSAPP CONFIG MANAGEMENT
  // ────────────────────────────────

  async saveWhatsAppConfig(apiUrl, apiKey, template) {
    await this.db.collection('system_config').doc('whatsapp').set({
      api_url: apiUrl,
      api_key: apiKey,
      template: template,
      updated_at: new Date().toISOString(),
      updated_by: this.currentUser.email,
    });
    this.whatsappConfig = { api_url: apiUrl, api_key: apiKey, template: template, updated_at: new Date().toISOString(), updated_by: this.currentUser.email };
    this.addActivityLog('config', 'Memperbarui konfigurasi WhatsApp API');
  }

  async loadWhatsAppConfig() {
    try {
      var doc = await this.db.collection('system_config').doc('whatsapp').get();
      if (doc.exists) {
        this.whatsappConfig = doc.data();
      } else {
        this.whatsappConfig = null;
      }
    } catch (error) {
      console.warn('Load WhatsApp config error:', error);
      this.whatsappConfig = null;
    }
  }

  async testWhatsApp(phoneNumber, message) {
    if (!this.whatsappConfig || !this.whatsappConfig.api_url || !this.whatsappConfig.api_key) {
      throw new Error('WhatsApp API belum dikonfigurasi. Simpan konfigurasi terlebih dahulu.');
    }
    var response = await fetch(this.whatsappConfig.api_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: phoneNumber,
        message: message,
        apiKey: this.whatsappConfig.api_key,
      }),
    });
    if (!response.ok) {
      throw new Error('HTTP ' + response.status + ': ' + response.statusText);
    }
    return response.json();
  }

  // ────────────────────────────────
  // ACTIVITY LOG
  // ────────────────────────────────

  addActivityLog(action, description) {
    this.activityLog.unshift({
      id: Date.now().toString(36),
      action: action,
      description: description,
      timestamp: new Date(),
      user: this.currentUser ? this.currentUser.email : 'System',
    });
    if (this.activityLog.length > 50) {
      this.activityLog = this.activityLog.slice(0, 50);
    }
    try {
      localStorage.setItem('master_admin_activity_log', JSON.stringify(this.activityLog));
    } catch (e) { /* ignore */ }
  }

  loadActivityLog() {
    try {
      var saved = localStorage.getItem('master_admin_activity_log');
      if (saved) {
        this.activityLog = JSON.parse(saved);
      }
    } catch (e) {
      this.activityLog = [];
    }
  }

  // ────────────────────────────────
  // UI HELPERS
  // ────────────────────────────────

  showLoading(message) {
    var el = document.getElementById('globalLoading');
    if (el) {
      var msgEl = el.querySelector('.loading-message');
      if (msgEl) msgEl.textContent = message || 'Memuat...';
      el.classList.remove('hidden');
      el.classList.add('flex');
    }
  }

  hideLoading() {
    var el = document.getElementById('globalLoading');
    if (el) {
      el.classList.add('hidden');
      el.classList.remove('flex');
    }
  }

  showLoginPage() {
    var loginPage = document.getElementById('loginPage');
    var adminPanel = document.getElementById('adminPanel');
    if (loginPage) loginPage.style.display = '';
    if (adminPanel) adminPanel.classList.remove('active');
  }

  showAdminPanel() {
    var loginPage = document.getElementById('loginPage');
    var adminPanel = document.getElementById('adminPanel');
    if (loginPage) loginPage.style.display = 'none';
    if (adminPanel) adminPanel.classList.add('active');
    this.refreshUI();
  }

  refreshUI() {
    renderStatsCards(this.stats);
    renderSchoolsTable(this.filteredSchools);
    renderActivityFeed(this.activityLog.slice(0, 10));
    renderRecentRegistrations(this.filteredSchools.slice(0, 5));
    updateHeaderInfo(this.currentUser);
  }
}

// ==========================================
// RENDER FUNCTIONS
// ==========================================

/**
 * Update header user info
 */
function updateHeaderInfo(user) {
  if (!user) return;
  var nameEl = document.getElementById('headerUserName');
  var emailEl = document.getElementById('headerUserEmail');
  var avatarEl = document.getElementById('headerUserAvatar');
  if (nameEl) nameEl.textContent = user.name || 'Master Admin';
  if (emailEl) emailEl.textContent = user.email || '';
  if (avatarEl) avatarEl.textContent = (user.name || 'A').charAt(0).toUpperCase();
}

/**
 * Render stats cards
 */
function renderStatsCards(stats) {
  var container = document.getElementById('statsContainer');
  if (!container) return;

  var cards = [
    { icon: 'fa-school', label: 'Total Sekolah', value: stats.totalSchools, color: '#0f4c75', bg: '#f0f9ff' },
    { icon: 'fa-circle-check', label: 'Sekolah Aktif', value: stats.activeSchools, color: '#059669', bg: '#f0fdf4' },
    { icon: 'fa-users', label: 'Total Siswa', value: stats.totalStudents.toLocaleString('id-ID'), color: '#7c3aed', bg: '#f5f3ff' },
    { icon: 'fa-chalkboard-user', label: 'Total Guru', value: stats.totalTeachers.toLocaleString('id-ID'), color: '#ea580c', bg: '#fff7ed' },
  ];

  container.innerHTML = cards.map(function(c) {
    return '<div class="card" style="overflow:hidden;">' +
      '<div class="card-body" style="padding:20px;">' +
        '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">' +
          '<span style="font-size:13px; font-weight:500; color:#64748b;">' + c.label + '</span>' +
          '<div style="width:40px; height:40px; border-radius:10px; background:' + c.bg + '; display:flex; align-items:center; justify-content:center;">' +
            '<i class="fa-solid ' + c.icon + '" style="color:' + c.color + '; font-size:16px;"></i>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:28px; font-weight:800; color:#0f172a; line-height:1;">' + c.value + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  // Also update stats page container
  var statsPage = document.getElementById('statsPageContainer');
  if (statsPage) {
    var extraCards = [
      { icon: 'fa-door-open', label: 'Total Kelas', value: stats.totalClasses.toLocaleString('id-ID'), color: '#0891b2', bg: '#ecfeff' },
      { icon: 'fa-circle-xmark', label: 'Sekolah Nonaktif', value: stats.inactiveSchools, color: '#dc2626', bg: '#fef2f2' },
    ];
    statsPage.innerHTML = cards.concat(extraCards).map(function(c) {
      return '<div class="card" style="overflow:hidden;">' +
        '<div class="card-body" style="padding:16px;">' +
          '<div style="display:flex; align-items:center; gap:12px;">' +
            '<div style="width:40px; height:40px; border-radius:10px; background:' + c.bg + '; display:flex; align-items:center; justify-content:center; flex-shrink:0;">' +
              '<i class="fa-solid ' + c.icon + '" style="color:' + c.color + '; font-size:15px;"></i>' +
            '</div>' +
            '<div>' +
              '<div style="font-size:11px; color:#64748b; font-weight:500;">' + c.label + '</div>' +
              '<div style="font-size:20px; font-weight:700; color:#0f172a;">' + c.value + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }
}

/**
 * Render schools table
 */
function renderSchoolsTable(schools) {
  var container = document.getElementById('schoolsTableBody');
  if (!container) return;

  if (!schools || schools.length === 0) {
    container.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:48px 20px; color:#94a3b8;">' +
      '<i class="fa-solid fa-school" style="font-size:48px; display:block; margin-bottom:12px; color:#cbd5e1;"></i>' +
      '<p style="font-size:16px; font-weight:600; color:#64748b;">Tidak ada sekolah ditemukan</p>' +
      '<p style="font-size:13px; margin-top:4px;">' + (masterAdmin && masterAdmin.searchQuery ? 'Coba ubah kata kunci pencarian' : 'Belum ada sekolah yang terdaftar') + '</p>' +
    '</td></tr>';
    var countEl = document.getElementById('schoolsCount');
    if (countEl) countEl.textContent = '0 sekolah';
    return;
  }

  var countEl = document.getElementById('schoolsCount');
  if (countEl) countEl.textContent = schools.length + ' sekolah';

  container.innerHTML = schools.map(function(school, index) {
    var settings = school.settings || {};
    var createdDate = school.createdAt ? formatDate(school.createdAt) : '-';
    var statusBadge = school.isActive
      ? '<span style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; background:#f0fdf4; color:#059669; border-radius:999px; font-size:11px; font-weight:700;"><span style="width:6px; height:6px; background:#059669; border-radius:50%; display:inline-block;"></span>Aktif</span>'
      : '<span style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; background:#fef2f2; color:#dc2626; border-radius:999px; font-size:11px; font-weight:700;"><span style="width:6px; height:6px; background:#dc2626; border-radius:50%; display:inline-block;"></span>Nonaktif</span>';

    return '<tr style="border-bottom:1px solid #f1f5f9; transition:background 0.15s;" onmouseover="this.style.background=\'#f8fafc\'" onmouseout="this.style.background=\'transparent\'">' +
      '<td style="padding:12px 16px;">' +
        '<div style="display:flex; align-items:center; gap:12px;">' +
          '<div style="width:36px; height:36px; background:linear-gradient(135deg,#3b82f6,#2563eb); border-radius:8px; display:flex; align-items:center; justify-content:center; color:white; font-size:13px; font-weight:700; flex-shrink:0;">' + (index + 1).toString().padStart(2, '0') + '</div>' +
          '<div>' +
            '<div style="font-weight:600; color:#1e293b; font-size:14px;">' + school.schoolName + '</div>' +
            '<div style="font-size:12px; color:#64748b;">' + school.email + '</div>' +
          '</div>' +
        '</div>' +
      '</td>' +
      '<td style="padding:12px 16px; font-size:13px; color:#64748b; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + school.schoolAddress + '</td>' +
      '<td style="padding:12px 16px;">' + statusBadge + '</td>' +
      '<td style="padding:12px 16px; text-align:center; font-weight:600;">' + (settings.total_siswa || 0) + '</td>' +
      '<td style="padding:12px 16px; text-align:center; font-weight:600;">' + (settings.total_guru || 0) + '</td>' +
      '<td style="padding:12px 16px; text-align:center; font-weight:600;">' + (settings.total_kelas || 0) + '</td>' +
      '<td style="padding:12px 16px; font-size:13px; color:#64748b;">' + createdDate + '</td>' +
      '<td style="padding:12px 16px;">' +
        '<div style="display:flex; gap:4px;">' +
          '<button onclick="masterAdmin.viewSchoolData(\'' + school.id + '\')" title="Lihat Detail" style="width:30px; height:30px; border-radius:6px; border:1px solid #e2e8f0; background:white; color:#64748b; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:12px;" onmouseover="this.style.background=\'#f1f5f9\'" onmouseout="this.style.background=\'white\'"><i class="fa-solid fa-eye"></i></button>' +
          (school.spreadsheetUrl || school.sheetId ? '<button onclick="masterAdmin.openSchoolSheet(\'' + school.id + '\')" title="Buka Spreadsheet" style="width:30px; height:30px; border-radius:6px; border:1px solid #e2e8f0; background:white; color:#64748b; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:12px;" onmouseover="this.style.background=\'#f0fdf4\';this.style.color=\'#059669\'" onmouseout="this.style.background=\'white\';this.style.color=\'#64748b\'"><i class="fa-solid fa-table"></i></button>' : '') +
          '<button onclick="masterAdmin.toggleSchoolStatus(\'' + school.id + '\')" title="' + (school.isActive ? 'Nonaktifkan' : 'Aktifkan') + '" style="width:30px; height:30px; border-radius:6px; border:1px solid #e2e8f0; background:white; color:#64748b; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:12px;" onmouseover="this.style.background=\'#fffbeb\';this.style.color=\'#d97706\'" onmouseout="this.style.background=\'white\';this.style.color=\'#64748b\'"><i class="fa-solid fa-power-off"></i></button>' +
          '<button onclick="masterAdmin.deleteSchool(\'' + school.id + '\')" title="Hapus" style="width:30px; height:30px; border-radius:6px; border:1px solid #e2e8f0; background:white; color:#64748b; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:12px;" onmouseover="this.style.background=\'#fef2f2\';this.style.color=\'#dc2626\'" onmouseout="this.style.background=\'white\';this.style.color=\'#64748b\'"><i class="fa-solid fa-trash"></i></button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  }).join('');
}

/**
 * Render recent registrations on dashboard
 */
function renderRecentRegistrations(schools) {
  var container = document.getElementById('recentRegistrations');
  if (!container) return;

  if (!schools || schools.length === 0) {
    container.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:32px; color:#94a3b8; font-size:14px;">Belum ada sekolah terdaftar</td></tr>';
    return;
  }

  var sorted = schools.slice().sort(function(a, b) {
    var da = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : new Date(0);
    var db = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date(0);
    return db - da;
  }).slice(0, 5);

  container.innerHTML = sorted.map(function(school) {
    var statusBadge = school.isActive
      ? '<span style="display:inline-flex; align-items:center; gap:3px; padding:2px 8px; background:#f0fdf4; color:#059669; border-radius:999px; font-size:10px; font-weight:700;">Aktif</span>'
      : '<span style="display:inline-flex; align-items:center; gap:3px; padding:2px 8px; background:#fef2f2; color:#dc2626; border-radius:999px; font-size:10px; font-weight:700;">Nonaktif</span>';

    return '<tr style="border-bottom:1px solid #f1f5f9;">' +
      '<td style="padding:10px 16px; font-size:13px; font-weight:600; color:#1e293b;">' + school.schoolName + '</td>' +
      '<td style="padding:10px 16px;">' + statusBadge + '</td>' +
      '<td style="padding:10px 16px; font-size:12px; color:#64748b;">' + (school.createdAt ? formatDate(school.createdAt) : '-') + '</td>' +
      '<td style="padding:10px 16px;"><button onclick="masterAdmin.viewSchoolData(\'' + school.id + '\')" style="font-size:12px; color:#2563eb; background:none; border:none; cursor:pointer; font-weight:600;">Detail</button></td>' +
    '</tr>';
  }).join('');
}

/**
 * Render activity feed
 */
function renderActivityFeed(logs) {
  var container = document.getElementById('activityFeed');
  if (!container) return;

  if (!logs || logs.length === 0) {
    container.innerHTML = '<p style="color:#94a3b8; font-size:14px; text-align:center; padding:24px;">Tidak ada aktivitas terkini</p>';
    return;
  }

  var actionIcons = {
    add: { icon: 'fa-plus-circle', color: '#059669' },
    update: { icon: 'fa-pen-to-square', color: '#2563eb' },
    activate: { icon: 'fa-circle-check', color: '#059669' },
    deactivate: { icon: 'fa-circle-xmark', color: '#dc2626' },
    delete: { icon: 'fa-trash', color: '#dc2626' },
    reset: { icon: 'fa-rotate', color: '#ea580c' },
    invite: { icon: 'fa-paper-plane', color: '#7c3aed' },
    config: { icon: 'fa-gear', color: '#0891b2' },
    login: { icon: 'fa-right-to-bracket', color: '#059669' },
    logout: { icon: 'fa-right-from-bracket', color: '#dc2626' },
  };

  container.innerHTML = logs.map(function(log) {
    var info = actionIcons[log.action] || { icon: 'fa-circle-info', color: '#64748b' };
    var time = log.timestamp ? new Date(log.timestamp) : new Date();
    var timeStr = time.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    var dateStr = time.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

    return '<div style="display:flex; align-items:flex-start; gap:12px; padding:10px 0; border-bottom:1px solid #f8fafc;">' +
      '<div style="width:32px; height:32px; border-radius:8px; background:' + info.color + '15; display:flex; align-items:center; justify-content:center; flex-shrink:0;">' +
        '<i class="fa-solid ' + info.icon + '" style="color:' + info.color + '; font-size:13px;"></i>' +
      '</div>' +
      '<div style="flex:1; min-width:0;">' +
        '<p style="font-size:13px; color:#334155; line-height:1.4;">' + log.description + '</p>' +
        '<p style="font-size:11px; color:#94a3b8; margin-top:2px;">' + dateStr + ' ' + timeStr + '</p>' +
      '</div>' +
    '</div>';
  }).join('');
}

/**
 * Render full activity feed (notifications page)
 */
function renderFullActivityFeed() {
  var container = document.getElementById('fullActivityFeed');
  if (!container) return;
  renderActivityFeed(masterAdmin.activityLog.slice(0, 10));
  // Update the container for the notifications page
  if (container) {
    if (masterAdmin.activityLog.length === 0) {
      container.innerHTML = '<p style="color:#94a3b8; font-size:14px; text-align:center; padding:24px;">Tidak ada aktivitas</p>';
    } else {
      container.innerHTML = renderActivityLogHTML(masterAdmin.activityLog);
    }
  }
}

function renderActivityLogHTML(logs) {
  var actionIcons = {
    add: { icon: 'fa-plus-circle', color: '#059669' },
    update: { icon: 'fa-pen-to-square', color: '#2563eb' },
    activate: { icon: 'fa-circle-check', color: '#059669' },
    deactivate: { icon: 'fa-circle-xmark', color: '#dc2626' },
    delete: { icon: 'fa-trash', color: '#dc2626' },
    reset: { icon: 'fa-rotate', color: '#ea580c' },
    invite: { icon: 'fa-paper-plane', color: '#7c3aed' },
    config: { icon: 'fa-gear', color: '#0891b2' },
    login: { icon: 'fa-right-to-bracket', color: '#059669' },
    logout: { icon: 'fa-right-from-bracket', color: '#dc2626' },
  };

  return logs.map(function(log) {
    var info = actionIcons[log.action] || { icon: 'fa-circle-info', color: '#64748b' };
    var time = log.timestamp ? new Date(log.timestamp) : new Date();
    var timeStr = time.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    var dateStr = time.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

    return '<div style="display:flex; align-items:flex-start; gap:12px; padding:12px 0; border-bottom:1px solid #f1f5f9;">' +
      '<div style="width:36px; height:36px; border-radius:10px; background:' + info.color + '15; display:flex; align-items:center; justify-content:center; flex-shrink:0;">' +
        '<i class="fa-solid ' + info.icon + '" style="color:' + info.color + '; font-size:14px;"></i>' +
      '</div>' +
      '<div style="flex:1; min-width:0;">' +
        '<p style="font-size:14px; color:#1e293b; line-height:1.5;">' + log.description + '</p>' +
        '<p style="font-size:12px; color:#94a3b8; margin-top:2px;">' + dateStr + ' ' + timeStr + (log.user ? ' &middot; ' + log.user : '') + '</p>' +
      '</div>' +
    '</div>';
  }).join('');
}

/**
 * Render schools distribution chart (text-based bar chart)
 */
function renderSchoolsDistribution(schools) {
  var container = document.getElementById('schoolsDistribution');
  if (!container) return;

  var active = 0, inactive = 0;
  schools.forEach(function(s) { if (s.isActive) active++; else inactive++; });
  var total = active + inactive;
  var activePct = total > 0 ? Math.round((active / total) * 100) : 0;
  var inactivePct = 100 - activePct;

  container.innerHTML =
    '<div style="margin-bottom:20px;">' +
      '<div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:13px;">' +
        '<span style="color:#059669; font-weight:600;">Aktif: ' + active + ' (' + activePct + '%)</span>' +
        '<span style="color:#dc2626; font-weight:600;">Nonaktif: ' + inactive + ' (' + inactivePct + '%)</span>' +
      '</div>' +
      '<div style="height:24px; background:#e2e8f0; border-radius:12px; overflow:hidden; display:flex;">' +
        '<div style="width:' + activePct + '%; background:#059669; transition:width 0.5s;"></div>' +
        '<div style="width:' + inactivePct + '%; background:#dc2626; transition:width 0.5s;"></div>' +
      '</div>' +
    '</div>' +
    '<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:16px;">' +
      '<div style="text-align:center; padding:16px; background:#f0fdf4; border-radius:12px;">' +
        '<div style="font-size:28px; font-weight:800; color:#059669;">' + active + '</div>' +
        '<div style="font-size:12px; color:#64748b; margin-top:4px;">Sekolah Aktif</div>' +
      '</div>' +
      '<div style="text-align:center; padding:16px; background:#fef2f2; border-radius:12px;">' +
        '<div style="font-size:28px; font-weight:800; color:#dc2626;">' + inactive + '</div>' +
        '<div style="font-size:12px; color:#64748b; margin-top:4px;">Sekolah Nonaktif</div>' +
      '</div>' +
    '</div>';
}

/**
 * Render performance lists (top schools, needs attention)
 */
function renderPerformanceLists(schools) {
  var topContainer = document.getElementById('topPerformingSchools');
  var attnContainer = document.getElementById('attentionNeededSchools');
  if (!topContainer || !attnContainer) return;

  var sorted = schools.slice().sort(function(a, b) {
    return ((b.settings || {}).total_siswa || 0) - ((a.settings || {}).total_siswa || 0);
  });

  var top5 = sorted.slice(0, 5);
  var attention = sorted.filter(function(s) { return s.isActive && ((s.settings || {}).total_siswa || 0) < 10; }).slice(0, 5);

  if (top5.length === 0) {
    topContainer.innerHTML = '<p style="color:#94a3b8; font-size:13px; text-align:center; padding:16px;">Belum ada data</p>';
  } else {
    topContainer.innerHTML = top5.map(function(s, i) {
      var medal = i === 0 ? '&#127942;' : (i + 1) + '.';
      return '<div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #f8fafc;">' +
        '<span style="font-size:14px; width:24px; text-align:center;">' + medal + '</span>' +
        '<div style="flex:1; min-width:0;">' +
          '<div style="font-size:13px; font-weight:600; color:#1e293b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + s.schoolName + '</div>' +
        '</div>' +
        '<span style="font-size:13px; font-weight:600; color:#0f4c75;">' + ((s.settings || {}).total_siswa || 0) + ' siswa</span>' +
      '</div>';
    }).join('');
  }

  if (attention.length === 0) {
    attnContainer.innerHTML = '<p style="color:#94a3b8; font-size:13px; text-align:center; padding:16px;">Semua sekolah aktif berjalan baik &#128077;</p>';
  } else {
    attnContainer.innerHTML = attention.map(function(s) {
      return '<div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #f8fafc;">' +
        '<span style="font-size:12px; color:#dc2626;">&#9888;&#65039;</span>' +
        '<div style="flex:1; min-width:0;">' +
          '<div style="font-size:13px; font-weight:600; color:#1e293b;">' + s.schoolName + '</div>' +
        '</div>' +
        '<span style="font-size:12px; color:#64748b;">' + ((s.settings || {}).total_siswa || 0) + ' siswa</span>' +
      '</div>';
    }).join('');
  }
}

/**
 * Render stats schools table
 */
function renderStatsSchoolsTable(schools) {
  var container = document.getElementById('statsSchoolsTable');
  if (!container) return;

  if (!schools || schools.length === 0) {
    container.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:32px; color:#94a3b8; font-size:14px;">Belum ada data</td></tr>';
    return;
  }

  container.innerHTML = schools.map(function(school, index) {
    var settings = school.settings || {};
    var statusBadge = school.isActive
      ? '<span style="display:inline-flex; align-items:center; gap:3px; padding:2px 8px; background:#f0fdf4; color:#059669; border-radius:999px; font-size:10px; font-weight:700;">Aktif</span>'
      : '<span style="display:inline-flex; align-items:center; gap:3px; padding:2px 8px; background:#fef2f2; color:#dc2626; border-radius:999px; font-size:10px; font-weight:700;">Nonaktif</span>';
    var waStatus = settings.whatsapp_enabled
      ? '<span style="color:#059669; font-size:12px;"><i class="fa-solid fa-circle-check"></i> Aktif</span>'
      : '<span style="color:#94a3b8; font-size:12px;"><i class="fa-solid fa-circle-minus"></i> Nonaktif</span>';

    return '<tr style="border-bottom:1px solid #f1f5f9;">' +
      '<td style="padding:10px 16px; font-size:13px; color:#64748b;">' + (index + 1) + '</td>' +
      '<td style="padding:10px 16px; font-size:13px; font-weight:600; color:#1e293b;">' + school.schoolName + '</td>' +
      '<td style="padding:10px 16px;">' + statusBadge + '</td>' +
      '<td style="padding:10px 16px; text-align:center; font-weight:600;">' + (settings.total_siswa || 0) + '</td>' +
      '<td style="padding:10px 16px; text-align:center; font-weight:600;">' + (settings.total_guru || 0) + '</td>' +
      '<td style="padding:10px 16px; text-align:center; font-weight:600;">' + (settings.total_kelas || 0) + '</td>' +
      '<td style="padding:10px 16px; font-size:13px; color:#64748b;">' + (settings.tahun_ajaran || '-') + '</td>' +
      '<td style="padding:10px 16px;">' + waStatus + '</td>' +
    '</tr>';
  }).join('');
}

/**
 * Render configuration page with WhatsApp config form
 */
function renderConfigPage() {
  var container = document.getElementById('configContent');
  if (!container) return;

  var wc = masterAdmin ? masterAdmin.whatsappConfig : null;
  var waApiUrl = wc ? wc.api_url || '' : '';
  var waApiKey = wc ? wc.api_key || '' : '';
  var waTemplate = wc ? wc.template || (SMART_ABSEN_CONFIG.whatsapp.template || '') : (SMART_ABSEN_CONFIG.whatsapp.template || '');
  var waUpdated = wc ? (wc.updated_at ? formatDate(wc.updated_at) : '-') : '-';
  var waUpdatedBy = wc ? (wc.updated_by || '-') : '-';

  var isFirebaseReady = typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0;
  var firestoreStatus = isFirebaseReady ? '<span style="color:#059669;"><i class="fa-solid fa-circle-check"></i> Terhubung</span>' : '<span style="color:#dc2626;"><i class="fa-solid fa-circle-xmark"></i> Tidak terhubung</span>';
  var authStatus = isFirebaseReady ? '<span style="color:#059669;"><i class="fa-solid fa-circle-check"></i> Terhubung</span>' : '<span style="color:#dc2626;"><i class="fa-solid fa-circle-xmark"></i> Tidak terhubung</span>';

  container.innerHTML =
    // System Info Card
    '<div class="card" style="margin-bottom:20px;">' +
      '<div class="card-header">' +
        '<h3 class="card-title"><i class="fa-solid fa-circle-info" style="color:#3b82f6; margin-right:8px;"></i>Informasi Sistem</h3>' +
      '</div>' +
      '<div class="card-body">' +
        '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:16px;">' +
          '<div style="background:#f8fafc; border-radius:10px; padding:16px;">' +
            '<div style="font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Versi Aplikasi</div>' +
            '<div style="font-size:16px; font-weight:700; color:#0f172a;">Smart Absen Enterprise v' + (SMART_ABSEN_CONFIG.app.version || '2.0.0') + '</div>' +
          '</div>' +
          '<div style="background:#f8fafc; border-radius:10px; padding:16px;">' +
            '<div style="font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Firebase Auth</div>' +
            '<div style="font-size:14px; font-weight:600;">' + authStatus + '</div>' +
          '</div>' +
          '<div style="background:#f8fafc; border-radius:10px; padding:16px;">' +
            '<div style="font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Cloud Firestore</div>' +
            '<div style="font-size:14px; font-weight:600;">' + firestoreStatus + '</div>' +
          '</div>' +
          '<div style="background:#f8fafc; border-radius:10px; padding:16px;">' +
            '<div style="font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Total Sekolah</div>' +
            '<div style="font-size:16px; font-weight:700; color:#0f172a;">' + (masterAdmin ? masterAdmin.schools.length : 0) + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // WhatsApp Config Card
    '<div class="card" style="margin-bottom:20px;">' +
      '<div class="card-header">' +
        '<h3 class="card-title"><i class="fa-brands fa-whatsapp" style="color:#059669; margin-right:8px;"></i>Konfigurasi WhatsApp API</h3>' +
        '<span style="font-size:11px; padding:4px 10px; border-radius:999px; background:#f0fdf4; color:#059669; font-weight:600;">Terakhir diubah: ' + waUpdated + '</span>' +
      '</div>' +
      '<div class="card-body">' +
        '<p style="font-size:13px; color:#64748b; margin-bottom:20px;">Konfigurasi API WhatsApp untuk mengirim notifikasi absensi ke orang tua/wali siswa. Mendukung layanan seperti Fonnte, Wablas, dll.</p>' +
        '<form id="whatsappConfigForm" onsubmit="event.preventDefault(); handleSaveWhatsAppConfig();">' +
          '<div style="margin-bottom:16px;">' +
            '<label style="display:block; font-size:13px; font-weight:600; color:#374151; margin-bottom:6px;">API URL <span style="color:#dc2626;">*</span></label>' +
            '<input type="url" id="waApiUrl" class="form-input" placeholder="https://api.fonnte.com/send" value="' + waApiUrl.replace(/"/g, '&quot;') + '" required>' +
            '<p style="font-size:11px; color:#94a3b8; margin-top:4px;">URL endpoint API WhatsApp pihak ketiga</p>' +
          '</div>' +
          '<div style="margin-bottom:16px;">' +
            '<label style="display:block; font-size:13px; font-weight:600; color:#374151; margin-bottom:6px;">API Key <span style="color:#dc2626;">*</span></label>' +
            '<input type="text" id="waApiKey" class="form-input" placeholder="Masukkan API key" value="' + waApiKey.replace(/"/g, '&quot;') + '" required>' +
            '<p style="font-size:11px; color:#94a3b8; margin-top:4px;">Kunci API dari penyedia layanan WhatsApp</p>' +
          '</div>' +
          '<div style="margin-bottom:20px;">' +
            '<label style="display:block; font-size:13px; font-weight:600; color:#374151; margin-bottom:6px;">Template Pesan</label>' +
            '<textarea id="waTemplate" class="form-input" rows="6" placeholder="Template pesan WhatsApp..." style="resize:vertical;">' + waTemplate.replace(/</g, '&lt;') + '</textarea>' +
            '<p style="font-size:11px; color:#94a3b8; margin-top:4px;">Variabel: {nama_siswa}, {kelas}, {status}, {tanggal}, {waktu}, {nama_sekolah}</p>' +
          '</div>' +
          '<div style="display:flex; gap:10px; flex-wrap:wrap;">' +
            '<button type="submit" id="btnSaveWaConfig" class="btn btn-primary" style="font-size:13px;">' +
              '<i class="fa-solid fa-floppy-disk"></i> Simpan Konfigurasi' +
            '</button>' +
            '<button type="button" class="btn btn-secondary" style="font-size:13px;" onclick="openTestWhatsAppModal()">' +
              '<i class="fa-brands fa-whatsapp"></i> Kirim Pesan Tes' +
            '</button>' +
          '</div>' +
        '</form>' +
        (wc ? '<div style="margin-top:16px; padding:12px; background:#f0fdf4; border-radius:8px; font-size:12px; color:#059669;">' +
          '<i class="fa-solid fa-circle-check" style="margin-right:4px;"></i> Terakhir diperbarui oleh <strong>' + waUpdatedBy + '</strong>' +
        '</div>' : '') +
      '</div>' +
    '</div>' +

    // Global Settings Card
    '<div class="card" style="margin-bottom:20px;">' +
      '<div class="card-header">' +
        '<h3 class="card-title"><i class="fa-solid fa-sliders" style="color:#7c3aed; margin-right:8px;"></i>Pengaturan Global</h3>' +
      '</div>' +
      '<div class="card-body">' +
        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">' +
          '<div style="background:#f8fafc; border-radius:10px; padding:16px;">' +
            '<div style="font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Email Master Admin</div>' +
            '<div style="font-size:14px; font-weight:600; color:#0f172a; font-family:monospace;">' + (SMART_ABSEN_CONFIG.app.masterAdminEmail || '-') + '</div>' +
          '</div>' +
          '<div style="background:#f8fafc; border-radius:10px; padding:16px;">' +
            '<div style="font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Jam Operasional</div>' +
            '<div style="font-size:14px; font-weight:600; color:#0f172a;">' + (SMART_ABSEN_CONFIG.app.schoolHours.start || '07:00') + ' - ' + (SMART_ABSEN_CONFIG.app.schoolHours.end || '15:00') + ' WIB</div>' +
          '</div>' +
          '<div style="background:#f8fafc; border-radius:10px; padding:16px;">' +
            '<div style="font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Firebase Project ID</div>' +
            '<div style="font-size:14px; font-weight:600; color:#0f172a; font-family:monospace;">' + (SMART_ABSEN_CONFIG.firebase.projectId || '-') + '</div>' +
          '</div>' +
          '<div style="background:#f8fafc; border-radius:10px; padding:16px;">' +
            '<div style="font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Status Absensi</div>' +
            '<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:4px;">' +
              (SMART_ABSEN_CONFIG.app.attendanceStatuses || []).map(function(s) {
                return '<span style="font-size:11px; padding:3px 8px; border-radius:6px; background:' + s.color + '20; color:' + s.color + '; font-weight:600;">' + s.icon + ' ' + s.label + '</span>';
              }).join('') +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // Danger Zone Card
    '<div class="card">' +
      '<div class="card-header" style="border-bottom-color:#fecaca;">' +
        '<h3 class="card-title" style="color:#dc2626;"><i class="fa-solid fa-skull-crossbones" style="margin-right:8px;"></i>Zona Berbahaya</h3>' +
      '</div>' +
      '<div class="card-body">' +
        '<div style="background:#fef2f2; border:1px solid #fecaca; border-radius:10px; padding:16px;">' +
          '<p style="font-size:13px; font-weight:600; color:#991b1b; margin-bottom:8px;">Hapus Semua Riwayat Aktivitas</p>' +
          '<p style="font-size:13px; color:#64748b; margin-bottom:12px;">Menghapus semua catatan aktivitas yang tersimpan di perangkat ini.</p>' +
          '<button onclick="clearActivityLog()" class="btn btn-danger btn-sm" style="font-size:12px;">' +
            '<i class="fa-solid fa-trash"></i> Hapus Riwayat Aktivitas' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
}

// ==========================================
// ACCESS DENIED
// ==========================================

function showAccessDenied(userEmail, masterEmail) {
  var loginPage = document.getElementById('loginPage');
  var adminPanel = document.getElementById('adminPanel');

  if (loginPage) {
    loginPage.innerHTML =
      '<div class="login-page">' +
        '<div class="login-card animate-fade-in">' +
          '<div class="login-logo" style="font-size:48px;">&#128737;&#65039;</div>' +
          '<h1 class="login-title">Akses Ditolak</h1>' +
          '<p style="color:#dc2626; font-weight:600; margin-bottom:16px;">Anda tidak memiliki akses admin master</p>' +
          '<div style="background:#f8fafc; border-radius:12px; padding:16px; margin-bottom:24px; text-align:left; font-size:14px;">' +
            '<div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">' +
              '<i class="fa-solid fa-user" style="color:#94a3b8;"></i>' +
              '<span style="color:#64748b;">Email Anda:</span>' +
              '<span style="font-family:monospace; color:#1e293b; font-weight:600;">' + (userEmail || '-') + '</span>' +
            '</div>' +
            '<div style="display:flex; align-items:center; gap:8px;">' +
              '<i class="fa-solid fa-key" style="color:#94a3b8;"></i>' +
              '<span style="color:#64748b;">Email Master Admin:</span>' +
              '<span style="font-family:monospace; color:#1e293b; font-weight:600;">' + (masterEmail || '-') + '</span>' +
            '</div>' +
          '</div>' +
          '<p style="font-size:13px; color:#64748b; margin-bottom:24px;">Panel ini hanya dapat diakses oleh akun yang terdaftar sebagai Master Admin.</p>' +
          '<button onclick="location.reload()" style="width:100%; padding:14px; border-radius:12px; border:none; background:#0f172a; color:white; font-size:15px; font-weight:600; cursor:pointer;"><i class="fa-solid fa-arrow-left" style="margin-right:8px;"></i>Kembali ke Login</button>' +
        '</div>' +
      '</div>';
  }
  if (adminPanel) adminPanel.classList.remove('active');
}

// ==========================================
// GLOBAL INSTANCE
// ==========================================
var masterAdmin = new MasterAdminService();
