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

  const RTL_PLUGIN_URL = 'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.js';
  const TERRAIN_SAFE_MAX_ZOOM = 15.5;
  const HIGH_ZOOM_RASTER_CUTOFF = 16;
  const LABEL_LAYER_IDS = ['ofm-place-labels', 'ofm-road-labels'];
  const SATELLITE_LAYER_ID = 'satellite';
  const HIGH_ZOOM_FALLBACK_LAYER_ID = 'osm-highzoom-fallback';

  let terrainEnabled = true;
  let labelsEnabled = false;
  let buildingsEnabled = true;
  let terrainSuspendedForZoom = false;
  let rasterSuspendedForZoom = false;
  let statusTimer = 0;

  const buildingBaseExpression = [
    'coalesce',
    ['to-number', ['get', 'base_height_final']],
    ['to-number', ['get', 'render_min_height']],
    ['to-number', ['get', 'min_height']],
    ['to-number', ['get', 'building:min_height']],
    ['*', ['to-number', ['get', 'min_level']], 3],
    ['*', ['to-number', ['get', 'building:min_level']], 3],
    0
  ];

  const buildingHeightExpression = [
    'coalesce',
    ['to-number', ['get', 'height_final']],
    ['to-number', ['get', 'height_current_model']],
    ['to-number', ['get', 'height_lgis']],
    ['to-number', ['get', 'render_height']],
    ['to-number', ['get', 'height']],
    ['to-number', ['get', 'building:height']],
    ['*', ['to-number', ['get', 'render_levels']], 3],
    ['*', ['to-number', ['get', 'levels']], 3],
    ['*', ['to-number', ['get', 'building:levels']], 3],
    15
  ];

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

  if (typeof maplibregl.setRTLTextPlugin === 'function') {
    try {
      maplibregl.setRTLTextPlugin(
        RTL_PLUGIN_URL,
        (error) => {
          if (error) {
            console.warn('Geo3D RTL plugin failed to load', error);
          }
        },
        true
      );
    } catch (error) {
      console.warn('Geo3D RTL plugin setup failed', error);
    }
  }

  const map = new maplibregl.Map({
    container: 'map',
    center: DEFAULT_VIEW.center,
    zoom: DEFAULT_VIEW.zoom,
    pitch: DEFAULT_VIEW.pitch,
    bearing: DEFAULT_VIEW.bearing,
    antialias: true,
    attributionControl: false,
    hash: true,
    maxPitch: 85,
    style: {
      version: 8,
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
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
          minzoom: 6,
          maxzoom: 13,
          encoding: 'terrarium',
          attribution: 'טופוגרפיה: LGIS, DEM מקווי גובה ingest.heights',
          bounds: [34.244, 29.486, 35.898, 33.330],
          tiles: [
            'https://auth.lendover.co.il/geo3d-terrain/{z}/{x}/{y}.png?v=2'
          ]
        },
        hybridBuildings: {
          type: 'vector',
          attribution: 'מבנים תלת־ממדיים: LGIS + OSM/Geofabrik',
          url: 'https://auth.lendover.co.il/tiles/prod.buildings_3d_hybrid_il_candidate'
        },
        openFreeMapLabels: {
          type: 'vector',
          attribution: 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap',
          url: 'https://tiles.openfreemap.org/planet'
        }
      },
      layers: [
        {
          id: 'background',
          type: 'background',
          paint: {
            'background-color': '#11161a'
          }
        },
        {
          id: 'satellite',
          type: 'raster',
          source: 'satellite',
          maxzoom: HIGH_ZOOM_RASTER_CUTOFF,
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
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

  function setTerrainActive(active) {
    map.setTerrain(active ? { source: 'terrainSource', exaggeration: 1.5 } : null);
    if (map.getLayer('hillshade')) {
      map.setLayoutProperty('hillshade', 'visibility', active ? 'visible' : 'none');
    }
  }

  function syncZoomSafeguards(notify) {
    const shouldSuspend = terrainEnabled && map.getZoom() > TERRAIN_SAFE_MAX_ZOOM;
    const shouldSuspendRaster = map.getZoom() >= HIGH_ZOOM_RASTER_CUTOFF;
    const terrainChanged = shouldSuspend !== terrainSuspendedForZoom;
    const rasterChanged = shouldSuspendRaster !== rasterSuspendedForZoom;

    terrainSuspendedForZoom = shouldSuspend;
    rasterSuspendedForZoom = shouldSuspendRaster;
    setTerrainActive(terrainEnabled && !terrainSuspendedForZoom);
    setLayerVisibility(SATELLITE_LAYER_ID, !rasterSuspendedForZoom);
    setLayerVisibility(HIGH_ZOOM_FALLBACK_LAYER_ID, rasterSuspendedForZoom);

    if (!notify || (!terrainChanged && !rasterChanged)) {
      return;
    }

    if (rasterSuspendedForZoom) {
      showStatus('בזום גבוה עברנו לרקע מפה נקי כדי למנוע ריבועי tiles אפורים');
      return;
    }

    if (terrainSuspendedForZoom) {
      showStatus('הטופוגרפיה הוסתרה בזום גבוה כדי למנוע ארטיפקטים');
      return;
    }

    showStatus('הרקע והטופוגרפיה חזרו עם היציאה מהזום הגבוה');
  }

  function setLayerVisibility(layerId, isVisible) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none');
    }
  }

  function updateLabelsVisibility() {
    LABEL_LAYER_IDS.forEach((layerId) => setLayerVisibility(layerId, labelsEnabled));
  }

  map.on('load', () => {
    setTerrainActive(true);

    map.addSource('osmHighZoom', {
      type: 'raster',
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
      tiles: [
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
      ]
    });

    map.addLayer({
      id: HIGH_ZOOM_FALLBACK_LAYER_ID,
      type: 'raster',
      source: 'osmHighZoom',
      layout: {
        visibility: 'none'
      },
      minzoom: HIGH_ZOOM_RASTER_CUTOFF,
      paint: {
        'raster-opacity': 0.98,
        'raster-saturation': -0.18,
        'raster-contrast': 0.03
      }
    });

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
      source: 'hybridBuildings',
      'source-layer': 'prod.buildings_3d_hybrid_il_candidate',
      minzoom: 14,
      paint: {
        'fill-extrusion-color': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14, '#d9cbb7',
          16, '#d2bea3',
          18, '#c7ae90'
        ],
        'fill-extrusion-height': buildingHeightExpression,
        'fill-extrusion-base': buildingBaseExpression,
        'fill-extrusion-opacity': 0.86,
        'fill-extrusion-vertical-gradient': true
      }
    });

    map.addLayer({
      id: 'ofm-place-labels',
      type: 'symbol',
      source: 'openFreeMapLabels',
      'source-layer': 'place',
      minzoom: 8,
      layout: {
        visibility: 'none',
        'text-field': ['coalesce', ['get', 'name:he'], ['get', 'name_he'], ['get', 'name'], ['get', 'name_en']],
        'text-font': ['Noto Sans Bold'],
        'text-size': [
          'interpolate',
          ['exponential', 1.15],
          ['zoom'],
          8, 10,
          12, 13,
          16, 18
        ],
        'text-max-width': 8,
        'text-anchor': 'center',
        'text-allow-overlap': false,
        'text-justify': 'center'
      },
      filter: ['match', ['get', 'class'], ['city', 'town', 'village', 'suburb', 'neighbourhood', 'hamlet'], true, false],
      paint: {
        'text-color': '#f9f4ea',
        'text-halo-color': 'rgba(17, 21, 24, 0.92)',
        'text-halo-width': 1.7,
        'text-halo-blur': 0.4
      }
    });

    map.addLayer({
      id: 'ofm-road-labels',
      type: 'symbol',
      source: 'openFreeMapLabels',
      'source-layer': 'transportation_name',
      minzoom: 13,
      layout: {
        visibility: 'none',
        'symbol-placement': 'line',
        'text-field': ['coalesce', ['get', 'name:he'], ['get', 'name_he'], ['get', 'name'], ['get', 'name_en']],
        'text-font': ['Noto Sans Regular'],
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          13, 11,
          16, 13,
          18, 14
        ],
        'text-letter-spacing': 0.02,
        'text-rotation-alignment': 'map',
        'text-keep-upright': true,
        'text-max-angle': 35
      },
      filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'street'], true, false],
      paint: {
        'text-color': '#fffdf8',
        'text-halo-color': 'rgba(20, 24, 27, 0.94)',
        'text-halo-width': 1.5,
        'text-halo-blur': 0.35
      }
    });

    syncZoomSafeguards(false);
    updateLabelsVisibility();

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
        syncZoomSafeguards(true);
      }

      if (target === 'buildings') {
        buildingsEnabled = isOn;
        setLayerVisibility('buildings-3d', buildingsEnabled);
      }

      if (target === 'labels') {
        labelsEnabled = isOn;
        updateLabelsVisibility();
        showStatus(labelsEnabled ? 'שמות רחובות ויישובים הוצגו' : 'שמות רחובות ויישובים הוסתרו');
      }
    });
  });

  map.on('zoomend', () => {
    syncZoomSafeguards(true);
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
