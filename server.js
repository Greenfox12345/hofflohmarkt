/**
 * server.js – Haupt-Express-Server für die Hofflohmarkt-Anwendung
 *
 * Konfiguriert Express mit EJS-Templating, Sessions, statischen Dateien
 * und bindet die öffentlichen sowie Admin-Routen ein.
 */

// Umgebungsvariablen laden (muss ganz oben stehen)
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const { db, init: initDatabase } = require('./database');

// Datenbank initialisieren (Tabellen anlegen, Admin erstellen)
initDatabase();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// Middleware-Konfiguration
// ============================================

// EJS als Template-Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body-Parser für Formulardaten
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Statische Dateien (CSS, JS, Bilder)
app.use(express.static(path.join(__dirname, 'public')));

// Uploads-Ordner öffentlich zugänglich machen
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Session-Konfiguration
const isProduction = process.env.NODE_ENV === 'production';
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-dev-secret-nicht-fuer-produktion',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 4, // 4 Stunden
    httpOnly: true,
    secure: isProduction // HTTPS in Produktion (Railway)
  }
}));

// Proxy-Vertrauen für Railway (HTTPS hinter Reverse Proxy)
if (isProduction) {
  app.set('trust proxy', 1);
}

// Design-Einstellungen für alle Views verfügbar machen
app.use((req, res, next) => {
  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  res.locals.settings = settings || {};
  res.locals.isAdmin = req.session && req.session.isAdmin === true;
  res.locals.needsMap = false;
  next();
});

// Flash-Nachrichten (einfache Implementierung über Session)
app.use((req, res, next) => {
  res.locals.successMessage = req.session.successMessage || null;
  res.locals.errorMessage = req.session.errorMessage || null;
  // Nach dem Lesen löschen
  delete req.session.successMessage;
  delete req.session.errorMessage;
  next();
});

// ============================================
// Routen einbinden
// ============================================

const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

app.use('/', publicRoutes);
app.use('/admin', adminRoutes);

// ============================================
// Fehlerbehandlung
// ============================================

// 404 – Seite nicht gefunden
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Seite nicht gefunden',
    message: 'Die angeforderte Seite konnte nicht gefunden werden.',
    code: 404
  });
});

// Allgemeiner Fehlerhandler
app.use((err, req, res, next) => {
  console.error('Server-Fehler:', err);
  const isDev = process.env.NODE_ENV !== 'production';
  res.status(500).render('error', {
    title: 'Serverfehler',
    message: isDev ? err.message : 'Ein interner Fehler ist aufgetreten.',
    code: 500
  });
});

// ============================================
// Server starten
// ============================================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🏪 Hofflohmarkt-Server läuft auf http://0.0.0.0:${PORT}`);
  console.log(`   Admin-Login: http://0.0.0.0:${PORT}/admin/login\n`);
});
