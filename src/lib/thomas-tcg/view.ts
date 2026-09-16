import { THOMAS_CARDS, type ThomasCard } from '../../data/thomas-tcg-cards';
import * as tournament from './tournament';
import { getState } from './store';
import type { Match, Player, TournamentState } from './types';

export function cardsMap(): Map<string, ThomasCard> {
  return new Map(THOMAS_CARDS.map((c) => [c.id, c]));
}

export interface BracketMatchView {
  a: string | null;
  b: string | null;
  winner: string | null;
  isBye: boolean;
}

export function buildBracketView(state: TournamentState): BracketMatchView[][] {
  const pname = (pid: string | null) => (pid ? state.players[pid].name : null);
  return state.rounds.map((matches) =>
    matches.map((m) => ({
      a: pname(m.a),
      b: pname(m.b),
      winner: pname(m.winner),
      isBye: m.isBye,
    })),
  );
}

export type HostView =
  | { kind: 'no-tournament' }
  | { kind: 'finished'; championName: string | null; bracket: BracketMatchView[][] }
  | { kind: 'no-active-match'; bracket: BracketMatchView[][] }
  | {
      kind: 'selecting';
      playerAName: string;
      playerBName: string;
      aReady: boolean;
      bReady: boolean;
      isTieBreak: boolean;
      bracket: BracketMatchView[][];
    }
  | {
      kind: 'battle';
      playerAName: string;
      playerBName: string;
      maxPvA: number;
      maxPvB: number;
      currentPvA: number;
      currentPvB: number;
      targetLength: number;
      revealedCount: number;
      revealSub: 0 | 1;
      revealedACard: ThomasCard | null;
      canResolve: boolean;
      bracket: BracketMatchView[][];
    };

export async function getHostView(): Promise<HostView> {
  const state = await getState();
  if (!state) return { kind: 'no-tournament' };

  const cmap = cardsMap();
  const { rounds, players } = state;

  if (tournament.isFinished(rounds)) {
    const champId = tournament.champion(rounds);
    return {
      kind: 'finished',
      championName: champId ? players[champId].name : null,
      bracket: buildBracketView(state),
    };
  }

  const active = tournament.findActiveMatch(rounds);
  if (!active) {
    return { kind: 'no-active-match', bracket: buildBracketView(state) };
  }

  const { match } = active;
  const playerA = players[match.a as string];
  const playerB = players[match.b as string];

  const aReady = (match.selectionA?.length ?? 0) === match.targetLength;
  const bReady = (match.selectionB?.length ?? 0) === match.targetLength;

  if (!aReady || !bReady) {
    return {
      kind: 'selecting',
      playerAName: playerA.name,
      playerBName: playerB.name,
      aReady,
      bReady,
      isTieBreak: match.targetLength > tournament.SELECTION_SIZE,
      bracket: buildBracketView(state),
    };
  }

  const maxPvA = tournament.maxPv(playerA, match.selectionA as string[], cmap);
  const maxPvB = tournament.maxPv(playerB, match.selectionB as string[], cmap);
  const currentPvA = tournament.pvAfter(
    playerB,
    match.selectionB as string[],
    playerA,
    match.selectionA as string[],
    match.revealedCount,
    cmap,
  );
  const currentPvB = tournament.pvAfter(
    playerA,
    match.selectionA as string[],
    playerB,
    match.selectionB as string[],
    match.revealedCount,
    cmap,
  );

  const revealedACard =
    match.revealSub === 1
      ? tournament.resolveCard(playerA, (match.selectionA as string[])[match.revealedCount], cmap)
      : null;

  return {
    kind: 'battle',
    playerAName: playerA.name,
    playerBName: playerB.name,
    maxPvA,
    maxPvB,
    currentPvA,
    currentPvB,
    targetLength: match.targetLength,
    revealedCount: match.revealedCount,
    revealSub: match.revealSub,
    revealedACard,
    canResolve: match.revealedCount >= match.targetLength && match.revealSub === 0,
    bracket: buildBracketView(state),
  };
}

export type PlayerView =
  | { kind: 'no-tournament' }
  | { kind: 'not-found' }
  | { kind: 'finished'; isChampion: boolean; championName: string | null }
  | {
      kind: 'select';
      opponentName: string | null;
      pickCount: number; // combien de cartes à choisir maintenant (3, ou 1 en tie-break)
      available: (ThomasCard & { instanceId: string })[];
      cardsLeft: number;
    }
  | { kind: 'waiting-opponent'; opponentName: string | null }
  | { kind: 'battle-in-progress'; opponentName: string | null }
  | { kind: 'not-your-turn' };

export async function getPlayerView(pid: string): Promise<{ playerName: string | null; view: PlayerView }> {
  const state = await getState();
  if (!state) return { playerName: null, view: { kind: 'no-tournament' } };

  const player: Player | undefined = state.players[pid];
  if (!player) return { playerName: null, view: { kind: 'not-found' } };

  const cmap = cardsMap();
  const { rounds } = state;

  if (tournament.isFinished(rounds)) {
    const champId = tournament.champion(rounds);
    return {
      playerName: player.name,
      view: {
        kind: 'finished',
        isChampion: champId === pid,
        championName: champId ? state.players[champId].name : null,
      },
    };
  }

  const active = tournament.findActiveMatch(rounds);
  const match: Match | null = active ? active.match : null;

  if (!match || (match.a !== pid && match.b !== pid)) {
    return { playerName: player.name, view: { kind: 'not-your-turn' } };
  }

  const role = match.a === pid ? 'a' : 'b';
  const oppId = role === 'a' ? match.b : match.a;
  const opponentName = oppId ? state.players[oppId].name : null;

  const mySelection = role === 'a' ? match.selectionA : match.selectionB;
  const oppSelection = role === 'a' ? match.selectionB : match.selectionA;
  const myReady = (mySelection?.length ?? 0) === match.targetLength;
  const oppReady = (oppSelection?.length ?? 0) === match.targetLength;

  if (myReady && oppReady) {
    return { playerName: player.name, view: { kind: 'battle-in-progress', opponentName } };
  }
  if (myReady) {
    return { playerName: player.name, view: { kind: 'waiting-opponent', opponentName } };
  }

  const pickCount = match.targetLength - (mySelection?.length ?? 0);
  const available = tournament.availableCards(player).map((h) => {
    const card = cmap.get(h.cardId)!;
    return { ...card, instanceId: h.instanceId };
  });

  return {
    playerName: player.name,
    view: { kind: 'select', opponentName, pickCount, available, cardsLeft: available.length },
  };
}
