/**
 * database.js – Datenbank-Initialisierung und Zugriffsfunktionen
 *
 * Verwendet better-sqlite3 für synchronen, einfachen Zugriff auf SQLite.
 * Alle Tabellen werden beim Start automatisch erstellt, falls sie nicht existieren.
 * Der Admin-Benutzer wird beim ersten Start aus den Umgebungsvariablen angelegt.
 */

const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

// Datenbankdatei:
// - In Produktion (Railway): /data/hofflohmarkt.db (Persistent Volume)
// - Lokal: im Projektverzeichnis
const DB_PATH = process.env.DB_PATH ||
  (process.env.NODE_ENV === 'production'
    ? '/data/hofflohmarkt.db'
    : path.join(__dirname, 'hofflohmarkt.db'));

// Datenbank öffnen (wird automatisch erstellt, falls nicht vorhanden)
const db = new Database(DB_PATH);

// WAL-Modus für bessere Performance bei gleichzeitigen Lesezugriffen
db.pragma('journal_mode = WAL');

// Fremdschlüssel-Unterstützung aktivieren (wichtig für ON DELETE CASCADE)
db.pragma('foreign_keys = ON');

/**
 * Erstellt alle benötigten Tabellen, falls sie noch nicht existieren.
 */
function initTables() {
  db.exec(`
    -- Globale Design-Einstellungen (Singleton – nur eine Zeile)
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      bg_color TEXT DEFAULT '#ffffff',
      text_color TEXT DEFAULT '#333333',
      accent_color TEXT DEFAULT '#007bff',
      font_family TEXT DEFAULT 'Arial, sans-serif',
      header_image TEXT DEFAULT '',
      site_title TEXT DEFAULT 'Hofflohmärkte',
      site_subtitle TEXT DEFAULT 'Entdecke Flohmärkte in deiner Nachbarschaft',
      -- Impressum und Datenschutz (HTML-Inhalt, pflegbar im Admin)
      impressum_html TEXT DEFAULT '',
      datenschutz_html TEXT DEFAULT ''
    );

    -- Standard-Einstellungen einfügen, falls Tabelle leer ist
    INSERT OR IGNORE INTO settings (id) VALUES (1);

    -- Admin-Benutzer (genau ein Account)
    CREATE TABLE IF NOT EXISTS admin_user (
      id INTEGER PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    );

    -- Hofflohmärkte
    CREATE TABLE IF NOT EXISTS markets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      start_time DATETIME NOT NULL,
      end_time DATETIME NOT NULL,
      polygon TEXT NOT NULL,
      active INTEGER DEFAULT 0,
      categories TEXT DEFAULT '[]',
      marker_icon TEXT DEFAULT '',
      -- Individuelle Design-Einstellungen pro Markt
      bg_color TEXT DEFAULT '',
      text_color TEXT DEFAULT '',
      accent_color TEXT DEFAULT '',
      font_family TEXT DEFAULT '',
      header_image TEXT DEFAULT '',
      description TEXT DEFAULT ''
    );

    -- Angemeldete Stände
    CREATE TABLE IF NOT EXISTS stands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
      address TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      categories TEXT DEFAULT '[]',
      name TEXT DEFAULT '',
      directions TEXT DEFAULT '',
      edit_code TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migration: edit_code-Spalte nachrüsten falls Tabelle bereits existiert
  const cols = db.prepare("PRAGMA table_info(stands)").all().map(c => c.name);
  if (!cols.includes('edit_code')) {
    db.exec("ALTER TABLE stands ADD COLUMN edit_code TEXT DEFAULT ''");
    console.log('Migration: edit_code-Spalte zu stands hinzugefügt.');
  }
}

/**
 * Legt den Admin-Benutzer an, falls noch keiner existiert.
 * Liest Benutzername und Passwort aus den Umgebungsvariablen.
 */
function initAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin';

  // Prüfen, ob bereits ein Admin existiert
  const existing = db.prepare('SELECT id FROM admin_user LIMIT 1').get();
  if (existing) {
    console.log('Admin-Benutzer existiert bereits.');
    return;
  }

  // Passwort hashen und speichern
  const hash = bcrypt.hashSync(password, 12);
  db.prepare('INSERT INTO admin_user (username, password_hash) VALUES (?, ?)').run(username, hash);
  console.log(`Admin-Benutzer "${username}" wurde angelegt.`);
}

/**
 * Initialisiert die Datenbank vollständig (Tabellen + Admin).
 */
function init() {
  initTables();
  initAdmin();
}

// Datenbank und init-Funktion exportieren
module.exports = { db, init };
