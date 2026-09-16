export interface HandEntry {
  instanceId: string;
  cardId: string;
}

export interface Player {
  id: string;
  name: string;
  hand: HandEntry[];
  used: string[]; // instanceId already played
}

export interface Match {
  id: string;
  a: string | null;
  b: string | null;
  winner: string | null;
  isBye: boolean;
  selectionA: string[] | null; // instanceIds choisis d'un coup, grandit de 1 à chaque manche de tie-break
  selectionB: string[] | null;
  targetLength: number; // taille attendue de selectionA/B pour que la phase de sélection soit complète (3, puis +1 par égalité)
  revealedCount: number; // nombre de manches déjà entièrement révélées (dégâts appliqués)
  revealSub: 0 | 1; // 0 = carte de A du round courant pas encore montrée ; 1 = montrée, en attente de B
}

export interface TournamentState {
  status: 'running';
  players: Record<string, Player>;
  rounds: Match[][];
}

export interface CrossTotals {
  charismeA: number;
  charismeB: number;
  dripA: number;
  dripB: number;
  pvA: number;
  pvB: number;
}
