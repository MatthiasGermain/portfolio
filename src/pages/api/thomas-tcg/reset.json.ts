export const prerender = false;

import type { APIRoute } from 'astro';
import { clearState } from '../../../lib/thomas-tcg/store';

export const POST: APIRoute = async ({ redirect }) => {
  await clearState();
  return redirect('/thomas-tcg/setup');
};
