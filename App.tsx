
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
};

const PHASE_THEMES: Record<GamePhase, { img: string; color: string; label: string }> = {
  LOBBY: { img: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&q=80&w=2000', color: 'from-slate-950 to-slate-900', label: '글로벌 워룸 (대기실)' },
  SETUP: { img: 'https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&q=80&w=2000', color: 'from-emerald-950 to-slate-900', label: '작전 지시 (퀴즈 설정)' },
  DEVELOPMENT: { img: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80&w=2000', color: 'from-blue-950 to-slate-900', label: '국가 발전 전략 수립' },
  QUIZ: { img: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&q=80&w=2000', color: 'from-purple-950 to-slate-900', label: '실시간 환경 퀴즈' },
  DISCUSSION: { img: 'https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&q=80&w=2000', color: 'from-amber-950 to-slate-900', label: 'UN 기후 협상 및 브리핑' },
  UN_MEETING: { img: 'https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&q=80&w=2000', color: 'from-amber-950 to-slate-900', label: 'UN 특별 총회' },
  END: { img: '', color: 'from-black to-slate-950', label: '최종 결과 발표' }
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
    roomId: '', phase: 'LOBBY', turn: 1, temperature: INITIAL_TEMPERATURE,
    countries: JSON.parse(JSON.stringify(COUNTRIES)), logs: ['🌍 기후 워룸 시스템 가동 중...'],
    timer: 0, currentQuizId: null, selectedQuizIds: [], customQuizzes: [],
    rpsTargetA: null, rpsTargetB: null, rpsChoiceA: null, rpsChoiceB: null,
    lastTurnChoices: {} as Record<CountryId, any>,
    activeEffects: { swedenWaiting: false, japanActive: false, denmarkTurnsLeft: 0, franceActive: false, brazilActive: false, tuvaluWaiting: false }
  });

  const processedActionIds = useRef<Set<string>>(new Set());
  const timerIntervalRef = useRef<number | null>(null);

  const playSfx = (url: string) => {
    const audio = new Audio(url);
    audio.volume = 0.4;
    audio.play().catch(() => {}); 
  };

  // 타이머 로직 (교사용)
  useEffect(() => {
    if (role === 'HOST' && isRoomEntered && gameState.phase !== 'LOBBY' && gameState.phase !== 'END' && gameState.phase !== 'SETUP') {
      timerIntervalRef.current = window.setInterval(() => {
        setGameState(prev => {
          if (prev.timer <= 0) return prev;
          const next = { ...prev, timer: prev.timer - 1 };
          if (next.timer % 2 === 0) syncService.syncGameState(next);
          return next;
        });
      }, 1000);
      return () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); };
    }
  }, [role, isRoomEntered, gameState.phase]);

  // 타이머 종료 시 자동 단계 전환 (교사 기준)
  useEffect(() => {
    if (role === 'HOST' && gameState.timer === 0 && gameState.phase !== 'LOBBY' && gameState.phase !== 'END' && gameState.phase !== 'SETUP') {
      nextPhase();
    }
  }, [gameState.timer, role]);

  // 실시간 동기화
  useEffect(() => {
    if (isRoomEntered && gameState.roomId) {
      if (role === 'GUEST') {
        const stopPolling = syncService.pollGameState(gameState.roomId, (newState) => {
          if (newState.phase !== gameState.phase) playSfx(SFX.TRANSITION);
          if (nicknameInput && !myCountryId) {
            const me = (Object.values(newState.countries) as Country[]).find(c => c.nickname === nicknameInput);
            if (me) { setMyCountryId(me.id as CountryId); setIsJoining(false); playSfx(SFX.SUCCESS); }
          }
          setGameState(newState);
        });
        return () => stopPolling();
      } else {
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
  }, [isRoomEntered, role, gameState.roomId, nicknameInput, myCountryId, gameState.phase]);

  const handleActionAsHost = (action: any) => {
    setGameState(prev => {
      const next = { ...prev };
      const cid = action.countryId as CountryId;
      if (!next.countries[cid]) return prev;

      switch (action.type) {
        case 'JOIN':
          if (!next.countries[cid].isJoined) {
            next.countries[cid].isJoined = true;
            next.countries[cid].nickname = action.nickname;
            next.countries[cid].lastActive = Date.now();
            next.logs = [`🚩 ${next.countries[cid].flag} ${action.nickname} 사령관 배치 완료!`, ...next.logs];
            playSfx(SFX.JOIN);
          }
          break;
        case 'SELECT_DEVELOPMENT':
          next.countries[cid].lastChoice = action.choice;
          next.countries[cid].lastActive = Date.now();
          break;
        case 'QUIZ_RESULT':
          next.countries[cid].isCorrect = action.correct;
          next.countries[cid].lastActive = Date.now();
          if (!action.correct) {
            next.temperature += 0.1;
            next.logs = [`⚠️ ${next.countries[cid].nickname} 전략 오류! 기온 상승`, ...next.logs];
          } else {
            next.logs = [`✅ ${next.countries[cid].nickname} 전략 성공!`, ...next.logs];
          }
          break;
      }
      syncService.syncGameState(next);
      return next;
    });
  };

  const handleEnterRoom = async (r: 'HOST' | 'GUEST') => {
    const rid = roomInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!rid) return alert("방 코드를 입력하세요.");
    if (r === 'GUEST' && !nicknameInput.trim()) return alert("학생 닉네임을 입력하세요.");
    
    setIsConnecting(true);
    setRole(r);
    setIsRoomEntered(true);
    
    try {
      if (r === 'HOST') {
        const initialState = { ...gameState, roomId: rid };
        setGameState(initialState);
        await syncService.syncGameState(initialState);
        await syncService.clearActions(rid);
      } else {
        setGameState(prev => ({ ...prev, roomId: rid }));
      }
    } catch (e) { console.error("Sync init failed", e); }
    setIsConnecting(false);
  };

  const nextPhase = () => {
    playSfx(SFX.TRANSITION);
    setGameState(prev => {
      let next = { ...prev };
      if (next.phase === 'LOBBY') { next.phase = 'SETUP'; next.timer = 0; }
      else if (next.phase === 'SETUP') { 
        if (next.selectedQuizIds.length < MAX_TURNS) { alert(`최소 ${MAX_TURNS}개의 퀴즈를 선택해야 합니다.`); return prev; }
        next.phase = 'DEVELOPMENT'; next.timer = 30; 
      }
      else if (next.phase === 'DEVELOPMENT') { 
        next.phase = 'QUIZ'; next.timer = 30; 
        next.currentQuizId = next.selectedQuizIds[next.turn - 1]; 
      }
      else if (next.phase === 'QUIZ') { next.phase = 'DISCUSSION'; next.timer = 180; }
      else if (next.phase === 'DISCUSSION') {
        (Object.values(next.countries) as Country[]).forEach(c => { c.isCorrect = null; c.lastChoice = null; });
        if (next.turn === MAX_TURNS) next.phase = 'END';
        else { next.turn++; next.phase = 'DEVELOPMENT'; next.timer = 30; }
      }
      syncService.syncGameState(next);
      return next;
    });
  };

  const currentTheme = PHASE_THEMES[gameState.phase];

  const renderLobby = () => (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 animate-in fade-in duration-1000 relative overflow-hidden bg-slate-950">
      <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#34d399 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>
      <div className="relative z-10 text-center space-y-12 w-full max-w-7xl">
        <div className="space-y-4">
          <h1 className="text-9xl font-black tracking-tighter italic text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.3)]">CLIMATE <span className="text-emerald-400">WAR</span></h1>
          <p className="text-2xl text-emerald-400 font-black uppercase tracking-[0.6em]">Earth Occupation Campaign</p>
        </div>

        <div className="max-w-md mx-auto space-y-6 glass p-10 rounded-[3rem] border border-white/10 shadow-2xl bg-black/40">
          <input type="text" placeholder="방 코드(예:ROOM1)" value={roomInput} onChange={(e) => setRoomInput(e.target.value.toUpperCase())} className="w-full p-6 bg-black/40 border-2 border-emerald-500/30 rounded-3xl text-center text-4xl font-black text-white" />
          <input type="text" placeholder="학생 닉네임" value={nicknameInput} onChange={(e) => setNicknameInput(e.target.value)} className="w-full p-5 bg-black/40 border border-white/10 rounded-2xl text-center text-2xl font-bold text-white" />
          <div className="grid grid-cols-2 gap-6 pt-4">
            <button onClick={() => handleEnterRoom('HOST')} className="p-8 bg-emerald-600 hover:bg-emerald-500 rounded-[2rem] font-black text-2xl border-b-8 border-emerald-800 transition-all active:scale-95">교사 접속</button>
            <button onClick={() => handleEnterRoom('GUEST')} className="p-8 bg-blue-600 hover:bg-blue-500 rounded-[2rem] font-black text-2xl border-b-8 border-blue-800 transition-all active:scale-95">학생 접속</button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className={`min-h-screen transition-bg bg-gradient-to-br ${currentTheme.color} ${gameState.temperature >= 19 ? 'animate-crisis' : ''}`}>
      {gameState.phase === 'LOBBY' ? renderLobby() : (
        <div className="animate-in fade-in">
          {/* 헤더 섹션 */}
          <div className="relative h-[350px] w-full overflow-hidden shadow-2xl border-b border-white/10">
            <img src={currentTheme.img} className="absolute inset-0 w-full h-full object-cover transform scale-105 opacity-60" />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent"></div>
            <div className="absolute bottom-0 left-0 w-full p-12 flex flex-col md:flex-row justify-between items-end gap-10">
              <div className="flex items-center gap-10">
                <div className="w-24 h-24 glass rounded-[2rem] border-2 border-white/20 flex items-center justify-center text-5xl text-white shadow-2xl animate-pulse">
                   {gameState.phase === 'SETUP' && <i className="fa-solid fa-list-check"></i>}
                   {gameState.phase === 'DEVELOPMENT' && <i className="fa-solid fa-industry"></i>}
                   {gameState.phase === 'QUIZ' && <i className="fa-solid fa-bolt-lightning"></i>}
                   {gameState.phase === 'DISCUSSION' && <i className="fa-solid fa-comments text-amber-400"></i>}
                </div>
                <div>
                  <h1 className="text-7xl font-black italic uppercase tracking-tighter text-white drop-shadow-2xl leading-none">{gameState.phase}</h1>
                  <p className="text-2xl font-bold text-emerald-400 tracking-[0.3em] uppercase mt-3 drop-shadow-md">{currentTheme.label} • ROUND {gameState.turn}</p>
                </div>
              </div>
              <div className="text-right space-y-4">
                <div className="text-8xl font-black tabular-nums text-white bg-black/60 backdrop-blur-3xl px-12 py-4 rounded-[2.5rem] border-2 border-white/10 shadow-inner">
                  {gameState.timer}<span className="text-2xl ml-2 opacity-50">S</span>
                </div>
                {role === 'HOST' && gameState.phase === 'DISCUSSION' && (
                  <div className="flex gap-4 justify-end">
                    <button onClick={() => setGameState(prev => ({...prev, timer: Math.max(0, prev.timer - 5)}))} className="px-6 py-2 bg-red-600 rounded-xl font-black text-sm">- 5S</button>
                    <button onClick={() => setGameState(prev => ({...prev, timer: prev.timer + 5}))} className="px-6 py-2 bg-emerald-600 rounded-xl font-black text-sm">+ 5S</button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <main className="max-w-[1750px] mx-auto p-10 space-y-12">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
              {/* 왼쪽 사이드바 */}
              <aside className="lg:col-span-3 space-y-10">
                <TemperatureGauge temp={gameState.temperature} />
                <div className="glass p-8 rounded-[3rem] h-[550px] flex flex-col border border-white/10 shadow-2xl bg-black/40">
                   <h3 className="text-xs font-black uppercase opacity-40 mb-6 tracking-widest flex items-center gap-3"><i className="fa-solid fa-tower-broadcast"></i> 전술 상황 브리핑</h3>
                   <div className="overflow-y-auto flex-1 space-y-3 pr-3 custom-scrollbar">
                      {gameState.logs.map((log, i) => (
                        <div key={i} className="text-lg border-l-4 border-emerald-500/50 pl-5 py-3 font-semibold bg-white/5 rounded-r-2xl animate-in slide-in-from-left-4">
                          <span className={log.includes('기온') ? 'text-red-400' : log.includes('성공') ? 'text-emerald-400' : ''}>{log}</span>
                        </div>
                      ))}
                   </div>
                </div>
              </aside>

              {/* 메인 섹션 */}
              <section className="lg:col-span-9">
                {role === 'HOST' && gameState.phase === 'SETUP' && (
                  <div className="glass p-12 rounded-[4rem] border border-white/10 shadow-2xl space-y-12 animate-in zoom-in bg-black/20">
                    <div className="flex justify-between items-center border-b border-white/10 pb-8">
                       <h2 className="text-5xl font-black italic tracking-tighter uppercase">전략 문제 리스트 구성</h2>
                       <button onClick={nextPhase} className="px-20 py-8 bg-emerald-600 hover:bg-emerald-500 rounded-[3rem] font-black text-3xl shadow-xl border-b-8 border-emerald-800 transition-all active:scale-95">작전 시작 ▶</button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                       <div className="p-10 bg-black/60 rounded-[3rem] border border-white/10 space-y-8 h-[600px] flex flex-col overflow-hidden">
                          <div className="flex justify-between items-center mb-4">
                            <h3 className="text-3xl font-black italic text-emerald-400 uppercase">Quiz Bank</h3>
                            <span className="bg-emerald-500/20 text-emerald-400 px-6 py-2 rounded-full font-black text-xl">{gameState.selectedQuizIds.length} / {MAX_TURNS}</span>
                          </div>
                          <div className="overflow-y-auto flex-1 space-y-4 pr-3 custom-scrollbar">
                             {QUIZ_POOL.map(q => (
                               <div key={q.id} onClick={() => setGameState(prev => {
                                 const isSel = prev.selectedQuizIds.includes(q.id);
                                 const nextSel = isSel ? prev.selectedQuizIds.filter(id => id !== q.id) : [...prev.selectedQuizIds, q.id];
                                 if (nextSel.length > MAX_TURNS) return prev;
                                 return { ...prev, selectedQuizIds: nextSel };
                               })} className={`p-6 rounded-2xl border-2 transition-all cursor-pointer flex flex-col gap-2 ${gameState.selectedQuizIds.includes(q.id) ? 'bg-emerald-600/30 border-emerald-500 scale-[1.02]' : 'bg-white/5 border-transparent hover:bg-white/10'}`}>
                                 <div className="font-bold text-lg leading-snug">{q.question}</div>
                                 {gameState.selectedQuizIds.includes(q.id) && (
                                   <div className="text-sm text-emerald-300 font-bold bg-black/40 p-2 rounded-lg">정답: {q.answer+1}번 ({q.options[q.answer]})</div>
                                 )}
                               </div>
                             ))}
                          </div>
                       </div>
                       <div className="p-10 bg-black/60 rounded-[3rem] border border-white/10 space-y-8">
                          <h3 className="text-3xl font-black italic text-blue-400 uppercase">Custom Quiz</h3>
                          <div className="space-y-6">
                            <input type="text" placeholder="질문 내용" value={newQuiz.question} onChange={e => setNewQuiz({...newQuiz, question: e.target.value})} className="w-full p-6 bg-white/5 rounded-2xl border border-white/10 font-bold text-xl outline-none" />
                            <div className="grid grid-cols-2 gap-4">
                               {newQuiz.options.map((opt, i) => (
                                 <input key={i} type="text" placeholder={`선택지 ${i+1}`} value={opt} onChange={e => { const opts = [...newQuiz.options]; opts[i] = e.target.value; setNewQuiz({...newQuiz, options: opts}); }} className={`p-4 bg-white/5 rounded-xl border-2 transition-all ${newQuiz.answer === i ? 'border-blue-500 bg-blue-500/10' : 'border-white/10'}`} onClick={() => setNewQuiz({...newQuiz, answer: i})} />
                               ))}
                            </div>
                            <button onClick={() => {
                              const q: QuizQuestion = { id: Date.now(), question: newQuiz.question, options: [...newQuiz.options], answer: newQuiz.answer, explanation: '교사 직접 출제' };
                              setGameState(prev => ({ ...prev, customQuizzes: [...prev.customQuizzes, q], selectedQuizIds: [...prev.selectedQuizIds, q.id].slice(0, MAX_TURNS) }));
                              setNewQuiz({ question: '', options: ['', '', '', ''], answer: 0 });
                            }} className="w-full p-6 bg-blue-600 hover:bg-blue-500 rounded-2xl font-black text-2xl border-b-4 border-blue-800">목록에 추가</button>
                          </div>
                       </div>
                    </div>
                  </div>
                )}

                {role === 'HOST' && gameState.phase === 'QUIZ' && (
                  <div className="glass p-12 rounded-[4rem] text-center space-y-12 bg-black/40 border-2 border-purple-500/30">
                    <h2 className="text-4xl font-black italic text-purple-400 tracking-widest uppercase">실시간 전술 퀴즈 전송 중</h2>
                    {(() => {
                      const q = [...QUIZ_POOL, ...gameState.customQuizzes].find(q => q.id === gameState.currentQuizId);
                      return q ? (
                        <div className="space-y-10">
                          <p className="text-7xl font-black leading-tight text-white drop-shadow-2xl">{q.question}</p>
                          <div className="grid grid-cols-2 gap-8 max-w-5xl mx-auto">
                            {q.options.map((opt, i) => (
                              <div key={i} className={`p-10 rounded-3xl border-4 font-black text-4xl flex items-center justify-center gap-10 ${i === q.answer ? 'border-emerald-500 bg-emerald-500/20' : 'border-white/10 bg-black/20'}`}>
                                <span className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">{i + 1}</span>
                                {opt}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null;
                    })()}
                  </div>
                )}

                {role === 'HOST' && gameState.phase === 'DISCUSSION' && (
                  <div className="glass p-12 rounded-[4rem] space-y-12 bg-black/20">
                    <div className="text-center border-b border-white/10 pb-8">
                      <h2 className="text-6xl font-black italic text-amber-400 uppercase">Round {gameState.turn} Result</h2>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                      <div className="space-y-8">
                        <h3 className="text-3xl font-black text-emerald-400 italic">정답 보고</h3>
                        {(() => {
                          const q = [...QUIZ_POOL, ...gameState.customQuizzes].find(q => q.id === gameState.currentQuizId);
                          return q ? (
                            <div className="p-10 bg-black/40 rounded-[3rem] border border-white/10 space-y-6">
                              <p className="text-3xl font-bold leading-relaxed">{q.question}</p>
                              <div className="text-4xl font-black text-emerald-400 bg-emerald-500/10 p-6 rounded-2xl border border-emerald-500/30">정답: {q.answer+1}. {q.options[q.answer]}</div>
                            </div>
                          ) : null;
                        })()}
                      </div>
                      <div className="space-y-8">
                        <h3 className="text-3xl font-black text-blue-400 italic">국가별 전술 성패</h3>
                        <div className="grid grid-cols-1 gap-4 overflow-y-auto max-h-[500px] pr-4 custom-scrollbar">
                           {(Object.values(gameState.countries) as Country[]).filter(c=>c.isJoined).map(c => (
                             <div key={c.id} className={`p-6 rounded-[2rem] flex justify-between items-center border-2 transition-all ${c.isCorrect === true ? 'border-emerald-500 bg-emerald-500/20' : c.isCorrect === false ? 'border-red-500 bg-red-500/20' : 'border-white/5 opacity-50'}`}>
                               <div className="flex items-center gap-6">
                                 <span className="text-5xl">{c.flag}</span>
                                 <span className="font-black text-2xl">{c.nickname}</span>
                               </div>
                               <div className="text-3xl font-black italic">
                                 {c.isCorrect === true ? <span className="text-emerald-400">SUCCESS</span> : c.isCorrect === false ? <span className="text-red-500">FAILURE</span> : <span className="text-white/20">WAITING</span>}
                               </div>
                             </div>
                           ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {role === 'HOST' && (gameState.phase === 'DEVELOPMENT' || gameState.phase === 'UN_MEETING') && (
                  <div className="glass p-12 rounded-[4rem] border border-white/10 h-full min-h-[700px] bg-black/20">
                    <div className="flex justify-between items-center mb-12 border-b border-white/10 pb-8">
                       <h2 className="text-5xl font-black italic uppercase">Global War Room</h2>
                       <button onClick={nextPhase} className="px-16 py-8 bg-indigo-600 hover:bg-indigo-500 rounded-[3rem] font-black text-3xl shadow-xl border-b-8 border-indigo-900 transition-all active:scale-95">다음 작전 개시 ▶</button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                      {(Object.values(gameState.countries) as Country[]).filter(c=>c.isJoined).map(c => (
                        <div key={c.id} className="p-10 bg-white/5 rounded-[3rem] border-2 border-white/5 flex flex-col gap-6 relative group overflow-hidden">
                           <div className="flex items-center gap-6">
                             <span className="text-7xl">{c.flag}</span>
                             <div className="text-left">
                               <div className="text-3xl font-black text-white">{c.nickname}</div>
                               <div className="text-xs opacity-40 font-bold uppercase">{c.name}</div>
                             </div>
                           </div>
                           <div className="flex justify-between items-end border-t border-white/10 pt-6">
                             <div className="text-4xl font-black text-emerald-400 tabular-nums">{c.gp} GP</div>
                             <span className={`px-6 py-2 rounded-xl text-sm font-black uppercase ${c.lastChoice ? 'bg-blue-600 text-white animate-pulse' : 'bg-red-600/20 text-red-500'}`}>
                               {c.lastChoice ? 'Strategy Set' : 'Pending'}
                             </span>
                           </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 학생용 화면 */}
                {role === 'GUEST' && myCountryId && (
                  <div className="space-y-12 animate-in fade-in">
                    <div className="glass p-12 rounded-[4rem] flex items-center justify-between bg-gradient-to-r from-blue-600/20 to-transparent shadow-2xl">
                      <div className="flex items-center gap-10">
                        <span className="text-[140px] drop-shadow-2xl">{gameState.countries[myCountryId].flag}</span>
                        <div>
                          <h2 className="text-7xl font-black italic text-white leading-none tracking-tighter">{gameState.countries[myCountryId].nickname}</h2>
                          <div className="text-3xl font-black text-emerald-400 mt-4 italic">ASSET: {gameState.countries[myCountryId].gp} GP</div>
                        </div>
                      </div>
                      <div className="text-right hidden md:block">
                         <div className="flex items-center gap-3 justify-end mb-2">
                           <div className="w-4 h-4 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_#10b981]"></div>
                           <span className="font-black text-emerald-400 text-xl">CONNECTED</span>
                         </div>
                         <p className="text-white/20 font-bold uppercase tracking-widest text-sm">Strategic Command Link v4.0</p>
                      </div>
                    </div>

                    <div className="glass p-20 rounded-[5rem] min-h-[600px] flex items-center justify-center text-center bg-black/40 border-2 border-white/5 shadow-2xl">
                      {gameState.phase === 'DEVELOPMENT' ? (
                        <div className="space-y-16 w-full animate-in zoom-in">
                          <h3 className="text-7xl font-black italic text-white uppercase tracking-tighter">국가 발전 전략 선택</h3>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                            {[
                               { id: 'ECONOMIC', label: '경제 중심', color: 'orange', icon: 'fa-industry' },
                               { id: 'BALANCED', label: '지속 성장', color: 'emerald', icon: 'fa-scale-balanced' },
                               { id: 'ENVIRONMENTAL', label: '환경 우선', color: 'sky', icon: 'fa-leaf' }
                            ].map(btn => (
                              <button key={btn.id} onClick={() => { playSfx(SFX.CLICK); syncService.sendAction(gameState.roomId, { type: 'SELECT_DEVELOPMENT', countryId: myCountryId!, choice: btn.id }); }} className={`p-16 rounded-[4rem] border-4 transition-all group flex flex-col items-center gap-8 ${gameState.countries[myCountryId!].lastChoice === btn.id ? `bg-${btn.color}-600/40 border-${btn.color}-400 scale-110 z-10 shadow-[0_0_50px_rgba(0,0,0,0.5)]` : 'bg-white/5 border-transparent hover:bg-white/10'}`}>
                                <i className={`fa-solid ${btn.icon} text-7xl`}></i>
                                <span className="text-4xl font-black italic">{btn.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : gameState.phase === 'QUIZ' ? (
                        <div className="space-y-16 w-full animate-in zoom-in">
                          <h3 className="text-7xl font-black italic text-emerald-400 uppercase tracking-tighter">전술 문제 응답</h3>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
                            {[1,2,3,4].map(n => (
                              <button key={n} onClick={() => {
                                const q = [...QUIZ_POOL, ...gameState.customQuizzes].find(q => q.id === gameState.currentQuizId);
                                if (q) syncService.sendAction(gameState.roomId, { type: 'QUIZ_RESULT', countryId: myCountryId, correct: (n-1) === q.answer });
                                playSfx(SFX.CLICK);
                              }} className={`p-20 rounded-[3rem] border-4 text-8xl font-black transition-all ${gameState.countries[myCountryId!].isCorrect !== null ? 'opacity-30 pointer-events-none' : 'bg-white/5 hover:bg-emerald-500/20 border-white/10 active:scale-90'}`}>
                                {n}
                              </button>
                            ))}
                          </div>
                          {gameState.countries[myCountryId!].isCorrect !== null && (
                            <div className="text-4xl font-black text-emerald-400 animate-pulse uppercase italic">전술 보고 완료. 사령부 대기 중...</div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-12 text-center opacity-30">
                           <div className="w-40 h-40 border-[16px] border-white/5 border-t-emerald-400 rounded-full animate-spin mx-auto"></div>
                           <h3 className="text-6xl font-black italic uppercase tracking-tighter">Waiting for Command...</h3>
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
