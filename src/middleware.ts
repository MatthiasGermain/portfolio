import { defineMiddleware } from 'astro:middleware';

const COOKIE_NAME = 'ttcg_auth';

const PAGE_PREFIX = '/thomas-tcg';
const API_PREFIX = '/api/thomas-tcg';
const GATE_PATH = '/thomas-tcg/gate';

/*
 * Le code d'accès est réservé à l'hôte : configuration, écran host, liste des
 * QR codes, reset, révélations. Les joueurs, eux, n'ont pas de code : leur
 * lien personnel contient un identifiant aléatoire (UUID) impossible à
 * deviner, qui les autorise sur leur seule page et leurs deux appels. Chaque
 * route vérifie que cet identifiant appartient au tournoi en cours.
 * `/thomas-tcg/player/` avec la barre finale n'inclut pas `/thomas-tcg/players`
 * (la liste des QR codes, qui expose les liens de tous : réservée à l'hôte).
 */
const PLAYER_PAGE_PREFIX = '/thomas-tcg/player/';
const PLAYER_API_PATHS = ['/api/thomas-tcg/player-state.json', '/api/thomas-tcg/select.json'];
/** Pages sans donnée de tournoi, lisibles par tous (les joueurs y accèdent depuis leur page). */
const PUBLIC_PAGES = ['/thomas-tcg/regles'];

function isPlayerRoute(pathname: string): boolean {
  return (
    pathname.startsWith(PLAYER_PAGE_PREFIX) || PLAYER_API_PATHS.includes(pathname) || PUBLIC_PAGES.includes(pathname)
  );
}

/** Vrai pour `prefix` lui-même et tout ce qui est en dessous, mais pas `/thomas-tcgX`. */
function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  const isPage = isUnder(pathname, PAGE_PREFIX);
  // L'API doit être protégée au même titre que les pages : sans ça, n'importe
  // qui pourrait appeler `reset.json` ou `setup.json` et effacer un tournoi.
  const isApi = isUnder(pathname, API_PREFIX);

  if (!isPage && !isApi) {
    return next();
  }

  // La page de saisie du code reste accessible (elle traite aussi son POST),
  // ainsi que les routes joueur, autorisées par leur identifiant.
  if (pathname === GATE_PATH || isPlayerRoute(pathname)) {
    return next();
  }

  const expected = import.meta.env.THOMAS_TCG_CODE;
  if (!expected) {
    // Pas de code configuré : on laisse passer en dev local uniquement. En
    // prod, une variable oubliée ou mal nommée rendrait le jeu public, reset
    // compris : on refuse plutôt que d'ouvrir.
    if (import.meta.env.DEV) return next();
    return new Response('Accès non configuré (THOMAS_TCG_CODE manquant).', { status: 503 });
  }

  const cookie = context.cookies.get(COOKIE_NAME)?.value;
  if (cookie === expected) {
    return next();
  }

  // Une API appelée en `fetch` ne doit pas être redirigée vers une page HTML :
  // le client recevrait du HTML et `res.json()` échouerait. On répond 401.
  if (isApi) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const redirectTo = `${GATE_PATH}?next=${encodeURIComponent(pathname)}`;
  return context.redirect(redirectTo);
});

export { COOKIE_NAME };
