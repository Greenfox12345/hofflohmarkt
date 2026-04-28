# Hofflohmarkt

Eine Webanwendung zur Organisation von Hofflohmärkten mit interaktiver Karte.

## Features

- **Öffentliche Startseite** mit Übersicht aller aktiven Hofflohmärkte
- **Interaktive Karte** (Leaflet + OpenStreetMap) mit Polygon-Geltungsbereich und Stand-Markierungen
- **Standanmeldung** mit Geocoding (Nominatim) und Point-in-Polygon-Prüfung
- **Duplikat-Hinweis** bei gleicher Adresse (Mehrfachanmeldung für Mehrfamilienhäuser möglich)
- **Optionale Felder**: Name/Standbezeichnung und Wegbeschreibung (z. B. Hinterhof)
- **Erweiterbare Kategorien**: Anwohner können eigene Kategorien ergänzen
- **Admin-Bereich**: Marktverwaltung, Standverwaltung, Design-Einstellungen pro Markt
- **Impressum & Datenschutz**: Im Admin-Bereich pflegbar

## Technologie-Stack

- **Backend**: Node.js, Express.js, EJS-Templates
- **Datenbank**: SQLite (better-sqlite3)
- **Karte**: Leaflet + Leaflet.Draw + Nominatim-Geocoding
- **Styling**: Responsives CSS mit CSS-Variablen

## Lokale Entwicklung

```bash
# Abhängigkeiten installieren
npm install

# .env anlegen
cp .env.example .env
# .env bearbeiten: SESSION_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD setzen

# Server starten
npm start
# oder mit Auto-Reload:
npm run dev
```

Öffne http://localhost:3000 im Browser.

## Deployment auf Railway

### Einmalige Einrichtung

1. Kostenlosen Account auf [railway.app](https://railway.app) erstellen (GitHub-Login)
2. "New Project" → "Deploy from GitHub repo" → dieses Repository auswählen
3. **Umgebungsvariablen** unter "Variables" setzen:
   - `NODE_ENV` = `production`
   - `SESSION_SECRET` = (langer zufälliger String, z. B. 32+ Zeichen)
   - `ADMIN_USERNAME` = (gewünschter Admin-Benutzername)
   - `ADMIN_PASSWORD` = (sicheres Passwort)
4. **Persistent Volume** hinzufügen:
   - "Add Volume" → Mount Path: `/data`
   - Damit bleiben Datenbank und Uploads nach Neustarts erhalten
5. Deploy starten – Railway baut und startet die App automatisch

### Umgebungsvariablen

| Variable | Beschreibung | Standard |
|---|---|---|
| `PORT` | Server-Port | `3000` |
| `NODE_ENV` | Umgebung (`production`/`development`) | `development` |
| `SESSION_SECRET` | Geheimer Schlüssel für Sessions | Unsicherer Fallback |
| `ADMIN_USERNAME` | Admin-Benutzername | `admin` |
| `ADMIN_PASSWORD` | Admin-Passwort | `admin` |
| `DB_PATH` | Pfad zur SQLite-Datei | `/data/hofflohmarkt.db` (prod) |

## Admin-Bereich

Erreichbar unter `/admin/login`.

- **Dashboard**: Statistiken (Märkte, Stände)
- **Marktverwaltung**: Märkte anlegen, bearbeiten, Polygon zeichnen, Design pro Markt
- **Standverwaltung**: Angemeldete Stände pro Markt einsehen und löschen
- **Design-Einstellungen**: Globale Farben, Schriftart, Header-Bild, Impressum, Datenschutz
