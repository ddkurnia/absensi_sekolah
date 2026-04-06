/**
 * ============================================================
 *  SMART ABSEN ENTERPRISE v2.0 — KONFIGURASI
 * ============================================================
 *  
 *  📋 PANDUAN SETUP:
 *  
 *  1. Buka https://console.firebase.google.com
 *     → Buat project baru
 *     → Aktifkan Authentication > Google Sign-In
 *     → Aktifkan Cloud Firestore
 *     → Buka Project Settings > Web App > Register App
 *     → Copy konfigurasi ke bawah ini
 *  
 *  2. Buka https://console.cloud.google.com
 *     → Pilih project Firebase tadi
 *     → Enable APIs: Google Sheets API, Google Drive API
 *     → Buka Credentials > Create OAuth 2.0 Client ID
 *       (Application type: Web application)
 *     → Tambahkan Authorized JavaScript Origins
 *       (URL deploy kamu, contoh: https://yourname.github.io)
 *     → Copy Client ID ke bawah ini
 *  
 *  3. Buka file ini, isi semua bagian yang bertanda [ISI...]
 *  
 *  4. Upload semua file ke GitHub Pages / hosting
 *  
 * ============================================================
 */

const SMART_ABSEN_CONFIG = {

  // ─────────────────────────────────────────────
  // 🔥 FIREBASE CONFIGURATION
  // ─────────────────────────────────────────────
  firebase: {
    apiKey: '[ISI DARI FIREBASE CONSOLE]',
    authDomain: '[ISI PROJECT ID].firebaseapp.com',
    projectId: '[ISI PROJECT ID]',
    storageBucket: '[ISI PROJECT ID].appspot.com',
    messagingSenderId: '[ISI DARI FIREBASE CONSOLE]',
    appId: '[ISI DARI FIREBASE CONSOLE]',
  },

  // ─────────────────────────────────────────────
  // 🔐 GOOGLE OAUTH CONFIGURATION
  // ─────────────────────────────────────────────
  google: {
    // Client ID dari Google Cloud Console > Credentials > OAuth 2.0
    clientId: '[ISI DARI GOOGLE CLOUD CONSOLE].apps.googleusercontent.com',
    
    // API Scopes yang dibutuhkan
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',    // Akses Google Sheets
      'https://www.googleapis.com/auth/drive.file',       // Buat file di Drive
      'https://www.googleapis.com/auth/userinfo.profile', // Info profil
      'https://www.googleapis.com/auth/userinfo.email',   // Info email
    ],
    
    // Discovery docs
    discoveryDocs: [
      'https://sheets.googleapis.com/$discovery/rest?version=v4',
      'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
    ],
  },

  // ─────────────────────────────────────────────
  // 📱 WHATSAPP API (Opsional)
  // ─────────────────────────────────────────────
  whatsapp: {
    // URL API WhatsApp (contoh: Fonnte, Wablas, dll)
    apiUrl: '',
    // API Key WhatsApp
    apiKey: '',
    // Template pesan (variabel: {nama_siswa}, {kelas}, {status}, {tanggal}, {waktu})
    template: '🚨 *NOTIFIKASI ABSENSI*\n\n' +
              'Yth. Orang Tua/Wali dari *{nama_siswa}*\n' +
              'Kelas: {kelas}\n\n' +
              '📅 Tanggal: {tanggal}\n' +
              '⏰ Waktu: {waktu}\n' +
              '📊 Status: *{status}*\n\n' +
              'Terima kasih,\n*{nama_sekolah}*',
  },

  // ─────────────────────────────────────────────
  // ⚙️ APP CONFIGURATION
  // ─────────────────────────────────────────────
  app: {
    name: 'Smart Absen Enterprise',
    version: '2.0.0',
    
    // Email master admin (hanya email ini yang bisa akses panel admin)
    masterAdminEmail: '[ISI EMAIL MASTER ADMIN]',
    
    // Jam operasional sekolah
    schoolHours: {
      start: '07:00',
      end: '15:00',
    },
    
    // Status absensi yang tersedia
    attendanceStatuses: [
      { value: 'H', label: 'Hadir', color: '#22c55e', icon: '✅' },
      { value: 'S', label: 'Sakit', color: '#f59e0b', icon: '🤒' },
      { value: 'I', label: 'Izin', color: '#3b82f6', icon: '📝' },
      { value: 'A', label: 'Alpha', color: '#ef4444', icon: '❌' },
      { value: 'T', label: 'Terlambat', color: '#f97316', icon: '⏰' },
    ],
    
    // Jenis kelamin
    genders: [
      { value: 'L', label: 'Laki-laki' },
      { value: 'P', label: 'Perempuan' },
    ],
    
    // Role pengguna
    roles: [
      { value: 'admin', label: 'Administrator' },
      { value: 'guru', label: 'Guru' },
      { value: 'wali_kelas', label: 'Wali Kelas' },
    ],
  },

  // ─────────────────────────────────────────────
  // 📊 GOOGLE SHEETS TEMPLATE
  // ─────────────────────────────────────────────
  sheets: {
    // Nama sheet dan header kolom
    structure: {
      'Siswa': ['ID', 'NIS', 'Nama Siswa', 'Kelas', 'Jenis Kelamin', 'No HP Ortu', 'Alamat', 'Status Aktif'],
      'Kelas': ['ID', 'Nama Kelas', 'Tingkat', 'Wali Kelas', 'Kapasitas', 'Jumlah Siswa'],
      'Guru': ['ID', 'Nama Guru', 'Email', 'Mata Pelajaran', 'No HP', 'Role', 'Status Aktif'],
      'Absensi': ['ID', 'Tanggal', 'Kelas', 'NIS', 'Nama Siswa', 'Status', 'Jam Masuk', 'Keterangan', 'Guru Penginput', 'Sync Status'],
      'Pengaturan': ['Key', 'Value', 'Keterangan'],
    },
    
    // Warna header (background, font)
    headerStyle: {
      background: { red: 0.1, green: 0.3, blue: 0.6 },
      fontColor: { red: 1, green: 1, blue: 1 },
      bold: true,
      fontSize: 11,
    },
    
    // Kolom lebar default
    columnWidths: [60, 80, 200, 100, 80, 150, 250, 80],
  },
};

// ═══════════════════════════════════════════════
// JANGAN UBAH KODE DI BAWAH INI
// ═══════════════════════════════════════════════

// Validasi config
function validateConfig() {
  const errors = [];
  const fb = SMART_ABSEN_CONFIG.firebase;
  const gg = SMART_ABSEN_CONFIG.google;
  const app = SMART_ABSEN_CONFIG.app;
  
  if (!fb.apiKey || fb.apiKey.includes('[ISI')) errors.push('Firebase API Key belum diisi');
  if (!fb.projectId || fb.projectId.includes('[ISI')) errors.push('Firebase Project ID belum diisi');
  if (!gg.clientId || gg.clientId.includes('[ISI')) errors.push('Google Client ID belum diisi');
  if (!app.masterAdminEmail || app.masterAdminEmail.includes('[ISI')) errors.push('Master Admin Email belum diisi');
  
  return errors;
}

// Cek apakah config sudah lengkap
function isConfigReady() {
  return validateConfig().length === 0;
}

// Template pesan WhatsApp
function formatWhatsAppMessage(data) {
  let msg = SMART_ABSEN_CONFIG.whatsapp.template;
  Object.keys(data).forEach(key => {
    msg = msg.replace(new RegExp(`\\{${key}\\}`, 'g'), data[key] || '-');
  });
  return msg;
}
