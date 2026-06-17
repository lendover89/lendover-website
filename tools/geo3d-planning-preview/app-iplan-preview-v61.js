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
      const planningStatusButtons = document.querySelectorAll('[data-planning-status]');
      const planningStatusLegend = document.getElementById('planningStatusLegend');
      const planningLandUseLegend = document.getElementById('planningLandUseLegend');
      const searchForm = document.getElementById('searchForm');
      const searchInput = document.getElementById('searchInput');
      const resetView = document.getElementById('resetView');
      const toggles = document.querySelectorAll('[data-layer-toggle]');
      const controlStrip = document.querySelector('.control-strip');
      const mobileLayersToggle = document.getElementById('mobileLayersToggle');
      const layerToggleGroup = document.getElementById('layerToggleGroup');

      const RTL_PLUGIN_URL = 'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.js';
      const GROUNDWATER_API = 'https://groundwater.lendover.co.il';
      const PLANNING_API = GROUNDWATER_API;
      const IPLAN_API = 'https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic';
      const GROUNDWATER_CONTAMINATION_URL = IPLAN_API + '/TAMA_1/MapServer/11/query';
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
        planningLandUse: 9,
        planningDetailed: 11
      };
      const PLANNING_SOURCES = {
        blueLines: 'planningBlueLines',
        landUse: 'planningLandUse',
        notice77: 'planningNotice77',
        tama1: 'planningTama1',
        transport: 'planningTransport',
        tama70: 'planningTama70',
        highlight: 'planningHighlight'
      };
      const PLANNING_LAYER_IDS = [
        'planning-blue-fill',
        'planning-blue-line',
        'planning-landuse-fill',
        'planning-landuse-line',
        'planning-77-fill',
        'planning-77-line',
        'planning-tama1-fill',
        'planning-tama1-line-halo',
        'planning-tama1-line',
        'planning-transport-fill',
        'planning-transport-rail-halo',
        'planning-transport-line',
        'planning-transport-point',
        'planning-tama70-fill',
        'planning-tama70-boundary',
        'planning-tama70-route-halo',
        'planning-tama70-line',
        'planning-tama70-stations'
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
            { url: IPLAN_API + '/compilation_tmm_tel_aviv/MapServer/7/query', bbox: [34.65, 31.92, 34.98, 32.28] },
            { url: IPLAN_API + '/compilation_tmm_merkaz/MapServer/12/query', bbox: [34.62, 31.72, 35.22, 32.48] },
            { url: IPLAN_API + '/compilation_tmm_haifa/MapServer/7/query', bbox: [34.82, 32.30, 35.35, 33.08] },
            { url: IPLAN_API + '/compilation_tmm_jerusalem/MapServer/6/query', bbox: [34.95, 31.48, 35.42, 32.12] },
            { url: IPLAN_API + '/compilation_tmm_darom/MapServer/8/query', bbox: [34.15, 29.42, 35.55, 31.95] },
            { url: IPLAN_API + '/compilation_tmm_tzafonn/MapServer/8/query', bbox: [35.00, 32.52, 35.95, 33.42] }
          ],
          outFields: 'PLAN_NAME,TYPE_NAME,AREA_dunam',
          minZoom: PRACTICAL_LAYER_ZOOM.planningLandUse
        },
        tama1: {
          title: 'תמ״א 1 - מגבלות וסביבה',
          source: PLANNING_SOURCES.tama1,
          urls: [
            IPLAN_API + '/TAMA_1/MapServer/11/query',
            IPLAN_API + '/TAMA_1/MapServer/34/query',
            IPLAN_API + '/TAMA_1/MapServer/35/query',
            IPLAN_API + '/TAMA_1/MapServer/38/query',
            IPLAN_API + '/TAMA_1/MapServer/39/query',
            IPLAN_API + '/TAMA_1/MapServer/51/query',
            IPLAN_API + '/TAMA_1/MapServer/72/query',
            IPLAN_API + '/TAMA_1/MapServer/73/query'
          ],
          outFields: '*',
          minZoom: PRACTICAL_LAYER_ZOOM.planningDetailed
        },
        transport: {
          title: 'תחבורה',
          source: PLANNING_SOURCES.transport,
          urls: [
            IPLAN_API + '/road_compilation/MapServer/2/query',
            IPLAN_API + '/road_compilation/MapServer/3/query',
            IPLAN_API + '/train_compilation/MapServer/0/query',
            IPLAN_API + '/Tama_35_1/MapServer/12/query',
            IPLAN_API + '/tmm_3_21/MapServer/16/query',
            IPLAN_API + '/tmm_2_9/MapServer/10/query'
          ],
          outFields: '*',
          minZoom: PRACTICAL_LAYER_ZOOM.planningDetailed
        },
        tama70: {
          title: 'תמ״א 70 / מטרו',
          source: PLANNING_SOURCES.tama70,
          urls: [
            IPLAN_API + '/tma_70/MapServer/2/query',
            IPLAN_API + '/tma_70/MapServer/3/query',
            IPLAN_API + '/tma_70/MapServer/4/query',
            IPLAN_API + '/tma_70/MapServer/6/query'
          ],
          outFields: '*',
          minZoom: PRACTICAL_LAYER_ZOOM.planningDetailed,
          noPagination: true
        }
      };
      const PLAN_LAND_USE_URLS = [
        IPLAN_API + '/Xplan/MapServer/4/query',
        IPLAN_API + '/Xplan_77_78/MapServer/4/query'
      ];
      const PLAN_LAND_USE_LAYER_URLS = PLAN_LAND_USE_URLS.map((url) => url.replace(/\/query$/, ''));
      const PLAN_LAND_USE_COLORS = [
        '#22c55e', '#84cc16', '#facc15', '#f97316', '#38bdf8',
        '#a855f7', '#ec4899', '#14b8a6', '#eab308', '#94a3b8'
      ];
      const DETAILED_PLANNING_COLORS = [
        '#22c55e', '#38bdf8', '#f59e0b', '#a855f7', '#ec4899',
        '#14b8a6', '#eab308', '#64748b', '#ef4444', '#84cc16'
      ];
      const DETAILED_PLANNING_LAYER_LABELS = {
        tama1: 'תמ״א 1',
        transport: 'תחבורה',
        tama70: 'תמ״א 70'
      };
      const DETAILED_PLANNING_FIXED_COLORS = {
        'שטחים פתוחים': '#34d399',
        'תשתיות': '#fb923c',
        'נחלים': '#22d3ee',
        'מוגנים': '#a3e635',
        'מים': '#60a5fa',
        'מים / הידרולוגיה': '#6366f1',
        'הצפות': '#facc15',
        'טבע / שימור': '#2dd4bf',
        'חוף': '#fbbf24',
        'תשתיות / דלק': '#e11d48',
        'זיהום מי תהום': '#f43f5e',
        'רגישות הידרולוגית · גבוהה מאוד': '#7c3aed',
        'רגישות הידרולוגית · גבוהה': '#2563eb',
        'רגישות הידרולוגית · בינונית': '#0891b2',
        'רגישות הידרולוגית · נמוכה': '#bae6fd',
        'רגישות הידרולוגית': '#0284c7',
        'פשט הצפה': '#38bdf8',
        'שטח הצפה': '#67e8f9',
        'יער טבעי': '#5eead4',
        'יער פארק': '#bef264',
        'יער נטע אדם': '#d946ef',
        'יער': '#10b981',
        'שמורת טבע': '#fde047',
        'גן לאומי': '#f97316',
        'קו סביבה חופית 300 מ׳': '#fef08a',
        'רצועת דלק': '#991b1b',
        'דרכים': '#f59e0b',
        'מסילות רכבת': '#b91c1c',
        'רצועות דרך': '#eab308',
        'דרך מהירה קיימת': '#dc2626',
        'דרך מהירה מוצעת': '#fb7185',
        'דרך ראשית קיימת': '#ea580c',
        'דרך ראשית מוצעת': '#fde68a',
        'דרך אזורית קיימת': '#22c55e',
        'דרך אזורית מוצעת': '#84cc16',
        'תכנית דרך מאושרת': '#8b5cf6',
        'תכנית דרך מוצעת': '#0ea5e9',
        'מפגש דרך-מסילה': '#c026d3',
        'מנהרה / מעבר תחתי': '#0f172a',
        'דרך לביטול': '#64748b',
        'מסילת רכבת מאושרת': '#6d28d9',
        'מסילת רכבת עם הוראות מעבר': '#1d4ed8',
        'תחנות רכבת': '#ffffff',
        'מרכז תחבורה': '#14b8a6',
        'מסופי גבול': '#ec4899',
        'תוואי מטרו · M1': '#00c2ff',
        'תוואי מטרו · M2': '#ff2d55',
        'תוואי מטרו · M3': '#ffd400',
        'תחנות מטרו': '#ff7a00',
        'מרחב ליבה': '#9333ea',
        'טבעת ראשונה': '#16a34a',
        'תחום חיפוש למעבר ציבורי': '#d97706',
        'גבול תמ״א 70': '#f8fafc'
      };
      const DEFAULT_LAND_USE_LEGEND_HTML = planningLandUseLegend ? planningLandUseLegend.innerHTML : '';
      let planLandUseStylePromise = null;

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
      let currentPlanningListFeatures = [];
      let currentPlanningListSelectedFeature = null;
      let activePlanLandUseNumber = '';
      const planningFeatureIndex = new Map();
      const detailedPlanningLegendByLayer = new Map();
      const detailedPlanningHiddenCategories = {
        tama1: new Set(),
        transport: new Set(),
        tama70: new Set()
      };
      const planningLandUseHiddenCategories = new Set();
      const selectedPlanLandUseHiddenCategories = new Set();
      const PLANNING_PAGE_SIZE = 1000;
      const PLANNING_MAX_FEATURES_PER_SOURCE = 6000;
      const planningLayerEnabled = {
        blueLines: false,
        landUse: false,
        notice77: false,
        tama1: false,
        transport: false,
        tama70: false
      };
      const planningStatusEnabled = {
        approved: true,
        deposit_review: true,
        notice_77_78: true,
        other: true
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

      function formatPlanningAreaSqm(value, unit) {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return '';
        const sqm = unit === 'dunam' ? n * 1000 : n;
        return Math.round(sqm).toLocaleString('he') + ' מ"ר';
      }

      function planningLandUseAreaSqm(props) {
        const shapeArea = Number(props.shape_area || props.Shape_Area || props.SHAPE_AREA);
        if (Number.isFinite(shapeArea) && shapeArea > 0) return shapeArea;
        const legalArea = Number(props.legal_area);
        if (!Number.isFinite(legalArea) || legalArea <= 0) return null;
        // iPlan is inconsistent: some plans store legal_area as sqm, others as dunam.
        return legalArea < 100 ? legalArea * 1000 : legalArea;
      }

      function formatRightsNumber(value, digits) {
        const n = Number(value);
        if (!Number.isFinite(n)) return '';
        return n.toLocaleString('he', {
          maximumFractionDigits: digits === undefined ? 2 : digits
        });
      }

      function normalizedCategoryKey(value) {
        return String(value || '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 80);
      }

      function planningMavatCode(feature) {
        const props = feature && feature.properties ? feature.properties : {};
        const raw = props.MAVAT_CODE ?? props.mavat_code ?? props.CODE ?? props.code;
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
      }

      function tama70Coordinates(feature) {
        const coords = [];
        collectGeometryCoordinates(feature && feature.geometry, coords);
        return coords.filter((coord) => Array.isArray(coord) && Number.isFinite(Number(coord[0])) && Number.isFinite(Number(coord[1])));
      }

      function tama70MetroLineLabel(feature) {
        const coords = tama70Coordinates(feature);
        if (coords.length < 2) return 'M1';
        const xs = coords.map((coord) => Number(coord[0]));
        const ys = coords.map((coord) => Number(coord[1]));
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const width = Math.max(0.00001, maxX - minX);
        const height = Math.max(0.00001, maxY - minY);
        const first = coords[0];
        const last = coords[coords.length - 1];
        const angle = Math.abs(Math.atan2(Number(last[1]) - Number(first[1]), Number(last[0]) - Number(first[0])) * 180 / Math.PI);
        const horizontal = angle < 28 || angle > 152 || width / height > 2.4;
        const vertical = height / width > 1.45 || (angle > 62 && angle < 118);
        if (horizontal) return 'M2';
        if (vertical) return 'M1';
        return 'M3';
      }

      function tama70PlanningCategory(feature) {
        const code = planningMavatCode(feature);
        const geomType = feature && feature.geometry && feature.geometry.type;
        if (geomType === 'Point' || geomType === 'MultiPoint') {
          return code === 6023 ? 'תחנות מטרו' : '';
        }
        if (geomType === 'LineString' || geomType === 'MultiLineString') {
          return code === 6019 ? 'תוואי מטרו · ' + tama70MetroLineLabel(feature) : '';
        }
        if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
          if (code === 6012) return 'מרחב ליבה';
          if (code === 6011) return 'טבעת ראשונה';
          if (code === 6020) return 'תחום חיפוש למעבר ציבורי';
          if (code === 20010) return 'גבול תמ״א 70';
        }
        return '';
      }

      function transportText(feature) {
        const props = feature && feature.properties ? feature.properties : {};
        return normalizedCategoryKey([
          props.TypeRoadtx, props.TypeRoad_1, props.Type_Road1, props.Yeud1, props.Yeud,
          props.Ground_TY, props.Tochnit_Ty, props.Tochnit_Nu, props.Tochnit_Na,
          props.Tochnit__1, props.Related, props.Status, props.STATUS, props.ASSET_NAME,
          props.LOCAL_C, props.TYPE_NAME, props.TYPENAME, props.NAME, props.SOURCE
        ].filter(Boolean).join(' '));
      }

      function transportPlanningCategory(feature) {
        const props = feature && feature.properties ? feature.properties : {};
        const geomType = feature && feature.geometry && feature.geometry.type;
        const relevance = String(props.Relevance ?? props.relevance ?? '').trim();
        if (relevance === '2') return '';
        const text = transportText(feature);
        const status = normalizedCategoryKey(props.Status || props.STATUS || '');
        if (geomType === 'Point' || geomType === 'MultiPoint') {
          if (text.includes('מסוף גבול')) return 'מסופי גבול';
          if (text.includes('מרכז תחבורה')) return 'מרכז תחבורה';
          if (props.ASSET_NAME || text.includes('תחנת רכבת') || text.includes('רכבת')) return 'תחנות רכבת';
          return '';
        }
        if (text.includes('מרכז תחבורה')) return 'מרכז תחבורה';
        if (text.includes('מסוף גבול')) return 'מסופי גבול';
        if (Number(props.Type_Code) === 551 || text.includes('רכבת') || text.includes('מסיל')) {
          return status.includes('הוראות מעבר') ? 'מסילת רכבת עם הוראות מעבר' : 'מסילת רכבת מאושרת';
        }
        if (text.includes('לביטול')) return 'דרך לביטול';
        if (text.includes('מנהרה') || text.includes('מעבר תחתי')) return 'מנהרה / מעבר תחתי';
        if (text.includes('מפגש דרך מסילה')) return 'מפגש דרך-מסילה';
        if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
          if (text.includes('בהליכי תכנון') || text.includes('מוצעת') || text.includes('הרחבת')) return 'תכנית דרך מוצעת';
          return 'תכנית דרך מאושרת';
        }
        if (text.includes('מהירה') && text.includes('מוצעת')) return 'דרך מהירה מוצעת';
        if (text.includes('מהירה')) return 'דרך מהירה קיימת';
        if (text.includes('ראשית') && text.includes('מוצעת')) return 'דרך ראשית מוצעת';
        if (text.includes('ראשית')) return 'דרך ראשית קיימת';
        if (text.includes('אזורית') && text.includes('מוצעת')) return 'דרך אזורית מוצעת';
        if (text.includes('אזורית')) return 'דרך אזורית קיימת';
        return geomType === 'LineString' || geomType === 'MultiLineString' ? 'דרך ראשית קיימת' : 'תכנית דרך מאושרת';
      }

      function tama1PlanningCategory(feature) {
        const props = feature && feature.properties ? feature.properties : {};
        const text = normalizedCategoryKey([
          props.Layer_Name, props.layer_name, props.MAVAT_NAME, props.mavat_name,
          props.TYPE_NAME, props.type_name, props.PL_NAME, props.pl_name,
          props.stage, props.STAGE, props.MIRKAM, props.SVIVA, props.NAME, props.Name, props.LABEL
        ].filter(Boolean).join(' '));
        if (!text) return '';
        if (text.includes('דלק')) return 'רצועת דלק';
        if (text.includes('חופ') || text.includes('300 מטר')) return 'קו סביבה חופית 300 מ׳';
        if (text.includes('פשט הצפה')) return 'פשט הצפה';
        if (text.includes('שטח הצפה') || text.includes('אזור הצפה') || text.includes('איזור הצפה')) return 'שטח הצפה';
        if (text.includes('זיהום') || text.includes('חשוד') || text.includes('תהום')) return 'זיהום מי תהום';
        if (text.includes('רגישות') || text.includes('הידרולוג')) {
          if (text.includes('גבוהה מאוד')) return 'רגישות הידרולוגית · גבוהה מאוד';
          if (text.includes('גבוהה')) return 'רגישות הידרולוגית · גבוהה';
          if (text.includes('בינונית')) return 'רגישות הידרולוגית · בינונית';
          if (text.includes('נמוכה')) return 'רגישות הידרולוגית · נמוכה';
          return 'רגישות הידרולוגית';
        }
        if (text.includes('יער טבעי')) return 'יער טבעי';
        if (text.includes('יער פארק')) return 'יער פארק';
        if (text.includes('יער נטע אדם')) return 'יער נטע אדם';
        if (text.includes('שמורת טבע')) return 'שמורת טבע';
        if (text.includes('גן לאומי')) return 'גן לאומי';
        if (text.includes('יער')) return 'יער';
        if (text.includes('שמורה') || text.includes('מוגנ') || text.includes('שמור')) return 'שמורת טבע';
        return '';
      }

      function planningDetailedCategoryLabel(feature, key) {
        const props = feature && feature.properties ? feature.properties : {};
        const geomType = feature && feature.geometry && feature.geometry.type;
        const name = props.MAVAT_NAME || props.mavat_name || props.TYPE_NAME || props.type_name ||
          props.Layer_Name || props.Yeud || props.TypeRoadtx || props.Type_Road ||
          props.Type_Road1 || props.TypeRoad_1 || props.Ground_TY || props.STAGE || props.stage;
        if (key === 'tama1') {
          return tama1PlanningCategory(feature) || '';
        }
        if (key === 'transport') {
          return transportPlanningCategory(feature) || 'תחבורה';
        }
        if (key === 'tama70') {
          return tama70PlanningCategory(feature) || 'תמ״א 70';
        }
        return normalizedCategoryKey(name || 'אחר');
      }

      function planningCategoryColor(label) {
        if (DETAILED_PLANNING_FIXED_COLORS[label]) return DETAILED_PLANNING_FIXED_COLORS[label];
        let hash = 0;
        const value = String(label || '');
        for (let i = 0; i < value.length; i += 1) {
          hash = ((hash << 5) - hash) + value.charCodeAt(i);
          hash |= 0;
        }
        return DETAILED_PLANNING_COLORS[Math.abs(hash) % DETAILED_PLANNING_COLORS.length];
      }

      function isDrawablePlanningGeometry(feature, key) {
        const type = feature && feature.geometry && feature.geometry.type;
        if (!['tama1', 'transport', 'tama70'].includes(key)) return true;
        if (key === 'tama1') return !!tama1PlanningCategory(feature) && type !== 'Point' && type !== 'MultiPoint';
        if (key === 'transport') return !!transportPlanningCategory(feature);
        if (key === 'tama70') return !!tama70PlanningCategory(feature);
        return type !== 'Point' && type !== 'MultiPoint';
      }

      function enrichDetailedPlanningFeature(feature, key) {
        const label = planningDetailedCategoryLabel(feature, key);
        return {
          planning_category_key: label,
          planning_category_label: label,
          planning_category_color: planningCategoryColor(label)
        };
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

      function arcgisPolygonGeometry(geometry) {
        if (!geometry) return null;
        const rings = [];
        if (geometry.type === 'Polygon') {
          geometry.coordinates.forEach((ring) => rings.push(ring));
        } else if (geometry.type === 'MultiPolygon') {
          geometry.coordinates.forEach((polygon) => polygon.forEach((ring) => rings.push(ring)));
        }
        if (!rings.length) return null;
        return { rings, spatialReference: { wkid: 4326 } };
      }

      function groundwaterContaminationLabel(feature) {
        const props = (feature && feature.properties) || {};
        return props.NAME || props.LABEL || props.PL_NAME || props.PL_NUMBER || 'אזור חשוד בזיהום מי תהום';
      }

      function groundwaterContaminationSummary(contamination) {
        if (!contamination || contamination.status === 'unknown') {
          return contamination && contamination.message ? contamination.message : 'לא התקבלה אינדיקציית זיהום מהשכבה התכנונית.';
        }
        if (contamination.status === 'found') {
          const labels = (contamination.matches || []).map(groundwaterContaminationLabel).filter(Boolean);
          return labels.length ? ('יש אינדיקציה: ' + labels.slice(0, 3).join(', ')) : 'יש אינדיקציה לזיהום מי תהום.';
        }
        return 'לא נמצאה אינדיקציה לזיהום מי תהום בשכבת תמ״א 1.';
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
        const contaminationRow = ['אינדיקציית זיהום', groundwaterContaminationSummary(result.contamination)];
        if (result.coverage === 'none' || result.mean == null) {
          return '<div class="parcel-groundwater-result"><strong>מי תהום</strong>' +
            '<span>' + escapeHtml(result.message || 'אין נתונים זמינים בשטח החלקה.') + '</span>' +
            '<table><tr><th>' + escapeHtml(contaminationRow[0]) + '</th><td>' + escapeHtml(contaminationRow[1]) + '</td></tr></table></div>';
        }
        const rows = [
          ['מינימום', formatMeters(result.min, 1)],
          ['ממוצע', formatMeters(result.mean, 1)],
          ['מקסימום', formatMeters(result.max, 1)],
          ['אקוויפר', result.aquiferDisplay || result.aquifer || '—'],
          contaminationRow
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

      function rememberPlanningList(features, selectedFeature) {
        currentPlanningListFeatures = Array.isArray(features) ? features : [];
        currentPlanningListSelectedFeature = selectedFeature || null;
      }

      function restorePlanningListIfAvailable() {
        if (!currentPlanningListFeatures.length) return false;
        setPlanningPanelHtml(planningFeatureListHtml(currentPlanningListFeatures, currentPlanningListSelectedFeature));
        return true;
      }

      function hasPlanningPanelContext() {
        return !!selectedPlanningFeature || currentPlanningListFeatures.length > 0 || !!activePlanLandUseNumber;
      }

      function setPlanningDetailHtml(html) {
        if (!planningPanelBody) return;
        let detail = planningPanelBody.querySelector('[data-planning-selected-detail]');
        if (!detail) {
          if (!restorePlanningListIfAvailable()) {
            setPlanningPanelHtml('<div data-planning-selected-detail></div>');
          }
          detail = planningPanelBody.querySelector('[data-planning-selected-detail]');
        }
        if (detail) detail.innerHTML = html;
      }

      function setPlanningLegendVisibility(element, isVisible) {
        if (!element) return;
        element.classList.toggle('is-visible', isVisible);
        element.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
      }

      function updatePlanningLegendsVisibility() {
        setPlanningLegendVisibility(planningStatusLegend, planningEnabled && planningLayerEnabled.blueLines);
        const hasDetailedLegendItems = ['tama1', 'transport', 'tama70'].some((key) => (
          planningLayerEnabled[key] && (detailedPlanningLegendByLayer.get(key) || []).length
        ));
        setPlanningLegendVisibility(planningLandUseLegend, planningEnabled && (planningLayerEnabled.landUse || planningLayerEnabled.notice77 || hasDetailedLegendItems));
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
        updatePlanningLayerVisibility();
        if (isVisible) {
          if (hasPlanningLayersEnabled()) {
            if (!hasPlanningPanelContext()) setPlanningPanelHtml('');
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
          currentPlanningListFeatures = [];
          currentPlanningListSelectedFeature = null;
          activePlanLandUseNumber = '';
          setPlanningHighlight(null);
          setPlanningPanelHtml('');
          if (planningLandUseLegend) planningLandUseLegend.innerHTML = DEFAULT_LAND_USE_LEGEND_HTML;
          updatePlanningLegendsVisibility();
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

      function updatePlanningStatusButtonStates() {
        planningStatusButtons.forEach((button) => {
          const key = button.dataset.planningStatus;
          const isOn = !!planningStatusEnabled[key];
          button.classList.toggle('is-on', isOn);
          button.setAttribute('aria-pressed', isOn ? 'true' : 'false');
        });
      }

      function activePlanningStatusGroups() {
        return Object.keys(planningStatusEnabled).filter((key) => planningStatusEnabled[key]);
      }

      function planningStatusFilterExpression() {
        const active = activePlanningStatusGroups();
        return active.length ? ['match', ['get', 'status_group'], active, true, false] : ['==', ['get', 'status_group'], '__none__'];
      }

      function applyPlanningStatusFilter() {
        const filter = planningStatusFilterExpression();
        ['planning-blue-fill', 'planning-blue-line'].forEach((layerId) => {
          if (map.getLayer(layerId)) map.setFilter(layerId, filter);
        });
        const selectedStatus = selectedPlanningFeature && selectedPlanningFeature.properties && selectedPlanningFeature.properties.status_group;
        if (selectedStatus && !planningStatusEnabled[selectedStatus]) {
          selectedPlanningFeature = null;
          setPlanningHighlight(null);
        }
      }

      function planningLayerIdKey(layerId) {
        if (layerId.includes('landuse')) return 'landUse';
        if (layerId.includes('77')) return 'notice77';
        if (layerId.includes('tama1')) return 'tama1';
        if (layerId.includes('transport')) return 'transport';
        if (layerId.includes('tama70')) return 'tama70';
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
        currentPlanningListFeatures = [];
        currentPlanningListSelectedFeature = null;
        activePlanLandUseNumber = '';
        detailedPlanningLegendByLayer.clear();
        Object.values(detailedPlanningHiddenCategories).forEach((set) => set.clear());
        if (planningLandUseLegend) planningLandUseLegend.innerHTML = DEFAULT_LAND_USE_LEGEND_HTML;
        updatePlanningLegendsVisibility();
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
          f: 'geojson'
        });
        if (!config.noPagination) {
          params.set('resultRecordCount', String(count || PLANNING_PAGE_SIZE));
          params.set('resultOffset', String(offset || 0));
        }
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
          f: 'geojson'
        });
        if (!config.noPagination) {
          params.set('resultRecordCount', String(count || PLANNING_PAGE_SIZE));
          params.set('resultOffset', String(offset || 0));
        }
        return url + '?' + params.toString();
      }

      function planningBoundsIntersects(bounds, bbox) {
        if (!bbox) return true;
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        return !(ne.lng < bbox[0] || sw.lng > bbox[2] || ne.lat < bbox[1] || sw.lat > bbox[3]);
      }

      function planningConfigUrls(config, bounds) {
        const items = config.urls || [config.url];
        const filtered = items
          .map((item) => typeof item === 'string' ? { url: item } : item)
          .filter((item) => item && item.url && planningBoundsIntersects(bounds, item.bbox));
        return (filtered.length ? filtered : items.map((item) => typeof item === 'string' ? { url: item } : item))
          .map((item) => item.url);
      }

      function planningSqlString(value) {
        return String(value || '').replace(/'/g, "''");
      }

      function planLandUseQueryUrl(url, planNumber, count, offset) {
        const params = new URLSearchParams({
          where: "pl_number='" + planningSqlString(planNumber) + "'",
          outFields: '*',
          returnGeometry: 'true',
          outSR: '4326',
          f: 'geojson',
          resultRecordCount: String(count || 250),
          resultOffset: String(offset || 0)
        });
        return url + '?' + params.toString();
      }

      async function fetchPlanLandUseFromUrl(url, planNumber) {
        const features = [];
        let offset = 0;
        const pageSize = 250;
        const maxFeatures = 1250;
        while (features.length < maxFeatures) {
          const response = await fetch(planLandUseQueryUrl(url, planNumber, pageSize, offset), {
            credentials: 'include'
          });
          if (!response.ok) throw new Error('ייעודי הקרקע של התכנית לא נטענו.');
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

      function esriColorToCss(color) {
        if (!Array.isArray(color) || color.length < 3) return null;
        const alpha = color.length > 3 ? Math.max(0, Math.min(1, color[3] / 255)) : 1;
        return 'rgba(' + [color[0], color[1], color[2]].map((value) => Math.max(0, Math.min(255, Number(value) || 0))).join(',') + ',' + alpha.toFixed(3) + ')';
      }

      async function loadPlanLandUseStyleCatalog() {
        if (!planLandUseStylePromise) {
          planLandUseStylePromise = Promise.allSettled(PLAN_LAND_USE_LAYER_URLS.map((url) => (
            fetch(url + '?f=pjson', { credentials: 'include' }).then((response) => {
              if (!response.ok) throw new Error('style metadata failed');
              return response.json();
            })
          ))).then((settled) => {
            const byCode = {};
            settled
              .filter((part) => part.status === 'fulfilled')
              .forEach((part) => {
                const infos = part.value?.drawingInfo?.renderer?.uniqueValueInfos || [];
                infos.forEach((info) => {
                  const code = String(info.value ?? '').trim();
                  if (!code || byCode[code]) return;
                  byCode[code] = {
                    label: info.label || ('קוד מבא"ת ' + code),
                    color: esriColorToCss(info.symbol && info.symbol.color) || PLAN_LAND_USE_COLORS[Object.keys(byCode).length % PLAN_LAND_USE_COLORS.length]
                  };
                });
              });
            return byCode;
          }).catch(() => ({}));
        }
        return planLandUseStylePromise;
      }

      function planLandUseKey(feature) {
        const props = feature && feature.properties ? feature.properties : {};
        const code = props.mavat_code ?? props.MAVAT_CODE ?? props.code;
        if (code !== undefined && code !== null && String(code).trim() !== '') return String(code).trim();
        return planLandUseType(feature);
      }

      function planLandUseType(feature, catalog) {
        const props = feature && feature.properties ? feature.properties : {};
        const code = props.mavat_code ?? props.MAVAT_CODE ?? props.code;
        const key = code !== undefined && code !== null ? String(code).trim() : '';
        const catalogLabel = key && catalog && catalog[key] && catalog[key].label;
        const baseLabel = catalogLabel || props.mavat_name || props.TYPE_NAME || props.type_name || props.LABEL || props.NAME || 'ייעוד לא ידוע';
        return key ? baseLabel + ' (' + key + ')' : baseLabel;
      }

      function planLandUseKeyExpression() {
        return ['coalesce',
          ['get', 'planning_landuse_key'],
          ['to-string', ['get', 'mavat_code']],
          ['to-string', ['get', 'MAVAT_CODE']],
          ['get', 'TYPE_NAME'],
          ['get', 'mavat_name'],
          ['get', 'type_name'],
          ['get', 'LABEL'],
          ['get', 'NAME'],
          'ייעוד לא ידוע'
        ];
      }

      function collectGeometryCoordinates(geometry, output) {
        if (!geometry || !Array.isArray(output)) return;
        if (geometry.type === 'Point') {
          output.push(geometry.coordinates);
          return;
        }
        const walk = (items) => {
          (items || []).forEach((item) => {
            if (Array.isArray(item) && typeof item[0] === 'number' && typeof item[1] === 'number') {
              output.push(item);
            } else if (Array.isArray(item)) {
              walk(item);
            }
          });
        };
        walk(geometry.coordinates);
      }

      function planLandUseColorExpression(items) {
        const expression = ['match', planLandUseKeyExpression()];
        (items || []).forEach((item, index) => {
          expression.push(item.key, item.color || PLAN_LAND_USE_COLORS[index % PLAN_LAND_USE_COLORS.length]);
        });
        expression.push('#94a3b8');
        return expression;
      }

      function planningLandUseTypeExpression() {
        const typeName = ['coalesce',
          ['get', 'TYPE_NAME'],
          ['get', 'type_name'],
          ['get', 'mavat_name'],
          ['get', 'MAVAT_NAME'],
          ['get', 'LABEL'],
          ['get', 'NAME'],
          ''
        ];
        return ['case',
          ['>=', ['index-of', 'מגורים', typeName], 0], 'מגורים',
          ['>=', ['index-of', 'עירוני', typeName], 0], 'עירוני',
          ['>=', ['index-of', 'תעסוקה', typeName], 0], 'תעסוקה',
          ['>=', ['index-of', 'תעש', typeName], 0], 'תעשייה',
          ['>=', ['index-of', 'דרך', typeName], 0], 'דרך',
          ['>=', ['index-of', 'נחל', typeName], 0], 'נחל / מים',
          ['>=', ['index-of', 'מים', typeName], 0], 'נחל / מים',
          'אחר'
        ];
      }

      function setDefaultPlanningLandUseLegend() {
        if (!planningLandUseLegend) return;
        const items = [
          { key: 'מגורים', label: 'מגורים', color: '#22c55e' },
          { key: 'עירוני', label: 'עירוני', color: '#84cc16' },
          { key: 'תעסוקה', label: 'תעסוקה', color: '#a855f7' },
          { key: 'תעשייה', label: 'תעשייה', color: '#f97316' },
          { key: 'דרך', label: 'דרך', color: '#facc15' },
          { key: 'נחל / מים', label: 'נחל / מים', color: '#38bdf8' },
          { key: 'אחר', label: 'אחר', color: '#f59e0b' }
        ];
        planningLandUseLegend.innerHTML = '<div class="planning-legend__title">ייעודי קרקע</div>' +
          items.map((item) => (
            '<button class="planning-legend__item' + (planningLandUseHiddenCategories.has(item.key) ? '' : ' is-on') +
            '" type="button" data-planning-landuse-category="' + escapeHtml(item.key) + '">' +
            '<span style="--legend-color:' + escapeHtml(item.color) + '"></span>' + escapeHtml(item.label) + '</button>'
          )).join('');
      }

      function applyPlanningLandUseCategoryFilter() {
        const hidden = Array.from(planningLandUseHiddenCategories);
        const filter = hidden.length ? ['match', planningLandUseTypeExpression(), hidden, false, true] : null;
        ['planning-landuse-fill', 'planning-landuse-line'].forEach((layerId) => {
          if (map.getLayer(layerId)) map.setFilter(layerId, filter);
        });
      }

      function applySelectedPlanLandUseCategoryFilter() {
        const hidden = Array.from(selectedPlanLandUseHiddenCategories);
        const filter = hidden.length ? ['match', planLandUseKeyExpression(), hidden, false, true] : null;
        ['planning-77-fill', 'planning-77-line'].forEach((layerId) => {
          if (map.getLayer(layerId)) map.setFilter(layerId, filter);
        });
      }

      function setPlanLandUseLegend(items, planNumber) {
        if (!planningLandUseLegend) return;
        if (!items || !items.length) {
          planningLandUseLegend.innerHTML = DEFAULT_LAND_USE_LEGEND_HTML;
          return;
        }
        planningLandUseLegend.innerHTML = '<div class="planning-legend__title">ייעודי קרקע תכנית ' + escapeHtml(planNumber) + '</div>' +
          items.map((item, index) => (
            '<button class="planning-legend__item' + (selectedPlanLandUseHiddenCategories.has(item.key) ? '' : ' is-on') +
            '" type="button" data-selected-plan-landuse-key="' + escapeHtml(item.key) + '"><span style="--legend-color:' +
            escapeHtml(item.color || PLAN_LAND_USE_COLORS[index % PLAN_LAND_USE_COLORS.length]) +
            '"></span>' + escapeHtml(item.label) + '</button>'
          )).join('');
      }

      function setDetailedPlanningLegend() {
        if (!planningLandUseLegend || activePlanLandUseNumber) return;
        const items = [];
        ['tama1', 'transport', 'tama70'].forEach((key) => {
          if (!planningLayerEnabled[key]) return;
          const layerItems = detailedPlanningLegendByLayer.get(key) || [];
          layerItems.forEach((item) => {
            const isHidden = !!(detailedPlanningHiddenCategories[key] && detailedPlanningHiddenCategories[key].has(item.categoryKey || item.label));
            items.push({
              ...item,
              categoryKey: item.categoryKey || item.label,
              isHidden,
              layerKey: key,
              label: DETAILED_PLANNING_LAYER_LABELS[key] + ' · ' + item.label
            });
          });
        });
        if (!items.length) {
          if (planningLayerEnabled.landUse) {
            setDefaultPlanningLandUseLegend();
          } else {
            planningLandUseLegend.innerHTML = DEFAULT_LAND_USE_LEGEND_HTML;
          }
          updatePlanningLegendsVisibility();
          return;
        }
        planningLandUseLegend.innerHTML = '<div class="planning-legend__title">קטגוריות שכבות תכנון</div>' +
          items.map((item) => {
            const content = '<span style="--legend-color:' + escapeHtml(item.color) + '"></span>' + escapeHtml(item.label);
            if (!detailedPlanningHiddenCategories[item.layerKey]) {
              return '<div class="planning-legend__item">' + content + '</div>';
            }
            return '<button class="planning-legend__item' + (item.isHidden ? '' : ' is-on') + '" type="button" data-planning-category-layer="' +
              escapeHtml(item.layerKey) + '" data-planning-category-key="' + escapeHtml(item.categoryKey) + '">' + content + '</button>';
          }).join('');
        updatePlanningLegendsVisibility();
      }

      function rememberDetailedPlanningLegend(key, features) {
        if (!['tama1', 'transport', 'tama70'].includes(key)) return;
        const itemsByLabel = new Map(detailedPlanningLegendByLayer.get(key)?.map((item) => [item.categoryKey || item.label, item]) || []);
        (features || []).forEach((feature) => {
          const props = feature.properties || {};
          const label = props.planning_category_label;
          if (!label || itemsByLabel.has(label)) return;
          itemsByLabel.set(label, {
            categoryKey: props.planning_category_key || label,
            label,
            color: props.planning_category_color || planningCategoryColor(label)
          });
        });
        detailedPlanningLegendByLayer.set(key, Array.from(itemsByLabel.values()).sort((a, b) => a.label.localeCompare(b.label, 'he')));
        setDetailedPlanningLegend();
      }

      function detailedPlanningCategoryFilter(key) {
        const hidden = detailedPlanningHiddenCategories[key];
        return hidden && hidden.size ? ['match', ['get', 'planning_category_key'], Array.from(hidden), false, true] : null;
      }

      function applyDetailedPlanningCategoryFilters(key) {
        const targets = {
          tama1: ['planning-tama1-fill', 'planning-tama1-line-halo', 'planning-tama1-line'],
          transport: ['planning-transport-fill', 'planning-transport-rail-halo', 'planning-transport-line', 'planning-transport-point'],
          tama70: ['planning-tama70-fill', 'planning-tama70-boundary', 'planning-tama70-route-halo', 'planning-tama70-line', 'planning-tama70-stations']
        }[key] || [];
        const categoryFilter = detailedPlanningCategoryFilter(key);
        targets.forEach((layerId) => {
          if (!map.getLayer(layerId)) return;
          const filters = [];
          if (layerId.includes('stations')) {
            filters.push(['==', ['get', 'planning_category_key'], 'תחנות מטרו']);
          } else if (layerId.includes('transport-fill')) {
            filters.push(['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]);
          } else if (layerId.includes('rail-halo')) {
            filters.push(['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false]);
            filters.push(['match', ['get', 'planning_category_key'], ['מסילת רכבת מאושרת', 'מסילת רכבת עם הוראות מעבר'], true, false]);
          } else if (layerId.includes('transport-line')) {
            filters.push(['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false]);
          } else if (layerId.includes('transport-point')) {
            filters.push(['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]);
          } else if (layerId.includes('boundary')) {
            filters.push(['==', ['get', 'planning_category_key'], 'גבול תמ״א 70']);
          } else if (layerId.includes('route')) {
            filters.push(['match', ['get', 'planning_category_key'], ['תוואי מטרו · M1', 'תוואי מטרו · M2', 'תוואי מטרו · M3'], true, false]);
          } else if (layerId.includes('tama70-fill')) {
            filters.push(['match', ['get', 'planning_category_key'], ['מרחב ליבה', 'טבעת ראשונה', 'תחום חיפוש למעבר ציבורי'], true, false]);
          }
          if (categoryFilter) filters.push(categoryFilter);
          map.setFilter(layerId, filters.length ? ['all', ...filters] : null);
        });
      }

      function clearSelectedPlanLandUse() {
        const source = map.getSource(PLANNING_SOURCES.notice77);
        if (source && typeof source.setData === 'function') {
          source.setData({ type: 'FeatureCollection', features: [] });
        }
        selectedPlanLandUseHiddenCategories.clear();
        activePlanLandUseNumber = '';
        planningLayerEnabled.notice77 = false;
        updatePlanningLayerVisibility();
        if (planningLandUseLegend) setDetailedPlanningLegend();
        updatePlanningLegendsVisibility();
      }

      async function fetchPlanningFeatures(config, url, bounds, seq, pageSize) {
        const features = [];
        let offset = 0;
        const maxFeatures = config.maxFeatures || PLANNING_MAX_FEATURES_PER_SOURCE;
        while (features.length < maxFeatures) {
          if (seq !== planningLoadSeq || !planningEnabled) return null;
          const response = await fetch(planningQueryUrlFor(config, url, bounds, pageSize, offset), {
            credentials: 'include'
          });
          if (!response.ok) throw new Error(config.title + ' לא נטענה.');
          const data = await response.json();
          const pageFeatures = Array.isArray(data.features) ? data.features : [];
          features.push(...pageFeatures);
          if (config.noPagination) {
            return { features, exceeded: !!data.exceededTransferLimit };
          }
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
          detailedPlanningLegendByLayer.delete(key);
          setDetailedPlanningLegend();
          return { key, count: 0, skipped: !planningLayerEnabled[key] };
        }
        if (config.minZoom && map.getZoom() < config.minZoom) {
          source.setData({ type: 'FeatureCollection', features: [] });
          clearPlanningFeatureIndexForLayer(key);
          detailedPlanningLegendByLayer.delete(key);
          setDetailedPlanningLegend();
          return { key, count: 0, skipped: true, reason: 'zoom' };
        }

        const bounds = map.getBounds();
        const urls = planningConfigUrls(config, bounds);
        const pageSize = config.pageSize || (config.urls ? 500 : PLANNING_PAGE_SIZE);
        const partsSettled = await Promise.allSettled(urls.map(async (url) => {
          return fetchPlanningFeatures(config, url, bounds, seq, pageSize);
        }));
        if (seq !== planningLoadSeq) return { key, count: 0, skipped: true };
        const parts = partsSettled
          .filter((part) => part.status === 'fulfilled')
          .map((part) => part.value);
        if (!parts.length) throw new Error(config.title + ' לא נטענה.');
        const features = dedupeDetailedPlanningFeatures(key, parts.flatMap((data) => data && Array.isArray(data.features) ? data.features : [])
          .filter((feature) => isDrawablePlanningGeometry(feature, key)));
        clearPlanningFeatureIndexForLayer(key);
        const enrichedFeatures = features.map((feature) => ({
          ...feature,
          properties: {
            ...(feature.properties || {}),
            planning_layer: key,
            planning_title: config.title,
            ...enrichDetailedPlanningFeature(feature, key)
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
        rememberDetailedPlanningLegend(key, enrichedFeatures);
        if (key === 'landUse') {
          setDefaultPlanningLandUseLegend();
          applyPlanningLandUseCategoryFilter();
        }
        applyDetailedPlanningCategoryFilters(key);
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
          if (!hasPlanningPanelContext()) setPlanningPanelHtml('');
          if (results.some((result) => result.exceeded)) {
            showStatus('חלק משכבות התכנון כבדות באזור הזה. התקרב מעט לקבלת טעינה מלאה.');
          }
        } catch (error) {
          if (!hasPlanningPanelContext()) {
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
        const genericName = props.NAME || props.LABEL || props.TXT || props.DESCRIPTION || props.desc || props.type_name || props.TYPE_NAME;
        if (key === 'notice77') return props.planning_landuse_label || props.PL_NAME || props.pl_name || props.PLAN_NAME || genericName || 'פירוט תכנית';
        if (key === 'tama1') return genericName || props.PL_NAME || 'מגבלה / סימון תמ״א 1';
        if (key === 'transport') return genericName || props.ROAD_NAME || props.RAIL_NAME || props.PL_NAME || 'שכבת תחבורה';
        if (key === 'tama70') return props.PL_NAME || genericName || 'תמ״א 70';
        if (key === 'landUse') return props.TYPE_NAME || props.mavat_name || props.PLAN_NAME || props.pl_name || 'ייעוד קרקע';
        return props.pl_name || props.pl_number || 'תכנית';
      }

      function planningFeatureHtml(feature, table5State) {
        const props = feature.properties || {};
        const key = props.planning_layer;
        const title = props.planning_title || 'תכנון';
        const planNumber = props.pl_number || props.PL_NUMBER || '';
        const planName = props.pl_name || props.PL_NAME || '';
        const status = props.station_desc || props.STATUS || '';
        const link = props.pl_url || props.PL_URL || '';
        const genericRows = [
          ['שכבה', title],
          ['קטגוריה', props.planning_category_label],
          ['שם', props.NAME || props.LABEL || props.TXT || props.DESCRIPTION || props.TYPE_NAME || props.type_name],
          ['תכנית', props.PL_NAME || props.pl_name || props.PLAN_NAME],
          ['מספר תכנית', planNumber || props.pl_number],
          ['סטטוס', status],
          ['שטח', formatPlanningAreaSqm(props.AREA_dunam || props.area_dunam, 'dunam')]
        ];
        const rows = key === 'landUse' ? [
          ['שכבה', title],
          ['ייעוד', props.TYPE_NAME || props.mavat_name],
          ['תכנית', props.PLAN_NAME || planName],
          ['שטח', formatPlanningAreaSqm(props.AREA_dunam, 'dunam')]
        ] : key === 'notice77' && props.planning_landuse_label ? [
          ['שכבה', title],
          ['ייעוד', props.planning_landuse_label],
          ['תא שטח', props.num],
          ['תכנית', props.pl_name || props.PL_NAME || props.PLAN_NAME],
          ['מספר תכנית', planNumber],
          ['שטח', formatPlanningAreaSqm(planningLandUseAreaSqm(props), 'sqm')]
        ] : ['notice77', 'tama1', 'transport', 'tama70'].includes(key) ? genericRows : [
          ['שכבה', title],
          ['מספר תכנית', planNumber],
          ['שם תכנית', planName],
          ['סטטוס', status],
          ['שטח', formatPlanningAreaSqm(props.pl_area_dunam, 'dunam')],
          ['ייעודים', props.pl_landuse_string]
        ];
        return '<strong>' + escapeHtml(planningFeatureLabel(feature)) + '</strong>' +
          planningMetaHtml(rows) +
          table5RightsHtml(table5State) +
          (link ? '<div class="planning-panel__note"><a href="' + escapeHtml(link) + '" target="_blank" rel="noopener">פתיחה במבא״ת</a></div>' : '') +
          '<div class="planning-panel__note">מידע תכנוני ראשוני ממינהל התכנון. יש לתקף מול מסמכי התכנית.</div>';
      }

      function planningFeatureStatus(feature) {
        const props = feature.properties || {};
        return props.station_desc || props.STATUS || 'סטטוס לא ידוע';
      }

      function planningFeatureFid(feature) {
        const props = feature && feature.properties ? feature.properties : {};
        return props.fid !== null && props.fid !== undefined ? String(props.fid) : '';
      }

      function planningFeatureListHtml(features, selectedFeature) {
        const selectedFid = planningFeatureFid(selectedFeature);
        const items = (features || []).map((feature) => {
          const props = feature.properties || {};
          const fid = planningFeatureFid(feature);
          const isSelected = fid && fid === selectedFid;
          const planNumber = props.pl_number || props.PL_NUMBER || '';
          const planName = props.pl_name || props.PL_NAME || props.PLAN_NAME || planningFeatureLabel(feature);
          const status = planningFeatureStatus(feature);
          const link = props.pl_url || props.PL_URL || '';
          const title = [planNumber, planName].filter(Boolean).join(' — ') || 'תכנית';
          return '<li class="planning-panel__plan-item' + (isSelected ? ' is-selected' : '') + '">' +
            '<div class="planning-panel__plan-title">' + escapeHtml(title) + '</div>' +
            '<div class="planning-panel__plan-status">' + escapeHtml(status) + '</div>' +
            (fid ? '<button class="planning-panel__plan-select' + (isSelected ? ' is-selected' : '') + '" type="button" data-planning-fid="' + escapeHtml(fid) + '">' + (isSelected ? 'מסומן' : 'סמן תכנית') + '</button>' : '') +
            (planNumber ? '<button class="planning-panel__plan-select" type="button" data-planning-landuse-plan="' + escapeHtml(planNumber) + '">ייעודי קרקע</button>' : '') +
            (link ? '<a href="' + escapeHtml(link) + '" target="_blank" rel="noopener">מבא״ת</a>' : '') +
            '</li>';
        }).join('');
        return '<div data-planning-selected-detail></div>' +
          '<div class="planning-panel__context">תכניות רלוונטיות בנקודה</div>' +
          '<div class="planning-panel__note">נמצאו ' + formatCount((features || []).length) + ' תכניות חופפות/קרובות לנקודה שנבחרה.</div>' +
          '<ol class="planning-panel__plan-list">' + items + '</ol>' +
          '<div class="planning-panel__note">מידע תכנוני ראשוני ממינהל התכנון. יש לתקף מול מסמכי התכנית.</div>';
      }

      function planningIdentifyLineLayers() {
        const layers = [];
        if (planningLayerEnabled.blueLines && map.getLayer('planning-blue-line')) layers.push('planning-blue-line');
        if (planningLayerEnabled.landUse && map.getLayer('planning-landuse-line')) layers.push('planning-landuse-line');
        if (planningLayerEnabled.notice77 && map.getLayer('planning-77-line')) layers.push('planning-77-line');
        if (planningLayerEnabled.tama1 && map.getLayer('planning-tama1-line')) layers.push('planning-tama1-line');
        if (planningLayerEnabled.transport && map.getLayer('planning-transport-line')) layers.push('planning-transport-line');
        if (planningLayerEnabled.tama70 && map.getLayer('planning-tama70-line')) layers.push('planning-tama70-line');
        return layers;
      }

      function planningIdentifyFillLayers() {
        const layers = [];
        if (planningLayerEnabled.blueLines && map.getLayer('planning-blue-fill')) layers.push('planning-blue-fill');
        if (planningLayerEnabled.landUse && map.getLayer('planning-landuse-fill')) layers.push('planning-landuse-fill');
        if (planningLayerEnabled.notice77 && map.getLayer('planning-77-fill')) layers.push('planning-77-fill');
        if (planningLayerEnabled.tama1 && map.getLayer('planning-tama1-fill')) layers.push('planning-tama1-fill');
        if (planningLayerEnabled.transport && map.getLayer('planning-transport-fill')) layers.push('planning-transport-fill');
        if (planningLayerEnabled.tama70 && map.getLayer('planning-tama70-fill')) layers.push('planning-tama70-fill');
        return layers;
      }

      function planningIdentifyFacilityLayers() {
        const layers = [];
        if (planningLayerEnabled.transport && map.getLayer('planning-transport-point')) layers.push('planning-transport-point');
        return layers;
      }

      function planningFeatureIdentity(feature) {
        const props = feature.properties || {};
        if (props.fid !== null && props.fid !== undefined && props.planning_layer === 'blueLines') {
          return 'blueLines|fid|' + props.fid;
        }
        const objectId = props.OBJECTID ?? props.objectid ?? props.ObjectId ?? props.OBJECTID_1 ?? props.objectid_1;
        if (objectId !== null && objectId !== undefined) {
          return [props.planning_layer || '', 'OBJECTID', objectId, props.planning_title || ''].join('|');
        }
        if (props.FID !== null && props.FID !== undefined) {
          return [props.planning_layer || '', 'FID', props.FID, props.planning_title || ''].join('|');
        }
        return [
          props.planning_layer || '',
          props.pl_number || props.PL_NUMBER || '',
          props.pl_name || props.PL_NAME || props.PLAN_NAME || props.NAME || props.LABEL || '',
          props.num || props.NUM || '',
          props.mavat_code || props.MAVAT_CODE || ''
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

      function dedupeTama70Features(features) {
        const seen = new Set();
        return (features || []).filter((feature) => {
          const category = planningDetailedCategoryLabel(feature, 'tama70');
          if (category !== 'תחנות מטרו') return true;
          const coords = tama70Coordinates(feature);
          const coord = coords[0];
          if (!coord) return false;
          const key = [
            category,
            Math.round(Number(coord[0]) * 10000),
            Math.round(Number(coord[1]) * 10000)
          ].join('|');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }

      function dedupeDetailedPlanningFeatures(key, features) {
        if (key === 'tama70') return dedupeTama70Features(features);
        return features;
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

      function planningRingArea(coords) {
        let area = 0;
        for (let i = 0; i < (coords || []).length; i += 1) {
          const a = coords[i];
          const b = coords[(i + 1) % coords.length];
          if (!Array.isArray(a) || !Array.isArray(b)) continue;
          area += (Number(a[0]) * Number(b[1])) - (Number(b[0]) * Number(a[1]));
        }
        return Math.abs(area / 2);
      }

      function planningGeometryArea(geometry) {
        if (!geometry) return Infinity;
        if (geometry.type === 'Polygon') {
          const rings = geometry.coordinates || [];
          if (!rings.length) return Infinity;
          return Math.max(0, planningRingArea(rings[0]) - rings.slice(1).reduce((sum, ring) => sum + planningRingArea(ring), 0));
        }
        if (geometry.type === 'MultiPolygon') {
          return (geometry.coordinates || []).reduce((sum, polygon) => {
            const rings = polygon || [];
            if (!rings.length) return sum;
            return sum + Math.max(0, planningRingArea(rings[0]) - rings.slice(1).reduce((part, ring) => part + planningRingArea(ring), 0));
          }, 0) || Infinity;
        }
        return Infinity;
      }

      function planningFeatureAreaValue(feature) {
        const props = feature && feature.properties ? feature.properties : {};
        const propertyArea = Number(props.pl_area_dunam || props.area_dunam || props.AREA_DUNAM || props.area || props.AREA);
        if (Number.isFinite(propertyArea) && propertyArea > 0) return propertyArea;
        return planningGeometryArea(feature && feature.geometry);
      }

      function pickSmallestPlanningFeature(features, point) {
        return uniquePlanningFeatures(features)
          .map((feature) => ({
            feature,
            area: planningFeatureAreaValue(feature),
            score: planningFeatureScore(feature, point)
          }))
          .sort((a, b) => (a.area - b.area) || (a.score.distance - b.score.distance))[0]?.feature || null;
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
        if (geom.type === 'Point') {
          const projected = screenPoint(geom.coordinates);
          return { distance: projected ? Math.hypot(point.x - projected.x, point.y - projected.y) : Infinity, area: Infinity };
        }
        if (geom.type === 'MultiPoint') {
          return {
            distance: (geom.coordinates || []).reduce((best, coord) => {
              const projected = screenPoint(coord);
              return projected ? Math.min(best, Math.hypot(point.x - projected.x, point.y - projected.y)) : best;
            }, Infinity),
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
        if (!feature || !feature.geometry) return renderedFeature;
        feature.properties = {
          ...(renderedFeature.properties || {}),
          ...(feature.properties || {})
        };
        return feature;
      }

      async function fetchPlanningBlueLineFeatures(renderedFeatures) {
        const features = await Promise.all((renderedFeatures || []).map((feature) => fetchPlanningBlueLineFeature(feature)));
        return uniquePlanningFeatures(features.filter(Boolean));
      }

      function planLandUseCellNumber(props) {
        const raw = props && (props.num ?? props.NUM ?? props.cell_no ?? props.CELL_NO ?? props.TA_SHTAH);
        const match = String(raw || '').match(/\d+/);
        return match ? Number(match[0]) : null;
      }

      async function fetchPlanningTable5Rights(planNumber, cellNumber) {
        const url = PLANNING_API + '/api/planning/table5-rights?plan=' +
          encodeURIComponent(planNumber) + '&cell=' + encodeURIComponent(String(cellNumber));
        const response = await fetch(url, { credentials: 'include' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'שגיאה בטעינת טבלה 5.');
        return data;
      }

      function table5RightsRowHtml(row) {
        const breakdown = row.extras && row.extras.table5_breakdown ? row.extras.table5_breakdown : {};
        const hasBreakdown = Object.keys(breakdown).length > 0;
        const setback = [
          row.setback_front_m ? 'קדמי ' + formatRightsNumber(row.setback_front_m, 2) : '',
          row.setback_rear_m ? 'אחורי ' + formatRightsNumber(row.setback_rear_m, 2) : '',
          row.setback_left_m ? 'שמאל ' + formatRightsNumber(row.setback_left_m, 2) : '',
          row.setback_right_m ? 'ימין ' + formatRightsNumber(row.setback_right_m, 2) : ''
        ].filter(Boolean).join(' / ');
        const breakdownRows = hasBreakdown ? [
          ['מרפסות', breakdown.balcony_area_m2 ? formatRightsNumber(breakdown.balcony_area_m2, 2) + ' מ"ר' : ''],
          ['עיקרי מתחת לקרקע', breakdown.below_ground_main_m2 ? formatRightsNumber(breakdown.below_ground_main_m2, 2) + ' מ"ר' : ''],
          ['שירות מתחת לקרקע', breakdown.below_ground_service_m2 ? formatRightsNumber(breakdown.below_ground_service_m2, 2) + ' מ"ר' : ''],
          ['קומות מתחת לקרקע', breakdown.floors_below ? formatRightsNumber(breakdown.floors_below, 0) : '']
        ] : [];
        const rows = [
          ['ייעוד/אזור', row.zone_name],
          ['תא שטח', row.zone_cell || row.cell_no],
          ['סוג זכויות', row.rights_type],
          ['שטח מגרש', row.plot_area_m2 ? formatRightsNumber(row.plot_area_m2, 0) + ' מ"ר' : ''],
          [hasBreakdown ? 'סה"כ מעל הקרקע' : 'סה"כ שטחי בנייה', row.floor_area_total_m2 ? formatRightsNumber(row.floor_area_total_m2, 2) + ' מ"ר' : ''],
          [hasBreakdown ? 'עיקרי מעל הקרקע' : 'עיקרי', row.floor_area_main_m2 ? formatRightsNumber(row.floor_area_main_m2, 2) + ' מ"ר' : ''],
          [hasBreakdown ? 'שירות מעל הקרקע' : 'שירות', row.floor_area_service_m2 ? formatRightsNumber(row.floor_area_service_m2, 2) + ' מ"ר' : ''],
          ...breakdownRows,
          ['אחוזי בנייה', row.far ? formatRightsNumber(row.far, 2) + '%' : ''],
          ['תכסית', row.coverage_pct ? formatRightsNumber(row.coverage_pct, 2) + '%' : ''],
          ['יח"ד', row.housing_units ? formatRightsNumber(row.housing_units, 0) : ''],
          [hasBreakdown ? 'קומות מעל הקרקע' : 'קומות', row.floors ? formatRightsNumber(row.floors, 0) : ''],
          ['גובה', row.height_m ? formatRightsNumber(row.height_m, 2) + ' מ׳' : ''],
          ['קווי בניין', setback],
          ['איכות התאמה', [row.match_quality, row.match_confidence_bucket].filter(Boolean).join(' · ')]
        ];
        return '<div class="planning-panel__note">' + planningMetaHtml(rows) +
          (row.footnotes ? '<div>' + escapeHtml(row.footnotes) + '</div>' : '') + '</div>';
      }

      function table5RightsHtml(state) {
        if (!state) return '';
        if (state.status === 'loading') {
          return '<div class="planning-panel__context">זכויות מטבלה 5</div>' +
            '<div class="planning-panel__note">טוען זכויות מטבלה 5...</div>';
        }
        if (state.status === 'error') {
          return '<div class="planning-panel__context">זכויות מטבלה 5</div>' +
            '<div class="planning-panel__note">' + escapeHtml(state.message || 'שגיאה בטעינת טבלה 5.') + '</div>';
        }
        const data = state.data || {};
        if (!data.available || !Array.isArray(data.rows) || !data.rows.length) {
          return '<div class="planning-panel__context">זכויות מטבלה 5</div>' +
            '<div class="planning-panel__note">' + escapeHtml(data.message || 'לא נמצאה התאמה בטוחה לטבלה 5 לתכנית/תא הזה.') + '</div>';
        }
        return '<div class="planning-panel__context">זכויות מטבלה 5</div>' +
          data.rows.map(table5RightsRowHtml).join('') +
          '<div class="planning-panel__note">מוצגות רק התאמות בטוחות מטבלה 5. יש לתקף מול מסמכי התכנית.</div>';
      }

      async function loadTable5RightsForPlanLandUse(feature) {
        const props = feature && feature.properties ? feature.properties : {};
        if (props.planning_layer !== 'notice77') return;
        const planNumber = props.pl_number || props.PL_NUMBER || activePlanLandUseNumber || '';
        const cellNumber = planLandUseCellNumber(props);
        if (!planNumber || !cellNumber) return;
        const identity = planningFeatureIdentity(feature);
        setPlanningDetailHtml(
          '<div class="planning-panel__context">ייעוד קרקע נבחר</div>' +
          planningFeatureHtml(feature, { status: 'loading' })
        );
        try {
          const data = await fetchPlanningTable5Rights(planNumber, cellNumber);
          if (!selectedPlanningFeature || planningFeatureIdentity(selectedPlanningFeature) !== identity) return;
          setPlanningDetailHtml(
            '<div class="planning-panel__context">ייעוד קרקע נבחר</div>' +
            planningFeatureHtml(feature, { status: 'done', data })
          );
          postGeo3DUsage(data.available ? 'planning_table5_rights_found' : 'planning_table5_rights_missing');
        } catch (error) {
          if (!selectedPlanningFeature || planningFeatureIdentity(selectedPlanningFeature) !== identity) return;
          setPlanningDetailHtml(
            '<div class="planning-panel__context">ייעוד קרקע נבחר</div>' +
            planningFeatureHtml(feature, { status: 'error', message: error.message })
          );
        }
      }

      async function selectPlanningBlueLineFromList(fid) {
        if (!fid) return;
        const feature = await fetchPlanningBlueLineFeature({
          type: 'Feature',
          properties: {
            fid,
            planning_layer: 'blueLines',
            planning_title: 'קווים כחולים'
          }
        });
        if (!feature) return;
        selectedPlanningFeature = feature;
        currentPlanningListSelectedFeature = feature;
        setPlanningHighlight(feature);
        planningPanelBody?.querySelectorAll('.planning-panel__plan-item').forEach((item) => {
          const button = item.querySelector('[data-planning-fid]');
          const isSelected = button && button.dataset.planningFid === String(fid);
          item.classList.toggle('is-selected', !!isSelected);
          if (button) {
            button.classList.toggle('is-selected', !!isSelected);
            button.textContent = isSelected ? 'מסומן' : 'סמן תכנית';
          }
        });
        showStatus('תכנית סומנה');
        postGeo3DUsage('planning_select_blue_line_from_list');
      }

      async function showPlanLandUse(planNumber) {
        if (!planNumber) return;
        showStatus('טוען ייעודי קרקע לתכנית');
        const styleCatalog = await loadPlanLandUseStyleCatalog();
        const settled = await Promise.allSettled(PLAN_LAND_USE_URLS.map((url) => fetchPlanLandUseFromUrl(url, planNumber)));
        const parts = settled
          .filter((part) => part.status === 'fulfilled')
          .map((part) => part.value);
        const features = uniquePlanningFeatures(parts.flatMap((part) => part && Array.isArray(part.features) ? part.features : []))
          .map((feature) => {
            const key = planLandUseKey(feature);
            return {
              ...feature,
              properties: {
                ...(feature.properties || {}),
                planning_layer: 'notice77',
                planning_title: 'ייעודי קרקע תכנית',
                planning_landuse_key: key,
                planning_landuse_label: planLandUseType(feature, styleCatalog)
              }
            };
          });
        if (!features.length) {
          clearSelectedPlanLandUse();
          showStatus('לא נמצאו ייעודי קרקע לתכנית ' + planNumber, true);
          return;
        }
        const source = map.getSource(PLANNING_SOURCES.notice77);
        if (!source || typeof source.setData !== 'function') return;
        selectedPlanningFeature = null;
        activePlanLandUseNumber = String(planNumber);
        selectedPlanLandUseHiddenCategories.clear();
        setPlanningHighlight(null);
        restorePlanningListIfAvailable();
        const landUseItemsByKey = new Map();
        features.forEach((feature) => {
          const key = planLandUseKey(feature);
          if (!key || landUseItemsByKey.has(key)) return;
          const style = styleCatalog[key] || {};
          landUseItemsByKey.set(key, {
            key,
            label: feature.properties?.planning_landuse_label || planLandUseType(feature, styleCatalog),
            color: style.color || PLAN_LAND_USE_COLORS[landUseItemsByKey.size % PLAN_LAND_USE_COLORS.length]
          });
        });
        const landUseItems = Array.from(landUseItemsByKey.values());
        source.setData({ type: 'FeatureCollection', features });
        planningLayerEnabled.notice77 = true;
        updatePlanningLayerVisibility();
        if (map.getLayer('planning-77-fill')) {
          map.setPaintProperty('planning-77-fill', 'fill-color', planLandUseColorExpression(landUseItems));
          map.setPaintProperty('planning-77-fill', 'fill-opacity', ['interpolate', ['linear'], ['zoom'], 12, 0.32, 16, 0.48]);
        }
        if (map.getLayer('planning-77-line')) {
          map.setPaintProperty('planning-77-line', 'line-color', '#ffffff');
          map.setPaintProperty('planning-77-line', 'line-width', ['interpolate', ['linear'], ['zoom'], 12, 0.8, 16, 1.8]);
          map.setPaintProperty('planning-77-line', 'line-opacity', 0.78);
        }
        setPlanLandUseLegend(landUseItems, planNumber);
        applySelectedPlanLandUseCategoryFilter();
        updatePlanningLegendsVisibility();
        const bounds = new maplibregl.LngLatBounds();
        features.forEach((feature) => {
          const coordinates = [];
          collectGeometryCoordinates(feature.geometry, coordinates);
          coordinates.forEach((coord) => bounds.extend(coord));
        });
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, { padding: 80, maxZoom: 17, duration: 650 });
        }
        planningPanelBody?.querySelectorAll('[data-planning-landuse-plan]').forEach((button) => {
          const isSelected = button.dataset.planningLandusePlan === String(planNumber);
          button.classList.toggle('is-selected', isSelected);
          button.textContent = isSelected ? 'ייעודי קרקע מוצגים' : 'ייעודי קרקע';
        });
        if (parts.some((part) => part && part.exceeded)) {
          showStatus('הוצגו ייעודי קרקע לתכנית, ייתכן שיש עוד פריטים. התקרב לאזור.');
        } else {
          showStatus('ייעודי קרקע לתכנית הוצגו');
        }
        postGeo3DUsage('planning_plan_landuse');
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
        const facilityLayers = planningIdentifyFacilityLayers();
        const facilityFeatures = facilityLayers.length ?
          map.queryRenderedFeatures([[p.x - 10, p.y - 10], [p.x + 10, p.y + 10]], { layers: facilityLayers }) : [];
        const planLandUseFeatures = [...lineFeatures, ...fillFeatures].filter((feature) => {
          return feature && feature.properties && feature.properties.planning_layer === 'notice77';
        });
        if (activePlanLandUseNumber && planLandUseFeatures.length) {
          const renderedLandUse = pickPlanningFeature(planLandUseFeatures, p);
          const feature = resolvePlanningSourceFeature(renderedLandUse, p) || renderedLandUse;
          if (feature) {
            selectedPlanningFeature = feature;
            currentPlanningListSelectedFeature = feature;
            setPlanningHighlight(feature);
            if (planningPopup) {
              planningPopup.remove();
              planningPopup = null;
            }
            setPlanningDetailHtml(
              '<div class="planning-panel__context">ייעוד קרקע נבחר</div>' +
              planningFeatureHtml(feature)
            );
            loadTable5RightsForPlanLandUse(feature);
            showStatus('ייעוד קרקע נבחר');
            postGeo3DUsage('planning_identify_plan_landuse');
            return true;
          }
        }
        const blueLines = blueLineFeaturesAt(p, lineFeatures, fillFeatures);
        if (planningLayerEnabled.blueLines && blueLines.length) {
          const features = await fetchPlanningBlueLineFeatures(blueLines);
          const listFeatures = features.length ? features : blueLines;
          clearSelectedPlanLandUse();
          selectedPlanningFeature = pickSmallestPlanningFeature(listFeatures, p);
          rememberPlanningList(listFeatures, selectedPlanningFeature);
          setPlanningHighlight(selectedPlanningFeature);
          if (planningPopup) {
            planningPopup.remove();
            planningPopup = null;
          }
          setPlanningPanelHtml(planningFeatureListHtml(listFeatures, selectedPlanningFeature));
          postGeo3DUsage('planning_identify_blue_lines');
          return true;
        }
        const renderedFeature = pickPlanningFeature([...facilityFeatures, ...lineFeatures, ...fillFeatures], p);
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

      async function fetchGroundwaterContamination(geometry) {
        const arcgisGeometry = arcgisPolygonGeometry(geometry);
        if (!arcgisGeometry) {
          return { status: 'unknown', message: 'לא נמצאה גיאומטריית חלקה לבדיקת זיהום.' };
        }
        const params = new URLSearchParams({
          where: '1=1',
          geometry: JSON.stringify(arcgisGeometry),
          geometryType: 'esriGeometryPolygon',
          inSR: '4326',
          spatialRel: 'esriSpatialRelIntersects',
          outFields: 'PL_NUMBER,PL_NAME,STATUS,NAME,LABEL,PL_URL',
          returnGeometry: 'false',
          outSR: '4326',
          resultRecordCount: '10',
          f: 'geojson'
        });
        try {
          const response = await fetch(GROUNDWATER_CONTAMINATION_URL + '?' + params.toString());
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            return { status: 'unknown', message: data.message || data.error || 'לא ניתן לבדוק זיהום מי תהום כרגע.' };
          }
          const matches = Array.isArray(data.features) ? data.features : [];
          return matches.length ? { status: 'found', matches } : { status: 'clear', matches: [] };
        } catch (error) {
          return { status: 'unknown', message: error.message || 'לא ניתן לבדוק זיהום מי תהום כרגע.' };
        }
      }

      function renderGroundwaterPolygonResult(result, lngLat) {
        if (!groundwaterPanelBody) return;
        groundwaterPanelBody.dataset.hasResult = '1';
        if (result.coverage === 'none' || result.mean == null) {
          setGroundwaterPanelHtml('<div class="groundwater-panel__main">אין נתונים</div>' +
            '<div class="groundwater-panel__note">' + escapeHtml(result.message || 'אין נתוני מי תהום תקפים בשטח החלקה.') + '</div>' +
            metaHtml([['אינדיקציית זיהום', groundwaterContaminationSummary(result.contamination)]]));
          return;
        }
        const pairs = [
          ['מינימום', formatMeters(result.min, 1)],
          ['ממוצע', formatMeters(result.mean, 1)],
          ['מקסימום', formatMeters(result.max, 1)],
          ['אקוויפר', result.aquiferDisplay || result.aquifer || '—'],
          ['אינדיקציית זיהום', groundwaterContaminationSummary(result.contamination)]
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
          data.contamination = await fetchGroundwaterContamination(geometry);
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

        [
          PLANNING_SOURCES.landUse,
          PLANNING_SOURCES.notice77,
          PLANNING_SOURCES.tama1,
          PLANNING_SOURCES.transport,
          PLANNING_SOURCES.tama70,
          PLANNING_SOURCES.highlight
        ].forEach((sourceId) => {
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
              'match',
              ['get', 'status_group'],
              'approved',
              '#22c55e',
              'notice_77_78',
              '#38bdf8',
              'deposit_review',
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
              'match',
              ['get', 'status_group'],
              'approved',
              '#22c55e',
              'notice_77_78',
              '#38bdf8',
              'deposit_review',
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
          id: 'planning-77-fill',
          type: 'fill',
          source: PLANNING_SOURCES.notice77,
          minzoom: PRACTICAL_LAYER_ZOOM.planningDetailed,
          layout: { visibility: 'none' },
          paint: {
            'fill-color': '#38bdf8',
            'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.14, 16, 0.28]
          }
        });

        map.addLayer({
          id: 'planning-77-line',
          type: 'line',
          source: PLANNING_SOURCES.notice77,
          minzoom: PRACTICAL_LAYER_ZOOM.planningDetailed,
          layout: { visibility: 'none' },
          paint: {
            'line-color': '#7dd3fc',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 16, 3.2],
            'line-opacity': 0.92
          }
        });

        map.addLayer({
          id: 'planning-tama1-fill',
          type: 'fill',
          source: PLANNING_SOURCES.tama1,
          minzoom: PRACTICAL_LAYER_ZOOM.planningDetailed,
          layout: { visibility: 'none' },
         paint: {
           'fill-color': ['coalesce', ['get', 'planning_category_color'], '#f97316'],
           'fill-opacity': [
             'interpolate',
             ['linear'],
             ['zoom'],
             11,
             ['case',
                ['match', ['get', 'planning_category_key'], ['יער טבעי', 'שמורת טבע'], true, false], 0.075,
                ['match', ['get', 'planning_category_key'], ['יער פארק', 'יער נטע אדם', 'יער', 'גן לאומי'], true, false], 0.035,
                ['match', ['get', 'planning_category_key'], ['קו סביבה חופית 300 מ׳', 'רצועת דלק'], true, false], 0.05,
                ['match', ['get', 'planning_category_key'], ['פשט הצפה', 'שטח הצפה'], true, false], 0.065,
                ['match', ['get', 'planning_category_key'], ['זיהום מי תהום', 'רגישות הידרולוגית · גבוהה מאוד', 'רגישות הידרולוגית · גבוהה'], true, false], 0.075,
                ['match', ['get', 'planning_category_key'], ['רגישות הידרולוגית · בינונית', 'רגישות הידרולוגית · נמוכה', 'רגישות הידרולוגית'], true, false], 0.052,
                0.045
             ],
             16,
             ['case',
                ['match', ['get', 'planning_category_key'], ['יער טבעי', 'שמורת טבע'], true, false], 0.14,
                ['match', ['get', 'planning_category_key'], ['יער פארק', 'יער נטע אדם', 'יער', 'גן לאומי'], true, false], 0.07,
                ['match', ['get', 'planning_category_key'], ['קו סביבה חופית 300 מ׳', 'רצועת דלק'], true, false], 0.09,
                ['match', ['get', 'planning_category_key'], ['פשט הצפה', 'שטח הצפה'], true, false], 0.13,
                ['match', ['get', 'planning_category_key'], ['זיהום מי תהום', 'רגישות הידרולוגית · גבוהה מאוד', 'רגישות הידרולוגית · גבוהה'], true, false], 0.15,
                ['match', ['get', 'planning_category_key'], ['רגישות הידרולוגית · בינונית', 'רגישות הידרולוגית · נמוכה', 'רגישות הידרולוגית'], true, false], 0.11,
                0.09
             ]
           ]
         }
       });

        map.addLayer({
          id: 'planning-tama1-line-halo',
          type: 'line',
          source: PLANNING_SOURCES.tama1,
          minzoom: PRACTICAL_LAYER_ZOOM.planningDetailed,
          layout: { visibility: 'none' },
          paint: {
            'line-color': '#f8fafc',
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              11,
              ['case',
                ['match', ['get', 'planning_category_key'], ['יער טבעי', 'שמורת טבע'], true, false], 2.2,
                ['match', ['get', 'planning_category_key'], ['יער פארק', 'יער נטע אדם', 'יער', 'גן לאומי'], true, false], 1.6,
                ['match', ['get', 'planning_category_key'], ['קו סביבה חופית 300 מ׳', 'רצועת דלק'], true, false], 2.5,
                2.1
              ],
              16,
              ['case',
                ['match', ['get', 'planning_category_key'], ['יער טבעי', 'שמורת טבע'], true, false], 4,
                ['match', ['get', 'planning_category_key'], ['יער פארק', 'יער נטע אדם', 'יער', 'גן לאומי'], true, false], 3,
                ['match', ['get', 'planning_category_key'], ['קו סביבה חופית 300 מ׳', 'רצועת דלק'], true, false], 5.2,
                4
              ]
            ],
            'line-opacity': [
              'case',
              ['match', ['get', 'planning_category_key'], ['יער טבעי', 'שמורת טבע'], true, false], 0.65,
              ['match', ['get', 'planning_category_key'], ['יער פארק', 'יער נטע אדם', 'יער', 'גן לאומי'], true, false], 0.42,
              0.55
            ]
          }
        });

        map.addLayer({
          id: 'planning-tama1-line',
          type: 'line',
          source: PLANNING_SOURCES.tama1,
          minzoom: PRACTICAL_LAYER_ZOOM.planningDetailed,
          layout: { visibility: 'none' },
          paint: {
            'line-color': ['coalesce', ['get', 'planning_category_color'], '#fdba74'],
            'line-width': [
              'interpolate',
              ['linear'],
             ['zoom'],
             11,
             ['case',
                ['match', ['get', 'planning_category_key'], ['יער טבעי', 'שמורת טבע'], true, false], 1.35,
                ['match', ['get', 'planning_category_key'], ['יער פארק', 'יער נטע אדם', 'יער', 'גן לאומי'], true, false], 0.95,
               ['match', ['get', 'planning_category_key'], ['קו סביבה חופית 300 מ׳', 'רצועת דלק'], true, false], 1.8,
               1.25
             ],
             16,
             ['case',
                ['match', ['get', 'planning_category_key'], ['יער טבעי', 'שמורת טבע'], true, false], 2.3,
                ['match', ['get', 'planning_category_key'], ['יער פארק', 'יער נטע אדם', 'יער', 'גן לאומי'], true, false], 1.7,
               ['match', ['get', 'planning_category_key'], ['קו סביבה חופית 300 מ׳', 'רצועת דלק'], true, false], 3.6,
               2.6
             ]
           ],
            'line-opacity': [
              'case',
              ['match', ['get', 'planning_category_key'], ['יער טבעי', 'שמורת טבע'], true, false], 0.9,
              ['match', ['get', 'planning_category_key'], ['יער פארק', 'יער נטע אדם', 'יער', 'גן לאומי'], true, false], 0.72,
              ['==', ['get', 'planning_category_key'], 'קו סביבה חופית 300 מ׳'], 0.88,
              ['==', ['get', 'planning_category_key'], 'רצועת דלק'], 0.9,
              0.84
            ]
          }
        });

        map.addLayer({
          id: 'planning-transport-fill',
          type: 'fill',
          source: PLANNING_SOURCES.transport,
          minzoom: PRACTICAL_LAYER_ZOOM.planningDetailed,
          filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
          layout: { visibility: 'none' },
          paint: {
            'fill-color': ['coalesce', ['get', 'planning_category_color'], '#facc15'],
            'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.035, 16, 0.11]
          }
        });

        map.addLayer({
          id: 'planning-transport-rail-halo',
          type: 'line',
          source: PLANNING_SOURCES.transport,
          minzoom: PRACTICAL_LAYER_ZOOM.planningDetailed,
          filter: ['match', ['get', 'planning_category_key'], ['מסילת רכבת מאושרת', 'מסילת רכבת עם הוראות מעבר'], true, false],
          layout: { visibility: 'none' },
          paint: {
            'line-color': '#f8fafc',
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              11, 4.2,
              16, 8.4
            ],
            'line-opacity': 0.9,
            'line-blur': 0.35
          }
        });

        map.addLayer({
          id: 'planning-transport-line',
          type: 'line',
          source: PLANNING_SOURCES.transport,
          minzoom: PRACTICAL_LAYER_ZOOM.planningDetailed,
          filter: ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
          layout: { visibility: 'none' },
          paint: {
            'line-color': ['coalesce', ['get', 'planning_category_color'], '#fde047'],
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              11,
              ['case',
                ['in', 'מהירה', ['get', 'planning_category_key']], 2.4,
                ['in', 'ראשית', ['get', 'planning_category_key']], 1.9,
                1.3
              ],
              16,
              ['case',
                ['in', 'מהירה', ['get', 'planning_category_key']], 5.8,
                ['in', 'ראשית', ['get', 'planning_category_key']], 4.4,
                3.2
              ]
            ],
            'line-opacity': 0.92
          }
        });

        map.addLayer({
          id: 'planning-transport-point',
          type: 'circle',
          source: PLANNING_SOURCES.transport,
          minzoom: PRACTICAL_LAYER_ZOOM.planningDetailed,
          filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
          layout: { visibility: 'none' },
          paint: {
            'circle-color': ['coalesce', ['get', 'planning_category_color'], '#14b8a6'],
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 16, 7],
            'circle-stroke-color': [
              'case',
              ['==', ['get', 'planning_category_key'], 'תחנות רכבת'],
              '#0ea5e9',
              '#ffffff'
            ],
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 1.4, 16, 2.4],
            'circle-opacity': 0.96
          }
        });

        map.addLayer({
          id: 'planning-tama70-fill',
          type: 'fill',
          source: PLANNING_SOURCES.tama70,
          minzoom: PRACTICAL_LAYER_ZOOM.planningDetailed,
          filter: ['match', ['get', 'planning_category_key'], ['מרחב ליבה', 'טבעת ראשונה', 'תחום חיפוש למעבר ציבורי'], true, false],
          layout: { visibility: 'none' },
          paint: {
            'fill-color': ['coalesce', ['get', 'planning_category_color'], '#c084fc'],
            'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.14, 16, 0.28]
          }
        });

        map.addLayer({
          id: 'planning-tama70-boundary',
          type: 'line',
          source: PLANNING_SOURCES.tama70,
          minzoom: PRACTICAL_LAYER_ZOOM.planningDetailed,
          filter: ['==', ['get', 'planning_category_key'], 'גבול תמ״א 70'],
          layout: { visibility: 'none' },
          paint: {
            'line-color': '#f8fafc',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.8, 16, 4.2],
            'line-opacity': 0.9
          }
        });

        map.addLayer({
          id: 'planning-tama70-route-halo',
          type: 'line',
          source: PLANNING_SOURCES.tama70,
          minzoom: PRACTICAL_LAYER_ZOOM.planningDetailed,
          filter: ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
          layout: { visibility: 'none' },
          paint: {
            'line-color': 'rgba(8, 10, 12, 0.88)',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 5.4, 16, 10.5],
            'line-opacity': 0.82
          }
        });

        map.addLayer({
          id: 'planning-tama70-line',
          type: 'line',
          source: PLANNING_SOURCES.tama70,
          minzoom: PRACTICAL_LAYER_ZOOM.planningDetailed,
          layout: { visibility: 'none' },
          paint: {
            'line-color': ['coalesce', ['get', 'planning_category_color'], '#00c2ff'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3.1, 16, 6.4],
            'line-opacity': 0.96
          }
        });

        map.addLayer({
          id: 'planning-tama70-stations',
          type: 'circle',
          source: PLANNING_SOURCES.tama70,
          minzoom: PRACTICAL_LAYER_ZOOM.planningDetailed,
          filter: ['==', ['get', 'planning_category_key'], 'תחנות מטרו'],
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 5, 16, 9],
            'circle-color': '#f97316',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2.2,
            'circle-opacity': 0.96
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

        PLANNING_LAYER_IDS.forEach((layerId) => {
          if (map.getLayer(layerId)) map.moveLayer(layerId);
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
        updatePlanningStatusButtonStates();
        applyPlanningStatusFilter();
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
          if (planningLayerEnabled[key] && ['notice77', 'tama1', 'transport', 'tama70'].includes(key)) {
            zoomToPracticalMinimum(button.textContent || 'שכבה תכנונית', PLANNING_CONFIG[key].minZoom || PRACTICAL_LAYER_ZOOM.planningDetailed);
          }
          updatePlanningLayerButtonStates();
          updatePlanningLayerVisibility();
          updatePlanningLegendsVisibility();
          if (planningEnabled) schedulePlanningLoad(80);
        });
      });

      planningStatusButtons.forEach((button) => {
        button.addEventListener('click', () => {
          const key = button.dataset.planningStatus;
          planningStatusEnabled[key] = !planningStatusEnabled[key];
          updatePlanningStatusButtonStates();
          applyPlanningStatusFilter();
          setPlanningPanelHtml('');
          showStatus('סינון סטטוס עודכן');
        });
      });

      if (planningLandUseLegend) {
        planningLandUseLegend.addEventListener('click', (event) => {
          const landUseButton = event.target.closest('[data-planning-landuse-category]');
          if (landUseButton) {
            const categoryKey = landUseButton.dataset.planningLanduseCategory;
            if (!categoryKey) return;
            if (planningLandUseHiddenCategories.has(categoryKey)) {
              planningLandUseHiddenCategories.delete(categoryKey);
            } else {
              planningLandUseHiddenCategories.add(categoryKey);
            }
            applyPlanningLandUseCategoryFilter();
            setDefaultPlanningLandUseLegend();
            showStatus('סינון ייעודי קרקע עודכן');
            return;
          }
          const selectedPlanButton = event.target.closest('[data-selected-plan-landuse-key]');
          if (selectedPlanButton) {
            const categoryKey = selectedPlanButton.dataset.selectedPlanLanduseKey;
            if (!categoryKey) return;
            if (selectedPlanLandUseHiddenCategories.has(categoryKey)) {
              selectedPlanLandUseHiddenCategories.delete(categoryKey);
            } else {
              selectedPlanLandUseHiddenCategories.add(categoryKey);
            }
            applySelectedPlanLandUseCategoryFilter();
            selectedPlanButton.classList.toggle('is-on', !selectedPlanLandUseHiddenCategories.has(categoryKey));
            showStatus('סינון ייעודי קרקע בתכנית עודכן');
            return;
          }
          const button = event.target.closest('[data-planning-category-layer]');
          if (!button) return;
          const layerKey = button.dataset.planningCategoryLayer;
          const categoryKey = button.dataset.planningCategoryKey;
          if (!layerKey || !categoryKey || !detailedPlanningHiddenCategories[layerKey]) return;
          const hidden = detailedPlanningHiddenCategories[layerKey];
          if (hidden.has(categoryKey)) {
            hidden.delete(categoryKey);
          } else {
            hidden.add(categoryKey);
          }
          applyDetailedPlanningCategoryFilters(layerKey);
          setDetailedPlanningLegend();
          showStatus('סינון קטגוריות עודכן');
        });
      }

      document.addEventListener('click', (event) => {
        const button = event.target.closest('[data-parcel-groundwater]');
        if (!button) return;
        event.preventDefault();
        querySelectedParcelGroundwater();
      });

      mobileLayersToggle?.addEventListener('click', () => {
        const isOpen = !controlStrip?.classList.contains('is-layers-open');
        controlStrip?.classList.toggle('is-layers-open', isOpen);
        mobileLayersToggle.setAttribute('aria-expanded', String(isOpen));
      });

      toggles.forEach((button) => {
        const tapState = { x: 0, y: 0, t: 0, moved: false };

        button.addEventListener('pointerdown', (event) => {
          if (event.pointerType !== 'touch') return;
          tapState.x = event.clientX;
          tapState.y = event.clientY;
          tapState.t = Date.now();
          tapState.moved = false;
        }, { passive: true });

        button.addEventListener('pointermove', (event) => {
          if (event.pointerType !== 'touch') return;
          const dx = Math.abs(event.clientX - tapState.x);
          const dy = Math.abs(event.clientY - tapState.y);
          if (dx > 10 || dy > 10) tapState.moved = true;
        }, { passive: true });

        button.addEventListener('click', (event) => {
          if (tapState.moved || (tapState.t && Date.now() - tapState.t > 700)) {
            event.preventDefault();
            tapState.moved = false;
            tapState.t = 0;
            return;
          }
          tapState.t = 0;
          if (window.matchMedia('(max-width: 720px)').matches && layerToggleGroup?.contains(button)) {
            controlStrip?.classList.remove('is-layers-open');
            mobileLayersToggle?.setAttribute('aria-expanded', 'false');
          }
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
        if (parcelsEnabled && identifyParcelAt(e)) return;
        if (await identifyPlanningAt(e)) return;
        if (await queryGroundwaterPoint(e.lngLat)) return;
      });

      planningPanelBody?.addEventListener('click', async (event) => {
        const landUseButton = event.target.closest('[data-planning-landuse-plan]');
        if (landUseButton) {
          event.preventDefault();
          event.stopPropagation();
          await showPlanLandUse(landUseButton.dataset.planningLandusePlan);
          return;
        }
        const button = event.target.closest('[data-planning-fid]');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        await selectPlanningBlueLineFromList(button.dataset.planningFid);
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

