/**
 * routes/public.js – Öffentliche Routen
 *
 * Enthält die Startseite, die Markt-Detailseite und die Standanmeldung.
 * Diese Routen sind ohne Login zugänglich.
 */

const express = require('express');
const router = express.Router();
const { db } = require('../database');
const StaticMaps = require('staticmaps');

// ============================================
// Hilfsfunktionen
// ============================================

/**
 * Point-in-Polygon-Test (Ray-Casting-Algorithmus)
 * Prüft, ob ein Punkt [lat, lng] innerhalb eines Polygons liegt.
 * Das Polygon ist ein Array von [lat, lng]-Paaren.
 */
function pointInPolygon(point, polygon) {
  const [x, y] = point; // [lat, lng]
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    const intersect = ((yi > y) !== (yj > y))
      && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Geocoding über Nominatim (OpenStreetMap)
 * Verwendet die strukturierte Abfrage (street, city, postalcode) für
 * maximale Genauigkeit – damit wird die Hausnummer korrekt aufgelöst.
 * Gibt { lat, lon } zurück oder null bei Fehler.
 */
async function geocodeAddress({ street, housenumber, zip, city = '' }) {
  // Verzögerung einhalten (Nominatim-Nutzungslimit: max. 1 Anfrage/Sekunde)
  await new Promise(resolve => setTimeout(resolve, 1500));

  // Strukturierte Query: Hausnummer + Straße, PLZ reicht für Ortsauflösung
  const params = new URLSearchParams({
    format: 'json',
    street: `${housenumber} ${street}`,
    postalcode: zip,
    countrycodes: 'de',
    limit: '1',
    addressdetails: '1'
  });
  // Ort nur hinzufügen wenn angegeben (optional)
  if (city && city.trim()) params.set('city', city.trim());

  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'HofflohmarktApp/1.0 (Hofflohmarkt-Organisationstool)'
    }
  });

  if (!response.ok) return null;

  const data = await response.json();

  // Wenn die strukturierte Suche kein Ergebnis liefert,
  // Fallback auf freie Textsuche mit Straße, Hausnummer und PLZ
  if (!data || data.length === 0) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const fallbackQuery = city && city.trim()
      ? `${street} ${housenumber}, ${zip} ${city}`
      : `${street} ${housenumber}, ${zip}`;
    const fallbackUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fallbackQuery)}&countrycodes=de&limit=1`;
    const fallbackResponse = await fetch(fallbackUrl, {
      headers: {
        'User-Agent': 'HofflohmarktApp/1.0 (Hofflohmarkt-Organisationstool)'
      }
    });
    if (!fallbackResponse.ok) return null;
    const fallbackData = await fallbackResponse.json();
    if (!fallbackData || fallbackData.length === 0) return null;
    return {
      lat: parseFloat(fallbackData[0].lat),
      lon: parseFloat(fallbackData[0].lon)
    };
  }

  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon)
  };
}

/**
 * Formatiert ein Datum lesbar auf Deutsch.
 */
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString('de-DE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// ============================================
// Startseite
// ============================================

router.get('/', (req, res) => {
  // Alle aktiven Märkte laden
  const markets = db.prepare(
    'SELECT * FROM markets WHERE active = 1 ORDER BY start_time ASC'
  ).all();

  // Datum für die Anzeige formatieren
  const marketsFormatted = markets.map(m => ({
    ...m,
    startFormatted: formatDate(m.start_time),
    endFormatted: formatDate(m.end_time),
    categoriesParsed: JSON.parse(m.categories || '[]')
  }));

  res.render('welcome', {
    title: res.locals.settings.site_title || 'Hofflohmärkte',
    markets: marketsFormatted
  });
});

// ============================================
// Markt-Detailseite
// ============================================

router.get('/markt/:id', (req, res) => {
  const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(req.params.id);

  if (!market) {
    return res.status(404).render('error', {
      title: 'Markt nicht gefunden',
      message: 'Der angeforderte Hofflohmarkt existiert nicht.',
      code: 404
    });
  }

  // Alle Stände dieses Marktes laden
  const stands = db.prepare(
    'SELECT * FROM stands WHERE market_id = ? ORDER BY created_at ASC'
  ).all(market.id);

  // Kategorien parsen
  const categories = JSON.parse(market.categories || '[]');

  // Marktspezifische Design-Einstellungen (Fallback auf globale Einstellungen)
  const globalSettings = res.locals.settings;
  const marketSettings = {
    bg_color: market.bg_color || globalSettings.bg_color || '#ffffff',
    text_color: market.text_color || globalSettings.text_color || '#333333',
    accent_color: market.accent_color || globalSettings.accent_color || '#007bff',
    font_family: market.font_family || globalSettings.font_family || 'Arial, sans-serif',
    header_image: market.header_image || '',
    description: market.description || ''
  };

  res.render('market-detail', {
    title: market.name,
    market: {
      ...market,
      startFormatted: formatDate(market.start_time),
      endFormatted: formatDate(market.end_time),
      categoriesParsed: categories,
      polygonParsed: JSON.parse(market.polygon || '[]')
    },
    marketSettings,
    stands: stands.map(s => ({
      ...s,
      categoriesParsed: JSON.parse(s.categories || '[]')
    })),
    // Flash-Nachrichten
    successMessage: res.locals.successMessage,
    errorMessage: res.locals.errorMessage,
    // Neuer Stand: Bearbeitungscode für Popup
    newStandCode: req.session.newStandCode || null,
    // Für Duplikat-Hinweis: vorherige Formulardaten
    formData: req.session.formData || null,
    duplicateStands: req.session.duplicateStands || null
  });
  // Formulardaten, Duplikat-Info und Code nach Anzeige löschen
  delete req.session.formData;
  delete req.session.duplicateStands;
  delete req.session.newStandCode;
});

// ============================================
// Standanmeldung (POST)
// ============================================

router.post('/markt/:id/anmelden', async (req, res) => {
  const marketId = parseInt(req.params.id);
  const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(marketId);

  if (!market) {
    return res.status(404).render('error', {
      title: 'Markt nicht gefunden',
      message: 'Der angeforderte Hofflohmarkt existiert nicht.',
      code: 404
    });
  }

  const { street, housenumber, zip, name, directions, confirm_duplicate } = req.body;
  // Ort wird nicht mehr vom Nutzer eingegeben – er wird per Geocoding ermittelt

  // Gewählte Kategorien sammeln (Checkboxen)
  let selectedCategories = req.body.categories || [];
  if (typeof selectedCategories === 'string') {
    selectedCategories = [selectedCategories];
  }

  // ---- Validierung ----
  if (!street || !housenumber || !zip) {
    req.session.errorMessage = 'Bitte füllen Sie alle Adressfelder aus (Straße, Hausnummer und PLZ).';
    return res.redirect(`/markt/${marketId}`);
  }

  // Vollständige Adresse zusammenbauen (ohne Ort – ergibt sich aus Geocoding)
  const fullAddress = `${street} ${housenumber}, ${zip}`;

  // ---- Duplikat-Prüfung ----
  // Prüfen, ob bereits Stände mit dieser Adresse existieren
  if (confirm_duplicate !== 'yes') {
    const existingStands = db.prepare(
      'SELECT * FROM stands WHERE market_id = ? AND address = ?'
    ).all(marketId, fullAddress);

    if (existingStands.length > 0) {
      // Duplikat gefunden – Nutzer informieren und bestätigen lassen
      req.session.formData = { street, housenumber, zip, name, directions, categories: selectedCategories };
      req.session.duplicateStands = existingStands.map(s => ({
        ...s,
        categoriesParsed: JSON.parse(s.categories || '[]')
      }));
      req.session.errorMessage = `Unter der Adresse "${fullAddress}" sind bereits ${existingStands.length} Stand/Stände angemeldet. Wenn Sie einen weiteren Stand anmelden möchten (z. B. für eine andere Wohnpartei), bestätigen Sie bitte unten.`;
      return res.redirect(`/markt/${marketId}`);
    }
  }

  // ---- Geocoding ----
  // Strukturierte Abfrage für präzise Hausnummer-Auflösung
  // city wird leer übergeben – Nominatim löst es über PLZ auf
  let coords;
  try {
    coords = await geocodeAddress({ street, housenumber, zip, city: '' });
  } catch (err) {
    console.error('Geocoding-Fehler:', err);
    req.session.errorMessage = 'Bei der Adresssuche ist ein Fehler aufgetreten. Bitte versuchen Sie es später erneut.';
    return res.redirect(`/markt/${marketId}`);
  }

  if (!coords) {
    req.session.errorMessage = 'Die Adresse konnte nicht gefunden werden. Bitte prüfen Sie Ihre Eingabe.';
    return res.redirect(`/markt/${marketId}`);
  }

  // ---- Point-in-Polygon-Prüfung ----
  const polygon = JSON.parse(market.polygon || '[]');
  const isInside = pointInPolygon([coords.lat, coords.lon], polygon);

  if (!isInside) {
    req.session.errorMessage = 'Die Adresse liegt nicht im Geltungsbereich dieses Hofflohmarktes.';
    return res.redirect(`/markt/${marketId}`);
  }

  // ---- Neue Kategorien zum Markt hinzufügen ----
  // Wenn Anwohner eigene Kategorien ergänzt haben, werden diese auch
  // in die Markt-Kategorien aufgenommen (für zukünftige Anmeldungen sichtbar)
  const existingCategories = JSON.parse(market.categories || '[]');
  const newCategories = selectedCategories.filter(c => 
    !existingCategories.some(ec => ec.toLowerCase() === c.toLowerCase())
  );
  if (newCategories.length > 0) {
    const updatedCategories = [...existingCategories, ...newCategories];
    db.prepare('UPDATE markets SET categories = ? WHERE id = ?')
      .run(JSON.stringify(updatedCategories), marketId);
  }

  // ---- Bearbeitungscode generieren ----
  const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let editCode = '';
  for (let i = 0; i < 6; i++) editCode += codeChars[Math.floor(Math.random() * codeChars.length)];

  // ---- Stand speichern ----
  db.prepare(`
    INSERT INTO stands (market_id, address, latitude, longitude, categories, name, directions, edit_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    marketId,
    fullAddress,
    coords.lat,
    coords.lon,
    JSON.stringify(selectedCategories),
    (name || '').trim(),
    (directions || '').trim(),
    editCode
  );
  req.session.successMessage = `Ihr Stand wurde erfolgreich angemeldet!`;
  req.session.newStandCode = editCode;
  res.redirect(`/markt/${marketId}`);
});

// ============================================
// Karten-Download
// ============================================

/**
 * GET /markt/:id/karte-download
 * Generiert ein PNG-Kartenbild des Markt-Geltungsbereichs serverseitig.
 * - Bounding Box des Polygons + mindestens 2 km Rand (korrekte Ausdehnung)
 * - Zoom automatisch berechnet (max. 17, damit Hausnummern sichtbar)
 * - Polygon als blaues Overlay eingezeichnet
 * - Angemeldete Stände als Marker eingezeichnet (mit marktspezifischem Icon wenn vorhanden)
 * - Doppelte Auflösung (2800px Breite)
 */
router.get('/markt/:id/karte-download', async (req, res) => {
  const path = require('path');
  const fs   = require('fs');
  try {
    // Markt + Stände laden
    const market = db.prepare(
      'SELECT id, name, polygon, marker_icon FROM markets WHERE id = ?'
    ).get(req.params.id);
    if (!market || !market.polygon) {
      return res.status(404).send('Markt oder Polygon nicht gefunden.');
    }

    const polygon = JSON.parse(market.polygon); // [[lat, lng], ...]
    if (!Array.isArray(polygon) || polygon.length < 3) {
      return res.status(400).send('Ungültiges Polygon.');
    }

    const stands = db.prepare(
      'SELECT latitude, longitude, name, address FROM stands WHERE market_id = ?'
    ).all(req.params.id);

    // ── Bounding Box des Polygons ──────────────────────────────────────────
    const lats = polygon.map(p => p[0]);
    const lngs = polygon.map(p => p[1]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const midLat = (minLat + maxLat) / 2;

    // ── Query-Parameter: Rand in % und Zoomstufe ───────────────────────────────────────────
    // rand_h: Rand links+rechts in % der Querausdehnung (Standard: 20)
    // rand_v: Rand oben+unten  in % der Längsausdehnung (Standard: 20)
    // zoom:   Zoomstufe 13–17 (Standard: 17, max: 17)
    const randH     = Math.min(200, Math.max(0, parseFloat(req.query.rand_h) || 20)) / 100;
    const randV     = Math.min(200, Math.max(0, parseFloat(req.query.rand_v) || 20)) / 100;
    const fixedZoom = Math.min(17, Math.max(13, parseInt(req.query.zoom) || 17));

    // Rand in Grad umrechnen (relativ zur Polygon-Ausdehnung)
    const polyLngSpan = maxLng - minLng;
    const polyLatSpan = maxLat - minLat;
    const padLng = polyLngSpan * randH;
    const padLat = polyLatSpan * randV;

    const paddedMinLat = minLat - padLat;
    const paddedMaxLat = maxLat + padLat;
    const paddedMinLng = minLng - padLng;
    const paddedMaxLng = maxLng + padLng;

    // ── Bildgröße: exakt aus gepaddeter BBox bei festem Zoom ───────────────────────────────────────────────
    // Bildbreite/-höhe = Anzahl Pixel, die die gepaddete BBox bei fixedZoom belegt.
    // So erscheint das Polygon bei mehr Rand kleiner im Verhältnis zur Gesamtfläche.
    // Die OSM-Tile-Formel berücksichtigt die cos(lat)-Stauchung bereits korrekt.
    const TILE_SIZE = 256;
    const lonToX = (lon, z) => (lon + 180) / 360 * Math.pow(2, z);
    const latToY = (lat, z) => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z);
    let imgWidth  = Math.round((lonToX(paddedMaxLng, fixedZoom) - lonToX(paddedMinLng, fixedZoom)) * TILE_SIZE);
    let imgHeight = Math.round((latToY(paddedMinLat, fixedZoom) - latToY(paddedMaxLat, fixedZoom)) * TILE_SIZE);
    // Sicherheitsgrenzen (max 8000px für doppelte Auflösung/Schärfe, min 400px)
    if (imgWidth > 8000 || imgHeight > 8000) {
      const scale = Math.min(8000 / imgWidth, 8000 / imgHeight);
      imgWidth  = Math.round(imgWidth  * scale);
      imgHeight = Math.round(imgHeight * scale);
    }
    if (imgWidth  < 400)  imgWidth  = 400;
    if (imgHeight < 400)  imgHeight = 400;

    // staticmaps-Instanz mit festem Zoom
    const map = new StaticMaps({
      width:  imgWidth,
      height: imgHeight,
      tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      tileSubdomains: ['a', 'b', 'c'],
      tileSize: TILE_SIZE,
      zoomRange: { min: fixedZoom, max: fixedZoom } // exakter Zoom
    });

    // ── Polygon als Overlay ────────────────────────────────────────────────
    // staticmaps erwartet [lng, lat]
    const overlayCoords = polygon.map(p => [p[1], p[0]]);
    overlayCoords.push(overlayCoords[0]); // schließen
    map.addPolygon({
      coords: overlayCoords,
      color:  '#0055cc',
      fill:   'rgba(0, 85, 204, 0.15)',
      width:  4
    });

    // ── Stand-Marker ───────────────────────────────────────────────────────
    // Marker-Icon: marktspezifisches Bild skalieren (sharp) und als tmp-Datei speichern
    // staticmaps skaliert Icons NICHT automatisch – wir müssen das selbst tun.
    const sharp = require('sharp');
    const os    = require('os');
    // Icon-Größe: bei Zoom 17 um 50% größer (36px) als bei Zoom 15 (24px)
    const ICON_SIZE = fixedZoom >= 17 ? 36 : 24;

    let scaledIconPath = null;
    if (market.marker_icon) {
      // Upload-Verzeichnis: in Produktion /data/uploads, lokal ./uploads
      const uploadDir = process.env.NODE_ENV === 'production'
        ? '/data/uploads'
        : path.join(__dirname, '..', 'uploads');
      const candidate = path.join(uploadDir, market.marker_icon);
      if (fs.existsSync(candidate)) {
        // Auf ICON_SIZE×ICON_SIZE skalieren und als tmp-PNG speichern
        const tmpIcon = path.join(os.tmpdir(), `marker_scaled_${Date.now()}.png`);
        await sharp(candidate)
          .resize(ICON_SIZE, ICON_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toFile(tmpIcon);
        scaledIconPath = tmpIcon;
      }
    }

    for (const stand of stands) {
      if (!stand.latitude || !stand.longitude) continue;
      if (scaledIconPath) {
        // Ankerpunkt: unten-mitte des Icons (Faden/Spitze des Markers)
        map.addMarker({
          coord:   [stand.longitude, stand.latitude],
          img:     scaledIconPath,
          height:  ICON_SIZE,
          width:   ICON_SIZE,
          offsetX: Math.round(ICON_SIZE / 2),
          offsetY: ICON_SIZE
        });
      } else {
        // Fallback: roter Kreis-Marker
        map.addCircle({
          coord:  [stand.longitude, stand.latitude],
          radius: 8,
          fill:   '#cc2200',
          color:  '#ffffff',
          width:  2
        });
      }
    }

    // Temporäre Icon-Datei aufräumen (nach dem Rendern)
    const cleanupTmpIcon = scaledIconPath ? () => {
      try { fs.unlinkSync(scaledIconPath); } catch (_) {}
    } : () => {};

    // ── Rendern: Expliziter Mittelpunkt + Zoomstufe ──────────────────────
    // Wichtig: render([minLng, minLat, maxLng, maxLat]) würde die Bounding Box
    // als einen von mehreren Extents behandeln und mit Polygon/Marker-Extents
    // kombinieren – der Rand hätte dann keine Wirkung.
    // Stattdessen: Mittelpunkt der gepaddeten BBox + fixedZoom explizit übergeben.
    // staticmaps setzt dann centerX/centerY direkt, ohne determineExtent() zu rufen.
    const centerLon = (paddedMinLng + paddedMaxLng) / 2;
    const centerLat = (paddedMinLat + paddedMaxLat) / 2;
    await map.render([centerLon, centerLat], fixedZoom);

    // ── PNG-Buffer + verlustfreie Komprimierung via sharp ────────────────────────
    const rawBuffer = await map.image.buffer('image/png');
    cleanupTmpIcon(); // Temporäre Icon-Datei löschen

    // Verlustfreie Komprimierung: sharp mit compressionLevel 9 (max) und adaptiveFiltering
    // Kein Qualitätsverlust, aber deutlich kleinere Datei (typisch 30–60% kleiner)
    const buffer = await sharp(rawBuffer)
      .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
      .toBuffer();

    const safeName = market.name
      .replace(/[^a-zA-Z0-9äöüÄÖÜß\-]/g, '_')
      .substring(0, 50);
    const filename = `Karte_${safeName}.png`;

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);

  } catch (err) {
    console.error('[Karten-Download] Fehler:', err);
    res.status(500).send('Fehler beim Generieren der Karte. Bitte versuche es erneut.');
  }
});

// ============================================
// Impressum
// ============================================

router.get('/impressum', (req, res) => {
  const settings = res.locals.settings;
  res.render('impressum', {
    title: 'Impressum',
    content: settings.impressum_html || ''
  });
});

// ============================================
// Datenschutzerklärung
// ============================================

router.get('/datenschutz', (req, res) => {
  const settings = res.locals.settings;
  res.render('datenschutz', {
    title: 'Datenschutzerklärung',
    content: settings.datenschutz_html || ''
  });
});

// ============================================
// Stand per Code bearbeiten (Nutzer)
// ============================================

/**
 * POST /markt/:id/stand-code
 * Prüft den eingegebenen Code und leitet zur Bearbeitungsseite weiter.
 */
router.post('/markt/:id/stand-code', (req, res) => {
  const marketId = parseInt(req.params.id);
  const { edit_code } = req.body;
  if (!edit_code || !edit_code.trim()) {
    req.session.errorMessage = 'Bitte einen Bearbeitungscode eingeben.';
    return res.redirect(`/markt/${marketId}`);
  }
  const stand = db.prepare(
    'SELECT * FROM stands WHERE market_id = ? AND UPPER(edit_code) = UPPER(?)'
  ).get(marketId, edit_code.trim());
  if (!stand) {
    req.session.errorMessage = 'Ungültiger Code. Bitte prüfen Sie Ihre Eingabe.';
    return res.redirect(`/markt/${marketId}`);
  }
  res.redirect(`/markt/${marketId}/stand-bearbeiten/${stand.id}?code=${encodeURIComponent(edit_code.trim())}`);
});

/**
 * GET /markt/:id/stand-bearbeiten/:standId
 * Zeigt das Bearbeitungsformular für einen Stand (mit Code-Prüfung).
 */
router.get('/markt/:id/stand-bearbeiten/:standId', (req, res) => {
  const marketId = parseInt(req.params.id);
  const standId  = parseInt(req.params.standId);
  const code     = req.query.code || '';
  const market   = db.prepare('SELECT * FROM markets WHERE id = ?').get(marketId);
  const stand    = db.prepare('SELECT * FROM stands WHERE id = ? AND market_id = ?').get(standId, marketId);
  if (!market || !stand || stand.edit_code.toUpperCase() !== code.toUpperCase()) {
    req.session.errorMessage = 'Ungültiger oder abgelaufener Link.';
    return res.redirect(market ? `/markt/${marketId}` : '/');
  }
  res.render('stand-bearbeiten', {
    title: 'Stand bearbeiten',
    market: { ...market, categoriesParsed: JSON.parse(market.categories || '[]') },
    stand:  { ...stand,  categoriesParsed: JSON.parse(stand.categories  || '[]') },
    code,
    // res.locals wurde bereits von der Flash-Middleware befüllt (und Session gelöscht)
    successMessage: res.locals.successMessage || null,
    errorMessage:   res.locals.errorMessage   || null
  });
});

/**
 * POST /markt/:id/stand-bearbeiten/:standId
 * Speichert die Änderungen am Stand (mit Code-Prüfung).
 */
router.post('/markt/:id/stand-bearbeiten/:standId', async (req, res) => {
  const marketId = parseInt(req.params.id);
  const standId  = parseInt(req.params.standId);
  const { code, name, directions, street, housenumber, zip } = req.body;
  let selectedCategories = req.body.categories || [];
  if (typeof selectedCategories === 'string') selectedCategories = [selectedCategories];

  const stand = db.prepare('SELECT * FROM stands WHERE id = ? AND market_id = ?').get(standId, marketId);
  if (!stand || stand.edit_code.toUpperCase() !== (code || '').toUpperCase()) {
    req.session.errorMessage = 'Ungültiger Code.';
    return res.redirect(`/markt/${marketId}`);
  }

  let newAddress = stand.address;
  let newLat = stand.latitude;
  let newLon = stand.longitude;

  if (street && housenumber && zip) {
    const fullAddress = `${street.trim()} ${housenumber.trim()}, ${zip.trim()}`;
    if (fullAddress !== stand.address) {
      let coords;
      try { coords = await geocodeAddress({ street: street.trim(), housenumber: housenumber.trim(), zip: zip.trim(), city: '' }); }
      catch (e) { coords = null; }
      if (!coords) {
        req.session.errorMessage = 'Die neue Adresse konnte nicht gefunden werden. Bitte prüfen Sie Ihre Eingabe.';
        return res.redirect(`/markt/${marketId}/stand-bearbeiten/${standId}?code=${encodeURIComponent(code)}`);
      }
      // Polygon-Prüfung: liegt die neue Adresse im Marktgebiet?
      const market = db.prepare('SELECT polygon FROM markets WHERE id = ?').get(marketId);
      const polygon = JSON.parse((market && market.polygon) || '[]');
      const isInside = polygon.length >= 3 ? pointInPolygon([coords.lat, coords.lon], polygon) : true;
      if (!isInside) {
        req.session.errorMessage = 'Die neue Adresse liegt nicht im Geltungsbereich dieses Hofflohmarktes.';
        return res.redirect(`/markt/${marketId}/stand-bearbeiten/${standId}?code=${encodeURIComponent(code)}`);
      }
      newAddress = fullAddress;
      newLat = coords.lat;
      newLon = coords.lon;
    }
  }

  db.prepare(`
    UPDATE stands SET name = ?, directions = ?, categories = ?, address = ?, latitude = ?, longitude = ? WHERE id = ?
  `).run((name || '').trim(), (directions || '').trim(), JSON.stringify(selectedCategories), newAddress, newLat, newLon, stand.id);

  if (!req.session.errorMessage) {
    req.session.successMessage = 'Ihr Stand wurde erfolgreich aktualisiert!';
    return res.redirect(`/markt/${marketId}`);
  }
  res.redirect(`/markt/${marketId}/stand-bearbeiten/${standId}?code=${encodeURIComponent(code)}`);
});

module.exports = router;
module.exports.geocodeAddress = geocodeAddress;
