// 1.7.0 사진 사이트 더하기 (Pixabay·Unsplash) + 공공누리 사진 출처 — 가짜 fetch 로만 (실제 API는 부르지 않음)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizePixabay, pixabaySearch, pixabayPhoto, normalizeUnsplash, unsplashSearch, unsplashPhoto, isUnsplashId, PHOTO_PROVIDERS, saveStockPhoto, saveUploaded,
} from '../supabase/functions/blog-app/image_service.js';
import { attributionFor, captionHint } from '../images.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fx = (name) => new Uint8Array(readFileSync(join(ROOT, 'tests', 'fixtures', 'img', name)));
function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const r = await handler(String(url), init, calls.length);
    if (r === 'throw') throw new Error('network');
    const headers = new Map(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    return {
      ok: (r.status || 200) < 400, status: r.status || 200,
      headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
      json: async () => { if (r.json === undefined) throw new Error('no json'); return r.json; },
      arrayBuffer: async () => (r.bytes || new Uint8Array()).buffer.slice(0),
    };
  };
  f.calls = calls;
  return f;
}
function fakeDeps(fetchImpl) {
  const log = { rpc: [], upload: [], calls: [] };
  return {
    log,
    rpc: async (name, args) => { log.rpc.push({ name, args }); return name === 'image_save' ? { data: { image: { id: 'img-1', ...args.img }, slot: null }, error: null } : { data: null, error: null }; },
    upload: async (path, bytes, mime) => { log.upload.push({ path, bytes, mime }); return { error: null }; },
    remove: async () => ({ error: null }),
    download: async () => ({ ok: true, bytes: fx('photo-4x3.jpg') }),
    findImage: async () => null,
    logCall: async (p, k, s) => { log.calls.push([p, k, s]); },
    fetchImpl: fetchImpl || fakeFetch(() => ({ status: 500, json: {} })),
    now: () => new Date('2026-11-02T05:00:00Z'),
    uuid: () => '11111111-2222-4333-8444-555555555555',
  };
}

const PXB = { id: 195893, pageURL: 'https://pixabay.com/en/blossom-bloom-flower-195893/', tags: '가습기, 겨울, 거실, 창가, 선반, 여섯번째', imageWidth: 4000, imageHeight: 2250,
  previewURL: 'https://cdn.pixabay.com/photo/2013/10/15/09/12/flower-195893_150.jpg', webformatURL: 'https://pixabay.com/get/35bbf209e13e39d2_640.jpg', largeImageURL: 'https://pixabay.com/get/ed6a99fd0a76647_1280.jpg', user: 'Josch13', user_id: 48777 };
const UNS = { id: 'Dwu85P9SOIk', width: 4000, height: 3000, alt_description: 'white humidifier on a shelf', user: { name: 'Jane Doe', links: { html: 'https://unsplash.com/@jane' } },
  urls: { raw: 'https://images.unsplash.com/photo-1?ixid=x', full: 'https://images.unsplash.com/photo-1?q=85', regular: 'https://images.unsplash.com/photo-1?w=1080', small: 'https://images.unsplash.com/photo-1?w=400', thumb: 'https://images.unsplash.com/photo-1?w=200' },
  links: { html: 'https://unsplash.com/photos/Dwu85P9SOIk', download_location: 'https://api.unsplash.com/photos/Dwu85P9SOIk/download?ixid=x' } };

describe('Pixabay', () => {
  test('결과 정리: Pixabay 주소만, 태그 5개까지, 사진가 주소, 번호·페이지 없는 건 버림', () => {
    const p = normalizePixabay(PXB);
    assert.equal(p.id, 195893);
    assert.equal(p.alt, '가습기, 겨울, 거실, 창가, 선반');
    assert.equal(p.photographer_url, 'https://pixabay.com/users/Josch13-48777/');
    assert.deepEqual([p.thumb, p.download], [PXB.webformatURL, PXB.largeImageURL]);
    assert.equal(normalizePixabay({ ...PXB, largeImageURL: 'https://evil.example/x.jpg', webformatURL: 'https://evil.example/y.jpg', previewURL: 'http://cdn.pixabay.com/z.jpg' }), null, '다른 곳 주소·http 는 버림');
    assert.equal(normalizePixabay({ ...PXB, pageURL: 'https://evil.example/' }), null);
    assert.equal(normalizePixabay({ ...PXB, id: 'x' }), null);
  });
  test('검색: 키는 주소의 key 로만, 한국어면 lang=ko, 방향 바꿔 부르기, 안전 검색, 같은 검색은 다시 묻지 않음(24시간 저장)', async () => {
    assert.equal((await pixabaySearch({ fetchImpl: fakeFetch(() => ({})), key: '', query: 'a' })).code, 'photo_key_missing');
    const f = fakeFetch(() => ({ json: { totalHits: 30, hits: [PXB, { id: 1 }] } }));
    const q = '겨울 가습기 ' + Math.random();
    const r = await pixabaySearch({ fetchImpl: f, key: 'PXB-KEY', query: q, orientation: 'portrait', perPage: 24 });
    assert.equal(r.ok, true);
    assert.equal(r.photos.length, 1, '정리 안 되는 결과는 버림');
    assert.equal(r.hasNext, true);
    const u = new URL(f.calls[0].url);
    assert.equal(u.origin + u.pathname, 'https://pixabay.com/api/');
    assert.deepEqual([u.searchParams.get('key'), u.searchParams.get('lang'), u.searchParams.get('orientation'), u.searchParams.get('safesearch'), u.searchParams.get('image_type')], ['PXB-KEY', 'ko', 'vertical', 'true', 'photo']);
    const again = await pixabaySearch({ fetchImpl: f, key: 'PXB-KEY', query: q, orientation: 'portrait', perPage: 24 });
    assert.equal(f.calls.length, 1, '같은 검색은 저장해 둔 결과로');
    assert.equal(again.cached, true);
    const other = await pixabaySearch({ fetchImpl: f, key: 'PXB-KEY', query: q, orientation: 'landscape', perPage: 24 });
    assert.equal(f.calls.length, 2);
    assert.equal(new URL(f.calls[1].url).searchParams.get('orientation'), 'horizontal');
    assert.ok(!other.cached);
  });
  test('오류: 한도 초과·키 틀림·연결 실패, 사진 하나 찾기 (없으면 404)', async () => {
    const lim = await pixabaySearch({ fetchImpl: fakeFetch(() => ({ status: 429, json: {} })), key: 'K', query: '한도 ' + Math.random() });
    assert.deepEqual([lim.ok, lim.code], [false, 'photo_rate_limited']);
    assert.equal((await pixabaySearch({ fetchImpl: fakeFetch(() => ({ status: 400, json: {} })), key: 'K', query: 'x' + Math.random() })).code, 'pixabay_error');
    assert.equal((await pixabaySearch({ fetchImpl: fakeFetch(() => 'throw'), key: 'K', query: 'y' + Math.random() })).code, 'pixabay_network');
    const one = await pixabayPhoto({ fetchImpl: fakeFetch(() => ({ json: { hits: [PXB] } })), key: 'K', id: 195893 });
    assert.equal(one.photo.id, 195893);
    const none = await pixabayPhoto({ fetchImpl: fakeFetch(() => ({ json: { hits: [] } })), key: 'K', id: 5 });
    assert.deepEqual([none.status, none.code], [404, 'not_found']);
  });
  test('고르면 서버가 큰 사진을 내려받아 보관 (바로 링크 안 함), 출처 문구·라이선스 저장', async () => {
    const f = fakeFetch((url) => (url.startsWith('https://pixabay.com/api/') ? { json: { hits: [PXB] } } : url === PXB.largeImageURL ? { bytes: fx('exif.jpg') } : { status: 404, json: {} }));
    const d = fakeDeps(f);
    const r = await saveStockPhoto(d, { provider: 'pixabay', photoId: 195893, key: 'K', post: { id: 'post-1' }, slot: { key: 'k:a#1', index: 0, text: '창가 가습기' } });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(f.calls[1].url, PXB.largeImageURL);
    assert.deepEqual(d.log.calls, [['pixabay', 'photo', 200]]);
    const img = d.log.rpc.find((x) => x.name === 'image_save').args.img;
    assert.deepEqual([img.kind, img.provider, img.source_id, img.author_name, img.attribution_text], ['stock', 'pixabay', '195893', 'Josch13', '사진: Josch13 (Pixabay)']);
    assert.equal(img.license, 'Pixabay 콘텐츠 라이선스 (https://pixabay.com/service/license-summary/)');
    assert.match(d.log.upload[0].path, /^stock\/2026\/11\//);
  });
});

describe('Unsplash', () => {
  test('결과 정리: 번호 모양 검사, Unsplash 이미지 서버만, 사진가·사진 주소에 출처 표시(utm), 내려받기 알림 주소는 api.unsplash.com 만', () => {
    const p = normalizeUnsplash(UNS);
    assert.equal(p.id, 'Dwu85P9SOIk');
    assert.equal(p.photographer, 'Jane Doe');
    assert.equal(p.photographer_url, 'https://unsplash.com/@jane?utm_source=blog_factory&utm_medium=referral');
    assert.equal(p.url, 'https://unsplash.com/photos/Dwu85P9SOIk?utm_source=blog_factory&utm_medium=referral');
    assert.deepEqual([p.thumb, p.download], [UNS.urls.small, UNS.urls.regular]);
    assert.equal(p.download_location, UNS.links.download_location);
    assert.equal(normalizeUnsplash({ ...UNS, links: { ...UNS.links, download_location: 'https://evil.example/d' } }).download_location, '');
    assert.equal(normalizeUnsplash({ ...UNS, id: '../etc' }), null);
    assert.equal(normalizeUnsplash({ ...UNS, urls: { regular: 'https://evil.example/x.jpg', small: 'https://evil.example/s.jpg' } }), null);
    assert.ok(isUnsplashId('Dwu85P9SOIk') && !isUnsplashId('a b') && !isUnsplashId(123) && !isUnsplashId(''));
  });
  test('검색: Client-ID 머리글, 정사각은 squarish, 30장까지, 403·429 는 한도, 401 은 키 틀림', async () => {
    const f = fakeFetch(() => ({ json: { total: 100, total_pages: 5, results: [UNS] } }));
    const r = await unsplashSearch({ fetchImpl: f, key: 'UNS-KEY', query: 'humidifier', orientation: 'square', perPage: 50 });
    assert.equal(r.ok, true);
    assert.equal(r.photos.length, 1);
    assert.equal(r.hasNext, true);
    const u = new URL(f.calls[0].url);
    assert.equal(u.origin + u.pathname, 'https://api.unsplash.com/search/photos');
    assert.deepEqual([u.searchParams.get('orientation'), u.searchParams.get('per_page'), u.searchParams.get('content_filter')], ['squarish', '30', 'high']);
    assert.deepEqual(f.calls[0].init.headers, { Authorization: 'Client-ID UNS-KEY', 'Accept-Version': 'v1' });
    assert.ok(!f.calls[0].url.includes('UNS-KEY'), '키는 주소에 안 넣음');
    for (const [status, code] of [[403, 'photo_rate_limited'], [429, 'photo_rate_limited'], [401, 'unsplash_key_invalid']]) {
      assert.equal((await unsplashSearch({ fetchImpl: fakeFetch(() => ({ status, json: {} })), key: 'K', query: 'x' })).code, code);
    }
    assert.equal((await unsplashSearch({ fetchImpl: f, key: '', query: 'x' })).code, 'photo_key_missing');
  });
  test('사진 하나: 이상한 번호는 부르지도 않음, 고르면 내려받기 알림(Unsplash 규칙), 알림이 실패해도 사진은 씀', async () => {
    const f0 = fakeFetch(() => ({ json: UNS }));
    assert.equal((await unsplashPhoto({ fetchImpl: f0, key: 'K', id: '../x' })).code, 'not_found');
    assert.equal(f0.calls.length, 0);
    const f = fakeFetch((url) => (url.includes('/download') ? 'throw' : { json: UNS }));
    const r = await unsplashPhoto({ fetchImpl: f, key: 'K', id: 'Dwu85P9SOIk' });
    assert.equal(r.ok, true);
    assert.deepEqual(f.calls.map((c) => c.url), ['https://api.unsplash.com/photos/Dwu85P9SOIk', UNS.links.download_location]);
    assert.equal(f.calls[1].init.headers.Authorization, 'Client-ID K');
  });
  test('Unsplash 는 검색만: 서버가 사진을 복사해 두지 않음 (API 가이드라인 — 어디에 쓰든 API 주소로 보여줘야 함), 사용자가 받아 올리면 출처 문구를 캡션에', async () => {
    const f = fakeFetch(() => ({ json: UNS }));
    const d = fakeDeps(f);
    const r = await saveStockPhoto(d, { provider: 'unsplash', photoId: 'Dwu85P9SOIk', key: 'K' });
    assert.deepEqual([r.ok, r.status, r.code], [false, 409, 'unsplash_link_only']);
    assert.equal(f.calls.length, 0, 'Unsplash 를 부르지도 않음');
    assert.equal(d.log.upload.length, 0);
    assert.equal(PHOTO_PROVIDERS.unsplash.hotlinkOnly, true);
    const d2 = fakeDeps();
    const up = await saveUploaded(d2, { bytes: fx('tiny.jpg'), declaredMime: 'image/jpeg', rights: true, credit: '  Photo by Jane Doe on Unsplash ' });
    assert.equal(up.ok, true);
    const img = d2.log.rpc.find((x) => x.name === 'image_save').args.img;
    assert.equal(img.attribution_text, 'Photo by Jane Doe on Unsplash');
    assert.equal(img.license, '직접 올림 (사용 권한 확인함)');
    assert.equal(captionHint({ ...img, kind: 'upload', source_type: 'external' }), 'Photo by Jane Doe on Unsplash');
    assert.equal(captionHint({ kind: 'upload', source_type: 'external' }), '사진: 외부 제공 이미지', '출처 문구가 없으면 예전 그대로');
  });
  test('공급자 목록: 키 이름·한도·번호 종류', () => {
    assert.deepEqual(Object.keys(PHOTO_PROVIDERS), ['pexels', 'pixabay', 'unsplash']);
    assert.deepEqual([PHOTO_PROVIDERS.pixabay.envKey, PHOTO_PROVIDERS.unsplash.envKey], ['PIXABAY_API_KEY', 'UNSPLASH_ACCESS_KEY']);
    assert.deepEqual([PHOTO_PROVIDERS.pexels.idKind, PHOTO_PROVIDERS.pixabay.idKind, PHOTO_PROVIDERS.unsplash.idKind], ['int', 'int', 'str']);
    assert.ok(PHOTO_PROVIDERS.unsplash.hourLimit <= 50, 'Unsplash 데모 키는 시간당 50번');
  });
});

describe('직접 올리기: 공공누리·앱이 그린 카드', () => {
  test('공공누리 제1유형: 출처 기관을 라이선스·출처 문구에 남김', async () => {
    const d = fakeDeps();
    const r = await saveUploaded(d, { bytes: fx('tiny.jpg'), declaredMime: 'image/jpeg', rights: true, kogl: '문화체육관광부 「겨울 축제」' });
    assert.equal(r.ok, true);
    const img = d.log.rpc.find((x) => x.name === 'image_save').args.img;
    assert.equal(img.license, '공공누리 제1유형 (출처표시) — 문화체육관광부 「겨울 축제」');
    assert.equal(img.attribution_text, '출처: 문화체육관광부 「겨울 축제」 (공공누리 제1유형)');
    assert.equal(captionHint({ ...img, kind: 'upload', source_type: 'kogl' }), img.attribution_text);
  });
  test('앱이 그린 정보 카드·썸네일은 이름을 남기고, 사진 사이트 배경이면 사이트·사진가도', async () => {
    const d = fakeDeps();
    await saveUploaded(d, { kind: 'card', bytes: fx('tiny.png'), declaredMime: 'image/png', cardLabel: '정보 카드' });
    assert.equal(d.log.rpc.find((x) => x.name === 'image_save').args.img.license, '정보 카드 (앱에서 직접 만듦)');
    const d2 = fakeDeps();
    const bg = { id: 'bg-1', kind: 'stock', provider: 'unsplash', author_name: 'Jane Doe', attribution_text: 'Photo by Jane Doe on Unsplash', source_url: 'https://unsplash.com/photos/x', rights_confirmed: true };
    await saveUploaded(d2, { kind: 'card', bytes: fx('tiny.png'), declaredMime: 'image/png', cardLabel: '썸네일', bg });
    const img = d2.log.rpc.find((x) => x.name === 'image_save').args.img;
    assert.equal(img.license, '썸네일 (앱에서 직접 만듦) · 배경: Unsplash 사진 (Jane Doe)');
    assert.equal(img.attribution_text, 'Photo by Jane Doe on Unsplash');
    assert.equal(attributionFor({ provider: 'pixabay', author_name: '' }), '사진: 사진가 (Pixabay)');
  });
});
