import { Server } from 'socket.io';
import { GAME_CONSTANTS } from './types';
import * as rooms from './rooms';

// Store interval references for cleanup
const orbIntervals: Map<string, NodeJS.Timeout> = new Map();
const fountainOrbIntervals: Map<string, NodeJS.Timeout> = new Map();

export function startOrbSpawner(io: Server, roomId: string): void {
  // Don't start if already running
  if (orbIntervals.has(roomId)) return;

  // Don't spawn orbs on casino or millionaires_lounge maps
  const room = rooms.getRoom(roomId);
  if (room && (room.mapType === 'casino' || room.mapType === 'millionaires_lounge')) {
    return;
  }

  const interval = setInterval(() => {
    const orb = rooms.spawnOrb(roomId);
    if (orb) {
      io.to(roomId).emit('orb_spawned', orb);
    }
  }, GAME_CONSTANTS.ORB_SPAWN_INTERVAL);

  orbIntervals.set(roomId, interval);

  // Spawn initial orbs (more for bigger map)
  const initialOrbCount = 40; // Increased for much larger map (200x150)
  for (let i = 0; i < initialOrbCount; i++) {
    const orb = rooms.spawnOrb(roomId);
    if (orb) {
      io.to(roomId).emit('orb_spawned', orb);
    }
  }
}

export function stopOrbSpawner(roomId: string): void {
  const interval = orbIntervals.get(roomId);
  if (interval) {
    clearInterval(interval);
    orbIntervals.delete(roomId);
  }
}

// Spawn orbs from fountain (forest map only)
function spawnFountainOrb(io: Server, roomId: string): void {
  const room = rooms.getRoom(roomId);
  if (!room || room.mapType !== 'forest') return;
  
  if (room.orbs.length >= GAME_CONSTANTS.MAX_ORBS_PER_ROOM) {
    return;
  }
  
  // Fountain is at center of map
  const TILE_SIZE = GAME_CONSTANTS.TILE_SIZE;
  const SCALE = GAME_CONSTANTS.SCALE;
  const WORLD_WIDTH = TILE_SIZE * GAME_CONSTANTS.MAP_WIDTH;
  const WORLD_HEIGHT = TILE_SIZE * GAME_CONSTANTS.MAP_HEIGHT;
  const centerX = WORLD_WIDTH / 2;
  const centerY = WORLD_HEIGHT / 2;
  
  // Fountain top position (where water bowl is - matching client: centerY - 25 * SCALE)
  // Client uses SCALE for rendering, server uses unscaled coordinates
  // Client: centerY - 25 * SCALE = centerY - 75 pixels
  // Server: centerY - 25 pixels (since SCALE is just for rendering)
  const fountainTopX = centerX;
  const fountainTopY = centerY - 25; // Top of fountain bowl
  
  // Paved area radius (matching client: 540 * SCALE pixels = 1620 pixels)
  // Server coordinates are unscaled, so we need to divide by SCALE
  // Client: plazaRadius = 540 * SCALE = 1620 pixels
  // Server: plazaRadius = 540 pixels (unscaled, client will multiply by SCALE)
  const plazaRadius = 540; // In server coordinates (unscaled) - increased by 200% from 180
  const minRadius = 150; // Don't spawn too close to fountain center (increased proportionally)
  
  // Calculate random landing position on circular paved area
  // This simulates the orb "spraying out" from the fountain top
  const angle = Math.random() * Math.PI * 2;
  const radius = minRadius + Math.random() * (plazaRadius - minRadius);
  const landingX = centerX + Math.cos(angle) * radius;
  const landingY = centerY + Math.sin(angle) * radius;
  
  // Spawn orb at landing position (orbs are static, so we can't animate the trajectory)
  // The visual effect of "spraying" could be added client-side later
  const x = landingX;
  const y = landingY;
  
  // Get orb rarity (fountain can spawn rarer orbs more often)
  const { type: orbType, multiplier } = rooms.getOrbRarity();
  const value = GAME_CONSTANTS.ORB_VALUE * multiplier;
  
  const orb = rooms.createOrbAtPosition(roomId, Math.floor(x), Math.floor(y), value, orbType);
  if (orb) {
    io.to(roomId).emit('orb_spawned', orb);
  }
}

export function startFountainOrbSpawner(io: Server, roomId: string): void {
  // Don't start if already running
  if (fountainOrbIntervals.has(roomId)) return;
  
  const room = rooms.getRoom(roomId);
  if (!room || room.mapType !== 'forest') return;
  
  // Spawn fountain orbs less frequently than regular orbs (every 8-15 seconds)
  const getNextSpawnTime = () => 8000 + Math.random() * 7000;
  
  const scheduleNext = () => {
    const spawnDelay = getNextSpawnTime();
    const nextSpawnTimestamp = Date.now() + spawnDelay;
    
    // Emit next spawn time to all clients in room
    io.to(roomId).emit('fountain_next_spawn', { nextSpawnTime: nextSpawnTimestamp });
    
    const timeout = setTimeout(() => {
      spawnFountainOrb(io, roomId);
      scheduleNext(); // Schedule next spawn
    }, spawnDelay);
    
    fountainOrbIntervals.set(roomId, timeout as any);
  };
  
  // Start first spawn after a short delay
  scheduleNext();
}

export function stopFountainOrbSpawner(roomId: string): void {
  const timeout = fountainOrbIntervals.get(roomId);
  if (timeout) {
    clearTimeout(timeout);
    fountainOrbIntervals.delete(roomId);
  }
}

export function stopAllSpawners(): void {
  for (const [roomId, interval] of orbIntervals) {
    clearInterval(interval);
  }
  orbIntervals.clear();
  
  for (const [roomId, timeout] of fountainOrbIntervals) {
    clearTimeout(timeout);
  }
  fountainOrbIntervals.clear();
}
