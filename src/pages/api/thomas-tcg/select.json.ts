export const prerender = false;

import type { APIRoute } from 'astro';
import * as tournament from '../../../lib/thomas-tcg/tournament';
import { getState, saveSelection } from '../../../lib/thomas-tcg/store';
import { getPlayerView } from '../../../lib/thomas-tcg/view';

export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData();
  const pid = String(form.get('pid') ?? '');
  const submitted = form.getAll('instance_id').map(String);

  const state = await getState();
  if (state) {
    const player = state.players[pid];
    const active = tournament.findActiveMatch(state.rounds);

    if (player && active && (active.match.a === pid || active.match.b === pid)) {
      const { match } = active;
      const role = match.a === pid ? 'a' : 'b';
      const key = role === 'a' ? 'selectionA' : 'selectionB';
      const current = match[key] ?? [];
      const needed = match.targetLength - current.length;

      const availableIds = new Set(tournament.availableCards(player).map((h) => h.instanceId));
      const uniqueSubmitted = new Set(submitted);

      const valid =
        needed > 0 &&
        submitted.length === needed &&
        uniqueSubmitted.size === submitted.length &&
        submitted.every((id) => availableIds.has(id));

      if (valid) {
        // Écriture limitée aux champs de ce joueur : l'adversaire qui valide au
        // même instant ne peut pas écraser cette sélection (voir store.ts).
        await saveSelection(match.id, pid, [...current, ...submitted], [...player.used, ...submitted]);
      }
    }
  }

  const result = await getPlayerView(pid);
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
};
