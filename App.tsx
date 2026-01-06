
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
    if (role === 'HOST' && isRoomEntered && gameState.phase !== 'LOBBY' && gameState.phase !== 'END') {
      timerIntervalRef.current = window.setInterval(() => {
        setGameState(prev => {
          if (prev.timer <= 0) {
            return prev;
          }
          const next = { ...prev, timer: prev.timer - 1 };
          // 매 3초마다 DB 동기화 (네트워크 부하 감소 및 동기화 유지)
          if (next.timer % 3 === 0) syncService.syncGameState(next);
          return next;
        });
      }, 1000);
      return () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); };
    }
  }, [role, isRoomEntered, gameState.phase]);

  // 타이머 종료 시 자동 단계 전환
  useEffect(() => {
    if (role === 'HOST' && gameState.timer === 0 && gameState.phase !== 'LOBBY' && gameState.phase !== 'END') {
      nextPhase();
    }
  }, [gameState.timer, role]);

  // 데이터 동기화 리스너
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
            next.logs = [`🚩 ${next.countries[cid].flag} ${action.nickname} 사령관 전선 배치 완료!`, ...next.logs];
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
            next.logs = [`✅ ${next.countries[cid].nickname} 전략 적중!`, ...next.logs];
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
    } catch (e) { alert("연결 실패"); }
    setIsConnecting(false);
  };

  const nextPhase = () => {
    playSfx(SFX.TRANSITION);
    setGameState(prev => {
      let next = { ...prev };
      if (next.phase === 'LOBBY') { next.phase = 'SETUP'; next.timer = 0; }
      else if (next.phase === 'SETUP') { next.phase = 'DEVELOPMENT'; next.timer = 30; }
      else if (next.phase === 'DEVELOPMENT') { 
        next.phase = 'QUIZ'; next.timer = 30; 
        next.currentQuizId = next.selectedQuizIds[next.turn - 1]; 
      }
      else if (next.phase === 'QUIZ') { next.phase = 'DISCUSSION'; next.timer = 180; }
      else if (next.phase === 'DISCUSSION') {
        // 이전 퀴즈 결과 초기화
        (Object.values(next.countries) as Country[]).forEach(c => { c.isCorrect = null; c.lastChoice = null; });
        if (next.turn === MAX_TURNS) next.phase = 'END';
        else { next.turn++; next.phase = 'DEVELOPMENT'; next.timer = 30; }
      }
      syncService.syncGameState(next);
      return next;
    });
  };

  const addTime = (sec: number) => {
    setGameState(prev => {
      const next = { ...prev, timer: Math.max(0, prev.timer + sec) };
      syncService.syncGameState(next);
      return next;
    });
  };

  const currentTheme = PHASE_THEMES[gameState.phase];

  const renderLobby = () => (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 animate-in fade-in duration-1000 relative overflow-hidden bg-slate-950">
      <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#34d399 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>
      <div className="relative z-10 text-center space-y-12 w-full max-w-7xl">
        <h1 className="text-9xl font-black italic text-white tracking-tighter">CLIMATE <span className="text-emerald-400">WAR</span></h1>
        <div className="max-w-md mx-auto space-y-6 glass p-10 rounded-[3rem] border border-white/10 shadow-2xl bg-black/40">
          <input type="text" placeholder="방 코드(예:ROOM1)" value={roomInput} onChange={(e) => setRoomInput(e.target.value.toUpperCase())} className="w-full p-6 bg-black/40 border-2 border-emerald-500/30 rounded-3xl text-center text-4xl font-black text-white" />
          <input type="text" placeholder="학생 닉네임" value={nicknameInput} onChange={(e) => setNicknameInput(e.target.value)} className="w-full p-5 bg-black/40 border border-white/10 rounded-2xl text-center text-2xl font-bold text-white" />
          <div className="grid grid-cols-2 gap-6 pt-4">
            <button onClick={() => handleEnterRoom('HOST')} className="p-8 bg-emerald-600 hover:bg-emerald-500 rounded-[2rem] font-black text-2xl border-b-8 border-emerald-800">교사 접속</button>
            <button onClick={() => handleEnterRoom('GUEST')} className="p-8 bg-blue-600 hover:bg-blue-500 rounded-[2rem] font-black text-2xl border-b-8 border-blue-800">학생 접속</button>
          </div>
        </div>
        {role === 'HOST' && (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-9 gap-4 animate-in slide-in-from-bottom-10">
            {(Object.values(gameState.countries) as Country[]).map(c => (
              <div key={c.id} className={`p-4 rounded-2xl border-2 transition-all ${c.isJoined ? 'bg-emerald-500/20 border-emerald-500' : 'bg-white/5 border-white/10 opacity-40'}`}>
                <div className="text-4xl mb-2">{c.flag}</div>
                <div className="text-xs font-black truncate">{c.nickname || c.name}</div>
                {c.isJoined && <div className="mt-2 text-[10px] text-emerald-400 animate-pulse font-black uppercase">Online</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className={`min-h-screen transition-bg bg-gradient-to-br ${currentTheme.color}`}>
      {gameState.phase === 'LOBBY' ? renderLobby() : (
        <div className="animate-in fade-in">
          {/* 헤더 */}
          <div className="relative h-[300px] w-full overflow-hidden shadow-2xl border-b border-white/10">
            <img src={currentTheme.img} className="absolute inset-0 w-full h-full object-cover opacity-40" />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent"></div>
            <div className="absolute bottom-0 left-0 w-full p-12 flex justify-between items-end">
              <div>
                <h1 className="text-6xl font-black italic uppercase text-white leading-none">{gameState.phase}</h1>
                <p className="text-2xl font-bold text-emerald-400 mt-2 uppercase tracking-widest">{currentTheme.label} • ROUND {gameState.turn}</p>
              </div>
              <div className="flex flex-col items-end gap-4">
                <div className="text-8xl font-black tabular-nums text-white bg-black/60 px-12 py-4 rounded-[2rem] border-2 border-white/10">
                  {gameState.timer}S
                </div>
                {role === 'HOST' && gameState.phase === 'DISCUSSION' && (
                  <div className="flex gap-2">
                    <button onClick={() => addTime(-5)} className="px-6 py-2 bg-red-600 rounded-xl font-black">- 5S</button>
                    <button onClick={() => addTime(5)} className="px-6 py-2 bg-emerald-600 rounded-xl font-black">+ 5S</button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <main className="max-w-[1700px] mx-auto p-10 grid grid-cols-1 lg:grid-cols-12 gap-10">
            {/* 좌측 패널 */}
            <aside className="lg:col-span-3 space-y-8">
              <TemperatureGauge temp={gameState.temperature} />
              <div className="glass p-8 rounded-[3rem] h-[500px] flex flex-col bg-black/40">
                <h3 className="text-xs font-black uppercase opacity-40 mb-4 tracking-widest">전술 상황 로그</h3>
                <div className="overflow-y-auto flex-1 space-y-2 custom-scrollbar">
                  {gameState.logs.map((log, i) => (
                    <div key={i} className="text-sm border-l-2 border-emerald-500/50 pl-4 py-2 bg-white/5 rounded-r-lg font-bold">{log}</div>
                  ))}
                </div>
              </div>
            </aside>

            {/* 메인 콘텐츠 영역 */}
            <section className="lg:col-span-9">
              {role === 'HOST' && gameState.phase === 'SETUP' && (
                <div className="glass p-12 rounded-[4rem] space-y-10 bg-black/20">
                  <div className="flex justify-between items-center border-b border-white/10 pb-6">
                    <h2 className="text-4xl font-black italic">작전용 퀴즈 뱅크</h2>
                    <button onClick={nextPhase} className="px-16 py-6 bg-emerald-600 hover:bg-emerald-500 rounded-3xl font-black text-2xl border-b-8 border-emerald-800">라운드 시작 ▶</button>
                  </div>
                  <div className="grid grid-cols-2 gap-8">
                    <div className="p-8 bg-black/40 rounded-[2rem] h-[500px] overflow-y-auto custom-scrollbar">
                      <p className="text-emerald-400 font-black mb-4 uppercase text-xs">선택된 퀴즈 ({gameState.selectedQuizIds.length}/{MAX_TURNS})</p>
                      {QUIZ_POOL.map(q => (
                        <div key={q.id} onClick={() => {
                          setGameState(prev => {
                            const isSel = prev.selectedQuizIds.includes(q.id);
                            const nextSel = isSel ? prev.selectedQuizIds.filter(id => id !== q.id) : [...prev.selectedQuizIds, q.id];
                            if (nextSel.length > MAX_TURNS) return prev;
                            return { ...prev, selectedQuizIds: nextSel };
                          });
                        }} className={`p-4 mb-3 rounded-xl border-2 transition-all cursor-pointer ${gameState.selectedQuizIds.includes(q.id) ? 'border-emerald-500 bg-emerald-500/10' : 'border-white/5 hover:border-white/20'}`}>
                          <div className="font-bold">{q.question}</div>
                          {gameState.selectedQuizIds.includes(q.id) && (
                            <div className="mt-2 text-xs text-emerald-300">
                              정답: {q.answer + 1}번 | {q.options[q.answer]}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="p-8 bg-black/40 rounded-[2rem] space-y-6">
                      <h3 className="text-2xl font-black text-blue-400 italic">지휘관 직접 출제</h3>
                      <input type="text" placeholder="질문 내용" value={newQuiz.question} onChange={e => setNewQuiz({...newQuiz, question: e.target.value})} className="w-full p-4 bg-white/5 rounded-xl border border-white/10 text-xl font-bold" />
                      <div className="grid grid-cols-2 gap-2">
                        {newQuiz.options.map((opt, i) => (
                          <input key={i} type="text" placeholder={`선택지 ${i+1}`} value={opt} onChange={e => { const o = [...newQuiz.options]; o[i]=e.target.value; setNewQuiz({...newQuiz, options:o}); }} className={`p-3 bg-white/5 rounded-lg border ${newQuiz.answer === i ? 'border-blue-500' : 'border-white/10'}`} onClick={() => setNewQuiz({...newQuiz, answer: i})} />
                        ))}
                      </div>
                      <button onClick={() => {
                        const q: QuizQuestion = { id: Date.now(), question: newQuiz.question, options: [...newQuiz.options], answer: newQuiz.answer, explanation: '교사 출제' };
                        setGameState(prev => ({ ...prev, customQuizzes: [...prev.customQuizzes, q], selectedQuizIds: [...prev.selectedQuizIds, q.id].slice(0, MAX_TURNS) }));
                        setNewQuiz({ question: '', options: ['', '', '', ''], answer: 0 });
                      }} className="w-full p-5 bg-blue-600 rounded-xl font-black text-xl">문제 목록에 즉시 추가</button>
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
                        <p className="text-6xl font-black leading-tight text-white">{q.question}</p>
                        <div className="grid grid-cols-2 gap-6 max-w-4xl mx-auto">
                          {q.options.map((opt, i) => (
                            <div key={i} className={`p-8 rounded-3xl border-4 font-black text-3xl flex items-center justify-center gap-6 ${i === q.answer ? 'border-emerald-500 bg-emerald-500/20' : 'border-white/10 bg-black/20'}`}>
                              <span className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">{i + 1}</span>
                              {opt}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : <p>문제를 불러올 수 없습니다.</p>;
                  })()}
                </div>
              )}

              {role === 'HOST' && gameState.phase === 'DISCUSSION' && (
                <div className="glass p-12 rounded-[4rem] space-y-10 bg-black/20">
                  <div className="text-center border-b border-white/10 pb-8">
                    <h2 className="text-5xl font-black italic text-amber-400">ROUND {gameState.turn} 전술 결과 보고</h2>
                    <p className="text-xl text-slate-400 mt-2">각 국가의 퀴즈 응답 결과를 분석 중입니다.</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                    <div className="space-y-6">
                      <h3 className="text-2xl font-black uppercase text-emerald-400 italic">퀴즈 정답 확인</h3>
                      {(() => {
                        const q = [...QUIZ_POOL, ...gameState.customQuizzes].find(q => q.id === gameState.currentQuizId);
                        return q ? (
                          <div className="p-8 bg-black/40 rounded-3xl border border-white/10 space-y-4">
                            <p className="text-2xl font-bold">{q.question}</p>
                            <p className="text-3xl font-black text-emerald-400 bg-emerald-500/10 p-4 rounded-xl">정답: {q.answer + 1}. {q.options[q.answer]}</p>
                          </div>
                        ) : null;
                      })()}
                    </div>
                    <div className="space-y-4">
                      <h3 className="text-2xl font-black uppercase text-blue-400 italic">국가별 전술 성패 현황</h3>
                      <div className="grid grid-cols-1 gap-3 overflow-y-auto max-h-[400px] pr-2 custom-scrollbar">
                        {(Object.values(gameState.countries) as Country[]).filter(c=>c.isJoined).map(c => (
                          <div key={c.id} className={`p-5 rounded-2xl flex justify-between items-center border-2 ${c.isCorrect === true ? 'border-emerald-500 bg-emerald-500/10' : c.isCorrect === false ? 'border-red-500 bg-red-500/10' : 'border-white/5 opacity-50'}`}>
                            <div className="flex items-center gap-4">
                              <span className="text-3xl">{c.flag}</span>
                              <span className="font-black text-xl">{c.nickname}</span>
                            </div>
                            <div className="text-2xl font-black">
                              {c.isCorrect === true ? <span className="text-emerald-400">SUCCESS</span> : c.isCorrect === false ? <span className="text-red-500">FAILURE</span> : 'WAITING'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 학생용 콘텐츠 (기존 유지하되 연결 표시 강화) */}
              {role === 'GUEST' && myCountryId && (
                <div className="space-y-12 animate-in fade-in">
                  <div className="glass p-12 rounded-[5rem] flex items-center justify-between bg-gradient-to-r from-blue-600/20 to-transparent">
                    <div className="flex items-center gap-10">
                      <span className="text-[150px] drop-shadow-2xl">{gameState.countries[myCountryId].flag}</span>
                      <div>
                        <h2 className="text-7xl font-black italic text-white leading-none">{gameState.countries[myCountryId].nickname}</h2>
                        <div className="text-3xl font-black text-emerald-400 mt-4 tabular-nums">ASSET: {gameState.countries[myCountryId].gp} GP</div>
                      </div>
                    </div>
                    <div className="text-right">
                       <div className="flex items-center gap-3 justify-end mb-2">
                         <div className="w-4 h-4 bg-emerald-500 rounded-full animate-pulse"></div>
                         <span className="font-black text-emerald-400">전술망 연결됨</span>
                       </div>
                       <p className="text-slate-500 font-bold uppercase tracking-widest">Global Command Uplink</p>
                    </div>
                  </div>

                  <div className="glass p-20 rounded-[6rem] min-h-[500px] flex items-center justify-center text-center">
                    {gameState.phase === 'DEVELOPMENT' ? (
                      <div className="space-y-12 w-full">
                        <h3 className="text-6xl font-black italic text-white uppercase">전략 선택 (STRATEGY)</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                          {['ECONOMIC', 'BALANCED', 'ENVIRONMENTAL'].map(opt => (
                            <button key={opt} onClick={() => { playSfx(SFX.CLICK); syncService.sendAction(gameState.roomId, { type: 'SELECT_DEVELOPMENT', countryId: myCountryId!, choice: opt }); }} className={`p-12 rounded-[3rem] border-4 transition-all text-3xl font-black ${gameState.countries[myCountryId!].lastChoice === opt ? 'bg-blue-600 border-blue-400 scale-105' : 'bg-white/5 border-transparent'}`}>
                              {opt === 'ECONOMIC' ? '경제 중심' : opt === 'BALANCED' ? '지속 성장' : '환경 우선'}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : gameState.phase === 'QUIZ' ? (
                      <div className="space-y-12 w-full">
                        <h3 className="text-6xl font-black italic text-emerald-400 uppercase">전술 문제 응답</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                          {[1,2,3,4].map(n => (
                            <button key={n} onClick={() => {
                              const q = [...QUIZ_POOL, ...gameState.customQuizzes].find(q => q.id === gameState.currentQuizId);
                              if (q) syncService.sendAction(gameState.roomId, { type: 'QUIZ_RESULT', countryId: myCountryId, correct: (n-1) === q.answer });
                              playSfx(SFX.CLICK);
                            }} className={`p-16 rounded-[3rem] border-4 text-7xl font-black bg-white/5 hover:bg-emerald-500/20 border-white/10 active:scale-95 transition-all ${gameState.countries[myCountryId!].isCorrect !== null ? 'opacity-30' : ''}`}>
                              {n}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-8">
                        <div className="w-32 h-32 border-[12px] border-white/10 border-t-emerald-400 rounded-full animate-spin mx-auto"></div>
                        <h3 className="text-5xl font-black italic text-white/30 uppercase tracking-widest">사령부의 다음 명령을 대기 중...</h3>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          </main>
        </div>
      )}
    </div>
  );
};

export default App;
