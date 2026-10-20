-- 010: 정책 정보 고침 (2026-10-21 공식 자료 다시 확인한 결과, 1.1.1)
-- 근거는 docs/policy-research-2026-10-21.md 에 주소와 함께 정리.
-- 사용자가 앱에서 이미 고친 칸은 건드리지 않게, 칸마다 "008에서 넣은 값 그대로일 때만" 바꿈. 표·열을 지우거나 새로 만들지 않음.

-- ── 쿠팡 파트너스: 공식 이용가이드(PDF)로 고지 문구를 대조함 ──
update public.programs set
  disclosure_template = case when disclosure_template = $t$이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.$t$
    then $t$이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.$t$ else disclosure_template end,
  disclosure_where = case when disclosure_where = $t$글 제목이나 본문 첫 부분에, 본문과 구분되게 (공정위 추천·보증 심사지침: 블로그는 제목 또는 첫 부분)$t$
    then $t$파트너스 링크가 있는 모든 게시물의 제목 또는 첫 부분에, 추천과 같은 언어로. 제목에 넣으면 잘리지 않게 (쿠팡 파트너스 이용가이드·공정위 지침). 가이드의 문구는 '권장 문구'야.$t$ else disclosure_where end,
  data_source = case when data_source = $t$쿠팡 파트너스 사이트의 실적 현황판(로그인 필요)에서 확인. 파일 내려받기·API 공식 문서는 확인 필요 → 앱에는 직접 입력하거나 파일로 올려줘.$t$
    then $t$파트너스 사이트 리포트: 기간별(일·월), 실적 상세(최대 90일, 상품·링크 형태·채널 ID·하위 ID·주문 건수), 수익 요약·정산·지급. 다음 날 오후 반영, 내려받기 가능 (이용가이드). 리포트 API는 최종 승인 뒤에만 쓸 수 있고 앱에는 연결 안 했어 → 직접 입력하거나 내려받은 파일을 올려줘.$t$ else data_source end,
  commission_note = case when commission_note = $t$수수료율은 앱에 넣지 않았어(공식 확인 필요). 수익금은 월별로 정산해 등록 계좌로 이체(쿠팡 공식 보도자료 2018). 확정·지급 날짜, 최소 지급액, 취소 반영 기준은 확인 필요.$t$
    then $t$수수료율은 상품마다 다르고 바뀔 수 있어서 앱 계산에 넣지 않았어 (가이드: 따로 정하지 않은 상품은 결제금액의 3%). 클릭 후 24시간 안 구매만 집계, 본인 구매나 쿠팡 주소를 그대로 복사한 링크는 집계 안 됨. 발생한 달 다음 달 25일 확정, 다다음 달 15일 지급 (월 1만 원 이상, 모자라면 최대 6개월 이월). 누적 판매 15만 원이 넘으면 최종 승인 심사. 금지: 자동 실행·플로팅·커버형 배너, 무분별한 댓글, 허위·과장 (모두 이용가이드).$t$ else commission_note end,
  unverified = case when unverified = $t$고지 문구는 널리 쓰이는 문구야. 쿠팡 공식 원문은 로그인이 필요해서 대조하지 못했어 → 쿠팡 파트너스 사이트의 안내 문구와 같은지 확인해줘. 쓰레드 허용 여부, 단축 URL·리디렉션 허용 여부, 현행 약관 조문도 확인 필요. 쿠팡은 2025년부터 강제 이동(납치광고) 같은 부정 행위에 수익 몰수·계정 해지를 하고 있어(공식 보도자료 2025-10-01).$t$
    then $t$단축 URL·리디렉션 허용 여부(가이드에 언급 없음, 약관 원문은 못 열어봄), 리포트 파일 형식·열 이름, 인스타·쓰레드별 표시 위치, 활동 금지 사이트 목록은 확인 필요 — 파트너스 사이트는 조사 도구로 열리지 않았어. 2025-10 쿠팡이 강제 이동(납치) 광고를 한 파트너들을 형사 고소했다는 보도가 있어.$t$ else unverified end,
  policy_url = case when policy_url = $t$https://news.coupang.com/archives/397/$t$
    then $t$https://partners.coupangcdn.com/partners-guide/partners-guide-20260611145240.pdf$t$ else policy_url end,
  policy_checked_at = '2026-10-21'
where id = 'coupang_partners';

-- ── 토스쇼핑 쉐어링크 ──
update public.programs set
  disclosure_where = case when disclosure_where = $t$모든 게시물 필수. 블로그: 제목, 도입부 또는 상품 소개 바로 앞. 인스타·숏폼: 첫 화면에 보이는 앞부분(더보기 뒤는 안 됨). #ad·#sp·'제휴 링크'만 쓰는 건 안 됨 (토스 공식 고지 가이드)$t$
    then $t$모든 게시물 필수. 블로그: 제목, 도입부 또는 상품 소개 바로 앞. 인스타·숏폼: 첫 화면에 보이는 앞부분(더보기 뒤는 안 됨). #ad·#sp·'제휴 링크'만 쓰는 건 안 됨. 짧은 공식 문구: [광고] 토스쇼핑 쉐어링크 활동으로, 링크 구매 시 수수료를 지급받습니다. (토스 공식 고지 가이드)$t$ else disclosure_where end,
  commission_note = case when commission_note = $t$수수료율은 앱에 넣지 않았어. 링크 클릭 후 24시간 안 결제·마지막 클릭 기준, 본인·지인 교차 구매는 인정 안 됨. 구매확정(배송완료 7일 뒤)된 달의 다음 달 25일에 지급(잔액 10원 이상), 비사업자는 3.3% 원천징수. 2026-11-03부터 앱인토스 미니앱 주문은 정산 제외 (모두 토스 공식 문서).$t$
    then $t$수수료율은 공지로 자주 바뀌어서 앱 계산에 넣지 않았어 (2026-10-21 확인한 공지: 2026-10-01 이후 구매확정 주문부터 8%). 클릭 후 24시간 안 결제·마지막 클릭 기준, 본인·가족·지인 교차 구매와 구매확정 전 취소·환불은 제외. 구매확정(배송완료 7일 뒤)된 달의 다음 달 25일 지급(잔액 10원 이상), 비사업자 3.3% 원천징수. 2026-11-02(월) 자정 이후 구매확정되는 앱인토스 미니앱 안 주문은 정산 제외 (모두 토스 공식 문서).$t$ else commission_note end,
  unverified = case when unverified = $t$쓰레드라는 이름은 문서에 없어(SNS 공유는 채널 등록하면 가능한 것으로 읽힘). 파일 내려받기 여부, 단축 URL·리디렉션 허용 여부(링크 임의 수정 금지 조항만 있음)는 확인 필요. 만 19세 이상만 가입 가능.$t$
    then $t$쓰레드라는 이름은 문서에 없어(SNS는 채널을 등록하면 가능한 것으로 읽힘). 네이버 블로그만 따로 다룬 규정, 실적 파일 내려받기, 링크별 통계, 단축 URL·리디렉션 허용 여부(링크 임의 수정 금지 조항만 있음)는 확인 필요. 만 19세 이상, 외국인은 가입 불가 (토스 공식).$t$ else unverified end,
  policy_checked_at = '2026-10-21'
where id = 'toss_sharelink';

-- ── Google 애드센스: 티스토리 금지 광고는 앵커·오퍼월 두 가지만 공지돼 있음 (전면 광고는 공지에 없음) ──
update public.programs set
  commission_note = case when commission_note = $t$만 19세 이상, 사이트 HTML 소스에 접근할 수 있어야 신청 가능 (Google 공식). 티스토리는 앵커·오퍼월·모바일 전면광고 금지 (티스토리 공지).$t$
    then $t$만 19세 이상(한국어 도움말), 사이트 HTML 소스에 접근할 수 있어야 신청 가능, 사이트 승인 뒤에 광고가 나와 (보통 며칠, 길면 2~4주). 사람이 검토하지 않은 자동 생성 글이나 베낀 글에는 광고를 못 붙여 (Google 게시자 정책). 티스토리는 2025-06-01부터 앵커·오퍼월 광고 금지 (티스토리 공지).$t$ else commission_note end,
  policy_checked_at = '2026-10-21'
where id = 'google_adsense';

-- ── 네이버 애드포스트: 2026-08-07 네이버 공식 발표로 근거를 바꿈 ──
update public.programs set
  commission_note = case when commission_note = $t$네이버 블로그에 노출되는 광고 수익의 일부를 나눠 받는 구조 (2026-08 네이버 발표 보도).$t$
    then $t$블로그 콘텐츠에 노출되는 광고 수익의 일부를 창작자와 나누는 구조 (네이버 공식 2026-08-07). 2026-06부터 '네이버 메이트'(선정형 베타, 블로그·카페 등 창작자 지원)도 따로 있어.$t$ else commission_note end,
  policy_url = case when policy_url = $t$https://navercorp.com/media/pressReleasesDetail?seq=27910$t$
    then $t$https://navercorp.com/media/pressReleasesDetail?seq=10034578$t$ else policy_url end,
  policy_checked_at = '2026-10-21'
where id = 'naver_adpost';

-- ── 네이버 쇼핑 커넥트 ──
update public.programs set
  data_source = case when data_source = $t$쇼핑 커넥트 크리에이터 대시보드에서 정산·성과 확인 (네이버 공식 보도자료). 파일 내려받기 여부는 확인 필요.$t$
    then $t$크리에이터 전용 대시보드에서 정산·성과(클릭수·판매 전환율 등) 확인 (네이버 공식 보도자료 2025). 파일 내려받기 여부는 확인 필요.$t$ else data_source end,
  commission_note = case when commission_note = $t$상품별 수익 쉐어 비율은 대시보드에서 확인 (앱에 넣지 않음). 정산 일정은 확인 필요.$t$
    then $t$수익 쉐어 비율은 판매자가 상품마다 정해 → 대시보드에서 확인 (앱에 넣지 않음). 정산 일정은 확인 필요.$t$ else commission_note end,
  policy_checked_at = '2026-10-21'
where id = 'naver_shopping_connect';

-- ── 채널 메모 ──
update public.channels set
  notes = case when notes = $t$Open API가 끝나서 복사해서 붙여넣기로 올려. 애드센스 등 외부 광고 연동은 가능, 앵커·오퍼월·모바일 전면광고는 금지 (티스토리 공지 2025~2026).$t$
    then $t$Open API가 끝나서 복사해서 붙여넣기로 올려. 애드센스 등 외부 광고 연동은 가능(2026-05-28 공지). 앵커·오퍼월 광고는 2025-06-01부터 금지이고 어기면 블로그 접근이 제한돼 (티스토리 공지). 카카오 애드핏 신규 연동은 2026-06-29에 끝났어.$t$ else notes end
where id = 'tistory';
update public.channels set
  notes = case when notes = $t$글은 500자까지, 링크는 5개까지 (Meta 공식 API 문서). 긴 글은 텍스트 첨부로 1만 자까지. 공정위 지침에 쓰레드 기준은 따로 없어서 글 위주면 문자 매체 기준(첫 부분 표시)을 따르는 게 안전해.$t$
    then $t$글은 500자까지, 링크는 5개까지 (Meta 공식 API 문서). 긴 글은 텍스트 첨부로 1만 자까지. 공정위 지침에 쓰레드 기준은 따로 없어서 문자 매체 기준(첫 부분 표시)을 따르는 게 안전해. Meta 정책상 브랜디드 콘텐츠는 '유료 파트너십' 도구를 써야 하는데, 제휴 수수료 글도 해당하는지는 확인 필요.$t$ else notes end
where id = 'threads';
update public.channels set
  notes = case when notes = $t$캡션 2,200자·해시태그 30개 (Meta 공식 API 문서). 캡션 링크는 일반 계정에서 눌리지 않는다고 보도됨(공식 도움말은 확인 필요) → 프로필 링크나 스토리 링크 스티커로 안내. 광고 표시는 사진 안이나 글 첫 부분, 해시태그면 첫 번째 (공정위 지침).$t$
    then $t$캡션 2,200자·해시태그 30개 (Meta 공식 API 문서). 캡션 링크는 기본적으로 안 눌림(보도) → 프로필 링크나 스토리 링크 스티커로 안내. 광고 표시는 사진 안이나 글 첫 부분, 해시태그면 첫 번째 (공정위 지침). Meta 정책상 브랜디드 콘텐츠는 '유료 파트너십' 표시가 필요한데, 제휴 수수료 글도 해당하는지는 확인 필요.$t$ else notes end
where id = 'instagram';
update public.channels set
  notes = case when notes = $t$글쓰기 API가 없어서 복사해서 붙여넣기로 올려. 블로그 운영정책 원문은 조사 환경에서 막혀서 확인 필요. 대가성 표시가 흐리면 검색 노출이 제한될 수 있어(2020 보도).$t$
    then $t$글쓰기 API가 없어서 복사해서 붙여넣기로 올려. 블로그 운영정책 원문은 조사 도구로 열리지 않아서 확인 필요. 대가성 표시가 흐리면 검색 노출이 제한될 수 있어(2020 보도). 네이버 공식 수익 프로그램: 애드포스트, 브랜드 커넥트(쇼핑 커넥트·공동구매), 네이버 메이트(선정형 베타).$t$ else notes end
where id = 'naver_blog';
update public.channels set
  notes = case when notes = $t$자체 사이트. 제휴 링크에는 rel="sponsored"를 붙이라는 게 구글 권장이고, 앱 복사본에 이미 들어가 있어. 판매자 설명만 옮긴 빈약한 제휴 글은 구글 스팸 정책 위반이야.$t$
    then $t$자체 사이트. 제휴 링크에는 rel="sponsored"를 붙이라는 게 구글 권장이고, 앱 복사본에 이미 들어가 있어. 판매자 설명만 옮긴 빈약한 제휴 글, 가치 없이 AI로 대량 생성한 글은 구글 스팸 정책 위반이고, 올리기 전에 사람이 사실 확인하라는 게 구글 안내야.$t$ else notes end
where id = 'website';

-- ── 수익 모델 × 채널 판정 (확인 필요 → 가능은 공식 근거가 생긴 것만) ──
update public.program_channels set verdict = '가능',
  reason = $t$쿠팡 파트너스 이용가이드에 블로그 허용. 티스토리 공지에 제휴 링크 금지 조항 없음$t$,
  source_url = $t$https://partners.coupangcdn.com/partners-guide/partners-guide-20260611145240.pdf$t$, checked_at = '2026-10-21'
where program_id = 'coupang_partners' and channel_id = 'tistory' and verdict = '확인 필요'
  and reason = $t$쿠팡은 블로그 허용. 티스토리 공지에 금지 조항은 없지만 제휴 링크 규정은 못 찾음 (유력: 가능)$t$;
update public.program_channels set verdict = '가능',
  reason = $t$쿠팡 파트너스 이용가이드에 SNS 허용 (글마다 고지 필요). 메타 '유료 파트너십' 표시가 필요한지는 확인 필요$t$,
  source_url = $t$https://partners.coupangcdn.com/partners-guide/partners-guide-20260611145240.pdf$t$, checked_at = '2026-10-21'
where program_id = 'coupang_partners' and channel_id = 'threads' and verdict = '확인 필요'
  and reason = $t$"모든 채널" 발표는 쓰레드 출시 전 자료 (유력: 가능)$t$;
update public.program_channels set
  reason = $t$쿠팡 파트너스 이용가이드에 SNS 허용 (글마다 고지 필요). 캡션 링크는 안 눌려서 프로필·스토리 링크로$t$,
  source_url = $t$https://partners.coupangcdn.com/partners-guide/partners-guide-20260611145240.pdf$t$, checked_at = '2026-10-21'
where program_id = 'coupang_partners' and channel_id = 'instagram'
  and reason = $t$쿠팡 공식(2018) 채널 예시에 인스타그램. 캡션 링크는 안 눌려서 스토리·프로필 링크로$t$;
update public.program_channels set
  reason = $t$쿠팡 파트너스 이용가이드에 블로그 허용. 네이버 블로그 쪽 제휴 링크 규정은 조사 도구로 못 열어봤어 — 네이버 블로그 운영정책을 직접 확인해줘$t$,
  source_url = $t$https://partners.coupangcdn.com/partners-guide/partners-guide-20260611145240.pdf$t$, checked_at = '2026-10-21'
where program_id = 'coupang_partners' and channel_id = 'naver_blog'
  and reason = $t$쿠팡 공식(2018)은 블로그 허용. 네이버 블로그 운영정책 원문은 못 열어봄 (유력: 가능)$t$;
update public.program_channels set
  reason = $t$쿠팡 파트너스 이용가이드: 링크가 있는 모든 페이지를 채널로 등록해야 함$t$,
  source_url = $t$https://partners.coupangcdn.com/partners-guide/partners-guide-20260611145240.pdf$t$, checked_at = '2026-10-21'
where program_id = 'coupang_partners' and channel_id = 'website'
  and reason = $t$쿠팡 공식(2018) "기업 홈페이지…모든 채널 등록". 현행 약관 원문은 못 열어봄$t$;
update public.program_channels set verdict = '가능',
  reason = $t$토스 공식: 블로그 허용(채널 등록 필수). 티스토리 공지에 제휴 링크 금지 조항 없음$t$,
  source_url = $t$https://sharelink-docs.toss.im/start/channels.md$t$, checked_at = '2026-10-21'
where program_id = 'toss_sharelink' and channel_id = 'tistory' and verdict = '확인 필요'
  and reason = $t$토스는 블로그 허용. 티스토리 제휴 링크 규정은 못 찾음 (유력: 가능)$t$;
update public.program_channels set
  reason = $t$네이버 공식(2026-08-07): 블로그 콘텐츠에 노출되는 광고 수익을 나누는 구조라 쓰레드 글에는 광고가 붙지 않음$t$,
  source_url = $t$https://navercorp.com/media/pressReleasesDetail?seq=10034578$t$, checked_at = '2026-10-21'
where program_id = 'naver_adpost' and channel_id = 'threads'
  and reason = $t$네이버 블로그에 붙는 광고의 수익을 나누는 구조라 쓰레드 글에는 광고가 붙지 않음$t$;
update public.program_channels set
  reason = $t$네이버 공식(2026-08-07): 블로그 콘텐츠에 노출되는 광고 수익을 나누는 구조라 인스타 글에는 광고가 붙지 않음$t$,
  source_url = $t$https://navercorp.com/media/pressReleasesDetail?seq=10034578$t$, checked_at = '2026-10-21'
where program_id = 'naver_adpost' and channel_id = 'instagram'
  and reason = $t$네이버 블로그에 붙는 광고의 수익을 나누는 구조라 인스타 글에는 광고가 붙지 않음$t$;
update public.program_channels set
  reason = $t$구글 공식 티스토리 가입 도움말 + 티스토리 공지(2026-05-28)로 연동 유지. 앵커·오퍼월 광고는 2025-06-01부터 금지$t$,
  checked_at = '2026-10-21'
where program_id = 'google_adsense' and channel_id = 'tistory'
  and reason = $t$구글 공식 티스토리 가입 도움말 + 티스토리 공지(2026-05-28)로 연동 유지. 앵커·오퍼월·모바일 전면광고는 금지$t$;
