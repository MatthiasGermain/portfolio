export const prerender = false;

import type { APIRoute } from 'astro';
import { getHostView } from '../../../lib/thomas-tcg/view';

export const GET: APIRoute = async () => {
  const view = await getHostView();
  return new Response(JSON.stringify(view), { headers: { 'Content-Type': 'application/json' } });
};
