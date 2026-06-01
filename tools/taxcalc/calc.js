// calc.js — pure calculation engine for the urban-renewal tax exemption calculator (v2).
// No DOM, no side effects. UMD wrapper: exports for Node, attaches window.TaxEngine in browser.
(function (root) {
  'use strict';

  // A seller is "benefited" (מוכר מוטב) if any of the three statutory flags is set.
  function isBenefitedSeller(flags) {
    return !!(flags.onlyHomeOwner || flags.elderly || flags.needsNursing);
  }

  // The three pinui-binui ceiling alternatives.
  // altA: 150% of the old apartment value (excluding extra building rights).
  // altB: value of a 120 m² apartment in the complex.
  // altC: value of an apartment whose area is 150% of the old area, capped at 200 m².
  function pbAlternatives(existingValue, existingAreaM2, pricePerM2) {
    return {
      altA: 1.5 * existingValue,
      altB: 120 * pricePerM2,
      altC: Math.min(1.5 * existingAreaM2, 200) * pricePerM2
    };
  }

  // Pinui-binui value ceiling = the highest of the three alternatives.
  function pbCeiling(alternatives) {
    return Math.max(alternatives.altA, alternatives.altB, alternatives.altC);
  }

  // Replacement apartment value = offered area × price per m².
  function replacementValue(replacementAreaM2, pricePerM2) {
    return replacementAreaM2 * pricePerM2;
  }

  // Cash counts toward the measured consideration only for a benefited seller.
  function eligibleCash(isBenefited, cashComponent) {
    return isBenefited ? cashComponent : 0;
  }

  // Tama 38 statutory area limit = existing area + 25 m². No 120 m² floor.
  function t38AreaLimit(existingAreaM2) {
    return existingAreaM2 + 25;
  }

  // Purchase-tax base for a cash upgrade exists only when bought from the developer.
  function upgradePurchaseTaxBase(boughtFromDeveloper, upgradeCash) {
    return boughtFromDeveloper ? upgradeCash : 0;
  }

  // Orchestrator: a flat input object -> a full result object.
  function computeDweller(input) {
    var pt = input.projectType;
    // LOCAL_REPLACEMENT_PLAN is computed with the pinui-binui rules.
    var isPB = pt === 'PINUY_BINUY' || pt === 'LOCAL_REPLACEMENT_PLAN';
    var isT38_1 = pt === 'STRENGTHENING_T38_1';
    var isT38_2 = pt === 'DEMOLITION_REBUILD_T38_2';
    var benefited = isBenefitedSeller({
      onlyHomeOwner: input.onlyHomeOwner,
      elderly: input.elderly,
      needsNursing: input.needsNursing
    });
    var result = {
      projectType: pt, isPB: isPB, isT38_1: isT38_1, isT38_2: isT38_2,
      benefited: benefited
    };

    if (isPB) {
      var alts = pbAlternatives(input.existingUnitValue, input.existingUnitAreaM2, input.newPricePerM2);
      var ceiling = pbCeiling(alts);
      var replVal = replacementValue(input.replacementAreaM2, input.newPricePerM2);
      var cashElig = eligibleCash(benefited, input.cashComponent || 0);
      var measured = replVal + cashElig;
      result.ceilingAlternatives = alts;
      result.ceiling = ceiling;
      result.replacementValue = replVal;
      result.eligibleCash = cashElig;
      result.nonEligibleCash = (input.cashComponent || 0) - cashElig;
      result.measuredConsideration = measured;
      result.exemptBase = Math.min(measured, ceiling);
      result.taxableExcess = Math.max(0, measured - ceiling);
    }

    if (isT38_1) {
      var limit1 = t38AreaLimit(input.existingUnitAreaM2);
      result.areaLimit = limit1;
      result.areaOk = input.replacementAreaM2 <= limit1;
      // 49לג(ב): cash is not a disqualifier — taxed pro-rata as sale of another right.
      result.dealHasCashPortion = !!input.dealIncludesCash;
    }

    if (isT38_2) {
      var limit2 = t38AreaLimit(input.existingUnitAreaM2);
      var replVal2 = replacementValue(input.replacementAreaM2, input.newPricePerM2);
      var areaTestOk = input.replacementAreaM2 <= limit2;
      // 49לג1(א)(1)(ב): value limit = max(49ז ceiling, sold-apt value excluding extra rights).
      var existingValueForT38_2 = input.existingUnitValue || 0;
      var valueLimit = Math.max(input.ceiling49z, existingValueForT38_2);
      var valueTestOk = replVal2 <= valueLimit;
      result.areaLimit = limit2;
      result.replacementValue = replVal2;
      result.ceiling49z = input.ceiling49z;
      result.existingUnitValueForT38_2 = existingValueForT38_2;
      result.valueLimit = valueLimit;
      result.areaTestOk = areaTestOk;
      result.valueTestOk = valueTestOk;
      result.exempt = areaTestOk || valueTestOk;
      result.upgradePurchaseTaxBase = upgradePurchaseTaxBase(
        !!input.boughtUpgradeFromDeveloper, input.upgradeCash || 0);
    }

    return result;
  }

  var engine = {
    isBenefitedSeller: isBenefitedSeller,
    pbAlternatives: pbAlternatives,
    pbCeiling: pbCeiling,
    replacementValue: replacementValue,
    eligibleCash: eligibleCash,
    t38AreaLimit: t38AreaLimit,
    upgradePurchaseTaxBase: upgradePurchaseTaxBase,
    computeDweller: computeDweller
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = engine;
  } else {
    root.TaxEngine = engine;
  }
})(typeof window !== 'undefined' ? window : this);
