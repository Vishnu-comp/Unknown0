/* Node test harness for the label -> profile-field matcher.
   Run: node extension/tests/matcher.test.js */
'use strict';

var path = require('path');
require(path.join(__dirname, '..', 'lib', 'utils.js'));
var AL = require(path.join(__dirname, '..', 'lib', 'aliases.js'));

var pass = 0, fail = 0;

function expectField(label, expectedKey) {
  var m = AL.matchField(label);
  var key = m ? m.key : null;
  if (key === expectedKey) {
    pass++;
    console.log('  ok    "' + label + '" -> ' + key);
  } else {
    fail++;
    console.log('  FAIL  "' + label + '" -> ' + key + ' (expected ' + expectedKey + ')');
  }
}

function expectNoMatch(label) {
  var m = AL.matchField(label);
  if (!m) {
    pass++;
    console.log('  ok    "' + label + '" -> (blocked)');
  } else {
    fail++;
    console.log('  FAIL  "' + label + '" -> ' + m.key + ' (expected no match)');
  }
}

function expectCustom(answers, label, expectedAnswer) {
  var a = AL.matchCustomAnswer(answers, label);
  if (a === expectedAnswer) {
    pass++;
    console.log('  ok    custom "' + label + '" -> "' + a + '"');
  } else {
    fail++;
    console.log('  FAIL  custom "' + label + '" -> "' + a + '" (expected "' + expectedAnswer + '")');
  }
}

console.log('\n— identity / contact —');
expectField('Full Name', 'fullName');
expectField('Name', 'fullName');
expectField('First name', 'firstName');
expectField('First Name (as per passport)', 'firstName');
expectField('Last name', 'lastName');
expectField('Surname', 'lastName');
expectField('Middle name', 'middleName');
expectField('Email address', 'email');
expectField('E-mail', 'email');
expectField('Mobile number', 'phone');
expectField('Phone Number', 'phone');
expectField('Contact Number', 'phone');
expectField('Alternate phone', 'alternatePhone');
expectField('Date of birth', 'dob');
expectField('DOB', 'dob');
expectField('Gender', 'gender');
expectField('What is your gender?', 'gender');
expectField('Nationality', 'nationality');

console.log('\n— address —');
expectField('Address', 'address1');
expectField('Address line 1', 'address1');
expectField('Street address', 'address1');
expectField('Address Line 2', 'address2');
expectField('City', 'city');
expectField('Current city', 'city');
expectField('State', 'state');
expectField('Province', 'state');
expectField('Zip code', 'zip');
expectField('Postal Code', 'zip');
expectField('Pin code', 'zip');
expectField('Country', 'country');
expectField('Country of residence', 'country');
expectNoMatch('Country code'); // phone dialing code - must NOT be treated as country

console.log('\n— links —');
expectField('LinkedIn Profile', 'linkedin');
expectField('LinkedIn URL', 'linkedin');
expectField('GitHub', 'github');
expectField('Portfolio', 'portfolio');
expectField('Personal website', 'portfolio');
expectField('Twitter handle', 'twitter');

console.log('\n— work —');
expectField('Current Company', 'currentCompany');
expectField('Present employer', 'currentCompany');
expectField('Company name', 'currentCompany');
expectField('Job title', 'currentTitle');
expectField('Designation', 'currentTitle');
expectField('Current title', 'currentTitle');
expectField('Years of experience', 'yearsExperience');
expectField('Total experience in years', 'yearsExperience');
expectField('Total Experience', 'yearsExperience');
expectField('Experience (in months)', 'monthsExperience');
expectField('Current CTC', 'currentCTC');
expectField('Current CTC (in lakhs)', 'currentCTC');
expectField('Present salary', 'currentCTC');
expectField('Expected CTC', 'expectedCTC');
expectField('Expected salary', 'expectedCTC');
expectField('Salary expectation', 'expectedCTC');
expectField('Notice period', 'noticePeriod');
expectField('Notice Period (in days)', 'noticePeriod');
expectField('When can you join?', 'noticePeriod');
expectField('Skills', 'skills');
expectField('Key skills', 'skills');
expectField('Languages known', 'languages');
expectField('Are you legally authorized to work in the United States?', 'workAuthorization');
expectField('Do you require sponsorship?', 'workAuthorization');
expectField('Willing to relocate?', 'willingToRelocate');
expectField('Tell us about yourself', 'summary');
expectField('Cover letter', 'summary');

console.log('\n— education —');
expectField('Highest education', 'highestEducation');
expectField('Degree', 'degree');
expectField('Field of study', 'major');
expectField('Specialization', 'major');
expectField('University', 'university');
expectField('College name', 'university');
expectField('CGPA', 'gpa');
expectField('Percentage', 'gpa');
expectField('Year of graduation', 'graduationYear');
expectField('YOP', 'graduationYear');

console.log('\n— blocked labels (never auto-filled) —');
expectNoMatch('Password');
expectNoMatch('Re-enter password');
expectNoMatch('Enter captcha');
expectNoMatch('CVV');
expectNoMatch('Card number');
expectNoMatch('Social security number');
expectNoMatch('Verification code (OTP)');
expectNoMatch('Bank account number');

console.log('\n— Google Forms style questions —');
expectField('1. What is your full name?', 'fullName');
expectField('2) Email ID', 'email');
expectField('Total experience in years *', 'yearsExperience');

console.log('\n— must NOT steal questions meant for custom answers —');
expectNoMatch('How did you hear about us?');
expectNoMatch('Tell me about a time you led a team');

console.log('\n— custom answers fallback —');
var answers = [
  { keywords: 'authorized, sponsor', answer: 'Yes' },
  { keywords: 'hear about us, source', answer: 'LinkedIn' },
  { keywords: 'python', answer: '3 years' }
];
expectCustom(answers, 'Are you authorized to work in the US?', 'Yes');
expectCustom(answers, 'How did you hear about us?', 'LinkedIn');
expectCustom(answers, 'Rate your Python proficiency', '3 years');
expectCustom(answers, 'Favorite color?', null);

console.log('\n— utils: dates & yes/no —');
var U = require(path.join(__dirname, '..', 'lib', 'utils.js'));
function expectEq(actual, expected, label) {
  if (actual === expected) { pass++; console.log('  ok    ' + label + ' = ' + JSON.stringify(actual)); }
  else { fail++; console.log('  FAIL  ' + label + ' = ' + JSON.stringify(actual) + ' (expected ' + JSON.stringify(expected) + ')'); }
}
expectEq(U.formatDate('1995-08-17', 'MM/DD/YYYY'), '08/17/1995', 'US date');
expectEq(U.formatDate('1995-08-17', 'DD/MM/YYYY'), '17/08/1995', 'EU date');
expectEq(U.formatDate('1995-08-17', ''), '08/17/1995', 'default date');
expectEq(U.guessYesNo('Yes'), 'Yes', 'yes 1');
expectEq(U.guessYesNo('No'), 'No', 'yes 2');
expectEq(U.guessYesNo('Authorized to work'), 'Yes', 'yes 3');
expectEq(U.optionMatchScore('United States of America', 'USA') > 0, true, 'country synonym');
expectEq(U.optionMatchScore('United Kingdom', 'UK') > 0, true, 'uk synonym');

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
