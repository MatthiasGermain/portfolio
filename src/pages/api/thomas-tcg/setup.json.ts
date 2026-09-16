export const prerender = false;

import type { APIRoute } from 'astro';
import { THOMAS_CARDS } from '../../../data/thomas-tcg-cards';
import * as tournament from '../../../lib/thomas-tcg/tournament';
import { clearState, saveState } from '../../../lib/thomas-tcg/store';
import type { Player, TournamentState } from '../../../lib/thomas-tcg/types';

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const raw = String(form.get('names') ?? '');
  const names = raw
    .split('\n')
    .map((n) => n.trim())
    .filter(Boolean)
    .slice(0, 20);

  if (names.length < 2 || THOMAS_CARDS.length === 0) {
    return redirect('/thomas-tcg/setup');
  }

  const playersList = tournament.dealHands(names, THOMAS_CARDS, tournament.handSizeFor(names.length));
  const players: Record<string, Player> = {};
  for (const p of playersList) players[p.id] = p;

  const rounds = tournament.buildBracket(Object.keys(players));

  const state: TournamentState = { status: 'running', players, rounds };
  tournament.ensurePlayableHands(state, THOMAS_CARDS);
  // Repartir d'un stockage vide : les sélections d'un tournoi précédent sont
  // stockées à part du tournoi et ne seraient pas écrasées par ce nouvel état.
  await clearState();
  await saveState(state);

  return redirect('/thomas-tcg/host');
};
