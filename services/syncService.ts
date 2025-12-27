
import { GameState } from '../types';

// 공용 버킷 ID (앱 전용)
const BUCKET_ID = 'ClimateCrisis_v2_Relay'; 
const BASE_URL = `https://kvdb.io/${BUCKET_ID}`;

/**
 * 상태 업로드 (호스트 전용)
 */
export const syncGameState = async (state: GameState) => {
  try {
    await fetch(`${BASE_URL}/${state.roomId}_state`, {
      method: 'PUT',
      body: JSON.stringify(state),
    });
  } catch (e) {
    console.error("State Sync Error:", e);
  }
};

/**
 * 상태 폴링 (게스트 전용)
 */
export const pollGameState = async (roomId: string, callback: (state: GameState) => void) => {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`${BASE_URL}/${roomId}_state`);
      if (res.ok) {
        const data = await res.json();
        callback(data);
      }
    } catch (e) {
      console.error("Polling Error:", e);
    }
  }, 2000); // 2초마다 확인
  return () => clearInterval(interval);
};

/**
 * 입장 요청 (게스트 전용)
 */
export const joinRoom = async (roomId: string, countryId: string) => {
  const joinData = { countryId, timestamp: Date.now() };
  await fetch(`${BASE_URL}/${roomId}_joins_${countryId}`, {
    method: 'PUT',
    body: JSON.stringify(joinData),
  });
};

/**
 * 입장 요청 수집 (호스트 전용)
 */
export const pollJoins = (roomId: string, callback: (countryId: string) => void) => {
  const interval = setInterval(async () => {
    // 실제로는 모든 키를 가져오기 어려우므로, 각 국가별 키를 순회하며 확인하는 방식 사용
    const countries = ['KOREA', 'USA', 'SWEDEN', 'JAPAN', 'TUVALU', 'DENMARK', 'FRANCE', 'BRAZIL', 'NKOREA'];
    for (const cid of countries) {
      try {
        const res = await fetch(`${BASE_URL}/${roomId}_joins_${cid}`);
        if (res.ok) {
          callback(cid);
          // 확인 후 삭제 처리 (Optional)
        }
      } catch (e) {}
    }
  }, 3000);
  return () => clearInterval(interval);
};

/**
 * 액션 전송 (게스트 전용)
 */
export const sendAction = async (roomId: string, action: any) => {
  await fetch(`${BASE_URL}/${roomId}_actions_${action.countryId}_${Date.now()}`, {
    method: 'PUT',
    body: JSON.stringify(action),
  });
};

/**
 * 액션 수집 (호스트 전용)
 */
export const pollActions = async (roomId: string, callback: (action: any) => void) => {
  const interval = setInterval(async () => {
    // 특정 방의 액션 목록을 가져오는 시뮬레이션
    // 실제 kvdb.io의 목록 기능을 쓰거나, 특정 패턴의 키를 확인합니다.
    // 여기서는 간단하게 구현을 위해 구조화된 접근 방식을 제안합니다.
  }, 3000);
  return () => clearInterval(interval);
};
