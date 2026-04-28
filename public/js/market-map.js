/**
 * market-map.js – Leaflet-Karte für die Markt-Detailseite
 *
 * Zeigt das Polygon des Geltungsbereichs und alle angemeldeten Stände als Marker.
 * Verwendet die globalen Variablen: polygonCoords, stands, markerIconUrl
 * (werden im EJS-Template als <script>-Block gesetzt).
 */

(function () {
  'use strict';

  // Karte initialisieren
  const map = L.map('map', {
    scrollWheelZoom: true
  });

  // OpenStreetMap-Kacheln laden
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(map);

  // ---- Polygon anzeigen ----
  if (polygonCoords && polygonCoords.length > 0) {
    const polygon = L.polygon(polygonCoords, {
      color: '#007bff',
      fillColor: '#007bff',
      fillOpacity: 0.1,
      weight: 2
    }).addTo(map);

    // Karte auf das Polygon zentrieren
    map.fitBounds(polygon.getBounds(), { padding: [30, 30] });
  } else {
    // Fallback: Deutschland-Mitte
    map.setView([51.1657, 10.4515], 6);
  }

  // ---- Benutzerdefiniertes Marker-Icon ----
  let customIcon = null;
  if (markerIconUrl) {
    customIcon = L.icon({
      iconUrl: markerIconUrl,
      iconSize: [32, 40],       // Breite x Höhe des Icons
      iconAnchor: [16, 40],     // Ankerpunkt: untere Mitte
      popupAnchor: [0, -40]     // Popup-Position relativ zum Anker
    });
  }

  // ---- Stände als Marker anzeigen ----
  stands.forEach(function (stand) {
    const markerOptions = {};
    if (customIcon) {
      markerOptions.icon = customIcon;
    }

    const marker = L.marker([stand.lat, stand.lng], markerOptions).addTo(map);

    // Popup-Inhalt zusammenbauen
    let popupContent = '<div class="stand-popup">';
    popupContent += '<strong>' + escapeHtml(stand.address) + '</strong>';

    if (stand.name) {
      popupContent += '<br><em>' + escapeHtml(stand.name) + '</em>';
    }

    if (stand.directions) {
      popupContent += '<br><small>Wegbeschreibung: ' + escapeHtml(stand.directions) + '</small>';
    }

    if (stand.categories && stand.categories.length > 0) {
      popupContent += '<br><small>Angebot: ' + stand.categories.map(escapeHtml).join(', ') + '</small>';
    }

    popupContent += '</div>';
    marker.bindPopup(popupContent);
  });

  /**
   * Einfache HTML-Escape-Funktion zum Schutz vor XSS in Popups.
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

})();
