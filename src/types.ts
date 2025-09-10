export interface GameStartData {
  playerIndex: number;
  replay_id: string;
}

export interface GameUpdateData {
  cities_diff: number[];
  map_diff: number[];
  generals: number[];
}

export interface Move {
  from: number;
  to: number;
  priority?: string;
}

export const TILE_EMPTY = -1;
export const TILE_MOUNTAIN = -2;
export const TILE_FOG = -3;
export const TILE_FOG_OBSTACLE = -4;
