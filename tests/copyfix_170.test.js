// 1.7.0 고침 (2026-11-03): 미리보기를 긁어 복사한 사진이 블로그에 '주소 연결'로만 들어가서 대표 사진이 안 되던 문제
// - 미리보기 사진 자리에 data-n·data-ph (화면이 복사할 때 '여기에 사진 넣기' 자리로 바꾸는 데 씀 — app.js onPreviewCopy)
// - 서식 그대로 복사: 첫 사진 자리에 '대표 사진' 안내
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { viewHtml, exportHtml, exportPlain, FIRST_PHOTO_NOTE, PHOTO_SLOT_STYLE } from '../lib.js';

const body = [
  '[이미지: (썸네일) 제목 카드]',
  '[프롬프트: 앱이 그리는 썸네일 — 제미나이 필요 없음]',
  '## 고르는 기준',
  '겨울엔 습도를 먼저 봐요.',
  '[이미지: 거실 창가 가습기]',
  '[프롬프트: 거실 창가 선반 위 상표 없는 흰 가습기, 4:3, 글자 없이]',
  '[이미지: 침실 협탁 위 작은 가습기]',
  '[이미지: 줄 전체가 아님] 뒤에 글',
].join('\n');
const post = { id: 'p', keyword: '가습기', titles: ['t'], program_ids: [], body };

describe('1.7.0 고침: 미리보기 사진 자리 표시', () => {
  test('사진 자리마다 번호(data-n)와 이름(data-ph) — 연결된 사진·앱이 그리는 자리·빈 자리·줄 중간 모두', () => {
    const imgs = [null, { url: 'https://oxewhsqmdkiasckvnyua.supabase.co/storage/v1/object/sign/post-images/a.jpg?token=x', alt: '가습기', label: '직접 올림' }, null];
    const v = viewHtml(post, [], imgs);
    assert.match(v, /<div class="img app" data-n="1" data-ph="사진 1 · \(썸네일\) 제목 카드">🖼 /);
    assert.match(v, /<figure class="img has" data-n="2" data-ph="사진 2 · 거실 창가 가습기"><img src="https:\/\/oxewhsqmdkiasckvnyua/);
    assert.match(v, /<div class="img" data-n="3" data-ph="사진 3 · 침실 협탁 위 작은 가습기">📷 /);
    assert.match(v, /<div class="img" data-ph="줄 전체가 아님\] 뒤에 글">📷 /, '줄 전체가 아닌 [이미지]는 번호 없이');
  });
  test('자리 이름 안의 따옴표·꺾쇠는 글자로 (속성이 깨지지 않게)', () => {
    const v = viewHtml({ body: '[이미지: "큰" <b>창</b>]' }, [], null);
    assert.match(v, /data-ph="사진 1 · &quot;큰&quot; &lt;b&gt;창&lt;\/b&gt;"/);
    assert.ok(!v.includes('<b>창</b>'));
  });
});

describe('1.7.0 고침: 서식 그대로 복사의 대표 사진 안내', () => {
  test('첫 사진 자리에만 대표 사진 안내, 이미지 주소는 여전히 안 넣음', () => {
    const html = exportHtml(post, { links: [], programs: {} });
    assert.equal(html.split(FIRST_PHOTO_NOTE).length - 1, 1, '안내는 한 번 (첫 사진만)');
    assert.match(html, /📷 사진 1: \(썸네일\) 제목 카드 \(여기에 사진 넣기\)<br><small>⭐ 첫 사진이 대표 사진이 돼/);
    assert.match(html, /📷 사진 2: 거실 창가 가습기 \(여기에 사진 넣기\)<\/p>/, '두 번째부터는 안내 없음');
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes(`style="${PHOTO_SLOT_STYLE}"`));
  });
  test('내려받을 파일 이름이 있는 자리도 첫 사진이면 안내', () => {
    const images = [{ fileName: '가습기-01.png', caption: '' }, null, null];
    const html = exportHtml(post, { links: [], programs: {}, images });
    assert.match(html, /📷 사진 1: 내려받은 「가습기-01\.png」 파일을 여기에 넣어줘<br><small>\(썸네일\) 제목 카드<\/small><br><small>⭐ 첫 사진이 대표 사진이 돼/);
  });
  test('사진 자리가 없는 글은 안내도 없음', () => {
    assert.ok(!exportHtml({ body: '## 제목\n본문' }, {}).includes(FIRST_PHOTO_NOTE));
  });
  test('텍스트만 복사는 예전 그대로 (사진 자리 한 줄)', () => {
    const t = exportPlain(post, {});
    assert.match(t, /^\(사진 1: \(썸네일\) 제목 카드\)$/m);
    assert.ok(!t.includes(FIRST_PHOTO_NOTE));
  });
});
