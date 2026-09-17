// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  // ⚠️ Remplace par ton vrai domaine une fois déployé (sert pour le SEO / sitemap).
  site: 'https://matthias-germain.dev',
  // 'static' reste le mode par défaut (toutes les pages sont prérendues) ;
  // seules les pages avec `export const prerender = false` (ex. /routine)
  // sont rendues côté serveur grâce à l'adaptateur Vercel ci-dessous.
  output: 'static',
  adapter: vercel(),
  security: {
    // Derrière le proxy Vercel, la fonction ne reçoit pas le vrai domaine :
    // sans cette liste, Astro ignore `X-Forwarded-Host` et croit servir
    // `localhost`. Sa protection CSRF compare alors l'Origin du navigateur à
    // `localhost` et rejette tous les formulaires POST ("Cross-site POST form
    // submissions are forbidden"). Ajouter ici tout domaine réellement utilisé.
    allowedDomains: [{ hostname: 'matthias-germain.vercel.app', protocol: 'https' }],
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
