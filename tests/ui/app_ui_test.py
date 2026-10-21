# 화면 테스트 (휴대폰 크기 390px)
# 실제 앱 파일(index.html·app.js·lib.js·checks.js)을 이 컴퓨터에서 띄우고, 서버 API만 가짜(메모리)로 바꿔서 눌러봄.
# 진짜 서버·진짜 접속 코드는 쓰지 않음. 실행: python3 tests/ui/app_ui_test.py  (Playwright + Chromium 필요)
import functools
import http.server
import io
import json
import re
import unicodedata
import zipfile
import socketserver
import sys
import threading
import traceback
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / 'tests' / 'fixtures'
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'tests' / 'ui' / 'screenshots'
API = 'https://oxewhsqmdkiasckvnyua.supabase.co/functions/v1/blog-app'
GEN = 'https://oxewhsqmdkiasckvnyua.supabase.co/functions/v1/blog-gen'  # 생성 전용 (같은 코드)
CODE = 'TEST-ONLY-CODE-not-real-123456'  # 가짜 코드
SESSION = 'test-session-token-0000000000000000'

KST = timezone(timedelta(hours=9))
TODAY = datetime.now(KST).date()
D = lambda n: (TODAY + timedelta(days=n)).isoformat()
NOW = datetime.now(timezone.utc).isoformat()


def long_body(extra=''):
    return '## 고르는 기준\n' + ('원룸에서 쓰기 좋은 기준을 차근차근 정리했어요. ' * 30) + '\n' + extra


def uid(n):
    return f'00000000-0000-4000-8000-{n:012d}'


# images.js 의 parseSlots·slotKey 와 같은 규칙 (줄 전체가 [이미지: …] 인 줄, 같은 설명은 몇 번째인지로 구분)
IMG_LINE = re.compile(r'^\s*\[이미지[^\]]*\]\s*$')


def norm_text(t):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFC', t or '').lower()).strip()


def parse_slots(body):
    out, seen = [], {}
    for line in (body or '').split('\n'):
        if not IMG_LINE.match(line):
            continue
        text = re.sub(r'^\[이미지:?\s*|\]$', '', line.strip()).strip()
        k = norm_text(text)[:150]
        seen[k] = seen.get(k, 0) + 1
        out.append({'index': len(out), 'n': len(out) + 1, 'text': text, 'key': f'k:{k}#{seen[k]}', 'heading': '', 'before': '', 'after': ''})
    return out


EXTRA = [{'key': 'x:cover', 'label': '블로그 대표 이미지', 'purpose': 'blog_cover', 'file': 'cover'},
         {'key': 'x:threads', 'label': '쓰레드 게시물 이미지', 'purpose': 'threads', 'file': 'threads'},
         {'key': 'x:ig_feed', 'label': '인스타그램 피드 이미지', 'purpose': 'ig_feed', 'file': 'instagram'},
         {'key': 'x:ig_story', 'label': '인스타 스토리·릴스 이미지', 'purpose': 'ig_story', 'file': 'story'}]
FX_IMG = {'4x3': ('/tests/fixtures/img/photo-4x3.jpg', 1280, 960), '16x9': ('/tests/fixtures/img/photo-16x9.jpg', 1536, 864), '4x5': ('/tests/fixtures/img/photo-4x5.jpg', 1080, 1350)}
RATIO_SIZE = {'16:9': '1536x864', '4:3': '1280x960', '1:1': '1024x1024', '4:5': '1024x1280', '9:16': '864x1536'}


def size_for(model, ratio):
    """서버의 sizeFor 처럼: gpt-image-2·2.5는 비율 그대로, 그 밖의 모델은 표준 크기 세 가지 중 방향이 같은 것"""
    s = RATIO_SIZE.get(ratio or '', '1280x960')
    if str(model).startswith('gpt-image-2') or model == 'gf-test-fake':
        return s
    w, h = (int(x) for x in s.split('x'))
    return '1536x1024' if w > h else '1024x1536' if w < h else '1024x1024'
SECRET_MARK = 'sk-test-SERVER-ONLY-never-sent-to-app'  # 가짜 서버가 '가지고만 있는' 키 — 화면에 절대 나오면 안 됨


class Mock:
    """앱이 부르는 서버 API를 흉내 냄. 받은 요청은 self.calls 에 쌓임."""

    def __init__(self):
        cat = json.loads((FIX / 'catalog.json').read_text(encoding='utf-8'))
        self.channels, self.programs, self.compat, self.settings = cat['channels'], cat['programs'], cat['compat'], cat['settings']
        self.calls = []
        self.force_401 = False
        self.seq = 100
        P1, P2, P3, P4, P5, P6, P7 = (uid(i) for i in range(1, 8))
        self.ids = dict(P1=P1, P2=P2, P3=P3, P4=P4, P5=P5, P6=P6, P7=P7, L1=uid(11), L2=uid(12), PR1=uid(21), PR2=uid(22), J1=uid(31), T1=uid(41))
        base = dict(money='', platform='', style='', len='2500', hashtags=[], threads='', instagram='', link='', variants={}, sources=[], summary='',
                    ai_notes={}, error='', experience='', category='겨울 가전', topic_id=None, effort_minutes=None, blog_url='', published_on=None,
                    deleted_at=None, request_id=None, disclosure_text='', disclosure_at=None, status='planned')
        self.posts = [
            {**base, 'id': P1, 'keyword': '원룸 전기요 고르는 법', 'titles': ['원룸 전기요 고르는 법'], 'stage': 'review', 'channel_id': 'naver_blog',
             'program_ids': ['coupang_partners'], 'content_type': 'buying_guide', 'publish_date': D(1), 'created_at': NOW, 'source': 'auto',
             'body': long_body('[내 경험: 써본 기간과 방 크기]\n[링크: 최저가 보기]')},
            {**base, 'id': P2, 'keyword': '창문 결로 줄이는 법', 'titles': ['겨울 창문 결로 줄이는 법 <img src=x onerror=alert(1)>'], 'stage': 'review',
             'channel_id': 'tistory', 'program_ids': ['google_adsense'], 'content_type': 'problem_solving', 'publish_date': D(2), 'created_at': NOW,
             'source': 'auto', 'body': '## 창문 결로가 생기는 이유\n' + ('창문 결로는 실내와 바깥 온도 차 때문에 생겨요. ' * 25)
             + '\n<script>alert(1)</script> 이런 글자도 그대로 글자로 보여야 해요.\n## 결로 줄이는 법\n- 자주 환기하기\n- 제습하기'},
            {**base, 'id': P3, 'keyword': '전기요 두 가지 비교', 'titles': ['전기요 두 가지 비교'], 'stage': 'published', 'status': 'published',
             'channel_id': 'naver_blog', 'program_ids': ['coupang_partners'], 'content_type': 'comparison', 'publish_date': D(-10),
             'published_on': D(-10), 'blog_url': 'https://blog.naver.com/example/1', 'created_at': NOW, 'source': 'request',
             'body': long_body('[링크: 첫 번째 상품 보기]\n중간 설명이에요.\n[링크2: 두 번째 상품 보기]')},
            {**base, 'id': P4, 'keyword': '가습기 세척 쉬운 타입', 'titles': [], 'stage': 'queued', 'channel_id': 'naver_blog',
             'program_ids': ['coupang_partners'], 'content_type': '', 'publish_date': None, 'created_at': NOW, 'source': 'request', 'body': ''},
            {**base, 'id': P5, 'keyword': '손난로 후기', 'titles': [], 'stage': 'verify', 'channel_id': 'naver_blog', 'program_ids': ['coupang_partners'],
             'content_type': 'experience_review', 'publish_date': None, 'created_at': NOW, 'source': 'request', 'body': '',
             'error': '후기 글은 실제 경험이 필요해. 써본 기간·환경·느낀 점을 적고 다시 요청해줘.'},
            # 고지문이 비어 있는 수익 모델(네이버 쇼핑 커넥트) → 복사 막힘
            {**base, 'id': P6, 'keyword': '전기요 세탁 방법', 'titles': ['전기요 세탁 방법'], 'stage': 'review', 'channel_id': 'naver_blog',
             'program_ids': ['naver_shopping_connect'], 'content_type': 'how_to', 'publish_date': None, 'created_at': NOW, 'source': 'request',
             'body': '## 전기요 세탁 전 확인할 것\n' + ('세탁 전에 라벨의 세탁 표시를 먼저 확인해요. ' * 20)},
            # 고지문이 애매한 경우를 시험할 토스 쉐어링크 원고
            {**base, 'id': P7, 'keyword': '손난로 고르는 법', 'titles': ['손난로 고르는 법'], 'stage': 'review', 'channel_id': 'naver_blog',
             'program_ids': ['toss_sharelink'], 'content_type': 'buying_guide', 'publish_date': None, 'created_at': NOW, 'source': 'request',
             'body': '## 손난로 고를 때 볼 것\n' + ('충전식인지 일회용인지 먼저 정해요. ' * 25)},
            # 이미지 스튜디오: 사진 자리 3곳 (하나는 실제 사진이 필요한 '구성품' 자리)
            {**base, 'id': uid(8), 'keyword': '무선청소기 보관', 'titles': ['원룸 무선청소기 보관 방법'], 'stage': 'review', 'channel_id': 'naver_blog',
             'program_ids': ['coupang_partners'], 'content_type': 'buying_guide', 'publish_date': None, 'created_at': NOW, 'source': 'request',
             'body': '## 보관 요령\n' + ('원룸에서 청소기를 세워 두는 기준을 정리했어요. ' * 20) + '\n[이미지: 작은 원룸에서 무선청소기를 보관하는 모습]\n보관할 때는 벽에 붙여요.\n'
                     '## 고르는 기준\n- 무게\n- 흡입력\n[이미지: 무선청소기 구성품을 펼쳐 놓은 사진]\n[이미지: 깔끔한 거실 바닥]\n[링크: 최저가 보기]'},
        ]
        I = self.ids
        self.links = [
            {'id': I['L1'], 'post_id': P3, 'url': 'https://link.coupang.com/a/aaa111', 'cta': '첫 번째 상품 보기', 'program_id': 'coupang_partners',
             'channel_id': 'naver_blog', 'product_id': I['PR1'], 'status': '정상', 'status_note': '', 'checked_at': D(-9), 'sort': 0, 'created_at': NOW},
            {'id': I['L2'], 'post_id': P3, 'url': 'https://link.coupang.com/a/bbb222', 'cta': '두 번째 상품 보기', 'program_id': 'coupang_partners',
             'channel_id': 'naver_blog', 'product_id': I['PR2'], 'status': '정상', 'status_note': '', 'checked_at': D(-9), 'sort': 1, 'created_at': NOW},
        ]
        prod = dict(brand='예시', category='전기요', price=None, price_checked_at=None, price_source_url='', specs=[], pros='따뜻함', cons='선 정리',
                    compare_with='', source_urls=['https://example.com/p'], info_checked_at=D(-9), trust='출처 있음', used_by_me=False, notes='',
                    created_at=NOW, updated_at=NOW)
        self.products = [{**prod, 'id': I['PR1'], 'name': '전기요 A', 'model': 'A-1'}, {**prod, 'id': I['PR2'], 'name': '전기요 B', 'model': 'B-2'}]
        self.post_products = [{'post_id': P3, 'product_id': I['PR1'], 'sort': 0}, {'post_id': P3, 'product_id': I['PR2'], 'sort': 1}]
        self.jobs = [{'id': I['J1'], 'kind': 'write', 'keyword': '가습기 세척 쉬운 타입', 'status': 'pending', 'post_id': P4, 'attempts': 0,
                      'started_at': None, 'created_at': NOW, 'done_at': None, 'note': '', 'payload': {}}]
        m = dict(channel_id=None, program_id=None, impressions=None, cancels=None, revenue_confirmed=None, revenue_paid=None, cost=None,
                 import_id=None, note='', created_at=NOW)
        self.metrics = [
            {**m, 'id': uid(51), 'post_id': P3, 'link_id': I['L1'], 'period_start': D(0), 'period_end': D(0), 'views': None, 'clicks': 30,
             'orders': 2, 'revenue_est': 4200, 'source': 'manual', 'source_label': '쿠팡 파트너스 리포트'},
            {**m, 'id': uid(52), 'post_id': P3, 'link_id': I['L2'], 'period_start': D(0), 'period_end': D(0), 'views': None, 'clicks': 10,
             'orders': 0, 'revenue_est': 0, 'source': 'manual', 'source_label': '쿠팡 파트너스 리포트'},
            {**m, 'id': uid(53), 'post_id': P3, 'link_id': None, 'period_start': D(0), 'period_end': D(0), 'views': 1200, 'clicks': None,
             'orders': None, 'revenue_est': None, 'source': 'csv', 'source_label': '네이버 블로그 통계'},
        ]
        self.topics = [{'id': I['T1'], 'title': '원룸 전기요 전기세 비교', 'keyword': '전기요 전기세', 'category': '겨울 가전', 'status': '후보',
                        'origin': 'ai', 'rec_channels': ['naver_blog'], 'rec_programs': ['coupang_partners'], 'rec_content_type': 'comparison',
                        'scores': {'demand': {'score': 4, 'basis': '겨울 시즌', 'source': 'AI 추정', 'confidence': '낮음'}},
                        'basis': '겨울에 찾는 사람이 늘어나는 주제', 'seasonality': '11~2월', 'created_at': NOW, 'updated_at': NOW}]
        self.imports = []
        self.ids['P8'] = uid(8)
        # 이미지 스튜디오 가짜 상태
        self.keys = {'openai': True, 'pexels': True}
        self.server_secret = SECRET_MARK
        self.images, self.slots, self.gens, self.decks, self.polls = [], [], [], {}, {}
        self.min_est = None   # 서버 쪽 예상 비용이 더 크다고 답하게 (estimate_changed 시험)
        self.busy_left = 0    # 이 횟수만큼 server_busy 로 답하게 (서버 일꾼 시간 부족 시험)
        self.gen_missing = False  # 생성 전용 서버(blog-gen)가 아직 없는 것처럼 (Supabase 404)
        self.gen_hits = 0         # 그때 생성 전용 서버로 온 요청 수
        self.hold_generate = False  # 생성 요청의 응답을 붙잡아 둠 (보낸 뒤 창 닫기 시험)
        self.held = []
        self.settings.update({'image_gen_model': 'gpt-image-2.5-flare', 'image_edit_model': 'gpt-image-2.5-sunburst', 'image_quality': 'medium',
                              'image_daily_limit': 5, 'image_monthly_budget_usd': 2, 'image_fx_krw': 1400, 'image_fx_date': D(-1), 'image_fx_source': '테스트 환율',
                              'image_prices': {'image_output_per_m': 30, 'image_input_per_m': 8, 'text_input_per_m': 5, 'checked_at': '2026-10-22',
                                               'source': 'https://developers.openai.com/api/docs/pricing'}})
        self.runs = [{'id': 1, 'kind': 'auto', 'status': '성공', 'jobs_done': 0, 'jobs_failed': 0, 'written': 1, 'note': '원고 0 · 자동 1',
                      'error': '', 'ran_at': NOW}]

    # ── 계산 ──
    def stats(self, d_from, d_to):
        F = ['views', 'impressions', 'clicks', 'orders', 'cancels', 'revenue_est', 'revenue_confirmed', 'revenue_paid', 'cost']
        posts = {p['id']: p for p in self.posts}
        rows = []
        for m in self.metrics:
            if d_from and m['period_end'] < d_from:
                continue
            if d_to and m['period_start'] > d_to:
                continue
            p = posts.get(m['post_id']) or {}
            progs = p.get('program_ids') or []
            rows.append({**m, 'ch': m['channel_id'] or p.get('channel_id'), 'pr': m['program_id'] or (progs[0] if len(progs) == 1 else None),
                         'cat': p.get('category') or None})

        def agg(rs):
            out = {f: {'sum': sum(r[f] for r in rs if r[f] is not None) if any(r[f] is not None for r in rs) else None,
                       'n': sum(1 for r in rs if r[f] is not None)} for f in F}
            out['sources'] = sorted({r['source_label'] for r in rs if r['source_label']})
            out['last_date'] = max((r['period_end'] for r in rs), default=None)
            out['rows'] = len(rs)
            return out

        def by(key):
            keys = []
            for r in rows:
                if r[key] not in keys:
                    keys.append(r[key])
            return [{**agg([r for r in rows if r[key] == k]), 'key': k} for k in keys]

        return {'from': d_from, 'to': d_to, 'totals': agg(rows) if rows else {'rows': 0}, 'by_post': by('post_id'),
                'by_channel': by('ch'), 'by_program': by('pr'), 'by_category': by('cat')}

    # ── 이미지 스튜디오 ──
    def img(self, iid):
        return next((i for i in self.images if i['id'] == iid and not i.get('deleted_at')), None)

    def add_image(self, kind, post_id, slot_key, fx='4x3', **extra):
        url, w, h = FX_IMG[fx]
        i = {'id': self.new_id(), 'kind': kind, 'provider': {'ai': 'openai', 'stock': 'pexels', 'upload': 'upload', 'card': 'cardnews'}[kind], 'model': '',
             'prompt': '', 'user_prompt': '', 'style': '', 'purpose': 'blog_body', 'ratio': '', 'description': '', 'alt_text': '', 'storage_path': f'{kind}/2026/10/{self.seq}.jpg',
             'mime': 'image/png' if kind == 'card' else 'image/jpeg', 'bytes': 15000, 'width': w, 'height': h, 'sha256': '', 'source_url': '', 'source_id': '',
             'author_name': '', 'author_url': '', 'license': '', 'attribution_text': '', 'rights_confirmed': kind != 'ai', 'review_status': '검수 전', 'review_note': '',
             'generation_id': None, 'downloaded_at': None, 'created_at': NOW, 'updated_at': NOW, 'deleted_at': None, 'origin_post_id': post_id,
             'origin_slot_key': slot_key or '', 'origin_slot_index': None, 'url': url, **extra}
        self.images.insert(0, i)
        return i

    def link(self, post_id, key, image_id, purpose=None):
        post = next(p for p in self.posts if p['id'] == post_id)
        cur = {s['key']: s for s in parse_slots(post['body'])}
        row = next((r for r in self.slots if r['post_id'] == post_id and r['slot_key'] == key), None)
        if image_id is None:
            self.slots = [r for r in self.slots if not (r['post_id'] == post_id and r['slot_key'] == key)]
            return None
        if row is None:
            row = {'id': self.new_id(), 'post_id': post_id, 'slot_key': key, 'slot_index': cur[key]['index'] if key in cur else 0, 'slot_text': cur[key]['text'] if key in cur else '',
                   'image_id': None, 'purpose': purpose or ('blog_body' if key.startswith('k:') else next(x['purpose'] for x in EXTRA if x['key'] == key)),
                   'crop': None, 'downloaded_at': None, 'used_at': None, 'created_at': NOW, 'updated_at': NOW}
            self.slots.append(row)
        if row['image_id'] != image_id:
            row.update({'image_id': image_id, 'crop': None, 'downloaded_at': None, 'used_at': None})
        return row

    def usage(self):
        running = next((g for g in self.gens if g['status'] == '생성 중'), None)
        live = [i for i in self.images if not i.get('deleted_at')]
        return {'today': sum(1 for g in self.gens if g['provider_called']), 'daily_limit': self.settings['image_daily_limit'],
                'month_usd': round(sum(0 if g['cost_status'] == '청구 없음' else (g.get('actual_usd') or g.get('usage_usd') or g['est_usd']) for g in self.gens), 6),
                'budget_usd': self.settings['image_monthly_budget_usd'], 'running': {'id': running['id'], 'post_id': running['post_id'], 'slot_key': running['slot_key'], 'started_at': NOW} if running else None,
                'storage_bytes': sum(i['bytes'] for i in live), 'image_count': len(live), 'pexels_hour': 0, 'pexels_month': 0}

    def image_costs(self, post_id=None):
        gs = [g for g in self.gens if post_id is None or g['post_id'] == post_id]
        usd = lambda g: 0 if g['cost_status'] == '청구 없음' else (g.get('actual_usd') if g.get('actual_usd') is not None else g.get('usage_usd') if g.get('usage_usd') is not None else g['est_usd'])
        fx = self.settings.get('image_fx_krw')
        tot = {'count': len(gs), 'billed': sum(1 for g in gs if g['cost_status'] != '청구 없음'), 'success': sum(1 for g in gs if g['status'] == '성공'),
               'failed': sum(1 for g in gs if g['status'] == '실패'), 'usd': round(sum(usd(g) for g in gs), 6), 'usd_actual': None,
               'n_actual': sum(1 for g in gs if g.get('actual_usd') is not None), 'n_usage': sum(1 for g in gs if g.get('actual_usd') is None and g.get('usage_usd') is not None),
               'uncertain': sum(1 for g in gs if g['cost_status'] == '확인 필요'), 'fx_missing': 0, 'krw': round(sum(usd(g) for g in gs) * fx, 4) if fx else None}
        by = {}
        for g in gs:
            b = by.setdefault(g['post_id'], {'key': g['post_id'], 'count': 0, 'billed': 0, 'usd': 0, 'krw': 0, 'uncertain': 0})
            b['count'] += 1
            b['billed'] += g['cost_status'] != '청구 없음'
            b['usd'] = round(b['usd'] + usd(g), 6)
        return {'from': None, 'to': None, 'totals': tot, 'by_post': list(by.values())}

    def with_uses(self, i):
        uses = [r for r in self.slots if r['image_id'] == i['id']]
        return {**i, 'uses': len(uses), 'used_posts': len({r['post_id'] for r in uses})}

    def post_images(self, post_id):
        post = next(p for p in self.posts if p['id'] == post_id)
        cur = parse_slots(post['body'])
        rows = [r for r in self.slots if r['post_id'] == post_id]
        keys = {s['key'] for s in cur}
        ids = {r['image_id'] for r in rows}
        imgs = [self.with_uses(i) for i in self.images if not i.get('deleted_at') and (i['origin_post_id'] == post_id or i['id'] in ids)]
        return {'post_id': post_id, 'slots': [{**s, 'row': next((r for r in rows if r['slot_key'] == s['key']), None)} for s in cur],
                'extra': [{**x, 'row': next((r for r in rows if r['slot_key'] == x['key']), None)} for x in EXTRA],
                'orphans': [r for r in rows if r['slot_key'].startswith('k:') and r['slot_key'] not in keys and r['image_id']], 'rekeyed': 0,
                'images': imgs, 'generations': [g for g in self.gens if g['post_id'] == post_id], 'deck': self.decks.get(post_id),
                'usage': self.usage(), 'costs': self.image_costs(post_id), 'keys': self.keys,
                'providers': [{'id': 'pexels', 'label': 'Pexels', 'connected': self.keys['pexels'], 'site': 'https://www.pexels.com', 'license_url': 'https://www.pexels.com/license/'}],
                'signed_at': NOW, 'sign_seconds': 3600}

    def image_slots_state(self):
        out = []
        for r in self.slots:
            i = self.img(r['image_id'])
            if r['image_id'] and i:
                out.append({**{k: r[k] for k in ('post_id', 'slot_key', 'slot_index', 'image_id', 'purpose', 'used_at', 'downloaded_at')},
                            'post_images': {k: i[k] for k in ('kind', 'provider', 'review_status', 'mime', 'author_name', 'description', 'license', 'attribution_text')}})
        return out

    def state(self):
        live = [p for p in self.posts if not p['deleted_at']]
        return {'version': json.loads((ROOT / 'version.json').read_text(encoding='utf-8'))['version'], 'now': NOW, 'today': TODAY.isoformat(), 'auth': 'session', 'posts': live, 'trash': [], 'jobs': self.jobs,
                'settings': self.settings, 'runs': self.runs, 'channels': self.channels, 'programs': self.programs, 'compat': self.compat,
                'topics': self.topics, 'products': self.products, 'post_products': self.post_products, 'links': self.links,
                'imports': self.imports, 'image_slots': self.image_slots_state()}

    def verdict(self, prog, ch):
        row = next((c for c in self.compat if c['program_id'] == prog and c['channel_id'] == ch), None)
        return row['verdict'] if row else '확인 필요'

    def new_id(self):
        self.seq += 1
        return uid(self.seq)

    # ── 요청 처리 ──
    def handle(self, method, path, query, headers, body):
        self.calls.append({'method': method, 'path': path, 'query': query, 'body': body})
        if path == 'login' and method == 'POST':
            return (200, {'session': SESSION}) if body.get('code') == CODE else (401, {'error': 'unauthorized'})
        if headers.get('x-app-session') != SESSION or self.force_401:
            return 401, {'error': 'unauthorized'}
        if path == 'state':
            return 200, self.state()
        if path == 'stats':
            return 200, {'stats': {**self.stats(query.get('from', [None])[0], query.get('to', [None])[0]), 'image_costs': self.image_costs()}}
        r = self.handle_images(method, path, query, headers, body)
        if r is not None:
            return r
        if path == 'metrics' and method == 'GET':
            rows = self.metrics
            if 'post_id' in query:
                rows = [m for m in rows if m['post_id'] == query['post_id'][0]]
            if query.get('source') == ['manual']:
                rows = [m for m in rows if m['source'] == 'manual']
            return 200, {'metrics': rows}
        if path == 'metrics' and method == 'POST':
            m = {'id': self.new_id(), 'source': 'manual', 'created_at': NOW, 'import_id': None, 'channel_id': None, 'program_id': None,
                 'link_id': None, 'post_id': None, **{k: v for k, v in body.items() if v is not None}}
            for f in ['views', 'impressions', 'clicks', 'orders', 'cancels', 'revenue_est', 'revenue_confirmed', 'revenue_paid', 'cost']:
                m.setdefault(f, None)
            self.metrics.append(m)
            return 200, {'metric': m}
        if path == 'sessions':
            return 200, {'sessions': [{'id': uid(99), 'label': 'iPhone · 홈 화면 앱', 'created_at': NOW, 'last_used_at': NOW, 'current': True}]}
        if path == 'posts' and method == 'POST':
            ch, progs = body.get('channel_id'), body.get('program_ids') or []
            bad = [p for p in progs if self.verdict(p, ch) == '불가']
            if bad:
                return 400, {'error': 'incompatible', 'detail': ', '.join(bad)}
            pid, jid = self.new_id(), self.new_id()
            self.posts.append({**deepcopy(self.posts[3]), 'id': pid, 'keyword': body['keyword'], 'channel_id': ch, 'program_ids': progs,
                               'content_type': body.get('content_type') or ''})
            self.jobs.append({**deepcopy(self.jobs[0]), 'id': jid, 'post_id': pid, 'keyword': body['keyword']})
            return 200, {'post_id': pid, 'job_id': jid}
        m = re.fullmatch(r'posts/([0-9a-f-]{36})', path)
        if m and method == 'POST':
            p = next(x for x in self.posts if x['id'] == m.group(1))
            stage = body.get('stage')
            if stage == 'ready' and p['id'] == self.ids['P1']:
                return 409, {'error': 'check_failed', 'errors': [{'code': 'link_missing', 'msg': '서버 검사: 링크 없음', 'fix': '', 'examples': []}]}
            for k, v in body.items():
                p[k] = v
            return 200, {'post': p, 'demoted': None}
        if path == 'imports' and method == 'POST':
            iid = self.new_id()
            self.imports.insert(0, {'id': iid, 'filename': body.get('filename'), 'source_label': body.get('source_label'), 'rows_ok': len(body['rows']),
                                    'rows_dup': body.get('dup_in_file', 0), 'rows_err': body.get('error_count', 0), 'rows_changed': 0, 'status': '완료',
                                    'created_at': NOW})
            return 200, {'import_id': iid, 'ok': len(body['rows']), 'dup': body.get('dup_in_file', 0), 'changed': 0, 'errors': body.get('error_count', 0)}
        return 200, {'ok': True}

    def handle_images(self, method, path, query, headers, body):
        m = re.fullmatch(r'posts/([0-9a-f-]{36})/images', path)
        if m and method == 'GET':
            return 200, self.post_images(m.group(1))
        m = re.fullmatch(r'posts/([0-9a-f-]{36})/images/link', path)
        if m and method == 'POST':
            return 200, {'slot': self.link(m.group(1), body['slot_key'], body.get('image_id'), body.get('purpose'))}
        m = re.fullmatch(r'posts/([0-9a-f-]{36})/images/swap', path)
        if m and method == 'POST':
            row = lambda k: next((r for r in self.slots if r['post_id'] == m.group(1) and r['slot_key'] == k), None)
            ra, rb = row(body['a']), row(body['b'])
            ia, ib = ra['image_id'] if ra else None, rb['image_id'] if rb else None
            self.link(m.group(1), body['a'], None)
            self.link(m.group(1), body['b'], None)
            a = self.link(m.group(1), body['a'], ib) if ib else None
            b = self.link(m.group(1), body['b'], ia) if ia else None
            return 200, {'a': a, 'b': b}
        m = re.fullmatch(r'posts/([0-9a-f-]{36})/images/slot', path)
        if m and method == 'POST':
            row = next((r for r in self.slots if r['post_id'] == m.group(1) and r['slot_key'] == body['slot_key'] and r['image_id']), None)
            if not row:
                return 404, {'error': 'not_found'}
            if 'crop' in body:
                row['crop'] = body['crop']
            if 'used' in body:
                row['used_at'] = NOW if body['used'] else None
            if 'purpose' in body:
                row['purpose'] = body['purpose']
            return 200, {'slot': row}
        m = re.fullmatch(r'posts/([0-9a-f-]{36})/cards', path)
        if m and method == 'POST':
            self.decks[m.group(1)] = {'post_id': m.group(1), 'updated_at': NOW, **{k: body.get(k) for k in ('template', 'ratio', 'slides', 'ad_label', 'bg_image_id')}}
            return 200, {'deck': self.decks[m.group(1)]}
        if path == 'images/config':
            return 200, {'keys': self.keys, 'providers': self.post_images(self.ids['P8'])['providers'], 'settings': self.settings, 'usage': self.usage(),
                         'test_model': 'gf-test-fake', 'sign_seconds': 3600, 'storage_limit': 900 * 1024 * 1024}
        if path == 'images/generate' and method == 'POST':
            if not self.keys['openai']:
                return 503, {'error': 'openai_key_missing'}
            dup = next((g for g in self.gens if g['request_key'] == body['request_key']), None)
            if dup:
                return 200, {'generation': dup, 'duplicate': True}
            if any(g['status'] == '생성 중' for g in self.gens):
                return 409, {'error': 'image_busy'}
            if self.busy_left > 0:
                self.busy_left -= 1
                return 503, {'error': 'server_busy', 'retry_after': 1}
            model = self.settings['image_edit_model' if body.get('mode') == 'edit' else 'image_gen_model']
            size = size_for(model, body.get('ratio'))
            changed = {'error': 'estimate_changed', 'model': model, 'size': size, 'quality': body.get('quality', 'medium')}  # 실제 서버처럼 무엇으로 계산했는지도
            if not isinstance(body.get('confirm_usd'), (int, float)):
                return 409, {**changed, 'est_usd': 0.0111}
            if self.min_est and body['confirm_usd'] + 1e-9 < self.min_est:
                return 409, {**changed, 'est_usd': self.min_est}
            g = {'id': self.new_id(), 'request_key': body['request_key'], 'post_id': body['post_id'], 'slot_key': body['slot_key'], 'mode': body.get('mode', 'generate'),
                 'model': model, 'size': size, 'quality': body.get('quality', 'medium'),
                 'purpose': body.get('purpose'), 'style': body.get('style'), 'user_prompt': '\n'.join(x for x in (body.get('text', ''), body.get('extra', '')) if x),
                 'ratio': body.get('ratio') or '', 'status': '생성 중', 'provider_called': True,
                 'error_code': '', 'error_message': '', 'est_usd': body['confirm_usd'], 'usage_usd': None, 'actual_usd': None, 'actual_checked_at': None,
                 'cost_status': '예상', 'fx_krw': 1400, 'image_id': None, 'created_at': NOW, 'started_at': NOW, 'finished_at': None}
            self.gens.insert(0, g)
            self.polls[g['id']] = 0
            return 202, {'generation': g, 'est_usd': g['est_usd'], 'model': g['model'], 'size': g['size'], 'quality': g['quality']}
        m = re.fullmatch(r'images/generations/([0-9a-f-]{36})', path)
        if m and method == 'GET':
            g = next(x for x in self.gens if x['id'] == m.group(1))
            self.polls[g['id']] += 1
            image = None
            if g['status'] == '생성 중' and self.polls[g['id']] >= 2:
                i = self.add_image('ai', g['post_id'], g['slot_key'], {'16:9': '16x9', '4:5': '4x5'}.get(g.get('ratio') or '', '4x3'), model=g['model'], prompt='Create an illustrative image… Rules: No text', description=g['user_prompt'],
                                   alt_text=g['user_prompt'][:120], generation_id=g['id'], purpose=g['purpose'] or 'blog_body', ratio=g.get('ratio') or '')
                g.update({'status': '성공', 'image_id': i['id'], 'usage_usd': 0.01107, 'cost_status': '사용량 기준', 'finished_at': NOW})
            if g['image_id']:
                image = self.with_uses(self.img(g['image_id']))
            return 200, {'generation': g, 'image': image, 'usage': self.usage()}
        m = re.fullmatch(r'images/generations/([0-9a-f-]{36})/cost', path)
        if m and method == 'POST':
            g = next(x for x in self.gens if x['id'] == m.group(1))
            if body.get('cost_status') == '청구 없음':
                g.update({'actual_usd': None, 'cost_status': '청구 없음'})
            elif body.get('actual_usd') is None:
                g.update({'actual_usd': None, 'cost_status': '사용량 기준' if g['usage_usd'] is not None else '예상'})
            else:
                g.update({'actual_usd': body['actual_usd'], 'actual_checked_at': body.get('actual_checked_at'), 'cost_status': '청구액 확인'})
            return 200, {'generation': g}
        if path == 'stock/search' and method == 'GET':
            if not self.keys['pexels']:
                return 503, {'error': 'pexels_key_missing'}
            if query.get('q', [''])[0] == '없는것':
                return 200, {'provider': 'pexels', 'photos': [], 'total': 0, 'page': 1, 'has_next': False, 'remaining': 199}
            photos = [{'id': 1000 + n, 'width': w, 'height': h, 'alt': f'사진 {n}', 'photographer': f'사진가 {n}', 'photographer_url': f'https://www.pexels.com/@p{n}',
                       'url': f'https://www.pexels.com/photo/{1000 + n}/', 'avg_color': '#AABBCC', 'thumb': url, 'preview': url, 'download': url}
                      for n, (url, w, h) in enumerate(FX_IMG.values(), 1)]
            return 200, {'provider': 'pexels', 'label': 'Pexels', 'site': 'https://www.pexels.com', 'license_url': 'https://www.pexels.com/license/', 'photos': photos,
                         'total': 3, 'page': 1, 'has_next': False, 'remaining': 198}
        if path == 'stock/select' and method == 'POST':
            ex = next((i for i in self.images if i['source_id'] == str(body['photo_id']) and not i.get('deleted_at')), None)
            i = ex or self.add_image('stock', body.get('post_id'), body.get('slot_key'), '16x9', source_id=str(body['photo_id']), source_url=f"https://www.pexels.com/photo/{body['photo_id']}/",
                                      author_name='사진가 2', author_url='https://www.pexels.com/@p2', license='Pexels 라이선스 (https://www.pexels.com/license/)', attribution_text='사진: 사진가 2 (Pexels)')
            slot = self.link(body['post_id'], body['slot_key'], i['id'], body.get('purpose')) if body.get('link') else None
            return 200, {'image': self.with_uses(i), 'slot': slot, 'reused': bool(ex)}
        if path == 'images/upload' and method == 'POST':
            meta = body.get('meta') or {}
            if body.get('mime') not in ('image/jpeg', 'image/png', 'image/webp'):
                return 400, {'error': 'bad_image', 'reason': 'bad_type'}
            if meta.get('kind') != 'card' and meta.get('rights') is not True:
                return 400, {'error': 'rights_required'}
            i = self.add_image('card' if meta.get('kind') == 'card' else 'upload', meta.get('post_id'), meta.get('slot_key'), '4x5' if meta.get('kind') == 'card' else '4x3',
                               description=meta.get('description', ''), bytes=body.get('size', 1))
            slot = self.link(meta['post_id'], meta['slot_key'], i['id'], meta.get('purpose')) if meta.get('link') else None
            return 200, {'image': self.with_uses(i), 'slot': slot, 'reused': False}
        if path == 'images' and method == 'GET':
            kind = query.get('kind', [None])[0]
            return 200, {'images': [self.with_uses(i) for i in self.images if not i.get('deleted_at') and (not kind or i['kind'] == kind)], 'usage': self.usage(), 'next': None}
        if path == 'images/downloaded' and method == 'POST':
            for it in body['items']:
                i = self.img(it['image_id'])
                if i:
                    i['downloaded_at'] = NOW
                for r in self.slots:
                    if r['post_id'] == it.get('post_id') and r['slot_key'] == it.get('slot_key') and r['image_id'] == it['image_id']:
                        r['downloaded_at'] = NOW
            return 200, {'ok': True, 'at': NOW}
        m = re.fullmatch(r'images/([0-9a-f-]{36})', path)
        if m:
            i = self.img(m.group(1))
            if not i:
                return 404, {'error': 'not_found'}
            if method == 'GET':
                used = [{**{k: r[k] for k in ('post_id', 'slot_key', 'slot_index', 'slot_text', 'used_at', 'downloaded_at')},
                         'posts': {'titles': next(p for p in self.posts if p['id'] == r['post_id'])['titles'], 'keyword': '', 'deleted_at': None}} for r in self.slots if r['image_id'] == i['id']]
                return 200, {'image': self.with_uses(i), 'used_in': used, 'decks': [], 'generation': next((g for g in self.gens if g['id'] == i['generation_id']), None)}
            if method == 'POST':
                for k in ('review_status', 'alt_text', 'description', 'review_note'):
                    if k in body:
                        i[k] = body[k]
                return 200, {'image': self.with_uses(i)}
            if method == 'DELETE':
                n = sum(1 for r in self.slots if r['image_id'] == i['id'])
                if n:
                    return 409, {'error': 'image_in_use', 'uses': n}
                i['deleted_at'] = NOW
                return 200, {'ok': True, 'file_removed': True}
        return None


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def serve():
    handler = functools.partial(Quiet, directory=str(ROOT))
    httpd = socketserver.ThreadingTCPServer(('127.0.0.1', 0), handler)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f'http://127.0.0.1:{httpd.server_address[1]}/'


RESULTS = []


def check(name, fn):
    try:
        fn()
        RESULTS.append((name, True, ''))
        print('통과', name)
    except Exception as e:  # noqa: BLE001
        RESULTS.append((name, False, f'{type(e).__name__}: {e}'))
        print('실패', name, '\n   ', type(e).__name__, str(e).split('\n')[0][:300])
        traceback.print_exc(limit=1)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    httpd, base = serve()
    mock = Mock()
    console_errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='ko-KR',
                                  timezone_id='Asia/Seoul',
                                  user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')

        def api_route(route):
            req = route.request
            origin = base.rstrip('/')
            cors = {'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'content-type,x-app-token,x-app-session',
                    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Vary': 'Origin'}
            if req.method == 'OPTIONS':
                return route.fulfill(status=204, headers=cors, body='')
            u = urlparse(req.url)
            gen = '/blog-gen/' in u.path  # 생성 전용 서버 (같은 코드, 생성 요청만 받음)
            if gen and mock.gen_missing:  # 아직 안 올린 경우 Supabase가 주는 답
                mock.gen_hits += 1
                return route.fulfill(status=404, headers={**cors, 'Content-Type': 'application/json'}, body=json.dumps({'code': 'NOT_FOUND', 'message': 'Requested function was not found'}))
            mark = '/blog-gen/' if gen else '/blog-app/'
            path = u.path.split(mark, 1)[1] if mark in u.path else ''
            ctype = req.headers.get('content-type', '')
            body = {}
            if ctype.startswith('multipart/form-data'):
                raw = req.post_data_buffer or b''
                meta = re.search(rb'name="meta"\r\n\r\n(.*?)\r\n--', raw, re.S)
                fpart = re.search(rb'name="file"; filename="([^"]*)"\r\nContent-Type: ([^\r\n]+)\r\n\r\n(.*)\r\n--', raw, re.S)
                body = {'meta': json.loads(meta.group(1)) if meta else {}, 'filename': fpart.group(1).decode() if fpart else '',
                        'mime': fpart.group(2).decode() if fpart else '', 'size': len(fpart.group(3)) if fpart else 0, 'file_head': fpart.group(3)[:16].hex() if fpart else ''}
            else:
                try:
                    body = json.loads(req.post_data) if req.post_data else {}
                except Exception:  # noqa: BLE001
                    body = {}
            if gen and not (req.method == 'POST' and path == 'images/generate'):
                status, data = 404, {'error': 'not_found'}  # 실제 서버처럼 blog-gen 은 생성 요청만
            else:
                status, data = mock.handle(req.method, path, parse_qs(u.query), req.headers, body)
                mock.calls[-1]['fn'] = 'gen' if gen else 'app'
            if mock.hold_generate and path == 'images/generate':  # 응답을 나중에 (테스트가 직접 보냄)
                mock.held.append((route, status, data, cors))
                return
            route.fulfill(status=status, headers={**cors, 'Content-Type': 'application/json; charset=utf-8'}, body=json.dumps(data, ensure_ascii=False))

        def release_held():
            while mock.held:
                r, st, dt, co = mock.held.pop(0)
                r.fulfill(status=st, headers={**co, 'Content-Type': 'application/json; charset=utf-8'}, body=json.dumps(dt, ensure_ascii=False))

        ctx.route(API + '/**', api_route)
        ctx.route(GEN + '/**', api_route)
        ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, content_type='text/css', body=''))
        page = ctx.new_page()
        dialogs = []
        page.on('dialog', lambda d: (dialogs.append(d.message), d.dismiss()))
        page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: console_errors.append('pageerror: ' + str(e)))

        def no_overflow(label):
            w = page.evaluate('() => [document.documentElement.scrollWidth, window.innerWidth]')
            assert w[0] <= w[1] + 1, f'{label}: 가로로 넘침 {w[0]}px > {w[1]}px'

        def shot(name):
            page.screenshot(path=str(OUT / f'{name}.png'), full_page=True)

        def goto_hash(h):
            page.evaluate(f"location.hash = '{h}'")
            page.wait_for_timeout(250)

        # 1) 틀린 코드가 붙은 예전 링크 → 주소에서 코드가 바로 지워지고, 로그인 화면
        def t_wrong_code_link():
            page.goto(base + '?k=WRONG-CODE-1234567890abcdef#home')
            expect(page.locator('#gate')).to_be_visible()
            expect(page.locator('#gateMsg')).to_contain_text('맞지 않아')
            assert 'k=' not in page.url, '주소에 코드가 남아 있음: ' + page.url
            shot('01-gate')
        check('예전 링크(?k=틀린 코드): 주소에서 코드 지우고 로그인 화면', t_wrong_code_link)

        # 2) 접속 코드 넣고 로그인
        def t_login():
            page.fill('#gateInput', 'short')
            page.click('#gateBtn')
            expect(page.locator('#gateMsg')).to_contain_text('짧아')
            page.fill('#gateInput', CODE)
            page.click('#gateBtn')
            expect(page.locator('#app')).to_be_visible()
            expect(page.get_by_role('heading', name='오늘 할 일')).to_be_visible()
            assert page.evaluate("localStorage.getItem('gf-session')") == json.dumps(SESSION)
            assert page.evaluate("localStorage.getItem('gf-token')") is None, '접속 코드가 기기에 저장됨'
            assert not any(CODE in json.dumps(v, ensure_ascii=False) for v in page.evaluate('() => Object.values(localStorage)')), '접속 코드가 저장소에 남음'
        check('접속 코드 로그인: 기기에는 세션만 저장, 코드는 저장 안 함', t_login)

        def t_home():
            todo = page.locator('.todo')
            expect(todo).to_contain_text('검수할 원고')
            expect(todo).to_contain_text('정보를 더 넣어야 하는 원고')
            expect(page.get_by_text('이번 달 수익')).to_be_visible()
            page.wait_for_timeout(400)
            no_overflow('홈')
            shot('02-home')
        check('홈: 오늘 할 일·수익 요약, 가로 넘침 없음', t_home)

        # 3) 오류 있는 원고 → 발행 준비 완료 버튼 잠김
        def t_blocked_review():
            goto_hash('content/post/' + mock.ids['P1'])
            expect(page.get_by_role('heading', name=re.compile('발행 전 검사'))).to_be_visible()
            ready = page.get_by_role('button', name='발행 준비 완료로')
            expect(ready).to_be_disabled()
            checks = page.locator('ul.checks li.e')
            expect(checks.first).to_be_visible()
            txt = page.locator('ul.checks').inner_text()
            assert '링크 자리가' in txt and '제휴 링크가 없어' in txt, '링크 빠짐 오류가 없음'
            assert '[내 경험]' in txt, '빈 경험 칸 오류가 없음'
            no_overflow('원고 상세')
            shot('03-post-blocked')
        check('검수 차단: 링크 빠진·빈 경험 칸 원고는 발행 준비 완료 잠김', t_blocked_review)

        # 4) 깨끗한 원고 → 발행 준비 완료, XSS 글자는 글자로만
        def t_ready_ok():
            goto_hash('content/post/' + mock.ids['P2'])
            expect(page.locator('h2', has_text='겨울 창문 결로')).to_be_visible()
            assert page.locator('.post script').count() == 0, '본문의 <script>가 실제 태그로 들어감'
            expect(page.locator('.post')).to_contain_text('<script>alert(1)</script>')
            assert page.locator('img[src="x"]').count() == 0, '제목의 <img>가 실제 태그로 들어감'
            btn = page.get_by_role('button', name='발행 준비 완료로')
            expect(btn).to_be_enabled()
            btn.click()
            expect(page.locator('#toast')).to_contain_text('발행 준비 완료')
            sent = [c for c in mock.calls if c['path'] == 'posts/' + mock.ids['P2'] and c['body'].get('stage') == 'ready']
            assert sent, '서버에 상태 변경 요청이 안 감'
            expect(page.locator('.badge', has_text='발행 준비 완료').first).to_be_visible()
            assert not dialogs, '알림창이 떴음(스크립트 실행됨): ' + str(dialogs)
        check('발행 준비 완료: 검사 통과한 원고만, 본문 HTML은 글자로만 보임', t_ready_ok)

        # 4-1) 고지문이 비었거나 애매한 수익 모델 글은 복사 버튼 자체가 안 나옴
        def t_copy_blocked():
            goto_hash('content/post/' + mock.ids['P6'])
            expect(page.locator('h2', has_text='전기요 세탁 방법')).to_be_visible()
            expect(page.locator('.badbox', has_text='고지문이 비어 있어서 복사를 막아뒀어')).to_be_visible()
            assert page.get_by_role('button', name='서식 그대로 복사').count() == 0, '고지문 없는데 복사 버튼이 보임'
            expect(page.get_by_role('button', name='수익 모델 설정 열기')).to_be_visible()
            shot('03b-copy-blocked')
            toss = next(x for x in mock.programs if x['id'] == 'toss_sharelink')
            keep = toss['disclosure_template']
            toss['disclosure_template'] = '이 글의 링크로 구매하면 수수료를 받을 수 있습니다.'
            try:
                page.get_by_role('button', name='새로고침').click()
                page.wait_for_timeout(400)
                goto_hash('content/post/' + mock.ids['P7'])
                expect(page.locator('.badbox', has_text='애매해서 복사를 막아뒀어')).to_be_visible()
                assert page.get_by_role('button', name='서식 그대로 복사').count() == 0, '애매한 고지문인데 복사 버튼이 보임'
            finally:
                toss['disclosure_template'] = keep
            page.get_by_role('button', name='새로고침').click()
            page.wait_for_timeout(400)
            goto_hash('content/post/' + mock.ids['P7'])
            expect(page.get_by_role('button', name='서식 그대로 복사')).to_be_visible()
        check('고지문 비었거나 애매하면 복사 막기, 고치면 다시 복사 가능', t_copy_blocked)

        # 5) 새 원고 요청: 안 되는 조합·경험 없는 후기 막기, 되는 조합은 요청
        def t_new_request():
            goto_hash('content/new')
            expect(page.get_by_role('heading', name='새 원고 요청')).to_be_visible()
            page.get_by_role('button', name='쓰레드', exact=True).click()
            expect(page.get_by_role('button', name='쓰레드', exact=True)).to_have_attribute('aria-pressed', 'true')
            ads = page.locator('.prog button', has_text='Google 애드센스')
            expect(ads).to_be_disabled()
            page.get_by_role('button', name='네이버 블로그', exact=True).click()
            expect(page.get_by_role('button', name='네이버 블로그', exact=True)).to_have_attribute('aria-pressed', 'true')
            page.locator('select').filter(has=page.locator('option', has_text='알아서 골라줘')).select_option('experience_review')
            expect(page.get_by_text('실제 경험 후기는 경험을 적어야 요청할 수 있어.')).to_be_visible()
            expect(page.get_by_role('button', name='원고 요청하기')).to_be_disabled()
            page.locator('select').filter(has=page.locator('option', has_text='알아서 골라줘')).select_option('buying_guide')
            page.get_by_placeholder('예: 원룸 전기요 고르는 법').fill('원룸 가습기 고르는 법')
            no_overflow('새 원고 요청')
            shot('04-new-request')
            page.get_by_role('button', name='원고 요청하기').click()
            expect(page.locator('#toast')).to_contain_text('요청했어')
            # 요청하면 새 원고 화면으로 넘어감 (넘어간 걸 확인하고 다음 테스트로)
            # (CSP가 eval을 막아서 wait_for_function 문자열 대신 주소를 바깥에서 확인)
            expect(page).to_have_url(re.compile(r'#content/post/'))
            expect(page.locator('.badge', has_text='원고 생성 대기').first).to_be_visible()
            req = [c for c in mock.calls if c['path'] == 'posts' and c['method'] == 'POST'][-1]['body']
            assert req['keyword'] == '원룸 가습기 고르는 법' and req['channel_id'] == 'naver_blog', req
            assert req['program_ids'] == ['coupang_partners'] and req['content_type'] == 'buying_guide', req
        check('원고 요청: 못 쓰는 조합(애드센스×쓰레드)·경험 없는 후기 막기', t_new_request)

        # 6) 링크 2개짜리 게시 글: 링크별 실적 입력 → 서버로 link_id
        def t_links_metrics():
            goto_hash('content/post/' + mock.ids['P3'])
            expect(page.get_by_text('제휴 링크 (2)')).to_be_visible()
            expect(page.get_by_text('링크별 합계')).to_be_visible()
            page.get_by_role('button', name='이 링크 실적').nth(1).click()
            sheet = page.locator('#sheet')
            expect(sheet).to_be_visible()
            assert sheet.locator('select[aria-label="링크"]').input_value() == mock.ids['L2']
            sheet.locator('label', has_text='링크 클릭').locator('input').fill('7')
            no_overflow('실적 입력 창')
            shot('05-metric-sheet')
            sheet.get_by_role('button', name='저장').click()
            expect(page.locator('#toast')).to_contain_text('저장했어')
            body = [c for c in mock.calls if c['path'] == 'metrics' and c['method'] == 'POST'][-1]['body']
            assert body['link_id'] == mock.ids['L2'] and body['post_id'] == mock.ids['P3'] and body['clicks'] == 7, body
            assert body['views'] is None and body['revenue_est'] is None, '빈 칸이 0으로 감: ' + json.dumps(body)
        check('여러 상품·링크 글: 링크별 실적이 그 링크로 저장, 빈 칸은 null', t_links_metrics)

        # 7) 수익 탭: 데이터 없음과 0 구분, 조회 1,000회당 수익
        def t_money():
            goto_hash('money')
            page.wait_for_timeout(500)
            kpi = lambda label: page.locator('.kpi', has=page.locator('span', has_text=label)).first.locator('b')
            expect(kpi('확정 수익')).to_have_text('데이터 없음')
            expect(kpi('발생 수익')).to_have_text('4,200원')
            expect(kpi('조회 1,000회당 수익')).to_have_text('3,500원')
            expect(page.get_by_text('자체 클릭 추적')).to_be_visible()
            no_overflow('수익')
            shot('06-money')
        check('수익: 빈 값은 데이터 없음, 0과 구분 / 조회 1,000회당 수익', t_money)

        # 8) 파일 올리기: EUC-KR CSV, 파일 안 중복 1줄은 빼고 올림
        def t_upload():
            page.locator('input[type=file]').set_input_files(str(FIX / 'coupang-report-euckr.csv'))
            expect(page.locator('.kpi', has_text='파일 안 중복')).to_be_visible()
            dup = page.locator('.kpi', has=page.locator('span', has_text='파일 안 중복')).locator('b').inner_text()
            assert dup == '1', '파일 안 중복이 1이 아님: ' + dup
            ok = int(page.locator('.kpi', has=page.locator('span', has_text='저장할 줄')).locator('b').inner_text())
            shot('07-upload-preview')
            page.get_by_role('button', name=f'{ok}줄 올리기').click()
            expect(page.locator('#toast')).to_contain_text('저장했어')
            body = [c for c in mock.calls if c['path'] == 'imports'][-1]['body']
            assert len(body['rows']) == ok and body['dup_in_file'] == 1, {k: body[k] for k in ('dup_in_file', 'error_count')}
            assert all(r['period_start'] for r in body['rows'])
        check('CSV 올리기: 미리보기·열 맞추기·파일 안 중복 제외', t_upload)

        # 9) 주제·설정 화면
        def t_topics_settings():
            goto_hash('topics')
            expect(page.get_by_text('원룸 전기요 전기세 비교')).to_be_visible()
            no_overflow('주제')
            shot('08-topics')
            goto_hash('settings/programs')
            expect(page.get_by_text('쓸 수 있는 채널').first).to_be_visible()
            expect(page.get_by_text('못 쓰는 채널').first).to_be_visible()
            no_overflow('설정')
            shot('09-settings-programs')
        check('주제·설정(수익 모델별 쓸 수 있는 채널) 화면', t_topics_settings)


        # ── 이미지 스튜디오 ──
        P8 = mock.ids['P8']
        open_p8 = lambda: (goto_hash('content/post/' + P8), expect(page.locator('section.studio h2', has_text='이미지')).to_be_visible(),
                           expect(page.locator('section.studio .slot').first).to_be_visible())

        def t_img_panel():
            open_p8()
            studio = page.locator('section.studio')
            expect(studio).to_contain_text('사진 자리 3곳 · 연결 0')
            expect(studio.locator('.slot').nth(0)).to_contain_text('작은 원룸에서 무선청소기를 보관하는 모습')
            expect(studio.locator('.slot').nth(1)).to_contain_text('실제 상품·화면이 보여야 하는 자리', ignore_case=False)
            assert studio.locator('.slot').nth(0).get_by_text('이미지 없음').count() == 1, '이미지 없는 자리를 완성으로 표시하면 안 됨'
            expect(page.locator('.flag, .notice').filter(has_text='사진 자리 3곳 · 이미지 연결 0곳').first).to_be_visible()
            no_overflow('원고 상세(이미지 칸)')
            shot('10-image-panel')
        check('이미지 칸: 사진 자리 자동 인식(3곳), 순서·설명·실제 사진 필요 안내, 빈 자리는 이미지 없음', t_img_panel)

        def t_img_generate():
            open_p8()
            page.locator('section.studio .slot').nth(0).get_by_role('button', name='AI로 만들기').click()
            sheet = page.locator('#sheet')
            expect(sheet).to_contain_text('gpt-image-2.5-flare')
            expect(sheet).to_contain_text('예상 $0.01')
            expect(sheet).to_contain_text('실제 청구액은 OpenAI 사용량 화면에서 확인해야 하고 조금 다를 수 있어')
            expect(sheet).to_contain_text('오늘 0/5번')
            # 버튼에는 '예상' 비용이라고 밝힘 (실제 청구액과 다를 수 있음)
            go_btn = sheet.get_by_role('button', name=re.compile(r'예상 \$[\d.]+ · 만들기'))
            expect(go_btn).to_be_enabled()
            # 위험한 요청은 버튼이 잠김 (화면에서 먼저 막고, 서버도 다시 막음)
            extra = sheet.locator('label', has_text='더 원하는 것').locator('textarea')
            extra.fill('브랜드 로고와 가격표 넣어줘')
            expect(sheet.locator('.badbox').first).to_be_visible()
            expect(go_btn).to_be_disabled()
            extra.fill('밝은 오전 햇살')
            expect(go_btn).to_be_enabled()
            sheet.locator('select').filter(has=page.locator('option', has_text='인스타그램 피드용')).select_option('ig_feed')
            expect(sheet.get_by_role('button', name='4:5')).to_have_attribute('aria-pressed', 'true')
            sheet.locator('select').filter(has=page.locator('option', has_text='인스타그램 피드용')).select_option('blog_body')
            no_overflow('AI 만들기 창')
            shot('11-image-generate')
            go_btn.click()
            expect(sheet).to_contain_text('만드는 중')
            expect(sheet).to_contain_text('다 만들었어', timeout=15000)
            req = [c for c in mock.calls if c['path'] == 'images/generate'][-1]['body']
            slot0 = parse_slots(next(p for p in mock.posts if p['id'] == P8)['body'])[0]
            assert req['slot_key'] == slot0['key'] and req['post_id'] == P8, req
            assert isinstance(req['confirm_usd'], (int, float)) and req['confirm_usd'] > 0, '사용자가 본 예상 비용을 같이 보냄'
            assert re.fullmatch(r'[A-Za-z0-9_-]{8,80}', req['request_key']), '중복 방지 요청 키'
            assert req['extra'] == '밝은 오전 햇살' and 'prompt' not in req, '프롬프트는 서버가 만듦'
            shot('12-image-result')
            sheet.get_by_role('button', name=re.compile('이 이미지 쓰기')).click()
            expect(page.locator('#toast')).to_contain_text('사진 1에 연결했어')
            link = [c for c in mock.calls if c['path'] == f'posts/{P8}/images/link'][-1]['body']
            assert link['slot_key'] == slot0['key'] and link['image_id'], link
            card = page.locator('section.studio .slot').nth(0)
            expect(card.locator('.chip.k-ai')).to_have_text('AI 생성')
            expect(card.locator('.chip', has_text='검수 전')).to_be_visible()
            expect(card).to_contain_text('사용량 기준')
            expect(page.locator('section.studio')).to_contain_text('사진 자리 3곳 · 연결 1')
            gens = [c for c in mock.calls if c['path'] == 'images/generate']
            assert len(gens) == 1, '버튼 한 번에 요청 한 번'
        check('AI 이미지: 모델·예상 비용·한도 안내, 위험 요청 잠금, 생성→결과→자리 연결 (모의 OpenAI)', t_img_generate)

        def t_img_stock():
            open_p8()
            page.locator('section.studio .slot').nth(2).get_by_role('button', name='실제 사진 찾기').click()
            sheet = page.locator('#sheet')
            expect(sheet.get_by_role('link', name='Photos provided by Pexels')).to_have_attribute('href', 'https://www.pexels.com')
            expect(sheet.locator('.grid2 .pick')).to_have_count(3)
            expect(sheet.locator('.grid2 .pick').first).to_contain_text('사진가 1')
            no_overflow('사진 찾기 창')
            shot('13-stock-search')
            sheet.locator('.grid2 .pick').nth(1).click()
            expect(sheet).to_contain_text('Photo by')
            expect(sheet).to_contain_text('Pexels 라이선스')
            expect(sheet.get_by_role('link', name='사진가 2')).to_have_attribute('href', 'https://www.pexels.com/@p2')
            sheet.get_by_role('button', name=re.compile('이 사진 쓰기')).click()
            expect(page.locator('#toast')).to_contain_text('사진 3에 연결했어')
            sel = [c for c in mock.calls if c['path'] == 'stock/select'][-1]['body']
            assert sel['photo_id'] == 1002 and sel['link'] is True and sel['provider'] == 'pexels', sel
            assert 'download' not in sel and 'url' not in sel, '화면은 사진 번호만 보냄 (주소는 서버가 Pexels에서 다시 받음)'
            card = page.locator('section.studio .slot').nth(2)
            expect(card.locator('.chip.k-stock')).to_be_visible()
            expect(card).to_contain_text('사진: 사진가 2 (Pexels)')
            # 결과 없음 안내
            card.get_by_role('button', name='바꾸기', exact=True).click()
            page.locator('#sheet').get_by_role('button', name='실제 사진 찾기 (Pexels)').click()
            q = page.locator('#sheet input[type=search]')
            q.fill('없는것')
            page.locator('#sheet').get_by_role('button', name='검색').click()
            expect(page.locator('#sheet')).to_contain_text('검색 결과가 없어')
            page.locator('#sheet').get_by_role('button', name='닫기').click()
        check('실제 사진(Pexels): 검색·출처 표시·사진가 링크·라이선스 안내·연결, 결과 없음 안내 (모의 Pexels)', t_img_stock)

        def t_img_upload():
            open_p8()
            page.locator('section.studio .slot').nth(1).get_by_role('button', name='파일 올리기').click()
            sheet = page.locator('#sheet')
            inp = sheet.locator('input[type=file]')
            inp.set_input_files(str(FIX / 'img' / 'fake.jpg'))
            expect(sheet.locator('.badbox')).to_contain_text('JPEG·PNG·WebP 이미지만')
            expect(sheet.get_by_role('button', name=re.compile('올리고'))).to_be_disabled()
            inp.set_input_files(str(FIX / 'img' / 'exif.jpg'))
            expect(sheet).to_contain_text('80×60')
            expect(sheet).to_contain_text('숨은 정보는 빼고')
            expect(sheet).to_contain_text('저작권자 허락')
            sheet.get_by_role('button', name=re.compile('올리고')).click()
            expect(page.locator('#toast')).to_contain_text('확인 칸을 체크해줘')
            assert not [c for c in mock.calls if c['path'] == 'images/upload'], '권한 확인 전에는 안 보냄'
            sheet.get_by_label('내가 찍었거나 쓸 권한이 있는 사진이야').check()
            no_overflow('파일 올리기 창')
            sheet.get_by_role('button', name=re.compile('올리고')).click()
            expect(page.locator('#toast')).to_contain_text('사진 2에 연결했어')
            up = [c for c in mock.calls if c['path'] == 'images/upload'][-1]['body']
            assert up['mime'] == 'image/jpeg' and up['meta']['rights'] is True and up['meta']['link'] is True, up
            assert up['file_head'].startswith('ffd8ff'), '진짜 JPEG을 보냄'
            card = page.locator('section.studio .slot').nth(1)
            expect(card.locator('.chip.k-upload')).to_be_visible()
        check('직접 올리기: 가짜 이미지 거절, 숨은 정보 없이 다시 저장, 권한 확인 필수, 자리 연결', t_img_upload)

        def t_img_preview_download():
            open_p8()
            page.locator('section.studio .slot').nth(0).get_by_role('button', name='미리보기·내려받기').click()
            sheet = page.locator('#sheet')
            expect(sheet.locator('.crop img')).to_be_visible()
            expect(sheet).to_contain_text('이미 4:3 비율이라 자르지 않아')
            sheet.get_by_role('button', name='16:9').click()
            expect(sheet.locator('.crop .win')).to_be_visible()
            box = sheet.locator('.crop').bounding_box()
            page.mouse.click(box['x'] + box['width'] * 0.5, box['y'] + box['height'] * 0.9)
            expect(sheet.get_by_role('button', name='자르는 곳 저장')).to_be_enabled()
            sheet.get_by_role('button', name='자르는 곳 저장').click()
            expect(page.locator('#toast')).to_contain_text('이대로 잘라')
            crop = [c for c in mock.calls if c['path'] == f'posts/{P8}/images/slot'][-1]['body']
            assert crop['crop']['ratio'] == '16:9' and crop['crop']['y'] > 0.8, crop
            dl = sheet.get_by_role('button', name=re.compile('내려받기 ·'))
            expect(dl).to_be_enabled(timeout=10000)
            expect(dl).to_contain_text('검수 완료하고 내려받기')
            no_overflow('미리보기 창')
            shot('14-image-preview')
            with page.expect_download() as d:
                dl.click()
            f = d.value
            assert re.fullmatch(r'무선청소기-보관-01-blog_body\.jpg', f.suggested_filename), f.suggested_filename
            path = OUT / f.suggested_filename
            f.save_as(str(path))
            from PIL import Image
            im = Image.open(path)
            assert im.size == (1280, 720), f'16:9로 자른 크기가 아님: {im.size}'
            assert len(im.getexif()) == 0
            page.wait_for_timeout(300)
            marks = [c for c in mock.calls if c['path'] == 'images/downloaded']
            assert marks and marks[-1]['body']['items'][0]['slot_key'] == parse_slots(next(p for p in mock.posts if p['id'] == P8)['body'])[0]['key']
            rev = [c for c in mock.calls if re.fullmatch(r'images/[0-9a-f-]{36}', c['path']) and c['method'] == 'POST']
            assert rev and rev[-1]['body'] == {'review_status': '사용 가능'}, '검수 완료로 바뀜'
            page.locator('#sheet').get_by_role('button', name='닫기').click()
            card = page.locator('section.studio .slot').nth(0)
            expect(card.locator('.chip', has_text='내려받음')).to_be_visible()
            expect(card.locator('.chip', has_text='사용 가능')).to_be_visible()
        check('미리보기·자르기(초점 저장)·검수·내려받기: 16:9로 잘라 1280×720 JPEG, 파일 이름 순서', t_img_preview_download)

        def t_img_order_used():
            open_p8()
            cards = page.locator('section.studio .slot')
            first_img = cards.nth(0).locator('.thumb img').get_attribute('src')
            cards.nth(0).get_by_role('button', name='사진 1 아래로 (아래 자리와 이미지 맞바꾸기)').click()
            expect(page.locator('#toast')).to_contain_text('사진 1과 사진 2 이미지를 맞바꿨어')
            sw = [c for c in mock.calls if c['path'] == f'posts/{P8}/images/swap'][-1]['body']
            keys = [s['key'] for s in parse_slots(next(p for p in mock.posts if p['id'] == P8)['body'])]
            assert sw == {'a': keys[0], 'b': keys[1]}, sw
            expect(cards.nth(1).locator('.thumb img')).to_have_attribute('src', first_img)
            cards.nth(1).get_by_role('button', name='사용 완료', exact=True).click()
            expect(cards.nth(1).locator('.chip', has_text='사용 완료')).to_be_visible()
            # 같은 이미지를 다른 원고에도 연결 (재사용)
            goto_hash('content/post/' + mock.ids['P1'])
            expect(page.locator('section.studio')).to_contain_text('본문에 사진 자리 없음')
            page.locator('section.studio summary', has_text='블로그 대표·SNS용 이미지').click()
            page.locator('section.studio .slot', has_text='블로그 대표 이미지').get_by_role('button', name='보관함에서').click()
            page.locator('#sheet').get_by_role('button', name='보관함 전체').click()
            page.locator('#sheet .grid3 .pick').first.click()
            expect(page.locator('#toast')).to_contain_text('블로그 대표 이미지에 연결했어')
            assert [c for c in mock.calls if c['path'] == f"posts/{mock.ids['P1']}/images/link"][-1]['body']['slot_key'] == 'x:cover'
            no_overflow('다른 원고 대표 이미지')
        check('여러 자리 연결: 순서 바꾸기·사용 완료, 같은 이미지를 다른 원고 대표 이미지로 재사용', t_img_order_used)

        def t_img_edit_body_keeps_links():
            open_p8()
            post = next(p for p in mock.posts if p['id'] == P8)
            before = len([r for r in mock.slots if r['post_id'] == P8 and r['image_id']])
            page.get_by_role('button', name='본문 고치기').click()
            ta = page.locator('textarea.body-edit')
            ta.fill(ta.input_value().replace('[이미지: 깔끔한 거실 바닥]\n', ''))
            page.get_by_role('button', name='저장', exact=True).click()
            expect(page.locator('#toast')).to_contain_text('저장했어')
            page.wait_for_timeout(500)
            after = len([r for r in mock.slots if r['post_id'] == P8 and r['image_id']])
            assert after == before, '본문을 고쳐도 연결이 지워지지 않음'
            studio = page.locator('section.studio')
            expect(studio).to_contain_text('사진 자리 2곳')
            expect(studio).to_contain_text('본문에서 사라진 사진 자리 1곳 (이미지는 그대로 있어)')
            expect(studio.locator('summary', has_text='본문에서 사라진')).to_be_visible()
            assert '[이미지: 작은 원룸에서 무선청소기를 보관하는 모습]' in post['body'], '나머지 본문 그대로'
        check('원고를 고쳐도 이미지 연결 유지: 사라진 자리는 지우지 않고 따로 보여줌', t_img_edit_body_keeps_links)

        def t_cards():
            goto_hash(f'content/post/{P8}/cards')
            expect(page.get_by_role('heading', name='카드뉴스 만들기')).to_be_visible()
            expect(page.locator('.card-prev canvas').first).to_be_visible(timeout=8000)
            n = page.locator('.card-prev').count()
            assert n >= 3, n
            page.get_by_label('1장 제목').fill('원룸 청소기 보관 3가지')
            page.get_by_role('button', name='어두운').click()
            page.wait_for_timeout(500)
            no_overflow('카드뉴스')
            shot('15-cards')
            page.get_by_role('button', name='저장', exact=True).click()
            expect(page.locator('#toast')).to_contain_text('카드뉴스를 저장했어')
            deck = [c for c in mock.calls if c['path'] == f'posts/{P8}/cards'][-1]['body']
            assert deck['template'] == 'dark' and deck['slides'][0]['title'] == '원룸 청소기 보관 3가지' and deck['ad_label'] is True, deck
            assert not any('[이미지' in s['title'] + s['text'] for s in deck['slides']), '사진 자리 표시는 카드에 안 들어감'
            page.get_by_role('button', name='PNG 파일 만들기').click()
            btn2 = page.get_by_role('button', name=re.compile(r'ZIP으로 받기|카드 \d+장 저장하기|PNG 내려받기'))
            expect(btn2).to_be_visible(timeout=10000)
            with page.expect_download() as d:
                btn2.click()
            z = d.value
            zp = OUT / z.suggested_filename
            z.save_as(str(zp))
            with zipfile.ZipFile(zp) as zf:
                names = zf.namelist()
                assert len(names) == n and all(x.endswith('.png') for x in names), names
                from PIL import Image
                im = Image.open(io.BytesIO(zf.read(names[0])))
                assert im.size == (1080, 1350), im.size
            assert z.suggested_filename == '무선청소기-보관-cards.zip', z.suggested_filename
        check('카드뉴스: 원고에서 초안, 고치고 저장, 글자는 앱이 그린 PNG 여러 장 (1080×1350, ZIP)', t_cards)

        def t_img_settings_money_library():
            goto_hash('settings/images')
            sec = page.locator('#sec-images')
            expect(sec).to_contain_text('키 연결됨')
            expect(sec).to_contain_text('OPENAI_API_KEY')
            daily = sec.locator('label', has_text='하루 생성 한도').locator('input')
            daily.fill('3')
            sec.get_by_role('button', name='저장', exact=True).click()
            expect(page.locator('#toast')).to_contain_text('저장했어')
            body = [c for c in mock.calls if c['path'] == 'settings'][-1]['body']
            assert body['image_daily_limit'] == 3 and body['image_gen_model'] == 'gpt-image-2.5-flare' and body['image_prices']['image_output_per_m'] == 30, body
            no_overflow('설정 > 이미지')
            shot('16-settings-images')
            html = page.content() + json.dumps(page.evaluate('() => Object.values(localStorage)'), ensure_ascii=False)
            assert mock.server_secret not in html and 'sk-' not in page.locator('#view').inner_text(), 'API 키가 화면·저장소에 나옴'
            goto_hash('money')
            imgp = page.locator('section.panel', has=page.locator('h2', has_text='이미지 생성 비용'))
            expect(imgp).to_contain_text('$0.0111', timeout=8000)
            expect(imgp).to_contain_text('두 번 더하지 않아')
            no_overflow('수익(이미지 비용)')
            goto_hash('content/images')
            expect(page.get_by_role('heading', name='이미지 보관함')).to_be_visible()
            expect(page.locator('.grid2 .pick').first).to_be_visible()
            used = page.locator('.grid2 .pick', has_text='곳에서 사용').first
            used.click()
            page.locator('#sheet').get_by_role('button', name='지우기').click()
            expect(page.locator('#toast')).to_contain_text('지울 수 없어')
            assert not [c for c in mock.calls if c['method'] == 'DELETE' and c['path'].startswith('images/')], '쓰는 이미지는 지우기 요청도 안 보냄'
            page.locator('#sheet').get_by_role('button', name='닫기').click()
            no_overflow('이미지 보관함')
            shot('17-library')
        check('설정 > 이미지(키 상태·한도 저장, 키는 화면에 없음), 수익 탭 이미지 비용(따로 셈), 보관함(쓰는 이미지는 못 지움)', t_img_settings_money_library)

        # 따로 검토에서 재현된 문제들 (1.2.0 검토)
        def t_review_regressions():
            import zipfile
            open_p8()
            cards = page.locator('section.studio .slot')
            sheet = page.locator('#sheet')
            # H1: 검수 버튼으로 기록이 새로 바뀐 뒤에 자르는 곳을 저장해도, 다시 열면·모두 내려받기에서 그대로
            cards.nth(0).get_by_role('button', name='미리보기·내려받기').click()
            expect(sheet.locator('.crop img')).to_be_visible()
            sheet.get_by_role('button', name='검수 전', exact=True).click()
            expect(page.locator('#toast')).to_contain_text('검수 전')
            page.wait_for_timeout(300)
            sheet.get_by_role('button', name='4:3').click()
            sheet.get_by_role('button', name='자르는 곳 저장').click()
            expect(page.locator('#toast')).to_contain_text('이대로 잘라')
            sheet.get_by_role('button', name='닫기').click()
            cards.nth(0).get_by_role('button', name='미리보기·내려받기').click()
            expect(sheet.get_by_role('button', name='4:3')).to_have_attribute('aria-pressed', 'true')
            sheet.get_by_role('button', name='16:9').click()
            sheet.get_by_role('button', name='자르는 곳 저장').click()
            expect(page.locator('#toast')).to_contain_text('이대로 잘라')
            sheet.get_by_role('button', name='사용 가능', exact=True).click()
            expect(page.locator('#toast')).to_contain_text('사용 가능')
            sheet.get_by_role('button', name='닫기').click()
            cards.nth(0).get_by_role('button', name='미리보기·내려받기').click()
            expect(sheet.get_by_role('button', name='16:9')).to_have_attribute('aria-pressed', 'true')
            sheet.get_by_role('button', name='닫기').click()
            page.get_by_role('button', name=re.compile(r'모두 내려받기')).click()
            zb = sheet.get_by_role('button', name=re.compile('ZIP으로 받기|내려받기|장 저장하기'))
            expect(zb).to_be_enabled(timeout=10000)
            with page.expect_download() as d:
                zb.click()
            path = OUT / ('review-' + d.value.suggested_filename)
            d.value.save_as(str(path))
            from PIL import Image
            if str(path).endswith('.zip'):
                with zipfile.ZipFile(path) as zf:
                    first = sorted(n for n in zf.namelist() if '-01-' in n)[0]
                    size = Image.open(io.BytesIO(zf.read(first))).size
            else:
                size = Image.open(path).size
            assert size == (1280, 720), f'모두 내려받기가 저장한 16:9 자르기를 안 씀: {size}'
            sheet.get_by_role('button', name='닫기').click()
            # 실제 구성품이 보여야 하는 자리: '일반 장면' 확인을 해야만 AI 버튼이 눌리고, 서버에도 그 확인을 보냄
            ai_sheet = lambda i: (cards.nth(i).get_by_role('button', name='바꾸기', exact=True).click(), sheet.get_by_role('button', name='AI로 새로 만들기').click())
            ai_sheet(1)
            expect(sheet).to_contain_text('실제 상품·화면이 보여야 하는 자리')
            go = sheet.get_by_role('button', name=re.compile(r'예상 \$[\d.]+ · 만들기'))
            expect(go).to_be_disabled()
            sheet.get_by_label(re.compile('일반 장면으로 만들게')).check()
            expect(go).to_be_enabled()
            # 적던 내용이 있으면 창 밖을 눌러도 안 닫힘 ('닫기'만 닫음)
            sheet.locator('label', has_text='더 원하는 것').locator('textarea').fill('위에서 내려다본 구도')
            page.locator('#dim').click(position={'x': 20, 'y': 20}, force=True)
            expect(page.locator('#toast')).to_contain_text('적던 내용이 있어서 안 닫았어')
            expect(sheet).to_be_visible()
            sheet.get_by_role('button', name='닫기').click()
            expect(sheet).to_be_hidden()
            # M2: '서버가 바빠'로 기다리는 중에 창을 닫으면, 누르지 않은 생성이 시작되지 않음
            n0 = len(mock.gens)
            mock.busy_left = 5
            ai_sheet(0)
            sheet.get_by_role('button', name=re.compile(r'예상 \$[\d.]+ · 만들기')).click()
            expect(sheet).to_contain_text('같은 요청으로 다시 보낼게')
            sheet.get_by_role('button', name='닫기').click()
            page.wait_for_timeout(3500)
            assert len(mock.gens) == n0, '창을 닫았는데 생성이 시작됨'
            assert not page.locator('#sheet').is_visible(), '닫은 뒤에 다른 창이 다시 열림'
            mock.busy_left = 0
            # H2: 서버가 더 큰 예상 비용을 알려주면 그 값을 보여주고, 다시 누르면 그 값으로 확인해서 만들어짐 (같은 값만 계속 보내지 않음)
            mock.min_est = 0.05
            ai_sheet(0)
            sheet.get_by_role('button', name=re.compile(r'예상 \$[\d.]+ · 만들기')).click()
            expect(sheet).to_contain_text('서버에서 다시 계산한 예상 비용이 $0.0500')
            go2 = sheet.get_by_role('button', name=re.compile(r'예상 \$0\.0500 · 만들기'))
            expect(go2).to_be_enabled()
            go2.click()
            expect(sheet).to_contain_text('다 만들었어', timeout=15000)
            reqs = [c for c in mock.calls if c['path'] == 'images/generate']
            assert reqs[-1]['body']['confirm_usd'] >= 0.05, reqs[-1]['body']
            mock.min_est = None
            sheet.get_by_role('button', name='보관함에만 두고 닫기').click()
            # M3: 원고 요청의 수익 모델 줄(.prog)은 예전 모양 그대로 (이미지 진행 표시와 이름이 겹치지 않음)
            goto_hash('content/new')
            prog = page.locator('.prog').first
            expect(prog).to_be_visible()
            assert prog.evaluate('(e) => getComputedStyle(e).flexDirection') == 'column'
        check('검토 회귀: 자르기 저장 유지·모두 내려받기, 실제 사진 자리 확인, 서버 바쁨 중 닫기, 서버 예상 비용 반영, 기존 화면 모양', t_review_regressions)

        # 검증에서 나온 것: 생성 전용 서버, 서버 예상 비용은 그 품질에만, 미리 채운 칸은 '적던 내용' 아님, 보낸 뒤 창 닫기, 생성 전용 서버가 없을 때
        def t_verify_regressions():
            gens = [c for c in mock.calls if c['path'] == 'images/generate']
            assert gens and all(c.get('fn') == 'gen' for c in gens), [c.get('fn') for c in gens]
            mock.settings['image_daily_limit'] = 50  # 이 시험에서 여러 장 만듦
            page.get_by_role('button', name='새로고침').click()
            page.wait_for_timeout(400)
            open_p8()
            cards = page.locator('section.studio .slot')
            sheet = page.locator('#sheet')
            go = lambda: sheet.get_by_role('button', name=re.compile(r'예상 \$[\d.]+ · 만들기'))

            def ai_sheet(i):
                card = cards.nth(i)
                b = card.get_by_role('button', name='바꾸기', exact=True).or_(card.get_by_role('button', name='AI로 만들기')).first
                expect(b).to_be_enabled()
                was = b.inner_text()
                b.click()
                if was == '바꾸기':
                    sheet.get_by_role('button', name='AI로 새로 만들기').click()
            # N4: 서버가 보통 품질로 다시 계산한 값($0.05)은 품질을 낮음으로 바꾸면 쓰지 않음
            mock.min_est = 0.05
            ai_sheet(0)
            go().click()
            expect(sheet).to_contain_text('서버에서 다시 계산한 예상 비용이 $0.0500')
            sheet.locator('label', has_text='품질').locator('select').select_option('low')
            expect(sheet).not_to_contain_text('서버에서 다시 계산한')
            assert '$0.0500' not in go().inner_text(), go().inner_text()
            mock.min_est = None
            sheet.get_by_role('button', name='닫기').click()
            # 더 원하는 것을 넣어 만들고 연결 → 연결할 때 만들 때 고른 용도도 같이 보냄
            ai_sheet(0)
            sheet.locator('label', has_text='더 원하는 것').locator('textarea').fill('밝은 오전 햇살')
            go().click()
            expect(sheet).to_contain_text('다 만들었어', timeout=15000)
            sheet.get_by_role('button', name=re.compile('이 이미지 쓰기')).click()
            expect(page.locator('#toast')).to_contain_text('연결했어')
            link = [c for c in mock.calls if c['path'].endswith('/images/link')][-1]['body']
            assert link.get('purpose') == 'blog_body', link
            # N6: '다시 만들기'는 전에 넣은 말을 미리 채움 → 안 고쳤으면 창 밖을 눌러도 그냥 닫힘, 고치면 안 닫힘
            cards.nth(0).get_by_role('button', name='다시 만들기').click()
            extra = sheet.locator('label', has_text='더 원하는 것').locator('textarea')
            expect(extra).to_have_value('밝은 오전 햇살')
            page.locator('#dim').click(position={'x': 20, 'y': 20}, force=True)
            expect(sheet).to_be_hidden()
            cards.nth(0).get_by_role('button', name='다시 만들기').click()
            extra.fill('밝은 오후 햇살')
            page.locator('#dim').click(position={'x': 20, 'y': 20}, force=True)
            expect(page.locator('#toast')).to_contain_text('적던 내용이 있어서 안 닫았어')
            expect(sheet).to_be_visible()
            sheet.get_by_role('button', name='닫기').click()
            # N11: 보낸 뒤 응답 전에 창을 닫아도, 서버가 받은 생성은 이미지 칸에 '만드는 중'으로 보임
            mock.hold_generate = True
            ai_sheet(0)
            go().click()
            for _ in range(50):
                if mock.held:
                    break
                page.wait_for_timeout(100)
            assert mock.held, '생성 요청이 오지 않음'
            sheet.get_by_role('button', name='닫기').click()
            mock.hold_generate = False
            release_held()
            expect(page.locator('section.studio')).to_contain_text('이미지 만드는 중', timeout=5000)
            expect(page.locator('#toast')).to_contain_text('서버에서 만드는 중')
            g = next(x for x in mock.gens if x['status'] == '생성 중')
            mock.polls[g['id']] = 5
            mock.handle('GET', f"images/generations/{g['id']}", {}, {'x-app-session': SESSION}, {})  # 가짜 서버에서 생성 끝내기
            page.get_by_role('button', name='새로고침').click()
            expect(page.locator('section.studio')).not_to_contain_text('이미지 만드는 중', timeout=8000)
            # 생성 전용 서버가 아직 없으면(404) 본 서버로 같은 요청을 보내고, 그다음부터는 바로 본 서버로
            mock.gen_missing = True
            before = len([c for c in mock.calls if c['path'] == 'images/generate'])
            ai_sheet(0)
            go().click()
            expect(sheet).to_contain_text('다 만들었어', timeout=15000)
            sheet.get_by_role('button', name='보관함에만 두고 닫기').click()
            ai_sheet(0)
            go().click()
            expect(sheet).to_contain_text('다 만들었어', timeout=15000)
            sheet.get_by_role('button', name='보관함에만 두고 닫기').click()
            after = [c for c in mock.calls if c['path'] == 'images/generate'][before:]
            assert [c.get('fn') for c in after] == ['app', 'app'], [c.get('fn') for c in after]
            assert mock.gen_hits == 1, f'404 뒤에도 생성 전용 서버로 또 보냄: {mock.gen_hits}'
            mock.gen_missing = False
        check('검증 회귀: 생성 전용 서버, 서버 예상 비용은 그 품질에만, 미리 채운 칸, 보낸 뒤 창 닫기, 생성 전용 서버 없을 때 본 서버로', t_verify_regressions)

        def t_img_no_keys():
            mock.keys = {'openai': False, 'pexels': False}
            page.get_by_role('button', name='새로고침').click()
            page.wait_for_timeout(400)
            open_p8()
            expect(page.locator('section.studio')).to_contain_text('OpenAI 키가 아직 없어')
            page.locator('section.studio .slot').nth(0).get_by_role('button', name='바꾸기', exact=True).click()
            page.locator('#sheet').get_by_role('button', name='AI로 새로 만들기').click()
            expect(page.locator('#sheet')).to_contain_text('OpenAI 키가 없어서 아직 못 만들어')
            expect(page.locator('#sheet').get_by_role('button', name=re.compile(r'예상 \$[\d.]+ · 만들기'))).to_be_disabled()
            page.locator('#sheet').get_by_role('button', name='닫기').click()
            page.locator('section.studio .slot').nth(0).get_by_role('button', name='바꾸기', exact=True).click()
            page.locator('#sheet').get_by_role('button', name='실제 사진 찾기 (Pexels)').click()
            expect(page.locator('#sheet')).to_contain_text('직접 올리기로 계속할 수 있어')
            expect(page.locator('#sheet').get_by_role('button', name='파일 올리기로')).to_be_visible()
            page.locator('#sheet').get_by_role('button', name='닫기').click()
            mock.keys = {'openai': True, 'pexels': True}
        check('키가 없으면: AI 만들기는 잠기고 이유 안내, 사진 검색은 직접 올리기로 안내', t_img_no_keys)

        # 10) 세션이 끊기면(권한 없음) 로그인 화면으로
        def t_unauthorized():
            mock.force_401 = True
            page.get_by_role('button', name='새로고침').click()
            expect(page.locator('#gate')).to_be_visible()
            expect(page.locator('#gateMsg')).to_contain_text('로그인이 풀렸어')
            assert page.evaluate("localStorage.getItem('gf-session')") is None
            mock.force_401 = False
        check('권한 없음(세션 끊김): 로그인 화면으로, 세션 지움', t_unauthorized)

        # 11) 올바른 코드가 붙은 예전 링크 → 자동 로그인 + 주소에서 코드 지움 (새 기기)
        def t_good_link():
            p2 = ctx.browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True)
            p2.route(API + '/**', api_route)
            p2.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, content_type='text/css', body=''))
            pg = p2.new_page()
            pg.goto(base + '?k=' + CODE)
            expect(pg.locator('#app')).to_be_visible()
            assert 'k=' not in pg.url, pg.url
            assert pg.evaluate("localStorage.getItem('gf-session')") == json.dumps(SESSION)
            p2.close()
        check('예전 링크(?k=맞는 코드): 자동 로그인 후 주소에서 코드 지움', t_good_link)

        page.wait_for_timeout(300)
        browser.close()
    httpd.shutdown()

    errs = [e for e in console_errors if 'Failed to load resource' not in e]
    # 401 응답은 테스트 10에서 일부러 만든 것 → 브라우저가 찍는 'Failed to load resource'만 빼고 봄
    RESULTS.append(('콘솔 오류 없음', not errs, '; '.join(errs)[:500]))
    print(('통과' if not errs else '실패'), '콘솔 오류 없음', '' if not errs else errs[:5])
    passed = sum(1 for r in RESULTS if r[1])
    print(f'\n화면 테스트: {passed}/{len(RESULTS)} 통과')
    (OUT / 'result.json').write_text(json.dumps([{'name': n, 'ok': ok, 'error': e} for n, ok, e in RESULTS], ensure_ascii=False, indent=1), encoding='utf-8')
    sys.exit(0 if passed == len(RESULTS) else 1)


if __name__ == '__main__':
    main()
