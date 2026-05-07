/**
 * routes/admin.js – Admin-Routen (geschützter Bereich)
 *
 * Enthält Login/Logout, Dashboard, Design-Einstellungen,
 * Marktverwaltung und Standverwaltung.
 * Alle Routen (außer Login) sind durch Session-Middleware geschützt.
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db } = require('../database');

// ============================================
// Upload-Verzeichnis (persistent auf Railway)
// ============================================
// In Produktion liegt /data auf dem Railway Persistent Volume,
// lokal wird das uploads/-Verzeichnis im Projektordner verwendet.
const UPLOAD_DIR = process.env.NODE_ENV === 'production'
  ? '/data/uploads'
  : path.join(__dirname, '..', 'uploads');
// Ordner anlegen, falls er noch nicht existiert
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ============================================
// Multer-Konfiguration für Datei-Uploads
// ============================================

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Eindeutiger Dateiname mit Zeitstempel
    const ext = path.extname(file.originalname).toLowerCase();
    const basename = path.basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .substring(0, 50);
    cb(null, `${basename}_${Date.now()}${ext}`);
  }
});

// Nur Bilddateien zulassen, max. 5 MB
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Nur PNG-, JPG- und JPEG-Dateien sind erlaubt.'));
    }
  }
});

// ============================================
// Hilfsfunktionen
// ============================================

/**
 * Löscht eine Datei aus dem Uploads-Ordner (falls vorhanden).
 */
function deleteUpload(filename) {
  if (!filename) return;
  const filepath = path.join(UPLOAD_DIR, filename);
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
  }
}

/**
 * Formatiert ein Datum lesbar auf Deutsch.
 */
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString('de-DE', {
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// ============================================
// Auth-Middleware: Schützt alle Admin-Routen
// ============================================

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin === true) {
    return next();
  }
  res.redirect('/admin/login');
}

// ============================================
// Login & Logout
// ============================================

// Login-Seite anzeigen
router.get('/login', (req, res) => {
  res.render('admin/login', {
    title: 'Admin-Login',
    errorMessage: res.locals.errorMessage
  });
});

// Login verarbeiten
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    req.session.errorMessage = 'Bitte Benutzername und Passwort eingeben.';
    return res.redirect('/admin/login');
  }

  const user = db.prepare('SELECT * FROM admin_user WHERE username = ?').get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    req.session.errorMessage = 'Ungültiger Benutzername oder Passwort.';
    return res.redirect('/admin/login');
  }

  // Login erfolgreich
  req.session.isAdmin = true;
  req.session.successMessage = 'Erfolgreich angemeldet.';
  res.redirect('/admin/dashboard');
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

// ============================================
// Ab hier: Alle Routen erfordern Admin-Login
// ============================================
router.use(requireAdmin);

// ============================================
// Dashboard
// ============================================

router.get('/dashboard', (req, res) => {
  const marketCount = db.prepare('SELECT COUNT(*) as count FROM markets').get().count;
  const activeCount = db.prepare('SELECT COUNT(*) as count FROM markets WHERE active = 1').get().count;
  const standCount = db.prepare('SELECT COUNT(*) as count FROM stands').get().count;

  res.render('admin/dashboard', {
    title: 'Admin-Dashboard',
    stats: { marketCount, activeCount, standCount }
  });
});

// ============================================
// Design-Einstellungen
// ============================================

// Formular anzeigen
router.get('/design', (req, res) => {
  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  res.render('admin/design', {
    title: 'Design-Einstellungen',
    settings
  });
});

// Einstellungen speichern
router.post('/design', upload.single('header_image'), (req, res) => {
  const { bg_color, text_color, accent_color, font_family, site_title, site_subtitle,
          impressum_html, datenschutz_html } = req.body;

  // Aktuelles Header-Bild ermitteln
  const current = db.prepare('SELECT header_image FROM settings WHERE id = 1').get();
  let headerImage = current ? current.header_image : '';

  // Neues Bild hochgeladen?
  if (req.file) {
    // Altes Bild löschen
    deleteUpload(headerImage);
    headerImage = req.file.filename;
  }

  // Header-Bild entfernen, wenn Checkbox gesetzt
  if (req.body.remove_header_image === 'yes') {
    deleteUpload(headerImage);
    headerImage = '';
  }

  db.prepare(`
    UPDATE settings SET
      bg_color = ?,
      text_color = ?,
      accent_color = ?,
      font_family = ?,
      header_image = ?,
      site_title = ?,
      site_subtitle = ?,
      impressum_html = ?,
      datenschutz_html = ?
    WHERE id = 1
  `).run(
    bg_color || '#ffffff',
    text_color || '#333333',
    accent_color || '#007bff',
    font_family || 'Arial, sans-serif',
    headerImage,
    site_title || 'Hofflohmärkte',
    site_subtitle || '',
    impressum_html || '',
    datenschutz_html || ''
  );

  req.session.successMessage = 'Design-Einstellungen wurden gespeichert.';
  res.redirect('/admin/design');
});

// ============================================
// Marktverwaltung
// ============================================

// Markt-Übersicht
router.get('/markets', (req, res) => {
  const markets = db.prepare('SELECT * FROM markets ORDER BY start_time DESC').all();

  const marketsFormatted = markets.map(m => {
    const standCount = db.prepare('SELECT COUNT(*) as count FROM stands WHERE market_id = ?').get(m.id).count;
    return {
      ...m,
      startFormatted: formatDate(m.start_time),
      endFormatted: formatDate(m.end_time),
      standCount
    };
  });

  res.render('admin/markets', {
    title: 'Marktverwaltung',
    markets: marketsFormatted
  });
});

// Neuen Markt anlegen – Formular
router.get('/markets/create', (req, res) => {
  res.render('admin/market-form', {
    title: 'Neuen Markt anlegen',
    market: null, // Kein bestehender Markt → Neuanlage
    isEdit: false
  });
});

// Neuen Markt anlegen – Speichern
router.post('/markets/create', upload.fields([{ name: 'marker_icon', maxCount: 1 }, { name: 'market_header_image', maxCount: 1 }]), (req, res) => {
  const { name, start_time, end_time, polygon, categories, active } = req.body;

  // Validierung
  if (!name || !start_time || !end_time || !polygon) {
    req.session.errorMessage = 'Bitte alle Pflichtfelder ausfüllen und ein Polygon zeichnen.';
    return res.redirect('/admin/markets/create');
  }

  // Polygon validieren
  let polygonParsed;
  try {
    polygonParsed = JSON.parse(polygon);
    if (!Array.isArray(polygonParsed) || polygonParsed.length < 3) {
      throw new Error('Polygon muss mindestens 3 Punkte haben.');
    }
  } catch (err) {
    req.session.errorMessage = 'Ungültiges Polygon. Bitte zeichnen Sie einen Bereich auf der Karte.';
    return res.redirect('/admin/markets/create');
  }

  // Kategorien: Komma-getrennte Eingabe → JSON-Array
  const categoriesArray = (categories || '')
    .split(',')
    .map(c => c.trim())
    .filter(c => c.length > 0);

  const markerIcon = (req.files && req.files['marker_icon'] && req.files['marker_icon'][0])
    ? req.files['marker_icon'][0].filename : '';

  // Design-Felder aus dem Formular
  const bgColor = req.body.bg_color || '';
  const textColor = req.body.text_color || '';
  const accentColor = req.body.accent_color || '';
  const fontFamily = req.body.font_family || '';
  const description = (req.body.description || '').trim();

  // Header-Bild für diesen Markt
  const headerImage = (req.files && req.files['market_header_image'] && req.files['market_header_image'][0])
    ? req.files['market_header_image'][0].filename : '';

  db.prepare(`
    INSERT INTO markets (name, start_time, end_time, polygon, active, categories, marker_icon,
      bg_color, text_color, accent_color, font_family, header_image, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name.trim(),
    start_time,
    end_time,
    JSON.stringify(polygonParsed),
    active === 'on' ? 1 : 0,
    JSON.stringify(categoriesArray),
    markerIcon,
    bgColor,
    textColor,
    accentColor,
    fontFamily,
    headerImage,
    description
  );

  req.session.successMessage = `Markt "${name}" wurde erfolgreich angelegt.`;
  res.redirect('/admin/markets');
});

// Markt bearbeiten – Formular
router.get('/markets/:id/edit', (req, res) => {
  const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(req.params.id);

  if (!market) {
    req.session.errorMessage = 'Markt nicht gefunden.';
    return res.redirect('/admin/markets');
  }

  res.render('admin/market-form', {
    title: `Markt bearbeiten: ${market.name}`,
    market: {
      ...market,
      categoriesString: JSON.parse(market.categories || '[]').join(', ')
    },
    isEdit: true
  });
});

// Markt bearbeiten – Speichern
router.post('/markets/:id/edit', upload.fields([{ name: 'marker_icon', maxCount: 1 }, { name: 'market_header_image', maxCount: 1 }]), (req, res) => {
  const marketId = parseInt(req.params.id);
  const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(marketId);

  if (!market) {
    req.session.errorMessage = 'Markt nicht gefunden.';
    return res.redirect('/admin/markets');
  }

  const { name, start_time, end_time, polygon, categories, active } = req.body;

  // Validierung
  if (!name || !start_time || !end_time || !polygon) {
    req.session.errorMessage = 'Bitte alle Pflichtfelder ausfüllen.';
    return res.redirect(`/admin/markets/${marketId}/edit`);
  }

  // Polygon validieren
  let polygonParsed;
  try {
    polygonParsed = JSON.parse(polygon);
    if (!Array.isArray(polygonParsed) || polygonParsed.length < 3) {
      throw new Error('Polygon muss mindestens 3 Punkte haben.');
    }
  } catch (err) {
    req.session.errorMessage = 'Ungültiges Polygon.';
    return res.redirect(`/admin/markets/${marketId}/edit`);
  }

  // Kategorien
  const categoriesArray = (categories || '')
    .split(',')
    .map(c => c.trim())
    .filter(c => c.length > 0);

  // Marker-Icon
  let markerIcon = market.marker_icon || '';
  if (req.files && req.files['marker_icon'] && req.files['marker_icon'][0]) {
    deleteUpload(markerIcon);
    markerIcon = req.files['marker_icon'][0].filename;
  }
  if (req.body.remove_marker_icon === 'yes') {
    deleteUpload(markerIcon);
    markerIcon = '';
  }

  // Header-Bild pro Markt
  let headerImage = market.header_image || '';
  if (req.files && req.files['market_header_image'] && req.files['market_header_image'][0]) {
    deleteUpload(headerImage);
    headerImage = req.files['market_header_image'][0].filename;
  }
  if (req.body.remove_header_image === 'yes') {
    deleteUpload(headerImage);
    headerImage = '';
  }

  // Design-Felder
  const bgColor = req.body.bg_color || '';
  const textColor = req.body.text_color || '';
  const accentColor = req.body.accent_color || '';
  const fontFamily = req.body.font_family || '';
  const description = (req.body.description || '').trim();

  db.prepare(`
    UPDATE markets SET
      name = ?, start_time = ?, end_time = ?, polygon = ?,
      active = ?, categories = ?, marker_icon = ?,
      bg_color = ?, text_color = ?, accent_color = ?, font_family = ?,
      header_image = ?, description = ?
    WHERE id = ?
  `).run(
    name.trim(),
    start_time,
    end_time,
    JSON.stringify(polygonParsed),
    active === 'on' ? 1 : 0,
    JSON.stringify(categoriesArray),
    markerIcon,
    bgColor,
    textColor,
    accentColor,
    fontFamily,
    headerImage,
    description,
    marketId
  );

  req.session.successMessage = `Markt "${name}" wurde aktualisiert.`;
  res.redirect('/admin/markets');
});

// Markt-Status umschalten (aktiv/inaktiv)
router.post('/markets/:id/toggle', (req, res) => {
  const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(req.params.id);

  if (market) {
    const newStatus = market.active === 1 ? 0 : 1;
    db.prepare('UPDATE markets SET active = ? WHERE id = ?').run(newStatus, market.id);
    req.session.successMessage = `Markt "${market.name}" ist jetzt ${newStatus === 1 ? 'aktiv' : 'inaktiv'}.`;
  }

  res.redirect('/admin/markets');
});

// Markt löschen
router.post('/markets/:id/delete', (req, res) => {
  const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(req.params.id);

  if (market) {
    // Marker-Icon löschen
    deleteUpload(market.marker_icon);
    // Markt löschen (Stände werden durch ON DELETE CASCADE entfernt)
    db.prepare('DELETE FROM markets WHERE id = ?').run(market.id);
    req.session.successMessage = `Markt "${market.name}" und alle zugehörigen Stände wurden gelöscht.`;
  }

  res.redirect('/admin/markets');
});

// ============================================
// Standverwaltung (pro Markt)
// ============================================

// Stände eines Marktes anzeigen
router.get('/markets/:id/stands', (req, res) => {
  const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(req.params.id);

  if (!market) {
    req.session.errorMessage = 'Markt nicht gefunden.';
    return res.redirect('/admin/markets');
  }

  const stands = db.prepare(
    'SELECT * FROM stands WHERE market_id = ? ORDER BY created_at DESC'
  ).all(market.id);

  const standsFormatted = stands.map(s => ({
    ...s,
    categoriesParsed: JSON.parse(s.categories || '[]'),
    createdFormatted: formatDate(s.created_at)
  }));

  res.render('admin/stands', {
    title: `Stände – ${market.name}`,
    market: { ...market, categoriesParsed: JSON.parse(market.categories || '[]') },
    stands: standsFormatted,
    successMessage: req.session.successMessage || null,
    errorMessage:   req.session.errorMessage   || null
  });
  req.session.successMessage = null;
  req.session.errorMessage   = null;
});

/// Stand hinzufügen (Admin)
router.post('/markets/:marketId/stands/add', async (req, res) => {
  const { marketId } = req.params;
  const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(marketId);
  if (!market) {
    req.session.errorMessage = 'Markt nicht gefunden.';
    return res.redirect('/admin/markets');
  }
  const { street, housenumber, zip, name, directions } = req.body;
  let selectedCategories = req.body.categories || [];
  if (typeof selectedCategories === 'string') selectedCategories = [selectedCategories];

  if (!street || !housenumber || !zip) {
    req.session.errorMessage = 'Bitte Straße, Hausnummer und PLZ ausfüllen.';
    return res.redirect(`/admin/markets/${marketId}/stands`);
  }
  const fullAddress = `${street} ${housenumber}, ${zip}`;

  // Geocoding
  const { geocodeAddress } = require('./public');
  let coords;
  try { coords = await geocodeAddress({ street, housenumber, zip, city: '' }); }
  catch (e) { coords = null; }
  if (!coords) {
    req.session.errorMessage = 'Adresse konnte nicht gefunden werden.';
    return res.redirect(`/admin/markets/${marketId}/stands`);
  }

  // 6-stelligen Bearbeitungscode generieren
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];

  db.prepare(`
    INSERT INTO stands (market_id, address, latitude, longitude, categories, name, directions, edit_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(marketId, fullAddress, coords.lat, coords.lon,
    JSON.stringify(selectedCategories), (name || '').trim(), (directions || '').trim(), code);

  req.session.successMessage = `Stand "${fullAddress}" wurde hinzugefügt. Bearbeitungscode: ${code}`;
  res.redirect(`/admin/markets/${marketId}/stands`);
});

// Stand bearbeiten (Admin)
router.post('/markets/:marketId/stands/:standId/edit', async (req, res) => {
  const { marketId, standId } = req.params;
  const stand = db.prepare('SELECT * FROM stands WHERE id = ? AND market_id = ?').get(standId, marketId);
  if (!stand) {
    req.session.errorMessage = 'Stand nicht gefunden.';
    return res.redirect(`/admin/markets/${marketId}/stands`);
  }
  const { name, directions, street, housenumber, zip } = req.body;
  let selectedCategories = req.body.categories || [];
  if (typeof selectedCategories === 'string') selectedCategories = [selectedCategories];

  let newAddress = stand.address;
  let newLat = stand.latitude;
  let newLon = stand.longitude;

  // Adresse neu geocodieren wenn Felder ausgefüllt
  if (street && housenumber && zip) {
    const fullAddress = `${street.trim()} ${housenumber.trim()}, ${zip.trim()}`;
    if (fullAddress !== stand.address) {
      const { geocodeAddress } = require('./public');
      let coords;
      try { coords = await geocodeAddress({ street: street.trim(), housenumber: housenumber.trim(), zip: zip.trim(), city: '' }); }
      catch (e) { coords = null; }
      if (!coords) {
        req.session.errorMessage = 'Neue Adresse konnte nicht gefunden werden. Andere Felder wurden gespeichert.';
      } else {
        newAddress = fullAddress;
        newLat = coords.lat;
        newLon = coords.lon;
      }
    }
  }

  db.prepare(`
    UPDATE stands SET name = ?, directions = ?, categories = ?, address = ?, latitude = ?, longitude = ? WHERE id = ?
  `).run((name || '').trim(), (directions || '').trim(), JSON.stringify(selectedCategories), newAddress, newLat, newLon, stand.id);
  if (!req.session.errorMessage) {
    req.session.successMessage = `Stand "${newAddress}" wurde aktualisiert.`;
  }
  res.redirect(`/admin/markets/${marketId}/stands`);
});

// Einzelnen Stand löschen
router.post('/markets/:marketId/stands/:standId/delete', (req, res) => {
  const { marketId, standId } = req.params;
  const stand = db.prepare('SELECT * FROM stands WHERE id = ? AND market_id = ?').get(standId, marketId);
  if (stand) {
    db.prepare('DELETE FROM stands WHERE id = ?').run(stand.id);
    req.session.successMessage = `Stand "${stand.address}" wurde gelöscht.`;
  }
  res.redirect(`/admin/markets/${marketId}/stands`);
});

// ============================================
// Multer-Fehlerbehandlung
// ============================================

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      req.session.errorMessage = 'Die Datei ist zu groß. Maximale Größe: 5 MB.';
    } else {
      req.session.errorMessage = `Upload-Fehler: ${err.message}`;
    }
    return res.redirect('back');
  }
  if (err && err.message && err.message.includes('Nur PNG')) {
    req.session.errorMessage = err.message;
    return res.redirect('back');
  }
  next(err);
});

module.exports = router;
