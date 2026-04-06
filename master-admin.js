/**
 * ============================================================
 *  SMART ABSEN ENTERPRISE v2.0 — MASTER ADMIN SERVICE
 * ============================================================
 *  Panel admin master untuk mengelola semua sekolah terdaftar.
 *  Hanya email yang terdaftar sebagai masterAdminEmail yang
 *  dapat mengakses panel ini.
 * ============================================================
 */

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
  }

  // ────────────────────────────────
  // INITIALIZATION
  // ────────────────────────────────

  async init() {
    try {
      this.showLoading('Memulai sistem...');

      // 1. Validate config
      if (typeof isConfigReady === 'function' && !isConfigReady()) {
        const errors = typeof validateConfig === 'function' ? validateConfig() : [];
        throw new Error('Konfigurasi belum lengkap:\n' + errors.join('\n'));
      }

      // 2. Initialize Firebase
      if (typeof initFirebase === 'function') {
        await initFirebase();
      }
      this.db = firebase.firestore();

      // 3. Check authentication state
      const authUser = await this.checkAuth();
      if (!authUser) {
        this.hideLoading();
        this.showLoginPage();
        return;
      }

      // 4. Check master admin access
      const masterEmail = SMART_ABSEN_CONFIG.app.masterAdminEmail;
      if (authUser.email.toLowerCase() !== masterEmail.toLowerCase()) {
        this.hideLoading();
        showAccessDenied(authUser.email, masterEmail);
        return;
      }

      // Store current user
      this.currentUser = {
        uid: authUser.uid,
        email: authUser.email,
        name: authUser.displayName || authUser.email,
        photoURL: authUser.photoURL || null,
      };
      localStorage.setItem('smart_absen_admin_user', JSON.stringify(this.currentUser));

      // 5. Initialize Google API
      if (typeof initGoogleAPI === 'function') {
        try {
          await initGoogleAPI();
        } catch (e) {
          console.warn('Google API init skipped:', e.message);
        }
      }

      // 6. Load schools
      await this.loadSchools();

      // 7. Calculate global stats
      await this.calculateGlobalStats();

      // 8. Show dashboard
      this.isInitialized = true;
      this.hideLoading();
      this.showAdminPanel();

    } catch (error) {
      console.error('Init error:', error);
      this.hideLoading();
      showToast('Gagal memuat: ' + error.message, 'error');
    }
  }

  // ────────────────────────────────
  // AUTHENTICATION
  // ────────────────────────────────

  async checkAuth() {
    return new Promise((resolve, reject) => {
      const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
        unsubscribe();
        resolve(user);
      });
    });
  }

  async signInWithGoogle() {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.addScope('profile');
      provider.addScope('email');
      const result = await firebase.auth().signInWithPopup(provider);
      return result.user;
    } catch (error) {
      if (error.code === 'auth/popup-closed-by-user') {
        showToast('Login dibatalkan', 'warning');
      } else {
        showToast('Gagal login: ' + error.message, 'error');
      }
      return null;
    }
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
      const snapshot = await this.db.collection('schools').orderBy('schoolName', 'asc').get();
      this.schools = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        this.schools.push({
          id: doc.id,
          schoolId: data.schoolId || doc.id,
          schoolName: data.schoolName || 'Tanpa Nama',
          schoolAddress: data.schoolAddress || '-',
          email: data.email || '-',
          sheetId: data.sheetId || '',
          folderId: data.folderId || '',
          spreadsheetUrl: data.spreadsheetUrl || '',
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          isActive: data.isActive !== false,
          settings: data.settings || {},
        });
      });
      this.applyFiltersAndSort();
      this.hideLoading();
      return this.schools;
    } catch (error) {
      this.hideLoading();
      console.error('Load schools error:', error);
      showToast('Gagal memuat data sekolah', 'error');
      return [];
    }
  }

  async getSchool(schoolId) {
    try {
      const doc = await this.db.collection('schools').doc(schoolId).get();
      if (!doc.exists) throw new Error('Sekolah tidak ditemukan');
      const data = doc.data();
      return {
        id: doc.id,
        schoolId: data.schoolId || doc.id,
        schoolName: data.schoolName || 'Tanpa Nama',
        schoolAddress: data.schoolAddress || '-',
        email: data.email || '-',
        sheetId: data.sheetId || '',
        folderId: data.folderId || '',
        spreadsheetUrl: data.spreadsheetUrl || '',
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
      await this.db.collection('schools').doc(schoolId).update(data);
      // Update local data
      const idx = this.schools.findIndex((s) => s.id === schoolId);
      if (idx >= 0) {
        this.schools[idx] = { ...this.schools[idx], ...data };
      }
      this.addActivityLog('update', `Memperbarui data sekolah: ${this.schools[idx]?.schoolName || schoolId}`);
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
      const school = this.schools.find((s) => s.id === schoolId);
      if (!school) return;
      const newStatus = !school.isActive;
      const confirmMsg = newStatus
        ? `Aktifkan sekolah "${school.schoolName}"?\nSekolah akan dapat mengakses sistem kembali.`
        : `Nonaktifkan sekolah "${school.schoolName}"?\nSekolah tidak akan dapat mengakses sistem.`;

      if (!confirm(confirmMsg)) return;

      await this.db.collection('schools').doc(schoolId).update({
        isActive: newStatus,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      school.isActive = newStatus;
      this.addActivityLog(newStatus ? 'activate' : 'deactivate', `${newStatus ? 'Mengaktifkan' : 'Menonaktifkan'} sekolah: ${school.schoolName}`);
      showToast(`Sekolah ${newStatus ? 'diaktifkan' : 'dinonaktifkan'}`);
      this.applyFiltersAndSort();
      return true;
    } catch (error) {
      showToast('Gagal mengubah status: ' + error.message, 'error');
      return false;
    }
  }

  async deleteSchool(schoolId) {
    try {
      const school = this.schools.find((s) => s.id === schoolId);
      if (!school) return;

      showModal('Konfirmasi Hapus', `
        <div class="text-center">
          <div class="text-5xl mb-4">⚠️</div>
          <p class="text-lg font-semibold text-red-600 mb-2">Hapus Sekolah?</p>
          <p class="text-slate-600 mb-1"><strong>${school.schoolName}</strong></p>
          <p class="text-slate-500 text-sm mb-4">Email: ${school.email}</p>
          <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700 mb-4">
            <i class="fa-solid fa-triangle-exclamation mr-1"></i>
            Tindakan ini akan menonaktifkan sekolah dari sistem. Data absensi tidak akan dihapus.
          </div>
          <div class="flex gap-3 justify-center">
            <button onclick="closeMasterModal()" class="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 rounded-lg font-semibold text-sm transition">Batal</button>
            <button onclick="masterAdmin.confirmDeleteSchool('${schoolId}')" class="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold text-sm transition">Ya, Hapus</button>
          </div>
        </div>
      `);
    } catch (error) {
      showToast('Gagal menghapus: ' + error.message, 'error');
    }
  }

  async confirmDeleteSchool(schoolId) {
    try {
      closeMasterModal();
      const school = this.schools.find((s) => s.id === schoolId);
      await this.db.collection('schools').doc(schoolId).update({
        isActive: false,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      if (school) {
        school.isActive = false;
        this.addActivityLog('delete', `Menonaktifkan sekolah: ${school.schoolName}`);
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
      const settings = school.settings || {};
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
      const school = await this.getSchool(schoolId);
      if (!school || !school.sheetId) {
        return {
          totalSiswa: school?.settings?.total_siswa || 0,
          totalGuru: school?.settings?.total_guru || 0,
          totalKelas: school?.settings?.total_kelas || 0,
          todayAttendance: null,
        };
      }

      // Try to read from Google Sheets API
      if (typeof gapi !== 'undefined' && gapi.client && gapi.client.sheets) {
        try {
          const sheetsConfig = SMART_ABSEN_CONFIG.sheets.structure;
          let totalSiswa = 0, totalGuru = 0, totalKelas = 0;

          // Read Siswa sheet
          const siswaRes = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: school.sheetId,
            range: 'Siswa!A2:A',
          });
          totalSiswa = (siswaRes.result.values || []).length;

          // Read Guru sheet
          const guruRes = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: school.sheetId,
            range: 'Guru!A2:A',
          });
          totalGuru = (guruRes.result.values || []).length;

          // Read Kelas sheet
          const kelasRes = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: school.sheetId,
            range: 'Kelas!A2:A',
          });
          totalKelas = (kelasRes.result.values || []).length;

          // Read today's attendance
          const today = new Date().toISOString().split('T')[0];
          let todayAttendance = null;
          try {
            const absenRes = await gapi.client.sheets.spreadsheets.values.get({
              spreadsheetId: school.sheetId,
              range: 'Absensi!A2:A',
            });
            todayAttendance = (absenRes.result.values || []).length;
          } catch (e) {
            todayAttendance = null;
          }

          // Update school settings in Firestore
          await this.db.collection('schools').doc(schoolId).update({
            'settings.total_siswa': totalSiswa,
            'settings.total_guru': totalGuru,
            'settings.total_kelas': totalKelas,
          });

          return { totalSiswa, totalGuru, totalKelas, todayAttendance };
        } catch (e) {
          console.warn('Sheet read error for', schoolId, e);
        }
      }

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

  async getSchoolAttendanceHistory(schoolId, days = 7) {
    try {
      const school = await this.getSchool(schoolId);
      if (!school || !school.sheetId) return [];

      if (typeof gapi === 'undefined' || !gapi.client || !gapi.client.sheets) {
        return [];
      }

      try {
        const absenRes = await gapi.client.sheets.spreadsheets.values.get({
          spreadsheetId: school.sheetId,
          range: 'Absensi!A1:J',
        });
        const rows = absenRes.result.values || [];
        if (rows.length <= 1) return [];

        // Find column indexes from header
        const header = rows[0];
        const dateIdx = header.indexOf('Tanggal');
        const statusIdx = header.indexOf('Status');
        if (dateIdx === -1 || statusIdx === -1) return [];

        const history = [];
        const dateMap = {};
        const today = new Date();

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const date = row[dateIdx];
          if (!date) continue;

          if (!dateMap[date]) {
            dateMap[date] = { date, hadir: 0, sakit: 0, izin: 0, alpha: 0, terlambat: 0 };
          }
          const status = (row[statusIdx] || '').toString().toUpperCase().charAt(0);
          if (status === 'H') dateMap[date].hadir++;
          else if (status === 'S') dateMap[date].sakit++;
          else if (status === 'I') dateMap[date].izin++;
          else if (status === 'A') dateMap[date].alpha++;
          else if (status === 'T') dateMap[date].terlambat++;
          else dateMap[date].hadir++; // Default to hadir
        }

        // Sort by date descending and take last N days
        const sortedDates = Object.values(dateMap).sort((a, b) => b.date.localeCompare(a.date));
        return sortedDates.slice(0, days);
      } catch (e) {
        console.warn('Attendance history error:', e);
        return [];
      }
    } catch (error) {
      console.error('Attendance history error:', error);
      return [];
    }
  }

  // ────────────────────────────────
  // SCHOOL ACTIONS
  // ────────────────────────────────

  async openSchoolSheet(schoolId) {
    try {
      const school = await this.getSchool(schoolId);
      if (school.spreadsheetUrl) {
        window.open(school.spreadsheetUrl, '_blank');
      } else if (school.sheetId) {
        window.open(`https://docs.google.com/spreadsheets/d/${school.sheetId}/edit`, '_blank');
      } else {
        showToast('Sekolah belum memiliki spreadsheet', 'warning');
      }
    } catch (error) {
      showToast('Gagal membuka spreadsheet: ' + error.message, 'error');
    }
  }

  async viewSchoolData(schoolId) {
    try {
      const school = await this.getSchool(schoolId);

      showModal('Data Sekolah: ' + school.schoolName, `
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div class="bg-slate-50 rounded-lg p-3">
              <div class="text-slate-500 text-xs mb-1">Email Admin</div>
              <div class="font-semibold">${school.email}</div>
            </div>
            <div class="bg-slate-50 rounded-lg p-3">
              <div class="text-slate-500 text-xs mb-1">Status</div>
              <div class="font-semibold">${school.isActive ? '<span class="text-green-600">● Aktif</span>' : '<span class="text-red-500">● Nonaktif</span>'}</div>
            </div>
            <div class="bg-slate-50 rounded-lg p-3">
              <div class="text-slate-500 text-xs mb-1">Total Siswa</div>
              <div class="font-semibold text-lg">${school.settings.total_siswa || 0}</div>
            </div>
            <div class="bg-slate-50 rounded-lg p-3">
              <div class="text-slate-500 text-xs mb-1">Total Guru</div>
              <div class="font-semibold text-lg">${school.settings.total_guru || 0}</div>
            </div>
            <div class="bg-slate-50 rounded-lg p-3">
              <div class="text-slate-500 text-xs mb-1">Total Kelas</div>
              <div class="font-semibold text-lg">${school.settings.total_kelas || 0}</div>
            </div>
            <div class="bg-slate-50 rounded-lg p-3">
              <div class="text-slate-500 text-xs mb-1">Tahun Ajaran</div>
              <div class="font-semibold">${school.settings.tahun_ajaran || '-'}</div>
            </div>
          </div>
          <div class="bg-blue-50 rounded-lg p-3">
            <div class="text-slate-500 text-xs mb-1">Alamat</div>
            <div class="font-semibold">${school.schoolAddress || '-'}</div>
          </div>
          <div class="bg-slate-50 rounded-lg p-3">
            <div class="text-slate-500 text-xs mb-1">Terdaftar Sejak</div>
            <div class="font-semibold">${school.createdAt ? formatDate(school.createdAt.toDate ? school.createdAt.toDate() : school.createdAt) : '-'}</div>
          </div>
          <div class="bg-slate-50 rounded-lg p-3">
            <div class="text-slate-500 text-xs mb-1">Terakhir Diperbarui</div>
            <div class="font-semibold">${school.updatedAt ? formatDate(school.updatedAt.toDate ? school.updatedAt.toDate() : school.updatedAt) : '-'}</div>
          </div>
          <div id="schoolAttendanceChart-${schoolId}" class="mt-4"></div>
          <div class="flex gap-3 justify-end mt-4">
            <button onclick="closeMasterModal()" class="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 rounded-lg font-semibold text-sm transition">Tutup</button>
            ${school.spreadsheetUrl ? `<a href="${school.spreadsheetUrl}" target="_blank" class="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-sm transition inline-flex items-center gap-2"><i class="fa-solid fa-table"></i> Buka Spreadsheet</a>` : ''}
          </div>
        </div>
      `);

      // Load attendance chart for this school
      const history = await this.getSchoolAttendanceHistory(schoolId, 7);
      if (history.length > 0) {
        const chartEl = document.getElementById('schoolAttendanceChart-' + schoolId);
        if (chartEl) {
          chartEl.innerHTML = renderAttendanceChart(history);
        }
      }
    } catch (error) {
      showToast('Gagal memuat data: ' + error.message, 'error');
    }
  }

  async resetSchoolData(schoolId) {
    try {
      const school = await this.getSchool(schoolId);
      if (!school) return;

      showModal('⚠️ Reset Data Sekolah', `
        <div class="space-y-4">
          <div class="text-center">
            <div class="text-5xl mb-4">🚨</div>
            <p class="text-lg font-semibold text-red-600">Peringatan: Tindakan Berbahaya!</p>
          </div>
          <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            <p class="font-semibold mb-2">Anda akan menghapus SEMUA data di sekolah:</p>
            <p class="font-bold">${school.schoolName}</p>
            <ul class="mt-2 list-disc list-inside space-y-1">
              <li>Semua data siswa akan dihapus</li>
              <li>Semua data guru akan dihapus</li>
              <li>Semua data kelas akan dihapus</li>
              <li>Semua data absensi akan dihapus</li>
              <li>Pengaturan akan dikembalikan ke default</li>
            </ul>
          </div>
          <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
            <i class="fa-solid fa-triangle-exclamation mr-1"></i>
            Tindakan ini <strong>TIDAK DAPAT dibatalkan</strong>.
          </div>
          <div class="flex gap-3 justify-center">
            <button onclick="closeMasterModal()" class="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 rounded-lg font-semibold text-sm transition">Batal</button>
            <button onclick="closeMasterModal(); masterAdmin.executeReset('${schoolId}')" class="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold text-sm transition">
              <i class="fa-solid fa-trash mr-1"></i> Ya, Hapus Semua Data
            </button>
          </div>
        </div>
      `);
    } catch (error) {
      showToast('Gagal: ' + error.message, 'error');
    }
  }

  async executeReset(schoolId) {
    try {
      if (!confirm('PERHATIAN!\n\nAnda yakin ingin menghapus semua data sekolah ini?\nTindakan ini TIDAK DAPAT dibatalkan!')) return;
      if (!confirm('Konfirmasi sekali lagi: HAPUS SEMUA DATA?')) return;

      const school = await this.getSchool(schoolId);
      if (!school || !school.sheetId) {
        showToast('School tidak memiliki spreadsheet', 'error');
        return;
      }

      if (typeof gapi !== 'undefined' && gapi.client && gapi.client.sheets) {
        const spreadsheetId = school.sheetId;
        const sheetsConfig = SMART_ABSEN_CONFIG.sheets.structure;

        // Clear each sheet except Pengaturan
        for (const sheetName of Object.keys(sheetsConfig)) {
          if (sheetName === 'Pengaturan') continue;
          try {
            await gapi.client.sheets.spreadsheets.values.clear({
              spreadsheetId: spreadsheetId,
              range: sheetName + '!A2:ZZ',
            });
          } catch (e) {
            console.warn('Failed to clear sheet:', sheetName, e);
          }
        }

        // Reset Pengaturan
        try {
          await gapi.client.sheets.spreadsheets.values.clear({
            spreadsheetId: spreadsheetId,
            range: 'Pengaturan!A2:ZZ',
          });
          const defaultSettings = [
            ['tahun_ajaran', '2025/2026', 'Tahun ajaran aktif'],
            ['whatsapp_enabled', 'false', 'Status WhatsApp notifikasi'],
            ['school_start', '07:00', 'Jam mulai sekolah'],
            ['school_end', '15:00', 'Jam selesai sekolah'],
          ];
          await gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId: spreadsheetId,
            range: 'Pengaturan!A2',
            valueInputOption: 'USER_ENTERED',
            resource: { values: defaultSettings },
          });
        } catch (e) {
          console.warn('Failed to reset Pengaturan:', e);
        }

        // Update Firestore
        await this.db.collection('schools').doc(schoolId).update({
          'settings.total_siswa': 0,
          'settings.total_guru': 0,
          'settings.total_kelas': 0,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });

        this.addActivityLog('reset', `Reset semua data sekolah: ${school.schoolName}`);
        showToast('Data sekolah berhasil direset');
        await this.loadSchools();
        await this.calculateGlobalStats();
        this.refreshUI();
      } else {
        showToast('Google Sheets API tidak tersedia', 'error');
      }
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
    this.currentSort = { field, direction: direction || 'asc' };
    this.applyFiltersAndSort();
    return this.filteredSchools;
  }

  applyFiltersAndSort() {
    let result = [...this.schools];

    // Apply search
    if (this.searchQuery) {
      result = result.filter(
        (s) =>
          s.schoolName.toLowerCase().includes(this.searchQuery) ||
          s.email.toLowerCase().includes(this.searchQuery) ||
          s.schoolAddress.toLowerCase().includes(this.searchQuery)
      );
    }

    // Apply filter
    if (this.currentFilter === 'active') {
      result = result.filter((s) => s.isActive);
    } else if (this.currentFilter === 'inactive') {
      result = result.filter((s) => !s.isActive);
    }

    // Apply sort
    result.sort((a, b) => {
      let valA, valB;
      switch (this.currentSort.field) {
        case 'schoolName':
          valA = a.schoolName.toLowerCase();
          valB = b.schoolName.toLowerCase();
          break;
        case 'email':
          valA = a.email.toLowerCase();
          valB = b.email.toLowerCase();
          break;
        case 'totalStudents':
          valA = a.settings.total_siswa || 0;
          valB = b.settings.total_siswa || 0;
          break;
        case 'createdAt':
          valA = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : new Date(0);
          valB = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date(0);
          break;
        default:
          valA = a.schoolName.toLowerCase();
          valB = b.schoolName.toLowerCase();
      }
      if (valA < valB) return this.currentSort.direction === 'asc' ? -1 : 1;
      if (valA > valB) return this.currentSort.direction === 'asc' ? 1 : -1;
      return 0;
    });

    this.filteredSchools = result;
  }

  // ────────────────────────────────
  // REGISTRATION
  // ────────────────────────────────

  async addManualSchool(schoolData) {
    try {
      const { schoolName, email, address } = schoolData;
      if (!schoolName || !email) {
        showToast('Nama sekolah dan email wajib diisi', 'error');
        return false;
      }

      // Check for duplicate email
      const existing = this.schools.find((s) => s.email.toLowerCase() === email.toLowerCase());
      if (existing) {
        showToast('Email sudah terdaftar untuk sekolah lain', 'error');
        return false;
      }

      const schoolId = generateId ? generateId() : Date.now().toString(36) + Math.random().toString(36).substr(2, 9);

      const schoolDoc = {
        schoolId: schoolId,
        schoolName: schoolName,
        schoolAddress: address || '',
        email: email,
        sheetId: '',
        folderId: '',
        spreadsheetUrl: '',
        isActive: true,
        settings: {
          tahun_ajaran: SMART_ABSEN_CONFIG.app.schoolHours ? '2025/2026' : '2025/2026',
          whatsapp_enabled: false,
          school_hours: { start: '07:00', end: '15:00' },
          total_siswa: 0,
          total_guru: 0,
          total_kelas: 0,
        },
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };

      await this.db.collection('schools').doc(schoolId).set(schoolDoc);

      this.schools.push({
        id: schoolId,
        ...schoolDoc,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      this.applyFiltersAndSort();
      await this.calculateGlobalStats();
      this.addActivityLog('add', `Menambahkan sekolah baru: ${schoolName}`);
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
      const baseUrl = window.location.origin + window.location.pathname.replace('master-admin.html', '');
      const invitationLink = `${baseUrl}?ref=${encodeURIComponent(email)}&school=${encodeURIComponent(schoolName)}`;

      // Store invitation in Firestore
      const invitationId = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
      await this.db.collection('invitations').doc(invitationId).set({
        email: email,
        schoolName: schoolName,
        link: invitationLink,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        status: 'sent',
        sentBy: this.currentUser.email,
      });

      this.addActivityLog('invite', `Mengirim undangan ke ${email} (${schoolName})`);

      // Show the invitation link
      showModal('Undangan Terkirim', `
        <div class="space-y-4">
          <div class="text-center">
            <div class="text-5xl mb-3">📧</div>
            <p class="text-lg font-semibold text-green-600">Undangan berhasil dibuat!</p>
          </div>
          <div class="bg-slate-50 rounded-lg p-4">
            <div class="text-sm text-slate-500 mb-2">Kirim link berikut ke <strong>${email}</strong>:</div>
            <div class="bg-white border rounded-lg p-3 text-sm font-mono break-all text-blue-600 select-all">${invitationLink}</div>
          </div>
          <div class="flex gap-3 justify-center">
            <button onclick="navigator.clipboard.writeText('${invitationLink}').then(()=>showToast('Link disalin!'));closeMasterModal()" class="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm transition">
              <i class="fa-solid fa-copy mr-1"></i> Salin Link
            </button>
            <button onclick="closeMasterModal()" class="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 rounded-lg font-semibold text-sm transition">Tutup</button>
          </div>
        </div>
      `);

      // WhatsApp share option
      const waMessage = `Halo, Anda diundang untuk mendaftarkan sekolah "${schoolName}" di Smart Absen Enterprise.\n\nLink pendaftaran:\n${invitationLink}`;
      const waUrl = `https://wa.me/?text=${encodeURIComponent(waMessage)}`;

      showModal('Undangan Terkirim', `
        <div class="space-y-4">
          <div class="text-center">
            <div class="text-5xl mb-3">📧</div>
            <p class="text-lg font-semibold text-green-600">Undangan berhasil dibuat!</p>
          </div>
          <div class="bg-slate-50 rounded-lg p-4">
            <div class="text-sm text-slate-500 mb-2">Kirim link berikut ke <strong>${email}</strong>:</div>
            <div class="bg-white border rounded-lg p-3 text-sm font-mono break-all text-blue-600 select-all">${invitationLink}</div>
          </div>
          <div class="flex gap-3 justify-center flex-wrap">
            <button onclick="navigator.clipboard.writeText('${invitationLink}').then(()=>showToast('Link disalin!'))" class="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm transition">
              <i class="fa-solid fa-copy mr-1"></i> Salin Link
            </button>
            <a href="${waUrl}" target="_blank" class="px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-sm transition inline-flex items-center gap-1">
              <i class="fa-brands fa-whatsapp"></i> Kirim via WhatsApp
            </a>
            <a href="mailto:${email}?subject=Undangan Smart Absen Enterprise&body=${encodeURIComponent(waMessage)}" class="px-4 py-2.5 bg-slate-600 hover:bg-slate-700 text-white rounded-lg font-semibold text-sm transition inline-flex items-center gap-1">
              <i class="fa-solid fa-envelope"></i> Kirim Email
            </a>
          </div>
          <div class="flex justify-center">
            <button onclick="closeMasterModal()" class="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 rounded-lg font-semibold text-sm transition">Tutup</button>
          </div>
        </div>
      `);
    } catch (error) {
      showToast('Gagal mengirim undangan: ' + error.message, 'error');
    }
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
    // Keep only last 50 entries
    if (this.activityLog.length > 50) {
      this.activityLog = this.activityLog.slice(0, 50);
    }
    // Save to localStorage
    try {
      localStorage.setItem('master_admin_activity_log', JSON.stringify(this.activityLog));
    } catch (e) {
      // ignore
    }
  }

  loadActivityLog() {
    try {
      const saved = localStorage.getItem('master_admin_activity_log');
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
    const el = document.getElementById('globalLoading');
    if (el) {
      const msgEl = el.querySelector('.loading-message');
      if (msgEl) msgEl.textContent = message || 'Memuat...';
      el.classList.remove('hidden');
      el.classList.add('flex');
    }
  }

  hideLoading() {
    const el = document.getElementById('globalLoading');
    if (el) {
      el.classList.add('hidden');
      el.classList.remove('flex');
    }
  }

  showLoginPage() {
    const loginPage = document.getElementById('loginPage');
    const adminPanel = document.getElementById('adminPanel');
    if (loginPage) loginPage.classList.remove('hidden');
    if (adminPanel) adminPanel.classList.add('hidden');
  }

  showAdminPanel() {
    const loginPage = document.getElementById('loginPage');
    const adminPanel = document.getElementById('adminPanel');
    if (loginPage) loginPage.classList.add('hidden');
    if (adminPanel) adminPanel.classList.remove('hidden');
    this.refreshUI();
  }

  refreshUI() {
    renderStatsCards(this.stats);
    renderSchoolsTable(this.filteredSchools);
    renderActivityFeed(this.activityLog.slice(0, 10));
    updateHeaderInfo(this.currentUser);
  }
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Show access denied message
 */
function showAccessDenied(userEmail, masterEmail) {
  const loginPage = document.getElementById('loginPage');
  const adminPanel = document.getElementById('adminPanel');

  if (loginPage) {
    loginPage.innerHTML = `
      <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
        <div class="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center">
          <div class="text-6xl mb-4">🛡️</div>
          <h1 class="text-2xl font-bold text-slate-800 mb-2">Akses Ditolak</h1>
          <p class="text-red-600 font-semibold mb-4">Anda tidak memiliki akses admin master</p>
          <div class="bg-slate-50 rounded-xl p-4 mb-6 text-sm text-left">
            <div class="flex items-center gap-2 mb-2">
              <i class="fa-solid fa-user text-slate-400"></i>
              <span class="text-slate-500">Email Anda:</span>
              <span class="font-mono text-slate-700">${userEmail || '-'}</span>
            </div>
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-key text-slate-400"></i>
              <span class="text-slate-500">Email Master Admin:</span>
              <span class="font-mono text-slate-700">${masterEmail || '-'}</span>
            </div>
          </div>
          <p class="text-slate-500 text-sm mb-6">
            Panel ini hanya dapat diakses oleh akun yang terdaftar sebagai Master Admin.
            Jika Anda merasa ini adalah kesalahan, silakan hubungi administrator sistem.
          </p>
          <button onclick="masterAdmin.signOut()" class="w-full py-3 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-semibold transition">
            <i class="fa-solid fa-arrow-left mr-2"></i>Kembali ke Login
          </button>
        </div>
      </div>
    `;
  }
  if (adminPanel) adminPanel.classList.add('hidden');
}

/**
 * Generate schools table HTML
 */
function renderSchoolsTable(schools) {
  const container = document.getElementById('schoolsTableBody');
  if (!container) return;

  if (!schools || schools.length === 0) {
    container.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-12 text-slate-400">
          <i class="fa-solid fa-school text-4xl mb-3 block"></i>
          <p class="text-lg font-semibold">Tidak ada sekolah ditemukan</p>
          <p class="text-sm mt-1">${masterAdmin && masterAdmin.searchQuery ? 'Coba ubah kata kunci pencarian' : 'Belum ada sekolah yang terdaftar'}</p>
        </td>
      </tr>
    `;
    const countEl = document.getElementById('schoolsCount');
    if (countEl) countEl.textContent = '0 sekolah';
    return;
  }

  const countEl = document.getElementById('schoolsCount');
  if (countEl) countEl.textContent = schools.length + ' sekolah';

  container.innerHTML = schools.map((school, index) => {
    const settings = school.settings || {};
    const createdDate = school.createdAt
      ? formatDate(school.createdAt.toDate ? school.createdAt.toDate() : school.createdAt)
      : '-';
    const statusBadge = school.isActive
      ? '<span class="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold"><span class="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>Aktif</span>'
      : '<span class="inline-flex items-center gap-1 px-2.5 py-1 bg-red-50 text-red-600 rounded-full text-xs font-bold"><span class="w-1.5 h-1.5 bg-red-500 rounded-full"></span>Nonaktif</span>';
    const sheetLink = school.spreadsheetUrl || (school.sheetId ? `https://docs.google.com/spreadsheets/d/${school.sheetId}` : '');

    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
        <td class="px-4 py-3.5">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
              ${(index + 1).toString().padStart(2, '0')}
            </div>
            <div>
              <div class="font-semibold text-slate-800 text-sm">${escapeHtml(school.schoolName)}</div>
              <div class="text-xs text-slate-500">${escapeHtml(school.email)}</div>
            </div>
          </div>
        </td>
        <td class="px-4 py-3.5 text-sm text-slate-600 max-w-[200px] truncate">${escapeHtml(school.schoolAddress)}</td>
        <td class="px-4 py-3.5">${statusBadge}</td>
        <td class="px-4 py-3.5 text-center text-sm font-semibold text-slate-700">${settings.total_siswa || 0}</td>
        <td class="px-4 py-3.5 text-center text-sm font-semibold text-slate-700">${settings.total_guru || 0}</td>
        <td class="px-4 py-3.5 text-center text-sm font-semibold text-slate-700">${settings.total_kelas || 0}</td>
        <td class="px-4 py-3.5 text-xs text-slate-500">${createdDate}</td>
        <td class="px-4 py-3.5">
          <div class="flex items-center gap-1">
            <button onclick="masterAdmin.viewSchoolData('${school.id}')" class="p-2 hover:bg-blue-50 text-blue-600 rounded-lg transition" title="Lihat Detail">
              <i class="fa-solid fa-eye text-sm"></i>
            </button>
            ${sheetLink ? `
              <button onclick="masterAdmin.openSchoolSheet('${school.id}')" class="p-2 hover:bg-green-50 text-green-600 rounded-lg transition" title="Buka Spreadsheet">
                <i class="fa-solid fa-table text-sm"></i>
              </button>
            ` : ''}
            <button onclick="masterAdmin.toggleSchoolStatus('${school.id}')" class="p-2 hover:bg-amber-50 text-amber-600 rounded-lg transition" title="${school.isActive ? 'Nonaktifkan' : 'Aktifkan'}">
              <i class="fa-solid fa-${school.isActive ? 'toggle-on text-green-500' : 'toggle-off'} text-sm"></i>
            </button>
            <button onclick="masterAdmin.deleteSchool('${school.id}')" class="p-2 hover:bg-red-50 text-red-500 rounded-lg transition" title="Hapus">
              <i class="fa-solid fa-trash text-sm"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Generate statistics cards HTML
 */
function renderStatsCards(stats) {
  const cards = [
    {
      id: 'statSchools',
      icon: 'fa-school',
      label: 'Total Sekolah',
      value: stats.totalSchools,
      sub: `<span class="text-emerald-600">${stats.activeSchools} aktif</span> · <span class="text-red-500">${stats.inactiveSchools} nonaktif</span>`,
      color: 'from-blue-500 to-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      id: 'statStudents',
      icon: 'fa-user-graduate',
      label: 'Total Siswa Terdaftar',
      value: stats.totalStudents.toLocaleString('id-ID'),
      sub: 'Dari semua sekolah aktif',
      color: 'from-emerald-500 to-emerald-600',
      bgColor: 'bg-emerald-50',
    },
    {
      id: 'statTeachers',
      icon: 'fa-chalkboard-user',
      label: 'Total Guru',
      value: stats.totalTeachers.toLocaleString('id-ID'),
      sub: 'Dari semua sekolah aktif',
      color: 'from-purple-500 to-purple-600',
      bgColor: 'bg-purple-50',
    },
    {
      id: 'statAttendance',
      icon: 'fa-chart-line',
      label: 'Sekolah Aktif',
      value: stats.totalSchools > 0 ? stats.averageAttendance + '%' : '0%',
      sub: `${stats.activeSchools} dari ${stats.totalSchools} sekolah`,
      color: 'from-amber-500 to-amber-600',
      bgColor: 'bg-amber-50',
    },
  ];

  const container = document.getElementById('statsContainer');
  if (!container) return;

  container.innerHTML = cards.map((card) => `
    <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-5 hover:shadow-md transition-shadow">
      <div class="flex items-start justify-between mb-3">
        <div class="w-11 h-11 bg-gradient-to-br ${card.color} rounded-xl flex items-center justify-center shadow-lg">
          <i class="fa-solid ${card.icon} text-white text-lg"></i>
        </div>
        <span class="text-xs font-medium text-slate-400 uppercase tracking-wide">${card.label}</span>
      </div>
      <div class="text-3xl font-bold text-slate-800 mb-1" id="${card.id}Value">${card.value}</div>
      <div class="text-xs text-slate-500">${card.sub}</div>
    </div>
  `).join('');

  // Also update stats page
  const statsPageContainer = document.getElementById('statsPageContainer');
  if (statsPageContainer) {
    const extendedCards = [
      ...cards,
      {
        icon: 'fa-building-columns',
        label: 'Total Kelas',
        value: stats.totalClasses.toLocaleString('id-ID'),
        sub: 'Dari semua sekolah aktif',
        color: 'from-cyan-500 to-cyan-600',
      },
      {
        icon: 'fa-percent',
        label: 'Rata-rata Siswa/Sekolah',
        value: stats.activeSchools > 0 ? Math.round(stats.totalStudents / stats.activeSchools) : 0,
        sub: 'Per sekolah aktif',
        color: 'from-rose-500 to-rose-600',
      },
    ];

    statsPageContainer.innerHTML = extendedCards.map((card) => `
      <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-5 hover:shadow-md transition-shadow">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-11 h-11 bg-gradient-to-br ${card.color} rounded-xl flex items-center justify-center shadow-lg">
            <i class="fa-solid ${card.icon} text-white text-lg"></i>
          </div>
          <span class="text-xs font-medium text-slate-400 uppercase tracking-wide">${card.label}</span>
        </div>
        <div class="text-3xl font-bold text-slate-800 mb-1">${card.value}</div>
        <div class="text-xs text-slate-500">${card.sub}</div>
      </div>
    `).join('');
  }
}

/**
 * Generate attendance chart HTML (CSS bar chart)
 */
function renderAttendanceChart(history) {
  if (!history || history.length === 0) {
    return '<p class="text-slate-400 text-sm text-center py-4">Belum ada data absensi</p>';
  }

  const maxTotal = Math.max(...history.map((h) => h.hadir + h.sakit + h.izin + h.alpha + h.terlambat), 1);

  return `
    <div class="mt-4">
      <h4 class="text-sm font-semibold text-slate-700 mb-3">📊 Riwayat Kehadiran (7 Hari Terakhir)</h4>
      <div class="space-y-2">
        ${history.map((day) => {
          const total = day.hadir + day.sakit + day.izin + day.alpha + day.terlambat;
          const hadirPct = total > 0 ? Math.round((day.hadir / total) * 100) : 0;
          const hadirWidth = maxTotal > 0 ? Math.round((day.hadir / maxTotal) * 100) : 0;
          const sakitWidth = maxTotal > 0 ? Math.round((day.sakit / maxTotal) * 100) : 0;
          const izinWidth = maxTotal > 0 ? Math.round((day.izin / maxTotal) * 100) : 0;
          const alphaWidth = maxTotal > 0 ? Math.round((day.alpha / maxTotal) * 100) : 0;
          const terlambatWidth = maxTotal > 0 ? Math.round((day.terlambat / maxTotal) * 100) : 0;

          return `
            <div class="flex items-center gap-2">
              <div class="w-20 text-xs text-slate-500 flex-shrink-0 text-right font-mono">${day.date.slice(-5)}</div>
              <div class="flex-1 flex h-5 rounded overflow-hidden bg-slate-100">
                <div class="bg-emerald-400 transition-all" style="width: ${hadirWidth}%" title="Hadir: ${day.hadir}"></div>
                <div class="bg-amber-400 transition-all" style="width: ${sakitWidth}%" title="Sakit: ${day.sakit}"></div>
                <div class="bg-blue-400 transition-all" style="width: ${izinWidth}%" title="Izin: ${day.izin}"></div>
                <div class="bg-red-400 transition-all" style="width: ${alphaWidth}%" title="Alpha: ${day.alpha}"></div>
                <div class="bg-orange-400 transition-all" style="width: ${terlambatWidth}%" title="Terlambat: ${day.terlambat}"></div>
              </div>
              <div class="w-12 text-xs font-semibold text-slate-600 flex-shrink-0">${hadirPct}%</div>
              <div class="w-10 text-xs text-slate-400 flex-shrink-0">(${total})</div>
            </div>
          `;
        }).join('')}
      </div>
      <div class="flex gap-4 mt-3 text-xs text-slate-500 justify-center">
        <span><span class="inline-block w-3 h-3 bg-emerald-400 rounded mr-1"></span>Hadir</span>
        <span><span class="inline-block w-3 h-3 bg-amber-400 rounded mr-1"></span>Sakit</span>
        <span><span class="inline-block w-3 h-3 bg-blue-400 rounded mr-1"></span>Izin</span>
        <span><span class="inline-block w-3 h-3 bg-red-400 rounded mr-1"></span>Alpha</span>
        <span><span class="inline-block w-3 h-3 bg-orange-400 rounded mr-1"></span>Terlambat</span>
      </div>
    </div>
  `;
}

/**
 * Render activity feed
 */
function renderActivityFeed(activities) {
  const container = document.getElementById('activityFeed');
  if (!container) return;

  if (!activities || activities.length === 0) {
    container.innerHTML = '<p class="text-slate-400 text-sm text-center py-6">Belum ada aktivitas</p>';
    return;
  }

  const actionIcons = {
    add: { icon: 'fa-plus-circle', color: 'text-green-500', bg: 'bg-green-50' },
    update: { icon: 'fa-pen', color: 'text-blue-500', bg: 'bg-blue-50' },
    delete: { icon: 'fa-trash', color: 'text-red-500', bg: 'bg-red-50' },
    activate: { icon: 'fa-toggle-on', color: 'text-emerald-500', bg: 'bg-emerald-50' },
    deactivate: { icon: 'fa-toggle-off', color: 'text-slate-400', bg: 'bg-slate-50' },
    reset: { icon: 'fa-rotate', color: 'text-amber-500', bg: 'bg-amber-50' },
    invite: { icon: 'fa-envelope', color: 'text-purple-500', bg: 'bg-purple-50' },
  };

  container.innerHTML = activities.slice(0, 10).map((act) => {
    const cfg = actionIcons[act.action] || { icon: 'fa-circle-info', color: 'text-slate-400', bg: 'bg-slate-50' };
    const time = act.timestamp ? formatTime(new Date(act.timestamp)) : '';
    const date = act.timestamp ? formatDate(new Date(act.timestamp)) : '';

    return `
      <div class="flex items-start gap-3 py-2.5 border-b border-slate-50 last:border-0">
        <div class="w-8 h-8 ${cfg.bg} rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
          <i class="fa-solid ${cfg.icon} ${cfg.color} text-xs"></i>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm text-slate-700">${escapeHtml(act.description)}</p>
          <p class="text-xs text-slate-400 mt-0.5">${date} ${time}</p>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Update header user info
 */
function updateHeaderInfo(user) {
  if (!user) return;
  const nameEl = document.getElementById('headerUserName');
  const emailEl = document.getElementById('headerUserEmail');
  const photoEl = document.getElementById('headerUserPhoto');
  const avatarEl = document.getElementById('headerUserAvatar');

  if (nameEl) nameEl.textContent = user.name || user.email;
  if (emailEl) emailEl.textContent = user.email;
  if (photoEl && user.photoURL) {
    photoEl.src = user.photoURL;
    photoEl.classList.remove('hidden');
    if (avatarEl) avatarEl.classList.add('hidden');
  } else if (avatarEl && user.name) {
    avatarEl.textContent = user.name.charAt(0).toUpperCase();
    if (photoEl) photoEl.classList.add('hidden');
    avatarEl.classList.remove('hidden');
  }
}

/**
 * Export schools list to CSV
 */
function exportSchoolsList(schools) {
  if (!schools || schools.length === 0) {
    showToast('Tidak ada data untuk diekspor', 'warning');
    return;
  }

  const headers = ['No', 'Nama Sekolah', 'Email', 'Alamat', 'Status', 'Total Siswa', 'Total Guru', 'Total Kelas', 'Tahun Ajaran', 'Tanggal Daftar'];
  const rows = schools.map((school, i) => {
    const s = school.settings || {};
    const createdDate = school.createdAt
      ? formatDate(school.createdAt.toDate ? school.createdAt.toDate() : school.createdAt)
      : '-';
    return [
      i + 1,
      '"' + (school.schoolName || '').replace(/"/g, '""') + '"',
      school.email || '-',
      '"' + (school.schoolAddress || '').replace(/"/g, '""') + '"',
      school.isActive ? 'Aktif' : 'Nonaktif',
      s.total_siswa || 0,
      s.total_guru || 0,
      s.total_kelas || 0,
      s.tahun_ajaran || '-',
      createdDate,
    ].join(',');
  });

  const csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `data_sekolah_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast('Data berhasil diekspor ke CSV');
}

/**
 * Render recent registrations table (last 5 schools)
 */
function renderRecentRegistrations(schools) {
  const container = document.getElementById('recentRegistrations');
  if (!container) return;

  // Sort by createdAt descending, take last 5
  const sorted = [...schools]
    .sort((a, b) => {
      const dateA = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : new Date(0);
      const dateB = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date(0);
      return dateB - dateA;
    })
    .slice(0, 5);

  if (sorted.length === 0) {
    container.innerHTML = `
      <tr>
        <td colspan="4" class="text-center py-8 text-slate-400">
          <p class="text-sm">Belum ada sekolah terdaftar</p>
        </td>
      </tr>
    `;
    return;
  }

  container.innerHTML = sorted.map((school) => {
    const createdDate = school.createdAt
      ? formatDate(school.createdAt.toDate ? school.createdAt.toDate() : school.createdAt)
      : '-';
    const statusBadge = school.isActive
      ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold"><span class="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>Aktif</span>'
      : '<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-600 rounded-full text-xs font-bold"><span class="w-1.5 h-1.5 bg-red-500 rounded-full"></span>Nonaktif</span>';

    return `
      <tr class="border-b border-slate-50 hover:bg-slate-50/50 transition">
        <td class="px-4 py-3">
          <div class="font-semibold text-sm text-slate-800">${escapeHtml(school.schoolName)}</div>
          <div class="text-xs text-slate-500">${escapeHtml(school.email)}</div>
        </td>
        <td class="px-4 py-3">${statusBadge}</td>
        <td class="px-4 py-3 text-xs text-slate-500">${createdDate}</td>
        <td class="px-4 py-3">
          <button onclick="masterAdmin.viewSchoolData('${school.id}')" class="text-blue-600 hover:text-blue-800 text-xs font-semibold transition">
            <i class="fa-solid fa-eye mr-1"></i>Detail
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Render schools distribution for statistics page
 */
function renderSchoolsDistribution(schools) {
  const container = document.getElementById('schoolsDistribution');
  if (!container) return;

  if (!schools || schools.length === 0) {
    container.innerHTML = '<p class="text-slate-400 text-sm text-center py-4">Belum ada data</p>';
    return;
  }

  // By size
  const sizeGroups = { 'Kecil (<100)': 0, 'Sedang (100-500)': 0, 'Besar (500-1000)': 0, 'Sangat Besar (>1000)': 0 };
  schools.forEach((s) => {
    const total = s.settings.total_siswa || 0;
    if (total < 100) sizeGroups['Kecil (<100)']++;
    else if (total < 500) sizeGroups['Sedang (100-500)']++;
    else if (total < 1000) sizeGroups['Besar (500-1000)']++;
    else sizeGroups['Sangat Besar (>1000)']++;
  });

  const maxCount = Math.max(...Object.values(sizeGroups), 1);

  container.innerHTML = `
    <div class="space-y-3">
      <h5 class="text-sm font-semibold text-slate-700 mb-2">📊 Distribusi Berdasarkan Jumlah Siswa</h5>
      ${Object.entries(sizeGroups).map(([label, count]) => `
        <div class="flex items-center gap-3">
          <div class="w-32 text-xs text-slate-600 flex-shrink-0">${label}</div>
          <div class="flex-1 bg-slate-100 rounded-full h-6 overflow-hidden">
            <div class="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full transition-all flex items-center justify-end px-2"
                 style="width: ${Math.max(Math.round((count / maxCount) * 100), count > 0 ? 10 : 0)}%">
              <span class="text-white text-xs font-bold">${count}</span>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

/**
 * Render top performing and attention-needed schools
 */
function renderPerformanceLists(schools) {
  const topContainer = document.getElementById('topPerformingSchools');
  const attentionContainer = document.getElementById('attentionNeededSchools');
  if (!topContainer && !attentionContainer) return;

  // Sort by total students descending (as a proxy for engagement)
  const activeSchools = schools.filter((s) => s.isActive);

  const topSchools = [...activeSchools]
    .sort((a, b) => (b.settings.total_siswa || 0) - (a.settings.total_siswa || 0))
    .slice(0, 5);

  const attentionSchools = activeSchools.filter((s) => (s.settings.total_siswa || 0) > 0 && (s.settings.total_siswa || 0) < 50);
  const lowActivitySchools = activeSchools.filter((s) => (s.settings.total_siswa || 0) === 0).slice(0, 5);

  if (topContainer) {
    if (topSchools.length === 0) {
      topContainer.innerHTML = '<p class="text-slate-400 text-sm text-center py-4">Belum ada data</p>';
    } else {
      topContainer.innerHTML = topSchools.map((school, i) => `
        <div class="flex items-center gap-3 py-2.5 ${i < topSchools.length - 1 ? 'border-b border-slate-50' : ''}">
          <div class="w-7 h-7 bg-gradient-to-br from-amber-400 to-amber-500 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            ${i + 1}
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-slate-700 truncate">${escapeHtml(school.schoolName)}</p>
            <p class="text-xs text-slate-500">${(school.settings.total_siswa || 0).toLocaleString('id-ID')} siswa · ${(school.settings.total_guru || 0)} guru</p>
          </div>
        </div>
      `).join('');
    }
  }

  if (attentionContainer) {
    const allAttention = [...attentionSchools, ...lowActivitySchools].slice(0, 5);
    if (allAttention.length === 0) {
      attentionContainer.innerHTML = '<p class="text-slate-400 text-sm text-center py-4">Semua sekolah aktif berjalan dengan baik</p>';
    } else {
      attentionContainer.innerHTML = allAttention.map((school) => {
        const total = school.settings.total_siswa || 0;
        const reason = total === 0 ? 'Belum memiliki data siswa' : `${total} siswa — perlu perhatian`;
        return `
          <div class="flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0">
            <div class="w-7 h-7 bg-red-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <i class="fa-solid fa-exclamation text-red-400 text-xs"></i>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-slate-700 truncate">${escapeHtml(school.schoolName)}</p>
              <p class="text-xs text-red-500">${reason}</p>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

/**
 * Render configuration page data
 */
function renderConfigPage() {
  const container = document.getElementById('configContent');
  if (!container) return;

  const config = SMART_ABSEN_CONFIG;
  const firebaseOk = config.firebase.apiKey && !config.firebase.apiKey.includes('[ISI');
  const googleOk = config.google.clientId && !config.google.clientId.includes('[ISI');
  const whatsappOk = config.whatsapp.apiUrl && config.whatsapp.apiKey;
  const googleApiReady = typeof gapi !== 'undefined' && gapi.client;

  container.innerHTML = `
    <div class="space-y-6">
      <!-- System Info -->
      <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
        <h3 class="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
          <i class="fa-solid fa-info-circle text-blue-500"></i> Informasi Sistem
        </h3>
        <div class="grid grid-cols-2 gap-4">
          <div class="bg-slate-50 rounded-lg p-4">
            <div class="text-xs text-slate-500 mb-1">Nama Aplikasi</div>
            <div class="font-semibold text-slate-800">${config.app.name}</div>
          </div>
          <div class="bg-slate-50 rounded-lg p-4">
            <div class="text-xs text-slate-500 mb-1">Versi</div>
            <div class="font-semibold text-slate-800">v${config.app.version}</div>
          </div>
          <div class="bg-slate-50 rounded-lg p-4">
            <div class="text-xs text-slate-500 mb-1">Email Master Admin</div>
            <div class="font-semibold text-slate-800 font-mono text-sm">${config.app.masterAdminEmail}</div>
          </div>
          <div class="bg-slate-50 rounded-lg p-4">
            <div class="text-xs text-slate-500 mb-1">User Login Saat Ini</div>
            <div class="font-semibold text-slate-800 font-mono text-sm">${masterAdmin?.currentUser?.email || '-'}</div>
          </div>
        </div>
      </div>

      <!-- API Status -->
      <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
        <h3 class="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
          <i class="fa-solid fa-plug text-green-500"></i> Status Koneksi API
        </h3>
        <div class="space-y-3">
          <div class="flex items-center justify-between p-3 rounded-lg ${firebaseOk ? 'bg-green-50' : 'bg-red-50'}">
            <div class="flex items-center gap-3">
              <i class="fa-solid fa-fire ${firebaseOk ? 'text-orange-500' : 'text-red-400'} text-lg"></i>
              <div>
                <div class="font-semibold text-sm text-slate-800">Firebase</div>
                <div class="text-xs text-slate-500">Authentication & Firestore</div>
              </div>
            </div>
            <span class="px-3 py-1 rounded-full text-xs font-bold ${firebaseOk ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}">
              ${firebaseOk ? '● Terhubung' : '● Tidak Terhubung'}
            </span>
          </div>
          <div class="flex items-center justify-between p-3 rounded-lg ${googleOk ? 'bg-green-50' : 'bg-red-50'}">
            <div class="flex items-center gap-3">
              <i class="fa-brands fa-google ${googleOk ? 'text-blue-500' : 'text-red-400'} text-lg"></i>
              <div>
                <div class="font-semibold text-sm text-slate-800">Google API</div>
                <div class="text-xs text-slate-500">Sheets & Drive API</div>
              </div>
            </div>
            <span class="px-3 py-1 rounded-full text-xs font-bold ${googleApiReady ? 'bg-green-100 text-green-700' : googleOk ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}">
              ${googleApiReady ? '● Aktif' : googleOk ? '● Tercatat' : '● Tidak Terhubung'}
            </span>
          </div>
          <div class="flex items-center justify-between p-3 rounded-lg ${whatsappOk ? 'bg-green-50' : 'bg-amber-50'}">
            <div class="flex items-center gap-3">
              <i class="fa-brands fa-whatsapp ${whatsappOk ? 'text-green-500' : 'text-amber-400'} text-lg"></i>
              <div>
                <div class="font-semibold text-sm text-slate-800">WhatsApp API</div>
                <div class="text-xs text-slate-500">Notifikasi WhatsApp</div>
              </div>
            </div>
            <span class="px-3 py-1 rounded-full text-xs font-bold ${whatsappOk ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}">
              ${whatsappOk ? '● Terhubung' : '● Opsional'}
            </span>
          </div>
        </div>
      </div>

      <!-- WhatsApp API Configuration (Master Admin Only) -->
      <div class="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <h3 class="text-lg font-bold text-slate-800 mb-1 flex items-center gap-2">
          <i class="fa-brands fa-whatsapp text-green-500"></i>
          Konfigurasi WhatsApp API
        </h3>
        <p class="text-sm text-slate-500 mb-4">Atur API WhatsApp secara terpusat untuk semua sekolah</p>

        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">API URL</label>
            <input type="text" id="config-wa-url" class="w-full px-4 py-2.5 border-2 border-slate-200 rounded-lg text-sm focus:border-blue-400 outline-none transition" placeholder="https://api.fonnte.com/send">
            <p class="text-xs text-slate-400 mt-1">Contoh: Fonnte (https://api.fonnte.com/send), Wablas, dll</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">API Key</label>
            <input type="password" id="config-wa-key" class="w-full px-4 py-2.5 border-2 border-slate-200 rounded-lg text-sm focus:border-blue-400 outline-none transition" placeholder="Masukkan API key WhatsApp">
            <p class="text-xs text-slate-400 mt-1">API key dari provider WhatsApp Anda</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Template Pesan (Opsional)</label>
            <textarea id="config-wa-template" rows="5" class="w-full px-4 py-2.5 border-2 border-slate-200 rounded-lg text-sm focus:border-blue-400 outline-none transition" placeholder="Template pesan WhatsApp...">🚨 *NOTIFIKASI ABSENSI*\n\nYth. Orang Tua/Wali dari *{nama_siswa}*\nKelas: {kelas}\n\n📅 Tanggal: {tanggal}\n⏰ Waktu: {waktu}\n📊 Status: *{status}*\n\nTerima kasih,\n*{nama_sekolah}*</textarea>
            <p class="text-xs text-slate-400 mt-1">Variabel: {nama_siswa}, {kelas}, {status}, {tanggal}, {waktu}, {nama_sekolah}</p>
          </div>
          <div class="flex gap-3">
            <button onclick="saveWhatsAppConfig()" class="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-sm transition inline-flex items-center gap-2">
              <i class="fa-solid fa-save"></i> Simpan WhatsApp Config
            </button>
            <button onclick="testWhatsAppConfig()" class="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold text-sm transition inline-flex items-center gap-2">
              <i class="fa-solid fa-flask"></i> Test Kirim
            </button>
          </div>
        </div>
      </div>

      <!-- Global Settings -->
      <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
        <h3 class="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
          <i class="fa-solid fa-sliders text-purple-500"></i> Pengaturan Global
        </h3>
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Tahun Ajaran Default</label>
            <input type="text" id="configTahunAjaran" value="2025/2026" class="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition">
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Jam Mulai Sekolah</label>
              <input type="time" id="configJamMulai" value="${config.app.schoolHours?.start || '07:00'}" class="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition">
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Jam Selesai Sekolah</label>
              <input type="time" id="configJamSelesai" value="${config.app.schoolHours?.end || '15:00'}" class="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition">
            </div>
          </div>
          <button onclick="saveGlobalSettings()" class="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm transition">
            <i class="fa-solid fa-save mr-1"></i> Simpan Pengaturan
          </button>
        </div>
      </div>

      <!-- Danger Zone -->
      <div class="bg-white rounded-xl shadow-sm border border-red-200 p-6">
        <h3 class="text-lg font-bold text-red-600 mb-4 flex items-center gap-2">
          <i class="fa-solid fa-triangle-exclamation"></i> Zona Berbahaya
        </h3>
        <div class="space-y-3">
          <div class="flex items-center justify-between p-4 bg-red-50 rounded-lg">
            <div>
              <p class="font-semibold text-sm text-slate-800">Nonaktifkan Semua Sekolah</p>
              <p class="text-xs text-slate-500 mt-1">Semua sekolah akan dinonaktifkan dari sistem</p>
            </div>
            <button onclick="dangerDisableAll()" class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold text-xs transition">
              Nonaktifkan Semua
            </button>
          </div>
          <div class="flex items-center justify-between p-4 bg-red-50 rounded-lg">
            <div>
              <p class="font-semibold text-sm text-slate-800">Reset Semua Data Sekolah</p>
              <p class="text-xs text-slate-500 mt-1">Hapus semua data absensi di semua sekolah</p>
            </div>
            <button onclick="dangerResetAll()" class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold text-xs transition">
              Reset Semua
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Load WhatsApp config from Firestore
  if (masterAdmin && masterAdmin.db) {
    masterAdmin.db.collection('system_config').doc('whatsapp').get().then(function(doc) {
      if (doc.exists) {
        var data = doc.data();
        var urlInput = document.getElementById('config-wa-url');
        var keyInput = document.getElementById('config-wa-key');
        var tmplInput = document.getElementById('config-wa-template');
        if (urlInput) urlInput.value = data.api_url || '';
        if (keyInput) keyInput.value = data.api_key || '';
        if (tmplInput) tmplInput.value = data.template || '';
      }
    });
  }
}

/**
 * Save WhatsApp config to Firestore (Master Admin)
 */
window.saveWhatsAppConfig = async function() {
  var apiUrl = document.getElementById('config-wa-url').value.trim();
  var apiKey = document.getElementById('config-wa-key').value.trim();
  var template = document.getElementById('config-wa-template').value.trim();

  if (!apiUrl || !apiKey) {
    showToast('API URL dan API Key wajib diisi!', 'error');
    return;
  }

  try {
    var db = firebase.firestore();
    await db.collection('system_config').doc('whatsapp').set({
      api_url: apiUrl,
      api_key: apiKey,
      template: template || SMART_ABSEN_CONFIG.whatsapp.template,
      updated_at: new Date().toISOString(),
      updated_by: masterAdmin ? masterAdmin.currentUser.email : 'admin'
    });

    masterAdmin.addActivityLog('update', 'Memperbarui konfigurasi WhatsApp API');
    showToast('Konfigurasi WhatsApp berhasil disimpan! ✅', 'success');
  } catch (error) {
    console.error('Error saving WhatsApp config:', error);
    showToast('Gagal menyimpan konfigurasi: ' + error.message, 'error');
  }
};

/**
 * Test WhatsApp config by sending a test message
 */
window.testWhatsAppConfig = async function() {
  var testPhone = prompt('Masukkan nomor HP untuk test (format: 628xxx):');
  if (!testPhone) return;

  var apiUrl = document.getElementById('config-wa-url').value.trim();
  var apiKey = document.getElementById('config-wa-key').value.trim();

  if (!apiUrl || !apiKey) {
    showToast('Simpan API URL dan Key terlebih dahulu!', 'warning');
    return;
  }

  showToast('Mengirim test WhatsApp...', 'info');

  try {
    var response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: testPhone,
        message: '🧪 *TEST NOTIFIKASI*\n\nIni adalah pesan test dari Smart Absen Enterprise.\nJika Anda menerima pesan ini, konfigurasi WhatsApp sudah benar.\n\n_' + new Date().toLocaleString('id-ID') + '_',
        apiKey: apiKey
      })
    });

    var result = await response.json();
    if (response.ok) {
      showToast('Test WhatsApp terkirim! Periksa HP Anda.', 'success');
    } else {
      showToast('Gagal: ' + (result.message || JSON.stringify(result)), 'error');
    }
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
  }
};

/**
 * Save global settings to Firestore
 */
async function saveGlobalSettings() {
  if (!masterAdmin || !masterAdmin.db) {
    showToast('Firebase belum terhubung', 'error');
    return;
  }

  try {
    const tahunAjaran = document.getElementById('configTahunAjaran').value;
    const jamMulai = document.getElementById('configJamMulai').value;
    const jamSelesai = document.getElementById('configJamSelesai').value;

    await masterAdmin.db.collection('config').doc('global').set({
      tahunAjaran: tahunAjaran,
      schoolHours: { start: jamMulai, end: jamSelesai },
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: masterAdmin.currentUser.email,
    }, { merge: true });

    masterAdmin.addActivityLog('update', `Memperbarui pengaturan global (TA: ${tahunAjaran})`);
    showToast('Pengaturan global berhasil disimpan');
  } catch (error) {
    showToast('Gagal menyimpan: ' + error.message, 'error');
  }
}

/**
 * Danger zone: Disable all schools
 */
async function dangerDisableAll() {
  if (!confirm('⚠️ PERINGATAN!\n\nAnda akan menonaktifkan SEMUA sekolah dari sistem.\nSemua sekolah tidak akan dapat mengakses sistem.\n\nLanjutkan?')) return;
  if (!confirm('Konfirmasi sekali lagi: NONAKTIFKAN SEMUA SEKOLAH?')) return;

  try {
    const batch = masterAdmin.db.batch();
    masterAdmin.schools.forEach((school) => {
      const ref = masterAdmin.db.collection('schools').doc(school.id);
      batch.update(ref, {
        isActive: false,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();

    masterAdmin.addActivityLog('deactivate', `Menonaktifkan SEMUA sekolah (${masterAdmin.schools.length} sekolah)`);
    showToast('Semua sekolah berhasil dinonaktifkan');
    await masterAdmin.loadSchools();
    await masterAdmin.calculateGlobalStats();
    masterAdmin.refreshUI();
  } catch (error) {
    showToast('Gagal: ' + error.message, 'error');
  }
}

/**
 * Danger zone: Reset all schools data
 */
async function dangerResetAll() {
  if (!confirm('🚨 PERINGATAN KRITIS!\n\nAnda akan menghapus SEMUA data absensi di SEMUA sekolah.\n\nTindakan ini TIDAK DAPAT dibatalkan!\n\nLanjutkan?')) return;
  if (!confirm('KONFIRMASI TERAKHIR: Hapus semua data di semua sekolah?')) return;

  try {
    const activeSchools = masterAdmin.schools.filter((s) => s.isActive && s.sheetId);
    let successCount = 0;

    for (const school of activeSchools) {
      try {
        await masterAdmin.executeReset(school.id);
        successCount++;
      } catch (e) {
        console.error('Reset failed for', school.schoolName, e);
      }
    }

    masterAdmin.addActivityLog('reset', `Reset data ${successCount} dari ${activeSchools.length} sekolah`);
    showToast(`Reset selesai: ${successCount} sekolah berhasil direset`);
  } catch (error) {
    showToast('Gagal: ' + error.message, 'error');
  }
}

/**
 * Close the master modal
 */
function closeMasterModal() {
  const modal = document.getElementById('masterModal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Show toast notification (override if not available from app.js)
 */
function showToast(message, type) {
  if (typeof window.showToast === 'function' && window.showToast !== showToast) {
    window.showToast(message, type);
    return;
  }

  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'fixed top-4 right-4 z-[9999] space-y-2';
    document.body.appendChild(container);
  }

  const colors = {
    success: 'bg-emerald-500',
    error: 'bg-red-500',
    warning: 'bg-amber-500',
    info: 'bg-blue-500',
  };
  const icons = {
    success: 'fa-circle-check',
    error: 'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info',
  };

  const toast = document.createElement('div');
  toast.className = `${colors[type] || colors.info} text-white px-5 py-3 rounded-xl shadow-lg flex items-center gap-3 text-sm font-semibold min-w-[300px] animate-slide-in`;
  toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 300);
  }, 3000);
}

/**
 * Show modal dialog (override if not available from app.js)
 */
function showModal(title, content) {
  let modal = document.getElementById('masterModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'masterModal';
    modal.className = 'fixed inset-0 z-[9998] hidden';
    modal.innerHTML = `
      <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" onclick="closeMasterModal()"></div>
      <div class="absolute inset-0 flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto relative">
          <div class="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between rounded-t-2xl">
            <h3 class="text-lg font-bold text-slate-800" id="masterModalTitle"></h3>
            <button onclick="closeMasterModal()" class="w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded-lg transition text-slate-400 hover:text-slate-600">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div class="px-6 py-5" id="masterModalContent"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const titleEl = document.getElementById('masterModalTitle');
  const contentEl = document.getElementById('masterModalContent');
  if (titleEl) titleEl.textContent = title;
  if (contentEl) contentEl.innerHTML = content;
  modal.classList.remove('hidden');
}

/**
 * Format date (Indonesian)
 */
function formatDate(date) {
  if (!date) return '-';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Format time (Indonesian)
 */
function formatTime(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Generate unique ID
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

/**
 * Escape HTML entities
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==========================================
// INITIALIZE FIREBASE (for master admin)
// ==========================================
function initFirebase() {
  const config = SMART_ABSEN_CONFIG.firebase;
  if (!config || !config.apiKey || config.apiKey.includes('[ISI')) {
    throw new Error('Konfigurasi Firebase belum lengkap');
  }
  if (!firebase.apps.length) {
    firebase.initializeApp(config);
  }
  firebase.firestore().settings({
    timestampsInSnapshots: true,
    merge: true,
  });
}

// ==========================================
// INITIALIZE GOOGLE API
// ==========================================
function initGoogleAPI() {
  return new Promise((resolve, reject) => {
    if (typeof gapi === 'undefined') {
      reject(new Error('Google API library not loaded'));
      return;
    }
    const config = SMART_ABSEN_CONFIG.google;
    if (!config || !config.clientId || config.clientId.includes('[ISI')) {
      reject(new Error('Google Client ID belum dikonfigurasi'));
      return;
    }
    gapi.load('client:auth2', () => {
      gapi.client.init({
        apiKey: config.apiKey || '',
        clientId: config.clientId,
        scope: config.scopes.join(' '),
        discoveryDocs: config.discoveryDocs,
      }).then(() => resolve()).catch((err) => reject(err));
    });
  });
}

// ==========================================
// INITIALIZATION
// ==========================================

// Global instance
const masterAdmin = new MasterAdminService();

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  masterAdmin.loadActivityLog();

  // Check if already logged in
  const savedUser = localStorage.getItem('smart_absen_admin_user');
  if (savedUser) {
    try {
      masterAdmin.currentUser = JSON.parse(savedUser);
    } catch (e) {
      // ignore
    }
  }

  masterAdmin.init();
});

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swPath = new URL('./sw.js', window.location.href).href;
    navigator.serviceWorker.register(swPath).catch(() => {});
  });
}
