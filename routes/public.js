/**
 * routes/public.js – Öffentliche Routen
 *
 * Enthält die Startseite, die Markt-Detailseite und die Standanmeldung.
 * Diese Routen sind ohne Login zugänglich.
 */

const express = require('express');
const router = express.Router();
const { db } = require('../database');

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
