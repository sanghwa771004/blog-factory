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


KLEIN_SIZE = {'16:9': '1024x576', '4:3': '1024x768', '1:1': '1024x1024', '4:5': '816x1024', '9:16': '576x1024'}
GEMINI_RES = {'medium': '1K', 'high': '2K', 'max': '4K'}
# 1.5.0 모델 등록표 (images.js 와 같은 것만): 공급자, 종료된 모델
PROVIDER_OF = {'cf-flux-2-klein-4b': 'cloudflare', 'cf-flux-1-schnell': 'cloudflare', 'gpt-image-2.5-flare': 'openai', 'gpt-image-2.5-sunburst': 'openai',
               'gpt-image-2': 'openai', 'gpt-image-1.5': 'openai', 'gpt-image-1-mini': 'openai', 'gpt-image-1': 'openai',
               'gemini-3-pro-image': 'gemini', 'gemini-nano-banana-2.1': 'gemini', 'gf-test-fake': 'openai'}
RETIRED = {'gpt-image-1': '2026-10-23'}
KEY_MISSING = {'openai': 'openai_key_missing', 'gemini': 'gemini_key_missing', 'cloudflare': 'cf_key_missing'}
# AI 검수 모델 (images.js REVIEW_MODELS 와 같은 계산)
REVIEW = {'cf-gemma-4-26b': ('cloudflare', None), 'gemini-3.5-flash-lite': ('gemini', (0.3, 2.5, 1120)), 'gpt-5.6-luna': ('openai', (0.2, 1.2, 308))}


def review_est(model, n):
    prov, pr = REVIEW[model]
    if not pr:
        return 0
    return round(((max(1, n) * pr[2] + 900) * pr[0] + 1000 * pr[1]) / 1e6, 6)


def size_for(model, ratio, quality='medium'):
    """서버의 sizeFor 처럼: gpt-image-2·2.5는 비율 그대로, klein은 비율별 크기, Gemini는 '비율@해상도', 그 밖의 모델은 표준 크기 세 가지 중 방향이 같은 것"""
    s = RATIO_SIZE.get(ratio or '', '1280x960')
    if PROVIDER_OF.get(model) == 'gemini':
        return f"{ratio or '4:3'}@{GEMINI_RES.get(quality, '1K')}"
    if model == 'cf-flux-2-klein-4b':
        return KLEIN_SIZE.get(ratio or '', '1024x768')
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
        self.pre015 = False  # True면 서버가 DB 015(주력 주제 낱말·사진 출처 열) 전인 것처럼 답함
        self.post_channels, self.search_terms = [], []  # 1.4.0 다른 채널 기록·유입 검색어
        self.unavailable = []      # 서버가 못 읽은 표처럼 (DB 016 전·오류) → 화면은 데이터 없음
        self.fail_stats_from = set()  # 이 시작일의 통계 요청은 서버 오류로 답함 (홈이 '불러오는 중'에 멈추지 않는지)
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
        self.keys = {'openai': True, 'pexels': True, 'gemini': False, 'cloudflare': False}
        self.reviews, self.evals, self.checks, self.small_uploads = [], [], {}, []  # 1.5.0 AI 검수·내 평가·연결 확인·작은 사본
        self.server_secret = SECRET_MARK
        self.images, self.slots, self.gens, self.decks, self.polls = [], [], [], {}, {}
        self.min_est = None   # 서버 쪽 예상 비용이 더 크다고 답하게 (estimate_changed 시험)
        self.busy_left = 0    # 이 횟수만큼 server_busy 로 답하게 (서버 일꾼 시간 부족 시험)
        self.gen_missing = False  # 생성 전용 서버(blog-gen)가 아직 없는 것처럼 (Supabase 404)
        self.gen_hits = 0         # 그때 생성 전용 서버로 온 요청 수
        self.gen_boot_error = False  # 생성 전용 서버가 올라가 있지만 켜지지 못하는 것처럼 (Supabase 503 BOOT_ERROR)
        self.hold_generate = False  # 생성 요청의 응답을 붙잡아 둠 (보낸 뒤 창 닫기 시험)
        self.held = []
        self.settings.update({'image_gen_model': 'gpt-image-2.5-flare', 'image_edit_model': 'gpt-image-2.5-sunburst', 'image_quality': 'medium',
                              'image_daily_limit': 5, 'image_monthly_budget_usd': 2, 'image_fx_krw': 1400, 'image_fx_date': D(-1), 'image_fx_source': '테스트 환율',
                              'image_prices': {'image_output_per_m': 30, 'image_input_per_m': 8, 'text_input_per_m': 5, 'checked_at': '2026-10-22',
                                               'source': 'https://developers.openai.com/api/docs/pricing'}})
        self.runs = [{'id': 1, 'kind': 'auto', 'status': '성공', 'jobs_done': 0, 'jobs_failed': 0, 'written': 1, 'note': '원고 0 · 자동 1',
                      'error': '', 'ran_at': NOW}]

    # ── 계산 ──
    def stats(self, d_from, d_to, within=False):
        # within: 서버 stats_window 처럼 기간 안에 다 들어가는 실적만, partial = 걸쳐 있어서 뺀 줄 수
        F = ['views', 'impressions', 'clicks', 'orders', 'cancels', 'revenue_est', 'revenue_confirmed', 'revenue_paid', 'cost']
        posts = {p['id']: p for p in self.posts}
        rows = []
        partial = 0
        for m in self.metrics:
            if d_from and m['period_end'] < d_from:
                continue
            if d_to and m['period_start'] > d_to:
                continue
            if within and ((d_from and m['period_start'] < d_from) or (d_to and m['period_end'] > d_to)):
                partial += 1
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
                'by_channel': by('ch'), 'by_program': by('pr'), 'by_category': by('cat'), **({'within': True, 'partial': partial} if within else {})}

    # ── 이미지 스튜디오 ──
    def img(self, iid):
        return next((i for i in self.images if i['id'] == iid and not i.get('deleted_at')), None)

    def add_image(self, kind, post_id, slot_key, fx='4x3', **extra):
        url, w, h = FX_IMG[fx]
        i = {'id': self.new_id(), 'kind': kind, 'provider': {'ai': 'openai', 'stock': 'pexels', 'upload': 'upload', 'card': 'cardnews'}[kind], 'model': '',
             'prompt': '', 'user_prompt': '', 'style': '', 'purpose': 'blog_body', 'ratio': '', 'description': '', 'alt_text': '', 'storage_path': f'{kind}/2026/10/{self.seq}.jpg',
             'mime': 'image/png' if kind == 'card' else 'image/jpeg', 'bytes': 15000, 'width': w, 'height': h, 'sha256': '', 'source_url': '', 'source_id': '',
             'author_name': '', 'author_url': '', 'license': '', 'attribution_text': '', 'rights_confirmed': kind != 'ai', 'review_status': '검수 전', 'review_note': '',
             'generation_id': None, 'downloaded_at': None, 'created_at': NOW, 'updated_at': NOW, 'deleted_at': None, 'origin_post_id': post_id, 'source_type': '',
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

    def provider_status(self):
        out = {}
        for p in ('cloudflare', 'openai', 'gemini'):
            ok = next((g for g in self.gens if g.get('provider', 'openai') == p and g['status'] == '성공' and g['model'] != 'gf-test-fake'), None)
            out[p] = {'key': bool(self.keys.get(p)), 'check': self.checks.get(p), 'last_success': {'model': ok['model'], 'at': NOW} if ok else None, 'last_failure': None}
        return out

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
                'imports': self.imports, 'image_slots': self.image_slots_state(),
                'post_channels': [] if 'post_channels' in self.unavailable else self.post_channels,
                'search_terms': [] if 'search_terms' in self.unavailable else self.search_terms,
                'metric_post_ids': [] if 'metric_post_ids' in self.unavailable else sorted({m['post_id'] for m in self.metrics if m.get('post_id')}),
                'unavailable': list(self.unavailable),
                'runs_auto_7d': sum(1 for r in self.runs if r.get('kind') == 'auto' and str(r.get('ran_at', ''))[:10] >= D(-6))}

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
            f, t = query.get('from', [None])[0], query.get('to', [None])[0]
            if f in self.fail_stats_from:
                return 500, {'error': 'server'}
            if query.get('within') == ['1']:
                return 200, {'stats': self.stats(f, t, within=True)}
            return 200, {'stats': {**self.stats(f, t), 'image_costs': self.image_costs()}}
        if path == 'settings' and method == 'POST' and 'focus_topic' in body:
            # 자동 글쓰기 칸만 저장해 둠 (이미지 설정 같은 다른 설정은 다른 시험에 영향 주지 않게 — 시험 끝에 되돌림)
            for k in ('focus_topic', 'focus_terms', 'per_day', 'backlog_limit'):
                if k in body and not (k == 'focus_terms' and self.pre015):
                    self.settings[k] = body[k]
            if self.pre015 and 'focus_terms' in body:
                # 서버처럼: 015 전 DB면 주력 주제 낱말만 빼고 저장하고 알려줌
                return 200, {'settings': self.settings, 'skipped': ['focus_terms']}
        r = self.handle_images(method, path, query, headers, body)
        if r is not None:
            return r
        r = self.handle_ops(method, path, body)
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

    # ── 1.4.0 운영: 다른 채널 기록·유입 검색어·예정일 다시 잡기·개선안 (서버와 같은 규칙만 흉내) ──
    def handle_ops(self, method, path, body):
        post = lambda pid: next((p for p in self.posts if p['id'] == pid and not p['deleted_at']), None)
        if path == 'posts/reschedule-overdue' and method == 'POST':
            per = int(self.settings.get('per_day') or 1)
            moved = []
            # 서버처럼 '예약' 원고는 안 옮김 (예약한 날이 지났으면 이미 올라갔을 수 있음)
            for p in sorted([p for p in self.posts if not p['deleted_at'] and p['stage'] in ('review', 'verify', 'ready') and p.get('publish_date') and p['publish_date'] < D(0)], key=lambda x: x['publish_date']):
                n = 1
                while sum(1 for q in self.posts if not q['deleted_at'] and q['stage'] not in ('failed', 'queued') and q.get('publish_date') == D(n)) >= per:
                    n += 1
                moved.append({'id': p['id'], 'from': p['publish_date'], 'to': D(n)})
                p['publish_date'] = D(n)
            return 200, {'moved': moved}
        m = re.fullmatch(r'posts/([0-9a-f-]{36})/channels', path)
        if m and method == 'POST':
            p = post(m.group(1))
            if not p:
                return 404, {'error': 'not_found'}
            ch = body.get('channel_id')
            if ch not in [c['id'] for c in self.channels] or ch == p['channel_id']:
                return 400, {'error': 'bad_field', 'field': 'channel_id'}
            if body.get('url') and not re.match(r'^https://[^\s"\'<>]+$', body['url']):
                return 400, {'error': 'bad_field', 'field': 'url'}
            if not body.get('posted_on'):
                return 400, {'error': 'bad_field', 'field': 'posted_on'}
            row = next((x for x in self.post_channels if x['post_id'] == p['id'] and x['channel_id'] == ch), None)
            if not row:
                row = {'id': self.new_id(), 'post_id': p['id'], 'channel_id': ch, 'created_at': NOW}
                self.post_channels.append(row)
            row.update({'url': body.get('url', ''), 'posted_on': body['posted_on'], 'variant_key': body.get('variant_key', ''), 'note': body.get('note', ''), 'updated_at': NOW})
            return 200, {'post_channel': row}
        m = re.fullmatch(r'post-channels/([0-9a-f-]{36})', path)
        if m and method == 'DELETE':
            n0 = len(self.post_channels)
            self.post_channels = [x for x in self.post_channels if x['id'] != m.group(1)]
            return (200, {'ok': True}) if len(self.post_channels) < n0 else (404, {'error': 'not_found'})
        m = re.fullmatch(r'posts/([0-9a-f-]{36})/search-terms', path)
        if m and method == 'POST':
            p = post(m.group(1))
            if not p:
                return 404, {'error': 'not_found'}
            terms = body.get('terms') or []
            if not terms:
                return 400, {'error': 'empty'}
            # 서버(save_search_terms)처럼: 같은 글에 기간이 겹치는 다른 기록이 있으면 거절, replace_overlap 이면 그 기록을 지우고 저장
            s0, e0 = body['period_start'], body['period_end']
            over = [x for x in self.search_terms if x['post_id'] == p['id'] and x['period_start'] <= e0 and x['period_end'] >= s0 and not (x['period_start'] == s0 and x['period_end'] == e0)]
            if over and body.get('replace_overlap') is not True:
                periods = sorted({(x['period_start'], x['period_end']) for x in over})
                return 409, {'error': 'period_overlap', 'periods': [{'period_start': a, 'period_end': b} for a, b in periods]}
            self.search_terms = [x for x in self.search_terms if x not in over]
            saved = []
            for t in terms:
                term = ' '.join(str(t.get('term', '')).split())
                if not term or len(term) > 100 or (t.get('views') is not None and (not isinstance(t['views'], int) or t['views'] < 0)):
                    return 400, {'error': 'bad_field', 'field': 'terms'}
                row = next((x for x in self.search_terms if x['post_id'] == p['id'] and x['term'] == term and x['period_start'] == body['period_start'] and x['period_end'] == body['period_end']), None)
                if not row:
                    row = {'id': self.new_id(), 'post_id': p['id'], 'term': term, 'period_start': body['period_start'], 'period_end': body['period_end'], 'created_at': NOW}
                    self.search_terms.append(row)
                row.update({'views': t.get('views'), 'channel_id': p['channel_id'], 'source_label': body.get('source_label', '')})
                saved.append(row)
            return 200, {'saved': len(saved), 'search_terms': saved}
        m = re.fullmatch(r'search-terms/([0-9a-f-]{36})', path)
        if m and method == 'DELETE':
            n0 = len(self.search_terms)
            self.search_terms = [x for x in self.search_terms if x['id'] != m.group(1)]
            return (200, {'ok': True}) if len(self.search_terms) < n0 else (404, {'error': 'not_found'})
        if path == 'jobs' and method == 'POST' and body.get('kind') == 'refresh':
            p = post(body.get('post_id'))
            if not p:
                return 404, {'error': 'not_found'}
            if p['stage'] not in ('published', 'collecting', 'analyzed'):
                return 409, {'error': 'not_published'}
            if len(p.get('body') or '') < 200:
                return 400, {'error': 'no_body'}
            if any(j for j in self.jobs if j['kind'] == 'refresh' and j['post_id'] == p['id'] and j['status'] == 'pending'):
                return 409, {'error': 'job_exists'}
            job = {'id': self.new_id(), 'kind': 'refresh', 'keyword': p['keyword'], 'status': 'pending', 'post_id': p['id'], 'attempts': 0, 'started_at': None,
                   'created_at': NOW, 'done_at': None, 'note': '', 'payload': {'focus': body.get('focus', 'all'), **({'note': body['note']} if body.get('note') else {})}}
            self.jobs.append(job)
            return 200, {'job': job}
        m = re.fullmatch(r'posts/([0-9a-f-]{36})', path)
        if m and method == 'POST' and 'refresh' in body:
            p = post(m.group(1))
            if body['refresh'] is not None:
                return 400, {'error': 'bad_field', 'field': 'refresh'}
            p['refresh'] = {}
            return 200, {'post': p, 'demoted': None, 'image_sync': None}
        return None

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
            return 200, {'keys': self.keys, 'providers': self.post_images(self.ids['P8'])['providers'], 'provider_status': self.provider_status(), 'settings': self.settings,
                         'usage': self.usage(), 'test_model': 'gf-test-fake', 'sign_seconds': 3600, 'storage_limit': 900 * 1024 * 1024}
        if path == 'images/providers/check' and method == 'POST':
            prov = body.get('provider')
            if prov not in KEY_MISSING:
                return 400, {'error': 'bad_field', 'field': 'provider'}
            ok = bool(self.keys.get(prov))
            model = {'cloudflare': '@cf/black-forest-labs/flux-2-klein-4b', 'openai': 'gpt-image-2.5-flare', 'gemini': 'gemini-3-pro-image'}[prov]
            self.checks[prov] = {'provider': prov, 'model': model, 'ok': ok, 'code': 'ok' if ok else KEY_MISSING[prov],
                                 'message': f'키가 맞고 {model} 모델을 쓸 수 있다고 답했어 (이미지는 아직 안 만들어 봄).' if ok else '키가 없어.', 'checked_at': NOW}
            return 200, {'check': self.checks[prov]}
        if path == 'images/compare-stats' and method == 'GET':
            cmp_batches = {g['batch']['id'] for g in self.gens if g.get('batch') and g['batch'].get('kind') == 'compare'}
            by = {}
            for e in self.evals:
                if e.get('batch_id') not in cmp_batches:
                    continue
                x = by.setdefault(e['model'], {'model': e['model'], 'rated': 0, 'preferred': 0, 'sums': {}, 'n': {}})
                x['rated'] += 1
                x['preferred'] += 1 if e.get('preferred') else 0
                for k, v in (e.get('scores') or {}).items():
                    x['sums'][k] = x['sums'].get(k, 0) + v
                    x['n'][k] = x['n'].get(k, 0) + 1
            models = [{'model': x['model'], 'rated': x['rated'], 'preferred': x['preferred'], 'avg': {k: round(x['sums'][k] / x['n'][k], 2) for k in x['sums']}} for x in by.values()]
            return 200, {'batches': len({e['batch_id'] for e in self.evals if e.get('batch_id') in cmp_batches}), 'models': models}
        m = re.fullmatch(r'images/([0-9a-f-]{36})/small', path)
        if m and method == 'POST':
            i = self.img(m.group(1))
            if not i:
                return 404, {'error': 'not_found'}
            from PIL import Image
            try:
                w, h = Image.open(io.BytesIO(body.get('file_bytes') or b'')).size
            except Exception:  # noqa: BLE001
                return 400, {'error': 'bad_image', 'reason': 'bad_type'}
            if not (0 < w < 512 and 0 < h < 512):  # 서버처럼: 512px보다 작아야 함
                return 400, {'error': 'bad_field', 'field': 'file'}
            i['ref_small_path'] = f"small/2026/10/{i['id']}.jpg"
            self.small_uploads.append({'id': i['id'], 'w': w, 'h': h})
            return 200, {'image': {'id': i['id'], 'ref_small_path': i['ref_small_path']}}
        m = re.fullmatch(r'images/([0-9a-f-]{36})/review', path)
        if m and method == 'POST':
            i = self.img(m.group(1))
            if not i:
                return 404, {'error': 'not_found'}
            if i['kind'] != 'ai':
                return 400, {'error': 'review_ai_only'}
            model = body.get('model') or self.settings.get('image_review_model') or ''
            if model not in REVIEW:
                return 400, {'error': 'review_model_unknown' if model else 'review_model_off'}
            prov = REVIEW[model][0]
            if not self.keys.get(prov):
                return 503, {'error': KEY_MISSING[prov]}
            est = review_est(model, 1 + min(3, len(i.get('ref_images') or [])))
            seen = body.get('confirm_usd')
            if not isinstance(seen, (int, float)) or seen + max(0.0005, est * 0.02) < est:
                return 409, {'error': 'estimate_changed', 'est_usd': est, 'model': model}
            free = REVIEW[model][1] is None
            r = {'id': self.new_id(), 'kind': 'ai_review', 'image_id': i['id'], 'provider': prov, 'model': model, 'status': '완료', 'created_at': NOW,
                 'scores': {'checks': {'match': {'verdict': 'ok', 'reason': '원고의 사진 자리와 맞아', 'confidence': 0.8},
                                       'artifacts': {'verdict': 'issue', 'reason': '왼쪽 아래에 글자 같은 무늬가 있어', 'confidence': 0.6},
                                       'anatomy': {'verdict': 'unsure', 'reason': '사람이 작아서 판단하기 어려워', 'confidence': None}}},
                 'summary': '대체로 자연스럽지만 왼쪽 아래를 확인해줘.', 'uncertainty': '작은 글자는 확대해 봐야 해', 'suggestions': ['왼쪽 아래 글자 무늬만 지워줘'],
                 'est_usd': est, 'usage_usd': None if free else round(est * 0.8, 6), 'cost_status': '청구 없음' if free else '사용량 기준'}
            self.reviews.insert(0, r)
            return 200, {'review': r}
        m = re.fullmatch(r'images/([0-9a-f-]{36})/evaluate', path)
        if m and method == 'POST':
            i = self.img(m.group(1))
            if not i:
                return 404, {'error': 'not_found'}
            scores = {k: v for k, v in (body.get('scores') or {}).items() if k in ('fit', 'natural', 'detail', 'composition', 'ai_look', 'usable') and v in (1, 2, 3)}
            if body.get('preferred') and body.get('batch_id'):
                for e in self.evals:
                    if e.get('batch_id') == body['batch_id'] and e['image_id'] != i['id']:
                        e['preferred'] = False
            self.evals = [e for e in self.evals if e['image_id'] != i['id']]
            e = {'id': self.new_id(), 'kind': 'user_eval', 'image_id': i['id'], 'model': i.get('model', ''), 'batch_id': body.get('batch_id'), 'scores': scores, 'preferred': bool(body.get('preferred'))}
            self.evals.append(e)
            return 200, {'review': e}
        m = re.fullmatch(r'images/([0-9a-f-]{36})/lineage', path)
        if m and method == 'GET':
            byid = {x['id']: x for x in self.images}
            root = byid.get(m.group(1))
            if not root:
                return 404, {'error': 'not_found'}
            while root.get('parent_image_id') and root['parent_image_id'] in byid:
                root = byid[root['parent_image_id']]
            items, todo = [], [(root, 0)]
            while todo:
                x, lv = todo.pop(0)
                g = next((g for g in self.gens if g['id'] == x.get('generation_id')), None)
                items.append({'id': x['id'], 'parent_image_id': x.get('parent_image_id'), 'level': lv, 'kind': x['kind'], 'provider': x['provider'], 'model': x.get('model', ''),
                              'user_prompt': x.get('user_prompt', ''), 'description': x.get('description', ''), 'created_at': NOW, 'deleted': bool(x.get('deleted_at')),
                              'url': '' if x.get('deleted_at') else x['url'], 'cost': {'est_usd': g['est_usd'], 'usage_usd': g['usage_usd'], 'actual_usd': None, 'cost_status': g['cost_status'], 'mode': g['mode']} if g else None})
                todo += [(c, lv + 1) for c in self.images if c.get('parent_image_id') == x['id']]
            return 200, {'root_id': root['id'], 'items': items}
        if path == 'images/generate' and method == 'POST':
            # 1.5.0 서버처럼: 요청의 모델(화면에서 고른 모드)이 먼저, 없으면 설정의 모델. 모르는·종료된 모델은 거절, 공급자마다 키 확인
            model = body.get('model') or self.settings['image_edit_model' if body.get('mode') == 'edit' else 'image_gen_model']
            prov = PROVIDER_OF.get(model)
            if not prov:
                return 400, {'error': 'model_unknown', 'model': model}
            if model in RETIRED:
                return 400, {'error': 'model_retired', 'model': model, 'retired': RETIRED[model]}
            if model != 'gf-test-fake' and not self.keys.get(prov):
                return 503, {'error': KEY_MISSING[prov]}
            dup = next((g for g in self.gens if g['request_key'] == body['request_key']), None)
            if dup:
                return 200, {'generation': dup, 'duplicate': True}
            if any(g['status'] == '생성 중' for g in self.gens):
                return 409, {'error': 'image_busy'}
            if self.busy_left > 0:
                self.busy_left -= 1
                return 503, {'error': 'server_busy', 'retry_after': 1}
            refs = body.get('refs') or []
            if prov == 'cloudflare':
                need = [r['image_id'] for r in refs if not (self.img(r['image_id']) or {}).get('ref_small_path')]
                if body.get('mode') == 'edit' and not (self.img(body.get('base_image_id')) or {}).get('ref_small_path'):
                    need.insert(0, body.get('base_image_id'))
                if need:
                    return 409, {'error': 'ref_small_missing', 'ids': need}
            quality = body.get('quality', 'medium')
            size = size_for(model, body.get('ratio'), quality)
            changed = {'error': 'estimate_changed', 'model': model, 'size': size, 'quality': quality}  # 실제 서버처럼 무엇으로 계산했는지도
            if not isinstance(body.get('confirm_usd'), (int, float)):
                return 409, {**changed, 'est_usd': 0.0111}
            if self.min_est and body['confirm_usd'] + 1e-9 < self.min_est:
                return 409, {**changed, 'est_usd': self.min_est}
            free = prov == 'cloudflare'
            g = {'id': self.new_id(), 'request_key': body['request_key'], 'post_id': body['post_id'], 'slot_key': body['slot_key'], 'mode': body.get('mode', 'generate'),
                 'model': model, 'provider': prov, 'size': size, 'quality': quality,
                 'purpose': body.get('purpose'), 'style': body.get('style'), 'user_prompt': '\n'.join(x for x in (body.get('text', ''), body.get('extra', '')) if x),
                 'ratio': body.get('ratio') or '', 'status': '생성 중', 'provider_called': True, 'refs': refs, 'batch': body.get('batch'), 'preset': body.get('preset', ''),
                 'scene': body.get('scene'), 'base_image_id': body.get('base_image_id'),
                 'error_code': '', 'error_message': '', 'est_usd': body['confirm_usd'], 'usage_usd': None, 'actual_usd': None, 'actual_checked_at': None,
                 'cost_status': '청구 없음' if free else '예상', 'fx_krw': 1400, 'image_id': None, 'created_at': NOW, 'started_at': NOW, 'finished_at': None}
            self.gens.insert(0, g)
            self.polls[g['id']] = 0
            return 202, {'generation': g, 'est_usd': g['est_usd'], 'model': g['model'], 'size': g['size'], 'quality': g['quality'], 'provider': prov}
        m = re.fullmatch(r'images/generations/([0-9a-f-]{36})', path)
        if m and method == 'GET':
            g = next(x for x in self.gens if x['id'] == m.group(1))
            self.polls[g['id']] += 1
            image = None
            if g['status'] == '생성 중' and self.polls[g['id']] >= 2:
                refs = g.get('refs') or []
                composite = any(r.get('role') in ('subject', 'background') and (self.img(r['image_id']) or {}).get('kind') not in ('ai', 'card', None) for r in refs)
                i = self.add_image('ai', g['post_id'], g['slot_key'], {'16:9': '16x9', '4:5': '4x5'}.get(g.get('ratio') or '', '4x3'), model=g['model'], provider=g.get('provider', 'openai'),
                                   prompt='Image type: Photograph — … Text and logos: none', description=g['user_prompt'],
                                   alt_text=g['user_prompt'][:120], generation_id=g['id'], purpose=g['purpose'] or 'blog_body', ratio=g.get('ratio') or '',
                                   ref_images=[{'image_id': r['image_id'], 'role': r['role'], 'kind': (self.img(r['image_id']) or {}).get('kind', '')} for r in refs],
                                   composite=composite, parent_image_id=g.get('base_image_id') if g['mode'] == 'edit' else None, preset=g.get('preset', ''), scene=g.get('scene'),
                                   user_prompt=g['user_prompt'])
                free = g.get('provider') == 'cloudflare'
                g.update({'status': '성공', 'image_id': i['id'], 'usage_usd': 0 if free else 0.01107, 'cost_status': '청구 없음' if free else '사용량 기준', 'finished_at': NOW})
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
            if i['kind'] == 'upload' and meta.get('source_type') in ('own', 'official', 'external'):
                i['source_type'] = meta['source_type']  # 서버처럼: 고른 출처만 저장 (안 고르면 빈칸 = 출처 확인 필요)
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
                return 200, {'image': self.with_uses(i), 'used_in': used, 'decks': [], 'generation': next((g for g in self.gens if g['id'] == i['generation_id']), None),
                             'reviews': [r for r in self.reviews + self.evals if r['image_id'] == i['id']]}
            if method == 'POST':
                if 'source_type' in body:
                    if i['kind'] != 'upload' or body['source_type'] not in ('', 'own', 'official', 'external'):
                        return 400, {'error': 'bad_field', 'field': 'source_type'}
                    if self.pre015:
                        return 409, {'error': 'db_update_needed', 'migration': '015'}
                    i['source_type'] = body['source_type']
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
            if gen and mock.gen_boot_error:  # 올라가 있지만 켜지지 못한 경우 Supabase가 주는 답
                mock.gen_hits += 1
                return route.fulfill(status=503, headers={**cors, 'Content-Type': 'application/json'}, body=json.dumps({'code': 'BOOT_ERROR', 'message': 'Function failed to start (please check logs)'}))
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
                        'mime': fpart.group(2).decode() if fpart else '', 'size': len(fpart.group(3)) if fpart else 0, 'file_head': fpart.group(3)[:16].hex() if fpart else '',
                        'file_bytes': fpart.group(3) if fpart else b''}
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
            # 점수 근거가 모두 AI 추정이면 점수 옆에 'AI 추정', 검색량·경쟁도를 조회하지 않았다고 밝힘 (1.3.1)
            expect(page.locator('#view')).to_contain_text('/100 · AI 추정')
            expect(page.locator('#view')).to_contain_text('검색량·경쟁도는 조회하지 않은 추정이야')
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
            assert up['meta']['source_type'] == '', '출처를 안 고르면 빈칸 (직접 촬영으로 보내지 않음)'
            card = page.locator('section.studio .slot').nth(1)
            expect(card.locator('.chip.k-upload')).to_be_visible()
            expect(card.locator('.chip.o-unknown')).to_contain_text('출처 확인 필요')
            # 미리보기에서 출처를 '직접 촬영'으로 확인해야 직접 촬영 사진으로 셈
            card.get_by_role('button', name='미리보기·내려받기').click()
            sheet = page.locator('#sheet')
            src = sheet.get_by_label('이 사진은 어디서 났어?')
            expect(src).to_have_value('')
            src.select_option('own')
            expect(page.locator('#toast')).to_contain_text('출처를 바꿨어')
            last = [c for c in mock.calls if re.fullmatch(r'images/[0-9a-f-]{36}', c['path']) and c['method'] == 'POST'][-1]['body']
            assert last == {'source_type': 'own'}, last
            sheet.get_by_role('button', name='닫기').click()
            expect(page.locator('section.studio .slot').nth(1).locator('.chip.o-own')).to_contain_text('직접 촬영')
        check('직접 올리기: 가짜 이미지 거절, 숨은 정보 없이 다시 저장, 권한 확인 필수, 자리 연결, 출처는 직접 확인해야 직접 촬영', t_img_upload)

        # 서버를 DB 015보다 먼저 올렸을 때: 사진 출처 바꾸기는 'DB 업데이트 필요' 안내(고른 값은 되돌림), 설정은 나머지만 저장하고 알려줌
        def t_pre015():
            mock.pre015 = True
            try:
                card = page.locator('section.studio .slot').nth(1)
                card.get_by_role('button', name='미리보기·내려받기').click()
                sheet = page.locator('#sheet')
                src = sheet.get_by_label('이 사진은 어디서 났어?')
                expect(src).to_have_value('own')
                src.select_option('official')
                expect(page.locator('#toast')).to_contain_text('DB 업데이트(015)가 아직 안 돼서')
                expect(src).to_have_value('own')
                sheet.get_by_role('button', name='닫기').click()
                expect(page.locator('section.studio .slot').nth(1).locator('.chip.o-own')).to_contain_text('직접 촬영')
                goto_hash('settings/auto')
                sec = page.locator('#sec-auto')
                sec.locator('label', has_text='주력 주제 낱말').locator('input').fill('전기요')
                sec.get_by_role('button', name='저장', exact=True).click()
                expect(page.locator('#toast')).to_contain_text('주력 주제 낱말은 DB 업데이트(015) 뒤에 저장돼')
                assert mock.settings.get('focus_terms', '') == '', '015 전에는 주력 주제 낱말이 저장되지 않음'
            finally:
                mock.pre015 = False
        check('DB 015 전 서버: 사진 출처는 DB 업데이트 필요 안내(값 되돌림), 설정은 나머지만 저장하고 알려줌', t_pre015)

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
            sheet.locator('select[name=quality]').select_option('low')  # 1.5.0: '모드' 칸에도 '고품질'이라는 글자가 있어서 이름으로 찾음
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

        # 생성 전용 서버가 올라가 있지만 켜지지 못하면(503 BOOT_ERROR) 로그아웃 없이 본 서버로 같은 요청을 보냄
        def t_gen_boot_error():
            page.reload()
            expect(page.locator('#app')).to_be_visible()
            mock.gen_boot_error, mock.gen_hits = True, 0
            open_p8()
            sheet = page.locator('#sheet')
            card = page.locator('section.studio .slot').nth(0)
            card.get_by_role('button', name='바꾸기', exact=True).click()
            sheet.get_by_role('button', name='AI로 새로 만들기').click()
            n0 = len([c for c in mock.calls if c['path'] == 'images/generate'])
            sheet.get_by_role('button', name=re.compile(r'예상 \$[\d.]+ · 만들기')).click()
            expect(sheet).to_contain_text('다 만들었어', timeout=15000)
            after = [c for c in mock.calls if c['path'] == 'images/generate'][n0:]
            assert [c.get('fn') for c in after] == ['app'] and mock.gen_hits == 1, ([c.get('fn') for c in after], mock.gen_hits)
            assert page.evaluate("localStorage.getItem('gf-session')"), '로그아웃되면 안 됨'
            sheet.get_by_role('button', name='보관함에만 두고 닫기').click()
            mock.gen_boot_error = False
        check('생성 전용 서버가 켜지지 못하면(503) 로그아웃 없이 본 서버로', t_gen_boot_error)

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

        # ───────── 1.5.0 이미지 스튜디오 고품질화 ─────────
        sheet = page.locator('#sheet')
        gen_bodies = lambda: [c['body'] for c in mock.calls if c['path'] == 'images/generate']

        def sheet_shot(name):
            # 창(시트)만 찍기 — 전체 화면 캡처에는 고정된 창이 잘 안 담겨서
            sheet.screenshot(path=str(OUT / f'{name}.png'))

        def close_sheet():
            # 앞 시험이 중간에 실패해서 창이 열려 있으면 닫고 시작 (다음 시험이 따라 실패하지 않게). 닫히는 중이면 기다리기만
            page.wait_for_timeout(300)
            if sheet.is_visible():
                try:
                    sheet.locator('.split button', has_text='닫기').first.click(timeout=3000)
                except Exception:  # noqa: BLE001
                    pass
                page.wait_for_timeout(200)

        def reload_keys(**keys):
            close_sheet()
            mock.keys = {'openai': True, 'pexels': True, 'gemini': True, 'cloudflare': True, **keys}
            page.get_by_role('button', name='새로고침').click()
            page.wait_for_timeout(400)

        def open_ai(i):
            card = page.locator('section.studio .slot').nth(i)
            b = card.get_by_role('button', name='바꾸기', exact=True).or_(card.get_by_role('button', name='AI로 만들기')).first
            expect(b).to_be_enabled()
            was = b.inner_text()
            b.click()
            if was == '바꾸기':
                sheet.get_by_role('button', name='AI로 새로 만들기').click()
            expect(sheet.locator('select[name=mode]')).to_be_visible()

        def t_studio_modes_presets():
            reload_keys()
            open_p8()
            n_set = len([c for c in mock.calls if c['path'] == 'settings'])
            open_ai(0)
            mode = sheet.locator('select[name=mode]')
            opts = mode.locator('option').all_inner_texts()
            assert len(opts) == 4, opts
            assert any('FLUX.2 [klein] 4B (무료)' in o for o in opts) and any('GPT Image 2.5 (유료)' in o for o in opts) and any('Gemini 3 Pro Image (유료)' in o for o in opts), opts
            expect(mode).to_have_value('fast_paid')  # 설정의 모델(gpt-image-2.5-flare)·기본 품질(보통)과 같은 모드로 열림
            expect(sheet).to_contain_text('OpenAI · gpt-image-2.5-flare')
            preset = sheet.locator('select[name=preset]')
            assert preset.locator('option').count() == 9
            expect(preset.locator('option', has_text='(추천)')).to_have_count(1)
            sheet.get_by_text('AI에 보낼 내용 보기').click()
            pre = sheet.locator('pre.prompt').first
            expect(pre).to_contain_text('Image type: Photograph')
            expect(pre).to_contain_text('Text and logos:')
            assert 'Create an illustrative image' not in pre.inner_text(), '예전 고정 문구가 없어야 함'
            assert not re.search(r'dust|crease|clutter|not perfectly centered', pre.inner_text(), re.I), '사용 흔적·어수선함·가운데 피하기를 강제하지 않음'
            expect(sheet).to_contain_text('계절·날씨·시간: 원고에 없어서 넣지 않음')
            preset.select_option('diagram')
            expect(pre).to_contain_text('Image type: Information diagram')
            # 무료 모드: 실제 모델 이름과 무료 표시
            mode.select_option('free_draft')
            expect(sheet.locator('.costbox')).to_contain_text('cf-flux-2-klein-4b')
            expect(sheet.locator('.costbox')).to_contain_text('무료 (')
            # Gemini 모드: 품질 칸이 해상도, 크기는 비율·해상도, 공급자 사용량 화면 안내
            mode.select_option('gemini_hq')
            q = sheet.locator('select[name=quality]')
            assert q.locator('option').all_inner_texts() == ['1K (보통)', '2K (높음)', '4K (최고)'], q.locator('option').all_inner_texts()
            expect(q).to_have_value('high')
            expect(sheet.locator('.costbox')).to_contain_text('4:3 · 2K')
            expect(sheet.locator('.costbox')).to_contain_text('예상 $0.13')
            expect(sheet.locator('.costbox')).to_contain_text('Google Gemini API 사용량 화면')
            expect(sheet.locator('.costbox')).to_contain_text('계산 근거:')
            no_overflow('AI 만들기 창 (1.5.0)')
            sheet_shot('30-studio-modes')
            assert len([c for c in mock.calls if c['path'] == 'settings']) == n_set, '모드를 바꿔도 설정은 안 바뀜'
            sheet.get_by_role('button', name='닫기').click()
            expect(sheet).to_be_hidden()
        check('1.5.0 모드·프리셋: 모드마다 실제 모델·무료/유료, 설정과 같은 모드로 열림, 프리셋 9가지(추천 하나), 이미지 종류별 지시문, Gemini는 해상도', t_studio_modes_presets)

        def t_studio_free_and_candidates():
            # 설정이 무료 모델이면 창도 무료 모드로 열리고, 유료로 저절로 바뀌지 않음
            mock.settings['image_gen_model'] = 'cf-flux-2-klein-4b'
            reload_keys()
            open_p8()
            open_ai(0)
            expect(sheet.locator('select[name=mode]')).to_have_value('free_draft')
            n0 = len(gen_bodies())
            sheet.get_by_role('button', name=re.compile(r'· 만들기$')).click()
            expect(sheet).to_contain_text('다 만들었어', timeout=20000)
            req = gen_bodies()[n0]
            assert req['model'] == 'cf-flux-2-klein-4b' and req['confirm_usd'] == 0, req
            sheet.get_by_role('button', name='보관함에만 두고 닫기').click()
            mock.settings['image_gen_model'] = 'gpt-image-2.5-flare'
            reload_keys()
            open_p8()
            # 후보 2장: 버튼에 장수·합계 예상, 한 장씩 차례로 (같은 묶음 번호, 남은 장의 예상 비용을 미리 예약)
            open_ai(0)
            sheet.get_by_role('button', name='2장 비교').click()
            go = sheet.get_by_role('button', name=re.compile(r'예상 \$[\d.]+ \(2장\) · 만들기'))
            expect(go).to_be_enabled()
            expect(sheet.locator('.costbox')).to_contain_text('× 2장 =')
            n0 = len(gen_bodies())
            go.click()
            expect(sheet).to_contain_text('후보 2장', timeout=40000)
            reqs = gen_bodies()[n0:]
            assert len(reqs) == 2, len(reqs)
            b0, b1 = reqs[0]['batch'], reqs[1]['batch']
            assert b0['kind'] == 'candidates' and b0['id'] == b1['id'] and [b0['index'], b1['index']] == [0, 1] and b0['total'] == b1['total'] == 2, (b0, b1)
            assert reqs[0]['request_key'] != reqs[1]['request_key']
            assert abs(reqs[0]['reserve_usd'] - 2 * reqs[0]['confirm_usd']) < 1e-6 and abs(reqs[1]['reserve_usd'] - reqs[1]['confirm_usd']) < 1e-6, reqs
            assert all(r['model'] == 'gpt-image-2.5-flare' for r in reqs)
            expect(sheet).to_contain_text('앱이 대신 고르지 않아')
            picks = sheet.get_by_role('button', name=re.compile('이걸로 쓰기'))
            expect(picks).to_have_count(2)
            sheet_shot('31-studio-candidates')
            picks.nth(1).click()
            expect(page.locator('#toast')).to_contain_text('연결했어')
        check('1.5.0 무료 모드 그대로·후보 2장: 설정이 무료면 무료로(유료로 안 바뀜), 후보는 장수·합계 예상, 같은 묶음으로 한 장씩, 고르는 건 사용자', t_studio_free_and_candidates)

        def t_studio_real_product_ref():
            close_sheet()
            # 진짜 제품 사진(직접 올린 사진)을 '대상 모양 유지' 참고 사진으로 → 실제 상품이 보여야 하는 자리(구성품)도 'AI 합성'으로 만들 수 있음
            # (앞 시험에서 자리를 맞바꿨을 수 있어서, 직접 올린 사진을 구성품 자리(사진 2)에 다시 연결해 두고 시작)
            up0 = next(i for i in mock.images if i['kind'] == 'upload' and not i.get('deleted_at'))
            mock.link(P8, parse_slots(next(p for p in mock.posts if p['id'] == P8)['body'])[1]['key'], up0['id'])
            reload_keys()
            open_p8()
            card = page.locator('section.studio .slot').nth(1)
            card.get_by_role('button', name='미리보기·내려받기').click()
            sheet.get_by_role('button', name='이 사진을 참고해서 AI로 새로 만들기').click()
            expect(sheet.locator('select[aria-label="참고 사진 역할"]')).to_have_value('subject')
            expect(sheet).to_contain_text("결과는 'AI 합성'으로 표시되고, 실제로 써본 사진처럼 쓰면 안 돼")
            expect(sheet.get_by_label(re.compile('일반 장면으로 만들게'))).to_have_count(0)
            go = sheet.get_by_role('button', name=re.compile(r'예상 \$[\d.]+ · 만들기'))
            expect(go).to_be_enabled()
            up = next(i for i in mock.images if i['kind'] == 'upload' and not i.get('deleted_at'))
            n0 = len(gen_bodies())
            go.click()
            expect(sheet).to_contain_text('다 만들었어', timeout=20000)
            req = gen_bodies()[n0]
            assert req['refs'] == [{'image_id': up['id'], 'role': 'subject'}] and 'generic_ok' not in req, req
            expect(sheet).to_contain_text('참고한 제품 사진과 모양·글자·버튼이 같은지')
            new = next(i for i in mock.images if i['kind'] == 'ai')
            assert new['composite'] is True and new['ref_images'][0]['role'] == 'subject'
            sheet.get_by_role('button', name='보관함에만 두고 닫기').click()
            # 무료 모델로 같은 참고 사진: 512px보다 작은 사본을 먼저 올리고(원본은 그대로) 그다음 생성
            open_p8()
            card.get_by_role('button', name='미리보기·내려받기').click()
            sheet.get_by_role('button', name='이 사진을 참고해서 AI로 새로 만들기').click()
            sheet.locator('select[name=mode]').select_option('free_draft')
            expect(sheet).to_contain_text('500px 안으로 줄인 사본')
            n_calls = len(mock.calls)
            sheet.get_by_role('button', name=re.compile(r'· 만들기$')).click()
            expect(sheet).to_contain_text('다 만들었어', timeout=20000)
            later = [c['path'] for c in mock.calls[n_calls:]]
            small = f"images/{up['id']}/small"
            assert small in later and later.index(small) < later.index('images/generate'), later
            s = mock.small_uploads[-1]
            assert s['id'] == up['id'] and max(s['w'], s['h']) <= 500, s
            assert up['storage_path'].startswith('upload/'), '원본은 그대로'
            sheet.get_by_role('button', name='보관함에만 두고 닫기').click()
        check('1.5.0 진짜 제품 사진 참고: 대상 모양 유지 역할, 실제 상품 자리도 AI 합성으로, 결과에 원본 비교 안내, 무료 모델은 작은 사본을 먼저', t_studio_real_product_ref)

        def t_studio_review():
            close_sheet()
            open_p8()
            n_link = len([c for c in mock.calls if c['path'].endswith('/images/link')])
            page.locator('section.studio .slot').nth(0).get_by_role('button', name='미리보기·내려받기').click()
            sheet.get_by_role('button', name='AI 검수 (참고용)').click()
            sel = sheet.get_by_label('검수할 AI')
            expect(sel).to_have_value('cf-gemma-4-26b')  # 키가 있으면 무료 모델이 먼저 (설정에서 고른 모델이 없을 때)
            expect(sheet).to_contain_text('무료 (Cloudflare 무료 플랜')
            sel.select_option('gpt-5.6-luna')
            expect(sheet).to_contain_text('근거: 입력 약 1,208토큰')
            sheet.get_by_role('button', name='AI 검수 받기').click()
            expect(sheet).to_contain_text('품질을 보장하는 점수가 아니고 틀릴 수 있어')
            expect(sheet).to_contain_text('(확신 80%)')
            expect(sheet).to_contain_text('판단 어려움')
            expect(sheet).to_contain_text('불확실한 점: 작은 글자는 확대해 봐야 해')
            body = [c for c in mock.calls if c['path'].endswith('/review')][-1]['body']
            assert body['model'] == 'gpt-5.6-luna' and abs(body['confirm_usd'] - review_est('gpt-5.6-luna', 1)) < 1e-9, body
            assert len([c for c in mock.calls if c['path'].endswith('/images/link')]) == n_link, '검수가 대신 고르거나 연결하지 않음'
            assert not [c for c in mock.calls if c['method'] == 'DELETE' and c['path'].startswith('images/')], '검수가 이미지를 지우지 않음'
            sheet_shot('32-studio-review')
            # AI가 제안한 고칠 점 → 그 문장으로 고치기 창 (원본은 그대로)
            sheet.get_by_role('button', name='이걸로 고치기').click()
            expect(sheet).to_contain_text('AI 이미지 고치기')
            expect(sheet.locator('textarea').first).to_have_value('왼쪽 아래 글자 무늬만 지워줘')
            sheet.get_by_role('button', name='닫기').click()
        check('1.5.0 AI 검수: 무료 모델 먼저, 유료는 예상 비용·근거, 결과는 의견·확신·판단 어려움·불확실한 점, 고칠 점은 고치기로, 대신 고르거나 지우지 않음', t_studio_review)

        def t_studio_edit_history():
            close_sheet()
            open_p8()
            page.locator('section.studio .slot').nth(0).get_by_role('button', name='미리보기·내려받기').click()
            sheet.get_by_role('button', name='고치기 (부분 수정)').click()
            expect(sheet).to_contain_text('원본은 그대로 남고, 고친 이미지는 수정 이력으로 이어져')
            expect(sheet.locator('select[name=mode]')).to_have_value('settings')  # 설정의 편집 모델 (gpt-image-2.5-sunburst)
            expect(sheet).to_contain_text('gpt-image-2.5-sunburst')
            sheet.get_by_role('button', name='조명만 더 자연스럽게 바꿔줘').click()
            base_id = next(r for r in mock.slots if r['post_id'] == P8 and r['slot_key'] == parse_slots(next(p for p in mock.posts if p['id'] == P8)['body'])[0]['key'])['image_id']
            n0 = len(gen_bodies())
            sheet.get_by_role('button', name=re.compile(r'예상 \$[\d.]+ · 고치기')).click()
            expect(sheet).to_contain_text('다 만들었어', timeout=20000)
            req = gen_bodies()[n0]
            assert req['mode'] == 'edit' and req['base_image_id'] == base_id and req['model'] == 'gpt-image-2.5-sunburst' and '조명만' in req['text'], req
            new = next(i for i in mock.images if i['kind'] == 'ai')
            assert new['parent_image_id'] == base_id and mock.img(base_id), '원본은 그대로 있고 새 이미지가 원본을 가리킴'
            sheet.get_by_role('button', name=re.compile('이 이미지 쓰기')).click()
            expect(page.locator('#toast')).to_contain_text('연결했어')
            page.locator('section.studio .slot').nth(0).get_by_role('button', name='미리보기·내려받기').click()
            sheet.get_by_text('수정 이력', exact=True).click()
            expect(sheet).to_contain_text('1번째 고침 · 지금 보는 이미지')
            expect(sheet).to_contain_text('원본')
            sheet.get_by_role('button', name='닫기').click()
        check('1.5.0 고치기·수정 이력: 설정의 편집 모델, 예시 문장, 원본은 그대로·새 이미지가 원본을 가리킴, 미리보기에서 원본부터 이력', t_studio_edit_history)

        def t_studio_compare():
            reload_keys(cloudflare=False)  # 비교 기본값이 서로 다른 두 모델(OpenAI·Gemini)이 되게
            open_p8()
            open_ai(0)
            sheet.get_by_role('button', name='여러 모델로 비교하기').click()
            expect(sheet).to_contain_text('한두 번 비교로 어느 모델이 늘 낫다고 단정할 수는 없어')
            checked = [l.inner_text() for l in sheet.locator('label.chk').all() if l.locator('input').is_checked()]
            assert len(checked) == 2 and any('GPT Image 2.5' in t for t in checked) and any('Gemini 3 Pro Image' in t for t in checked), checked
            expect(sheet.locator('.costbox')).to_contain_text('합계 예상 $')
            go = sheet.get_by_role('button', name=re.compile(r'예상 \$[\d.]+ \(2장\) · 비교 만들기'))
            expect(go).to_be_enabled()
            n0 = len(gen_bodies())
            go.click()
            expect(sheet).to_contain_text('내 평가 (AI 평가와 따로 저장)', timeout=40000)
            reqs = gen_bodies()[n0:]
            assert [r['model'] for r in reqs] == ['gpt-image-2.5-flare', 'gemini-3-pro-image'], [r['model'] for r in reqs]
            assert all(r['batch']['kind'] == 'compare' and r['batch']['total'] == 2 and r['batch']['id'] == reqs[0]['batch']['id'] for r in reqs)
            assert reqs[0]['reserve_usd'] > reqs[1]['reserve_usd'], '남은 장의 예상 비용만큼 예약'
            same = lambda k: len({json.dumps(r.get(k), sort_keys=True) for r in reqs}) == 1
            assert same('text') and same('ratio') and same('preset') and same('refs'), '같은 설명·비율·종류·참고 사진'
            first = sheet.locator('.slot.on').first
            expect(first).to_contain_text('gpt-image-2.5-flare')
            first.get_by_role('group', name='글과의 일치도').get_by_role('button', name='좋음').click()
            first.get_by_label(re.compile('이 비교에서 제일 나아')).check()
            first.get_by_role('button', name='내 평가 저장').click()
            expect(page.locator('#toast')).to_contain_text('AI 평가와 따로 남아')
            ev = [c for c in mock.calls if c['path'].endswith('/evaluate')][-1]['body']
            assert ev == {'scores': {'fit': 3}, 'preferred': True, 'batch_id': reqs[0]['batch']['id']}, ev
            expect(first.get_by_role('button', name='AI 평가 (참고용)')).to_be_visible()
            no_overflow('모델 비교')
            sheet_shot('33-studio-compare')
            sheet.get_by_role('button', name='닫기').first.click()
            reload_keys()
        check('1.5.0 모델 비교: 서로 다른 모델 둘을 같은 설명·비율·참고 사진으로, 합계 예상 확인 뒤 한 장씩, 내 평가는 AI 평가와 따로', t_studio_compare)

        def t_studio_settings_150():
            reload_keys()
            goto_hash('settings/images')
            sec = page.locator('#sec-images')
            gem = sec.locator('.item', has_text='Google Gemini')
            expect(gem).to_contain_text('키 연결됨 · 확인 전')
            expect(gem).to_contain_text('연결 확인: 아직 안 함')
            gem.get_by_role('button', name='연결 확인').click()
            expect(page.locator('#toast')).to_contain_text('연결 확인됨 (이미지는 만들지 않았어)')
            expect(sec.locator('.item', has_text='Google Gemini')).to_contain_text('키 연결됨 · 확인됨')
            assert [c for c in mock.calls if c['path'] == 'images/providers/check'][-1]['body'] == {'provider': 'gemini'}
            row = sec.locator('.stack', has=page.locator('b', has_text='Gemini 고품질 생성')).last
            row.locator('label', has_text='모델').locator('select').select_option('gemini-nano-banana-2.1')
            sec.get_by_label('기본 검수 모델').select_option('gemini-3.5-flash-lite')
            sec.locator('label', has_text='한 번 상한').locator('input').fill('0.5')
            sec.get_by_role('button', name='저장', exact=True).click()
            expect(page.locator('#toast')).to_contain_text('저장했어')
            body = [c for c in mock.calls if c['path'] == 'settings'][-1]['body']
            assert body['image_modes']['gemini_hq'] == {'model': 'gemini-nano-banana-2.1', 'quality': 'high'}, body['image_modes']
            assert body['image_modes']['free_draft']['model'] == 'cf-flux-2-klein-4b' and body['image_gen_model'] == 'gpt-image-2.5-flare', '다른 모드·기본 모델은 그대로'
            assert body['image_review_model'] == 'gemini-3.5-flash-lite' and body['image_request_cap_usd'] == 0.5
            assert 'gemini-nano-banana-2.1' in body['image_prices'] and 'gemini-2.5-flash-image' not in body['image_prices'], list(body['image_prices'])
            html = page.content() + json.dumps(page.evaluate('() => Object.values(localStorage)'), ensure_ascii=False)
            assert mock.server_secret not in html and 'AIza' not in html, 'API 키가 화면·저장소에 나옴'
            no_overflow('설정 > 이미지 (1.5.0)')
            shot('34-settings-images-150')
        check('1.5.0 설정 > 이미지: 공급자마다 키·연결 확인(만들지 않고)·실제 생성 기록을 따로, 모드·검수 모델·한 번 상한 저장, 키는 화면에 없음', t_studio_settings_150)

        # 검색 노출 점검 (1.3.0 → 1.3.1): 앱 권장 기준·내 기록·실측 데이터 없음 구분, 주력 주제는 게시한 글만·키워드·제목 근거, 하루 발행량은 고른 값 그대로
        def t_seo_helper():
            goto_hash('home')
            seo = page.locator('section.panel', has=page.locator('h2', has_text='검색 노출 점검'))
            expect(seo).to_contain_text('검색 순위를 보장하지 않아')
            expect(seo).to_contain_text('주력 주제가 아직 없어')
            for tag in ('앱 권장 기준', '내 기록', '실측 데이터 없음'):
                expect(seo.locator('.seo-tag', has_text=tag).first).to_be_visible()
            expect(seo).to_contain_text('내 경험이 없는 글')
            expect(seo).to_contain_text('쇼핑 커넥트')
            expect(seo).to_contain_text('하루 발행 설정 1편 (앱 권장 기준과 같아)')
            writer = page.locator('section.panel', has=page.locator('h2', has_text='자동 작가'))
            expect(writer).to_contain_text(re.compile(r'앞으로 7일\(내일부터\) 발행일이 잡힌 원고 \d+편 / 목표 7편'))
            seo.get_by_role('button', name='정하기').click()
            sec = page.locator('#sec-auto')
            expect(sec).to_be_visible()
            sec.locator('label', has_text='주력 주제 (블로그').locator('input').fill('겨울 가전')
            per = sec.locator('label', has_text='하루 발행 개수').locator('select')
            per.select_option('2')
            expect(sec).to_contain_text('네가 고른 값이라 그대로 둬')
            sec.get_by_role('button', name='저장', exact=True).click()
            expect(page.locator('#toast')).to_contain_text('저장했어')
            body = [c for c in mock.calls if c['path'] == 'settings'][-1]['body']
            assert body['focus_topic'] == '겨울 가전' and body['per_day'] == 2 and body['focus_terms'] == '', body
            goto_hash('home')
            seo = page.locator('section.panel', has=page.locator('h2', has_text='검색 노출 점검'))
            # 게시한 글은 '전기요 두 가지 비교' 1개뿐 — 키워드·제목에 주제 낱말이 없어서 0개 (카테고리 '겨울 가전'만으로는 안 셈), 초안은 안 셈
            expect(seo).to_contain_text('네이버 블로그 최근 게시한 글 1개 중 주력 주제(겨울 가전) 글 0개 (0%)')
            # 게시한 글이 없으면 0%가 아니라 '데이터 없음' (초안은 안 셈)
            p3 = next(p for p in mock.posts if p['id'] == mock.ids['P3'])
            p3['stage'] = 'ready'
            page.get_by_role('button', name='새로고침').click()
            seo = page.locator('section.panel', has=page.locator('h2', has_text='검색 노출 점검'))
            expect(seo).to_contain_text('네이버 블로그: 주력 주제(겨울 가전) 비율 — 데이터 없음 (게시한 글이 아직 없어. 초안은 안 셈)')
            expect(seo).not_to_contain_text('(0%)')
            p3['stage'] = 'published'
            page.get_by_role('button', name='새로고침').click()
            seo = page.locator('section.panel', has=page.locator('h2', has_text='검색 노출 점검'))
            expect(seo).to_contain_text('최근 게시한 글 1개 중')
            expect(seo).to_contain_text('하루 발행 설정 2편 (네가 고른 값 그대로 둬) — 앱 권장은 하루 1편이야')
            expect(page.locator('section.panel', has=page.locator('h2', has_text='자동 작가'))).to_contain_text('목표 14편 (하루 2편 × 7일)')
            # 주력 주제 낱말을 더하면 키워드로 확인됨
            goto_hash('settings/auto')
            sec = page.locator('#sec-auto')
            sec.locator('label', has_text='주력 주제 낱말').locator('input').fill('전기요, 온수매트')
            sec.get_by_role('button', name='저장', exact=True).click()
            expect(page.locator('#toast')).to_contain_text('저장했어')
            assert [c for c in mock.calls if c['path'] == 'settings'][-1]['body']['focus_terms'] == '전기요, 온수매트'
            goto_hash('home')
            seo = page.locator('section.panel', has=page.locator('h2', has_text='검색 노출 점검'))
            expect(seo).to_contain_text('네이버 블로그 최근 게시한 글 1개 중 주력 주제(겨울 가전) 글 1개 (100%)')
            n0 = len([c for c in mock.calls if c['path'] == 'jobs' and c['method'] == 'POST'])
            seo.get_by_role('button', name='이 시즌으로 주제 추천').click()
            expect(page.locator('#toast')).to_contain_text('주제 추천을 요청했어')
            jobs = [c for c in mock.calls if c['path'] == 'jobs' and c['method'] == 'POST']
            assert len(jobs) == n0 + 1, jobs[-1:]
            jb = jobs[-1]['body']
            assert jb['kind'] == 'topics' and jb['mode'] == 'category' and jb['category'] == '겨울 가전' and '월 시즌' in jb['hint'] and len(jb['hint']) <= 300, jb
            # 원고 검사: 주력 주제 판정과 근거가 보임 (키워드 '원룸 전기요 고르는 법' → 낱말 '전기요'로 확인)
            goto_hash('content/post/' + mock.ids['P1'])
            expect(page.locator('#view')).to_contain_text("주력 주제(겨울 가전)와 맞아 — 근거: 키워드에 '전기요'")
            # 주제 → 원고 요청: 주제의 카테고리('겨울 가전')가 주력 주제 이름 그대로면 원고 카테고리로 옮기지 않음 (목록에서 고르기·주제 카드 버튼 두 길 모두)
            t1 = mock.ids['T1']
            goto_hash('content/new')
            view = page.locator('#view')
            view.locator('input[list=catlist]').fill('')
            view.locator('label.f', has_text='주제 목록에서 고르기').locator('select').select_option(t1)
            expect(view.get_by_placeholder('예: 원룸 전기요 고르는 법')).to_have_value('전기요 전기세')
            expect(view.locator('input[list=catlist]')).to_have_value('')
            view.locator('label.f', has_text='주제 목록에서 고르기').locator('select').select_option('')
            goto_hash('content/new/topic/' + t1)
            view = page.locator('#view')
            expect(view.get_by_placeholder('예: 원룸 전기요 고르는 법')).to_have_value('전기요 전기세')
            expect(view.locator('input[list=catlist]')).to_have_value('')
            goto_hash('home')
            no_overflow('홈 검색 노출 점검')
            shot('20-home-seo')
            mock.settings.update({'focus_topic': '', 'focus_terms': '', 'per_day': 1})
        check('검색 노출 점검: 권장 기준·내 기록·실측 없음 구분, 게시한 글 기준 주력 주제 비율·근거, 하루 발행량은 고른 값 그대로, 시즌 주제 추천', t_seo_helper)

        # 1.4.0 운영 시스템: 흐름판(막힌 곳) → 다른 채널 기록 → 유입 검색어 → 개선안 → 채널별 실적 → 쌓인 원고 한도·날짜 다시 잡기 → 최근 7일 정리
        def t_ops_140():
            P3 = mock.ids['P3']
            goto_hash('home')
            ops = page.locator('section.panel.ops')
            expect(ops).to_contain_text('운영 흐름')
            expect(ops.locator('ol.flow li')).to_have_count(7)
            expect(ops).to_contain_text('지금 막힌 곳: 다른 채널로 안 퍼지고 있어')
            expect(ops).to_contain_text("'사용 중'인 수익 모델이 아직 없어")
            ops.get_by_role('button', name='안 퍼뜨린 글 보기').click()
            view = page.locator('#view')
            spread = view.locator('details', has=page.locator('summary', has_text='다른 채널에 올리기'))
            expect(spread.locator('summary')).to_contain_text('(0/4)')
            row = spread.locator('.mrow', has_text='쓰레드')
            row.get_by_role('button', name='올렸어 — 기록').click()
            sheet = page.locator('#sheet')
            sheet.get_by_label('올린 글 주소 (https)').fill('http://www.threads.net/@me/post/abc')
            sheet.get_by_role('button', name='저장', exact=True).click()
            expect(page.locator('#toast')).to_contain_text('https://로 시작해야 해')
            sheet.get_by_label('올린 글 주소 (https)').fill('https://www.threads.net/@me/post/abc')
            sheet.get_by_label('메모 (선택)').fill('오전에 올림')
            sheet.get_by_role('button', name='저장', exact=True).click()
            expect(page.locator('#toast')).to_contain_text('기록했어')
            body = [c for c in mock.calls if c['path'] == f'posts/{P3}/channels'][-1]['body']
            assert body['channel_id'] == 'threads' and body['url'] == 'https://www.threads.net/@me/post/abc' and body['note'] == '오전에 올림', body
            spread = view.locator('details', has=page.locator('summary', has_text='다른 채널에 올리기'))
            expect(spread.locator('summary')).to_contain_text('(1/4)')
            expect(spread.locator('.mrow', has_text='쓰레드')).to_contain_text('올림')
            # 유입 검색어 붙여넣기 → 미리보기 → 저장 → 제목에 없는 검색어 알림
            terms = view.locator('details', has=page.locator('summary', has_text='검색 유입 키워드'))
            ta = terms.get_by_label('유입 검색어 붙여넣기')
            ta.fill('검색어\t유입수\n1\t전기요 두 가지 비교\t30\n2\t전기요 전자파\t12\n원룸 전기요 추천 7회')
            expect(terms).to_contain_text('읽은 검색어 3개')
            terms.get_by_role('button', name='검색어 저장').click()
            expect(page.locator('#toast')).to_contain_text('검색어 3개를 저장했어')
            st = [c for c in mock.calls if c['path'] == f'posts/{P3}/search-terms'][-1]['body']
            assert [(t['term'], t['views']) for t in st['terms']] == [('전기요 두 가지 비교', 30), ('전기요 전자파', 12), ('원룸 전기요 추천', 7)], st
            terms = view.locator('details', has=page.locator('summary', has_text='검색 유입 키워드'))
            expect(terms.locator('summary')).to_contain_text('(3)')
            expect(terms).to_contain_text("제목·키워드에 없는 검색어: '전기요 전자파'(12회), '원룸 전기요 추천'(7회)")
            # 개선안 요청 (검색어 반영) → 기다리는 중 → 자동 작가가 쓴 것처럼 넣고 새로고침 → 보이고 지울 수 있음
            terms.get_by_role('button', name='이 검색어로 개선안 요청').click()
            sheet = page.locator('#sheet')
            expect(sheet.get_by_label('무엇을 고칠까?')).to_have_value('search')
            sheet.get_by_role('button', name='요청하기').click()
            expect(page.locator('#toast')).to_contain_text('개선안을 요청했어')
            jb = [c for c in mock.calls if c['path'] == 'jobs' and c['method'] == 'POST'][-1]['body']
            assert jb['kind'] == 'refresh' and jb['post_id'] == P3 and jb['focus'] == 'search', jb
            refresh = view.locator('details', has=page.locator('summary', has_text='개선안'))
            expect(refresh).to_contain_text('개선안을 기다리는 중이야')
            p3 = next(p for p in mock.posts if p['id'] == P3)
            p3['refresh'] = {'titles': ['전기요 두 가지 비교, 전자파까지 정리'], 'intro': '전자파가 걱정되는 분을 위한 도입부', 'based_on': ["유입 검색어 '전기요 전자파' 12회"], '_updated_at': NOW}
            for j in mock.jobs:
                if j['kind'] == 'refresh' and j['post_id'] == P3:
                    j['status'] = 'done'
            page.get_by_role('button', name='새로고침').click()
            refresh = page.locator('#view details', has=page.locator('summary', has_text='개선안'))
            expect(refresh).to_contain_text('제목 후보')
            expect(refresh).to_contain_text('전기요 두 가지 비교, 전자파까지 정리')
            expect(refresh).to_contain_text("유입 검색어 '전기요 전자파' 12회")
            no_overflow('원고 개선안')
            b = refresh.get_by_role('button', name='개선안 지우기')
            b.click()
            refresh.get_by_role('button', name=re.compile('한 번 더')).click()
            expect(page.locator('#toast')).to_contain_text('지웠어')
            expect(page.locator('#view details', has=page.locator('summary', has_text='개선안')).get_by_role('button', name='개선안 요청')).to_be_visible()
            # 채널별 실적: 쓰레드에서 본 숫자 넣기 → 채널별 합계
            page.locator('#view').get_by_role('button', name='실적 입력').first.click()
            sheet = page.locator('#sheet')
            sheet.get_by_label('채널').select_option('threads')
            sheet.get_by_label('조회수').fill('30')
            sheet.get_by_label('어디서 본 숫자야?').fill('쓰레드 인사이트')
            sheet.get_by_role('button', name='저장', exact=True).click()
            expect(page.locator('#toast')).to_contain_text('저장했어')
            mb = [c for c in mock.calls if c['path'] == 'metrics' and c['method'] == 'POST'][-1]['body']
            assert mb['channel_id'] == 'threads' and mb['views'] == 30, mb
            expect(page.locator('#view')).to_contain_text('채널별 합계')
            shot('21-post-ops')
            # 홈: 다른 채널·실적이 채워지면 막힌 곳은 '고칠 글' (제목에 없는 검색어), 개선 루프에 '고칠 것', 최근 7일 정리
            goto_hash('home')
            ops = page.locator('section.panel.ops')
            expect(ops).to_contain_text('지금 막힌 곳: 고칠 글이 있어')
            loop = page.locator('section.panel', has=page.locator('h2', has_text='개선 루프'))
            expect(loop).to_contain_text('고칠 것')
            expect(loop).to_contain_text('실제로 들어온 검색어가 제목에 없어')
            expect(loop.get_by_role('button', name='개선안 요청').first).to_be_visible()
            week = page.locator('section.panel', has=page.locator('h2', has_text='최근 7일 정리'))
            expect(week.locator('.kpi', has_text='다른 채널에 올림')).to_contain_text('1')
            expect(week.locator('.kpi', has_text='넣은 검색어')).to_contain_text('3')
            # 쌓인 원고 한도: 한도를 3개로 → 자동 작가 멈춤 안내, 막힌 곳은 게시
            mock.settings['backlog_limit'] = 3
            page.get_by_role('button', name='새로고침').click()
            ops = page.locator('section.panel.ops')
            expect(ops).to_contain_text('지금 막힌 곳: 게시가 막혔어')
            expect(ops).to_contain_text('쌓여서(한도 3개) 자동 작가가 새 글을 멈췄어')
            writer = page.locator('section.panel', has=page.locator('h2', has_text='자동 작가'))
            expect(writer).to_contain_text('한도가 차서 자동 작가가 새 자동 글을 멈췄어')
            expect(writer).to_contain_text('쌓인 원고가 한도라서 다음 실행에 새 자동 글은 없어')
            mock.settings['backlog_limit'] = 0
            # 예정일 지난 원고 → 날짜 다시 잡기 (확인 한 번 더) → 내일부터
            p1 = next(p for p in mock.posts if p['id'] == mock.ids['P1']); p2 = next(p for p in mock.posts if p['id'] == mock.ids['P2'])
            keep = (p1['publish_date'], p2['publish_date'])
            p1['publish_date'], p2['publish_date'] = D(-2), D(-1)
            page.get_by_role('button', name='새로고침').click()
            ops = page.locator('section.panel.ops')
            expect(ops).to_contain_text('예정일이 지난 원고 2개')
            ops.get_by_role('button', name='날짜 다시 잡기').click()
            ops.get_by_role('button', name=re.compile('한 번 더')).click()
            expect(page.locator('#toast')).to_contain_text('2개를')
            expect(page.locator('#toast')).to_contain_text('다시 잡았어')
            assert p1['publish_date'] >= D(1) and p2['publish_date'] >= D(1), (p1['publish_date'], p2['publish_date'])
            expect(page.locator('section.panel.ops')).not_to_contain_text('예정일이 지난 원고')
            p1['publish_date'], p2['publish_date'] = keep
            no_overflow('홈 운영 흐름')
            shot('22-home-ops')
            # 설정: 쌓아둘 원고 한도
            goto_hash('settings/auto')
            sec = page.locator('#sec-auto')
            sel = sec.locator('label', has_text='쌓아둘 원고 한도').locator('select')
            sel.select_option('10')
            expect(sec).to_contain_text('검수·게시 안 한 원고가 10개 쌓이면 자동 작가가 새 자동 글을 멈춰')
            sec.get_by_role('button', name='저장', exact=True).click()
            expect(page.locator('#toast')).to_contain_text('저장했어')
            assert [c for c in mock.calls if c['path'] == 'settings'][-1]['body']['backlog_limit'] == 10
            mock.settings['backlog_limit'] = 0
            mock.post_channels.clear(); mock.search_terms.clear()
            mock.metrics = [m for m in mock.metrics if m.get('channel_id') != 'threads']
            page.get_by_role('button', name='새로고침').click()
            expect(page.get_by_role('button', name='새로고침')).to_be_enabled()  # 다음 시험이 새로고침을 누를 수 있게 끝날 때까지 기다림
        check('운영 시스템(1.4.0): 흐름판 막힌 곳 → 다른 채널 기록 → 유입 검색어 → 개선안 → 채널별 실적 → 원고 한도·날짜 다시 잡기 → 최근 7일 정리 → 한도 설정', t_ops_140)

        # 1.4.0 검토에서 고친 것: 기간이 겹치는 검색어·본문 없는 기록의 개선안·못 읽은 표(데이터 없음)·주간 비교(기간 안 실적만)·통계 실패·예약 원고·요청 원고만큼 자동 글 줄이기
        def t_review_140():
            P3 = mock.ids['P3']
            kd = lambda d: f'{int(d[5:7])}월 {int(d[8:10])}일'
            # (1) 한도까지 남은 자리 = 기다리는 요청 원고 수 → 요청 원고를 채우면 한도가 차서 자동 글은 0편 (예전엔 '최대 N편'이라고 했음)
            bl = sum(1 for p in mock.posts if not p['deleted_at'] and p['stage'] in ('review', 'verify', 'ready', 'scheduled'))
            temp_job = None
            if not any(j for j in mock.jobs if j['kind'] == 'write' and j['status'] == 'pending'):
                temp_job = {**deepcopy(mock.jobs[0]), 'id': uid(804), 'status': 'pending', 'post_id': None}
                mock.jobs.append(temp_job)
            wj = sum(1 for j in mock.jobs if j['kind'] == 'write' and j['status'] == 'pending')
            mock.settings['backlog_limit'] = bl + wj
            page.get_by_role('button', name='새로고침').click()
            goto_hash('home')
            writer = page.locator('section.panel', has=page.locator('h2', has_text='자동 작가'))
            expect(writer).to_contain_text(f'검수·게시 안 한 원고 {bl}개 / 쌓아둘 한도 {bl + wj}개')
            expect(writer).to_contain_text('기다리는 요청 원고를 채우면 한도가 차서')
            expect(writer).not_to_contain_text('새로 쓸 예정')
            mock.settings['backlog_limit'] = 0
            if temp_job:
                mock.jobs.remove(temp_job)
            # (2) 기간이 겹치는 유입 검색어: 거절 → 겹치는 기간을 보여줌 → 확인 두 번 → 겹치던 기간을 지우고 저장
            mock.search_terms[:] = [{'id': uid(801), 'post_id': P3, 'term': '전기요 전자파', 'views': 12, 'period_start': D(-7), 'period_end': D(-1),
                                     'channel_id': 'naver_blog', 'source_label': '네이버 블로그 통계', 'created_at': NOW}]
            page.get_by_role('button', name='새로고침').click()
            goto_hash(f'content/post/{P3}')
            view = page.locator('#view')
            terms = view.locator('details', has=page.locator('summary', has_text='검색 유입 키워드'))
            terms.get_by_label('유입 검색어 붙여넣기').fill('전기요 전자파 15')
            terms.get_by_role('button', name='검색어 저장').click()
            expect(terms).to_contain_text('기간이 겹치는 검색어 기록이 있어')
            expect(terms).to_contain_text(kd(D(-7)))
            expect(terms).to_contain_text('같은 유입이 두 번 세져')
            assert [(x['term'], x['views']) for x in mock.search_terms] == [('전기요 전자파', 12)], '거절되면 아무것도 안 바뀜'
            terms.get_by_role('button', name='겹치는 기간 지우고 저장').click()
            terms.get_by_role('button', name=re.compile('한 번 더')).click()
            expect(page.locator('#toast')).to_contain_text('검색어 1개를 저장했어 (겹치던 기간은 지웠어)')
            sent = [c['body'] for c in mock.calls if c['path'] == f'posts/{P3}/search-terms']
            assert 'replace_overlap' not in sent[-2] and sent[-1]['replace_overlap'] is True, sent[-2:]
            assert [(x['term'], x['views'], x['period_start']) for x in mock.search_terms] == [('전기요 전자파', 15, D(-6))], mock.search_terms
            # 비율만 있는 줄: 비율 앞 숫자는 검색어의 일부로 읽음 (숫자를 만들지 않음)
            terms = page.locator('#view details', has=page.locator('summary', has_text='검색 유입 키워드'))
            terms.get_by_label('유입 검색어 붙여넣기').fill('아이폰 16 12.5%')
            expect(terms).to_contain_text('읽은 검색어 1개: 아이폰 16(숫자 없음)')
            terms.get_by_label('유입 검색어 붙여넣기').fill('')
            mock.search_terms.clear()
            # (3) 본문 없이 게시 기록만 넣은 글: 개선안 요청 버튼이 막히고 이유를 보여줌 (서버는 no_body 로 거절하니까)
            P9 = uid(9)
            mock.posts.append({**deepcopy(next(p for p in mock.posts if p['id'] == P3)), 'id': P9, 'keyword': '직접 기록한 전기요 글', 'titles': ['직접 기록한 전기요 글'],
                               'body': '', 'published_on': D(-9), 'publish_date': D(-9), 'refresh': {}})
            mock.search_terms.append({'id': uid(802), 'post_id': P9, 'term': '전기요 전자파 걱정', 'views': 5, 'period_start': D(-6), 'period_end': D(0),
                                      'channel_id': 'naver_blog', 'source_label': '', 'created_at': NOW})
            page.get_by_role('button', name='새로고침').click()
            goto_hash(f'content/post/{P9}')
            view = page.locator('#view')
            terms = view.locator('details', has=page.locator('summary', has_text='검색 유입 키워드'))
            expect(terms).to_contain_text("제목·키워드에 없는 검색어: '전기요 전자파 걱정'(5회)")
            expect(terms).to_contain_text('본문 없이 게시 기록만 넣은 글이라 자동 작가가 개선안을 쓸 수 없어')
            expect(terms.get_by_role('button', name='이 검색어로 개선안 요청')).to_have_count(0)
            expect(view.locator('details', has=page.locator('summary', has_text='개선안'))).to_have_count(0)  # 본문이 없으면 개선안 칸 자체가 없음 (예전부터)
            # 홈 개선 루프의 '제목에 없는 검색어' 추천도 이 글에는 '개선안 요청' 대신 '원고 보기'만
            goto_hash('home')
            rec = page.locator('section.panel', has=page.locator('h2', has_text='개선 루프')).locator('.rec', has_text='직접 기록한 전기요 글').filter(has_text='실제로 들어온 검색어가 제목에 없어')
            expect(rec).to_have_count(1)
            expect(rec.get_by_role('button', name='원고 보기')).to_be_visible()
            expect(rec.get_by_role('button', name='개선안 요청')).to_have_count(0)
            mock.posts = [p for p in mock.posts if p['id'] != P9]
            mock.search_terms.clear()
            # (4) 서버가 다른 채널 기록·실적 글 목록을 못 읽었으면 0이 아니라 데이터 없음, 그걸로 '안 퍼지고 있어'라고 하지 않음
            mock.unavailable = ['post_channels', 'metric_post_ids']
            page.get_by_role('button', name='새로고침').click()
            goto_hash('home')
            ops = page.locator('section.panel.ops')
            expect(ops.locator('li', has_text='다른 채널')).to_contain_text('데이터 없음')
            expect(ops.locator('li', has_text='실적')).to_contain_text('데이터 없음')
            expect(ops).not_to_contain_text('다른 채널로 안 퍼지고 있어')
            expect(ops).not_to_contain_text('실적이 안 들어오고 있어')
            goto_hash(f'content/post/{P3}')
            expect(page.locator('#view details', has=page.locator('summary', has_text='다른 채널에 올리기'))).to_contain_text('다른 채널 기록을 지금 못 읽었어')
            mock.unavailable = []
            # (5) 최근 7일 정리: 7일 안에 다 들어가는 실적만 셈 — 한 달치(3,000회)는 두 주에 똑같이 잡히지 않고, 뺐다고 알려줌
            month = {**deepcopy(mock.metrics[2]), 'id': uid(803), 'period_start': D(-29), 'period_end': D(0), 'views': 3000, 'source_label': '한 달치 통계'}
            mock.metrics.append(month)
            n = len(mock.calls)
            page.get_by_role('button', name='새로고침').click()
            goto_hash('home')
            week = page.locator('section.panel', has=page.locator('h2', has_text='최근 7일 정리'))
            expect(week.locator('.kpi', has_text='조회수')).to_contain_text('1,200')
            expect(week.locator('.kpi', has_text='조회수')).not_to_contain_text('4,200')
            expect(week).to_contain_text('기간이 더 긴 실적(예: 한 달치) 최근 7일에 걸친 1줄, 그 전 7일에 걸친 1줄은 빼서')
            wk = [c for c in mock.calls[n:] if c['path'] == 'stats' and c['query'].get('from', [''])[0] in (D(-6), D(-13))]
            assert {c['query']['from'][0] for c in wk} == {D(-6), D(-13)} and all(c['query'].get('within') == ['1'] for c in wk), [c['query'] for c in wk]
            traffic = page.locator('section.panel', has=page.locator('h2', has_text='최근 30일 조회·클릭'))
            expect(traffic).to_contain_text('4,200', timeout=5000)  # 30일 통계는 지금처럼 기간에 걸친 실적을 다 셈
            mock.metrics = [m for m in mock.metrics if m['id'] != uid(803)]
            # (6) 통계 하나가 실패해도 나머지는 보여주고, 실패한 칸은 '불러오는 중'에 멈추지 않음
            mock.fail_stats_from = {D(-29)}
            page.get_by_role('button', name='새로고침').click()
            goto_hash('home')
            traffic = page.locator('section.panel', has=page.locator('h2', has_text='최근 30일 조회·클릭'))
            expect(traffic).to_contain_text('실적을 못 불러왔어')
            if TODAY.replace(day=1).isoformat() != D(-29):  # 이번 달 1일이 30일 전과 같은 날이면 그 요청도 실패하니 건너뜀
                money = page.locator('section.panel', has=page.locator('h2', has_text='이번 달 수익'))
                expect(money).to_contain_text('발생 수익')
            expect(page.locator('section.panel', has=page.locator('h2', has_text='최근 7일 정리'))).not_to_contain_text('불러오는 중')
            mock.fail_stats_from = set()
            # (7) 예약한 날이 지난 원고: 날짜를 옮기지 않고 '게시 완료 기록'을 권함 (이미 올라갔을 수 있어서)
            p2 = next(p for p in mock.posts if p['id'] == mock.ids['P2'])
            keep = (p2['stage'], p2['publish_date'])
            p2['stage'], p2['publish_date'] = 'scheduled', D(-1)
            page.get_by_role('button', name='새로고침').click()
            goto_hash('home')
            ops = page.locator('section.panel.ops')
            expect(ops).to_contain_text('예약한 날이 지난 원고 1개')
            expect(ops).to_contain_text("'게시 완료 기록'")
            expect(ops.get_by_role('button', name='날짜 다시 잡기')).to_have_count(0)
            p2['stage'], p2['publish_date'] = keep
            no_overflow('홈 (검토 수정)')
            page.get_by_role('button', name='새로고침').click()
            expect(page.get_by_role('button', name='새로고침')).to_be_enabled()
        check('1.4.0 검토 수정: 요청 원고만큼 자동 글 줄이기 · 겹치는 검색어 기간 · 본문 없는 기록의 개선안 · 못 읽은 표는 데이터 없음 · 주간은 기간 안 실적만 · 통계 실패 · 예약 원고', t_review_140)

        # 10) 세션이 끊기면(권한 없음) 로그인 화면으로
        def t_unauthorized():
            close_sheet()  # 앞 시험이 연 창이 남아 있으면 닫고 (창이 새로고침 버튼을 가리지 않게)
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
