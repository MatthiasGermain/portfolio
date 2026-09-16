export const prerender = false;

import type { APIRoute } from 'astro';
import { getPlayerView } from '../../../lib/thomas-tcg/view';

export const GET: APIRoute = async ({ url }) => {
  const pid = url.searchParams.get('pid') ?? '';
  const result = await getPlayerView(pid);
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
};
