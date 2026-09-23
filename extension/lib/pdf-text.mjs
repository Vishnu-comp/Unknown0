/* AutoFill Pro - PDF text extraction via vendored pdf.js (ES module).
   Exposes window.AFXExtractPdfText(file) -> Promise<string>. */
'use strict';

import * as pdfjsLib from '../vendor/pdf.min.mjs';

try {
  var workerUrl = new URL('../vendor/pdf.worker.min.mjs', import.meta.url);
  pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(workerUrl, { type: 'module' });
} catch (e) {
  // fall back to pdf.js's own worker resolution
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
}

window.AFXExtractPdfText = async function (file) {
  var buf = await file.arrayBuffer();
  var doc = await pdfjsLib.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    useSystemFonts: true
  }).promise;

  var lines = [];
  for (var i = 1; i <= doc.numPages; i++) {
    var page = await doc.getPage(i);
    var tc = await page.getTextContent();
    var lastY = null;
    var parts = [];
    for (var j = 0; j < tc.items.length; j++) {
      var it = tc.items[j];
      if (!('str' in it)) continue;
      var y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 3) {
        lines.push(parts.join(''));
        parts = [];
      }
      parts.push(it.str);
      lastY = y;
    }
    if (parts.length) lines.push(parts.join(''));
    if (i < doc.numPages) lines.push('');
  }

  return lines
    .map(function (s) { return String(s).replace(/[ \t]+/g, ' ').trim(); })
    .join('\n');
};
