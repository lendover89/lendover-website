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

  async function hasValidSession() {
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
      return response.ok;
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
      window.showAuthModal(() => {
        startAuthenticatedApp();
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

      let terrainEnabled = true;
      let labelsEnabled = true;
      let buildingsEnabled = true;
      let basemap = 'satellite'; // 'satellite' | 'osm'
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
              maxzoom: 18,
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

          if (target === 'basemap') {
            // is-on === OSM active, off === satellite
            postGeo3DUsage(isOn ? 'basemap_osm' : 'basemap_satellite');
            setBasemap(isOn ? 'osm' : 'satellite');
            showStatus(isOn ? 'רקע OSM' : 'רקע תצלום לוויין');
          }
        });
      });

      // ── GOVMAP layer picker ────────────────────────────────────
      (function initGovmap() {
        const panel = document.getElementById('govmapPanel');
        const toggleBtn = document.getElementById('govmapToggle');
        const body = document.getElementById('govmapBody');
        const searchEl = document.getElementById('govmapSearch');
        const resultsEl = document.getElementById('govmapResults');
        const activeEl = document.getElementById('govmapActive');
        const countEl = document.getElementById('govmapCount');
        const legendEl = document.getElementById('govmapLegend');
        const legendBody = document.getElementById('legendBody');
        if (!panel) return;

        const PALETTE = ['#e8743b', '#3ba7e8', '#6bbf59', '#d64b8a', '#f2c14e', '#9b6bd6', '#46c2b5', '#e85d5d'];
        let tree = [];                       // [{id,name,layers:[{id,name,geom}]}]
        const active = new Map();            // id -> { item, color }
        const expanded = new Set();          // expanded category ids
        let colorIdx = 0;
        // one-time readiness flag — isStyleLoaded() flaps false while tiles load,
        // which wrongly deferred adding a 2nd layer while the 1st was still loading
        let mapReady = map.isStyleLoaded();
        map.on('load', () => { mapReady = true; });

        toggleBtn.addEventListener('click', () => {
          const opening = body.hasAttribute('hidden');
          if (opening) {
            body.removeAttribute('hidden');
            toggleBtn.setAttribute('aria-expanded', 'true');
            renderResults(searchEl.value);
            searchEl.focus();
          } else {
            body.setAttribute('hidden', '');
            toggleBtn.setAttribute('aria-expanded', 'false');
          }
        });

        fetch('govmap-tree.json')
          .then((r) => r.json())
          .then((data) => { tree = (data && Array.isArray(data.tree)) ? data.tree : []; if (!body.hasAttribute('hidden')) renderResults(searchEl.value); })
          .catch(() => { tree = []; });

        searchEl.addEventListener('input', () => renderResults(searchEl.value));
        renderResults('');  // show immediately (panel open by default)

        function geomLabel(g) {
          g = (g || '').toUpperCase();
          if (g.indexOf('POLYGON') >= 0) return 'שטח';
          if (g.indexOf('LINE') >= 0) return 'קו';
          if (g.indexOf('POINT') >= 0) return 'נקודה';
          return '';
        }

        function layerRow(it) {
          const li = document.createElement('li');
          li.className = 'gm-leaf' + (active.has(it.id) ? ' is-active' : '');
          const box = document.createElement('span');
          box.className = 'gm-check';
          box.textContent = active.has(it.id) ? '✓' : '';
          const sw = document.createElement('span');
          sw.className = 'gm-swatch';
          if (it.bars && it.bars.length > 1) {
            sw.style.background = 'linear-gradient(90deg,' + it.bars.join(',') + ')';
          } else {
            sw.style.background = it.color || 'rgba(255,255,255,0.3)';
          }
          const nm = document.createElement('span');
          nm.className = 'gm-name';
          nm.textContent = it.name || it.id;
          nm.title = it.name || it.id;
          const g = document.createElement('span');
          g.className = 'gm-geom';
          g.textContent = geomLabel(it.geom);
          li.appendChild(box);
          li.appendChild(sw);
          li.appendChild(nm);
          li.appendChild(g);
          li.addEventListener('click', () => {
            if (active.has(it.id)) removeLayer(it.id); else addLayer(it);
            renderResults(searchEl.value);
          });
          return li;
        }

        function renderResults(q) {
          q = (q || '').trim().toLowerCase();
          resultsEl.innerHTML = '';
          if (!tree.length) { resultsEl.innerHTML = '<li class="gm-empty">טוען קטלוג…</li>'; return; }
          let shown = 0;
          let muniHeaderShown = false;
          tree.forEach((cat) => {
            const matched = q
              ? cat.layers.filter((it) => (it.name || '').toLowerCase().indexOf(q) >= 0)
              : cat.layers;
            if (!matched.length) return;
            // section divider before the first municipal (city) group
            if (cat.muni && !muniHeaderShown) {
              const div = document.createElement('li');
              div.className = 'gm-section';
              div.textContent = 'שכבות עירוניות';
              resultsEl.appendChild(div);
              muniHeaderShown = true;
            }
            const isOpen = q ? true : expanded.has(cat.id);
            const head = document.createElement('li');
            head.className = 'gm-cat' + (isOpen ? ' is-open' : '') + (cat.muni ? ' is-muni' : '');
            const arrow = document.createElement('span');
            arrow.className = 'gm-arrow';
            arrow.textContent = isOpen ? '▾' : '▸';
            const cn = document.createElement('span');
            cn.className = 'gm-cat-name';
            cn.textContent = (cat.muni ? '🏙 ' : '') + cat.name;
            const cc = document.createElement('span');
            cc.className = 'gm-cat-count';
            cc.textContent = matched.length;
            head.appendChild(arrow);
            head.appendChild(cn);
            head.appendChild(cc);
            head.addEventListener('click', () => {
              if (expanded.has(cat.id)) expanded.delete(cat.id); else expanded.add(cat.id);
              renderResults(searchEl.value);
            });
            resultsEl.appendChild(head);
            if (isOpen) {
              matched.slice(0, 300).forEach((it) => { resultsEl.appendChild(layerRow(it)); shown++; });
            }
          });
          if (!shown && q) { resultsEl.innerHTML = '<li class="gm-empty">לא נמצאו שכבות</li>'; }
        }

        function matchExpr(attr, stops) {
          // ['match', to-string(attr), v1,c1, ..., transparent-fallback]
          const expr = ['match', ['to-string', ['get', attr]]];
          stops.forEach((pair) => { expr.push(String(pair[0]), pair[1]); });
          expr.push('rgba(0,0,0,0)');
          return expr;
        }

        function swatchColor(it, fallback) {
          const gs = it.gs;
          if (!gs) return it.color || fallback;
          if (gs.fillStops) return gs.fillStops[0][1];
          if (gs.strokeStops) return gs.strokeStops[0][1];
          return gs.fillColor || gs.stroke || it.color || fallback;
        }

        function addLayer(it) {
          if (active.has(it.id)) return;
          if (!mapReady) { map.once('load', () => addLayer(it)); return; }
          const gs = it.gs;
          const fallback = it.color || PALETTE[colorIdx++ % PALETTE.length];
          // keep fills semi-transparent so the basemap/satellite shows through.
          // govmap bakes op:1 on most polygons (opaque over its own light basemap);
          // cap it so layers never fully hide the map. floor avoids invisible fills.
          const opIn = (typeof it.op === 'number') ? it.op : 0.45;
          const fillOp = Math.max(0.3, Math.min(0.55, opIn));
          const srcId = 'gm-src-' + it.id;
          const lyrId = 'gm-' + it.id;
          const sourceLayer = 'govmap.' + it.id;
          if (!map.getSource(srcId)) {
            map.addSource(srcId, {
              type: 'vector',
              minzoom: 0,
              maxzoom: 22,
              tiles: [TILE_BASE + '/tiles/govmap.' + it.id + '/{z}/{x}/{y}']
            });
          }
          const g = (it.geom || '').toUpperCase();
          let layerDef;
          if (g.indexOf('POLYGON') >= 0) {
            if (gs && gs.fill) {
              // filled polygon — official fill color or value-based match
              const fc = gs.fillStops ? matchExpr(gs.attr, gs.fillStops) : (gs.fillColor || fallback);
              layerDef = { id: lyrId, type: 'fill', source: srcId, 'source-layer': sourceLayer, paint: { 'fill-color': fc, 'fill-opacity': fillOp, 'fill-outline-color': (gs.stroke || 'rgba(40,40,40,0.55)') } };
            } else {
              // outline-only polygon (e.g. cadastral parcels) — draw boundaries, no fill
              const sc = (gs && gs.strokeStops) ? matchExpr(gs.attr, gs.strokeStops) : ((gs && gs.stroke) || fallback);
              layerDef = { id: lyrId, type: 'line', source: srcId, 'source-layer': sourceLayer, paint: { 'line-color': sc, 'line-width': 1, 'line-opacity': 0.9 } };
            }
          } else if (g.indexOf('LINE') >= 0) {
            const sc = (gs && gs.strokeStops) ? matchExpr(gs.attr, gs.strokeStops) : ((gs && (gs.stroke || gs.fillColor)) || fallback);
            layerDef = { id: lyrId, type: 'line', source: srcId, 'source-layer': sourceLayer, paint: { 'line-color': sc, 'line-width': 2 } };
          } else {
            const cc = (gs && gs.fillStops) ? matchExpr(gs.attr, gs.fillStops) : ((gs && (gs.fillColor || gs.stroke)) || fallback);
            layerDef = { id: lyrId, type: 'circle', source: srcId, 'source-layer': sourceLayer, paint: { 'circle-color': cc, 'circle-radius': 4, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } };
          }
          const before = map.getLayer('buildings-3d') ? 'buildings-3d' : undefined;
          const mapLayers = [];
          // outline-only polygons have no fill to click — add an invisible fill
          // so the whole parcel is a click target (like govmap)
          const isOutlinePoly = (g.indexOf('POLYGON') >= 0) && !(gs && gs.fill);
          if (isOutlinePoly) {
            const hitId = 'gm-hit-' + it.id;
            map.addLayer({ id: hitId, type: 'fill', source: srcId, 'source-layer': sourceLayer, paint: { 'fill-color': '#000000', 'fill-opacity': 0.01 } }, before);
            mapLayers.push(hitId);
          }
          map.addLayer(layerDef, before);
          mapLayers.push(lyrId);
          // parcel layers (חלקות…): label each parcel with its number when zoomed in
          if ((g.indexOf('POLYGON') >= 0) && /חלק/.test(it.name || '')) {
            const lblId = 'gm-lbl-' + it.id;
            map.addLayer({
              id: lblId,
              type: 'symbol',
              source: srcId,
              'source-layer': sourceLayer,
              minzoom: 17,
              layout: {
                'text-field': ['coalesce', ['to-string', ['get', 'parcel']], ''],
                'text-font': ['Noto Sans Bold'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 17, 11, 19, 15],
                'text-allow-overlap': false,
                'text-padding': 2
              },
              paint: {
                'text-color': '#ffffff',
                'text-halo-color': 'rgba(20, 24, 28, 0.95)',
                'text-halo-width': 1.8,
                'text-halo-blur': 0.3
              }
            }, before);
            mapLayers.push(lblId);
          }
          active.set(it.id, { item: it, color: swatchColor(it, fallback), mapLayers: mapLayers });
          postGeo3DUsage('govmap_add');
          renderActive();
          showStatus('נוספה שכבה: ' + (it.name || it.id));
        }

        function removeLayer(id) {
          const entry = active.get(id);
          const srcId = 'gm-src-' + id;
          const layers = (entry && entry.mapLayers) || ['gm-' + id];
          layers.forEach((lid) => { if (map.getLayer(lid)) map.removeLayer(lid); });
          if (map.getSource(srcId)) map.removeSource(srcId);
          active.delete(id);
          renderActive();
        }

        function renderActive() {
          activeEl.innerHTML = '';
          active.forEach((entry, id) => {
            const chip = document.createElement('span');
            chip.className = 'gm-chip';
            const sw = document.createElement('span');
            sw.className = 'gm-swatch';
            sw.style.background = entry.color;
            const nm = document.createElement('span');
            nm.className = 'gm-name';
            nm.textContent = entry.item.name || id;
            nm.title = entry.item.name || id;
            const x = document.createElement('button');
            x.type = 'button';
            x.textContent = '×';
            x.title = 'הסר שכבה';
            x.addEventListener('click', () => { removeLayer(id); renderResults(searchEl.value); });
            chip.appendChild(sw);
            chip.appendChild(nm);
            chip.appendChild(x);
            activeEl.appendChild(chip);
          });
          const n = active.size;
          countEl.textContent = n ? String(n) : '';
          countEl.classList.toggle('has-active', n > 0);
          renderLegend();
        }

        function legendSwatch(color, isLine) {
          const sw = document.createElement('span');
          sw.className = 'legend-sw' + (isLine ? ' is-line' : '');
          sw.style.background = color;
          return sw;
        }

        // Build legend rows from the SAME style source as addLayer (gs), so the
        // legend always matches what is actually drawn. Mirrors addLayer's color
        // logic per geometry. Falls back to the baked lg only when gs is absent.
        function legendRowsFor(it, entryColor) {
          const gs = it.gs;
          const g = (it.geom || '').toUpperCase();
          const isPoly = g.indexOf('POLYGON') >= 0;
          const isLineG = g.indexOf('LINE') >= 0;
          if (gs) {
            let stops = null, single = null, isLine = false;
            if (isPoly && gs.fill) { stops = gs.fillStops; single = gs.fillColor; isLine = false; }
            else if (isPoly && !gs.fill) { stops = gs.strokeStops; single = gs.stroke; isLine = true; }
            else if (isLineG) { stops = gs.strokeStops; single = gs.stroke || gs.fillColor; isLine = true; }
            else { stops = gs.fillStops; single = gs.fillColor || gs.stroke; isLine = false; }
            const k = isLine ? 'line' : 'fill';
            if (stops && stops.length) return stops.map((s) => ({ c: s[1], t: s[0], k: k }));
            if (single) return [{ c: single, t: null, k: k }];
          }
          if (it.lg && it.lg.length) return it.lg;
          return [{ c: entryColor, t: null, k: isLineG ? 'line' : 'fill' }];
        }

        function renderLegend() {
          if (!legendEl) return;
          legendBody.innerHTML = '';
          if (!active.size) { legendEl.hidden = true; return; }
          legendEl.hidden = false;
          active.forEach((entry, id) => {
            const it = entry.item;
            const rows = legendRowsFor(it, entry.color);
            const block = document.createElement('div');
            block.className = 'legend-block';
            const head = document.createElement('div');
            head.className = 'legend-layer';
            // single-symbol (one row, no label) → swatch inline with layer name
            if (rows.length <= 1) {
              const r0 = rows[0];
              const col = (r0 && r0.c) || entry.color;
              head.appendChild(legendSwatch(col, r0 ? r0.k === 'line' : false));
              head.appendChild(document.createTextNode(it.name || id));
              block.appendChild(head);
            } else {
              head.textContent = it.name || id;
              block.appendChild(head);
              rows.forEach((r) => {
                const row = document.createElement('div');
                row.className = 'legend-row';
                row.appendChild(legendSwatch(r.c, r.k === 'line'));
                const lb = document.createElement('span');
                lb.className = 'legend-label';
                lb.textContent = r.t || '—';
                lb.title = r.t || '';
                row.appendChild(lb);
                block.appendChild(row);
              });
            }
            legendBody.appendChild(block);
          });
        }

        // ── Click-to-identify (feature info popup) ────────────────
        const FIELD_LABELS = {
          gush_num: 'גוש', parcel: 'חלקה', gush_suffi: 'תת-גוש',
          legal_area: 'שטח רשום (מ"ר)', ownership: 'בעלות', owner: 'מזהה בעלים',
          remark: 'הערה', doc: 'מסמך', objectid: 'OBJECTID', name: 'שם',
          address: 'כתובת', city: 'עיר', type: 'סוג', status: 'סטטוס'
        };
        const SKIP_FIELDS = { fid: 1, geom: 1, shape_length: 1, shape_area: 1, createat: 1 };

        function esc(s) {
          return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        function activeGovmapLayerIds() {
          const ids = [];
          active.forEach((entry) => {
            (entry.mapLayers || []).forEach((lid) => {
              // skip parcel-number label layers — they are not click targets
              if (lid.indexOf('gm-lbl-') === 0) return;
              if (map.getLayer(lid)) ids.push(lid);
            });
          });
          return ids;
        }

        function itemIdForLayer(layerId) {
          let found = null;
          active.forEach((entry, id) => { if ((entry.mapLayers || []).indexOf(layerId) >= 0) found = id; });
          return found;
        }

        // ── Selection highlight: make the clicked feature stand out ──────
        const HL_SRC = '__hl-sel';
        function ensureHighlight() {
          if (map.getSource(HL_SRC)) return;
          map.addSource(HL_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          // polygon glow fill
          map.addLayer({
            id: '__hl-fill', type: 'fill', source: HL_SRC,
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: { 'fill-color': '#ffe14d', 'fill-opacity': 0.30 }
          });
          // white halo under the crisp outline (works for polygons + lines)
          map.addLayer({
            id: '__hl-halo', type: 'line', source: HL_SRC,
            filter: ['!=', ['geometry-type'], 'Point'],
            paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.9, 'line-blur': 1 }
          });
          // bright crisp outline on top of the halo
          map.addLayer({
            id: '__hl-line', type: 'line', source: HL_SRC,
            filter: ['!=', ['geometry-type'], 'Point'],
            paint: { 'line-color': '#ff5a00', 'line-width': 2.6 }
          });
          // point features: halo + dot
          map.addLayer({
            id: '__hl-pt-halo', type: 'circle', source: HL_SRC,
            filter: ['==', ['geometry-type'], 'Point'],
            paint: { 'circle-radius': 11, 'circle-color': '#ffffff', 'circle-opacity': 0.9 }
          });
          map.addLayer({
            id: '__hl-pt', type: 'circle', source: HL_SRC,
            filter: ['==', ['geometry-type'], 'Point'],
            paint: { 'circle-radius': 7, 'circle-color': '#ff5a00' }
          });
        }
        const HL_LAYERS = ['__hl-fill', '__hl-halo', '__hl-line', '__hl-pt-halo', '__hl-pt'];
        function setHighlight(features) {
          ensureHighlight();
          map.getSource(HL_SRC).setData({ type: 'FeatureCollection', features: features });
          // keep the highlight on top of any layers toggled on after init
          HL_LAYERS.forEach((lid) => { if (map.getLayer(lid)) map.moveLayer(lid); });
        }
        function clearHighlight() {
          const s = map.getSource(HL_SRC);
          if (s) s.setData({ type: 'FeatureCollection', features: [] });
        }

        // ── Docked feature-info panel (anchored under the layers tree) ──
        // Replaces the floating popup: no closeOnClick race that wiped the
        // highlight, and it never covers the map.
        const infoPanel = document.getElementById('featureInfo');
        const infoBody = document.getElementById('featureInfoBody');
        const infoClose = document.getElementById('featureInfoClose');
        const infoTitle = infoPanel ? infoPanel.querySelector('.feature-info__title') : null;
        const layersPanel = document.getElementById('govmapPanel');
        function positionInfo() {
          if (!infoPanel || !layersPanel) return;
          const r = layersPanel.getBoundingClientRect();
          const bottomMargin = 70;           // clear the bottom toolbar/scale bar
          let top = r.bottom + 8;
          // if the layers tree is taller than the screen, slide the panel up so
          // at least ~180px stays visible (instead of running off-screen)
          const maxTop = window.innerHeight - bottomMargin - 180;
          if (top > maxTop) top = Math.max(74, maxTop);
          infoPanel.style.top = top + 'px';
          infoPanel.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
          infoPanel.style.width = r.width + 'px';
          // cap height so the panel always fits above the bottom of the screen
          infoPanel.style.maxHeight = Math.max(160, window.innerHeight - bottomMargin - top) + 'px';
        }
        function showInfo(innerHtml, title) {
          if (!infoPanel) return;
          if (infoTitle && title) infoTitle.textContent = title;
          infoBody.innerHTML = innerHtml;
          infoPanel.hidden = false;
          positionInfo();
        }
        function hideInfo() {
          if (infoPanel) { infoPanel.hidden = true; infoBody.innerHTML = ''; }
          clearHighlight();
        }
        if (infoClose) infoClose.addEventListener('click', hideInfo);
        window.addEventListener('resize', () => { if (infoPanel && !infoPanel.hidden) positionInfo(); });

        function identifyAt(e) {
          const ids = activeGovmapLayerIds();
          if (!ids.length) return;
          const p = e.point;
          const box = [[p.x - 5, p.y - 5], [p.x + 5, p.y + 5]]; // click tolerance
          const feats = map.queryRenderedFeatures(box, { layers: ids });
          if (!feats.length) { hideInfo(); return; }
          const byLayer = {};
          const seen = {};
          const hlFeats = [];
          feats.forEach((f) => {
            const id = itemIdForLayer(f.layer.id);
            const entry = id ? active.get(id) : null;
            const name = entry ? (entry.item.name || id) : (id || f.layer.id);
            const key = name + '|' + (f.properties ? JSON.stringify(f.properties) : f.id);
            if (seen[key]) return; // dedupe (hit-fill + outline are same feature)
            seen[key] = 1;
            if (f.geometry) hlFeats.push({ type: 'Feature', properties: {}, geometry: f.geometry });
            const arr = (byLayer[name] = byLayer[name] || []);
            if (arr.length < 6) arr.push(f.properties || {});
          });
          setHighlight(hlFeats);
          // total selected features across all layers (drives the title)
          let total = 0;
          Object.keys(byLayer).forEach((name) => { total += byLayer[name].length; });
          let html = '';
          Object.keys(byLayer).forEach((name) => {
            const list = byLayer[name];
            html += '<div class="gm-pop-layer">' + esc(name) +
              (list.length > 1 ? ' · ' + list.length + ' פיצ\'רים' : '') + '</div>';
            list.forEach((props, idx) => {
              // each feature in its own separated card; number them when >1
              html += '<div class="gm-pop-feature">';
              if (list.length > 1) html += '<span class="gm-pop-feature-idx">' + (idx + 1) + '</span>';
              html += '<table class="gm-pop-tbl">';
              Object.keys(props).forEach((k) => {
                if (SKIP_FIELDS[k]) return;
                // hide technical identifier columns (county_id, locality_id,
                // parcel_id, objectid, id…) — noise that bloats the panel
                if (/(^|_)id$/i.test(k) || /^objectid$/i.test(k)) return;
                const raw = props[k];
                if (raw === null || raw === undefined || raw === '') return;
                let v;
                if (k === 'doc' || /^https?:\/\//.test(String(raw))) {
                  v = '<a href="' + esc(String(raw)) + '" target="_blank" rel="noopener">קישור</a>';
                } else {
                  v = esc(String(raw));
                }
                html += '<tr><th>' + esc(FIELD_LABELS[k] || k) + '</th><td>' + v + '</td></tr>';
              });
              html += '</table>';
              html += '</div>';
            });
          });
          const title = total === 1 ? 'נבחר פיצ\'ר אחד' : ('נבחרו ' + total + ' פיצ\'רים');
          showInfo(html, title);

          // append addresses for any parcel (gush_num/parcel) in the clicked features
          const pairs = [];
          Object.keys(byLayer).forEach((name) => byLayer[name].forEach((props) => {
            if (props.gush_num != null && props.parcel != null) {
              const key = props.gush_num + '/' + props.parcel;
              if (!pairs.some((x) => x.key === key)) pairs.push({ key: key, gush: props.gush_num, parcel: props.parcel });
            }
          }));
          pairs.forEach((pr) => {
            fetch(TILE_BASE + '/parcel-addresses?gush=' + encodeURIComponent(pr.gush) + '&parcel=' + encodeURIComponent(pr.parcel))
              .then((r) => (r.ok ? r.json() : null))
              .then((d) => {
                if (!d || !d.addresses || !d.addresses.length) return;
                if (!infoPanel || infoPanel.hidden) return; // panel closed meanwhile
                const block = document.createElement('div');
                block.className = 'gm-pop-addresses';
                block.innerHTML = '<div class="gm-pop-layer">כתובות (גוש ' + esc(String(pr.gush)) + ' חלקה ' + esc(String(pr.parcel)) + ')</div>' +
                  d.addresses.map((a) => '<div class="gm-pop-addr">' + esc(a) + '</div>').join('');
                infoBody.appendChild(block);
              })
              .catch(() => {});
          });
        }

        map.on('click', identifyAt);
        map.on('mousemove', (e) => {
          const ids = activeGovmapLayerIds();
          if (!ids.length) { map.getCanvas().style.cursor = ''; return; }
          const p = e.point;
          const box = [[p.x - 4, p.y - 4], [p.x + 4, p.y + 4]];
          const f = map.queryRenderedFeatures(box, { layers: ids });
          map.getCanvas().style.cursor = f.length ? 'pointer' : '';
        });
      })();

      // ── Unified search: address / gush-chelka / settlement (govmap) ──
      (function initSearch() {
        // gush/chelka AND address both served from our own gisdb via gis-vps —
        // no dependency on govmap. Address search hits /address (enriched →
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

