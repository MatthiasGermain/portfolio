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

  if (!ready || match.revealedCount >= match.targetLength) {
    return new Response(JSON.stringify({ error: 'not-ready' }), { status: 400 });
  }

  const cmap = new Map(THOMAS_CARDS.map((c) => [c.id, c]));
  const playerA = state.players[match.a as string];
  const playerB = state.players[match.b as string];

  if (match.revealSub === 0) {
    match.revealSub = 1;
    await saveState(state);
    const card = tournament.resolveCard(playerA, selectionA[match.revealedCount], cmap);
    return new Response(
      JSON.stringify({ step: 'reveal-a', card, roundIndex: match.revealedCount }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }

  // revealSub === 1 : on montre la carte de B et on applique les dégâts du round.
  const roundIndex = match.revealedCount;
  match.revealedCount += 1;
  match.revealSub = 0;
  await saveState(state);

  const card = tournament.resolveCard(playerB, selectionB[roundIndex], cmap);
  const newPvA = tournament.pvAfter(playerB, selectionB, playerA, selectionA, match.revealedCount, cmap);
  const newPvB = tournament.pvAfter(playerA, selectionA, playerB, selectionB, match.revealedCount, cmap);

  return new Response(
    JSON.stringify({
      step: 'reveal-b',
      card,
      roundIndex,
      newPvA,
      newPvB,
      canResolve: match.revealedCount >= match.targetLength,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
