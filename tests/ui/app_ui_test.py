# 화면 테스트 (휴대폰 크기 390px)
# 실제 앱 파일(index.html·app.js·lib.js·checks.js)을 이 컴퓨터에서 띄우고, 서버 API만 가짜(메모리)로 바꿔서 눌러봄.
# 진짜 서버·진짜 접속 코드는 쓰지 않음. 실행: python3 tests/ui/app_ui_test.py  (Playwright + Chromium 필요)
import functools
import http.server
import json
import re
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


class Mock:
    """앱이 부르는 서버 API를 흉내 냄. 받은 요청은 self.calls 에 쌓임."""

    def __init__(self):
        cat = json.loads((FIX / 'catalog.json').read_text(encoding='utf-8'))
        self.channels, self.programs, self.compat, self.settings = cat['channels'], cat['programs'], cat['compat'], cat['settings']
        self.calls = []
        self.force_401 = False
        self.seq = 100
        P1, P2, P3, P4, P5 = (uid(i) for i in range(1, 6))
        self.ids = dict(P1=P1, P2=P2, P3=P3, P4=P4, P5=P5, L1=uid(11), L2=uid(12), PR1=uid(21), PR2=uid(22), J1=uid(31), T1=uid(41))
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

    def state(self):
        live = [p for p in self.posts if not p['deleted_at']]
        return {'version': '1.1.1', 'now': NOW, 'today': TODAY.isoformat(), 'auth': 'session', 'posts': live, 'trash': [], 'jobs': self.jobs,
                'settings': self.settings, 'runs': self.runs, 'channels': self.channels, 'programs': self.programs, 'compat': self.compat,
                'topics': self.topics, 'products': self.products, 'post_products': self.post_products, 'links': self.links,
                'imports': self.imports}

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
            return 200, {'stats': self.stats(query.get('from', [None])[0], query.get('to', [None])[0])}
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
                                    'rows_dup': body.get('dup_in_file', 0), 'rows_err': body.get('error_count', 0), 'status': '완료', 'created_at': NOW})
            return 200, {'import_id': iid, 'ok': len(body['rows']), 'dup': body.get('dup_in_file', 0), 'errors': body.get('error_count', 0)}
        return 200, {'ok': True}


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
            path = u.path.split('/blog-app/', 1)[1] if '/blog-app/' in u.path else ''
            try:
                body = json.loads(req.post_data) if req.post_data else {}
            except Exception:  # noqa: BLE001
                body = {}
            status, data = mock.handle(req.method, path, parse_qs(u.query), req.headers, body)
            route.fulfill(status=status, headers={**cors, 'Content-Type': 'application/json; charset=utf-8'}, body=json.dumps(data, ensure_ascii=False))

        ctx.route(API + '/**', api_route)
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
            page.wait_for_function("location.hash.startsWith('#content/post/')")
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
