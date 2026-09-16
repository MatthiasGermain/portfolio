import type { TournamentState } from './types';

/* ============================================================================
 *  Persistance du tournoi.
 * ----------------------------------------------------------------------------
 *  En prod (Vercel), chaque appel d'API est une fonction serverless sans
 *  mémoire partagée : l'état vit dans Vercel KV (Redis). En dev local
 *  (`astro dev`), le process est long-lived et une mémoire de module suffit.
 *
 *  L'état est volontairement réparti en deux :
 *
 *  - `STATE_KEY` : le tournoi (joueurs, tableau, cibles, révélations). Écrit
 *    uniquement par l'écran host et la configuration — un seul auteur.
 *  - `PLAYER_DATA_KEY` : un hash avec un champ par joueur pour ce que le
 *    joueur écrit lui-même — sa sélection dans un match et ses cartes
 *    consommées.
 *
 *  Pourquoi : les deux joueurs d'un match valident leurs cartes quasiment en
 *  même temps. Si chacun relisait puis réécrivait l'objet entier, le second
 *  écraserait la sélection du premier (écriture perdue). Des champs distincts
 *  d'un même hash s'écrivent sans pouvoir se marcher dessus.
 *
 *  `getState()` réassemble les deux : le reste du code manipule toujours un
 *  `TournamentState` complet et n'a pas à connaître ce découpage. En
 *  contrepartie, `saveState()` ignore les sélections et les cartes
 *  consommées : pour les écrire, passer par `saveSelection()`.
 * ========================================================================== */

const STATE_KEY = 'thomas-tcg:state';
const PLAYER_DATA_KEY = 'thomas-tcg:player-data';

type PlayerData = Record<string, string[]>;

const selectionField = (matchId: string, playerId: string) => `sel:${matchId}:${playerId}`;
const usedField = (playerId: string) => `used:${playerId}`;

interface Backend {
  /** Tournoi et données joueurs, lus ensemble. */
  read(): Promise<{ state: TournamentState | null; playerData: PlayerData }>;
  writeState(state: TournamentState): Promise<void>;
  writePlayerFields(fields: PlayerData): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Stockage en mémoire pour le dev. Copie à chaque lecture et écriture, comme
 * le ferait Redis : sans ça, deux requêtes partageraient le même objet et un
 * bug d'écriture perdue resterait invisible en local.
 */
function memoryBackend(): Backend {
  let state: TournamentState | null = null;
  let playerData: PlayerData = {};
  return {
    async read() {
      return { state: state && structuredClone(state), playerData: structuredClone(playerData) };
    },
    async writeState(next) {
      state = structuredClone(next);
    },
    async writePlayerFields(fields) {
      playerData = { ...playerData, ...structuredClone(fields) };
    },
    async clear() {
      state = null;
      playerData = {};
    },
  };
}

function kvBackend(): Backend {
  const load = async () => (await import('@vercel/kv')).kv;
  return {
    async read() {
      const kv = await load();
      // Un seul aller-retour HTTP pour les deux clés.
      const [state, playerData] = await kv
        .pipeline()
        .get<TournamentState>(STATE_KEY)
        .hgetall<PlayerData>(PLAYER_DATA_KEY)
        .exec<[TournamentState | null, PlayerData | null]>();
      return { state: state ?? null, playerData: playerData ?? {} };
    },
    async writeState(next) {
      const kv = await load();
      await kv.set(STATE_KEY, next);
    },
    async writePlayerFields(fields) {
      const kv = await load();
      await kv.hset(PLAYER_DATA_KEY, fields);
    },
    async clear() {
      const kv = await load();
      await kv.del(STATE_KEY, PLAYER_DATA_KEY);
    },
  };
}

function hasKv(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

// La mémoire de dev doit survivre d'une requête à l'autre : instance unique.
const memory = memoryBackend();
const backend = (): Backend => (hasKv() ? kvBackend() : memory);

/** Retire ce qui appartient aux joueurs : ce n'est jamais écrit avec le tournoi. */
function withoutPlayerData(state: TournamentState): TournamentState {
  const copy = structuredClone(state);
  for (const player of Object.values(copy.players)) player.used = [];
  for (const round of copy.rounds) {
    for (const match of round) {
      match.selectionA = null;
      match.selectionB = null;
    }
  }
  return copy;
}

/** Replace les sélections et cartes consommées de chaque joueur dans le tournoi. */
function withPlayerData(state: TournamentState, data: PlayerData): TournamentState {
  for (const player of Object.values(state.players)) {
    player.used = data[usedField(player.id)] ?? [];
  }
  for (const round of state.rounds) {
    for (const match of round) {
      match.selectionA = match.a ? (data[selectionField(match.id, match.a)] ?? null) : null;
      match.selectionB = match.b ? (data[selectionField(match.id, match.b)] ?? null) : null;
    }
  }
  return state;
}

export async function getState(): Promise<TournamentState | null> {
  const { state, playerData } = await backend().read();
  return state ? withPlayerData(state, playerData) : null;
}

/**
 * Enregistre le tournoi. Les sélections et cartes consommées sont ignorées :
 * elles s'écrivent via `saveSelection()`, joueur par joueur.
 */
export async function saveState(state: TournamentState): Promise<void> {
  await backend().writeState(withoutPlayerData(state));
}

/**
 * Enregistre la sélection d'un joueur pour un match et ses cartes consommées.
 * Les deux champs appartiennent au seul joueur concerné : l'adversaire qui
 * valide au même instant écrit d'autres champs et ne peut pas l'écraser.
 */
export async function saveSelection(
  matchId: string,
  playerId: string,
  selection: string[],
  used: string[],
): Promise<void> {
  await backend().writePlayerFields({
    [selectionField(matchId, playerId)]: selection,
    [usedField(playerId)]: used,
  });
}

export async function clearState(): Promise<void> {
  await backend().clear();
}
