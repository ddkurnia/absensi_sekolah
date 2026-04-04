function doPost(e) {
  var sheetApp = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = sheetApp.getSheetByName("LogAbsen"); // Kolom: Tanggal, NIS, Nama, Waktu, Status, Keterangan
  var dataSiswaSheet = sheetApp.getSheetByName("DataSiswa"); // Kolom: NIS, Nama, Kelas, NoOrtu
  var tanggal = new Date().toLocaleDateString('id-ID');
  
  // 1. CEK WEBHOOK WA BOT (Format: IZIN#NIS#ALASAN)
  if(e.parameter && e.parameter.message) {
    var waMsg = e.parameter.message.toString().trim().toUpperCase(); 
    if(waMsg.startsWith("IZIN#")) {
      var parts = waMsg.split("#");
      if(parts.length >= 3) {
        var s = findSiswa(dataSiswaSheet, parts[1]);
        if(s) {
          logSheet.appendRow([tanggal, parts[1], s.nama, "VIA WA", "SAKIT/IZIN", parts[2]]);
          return ContentService.createTextOutput(JSON.stringify({reply: "Data izin ananda " + s.nama + " telah dicatat sistem."})).setMimeType(ContentService.MimeType.JSON);
        }
      }
    }
  }

  // 2. LOGIKA APLIKASI UTAMA (JSON)
  try {
    var req = JSON.parse(e.postData.contents);
    
    // A. Mode Sync Offline (Batch)
    if(req.action === "sync_batch") {
      var dataBatch = req.data;
      for(var i=0; i<dataBatch.length; i++) {
        var item = dataBatch[i];
        var sMatch = findSiswa(dataSiswaSheet, item.nis);
        var n = sMatch ? sMatch.nama : "Tidak Dikenal";
        logSheet.appendRow([tanggal, item.nis, n, item.waktu, item.statusMode + " (Sync)", "-"]);
      }
      return ContentService.createTextOutput(JSON.stringify({status: "success"})).setMimeType(ContentService.MimeType.JSON);
    }
    
    // B. Mode Absen Normal (Single Scan)
    if(req.action === "absen") {
      var sMatch = findSiswa(dataSiswaSheet, req.nis);
      if(sMatch) {
        logSheet.appendRow([tanggal, req.nis, sMatch.nama, req.waktu, req.statusMode, "-"]);
        // Script pengiriman WA bisa ditambahkan di sini via fetch UrlFetchApp
        return ContentService.createTextOutput(JSON.stringify({status: "success", nama: sMatch.nama})).setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({status: "not_found"})).setMimeType(ContentService.MimeType.JSON);
      }
    }
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({status: "error", msg: err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

function findSiswa(sheet, nis) {
  var data = sheet.getDataRange().getValues();
  for(var i=1; i<data.length; i++) {
    if(data[i][0].toString() === nis.toString()) {
      return { nama: data[i][1], kelas: data[i][2], noOrtu: data[i][3] };
    }
  }
  return null;
}
