// Shared type definitions for the chatroom

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
  textColor?: string; // Optional color override (e.g., green for wins, red for losses)
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

export interface Room {
  id: string;
  players: Map<string, PlayerWithChat>;
  orbs: Orb[];
  shrines: Shrine[];
  treasureChests: TreasureChest[];
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
  idleRewardRate?: number; // For idle collector items: orbs per second while idle
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
  treasure_chest_interact: (data: { chestId: string; firebaseOrbs?: number }) => void;
  treasure_chest_relocate: (data: { chestId: string }) => void;
  sell_gold_coins: (data?: { coinCount?: number; orbsReceived?: number }) => void;
  idle_reward_confirmed: (data: { newOrbs: number }) => void;
  join_blackjack_table: (data: { tableId: string }) => void;
  leave_blackjack_table: (data: { tableId: string }) => void;
  place_blackjack_bet: (data: { tableId: string; amount: number }) => void;
  blackjack_hit: (data: { tableId: string; handIndex?: number }) => void;
  blackjack_stand: (data: { tableId: string; handIndex?: number }) => void;
  blackjack_double_down: (data: { tableId: string; handIndex?: number }) => void;
  blackjack_split: (data: { tableId: string; handIndex?: number }) => void;
  join_slot_machine: (data: { slotMachineId: string }) => void;
  leave_slot_machine: (data: { slotMachineId: string }) => void;
  spin_slot_machine: (data: { slotMachineId: string; betAmount: number }) => void;
  trade_request: (data: { otherPlayerId: string }) => void;
  trade_modify: (data: { items: Array<{ itemId: string; quantity: number }>; orbs: number }) => void;
  trade_accept: () => void;
  trade_decline: () => void;
  trade_cancel: () => void;
  kick_player: (data: { targetPlayerId: string }) => void;
  ping: (data: { timestamp: number }) => void;
}

// Socket Events - Server to Client
export interface ServerToClientEvents {
  room_list: (rooms: RoomInfo[]) => void;
  room_state: (data: {
    roomId: string;
    players: PlayerWithChat[];
    orbs: Orb[];
    shrines: Shrine[];
    treasureChests?: TreasureChest[];
    treeStates?: TreeState[];
    yourPlayerId?: string;
    mapType?: MapType;
  }) => void;
  player_joined: (player: PlayerWithChat) => void;
  player_moved: (data: { playerId: string; x: number; y: number; direction: Direction }) => void;
  player_ping_update: (data: { playerId: string; ping: number }) => void;
  player_left: (data: { playerId: string }) => void;
  chat_message: (data: { playerId: string; text: string; createdAt: number; textColor?: string }) => void;
  orb_spawned: (orb: Orb) => void;
  orb_collected: (data: { orbId: string; playerId: string; newBalance: number; orbValue?: number }) => void;
  fountain_next_spawn: (data: { nextSpawnTime: number }) => void;
  player_orbs_updated: (data: { playerId: string; orbs: number; rewardAmount?: number; rewardType?: string }) => void;
  idle_reward: (data: { rewardAmount: number; maxIdleRewardRate: number }) => void;
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
  treasure_chest_opened: (data: { 
    chestId: string; 
    chest: TreasureChest; 
    message: string; 
    coinsFound?: number;
    openedBy?: string; // Player ID who opened the chest
  }) => void;
  treasure_chest_relocated: (data: { 
    chestId: string; 
    chest: TreasureChest; 
    oldX: number; 
    oldY: number; 
    newX: number; 
    newY: number;
  }) => void;
  treasure_chest_interaction_error: (data: { chestId: string; message: string }) => void;
  gold_coins_sold: (data: { playerId: string; coinCount: number; orbsReceived: number; newBalance: number }) => void;
  portal_used: (data: { playerId: string; playerName: string; portalType: 'casino' | 'lounge' | 'return' }) => void;
  blackjack_joined: (data: { tableId: string; seat: number }) => void;
  blackjack_state_update: (data: { tableId: string; state: BlackjackTableState }) => void;
  blackjack_error: (data: { tableId: string; message: string }) => void;
  slot_machine_joined: (data: { slotMachineId: string; seat: number }) => void;
  slot_machine_left: (data: { slotMachineId: string }) => void;
  slot_machine_result: (data: { slotMachineId: string; slotMachineName: string; symbols: string[]; payout: number; newBalance: number }) => void;
  slot_machine_error: (data: { slotMachineId: string; message: string }) => void;
  trade_requested: (data: { fromPlayerId: string; fromPlayerName: string }) => void;
  trade_opened: (data: { otherPlayerId: string; otherPlayerName: string }) => void;
  trade_modified: (data: { items: Array<{ itemId: string; quantity: number }>; orbs: number; accepted: boolean }) => void;
  trade_accepted: (data: { playerId: string }) => void;
  trade_completed: (data: { items: Array<{ itemId: string; quantity: number }>; orbs: number; newBalance?: number }) => void;
  trade_declined: () => void;
  trade_cancelled: () => void;
  trade_error: (data: { message: string }) => void;
  player_kicked: (data: { message: string }) => void;
  error: (data: { message: string }) => void;
  pong: (data: { timestamp: number }) => void;
}

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
  seat: number; // 0-3 (4 seats per table)
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

export interface BlackjackTable {
  id: string;
  dealerId: string;
  state: BlackjackTableState;
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

export const BLACKJACK_CONSTANTS = {
  MIN_BET: 10000,
  MAX_BET: 1000000,
  MAX_PLAYERS_PER_TABLE: 4,
  BLACKJACK_PAYOUT: 1.5, // 3:2 payout
  DEALER_STAND_VALUE: 17,
};
