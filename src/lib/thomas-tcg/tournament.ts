import { randomUUID } from 'node:crypto';
import type { ThomasCard } from '../../data/thomas-tcg-cards';
import type { CrossTotals, HandEntry, Match, Player, TournamentState } from './types';

const SELECTION_SIZE = 3;
const MIN_HAND_SIZE = 15;

function uuid(): string {
  return randomUUID();
}

/** Mélange de Fisher-Yates, sans modifier le tableau d'origine. */
function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function newPlayer(name: string, hand: HandEntry[]): Player {
  return { id: uuid(), name, hand, used: [] };
}

export function availableCards(player: Player): HandEntry[] {
  const used = new Set(player.used);
  return player.hand.filter((h) => !used.has(h.instanceId));
}

export function resolveCard(
  player: Player,
  instanceId: string,
  cardsMap: Map<string, ThomasCard>,
): ThomasCard {
  const entry = player.hand.find((h) => h.instanceId === instanceId);
  if (!entry) throw new Error(`Instance ${instanceId} introuvable dans la main de ${player.name}`);
  const card = cardsMap.get(entry.cardId);
  if (!card) throw new Error(`Carte ${entry.cardId} introuvable`);
  return card;
}

function drawCard(cardPool: ThomasCard[]): HandEntry {
  return { instanceId: uuid(), cardId: cardPool[Math.floor(Math.random() * cardPool.length)].id };
}

export function dealHands(playerNames: string[], cardPool: ThomasCard[], handSize = MIN_HAND_SIZE): Player[] {
  return playerNames.map((name) => newPlayer(name, Array.from({ length: handSize }, () => drawCard(cardPool))));
}

/**
 * Taille de main pour un tournoi : assez pour que le finaliste joue tous ses
 * matchs en gardant le choix, avec une marge d'une manche pour les égalités.
 * Reste à 15 jusqu'à 16 joueurs ; passe à 18 de 17 à 20 (5 tours × 3 = 15, la
 * main entière sinon, et la première égalité bloquait le match).
 */
export function handSizeFor(playerCount: number): number {
  const rounds = Math.ceil(Math.log2(Math.max(2, playerCount)));
  return Math.max(MIN_HAND_SIZE, rounds * SELECTION_SIZE + SELECTION_SIZE);
}

/**
 * Filet de sécurité : garantit que les deux joueurs du match actif ont assez
 * de cartes pour ce qu'on attend d'eux (3 en début de match, 1 par égalité).
 * Il manque des cartes seulement après une série d'égalités ; le joueur pioche
 * alors au hasard le strict nécessaire. Sans ça, il ne peut pas valider et le
 * tournoi reste bloqué.
 *
 * À appeler dès qu'un match devient actif ou part en départage. Modifie les
 * mains, qui font partie du tournoi : enregistrer ensuite avec `saveState`.
 */
export function ensurePlayableHands(state: TournamentState, cardPool: ThomasCard[]): void {
  const active = findActiveMatch(state.rounds);
  if (!active) return;
  const { match } = active;

  const sides: [string | null, string[] | null][] = [
    [match.a, match.selectionA],
    [match.b, match.selectionB],
  ];
  for (const [pid, selection] of sides) {
    if (!pid) continue;
    const player = state.players[pid];
    const needed = match.targetLength - (selection?.length ?? 0);
    const missing = needed - availableCards(player).length;
    for (let i = 0; i < missing; i++) player.hand.push(drawCard(cardPool));
  }
}

function newMatch(a: string | null, b: string | null): Match {
  return {
    id: uuid(),
    a,
    b,
    winner: null,
    isBye: a === null || b === null,
    selectionA: null,
    selectionB: null,
    targetLength: SELECTION_SIZE,
    revealedCount: 0,
    revealSub: 0,
  };
}

export function buildBracket(playerIds: string[]): Match[][] {
  const n = playerIds.length;
  let size = 1;
  while (size < n) size *= 2;

  // Les places vides (exempts) ne doivent jamais se rencontrer entre elles :
  // un match vide contre vide n'a pas de vainqueur, laisse un trou au tour
  // suivant, et le tournoi se bloque. On construit donc d'abord les paires —
  // chaque exempt est associé à un joueur — puis on mélange l'ordre des paires.
  // Toujours possible : `size` est la plus petite puissance de 2 ≥ n, donc
  // le nombre d'exempts (size - n) est inférieur au nombre de paires (size / 2).
  const players = shuffle(playerIds);
  const byes = size - n;
  const pairs: [string | null, string | null][] = [];
  let next = 0;
  for (let i = 0; i < byes; i++) {
    pairs.push([players[next++], null]);
  }
  while (next < n) {
    pairs.push([players[next++], players[next++]]);
  }

  const round0: Match[] = shuffle(pairs).map(([a, b]) => newMatch(a, b));

  const rounds: Match[][] = [round0];
  let remaining = size / 2;
  while (remaining > 1) {
    rounds.push(Array.from({ length: remaining / 2 }, () => newMatch(null, null)));
    remaining /= 2;
  }

  resolveByes(rounds);
  return rounds;
}

export function resolveByes(rounds: Match[][]): void {
  rounds[0].forEach((match, mIdx) => {
    if (match.isBye && match.winner === null) {
      const winner = match.a !== null ? match.a : match.b;
      match.winner = winner;
      advanceWinner(rounds, 0, mIdx, winner as string);
    }
  });
}

export function advanceWinner(
  rounds: Match[][],
  roundIdx: number,
  matchIdx: number,
  winnerId: string,
): void {
  if (roundIdx + 1 >= rounds.length) return;
  const nextMatch = rounds[roundIdx + 1][Math.floor(matchIdx / 2)];
  const slot = matchIdx % 2 === 0 ? 'a' : 'b';
  nextMatch[slot] = winnerId;
}

export function findActiveMatch(
  rounds: Match[][],
): { roundIdx: number; matchIdx: number; match: Match } | null {
  for (let rIdx = 0; rIdx < rounds.length; rIdx++) {
    for (let mIdx = 0; mIdx < rounds[rIdx].length; mIdx++) {
      const match = rounds[rIdx][mIdx];
      if (match.winner !== null) continue;
      if (match.a === null || match.b === null) continue;
      return { roundIdx: rIdx, matchIdx: mIdx, match };
    }
  }
  return null;
}

export function isFinished(rounds: Match[][]): boolean {
  const last = rounds[rounds.length - 1];
  return last.length === 1 && last[0].winner !== null;
}

export function champion(rounds: Match[][]): string | null {
  const last = rounds[rounds.length - 1];
  return last.length === 1 ? last[0].winner : null;
}

/** Total de PV de départ = somme du Charisme des cartes sélectionnées. */
export function maxPv(
  player: Player,
  selection: string[],
  cardsMap: Map<string, ThomasCard>,
): number {
  return selection.reduce((sum, inst) => sum + resolveCard(player, inst, cardsMap).charisme, 0);
}

/** PV restants après N manches entièrement révélées (dégâts = drip adverse cumulé). */
export function pvAfter(
  attacker: Player,
  attackerSelection: string[],
  defender: Player,
  defenderSelection: string[],
  revealedCount: number,
  cardsMap: Map<string, ThomasCard>,
): number {
  const startingPv = maxPv(defender, defenderSelection, cardsMap);
  const damageTaken = attackerSelection
    .slice(0, revealedCount)
    .reduce((sum, inst) => sum + resolveCard(attacker, inst, cardsMap).drip, 0);
  return startingPv - damageTaken;
}

export function crossTotals(
  match: Match,
  playerA: Player,
  playerB: Player,
  cardsMap: Map<string, ThomasCard>,
): CrossTotals {
  const selectionA = match.selectionA ?? [];
  const selectionB = match.selectionB ?? [];
  const charismeA = maxPv(playerA, selectionA, cardsMap);
  const charismeB = maxPv(playerB, selectionB, cardsMap);
  const dripA = selectionA.reduce((s, i) => s + resolveCard(playerA, i, cardsMap).drip, 0);
  const dripB = selectionB.reduce((s, i) => s + resolveCard(playerB, i, cardsMap).drip, 0);

  return {
    charismeA,
    charismeB,
    dripA,
    dripB,
    pvA: charismeA - dripB,
    pvB: charismeB - dripA,
  };
}

export { SELECTION_SIZE };
