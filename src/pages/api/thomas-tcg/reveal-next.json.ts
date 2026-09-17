export const prerender = false;

import type { APIRoute } from 'astro';
import { THOMAS_CARDS } from '../../../data/thomas-tcg-cards';
import * as tournament from '../../../lib/thomas-tcg/tournament';
import { getState, saveState } from '../../../lib/thomas-tcg/store';

export const POST: APIRoute = async () => {
  const state = await getState();
  if (!state) {
    return new Response(JSON.stringify({ error: 'no-tournament' }), { status: 400 });
  }

  const active = tournament.findActiveMatch(state.rounds);
  if (!active) {
    return new Response(JSON.stringify({ error: 'no-active-match' }), { status: 400 });
  }

  const { match } = active;
  const selectionA = match.selectionA ?? [];
  const selectionB = match.selectionB ?? [];
  const ready = selectionA.length === match.targetLength && selectionB.length === match.targetLength;

  const cmap = new Map(THOMAS_CARDS.map((c) => [c.id, c]));
  const playerA = state.players[match.a as string];
  const playerB = state.players[match.b as string];

  // Rien à révéler si les sélections sont incomplètes, ou si le match est déjà
  // plié (un 2-0 laisse la 3e carte cachée) ou en attente de manche décisive.
  if (!ready || tournament.matchScore(match, playerA, playerB, cmap).status !== 'ongoing') {
    return new Response(JSON.stringify({ error: 'not-ready' }), { status: 400 });
  }

  if (match.revealSub === 0) {
    match.revealSub = 1;
    await saveState(state);
    const card = tournament.resolveCard(playerA, selectionA[match.revealedCount], cmap);
    return new Response(JSON.stringify({ step: 'reveal-a', card, roundIndex: match.revealedCount }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // revealSub === 1 : on montre la carte de B et on attribue la manche.
  const roundIndex = match.revealedCount;
  match.revealedCount += 1;
  match.revealSub = 0;
  await saveState(state);

  const card = tournament.resolveCard(playerB, selectionB[roundIndex], cmap);
  const score = tournament.matchScore(match, playerA, playerB, cmap);

  return new Response(
    JSON.stringify({
      step: 'reveal-b',
      card,
      roundIndex,
      roundWinner: score.rounds[roundIndex],
      winsA: score.winsA,
      winsB: score.winsB,
      canResolve: score.status !== 'ongoing',
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
