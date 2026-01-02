
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
    img: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&q=80&w=2000', 
    color: 'from-slate-900 to-slate-800', 
    label: '글로벌 대기실' 
  },
  SETUP: { 
    img: 'https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&q=80&w=2000', 
    color: 'from-emerald-900 to-slate-900', 
    label: '환경 데이터 설정' 
  },
  DEVELOPMENT: { 
    img: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80&w=2000', 
    color: 'from-blue-900 to-slate-900', 
    label: '국가 발전 전략 수립' 
  },
  QUIZ: { 
    img: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&q=80&w=2000', 
    color: 'from-purple-900 to-slate-900', 
    label: '실시간 환경 퀴즈' 
  },
  DISCUSSION: { 
    img: 'https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&q=80&w=2000', 
    color: 'from-amber-900 to-slate-900', 
    label: 'UN 기후 협상 회의' 
  },
  UN_MEETING: { 
    img: 'https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&q=80&w=2000', 
    color: 'from-amber-900 to-slate-900', 
    label: 'UN 특별 총회' 
  },
  END: { 
    img: '', 
    color: 'from-black to-slate-900', 
    label: '최종 결과 발표' 
  }
};

const App: React.FC = () => {
  const [role, setRole] = useState<'HOST' | 'GUEST' | null>(null);
  const [myCountryId, setMyCountryId] = useState<CountryId | null>(null);
  const [pendingCountryId, setPendingCountryId] = useState<CountryId | null>(null);
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
      tuvaluWaiting: false,
    }
  });

  const processedActionIds = useRef<Set<string>>(new Set());

  const playSfx = (url: string) => {
    const audio = new Audio(url);
    audio.volume = 0.4;
    audio.play().catch(() => {}); 
  };

  useEffect(() => {
    if (isRoomEntered && gameState.roomId) {
      if (role === 'GUEST') {
        const stopPolling = syncService.pollGameState(gameState.roomId, (newState) => {
          if (newState.phase !== gameState.phase) playSfx(SFX.TRANSITION);
          if (newState.temperature > gameState.temperature) playSfx(SFX.ALARM);
          setGameState(newState);
          if (nicknameInput && !myCountryId) {
            const me = (Object.values(newState.countries) as Country[]).find(c => c.nickname === nicknameInput);
            if (me) setMyCountryId(me.id as CountryId);
          }
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
            next.logs = [`${next.countries[cid].flag} ${action.nickname}(${next.countries[cid].name}) 입장!`, ...next.logs];
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
    if (cid === 'NKOREA') {
      state.temperature += 1.0;
      state.logs = ["💣 북한 핵 도발! 기온 +1.0℃", ...state.logs];
    }
    syncService.syncGameState(state);
    playSfx(SFX.TRANSITION);
  };

  const useAbility = () => {
    if (!myCountryId || !gameState.roomId) return;
    const country = gameState.countries[myCountryId];
    if (country.isAbilityUsed) return;

    if (myCountryId === 'JAPAN' || myCountryId === 'DENMARK') {
      if (gameState.temperature < 17) return alert("기온이 17.0°C 이상이어야 발동 가능합니다.");
    }
    if (myCountryId === 'TUVALU') {
      if (gameState.temperature < 18) return alert("기온이 18.0°C 이상이어야 발동 가능합니다.");
    }
    if (myCountryId === 'FRANCE') {
      if (gameState.temperature < 19) return alert("기온이 19.0°C 이상이어야 발동 가능합니다.");
    }

    playSfx(SFX.CLICK);
    syncService.sendAction(gameState.roomId, { 
      type: 'ACTIVATE_ABILITY', 
      countryId: myCountryId 
    });
  };

  const handleEnterRoom = async (r: 'HOST' | 'GUEST') => {
    const rid = roomInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!rid) return alert("방 코드는 대문자와 숫자만 사용 가능합니다.");
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
      console.error("Enter room error", e);
      alert("방 입장에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsConnecting(false);
    }
  };

  const nextPhase = () => {
    if (gameState.phase === 'SETUP' && gameState.selectedQuizIds.length !== MAX_TURNS) {
      alert(`정확히 ${MAX_TURNS}개의 문제를 선택해야 합니다. (현재: ${gameState.selectedQuizIds.length}개)`);
      return;
    }

    playSfx(SFX.TRANSITION);
    setGameState(prev => {
      let next = { ...prev };
      if (next.phase === 'LOBBY') next.phase = 'SETUP';
      else if (next.phase === 'SETUP') { next.phase = 'DEVELOPMENT'; next.timer = 30; }
      else if (next.phase === 'DEVELOPMENT') { 
        next.phase = 'QUIZ'; 
        next.timer = 60; 
        next.currentQuizId = next.selectedQuizIds[next.turn - 1];
      }
      else if (next.phase === 'QUIZ') { next.phase = 'DISCUSSION'; next.timer = 180; }
      else if (next.phase === 'DISCUSSION') {
        if (next.turn === MAX_TURNS) next.phase = 'END';
        else { next.turn++; next.phase = 'DEVELOPMENT'; next.timer = 30; }
      }
      syncService.syncGameState(next);
      return next;
    });
  };

  const addTime = (sec: number) => {
    playSfx(SFX.CLICK);
    setGameState(prev => {
      const next = { ...prev, timer: prev.timer + sec };
      syncService.syncGameState(next);
      return next;
    });
  };

  const adjustTemp = (amount: number) => {
    playSfx(SFX.CLICK);
    setGameState(prev => {
      const nextTemp = Math.min(MAX_TEMPERATURE, Math.max(INITIAL_TEMPERATURE, prev.temperature + amount));
      const next = { ...prev, temperature: nextTemp };
      next.logs = [`📡 교사가 지구 기온을 ${amount > 0 ? '상승' : '하강'}시켰습니다. (${amount.toFixed(1)}℃)`, ...next.logs];
      syncService.syncGameState(next);
      return next;
    });
  };

  const toggleQuizSelection = (quizId: number) => {
    playSfx(SFX.CLICK);
    setGameState(prev => {
      const isSelected = prev.selectedQuizIds.includes(quizId);
      let nextSelected: number[];
      if (isSelected) {
        nextSelected = prev.selectedQuizIds.filter(id => id !== quizId);
      } else {
        if (prev.selectedQuizIds.length >= MAX_TURNS) {
          alert(`최대 ${MAX_TURNS}개까지만 선택 가능합니다.`);
          return prev;
        }
        nextSelected = [...prev.selectedQuizIds, quizId];
      }
      return { ...prev, selectedQuizIds: nextSelected };
    });
  };

  const handleAddQuiz = () => {
    if (!newQuiz.question.trim()) return;
    const q: QuizQuestion = {
      id: Date.now(),
      question: newQuiz.question,
      options: [...newQuiz.options],
      answer: newQuiz.answer,
      explanation: '교사 추가 문제'
    };
    setGameState(prev => {
      const nextSelected = prev.selectedQuizIds.length < MAX_TURNS ? [...prev.selectedQuizIds, q.id] : prev.selectedQuizIds;
      return { ...prev, customQuizzes: [...prev.customQuizzes, q], selectedQuizIds: nextSelected };
    });
    setNewQuiz({ question: '', options: ['', '', '', ''], answer: 0 });
    playSfx(SFX.SUCCESS);
  };

  const downloadCSVTemplate = () => {
    const csv = "질문,보기1,보기2,보기3,보기4,정답번호(1-4)\n기후위기의 원인은?,이산화탄소,산소,질소,수소,1";
    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "quiz_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n').slice(1);
      const newQuizzes: QuizQuestion[] = lines.filter(l => l.trim()).map((line, idx) => {
        const parts = line.split(',');
        const rawAnswer = parseInt(parts[5]) || 1;
        const internalAnswer = Math.max(0, Math.min(3, rawAnswer - 1));
        return {
          id: Date.now() + idx,
          question: parts[0] || '질문 없음',
          options: [parts[1] || '', parts[2] || '', parts[3] || '', parts[4] || ''],
          answer: internalAnswer,
          explanation: '엑셀 업로드 문제'
        };
      });
      setGameState(prev => {
        const addedIds = newQuizzes.map(q => q.id);
        let nextSelected = [...prev.selectedQuizIds];
        for (const id of addedIds) {
          if (nextSelected.length < MAX_TURNS && !nextSelected.includes(id)) nextSelected.push(id);
        }
        return { ...prev, customQuizzes: [...prev.customQuizzes, ...newQuizzes], selectedQuizIds: nextSelected };
      });
      playSfx(SFX.SUCCESS);
      alert(`${newQuizzes.length}개의 문제가 추가되었습니다!`);
    };
    reader.readAsText(file, 'euc-kr');
  };

  const currentTheme = PHASE_THEMES[gameState.phase];

  const renderLobby = () => (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 animate-in fade-in duration-700 relative overflow-hidden">
      <div className="absolute inset-0 z-0">
        <img src={currentTheme.img} className="w-full h-full object-cover opacity-30 blur-sm scale-105" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-slate-900/50 to-slate-900"></div>
      </div>
      
      <div className="relative z-10 text-center space-y-12 w-full max-w-6xl">
        <div className="animate-bounce-slow">
          <i className="fa-solid fa-earth-asia text-[120px] text-emerald-400 drop-shadow-[0_0_50px_rgba(52,211,153,0.6)]"></i>
        </div>
        <h1 className="text-9xl font-black tracking-tighter italic">CLIMATE <span className="text-emerald-400">WAR</span></h1>
        <p className="text-2xl text-slate-300 font-bold uppercase tracking-[0.4em] mt-2">Global Negotiation Battle</p>

        <div className="w-full mx-auto space-y-6 pt-10">
          {!role ? (
            <div className="max-w-md mx-auto space-y-6">
              <input type="text" placeholder="방 코드(예:ROOM1)" value={roomInput} onChange={(e) => setRoomInput(e.target.value.toUpperCase())} className="w-full p-6 bg-white/10 backdrop-blur-md border-2 border-white/20 rounded-3xl text-center text-4xl font-black outline-none focus:border-emerald-500 transition-all text-white placeholder:text-white/30" />
              <input type="text" placeholder="내 닉네임" value={nicknameInput} onChange={(e) => setNicknameInput(e.target.value)} className="w-full p-5 bg-white/10 backdrop-blur-md border border-white/10 rounded-2xl text-center text-2xl font-bold outline-none text-white placeholder:text-white/30" />
              <div className="grid grid-cols-2 gap-6">
                <button disabled={isConnecting} onClick={() => handleEnterRoom('HOST')} className="p-8 bg-emerald-600 hover:bg-emerald-500 rounded-[2rem] font-black text-2xl shadow-2xl transition-all active:scale-95 disabled:opacity-50">교사(방장)</button>
                <button disabled={isConnecting} onClick={() => handleEnterRoom('GUEST')} className="p-8 bg-blue-600 hover:bg-blue-500 rounded-[2rem] font-black text-2xl shadow-2xl transition-all active:scale-95 disabled:opacity-50">학생(참가)</button>
              </div>
            </div>
          ) : role === 'HOST' ? (
            <div className="glass p-12 rounded-[4rem] border border-white/20 shadow-2xl animate-in zoom-in text-left">
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-4xl font-black text-emerald-400 tracking-tighter uppercase"><i className="fa-solid fa-door-open mr-4"></i> 대기실: #{gameState.roomId}</h2>
                <div className="bg-white/10 px-6 py-2 rounded-full font-bold">참가 현황: {(Object.values(gameState.countries) as Country[]).filter(c=>c.isJoined).length} / 9</div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-12">
                {(Object.values(gameState.countries) as Country[]).map(c => (
                  <div key={c.id} className={`p-8 rounded-[3rem] border-4 transition-all flex items-center gap-10 min-h-[160px] ${c.isJoined ? 'bg-emerald-500/20 border-emerald-500 scale-105 shadow-xl' : 'bg-white/5 border-white/5 opacity-30'}`}>
                    <span className="text-8xl shrink-0 drop-shadow-lg">{c.flag}</span>
                    <div className="text-left overflow-hidden flex-1">
                      <div className="text-base opacity-60 font-black uppercase tracking-widest mb-2 truncate">{c.name}</div>
                      <div className="text-3xl font-extrabold truncate text-white leading-tight">
                        {c.nickname || <span className="text-white/20 italic">입장 대기 중...</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={nextPhase} className="w-full p-10 bg-emerald-500 hover:bg-emerald-400 rounded-[3rem] font-black text-4xl shadow-[0_20px_60px_rgba(16,185,129,0.4)] transition-all transform hover:scale-[1.02] active:scale-95">모든 국가 준비 완료 - 게임 시작 ▶</button>
            </div>
          ) : !myCountryId ? (
            <div className="space-y-8 animate-in slide-in-from-bottom-10 text-left w-full">
              <div className="glass p-12 rounded-[4rem] border border-white/10 shadow-xl max-w-5xl mx-auto">
                <h2 className="text-4xl font-black mb-10 text-left italic tracking-tighter flex items-center gap-4 text-emerald-400">
                  <i className="fa-solid fa-earth-americas"></i>
                  국가 대표부 선택
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-6">
                  {(Object.values(gameState.countries) as Country[]).map(c => {
                    const isTaken = c.isJoined && c.nickname !== nicknameInput;
                    return (
                      <button 
                        key={c.id} 
                        disabled={isTaken}
                        onClick={() => { playSfx(SFX.CLICK); setPendingCountryId(c.id); }}
                        className={`p-8 rounded-[2.5rem] border-4 transition-all flex flex-col items-center gap-4 text-center group min-h-[180px] justify-center ${pendingCountryId === c.id ? 'bg-blue-600 border-blue-400 scale-105 shadow-2xl z-10' : isTaken ? 'opacity-20 grayscale border-transparent' : 'bg-white/5 border-white/10 hover:border-white/30 hover:bg-white/10'}`}
                      >
                        <span className="text-7xl group-hover:scale-110 transition-transform">{c.flag}</span>
                        <div className="text-xl font-black tracking-tight text-white uppercase">{c.name}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              
              {pendingCountryId && (
                <div className="glass p-12 rounded-[4rem] border-4 border-blue-500/50 bg-blue-900/10 text-center space-y-8 animate-in zoom-in max-w-3xl mx-auto shadow-2xl">
                  <div className="flex items-center justify-center gap-6">
                    <span className="text-9xl">{gameState.countries[pendingCountryId].flag}</span>
                    <h3 className="text-6xl font-black tracking-tighter italic uppercase text-white">{gameState.countries[pendingCountryId].name}</h3>
                  </div>
                  <div className="bg-black/40 p-10 rounded-[2.5rem] text-left border border-white/10 shadow-inner">
                    <div className="text-emerald-400 font-black text-2xl mb-4 flex items-center gap-3">
                      <i className="fa-solid fa-wand-magic-sparkles"></i> 
                      전용 능력: {gameState.countries[pendingCountryId].abilityName}
                    </div>
                    <p className="text-2xl text-slate-200 font-medium leading-relaxed">{gameState.countries[pendingCountryId].abilityDesc}</p>
                  </div>
                  <button onClick={() => { playSfx(SFX.CLICK); syncService.sendAction(gameState.roomId, { type: 'JOIN', countryId: pendingCountryId, nickname: nicknameInput }); }} className="w-full p-8 bg-blue-600 hover:bg-blue-500 rounded-[2rem] font-black text-4xl shadow-2xl transition-all transform hover:scale-[1.02] active:scale-95">해당 국가 대표로 활동 시작</button>
                </div>
              )}
            </div>
          ) : (
            <div className="glass p-20 rounded-[4rem] border border-white/20 text-center animate-in zoom-in shadow-2xl max-w-2xl mx-auto">
               <span className="text-[160px] block mb-10 drop-shadow-2xl animate-pulse">{gameState.countries[myCountryId].flag}</span>
               <h2 className="text-7xl font-black mb-6 tracking-tighter italic text-emerald-400">{gameState.countries[myCountryId].name} 대표 입장!</h2>
               <p className="text-3xl text-slate-300 font-bold mb-16">교사가 게임을 시작할 때까지 잠시 대기해주세요.</p>
               <div className="w-32 h-32 border-[16px] border-emerald-400 border-t-transparent rounded-full animate-spin mx-auto shadow-[0_0_50px_rgba(52,211,153,0.3)]"></div>
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
          <div className="relative h-[450px] w-full overflow-hidden shadow-2xl">
            <img src={currentTheme.img} className="absolute inset-0 w-full h-full object-cover transform scale-105" />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/30 to-transparent"></div>
            
            <div className="absolute bottom-0 left-0 w-full p-12 md:p-20 flex flex-col md:flex-row justify-between items-end gap-10">
              <div className="flex items-center gap-12">
                <div className="w-32 h-32 glass rounded-[2.5rem] flex items-center justify-center text-7xl text-white shadow-2xl animate-pulse">
                  {gameState.phase === 'DEVELOPMENT' && <i className="fa-solid fa-industry"></i>}
                  {gameState.phase === 'QUIZ' && <i className="fa-solid fa-bolt-lightning"></i>}
                  {gameState.phase === 'DISCUSSION' && <i className="fa-solid fa-comments"></i>}
                  {gameState.phase === 'SETUP' && <i className="fa-solid fa-database"></i>}
                </div>
                <div>
                  <h1 className="text-8xl font-black italic uppercase tracking-tighter text-white drop-shadow-[0_10px_20px_rgba(0,0,0,0.8)] leading-none">{gameState.phase}</h1>
                  <p className="text-3xl font-bold text-emerald-400 tracking-widest uppercase mt-4 drop-shadow-md">{currentTheme.label} • ROUND {gameState.turn}</p>
                </div>
              </div>
              
              <div className="text-right space-y-6">
                <div className="flex flex-col items-end gap-2">
                  <div className="text-7xl font-black tabular-nums text-white drop-shadow-lg bg-black/40 backdrop-blur-xl px-12 py-4 rounded-full border border-white/10">{gameState.timer}s</div>
                  {role === 'HOST' && (
                    <div className="flex gap-2">
                      <button onClick={() => addTime(10)} className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded-xl font-bold border border-white/20 transition-all">+ 10s</button>
                      <button onClick={() => addTime(60)} className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded-xl font-bold border border-white/20 transition-all">+ 1m</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <main className="max-w-[1700px] mx-auto p-12 space-y-12">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
              {/* 좌측 정보 바 (3/12) */}
              <aside className="lg:col-span-3 space-y-10">
                <div className="space-y-4">
                  <TemperatureGauge temp={gameState.temperature} />
                  {role === 'HOST' && (
                    <div className="glass p-6 rounded-3xl border-2 border-emerald-500/30 flex flex-col gap-4 bg-emerald-500/5">
                      <h4 className="text-sm font-black text-center uppercase opacity-70 tracking-widest flex items-center justify-center gap-2">
                        <i className="fa-solid fa-temperature-half text-emerald-400"></i>
                        수동 기온 조절
                      </h4>
                      <div className="grid grid-cols-2 gap-4">
                        <button 
                          onClick={() => adjustTemp(-0.2)} 
                          className="group p-5 bg-blue-600/80 hover:bg-blue-500 rounded-2xl font-black text-2xl shadow-xl transition-all active:scale-95 flex flex-col items-center"
                        >
                          <i className="fa-solid fa-chevron-down text-sm opacity-50 mb-1 group-hover:-translate-y-1 transition-transform"></i>
                          - 0.2℃
                        </button>
                        <button 
                          onClick={() => adjustTemp(0.2)} 
                          className="group p-5 bg-red-600/80 hover:bg-red-500 rounded-2xl font-black text-2xl shadow-xl transition-all active:scale-95 flex flex-col items-center"
                        >
                          <i className="fa-solid fa-chevron-up text-sm opacity-50 mb-1 group-hover:translate-y-1 transition-transform"></i>
                          + 0.2℃
                        </button>
                      </div>
                      <p className="text-[10px] text-center opacity-40 font-bold uppercase">교사 전용 제어기</p>
                    </div>
                  )}
                </div>
                
                <div className="glass p-8 rounded-[3rem] h-[650px] flex flex-col border border-white/10 shadow-2xl">
                   <h3 className="text-xs font-black uppercase opacity-40 mb-6 tracking-widest flex items-center gap-3"><i className="fa-solid fa-tower-broadcast"></i> 글로벌 실시간 로그</h3>
                   <div className="overflow-y-auto flex-1 space-y-4 pr-3 custom-scrollbar">
                      {gameState.logs.map((log, i) => (
                        <div key={i} className="text-lg border-l-4 border-emerald-500/50 pl-5 py-3 font-semibold leading-relaxed animate-in slide-in-from-left-4 bg-white/5 rounded-r-xl">
                          <span className={log.includes('기온') ? 'text-red-400 font-black' : log.includes('입장') ? 'text-emerald-400' : ''}>{log}</span>
                        </div>
                      ))}
                   </div>
                </div>
              </aside>

              {/* 중앙 콘텐츠 영역 (9/12) */}
              <section className="lg:col-span-9">
                {role === 'HOST' && gameState.phase === 'SETUP' && (
                  <div className="glass p-12 rounded-[4rem] border border-white/10 space-y-12 animate-in zoom-in">
                    <div className="flex justify-between items-center">
                       <h2 className="text-5xl font-black italic tracking-tighter">QUIZ SELECTION</h2>
                       <button 
                        disabled={gameState.selectedQuizIds.length !== MAX_TURNS}
                        onClick={nextPhase} 
                        className={`px-16 py-6 rounded-full font-black text-3xl shadow-2xl transition-all ${gameState.selectedQuizIds.length === MAX_TURNS ? 'bg-emerald-500 hover:bg-emerald-400 shadow-[0_15px_40px_rgba(16,185,129,0.3)]' : 'bg-slate-700 opacity-50'}`}
                       >
                         {gameState.selectedQuizIds.length === MAX_TURNS ? '라운드 시작하기 ▶' : `${MAX_TURNS - gameState.selectedQuizIds.length}개 더 선택`}
                       </button>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-6">
                         <div className="p-10 bg-black/40 rounded-[2.5rem] border border-white/10 space-y-8">
                            <h3 className="text-3xl font-black italic"><i className="fa-solid fa-plus mr-3 text-emerald-400"></i> 직접 문제 출제</h3>
                            <input type="text" placeholder="질문을 입력하세요" value={newQuiz.question} onChange={e => setNewQuiz({...newQuiz, question: e.target.value})} className="w-full p-6 bg-white/5 rounded-2xl border border-white/10 font-bold text-xl outline-none focus:border-emerald-500" />
                            <div className="grid grid-cols-2 gap-4">
                              {newQuiz.options.map((opt, i) => (
                                <input key={i} type="text" placeholder={`보기 ${i+1}`} value={opt} onChange={e => { const opts = [...newQuiz.options]; opts[i] = e.target.value; setNewQuiz({...newQuiz, options: opts}); }} className={`p-4 bg-white/5 rounded-xl border-2 transition-all ${newQuiz.answer === i ? 'border-emerald-500 bg-emerald-500/10' : 'border-white/10'}`} onClick={() => setNewQuiz({...newQuiz, answer: i})} />
                              ))}
                            </div>
                            <button onClick={handleAddQuiz} className="w-full p-6 bg-blue-600 rounded-2xl font-black text-2xl shadow-xl hover:bg-blue-500">문제 추가 및 목록 반영</button>
                         </div>
                         <div className="flex gap-4">
                            <button onClick={downloadCSVTemplate} className="flex-1 p-6 bg-slate-700 rounded-2xl font-bold flex items-center justify-center gap-3"><i className="fa-solid fa-download"></i> 양식 받기</button>
                            <label className="flex-1 p-6 bg-amber-600 rounded-2xl font-bold text-center cursor-pointer flex items-center justify-center gap-3">
                              <i className="fa-solid fa-upload"></i> 엑셀 업로드
                              <input type="file" accept=".csv" onChange={handleExcelUpload} className="hidden" />
                            </label>
                         </div>
                      </div>
                      
                      <div className="p-10 bg-black/40 rounded-[2.5rem] border border-white/10 flex flex-col h-[650px]">
                        <div className="flex justify-between items-center mb-8">
                          <h3 className="text-3xl font-black italic">문제 리스트</h3>
                          <span className="bg-emerald-500 px-4 py-1 rounded-full text-lg font-black">{gameState.selectedQuizIds.length} / {MAX_TURNS}</span>
                        </div>
                        <div className="overflow-y-auto flex-1 space-y-4 pr-3 custom-scrollbar">
                          {[...gameState.customQuizzes, ...QUIZ_POOL].map(q => (
                            <div 
                              key={q.id} 
                              onClick={() => toggleQuizSelection(q.id)}
                              className={`p-6 rounded-2xl border-2 transition-all cursor-pointer flex justify-between items-center ${gameState.selectedQuizIds.includes(q.id) ? 'bg-emerald-500/20 border-emerald-500 scale-[1.02]' : 'bg-white/5 border-transparent hover:bg-white/10'}`}
                            >
                              <span className="font-bold text-lg leading-snug">{q.question}</span>
                              {gameState.selectedQuizIds.includes(q.id) && <i className="fa-solid fa-circle-check text-emerald-400 text-2xl"></i>}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {role === 'HOST' && gameState.phase !== 'SETUP' && (
                  <div className="glass p-12 rounded-[4rem] border border-white/10 h-full min-h-[800px] flex flex-col shadow-2xl">
                    <div className="flex justify-between items-center mb-12">
                      <h2 className="text-6xl font-black italic tracking-tighter uppercase text-white/90">HOST CONTROL CENTER</h2>
                      <button onClick={nextPhase} className="px-20 py-8 bg-indigo-600 hover:bg-indigo-500 rounded-[3rem] font-black text-4xl shadow-[0_20px_50px_rgba(79,70,229,0.4)] active:scale-95 transition-all">NEXT PHASE ▶</button>
                    </div>
                    
                    {gameState.phase === 'QUIZ' && (
                      <div className="mb-12 p-12 bg-emerald-500/10 rounded-[4rem] border-4 border-emerald-500/50 text-center space-y-10 animate-in zoom-in shadow-[0_0_60px_rgba(16,185,129,0.2)]">
                        {(() => {
                          const q = [...gameState.customQuizzes, ...QUIZ_POOL].find(q => q.id === gameState.currentQuizId);
                          return q ? (
                            <>
                              <h3 className="text-4xl font-black text-emerald-400 italic tracking-widest uppercase">ROUND {gameState.turn} QUIZ</h3>
                              <p className="text-7xl font-black leading-tight tracking-tighter text-white drop-shadow-lg">{q.question}</p>
                              <div className="grid grid-cols-2 gap-10 text-left max-w-6xl mx-auto pt-10">
                                {q.options.map((opt, i) => (
                                  <div key={i} className="p-10 bg-white/5 rounded-[3rem] border-2 border-white/10 flex items-center gap-10 group hover:border-emerald-500 transition-all">
                                    <span className="w-20 h-20 bg-emerald-500 rounded-2xl flex items-center justify-center font-black text-5xl text-slate-900 shadow-xl">{i+1}</span>
                                    <span className="text-5xl font-bold group-hover:text-emerald-400 transition-colors">{opt}</span>
                                  </div>
                                ))}
                              </div>
                            </>
                          ) : null;
                        })()}
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
                      {(Object.values(gameState.countries) as Country[]).filter(c=>c.isJoined).map(c => (
                        <div key={c.id} className="p-10 bg-white/5 rounded-[3.5rem] border-2 border-white/5 flex flex-col gap-8 shadow-xl relative overflow-hidden group hover:bg-white/10 transition-all">
                          <div className="flex items-center gap-8">
                            <span className="text-8xl group-hover:rotate-12 transition-transform duration-500">{c.flag}</span>
                            <div className="text-left overflow-hidden">
                              <div className="text-4xl font-black italic text-white truncate leading-tight">{c.nickname}</div>
                              <div className="text-sm opacity-40 font-bold uppercase tracking-[0.2em]">{c.name}</div>
                            </div>
                          </div>
                          <div className="flex justify-between items-end border-t border-white/10 pt-8">
                             <div className="flex flex-col">
                               <span className="text-xs font-black uppercase opacity-40 mb-1">Total Assets</span>
                               <div className="text-5xl font-black text-emerald-400 tabular-nums">{c.gp} <span className="text-lg opacity-40">GP</span></div>
                             </div>
                             <span className={`px-8 py-3 rounded-2xl text-lg font-black uppercase tracking-tighter ${c.lastChoice ? 'bg-blue-600 text-white animate-pulse' : 'bg-red-500/20 text-red-400'}`}>
                               {c.lastChoice ? 'DECIDED' : 'WAITING'}
                             </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {role === 'GUEST' && (
                  <div className="space-y-12">
                    {myCountryId && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                         <div className="glass p-12 rounded-[5rem] border border-white/10 bg-gradient-to-br from-blue-600/30 to-transparent flex items-center gap-16 shadow-2xl relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-12 opacity-5 text-[300px] pointer-events-none group-hover:scale-110 transition-transform duration-1000">
                              {gameState.countries[myCountryId].flag}
                            </div>
                            <span className="text-[180px] drop-shadow-[0_20px_40px_rgba(0,0,0,0.5)] z-10">{gameState.countries[myCountryId].flag}</span>
                            <div className="z-10">
                              <div className="text-xs font-black uppercase tracking-[0.5em] text-blue-400 mb-2">Representing</div>
                              <h2 className="text-8xl font-black italic tracking-tighter mb-6 text-white leading-none">{gameState.countries[myCountryId].nickname}</h2>
                              <div className="text-4xl font-black text-emerald-400 tabular-nums bg-black/50 px-12 py-5 rounded-full border-2 border-emerald-500/30 shadow-2xl inline-block">ASSET: {gameState.countries[myCountryId].gp} GP</div>
                            </div>
                         </div>
                         <div className="glass p-12 rounded-[5rem] border border-white/10 bg-gradient-to-br from-purple-600/30 to-transparent flex flex-col justify-center gap-8 shadow-2xl">
                            <div className="flex justify-between items-center">
                              <h3 className="text-5xl font-black italic tracking-tighter text-purple-400 uppercase leading-none"><i className="fa-solid fa-sparkles mr-4"></i> {gameState.countries[myCountryId].abilityName}</h3>
                              <button disabled={gameState.countries[myCountryId].isAbilityUsed} onClick={useAbility} className={`px-14 py-6 rounded-[2.5rem] font-black text-3xl shadow-xl transition-all active:scale-95 ${gameState.countries[myCountryId!].isAbilityUsed ? 'bg-slate-700 opacity-50' : 'bg-purple-600 hover:bg-purple-500 shadow-[0_20px_50px_rgba(147,51,234,0.5)]'}`}>ACTIVATE</button>
                            </div>
                            <p className="text-2xl text-slate-200 font-medium leading-relaxed bg-black/20 p-8 rounded-3xl border border-white/5">{gameState.countries[myCountryId].abilityDesc}</p>
                         </div>
                      </div>
                    )}

                    <div className="glass p-20 rounded-[6rem] border border-white/10 min-h-[700px] flex flex-col items-center justify-center shadow-2xl relative overflow-hidden">
                      {gameState.phase === 'DEVELOPMENT' ? (
                        <div className="w-full text-center space-y-20 animate-in zoom-in">
                          <h3 className="text-8xl font-black italic tracking-tighter uppercase text-white drop-shadow-lg">NATIONAL STRATEGY</h3>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 max-w-7xl mx-auto">
                            {[
                               { id: 'ECONOMIC', label: '경제 중심', icon: 'fa-industry', color: 'orange', gp: '+10', desc: '고탄소 기반 성장을 강행하여 국부(GP)를 극대화합니다.' },
                               { id: 'BALANCED', label: '지속 성장', icon: 'fa-scale-balanced', color: 'emerald', gp: '+8', desc: '안정적인 투자와 정책으로 경제/환경의 조화를 꾀합니다.' },
                               { id: 'ENVIRONMENTAL', label: '환경 우선', icon: 'fa-leaf', color: 'sky', gp: '+5', desc: '강력한 규제와 녹색 기술 투부로 지구 온난화를 막습니다.' }
                            ].map(btn => (
                              <button 
                                key={btn.id} 
                                onClick={() => { playSfx(SFX.CLICK); syncService.sendAction(gameState.roomId, { type: 'SELECT_DEVELOPMENT', countryId: myCountryId!, choice: btn.id }); }} 
                                className={`p-16 rounded-[5rem] border-4 transition-all group flex flex-col items-center shadow-2xl relative ${gameState.countries[myCountryId!].lastChoice === btn.id ? `bg-${btn.color}-600/40 border-${btn.color}-400 ring-[25px] ring-${btn.color}-500/20 scale-110 z-10` : 'bg-white/5 border-transparent hover:bg-white/10 hover:scale-105'}`}
                              >
                                <i className={`fa-solid ${btn.icon} text-[100px] mb-12 text-${btn.color}-400 group-hover:scale-110 transition-transform duration-500`}></i>
                                <span className="text-5xl font-black italic uppercase tracking-tighter mb-6 text-white">{btn.label}</span>
                                <div className="text-lg opacity-60 font-medium leading-relaxed mb-10 px-6">{btn.desc}</div>
                                <div className="text-4xl font-black text-white tabular-nums bg-black/40 px-10 py-4 rounded-full border border-white/10 shadow-inner">GAIN {btn.gp} GP</div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : gameState.phase === 'QUIZ' ? (
                        <div className="w-full max-w-6xl text-center space-y-20 animate-in zoom-in">
                          <h3 className="text-8xl font-black italic tracking-tighter uppercase text-emerald-400 drop-shadow-2xl">DECIDE NOW!</h3>
                          <p className="text-5xl font-bold leading-relaxed text-white/90">교사 화면의 퀴즈 내용을 확인하고<br/><span className="text-emerald-300">정답 번호</span>를 신속하게 터치하세요!</p>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
                            {[1, 2, 3, 4].map(num => (
                              <button 
                                key={num}
                                onClick={() => {
                                  playSfx(SFX.CLICK);
                                  const q = [...gameState.customQuizzes, ...QUIZ_POOL].find(q => q.id === gameState.currentQuizId);
                                  if (q) {
                                    syncService.sendAction(gameState.roomId, {
                                      type: 'QUIZ_RESULT',
                                      countryId: myCountryId,
                                      correct: (num - 1) === q.answer
                                    });
                                  }
                                }}
                                className="p-20 bg-white/10 hover:bg-emerald-500 rounded-[4rem] border-4 border-white/10 font-black text-8xl transition-all active:scale-95 shadow-[0_25px_60px_rgba(0,0,0,0.5)] hover:text-slate-900 hover:scale-105"
                              >
                                {num}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="text-center space-y-16">
                           <div className="w-48 h-48 border-[20px] border-white/10 border-t-emerald-400 rounded-full animate-spin mx-auto shadow-[0_0_80px_rgba(52,211,153,0.3)]"></div>
                           <h3 className="text-7xl font-black italic tracking-tighter text-white/40 uppercase">Awaiting Next Global Order...</h3>
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

      {/* 최종 결과 화면 */}
      {gameState.phase === 'END' && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-black animate-in fade-in duration-1000">
           <div className="absolute inset-0 z-0">
             <img src={gameState.temperature >= 20 ? 'https://images.unsplash.com/photo-1473081556163-2a17de81fc97?auto=format&fit=crop&q=80&w=2000' : 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&q=80&w=2000'} className="w-full h-full object-cover opacity-50" />
             <div className="absolute inset-0 bg-black/60"></div>
           </div>
           
           <div className={`relative z-10 w-full max-w-[1400px] p-24 rounded-[7rem] border-[24px] text-center shadow-[0_0_200px_rgba(0,0,0,1)] glass backdrop-blur-3xl ${gameState.temperature >= 20 ? 'border-red-600 bg-red-950/40' : 'border-emerald-500 bg-emerald-950/40'}`}>
              <h1 className="text-[200px] font-black mb-12 tracking-tighter uppercase italic leading-none drop-shadow-2xl text-white">
                {gameState.temperature >= 20 ? 'WORLD FAILED' : 'WORLD SAVED'}
              </h1>
              <div className="text-9xl font-black mb-24 italic tracking-tighter text-white">FINAL TEMP: <span className={`px-24 py-8 rounded-[5rem] bg-black/70 shadow-2xl ${gameState.temperature >= 20 ? 'text-red-500 animate-crisis' : 'text-emerald-400'}`}>{gameState.temperature.toFixed(1)}℃</span></div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 text-left">
                 {(Object.values(gameState.countries) as Country[]).filter(c=>c.isJoined).sort((a,b)=>b.gp - a.gp).map((c, idx) => (
                   <div key={c.id} className="bg-white/10 backdrop-blur-2xl p-12 rounded-[5rem] border border-white/10 flex justify-between items-center shadow-2xl hover:bg-white/20 transition-all transform hover:scale-105">
                      <div className="flex items-center gap-10">
                         <span className="text-7xl font-black text-white/20 italic">#{idx+1}</span>
                         <span className="text-[120px] drop-shadow-[0_10px_20px_rgba(0,0,0,0.5)]">{c.flag}</span>
                         <div className="flex flex-col">
                           <span className="text-5xl font-black italic text-white leading-tight">{c.nickname}</span>
                           <span className="text-sm font-bold opacity-40 uppercase tracking-[0.3em]">{c.name}</span>
                         </div>
                      </div>
                      <div className="text-right">
                         <div className="text-7xl font-black text-emerald-400 tabular-nums leading-none">{c.gp}<br/><span className="text-2xl opacity-40">GP</span></div>
                      </div>
                   </div>
                 ))}
              </div>
              <button onClick={() => window.location.reload()} className="mt-24 px-48 py-16 bg-white text-slate-900 rounded-full font-black text-7xl shadow-[0_40px_120px_rgba(255,255,255,0.4)] hover:scale-105 active:scale-95 transition-all italic tracking-tighter">RESTART CAMPAIGN</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
