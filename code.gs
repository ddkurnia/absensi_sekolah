// ====================================================
// SMART ABSEN ENTERPRISE v2.0 - Google Apps Script Backend
// ====================================================
// Deploy sebagai Web App (Execute as: Me, Access: Anyone)
// Sheet yang dibutuhkan: "LogAbsen", "DataSiswa", "DataKelas", "DataGuru", "Pengaturan"
// ====================================================

function doPost(e) {
  var sheetApp = SpreadsheetApp.getActiveSpreadsheet();
  var tanggal = new Date().toLocaleDateString('id-ID');
  
  // 1. CEK WEBHOOK WA BOT (Format: IZIN#NIS#ALASAN atau SAKIT#NIS#ALASAN)
  if(e.parameter && e.parameter.message) {
    var waMsg = e.parameter.message.toString().trim().toUpperCase();
    if(waMsg.startsWith("IZIN#") || waMsg.startsWith("SAKIT#")) {
      var parts = waMsg.split("#");
      if(parts.length >= 3) {
        var s = findSiswa(sheetApp, parts[1]);
        if(s) {
          var logSheet = sheetApp.getSheetByName("LogAbsen");
          var status = parts[0]; // IZIN atau SAKIT
          logSheet.appendRow([tanggal, parts[1], s.nama, "VIA WA", status, parts[2]]);
          return ContentService.createTextOutput(JSON.stringify({
            reply: "Data " + status.toLowerCase() + " ananda " + s.nama + " telah dicatat sistem. Terima kasih."
          })).setMimeType(ContentService.MimeType.JSON);
        }
      }
    }
  }

  // 2. LOGIKA APLIKASI UTAMA (JSON)
  try {
    var req = JSON.parse(e.postData.contents);
    
    // A. Mode Sync Offline (Batch)
    if(req.action === "sync_batch") {
      var logSheet = sheetApp.getSheetByName("LogAbsen");
      var dataBatch = req.data;
      for(var i = 0; i < dataBatch.length; i++) {
        var item = dataBatch[i];
        var sMatch = findSiswa(sheetApp, item.nis);
        var n = sMatch ? sMatch.nama : "Tidak Dikenal";
        var k = sMatch ? sMatch.kelas : "-";
        logSheet.appendRow([tanggal, item.nis, n, k, item.waktu, item.statusMode + " (Sync)", "-"]);
      }
      return ContentService.createTextOutput(JSON.stringify({status:"success", count:dataBatch.length})).setMimeType(ContentService.MimeType.JSON);
    }
    
    // B. Mode Absen Normal (Single Scan)
    if(req.action === "absen") {
      var logSheet = sheetApp.getSheetByName("LogAbsen");
      var sMatch = findSiswa(sheetApp, req.nis);
      if(sMatch) {
        logSheet.appendRow([tanggal, req.nis, sMatch.nama, sMatch.kelas, req.waktu, req.statusMode, "-"]);
        
        // Kirim notifikasi WA jika diaktifkan
        if(req.statusMode !== "PULANG") {
          sendWaNotification(sMatch, req.waktu, req.statusMode);
        }
        
        return ContentService.createTextOutput(JSON.stringify({
          status:"success",
          nama: sMatch.nama,
          kelas: sMatch.kelas,
          nis: sMatch.nis,
          noOrtu: sMatch.noOrtu
        })).setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({status:"not_found"})).setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    // C. CRUD Siswa
    if(req.action === "get_siswa") {
      var dataSiswaSheet = sheetApp.getSheetByName("DataSiswa");
      var data = dataSiswaSheet.getDataRange().getValues();
      var result = [];
      for(var i = 1; i < data.length; i++) {
        if(data[i][0]) {
          result.push({ nis: data[i][0].toString(), nama: data[i][1], kelas: data[i][2], jk: data[i][3], noOrtu: data[i][4], telpOrtu: data[i][5], alamat: data[i][6], aktif: data[i][7] ? true : false });
        }
      }
      return ContentService.createTextOutput(JSON.stringify({status:"success", data:result})).setMimeType(ContentService.MimeType.JSON);
    }
    
    if(req.action === "add_siswa") {
      var dataSiswaSheet = sheetApp.getSheetByName("DataSiswa");
      var existing = findSiswa(dataSiswaSheet, req.nis);
      if(existing) return ContentService.createTextOutput(JSON.stringify({status:"error", msg:"NIS sudah ada"})).setMimeType(ContentService.MimeType.JSON);
      dataSiswaSheet.appendRow([req.nis, req.nama, req.kelas, req.jk||"L", req.noOrtu||"", req.telpOrtu||"", req.alamat||"", req.aktif!==false ? "Ya" : "Tidak"]);
      return ContentService.createTextOutput(JSON.stringify({status:"success"})).setMimeType(ContentService.MimeType.JSON);
    }
    
    if(req.action === "update_siswa") {
      var dataSiswaSheet = sheetApp.getSheetByName("DataSiswa");
      var data = dataSiswaSheet.getDataRange().getValues();
      for(var i = 1; i < data.length; i++) {
        if(data[i][0].toString() === req.nis) {
          dataSiswaSheet.getRange(i+1, 1, 1, 8).setValues([[req.nis, req.nama, req.kelas, req.jk||"L", req.noOrtu||"", req.telpOrtu||"", req.alamat||"", req.aktif!==false ? "Ya" : "Tidak"]]);
          return ContentService.createTextOutput(JSON.stringify({status:"success"})).setMimeType(ContentService.MimeType.JSON);
        }
      }
      return ContentService.createTextOutput(JSON.stringify({status:"error", msg:"Siswa tidak ditemukan"})).setMimeType(ContentService.MimeType.JSON);
    }
    
    if(req.action === "delete_siswa") {
      var dataSiswaSheet = sheetApp.getSheetByName("DataSiswa");
      var data = dataSiswaSheet.getDataRange().getValues();
      for(var i = 1; i < data.length; i++) {
        if(data[i][0].toString() === req.nis) {
          dataSiswaSheet.deleteRow(i+1);
          return ContentService.createTextOutput(JSON.stringify({status:"success"})).setMimeType(ContentService.MimeType.JSON);
        }
      }
      return ContentService.createTextOutput(JSON.stringify({status:"error", msg:"Siswa tidak ditemukan"})).setMimeType(ContentService.MimeType.JSON);
    }
    
    // D. CRUD Kelas
    if(req.action === "get_kelas") {
      var dataKelasSheet = sheetApp.getSheetByName("DataKelas");
      if(!dataKelasSheet) return ContentService.createTextOutput(JSON.stringify({status:"success", data:[]})).setMimeType(ContentService.MimeType.JSON);
      var data = dataKelasSheet.getDataRange().getValues();
      var result = [];
      for(var i = 1; i < data.length; i++) {
        if(data[i][0]) result.push({ nama: data[i][0], tingkat: data[i][1], jurusan: data[i][2], waliKelas: data[i][3] });
      }
      return ContentService.createTextOutput(JSON.stringify({status:"success", data:result})).setMimeType(ContentService.MimeType.JSON);
    }
    
    if(req.action === "add_kelas") {
      var dataKelasSheet = sheetApp.getSheetByName("DataKelas");
      if(!dataKelasSheet) dataKelasSheet = sheetApp.insertSheet("DataKelas");
      dataKelasSheet.appendRow([req.nama, req.tingkat, req.jurusan||"", req.waliKelas||""]);
      return ContentService.createTextOutput(JSON.stringify({status:"success"})).setMimeType(ContentService.MimeType.JSON);
    }
    
    // E. CRUD Guru
    if(req.action === "get_guru") {
      var dataGuruSheet = sheetApp.getSheetByName("DataGuru");
      if(!dataGuruSheet) return ContentService.createTextOutput(JSON.stringify({status:"success", data:[]})).setMimeType(ContentService.MimeType.JSON);
      var data = dataGuruSheet.getDataRange().getValues();
      var result = [];
      for(var i = 1; i < data.length; i++) {
        if(data[i][0]) result.push({ nip: data[i][0].toString(), nama: data[i][1], role: data[i][2], telepon: data[i][3], email: data[i][4] });
      }
      return ContentService.createTextOutput(JSON.stringify({status:"success", data:result})).setMimeType(ContentService.MimeType.JSON);
    }
    
    if(req.action === "add_guru") {
      var dataGuruSheet = sheetApp.getSheetByName("DataGuru");
      if(!dataGuruSheet) dataGuruSheet = sheetApp.insertSheet("DataGuru");
      dataGuruSheet.appendRow([req.nip, req.nama, req.role||"guru", req.telepon||"", req.email||""]);
      return ContentService.createTextOutput(JSON.stringify({status:"success"})).setMimeType(ContentService.MimeType.JSON);
    }
    
    // F. Get Pengaturan
    if(req.action === "get_settings") {
      var settingsSheet = sheetApp.getSheetByName("Pengaturan");
      if(!settingsSheet) return ContentService.createTextOutput(JSON.stringify({status:"success", data:{}})).setMimeType(ContentService.MimeType.JSON);
      var data = settingsSheet.getDataRange().getValues();
      var settings = {};
      for(var i = 1; i < data.length; i++) {
        if(data[i][0]) settings[data[i][0]] = data[i][1];
      }
      return ContentService.createTextOutput(JSON.stringify({status:"success", data:settings})).setMimeType(ContentService.MimeType.JSON);
    }
    
    // G. Auth (verifikasi login)
    if(req.action === "auth") {
      var dataGuruSheet = sheetApp.getSheetByName("DataGuru");
      if(!dataGuruSheet) return ContentService.createTextOutput(JSON.stringify({status:"error", msg:"Data guru belum ada"})).setMimeType(ContentService.MimeType.JSON);
      var data = dataGuruSheet.getDataRange().getValues();
      for(var i = 1; i < data.length; i++) {
        if(data[i][0].toString() === req.nip && data[i][5] === req.password) {
          return ContentService.createTextOutput(JSON.stringify({status:"success", nama:data[i][1], nip:data[i][0], role:data[i][2]})).setMimeType(ContentService.MimeType.JSON);
        }
      }
      return ContentService.createTextOutput(JSON.stringify({status:"not_found"})).setMimeType(ContentService.MimeType.JSON);
    }
    
    // H. Get Dashboard Data
    if(req.action === "dashboard") {
      var logSheet = sheetApp.getSheetByName("LogAbsen");
      var data = logSheet.getDataRange().getValues();
      var todayStats = { hadir:0, telat:0, pulang:0, izin:0, sakit:0, alfa:0 };
      var recentLogs = [];
      
      for(var i = data.length - 1; i >= 1 && recentLogs.length < 20; i--) {
        if(data[i][0] === tanggal) {
          var status = data[i][5].toString().toUpperCase();
          if(status.includes("HADIR") && !status.includes("TERLAMBAT")) todayStats.hadir++;
          else if(status.includes("TERLAMBAT")) todayStats.telat++;
          else if(status.includes("PULANG")) todayStats.pulang++;
          else if(status.includes("IZIN")) todayStats.izin++;
          else if(status.includes("SAKIT")) todayStats.sakit++;
          else todayStats.alfa++;
          
          recentLogs.push({ waktu: data[i][4], nama: data[i][2], kelas: data[i][3], status: status });
        }
      }
      
      return ContentService.createTextOutput(JSON.stringify({status:"success", stats:todayStats, recent:recentLogs})).setMimeType(ContentService.MimeType.JSON);
    }
    
    // I. Update Absensi (edit status)
    if(req.action === "update_absensi") {
      var logSheet = sheetApp.getSheetByName("LogAbsen");
      var data = logSheet.getDataRange().getValues();
      for(var i = 1; i < data.length; i++) {
        if(data[i][1].toString() === req.nis && data[i][0] === req.tanggal) {
          logSheet.getRange(i+1, 6).setValue(req.status);
          logSheet.getRange(i+1, 7).setValue(req.keterangan || "-");
          return ContentService.createTextOutput(JSON.stringify({status:"success"})).setMimeType(ContentService.MimeType.JSON);
        }
      }
      return ContentService.createTextOutput(JSON.stringify({status:"error", msg:"Data tidak ditemukan"})).setMimeType(ContentService.MimeType.JSON);
    }
    
    // J. Manually add IZIN/SAKIT/ALFA
    if(req.action === "manual_absen") {
      var logSheet = sheetApp.getSheetByName("LogAbsen");
      var sMatch = findSiswa(sheetApp, req.nis);
      if(sMatch) {
        logSheet.appendRow([req.tanggal || tanggal, req.nis, sMatch.nama, sMatch.kelas, "-", req.status, req.keterangan || "Manual input"]);
        return ContentService.createTextOutput(JSON.stringify({status:"success", nama:sMatch.nama})).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({status:"not_found"})).setMimeType(ContentService.MimeType.JSON);
    }
    
    // K. Batch Absen Guru - Teacher submits attendance for entire class
    if(req.action === "batch_absen_guru") {
      var logSheet = sheetApp.getSheetByName("LogAbsen");
      var tanggal = req.tanggal || new Date().toLocaleDateString('id-ID');
      var dataBatch = req.data;
      var results = { success: 0, failed: 0, waSent: 0 };
      
      for(var i = 0; i < dataBatch.length; i++) {
        var item = dataBatch[i];
        try {
          var sMatch = findSiswa(sheetApp, item.nis);
          var nama = sMatch ? sMatch.nama : (item.nama || "Tidak Dikenal");
          var kelas = sMatch ? sMatch.kelas : (item.kelas || "-");
          var telpOrtu = sMatch ? sMatch.telpOrtu : "";
          
          // Check if already exists for this date+NIS
          var existingData = logSheet.getDataRange().getValues();
          var found = false;
          for(var j = 1; j < existingData.length; j++) {
            if(existingData[j][0] === tanggal && existingData[j][1].toString() === item.nis.toString()) {
              // Update existing record
              logSheet.getRange(j+1, 5, 1, 3).setValues([[item.waktu || "-", item.status, item.keterangan || "-"]]);
              found = true;
              break;
            }
          }
          
          if(!found) {
            logSheet.appendRow([tanggal, item.nis, nama, kelas, item.waktu || "-", item.status, item.keterangan || "-"]);
          }
          
          results.success++;
          
          // Send WA notification (trigger WA API)
          if(req.sendWa === true && item.status) {
            var waSent = sendWaNotificationGuru(nama, kelas, tanggal, item.status, item.keterangan, telpOrtu);
            if(waSent) results.waSent++;
          }
        } catch(e) {
          results.failed++;
        }
      }
      
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        results: results
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // L. Get attendance records by date and class
    if(req.action === "get_absen_kelas") {
      var logSheet = sheetApp.getSheetByName("LogAbsen");
      var data = logSheet.getDataRange().getValues();
      var result = [];
      var tanggal = req.tanggal;
      var kelas = req.kelas;
      
      for(var i = 1; i < data.length; i++) {
        if(data[i][0] === tanggal && data[i][3] === kelas) {
          result.push({
            tanggal: data[i][0], nis: data[i][1].toString(), nama: data[i][2],
            kelas: data[i][3], waktu: data[i][4], status: data[i][5], keterangan: data[i][6]
          });
        }
      }
      
      return ContentService.createTextOutput(JSON.stringify({status:"success", data:result})).setMimeType(ContentService.MimeType.JSON);
    }
    
    return ContentService.createTextOutput(JSON.stringify({status:"error", msg:"Action tidak dikenali"})).setMimeType(ContentService.MimeType.JSON);
    
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({status:"error", msg:err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

// ===== HELPER FUNCTIONS =====

function findSiswa(sheetApp, nis) {
  var dataSiswaSheet = sheetApp.getSheetByName("DataSiswa");
  if(!dataSiswaSheet) return null;
  var data = dataSiswaSheet.getDataRange().getValues();
  for(var i = 1; i < data.length; i++) {
    if(data[i][0].toString() === nis.toString()) {
      return { nis: data[i][0].toString(), nama: data[i][1], kelas: data[i][2], jk: data[i][3], noOrtu: data[i][4], telpOrtu: data[i][5] };
    }
  }
  return null;
}

function sendWaNotification(siswa, waktu, status) {
  var settingsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Pengaturan");
  if(!settingsSheet) return;
  var data = settingsSheet.getDataRange().getValues();
  var settings = {};
  for(var i = 1; i < data.length; i++) {
    if(data[i][0]) settings[data[i][0]] = data[i][1];
  }
  
  // Cek apakah WA aktif
  if(settings['waEnable'] !== 'true') return;
  var waAdmin = settings['waAdmin'];
  if(!waAdmin) return;
  
  // Kirim notifikasi via WA API (gunakan FONNTE, WAHA, dll.)
  var pesan = "";
  if(status === "HADIR") pesan = (settings['waMasuk'] || "").replace("[NAMA]", siswa.nama).replace("[WAKTU]", waktu).replace("[KELAS]", siswa.kelas);
  else if(status === "TERLAMBAT") pesan = (settings['waTelat'] || "").replace("[NAMA]", siswa.nama).replace("[WAKTU]", waktu).replace("[KELAS]", siswa.kelas);
  
  if(!pesan) return;
  
  // Kirim ke orang tua siswa jika ada nomor
  var targetPhone = siswa.telpOrtu || waAdmin;
  if(!targetPhone || targetPhone.length < 10) return;
  
  try {
    // Contoh: menggunakan FONNTE API
    // var payload = { target: targetPhone, message: pesan };
    // UrlFetchApp.fetch("https://api.fonnte.com/send", { method:"POST", headers:{Authorization:"YOUR_API_KEY"}, payload:JSON.stringify(payload), contentType:"application/json" });
    Logger.log("WA notification queued for: " + siswa.nama + " -> " + targetPhone);
  } catch(e) {
    Logger.log("WA send error: " + e.toString());
  }
}

// ===== WA NOTIFICATION FOR TEACHER ATTENDANCE =====
function sendWaNotificationGuru(nama, kelas, tanggal, status, keterangan, telpOrtu) {
  var settingsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Pengaturan");
  if(!settingsSheet) return false;
  var data = settingsSheet.getDataRange().getValues();
  var settings = {};
  for(var i = 1; i < data.length; i++) {
    if(data[i][0]) settings[data[i][0]] = data[i][1];
  }
  
  // Cek apakah WA aktif
  if(settings['waEnable'] !== 'true') return false;
  
  var waApiUrl = settings['waApiUrl'] || '';
  var waApiKey = settings['waApiKey'] || '';
  var waDeviceId = settings['waDeviceId'] || '';
  
  // Jika tidak ada WA API config, cek WA admin lama
  if(!waApiUrl && !waApiKey) {
    var waAdmin = settings['waAdmin'];
    if(!waAdmin) return false;
    // Legacy: gunakan WA admin
    Logger.log("WA notification (legacy) for: " + nama + " status: " + status);
    return true;
  }
  
  // Tentukan pesan berdasarkan status
  var pesan = "";
  var statusLower = status.toString().toUpperCase();
  
  if(statusLower === "HADIR") {
    pesan = (settings['waMasuk'] || "Assalamualaikum, Ananda *[NAMA]* ([KELAS]) telah HADIR di sekolah pada [TANGGAL]. Terima kasih.");
  } else if(statusLower === "SAKIT") {
    pesan = "Assalamualaikum, Ananda *[NAMA]* ([KELAS]) hari ini SAKIT" + (keterangan ? ". Ket: " + keterangan : "") + ". Mohon istirahat yang cukup.";
  } else if(statusLower === "IZIN") {
    pesan = "Assalamualaikum, Ananda *[NAMA]* ([KELAS]) hari ini IZIN" + (keterangan ? ". Ket: " + keterangan : "") + ". Terima kasih konfirmasinya.";
  } else if(statusLower === "ALFA") {
    pesan = "Assalamualaikum, Ananda *[NAMA]* ([KELAS]) hari ini TIDAK HADIR (ALFA) pada [TANGGAL]. Mohon konfirmasi ke pihak sekolah.";
  } else if(statusLower === "TERLAMBAT") {
    pesan = (settings['waTelat'] || "Assalamualaikum, Ananda *[NAMA]* ([KELAS]) hari ini TERLAMBAT masuk sekolah. Mohon perhatian.");
  }
  
  if(!pesan) return false;
  
  // Replace placeholders
  pesan = pesan.replace("[NAMA]", nama).replace("[KELAS]", kelas).replace("[TANGGAL]", tanggal);
  if(keterangan) pesan = pesan.replace("[KETERANGAN]", keterangan);
  
  // Kirim ke orang tua
  var targetPhone = telpOrtu;
  if(!targetPhone || targetPhone.length < 10) return false;
  
  // Format phone number (add 62 prefix if starts with 0)
  if(targetPhone.startsWith("0")) targetPhone = "62" + targetPhone.substring(1);
  
  try {
    // Kirim via WA API (FONNTE compatible)
    if(waApiUrl && waApiKey) {
      var payload = {
        target: targetPhone,
        message: pesan
      };
      if(waDeviceId) payload.deviceId = waDeviceId;
      
      var headers = {
        "Authorization": waApiKey,
        "Content-Type": "application/json"
      };
      
      UrlFetchApp.fetch(waApiUrl, {
        method: "POST",
        headers: headers,
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      
      Logger.log("WA sent to " + targetPhone + " for " + nama + " [" + status + "]");
      return true;
    }
  } catch(e) {
    Logger.log("WA send error for " + nama + ": " + e.toString());
  }
  
  return false;
}

// ===== GET Handler (untuk doGET - cek status) =====
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: "online",
    app: "Smart Absen Enterprise v2.0",
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}
