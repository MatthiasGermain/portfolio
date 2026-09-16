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

  const { match, roundIdx, matchIdx } = active;
  if (match.revealedCount < match.targetLength || match.revealSub !== 0) {
    return new Response(JSON.stringify({ error: 'not-ready' }), { status: 400 });
  }

  const cmap = new Map(THOMAS_CARDS.map((c) => [c.id, c]));
  const playerA = state.players[match.a as string];
  const playerB = state.players[match.b as string];
  const totals = tournament.crossTotals(match, playerA, playerB, cmap);

  if (totals.pvA !== totals.pvB) {
    const winner = totals.pvA > totals.pvB ? (match.a as string) : (match.b as string);
    match.winner = winner;
    tournament.advanceWinner(state.rounds, roundIdx, matchIdx, winner);
    tournament.resolveByes(state.rounds);
    // Le match suivant devient actif : ses joueurs doivent pouvoir choisir.
    tournament.ensurePlayableHands(state, THOMAS_CARDS);
    await saveState(state);
    return new Response(
      JSON.stringify({ result: 'winner', winnerName: state.players[winner].name, pvA: totals.pvA, pvB: totals.pvB }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }

  match.targetLength += 1;
  // Départage : chacun doit pouvoir ajouter une carte, même après plusieurs égalités.
  tournament.ensurePlayableHands(state, THOMAS_CARDS);
  await saveState(state);
  return new Response(JSON.stringify({ result: 'tie' }), { headers: { 'Content-Type': 'application/json' } });
};
