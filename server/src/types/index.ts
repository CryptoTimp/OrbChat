// Shared type definitions for the chatroom

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

export interface TreeState {
  treeId: string;
  isCut: boolean;
  cutBy: string | null; // playerId currently cutting, or null
  cuttingStartTime?: number; // timestamp when cutting started (for progress bar sync)
  respawnAt: number; // timestamp when tree should respawn
}

export interface Room {
  id: string;
  players: Map<string, PlayerWithChat>;
  orbs: Orb[];
  shrines: Shrine[];
  treeStates: Map<string, TreeState>;
  mapType: MapType;
  isPrivate?: boolean;
  passwordHash?: string;
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
  trailColor?: string; // Particle trail color for boosts
}

export interface InventoryItem {
  playerId: string;
  itemId: string;
  equipped: boolean;
}

// Room listing info
export interface RoomInfo {
  id: string;
  mapType: MapType;
  playerCount: number;
  players: string[];
  isGlobal?: boolean; // true for server-hosted global rooms
  isPrivate?: boolean; // true for password-protected rooms
}

// Socket Events - Client to Server
export interface ClientToServerEvents {
  join_room: (data: { 
    roomId: string; 
    playerName: string;
    orbs?: number;  // From Firebase
    equippedItems?: string[];  // From Firebase
    mapType?: MapType;  // Selected map (only used when creating)
    password?: string;  // Password for private rooms
  }) => void;
  leave_room: () => void;
  list_rooms: () => void;
  move: (data: { x: number; y: number; direction: Direction }) => void;
  chat_message: (data: { text: string }) => void;
  collect_orb: (data: { orbId: string }) => void;
  purchase_item: (data: { 
    itemId: string; 
    newOrbs?: number;  // Client sends updated orbs after Firebase update
    newInventory?: string[];  // Client sends updated inventory
  }) => void;
  purchase_lootbox: (data: { 
    lootBoxId: string;
    itemId: string; 
    newOrbs?: number;  // Client sends updated orbs after Firebase update
    newInventory?: string[];  // Client sends updated inventory
    alreadyOwned?: boolean;  // Whether the item was already owned (refund case)
  }) => void;
  equip_item: (data: { 
    itemId: string; 
    equipped: boolean;
    equippedItems?: string[];  // Client sends updated equipped items for sprite broadcast
  }) => void;
  shrine_interact: (data: { shrineId: string; firebaseOrbs?: number }) => void;
  start_cutting_tree: (data: { treeId: string }) => void;
  complete_cutting_tree: (data: { treeId: string }) => void;
  cancel_cutting_tree: (data: { treeId: string }) => void;
  sell_logs: (data?: { logCount?: number; orbsReceived?: number }) => void;
  sell_item: (data: { 
    itemId: string; 
    newOrbs?: number;  // Client sends updated orbs after Firebase update
    newInventory?: string[];  // Client sends updated inventory
  }) => void;
}

// Socket Events - Server to Client
export interface ServerToClientEvents {
  room_list: (rooms: RoomInfo[]) => void;
  room_state: (data: {
    roomId: string;
    players: PlayerWithChat[];
    orbs: Orb[];
    shrines: Shrine[];
    treeStates?: TreeState[];
    yourPlayerId?: string;
    mapType?: MapType;
  }) => void;
  player_joined: (player: PlayerWithChat) => void;
  player_moved: (data: { playerId: string; x: number; y: number; direction: Direction }) => void;
  player_left: (data: { playerId: string }) => void;
  chat_message: (data: { playerId: string; text: string; createdAt: number }) => void;
  orb_spawned: (orb: Orb) => void;
  orb_collected: (data: { orbId: string; playerId: string; newBalance: number; orbValue?: number }) => void;
  fountain_next_spawn: (data: { nextSpawnTime: number }) => void;
  player_orbs_updated: (data: { playerId: string; orbs: number }) => void;
  inventory_updated: (data: { items: InventoryItem[]; orbs: number }) => void;
  shop_items: (items: ShopItem[]) => void;
  shrine_interacted: (data: { 
    shrineId: string; 
    shrine: Shrine; 
    message: string; 
    blessed: boolean;
    orbsSpawned?: number;
  }) => void;
  tree_state_updated: (data: { treeStates: TreeState[] }) => void;
  tree_cut_complete: (data: { treeId: string; logCount: number }) => void;
  logs_sold: (data: { playerId: string; logCount: number; orbsReceived: number; newBalance: number }) => void;
  shrine_interaction_error: (data: { shrineId: string; message: string }) => void;
  error: (data: { message: string }) => void;
}

// Game constants
export const GAME_CONSTANTS = {
  TILE_SIZE: 16,
  SCALE: 3,
  MAP_WIDTH: 200,  // tiles - large scrolling map (increased significantly)
  MAP_HEIGHT: 150, // tiles - large scrolling map (increased significantly)
  PLAYER_WIDTH: 16,
  PLAYER_HEIGHT: 24,
  ORB_SIZE: 8,
  ORB_SPAWN_INTERVAL: 5000, // ms (spawn more often for bigger map)
  MAX_ORBS_PER_ROOM: 150,    // more orbs for bigger map (increased for 200x150 map)
  ORB_VALUE: 10,
  CHAT_BUBBLE_DURATION: 5000, // ms
  MOVEMENT_SPEED: 3, // pixels per frame
  COLLECTION_RADIUS: 24, // pixels
};
