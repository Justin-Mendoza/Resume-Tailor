import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.js';
import { containsTerm, analyzeMatches, extractRequirements, evidenceCatalog } from '../src/matcher.js';
import { validateBulletRewrite, buildChange, fallbackSuggestions } from '../src/editor.js';
import { validatePdfText } from '../src/pdf-validation.js';
const {profile, resumes} = await loadData();
const requirement = (keyword, category = 'required_technical_skill', priority = 'high', extra = {}) => ({keyword, source: keyword, category, priority, ...extra});

test('technical tokens and multiword boundaries survive punctuation without substring matches', () => {
  for (const term of ['Go','C++','C#','Node.js','REST APIs','Hybrid Search']) assert.ok(containsTerm(`Required: ${term}.`, term));
  for (const [text, term] of [['Google','Go'], ['C++','C'], ['C#','C'], ['NodeXjs','Node.js'], ['JavaScript','Java']]) assert.equal(containsTerm(text, term),false);
});

test('curated synonyms deduplicate while TypeScript and JavaScript remain distinct', () => {
  const jd = 'K8s Kubernetes AWS Amazon Web Services TypeScript JavaScript';
  const rows = extractRequirements(jd,{requirements:['K8s','Kubernetes','AWS','Amazon Web Services','TypeScript','JavaScript'].map(k=>requirement(k))},profile);
  assert.equal(rows.length,4);
  const analysis=analyzeMatches(jd,{requirements:rows},profile,resumes);
  assert.equal(analysis.requirements.find(r=>r.keyword==='K8s').status,'equivalent');
});

test('invented source, invented technical keyword, and untrusted model aliases do not create coverage', () => {
  const jd='Python and Ruby on Rails required';
  assert.equal(extractRequirements(jd,{requirements:[requirement('Azure',undefined,undefined,{source:'Python'}),requirement('Go')]},profile).length,0);
  const analysis=analyzeMatches(jd,{requirements:[requirement('Ruby on Rails',undefined,undefined,{aliases:['Python']})]},profile,resumes);
  assert.equal(analysis.requirements[0].status,'unsupported');
});

test('semantic responsibility coverage requires a real evidence ID and quote; related technologies stay related', () => {
  const bullet=evidenceCatalog(profile,resumes.general_swe)[0];
  const jd='Capacity optimization; Ruby on Rails; Quantum Computing';
  const evidence=[{bulletId:bullet.id,quote:bullet.text,match:'equivalent',reason:'Capacity accomplishment'}];
  const analysis=analyzeMatches(jd,{requirements:[requirement('Capacity optimization','core_responsibility','high',{evidence}),requirement('Ruby on Rails',undefined,undefined,{evidence}),requirement('Quantum Computing','domain_experience','high',{evidence:[{...evidence[0],quote:'Fabricated unsupported quote'}]})]},profile,resumes);
  assert.equal(analysis.requirements[0].status,'equivalent');
  assert.equal(analysis.requirements[1].status,'related');
  assert.equal(analysis.requirements[2].status,'unsupported');
  assert.ok(analysis.report.missing_requirements.includes('Ruby on Rails'));
});

test('high priority coverage outranks any number of preferred skills', () => {
  const custom=structuredClone(resumes);
  for(const r of Object.values(custom)) {r.experience=[];r.projects=[];r.education=[];r.skillGroups=[{label:'Languages',skillIds:[]}];}
  custom.general_swe.skillGroups[0].skillIds=['go'];
  custom.ai_search_ml.skillGroups[0].skillIds=['python','java','cpp'];
  const analysis=analyzeMatches('Go Python Java C++',{recommended_resume:'ai_search_ml',requirements:[requirement('Go'),...['Python','Java','C++'].map(k=>requirement(k,'preferred_technical_skill','medium'))]},profile,custom);
  assert.equal(analysis.recommended_resume,'general_swe');
  assert.deepEqual(analysis.report.priority_coverage.high,{covered:1,total:1});
});

test('wording validation preserves numbers and technologies and rejects stale originals', () => {
  assert.equal(validateBulletRewrite('Built Go service for 12,000 requests, reducing latency 20%.','Built Go service for 15,000 requests, reducing latency 20%.',profile),false);
  assert.equal(validateBulletRewrite('Built Go service for 12,000 requests.','Built Python service for 12,000 requests.',profile),false);
  assert.equal(validateBulletRewrite('Built a TypeScript service.', 'Built a JavaScript service.', profile), false);
  const analysis=analyzeMatches('Kubernetes Python',{important_keywords:['Kubernetes','Python']},profile,resumes);
  const resume=resumes[analysis.recommended_resume];
  const change=fallbackSuggestions(analysis,profile,resume)[0];
  assert.ok(change);
  assert.equal(buildChange({...change.edit,original:'Stale wording',reason:change.reason,jdKeyword:change.jdKeyword,confidence:change.confidence},analysis,profile,resume),null);
});

test('PDF validation detects lost contact, reversed bullets, missing keywords, and corruption', () => {
  const resume=resumes.general_swe;
  const bullets=evidenceCatalog(profile,resume).map(b=>b.text);
  const contacts=[profile.identity.name,profile.identity.email,profile.identity.phone,...profile.identity.links].join(' ');
  const facts=[...resume.experience.flatMap(s=>{const e=profile.experience.find(e=>e.id===s.entryId);return [e.company,e.dates,e.titleVariants[s.titleVariant]];}), ...resume.projects.map(s=>profile.projects.find(e=>e.id===s.entryId).nameVariants[s.nameVariant]), ...resume.education.flatMap(s=>{const e=profile.education.find(e=>e.id===s.entryId);return [e.school,e.degree,e.dates,...e.details];}), ...profile.skills.map(s=>s.label)].join(' ');
  const text=[contacts,'Experience',...evidenceCatalog(profile,resume).filter(b=>b.id.startsWith('experience:')).map(b=>b.text),'Projects',...evidenceCatalog(profile,resume).filter(b=>b.id.startsWith('projects:')).map(b=>b.text),'Technical Skills',facts,'Education'].join('\n');
  assert.equal(validatePdfText(text,profile,resume,['C++']).passed,true);
  assert.equal(validatePdfText(text.replace(profile.identity.email,''),profile,resume).passed,false);
  assert.equal(validatePdfText([contacts,'Experience Projects Technical Skills Education',...bullets.reverse()].join('\n'),profile,resume).passed,false);
  assert.equal(validatePdfText(text,profile,resume,['Ruby on Rails']).passed,false);
  assert.equal(validatePdfText(text+'\ufffd',profile,resume).passed,false);
});
