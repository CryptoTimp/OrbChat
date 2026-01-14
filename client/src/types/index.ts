// Client-side type definitions (mirrors server types)

export type Direction = 'up' | 'down' | 'left' | 'right';
export type MapType = 'market' | 'forest' | 'cafe';

export interface PlayerSprite {
  body: string;
  outfit: string[];
}

export interface Player {
  id: string;
  name: string;
  x: number;
  y: number;
  direction: Direction;
  sprite: PlayerSprite;
  orbs: number;
  roomId: string;
}

export interface ChatBubble {
  text: string;
  createdAt: number;
}

export interface PlayerWithChat extends Player {
  chatBubble?: ChatBubble;
}

export type OrbType = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'normal' | 'gold' | 'shrine';

export interface Orb {
  id: string;
  x: number;
  y: number;
  value: number;
  orbType: OrbType;
  fromShrine?: { shrineId: string; shrineX: number; shrineY: number }; // Track if orb came from shrine
}

export interface Shrine {
  id: string;
  x: number;
  y: number;
  lastUsedBy?: string; // playerId
  lastUsedTime?: number;
  cooldownEndTime?: number;
}

export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface ShopItem {
  id: string;
  name: string;
  price: number;
  spriteLayer: 'hat' | 'shirt' | 'legs' | 'accessory' | 'cape' | 'boost' | 'wings' | 'pet';
  spritePath: string;
  rarity: ItemRarity;
  speedMultiplier?: number; // For speed boost items: 1.0 = normal, 1.5 = 50% faster
  orbMultiplier?: number; // For orb boost items: 1.0 = normal, 2.5 = 150% more orbs
  trailColor?: string; // Particle trail color for boosts
}

// Rarity color mapping
export const RARITY_COLORS: Record<ItemRarity, { bg: string; border: string; text: string; glow: string }> = {
  common: { bg: 'bg-gray-600', border: 'border-gray-500', text: 'text-gray-300', glow: 'rgba(156, 163, 175, 0.5)' },
  uncommon: { bg: 'bg-green-600', border: 'border-green-500', text: 'text-green-300', glow: 'rgba(34, 197, 94, 0.5)' },
  rare: { bg: 'bg-blue-600', border: 'border-blue-500', text: 'text-blue-300', glow: 'rgba(59, 130, 246, 0.5)' },
  epic: { bg: 'bg-purple-600', border: 'border-purple-500', text: 'text-purple-300', glow: 'rgba(168, 85, 247, 0.5)' },
  legendary: { bg: 'bg-amber-500', border: 'border-amber-400', text: 'text-amber-300', glow: 'rgba(245, 158, 11, 0.7)' },
};

export interface RoomInfo {
  id: string;
  mapType: MapType;
  playerCount: number;
  players: string[];
  isGlobal?: boolean; // true for server-hosted global rooms
  isPrivate?: boolean; // true for password-protected rooms
}

export interface InventoryItem {
  playerId: string;
  itemId: string;
  equipped: boolean;
}

// Game constants
export const GAME_CONSTANTS = {
  TILE_SIZE: 16,
  SCALE: 3,
  MAP_WIDTH: 200,  // tiles - large scrolling map (increased significantly)
  MAP_HEIGHT: 150, // tiles - large scrolling map (increased significantly)
  VIEWPORT_WIDTH: 40,  // visible tiles horizontally
  VIEWPORT_HEIGHT: 25, // visible tiles vertically
  PLAYER_WIDTH: 16,
  PLAYER_HEIGHT: 24,
  ORB_SIZE: 8,
  ORB_SPAWN_INTERVAL: 5000, // ms (spawn more often for bigger map)
  MAX_ORBS_PER_ROOM: 60,    // more orbs for bigger map
  ORB_VALUE: 10,
  CHAT_BUBBLE_DURATION: 5000, // ms
  MOVEMENT_SPEED: 1.2, // pixels per frame (slightly faster for bigger map)
  COLLECTION_RADIUS: 24, // pixels
  MIN_ZOOM: 0.5,
  MAX_ZOOM: 2.0,
  DEFAULT_ZOOM: 1.0,
};

// World size (total map in pixels)
export const WORLD_WIDTH = GAME_CONSTANTS.TILE_SIZE * GAME_CONSTANTS.MAP_WIDTH * GAME_CONSTANTS.SCALE;
export const WORLD_HEIGHT = GAME_CONSTANTS.TILE_SIZE * GAME_CONSTANTS.MAP_HEIGHT * GAME_CONSTANTS.SCALE;

// Viewport/canvas size (what player sees)
export const CANVAS_WIDTH = GAME_CONSTANTS.TILE_SIZE * GAME_CONSTANTS.VIEWPORT_WIDTH * GAME_CONSTANTS.SCALE;
export const CANVAS_HEIGHT = GAME_CONSTANTS.TILE_SIZE * GAME_CONSTANTS.VIEWPORT_HEIGHT * GAME_CONSTANTS.SCALE;
