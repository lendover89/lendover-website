/* levy-logic.js — pure development-levy calculation logic.
   Loaded as a browser global before app.js; also usable as a Node module. */
'use strict';

/* Component type of a levy row, from its charge_base classification.
   'land'     — one-time per plot (charged once, on first development)
   'building' — per construction (charged on every new built area)
   'other'    — unknown / not area-based */
function levyComponent(chargeBase) {
  if (chargeBase === 'שטח_מגרש') return 'land';
  if (chargeBase === 'שטח_מבנה' || chargeBase === 'מרתף' || chargeBase === 'נפח') return 'building';
  return 'other';
}

/* Chargeable quantity (m²) for a levy row given the levy state.
   state = { existing:'none'|'demolish'|'keep', area, plot, demoArea }
   Returns { ok:true, qty, basis } or { ok:false, reason }. */
function levyQty(state, chargeBase) {
  if (chargeBase === 'שטח_מגרש') {
    if (!(state.plot > 0)) return { ok: false, reason: 'הזן שטח מגרש' };
    return { ok: true, qty: state.plot, basis: 'שטח מגרש' };
  }
  if (chargeBase === 'שטח_מבנה') {
    if (!(state.area > 0)) return { ok: false, reason: 'הזן שטח בנייה' };
    const qty = state.existing === 'demolish'
      ? Math.max(0, state.area - (state.demoArea || 0))
      : state.area;
    return { ok: true, qty: qty, basis: 'שטח בנייה' };
  }
  if (chargeBase === 'מרתף') return { ok: false, reason: 'לפי שטח מרתף — הזן ידנית' };
  if (chargeBase === 'נפח') return { ok: false, reason: 'לפי נפח (מ"ק) — הזן ידנית' };
  return { ok: false, reason: 'בסיס חיוב לא ודאי' };
}

/* Whether a levy row should be auto-checked for the given state.
   row   = { charge_base, scenario, sign }
   state = { existing, area, plot, demoArea, agricultural } */
function levyAutoChecked(row, state) {
  if (!levyQty(state, row.charge_base).ok) return false;
  if (row.sign === '-') return false;
  if (row.scenario === 'חקלאי' && !state.agricultural) return false;
  const comp = levyComponent(row.charge_base);
  if (comp === 'land') return state.existing === 'none';
  if (comp === 'building') return true;
  return false;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { levyComponent, levyQty, levyAutoChecked };
}
