import { v4 as uuidv4 } from 'uuid';
import { PlayerWithChat, Direction, GAME_CONSTANTS } from './types';
import * as db from './db';

// Create player from Firebase data (new method)
export function createPlayerFromFirebase(
  playerId: string,
  name: string,
  roomId: string,
  orbs: number,
  equippedItems: string[],
  mapType?: string,
  returningFromCasino?: boolean,
  returningFromLounge?: boolean
): PlayerWithChat {
  let spawnX: number;
  let spawnY: number;
  
  // World dimensions in unscaled pixels (player coordinates are unscaled)
  const WORLD_WIDTH_UNSCALED = GAME_CONSTANTS.TILE_SIZE * GAME_CONSTANTS.MAP_WIDTH;
  const WORLD_HEIGHT_UNSCALED = GAME_CONSTANTS.TILE_SIZE * GAME_CONSTANTS.MAP_HEIGHT;
  const centerX = WORLD_WIDTH_UNSCALED / 2;
  const centerY = WORLD_HEIGHT_UNSCALED / 2;
  const SCALE = GAME_CONSTANTS.SCALE;
  
  // For forest map, spawn on central podium (avoiding fountain tower)
  // OR at casino portal if returning from casino
  if (mapType === 'forest') {
    // If returning from casino, spawn at casino portal
    if (returningFromCasino) {
      // Casino portal position in forest map:
      // Portal is at angle -π/8 from center, at npcRadius distance
      // npcRadius = plazaRadius * 0.7 = 160 * SCALE * 0.7 = 112 * SCALE (scaled pixels)
      // Convert to unscaled: 112 * SCALE / SCALE = 112 (unscaled pixels)
      const plazaRadius = 160 * SCALE; // 480 unscaled pixels
      const npcRadius = plazaRadius * 0.7; // 336 unscaled pixels
      const portalAngle = -Math.PI / 8;
      const portalX = centerX + Math.cos(portalAngle) * npcRadius;
      const portalY = centerY + Math.sin(portalAngle) * npcRadius;
      const portalRadius = 30 * SCALE; // 90 unscaled pixels
      
      // Spawn near the portal (slightly offset to avoid being exactly on it)
      // Add some randomness around the portal
      const spawnRadius = portalRadius + 20 + Math.random() * 30; // 20-50 pixels from portal edge
      const spawnAngle = Math.random() * Math.PI * 2;
      
      spawnX = portalX + Math.cos(spawnAngle) * spawnRadius - (GAME_CONSTANTS.PLAYER_WIDTH / 2);
      spawnY = portalY + Math.sin(spawnAngle) * spawnRadius - (GAME_CONSTANTS.PLAYER_HEIGHT / 2);
      
      // Clamp to map bounds
      const maxX = WORLD_WIDTH_UNSCALED - GAME_CONSTANTS.PLAYER_WIDTH;
      const maxY = WORLD_HEIGHT_UNSCALED - GAME_CONSTANTS.PLAYER_HEIGHT;
      spawnX = Math.max(0, Math.min(spawnX, maxX));
      spawnY = Math.max(0, Math.min(spawnY, maxY));
    } else {
      // Podium radius on client: 160 * SCALE (scaled pixels) = 160 * SCALE unscaled pixels
      // Tower radius on client: 60 * SCALE (scaled pixels) = 60 * SCALE unscaled pixels
      // Since player coordinates are in unscaled pixels, we use the unscaled values
      const towerRadius = 60 * SCALE; // 180 unscaled pixels
      const podiumRadius = 160 * SCALE; // 480 unscaled pixels
      
      // Spawn between tower and podium edge (with some margin)
      const minRadius = towerRadius + 40; // Avoid tower by at least 40 unscaled pixels
      const maxRadius = podiumRadius - 40; // Stay away from podium edge by 40 unscaled pixels
      
      // Random angle and distance
      const angle = Math.random() * Math.PI * 2;
      const radius = minRadius + Math.random() * (maxRadius - minRadius);
      
      // Calculate spawn position (player coordinates are top-left corner of sprite)
      // Center the player sprite on the spawn point
      spawnX = centerX + Math.cos(angle) * radius - (GAME_CONSTANTS.PLAYER_WIDTH / 2);
      spawnY = centerY + Math.sin(angle) * radius - (GAME_CONSTANTS.PLAYER_HEIGHT / 2);
      
      // Clamp to map bounds (in unscaled pixels)
      const maxX = WORLD_WIDTH_UNSCALED - GAME_CONSTANTS.PLAYER_WIDTH;
      const maxY = WORLD_HEIGHT_UNSCALED - GAME_CONSTANTS.PLAYER_HEIGHT;
      spawnX = Math.max(0, Math.min(spawnX, maxX));
      spawnY = Math.max(0, Math.min(spawnY, maxY));
    }
  } else if (mapType === 'casino') {
    // For casino map, spawn around the return portal (which is at the center of the map)
    // Portal radius on client: 30 * SCALE (scaled pixels) = 30 * SCALE unscaled pixels
    const portalRadius = 30 * SCALE; // 90 unscaled pixels
    
    // Return portal is at the center of the map (centerX, centerY)
    const portalX = centerX;
    const portalY = centerY;
    
    // Spawn near the portal (slightly offset to avoid being exactly on it)
    // Add some randomness around the portal
    const spawnRadius = portalRadius + 20 + Math.random() * 40; // 20-60 pixels from portal edge
    const spawnAngle = Math.random() * Math.PI * 2;
    
    // Calculate spawn position (player coordinates are top-left corner of sprite)
    // Center the player sprite on the spawn point
    spawnX = portalX + Math.cos(spawnAngle) * spawnRadius - (GAME_CONSTANTS.PLAYER_WIDTH / 2);
    spawnY = portalY + Math.sin(spawnAngle) * spawnRadius - (GAME_CONSTANTS.PLAYER_HEIGHT / 2);
    
    // Clamp to map bounds (in unscaled pixels)
    const maxX = WORLD_WIDTH_UNSCALED - GAME_CONSTANTS.PLAYER_WIDTH;
    const maxY = WORLD_HEIGHT_UNSCALED - GAME_CONSTANTS.PLAYER_HEIGHT;
    spawnX = Math.max(0, Math.min(spawnX, maxX));
    spawnY = Math.max(0, Math.min(spawnY, maxY));
  } else if (mapType === 'millionaires_lounge') {
    // For millionaire's lounge map, spawn around the return portal (which is at the center of the map)
    // Portal radius on client: 30 * SCALE (scaled pixels) = 30 * SCALE unscaled pixels
    const portalRadius = 30 * SCALE; // 90 unscaled pixels
    
    // Return portal is at the center of the map (centerX, centerY)
    const portalX = centerX;
    const portalY = centerY;
    
    // Spawn near the portal (slightly offset to avoid being exactly on it)
    // Add some randomness around the portal
    const spawnRadius = portalRadius + 20 + Math.random() * 40; // 20-60 pixels from portal edge
    const spawnAngle = Math.random() * Math.PI * 2;
    
    // Calculate spawn position (player coordinates are top-left corner of sprite)
    // Center the player sprite on the spawn point
    spawnX = portalX + Math.cos(spawnAngle) * spawnRadius - (GAME_CONSTANTS.PLAYER_WIDTH / 2);
    spawnY = portalY + Math.sin(spawnAngle) * spawnRadius - (GAME_CONSTANTS.PLAYER_HEIGHT / 2);
    
    // Clamp to map bounds (in unscaled pixels)
    const maxX = WORLD_WIDTH_UNSCALED - GAME_CONSTANTS.PLAYER_WIDTH;
    const maxY = WORLD_HEIGHT_UNSCALED - GAME_CONSTANTS.PLAYER_HEIGHT;
    spawnX = Math.max(0, Math.min(spawnX, maxX));
    spawnY = Math.max(0, Math.min(spawnY, maxY));
  } else {
    // For other maps, use random spawn
    const maxX = GAME_CONSTANTS.TILE_SIZE * GAME_CONSTANTS.MAP_WIDTH - GAME_CONSTANTS.PLAYER_WIDTH;
    const maxY = GAME_CONSTANTS.TILE_SIZE * GAME_CONSTANTS.MAP_HEIGHT - GAME_CONSTANTS.PLAYER_HEIGHT;
    spawnX = Math.floor(Math.random() * maxX);
    spawnY = Math.floor(Math.random() * maxY);
  }

  const player: PlayerWithChat = {
    id: playerId,
    name,
    x: spawnX,
    y: spawnY,
    direction: 'down' as Direction,
    sprite: {
      body: 'default',
      outfit: equippedItems,
    },
    orbs,
    roomId,
  };

  return player;
}

// Create a new player or load existing one (legacy - for local db)
export function createOrLoadPlayer(
  playerId: string | undefined,
  name: string,
  roomId: string
): PlayerWithChat {
  // Generate ID if not provided
  const id = playerId || uuidv4();
  
  // Try to load existing player from database
  let dbPlayer = db.getPlayer(id);
  
  if (!dbPlayer) {
    // Create new player in database
    dbPlayer = db.createPlayer(id, name);
  } else {
    // Update last seen
    db.updatePlayerLastSeen(id);
  }

  // Parse outfit from JSON
  let outfit: string[] = [];
  try {
    outfit = JSON.parse(dbPlayer?.sprite_outfit || '[]');
  } catch {
    outfit = [];
  }

  // Get equipped items
  const inventory = db.getPlayerInventory(id);
  const equippedItems = inventory
    .filter(item => item.equipped)
    .map(item => item.item_id);

  // Create in-memory player state with random spawn position
  const maxX = GAME_CONSTANTS.TILE_SIZE * GAME_CONSTANTS.MAP_WIDTH - GAME_CONSTANTS.PLAYER_WIDTH;
  const maxY = GAME_CONSTANTS.TILE_SIZE * GAME_CONSTANTS.MAP_HEIGHT - GAME_CONSTANTS.PLAYER_HEIGHT;

  const player: PlayerWithChat = {
    id,
    name: dbPlayer?.name || name,
    x: Math.floor(Math.random() * maxX),
    y: Math.floor(Math.random() * maxY),
    direction: 'down' as Direction,
    sprite: {
      body: dbPlayer?.sprite_body || 'default',
      outfit: equippedItems.length > 0 ? equippedItems : outfit,
    },
    orbs: dbPlayer?.orbs || 0,
    roomId,
  };

  return player;
}

export function addOrbs(playerId: string, amount: number): number {
  const dbPlayer = db.getPlayer(playerId);
  if (!dbPlayer) return 0;

  const newBalance = dbPlayer.orbs + amount;
  db.updatePlayerOrbs(playerId, newBalance);
  return newBalance;
}

export function removeOrbs(playerId: string, amount: number): { success: boolean; newBalance: number } {
  const dbPlayer = db.getPlayer(playerId);
  if (!dbPlayer) return { success: false, newBalance: 0 };

  if (dbPlayer.orbs < amount) {
    return { success: false, newBalance: dbPlayer.orbs };
  }

  const newBalance = dbPlayer.orbs - amount;
  db.updatePlayerOrbs(playerId, newBalance);
  return { success: true, newBalance };
}

export function getPlayerOrbs(playerId: string): number {
  const dbPlayer = db.getPlayer(playerId);
  return dbPlayer?.orbs || 0;
}

export function purchaseItem(playerId: string, itemId: string): { success: boolean; error?: string; newBalance?: number } {
  // Check if player exists
  const dbPlayer = db.getPlayer(playerId);
  if (!dbPlayer) {
    return { success: false, error: 'Player not found' };
  }

  // Check if item exists
  const item = db.getShopItem(itemId);
  if (!item) {
    return { success: false, error: 'Item not found' };
  }

  // Check if player already owns item
  if (db.hasItem(playerId, itemId)) {
    return { success: false, error: 'You already own this item' };
  }

  // Check if player has enough orbs
  if (dbPlayer.orbs < item.price) {
    return { success: false, error: 'Not enough orbs' };
  }

  // Deduct orbs and add to inventory
  const result = removeOrbs(playerId, item.price);
  if (!result.success) {
    return { success: false, error: 'Failed to deduct orbs' };
  }

  db.addToInventory(playerId, itemId);

  return { success: true, newBalance: result.newBalance };
}

export function equipItem(playerId: string, itemId: string, equipped: boolean): boolean {
  // Check if player owns the item
  if (!db.hasItem(playerId, itemId)) {
    return false;
  }

  db.setItemEquipped(playerId, itemId, equipped);
  return true;
}

export function getPlayerInventory(playerId: string): db.InventoryData[] {
  return db.getPlayerInventory(playerId);
}

export async function addToInventory(playerId: string, itemId: string): Promise<void> {
  db.addToInventory(playerId, itemId);
}

export async function removeFromInventory(playerId: string, itemId: string): Promise<void> {
  db.removeFromInventory(playerId, itemId);
}

export async function updatePlayerOrbs(playerId: string, orbs: number): Promise<void> {
  db.updatePlayerOrbs(playerId, orbs);
}

export function getShopItems(): db.ShopItemData[] {
  return db.getShopItems();
}
