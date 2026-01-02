
import { GameState } from '../types.ts';

const BUCKET_ID = 'ClimateCrisis_v3_Relay'; // 버킷 아이디 버전업으로 충돌 방지
const BASE_URL = `https://kvdb.io/${BUCKET_ID}`;

// 게임 상태 저장 (주로 HOST가 사용)
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

// 게임 상태 폴링 (주로 GUEST가 사용)
export const pollGameState = (roomId: string, callback: (state: GameState) => void) => {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`${BASE_URL}/${roomId}_state`);
      if (res.ok) {
        const data = await res.json();
        callback(data);
      }
    } catch (e) {}
  }, 1500); // 폴링 속도 향상
  return () => clearInterval(interval);
};

// 학생의 액션(입장 포함)을 서버에 전달
export const sendAction = async (roomId: string, action: any) => {
  try {
    // 기존 액션 리스트를 가져와서 추가하는 방식 (큐 구현)
    const res = await fetch(`${BASE_URL}/${roomId}_actions`);
    let actions = [];
    if (res.ok) {
      actions = await res.json();
    }
    actions.push({ ...action, timestamp: Date.now(), id: Math.random().toString(36).substr(2, 9) });
    
    // 최근 20개만 유지하여 속도 최적화
    if (actions.length > 20) actions = actions.slice(-20);

    await fetch(`${BASE_URL}/${roomId}_actions`, {
      method: 'PUT',
      body: JSON.stringify(actions),
    });
  } catch (e) {
    console.error("Action Send Error:", e);
  }
};

// 교사가 학생들의 액션을 폴링
export const pollActions = (roomId: string, callback: (actions: any[]) => void) => {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`${BASE_URL}/${roomId}_actions`);
      if (res.ok) {
        const actions = await res.json();
        callback(actions);
      }
    } catch (e) {}
  }, 2000);
  return () => clearInterval(interval);
};

// 액션 큐 초기화 (교사가 다음 단계로 갈 때 가끔 청소)
export const clearActions = async (roomId: string) => {
  try {
    await fetch(`${BASE_URL}/${roomId}_actions`, {
      method: 'PUT',
      body: JSON.stringify([]),
    });
  } catch (e) {}
};
