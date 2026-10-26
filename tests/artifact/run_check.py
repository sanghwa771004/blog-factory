import json, sys, os, re
from playwright.sync_api import sync_playwright
# 사용법: python3 tests/artifact/run_check.py [스크린샷 폴더]
# Claude 런타임(sample·db·mcp·permissions)을 흉내 낸 mock.js 를 넣고 휴대폰 크기 Chromium 에서 전체 흐름을 눌러봐.
# 진짜 Supabase·Claude 는 부르지 않아.
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
page_src = open(os.path.join(ROOT, 'claude-artifact', 'blog-factory.html'), encoding='utf-8').read()
skeleton = ('<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">'
            '<style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]{display:none!important}</style></head><body>'
            + page_src + '</body></html>')
import tempfile
WORK = tempfile.mkdtemp(prefix='gf-artifact-')
open(os.path.join(WORK, 'wrapped.html'), 'w', encoding='utf-8').write(skeleton)
fix = json.load(open(os.path.join(ROOT, 'tests', 'fixtures', 'catalog.json'), encoding='utf-8'))
legacy = json.load(open(os.path.join(ROOT, 'tests', 'fixtures', 'legacy-v4-draft.json'), encoding='utf-8'))
mock = open(os.path.join(HERE, 'mock.js'), encoding='utf-8').read()
init = 'window.__FIX = ' + json.dumps(fix, ensure_ascii=False) + ';\nwindow.__LEGACY = ' + json.dumps(legacy, ensure_ascii=False) + ';\n' + mock
shots = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'screenshots'); os.makedirs(shots, exist_ok=True)
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond), extra)); print(('PASS ' if cond else 'FAIL ') + name + (' — ' + extra if extra else ''))

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, color_scheme='light')
    ctx.add_init_script(init)
    pg = ctx.new_page()
    console_errors = []
    # 이 작업 환경은 외부 글꼴 주소(fonts.googleapis.com)가 막혀 있어서 그 실패는 빼고 봐
    pg.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' and 'ERR_TUNNEL_CONNECTION_FAILED' not in m.text and 'ERR_NAME_NOT_RESOLVED' not in m.text else None)
    pg.on('pageerror', lambda e: console_errors.append('pageerror: ' + str(e)))
    pg.goto('file://' + os.path.join(WORK, 'wrapped.html'))
    pg.wait_for_function("document.querySelector('#connText').textContent.includes('앱 연결됨')", timeout=8000)
    check('catalog loads → 연결됨', True, pg.inner_text('#connText'))
    check('job count badge = 6 (개선안 작업 포함 — 기다리는 요청 전체)', pg.inner_text('#jobCount').strip() == '6', pg.inner_text('#jobCount'))
    chips = pg.eval_on_selector_all('#prPicks label', 'els => els.map(e => e.textContent)')
    check('program chips from catalog', len(chips) == 8 and any('확인 필요' in c for c in chips), str(chips[:3]))
    check('default channel naver_blog checked', pg.is_checked('#ch-naver_blog'))
    check('default program coupang checked', pg.is_checked('#pr-coupang_partners'))
    check('example shown with disclosure', '이 게시물은 쿠팡 파트너스' in pg.inner_text('#out'))
    opts = pg.eval_on_selector_all('#ctype option', 'els => els.map(e => [e.value, e.disabled])')
    check('comparison/news disabled here', dict(opts).get('comparison') is True and dict(opts).get('news_summary') is True and dict(opts).get('experience_review') is True, str(opts))
    pg.screenshot(path=os.path.join(shots, '1-write-light.png'), full_page=True)
    # threads channel blocks adsense
    pg.click('label[for=ch-threads]')
    check('adsense blocked on threads', pg.is_disabled('#pr-google_adsense'))
    check('type fixed to sns_short', pg.input_value('#ctype') == 'sns_short' and pg.is_hidden('#lenWrap'))
    pg.click('label[for=ch-naver_blog]')
    # experience enables experience_review
    pg.click('#moreBox summary'); pg.fill('#exp', '6평 원룸에서 두 달 씀'); 
    check('experience_review enabled after experience', not pg.eval_on_selector('#ctype option[value=experience_review]', 'e => e.disabled'))
    pg.fill('#exp', '')
    # duplicate keyword note
    pg.fill('#kw', '전기요 추천')
    check('recent keyword warning', pg.is_visible('#kwNote'))
    pg.fill('#kw', '원룸 가습기 고르는 법')
    pg.fill('#link', 'https://www.coupang.com/vp/products/123')
    check('plain coupang url warning', '수익이 집계되지 않아' in pg.inner_text('#linkNote'))
    pg.fill('#link', 'https://link.coupang.com/a/xyz')
    pg.click('#gen')
    pg.wait_for_function("document.querySelector('#status').textContent.includes('앱 검수함에 넣었어')", timeout=8000)
    check('write → sent', True, pg.inner_text('#status'))
    q = pg.evaluate('window.__log.queries')
    addq = [x for x in q if 'public.add_post(' in x]
    payload = json.loads(re.search(r'(\$gf[a-z0-9]+\$)([\s\S]*?)\1', addq[-1]).group(2))
    check('add_post payload: source artifact, channel/program/link', payload['source'] == 'artifact' and payload['channel_id'] == 'naver_blog' and payload['program_ids'] == ['coupang_partners'] and payload['link'] == 'https://link.coupang.com/a/xyz' and payload['sources'] == [] and payload['products'] == [], json.dumps({k: payload[k] for k in ['source','channel_id','program_ids','content_type','len']}, ensure_ascii=False))
    check('add_post offset 0 for single write', addq[-1].rstrip().endswith('::jsonb, 0);'))
    check('hashtags cleaned', payload['hashtags'] == ['겨울', '자취템'])
    check('notes mention no web check', '웹 확인 없이' in payload['notes'])
    out_txt = pg.inner_text('#out')
    check('result card says sent + app steps', '앱 검수함에 들어갔어' in out_txt and '검수 필요' in out_txt)
    check('no copy buttons on sent post', pg.query_selector('#out button:has-text("서식 그대로 복사")') is None)
    pg.screenshot(path=os.path.join(shots, '2-written.png'), full_page=True)
    # topics
    pg.click('#t-topics')
    check('performance mode enabled (perf data present)', not pg.is_disabled('#tm2'))
    check('adopted topic listed', '원룸 결로 막는 법' in pg.inner_text('#adopted'))
    pg.fill('#tcat', '겨울 가전'); pg.click('#tBtn')
    pg.wait_for_function("document.querySelectorAll('.topic').length === 3", timeout=8000)
    tl = pg.inner_text('#topicList')
    check('topics rendered with score', '100점 만점' in tl, tl[:80].replace('\n', ' / '))
    pg.check('#topicList .topic:nth-child(1) input'); pg.check('#topicList .topic:nth-child(2) input')
    pg.click('#tSave')
    pg.wait_for_function("document.querySelector('#tBarStatus').textContent.includes('저장했어')", timeout=8000)
    tq = [x for x in pg.evaluate('window.__log.queries') if 'public.add_topics(null' in x]
    items = json.loads(re.search(r'(\$gf[a-z0-9]+\$)([\s\S]*?)\1', tq[-1]).group(2))
    check('add_topics(null) with 2 items, no adsense on threads', len(items) == 2 and all(not ('threads' in i['rec_channels'] and 'google_adsense' in i['rec_programs']) for i in items), json.dumps([[i['title'], i['rec_channels'], i['rec_programs']] for i in items], ensure_ascii=False))
    check('saved chips shown', pg.inner_text('#topicList').count('앱 주제함에 저장됨') == 2)
    pg.check('#adopted input')
    pg.click('#tWrite')
    pg.wait_for_function("document.querySelector('#tBarStatus').textContent.includes('개 썼어')", timeout=15000)
    check('batch writes 3 (2 topics + 1 adopted)', '3개 썼어' in pg.inner_text('#tBarStatus'), pg.inner_text('#tBarStatus'))
    addq = [x for x in pg.evaluate('window.__log.queries') if 'public.add_post(' in x]
    batch = [json.loads(re.search(r'(\$gf[a-z0-9]+\$)([\s\S]*?)\1', x).group(2)) for x in addq[-3:]]
    check('batch uses offset 1 and topic_id', all(x.rstrip().endswith('::jsonb, 1);') for x in addq[-3:]) and sum(1 for b2 in batch if b2.get('topic_id')) == 3, str([b2.get('topic_id', '')[:8] for b2 in batch]))
    pg.screenshot(path=os.path.join(shots, '3-topics.png'), full_page=True)
    # 채택 주제를 고른 사이에 자동 작가가 그 주제로 원고를 만든 경우 → 쓰기 전에 목록을 다시 받아서 빼야 함
    pg.evaluate("window.__addAdopted('겨울 이불 세탁법')")
    pg.click('#connActs button:has-text("새로고침")')
    pg.wait_for_function("document.querySelector('#adopted').textContent.includes('겨울 이불 세탁법')", timeout=8000)
    pg.check('#adopted input')
    n_before = sum('public.add_post(' in x for x in pg.evaluate('window.__log.queries'))
    pg.evaluate('window.__dropAdopted()')
    pg.click('#tWrite')
    pg.wait_for_function("document.querySelector('#tBarStatus').textContent.includes('그사이')", timeout=8000)
    n_after = sum('public.add_post(' in x for x in pg.evaluate('window.__log.queries'))
    check('stale adopted pick dropped before writing (no add_post)', n_after == n_before and '그사이 원고가 생겼거나' in pg.inner_text('#tBarStatus'), pg.inner_text('#tBarStatus'))
    # jobs
    pg.click('#t-jobs')
    jl = pg.inner_text('#jobList')
    check('comparison job left to auto writer', '자동 작가 몫' in jl)
    check('refresh job (1.4.0) shown as left to auto writer, not run here', '개선안' in jl and '개선안은 자동 작가가 써' in jl, jl[-300:])
    check('backlog full note on connection line (1.4.0)', '자동 작가는 새 자동 글을 멈춘 상태' in pg.inner_text('#connText'), pg.inner_text('#connText')[-160:])
    check('run button counts 4 doable', '(4개)' in pg.inner_text('#jRun'), pg.inner_text('#jRun'))
    pg.click('#jRun')
    pg.wait_for_function("document.querySelector('#jStatus').textContent.includes('처리했어')", timeout=15000)
    st = pg.inner_text('#jStatus')
    check('jobs processed: 3 done, 1 failed (needs experience)', '3개 처리했어' in st and '실패 1개' in st, st)
    q = pg.evaluate('window.__log.queries')
    check('job_start ×4, fill_post, add_topics(job), set_variants, job_fail(needs input), log_run', sum('public.job_start(' in x for x in q) == 4 and any('public.fill_post(' in x for x in q) and any(re.search(r"add_topics\('[0-9a-f-]{36}'", x) for x in q) and any('public.set_variants(' in x for x in q) and any('public.job_fail(' in x and 'true);' in x for x in q) and any("public.log_run('artifact'" in x for x in q))
    sv = [x for x in q if 'public.set_variants(' in x][-1]
    v = json.loads(re.search(r'(\$gf[a-z0-9]+\$)([\s\S]*?)\1', sv).group(2))
    check('variants: #광고 line stripped from threads', v['threads'] == '전기요 고를 때 소재부터 봐' and len(v['cards']) == 2, json.dumps(v, ensure_ascii=False))
    lr = [x for x in q if "public.log_run('artifact'" in x][-1]
    check('log_run status 일부 실패 with counts', '일부 실패' in lr and ', 3, 1, 1,' in lr, lr[:160])
    bad = [x for x in q if re.search(r'\b(delete|drop|truncate|alter|insert|update)\b', re.sub(r'(\$gf[a-z0-9]+\$)[\s\S]*?\1', '', x), re.I)]
    check('no raw delete/drop/truncate/alter/insert/update outside functions', not bad, str(bad[:1])[:200])
    pg.screenshot(path=os.path.join(shots, '4-jobs.png'), full_page=True)
    # drafts
    pg.click('#t-drafts')
    dl = pg.inner_text('#draftList')
    check('drafts list shows sent copies incl. legacy', '앱으로 보낸 원고 5개' in dl and '테스트용으로 만든 가짜 글' in dl, dl[:120].replace('\n', ' / '))
    # dark + overflow checks
    widths = pg.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    check('no horizontal overflow (light)', widths[0] <= widths[1], str(widths))
    ctx2 = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, color_scheme='dark')
    ctx2.add_init_script(init.replace("permissions = { async state(){ return 'granted'; }", "permissions = { async state(){ return 'prompt'; }"))
    pg2 = ctx2.new_page()
    pg2.on('pageerror', lambda e: console_errors.append('pageerror2: ' + str(e)))
    pg2.goto('file://' + os.path.join(WORK, 'wrapped.html'))
    pg2.wait_for_function("document.querySelector('#connText').textContent.includes('허용')", timeout=8000)
    check('prompt state → 앱 연결하기 button', pg2.is_visible('#connActs button'))
    check('builtin catalog note before connect', '앱 연결 전이라' in pg2.inner_text('#prNote'))
    pg2.click('#t-drafts')
    pg2.wait_for_timeout(300)
    pg2.click('#draftList .item .main')
    pg2.wait_for_timeout(200)
    check('legacy sent draft opens read-only', '앱 검수함으로 보낸 원고' in pg2.inner_text('#out'))
    pg2.screenshot(path=os.path.join(shots, '5-drafts-dark.png'), full_page=True)
    pg2.click('#connActs button')
    pg2.wait_for_function("document.querySelector('#connText').textContent.includes('앱 연결됨')", timeout=8000)
    check('connect button loads catalog', True)
    widths2 = pg2.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    check('no horizontal overflow (dark)', widths2[0] <= widths2[1], str(widths2))
    errs = pg.evaluate('window.__log.errors') + pg2.evaluate('window.__log.errors')
    check('no page errors', not errs and not console_errors, str(errs + console_errors)[:300])
    # desktop look
    ctx3 = b.new_context(viewport={'width': 1200, 'height': 900}, color_scheme='light')
    ctx3.add_init_script(init)
    pg3 = ctx3.new_page(); pg3.goto('file://' + os.path.join(WORK, 'wrapped.html'))
    pg3.wait_for_function("document.querySelector('#connText').textContent.includes('앱 연결됨')", timeout=8000)
    pg3.screenshot(path=os.path.join(shots, '6-desktop.png'))
    b.close()
fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
