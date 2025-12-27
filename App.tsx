
import React, { useState, useEffect, useRef } from 'react';
import { GameState, GamePhase, CountryId, Country, QuizQuestion, RPSResult } from './types';
import { COUNTRIES, INITIAL_TEMPERATURE, MAX_TEMPERATURE, MAX_TURNS, QUIZ_POOL } from './constants';
import * as syncService from './services/syncService';
import TemperatureGauge from './components/TemperatureGauge';

const App: React.FC = () => {
  const [role, setRole] = useState<'HOST' | 'GUEST' | null>(null);
  const [myCountryId, setMyCountryId] = useState<CountryId | null>(null);
  const [roomInput, setRoomInput] = useState('');
  const [nicknameInput, setNicknameInput] = useState('');
  const [isRoomEntered, setIsRoomEntered] = useState(false);
  
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
  });

  const lastActionTimestamp = useRef<Record<string, number>>({});

  // --- 실시간 동기화 ---
  useEffect(() => {
    if (isRoomEntered && role === 'GUEST') {
      const stopPolling = syncService.pollGameState(gameState.roomId, (newState) => {
        setGameState(newState);
      });
      return () => stopPolling();
    }
  }, [isRoomEntered, role, gameState.roomId]);

  useEffect(() => {
    if (isRoomEntered && role === 'HOST') {
      const stopJoins = syncService.pollJoins(gameState.roomId, (countryId, nickname) => {
        setGameState(prev => {
          const cid = countryId as CountryId;
          // 이미 참가 중이고 닉네임도 같으면 무시 (재접속 허용을 위해 상태 업데이트는 필요할 수 있음)
          if (prev.countries[cid].isJoined && prev.countries[cid].nickname === nickname) return prev;
          
          const next = { ...prev };
          next.countries[cid].isJoined = true;
          next.countries[cid].nickname = nickname;
          next.logs = [`${next.countries[cid].flag} ${nickname}(${next.countries[cid].name}) 대표가 입장했습니다.`, ...next.logs];
          syncService.syncGameState(next);
          return next;
        });
      });

      const stopActions = syncService.pollActions(gameState.roomId, (action) => {
        if (action.timestamp <= (lastActionTimestamp.current[action.countryId] || 0)) return;
        lastActionTimestamp.current[action.countryId] = action.timestamp;
        handleActionAsHost(action);
      });

      return () => {
        stopJoins();
        stopActions();
      };
    }
  }, [isRoomEntered, role, gameState.roomId]);

  const handleActionAsHost = (action: any) => {
    setGameState(prev => {
      const next = { ...prev };
      const cid = action.countryId as CountryId;
      switch (action.type) {
        case 'SELECT_DEVELOPMENT':
          next.countries[cid].lastChoice = action.choice;
          break;
        case 'QUIZ_RESULT':
          if (!action.correct) {
            next.temperature += 0.1;
            next.logs = [`⚠️ ${next.countries[cid].nickname} 오답! 기온 +0.1℃`, ...next.logs];
          } else if (cid === 'USA') {
            next.temperature -= 0.5;
            next.logs = [`🛡️ 미국(${next.countries[cid].nickname}) CCS 기술 성공! 기온 -0.5℃`, ...next.logs];
          }
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

  // --- 호스트 로직 ---
  const handleEnterRoom = (r: 'HOST' | 'GUEST') => {
    if (!roomInput.trim()) return alert("방 코드를 입력하세요.");
    if (r === 'GUEST' && !nicknameInput.trim()) return alert("닉네임을 입력하세요.");
    setRole(r);
    setGameState(prev => ({ ...prev, roomId: roomInput }));
    setIsRoomEntered(true);
    if (r === 'HOST') syncService.syncGameState({ ...gameState, roomId: roomInput });
  };

  const nextPhase = () => {
    setGameState(prev => {
      let next = { ...prev };
      if (next.phase === 'DEVELOPMENT') {
        Object.keys(next.countries).forEach(id => {
          const c = next.countries[id as CountryId];
          if (c.lastChoice === 'ECONOMIC') c.gp += 10;
          else if (c.lastChoice === 'BALANCED') c.gp += 8;
          else if (c.lastChoice === 'ENVIRONMENTAL') c.gp += 5;
        });
        next.phase = 'QUIZ';
        next.timer = 60;
        const pool = [...QUIZ_POOL, ...next.customQuizzes].filter(q => next.selectedQuizIds.includes(q.id));
        next.currentQuizId = pool[Math.floor(Math.random() * pool.length)]?.id || QUIZ_POOL[0].id;
      } else if (next.phase === 'QUIZ') {
        next.phase = 'DISCUSSION';
        next.timer = 180;
      } else if (next.phase === 'DISCUSSION') {
        if (next.turn === 4) {
          next.phase = 'UN_MEETING';
          processUNMeeting(next);
        } else if (next.turn === MAX_TURNS || next.temperature >= MAX_TEMPERATURE) {
          next.phase = 'END';
          calculateFinalScores(next);
        } else {
          next.turn += 1;
          next.phase = 'DEVELOPMENT';
          next.timer = 30;
          Object.keys(next.countries).forEach(k => next.countries[k as CountryId].lastChoice = null);
        }
      } else if (next.phase === 'UN_MEETING') {
        next.turn += 1;
        next.phase = 'DEVELOPMENT';
        next.timer = 30;
        Object.keys(next.countries).forEach(k => next.countries[k as CountryId].lastChoice = null);
      }
      syncService.syncGameState(next);
      return next;
    });
  };

  const processUNMeeting = (state: GameState) => {
    const joinedCountries = (Object.values(state.countries) as Country[]).filter(c => c.isJoined);
    const totalGP = joinedCountries.reduce((sum, c) => sum + c.gp, 0);
    const avgGP = totalGP / joinedCountries.length;

    // 기온 영향 (예시 로직)
    if (avgGP > 55) {
      state.temperature += 0.5;
      state.logs = ["📢 [UN 보고] 전 세계적 과잉 개발로 기온이 급상승합니다! (+0.5℃)", ...state.logs];
    } else if (avgGP < 45) {
      state.temperature -= 0.3;
      state.logs = ["📢 [UN 보고] 전 세계의 환경 보호 노력으로 기온이 하락합니다! (-0.3℃)", ...state.logs];
    }

    // 개별 국가 평가
    joinedCountries.forEach(c => {
      if (c.gp <= 45) {
        state.logs = [`🌿 [지속가능] ${c.nickname}(${c.name})는 환경 보호의 귀감입니다.`, ...state.logs];
      } else if (c.gp >= 55) {
        state.logs = [`⚠️ [환경파괴] ${c.nickname}(${c.name})는 과도한 개발로 비난받습니다. GP 3 차감.`, ...state.logs];
        state.countries[c.id].gp -= 3;
      }
    });
  };

  const calculateFinalScores = (state: GameState) => {
    const sorted = (Object.values(state.countries) as Country[])
      .filter(c => c.isJoined)
      .sort((a, b) => b.gp - a.gp);
    sorted.forEach((c, idx) => {
      state.countries[c.id].score = Math.max(0, 100 - (idx * 10));
    });
  };

  // --- 가위바위보 대결 시작 (Added handleRPS) ---
  const handleRPS = (targetA: CountryId, targetB: CountryId) => {
    setGameState(prev => {
      const next = { ...prev, rpsTargetA: targetA, rpsTargetB: targetB, rpsChoiceA: null, rpsChoiceB: null };
      next.logs = [`⚔️ 가위바위보 대결 시작! (${next.countries[targetA].name} vs ${next.countries[targetB].name})`, ...next.logs];
      syncService.syncGameState(next);
      return next;
    });
  };

  // --- 가위바위보 판정 (useEffect) ---
  useEffect(() => {
    if (role === 'HOST' && gameState.rpsChoiceA && gameState.rpsChoiceB) {
      const a = gameState.rpsChoiceA;
      const b = gameState.rpsChoiceB;
      const targetA = gameState.rpsTargetA!;
      const targetB = gameState.rpsTargetB!;
      
      let winId: CountryId | null = null;
      if (a !== b) {
        if ((a === 'ROCK' && b === 'SCISSORS') || (a === 'PAPER' && b === 'ROCK') || (a === 'SCISSORS' && b === 'PAPER')) winId = targetA;
        else winId = targetB;
      }

      setGameState(prev => {
        const next = { ...prev };
        if (winId) {
          const loseId = winId === targetA ? targetB : targetA;
          next.countries[loseId].gp -= 5;
          next.temperature -= 0.3;
          next.logs = [`🏆 ${next.countries[winId].nickname} 승리! 기온 -0.3℃`, ...next.logs];
        } else {
          next.logs = [`🤝 가위바위보 무승부!`, ...next.logs];
        }
        next.rpsTargetA = null; next.rpsTargetB = null; next.rpsChoiceA = null; next.rpsChoiceB = null;
        syncService.syncGameState(next);
        return next;
      });
    }
  }, [gameState.rpsChoiceA, gameState.rpsChoiceB, role]);

  // --- UI ---
  const renderLobby = () => (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center">
      <div className="mb-10">
        <i className="fa-solid fa-earth-asia text-9xl text-emerald-400 mb-6 drop-shadow-[0_0_40px_rgba(52,211,153,0.5)]"></i>
        <h1 className="text-7xl font-black tracking-tighter mb-2 italic">CLIMATE <span className="text-emerald-400">WAR</span></h1>
        <p className="text-xl text-slate-400 font-bold uppercase tracking-[0.3em]">Save the Earth together</p>
      </div>

      <div className="w-full max-w-sm space-y-4">
        <input 
          type="text" placeholder="방 코드 (예: CLASS1)" value={roomInput}
          onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
          className="w-full p-5 bg-white/5 border-2 border-white/10 rounded-3xl text-center text-3xl font-black outline-none focus:border-emerald-500 transition-all"
        />
        {!role && (
          <div className="space-y-4">
            <input 
              type="text" placeholder="내 닉네임" value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              className="w-full p-4 bg-white/5 border border-white/10 rounded-2xl text-center text-xl font-bold outline-none"
            />
            <div className="grid grid-cols-2 gap-4">
              <button onClick={() => handleEnterRoom('HOST')} className="p-6 bg-emerald-600 hover:bg-emerald-500 rounded-3xl font-black text-xl shadow-xl">교사 입장</button>
              <button onClick={() => handleEnterRoom('GUEST')} className="p-6 bg-blue-600 hover:bg-blue-500 rounded-3xl font-black text-xl shadow-xl">학생 입장</button>
            </div>
          </div>
        )}
      </div>

      {role === 'HOST' && isRoomEntered && (
        <div className="mt-10 w-full max-w-4xl glass p-10 rounded-[3rem] border border-white/20">
          <h2 className="text-4xl font-black mb-10 text-emerald-400">Room #{gameState.roomId}</h2>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-4 mb-10">
            {(Object.values(gameState.countries) as Country[]).map(c => (
              <div key={c.id} className={`p-4 rounded-2xl border-2 transition-all ${c.isJoined ? 'bg-emerald-500/20 border-emerald-500' : 'bg-slate-800 border-transparent opacity-30'}`}>
                <span className="text-3xl block">{c.flag}</span>
                <span className="text-xs font-black truncate">{c.nickname || c.name}</span>
              </div>
            ))}
          </div>
          <button onClick={() => setGameState(prev => ({ ...prev, phase: 'SETUP' }))} className="w-full p-6 bg-emerald-500 rounded-3xl font-black text-2xl">게임 설정하기</button>
        </div>
      )}

      {role === 'GUEST' && isRoomEntered && (
        <div className="mt-10 w-full max-w-6xl glass p-10 rounded-[4rem] border border-white/20">
          <h2 className="text-3xl font-black mb-8">국가를 선택하세요 (닉네임: {nicknameInput})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(Object.values(gameState.countries) as Country[]).map(c => {
              const isTakenByOther = c.isJoined && c.nickname !== nicknameInput;
              const isMine = c.isJoined && c.nickname === nicknameInput;
              return (
                <button 
                  key={c.id} disabled={isTakenByOther}
                  onClick={() => { setMyCountryId(c.id); syncService.joinRoom(gameState.roomId, c.id, nicknameInput); }}
                  className={`relative p-6 rounded-[2rem] text-left border-4 transition-all ${isMine ? 'bg-blue-600/30 border-blue-400 ring-4' : isTakenByOther ? 'opacity-20 grayscale' : 'bg-slate-800 border-white/5 hover:border-white/30'}`}
                >
                  <div className="flex items-center gap-4 mb-2">
                    <span className="text-5xl">{c.flag}</span>
                    <span className="text-xl font-black">{c.name}</span>
                  </div>
                  <p className="text-xs text-slate-400">{c.abilityDesc}</p>
                  {isMine && <div className="absolute top-2 right-4 text-xs font-black text-blue-400">선택됨</div>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  const phaseAssets = role ? (gameState.phase === 'DEVELOPMENT' ? { title: "경제 개발", icon: "fa-industry", img: "https://images.unsplash.com/photo-1516937941344-00b4e0337589?w=1200", color: "from-orange-600" } :
    gameState.phase === 'QUIZ' ? { title: "환경 퀴즈", icon: "fa-brain", img: "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=1200", color: "from-blue-600" } :
    gameState.phase === 'DISCUSSION' ? { title: "자유 토론", icon: "fa-handshake", img: "https://images.unsplash.com/photo-1521791136064-7986c2920216?w=1200", color: "from-indigo-600" } :
    gameState.phase === 'UN_MEETING' ? { title: "UN 기후 총회", icon: "fa-building-columns", img: "https://images.unsplash.com/photo-1541873676946-8412460408c2?w=1200", color: "from-emerald-600" } : null) : null;

  return (
    <div className={`min-h-screen transition-bg ${gameState.temperature >= 19 ? 'bg-red-950' : 'bg-slate-900'}`}>
      {gameState.phase === 'LOBBY' && renderLobby()}
      
      {gameState.phase === 'SETUP' && role === 'HOST' && (
        <div className="p-12 max-w-5xl mx-auto space-y-10">
          <div className="flex justify-between items-center">
             <h2 className="text-5xl font-black">⚙️ 퀴즈 뱅크 설정</h2>
             <button onClick={() => {
               const next = { ...gameState, phase: 'DEVELOPMENT' as GamePhase, timer: 30 };
               setGameState(next); syncService.syncGameState(next);
             }} className="px-12 py-5 bg-emerald-500 rounded-3xl font-black text-2xl shadow-xl">게임 시작! ▶</button>
          </div>
          <div className="glass p-10 rounded-[3rem] max-h-[600px] overflow-y-auto custom-scrollbar space-y-4">
             {QUIZ_POOL.map(q => (
               <div key={q.id} onClick={() => {
                 setGameState(prev => {
                   const selected = prev.selectedQuizIds.includes(q.id) ? prev.selectedQuizIds.filter(id => id !== q.id) : [...prev.selectedQuizIds, q.id];
                   return { ...prev, selectedQuizIds: selected };
                 });
               }} className={`p-6 rounded-2xl cursor-pointer border-4 transition-all ${gameState.selectedQuizIds.includes(q.id) ? 'bg-emerald-500/20 border-emerald-500' : 'bg-white/5 border-transparent'}`}>
                  <div className="font-black text-xl">{q.question}</div>
               </div>
             ))}
          </div>
        </div>
      )}

      {gameState.phase !== 'LOBBY' && gameState.phase !== 'SETUP' && gameState.phase !== 'END' && (
        <div className="max-w-[1400px] mx-auto p-4 md:p-8 space-y-8">
          {phaseAssets && (
            <div className="relative h-64 rounded-[3rem] overflow-hidden shadow-2xl border border-white/10">
              <img src={phaseAssets.img} className="absolute inset-0 w-full h-full object-cover opacity-20" />
              <div className={`absolute inset-0 bg-gradient-to-r ${phaseAssets.color}/60 to-transparent`}></div>
              <div className="absolute inset-0 flex items-center px-12">
                <div className="w-20 h-20 bg-white/20 rounded-2xl flex items-center justify-center text-4xl mr-6"><i className={`fa-solid ${phaseAssets.icon}`}></i></div>
                <h1 className="text-6xl font-black italic uppercase tracking-tighter">{phaseAssets.title}</h1>
              </div>
              <div className="absolute top-8 right-12 text-right">
                <div className="text-4xl font-black text-emerald-400">TURN {gameState.turn} <span className="text-lg opacity-40">/ {MAX_TURNS}</span></div>
                <div className={`text-5xl font-black mt-2 ${gameState.timer <= 10 ? 'text-red-500 animate-pulse' : ''}`}>{gameState.timer}s</div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            <div className="lg:col-span-1 space-y-6">
              <TemperatureGauge temp={gameState.temperature} />
              <div className="glass p-6 rounded-[2.5rem] h-96 flex flex-col border border-white/10">
                 <h3 className="text-xs font-black uppercase opacity-40 mb-4 tracking-widest">Global Status Log</h3>
                 <div className="overflow-y-auto flex-1 space-y-2 pr-2 custom-scrollbar">
                    {gameState.logs.map((log, i) => (
                      <div key={i} className="text-sm border-l-2 border-white/10 pl-3 py-1 font-medium leading-relaxed">
                        <span className={log.includes('기온') ? 'text-red-400 font-bold' : log.includes('[UN') ? 'text-emerald-400' : ''}>{log}</span>
                      </div>
                    ))}
                 </div>
              </div>
            </div>

            <div className="lg:col-span-3">
              {role === 'HOST' ? (
                <div className="glass p-10 rounded-[3rem] border border-white/10 h-full flex flex-col">
                  <div className="flex justify-between items-center mb-10">
                    <h2 className="text-4xl font-black tracking-tight">CONTROL TOWER</h2>
                    <button onClick={nextPhase} className="px-12 py-5 bg-indigo-600 hover:bg-indigo-500 rounded-3xl font-black text-xl shadow-2xl transition-all">다음 단계로 이동 ▶</button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 flex-1">
                     <div className="bg-black/20 p-8 rounded-[2.5rem] border border-white/5 overflow-y-auto max-h-[400px]">
                        <h3 className="text-xl font-black mb-6 uppercase opacity-60">Delegation Status</h3>
                        <div className="space-y-3">
                           {(Object.values(gameState.countries) as Country[]).filter(c=>c.isJoined).map(c => (
                             <div key={c.id} className="flex justify-between items-center p-4 bg-white/5 rounded-2xl">
                               <span className="font-bold text-lg">{c.flag} {c.nickname}</span>
                               <span className={`px-4 py-1 rounded-full text-xs font-black ${c.lastChoice ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'}`}>{c.lastChoice ? '제출 완료' : '미제출'}</span>
                             </div>
                           ))}
                        </div>
                     </div>
                     <div className="bg-black/20 p-8 rounded-[2.5rem] border border-white/5">
                        <h3 className="text-xl font-black mb-6 uppercase opacity-60">Abilities</h3>
                        <div className="grid grid-cols-1 gap-4">
                           <button onClick={() => handleRPS('KOREA', 'USA')} className="p-5 bg-indigo-600/30 hover:bg-indigo-600 rounded-2xl font-black flex justify-between items-center"><span>한-미 가위바위보 대결</span><i className="fa-solid fa-swords"></i></button>
                           <button onClick={() => {
                             setGameState(prev => {
                               const next = { ...prev, temperature: prev.temperature + 1.0 };
                               next.logs = ["📢 북한: 내래 핵 쏜다우! 기온 +1.0℃", ...next.logs];
                               syncService.syncGameState(next); return next;
                             });
                           }} className="p-5 bg-red-600/30 hover:bg-red-600 rounded-2xl font-black flex justify-between items-center"><span>북한 핵 도발</span><i className="fa-solid fa-radiation"></i></button>
                        </div>
                     </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-8 h-full">
                   {myCountryId && (
                     <div className="glass p-8 rounded-[3rem] border border-white/10 bg-gradient-to-br from-blue-600/20 to-transparent flex justify-between items-center">
                        <div className="flex items-center gap-8">
                           <span className="text-8xl drop-shadow-2xl">{gameState.countries[myCountryId].flag}</span>
                           <div>
                              <h2 className="text-4xl font-black mb-1">{gameState.countries[myCountryId].nickname} <span className="text-sm opacity-40 font-bold">({gameState.countries[myCountryId].name})</span></h2>
                              <div className="flex gap-3">
                                 <span className="bg-emerald-500 text-slate-900 px-4 py-1 rounded-full font-black text-lg">GP: {gameState.countries[myCountryId].gp}</span>
                                 <span className="bg-slate-700 text-white px-4 py-1 rounded-full font-black text-lg">{gameState.countries[myCountryId].abilityName}</span>
                              </div>
                           </div>
                        </div>
                     </div>
                   )}
                   <div className="glass p-12 rounded-[4rem] border border-white/10 bg-slate-800/40 min-h-[450px] flex items-center justify-center">
                     {myCountryId ? (
                       gameState.phase === 'DEVELOPMENT' ? (
                         <div className="w-full text-center space-y-12">
                            <h3 className="text-4xl font-black">개발 방향을 결정하세요</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                               {[
                                 { id: 'ECONOMIC', label: '경제 중심', icon: 'fa-industry', gp: '+10', color: 'orange' },
                                 { id: 'BALANCED', label: '지속 성장', icon: 'fa-scale-balanced', gp: '+8', color: 'emerald' },
                                 { id: 'ENVIRONMENTAL', label: '환경 우선', icon: 'fa-leaf', gp: '+5', color: 'sky' }
                               ].map(btn => (
                                 <button key={btn.id} onClick={() => syncService.sendAction(gameState.roomId, { type: 'SELECT_DEVELOPMENT', countryId: myCountryId, choice: btn.id })} className={`p-8 rounded-[2.5rem] border-4 transition-all group flex flex-col items-center ${gameState.countries[myCountryId].lastChoice === btn.id ? `bg-${btn.color}-600/40 border-${btn.color}-400 ring-8 ring-${btn.color}-500/10 scale-105` : 'bg-white/5 border-transparent hover:bg-white/10'}`}>
                                   <i className={`fa-solid ${btn.icon} text-5xl mb-6 text-${btn.color}-400 group-hover:scale-110 transition-transform`}></i>
                                   <span className="text-2xl font-black mb-1">{btn.label}</span>
                                   <span className="text-sm font-bold opacity-40">GP {btn.gp}</span>
                                 </button>
                               ))}
                            </div>
                         </div>
                       ) : gameState.phase === 'QUIZ' ? (
                        <div className="w-full max-w-2xl space-y-8 text-center">
                           <h3 className="text-4xl font-black italic">CLIMATE QUIZ</h3>
                           {gameState.currentQuizId && (() => {
                             const quiz = [...QUIZ_POOL, ...gameState.customQuizzes].find(q => q.id === gameState.currentQuizId);
                             return quiz ? (
                               <div className="space-y-8">
                                 <div className="p-10 bg-black/40 rounded-[2.5rem] text-2xl font-black border border-white/5 leading-relaxed">{quiz.question}</div>
                                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                   {quiz.options.map((opt, i) => (
                                     <button key={i} onClick={() => syncService.sendAction(gameState.roomId, { type: 'QUIZ_RESULT', countryId: myCountryId, correct: i === quiz.answer })} className="p-6 bg-slate-700 hover:bg-slate-600 rounded-[1.5rem] text-left font-black transition-all border border-white/5"><span className="text-blue-400 mr-4">{i+1}.</span> {opt}</button>
                                   ))}
                                 </div>
                               </div>
                             ) : null;
                           })()}
                        </div>
                       ) : gameState.rpsTargetA === myCountryId || gameState.rpsTargetB === myCountryId ? (
                         <div className="w-full text-center space-y-10">
                            <h3 className="text-4xl font-black text-red-500 animate-pulse uppercase">가위바위보 대결!</h3>
                            <div className="grid grid-cols-3 gap-6 max-w-lg mx-auto">
                               {[
                                 { id: 'ROCK', icon: 'fa-hand-back-fist', label: '바위' },
                                 { id: 'PAPER', icon: 'fa-hand', label: '보' },
                                 { id: 'SCISSORS', icon: 'fa-hand-scissors', label: '가위' }
                               ].map(item => (
                                 <button key={item.id} onClick={() => syncService.sendAction(gameState.roomId, { type: 'RPS_CHOICE', countryId: myCountryId, choice: item.id })} className="p-8 bg-indigo-600 hover:bg-indigo-500 rounded-3xl transition-all active:scale-95 flex flex-col items-center">
                                    <i className={`fa-solid ${item.icon} text-4xl mb-4`}></i>
                                    <span className="font-black">{item.label}</span>
                                 </button>
                               ))}
                            </div>
                         </div>
                       ) : (
                         <div className="text-center opacity-20">
                            <i className="fa-solid fa-hourglass-half text-9xl mb-6"></i>
                            <h3 className="text-4xl font-black uppercase">Please Wait...</h3>
                         </div>
                       )
                     ) : <div className="text-2xl font-black text-red-500">먼저 국가를 선택해야 합니다.</div>}
                   </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {gameState.phase === 'END' && (
        <div className="min-h-screen flex items-center justify-center p-8 bg-black/90 backdrop-blur-3xl">
           <div className={`w-full max-w-5xl p-16 rounded-[4rem] border-8 text-center ${gameState.temperature >= 20 ? 'border-red-600 bg-red-950/20' : 'border-emerald-500 bg-emerald-950/20'}`}>
              <h1 className="text-9xl font-black mb-10 tracking-tighter uppercase">{gameState.temperature >= 20 ? 'Game Over' : 'Earth Saved'}</h1>
              <div className="text-4xl font-black mb-16">Final Temperature: <span className={gameState.temperature >= 20 ? 'text-red-500' : 'text-emerald-400'}>{gameState.temperature.toFixed(1)}℃</span></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
                 {(Object.values(gameState.countries) as Country[]).filter(c=>c.isJoined).sort((a,b)=>b.gp - a.gp).map((c, idx) => (
                   <div key={c.id} className="bg-white/5 p-8 rounded-[2.5rem] border border-white/10 flex justify-between items-center">
                      <div className="flex items-center gap-6">
                         <span className="text-3xl font-black text-slate-500">#{idx+1}</span>
                         <span className="text-5xl">{c.flag}</span>
                         <span className="text-xl font-black">{c.nickname}</span>
                      </div>
                      <div className="text-right">
                         <div className="text-3xl font-black text-emerald-400">{c.gp} <span className="text-sm opacity-40 uppercase">GP</span></div>
                         <div className="text-xs font-bold opacity-30">{c.score} Coins Earned</div>
                      </div>
                   </div>
                 ))}
              </div>
              <button onClick={() => window.location.reload()} className="mt-16 px-16 py-6 bg-white text-slate-900 rounded-full font-black text-3xl shadow-2xl hover:scale-105 transition-all">RESTART GAME</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
