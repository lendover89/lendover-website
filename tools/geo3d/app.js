(function () {
  const DEFAULT_VIEW = {
    center: [34.7818, 32.0853],
    zoom: 15.2,
    pitch: 66,
    bearing: -20
  };

  const statusLine = document.getElementById('statusLine');
  const searchForm = document.getElementById('searchForm');
  const searchInput = document.getElementById('searchInput');
  const resetView = document.getElementById('resetView');
  const toggles = document.querySelectorAll('[data-layer-toggle]');

  let terrainEnabled = true;
  let buildingsEnabled = true;
  let statusTimer = 0;

  function showStatus(text, sticky) {
    statusLine.textContent = text;
    statusLine.classList.add('is-visible');
    window.clearTimeout(statusTimer);
    if (!sticky) {
      statusTimer = window.setTimeout(() => {
        statusLine.classList.remove('is-visible');
      }, 2600);
    }
  }

  if (!window.maplibregl || !maplibregl.Map) {
    showStatus('הדפדפן לא תומך ב־WebGL', true);
    return;
  }

  const map = new maplibregl.Map({
    container: 'map',
    center: DEFAULT_VIEW.center,
    zoom: DEFAULT_VIEW.zoom,
    pitch: DEFAULT_VIEW.pitch,
    bearing: DEFAULT_VIEW.bearing,
    antialias: true,
    hash: true,
    maxPitch: 85,
    style: {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        satellite: {
          type: 'raster',
          tileSize: 256,
          attribution: 'Tiles © Esri',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          ]
        },
        terrainSource: {
          type: 'raster-dem',
          tileSize: 256,
          maxzoom: 15,
          encoding: 'terrarium',
          attribution: 'Elevation tiles © AWS Open Data',
          tiles: [
            'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
          ]
        },
        openfreemap: {
          type: 'vector',
          attribution: 'Vector tiles © OpenFreeMap © OpenStreetMap contributors',
          url: 'https://tiles.openfreemap.org/planet'
        }
      },
      layers: [
        {
          id: 'satellite',
          type: 'raster',
          source: 'satellite',
          paint: {
            'raster-saturation': -0.04,
            'raster-contrast': 0.08,
            'raster-brightness-min': 0.02
          }
        }
      ]
    }
  });
  window.__geo3dMap = map;

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

  map.on('load', () => {
    map.setTerrain({ source: 'terrainSource', exaggeration: 1.28 });

    map.addLayer({
      id: 'hillshade',
      type: 'hillshade',
      source: 'terrainSource',
      paint: {
        'hillshade-exaggeration': 0.2,
        'hillshade-shadow-color': 'rgba(20, 22, 24, 0.32)',
        'hillshade-highlight-color': 'rgba(255, 255, 255, 0.18)'
      }
    });

    map.addLayer({
      id: 'buildings-3d',
      type: 'fill-extrusion',
      source: 'openfreemap',
      'source-layer': 'building',
      minzoom: 14,
      paint: {
        'fill-extrusion-color': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14, '#c4b6a3',
          17, '#f0d7bd'
        ],
        'fill-extrusion-height': 18,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.82,
        'fill-extrusion-vertical-gradient': true
      }
    });

    showStatus('מוכן');
  });

  map.on('error', (event) => {
    const message = event && event.error ? event.error.message : '';
    if (message) {
      showStatus('שכבה חיצונית לא נטענה במלואה');
    }
  });

  resetView.addEventListener('click', () => {
    map.flyTo({
      center: DEFAULT_VIEW.center,
      zoom: DEFAULT_VIEW.zoom,
      pitch: DEFAULT_VIEW.pitch,
      bearing: DEFAULT_VIEW.bearing,
      duration: 950,
      essential: true
    });
  });

  toggles.forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.layerToggle;
      const isOn = button.classList.toggle('is-on');
      button.setAttribute('aria-pressed', String(isOn));

      if (target === 'terrain') {
        terrainEnabled = isOn;
        map.setTerrain(terrainEnabled ? { source: 'terrainSource', exaggeration: 1.28 } : null);
        if (map.getLayer('hillshade')) {
          map.setLayoutProperty('hillshade', 'visibility', terrainEnabled ? 'visible' : 'none');
        }
      }

      if (target === 'buildings') {
        buildingsEnabled = isOn;
        if (map.getLayer('buildings-3d')) {
          map.setLayoutProperty('buildings-3d', 'visibility', buildingsEnabled ? 'visible' : 'none');
        }
      }
    });
  });

  searchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = searchInput.value.trim();
    if (!query) return;

    showStatus('מחפש', true);
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      limit: '1',
      countrycodes: 'il',
      'accept-language': 'he'
    });

    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('search failed');
      const results = await response.json();
      if (!results.length) {
        showStatus('לא נמצאה תוצאה');
        return;
      }

      const result = results[0];
      map.flyTo({
        center: [Number(result.lon), Number(result.lat)],
        zoom: 16.4,
        pitch: 68,
        bearing: -18,
        duration: 1200,
        essential: true
      });
      showStatus(result.display_name.split(',').slice(0, 3).join(', '));
    } catch (error) {
      showStatus('החיפוש לא זמין כרגע');
    }
  });
})();
