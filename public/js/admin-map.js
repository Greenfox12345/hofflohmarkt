/**
 * admin-map.js – Leaflet-Karte mit Zeichenfunktion für den Admin-Bereich
 *
 * Ermöglicht dem Admin, ein Polygon auf der Karte zu zeichnen,
 * das den Geltungsbereich eines Hofflohmarktes definiert.
 * Verwendet die globalen Variablen: isEdit, existingPolygon
 * (werden im EJS-Template als <script>-Block gesetzt).
 */

(function () {
  'use strict';

  // Karte initialisieren (Standardansicht: Deutschland-Mitte)
  const map = L.map('admin-map').setView([51.1657, 10.4515], 6);

  // OpenStreetMap-Kacheln
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(map);

  // FeatureGroup für gezeichnete Elemente
  const drawnItems = new L.FeatureGroup();
  map.addLayer(drawnItems);

  // Leaflet Draw – nur Polygon-Werkzeug aktivieren
  const drawControl = new L.Control.Draw({
    edit: {
      featureGroup: drawnItems,
      remove: true
    },
    draw: {
      polygon: {
        allowIntersection: false,
        showArea: true,
        shapeOptions: {
          color: '#007bff',
          fillOpacity: 0.15
        }
      },
      polyline: false,
      rectangle: false,
      circle: false,
      marker: false,
      circlemarker: false
    }
  });
  map.addControl(drawControl);

  // Referenz auf das versteckte Formularfeld
  const polygonInput = document.getElementById('polygon');
  const statusText = document.getElementById('polygon-status');

  /**
   * Aktualisiert das versteckte Formularfeld mit den Polygon-Koordinaten.
   */
  function updatePolygonField() {
    const layers = drawnItems.getLayers();
    if (layers.length > 0) {
      // Letztes (bzw. einziges) Polygon verwenden
      const layer = layers[layers.length - 1];
      const latlngs = layer.getLatLngs()[0]; // Äußerer Ring
      const coords = latlngs.map(function (ll) {
        return [ll.lat, ll.lng];
      });
      polygonInput.value = JSON.stringify(coords);
      statusText.textContent = 'Polygon gesetzt (' + coords.length + ' Punkte). Sie können es bearbeiten oder löschen und neu zeichnen.';
      statusText.style.color = '#155724';
    } else {
      polygonInput.value = '';
      statusText.textContent = 'Bitte zeichnen Sie ein Polygon auf der Karte.';
      statusText.style.color = '#721c24';
    }
  }

  // ---- Event-Handler für Leaflet Draw ----

  // Neues Polygon gezeichnet
  map.on(L.Draw.Event.CREATED, function (event) {
    // Vorherige Polygone entfernen (nur ein Polygon erlaubt)
    drawnItems.clearLayers();
    drawnItems.addLayer(event.layer);
    updatePolygonField();
  });

  // Polygon bearbeitet
  map.on(L.Draw.Event.EDITED, function () {
    updatePolygonField();
  });

  // Polygon gelöscht
  map.on(L.Draw.Event.DELETED, function () {
    updatePolygonField();
  });

  // ---- Bestehendes Polygon laden (Bearbeitungsmodus) ----
  if (isEdit && existingPolygon && existingPolygon.length > 0) {
    const polygon = L.polygon(existingPolygon, {
      color: '#007bff',
      fillOpacity: 0.15
    });
    drawnItems.addLayer(polygon);
    map.fitBounds(polygon.getBounds(), { padding: [30, 30] });
    updatePolygonField();
  }

  // ---- Formular-Validierung: Polygon muss gesetzt sein ----
  const form = document.getElementById('market-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      if (!polygonInput.value || polygonInput.value === '[]') {
        e.preventDefault();
        alert('Bitte zeichnen Sie einen Geltungsbereich (Polygon) auf der Karte.');
        statusText.textContent = 'Polygon fehlt! Bitte zeichnen Sie einen Bereich.';
        statusText.style.color = '#721c24';
      }
    });
  }

})();
