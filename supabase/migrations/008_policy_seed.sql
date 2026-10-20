-- 008: 수익 모델·채널 정책 정보 넣기 (2026-10-21 조사, 출처는 docs/policy-research-2026-10-21.md)
-- 원칙: 공식 출처로 확인한 것만 '필요/불필요/가능/불가'로, 나머지는 '확인 필요'로 남김.
-- 수수료율은 넣지 않음. 표(program_channels)는 이미 있는 판정을 덮어쓰지 않음(on conflict do nothing).

-- ── 수익 모델 ──
update public.programs set
  needs_signup = '필요',
  needs_disclosure = '필요',
  disclosure_template = '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.',
  disclosure_where = '글 제목이나 본문 첫 부분에, 본문과 구분되게 (공정위 추천·보증 심사지침: 블로그는 제목 또는 첫 부분)',
  data_source = '쿠팡 파트너스 사이트의 실적 현황판(로그인 필요)에서 확인. 파일 내려받기·API 공식 문서는 확인 필요 → 앱에는 직접 입력하거나 파일로 올려줘.',
  commission_note = '수수료율은 앱에 넣지 않았어(공식 확인 필요). 수익금은 월별로 정산해 등록 계좌로 이체(쿠팡 공식 보도자료 2018). 확정·지급 날짜, 최소 지급액, 취소 반영 기준은 확인 필요.',
  unverified = '고지 문구는 널리 쓰이는 문구야. 쿠팡 공식 원문은 로그인이 필요해서 대조하지 못했어 → 쿠팡 파트너스 사이트의 안내 문구와 같은지 확인해줘. 쓰레드 허용 여부, 단축 URL·리디렉션 허용 여부, 현행 약관 조문도 확인 필요. 쿠팡은 2025년부터 강제 이동(납치광고) 같은 부정 행위에 수익 몰수·계정 해지를 하고 있어(공식 보도자료 2025-10-01).',
  policy_url = 'https://news.coupang.com/archives/397/',
  policy_checked_at = '2026-10-21'
where id = 'coupang_partners';

update public.programs set
  needs_signup = '필요',
  needs_disclosure = '필요',
  disclosure_template = '이 콘텐츠는 토스쇼핑 쉐어링크 활동의 일환으로, 링크를 통한 구매가 발생하면 일정 수수료를 지급받습니다.',
  disclosure_where = '모든 게시물 필수. 블로그: 제목, 도입부 또는 상품 소개 바로 앞. 인스타·숏폼: 첫 화면에 보이는 앞부분(더보기 뒤는 안 됨). #ad·#sp·''제휴 링크''만 쓰는 건 안 됨 (토스 공식 고지 가이드)',
  data_source = '쉐어링크 실적 대시보드(클릭·판매·환불·예상 수익금, 약 30분마다 집계, 한 번에 31일까지)와 정산 내역(확정 수익금·세금·실 지급액). Open API는 승인제이고 지금은 신규 신청을 받지 않아 → 앱에는 직접 입력하거나 파일로 올려줘.',
  commission_note = '수수료율은 앱에 넣지 않았어. 링크 클릭 후 24시간 안 결제·마지막 클릭 기준, 본인·지인 교차 구매는 인정 안 됨. 구매확정(배송완료 7일 뒤)된 달의 다음 달 25일에 지급(잔액 10원 이상), 비사업자는 3.3% 원천징수. 2026-11-03부터 앱인토스 미니앱 주문은 정산 제외 (모두 토스 공식 문서).',
  unverified = '쓰레드라는 이름은 문서에 없어(SNS 공유는 채널 등록하면 가능한 것으로 읽힘). 파일 내려받기 여부, 단축 URL·리디렉션 허용 여부(링크 임의 수정 금지 조항만 있음)는 확인 필요. 만 19세 이상만 가입 가능.',
  policy_url = 'https://sharelink-docs.toss.im/help/operations/policy.md',
  policy_checked_at = '2026-10-21'
where id = 'toss_sharelink';

update public.programs set
  needs_signup = '필요',
  needs_disclosure = '필요',
  disclosure_template = '',
  disclosure_where = '공정위 지침상 블로그는 제목이나 본문 첫 부분. 쇼핑 커넥트 자체 규정(위치·문구)은 확인 필요',
  data_source = '쇼핑 커넥트 크리에이터 대시보드에서 정산·성과 확인 (네이버 공식 보도자료). 파일 내려받기 여부는 확인 필요.',
  commission_note = '상품별 수익 쉐어 비율은 대시보드에서 확인 (앱에 넣지 않음). 정산 일정은 확인 필요.',
  unverified = '공식 고지 문구를 확인하지 못해서 비워뒀어. 쇼핑 커넥트 화면의 안내 문구를 그대로 넣어줘 (참고로 사용자들이 쓰는 문구: "이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다."). 가입 자격, 티스토리·워드프레스·쓰레드 허용 여부, 정산 일정도 확인 필요.',
  policy_url = 'https://navercorp.com/media/pressReleasesDetail?seq=33116',
  policy_checked_at = '2026-10-21'
where id = 'naver_shopping_connect';

update public.programs set
  needs_signup = '필요',
  needs_disclosure = '확인 필요',
  disclosure_where = '플랫폼 광고라 추천·보증 표시 대상이 아닐 수 있지만 공식 근거는 못 찾았어',
  data_source = '애드포스트 수입 리포트(네이버 로그인). 앱에는 직접 입력해줘.',
  commission_note = '네이버 블로그에 노출되는 광고 수익의 일부를 나눠 받는 구조 (2026-08 네이버 발표 보도).',
  unverified = '애드포스트 사이트가 조사 환경에서 막혀 있어서 가입 조건, 등록 가능한 매체 목록, 수입 리포트·지급 일정, 고지 필요 여부를 확인하지 못했어.',
  policy_url = 'https://navercorp.com/media/pressReleasesDetail?seq=27910',
  policy_checked_at = '2026-10-21'
where id = 'naver_adpost';

update public.programs set
  needs_signup = '필요',
  needs_disclosure = '확인 필요',
  disclosure_where = '디스플레이 광고라 추천·보증 표시 대상이 아닐 수 있지만 확인 필요',
  data_source = '애드센스 보고서. 매월 3일에 이전 달 예상 수입이 확정되고, 지급 기준액을 넘으면 21~26일에 지급 (Google 공식 도움말). 수익 보고서 API가 있지만 앱에는 연결 안 했어.',
  commission_note = '만 19세 이상, 사이트 HTML 소스에 접근할 수 있어야 신청 가능 (Google 공식). 티스토리는 앵커·오퍼월·모바일 전면광고 금지 (티스토리 공지).',
  unverified = '네이버 블로그에 설치할 수 없다는 네이버 쪽 공식 근거는 못 열어봤어 (업계에서는 설치가 안 된다고 알려져 있음).',
  policy_url = 'https://support.google.com/adsense/answer/9724?hl=ko',
  policy_checked_at = '2026-10-21'
where id = 'google_adsense';

update public.programs set
  needs_signup = '불필요',
  needs_disclosure = '필요',
  disclosure_template = '이 글은 브랜드로부터 대가(제품·원고료 등)를 받고 작성한 광고입니다.',
  disclosure_where = '블로그: 제목이나 첫 부분, 본문과 구분되게. 인스타: 사진 안이나 글 첫 부분, 해시태그면 첫 번째. 영상: 제목이나 영상 안 (공정위 지침). 업체 이름과 받은 것을 구체적으로 적으면 더 좋아.',
  data_source = '협찬 계약서·입금 내역 (직접 입력)',
  commission_note = '''체험 후기'', ''선물'', 영어 표기(AD·Sponsor)만 쓰는 건 명확한 표시가 아니야 (공정위 지침).',
  unverified = '티스토리의 협찬 게시물 규정은 확인 필요.',
  policy_url = 'https://www.law.go.kr/LSW/admRulInfoR.do?admRulSeq=2100000280130',
  policy_checked_at = '2026-10-21'
where id = 'sponsorship';

update public.programs set
  needs_signup = '불필요',
  needs_disclosure = '확인 필요',
  data_source = '판매 플랫폼의 판매 내역 (직접 입력)',
  unverified = '블로그·SNS 플랫폼별 판매 게시물 규정, 통신판매업 신고 같은 법적 의무는 확인 필요.',
  policy_checked_at = '2026-10-21'
where id = 'digital_product';

update public.programs set
  needs_signup = '필요',
  needs_disclosure = '필요',
  disclosure_where = '공정위 지침상 제휴 수수료도 표시 대상. 네트워크·캠페인별 문구는 그 안내를 따라줘.',
  data_source = '참여한 CPA 네트워크의 리포트 (직접 입력·파일)',
  unverified = '네트워크·캠페인마다 허용 매체와 고지 문구가 달라서 비워뒀어. 쓰는 캠페인의 안내 문구를 넣어줘.',
  policy_url = 'https://www.korea.kr/briefing/pressReleaseView.do?newsId=156660604',
  policy_checked_at = '2026-10-21'
where id = 'cpa';

-- ── 게시 채널 ──
update public.channels set max_chars = 500,
  notes = '글은 500자까지, 링크는 5개까지 (Meta 공식 API 문서). 긴 글은 텍스트 첨부로 1만 자까지. 공정위 지침에 쓰레드 기준은 따로 없어서 글 위주면 문자 매체 기준(첫 부분 표시)을 따르는 게 안전해.',
  source_url = 'https://developers.facebook.com/docs/threads/posts', checked_at = '2026-10-21'
where id = 'threads';

update public.channels set max_chars = 2200, clickable_links = false,
  notes = '캡션 2,200자·해시태그 30개 (Meta 공식 API 문서). 캡션 링크는 일반 계정에서 눌리지 않는다고 보도됨(공식 도움말은 확인 필요) → 프로필 링크나 스토리 링크 스티커로 안내. 광고 표시는 사진 안이나 글 첫 부분, 해시태그면 첫 번째 (공정위 지침).',
  source_url = 'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media', checked_at = '2026-10-21'
where id = 'instagram';

update public.channels set
  notes = '글쓰기 API가 없어서 복사해서 붙여넣기로 올려. 블로그 운영정책 원문은 조사 환경에서 막혀서 확인 필요. 대가성 표시가 흐리면 검색 노출이 제한될 수 있어(2020 보도).',
  checked_at = '2026-10-21'
where id = 'naver_blog';

update public.channels set
  notes = 'Open API가 끝나서 복사해서 붙여넣기로 올려. 애드센스 등 외부 광고 연동은 가능, 앵커·오퍼월·모바일 전면광고는 금지 (티스토리 공지 2025~2026).',
  source_url = 'https://notice.tistory.com/2701', checked_at = '2026-10-21'
where id = 'tistory';

update public.channels set
  notes = '자체 사이트. 제휴 링크에는 rel="sponsored"를 붙이라는 게 구글 권장이고, 앱 복사본에 이미 들어가 있어. 판매자 설명만 옮긴 빈약한 제휴 글은 구글 스팸 정책 위반이야.',
  source_url = 'https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links?hl=ko', checked_at = '2026-10-21'
where id = 'website';

-- ── 수익 모델 × 채널 판정 ──
insert into public.program_channels (program_id, channel_id, verdict, reason, source_url, checked_at) values
 ('coupang_partners','naver_blog','확인 필요','쿠팡 공식(2018)은 블로그 허용. 네이버 블로그 운영정책 원문은 못 열어봄 (유력: 가능)','https://news.coupang.com/archives/397/','2026-10-21'),
 ('coupang_partners','tistory','확인 필요','쿠팡은 블로그 허용. 티스토리 공지에 금지 조항은 없지만 제휴 링크 규정은 못 찾음 (유력: 가능)','https://news.coupang.com/archives/397/','2026-10-21'),
 ('coupang_partners','website','가능','쿠팡 공식(2018) "기업 홈페이지…모든 채널 등록". 현행 약관 원문은 못 열어봄','https://news.coupang.com/archives/397/','2026-10-21'),
 ('coupang_partners','threads','확인 필요','"모든 채널" 발표는 쓰레드 출시 전 자료 (유력: 가능)','https://news.coupang.com/archives/397/','2026-10-21'),
 ('coupang_partners','instagram','가능','쿠팡 공식(2018) 채널 예시에 인스타그램. 캡션 링크는 안 눌려서 스토리·프로필 링크로','https://news.coupang.com/archives/397/','2026-10-21'),
 ('toss_sharelink','naver_blog','확인 필요','토스 공식 블로그 표시 규정 있음. 네이버 운영정책은 못 열어봄 (유력: 가능)','https://sharelink-docs.toss.im/disclosure/disclosure.md','2026-10-21'),
 ('toss_sharelink','tistory','확인 필요','토스는 블로그 허용. 티스토리 제휴 링크 규정은 못 찾음 (유력: 가능)','https://sharelink-docs.toss.im/disclosure/disclosure.md','2026-10-21'),
 ('toss_sharelink','website','가능','토스 공식: 블로그 허용(공유 채널 등록 필수)','https://sharelink-docs.toss.im/start/channels.md','2026-10-21'),
 ('toss_sharelink','threads','가능','토스 공식: SNS에서 공유하면 그 주소를 채널로 등록 (쓰레드 이름은 문서에 없음)','https://sharelink-docs.toss.im/start/channels.md','2026-10-21'),
 ('toss_sharelink','instagram','가능','토스 공식 고지 가이드에 인스타그램·숏폼 표시 위치 규정 있음','https://sharelink-docs.toss.im/disclosure/disclosure.md','2026-10-21'),
 ('naver_shopping_connect','naver_blog','가능','네이버 공식: 블로그 창작자가 판매 링크를 받아 홍보','https://navercorp.com/media/pressReleasesDetail?seq=33116','2026-10-21'),
 ('naver_shopping_connect','tistory','확인 필요','공식 자료엔 "네이버 블로그, 유튜브, 인스타그램 등"만 나옴','https://navercorp.com/media/pressReleasesDetail?seq=32355','2026-10-21'),
 ('naver_shopping_connect','website','확인 필요','공식 자료에 독립 사이트 언급 없음 (가능하다는 2차 주장만 있음)','https://navercorp.com/media/pressReleasesDetail?seq=32355','2026-10-21'),
 ('naver_shopping_connect','threads','확인 필요','공식 자료에 쓰레드 언급 없음','https://navercorp.com/media/pressReleasesDetail?seq=33116','2026-10-21'),
 ('naver_shopping_connect','instagram','가능','네이버 공식(2025-03-13): "네이버 블로그, 유튜브, 인스타그램 등 자신이 활동하는 채널"','https://navercorp.com/media/pressReleasesDetail?seq=32355','2026-10-21'),
 ('naver_adpost','naver_blog','가능','네이버 블로그 대상 서비스(공식 2009·2010), 2026-08에도 운영 중(보도)','https://navercorp.com/media/pressReleasesDetail?seq=27910','2026-10-21'),
 ('naver_adpost','tistory','확인 필요','네이버 매체 전용으로 보이지만 적용 매체 목록은 못 열어봄 (유력: 불가)','https://byline.network/2026/08/07_naver_2/','2026-10-21'),
 ('naver_adpost','website','확인 필요','적용 매체 목록은 못 열어봄 (유력: 불가)','https://byline.network/2026/08/07_naver_2/','2026-10-21'),
 ('naver_adpost','threads','불가','네이버 블로그에 붙는 광고의 수익을 나누는 구조라 쓰레드 글에는 광고가 붙지 않음','https://byline.network/2026/08/07_naver_2/','2026-10-21'),
 ('naver_adpost','instagram','불가','네이버 블로그에 붙는 광고의 수익을 나누는 구조라 인스타 글에는 광고가 붙지 않음','https://byline.network/2026/08/07_naver_2/','2026-10-21'),
 ('google_adsense','naver_blog','확인 필요','구글 요건: 사이트 HTML 소스에 접근할 수 있어야 함. 네이버 쪽 공식 문서는 못 열어봄 (업계에서는 불가로 알려짐)','https://support.google.com/adsense/answer/9724?hl=ko','2026-10-21'),
 ('google_adsense','tistory','가능','구글 공식 티스토리 가입 도움말 + 티스토리 공지(2026-05-28)로 연동 유지. 앵커·오퍼월·모바일 전면광고는 금지','https://support.google.com/adsense/answer/7287082?hl=ko','2026-10-21'),
 ('google_adsense','website','가능','HTML에 접근할 수 있는 자체 사이트면 신청 가능(승인 필요, 만 19세 이상)','https://support.google.com/adsense/answer/9724?hl=ko','2026-10-21'),
 ('google_adsense','threads','불가','HTML 소스에 접근할 수 있는 사이트만 대상이라 SNS 글에는 넣을 수 없음','https://support.google.com/adsense/answer/9724?hl=ko','2026-10-21'),
 ('google_adsense','instagram','불가','HTML 소스에 접근할 수 있는 사이트만 대상이라 SNS 글에는 넣을 수 없음','https://support.google.com/adsense/answer/9724?hl=ko','2026-10-21'),
 ('sponsorship','naver_blog','가능','네이버 브랜드 커넥트가 블로그 창작자 협업을 공식 지원. 제목이나 첫 부분에 표시','https://navercorp.com/media/pressReleasesDetail?seq=32355','2026-10-21'),
 ('sponsorship','tistory','확인 필요','공정위 표시 의무는 같음. 티스토리 협찬 게시물 규정은 못 찾음 (유력: 가능)','https://www.law.go.kr/LSW/admRulInfoR.do?admRulSeq=2100000280130','2026-10-21'),
 ('sponsorship','website','가능','자체 사이트는 제약 없음 (WordPress.com은 협찬이 대부분인 사이트만 불허)','https://wordpress.com/support/affiliate-links/','2026-10-21'),
 ('sponsorship','threads','가능','Meta: 쓰레드 브랜디드 콘텐츠는 유료 파트너십 도구로 표시. 공정위 표시도 따로 필요','https://help.instagram.com/2467529163409127','2026-10-21'),
 ('sponsorship','instagram','가능','인스타 공식: 브랜디드 콘텐츠 태그 필수. 공정위 표시(사진 안, 첫 부분, 첫 해시태그)도 필요','https://business.instagram.com/blog/tools-to-disclose-instagram-partnerships','2026-10-21'),
 ('digital_product','naver_blog','확인 필요','네이버 블로그 상업 게시물 규정을 못 열어봄','','2026-10-21'),
 ('digital_product','tistory','확인 필요','티스토리 운영정책을 못 열어봄','','2026-10-21'),
 ('digital_product','website','가능','자체 사이트는 플랫폼 제약 없음 (통신판매업 신고 등 법적 의무는 따로 확인)','','2026-10-21'),
 ('digital_product','threads','확인 필요','링크는 올릴 수 있지만 판매 홍보에 대한 Meta 정책은 확인 못 함','https://developers.facebook.com/docs/threads/posts','2026-10-21'),
 ('digital_product','instagram','확인 필요','판매 홍보에 대한 Meta 정책은 확인 못 함','https://about.instagram.com/blog/announcements/expanding-sharing-links-in-stories-to-everyone','2026-10-21'),
 ('cpa','naver_blog','확인 필요','네트워크·캠페인마다 허용 매체가 다르고 네이버 정책은 못 열어봄','https://tenping.kr/','2026-10-21'),
 ('cpa','tistory','가능','티스토리 공식: 텐핑 등 외부 플랫폼 연동 가능. 캠페인별 허용 매체는 따로 확인','https://notice.tistory.com/2701','2026-10-21'),
 ('cpa','website','확인 필요','사이트 쪽 제약은 없지만 네트워크·캠페인별로 다름 (유력: 가능)','https://wordpress.com/support/affiliate-links/','2026-10-21'),
 ('cpa','threads','확인 필요','캠페인별로 다르고 Meta 쪽 규정은 확인 못 함','','2026-10-21'),
 ('cpa','instagram','확인 필요','캠페인별로 다르고 Meta 쪽 규정은 확인 못 함','','2026-10-21')
on conflict (program_id, channel_id) do nothing;
