// 버전 올리기: node tools/bump-version.mjs 1.1.2 "바뀐 점 한 줄"
// 화면 파일의 캐시 문자열(?v=), 앱 버전(APP_VER), 서버 버전(VERSION), version.json 을 한 번에 같은 값으로 바꿈.
// 홈 화면 앱은 version.json 이 바뀐 걸 보고 스스로 새로 고침해. (?v= 가 안 바뀌면 옛 파일이 캐시에 남을 수 있음)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [ver, ...noteParts] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(ver || '')) {
  console.error('사용법: node tools/bump-version.mjs 1.1.2 "바뀐 점 한 줄"');
  process.exit(1);
}
const notes = noteParts.join(' ').trim();

const edits = [
  ['index.html', [[/(app\.(?:css|js)\?v=)\d+\.\d+\.\d+/g, `$1${ver}`]]],
  ['app.js', [
    [/(\.\/(?:checks|lib)\.js\?v=)\d+\.\d+\.\d+/g, `$1${ver}`],
    [/^const APP_VER = '\d+\.\d+\.\d+';/m, `const APP_VER = '${ver}';`],
    [/^\/\/ 글공장 앱 \d+\.\d+\.\d+/m, `// 글공장 앱 ${ver}`],
  ]],
  ['lib.js', [[/(\.\/checks\.js\?v=)\d+\.\d+\.\d+/g, `$1${ver}`]]],
  ['supabase/functions/blog-app/index.ts', [
    [/^const VERSION = "\d+\.\d+\.\d+";/m, `const VERSION = "${ver}";`],
    [/^(\/\/ 블로그 글공장 서버 API \()\d+\.\d+\.\d+\)/m, `$1${ver})`],
  ]],
];

let changed = 0;
for (const [file, rules] of edits) {
  const path = join(ROOT, file);
  let src = readFileSync(path, 'utf8');
  const before = src;
  for (const [re, rep] of rules) {
    if (!re.test(src)) { console.error(`${file}: 바꿀 자리를 못 찾았어 (${re})`); process.exit(1); }
    re.lastIndex = 0;
    src = src.replace(re, rep);
  }
  if (src !== before) { writeFileSync(path, src); changed++; console.log('바꿈:', file); }
}
const vPath = join(ROOT, 'version.json');
const prev = JSON.parse(readFileSync(vPath, 'utf8'));
writeFileSync(vPath, JSON.stringify({ version: ver, notes: notes || prev.notes || '' }, null, 2) + '\n');
console.log(`version.json → ${ver}${notes ? ' (' + notes + ')' : ''}`);
console.log(`${changed}개 파일 + version.json 완료. 서버 함수는 따로 다시 배포해야 해.`);
