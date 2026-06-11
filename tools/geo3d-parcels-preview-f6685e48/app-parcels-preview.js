(function () {
  'use strict';

  const GEO3D_USAGE_URL = /(^|\.)isramap\.co\.il$/i.test(window.location.hostname)
    ? window.location.origin + '/auth/usage'
    : 'https://auth.lendover.co.il/usage';

  function postGeo3DUsage(action) {
    if (typeof fetch !== 'function') return;
    try {
      fetch(GEO3D_USAGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        keepalive: true,
        body: JSON.stringify({ tool: 'geo3d', action: action || 'open' })
      }).catch(() => {});
    } catch (error) {}
  }

  function hasPreviewToken() {
    if (!window.GEO3D_PREVIEW_TOKEN) return true;
    const key = 'geo3d-preview-token';
    const params = new URLSearchParams(window.location.search || '');
    const token = params.get('preview');
    if (token === window.GEO3D_PREVIEW_TOKEN) {
      try { window.localStorage.setItem(key, token); } catch (error) {}
      return true;
    }
    try {
      return window.localStorage.getItem(key) === window.GEO3D_PREVIEW_TOKEN;
    } catch (error) {
      return false;
    }
  }

  async function hasValidSession() {
    if (!hasPreviewToken()) return false;
    // LOCAL DEV BYPASS: skip auth gate when running on localhost
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)) {
      return true;
    }
    if (typeof fetch !== 'function') return false;
    try {
      const validateUrl = /(^|\.)isramap\.co\.il$/i.test(window.location.hostname)
        ? window.location.origin + '/auth/validate'
        : 'https://auth.lendover.co.il/validate';
      const response = await fetch(validateUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (!response.ok) return false;
      const data = await response.json().catch(() => ({}));
      if (window.GEO3D_PREVIEW_OWNER_NAME && data.name !== window.GEO3D_PREVIEW_OWNER_NAME) {
        return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  function setAuthStatus(text) {
    const statusLine = document.getElementById('statusLine');
    if (statusLine) {
      statusLine.textContent = text;
      statusLine.classList.add('is-visible');
    }
  }

  async function startAfterAuth(startApp) {
    async function startAuthenticatedApp() {
      if (!hasPreviewToken()) {
        document.body.classList.add('auth-required');
        setAuthStatus('קישור הבדיקה אינו תקין');
        return;
      }
      document.body.classList.remove('auth-required');
      setAuthStatus('טוען מפה');
      postGeo3DUsage('open');
      startApp();
    }

    if (await hasValidSession()) {
      await startAuthenticatedApp();
      return;
    }

    document.body.classList.add('auth-required');
    setAuthStatus('נדרשת התחברות כדי להשתמש ב־Geo3D');

    if (typeof window.showAuthModal === 'function') {
      window.showAuthModal(async () => {
        if (await hasValidSession()) {
          startAuthenticatedApp();
          return;
        }
        setAuthStatus('הבדיקה זמינה רק למשתמש שאושר');
      });
      return;
    }

    setAuthStatus('מערכת ההתחברות לא נטענה. רענן את הדף ונסה שוב.');
  }

  function startGeo3D() {
      // LOCAL DEV: route tiles through the same-origin proxy to dodge CORS.
      // On the real site this stays the production auth.lendover.co.il host.
      // absolute origin so the maplibre web-worker resolves vector-tile URLs
      // correctly (relative URLs resolve against the blob: worker origin → fail)
      const TILE_BASE = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)
        ? window.location.origin + '/proxy'
        : /(^|\.)isramap\.co\.il$/i.test(window.location.hostname)
          ? window.location.origin           // isramap: tiles/api served same-origin
          : 'https://auth.lendover.co.il';
      // ArcGIS Location Platform API key (public, referrer-restricted to lendover.co.il /
      // isramap.co.il / localhost; Basemaps privilege only; pay-as-you-go disabled).
      // Licenses the Esri World Imagery basemap. Rotate in the ArcGIS portal if leaked.
      const ARCGIS_KEY = 'AAPTa36ZnjZfYAiIq6TGWC72wKw..vtJYTLO8WdGxk4qEkn1f4lvcGbb4jpUm4PBzCFibOxTFuzThn6Vm_8LvyhYtpCTqdlZ0jIJMy8IXa7ECnvKfkzwnzYjGiC_qTuI7Gg8j1fvx3Zizp7_BA2lemWTRAM0G1PWH8rDSMV6CPcXdyV-krBEtqthDGqv-dKZrSLJ4_DTGimFNxiEOEPnHs2sqyylfSQG7VdFlki_crywS35LlthD1SqzyQ86o63TFWgzwc05bkBsdxaa3l3hrRg..AT1_btIu7J2u';
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
      const LABEL_LAYER_IDS = ['ofm-neighborhood-labels', 'ofm-road-labels', 'ofm-settlement-labels', 'ofm-housenumbers'];
      const PARCEL_SOURCE_ID = 'parcelOwnership';
      const PARCEL_SOURCE_LAYER = 'prod.geo3d_parcel_ownership_lite';
      const PARCEL_HIT_LAYER_ID = 'parcel-hit';
      const PARCEL_BOUNDARY_LAYER_ID = 'parcel-boundaries';
      const PARCEL_OWNERSHIP_LAYER_ID = 'parcel-ownership-fill';
      const PARCEL_LABEL_LAYER_ID = 'parcel-numbers';
      const PARCEL_HIGHLIGHT_SOURCE_ID = 'parcelHighlight';
      const PARCEL_LAYER_IDS = [PARCEL_BOUNDARY_LAYER_ID, PARCEL_LABEL_LAYER_ID];
      const OWNERSHIP_LAYER_IDS = [PARCEL_OWNERSHIP_LAYER_ID];

      let terrainEnabled = true;
      let labelsEnabled = true;
      let buildingsEnabled = true;
      let parcelsEnabled = false;
      let ownershipEnabled = false;
      let basemap = 'satellite'; // 'satellite' | 'osm'
      let statusTimer = 0;
      let parcelPopup = null;

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

      function escapeHtml(value) {
        return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }

      function formatCount(value) {
        const n = Number(value || 0);
        return n ? n.toLocaleString('he') : '0';
      }

      function parcelInfoHtml(props) {
        const ownershipType = props.ownership_type || 'לא ידוע';
        const rows = [
          ['גוש', props.gush || ''],
          ['חלקה', props.parcel || ''],
          ['סוג בעלות', ownershipType],
          ['כמות בעלים/רשומות בעלות', formatCount(props.owners_count)]
        ];
        if (ownershipType === 'מעורב') {
          rows.push(['בעלות פרטית', formatCount(props.private_count)]);
          rows.push(['בעלות מדינה', formatCount(props.state_count)]);
        }
        return '<div class="parcel-popup-card"><div class="parcel-popup-title">פרטי חלקה</div>' +
          '<table>' + rows.map((row) => '<tr><th>' + escapeHtml(row[0]) +
            '</th><td>' + escapeHtml(row[1]) + '</td></tr>').join('') + '</table></div>';
      }

      function setParcelHighlight(features) {
        const src = map.getSource(PARCEL_HIGHLIGHT_SOURCE_ID);
        if (!src) return;
        src.setData({ type: 'FeatureCollection', features: features || [] });
      }

      function identifyParcelAt(e) {
        if (!map.getLayer(PARCEL_HIT_LAYER_ID)) return false;
        const p = e.point;
        const box = [[p.x - 5, p.y - 5], [p.x + 5, p.y + 5]];
        const features = map.queryRenderedFeatures(box, { layers: [PARCEL_HIT_LAYER_ID] });
        if (!features.length) return false;
        const picked = features[0];
        const props = picked.properties || {};
        const key = String(props.gush || '') + '/' + String(props.parcel || '');
        const parts = map.queryRenderedFeatures({ layers: [PARCEL_HIT_LAYER_ID] })
          .filter((feature) => {
            const fp = feature.properties || {};
            return String(fp.gush || '') + '/' + String(fp.parcel || '') === key;
          })
          .filter((feature) => feature.geometry);
        const highlight = parts.map((feature) => ({ type: 'Feature', properties: {}, geometry: feature.geometry }));
        setParcelHighlight(highlight);
        if (parcelPopup) parcelPopup.remove();
        parcelPopup = new maplibregl.Popup({
          closeButton: true,
          closeOnClick: true,
          className: 'parcel-popup'
        })
          .setLngLat(e.lngLat)
          .setHTML(parcelInfoHtml(props))
          .addTo(map);
        parcelPopup.on('close', () => setParcelHighlight(null));
        postGeo3DUsage('parcel_identify');
        return true;
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
              maxzoom: 19,
              attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
              tiles: [
                'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=' + ARCGIS_KEY
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
                TILE_BASE + '/geo3d-terrain/{z}/{x}/{y}.png?v=2'
              ]
            },
            hybridBuildings: {
              type: 'vector',
              attribution: 'מבנים תלת־ממדיים: LGIS + OSM/Geofabrik',
              minzoom: 0,
              // data only goes to z15; overzoom z15 tiles for higher view zooms
              maxzoom: 15,
              tiles: [
                TILE_BASE + '/tiles/prod.buildings_3d_hybrid_il_candidate/{z}/{x}/{y}?v=20260528-zoom-qc'
              ]
            },
            parcelOwnership: {
              type: 'vector',
              attribution: 'חלקות ובעלות: ingest.parcels + TabuCount',
              minzoom: 0,
              maxzoom: 15,
              tiles: [
                TILE_BASE + '/tiles/prod.geo3d_parcel_ownership_lite/{z}/{x}/{y}?v=20260611-preview'
              ]
            },
            osm: {
              type: 'raster',
              tileSize: 256,
              maxzoom: 19,
              attribution: '© OpenStreetMap contributors',
              tiles: [
                'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
                'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
                'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
              ]
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
              paint: {
                'raster-saturation': -0.04,
                'raster-contrast': 0.08,
                'raster-brightness-min': 0.02
              }
            },
            {
              id: 'osm',
              type: 'raster',
              source: 'osm',
              layout: { visibility: 'none' },
              paint: {}
            }
          ]
        }
      });
      window.__geo3dMap = map;

      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
      map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

      function setTerrainActive(active) {
        map.setTerrain(active ? { source: 'terrainSource', exaggeration: 1.5 } : null);
        if (map.getLayer('hillshade')) {
          map.setLayoutProperty('hillshade', 'visibility', active ? 'visible' : 'none');
        }
      }

      function syncTerrainState() {
        setTerrainActive(terrainEnabled);
      }

      function setLayerVisibility(layerId, isVisible) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none');
        }
      }

      function setLayerGroupVisibility(layerIds, isVisible) {
        layerIds.forEach((layerId) => setLayerVisibility(layerId, isVisible));
      }

      function ownershipColorExpression() {
        return [
          'match',
          ['to-string', ['get', 'ownership_type']],
          'פרטית', 'rgba(23, 181, 150, 0.42)',
          'מדינה', 'rgba(62, 78, 220, 0.42)',
          'רשות מקומית', 'rgba(214, 171, 55, 0.42)',
          'מעורב', 'rgba(218, 55, 145, 0.46)',
          'אחר', 'rgba(118, 126, 138, 0.36)',
          'לא ידוע', 'rgba(84, 91, 103, 0.24)',
          'rgba(84, 91, 103, 0.24)'
        ];
      }

      function updateLabelsVisibility() {
        // OSM basemap already has baked-in street/place names — hide the app's
        // own vector labels there to avoid duplicates.
        const showLabels = labelsEnabled && basemap !== 'osm';
        LABEL_LAYER_IDS.forEach((layerId) => setLayerVisibility(layerId, showLabels));
      }

      function setBasemap(name) {
        basemap = name;
        setLayerVisibility('satellite', name === 'satellite');
        setLayerVisibility('osm', name === 'osm');
        updateLabelsVisibility();
      }

      map.on('load', () => {
        setTerrainActive(true);

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

        map.addSource(PARCEL_HIGHLIGHT_SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });

        map.addLayer({
          id: PARCEL_OWNERSHIP_LAYER_ID,
          type: 'fill',
          source: PARCEL_SOURCE_ID,
          'source-layer': PARCEL_SOURCE_LAYER,
          minzoom: 13,
          layout: { visibility: 'none' },
          paint: {
            'fill-color': ownershipColorExpression(),
            'fill-opacity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13, 0.2,
              16, 0.38,
              18, 0.48
            ],
            'fill-outline-color': 'rgba(255, 255, 255, 0)'
          }
        });

        map.addLayer({
          id: PARCEL_HIT_LAYER_ID,
          type: 'fill',
          source: PARCEL_SOURCE_ID,
          'source-layer': PARCEL_SOURCE_LAYER,
          minzoom: 13,
          paint: {
            'fill-color': '#000000',
            'fill-opacity': 0.01
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
          id: 'parcel-highlight-fill',
          type: 'fill',
          source: PARCEL_HIGHLIGHT_SOURCE_ID,
          paint: {
            'fill-color': 'rgba(255, 255, 255, 0.18)',
            'fill-opacity': 0.35
          }
        });

        map.addLayer({
          id: 'parcel-highlight-line',
          type: 'line',
          source: PARCEL_HIGHLIGHT_SOURCE_ID,
          paint: {
            'line-color': '#ffffff',
            'line-width': 4.2,
            'line-opacity': 0.88,
            'line-blur': 0.4
          }
        });

        map.addLayer({
          id: PARCEL_BOUNDARY_LAYER_ID,
          type: 'line',
          source: PARCEL_SOURCE_ID,
          'source-layer': PARCEL_SOURCE_LAYER,
          minzoom: 14,
          layout: { visibility: 'none' },
          paint: {
            'line-color': [
              'interpolate',
              ['linear'],
              ['zoom'],
              14, '#9f7aea',
              17, '#c084fc',
              19, '#d8b4fe'
            ],
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              14, 0.7,
              17, 1.25,
              19, 1.9
            ],
            'line-opacity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              14, 0.72,
              17, 0.92
            ]
          }
        });

        map.addLayer({
          id: PARCEL_LABEL_LAYER_ID,
          type: 'symbol',
          source: PARCEL_SOURCE_ID,
          'source-layer': PARCEL_SOURCE_LAYER,
          minzoom: 17,
          layout: {
            visibility: 'none',
            'text-field': ['get', 'parcel'],
            'text-font': ['Noto Sans Bold'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 17, 11, 19, 15],
            'text-allow-overlap': false,
            'text-padding': 3
          },
          paint: {
            'text-color': '#fff7ff',
            'text-halo-color': 'rgba(36, 13, 54, 0.95)',
            'text-halo-width': 1.7,
            'text-halo-blur': 0.25
          }
        });

        map.addLayer({
          id: 'ofm-neighborhood-labels',
          type: 'symbol',
          source: 'openFreeMapLabels',
          'source-layer': 'place',
          minzoom: 12,
          maxzoom: 16.4,
          layout: {
            visibility: 'visible',
            'text-field': ['coalesce', ['get', 'name:he'], ['get', 'name_he'], ['get', 'name'], ['get', 'name_en']],
            'text-font': ['Noto Sans Regular'],
            'text-size': [
              'interpolate',
              ['linear'],
              ['zoom'],
              12, 10,
              15, 12.5,
              16, 11.5
            ],
            'text-max-width': 7,
            'text-anchor': 'center',
            'text-allow-overlap': false,
            'text-justify': 'center'
          },
          filter: ['match', ['get', 'class'], ['suburb', 'neighbourhood'], true, false],
          paint: {
            'text-color': 'rgba(238, 232, 221, 0.72)',
            'text-halo-color': 'rgba(17, 21, 24, 0.82)',
            'text-halo-width': 1.2,
            'text-halo-blur': 0.35
          }
        });

        map.addLayer({
          id: 'ofm-road-labels',
          type: 'symbol',
          source: 'openFreeMapLabels',
          'source-layer': 'transportation_name',
          minzoom: 13,
          layout: {
            visibility: 'visible',
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

        map.addLayer({
          id: 'ofm-settlement-labels',
          type: 'symbol',
          source: 'openFreeMapLabels',
          'source-layer': 'place',
          minzoom: 7,
          layout: {
            visibility: 'visible',
            'text-field': ['coalesce', ['get', 'name:he'], ['get', 'name_he'], ['get', 'name'], ['get', 'name_en']],
            'text-font': ['Noto Sans Bold'],
            'text-size': [
              'interpolate',
              ['exponential', 1.12],
              ['zoom'],
              7, 12,
              11, 15,
              15, 22,
              18, 26
            ],
            'text-max-width': 9,
            'text-anchor': 'center',
            'text-allow-overlap': false,
            'text-justify': 'center'
          },
          filter: ['match', ['get', 'class'], ['city', 'town', 'village', 'hamlet'], true, false],
          paint: {
            'text-color': '#fff8e8',
            'text-halo-color': 'rgba(12, 15, 18, 0.96)',
            'text-halo-width': 2.5,
            'text-halo-blur': 0.45
          }
        });

        // house numbers on buildings (OpenMapTiles 'housenumber' point layer) —
        // only at close zoom so it doesn't clutter
        map.addLayer({
          id: 'ofm-housenumbers',
          type: 'symbol',
          source: 'openFreeMapLabels',
          'source-layer': 'housenumber',
          minzoom: 17,
          layout: {
            visibility: 'visible',
            'text-field': ['get', 'housenumber'],
            'text-font': ['Noto Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 17, 10, 19, 13],
            'text-allow-overlap': false,
            'text-padding': 2
          },
          paint: {
            'text-color': '#ffe9c7',
            'text-halo-color': 'rgba(15, 18, 22, 0.95)',
            'text-halo-width': 1.6,
            'text-halo-blur': 0.3
          }
        });

        syncTerrainState();
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
    postGeo3DUsage('reset_view');
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
            postGeo3DUsage(isOn ? 'terrain_on' : 'terrain_off');
            terrainEnabled = isOn;
            syncTerrainState();
          }

          if (target === 'buildings') {
            postGeo3DUsage(isOn ? 'buildings_on' : 'buildings_off');
            buildingsEnabled = isOn;
            setLayerVisibility('buildings-3d', buildingsEnabled);
          }

          if (target === 'labels') {
            postGeo3DUsage(isOn ? 'labels_on' : 'labels_off');
            labelsEnabled = isOn;
            updateLabelsVisibility();
            showStatus(labelsEnabled ? 'שמות רחובות ויישובים הוצגו' : 'שמות רחובות ויישובים הוסתרו');
          }

          if (target === 'parcels') {
            postGeo3DUsage(isOn ? 'parcels_on' : 'parcels_off');
            parcelsEnabled = isOn;
            setLayerGroupVisibility(PARCEL_LAYER_IDS, parcelsEnabled);
            showStatus(parcelsEnabled ? 'גבולות חלקות הוצגו' : 'גבולות חלקות הוסתרו');
          }

          if (target === 'ownership') {
            postGeo3DUsage(isOn ? 'ownership_on' : 'ownership_off');
            ownershipEnabled = isOn;
            setLayerGroupVisibility(OWNERSHIP_LAYER_IDS, ownershipEnabled);
            showStatus(ownershipEnabled ? 'צביעת בעלויות הוצגה' : 'צביעת בעלויות הוסתרה');
          }

          if (target === 'basemap') {
            // is-on === OSM active, off === satellite
            postGeo3DUsage(isOn ? 'basemap_osm' : 'basemap_satellite');
            setBasemap(isOn ? 'osm' : 'satellite');
            showStatus(isOn ? 'רקע OSM' : 'רקע תצלום לוויין');
          }
        });
      });

      map.on('click', (e) => {
        identifyParcelAt(e);
      });

      map.on('mousemove', (e) => {
        if (!map.getLayer(PARCEL_HIT_LAYER_ID)) return;
        const p = e.point;
        const box = [[p.x - 4, p.y - 4], [p.x + 4, p.y + 4]];
        const features = map.queryRenderedFeatures(box, { layers: [PARCEL_HIT_LAYER_ID] });
        map.getCanvas().style.cursor = features.length ? 'pointer' : '';
      });

      // ── Unified search: address / gush-chelka / settlement ──
      (function initSearch() {
        // gush/chelka AND address both served from our own gisdb via gis-vps —
        // no dependency on external parcel services. Address search hits /address (enriched →
        // address_points → server-side Nominatim fallback). No client-side geocoder.
        const PARCEL_URL = TILE_BASE + '/parcel';
        const ADDR_URL = TILE_BASE + '/address';
        let marker = null, suggestEl = null, debounce = 0, lastResults = [], activeIdx = -1;

        const TYPE_ICON = { address: '📍', parcel: '▦', block: '▢', street: '🛣', settlement: '🏘', neighborhood: '🏘' };
        const TYPE_HE = { address: 'כתובת', parcel: 'גוש/חלקה', block: 'גוש', street: 'רחוב', settlement: 'יישוב', neighborhood: 'שכונה' };

        function ensureSuggest() {
          if (suggestEl) return suggestEl;
          suggestEl = document.createElement('div');
          suggestEl.className = 'search-suggest';
          suggestEl.hidden = true;
          document.body.appendChild(suggestEl);
          return suggestEl;
        }
        function positionSuggest() {
          const r = searchInput.getBoundingClientRect();
          const el = ensureSuggest();
          el.style.left = r.left + 'px';
          el.style.width = r.width + 'px';
          el.style.bottom = (window.innerHeight - r.top + 6) + 'px';
        }
        function hideSuggest() { if (suggestEl) { suggestEl.hidden = true; suggestEl.innerHTML = ''; } activeIdx = -1; }

        function shortAddr(s) { return String(s || '').split(',').slice(0, 3).join(', '); }
        function looksLikeParcel(q) { return /\d/.test(q) && (/גוש|חלק/.test(q) || /^[\d\s/.\-]+$/.test(q)); }
        function parseGushParcel(q) {
          if (!looksLikeParcel(q)) return null;
          const nums = (q.match(/\d+/g) || []).map(Number).filter((n) => n > 0);
          if (!nums.length) return null;
          return nums.length >= 2 ? { gush: nums[0], parcel: nums[1] } : { gush: nums[0], parcel: null };
        }
        async function parcelLookup(gush, parcel) {
          try {
            const u = PARCEL_URL + '?gush=' + gush + (parcel != null ? '&parcel=' + parcel : '');
            const r = await fetch(u);
            if (!r.ok) return null;
            const d = await r.json();
            if (typeof d.lng !== 'number') return null;
            const text = parcel != null ? ('גוש ' + gush + ' חלקה ' + parcel) : ('גוש ' + gush);
            return { type: parcel != null ? 'parcel' : 'block', text: text, lng: d.lng, lat: d.lat };
          } catch (e) { return null; }
        }
        async function addressSuggest(q) {
          try {
            const r = await fetch(ADDR_URL + '?q=' + encodeURIComponent(q));
            if (!r.ok) return [];
            const d = await r.json();
            return d.map((x) => ({
              type: 'address', text: shortAddr(x.label),
              lng: +x.lng, lat: +x.lat,
              gush: x.gush, parcel: x.parcel,
              has_parcel: x.has_parcel, source: x.source
            }));
          } catch (e) { return []; }
        }
        async function fetchSuggest(q) {
          // gush/chelka → our gisdb; address → OSM/Nominatim
          const gp = parseGushParcel(q);
          if (gp) {
            const res = await parcelLookup(gp.gush, gp.parcel);
            return res ? [res] : [];
          }
          return await addressSuggest(q);
        }
        function highlight() {
          const rows = suggestEl.querySelectorAll('.ss-row');
          rows.forEach((r, i) => r.classList.toggle('is-active', i === activeIdx));
        }
        function renderSuggest(results) {
          lastResults = results; activeIdx = -1;
          const el = ensureSuggest();
          el.innerHTML = '';
          if (!results.length) { hideSuggest(); return; }
          results.forEach((res) => {
            const row = document.createElement('div');
            row.className = 'ss-row';
            const ic = document.createElement('span'); ic.className = 'ss-ic'; ic.textContent = TYPE_ICON[res.type] || '📍';
            const tx = document.createElement('span'); tx.className = 'ss-text'; tx.textContent = res.text;
            const tp = document.createElement('span'); tp.className = 'ss-type'; tp.textContent = TYPE_HE[res.type] || res.type;
            row.appendChild(ic); row.appendChild(tx); row.appendChild(tp);
            if (res.has_parcel === false) {
              const bd = document.createElement('span'); bd.className = 'ss-badge';
              bd.textContent = res.source === 'osm' ? 'OSM' : 'ללא חלקה';
              row.appendChild(bd);
            }
            row.addEventListener('mousedown', (ev) => { ev.preventDefault(); selectResult(res); });
            el.appendChild(row);
          });
          positionSuggest();
          el.hidden = false;
        }
        function selectResult(res) {
          if (typeof res.lng !== 'number' || typeof res.lat !== 'number') return;
          const ll = [res.lng, res.lat];
          searchInput.value = res.text;
          hideSuggest();
          postGeo3DUsage('search');
          const z = (res.type === 'settlement') ? 13.5 : (res.type === 'block' ? 15.8 : 17.2);
          map.flyTo({ center: ll, zoom: z, pitch: 66, bearing: -18, duration: 1100, essential: true });
          if (marker) marker.remove();
          marker = new maplibregl.Marker({ color: '#b87e58' }).setLngLat(ll).addTo(map);
          const sub = (res.has_parcel && res.gush != null)
            ? (res.text + ' · גוש ' + res.gush + ' חלקה ' + res.parcel)
            : (res.has_parcel === false ? (res.text + ' · ללא חלקה קדסטרלית') : res.text);
          showStatus(sub);
        }

        searchInput.addEventListener('input', () => {
          const q = searchInput.value.trim();
          window.clearTimeout(debounce);
          if (q.length < 2) { hideSuggest(); return; }
          debounce = window.setTimeout(async () => {
            const results = await fetchSuggest(q);
            if (searchInput.value.trim() === q) renderSuggest(results);
          }, 250);
        });
        searchInput.addEventListener('keydown', (e) => {
          if (suggestEl && !suggestEl.hidden && lastResults.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, lastResults.length - 1); highlight(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); highlight(); }
            else if (e.key === 'Escape') { hideSuggest(); }
          }
        });
        searchInput.addEventListener('blur', () => { setTimeout(hideSuggest, 150); });
        window.addEventListener('resize', () => { if (suggestEl && !suggestEl.hidden) positionSuggest(); });

        searchForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          const q = searchInput.value.trim();
          if (!q) return;
          if (activeIdx >= 0 && lastResults[activeIdx]) { selectResult(lastResults[activeIdx]); return; }
          if (lastResults.length) { selectResult(lastResults[0]); return; }
          showStatus('מחפש', true);
          const results = await fetchSuggest(q);
          if (results.length) selectResult(results[0]); else showStatus('לא נמצאה תוצאה');
        });
      })();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => startAfterAuth(startGeo3D), { once: true });
  } else {
    startAfterAuth(startGeo3D);
  }
})();
