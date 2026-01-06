
import React, { useState, useEffect, useRef } from 'react';
import { GameState, GamePhase, CountryId, Country, QuizQuestion } from './types.ts';
import { COUNTRIES, INITIAL_TEMPERATURE, MAX_TEMPERATURE, MAX_TURNS, QUIZ_POOL } from './constants.ts';
import * as syncService from './services/syncService.ts';
import TemperatureGauge from './components/TemperatureGauge.tsx';

const SFX = {
  CLICK: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3',
  JOIN: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3',
  ALARM: 'https://assets.mixkit.co/active_storage/sfx/951/951-preview.mp3',
  SUCCESS: 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3',
  TRANSITION: 'https://assets.mixkit.co/active_storage/sfx/2567/2567-preview.mp3',
  GAME_OVER: 'https://assets.mixkit.co/active_storage/sfx/2533/2533-preview.mp3',
  WIN: 'https://assets.mixkit.co/active_storage/sfx/1433/1433-preview.mp3'
};

const PHASE_THEMES: Record<GamePhase, { img: string; color: string; label: string }> = {
  LOBBY: { 
    img: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&q=80&w=2000', 
    color: 'from-slate-950 to-slate-900', 
    label: '글로벌 워룸 (대기실)' 
  },
  SETUP: { 
    img: 'https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&q=80&w=2000', 
    color: 'from-emerald-950 to-slate-900', 
    label: '환경 데이터 설정' 
  },
  DEVELOPMENT: { 
    img: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80&w=2000', 
    color: 'from-blue-950 to-slate-900', 
    label: '국가 발전 전략 수립' 
  },
  QUIZ: { 
    img: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&q=80&w=2000', 
    color: 'from-purple-950 to-slate-900', 
    label: '실시간 환경 퀴즈' 
  },
  DISCUSSION: { 
    img: 'https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&q=80&w=2000', 
    color: 'from-amber-950 to-slate-900', 
    label: 'UN 기후 협상 회의' 
  },
  UN_MEETING: { 
    img: 'https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&q=80&w=2000', 
    color: 'from-amber-950 to-slate-900', 
    label: 'UN 특별 총회' 
  },
  END: { 
    img: '', 
    color: 'from-black to-slate-950', 
    label: '최종 결과 발표' 
  }
};

const App: React.FC = () => {
  const [role, setRole] = useState<'HOST' | 'GUEST' | null>(null);
  const [myCountryId, setMyCountryId] = useState<CountryId | null>(null);
  const [pendingCountryId, setPendingCountryId] = useState<CountryId | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [roomInput, setRoomInput] = useState('');
  const [nicknameInput, setNicknameInput] = useState('');
  const [isRoomEntered, setIsRoomEntered] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const [newQuiz, setNewQuiz] = useState({ question: '', options: ['', '', '', ''], answer: 0 });

  const [gameState, setGameState] = useState<GameState>({
    roomId: '',
    phase: 'LOBBY',
    turn: 1,
    temperature: INITIAL_TEMPERATURE,
    countries: JSON.parse(JSON.stringify(COUNTRIES)),
    logs: ['🌍 기후 워룸 시스템 가동 중...'],
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
      tuvaluWaiting: false,
    }
  });

  const processedActionIds = useRef<Set<string>>(new Set());

  const playSfx = (url: string) => {
    const audio = new Audio(url);
    audio.volume = 0.4;
    audio.play().catch(() => {}); 
  };

  // Fix: Defined currentTheme based on the current game phase.
  const currentTheme = PHASE_THEMES[gameState.phase];

  // Fix: Implemented adjustTemp function to allow the host to manually adjust the global temperature.
  const adjustTemp = (amount: number) => {
    setGameState(prev => {
      const nextTemp = Math.min(MAX_TEMPERATURE, Math.max(0, prev.temperature + amount));
      const next = { ...prev, temperature: nextTemp };
      syncService.syncGameState(next);
      return next;
    });
  };

  useEffect(() => {
    if (isRoomEntered && gameState.roomId) {
      if (role === 'GUEST') {
        const stopPolling = syncService.pollGameState(gameState.roomId, (newState) => {
          if (newState.phase !== gameState.phase) playSfx(SFX.TRANSITION);
          if (newState.temperature > gameState.temperature) playSfx(SFX.ALARM);
          
          if (nicknameInput && !myCountryId) {
            const me = (Object.values(newState.countries) as Country[]).find(c => c.nickname === nicknameInput);
            if (me) {
              setMyCountryId(me.id as CountryId);
              setIsJoining(false);
              playSfx(SFX.SUCCESS);
            }
          }
          setGameState(newState);
        });
        return () => stopPolling();
      } else if (role === 'HOST') {
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
    }
  }, [isRoomEntered, role, gameState.roomId, nicknameInput, myCountryId, gameState.phase, gameState.temperature]);

  const handleActionAsHost = (action: any) => {
    setGameState(prev => {
      const next = { ...prev };
      const cid = action.countryId as CountryId;

      switch (action.type) {
        case 'JOIN':
          if (next.countries[cid] && !next.countries[cid].isJoined) {
            next.countries[cid].isJoined = true;
            next.countries[cid].nickname = action.nickname;
            next.logs = [`🚩 ${next.countries[cid].flag} ${action.nickname}(${next.countries[cid].name}) 지역 점령 완료!`, ...next.logs];
            playSfx(SFX.JOIN);
            // 즉각적인 상태 전파를 위해 호스트에서 저장 트리거
            syncService.syncGameState(next);
          }
          break;
        case 'SELECT_DEVELOPMENT':
          if (next.countries[cid]) next.countries[cid].lastChoice = action.choice;
          syncService.syncGameState(next);
          break;
        case 'QUIZ_RESULT':
          if (!action.correct) {
            next.temperature += 0.1;
            next.logs = [`⚠️ ${next.countries[cid].nickname} 전략 오류! 기온 상승`, ...next.logs];
            playSfx(SFX.ALARM);
          } else {
            next.logs = [`✅ ${next.countries[cid].nickname} 전략 성공!`, ...next.logs];
            playSfx(SFX.SUCCESS);
          }
          syncService.syncGameState(next);
          break;
      }
      return next;
    });
  };

  const handleEnterRoom = async (r: 'HOST' | 'GUEST') => {
    const rid = roomInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!rid) return alert("방 코드를 입력해주세요.");
    if (r === 'GUEST' && !nicknameInput.trim()) return alert("닉네임을 입력하세요.");
    
    setIsConnecting(true);
    playSfx(SFX.CLICK);
    
    try {
      if (r === 'HOST') {
        const initialState = { ...gameState, roomId: rid };
        await syncService.syncGameState(initialState);
        await syncService.clearActions(rid);
        setGameState(initialState);
      } else {
        setGameState(prev => ({ ...prev, roomId: rid }));
      }
      setRole(r);
      setIsRoomEntered(true);
    } catch (e) {
      alert("연결 오류가 발생했습니다.");
    } finally {
      setIsConnecting(false);
    }
  };

  const nextPhase = () => {
    playSfx(SFX.TRANSITION);
    setGameState(prev => {
      let next = { ...prev };
      if (next.phase === 'LOBBY') next.phase = 'SETUP';
      else if (next.phase === 'SETUP') { next.phase = 'DEVELOPMENT'; next.timer = 30; }
      else if (next.phase === 'DEVELOPMENT') { next.phase = 'QUIZ'; next.timer = 60; next.currentQuizId = next.selectedQuizIds[next.turn-1]; }
      else if (next.phase === 'QUIZ') { next.phase = 'DISCUSSION'; next.timer = 180; }
      else if (next.phase === 'DISCUSSION') {
        if (next.turn === MAX_TURNS) next.phase = 'END';
        else { next.turn++; next.phase = 'DEVELOPMENT'; next.timer = 30; }
      }
      syncService.syncGameState(next);
      return next;
    });
  };

  const renderLobby = () => (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 animate-in fade-in duration-1000 relative overflow-hidden bg-slate-950">
      {/* 백그라운드 그리드망 비주얼 */}
      <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#34d399 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>
      
      <div className="relative z-10 text-center space-y-12 w-full max-w-7xl">
        <div className="space-y-4">
          <h1 className="text-9xl font-black tracking-tighter italic text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.3)]">CLIMATE <span className="text-emerald-400">WAR</span></h1>
          <div className="flex items-center justify-center gap-4">
             <div className="h-1 w-24 bg-emerald-500"></div>
             <p className="text-2xl text-emerald-400 font-black uppercase tracking-[0.6em]">Earth Occupation Campaign</p>
             <div className="h-1 w-24 bg-emerald-500"></div>
          </div>
        </div>

        <div className="w-full mx-auto space-y-8 pt-6">
          {!role ? (
            <div className="max-w-md mx-auto space-y-6 glass p-10 rounded-[3rem] border border-white/10 shadow-2xl">
              <div className="space-y-4">
                <label className="text-xs font-black text-emerald-400 uppercase tracking-widest block text-left ml-4">Command Room Code</label>
                <input type="text" placeholder="방 코드(예:ROOM1)" value={roomInput} onChange={(e) => setRoomInput(e.target.value.toUpperCase())} className="w-full p-6 bg-black/40 border-2 border-emerald-500/30 rounded-3xl text-center text-4xl font-black outline-none focus:border-emerald-500 transition-all text-white placeholder:text-white/20" />
              </div>
              <div className="space-y-4">
                <label className="text-xs font-black text-emerald-400 uppercase tracking-widest block text-left ml-4">Commander Nickname</label>
                <input type="text" placeholder="사령관 닉네임" value={nicknameInput} onChange={(e) => setNicknameInput(e.target.value)} className="w-full p-5 bg-black/40 border border-white/10 rounded-2xl text-center text-2xl font-bold outline-none text-white placeholder:text-white/20" />
              </div>
              <div className="grid grid-cols-2 gap-6 pt-4">
                <button disabled={isConnecting} onClick={() => handleEnterRoom('HOST')} className="p-8 bg-emerald-600 hover:bg-emerald-500 rounded-[2rem] font-black text-2xl shadow-xl transition-all active:scale-95 border-b-8 border-emerald-800">교사 제어</button>
                <button disabled={isConnecting} onClick={() => handleEnterRoom('GUEST')} className="p-8 bg-blue-600 hover:bg-blue-500 rounded-[2rem] font-black text-2xl shadow-xl transition-all active:scale-95 border-b-8 border-blue-800">학생 참전</button>
              </div>
            </div>
          ) : role === 'HOST' ? (
            <div className="glass p-12 rounded-[4rem] border-2 border-emerald-500/30 shadow-[0_0_100px_rgba(52,211,153,0.1)] text-left bg-black/60 backdrop-blur-3xl animate-in slide-in-from-bottom-10">
              <div className="flex justify-between items-center mb-12 border-b border-white/10 pb-8">
                <div>
                  <h2 className="text-5xl font-black text-white tracking-tighter uppercase italic"><i className="fa-solid fa-satellite-dish mr-4 text-emerald-400 animate-pulse"></i> WAR ROOM: {gameState.roomId}</h2>
                  <p className="text-emerald-400/60 font-bold mt-2 tracking-widest">현재 아홉 국가의 참전을 대기하고 있습니다.</p>
                </div>
                <div className="bg-emerald-500/20 text-emerald-400 px-10 py-4 rounded-full font-black text-2xl border border-emerald-500/30">참전 국가: {(Object.values(gameState.countries) as Country[]).filter(c=>c.isJoined).length} / 9</div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-12">
                {(Object.values(gameState.countries) as Country[]).map(c => (
                  <div key={c.id} className={`group relative p-10 rounded-[3rem] border-4 transition-all duration-500 flex items-center gap-10 min-h-[180px] overflow-hidden ${c.isJoined ? 'bg-emerald-500/20 border-emerald-400 scale-105 shadow-[0_0_40px_rgba(52,211,153,0.3)]' : 'bg-white/5 border-white/5 opacity-40'}`}>
                    {/* 선택 완료 시 도장 뱃지 */}
                    {c.isJoined && (
                      <div className="absolute -top-4 -right-4 bg-red-600 text-white font-black px-8 py-3 rounded-full text-xl shadow-2xl rotate-12 border-4 border-white animate-in zoom-in">
                        선택 완료
                      </div>
                    )}
                    <span className={`text-[100px] shrink-0 drop-shadow-2xl transition-transform duration-700 ${c.isJoined ? 'rotate-0' : 'rotate-12 grayscale'}`}>{c.flag}</span>
                    <div className="text-left overflow-hidden flex-1">
                      <div className="text-sm opacity-50 font-black uppercase tracking-[0.3em] mb-2">{c.name}</div>
                      <div className="text-4xl font-black truncate text-white leading-tight">
                        {c.nickname || <span className="text-white/10 italic text-2xl tracking-tighter">참전 대기 중...</span>}
                      </div>
                    </div>
                    {/* 삼국지 스타일 장식선 */}
                    <div className="absolute bottom-0 left-0 h-1 bg-emerald-400 transition-all duration-1000" style={{ width: c.isJoined ? '100%' : '0%' }}></div>
                  </div>
                ))}
              </div>
              <button onClick={nextPhase} className="w-full p-10 bg-emerald-500 hover:bg-emerald-400 rounded-[3rem] font-black text-4xl shadow-[0_20px_80px_rgba(16,185,129,0.3)] transition-all transform hover:scale-[1.01] active:scale-95 border-b-[12px] border-emerald-700">전 지구적 캠페인 시작 (BATTLE START) ▶</button>
            </div>
          ) : !myCountryId ? (
            <div className="space-y-10 animate-in slide-in-from-bottom-10 text-left w-full max-w-5xl mx-auto">
              <div className="glass p-12 rounded-[4rem] border-2 border-blue-500/30 shadow-2xl bg-black/40">
                <h2 className="text-4xl font-black mb-10 text-left italic tracking-tighter flex items-center gap-5 text-blue-400">
                  <i className="fa-solid fa-crosshairs animate-ping text-sm"></i>
                  점령할 국가 영지 선택
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
                  {(Object.values(gameState.countries) as Country[]).map(c => {
                    const isTaken = c.isJoined;
                    return (
                      <button 
                        key={c.id} 
                        disabled={isTaken || isJoining}
                        onClick={() => { playSfx(SFX.CLICK); setPendingCountryId(c.id); }}
                        className={`p-8 rounded-[2.5rem] border-4 transition-all flex flex-col items-center gap-4 text-center group min-h-[200px] justify-center relative overflow-hidden ${pendingCountryId === c.id ? 'bg-blue-600 border-blue-400 scale-105 shadow-[0_0_50px_rgba(37,99,235,0.4)] z-10' : isTaken ? 'opacity-20 grayscale border-transparent cursor-not-allowed' : 'bg-white/5 border-white/10 hover:border-blue-400/50 hover:bg-blue-900/20'}`}
                      >
                        {isTaken && <div className="absolute inset-0 flex items-center justify-center bg-black/60 font-black text-red-500 text-2xl rotate-[-20deg] border-2 border-red-500">OCCUPIED</div>}
                        <span className="text-8xl group-hover:scale-110 transition-transform duration-500">{c.flag}</span>
                        <div className="text-xl font-black tracking-widest text-white uppercase">{c.name}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              
              {pendingCountryId && (
                <div className="glass p-12 rounded-[4rem] border-4 border-blue-500/50 bg-blue-950/40 text-center space-y-8 animate-in zoom-in shadow-[0_0_100px_rgba(37,99,235,0.2)]">
                  <div className="flex items-center justify-center gap-8">
                    <span className="text-[120px] drop-shadow-[0_0_30px_rgba(255,255,255,0.4)]">{gameState.countries[pendingCountryId].flag}</span>
                    <div className="text-left">
                       <h3 className="text-7xl font-black tracking-tighter italic uppercase text-white leading-none">{gameState.countries[pendingCountryId].name}</h3>
                       <p className="text-blue-400 font-bold mt-2 tracking-widest uppercase">National Representative</p>
                    </div>
                  </div>
                  <div className="bg-black/60 p-10 rounded-[3rem] text-left border border-white/10 shadow-inner">
                    <div className="text-emerald-400 font-black text-2xl mb-4 flex items-center gap-4">
                      <i className="fa-solid fa-shield-halved text-blue-400"></i> 
                      고유 능력: {gameState.countries[pendingCountryId].abilityName}
                    </div>
                    <p className="text-2xl text-slate-300 font-medium leading-relaxed">{gameState.countries[pendingCountryId].abilityDesc}</p>
                  </div>
                  <button 
                    disabled={isJoining}
                    onClick={() => { 
                      setIsJoining(true);
                      playSfx(SFX.CLICK); 
                      syncService.sendAction(gameState.roomId, { type: 'JOIN', countryId: pendingCountryId, nickname: nicknameInput }); 
                    }} 
                    className={`w-full p-10 rounded-[3rem] font-black text-5xl shadow-2xl transition-all transform active:scale-95 border-b-[12px] ${isJoining ? 'bg-slate-700 border-slate-900 cursor-wait' : 'bg-blue-600 hover:bg-blue-500 border-blue-800'}`}
                  >
                    {isJoining ? "사령부 승인 대기 중..." : "활동 시작 (DEPLOY) ▶"}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="glass p-20 rounded-[5rem] border-2 border-emerald-500/30 text-center animate-in zoom-in shadow-[0_0_80px_rgba(52,211,153,0.1)] max-w-2xl mx-auto bg-black/60">
               <div className="relative inline-block mb-10">
                  <span className="text-[180px] block drop-shadow-2xl animate-pulse">{gameState.countries[myCountryId].flag}</span>
                  <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 bg-emerald-500 text-black font-black px-6 py-2 rounded-xl text-xl uppercase tracking-tighter">Approved</div>
               </div>
               <h2 className="text-7xl font-black mb-6 tracking-tighter italic text-emerald-400 uppercase leading-none">{gameState.countries[myCountryId].name} <br/>대표 입장 완료</h2>
               <p className="text-2xl text-slate-400 font-bold mb-16 tracking-tight">지구 사령부(교사)에서 캠페인을 개시할 때까지 <br/>전략을 구상하며 대기하십시오.</p>
               <div className="flex justify-center gap-3">
                  <div className="w-4 h-4 bg-emerald-500 rounded-full animate-bounce"></div>
                  <div className="w-4 h-4 bg-emerald-500 rounded-full animate-bounce [animation-delay:-0.1s]"></div>
                  <div className="w-4 h-4 bg-emerald-500 rounded-full animate-bounce [animation-delay:-0.2s]"></div>
               </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className={`min-h-screen transition-bg bg-gradient-to-br ${currentTheme.color} ${gameState.temperature >= 19 ? 'animate-crisis' : ''}`}>
      {gameState.phase === 'LOBBY' ? renderLobby() : (
        <div className="animate-in fade-in duration-1000">
          {/* 단계별 와이드 비주얼 헤더 */}
          <div className="relative h-[400px] w-full overflow-hidden shadow-2xl border-b border-white/10">
            <img src={currentTheme.img} className="absolute inset-0 w-full h-full object-cover transform scale-105 opacity-60" />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent"></div>
            
            <div className="absolute bottom-0 left-0 w-full p-12 md:p-16 flex flex-col md:flex-row justify-between items-end gap-10">
              <div className="flex items-center gap-10">
                <div className="w-28 h-28 glass rounded-[2rem] border-2 border-white/20 flex items-center justify-center text-6xl text-white shadow-2xl animate-pulse">
                  {gameState.phase === 'DEVELOPMENT' && <i className="fa-solid fa-industry"></i>}
                  {gameState.phase === 'QUIZ' && <i className="fa-solid fa-bolt-lightning"></i>}
                  {gameState.phase === 'DISCUSSION' && <i className="fa-solid fa-comments"></i>}
                  {gameState.phase === 'SETUP' && <i className="fa-solid fa-database"></i>}
                </div>
                <div>
                  <h1 className="text-8xl font-black italic uppercase tracking-tighter text-white drop-shadow-2xl leading-none">{gameState.phase}</h1>
                  <p className="text-3xl font-bold text-emerald-400 tracking-[0.3em] uppercase mt-4 drop-shadow-md">{currentTheme.label} • ROUND {gameState.turn}</p>
                </div>
              </div>
              
              <div className="text-right">
                <div className="text-8xl font-black tabular-nums text-white drop-shadow-2xl bg-black/60 backdrop-blur-3xl px-14 py-5 rounded-[2.5rem] border-2 border-white/10 shadow-inner">
                  {gameState.timer}<span className="text-3xl ml-2 opacity-50 font-black">SEC</span>
                </div>
              </div>
            </div>
          </div>

          <main className="max-w-[1750px] mx-auto p-10 space-y-12">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
              <aside className="lg:col-span-3 space-y-10">
                <TemperatureGauge temp={gameState.temperature} />
                
                {role === 'HOST' && (
                  <div className="glass p-8 rounded-[3rem] border-2 border-emerald-500/30 flex flex-col gap-6 bg-emerald-500/5 shadow-2xl">
                    <h4 className="text-sm font-black text-center uppercase opacity-60 tracking-widest flex items-center justify-center gap-3">
                      <i className="fa-solid fa-temperature-half text-emerald-400"></i>
                      지구 환경 통제실
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                      <button onClick={() => { adjustTemp(-0.2); }} className="group p-6 bg-blue-600/80 hover:bg-blue-500 rounded-3xl font-black text-2xl shadow-xl transition-all border-b-4 border-blue-900">- 0.2℃</button>
                      <button onClick={() => { adjustTemp(0.2); }} className="group p-6 bg-red-600/80 hover:bg-red-500 rounded-3xl font-black text-2xl shadow-xl transition-all border-b-4 border-red-900">+ 0.2℃</button>
                    </div>
                  </div>
                )}
                
                <div className="glass p-8 rounded-[3rem] h-[600px] flex flex-col border border-white/10 shadow-2xl bg-black/30">
                   <h3 className="text-xs font-black uppercase opacity-40 mb-6 tracking-widest flex items-center gap-3"><i className="fa-solid fa-tower-broadcast"></i> 사령부 실시간 통신</h3>
                   <div className="overflow-y-auto flex-1 space-y-3 pr-3 custom-scrollbar">
                      {gameState.logs.map((log, i) => (
                        <div key={i} className="text-lg border-l-4 border-emerald-500/50 pl-5 py-3 font-semibold bg-white/5 rounded-r-2xl animate-in slide-in-from-left-4">
                          <span className={log.includes('기온') ? 'text-red-400' : log.includes('성공') ? 'text-emerald-400' : ''}>{log}</span>
                        </div>
                      ))}
                   </div>
                </div>
              </aside>

              <section className="lg:col-span-9">
                {role === 'HOST' && (
                  <div className="glass p-12 rounded-[4rem] border border-white/10 h-full min-h-[850px] flex flex-col shadow-2xl bg-black/20">
                    <div className="flex justify-between items-center mb-12 border-b border-white/10 pb-8">
                      <h2 className="text-6xl font-black italic tracking-tighter uppercase text-white/90">Global Command Center</h2>
                      <button onClick={nextPhase} className="px-24 py-10 bg-indigo-600 hover:bg-indigo-500 rounded-[3rem] font-black text-4xl shadow-[0_20px_60px_rgba(79,70,229,0.3)] border-b-[10px] border-indigo-900 transition-all">다음 단계로 이동 ▶</button>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                      {(Object.values(gameState.countries) as Country[]).filter(c=>c.isJoined).map(c => (
                        <div key={c.id} className="p-10 bg-white/5 rounded-[4rem] border-2 border-white/5 flex flex-col gap-8 shadow-xl relative overflow-hidden group hover:bg-white/10 transition-all">
                          <div className="flex items-center gap-8">
                            <span className="text-8xl drop-shadow-2xl">{c.flag}</span>
                            <div className="text-left overflow-hidden">
                              <div className="text-4xl font-black italic text-white truncate leading-tight">{c.nickname}</div>
                              <div className="text-sm opacity-40 font-bold uppercase tracking-widest">{c.name}</div>
                            </div>
                          </div>
                          <div className="flex justify-between items-end border-t border-white/10 pt-8">
                             <div>
                               <span className="text-xs font-black uppercase opacity-40 mb-1 block">국가 자산(GP)</span>
                               <div className="text-5xl font-black text-emerald-400 tabular-nums">{c.gp}</div>
                             </div>
                             <span className={`px-8 py-3 rounded-2xl text-lg font-black uppercase ${c.lastChoice ? 'bg-blue-600 text-white animate-pulse' : 'bg-red-600/20 text-red-500'}`}>
                               {c.lastChoice ? '선택 완료' : '대기 중'}
                             </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {role === 'GUEST' && myCountryId && (
                  <div className="space-y-12 animate-in fade-in">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                       <div className="glass p-12 rounded-[5rem] border border-white/10 bg-gradient-to-br from-blue-600/20 to-transparent flex items-center gap-12 shadow-2xl relative overflow-hidden">
                          <span className="text-[180px] drop-shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-10">{gameState.countries[myCountryId].flag}</span>
                          <div className="z-10">
                            <div className="text-sm font-black uppercase tracking-[0.4em] text-blue-400 mb-2">Representing Territory</div>
                            <h2 className="text-8xl font-black italic tracking-tighter mb-6 text-white leading-none">{gameState.countries[myCountryId].nickname}</h2>
                            <div className="text-4xl font-black text-emerald-400 tabular-nums bg-black/60 px-12 py-5 rounded-3xl border-2 border-emerald-500/20 shadow-2xl inline-block italic">ASSET: {gameState.countries[myCountryId].gp} GP</div>
                          </div>
                       </div>
                       <div className="glass p-12 rounded-[5rem] border border-white/10 bg-gradient-to-br from-purple-600/20 to-transparent flex flex-col justify-center gap-6 shadow-2xl">
                          <h3 className="text-5xl font-black italic tracking-tighter text-purple-400 uppercase leading-none"><i className="fa-solid fa-crown mr-4"></i> {gameState.countries[myCountryId].abilityName}</h3>
                          <p className="text-2xl text-slate-300 font-medium leading-relaxed bg-black/40 p-8 rounded-3xl border border-white/10">{gameState.countries[myCountryId].abilityDesc}</p>
                       </div>
                    </div>

                    <div className="glass p-20 rounded-[6rem] border-2 border-white/10 min-h-[600px] flex flex-col items-center justify-center shadow-2xl bg-black/20">
                      {gameState.phase === 'DEVELOPMENT' ? (
                        <div className="w-full text-center space-y-20 animate-in zoom-in">
                          <h3 className="text-8xl font-black italic tracking-tighter uppercase text-white drop-shadow-2xl">전략 선택 (STRATEGY)</h3>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 max-w-7xl mx-auto">
                            {[
                               { id: 'ECONOMIC', label: '경제 중심', icon: 'fa-industry', color: 'orange', gp: '+10', desc: '고탄소 기반 성장을 강행하여 국부를 극대화합니다.' },
                               { id: 'BALANCED', label: '지속 성장', icon: 'fa-scale-balanced', color: 'emerald', gp: '+8', desc: '안정적인 정책으로 경제와 환경의 조화를 꾀합니다.' },
                               { id: 'ENVIRONMENTAL', label: '환경 우선', icon: 'fa-leaf', color: 'sky', gp: '+5', desc: '강력한 규제와 녹색 투자로 온난화를 막습니다.' }
                            ].map(btn => (
                              <button 
                                key={btn.id} 
                                onClick={() => { playSfx(SFX.CLICK); syncService.sendAction(gameState.roomId, { type: 'SELECT_DEVELOPMENT', countryId: myCountryId!, choice: btn.id }); }} 
                                className={`p-16 rounded-[4rem] border-4 transition-all group flex flex-col items-center shadow-2xl relative ${gameState.countries[myCountryId!].lastChoice === btn.id ? `bg-${btn.color}-600/40 border-${btn.color}-400 ring-[20px] ring-${btn.color}-500/10 scale-110 z-10` : 'bg-white/5 border-transparent hover:bg-white/10 hover:scale-105'}`}
                              >
                                <i className={`fa-solid ${btn.icon} text-[90px] mb-10 text-${btn.color}-400 group-hover:rotate-12 transition-transform duration-500`}></i>
                                <span className="text-5xl font-black italic uppercase tracking-tighter mb-4 text-white">{btn.label}</span>
                                <div className="text-3xl font-black text-white tabular-nums bg-black/40 px-10 py-3 rounded-full border border-white/10">{btn.gp} GP</div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="text-center space-y-12">
                           <div className="w-40 h-40 border-[16px] border-white/5 border-t-emerald-400 rounded-full animate-spin mx-auto shadow-[0_0_60px_rgba(52,211,153,0.2)]"></div>
                           <h3 className="text-6xl font-black italic tracking-tighter text-white/30 uppercase">전략 분석 및 사령부 명령 대기 중...</h3>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </div>
          </main>
        </div>
      )}
    </div>
  );
};

export default App;
