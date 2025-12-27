
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { GameState, GamePhase, CountryId, Country, QuizQuestion, RPSResult } from './types';
import { COUNTRIES, INITIAL_TEMPERATURE, MAX_TEMPERATURE, MAX_TURNS, QUIZ_POOL } from './constants';
import * as syncService from './services/syncService';
import TemperatureGauge from './components/TemperatureGauge';

const App: React.FC = () => {
  const [role, setRole] = useState<'HOST' | 'GUEST' | null>(null);
  const [myCountryId, setMyCountryId] = useState<CountryId | null>(null);
  const [roomInput, setRoomInput] = useState('');
  const [isRoomEntered, setIsRoomEntered] = useState(false);
  const pollingRef = useRef<() => void>();

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

  // --- 실시간 동기화 (기기간 통신) ---
  useEffect(() => {
    if (isRoomEntered && role === 'GUEST') {
      const stopPolling = syncService.pollGameState(gameState.roomId, (newState) => {
        setGameState(newState);
        // 내 국가가 이미 점유되었는지 확인
        if (myCountryId && newState.countries[myCountryId].isJoined && !myCountryId) {
           // 다른 기기에서 먼저 선택한 경우에 대한 처리 가능
        }
      });
      return () => { if (typeof stopPolling === 'function') (stopPolling as any)(); };
    }
  }, [isRoomEntered, role, gameState.roomId]);

  useEffect(() => {
    if (isRoomEntered && role === 'HOST') {
      const stopJoins = syncService.pollJoins(gameState.roomId, (countryId) => {
        setGameState(prev => {
          if (prev.countries[countryId as CountryId].isJoined) return prev;
          const next = { ...prev };
          next.countries[countryId as CountryId].isJoined = true;
          next.logs = [`${next.countries[countryId as CountryId].flag} ${next.countries[countryId as CountryId].name} 대표가 입장했습니다.`, ...next.logs];
          syncService.syncGameState(next);
          return next;
        });
      });
      return () => { if (typeof stopJoins === 'function') (stopJoins as any)(); };
    }
  }, [isRoomEntered, role, gameState.roomId]);

  // --- 타이머 및 자동 상태 저장 (호스트) ---
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

  // --- 방 입장 ---
  const handleEnterRoom = (r: 'HOST' | 'GUEST') => {
    if (!roomInput.trim()) return alert("방 코드를 입력하세요.");
    setRole(r);
    setGameState(prev => ({ ...prev, roomId: roomInput }));
    setIsRoomEntered(true);
    if (r === 'HOST') syncService.syncGameState({ ...gameState, roomId: roomInput });
  };

  // --- 단계 관리 (호스트) ---
  const startTurn = () => {
    if (gameState.selectedQuizIds.length === 0) return alert("최소 1개의 퀴즈를 선택해야 합니다.");
    const next: GameState = { 
      ...gameState, 
      phase: 'DEVELOPMENT', 
      timer: 30,
      logs: [`🚀 제 ${gameState.turn}턴 시작! 개발 계획을 수립하세요.`, ...gameState.logs]
    };
    Object.keys(next.countries).forEach(k => next.countries[k as CountryId].lastChoice = null);
    setGameState(next);
    syncService.syncGameState(next);
  };

  const nextPhase = async () => {
    let next = { ...gameState };
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
        // AI 분석 실행 (Gemini API)
        await performAIMeetingAnalysis(next);
      } else if (next.turn === MAX_TURNS || next.temperature >= MAX_TEMPERATURE) {
        next.phase = 'END';
        calculateFinalScores(next);
      } else {
        next.turn += 1;
        next.phase = 'DEVELOPMENT';
        next.timer = 30;
      }
    } else if (next.phase === 'UN_MEETING') {
      next.turn += 1;
      next.phase = 'DEVELOPMENT';
      next.timer = 30;
    }
    setGameState(next);
    syncService.syncGameState(next);
  };

  const performAIMeetingAnalysis = async (state: GameState) => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `당신은 UN 기후 변화 전문 AI입니다. 다음 국가들의 현재 GP 상태와 게임 로그를 보고, 4턴이 지난 시점에서의 중간 평가 메시지를 한국어로 짧게 작성해주세요. 
    상태: ${JSON.stringify(Object.values(state.countries).map(c => ({ name: c.name, gp: c.gp })))}
    현재 기온: ${state.temperature}`;
    
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt
      });
      state.logs = [`[UN 특별 보고] ${response.text}`, ...state.logs];
    } catch (e) {
      state.logs = [`[UN 공지] 전 세계가 협력하여 기온 상승을 억제해야 합니다.`, ...state.logs];
    }
  };

  const calculateFinalScores = (state: GameState) => {
    const sorted = (Object.values(state.countries) as Country[])
      .filter(c => c.isJoined)
      .sort((a, b) => b.gp - a.gp);
    sorted.forEach((c, idx) => {
      state.countries[c.id].score = Math.max(0, 100 - (idx * 10));
    });
  };

  // --- 퀴즈 선택 토글 (호스트) ---
  const toggleQuizSelection = (id: number) => {
    setGameState(prev => {
      const selected = prev.selectedQuizIds.includes(id)
        ? prev.selectedQuizIds.filter(qid => qid !== id)
        : [...prev.selectedQuizIds, id];
      const next = { ...prev, selectedQuizIds: selected };
      if (role === 'HOST') syncService.syncGameState(next);
      return next;
    });
  };

  // --- 가위바위보 발동 (호스트) ---
  const handleRPS = (targetA: CountryId, targetB: CountryId) => {
    setGameState(prev => {
      const next = { ...prev, rpsTargetA: targetA, rpsTargetB: targetB };
      next.logs = [`⚔️ 가위바위보 대결 발동! ${prev.countries[targetA].name} vs ${prev.countries[targetB].name}`, ...next.logs];
      if (role === 'HOST') syncService.syncGameState(next);
      return next;
    });
  };

  // --- UI 컴포넌트 ---
  const getPhaseAssets = () => {
    switch (gameState.phase) {
      case 'DEVELOPMENT': return { title: "산업 개발 및 투자", icon: "fa-industry", img: "https://images.unsplash.com/photo-1516937941344-00b4e0337589?auto=format&fit=crop&q=80&w=1200", color: "from-orange-600/80", desc: "국가의 경제력을 키우기 위한 개발 계획을 수립하세요." };
      case 'QUIZ': return { title: "기후 위기 대응 퀴즈", icon: "fa-brain", img: "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&q=80&w=1200", color: "from-blue-600/80", desc: "퀴즈를 풀어 지구의 기온을 낮추고 생존 확률을 높이세요." };
      case 'DISCUSSION': return { title: "세계 정상 회담", icon: "fa-handshake", img: "https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&q=80&w=1200", color: "from-indigo-600/80", desc: "국가 간의 협력과 견제를 통해 위기에 대응하세요." };
      case 'UN_MEETING': return { title: "UN 기후 보전 위원회", icon: "fa-building-columns", img: "https://images.unsplash.com/photo-1541873676946-8412460408c2?auto=format&fit=crop&q=80&w=1200", color: "from-emerald-600/80", desc: "UN의 인공지능 분석 보고서를 토대로 지구를 진단합니다." };
      default: return null;
    }
  };

  const phaseAssets = getPhaseAssets();

  const renderLobby = () => (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center animate-in fade-in duration-1000">
      <div className="mb-10">
        <i className="fa-solid fa-earth-asia text-9xl text-emerald-400 mb-6 drop-shadow-[0_0_40px_rgba(52,211,153,0.5)]"></i>
        <h1 className="text-7xl font-black tracking-tighter mb-2">지구를 <span className="text-emerald-400">지켜라!</span></h1>
        <p className="text-xl text-slate-400 font-bold uppercase tracking-[0.3em]">Climate War: Negotiator</p>
      </div>

      {!role ? (
        <div className="w-full max-w-sm space-y-4">
          <input 
            type="text" placeholder="방 코드 (예: ROOM7)" value={roomInput}
            onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
            className="w-full p-5 bg-white/5 border-2 border-white/10 rounded-3xl text-center text-3xl font-black outline-none focus:border-emerald-500/50 transition-all"
          />
          <div className="grid grid-cols-2 gap-4">
            <button onClick={() => handleEnterRoom('HOST')} className="p-6 bg-emerald-600 hover:bg-emerald-500 rounded-3xl font-black text-xl shadow-xl active:scale-95 transition-all">호스트(교사)</button>
            <button onClick={() => handleEnterRoom('GUEST')} className="p-6 bg-blue-600 hover:bg-blue-500 rounded-3xl font-black text-xl shadow-xl active:scale-95 transition-all">게스트(학생)</button>
          </div>
        </div>
      ) : role === 'HOST' ? (
        <div className="w-full max-w-4xl glass p-10 rounded-[3rem] border border-white/20 shadow-2xl">
          <div className="flex justify-between items-center mb-10">
            <div className="text-left">
              <h2 className="text-4xl font-black">Room <span className="text-emerald-400">#{gameState.roomId}</span></h2>
              <p className="text-slate-400 font-bold">학생들에게 코드를 공유하세요.</p>
            </div>
            <div className="bg-white/10 px-6 py-2 rounded-full font-black text-xl">{(Object.values(gameState.countries) as Country[]).filter(c=>c.isJoined).length} / 9</div>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-6 mb-12">
            {(Object.values(gameState.countries) as Country[]).map(c => (
              <div key={c.id} className={`p-6 rounded-[2rem] border-2 transition-all ${c.isJoined ? 'bg-emerald-500/20 border-emerald-500 scale-110 shadow-lg shadow-emerald-500/20' : 'bg-slate-800 border-transparent opacity-40'}`}>
                <span className="text-5xl mb-3 block">{c.flag}</span>
                <span className="font-black text-sm">{c.name}</span>
              </div>
            ))}
          </div>
          <button onClick={() => setGameState(prev=>({...prev, phase: 'SETUP'}))} className="w-full p-6 bg-emerald-500 hover:bg-emerald-400 rounded-3xl font-black text-3xl shadow-2xl">게임 설정 시작</button>
        </div>
      ) : (
        <div className="w-full max-w-6xl glass p-10 rounded-[4rem] border border-white/20">
          <div className="mb-10 text-center">
             <h2 className="text-4xl font-black mb-2">대표할 국가를 선택하세요</h2>
             <p className="text-slate-400 font-bold">선착순으로 국가가 확정됩니다.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {(Object.values(gameState.countries) as Country[]).map(c => {
              const isTaken = c.isJoined && myCountryId !== c.id;
              return (
                <button 
                  key={c.id} disabled={isTaken}
                  onClick={() => { setMyCountryId(c.id); syncService.joinRoom(gameState.roomId, c.id); }}
                  className={`relative group p-6 rounded-[2.5rem] text-left border-4 transition-all ${myCountryId === c.id ? 'bg-blue-600/30 border-blue-400 ring-8 ring-blue-500/10 scale-105' : isTaken ? 'opacity-30 grayscale cursor-not-allowed' : 'bg-slate-800 border-white/5 hover:border-white/30 hover:bg-slate-700'}`}
                >
                  <div className="flex items-center gap-4 mb-4">
                    <span className="text-6xl">{c.flag}</span>
                    <span className="text-2xl font-black">{c.name}</span>
                  </div>
                  <div className="bg-black/40 p-4 rounded-2xl">
                    <div className="text-blue-400 text-xs font-black mb-1 uppercase tracking-tighter">{c.abilityName}</div>
                    <p className="text-xs text-slate-300 leading-snug">{c.abilityDesc}</p>
                  </div>
                  {isTaken && <div className="absolute inset-0 flex items-center justify-center bg-black/70 rounded-[2.5rem] font-black text-red-500 text-xl">이미 선택됨</div>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className={`min-h-screen transition-bg ${gameState.temperature >= 19 ? 'bg-red-950' : 'bg-slate-900'}`}>
      {gameState.phase === 'LOBBY' && renderLobby()}
      
      {/* 게임 실행 화면 (호스트 & 게스트) */}
      {gameState.phase !== 'LOBBY' && gameState.phase !== 'END' && gameState.phase !== 'SETUP' && (
        <div className="max-w-[1400px] mx-auto p-4 md:p-8 space-y-8 animate-in fade-in duration-700">
          
          {/* 거대 단계 헤더 (Host & Guest 공통 또는 Host 중심) */}
          {phaseAssets && (
            <div className="relative h-72 rounded-[4rem] overflow-hidden shadow-2xl border border-white/10 group">
              <img src={phaseAssets.img} className="absolute inset-0 w-full h-full object-cover opacity-30 group-hover:scale-105 transition-transform duration-1000" />
              <div className={`absolute inset-0 bg-gradient-to-r ${phaseAssets.color} to-transparent`}></div>
              <div className="absolute inset-0 flex flex-col justify-center px-16">
                <div className="flex items-center gap-8 mb-4">
                   <div className="w-24 h-24 bg-white/20 backdrop-blur-xl rounded-3xl flex items-center justify-center text-5xl shadow-2xl">
                     <i className={`fa-solid ${phaseAssets.icon}`}></i>
                   </div>
                   <div>
                     <h1 className="text-6xl font-black tracking-tighter mb-1 drop-shadow-lg">{phaseAssets.title}</h1>
                     <p className="text-2xl font-bold opacity-80">{phaseAssets.desc}</p>
                   </div>
                </div>
              </div>
              <div className="absolute top-10 right-16 text-right">
                <span className="text-xs font-black uppercase tracking-widest opacity-40">Turn</span>
                <div className="text-5xl font-black text-emerald-400">{gameState.turn} <span className="text-lg opacity-40">/ {MAX_TURNS}</span></div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            <div className="lg:col-span-1 space-y-6">
              <TemperatureGauge temp={gameState.temperature} />
              <div className="glass p-8 rounded-[3rem] border border-white/10 text-center">
                 <span className="text-xs font-black uppercase opacity-40 tracking-widest">남은 시간</span>
                 <div className={`text-6xl font-black mt-2 ${gameState.timer <= 10 ? 'text-red-500 animate-pulse' : ''}`}>{gameState.timer}s</div>
              </div>
              <div className="glass p-8 rounded-[3rem] h-64 flex flex-col border border-white/10">
                 <h3 className="text-xs font-black uppercase opacity-40 mb-4">최근 게임 로그</h3>
                 <div className="overflow-y-auto flex-1 space-y-2 pr-2 custom-scrollbar">
                    {gameState.logs.slice(0, 20).map((log, i) => (
                      <div key={i} className="text-sm border-l-2 border-white/10 pl-3 py-1 leading-relaxed">
                        <span className={log.includes('기온') ? 'text-red-400 font-bold' : ''}>{log}</span>
                      </div>
                    ))}
                 </div>
              </div>
            </div>

            <div className="lg:col-span-3">
              {role === 'HOST' ? (
                <div className="glass p-12 rounded-[4rem] border border-white/10 bg-slate-800/20 h-full flex flex-col">
                  <div className="flex justify-between items-center mb-10">
                    <h2 className="text-4xl font-black">호스트 컨트롤러</h2>
                    <button onClick={nextPhase} className="px-12 py-5 bg-indigo-600 hover:bg-indigo-500 rounded-3xl font-black text-xl shadow-2xl transition-all">다음 단계로 이동 ▶</button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 flex-1">
                     <div className="bg-black/30 p-8 rounded-[3rem] border border-white/5">
                        <h3 className="text-xl font-black mb-6 flex items-center gap-2"><i className="fa-solid fa-users"></i> 대표단 현황</h3>
                        <div className="space-y-3">
                           {(Object.values(gameState.countries) as Country[]).filter(c=>c.isJoined).map(c => (
                             <div key={c.id} className="flex justify-between items-center p-4 bg-white/5 rounded-2xl border border-white/5">
                               <span className="font-bold text-lg">{c.flag} {c.name}</span>
                               <div className="flex gap-2">
                                  <span className="bg-emerald-500/20 text-emerald-300 px-3 py-1 rounded-full text-xs font-black">GP: {c.gp}</span>
                                  <span className={`px-3 py-1 rounded-full text-xs font-black ${c.lastChoice ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'}`}>{c.lastChoice ? '제출됨' : '대기중'}</span>
                               </div>
                             </div>
                           ))}
                        </div>
                     </div>
                     <div className="bg-black/30 p-8 rounded-[3rem] border border-white/5">
                        <h3 className="text-xl font-black mb-6">특수 상황 발생</h3>
                        <div className="grid grid-cols-1 gap-4">
                           <button onClick={() => handleRPS('KOREA', 'USA')} className="p-5 bg-indigo-600/40 hover:bg-indigo-600 rounded-2xl font-black flex justify-between items-center"><span>한-미 가위바위보</span><i className="fa-solid fa-swords"></i></button>
                           <button onClick={() => {
                             setGameState(prev => {
                               const next = { ...prev, temperature: prev.temperature + 1.0 };
                               next.logs = ["📢 북한: 내래 핵 쏜다우! 기온 +1.0℃", ...next.logs];
                               syncService.syncGameState(next); return next;
                             });
                           }} className="p-5 bg-red-600/40 hover:bg-red-600 rounded-2xl font-black flex justify-between items-center"><span>북한 핵 도발</span><i className="fa-solid fa-radiation"></i></button>
                        </div>
                     </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-8 h-full">
                   {myCountryId && (
                     <div className="glass p-10 rounded-[4rem] border border-white/10 bg-gradient-to-br from-blue-600/10 to-transparent flex justify-between items-center">
                        <div className="flex items-center gap-10">
                           <span className="text-9xl drop-shadow-2xl">{gameState.countries[myCountryId].flag}</span>
                           <div>
                              <h2 className="text-5xl font-black mb-2">{gameState.countries[myCountryId].name} <span className="text-emerald-400">대표부</span></h2>
                              <div className="flex gap-4">
                                 <span className="bg-emerald-500 text-slate-900 px-5 py-2 rounded-full font-black text-xl">GP: {gameState.countries[myCountryId].gp}</span>
                                 <span className="bg-slate-700 text-white px-5 py-2 rounded-full font-black text-xl tracking-tight">{gameState.countries[myCountryId].abilityName}</span>
                              </div>
                           </div>
                        </div>
                     </div>
                   )}
                   <div className="glass p-12 rounded-[4rem] border border-white/10 bg-slate-800/40 min-h-[500px] flex items-center justify-center">
                     {myCountryId ? (
                       gameState.phase === 'DEVELOPMENT' ? (
                         <div className="w-full text-center space-y-12">
                            <h3 className="text-4xl font-black">개발 계획을 수립하세요</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                               {[
                                 { id: 'ECONOMIC', label: '경제 우선', icon: 'fa-industry', gp: '+10', color: 'orange' },
                                 { id: 'BALANCED', label: '균형 개발', icon: 'fa-scale-balanced', gp: '+8', color: 'emerald' },
                                 { id: 'ENVIRONMENTAL', label: '환경 보호', icon: 'fa-leaf', gp: '+5', color: 'sky' }
                               ].map(btn => (
                                 <button key={btn.id} onClick={() => syncService.sendAction(gameState.roomId, { type: 'SELECT_DEVELOPMENT', countryId: myCountryId, choice: btn.id })} className={`p-10 rounded-[3rem] border-4 transition-all group flex flex-col items-center ${gameState.countries[myCountryId].lastChoice === btn.id ? `bg-${btn.color}-600/30 border-${btn.color}-400 ring-8 ring-${btn.color}-500/10 scale-105` : 'bg-white/5 border-transparent hover:bg-white/10 hover:border-white/20'}`}>
                                   <div className={`w-24 h-24 rounded-3xl bg-${btn.color}-500/20 flex items-center justify-center text-5xl mb-6 group-hover:scale-110 transition-transform`}><i className={`fa-solid ${btn.icon} text-${btn.color}-400`}></i></div>
                                   <span className="text-3xl font-black mb-2">{btn.label}</span>
                                   <span className="text-lg font-bold opacity-60">GP {btn.gp} 획득</span>
                                 </button>
                               ))}
                            </div>
                         </div>
                       ) : gameState.phase === 'QUIZ' ? (
                        <div className="w-full max-w-2xl space-y-10">
                           <h3 className="text-5xl font-black text-center">Climate Quiz</h3>
                           {gameState.currentQuizId ? (() => {
                             const quiz = [...QUIZ_POOL, ...gameState.customQuizzes].find(q => q.id === gameState.currentQuizId);
                             return quiz ? (
                               <div className="space-y-8">
                                 <div className="p-12 bg-black/40 rounded-[3rem] text-3xl font-black border border-white/5 text-center leading-relaxed">{quiz.question}</div>
                                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                   {quiz.options.map((opt, i) => (
                                     <button key={i} onClick={() => syncService.sendAction(gameState.roomId, { type: 'QUIZ_RESULT', countryId: myCountryId, correct: i === quiz.answer })} className="p-8 bg-slate-700 hover:bg-slate-600 rounded-[2rem] text-left font-black text-xl transition-all border border-white/5"><span className="text-blue-400 mr-4">{i+1}.</span> {opt}</button>
                                   ))}
                                 </div>
                               </div>
                             ) : null;
                           })() : null}
                        </div>
                       ) : (
                         <div className="text-center opacity-20">
                            <i className="fa-solid fa-hourglass-half text-9xl mb-6"></i>
                            <h3 className="text-4xl font-black uppercase">Waiting for Host...</h3>
                         </div>
                       )
                     ) : <div className="text-3xl font-black text-red-500">먼저 국가를 선택해야 합니다.</div>}
                   </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 게임 설정 화면 (Setup) */}
      {gameState.phase === 'SETUP' && role === 'HOST' && (
        <div className="max-w-7xl mx-auto p-12 animate-in fade-in duration-500">
           <div className="flex justify-between items-center mb-12">
              <h2 className="text-6xl font-black">⚙️ 퀴즈 및 게임 설정</h2>
              <button onClick={startTurn} className="px-16 py-6 bg-emerald-500 hover:bg-emerald-400 rounded-3xl font-black text-3xl shadow-2xl transition-all">게임 시작! ▶</button>
           </div>
           <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
              <div className="glass p-12 rounded-[4rem] border border-white/10 flex flex-col">
                 <h3 className="text-3xl font-black mb-8 flex items-center gap-4"><i className="fa-solid fa-list-check text-emerald-400"></i> 퀴즈 뱅크</h3>
                 <div className="space-y-4 overflow-y-auto max-h-[500px] pr-4 custom-scrollbar">
                    {QUIZ_POOL.map(q => (
                      <div key={q.id} onClick={() => toggleQuizSelection(q.id)} className={`p-6 rounded-3xl cursor-pointer border-4 transition-all ${gameState.selectedQuizIds.includes(q.id) ? 'bg-emerald-500/20 border-emerald-500' : 'bg-white/5 border-transparent hover:bg-white/10'}`}>
                         <div className="font-black text-xl mb-2">{q.question}</div>
                         <div className="text-sm font-bold opacity-40">정답: {q.options[q.answer]}</div>
                      </div>
                    ))}
                 </div>
              </div>
              <div className="glass p-12 rounded-[4rem] bg-indigo-900/10 border border-white/10">
                 <h3 className="text-3xl font-black mb-8">직접 문제 출제</h3>
                 <form className="space-y-6" onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.target as HTMLFormElement;
                    const newQ: QuizQuestion = {
                      id: Date.now(),
                      question: (form.elements.namedItem('q') as HTMLInputElement).value,
                      options: [(form.elements.namedItem('o1') as HTMLInputElement).value, (form.elements.namedItem('o2') as HTMLInputElement).value, (form.elements.namedItem('o3') as HTMLInputElement).value, (form.elements.namedItem('o4') as HTMLInputElement).value],
                      answer: parseInt((form.elements.namedItem('ans') as HTMLSelectElement).value),
                      explanation: "교사가 직접 출제한 문제입니다."
                    };
                    setGameState(prev => ({ ...prev, customQuizzes: [...prev.customQuizzes, newQ], selectedQuizIds: [...prev.selectedQuizIds, newQ.id] }));
                    form.reset();
                 }}>
                    <input name="q" placeholder="질문 내용" required className="w-full p-5 rounded-2xl bg-black/30 border border-white/10 outline-none focus:ring-4 focus:ring-indigo-500/30" />
                    <div className="grid grid-cols-2 gap-4">
                       <input name="o1" placeholder="보기 1" required className="p-4 rounded-2xl bg-black/30 border border-white/10" />
                       <input name="o2" placeholder="보기 2" required className="p-4 rounded-2xl bg-black/30 border border-white/10" />
                       <input name="o3" placeholder="보기 3" required className="p-4 rounded-2xl bg-black/30 border border-white/10" />
                       <input name="o4" placeholder="보기 4" required className="p-4 rounded-2xl bg-black/30 border border-white/10" />
                    </div>
                    <select name="ans" className="w-full p-5 rounded-2xl bg-black/30 border border-white/10 font-bold">
                       <option value="0">정답: 1번</option><option value="1">정답: 2번</option><option value="2">정답: 3번</option><option value="3">정답: 4번</option>
                    </select>
                    <button type="submit" className="w-full p-6 bg-indigo-600 hover:bg-indigo-500 rounded-3xl font-black text-2xl transition-all shadow-xl">문제 등록 및 선택</button>
                 </form>
              </div>
           </div>
        </div>
      )}

      {/* 결과 화면 (End) */}
      {gameState.phase === 'END' && (
        <div className="min-h-screen flex items-center justify-center p-8 bg-black/80 backdrop-blur-3xl animate-in zoom-in duration-700">
           <div className={`w-full max-w-6xl p-20 rounded-[5rem] border-8 text-center ${gameState.temperature >= 20 ? 'border-red-600 bg-red-950/20' : 'border-emerald-500 bg-emerald-950/20'}`}>
              <h1 className="text-8xl font-black mb-10 uppercase tracking-tighter">{gameState.temperature >= 20 ? '지구 멸망' : '인류의 승리'}</h1>
              <div className="text-5xl font-black mb-20">최종 기온: <span className={gameState.temperature >= 20 ? 'text-red-500' : 'text-emerald-400'}>{gameState.temperature.toFixed(1)}℃</span></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
                 {(Object.values(gameState.countries) as Country[]).filter(c=>c.isJoined).sort((a,b)=>b.score - a.score).map((c, idx) => (
                   <div key={c.id} className="bg-white/5 p-10 rounded-[3rem] border border-white/10 flex justify-between items-center hover:bg-white/10 transition-all">
                      <div className="flex items-center gap-8">
                         <span className="text-5xl font-black text-slate-500 w-16">#{idx+1}</span>
                         <span className="text-7xl">{c.flag}</span>
                         <span className="text-3xl font-black">{c.name}</span>
                      </div>
                      <div className="text-right">
                         <div className="text-5xl font-black text-emerald-400">{c.score} <span className="text-lg opacity-40 uppercase">Coins</span></div>
                         <div className="text-sm font-bold opacity-30">최종 GP: {c.gp}</div>
                      </div>
                   </div>
                 ))}
              </div>
              <button onClick={() => window.location.reload()} className="mt-20 px-20 py-8 bg-white text-slate-900 rounded-full font-black text-4xl shadow-2xl hover:scale-105 transition-all">Main Menu</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
