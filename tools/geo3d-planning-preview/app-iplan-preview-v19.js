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
      const ownershipLegend = document.getElementById('ownershipLegend');
      const groundwaterPanel = document.getElementById('groundwaterPanel');
      const groundwaterPanelBody = document.getElementById('groundwaterPanelBody');
      const groundwaterClear = document.getElementById('groundwaterClear');
      const groundwaterSelectParcels = document.getElementById('groundwaterSelectParcels');
      const groundwaterDrawPolygon = document.getElementById('groundwaterDrawPolygon');
      const groundwaterComputeSelection = document.getElementById('groundwaterComputeSelection');
      const planningPanel = document.getElementById('planningPanel');
      const planningPanelBody = document.getElementById('planningPanelBody');
      const planningLayerButtons = document.querySelectorAll('[data-planning-layer]');
      const planningStatusLegend = document.getElementById('planningStatusLegend');
      const planningLandUseLegend = document.getElementById('planningLandUseLegend');
      const searchForm = document.getElementById('searchForm');
      const searchInput = document.getElementById('searchInput');
      const resetView = document.getElementById('resetView');
      const toggles = document.querySelectorAll('[data-layer-toggle]');

      const RTL_PLUGIN_URL = 'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.js';
      const GROUNDWATER_API = 'https://groundwater.lendover.co.il';
      const PLANNING_API = GROUNDWATER_API;
      const IPLAN_API = 'https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic';
      const LABEL_LAYER_IDS = ['ofm-neighborhood-labels', 'ofm-road-labels', 'ofm-settlement-labels', 'ofm-housenumbers'];
      const PARCEL_SOURCE_ID = 'parcelOwnership';
      const PARCEL_SOURCE_LAYER = 'prod.geo3d_parcel_ownership_lite';
      const PARCEL_HIT_LAYER_ID = 'parcel-hit';
      const PARCEL_BOUNDARY_LAYER_ID = 'parcel-boundaries';
      const PARCEL_OWNERSHIP_LAYER_ID = 'parcel-ownership-fill';
      const PARCEL_OWNERSHIP_LINE_LAYER_ID = 'parcel-ownership-line';
      const PARCEL_LABEL_LAYER_ID = 'parcel-numbers';
      const PARCEL_HIGHLIGHT_SOURCE_ID = 'parcelHighlight';
      const PARCEL_LAYER_IDS = [PARCEL_BOUNDARY_LAYER_ID, PARCEL_LABEL_LAYER_ID, PARCEL_HIT_LAYER_ID];
      const OWNERSHIP_LAYER_IDS = [PARCEL_OWNERSHIP_LAYER_ID, PARCEL_OWNERSHIP_LINE_LAYER_ID];
      const GROUNDWATER_COVERAGE_SOURCE_ID = 'groundwaterCoverage';
      const GROUNDWATER_MARKER_SOURCE_ID = 'groundwaterMarker';
      const GROUNDWATER_AREA_SOURCE_ID = 'groundwaterAreaSelection';
      const GROUNDWATER_DRAW_SOURCE_ID = 'groundwaterDrawSelection';
      const GROUNDWATER_LAYER_IDS = [
        'groundwater-coverage-fill',
        'groundwater-coverage-line',
        'groundwater-area-fill',
        'groundwater-area-halo',
        'groundwater-area-line',
        'groundwater-draw-fill',
        'groundwater-draw-halo',
        'groundwater-draw-line',
        'groundwater-draw-points',
        'groundwater-marker'
      ];
      const PRACTICAL_LAYER_ZOOM = {
        buildings: 13,
        parcels: 13,
        ownership: 12,
        planningLandUse: 9
      };
      const PLANNING_SOURCES = {
        blueLines: 'planningBlueLines',
        landUse: 'planningLandUse',
        groundwaterRisk: 'planningGroundwaterRisk',
        highlight: 'planningHighlight'
      };
      const PLANNING_LAYER_IDS = [
        'planning-blue-fill',
        'planning-blue-line',
        'planning-landuse-fill',
        'planning-landuse-line',
        'planning-risk-fill',
        'planning-risk-line'
      ];
      const PLANNING_CONFIG = {
        blueLines: {
          title: 'קווים כחולים',
          source: PLANNING_SOURCES.blueLines,
          vector: true
        },
        landUse: {
          title: 'ייעודי קרקע',
          source: PLANNING_SOURCES.landUse,
          urls: [
            IPLAN_API + '/compilation_tmm_tel_aviv/MapServer/7/query',
            IPLAN_API + '/compilation_tmm_merkaz/MapServer/12/query',
            IPLAN_API + '/compilation_tmm_haifa/MapServer/7/query',
            IPLAN_API + '/compilation_tmm_jerusalem/MapServer/6/query',
            IPLAN_API + '/compilation_tmm_darom/MapServer/8/query',
            IPLAN_API + '/compilation_tmm_tzafonn/MapServer/8/query'
          ],
          outFields: 'PLAN_NAME,TYPE_NAME,AREA_dunam',
          minZoom: PRACTICAL_LAYER_ZOOM.planningLandUse
        },
        groundwaterRisk: {
          title: 'אזור חשוד בזיהום מי תהום',
          source: PLANNING_SOURCES.groundwaterRisk,
          url: IPLAN_API + '/TAMA_1/MapServer/11/query',
          outFields: 'PL_NUMBER,PL_NAME,STATUS,NAME,LABEL,PL_URL'
        }
      };

      let terrainEnabled = true;
      let labelsEnabled = true;
      let buildingsEnabled = true;
      let parcelsEnabled = false;
      let ownershipEnabled = false;
      let groundwaterEnabled = false;
      let planningEnabled = false;
      let basemap = 'satellite'; // 'satellite' | 'osm'
      let statusTimer = 0;
      let parcelPopup = null;
      let selectedParcel = null;
      let groundwaterAreaMode = null;
      let groundwaterSelectedParcels = new Map();
      let groundwaterDrawPoints = [];
      let groundwaterPopup = null;
      let planningPopup = null;
      let planningLoadTimer = 0;
      let planningLoadSeq = 0;
      let selectedPlanningFeature = null;
      const planningFeatureIndex = new Map();
      const PLANNING_PAGE_SIZE = 1000;
      const PLANNING_MAX_FEATURES_PER_SOURCE = 6000;
      const planningLayerEnabled = {
        blueLines: false,
        landUse: false,
        groundwaterRisk: false
      };

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

      function formatArea(value) {
        const n = Number(value || 0);
        return n ? Math.round(n).toLocaleString('he') + ' מ"ר' : 'לא ידוע';
      }

      function geometryCentroid(geometry) {
        if (!geometry || !geometry.coordinates) return null;
        let sx = 0;
        let sy = 0;
        let n = 0;
        const visit = (coords) => {
          if (!Array.isArray(coords)) return;
          if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
            sx += coords[0];
            sy += coords[1];
            n += 1;
            return;
          }
          coords.forEach(visit);
        };
        visit(geometry.coordinates);
        if (!n) return null;
        const lng = sx / n;
        const lat = sy / n;
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
        return { lng, lat };
      }

      function parcelCentroid(features, fallbackLngLat) {
        const points = (features || [])
          .map((feature) => geometryCentroid(feature.geometry))
          .filter(Boolean);
        if (!points.length) return fallbackLngLat;
        const lng = points.reduce((sum, point) => sum + point.lng, 0) / points.length;
        const lat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return fallbackLngLat;
        return { lng, lat };
      }

      function parcelGeometryFromFeatures(features) {
        const polygons = [];
        (features || []).forEach((feature) => {
          const geometry = feature.geometry;
          if (!geometry || !Array.isArray(geometry.coordinates)) return;
          if (geometry.type === 'Polygon') {
            polygons.push(geometry.coordinates);
          } else if (geometry.type === 'MultiPolygon') {
            geometry.coordinates.forEach((polygon) => polygons.push(polygon));
          }
        });
        if (!polygons.length) return null;
        if (polygons.length === 1) return { type: 'Polygon', coordinates: polygons[0] };
        return { type: 'MultiPolygon', coordinates: polygons };
      }

      function parcelKey(props) {
        return String((props && props.gush) || '') + '/' + String((props && props.parcel) || '');
      }

      function combinePolygonGeometries(geometries) {
        const polygons = [];
        (geometries || []).forEach((geometry) => {
          if (!geometry || !Array.isArray(geometry.coordinates)) return;
          if (geometry.type === 'Polygon') {
            polygons.push(geometry.coordinates);
          } else if (geometry.type === 'MultiPolygon') {
            geometry.coordinates.forEach((polygon) => polygons.push(polygon));
          }
        });
        if (!polygons.length) return null;
        if (polygons.length === 1) return { type: 'Polygon', coordinates: polygons[0] };
        return { type: 'MultiPolygon', coordinates: polygons };
      }

      function geometryCenter(geometry, fallbackLngLat) {
        return geometryCentroid(geometry) || fallbackLngLat || map.getCenter();
      }

      function drawPolygonGeometry() {
        if (groundwaterDrawPoints.length < 3) return null;
        const ring = groundwaterDrawPoints.map((point) => [point.lng, point.lat]);
        ring.push([groundwaterDrawPoints[0].lng, groundwaterDrawPoints[0].lat]);
        return { type: 'Polygon', coordinates: [ring] };
      }

      function parcelGroundwaterHtml(state) {
        if (!state) {
          return '<button class="parcel-groundwater-button" type="button" data-parcel-groundwater>בדוק מי תהום לחלקה</button>';
        }
        if (state.status === 'loading') {
          return '<div class="parcel-groundwater-result is-loading">בודק מי תהום לפי פוליגון החלקה...</div>';
        }
        if (state.status === 'error') {
          return '<div class="parcel-groundwater-result is-error">' + escapeHtml(state.message || 'לא ניתן לחשב מי תהום לחלקה כרגע.') + '</div>' +
            '<button class="parcel-groundwater-button" type="button" data-parcel-groundwater>נסה שוב</button>';
        }
        const result = state.result || {};
        if (result.coverage === 'none' || result.mean == null) {
          return '<div class="parcel-groundwater-result"><strong>מי תהום</strong>' +
            '<span>' + escapeHtml(result.message || 'אין נתונים זמינים בשטח החלקה.') + '</span></div>';
        }
        const rows = [
          ['מינימום', formatMeters(result.min, 1)],
          ['ממוצע', formatMeters(result.mean, 1)],
          ['מקסימום', formatMeters(result.max, 1)],
          ['אקוויפר', result.aquiferDisplay || result.aquifer || '—']
        ];
        if (result.waterLevelYear) rows.push(['שנת מפלס', String(result.waterLevelYear)]);
        if (result.pixelCount != null) rows.push(['תאי רסטר', formatCount(result.pixelCount)]);
        return '<div class="parcel-groundwater-result"><strong>מי תהום לפי פוליגון החלקה</strong>' +
          '<table>' + rows.map((row) => '<tr><th>' + escapeHtml(row[0]) +
            '</th><td>' + escapeHtml(row[1]) + '</td></tr>').join('') + '</table>' +
          '<span>בדיקה ראשונית בלבד. לא מחליף יועץ קרקע או קידוחי ניסיון.</span></div>';
      }

      function parcelInfoHtml(props, groundwaterState) {
        const ownershipType = props.ownership_type || 'לא ידוע';
        const rows = [
          ['גוש', props.gush || ''],
          ['חלקה', props.parcel || ''],
          ['שטח חלקה', formatArea(props.area_sqm)],
          ['סוג בעלות', ownershipType],
          ['כמות בעלים/רשומות בעלות', formatCount(props.owners_count)]
        ];
        if (ownershipType === 'מעורב') {
          rows.push(['בעלות פרטית', formatCount(props.private_count)]);
          rows.push(['בעלות מדינה', formatCount(props.state_count)]);
        }
        return '<div class="parcel-popup-card"><div class="parcel-popup-title">פרטי חלקה</div>' +
          '<table>' + rows.map((row) => '<tr><th>' + escapeHtml(row[0]) +
            '</th><td>' + escapeHtml(row[1]) + '</td></tr>').join('') + '</table>' +
          parcelGroundwaterHtml(groundwaterState) + '</div>';
      }

      function setParcelHighlight(features) {
        const src = map.getSource(PARCEL_HIGHLIGHT_SOURCE_ID);
        if (!src) return;
        src.setData({ type: 'FeatureCollection', features: features || [] });
      }

      function parcelFeaturesAt(e) {
        if (!map.getLayer(PARCEL_HIT_LAYER_ID)) return null;
        const p = e.point;
        const box = [[p.x - 5, p.y - 5], [p.x + 5, p.y + 5]];
        const features = map.queryRenderedFeatures(box, { layers: [PARCEL_HIT_LAYER_ID] });
        if (!features.length) return null;
        const picked = features[0];
        const props = picked.properties || {};
        const key = parcelKey(props);
        const parts = map.queryRenderedFeatures({ layers: [PARCEL_HIT_LAYER_ID] })
          .filter((feature) => parcelKey(feature.properties || {}) === key)
          .filter((feature) => feature.geometry)
          .map((feature) => ({ type: 'Feature', properties: {}, geometry: feature.geometry }));
        return { key, props, features: parts, lngLat: parcelCentroid(parts, e.lngLat) };
      }

      function toggleGroundwaterParcelSelection(e) {
        if (!parcelsEnabled) return false;
        const picked = parcelFeaturesAt(e);
        if (!picked) return false;
        if (groundwaterSelectedParcels.has(picked.key)) {
          groundwaterSelectedParcels.delete(picked.key);
        } else {
          groundwaterSelectedParcels.set(picked.key, {
            props: picked.props,
            features: picked.features,
            geometry: parcelGeometryFromFeatures(picked.features),
            lngLat: picked.lngLat
          });
        }
        updateGroundwaterAreaSource();
        const count = groundwaterSelectedParcels.size;
        setGroundwaterPanelHtml(count ? ('נבחרו ' + formatCount(count) + ' חלקות. לחץ “חשב סימון” לחישוב מי תהום.') :
          'לחץ על חלקות כדי להוסיף אותן לסימון.');
        showStatus(count ? ('נבחרו ' + formatCount(count) + ' חלקות') : 'סימון החלקות נוקה');
        return true;
      }

      function identifyParcelAt(e) {
        if (!parcelsEnabled) return false;
        const picked = parcelFeaturesAt(e);
        if (!picked) return false;
        const props = picked.props;
        if (parcelPopup) {
          const popup = parcelPopup;
          parcelPopup = null;
          popup.remove();
        }
        const highlight = picked.features;
        selectedParcel = {
          props,
          lngLat: picked.lngLat,
          geometry: parcelGeometryFromFeatures(highlight),
          groundwater: null
        };
        setParcelHighlight(highlight);
        parcelPopup = new maplibregl.Popup({
          closeButton: true,
          closeOnClick: false,
          className: 'parcel-popup'
        })
          .setLngLat(e.lngLat)
          .setHTML(parcelInfoHtml(props, selectedParcel.groundwater))
          .addTo(map);
        parcelPopup.on('close', () => {
          parcelPopup = null;
          selectedParcel = null;
          setParcelHighlight(null);
        });
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
                TILE_BASE + '/tiles/prod.geo3d_parcel_ownership_lite/{z}/{x}/{y}?v=20260612-parcels-live'
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

      function zoomToPracticalMinimum(label, minZoom) {
        if (!minZoom || map.getZoom() >= minZoom) return false;
        map.easeTo({
          zoom: minZoom,
          duration: 650,
          essential: true
        });
        showStatus(label + ' יוצגו מזום ' + minZoom);
        return true;
      }

      function setOwnershipLegendVisibility(isVisible) {
        if (!ownershipLegend) return;
        ownershipLegend.classList.toggle('is-visible', isVisible);
        ownershipLegend.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
      }

      function setGroundwaterPanelVisibility(isVisible) {
        if (!groundwaterPanel) return;
        groundwaterPanel.classList.toggle('is-visible', isVisible);
        groundwaterPanel.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
      }

      function setGroundwaterPanelHtml(html) {
        if (!groundwaterPanelBody) return;
        groundwaterPanelBody.innerHTML = html;
      }

      function setPlanningPanelVisibility(isVisible) {
        if (!planningPanel) return;
        planningPanel.classList.toggle('is-visible', isVisible);
        planningPanel.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
      }

      function setPlanningPanelHtml(html) {
        if (!planningPanelBody) return;
        planningPanelBody.innerHTML = html;
      }

      function setPlanningLegendVisibility(element, isVisible) {
        if (!element) return;
        element.classList.toggle('is-visible', isVisible);
        element.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
      }

      function updatePlanningLegendsVisibility() {
        setPlanningLegendVisibility(planningStatusLegend, planningEnabled && planningLayerEnabled.blueLines);
        setPlanningLegendVisibility(planningLandUseLegend, planningEnabled && planningLayerEnabled.landUse);
      }

      function hasPlanningLayersEnabled() {
        return Object.keys(planningLayerEnabled).some((key) => planningLayerEnabled[key]);
      }

      function setPlanningHighlight(feature) {
        const source = map.getSource(PLANNING_SOURCES.highlight);
        if (!source) return;
        const features = Array.isArray(feature) ? feature : (feature ? [feature] : []);
        source.setData({
          type: 'FeatureCollection',
          features: features.filter((item) => item && item.geometry).map((item) => ({
            type: 'Feature',
            properties: item.properties || {},
            geometry: item.geometry
          }))
        });
      }

      function setGroundwaterCoverageVisibility(isVisible) {
        setLayerGroupVisibility(GROUNDWATER_LAYER_IDS, isVisible);
        setGroundwaterPanelVisibility(isVisible);
        if (isVisible && groundwaterPanelBody && !groundwaterPanelBody.dataset.hasResult) {
          setGroundwaterPanelHtml('לחץ על נקודה במפה כדי לחשב עומק מי תהום. האזור התכלת מציין כיסוי נתונים.');
        }
      }

      function setPlanningVisibility(isVisible) {
        setPlanningPanelVisibility(isVisible);
        updatePlanningLegendsVisibility();
        PLANNING_LAYER_IDS.forEach((layerId) => {
          const key = layerId.includes('landuse') ? 'landUse' :
            layerId.includes('risk') ? 'groundwaterRisk' : 'blueLines';
          setLayerVisibility(layerId, isVisible && planningLayerEnabled[key]);
        });
        if (isVisible) {
          if (hasPlanningLayersEnabled()) {
            if (!selectedPlanningFeature) setPlanningPanelHtml('');
            schedulePlanningLoad(60);
          } else {
            clearPlanningSources();
            setPlanningHighlight(null);
            setPlanningPanelHtml('');
          }
        } else {
          if (planningPopup) {
            planningPopup.remove();
            planningPopup = null;
          }
          selectedPlanningFeature = null;
          setPlanningHighlight(null);
          setPlanningPanelHtml('');
        }
      }

      function setGroundwaterToggleState(isOn) {
        const button = document.querySelector('[data-layer-toggle="groundwater"]');
        if (!button) return;
        button.classList.toggle('is-on', isOn);
        button.setAttribute('aria-pressed', isOn ? 'true' : 'false');
      }

      function showGroundwaterContext() {
        groundwaterEnabled = true;
        setGroundwaterToggleState(true);
        setGroundwaterCoverageVisibility(true);
      }

      function setGroundwaterMode(mode) {
        groundwaterAreaMode = groundwaterAreaMode === mode ? null : mode;
        showGroundwaterContext();
        if (groundwaterSelectParcels) {
          const isOn = groundwaterAreaMode === 'parcels';
          groundwaterSelectParcels.classList.toggle('is-on', isOn);
          groundwaterSelectParcels.setAttribute('aria-pressed', isOn ? 'true' : 'false');
        }
        if (groundwaterDrawPolygon) {
          const isOn = groundwaterAreaMode === 'draw';
          groundwaterDrawPolygon.classList.toggle('is-on', isOn);
          groundwaterDrawPolygon.setAttribute('aria-pressed', isOn ? 'true' : 'false');
        }
        if (groundwaterAreaMode === 'parcels') {
          groundwaterDrawPoints = [];
          updateGroundwaterDrawSource();
          if (!parcelsEnabled) {
            parcelsEnabled = true;
            setLayerGroupVisibility(PARCEL_LAYER_IDS, true);
            const parcelButton = document.querySelector('[data-layer-toggle="parcels"]');
            if (parcelButton) {
              parcelButton.classList.add('is-on');
              parcelButton.setAttribute('aria-pressed', 'true');
            }
          }
          setGroundwaterPanelHtml('לחץ על חלקות כדי להוסיף או להסיר אותן מהסימון, ואז לחץ “חשב סימון”.');
        } else if (groundwaterAreaMode === 'draw') {
          groundwaterSelectedParcels.clear();
          updateGroundwaterAreaSource();
          setGroundwaterPanelHtml('לחץ על המפה כדי להוסיף קודקודים לפוליגון. אחרי 3 נקודות אפשר לחשב סימון.');
        } else if (groundwaterPanelBody && !groundwaterPanelBody.dataset.hasResult) {
          setGroundwaterPanelHtml('לחץ על נקודה במפה, בחר כמה חלקות, או צייר פוליגון.');
        }
      }

      function updateGroundwaterAreaSource() {
        const source = map.getSource(GROUNDWATER_AREA_SOURCE_ID);
        if (!source) return;
        const features = [];
        groundwaterSelectedParcels.forEach((item) => {
          (item.features || []).forEach((feature) => features.push(feature));
        });
        source.setData({ type: 'FeatureCollection', features });
      }

      function updateGroundwaterDrawSource() {
        const source = map.getSource(GROUNDWATER_DRAW_SOURCE_ID);
        if (!source) return;
        const features = groundwaterDrawPoints.map((point, index) => ({
          type: 'Feature',
          properties: { index },
          geometry: { type: 'Point', coordinates: [point.lng, point.lat] }
        }));
        if (groundwaterDrawPoints.length >= 2) {
          features.push({
            type: 'Feature',
            properties: { kind: 'line' },
            geometry: {
              type: 'LineString',
              coordinates: groundwaterDrawPoints.map((point) => [point.lng, point.lat])
            }
          });
        }
        const polygon = drawPolygonGeometry();
        if (polygon) {
          features.push({ type: 'Feature', properties: { kind: 'polygon' }, geometry: polygon });
        }
        source.setData({ type: 'FeatureCollection', features });
      }

      function metaHtml(pairs) {
        return '<dl class="groundwater-panel__meta">' + pairs.map((row) => '<dt>' +
          escapeHtml(row[0]) + '</dt><dd>' + escapeHtml(row[1]) + '</dd>').join('') + '</dl>';
      }

      function planningMetaHtml(pairs) {
        return '<dl class="planning-panel__meta">' + pairs
          .filter((row) => row[1] !== null && row[1] !== undefined && row[1] !== '')
          .map((row) => '<dt>' + escapeHtml(row[0]) + '</dt><dd>' + escapeHtml(String(row[1])) + '</dd>')
          .join('') + '</dl>';
      }

      function updatePlanningLayerButtonStates() {
        planningLayerButtons.forEach((button) => {
          const key = button.dataset.planningLayer;
          const isOn = !!planningLayerEnabled[key];
          button.classList.toggle('is-on', isOn);
          button.setAttribute('aria-pressed', isOn ? 'true' : 'false');
        });
      }

      function planningLayerIdKey(layerId) {
        if (layerId.includes('landuse')) return 'landUse';
        if (layerId.includes('risk')) return 'groundwaterRisk';
        return 'blueLines';
      }

      function clearPlanningFeatureIndexForLayer(key) {
        Array.from(planningFeatureIndex.keys()).forEach((indexKey) => {
          if (indexKey.startsWith(key + '|')) planningFeatureIndex.delete(indexKey);
        });
      }

      function updatePlanningLayerVisibility() {
        PLANNING_LAYER_IDS.forEach((layerId) => {
          const key = planningLayerIdKey(layerId);
          setLayerVisibility(layerId, planningEnabled && planningLayerEnabled[key]);
        });
      }

      function clearPlanningSources() {
        Object.values(PLANNING_SOURCES).forEach((sourceId) => {
          const source = map.getSource(sourceId);
          if (source && typeof source.setData === 'function') {
            source.setData({ type: 'FeatureCollection', features: [] });
          }
        });
        planningFeatureIndex.clear();
        selectedPlanningFeature = null;
      }

      function planningQueryUrl(config, bounds, count, offset) {
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const params = new URLSearchParams({
          where: '1=1',
          geometry: [sw.lng, sw.lat, ne.lng, ne.lat].join(','),
          geometryType: 'esriGeometryEnvelope',
          inSR: '4326',
          spatialRel: 'esriSpatialRelIntersects',
          outFields: config.outFields,
          returnGeometry: 'true',
          outSR: '4326',
          f: 'geojson',
          resultRecordCount: String(count || PLANNING_PAGE_SIZE),
          resultOffset: String(offset || 0)
        });
        return (config.url || config.urls[0]) + '?' + params.toString();
      }

      function planningQueryUrlFor(config, url, bounds, count, offset) {
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const params = new URLSearchParams({
          where: '1=1',
          geometry: [sw.lng, sw.lat, ne.lng, ne.lat].join(','),
          geometryType: 'esriGeometryEnvelope',
          inSR: '4326',
          spatialRel: 'esriSpatialRelIntersects',
          outFields: config.outFields,
          returnGeometry: 'true',
          outSR: '4326',
          f: 'geojson',
          resultRecordCount: String(count || PLANNING_PAGE_SIZE),
          resultOffset: String(offset || 0)
        });
        return url + '?' + params.toString();
      }

      async function fetchPlanningFeatures(config, url, bounds, seq, pageSize) {
        const features = [];
        let offset = 0;
        while (features.length < PLANNING_MAX_FEATURES_PER_SOURCE) {
          if (seq !== planningLoadSeq || !planningEnabled) return null;
          const response = await fetch(planningQueryUrlFor(config, url, bounds, pageSize, offset), {
            credentials: 'include'
          });
          if (!response.ok) throw new Error(config.title + ' לא נטענה.');
          const data = await response.json();
          const pageFeatures = Array.isArray(data.features) ? data.features : [];
          features.push(...pageFeatures);
          if (!data.exceededTransferLimit || pageFeatures.length < pageSize) {
            return { features, exceeded: false };
          }
          offset += pageFeatures.length;
        }
        return { features, exceeded: true };
      }

      async function loadPlanningLayer(key, seq) {
        const config = PLANNING_CONFIG[key];
        const source = map.getSource(config.source);
        if (config.vector) {
          clearPlanningFeatureIndexForLayer(key);
          return { key, count: 0, vector: true };
        }
        if (!source || !planningEnabled || !planningLayerEnabled[key]) {
          if (source) source.setData({ type: 'FeatureCollection', features: [] });
          clearPlanningFeatureIndexForLayer(key);
          return { key, count: 0, skipped: !planningLayerEnabled[key] };
        }
        if (config.minZoom && map.getZoom() < config.minZoom) {
          source.setData({ type: 'FeatureCollection', features: [] });
          clearPlanningFeatureIndexForLayer(key);
          return { key, count: 0, skipped: true, reason: 'zoom' };
        }

        const urls = config.urls || [config.url];
        const bounds = map.getBounds();
        const pageSize = config.urls ? 500 : PLANNING_PAGE_SIZE;
        const partsSettled = await Promise.allSettled(urls.map(async (url) => {
          return fetchPlanningFeatures(config, url, bounds, seq, pageSize);
        }));
        if (seq !== planningLoadSeq) return { key, count: 0, skipped: true };
        const parts = partsSettled
          .filter((part) => part.status === 'fulfilled')
          .map((part) => part.value);
        if (!parts.length) throw new Error(config.title + ' לא נטענה.');
        const features = parts.flatMap((data) => data && Array.isArray(data.features) ? data.features : []);
        clearPlanningFeatureIndexForLayer(key);
        const enrichedFeatures = features.map((feature) => ({
          ...feature,
          properties: {
            ...(feature.properties || {}),
            planning_layer: key,
            planning_title: config.title
          }
        }));
        enrichedFeatures.forEach((feature) => {
          const indexKey = planningFeatureIdentity(feature);
          if (!planningFeatureIndex.has(indexKey)) planningFeatureIndex.set(indexKey, []);
          planningFeatureIndex.get(indexKey).push(feature);
        });
        source.setData({
          type: 'FeatureCollection',
          features: enrichedFeatures
        });
        return { key, count: features.length, exceeded: parts.some((data) => data && data.exceeded) };
      }

      function planningStatusLegendHtml() {
        return '<div class="planning-status-legend" aria-label="מקרא סטטוס תכנית">' +
          '<div><span style="--legend-color:#22c55e"></span>אישור</div>' +
          '<div><span style="--legend-color:#f59e0b"></span>הפקדה / בדיקה</div>' +
          '<div><span style="--legend-color:#38bdf8"></span>77/78</div>' +
          '<div><span style="--legend-color:#a78bfa"></span>אחר</div>' +
          '</div>';
      }

      async function loadPlanningLayers() {
        if (!planningEnabled) return;
        if (!hasPlanningLayersEnabled()) {
          clearPlanningSources();
          setPlanningHighlight(null);
          setPlanningPanelHtml('');
          return;
        }
        const seq = ++planningLoadSeq;
        try {
          const results = await Promise.all(Object.keys(PLANNING_CONFIG).map((key) => loadPlanningLayer(key, seq)));
          if (seq !== planningLoadSeq || !planningEnabled) return;
          if (!selectedPlanningFeature) setPlanningPanelHtml('');
          if (results.some((result) => result.exceeded)) {
            showStatus('חלק משכבות התכנון כבדות באזור הזה. התקרב מעט לקבלת טעינה מלאה.');
          }
        } catch (error) {
          if (!selectedPlanningFeature) {
            setPlanningPanelHtml('<div class="planning-panel__note">' + escapeHtml(error.message || 'שגיאה בטעינת שכבות iPlan.') + '</div>');
          }
          showStatus('שגיאה בטעינת שכבות תכנון');
        }
      }

      function schedulePlanningLoad(delay) {
        clearTimeout(planningLoadTimer);
        planningLoadTimer = setTimeout(loadPlanningLayers, delay || 250);
      }

      function planningFeatureLabel(feature) {
        const props = feature.properties || {};
        const key = props.planning_layer;
        if (key === 'groundwaterRisk') return props.NAME || props.LABEL || props.PL_NAME || 'אזור חשוד בזיהום מי תהום';
        if (key === 'landUse') return props.TYPE_NAME || props.mavat_name || props.PLAN_NAME || props.pl_name || 'ייעוד קרקע';
        return props.pl_name || props.pl_number || 'תכנית';
      }

      function planningFeatureHtml(feature) {
        const props = feature.properties || {};
        const key = props.planning_layer;
        const title = props.planning_title || 'תכנון';
        const planNumber = props.pl_number || props.PL_NUMBER || '';
        const planName = props.pl_name || props.PL_NAME || '';
        const status = props.station_desc || props.STATUS || '';
        const link = props.pl_url || props.PL_URL || '';
        const rows = key === 'landUse' ? [
          ['שכבה', title],
          ['ייעוד', props.TYPE_NAME || props.mavat_name],
          ['תכנית', props.PLAN_NAME || planName],
          ['שטח', props.AREA_dunam ? Number(props.AREA_dunam).toLocaleString('he') + ' דונם' : '']
        ] : key === 'groundwaterRisk' ? [
          ['שכבה', title],
          ['שם', props.NAME || props.LABEL],
          ['מספר תכנית', planNumber],
          ['סטטוס', status]
        ] : [
          ['שכבה', title],
          ['מספר תכנית', planNumber],
          ['שם תכנית', planName],
          ['סטטוס', status],
          ['שטח', props.pl_area_dunam ? Number(props.pl_area_dunam).toLocaleString('he') + ' דונם' : ''],
          ['ייעודים', props.pl_landuse_string]
        ];
        return '<strong>' + escapeHtml(planningFeatureLabel(feature)) + '</strong>' +
          planningMetaHtml(rows) +
          (link ? '<div class="planning-panel__note"><a href="' + escapeHtml(link) + '" target="_blank" rel="noopener">פתיחה במבא״ת</a></div>' : '') +
          '<div class="planning-panel__note">מידע תכנוני ראשוני ממינהל התכנון. יש לתקף מול מסמכי התכנית.</div>';
      }

      function planningFeatureStatus(feature) {
        const props = feature.properties || {};
        return props.station_desc || props.STATUS || 'סטטוס לא ידוע';
      }

      function planningFeatureListHtml(features) {
        const items = (features || []).map((feature) => {
          const props = feature.properties || {};
          const planNumber = props.pl_number || props.PL_NUMBER || '';
          const planName = props.pl_name || props.PL_NAME || props.PLAN_NAME || planningFeatureLabel(feature);
          const status = planningFeatureStatus(feature);
          const link = props.pl_url || props.PL_URL || '';
          const title = [planNumber, planName].filter(Boolean).join(' — ') || 'תכנית';
          return '<li class="planning-panel__plan-item">' +
            '<div class="planning-panel__plan-title">' + escapeHtml(title) + '</div>' +
            '<div class="planning-panel__plan-status">' + escapeHtml(status) + '</div>' +
            (link ? '<a href="' + escapeHtml(link) + '" target="_blank" rel="noopener">מבא״ת</a>' : '') +
            '</li>';
        }).join('');
        return '<div class="planning-panel__context">תכניות רלוונטיות בנקודה</div>' +
          '<div class="planning-panel__note">נמצאו ' + formatCount((features || []).length) + ' תכניות חופפות/קרובות לנקודה שנבחרה.</div>' +
          '<ol class="planning-panel__plan-list">' + items + '</ol>' +
          '<div class="planning-panel__note">מידע תכנוני ראשוני ממינהל התכנון. יש לתקף מול מסמכי התכנית.</div>';
      }

      function planningIdentifyLineLayers() {
        const layers = [];
        if (planningLayerEnabled.blueLines && map.getLayer('planning-blue-line')) layers.push('planning-blue-line');
        if (planningLayerEnabled.landUse && map.getLayer('planning-landuse-line')) layers.push('planning-landuse-line');
        if (planningLayerEnabled.groundwaterRisk && map.getLayer('planning-risk-line')) layers.push('planning-risk-line');
        return layers;
      }

      function planningIdentifyFillLayers() {
        const layers = [];
        if (planningLayerEnabled.blueLines && map.getLayer('planning-blue-fill')) layers.push('planning-blue-fill');
        if (planningLayerEnabled.landUse && map.getLayer('planning-landuse-fill')) layers.push('planning-landuse-fill');
        if (planningLayerEnabled.groundwaterRisk && map.getLayer('planning-risk-fill')) layers.push('planning-risk-fill');
        return layers;
      }

      function planningFeatureIdentity(feature) {
        const props = feature.properties || {};
        if (props.fid !== null && props.fid !== undefined && props.planning_layer === 'blueLines') {
          return 'blueLines|fid|' + props.fid;
        }
        return [
          props.planning_layer || '',
          props.pl_number || props.PL_NUMBER || '',
          props.pl_name || props.PL_NAME || props.PLAN_NAME || props.NAME || props.LABEL || ''
        ].join('|');
      }

      function uniquePlanningFeatures(features) {
        const seen = new Set();
        return (features || []).filter((feature) => {
          const key = planningFeatureIdentity(feature);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }

      function screenPoint(coord) {
        if (!Array.isArray(coord) || coord.length < 2) return null;
        return map.project({ lng: Number(coord[0]), lat: Number(coord[1]) });
      }

      function distanceToSegment(point, a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (!dx && !dy) return Math.hypot(point.x - a.x, point.y - a.y);
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
        const x = a.x + t * dx;
        const y = a.y + t * dy;
        return Math.hypot(point.x - x, point.y - y);
      }

      function ringScreenDistance(point, ring) {
        let best = Infinity;
        let area = 0;
        const pts = (ring || []).map(screenPoint).filter(Boolean);
        for (let i = 0; i < pts.length; i += 1) {
          const a = pts[i];
          const b = pts[(i + 1) % pts.length];
          best = Math.min(best, distanceToSegment(point, a, b));
          area += (a.x * b.y) - (b.x * a.y);
        }
        return { distance: best, area: Math.abs(area / 2) };
      }

      function lineScreenDistance(point, coords) {
        let best = Infinity;
        const pts = (coords || []).map(screenPoint).filter(Boolean);
        for (let i = 1; i < pts.length; i += 1) {
          best = Math.min(best, distanceToSegment(point, pts[i - 1], pts[i]));
        }
        return best;
      }

      function planningFeatureScore(feature, point) {
        const geom = feature && feature.geometry;
        if (!geom) return { distance: Infinity, area: Infinity };
        if (geom.type === 'Polygon') {
          return (geom.coordinates || []).reduce((best, ring) => {
            const score = ringScreenDistance(point, ring);
            return score.distance < best.distance ? score : best;
          }, { distance: Infinity, area: Infinity });
        }
        if (geom.type === 'MultiPolygon') {
          return (geom.coordinates || []).flat().reduce((best, ring) => {
            const score = ringScreenDistance(point, ring);
            return score.distance < best.distance ? score : best;
          }, { distance: Infinity, area: Infinity });
        }
        if (geom.type === 'LineString') {
          return { distance: lineScreenDistance(point, geom.coordinates), area: Infinity };
        }
        if (geom.type === 'MultiLineString') {
          return {
            distance: (geom.coordinates || []).reduce((best, line) => Math.min(best, lineScreenDistance(point, line)), Infinity),
            area: Infinity
          };
        }
        return { distance: Infinity, area: Infinity };
      }

      function pickPlanningFeature(features, point) {
        return uniquePlanningFeatures(features)
          .map((feature) => ({ feature, score: planningFeatureScore(feature, point) }))
          .sort((a, b) => (a.score.distance - b.score.distance) || (a.score.area - b.score.area))[0]?.feature || null;
      }

      function scorePlanningFeatures(features, point) {
        return uniquePlanningFeatures(features)
          .map((feature) => ({ feature, score: planningFeatureScore(feature, point) }))
          .sort((a, b) => (a.score.distance - b.score.distance) || (a.score.area - b.score.area))
          .map((item) => item.feature);
      }

      function blueLineFeaturesAt(point, lineFeatures, fillFeatures) {
        const blueFill = (fillFeatures || []).filter((feature) => (feature.properties || {}).planning_layer === 'blueLines');
        const blueLine = (lineFeatures || []).filter((feature) => (feature.properties || {}).planning_layer === 'blueLines');
        return scorePlanningFeatures(blueFill.length ? blueFill : blueLine, point).slice(0, 30);
      }

      function resolvePlanningSourceFeature(renderedFeature, point) {
        if (!renderedFeature) return null;
        const candidates = planningFeatureIndex.get(planningFeatureIdentity(renderedFeature)) || [renderedFeature];
        return candidates
          .filter((feature) => feature && feature.geometry)
          .map((feature) => ({ feature, score: planningFeatureScore(feature, point) }))
          .sort((a, b) => (a.score.distance - b.score.distance) || (a.score.area - b.score.area))[0]?.feature || renderedFeature;
      }

      async function fetchPlanningBlueLineFeature(renderedFeature) {
        const fid = renderedFeature && renderedFeature.properties && renderedFeature.properties.fid;
        if (!fid) return renderedFeature || null;
        const response = await fetch(PLANNING_API + '/api/planning/blue-lines/feature/' + encodeURIComponent(fid), {
          credentials: 'include'
        });
        if (!response.ok) return renderedFeature;
        const feature = await response.json();
        return feature && feature.geometry ? feature : renderedFeature;
      }

      async function fetchPlanningBlueLineFeatures(renderedFeatures) {
        const features = await Promise.all((renderedFeatures || []).map((feature) => fetchPlanningBlueLineFeature(feature)));
        return uniquePlanningFeatures(features.filter(Boolean));
      }

      async function identifyPlanningAt(e) {
        if (!planningEnabled) return false;
        const p = e.point;
        const lineLayers = planningIdentifyLineLayers();
        const fillLayers = planningIdentifyFillLayers();
        const lineFeatures = lineLayers.length ?
          map.queryRenderedFeatures([[p.x - 14, p.y - 14], [p.x + 14, p.y + 14]], { layers: lineLayers }) : [];
        const fillFeatures = fillLayers.length ?
          map.queryRenderedFeatures([[p.x - 3, p.y - 3], [p.x + 3, p.y + 3]], { layers: fillLayers }) : [];
        const blueLines = blueLineFeaturesAt(p, lineFeatures, fillFeatures);
        if (planningLayerEnabled.blueLines && blueLines.length) {
          const features = await fetchPlanningBlueLineFeatures(blueLines);
          selectedPlanningFeature = features[0] || blueLines[0];
          setPlanningHighlight(features.length ? features : blueLines);
          if (planningPopup) {
            planningPopup.remove();
            planningPopup = null;
          }
          setPlanningPanelHtml(planningFeatureListHtml(features.length ? features : blueLines));
          postGeo3DUsage('planning_identify_blue_lines');
          return true;
        }
        const renderedFeature = pickPlanningFeature(lineFeatures.length ? lineFeatures : fillFeatures, p);
        let feature = resolvePlanningSourceFeature(renderedFeature, p);
        if (!feature) return false;
        if ((feature.properties || {}).planning_layer === 'blueLines') {
          feature = await fetchPlanningBlueLineFeature(feature);
        }
        selectedPlanningFeature = feature;
        setPlanningHighlight(feature);
        if (planningPopup) {
          planningPopup.remove();
          planningPopup = null;
        }
        setPlanningPanelHtml('<div class="planning-panel__context">פריט תכנון נבחר</div>' + planningFeatureHtml(feature));
        postGeo3DUsage('planning_identify');
        return true;
      }

      function formatMeters(value, digits) {
        const n = Number(value);
        if (!Number.isFinite(n)) return '—';
        return n.toLocaleString('he', {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits
        }) + ' מ׳';
      }

      function renderGroundwaterResult(result, lngLat) {
        if (!groundwaterPanelBody) return;
        groundwaterPanelBody.dataset.hasResult = '1';
        if (result.coverage === 'none' || result.depth == null) {
          const note = result.message || 'אין נתוני מי תהום בנקודה זו.';
          setGroundwaterPanelHtml('<div class="groundwater-panel__main">אין נתונים</div>' +
            '<div class="groundwater-panel__note">' + escapeHtml(note) + '</div>');
          return;
        }

        const pairs = [
          ['גובה קרקע', formatMeters(result.elevation, 2)],
          ['מפלס מי תהום', formatMeters(result.waterLevel, 2)],
          ['אקוויפר', result.aquiferDisplay || result.aquifer || '—']
        ];
        if (result.waterLevelYear) pairs.push(['שנת מפלס', String(result.waterLevelYear)]);
        if (result.waterLevelSource) pairs.push(['מקור מפלס', result.waterLevelSource]);
        setGroundwaterPanelHtml('<div class="groundwater-panel__main">' + formatMeters(result.depth, 1) + '</div>' +
          '<div>עומק משוער עד מי תהום בנקודה שנבחרה.</div>' + metaHtml(pairs) +
          '<div class="groundwater-panel__note">כלי לבדיקה ראשונית בלבד. לא מחליף יועץ קרקע או קידוחי ניסיון.</div>');

        if (groundwaterPopup) groundwaterPopup.remove();
        groundwaterPopup = new maplibregl.Popup({
          closeButton: true,
          closeOnClick: false,
          className: 'groundwater-popup'
        })
          .setLngLat(lngLat)
          .setHTML('<strong>עומק מי תהום</strong>' + escapeHtml(formatMeters(result.depth, 1)))
          .addTo(map);
      }

      function setGroundwaterMarker(lngLat) {
        const markerSource = map.getSource(GROUNDWATER_MARKER_SOURCE_ID);
        if (!markerSource) return;
        markerSource.setData({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [lngLat.lng, lngLat.lat] }
          }]
        });
      }

      async function fetchGroundwaterPoint(lngLat) {
        const response = await fetch(GROUNDWATER_API + '/api/depth/point', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ x: lngLat.lng, y: lngLat.lat, srs: 'EPSG:4326' })
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) {
          throw new Error('נדרשת התחברות כדי לחשב עומק מי תהום.');
        }
        if (response.status === 429) {
          throw new Error('יותר מדי בקשות. נסה שוב בעוד מספר דקות.');
        }
        if (!response.ok) {
          throw new Error(data.message || data.error || 'שגיאה בבדיקת מי תהום.');
        }
        return data;
      }

      async function fetchFullParcelGeometry(props) {
        const gush = props && props.gush;
        const parcel = props && props.parcel;
        if (!gush || !parcel) return null;
        const url = GROUNDWATER_API + '/api/parcel/search?gush=' +
          encodeURIComponent(gush) + '&parcel=' + encodeURIComponent(parcel);
        const response = await fetch(url, { credentials: 'include' });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) {
          throw new Error('נדרשת התחברות כדי לחשב עומק מי תהום.');
        }
        if (response.status === 429) {
          throw new Error('יותר מדי בקשות. נסה שוב בעוד מספר דקות.');
        }
        if (!response.ok) return null;
        return data.geometry || null;
      }

      async function resolveSelectedParcelGeometry() {
        if (!selectedParcel) return null;
        return (await fetchFullParcelGeometry(selectedParcel.props)) || selectedParcel.geometry;
      }

      async function fetchGroundwaterPolygon(geometry) {
        const response = await fetch(GROUNDWATER_API + '/api/depth/polygon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ geometry })
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) {
          throw new Error('נדרשת התחברות כדי לחשב עומק מי תהום.');
        }
        if (response.status === 429) {
          throw new Error('יותר מדי בקשות. נסה שוב בעוד מספר דקות.');
        }
        if (!response.ok) {
          throw new Error(data.message || data.error || 'שגיאה בבדיקת מי תהום לחלקה.');
        }
        return data;
      }

      function renderGroundwaterPolygonResult(result, lngLat) {
        if (!groundwaterPanelBody) return;
        groundwaterPanelBody.dataset.hasResult = '1';
        if (result.coverage === 'none' || result.mean == null) {
          setGroundwaterPanelHtml('<div class="groundwater-panel__main">אין נתונים</div>' +
            '<div class="groundwater-panel__note">' + escapeHtml(result.message || 'אין נתוני מי תהום תקפים בשטח החלקה.') + '</div>');
          return;
        }
        const pairs = [
          ['מינימום', formatMeters(result.min, 1)],
          ['ממוצע', formatMeters(result.mean, 1)],
          ['מקסימום', formatMeters(result.max, 1)],
          ['אקוויפר', result.aquiferDisplay || result.aquifer || '—']
        ];
        if (result.waterLevelYear) pairs.push(['שנת מפלס', String(result.waterLevelYear)]);
        if (result.waterLevelSource) pairs.push(['מקור מפלס', result.waterLevelSource]);
        if (result.pixelCount != null) pairs.push(['תאי רסטר', formatCount(result.pixelCount)]);
        setGroundwaterPanelHtml('<div class="groundwater-panel__main">' + formatMeters(result.mean, 1) + '</div>' +
          '<div>עומק מי תהום ממוצע בשטח החלקה.</div>' + metaHtml(pairs) +
          '<div class="groundwater-panel__note">מינימום/ממוצע/מקסימום מחושבים מתאי הרסטר התקפים בתוך פוליגון החלקה.</div>');

        if (groundwaterPopup) groundwaterPopup.remove();
        groundwaterPopup = new maplibregl.Popup({
          closeButton: true,
          closeOnClick: false,
          className: 'groundwater-popup'
        })
          .setLngLat(lngLat)
          .setHTML('<strong>מי תהום בסימון</strong>' + escapeHtml(formatMeters(result.mean, 1)))
          .addTo(map);
      }

      function refreshParcelPopup() {
        if (!parcelPopup || !selectedParcel) return;
        parcelPopup.setHTML(parcelInfoHtml(selectedParcel.props, selectedParcel.groundwater));
      }

      async function querySelectedParcelGroundwater() {
        if (!selectedParcel || !selectedParcel.lngLat) return;
        selectedParcel.groundwater = { status: 'loading' };
        refreshParcelPopup();
        showGroundwaterContext();
        setGroundwaterMarker(selectedParcel.lngLat);
        setGroundwaterPanelHtml('בודק עומק מי תהום לפי פוליגון החלקה...');
        showStatus('בודק מי תהום לפוליגון החלקה', true);
        try {
          const geometry = await resolveSelectedParcelGeometry();
          if (!geometry) throw new Error('לא נמצאה גיאומטריית חלקה מלאה לחישוב.');
          const data = await fetchGroundwaterPolygon(geometry);
          selectedParcel.groundwater = { status: 'done', result: data };
          refreshParcelPopup();
          renderGroundwaterPolygonResult(data, selectedParcel.lngLat);
          showStatus('בדיקת מי תהום לפוליגון החלקה הושלמה');
          postGeo3DUsage('groundwater_parcel_polygon');
        } catch (error) {
          selectedParcel.groundwater = { status: 'error', message: error.message };
          refreshParcelPopup();
          setGroundwaterPanelHtml(escapeHtml(error.message || 'שגיאה בבדיקת מי תהום.'));
          showStatus('שגיאה בבדיקת מי תהום לפוליגון החלקה');
        }
      }

      async function selectedParcelsGeometry() {
        const geometries = [];
        for (const item of groundwaterSelectedParcels.values()) {
          const fullGeometry = await fetchFullParcelGeometry(item.props);
          geometries.push(fullGeometry || item.geometry);
        }
        return combinePolygonGeometries(geometries);
      }

      async function queryGroundwaterAreaSelection() {
        showGroundwaterContext();
        setGroundwaterPanelHtml('מחשב מי תהום לסימון...');
        showStatus('מחשב מי תהום לסימון', true);
        try {
          let geometry = null;
          let label = 'הסימון';
          if (groundwaterSelectedParcels.size) {
            geometry = await selectedParcelsGeometry();
            label = formatCount(groundwaterSelectedParcels.size) + ' חלקות';
          } else {
            geometry = drawPolygonGeometry();
            label = 'פוליגון מסומן';
          }
          if (!geometry) {
            setGroundwaterPanelHtml('אין סימון לחישוב. בחר חלקות או צייר פוליגון עם לפחות 3 נקודות.');
            showStatus('אין סימון לחישוב');
            return;
          }
          const center = geometryCenter(geometry);
          setGroundwaterMarker(center);
          const data = await fetchGroundwaterPolygon(geometry);
          renderGroundwaterPolygonResult(data, center);
          if (groundwaterPanelBody) {
            groundwaterPanelBody.insertAdjacentHTML('afterbegin',
              '<div class="groundwater-panel__context">תוצאה עבור ' + escapeHtml(label) + '</div>');
          }
          showStatus('בדיקת מי תהום לסימון הושלמה');
          postGeo3DUsage(groundwaterSelectedParcels.size ? 'groundwater_multi_parcel_polygon' : 'groundwater_drawn_polygon');
        } catch (error) {
          setGroundwaterPanelHtml(escapeHtml(error.message || 'שגיאה בבדיקת מי תהום לסימון.'));
          showStatus('שגיאה בבדיקת מי תהום לסימון');
        }
      }

      function clearGroundwaterResult() {
        if (groundwaterPopup) {
          groundwaterPopup.remove();
          groundwaterPopup = null;
        }
        groundwaterSelectedParcels.clear();
        groundwaterDrawPoints = [];
        updateGroundwaterAreaSource();
        updateGroundwaterDrawSource();
        const markerSource = map.getSource(GROUNDWATER_MARKER_SOURCE_ID);
        if (markerSource) {
          markerSource.setData({ type: 'FeatureCollection', features: [] });
        }
        if (groundwaterPanelBody) {
          delete groundwaterPanelBody.dataset.hasResult;
          setGroundwaterPanelHtml('לחץ על נקודה במפה כדי לחשב עומק מי תהום. האזור התכלת מציין כיסוי נתונים.');
        }
      }

      async function loadGroundwaterCoverage() {
        const source = map.getSource(GROUNDWATER_COVERAGE_SOURCE_ID);
        if (!source) return;
        try {
          const response = await fetch(GROUNDWATER_API + '/api/aquifers', { credentials: 'include' });
          if (!response.ok) return;
          const data = await response.json();
          const features = (data.aquifers || [])
            .filter((aquifer) => aquifer.extent_wgs84)
            .map((aquifer) => ({
              type: 'Feature',
              properties: { name: aquifer.display_name_he || aquifer.name || 'אקוויפר' },
              geometry: aquifer.extent_wgs84
            }));
          source.setData({ type: 'FeatureCollection', features });
        } catch (error) {}
      }

      async function queryGroundwaterPoint(lngLat) {
        if (!groundwaterEnabled) return false;
        clearGroundwaterResult();
        setGroundwaterPanelHtml('בודק עומק מי תהום...');
        showStatus('בודק מי תהום', true);
        setGroundwaterMarker(lngLat);
        try {
          const data = await fetchGroundwaterPoint(lngLat);
          renderGroundwaterResult(data, lngLat);
          showStatus('בדיקת מי תהום הושלמה');
          postGeo3DUsage('groundwater_point');
        } catch (error) {
          setGroundwaterPanelHtml(escapeHtml(error.message || 'לא ניתן להתחבר לשירות מי התהום כרגע.'));
          showStatus('שירות מי התהום לא זמין');
        }
        return true;
      }

      function clearParcelSelection() {
        if (parcelPopup) {
          const popup = parcelPopup;
          parcelPopup = null;
          popup.remove();
        }
        selectedParcel = null;
        setParcelHighlight(null);
        map.getCanvas().style.cursor = '';
      }

      function ownershipColorExpression() {
        return [
          'match',
          ['to-string', ['get', 'ownership_type']],
          'פרטית', '#00d1b2',
          'מדינה', '#ffb000',
          'רשות מקומית', '#b7f34a',
          'מעורב', '#ff4fa3',
          'אחר', '#a78bfa',
          'לא ידוע', '#6b7280',
          '#6b7280'
        ];
      }

      function updateLabelsVisibility() {
        const showLabels = labelsEnabled;
        LABEL_LAYER_IDS.forEach((layerId) => setLayerVisibility(layerId, showLabels));
      }

      function setBasemap(name) {
        basemap = name;
        setLayerVisibility('satellite', name === 'satellite');
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

        map.addSource(GROUNDWATER_COVERAGE_SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });

        map.addSource(GROUNDWATER_MARKER_SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });

        map.addSource(GROUNDWATER_AREA_SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });

        map.addSource(GROUNDWATER_DRAW_SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });

        map.addSource(PLANNING_SOURCES.blueLines, {
          type: 'vector',
          tiles: [PLANNING_API + '/api/planning/blue-lines/{z}/{x}/{y}.pbf'],
          minzoom: 7,
          maxzoom: 16
        });

        [PLANNING_SOURCES.landUse, PLANNING_SOURCES.groundwaterRisk, PLANNING_SOURCES.highlight].forEach((sourceId) => {
          map.addSource(sourceId, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
          });
        });

        map.addLayer({
          id: 'planning-blue-fill',
          type: 'fill',
          source: PLANNING_SOURCES.blueLines,
          'source-layer': 'blue_lines',
          layout: { visibility: 'none' },
          paint: {
            'fill-color': [
              'case',
              ['>=', ['index-of', 'אישור', ['coalesce', ['get', 'station_desc'], '']], 0],
              '#22c55e',
              ['>=', ['index-of', '77/78', ['coalesce', ['get', 'station_desc'], '']], 0],
              '#38bdf8',
              ['any',
                ['>=', ['index-of', 'הפקדה', ['coalesce', ['get', 'station_desc'], '']], 0],
                ['>=', ['index-of', 'בדיקה', ['coalesce', ['get', 'station_desc'], '']], 0]
              ],
              '#f59e0b',
              '#a78bfa'
            ],
            'fill-opacity': 0
          }
        });

        map.addLayer({
          id: 'planning-blue-line',
          type: 'line',
          source: PLANNING_SOURCES.blueLines,
          'source-layer': 'blue_lines',
          layout: { visibility: 'none' },
          paint: {
            'line-color': [
              'case',
              ['>=', ['index-of', 'אישור', ['coalesce', ['get', 'station_desc'], '']], 0],
              '#22c55e',
              ['>=', ['index-of', '77/78', ['coalesce', ['get', 'station_desc'], '']], 0],
              '#38bdf8',
              ['any',
                ['>=', ['index-of', 'הפקדה', ['coalesce', ['get', 'station_desc'], '']], 0],
                ['>=', ['index-of', 'בדיקה', ['coalesce', ['get', 'station_desc'], '']], 0]
              ],
              '#f59e0b',
              '#a78bfa'
            ],
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 16, 2],
            'line-opacity': 0.82
          }
        });

        map.addLayer({
          id: 'planning-landuse-fill',
          type: 'fill',
          source: PLANNING_SOURCES.landUse,
          minzoom: PRACTICAL_LAYER_ZOOM.planningLandUse,
          layout: { visibility: 'none' },
          paint: {
            'fill-color': [
              'case',
              ['>=', ['index-of', 'מגורים', ['coalesce', ['get', 'TYPE_NAME'], '']], 0],
              '#22c55e',
              ['>=', ['index-of', 'עירוני', ['coalesce', ['get', 'TYPE_NAME'], '']], 0],
              '#84cc16',
              ['>=', ['index-of', 'תעסוקה', ['coalesce', ['get', 'TYPE_NAME'], '']], 0],
              '#a855f7',
              ['>=', ['index-of', 'תעש', ['coalesce', ['get', 'TYPE_NAME'], '']], 0],
              '#f97316',
              ['>=', ['index-of', 'דרך', ['coalesce', ['get', 'TYPE_NAME'], '']], 0],
              '#facc15',
              ['>=', ['index-of', 'נחל', ['coalesce', ['get', 'TYPE_NAME'], '']], 0],
              '#38bdf8',
              '#f59e0b'
            ],
            'fill-opacity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              11, 0.12,
              14, 0.2,
              17, 0.28
            ]
          }
        });

        map.addLayer({
          id: 'planning-landuse-line',
          type: 'line',
          source: PLANNING_SOURCES.landUse,
          minzoom: PRACTICAL_LAYER_ZOOM.planningLandUse,
          layout: { visibility: 'none' },
          paint: {
            'line-color': '#fff7cc',
            'line-width': 1,
            'line-opacity': 0.72
          }
        });

        map.addLayer({
          id: 'planning-risk-fill',
          type: 'fill',
          source: PLANNING_SOURCES.groundwaterRisk,
          layout: { visibility: 'none' },
          paint: {
            'fill-color': '#ef4444',
            'fill-opacity': 0.22
          }
        });

        map.addLayer({
          id: 'planning-risk-line',
          type: 'line',
          source: PLANNING_SOURCES.groundwaterRisk,
          layout: { visibility: 'none' },
          paint: {
            'line-color': '#fecaca',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 16, 2.8],
            'line-opacity': 0.88
          }
        });

        map.addLayer({
          id: 'planning-highlight-fill',
          type: 'fill',
          source: PLANNING_SOURCES.highlight,
          paint: {
            'fill-color': '#fff200',
            'fill-opacity': 0.24
          }
        });

        map.addLayer({
          id: 'planning-highlight-halo',
          type: 'line',
          source: PLANNING_SOURCES.highlight,
          paint: {
            'line-color': 'rgba(8,10,12,0.9)',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 17, 8],
            'line-opacity': 0.86
          }
        });

        map.addLayer({
          id: 'planning-highlight-line',
          type: 'line',
          source: PLANNING_SOURCES.highlight,
          paint: {
            'line-color': '#fff200',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 17, 4],
            'line-opacity': 1
          }
        });

        map.addLayer({
          id: 'groundwater-coverage-fill',
          type: 'fill',
          source: GROUNDWATER_COVERAGE_SOURCE_ID,
          layout: { visibility: 'none' },
          paint: {
            'fill-color': '#2dd4bf',
            'fill-opacity': 0.16
          }
        });

        map.addLayer({
          id: 'groundwater-coverage-line',
          type: 'line',
          source: GROUNDWATER_COVERAGE_SOURCE_ID,
          layout: { visibility: 'none' },
          paint: {
            'line-color': '#67e8f9',
            'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.2, 15, 2.4],
            'line-opacity': 0.82
          }
        });

        map.addLayer({
          id: 'groundwater-area-fill',
          type: 'fill',
          source: GROUNDWATER_AREA_SOURCE_ID,
          layout: { visibility: 'none' },
          paint: {
            'fill-color': '#fff200',
            'fill-opacity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13, 0.24,
              16, 0.3,
              18, 0.36
            ]
          }
        });

        map.addLayer({
          id: 'groundwater-area-halo',
          type: 'line',
          source: GROUNDWATER_AREA_SOURCE_ID,
          layout: { visibility: 'none' },
          paint: {
            'line-color': 'rgba(8, 10, 12, 0.9)',
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13, 5.8,
              16, 7.4,
              18, 9
            ],
            'line-opacity': 0.78,
            'line-blur': 1.1
          }
        });

        map.addLayer({
          id: 'groundwater-area-line',
          type: 'line',
          source: GROUNDWATER_AREA_SOURCE_ID,
          layout: { visibility: 'none' },
          paint: {
            'line-color': '#fff200',
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13, 2.8,
              16, 4.2,
              18, 5.8
            ],
            'line-opacity': 0.98,
            'line-blur': 0.15
          }
        });

        map.addLayer({
          id: 'groundwater-draw-fill',
          type: 'fill',
          source: GROUNDWATER_DRAW_SOURCE_ID,
          filter: ['==', ['get', 'kind'], 'polygon'],
          layout: { visibility: 'none' },
          paint: {
            'fill-color': '#fff200',
            'fill-opacity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13, 0.24,
              16, 0.3,
              18, 0.36
            ]
          }
        });

        map.addLayer({
          id: 'groundwater-draw-halo',
          type: 'line',
          source: GROUNDWATER_DRAW_SOURCE_ID,
          filter: ['match', ['get', 'kind'], ['line', 'polygon'], true, false],
          layout: { visibility: 'none' },
          paint: {
            'line-color': 'rgba(8, 10, 12, 0.9)',
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13, 5.8,
              16, 7.4,
              18, 9
            ],
            'line-opacity': 0.78,
            'line-blur': 1.1
          }
        });

        map.addLayer({
          id: 'groundwater-draw-line',
          type: 'line',
          source: GROUNDWATER_DRAW_SOURCE_ID,
          filter: ['match', ['get', 'kind'], ['line', 'polygon'], true, false],
          layout: { visibility: 'none' },
          paint: {
            'line-color': '#fff200',
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13, 2.8,
              16, 4.2,
              18, 5.8
            ],
            'line-opacity': 0.98,
            'line-blur': 0.15
          }
        });

        map.addLayer({
          id: 'groundwater-draw-points',
          type: 'circle',
          source: GROUNDWATER_DRAW_SOURCE_ID,
          filter: ['!', ['has', 'kind']],
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': 5,
            'circle-color': '#fff200',
            'circle-stroke-color': 'rgba(8, 10, 12, 0.9)',
            'circle-stroke-width': 2.5
          }
        });

        map.addLayer({
          id: 'groundwater-marker',
          type: 'circle',
          source: GROUNDWATER_MARKER_SOURCE_ID,
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 17, 9],
            'circle-color': '#22d3ee',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
            'circle-opacity': 0.95
          }
        });

        map.addLayer({
          id: PARCEL_OWNERSHIP_LAYER_ID,
          type: 'fill',
          source: PARCEL_SOURCE_ID,
          'source-layer': PARCEL_SOURCE_LAYER,
          minzoom: PRACTICAL_LAYER_ZOOM.ownership,
          layout: { visibility: 'none' },
          paint: {
            'fill-color': ownershipColorExpression(),
            'fill-opacity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13, 0.52,
              16, 0.62,
              18, 0.68
            ],
            'fill-outline-color': 'rgba(255, 255, 255, 0)'
          }
        });

        map.addLayer({
          id: PARCEL_OWNERSHIP_LINE_LAYER_ID,
          type: 'line',
          source: PARCEL_SOURCE_ID,
          'source-layer': PARCEL_SOURCE_LAYER,
          minzoom: PRACTICAL_LAYER_ZOOM.ownership,
          layout: { visibility: 'none' },
          paint: {
            'line-color': ownershipColorExpression(),
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13, 0.55,
              16, 0.95,
              18, 1.35
            ],
            'line-opacity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13, 0.62,
              16, 0.82,
              18, 0.92
            ]
          }
        });

        map.addLayer({
          id: PARCEL_HIT_LAYER_ID,
          type: 'fill',
          source: PARCEL_SOURCE_ID,
          'source-layer': PARCEL_SOURCE_LAYER,
          minzoom: PRACTICAL_LAYER_ZOOM.parcels,
          layout: { visibility: 'none' },
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
          minzoom: PRACTICAL_LAYER_ZOOM.buildings,
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
            'fill-color': '#fff200',
            'fill-opacity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13, 0.24,
              16, 0.3,
              18, 0.36
            ]
          }
        });

        map.addLayer({
          id: 'parcel-highlight-halo',
          type: 'line',
          source: PARCEL_HIGHLIGHT_SOURCE_ID,
          paint: {
            'line-color': 'rgba(8, 10, 12, 0.9)',
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13, 5.8,
              16, 7.4,
              18, 9
            ],
            'line-opacity': 0.78,
            'line-blur': 1.1
          }
        });

        map.addLayer({
          id: 'parcel-highlight-line',
          type: 'line',
          source: PARCEL_HIGHLIGHT_SOURCE_ID,
          paint: {
            'line-color': '#fff200',
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13, 2.8,
              16, 4.2,
              18, 5.8
            ],
            'line-opacity': 0.98,
            'line-blur': 0.15
          }
        });

        map.addLayer({
          id: PARCEL_BOUNDARY_LAYER_ID,
          type: 'line',
          source: PARCEL_SOURCE_ID,
          'source-layer': PARCEL_SOURCE_LAYER,
          minzoom: PRACTICAL_LAYER_ZOOM.parcels,
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
              14, 1.15,
              17, 1.85,
              19, 2.45
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

        map.moveLayer(PARCEL_OWNERSHIP_LAYER_ID, PARCEL_BOUNDARY_LAYER_ID);
        map.moveLayer(PARCEL_OWNERSHIP_LINE_LAYER_ID, PARCEL_BOUNDARY_LAYER_ID);

        map.addLayer({
          id: 'ofm-neighborhood-labels',
          type: 'symbol',
          source: 'openFreeMapLabels',
          'source-layer': 'place',
          minzoom: 10,
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
          minzoom: 12,
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
          minzoom: 5,
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

        map.moveLayer('groundwater-marker');
        map.moveLayer('planning-highlight-fill');
        map.moveLayer('planning-highlight-halo');
        map.moveLayer('planning-highlight-line');
        syncTerrainState();
        updateLabelsVisibility();
        loadGroundwaterCoverage();
        setGroundwaterCoverageVisibility(groundwaterEnabled);
        updatePlanningLayerButtonStates();
        setPlanningVisibility(planningEnabled);

        showStatus('מוכן');
      });

      map.on('moveend', () => {
        if (planningEnabled) schedulePlanningLoad(180);
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

      if (groundwaterClear) {
        groundwaterClear.addEventListener('click', clearGroundwaterResult);
      }

      if (groundwaterSelectParcels) {
        groundwaterSelectParcels.addEventListener('click', () => setGroundwaterMode('parcels'));
      }

      if (groundwaterDrawPolygon) {
        groundwaterDrawPolygon.addEventListener('click', () => setGroundwaterMode('draw'));
      }

      if (groundwaterComputeSelection) {
        groundwaterComputeSelection.addEventListener('click', queryGroundwaterAreaSelection);
      }

      planningLayerButtons.forEach((button) => {
        button.addEventListener('click', () => {
          const key = button.dataset.planningLayer;
          planningLayerEnabled[key] = !planningLayerEnabled[key];
          if (planningLayerEnabled[key] && key === 'landUse') {
            zoomToPracticalMinimum('ייעודי קרקע', PRACTICAL_LAYER_ZOOM.planningLandUse);
          }
          updatePlanningLayerButtonStates();
          updatePlanningLayerVisibility();
          updatePlanningLegendsVisibility();
          if (planningEnabled) schedulePlanningLoad(80);
        });
      });

      document.addEventListener('click', (event) => {
        const button = event.target.closest('[data-parcel-groundwater]');
        if (!button) return;
        event.preventDefault();
        querySelectedParcelGroundwater();
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
            if (buildingsEnabled) zoomToPracticalMinimum('מבנים', PRACTICAL_LAYER_ZOOM.buildings);
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
            const didZoom = parcelsEnabled && zoomToPracticalMinimum('חלקות', PRACTICAL_LAYER_ZOOM.parcels);
            if (!parcelsEnabled) clearParcelSelection();
            if (!didZoom) showStatus(parcelsEnabled ? 'גבולות חלקות הוצגו' : 'גבולות חלקות הוסתרו');
          }

          if (target === 'ownership') {
            postGeo3DUsage(isOn ? 'ownership_on' : 'ownership_off');
            ownershipEnabled = isOn;
            setLayerGroupVisibility(OWNERSHIP_LAYER_IDS, ownershipEnabled);
            const didZoom = ownershipEnabled && zoomToPracticalMinimum('בעלות', PRACTICAL_LAYER_ZOOM.ownership);
            setOwnershipLegendVisibility(ownershipEnabled);
            if (!didZoom) showStatus(ownershipEnabled ? 'צביעת בעלויות הוצגה' : 'צביעת בעלויות הוסתרה');
          }

          if (target === 'groundwater') {
            postGeo3DUsage(isOn ? 'groundwater_on' : 'groundwater_off');
            groundwaterEnabled = isOn;
            setGroundwaterCoverageVisibility(groundwaterEnabled);
            if (!groundwaterEnabled) clearGroundwaterResult();
            showStatus(groundwaterEnabled ? 'מצב בדיקת מי תהום פעיל' : 'מצב בדיקת מי תהום כבוי');
          }

          if (target === 'planning') {
            postGeo3DUsage(isOn ? 'planning_on' : 'planning_off');
            planningEnabled = isOn;
            setPlanningVisibility(planningEnabled);
            showStatus(planningEnabled ? 'שכבות תכנון נטענות' : 'שכבות תכנון הוסתרו');
          }

        });
      });

      map.on('click', async (e) => {
        if (groundwaterAreaMode === 'parcels' && toggleGroundwaterParcelSelection(e)) return;
        if (groundwaterAreaMode === 'draw') {
          groundwaterDrawPoints.push(e.lngLat);
          updateGroundwaterDrawSource();
          const count = groundwaterDrawPoints.length;
          setGroundwaterPanelHtml(count < 3 ?
            ('נוספו ' + formatCount(count) + ' נקודות. צריך לפחות 3 נקודות לפוליגון.') :
            ('נוספו ' + formatCount(count) + ' נקודות. לחץ “חשב סימון” לחישוב מי תהום.'));
          showStatus('נקודה נוספה לפוליגון');
          return;
        }
        if (await identifyPlanningAt(e)) return;
        if (await queryGroundwaterPoint(e.lngLat)) return;
        identifyParcelAt(e);
      });

      map.on('mousemove', (e) => {
        if (groundwaterAreaMode === 'draw') {
          map.getCanvas().style.cursor = 'crosshair';
          return;
        }
        if (!parcelsEnabled) {
          map.getCanvas().style.cursor = '';
          return;
        }
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
