
import { GameState } from '../types.ts';

// Use a unique and valid KVDB bucket ID. 
// KVDB buckets are public by default unless a secret is used.
const BUCKET_ID = 'cw_v4_prod_2024'; 
const BASE_URL = `https://kvdb.io/${BUCKET_ID}`;

const headers = {
  'Content-Type': 'application/json',
};

/**
 * Robust fetch wrapper with timeout
 */
async function safeFetch(url: string, options?: RequestInit) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 5000);
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
    const response = await safeFetch(`${BASE_URL}/${key}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(state),
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.warn("Sync failed status:", response.status, errorText);
    }
  } catch (e) {
    console.error("State Sync Network Error:", e);
  }
};

// 게임 상태 폴링
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
    } catch (e) {
      // Quietly ignore polling errors to avoid console flood
    }
  }, 1500); // Increased interval slightly to reduce rate limit hits
  return () => clearInterval(interval);
};

// 액션 전달 (입장, 개발 선택, 스킬 등)
export const sendAction = async (roomId: string, action: any) => {
  if (!roomId) return false;
  const key = encodeURIComponent(`${roomId}_actions`);
  try {
    // 1. Get current actions
    const res = await safeFetch(`${BASE_URL}/${key}`);
    let actions = [];
    if (res.ok) {
      const text = await res.text();
      actions = text ? JSON.parse(text) : [];
    }
    
    // 2. Add new action
    const newAction = { 
      ...action, 
      id: Math.random().toString(36).substring(2, 11),
      timestamp: Date.now() 
    };
    actions.push(newAction);
    
    // Keep only last 20 actions to keep payload small
    if (actions.length > 20) actions = actions.slice(-20);

    // 3. Save back
    const putRes = await safeFetch(`${BASE_URL}/${key}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(actions),
    });
    return putRes.ok;
  } catch (e) {
    console.error("Action Send Error:", e);
    return false;
  }
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
  }, 2000); // Poll actions less frequently for the host
  return () => clearInterval(interval);
};

// 액션 큐 비우기
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
