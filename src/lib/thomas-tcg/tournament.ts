import { randomUUID } from 'node:crypto';
import type { ThomasCard } from '../../data/thomas-tcg-cards';
import type { HandEntry, Match, Player, TournamentState } from './types';

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

/** Puissance d'une carte : son poids dans l'issue d'un match. */
export function cardPower(card: ThomasCard): number {
  return card.charisme + card.drip;
}

/**
 * Distribue des mains équilibrées. Les cartes sont classées par puissance puis
 * découpées en autant de paliers que la main compte de cartes ; chaque joueur
 * reçoit une carte tirée au hasard dans chaque palier.
 *
 * Les mains restent différentes d'un joueur à l'autre, mais leur force est
 * comparable et une même main ne contient jamais deux fois la même carte.
 * Mesuré sur les 30 cartes, mains de 15 : écart moyen entre les 3 meilleures
 * cartes de deux joueurs de 2,5 à 0,75 point, dispersion de la force totale de
 * ±12,6 à ±1,9, doublons dans une main de 99 % à 0 %.
 *
 * Si la main demandée dépasse le nombre de cartes existantes, on revient à un
 * tirage libre (les paliers seraient vides).
 */
export function dealHands(playerNames: string[], cardPool: ThomasCard[], handSize = MIN_HAND_SIZE): Player[] {
  if (handSize > cardPool.length) {
    return playerNames.map((name) => newPlayer(name, Array.from({ length: handSize }, () => drawCard(cardPool))));
  }

  // Mélange avant le tri : entre cartes de même puissance, l'ordre est aléatoire.
  const byPower = shuffle(cardPool).sort((a, b) => cardPower(a) - cardPower(b));
  const tiers = Array.from({ length: handSize }, (_, t) =>
    byPower.slice(Math.floor((t * byPower.length) / handSize), Math.floor(((t + 1) * byPower.length) / handSize)),
  );

  return playerNames.map((name) =>
    newPlayer(
      name,
      tiers.map((tier) => ({ instanceId: uuid(), cardId: tier[Math.floor(Math.random() * tier.length)].id })),
    ),
  );
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

/**
 * `isBye` n'a de sens qu'au premier tour, où un joueur peut être seul. Les
 * matchs des tours suivants sont créés vides puis remplis par les vainqueurs :
 * les déduire de `a`/`b` à la création les marquait tous à tort comme exempts.
 */
function newMatch(a: string | null, b: string | null, isBye = a === null || b === null): Match {
  return {
    id: uuid(),
    a,
    b,
    winner: null,
    isBye,
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
    rounds.push(Array.from({ length: remaining / 2 }, () => newMatch(null, null, false)));
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

/*
 * RÈGLE D'UN MATCH : meilleur des 3 manches.
 *
 * Chaque joueur choisit ses cartes en secret ; l'ordre choisi est l'ordre des
 * manches. À chaque manche, la carte la plus puissante (charisme + drip)
 * l'emporte ; à puissance égale, la manche est nulle.
 *
 * Le match est gagné dès qu'un joueur ne peut plus être rattrapé : son avance
 * dépasse le nombre de manches restantes (un 2-0 évite la 3e révélation).
 * Égalité une fois toutes les manches jouées : manche décisive, chacun ajoute
 * une carte (`targetLength + 1`), et on recommence tant qu'elle est nulle.
 *
 * Retenue après simulation sur les vraies cartes : c'est la seule formule
 * testée où l'ordre crée un vrai bluff (il change le vainqueur dans 48 % des
 * matchs, et le joueur aux cartes les plus faibles gagne grâce à l'ordre dans
 * 12 % des cas). Avec l'ancienne règle, une somme, l'ordre ne comptait jamais.
 */

export type RoundResult = 'a' | 'b' | 'draw';

export interface MatchScore {
  /** Résultat de chaque manche déjà révélée, dans l'ordre. */
  rounds: RoundResult[];
  winsA: number;
  winsB: number;
  /** `ongoing` : il reste des manches utiles ; `winner` : match plié ; `tie` : manche décisive nécessaire. */
  status: 'ongoing' | 'winner' | 'tie';
  winner: 'a' | 'b' | null;
}

export function roundResult(cardA: ThomasCard, cardB: ThomasCard): RoundResult {
  const diff = cardPower(cardA) - cardPower(cardB);
  return diff > 0 ? 'a' : diff < 0 ? 'b' : 'draw';
}

/** Score d'un match d'après les manches déjà révélées. */
export function matchScore(
  match: Match,
  playerA: Player,
  playerB: Player,
  cardsMap: Map<string, ThomasCard>,
): MatchScore {
  const selectionA = match.selectionA ?? [];
  const selectionB = match.selectionB ?? [];
  const rounds: RoundResult[] = [];
  for (let r = 0; r < match.revealedCount; r++) {
    rounds.push(
      roundResult(resolveCard(playerA, selectionA[r], cardsMap), resolveCard(playerB, selectionB[r], cardsMap)),
    );
  }

  const winsA = rounds.filter((r) => r === 'a').length;
  const winsB = rounds.filter((r) => r === 'b').length;
  const remaining = match.targetLength - match.revealedCount;

  if (Math.abs(winsA - winsB) > remaining) {
    return { rounds, winsA, winsB, status: 'winner', winner: winsA > winsB ? 'a' : 'b' };
  }
  if (remaining === 0) {
    return { rounds, winsA, winsB, status: 'tie', winner: null };
  }
  return { rounds, winsA, winsB, status: 'ongoing', winner: null };
}

export { SELECTION_SIZE };
