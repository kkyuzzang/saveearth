
import React, { useState, useEffect, useRef } from 'react';
import { GameState, GamePhase, CountryId, Country, QuizQuestion } from './types.ts';
import { COUNTRIES, INITIAL_TEMPERATURE, MAX_TEMPERATURE, MAX_TURNS, QUIZ_POOL } from './constants.ts';
import * as syncService from './services/syncService.ts';
import TemperatureGauge from './components/TemperatureGauge.tsx';

const App: React.FC = () => {
  const [role, setRole] = useState<'HOST' | 'GUEST' | null>(null);
  const [myCountryId, setMyCountryId] = useState<CountryId | null>(null);
  const [pendingCountryId, setPendingCountryId] = useState<CountryId | null>(null);
  const [roomInput, setRoomInput] = useState('');
  const [nicknameInput, setNicknameInput] = useState('');
  const [isRoomEntered, setIsRoomEntered] = useState(false);
  
  // Ability UI states
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

  const lastActionTimestamp = useRef<Record<string, number>>({});

  // --- 실시간 동기화 (GUEST 전용: 상태 받아오기) ---
  useEffect(() => {
    if (isRoomEntered && role === 'GUEST') {
      const stopPolling = syncService.pollGameState(gameState.roomId, (newState) => {
        setGameState(newState);
        // 내 닉네임으로 등록된 국가가 있으면 자동 매칭 (재접속 대응)
        if (!myCountryId && nicknameInput) {
          const recovered = (Object.values(newState.countries) as Country[]).find(c => c.isJoined && c.nickname === nicknameInput);
          if (recovered) setMyCountryId(recovered.id as CountryId);
        }
      });
      return () => stopPolling();
    }
  }, [isRoomEntered, role, gameState.roomId, nicknameInput, myCountryId]);

  // --- 실시간 동기화 (HOST 전용: 입장 확인 및 액션 처리) ---
  useEffect(() => {
    if (isRoomEntered && role === 'HOST') {
      const stopJoins = syncService.pollJoins(gameState.roomId, (countryId, nickname) => {
        setGameState(prev => {
          const cid = countryId as CountryId;
          if (prev.countries[cid].isJoined && prev.countries[cid].nickname === nickname) return prev;
          
          const next = { ...prev };
          next.countries[cid].isJoined = true;
          next.countries[cid].nickname = nickname;
          next.logs = [`${next.countries[cid].flag} ${nickname}(${next.countries[cid].name}) 대표가 입장했습니다.`, ...next.logs];
          
          syncService.syncGameState(next); // 교사가 입장 정보를 즉시 서버에 반영
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
      if (!next.countries[cid]) return prev;

      switch (action.type) {
        case 'SELECT_DEVELOPMENT':
          next.countries[cid].lastChoice = action.choice;
          break;
        case 'QUIZ_RESULT':
          if (!action.correct) {
            next.temperature += 0.1;
            next.logs = [`⚠️ ${next.countries[cid].nickname} 오답! 기온 +0.1℃`, ...next.logs];
          } else {
            if (cid === 'USA') {
              next.temperature -= 0.5;
              next.logs = [`🛡️ 미국(${next.countries[cid].nickname}) CCS 기술 성공! 기온 -0.5℃`, ...next.logs];
            } else {
              next.logs = [`✅ ${next.countries[cid].nickname} 정답! (기온 유지)`, ...next.logs];
            }
          }
          break;
        case 'ACTIVATE_ABILITY':
          processAbilityActivation(next, cid, action.data);
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
    state.logs = [`🌟 ${country.nickname}(${country.name})가 스킬 [${country.abilityName}]을 사용했습니다!`, ...state.logs];

    switch (cid) {
      case 'KOREA':
        state.rpsTargetA = data.targetA;
        state.rpsTargetB = data.targetB;
        break;
      case 'NKOREA':
        state.temperature += 1.0;
        state.logs = ["💣 북한의 핵 도발로 지구 온도가 1.0℃ 상승했습니다!", ...state.logs];
        break;
      case 'SWEDEN':
        state.activeEffects.swedenWaiting = true;
        break;
      case 'JAPAN':
        state.activeEffects.japanActive = true;
        break;
      case 'DENMARK':
        state.activeEffects.denmarkTurnsLeft = 2;
        break;
      case 'FRANCE':
        state.activeEffects.franceActive = true;
        break;
      case 'BRAZIL':
        state.activeEffects.brazilActive = true;
        break;
      case 'TUVALU':
        const donorId = data.donorId as CountryId;
        state.countries[donorId].gp -= 10;
        state.temperature -= 0.4;
        state.logs = [`🤝 ${state.countries[donorId].nickname}의 기부로 투발루의 위기가 완화되었습니다. 기온 -0.4℃`, ...state.logs];
        break;
    }
  };

  useEffect(() => {
    let interval: number;
    if (gameState.timer > 0) {
      interval = window.setInterval(() => {
        setGameState(prev => {
          const next = { ...prev, timer: prev.timer - 1 };
          if (role === 'HOST' && next.timer % 3 === 0) syncService.syncGameState(next);
          return next;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [gameState.timer, role]);

  const addTime = (seconds: number) => {
    setGameState(prev => {
      const next = { ...prev, timer: prev.timer + seconds };
      syncService.syncGameState(next);
      return next;
    });
  };

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
      const joinedCountries = (Object.values(next.countries) as Country[]).filter(c => c.isJoined);

      if (next.phase === 'DEVELOPMENT') {
        if (next.activeEffects.swedenWaiting) {
          const allEnv = joinedCountries.every(c => c.lastChoice === 'ENVIRONMENTAL');
          if (allEnv) {
            next.temperature -= 0.4;
            next.logs = ["🌿 전 국가 환경 보호 동참! 스웨덴의 인류애가 빛납니다. 기온 -0.4℃", ...next.logs];
          }
          next.activeEffects.swedenWaiting = false;
        }
        const choicesSnapshot = {} as any;
        joinedCountries.forEach(c => choicesSnapshot[c.id] = c.lastChoice);
        next.lastTurnChoices = choicesSnapshot;

        joinedCountries.forEach(c => {
          let choice = c.lastChoice;
          if (next.activeEffects.brazilActive && c.id !== 'BRAZIL') {
            if (choice === 'ECONOMIC') choice = 'ENVIRONMENTAL';
            else if (choice === 'ENVIRONMENTAL') choice = 'ECONOMIC';
          }
          if (choice === 'ECONOMIC') c.gp += 10;
          else if (choice === 'BALANCED') c.gp += 8;
          else if (choice === 'ENVIRONMENTAL') c.gp += 5;
        });
        if (next.activeEffects.denmarkTurnsLeft > 0) next.activeEffects.denmarkTurnsLeft--;
        next.activeEffects.japanActive = false;
        next.activeEffects.franceActive = false;
        next.activeEffects.brazilActive = false;
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
    const avgGP = joinedCountries.length > 0 ? totalGP / joinedCountries.length : 0;
    let meetingLog = "";
    if (avgGP > 55) {
      state.temperature += 0.5;
      meetingLog = "❌ [UN 보고] 전 세계적 과잉 개발로 인해 지구 온도가 급격히 상승했습니다! (+0.5℃)";
    } else if (avgGP > 48) {
      state.temperature += 0.2;
      meetingLog = "⚠️ [UN 보고] 개발 속도가 환경 회복력을 앞지르고 있습니다. 주의가 필요합니다. (+0.2℃)";
    } else {
      state.temperature -= 0.3;
      meetingLog = "✅ [UN 보고] 전 세계의 적극적인 환경 보호 덕분에 기온 상승세가 꺾였습니다. (-0.3℃)";
    }
    state.logs = [meetingLog, ...state.logs];
  };

  const calculateFinalScores = (state: GameState) => {
    const sorted = (Object.values(state.countries) as Country[])
      .filter(c => c.isJoined)
      .sort((a, b) => b.gp - a.gp);
    sorted.forEach((c, idx) => {
      state.countries[c.id as CountryId].score = Math.max(0, 100 - (idx * 10));
    });
  };

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

  const confirmCountrySelection = () => {
    if (!pendingCountryId) return;
    if (gameState.countries[pendingCountryId].isJoined) {
       alert("이미 선택된 국가입니다.");
       return;
    }
    setMyCountryId(pendingCountryId);
    syncService.joinRoom(gameState.roomId, pendingCountryId, nicknameInput);
  };

  const useAbility = () => {
    if (!myCountryId) return;
    const country = gameState.countries[myCountryId];
    if (myCountryId === 'JAPAN' && gameState.temperature < 17) return alert("기온 17.0℃ 이상 필요");
    if (myCountryId === 'TUVALU' && gameState.temperature < 18) return alert("기온 18.0℃ 이상 필요");
    if (myCountryId === 'DENMARK' && gameState.temperature < 17) return alert("기온 17.0℃ 이상 필요");
    if (myCountryId === 'FRANCE' && gameState.temperature < 19) return alert("기온 19.0℃ 이상 필요");

    let abilityData: any = {};
    if (myCountryId === 'KOREA') {
      if (rpsTargetSelection.length !== 2) return alert("2개 국가 선택 필요");
      abilityData = { targetA: rpsTargetSelection[0], targetB: rpsTargetSelection[1] };
    }
    if (myCountryId === 'TUVALU') {
      if (!tuvaluDonationTarget) return alert("기부 국가 선택 필요");
      abilityData = { donorId: tuvaluDonationTarget };
    }
    syncService.sendAction(gameState.roomId, { type: 'ACTIVATE_ABILITY', countryId: myCountryId, data: abilityData });
  };

  const renderLobby = () => (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center animate-in fade-in duration-1000">
      <div className="mb-10">
        <i className="fa-solid fa-earth-asia text-9xl text-emerald-400 mb-6 drop-shadow-[0_0_40px_rgba(52,211,153,0.5)]"></i>
        <h1 className="text-7xl font-black tracking-tighter mb-2 italic">CLIMATE <span className="text-emerald-400">WAR</span></h1>
        <p className="text-xl text-slate-400 font-bold uppercase tracking-[0.3em]">Negotiate for our future</p>
      </div>

      <div className="w-full max-w-4xl space-y-4">
        {!role ? (
          <div className="w-full max-w-sm mx-auto space-y-4">
            <input type="text" placeholder="방 코드" value={roomInput} onChange={(e) => setRoomInput(e.target.value.toUpperCase())} className="w-full p-5 bg-white/5 border-2 border-white/10 rounded-3xl text-center text-3xl font-black outline-none focus:border-emerald-500 transition-all" />
            <input type="text" placeholder="내 닉네임" value={nicknameInput} onChange={(e) => setNicknameInput(e.target.value)} className="w-full p-4 bg-white/5 border border-white/10 rounded-2xl text-center text-xl font-bold outline-none" />
            <div className="grid grid-cols-2 gap-4">
              <button onClick={() => handleEnterRoom('HOST')} className="p-6 bg-emerald-600 hover:bg-emerald-500 rounded-3xl font-black text-xl shadow-xl transition-all">교사 입장</button>
              <button onClick={() => handleEnterRoom('GUEST')} className="p-6 bg-blue-600 hover:bg-blue-500 rounded-3xl font-black text-xl shadow-xl transition-all">학생 입장</button>
            </div>
          </div>
        ) : role === 'HOST' ? (
          <div className="mt-10 w-full glass p-10 rounded-[3rem] border border-white/20 shadow-2xl">
            <h2 className="text-4xl font-black mb-10 text-emerald-400 tracking-tighter">Room #{gameState.roomId} - 대기실</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 mb-10">
              {(Object.values(gameState.countries) as Country[]).map(c => (
                <div key={c.id} className={`p-6 rounded-[2rem] border-4 transition-all flex flex-col items-center gap-2 ${c.isJoined ? 'bg-emerald-500/20 border-emerald-500 shadow-lg scale-105' : 'bg-slate-800 border-white/5 opacity-30'}`}>
                  <span className="text-5xl">{c.flag}</span>
                  <div className="text-center">
                    <div className="text-xs font-black opacity-50 uppercase">{c.name}</div>
                    <div className="text-lg font-black truncate max-w-[120px]">{c.nickname || '준비중...'}</div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => { const next = { ...gameState, phase: 'SETUP' as GamePhase }; setGameState(next); syncService.syncGameState(next); }} className="w-full p-8 bg-emerald-500 hover:bg-emerald-400 rounded-3xl font-black text-3xl shadow-xl transition-all active:scale-95">게임 시작하기 (설정 이동) ▶</button>
          </div>
        ) : !myCountryId ? (
          <div className="mt-10 w-full flex flex-col gap-6 animate-in slide-in-from-bottom-8">
            <div className="glass p-8 rounded-[3rem] border border-white/10 shadow-xl">
              <h2 className="text-2xl font-black mb-6 flex justify-between items-center px-4">
                <span>🌍 국가를 선택하세요</span>
                <span className="text-sm opacity-50 bg-white/10 px-4 py-1 rounded-full not-italic font-bold">내 닉네임: {nicknameInput}</span>
              </h2>
              {/* 상단 그리드: 국가 선택 박스 */}
              <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-3 p-2">
                {(Object.values(gameState.countries) as Country[]).map(c => {
                  const isTaken = c.isJoined && c.nickname !== nicknameInput;
                  const isSelected = pendingCountryId === c.id;
                  return (
                    <button 
                      key={c.id} 
                      disabled={isTaken}
                      onClick={() => setPendingCountryId(c.id)}
                      className={`group p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-1 relative overflow-hidden ${isSelected ? 'bg-blue-600 border-blue-400 scale-110 shadow-2xl z-10' : isTaken ? 'opacity-20 grayscale border-transparent bg-slate-900' : 'bg-slate-800 border-white/10 hover:border-white/40 hover:bg-slate-700'}`}
                    >
                      <span className="text-4xl group-hover:scale-110 transition-transform">{c.flag}</span>
                      <span className="text-[10px] font-black break-keep text-center leading-tight">{c.name}</span>
                      {isTaken && <div className="absolute inset-0 flex items-center justify-center bg-black/60"><i className="fa-solid fa-lock text-xs"></i></div>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 하단 설명 박스: 별도의 공간에서 스킬 설명 */}
            <div className={`glass p-10 rounded-[3rem] border-4 transition-all min-h-[380px] flex flex-col items-center justify-center shadow-2xl bg-gradient-to-b from-white/5 to-transparent ${pendingCountryId ? 'border-blue-500/50' : 'border-white/5 opacity-50'}`}>
              {pendingCountryId ? (
                <div className="w-full max-w-2xl animate-in zoom-in duration-300 text-center space-y-8">
                  <div className="flex flex-col items-center">
                    <span className="text-9xl mb-4 drop-shadow-2xl">{gameState.countries[pendingCountryId].flag}</span>
                    <h3 className="text-6xl font-black italic tracking-tighter uppercase">{gameState.countries[pendingCountryId].name}</h3>
                  </div>
                  
                  <div className="bg-black/40 p-10 rounded-[2.5rem] border border-white/10 text-left shadow-inner">
                    <div className="flex items-center gap-3 text-emerald-400 font-black text-xs uppercase tracking-[0.3em] mb-3">
                      <i className="fa-solid fa-sparkles"></i> UNIQUE SKILL
                    </div>
                    <div className="text-3xl font-black mb-4 text-white underline decoration-emerald-500/50 underline-offset-8">{gameState.countries[pendingCountryId].abilityName}</div>
                    <p className="text-slate-300 text-xl leading-relaxed font-medium">{gameState.countries[pendingCountryId].abilityDesc}</p>
                  </div>

                  <button 
                    onClick={confirmCountrySelection} 
                    className="w-full max-w-md p-8 bg-blue-600 hover:bg-blue-500 rounded-[2.5rem] font-black text-3xl shadow-[0_20px_50px_rgba(37,99,235,0.3)] transition-all active:scale-95 flex items-center justify-center gap-6"
                  >
                    <span>대표 국가 확정</span>
                    <i className="fa-solid fa-check-double"></i>
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-6 py-12">
                  <div className="relative">
                    <i className="fa-solid fa-hand-pointer text-8xl text-slate-700 animate-bounce"></i>
                    <div className="absolute inset-0 bg-blue-400/20 rounded-full scale-150 blur-2xl"></div>
                  </div>
                  <p className="text-3xl font-black text-slate-500 tracking-tight">상단에서 국가를 클릭하여<br/>스킬 정보를 확인하세요</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-10 glass p-16 rounded-[4rem] border border-white/20 text-center animate-in zoom-in shadow-2xl">
             <span className="text-[120px] block mb-6 drop-shadow-2xl">{gameState.countries[myCountryId].flag}</span>
             <h2 className="text-6xl font-black mb-4 tracking-tighter italic">{gameState.countries[myCountryId].name} 대표부</h2>
             <div className="inline-block px-10 py-3 bg-emerald-500/20 text-emerald-400 rounded-full font-black text-xl uppercase tracking-widest mb-10 border border-emerald-500/30">Entry Confirmed</div>
             <p className="text-2xl text-slate-400 font-bold mb-12 leading-relaxed">입장이 완료되었습니다.<br/>교사가 게임을 시작할 때까지 잠시만 대기해 주세요.</p>
             <div className="relative w-24 h-24 mx-auto">
               <div className="absolute inset-0 border-8 border-emerald-400/10 rounded-full"></div>
               <div className="absolute inset-0 border-8 border-emerald-400 border-t-transparent rounded-full animate-spin"></div>
             </div>
          </div>
        )}
      </div>
    </div>
  );

  const phaseAssets = role ? (
    gameState.phase === 'DEVELOPMENT' ? { title: "경제 개발", icon: "fa-industry", img: "https://images.unsplash.com/photo-1516937941344-00b4e0337589?w=1200", color: "from-orange-600" } :
    gameState.phase === 'QUIZ' ? { title: "환경 퀴즈", icon: "fa-brain", img: "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=1200", color: "from-blue-600" } :
    gameState.phase === 'DISCUSSION' ? { title: "자유 토론", icon: "fa-handshake", img: "https://images.unsplash.com/photo-1521791136064-7986c2920216?w=1200", color: "from-indigo-600" } :
    gameState.phase === 'UN_MEETING' ? { title: "UN 기후 총회", icon: "fa-building-columns", img: "https://images.unsplash.com/photo-1541873676946-8412460408c2?w=1200", color: "from-emerald-600" } : null
  ) : null;

  return (
    <div className={`min-h-screen transition-bg ${gameState.temperature >= 19 ? 'bg-red-950' : 'bg-slate-900'}`}>
      {gameState.phase === 'LOBBY' && renderLobby()}
      
      {gameState.phase === 'SETUP' && role === 'HOST' && (
        <div className="p-12 max-w-6xl mx-auto space-y-10 animate-in fade-in">
          <div className="flex justify-between items-end">
             <div><h2 className="text-5xl font-black mb-2 tracking-tighter italic">⚙️ 퀴즈 뱅크 설정</h2><p className={`text-xl font-bold ${gameState.selectedQuizIds.length === 8 ? 'text-emerald-400' : 'text-red-400'}`}>현재 {gameState.selectedQuizIds.length}개 선택됨 (8개를 선택해야 시작 가능)</p></div>
             <button disabled={gameState.selectedQuizIds.length !== 8} onClick={() => { const next = { ...gameState, phase: 'DEVELOPMENT' as GamePhase, timer: 30 }; setGameState(next); syncService.syncGameState(next); }} className={`px-16 py-6 rounded-3xl font-black text-3xl shadow-xl transition-all ${gameState.selectedQuizIds.length === 8 ? 'bg-emerald-500 hover:bg-emerald-400 active:scale-95 shadow-[0_20px_50px_rgba(16,185,129,0.3)]' : 'bg-slate-700 opacity-50 cursor-not-allowed'}`}>진짜 게임 시작! ▶</button>
          </div>
          <div className="glass p-10 rounded-[3rem] border border-white/10 grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[600px] overflow-y-auto custom-scrollbar">
             {QUIZ_POOL.map(q => {
               const isSelected = gameState.selectedQuizIds.includes(q.id);
               return (<div key={q.id} onClick={() => { setGameState(prev => { const selected = prev.selectedQuizIds.includes(q.id) ? prev.selectedQuizIds.filter(id => id !== q.id) : prev.selectedQuizIds.length < 8 ? [...prev.selectedQuizIds, q.id] : prev.selectedQuizIds; return { ...prev, selectedQuizIds: selected }; }); }} className={`p-6 rounded-2xl cursor-pointer border-4 transition-all relative ${isSelected ? 'bg-emerald-500/20 border-emerald-500 shadow-lg' : 'bg-white/5 border-transparent hover:bg-white/10'}`}><div className="font-black text-lg pr-8">{q.question}</div>{isSelected && <div className="absolute top-4 right-4 text-emerald-400"><i className="fa-solid fa-circle-check"></i></div>}</div>);
             })}
          </div>
        </div>
      )}

      {gameState.phase !== 'LOBBY' && gameState.phase !== 'SETUP' && gameState.phase !== 'END' && (
        <div className="max-w-[1400px] mx-auto p-4 md:p-8 space-y-8 animate-in slide-in-from-bottom-4 duration-700">
          {phaseAssets && (
            <div className="relative h-64 rounded-[3rem] overflow-hidden shadow-2xl border border-white/10">
              <img src={phaseAssets.img} className="absolute inset-0 w-full h-full object-cover opacity-20" alt="phase" />
              <div className={`absolute inset-0 bg-gradient-to-r ${phaseAssets.color}/60 to-transparent`}></div>
              <div className="absolute inset-0 flex items-center px-12">
                <div className="w-20 h-20 bg-white/20 rounded-2xl flex items-center justify-center text-4xl mr-6 shadow-xl"><i className={`fa-solid ${phaseAssets.icon}`}></i></div>
                <h1 className="text-6xl font-black italic uppercase tracking-tighter drop-shadow-lg">{phaseAssets.title}</h1>
              </div>
              <div className="absolute top-8 right-12 text-right">
                <div className="text-4xl font-black text-emerald-400 drop-shadow-md">TURN {gameState.turn} <span className="text-lg opacity-40">/ {MAX_TURNS}</span></div>
                <div className={`text-5xl font-black mt-2 drop-shadow-md ${gameState.timer <= 10 ? 'text-red-500 animate-pulse' : 'text-white'}`}>{gameState.timer}s</div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            <div className="lg:col-span-1 space-y-6">
              <TemperatureGauge temp={gameState.temperature} />
              <div className="glass p-6 rounded-[2.5rem] h-96 flex flex-col border border-white/10 shadow-xl">
                 <h3 className="text-xs font-black uppercase opacity-40 mb-4 tracking-widest flex items-center gap-2">
                   <i className="fa-solid fa-list-ul"></i> Global Status Log
                 </h3>
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
                <div className="glass p-10 rounded-[3rem] border border-white/10 h-full flex flex-col shadow-2xl">
                  <div className="flex justify-between items-center mb-10">
                    <h2 className="text-4xl font-black tracking-tight uppercase italic flex items-center gap-3">
                      <i className="fa-solid fa-tower-broadcast text-emerald-400"></i> Control Tower
                    </h2>
                    <div className="flex gap-4">
                      <button 
                        onClick={() => addTime(5)} 
                        className="px-8 py-5 bg-amber-600 hover:bg-amber-500 rounded-2xl font-black text-lg shadow-[0_10px_30px_rgba(217,119,6,0.3)] transition-all active:scale-95 text-white flex items-center gap-2 border-b-4 border-amber-800"
                      >
                        <i className="fa-solid fa-clock-rotate-left"></i> 5s 연장
                      </button>
                      <button 
                        onClick={nextPhase} 
                        className="px-12 py-5 bg-indigo-600 hover:bg-indigo-500 rounded-3xl font-black text-xl shadow-[0_10px_40px_rgba(79,70,229,0.3)] transition-all active:scale-95 border-b-4 border-indigo-800"
                      >
                        다음 단계로 이동 ▶
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 flex-1">
                     <div className="bg-black/20 p-8 rounded-[2.5rem] border border-white/5 overflow-y-auto max-h-[400px] custom-scrollbar">
                        <h3 className="text-xl font-black mb-6 uppercase opacity-60 flex items-center gap-2">
                          <i className="fa-solid fa-passport"></i> Delegation Status
                        </h3>
                        <div className="space-y-3">
                           {(Object.values(gameState.countries) as Country[]).filter(c=>c.isJoined).map(c => (
                             <div key={c.id} className="flex justify-between items-center p-5 bg-white/5 rounded-2xl border border-white/5">
                               <div className="flex items-center gap-4">
                                 <span className="text-3xl drop-shadow-md">{c.flag}</span>
                                 <div className="flex flex-col">
                                   <span className="font-bold text-lg leading-none">{c.nickname}</span>
                                   <span className="text-[10px] opacity-40 font-black tracking-widest mt-1 uppercase">{c.name}</span>
                                 </div>
                               </div>
                               <div className="flex items-center gap-3">
                                 <span className="text-emerald-400 font-black text-lg">GP {c.gp}</span>
                                 <span className={`px-4 py-1 rounded-full text-[10px] font-black uppercase ${c.lastChoice ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'}`}>
                                   {c.lastChoice ? 'Submitted' : 'Pending'}
                                 </span>
                               </div>
                             </div>
                           ))}
                        </div>
                     </div>
                     <div className="bg-black/20 p-8 rounded-[2.5rem] border border-white/5">
                        <h3 className="text-xl font-black mb-6 uppercase opacity-60 flex items-center gap-2">
                          <i className="fa-solid fa-sparkles"></i> Active Ability Effects
                        </h3>
                        <div className="space-y-4">
                           {gameState.activeEffects.swedenWaiting && <div className="bg-blue-500/10 p-5 rounded-2xl border border-blue-500/30 flex items-center gap-4 shadow-lg"><i className="fa-solid fa-scroll text-2xl text-blue-400"></i><span className="text-blue-400 font-bold">스웨덴: 인류 환경 선언 (효과 대기중)</span></div>}
                           {gameState.activeEffects.japanActive && <div className="bg-red-500/10 p-5 rounded-2xl border border-red-500/30 flex items-center gap-4 shadow-lg"><i className="fa-solid fa-building-circle-exclamation text-2xl text-red-400"></i><span className="text-red-400 font-bold">일본: 교토의정서 발효 (환경 보호 강제)</span></div>}
                           {gameState.activeEffects.denmarkTurnsLeft > 0 && <div className="bg-orange-500/10 p-5 rounded-2xl border border-orange-500/30 flex items-center gap-4 shadow-lg"><i className="fa-solid fa-handshake-angle text-2xl text-orange-400"></i><span className="text-orange-400 font-bold">덴마크: 코펜하겐 기후협약 ({gameState.activeEffects.denmarkTurnsLeft}턴)</span></div>}
                           {gameState.activeEffects.franceActive && <div className="bg-indigo-500/10 p-5 rounded-2xl border border-indigo-500/30 flex items-center gap-4 shadow-lg"><i className="fa-solid fa-tower-observation text-2xl text-indigo-400"></i><span className="text-indigo-400 font-bold">프랑스: 파리기후변화협약 발효</span></div>}
                           {gameState.activeEffects.brazilActive && <div className="bg-purple-500/10 p-5 rounded-2xl border border-purple-500/30 flex items-center gap-4 shadow-lg"><i className="fa-solid fa-shuffle text-2xl text-purple-400"></i><span className="text-purple-400 font-bold">브라질: 리우 환경회의 (선택 반전)</span></div>}
                           {Object.values(gameState.activeEffects).every(v => !v || v === 0) && <div className="text-slate-500 italic text-center py-16 flex flex-col items-center gap-4"><i className="fa-solid fa-wind text-4xl opacity-20"></i><span>현재 활성화된 국가 스킬 효과가 없습니다</span></div>}
                        </div>
                     </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-8 h-full">
                   {myCountryId && (
                     <div className="flex flex-col md:flex-row gap-6">
                       <div className="flex-1 glass p-8 rounded-[3rem] border border-white/10 bg-gradient-to-br from-blue-600/20 to-transparent flex justify-between items-center shadow-xl">
                          <div className="flex items-center gap-8">
                             <span className="text-8xl drop-shadow-[0_10px_30px_rgba(255,255,255,0.1)]">{gameState.countries[myCountryId].flag}</span>
                             <div>
                                <h2 className="text-4xl font-black mb-1 tracking-tighter italic">{gameState.countries[myCountryId].nickname} <span className="text-sm opacity-40 font-bold not-italic">({gameState.countries[myCountryId].name})</span></h2>
                                <div className="flex gap-3"><span className="bg-emerald-500 text-slate-900 px-5 py-1 rounded-full font-black text-lg shadow-lg">GP: {gameState.countries[myCountryId].gp}</span></div>
                             </div>
                          </div>
                       </div>
                       <div className="flex-1 glass p-8 rounded-[3rem] border border-white/10 bg-gradient-to-br from-purple-600/20 to-transparent flex flex-col justify-center shadow-xl">
                          <div className="flex justify-between items-center mb-2">
                            <h3 className="text-2xl font-black flex items-center gap-3">
                              <i className="fa-solid fa-wand-magic-sparkles text-purple-400"></i>
                              {gameState.countries[myCountryId].abilityName}
                            </h3>
                            {gameState.countries[myCountryId].isAbilityUsed ? (
                              <span className="bg-slate-700 text-white px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow-inner">Exhausted</span>
                            ) : (
                              <button onClick={useAbility} className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-2 rounded-2xl font-black shadow-lg transition-all active:scale-95 border-b-4 border-purple-800">스킬 발동</button>
                            )}
                          </div>
                          <p className="text-sm text-slate-300 leading-relaxed font-medium mb-2">{gameState.countries[myCountryId].abilityDesc}</p>
                       </div>
                     </div>
                   )}

                   <div className="glass p-12 rounded-[4rem] border border-white/10 bg-slate-800/40 min-h-[450px] flex items-center justify-center shadow-2xl">
                     {myCountryId ? (
                       gameState.phase === 'DEVELOPMENT' ? (() => {
                         const isJapanForced = gameState.activeEffects.japanActive && gameState.lastTurnChoices[myCountryId] === 'ECONOMIC';
                         const top3Ids = [...(Object.values(gameState.countries) as Country[])].filter(c => c.isJoined).sort((a,b)=>b.gp-a.gp).slice(0,3).map(c=>c.id);
                         const isDenmarkForced = gameState.activeEffects.denmarkTurnsLeft > 0 && top3Ids.includes(myCountryId);
                         const isFranceForced = gameState.activeEffects.franceActive && myCountryId !== 'FRANCE';
                         const isForced = isJapanForced || isDenmarkForced || isFranceForced;

                         return (
                         <div className="w-full text-center space-y-12 animate-in zoom-in">
                            <div className="space-y-4">
                              <h3 className="text-5xl font-black tracking-tight">{isForced ? <span className="text-red-500 animate-crisis flex items-center justify-center gap-4"><i className="fa-solid fa-shield-virus"></i> 환경 보호 강제 발동 중!</span> : '개발 방향을 결정하세요'}</h3>
                              {isForced && <p className="text-red-400/70 font-black text-sm uppercase italic tracking-widest">Global Environmental Accord in Effect</p>}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                               {[
                                 { id: 'ECONOMIC', label: '경제 중심', icon: 'fa-industry', gp: '+10', color: 'orange', disabled: isForced },
                                 { id: 'BALANCED', label: '지속 성장', icon: 'fa-scale-balanced', gp: '+8', color: 'emerald', disabled: isForced },
                                 { id: 'ENVIRONMENTAL', label: '환경 우선', icon: 'fa-leaf', gp: '+5', color: 'sky', disabled: false }
                               ].map(btn => (
                                 <button 
                                   key={btn.id} 
                                   disabled={btn.disabled} 
                                   onClick={() => syncService.sendAction(gameState.roomId, { type: 'SELECT_DEVELOPMENT', countryId: myCountryId, choice: btn.id })} 
                                   className={`p-10 rounded-[3rem] border-4 transition-all group flex flex-col items-center shadow-xl ${gameState.countries[myCountryId].lastChoice === btn.id ? `bg-${btn.color}-600/40 border-${btn.color}-400 ring-[12px] ring-${btn.color}-500/20 scale-105 z-10` : btn.disabled ? 'opacity-20 cursor-not-allowed grayscale border-transparent bg-slate-900/40' : 'bg-white/5 border-transparent hover:bg-white/10 hover:scale-105'}`}
                                 >
                                   <i className={`fa-solid ${btn.icon} text-6xl mb-8 text-${btn.color}-400 group-hover:scale-110 transition-transform drop-shadow-lg`}></i>
                                   <span className="text-3xl font-black italic uppercase tracking-tighter">{btn.label}</span>
                                 </button>
                               ))}
                            </div>
                         </div>
                         );
                       })() : gameState.phase === 'QUIZ' ? (
                        <div className="w-full max-w-3xl space-y-10 text-center animate-in zoom-in">
                           <h3 className="text-5xl font-black italic tracking-tighter uppercase flex items-center justify-center gap-4 text-emerald-400">
                             <i className="fa-solid fa-brain"></i> Climate Quiz
                           </h3>
                           {gameState.currentQuizId && (() => {
                             const quiz = [...QUIZ_POOL, ...gameState.customQuizzes].find(q => q.id === gameState.currentQuizId);
                             return quiz ? (
                               <div className="space-y-8">
                                 <div className="p-12 bg-black/50 rounded-[3rem] text-3xl font-black border border-white/10 leading-tight shadow-inner">{quiz.question}</div>
                                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                   {quiz.options.map((opt, i) => (
                                     <button key={i} onClick={() => syncService.sendAction(gameState.roomId, { type: 'QUIZ_RESULT', countryId: myCountryId, correct: i === quiz.answer })} className="p-8 bg-slate-800/80 hover:bg-blue-600 rounded-[2rem] text-left font-black text-xl transition-all border border-white/5 flex items-center gap-6 shadow-lg active:scale-95 group">
                                       <span className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center text-blue-400 group-hover:text-white transition-colors">{i+1}</span> 
                                       <span className="flex-1 break-keep">{opt}</span>
                                     </button>
                                   ))}
                                 </div>
                               </div>
                             ) : null;
                           })()}
                        </div>
                       ) : (
                         <div className="text-center space-y-8">
                            <div className="relative w-32 h-32 mx-auto">
                              <i className="fa-solid fa-earth-americas text-9xl text-slate-700 animate-spin-slow"></i>
                              <div className="absolute inset-0 border-4 border-emerald-400/20 rounded-full scale-150 animate-pulse"></div>
                            </div>
                            <h3 className="text-5xl font-black uppercase tracking-widest opacity-20">Waiting For Consensus...</h3>
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
        <div className="min-h-screen flex items-center justify-center p-8 bg-black/95 backdrop-blur-3xl animate-in fade-in duration-1000">
           <div className={`w-full max-w-5xl p-20 rounded-[5rem] border-[12px] text-center shadow-[0_0_100px_rgba(0,0,0,0.5)] ${gameState.temperature >= 20 ? 'border-red-600 bg-red-950/20' : 'border-emerald-500 bg-emerald-950/20'}`}>
              <h1 className="text-[120px] font-black mb-10 tracking-tighter uppercase italic leading-none drop-shadow-2xl">{gameState.temperature >= 20 ? 'Game Over' : 'Earth Saved'}</h1>
              <div className="text-5xl font-black mb-20 flex items-center justify-center gap-6">
                <span className="opacity-40 font-bold not-italic text-2xl uppercase tracking-widest">Final Temperature</span>
                <span className={`px-8 py-2 rounded-[2rem] bg-white/5 ${gameState.temperature >= 20 ? 'text-red-500' : 'text-emerald-400'}`}>{gameState.temperature.toFixed(1)}℃</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                 {(Object.values(gameState.countries) as Country[]).filter(c=>c.isJoined).sort((a,b)=>b.gp - a.gp).map((c, idx) => (
                   <div key={c.id} className="bg-white/5 p-10 rounded-[3rem] border border-white/10 flex justify-between items-center shadow-xl hover:bg-white/10 transition-all">
                      <div className="flex items-center gap-6">
                         <span className="text-4xl font-black text-slate-600 tabular-nums">#{idx+1}</span>
                         <span className="text-6xl drop-shadow-md">{c.flag}</span>
                         <div className="flex flex-col">
                           <span className="text-2xl font-black truncate max-w-[150px]">{c.nickname}</span>
                           <span className="text-xs font-bold opacity-30 tracking-widest uppercase">{c.name}</span>
                         </div>
                      </div>
                      <div className="text-right">
                         <div className="text-4xl font-black text-emerald-400 tabular-nums">{c.gp} <span className="text-sm opacity-40 uppercase tracking-tighter">GP</span></div>
                         <div className="text-xs font-bold opacity-30 tracking-widest mt-1">{c.score} COINS EARNED</div>
                      </div>
                   </div>
                 ))}
              </div>
              <button 
                onClick={() => window.location.reload()} 
                className="mt-20 px-24 py-8 bg-white text-slate-900 rounded-full font-black text-4xl shadow-[0_20px_60px_rgba(255,255,255,0.2)] hover:scale-105 active:scale-95 transition-all tracking-tighter"
              >
                RESTART GAME
              </button>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
