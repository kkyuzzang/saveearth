
import { GameState } from '../types.ts';

const BUCKET_ID = 'cw_v4_prod_2024_stable'; 
const BASE_URL = `https://kvdb.io/${BUCKET_ID}`;

const headers = {
  'Content-Type': 'application/json',
};

async function safeFetch(url: string, options?: RequestInit) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

// 게임 상태 저장
export const syncGameState = async (state: GameState) => {
  if (!state.roomId) return;
  const key = encodeURIComponent(`${state.roomId}_state`);
  try {
    await safeFetch(`${BASE_URL}/${key}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(state),
    });
  } catch (e) {
    console.error("State Sync Error:", e);
  }
};

// 게임 상태 폴링 (학생용) - 더 빠르게 업데이트 확인
export const pollGameState = (roomId: string, callback: (state: GameState) => void) => {
  if (!roomId) return () => {};
  const key = encodeURIComponent(`${roomId}_state`);
  const interval = setInterval(async () => {
    try {
      const res = await safeFetch(`${BASE_URL}/${key}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.phase) callback(data);
      }
    } catch (e) {}
  }, 1000); 
  return () => clearInterval(interval);
};

// 액션 전달 (재시도 로직 포함하여 충돌 방지)
export const sendAction = async (roomId: string, action: any) => {
  if (!roomId) return false;
  const key = encodeURIComponent(`${roomId}_actions`);
  
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await safeFetch(`${BASE_URL}/${key}`);
      let actions = [];
      if (res.ok) {
        const text = await res.text();
        actions = text ? JSON.parse(text) : [];
      }
      
      const newAction = { 
        ...action, 
        id: Math.random().toString(36).substring(2, 11),
        timestamp: Date.now() 
      };
      
      actions.push(newAction);
      if (actions.length > 30) actions = actions.slice(-30);

      const putRes = await safeFetch(`${BASE_URL}/${key}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(actions),
      });
      
      if (putRes.ok) return true;
    } catch (e) {
      await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  return false;
};

// 교사용 액션 폴링
export const pollActions = (roomId: string, callback: (actions: any[]) => void) => {
  if (!roomId) return () => {};
  const key = encodeURIComponent(`${roomId}_actions`);
  const interval = setInterval(async () => {
    try {
      const res = await safeFetch(`${BASE_URL}/${key}`);
      if (res.ok) {
        const text = await res.text();
        const actions = text ? JSON.parse(text) : [];
        if (Array.isArray(actions)) callback(actions);
      }
    } catch (e) {}
  }, 1200); 
  return () => clearInterval(interval);
};

export const clearActions = async (roomId: string) => {
  const key = encodeURIComponent(`${roomId}_actions`);
  try {
    await safeFetch(`${BASE_URL}/${key}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify([]),
    });
  } catch (e) {}
};
