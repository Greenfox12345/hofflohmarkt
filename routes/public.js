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
    // Für Duplikat-Hinweis: vorherige Formulardaten
    formData: req.session.formData || null,
    duplicateStands: req.session.duplicateStands || null
  });

  // Formulardaten und Duplikat-Info nach Anzeige löschen
  delete req.session.formData;
  delete req.session.duplicateStands;
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

  // ---- Stand speichern ----
  db.prepare(`
    INSERT INTO stands (market_id, address, latitude, longitude, categories, name, directions)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    marketId,
    fullAddress,
    coords.lat,
    coords.lon,
    JSON.stringify(selectedCategories),
    (name || '').trim(),
    (directions || '').trim()
  );

  req.session.successMessage = `Ihr Stand an der Adresse "${fullAddress}" wurde erfolgreich angemeldet!`;
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

    // 2 km Rand in Grad umrechnen
    // 1 Grad Breite ≈ 111 km; 1 Grad Länge ≈ 111 km * cos(lat)
    const PAD_KM = 2.5;
    const padLat = PAD_KM / 111;
    const padLng = PAD_KM / (111 * Math.cos(midLat * Math.PI / 180));

    const paddedMinLat = minLat - padLat;
    const paddedMaxLat = maxLat + padLat;
    const paddedMinLng = minLng - padLng;
    const paddedMaxLng = maxLng + padLng;

    // ── Bildgröße: proportional zur Bounding Box, Basisbreite 2800px ──────
    // Korrektur: Längengrade werden durch cos(lat) gestaucht
    const lngSpan = paddedMaxLng - paddedMinLng;
    const latSpan = paddedMaxLat - paddedMinLat;
    const aspectRatio = (lngSpan * Math.cos(midLat * Math.PI / 180)) / latSpan;
    const BASE_WIDTH = 2800;
    let imgWidth  = BASE_WIDTH;
    let imgHeight = Math.round(imgWidth / aspectRatio);
    // Sicherheitsgrenzen
    if (imgHeight > 4000) { imgHeight = 4000; imgWidth = Math.round(imgHeight * aspectRatio); }
    if (imgWidth  > 4000) { imgWidth  = 4000; imgHeight = Math.round(imgWidth  / aspectRatio); }
    // Mindestgröße
    if (imgWidth  < 400)  imgWidth  = 400;
    if (imgHeight < 400)  imgHeight = 400;

    // ── Zoom-Strategie ────────────────────────────────────────────────────
    // Polygon-Ausdehnung in km berechnen (Diagonale der Bounding Box)
    const polyWidthKm  = (maxLng - minLng) * 111 * Math.cos(midLat * Math.PI / 180);
    const polyHeightKm = (maxLat - minLat) * 111;
    const polyDiagKm   = Math.sqrt(polyWidthKm * polyWidthKm + polyHeightKm * polyHeightKm);

    // Gesamtfläche inkl. Rand: wenn das Polygon klein ist, erzwingen wir Zoom 17
    // Faustregel: bei Zoom 17 passt ein Bereich von ca. 0,5 km in 256px
    // → Gesamtbreite (Polygon + 2×Rand) in km bestimmt den Mindest-Zoom
    const totalWidthKm = polyWidthKm + 2 * PAD_KM;
    // Zoom 17: ~0,6 km sichtbar bei 256px → bei 2800px ~6,6 km
    // Zoom 16: ~1,2 km bei 256px → ~13 km bei 2800px
    // Zoom 15: ~2,4 km bei 256px → ~26 km bei 2800px
    let minZoom;
    if (totalWidthKm <= 7)  minZoom = 17;
    else if (totalWidthKm <= 14) minZoom = 16;
    else if (totalWidthKm <= 28) minZoom = 15;
    else minZoom = 14;

    // staticmaps-Instanz
    const map = new StaticMaps({
      width:  imgWidth,
      height: imgHeight,
      tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      tileSubdomains: ['a', 'b', 'c'],
      tileSize: 256,
      zoomRange: { min: minZoom, max: 17 }
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
    // Marker-Icon: marktspezifisches Bild wenn vorhanden, sonst Standard-Pin
    let markerIconPath = null;
    if (market.marker_icon) {
      const candidate = path.join(__dirname, '..', 'uploads', market.marker_icon);
      if (fs.existsSync(candidate)) markerIconPath = candidate;
    }

    for (const stand of stands) {
      if (!stand.latitude || !stand.longitude) continue;
      if (markerIconPath) {
        // Icon-Größe: 32×32px, Ankerpunkt unten-mitte
        map.addMarker({
          coord:   [stand.longitude, stand.latitude],
          img:     markerIconPath,
          height:  32,
          width:   32,
          offsetX: 16,
          offsetY: 32
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

    // ── Rendern: Bounding Box als center-Array übergeben ──────────────────
    // staticmaps akzeptiert [minLng, minLat, maxLng, maxLat] als center-Extent
    await map.render([paddedMinLng, paddedMinLat, paddedMaxLng, paddedMaxLat]);

    // ── Als PNG-Buffer ausgeben ────────────────────────────────────────────
    const buffer = await map.image.buffer('image/png');

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

module.exports = router;
