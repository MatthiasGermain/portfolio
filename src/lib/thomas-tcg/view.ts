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
  /** Match en train de se jouer. */
  isActive: boolean;
  /** Score en manches une fois le match terminé, ex. "2 – 1". */
  score: string | null;
}

export interface BracketRoundView {
  label: string;
  matches: BracketMatchView[];
}

function roundLabel(matchCount: number): string {
  switch (matchCount) {
    case 1:
      return 'Finale';
    case 2:
      return 'Demi-finales';
    case 4:
      return 'Quarts de finale';
    case 8:
      return 'Huitièmes';
    default:
      return `${matchCount * 2}es de finale`;
  }
}

/**
 * Exempt réel : seulement au premier tour. Les tournois enregistrés avant la
 * correction de `newMatch` portent `isBye = true` sur tous les matchs des tours
 * suivants ; on ne s'y fie donc qu'au premier tour.
 */
function isByeMatch(state: TournamentState, m: Match): boolean {
  return m.isBye && state.rounds[0].includes(m);
}

/** Un match réellement joué (deux joueurs, au moins une manche révélée). */
function isPlayed(state: TournamentState, m: Match): m is Match & { a: string; b: string } {
  return m.a !== null && m.b !== null && !isByeMatch(state, m) && m.revealedCount > 0;
}

export function buildBracketView(state: TournamentState, cmap = cardsMap()): BracketRoundView[] {
  const pname = (pid: string | null) => (pid ? state.players[pid].name : null);
  const active = tournament.findActiveMatch(state.rounds)?.match ?? null;
  return state.rounds.map((matches) => ({
    label: roundLabel(matches.length),
    matches: matches.map((m) => {
      let score: string | null = null;
      if (m.winner && isPlayed(state, m)) {
        const s = tournament.matchScore(m, state.players[m.a], state.players[m.b], cmap);
        score = `${s.winsA} – ${s.winsB}`;
      }
      return {
        a: pname(m.a),
        b: pname(m.b),
        winner: pname(m.winner),
        isBye: isByeMatch(state, m),
        isActive: m === active,
        score,
      };
    }),
  }));
}

export interface TournamentPodium {
  first: string | null;
  second: string | null;
  thirds: string[];
}

export interface CardHighlight {
  title: string;
  image: string | null;
}

export interface TournamentStats {
  mostPlayedCard: (CardHighlight & { count: number }) | null;
  biggestWin: {
    winnerCard: CardHighlight;
    winnerName: string;
    loserCard: CardHighlight;
    loserName: string;
    winnerPower: number;
    loserPower: number;
  } | null;
  longestMatch: { aName: string; bName: string; rounds: number } | null;
}

/** Podium d'élimination directe : vainqueur, finaliste, perdants des demi-finales. */
function buildPodium(state: TournamentState): TournamentPodium {
  const { rounds, players } = state;
  const name = (pid: string | null) => (pid ? players[pid].name : null);
  const loserOf = (m: Match) => (m.winner === m.a ? m.b : m.a);

  const final = rounds[rounds.length - 1][0];
  const semis = rounds.length >= 2 ? rounds[rounds.length - 2] : [];
  return {
    first: name(final.winner),
    second: isByeMatch(state, final) ? null : name(loserOf(final)),
    thirds: semis
      .filter((m) => !isByeMatch(state, m))
      .map((m) => name(loserOf(m)))
      .filter((n): n is string => n !== null),
  };
}

/** Quelques faits marquants calculés à partir des manches révélées. */
function buildStats(state: TournamentState, cmap: Map<string, ThomasCard>): TournamentStats {
  const counts = new Map<string, number>();
  let biggestWin: TournamentStats['biggestWin'] = null;
  let longestMatch: TournamentStats['longestMatch'] = null;
  const highlight = (c: ThomasCard): CardHighlight => ({ title: c.title, image: c.image });

  for (const round of state.rounds) {
    for (const m of round) {
      if (!isPlayed(state, m)) continue;
      const playerA = state.players[m.a];
      const playerB = state.players[m.b];

      for (let r = 0; r < m.revealedCount; r++) {
        const cardA = tournament.resolveCard(playerA, (m.selectionA as string[])[r], cmap);
        const cardB = tournament.resolveCard(playerB, (m.selectionB as string[])[r], cmap);
        counts.set(cardA.id, (counts.get(cardA.id) ?? 0) + 1);
        counts.set(cardB.id, (counts.get(cardB.id) ?? 0) + 1);

        const powerA = tournament.cardPower(cardA);
        const powerB = tournament.cardPower(cardB);
        const gap = Math.abs(powerA - powerB);
        if (gap > 0 && (!biggestWin || gap > biggestWin.winnerPower - biggestWin.loserPower)) {
          const aWins = powerA > powerB;
          biggestWin = {
            winnerCard: highlight(aWins ? cardA : cardB),
            winnerName: (aWins ? playerA : playerB).name,
            loserCard: highlight(aWins ? cardB : cardA),
            loserName: (aWins ? playerB : playerA).name,
            winnerPower: Math.max(powerA, powerB),
            loserPower: Math.min(powerA, powerB),
          };
        }
      }

      if (m.winner && (!longestMatch || m.revealedCount > longestMatch.rounds)) {
        longestMatch = { aName: playerA.name, bName: playerB.name, rounds: m.revealedCount };
      }
    }
  }

  let mostPlayedCard: TournamentStats['mostPlayedCard'] = null;
  for (const [id, count] of counts) {
    if (!mostPlayedCard || count > mostPlayedCard.count) {
      const card = cmap.get(id);
      if (card) mostPlayedCard = { ...highlight(card), count };
    }
  }

  return { mostPlayedCard, biggestWin, longestMatch };
}

export type HostView =
  | { kind: 'no-tournament' }
  | {
      kind: 'finished';
      championName: string | null;
      podium: TournamentPodium;
      stats: TournamentStats;
      bracket: BracketRoundView[];
    }
  | { kind: 'no-active-match'; bracket: BracketRoundView[] }
  | {
      kind: 'selecting';
      playerAName: string;
      playerBName: string;
      aReady: boolean;
      bReady: boolean;
      isTieBreak: boolean;
      bracket: BracketRoundView[];
    }
  | {
      kind: 'battle';
      playerAName: string;
      playerBName: string;
      /** Manches gagnées par chacun. */
      winsA: number;
      winsB: number;
      /** Résultat des manches déjà révélées, dans l'ordre. */
      rounds: tournament.RoundResult[];
      targetLength: number;
      revealedCount: number;
      revealSub: 0 | 1;
      revealedACard: ThomasCard | null;
      canResolve: boolean;
      /** Match plié avant la dernière manche prévue (ex. 2 – 0). */
      decidedEarly: boolean;
      isTieBreak: boolean;
      bracket: BracketRoundView[];
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
      podium: buildPodium(state),
      stats: buildStats(state, cmap),
      bracket: buildBracketView(state, cmap),
    };
  }

  const active = tournament.findActiveMatch(rounds);
  if (!active) {
    return { kind: 'no-active-match', bracket: buildBracketView(state, cmap) };
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
      bracket: buildBracketView(state, cmap),
    };
  }

  const score = tournament.matchScore(match, playerA, playerB, cmap);
  const revealedACard =
    match.revealSub === 1
      ? tournament.resolveCard(playerA, (match.selectionA as string[])[match.revealedCount], cmap)
      : null;

  return {
    kind: 'battle',
    playerAName: playerA.name,
    playerBName: playerB.name,
    winsA: score.winsA,
    winsB: score.winsB,
    rounds: score.rounds,
    targetLength: match.targetLength,
    revealedCount: match.revealedCount,
    revealSub: match.revealSub,
    revealedACard,
    canResolve: score.status !== 'ongoing' && match.revealSub === 0,
    decidedEarly: score.status === 'winner' && match.revealedCount < match.targetLength,
    isTieBreak: match.targetLength > tournament.SELECTION_SIZE,
    bracket: buildBracketView(state, cmap),
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
