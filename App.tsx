
import React, { useState, useEffect, useRef } from 'react';
import { GameState, GamePhase, CountryId, Country, QuizQuestion } from './types.ts';
import { COUNTRIES, INITIAL_TEMPERATURE, MAX_TEMPERATURE, MAX_TURNS, QUIZ_POOL } from './constants.ts';
import * as syncService from './services/syncService.ts';
import TemperatureGauge from './components/TemperatureGauge.tsx';

// 사운드 자원 정의 (Mixkit 무료 에셋)
const SFX = {
  CLICK: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3',
  JOIN: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3',
  ALARM: 'https://assets.mixkit.co/active_storage/sfx/951/951-preview.mp3',
  SUCCESS: 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3',
  TRANSITION: 'https://assets.mixkit.co/active_storage/sfx/2567/2567-preview.mp3',
  GAME_OVER: 'https://assets.mixkit.co/active_storage/sfx/2533/2533-preview.mp3',
  WIN: 'https://assets.mixkit.co/active_storage/sfx/1433/1433-preview.mp3'
};

const App: React.FC = () => {
  const [role, setRole] = useState<'HOST' | 'GUEST' | null>(null);
  const [myCountryId, setMyCountryId] = useState<CountryId | null>(null);
  const [pendingCountryId, setPendingCountryId] = useState<CountryId | null>(null);
  const [roomInput, setRoomInput] = useState(''); // 수정됨: 중복 할당 오류 제거
  const [nicknameInput, setNicknameInput] = useState('');
  const [isRoomEntered, setIsRoomEntered] = useState(false);
  
  const [rpsTargetSelection, setRpsTargetSelection] = useState<CountryId[]>([]);
  const [tuvaluDonationTarget, setTuvaluDonationTarget] = useState<CountryId | null>(null);

  const [gameState, setGameState] = useState<GameState>({
    roomId: '',
    phase: 'LOBBY',
    turn: 1,
    temperature: INITIAL_TEMPERATURE,
    countries: JSON.parse(JSON.stringify(COUNTRIES)),
    logs: ['🌍 기후 위기 협상 게임에 오신 것을 환영합니다.'],
    timer: 0,
    currentQuizId: null,
    selectedQuizIds: [],
    customQuizzes: [],
    rpsTargetA: null,
    rpsTargetB: null,
    rpsChoiceA: null,
    rpsChoiceB: null,
    lastTurnChoices: {} as Record<CountryId, any>,
    activeEffects: {
      swedenWaiting: false,
      japanActive: false,
      denmarkTurnsLeft: 0,
      franceActive: false,
      brazilActive: false,
      tuvaluWaiting: false
    }
  });

  const processedActionIds = useRef<Set<string>>(new Set());

  // 사운드 재생 유틸리티
  const playSfx = (url: string) => {
    const audio = new Audio(url);
    audio.volume = 0.4;
    audio.play().catch(() => console.log("Sound interaction block")); 
  };

  // --- 실시간 동기화 (GUEST) ---
  useEffect(() => {
    if (isRoomEntered && role === 'GUEST') {
      const stopPolling = syncService.pollGameState(gameState.roomId, (newState) => {
        // 단계 변화 시 효과음
        if (newState.phase !== gameState.phase) playSfx(SFX.TRANSITION);
        // 기온 상승 시 경고음
        if (newState.temperature > gameState.temperature) playSfx(SFX.ALARM);
        
        setGameState(newState);
        
        // 재접속 핸들링
        if (!myCountryId && nicknameInput) {
          const recovered = (Object.values(newState.countries) as Country[]).find(c => c.isJoined && c.nickname === nicknameInput);
          if (recovered) setMyCountryId(recovered.id as CountryId);
        }
      });
      return () => stopPolling();
    }
  }, [isRoomEntered, role, gameState.roomId, nicknameInput, myCountryId, gameState.phase, gameState.temperature]);

  // --- 실시간 동기화 (HOST) ---
  useEffect(() => {
    if (isRoomEntered && role === 'HOST') {
      const stopActions = syncService.pollActions(gameState.roomId, (actions) => {
        actions.forEach(action => {
          if (!processedActionIds.current.has(action.id)) {
            processedActionIds.current.add(action.id);
            handleActionAsHost(action);
          }
        });
      });
      return () => stopActions();
    }
  }, [isRoomEntered, role, gameState.roomId]);

  const handleActionAsHost = (action: any) => {
    setGameState(prev => {
      const next = { ...prev };
      const cid = action.countryId as CountryId;

      switch (action.type) {
        case 'JOIN':
          if (next.countries[cid] && !next.countries[cid].isJoined) {
            next.countries[cid].isJoined = true;
            next.countries[cid].nickname = action.nickname;
            next.logs = [`${next.countries[cid].flag} ${action.nickname}(${next.countries[cid].name}) 입장 완료!`, ...next.logs];
            playSfx(SFX.JOIN);
          }
          break;
        case 'SELECT_DEVELOPMENT':
          if (next.countries[cid]) next.countries[cid].lastChoice = action.choice;
          break;
        case 'QUIZ_RESULT':
          if (!action.correct) {
            next.temperature += 0.1;
            next.logs = [`⚠️ ${next.countries[cid].nickname} 오답! 기온 +0.1℃`, ...next.logs];
            playSfx(SFX.ALARM);
          } else {
            next.logs = [`✅ ${next.countries[cid].nickname} 정답!`, ...next.logs];
            playSfx(SFX.SUCCESS);
            if (cid === 'USA') {
              next.temperature -= 0.5;
              next.logs = [`🛡️ 미국 CCS 기술 성공! 기온 -0.5℃`, ...next.logs];
            }
          }
          break;
        case 'ACTIVATE_ABILITY':
          processAbilityActivation(next, cid, action.data);
          playSfx(SFX.TRANSITION);
          break;
        case 'RPS_CHOICE':
          if (cid === next.rpsTargetA) next.rpsChoiceA = action.choice;
          if (cid === next.rpsTargetB) next.rpsChoiceB = action.choice;
          break;
      }
      syncService.syncGameState(next);
      return next;
    });
  };

  const processAbilityActivation = (state: GameState, cid: CountryId, data?: any) => {
    const country = state.countries[cid];
    state.countries[cid].isAbilityUsed = true;
    state.logs = [`🌟 ${country.nickname}의 [${country.abilityName}] 발동!`, ...state.logs];

    switch (cid) {
      case 'KOREA':
        state.rpsTargetA = data.targetA; state.rpsTargetB = data.targetB;
        break;
      case 'NKOREA':
        state.temperature += 1.0;
        state.logs = ["💣 북한의 핵 도발로 지구 온도가 1.0℃ 급상승했습니다!", ...state.logs];
        break;
      case 'SWEDEN': state.activeEffects.swedenWaiting = true; break;
      case 'JAPAN': state.activeEffects.japanActive = true; break;
      case 'DENMARK': state.activeEffects.denmarkTurnsLeft = 2; break;
      case 'FRANCE': state.activeEffects.franceActive = true; break;
      case 'BRAZIL': state.activeEffects.brazilActive = true; break;
      case 'TUVALU':
        state.countries[data.donorId as CountryId].gp -= 10;
        state.temperature -= 0.4;
        break;
    }
  };

  useEffect(() => {
    let interval: number;
    if (gameState.timer > 0) {
      interval = window.setInterval(() => {
        setGameState(prev => {
          const next = { ...prev, timer: prev.timer - 1 };
          if (role === 'HOST' && next.timer % 5 === 0) syncService.syncGameState(next);
          return next;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [gameState.timer, role]);

  const handleEnterRoom = (r: 'HOST' | 'GUEST') => {
    const rid = roomInput.trim().toUpperCase();
    if (!rid) return alert("방 코드를 입력하세요.");
    if (r === 'GUEST' && !nicknameInput.trim()) return alert("닉네임을 입력하세요.");
    
    playSfx(SFX.CLICK);
    setRole(r);
    setIsRoomEntered(true);
    
    if (r === 'HOST') {
      const initialState = { ...gameState, roomId: rid };
      setGameState(initialState);
      syncService.syncGameState(initialState);
      syncService.clearActions(rid);
    } else {
      setGameState(prev => ({ ...prev, roomId: rid }));
    }
  };

  const nextPhase = () => {
    playSfx(SFX.TRANSITION);
    setGameState(prev => {
      let next = { ...prev };
      const joined = (Object.values(next.countries) as Country[]).filter(c => c.isJoined);

      if (next.phase === 'DEVELOPMENT') {
        if (next.activeEffects.swedenWaiting) {
          if (joined.every(c => c.lastChoice === 'ENVIRONMENTAL')) {
            next.temperature -= 0.4;
            next.logs = ["🌿 전 국가 환경 보호 협조! 기온 -0.4℃", ...next.logs];
          }
          next.activeEffects.swedenWaiting = false;
        }
        joined.forEach(c => {
          let choice = c.lastChoice;
          if (next.activeEffects.brazilActive && c.id !== 'BRAZIL') {
            choice = choice === 'ECONOMIC' ? 'ENVIRONMENTAL' : choice === 'ENVIRONMENTAL' ? 'ECONOMIC' : choice;
          }
          if (choice === 'ECONOMIC') c.gp += 10;
          else if (choice === 'BALANCED') c.gp += 8;
          else if (choice === 'ENVIRONMENTAL') c.gp += 5;
        });
        next.activeEffects.japanActive = false;
        next.activeEffects.franceActive = false;
        next.activeEffects.brazilActive = false;
        if (next.activeEffects.denmarkTurnsLeft > 0) next.activeEffects.denmarkTurnsLeft--;
        
        next.phase = 'QUIZ'; next.timer = 60;
        next.currentQuizId = QUIZ_POOL[Math.floor(Math.random() * QUIZ_POOL.length)].id;
      } else if (next.phase === 'QUIZ') {
        next.phase = 'DISCUSSION'; next.timer = 180;
      } else if (next.phase === 'DISCUSSION') {
        if (next.turn === 4) { next.phase = 'UN_MEETING'; processUNMeeting(next); }
        else if (next.turn === MAX_TURNS || next.temperature >= MAX_TEMPERATURE) { 
          next.phase = 'END'; 
          playSfx(next.temperature >= 20 ? SFX.GAME_OVER : SFX.WIN);
        }
        else {
          next.turn += 1; next.phase = 'DEVELOPMENT'; next.timer = 30;
          Object.keys(next.countries).forEach(k => next.countries[k as CountryId].lastChoice = null);
        }
      } else if (next.phase === 'UN_MEETING') {
        next.turn += 1; next.phase = 'DEVELOPMENT'; next.timer = 30;
        Object.keys(next.countries).forEach(k => next.countries[k as CountryId].lastChoice = null);
      }
      
      syncService.syncGameState(next);
      return next;
    });
  };

  const processUNMeeting = (state: GameState) => {
    const joined = (Object.values(state.countries) as Country[]).filter(c => c.isJoined);
    const avgGP = joined.reduce((s, c) => s + c.gp, 0) / (joined.length || 1);
    if (avgGP > 50) { 
      state.temperature += 0.4; 
      state.logs = ["❌ UN 총회: 과잉 개발 경고! 기온 +0.4℃", ...state.logs]; 
      playSfx(SFX.ALARM); 
    } else { 
      state.temperature -= 0.3; 
      state.logs = ["✅ UN 총회: 지속 가능 발전 모범! 기온 -0.3℃", ...state.logs]; 
      playSfx(SFX.SUCCESS); 
    }
  };

  const confirmCountrySelection = () => {
    if (!pendingCountryId) return;
    playSfx(SFX.CLICK);
    syncService.sendAction(gameState.roomId, { 
      type: 'JOIN', 
      countryId: pendingCountryId, 
      nickname: nicknameInput 
    });
  };

  const addTime = (seconds: number) => {
    playSfx(SFX.CLICK);
    setGameState(prev => {
      const next = { ...prev, timer: prev.timer + seconds };
      if (role === 'HOST') syncService.syncGameState(next);
      return next;
    });
  };

  const useAbility = () => {
    if (!myCountryId) return;
    const country = gameState.countries[myCountryId];
    if (country.isAbilityUsed) return;

    // 기온 발동 조건 체크
    if (myCountryId === 'JAPAN' && gameState.temperature < 17) return alert("기온이 17도 이상이어야 발동할 수 있습니다.");
    if (myCountryId === 'DENMARK' && gameState.temperature < 17) return alert("기온이 17도 이상이어야 발동할 수 있습니다.");
    if (myCountryId === 'FRANCE' && gameState.temperature < 19) return alert("기온이 19도 이상이어야 발동할 수 있습니다.");
    if (myCountryId === 'TUVALU' && gameState.temperature < 18) return alert("기온이 18도 이상이어야 발동할 수 있습니다.");

    let data: any = {};
    if (myCountryId === 'KOREA') {
      if (rpsTargetSelection.length < 2) return alert("대결할 두 국가를 목록에서 선택하세요.");
      data = { targetA: rpsTargetSelection[0], targetB: rpsTargetSelection[1] };
    }
    if (myCountryId === 'TUVALU') {
      if (!tuvaluDonationTarget) return alert("기부할 국가를 목록에서 선택하세요.");
      data = { donorId: tuvaluDonationTarget };
    }

    playSfx(SFX.CLICK);
    syncService.sendAction(gameState.roomId, { 
      type: 'ACTIVATE_ABILITY', 
      countryId: myCountryId, 
      data 
    });
  };

  const handleCountryTargetClick = (targetId: CountryId) => {
    if (!myCountryId) return;
    playSfx(SFX.CLICK);
    if (myCountryId === 'KOREA') {
      setRpsTargetSelection(prev => {
        if (prev.includes(targetId)) return prev.filter(id => id !== targetId);
        if (prev.length < 2) return [...prev, targetId];
        return [prev[1], targetId];
      });
    } else if (myCountryId === 'TUVALU') {
      setTuvaluDonationTarget(targetId);
    }
  };

  const renderLobby = () => (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center animate-in fade-in duration-1000">
      <div className="mb-10">
        <i className="fa-solid fa-earth-asia text-9xl text-emerald-400 mb-6 drop-shadow-[0_0_40px_rgba(52,211,153,0.5)]"></i>
        <h1 className="text-7xl font-black tracking-tighter mb-2 italic">CLIMATE <span className="text-emerald-400">WAR</span></h1>
        <p className="text-xl text-slate-400 font-bold uppercase tracking-[0.3em]">Save the Earth Negotiation Game</p>
      </div>

      <div className="w-full max-w-sm space-y-4">
        {!role ? (
          <div className="space-y-4">
            <input type="text" placeholder="방 코드 (예: CLASS1)" value={roomInput} onChange={(e) => setRoomInput(e.target.value.toUpperCase())} className="w-full p-5 bg-white/5 border-2 border-white/10 rounded-3xl text-center text-3xl font-black outline-none focus:border-emerald-500 transition-all uppercase" />
            <input type="text" placeholder="내 닉네임" value={nicknameInput} onChange={(e) => setNicknameInput(e.target.value)} className="w-full p-4 bg-white/5 border border-white/10 rounded-2xl text-center text-xl font-bold outline-none" />
            <div className="grid grid-cols-2 gap-4">
              <button onClick={() => handleEnterRoom('HOST')} className="p-6 bg-emerald-600 hover:bg-emerald-500 rounded-3xl font-black text-xl shadow-xl transition-all">교사 입장</button>
              <button onClick={() => handleEnterRoom('GUEST')} className="p-6 bg-blue-600 hover:bg-blue-500 rounded-3xl font-black text-xl shadow-xl transition-all">학생 입장</button>
            </div>
          </div>
        ) : role === 'HOST' ? (
          <div className="mt-10 w-full max-w-5xl glass p-10 rounded-[3rem] border border-white/20 shadow-2xl">
            <h2 className="text-4xl font-black text-emerald-400 mb-8 tracking-tighter">방 생성 완료: #{gameState.roomId}</h2>
            <div className="grid grid-cols-3 md:grid-cols-5 gap-4 mb-10">
              {(Object.values(gameState.countries) as Country[]).map(c => (
                <div key={c.id} className={`p-4 rounded-2xl border-4 transition-all flex flex-col items-center ${c.isJoined ? 'bg-emerald-500/20 border-emerald-500 scale-105 shadow-lg' : 'bg-slate-800 border-white/5 opacity-40'}`}>
                  <span className="text-4xl">{c.flag}</span>
                  <span className="text-sm font-black truncate max-w-[80px] mt-2">{c.nickname || '-'}</span>
                </div>
              ))}
            </div>
            <button onClick={() => { playSfx(SFX.TRANSITION); const next = { ...gameState, phase: 'SETUP' as GamePhase }; setGameState(next); syncService.syncGameState(next); }} className="w-full p-8 bg-emerald-500 hover:bg-emerald-400 rounded-3xl font-black text-3xl shadow-xl transition-all">게임 설정 단계로 ▶</button>
          </div>
        ) : !myCountryId ? (
          <div className="mt-10 w-full max-w-5xl flex flex-col gap-8 animate-in slide-in-from-bottom-8">
            <div className="glass p-8 rounded-[3rem] border border-white/10 shadow-xl">
              <h2 className="text-2xl font-black mb-6 text-left px-4">🌍 대표 국가를 선택하세요</h2>
              <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-4">
                {(Object.values(gameState.countries) as Country[]).map(c => {
                  const isTaken = c.isJoined && c.nickname !== nicknameInput;
                  return (
                    <button 
                      key={c.id} 
                      disabled={isTaken}
                      onClick={() => { playSfx(SFX.CLICK); setPendingCountryId(c.id); }}
                      className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-1 ${pendingCountryId === c.id ? 'bg-blue-600 border-blue-400 scale-110 shadow-2xl z-10' : isTaken ? 'opacity-20 grayscale cursor-not-allowed border-transparent' : 'bg-slate-800 border-white/10 hover:border-white/40'}`}
                    >
                      <span className="text-4xl">{c.flag}</span>
                      <span className="text-[10px] font-black">{c.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={`glass p-10 rounded-[3rem] border-4 transition-all min-h-[380px] flex items-center justify-center shadow-2xl ${pendingCountryId ? 'border-blue-500/50 bg-blue-900/10' : 'border-white/5 opacity-30'}`}>
              {pendingCountryId ? (
                <div className="w-full max-w-2xl text-center space-y-6 animate-in zoom-in">
                  <span className="text-[120px] block drop-shadow-2xl">{gameState.countries[pendingCountryId].flag}</span>
                  <h3 className="text-6xl font-black tracking-tighter uppercase italic">{gameState.countries[pendingCountryId].name}</h3>
                  <div className="bg-black/40 p-10 rounded-[2.5rem] border border-white/10 text-left">
                    <div className="text-emerald-400 font-black text-sm uppercase mb-3 flex items-center gap-2"><i className="fa-solid fa-sparkles"></i> 고유 능력: {gameState.countries[pendingCountryId].abilityName}</div>
                    <p className="text-slate-300 text-xl font-medium leading-relaxed">{gameState.countries[pendingCountryId].abilityDesc}</p>
                  </div>
                  <button onClick={confirmCountrySelection} className="w-full p-8 bg-blue-600 hover:bg-blue-500 rounded-[2.5rem] font-black text-4xl shadow-2xl transition-all active:scale-95">국가 확정 및 입장</button>
                </div>
              ) : (
                <div className="text-slate-500 text-3xl font-black italic flex flex-col items-center gap-6">
                  <i className="fa-solid fa-hand-pointer text-7xl animate-bounce"></i>
                  <span>상단 보드에서 국가를 선택하세요</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-10 glass p-16 rounded-[4rem] border border-white/20 text-center animate-in zoom-in shadow-2xl">
             <span className="text-[140px] block mb-8 drop-shadow-2xl">{gameState.countries[myCountryId].flag}</span>
             <h2 className="text-6xl font-black mb-4 tracking-tighter italic">{gameState.countries[myCountryId].name} 대표부</h2>
             <p className="text-2xl text-slate-400 font-bold mb-12">교사가 게임을 시작할 때까지 잠시만 대기해 주세요.</p>
             <div className="w-32 h-32 border-[12px] border-emerald-400 border-t-transparent rounded-full animate-spin mx-auto shadow-[0_0_40px_rgba(52,211,153,0.3)]"></div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className={`min-h-screen transition-bg ${gameState.temperature >= 19 ? 'bg-red-950' : 'bg-slate-900'}`}>
      {gameState.phase === 'LOBBY' && renderLobby()}
      
      {gameState.phase === 'SETUP' && role === 'HOST' && (
        <div className="p-12 max-w-6xl mx-auto space-y-10 animate-in fade-in">
          <div className="flex justify-between items-end">
             <h2 className="text-6xl font-black italic tracking-tighter">⚙️ 퀴즈 뱅크 설정</h2>
             <button disabled={gameState.selectedQuizIds.length !== 8} onClick={() => { nextPhase(); }} className={`px-16 py-8 rounded-[2.5rem] font-black text-4xl shadow-2xl transition-all ${gameState.selectedQuizIds.length === 8 ? 'bg-emerald-500 hover:bg-emerald-400 shadow-[0_15px_40px_rgba(16,185,129,0.3)]' : 'bg-slate-700 opacity-50'}`}>게임 시작! ▶</button>
          </div>
          <div className="glass p-10 rounded-[3rem] border border-white/10 grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[600px] overflow-y-auto custom-scrollbar shadow-inner">
             {QUIZ_POOL.map(q => {
               const isSelected = gameState.selectedQuizIds.includes(q.id);
               return (<div key={q.id} onClick={() => { playSfx(SFX.CLICK); setGameState(prev => { const selected = prev.selectedQuizIds.includes(q.id) ? prev.selectedQuizIds.filter(id => id !== q.id) : prev.selectedQuizIds.length < 8 ? [...prev.selectedQuizIds, q.id] : prev.selectedQuizIds; return { ...prev, selectedQuizIds: selected }; }); }} className={`p-8 rounded-[2rem] cursor-pointer border-4 transition-all relative ${isSelected ? 'bg-emerald-500/20 border-emerald-500 shadow-lg scale-[1.02] z-10' : 'bg-white/5 border-transparent hover:bg-white/10'}`}><div className="font-black text-2xl pr-10">{q.question}</div>{isSelected && <i className="fa-solid fa-circle-check absolute top-8 right-8 text-emerald-400 text-2xl"></i>}</div>);
             })}
          </div>
        </div>
      )}

      {gameState.phase !== 'LOBBY' && gameState.phase !== 'SETUP' && gameState.phase !== 'END' && (
        <div className="max-w-[1400px] mx-auto p-4 md:p-8 space-y-8 animate-in slide-in-from-bottom-4">
          <div className="relative h-64 rounded-[3rem] overflow-hidden shadow-2xl border border-white/10">
            <div className={`absolute inset-0 bg-gradient-to-r from-emerald-600/80 to-transparent`}></div>
            <div className="absolute inset-0 flex items-center px-12 justify-between">
              <div className="flex items-center gap-8">
                <div className="w-24 h-24 bg-white/20 rounded-[2rem] flex items-center justify-center text-5xl shadow-2xl"><i className="fa-solid fa-earth-asia"></i></div>
                <h1 className="text-7xl font-black italic uppercase tracking-tighter drop-shadow-lg">{gameState.phase}</h1>
              </div>
              <div className="text-right">
                <div className="text-5xl font-black text-emerald-400 drop-shadow-md">TURN {gameState.turn} / {MAX_TURNS}</div>
                <div className={`text-6xl font-black mt-2 drop-shadow-md ${gameState.timer <= 10 ? 'text-red-500 animate-pulse' : 'text-white'}`}>{gameState.timer}s</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            <div className="lg:col-span-1 space-y-6">
              <TemperatureGauge temp={gameState.temperature} />
              <div className="glass p-8 rounded-[3rem] h-[500px] flex flex-col border border-white/10 shadow-2xl">
                 <h3 className="text-sm font-black uppercase opacity-40 mb-6 tracking-[0.2em] flex items-center gap-3"><i className="fa-solid fa-list-ul"></i> 상황 기록소</h3>
                 <div className="overflow-y-auto flex-1 space-y-3 pr-2 custom-scrollbar">
                    {gameState.logs.map((log, i) => (
                      <div key={i} className="text-base border-l-4 border-white/10 pl-4 py-2 font-semibold leading-relaxed animate-in slide-in-from-left-2">
                        <span className={log.includes('기온') ? 'text-red-400 font-black' : log.includes('UN') ? 'text-emerald-400' : ''}>{log}</span>
                      </div>
                    ))}
                 </div>
              </div>
            </div>

            <div className="lg:col-span-3">
              {role === 'HOST' ? (
                <div className="glass p-12 rounded-[4rem] border border-white/10 h-full flex flex-col shadow-2xl">
                  <div className="flex justify-between items-center mb-12">
                    <h2 className="text-5xl font-black tracking-tight uppercase italic flex items-center gap-4"><i className="fa-solid fa-tower-broadcast text-emerald-400"></i> 컨트롤 타워</h2>
                    <div className="flex gap-6">
                      <button onClick={() => addTime(10)} className="px-10 py-6 bg-amber-600 hover:bg-amber-500 rounded-[2rem] font-black text-2xl shadow-xl text-white active:scale-95 transition-all">+10초 연장</button>
                      <button onClick={nextPhase} className="px-16 py-6 bg-indigo-600 hover:bg-indigo-500 rounded-[2.5rem] font-black text-3xl shadow-2xl active:scale-95 transition-all">다음 단계로 이동 ▶</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-10 flex-1">
                     <div className="bg-black/20 p-10 rounded-[3rem] border border-white/5 overflow-y-auto max-h-[550px] custom-scrollbar shadow-inner">
                        <h3 className="text-2xl font-black mb-8 uppercase opacity-60 italic tracking-tighter">참가국 실시간 상태</h3>
                        <div className="space-y-4">
                           {(Object.values(gameState.countries) as Country[]).filter(c=>c.isJoined).map(c => (
                             <div key={c.id} className="flex justify-between items-center p-6 bg-white/5 rounded-[2rem] border border-white/5 shadow-md">
                               <div className="flex items-center gap-6"><span className="text-5xl">{c.flag}</span><span className="font-black text-2xl">{c.nickname}</span></div>
                               <div className="flex items-center gap-4">
                                 <span className="text-emerald-400 font-black text-2xl">GP {c.gp}</span>
                                 <span className={`px-6 py-2 rounded-full text-xs font-black uppercase tracking-widest ${c.lastChoice ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'}`}>{c.lastChoice ? '선택 완료' : '대기중'}</span>
                               </div>
                             </div>
                           ))}
                        </div>
                     </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-8 h-full">
                   {myCountryId && (
                     <div className="flex flex-col md:flex-row gap-8">
                       <div className="flex-1 glass p-10 rounded-[4rem] border border-white/10 bg-gradient-to-br from-blue-600/30 to-transparent flex justify-between items-center shadow-2xl">
                          <div className="flex items-center gap-10">
                             <span className="text-[120px] drop-shadow-2xl">{gameState.countries[myCountryId].flag}</span>
                             <div>
                                <h2 className="text-5xl font-black mb-2 tracking-tighter italic">{gameState.countries[myCountryId].nickname} <span className="text-lg opacity-40 font-bold not-italic">({gameState.countries[myCountryId].name})</span></h2>
                                <div className="flex gap-4"><span className="bg-emerald-500 text-slate-900 px-8 py-2 rounded-full font-black text-2xl shadow-xl">현재 GP: {gameState.countries[myCountryId].gp}</span></div>
                             </div>
                          </div>
                       </div>
                       <div className="flex-1 glass p-10 rounded-[4rem] border border-white/10 bg-gradient-to-br from-purple-600/30 to-transparent flex flex-col justify-center shadow-2xl">
                          <div className="flex justify-between items-center mb-4">
                            <h3 className="text-3xl font-black italic tracking-tighter"><i className="fa-solid fa-wand-magic-sparkles text-purple-400"></i> {gameState.countries[myCountryId].abilityName}</h3>
                            <button 
                              disabled={gameState.countries[myCountryId].isAbilityUsed} 
                              onClick={useAbility} 
                              className={`px-10 py-3 rounded-[2rem] font-black text-xl shadow-xl transition-all active:scale-95 ${gameState.countries[myCountryId].isAbilityUsed ? 'bg-slate-700 opacity-50 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-500 shadow-[0_10px_30px_rgba(147,51,234,0.3)]'}`}
                            >
                              스킬 발동
                            </button>
                          </div>
                          <p className="text-lg text-slate-200 leading-relaxed font-semibold">{gameState.countries[myCountryId].abilityDesc}</p>
                          {(myCountryId === 'KOREA' || myCountryId === 'TUVALU') && !gameState.countries[myCountryId].isAbilityUsed && (
                            <div className="mt-6 flex flex-wrap gap-3 border-t border-white/10 pt-6">
                              {(Object.values(gameState.countries) as Country[]).filter(c => c.isJoined && c.id !== myCountryId).map(c => (
                                <button 
                                  key={c.id} 
                                  onClick={() => handleCountryTargetClick(c.id as CountryId)}
                                  className={`px-5 py-2 rounded-xl border-2 text-sm font-black transition-all ${
                                    rpsTargetSelection.includes(c.id as CountryId) || tuvaluDonationTarget === c.id ? 'bg-blue-500 border-blue-400 text-white scale-110 shadow-lg' : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/30'
                                  }`}
                                >
                                  {c.flag} {c.nickname || c.name}
                                </button>
                              ))}
                            </div>
                          )}
                       </div>
                     </div>
                   )}

                   <div className="glass p-16 rounded-[5rem] border border-white/10 bg-slate-800/40 min-h-[500px] flex items-center justify-center shadow-2xl">
                     {myCountryId && gameState.phase === 'DEVELOPMENT' ? (
                         <div className="w-full text-center space-y-16 animate-in zoom-in">
                            <h3 className="text-6xl font-black italic tracking-tighter uppercase">개발 방향을 선택하세요</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                               {[
                                 { id: 'ECONOMIC', label: '경제 중심', icon: 'fa-industry', color: 'orange', gp: '+10' },
                                 { id: 'BALANCED', label: '지속 성장', icon: 'fa-scale-balanced', color: 'emerald', gp: '+8' },
                                 { id: 'ENVIRONMENTAL', label: '환경 우선', icon: 'fa-leaf', color: 'sky', gp: '+5' }
                               ].map(btn => (
                                 <button 
                                   key={btn.id} 
                                   onClick={() => { playSfx(SFX.CLICK); syncService.sendAction(gameState.roomId, { type: 'SELECT_DEVELOPMENT', countryId: myCountryId, choice: btn.id }); }} 
                                   className={`p-12 rounded-[4rem] border-4 transition-all group flex flex-col items-center shadow-xl ${gameState.countries[myCountryId].lastChoice === btn.id ? `bg-${btn.color}-600/40 border-${btn.color}-400 ring-[15px] ring-${btn.color}-500/20 scale-105 z-10` : 'bg-white/5 border-transparent hover:bg-white/10 hover:scale-105'}`}
                                 >
                                   <i className={`fa-solid ${btn.icon} text-7xl mb-10 text-${btn.color}-400 group-hover:scale-110 transition-transform`}></i>
                                   <span className="text-4xl font-black italic uppercase tracking-tighter mb-2">{btn.label}</span>
                                   <span className="text-xl font-bold opacity-60">GP {btn.gp} 획득</span>
                                 </button>
                               ))}
                            </div>
                         </div>
                     ) : (
                       <div className="text-center opacity-30 flex flex-col items-center gap-10">
                          <i className="fa-solid fa-hourglass-half text-[120px] animate-spin-slow"></i>
                          <h3 className="text-5xl font-black italic tracking-tighter">교사의 다음 지시를 기다리는 중...</h3>
                       </div>
                     )}
                   </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {gameState.phase === 'END' && (
        <div className="min-h-screen flex items-center justify-center p-8 bg-black/95 backdrop-blur-3xl animate-in fade-in duration-1000">
           <div className={`w-full max-w-6xl p-24 rounded-[6rem] border-[15px] text-center shadow-[0_0_120px_rgba(0,0,0,0.8)] ${gameState.temperature >= 20 ? 'border-red-600 bg-red-950/30' : 'border-emerald-500 bg-emerald-950/30'}`}>
              <h1 className="text-[140px] font-black mb-12 tracking-tighter uppercase italic leading-none drop-shadow-2xl">{gameState.temperature >= 20 ? 'Earth Perished' : 'Earth Saved'}</h1>
              <div className="text-6xl font-black mb-24 italic tracking-tighter">최종 기온: <span className={`px-12 py-3 rounded-[3rem] bg-black/40 ${gameState.temperature >= 20 ? 'text-red-500' : 'text-emerald-400'}`}>{gameState.temperature.toFixed(1)}℃</span></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
                 {(Object.values(gameState.countries) as Country[]).filter(c=>c.isJoined).sort((a,b)=>b.gp - a.gp).map((c, idx) => (
                   <div key={c.id} className="bg-white/5 p-12 rounded-[4rem] border border-white/10 flex justify-between items-center shadow-2xl hover:bg-white/10 transition-all group">
                      <div className="flex items-center gap-8">
                         <span className="text-5xl font-black text-slate-600 group-hover:text-white transition-colors">#{idx+1}</span>
                         <span className="text-8xl drop-shadow-xl">{c.flag}</span>
                         <div className="flex flex-col">
                           <span className="text-3xl font-black italic">{c.nickname}</span>
                           <span className="text-sm font-bold opacity-30 tracking-widest uppercase">{c.name}</span>
                         </div>
                      </div>
                      <div className="text-right">
                         <div className="text-5xl font-black text-emerald-400 tabular-nums">{c.gp} <span className="text-base opacity-40 uppercase tracking-tighter">GP</span></div>
                      </div>
                   </div>
                 ))}
              </div>
              <button onClick={() => window.location.reload()} className="mt-24 px-32 py-10 bg-white text-slate-900 rounded-full font-black text-5xl shadow-[0_30px_80px_rgba(255,255,255,0.2)] hover:scale-105 active:scale-95 transition-all tracking-tighter italic">RESTART GAME</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
