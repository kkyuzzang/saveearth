
export type GamePhase = 'LOBBY' | 'SETUP' | 'DEVELOPMENT' | 'QUIZ' | 'DISCUSSION' | 'UN_MEETING' | 'END';

export type DevelopmentChoice = 'ECONOMIC' | 'BALANCED' | 'ENVIRONMENTAL' | null;

export type CountryId = 'KOREA' | 'USA' | 'SWEDEN' | 'JAPAN' | 'TUVALU' | 'DENMARK' | 'FRANCE' | 'BRAZIL' | 'NKOREA';

export interface Country {
  id: CountryId;
  name: string;
  flag: string;
  abilityName: string;
  abilityDesc: string;
  gp: number;
  lastChoice: DevelopmentChoice;
  isAbilityUsed: boolean;
  isJoined: boolean;
  nickname: string;
  score: number;
}

export interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  answer: number; // 0-3 index
  explanation: string;
}

export interface GameState {
  roomId: string;
  phase: GamePhase;
  turn: number;
  temperature: number;
  countries: Record<CountryId, Country>;
  logs: string[];
  timer: number;
  currentQuizId: number | null;
  selectedQuizIds: number[];
  customQuizzes: QuizQuestion[];
  rpsTargetA: CountryId | null;
  rpsTargetB: CountryId | null;
  rpsChoiceA: 'ROCK' | 'PAPER' | 'SCISSORS' | null;
  rpsChoiceB: 'ROCK' | 'PAPER' | 'SCISSORS' | null;
  lastTurnChoices: Record<CountryId, DevelopmentChoice>;
  // Ability Active Flags
  activeEffects: {
    swedenWaiting: boolean; // Sweden activated, waiting for turn end
    japanActive: boolean;
    denmarkTurnsLeft: number;
    franceActive: boolean;
    brazilActive: boolean;
    tuvaluWaiting: boolean;
  };
}

export enum RPSResult {
  A_WIN,
  B_WIN,
  DRAW
}
