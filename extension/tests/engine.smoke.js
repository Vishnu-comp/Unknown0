/* Integration smoke test: runs the generic fill engine against the demo form
   and a small Workday-like form inside JSDOM.

   Requires jsdom (optional):  npm i jsdom   (then run with NODE_PATH if hoisted)

   Run: node extension/tests/engine.smoke.js
*/
'use strict';

var path = require('path');
var fs = require('fs');

var JSDOM;
try {
  JSDOM = require('jsdom').JSDOM;
} catch (e) {
  console.log('jsdom not installed - skipping engine smoke test');
  process.exit(0);
}

var pass = 0, fail = 0;
function expectEq(actual, expected, label) {
  if (String(actual) === String(expected)) {
    pass++;
    console.log('  ok    ' + label + ' = ' + JSON.stringify(String(actual)));
  } else {
    fail++;
    console.log('  FAIL  ' + label + ' = ' + JSON.stringify(String(actual)) + ' (expected ' + JSON.stringify(String(expected)) + ')');
  }
}

function loadScripts(window, names) {
  names.forEach(function (n) {
    var code = fs.readFileSync(path.join(__dirname, '..', n), 'utf8');
    var el = window.document.createElement('script');
    el.textContent = code;
    window.document.head.appendChild(el);
  });
}

function makeDom(html) {
  var dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  // jsdom has no layout: pretend every element is visible
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0 };
  };
  return dom;
}

var profile = {
  fullName: 'Rahul Sharma', firstName: 'Rahul', lastName: 'Sharma',
  email: 'rahul@example.com', phone: '+91 98765 43210',
  dob: '1995-08-17', gender: 'Male',
  address1: '12 MG Road', address2: 'Indiranagar', city: 'Bengaluru', state: 'Karnataka',
  zip: '560038', country: 'India',
  linkedin: 'https://linkedin.com/in/rahul', github: 'https://github.com/rahul',
  currentCompany: 'Acme Pvt Ltd', currentTitle: 'Senior Software Engineer',
  yearsExperience: '4', currentCTC: '12 LPA', expectedCTC: '18 LPA', noticePeriod: '30',
  skills: 'Java, Spring Boot', workAuthorization: 'Yes', willingToRelocate: 'Yes',
  summary: 'SWE with 4y experience',
  customAnswers: [{ keywords: 'hear about us, source', answer: 'LinkedIn' }]
};

// ---------------------------------------------------------------
console.log('\n— generic engine on the demo form —');
var demoHtml = fs.readFileSync(path.join(__dirname, '..', 'demo', 'sample-form.html'), 'utf8');
var dom = makeDom(demoHtml);
loadScripts(dom.window, ['lib/utils.js', 'lib/aliases.js', 'lib/engine.js']);
var w = dom.window;
var stats = w.AFX.Engine.fillAll(profile, {});
console.log('  fill stats: ' + JSON.stringify(stats.fields));
var d = w.document;
expectEq(d.querySelector('[name=fullname]').value, 'Rahul Sharma', 'full name');
expectEq(d.querySelector('[name=fname]').value, 'Rahul', 'first name');
expectEq(d.querySelector('[name=lname]').value, 'Sharma', 'last name');
expectEq(d.querySelector('[name=email]').value, 'rahul@example.com', 'email');
expectEq(d.querySelector('[name=mobile]').value, '+91 98765 43210', 'mobile');
expectEq(d.querySelector('[name=dob]').value, '08/17/1995', 'dob (formatted)');
expectEq(d.querySelector('[name=gender]').value, 'Male', 'gender select');
expectEq(d.querySelector('[name=addr1]').value, '12 MG Road', 'address 1');
expectEq(d.querySelector('[name=city]').value, 'Bengaluru', 'city');
expectEq(d.querySelector('[name=state]').value, 'Karnataka', 'state');
expectEq(d.querySelector('[name=pin]').value, '560038', 'pin code');
expectEq(d.querySelector('[name=country]').value, 'India', 'country');
expectEq(d.querySelector('[name=company]').value, 'Acme Pvt Ltd', 'company');
expectEq(d.querySelector('[name=title]').value, 'Senior Software Engineer', 'job title');
expectEq(d.querySelector('[name=expYears]').value, '4', 'experience years');
expectEq(d.querySelector('[name=ctc]').value, '12 LPA', 'current ctc');
expectEq(d.querySelector('[name=ectc]').value, '18 LPA', 'expected ctc');
expectEq(d.querySelector('[name=notice]').value, '30', 'notice period');
expectEq(d.querySelector('[name=skills]').value, 'Java, Spring Boot', 'skills');
expectEq(d.querySelector('[name=workauth][value=Yes]').checked, 'true', 'work auth radio');
expectEq(d.querySelector('[name=relocate][value=Yes]').checked, 'true', 'relocate radio');
expectEq(d.querySelector('[name=linkedin]').value, 'https://linkedin.com/in/rahul', 'linkedin');
expectEq(d.querySelector('[name=github]').value, 'https://github.com/rahul', 'github');
expectEq(d.querySelector('[name=about]').value, 'SWE with 4y experience', 'about you');
expectEq(d.querySelector('[name=source]').value, 'LinkedIn', 'custom answer');

// ---------------------------------------------------------------
console.log('\n— workday-style automation ids + dropdown —');
var wdHtml =
  '<form>' +
  '  <div data-automation-id="legalNameSection">' +
  '    <input data-automation-id="firstName" id="f1" /><label for="f1">First Name</label>' +
  '    <input data-automation-id="lastName" id="f2" /><label for="f2">Last Name</label>' +
  '    <input data-automation-id="emailAddress" id="f3" /><label for="f3">Email</label>' +
  '    <input data-automation-id="addressLine1" id="f4" /><label for="f4">Address Line 1</label>' +
  '    <input data-automation-id="city" id="f5" /><label for="f5">City</label>' +
  '    <input data-automation-id="postalCode" id="f6" /><label for="f6">Postal Code</label>' +
  '    <select data-automation-id="gender" id="f7"><option value="">Select</option><option>Male</option><option>Female</option></select>' +
  '    <input type="text" id="q1" /><label for="q1">How many years of experience do you have?</label>' +
  '  </div>' +
  '</form>';
var dom2 = makeDom(wdHtml);
loadScripts(dom2.window, ['lib/utils.js', 'lib/aliases.js', 'lib/engine.js', 'adapters/workday.js']);
var w2 = dom2.window;
var wd = w2.AFX.adapters['workday'];
expectEq(wd.detect(), 'true', 'workday detected');
wd.fill(profile).then(function (stats) {
  console.log('  fill stats: ' + JSON.stringify(stats.fields));
  var d2 = w2.document;
  expectEq(d2.querySelector('[data-automation-id=firstName]').value, 'Rahul', 'wd firstName');
  expectEq(d2.querySelector('[data-automation-id=lastName]').value, 'Sharma', 'wd lastName');
  expectEq(d2.querySelector('[data-automation-id=emailAddress]').value, 'rahul@example.com', 'wd email');
  expectEq(d2.querySelector('[data-automation-id=addressLine1]').value, '12 MG Road', 'wd address');
  expectEq(d2.querySelector('[data-automation-id=city]').value, 'Bengaluru', 'wd city');
  expectEq(d2.querySelector('[data-automation-id=postalCode]').value, '560038', 'wd postal');
  expectEq(d2.querySelector('[data-automation-id=gender]').value, 'Male', 'wd gender select');
  expectEq(d2.querySelector('#q1').value, '4', 'wd generic question');

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  console.error('smoke error', e);
  process.exit(1);
});
