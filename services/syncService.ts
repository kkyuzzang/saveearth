
import { GameState } from '../types';

const BUCKET_ID = 'ClimateCrisis_v2_Relay'; 
const BASE_URL = `https://kvdb.io/${BUCKET_ID}`;

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

// Removed async from the setup function so it returns the cleanup function synchronously
export const pollGameState = (roomId: string, callback: (state: GameState) => void) => {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`${BASE_URL}/${roomId}_state`);
      if (res.ok) {
        const data = await res.json();
        callback(data);
      }
    } catch (e) {}
  }, 2000);
  return () => clearInterval(interval);
};

export const joinRoom = async (roomId: string, countryId: string, nickname: string) => {
  const joinData = { countryId, nickname, timestamp: Date.now() };
  await fetch(`${BASE_URL}/${roomId}_joins_${countryId}`, {
    method: 'PUT',
    body: JSON.stringify(joinData),
  });
};

export const pollJoins = (roomId: string, callback: (countryId: string, nickname: string) => void) => {
  const countries = ['KOREA', 'USA', 'SWEDEN', 'JAPAN', 'TUVALU', 'DENMARK', 'FRANCE', 'BRAZIL', 'NKOREA'];
  const interval = setInterval(async () => {
    for (const cid of countries) {
      try {
        const res = await fetch(`${BASE_URL}/${roomId}_joins_${cid}`);
        if (res.ok) {
          const data = await res.json();
          callback(cid, data.nickname);
        }
      } catch (e) {}
    }
  }, 3000);
  return () => clearInterval(interval);
};

export const sendAction = async (roomId: string, action: any) => {
  await fetch(`${BASE_URL}/${roomId}_actions_${action.countryId}`, {
    method: 'PUT',
    body: JSON.stringify({ ...action, timestamp: Date.now() }),
  });
};

export const pollActions = (roomId: string, callback: (action: any) => void) => {
  const countries = ['KOREA', 'USA', 'SWEDEN', 'JAPAN', 'TUVALU', 'DENMARK', 'FRANCE', 'BRAZIL', 'NKOREA'];
  const interval = setInterval(async () => {
    for (const cid of countries) {
      try {
        const res = await fetch(`${BASE_URL}/${roomId}_actions_${cid}`);
        if (res.ok) {
          const action = await res.json();
          callback(action);
        }
      } catch (e) {}
    }
  }, 2500);
  return () => clearInterval(interval);
};
