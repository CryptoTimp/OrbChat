// Client-side type definitions (mirrors server types)

export type Direction = 'up' | 'down' | 'left' | 'right';
export type MapType = 'market' | 'forest' | 'cafe' | 'casino' | 'millionaires_lounge';

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

export interface TreasureChest {
  id: string;
  x: number;
  y: number;
  cooldownEndTime?: number;
}

export interface TreeState {
  treeId: string;
  isCut: boolean;
  cutBy: string | null; // playerId currently cutting, or null
  cuttingStartTime?: number; // timestamp when cutting started (for progress bar sync)
  respawnAt: number; // timestamp when tree should respawn
}

export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'godlike';

export interface ShopItem {
  id: string;
  name: string;
  price: number;
  spriteLayer: 'hat' | 'shirt' | 'legs' | 'accessory' | 'cape' | 'boost' | 'wings' | 'pet';
  spritePath: string;
  rarity: ItemRarity;
  speedMultiplier?: number; // For speed boost items: 1.0 = normal, 1.5 = 50% faster
  orbMultiplier?: number; // For orb boost items: 1.0 = normal, 2.5 = 150% more orbs
  idleRewardRate?: number; // For idle collector items: orbs per second while idle
  trailColor?: string; // Particle trail color for boosts
}

// Rarity color mapping
export const RARITY_COLORS: Record<ItemRarity, { bg: string; border: string; text: string; glow: string }> = {
  common: { bg: 'bg-gray-600', border: 'border-gray-500', text: 'text-gray-300', glow: 'rgba(156, 163, 175, 0.5)' },
  uncommon: { bg: 'bg-green-600', border: 'border-green-500', text: 'text-green-300', glow: 'rgba(34, 197, 94, 0.5)' },
  rare: { bg: 'bg-blue-600', border: 'border-blue-500', text: 'text-blue-300', glow: 'rgba(59, 130, 246, 0.5)' },
  epic: { bg: 'bg-purple-600', border: 'border-purple-500', text: 'text-purple-300', glow: 'rgba(168, 85, 247, 0.5)' },
  legendary: { bg: 'bg-amber-500', border: 'border-amber-400', text: 'text-amber-300', glow: 'rgba(245, 158, 11, 0.7)' },
  godlike: { bg: 'bg-red-600', border: 'border-red-500', text: 'text-red-300', glow: 'rgba(239, 68, 68, 0.9)' },
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
  MIN_ZOOM: 0.7,  // Reduced from 0.5 to limit zoom out
  MAX_ZOOM: 2.0,
  DEFAULT_ZOOM: 1.0,
};

// World size (total map in pixels)
export const WORLD_WIDTH = GAME_CONSTANTS.TILE_SIZE * GAME_CONSTANTS.MAP_WIDTH * GAME_CONSTANTS.SCALE;
export const WORLD_HEIGHT = GAME_CONSTANTS.TILE_SIZE * GAME_CONSTANTS.MAP_HEIGHT * GAME_CONSTANTS.SCALE;

// Viewport/canvas size (what player sees)
export const CANVAS_WIDTH = GAME_CONSTANTS.TILE_SIZE * GAME_CONSTANTS.VIEWPORT_WIDTH * GAME_CONSTANTS.SCALE;
export const CANVAS_HEIGHT = GAME_CONSTANTS.TILE_SIZE * GAME_CONSTANTS.VIEWPORT_HEIGHT * GAME_CONSTANTS.SCALE;

// Blackjack types
export type CardSuit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type CardRank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface BlackjackCard {
  suit: CardSuit;
  rank: CardRank;
  value: number; // Numeric value for calculation (A can be 1 or 11)
}

export type BlackjackGameState = 'waiting' | 'betting' | 'dealing' | 'playing' | 'dealer_turn' | 'finished';

export interface BlackjackHand {
  cards: BlackjackCard[];
  bet: number;
  isSplit: boolean;
  isDoubleDown: boolean;
  isStand: boolean;
  isBust: boolean;
  isBlackjack: boolean;
}

export interface BlackjackPlayer {
  playerId: string;
  playerName: string;
  seat: number; // 0-6 (7 seats per table)
  hands: BlackjackHand[]; // Can have multiple hands if split
  currentHandIndex: number; // Which hand is currently being played
  hasPlacedBet: boolean;
  isActive: boolean;
}

export interface BlackjackTableState {
  tableId: string;
  dealerId: string;
  dealerHand: BlackjackCard[];
  dealerHasBlackjack: boolean;
  players: BlackjackPlayer[];
  deck: BlackjackCard[];
  gameState: BlackjackGameState;
  currentPlayerIndex: number | null; // Index in players array
  roundNumber: number;
}
