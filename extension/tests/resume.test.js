/* Resume parser tests (pure JS, no deps). Run: node extension/tests/resume.test.js */
'use strict';

var path = require('path');
var RES = require(path.join(__dirname, '..', 'lib', 'resume.js'));

var pass = 0, fail = 0;
function expectEq(actual, expected, label) {
  if (String(actual) === String(expected)) {
    pass++; console.log('  ok    ' + label + ' = ' + JSON.stringify(String(actual)));
  } else {
    fail++; console.log('  FAIL  ' + label + ' = ' + JSON.stringify(String(actual)) + ' (expected ' + JSON.stringify(String(expected)) + ')');
  }
}
function expectContains(actual, sub, label) {
  if (String(actual).toLowerCase().indexOf(String(sub).toLowerCase()) >= 0) {
    pass++; console.log('  ok    ' + label + ' contains "' + sub + '"');
  } else {
    fail++; console.log('  FAIL  ' + label + ' = ' + JSON.stringify(String(actual)) + ' (expected to contain "' + sub + '")');
  }
}

// fictional resume with a realistic tech-resume structure
var FIXTURE = [
  'Asha Patel',
  'Bengaluru, Karnataka - 560038 | +91 98765 43210 | asha.patel@example.com',
  'linkedin.com/in/ashapatel | github.com/ashapatel | ashapatel.dev',
  '',
  'Summary',
  'Software engineer with 2 years of experience building web applications.',
  '',
  'Skills',
  'Languages: Java, Python, JavaScript | Frameworks: Spring Boot, React, Node.js',
  'Databases: MySQL, MongoDB | Tools: Git, Docker, AWS',
  '',
  'Experience',
  'SDE-1 | TechNova Solutions Pvt Ltd | Jul 2024 - Present',
  'Built REST APIs used by 40k users.',
  'Software Engineering Intern | BrightApps Technologies | Jan 2024 - Jun 2024',
  'Worked on React dashboards.',
  '',
  'Education',
  'R V College of Engineering, Bengaluru',
  'B.E. Computer Science and Engineering',
  'CGPA: 8.6 | 2020 - 2024',
  '',
  'Personal',
  'Date of birth: 14/03/2002',
  'Languages known: English, Hindi, Kannada'
].join('\n');

console.log('\n— contact & identity —');
var r = RES.parse(FIXTURE, 'Asha_Resume.pdf');
var p = r.profile;
expectEq(p.fullName, 'Asha Patel', 'fullName');
expectEq(p.firstName, 'Asha', 'firstName');
expectEq(p.lastName, 'Patel', 'lastName');
expectEq(p.email, 'asha.patel@example.com', 'email');
expectContains(p.phone, '98765 43210', 'phone');
expectContains(p.linkedin, 'linkedin.com/in/ashapatel', 'linkedin');
expectContains(p.github, 'github.com/ashapatel', 'github');
expectContains(p.portfolio, 'ashapatel.dev', 'portfolio');
expectEq(p.city, 'Bengaluru', 'city');
expectEq(p.state, 'Karnataka', 'state');
expectEq(p.zip, '560038', 'zip');
expectEq(p.dob, '2002-03-14', 'dob -> ISO');

console.log('\n— skills & languages —');
expectContains(p.skills, 'Java', 'skills has Java');
expectContains(p.skills, 'Spring Boot', 'skills has Spring Boot');
expectContains(p.skills, 'Docker', 'skills has Docker');
expectContains(p.languages, 'Hindi', 'spoken languages');

console.log('\n— experience —');
expectContains(p.currentCompany, 'TechNova', 'currentCompany');
expectContains(p.currentTitle, 'SDE-1', 'currentTitle');
expectEq(p.yearsExperience === '2' || p.yearsExperience === '3', 'true', 'yearsExperience is 2-3 (date-dependent) got ' + p.yearsExperience);
expectEq(r.filledKeys.indexOf('yearsExperience') >= 0, 'true', 'yearsExperience was filled');

console.log('\n— education —');
expectEq(p.degree, 'B.E.', 'degree');
expectContains(p.major.toLowerCase(), 'computer science', 'major');
expectContains(p.university, 'College of Engineering', 'university');
expectContains(p.gpa, '8.6', 'gpa');
expectEq(p.graduationYear, '2024', 'graduationYear');

console.log('\n— missing questions (resume never has these) —');
var keys = r.missing.map(function (m) { return m.key; });
expectEq(keys.indexOf('dob') < 0, 'true', 'dob found -> not asked');
expectEq(keys.indexOf('gender') >= 0, 'true', 'gender asked');
expectEq(keys.indexOf('expectedCTC') >= 0, 'true', 'expected CTC asked');
expectEq(keys.indexOf('noticePeriod') >= 0, 'true', 'notice period asked');

console.log('\n— filename fallbacks —');
expectEq(RES.nameFromFilename('Vishnu_SDE-1.pdf'), 'Vishnu', 'name from filename');
expectEq(RES.nameFromFilename('resume.pdf'), '', 'generic filename -> no name');
expectEq(RES.nameFromFilename('Asha_Patel_CV.pdf'), 'Asha Patel', 'two-word filename');

console.log('\n— explicit extras —');
var r2 = RES.parse('Priya Rao\npriya@example.com\nNotice Period: 30 days\nCurrent CTC: 12 LPA\nGender: Female\n', 'x.pdf');
expectEq(r2.profile.noticePeriod, '30', 'notice period parsed');
expectEq(r2.profile.currentCTC, '12 LPA', 'ctc parsed');
expectEq(r2.profile.gender, 'Female', 'gender parsed');

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
