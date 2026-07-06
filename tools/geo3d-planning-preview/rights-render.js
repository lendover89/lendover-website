/* rights-render.js — the ONE shared render tree for building-rights results.
   panelHtml(data)  = the compact viewer panel (extracted verbatim from app-iplan-preview-v92.js)
   reportCard(plan) = the full report card    (extracted verbatim from parcel-report.html)
   When the engine adds/renames a field — edit THIS file only; both pages consume it.
   Loaded before the app script; exposes window.RightsRender. */
(function (global) {
      function escapeHtml(value) {
        return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }

// ===== viewer panel =====
      function parcelRightsHtml(data) {
        if (!data || !data.available || !Array.isArray(data.plans) || !data.plans.length) {
          return '<div class="parcel-plans-result"><strong>זכויות בנייה</strong><span>' +
            escapeHtml((data && data.message) || 'לא נמצאו זכויות לחלקה.') + '</span></div>';
        }
        const esc = escapeHtml;
        const conf = (c) => c === 'high' ? 'ודאי' : (c === 'medium' ? 'בינוני' : 'לא ודאי — לאימות ידני');
        const reportUrl = 'parcel-report.html?gush=' + encodeURIComponent(data.gush) + '&helka=' + encodeURIComponent(data.helka);
        let html = '<div class="parcel-plans-result"><strong>זכויות בנייה לחלקה' +
          (data.parcel_area_m2 ? ' (' + esc(String(data.parcel_area_m2)) + ' מ"ר)' : '') + '</strong>' +
          '<div style="margin:6px 0"><a href="' + esc(reportUrl) + '" target="_blank" rel="noopener" class="parcel-plan-action parcel-plan-action--link">📄 דו״ח זכויות מלא לחלקה →</a></div>' +
          '<div class="parcel-plans-list">';
        if (data.governing_landuse && data.governing_landuse.landuse_label) {
          const g = data.governing_landuse;
          html = html.replace('<div class="parcel-plans-list">',
            '<div class="parcel-landuse-headline" style="margin:6px 0;padding:6px 8px;background:rgba(37,99,235,0.18);border-right:3px solid #60a5fa;border-radius:4px;color:#e8f0ff">' +
            '<strong>ייעוד עיקרי:</strong> ' + esc(g.landuse_label) +
            (g.pl_number ? ' <span style="opacity:.7">(' + esc(g.pl_number) + ')</span>' : '') +
            '<div style="font-size:12px;opacity:.7">ייעוד מ-iplan — טרם חולצו זכויות מספריות לתכנית זו</div></div>' +
            '<div class="parcel-plans-list">');
        }
        data.plans.forEach((p) => {
          const title = (p.pl_number ? p.pl_number + ' · ' : '') + (p.pl_name || 'תכנית');
          html += '<div class="parcel-plan-item"><div class="parcel-plan-title">' + esc(title) + '</div>';
          if (p.status) html += '<div class="parcel-plan-status">' + esc(p.status) + '</div>';
          if (p.landuse && Array.isArray(p.landuse.designations) && p.landuse.designations.length && p.rights_mode !== 'landuse') {
            html += '<div class="parcel-plan-status" style="opacity:.8">ייעוד: ' + esc(p.landuse.designations[0].landuse_label || '') + '</div>';
          }
          if (p.rights_review && p.rights_review.status === 'manual') {
            html += '<div class="parcel-plan-status" style="color:#b45309">⚠ זכויות לאימות ידני' +
              (p.rights_review.reason ? ' <span style="opacity:.7">(' + esc(p.rights_review.reason) + ')</span>' : '') + '</div>';
          }
          if (p.rights_mode === 'h619_methamim' && Array.isArray(p.categories) && p.categories.length) {
            const dom = p.categories.find((c) => c.dominant) || p.categories[0];
            const a = (dom && dom.applicable) || {};
            const sb = (dom && dom.setbacks) || {};
            const parts = [];
            if (a.max_floors != null) parts.push('עד ' + a.max_floors + ' קומות');
            if (a.rights_above_pct != null) parts.push(a.rights_above_pct + '% מעל הקרקע');
            if (a.rights_below_pct != null) parts.push(a.rights_below_pct + '% מתחת');
            if (a.service_area_pct != null) parts.push('שירות ' + a.service_area_pct + '%');
            html += '<div class="parcel-plan-rights"><div>אזור: ' + esc((dom && dom.category) || '') + '</div>' +
              (parts.length ? '<div>' + esc(parts.join(' · ')) + '</div>' : '<div>אין ערכים מספריים לאזור זה</div>') +
              '<div class="parcel-plan-status">ודאות: ' + conf(p.confidence) +
              (p.dominant_coverage_pct != null ? ' (כיסוי ' + p.dominant_coverage_pct + '%)' : '') + '</div></div>';
            let det = '';
            const sbParts = [];
            if (sb.front != null) sbParts.push('קדמי ' + sb.front);
            if (sb.side != null) sbParts.push('צידי ' + sb.side);
            if (sb.rear != null) sbParts.push('אחורי ' + sb.rear);
            if (sb.roof_front != null) sbParts.push('גג ' + sb.roof_front);
            if (sbParts.length) det += '<div><strong>קווי בניין (מ׳):</strong> ' + esc(sbParts.join(' · ')) + '</div>';
            if (Array.isArray(dom.bands) && dom.bands.length > 1) {
              det += '<div><strong>מדרגות לפי גודל מגרש:</strong></div>';
              dom.bands.forEach((b) => {
                det += '<div>' + esc((b.min_lot_m2 != null ? 'מ-' + b.min_lot_m2 : '') +
                  (b.max_lot_m2 != null ? ' עד ' + b.max_lot_m2 : '') + ' מ"ר: ' +
                  (b.max_floors != null ? b.max_floors + ' ק׳ ' : '') +
                  (b.rights_above_pct != null ? b.rights_above_pct + '%' : '')) + '</div>';
              });
            }
            if (p.categories.length > 1) {
              det += '<div><strong>אזורים נוספים חופפים:</strong> ' +
                esc(p.categories.slice(1).map((c) => c.category + (c.coverage_pct != null ? ' (' + c.coverage_pct + '%)' : '')).join(' · ')) + '</div>';
            }
            const mix = p.enrichment && p.enrichment.dwelling_mix;
            if (mix && typeof mix === 'object') {
              const ms = [];
              if (mix.max_units_per_dunam != null) ms.push('עד ' + mix.max_units_per_dunam + ' יח\'/דונם');
              if (mix.min_unit_size_m2 != null) ms.push('דירה מינ\' ' + mix.min_unit_size_m2 + ' מ"ר');
              if (Array.isArray(mix.bands)) mix.bands.forEach((b) => { if (b && b.pct != null) ms.push((b.label || '') + ' ' + b.pct + '%'); });
              if (ms.length) det += '<div><strong>תמהיל דירות:</strong> ' + esc(ms.join(' · ')) + '</div>';
            }
            if (Array.isArray(p.ch4_rules) && p.ch4_rules.length) {
              det += '<div><strong>כללי פרק 4:</strong></div>';
              p.ch4_rules.forEach((r) => {
                const v = [r.topic, (r.value ? r.value + (r.unit ? ' ' + r.unit : '') : ''), r.rule].filter(Boolean).join(' — ');
                if (v) det += '<div>• ' + esc(v) + '</div>';
              });
            }
            const bn = (p.enrichment && p.enrichment.bonuses) || [];
            if (bn.length) {
              det += '<div><strong>בונוסים והקלות (' + bn.length + '):</strong></div>';
              const seen = new Set();
              bn.forEach((b) => {
                const l = (b.label_he || '').trim();
                if (l && !seen.has(l)) { seen.add(l); det += '<div>• ' + esc(l) + (b.raw_text ? ' <span style="opacity:.6">— ' + esc(b.raw_text) + '</span>' : '') + '</div>'; }
              });
            }
            if (det) html += '<details class="parcel-rights-details" style="margin-top:6px"><summary style="cursor:pointer;color:#2563eb">פרטים מלאים ▾</summary><div style="margin-top:4px;line-height:1.6">' + det + '</div></details>';
            if (dom.calculation) {
              const c = dom.calculation;
              const bindingHe = c.binding === 'envelope'
                ? 'המעטפת מגבילה — ' + esc(c.far_above_pct) + '% לא נכנס במלואו בקווי הבניין'
                : 'הזכויות נכנסות בקווי הבניין (האחוזים קובעים)';
              html += '<div style="margin-top:8px;padding:6px 8px;background:rgba(37,99,235,0.10);border-right:3px solid #60a5fa;border-radius:4px">' +
                '<div style="font-weight:700;margin-bottom:4px">שורה תחתונה — זכויות בנייה (מסלול הריסה ובנייה)</div>' +
                '<div>לפי אחוזים (' + esc(c.far_above_pct) + '% × מגרש): ' + esc(c.total_buildable_far_m2) + ' מ"ר</div>' +
                (c.est_above_envelope_m2 != null ? '<div>לפי מעטפת קווי בניין (' + esc(c.floors) + ' קומות): ' + esc(c.est_above_envelope_m2) + ' מ"ר</div>' : '') +
                '<div style="font-weight:700">מותר לבנייה (הקובע): ' + esc(c.est_above_binding_m2) + ' מ"ר</div>' +
                (c.below_ground_far_m2 != null ? '<div>מתחת לקרקע (' + esc(c.far_below_pct) + '%): ' + esc(c.below_ground_far_m2) + ' מ"ר</div>' : '') +
                (c.est_max_units != null ? '<div>מס\' יח"ד מירבי (אומדן, §4.1.2ח): ~' + esc(c.est_max_units) + (c.unit_basis ? ' <span style="opacity:.7;font-size:.85em">(' + esc(c.unit_basis.service_pct) + '% שירות · ~' + esc(c.unit_basis.avg_unit_m2) + ' מ"ר/יח"ד · מקס\' ' + esc(c.unit_basis.per_dunam_cap) + '/דונם)</span>' : '') + '</div>' : '') +
                '<div style="margin-top:4px;opacity:.8;font-size:.9em">' + esc(bindingHe) + '</div>' +
                '<div style="margin-top:4px;opacity:.65;font-size:.82em">' + esc(c.note) + '</div>' +
                '</div>';
              if (c.hizuk) {
                const hz = c.hizuk;
                html += '<div style="margin-top:8px;padding:6px 8px;background:rgba(16,185,129,0.10);border-right:3px solid #34d399;border-radius:4px">' +
                  '<div style="font-weight:700;margin-bottom:4px">מסלול חלופי — חיזוק ותוספות (תמ"א 38/23)</div>' +
                  '<div>תוספת: +' + esc(hz.added_full_floors) + ' קומות מלאות + קומת גג חלקית</div>' +
                  (hz.added_floors_area_m2 != null ? '<div>שטח הקומות הנוספות (אומדן): ' + esc(hz.added_floors_area_m2) + ' מ"ר</div>' : '') +
                  (hz.roof_area_m2 != null ? '<div>קומת גג חלקית: ' + esc(hz.roof_area_m2) + ' מ"ר</div>' : '') +
                  (hz.added_total_m2 != null ? '<div style="font-weight:700">סה"כ תוספת מוערכת: ' + esc(hz.added_total_m2) + ' מ"ר</div>' : '') +
                  '<div>הרחבת יח"ד קיימת: עד ' + esc(hz.expand_per_existing_unit_m2) + ' מ"ר ליח"ד</div>' +
                  '<div style="margin-top:4px;opacity:.65;font-size:.82em">' + esc(hz.note) + '</div>' +
                  '</div>';
              }
            }
          } else if (p.rights_mode === 'cell_polygons' && Array.isArray(p.cells) && p.cells.length) {
            html += '<div class="parcel-plan-rights">' + p.cells.slice(0, 8).map(function (c) {
              var r = c.rights || {}; var parts = [];
              if (r.floors != null) parts.push(r.floors + ' קומות');
              if (r.far != null) parts.push((typeof r.far === 'number' && r.far <= 100) ? (r.far + '% בנייה') : (r.far + ' מ"ר'));
              if (r.coverage_pct != null) parts.push('תכסית ' + r.coverage_pct + '%');
              if (r.housing_units != null) parts.push(r.housing_units + ' יח"ד');
              return '<div>תא ' + esc(c.cell_no) + ' (' + esc(c.zone_name || '') + ')' + (parts.length ? ' · ' + esc(parts.join(' · ')) : '')
                + (c.match_quality ? ' <span style="opacity:.65;font-size:.85em">— '
                    + (c.match_quality === 'mavat_exact' ? 'מקור: מאב"ת' : 'מקור: חילוץ OCR')
                    + '</span>' : '')
                + '</div>';
            }).join('') + '</div>';
            html += '<div style="margin-top:6px;opacity:.7;font-size:.85em">'
                  + 'הזכויות חולצו אוטומטית ממקור רשמי — לאימות מול הוועדה המקומית.</div>';
            var bnc = (p.enrichment && p.enrichment.bonuses) || [];
            if (bnc.length) {
              var sc = new Set();
              var lc = bnc.map(function (b) { return (b.label_he || '').trim(); }).filter(function (l) { return l && !sc.has(l) && sc.add(l); }).slice(0, 5);
              if (lc.length) html += '<div class="parcel-plan-bonuses">בונוסים: ' + esc(lc.join(' · ')) + '</div>';
            }
          } else if (p.rights_mode === 'building_rights_tracks' && Array.isArray(p.tracks) && p.tracks.length) {
            html += '<div class="parcel-plan-rights">' + p.tracks.slice(0, 10).map((t) => {
              const parts = [];
              if (t.far_percent != null) parts.push(t.far_percent + '%');
              if (t.floors != null) parts.push(t.floors + ' קומות');
              if (t.coverage_pct != null) parts.push('תכסית ' + t.coverage_pct + '%');
              return '<div>' + esc(t.track || '') + (parts.length ? ' · ' + esc(parts.join(' · ')) : '') + '</div>';
            }).join('') + '</div>';
            const bn = (p.enrichment && p.enrichment.bonuses) || [];
            if (bn.length) {
              const seen = new Set();
              const labels = bn.map((b) => (b.label_he || '').trim()).filter((l) => l && !seen.has(l) && seen.add(l)).slice(0, 5);
              if (labels.length) html += '<div class="parcel-plan-bonuses">בונוסים: ' + esc(labels.join(' · ')) + '</div>';
            }
          } else if (p.rights_mode === 'rova4' && p.rova4) {
            const r = p.rova4;
            const parts = [];
            if (r.max_floors != null) parts.push('עד ' + r.max_floors + ' קומות' + (r.partial_roof_floors ? ' + ' + r.partial_roof_floors + ' גג חלקי' : ''));
            if (r.coverage_pct != null) parts.push('תכסית ' + r.coverage_pct + '%');
            if (r.est_above_ground_area_m2 != null) parts.push('≈ ' + r.est_above_ground_area_m2 + ' מ"ר (עיקרי+שירות)');
            if (r.est_max_units != null) parts.push('≈ ' + r.est_max_units + ' יח"ד');
            html += '<div class="parcel-plan-rights">' +
              '<div>' + esc(r.category_label || '') + (r.fronting_street ? ' (חזית: ' + esc(r.fronting_street) + ')' : '') + '</div>' +
              (parts.length ? '<div>' + esc(parts.join(' · ')) + '</div>' : '') +
              '<div class="parcel-plan-status">' + esc(r.rights_model || '') + '</div></div>';
            let det = '';
            det += '<div><strong>אופן החישוב:</strong> תכסית מותרת × מספר קומות (זכויות נפחיות)</div>';
            if (r.coverage_basis) det += '<div><strong>תכסית:</strong> ' + esc(r.coverage_basis) + '</div>';
            if (r.coverage_area_m2 != null) det += '<div><strong>שטח תכסית (קומה טיפוסית):</strong> ' + esc(String(r.coverage_area_m2)) + ' מ"ר × ' + esc(String(r.max_floors)) + ' קומות' + (r.partial_roof_floors ? ' + גג חלקי' : '') + '</div>';
            if (r.ground_enclosed_area_m2 != null) det += '<div style="opacity:.85">· קומת קרקע — שטח מבונה ≈ ' + esc(String(r.ground_enclosed_area_m2)) + ' מ"ר <span style="opacity:.7">(ה-footprint המלא נספר בזכויות; רצועה מפולשת 3 מ׳ בחזית)</span></div>';
            if (r.roof_floors_m2 && r.roof_floors_m2.length >= 2) {
              const _rc = r.building_lines && r.building_lines.lot_type === 'corner';
              for (let _i = 0; _i < r.roof_floors_m2.length; _i++) {
                const _lbl = _rc ? ('קומת גג חלקית ' + (_i === 0 ? 'תחתונה' : 'עליונה') + ' (נסיגה 3+2 מ׳ משתי החזיתות)')
                                 : (_i === 0 ? 'קומת גג חלקית תחתונה (נסיגה 3 מ׳ קדמי)' : 'קומת גג חלקית עליונה (נסיגה 3 מ׳ קדמי + 2 מ׳ אחורי)');
                det += '<div style="opacity:.85">· ' + _lbl + ' ≈ ' + esc(String(r.roof_floors_m2[_i])) + ' מ"ר</div>';
              }
              det += '<div style="opacity:.85">· סה"כ גג חלקי ≈ ' + esc(String(r.roof_area_m2)) + ' מ"ר</div>';
            } else if (r.roof_area_m2 != null) {
              det += '<div style="opacity:.85">· קומת גג חלקית — תכסית ≈ ' + esc(String(r.roof_area_m2)) + ' מ"ר <span style="opacity:.7">(נסיגות 3/2 מ׳)</span></div>';
            }
            const _isCorner = r.building_lines && r.building_lines.lot_type === 'corner';
            {
              // Corner vs interior is DETERMINED per parcel (rights-page 2-front signal) — not a "what-if".
              // The only real alternative is party-wall (a build choice), and only for interior lots.
              const sc = [];
              if (!_isCorner && r.coverage_pct_party_wall != null) sc.push('קיר משותף ' + r.coverage_pct_party_wall + '%');
              if (sc.length) det += '<div style="opacity:.8"><strong>תרחיש חלופי:</strong> ' + esc(sc.join(' · ')) + ' <span style="opacity:.7">(בנייה צמודה לשכן)</span></div>';
            }
            if (r.est_max_units != null) det += '<div><strong>מס׳ יח"ד מקסימלי (מוערך):</strong> ' + esc(String(r.est_max_units)) + ' יח"ד <span style="opacity:.7">(שטח מעל הקרקע ÷ מקדם צפיפות)</span></div>';
            if (r.unit_density_m2 != null) det += '<div style="opacity:.8">מקדם צפיפות (שטח דירה ממוצע): ' + esc(String(r.unit_density_m2)) + ' מ"ר/יח"ד' + (r.unit_density_basis && r.unit_density_basis !== 'כללי' ? ' · ' + esc(String(r.unit_density_basis)) : '') + '</div>';
            if (r.balcony_area_m2 != null) det += '<div style="opacity:.85"><strong>מרפסות (בנוסף לזכויות):</strong> ≈ ' + esc(String(r.balcony_area_m2)) + ' מ"ר <span style="opacity:.7">(≈12 מ"ר ליח"ד · מוגבל בהבלטה ≤1.6 מ׳ — אומדן)</span></div>';
            if (r.relief_applies && r.est_max_units_relief != null) det += '<div style="opacity:.85"><strong>אופציית הקלת מגרש קטן:</strong> עד ' + esc(String(r.est_max_units_relief)) + ' יח"ד <span style="opacity:.7">(ביטול נסיגה אחורית בקומת הגג · גג ≈ ' + esc(String(r.roof_area_relief_m2)) + ' מ"ר · רשות, לפי שיקול הוועדה)</span></div>';
            if (r.building_lines) {
              const b = r.building_lines;
              det += '<div><strong>סוג מגרש:</strong> ' + (b.lot_type === 'corner' ? 'פינתי (2 חזיתות, ללא קו אחורי)' : 'רגיל') + '</div>';
              const bl = [];
              if (b.lot_type === 'corner') {
                if (b.front_m != null) bl.push('קדמי ציר ארוך: ' + b.front_m + 'מ׳');
                if (b.front2_m != null) bl.push('קדמי ציר קצר: ' + b.front2_m + 'מ׳');
                if (b.side_m != null) bl.push('צדדי ' + b.side_m + 'מ׳ (×2)');
              } else {
                if (b.front_m != null) bl.push('קדמי ' + b.front_m + 'מ׳');
                if (b.side_m != null) bl.push('צדדי ' + b.side_m + 'מ׳');
                if (b.rear_m != null) bl.push('אחורי ' + b.rear_m + 'מ׳');
              }
              if (bl.length) det += '<div><strong>קווי בניין:</strong> ' + esc(bl.join(' · ')) + (b.road_width_m != null ? ' · רוחב דרך ' + esc(String(b.road_width_m)) + 'מ׳' : '') + '</div>';
            }
            if (r.zone === 'low_build' && r.lowbuild_plan) det += '<div><strong>בנייה נמוכה:</strong> תכנית מתחמית ' + esc(r.lowbuild_plan) + ' (3-4 קומות; קוטג׳ים פחות)</div>';
            if (r.zone === 'unesco') det += '<div><strong>מתחם אונסקו:</strong> חריגה מגובה/קווי בניין = סטייה ניכרת</div>';
            if (r.nearest_main_street && !r.fronting_street) det += '<div><strong>רחוב ראשי קרוב:</strong> ' + esc(r.nearest_main_street) + ' (' + esc(String(r.dist_to_main_m)) + ' מ׳)</div>';
            if (r.est_note) det += '<div style="opacity:.7;margin-top:4px">' + esc(r.est_note) + '</div>';
            det += '<div style="opacity:.6;margin-top:4px">היקף לפי גבול תכנית ' + esc(p.pl_number || '') + '.</div>';
            if (p.status === 'בהליכי אישור') det += '<div style="margin-top:4px;color:#b45309;font-weight:600">תכנית בהליכי אישור (הכרעה בהתנגדויות) — האומדן אינו תחליף סטטוטורי; לאימות מול הוועדה המקומית.</div>';
            if (det) html += '<details class="parcel-rights-details" style="margin-top:6px"><summary style="cursor:pointer;color:#2563eb">פרטים מלאים ▾</summary><div style="margin-top:4px;line-height:1.6">' + det + '</div></details>';
          } else if (p.rights_mode === 'renewal' && p.renewal) {
            const r = p.renewal;
            if (r.street_class && r.excluded) {
              html += '<div class="parcel-plan-rights">' +
                '<div class="parcel-plan-status"><strong>רג/1900 — התחדשות בניינית</strong></div>' +
                '<div style="margin-top:6px;color:#c0623a">' + esc(r.note || 'התכנית אינה חלה על מגרש זה.') + '</div>' +
                '<div style="margin-top:6px;opacity:.7;font-size:.85em">לאימות מול הוועדה המקומית.</div>' +
                '</div>';
            } else if (r.street_class) {
              var pf = r.per_floor || {};
              var lt = r.is_corner ? 'פינתי' : 'רגיל';
              var oh = '';
              (r.options || []).forEach(function (o) {
                oh += '<div style="opacity:.85;font-size:.9em">• ' + esc(o.label_he || '') +
                      (o.plus_m2 != null ? ': +' + esc(String(o.plus_m2)) + ' מ"ר' : '') +
                      (o.note ? ' — ' + esc(o.note) : '') + '</div>';
              });
              var body;
              if (r.below_min_lot) {
                body = '<div style="margin-top:6px;color:#c0623a">' + esc(r.note || '') + '</div>';
              } else {
                body =
                  '<div>תכסית ' + esc(String(r.coverage_base_pct)) + '% מהשטח שבין קווי הבניין · ' + esc(String(r.floors)) + ' קומות</div>' +
                  (r.between_lines_area_m2 != null ? '<div class="parcel-plan-status" style="opacity:.75">שטח בין קווי הבניין ≈ ' + esc(String(r.between_lines_area_m2)) + ' מ"ר</div>' : '') +
                  '<div style="margin-top:4px">פירוט פר-קומה:</div>' +
                  '<div style="opacity:.85;font-size:.9em">• קומת קרקע: ' + esc(String(pf.ground)) + ' מ"ר' + (r.street_class === 'commercial' ? ' (בנסיגת חזית מסחרית)' : '') + '</div>' +
                  '<div style="opacity:.85;font-size:.9em">• קומה טיפוסית ×' + esc(String(pf.typical_floors_n)) + ': ' + esc(String(pf.typical)) + ' מ"ר</div>' +
                  '<div style="opacity:.85;font-size:.9em">• קומת גג (75%): ' + esc(String(pf.roof)) + ' מ"ר</div>' +
                  '<div style="margin-top:4px"><strong>סה"כ מעל הקרקע ≈ ' + esc(String(r.est_above_ground_area_m2)) + ' מ"ר</strong></div>' +
                  (r.est_max_units != null ? '<div>מס\' יח"ד מוערך: ' + esc(String(r.est_max_units)) + ' (מחלק ' + esc(String(r.unit_divisor_m2)) + ' מ"ר/יח"ד)</div>' : '') +
                  (r.balcony && r.balcony.total_m2 != null ? '<div style="margin-top:4px"><strong>מרפסות (בנוסף לזכויות):</strong> סה"כ ≈ ' + esc(String(r.balcony.total_m2)) + ' מ"ר <span style="opacity:.7">(עד ' + esc(String(r.balcony.per_unit_m2)) + ' מ"ר ליח"ד × ' + esc(String(r.est_max_units)) + ')</span></div>' + (r.balcony.front_projection_max_m2 != null ? '<div style="opacity:.8;font-size:.9em">מתוכן ניתן להבליט מעבר לקו הקדמי עד ≈ ' + esc(String(r.balcony.front_projection_max_m2)) + ' מ"ר (הבלטה 1 מ\' על 50% מהחזית) — היתר בתחום קווי הבניין.</div>' : '') : '') +
                  (r.view_funnel_note ? '<div class="parcel-plan-status" style="color:#c0623a">' + esc(r.view_funnel_note) + '</div>' : '') +
                  (oh ? '<div style="margin-top:4px">אופציות/תוספות מותנות:</div>' + oh : '');
              }
              html += '<div class="parcel-plan-rights">' +
                '<div class="parcel-plan-status"><strong>זכויות רג/1900 — הריסה ובנייה מחדש</strong></div>' +
                '<div>' + esc(r.street_class_he || '') + ' · מגרש ' + esc(String(r.lot_area_m2)) + ' מ"ר (' + lt + ')' + (r.lot_width_m != null ? ' · חזית ' + esc(String(r.lot_width_m)) + ' מ\'' : '') + '</div>' +
                body +
                '<div style="margin-top:6px;opacity:.7;font-size:.85em">' + esc(!r.below_min_lot && r.note ? r.note : 'לאימות מול הוועדה המקומית.') + '</div>' +
                '</div>';
            } else {
            const facts = [];
            if (r.coverage_base_pct != null && r.coverage_basis !== 'between_building_lines') facts.push('בסיס תכסית ' + r.coverage_base_pct + '%');
            if (r.est_max_units != null) facts.push('עד ' + r.est_max_units + ' יח"ד (' + (r.density_cap_units_per_dunam || 45) + '/דונם)');
            if (r.zone_name) facts.unshift('אזור תכנון: ' + r.zone_name);
            const sb = r.setbacks || {};
            const sbTxt = [sb.front != null ? 'קדמי ' + sb.front : null, sb.side != null ? 'צידי ' + sb.side : null, sb.rear != null ? 'אחורי ' + sb.rear : null].filter(Boolean).join(' · ');
            let scen = '';
            (r.scenarios || []).forEach(function (s) {
              scen += '<div>' + esc(s.existing_floors_label || '') + ': ' +
                      (r.zone_name ? '' : 'מקדם ' + esc(String(s.rights_coefficient)) + ' · ') + 'עד ' + esc(String(s.max_floors)) + ' קומות' +
                      (s.roof_floor ? ' + גג' : '') +
                      (s.est_above_ground_area_m2 != null ? ' · ≈ ' + esc(String(s.est_above_ground_area_m2)) + ' מ"ר' : '') +
                      '</div>';
            });
            let det = '';
            if (r.zone_name && r.lot_area_m2 != null) {
              det += '<div class="parcel-plan-status" style="opacity:.75">שטח מוערך = אחוזי בנייה (לפי אזור-התכנון) × שטח המגרש (' + esc(String(r.lot_area_m2)) + ' מ"ר)</div>';
            } else if (r.coverage_basis === 'between_building_lines' && r.between_lines_area_m2 != null) {
              det += '<div class="parcel-plan-status" style="opacity:.75">שטח ≈ תכסית% × השטח שבין קווי הבניין (' + esc(String(r.between_lines_area_m2)) + ' מ"ר, מתוך מגרש ' + esc(String(r.lot_area_m2)) + ' מ"ר) × קומות</div>';
            } else if (r.coverage_base_pct != null && r.lot_area_m2 != null) {
              det += '<div class="parcel-plan-status" style="opacity:.75">שטח = בסיס ' + esc(String(r.coverage_base_pct)) + '% × ' + esc(String(r.lot_area_m2)) + ' מ"ר × מקדם</div>';
            }
            if (r.detail) {
              const dt = r.detail, bz = dt.bonuses || {}, ln = dt.lines_he || {}, ad = dt.additions || {};
              const wb = (r.scenarios || []).map(function (s) { return s.est_above_with_bonuses; }).filter(function (x) { return x != null; });
              if (bz.total_plus_m2) det += '<div>בונוסים (סעיף 6.1, מותנים): עד +' + esc(bz.total_plus_m2) + ' מ"ר (' + esc(String(bz.total_pct)) + '%)' + (wb.length ? ' · שטח עם בונוסים: עד ' + esc(wb[wb.length - 1]) + ' מ"ר' : '') + '</div>';
              (bz.items || []).forEach(function (it) {
                det += '<div style="opacity:.8;font-size:.9em">• ' + esc(it.label_he || it.code || '') + ' (' + esc(String(it.pct)) + '%' + (it.plus_m2 != null ? ', +' + esc(it.plus_m2) + ' מ"ר' : '') + ')</div>';
              });
              const extra = [];
              if (ad.public_m2) extra.push((ln.public || 'שטח ציבורי') + ': +' + ad.public_m2 + ' מ"ר');
              if (ad.amenity_m2) extra.push((ln.amenity || 'שטחים משותפים') + ': +' + ad.amenity_m2 + ' מ"ר');
              ['balconies', 'commercial', 'basement', 'unit_mix'].forEach(function (k) { if (ln[k]) extra.push(ln[k]); });
              if (extra.length) det += '<div class="parcel-plan-status" style="margin-top:4px"><strong>זכויות נוספות:</strong></div>' + extra.map(function (t) { return '<div style="opacity:.8;font-size:.9em">• ' + esc(t) + '</div>'; }).join('');
              const sc = [ln.scope, ln.height_cap].filter(Boolean).join(' · ');
              if (sc) det += '<div class="parcel-plan-status" style="opacity:.7">' + esc(sc) + '</div>';
            }
            html += '<div class="parcel-plan-rights">' +
              '<div class="parcel-plan-status"><strong>זכויות התחדשות (הריסה ובנייה מחדש)</strong></div>' +
              (facts.length ? '<div>' + esc(facts.join(' · ')) + '</div>' : '') +
              (sbTxt ? '<div>קווי בניין: ' + esc(sbTxt) + ' מ\'</div>' : '') +
              (scen ? ((r.scenarios || []).length > 1 ? '<div style="margin-top:4px">תרחישים אפשריים (לפי נתוני המגרש/הבניין):</div>' : '') + scen : '') +
              det +
              '<div style="margin-top:6px;opacity:.7;font-size:.85em">' + esc(r.note || 'הזכויות חולצו מתקנון התכנית — לאימות מול הוועדה המקומית.') + '</div>' +
              (!r.detail && r.bonus_note ? '<div class="parcel-plan-status" style="opacity:.75">' + esc(r.bonus_note) + '</div>' : '') +
              '</div>';
            }
          } else if (p.rights_mode === 'landuse' && p.landuse && Array.isArray(p.landuse.designations) && p.landuse.designations.length) {
            const d0 = p.landuse.designations[0];
            html += '<div class="parcel-plan-rights">' +
              '<div>ייעוד: ' + esc(d0.landuse_label || '') +
              (d0.pct_of_parcel != null ? ' <span style="opacity:.7">(' + esc(String(d0.pct_of_parcel)) + '% מהחלקה)</span>' : '') + '</div>' +
              '<div class="parcel-plan-status">טרם חולצו זכויות מספריות לתכנית זו</div></div>';
          } else if (p.rights_mode === 'mavat_quantities' && Array.isArray(p.quantities) && p.quantities.length) {
            html += '<div class="parcel-plan-rights">';
            html += '<div class="parcel-plan-status"><strong>כמויות מאושרות (רמת תכנית — מאב"ת)</strong></div>';
            p.quantities.forEach(function (q) {
              var val = q.add || q.auth || q.impl || '';
              html += '<div>' + esc(q.desc || '') + ': ' + esc(String(val)) + (q.unit ? ' ' + esc(q.unit) : '') +
                      (q.remark ? ' <span style="opacity:.7">(' + esc(q.remark) + ')</span>' : '') + '</div>';
            });
            if (p.floors_from_prose) html += '<div>קומות (לפי הוראות התכנית): ' + esc(String(p.floors_from_prose)) + '</div>';
            html += '<div class="parcel-plan-status" style="opacity:.7;font-size:.9em">' + esc(p.note || 'נתונים ברמת התכנית, לא פר-חלקה') + '</div>';
            html += '</div>';
          } else {
            html += '<div class="parcel-plan-status">אין זכויות מחולצות לתכנית זו (גבול בלבד).</div>';
          }
          html += '</div>';
        });
        html += '</div><span>מקור: מאגר זכויות הבנייה. ח/619 לפי מתחמי התכנית — כיסוי נמוך = לאימות ידני.</span></div>';
        return html;
      }

// ===== full report card =====
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const confLabel = (c) => c === 'high' ? 'ודאי' : (c === 'medium' ? 'בינוני' : 'לא ודאי');

  function bandsTable(bands) {
    if (!Array.isArray(bands) || !bands.length) return '';
    return '<h3>זכויות לפי גודל מגרש</h3><table><tr><th>גודל מגרש (מ"ר)</th><th>קומות</th><th>% מעל</th><th>% מתחת</th><th>% שירות</th><th>הערות</th></tr>' +
      bands.map((b) => '<tr><td>' + esc((b.min_lot_m2 != null ? b.min_lot_m2 : '') + (b.max_lot_m2 != null ? '–' + b.max_lot_m2 : (b.min_lot_m2 != null ? '+' : ''))) +
        '</td><td>' + esc(b.max_floors) + '</td><td>' + esc(b.rights_above_pct) + '</td><td>' + esc(b.rights_below_pct) +
        '</td><td>' + esc(b.service_area_pct) + '</td><td>' + esc(b.remarks || '') + '</td></tr>').join('') + '</table>';
  }
  function setbacksHtml(sb) {
    if (!sb) return '';
    const p = [];
    if (sb.front != null) p.push(['קדמי', sb.front]);
    if (sb.side != null) p.push(['צידי', sb.side]);
    if (sb.rear != null) p.push(['אחורי', sb.rear]);
    if (sb.roof_front != null) p.push(['גג קדמי', sb.roof_front]);
    if (!p.length) return '';
    return '<h3>קווי בניין (מ׳)</h3><div class="grid">' + p.map((x) => '<div class="kv"><div class="k">' + esc(x[0]) + '</div><div class="v">' + esc(x[1]) + '</div></div>').join('') + '</div>';
  }
  function mixHtml(mix) {
    if (!mix || typeof mix !== 'object') return '';
    const rows = [];
    if (mix.max_units_per_dunam != null) rows.push(['צפיפות מרבית', mix.max_units_per_dunam + ' יח\'/דונם']);
    if (mix.max_units_per_dunam_main_streets_over_1_5dunam != null) rows.push(['צפיפות ברח\' ראשי (>1.5ד\')', mix.max_units_per_dunam_main_streets_over_1_5dunam + ' יח\'/דונם']);
    if (mix.min_unit_size_m2 != null) rows.push(['גודל דירה מינ\'', mix.min_unit_size_m2 + ' מ"ר']);
    let h = '';
    if (rows.length) h += '<div class="grid">' + rows.map((r) => '<div class="kv"><div class="k">' + esc(r[0]) + '</div><div class="v">' + esc(r[1]) + '</div></div>').join('') + '</div>';
    if (Array.isArray(mix.bands) && mix.bands.length) {
      h += '<table><tr><th>סוג דירה</th><th>טווח (מ"ר)</th><th>אחוז</th></tr>' +
        mix.bands.map((b) => '<tr><td>' + esc(b.label) + '</td><td>' + esc((b.size_min_m2 != null ? b.size_min_m2 : '') + (b.size_max_m2 != null ? '–' + b.size_max_m2 : '+')) + '</td><td>' + esc(b.pct != null ? b.pct + '%' : '') + '</td></tr>').join('') + '</table>';
    }
    return h ? '<h3>תמהיל דירות</h3>' + h : '';
  }
  function ch4Html(rules) {
    if (!Array.isArray(rules) || !rules.length) return '';
    return '<h3>כללי פרק 4 (קריטיים)</h3><table><tr><th>סעיף</th><th>נושא</th><th>ערך</th><th>כלל/תנאי</th></tr>' +
      rules.map((r) => '<tr><td>' + esc(r.section) + '</td><td>' + esc(r.topic) + '</td><td>' + esc((r.value != null ? r.value : '') + (r.unit ? ' ' + r.unit : '')) + '</td><td>' + esc(r.rule || r.condition || '') + '</td></tr>').join('') + '</table>';
  }
  function bonusesHtml(bonuses) {
    if (!Array.isArray(bonuses) || !bonuses.length) return '';
    const seen = new Set(); const items = [];
    bonuses.forEach((b) => { const l = (b.label_he || '').trim(); if (l && !seen.has(l)) { seen.add(l); items.push('<li>' + esc(l) + (b.raw_text ? ' <span class="raw">— ' + esc(b.raw_text) + '</span>' : '') + '</li>'); } });
    return items.length ? '<h3>בונוסים והקלות (' + items.length + ')</h3><ul>' + items.join('') + '</ul>' : '';
  }
  function tracksHtml(tracks) {
    if (!Array.isArray(tracks) || !tracks.length) return '';
    return '<h3>זכויות (מתוך חילוץ התכנית)</h3><table><tr><th>מסלול/ייעוד</th><th>% בנייה</th><th>קומות</th><th>תכסית</th></tr>' +
      tracks.map((t) => '<tr><td>' + esc(t.track) + '</td><td>' + esc(t.far_percent != null ? t.far_percent + '%' : '') + '</td><td>' + esc(t.floors) + '</td><td>' + esc(t.coverage_pct != null ? t.coverage_pct + '%' : '') + '</td></tr>').join('') + '</table>';
  }

  function cellsTable(cells) {
    if (!Array.isArray(cells) || !cells.length) return '';
    const farTxt = (f) => f == null ? '' : ((typeof f === 'number' && f <= 100) ? f + '%' : f + ' מ"ר');
    return '<h3>זכויות לפי תא שטח</h3><table><tr><th>תא</th><th>ייעוד</th><th>בנייה</th><th>קומות</th><th>תכסית</th><th>יח"ד</th><th>גובה</th><th>מקור</th></tr>' +
      cells.map((c) => { const r = c.rights || {}; return '<tr><td>' + esc(c.cell_no) + '</td><td>' + esc(c.zone_name || '') +
        '</td><td>' + esc(farTxt(r.far)) + '</td><td>' + esc(r.floors) + '</td><td>' + esc(r.coverage_pct != null ? r.coverage_pct + '%' : '') +
        '</td><td>' + esc(r.housing_units) + '</td><td>' + esc(r.height_m) + '</td>' +
        '<td>' + esc(c.match_quality === 'mavat_exact' ? 'מאב"ת' : (c.match_quality ? 'חילוץ OCR' : '—')) + '</td></tr>'; }).join('') +
      '</table><p class="note" style="opacity:.7">הזכויות חולצו אוטומטית ממקור רשמי — לאימות מול הוועדה המקומית.</p>';
  }

  function planCard(p) {
    let h = '<div class="card"><div class="plan-title">' + esc((p.pl_number ? p.pl_number + ' · ' : '') + (p.pl_name || 'תכנית'));
    if (p.rights_mode === 'h619_methamim' && p.confidence) h += '<span class="badge ' + esc(p.confidence) + '">' + esc(confLabel(p.confidence)) + '</span>';
    h += '</div>';
    if (p.status) h += '<div class="status">' + esc(p.status) + (p.date ? ' · ' + esc(p.date) : '') + '</div>';
    if (p.rights_review && p.rights_review.status === 'manual') {
      h += '<div class="status" style="color:#b45309">⚠ זכויות לאימות ידני' +
        (p.rights_review.reason ? ' (' + esc(p.rights_review.reason) + ')' : '') + '</div>';
    }
    if (p.rights_mode === 'h619_methamim' && Array.isArray(p.categories) && p.categories.length) {
      const dom = p.categories.find((c) => c.dominant) || p.categories[0];
      const a = (dom && dom.applicable) || {};
      h += '<div class="grid">' +
        '<div class="kv"><div class="k">אזור (מתחם)</div><div class="v">' + esc(dom.category) + '</div></div>' +
        '<div class="kv"><div class="k">כיסוי/ודאות</div><div class="v">' + esc(p.dominant_coverage_pct != null ? p.dominant_coverage_pct + '%' : '—') + '</div></div>' +
        (a.max_floors != null ? '<div class="kv"><div class="k">קומות מרביות</div><div class="v">' + esc(a.max_floors) + '</div></div>' : '') +
        (a.rights_above_pct != null ? '<div class="kv"><div class="k">% בנייה מעל</div><div class="v">' + esc(a.rights_above_pct) + '%</div></div>' : '') +
        (a.rights_below_pct != null ? '<div class="kv"><div class="k">% מתחת</div><div class="v">' + esc(a.rights_below_pct) + '%</div></div>' : '') +
        '</div>';
      if (p.categories.length > 1) h += '<div class="status">אזורים נוספים חופפים: ' + esc(p.categories.slice(1).map((c) => c.category + (c.coverage_pct != null ? ' (' + c.coverage_pct + '%)' : '')).join(' · ')) + '</div>';
      h += setbacksHtml(dom.setbacks) + bandsTable(dom.bands) + mixHtml(p.enrichment && p.enrichment.dwelling_mix) + ch4Html(p.ch4_rules) + bonusesHtml(p.enrichment && p.enrichment.bonuses);
      if (dom.calculation) {
        const c = dom.calculation;
        const bindingHe = c.binding === 'envelope'
          ? 'המעטפת מגבילה — ה-' + esc(c.far_above_pct) + '% לא נכנס במלואו בקווי הבניין'
          : 'הזכויות נכנסות בקווי הבניין (האחוזים קובעים)';
        h += '<h3>שורה תחתונה — זכויות בנייה (מסלול הריסה ובנייה)</h3>' +
          '<div class="grid">' +
          '<div class="kv"><div class="k">לפי אחוזים (' + esc(c.far_above_pct) + '% × מגרש)</div><div class="v">' + esc(c.total_buildable_far_m2) + ' מ"ר</div></div>' +
          (c.est_above_envelope_m2 != null ? '<div class="kv"><div class="k">לפי מעטפת קווי בניין (' + esc(c.floors) + ' קומות)</div><div class="v">' + esc(c.est_above_envelope_m2) + ' מ"ר</div></div>' : '') +
          '<div class="kv" style="font-weight:700"><div class="k">מותר לבנייה (הקובע)</div><div class="v">' + esc(c.est_above_binding_m2) + ' מ"ר</div></div>' +
          (c.below_ground_far_m2 != null ? '<div class="kv"><div class="k">מתחת לקרקע (' + esc(c.far_below_pct) + '%)</div><div class="v">' + esc(c.below_ground_far_m2) + ' מ"ר</div></div>' : '') +
          (c.est_max_units != null ? '<div class="kv"><div class="k">מס\' יח"ד מירבי (אומדן, §4.1.2ח)</div><div class="v">~' + esc(c.est_max_units) + '</div></div>' : '') +
          '</div>' +
          '<div class="status">' + bindingHe + '</div>' +
          (c.est_max_units != null && c.unit_basis ? '<div class="status" style="opacity:.75">אומדן יח"ד: לאחר ' + esc(c.unit_basis.service_pct) + '% שטחי שירות · ~' + esc(c.unit_basis.avg_unit_m2) + ' מ"ר/יח"ד ממוצע (תמהיל: 20% ≥110 מ"ר, יתר ≥50 מ"ר) · מקס\' ' + esc(c.unit_basis.per_dunam_cap) + ' יח"ד/דונם</div>' : '') +
          (Array.isArray(c.per_floor) && c.per_floor.length
            ? '<table><tr><th>קומה</th><th>תכסית</th><th>שטח</th></tr>' +
              c.per_floor.map(function(f){return '<tr><td>' + esc(f.level_name) + '</td><td>' + esc(f.coverage_pct) + '%</td><td>' + esc(f.coverage_m2) + ' מ"ר</td></tr>';}).join('') +
              '</table>' : '') +
          '<p class="note" style="opacity:.7">' + esc(c.note) + '</p>';
        if (c.hizuk) {
          const hz = c.hizuk;
          h += '<h3>מסלול חלופי — חיזוק ותוספות (תמ"א 38/23)</h3>' +
            '<div class="grid">' +
            '<div class="kv"><div class="k">תוספת קומות</div><div class="v">+' + esc(hz.added_full_floors) + ' קומות מלאות + קומת גג חלקית</div></div>' +
            (hz.added_floors_area_m2 != null ? '<div class="kv"><div class="k">שטח הקומות הנוספות (אומדן)</div><div class="v">' + esc(hz.added_floors_area_m2) + ' מ"ר</div></div>' : '') +
            (hz.roof_area_m2 != null ? '<div class="kv"><div class="k">קומת גג חלקית</div><div class="v">' + esc(hz.roof_area_m2) + ' מ"ר</div></div>' : '') +
            (hz.added_total_m2 != null ? '<div class="kv" style="font-weight:700"><div class="k">סה"כ תוספת מוערכת</div><div class="v">' + esc(hz.added_total_m2) + ' מ"ר</div></div>' : '') +
            '<div class="kv"><div class="k">הרחבת יח"ד קיימת</div><div class="v">עד ' + esc(hz.expand_per_existing_unit_m2) + ' מ"ר ליח"ד</div></div>' +
            '</div>' +
            '<p class="note" style="opacity:.7">' + esc(hz.note) + '</p>';
        }
      }
    } else if (p.rights_mode === 'cell_polygons') {
      h += cellsTable(p.cells) + mixHtml(p.enrichment && p.enrichment.dwelling_mix) + bonusesHtml(p.enrichment && p.enrichment.bonuses);
    } else if (p.rights_mode === 'building_rights_tracks') {
      h += tracksHtml(p.tracks) + mixHtml(p.enrichment && p.enrichment.dwelling_mix) + bonusesHtml(p.enrichment && p.enrichment.bonuses);
    } else if (p.rights_mode === 'rova4' && p.rova4) {
      const r = p.rova4;
      h += '<div class="grid">' +
        '<div class="kv"><div class="k">קטגוריה</div><div class="v">' + esc(r.category_label || '') + '</div></div>' +
        (r.fronting_street ? '<div class="kv"><div class="k">חזית לרחוב ראשי</div><div class="v">' + esc(r.fronting_street) + '</div></div>' : '') +
        (r.max_floors != null ? '<div class="kv"><div class="k">קומות מרביות</div><div class="v">' + esc(r.max_floors) + (r.partial_roof_floors ? ' + ' + esc(r.partial_roof_floors) + ' גג חלקי' : '') + '</div></div>' : '') +
        (r.building_lines && r.building_lines.lot_type ? '<div class="kv"><div class="k">סוג מגרש</div><div class="v">' + (r.building_lines.lot_type === 'corner' ? 'פינתי (2 חזיתות, ללא אחורי)' : 'רגיל') + '</div></div>' : '') +
        (r.coverage_pct != null ? '<div class="kv"><div class="k">תכסית' + (r.building_lines && r.building_lines.lot_type === 'corner' ? ' (פינתי)' : ' (רגיל)') + '</div><div class="v">' + esc(r.coverage_pct) + '%</div></div>' : '') +
        (r.coverage_pct_party_wall != null && !(r.building_lines && r.building_lines.lot_type === 'corner') ? '<div class="kv"><div class="k">תכסית — תרחיש קיר משותף (בנייה צמודה)</div><div class="v">' + esc(r.coverage_pct_party_wall) + '%</div></div>' : '') +
        (r.coverage_area_m2 != null ? '<div class="kv"><div class="k">שטח תכסית (קומה טיפוסית)</div><div class="v">' + esc(r.coverage_area_m2) + ' מ"ר</div></div>' : '') +
        (r.ground_enclosed_area_m2 != null ? '<div class="kv"><div class="k">קומת קרקע — שטח מבונה (אחרי מפולשת 3 מ׳)</div><div class="v">' + esc(r.ground_enclosed_area_m2) + ' מ"ר</div></div>' : '') +
        (function(){
          var f = r.roof_floors_m2;
          if (f && f.length >= 2) {
            var corner = r.building_lines && r.building_lines.lot_type === 'corner';
            var rows = '';
            for (var i = 0; i < f.length; i++) {
              var lbl = corner ? ('קומת גג חלקית ' + (i === 0 ? 'תחתונה' : 'עליונה') + ' (נסיגה 3+2 מ׳ משתי החזיתות)')
                               : (i === 0 ? 'קומת גג חלקית תחתונה (נסיגה 3 מ׳ קדמי)' : 'קומת גג חלקית עליונה (נסיגה 3 מ׳ קדמי + 2 מ׳ אחורי)');
              rows += '<div class="kv"><div class="k">' + lbl + '</div><div class="v">' + esc(f[i]) + ' מ"ר</div></div>';
            }
            return rows + '<div class="kv"><div class="k">סה"כ גג חלקי</div><div class="v">' + esc(r.roof_area_m2) + ' מ"ר</div></div>';
          }
          return r.roof_area_m2 != null ? '<div class="kv"><div class="k">קומת גג חלקית — תכסית</div><div class="v">' + esc(r.roof_area_m2) + ' מ"ר</div></div>' : '';
        })() +
        (r.est_above_ground_area_m2 != null ? '<div class="kv"><div class="k">שטח מעל הקרקע (עיקרי+שירות) ≈</div><div class="v">' + esc(r.est_above_ground_area_m2) + ' מ"ר</div></div>' : '') +
        (r.balcony_area_m2 != null ? '<div class="kv"><div class="k">מרפסות (בנוסף, ≈12 מ"ר/יח"ד) ≈</div><div class="v">' + esc(r.balcony_area_m2) + ' מ"ר</div></div>' : '') +
        (r.est_max_units != null ? '<div class="kv"><div class="k">מס׳ יח"ד מקסימלי (מוערך)</div><div class="v">' + esc(r.est_max_units) + ' יח"ד</div></div>' : '') +
        (r.unit_density_m2 != null ? '<div class="kv"><div class="k">מקדם צפיפות (שטח דירה ממוצע)</div><div class="v">' + esc(r.unit_density_m2) + ' מ"ר/יח"ד' + (r.unit_density_basis && r.unit_density_basis !== 'כללי' ? ' · ' + esc(r.unit_density_basis) : '') + '</div></div>' : '') +
        (r.relief_applies && r.est_max_units_relief != null ? '<div class="kv"><div class="k">אופציית הקלת מגרש קטן (יח"ד)</div><div class="v">עד ' + esc(r.est_max_units_relief) + ' יח"ד · גג ' + esc(r.roof_area_relief_m2) + ' מ"ר (רשות)</div></div>' : '') +
        (r.building_lines && r.building_lines.front_m != null ? '<div class="kv"><div class="k">קו בניין קדמי' + (r.building_lines.lot_type === 'corner' ? ' (ציר ארוך)' : '') + '</div><div class="v">' + esc(r.building_lines.front_m) + ' מ׳</div></div>' : '') +
        (r.building_lines && r.building_lines.front2_m != null ? '<div class="kv"><div class="k">קו בניין קדמי (ציר קצר)</div><div class="v">' + esc(r.building_lines.front2_m) + ' מ׳</div></div>' : '') +
        (r.building_lines && r.building_lines.side_m != null ? '<div class="kv"><div class="k">קו בניין צדדי</div><div class="v">' + esc(r.building_lines.side_m) + ' מ׳</div></div>' : '') +
        (r.building_lines && r.building_lines.rear_m != null ? '<div class="kv"><div class="k">קו בניין אחורי</div><div class="v">' + esc(r.building_lines.rear_m) + ' מ׳</div></div>' : '') +
        (r.building_lines && r.building_lines.road_width_m != null ? '<div class="kv"><div class="k">רוחב דרך</div><div class="v">' + esc(r.building_lines.road_width_m) + ' מ׳</div></div>' : '') +
        '</div>';
      h += '<div class="status"><strong>אופן החישוב:</strong> ' + esc(r.rights_model || 'תכסית × קומות') + ' · <strong>תכסית:</strong> ' + esc(r.coverage_basis || '') + '</div>';
      if (r.zone === 'low_build' && r.lowbuild_plan) h += '<div class="status">בנייה נמוכה — תכנית מתחמית ' + esc(r.lowbuild_plan) + ' (3-4 קומות; קוטג׳ים פחות).</div>';
      if (r.zone === 'unesco') h += '<div class="status">מתחם הכרזת אונסקו — חריגה מגובה או מקווי בניין מהווה סטייה ניכרת.</div>';
      if (r.est_note) h += '<div class="status">' + esc(r.est_note) + '</div>';
      h += '<div class="status">' + esc(r.note || '') + ' · היקף לפי גבול תכנית ' + esc(p.pl_number || '') + '.</div>';
      if (p.status === 'בהליכי אישור') h += '<div class="status" style="color:#b45309;font-weight:600">תכנית בהליכי אישור (הכרעה בהתנגדויות) — האומדן אינו תחליף סטטוטורי; לאימות מול הוועדה המקומית.</div>';
    } else if (p.rights_mode === 'renewal' && p.renewal) {
      const r = p.renewal;
      if (r.street_class && r.excluded) {
        h += '<h3>רג/1900 — התחדשות בניינית</h3>' +
          '<div class="status" style="color:#c0623a">' + esc(r.note || 'התכנית אינה חלה על מגרש זה.') + '</div>' +
          '<div class="status muted">לאימות מול הוועדה המקומית.</div>';
      } else if (r.street_class) {
        var pf = r.per_floor || {};
        var lt = r.is_corner ? 'פינתי' : 'רגיל';
        h += '<div class="grid">' +
          '<div class="kv"><div class="k">סיווג רחוב</div><div class="v">' + esc(r.street_class_he || '') + '</div></div>' +
          '<div class="kv"><div class="k">סוג מגרש</div><div class="v">' + lt + '</div></div>' +
          '<div class="kv"><div class="k">שטח מגרש</div><div class="v">' + esc(String(r.lot_area_m2)) + ' מ"ר</div></div>' +
          (r.lot_width_m != null ? '<div class="kv"><div class="k">רוחב חזית</div><div class="v">' + esc(String(r.lot_width_m)) + ' מ\'</div></div>' : '') +
          '</div>';
        if (r.below_min_lot) {
          h += '<div class="status muted">' + esc(r.note || '') + '</div>';
        } else {
          var sb = r.setbacks || {};
          h += '<div class="grid">' +
            '<div class="kv"><div class="k">תכסית (מהשטח שבין קווי הבניין)</div><div class="v">' + esc(String(r.coverage_base_pct)) + '%</div></div>' +
            '<div class="kv"><div class="k">קומות</div><div class="v">' + esc(String(r.floors)) + '</div></div>' +
            (r.between_lines_area_m2 != null ? '<div class="kv"><div class="k">שטח בין קווי הבניין</div><div class="v">' + esc(String(r.between_lines_area_m2)) + ' מ"ר</div></div>' : '') +
            (r.est_max_units != null ? '<div class="kv"><div class="k">יח"ד מוערך (מחלק ' + esc(String(r.unit_divisor_m2)) + ')</div><div class="v">' + esc(String(r.est_max_units)) + '</div></div>' : '') +
            '<div class="kv"><div class="k">קווי בניין</div><div class="v">קדמי ' + esc(String(sb.front)) + ' · צידי ' + esc(String(sb.side)) + ' · אחורי ' + esc(String(sb.rear)) + ' מ\'</div></div>' +
            '</div>';
          h += '<h3>פירוט פר-קומה</h3><table><tr><th>מרכיב</th><th>שטח מוערך</th></tr>' +
            '<tr><td>קומת קרקע' + (r.street_class === 'commercial' ? ' (בנסיגת חזית מסחרית)' : '') + '</td><td>' + esc(String(pf.ground)) + ' מ"ר</td></tr>' +
            '<tr><td>קומה טיפוסית ×' + esc(String(pf.typical_floors_n)) + '</td><td>' + esc(String(pf.typical)) + ' מ"ר</td></tr>' +
            '<tr><td>קומת גג (75%)</td><td>' + esc(String(pf.roof)) + ' מ"ר</td></tr>' +
            '<tr><td><strong>סה"כ מעל הקרקע</strong></td><td><strong>' + esc(String(r.est_above_ground_area_m2)) + ' מ"ר</strong></td></tr></table>';
          if (r.balcony && r.balcony.total_m2 != null) {
            h += '<h3>מרפסות (בנוסף לזכויות)</h3><table><tr><th>מרכיב</th><th>שטח מוערך</th></tr>' +
              '<tr><td>סה"כ שטח מרפסות (עד ' + esc(String(r.balcony.per_unit_m2)) + ' מ"ר ליח"ד × ' + esc(String(r.est_max_units)) + ' יח"ד)</td><td><strong>≈ ' + esc(String(r.balcony.total_m2)) + ' מ"ר</strong></td></tr>' +
              (r.balcony.front_projection_max_m2 != null ? '<tr><td>מתוכן להבלטה מעבר לקו הקדמי (1 מ׳ על 50% מהחזית) — היתר בתחום קווי הבניין</td><td>עד ≈ ' + esc(String(r.balcony.front_projection_max_m2)) + ' מ"ר</td></tr>' : '') +
              '</table>';
          }
          if (r.view_funnel_note) h += '<div class="status muted">' + esc(r.view_funnel_note) + '</div>';
          if (Array.isArray(r.options) && r.options.length) {
            h += '<h3>אופציות / תוספות מותנות</h3><div class="rights">' +
              r.options.map(function (o) {
                return '<div>' + esc(o.label_he || '') + (o.plus_m2 != null ? ': +' + esc(String(o.plus_m2)) + ' מ"ר' : '') + (o.note ? ' — ' + esc(o.note) : '') + '</div>';
              }).join('') + '</div>';
          }
        }
        h += '<div class="status muted">' + esc(!r.below_min_lot && r.note ? r.note : 'לאימות מול הוועדה המקומית.') + '</div>';
      } else {
      const sb = r.setbacks || {};
      h += '<div class="grid">' +
        (r.zone_name ? '<div class="kv"><div class="k">אזור תכנון</div><div class="v">' + esc(r.zone_name) + '</div></div>' : '') +
        (r.coverage_base_pct != null && r.coverage_basis !== 'between_building_lines' ? '<div class="kv"><div class="k">בסיס תכסית</div><div class="v">' + esc(String(r.coverage_base_pct)) + '%</div></div>' : '') +
        (r.coverage_basis === 'between_building_lines' && r.between_lines_area_m2 != null ? '<div class="kv"><div class="k">שטח שבין קווי הבניין</div><div class="v">' + esc(String(r.between_lines_area_m2)) + ' מ"ר</div></div>' : '') +
        (r.est_max_units != null ? '<div class="kv"><div class="k">יח"ד מרבי (' + esc(String(r.density_cap_units_per_dunam || 45)) + '/דונם)</div><div class="v">' + esc(String(r.est_max_units)) + '</div></div>' : '') +
        (sb.front != null ? '<div class="kv"><div class="k">קו בניין קדמי</div><div class="v">' + esc(String(sb.front)) + ' מ\'</div></div>' : '') +
        (sb.side != null ? '<div class="kv"><div class="k">צידי</div><div class="v">' + esc(String(sb.side)) + ' מ\'</div></div>' : '') +
        (sb.rear != null ? '<div class="kv"><div class="k">אחורי</div><div class="v">' + esc(String(sb.rear)) + ' מ\'</div></div>' : '') +
        '</div>';
      h += '<h3>' + ((r.scenarios || []).length > 1 ? 'תרחישי זכויות אפשריים' : 'זכויות בנייה מוערכות') + '</h3><table><tr><th>' + ((r.scenarios || []).length > 1 ? 'תרחיש' : 'מתווה') + '</th><th>מקדם</th><th>קומות</th><th>שטח מעל הקרקע (מוערך)</th><th>עם בונוסים §6.1</th></tr>' +
        (r.scenarios || []).map(function (s) {
          return '<tr><td>' + esc(s.existing_floors_label || '') + '</td><td>' + (r.zone_name ? '—' : esc(String(s.rights_coefficient))) +
            '</td><td>' + esc(String(s.max_floors)) + (s.roof_floor ? ' + גג' : '') +
            '</td><td>' + (s.est_above_ground_area_m2 != null ? esc(s.est_above_ground_area_m2) + ' מ"ר' : '') +
            '</td><td>' + (s.est_above_with_bonuses != null ? esc(s.est_above_with_bonuses) + ' מ"ר' : '—') + '</td></tr>';
        }).join('') + '</table>';
      if (r.zone_name && r.lot_area_m2 != null) h += '<div class="status muted">חישוב שטח מעל הקרקע: אחוזי בנייה (לפי אזור-התכנון) × שטח המגרש (' + esc(String(r.lot_area_m2)) + ' מ"ר)</div>';
      else if (r.coverage_basis === 'between_building_lines' && r.between_lines_area_m2 != null) h += '<div class="status muted">חישוב שטח מעל הקרקע: תכסית% × השטח שבין קווי הבניין (' + esc(String(r.between_lines_area_m2)) + ' מ"ר, מתוך מגרש ' + esc(String(r.lot_area_m2)) + ' מ"ר) × מספר קומות</div>';
      else if (r.coverage_base_pct != null && r.lot_area_m2 != null) h += '<div class="status muted">חישוב שטח מעל הקרקע: בסיס תכסית ' + esc(String(r.coverage_base_pct)) + '% × שטח מגרש ' + esc(String(r.lot_area_m2)) + ' מ"ר × מקדם הזכויות</div>';
      if (r.detail) {
        const dt = r.detail, bz = dt.bonuses || {}, ln = dt.lines_he || {}, ad = dt.additions || {};
        if (Array.isArray(bz.items) && bz.items.length) {
          h += '<h3>בונוסים אפשריים (סעיף 6.1) — מותנים, לשיקול הוועדה</h3><table><tr><th>בונוס</th><th>%</th><th>תוספת למגרש</th></tr>' +
            bz.items.map(function (it) {
              return '<tr><td>' + esc(it.label_he || it.code || '') + '</td><td>' + esc(String(it.pct)) + '%</td><td>' +
                (it.plus_m2 != null ? '+' + esc(it.plus_m2) + ' מ"ר' : '') + '</td></tr>';
            }).join('') +
            '<tr><td><strong>סה"כ אם כל הבונוסים מנוצלים</strong></td><td><strong>' + esc(String(bz.total_pct)) + '%</strong></td><td><strong>' +
            (bz.total_plus_m2 != null ? '+' + esc(bz.total_plus_m2) + ' מ"ר' : '') + '</strong></td></tr></table>';
        }
        const extra = [];
        if (ad.public_m2) extra.push((ln.public || 'שטח ציבורי מבונה') + ': +' + ad.public_m2 + ' מ"ר');
        if (ad.amenity_m2) extra.push((ln.amenity || 'שטחים משותפים') + ': +' + ad.amenity_m2 + ' מ"ר');
        ['balconies', 'commercial', 'basement', 'unit_mix'].forEach(function (k) { if (ln[k]) extra.push(ln[k]); });
        if (extra.length) h += '<h3>זכויות נוספות</h3><div class="rights">' + extra.map(function (t) { return '<div>' + esc(t) + '</div>'; }).join('') + '</div>';
        const sc = [ln.scope, ln.height_cap].filter(Boolean).join(' · ');
        if (sc) h += '<div class="status muted">' + esc(sc) + '</div>';
      }
      h += '<div class="status muted">' + esc(r.note || 'הזכויות חולצו מתקנון התכנית — לאימות מול הוועדה המקומית.') + '</div>';
      }
    } else if (p.rights_mode === 'landuse' && p.landuse && p.landuse.designations && p.landuse.designations.length) {
      const d0 = p.landuse.designations[0];
      h += '<div class="rights">ייעוד: ' + esc(d0.landuse_label || '') +
        (d0.pct_of_parcel != null ? ' <span class="muted">(' + esc(String(d0.pct_of_parcel)) + '% מהחלקה)</span>' : '') +
        '<div class="muted">טרם חולצו זכויות מספריות</div></div>';
    } else if (p.rights_mode === 'mavat_quantities' && Array.isArray(p.quantities) && p.quantities.length) {
      h += '<div class="status"><strong>כמויות מאושרות (רמת תכנית — מאב"ת)</strong></div>';
      h += '<div class="rights">';
      p.quantities.forEach(function (q) {
        var val = q.add || q.auth || q.impl || '';
        h += '<div>' + esc(q.desc || '') + ': ' + esc(String(val)) + (q.unit ? ' ' + esc(q.unit) : '') +
             (q.remark ? ' <span class="muted">(' + esc(q.remark) + ')</span>' : '') + '</div>';
      });
      if (p.floors_from_prose) h += '<div>קומות (לפי הוראות התכנית): ' + esc(String(p.floors_from_prose)) + '</div>';
      h += '</div>';
      h += '<div class="status muted">' + esc(p.note || 'נתונים ברמת התכנית, לא פר-חלקה') + '</div>';
    } else {
      h += '<div class="status">אין זכויות מחולצות לתכנית זו (גבול בלבד).</div>';
    }
    h += '</div>';
    return h;
  }

  global.RightsRender = {
    panelHtml: parcelRightsHtml,
    reportCard: planCard,
    escapeHtml: escapeHtml,
    reportEsc: esc,
    confLabel: confLabel
  };
})(typeof window !== 'undefined' ? window : globalThis);
