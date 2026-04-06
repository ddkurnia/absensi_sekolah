/**
 * ============================================================
 *  SMART ABSEN ENTERPRISE v2.0 — MAIN APPLICATION LOGIC
 * ============================================================
 *  This file contains all core services:
 *    - AuthService (Firebase + Google Sign-In)
 *    - SetupService (auto-create spreadsheet on first login)
 *    - SheetsService (CRUD for Google Sheets)
 *    - WhatsAppService (notifications)
 *    - OfflineQueue (offline attendance queue)
 *    - Utility functions
 * ============================================================
 */

'use strict';

// ═══════════════════════════════════════════════════════════
// A. GLOBALS & FIREBASE / GOOGLE API INITIALIZATION
// ═══════════════════════════════════════════════════════════

var _firebaseApp = null;
var _firebaseAuth = null;
var _firebaseDb = null;
var _gapiInitialized = false;
var _googleUser = null;

/**
 * Get the shared config object (from config.js)
 */
function getConfig() {
  return window.SMART_ABSEN_CONFIG;
}

/**
 * Initialize Firebase app (compat SDKs loaded via CDN in index.html)
 */
function initFirebase() {
  var cfg = getConfig().firebase;
  _firebaseApp = firebase.initializeApp({
    apiKey: cfg.apiKey,
    authDomain: cfg.authDomain,
    projectId: cfg.projectId,
    storageBucket: cfg.storageBucket,
    messagingSenderId: cfg.messagingSenderId,
    appId: cfg.appId
  });
  _firebaseAuth = firebase.auth();
  _firebaseDb = firebase.firestore();
  console.log('[Firebase] Initialized successfully');
  return { app: _firebaseApp, auth: _firebaseAuth, db: _firebaseDb };
}

/**
 * Initialize Google API client (gapi)
 * Returns a Promise that resolves when gapi is ready.
 */
function initGoogleAPI() {
  return new Promise(function (resolve, reject) {
    var cfg = getConfig().google;
    gapi.load('client:auth2', {
      callback: function () {
        gapi.client.init({
          clientId: cfg.clientId,
          scope: cfg.scopes.join(' '),
          discoveryDocs: cfg.discoveryDocs
        }).then(function () {
          _gapiInitialized = true;
          console.log('[Google API] Initialized successfully');
          resolve();
        }).catch(function (err) {
          console.error('[Google API] Init failed:', err);
          reject(err);
        });
      },
      onerror: function (err) {
        console.error('[Google API] Load failed:', err);
        reject(err);
      }
    });
  });
}

/**
 * Get the current Google access token string
 */
function getGoogleToken() {
  if (_firebaseAuth && _firebaseAuth.currentUser) {
    return _firebaseAuth.currentUser.getIdToken();
  }
  var stored = localStorage.getItem('smart_absen_google_token');
  return stored || null;
}

/**
 * Refresh the Google access token and store it
 */
function refreshGoogleToken() {
  return new Promise(function (resolve, reject) {
    if (!_firebaseAuth || !_firebaseAuth.currentUser) {
      reject(new Error('No authenticated user'));
      return;
    }
    _firebaseAuth.currentUser.getIdToken(true).then(function (token) {
      localStorage.setItem('smart_absen_google_token', token);
      resolve(token);
    }).catch(reject);
  });
}

/**
 * Get stored user data from localStorage
 */
function getStoredUser() {
  try {
    var raw = localStorage.getItem('smart_absen_user');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Save user data to localStorage
 */
function saveUserToStorage(user) {
  localStorage.setItem('smart_absen_user', JSON.stringify(user));
}

/**
 * Get stored sheet config from localStorage
 */
function getStoredSheetConfig() {
  try {
    var raw = localStorage.getItem('smart_absen_sheet_config');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Save sheet config to localStorage
 */
function saveSheetConfig(config) {
  localStorage.setItem('smart_absen_sheet_config', JSON.stringify(config));
}

/**
 * Clear all stored session data
 */
function clearSessionData() {
  localStorage.removeItem('smart_absen_user');
  localStorage.removeItem('smart_absen_sheet_config');
  localStorage.removeItem('smart_absen_google_token');
}


// ═══════════════════════════════════════════════════════════
// B. AUTHENTICATION SERVICE
// ═══════════════════════════════════════════════════════════

var AuthService = {

  /**
   * Sign in with Google (Firebase Auth popup)
   * After sign-in, checks Firestore for existing school registration.
   * Returns: { user, isNewUser, schoolConfig }
   */
  signInWithGoogle: function () {
    var self = this;
    return new Promise(function (resolve, reject) {
      var provider = new firebase.auth.GoogleAuthProvider();
      provider.addScope('profile');
      provider.addScope('email');
      provider.addScope('https://www.googleapis.com/auth/spreadsheets');
      provider.addScope('https://www.googleapis.com/auth/drive.file');

      _firebaseAuth.signInWithPopup(provider).then(function (result) {
        var user = result.user;
        var credential = result.credential;
        var idToken = credential.idToken;

        // Store Google token
        localStorage.setItem('smart_absen_google_token', idToken);

        // Update gapi auth
        if (_gapiInitialized) {
          gapi.auth.setToken({
            access_token: idToken,
            token_type: 'Bearer'
          });
        }

        // Build user object
        var userData = {
          uid: user.uid,
          email: user.email,
          name: user.displayName,
          photoURL: user.photoURL,
          role: self.isMasterAdmin(user.email) ? 'admin' : 'guru'
        };

        // Load system config from Firestore (WhatsApp API, etc.)
        return loadSystemConfig().then(function() {
          // Check Firestore for existing school
          return self._checkSchoolRegistration(user.uid, userData).then(function (schoolData) {
            resolve(schoolData);
          }).catch(function (err) {
            reject(err);
          });
        });

      }).catch(function (error) {
        console.error('[Auth] Sign-in error:', error);
        reject(error);
      });
    });
  },

  /**
   * Check Firestore for existing school registration
   * Returns: { user, isNewUser: true } or { user, isNewUser: false, schoolConfig }
   */
  _checkSchoolRegistration: function (uid, userData) {
    return _firebaseDb.collection('schools').doc(uid).get().then(function (doc) {
      if (doc.exists) {
        var schoolData = doc.data();
        userData.schoolId = uid;
        userData.sheetId = schoolData.sheetId;
        userData.folderId = schoolData.folderId;
        userData.schoolName = schoolData.schoolName;
        userData.role = schoolData.role || userData.role;

        saveUserToStorage(userData);
        saveSheetConfig({
          sheetId: schoolData.sheetId,
          folderId: schoolData.folderId,
          schoolName: schoolData.schoolName,
          spreadsheetUrl: schoolData.spreadsheetUrl
        });

        return { user: userData, isNewUser: false, schoolConfig: schoolData };
      } else {
        return { user: userData, isNewUser: true, schoolConfig: null };
      }
    });
  },

  /**
   * Sign out the user
   */
  signOut: function () {
    return new Promise(function (resolve, reject) {
      _firebaseAuth.signOut().then(function () {
        if (_gapiInitialized && gapi.auth2) {
          var googleAuth = gapi.auth2.getAuthInstance();
          if (googleAuth) {
            googleAuth.signOut();
          }
        }
        clearSessionData();
        resolve();
      }).catch(function (err) {
        clearSessionData();
        resolve();
      });
    });
  },

  /**
   * Get the current logged-in user from localStorage
   */
  getCurrentUser: function () {
    return getStoredUser();
  },

  /**
   * Check if an email is the master admin
   */
  isMasterAdmin: function (email) {
    var cfg = getConfig().app;
    return email && email.toLowerCase() === cfg.masterAdminEmail.toLowerCase();
  },

  /**
   * Check if user is authenticated (has stored session)
   */
  isAuthenticated: function () {
    var user = getStoredUser();
    var token = localStorage.getItem('smart_absen_google_token');
    return !!(user && token);
  },

  /**
   * Listen for auth state changes
   */
  onAuthStateChanged: function (callback) {
    _firebaseAuth.onAuthStateChanged(callback);
  }
};


// ═══════════════════════════════════════════════════════════
// C. SETUP SERVICE (FIRST LOGIN — Auto-create spreadsheet)
// ═══════════════════════════════════════════════════════════

var SetupService = {

  /**
   * Complete school setup: creates folder, spreadsheet, styles, settings, Firestore entry.
   * @param {string} schoolName
   * @param {string} schoolAddress
   * @returns {Promise<Object>} { spreadsheetUrl, sheetId, folderId, schoolName }
   */
  createSchoolSetup: function (schoolName, schoolAddress) {
    var self = this;
    var sheetId = null;
    var folderId = null;
    var spreadsheetUrl = null;

    return refreshGoogleToken().then(function () {
      // Step 1: Create folder in Google Drive
      return self._createDriveFolder(schoolName);
    }).then(function (folderResult) {
      folderId = folderResult.id;
      console.log('[Setup] Folder created:', folderId);

      // Step 2: Create spreadsheet in that folder
      return self._createSpreadsheet(schoolName, folderId);
    }).then(function (sheetResult) {
      sheetId = sheetResult.spreadsheetId;
      spreadsheetUrl = sheetResult.spreadsheetUrl;
      console.log('[Setup] Spreadsheet created:', sheetId);

      // Step 3: Style header rows
      return self._styleHeaderRows(sheetId);
    }).then(function () {
      console.log('[Setup] Headers styled');

      // Step 4: Set column widths
      return self._setColumnWidths(sheetId);
    }).then(function () {
      console.log('[Setup] Column widths set');

      // Step 5: Add default settings
      return self._addDefaultSettings(sheetId, schoolName, schoolAddress);
    }).then(function () {
      console.log('[Setup] Default settings added');

      // Step 6: Save to Firestore
      var user = AuthService.getCurrentUser();
      return self._saveToFirestore(user, schoolName, schoolAddress, sheetId, folderId, spreadsheetUrl);
    }).then(function () {
      console.log('[Setup] Firestore entry saved');

      // Step 7: Save to localStorage
      var user = AuthService.getCurrentUser();
      user.schoolId = user.uid;
      user.sheetId = sheetId;
      user.folderId = folderId;
      user.schoolName = schoolName;
      saveUserToStorage(user);

      saveSheetConfig({
        sheetId: sheetId,
        folderId: folderId,
        schoolName: schoolName,
        spreadsheetUrl: spreadsheetUrl
      });

      return {
        spreadsheetUrl: spreadsheetUrl,
        sheetId: sheetId,
        folderId: folderId,
        schoolName: schoolName
      };
    });
  },

  /**
   * Create a folder in Google Drive
   */
  _createDriveFolder: function (schoolName) {
    return gapi.client.drive.files.create({
      resource: {
        name: 'Smart Absen - ' + schoolName,
        mimeType: 'application/vnd.google-apps.folder'
      },
      fields: 'id, name'
    }).then(function (response) {
      return response.result;
    });
  },

  /**
   * Create a Google Spreadsheet with all required sheets
   */
  _createSpreadsheet: function (schoolName, folderId) {
    var structure = getConfig().sheets.structure;
    var sheets = [];

    Object.keys(structure).forEach(function (sheetName) {
      sheets.push({
        properties: {
          title: sheetName
        }
      });
    });

    return gapi.client.sheets.spreadsheets.create({
      resource: {
        properties: {
          title: 'Absensi - ' + schoolName
        },
        sheets: sheets
      },
      fields: 'spreadsheetId, spreadsheetUrl'
    }).then(function (response) {
      var result = response.result;

      // Move file to folder
      if (folderId) {
        gapi.client.drive.files.update({
          fileId: result.spreadsheetId,
          addParents: folderId,
          fields: 'id'
        }).then(function () {
          console.log('[Setup] Spreadsheet moved to folder');
        }).catch(function (err) {
          console.warn('[Setup] Could not move spreadsheet to folder:', err);
        });
      }

      return result;
    });
  },

  /**
   * Style header rows (bold, colored background, frozen)
   */
  _styleHeaderRows: function (sheetId) {
    var structure = getConfig().sheets.structure;
    var style = getConfig().sheets.headerStyle;
    var requests = [];

    Object.keys(structure).forEach(function (sheetName) {
      var colCount = structure[sheetName].length;

      // Bold + background color for header row
      requests.push({
        repeatCell: {
          range: {
            sheetId: self._getSheetIdByName ? 0 : 0, // will fix below
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: colCount
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: style.background,
              textFormat: {
                bold: style.bold,
                foregroundColor: style.fontColor,
                fontSize: style.fontSize,
                fontFamily: 'Arial'
              }
            }
          },
          fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat'
        }
      });

      // Freeze header row
      requests.push({
        updateSheetProperties: {
          properties: {
            gridProperties: {
              frozenRowCount: 1
            }
          },
          fields: 'gridProperties.frozenRowCount'
        }
      });
    });

    // We need sheet IDs, so let's first get the spreadsheet metadata
    return gapi.client.sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: 'sheets.properties.sheetId,sheets.properties.title'
    }).then(function (metaResponse) {
      var sheetMap = {};
      metaResponse.result.sheets.forEach(function (s) {
        sheetMap[s.properties.title] = s.properties.sheetId;
      });

      // Rebuild requests with correct sheet IDs
      var finalRequests = [];
      Object.keys(structure).forEach(function (sheetName) {
        var sid = sheetMap[sheetName];
        if (sid === undefined) return;
        var colCount = structure[sheetName].length;

        finalRequests.push({
          repeatCell: {
            range: {
              sheetId: sid,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: colCount
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: style.background,
                textFormat: {
                  bold: style.bold,
                  foregroundColor: style.fontColor,
                  fontSize: style.fontSize,
                  fontFamily: 'Arial'
                }
              }
            },
            fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat'
          }
        });

        finalRequests.push({
          updateSheetProperties: {
            properties: {
              sheetId: sid,
              gridProperties: {
                frozenRowCount: 1
              }
            },
            fields: 'gridProperties.frozenRowCount'
          }
        });
      });

      return gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        resource: { requests: finalRequests }
      });
    });
  },

  /**
   * Set column widths for all sheets
   */
  _setColumnWidths: function (sheetId) {
    var structure = getConfig().sheets.structure;
    var defaultWidths = getConfig().sheets.columnWidths;

    return gapi.client.sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: 'sheets.properties.sheetId,sheets.properties.title'
    }).then(function (metaResponse) {
      var sheetMap = {};
      metaResponse.result.sheets.forEach(function (s) {
        sheetMap[s.properties.title] = s.properties.sheetId;
      });

      var requests = [];
      Object.keys(structure).forEach(function (sheetName) {
        var sid = sheetMap[sheetName];
        if (sid === undefined) return;
        var colCount = structure[sheetName].length;

        for (var i = 0; i < colCount; i++) {
          requests.push({
            updateDimensionProperties: {
              range: {
                sheetId: sid,
                dimension: 'COLUMNS',
                startIndex: i,
                endIndex: i + 1
              },
              properties: {
                pixelSize: defaultWidths[i] || 100
              },
              fields: 'pixelSize'
            }
          });
        }
      });

      if (requests.length > 0) {
        return gapi.client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: sheetId,
          resource: { requests: requests }
        });
      }
      return Promise.resolve();
    });
  },

  /**
   * Add default settings to Pengaturan sheet
   */
  _addDefaultSettings: function (sheetId, schoolName, schoolAddress) {
    var values = [
      ['nama_sekolah', schoolName, 'Nama sekolah'],
      ['alamat_sekolah', schoolAddress, 'Alamat sekolah'],
      ['tahun_ajaran', '2024/2025', 'Tahun ajaran aktif'],
      ['whatsapp_enabled', 'false', 'WhatsApp notifikasi aktif']
    ];

    return gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Pengaturan!A2',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        majorDimension: 'ROWS',
        values: values
      }
    });
  },

  /**
   * Save school registration to Firestore
   */
  _saveToFirestore: function (user, schoolName, schoolAddress, sheetId, folderId, spreadsheetUrl) {
    return _firebaseDb.collection('schools').doc(user.uid).set({
      schoolName: schoolName,
      schoolAddress: schoolAddress,
      sheetId: sheetId,
      folderId: folderId,
      spreadsheetUrl: spreadsheetUrl,
      email: user.email,
      creatorName: user.name,
      role: AuthService.isMasterAdmin(user.email) ? 'admin' : 'guru',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  /**
   * Get school config from Firestore
   */
  getSchoolConfig: function (uid) {
    return _firebaseDb.collection('schools').doc(uid).get().then(function (doc) {
      if (doc.exists) {
        return doc.data();
      }
      return null;
    });
  }
};


// ═══════════════════════════════════════════════════════════
// D. GOOGLE SHEETS SERVICE (CRUD Operations)
// ═══════════════════════════════════════════════════════════

function SheetsService(sheetId) {
  this.sheetId = sheetId;
  this.service = gapi.client.sheets;
}

// ─── Generic Read ──────────────────────────────────────────

/**
 * Read raw data from a sheet
 * @param {string} sheetName - The tab/sheet name
 * @param {string} range - e.g. 'A1:Z' or leave empty for all
 * @returns {Promise<Array[]>} 2D array of values
 */
SheetsService.prototype.readSheet = function (sheetName, range) {
  var fullRange = range ? sheetName + '!' + range : sheetName;
  return this.service.spreadsheets.values.get({
    spreadsheetId: this.sheetId,
    range: fullRange
  }).then(function (response) {
    var values = response.result.values || [];
    return values;
  });
};

/**
 * Read sheet as array of objects (using row 1 as headers)
 * @param {string} sheetName
 * @returns {Promise<Object[]>}
 */
SheetsService.prototype.readSheetAsObjects = function (sheetName) {
  var self = this;
  return self.readSheet(sheetName).then(function (values) {
    if (values.length < 2) return [];

    var headers = values[0];
    var objects = [];
    for (var i = 1; i < values.length; i++) {
      var obj = {};
      for (var j = 0; j < headers.length; j++) {
        var header = headers[j] ? headers[j].trim() : '';
        obj[header] = values[i][j] !== undefined ? values[i][j] : '';
      }
      obj._row = i + 1; // actual row number in sheet (1-indexed, +1 for header)
      objects.push(obj);
    }
    return objects;
  });
};

// ─── Generic Write ─────────────────────────────────────────

/**
 * Append a single row to a sheet
 * @param {string} sheetName
 * @param {Array} values - array of cell values
 */
SheetsService.prototype.appendRow = function (sheetName, values) {
  return this.service.spreadsheets.values.append({
    spreadsheetId: this.sheetId,
    range: sheetName + '!A1',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    resource: {
      majorDimension: 'ROWS',
      values: [values]
    }
  }).then(function (response) {
    return response.result;
  });
};

/**
 * Update a specific row
 * @param {string} sheetName
 * @param {number} rowNumber - 1-based row number (1 = header)
 * @param {Array} values
 */
SheetsService.prototype.updateRow = function (sheetName, rowNumber, values) {
  var endCol = String.fromCharCode(65 + values.length - 1);
  var range = sheetName + '!A' + rowNumber + ':' + endCol + rowNumber;
  return this.service.spreadsheets.values.update({
    spreadsheetId: this.sheetId,
    range: range,
    valueInputOption: 'USER_ENTERED',
    resource: {
      majorDimension: 'ROWS',
      values: [values]
    }
  }).then(function (response) {
    return response.result;
  });
};

/**
 * Delete a row by clearing it and shifting rows up
 * Note: Google Sheets API doesn't have a direct "delete row" — we use batchUpdate to delete
 * @param {string} sheetName
 * @param {number} rowNumber - 1-based
 */
SheetsService.prototype.deleteRow = function (sheetName, rowNumber) {
  var self = this;

  // First get sheet ID
  return self.service.spreadsheets.get({
    spreadsheetId: self.sheetId,
    fields: 'sheets.properties.sheetId,sheets.properties.title'
  }).then(function (metaResponse) {
    var sheetId = null;
    metaResponse.result.sheets.forEach(function (s) {
      if (s.properties.title === sheetName) {
        sheetId = s.properties.sheetId;
      }
    });

    if (sheetId === null) {
      throw new Error('Sheet "' + sheetName + '" not found');
    }

    return self.service.spreadsheets.batchUpdate({
      spreadsheetId: self.sheetId,
      resource: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: sheetId,
              dimension: 'ROWS',
              startIndex: rowNumber - 1,
              endIndex: rowNumber
            }
          }
        }]
      }
    });
  });
};

/**
 * Clear all data in a sheet except the header row
 * @param {string} sheetName
 */
SheetsService.prototype.clearSheet = function (sheetName) {
  return this.service.spreadsheets.values.clear({
    spreadsheetId: this.sheetId,
    range: sheetName + '!A2:Z'
  }).then(function (response) {
    return response.result;
  });
};

// ─── Student Operations ────────────────────────────────────

SheetsService.prototype.getStudents = function () {
  return this.readSheetAsObjects('Siswa');
};

SheetsService.prototype.addStudent = function (data) {
  var values = [
    data.id || generateId(),
    data.nis || '',
    data.nama || data.namaSiswa || '',
    data.kelas || '',
    data.jenisKelamin || data.jk || '',
    data.noHpOrtu || data.noHp || '',
    data.alamat || '',
    data.statusAktif !== undefined ? data.statusAktif : 'Aktif'
  ];
  return this.appendRow('Siswa', values);
};

SheetsService.prototype.updateStudent = function (row, data) {
  var values = [
    data.id || '',
    data.nis || '',
    data.nama || data.namaSiswa || '',
    data.kelas || '',
    data.jenisKelamin || data.jk || '',
    data.noHpOrtu || data.noHp || '',
    data.alamat || '',
    data.statusAktif !== undefined ? data.statusAktif : 'Aktif'
  ];
  return this.updateRow('Siswa', row, values);
};

SheetsService.prototype.deleteStudent = function (row) {
  return this.deleteRow('Siswa', row);
};

SheetsService.prototype.getStudentsByClass = function (className) {
  return this.getStudents().then(function (students) {
    return students.filter(function (s) {
      return (s['Kelas'] || '').toLowerCase() === className.toLowerCase();
    });
  });
};

// ─── Class Operations ──────────────────────────────────────

SheetsService.prototype.getClasses = function () {
  return this.readSheetAsObjects('Kelas');
};

SheetsService.prototype.addClass = function (data) {
  var values = [
    data.id || generateId(),
    data.namaKelas || data.nama || '',
    data.tingkat || '',
    data.waliKelas || '',
    data.kapasitas || '0',
    data.jumlahSiswa || '0'
  ];
  return this.appendRow('Kelas', values);
};

SheetsService.prototype.updateClass = function (row, data) {
  var values = [
    data.id || '',
    data.namaKelas || data.nama || '',
    data.tingkat || '',
    data.waliKelas || '',
    data.kapasitas || '0',
    data.jumlahSiswa || '0'
  ];
  return this.updateRow('Kelas', row, values);
};

SheetsService.prototype.deleteClass = function (row) {
  return this.deleteRow('Kelas', row);
};

// ─── Teacher Operations ────────────────────────────────────

SheetsService.prototype.getTeachers = function () {
  return this.readSheetAsObjects('Guru');
};

SheetsService.prototype.addTeacher = function (data) {
  var values = [
    data.id || generateId(),
    data.nama || data.namaGuru || '',
    data.email || '',
    data.mataPelajaran || data.mapel || '',
    data.noHp || '',
    data.role || 'guru',
    data.statusAktif !== undefined ? data.statusAktif : 'Aktif'
  ];
  return this.appendRow('Guru', values);
};

SheetsService.prototype.updateTeacher = function (row, data) {
  var values = [
    data.id || '',
    data.nama || data.namaGuru || '',
    data.email || '',
    data.mataPelajaran || data.mapel || '',
    data.noHp || '',
    data.role || 'guru',
    data.statusAktif !== undefined ? data.statusAktif : 'Aktif'
  ];
  return this.updateRow('Guru', row, values);
};

SheetsService.prototype.deleteTeacher = function (row) {
  return this.deleteRow('Guru', row);
};

// ─── Attendance Operations ─────────────────────────────────

SheetsService.prototype.getAttendance = function (date, className) {
  var self = this;
  return self.readSheetAsObjects('Absensi').then(function (records) {
    return records.filter(function (r) {
      var matchDate = !date || r['Tanggal'] === date;
      var matchClass = !className || (r['Kelas'] || '').toLowerCase() === className.toLowerCase();
      return matchDate && matchClass;
    });
  });
};

SheetsService.prototype.addAttendanceRecord = function (data) {
  var values = [
    data.id || generateId(),
    data.tanggal || formatDate(new Date()),
    data.kelas || '',
    data.nis || '',
    data.namaSiswa || data.nama || '',
    data.status || 'H',
    data.jamMasuk || formatTime(new Date()),
    data.keterangan || '',
    data.guruPenginput || '',
    data.syncStatus || 'synced'
  ];
  return this.appendRow('Absensi', values);
};

SheetsService.prototype.getAttendanceSummary = function (date) {
  var self = this;
  return self.readSheetAsObjects('Absensi').then(function (records) {
    var summary = {
      hadir: 0, sakit: 0, izin: 0, alpha: 0, terlambat: 0, total: 0
    };

    records.forEach(function (r) {
      if (date && r['Tanggal'] !== date) return;
      var status = (r['Status'] || '').toUpperCase();
      summary.total++;
      if (status === 'H') summary.hadir++;
      else if (status === 'S') summary.sakit++;
      else if (status === 'I') summary.izin++;
      else if (status === 'A') summary.alpha++;
      else if (status === 'T') summary.terlambat++;
    });

    return summary;
  });
};

SheetsService.prototype.getAttendanceWeeklySummary = function () {
  var self = this;
  return self.readSheetAsObjects('Absensi').then(function (records) {
    var today = new Date();
    var dayOfWeek = today.getDay();
    var startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    startOfWeek.setHours(0, 0, 0, 0);

    var dailySummary = [];

    for (var d = 0; d < 5; d++) {
      var checkDate = new Date(startOfWeek);
      checkDate.setDate(startOfWeek.getDate() + d);
      var dateStr = formatDate(checkDate);

      var dayData = { date: dateStr, hadir: 0, sakit: 0, izin: 0, alpha: 0, terlambat: 0, total: 0 };

      records.forEach(function (r) {
        if (r['Tanggal'] !== dateStr) return;
        var status = (r['Status'] || '').toUpperCase();
        dayData.total++;
        if (status === 'H') dayData.hadir++;
        else if (status === 'S') dayData.sakit++;
        else if (status === 'I') dayData.izin++;
        else if (status === 'A') dayData.alpha++;
        else if (status === 'T') dayData.terlambat++;
      });

      dailySummary.push(dayData);
    }

    return dailySummary;
  });
};

// ─── Settings Operations ───────────────────────────────────

SheetsService.prototype.getSetting = function (key) {
  var self = this;
  return self.readSheetAsObjects('Pengaturan').then(function (settings) {
    for (var i = 0; i < settings.length; i++) {
      if (settings[i]['Key'] === key) {
        return settings[i]['Value'];
      }
    }
    return null;
  });
};

SheetsService.prototype.getAllSettings = function () {
  return this.readSheetAsObjects('Pengaturan');
};

SheetsService.prototype.setSetting = function (key, value, description) {
  var self = this;

  return self.readSheetAsObjects('Pengaturan').then(function (settings) {
    for (var i = 0; i < settings.length; i++) {
      if (settings[i]['Key'] === key) {
        // Update existing setting
        var row = settings[i]._row;
        return self.updateRow('Pengaturan', row, [key, value, description || '']);
      }
    }
    // New setting — append
    return self.appendRow('Pengaturan', [key, value, description || '']);
  });
};


// ═══════════════════════════════════════════════════════════
// E. WHATSAPP SERVICE
// ═══════════════════════════════════════════════════════════

var WhatsAppService = {

  /**
   * Send a WhatsApp notification
   * @param {string} phoneNumber - Target phone number
   * @param {Object} data - Template variables { nama_siswa, kelas, status, tanggal, waktu, nama_sekolah }
   * @returns {Promise<Object>}
   */
  sendNotification: function (phoneNumber, data) {
    var cfg = getConfig().whatsapp;
    if (!cfg.apiUrl || !cfg.apiKey) {
      return Promise.resolve({ success: false, error: 'WhatsApp API not configured' });
    }

    var message = cfg.template;
    Object.keys(data).forEach(function (key) {
      message = message.replace(new RegExp('\\{' + key + '\\}', 'g'), data[key] || '-');
    });

    // Clean phone number
    var phone = String(phoneNumber).replace(/[^0-9]/g, '');
    if (phone.startsWith('0')) {
      phone = '62' + phone.substring(1);
    }

    return fetch(cfg.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': cfg.apiKey
      },
      body: JSON.stringify({
        phone: phone,
        message: message
      })
    }).then(function (response) {
      return response.json();
    }).then(function (result) {
      return { success: true, data: result };
    }).catch(function (error) {
      return { success: false, error: error.message };
    });
  },

  /**
   * Send bulk WhatsApp notifications
   * @param {Array} records - Array of { phoneNumber, data }
   * @returns {Promise<Object>} { sent: number, failed: number, errors: [] }
   */
  sendBulkNotifications: function (records) {
    var results = { sent: 0, failed: 0, errors: [] };
    var promises = [];

    records.forEach(function (record) {
      var p = WhatsAppService.sendNotification(record.phoneNumber, record.data)
        .then(function (result) {
          if (result.success) {
            results.sent++;
          } else {
            results.failed++;
            results.errors.push({ phone: record.phoneNumber, error: result.error });
          }
        }).catch(function (err) {
          results.failed++;
          results.errors.push({ phone: record.phoneNumber, error: err.message });
        });
      promises.push(p);
    });

    return Promise.all(promises).then(function () {
      return results;
    });
  }
};


// ═══════════════════════════════════════════════════════════
// F. OFFLINE QUEUE SERVICE
// ═══════════════════════════════════════════════════════════

function OfflineQueue() {
  this.queueKey = 'smart_absen_offline_queue';
}

/**
 * Add an attendance record to the offline queue
 * @param {Object} record - Attendance data to be synced later
 */
OfflineQueue.prototype.add = function (record) {
  var queue = this._getQueue();
  record._queuedAt = new Date().toISOString();
  queue.push(record);
  localStorage.setItem(this.queueKey, JSON.stringify(queue));
};

/**
 * Process all pending records in the queue
 * @param {SheetsService} sheetsService - Initialized SheetsService instance
 * @returns {Promise<Object>} { processed: number, failed: number }
 */
OfflineQueue.prototype.processQueue = function (sheetsService) {
  var self = this;
  var queue = self._getQueue();
  if (queue.length === 0) {
    return Promise.resolve({ processed: 0, failed: 0 });
  }

  var results = { processed: 0, failed: 0 };
  var promises = [];

  queue.forEach(function (record) {
    var p = sheetsService.addAttendanceRecord(record)
      .then(function () {
        results.processed++;
      })
      .catch(function () {
        results.failed++;
      });
    promises.push(p);
  });

  return Promise.all(promises).then(function () {
    if (results.failed === 0) {
      self.clear();
    } else {
      // Keep failed items in queue
      var remaining = [];
      for (var i = results.processed; i < queue.length; i++) {
        remaining.push(queue[i]);
      }
      localStorage.setItem(self.queueKey, JSON.stringify(remaining));
    }
    return results;
  });
};

/**
 * Get number of pending records
 */
OfflineQueue.prototype.getPendingCount = function () {
  return this._getQueue().length;
};

/**
 * Get all pending records
 */
OfflineQueue.prototype.getPendingRecords = function () {
  return this._getQueue();
};

/**
 * Clear all pending records
 */
OfflineQueue.prototype.clear = function () {
  localStorage.removeItem(this.queueKey);
};

/**
 * Internal: get the queue array from localStorage
 */
OfflineQueue.prototype._getQueue = function () {
  try {
    var raw = localStorage.getItem(this.queueKey);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
};


// ═══════════════════════════════════════════════════════════
// G. SYSTEM CONFIG (Centralized Firestore Config)
// ═══════════════════════════════════════════════════════════

/**
 * Load system configuration from Firestore (set by Master Admin)
 * This overrides config.js values for: whatsapp API
 */
async function loadSystemConfig() {
  try {
    if (!firebase.firestore) return null;
    var db = firebase.firestore();
    var doc = await db.collection('system_config').doc('whatsapp').get();

    if (doc.exists) {
      var data = doc.data();
      // Override WhatsApp config from Firestore
      if (data.api_url) SMART_ABSEN_CONFIG.whatsapp.apiUrl = data.api_url;
      if (data.api_key) SMART_ABSEN_CONFIG.whatsapp.apiKey = data.api_key;
      if (data.template) SMART_ABSEN_CONFIG.whatsapp.template = data.template;
      console.log('[Config] WhatsApp config loaded from Firestore');
    }

    // Load Firebase config override (if any)
    var fbDoc = await db.collection('system_config').doc('firebase').get();
    if (fbDoc.exists) {
      var fbData = fbDoc.data();
      // These are read-only info for display
      console.log('[Config] Firebase config verified from Firestore');
    }

    return true;
  } catch (error) {
    console.warn('[Config] Could not load system config from Firestore:', error);
    return false;
  }
}


// ═══════════════════════════════════════════════════════════
// H. UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════

/**
 * Generate a unique ID
 * @returns {string}
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

/**
 * Format a date to DD/MM/YYYY
 * @param {Date|string} date
 * @returns {string}
 */
function formatDate(date) {
  if (!date) return '';
  if (typeof date === 'string') {
    // If already formatted, return as-is
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) return date;
    date = new Date(date);
  }
  var d = date.getDate().toString().padStart(2, '0');
  var m = (date.getMonth() + 1).toString().padStart(2, '0');
  var y = date.getFullYear();
  return d + '/' + m + '/' + y;
}

/**
 * Format a date to YYYY-MM-DD (ISO format for sheets)
 * @param {Date} date
 * @returns {string}
 */
function formatDateISO(date) {
  var d = date.getDate().toString().padStart(2, '0');
  var m = (date.getMonth() + 1).toString().padStart(2, '0');
  var y = date.getFullYear();
  return y + '-' + m + '-' + d;
}

/**
 * Format time to HH:mm
 * @param {Date} date
 * @returns {string}
 */
function formatTime(date) {
  if (!date) return '';
  if (typeof date === 'string') {
    if (/^\d{2}:\d{2}$/.test(date)) return date;
    date = new Date(date);
  }
  var h = date.getHours().toString().padStart(2, '0');
  var m = date.getMinutes().toString().padStart(2, '0');
  return h + ':' + m;
}

/**
 * Get today's date as DD/MM/YYYY
 * @returns {string}
 */
function getToday() {
  return formatDate(new Date());
}

/**
 * Get today's date as YYYY-MM-DD
 * @returns {string}
 */
function getTodayISO() {
  return formatDateISO(new Date());
}

/**
 * Parse DD/MM/YYYY to Date
 * @param {string} str
 * @returns {Date|null}
 */
function parseDate(str) {
  if (!str) return null;
  var parts = str.split('/');
  if (parts.length === 3) {
    return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
  }
  return new Date(str);
}

/**
 * Get day name in Indonesian
 * @param {Date} date
 * @returns {string}
 */
function getDayName(date) {
  var days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  return days[date.getDay()];
}

/**
 * Get month name in Indonesian
 * @param {number} monthIndex
 * @returns {string}
 */
function getMonthName(monthIndex) {
  var months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return months[monthIndex];
}

/**
 * Show a toast notification
 * @param {string} message
 * @param {string} type - 'success', 'error', 'warning', 'info'
 * @param {number} duration - Duration in ms
 */
function showToast(message, type, duration) {
  type = type || 'info';
  duration = duration || 3000;

  // Remove existing toasts
  var existing = document.querySelectorAll('.sa-toast');
  existing.forEach(function (el) { el.remove(); });

  var toast = document.createElement('div');
  toast.className = 'sa-toast sa-toast-' + type;

  var icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };

  toast.innerHTML = '<span class="sa-toast-icon">' + (icons[type] || 'ℹ️') + '</span>' +
    '<span class="sa-toast-msg">' + message + '</span>';

  document.body.appendChild(toast);

  // Trigger animation
  setTimeout(function () { toast.classList.add('sa-toast-show'); }, 10);

  // Auto-dismiss
  setTimeout(function () {
    toast.classList.remove('sa-toast-show');
    toast.classList.add('sa-toast-hide');
    setTimeout(function () { toast.remove(); }, 400);
  }, duration);
}

/**
 * Show a modal dialog
 * @param {string} title
 * @param {string|HTMLElement} content
 * @param {Object} options - { confirmText, cancelText, onConfirm, onCancel }
 * @returns {Promise<boolean>}
 */
function showModal(title, content, options) {
  options = options || {};

  return new Promise(function (resolve) {
    // Remove existing modals
    var existing = document.getElementById('sa-modal-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'sa-modal-overlay';
    overlay.className = 'sa-modal-overlay';

    var modal = document.createElement('div');
    modal.className = 'sa-modal';
    modal.innerHTML =
      '<div class="sa-modal-header">' +
        '<h3>' + title + '</h3>' +
        '<button class="sa-modal-close" id="sa-modal-x">&times;</button>' +
      '</div>' +
      '<div class="sa-modal-body">' +
        (typeof content === 'string' ? '<p>' + content + '</p>' : '') +
      '</div>' +
      '<div class="sa-modal-footer">' +
        (options.cancelText !== false ?
          '<button class="sa-btn sa-btn-secondary" id="sa-modal-cancel">' +
          (options.cancelText || 'Batal') + '</button>' : '') +
        '<button class="sa-btn sa-btn-primary" id="sa-modal-confirm">' +
        (options.confirmText || 'OK') + '</button>' +
      '</div>';

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // If content is an HTMLElement, append it
    if (content instanceof HTMLElement) {
      modal.querySelector('.sa-modal-body').innerHTML = '';
      modal.querySelector('.sa-modal-body').appendChild(content);
    }

    // Animate in
    setTimeout(function () { overlay.classList.add('sa-modal-active'); }, 10);

    // Close handlers
    function close(val) {
      overlay.classList.remove('sa-modal-active');
      setTimeout(function () { overlay.remove(); }, 300);
      resolve(val);
    }

    modal.querySelector('#sa-modal-x').onclick = function () {
      if (options.onCancel) options.onCancel();
      close(false);
    };
    var cancelBtn = modal.querySelector('#sa-modal-cancel');
    if (cancelBtn) cancelBtn.onclick = function () {
      if (options.onCancel) options.onCancel();
      close(false);
    };
    modal.querySelector('#sa-modal-confirm').onclick = function () {
      if (options.onConfirm) options.onConfirm();
      close(true);
    };
    overlay.onclick = function (e) {
      if (e.target === overlay) close(false);
    };
  });
}

/**
 * Show a confirmation dialog
 * @param {string} message
 * @param {string} title
 * @returns {Promise<boolean>}
 */
function showConfirm(message, title) {
  return showModal(title || 'Konfirmasi', message, {
    confirmText: 'Ya',
    cancelText: 'Tidak'
  });
}

/**
 * Export data array to CSV file
 * @param {Array<Object>} data
 * @param {string} filename
 */
function exportToCSV(data, filename) {
  if (!data || data.length === 0) {
    showToast('Tidak ada data untuk diekspor', 'warning');
    return;
  }

  var headers = Object.keys(data[0]).filter(function (k) {
    return k !== '_row' && !k.startsWith('_');
  });

  var csv = headers.join(',') + '\n';
  data.forEach(function (row) {
    var values = headers.map(function (h) {
      var val = String(row[h] || '').replace(/"/g, '""');
      return '"' + val + '"';
    });
    csv += values.join(',') + '\n';
  });

  // Add BOM for Excel compatibility
  var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename || 'data_export.csv';
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('Data berhasil diekspor ke CSV', 'success');
}

/**
 * Debounce function
 * @param {Function} fn
 * @param {number} delay
 * @returns {Function}
 */
function debounce(fn, delay) {
  var timer = null;
  return function () {
    var context = this;
    var args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function () {
      fn.apply(context, args);
    }, delay || 300);
  };
}

/**
 * Escape HTML to prevent XSS
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

/**
 * Check if currently online
 * @returns {boolean}
 */
function isOnline() {
  return navigator.onLine;
}

/**
 * Get status label for attendance
 * @param {string} code
 * @returns {Object}
 */
function getAttendanceStatus(code) {
  var statuses = getConfig().app.attendanceStatuses;
  for (var i = 0; i < statuses.length; i++) {
    if (statuses[i].value === code) return statuses[i];
  }
  return { value: code, label: code, color: '#888', icon: '❓' };
}

/**
 * Validate Indonesian phone number
 * @param {string} phone
 * @returns {boolean}
 */
function isValidPhone(phone) {
  var cleaned = String(phone).replace(/[\s\-]/g, '');
  return /^(\+62|62|0)8[1-9][0-9]{6,10}$/.test(cleaned);
}

/**
 * Format phone number for display
 * @param {string} phone
 * @returns {string}
 */
function formatPhone(phone) {
  if (!phone) return '-';
  return String(phone);
}

/**
 * Get initials from a name
 * @param {string} name
 * @returns {string}
 */
function getInitials(name) {
  if (!name) return '?';
  var parts = name.split(' ');
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

/**
 * Load a CSS stylesheet dynamically
 * @param {string} href
 */
function loadStylesheet(href) {
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

/**
 * Trigger a print dialog
 */
function printCurrentView() {
  window.print();
}

/**
 * Get connection status info
 * @returns {Object}
 */
function getConnectionInfo() {
  var config = getStoredSheetConfig();
  return {
    online: navigator.onLine,
    sheetId: config ? config.sheetId : null,
    folderId: config ? config.folderId : null,
    schoolName: config ? config.schoolName : null,
    lastSync: localStorage.getItem('smart_absen_last_sync') || null
  };
}

/**
 * Update the last sync timestamp
 */
function updateLastSync() {
  localStorage.setItem('smart_absen_last_sync', new Date().toISOString());
}

/**
 * Async sleep utility
 * @param {number} ms
 * @returns {Promise}
 */
function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/**
 * Register service worker
 */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(function (reg) {
        console.log('[SW] Registered:', reg.scope);
      })
      .catch(function (err) {
        console.warn('[SW] Registration failed:', err);
      });
  }
}


// ═══════════════════════════════════════════════════════════
// H. EVENT LISTENERS (online/offline)
// ═══════════════════════════════════════════════════════════

window.addEventListener('online', function () {
  showToast('Koneksi internet kembali tersedia', 'success');
  if (typeof onNetworkChange === 'function') onNetworkChange(true);
});

window.addEventListener('offline', function () {
  showToast('Anda sedang offline. Data akan disimpan secara lokal.', 'warning', 5000);
  if (typeof onNetworkChange === 'function') onNetworkChange(false);
});

// Listen for service worker messages (background sync)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'SYNC_ATTENDANCE') {
      console.log('[SW] Received sync request');
      if (typeof processOfflineQueue === 'function') {
        processOfflineQueue();
      }
    }
  });
}

console.log('[Smart Absen v2] app.js loaded');
