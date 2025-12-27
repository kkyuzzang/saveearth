
import { Country, CountryId, QuizQuestion } from './types';

export const INITIAL_TEMPERATURE = 15.0;
export const MAX_TEMPERATURE = 20.0;
export const MAX_TURNS = 8;

export const COUNTRIES: Record<CountryId, Country> = {
  // Added nickname: '' to satisfy Country interface
  KOREA: { id: 'KOREA', name: '대한민국', flag: '🇰🇷', abilityName: '녹색성장', abilityDesc: '두 나라 지명 후 가위바위보 대결. 진 쪽 GP -5, 기온 -0.3', gp: 20, lastChoice: null, isAbilityUsed: false, isJoined: false, nickname: '', score: 0 },
  USA: { id: 'USA', name: '미국', flag: '🇺🇸', abilityName: 'CCS 기술', abilityDesc: '퀴즈 정답 시 지구 기온 -0.5', gp: 25, lastChoice: null, isAbilityUsed: false, isJoined: false, nickname: '', score: 0 },
  SWEDEN: { id: 'SWEDEN', name: '스웨덴', flag: '🇸🇪', abilityName: '인간 환경 선언', abilityDesc: '다음 턴 모든 국가 환경 우선 선택 시 기온 -0.4', gp: 18, lastChoice: null, isAbilityUsed: false, isJoined: false, nickname: '', score: 0 },
  JAPAN: { id: 'JAPAN', name: '일본', flag: '🇯🇵', abilityName: '교토의정서', abilityDesc: '기온 17도 이상 시. 직전 경제 우선 국가는 이번 턴 환경 우선 강제', gp: 22, lastChoice: null, isAbilityUsed: false, isJoined: false, nickname: '', score: 0 },
  TUVALU: { id: 'TUVALU', name: '투발루', flag: '🇹🇻', abilityName: '가라앉는 섬', abilityDesc: '기온 18도 이상 시. 한 나라가 GP 10 기부 시 기온 -0.4', gp: 10, lastChoice: null, isAbilityUsed: false, isJoined: false, nickname: '', score: 0 },
  DENMARK: { id: 'DENMARK', name: '덴마크', flag: '🇩🇰', abilityName: '코펜하겐 기후협약', abilityDesc: '기온 17도 이상 시. GP 상위 3개국 2턴간 환경 우선 강제', gp: 20, lastChoice: null, isAbilityUsed: false, isJoined: false, nickname: '', score: 0 },
  FRANCE: { id: 'FRANCE', name: '프랑스', flag: '🇫🇷', abilityName: '파리기후변화협약', abilityDesc: '기온 19도 이상 시. 프랑스 제외 모든 국가 1턴간 환경 우선 강제', gp: 20, lastChoice: null, isAbilityUsed: false, isJoined: false, nickname: '', score: 0 },
  BRAZIL: { id: 'BRAZIL', name: '브라질', flag: '🇧🇷', abilityName: '리우 환경회의', abilityDesc: '브라질 제외 모든 국가 1턴간 경제/환경 선택 반대 적용', gp: 15, lastChoice: null, isAbilityUsed: false, isJoined: false, nickname: '', score: 0 },
  NKOREA: { id: 'NKOREA', name: '북한', flag: '🇰🇵', abilityName: '내래 핵 쏜다우', abilityDesc: '지구 기온 +1.0 (즉시 적용)', gp: 12, lastChoice: null, isAbilityUsed: false, isJoined: false, nickname: '', score: 0 },
};

export const QUIZ_POOL: QuizQuestion[] = [
  { id: 1, question: "지구 온난화의 주요 원인이 아닌 것은?", options: ["이산화탄소 배출", "메탄가스 발생", "태양열 발전", "화석 연료 사용"], answer: 2, explanation: "태양열 발전은 신재생 에너지로 온난화를 완화합니다." },
  { id: 2, question: "탄소 중립(Net Zero)이란 무엇인가요?", options: ["탄소 배출을 0으로 만드는 것", "배출량과 흡수량을 같게 하여 실질 배출을 0으로 만드는 것", "자동차를 타지 않는 것", "석탄을 아예 안 쓰는 것"], answer: 1, explanation: "배출한 만큼 흡수하여 순 배출량을 0으로 만드는 개념입니다." },
  { id: 3, question: "지구의 기온이 2도 이상 상승하면 발생하는 현상이 아닌 것은?", options: ["해수면 상승", "생태계 붕괴", "빙하 감소", "인구 증가"], answer: 3, explanation: "지구 평균 기온이 2도 이상 오르면 재앙적인 기후 변화가 발생합니다." },
  { id: 4, question: "플라스틱이 바다에 버려졌을 때 잘게 쪼개지는 것을 무엇이라 하나요?", options: ["나노 플라스틱", "미세 플라스틱", "마이크로 가루", "해양 먼지"], answer: 1, explanation: "5mm 미만의 작은 조각을 미세 플라스틱이라 부릅니다." },
  { id: 5, question: "세계 환경의 날은 언제인가요?", options: ["4월 22일", "5월 5일", "6월 5일", "12월 25일"], answer: 2, explanation: "6월 5일입니다." },
  { id: 6, question: "파리 기후 협정의 주요 목표는?", options: ["1.5도 이내 억제", "5도 이내 억제", "경제 성장 10%", "출생률 증가"], answer: 0, explanation: "산업화 이전 대비 지구 평균 온도 상승을 1.5도 이내로 제한하는 것이 목표입니다." },
  { id: 7, question: "메탄가스를 가장 많이 배출하는 가축은?", options: ["닭", "돼지", "소", "말"], answer: 2, explanation: "소의 반추 과정에서 많은 양의 메탄이 발생합니다." },
  { id: 8, question: "RE100이란 무엇의 약자인가요?", options: ["Renewable Energy 100%", "Recycle Energy 100%", "Reduced Emission 100%", "Real Economy 100%"], answer: 0, explanation: "기업이 사용하는 전력의 100%를 재생에너지로 충당하자는 글로벌 캠페인입니다." },
  { id: 9, question: "오존층 파괴의 주범으로 알려진 물질은?", options: ["헬륨", "프레온 가스", "산소", "질소"], answer: 1, explanation: "냉매 등으로 쓰인 프레온 가스가 오존층을 파괴합니다." },
  { id: 10, question: "지구에서 가장 많은 탄소를 흡수하는 곳은?", options: ["도시", "사막", "바다", "빙하"], answer: 2, explanation: "바다는 전 세계 탄소 배출량의 큰 부분을 흡수하는 거대한 탄소 흡수원입니다." },
  { id: 11, question: "온실가스가 아닌 것은 무엇일까요?", options: ["이산화탄소", "메탄", "아산화질소", "아르곤"], answer: 3, explanation: "아르곤은 비활성 기체로 온실가스가 아닙니다." },
  { id: 12, question: "기후 변화로 인해 멸종 위기에 처한 대표적인 동물은?", options: ["북극곰", "집비둘기", "시골쥐", "길고양이"], answer: 0, explanation: "빙하 감소로 인해 북극곰의 서식지가 사라지고 있습니다." },
  { id: 13, question: "환경을 보호하기 위한 '3R'에 해당하지 않는 것은?", options: ["Reduce(절약)", "Reuse(재사용)", "Recycle(재활용)", "Repair(수리)"], answer: 3, explanation: "전통적인 3R은 Reduce, Reuse, Recycle입니다." },
  { id: 14, question: "물 발자국(Water Footprint)이란 무엇인가요?", options: ["물 위를 걸을 때 생기는 자국", "제품 생산 전 과정에서 소비되는 물의 양", "비가 올 때 생기는 웅덩이", "수영장에 들어간 횟수"], answer: 1, explanation: "우리가 사용하는 제품을 만들기 위해 소비되는 물의 총량을 의미합니다." },
  { id: 15, question: "나무 한 그루가 1년 동안 흡수하는 이산화탄소의 양은 대략 얼마일까요?", options: ["1kg", "8kg", "100kg", "500kg"], answer: 1, explanation: "일반적으로 성숙한 나무 한 그루는 연간 약 8~10kg의 CO2를 흡수합니다." },
  { id: 16, question: "사막화 현상의 원인이 아닌 것은?", options: ["과도한 방목", "무분별한 삼림 벌채", "기후 변화", "적절한 관개 농법"], answer: 3, explanation: "적절한 관개 농법은 사막화를 방지하는 데 도움을 줍니다." },
  { id: 17, question: "에너지 효율 등급이 1등급에 가까울수록 에너지를 어떻게 소비하나요?", options: ["많이 소비한다", "적게 소비한다", "중간 정도로 소비한다", "상관없다"], answer: 1, explanation: "1등급 제품은 5등급 제품보다 에너지를 훨씬 적게 소비합니다." },
  { id: 18, question: "대기 오염의 지표로 사용되는 생물은 무엇일까요?", options: ["지의류", "민들레", "무당벌레", "참새"], answer: 0, explanation: "지의류는 대기 오염에 매우 민감하여 환경 지표 생물로 쓰입니다." },
  { id: 19, question: "바이오 에너지의 원료가 될 수 없는 것은?", options: ["사탕수수", "옥수수", "폐식용유", "스티로폼"], answer: 3, explanation: "스티로폼은 석유 화학 제품으로 바이오 에너지 원료가 아닙니다." },
  { id: 20, question: "생물 다양성이 중요한 이유는 무엇일까요?", options: ["생태계의 안정성 유지", "미래 의약품 자원 확보", "유전자원 보존", "모두 정답"], answer: 3, explanation: "생물 다양성은 인류의 생존과 직결된 중요한 문제입니다." },
  { id: 21, question: "그린워싱(Greenwashing)이란 무엇인가요?", options: ["친환경 세탁법", "기업이 실제로는 아니면서 친환경적인 것처럼 홍보하는 것", "숲을 씻어내는 행위", "녹색 페인트를 칠하는 것"], answer: 1, explanation: "위장 환경주의를 뜻하며, 소비자를 속이는 행위입니다." },
  { id: 22, question: "지구의 날(Earth Day)은 언제인가요?", options: ["3월 2일", "4월 22일", "5월 22일", "10월 22일"], answer: 1, explanation: "4월 22일입니다." },
  { id: 23, question: "갯벌의 역할이 아닌 것은?", options: ["수질 정화", "홍수 조절", "생물 서식처 제공", "해수면 온도 상승"], answer: 3, explanation: "갯벌은 탄소를 흡수하여 온도를 낮추는 역할을 하기도 합니다." },
  { id: 24, question: "다음 중 재생 에너지가 아닌 것은?", options: ["풍력", "조력", "원자력", "지열"], answer: 2, explanation: "원자력은 신에너지 또는 저탄소 에너지로 분류되기도 하지만 재생 에너지는 아닙니다." },
  { id: 25, question: "빙하가 녹으면 나타나는 현상은?", options: ["해수면 상승", "햇빛 반사율 감소(기온 상승 가속)", "해류 변화", "모두 정답"], answer: 3, explanation: "빙하 소멸은 다각도로 지구 환경에 위협을 줍니다." },
  { id: 26, question: "가장 많은 탄소를 배출하는 산업 분야는?", options: ["IT 산업", "의료 서비스", "에너지 발전 및 운송", "교육 서비스"], answer: 2, explanation: "화석 연료를 사용하는 발전과 교통 수단이 가장 많은 탄소를 배출합니다." },
  { id: 27, question: "로컬 푸드(Local Food)를 먹으면 왜 환경에 좋을까요?", options: ["맛이 좋아서", "운송 거리가 짧아 탄소 배출이 적어서", "가격이 비싸서", "포장이 화려해서"], answer: 1, explanation: "푸드 마일리지가 낮아져 수송 과정의 온실가스 배출을 줄입니다." },
  { id: 28, question: "패스트 패션(Fast Fashion)이 환경에 주는 영향은?", options: ["물 소비량 증가", "의류 폐기물 대량 발생", "염색 시 수질 오염", "모두 정답"], answer: 3, explanation: "옷을 빠르게 만들고 버리는 문화는 환경에 큰 부담을 줍니다." },
  { id: 29, question: "업사이클링(Upcycling)이란?", options: ["자전거를 타고 언덕을 올라가는 것", "재활용품에 디자인과 가치를 더해 새 제품으로 만드는 것", "헌 옷을 그냥 입는 것", "쓰레기를 모으는 것"], answer: 1, explanation: "새활용이라고도 하며, 재활용보다 한 단계 높은 가치를 창출합니다." },
  { id: 30, question: "식목일은 언제인가요?", options: ["3월 5일", "4월 5일", "5월 5일", "6월 5일"], answer: 1, explanation: "4월 5일입니다." },
];
