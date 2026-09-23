/* AutoFill Pro - Naukri.com adapter.
   Covers the profile editor ("Update profile") and the apply forms
   (including company forms hosted by Naukri). */
'use strict';

AFX.adapters = AFX.adapters || {};

AFX.adapters['naukri'] = (function () {
  var U = AFX.utils;
  var E = AFX.Engine;
  var AL = AFX.aliases;

  function detect() {
    return /(^|\.)naukri\.com$/.test(location.hostname) || /(^|\.)naukrigulf\.com$/.test(location.hostname);
  }

  /** Naukri keeps experience as two selects (years + months) and salary in lakhs. */
  function fillExperienceSelects(profile) {
    var n = 0;
    var all = document.querySelectorAll('select, input');
    Array.prototype.forEach.call(all, function (el) {
      var label = U.normalize(U.elementLabel(el));
      if (!label) return;
      var v = null;
      if (/(exp|experience).{0,12}(year|yr)/.test(label) || /year.{0,8}(exp|experience)/.test(label)) {
        v = E.resolveValue(profile, 'yearsExperience');
      } else if (/(exp|experience).{0,12}month/.test(label) || /month.{0,8}(exp|experience)/.test(label)) {
        v = E.resolveValue(profile, 'monthsExperience');
      }
      if (v && el.tagName === 'SELECT') n += E.fillSelectOption(el, v) ? 1 : 0;
    });
    return n;
  }

  function fillResumes(profile) {
    if (!profile.resume || !profile.resume.dataBase64) return 0;
    var count = 0;
    document.querySelectorAll('input[type="file"]').forEach(function (el) {
      var label = U.elementLabel(el) + ' ' + (el.closest('section, div') ? el.closest('section, div').innerText : '');
      // never attach the resume to photo / ID-proof uploads
      if (/photo|image|picture|passport|aadhar|aadhaar|pan\b|signature/i.test(label)) return;
      if (/resume|cv|document|upload/i.test(label) || /pdf|docx?/.test(el.accept || '')) {
        if (E.attachResume(el, profile.resume)) count++;
      }
    });
    return count;
  }

  async function fill(profile) {
    var stats = E.fillAll(profile, {});
    var extra = fillExperienceSelects(profile);
    if (extra) {
      stats.fields.experienceSelects = extra;
    }
    var files = fillResumes(profile);
    if (files) {
      stats.filled += files;
      stats.files = (stats.files || 0) + files;
      stats.fields.resume = files;
    }
    return stats;
  }

  return { id: 'naukri', name: 'Naukri', detect: detect, fill: fill };
})();
