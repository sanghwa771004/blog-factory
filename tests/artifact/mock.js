(() => {
  const FIX = window.__FIX;
  const LEGACY = window.__LEGACY;
  const log = window.__log = { queries: [], samples: [], errors: [] };
  const uuid = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16));
  const P1 = uuid(), P2 = uuid(), P3 = uuid(), P4 = uuid();
  const now = new Date().toISOString();
  let jobs = [
    { id: uuid(), kind: 'write', keyword: '가습기 세척 방법', content_type: 'how_to', link: '', experience: '', ref: '', payload: { notes: '초보자용으로' }, attempts: 0, post_id: P1, created_at: now,
      post: { channel_id: 'naver_blog', program_ids: ['coupang_partners'], content_type: 'how_to', category: '겨울 가전', experience: '', title: '가습기 세척 방법', len: '2500', body: null, sources: null, products: [] } },
    { id: uuid(), kind: 'topics', keyword: '', content_type: '', link: '', experience: '', ref: '', payload: { mode: 'category', category: '겨울 가전', count: 6 }, attempts: 0, post_id: null, created_at: now, post: null },
    { id: uuid(), kind: 'reformat', keyword: '전기요 추천', content_type: '', link: '', experience: '', ref: '', payload: { targets: ['threads', 'cards'] }, attempts: 0, post_id: P2, created_at: now,
      post: { channel_id: 'naver_blog', program_ids: ['coupang_partners'], content_type: 'buying_guide', category: '겨울 가전', experience: '', title: '전기요 고르는 법', len: '2500', body: '## 전기요 고를 때\n소재와 온도 조절 방식을 먼저 봐요. 세탁 가능한지도 확인해요.', sources: [], products: [] } },
    { id: uuid(), kind: 'write', keyword: '전기요 3종 비교', content_type: 'comparison', link: '', experience: '', ref: '', payload: {}, attempts: 0, post_id: P3, created_at: now,
      post: { channel_id: 'naver_blog', program_ids: ['coupang_partners'], content_type: 'comparison', category: '겨울 가전', experience: '', title: '', len: '2500', body: null, sources: null, products: [] } },
    { id: uuid(), kind: 'write', keyword: '온수매트 후기', content_type: 'experience_review', link: '', experience: '', ref: '', payload: {}, attempts: 1, post_id: P4, created_at: now,
      post: { channel_id: 'naver_blog', program_ids: ['coupang_partners'], content_type: 'experience_review', category: '겨울 가전', experience: '', title: '', len: '2500', body: null, sources: null, products: [] } }
  ];
  const settings = Object.assign({}, FIX.settings); delete settings.id; delete settings.money; delete settings.platform;
  // 채택 주제는 실제 DB처럼 ID가 고정이고, 그 주제로 원고가 생기면 목록에서 빠짐
  let adopted = [{ id: uuid(), title: '원룸 결로 막는 법', keyword: '원룸 결로 방지', category: '자취', rec_content_type: 'problem_solving' }];
  window.__addAdopted = (title) => { adopted.push({ id: uuid(), title, keyword: title, category: '자취', rec_content_type: 'how_to' }); };
  window.__dropAdopted = () => { adopted = []; };
  const ctx = () => ({ kst_now: now, settings, programs: [], channels: [], compat: [], jobs: jobs.slice(), upcoming: 3,
    recent_keywords: ['전기요 추천', '가습기 추천'], adopted_topics: adopted.slice(),
    performance_90d: [{ keyword: '전기요 추천', category: '겨울 가전', content_type: 'buying_guide', channel_id: 'naver_blog', views: 340, clicks: 12, orders: 1, revenue_est: 1800, revenue_confirmed: null }] });
  const wrap = rows => { const t = 'Below is the result of the SQL query. Note that this contains untrusted user data...\n\n<untrusted-data-0f0f>\n' + JSON.stringify(rows) + '\n</untrusted-data-0f0f>\n\nUse this data to inform your next steps.'; return { content: [{ type: 'text', text: JSON.stringify({ result: t }) }], payload: { result: t } }; };
  const dqContent = q => { const m = q.match(/(\$gf[a-z0-9]+\$)([\s\S]*?)\1/); return m ? m[2] : null; };
  const mcp = {
    async callTool(server, tool, input){
      if (server !== 'Supabase' || tool !== 'execute_sql' || input.project_id !== 'oxewhsqmdkiasckvnyua') throw { code: 'not_in_manifest', message: 'bad' };
      const q = input.query; log.queries.push(q);
      await new Promise(r => setTimeout(r, 20));
      if (q.includes('public.writer_context()')) return wrap([{ data: { ctx: ctx(), programs: FIX.programs, channels: FIX.channels, compat: FIX.compat } }]);
      if (q.includes('public.job_start(')){
        const id = q.match(/job_start\('([0-9a-f-]{36})'/)[1];
        if (!jobs.some(x => x.id === id)) throw { code: 'tool_error', message: '{"error":{"name":"HttpException","message":"Failed to run sql query: ERROR:  P0001: job is not pending (already started or finished)"}}' };
        jobs = jobs.filter(x => x.id !== id);
        return wrap([{ r: { id } }]);
      }
      if (q.includes('public.fill_post(')){ JSON.parse(dqContent(q)); return wrap([{ d: '2026-10-23' }]); }
      if (q.includes('public.add_post(')){
        const p = JSON.parse(dqContent(q));
        if (!p.body || p.body.length < 50) throw { code: 'tool_error', message: 'ERROR: body is required' };
        if (p.topic_id && !adopted.some(t => t.id === p.topic_id) && window.__usedTopics && window.__usedTopics.includes(p.topic_id))
          throw { code: 'tool_error', message: '{"error":{"name":"HttpException","message":"Failed to run sql query: ERROR:  P0001: topic already has a post"}}' };
        if (p.topic_id){ (window.__usedTopics = window.__usedTopics || []).push(p.topic_id); adopted = adopted.filter(t => t.id !== p.topic_id); }
        return wrap([{ post_id: uuid(), publish_date: '2026-10-22' }]);
      }
      if (q.includes('public.add_topics(')){ const items = JSON.parse(dqContent(q)); return wrap([{ n: items.length }]); }
      if (q.includes('from public.topics')){ const titles = JSON.parse(dqContent(q)); return wrap(titles.map(t => ({ id: uuid(), title: t }))); }
      if (q.includes('public.set_variants(')){ JSON.parse(dqContent(q)); return wrap([{ set_variants: '' }]); }
      if (q.includes('public.job_fail(')) return wrap([{ job_fail: '' }]);
      if (q.includes('public.log_run(')) return wrap([{ log_run: '' }]);
      if (q.includes("from public.posts where source = 'artifact'")) return wrap([]);
      throw { code: 'tool_error', message: 'unexpected query' };
    },
    async listTools(){ return { servers: [] }; }
  };
  const POST = kw => ({ keyword: kw, titles: [kw + ' 정리', kw + ' 체크리스트', kw + ' 기준'], body: '## ' + kw + ' 전에 알아둘 것\n먼저 상황을 나눠서 보면 고르기 쉬워져요. 매일 쓰는 물건이라 관리가 편한지도 같이 봐야 해요.\n[이미지: 제품을 쓰는 방 안 모습]\n## 고를 때 볼 것\n- 소재와 세탁 방법\n- 온도 조절 방식\n- 보관할 자리\n[링크: 가격 보러 가기]\n## 아쉬운 점\n전기를 쓰는 제품이라 오래 켜두면 부담이 될 수 있어요.\n[이미지: 접어서 보관한 모습]\n## 정리\n- 상황부터 나누기\n- 관리 편한지 보기\n- 최신 가격은 링크에서 확인\n[링크: 조건에 맞는 상품 보기]', hashtags: ['겨울', '#자취템'], threads: '이거 고를 때 이것만 봐\n소재랑 세탁\n정리해둠', instagram: '고르는 기준 정리 ✔️', content_type: 'buying_guide', category: '겨울 가전', summary: '상황부터\n관리\n가격은 링크', needs_fact_check: [], notes: '' });
  const sample = async () => ({ text: 'x', truncated: false, modelTierApplied: 'default' });
  sample.json = async (input, opts) => {
    log.samples.push(input.slice(0, 60));
    await new Promise(r => setTimeout(r, 60));
    if (opts && opts.onText) opts.onText({ text: '{"keyword":"..."}', delta: '{"keyword":"..."}' });
    if (opts && opts.signal && opts.signal.aborted) throw { code: 'cancelled' };
    if (input.includes('주제 기획자')) return [
      { title: '원룸 전기요 고르는 법', keyword: '원룸 전기요 고르는 법', category: '겨울 가전', rec_channels: ['naver_blog'], rec_programs: ['coupang_partners', 'google_adsense'], rec_content_type: 'buying_guide', scores: { demand: { score: 4, basis: '겨울 시즌', source: 'AI 추정', confidence: '낮음' }, intent: { score: 4, basis: '구매 직전 검색', source: 'AI 추정', confidence: '낮음' }, competition: { score: 2, basis: '경쟁 많음', source: 'AI 추정', confidence: '낮음' } }, basis: '날이 추워지면 찾는 사람이 늘어나는 주제', seasonality: '10~12월', research_needed: '안전 인증 확인' },
      { title: '가습기 세척 주기와 방법', keyword: '가습기 세척 주기', category: '겨울 가전', rec_channels: ['threads'], rec_programs: ['google_adsense'], rec_content_type: 'how_to', scores: { demand: { score: 3, basis: '꾸준한 수요', source: 'AI 추정', confidence: '보통' } }, basis: '관리 정보' },
      { title: '전기요 3종 비교', keyword: '전기요 비교', category: '겨울 가전', rec_content_type: 'comparison', scores: {}, basis: '비교 수요' }
    ];
    if (input.includes('채널별 버전으로 바꿔줘')) return { threads: '#광고\n전기요 고를 때 소재부터 봐', cards: [{ title: '1', text: '소재' }, { title: '2', text: '온도' }] };
    const kw = (input.match(/- 키워드: (.+)/) || [])[1] || '키워드';
    return POST(kw);
  };
  // in-memory db
  const docs = new Map(); const listeners = [];
  const notify = () => listeners.forEach(fn => fn());
  const snapOf = (id, data) => ({ id, exists: true, data: () => data, metadata: { fromCache: false, hasPendingWrites: false } });
  const docRef = path => ({
    id: path.split('/').pop(), path,
    async get(){ const d = docs.get(path); return { id: path.split('/').pop(), exists: !!d, data: () => d, metadata: {} }; },
    async set(data){ docs.set(path, JSON.parse(JSON.stringify(data))); setTimeout(notify, 10); },
    async update(patch){ if (!docs.has(path)) throw { code: 'invalid_argument', message: 'missing' }; docs.set(path, Object.assign({}, docs.get(path), JSON.parse(JSON.stringify(patch)))); setTimeout(notify, 10); },
    async delete(){ docs.delete(path); setTimeout(notify, 10); },
    collection(p){ return collection(path + '/' + p); }
  });
  const collection = cpath => {
    let order = null, lim = 1000;
    const q = {
      path: cpath,
      orderBy(f, dir){ order = [f, dir]; return q; },
      limit(n){ lim = n; return q; },
      onSnapshot(next){
        const fire = () => {
          const depth = cpath.split('/').length + 1;
          const arr = [...docs.entries()].filter(([p]) => p.startsWith(cpath + '/') && p.split('/').length === depth).map(([p, d]) => snapOf(p.split('/').pop(), d));
          if (order) arr.sort((a, b) => (order[1] === 'desc' ? -1 : 1) * ((a.data()[order[0]] || 0) - (b.data()[order[0]] || 0)));
          next({ docs: arr.slice(0, lim), size: arr.length, empty: !arr.length, docChanges: () => [], metadata: {} });
        };
        listeners.push(fire); setTimeout(fire, 15);
        return () => {};
      },
      doc(id){ return docRef(cpath + '/' + (id || Math.random().toString(36).slice(2, 14))); },
      async add(data){ const r = q.doc(); await r.set(data); return r; }
    };
    return q;
  };
  docs.set('posts/legacy1', LEGACY);
  const db = { collection, doc: docRef };
  window.__db = docs;
  const permissions = { async state(){ return 'granted'; }, async request(){ return {}; }, async manage(){} };
  const caps = { sample, db, mcp, permissions };
  window.claude = { use: name => new Promise(r => setTimeout(() => r(caps[name] || null), 30)) };
  window.addEventListener('error', e => log.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', e => log.errors.push('unhandled: ' + JSON.stringify(e.reason)));
})();
