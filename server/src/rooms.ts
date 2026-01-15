import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import { Room, PlayerWithChat, Orb, GAME_CONSTANTS, MapType, OrbType, RoomInfo, Shrine, TreasureChest, TreeState } from './types';
import * as players from './players';

// Global room IDs that persist even when empty
export const GLOBAL_ROOM_IDS = ['eu-1', 'eu-2', 'eu-3'];

// In-memory room storage
const rooms: Map<string, Room> = new Map();

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function createRoom(roomId: string, mapType: MapType = 'cafe', isPrivate: boolean = false, passwordHash?: string): Room {
  const room: Room = {
    id: roomId,
    players: new Map(),
    orbs: [],
    shrines: mapType === 'forest' ? generateShrinesForRoom(roomId, mapType) : [],
    treasureChests: mapType === 'forest' ? generateTreasureChestsForRoom(roomId, mapType) : [],
    treeStates: new Map(),
    mapType,
    isPrivate,
    passwordHash,
  };
  rooms.set(roomId, room);
  return room;
}

export function getOrCreateRoom(roomId: string, mapType?: MapType, isPrivate: boolean = false, passwordHash?: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    // Create new room with specified map type and privacy settings
    room = createRoom(roomId, mapType || 'cafe', isPrivate, passwordHash);
  } else {
    // Room already exists - only update mapType if room is empty and new mapType provided
    if (mapType && room.players.size === 0) {
      room.mapType = mapType;
      // Regenerate shrines if switching to/from forest
      if (mapType === 'forest' && room.shrines.length === 0) {
        room.shrines = generateShrinesForRoom(roomId, mapType);
      } else if (mapType !== 'forest') {
        room.shrines = [];
      }
      // Regenerate treasure chests if switching to/from forest
      if (mapType === 'forest' && (!room.treasureChests || room.treasureChests.length === 0)) {
        room.treasureChests = generateTreasureChestsForRoom(roomId, mapType);
      } else if (mapType !== 'forest') {
        room.treasureChests = [];
      }
    }
    // Ensure existing forest rooms have shrines (in case they were created before shrine code was added)
    if (room.mapType === 'forest' && (!room.shrines || room.shrines.length === 0)) {
      room.shrines = generateShrinesForRoom(roomId, room.mapType);
      console.log(`Generated ${room.shrines.length} shrines for existing forest room: ${roomId}`);
    }
    // Ensure existing forest rooms have treasure chests
    if (room.mapType === 'forest' && (!room.treasureChests || room.treasureChests.length === 0)) {
      room.treasureChests = generateTreasureChestsForRoom(roomId, room.mapType);
      console.log(`Generated ${room.treasureChests.length} treasure chests for existing forest room: ${roomId}`);
    }
    // Never change privacy settings of existing room - they are set once on creation
  }
  return room;
}

// Hash a password for storage
export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
}

// Validate a password against a room's password hash
export async function validateRoomPassword(roomId: string, password: string): Promise<boolean> {
  const room = rooms.get(roomId);
  if (!room || !room.isPrivate || !room.passwordHash) {
    // If room doesn't exist, isn't private, or has no password, return false
    return false;
  }
  
  try {
    return await bcrypt.compare(password, room.passwordHash);
  } catch (error) {
    console.error('Error validating password:', error);
    return false;
  }
}

export function getRoomMapType(roomId: string): MapType {
  const room = rooms.get(roomId);
  return room?.mapType || 'cafe';
}

export function addPlayerToRoom(roomId: string, player: PlayerWithChat): void {
  const room = getOrCreateRoom(roomId);
  room.players.set(player.id, player);
}

export function removePlayerFromRoom(roomId: string, playerId: string): void {
  const room = rooms.get(roomId);
  if (room) {
    room.players.delete(playerId);
    // Clean up empty rooms (but never delete global rooms)
    if (room.players.size === 0 && !GLOBAL_ROOM_IDS.includes(roomId)) {
      rooms.delete(roomId);
    }
  }
}

export function getPlayersInRoom(roomId: string): PlayerWithChat[] {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.players.values());
}

export function getPlayerInRoom(roomId: string, playerId: string): PlayerWithChat | undefined {
  const room = rooms.get(roomId);
  if (!room) return undefined;
  return room.players.get(playerId);
}

export function updatePlayerPosition(
  roomId: string,
  playerId: string,
  x: number,
  y: number,
  direction: 'up' | 'down' | 'left' | 'right'
): boolean {
  const room = rooms.get(roomId);
  if (!room) return false;

  const player = room.players.get(playerId);
  if (!player) return false;

  // Validate bounds
  const maxX = GAME_CONSTANTS.TILE_SIZE * GAME_CONSTANTS.MAP_WIDTH - GAME_CONSTANTS.PLAYER_WIDTH;
  const maxY = GAME_CONSTANTS.TILE_SIZE * GAME_CONSTANTS.MAP_HEIGHT - GAME_CONSTANTS.PLAYER_HEIGHT;

  player.x = Math.max(0, Math.min(x, maxX));
  player.y = Math.max(0, Math.min(y, maxY));
  player.direction = direction;

  return true;
}

export function updatePlayerChat(roomId: string, playerId: string, text: string): number {
  const room = rooms.get(roomId);
  if (!room) return 0;

  const player = room.players.get(playerId);
  if (!player) return 0;

  const createdAt = Date.now();
  player.chatBubble = { text, createdAt };

  // Auto-clear chat bubble after duration
  setTimeout(() => {
    if (player.chatBubble && player.chatBubble.createdAt === createdAt) {
      player.chatBubble = undefined;
    }
  }, GAME_CONSTANTS.CHAT_BUBBLE_DURATION);

  return createdAt;
}

// Orb management
// Orb rarity system - matches cosmetic rarities
// Spawn chances (must add up to 1.0)
const ORB_RARITIES = {
  common:    { chance: 0.50, multiplier: 1 },   // 50% - cyan
  uncommon:  { chance: 0.25, multiplier: 2 },   // 25% - green
  rare:      { chance: 0.15, multiplier: 4 },   // 15% - blue
  epic:      { chance: 0.08, multiplier: 8 },   // 8%  - purple
  legendary: { chance: 0.02, multiplier: 15 },  // 2%  - gold
};

// Get orb rarity based on random roll
export function getOrbRarity(): { type: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'; multiplier: number } {
  const roll = Math.random();
  let cumulative = 0;
  
  const rarities: Array<'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'> = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  
  for (const rarity of rarities) {
    const { chance, multiplier } = ORB_RARITIES[rarity];
    cumulative += chance;
    if (roll < cumulative) {
      return { type: rarity, multiplier };
    }
  }
  
  // Fallback to common
  return { type: 'common', multiplier: 1 };
}

// Generate valid spawn zones for forest map (matching client-side path generation)
function generateForestSpawnZones(): Set<string> {
  const pathTiles = new Set<string>();
  const MAP_WIDTH = GAME_CONSTANTS.MAP_WIDTH;
  const MAP_HEIGHT = GAME_CONSTANTS.MAP_HEIGHT;
  
  // Helper to add path tiles
  const addPathTile = (x: number, y: number, w: number, h: number) => {
    for (let px = Math.floor(x); px < x + w && px < MAP_WIDTH; px++) {
      for (let py = Math.floor(y); py < y + h && py < MAP_HEIGHT; py++) {
        if (px >= 0 && py >= 0) {
          pathTiles.add(`${px},${py}`);
        }
      }
    }
  };
  
  // Main winding path from top-left to bottom-right
  let pathX = 2;
  let pathY = 5;
  const seed1 = 12345;
  while (pathX < MAP_WIDTH - 5 && pathY < MAP_HEIGHT - 5) {
    addPathTile(pathX, pathY, 3, 2);
    const rand = ((pathX * 7 + pathY * 13 + seed1) % 10);
    if (rand < 4) pathX += 2;
    else if (rand < 6) { pathX += 2; pathY += 2; }
    else if (rand < 8) pathY += 2;
    else { pathX += 3; pathY -= 1; if (pathY < 2) pathY = 2; }
  }
  
  // Second winding path from top-right going down-left
  pathX = MAP_WIDTH - 8;
  pathY = 3;
  const seed2 = 54321;
  while (pathX > 5 && pathY < MAP_HEIGHT - 5) {
    addPathTile(pathX, pathY, 3, 2);
    const rand = ((pathX * 11 + pathY * 7 + seed2) % 10);
    if (rand < 3) pathX -= 2;
    else if (rand < 6) { pathX -= 2; pathY += 2; }
    else if (rand < 8) pathY += 2;
    else { pathX -= 1; pathY += 3; }
  }
  
  // Third path - curves from left side across middle
  pathX = 0;
  pathY = MAP_HEIGHT / 2;
  const seed3 = 98765;
  while (pathX < MAP_WIDTH - 3) {
    addPathTile(pathX, pathY, 3, 2);
    const rand = ((pathX * 5 + pathY * 17 + seed3) % 10);
    pathX += 2;
    if (rand < 3) { pathY -= 2; if (pathY < 3) pathY = 3; }
    else if (rand < 6) { pathY += 2; if (pathY > MAP_HEIGHT - 5) pathY = MAP_HEIGHT - 5; }
  }
  
  // Fourth path - vertical winding path
  pathX = MAP_WIDTH / 3;
  pathY = 0;
  const seed4 = 13579;
  while (pathY < MAP_HEIGHT - 3) {
    addPathTile(pathX, pathY, 2, 3);
    const rand = ((pathX * 3 + pathY * 11 + seed4) % 10);
    pathY += 2;
    if (rand < 3) { pathX -= 2; if (pathX < 3) pathX = 3; }
    else if (rand < 6) { pathX += 2; if (pathX > MAP_WIDTH - 5) pathX = MAP_WIDTH - 5; }
  }
  
  // Fifth path - another vertical winding path on right side
  pathX = (MAP_WIDTH * 2) / 3;
  pathY = MAP_HEIGHT - 3;
  const seed5 = 24680;
  while (pathY > 3) {
    addPathTile(pathX, pathY, 2, 3);
    const rand = ((pathX * 9 + pathY * 5 + seed5) % 10);
    pathY -= 2;
    if (rand < 4) { pathX -= 2; if (pathX < 3) pathX = 3; }
    else if (rand < 7) { pathX += 2; if (pathX > MAP_WIDTH - 5) pathX = MAP_WIDTH - 5; }
  }
  
  return pathTiles;
}

// Generate shrines for a forest room
export function generateShrinesForRoom(roomId: string, mapType: MapType): Shrine[] {
  if (mapType !== 'forest') {
    return [];
  }

  const TILE_SIZE = GAME_CONSTANTS.TILE_SIZE;
  const shrines: Shrine[] = [];
  
  // Get forest path tiles
  const pathTiles = generateForestSpawnZones();
  const pathList = Array.from(pathTiles).map(s => {
    const [x, y] = s.split(',').map(Number);
    return { x, y };
  });

  if (pathList.length === 0) {
    return [];
  }

  // Generate 5-10 random shrines
  const shrineCount = 5 + Math.floor(Math.random() * 6); // 5-10 shrines
  
  // Minimum distance between shrines (in tiles)
  const minDistance = 15;
  const placedPositions: Array<{ x: number; y: number }> = [];
  
  // Plaza exclusion (same as tree placement logic)
  const fountainCenterTileX = GAME_CONSTANTS.MAP_WIDTH / 2;
  const fountainCenterTileY = GAME_CONSTANTS.MAP_HEIGHT / 2;
  const plazaRadiusTiles = 36; // Radius in tiles to avoid (matching fountain avoidance radius)

  for (let i = 0; i < shrineCount && i < pathList.length; i++) {
    let attempts = 0;
    let placed = false;

    while (attempts < 50 && !placed) {
      // Pick a random path tile
      const tile = pathList[Math.floor(Math.random() * pathList.length)];
      
      // Add some randomness within the tile
      const x = tile.x * TILE_SIZE + Math.random() * TILE_SIZE;
      const y = tile.y * TILE_SIZE + Math.random() * TILE_SIZE;
      
      // Convert to tile coordinates for plaza check
      const tileX = x / TILE_SIZE;
      const tileY = y / TILE_SIZE;
      
      // Check if position is too close to plaza (fountain center)
      const dx = tileX - fountainCenterTileX;
      const dy = tileY - fountainCenterTileY;
      const distToPlaza = Math.sqrt(dx * dx + dy * dy);
      const isInPlaza = distToPlaza < plazaRadiusTiles;

      // Check minimum distance from other shrines
      const tooClose = placedPositions.some(pos => {
        const dx = (x - pos.x) / TILE_SIZE;
        const dy = (y - pos.y) / TILE_SIZE;
        return Math.sqrt(dx * dx + dy * dy) < minDistance;
      });

      // Only place if not in plaza and not too close to other shrines
      if (!isInPlaza && !tooClose) {
        shrines.push({
          id: `shrine_${roomId}_${i}`,
          x: Math.floor(x),
          y: Math.floor(y),
        });
        placedPositions.push({ x, y });
        placed = true;
      }
      attempts++;
    }
  }

  return shrines;
}

// Generate treasure chests for a forest room (deep in forests, far from center)
export function generateTreasureChestsForRoom(roomId: string, mapType: MapType): TreasureChest[] {
  if (mapType !== 'forest') {
    return [];
  }

  const TILE_SIZE = GAME_CONSTANTS.TILE_SIZE;
  const chests: TreasureChest[] = [];
  
  // Get forest path tiles
  const pathTiles = generateForestSpawnZones();
  const pathList = Array.from(pathTiles).map(s => {
    const [x, y] = s.split(',').map(Number);
    return { x, y };
  });

  if (pathList.length === 0) {
    return [];
  }

  // Generate 3-6 random treasure chests (fewer than shrines)
  const chestCount = 3 + Math.floor(Math.random() * 4); // 3-6 chests
  
  // Minimum distance between chests (in tiles)
  const minDistance = 20;
  const placedPositions: Array<{ x: number; y: number }> = [];
  
  // Plaza exclusion - chests should be DEEP in forests, far from center
  const fountainCenterTileX = GAME_CONSTANTS.MAP_WIDTH / 2;
  const fountainCenterTileY = GAME_CONSTANTS.MAP_HEIGHT / 2;
  const minDistanceFromPlaza = 50; // Chests must be at least 50 tiles from fountain center (deep in forests)

  for (let i = 0; i < chestCount && i < pathList.length; i++) {
    let attempts = 0;
    let placed = false;

    while (attempts < 100 && !placed) {
      // Pick a random path tile
      const tile = pathList[Math.floor(Math.random() * pathList.length)];
      
      // Add some randomness within the tile
      const x = tile.x * TILE_SIZE + Math.random() * TILE_SIZE;
      const y = tile.y * TILE_SIZE + Math.random() * TILE_SIZE;
      
      // Convert to tile coordinates for plaza check
      const tileX = x / TILE_SIZE;
      const tileY = y / TILE_SIZE;
      
      // Check if position is far enough from plaza (deep in forests)
      const dx = tileX - fountainCenterTileX;
      const dy = tileY - fountainCenterTileY;
      const distToPlaza = Math.sqrt(dx * dx + dy * dy);
      const isFarEnoughFromPlaza = distToPlaza >= minDistanceFromPlaza;

      // Check minimum distance from other chests
      const tooClose = placedPositions.some(pos => {
        const dx = (x - pos.x) / TILE_SIZE;
        const dy = (y - pos.y) / TILE_SIZE;
        return Math.sqrt(dx * dx + dy * dy) < minDistance;
      });

      // Only place if far from plaza (deep in forests) and not too close to other chests
      if (isFarEnoughFromPlaza && !tooClose) {
        chests.push({
          id: `treasure_chest_${roomId}_${i}`,
          x: Math.floor(x),
          y: Math.floor(y),
        });
        placedPositions.push({ x, y });
        placed = true;
      }
      attempts++;
    }
  }

  return chests;
}

// Cache forest spawn zones
const forestSpawnZones = generateForestSpawnZones();
const forestSpawnList = Array.from(forestSpawnZones).map(s => {
  const [x, y] = s.split(',').map(Number);
  return { x, y };
});

// Get a valid spawn position based on map type
function getValidSpawnPosition(mapType: MapType): { x: number; y: number } {
  const TILE_SIZE = GAME_CONSTANTS.TILE_SIZE;
  const maxX = TILE_SIZE * GAME_CONSTANTS.MAP_WIDTH - GAME_CONSTANTS.ORB_SIZE;
  const maxY = TILE_SIZE * GAME_CONSTANTS.MAP_HEIGHT - GAME_CONSTANTS.ORB_SIZE;
  
  if (mapType === 'forest' && forestSpawnList.length > 0) {
    // For forest, spawn on paths
    const tile = forestSpawnList[Math.floor(Math.random() * forestSpawnList.length)];
    // Add some randomness within the tile
    const x = tile.x * TILE_SIZE + Math.random() * TILE_SIZE;
    const y = tile.y * TILE_SIZE + Math.random() * TILE_SIZE;
    return { 
      x: Math.min(x, maxX), 
      y: Math.min(y, maxY) 
    };
  } else if (mapType === 'cafe') {
    // For cafe, avoid edges/walls - spawn in middle area
    const margin = TILE_SIZE * 5;
    return {
      x: margin + Math.random() * (maxX - margin * 2),
      y: margin + Math.random() * (maxY - margin * 2),
    };
  } else {
    // For fields and other maps, anywhere is fine
    return {
      x: Math.floor(Math.random() * maxX),
      y: Math.floor(Math.random() * maxY),
    };
  }
}

export function spawnOrb(roomId: string): Orb | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  if (room.orbs.length >= GAME_CONSTANTS.MAX_ORBS_PER_ROOM) {
    return null;
  }

  // Get orb rarity based on spawn chances
  const { type: orbType, multiplier } = getOrbRarity();
  const value = GAME_CONSTANTS.ORB_VALUE * multiplier;

  // Get a valid spawn position based on map type
  const { x, y } = getValidSpawnPosition(room.mapType);

  const orb: Orb = {
    id: uuidv4(),
    x: Math.floor(x),
    y: Math.floor(y),
    value,
    orbType,
  };

  room.orbs.push(orb);
  return orb;
}

// Spawn an orb at a specific position (for fountain spawning)
// bypassMaxOrbs: if true, ignores MAX_ORBS_PER_ROOM limit (for shrine rewards)
export function createOrbAtPosition(roomId: string, x: number, y: number, value: number, orbType: OrbType, bypassMaxOrbs: boolean = false): Orb | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  if (!bypassMaxOrbs && room.orbs.length >= GAME_CONSTANTS.MAX_ORBS_PER_ROOM) {
    return null;
  }

  const orb: Orb = {
    id: uuidv4(),
    x: Math.floor(x),
    y: Math.floor(y),
    value,
    orbType,
  };

  room.orbs.push(orb);
  return orb;
}

export function collectOrb(roomId: string, orbId: string, playerId: string): Orb | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  const orbIndex = room.orbs.findIndex(o => o.id === orbId);
  if (orbIndex === -1) return null;

  const orb = room.orbs[orbIndex];
  const player = room.players.get(playerId);
  if (!player) return null;

  // Validate player is close enough to collect
  const dx = player.x + GAME_CONSTANTS.PLAYER_WIDTH / 2 - (orb.x + GAME_CONSTANTS.ORB_SIZE / 2);
  const dy = player.y + GAME_CONSTANTS.PLAYER_HEIGHT / 2 - (orb.y + GAME_CONSTANTS.ORB_SIZE / 2);
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > GAME_CONSTANTS.COLLECTION_RADIUS) {
    return null;
  }

  // Remove orb and return it
  room.orbs.splice(orbIndex, 1);
  return orb;
}

export function getOrbsInRoom(roomId: string): Orb[] {
  const room = rooms.get(roomId);
  if (!room) return [];
  return [...room.orbs];
}

// Get a shrine by ID
export function getShrine(roomId: string, shrineId: string): Shrine | null {
  const room = rooms.get(roomId);
  if (!room) return null;
  return room.shrines.find(s => s.id === shrineId) || null;
}

export function getTreasureChest(roomId: string, chestId: string): TreasureChest | null {
  const room = rooms.get(roomId);
  if (!room) return null;
  return room.treasureChests.find(c => c.id === chestId) || null;
}

// Interact with a shrine
export async function interactWithShrine(
  roomId: string,
  shrineId: string,
  playerId: string,
  firebaseOrbs?: number
): Promise<{ success: boolean; message: string; blessed: boolean; orbCount?: number; totalValue?: number }> {
  const room = rooms.get(roomId);
  if (!room) {
    return { success: false, message: 'Room not found', blessed: false };
  }

  const shrine = room.shrines.find(s => s.id === shrineId);
  if (!shrine) {
    return { success: false, message: 'Shrine not found', blessed: false };
  }

  // Check if player has enough orbs (250k requirement)
  const player = room.players.get(playerId);
  if (!player) {
    return { success: false, message: 'Player not found', blessed: false };
  }

  const MIN_ORBS_REQUIRED = 250000;
  // Use Firebase balance from client if provided (client already polled Firebase successfully)
  // Otherwise try to poll Firebase ourselves, or fall back to room state
  let playerOrbs = player.orbs || 0;
  let usedFirebase = false;
  
  if (firebaseOrbs !== undefined && firebaseOrbs !== null) {
    // Client already polled Firebase and sent us the balance - use it (most reliable)
    playerOrbs = firebaseOrbs;
    usedFirebase = true;
    // Update room state to keep it in sync
    player.orbs = playerOrbs;
    console.log(`[Shrine] Player ${playerId} has ${playerOrbs} orbs (from client Firebase poll), required: ${MIN_ORBS_REQUIRED}`);
  } else {
    // Client didn't send balance, try to poll Firebase ourselves (may fail if credentials not configured)
    try {
      const { getUserData } = await import('./firebase');
      const userData = await getUserData(playerId);
      if (userData?.orbs !== undefined && userData.orbs !== null) {
        playerOrbs = userData.orbs;
        usedFirebase = true;
        // Update room state to keep it in sync
        player.orbs = playerOrbs;
      }
    } catch (error: any) {
      // Firebase might not be configured (credential error) - use room state as fallback
      console.warn(`[Shrine] Failed to get Firebase orb balance for player ${playerId}, using room state:`, error?.message || error);
      // Fallback to room state if Firebase fails - use whatever we have in room state
      playerOrbs = player.orbs || 0;
    }
    console.log(`[Shrine] Player ${playerId} has ${playerOrbs} orbs (${usedFirebase ? 'from server Firebase poll' : 'from room state'}), required: ${MIN_ORBS_REQUIRED}`);
  }
  if (playerOrbs < MIN_ORBS_REQUIRED) {
    return { 
      success: false, 
      message: 'You do not have enough orbs to use this (250k required)', 
      blessed: false 
    };
  }

  const now = Date.now();
  const COOLDOWN_DURATION = 60000; // 60 seconds

  // Check cooldown
  if (shrine.cooldownEndTime && now < shrine.cooldownEndTime) {
    const remaining = Math.ceil((shrine.cooldownEndTime - now) / 1000);
    return { 
      success: false, 
      message: `Shrine is on cooldown. ${remaining}s remaining.`, 
      blessed: false 
    };
  }

  // Update shrine cooldown
  shrine.lastUsedBy = playerId;
  shrine.lastUsedTime = now;
  shrine.cooldownEndTime = now + COOLDOWN_DURATION;

  // 20% chance of blessing, 80% disapproval
  const roll = Math.random();
  const blessed = roll < 0.2;

  if (blessed) {
    // Determine orb count (3-8 orbs) - this is how many red shrine orbs to spawn
    const orbCount = 3 + Math.floor(Math.random() * 6);
    
    // Calculate total value that would be rewarded (1000-5000 per orb, weighted)
    // Sum up the total value across all orbs
    let totalValue = 0;
    
    for (let i = 0; i < orbCount; i++) {
      const valueRoll = Math.random();
      let orbValue: number;
      
      if (valueRoll < 0.5) {
        // 50% chance: 1000-2000
        orbValue = 1000 + Math.floor(Math.random() * 1001);
      } else if (valueRoll < 0.8) {
        // 30% chance: 2000-3000
        orbValue = 2000 + Math.floor(Math.random() * 1001);
      } else if (valueRoll < 0.95) {
        // 15% chance: 3000-4000
        orbValue = 3000 + Math.floor(Math.random() * 1001);
      } else if (valueRoll < 0.99) {
        // 4% chance: 4000-4500
        orbValue = 4000 + Math.floor(Math.random() * 501);
      } else {
        // 1% chance: 4500-5000 (very rare)
        orbValue = 4500 + Math.floor(Math.random() * 501);
      }
      
      totalValue += orbValue;
    }

    const messages = [
      'The gods applaud you!',
      'Divine favor shines upon you!',
      'The ancient spirits bless you!',
      'Mystical energy flows through you!',
      'The shrine glows with approval!',
    ];
    const message = messages[Math.floor(Math.random() * messages.length)];

    return {
      success: true,
      message,
      blessed: true,
      orbCount,
      totalValue, // Return total value for red orb spawning
    };
  } else {
    const messages = [
      'The gods despise you...',
      'The shrine remains silent...',
      'No divine favor today...',
      'The ancient spirits ignore you...',
      'The shrine shows no response...',
    ];
    const message = messages[Math.floor(Math.random() * messages.length)];

    return {
      success: true,
      message,
      blessed: false,
    };
  }
}

// Interact with a treasure chest
export async function interactWithTreasureChest(
  roomId: string,
  chestId: string,
  playerId: string,
  firebaseOrbs?: number
): Promise<{ success: boolean; message: string; coinsFound?: number }> {
  const room = rooms.get(roomId);
  if (!room) {
    return { success: false, message: 'Room not found' };
  }

  const chest = room.treasureChests.find(c => c.id === chestId);
  if (!chest) {
    return { success: false, message: 'Treasure chest not found' };
  }

  // Check if player has enough orbs (500k requirement)
  const player = room.players.get(playerId);
  if (!player) {
    return { success: false, message: 'Player not found' };
  }

  const MIN_ORBS_REQUIRED = 500000;
  // Use Firebase balance from client if provided
  let playerOrbs = player.orbs || 0;
  let usedFirebase = false;
  
  if (firebaseOrbs !== undefined && firebaseOrbs !== null) {
    playerOrbs = firebaseOrbs;
    usedFirebase = true;
    player.orbs = playerOrbs;
    console.log(`[TreasureChest] Player ${playerId} has ${playerOrbs} orbs (from client Firebase poll), required: ${MIN_ORBS_REQUIRED}`);
  } else {
    try {
      const { getUserData } = await import('./firebase');
      const userData = await getUserData(playerId);
      if (userData?.orbs !== undefined && userData.orbs !== null) {
        playerOrbs = userData.orbs;
        usedFirebase = true;
        player.orbs = playerOrbs;
      }
    } catch (error: any) {
      console.warn(`[TreasureChest] Failed to get Firebase orb balance for player ${playerId}, using room state:`, error?.message || error);
      playerOrbs = player.orbs || 0;
    }
    console.log(`[TreasureChest] Player ${playerId} has ${playerOrbs} orbs (${usedFirebase ? 'from server Firebase poll' : 'from room state'}), required: ${MIN_ORBS_REQUIRED}`);
  }
  
  if (playerOrbs < MIN_ORBS_REQUIRED) {
    return { 
      success: false, 
      message: 'You do not have enough orbs to open this chest (500k required)'
    };
  }

  const now = Date.now();
  const COOLDOWN_DURATION = 60000; // 60 seconds (1 minute)

  // Check cooldown
  if (chest.cooldownEndTime && now < chest.cooldownEndTime) {
    const remaining = Math.ceil((chest.cooldownEndTime - now) / 1000);
    return { 
      success: false, 
      message: `Treasure chest is on cooldown. ${remaining}s remaining.`
    };
  }

  // Update chest cooldown
  chest.cooldownEndTime = now + COOLDOWN_DURATION;

  // 80% chance to find coins, 20% chance empty
  const roll = Math.random();
  const foundCoins = roll < 0.80;

  if (foundCoins) {
    // Random 10-100 coins
    const coinsFound = 10 + Math.floor(Math.random() * 91); // 10-100 inclusive

    const messages = [
      'You found gold coins!',
      'Treasure discovered!',
      'Gold glimmers in the chest!',
      'A fortune awaits!',
      'Coins sparkle before you!',
    ];
    const message = messages[Math.floor(Math.random() * messages.length)];

    return {
      success: true,
      message,
      coinsFound,
    };
  } else {
    const messages = [
      'The chest is empty...',
      'Nothing but dust inside...',
      'The chest was already looted...',
      'No treasure found...',
      'Empty...',
    ];
    const message = messages[Math.floor(Math.random() * messages.length)];

    return {
      success: true,
      message,
      coinsFound: 0,
    };
  }
}

// Get shrines in a room
export function getShrinesInRoom(roomId: string): Shrine[] {
  const room = rooms.get(roomId);
  if (!room) return [];
  return [...room.shrines];
}

// Get treasure chests in a room
export function getTreasureChestsInRoom(roomId: string): TreasureChest[] {
  const room = rooms.get(roomId);
  if (!room) return [];
  return [...room.treasureChests];
}

// Tree state management
export function getTreeState(roomId: string, treeId: string): TreeState | null {
  const room = rooms.get(roomId);
  if (!room) return null;
  return room.treeStates.get(treeId) || null;
}

export function setTreeCutting(roomId: string, treeId: string, playerId: string): boolean {
  const room = rooms.get(roomId);
  if (!room) return false;
  
  const existingState = room.treeStates.get(treeId);
  if (existingState && (existingState.isCut || existingState.cutBy !== null)) {
    return false; // Tree is already cut or being cut
  }
  
  room.treeStates.set(treeId, {
    treeId,
    isCut: false,
    cutBy: playerId,
    cuttingStartTime: Date.now(), // Track when cutting started for progress bar sync
    respawnAt: 0,
  });
  return true;
}

export function setTreeCut(roomId: string, treeId: string, playerId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  
  const RESPAWN_DELAY = 45000; // 45 seconds
  room.treeStates.set(treeId, {
    treeId,
    isCut: true,
    cutBy: null,
    respawnAt: Date.now() + RESPAWN_DELAY,
  });
}

export function cancelTreeCutting(roomId: string, treeId: string, playerId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  
  const treeState = room.treeStates.get(treeId);
  // Only cancel if this player is cutting the tree
  if (treeState && treeState.cutBy === playerId && !treeState.isCut) {
    // Reset tree state to not being cut
    room.treeStates.set(treeId, {
      treeId,
      isCut: false,
      cutBy: null,
      respawnAt: 0,
    });
  }
}

export function checkTreeRespawn(roomId: string): TreeState[] {
  const room = rooms.get(roomId);
  if (!room) return [];
  
  const now = Date.now();
  const updatedStates: TreeState[] = [];
  
  room.treeStates.forEach((state, treeId) => {
    if (state.isCut && state.respawnAt > 0 && now >= state.respawnAt) {
      // Respawn the tree
      const newState: TreeState = { treeId, isCut: false, cutBy: null, respawnAt: 0 };
      room.treeStates.set(treeId, newState);
      updatedStates.push(newState);
    }
  });
  
  return updatedStates;
}

export function getTreeStatesInRoom(roomId: string): TreeState[] {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.treeStates.values());
}

export function getAllRooms(): string[] {
  return Array.from(rooms.keys());
}

// Initialize global rooms on server startup
export function initializeGlobalRooms(): void {
  for (const roomId of GLOBAL_ROOM_IDS) {
    // Create global room if it doesn't exist (all use forest map)
    if (!rooms.has(roomId)) {
      const room = createRoom(roomId, 'forest');
      console.log(`Initialized global room: ${roomId} with ${room.shrines.length} shrines`);
    } else {
      // Ensure existing global rooms have shrines (in case they were created before shrine code was added)
      const room = rooms.get(roomId);
      if (room && room.mapType === 'forest' && (!room.shrines || room.shrines.length === 0)) {
        room.shrines = generateShrinesForRoom(roomId, 'forest');
        console.log(`Generated ${room.shrines.length} shrines for existing global room: ${roomId}`);
      }
    }
  }
}

export function getRoomList(): RoomInfo[] {
  const roomList: RoomInfo[] = [];
  
  // First, always include global rooms (even if empty)
  for (const roomId of GLOBAL_ROOM_IDS) {
    const room = rooms.get(roomId);
    if (room) {
      const playerNames = Array.from(room.players.values()).map(p => p.name);
      roomList.push({
        id: roomId,
        mapType: room.mapType,
        playerCount: room.players.size,
        players: playerNames,
        isGlobal: true,
        isPrivate: false, // Global rooms are never private
      });
    }
  }
  
  // Then include player-created rooms (only if they have players)
  rooms.forEach((room, roomId) => {
    // Skip global rooms (already added) and empty player rooms
    if (!GLOBAL_ROOM_IDS.includes(roomId) && room.players.size > 0) {
      const playerNames = Array.from(room.players.values()).map(p => p.name);
      roomList.push({
        id: roomId,
        mapType: room.mapType,
        playerCount: room.players.size,
        players: playerNames,
        isGlobal: false,
        isPrivate: room.isPrivate || false,
      });
    }
  });
  
  return roomList;
}
