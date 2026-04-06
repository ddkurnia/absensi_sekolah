/**
 * ============================================================
 *  SMART ABSEN ENTERPRISE v2.0 — MODUL ABSENSI
 *  absen.js — Logika Input Absensi Harian
 * ============================================================
 */

// ==========================================
// ATTENDANCE CONTROLLER — Class Utama
// ==========================================

class AttendanceController {
  constructor() {
    this.sheetsService = null;
    this.whatsAppService = null;
    this.offlineQueue = new OfflineQueue();
    this.currentClass = null;
    this.currentStudents = [];
    this.attendanceData = {};
    this.isOnline = navigator.onLine;
    this.isSyncing = false;
    this.currentUser = null;
    this.sheetConfig = null;
    this.autoSaveInterval = null;
    this.selectedDate = null;
    this.statusTextures = SMART_ABSEN_CONFIG.app.attendanceStatuses;
    this.whatsappEnabled = !!(SMART_ABSEN_CONFIG.whatsapp.apiUrl && SMART_ABSEN_CONFIG.whatsapp.apiKey);
  }

  // ─────────────────────────────────────────
  // INISIALISASI
  // ─────────────────────────────────────────

  async init() {
    try {
      // 1. Cek apakah user sudah login
      const userStr = localStorage.getItem('smart_absen_user');
      if (!userStr) {
        window.location.href = 'index.html';
        return;
      }
      this.currentUser = JSON.parse(userStr);

      // 2. Ambil konfigurasi sheet
      const configStr = localStorage.getItem('smart_absen_sheet_config');
      if (configStr) {
        this.sheetConfig = JSON.parse(configStr);
      }

      // 3. Update UI dengan info user
      this._renderUserInfo();

      // 4. Set tanggal hari ini
      this.selectedDate = new Date();
      this._updateDateDisplay();

      // 5. Inisialisasi Firebase
      if (typeof initFirebase === 'function') {
        initFirebase();
      }

      // 6. Inisialisasi Google API
      if (typeof initGoogleAPI === 'function') {
        await initGoogleAPI();
      }

      // 7. Buat instance SheetsService
      if (typeof SheetsService === 'function' && this.sheetConfig) {
        this.sheetsService = new SheetsService(this.sheetConfig.sheetId);
      }

      // 8. Buat instance WhatsAppService jika diaktifkan
      if (typeof WhatsAppService === 'function' && this.whatsappEnabled) {
        this.whatsAppService = new WhatsAppService();
      }

      // 9. Setup listener online/offline
      this.setupNetworkListeners();

      // 10. Update indikator koneksi
      this._updateNetworkIndicator();

      // 11. Load daftar kelas
      await this.loadClasses();

      // 12. Cek dan proses antrian offline
      await this._checkOfflineQueue();

      // 13. Mulai auto-save timer
      this._startAutoSaveTimer();

      // 14. Hide loading screen
      this._hideLoading();

      console.log('[AttendanceController] Inisialisasi berhasil');
    } catch (error) {
      console.error('[AttendanceController] Gagal inisialisasi:', error);
      this._hideLoading();
      showToast('Gagal memuat data. Silakan refresh halaman.', 'error');
    }
  }

  // ─────────────────────────────────────────
  // LOAD KELAS
  // ─────────────────────────────────────────

  async loadClasses() {
    try {
      const selector = document.getElementById('classSelector');
      if (!selector) return;

      // Tampilkan loading
      selector.innerHTML = '<option value="">Memuat kelas...</option>';
      selector.disabled = true;

      let classes = [];

      if (this.sheetsService && this.isOnline) {
        // Ambil dari Google Sheets
        classes = await this.sheetsService.getClasses();
      } else if (!this.isOnline) {
        // Ambil dari cache lokal
        classes = this._getCachedClasses();
      }

      // Render opsi kelas
      selector.innerHTML = '<option value="">— Pilih Kelas —</option>';

      if (classes.length === 0) {
        selector.innerHTML += '<option value="" disabled>Tidak ada kelas ditemukan</option>';
        showToast('Tidak ada kelas yang ditemukan', 'warning');
      } else {
        // Simpan ke cache lokal
        this._cacheClasses(classes);

        classes.forEach(cls => {
          const option = document.createElement('option');
          const className = cls['Nama Kelas'] || cls.nama_kelas || cls.name || cls;
          const classId = cls.ID || cls.id || className;
          option.value = className;
          option.textContent = className;
          selector.appendChild(option);
        });
      }

      selector.disabled = false;
    } catch (error) {
      console.error('[AttendanceController] Gagal load kelas:', error);
      const selector = document.getElementById('classSelector');
      if (selector) {
        selector.innerHTML = '<option value="">— Pilih Kelas —</option><option value="" disabled>Gagal memuat kelas</option>';
        selector.disabled = false;
      }
      showToast('Gagal memuat daftar kelas', 'error');
    }
  }

  // ─────────────────────────────────────────
  // PILIH KELAS & LOAD SISWA
  // ─────────────────────────────────────────

  async selectClass(className) {
    if (!className) {
      this.currentClass = null;
      this.currentStudents = [];
      this.attendanceData = {};
      this._renderStudentList();
      this._hideSummaryBar();
      return;
    }

    this.currentClass = className;

    // Tampilkan loading
    this._showLoadingOverlay('Memuat data siswa...');

    try {
      // 1. Load siswa berdasarkan kelas
      let students = [];
      if (this.sheetsService && this.isOnline) {
        students = await this.sheetsService.getStudentsByClass(className);
      } else {
        students = this._getCachedStudents(className);
      }

      // Filter hanya siswa aktif
      students = students.filter(s => {
        const status = s['Status Aktif'] || s.status_aktif || s.status || 'Aktif';
        return status === 'Aktif' || status === 'aktif' || status === 1 || status === '1';
      });

      // Sort berdasarkan nama
      students.sort((a, b) => {
        const nameA = (a['Nama Siswa'] || a.nama_siswa || a.name || '').toLowerCase();
        const nameB = (b['Nama Siswa'] || b.nama_siswa || b.name || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });

      this.currentStudents = students;

      // Cache siswa
      this._cacheStudents(className, students);

      // 2. Load absensi hari ini yang sudah ada
      this.attendanceData = {};
      const todayStr = formatDate(this.selectedDate);

      if (this.sheetsService && this.isOnline) {
        const existingRecords = await this.sheetsService.getAttendance(todayStr, className);

        // Merge data absensi yang sudah ada
        existingRecords.forEach(record => {
          const nis = String(record.NIS || record.nis || record['NIS']);
          this.attendanceData[nis] = {
            status: record.Status || record.status,
            time: record['Jam Masuk'] || record.jam_masuk || record.time || '',
            note: record.Keterangan || record.keterangan || '',
            synced: true,
            recordId: record.ID || record.id
          };
        });
      } else {
        // Cek data offline
        this._mergeOfflineData(todayStr, className);
      }

      // 3. Render UI
      this._renderStudentList();
      this._showSummaryBar();
      this._updateSummary();

      const totalMarked = Object.keys(this.attendanceData).length;
      if (totalMarked > 0) {
        showToast(`${totalMarked} siswa sudah diabsen hari ini`, 'info');
      }

    } catch (error) {
      console.error('[AttendanceController] Gagal load siswa:', error);
      showToast('Gagal memuat data siswa', 'error');
    } finally {
      this._hideLoadingOverlay();
    }
  }

  // ─────────────────────────────────────────
  // MARK ATTENDANCE
  // ─────────────────────────────────────────

  markAttendance(nis, studentName, status) {
    const student = this.currentStudents.find(s =>
      String(s.NIS || s.nis) === String(nis)
    );
    if (!student) {
      console.error('[AttendanceController] Siswa tidak ditemukan:', nis);
      return;
    }

    const now = new Date();
    const timeStr = formatTime ? formatTime(now) : now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    // Jika status sama, batalkan (toggle off)
    if (this.attendanceData[nis] && this.attendanceData[nis].status === status) {
      delete this.attendanceData[nis];
    } else {
      // Set status baru
      this.attendanceData[nis] = {
        status: status,
        name: studentName,
        time: timeStr,
        note: '',
        synced: false,
        classData: student
      };
    }

    // Update UI
    this._updateStudentCard(nis);
    this._updateSummary();
    this._updateBottomBar();

    // Jika online, simpan langsung
    if (this.isOnline && this.sheetsService) {
      this._saveSingleRecord(nis);
    }

    // Haptic feedback (jika supported)
    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
  }

  // ─────────────────────────────────────────
  // SIMPAN SATU RECORD
  // ─────────────────────────────────────────

  async _saveSingleRecord(nis) {
    const data = this.attendanceData[nis];
    if (!data) return;

    try {
      const record = this._buildRecord(nis, data);
      await this.sheetsService.appendRow('Absensi', record);
      data.synced = true;
      this._updateStudentCard(nis);
    } catch (error) {
      console.error('[AttendanceController] Gagal simpan record:', error);
      data.synced = false;
      // Tambahkan ke antrian offline
      this._addToOfflineQueue(nis, data);
    }
  }

  // ─────────────────────────────────────────
  // SUBMIT SEMUA ABSENSI
  // ─────────────────────────────────────────

  async submitAllAttendance() {
    const markedCount = Object.keys(this.attendanceData).length;
    if (markedCount === 0) {
      showToast('Belum ada siswa yang diabsen', 'warning');
      return;
    }

    const totalStudents = this.currentStudents.length;
    const unmarkedCount = totalStudents - markedCount;

    // Tampilkan dialog konfirmasi
    const confirmed = await showConfirmDialog(
      'Konfirmasi Simpan Absensi',
      `Anda akan menyimpan absensi untuk <strong>${markedCount} siswa</strong> dari kelas <strong>${this.currentClass}</strong>.` +
      (unmarkedCount > 0 ? `<br><br>⚠️ <strong>${unmarkedCount} siswa</strong> belum diabsen. Lanjutkan?` : '') +
      `<br><br>Tanggal: <strong>${this._getFormattedDate()}</strong>`
    );

    if (!confirmed) return;

    // Tampilkan loading
    this._showSaveProgress();

    const results = {
      success: [],
      failed: [],
      whatsapp: { sent: 0, failed: 0 }
    };

    try {
      if (this.isOnline && this.sheetsService) {
        // Simpan satu per satu ke Google Sheets
        const entries = Object.entries(this.attendanceData);

        for (let i = 0; i < entries.length; i++) {
          const [nis, data] = entries[i];

          // Update progress
          this._updateSaveProgress(i + 1, entries.length, data.name);

          try {
            const record = this._buildRecord(nis, data);
            await this.sheetsService.appendRow('Absensi', record);
            data.synced = true;
            results.success.push({ nis, name: data.name, status: data.status });
          } catch (error) {
            console.error(`[AttendanceController] Gagal simpan ${nis}:`, error);
            data.synced = false;
            this._addToOfflineQueue(nis, data);
            results.failed.push({ nis, name: data.name, status: data.status, error: error.message });
          }
        }
      } else {
        // Offline — simpan semua ke queue
        Object.entries(this.attendanceData).forEach(([nis, data]) => {
          data.synced = false;
          this._addToOfflineQueue(nis, data);
          results.success.push({ nis, name: data.name, status: data.status });
        });

        showToast('Data disimpan secara offline. Akan disinkronkan saat online.', 'warning');
      }

      // Tampilkan ringkasan
      this._hideSaveProgress();
      this._updateBottomBar();

      if (results.failed.length === 0 && this.isOnline) {
        showToast(`Berhasil menyimpan ${results.success.length} data absensi`, 'success');
      }

      showAttendanceSummary({
        className: this.currentClass,
        date: this._getFormattedDate(),
        total: totalStudents,
        marked: markedCount,
        unmarked: unmarkedCount,
        success: results.success.length,
        failed: results.failed.length,
        offline: !this.isOnline,
        whatsappEnabled: this.whatsappEnabled,
        summary: this.getSummary()
      });

      // Tanya apakah mau kirim WhatsApp
      if (this.whatsappEnabled && this.isOnline && results.success.length > 0) {
        const sendWA = await showConfirmDialog(
          'Kirim Notifikasi WhatsApp',
          `Kirim notifikasi absensi ke <strong>${results.success.length} orang tua</strong> siswa?`
        );
        if (sendWA) {
          await this._sendAllWhatsAppNotifications(results.success);
        }
      }

    } catch (error) {
      console.error('[AttendanceController] Error submit:', error);
      this._hideSaveProgress();
      showToast('Terjadi kesalahan saat menyimpan', 'error');
    }
  }

  // ─────────────────────────────────────────
  // KIRIM NOTIFIKASI WHATSAPP
  // ─────────────────────────────────────────

  async _sendAllWhatsAppNotifications(records) {
    this._showWhatsAppProgress();

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      this._updateWhatsAppProgress(i + 1, records.length, record.name);

      try {
        const student = this.currentStudents.find(s =>
          String(s.NIS || s.nis) === String(record.nis)
        );
        if (!student) continue;

        await this.sendWhatsAppNotification(student, record.status);
        sent++;
      } catch (error) {
        console.error(`[AttendanceController] WA gagal untuk ${record.nis}:`, error);
        failed++;
      }

      // Delay antar request (rate limiting)
      if (i < records.length - 1) {
        await this._delay(1000);
      }
    }

    this._hideWhatsAppProgress();
    showToast(`WhatsApp: ${sent} terkirim, ${failed} gagal`, sent === records.length ? 'success' : 'warning');
  }

  async sendWhatsAppNotification(student, status) {
    if (!this.whatsAppService) return;

    const phone = student['No HP Ortu'] || student.no_hp_ortu || student.phone || '';
    if (!phone) return;

    const statusObj = this.statusTextures.find(s => s.value === status);
    const statusLabel = statusObj ? statusObj.label : status;
    const schoolName = this.sheetConfig ? this.sheetConfig.schoolName : SMART_ABSEN_CONFIG.app.name;

    const messageData = {
      nama_siswa: student['Nama Siswa'] || student.nama_siswa || student.name || '',
      kelas: this.currentClass,
      status: statusLabel,
      tanggal: this._getFormattedDate(),
      waktu: this.attendanceData[student.NIS || student.nis]?.time || '-',
      nama_sekolah: schoolName
    };

    await this.whatsAppService.sendNotification(phone, messageData);
  }

  // ─────────────────────────────────────────
  // PROSES ANTRIAN OFFLINE
  // ─────────────────────────────────────────

  async processOfflineQueue() {
    if (this.isSyncing || !this.isOnline || !this.sheetsService) return;

    const pendingCount = this.offlineQueue.getPendingCount();
    if (pendingCount === 0) return;

    this.isSyncing = true;
    showToast(`Menyinkronkan ${pendingCount} data offline...`, 'info');

    try {
      await this.offlineQueue.processQueue();
      showToast('Semua data offline berhasil disinkronkan!', 'success');
    } catch (error) {
      console.error('[AttendanceController] Gagal proses offline queue:', error);
      showToast('Gagal menyinkronkan beberapa data', 'error');
    } finally {
      this.isSyncing = false;
      this._updateSyncBadge();
    }
  }

  // ─────────────────────────────────────────
  // GET SUMMARY
  // ─────────────────────────────────────────

  getSummary() {
    const counts = {
      H: 0, S: 0, I: 0, A: 0, T: 0, belum_absen: 0
    };

    const total = this.currentStudents.length;
    let marked = 0;

    this.currentStudents.forEach(student => {
      const nis = String(student.NIS || student.nis);
      const data = this.attendanceData[nis];
      if (data) {
        counts[data.status] = (counts[data.status] || 0) + 1;
        marked++;
      } else {
        counts.belum_absen++;
      }
    });

    counts.total = total;
    counts.marked = marked;
    counts.percentage = total > 0 ? Math.round((marked / total) * 100) : 0;

    return counts;
  }

  // ─────────────────────────────────────────
  // GET HISTORY
  // ─────────────────────────────────────────

  async getHistory(date, className) {
    if (!this.sheetsService || !this.isOnline) {
      showToast('Tidak dapat memuat riwayat saat offline', 'warning');
      return [];
    }

    try {
      const dateStr = typeof date === 'string' ? date : formatDate(date);
      const records = await this.sheetsService.getAttendance(dateStr, className);
      return records;
    } catch (error) {
      console.error('[AttendanceController] Gagal load riwayat:', error);
      showToast('Gagal memuat riwayat absensi', 'error');
      return [];
    }
  }

  // ─────────────────────────────────────────
  // NETWORK LISTENERS
  // ─────────────────────────────────────────

  setupNetworkListeners() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this._updateNetworkIndicator();
      showToast('Koneksi internet kembali tersedia', 'success');

      // Proses antrian offline
      setTimeout(() => this.processOfflineQueue(), 1000);

      // Reload kelas jika belum ada
      if (this.currentStudents.length === 0) {
        this.loadClasses();
      }
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this._updateNetworkIndicator();
      showToast('Anda sedang offline. Data akan disimpan secara lokal.', 'warning');
    });
  }

  // ─────────────────────────────────────────
  // AUTO-SAVE TIMER
  // ─────────────────────────────────────────

  _startAutoSaveTimer() {
    this.autoSaveInterval = setInterval(() => {
      if (!this.isOnline || !this.sheetsService || !this.currentClass) return;

      const unsaved = Object.entries(this.attendanceData).filter(([_, data]) => !data.synced);
      if (unsaved.length === 0) return;

      console.log(`[AttendanceController] Auto-save: ${unsaved.length} record belum tersinkron`);
      this._autoSaveUnsynced();
    }, 30000); // Setiap 30 detik
  }

  async _autoSaveUnsynced() {
    const unsaved = Object.entries(this.attendanceData).filter(([_, data]) => !data.synced);
    for (const [nis, data] of unsaved) {
      try {
        const record = this._buildRecord(nis, data);
        await this.sheetsService.appendRow('Absensi', record);
        data.synced = true;
        this._updateStudentCard(nis);
      } catch (error) {
        console.error(`[AttendanceController] Auto-save gagal untuk ${nis}:`, error);
      }
    }
  }

  // ─────────────────────────────────────────
  // BUILD RECORD
  // ─────────────────────────────────────────

  _buildRecord(nis, data) {
    const id = typeof generateId === 'function' ? generateId() : `ABS-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const dateStr = formatDate(this.selectedDate);
    const statusObj = this.statusTextures.find(s => s.value === data.status);
    const statusLabel = statusObj ? statusObj.label : data.status;

    return [
      id,                    // ID
      dateStr,               // Tanggal
      this.currentClass,     // Kelas
      nis,                   // NIS
      data.name || '',       // Nama Siswa
      statusLabel,           // Status
      data.time || '',       // Jam Masuk
      data.note || '',       // Keterangan
      this.currentUser ? this.currentUser.name : '', // Guru Penginput
      data.synced ? 'synced' : 'pending'  // Sync Status
    ];
  }

  // ─────────────────────────────────────────
  // OFFLINE QUEUE HELPERS
  // ─────────────────────────────────────────

  _addToOfflineQueue(nis, data) {
    const record = this._buildRecord(nis, data);
    this.offlineQueue.add(record);
    this._updateSyncBadge();
  }

  _mergeOfflineData(dateStr, className) {
    try {
      const queueStr = localStorage.getItem('smart_absen_offline_queue');
      if (!queueStr) return;

      const queue = JSON.parse(queueStr);
      queue.forEach(record => {
        if (record[1] === dateStr && record[2] === className) {
          const nis = String(record[3]);
          if (!this.attendanceData[nis]) {
            this.attendanceData[nis] = {
              status: record[5],
              name: record[4],
              time: record[6],
              note: record[7],
              synced: false
            };
          }
        }
      });
    } catch (error) {
      console.error('[AttendanceController] Gagal merge offline data:', error);
    }
  }

  async _checkOfflineQueue() {
    const pendingCount = this.offlineQueue.getPendingCount();
    this._updateSyncBadge();

    if (pendingCount > 0) {
      if (this.isOnline) {
        // Tampilkan notifikasi
        showToast(`${pendingCount} data offline belum tersinkronkan`, 'warning');

        // Tanya apakah mau sinkronkan sekarang
        const sync = await showConfirmDialog(
          'Data Offline Tersedia',
          `Terdapat <strong>${pendingCount}</strong> data absensi yang belum tersinkronkan.<br><br>Sinkronkan sekarang?`
        );

        if (sync) {
          await this.processOfflineQueue();
        }
      } else {
        showToast(`${pendingCount} data tersimpan offline`, 'info');
      }
    }
  }

  // ─────────────────────────────────────────
  // CACHE HELPERS
  // ─────────────────────────────────────────

  _getCachedClasses() {
    try {
      const cached = localStorage.getItem('smart_absen_cached_classes');
      return cached ? JSON.parse(cached) : [];
    } catch { return []; }
  }

  _cacheClasses(classes) {
    try {
      localStorage.setItem('smart_absen_cached_classes', JSON.stringify(classes));
    } catch { /* ignore storage errors */ }
  }

  _getCachedStudents(className) {
    try {
      const cached = localStorage.getItem('smart_absen_cached_students');
      if (!cached) return [];
      const all = JSON.parse(cached);
      return all[className] || [];
    } catch { return []; }
  }

  _cacheStudents(className, students) {
    try {
      const cached = localStorage.getItem('smart_absen_cached_students');
      const all = cached ? JSON.parse(cached) : {};
      all[className] = students;
      localStorage.setItem('smart_absen_cached_students', JSON.stringify(all));
    } catch { /* ignore */ }
  }

  // ─────────────────────────────────────────
  // UI RENDERING
  // ─────────────────────────────────────────

  _renderUserInfo() {
    const nameEl = document.getElementById('userName');
    const avatarEl = document.getElementById('userAvatar');
    const schoolEl = document.getElementById('schoolName');

    if (this.currentUser) {
      if (nameEl) nameEl.textContent = this.currentUser.name || '';
      if (avatarEl) avatarEl.src = this.currentUser.photoURL || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIyMCIgZmlsbD0iI2UyZThlYyIvPjx0ZXh0IHg9IjIwIiB5PSIyNCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzk5OSIgZm9udC1zaXplPSIxNiI+8J+boCDwn5qAPC90ZXh0Pjwvc3ZnPg==';
    }

    if (schoolEl && this.sheetConfig) {
      schoolEl.textContent = this.sheetConfig.schoolName || '';
    }
  }

  _updateDateDisplay() {
    const dateEl = document.getElementById('dateDisplay');
    const dateInput = document.getElementById('dateInput');

    if (dateEl && this.selectedDate) {
      dateEl.textContent = this._getFormattedDate();
    }

    if (dateInput && this.selectedDate) {
      const y = this.selectedDate.getFullYear();
      const m = String(this.selectedDate.getMonth() + 1).padStart(2, '0');
      const d = String(this.selectedDate.getDate()).padStart(2, '0');
      dateInput.value = `${y}-${m}-${d}`;
    }
  }

  _getFormattedDate() {
    if (!this.selectedDate) return '-';

    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
                    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    const d = this.selectedDate;
    return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  _updateNetworkIndicator() {
    const indicator = document.getElementById('networkIndicator');
    if (indicator) {
      indicator.className = `network-indicator ${this.isOnline ? 'online' : 'offline'}`;
      indicator.title = this.isOnline ? 'Online' : 'Offline';
    }
  }

  _renderStudentList() {
    const container = document.getElementById('studentListContainer');

    if (!container) return;

    if (this.currentStudents.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <p class="empty-title">Belum ada siswa</p>
          <p class="empty-text">Pilih kelas terlebih dahulu untuk memuat daftar siswa</p>
        </div>`;
      return;
    }

    const statuses = this.statusTextures;
    let html = '';

    this.currentStudents.forEach((student, index) => {
      const nis = String(student.NIS || student.nis);
      const name = student['Nama Siswa'] || student.nama_siswa || student.name || 'Tanpa Nama';
      const gender = student['Jenis Kelamin'] || student.jenis_kelamin || student.gender || '';
      const data = this.attendanceData[nis];
      const currentStatus = data ? data.status : null;
      const timeStr = data ? data.time : '';
      const isEven = index % 2 === 0;

      html += `
        <div class="student-card ${isEven ? 'card-even' : 'card-odd'} ${currentStatus ? 'card-marked' : ''}" 
             id="card-${nis}" data-nis="${nis}">
          <div class="student-info">
            <div class="student-avatar-small">${gender === 'P' ? '👩' : gender === 'L' ? '👦' : '👤'}</div>
            <div class="student-details">
              <div class="student-name">${this._escapeHtml(name)}</div>
              <div class="student-nis">NIS: ${this._escapeHtml(nis)}</div>
            </div>
            ${timeStr ? `<div class="student-time">${timeStr}</div>` : ''}
          </div>
          <div class="status-buttons">
            ${statuses.map(s => `
              <button class="status-btn ${currentStatus === s.value ? 'active' : ''}"
                      style="--btn-color: ${s.color}"
                      onclick="attendanceController.markAttendance('${nis}', '${this._escapeHtml(name)}', '${s.value}')"
                      title="${s.label}">
                <span class="btn-icon">${s.icon}</span>
                <span class="btn-label">${s.value}</span>
              </button>
            `).join('')}
          </div>
        </div>`;
    });

    container.innerHTML = html;
    this._updateBottomBar();
  }

  _updateStudentCard(nis) {
    const card = document.getElementById(`card-${nis}`);
    if (!card) return;

    const data = this.attendanceData[nis];
    const buttons = card.querySelectorAll('.status-btn');

    buttons.forEach(btn => {
      const statusVal = btn.querySelector('.btn-label').textContent;
      if (data && data.status === statusVal) {
        btn.classList.add('active');
        card.classList.add('card-marked');
      } else {
        btn.classList.remove('active');
      }
    });

    if (!data) {
      card.classList.remove('card-marked');
    }

    // Update time display
    const timeEl = card.querySelector('.student-time');
    const infoEl = card.querySelector('.student-info');

    if (data && data.time) {
      if (timeEl) {
        timeEl.textContent = data.time;
      } else if (infoEl) {
        const timeDiv = document.createElement('div');
        timeDiv.className = 'student-time';
        timeDiv.textContent = data.time;
        infoEl.appendChild(timeDiv);
      }
    } else if (timeEl) {
      timeEl.remove();
    }

    // Animate card
    card.classList.add('card-animate');
    setTimeout(() => card.classList.remove('card-animate'), 300);
  }

  _showSummaryBar() {
    const bar = document.getElementById('summaryBar');
    if (bar) bar.classList.add('visible');
  }

  _hideSummaryBar() {
    const bar = document.getElementById('summaryBar');
    if (bar) bar.classList.remove('visible');
  }

  _updateSummary() {
    const counts = this.getSummary();
    const bar = document.getElementById('summaryBar');
    if (!bar) return;

    const statuses = this.statusTextures;
    let html = '';

    statuses.forEach(s => {
      const count = counts[s.value] || 0;
      html += `
        <div class="summary-item" style="--item-color: ${s.color}">
          <span class="summary-icon">${s.icon}</span>
          <span class="summary-label">${s.label}</span>
          <span class="summary-count" style="background: ${count > 0 ? s.color : '#e5e7eb'}; color: ${count > 0 ? '#fff' : '#6b7280'}">${count}</span>
        </div>`;
    });

    // Belum absen
    html += `
      <div class="summary-item" style="--item-color: #9ca3af">
        <span class="summary-icon">⏳</span>
        <span class="summary-label">Belum</span>
        <span class="summary-count" style="background: ${counts.belum_absen > 0 ? '#6b7280' : '#e5e7eb'}; color: ${counts.belum_absen > 0 ? '#fff' : '#6b7280'}">${counts.belum_absen}</span>
      </div>`;

    // Update summary items container
    const itemsContainer = document.getElementById('summaryItems');
    if (itemsContainer) itemsContainer.innerHTML = html;

    // Update progress bar
    const progressBar = document.getElementById('attendanceProgress');
    const progressText = document.getElementById('progressText');
    if (progressBar) {
      progressBar.style.width = `${counts.percentage}%`;
      progressBar.setAttribute('aria-valuenow', counts.percentage);

      // Warna berdasarkan persentase
      let color = '#ef4444'; // merah
      if (counts.percentage >= 80) color = '#22c55e'; // hijau
      else if (counts.percentage >= 60) color = '#f59e0b'; // kuning
      else if (counts.percentage >= 40) color = '#f97316'; // oranye
      progressBar.style.background = color;
    }

    if (progressText) {
      progressText.textContent = `${counts.percentage}% (${counts.marked}/${counts.total})`;
    }
  }

  _updateBottomBar() {
    const countEl = document.getElementById('markedCount');
    const btn = document.getElementById('submitAllBtn');
    const total = this.currentStudents.length;
    const marked = Object.keys(this.attendanceData).length;

    if (countEl) {
      countEl.textContent = `${marked} dari ${total} siswa sudah diabsen`;
    }

    if (btn) {
      btn.disabled = marked === 0;
    }
  }

  _updateSyncBadge() {
    const badge = document.getElementById('syncBadge');
    if (!badge) return;

    const count = this.offlineQueue.getPendingCount();
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // ─────────────────────────────────────────
  // LOADING & OVERLAYS
  // ─────────────────────────────────────────

  _showLoading() {
    const el = document.getElementById('initialLoading');
    if (el) el.classList.add('active');
  }

  _hideLoading() {
    const el = document.getElementById('initialLoading');
    if (el) el.classList.remove('active');
  }

  _showLoadingOverlay(message) {
    let overlay = document.getElementById('loadingOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'loadingOverlay';
      overlay.className = 'loading-overlay';
      overlay.innerHTML = `
        <div class="loading-content">
          <div class="loading-spinner"></div>
          <p id="loadingMessage" class="loading-message">Memuat...</p>
        </div>`;
      document.body.appendChild(overlay);
    }
    const msgEl = document.getElementById('loadingMessage');
    if (msgEl) msgEl.textContent = message || 'Memuat...';
    overlay.classList.add('active');
  }

  _hideLoadingOverlay() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.classList.remove('active');
  }

  _showSaveProgress() {
    let modal = document.getElementById('saveProgressModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'saveProgressModal';
      modal.className = 'modal-overlay active';
      modal.innerHTML = `
        <div class="modal-box">
          <h3 class="modal-title">💾 Menyimpan Absensi</h3>
          <div class="progress-container">
            <div class="progress-bar-bg">
              <div id="saveProgressBar" class="progress-bar-fill" style="width: 0%"></div>
            </div>
            <p id="saveProgressText" class="progress-label">0 / 0</p>
          </div>
          <p id="saveProgressStudent" class="progress-detail">Menyimpan data...</p>
        </div>`;
      document.body.appendChild(modal);
    }
    modal.classList.add('active');
  }

  _updateSaveProgress(current, total, studentName) {
    const bar = document.getElementById('saveProgressBar');
    const text = document.getElementById('saveProgressText');
    const detail = document.getElementById('saveProgressStudent');

    const pct = Math.round((current / total) * 100);
    if (bar) bar.style.width = `${pct}%`;
    if (text) text.textContent = `${current} / ${total}`;
    if (detail) detail.textContent = `Menyimpan: ${studentName}`;
  }

  _hideSaveProgress() {
    const modal = document.getElementById('saveProgressModal');
    if (modal) modal.classList.remove('active');
  }

  _showWhatsAppProgress() {
    let modal = document.getElementById('waProgressModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'waProgressModal';
      modal.className = 'modal-overlay active';
      modal.innerHTML = `
        <div class="modal-box">
          <h3 class="modal-title">📱 Mengirim WhatsApp</h3>
          <div class="progress-container">
            <div class="progress-bar-bg">
              <div id="waProgressBar" class="progress-bar-fill wa-bar" style="width: 0%"></div>
            </div>
            <p id="waProgressText" class="progress-label">0 / 0</p>
          </div>
          <p id="waProgressStudent" class="progress-detail">Mengirim notifikasi...</p>
        </div>`;
      document.body.appendChild(modal);
    }
    modal.classList.add('active');
  }

  _updateWhatsAppProgress(current, total, studentName) {
    const bar = document.getElementById('waProgressBar');
    const text = document.getElementById('waProgressText');
    const detail = document.getElementById('waProgressStudent');

    const pct = Math.round((current / total) * 100);
    if (bar) bar.style.width = `${pct}%`;
    if (text) text.textContent = `${current} / ${total}`;
    if (detail) detail.textContent = `Mengirim ke: ${studentName}`;
  }

  _hideWhatsAppProgress() {
    const modal = document.getElementById('waProgressModal');
    if (modal) modal.classList.remove('active');
  }

  // ─────────────────────────────────────────
  // UTILITY
  // ─────────────────────────────────────────

  _escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ─────────────────────────────────────────
  // DATE CHANGE HANDLER
  // ─────────────────────────────────────────

  changeDate(dateString) {
    if (!dateString) return;

    const parts = dateString.split('-');
    this.selectedDate = new Date(parts[0], parts[1] - 1, parts[2]);
    this._updateDateDisplay();

    // Reload attendance jika kelas sudah dipilih
    if (this.currentClass) {
      this.attendanceData = {};
      this.selectClass(this.currentClass);
    }
  }

  // ─────────────────────────────────────────
  // QUICK MARK ALL
  // ─────────────────────────────────────────

  markAllAs(status) {
    if (!this.currentClass || this.currentStudents.length === 0) return;

    const statusObj = this.statusTextures.find(s => s.value === status);
    if (!statusObj) return;

    showConfirmDialog(
      `Tandai Semua "${statusObj.label}"`,
      `Tandai semua siswa di kelas <strong>${this.currentClass}</strong> sebagai <strong>${statusObj.icon} ${statusObj.label}</strong>?<br><br>Data absensi yang sudah ada akan ditimpa.`
    ).then(confirmed => {
      if (!confirmed) return;

      const now = new Date();
      const timeStr = formatTime ? formatTime(now) : now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

      this.currentStudents.forEach(student => {
        const nis = String(student.NIS || student.nis);
        const name = student['Nama Siswa'] || student.nama_siswa || student.name || '';

        this.attendanceData[nis] = {
          status: status,
          name: name,
          time: timeStr,
          note: '',
          synced: false,
          classData: student
        };
      });

      this._renderStudentList();
      this._updateSummary();
      this._updateBottomBar();
      showToast(`Semua siswa ditandai sebagai ${statusObj.label}`, 'success');
    });
  }

  // ─────────────────────────────────────────
  // SEARCH / FILTER
  // ─────────────────────────────────────────

  filterStudents(query) {
    const cards = document.querySelectorAll('.student-card');
    const lowerQuery = query.toLowerCase().trim();

    cards.forEach(card => {
      const nameEl = card.querySelector('.student-name');
      const nisEl = card.querySelector('.student-nis');
      const name = nameEl ? nameEl.textContent.toLowerCase() : '';
      const nis = nisEl ? nisEl.textContent.toLowerCase() : '';

      if (lowerQuery === '' || name.includes(lowerQuery) || nis.includes(lowerQuery)) {
        card.style.display = '';
      } else {
        card.style.display = 'none';
      }
    });
  }

  // ─────────────────────────────────────────
  // CLEANUP
  // ─────────────────────────────────────────

  destroy() {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
  }
}

// ==========================================
// GLOBAL UTILITY FUNCTIONS
// ==========================================

/**
 * Custom Confirm Dialog — menggantikan window.confirm()
 */
function showConfirmDialog(title, message) {
  return new Promise((resolve) => {
    // Hapus dialog sebelumnya jika ada
    const existing = document.getElementById('confirmDialog');
    if (existing) existing.remove();

    const dialog = document.createElement('div');
    dialog.id = 'confirmDialog';
    dialog.className = 'modal-overlay active';
    dialog.innerHTML = `
      <div class="modal-box confirm-box">
        <h3 class="modal-title">${title}</h3>
        <div class="modal-message">${message}</div>
        <div class="modal-actions">
          <button class="modal-btn modal-btn-cancel" id="confirmCancel">Batal</button>
          <button class="modal-btn modal-btn-confirm" id="confirmOk">Ya, Lanjutkan</button>
        </div>
      </div>`;

    document.body.appendChild(dialog);

    // Focus trap
    const okBtn = document.getElementById('confirmOk');
    const cancelBtn = document.getElementById('confirmCancel');

    const close = (result) => {
      dialog.classList.remove('active');
      setTimeout(() => dialog.remove(), 200);
      resolve(result);
    };

    okBtn.addEventListener('click', () => close(true));
    cancelBtn.addEventListener('click', () => close(false));
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) close(false);
    });

    // Keyboard
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        close(false);
        document.removeEventListener('keydown', handleKey);
      } else if (e.key === 'Enter') {
        close(true);
        document.removeEventListener('keydown', handleKey);
      }
    };
    document.addEventListener('keydown', handleKey);

    okBtn.focus();
  });
}

/**
 * Show Attendance Summary Modal
 */
function showAttendanceSummary(data) {
  const existing = document.getElementById('summaryModal');
  if (existing) existing.remove();

  const statuses = SMART_ABSEN_CONFIG.app.attendanceStatuses;

  let summaryHtml = '';
  statuses.forEach(s => {
    const count = data.summary[s.value] || 0;
    summaryHtml += `
      <div class="summary-row">
        <span>${s.icon} ${s.label}</span>
        <strong style="color: ${s.color}">${count}</strong>
      </div>`;
  });

  if (data.summary.belum_absen > 0) {
    summaryHtml += `
      <div class="summary-row">
        <span>⏳ Belum Absen</span>
        <strong style="color: #6b7280">${data.summary.belum_absen}</strong>
      </div>`;
  }

  const modal = document.createElement('div');
  modal.id = 'summaryModal';
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal-box summary-box">
      <div class="summary-header">
        <h3 class="modal-title">✅ Absensi Berhasil Disimpan</h3>
        ${data.offline ? '<span class="offline-badge">📊 Mode Offline</span>' : ''}
      </div>
      <div class="summary-meta">
        <p>📅 ${data.date}</p>
        <p>🏫 ${data.className}</p>
      </div>
      <div class="summary-stats">
        ${summaryHtml}
      </div>
      <div class="summary-footer">
        <p>Total: <strong>${data.marked}</strong> dari <strong>${data.total}</strong> siswa</p>
        <p>Persentase Kehadiran: <strong>${data.summary.percentage}%</strong></p>
        ${data.failed > 0 ? `<p class="error-text">⚠️ ${data.failed} data gagal disimpan</p>` : ''}
      </div>
      <div class="modal-actions">
        <button class="modal-btn modal-btn-confirm" id="summaryClose">Tutup</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  const closeBtn = document.getElementById('summaryClose');
  const closeModal = () => {
    modal.classList.remove('active');
    setTimeout(() => modal.remove(), 200);
  };

  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
}

/**
 * Render Student List (called externally if needed)
 */
function renderStudentList(students, attendanceData) {
  const container = document.getElementById('studentListContainer');
  if (!container || !students) return;

  const statuses = SMART_ABSEN_CONFIG.app.attendanceStatuses;
  let html = '';

  students.forEach((student, index) => {
    const nis = String(student.NIS || student.nis);
    const name = student['Nama Siswa'] || student.nama_siswa || student.name || 'Tanpa Nama';
    const gender = student['Jenis Kelamin'] || student.jenis_kelamin || student.gender || '';
    const data = attendanceData[nis];
    const currentStatus = data ? data.status : null;
    const timeStr = data ? data.time : '';
    const isEven = index % 2 === 0;

    html += `
      <div class="student-card ${isEven ? 'card-even' : 'card-odd'} ${currentStatus ? 'card-marked' : ''}" 
           id="card-${nis}" data-nis="${nis}">
        <div class="student-info">
          <div class="student-avatar-small">${gender === 'P' ? '👩' : gender === 'L' ? '👦' : '👤'}</div>
          <div class="student-details">
            <div class="student-name">${name}</div>
            <div class="student-nis">NIS: ${nis}</div>
          </div>
          ${timeStr ? `<div class="student-time">${timeStr}</div>` : ''}
        </div>
        <div class="status-buttons">
          ${statuses.map(s => `
            <button class="status-btn ${currentStatus === s.value ? 'active' : ''}"
                    style="--btn-color: ${s.color}"
                    onclick="attendanceController.markAttendance('${nis}', '${name}', '${s.value}')"
                    title="${s.label}">
              <span class="btn-icon">${s.icon}</span>
              <span class="btn-label">${s.value}</span>
            </button>
          `).join('')}
        </div>
      </div>`;
  });

  container.innerHTML = html;
}

/**
 * Update Sync Badge in header
 */
function updateSyncBadge(count) {
  const badge = document.getElementById('syncBadge');
  if (!badge) return;

  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'flex';
    badge.classList.add('pulse');
    setTimeout(() => badge.classList.remove('pulse'), 1000);
  } else {
    badge.style.display = 'none';
  }
}

/**
 * Auto-save timer — saves unsaved records every 30 seconds
 */
function autoSaveTimer() {
  if (!window.attendanceController) return;
  window.attendanceController._startAutoSaveTimer();
}

// ==========================================
// INITIALIZATION ON DOM READY
// ==========================================

let attendanceController = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Register service worker update check
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('sw.js');
      registration.update();
      console.log('[Absen] Service worker terdaftar');
    } catch (error) {
      console.log('[Absen] Service worker tidak tersedia:', error.message);
    }
  }

  // Buat instance controller
  attendanceController = new AttendanceController();
  window.attendanceController = attendanceController;

  // Setup event listeners
  const classSelector = document.getElementById('classSelector');
  const loadBtn = document.getElementById('loadStudentsBtn');
  const dateInput = document.getElementById('dateInput');
  const submitBtn = document.getElementById('submitAllBtn');
  const searchInput = document.getElementById('searchInput');
  const markAllHadir = document.getElementById('markAllHadir');
  const markAllBtns = document.querySelectorAll('[data-mark-all]');

  if (classSelector) {
    classSelector.addEventListener('change', (e) => {
      if (e.target.value) {
        attendanceController.selectClass(e.target.value);
      }
    });
  }

  if (loadBtn) {
    loadBtn.addEventListener('click', () => {
      const cls = document.getElementById('classSelector');
      if (cls && cls.value) {
        attendanceController.selectClass(cls.value);
      } else {
        showToast('Pilih kelas terlebih dahulu', 'warning');
      }
    });
  }

  if (dateInput) {
    dateInput.addEventListener('change', (e) => {
      attendanceController.changeDate(e.target.value);
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      attendanceController.submitAllAttendance();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      attendanceController.filterStudents(e.target.value);
    });
  }

  // Mark All buttons
  markAllBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const status = btn.getAttribute('data-mark-all');
      if (status && attendanceController.currentClass) {
        attendanceController.markAllAs(status);
      }
    });
  });

  if (markAllHadir) {
    markAllHadir.addEventListener('click', () => {
      if (attendanceController.currentClass) {
        attendanceController.markAllAs('H');
      } else {
        showToast('Pilih kelas terlebih dahulu', 'warning');
      }
    });
  }

  // Sync badge refresh interval
  setInterval(() => {
    if (attendanceController) {
      updateSyncBadge(attendanceController.offlineQueue.getPendingCount());
    }
  }, 5000);

  // Start initialization
  attendanceController.init();
});
