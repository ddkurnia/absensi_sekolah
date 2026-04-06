/**
 * ============================================================
 *  SMART ABSEN ENTERPRISE v2.0 — MAIN APPLICATION LOGIC
 * ============================================================
 *  This file contains all core services:
 *    - Firebase Initialization
 *    - AuthService (Email + Password — NOT Google Sign-In!)
 *    - GoogleDriveService (Google Drive/Sheets — Settings only)
 *    - SheetsService (CRUD for Google Sheets)
 *    - WhatsAppService (notifications)
 *    - OfflineQueue (offline attendance queue)
 *    - SystemConfigService (Firestore system config)
 *    - Utility functions
 * ============================================================
 *
 *  ARCHITECTURE:
 *    - Login: Email + Password via Firebase Auth
 *    - Google OAuth: ONLY for Google Drive connection in Pengaturan
 *    - Registration: Name, Email, Password, School Name
 *    - Data stored in Firestore: users/{uid}
 * ============================================================
 */

'use strict';

// ═══════════════════════════════════════════════════════════════
// A. GLOBALS & FIREBASE INITIALIZATION
// ═══════════════════════════════════════════════════════════════

var _firebaseApp = null;
var _firebaseAuth = null;
var _firebaseDb = null;
var _gapiInitialized = false;
var _offlineQueue = null;

/**
 * Get the shared config object (loaded from config.js before this file)
 */
function getConfig() {
  return window.SMART_ABSEN_CONFIG;
}

/**
 * Initialize Firebase app (compat SDKs loaded via CDN in index.html)
 * Safe to call multiple times — checks if already initialized.
 */
function initFirebase() {
  var cfg = getConfig().firebase;
  if (!firebase.apps || !firebase.apps.length) {
    _firebaseApp = firebase.initializeApp({
      apiKey: cfg.apiKey,
      authDomain: cfg.authDomain,
      projectId: cfg.projectId,
      storageBucket: cfg.storageBucket,
      messagingSenderId: cfg.messagingSenderId,
      appId: cfg.appId
    });
    console.log('[Firebase] Initialized successfully');
  } else {
    _firebaseApp = firebase.apps[0];
  }
  _firebaseAuth = firebase.auth();
  _firebaseDb = firebase.firestore();
  // Enable offline persistence for Firestore
  try {
    _firebaseDb.enablePersistence({ synchronizeTabs: true });
  } catch (e) {
    // Persistence may already be enabled or not supported
  }
  return { app: _firebaseApp, auth: _firebaseAuth, db: _firebaseDb };
}


// ═══════════════════════════════════════════════════════════════
// B. AUTH SERVICE — EMAIL + PASSWORD (NOT Google Sign-In!)
// ═══════════════════════════════════════════════════════════════

var AuthService = {

  /**
   * Register a new user (school admin) with email + password.
   * Creates Firebase Auth user and Firestore document: users/{uid}
   *
   * @param {string} name - Full name of the user
   * @param {string} email - Email address (used for login)
   * @param {string} password - Password (min 6 characters)
   * @param {string} schoolName - Name of the school
   * @param {string} schoolAddress - Address of the school
   * @returns {Promise<Object>} User data object
   */
  register: function (name, email, password, schoolName, schoolAddress) {
    var self = this;
    var db = _firebaseDb;

    // Step 1: Create Firebase Auth user with email/password
    return _firebaseAuth.createUserWithEmailAndPassword(email, password)
      .then(function (userCredential) {
        var firebaseUser = userCredential.user;
        console.log('[Auth] User created in Firebase Auth:', firebaseUser.uid);

        // Step 2: Create Firestore document
        var userData = {
          uid: firebaseUser.uid,
          name: name,
          email: email,
          role: self.isMasterAdmin(email) ? 'admin' : 'admin',
          schoolName: schoolName || '',
          schoolAddress: schoolAddress || '',
          sheetId: null,
          folderId: null,
          spreadsheetUrl: null,
          googleDriveConnected: false,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          isActive: true
        };

        return db.collection('users').doc(firebaseUser.uid).set(userData).then(function () {
          console.log('[Auth] User document created in Firestore');
          // Step 3: Store in localStorage
          self._saveUser(userData);
          return userData;
        });
      })
      .then(function (userData) {
        // Step 4: Load system config from Firestore
        return SystemConfigService.loadSystemConfig().then(function () {
          return userData;
        });
      })
      .catch(function (error) {
        console.error('[Auth] Registration error:', error);
        // Clean up Firebase Auth user if Firestore write failed
        if (error.code === 'permission-denied' || error.code === 'unavailable') {
          // Firestore failed, try to clean up auth user
          var currentUser = _firebaseAuth.currentUser;
          if (currentUser) {
            currentUser.delete().catch(function () {});
          }
        }
        throw error;
      });
  },

  /**
   * Login with email + password.
   * Authenticates via Firebase Auth, loads user data from Firestore.
   *
   * @param {string} email - Email address
   * @param {string} password - Password
   * @returns {Promise<Object>} User data object
   */
  login: function (email, password) {
    var self = this;
    var db = _firebaseDb;

    // Step 1: Firebase Auth signInWithEmailAndPassword
    return _firebaseAuth.signInWithEmailAndPassword(email, password)
      .then(function (userCredential) {
        var firebaseUser = userCredential.user;
        console.log('[Auth] User signed in:', firebaseUser.uid);

        // Step 2: Get user data from Firestore
        return db.collection('users').doc(firebaseUser.uid).get().then(function (doc) {
          if (!doc.exists) {
            // User exists in Auth but not in Firestore — auto-create
            console.warn('[Auth] User document not found in Firestore, creating...');
            var newUserData = {
              uid: firebaseUser.uid,
              name: firebaseUser.displayName || email.split('@')[0],
              email: firebaseUser.email,
              role: self.isMasterAdmin(firebaseUser.email) ? 'admin' : 'admin',
              schoolName: '',
              schoolAddress: '',
              sheetId: null,
              folderId: null,
              spreadsheetUrl: null,
              googleDriveConnected: false,
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
              isActive: true
            };
            return db.collection('users').doc(firebaseUser.uid).set(newUserData).then(function () {
              return newUserData;
            });
          }
          return doc.data();
        });
      })
      .then(function (userData) {
        // Step 3: Store in localStorage
        self._saveUser(userData);

        // Step 4: Load system config (WhatsApp settings from Firestore)
        return SystemConfigService.loadSystemConfig().then(function () {
          return userData;
        });

        // Note: Step 5 (restore Google token) is handled lazily
        // when GoogleDriveService is first used in Pengaturan
      })
      .catch(function (error) {
        console.error('[Auth] Login error:', error);
        throw error;
      });
  },

  /**
   * Logout the current user.
   * Signs out from Firebase Auth, clears localStorage, redirects to login.
   */
  logout: function () {
    return _firebaseAuth.signOut().then(function () {
      // Also sign out from Google if connected
      if (_gapiInitialized && typeof gapi !== 'undefined' && gapi.auth2) {
        try {
          var googleAuth = gapi.auth2.getAuthInstance();
          if (googleAuth) {
            googleAuth.signOut();
          }
        } catch (e) {
          console.warn('[Auth] Google sign-out warning:', e);
        }
      }
      // Clear all stored session data
      localStorage.removeItem('smart_absen_user');
      localStorage.removeItem('smart_absen_google_token');
      localStorage.removeItem('smart_absen_sheet_config');
      console.log('[Auth] User logged out');
    }).catch(function (err) {
      // Even on error, clear local state
      localStorage.removeItem('smart_absen_user');
      localStorage.removeItem('smart_absen_google_token');
      localStorage.removeItem('smart_absen_sheet_config');
      console.warn('[Auth] Logout error (state cleared anyway):', err);
    });
  },

  /**
   * Get the current user from localStorage.
   * @returns {Object|null} User data or null if not logged in
   */
  getCurrentUser: function () {
    try {
      var raw = localStorage.getItem('smart_absen_user');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  /**
   * Check if a user is currently authenticated.
   * @returns {boolean}
   */
  isAuthenticated: function () {
    var user = this.getCurrentUser();
    return !!(user && user.uid);
  },

  /**
   * Check if the current user is the master admin.
   * @returns {boolean}
   */
  isMasterAdmin: function (email) {
    var cfg = getConfig().app;
    var checkEmail = email || (this.getCurrentUser() ? this.getCurrentUser().email : '');
    return checkEmail && checkEmail.toLowerCase() === cfg.masterAdminEmail.toLowerCase();
  },

  /**
   * Check if Google Drive is connected for the current user.
   * @returns {boolean}
   */
  isGoogleDriveConnected: function () {
    var user = this.getCurrentUser();
    return !!(user && user.sheetId);
  },

  /**
   * Update user data in Firestore and localStorage.
   *
   * @param {Object} data - Fields to update
   * @returns {Promise<Object>} Updated user data
   */
  updateUserData: function (data) {
    var user = this.getCurrentUser();
    if (!user || !user.uid) {
      return Promise.reject(new Error('Tidak ada pengguna yang masuk'));
    }
    var db = _firebaseDb;
    var updatePayload = Object.assign({}, data, {
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    return db.collection('users').doc(user.uid).update(updatePayload).then(function () {
      // Update localStorage with new data
      Object.assign(user, data);
      user.updatedAt = new Date().toISOString();
      localStorage.setItem('smart_absen_user', JSON.stringify(user));
      console.log('[Auth] User data updated:', Object.keys(data).join(', '));
      return user;
    }).catch(function (error) {
      console.error('[Auth] Update user data error:', error);
      throw error;
    });
  },

  /**
   * Get a user's Firestore document by UID.
   * @param {string} uid
   * @returns {Promise<Object|null>}
   */
  getUserData: function (uid) {
    return _firebaseDb.collection('users').doc(uid).get().then(function (doc) {
      return doc.exists ? doc.data() : null;
    });
  },

  /**
   * Listen for Firebase Auth state changes.
   * Useful for detecting session expiration.
   * @param {Function} callback
   */
  onAuthStateChanged: function (callback) {
    _firebaseAuth.onAuthStateChanged(callback);
  },

  /**
   * Send a password reset email.
   * @param {string} email
   * @returns {Promise}
   */
  sendPasswordReset: function (email) {
    return _firebaseAuth.sendPasswordResetEmail(email).catch(function (error) {
      console.error('[Auth] Password reset error:', error);
      throw error;
    });
  },

  /**
   * Update the current user's password.
   * @param {string} newPassword
   * @returns {Promise}
   */
  updatePassword: function (newPassword) {
    var user = _firebaseAuth.currentUser;
    if (!user) {
      return Promise.reject(new Error('Tidak ada pengguna yang masuk'));
    }
    return user.updatePassword(newPassword).catch(function (error) {
      console.error('[Auth] Update password error:', error);
      throw error;
    });
  },

  // ─── Private helpers ────────────────────────────────────────

  /**
   * Save user data to localStorage.
   * @param {Object} user
   * @private
   */
  _saveUser: function (user) {
    localStorage.setItem('smart_absen_user', JSON.stringify(user));
  },

  /**
   * Clear all stored session data.
   * @private
   */
  _clearSession: function () {
    localStorage.removeItem('smart_absen_user');
    localStorage.removeItem('smart_absen_google_token');
    localStorage.removeItem('smart_absen_sheet_config');
  }
};


// ═══════════════════════════════════════════════════════════════
// C. GOOGLE DRIVE SERVICE — Connect Google Drive (PENGATURAN ONLY!)
// ═══════════════════════════════════════════════════════════════
//
//  Google OAuth is ONLY used for Google Drive/Sheets access.
//  It is NOT used for login/login authentication.
//  Users connect their Google Drive from the Pengaturan page.
// ═══════════════════════════════════════════════════════════════

var GoogleDriveService = {

  /**
   * Initialize the Google API client (gapi).
   * Must be called before connectDrive().
   * @returns {Promise<boolean>} true when initialized
   */
  initGoogleAPI: function () {
    return new Promise(function (resolve, reject) {
      if (typeof gapi === 'undefined') {
        reject(new Error('Google API tidak tersedia. Pastikan script gapi dimuat.'));
        return;
      }
      if (_gapiInitialized && gapi.auth2 && gapi.auth2.getAuthInstance()) {
        resolve(true);
        return;
      }
      var cfg = getConfig().google;
      gapi.load('client:auth2', function () {
        gapi.client.init({
          apiKey: cfg.apiKey || '',
          clientId: cfg.clientId,
          scope: cfg.scopes.join(' '),
          discoveryDocs: cfg.discoveryDocs
        }).then(function () {
          _gapiInitialized = true;
          console.log('[GoogleDrive] Google API initialized');
          resolve(true);
        }).catch(function (err) {
          console.error('[GoogleDrive] Google API init failed:', err);
          reject(err);
        });
      });
    });
  },

  /**
   * Connect Google Drive — shows Google OAuth popup.
   * After authorization, creates spreadsheet and folder in the user's Drive.
   *
   * @returns {Promise<Object>} { success, spreadsheetUrl, sheetId, folderId }
   */
  connectDrive: function () {
    var self = this;
    var user = AuthService.getCurrentUser();

    if (!user || !user.uid) {
      return Promise.reject(new Error('Anda harus masuk terlebih dahulu'));
    }

    // Step 1: Initialize Google API if not already
    return self.initGoogleAPI().then(function () {
      // Step 2: Show Google Sign-In popup
      var googleAuth = gapi.auth2.getAuthInstance();
      if (googleAuth.isSignedIn.get()) {
        // Already signed in to Google — get token directly
        return googleAuth.currentUser.get();
      } else {
        // Show popup
        return googleAuth.signIn({
          prompt: 'consent'
        }).then(function (googleUser) {
          return googleUser;
        });
      }
    }).then(function (googleUser) {
      // Step 3: Get access token
      var authResponse = googleUser.getAuthResponse();
      var accessToken = authResponse.access_token;
      localStorage.setItem('smart_absen_google_token', accessToken);
      console.log('[GoogleDrive] Google authorized, token obtained');

      // Step 4: Create spreadsheet
      var schoolName = user.schoolName || 'Sekolah';
      return self.createSpreadsheet(schoolName);
    }).then(function (result) {
      // Step 5: Update user in Firestore with sheetId, folderId
      return AuthService.updateUserData({
        sheetId: result.sheetId,
        folderId: result.folderId,
        spreadsheetUrl: result.spreadsheetUrl,
        googleDriveConnected: true
      }).then(function () {
        return {
          success: true,
          spreadsheetUrl: result.spreadsheetUrl,
          sheetId: result.sheetId,
          folderId: result.folderId
        };
      });
    }).catch(function (error) {
      console.error('[GoogleDrive] Connect error:', error);
      throw error;
    });
  },

  /**
   * Disconnect Google Drive.
   * Signs out from Google, clears tokens, updates Firestore.
   *
   * @returns {Promise<Object>} { success: true }
   */
  disconnectDrive: function () {
    var self = this;

    // Step 1: Sign out from Google
    try {
      if (typeof gapi !== 'undefined' && gapi.auth2 && gapi.auth2.getAuthInstance()) {
        var googleAuth = gapi.auth2.getAuthInstance();
        googleAuth.signOut();
      }
    } catch (e) {
      console.warn('[GoogleDrive] Google sign-out warning:', e);
    }

    // Step 2: Clear Google token
    localStorage.removeItem('smart_absen_google_token');

    // Step 3: Update Firestore
    return AuthService.updateUserData({
      sheetId: null,
      folderId: null,
      spreadsheetUrl: null,
      googleDriveConnected: false
    }).then(function () {
      _gapiInitialized = false;
      console.log('[GoogleDrive] Disconnected');
      return { success: true };
    });
  },

  /**
   * Create a spreadsheet in Google Drive.
   * Creates a folder and a spreadsheet with all required sheets, styling, and default settings.
   *
   * @param {string} schoolName - School name for folder/spreadsheet naming
   * @returns {Promise<Object>} { sheetId, folderId, spreadsheetUrl }
   */
  createSpreadsheet: function (schoolName) {
    var self = this;
    var folderId = null;
    var sheetId = null;
    var spreadsheetUrl = null;
    var structure = getConfig().sheets.structure;

    // Step 1: Create folder in Google Drive
    return self._createDriveFolder(schoolName).then(function (folderResult) {
      folderId = folderResult.id;
      console.log('[GoogleDrive] Folder created:', folderId);

      // Step 2: Create Spreadsheet in that folder
      return self._createSpreadsheetFile(schoolName, folderId, structure);
    }).then(function (sheetResult) {
      sheetId = sheetResult.spreadsheetId;
      spreadsheetUrl = sheetResult.spreadsheetUrl;
      console.log('[GoogleDrive] Spreadsheet created:', sheetId);

      // Step 3: Style header rows
      return self._styleHeaderRows(sheetId, structure);
    }).then(function () {
      console.log('[GoogleDrive] Headers styled');

      // Step 4: Set column widths
      return self._setColumnWidths(sheetId, structure);
    }).then(function () {
      console.log('[GoogleDrive] Column widths set');

      // Step 5: Add default settings to Pengaturan sheet
      var user = AuthService.getCurrentUser();
      return self._addDefaultSettings(sheetId, user.schoolName || schoolName, user.schoolAddress || '');
    }).then(function () {
      console.log('[GoogleDrive] Default settings added');

      return {
        sheetId: sheetId,
        folderId: folderId,
        spreadsheetUrl: spreadsheetUrl
      };
    });
  },

  /**
   * Get the current Google access token.
   * Tries gapi first, falls back to localStorage.
   * @returns {string|null} Access token
   */
  getAccessToken: function () {
    try {
      if (typeof gapi !== 'undefined' && gapi.auth2 && gapi.auth2.getAuthInstance()) {
        var googleAuth = gapi.auth2.getAuthInstance();
        if (googleAuth.isSignedIn.get()) {
          var token = googleAuth.currentUser.get().getAuthResponse().access_token;
          if (token) {
            localStorage.setItem('smart_absen_google_token', token);
            return token;
          }
        }
      }
    } catch (e) {
      // gapi not available or not signed in
    }
    return localStorage.getItem('smart_absen_google_token') || null;
  },

  /**
   * Check if the Google API client is initialized and signed in.
   * @returns {boolean}
   */
  isInitialized: function () {
    try {
      return !!(typeof gapi !== 'undefined' && gapi.client && gapi.auth2 && gapi.auth2.getAuthInstance() && gapi.auth2.getAuthInstance().isSignedIn.get());
    } catch (e) {
      return false;
    }
  },

  /**
   * Ensure Google API is ready and user is signed in.
   * Initializes gapi if needed, attempts silent sign-in.
   * @returns {Promise<boolean>}
   */
  ensureReady: function () {
    var self = this;
    return self.initGoogleAPI().then(function () {
      var googleAuth = gapi.auth2.getAuthInstance();
      if (googleAuth.isSignedIn.get()) {
        // Refresh token
        var token = self.getAccessToken();
        if (token) return true;
      }
      // Try silent sign-in
      return googleAuth.signIn({ prompt: '' }).then(function () {
        return true;
      }).catch(function () {
        return false;
      });
    });
  },

  // ─── Private helpers ────────────────────────────────────────

  /**
   * Create a folder in Google Drive.
   * @param {string} schoolName
   * @returns {Promise<Object>} { id, name }
   * @private
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
   * Create a Google Spreadsheet with all required sheets.
   * @param {string} schoolName
   * @param {string} folderId
   * @param {Object} structure - Sheet names and headers from config
   * @returns {Promise<Object>} { spreadsheetId, spreadsheetUrl }
   * @private
   */
  _createSpreadsheetFile: function (schoolName, folderId, structure) {
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
          title: 'Data Absensi - ' + schoolName
        },
        sheets: sheets
      },
      fields: 'spreadsheetId,spreadsheetUrl'
    }).then(function (response) {
      var result = response.result;

      // Move file to folder (async, don't block)
      if (folderId) {
        gapi.client.drive.files.update({
          fileId: result.spreadsheetId,
          addParents: folderId,
          fields: 'id'
        }).then(function () {
          console.log('[GoogleDrive] Spreadsheet moved to folder');
        }).catch(function (err) {
          console.warn('[GoogleDrive] Could not move spreadsheet to folder:', err);
        });
      }

      return result;
    });
  },

  /**
   * Style header rows (bold, colored background, frozen row 1).
   * @param {string} spreadsheetId
   * @param {Object} structure
   * @returns {Promise}
   * @private
   */
  _styleHeaderRows: function (spreadsheetId, structure) {
    var style = getConfig().sheets.headerStyle;

    // First get sheet IDs from the spreadsheet
    return gapi.client.sheets.spreadsheets.get({
      spreadsheetId: spreadsheetId,
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

        // Bold + background color for header row
        requests.push({
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
                  bold: style.bold !== undefined ? style.bold : true,
                  foregroundColor: style.fontColor,
                  fontSize: style.fontSize || 11,
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
              sheetId: sid,
              gridProperties: {
                frozenRowCount: 1
              }
            },
            fields: 'gridProperties.frozenRowCount'
          }
        });
      });

      if (requests.length === 0) return Promise.resolve();

      return gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: spreadsheetId,
        resource: { requests: requests }
      });
    });
  },

  /**
   * Set column widths for all sheets.
   * @param {string} spreadsheetId
   * @param {Object} structure
   * @returns {Promise}
   * @private
   */
  _setColumnWidths: function (spreadsheetId, structure) {
    var defaultWidths = getConfig().sheets.columnWidths;

    return gapi.client.sheets.spreadsheets.get({
      spreadsheetId: spreadsheetId,
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
                pixelSize: (defaultWidths && defaultWidths[i]) ? defaultWidths[i] : 100
              },
              fields: 'pixelSize'
            }
          });
        }
      });

      if (requests.length === 0) return Promise.resolve();

      return gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: spreadsheetId,
        resource: { requests: requests }
      });
    });
  },

  /**
   * Add default settings to Pengaturan sheet.
   * @param {string} spreadsheetId
   * @param {string} schoolName
   * @param {string} schoolAddress
   * @returns {Promise}
   * @private
   */
  _addDefaultSettings: function (spreadsheetId, schoolName, schoolAddress) {
    var values = [
      ['nama_sekolah', schoolName, 'Nama sekolah'],
      ['alamat_sekolah', schoolAddress, 'Alamat sekolah'],
      ['tahun_ajaran', '2024/2025', 'Tahun ajaran aktif'],
      ['whatsapp_enabled', 'false', 'WhatsApp notifikasi aktif']
    ];

    return gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId,
      range: 'Pengaturan!A2',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        majorDimension: 'ROWS',
        values: values
      }
    });
  }
};


// ═══════════════════════════════════════════════════════════════
// D. SHEETS SERVICE — CRUD Operations for Google Sheets
// ═══════════════════════════════════════════════════════════════
//
//  Gets sheetId from AuthService.getCurrentUser().
//  All existing CRUD methods are preserved.
// ═══════════════════════════════════════════════════════════════

/**
 * Factory function: create a SheetsService instance for the current user.
 * @returns {SheetsService|null} SheetsService or null if not connected
 */
function createSheetsService() {
  var user = AuthService.getCurrentUser();
  if (!user || !user.sheetId) {
    console.warn('[Sheets] No sheetId found. Connect Google Drive first.');
    return null;
  }
  if (!gapi || !gapi.client || !gapi.client.sheets) {
    console.warn('[Sheets] Google Sheets API not loaded');
    return null;
  }
  return new SheetsService(user.sheetId);
}

/**
 * SheetsService constructor.
 * @param {string} sheetId - Google Spreadsheet ID
 * @constructor
 */
function SheetsService(sheetId) {
  this.sheetId = sheetId;
  this.service = gapi.client.sheets;
}

// ─── Generic Read ──────────────────────────────────────────

/**
 * Read raw data from a sheet.
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
    return response.result.values || [];
  });
};

/**
 * Read sheet as array of objects (using row 1 as headers).
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
 * Append a single row to a sheet.
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
 * Update a specific row.
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
 * Delete a row by shifting rows up.
 * Uses batchUpdate deleteDimension.
 * @param {string} sheetName
 * @param {number} rowNumber - 1-based
 */
SheetsService.prototype.deleteRow = function (sheetName, rowNumber) {
  var self = this;

  return self.service.spreadsheets.get({
    spreadsheetId: self.sheetId,
    fields: 'sheets.properties.sheetId,sheets.properties.title'
  }).then(function (metaResponse) {
    var targetSheetId = null;
    metaResponse.result.sheets.forEach(function (s) {
      if (s.properties.title === sheetName) {
        targetSheetId = s.properties.sheetId;
      }
    });

    if (targetSheetId === null) {
      throw new Error('Sheet "' + sheetName + '" tidak ditemukan');
    }

    return self.service.spreadsheets.batchUpdate({
      spreadsheetId: self.sheetId,
      resource: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: targetSheetId,
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
 * Clear all data in a sheet except the header row.
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

/**
 * Get all students.
 * @returns {Promise<Object[]>}
 */
SheetsService.prototype.getStudents = function () {
  return this.readSheetAsObjects('Siswa');
};

/**
 * Add a new student.
 * @param {Object} data - { nis, nama, kelas, jenisKelamin, noHpOrtu, alamat, statusAktif }
 */
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

/**
 * Update a student row.
 * @param {number} row - 1-based row number
 * @param {Object} data
 */
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

/**
 * Delete a student row.
 * @param {number} row - 1-based row number
 */
SheetsService.prototype.deleteStudent = function (row) {
  return this.deleteRow('Siswa', row);
};

/**
 * Get students filtered by class.
 * @param {string} className
 * @returns {Promise<Object[]>}
 */
SheetsService.prototype.getStudentsByClass = function (className) {
  return this.getStudents().then(function (students) {
    return students.filter(function (s) {
      return (s['Kelas'] || '').toLowerCase() === className.toLowerCase();
    });
  });
};

// ─── Class Operations ──────────────────────────────────────

/**
 * Get all classes.
 * @returns {Promise<Object[]>}
 */
SheetsService.prototype.getClasses = function () {
  return this.readSheetAsObjects('Kelas');
};

/**
 * Add a new class.
 * @param {Object} data - { namaKelas, tingkat, waliKelas, kapasitas, jumlahSiswa }
 */
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

/**
 * Update a class row.
 * @param {number} row
 * @param {Object} data
 */
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

/**
 * Delete a class row.
 * @param {number} row
 */
SheetsService.prototype.deleteClass = function (row) {
  return this.deleteRow('Kelas', row);
};

// ─── Teacher Operations ────────────────────────────────────

/**
 * Get all teachers.
 * @returns {Promise<Object[]>}
 */
SheetsService.prototype.getTeachers = function () {
  return this.readSheetAsObjects('Guru');
};

/**
 * Add a new teacher.
 * @param {Object} data - { nama, email, mataPelajaran, noHp, role, statusAktif }
 */
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

/**
 * Update a teacher row.
 * @param {number} row
 * @param {Object} data
 */
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

/**
 * Delete a teacher row.
 * @param {number} row
 */
SheetsService.prototype.deleteTeacher = function (row) {
  return this.deleteRow('Guru', row);
};

// ─── Attendance Operations ─────────────────────────────────

/**
 * Get attendance records, optionally filtered by date and class.
 * @param {string} [date] - Date string (YYYY-MM-DD)
 * @param {string} [className] - Class name filter
 * @returns {Promise<Object[]>}
 */
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

/**
 * Add a new attendance record.
 * @param {Object} data - { tanggal, kelas, nis, namaSiswa, status, jamMasuk, keterangan, guruPenginput }
 */
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

/**
 * Get attendance summary for a specific date.
 * @param {string} date - Date string (YYYY-MM-DD)
 * @returns {Promise<Object>} { hadir, sakit, izin, alpha, terlambat, total }
 */
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

/**
 * Get weekly attendance summary (Mon–Fri of current week).
 * @returns {Promise<Array>} Array of daily summary objects
 */
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

/**
 * Get a setting value by key from Pengaturan sheet.
 * @param {string} key - Setting key
 * @returns {Promise<string|null>}
 */
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

/**
 * Get all settings from Pengaturan sheet.
 * @returns {Promise<Object[]>}
 */
SheetsService.prototype.getAllSettings = function () {
  return this.readSheetAsObjects('Pengaturan');
};

/**
 * Set (create or update) a setting in Pengaturan sheet.
 * @param {string} key
 * @param {string} value
 * @param {string} [description]
 */
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


// ═══════════════════════════════════════════════════════════════
// E. WHATSAPP SERVICE
// ═══════════════════════════════════════════════════════════════

var WhatsAppService = {

  /**
   * Send a WhatsApp notification.
   *
   * @param {string} phoneNumber - Target phone number (Indonesian format)
   * @param {Object} data - Template variables
   *   { nama_siswa, kelas, status, tanggal, waktu, nama_sekolah }
   * @returns {Promise<Object>} { success, data?, error? }
   */
  sendNotification: function (phoneNumber, data) {
    var cfg = getConfig().whatsapp;
    if (!cfg.apiUrl || !cfg.apiKey) {
      return Promise.resolve({ success: false, error: 'WhatsApp API belum dikonfigurasi' });
    }

    // Build message from template
    var message = cfg.template;
    Object.keys(data).forEach(function (key) {
      message = message.replace(new RegExp('\\{' + key + '\\}', 'g'), data[key] || '-');
    });

    // Clean phone number to international format
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
   * Send bulk WhatsApp notifications.
   *
   * @param {Array} records - Array of { phoneNumber, data }
   * @returns {Promise<Object>} { sent, failed, errors }
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


// ═══════════════════════════════════════════════════════════════
// F. OFFLINE QUEUE SERVICE
// ═══════════════════════════════════════════════════════════════

/**
 * OfflineQueue — queues attendance records when offline,
 * processes them when connection is restored.
 * @constructor
 */
function OfflineQueue() {
  this.queueKey = 'smart_absen_offline_queue';
}

/**
 * Add an attendance record to the offline queue.
 * @param {Object} record - Attendance data to be synced later
 */
OfflineQueue.prototype.add = function (record) {
  var queue = this._getQueue();
  record._queuedAt = new Date().toISOString();
  queue.push(record);
  localStorage.setItem(this.queueKey, JSON.stringify(queue));
  console.log('[OfflineQueue] Record queued (' + queue.length + ' pending)');
};

/**
 * Process all pending records in the queue.
 * @param {SheetsService} sheetsService - Initialized SheetsService instance
 * @returns {Promise<Object>} { processed, failed }
 */
OfflineQueue.prototype.processQueue = function (sheetsService) {
  var self = this;
  var queue = self._getQueue();
  if (queue.length === 0) {
    return Promise.resolve({ processed: 0, failed: 0 });
  }

  console.log('[OfflineQueue] Processing ' + queue.length + ' queued records...');

  var results = { processed: 0, failed: 0, failedRecords: [] };
  var promises = [];

  queue.forEach(function (record, index) {
    // Strip internal fields before sending
    var cleanRecord = Object.assign({}, record);
    delete cleanRecord._queuedAt;

    var p = sheetsService.addAttendanceRecord(cleanRecord)
      .then(function () {
        results.processed++;
      })
      .catch(function (err) {
        results.failed++;
        results.failedRecords.push({ index: index, error: err.message });
      });
    promises.push(p);
  });

  return Promise.all(promises).then(function () {
    if (results.failed === 0) {
      self.clear();
      console.log('[OfflineQueue] All ' + results.processed + ' records synced');
    } else {
      // Keep only failed items in queue
      var failedIndices = {};
      results.failedRecords.forEach(function (fr) {
        failedIndices[fr.index] = true;
      });
      var remaining = queue.filter(function (item, idx) {
        return failedIndices[idx];
      });
      localStorage.setItem(self.queueKey, JSON.stringify(remaining));
      console.warn('[OfflineQueue] ' + results.failed + ' of ' + queue.length + ' records failed to sync');
    }
    return results;
  });
};

/**
 * Get number of pending records.
 * @returns {number}
 */
OfflineQueue.prototype.getPendingCount = function () {
  return this._getQueue().length;
};

/**
 * Get all pending records.
 * @returns {Array}
 */
OfflineQueue.prototype.getPendingRecords = function () {
  return this._getQueue();
};

/**
 * Clear all pending records.
 */
OfflineQueue.prototype.clear = function () {
  localStorage.removeItem(this.queueKey);
  console.log('[OfflineQueue] Queue cleared');
};

/**
 * Internal: get the queue array from localStorage.
 * @returns {Array}
 * @private
 */
OfflineQueue.prototype._getQueue = function () {
  try {
    var raw = localStorage.getItem(this.queueKey);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
};

/**
 * Get or create the singleton OfflineQueue instance.
 * @returns {OfflineQueue}
 */
function getOfflineQueue() {
  if (!_offlineQueue) {
    _offlineQueue = new OfflineQueue();
  }
  return _offlineQueue;
}


// ═══════════════════════════════════════════════════════════════
// G. SYSTEM CONFIG SERVICE
// ═══════════════════════════════════════════════════════════════
//
//  Loads WhatsApp and other system settings from Firestore.
//  Overrides config.js values with Firestore values set by Master Admin.
// ═══════════════════════════════════════════════════════════════

var SystemConfigService = {

  /**
   * Load system configuration from Firestore.
   * Overrides SMART_ABSEN_CONFIG.whatsapp with Firestore values.
   *
   * @returns {Promise<boolean>} true if config was loaded
   */
  loadSystemConfig: function () {
    var db = _firebaseDb;
    if (!db) {
      return Promise.resolve(false);
    }

    // Load WhatsApp config
    return db.collection('system_config').doc('whatsapp').get().then(function (doc) {
      if (doc.exists) {
        var data = doc.data();
        if (data.api_url) SMART_ABSEN_CONFIG.whatsapp.apiUrl = data.api_url;
        if (data.api_key) SMART_ABSEN_CONFIG.whatsapp.apiKey = data.api_key;
        if (data.template) SMART_ABSEN_CONFIG.whatsapp.template = data.template;
        console.log('[SystemConfig] WhatsApp config loaded from Firestore');
      }
      return true;
    }).catch(function (error) {
      console.warn('[SystemConfig] Could not load system config from Firestore:', error);
      return false;
    });
  },

  /**
   * Save system configuration to Firestore (Master Admin only).
   *
   * @param {string} docId - e.g. 'whatsapp'
   * @param {Object} data - Config data to save
   * @returns {Promise}
   */
  saveSystemConfig: function (docId, data) {
    if (!AuthService.isMasterAdmin()) {
      return Promise.reject(new Error('Hanya Master Admin yang dapat mengubah konfigurasi sistem'));
    }

    var db = _firebaseDb;
    return db.collection('system_config').doc(docId).set(data, { merge: true }).then(function () {
      // Also update in-memory config
      if (docId === 'whatsapp') {
        if (data.api_url) SMART_ABSEN_CONFIG.whatsapp.apiUrl = data.api_url;
        if (data.api_key) SMART_ABSEN_CONFIG.whatsapp.apiKey = data.api_key;
        if (data.template) SMART_ABSEN_CONFIG.whatsapp.template = data.template;
      }
      console.log('[SystemConfig] System config saved:', docId);
    });
  },

  /**
   * Get a system config document from Firestore.
   *
   * @param {string} docId
   * @returns {Promise<Object|null>}
   */
  getSystemConfig: function (docId) {
    var db = _firebaseDb;
    return db.collection('system_config').doc(docId).get().then(function (doc) {
      return doc.exists ? doc.data() : null;
    });
  }
};


// ═══════════════════════════════════════════════════════════════
// H. UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Generate a unique ID (timestamp + random).
 * @returns {string}
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

/**
 * Format a Date object to YYYY-MM-DD string.
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
  var d = date || new Date();
  var year = d.getFullYear();
  var month = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

/**
 * Format a Date object to HH:MM string.
 * @param {Date} date
 * @returns {string}
 */
function formatTime(date) {
  var d = date || new Date();
  var hours = String(d.getHours()).padStart(2, '0');
  var minutes = String(d.getMinutes()).padStart(2, '0');
  return hours + ':' + minutes;
}

/**
 * Get today's date as YYYY-MM-DD string.
 * @returns {string}
 */
function getToday() {
  return formatDate(new Date());
}

/**
 * Show a toast notification.
 * @param {string} message - Text to display
 * @param {string} type - 'success', 'error', 'warning', 'info'
 * @param {number} [duration=3000] - Duration in ms
 */
function showToast(message, type, duration) {
  type = type || 'info';
  duration = duration || 3000;

  // Remove existing toast if any
  var existing = document.getElementById('smart-absen-toast');
  if (existing) existing.remove();

  var toast = document.createElement('div');
  toast.id = 'smart-absen-toast';
  toast.style.cssText = 'position:fixed;top:20px;right:20px;z-index:10000;padding:12px 20px;border-radius:8px;color:#fff;font-size:14px;font-weight:500;max-width:400px;box-shadow:0 4px 12px rgba(0,0,0,0.2);transition:opacity 0.3s;opacity:1;cursor:pointer;';

  var colors = {
    success: '#22c55e',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6'
  };
  toast.style.backgroundColor = colors[type] || colors.info;
  toast.textContent = message;

  document.body.appendChild(toast);

  // Click to dismiss
  toast.addEventListener('click', function () {
    toast.style.opacity = '0';
    setTimeout(function () { toast.remove(); }, 300);
  });

  // Auto dismiss
  setTimeout(function () {
    if (toast.parentNode) {
      toast.style.opacity = '0';
      setTimeout(function () { toast.remove(); }, 300);
    }
  }, duration);
}

/**
 * Show a modal dialog.
 * @param {string} title - Modal title
 * @param {string} content - HTML content
 * @param {Object} [options] - { onClose, buttons }
 * @returns {HTMLElement} The modal element
 */
function showModal(title, content, options) {
  options = options || {};

  // Remove existing modal
  var existing = document.getElementById('smart-absen-modal-overlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'smart-absen-modal-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:20px;';

  var modal = document.createElement('div');
  modal.style.cssText = 'background:#fff;border-radius:12px;max-width:500px;width:100%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);';

  var header = document.createElement('div');
  header.style.cssText = 'padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;';
  header.innerHTML = '<h3 style="margin:0;font-size:18px;font-weight:600;">' + escapeHtml(title) + '</h3>' +
    '<button id="smart-absen-modal-close" style="background:none;border:none;font-size:24px;cursor:pointer;color:#6b7280;line-height:1;">&times;</button>';

  var body = document.createElement('div');
  body.style.cssText = 'padding:20px;';
  body.innerHTML = content;

  var footer = document.createElement('div');
  footer.style.cssText = 'padding:12px 20px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:8px;';

  if (options.buttons && options.buttons.length > 0) {
    options.buttons.forEach(function (btn) {
      var button = document.createElement('button');
      button.textContent = btn.text;
      button.className = btn.className || '';
      button.style.cssText = btn.style || 'padding:8px 16px;border-radius:6px;border:1px solid #d1d5db;background:#fff;cursor:pointer;font-size:14px;';
      button.addEventListener('click', function () {
        if (btn.onClick) btn.onClick();
        overlay.remove();
      });
      footer.appendChild(button);
    });
  } else {
    var okBtn = document.createElement('button');
    okBtn.textContent = 'Tutup';
    okBtn.style.cssText = 'padding:8px 16px;border-radius:6px;border:none;background:#3b82f6;color:#fff;cursor:pointer;font-size:14px;';
    okBtn.addEventListener('click', function () {
      overlay.remove();
    });
    footer.appendChild(okBtn);
  }

  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Close handlers
  document.getElementById('smart-absen-modal-close').addEventListener('click', function () {
    overlay.remove();
  });
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) overlay.remove();
  });
  if (options.onClose) {
    overlay._onClose = options.onClose;
  }

  return modal;
}

/**
 * Show a confirmation dialog.
 * @param {string} title
 * @param {string} message
 * @returns {Promise<boolean>} true if confirmed
 */
function showConfirm(title, message) {
  return new Promise(function (resolve) {
    showModal(title, '<p style="margin:0;color:#4b5563;line-height:1.6;">' + escapeHtml(message) + '</p>', {
      buttons: [
        {
          text: 'Batal',
          style: 'padding:8px 16px;border-radius:6px;border:1px solid #d1d5db;background:#fff;cursor:pointer;font-size:14px;',
          onClick: function () { resolve(false); }
        },
        {
          text: 'Ya, Lanjutkan',
          style: 'padding:8px 16px;border-radius:6px;border:none;background:#ef4444;color:#fff;cursor:pointer;font-size:14px;font-weight:500;',
          onClick: function () { resolve(true); }
        }
      ]
    });
  });
}

/**
 * Export data to CSV and trigger download.
 * @param {Array<Object>} data - Array of objects
 * @param {string} filename - Download filename
 */
function exportToCSV(data, filename) {
  if (!data || data.length === 0) {
    showToast('Tidak ada data untuk diekspor', 'warning');
    return;
  }

  var headers = Object.keys(data[0]).filter(function (key) {
    return key !== '_row'; // exclude internal fields
  });

  var csv = headers.join(',') + '\n';
  data.forEach(function (row) {
    var values = headers.map(function (header) {
      var value = String(row[header] || '').replace(/"/g, '""');
      return '"' + value + '"';
    });
    csv += values.join(',') + '\n';
  });

  var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href = url;
  link.download = filename || 'data.csv';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast('Data berhasil diekspor ke CSV', 'success');
}

/**
 * Debounce function — delays execution until after wait ms of inactivity.
 * @param {Function} fn
 * @param {number} delay - Milliseconds
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
    }, delay);
  };
}

/**
 * Escape HTML special characters to prevent XSS.
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
 * Get attendance status label and color by value.
 * @param {string} value - Status code (H, S, I, A, T)
 * @returns {Object|null} { value, label, color, icon }
 */
function getAttendanceStatus(value) {
  var statuses = getConfig().app.attendanceStatuses || [];
  for (var i = 0; i < statuses.length; i++) {
    if (statuses[i].value.toUpperCase() === (value || '').toUpperCase()) {
      return statuses[i];
    }
  }
  return null;
}

/**
 * Register service worker for PWA support.
 */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/files/v2/sw.js').then(function (registration) {
      console.log('[PWA] Service Worker terdaftar:', registration.scope);
    }).catch(function (error) {
      console.warn('[PWA] Service Worker gagal didaftarkan:', error);
    });
  }
}

/**
 * Sleep utility for async flows.
 * @param {number} ms - Milliseconds
 * @returns {Promise}
 */
function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * Get stored sheet config from current user data.
 * Replaces the old localStorage-based approach — now reads from AuthService.
 *
 * @returns {Object|null} { sheetId, folderId, schoolName, spreadsheetUrl }
 */
function getStoredSheetConfig() {
  var user = AuthService.getCurrentUser();
  if (!user) return null;
  return {
    sheetId: user.sheetId || null,
    folderId: user.folderId || null,
    schoolName: user.schoolName || '',
    spreadsheetUrl: user.spreadsheetUrl || null
  };
}

/**
 * Validate an email address format.
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  var re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

/**
 * Validate password strength (minimum 6 characters).
 * @param {string} password
 * @returns {Object} { valid, message }
 */
function validatePassword(password) {
  if (!password) {
    return { valid: false, message: 'Password wajib diisi' };
  }
  if (password.length < 6) {
    return { valid: false, message: 'Password minimal 6 karakter' };
  }
  return { valid: true, message: '' };
}

/**
 * Format a number as Indonesian Rupiah currency.
 * @param {number} amount
 * @returns {string}
 */
function formatRupiah(amount) {
  if (amount === null || amount === undefined) return 'Rp 0';
  return 'Rp ' + Number(amount).toLocaleString('id-ID');
}

/**
 * Get day name in Indonesian from a Date or date string.
 * @param {Date|string} date
 * @returns {string}
 */
function getDayName(date) {
  var d = date instanceof Date ? date : new Date(date);
  var days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  return days[d.getDay()];
}

/**
 * Get month name in Indonesian.
 * @param {number} monthIndex - 0-11
 * @returns {string}
 */
function getMonthName(monthIndex) {
  var months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return months[monthIndex] || '';
}

/**
 * Deep clone an object (simple implementation).
 * @param {Object} obj
 * @returns {Object}
 */
function deepClone(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (e) {
    return obj;
  }
}

/**
 * Check if current device is mobile.
 * @returns {boolean}
 */
function isMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * Get relative time string in Indonesian (e.g., "5 menit yang lalu").
 * @param {string|Date} date
 * @returns {string}
 */
function getRelativeTime(date) {
  var d = date instanceof Date ? date : new Date(date);
  var now = new Date();
  var diff = Math.floor((now - d) / 1000);

  if (diff < 60) return 'Baru saja';
  if (diff < 3600) return Math.floor(diff / 60) + ' menit yang lalu';
  if (diff < 86400) return Math.floor(diff / 3600) + ' jam yang lalu';
  if (diff < 604800) return Math.floor(diff / 86400) + ' hari yang lalu';
  return formatDate(d);
}


// ═══════════════════════════════════════════════════════════════
// I. ONLINE/OFFLINE EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════

window.addEventListener('online', function () {
  console.log('[Network] Koneksi internet kembali tersedia');

  // Show toast notification
  showToast('Koneksi internet kembali tersedia', 'success', 3000);

  // Try to process offline queue if Google Drive is connected
  if (AuthService.isGoogleDriveConnected()) {
    GoogleDriveService.ensureReady().then(function (ready) {
      if (!ready) return;
      var sheetsService = createSheetsService();
      if (sheetsService) {
        var queue = getOfflineQueue();
        if (queue.getPendingCount() > 0) {
          showToast('Menyinkronkan ' + queue.getPendingCount() + ' data absensi...', 'info', 5000);
          queue.processQueue(sheetsService).then(function (result) {
            if (result.failed === 0) {
              showToast('Semua data berhasil disinkronkan!', 'success');
            } else {
              showToast(result.failed + ' data gagal disinkronkan. Akan dicoba lagi nanti.', 'warning', 5000);
            }
          });
        }
      }
    });
  }
});

window.addEventListener('offline', function () {
  console.log('[Network] Koneksi internet terputus');

  // Show toast notification
  showToast('Koneksi internet terputus. Data akan disimpan secara lokal.', 'warning', 5000);

  // Add offline class to body for styling
  document.body.classList.add('smart-absen-offline');
});

// Update online/offline styling
window.addEventListener('online', function () {
  document.body.classList.remove('smart-absen-offline');
});


// ═══════════════════════════════════════════════════════════════
// J. APP INITIALIZATION
// ═══════════════════════════════════════════════════════════════

/**
 * Initialize the Smart Absen application.
 * Call this once when the page loads.
 * @returns {Promise<Object>} { app, auth, db }
 */
function initApp() {
  // Step 1: Initialize Firebase
  var firebaseResult = initFirebase();

  // Step 2: Register service worker
  registerServiceWorker();

  // Step 3: Set up auth state listener (for session expiry detection)
  _firebaseAuth.onAuthStateChanged(function (firebaseUser) {
    if (!firebaseUser && AuthService.isAuthenticated()) {
      // Firebase session expired but we have local data — clean up
      console.warn('[Auth] Firebase session expired');
      localStorage.removeItem('smart_absen_user');
      localStorage.removeItem('smart_absen_google_token');
      localStorage.removeItem('smart_absen_sheet_config');
      // Redirect to login (handled by the UI layer)
      if (typeof window.onSessionExpired === 'function') {
        window.onSessionExpired();
      }
    }
  });

  // Step 4: Log app info
  var cfg = getConfig().app;
  console.log('[Smart Absen] ' + cfg.name + ' v' + cfg.version + ' initialized');

  return firebaseResult;
}

/**
 * Auto-initialize on script load (if config is ready).
 * The UI layer can also call initApp() manually.
 */
(function () {
  if (typeof window.SMART_ABSEN_CONFIG !== 'undefined' && window.SMART_ABSEN_CONFIG.firebase) {
    // Config is available — safe to initialize
    // Don't auto-init Firebase here; let the page control timing.
    // Just prepare the offline queue.
    _offlineQueue = new OfflineQueue();
  }
})();
