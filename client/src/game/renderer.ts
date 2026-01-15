import { PlayerWithChat, Orb, GAME_CONSTANTS, CANVAS_WIDTH, CANVAS_HEIGHT, WORLD_WIDTH, WORLD_HEIGHT, MapType, ShopItem, ItemRarity, Direction, Shrine, TreasureChest } from '../types';
import { Camera, worldToScreen, isVisible } from './Camera';

const { TILE_SIZE, SCALE, MAP_WIDTH, MAP_HEIGHT, PLAYER_WIDTH, PLAYER_HEIGHT, ORB_SIZE } = GAME_CONSTANTS;

// ============ PET SYSTEM ============
interface PetState {
  x: number;
  y: number;
  lastUpdateTime: number;
}

// Track pet positions for each player
const petStates: Map<string, PetState> = new Map();
const PET_OFFSET_X = -25; // Distance to the left of player (in unscaled pixels)
const PET_OFFSET_Y = 0; // Vertical offset from player center (in unscaled pixels)
const PET_BOBBING_AMPLITUDE = 2; // Vertical bobbing amplitude (in scaled pixels)

// ============ WANDERING VILLAGER NPCs ============
interface VillagerNPC {
  id: string;
  name: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  direction: Direction;
  outfit: string[];
  speed: number;
  changeDirectionTime: number;
  profession: string; // For speech messages
  movementCycle: number; // Track movement cycles for deterministic behavior
}

// ============ CENTURION NPCs ============
interface CenturionNPC {
  id: string;
  name: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  direction: Direction;
  outfit: string[];
  flagIndex: number; // Which flag they're stationed at
  speed: number;
  changeDirectionTime: number;
  movementCycle: number; // Track movement cycles for deterministic behavior
  towerCenterX: number; // Tower center X position (unscaled)
  towerCenterY: number; // Tower center Y position (unscaled) - top platform level
  platformRadius: number; // Radius of top platform (unscaled) - 35px
}

// NPC speech bubble state for villagers and centurions
interface NPCInteractionBubble {
  text: string;
  createdAt: number;
}

const npcInteractionBubbles: Map<string, NPCInteractionBubble> = new Map();
const NPC_SPEECH_DURATION = 3000; // 3 seconds

// Villager profession outfits (brown/villager themed) with profession names
const VILLAGER_OUTFITS: Array<{ outfit: string[]; profession: string }> = [
  // Farmer
  { outfit: ['hat_cowboy', 'shirt_red', 'legs_jeans_blue'], profession: 'Farmer' },
  // Blacksmith
  { outfit: ['hat_hardhat', 'shirt_black', 'legs_jeans_black'], profession: 'Blacksmith' },
  // Baker
  { outfit: ['hat_chef', 'coat_chef', 'legs_chef'], profession: 'Baker' },
  // Merchant
  { outfit: ['hat_tophat', 'tunic_viking', 'legs_suit'], profession: 'Merchant' },
  // Guard
  { outfit: ['hat_knight', 'armor_knight', 'legs_knight'], profession: 'Guard' },
  // Scholar
  { outfit: ['hat_wizard', 'robe_wizard', 'legs_wizard'], profession: 'Scholar' },
  // Carpenter
  { outfit: ['hat_beanie', 'vest_cowboy', 'legs_jeans_blue'], profession: 'Carpenter' },
  // Herbalist
  { outfit: ['hat_beret', 'robe_dark', 'legs_wizard'], profession: 'Herbalist' },
];

// Villager names
const VILLAGER_NAMES = [
  'Farmer Tom', 'Blacksmith Bill', 'Baker Sarah', 'Merchant Joe',
  'Guard Mike', 'Scholar Anne', 'Carpenter Dan', 'Herbalist Lily',
  'Trader Sam', 'Craftsman Ben', 'Miller Kate', 'Weaver Emma'
];

// Track villager NPCs
const villagerNPCs: VillagerNPC[] = [];
let villagersInitialized = false;
// Track last update time for each villager (for throttling off-screen updates)
const villagerLastUpdateTime: Map<string, number> = new Map();

// Seeded random function for deterministic NPC behavior across all clients
// Improved distribution using multiple hash operations
function seededRandom(seed: number): number {
  // Use a better hash function for better distribution
  let hash = seed;
  hash = ((hash << 5) - hash) + seed;
  hash = hash & hash; // Convert to 32bit integer
  hash = Math.abs(hash);
  // Combine with sine for additional variation
  const sine = Math.sin(seed) * 10000;
  const combined = (hash + sine) % 1;
  return Math.abs(combined);
}

// Get deterministic random value for villager movement based on ID and cycle
// Each villager gets unique seeds based on their ID hash
function getVillagerRandom(villagerId: string, cycle: number, index: number): number {
  // Create a unique seed for each villager by hashing their ID
  let idHash = 0;
  for (let i = 0; i < villagerId.length; i++) {
    idHash = ((idHash << 5) - idHash) + villagerId.charCodeAt(i);
    idHash = idHash & idHash; // Convert to 32bit integer
  }
  // Combine ID hash with cycle and index for unique seeds
  const seed = Math.abs(idHash) + (cycle * 1000) + (index * 100);
  return seededRandom(seed);
}

// Track centurion NPCs
const centurionNPCs: CenturionNPC[] = [];
let centurionsInitialized = false;
// Track last update time for each centurion (for throttling off-screen updates)
const centurionLastUpdateTime: Map<string, number> = new Map();

// Initialize villager NPCs around the plaza
function initializeVillagers(): void {
  if (villagersInitialized) return;
  
  // Plaza center in scaled pixels
  const centerXScaled = WORLD_WIDTH / 2;
  const centerYScaled = WORLD_HEIGHT / 2;
  const plazaRadiusScaled = 540 * SCALE;
  // Villagers wander INSIDE the plaza, between inner ring (away from fountain) and outer ring (away from NPC stalls)
  const minRadiusScaled = 200 * SCALE; // Minimum distance from center (away from fountain area)
  const maxRadiusScaled = 450 * SCALE; // Maximum distance from center (inside plaza, before NPC stalls at ~378 * SCALE)
  
  const villagerCount = 6; // Number of villagers
  
  // Fixed initial positions and assignments for determinism (same for all clients)
  const villagerConfigs = [
    { angle: 0.1, distance: 0.4, outfitIndex: 0, nameIndex: 0, speed: 0.35 }, // Farmer Tom
    { angle: 1.2, distance: 0.6, outfitIndex: 1, nameIndex: 1, speed: 0.4 }, // Blacksmith Bill
    { angle: 2.3, distance: 0.5, outfitIndex: 2, nameIndex: 2, speed: 0.3 }, // Baker Sarah
    { angle: 3.4, distance: 0.55, outfitIndex: 3, nameIndex: 3, speed: 0.38 }, // Merchant Joe
    { angle: 4.5, distance: 0.45, outfitIndex: 4, nameIndex: 4, speed: 0.32 }, // Guard Mike
    { angle: 5.6, distance: 0.5, outfitIndex: 5, nameIndex: 5, speed: 0.36 }, // Scholar Anne
  ];
  
  for (let i = 0; i < villagerCount; i++) {
    const config = villagerConfigs[i];
    // Fixed angle around plaza (deterministic)
    const angle = config.angle;
    // Fixed distance from center (deterministic, normalized 0-1 between min and max)
    const distanceScaled = minRadiusScaled + config.distance * (maxRadiusScaled - minRadiusScaled);
    
    // Calculate position in scaled pixels, then convert to unscaled (tile coordinates)
    const xScaled = centerXScaled + Math.cos(angle) * distanceScaled;
    const yScaled = centerYScaled + Math.sin(angle) * distanceScaled;
    const x = xScaled / SCALE; // Convert to unscaled coordinates
    const y = yScaled / SCALE; // Convert to unscaled coordinates
    
    const villagerData = VILLAGER_OUTFITS[config.outfitIndex];
    const name = VILLAGER_NAMES[config.nameIndex];
    
    villagerNPCs.push({
      id: `villager_${i}`,
      name,
      x,
      y,
      targetX: x,
      targetY: y,
      direction: 'down',
      outfit: villagerData.outfit,
      speed: config.speed, // Fixed speed
      changeDirectionTime: Date.now() + 2000 + (i * 500), // Staggered but deterministic
      profession: villagerData.profession,
      movementCycle: 0, // Start at cycle 0
    });
  }
  
  villagersInitialized = true;
}

// Initialize centurion NPCs at flag positions
function initializeCenturions(): void {
  if (centurionsInitialized) return;
  
  // Plaza center in scaled pixels
  const centerXScaled = WORLD_WIDTH / 2;
  const centerYScaled = WORLD_HEIGHT / 2;
  const plazaRadiusScaled = 540 * SCALE;
  const flagRadiusScaled = plazaRadiusScaled + 15 * SCALE; // Just outside plaza edge (where flags are)
  const flagCount = 8;
  
  // Centurion outfit (armor/guard themed)
  const centurionOutfit = ['hat_knight', 'armor_knight', 'legs_knight'];
  const centurionNames = ['Marcus', 'Valerius', 'Titus', 'Lucius', 
                          'Decimus', 'Quintus', 'Sextus', 'Septimus'];
  
  for (let i = 0; i < flagCount; i++) {
    const angle = (i / flagCount) * Math.PI * 2;
    // Position centurion at flag position (convert to unscaled)
    const xScaled = centerXScaled + Math.cos(angle) * flagRadiusScaled;
    const yScaled = centerYScaled + Math.sin(angle) * flagRadiusScaled;
    const x = xScaled / SCALE;
    const y = yScaled / SCALE;
    
    // Calculate top cylinder Y position (elevated above base)
    // Tower structure in drawGuardTower (all in scaled pixels where p = SCALE):
    //   - Base at y (scaled)
    //   - Mid platform at y - 10 * p = y - 10 * SCALE
    //   - Top cylinder base at midPlatformY - 8 * p = (y - 10 * SCALE) - 8 * SCALE = y - 18 * SCALE
    //   - Top cylinder top at topPlatformY - topCylinderHeight = (y - 18 * SCALE) - 60 * SCALE = y - 78 * SCALE
    // Since y here is in unscaled coordinates, we need: y - 78 (unscaled)
    const topCylinderTopY = y - 78; // Y position of top cylinder surface (where centurion stands) in unscaled coordinates
    
    // Calculate direction to face outward from plaza (same direction as the tower is facing)
    // Angle: 0 = right, π/2 = down, π = left, 3π/2 = up
    // Normalize angle to 0-2π range
    const normalizedAngle = ((angle % (Math.PI * 2)) + (Math.PI * 2)) % (Math.PI * 2);
    
    // Determine primary direction based on angle
    // Use 45-degree boundaries for diagonal directions
    let direction: Direction;
    if (normalizedAngle >= Math.PI * 7/4 || normalizedAngle < Math.PI * 1/4) {
      direction = 'right'; // 0° to 45° and 315° to 360°
    } else if (normalizedAngle >= Math.PI * 1/4 && normalizedAngle < Math.PI * 3/4) {
      direction = 'down'; // 45° to 135°
    } else if (normalizedAngle >= Math.PI * 3/4 && normalizedAngle < Math.PI * 5/4) {
      direction = 'left'; // 135° to 225°
    } else {
      direction = 'up'; // 225° to 315°
    }
    
    const platformRadius = 35; // Top platform radius in unscaled coordinates (matches topRadius in drawGuardTower)
    
    centurionNPCs.push({
      id: `centurion_${i}`,
      name: centurionNames[i],
      x, // X position (tower center)
      y: topCylinderTopY, // Y position (elevated to top of cylinder, high up)
      targetX: x, // Start at center
      targetY: topCylinderTopY, // Start at center
      direction, // Face outward from plaza (looking out over the forest)
      outfit: centurionOutfit,
      flagIndex: i,
      speed: 0.2, // Slow wandering speed
      changeDirectionTime: Date.now() + 3000 + (i * 500), // Staggered start times
      movementCycle: 0, // Start at cycle 0
      towerCenterX: x, // Store tower center for constraint
      towerCenterY: topCylinderTopY, // Store tower center for constraint
      platformRadius: platformRadius, // Store platform radius for constraint
    });
  }
  
  centurionsInitialized = true;
}

// Get profession-specific speech message about orbs
function getNPCProfessionMessage(profession: string): string {
  const messages: Record<string, string[]> = {
    'Farmer': [
      'Orbs help me buy better seeds!',
      'I trade orbs for farming tools.',
      'More orbs means better harvests!',
      'Orbs keep my farm running!'
    ],
    'Blacksmith': [
      'Orbs fuel my forge!',
      'I craft with orb-powered tools.',
      'Orbs make my work shine!',
      'Quality work costs orbs!'
    ],
    'Baker': [
      'Orbs buy the finest flour!',
      'My bread is worth every orb!',
      'Orbs keep my ovens hot!',
      'Fresh bread for orbs!'
    ],
    'Merchant': [
      'Orbs are my currency!',
      'I trade goods for orbs.',
      'Orbs make the world go round!',
      'Best deals for orbs!'
    ],
    'Guard': [
      'Orbs fund our protection!',
      'I keep the plaza safe for orbs.',
      'Orbs pay for our armor!',
      'Security costs orbs!'
    ],
    'Scholar': [
      'Orbs fund my research!',
      'Knowledge costs orbs!',
      'I study the power of orbs!',
      'Orbs unlock ancient secrets!'
    ],
    'Carpenter': [
      'Orbs buy the best wood!',
      'I build with orb-earned materials.',
      'Orbs craft quality structures!',
      'Fine carpentry needs orbs!'
    ],
    'Herbalist': [
      'Orbs grow rare herbs!',
      'I trade potions for orbs.',
      'Orbs power my alchemy!',
      'Magic herbs cost orbs!'
    ],
    'Centurion': [
      'I guard the plaza for orbs!',
      'Orbs fund our defense!',
      'I protect orb collectors!',
      'Orbs keep us vigilant!'
    ],
  };
  
  const professionMessages = messages[profession] || ['Orbs are useful!'];
  return professionMessages[Math.floor(Math.random() * professionMessages.length)];
}

// Handle NPC click - show speech bubble
export function handleNPCClick(npcId: string, profession: string): void {
  const message = getNPCProfessionMessage(profession);
  npcInteractionBubbles.set(npcId, {
    text: message,
    createdAt: Date.now(),
  });
}

// Get clicked NPC (villager or centurion)
export function getClickedNPC(worldX: number, worldY: number): { id: string; profession: string } | null {
  const p = SCALE;
  const clickRadius = 25 * p; // Click detection radius
  
  // Check villagers
  for (const villager of villagerNPCs) {
    const dx = (worldX * SCALE) - (villager.x * SCALE);
    const dy = (worldY * SCALE) - (villager.y * SCALE);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < clickRadius) {
      return { id: villager.id, profession: villager.profession };
    }
  }
  
  // Check centurions
  for (const centurion of centurionNPCs) {
    const dx = (worldX * SCALE) - (centurion.x * SCALE);
    const dy = (worldY * SCALE) - (centurion.y * SCALE);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < clickRadius) {
      return { id: centurion.id, profession: 'Centurion' };
    }
  }
  
  return null;
}

// Update and draw centurions (returns array of player objects to be drawn with other players)
export function getCenturionPlayers(): PlayerWithChat[] {
  initializeCenturions();
  
  return centurionNPCs.map(centurion => ({
    id: centurion.id,
    name: centurion.name,
    x: centurion.x,
    y: centurion.y,
    direction: centurion.direction,
    orbs: 0,
    roomId: '',
    sprite: {
      body: 'default',
      outfit: centurion.outfit,
    },
  }));
}

// Update wandering villagers (returns array of player objects to be drawn with other players)
export function updateVillagers(time: number, deltaTime: number, camera?: Camera): PlayerWithChat[] {
  initializeVillagers();
  
  // Plaza center in scaled pixels
  const centerXScaled = WORLD_WIDTH / 2;
  const centerYScaled = WORLD_HEIGHT / 2;
  const plazaRadiusScaled = 540 * SCALE;
  // Villagers wander INSIDE the plaza, between inner ring (away from fountain) and outer ring (away from NPC stalls)
  const minRadiusScaled = 200 * SCALE; // Minimum distance from center (away from fountain area)
  const maxRadiusScaled = 450 * SCALE; // Maximum distance from center (inside plaza, before NPC stalls at ~378 * SCALE)
  
  const villagerPlayers: PlayerWithChat[] = [];
  
  for (const villager of villagerNPCs) {
    // Update movement
    if (time >= villager.changeDirectionTime) {
      // Pick deterministic target around plaza (inside the plaza area)
      // Use villager's movement cycle to generate consistent random values across all clients
      // Each villager follows a deterministic pattern based on their cycle number
      // Use different seed indices to ensure angle and distance are independent
      const angleSeed = villager.movementCycle * 2;
      const distanceSeed = villager.movementCycle * 2 + 1;
      const angle = getVillagerRandom(villager.id, angleSeed, 0) * Math.PI * 2;
      const distanceScaled = minRadiusScaled + getVillagerRandom(villager.id, distanceSeed, 1) * (maxRadiusScaled - minRadiusScaled);
      
      // Calculate target in scaled pixels, then convert to unscaled
      const targetXScaled = centerXScaled + Math.cos(angle) * distanceScaled;
      const targetYScaled = centerYScaled + Math.sin(angle) * distanceScaled;
      villager.targetX = targetXScaled / SCALE; // Convert to unscaled coordinates
      villager.targetY = targetYScaled / SCALE; // Convert to unscaled coordinates
      
      // Increment cycle for next movement
      villager.movementCycle++;
      
      // Deterministic change direction time (fixed interval per villager)
      // Stagger intervals more to prevent all villagers changing direction at once
      const baseInterval = 5000; // Fixed 5 second interval
      const villagerIndex = parseInt(villager.id.replace('villager_', ''));
      const intervalOffset = (villagerIndex * 800); // Stagger by 800ms per villager (more spread)
      villager.changeDirectionTime = time + baseInterval + intervalOffset;
    }
    
    // Move towards target
    const dx = villager.targetX - villager.x;
    const dy = villager.targetY - villager.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > 2) {
      const moveX = (dx / distance) * villager.speed * (deltaTime / 16);
      const moveY = (dy / distance) * villager.speed * (deltaTime / 16);
      
      villager.x += moveX;
      villager.y += moveY;
      
      // Determine direction
      if (Math.abs(dx) > Math.abs(dy)) {
        villager.direction = dx > 0 ? 'right' : 'left';
      } else {
        villager.direction = dy > 0 ? 'down' : 'up';
      }
    } else {
      // Reached target, pick new one
      villager.changeDirectionTime = time;
    }
    
    // Create player object for rendering
    const villagerPlayer: PlayerWithChat = {
      id: villager.id,
      name: villager.name,
      x: villager.x,
      y: villager.y,
      direction: villager.direction,
      orbs: 0,
      roomId: '',
      sprite: {
        body: 'default',
        outfit: villager.outfit,
      },
      // Add speech bubble if clicked
      chatBubble: (() => {
        const bubble = npcInteractionBubbles.get(villager.id);
        const now = Date.now();
        if (bubble && now - bubble.createdAt < NPC_SPEECH_DURATION) {
          return {
            text: bubble.text,
            createdAt: bubble.createdAt,
          };
        }
        // Clean up expired bubbles
        if (bubble && now - bubble.createdAt >= NPC_SPEECH_DURATION) {
          npcInteractionBubbles.delete(villager.id);
        }
        return undefined;
      })(),
    };
    
    villagerPlayers.push(villagerPlayer);
  }
  
  return villagerPlayers;
}

// Update centurion wandering and speech bubbles
export function updateCenturionPlayers(time: number, deltaTime: number = 16, camera?: Camera): PlayerWithChat[] {
  initializeCenturions();
  
  const centurionPlayers: PlayerWithChat[] = [];
  
  // Calculate viewport bounds for distance checking
  let viewportWidth = Infinity;
  let viewportCenterX = 0;
  let viewportCenterY = 0;
  if (camera) {
    viewportWidth = CANVAS_WIDTH / camera.zoom;
    const viewportHeight = CANVAS_HEIGHT / camera.zoom;
    viewportCenterX = (camera.x + viewportWidth / 2) / SCALE;
    viewportCenterY = (camera.y + viewportHeight / 2) / SCALE;
  }
  
  for (const centurion of centurionNPCs) {
    // Performance optimization: throttle updates for off-screen NPCs
    if (camera) {
      const centurionWorldX = centurion.x;
      const centurionWorldY = centurion.y;
      const isVisibleNPC = isVisible(camera, centurionWorldX, centurionWorldY, GAME_CONSTANTS.PLAYER_WIDTH, GAME_CONSTANTS.PLAYER_HEIGHT);
      
      // Check distance from viewport center
      const dx = centurionWorldX - viewportCenterX;
      const dy = centurionWorldY - viewportCenterY;
      const distanceFromViewport = Math.sqrt(dx * dx + dy * dy);
      const viewportDistanceThreshold = (viewportWidth / SCALE) * 2; // 2x viewport width
      
      // Skip updates entirely if NPC is far from viewport
      if (distanceFromViewport > viewportDistanceThreshold) {
        // Still return the NPC for rendering (it might be visible from a different angle)
        // But don't update its position
        const lastUpdate = centurionLastUpdateTime.get(centurion.id) || time;
        centurionLastUpdateTime.set(centurion.id, lastUpdate);
        
        // Create player object with current position (no update)
        const centurionPlayer: PlayerWithChat = {
          id: centurion.id,
          name: centurion.name,
          x: centurion.x,
          y: centurion.y,
          direction: centurion.direction,
          orbs: 0,
          roomId: '',
          sprite: {
            body: 'default',
            outfit: centurion.outfit,
          },
          chatBubble: (() => {
            const bubble = npcInteractionBubbles.get(centurion.id);
            const now = Date.now();
            if (bubble && now - bubble.createdAt < NPC_SPEECH_DURATION) {
              return {
                text: bubble.text,
                createdAt: bubble.createdAt,
              };
            }
            if (bubble && now - bubble.createdAt >= NPC_SPEECH_DURATION) {
              npcInteractionBubbles.delete(centurion.id);
            }
            return undefined;
          })(),
        };
        centurionPlayers.push(centurionPlayer);
        continue;
      }
      
      // For off-screen but nearby NPCs, throttle updates to every 500ms
      if (!isVisibleNPC) {
        const lastUpdate = centurionLastUpdateTime.get(centurion.id) || 0;
        const timeSinceLastUpdate = time - lastUpdate;
        if (timeSinceLastUpdate < 500) {
          // Skip update this frame
          const centurionPlayer: PlayerWithChat = {
            id: centurion.id,
            name: centurion.name,
            x: centurion.x,
            y: centurion.y,
            direction: centurion.direction,
            orbs: 0,
            roomId: '',
            sprite: {
              body: 'default',
              outfit: centurion.outfit,
            },
            chatBubble: (() => {
              const bubble = npcInteractionBubbles.get(centurion.id);
              const now = Date.now();
              if (bubble && now - bubble.createdAt < NPC_SPEECH_DURATION) {
                return {
                  text: bubble.text,
                  createdAt: bubble.createdAt,
                };
              }
              if (bubble && now - bubble.createdAt >= NPC_SPEECH_DURATION) {
                npcInteractionBubbles.delete(centurion.id);
              }
              return undefined;
            })(),
          };
          centurionPlayers.push(centurionPlayer);
          continue;
        }
      }
      
      // Update last update time
      centurionLastUpdateTime.set(centurion.id, time);
    }
    // Update wandering movement
    if (time >= centurion.changeDirectionTime) {
      // Pick deterministic target within the top platform circle
      // Use centurion's movement cycle to generate consistent random values across all clients
      const angleSeed = centurion.movementCycle * 2;
      const distanceSeed = centurion.movementCycle * 2 + 1;
      
      // Random angle around the platform
      const angle = getVillagerRandom(centurion.id, angleSeed, 0) * Math.PI * 2;
      
      // Random distance from center (within platform radius, but not too close to edge)
      // Use 0.2 to 0.6 of platform radius to keep them well within the platform bounds
      const maxDistance = centurion.platformRadius * 0.6;
      const minDistance = centurion.platformRadius * 0.2;
      const distance = minDistance + getVillagerRandom(centurion.id, distanceSeed, 1) * (maxDistance - minDistance);
      
      // Calculate target position within the platform circle
      centurion.targetX = centurion.towerCenterX + Math.cos(angle) * distance;
      centurion.targetY = centurion.towerCenterY + Math.sin(angle) * distance;
      
      // Increment cycle for next movement
      centurion.movementCycle++;
      
      // Deterministic change direction time (fixed interval per centurion)
      const baseInterval = 4000; // 4 second interval
      const centurionIndex = parseInt(centurion.id.replace('centurion_', ''));
      const intervalOffset = (centurionIndex * 400); // Stagger by 400ms per centurion
      centurion.changeDirectionTime = time + baseInterval + intervalOffset;
    }
    
    // Move towards target
    const dx = centurion.targetX - centurion.x;
    const dy = centurion.targetY - centurion.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > 1) {
      const moveX = (dx / distance) * centurion.speed * (deltaTime / 16);
      const moveY = (dy / distance) * centurion.speed * (deltaTime / 16);
      
      const newX = centurion.x + moveX;
      const newY = centurion.y + moveY;
      
      // Constrain to platform circle (with a safety margin to prevent going over edge)
      const distFromCenter = Math.sqrt(
        Math.pow(newX - centurion.towerCenterX, 2) + 
        Math.pow(newY - centurion.towerCenterY, 2)
      );
      
      // Use 0.7 of platform radius as max to ensure they stay well within bounds
      const maxAllowedDistance = centurion.platformRadius * 0.7;
      
      if (distFromCenter <= maxAllowedDistance) {
        centurion.x = newX;
        centurion.y = newY;
      } else {
        // Hit edge, pick new target
        centurion.changeDirectionTime = time;
      }
      
      // Determine direction
      if (Math.abs(dx) > Math.abs(dy)) {
        centurion.direction = dx > 0 ? 'right' : 'left';
      } else {
        centurion.direction = dy > 0 ? 'down' : 'up';
      }
    } else {
      // Reached target, pick new one
      centurion.changeDirectionTime = time;
    }
    
    // Create player object for rendering
    const centurionPlayer: PlayerWithChat = {
      id: centurion.id,
      name: centurion.name,
      x: centurion.x,
      y: centurion.y,
      direction: centurion.direction,
      orbs: 0,
      roomId: '',
      sprite: {
        body: 'default',
        outfit: centurion.outfit,
      },
      // Add speech bubble if clicked
      chatBubble: (() => {
        const bubble = npcInteractionBubbles.get(centurion.id);
        const now = Date.now();
        if (bubble && now - bubble.createdAt < NPC_SPEECH_DURATION) {
          return {
            text: bubble.text,
            createdAt: bubble.createdAt,
          };
        }
        // Clean up expired bubbles
        if (bubble && now - bubble.createdAt >= NPC_SPEECH_DURATION) {
          npcInteractionBubbles.delete(centurion.id);
        }
        return undefined;
      })(),
    };
    
    centurionPlayers.push(centurionPlayer);
  }
  
  return centurionPlayers;
}

// ============ SHOP ITEMS FOR RARITY LOOKUP ============
let cachedShopItems: ShopItem[] = [];

export function setShopItems(items: ShopItem[]): void {
  cachedShopItems = items;
  updateCheapestPrices();
}

function getItemRarity(itemId: string): ItemRarity | null {
  const item = cachedShopItems.find(i => i.id === itemId);
  return item?.rarity || null;
}

// Cache for cheapest prices per rarity
let cheapestPricesByRarity: Record<ItemRarity, number> = {
  common: Infinity,
  uncommon: Infinity,
  rare: Infinity,
  epic: Infinity,
  legendary: Infinity,
  godlike: Infinity,
};

// Update cheapest prices when shop items change
export function updateCheapestPrices(): void {
  cheapestPricesByRarity = {
    common: Infinity,
    uncommon: Infinity,
    rare: Infinity,
    epic: Infinity,
    legendary: Infinity,
    godlike: Infinity,
  };
  
  for (const item of cachedShopItems) {
    if (item.price < cheapestPricesByRarity[item.rarity]) {
      cheapestPricesByRarity[item.rarity] = item.price;
    }
  }
}

// Get the orb count color based on what the player can afford
export function getOrbCountColor(orbs: number): { color: string; glow: string | null } {
  // Fallback thresholds if shop items aren't loaded yet (for background NPCs, etc.)
  const FALLBACK_THRESHOLDS = {
    legendary: 250000,  // 250k
    epic: 50000,        // 50k
    rare: 20000,        // 20k
    uncommon: 5000,     // 5k
    common: 1000,       // 1k
  };
  
  // Use shop prices if available, otherwise use fallback thresholds
  // Gold color always requires 250k minimum
  const thresholds = {
    legendary: Math.max(250000, cheapestPricesByRarity.legendary !== Infinity ? cheapestPricesByRarity.legendary : FALLBACK_THRESHOLDS.legendary),
    epic: cheapestPricesByRarity.epic !== Infinity ? cheapestPricesByRarity.epic : FALLBACK_THRESHOLDS.epic,
    rare: cheapestPricesByRarity.rare !== Infinity ? cheapestPricesByRarity.rare : FALLBACK_THRESHOLDS.rare,
    uncommon: cheapestPricesByRarity.uncommon !== Infinity ? cheapestPricesByRarity.uncommon : FALLBACK_THRESHOLDS.uncommon,
    common: cheapestPricesByRarity.common !== Infinity ? cheapestPricesByRarity.common : FALLBACK_THRESHOLDS.common,
  };
  
  // Check from highest to lowest rarity
  // 10 million threshold - red color (highest tier)
  if (orbs >= 10000000) {
    return { color: '#ef4444', glow: '#ef4444' }; // Red with glow
  }
  if (orbs >= thresholds.legendary) {
    return { color: '#fbbf24', glow: '#fbbf24' }; // Gold with glow
  }
  if (orbs >= thresholds.epic) {
    return { color: '#a855f7', glow: '#a855f7' }; // Purple with glow
  }
  if (orbs >= thresholds.rare) {
    return { color: '#3b82f6', glow: '#3b82f6' }; // Blue with glow
  }
  if (orbs >= thresholds.uncommon) {
    return { color: '#22c55e', glow: null }; // Green, no glow
  }
  if (orbs >= thresholds.common) {
    return { color: '#ffffff', glow: null }; // White, no glow
  }
  return { color: '#6b7280', glow: null }; // Gray (can't afford anything)
}

// Rarity glow colors (matching RARITY_COLORS from types but for canvas)
const RARITY_GLOW_COLORS: Record<ItemRarity, { color: string; blur: number; alpha: number }> = {
  common: { color: '#9ca3af', blur: 0, alpha: 0 }, // No glow
  uncommon: { color: '#22c55e', blur: 0, alpha: 0 }, // No glow
  rare: { color: '#3b82f6', blur: 8, alpha: 0.7 },
  epic: { color: '#a855f7', blur: 12, alpha: 0.8 },
  legendary: { color: '#fbbf24', blur: 18, alpha: 1.0 }, // Bright golden glow
  godlike: { color: '#ef4444', blur: 25, alpha: 1.2 }, // Intense red glow for godlike
};

function applyRarityGlow(ctx: CanvasRenderingContext2D, itemId: string): boolean {
  const rarity = getItemRarity(itemId);
  // No glow for common or uncommon items
  if (!rarity || rarity === 'common' || rarity === 'uncommon') {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    return false;
  }
  
  const glow = RARITY_GLOW_COLORS[rarity];
  // Safety check: if glow is undefined, don't apply it
  if (!glow) {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    return false;
  }
  
  ctx.shadowColor = glow.color;
  ctx.shadowBlur = glow.blur * SCALE;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  return true;
}

function clearGlow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

// ============ LEGENDARY ITEM ANIMATIONS ============

interface LegendaryParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  type: 'sparkle' | 'flame' | 'ice' | 'star' | 'void' | 'rainbow' | 'godlike_beam' | 'godlike_ring' | 'godlike_circle' | 'godlike_wave' | 'godlike_wing_beam' | 'godlike_orb' | 'godlike_pulse' | 'godlike_trail' | 'godlike_hat_wisp' | 'godlike_shirt_burst' | 'godlike_legs_ground' | 'godlike_cape_flow' | 'godlike_boost_energy' | 'godlike_pet_sparkle' | 'godlike_floor_span';
  // Additional data for godlike effects
  angle?: number;
  radius?: number;
  phase?: number;
  set?: 'void' | 'chaos' | 'abyss';
}

// Per-player legendary particles
const legendaryParticles: Map<string, LegendaryParticle[]> = new Map();

// Legendary item configurations - calm, gentle effects
const LEGENDARY_EFFECTS: Record<string, {
  type: 'sparkle' | 'flame' | 'ice' | 'star' | 'void' | 'rainbow' | 'godlike_beam' | 'godlike_ring' | 'godlike_circle' | 'godlike_wave' | 'godlike_wing_beam' | 'godlike_orb' | 'godlike_pulse' | 'godlike_trail' | 'godlike_hat_wisp' | 'godlike_shirt_burst' | 'godlike_legs_ground' | 'godlike_cape_flow' | 'godlike_boost_energy' | 'godlike_pet_sparkle';
  colors: string[];
  spawnRate: number;
  particleCount: number;
  set?: 'void' | 'chaos' | 'abyss';
}> = {
  // === GOLDEN SET - gold sparkles ===
  'hat_golden': { type: 'sparkle', colors: ['#ffd700', '#ffec8b', '#fff8dc', '#f0e68c'], spawnRate: 0.015, particleCount: 1 },
  'armor_golden': { type: 'sparkle', colors: ['#ffd700', '#ffec8b', '#fff8dc', '#f0e68c'], spawnRate: 0.015, particleCount: 1 },
  'legs_gold': { type: 'sparkle', colors: ['#ffd700', '#ffec8b', '#fff8dc', '#f0e68c'], spawnRate: 0.015, particleCount: 1 },

  // === PHOENIX SET - rising embers ===
  'hat_phoenix_legendary': { type: 'flame', colors: ['#ff4500', '#ff6600', '#ffd700', '#ffff00'], spawnRate: 0.02, particleCount: 1 },
  'robe_phoenix_legendary': { type: 'flame', colors: ['#ff4500', '#ff6600', '#ffd700', '#ffff00'], spawnRate: 0.02, particleCount: 1 },
  'legs_phoenix_legendary': { type: 'flame', colors: ['#ff4500', '#ff6600', '#ffd700', '#ffff00'], spawnRate: 0.015, particleCount: 1 },
  'cape_phoenix': { type: 'flame', colors: ['#ff4500', '#ff6600', '#ffd700', '#ffff00'], spawnRate: 0.02, particleCount: 1 },

  // === VOID SET - dark swirling particles ===
  'hat_void': { type: 'void', colors: ['#4b0082', '#800080', '#9400d3', '#000000'], spawnRate: 0.015, particleCount: 1 },
  'armor_void': { type: 'void', colors: ['#4b0082', '#800080', '#9400d3', '#000000'], spawnRate: 0.02, particleCount: 1 },
  'legs_void': { type: 'void', colors: ['#4b0082', '#800080', '#9400d3', '#000000'], spawnRate: 0.015, particleCount: 1 },
  'cape_void': { type: 'void', colors: ['#4b0082', '#800080', '#9400d3', '#000000'], spawnRate: 0.02, particleCount: 1 },

  // === CELESTIAL SET - twinkling stars ===
  'hat_celestial': { type: 'star', colors: ['#ffffff', '#fffacd', '#f0f8ff', '#e6e6fa'], spawnRate: 0.015, particleCount: 1 },
  'robe_celestial': { type: 'star', colors: ['#ffffff', '#fffacd', '#f0f8ff', '#e6e6fa'], spawnRate: 0.015, particleCount: 1 },
  'legs_celestial': { type: 'star', colors: ['#ffffff', '#fffacd', '#f0f8ff', '#e6e6fa'], spawnRate: 0.015, particleCount: 1 },
  'cape_celestial': { type: 'star', colors: ['#ffffff', '#fffacd', '#f0f8ff', '#e6e6fa'], spawnRate: 0.015, particleCount: 1 },

  // === GALAXY SET - cosmic sparkles ===
  'hat_galaxy': { type: 'star', colors: ['#ffffff', '#9400d3', '#4169e1', '#00ced1', '#ff69b4'], spawnRate: 0.015, particleCount: 1 },
  'armor_galaxy': { type: 'star', colors: ['#ffffff', '#9400d3', '#4169e1', '#00ced1', '#ff69b4'], spawnRate: 0.02, particleCount: 1 },
  'legs_galaxy': { type: 'star', colors: ['#ffffff', '#9400d3', '#4169e1', '#00ced1', '#ff69b4'], spawnRate: 0.015, particleCount: 1 },
  'cape_galaxy': { type: 'star', colors: ['#ffffff', '#9400d3', '#4169e1', '#00ced1', '#ff69b4'], spawnRate: 0.02, particleCount: 1 },

  // === RAINBOW/PRISMATIC SET - color cycling ===
  'hat_rainbow': { type: 'rainbow', colors: ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#8b00ff'], spawnRate: 0.02, particleCount: 1 },
  'robe_rainbow': { type: 'rainbow', colors: ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#8b00ff'], spawnRate: 0.02, particleCount: 1 },
  'legs_rainbow': { type: 'rainbow', colors: ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#8b00ff'], spawnRate: 0.015, particleCount: 1 },
  'cape_rainbow': { type: 'rainbow', colors: ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#8b00ff'], spawnRate: 0.02, particleCount: 1 },

  // === ACCESSORIES ===
  // Dragon Wings - ember/fire particles
  'acc_wings_dragon': { type: 'flame', colors: ['#ff4500', '#ff6600', '#ff8c00', '#ffd700'], spawnRate: 0.02, particleCount: 1 },

  // Fire Aura - gentle flames
  'acc_aura_fire': { type: 'flame', colors: ['#ff0000', '#ff4500', '#ff6600', '#ffcc00'], spawnRate: 0.025, particleCount: 1 },

  // Ice Aura - gentle frost
  'acc_aura_ice': { type: 'ice', colors: ['#00ffff', '#87ceeb', '#b0e0e6', '#ffffff'], spawnRate: 0.02, particleCount: 1 },

  // Legendary Set Auras
  'acc_aura_golden': { type: 'sparkle', colors: ['#ffd700', '#ffec8b', '#fff8dc', '#f0e68c'], spawnRate: 0.02, particleCount: 1 },
  'acc_aura_phoenix': { type: 'flame', colors: ['#ff4500', '#ff6600', '#ffd700', '#ffff00'], spawnRate: 0.025, particleCount: 1 },
  'acc_aura_void': { type: 'void', colors: ['#4b0082', '#800080', '#9400d3', '#000000'], spawnRate: 0.02, particleCount: 1 },
  'acc_aura_celestial': { type: 'star', colors: ['#ffffff', '#fffacd', '#f0f8ff', '#e6e6fa'], spawnRate: 0.02, particleCount: 1 },
  'acc_aura_galaxy': { type: 'star', colors: ['#ffffff', '#9400d3', '#4169e1', '#00ced1', '#ff69b4'], spawnRate: 0.02, particleCount: 1 },
  'acc_aura_rainbow': { type: 'rainbow', colors: ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#8b00ff'], spawnRate: 0.025, particleCount: 1 },

  // Legendary Set Wings
  'acc_wings_golden': { type: 'sparkle', colors: ['#ffd700', '#ffec8b', '#fff8dc', '#f0e68c'], spawnRate: 0.02, particleCount: 1 },
  'acc_wings_phoenix': { type: 'flame', colors: ['#ff4500', '#ff6600', '#ffd700', '#ffff00'], spawnRate: 0.02, particleCount: 1 },
  'acc_wings_void': { type: 'void', colors: ['#4b0082', '#800080', '#9400d3', '#000000'], spawnRate: 0.02, particleCount: 1 },
  'acc_wings_celestial': { type: 'star', colors: ['#ffffff', '#fffacd', '#f0f8ff', '#e6e6fa'], spawnRate: 0.02, particleCount: 1 },
  'acc_wings_galaxy': { type: 'star', colors: ['#ffffff', '#9400d3', '#4169e1', '#00ced1', '#ff69b4'], spawnRate: 0.02, particleCount: 1 },
  'acc_wings_rainbow': { type: 'rainbow', colors: ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#8b00ff'], spawnRate: 0.02, particleCount: 1 },
  
  // === GODLIKE ITEMS (unique effects for each cosmetic type) ===
  // Hats - Energy wisps shooting upward from head
  'hat_godlike_void': { type: 'godlike_hat_wisp', colors: ['#ffffff', '#4b0082', '#800080', '#000000'], spawnRate: 0.025, particleCount: 1, set: 'void' },
  'hat_godlike_chaos': { type: 'godlike_hat_wisp', colors: ['#00ffff', '#0080ff', '#00bfff', '#0066cc'], spawnRate: 0.025, particleCount: 1, set: 'chaos' },
  'hat_godlike_abyss': { type: 'godlike_hat_wisp', colors: ['#1a0033', '#4b0082', '#000000', '#6a0dad'], spawnRate: 0.025, particleCount: 1, set: 'abyss' },
  // Shirts - Energy bursts from chest, firing outward
  'shirt_godlike_void': { type: 'godlike_shirt_burst', colors: ['#ffffff', '#4b0082', '#800080', '#000000'], spawnRate: 0.03, particleCount: 1, set: 'void' },
  'shirt_godlike_chaos': { type: 'godlike_shirt_burst', colors: ['#00ffff', '#0080ff', '#00bfff', '#0066cc'], spawnRate: 0.03, particleCount: 1, set: 'chaos' },
  'shirt_godlike_abyss': { type: 'godlike_shirt_burst', colors: ['#1a0033', '#4b0082', '#000000', '#6a0dad'], spawnRate: 0.03, particleCount: 1, set: 'abyss' },
  // Legs - Ground energy particles rising from feet
  'legs_godlike_void': { type: 'godlike_legs_ground', colors: ['#ffffff', '#4b0082', '#800080', '#000000'], spawnRate: 0.028, particleCount: 1, set: 'void' },
  'legs_godlike_chaos': { type: 'godlike_legs_ground', colors: ['#00ffff', '#0080ff', '#00bfff', '#0066cc'], spawnRate: 0.028, particleCount: 1, set: 'chaos' },
  'legs_godlike_abyss': { type: 'godlike_legs_ground', colors: ['#1a0033', '#4b0082', '#000000', '#6a0dad'], spawnRate: 0.028, particleCount: 1, set: 'abyss' },
  // Capes - Flowing energy from behind
  'cape_godlike_void': { type: 'godlike_cape_flow', colors: ['#ffffff', '#4b0082', '#800080', '#000000'], spawnRate: 0.03, particleCount: 1, set: 'void' },
  'cape_godlike_chaos': { type: 'godlike_cape_flow', colors: ['#00ffff', '#0080ff', '#00bfff', '#0066cc'], spawnRate: 0.03, particleCount: 1, set: 'chaos' },
  'cape_godlike_abyss': { type: 'godlike_cape_flow', colors: ['#1a0033', '#4b0082', '#000000', '#6a0dad'], spawnRate: 0.03, particleCount: 1, set: 'abyss' },
  // Wings - Horizontal beams from wing tips (2 particles to spawn from both sides simultaneously)
  'acc_wings_godlike_void': { type: 'godlike_wing_beam', colors: ['#ffffff', '#4b0082', '#800080', '#000000'], spawnRate: 0.022, particleCount: 2, set: 'void' },
  'acc_wings_godlike_chaos': { type: 'godlike_wing_beam', colors: ['#00ffff', '#0080ff', '#00bfff', '#0066cc'], spawnRate: 0.022, particleCount: 2, set: 'chaos' },
  'acc_wings_godlike_abyss': { type: 'godlike_wing_beam', colors: ['#1a0033', '#4b0082', '#000000', '#6a0dad'], spawnRate: 0.022, particleCount: 2, set: 'abyss' },
  // Accessories - Rotating energy orbs (already good)
  'acc_godlike_void': { type: 'godlike_orb', colors: ['#ffffff', '#4b0082', '#800080', '#000000'], spawnRate: 0.027, particleCount: 1, set: 'void' },
  'acc_godlike_chaos': { type: 'godlike_orb', colors: ['#00ffff', '#0080ff', '#00bfff', '#0066cc'], spawnRate: 0.027, particleCount: 1, set: 'chaos' },
  'acc_godlike_abyss': { type: 'godlike_orb', colors: ['#1a0033', '#4b0082', '#000000', '#6a0dad'], spawnRate: 0.027, particleCount: 1, set: 'abyss' },
  // Boosts - Energetic bursts
  'boost_godlike_void': { type: 'godlike_boost_energy', colors: ['#ffffff', '#4b0082', '#800080', '#000000'], spawnRate: 0.03, particleCount: 1, set: 'void' },
  'boost_godlike_chaos': { type: 'godlike_boost_energy', colors: ['#00ffff', '#0080ff', '#00bfff', '#0066cc'], spawnRate: 0.03, particleCount: 1, set: 'chaos' },
  'boost_godlike_abyss': { type: 'godlike_boost_energy', colors: ['#1a0033', '#4b0082', '#000000', '#6a0dad'], spawnRate: 0.03, particleCount: 1, set: 'abyss' },
  // Pets - Sparkling trail following pet
  'pet_godlike_void': { type: 'godlike_pet_sparkle', colors: ['#ffffff', '#4b0082', '#800080', '#000000'], spawnRate: 0.04, particleCount: 1, set: 'void' },
  'pet_godlike_chaos': { type: 'godlike_pet_sparkle', colors: ['#00ffff', '#0080ff', '#00bfff', '#0066cc'], spawnRate: 0.04, particleCount: 1, set: 'chaos' },
  'pet_godlike_abyss': { type: 'godlike_pet_sparkle', colors: ['#1a0033', '#4b0082', '#000000', '#6a0dad'], spawnRate: 0.04, particleCount: 1, set: 'abyss' },
};

function spawnLegendaryParticles(playerId: string, x: number, y: number, outfit: string[], time: number): void {
  if (!legendaryParticles.has(playerId)) {
    legendaryParticles.set(playerId, []);
  }
  
  const particles = legendaryParticles.get(playerId)!;
  
  // Check each legendary item in outfit
  for (const itemId of outfit) {
    const effect = LEGENDARY_EFFECTS[itemId];
    if (!effect) continue;
    
    // Random spawn based on rate
    if (Math.random() > effect.spawnRate) continue;
    
    for (let i = 0; i < effect.particleCount; i++) {
      const color = effect.colors[Math.floor(Math.random() * effect.colors.length)];
      
      let particle: LegendaryParticle;
      let baseX: number;
      let baseY: number;
      
      // Determine spawn position based on item type - ALWAYS to the sides, never in front of face
      
      // Wings - spawn from top of each wing (left and right)
      if (itemId.includes('wings') || itemId === 'acc_wings_dragon' || 
          itemId === 'acc_wings_golden' || itemId === 'acc_wings_phoenix' || 
          itemId === 'acc_wings_void' || itemId === 'acc_wings_celestial' || 
          itemId === 'acc_wings_galaxy' || itemId === 'acc_wings_rainbow' ||
          itemId === 'acc_wings_godlike_void' || itemId === 'acc_wings_godlike_chaos' || 
          itemId === 'acc_wings_godlike_abyss') {
        const side = (i % 2 === 0) ? -1 : 1;
        baseX = x + side * 28 + (Math.random() - 0.5) * 5; // Wing tips far to the sides
        baseY = y - 20 + (Math.random() - 0.5) * 8; // Top of wings
      }
      // Hats - spawn above head, well outside player body
      else if (itemId.startsWith('hat_')) {
        const angle = (Math.random() - 0.5) * Math.PI * 0.4; // Slight spread, mostly upward
        const radius = 45 + Math.random() * 10; // 45-55 pixels from center
        baseX = x + Math.sin(angle) * radius;
        baseY = y - 50 - Math.random() * 10; // Well above head
      }
      // Shirts/Armor/Robes - spawn around chest level, well outside player body
      else if (itemId.startsWith('armor_') || itemId.startsWith('robe_')) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 50 + Math.random() * 15; // 50-65 pixels from center - well outside body
        baseX = x + Math.cos(angle) * radius;
        baseY = y + Math.sin(angle) * radius * 0.5;
      }
      // Legs - spawn below feet, well outside player body
      else if (itemId.startsWith('legs_')) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 45 + Math.random() * 15; // 45-60 pixels from center
        baseX = x + Math.cos(angle) * radius;
        baseY = y + 40 + Math.random() * 10; // Below feet
      }
      // Capes - spawn behind player, well outside body
      else if (itemId.startsWith('cape_')) {
        const angle = Math.PI + (Math.random() - 0.5) * Math.PI * 0.6; // Behind player with spread
        const radius = 50 + Math.random() * 15; // 50-65 pixels from center
        baseX = x + Math.cos(angle) * radius;
        baseY = y + Math.sin(angle) * radius * 0.5;
      }
      // Auras - spawn in all directions, well outside player body
      else if (itemId.includes('aura')) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 40 + Math.random() * 15; // 40-55 pixels from center - well outside body
        baseX = x + Math.cos(angle) * radius;
        baseY = y + Math.sin(angle) * radius * 0.5;
      }
      // Godlike accessories - spawn in all directions, well outside player body
      else if (itemId.startsWith('acc_godlike_')) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 40 + Math.random() * 15; // 40-55 pixels from center - well outside body
        baseX = x + Math.cos(angle) * radius;
        baseY = y + Math.sin(angle) * radius * 0.5;
      }
      // Godlike boosts - spawn in all directions, well outside player body
      else if (itemId.startsWith('boost_godlike_')) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 40 + Math.random() * 15; // 40-55 pixels from center - well outside body
        baseX = x + Math.cos(angle) * radius;
        baseY = y + Math.sin(angle) * radius * 0.5;
      }
      // Godlike pets - spawn in all directions, well outside player body
      else if (itemId.startsWith('pet_godlike_')) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 40 + Math.random() * 15; // 40-55 pixels from center - well outside body
        baseX = x + Math.cos(angle) * radius;
        baseY = y + Math.sin(angle) * radius * 0.5;
      }
      // Default - spawn in all directions, well outside player body
      else {
        const angle = Math.random() * Math.PI * 2;
        const radius = 40 + Math.random() * 15; // 40-55 pixels from center - well outside body
        baseX = x + Math.cos(angle) * radius;
        baseY = y + Math.sin(angle) * radius * 0.5;
      }
      
      // Slow, gentle upward velocity for all particles
      const gentleUpSpeed = -0.3 - Math.random() * 0.2; // Slow rise
      const gentleSideSpeed = (Math.random() - 0.5) * 0.15; // Very slight horizontal drift
      
      switch (effect.type) {
        case 'sparkle':
          // Calculate direction from player center to spawn position (outward)
          const sparkleDirX = baseX - x;
          const sparkleDirY = (baseY - y) * 2;
          const sparkleDist = Math.sqrt(sparkleDirX * sparkleDirX + sparkleDirY * sparkleDirY);
          const sparkleDirNormX = sparkleDist > 0 ? sparkleDirX / sparkleDist : 0;
          const sparkleDirNormY = sparkleDist > 0 ? sparkleDirY / sparkleDist : 0;
          particle = {
            x: baseX,
            y: baseY,
            vx: sparkleDirNormX * 0.2, // Fire outward from player
            vy: sparkleDirNormY * 0.2 - 0.2, // Outward with slight upward bias
            life: 1,
            maxLife: 1,
            size: Math.random() * 2 + 1.5,
            color,
            type: 'sparkle'
          };
          break;
          
        case 'flame':
          // Calculate direction from player center to spawn position (outward)
          const flameDirX = baseX - x;
          const flameDirY = (baseY - y) * 2;
          const flameDist = Math.sqrt(flameDirX * flameDirX + flameDirY * flameDirY);
          const flameDirNormX = flameDist > 0 ? flameDirX / flameDist : 0;
          const flameDirNormY = flameDist > 0 ? flameDirY / flameDist : 0;
          particle = {
            x: baseX,
            y: baseY,
            vx: flameDirNormX * 0.25, // Fire outward from player
            vy: flameDirNormY * 0.25 - 0.3, // Outward with upward bias
            life: 1,
            maxLife: 1,
            size: Math.random() * 3 + 2,
            color,
            type: 'flame'
          };
          break;
          
        case 'ice':
          // Calculate direction from player center to spawn position (outward)
          const iceDirX = baseX - x;
          const iceDirY = (baseY - y) * 2;
          const iceDist = Math.sqrt(iceDirX * iceDirX + iceDirY * iceDirY);
          const iceDirNormX = iceDist > 0 ? iceDirX / iceDist : 0;
          const iceDirNormY = iceDist > 0 ? iceDirY / iceDist : 0;
          particle = {
            x: baseX,
            y: baseY,
            vx: iceDirNormX * 0.2, // Fire outward from player
            vy: iceDirNormY * 0.2 - 0.15, // Outward with slight upward bias
            life: 1,
            maxLife: 1,
            size: Math.random() * 2 + 1.5,
            color,
            type: 'ice'
          };
          break;
          
        case 'star':
          // Calculate direction from player center to spawn position (outward)
          const starDirX = baseX - x;
          const starDirY = (baseY - y) * 2;
          const starDist = Math.sqrt(starDirX * starDirX + starDirY * starDirY);
          const starDirNormX = starDist > 0 ? starDirX / starDist : 0;
          const starDirNormY = starDist > 0 ? starDirY / starDist : 0;
          particle = {
            x: baseX,
            y: baseY,
            vx: starDirNormX * 0.15, // Fire outward from player
            vy: starDirNormY * 0.15 - 0.1, // Outward with slight upward bias
            life: 1,
            maxLife: 1,
            size: Math.random() * 1.5 + 1,
            color,
            type: 'star'
          };
          break;
          
        case 'void':
          // Void particle balls - fire outward from spawn position
          const isGodlike = itemId.includes('godlike');
          // Calculate direction from player center to spawn position (outward)
          const voidDirX = baseX - x;
          const voidDirY = (baseY - y) * 2; // Account for perspective
          const voidDist = Math.sqrt(voidDirX * voidDirX + voidDirY * voidDirY);
          const voidDirNormX = voidDist > 0 ? voidDirX / voidDist : 0;
          const voidDirNormY = voidDist > 0 ? voidDirY / voidDist : 0;
          const voidSpeed = isGodlike ? 0.4 : 0.15;
          particle = {
            x: baseX,
            y: baseY,
            vx: voidDirNormX * voidSpeed, // Fire outward from player
            vy: voidDirNormY * voidSpeed - (isGodlike ? 0.4 : 0.2), // Outward with upward bias
            life: 1,
            maxLife: 1,
            size: isGodlike ? Math.random() * 4 + 3 : Math.random() * 2 + 1.5, // Larger for godlike
            color,
            type: 'void'
          };
          break;
          
        case 'godlike_beam':
          // Beam shooting upward from hat - fire outward from spawn position
          // Calculate direction from player center to spawn position (outward)
          const beamDirX = baseX - x;
          const beamDirY = (baseY - y) * 2; // Account for perspective
          const beamDist = Math.sqrt(beamDirX * beamDirX + beamDirY * beamDirY);
          const beamDirNormX = beamDist > 0 ? beamDirX / beamDist : 0;
          const beamDirNormY = beamDist > 0 ? beamDirY / beamDist : 0;
          // Beam angle points outward from player
          const beamAngle = Math.atan2(beamDirNormY, beamDirNormX) - Math.PI / 2; // Upward bias
          particle = {
            x: baseX,
            y: baseY,
            vx: beamDirNormX * 0.1, // Small outward component
            vy: -1.2 - Math.random() * 0.6, // Strong upward movement
            life: 1,
            maxLife: 1,
            size: Math.random() * 3 + 4,
            color,
            type: 'godlike_beam',
            angle: beamAngle,
            set: effect.set
          };
          break;
          
        case 'godlike_ring':
          // Particle ball (NO CIRCLES) - fire outward from spawn position
          // Calculate direction from player center to spawn position (outward)
          const ringDirX = baseX - x;
          const ringDirY = (baseY - y) * 2; // Account for perspective
          const ringDist = Math.sqrt(ringDirX * ringDirX + ringDirY * ringDirY);
          const ringDirNormX = ringDist > 0 ? ringDirX / ringDist : 0;
          const ringDirNormY = ringDist > 0 ? ringDirY / ringDist : 0;
          particle = {
            x: baseX,
            y: baseY,
            vx: ringDirNormX * 0.4, // Fire outward from player
            vy: ringDirNormY * 0.4 - 0.3, // Outward with upward bias
            life: 1,
            maxLife: 1,
            size: Math.random() * 3 + 4, // Particle ball size
            color,
            type: 'godlike_ring',
            set: effect.set
          };
          break;
          
        case 'godlike_wave':
          // Energy wave - fire outward from spawn position
          const waveAngle = Math.random() * Math.PI * 2;
          // Calculate direction from player center to spawn position (outward)
          const waveDirX = baseX - x;
          const waveDirY = (baseY - y) * 2; // Account for perspective
          const waveDist = Math.sqrt(waveDirX * waveDirX + waveDirY * waveDirY);
          const waveDirNormX = waveDist > 0 ? waveDirX / waveDist : 0;
          const waveDirNormY = waveDist > 0 ? waveDirY / waveDist : 0;
          particle = {
            x: baseX,
            y: baseY,
            vx: waveDirNormX * 0.4, // Fire outward from player
            vy: waveDirNormY * 0.4 - 0.3, // Outward with upward bias
            life: 1,
            maxLife: 1,
            size: Math.random() * 3 + 4,
            color,
            type: 'godlike_wave',
            angle: waveAngle,
            phase: Math.random(),
            set: effect.set
          };
          break;
          
        case 'godlike_wing_beam':
          // Beam from wing tips - shoots horizontally left and right
          // Determine direction based on spawn position relative to player center
          const isLeftSide = baseX < x; // If spawn X is less than player X, it's on the left
          const wingBeamAngle = isLeftSide ? Math.PI : 0; // Left (π) or Right (0)
          particle = {
            x: baseX,
            y: baseY,
            vx: Math.cos(wingBeamAngle) * 0.4,
            vy: 0, // No vertical movement, purely horizontal
            life: 1,
            maxLife: 1,
            size: Math.random() * 2 + 5,
            color,
            type: 'godlike_wing_beam',
            angle: wingBeamAngle,
            set: effect.set
          };
          break;
          
        case 'godlike_orb':
          // Rotating energy orb around accessory
          const orbAngle = (time * 0.001 + i * Math.PI / 2) % (Math.PI * 2);
          const orbRadius = 25 + Math.random() * 10;
          particle = {
            x: baseX + Math.cos(orbAngle) * orbRadius,
            y: baseY + Math.sin(orbAngle) * orbRadius * 0.5,
            vx: -Math.sin(orbAngle) * 0.15,
            vy: Math.cos(orbAngle) * 0.15 * 0.5,
            life: 1,
            maxLife: 1,
            size: Math.random() * 2 + 4,
            color,
            type: 'godlike_orb',
            angle: orbAngle,
            radius: orbRadius,
            set: effect.set
          };
          break;
          
        case 'godlike_pulse':
          // Pulsing energy - fire outward from spawn position
          // Calculate direction from player center to spawn position (outward)
          const pulseDirX = baseX - x;
          const pulseDirY = (baseY - y) * 2; // Account for perspective
          const pulseDist = Math.sqrt(pulseDirX * pulseDirX + pulseDirY * pulseDirY);
          const pulseDirNormX = pulseDist > 0 ? pulseDirX / pulseDist : 0;
          const pulseDirNormY = pulseDist > 0 ? pulseDirY / pulseDist : 0;
          particle = {
            x: baseX,
            y: baseY,
            vx: pulseDirNormX * 0.3, // Fire outward from player
            vy: pulseDirNormY * 0.3 - 0.4, // Outward with upward bias
            life: 1,
            maxLife: 1,
            size: Math.random() * 5 + 8,
            color,
            type: 'godlike_pulse',
            phase: Math.random(),
            set: effect.set
          };
          break;
          
        case 'godlike_trail':
          // Following trail - fire outward from spawn position
          // Calculate direction from player center to spawn position (outward)
          const trailDirX = baseX - x;
          const trailDirY = (baseY - y) * 2; // Account for perspective
          const trailDist = Math.sqrt(trailDirX * trailDirX + trailDirY * trailDirY);
          const trailDirNormX = trailDist > 0 ? trailDirX / trailDist : 0;
          const trailDirNormY = trailDist > 0 ? trailDirY / trailDist : 0;
          particle = {
            x: baseX,
            y: baseY,
            vx: trailDirNormX * 0.25, // Fire outward from player
            vy: trailDirNormY * 0.25 - 0.3, // Outward with upward bias
            life: 1,
            maxLife: 1,
            size: Math.random() * 2 + 3,
            color,
            type: 'godlike_trail',
            phase: Math.random(),
            set: effect.set
          };
          break;
          
        case 'godlike_hat_wisp':
          // Energy wisps from hat - shoot upward and outward
          const wispAngle = (Math.random() - 0.5) * Math.PI * 0.6; // Slight spread, mostly upward
          particle = {
            x: baseX + (Math.random() - 0.5) * 8,
            y: baseY,
            vx: Math.sin(wispAngle) * 0.2,
            vy: Math.cos(wispAngle) * -1.0 - Math.random() * 0.5, // Strong upward with slight spread
            life: 1,
            maxLife: 1,
            size: Math.random() * 2 + 3,
            color,
            type: 'godlike_hat_wisp',
            angle: wispAngle,
            set: effect.set
          };
          break;
          
        case 'godlike_shirt_burst':
          // Energy bursts from chest - fire outward in all directions
          const burstAngle = Math.random() * Math.PI * 2;
          const burstSpeed = 0.4 + Math.random() * 0.3;
          particle = {
            x: baseX,
            y: baseY,
            vx: Math.cos(burstAngle) * burstSpeed,
            vy: Math.sin(burstAngle) * burstSpeed * 0.5 - 0.2, // Outward with slight upward bias
            life: 1,
            maxLife: 1,
            size: Math.random() * 3 + 4,
            color,
            type: 'godlike_shirt_burst',
            angle: burstAngle,
            set: effect.set
          };
          break;
          
        case 'godlike_legs_ground':
          // Ground energy particles - rise from feet area, fire outward
          const groundAngle = Math.random() * Math.PI * 2;
          const groundSpeed = 0.35 + Math.random() * 0.25;
          particle = {
            x: baseX,
            y: baseY,
            vx: Math.cos(groundAngle) * groundSpeed,
            vy: Math.sin(groundAngle) * groundSpeed * 0.5 - 0.6, // Outward with strong upward
            life: 1,
            maxLife: 1,
            size: Math.random() * 2 + 3,
            color,
            type: 'godlike_legs_ground',
            angle: groundAngle,
            set: effect.set
          };
          break;
          
        case 'godlike_cape_flow':
          // Flowing energy from cape - flows backward and outward
          const flowAngle = Math.PI + (Math.random() - 0.5) * Math.PI * 0.8; // Behind player, with spread
          const flowSpeed = 0.3 + Math.random() * 0.2;
          particle = {
            x: baseX,
            y: baseY,
            vx: Math.cos(flowAngle) * flowSpeed,
            vy: Math.sin(flowAngle) * flowSpeed * 0.5 - 0.3, // Backward and upward
            life: 1,
            maxLife: 1,
            size: Math.random() * 2 + 3,
            color,
            type: 'godlike_cape_flow',
            angle: flowAngle,
            set: effect.set
          };
          break;
          
        case 'godlike_boost_energy':
          // Energetic bursts - fire outward in all directions with energy
          const energyAngle = Math.random() * Math.PI * 2;
          const energySpeed = 0.5 + Math.random() * 0.4;
          particle = {
            x: baseX,
            y: baseY,
            vx: Math.cos(energyAngle) * energySpeed,
            vy: Math.sin(energyAngle) * energySpeed * 0.5 - 0.4, // Fast outward with upward
            life: 1,
            maxLife: 1,
            size: Math.random() * 2 + 4,
            color,
            type: 'godlike_boost_energy',
            angle: energyAngle,
            set: effect.set
          };
          break;
          
        case 'godlike_pet_sparkle':
          // Sparkling trail - follows pet, fires outward
          const sparkleAngle = Math.random() * Math.PI * 2;
          const sparkleSpeed = 0.25 + Math.random() * 0.2;
          particle = {
            x: baseX,
            y: baseY,
            vx: Math.cos(sparkleAngle) * sparkleSpeed,
            vy: Math.sin(sparkleAngle) * sparkleSpeed * 0.5 - 0.2, // Gentle outward
            life: 1,
            maxLife: 1,
            size: Math.random() * 1.5 + 2,
            color,
            type: 'godlike_pet_sparkle',
            angle: sparkleAngle,
            set: effect.set
          };
          break;
          
        case 'rainbow':
        default:
          particle = {
            x: baseX,
            y: baseY,
            vx: gentleSideSpeed,
            vy: gentleUpSpeed,
            life: 1,
            maxLife: 1,
            size: Math.random() * 2 + 1.5,
            color,
            type: 'rainbow'
          };
          break;
      }
      
      particles.push(particle);
    }
  }
  
  // Floor-spanning effect for godlike items (only spawns once if at least 1 godlike piece is equipped)
  const hasGodlike = outfit.some(item => item.includes('godlike'));
  if (hasGodlike && Math.random() < 0.08) { // Spawn rate for floor effect
    // Determine which godlike set to use (void, chaos, or abyss)
    let floorSet: 'void' | 'chaos' | 'abyss' = 'void';
    let floorColors: string[] = ['#ffffff', '#4b0082', '#800080', '#000000'];
    
    // Check which set the player has
    if (outfit.some(item => item.includes('godlike_chaos'))) {
      floorSet = 'chaos';
      floorColors = ['#00ffff', '#0080ff', '#00bfff', '#0066cc'];
    } else if (outfit.some(item => item.includes('godlike_abyss'))) {
      floorSet = 'abyss';
      floorColors = ['#1a0033', '#4b0082', '#000000', '#6a0dad'];
    } else if (outfit.some(item => item.includes('godlike_void'))) {
      floorSet = 'void';
      floorColors = ['#ffffff', '#4b0082', '#800080', '#000000'];
    }
    
    // Spawn floor particles in a circle around the player
    const floorParticleCount = 12; // Particles spanning the floor
    for (let i = 0; i < floorParticleCount; i++) {
      const angle = (i / floorParticleCount) * Math.PI * 2;
      const radius = 70 + Math.random() * 15; // Floor radius around player
      const floorX = x + Math.cos(angle) * radius;
      const floorY = y + 35 + Math.random() * 3; // At ground level (below player feet)
      
      const color = floorColors[Math.floor(Math.random() * floorColors.length)];
      
      particles.push({
        x: floorX,
        y: floorY,
        vx: (Math.random() - 0.5) * 0.05, // Very slow horizontal drift
        vy: -0.05 - Math.random() * 0.05, // Very slow upward drift
        life: 1,
        maxLife: 1,
        size: Math.random() * 4 + 5, // Larger floor particles for visibility
        color,
        type: 'godlike_floor_span',
        set: floorSet,
        angle: angle // Store angle for pulsing effect
      });
    }
  }
  
  // Limit particles per player (increased for godlike to allow beams to fully extend)
  const godlikeCount = outfit.filter(item => item.includes('godlike')).length;
  const maxParticles = godlikeCount > 0 ? 25 + (godlikeCount * 8) : 12; // Higher limit for godlike items
  if (particles.length > maxParticles) {
    // Remove oldest non-beam particles first to preserve beams
    const beamParticles = particles.filter(p => p.type === 'godlike_beam' || p.type === 'godlike_wing_beam' || p.type === 'godlike_hat_wisp');
    const nonBeamParticles = particles.filter(p => p.type !== 'godlike_beam' && p.type !== 'godlike_wing_beam' && p.type !== 'godlike_hat_wisp');
    
    // Keep all beam particles, remove oldest non-beam particles
    if (nonBeamParticles.length > maxParticles - beamParticles.length) {
      const toRemove = nonBeamParticles.length - (maxParticles - beamParticles.length);
      nonBeamParticles.splice(0, toRemove);
    }
    
    // Reconstruct particles array with beams first, then non-beams
    particles.length = 0;
    particles.push(...beamParticles, ...nonBeamParticles);
  }
}

function updateAndDrawLegendaryParticles(ctx: CanvasRenderingContext2D, playerId: string, deltaTime: number, time: number): void {
  const particles = legendaryParticles.get(playerId);
  if (!particles || particles.length === 0) return;
  
  // Slower decay for longer-lasting particles that travel higher
  const decay = deltaTime * 0.0003; // Even slower decay so particles travel further
  
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    
    // Update position (already slow from spawn velocities)
    p.x += p.vx;
    p.y += p.vy;
    p.life -= decay;
    
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    
    // Smooth fade in/out
    const alpha = p.life < 0.3 ? p.life / 0.3 : (p.life > 0.7 ? (1 - p.life) / 0.3 + 0.7 : 0.7);
    
    ctx.save();
    ctx.globalAlpha = Math.min(alpha, 0.8); // Cap alpha for subtlety
    
    switch (p.type) {
      case 'sparkle':
        // Gentle four-pointed star sparkle
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 2; // Reduced for performance
        const sparkleSize = p.size * (0.7 + Math.sin(time * 0.003 + i) * 0.3); // Slower pulse
        drawSparkle(ctx, p.x, p.y, sparkleSize);
        break;
        
      case 'flame':
        // Gentle flame particle
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 3; // Reduced for performance
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.size * 0.5, p.size * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
        
      case 'ice':
        // Ice crystal (hexagonal)
        ctx.fillStyle = p.color;
        ctx.shadowColor = '#00ffff';
        ctx.shadowBlur = 2; // Reduced for performance
        drawHexagon(ctx, p.x, p.y, p.size * 0.8);
        break;
        
      case 'star':
        // Gentle twinkling star
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 2; // Reduced for performance
        const twinkle = Math.sin(time * 0.004 + i * 2) * 0.3 + 0.7; // Slower, subtler twinkle
        ctx.globalAlpha = alpha * twinkle * 0.8;
        drawStar(ctx, p.x, p.y, p.size, 4);
        break;
        
      case 'void':
        // Dark particle ball - fires outward for godlike items (NO CIRCLES)
        const isGodlikeParticle = p.size > 2.5; // Godlike particles are larger
        ctx.fillStyle = p.color;
        ctx.shadowColor = isGodlikeParticle ? '#ef4444' : '#4b0082'; // Red glow for godlike
        ctx.shadowBlur = isGodlikeParticle ? 8 : 3; // Reduced for performance
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.8, 0, Math.PI * 2); // Just a particle ball, no circles
        ctx.fill();
        break;
        
      case 'godlike_beam':
        // Beam shooting upward - large, bright beam
        const beamLength = 300 + p.life * 150; // Even longer beams that extend higher
        const beamWidth = p.size;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10; // Reduced for performance
        ctx.lineWidth = beamWidth;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        const beamAngle = p.angle || -Math.PI / 2;
        ctx.lineTo(p.x + Math.cos(beamAngle) * beamLength, p.y + Math.sin(beamAngle) * beamLength);
        ctx.stroke();
        // Add glow at base
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, beamWidth * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
        
      case 'godlike_ring':
        // Particle ball (NO CIRCLES) - fire outward
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8; // Reduced for performance
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); // Just a particle ball, not a ring
        ctx.fill();
        ctx.restore();
        break;
        
      case 'godlike_circle':
        // Particle ball (NO CIRCLES) - fire outward
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8; // Reduced for performance
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); // Just a particle ball, not a circle
        ctx.fill();
        ctx.restore();
        break;
        
      case 'godlike_wave':
        // Particle ball (NO CIRCLES) - fire outward
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8; // Reduced for performance
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); // Just a particle ball, not a wave ring
        ctx.fill();
        ctx.restore();
        break;
        
      case 'godlike_wing_beam':
        // Beam from wing tips - extend far horizontally
        const wingBeamLength = 200 + (1 - p.life) * 100; // Longer horizontal beams
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10; // Reduced for performance
        ctx.lineWidth = p.size;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        const wingBeamAngle = p.angle || 0;
        ctx.lineTo(p.x + Math.cos(wingBeamAngle) * wingBeamLength, p.y + Math.sin(wingBeamAngle) * wingBeamLength);
        ctx.stroke();
        // Glow at origin
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
        
      case 'godlike_orb':
        // Rotating energy orb
        const orbPhase = ((p.phase || 0) + time * 0.002) % 1;
        const orbSize = p.size * (0.9 + Math.sin(orbPhase * Math.PI * 2) * 0.1);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8; // Reduced for performance
        ctx.beginPath();
        ctx.arc(p.x, p.y, orbSize, 0, Math.PI * 2);
        ctx.fill();
        // Rotating trail (reduced from 3 to 2 for performance)
        ctx.globalAlpha = alpha * 0.5;
        const trailAngle = (p.angle || 0) + time * 0.003;
        for (let j = 0; j < 2; j++) {
          const trailOffset = (j - 0.5) * Math.PI / 2;
          const trailX = p.x + Math.cos(trailAngle + trailOffset) * orbSize * 1.5;
          const trailY = p.y + Math.sin(trailAngle + trailOffset) * orbSize * 1.5;
          ctx.beginPath();
          ctx.arc(trailX, trailY, orbSize * 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        break;
        
      case 'godlike_pulse':
        // Pulsing particle ball (NO CIRCLES)
        const godlikePulsePhase = ((p.phase || 0) + time * 0.008) % 1;
        const godlikePulseSize = p.size * (1 + Math.sin(godlikePulsePhase * Math.PI * 2) * 0.4);
        ctx.save();
        ctx.globalAlpha = alpha * (0.7 + Math.sin(godlikePulsePhase * Math.PI * 2) * 0.3);
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10; // Reduced for performance
        ctx.beginPath();
        ctx.arc(p.x, p.y, godlikePulseSize, 0, Math.PI * 2); // Just a pulsing particle ball, no rings
        ctx.fill();
        ctx.restore();
        break;
        
      case 'godlike_trail':
        // Following trail particles
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6; // Reduced for performance
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        // Small trailing particles (reduced from 2 to 1 for performance)
        ctx.globalAlpha = alpha * 0.6;
        const trailTrailX = p.x - p.vx * 5;
        const trailTrailY = p.y - p.vy * 5;
        ctx.beginPath();
        ctx.arc(trailTrailX, trailTrailY, p.size * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
        
      case 'godlike_hat_wisp':
        // Energy wisp - elongated upward beam
        const wispLength = 120 + (1 - p.life) * 80; // Longer upward wisps
        const wispWidth = p.size * 0.6;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6; // Reduced for performance
        ctx.lineWidth = wispWidth;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        const wispAngle = p.angle || -Math.PI / 2;
        ctx.lineTo(p.x + Math.cos(wispAngle) * wispLength, p.y + Math.sin(wispAngle) * wispLength);
        ctx.stroke();
        // Glow at base
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, wispWidth * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
        
      case 'godlike_shirt_burst':
        // Energy burst - particle ball with trail
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8; // Reduced for performance
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        // Burst trail (reduced from 2 to 1 for performance)
        const burstTrailAge = 0.4;
        const burstTrailX = p.x - p.vx * burstTrailAge * 15;
        const burstTrailY = p.y - p.vy * burstTrailAge * 15;
        ctx.globalAlpha = alpha * (1 - burstTrailAge) * 0.5;
        ctx.beginPath();
        ctx.arc(burstTrailX, burstTrailY, p.size * (1 - burstTrailAge * 0.5), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
        
      case 'godlike_legs_ground':
        // Ground energy - particle ball rising from ground
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6; // Reduced for performance
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        // Upward trail (reduced from 2 to 1 for performance)
        const groundTrailAge = 0.3;
        const groundTrailX = p.x;
        const groundTrailY = p.y - Math.abs(p.vy) * groundTrailAge * 12;
        ctx.globalAlpha = alpha * (1 - groundTrailAge) * 0.4;
        ctx.beginPath();
        ctx.arc(groundTrailX, groundTrailY, p.size * (1 - groundTrailAge * 0.3), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
        
      case 'godlike_cape_flow':
        // Flowing energy - elongated particle flowing backward
        const flowLength = 40 + (1 - p.life) * 30;
        const flowWidth = p.size * 0.7;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6; // Reduced for performance
        ctx.lineWidth = flowWidth;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        const flowAngle = p.angle || Math.PI;
        ctx.lineTo(p.x + Math.cos(flowAngle) * flowLength, p.y + Math.sin(flowAngle) * flowLength * 0.5);
        ctx.stroke();
        // Glow at origin
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, flowWidth * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
        
      case 'godlike_boost_energy':
        // Energetic burst - bright particle with energy trail
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8; // Reduced for performance
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        // Energy trail (reduced from 3 to 1 for performance)
        const boostTrailAge = 0.25;
        const boostTrailX = p.x - p.vx * boostTrailAge * 18;
        const boostTrailY = p.y - p.vy * boostTrailAge * 18;
        ctx.globalAlpha = alpha * (1 - boostTrailAge) * 0.6;
        ctx.beginPath();
        ctx.arc(boostTrailX, boostTrailY, p.size * (1 - boostTrailAge * 0.4), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
        
      case 'godlike_pet_sparkle':
        // Sparkling trail - small sparkles
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 4; // Reduced for performance
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        // Sparkle effect
        const sparkleTwinkle = Math.sin(time * 0.01 + i) * 0.3 + 0.7;
        ctx.globalAlpha = alpha * sparkleTwinkle;
        drawSparkle(ctx, p.x, p.y, p.size * 1.2);
        ctx.restore();
        break;
        
      case 'godlike_floor_span':
        // Floor-spanning effect - particles that span the floor around the player
        ctx.save();
        ctx.globalAlpha = alpha * 0.8; // Visible floor effect
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 15; // Strong glow for floor particles
        // Draw main particle as a glowing orb on the floor
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        // Draw a subtle pulsing effect
        const floorPulsePhase = (time * 0.002 + (p.angle || 0)) % (Math.PI * 2);
        const floorPulseSize = p.size * (1 + Math.sin(floorPulsePhase) * 0.2);
        ctx.globalAlpha = alpha * 0.4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, floorPulseSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
        
      case 'rainbow':
        // Slow color-shifting particle
        const hue = (time * 0.02 + i * 30) % 360; // Much slower color shift
        ctx.fillStyle = `hsl(${hue}, 80%, 60%)`;
        ctx.shadowColor = `hsl(${hue}, 80%, 50%)`;
        ctx.shadowBlur = 5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.8, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
    
    ctx.restore();
  }
}

function drawSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI / 2);
    const outerX = x + Math.cos(angle) * size;
    const outerY = y + Math.sin(angle) * size;
    const innerAngle = angle + Math.PI / 4;
    const innerX = x + Math.cos(innerAngle) * size * 0.3;
    const innerY = y + Math.sin(innerAngle) * size * 0.3;
    
    if (i === 0) {
      ctx.moveTo(outerX, outerY);
    } else {
      ctx.lineTo(outerX, outerY);
    }
    ctx.lineTo(innerX, innerY);
  }
  ctx.closePath();
  ctx.fill();
}

function drawHexagon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI / 3) - Math.PI / 6;
    const px = x + Math.cos(angle) * size;
    const py = y + Math.sin(angle) * size;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
  ctx.fill();
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, points: number): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const angle = (i * Math.PI / points) - Math.PI / 2;
    const r = i % 2 === 0 ? size : size * 0.4;
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
  ctx.fill();
}

// Clean up particles for disconnected players
export function cleanupLegendaryParticles(activePlayerIds: Set<string>): void {
  for (const playerId of legendaryParticles.keys()) {
    if (!activePlayerIds.has(playerId)) {
      legendaryParticles.delete(playerId);
    }
  }
}

// ============ COLOR PALETTES ============

// Coffee shop palette
const CAFE_COLORS = {
  floorLight: '#d4c8b8',
  floorDark: '#b8a898',
  woodDark: '#4a3728',
  woodMid: '#6b4c35',
  woodLight: '#8b6b4a',
  woodHighlight: '#a8845c',
  counterTop: '#5c4033',
  counterFront: '#3d2b1f',
  counterHighlight: '#7a5a45',
  wallBase: '#e8dcc8',
  wallAccent: '#d4c8b4',
  wallTrim: '#6b5a48',
  tableTop: '#6b4c35',
  chairSeat: '#8b5a3c',
  rugMain: '#8b3a3a',
  rugDark: '#6b2a2a',
  rugLight: '#a84a4a',
  plantGreen: '#5a8a5a',
  plantDark: '#3a6a3a',
  potColor: '#b87333',
};

// Alias for shorthand in cafe drawing functions
const COLORS = CAFE_COLORS;

// Market Square palette (medieval town)
const MARKET_COLORS = {
  // Cobblestone ground
  cobbleLight: '#9a9a8e',
  cobbleMid: '#7a7a6e',
  cobbleDark: '#5a5a4e',
  cobbleAccent: '#6a6a5e',
  // Buildings
  buildingStone: '#8b8378',
  buildingStoneDark: '#6b6358',
  buildingStoneLight: '#aba398',
  buildingWood: '#8b5a2b',
  buildingWoodDark: '#6b4a1b',
  roofTile: '#8b4513',
  roofTileDark: '#6b3503',
  roofTileLight: '#ab5523',
  windowGlass: '#4a6080',
  windowFrame: '#5a4a3a',
  doorWood: '#5a3a1a',
  // Fountain
  fountainStone: '#a0a0a0',
  fountainStoneDark: '#707070',
  fountainWater: '#5dade2',
  fountainWaterLight: '#7dcdf2',
  // Decorations
  flagRed: '#c0392b',
  flagBlue: '#2980b9',
  flagGold: '#f1c40f',
  flagPurple: '#8e44ad',
  flagPole: '#4a4a4a',
  bannerCloth: '#e8d5b7',
  // Market elements
  crateWood: '#a0784a',
  crateWoodDark: '#806038',
  barrelWood: '#8b6914',
  barrelBand: '#4a4a4a',
  awningRed: '#c0392b',
  awningGreen: '#27ae60',
  awningStripe: '#f5e6d3',
};

// Forest palette (mystical woodland)
const FOREST_COLORS = {
  groundDark: '#2d3a1f',
  groundMid: '#3d4a2f',
  groundLight: '#4d5a3f',
  treeTrunk: '#4a3728',
  treeDark: '#1a3320',
  treeMid: '#2d5a3d',
  treeLight: '#3a7a4a',
  mushroom: '#c0392b',
  mushroomSpot: '#f5f5f5',
  moss: '#6b8e23',
  path: '#5a4a3a',
  pathLight: '#6a5a4a',
  fogLight: 'rgba(200, 220, 200, 0.1)',
  water: '#2c5545',
};

// Player colors
const PLAYER_COLORS = {
  skin: '#ffdbac',
  hair: '#4a3728',
  shirt: '#3498db',
  pants: '#2c3e50',
  outline: '#2c2c2c',
};

// ============ TREE DATA FOR COLLISION & LAYERED RENDERING ============
export interface TreeData {
  x: number;           // Base X position (tile coords)
  y: number;           // Base Y position (tile coords)
  canopyX: number;     // Canopy center X (pixel coords)
  canopyY: number;     // Canopy center Y (pixel coords)
  canopyRadius: number;// Canopy radius (pixels)
  trunkX: number;      // Trunk left edge (pixels)
  trunkY: number;      // Trunk top (pixels)
  trunkW: number;      // Trunk width (pixels)
  trunkH: number;      // Trunk height (pixels)
  isLarge: boolean;    // Large tree variant
  scale: number;       // Size scale
}

// Store forest trees for collision and foliage overlay
let forestTrees: TreeData[] = [];

// Reset forest trees (called when background is regenerated)
export function resetForestTrees(): void {
  forestTrees = [];
}

export function getForestTrees(): TreeData[] {
  return forestTrees;
}

// Check if a position collides with any tree trunk
// treeStates: optional map of tree states to check if trees are cut (cut trees have no collision)
export function checkTreeCollision(
  x: number, 
  y: number, 
  width: number, 
  height: number,
  treeStates?: Map<string, { treeId: string; isCut: boolean; cutBy: string | null; respawnAt: number }>
): boolean {
  const p = SCALE;
  const padding = 2 * p; // Small padding around trunks
  
  for (const tree of forestTrees) {
    // Skip collision check if tree is cut (stumps have no collision)
    if (treeStates) {
      const treeId = getTreeId(tree);
      const treeState = treeStates.get(treeId);
      if (treeState?.isCut) {
        continue; // Skip cut trees (stumps have no collision)
      }
    }
    
    // Check rectangular trunk collision
    if (x + width > tree.trunkX + padding &&
        x < tree.trunkX + tree.trunkW - padding &&
        y + height > tree.trunkY + padding &&
        y < tree.trunkY + tree.trunkH - padding) {
      return true;
    }
  }
  return false;
}

// ============ BACKGROUND CACHES ============
const backgroundCaches: Map<MapType, HTMLCanvasElement> = new Map();

// ============ PLAZA RENDERING CACHES ============
// Cache for static fountain structure (tiers, pillars, decorative stones)
let fountainStaticCache: HTMLCanvasElement | null = null;
let fountainStaticCacheInitialized = false;

// Cache for entire static plaza (walls, podiums, flag bunting, fountain structure, etc.)
let plazaStaticCache: HTMLCanvasElement | null = null;
let plazaStaticCacheInitialized = false;

// Cache for plaza wall top (battlements, top surface, etc.)
let plazaWallTopCache: HTMLCanvasElement | null = null;
let plazaWallTopCacheInitialized = false;

// Pre-calculated gate angles and wall segments for drawPlazaWallTop
interface GateSegment {
  gateAngle: number;
  gateStartAngle: number;
  gateEndAngle: number;
  wallStartAngle: number;
  wallEndAngle: number;
}
let precomputedGateSegments: GateSegment[] | null = null;
let precomputedGateRanges: Array<{ start: number; end: number }> | null = null;

function drawCafeBackground(ctx: CanvasRenderingContext2D): void {
  const p = SCALE; // pixel unit
  const tileW = TILE_SIZE * SCALE;
  
  // === FLOOR - Simple checkered pattern (full world) ===
  for (let row = 0; row < MAP_HEIGHT; row++) {
    for (let col = 0; col < MAP_WIDTH; col++) {
      const isLight = (row + col) % 2 === 0;
      ctx.fillStyle = isLight ? COLORS.floorLight : COLORS.floorDark;
      ctx.fillRect(col * tileW, row * tileW, tileW, tileW);
    }
  }
  
  // === BACK WALL (top 3 tile rows, full width) ===
  const wallHeight = 3 * tileW;
  
  // Main wall
  ctx.fillStyle = COLORS.wallBase;
  ctx.fillRect(0, 0, WORLD_WIDTH, wallHeight);
  
  // Wainscoting (lower wood panel)
  ctx.fillStyle = COLORS.woodMid;
  ctx.fillRect(0, wallHeight - 24 * p, WORLD_WIDTH, 24 * p);
  
  // Trim lines
  ctx.fillStyle = COLORS.wallTrim;
  ctx.fillRect(0, wallHeight - 26 * p, WORLD_WIDTH, 2 * p);
  ctx.fillRect(0, wallHeight - 2 * p, WORLD_WIDTH, 2 * p);
  
  // Create multiple cafe "zones" across the large map
  const numZones = Math.ceil(MAP_WIDTH / 20);
  
  for (let zone = 0; zone < numZones; zone++) {
    const zoneOffset = zone * 20 * tileW;
    
    // === COUNTER (below wall) ===
    const counterY = wallHeight;
    const counterH = 36 * p;
    const counterStartX = zoneOffset + 2 * tileW;
    const counterW = 14 * tileW;
    
    // Counter top surface
    ctx.fillStyle = COLORS.counterTop;
    ctx.fillRect(counterStartX, counterY, counterW, 14 * p);
    
    // Counter top highlight
    ctx.fillStyle = COLORS.counterHighlight;
    ctx.fillRect(counterStartX, counterY, counterW, 3 * p);
    
    // Counter front panel
    ctx.fillStyle = COLORS.counterFront;
    ctx.fillRect(counterStartX, counterY + 14 * p, counterW, counterH - 14 * p);
    
    // Counter bottom edge
    ctx.fillStyle = COLORS.woodDark;
    ctx.fillRect(counterStartX, counterY + counterH - 3 * p, counterW, 3 * p);
    
    // Counter side panels
    ctx.fillStyle = COLORS.counterFront;
    ctx.fillRect(counterStartX - 8 * p, counterY, 8 * p, counterH);
    ctx.fillRect(counterStartX + counterW, counterY, 8 * p, counterH);
    
    // === WINDOWS ===
    drawWindow(ctx, zoneOffset + 1 * tileW, 12 * p, 2.5 * tileW, 50 * p);
    drawWindow(ctx, zoneOffset + 14.5 * tileW, 12 * p, 2.5 * tileW, 50 * p);
    
    // === MENU BOARD ===
    if (zone % 2 === 0) {
      drawMenuBoard(ctx, zoneOffset + 6 * tileW, 8 * p, 2.5 * tileW, 55 * p);
    }
    
    // === SHELF ===
    drawShelf(ctx, zoneOffset + 10 * tileW, 20 * p, 2.5 * tileW);
    
    // === BAR STOOLS ===
    const stoolY = counterY + counterH + 8 * p;
    for (let i = 0; i < 6; i++) {
      drawBarStool(ctx, counterStartX + 12 * p + i * 38 * p, stoolY);
    }
    
    // === ITEMS ON COUNTER ===
    drawCoffeeMachine(ctx, counterStartX + 16 * p, counterY - 32 * p);
    drawCashRegister(ctx, counterStartX + counterW - 80 * p, counterY - 24 * p);
    
    // === HANGING LIGHTS ===
    drawHangingLight(ctx, zoneOffset + 5 * tileW);
    drawHangingLight(ctx, zoneOffset + 10 * tileW);
    drawHangingLight(ctx, zoneOffset + 15 * tileW);
    
    // === PICTURE FRAMES ===
    drawPictureFrame(ctx, zoneOffset + 4.2 * tileW, 16 * p, 28 * p, 36 * p);
  }
  
  // === SEATING AREA (scattered throughout) ===
  for (let row = 0; row < Math.floor(MAP_HEIGHT / 15); row++) {
    for (let col = 0; col < Math.floor(MAP_WIDTH / 10); col++) {
      const baseX = col * 10 * tileW;
      const baseY = row * 15 * tileW + 8 * tileW; // Below counter area
      
      // Tables with chairs
      drawTableWithChairs(ctx, baseX + 2 * tileW, baseY + 1 * tileW);
      drawTableWithChairs(ctx, baseX + 7 * tileW, baseY + 1 * tileW);
      
      // Rug
      drawRug(ctx, baseX + 3 * tileW, baseY + 4 * tileW, 4 * tileW, 3 * tileW);
      
      // Couch
      if ((row + col) % 2 === 0) {
        drawCouch(ctx, baseX + 3 * tileW, baseY + 8 * tileW);
      }
      
      // Plants
      drawPottedPlant(ctx, baseX + 0.5 * tileW, baseY + 2 * tileW, 'medium');
      if ((row + col) % 3 === 0) {
        drawPottedPlant(ctx, baseX + 9 * tileW, baseY + 6 * tileW, 'large');
      }
    }
  }
}

function drawWindow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const p = SCALE;
  
  // Frame
  ctx.fillStyle = COLORS.woodDark;
  ctx.fillRect(x, y, w, h);
  
  // Glass
  ctx.fillStyle = '#b8d4e8';
  ctx.fillRect(x + 4 * p, y + 4 * p, w - 8 * p, h - 8 * p);
  
  // Window panes
  ctx.fillStyle = COLORS.woodDark;
  ctx.fillRect(x + w/2 - p, y, 2 * p, h);
  ctx.fillRect(x, y + h/2 - p, w, 2 * p);
  
  // Light reflection
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.fillRect(x + 8 * p, y + 8 * p, 12 * p, 6 * p);
}

function drawMenuBoard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const p = SCALE;
  
  // Board
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(x, y, w, h);
  
  // Frame
  ctx.fillStyle = COLORS.woodMid;
  ctx.lineWidth = 4 * p;
  ctx.strokeStyle = COLORS.woodMid;
  ctx.strokeRect(x, y, w, h);
  
  // Title
  ctx.fillStyle = '#f0e6d0';
  ctx.font = `bold ${10 * p}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('MENU', x + w/2, y + 16 * p);
  
  // Menu lines
  ctx.fillStyle = '#c0b0a0';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(x + 12 * p, y + 26 * p + i * 10 * p, w - 24 * p, 2 * p);
  }
}

function drawShelf(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  const p = SCALE;
  
  // Shelf board
  ctx.fillStyle = COLORS.woodMid;
  ctx.fillRect(x, y, w, 6 * p);
  
  // Brackets
  ctx.fillStyle = COLORS.woodDark;
  ctx.fillRect(x + 8 * p, y + 6 * p, 4 * p, 12 * p);
  ctx.fillRect(x + w - 12 * p, y + 6 * p, 4 * p, 12 * p);
  
  // Items on shelf - jars
  const jarColors = ['#8b6b4a', '#6b8b6a', '#c4a060', '#a07050'];
  jarColors.forEach((color, i) => {
    const jx = x + 10 * p + i * 18 * p;
    const jh = 14 + Math.sin(i) * 4;
    
    ctx.fillStyle = color;
    ctx.fillRect(jx, y - jh * p, 12 * p, jh * p);
    
    // Lid
    ctx.fillStyle = '#d4a060';
    ctx.fillRect(jx - p, y - (jh + 3) * p, 14 * p, 3 * p);
  });
}

function drawBarStool(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const p = SCALE;
  
  // Legs
  ctx.fillStyle = COLORS.woodDark;
  ctx.fillRect(x + 4 * p, y + 10 * p, 3 * p, 22 * p);
  ctx.fillRect(x + 17 * p, y + 10 * p, 3 * p, 22 * p);
  
  // Crossbar
  ctx.fillRect(x + 7 * p, y + 22 * p, 10 * p, 2 * p);
  
  // Seat
  ctx.fillStyle = COLORS.chairSeat;
  ctx.fillRect(x, y, 24 * p, 10 * p);
  
  // Seat highlight
  ctx.fillStyle = COLORS.woodHighlight;
  ctx.fillRect(x + 2 * p, y + 2 * p, 20 * p, 3 * p);
}

function drawCoffeeMachine(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const p = SCALE;
  
  // Main body
  ctx.fillStyle = '#505050';
  ctx.fillRect(x, y, 36 * p, 32 * p);
  
  // Top
  ctx.fillStyle = '#404040';
  ctx.fillRect(x + 4 * p, y - 10 * p, 28 * p, 10 * p);
  
  // Drip area
  ctx.fillStyle = '#303030';
  ctx.fillRect(x + 8 * p, y + 24 * p, 20 * p, 8 * p);
  
  // Buttons
  ctx.fillStyle = '#e04040';
  ctx.fillRect(x + 8 * p, y + 8 * p, 6 * p, 6 * p);
  ctx.fillStyle = '#40c040';
  ctx.fillRect(x + 18 * p, y + 8 * p, 6 * p, 6 * p);
  
  // Steam wand
  ctx.fillStyle = '#c0c0c0';
  ctx.fillRect(x + 28 * p, y + 6 * p, 6 * p, 16 * p);
}

function drawCashRegister(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const p = SCALE;
  
  // Body
  ctx.fillStyle = COLORS.woodMid;
  ctx.fillRect(x, y, 36 * p, 24 * p);
  
  // Screen
  ctx.fillStyle = '#1a2030';
  ctx.fillRect(x + 6 * p, y + 4 * p, 24 * p, 10 * p);
  
  // Screen text
  ctx.fillStyle = '#40ff40';
  ctx.font = `${6 * p}px monospace`;
  ctx.textAlign = 'left';
  ctx.fillText('$0.00', x + 10 * p, y + 12 * p);
  
  // Buttons
  ctx.fillStyle = '#d0d0d0';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(x + 8 * p + i * 6 * p, y + 17 * p, 4 * p, 3 * p);
  }
}

function drawTableWithChairs(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const p = SCALE;
  const tableW = 56 * p;
  const tableH = 40 * p;
  
  // Shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
  ctx.fillRect(x + 4 * p, y + tableH + 16 * p, tableW, 8 * p);
  
  // Chair left
  drawChair(ctx, x - 18 * p, y + 8 * p, 'right');
  
  // Table legs
  ctx.fillStyle = COLORS.woodDark;
  ctx.fillRect(x + 8 * p, y + tableH, 4 * p, 16 * p);
  ctx.fillRect(x + tableW - 12 * p, y + tableH, 4 * p, 16 * p);
  
  // Table top
  ctx.fillStyle = COLORS.tableTop;
  ctx.fillRect(x, y, tableW, tableH);
  
  // Table highlight
  ctx.fillStyle = COLORS.woodHighlight;
  ctx.fillRect(x, y, tableW, 4 * p);
  
  // Table edge
  ctx.fillStyle = COLORS.woodDark;
  ctx.fillRect(x, y + tableH - 4 * p, tableW, 4 * p);
  
  // Items on table
  drawCup(ctx, x + 12 * p, y + 10 * p);
  drawCup(ctx, x + tableW - 24 * p, y + 14 * p);
  
  // Chair right
  drawChair(ctx, x + tableW + 6 * p, y + 8 * p, 'left');
}

function drawLargeTable(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const p = SCALE;
  const tableW = 80 * p;
  const tableH = 52 * p;
  
  // Shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
  ctx.fillRect(x + 4 * p, y + tableH + 16 * p, tableW, 8 * p);
  
  // Table legs
  ctx.fillStyle = COLORS.woodDark;
  ctx.fillRect(x + 12 * p, y + tableH, 4 * p, 18 * p);
  ctx.fillRect(x + tableW - 16 * p, y + tableH, 4 * p, 18 * p);
  
  // Table top
  ctx.fillStyle = COLORS.tableTop;
  ctx.fillRect(x, y, tableW, tableH);
  
  // Table highlight
  ctx.fillStyle = COLORS.woodHighlight;
  ctx.fillRect(x, y, tableW, 4 * p);
  
  // Table edge
  ctx.fillStyle = COLORS.woodDark;
  ctx.fillRect(x, y + tableH - 4 * p, tableW, 4 * p);
}

function drawChair(ctx: CanvasRenderingContext2D, x: number, y: number, facing: 'left' | 'right'): void {
  const p = SCALE;
  
  // Legs
  ctx.fillStyle = COLORS.woodDark;
  ctx.fillRect(x + 3 * p, y + 16 * p, 3 * p, 20 * p);
  ctx.fillRect(x + 14 * p, y + 16 * p, 3 * p, 20 * p);
  
  // Seat
  ctx.fillStyle = COLORS.chairSeat;
  ctx.fillRect(x, y + 8 * p, 20 * p, 10 * p);
  
  // Back
  ctx.fillStyle = COLORS.woodDark;
  const backX = facing === 'right' ? x : x + 16 * p;
  ctx.fillRect(backX, y - 8 * p, 4 * p, 18 * p);
}

function drawCup(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const p = SCALE;
  
  // Cup
  ctx.fillStyle = '#f8f8f8';
  ctx.fillRect(x, y, 14 * p, 12 * p);
  
  // Handle
  ctx.fillRect(x + 14 * p, y + 3 * p, 4 * p, 6 * p);
  ctx.fillStyle = COLORS.tableTop;
  ctx.fillRect(x + 15 * p, y + 5 * p, 2 * p, 2 * p);
  
  // Coffee
  ctx.fillStyle = '#4a3020';
  ctx.fillRect(x + 2 * p, y + 2 * p, 10 * p, 4 * p);
}

function drawRug(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const p = SCALE;
  
  // Main rug
  ctx.fillStyle = COLORS.rugMain;
  ctx.fillRect(x, y, w, h);
  
  // Border
  ctx.fillStyle = COLORS.rugLight;
  ctx.fillRect(x, y, w, 6 * p);
  ctx.fillRect(x, y + h - 6 * p, w, 6 * p);
  ctx.fillRect(x, y, 6 * p, h);
  ctx.fillRect(x + w - 6 * p, y, 6 * p, h);
  
  // Inner border
  ctx.fillStyle = COLORS.rugDark;
  ctx.fillRect(x + 10 * p, y + 10 * p, w - 20 * p, 3 * p);
  ctx.fillRect(x + 10 * p, y + h - 13 * p, w - 20 * p, 3 * p);
  ctx.fillRect(x + 10 * p, y + 10 * p, 3 * p, h - 20 * p);
  ctx.fillRect(x + w - 13 * p, y + 10 * p, 3 * p, h - 20 * p);
  
  // Center medallion
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.fillStyle = COLORS.rugDark;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 28 * p, 18 * p, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.rugLight;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 18 * p, 10 * p, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawCouch(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const p = SCALE;
  
  // Shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
  ctx.fillRect(x + 4 * p, y + 52 * p, 56 * p, 6 * p);
  
  // Back
  ctx.fillStyle = '#5a3a25';
  ctx.fillRect(x, y, 56 * p, 32 * p);
  
  // Seat
  ctx.fillStyle = '#6b4a35';
  ctx.fillRect(x + 4 * p, y + 28 * p, 48 * p, 20 * p);
  
  // Cushions
  ctx.fillStyle = '#7a5a45';
  ctx.fillRect(x + 8 * p, y + 32 * p, 18 * p, 12 * p);
  ctx.fillRect(x + 30 * p, y + 32 * p, 18 * p, 12 * p);
  
  // Armrests
  ctx.fillStyle = '#5a3a25';
  ctx.fillRect(x - 6 * p, y + 12 * p, 10 * p, 38 * p);
  ctx.fillRect(x + 52 * p, y + 12 * p, 10 * p, 38 * p);
}

function drawPottedPlant(ctx: CanvasRenderingContext2D, x: number, y: number, size: 'small' | 'medium' | 'large'): void {
  const p = SCALE;
  const s = size === 'large' ? 1.8 : size === 'medium' ? 1.2 : 0.8;
  
  // Pot
  ctx.fillStyle = COLORS.potColor;
  ctx.fillRect(x + 4 * s * p, y + 20 * s * p, 24 * s * p, 24 * s * p);
  
  // Pot rim
  ctx.fillStyle = '#c88040';
  ctx.fillRect(x + 2 * s * p, y + 18 * s * p, 28 * s * p, 4 * s * p);
  
  // Dirt
  ctx.fillStyle = '#4a3020';
  ctx.fillRect(x + 6 * s * p, y + 20 * s * p, 20 * s * p, 4 * s * p);
  
  // Foliage - simple leaf shapes
  ctx.fillStyle = COLORS.plantGreen;
  const cx = x + 16 * s * p;
  
  if (size === 'large') {
    // Tree-like foliage
    ctx.beginPath();
    ctx.arc(cx, y, 28 * s * p, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.plantDark;
    ctx.beginPath();
    ctx.arc(cx - 8 * s * p, y - 8 * s * p, 16 * s * p, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 10 * s * p, y + 4 * s * p, 12 * s * p, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Smaller plant - upward leaves
    for (let i = -2; i <= 2; i++) {
      ctx.fillStyle = i % 2 === 0 ? COLORS.plantGreen : COLORS.plantDark;
      ctx.save();
      ctx.translate(cx, y + 16 * s * p);
      ctx.rotate(i * 0.3);
      ctx.fillRect(-3 * s * p, -20 * s * p, 6 * s * p, 20 * s * p);
      ctx.beginPath();
      ctx.ellipse(0, -22 * s * p, 6 * s * p, 8 * s * p, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawHangingLight(ctx: CanvasRenderingContext2D, x: number): void {
  const p = SCALE;
  
  // Cord
  ctx.fillStyle = '#303030';
  ctx.fillRect(x + 10 * p, 0, 2 * p, 30 * p);
  
  // Fixture
  ctx.fillStyle = '#404040';
  ctx.fillRect(x + 4 * p, 28 * p, 14 * p, 4 * p);
  
  // Shade
  ctx.fillStyle = '#e8d8c0';
  ctx.beginPath();
  ctx.moveTo(x, 32 * p);
  ctx.lineTo(x + 22 * p, 32 * p);
  ctx.lineTo(x + 18 * p, 50 * p);
  ctx.lineTo(x + 4 * p, 50 * p);
  ctx.closePath();
  ctx.fill();
  
  // Light glow
  const gradient = ctx.createRadialGradient(x + 11 * p, 55 * p, 0, x + 11 * p, 55 * p, 50 * p);
  gradient.addColorStop(0, 'rgba(255, 240, 200, 0.25)');
  gradient.addColorStop(1, 'rgba(255, 240, 200, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x + 11 * p, 55 * p, 50 * p, 0, Math.PI * 2);
  ctx.fill();
}

function drawPictureFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const p = SCALE;
  
  // Frame
  ctx.fillStyle = COLORS.woodMid;
  ctx.fillRect(x, y, w, h);
  
  // Picture
  ctx.fillStyle = '#f0e8d8';
  ctx.fillRect(x + 3 * p, y + 3 * p, w - 6 * p, h - 6 * p);
  
  // Simple art
  ctx.fillStyle = '#c0a080';
  ctx.fillRect(x + w/4, y + h/3, w/2, h/3);
}

// ============ MARKET SQUARE MAP ============

// Helper function to draw a medieval building
function drawMedievalBuilding(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, variant: number): void {
  const p = SCALE;
  
  // Building base colors based on variant
  const stoneColors = [
    { main: MARKET_COLORS.buildingStone, dark: MARKET_COLORS.buildingStoneDark, light: MARKET_COLORS.buildingStoneLight },
    { main: '#9a8a7a', dark: '#7a6a5a', light: '#baa a9a' },
    { main: '#8a7868', dark: '#6a5848', light: '#aa9888' },
  ];
  const colors = stoneColors[variant % stoneColors.length];
  
  // Main building wall
  ctx.fillStyle = colors.main;
  ctx.fillRect(x, y, width, height);
  
  // Stone texture - irregular blocks
  ctx.fillStyle = colors.dark;
  for (let row = 0; row < height / (8 * p); row++) {
    const rowOffset = (row % 2) * 12 * p;
    for (let col = 0; col < width / (24 * p); col++) {
      const blockX = x + col * 24 * p + rowOffset + ((row * col * 7) % 6) * p;
      const blockY = y + row * 8 * p;
      const blockW = 20 * p + ((row + col) % 3) * 2 * p;
      const blockH = 6 * p;
      if (blockX + blockW <= x + width) {
        // Mortar lines
        ctx.fillRect(blockX, blockY + blockH, blockW, 2 * p);
        ctx.fillRect(blockX + blockW - 2 * p, blockY, 2 * p, blockH);
      }
    }
  }
  
  // Highlight stones
  ctx.fillStyle = colors.light;
  for (let i = 0; i < 5; i++) {
    const hx = x + ((i * 17 + variant * 7) % Math.floor(width / p - 10)) * p;
    const hy = y + ((i * 13 + variant * 5) % Math.floor(height / p - 8)) * p;
    ctx.fillRect(hx, hy, 8 * p, 4 * p);
  }
  
  // Wooden beam details (half-timbered style)
  if (variant % 2 === 0) {
    ctx.fillStyle = MARKET_COLORS.buildingWood;
    // Vertical beams
    ctx.fillRect(x, y, 4 * p, height);
    ctx.fillRect(x + width - 4 * p, y, 4 * p, height);
    ctx.fillRect(x + width / 2 - 2 * p, y, 4 * p, height);
    // Horizontal beam
    ctx.fillRect(x, y + height / 2 - 2 * p, width, 4 * p);
    // Diagonal beams
    ctx.fillStyle = MARKET_COLORS.buildingWoodDark;
    for (let i = 0; i < width; i += 4 * p) {
      const progress = i / width;
      ctx.fillRect(x + i, y + progress * height / 2, 4 * p, 4 * p);
    }
  }
}

// Helper function to draw a roof
function drawRoof(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, style: number): void {
  const p = SCALE;
  
  if (style === 0) {
    // Peaked roof
    ctx.fillStyle = MARKET_COLORS.roofTile;
    ctx.beginPath();
    ctx.moveTo(x - 8 * p, y + height);
    ctx.lineTo(x + width / 2, y);
    ctx.lineTo(x + width + 8 * p, y + height);
    ctx.closePath();
    ctx.fill();
    
    // Roof tiles texture
    ctx.fillStyle = MARKET_COLORS.roofTileDark;
    for (let row = 0; row < height / (6 * p); row++) {
      const rowY = y + row * 6 * p;
      const rowWidth = width * (1 - row * 6 * p / height);
      const startX = x + (width - rowWidth) / 2;
      for (let i = 0; i < rowWidth / (10 * p); i++) {
        ctx.fillRect(startX + i * 10 * p + (row % 2) * 5 * p, rowY + 4 * p, 8 * p, 2 * p);
      }
    }
  } else {
    // Flat sloped roof
    ctx.fillStyle = MARKET_COLORS.roofTile;
    ctx.fillRect(x - 6 * p, y, width + 12 * p, height);
    
    // Tiles
    ctx.fillStyle = MARKET_COLORS.roofTileDark;
    for (let row = 0; row < height / (5 * p); row++) {
      for (let col = 0; col < (width + 12 * p) / (8 * p); col++) {
        ctx.fillRect(x - 6 * p + col * 8 * p + (row % 2) * 4 * p, y + row * 5 * p + 3 * p, 6 * p, 2 * p);
      }
    }
  }
}

// Helper function to draw a market window
function drawMarketWindow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lit: boolean): void {
  const p = SCALE;
  
  // Window frame
  ctx.fillStyle = MARKET_COLORS.windowFrame;
  ctx.fillRect(x, y, w, h);
  
  // Glass
  ctx.fillStyle = lit ? '#f4d03f' : MARKET_COLORS.windowGlass;
  ctx.fillRect(x + 2 * p, y + 2 * p, w - 4 * p, h - 4 * p);
  
  // Cross frame
  ctx.fillStyle = MARKET_COLORS.windowFrame;
  ctx.fillRect(x + w / 2 - p, y, 2 * p, h);
  ctx.fillRect(x, y + h / 2 - p, w, 2 * p);
  
  // Highlight
  if (lit) {
    ctx.fillStyle = '#fffacd';
    ctx.fillRect(x + 3 * p, y + 3 * p, 4 * p, 4 * p);
  }
}

// Helper function to draw a door
function drawDoor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const p = SCALE;
  
  // Door frame
  ctx.fillStyle = MARKET_COLORS.buildingWoodDark;
  ctx.fillRect(x, y, w, h);
  
  // Door
  ctx.fillStyle = MARKET_COLORS.doorWood;
  ctx.fillRect(x + 2 * p, y + 2 * p, w - 4 * p, h - 2 * p);
  
  // Planks
  ctx.fillStyle = MARKET_COLORS.buildingWoodDark;
  ctx.fillRect(x + w / 3, y + 2 * p, 2 * p, h - 2 * p);
  ctx.fillRect(x + w * 2 / 3, y + 2 * p, 2 * p, h - 2 * p);
  
  // Handle
  ctx.fillStyle = '#c0a000';
  ctx.fillRect(x + w - 8 * p, y + h / 2, 3 * p, 4 * p);
  
  // Arch top
  ctx.fillStyle = MARKET_COLORS.buildingWoodDark;
  ctx.beginPath();
  ctx.arc(x + w / 2, y + 4 * p, w / 2 - 2 * p, Math.PI, 0, false);
  ctx.fill();
  ctx.fillStyle = MARKET_COLORS.doorWood;
  ctx.beginPath();
  ctx.arc(x + w / 2, y + 4 * p, w / 2 - 4 * p, Math.PI, 0, false);
  ctx.fill();
}

// Helper function to draw a flag/banner
function drawFlag(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, height: number): void {
  const p = SCALE;
  
  // Pole
  ctx.fillStyle = MARKET_COLORS.flagPole;
  ctx.fillRect(x, y, 3 * p, height);
  
  // Pole top ornament
  ctx.fillStyle = '#c0a000';
  ctx.beginPath();
  ctx.arc(x + 1.5 * p, y, 4 * p, 0, Math.PI * 2);
  ctx.fill();
  
  // Flag cloth
  ctx.fillStyle = color;
  const flagWidth = 20 * p;
  const flagHeight = 30 * p;
  ctx.beginPath();
  ctx.moveTo(x + 3 * p, y + 4 * p);
  ctx.lineTo(x + 3 * p + flagWidth, y + 8 * p);
  ctx.lineTo(x + 3 * p + flagWidth - 4 * p, y + 4 * p + flagHeight / 2);
  ctx.lineTo(x + 3 * p + flagWidth, y + flagHeight);
  ctx.lineTo(x + 3 * p, y + flagHeight - 4 * p);
  ctx.closePath();
  ctx.fill();
  
  // Flag detail - simple emblem
  ctx.fillStyle = MARKET_COLORS.flagGold;
  ctx.beginPath();
  ctx.arc(x + 3 * p + flagWidth / 2, y + 4 * p + flagHeight / 2, 5 * p, 0, Math.PI * 2);
  ctx.fill();
}

// Helper function to draw the central fountain
function drawFountain(ctx: CanvasRenderingContext2D, centerX: number, centerY: number): void {
  const p = SCALE;
  
  // Outer basin (octagonal shape)
  ctx.fillStyle = MARKET_COLORS.fountainStoneDark;
  const outerRadius = 80 * p;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI / 4) - Math.PI / 8;
    const px = centerX + Math.cos(angle) * outerRadius;
    const py = centerY + Math.sin(angle) * outerRadius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  
  // Inner basin
  ctx.fillStyle = MARKET_COLORS.fountainStone;
  const innerRadius = 70 * p;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI / 4) - Math.PI / 8;
    const px = centerX + Math.cos(angle) * innerRadius;
    const py = centerY + Math.sin(angle) * innerRadius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  
  // Water
  ctx.fillStyle = MARKET_COLORS.fountainWater;
  ctx.beginPath();
  ctx.arc(centerX, centerY, 60 * p, 0, Math.PI * 2);
  ctx.fill();
  
  // Water highlight
  ctx.fillStyle = MARKET_COLORS.fountainWaterLight;
  ctx.beginPath();
  ctx.ellipse(centerX - 15 * p, centerY - 15 * p, 30 * p, 20 * p, -0.5, 0, Math.PI * 2);
  ctx.fill();
  
  // Central pillar base
  ctx.fillStyle = MARKET_COLORS.fountainStoneDark;
  ctx.beginPath();
  ctx.arc(centerX, centerY, 25 * p, 0, Math.PI * 2);
  ctx.fill();
  
  // Central pillar
  ctx.fillStyle = MARKET_COLORS.fountainStone;
  ctx.fillRect(centerX - 12 * p, centerY - 60 * p, 24 * p, 70 * p);
  
  // Pillar details
  ctx.fillStyle = MARKET_COLORS.fountainStoneDark;
  ctx.fillRect(centerX - 15 * p, centerY - 60 * p, 30 * p, 6 * p);
  ctx.fillRect(centerX - 14 * p, centerY - 45 * p, 28 * p, 4 * p);
  ctx.fillRect(centerX - 15 * p, centerY, 30 * p, 6 * p);
  
  // Top bowl
  ctx.fillStyle = MARKET_COLORS.fountainStone;
  ctx.beginPath();
  ctx.ellipse(centerX, centerY - 55 * p, 20 * p, 8 * p, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Water spout indicator
  ctx.fillStyle = MARKET_COLORS.fountainWaterLight;
  ctx.beginPath();
  ctx.arc(centerX, centerY - 58 * p, 8 * p, 0, Math.PI * 2);
  ctx.fill();
  
  // Decorative edge stones around basin
  ctx.fillStyle = MARKET_COLORS.fountainStoneDark;
  for (let i = 0; i < 16; i++) {
    const angle = (i * Math.PI / 8);
    const px = centerX + Math.cos(angle) * (outerRadius + 5 * p);
    const py = centerY + Math.sin(angle) * (outerRadius + 5 * p);
    ctx.beginPath();
    ctx.arc(px, py, 6 * p, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Helper to draw a market stall
function drawMarketStall(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  const p = SCALE;
  
  // Stall posts
  ctx.fillStyle = MARKET_COLORS.buildingWood;
  ctx.fillRect(x, y, 4 * p, 40 * p);
  ctx.fillRect(x + 36 * p, y, 4 * p, 40 * p);
  
  // Counter
  ctx.fillStyle = MARKET_COLORS.crateWood;
  ctx.fillRect(x - 4 * p, y + 25 * p, 48 * p, 15 * p);
  ctx.fillStyle = MARKET_COLORS.crateWoodDark;
  ctx.fillRect(x - 4 * p, y + 38 * p, 48 * p, 2 * p);
  
  // Awning
  ctx.fillStyle = color;
  ctx.fillRect(x - 8 * p, y - 5 * p, 56 * p, 12 * p);
  
  // Awning stripes
  ctx.fillStyle = MARKET_COLORS.awningStripe;
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(x - 8 * p + i * 10 * p, y - 5 * p, 5 * p, 12 * p);
  }
  
  // Awning fringe
  ctx.fillStyle = color;
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(x - 8 * p + i * 7 * p, y + 7 * p);
    ctx.lineTo(x - 4 * p + i * 7 * p, y + 14 * p);
    ctx.lineTo(x + i * 7 * p, y + 7 * p);
    ctx.fill();
  }
}

// Helper to draw a barrel
function drawBarrel(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const p = SCALE;
  
  // Barrel body
  ctx.fillStyle = MARKET_COLORS.barrelWood;
  ctx.beginPath();
  ctx.ellipse(x + 10 * p, y + 20 * p, 12 * p, 20 * p, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Bands
  ctx.fillStyle = MARKET_COLORS.barrelBand;
  ctx.fillRect(x - 2 * p, y + 5 * p, 24 * p, 3 * p);
  ctx.fillRect(x - 2 * p, y + 18 * p, 24 * p, 3 * p);
  ctx.fillRect(x - 2 * p, y + 32 * p, 24 * p, 3 * p);
  
  // Top
  ctx.fillStyle = MARKET_COLORS.crateWoodDark;
  ctx.beginPath();
  ctx.ellipse(x + 10 * p, y + 2 * p, 10 * p, 4 * p, 0, 0, Math.PI * 2);
  ctx.fill();
}

// Helper to draw a crate
function drawCrate(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const p = SCALE;
  
  // Crate body
  ctx.fillStyle = MARKET_COLORS.crateWood;
  ctx.fillRect(x, y, size * p, size * p);
  
  // Planks
  ctx.fillStyle = MARKET_COLORS.crateWoodDark;
  ctx.fillRect(x, y, size * p, 2 * p);
  ctx.fillRect(x, y + size * p - 2 * p, size * p, 2 * p);
  ctx.fillRect(x, y + size / 2 * p, size * p, 2 * p);
  ctx.fillRect(x, y, 2 * p, size * p);
  ctx.fillRect(x + size * p - 2 * p, y, 2 * p, size * p);
}

function drawMarketBackground(ctx: CanvasRenderingContext2D): void {
  const p = SCALE;
  const tileW = TILE_SIZE * SCALE;
  
  // Base cobblestone (full world)
  ctx.fillStyle = MARKET_COLORS.cobbleMid;
  ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  
  // Cobblestone pattern - varied and interesting
  for (let row = 0; row < MAP_HEIGHT; row++) {
    for (let col = 0; col < MAP_WIDTH; col++) {
      const x = col * tileW;
      const y = row * tileW;
      
      // Create varied cobblestone patterns
      const seed = (row * 137 + col * 251) % 100;
      const offset = (row % 2) * 8 * p;
      
      // Large cobbles
      if (seed < 30) {
        ctx.fillStyle = MARKET_COLORS.cobbleLight;
        ctx.beginPath();
        ctx.ellipse(x + 8 * p + offset, y + 8 * p, 7 * p, 6 * p, seed * 0.1, 0, Math.PI * 2);
        ctx.fill();
      } else if (seed < 50) {
        ctx.fillStyle = MARKET_COLORS.cobbleDark;
        ctx.beginPath();
        ctx.ellipse(x + 10 * p + offset, y + 10 * p, 8 * p, 5 * p, seed * 0.05, 0, Math.PI * 2);
        ctx.fill();
      } else if (seed < 65) {
        ctx.fillStyle = MARKET_COLORS.cobbleAccent;
        ctx.fillRect(x + 4 * p + (seed % 4) * p, y + 4 * p + (seed % 3) * p, 10 * p, 8 * p);
      }
      
      // Mortar/gap lines
      if (seed % 7 === 0) {
        ctx.fillStyle = MARKET_COLORS.cobbleDark;
        ctx.fillRect(x + 2 * p, y + 14 * p, 12 * p, 1 * p);
      }
      if (seed % 11 === 0) {
        ctx.fillStyle = MARKET_COLORS.cobbleDark;
        ctx.fillRect(x + 14 * p, y + 4 * p, 1 * p, 10 * p);
      }
    }
  }
  
  // Calculate center of map
  const centerX = WORLD_WIDTH / 2;
  const centerY = WORLD_HEIGHT / 2;
  
  // Draw a decorative circular pattern around the fountain area
  const squareRadius = 200 * p;
  ctx.fillStyle = MARKET_COLORS.cobbleLight;
  for (let ring = 0; ring < 4; ring++) {
    const radius = squareRadius - ring * 40 * p;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();
    
    // Decorative stones in ring
    for (let i = 0; i < 24 + ring * 8; i++) {
      const angle = (i / (24 + ring * 8)) * Math.PI * 2;
      const sx = centerX + Math.cos(angle) * radius;
      const sy = centerY + Math.sin(angle) * radius;
      ctx.fillStyle = ring % 2 === 0 ? MARKET_COLORS.cobbleLight : MARKET_COLORS.cobbleDark;
      ctx.beginPath();
      ctx.arc(sx, sy, 4 * p, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  
  // Draw the central fountain
  drawFountain(ctx, centerX, centerY);
  
  // ============ BUILDINGS AROUND THE EDGES ============
  
  const buildingDepth = 8 * tileW; // How deep buildings go into the map
  const buildingHeight = 120 * p;
  const roofHeight = 50 * p;
  
  // Top row of buildings
  for (let i = 0; i < MAP_WIDTH; i += 6) {
    const bx = i * tileW;
    const by = 0;
    const bw = (4 + (i % 3)) * tileW;
    
    // Skip some for variety
    if ((i * 7) % 13 < 3) continue;
    
    drawMedievalBuilding(ctx, bx, by, bw, buildingHeight, i % 3);
    drawRoof(ctx, bx, by - roofHeight, bw, roofHeight, i % 2);
    
    // Windows
    const numWindows = Math.floor(bw / (20 * p));
    for (let w = 0; w < numWindows; w++) {
      const lit = (i + w) % 3 === 0;
      drawMarketWindow(ctx, bx + 10 * p + w * 18 * p, by + 20 * p, 12 * p, 16 * p, lit);
      drawMarketWindow(ctx, bx + 10 * p + w * 18 * p, by + 60 * p, 12 * p, 16 * p, !lit);
    }
    
    // Door on some buildings
    if (i % 12 < 6) {
      drawDoor(ctx, bx + bw / 2 - 10 * p, by + buildingHeight - 40 * p, 20 * p, 40 * p);
    }
  }
  
  // Bottom row of buildings
  for (let i = 0; i < MAP_WIDTH; i += 5) {
    const bx = i * tileW;
    const by = WORLD_HEIGHT - buildingHeight;
    const bw = (3 + (i % 4)) * tileW;
    
    if ((i * 11) % 17 < 4) continue;
    
    drawMedievalBuilding(ctx, bx, by, bw, buildingHeight, (i + 1) % 3);
    
    // Windows
    const numWindows = Math.floor(bw / (22 * p));
    for (let w = 0; w < numWindows; w++) {
      const lit = (i + w) % 4 === 0;
      drawMarketWindow(ctx, bx + 12 * p + w * 20 * p, by + 15 * p, 14 * p, 18 * p, lit);
    }
    
    // Door
    if (i % 10 < 5) {
      drawDoor(ctx, bx + bw / 2 - 12 * p, by + 50 * p, 24 * p, buildingHeight - 50 * p);
    }
  }
  
  // Left row of buildings
  for (let i = 8; i < MAP_HEIGHT - 8; i += 6) {
    const bx = 0;
    const by = i * tileW;
    const bw = buildingDepth;
    const bh = (4 + (i % 3)) * tileW;
    
    if ((i * 13) % 11 < 3) continue;
    
    drawMedievalBuilding(ctx, bx, by, bw, bh, (i + 2) % 3);
    
    // Side-facing windows
    for (let w = 0; w < 2; w++) {
      const lit = (i + w) % 3 === 0;
      drawMarketWindow(ctx, bw - 20 * p, by + 15 * p + w * 25 * p, 14 * p, 18 * p, lit);
    }
  }
  
  // Right row of buildings  
  for (let i = 8; i < MAP_HEIGHT - 8; i += 5) {
    const bx = WORLD_WIDTH - buildingDepth;
    const by = i * tileW;
    const bw = buildingDepth;
    const bh = (3 + (i % 4)) * tileW;
    
    if ((i * 17) % 13 < 4) continue;
    
    drawMedievalBuilding(ctx, bx, by, bw, bh, (i + 1) % 3);
    
    // Windows facing inward
    for (let w = 0; w < 2; w++) {
      const lit = (i + w) % 4 === 0;
      drawMarketWindow(ctx, bx + 6 * p, by + 12 * p + w * 22 * p, 12 * p, 16 * p, lit);
    }
  }
  
  // ============ FLAGS AND BANNERS ============
  
  const flagColors = [MARKET_COLORS.flagRed, MARKET_COLORS.flagBlue, MARKET_COLORS.flagPurple, MARKET_COLORS.flagGold];
  
  // Flags around the fountain
  const flagPositions = [
    { x: centerX - 150 * p, y: centerY - 150 * p },
    { x: centerX + 150 * p, y: centerY - 150 * p },
    { x: centerX - 150 * p, y: centerY + 150 * p },
    { x: centerX + 150 * p, y: centerY + 150 * p },
    { x: centerX, y: centerY - 200 * p },
    { x: centerX, y: centerY + 200 * p },
    { x: centerX - 200 * p, y: centerY },
    { x: centerX + 200 * p, y: centerY },
  ];
  
  flagPositions.forEach((pos, i) => {
    drawFlag(ctx, pos.x, pos.y - 60 * p, flagColors[i % flagColors.length], 80 * p);
  });
  
  // ============ MARKET STALLS ============
  
  // A few market stalls around the square
  drawMarketStall(ctx, centerX - 300 * p, centerY - 100 * p, MARKET_COLORS.awningRed);
  drawMarketStall(ctx, centerX + 260 * p, centerY - 80 * p, MARKET_COLORS.awningGreen);
  drawMarketStall(ctx, centerX - 280 * p, centerY + 120 * p, MARKET_COLORS.awningGreen);
  drawMarketStall(ctx, centerX + 240 * p, centerY + 100 * p, MARKET_COLORS.awningRed);
  
  // ============ SCATTERED PROPS ============
  
  // Barrels and crates scattered around
  const propPositions = [
    { x: centerX - 350 * p, y: centerY - 50 * p, type: 'barrel' },
    { x: centerX - 340 * p, y: centerY - 30 * p, type: 'barrel' },
    { x: centerX + 320 * p, y: centerY + 50 * p, type: 'crate' },
    { x: centerX + 340 * p, y: centerY + 40 * p, type: 'crate' },
    { x: centerX + 330 * p, y: centerY + 70 * p, type: 'barrel' },
    { x: centerX - 100 * p, y: centerY + 250 * p, type: 'crate' },
    { x: centerX + 80 * p, y: centerY - 260 * p, type: 'barrel' },
    { x: centerX - 400 * p, y: centerY + 180 * p, type: 'crate' },
    { x: centerX + 380 * p, y: centerY - 200 * p, type: 'barrel' },
  ];
  
  propPositions.forEach(prop => {
    if (prop.type === 'barrel') {
      drawBarrel(ctx, prop.x, prop.y);
    } else {
      drawCrate(ctx, prop.x, prop.y, 20);
    }
  });
  
  // Add some floor details - worn areas, puddles
  ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
  for (let i = 0; i < 20; i++) {
    const wx = (i * 197 + 50) % WORLD_WIDTH;
    const wy = (i * 283 + 100) % WORLD_HEIGHT;
    ctx.beginPath();
    ctx.ellipse(wx, wy, 30 * p + (i % 20) * p, 20 * p + (i % 15) * p, i * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Puddles (rare)
  ctx.fillStyle = 'rgba(100, 150, 200, 0.3)';
  for (let i = 0; i < 5; i++) {
    const px = (i * 397 + 200) % WORLD_WIDTH;
    const py = (i * 521 + 300) % WORLD_HEIGHT;
    // Don't place on fountain
    if (Math.abs(px - centerX) < 150 * p && Math.abs(py - centerY) < 150 * p) continue;
    ctx.beginPath();
    ctx.ellipse(px, py, 15 * p + (i % 10) * p, 10 * p + (i % 8) * p, i * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ============ FOREST MAP ============

function drawForestBackground(ctx: CanvasRenderingContext2D): void {
  const p = SCALE;
  const tileW = TILE_SIZE * SCALE;
  
  // Dark forest floor (full world)
  ctx.fillStyle = FOREST_COLORS.groundMid;
  ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  
  // Ground variation
  for (let row = 0; row < MAP_HEIGHT; row++) {
    for (let col = 0; col < MAP_WIDTH; col++) {
      const x = col * tileW;
      const y = row * tileW;
      const variant = (row * 11 + col * 17) % 5;
      
      if (variant === 0) {
        ctx.fillStyle = FOREST_COLORS.groundDark;
        ctx.fillRect(x + 2 * p, y + 2 * p, 12 * p, 12 * p);
      } else if (variant === 1) {
        ctx.fillStyle = FOREST_COLORS.groundLight;
        ctx.fillRect(x + 6 * p, y + 6 * p, 8 * p, 8 * p);
      }
      
      // Moss patches
      if (variant === 2) {
        ctx.fillStyle = FOREST_COLORS.moss;
        ctx.beginPath();
        ctx.arc(x + 8 * p, y + 8 * p, 6 * p, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  
  // Create winding paths that snake through the forest
  const pathTiles: Set<string> = new Set();
  
  // Helper to draw and track path tiles
  const drawPathTile = (x: number, y: number, w: number, h: number) => {
    if (x >= 0 && x < MAP_WIDTH && y >= 0 && y < MAP_HEIGHT) {
      ctx.fillStyle = FOREST_COLORS.path;
      ctx.fillRect(x * tileW, y * tileW, w * tileW, h * tileW);
      ctx.fillStyle = FOREST_COLORS.pathLight;
      ctx.fillRect(x * tileW, y * tileW, w * tileW, 4 * p);
      // Track path tiles for tree avoidance
      for (let px = x; px < x + w && px < MAP_WIDTH; px++) {
        for (let py = y; py < y + h && py < MAP_HEIGHT; py++) {
          pathTiles.add(`${Math.floor(px)},${Math.floor(py)}`);
        }
      }
    }
  };
  
  // Main winding path from top-left to bottom-right
  let pathX = 2;
  let pathY = 5;
  const seed1 = 12345;
  while (pathX < MAP_WIDTH - 5 && pathY < MAP_HEIGHT - 5) {
    drawPathTile(pathX, pathY, 3, 2);
    // Pseudo-random direction changes
    const rand = ((pathX * 7 + pathY * 13 + seed1) % 10);
    if (rand < 4) {
      pathX += 2; // Go right
    } else if (rand < 6) {
      pathX += 2;
      pathY += 2; // Diagonal down-right
    } else if (rand < 8) {
      pathY += 2; // Go down
    } else {
      pathX += 3;
      pathY -= 1; // Slight up-right
      if (pathY < 2) pathY = 2;
    }
  }
  
  // Second winding path from top-right going down-left
  pathX = MAP_WIDTH - 8;
  pathY = 3;
  const seed2 = 54321;
  while (pathX > 5 && pathY < MAP_HEIGHT - 5) {
    drawPathTile(pathX, pathY, 3, 2);
    const rand = ((pathX * 11 + pathY * 7 + seed2) % 10);
    if (rand < 3) {
      pathX -= 2; // Go left
    } else if (rand < 6) {
      pathX -= 2;
      pathY += 2; // Diagonal down-left
    } else if (rand < 8) {
      pathY += 2; // Go down
    } else {
      pathX -= 1;
      pathY += 3; // More down than left
    }
  }
  
  // Third path - curves from left side across middle
  pathX = 0;
  pathY = MAP_HEIGHT / 2;
  const seed3 = 98765;
  while (pathX < MAP_WIDTH - 3) {
    drawPathTile(pathX, pathY, 3, 2);
    const rand = ((pathX * 5 + pathY * 17 + seed3) % 10);
    pathX += 2;
    if (rand < 3) {
      pathY -= 2; // Curve up
      if (pathY < 3) pathY = 3;
    } else if (rand < 6) {
      pathY += 2; // Curve down
      if (pathY > MAP_HEIGHT - 5) pathY = MAP_HEIGHT - 5;
    }
    // else stay level
  }
  
  // Fourth path - vertical winding path
  pathX = MAP_WIDTH / 3;
  pathY = 0;
  const seed4 = 13579;
  while (pathY < MAP_HEIGHT - 3) {
    drawPathTile(pathX, pathY, 2, 3);
    const rand = ((pathX * 3 + pathY * 11 + seed4) % 10);
    pathY += 2;
    if (rand < 3) {
      pathX -= 2; // Curve left
      if (pathX < 3) pathX = 3;
    } else if (rand < 6) {
      pathX += 2; // Curve right
      if (pathX > MAP_WIDTH - 5) pathX = MAP_WIDTH - 5;
    }
  }
  
  // Fifth path - another vertical winding path on right side
  pathX = (MAP_WIDTH * 2) / 3;
  pathY = MAP_HEIGHT - 3;
  const seed5 = 24680;
  while (pathY > 3) {
    drawPathTile(pathX, pathY, 2, 3);
    const rand = ((pathX * 9 + pathY * 5 + seed5) % 10);
    pathY -= 2;
    if (rand < 4) {
      pathX -= 2;
      if (pathX < 3) pathX = 3;
    } else if (rand < 7) {
      pathX += 2;
      if (pathX > MAP_WIDTH - 5) pathX = MAP_WIDTH - 5;
    }
  }
  
  // Store path tiles for tree placement avoidance
  (window as unknown as { forestPathTiles: Set<string> }).forestPathTiles = pathTiles;
  
  // Build tree data and draw only TRUNKS (foliage drawn later on top of players)
  // Clear and rebuild tree data (trees are regenerated each time background is drawn)
  forestTrees = [];
  
  // Helper to check if a position is on a path
  const isOnPath = (tx: number, ty: number): boolean => {
    // Check a small area around the tree position
    for (let dx = -1; dx <= 2; dx++) {
      for (let dy = -1; dy <= 2; dy++) {
        if (pathTiles.has(`${tx + dx},${ty + dy}`)) return true;
      }
    }
    return false;
  };
  
  // Fountain center position (in tile coordinates)
  const fountainCenterTileX = MAP_WIDTH / 2;
  const fountainCenterTileY = MAP_HEIGHT / 2;
  const fountainRadiusTiles = 36; // Radius in tiles to avoid (increased for larger plaza: 540/SCALE/16 ≈ 11.25 tiles, use 36 for safety)
  
  // Helper to check if position is too close to fountain
  const isNearFountain = (tx: number, ty: number): boolean => {
    const dx = tx - fountainCenterTileX;
    const dy = ty - fountainCenterTileY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist < fountainRadiusTiles;
  };
  
  for (let ty = 0; ty < MAP_HEIGHT; ty += 4) {
    for (let tx = 0; tx < MAP_WIDTH; tx += 5) {
      // Skip if tree would be on a path
      if (isOnPath(tx, ty)) continue;
      // Skip if tree would be too close to fountain
      if (isNearFountain(tx, ty)) continue;
      
      const treeX = tx * tileW + ((tx * ty) % 3) * tileW;
      const treeY = ty * tileW + ((tx + ty) % 2) * tileW;
      const isLarge = (tx + ty) % 3 === 0;
      const s = isLarge ? 1.5 : 1;
      
      // Store tree data for collision and foliage rendering
      forestTrees.push({
        x: tx,
        y: ty,
        canopyX: treeX + 24 * p,
        canopyY: treeY + 20 * s * p,
        canopyRadius: isLarge ? 50 * p : 35 * p,
        trunkX: treeX + 16 * p,
        trunkY: treeY + 40 * s * p,
        trunkW: 16 * s * p,
        trunkH: 30 * s * p,
        isLarge,
        scale: s,
      });
      
      // Don't draw trunk here - it's drawn in drawForestFoliage so it can be conditionally hidden when cut
    }
  }
  
  // Fountain center position (defined early for use in helper functions)
  const centerX = WORLD_WIDTH / 2;
  const centerY = WORLD_HEIGHT / 2;
  const plazaRadius = 540 * p; // Large paved area (increased by 200% from 180 = 540)
  
  // Build a list of tree areas to avoid for mushroom placement (using stored tree data)
  const treeAreas = forestTrees.map(tree => ({
    canopyX: tree.canopyX,
    canopyY: tree.canopyY,
    canopyRadius: tree.canopyRadius,
    trunkX: tree.trunkX,
    trunkY: tree.trunkY,
    trunkW: tree.trunkW,
    trunkH: tree.trunkH,
  }));
  
  // Helper to check if position is too close to any tree (canopy or trunk)
  const isNearTree = (x: number, y: number): boolean => {
    for (const tree of treeAreas) {
      // Check canopy (circular)
      const dx = x - tree.canopyX;
      const dy = y - tree.canopyY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < tree.canopyRadius) return true;
      
      // Check trunk (rectangular with padding)
      if (x >= tree.trunkX - 5 * p && x <= tree.trunkX + tree.trunkW + 5 * p &&
          y >= tree.trunkY - 5 * p && y <= tree.trunkY + tree.trunkH + 5 * p) {
        return true;
      }
    }
    return false;
  };
  
  // Helper to check if position is too close to fountain
  const isNearFountainArea = (x: number, y: number): boolean => {
    const dx = x - centerX;
    const dy = y - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist < plazaRadius + 60 * p; // Add padding (increased proportionally)
  };
  
  // Mushrooms scattered throughout (avoiding trees)
  for (let my = 2; my < MAP_HEIGHT; my += 6) {
    for (let mx = 2; mx < MAP_WIDTH; mx += 7) {
      const mushroomX = mx * tileW + ((mx * my) % 4) * tileW;
      const mushroomY = my * tileW + ((mx + my) % 3) * tileW;
      
      // Skip if mushroom would be under a tree
      if (isNearTree(mushroomX + 9 * p, mushroomY + 8 * p)) continue;
      // Skip if mushroom would be too close to fountain
      if (isNearFountainArea(mushroomX + 9 * p, mushroomY + 8 * p)) continue;
      
      // Stem
      ctx.fillStyle = '#f5f5dc';
      ctx.fillRect(mushroomX + 6 * p, mushroomY + 10 * p, 6 * p, 8 * p);
      
      // Cap
      ctx.fillStyle = FOREST_COLORS.mushroom;
      ctx.beginPath();
      ctx.ellipse(mushroomX + 9 * p, mushroomY + 8 * p, 10 * p, 6 * p, 0, 0, Math.PI * 2);
      ctx.fill();
      
      // Spots
      ctx.fillStyle = FOREST_COLORS.mushroomSpot;
      ctx.beginPath();
      ctx.arc(mushroomX + 6 * p, mushroomY + 6 * p, 2 * p, 0, Math.PI * 2);
      ctx.arc(mushroomX + 12 * p, mushroomY + 7 * p, 2 * p, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  
  // Fog effect scattered throughout
  ctx.fillStyle = FOREST_COLORS.fogLight;
  for (let fogY = 0; fogY < MAP_HEIGHT; fogY += 8) {
    for (let fogX = 0; fogX < MAP_WIDTH; fogX += 10) {
      const fx = (fogX + (fogY % 5)) * tileW;
      const fy = (fogY + (fogX % 3)) * tileW;
      ctx.beginPath();
      ctx.ellipse(fx + tileW, fy + tileW / 2, 2 * tileW, tileW, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  
  // === FOUNTAIN PLAZA (Center of map) ===
  // (centerX, centerY, and plazaRadius are already defined above for use in helper functions)
  
  // Paved circular area
  ctx.fillStyle = '#4a4a3a'; // Dark stone
  ctx.beginPath();
  ctx.arc(centerX, centerY, plazaRadius, 0, Math.PI * 2);
  ctx.fill();
  
  // Black lines radiating from center at 45 degree angles (drawn before podiums so they're hidden underneath)
  ctx.strokeStyle = '#000000'; // Black
  ctx.lineWidth = 2 * p;
  // Draw lines at 45 degree intervals (8 directions: 0, 45, 90, 135, 180, 225, 270, 315 degrees)
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const lineLength = plazaRadius * 1.2; // Extend slightly beyond plaza
    const endX = centerX + Math.cos(angle) * lineLength;
    const endY = centerY + Math.sin(angle) * lineLength;
    
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  }
  
  // === PODIUMS (Drawn in background so players can walk on top) ===
  const npcRadius = plazaRadius * 0.7;
  const npcPodiumRadius = 35 * p;
  const fountainPodiumRadius = 160 * p; // Doubled from 80 to make it much larger
  
  // Draw fountain podium (in background, after black lines so it covers them)
  drawPodiumWithStairs(ctx, centerX, centerY, fountainPodiumRadius, 12);
  
  // Draw NPC podiums (in background, before NPCs are drawn)
  const npcStallAngles = [
    0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4,
    Math.PI, 5 * Math.PI / 4, 3 * Math.PI / 2, 7 * Math.PI / 4
  ];
  for (const angle of npcStallAngles) {
    const npcX = centerX + Math.cos(angle) * npcRadius;
    const npcY = centerY + Math.sin(angle) * npcRadius;
    drawPodiumWithStairs(ctx, npcX, npcY, npcPodiumRadius, 8);
  }
  
  // Outer ring
  ctx.strokeStyle = '#3a3a2a';
  ctx.lineWidth = 4 * p;
  ctx.beginPath();
  ctx.arc(centerX, centerY, plazaRadius, 0, Math.PI * 2);
  ctx.stroke();
  
  // === STONE WALL AROUND PLAZA PERIMETER (3D CASTLE WALL) ===
  const wallHeight = 60 * p; // Much taller for castle wall effect
  const wallThickness = 24 * p; // Increased thickness for more girth
  const wallTopOffset = 12 * p; // How much the top extends outward for 3D effect
  const battlementHeight = 12 * p; // Height of battlements
  const battlementCount = 32; // More battlements for better detail
  const gateCount = 4; // Number of archways/gates for players to pass through
  const gateWidth = 40 * p; // Width of each gate opening
  
  // Draw wall shadow on ground (outer edge)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.arc(centerX, centerY, plazaRadius + wallThickness + wallTopOffset + 2 * p, 0, Math.PI * 2);
  ctx.arc(centerX, centerY, plazaRadius + wallThickness + wallTopOffset, 0, Math.PI * 2, true);
  ctx.fill();
  
  // Draw outer face of wall (3D perspective - darker, receding)
  ctx.fillStyle = '#4a4a3a';
  for (let i = 0; i < 32; i++) {
    const angle1 = (i / 32) * Math.PI * 2;
    const angle2 = ((i + 1) / 32) * Math.PI * 2;
    
    // Outer face vertices
    const outerTopX1 = centerX + Math.cos(angle1) * (plazaRadius + wallThickness + wallTopOffset);
    const outerTopY1 = centerY + Math.sin(angle1) * (plazaRadius + wallThickness + wallTopOffset);
    const outerTopX2 = centerX + Math.cos(angle2) * (plazaRadius + wallThickness + wallTopOffset);
    const outerTopY2 = centerY + Math.sin(angle2) * (plazaRadius + wallThickness + wallTopOffset);
    const outerBottomX1 = centerX + Math.cos(angle1) * (plazaRadius + wallThickness);
    const outerBottomY1 = centerY + Math.sin(angle1) * (plazaRadius + wallThickness);
    const outerBottomX2 = centerX + Math.cos(angle2) * (plazaRadius + wallThickness);
    const outerBottomY2 = centerY + Math.sin(angle2) * (plazaRadius + wallThickness);
    
    // Draw outer face with gradient for 3D effect
    const gradient = ctx.createLinearGradient(
      (outerTopX1 + outerTopX2) / 2,
      (outerTopY1 + outerTopY2) / 2,
      (outerBottomX1 + outerBottomX2) / 2,
      (outerBottomY1 + outerBottomY2) / 2
    );
    gradient.addColorStop(0, '#5a5a4a'); // Lighter at top
    gradient.addColorStop(1, '#3a3a2a'); // Darker at bottom
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(outerTopX1, outerTopY1);
    ctx.lineTo(outerTopX2, outerTopY2);
    ctx.lineTo(outerBottomX2, outerBottomY2);
    ctx.lineTo(outerBottomX1, outerBottomY1);
    ctx.closePath();
    ctx.fill();
  }
  
  // Note: Top surface and battlements are drawn AFTER players (in drawPlazaWallTop)
  // so players can walk under the wall
  
  // Draw inner face of wall (facing plaza, slightly lighter)
  ctx.fillStyle = '#5a5a4a';
  for (let i = 0; i < 32; i++) {
    const angle1 = (i / 32) * Math.PI * 2;
    const angle2 = ((i + 1) / 32) * Math.PI * 2;
    
    // Inner face vertices
    const innerTopX1 = centerX + Math.cos(angle1) * (plazaRadius + wallThickness);
    const innerTopY1 = centerY + Math.sin(angle1) * (plazaRadius + wallThickness);
    const innerTopX2 = centerX + Math.cos(angle2) * (plazaRadius + wallThickness);
    const innerTopY2 = centerY + Math.sin(angle2) * (plazaRadius + wallThickness);
    const innerBottomX1 = centerX + Math.cos(angle1) * plazaRadius;
    const innerBottomY1 = centerY + Math.sin(angle1) * plazaRadius;
    const innerBottomX2 = centerX + Math.cos(angle2) * plazaRadius;
    const innerBottomY2 = centerY + Math.sin(angle2) * plazaRadius;
    
    // Draw inner face
    ctx.beginPath();
    ctx.moveTo(innerTopX1, innerTopY1);
    ctx.lineTo(innerTopX2, innerTopY2);
    ctx.lineTo(innerBottomX2, innerBottomY2);
    ctx.lineTo(innerBottomX1, innerBottomY1);
    ctx.closePath();
    ctx.fill();
  }
  
  // Note: Top surface, stone patterns, and battlements are drawn AFTER players
  // (in drawPlazaWallTop) so players can walk under the wall
  
  // Thin dark grey line around plaza perimeter (replaces the stone blocks)
  ctx.strokeStyle = '#3a3a2a'; // Dark grey
  ctx.lineWidth = 2 * p; // Thin line
  ctx.beginPath();
  ctx.arc(centerX, centerY, plazaRadius, 0, Math.PI * 2);
  ctx.stroke();
  
  // Inner ring (fountain base area)
  ctx.fillStyle = '#2a2a1a';
  ctx.beginPath();
  ctx.arc(centerX, centerY, 40 * p, 0, Math.PI * 2);
  ctx.fill();
}

// Draw plaza wall top and battlements (called AFTER players so they walk under it)
// Pre-compute gate segments and ranges once
function precomputeGateSegments(): void {
  if (precomputedGateSegments !== null) return;
  
  const p = SCALE;
  const plazaRadius = 540 * p;
  const wallThickness = 24 * p;
  const wallTopOffset = 12 * p;
  const gateCount = 4;
  const gateWidth = 40 * p;
  const gateAngularWidth = gateWidth / (plazaRadius + wallThickness);
  
  precomputedGateSegments = [];
  precomputedGateRanges = [];
  
  for (let i = 0; i < gateCount; i++) {
    const gateAngle = (i / gateCount) * Math.PI * 2;
    const gateStartAngle = gateAngle - gateAngularWidth / 2;
    const gateEndAngle = gateAngle + gateAngularWidth / 2;
    
    const prevGateAngle = (i === 0 ? (gateCount - 1) : (i - 1)) / gateCount * Math.PI * 2;
    const prevGateEndAngle = prevGateAngle + gateAngularWidth / 2;
    const currentGateStartAngle = gateAngle - gateAngularWidth / 2;
    
    let wallStartAngle = prevGateEndAngle;
    let wallEndAngle = currentGateStartAngle;
    if (i === 0) {
      if (wallEndAngle < wallStartAngle) wallEndAngle += Math.PI * 2;
    } else {
      if (wallEndAngle < wallStartAngle) wallEndAngle += Math.PI * 2;
    }
    
    // Normalize gate angles
    let normalizedGateStart = gateStartAngle;
    while (normalizedGateStart < 0) normalizedGateStart += Math.PI * 2;
    while (normalizedGateStart >= Math.PI * 2) normalizedGateStart -= Math.PI * 2;
    let normalizedGateEnd = gateEndAngle;
    while (normalizedGateEnd < 0) normalizedGateEnd += Math.PI * 2;
    while (normalizedGateEnd >= Math.PI * 2) normalizedGateEnd -= Math.PI * 2;
    
    precomputedGateSegments.push({
      gateAngle,
      gateStartAngle,
      gateEndAngle,
      wallStartAngle,
      wallEndAngle,
    });
    
    precomputedGateRanges.push({
      start: normalizedGateStart,
      end: normalizedGateEnd,
    });
  }
}

// Optimized gate check using precomputed ranges
function isInGate(angle: number): boolean {
  if (precomputedGateRanges === null) return false;
  
  // Normalize angle once
  let normalizedAngle = angle;
  while (normalizedAngle < 0) normalizedAngle += Math.PI * 2;
  while (normalizedAngle >= Math.PI * 2) normalizedAngle -= Math.PI * 2;
  
  // Check against precomputed ranges
  for (const range of precomputedGateRanges) {
    if (range.start < range.end) {
      if (normalizedAngle >= range.start && normalizedAngle <= range.end) return true;
    } else {
      // Wraps around
      if (normalizedAngle >= range.start || normalizedAngle <= range.end) return true;
    }
  }
  return false;
}

export function drawPlazaWallTop(ctx: CanvasRenderingContext2D, camera?: Camera): void {
  const p = SCALE;
  const centerX = WORLD_WIDTH / 2;
  const centerY = WORLD_HEIGHT / 2;
  const plazaRadius = 540 * p;
  const wallThickness = 24 * p;
  const wallTopOffset = 12 * p;
  const battlementHeight = 12 * p;
  
  // Build static wall top cache if needed
  buildPlazaWallTopCache();
  
  // Draw cached static wall top
  if (plazaWallTopCache) {
    const cacheSize = (plazaRadius + wallThickness + wallTopOffset + battlementHeight) * 2.5;
    const offsetX = centerX - cacheSize / 2;
    const offsetY = centerY - cacheSize / 2;
    ctx.drawImage(plazaWallTopCache, offsetX, offsetY);
  }
}

// NPC stall data for click detection
interface NPCStall {
  x: number;
  y: number;
  tab: 'hats' | 'shirts' | 'legs' | 'capes' | 'wings' | 'accessories' | 'boosts' | 'pets';
  rarity: ItemRarity;
  name: string;
}

let npcStalls: NPCStall[] = [];

// Get current NPC stalls (for proximity checking)
export function getNPCStalls(): NPCStall[] {
  return npcStalls;
}

// Legendary items for each category (for NPC rotation)
const LEGENDARY_ITEMS_BY_CATEGORY: Record<string, string[]> = {
  hats: ['hat_golden', 'hat_phoenix_legendary', 'hat_void', 'hat_celestial', 'hat_galaxy', 'hat_rainbow'],
  shirts: ['armor_golden', 'robe_phoenix_legendary', 'armor_void', 'robe_celestial', 'armor_galaxy', 'robe_rainbow'],
  legs: ['legs_gold', 'legs_phoenix_legendary', 'legs_void', 'legs_celestial', 'legs_galaxy', 'legs_rainbow'],
  capes: ['cape_phoenix', 'cape_void', 'cape_celestial', 'cape_galaxy', 'cape_rainbow'],
  wings: ['acc_wings_golden', 'acc_wings_phoenix', 'acc_wings_void', 'acc_wings_celestial', 'acc_wings_galaxy', 'acc_wings_rainbow'],
  accessories: ['acc_aura_golden', 'acc_aura_phoenix', 'acc_aura_void', 'acc_aura_celestial', 'acc_aura_galaxy', 'acc_aura_rainbow', 'acc_weapon_golden', 'acc_weapon_phoenix', 'acc_weapon_void', 'acc_weapon_celestial', 'acc_weapon_galaxy', 'acc_weapon_rainbow'],
  boosts: ['boost_sonic', 'boost_phantom', 'boost_orb_platinum', 'boost_orb_divine'],
  pets: ['pet_golden', 'pet_phoenix', 'pet_void', 'pet_celestial', 'pet_galaxy', 'pet_rainbow', 'pet_mini_me'],
};

// NPC rotation state - tracks starting offset for each NPC (for variety)
const npcRotationOffsets: Map<string, number> = new Map();
const NPC_ROTATION_INTERVAL = 30000; // 30 seconds in milliseconds


// Get current legendary item for an NPC based on rotation
function getCurrentLegendaryItem(category: string, npcId: string, time: number): string | undefined {
  const items = LEGENDARY_ITEMS_BY_CATEGORY[category];
  if (!items || items.length === 0) return undefined;
  
  // Initialize rotation offset for this NPC (once, for variety)
  if (!npcRotationOffsets.has(npcId)) {
    // Each NPC starts at a different point in the rotation for variety
    npcRotationOffsets.set(npcId, Math.floor(Math.random() * items.length));
  }
  
  // Calculate rotation cycle (every 30 seconds)
  const rotationCycle = Math.floor(time / NPC_ROTATION_INTERVAL);
  
  // Get starting offset for this NPC
  const offset = npcRotationOffsets.get(npcId)!;
  
  // Calculate current index (rotates every 30 seconds)
  const currentIndex = (offset + rotationCycle) % items.length;
  
  return items[currentIndex];
}

function updateNPCClickAreas(centerX: number, centerY: number, plazaRadius: number): void {
  const p = SCALE;
  const npcRadius = plazaRadius * 0.7;
  const stalls: Array<{
    angle: number;
    tab: 'hats' | 'shirts' | 'legs' | 'capes' | 'wings' | 'accessories' | 'boosts' | 'pets';
    rarity: ItemRarity;
    name: string;
  }> = [
    { angle: 0, tab: 'hats', rarity: 'legendary', name: 'Hat Merchant' },
    { angle: Math.PI / 4, tab: 'shirts', rarity: 'legendary', name: 'Shirt Vendor' },
    { angle: Math.PI / 2, tab: 'legs', rarity: 'legendary', name: 'Legwear Shop' },
    { angle: 3 * Math.PI / 4, tab: 'capes', rarity: 'legendary', name: 'Cape Trader' },
    { angle: Math.PI, tab: 'wings', rarity: 'legendary', name: 'Wings Merchant' },
    { angle: 5 * Math.PI / 4, tab: 'accessories', rarity: 'legendary', name: 'Accessories' },
    { angle: 3 * Math.PI / 2, tab: 'boosts', rarity: 'legendary', name: 'Boost Dealer' },
    { angle: 7 * Math.PI / 4, tab: 'pets', rarity: 'legendary', name: 'Pet Merchant' },
  ];
  
  npcStalls = stalls.map(stall => ({
    x: centerX + Math.cos(stall.angle) * npcRadius,
    y: centerY + Math.sin(stall.angle) * npcRadius,
    tab: stall.tab,
    rarity: stall.rarity,
    name: stall.name,
  }));
}

// Check if a click is on an NPC stall (returns stall even if far away, for movement targeting)
export function getClickedNPCStall(worldX: number, worldY: number): NPCStall | null {
  const p = SCALE;
  const clickRadius = 30 * p; // Click detection radius (larger for easier clicking)
  
  for (const stall of npcStalls) {
    const dx = worldX - stall.x;
    const dy = worldY - stall.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < clickRadius) {
      return stall;
    }
  }
  return null;
}

// Check if mouse is hovering over an NPC stall
export function getHoveredNPCStall(worldX: number, worldY: number): NPCStall | null {
  const p = SCALE;
  const hoverRadius = 35 * p; // Hover detection radius (slightly larger than click)
  
  for (const stall of npcStalls) {
    const dx = worldX - stall.x;
    const dy = worldY - stall.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < hoverRadius) {
      return stall;
    }
  }
  return null;
}

// Check if player is within interaction range of an NPC stall
export function isPlayerInNPCStallRange(playerX: number, playerY: number, stall: NPCStall): boolean {
  const p = SCALE;
  const activationRadius = 25 * p; // Same as shrine activation radius
  
  // Scale stall coordinates
  const stallX = stall.x;
  const stallY = stall.y;
  
  // Scale player coordinates
  const scaledPlayerX = playerX * SCALE;
  const scaledPlayerY = playerY * SCALE;
  
  const dx = scaledPlayerX - stallX;
  const dy = scaledPlayerY - stallY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  return dist < activationRadius;
}

// NPC speech bubble state (stores current speech bubbles for each NPC)
interface NPCSpeechBubble {
  text: string;
  createdAt: number;
}

const npcSpeechBubbles: Map<string, NPCSpeechBubble> = new Map();
const npcSpeechOffsets: Map<string, number> = new Map(); // Random timing offsets for each NPC to stagger speech
const NPC_SPEECH_INTERVAL = 10000; // Base interval between speech attempts
const NPC_SPEECH_CHANCE = 0.4; // 40% chance to speak each interval

// Get speech messages for NPCs based on what they sell
function getNPCSpeechMessages(tab: 'hats' | 'shirts' | 'legs' | 'capes' | 'wings' | 'accessories' | 'boosts' | 'pets', rarity: ItemRarity): string[] {
  const rarityName = rarity.charAt(0).toUpperCase() + rarity.slice(1);
  
  switch (tab) {
    case 'hats':
      return [
        `Best ${rarityName} Hats!`,
        `Fine ${rarityName} Headwear!`,
        `Hats for Sale!`,
        `Get Your ${rarityName} Hat!`,
        `Top Quality Hats!`
      ];
    case 'shirts':
      return [
        `Premium ${rarityName} Shirts!`,
        `Quality Apparel Here!`,
        `${rarityName} Shirts for Sale!`,
        `Best Shirts in Town!`,
        `Fine Clothing Available!`
      ];
    case 'legs':
      return [
        `${rarityName} Legwear!`,
        `Quality Pants & Legs!`,
        `Fine Legwear Here!`,
        `Best ${rarityName} Legs!`,
        `Legwear for Sale!`
      ];
    case 'capes':
      return [
        `Epic ${rarityName} Capes!`,
        `Fine Capes Available!`,
        `Capes for Sale!`,
        `Best ${rarityName} Capes!`,
        `Quality Capes Here!`
      ];
    case 'wings':
      return [
        `Epic ${rarityName} Wings!`,
        `Fine Wings Available!`,
        `Wings for Sale!`,
        `Best ${rarityName} Wings!`,
        `Quality Wings Here!`
      ];
    case 'accessories':
      return [
        `${rarityName} Accessories!`,
        `Fine Accessories Here!`,
        `Quality Accessories!`,
        `Best ${rarityName} Items!`,
        `Accessories for Sale!`
      ];
    case 'boosts':
      return [
        `Orb Boosts Here!`,
        `Get More Orbs!`,
        `Powerful Boosts!`,
        `Increase Your Orbs!`,
        `Best Boosts Available!`
      ];
    case 'pets':
      return [
        `Legendary Pets!`,
        `Loyal Companions!`,
        `Pets for Sale!`,
        `Best ${rarityName} Pets!`,
        `Adopt a Pet Today!`
      ];
    default:
      return ['Items for Sale!'];
  }
}

// Update NPC speech bubbles (randomly generate new ones with staggered timing)
function updateNPCSpeechBubbles(stalls: Array<{ tab: 'hats' | 'shirts' | 'legs' | 'capes' | 'wings' | 'accessories' | 'boosts' | 'pets'; rarity: ItemRarity; name: string }>, time: number): void {
  for (const stall of stalls) {
    const npcId = `npc_${stall.tab}_${stall.rarity}`;
    
    // Initialize random offset for this NPC (once, persists across calls)
    if (!npcSpeechOffsets.has(npcId)) {
      // Each NPC gets a random offset between 0 and 10 seconds to stagger their speech
      npcSpeechOffsets.set(npcId, Math.random() * NPC_SPEECH_INTERVAL);
    }
    
    const offset = npcSpeechOffsets.get(npcId)!;
    const existingBubble = npcSpeechBubbles.get(npcId);
    
    // Check if bubble has expired
    if (existingBubble && time - existingBubble.createdAt > GAME_CONSTANTS.CHAT_BUBBLE_DURATION) {
      npcSpeechBubbles.delete(npcId);
    }
    
    // Use staggered time check - each NPC checks at different times
    const staggeredTime = (time + offset) % (NPC_SPEECH_INTERVAL * 2);
    
    // Only check for new speech in a small window (prevents all NPCs from speaking at once)
    if (staggeredTime < 500 && !existingBubble) {
      // Random chance to speak
      if (Math.random() < NPC_SPEECH_CHANCE) {
        const messages = getNPCSpeechMessages(stall.tab, stall.rarity);
        const randomMessage = messages[Math.floor(Math.random() * messages.length)];
        npcSpeechBubbles.set(npcId, {
          text: randomMessage,
          createdAt: time
        });
      }
    }
  }
}

// Draw NPCs in plaza (called from drawForestFountain)
function drawNPCStalls(ctx: CanvasRenderingContext2D, centerX: number, centerY: number, plazaRadius: number, time: number, deltaTime: number, hoveredStall?: { tab: 'hats' | 'shirts' | 'legs' | 'capes' | 'wings' | 'accessories' | 'boosts' | 'pets'; rarity: ItemRarity } | null): void {
  const p = SCALE;
  const npcRadius = plazaRadius * 0.7;
  const npcPodiumRadius = 35 * p; // Radius of each NPC podium
  
  const stalls: Array<{
    angle: number;
    tab: 'hats' | 'shirts' | 'legs' | 'capes' | 'wings' | 'accessories' | 'boosts' | 'pets' | undefined;
    rarity: ItemRarity;
    name: string;
  }> = [
    { angle: 0, tab: 'hats', rarity: 'legendary', name: 'Hat Merchant' },
    { angle: Math.PI / 4, tab: 'shirts', rarity: 'legendary', name: 'Shirt Vendor' },
    { angle: Math.PI / 2, tab: 'legs', rarity: 'legendary', name: 'Legwear Shop' },
    { angle: 3 * Math.PI / 4, tab: 'capes', rarity: 'legendary', name: 'Cape Trader' },
    { angle: Math.PI, tab: 'wings', rarity: 'legendary', name: 'Wings Merchant' },
    { angle: 5 * Math.PI / 4, tab: 'accessories', rarity: 'legendary', name: 'Accessories' },
    { angle: 3 * Math.PI / 2, tab: 'boosts', rarity: 'legendary', name: 'Boost Dealer' },
    { angle: 7 * Math.PI / 4, tab: 'pets', rarity: 'legendary', name: 'Pet Merchant' }, // 8th NPC - Pet Merchant
  ];
  
  // Update NPC speech bubbles
  updateNPCSpeechBubbles(stalls.filter(s => s.tab !== undefined) as Array<{ tab: 'hats' | 'shirts' | 'legs' | 'capes' | 'wings' | 'accessories' | 'boosts' | 'pets'; rarity: ItemRarity; name: string }>, time);
  
  for (const stall of stalls) {
    // Skip unassigned NPC (8th one)
    if (!stall.tab) continue;
    
    const npcX = centerX + Math.cos(stall.angle) * npcRadius;
    const npcY = centerY + Math.sin(stall.angle) * npcRadius;
    
    // Calculate top platform Y position (elevated above base)
    // The top platform is elevated: midPlatformY (y - 8p) - 6p = y - 14p
    const topPlatformElevation = 14 * SCALE; // Total elevation of top platform
    const npcTopY = npcY - topPlatformElevation; // Y position of top platform center
    
    // Check if this stall is hovered
    const isHovered = hoveredStall && hoveredStall.tab === stall.tab && hoveredStall.rarity === stall.rarity;
    
    // Draw yellow glow effect when hovered (before NPC)
    if (isHovered) {
      ctx.save();
      // Draw bright yellow glow ring around NPC/stall (on top platform)
      ctx.globalAlpha = 0.6;
      const gradient = ctx.createRadialGradient(npcX, npcTopY, 0, npcX, npcTopY, 30 * p);
      gradient.addColorStop(0, 'rgba(255, 215, 0, 0.8)');
      gradient.addColorStop(0.5, 'rgba(255, 215, 0, 0.4)');
      gradient.addColorStop(1, 'rgba(255, 215, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(npcX, npcTopY, 30 * p, 0, Math.PI * 2);
      ctx.fill();
      
      // Draw outer glow ring
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = 'rgba(255, 215, 0, 0.8)';
      ctx.lineWidth = 4 * p;
      ctx.beginPath();
      ctx.arc(npcX, npcTopY, 25 * p, 0, Math.PI * 2);
      ctx.stroke();
      
      ctx.globalAlpha = 1;
      ctx.restore();
      
      // Set shadow for NPC drawing (will be applied to the NPC sprite)
      ctx.shadowBlur = 30 * p;
      ctx.shadowColor = 'rgba(255, 215, 0, 1.0)'; // Yellow glow for NPC elements
    }
    
    // Note: Podium is drawn in background layer, so we don't draw it here
    // NPC is centered on the top platform of the podium (which is elevated)
    // Player sprites use top-left coordinates, so we need to offset by half player dimensions
    const npcPlayerX = (npcX / SCALE) - (PLAYER_WIDTH / 2);
    const npcPlayerY = (npcTopY / SCALE) - (PLAYER_HEIGHT / 2);
    
    // Get current legendary item for this NPC based on rotation
    const npcId = `npc_${stall.tab}_${stall.rarity}`;
    const currentItemId = getCurrentLegendaryItem(stall.tab, npcId, time);
    
    // Build outfit based on category
    const outfit: string[] = [];
    if (currentItemId) {
      if (stall.tab === 'hats') {
        outfit.push(currentItemId);
      } else if (stall.tab === 'shirts') {
        outfit.push(currentItemId);
      } else if (stall.tab === 'legs') {
        outfit.push(currentItemId);
      } else if (stall.tab === 'capes') {
        outfit.push(currentItemId);
      } else if (stall.tab === 'wings') {
        outfit.push(currentItemId);
      } else if (stall.tab === 'accessories') {
        outfit.push(currentItemId);
      } else if (stall.tab === 'boosts') {
        outfit.push(currentItemId);
      }
    }
    
    // Create NPC player object with appropriate costume
    // Cape Trader faces away (up) to show their back/cape, others face down
    const npcDirection = (stall.tab === 'capes' && stall.rarity === 'legendary') ? 'up' : 'down';
    
    const speechBubble = npcSpeechBubbles.get(npcId);
    
    // Draw animated lightbeam above trader's head (BEFORE NPC so it's behind nameplate)
    const headY = npcTopY - (PLAYER_HEIGHT * SCALE) / 2; // Top of NPC head (on top platform)
    const traderBeamHeight = 80 * p;
    const traderBeamWidth = 6 * p;
    const traderBeamX = npcX - traderBeamWidth / 2;
    const traderBeamStartY = headY - 5 * p; // Slightly above head
    
    // Animate trader beam (pulsing and intensity)
    const traderPulse = Math.sin(time * 0.003 + stall.angle) * 0.2 + 1; // Each trader pulses at different phase
    const traderIntensity = Math.sin(time * 0.002 + stall.angle) * 0.25 + 0.75;
    const animatedTraderBeamWidth = traderBeamWidth * traderPulse;
    const animatedTraderBeamX = npcX - animatedTraderBeamWidth / 2;
    
    // Trader lightbeam gradient
    const traderBeamGradient = ctx.createLinearGradient(
      animatedTraderBeamX, 
      traderBeamStartY, 
      animatedTraderBeamX, 
      traderBeamStartY - traderBeamHeight
    );
    traderBeamGradient.addColorStop(0, `rgba(255, 255, 255, ${traderIntensity})`);
    traderBeamGradient.addColorStop(0.3, `rgba(200, 230, 255, ${traderIntensity * 0.7})`);
    traderBeamGradient.addColorStop(0.6, `rgba(150, 200, 255, ${traderIntensity * 0.4})`);
    traderBeamGradient.addColorStop(1, 'rgba(100, 180, 255, 0)');
    
    // Draw trader beam
    ctx.fillStyle = traderBeamGradient;
    ctx.fillRect(
      animatedTraderBeamX, 
      traderBeamStartY - traderBeamHeight, 
      animatedTraderBeamWidth, 
      traderBeamHeight
    );
    
    // Batch shadow operations for trader beam
    ctx.shadowBlur = 15 * p * traderPulse;
    ctx.shadowColor = `rgba(100, 200, 255, ${traderIntensity * 0.5})`;
    
    // Trader beam outer glow
    ctx.fillRect(
      animatedTraderBeamX - 2 * p, 
      traderBeamStartY - traderBeamHeight, 
      animatedTraderBeamWidth + 4 * p, 
      traderBeamHeight
    );
    
    // Trader beam inner core (reuse shadow)
    const traderCoreGradient = ctx.createLinearGradient(
      animatedTraderBeamX, 
      traderBeamStartY, 
      animatedTraderBeamX, 
      traderBeamStartY - traderBeamHeight * 0.6
    );
    traderCoreGradient.addColorStop(0, `rgba(255, 255, 255, ${traderIntensity * 0.6})`);
    traderCoreGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = traderCoreGradient;
    ctx.fillRect(
      animatedTraderBeamX + 1 * p, 
      traderBeamStartY - traderBeamHeight * 0.6, 
      animatedTraderBeamWidth - 2 * p, 
      traderBeamHeight * 0.6
    );
    
    // Reset shadow after trader beam operations
    ctx.shadowBlur = 0;
    
    // Trader beam shimmer effect
    const traderShimmerOffset = ((time * 0.0015 + stall.angle) % (traderBeamHeight * 0.4));
    const traderShimmerGradient = ctx.createLinearGradient(
      animatedTraderBeamX, 
      traderBeamStartY - traderShimmerOffset, 
      animatedTraderBeamX, 
      traderBeamStartY - traderShimmerOffset - traderBeamHeight * 0.25
    );
    traderShimmerGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
    traderShimmerGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.3)');
    traderShimmerGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = traderShimmerGradient;
    ctx.fillRect(
      animatedTraderBeamX, 
      traderBeamStartY - traderBeamHeight, 
      animatedTraderBeamWidth, 
      traderBeamHeight
    );
    
    const npcPlayer: PlayerWithChat = {
      id: npcId,
      name: stall.name,
      x: npcPlayerX, // Positioned so center aligns with stall center
      y: npcPlayerY, // Positioned so center aligns with stall center
      direction: npcDirection,
      orbs: 0,
      roomId: '', // NPCs don't need a room ID
      sprite: {
        body: 'default',
        outfit: outfit,
      },
      chatBubble: speechBubble ? {
        text: speechBubble.text,
        createdAt: speechBubble.createdAt
      } : undefined,
    };
    
    // Draw NPC (on top of stall, centered) - draw nameplate normally
    drawPlayer(ctx, npcPlayer, false, time, false);
    
    // Reset shadow after drawing NPC (so it doesn't affect other elements)
    if (isHovered) {
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
    }
    
    // Draw NPC speech bubble if they have one (zoom is already applied to context)
    if (npcPlayer.chatBubble) {
      // Get zoom from context transform
      const zoom = ctx.getTransform().a || 1;
      drawChatBubble(ctx, npcPlayer, time, zoom);
    }
    
    // Boost Dealer shoots fake orbs from head to feet (keep custom animation)
    if (stall.tab === 'boosts' && stall.rarity === 'legendary') {
      // Calculate head position (top center of NPC sprite)
      const headX = npcX; // Center of NPC
      const headY = npcTopY - (PLAYER_HEIGHT * SCALE) / 2; // Top of NPC (on top platform)
      // Calculate feet position (bottom center of NPC sprite)
      const feetY = npcTopY + (PLAYER_HEIGHT * SCALE) / 2; // Bottom of NPC (on top platform)
      
      spawnBoostDealerOrb(headX, headY, feetY);
    }
    
    // Pet Merchant has a pet next to it that cycles every 30 seconds
    if (stall.tab && stall.tab === 'pets' && stall.rarity === 'legendary') {
      const currentPetId = getCurrentLegendaryItem('pets', npcId, time);
      if (currentPetId) {
        // Position pet closer to the NPC's shoulder (left side, upper body area)
        const petOffsetX = -8; // Closer horizontal offset (in unscaled pixels)
        const petOffsetY = -6; // Vertical offset to align with shoulder area (in unscaled pixels)
        const petX = npcPlayerX + PLAYER_WIDTH / 2 + petOffsetX; // From center of NPC
        const petY = npcPlayerY + PLAYER_HEIGHT / 3 + petOffsetY; // Upper third for shoulder area
        
        // Draw the pet with bobbing animation
        const petScaledX = petX * SCALE;
        const petScaledY = petY * SCALE;
        const bobOffset = Math.sin(time * 0.003) * PET_BOBBING_AMPLITUDE * p;
        const finalY = petScaledY + bobOffset;
        
        // Draw pet based on type
        if (currentPetId === 'pet_golden') {
          drawGoldenPet(ctx, petScaledX, finalY, p, time);
        } else if (currentPetId === 'pet_phoenix') {
          drawPhoenixPet(ctx, petScaledX, finalY, p, time);
        } else if (currentPetId === 'pet_void') {
          drawVoidPet(ctx, petScaledX, finalY, p, time);
        } else if (currentPetId === 'pet_celestial') {
          drawCelestialPet(ctx, petScaledX, finalY, p, time);
        } else if (currentPetId === 'pet_galaxy') {
          drawGalaxyPet(ctx, petScaledX, finalY, p, time);
        } else if (currentPetId === 'pet_rainbow') {
          drawRainbowPet(ctx, petScaledX, finalY, p, time);
        }
      }
    }
  }
  
  // Update and draw Boost Dealer fake orb particles
  updateAndDrawBoostDealerOrbs(ctx, deltaTime);
}


// Draw animated fountain in center of forest map
// Note: Camera transform is already applied to ctx, so we draw in world coordinates
// Helper function to draw a wooden merchant stall
function drawWoodenStall(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const p = SCALE;
  
  // Stall base/platform (wooden planks)
  const stallWidth = 50 * p;
  const stallHeight = 40 * p;
  const stallX = x - stallWidth / 2;
  const stallY = y - stallHeight / 2;
  
  // Wooden platform (dark brown wood)
  ctx.fillStyle = '#5a3a2a'; // Dark brown wood
  ctx.fillRect(stallX, stallY + stallHeight * 0.6, stallWidth, stallHeight * 0.4);
  
  // Wood planks texture
  ctx.strokeStyle = '#4a2a1a';
  ctx.lineWidth = 1 * p;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(stallX + (i * stallWidth / 4), stallY + stallHeight * 0.6);
    ctx.lineTo(stallX + (i * stallWidth / 4), stallY + stallHeight);
    ctx.stroke();
  }
  
  // Stall posts (support beams)
  ctx.fillStyle = '#4a2a1a'; // Darker brown for posts
  const postWidth = 3 * p;
  const postHeight = 25 * p;
  // Front left post
  ctx.fillRect(stallX + 5 * p, stallY + stallHeight * 0.4, postWidth, postHeight);
  // Front right post
  ctx.fillRect(stallX + stallWidth - 5 * p - postWidth, stallY + stallHeight * 0.4, postWidth, postHeight);
  // Back left post
  ctx.fillRect(stallX + 5 * p, stallY + stallHeight * 0.6, postWidth, postHeight * 0.3);
  // Back right post
  ctx.fillRect(stallX + stallWidth - 5 * p - postWidth, stallY + stallHeight * 0.6, postWidth, postHeight * 0.3);
  
  // Counter/shelf (front of stall)
  ctx.fillStyle = '#6a4a3a'; // Medium brown
  ctx.fillRect(stallX, stallY + stallHeight * 0.5, stallWidth, 8 * p);
  
  // Counter top highlight
  ctx.fillStyle = '#7a5a4a';
  ctx.fillRect(stallX, stallY + stallHeight * 0.5, stallWidth, 2 * p);
  
  // Counter front edge
  ctx.fillStyle = '#4a2a1a';
  ctx.fillRect(stallX, stallY + stallHeight * 0.5 + 8 * p, stallWidth, 2 * p);
  
  // Awning/roof (wooden shingles)
  ctx.fillStyle = '#5a3a2a';
  ctx.beginPath();
  ctx.moveTo(stallX - 4 * p, stallY + stallHeight * 0.4);
  ctx.lineTo(stallX + stallWidth / 2, stallY);
  ctx.lineTo(stallX + stallWidth + 4 * p, stallY + stallHeight * 0.4);
  ctx.lineTo(stallX + stallWidth, stallY + stallHeight * 0.4);
  ctx.lineTo(stallX, stallY + stallHeight * 0.4);
  ctx.closePath();
  ctx.fill();
  
  // Roof shingles (wooden planks)
  ctx.strokeStyle = '#4a2a1a';
  ctx.lineWidth = 1 * p;
  for (let i = 0; i < 6; i++) {
    const shingleX = stallX + (i * stallWidth / 6);
    const shingleY = stallY + (i * stallHeight * 0.4 / 6);
    ctx.beginPath();
    ctx.moveTo(shingleX, shingleY + stallHeight * 0.4);
    ctx.lineTo(shingleX + stallWidth / 6, shingleY);
    ctx.stroke();
  }
  
  // Stall shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.beginPath();
  ctx.ellipse(x, y + stallHeight * 0.8, stallWidth * 0.6, stallHeight * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
}

// Helper function to draw a circular podium with stairs
function drawPodiumWithStairs(ctx: CanvasRenderingContext2D, x: number, y: number, podiumRadius: number, stairCount: number = 8): void {
  const p = SCALE;
  const stairWidth = 10 * p;
  const stairHeight = 4 * p;
  const stairSpacing = 2 * p; // Space between stairs
  
  // === TIER 1: BASE PLATFORM ===
  const baseRadius = podiumRadius + (stairWidth + stairSpacing) * 2;
  
  // Base shadow
  ctx.fillStyle = '#2a2a1a';
  ctx.beginPath();
  ctx.arc(x, y, baseRadius + 2 * p, 0, Math.PI * 2);
  ctx.fill();
  
  // Base platform
  ctx.fillStyle = '#5a5a4a';
  ctx.beginPath();
  ctx.arc(x, y, baseRadius, 0, Math.PI * 2);
  ctx.fill();
  
  // Base rim
  ctx.strokeStyle = '#6a6a5a';
  ctx.lineWidth = 3 * p;
  ctx.beginPath();
  ctx.arc(x, y, baseRadius, 0, Math.PI * 2);
  ctx.stroke();
  
  // Stone block pattern on base (radial lines)
  ctx.strokeStyle = '#4a4a3a';
  ctx.lineWidth = 2 * p;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * baseRadius, y + Math.sin(angle) * baseRadius);
    ctx.stroke();
  }
  
  // Circular stone ring on base
  ctx.strokeStyle = '#4a4a3a';
  ctx.lineWidth = 2 * p;
  ctx.beginPath();
  ctx.arc(x, y, baseRadius * 0.7, 0, Math.PI * 2);
  ctx.stroke();
  
  // === TIER 2: MIDDLE PLATFORM WITH STAIRS ===
  const midRadius = podiumRadius + (stairWidth + stairSpacing);
  const midPlatformY = y - 8 * p; // Slightly elevated
  
  // Middle platform shadow
  ctx.fillStyle = '#3a3a2a';
  ctx.beginPath();
  ctx.arc(x, midPlatformY, midRadius + 2 * p, 0, Math.PI * 2);
  ctx.fill();
  
  // Middle platform
  ctx.fillStyle = '#6a6a5a';
  ctx.beginPath();
  ctx.arc(x, midPlatformY, midRadius, 0, Math.PI * 2);
  ctx.fill();
  
  // Middle platform rim
  ctx.strokeStyle = '#7a7a6a';
  ctx.lineWidth = 2 * p;
  ctx.beginPath();
  ctx.arc(x, midPlatformY, midRadius, 0, Math.PI * 2);
  ctx.stroke();
  
  // Draw stairs around the middle platform
  for (let step = 0; step < 2; step++) {
    const stepRadius = podiumRadius + (step * (stairWidth + stairSpacing));
    const stepsForThisLevel = Math.max(stairCount, Math.ceil((Math.PI * 2 * stepRadius) / (stairWidth * 0.8)));
    
    // Stair base (dark grey for gaps)
    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.arc(x, y, stepRadius + stairWidth / 2, 0, Math.PI * 2);
    if (step > 0) {
      const innerRadius = podiumRadius + ((step - 1) * (stairWidth + stairSpacing)) + stairWidth / 2;
      ctx.arc(x, y, innerRadius, 0, Math.PI * 2, true);
    } else {
      ctx.arc(x, y, podiumRadius, 0, Math.PI * 2, true);
    }
    ctx.fill();
    
    // Draw individual stairs
    for (let i = 0; i < stepsForThisLevel; i++) {
      const angle = (i / stepsForThisLevel) * Math.PI * 2;
      const stairX = x + Math.cos(angle) * stepRadius;
      const stairY = y + Math.sin(angle) * stepRadius;
      
      // Stair step
      ctx.fillStyle = '#6a6a5a';
      ctx.save();
      ctx.translate(stairX, stairY);
      ctx.rotate(angle + Math.PI / 2);
      ctx.fillRect(-stairWidth / 2, -stairHeight / 2, stairWidth, stairHeight);
      ctx.restore();
      
      // Stair highlight
      ctx.fillStyle = '#7a7a6a';
      ctx.save();
      ctx.translate(stairX, stairY);
      ctx.rotate(angle + Math.PI / 2);
      ctx.fillRect(-stairWidth / 2, -stairHeight / 2, stairWidth, 1 * p);
      ctx.restore();
      
      // Stair shadow
      ctx.fillStyle = '#4a4a3a';
      ctx.save();
      ctx.translate(stairX, stairY);
      ctx.rotate(angle + Math.PI / 2);
      ctx.fillRect(-stairWidth / 2, stairHeight / 2, stairWidth, 1 * p);
      ctx.restore();
    }
  }
  
  // === TIER 3: TOP PLATFORM ===
  const topPlatformY = midPlatformY - 6 * p; // Elevated above middle
  
  // Top platform shadow
  ctx.fillStyle = '#4a4a3a';
  ctx.beginPath();
  ctx.arc(x, topPlatformY, podiumRadius + 1 * p, 0, Math.PI * 2);
  ctx.fill();
  
  // Top platform base (side wall)
  ctx.fillStyle = '#6a6a5a';
  ctx.beginPath();
  ctx.arc(x, topPlatformY, podiumRadius, 0, Math.PI * 2);
  ctx.fill();
  
  // Stone block pattern on top platform (radial lines)
  ctx.strokeStyle = '#5a5a4a';
  ctx.lineWidth = 1.5 * p;
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, topPlatformY);
    ctx.lineTo(x + Math.cos(angle) * podiumRadius, topPlatformY + Math.sin(angle) * podiumRadius);
    ctx.stroke();
  }
  
  // Top platform surface (grey floor)
  ctx.fillStyle = '#7a7a6a';
  ctx.beginPath();
  ctx.arc(x, topPlatformY, podiumRadius - 2 * p, 0, Math.PI * 2);
  ctx.fill();
  
  // Top platform rim (decorative edge)
  ctx.strokeStyle = '#8a8a7a';
  ctx.lineWidth = 2 * p;
  ctx.beginPath();
  ctx.arc(x, topPlatformY, podiumRadius - 2 * p, 0, Math.PI * 2);
  ctx.stroke();
  
  // Decorative corner stones (4 corners)
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4; // Offset by 45 degrees
    const stoneX = x + Math.cos(angle) * (podiumRadius * 0.7);
    const stoneY = topPlatformY + Math.sin(angle) * (podiumRadius * 0.7);
    
    // Carved stone block
    ctx.fillStyle = '#4a4a3a';
    ctx.fillRect(stoneX - 3 * p, stoneY - 3 * p, 6 * p, 6 * p);
    
    // Stone block highlight
    ctx.fillStyle = '#5a5a4a';
    ctx.fillRect(stoneX - 2.5 * p, stoneY - 2.5 * p, 5 * p, 1.5 * p);
  }
}

// Draw guard tower (multi-tiered stone tower for centurions and flags)
// Exported so it can be called separately after players/terrain
export function drawGuardTower(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, flagIndex: number): void {
  const p = SCALE;
  const baseRadius = 45 * p; // Base radius (wide)
  const midRadius = 40 * p; // Middle tier
  const topRadius = 35 * p; // Top platform radius (wide enough for centurion)
  const topCylinderHeight = 60 * p; // Height of the tall top cylinder (3rd layer)
  const poleHeight = 30 * p; // Height of thin stone pole
  const flagPoleHeight = 35 * p; // Height of flag pole above stone pole
  
  // === TIER 1: BASE PLATFORM ===
  // Base shadow
  ctx.fillStyle = '#2a2a1a';
  ctx.beginPath();
  ctx.arc(x, y, baseRadius + 2 * p, 0, Math.PI * 2);
  ctx.fill();
  
  // Base platform
  ctx.fillStyle = '#5a5a4a';
  ctx.beginPath();
  ctx.arc(x, y, baseRadius, 0, Math.PI * 2);
  ctx.fill();
  
  // Base rim
  ctx.strokeStyle = '#6a6a5a';
  ctx.lineWidth = 3 * p;
  ctx.beginPath();
  ctx.arc(x, y, baseRadius, 0, Math.PI * 2);
  ctx.stroke();
  
  // Stone block pattern on base (radial lines)
  ctx.strokeStyle = '#4a4a3a';
  ctx.lineWidth = 2 * p;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * baseRadius, y + Math.sin(angle) * baseRadius);
    ctx.stroke();
  }
  
  // === TIER 2: MIDDLE PLATFORM ===
  const midPlatformY = y - 10 * p;
  
  // Middle platform shadow
  ctx.fillStyle = '#3a3a2a';
  ctx.beginPath();
  ctx.arc(x, midPlatformY, midRadius + 2 * p, 0, Math.PI * 2);
  ctx.fill();
  
  // Middle platform
  ctx.fillStyle = '#6a6a5a';
  ctx.beginPath();
  ctx.arc(x, midPlatformY, midRadius, 0, Math.PI * 2);
  ctx.fill();
  
  // Middle platform rim
  ctx.strokeStyle = '#7a7a6a';
  ctx.lineWidth = 2 * p;
  ctx.beginPath();
  ctx.arc(x, midPlatformY, midRadius, 0, Math.PI * 2);
  ctx.stroke();
  
  // === TIER 3: TALL TOP CYLINDER (where centurion stands) ===
  const topPlatformY = midPlatformY - 8 * p;
  const topCylinderTopY = topPlatformY - topCylinderHeight;
  
  // Top platform base (bottom of cylinder)
  ctx.fillStyle = '#6a6a5a';
  ctx.beginPath();
  ctx.arc(x, topPlatformY, topRadius, 0, Math.PI * 2);
  ctx.fill();
  
  // Top platform rim (bottom)
  ctx.strokeStyle = '#7a7a6a';
  ctx.lineWidth = 2 * p;
  ctx.beginPath();
  ctx.arc(x, topPlatformY, topRadius, 0, Math.PI * 2);
  ctx.stroke();
  
  // Tall cylinder body (the 3rd layer that goes up)
  ctx.fillStyle = '#6a6a5a';
  ctx.fillRect(x - topRadius, topPlatformY - topCylinderHeight, topRadius * 2, topCylinderHeight);
  
  // Cylinder side shading (for depth)
  ctx.fillStyle = '#5a5a4a';
  ctx.fillRect(x + topRadius - 2 * p, topPlatformY - topCylinderHeight, 2 * p, topCylinderHeight);
  
  // Cylinder horizontal bands (stone block pattern)
  for (let i = 0; i < 6; i++) {
    const bandY = topPlatformY - (i * topCylinderHeight / 7);
    ctx.fillStyle = '#4a4a3a';
    ctx.fillRect(x - topRadius, bandY - 1 * p, topRadius * 2, 2 * p);
  }
  
  // Top platform surface (top of cylinder - where centurion stands)
  ctx.fillStyle = '#7a7a6a';
  ctx.beginPath();
  ctx.arc(x, topCylinderTopY, topRadius - 2 * p, 0, Math.PI * 2);
  ctx.fill();
  
  // Top platform rim (top)
  ctx.strokeStyle = '#8a8a7a';
  ctx.lineWidth = 2 * p;
  ctx.beginPath();
  ctx.arc(x, topCylinderTopY, topRadius - 2 * p, 0, Math.PI * 2);
  ctx.stroke();
  
  // Stone block pattern on top surface (radial lines)
  ctx.strokeStyle = '#5a5a4a';
  ctx.lineWidth = 1.5 * p;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, topCylinderTopY);
    ctx.lineTo(x + Math.cos(angle) * (topRadius - 2 * p), topCylinderTopY + Math.sin(angle) * (topRadius - 2 * p));
    ctx.stroke();
  }
  
  // === THIN STONE POLE (on top of cylinder) ===
  const poleRadius = 3 * p; // Thin pole
  const poleTopY = topCylinderTopY - poleHeight;
  
  // Pole shadow
  ctx.fillStyle = '#3a3a2a';
  ctx.beginPath();
  ctx.arc(x, topCylinderTopY, poleRadius + 1 * p, 0, Math.PI * 2);
  ctx.fill();
  
  // Pole base
  ctx.fillStyle = '#5a5a4a';
  ctx.beginPath();
  ctx.arc(x, topCylinderTopY, poleRadius + 1 * p, 0, Math.PI * 2);
  ctx.fill();
  
  // Pole body (thin stone column)
  ctx.fillStyle = '#6a6a5a';
  ctx.fillRect(x - poleRadius, topCylinderTopY - poleHeight, poleRadius * 2, poleHeight);
  
  // Pole details (horizontal bands)
  for (let i = 0; i < 3; i++) {
    const bandY = topCylinderTopY - (i * poleHeight / 4);
    ctx.fillStyle = '#4a4a3a';
    ctx.fillRect(x - poleRadius, bandY - 0.5 * p, poleRadius * 2, 1 * p);
  }
  
  // Pole top (decorative cap)
  ctx.fillStyle = '#7a7a6a';
  ctx.beginPath();
  ctx.arc(x, poleTopY, poleRadius + 1 * p, 0, Math.PI * 2);
  ctx.fill();
  
  // === FLAG ON TOP OF STONE POLE ===
  const flagPoleTopY = poleTopY - flagPoleHeight;
  
  // Flag pole (vertical wooden pole on top of stone pole)
  ctx.fillStyle = '#3a2a1a'; // Dark brown wood
  ctx.fillRect(x - 2 * p, flagPoleTopY, 4 * p, flagPoleHeight);
  
  // Flag pole top (decorative)
  ctx.fillStyle = '#4a3a2a'; // Darker brown
  ctx.beginPath();
  ctx.arc(x, flagPoleTopY, 3 * p, 0, Math.PI * 2);
  ctx.fill();
  
  // Flag banner (waving in the wind)
  const waveOffset = Math.sin(time * 0.001 + flagIndex) * 3 * p;
  ctx.fillStyle = flagIndex % 2 === 0 ? '#8b0000' : '#1a4a8a'; // Red or blue flags
  ctx.beginPath();
  ctx.moveTo(x, flagPoleTopY);
  ctx.lineTo(x + 20 * p + waveOffset, flagPoleTopY + 10 * p);
  ctx.lineTo(x + 20 * p + waveOffset, flagPoleTopY + 20 * p);
  ctx.lineTo(x, flagPoleTopY + 10 * p);
  ctx.closePath();
  ctx.fill();
  
  // Flag border/trim
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1 * p;
  ctx.stroke();
  
  // Flag emblem/symbol (simple design)
  ctx.fillStyle = '#ffd700'; // Gold
  ctx.beginPath();
  if (flagIndex % 2 === 0) {
    // Star on red flags
    const starX = x + 10 * p + waveOffset;
    const starY = flagPoleTopY + 15 * p;
    const starRadius = 4 * p;
    const starPoints = 5;
    for (let j = 0; j < starPoints * 2; j++) {
      const starAngle = (j * Math.PI) / starPoints;
      const r = j % 2 === 0 ? starRadius : starRadius * 0.5;
      const px = starX + Math.cos(starAngle - Math.PI / 2) * r;
      const py = starY + Math.sin(starAngle - Math.PI / 2) * r;
      if (j === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
  } else {
    // Circle on blue flags
    ctx.arc(x + 10 * p + waveOffset, flagPoleTopY + 15 * p, 3 * p, 0, Math.PI * 2);
  }
  ctx.fill();
}

// Build static fountain cache (tiers, pillars, decorative stones - everything that doesn't animate)
function buildFountainStaticCache(): void {
  if (fountainStaticCacheInitialized) return;
  
  const p = SCALE;
  const centerX = WORLD_WIDTH / 2;
  const centerY = WORLD_HEIGHT / 2;
  const baseRadius = 100 * p;
  const midRadius = 80 * p;
  const topRadius = 60 * p;
  const pillarRadius = 8 * p;
  
  // Create cache canvas (large enough for entire fountain structure)
  const cacheSize = 300 * p; // Large enough for fountain + some margin
  fountainStaticCache = document.createElement('canvas');
  fountainStaticCache.width = cacheSize;
  fountainStaticCache.height = cacheSize;
  const cacheCtx = fountainStaticCache.getContext('2d');
  if (!cacheCtx) {
    fountainStaticCacheInitialized = true;
    return;
  }
  
  cacheCtx.imageSmoothingEnabled = false;
  
  // Offset to center the fountain in the cache
  const offsetX = cacheSize / 2;
  const offsetY = cacheSize / 2;
  
  // === TIER 1: LARGE BASE PLATFORM ===
  cacheCtx.fillStyle = '#2a2a1a';
  cacheCtx.beginPath();
  cacheCtx.arc(offsetX, offsetY, baseRadius + 4 * p, 0, Math.PI * 2);
  cacheCtx.fill();
  
  cacheCtx.fillStyle = '#5a5a4a';
  cacheCtx.beginPath();
  cacheCtx.arc(offsetX, offsetY, baseRadius, 0, Math.PI * 2);
  cacheCtx.fill();
  
  cacheCtx.fillStyle = '#6a6a5a';
  cacheCtx.beginPath();
  cacheCtx.arc(offsetX, offsetY, baseRadius, 0, Math.PI * 2);
  cacheCtx.lineWidth = 4 * p;
  cacheCtx.stroke();
  
  cacheCtx.strokeStyle = '#4a4a3a';
  cacheCtx.lineWidth = 2 * p;
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    cacheCtx.beginPath();
    cacheCtx.moveTo(offsetX, offsetY);
    cacheCtx.lineTo(offsetX + Math.cos(angle) * baseRadius, offsetY + Math.sin(angle) * baseRadius);
    cacheCtx.stroke();
  }
  
  for (let ring = 1; ring <= 3; ring++) {
    cacheCtx.strokeStyle = '#4a4a3a';
    cacheCtx.lineWidth = 2 * p;
    cacheCtx.beginPath();
    cacheCtx.arc(offsetX, offsetY, baseRadius * (ring / 4), 0, Math.PI * 2);
    cacheCtx.stroke();
  }
  
  // === TIER 2: MIDDLE PLATFORM WITH PILLARS ===
  const midPlatformY = offsetY - 20 * p;
  
  cacheCtx.fillStyle = '#3a3a2a';
  cacheCtx.beginPath();
  cacheCtx.arc(offsetX, midPlatformY, midRadius + 3 * p, 0, Math.PI * 2);
  cacheCtx.fill();
  
  cacheCtx.fillStyle = '#6a6a5a';
  cacheCtx.beginPath();
  cacheCtx.arc(offsetX, midPlatformY, midRadius, 0, Math.PI * 2);
  cacheCtx.fill();
  
  const pillarCount = 8;
  for (let i = 0; i < pillarCount; i++) {
    const angle = (i / pillarCount) * Math.PI * 2;
    const pillarX = offsetX + Math.cos(angle) * (midRadius * 0.7);
    const pillarY = midPlatformY + Math.sin(angle) * (midRadius * 0.7);
    const pillarHeight = 30 * p;
    
    cacheCtx.fillStyle = '#3a3a2a';
    cacheCtx.beginPath();
    cacheCtx.arc(pillarX, pillarY, pillarRadius + 1 * p, 0, Math.PI * 2);
    cacheCtx.fill();
    
    cacheCtx.fillStyle = '#5a5a4a';
    cacheCtx.beginPath();
    cacheCtx.arc(pillarX, pillarY, pillarRadius + 2 * p, 0, Math.PI * 2);
    cacheCtx.fill();
    
    cacheCtx.fillStyle = '#7a7a6a';
    cacheCtx.fillRect(pillarX - pillarRadius, pillarY - pillarHeight, pillarRadius * 2, pillarHeight);
    
    cacheCtx.fillStyle = '#8a8a7a';
    cacheCtx.fillRect(pillarX - pillarRadius - 2 * p, pillarY - pillarHeight - 4 * p, (pillarRadius + 2 * p) * 2, 4 * p);
    
    cacheCtx.strokeStyle = '#6a6a5a';
    cacheCtx.lineWidth = 1 * p;
    cacheCtx.beginPath();
    cacheCtx.moveTo(pillarX - pillarRadius, pillarY - pillarHeight);
    cacheCtx.lineTo(pillarX + pillarRadius, pillarY - pillarHeight);
    cacheCtx.stroke();
  }
  
  // === TIER 3: TOP PLATFORM WITH FOUNTAIN ===
  const topPlatformY = midPlatformY - 35 * p;
  
  cacheCtx.fillStyle = '#4a4a3a';
  cacheCtx.beginPath();
  cacheCtx.arc(offsetX, topPlatformY, topRadius + 2 * p, 0, Math.PI * 2);
  cacheCtx.fill();
  
  cacheCtx.fillStyle = '#7a7a6a';
  cacheCtx.beginPath();
  cacheCtx.arc(offsetX, topPlatformY, topRadius, 0, Math.PI * 2);
  cacheCtx.fill();
  
  cacheCtx.strokeStyle = '#8a8a7a';
  cacheCtx.lineWidth = 3 * p;
  cacheCtx.beginPath();
  cacheCtx.arc(offsetX, topPlatformY, topRadius, 0, Math.PI * 2);
  cacheCtx.stroke();
  
  // === CENTRAL FOUNTAIN PILLAR ===
  const fountainBaseRadius = 25 * p;
  const fountainPillarHeight = 40 * p;
  const fountainTopY = topPlatformY - fountainPillarHeight;
  
  cacheCtx.fillStyle = '#6a6a5a';
  cacheCtx.beginPath();
  cacheCtx.arc(offsetX, topPlatformY, fountainBaseRadius, 0, Math.PI * 2);
  cacheCtx.fill();
  
  cacheCtx.fillStyle = '#5a5a4a';
  cacheCtx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI / 4) - Math.PI / 8;
    const px = offsetX + Math.cos(angle) * (fountainBaseRadius - 2 * p);
    const py = topPlatformY + Math.sin(angle) * (fountainBaseRadius - 2 * p);
    if (i === 0) cacheCtx.moveTo(px, py);
    else cacheCtx.lineTo(px, py);
  }
  cacheCtx.closePath();
  cacheCtx.fill();
  
  cacheCtx.fillStyle = '#6a6a5a';
  cacheCtx.fillRect(offsetX - (fountainBaseRadius - 4 * p), topPlatformY - fountainPillarHeight, (fountainBaseRadius - 4 * p) * 2, fountainPillarHeight);
  
  for (let i = 0; i < 3; i++) {
    const bandY = topPlatformY - (i * fountainPillarHeight / 4);
    cacheCtx.fillStyle = '#4a4a3a';
    cacheCtx.fillRect(offsetX - (fountainBaseRadius - 4 * p), bandY - 1 * p, (fountainBaseRadius - 4 * p) * 2, 2 * p);
  }
  
  const bowlRadius = 20 * p;
  cacheCtx.fillStyle = '#8a8a7a';
  cacheCtx.beginPath();
  cacheCtx.arc(offsetX, fountainTopY, bowlRadius, 0, Math.PI * 2);
  cacheCtx.fill();
  
  cacheCtx.strokeStyle = '#9a9a8a';
  cacheCtx.lineWidth = 2 * p;
  cacheCtx.beginPath();
  cacheCtx.arc(offsetX, fountainTopY, bowlRadius, 0, Math.PI * 2);
  cacheCtx.stroke();
  
  // Decorative stone carvings
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const stoneX = offsetX + Math.cos(angle) * (topRadius * 0.7);
    const stoneY = topPlatformY + Math.sin(angle) * (topRadius * 0.7);
    
    cacheCtx.fillStyle = '#4a4a3a';
    cacheCtx.fillRect(stoneX - 6 * p, stoneY - 6 * p, 12 * p, 12 * p);
    
    cacheCtx.fillStyle = '#5a5a4a';
    cacheCtx.fillRect(stoneX - 5 * p, stoneY - 5 * p, 10 * p, 2 * p);
  }
  
  fountainStaticCacheInitialized = true;
}

// Build static plaza cache (flag bunting, walls, etc. - everything that doesn't animate)
function buildPlazaStaticCache(): void {
  if (plazaStaticCacheInitialized) return;
  
  const p = SCALE;
  const centerX = WORLD_WIDTH / 2;
  const centerY = WORLD_HEIGHT / 2;
  const plazaRadius = 540 * p;
  const npcRadius = plazaRadius * 0.7;
  
  // Create cache canvas (large enough for entire plaza)
  const cacheSize = plazaRadius * 2.5; // Large enough for plaza + walls + margin
  plazaStaticCache = document.createElement('canvas');
  plazaStaticCache.width = cacheSize;
  plazaStaticCache.height = cacheSize;
  const cacheCtx = plazaStaticCache.getContext('2d');
  if (!cacheCtx) {
    plazaStaticCacheInitialized = true;
    return;
  }
  
  cacheCtx.imageSmoothingEnabled = false;
  
  // Offset to center the plaza in the cache
  const offsetX = cacheSize / 2;
  const offsetY = cacheSize / 2;
  
  // === FLAG BUNTING ===
  const monumentTopY = offsetY - 26 * p;
  const monumentTopRadius = 60 * p;
  const buntingStartHeight = monumentTopY - 10 * p;
  
  const stalls: Array<{
    angle: number;
    tab: 'hats' | 'shirts' | 'legs' | 'capes' | 'wings' | 'accessories' | 'boosts' | 'pets' | undefined;
  }> = [
    { angle: 0, tab: 'hats' },
    { angle: Math.PI / 4, tab: 'shirts' },
    { angle: Math.PI / 2, tab: 'legs' },
    { angle: 3 * Math.PI / 4, tab: 'capes' },
    { angle: Math.PI, tab: 'wings' },
    { angle: 5 * Math.PI / 4, tab: 'accessories' },
    { angle: 3 * Math.PI / 2, tab: 'boosts' },
    { angle: 7 * Math.PI / 4, tab: 'pets' },
  ];
  
  for (const stall of stalls) {
    if (!stall.tab) continue;
    
    const npcX = offsetX + Math.cos(stall.angle) * npcRadius;
    const npcY = offsetY + Math.sin(stall.angle) * npcRadius;
    
    // Calculate top platform Y position (elevated above base)
    const topPlatformElevation = 14 * SCALE;
    const npcTopY = npcY - topPlatformElevation;
    
    // Wooden pole on trader podium (at the edge of the top platform, facing center)
    const poleHeight = 40 * p;
    const poleRadius = 2 * p;
    const poleTopY = npcTopY - poleHeight;
    
    // Position pole at the edge of the platform, facing the center
    const poleOffsetFromCenter = 30 * p;
    const poleX = npcX + Math.cos(stall.angle + Math.PI) * poleOffsetFromCenter;
    const poleY = npcTopY;
    
    // Draw wooden pole
    cacheCtx.fillStyle = '#3a2a1a';
    cacheCtx.fillRect(poleX - poleRadius, poleY - poleHeight, poleRadius * 2, poleHeight);
    
    // Pole top (decorative)
    cacheCtx.fillStyle = '#4a3a2a';
    cacheCtx.beginPath();
    cacheCtx.arc(poleX, poleTopY, poleRadius + 1 * p, 0, Math.PI * 2);
    cacheCtx.fill();
    
    // Calculate bunting start position (from edge of monument top platform)
    const buntingStartX = offsetX + Math.cos(stall.angle) * monumentTopRadius;
    const buntingStartY = buntingStartHeight;
    
    // Calculate bunting end position (top of wooden pole)
    const buntingEndX = poleX;
    const buntingEndY = poleTopY;
    
    // Draw bunting line (rope/string)
    cacheCtx.strokeStyle = '#2a1a0a';
    cacheCtx.lineWidth = 1 * p;
    cacheCtx.beginPath();
    cacheCtx.moveTo(buntingStartX, buntingStartY);
    cacheCtx.lineTo(buntingEndX, buntingEndY);
    cacheCtx.stroke();
    
    // Draw flags along the bunting line
    const distance = Math.sqrt(
      Math.pow(buntingEndX - buntingStartX, 2) + 
      Math.pow(buntingEndY - buntingStartY, 2)
    );
    const flagCount = Math.floor(distance / (12 * p));
    const flagSpacing = distance / flagCount;
    
    for (let i = 1; i < flagCount; i++) {
      const t = i / flagCount;
      const flagX = buntingStartX + (buntingEndX - buntingStartX) * t;
      const flagY = buntingStartY + (buntingEndY - buntingStartY) * t;
      
      // Alternate between red and blue flags
      const isRed = i % 2 === 0;
      const flagColor = isRed ? '#8b0000' : '#1a4a8a';
      
      // Flag size
      const flagWidth = 8 * p;
      const flagHeight = 6 * p;
      
      // Draw flag (triangle shape hanging downward from the rope)
      cacheCtx.fillStyle = flagColor;
      cacheCtx.beginPath();
      cacheCtx.moveTo(flagX, flagY);
      cacheCtx.lineTo(flagX - flagWidth / 2, flagY + flagHeight);
      cacheCtx.lineTo(flagX + flagWidth / 2, flagY + flagHeight);
      cacheCtx.closePath();
      cacheCtx.fill();
      
      // Flag border
      cacheCtx.strokeStyle = '#ffffff';
      cacheCtx.lineWidth = 0.5 * p;
      cacheCtx.stroke();
    }
  }
  
  plazaStaticCacheInitialized = true;
}

// Build static plaza wall top cache (battlements, top surface, stone patterns - everything that doesn't animate)
function buildPlazaWallTopCache(): void {
  if (plazaWallTopCacheInitialized) return;
  
  const p = SCALE;
  const centerX = WORLD_WIDTH / 2;
  const centerY = WORLD_HEIGHT / 2;
  const plazaRadius = 540 * p;
  const wallThickness = 24 * p;
  const wallTopOffset = 12 * p;
  const battlementHeight = 12 * p;
  const battlementCount = 32;
  
  // Pre-compute gate segments if needed
  precomputeGateSegments();
  
  if (precomputedGateSegments === null) return;
  
  // Create cache canvas (large enough for entire wall top)
  const cacheSize = (plazaRadius + wallThickness + wallTopOffset + battlementHeight) * 2.5;
  plazaWallTopCache = document.createElement('canvas');
  plazaWallTopCache.width = cacheSize;
  plazaWallTopCache.height = cacheSize;
  const cacheCtx = plazaWallTopCache.getContext('2d');
  if (!cacheCtx) {
    plazaWallTopCacheInitialized = true;
    return;
  }
  
  cacheCtx.imageSmoothingEnabled = false;
  
  // Offset to center the wall in the cache
  const offsetX = cacheSize / 2;
  const offsetY = cacheSize / 2;
  
  // Draw top surface of wall (with gate openings) - ONLY the wall ring, not the plaza
  cacheCtx.fillStyle = '#6a6a5a';
  // Draw the wall ring segment by segment, skipping gates (using precomputed segments)
  for (const segment of precomputedGateSegments) {
    // Draw this wall segment as a donut arc
    cacheCtx.beginPath();
    // Outer edge arc
    cacheCtx.arc(offsetX, offsetY, plazaRadius + wallThickness + wallTopOffset, segment.wallStartAngle, segment.wallEndAngle, false);
    // Inner edge arc (reverse direction to close the donut)
    cacheCtx.arc(offsetX, offsetY, plazaRadius + wallThickness, segment.wallEndAngle, segment.wallStartAngle, true);
    cacheCtx.closePath();
    cacheCtx.fill();
  }
  
  // Stone block pattern on top surface (only on wall segments, not gates)
  cacheCtx.strokeStyle = '#5a5a4a';
  cacheCtx.lineWidth = 1 * p;
  for (const segment of precomputedGateSegments) {
    // Draw circular stone patterns on this segment
    for (let i = 0; i < 4; i++) {
      const radius = plazaRadius + wallThickness + (i * wallTopOffset / 4);
      cacheCtx.beginPath();
      cacheCtx.arc(offsetX, offsetY, radius, segment.wallStartAngle, segment.wallEndAngle, false);
      cacheCtx.stroke();
    }
    
    // Draw radial stone lines on this segment
    const segmentAngularSpan = segment.wallEndAngle - segment.wallStartAngle;
    const numLines = Math.floor(segmentAngularSpan / (Math.PI * 2) * 24);
    for (let i = 0; i <= numLines; i++) {
      const angle = segment.wallStartAngle + (i / numLines) * segmentAngularSpan;
      const startX = offsetX + Math.cos(angle) * (plazaRadius + wallThickness);
      const startY = offsetY + Math.sin(angle) * (plazaRadius + wallThickness);
      const endX = offsetX + Math.cos(angle) * (plazaRadius + wallThickness + wallTopOffset);
      const endY = offsetY + Math.sin(angle) * (plazaRadius + wallThickness + wallTopOffset);
      
      cacheCtx.beginPath();
      cacheCtx.moveTo(startX, startY);
      cacheCtx.lineTo(endX, endY);
      cacheCtx.stroke();
    }
  }
  
  // Top surface highlight (brighter edge) - only on wall segments
  cacheCtx.strokeStyle = '#7a7a6a';
  cacheCtx.lineWidth = 2 * p;
  for (const segment of precomputedGateSegments) {
    cacheCtx.beginPath();
    cacheCtx.arc(offsetX, offsetY, plazaRadius + wallThickness + wallTopOffset, segment.wallStartAngle, segment.wallEndAngle, false);
    cacheCtx.stroke();
  }
  
  // Draw battlements on outer edge (top of wall)
  for (let i = 0; i < battlementCount; i++) {
    const angle = (i / battlementCount) * Math.PI * 2;
    const nextAngle = ((i + 1) / battlementCount) * Math.PI * 2;
    
    // Skip battlements in gate areas
    if (isInGate(angle) || isInGate(nextAngle)) continue;
    
    const x1 = offsetX + Math.cos(angle) * (plazaRadius + wallThickness + wallTopOffset);
    const y1 = offsetY + Math.sin(angle) * (plazaRadius + wallThickness + wallTopOffset);
    const x2 = offsetX + Math.cos(nextAngle) * (plazaRadius + wallThickness + wallTopOffset);
    const y2 = offsetY + Math.sin(nextAngle) * (plazaRadius + wallThickness + wallTopOffset);
    
    // Battlement (raised section with 3D depth)
    if (i % 2 === 0) {
      // Front face of battlement (facing outward)
      cacheCtx.fillStyle = '#7a7a6a';
      cacheCtx.beginPath();
      cacheCtx.moveTo(x1, y1);
      cacheCtx.lineTo(x2, y2);
      cacheCtx.lineTo(offsetX + Math.cos(nextAngle) * (plazaRadius + wallThickness + wallTopOffset + battlementHeight), offsetY + Math.sin(nextAngle) * (plazaRadius + wallThickness + wallTopOffset + battlementHeight));
      cacheCtx.lineTo(offsetX + Math.cos(angle) * (plazaRadius + wallThickness + wallTopOffset + battlementHeight), offsetY + Math.sin(angle) * (plazaRadius + wallThickness + wallTopOffset + battlementHeight));
      cacheCtx.closePath();
      cacheCtx.fill();
      
      // Top of battlement (highlight)
      cacheCtx.fillStyle = '#8a8a7a';
      cacheCtx.beginPath();
      cacheCtx.moveTo(offsetX + Math.cos(angle) * (plazaRadius + wallThickness + wallTopOffset + battlementHeight), offsetY + Math.sin(angle) * (plazaRadius + wallThickness + wallTopOffset + battlementHeight));
      cacheCtx.lineTo(offsetX + Math.cos(nextAngle) * (plazaRadius + wallThickness + wallTopOffset + battlementHeight), offsetY + Math.sin(nextAngle) * (plazaRadius + wallThickness + wallTopOffset + battlementHeight));
      cacheCtx.lineTo(offsetX + Math.cos(nextAngle) * (plazaRadius + wallThickness + wallTopOffset), offsetY + Math.sin(nextAngle) * (plazaRadius + wallThickness + wallTopOffset));
      cacheCtx.lineTo(offsetX + Math.cos(angle) * (plazaRadius + wallThickness + wallTopOffset), offsetY + Math.sin(angle) * (plazaRadius + wallThickness + wallTopOffset));
      cacheCtx.closePath();
      cacheCtx.fill();
      
      // Battlement highlight edge
      cacheCtx.strokeStyle = '#9a9a8a';
      cacheCtx.lineWidth = 1 * p;
      cacheCtx.beginPath();
      cacheCtx.moveTo(offsetX + Math.cos(angle) * (plazaRadius + wallThickness + wallTopOffset + battlementHeight), offsetY + Math.sin(angle) * (plazaRadius + wallThickness + wallTopOffset + battlementHeight));
      cacheCtx.lineTo(offsetX + Math.cos(nextAngle) * (plazaRadius + wallThickness + wallTopOffset + battlementHeight), offsetY + Math.sin(nextAngle) * (plazaRadius + wallThickness + wallTopOffset + battlementHeight));
      cacheCtx.stroke();
    }
  }
  
  // Draw battlements on inner edge (facing plaza)
  for (let i = 0; i < battlementCount; i++) {
    const angle = (i / battlementCount) * Math.PI * 2;
    const nextAngle = ((i + 1) / battlementCount) * Math.PI * 2;
    
    // Skip battlements in gate areas
    if (isInGate(angle) || isInGate(nextAngle)) continue;
    
    const x1 = offsetX + Math.cos(angle) * (plazaRadius + wallThickness);
    const y1 = offsetY + Math.sin(angle) * (plazaRadius + wallThickness);
    const x2 = offsetX + Math.cos(nextAngle) * (plazaRadius + wallThickness);
    const y2 = offsetY + Math.sin(nextAngle) * (plazaRadius + wallThickness);
    
    // Battlement on inner edge
    if (i % 2 === 0) {
      // Front face of battlement (facing inward)
      cacheCtx.fillStyle = '#6a6a5a';
      cacheCtx.beginPath();
      cacheCtx.moveTo(x1, y1);
      cacheCtx.lineTo(x2, y2);
      cacheCtx.lineTo(offsetX + Math.cos(nextAngle) * (plazaRadius + wallThickness - battlementHeight * 0.5), offsetY + Math.sin(nextAngle) * (plazaRadius + wallThickness - battlementHeight * 0.5));
      cacheCtx.lineTo(offsetX + Math.cos(angle) * (plazaRadius + wallThickness - battlementHeight * 0.5), offsetY + Math.sin(angle) * (plazaRadius + wallThickness - battlementHeight * 0.5));
      cacheCtx.closePath();
      cacheCtx.fill();
      
      // Top of inner battlement
      cacheCtx.fillStyle = '#7a7a6a';
      cacheCtx.beginPath();
      cacheCtx.moveTo(offsetX + Math.cos(angle) * (plazaRadius + wallThickness - battlementHeight * 0.5), offsetY + Math.sin(angle) * (plazaRadius + wallThickness - battlementHeight * 0.5));
      cacheCtx.lineTo(offsetX + Math.cos(nextAngle) * (plazaRadius + wallThickness - battlementHeight * 0.5), offsetY + Math.sin(nextAngle) * (plazaRadius + wallThickness - battlementHeight * 0.5));
      cacheCtx.lineTo(offsetX + Math.cos(nextAngle) * (plazaRadius + wallThickness), offsetY + Math.sin(nextAngle) * (plazaRadius + wallThickness));
      cacheCtx.lineTo(offsetX + Math.cos(angle) * (plazaRadius + wallThickness), offsetY + Math.sin(angle) * (plazaRadius + wallThickness));
      cacheCtx.closePath();
      cacheCtx.fill();
    }
  }
  
  // Draw gate archways (so players can see they can pass through)
  const gateWidth = 40 * p;
  for (const segment of precomputedGateSegments) {
    const gateX = offsetX + Math.cos(segment.gateAngle) * (plazaRadius + wallThickness / 2);
    const gateY = offsetY + Math.sin(segment.gateAngle) * (plazaRadius + wallThickness / 2);
    
    // Gate arch (semi-circular top)
    cacheCtx.strokeStyle = '#5a5a4a';
    cacheCtx.lineWidth = 3 * p;
    cacheCtx.beginPath();
    cacheCtx.arc(gateX, gateY, gateWidth / 2, segment.gateAngle + Math.PI / 2, segment.gateAngle - Math.PI / 2, false);
    cacheCtx.stroke();
    
    // Gate arch highlight
    cacheCtx.strokeStyle = '#6a6a5a';
    cacheCtx.lineWidth = 1 * p;
    cacheCtx.beginPath();
    cacheCtx.arc(gateX, gateY, gateWidth / 2 - 1 * p, segment.gateAngle + Math.PI / 2, segment.gateAngle - Math.PI / 2, false);
    cacheCtx.stroke();
  }
  
  plazaWallTopCacheInitialized = true;
}

export function drawForestFountain(ctx: CanvasRenderingContext2D, time: number, deltaTime?: number, hoveredStall?: { tab: 'hats' | 'shirts' | 'legs' | 'capes' | 'wings' | 'accessories' | 'boosts' | 'pets'; rarity: ItemRarity } | null, hoveredDealerId?: string | null, camera?: Camera): void {
  const p = SCALE;
  const centerX = WORLD_WIDTH / 2;
  const centerY = WORLD_HEIGHT / 2;
  const plazaRadius = 540 * p; // Match the background plaza radius
  
  // Build static fountain cache if needed
  buildFountainStaticCache();
  
  // Draw cached static fountain structure
  if (fountainStaticCache) {
    const cacheSize = 300 * p;
    const offsetX = centerX - cacheSize / 2;
    const offsetY = centerY - cacheSize / 2;
    ctx.drawImage(fountainStaticCache, offsetX, offsetY);
  }
  
  // === SPINNING ORBS WITH LIGHTBEAM ===
  // Calculate fountain top position (needed for lightbeam and orbs)
  const baseRadius = 100 * p;
  const midRadius = 80 * p;
  const topRadius = 60 * p;
  const midPlatformY = centerY - 20 * p;
  const topPlatformY = midPlatformY - 35 * p;
  const fountainBaseRadius = 25 * p;
  const fountainPillarHeight = 40 * p;
  const fountainTopY = topPlatformY - fountainPillarHeight;
  
  const orbRadius = 45 * p; // Distance from center for orbs (increased for larger structure)
  const orbTypes: Array<keyof typeof ORB_RARITY_CONFIG> = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  const orbCount = orbTypes.length;
  
  // Rotate orbs around center
  const rotationSpeed = 0.0003; // radians per ms
  const baseAngle = time * rotationSpeed;
  
  // Draw animated lightbeam shooting into sky
  const beamHeight = 200 * p;
  const baseBeamWidth = 12 * p;
  const beamStartY = fountainTopY;
  
  // Animate beam (pulsing width and intensity)
  const pulse = Math.sin(time * 0.002) * 0.15 + 1; // Pulse between 0.85 and 1.15
  const intensity = Math.sin(time * 0.0015) * 0.2 + 0.8; // Intensity between 0.6 and 1.0
  const beamWidth = baseBeamWidth * pulse;
  const animatedBeamX = centerX - beamWidth / 2;
  
  // Optimized: Create gradients once per frame (positions change but structure is similar)
  // Main beam gradient
  const beamGradient = ctx.createLinearGradient(animatedBeamX, beamStartY, animatedBeamX, beamStartY - beamHeight);
  beamGradient.addColorStop(0, `rgba(255, 255, 255, ${intensity})`);
  beamGradient.addColorStop(0.2, `rgba(200, 230, 255, ${intensity * 0.8})`);
  beamGradient.addColorStop(0.5, `rgba(150, 200, 255, ${intensity * 0.5})`);
  beamGradient.addColorStop(0.8, `rgba(100, 180, 255, ${intensity * 0.3})`);
  beamGradient.addColorStop(1, 'rgba(100, 180, 255, 0)');
  
  // Draw main beam
  ctx.fillStyle = beamGradient;
  ctx.fillRect(animatedBeamX, beamStartY - beamHeight, beamWidth, beamHeight);
  
  // Batch shadow operations: set once, use multiple times, reset once
  const glowIntensity = intensity * 0.6;
  ctx.shadowBlur = 30 * p * pulse;
  ctx.shadowColor = `rgba(100, 200, 255, ${glowIntensity})`;
  
  // Animated lightbeam outer glow (pulsing)
  ctx.fillRect(animatedBeamX - 3 * p, beamStartY - beamHeight, beamWidth + 6 * p, beamHeight);
  
  // Additional inner bright core (animated) - reuse shadow
  const coreGradient = ctx.createLinearGradient(animatedBeamX, beamStartY, animatedBeamX, beamStartY - beamHeight * 0.7);
  coreGradient.addColorStop(0, `rgba(255, 255, 255, ${intensity * 0.8})`);
  coreGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = coreGradient;
  ctx.fillRect(animatedBeamX + 2 * p, beamStartY - beamHeight * 0.7, beamWidth - 4 * p, beamHeight * 0.7);
  
  // Reset shadow after all beam operations
  ctx.shadowBlur = 0;
  
  // Shimmer effect (moving highlight)
  const shimmerOffset = (time * 0.001) % (beamHeight * 0.5);
  const shimmerGradient = ctx.createLinearGradient(
    animatedBeamX, 
    beamStartY - shimmerOffset, 
    animatedBeamX, 
    beamStartY - shimmerOffset - beamHeight * 0.3
  );
  shimmerGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
  shimmerGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.4)');
  shimmerGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = shimmerGradient;
  ctx.fillRect(animatedBeamX, beamStartY - beamHeight, beamWidth, beamHeight);
  
  // Draw spinning orbs around the fountain (in front of decorative stones)
  // Optimized: Batch arc operations where possible
  orbTypes.forEach((orbType, index) => {
    const angle = baseAngle + (index / orbCount) * Math.PI * 2;
    const x = centerX + Math.cos(angle) * orbRadius;
    const y = fountainTopY + Math.sin(angle) * orbRadius;
    
    const config = ORB_RARITY_CONFIG[orbType];
    const baseSize = 8 * p * config.size;
    const pulse = Math.sin(time / config.pulseSpeed + index) * 0.2 + 1;
    const currentSize = baseSize * pulse;
    
    // Draw orb glow (optimized: create gradient once per orb)
    const glowGradient = ctx.createRadialGradient(x, y, 0, x, y, currentSize * 2.5);
    glowGradient.addColorStop(0, config.colors.outer);
    glowGradient.addColorStop(0.5, config.colors.outerGlow);
    glowGradient.addColorStop(1, config.colors.outerGlow);
    ctx.fillStyle = glowGradient;
    ctx.beginPath();
    ctx.arc(x, y, currentSize * 2.5, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw orb main body (optimized: create gradient once per orb)
    const orbGradient = ctx.createRadialGradient(
      x - currentSize * 0.3, 
      y - currentSize * 0.3, 
      0,
      x, 
      y, 
      currentSize
    );
    orbGradient.addColorStop(0, config.colors.highlight);
    orbGradient.addColorStop(0.3, config.colors.inner);
    orbGradient.addColorStop(0.7, config.colors.main);
    orbGradient.addColorStop(1, config.colors.outer);
    
    ctx.fillStyle = orbGradient;
    ctx.beginPath();
    ctx.arc(x, y, currentSize, 0, Math.PI * 2);
    ctx.fill();
    
    // Highlight (simple fill, no gradient needed)
    ctx.fillStyle = config.colors.highlight;
    ctx.beginPath();
    ctx.arc(x - currentSize * 0.3, y - currentSize * 0.3, currentSize * 0.4, 0, Math.PI * 2);
    ctx.fill();
  });
  
  // Draw NPC stalls
  drawNPCStalls(ctx, centerX, centerY, plazaRadius, time, deltaTime || 16, hoveredStall);
  
  // Draw dealers around the plaza (between flags)
  drawDealers(ctx, centerX, centerY, plazaRadius, time, hoveredDealerId);
  
  // Update NPC stall data for click detection
  updateNPCClickAreas(centerX, centerY, plazaRadius);
  
  // Note: Guard towers are drawn separately in GameCanvas.tsx after players/terrain
  // so they appear on top and players walk behind them
}

// Draw flag bunting from central monument to trader podiums (now uses static cache)
export function drawFlagBunting(ctx: CanvasRenderingContext2D, centerX: number, centerY: number, plazaRadius: number, time: number, camera?: Camera): void {
  const p = SCALE;
  
  // Build static plaza cache if needed
  buildPlazaStaticCache();
  
  // Draw cached static flag bunting
  if (plazaStaticCache) {
    const cacheSize = plazaRadius * 2.5;
    const offsetX = centerX - cacheSize / 2;
    const offsetY = centerY - cacheSize / 2;
    ctx.drawImage(plazaStaticCache, offsetX, offsetY);
  }
}

// Dealer positions (exported for click detection)
export const dealerPositions: Map<string, { x: number; y: number }> = new Map();

// Dealer type definitions
interface DealerType {
  id: string;
  name: string;
  outfit: string[];
  messages: string[];
}

const DEALER_TYPES: DealerType[] = [
  {
    id: 'log_dealer',
    name: 'Log Dealer',
    outfit: ['hat_hardhat', 'shirt_striped', 'legs_jeans_blue'],
    messages: ['I buy logs!', 'Got any logs?', '100 orbs per log!', 'Bring me your logs!', 'Fresh cut logs!', 'Quality timber!'],
  },
  {
    id: 'treasure_chest_dealer',
    name: 'Treasure Dealer',
    outfit: ['hat_pirate', 'coat_pirate', 'legs_pirate'],
          messages: ['I buy gold coins!', 'Got any coins?', '250 orbs per coin!', 'Bring me your treasure!', 'Arr! Show me yer gold!', 'Treasure for sale!'],
  },
  {
    id: 'resource_dealer_1',
    name: 'Resource Dealer',
    outfit: ['hat_cap_red', 'shirt_vest_brown', 'legs_jeans_blue'],
    messages: ['Trading resources!', 'What do you have?', 'Fair prices!'],
  },
  {
    id: 'resource_dealer_2',
    name: 'Merchant',
    outfit: ['hat_tophat', 'shirt_formal', 'legs_slacks'],
    messages: ['Buying and selling!', 'Best prices in town!', 'Come trade!'],
  },
  {
    id: 'resource_dealer_3',
    name: 'Trader',
    outfit: ['hat_cap_blue', 'vest_denim', 'legs_jeans_blue'],
    messages: ['Looking to trade?', 'I have what you need!', 'Fair deals!'],
  },
  {
    id: 'resource_dealer_4',
    name: 'Vendor',
    outfit: ['hat_beanie', 'shirt_casual', 'legs_jeans_blue'],
    messages: ['Trading goods!', 'What can I help with?', 'Good prices!'],
  },
  {
    id: 'resource_dealer_5',
    name: 'Merchant',
    outfit: ['hat_cap_red', 'vest_cowboy', 'legs_jeans_blue'],
    messages: ['Buying and selling!', 'Fair trades!', 'Come see me!'],
  },
  {
    id: 'resource_dealer_6',
    name: 'Trader',
    outfit: ['hat_tophat', 'shirt_vest_brown', 'legs_slacks'],
    messages: ['Trading resources!', 'Best deals!', 'What do you need?'],
  },
  {
    id: 'resource_dealer_7',
    name: 'Vendor',
    outfit: ['hat_cap_blue', 'shirt_formal', 'legs_jeans_blue'],
    messages: ['Looking to trade?', 'I buy and sell!', 'Fair prices!'],
  },
  {
    id: 'loot_box_dealer',
    name: 'Loot Box Dealer',
    outfit: ['hat_rainbow', 'robe_rainbow', 'legs_rainbow', 'cape_rainbow', 'acc_wings_rainbow', 'acc_aura_rainbow', 'acc_weapon_rainbow'],
    messages: ['Loot boxes here!', 'Mystery boxes await!', 'Try your luck!', 'Prismatic treasures!'],
  },
  {
    id: 'orb_dealer',
    name: 'Orb Dealer',
    outfit: ['hat_golden', 'armor_golden', 'legs_gold', 'acc_wings_golden', 'acc_aura_golden', 'acc_weapon_golden'],
    messages: ['Buy orbs here!', 'Need more orbs?', 'Premium currency!', 'Golden deals!'],
  },
];

// Update dealer speech bubbles (similar to NPC stalls)
function updateDealerSpeechBubbles(time: number): void {
  // Update log dealer
  const logDealerId = 'log_dealer';
  
  // Initialize random offset for this dealer (once, persists across calls)
  if (!npcSpeechOffsets.has(logDealerId)) {
    // Dealer gets a random offset between 0 and 10 seconds to stagger speech
    npcSpeechOffsets.set(logDealerId, Math.random() * NPC_SPEECH_INTERVAL);
  }
  
  const logOffset = npcSpeechOffsets.get(logDealerId)!;
  const existingLogBubble = npcSpeechBubbles.get(logDealerId);
  
  // Check if bubble has expired
  if (existingLogBubble && time - existingLogBubble.createdAt > GAME_CONSTANTS.CHAT_BUBBLE_DURATION) {
    npcSpeechBubbles.delete(logDealerId);
  }
  
  // Use staggered time check - dealer checks at different times
  const logStaggeredTime = (time + logOffset) % (NPC_SPEECH_INTERVAL * 2);
  
  // Only check for new speech in a small window (prevents all NPCs from speaking at once)
  if (logStaggeredTime < 500 && !existingLogBubble) {
    // Random chance to speak
    if (Math.random() < NPC_SPEECH_CHANCE) {
      const messages = [
        'I buy logs for 100 orbs each!',
        'Got any logs to sell?',
        'Bring me your logs!',
        '100 orbs per log!',
        'Trading logs for orbs!',
        'Sell your logs here!',
        'I\'ll buy your logs!',
        'Logs for orbs!',
      ];
      const randomMessage = messages[Math.floor(Math.random() * messages.length)];
      npcSpeechBubbles.set(logDealerId, {
        text: randomMessage,
        createdAt: time
      });
    }
  }
  
  // Update loot box dealer
  const lootBoxDealerId = 'loot_box_dealer';
  
  // Initialize random offset for this dealer (once, persists across calls)
  if (!npcSpeechOffsets.has(lootBoxDealerId)) {
    // Dealer gets a random offset between 0 and 10 seconds to stagger speech
    npcSpeechOffsets.set(lootBoxDealerId, Math.random() * NPC_SPEECH_INTERVAL);
  }
  
  const lootBoxOffset = npcSpeechOffsets.get(lootBoxDealerId)!;
  const existingLootBoxBubble = npcSpeechBubbles.get(lootBoxDealerId);
  
  // Check if bubble has expired
  if (existingLootBoxBubble && time - existingLootBoxBubble.createdAt > GAME_CONSTANTS.CHAT_BUBBLE_DURATION) {
    npcSpeechBubbles.delete(lootBoxDealerId);
  }
  
  // Use staggered time check - dealer checks at different times
  const lootBoxStaggeredTime = (time + lootBoxOffset) % (NPC_SPEECH_INTERVAL * 2);
  
  // Only check for new speech in a small window (prevents all NPCs from speaking at once)
  if (lootBoxStaggeredTime < 500 && !existingLootBoxBubble) {
    // Random chance to speak
    if (Math.random() < NPC_SPEECH_CHANCE) {
      const dealerType = DEALER_TYPES.find(d => d.id === lootBoxDealerId);
      if (dealerType) {
        const randomMessage = dealerType.messages[Math.floor(Math.random() * dealerType.messages.length)];
        npcSpeechBubbles.set(lootBoxDealerId, {
          text: randomMessage,
          createdAt: time
        });
      }
    }
  }
}

// Draw dealers around the plaza (between flags)
function drawDealers(ctx: CanvasRenderingContext2D, centerX: number, centerY: number, plazaRadius: number, time: number, hoveredDealerId?: string | null): void {
  const p = SCALE;
  const flagCount = 8;
  // Move dealers closer inward (not right on the plaza wall)
  const dealerRadius = plazaRadius * 0.85; // 85% of plaza radius (closer than flags)
  
  // Update dealer speech bubbles
  updateDealerSpeechBubbles(time);
  
  // Clear previous positions
  dealerPositions.clear();
  
  // Show log dealer
  const logDealerType = DEALER_TYPES.find(d => d.id === 'log_dealer');
  if (logDealerType) {
    // Find which position the log dealer should be at (first position for now)
    const logDealerIndex = 0;
    const angle = ((logDealerIndex + 0.5) / flagCount) * Math.PI * 2;
    const dealerX = centerX + Math.cos(angle) * dealerRadius;
    const dealerY = centerY + Math.sin(angle) * dealerRadius;
    
    // Store position for click detection
    dealerPositions.set(logDealerType.id, { x: dealerX, y: dealerY });
    
    // Draw log dealer NPC (with hover effect)
    const isHovered = hoveredDealerId === 'log_dealer';
    drawSingleDealer(ctx, logDealerType, dealerX, dealerY, time, isHovered);
  }
  
  // Show loot box dealer
  const lootBoxDealerType = DEALER_TYPES.find(d => d.id === 'loot_box_dealer');
  if (lootBoxDealerType) {
    // Position loot box dealer at second position
    const lootBoxDealerIndex = 1;
    const angle = ((lootBoxDealerIndex + 0.5) / flagCount) * Math.PI * 2;
    const dealerX = centerX + Math.cos(angle) * dealerRadius;
    const dealerY = centerY + Math.sin(angle) * dealerRadius;
    
    // Store position for click detection
    dealerPositions.set(lootBoxDealerType.id, { x: dealerX, y: dealerY });
    
    // Draw loot box dealer NPC (with hover effect)
    const isHovered = hoveredDealerId === 'loot_box_dealer';
    drawSingleDealer(ctx, lootBoxDealerType, dealerX, dealerY, time, isHovered);
  }
  
  // Show orb dealer
  const orbDealerType = DEALER_TYPES.find(d => d.id === 'orb_dealer');
  if (orbDealerType) {
    // Position orb dealer at third position
    const orbDealerIndex = 2;
    const angle = ((orbDealerIndex + 0.5) / flagCount) * Math.PI * 2;
    const dealerX = centerX + Math.cos(angle) * dealerRadius;
    const dealerY = centerY + Math.sin(angle) * dealerRadius;
    
    // Store position for click detection
    dealerPositions.set(orbDealerType.id, { x: dealerX, y: dealerY });
    
    // Draw orb dealer NPC (with hover effect)
    const isHovered = hoveredDealerId === 'orb_dealer';
    drawSingleDealer(ctx, orbDealerType, dealerX, dealerY, time, isHovered);
  }
  
  // Show treasure chest dealer
  const treasureChestDealerType = DEALER_TYPES.find(d => d.id === 'treasure_chest_dealer');
  if (treasureChestDealerType) {
    // Position treasure chest dealer at fourth position
    const treasureChestDealerIndex = 3;
    const angle = ((treasureChestDealerIndex + 0.5) / flagCount) * Math.PI * 2;
    const dealerX = centerX + Math.cos(angle) * dealerRadius;
    const dealerY = centerY + Math.sin(angle) * dealerRadius;
    
    // Store position for click detection
    dealerPositions.set(treasureChestDealerType.id, { x: dealerX, y: dealerY });
    
    // Draw treasure chest dealer NPC (with hover effect)
    const isHovered = hoveredDealerId === 'treasure_chest_dealer';
    drawSingleDealer(ctx, treasureChestDealerType, dealerX, dealerY, time, isHovered);
  }
}

// Draw a single dealer NPC
function drawSingleDealer(ctx: CanvasRenderingContext2D, dealerType: DealerType, dealerX: number, dealerY: number, time: number, isHovered: boolean = false): void {
  const p = SCALE;
  
  // Draw yellow glow effect when hovered (before NPC, same as NPC stalls)
  if (isHovered) {
    ctx.save();
    // Calculate NPC center position (where the glow should be)
    const npcPlayerX = (dealerX / SCALE) - (PLAYER_WIDTH / 2);
    const npcPlayerY = (dealerY / SCALE) - (PLAYER_HEIGHT / 2);
    const npcCenterX = dealerX;
    const npcCenterY = dealerY;
    
    // Draw bright yellow glow ring around dealer (same as NPC stalls)
    ctx.globalAlpha = 0.6;
    const gradient = ctx.createRadialGradient(npcCenterX, npcCenterY, 0, npcCenterX, npcCenterY, 30 * p);
    gradient.addColorStop(0, 'rgba(255, 215, 0, 0.8)');
    gradient.addColorStop(0.5, 'rgba(255, 215, 0, 0.4)');
    gradient.addColorStop(1, 'rgba(255, 215, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(npcCenterX, npcCenterY, 30 * p, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw outer glow ring
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.8)';
    ctx.lineWidth = 4 * p;
    ctx.beginPath();
    ctx.arc(npcCenterX, npcCenterY, 25 * p, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.globalAlpha = 1;
    ctx.restore();
    
    // Set shadow for NPC drawing (will be applied to the NPC sprite)
    ctx.shadowBlur = 30 * p;
    ctx.shadowColor = 'rgba(255, 215, 0, 1.0)'; // Yellow glow for NPC elements
  }
  
  // Draw simple NPC (similar to villager style)
  const npcPlayerX = (dealerX / SCALE) - (PLAYER_WIDTH / 2);
  const npcPlayerY = (dealerY / SCALE) - (PLAYER_HEIGHT / 2);
  
  const npcPlayer: PlayerWithChat = {
    id: dealerType.id,
    name: dealerType.name,
    x: npcPlayerX,
    y: npcPlayerY,
    direction: 'down',
    sprite: {
      body: 'default',
      outfit: dealerType.outfit,
    },
    orbs: 0,
    roomId: '',
  };
  
  // Skip nameplate in drawPlayer since we draw it explicitly with proper zoom
  drawPlayer(ctx, npcPlayer, false, time, true);
  
  // Draw nameplate with proper zoom (get from context transform like other NPCs)
  // Use Infinity to show purple infinity icon, and force white text color
  const zoom = ctx.getTransform().a || 1;
  const scaledX = npcPlayer.x * SCALE;
  const scaledY = npcPlayer.y * SCALE;
  const scaledWidth = PLAYER_WIDTH * SCALE;
      drawNameTag(ctx, npcPlayer.name, scaledX + scaledWidth / 2, scaledY - 20 * p, Infinity, zoom, npcPlayer.id, time);
  
  // Get speech bubble from npcSpeechBubbles map (updated by updateDealerSpeechBubbles)
  const speechBubble = npcSpeechBubbles.get(dealerType.id);
  if (speechBubble && time - speechBubble.createdAt < GAME_CONSTANTS.CHAT_BUBBLE_DURATION) {
    npcPlayer.chatBubble = {
      text: speechBubble.text,
      createdAt: speechBubble.createdAt
    };
  }
  
  // Draw speech bubble if they have one (zoom is already applied to context)
  if (npcPlayer.chatBubble) {
    drawChatBubble(ctx, npcPlayer, time, zoom);
  }
  
  // Clear shadow after drawing NPC (so it doesn't affect other elements)
  if (isHovered) {
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }
}

// Check if mouse is hovering over a dealer (returns dealer ID if hovered, null otherwise)
export function getHoveredDealer(worldX: number, worldY: number): string | null {
  const p = SCALE;
  const hoverRadius = 35 * p; // Hover detection radius (slightly larger than click)
  
  for (const [dealerId, position] of dealerPositions.entries()) {
    const dx = worldX - position.x;
    const dy = worldY - position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < hoverRadius) {
      return dealerId;
    }
  }
  
  return null;
}

// Check if click is on any dealer (returns dealer ID if clicked, null otherwise)
export function getClickedDealer(worldX: number, worldY: number): string | null {
  const p = SCALE;
  const clickRadius = 30 * p;
  
  for (const [dealerId, position] of dealerPositions.entries()) {
    const dx = worldX - position.x;
    const dy = worldY - position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < clickRadius) {
      return dealerId;
    }
  }
  
  return null;
}

// Legacy function for backward compatibility (checks if log dealer is clicked)
export function getClickedLogDealer(worldX: number, worldY: number): boolean {
  return getClickedDealer(worldX, worldY) === 'log_dealer';
}

// Get tree ID from position (for tree state lookup)
export function getTreeId(tree: TreeData): string {
  return `tree_${tree.x}_${tree.y}`;
}

// Check if a click is on a tree (returns tree if clicked)
export function getClickedTree(worldX: number, worldY: number): TreeData | null {
  if (forestTrees.length === 0) {
    return null;
  }
  
  const p = SCALE;
  const clickRadius = 40 * p; // Click detection radius
  
  let closestTree: TreeData | null = null;
  let closestDist = Infinity;
  
  for (const tree of forestTrees) {
    // Check if click is near tree trunk or canopy
    const trunkCenterX = tree.trunkX + tree.trunkW / 2;
    const trunkCenterY = tree.trunkY + tree.trunkH / 2;
    
    const dx = worldX - trunkCenterX;
    const dy = worldY - trunkCenterY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist < clickRadius && dist < closestDist) {
      closestTree = tree;
      closestDist = dist;
    }
  }
  
  return closestTree;
}

// Check if mouse is hovering over a tree
export function getHoveredTree(worldX: number, worldY: number): TreeData | null {
  if (forestTrees.length === 0) {
    return null;
  }
  
  const p = SCALE;
  const hoverRadius = 50 * p; // Hover detection radius (larger than click for better UX)
  
  let closestTree: TreeData | null = null;
  let closestDist = Infinity;
  
  for (const tree of forestTrees) {
    // Check if hover is near tree trunk or canopy
    const trunkCenterX = tree.trunkX + tree.trunkW / 2;
    const trunkCenterY = tree.trunkY + tree.trunkH / 2;
    
    const dx = worldX - trunkCenterX;
    const dy = worldY - trunkCenterY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist < hoverRadius && dist < closestDist) {
      closestTree = tree;
      closestDist = dist;
    }
  }
  
  return closestTree;
}

// Check if player is within interaction range of a tree
export function isPlayerInTreeRange(playerX: number, playerY: number, tree: TreeData): boolean {
  const p = SCALE;
  const treeCenterX = tree.trunkX + tree.trunkW / 2;
  const treeCenterY = tree.trunkY + tree.trunkH / 2;
  const playerCenterX = playerX * SCALE + (PLAYER_WIDTH * SCALE) / 2;
  const playerCenterY = playerY * SCALE + (PLAYER_HEIGHT * SCALE) / 2;
  const dx = treeCenterX - playerCenterX;
  const dy = treeCenterY - playerCenterY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return dist < 50 * p;
}

// Draw tree stumps (called BEFORE players so players appear on top)
// Note: Camera transform is already applied to ctx, so we draw in world coordinates
export function drawForestStumps(ctx: CanvasRenderingContext2D, treeStates?: Map<string, { treeId: string; isCut: boolean; cutBy: string | null; respawnAt: number }>, camera?: Camera): void {
  if (forestTrees.length === 0) return;
  
  const p = SCALE;
  
  for (const tree of forestTrees) {
    const treeId = getTreeId(tree);
    const treeState = treeStates?.get(treeId);
    const s = tree.scale;
    
    // Viewport culling: skip trees outside viewport
    if (camera) {
      const treeBounds = tree.canopyRadius * 2; // Approximate tree size
      const treeWorldX = tree.canopyX / SCALE;
      const treeWorldY = tree.canopyY / SCALE;
      if (!isVisible(camera, treeWorldX, treeWorldY, treeBounds / SCALE, treeBounds / SCALE)) {
        continue; // Skip this tree
      }
    }
    
    // Only draw stumps for cut trees
    if (treeState?.isCut) {
      const stumpX = tree.trunkX;
      const stumpY = tree.trunkY + tree.trunkH - 8 * s * p; // Stump at base of trunk
      const stumpW = tree.trunkW;
      const stumpH = 8 * s * p; // Stump height
      
      // Draw stump (darker brown)
      ctx.fillStyle = '#3a2a1a';
      ctx.fillRect(stumpX, stumpY, stumpW, stumpH);
      
      // Draw stump top (lighter brown for wood grain effect)
      ctx.fillStyle = '#4a3a2a';
      ctx.fillRect(stumpX, stumpY, stumpW, 2 * s * p);
    }
  }
}

// Draw forest tree foliage (called AFTER players to create depth effect)
// Note: Camera transform is already applied to ctx, so we draw in world coordinates
export function drawForestFoliage(ctx: CanvasRenderingContext2D, treeStates?: Map<string, { treeId: string; isCut: boolean; cutBy: string | null; respawnAt: number }>, camera?: Camera): void {
  if (forestTrees.length === 0) return;
  
  const p = SCALE;
  
  for (const tree of forestTrees) {
    const treeId = getTreeId(tree);
    const treeState = treeStates?.get(treeId);
    const s = tree.scale;
    
    // Skip cut trees (stumps are drawn separately before players)
    if (treeState?.isCut) {
      continue;
    }
    
    // Viewport culling: skip trees outside viewport
    if (camera) {
      const treeBounds = tree.canopyRadius * 2; // Approximate tree size
      const treeWorldX = tree.canopyX / SCALE;
      const treeWorldY = tree.canopyY / SCALE;
      if (!isVisible(camera, treeWorldX, treeWorldY, treeBounds / SCALE, treeBounds / SCALE)) {
        continue; // Skip this tree
      }
    }
    
    // Draw TRUNK (only if tree is not cut)
    ctx.fillStyle = FOREST_COLORS.treeTrunk;
    ctx.fillRect(tree.trunkX, tree.trunkY, tree.trunkW, tree.trunkH);
    
    // Calculate base position from stored canopy center
    const baseX = tree.canopyX - 24 * p;
    const baseY = tree.canopyY - 20 * s * p;
    
    // Foliage layers (drawn with slight transparency so you can see player behind)
    ctx.globalAlpha = 0.85;
    
    ctx.fillStyle = FOREST_COLORS.treeDark;
    ctx.beginPath();
    ctx.arc(baseX + 24 * p, baseY + 30 * s * p, 28 * s * p, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = FOREST_COLORS.treeMid;
    ctx.beginPath();
    ctx.arc(baseX + 20 * p, baseY + 20 * s * p, 22 * s * p, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = FOREST_COLORS.treeLight;
    ctx.beginPath();
    ctx.arc(baseX + 24 * p, baseY + 12 * s * p, 16 * s * p, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.globalAlpha = 1;
  }
}

// Draw tree cutting progress bar
export function drawTreeProgressBar(
  ctx: CanvasRenderingContext2D,
  tree: TreeData,
  progress: number, // 0-1
  time: number,
  zoom: number = 1
): void {
  const p = SCALE;
  // Scale dimensions inversely to zoom (bigger when zoomed out, smaller when zoomed in)
  // This maintains consistent screen size like nameplates
  const baseBarWidth = 20; // Reduced by 50% from 40
  const baseBarHeight = 2; // Reduced by 50% from 4
  const baseFontSize = 3; // Reduced by 50% from 6
  const basePadding = 1; // Reduced by 50% from 2
  const baseTextOffset = 6; // Reduced by 50% from 12
  const baseLineWidth = 0.5; // Reduced by 50% from 1
  const baseTextLineWidth = 0.75; // Reduced by 50% from 1.5
  
  const barWidth = (baseBarWidth * p) / zoom;
  const barHeight = (baseBarHeight * p) / zoom;
  const fontSize = (baseFontSize * p) / zoom;
  const padding = (basePadding * p) / zoom;
  const textOffset = (baseTextOffset * p) / zoom;
  const lineWidth = (baseLineWidth * p) / zoom;
  const textLineWidth = (baseTextLineWidth * p) / zoom;
  
  // Position above tree trunk center (more reliable than canopy)
  const trunkCenterX = tree.trunkX + tree.trunkW / 2;
  const trunkCenterY = tree.trunkY + tree.trunkH / 2;
  const barX = trunkCenterX - barWidth / 2;
  const barY = trunkCenterY - textOffset - barHeight - padding; // Above the trunk
  
  // Save context state
  ctx.save();
  
  // Background (darker for visibility with padding)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.95)';
  ctx.fillRect(barX - padding, barY - padding, barWidth + padding * 2, barHeight + padding * 2);
  
  // Progress fill (green, bright)
  ctx.fillStyle = '#22c55e'; // Brighter green
  ctx.fillRect(barX, barY, barWidth * progress, barHeight);
  
  // Border (white, thicker)
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(barX, barY, barWidth, barHeight);
  
  // Text "Cutting..." with strong outline for visibility
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${fontSize}px "Press Start 2P", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Draw thick outline first
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = textLineWidth;
  const textY = barY - textOffset;
  ctx.strokeText('Cutting...', trunkCenterX, textY);
  // Then fill
  ctx.fillText('Cutting...', trunkCenterX, textY);
  
  // Restore context
  ctx.restore();
}

// === MAIN EXPORT FUNCTIONS ===

let currentMapType: MapType = 'cafe';

export function setCurrentMap(mapType: MapType): void {
  if (mapType !== currentMapType) {
    console.log(`Map type changed from ${currentMapType} to ${mapType}`);
    currentMapType = mapType;
    // Clear cache for old map if needed (optional - we keep all caches for performance)
  }
}

export function clearBackgroundCache(mapType?: MapType): void {
  if (mapType) {
    backgroundCaches.delete(mapType);
    console.log(`Cleared background cache for ${mapType}`);
  } else {
    backgroundCaches.clear();
    console.log('Cleared all background caches');
  }
}

export function drawBackground(ctx: CanvasRenderingContext2D, mapType?: MapType, camera?: Camera): void {
  // Ensure we have a valid map type
  const map = mapType || currentMapType || 'cafe';
  
  // Update current map type if provided
  if (mapType && mapType !== currentMapType) {
    setCurrentMap(mapType);
  }
  
  // Check cache
  let cache = backgroundCaches.get(map);
  
  if (!cache) {
    console.log(`Creating background cache for map: ${map} (${WORLD_WIDTH}x${WORLD_HEIGHT})`);
    cache = document.createElement('canvas');
    cache.width = WORLD_WIDTH;
    cache.height = WORLD_HEIGHT;
    const cacheCtx = cache.getContext('2d');
    
    if (!cacheCtx) {
      console.error('Failed to get 2d context for background cache');
      // Fallback: draw a simple background
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      return;
    }
    
    cacheCtx.imageSmoothingEnabled = false;
    
    try {
      // Draw base background first (in case functions don't fill the whole canvas)
      cacheCtx.fillStyle = '#1a1a1a';
      cacheCtx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      
      switch (map) {
        case 'market':
          drawMarketBackground(cacheCtx);
          break;
        case 'forest':
          drawForestBackground(cacheCtx);
          console.log(`Forest background drawn, forestTrees.length: ${forestTrees.length}`);
          break;
        case 'cafe':
        default:
          drawCafeBackground(cacheCtx);
          break;
      }
      console.log(`Background cache created successfully for ${map}`);
    } catch (error) {
      console.error(`Error drawing background for ${map}:`, error);
      console.error(error);
      // Fallback background with color based on map type
      const fallbackColors: Record<MapType, string> = {
        market: '#7a7a6e',
        forest: '#2d3a1f',
        cafe: '#2a2a2a',
      };
      cacheCtx.fillStyle = fallbackColors[map] || '#2a2a2a';
      cacheCtx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    }
    
    backgroundCaches.set(map, cache);
  }
  
  // Draw the cached background with viewport clipping for performance
  if (camera) {
    // Calculate visible bounds in world coordinates (scaled pixels)
    const viewportWidth = CANVAS_WIDTH / camera.zoom;
    const viewportHeight = CANVAS_HEIGHT / camera.zoom;
    
    // Source rectangle in cache (world coordinates)
    const sx = Math.max(0, camera.x);
    const sy = Math.max(0, camera.y);
    const sw = Math.min(viewportWidth, WORLD_WIDTH - sx);
    const sh = Math.min(viewportHeight, WORLD_HEIGHT - sy);
    
    // Destination rectangle (same as source since camera transform is already applied)
    const dx = sx;
    const dy = sy;
    
    // Only draw if there's something visible
    if (sw > 0 && sh > 0) {
      ctx.drawImage(cache, sx, sy, sw, sh, dx, dy, sw, sh);
    }
  } else {
    // Fallback: draw entire cache if no camera provided
    ctx.drawImage(cache, 0, 0);
  }
}

// Legacy function name for compatibility
export function drawGrass(ctx: CanvasRenderingContext2D): void {
  drawBackground(ctx);
}

// Orb rarity visual configs
const ORB_RARITY_CONFIG: Record<string, {
  size: number;
  colors: { outer: string; outerGlow: string; main: string; inner: string; highlight: string };
  glowSize: number;
  pulseSpeed: number;
}> = {
  common: {
    size: 1.0,
    colors: {
      outer: 'rgba(0, 220, 255, 0.7)',
      outerGlow: 'rgba(0, 200, 255, 0)',
      main: '#00dcff',
      inner: '#40ffff',
      highlight: '#ffffff',
    },
    glowSize: 2.0,
    pulseSpeed: 300,
  },
  uncommon: {
    size: 1.1,
    colors: {
      outer: 'rgba(46, 204, 113, 0.7)',
      outerGlow: 'rgba(46, 204, 113, 0)',
      main: '#2ecc71',
      inner: '#58d68d',
      highlight: '#ffffff',
    },
    glowSize: 2.2,
    pulseSpeed: 280,
  },
  rare: {
    size: 1.2,
    colors: {
      outer: 'rgba(52, 152, 219, 0.8)',
      outerGlow: 'rgba(52, 152, 219, 0)',
      main: '#3498db',
      inner: '#5dade2',
      highlight: '#ffffff',
    },
    glowSize: 2.4,
    pulseSpeed: 260,
  },
  epic: {
    size: 1.3,
    colors: {
      outer: 'rgba(155, 89, 182, 0.8)',
      outerGlow: 'rgba(155, 89, 182, 0)',
      main: '#9b59b6',
      inner: '#bb8fce',
      highlight: '#ffffff',
    },
    glowSize: 2.6,
    pulseSpeed: 240,
  },
  legendary: {
    size: 1.5,
    colors: {
      outer: 'rgba(255, 215, 0, 0.9)',
      outerGlow: 'rgba(255, 140, 0, 0)',
      main: '#ffd700',
      inner: '#ffec8b',
      highlight: '#ffffff',
    },
    glowSize: 3.0,
    pulseSpeed: 200,
  },
  // Legacy support
  normal: {
    size: 1.0,
    colors: {
      outer: 'rgba(0, 220, 255, 0.7)',
      outerGlow: 'rgba(0, 200, 255, 0)',
      main: '#00dcff',
      inner: '#40ffff',
      highlight: '#ffffff',
    },
    glowSize: 2.0,
    pulseSpeed: 300,
  },
  gold: {
    size: 1.3,
    colors: {
      outer: 'rgba(255, 215, 0, 0.8)',
      outerGlow: 'rgba(255, 140, 0, 0)',
      main: '#ffd700',
      inner: '#ffec8b',
      highlight: '#ffffff',
    },
    glowSize: 2.5,
    pulseSpeed: 200,
  },
  shrine: {
    size: 1.4,
    colors: {
      outer: 'rgba(220, 20, 60, 0.9)',
      outerGlow: 'rgba(139, 0, 0, 0)',
      main: '#dc143c',
      inner: '#ff1744',
      highlight: '#ffffff',
    },
    glowSize: 2.8,
    pulseSpeed: 180,
  },
};

export function drawOrb(ctx: CanvasRenderingContext2D, orb: Orb, time: number): void {
  const scaledX = orb.x * SCALE;
  const scaledY = orb.y * SCALE;
  
  // Get rarity config
  const orbType = orb.orbType || 'common';
  const config = ORB_RARITY_CONFIG[orbType] || ORB_RARITY_CONFIG.common;
  
  const scaledSize = ORB_SIZE * SCALE * config.size;
  const pulse = Math.sin(time / config.pulseSpeed) * 0.15 + 1;
  const currentSize = scaledSize * pulse;
  const floatY = Math.sin(time / 500) * 3;
  
  const centerX = scaledX + (ORB_SIZE * SCALE) / 2;
  const centerY = scaledY + (ORB_SIZE * SCALE) / 2 + floatY;
  const radius = currentSize / 2;
  
  ctx.save();
  
  const rotation = time / 1000; // Slow rotation for shimmer effect
  
  // Outer glow (multiple layers for depth)
  const outerGlowRadius = radius * config.glowSize;
  const glowGradient1 = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, outerGlowRadius);
  glowGradient1.addColorStop(0, config.colors.outer);
  glowGradient1.addColorStop(0.3, config.colors.outer.replace(/[\d.]+\)$/, '0.5)'));
  glowGradient1.addColorStop(0.6, config.colors.outer.replace(/[\d.]+\)$/, '0.2)'));
  glowGradient1.addColorStop(1, config.colors.outerGlow);
  
  ctx.fillStyle = glowGradient1;
  ctx.beginPath();
  ctx.arc(centerX, centerY, outerGlowRadius, 0, Math.PI * 2);
  ctx.fill();
  
  // Secondary outer glow (softer)
  const glowGradient2 = ctx.createRadialGradient(centerX, centerY, radius * 0.8, centerX, centerY, outerGlowRadius * 0.9);
  glowGradient2.addColorStop(0, config.colors.outer.replace(/[\d.]+\)$/, '0.4)'));
  glowGradient2.addColorStop(1, 'transparent');
  ctx.fillStyle = glowGradient2;
  ctx.beginPath();
  ctx.arc(centerX, centerY, outerGlowRadius * 0.9, 0, Math.PI * 2);
  ctx.fill();
  
  // Main orb body with sophisticated gradient
  const mainGradient = ctx.createRadialGradient(
    centerX - radius * 0.4, 
    centerY - radius * 0.4, 
    0,
    centerX, 
    centerY, 
    radius
  );
  mainGradient.addColorStop(0, config.colors.highlight);
  mainGradient.addColorStop(0.2, config.colors.inner);
  mainGradient.addColorStop(0.5, config.colors.main);
  mainGradient.addColorStop(0.8, config.colors.outer.replace(/[\d.]+\)$/, '0.8)'));
  mainGradient.addColorStop(1, config.colors.outer);
  
  ctx.fillStyle = mainGradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
  
  // Inner core (brighter center)
  const coreGradient = ctx.createRadialGradient(
    centerX - radius * 0.3, 
    centerY - radius * 0.3, 
    0,
    centerX, 
    centerY, 
    radius * 0.6
  );
  coreGradient.addColorStop(0, config.colors.highlight);
  coreGradient.addColorStop(0.5, config.colors.inner);
  coreGradient.addColorStop(1, 'transparent');
  
  ctx.fillStyle = coreGradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.6, 0, Math.PI * 2);
  ctx.fill();
  
  // Main highlight (top-left, larger and more prominent)
  const highlightGradient = ctx.createRadialGradient(
    centerX - radius * 0.35, 
    centerY - radius * 0.35, 
    0,
    centerX - radius * 0.35, 
    centerY - radius * 0.35, 
    radius * 0.5
  );
  highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  highlightGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.4)');
  highlightGradient.addColorStop(1, 'transparent');
  
  ctx.fillStyle = highlightGradient;
  ctx.beginPath();
  ctx.arc(centerX - radius * 0.35, centerY - radius * 0.35, radius * 0.5, 0, Math.PI * 2);
  ctx.fill();
  
  // Secondary highlight (smaller, more focused)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.beginPath();
  ctx.arc(centerX - radius * 0.3, centerY - radius * 0.3, radius * 0.2, 0, Math.PI * 2);
  ctx.fill();
  
  // Animated shimmer effect (rotating) for rare+ orbs
  if (orbType === 'rare' || orbType === 'epic' || orbType === 'legendary' || orbType === 'gold' || orbType === 'shrine') {
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(rotation);
    
    // Shimmer streak
    const shimmerGradient = ctx.createLinearGradient(-radius, 0, radius, 0);
    shimmerGradient.addColorStop(0, 'transparent');
    shimmerGradient.addColorStop(0.4, 'transparent');
    shimmerGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.6)');
    shimmerGradient.addColorStop(0.6, 'transparent');
    shimmerGradient.addColorStop(1, 'transparent');
    
    ctx.fillStyle = shimmerGradient;
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 1.2, radius * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
  }
  
  // Sparkles for rare+ orbs
  if (orbType === 'rare' || orbType === 'epic' || orbType === 'legendary' || orbType === 'gold' || orbType === 'shrine') {
    const sparkleCount = orbType === 'legendary' || orbType === 'shrine' ? 4 : 2;
    for (let i = 0; i < sparkleCount; i++) {
      const sparkleAngle = (rotation * 2 + (i / sparkleCount) * Math.PI * 2) % (Math.PI * 2);
      const sparkleDist = radius * 0.7;
      const sparkleX = centerX + Math.cos(sparkleAngle) * sparkleDist;
      const sparkleY = centerY + Math.sin(sparkleAngle) * sparkleDist;
      const sparkleSize = radius * 0.1;
      const sparklePulse = Math.sin(time / 200 + i) * 0.5 + 0.5;
      
      ctx.fillStyle = `rgba(255, 255, 255, ${0.8 * sparklePulse})`;
      ctx.beginPath();
      ctx.arc(sparkleX, sparkleY, sparkleSize * sparklePulse, 0, Math.PI * 2);
      ctx.fill();
      
      // Cross sparkle
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.6 * sparklePulse})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sparkleX - sparkleSize * sparklePulse, sparkleY);
      ctx.lineTo(sparkleX + sparkleSize * sparklePulse, sparkleY);
      ctx.moveTo(sparkleX, sparkleY - sparkleSize * sparklePulse);
      ctx.lineTo(sparkleX, sparkleY + sparkleSize * sparklePulse);
      ctx.stroke();
    }
  }
  
  // Rim light (subtle edge highlight)
  ctx.strokeStyle = config.colors.highlight.replace(/[\d.]+\)$/, '0.3)');
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.95, 0, Math.PI * 2);
  ctx.stroke();
  
  ctx.restore();
}

// Animation tracking for walking and idle
interface PlayerAnimation {
  lastX: number;
  lastY: number;
  frame: number;
  lastFrameTime: number;
  isMoving: boolean;
  idleTime: number; // Timestamp when player started being idle
  idleBobPhase: number; // Phase of idle bob animation (0-1)
  isChopping: boolean; // True when player is chopping a tree
  chopFrame: number; // Frame for chopping animation (0-3)
  chopStartTime: number; // When chopping started
}

const playerAnimations: Map<string, PlayerAnimation> = new Map();

// Particle trail tracking - simplified for performance
interface TrailParticle {
  x: number;
  y: number;
  color: string;
  createdAt: number;
}

const playerTrails: Map<string, TrailParticle[]> = new Map();
const TRAIL_PARTICLE_LIFETIME = 400; // ms
const TRAIL_SPAWN_INTERVAL = 60; // ms between particles
const MAX_PARTICLES_PER_PLAYER = 15; // Limit particles
const lastTrailSpawn: Map<string, number> = new Map();

// Spawn trail particles for a player with a boost
export function updatePlayerTrail(playerId: string, x: number, y: number, trailColor: string | undefined, time: number, isMoving: boolean): void {
  // Validate inputs to prevent NaN/Infinity issues
  if (!trailColor || !isMoving || !isFinite(x) || !isFinite(y) || !isFinite(time)) {
    return;
  }
  
  let trail = playerTrails.get(playerId);
  if (!trail) {
    trail = [];
    playerTrails.set(playerId, trail);
  }
  
  // Remove old particles first
  const validParticles = trail.filter(p => time - p.createdAt < TRAIL_PARTICLE_LIFETIME);
  
  // Spawn new particle if enough time has passed and under limit
  const lastSpawn = lastTrailSpawn.get(playerId) || 0;
  if (time - lastSpawn > TRAIL_SPAWN_INTERVAL && validParticles.length < MAX_PARTICLES_PER_PLAYER) {
    // Store particles in scaled world coordinates (matches camera coordinate system)
    const particleX = x * SCALE + (PLAYER_WIDTH * SCALE) / 2;
    const particleY = y * SCALE + (PLAYER_HEIGHT * SCALE);
    
    // Only add if coordinates are valid
    if (isFinite(particleX) && isFinite(particleY)) {
      validParticles.push({
        x: particleX,
        y: particleY,
        color: trailColor,
        createdAt: time,
      });
      lastTrailSpawn.set(playerId, time);
    }
  }
  
  playerTrails.set(playerId, validParticles);
}

// Draw all particle trails - simplified rendering with viewport culling
export function drawParticleTrails(ctx: CanvasRenderingContext2D, time: number, camera?: Camera): void {
  // Calculate viewport bounds for culling (particles are in scaled world coordinates)
  const viewportLeft = camera ? camera.x : -Infinity;
  const viewportRight = camera ? camera.x + CANVAS_WIDTH / camera.zoom : Infinity;
  const viewportTop = camera ? camera.y : -Infinity;
  const viewportBottom = camera ? camera.y + CANVAS_HEIGHT / camera.zoom : Infinity;
  
  // Add a small margin for particles that might be partially visible
  const margin = 50;
  const cullLeft = viewportLeft - margin;
  const cullRight = viewportRight + margin;
  const cullTop = viewportTop - margin;
  const cullBottom = viewportBottom + margin;
  
  playerTrails.forEach((particles) => {
    for (const particle of particles) {
      const age = time - particle.createdAt;
      if (age < 0 || age > TRAIL_PARTICLE_LIFETIME) continue;
      
      // Cull particles outside viewport for performance
      if (camera && (particle.x < cullLeft || particle.x > cullRight || particle.y < cullTop || particle.y > cullBottom)) {
        continue;
      }
      
      const progress = age / TRAIL_PARTICLE_LIFETIME;
      const alpha = Math.max(0, Math.min(1, (1 - progress) * 0.6));
      const size = Math.max(1, 8 * (1 - progress * 0.5));
      
      // Simple circle rendering (no gradients for performance)
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  
  // Reset alpha
  ctx.globalAlpha = 1;
}

// Clear trail for a player
export function clearPlayerTrail(playerId: string): void {
  playerTrails.delete(playerId);
  lastTrailSpawn.delete(playerId);
}

// === SMOKE PARTICLE SYSTEM (for spawn/despawn) ===
interface SmokeParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  createdAt: number;
  lifetime: number;
  alpha: number;
}

const smokeParticles: SmokeParticle[] = [];
const SMOKE_PARTICLE_LIFETIME = 800; // ms
const SMOKE_PARTICLES_PER_SPAWN = 20;

// Spawn smoke effect at position
export function spawnSmokeEffect(x: number, y: number): void {
  const now = Date.now();
  
  for (let i = 0; i < SMOKE_PARTICLES_PER_SPAWN; i++) {
    // Random angle for explosion
    const angle = (Math.PI * 2 * i) / SMOKE_PARTICLES_PER_SPAWN + (Math.random() - 0.5) * 0.5;
    const speed = 30 + Math.random() * 40; // pixels per second
    
    smokeParticles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 20, // Slight upward bias
      size: 4 + Math.random() * 6,
      createdAt: now,
      lifetime: SMOKE_PARTICLE_LIFETIME * (0.7 + Math.random() * 0.6),
      alpha: 0.8 + Math.random() * 0.2,
    });
  }
  
  // Limit total particles
  while (smokeParticles.length > 100) {
    smokeParticles.shift();
  }
}

// Update and draw smoke particles
export function updateAndDrawSmokeParticles(ctx: CanvasRenderingContext2D, deltaTime: number): void {
  const now = Date.now();
  const dt = deltaTime / 1000; // Convert to seconds
  
  // Update and draw particles
  for (let i = smokeParticles.length - 1; i >= 0; i--) {
    const particle = smokeParticles[i];
    const age = now - particle.createdAt;
    
    // Remove dead particles
    if (age > particle.lifetime) {
      smokeParticles.splice(i, 1);
      continue;
    }
    
    // Update position with upward drift and spread
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy -= 50 * dt; // Upward drift (negative Y is up)
    
    // Slow down horizontal velocity (air resistance)
    particle.vx *= 0.95;
    
    // Calculate alpha based on age (fade out)
    const lifeProgress = age / particle.lifetime;
    const alpha = particle.alpha * (1 - lifeProgress);
    
    // Size grows over time (smoke expands)
    const currentSize = particle.size * (1 + lifeProgress * 0.5);
    
    // Draw smoke particle (grey with transparency)
    ctx.globalAlpha = alpha * 0.6;
    ctx.fillStyle = '#4a4a4a';
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, currentSize * 1.5, 0, Math.PI * 2);
    ctx.fill();
    
    // Inner lighter smoke
    ctx.globalAlpha = alpha * 0.4;
    ctx.fillStyle = '#6a6a6a';
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, currentSize, 0, Math.PI * 2);
    ctx.fill();
    
    // Core darker smoke
    ctx.globalAlpha = alpha * 0.8;
    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, currentSize * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  
  ctx.globalAlpha = 1;
}

// === BOOST DEALER FAKE ORB PARTICLES ===
interface BoostDealerOrbParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  createdAt: number;
  lifetime: number;
  startY: number;
  endY: number;
}

const boostDealerOrbParticles: BoostDealerOrbParticle[] = [];
const BOOST_DEALER_ORB_SPAWN_INTERVAL = 300; // ms between spawns
let lastBoostDealerSpawn = 0;
const BOOST_DEALER_ORB_LIFETIME = 1000; // ms

// Spawn fake orb from Boost Dealer's head
function spawnBoostDealerOrb(headX: number, headY: number, feetY: number): void {
  const now = Date.now();
  if (now - lastBoostDealerSpawn < BOOST_DEALER_ORB_SPAWN_INTERVAL) {
    return;
  }
  lastBoostDealerSpawn = now;
  
  // Alternate between left and right, with slight random variation
  const spawnCount = boostDealerOrbParticles.length;
  const isLeft = (spawnCount % 2) === 0;
  const baseAngle = isLeft ? -Math.PI / 6 : Math.PI / 6; // 30 degrees left or right
  const angle = baseAngle + (Math.random() - 0.5) * 0.3; // Add some variation
  
  const speed = 40 + Math.random() * 20; // Initial speed
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;
  
  boostDealerOrbParticles.push({
    x: headX,
    y: headY,
    vx: vx,
    vy: vy,
    size: ORB_SIZE * SCALE * 0.6, // Slightly smaller than real orbs
    createdAt: now,
    lifetime: BOOST_DEALER_ORB_LIFETIME,
    startY: headY,
    endY: feetY,
  });
  
  // Limit total particles
  while (boostDealerOrbParticles.length > 20) {
    boostDealerOrbParticles.shift();
  }
}

// Update and draw Boost Dealer fake orb particles
function updateAndDrawBoostDealerOrbs(ctx: CanvasRenderingContext2D, deltaTime: number): void {
  const now = Date.now();
  const dt = deltaTime / 1000; // Convert to seconds
  
  // Update and draw particles
  for (let i = boostDealerOrbParticles.length - 1; i >= 0; i--) {
    const particle = boostDealerOrbParticles[i];
    const age = now - particle.createdAt;
    
    // Remove dead particles
    if (age > particle.lifetime) {
      boostDealerOrbParticles.splice(i, 1);
      continue;
    }
    
    // Update position with gravity
    particle.x += particle.vx * dt;
    particle.vy += 300 * dt; // Gravity
    particle.y += particle.vy * dt;
    
    // Slow down horizontal velocity (air resistance)
    particle.vx *= 0.98;
    
    // Stop at feet position
    if (particle.y >= particle.endY) {
      particle.y = particle.endY;
      particle.vy = 0;
      particle.vx *= 0.9; // Slow down more when landing
    }
    
    // Calculate alpha based on age (fade out at end)
    const lifeProgress = age / particle.lifetime;
    const alpha = lifeProgress > 0.8 ? (1 - lifeProgress) / 0.2 : 1;
    
    // Draw fake orb (golden color like legendary orbs)
    const radius = particle.size / 2;
    const centerX = particle.x;
    const centerY = particle.y;
    
    // Outer glow
    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius * 2.5);
    gradient.addColorStop(0, 'rgba(255, 215, 0, 0.4)');
    gradient.addColorStop(0.5, 'rgba(255, 215, 0, 0.2)');
    gradient.addColorStop(1, 'rgba(255, 215, 0, 0)');
    
    ctx.globalAlpha = alpha * 0.3;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 2.5, 0, Math.PI * 2);
    ctx.fill();
    
    // Main orb
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Inner glow
    ctx.globalAlpha = alpha * 0.6;
    ctx.fillStyle = '#ffec8b';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.7, 0, Math.PI * 2);
    ctx.fill();
    
    // Highlight
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(centerX - radius * 0.3, centerY - radius * 0.3, radius * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  
  ctx.globalAlpha = 1;
}

// === ORB COLLECTION PARTICLE SYSTEM ===
interface OrbCollectionParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  createdAt: number;
  lifetime: number;
}

const orbCollectionParticles: OrbCollectionParticle[] = [];
const ORB_PARTICLE_LIFETIME = 600; // ms
const ORB_PARTICLES_PER_COLLECTION = 16;

// Spawn orb collection particles
export function spawnOrbCollectionParticles(x: number, y: number, orbType: string): void {
  // Colors matching rarity system
  const colorMap: Record<string, { r: number; g: number; b: number }> = {
    'common': { r: 0, g: 220, b: 255 },      // Cyan
    'uncommon': { r: 46, g: 204, b: 113 },   // Green
    'rare': { r: 52, g: 152, b: 219 },       // Blue
    'epic': { r: 155, g: 89, b: 182 },       // Purple
    'legendary': { r: 255, g: 215, b: 0 },   // Gold
    'normal': { r: 0, g: 220, b: 255 },      // Legacy cyan
    'gold': { r: 255, g: 215, b: 0 },        // Legacy gold
  };
  const baseColor = colorMap[orbType] || { r: 0, g: 220, b: 255 };
  
  for (let i = 0; i < ORB_PARTICLES_PER_COLLECTION; i++) {
    // Random angle for explosion
    const angle = (Math.PI * 2 * i) / ORB_PARTICLES_PER_COLLECTION + (Math.random() - 0.5) * 0.5;
    const speed = 80 + Math.random() * 60; // pixels per second
    
    // Slight color variation
    const colorVariation = 0.8 + Math.random() * 0.4;
    const r = Math.min(255, Math.floor(baseColor.r * colorVariation));
    const g = Math.min(255, Math.floor(baseColor.g * colorVariation));
    const b = Math.min(255, Math.floor(baseColor.b * colorVariation));
    
    orbCollectionParticles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: `rgb(${r},${g},${b})`,
      size: 3 + Math.random() * 3,
      createdAt: Date.now(),
      lifetime: ORB_PARTICLE_LIFETIME * (0.7 + Math.random() * 0.6),
    });
  }
  
  // Limit total particles
  while (orbCollectionParticles.length > 200) {
    orbCollectionParticles.shift();
  }
}

// Update and draw orb collection particles
export function drawOrbCollectionParticles(ctx: CanvasRenderingContext2D, deltaTime: number): void {
  const now = Date.now();
  const dt = deltaTime / 1000; // Convert to seconds
  
  // Update and draw particles
  for (let i = orbCollectionParticles.length - 1; i >= 0; i--) {
    const particle = orbCollectionParticles[i];
    const age = now - particle.createdAt;
    
    // Remove dead particles
    if (age > particle.lifetime) {
      orbCollectionParticles.splice(i, 1);
      continue;
    }
    
    // Update position with gravity
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += 150 * dt; // Gravity
    
    // Slow down
    particle.vx *= 0.98;
    particle.vy *= 0.98;
    
    // Calculate alpha based on age
    const lifeProgress = age / particle.lifetime;
    const alpha = 1 - lifeProgress;
    
    // Draw particle with glow
    ctx.globalAlpha = alpha * 0.3;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size * 2, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size * (1 - lifeProgress * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }
  
  ctx.globalAlpha = 1;
}

// Fountain orb spray effect
interface FountainOrbSpray {
  orbId: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  orbType: string;
  createdAt: number;
  duration: number;
  particles: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    color: string;
    life: number;
  }>;
}

const fountainOrbSprays: Map<string, FountainOrbSpray> = new Map();
const FOUNTAIN_SPRAY_DURATION = 800; // ms for spray animation

// Track fountain orb spawn timing for progress bar (synchronized with server)
let nextFountainSpawnTime: number | null = null; // Server-provided timestamp
let spawnNotificationTime: number | null = null; // When we received the notification

// Set next fountain spawn time (called from socket listener)
export function setNextFountainSpawnTime(timestamp: number): void {
  nextFountainSpawnTime = timestamp;
  spawnNotificationTime = Date.now();
}

// Spawn a fountain orb spray effect
export function spawnFountainOrbSpray(orb: Orb): void {
  const p = SCALE;
  const centerX = WORLD_WIDTH / 2;
  const centerY = WORLD_HEIGHT / 2;
  const fountainTopX = centerX;
  const fountainTopY = centerY - 25 * p; // Top of fountain bowl
  
  // Check if orb is near fountain (within paved area)
  // Server sends orb.x and orb.y in unscaled coordinates
  // Client needs to scale them for rendering
  const orbX = orb.x * SCALE; // Scale for rendering
  const orbY = orb.y * SCALE; // Scale for rendering
  const dx = orbX - centerX;
  const dy = orbY - centerY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const plazaRadius = 540 * p; // 540 * SCALE = 1620 pixels (increased by 200%)
  
  // Only create spray if orb is within fountain area (with generous margin for rounding)
  // Server spawns between 40-120 pixels from center (unscaled)
  // Client checks: 40*SCALE to 120*SCALE = 120 to 360 pixels from center
  // Allow up to 1.5x radius to account for any coordinate rounding
  if (dist > plazaRadius * 1.5) {
    return; // Not a fountain orb (too far from center)
  }
  
  // Always create spray for orbs near the center (fountain area)
  
  // Get orb color based on type
  const orbType = orb.orbType || 'common';
  const config = ORB_RARITY_CONFIG[orbType] || ORB_RARITY_CONFIG.common;
  const orbColor = config.colors.main;
  
  // Create spray effect
  const spray: FountainOrbSpray = {
    orbId: orb.id,
    startX: fountainTopX,
    startY: fountainTopY,
    endX: orbX,
    endY: orbY,
    orbType,
    createdAt: Date.now(),
    duration: FOUNTAIN_SPRAY_DURATION,
    particles: [],
  };
  
  // Create particles along the trajectory
  const particleCount = 15;
  const distance = Math.sqrt((orbX - fountainTopX) ** 2 + (orbY - fountainTopY) ** 2);
  const travelTime = FOUNTAIN_SPRAY_DURATION / 1000; // seconds
  
  for (let i = 0; i < particleCount; i++) {
    const t = i / particleCount;
    const x = fountainTopX + (orbX - fountainTopX) * t;
    const y = fountainTopY + (orbY - fountainTopY) * t;
    
    // Add some randomness perpendicular to trajectory
    const angle = Math.atan2(orbY - fountainTopY, orbX - fountainTopX);
    const perpAngle = angle + Math.PI / 2;
    const spread = (Math.random() - 0.5) * 15 * p;
    const px = x + Math.cos(perpAngle) * spread;
    const py = y + Math.sin(perpAngle) * spread;
    
    // Velocity towards end position (pixels per second)
    const baseSpeed = distance / travelTime;
    const speedVariation = 0.7 + Math.random() * 0.6; // 0.7x to 1.3x
    const vx = (orbX - fountainTopX) / distance * baseSpeed * speedVariation;
    const vy = (orbY - fountainTopY) / distance * baseSpeed * speedVariation;
    
    spray.particles.push({
      x: px,
      y: py,
      vx: vx,
      vy: vy,
      size: 4 + Math.random() * 5,
      color: orbColor,
      life: 1.0,
    });
  }
  
  fountainOrbSprays.set(orb.id, spray);
}

// Update and draw fountain orb sprays
export function updateAndDrawFountainOrbSprays(ctx: CanvasRenderingContext2D, deltaTime: number): void {
  const now = Date.now();
  const dt = deltaTime / 1000; // Convert to seconds
  
  for (const [orbId, spray] of fountainOrbSprays.entries()) {
    const age = now - spray.createdAt;
    
    // Remove old sprays
    if (age > spray.duration) {
      fountainOrbSprays.delete(orbId);
      continue;
    }
    
    const progress = age / spray.duration;
    
    // Update and draw particles
    for (const particle of spray.particles) {
      // Update position
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      
      // Apply gravity
      particle.vy += 200 * dt;
      
      // Fade out
      particle.life = 1 - progress;
      
      // Draw particle
      const alpha = Math.max(0, particle.life * 0.9);
      const size = particle.size;
      
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, size, 0, Math.PI * 2);
      ctx.fill();
      
      // Inner glow
      ctx.globalAlpha = alpha * 0.6;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Draw main orb trail (leading particle) - more visible
    if (progress < 1.0) {
      const trailX = spray.startX + (spray.endX - spray.startX) * progress;
      const trailY = spray.startY + (spray.endY - spray.startY) * progress;
      const config = ORB_RARITY_CONFIG[spray.orbType] || ORB_RARITY_CONFIG.common;
      
      // Draw glowing trail (larger and more visible)
      const trailAlpha = (1 - progress) * 0.8;
      ctx.globalAlpha = trailAlpha;
      ctx.fillStyle = config.colors.main;
      ctx.shadowColor = config.colors.main;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(trailX, trailY, 10 * SCALE, 0, Math.PI * 2);
      ctx.fill();
      
      // Inner bright core
      ctx.globalAlpha = trailAlpha * 0.7;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(trailX, trailY, 5 * SCALE, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

// === SHRINE ORB EXPLOSION ANIMATION ===
interface ShrineOrbLaunch {
  orbId: string;
  shrineX: number; // Unscaled shrine position
  shrineY: number; // Unscaled shrine position
  endX: number; // Unscaled target position
  endY: number; // Unscaled target position
  orbType: string;
  createdAt: number;
  duration: number;
  particles: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    color: string;
    life: number;
  }>;
}

const shrineOrbLaunches: Map<string, ShrineOrbLaunch> = new Map();
const SHRINE_ORB_LAUNCH_DURATION = 1000; // ms for launch animation
const SHRINE_ORB_HIDE_DURATION = 100; // Hide actual orb for this long after spawn

// Track orbs that should be hidden during animation
const hiddenShrineOrbs: Map<string, number> = new Map(); // orbId -> hideUntil timestamp

// Spawn a shrine orb launch animation
export function spawnShrineOrbLaunch(orb: Orb): void {
  if (!orb.fromShrine) return;
  
  const p = SCALE;
  const shrineX = orb.fromShrine.shrineX * SCALE; // Scale for rendering
  const shrineY = orb.fromShrine.shrineY * SCALE; // Scale for rendering
  
  // Shrine top position (crystal at top of pillar)
  // Pillar height is 20 * SCALE, crystal is at top
  const pillarHeight = 20 * p;
  const crystalSize = 6 * p;
  const shrineTopX = shrineX;
  const shrineTopY = shrineY - pillarHeight - crystalSize / 2;
  
  // Target position (where orb will land)
  const endX = orb.x * SCALE; // Scale for rendering
  const endY = orb.y * SCALE; // Scale for rendering
  
  // Get orb color based on type
  const orbType = orb.orbType || 'common';
  const config = ORB_RARITY_CONFIG[orbType] || ORB_RARITY_CONFIG.common;
  const orbColor = config.colors.main;
  
  // Create launch animation
  const launch: ShrineOrbLaunch = {
    orbId: orb.id,
    shrineX: orb.fromShrine.shrineX,
    shrineY: orb.fromShrine.shrineY,
    endX: orb.x,
    endY: orb.y,
    orbType,
    createdAt: Date.now(),
    duration: SHRINE_ORB_LAUNCH_DURATION,
    particles: [],
  };
  
  // Create particles along the trajectory (explosion effect)
  const particleCount = 20;
  const distance = Math.sqrt((endX - shrineTopX) ** 2 + (endY - shrineTopY) ** 2);
  const travelTime = SHRINE_ORB_LAUNCH_DURATION / 1000; // seconds
  
  // Initial explosion burst (orbs shooting out)
  for (let i = 0; i < particleCount; i++) {
    const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.3;
    const initialSpeed = 200 + Math.random() * 150; // Fast initial speed
    const vx = Math.cos(angle) * initialSpeed;
    const vy = Math.sin(angle) * initialSpeed - 100; // Upward bias
    
    launch.particles.push({
      x: shrineTopX,
      y: shrineTopY,
      vx: vx,
      vy: vy,
      size: 6 + Math.random() * 8,
      color: orbColor,
      life: 1.0,
    });
  }
  
  // Main orb trajectory particle (the actual orb) - calculate parabolic arc
  // Use physics to create a proper arc from shrine top to landing position
  const gravity = 300; // pixels per second squared
  const horizontalDistance = endX - shrineTopX;
  const verticalDistance = endY - shrineTopY;
  
  // Calculate initial velocity for parabolic trajectory
  // Using physics: y = y0 + vy0*t - 0.5*g*t^2
  // We want to reach endY at time travelTime
  // Solve for vy0: vy0 = (verticalDistance + 0.5*gravity*travelTime^2) / travelTime
  const vy0 = (verticalDistance + 0.5 * gravity * travelTime * travelTime) / travelTime;
  const vx0 = horizontalDistance / travelTime;
  
  // Add some randomness for variation
  const speedVariation = 0.9 + Math.random() * 0.2; // 0.9x to 1.1x
  const trajectoryVx = vx0 * speedVariation;
  const trajectoryVy = vy0 * speedVariation;
  
  launch.particles.push({
    x: shrineTopX,
    y: shrineTopY,
    vx: trajectoryVx,
    vy: trajectoryVy,
    size: 14 + Math.random() * 6, // Larger main orb
    color: orbColor,
    life: 1.0,
  });
  
  shrineOrbLaunches.set(orb.id, launch);
  
  // Hide the actual orb until animation completes
  hiddenShrineOrbs.set(orb.id, Date.now() + SHRINE_ORB_LAUNCH_DURATION + SHRINE_ORB_HIDE_DURATION);
}

// Update and draw shrine orb launches
export function updateAndDrawShrineOrbLaunches(ctx: CanvasRenderingContext2D, deltaTime: number): void {
  const now = Date.now();
  const dt = deltaTime / 1000; // Convert to seconds
  
  for (const [orbId, launch] of shrineOrbLaunches.entries()) {
    const age = now - launch.createdAt;
    
    // Remove old launches
    if (age > launch.duration) {
      shrineOrbLaunches.delete(orbId);
      continue;
    }
    
    const progress = age / launch.duration;
    
    // Scale shrine position for rendering
    const shrineTopX = launch.shrineX * SCALE;
    const shrineTopY = launch.shrineY * SCALE - 20 * SCALE - 3 * SCALE; // Top of pillar + crystal
    
    // Update and draw particles
    for (const particle of launch.particles) {
      // Update position
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      
      // Apply gravity
      particle.vy += 300 * dt; // Stronger gravity for dramatic arc
      
      // Fade out
      particle.life = 1 - progress;
      
      // Draw particle with glow
      const alpha = Math.max(0, particle.life * 0.95);
      const size = particle.size;
      
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, size, 0, Math.PI * 2);
      ctx.fill();
      
      // Inner bright core
      ctx.globalAlpha = alpha * 0.7;
      ctx.fillStyle = '#ffffff';
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

// Check if an orb should be hidden (during animation)
export function isShrineOrbHidden(orbId: string): boolean {
  const hideUntil = hiddenShrineOrbs.get(orbId);
  if (!hideUntil) return false;
  
  if (Date.now() < hideUntil) {
    return true;
  } else {
    // Clean up
    hiddenShrineOrbs.delete(orbId);
    return false;
  }
}

// Floating text for "+X" orb collection indicator
interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  createdAt: number;
  lifetime: number;
  scale: number; // Scale factor for text size
}

const floatingTexts: FloatingText[] = [];
const FLOATING_TEXT_LIFETIME = 1200; // ms

// Spawn floating text (called when collecting orbs)
export function spawnFloatingText(x: number, y: number, value: number, orbType: string, scale: number = 1.0): void {
  // Colors matching rarity system
  const colors: Record<string, string> = {
    'common': '#00dcff',     // Cyan
    'uncommon': '#2ecc71',   // Green
    'rare': '#3498db',       // Blue
    'epic': '#9b59b6',       // Purple
    'legendary': '#ffd700',  // Gold
    'normal': '#00dcff',     // Legacy cyan
    'gold': '#ffd700',       // Legacy gold
    'shrine': '#dc143c',     // Red (crimson) for shrine orbs
  };
  const color = colors[orbType] || '#00dcff';
  
  // Debug removed
  
  floatingTexts.push({
    x,
    y,
    text: `+${value}`,
    color,
    createdAt: Date.now(),
    lifetime: FLOATING_TEXT_LIFETIME,
    scale,
  });
  
  // Limit total floating texts
  while (floatingTexts.length > 20) {
    floatingTexts.shift();
  }
}

// Draw floating texts
export function drawFloatingTexts(ctx: CanvasRenderingContext2D): void {
  const now = Date.now();
  
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    const age = now - ft.createdAt;
    
    // Remove expired texts
    if (age > ft.lifetime) {
      floatingTexts.splice(i, 1);
      continue;
    }
    
    // Calculate animation progress
    const progress = age / ft.lifetime;
    const alpha = Math.max(0, 1 - progress * 0.8); // Fade out slower
    const yOffset = -60 * progress * ft.scale; // Float upward more (scaled)
    const animScale = (1.2 + progress * 0.5) * ft.scale; // Start bigger, grow more (scaled)
    
    // Draw text with outline for visibility
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `bold ${Math.floor(28 * animScale)}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Thick outline for visibility (scaled)
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 5 * ft.scale;
    ctx.strokeText(ft.text, ft.x, ft.y + yOffset);
    
    // Fill with strong glow (scaled)
    ctx.shadowColor = ft.color;
    ctx.shadowBlur = 15 * ft.scale;
    ctx.fillStyle = ft.color;
    ctx.fillText(ft.text, ft.x, ft.y + yOffset);
    
    // Draw again for extra brightness
    ctx.fillText(ft.text, ft.x, ft.y + yOffset);
    
    ctx.restore();
  }
}

const WALK_FRAMES = 4; // number of walk cycle frames
const BASE_DISTANCE_PER_FRAME = 20.0; // distance units traveled per animation frame at 1x speed
const IDLE_BOB_INTERVAL = 3000; // ms between idle bobs
const IDLE_BOB_DURATION = 500; // ms for one bob cycle

// Extended animation interface to track distance
interface ExtendedPlayerAnimation extends PlayerAnimation {
  distanceTraveled: number;
}

const extendedPlayerAnimations: Map<string, ExtendedPlayerAnimation> = new Map();

// Track which players are chopping
const choppingPlayers: Map<string, { startTime: number }> = new Map();

export function setPlayerChopping(playerId: string, isChopping: boolean): void {
  if (isChopping) {
    choppingPlayers.set(playerId, { startTime: Date.now() });
  } else {
    choppingPlayers.delete(playerId);
  }
}

export function isPlayerChopping(playerId: string): boolean {
  return choppingPlayers.has(playerId);
}

function getPlayerAnimation(playerId: string, x: number, y: number, time: number): PlayerAnimation {
  let anim = extendedPlayerAnimations.get(playerId);
  
  if (!anim) {
    anim = { 
      lastX: x, 
      lastY: y, 
      frame: 0, 
      lastFrameTime: time, 
      isMoving: false, 
      idleTime: time,
      idleBobPhase: 0,
      distanceTraveled: 0,
      isChopping: false,
      chopFrame: 0,
      chopStartTime: 0
    };
    extendedPlayerAnimations.set(playerId, anim);
    return anim;
  }
  
  // Check if player is chopping
  const choppingState = choppingPlayers.get(playerId);
  const isChopping = choppingState !== undefined;
  
  if (isChopping) {
    // Chopping animation - cycle through frames
    anim.isChopping = true;
    anim.isMoving = false; // Can't move while chopping
    anim.idleBobPhase = 0;
    
    // Calculate chop frame based on time (jump every 1000ms = 1 second)
    const chopElapsed = time - choppingState.startTime;
    // Jump animation: 0-200ms = up, 200-400ms = down, then wait until next second
    const secondElapsed = chopElapsed % 1000; // Time within current second
    if (secondElapsed < 200) {
      anim.chopFrame = 0; // Jumping up
    } else if (secondElapsed < 400) {
      anim.chopFrame = 1; // Landing down
    } else {
      anim.chopFrame = 2; // Idle (waiting for next hit)
    }
    anim.chopStartTime = choppingState.startTime;
    
    // Update position tracking but don't change frame
    anim.lastX = x;
    anim.lastY = y;
    anim.lastFrameTime = time;
    
    return anim;
  } else {
    anim.isChopping = false;
    anim.chopFrame = 0;
    anim.chopStartTime = 0;
  }
  
  // Validate position values
  if (!isFinite(x) || !isFinite(y)) {
    return anim;
  }
  
  // Calculate movement delta
  const dx = x - anim.lastX;
  const dy = y - anim.lastY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const isMoving = distance > 0.02;
  
  if (isMoving) {
    // Player is moving
    anim.isMoving = true;
    anim.idleTime = time;
    anim.idleBobPhase = 0;
    
    // Accumulate distance traveled
    anim.distanceTraveled += distance;
    
    // Advance animation frame based on distance traveled
    // Animation speed scales naturally with movement speed since faster = more distance per frame
    if (anim.distanceTraveled >= BASE_DISTANCE_PER_FRAME) {
      anim.frame = (anim.frame + 1) % WALK_FRAMES;
      anim.distanceTraveled = anim.distanceTraveled % BASE_DISTANCE_PER_FRAME;
    }
  } else {
    // Player is idle
    if (anim.isMoving) {
      // Just stopped moving
      anim.idleTime = time;
      anim.distanceTraveled = 0;
    }
    anim.isMoving = false;
    anim.frame = 0; // Standing pose
    
    // Calculate idle bob phase
    const timeSinceIdle = time - anim.idleTime;
    if (timeSinceIdle >= IDLE_BOB_INTERVAL) {
      const bobCycleTime = (timeSinceIdle - IDLE_BOB_INTERVAL) % IDLE_BOB_INTERVAL;
      if (bobCycleTime < IDLE_BOB_DURATION) {
        anim.idleBobPhase = bobCycleTime / IDLE_BOB_DURATION;
      } else {
        anim.idleBobPhase = 0;
      }
    } else {
      anim.idleBobPhase = 0;
    }
  }
  
  // Update position tracking
  anim.lastX = x;
  anim.lastY = y;
  anim.lastFrameTime = time;
  
  return anim;
}

// Calculate idle bob offset
function getIdleBobOffset(anim: PlayerAnimation): number {
  if (anim.isMoving || anim.idleBobPhase <= 0) return 0;
  // Smooth sine wave for bob (0 to 1 phase maps to down and back up)
  const offset = Math.sin(anim.idleBobPhase * Math.PI) * -1.5;
  return isFinite(offset) ? offset : 0;
}

// Draw sleepy "zzz" when player is idle for a while
function drawSleepyZs(ctx: CanvasRenderingContext2D, headX: number, headY: number, headW: number, p: number, time: number, idleStartTime: number): void {
  const timeSinceIdle = time - idleStartTime;
  
  // Only show after player has been idle for IDLE_BOB_INTERVAL
  if (timeSinceIdle < IDLE_BOB_INTERVAL) return;
  
  // Animation cycle for floating Zs (2 second loop)
  const cycleTime = (timeSinceIdle - IDLE_BOB_INTERVAL) % 2000;
  const cycleProgress = cycleTime / 2000; // 0 to 1
  
  ctx.font = `bold ${Math.floor(8 * p / 2)}px "Press Start 2P", monospace`;
  ctx.textAlign = 'center';
  
  // Draw 3 Z's at different phases, floating up and swaying
  const zPositions = [
    { delay: 0, size: 1.0 },      // First Z
    { delay: 0.33, size: 0.8 },   // Second Z (smaller, delayed)
    { delay: 0.66, size: 0.6 },   // Third Z (smallest, most delayed)
  ];
  
  for (const zPos of zPositions) {
    // Calculate this Z's progress (wraps around)
    const zProgress = (cycleProgress + zPos.delay) % 1;
    
    // Fade in at start, fade out at end
    let alpha = 1;
    if (zProgress < 0.1) {
      alpha = zProgress / 0.1; // Fade in
    } else if (zProgress > 0.8) {
      alpha = (1 - zProgress) / 0.2; // Fade out
    }
    
    // Float upward
    const floatY = -zProgress * 25 * p;
    
    // Sway left and right
    const swayX = Math.sin(zProgress * Math.PI * 3) * 4 * p;
    
    // Position above head, offset to the right
    const x = headX + headW + 2 * p + swayX + (1 - zPos.size) * 6 * p;
    const y = headY - 2 * p + floatY;
    
    // Size decreases as they float up
    const currentSize = zPos.size * (1 - zProgress * 0.3);
    ctx.font = `bold ${Math.floor(8 * p / 2 * currentSize)}px "Press Start 2P", monospace`;
    
    // Draw with transparency
    ctx.globalAlpha = alpha * 0.8;
    ctx.fillStyle = '#a0d0ff'; // Light blue color
    ctx.fillText('z', x, y);
    
    // Add a slight shadow/outline
    ctx.fillStyle = '#4080b0';
    ctx.fillText('z', x + p * 0.5, y + p * 0.5);
    ctx.fillStyle = '#a0d0ff';
    ctx.fillText('z', x, y);
  }
  
  // Reset alpha
  ctx.globalAlpha = 1;
}

export function drawPlayer(
  ctx: CanvasRenderingContext2D, 
  player: PlayerWithChat,
  isLocal: boolean = false,
  time: number = Date.now(),
  skipNameplate: boolean = false
): void {
  const scaledX = player.x * SCALE;
  const scaledY = player.y * SCALE;
  const scaledWidth = PLAYER_WIDTH * SCALE;
  const scaledHeight = PLAYER_HEIGHT * SCALE;
  const p = SCALE;
  
  // Get animation state
  const anim = getPlayerAnimation(player.id, player.x, player.y, time);
  
  // Calculate bounce offset when walking or idle bob
  let bounceY = 0;
  if (anim.isChopping) {
    // Chopping animation - jump every second
    const choppingState = choppingPlayers.get(player.id);
    if (choppingState) {
      const chopElapsed = time - choppingState.startTime;
      const secondElapsed = chopElapsed % 1000; // Time within current second (0-1000ms)
      if (secondElapsed < 200) {
        // Jump up animation (0-200ms)
        const jumpProgress = secondElapsed / 200; // 0 to 1
        // Smooth jump curve (sine wave)
        const jumpHeight = Math.sin(jumpProgress * Math.PI) * -8 * p;
        bounceY = jumpHeight;
      } else if (secondElapsed < 400) {
        // Landing down animation (200-400ms)
        const landProgress = (secondElapsed - 200) / 200; // 0 to 1
        // Quick bounce down then settle
        const landBounce = Math.sin(landProgress * Math.PI) * 2 * p;
        bounceY = landBounce;
      } else {
        // Idle between jumps (400-1000ms)
        bounceY = 0;
      }
    }
  } else if (anim.isMoving) {
    // Bounce on frames 0 and 2 (when legs are extended)
    bounceY = (anim.frame === 0 || anim.frame === 2) ? -p : 0;
  } else {
    // Idle bob animation
    bounceY = getIdleBobOffset(anim) * p;
  }
  
  ctx.imageSmoothingEnabled = false;
  
  // Shadow (doesn't bounce)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.beginPath();
  ctx.ellipse(scaledX + scaledWidth / 2, scaledY + scaledHeight, scaledWidth / 2, scaledWidth / 5, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Head (apply bounce)
  const headW = 10 * p;
  const headH = 10 * p;
  const headX = scaledX + (scaledWidth - headW) / 2;
  const headY = scaledY + bounceY;
  
  // Outline
  ctx.fillStyle = PLAYER_COLORS.outline;
  ctx.fillRect(headX - p, headY, headW + 2 * p, headH + p);
  
  // Hair back
  ctx.fillStyle = PLAYER_COLORS.hair;
  ctx.fillRect(headX, headY, headW, 4 * p);
  
  // Face
  ctx.fillStyle = PLAYER_COLORS.skin;
  ctx.fillRect(headX, headY + 2 * p, headW, headH - 2 * p);
  
  // Hair front
  ctx.fillStyle = PLAYER_COLORS.hair;
  ctx.fillRect(headX, headY, headW, 3 * p);
  
  // Eyes
  ctx.fillStyle = '#2c2c2c';
  if (player.direction === 'down') {
    ctx.fillRect(headX + 2 * p, headY + 5 * p, 2 * p, 2 * p);
    ctx.fillRect(headX + 6 * p, headY + 5 * p, 2 * p, 2 * p);
  } else if (player.direction === 'left') {
    ctx.fillRect(headX + p, headY + 5 * p, 2 * p, 2 * p);
  } else if (player.direction === 'right') {
    ctx.fillRect(headX + 7 * p, headY + 5 * p, 2 * p, 2 * p);
  }
  
  // Body (apply bounce)
  const bodyW = 12 * p;
  const bodyH = 8 * p;
  const bodyX = scaledX + (scaledWidth - bodyW) / 2;
  const bodyY = scaledY + headH + bounceY;
  
  // Get shirt color/style
  const shirtColor = getShirtColor(player.sprite.outfit);
  const shirtStyle = getShirtStyle(player.sprite.outfit);
  
  // Draw back accessories (capes) BEFORE body (scaledY already includes bounceY)
  drawBackAccessories(ctx, player, scaledX, scaledY + bounceY, scaledWidth, p, anim.isMoving, time);
  
  // Draw wings separately (they can be equipped alongside accessories) (scaledY already includes bounceY)
  drawWings(ctx, player, scaledX, scaledY + bounceY, scaledWidth, p, time);
  
  // Spawn and draw legendary item particles BEHIND the player's face
  const playerCenterX = scaledX + scaledWidth / 2;
  const playerCenterY = scaledY + scaledHeight / 2;
  spawnLegendaryParticles(player.id, playerCenterX, playerCenterY, player.sprite.outfit, time);
  updateAndDrawLegendaryParticles(ctx, player.id, 16, time); // ~60fps delta

  ctx.fillStyle = PLAYER_COLORS.outline;
  ctx.fillRect(bodyX - p, bodyY, bodyW + 2 * p, bodyH + p);
  
  // Draw shirt with style (draw first so chopping arms appear on top)
  drawShirt(ctx, player, bodyX, bodyY, bodyW, bodyH, p, shirtColor, shirtStyle, time);
  
  // No arms animation - just jumping animation handled in bounceY
  
  // Legs (animated when walking)
  const legW = 5 * p;
  const legH = 6 * p;
  const legY = bodyY + bodyH;
  
  // Calculate leg offsets based on animation frame
  let leftLegOffset = 0;
  let rightLegOffset = 0;
  
  if (anim.isChopping) {
    // Chopping animation - slight leg movement
    switch (anim.chopFrame) {
      case 0: // Arms up
        leftLegOffset = -1 * p;
        rightLegOffset = 1 * p;
        break;
      case 1: // Arms down (chop)
        leftLegOffset = 0;
        rightLegOffset = 0;
        break;
      case 2: // Arms up
        leftLegOffset = 1 * p;
        rightLegOffset = -1 * p;
        break;
      case 3: // Arms down (chop)
        leftLegOffset = 0;
        rightLegOffset = 0;
        break;
    }
  } else if (anim.isMoving) {
    // Walk cycle: frame 0 = left forward, 1 = together, 2 = right forward, 3 = together
    switch (anim.frame) {
      case 0: // Left leg forward
        leftLegOffset = -2 * p;
        rightLegOffset = 2 * p;
        break;
      case 1: // Passing
        leftLegOffset = 0;
        rightLegOffset = 0;
        break;
      case 2: // Right leg forward
        leftLegOffset = 2 * p;
        rightLegOffset = -2 * p;
        break;
      case 3: // Passing
        leftLegOffset = 0;
        rightLegOffset = 0;
        break;
    }
  }
  
  // Draw legs with cosmetics
  drawLegs(ctx, player, bodyX, bodyW, legY, legW, legH, p, leftLegOffset, rightLegOffset, time);
  
  // Draw cape in FRONT when facing up (back to camera) - after body is drawn (scaledY already includes bounceY)
  if (player.direction === 'up') {
    drawCape(ctx, player, scaledX, scaledY + bounceY, scaledWidth, p, anim.isMoving, time, 'front');
  }
  
  // Hat
  if (player.sprite.outfit.some(item => item.startsWith('hat_'))) {
    drawHat(ctx, player, headX, headY, headW, p, time);
  }
  
  // Face accessories (glasses, eyepatch, etc)
  drawFaceAccessories(ctx, player, headX, headY, headW, p);
  
  // Front accessories (sword, staff, etc) (scaledY already includes bounceY)
  drawFrontAccessories(ctx, player, scaledX, scaledY + bounceY, scaledWidth, p, time);
  
  // Sleepy Zs when idle (only for local player, not NPCs)
  if (!anim.isMoving && isLocal) {
    drawSleepyZs(ctx, headX, headY, headW, p, time, anim.idleTime);
  }
  
  // Draw nameplate above the player (above arrow position)
  // Skip nameplate if explicitly requested, or for centurions (they're drawn separately on top of everything)
  if (!skipNameplate && !player.id.startsWith('centurion_')) {
    // For game NPCs (merchants), use Infinity as orb count to show infinity icon in nameplate
    // For background NPCs (walking around), use their actual orb balance
    // Get zoom from context transform (inverse of scale applied)
    const zoom = ctx.getTransform().a || 1; // Get scale from transform matrix
    // Check if this is a game NPC (merchant) - they have IDs like 'npc_hats_legendary', 'npc_shirts_epic', etc.
    // Background NPCs have IDs like 'npc_0', 'npc_1', etc. and should show their orb balance
    // Game NPCs have at least 3 parts when split by '_' (npc, category, rarity)
    const idParts = player.id.split('_');
    const isGameNPC = player.id.startsWith('npc_') && idParts.length >= 3;
    if (isGameNPC) {
      drawNameTag(ctx, player.name, scaledX + scaledWidth / 2, scaledY - 20 * p, Infinity, zoom, player.id, time);
    } else {
      // For real players, use their actual orb balance (default to 0 if not set)
      const orbCount = typeof player.orbs === 'number' ? player.orbs : 0;
      drawNameTag(ctx, player.name, scaledX + scaledWidth / 2, scaledY - 20 * p, orbCount, zoom, player.id, time);
    }
  }
  
  // Local indicator (green arrow below nameplate)
  if (isLocal) {
    ctx.fillStyle = 'rgba(46, 204, 113, 0.9)';
    ctx.beginPath();
    ctx.moveTo(scaledX + scaledWidth / 2, scaledY - 8 * p);
    ctx.lineTo(scaledX + scaledWidth / 2 - 4 * p, scaledY - 14 * p);
    ctx.lineTo(scaledX + scaledWidth / 2 + 4 * p, scaledY - 14 * p);
    ctx.closePath();
    ctx.fill();
  }
}

function getShirtColor(outfit: string[]): string {
  if (outfit.includes('shirt_red')) return '#e74c3c';
  if (outfit.includes('shirt_blue')) return '#3498db';
  if (outfit.includes('shirt_green')) return '#27ae60';
  if (outfit.includes('shirt_yellow')) return '#f1c40f';
  if (outfit.includes('shirt_purple')) return '#9b59b6';
  if (outfit.includes('shirt_pink')) return '#e91e9b';
  if (outfit.includes('shirt_black')) return '#2c3e50';
  if (outfit.includes('shirt_white')) return '#ecf0f1';
  if (outfit.includes('shirt_hoodie')) return '#7f8c8d';
  if (outfit.includes('shirt_hawaiian')) return '#e67e22';
  if (outfit.includes('shirt_striped')) return '#34495e';
  if (outfit.includes('shirt_tuxedo')) return '#1a1a2e';
  if (outfit.includes('robe_wizard')) return '#8e44ad';
  if (outfit.includes('robe_dark')) return '#1a1a1a';
  if (outfit.includes('dress_princess')) return '#ff69b4';
  if (outfit.includes('robe_angel')) return '#ffefd5';
  if (outfit.includes('armor_knight')) return '#7f8c8d';
  if (outfit.includes('armor_samurai')) return '#c0392b';
  if (outfit.includes('armor_gold')) return '#f39c12';
  if (outfit.includes('coat_chef')) return '#ffffff';
  if (outfit.includes('coat_lab')) return '#ffffff';
  if (outfit.includes('suit_space')) return '#ecf0f1';
  if (outfit.includes('coat_pirate')) return '#8b0000';
  if (outfit.includes('gi_ninja')) return '#2c3e50';
  if (outfit.includes('vest_cowboy')) return '#8b4513';
  if (outfit.includes('tunic_viking')) return '#a0522d';
  if (outfit.includes('jacket_punk')) return '#1a1a1a';
  if (outfit.includes('jacket_neon')) return '#00ff88';
  if (outfit.includes('jacket_leather')) return '#3d3d3d';
  if (outfit.includes('robe_dragon')) return '#c0392b';
  if (outfit.includes('armor_demon')) return '#4a0000';
  if (outfit.includes('robe_phoenix')) return '#ff4500';
  // Legendary shirts
  if (outfit.includes('armor_golden')) return '#ffd700';
  if (outfit.includes('robe_phoenix_legendary')) return '#ff4500';
  if (outfit.includes('armor_void')) return '#2d0a4e';
  if (outfit.includes('robe_celestial')) return '#e8e8ff';
  if (outfit.includes('armor_galaxy')) return '#1a0a3e';
  if (outfit.includes('robe_rainbow')) return '#ff6b6b';
  return PLAYER_COLORS.shirt;
}

function getShirtStyle(outfit: string[]): string {
  for (const item of outfit) {
    if (item.startsWith('shirt_') || item.startsWith('robe_') || 
        item.startsWith('armor_') || item.startsWith('coat_') ||
        item.startsWith('dress_') || item.startsWith('suit_') ||
        item.startsWith('gi_') || item.startsWith('vest_') ||
        item.startsWith('tunic_') || item.startsWith('jacket_')) {
      return item;
    }
  }
  return 'default';
}

function drawShirt(ctx: CanvasRenderingContext2D, player: PlayerWithChat, bodyX: number, bodyY: number, bodyW: number, bodyH: number, p: number, color: string, style: string, time: number = Date.now()): void {
  // Apply rarity glow for shirts
  if (style !== 'default') {
    applyRarityGlow(ctx, style);
  }
  
  ctx.fillStyle = color;
  ctx.fillRect(bodyX, bodyY, bodyW, bodyH);
  
  // === LEGENDARY SHIRTS (check these FIRST before generic checks) ===
  if (style === 'armor_golden') {
    // Draw sleeves
    ctx.fillRect(bodyX - 3 * p, bodyY + 2 * p, 3 * p, 5 * p);
    ctx.fillRect(bodyX + bodyW, bodyY + 2 * p, 3 * p, 5 * p);
    
    // Animated golden shimmer (matching preview)
    const shimmer = Math.sin(time * 0.003) * 0.3 + 0.5;
    ctx.fillStyle = `rgba(255,255,255,${shimmer * 0.5})`;
    ctx.fillRect(bodyX + 2 * p, bodyY + p, bodyW - 4 * p, 3 * p);
    
    // Center gem that pulses (matching preview position)
    const gemPulse = Math.sin(time * 0.004) * 0.2 + 0.8;
    ctx.fillStyle = `rgba(255, 236, 139, ${gemPulse})`;
    ctx.fillRect(bodyX + bodyW / 2 - 3 * p, bodyY + bodyH / 2 - 2 * p, 6 * p, 4 * p);
    
    // Corner accents (matching preview)
    ctx.fillStyle = '#fff8dc';
    ctx.fillRect(bodyX + p, bodyY + 2 * p, 2 * p, 2 * p);
  } else if (style === 'robe_phoenix_legendary') {
    // Draw sleeves FIRST (so they're behind the body)
    ctx.fillRect(bodyX - 3 * p, bodyY + 2 * p, 3 * p, 5 * p);
    ctx.fillRect(bodyX + bodyW, bodyY + 2 * p, 3 * p, 5 * p);
    
    // Robe bottom
    ctx.fillRect(bodyX - p, bodyY + bodyH - p, bodyW + 2 * p, 3 * p);
    
    // Large center gold flame pattern (matching preview exactly) - draw ON TOP of base color
    ctx.fillStyle = '#ffd700'; // Bright gold
    ctx.fillRect(bodyX + bodyW / 2 - 4 * p, bodyY + 2 * p, 8 * p, 6 * p);
    
    // Bottom orange details (matching preview)
    ctx.fillStyle = '#ff6600';
    ctx.fillRect(bodyX + bodyW / 2 - 2 * p, bodyY + bodyH - 4 * p, 4 * p, 4 * p);
    ctx.fillRect(bodyX + p, bodyY + bodyH - 2 * p, 3 * p, 2 * p);
    ctx.fillRect(bodyX + bodyW - 4 * p, bodyY + bodyH - 2 * p, 3 * p, 2 * p);
  } else if (style === 'armor_void') {
    // Draw sleeves
    ctx.fillRect(bodyX - 3 * p, bodyY + 2 * p, 3 * p, 5 * p);
    ctx.fillRect(bodyX + bodyW, bodyY + 2 * p, 3 * p, 5 * p);
    
    // Dark energy pulse (matching preview)
    const voidPulse = Math.sin(time * 0.003) * 0.3 + 0.5;
    ctx.fillStyle = `rgba(75, 0, 130, ${voidPulse + 0.3})`;
    ctx.fillRect(bodyX + 2 * p, bodyY + 2 * p, bodyW - 4 * p, 3 * p);
    
    // Center void (matching preview position)
    const swirl = time * 0.002;
    const swirlX = Math.cos(swirl) * p;
    const swirlY = Math.sin(swirl) * p * 0.5;
    ctx.fillStyle = '#9400d3';
    ctx.fillRect(bodyX + bodyW / 2 - 2 * p + swirlX, bodyY + bodyH / 2 - p + swirlY, 4 * p, 3 * p);
    
    // Dark core (matching preview)
    ctx.fillStyle = '#000000';
    ctx.fillRect(bodyX + bodyW / 2 - p, bodyY + 3 * p, 2 * p, 2 * p);
    
    // Void tendrils
    const tendril = Math.sin(time * 0.004);
    ctx.fillStyle = `rgba(148, 0, 211, ${0.5 + tendril * 0.3})`;
    ctx.fillRect(bodyX + 2 * p, bodyY + 5 * p + tendril * p, p, 2 * p);
    ctx.fillRect(bodyX + bodyW - 3 * p, bodyY + 4 * p - tendril * p, p, 2 * p);
  } else if (style === 'robe_celestial') {
    // Draw sleeves
    ctx.fillRect(bodyX - 3 * p, bodyY + 2 * p, 3 * p, 5 * p);
    ctx.fillRect(bodyX + bodyW, bodyY + 2 * p, 3 * p, 5 * p);
    
    // Robe bottom
    ctx.fillRect(bodyX - p, bodyY + bodyH - p, bodyW + 2 * p, 3 * p);
    
    // Center star pattern (matching preview)
    const star1 = Math.sin(time * 0.005) * 0.5 + 0.5;
    const star2 = Math.sin(time * 0.004 + 1) * 0.5 + 0.5;
    const star3 = Math.sin(time * 0.006 + 2) * 0.5 + 0.5;
    
    ctx.fillStyle = `rgba(255, 250, 205, ${star1})`;
    ctx.fillRect(bodyX + bodyW / 2 - 2 * p, bodyY + 2 * p, 4 * p, 4 * p);
    ctx.fillStyle = `rgba(255, 250, 205, ${star2})`;
    ctx.fillRect(bodyX + 3 * p, bodyY + 5 * p, 2 * p, 2 * p);
    ctx.fillStyle = `rgba(255, 250, 205, ${star3})`;
    ctx.fillRect(bodyX + bodyW - 5 * p, bodyY + 4 * p, 2 * p, 2 * p);
    
    // Gentle glow
    const glow = Math.sin(time * 0.002) * 0.15 + 0.2;
    ctx.fillStyle = `rgba(255, 255, 255, ${glow})`;
    ctx.fillRect(bodyX + 3 * p, bodyY + 3 * p, bodyW - 6 * p, 3 * p);
  } else if (style === 'armor_galaxy') {
    // Draw sleeves
    ctx.fillRect(bodyX - 3 * p, bodyY + 2 * p, 3 * p, 5 * p);
    ctx.fillRect(bodyX + bodyW, bodyY + 2 * p, 3 * p, 5 * p);
    
    // Swirling galaxy colors (matching preview)
    const galaxyShift = time * 0.001;
    const blueIntensity = Math.sin(galaxyShift) * 0.3 + 0.7;
    const purpleIntensity = Math.sin(galaxyShift + 1) * 0.3 + 0.7;
    
    ctx.fillStyle = `rgba(65, 105, 225, ${blueIntensity})`;
    ctx.fillRect(bodyX + 2 * p, bodyY + 2 * p, bodyW - 4 * p, 4 * p);
    ctx.fillStyle = `rgba(148, 0, 211, ${purpleIntensity})`;
    ctx.fillRect(bodyX + bodyW / 2 - 3 * p, bodyY + bodyH / 2 - p, 6 * p, 3 * p);
    
    // Twinkling stars (matching preview positions)
    const starTwinkle1 = Math.sin(time * 0.008) > 0.3;
    const starTwinkle2 = Math.sin(time * 0.007 + 1) > 0.3;
    const starTwinkle3 = Math.sin(time * 0.009 + 2) > 0.3;
    
    if (starTwinkle1) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(bodyX + bodyW / 2 - p, bodyY + 3 * p, 2 * p, 2 * p);
    }
    if (starTwinkle2) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(bodyX + 3 * p, bodyY + 5 * p, p, p);
    }
    if (starTwinkle3) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(bodyX + bodyW - 4 * p, bodyY + 6 * p, p, p);
    }
  } else if (style === 'robe_rainbow') {
    // Draw sleeves
    ctx.fillRect(bodyX - 3 * p, bodyY + 2 * p, 3 * p, 5 * p);
    ctx.fillRect(bodyX + bodyW, bodyY + 2 * p, 3 * p, 5 * p);
    
    // Robe bottom
    ctx.fillRect(bodyX - p, bodyY + bodyH - p, bodyW + 2 * p, 3 * p);
    
    // Rainbow bands (matching preview)
    ctx.fillStyle = '#ff7f00';
    ctx.fillRect(bodyX, bodyY + 2 * p, bodyW, 2 * p);
    ctx.fillStyle = '#ffff00';
    ctx.fillRect(bodyX, bodyY + 4 * p, bodyW, 2 * p);
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(bodyX, bodyY + 6 * p, bodyW, 2 * p);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(bodyX, bodyY + 8 * p, bodyW, 2 * p);
    
    // Shimmer effect
    const shimmerX = ((time * 0.01) % (bodyW / p)) * p;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillRect(bodyX + shimmerX, bodyY + p, 2 * p, bodyH - 2 * p);
  }
  // Add style-specific details
  else if (style === 'shirt_striped') {
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < bodyH; i += 3 * p) {
      ctx.fillRect(bodyX, bodyY + i, bodyW, p);
    }
  } else if (style === 'shirt_hawaiian') {
    ctx.fillStyle = '#f1c40f';
    ctx.fillRect(bodyX + 2 * p, bodyY + 2 * p, 2 * p, 2 * p);
    ctx.fillRect(bodyX + 7 * p, bodyY + 4 * p, 2 * p, 2 * p);
  } else if (style === 'shirt_tuxedo') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bodyX + bodyW / 2 - p, bodyY, 2 * p, bodyH);
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(bodyX + bodyW / 2 - p, bodyY + p, 2 * p, 2 * p);
  } else if (style.startsWith('robe_')) {
    // Robes have longer bottom
    ctx.fillRect(bodyX - p, bodyY + bodyH - p, bodyW + 2 * p, 3 * p);
    if (style === 'robe_wizard') {
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(bodyX + bodyW / 2 - p, bodyY + 2 * p, 2 * p, 2 * p);
    }
  } else if (style.startsWith('armor_')) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(bodyX + p, bodyY + p, bodyW - 2 * p, 2 * p);
    if (style === 'armor_gold') {
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(bodyX + bodyW / 2 - 2 * p, bodyY + bodyH / 2 - p, 4 * p, 2 * p);
    }
  } else if (style === 'gi_ninja') {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(bodyX, bodyY, 3 * p, bodyH);
    ctx.fillRect(bodyX + bodyW - 3 * p, bodyY, 3 * p, bodyH);
  } else if (style === 'jacket_neon') {
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(bodyX, bodyY, 2 * p, bodyH);
    ctx.fillRect(bodyX + bodyW - 2 * p, bodyY, 2 * p, bodyH);
    ctx.fillStyle = '#00ffff';
    ctx.fillRect(bodyX + bodyW / 2 - p, bodyY, 2 * p, bodyH);
  } else if (style === 'jacket_punk') {
    ctx.fillStyle = '#7f8c8d';
    ctx.fillRect(bodyX + p, bodyY + p, 3 * p, 2 * p);
    ctx.fillRect(bodyX + bodyW - 4 * p, bodyY + p, 3 * p, 2 * p);
  } else if (style === 'coat_pirate') {
    ctx.fillStyle = '#f1c40f';
    ctx.fillRect(bodyX + p, bodyY + p, 2 * p, 2 * p);
    ctx.fillRect(bodyX + bodyW - 3 * p, bodyY + p, 2 * p, 2 * p);
    ctx.fillRect(bodyX + p, bodyY + 4 * p, 2 * p, 2 * p);
    ctx.fillRect(bodyX + bodyW - 3 * p, bodyY + 4 * p, 2 * p, 2 * p);
  } else if (style === 'dress_princess') {
    ctx.fillStyle = '#ff1493';
    ctx.fillRect(bodyX - 2 * p, bodyY + bodyH - 2 * p, bodyW + 4 * p, 4 * p);
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(bodyX + bodyW / 2 - p, bodyY + p, 2 * p, 2 * p);
  } else if (style === 'suit_space') {
    ctx.fillStyle = '#3498db';
    ctx.fillRect(bodyX + bodyW / 2 - 2 * p, bodyY + 2 * p, 4 * p, 4 * p);
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(bodyX + p, bodyY + bodyH - 2 * p, 2 * p, 2 * p);
  } else if (style === 'robe_phoenix') {
    ctx.fillRect(bodyX - p, bodyY + bodyH - p, bodyW + 2 * p, 3 * p);
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(bodyX + 2 * p, bodyY + 2 * p, 2 * p, 2 * p);
    ctx.fillRect(bodyX + bodyW - 4 * p, bodyY + 3 * p, 2 * p, 2 * p);
  } else if (style === 'shirt_godlike_void') {
    // Void vestments with intense void energy
    const voidVestPulse = Math.sin(time * 0.005) * 0.3 + 0.7;
    const voidVestSwirl = time * 0.004;
    
    // Base void vestments
    ctx.fillStyle = `rgba(0, 0, 0, ${voidVestPulse})`;
    ctx.fillRect(bodyX - 2 * p, bodyY, bodyW + 4 * p, bodyH);
    ctx.fillRect(bodyX - 4 * p, bodyY + 2 * p, 4 * p, 5 * p); // Left sleeve
    ctx.fillRect(bodyX + bodyW, bodyY + 2 * p, 4 * p, 5 * p); // Right sleeve
    
    // Swirling void energy across the chest
    for (let i = 0; i < 5; i++) {
      const swirlPhase = voidVestSwirl + i * 1.2;
      const swirlX = bodyX + (i + 1) * bodyW / 6 + Math.sin(swirlPhase) * 2 * p;
      const swirlY = bodyY + bodyH / 2 + Math.cos(swirlPhase * 0.8) * 2 * p;
      ctx.fillStyle = `rgba(75, 0, 130, ${voidVestPulse})`;
      ctx.beginPath();
      ctx.arc(swirlX, swirlY, 2 * p, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Void portal center
    const portalPhase = voidVestSwirl;
    ctx.strokeStyle = `rgba(148, 0, 211, ${voidVestPulse})`;
    ctx.lineWidth = 2 * p;
    ctx.beginPath();
    ctx.arc(bodyX + bodyW / 2, bodyY + bodyH / 2, 4 * p + Math.sin(portalPhase) * p, 0, Math.PI * 2);
    ctx.stroke();
    
    // Dark energy tendrils
    for (let i = 0; i < 3; i++) {
      const tendrilPhase = voidVestSwirl + i * 2;
      ctx.fillStyle = `rgba(128, 0, 128, ${voidVestPulse * 0.7})`;
      ctx.fillRect(bodyX + bodyW / 2 - p + Math.sin(tendrilPhase) * 3 * p, bodyY + 2 * p + i * 2 * p, 2 * p, p);
    }
  } else if (style === 'shirt_godlike_chaos') {
    // Chaos robes with chaotic energy
    const chaosRobePulse = Math.sin(time * 0.006) * 0.4 + 0.6;
    const chaosRobeSwirl = time * 0.005;
    
    // Base chaos robes
    ctx.fillStyle = `rgba(139, 0, 0, ${chaosRobePulse})`;
    ctx.fillRect(bodyX - 2 * p, bodyY, bodyW + 4 * p, bodyH);
    ctx.fillRect(bodyX - 4 * p, bodyY + 2 * p, 4 * p, 5 * p);
    ctx.fillRect(bodyX + bodyW, bodyY + 2 * p, 4 * p, 5 * p);
    ctx.fillRect(bodyX - p, bodyY + bodyH - p, bodyW + 2 * p, 3 * p);
    
    // Chaotic energy swirls
    for (let i = 0; i < 6; i++) {
      const swirlPhase = chaosRobeSwirl + i * 1;
      const swirlX = bodyX + (i % 3) * bodyW / 3 + Math.sin(swirlPhase) * 3 * p;
      const swirlY = bodyY + Math.floor(i / 3) * bodyH / 2 + Math.cos(swirlPhase * 1.3) * 2 * p;
      const swirlColor = i % 2 === 0 ? '#8b0000' : '#4b0082';
      ctx.fillStyle = `rgba(${swirlColor === '#8b0000' ? '139, 0, 0' : '75, 0, 130'}, ${chaosRobePulse})`;
      ctx.beginPath();
      ctx.arc(swirlX, swirlY, 2.5 * p, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Distortion effects
    const distortion1 = Math.sin(time * 0.004) * 2 * p;
    const distortion2 = Math.sin(time * 0.005 + 1) * 2 * p;
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(bodyX + bodyW / 2 - 2 * p + distortion1, bodyY + 3 * p, 4 * p, 3 * p);
    ctx.fillStyle = '#9400d3';
    ctx.fillRect(bodyX + bodyW / 2 - 2 * p + distortion2, bodyY + 6 * p, 4 * p, 3 * p);
  } else if (style === 'shirt_godlike_abyss') {
    // Abyssal armor with deep void energy
    const abyssArmorPulse = Math.sin(time * 0.004) * 0.3 + 0.7;
    const abyssArmorDepth = time * 0.003;
    
    // Base abyssal armor
    ctx.fillStyle = `rgba(0, 0, 0, ${abyssArmorPulse})`;
    ctx.fillRect(bodyX - 3 * p, bodyY, bodyW + 6 * p, bodyH);
    ctx.fillRect(bodyX - 5 * p, bodyY + 2 * p, 5 * p, 5 * p);
    ctx.fillRect(bodyX + bodyW, bodyY + 2 * p, 5 * p, 5 * p);
    
    // Deep abyssal portal layers
    for (let i = 0; i < 3; i++) {
      const ringPhase = abyssArmorDepth + i * 0.5;
      const ringSize = 3 * p + i * 2 * p + Math.sin(ringPhase) * p;
      ctx.strokeStyle = `rgba(75, 0, 130, ${abyssArmorPulse * (1 - i * 0.25)})`;
      ctx.lineWidth = 2 * p;
      ctx.beginPath();
      ctx.arc(bodyX + bodyW / 2, bodyY + bodyH / 2, ringSize, 0, Math.PI * 2);
      ctx.stroke();
    }
    
    // Abyssal energy tendrils extending outward
    for (let i = 0; i < 4; i++) {
      const tendrilPhase = abyssArmorDepth + i * 1.5;
      const tendrilX = bodyX + bodyW / 2 + Math.sin(tendrilPhase) * 5 * p;
      const tendrilY = bodyY + bodyH / 2 + Math.cos(tendrilPhase * 0.7) * 4 * p;
      ctx.fillStyle = `rgba(128, 0, 128, ${abyssArmorPulse * 0.8})`;
      ctx.beginPath();
      ctx.arc(tendrilX, tendrilY, 2.5 * p, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Deep void center
    const voidCenter = Math.sin(time * 0.002) * p;
    ctx.fillStyle = '#000000';
    ctx.fillRect(bodyX + bodyW / 2 - 3 * p, bodyY + bodyH / 2 - voidCenter, 6 * p, 3 * p);
  }
  
  // Clear glow after drawing shirt
  clearGlow(ctx);
}

function getLegStyle(outfit: string[]): string {
  for (const item of outfit) {
    if (item.startsWith('legs_')) {
      return item;
    }
  }
  return 'default';
}

function getLegColor(outfit: string[]): string {
  for (const item of outfit) {
    switch (item) {
      case 'legs_jeans_blue': return '#3b5998';
      case 'legs_jeans_black': return '#1a1a1a';
      case 'legs_shorts': return '#6b8e23';
      case 'legs_sweatpants': return '#696969';
      case 'legs_chef': return '#ffffff';
      case 'legs_suit': return '#2c2c2c';
      case 'legs_lab': return '#f5f5f5';
      case 'legs_wizard': return '#6b4c9a';
      case 'legs_knight': return '#7f8c8d';
      case 'legs_samurai': return '#8b0000';
      case 'legs_ninja': return '#1a1a1a';
      case 'legs_pirate': return '#4a3728';
      case 'legs_viking': return '#8b6914';
      case 'legs_cowboy': return '#8b4513';
      case 'legs_astronaut': return '#ecf0f1';
      case 'legs_punk': return '#1a1a1a';
      case 'legs_neon': return '#1a1a2e';
      case 'legs_princess': return '#ff69b4';
      case 'legs_angel': return '#fff8dc';
      case 'legs_dragon': return '#8b0000';
      case 'legs_demon': return '#2c0000';
      case 'legs_phoenix': return '#ff4500';
      case 'legs_gold': return '#daa520';
      // Legendary legs
      case 'legs_phoenix_legendary': return '#ff4500';
      case 'legs_void': return '#2d0a4e';
      case 'legs_celestial': return '#e8e8ff';
      case 'legs_galaxy': return '#1a0a3e';
      case 'legs_rainbow': return '#ff6b6b';
      // Godlike legs
      case 'legs_godlike_void': return '#2d0a4e';
      case 'legs_godlike_chaos': return '#4a0000';
      case 'legs_godlike_abyss': return '#000000';
    }
  }
  return PLAYER_COLORS.pants; // Default blue pants
}

function drawLegs(ctx: CanvasRenderingContext2D, player: PlayerWithChat, bodyX: number, bodyW: number, legY: number, legW: number, legH: number, p: number, leftOffset: number, rightOffset: number, time: number = Date.now()): void {
  const legStyle = getLegStyle(player.sprite.outfit);
  const legColor = getLegColor(player.sprite.outfit);
  
  // Apply rarity glow for leg cosmetics
  if (legStyle !== 'default') {
    applyRarityGlow(ctx, legStyle);
  }
  
  // Left leg outline
  ctx.fillStyle = PLAYER_COLORS.outline;
  ctx.fillRect(bodyX + leftOffset, legY, legW + p, legH + p);
  
  // Left leg fill
  ctx.fillStyle = legColor;
  ctx.fillRect(bodyX + p + leftOffset, legY, legW - p, legH);
  
  // Right leg outline
  ctx.fillStyle = PLAYER_COLORS.outline;
  ctx.fillRect(bodyX + bodyW - legW - p + rightOffset, legY, legW + p, legH + p);
  
  // Right leg fill
  ctx.fillStyle = legColor;
  ctx.fillRect(bodyX + bodyW - legW + rightOffset, legY, legW - p, legH);
  
  // Add style-specific details
  switch (legStyle) {
    case 'legs_shorts':
      // Shorts are shorter - add skin below
      ctx.fillStyle = '#ffd5b5';
      ctx.fillRect(bodyX + p + leftOffset, legY + legH - 2 * p, legW - p, 2 * p);
      ctx.fillRect(bodyX + bodyW - legW + rightOffset, legY + legH - 2 * p, legW - p, 2 * p);
      break;
      
    case 'legs_punk':
      // Ripped jeans effect
      ctx.fillStyle = '#ffd5b5';
      ctx.fillRect(bodyX + 2 * p + leftOffset, legY + 2 * p, 2 * p, p);
      ctx.fillRect(bodyX + bodyW - legW + p + rightOffset, legY + 3 * p, 2 * p, p);
      break;
      
    case 'legs_neon':
      // Neon stripes
      ctx.fillStyle = '#00ffff';
      ctx.fillRect(bodyX + p + leftOffset, legY, p, legH);
      ctx.fillRect(bodyX + bodyW - legW + rightOffset, legY, p, legH);
      ctx.fillStyle = '#ff00ff';
      ctx.fillRect(bodyX + legW - p + leftOffset, legY, p, legH);
      ctx.fillRect(bodyX + bodyW - p - p + rightOffset, legY, p, legH);
      break;
      
    case 'legs_knight':
    case 'legs_samurai':
      // Metal shine
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(bodyX + 2 * p + leftOffset, legY + p, p, legH - 2 * p);
      ctx.fillRect(bodyX + bodyW - legW + p + rightOffset, legY + p, p, legH - 2 * p);
      break;
      
    case 'legs_wizard':
    case 'legs_angel':
      // Flowing robe effect
      ctx.fillRect(bodyX - p + leftOffset, legY + legH - 2 * p, legW + 2 * p, 2 * p);
      ctx.fillRect(bodyX + bodyW - legW - p + rightOffset, legY + legH - 2 * p, legW + 2 * p, 2 * p);
      break;
      
    case 'legs_princess':
      // Princess skirt flare
      ctx.fillStyle = '#ff1493';
      ctx.fillRect(bodyX - 2 * p + leftOffset, legY, legW + 4 * p, 3 * p);
      ctx.fillRect(bodyX + bodyW - legW - 2 * p + rightOffset, legY, legW + 4 * p, 3 * p);
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(bodyX + p + leftOffset, legY + p, p, p);
      ctx.fillRect(bodyX + bodyW - legW + p + rightOffset, legY + p, p, p);
      break;
      
    case 'legs_dragon':
      // Dragon scale pattern
      ctx.fillStyle = '#ff4500';
      ctx.fillRect(bodyX + 2 * p + leftOffset, legY + p, p, p);
      ctx.fillRect(bodyX + 2 * p + leftOffset, legY + 3 * p, p, p);
      ctx.fillRect(bodyX + bodyW - legW + p + rightOffset, legY + 2 * p, p, p);
      ctx.fillRect(bodyX + bodyW - legW + p + rightOffset, legY + 4 * p, p, p);
      break;
      
    case 'legs_demon':
      // Demonic glow
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(bodyX + p + leftOffset, legY + legH - p, legW - p, p);
      ctx.fillRect(bodyX + bodyW - legW + rightOffset, legY + legH - p, legW - p, p);
      break;
      
    case 'legs_phoenix':
      // Fire effect
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(bodyX + 2 * p + leftOffset, legY + legH - 2 * p, p, 2 * p);
      ctx.fillRect(bodyX + bodyW - legW + 2 * p + rightOffset, legY + legH - 2 * p, p, 2 * p);
      break;
      
    case 'legs_gold':
      // Gentle animated golden shimmer
      const goldShimmer = Math.sin(Date.now() * 0.001) * 0.15 + 0.85; // Slow, subtle pulse
      ctx.fillStyle = `rgba(255, 248, 220, ${goldShimmer})`;
      ctx.fillRect(bodyX + 2 * p + leftOffset, legY + p, p, legH - 2 * p);
      ctx.fillRect(bodyX + bodyW - legW + p + rightOffset, legY + p, p, legH - 2 * p);
      // Animated darker gold accents
      ctx.fillStyle = '#b8860b';
      ctx.fillRect(bodyX + p + leftOffset, legY, p, p);
      ctx.fillRect(bodyX + bodyW - legW + rightOffset, legY, p, p);
      // Add gentle sparkle highlight that moves slowly
      const sparklePos = ((Date.now() * 0.0005) % 1) * (legH - 2 * p); // Much slower movement
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'; // Subtler sparkle
      ctx.fillRect(bodyX + 2 * p + leftOffset, legY + p + sparklePos, p, p);
      ctx.fillRect(bodyX + bodyW - legW + p + rightOffset, legY + p + sparklePos, p, p);
      break;
      
    case 'legs_astronaut':
      // Space suit details
      ctx.fillStyle = '#3498db';
      ctx.fillRect(bodyX + p + leftOffset, legY + 2 * p, 2 * p, 2 * p);
      ctx.fillRect(bodyX + bodyW - legW + rightOffset, legY + 2 * p, 2 * p, 2 * p);
      break;
      
    case 'legs_chef':
    case 'legs_lab':
      // White pants with stripe
      ctx.fillStyle = '#e0e0e0';
      ctx.fillRect(bodyX + p + leftOffset, legY + legH - p, legW - p, p);
      ctx.fillRect(bodyX + bodyW - legW + rightOffset, legY + legH - p, legW - p, p);
      break;
      
    case 'legs_pirate':
      // Pirate belt buckle at top
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(bodyX + 2 * p + leftOffset, legY, p, p);
      ctx.fillRect(bodyX + bodyW - legW + p + rightOffset, legY, p, p);
      break;
      
    // === LEGENDARY LEGS (with animations) ===
    case 'legs_phoenix_legendary':
      // Animated flame licks at bottom
      const phoenixFlicker = Math.sin(time * 0.006);
      const phoenixGlow = Math.sin(time * 0.004) * 0.3 + 0.7;
      
      // Flame pattern
      ctx.fillStyle = `rgba(255, 215, 0, ${phoenixGlow})`;
      ctx.fillRect(bodyX + 2 * p + leftOffset, legY + p, p, p);
      ctx.fillRect(bodyX + bodyW - legW + p + rightOffset, legY + p, p, p);
      
      // Flickering fire at bottom
      ctx.fillStyle = phoenixFlicker > 0 ? '#ffff00' : '#ffd700';
      ctx.fillRect(bodyX + p + leftOffset, legY + legH - 2 * p, legW - p, 2 * p);
      ctx.fillRect(bodyX + bodyW - legW + rightOffset, legY + legH - 2 * p, legW - p, 2 * p);
      
      // Rising embers
      const emberY = ((time * 0.003) % legH);
      ctx.fillStyle = 'rgba(255, 100, 0, 0.8)';
      ctx.fillRect(bodyX + 2 * p + leftOffset, legY + legH - emberY, p, p);
      break;
      
    case 'legs_void':
      // Swirling void energy
      const voidSwirl = time * 0.002;
      const voidAlpha = Math.sin(time * 0.003) * 0.2 + 0.6;
      
      // Purple energy bands
      ctx.fillStyle = `rgba(148, 0, 211, ${voidAlpha})`;
      const band1Y = (Math.sin(voidSwirl) + 1) * 0.5 * (legH - 2 * p);
      const band2Y = (Math.sin(voidSwirl + 1) + 1) * 0.5 * (legH - 2 * p);
      ctx.fillRect(bodyX + p + leftOffset, legY + band1Y, legW - p, p);
      ctx.fillRect(bodyX + bodyW - legW + rightOffset, legY + band2Y, legW - p, p);
      
      // Dark tendrils
      ctx.fillStyle = `rgba(75, 0, 130, ${voidAlpha + 0.2})`;
      ctx.fillRect(bodyX + 2 * p + leftOffset, legY + 2 * p, p, 2 * p);
      ctx.fillRect(bodyX + bodyW - legW + p + rightOffset, legY + 3 * p, p, 2 * p);
      break;
      
    case 'legs_celestial':
      // Twinkling stars
      const star1Alpha = Math.sin(time * 0.005) * 0.5 + 0.5;
      const star2Alpha = Math.sin(time * 0.004 + 1) * 0.5 + 0.5;
      const star3Alpha = Math.sin(time * 0.006 + 2) * 0.5 + 0.5;
      
      ctx.fillStyle = `rgba(255, 255, 200, ${star1Alpha})`;
      ctx.fillRect(bodyX + 2 * p + leftOffset, legY + p, p, p);
      ctx.fillStyle = `rgba(255, 255, 200, ${star2Alpha})`;
      ctx.fillRect(bodyX + bodyW - legW + p + rightOffset, legY + 3 * p, p, p);
      ctx.fillStyle = `rgba(255, 255, 200, ${star3Alpha})`;
      ctx.fillRect(bodyX + p + leftOffset, legY + 4 * p, p, p);
      
      // Soft glow
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.fillRect(bodyX + p + leftOffset, legY, legW - 2 * p, legH);
      ctx.fillRect(bodyX + bodyW - legW + rightOffset, legY, legW - 2 * p, legH);
      break;
      
    case 'legs_galaxy':
      // Swirling galaxy colors
      const galaxyPhase = time * 0.001;
      const bluePulse = Math.sin(galaxyPhase) * 0.3 + 0.6;
      const purplePulse = Math.sin(galaxyPhase + 1) * 0.3 + 0.6;
      
      // Color bands
      ctx.fillStyle = `rgba(65, 105, 225, ${bluePulse})`;
      ctx.fillRect(bodyX + p + leftOffset, legY + p, legW - 2 * p, 2 * p);
      ctx.fillRect(bodyX + bodyW - legW + rightOffset, legY + 3 * p, legW - 2 * p, 2 * p);
      
      ctx.fillStyle = `rgba(148, 0, 211, ${purplePulse})`;
      ctx.fillRect(bodyX + p + leftOffset, legY + 4 * p, legW - 2 * p, p);
      ctx.fillRect(bodyX + bodyW - legW + rightOffset, legY + p, legW - 2 * p, p);
      
      // Twinkling stars
      if (Math.sin(time * 0.008) > 0.5) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(bodyX + 2 * p + leftOffset, legY + 2 * p, p, p);
      }
      if (Math.sin(time * 0.007 + 1) > 0.5) {
        ctx.fillStyle = '#00ced1';
        ctx.fillRect(bodyX + bodyW - legW + p + rightOffset, legY + 4 * p, p, p);
      }
      break;
      
    case 'legs_rainbow':
      // Animated rainbow stripes that shift
      const rainbowShift = (time * 0.002) % 7;
      const rainbowColors = ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#4b0082', '#8b00ff'];
      
      // Draw shifting bands on left leg
      for (let i = 0; i < 3; i++) {
        const colorIdx = Math.floor((i + rainbowShift) % 7);
        ctx.fillStyle = rainbowColors[colorIdx];
        ctx.fillRect(bodyX + p + leftOffset, legY + i * 2 * p, legW - p, p);
      }
      
      // Draw shifting bands on right leg (offset)
      for (let i = 0; i < 3; i++) {
        const colorIdx = Math.floor((i + rainbowShift + 3) % 7);
        ctx.fillStyle = rainbowColors[colorIdx];
        ctx.fillRect(bodyX + bodyW - legW + rightOffset, legY + i * 2 * p, legW - p, p);
      }
      
      // Shimmer effect
      const legShimmerX = Math.sin(time * 0.003) * (legW / 2 - p);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillRect(bodyX + legW / 2 + legShimmerX + leftOffset, legY, p, legH);
      break;
      
    // === GODLIKE LEGS (void/chaos themed with intense animations) ===
    case 'legs_godlike_void':
      // Void leggings with intense void energy
      const voidLegPulse = Math.sin(time * 0.005) * 0.3 + 0.7;
      const voidLegSwirl = time * 0.004;
      
      // Swirling void energy bands
      for (let i = 0; i < 3; i++) {
        const bandPhase = voidLegSwirl + i * 1.5;
        const bandY = (Math.sin(bandPhase) + 1) * 0.5 * (legH - 2 * p);
        ctx.fillStyle = `rgba(75, 0, 130, ${voidLegPulse})`;
        ctx.fillRect(bodyX + p + leftOffset, legY + bandY, legW - p, 2 * p);
        ctx.fillRect(bodyX + bodyW - legW + rightOffset, legY + bandY, legW - p, 2 * p);
      }
      
      // Void tendrils
      for (let i = 0; i < 4; i++) {
        const tendrilPhase = voidLegSwirl + i * 1.2;
        ctx.fillStyle = `rgba(148, 0, 211, ${voidLegPulse * 0.8})`;
        ctx.fillRect(bodyX + 2 * p + leftOffset, legY + 2 * p + i * p, p, 2 * p);
        ctx.fillRect(bodyX + bodyW - legW + p + rightOffset, legY + 2 * p + i * p, p, 2 * p);
      }
      break;
      
    case 'legs_godlike_chaos':
      // Chaos greaves with chaotic energy
      const chaosLegPulse = Math.sin(time * 0.006) * 0.4 + 0.6;
      const chaosLegSwirl = time * 0.005;
      
      // Chaotic energy swirls
      for (let i = 0; i < 5; i++) {
        const swirlPhase = chaosLegSwirl + i * 1;
        const swirlY = (Math.sin(swirlPhase) + 1) * 0.5 * legH;
        const swirlColor = i % 2 === 0 ? '#8b0000' : '#4b0082';
        ctx.fillStyle = `rgba(${swirlColor === '#8b0000' ? '139, 0, 0' : '75, 0, 130'}, ${chaosLegPulse})`;
        ctx.fillRect(bodyX + p + leftOffset, legY + swirlY, legW - p, p);
        ctx.fillRect(bodyX + bodyW - legW + rightOffset, legY + swirlY, legW - p, p);
      }
      
      // Distortion effects
      const legDistortion1 = Math.sin(time * 0.004) * p;
      const legDistortion2 = Math.sin(time * 0.005 + 1) * p;
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(bodyX + 2 * p + leftOffset + legDistortion1, legY + 3 * p, 2 * p, 2 * p);
      ctx.fillStyle = '#9400d3';
      ctx.fillRect(bodyX + bodyW - legW + p + rightOffset + legDistortion2, legY + 3 * p, 2 * p, 2 * p);
      break;
      
    case 'legs_godlike_abyss':
      // Abyssal pants with deep void energy
      const abyssLegPulse = Math.sin(time * 0.004) * 0.3 + 0.7;
      const abyssLegDepth = time * 0.003;
      
      // Deep abyssal portal layers on legs
      for (let i = 0; i < 2; i++) {
        const ringPhase = abyssLegDepth + i * 0.5;
        const ringSize = 2 * p + i * p + Math.sin(ringPhase) * p;
        ctx.strokeStyle = `rgba(75, 0, 130, ${abyssLegPulse * (1 - i * 0.3)})`;
        ctx.lineWidth = 2 * p;
        ctx.beginPath();
        ctx.arc(bodyX + legW / 2 + leftOffset, legY + legH / 2, ringSize, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(bodyX + bodyW - legW / 2 + rightOffset, legY + legH / 2, ringSize, 0, Math.PI * 2);
        ctx.stroke();
      }
      
      // Abyssal energy tendrils
      for (let i = 0; i < 3; i++) {
        const tendrilPhase = abyssLegDepth + i * 1.5;
        ctx.fillStyle = `rgba(128, 0, 128, ${abyssLegPulse * 0.8})`;
        ctx.fillRect(bodyX + 2 * p + leftOffset, legY + 2 * p + i * 2 * p, 2 * p, p);
        ctx.fillRect(bodyX + bodyW - legW + p + rightOffset, legY + 2 * p + i * 2 * p, 2 * p, p);
      }
      break;
  }
  
  // Clear glow after drawing legs
  clearGlow(ctx);
}

function drawHat(ctx: CanvasRenderingContext2D, player: PlayerWithChat, headX: number, headY: number, headW: number, p: number, time: number = Date.now()): void {
  const hatItem = player.sprite.outfit.find(item => item.startsWith('hat_'));
  if (!hatItem) return;
  
  // Apply rarity glow
  applyRarityGlow(ctx, hatItem);
  
  switch (hatItem) {
    case 'hat_cowboy':
      ctx.fillStyle = '#8b4513';
      ctx.fillRect(headX - 3 * p, headY - 2 * p, headW + 6 * p, 3 * p);
      ctx.fillRect(headX + p, headY - 6 * p, headW - 2 * p, 4 * p);
      break;
      
    case 'hat_wizard':
      ctx.fillStyle = '#9b59b6';
      ctx.fillRect(headX - p, headY - 2 * p, headW + 2 * p, 3 * p);
      ctx.beginPath();
      ctx.moveTo(headX + headW / 2, headY - 14 * p);
      ctx.lineTo(headX - p, headY - 2 * p);
      ctx.lineTo(headX + headW + p, headY - 2 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f1c40f';
      ctx.beginPath();
      ctx.arc(headX + headW / 2, headY - 8 * p, 2 * p, 0, Math.PI * 2);
      ctx.fill();
      break;
      
    case 'hat_crown':
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(headX, headY - 3 * p, headW, 4 * p);
      ctx.fillRect(headX + p, headY - 6 * p, 2 * p, 3 * p);
      ctx.fillRect(headX + headW / 2 - p, headY - 7 * p, 2 * p, 4 * p);
      ctx.fillRect(headX + headW - 3 * p, headY - 6 * p, 2 * p, 3 * p);
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(headX + 2 * p, headY - 2 * p, 2 * p, 2 * p);
      ctx.fillStyle = '#3498db';
      ctx.fillRect(headX + headW - 4 * p, headY - 2 * p, 2 * p, 2 * p);
      break;
      
    case 'hat_beanie':
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(headX - p, headY - 4 * p, headW + 2 * p, 5 * p);
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(headX, headY - 4 * p, headW, p);
      break;
      
    case 'hat_cap':
      ctx.fillStyle = '#3498db';
      ctx.fillRect(headX - p, headY - 2 * p, headW + 2 * p, 3 * p);
      ctx.fillRect(headX - 4 * p, headY - p, 4 * p, 2 * p);
      break;
      
    case 'hat_beret':
      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.ellipse(headX + headW / 2, headY - 2 * p, headW / 2 + 2 * p, 3 * p, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
      
    case 'hat_halo':
      ctx.fillStyle = '#ffd700';
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2 * p;
      ctx.beginPath();
      ctx.ellipse(headX + headW / 2, headY - 8 * p, headW / 2 + p, 2 * p, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
      
    case 'hat_horns':
      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.moveTo(headX - p, headY);
      ctx.lineTo(headX - 4 * p, headY - 8 * p);
      ctx.lineTo(headX + 2 * p, headY - 2 * p);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(headX + headW + p, headY);
      ctx.lineTo(headX + headW + 4 * p, headY - 8 * p);
      ctx.lineTo(headX + headW - 2 * p, headY - 2 * p);
      ctx.closePath();
      ctx.fill();
      break;
      
    case 'hat_tiara':
      ctx.fillStyle = '#c0c0c0';
      ctx.fillRect(headX, headY - 2 * p, headW, 3 * p);
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(headX + headW / 2 - 2 * p, headY - 5 * p, 4 * p, 3 * p);
      ctx.fillStyle = '#ff69b4';
      ctx.fillRect(headX + headW / 2 - p, headY - 4 * p, 2 * p, 2 * p);
      break;
      
    case 'hat_chef':
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(headX - p, headY - 2 * p, headW + 2 * p, 3 * p);
      ctx.beginPath();
      ctx.ellipse(headX + headW / 2, headY - 6 * p, headW / 2 + p, 5 * p, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
      
    case 'hat_tophat':
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(headX - 2 * p, headY - 2 * p, headW + 4 * p, 3 * p);
      ctx.fillRect(headX, headY - 10 * p, headW, 8 * p);
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(headX, headY - 4 * p, headW, 2 * p);
      break;
      
    case 'hat_hardhat':
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(headX - 2 * p, headY - 2 * p, headW + 4 * p, 3 * p);
      ctx.beginPath();
      ctx.arc(headX + headW / 2, headY - 2 * p, headW / 2 + p, Math.PI, 0);
      ctx.fill();
      break;
      
    case 'hat_pirate':
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(headX - 2 * p, headY - 2 * p, headW + 4 * p, 3 * p);
      ctx.beginPath();
      ctx.moveTo(headX - 3 * p, headY - 2 * p);
      ctx.lineTo(headX + headW / 2, headY - 8 * p);
      ctx.lineTo(headX + headW + 3 * p, headY - 2 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(headX + headW / 2 - 2 * p, headY - 5 * p, 4 * p, 3 * p);
      break;
      
    case 'hat_viking':
      ctx.fillStyle = '#8b4513';
      ctx.fillRect(headX - p, headY - 4 * p, headW + 2 * p, 5 * p);
      ctx.fillStyle = '#ecf0f1';
      ctx.beginPath();
      ctx.moveTo(headX - 4 * p, headY - 2 * p);
      ctx.lineTo(headX - 6 * p, headY - 10 * p);
      ctx.lineTo(headX - p, headY - 4 * p);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(headX + headW + 4 * p, headY - 2 * p);
      ctx.lineTo(headX + headW + 6 * p, headY - 10 * p);
      ctx.lineTo(headX + headW + p, headY - 4 * p);
      ctx.closePath();
      ctx.fill();
      break;
      
    case 'hat_ninja':
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(headX - p, headY - p, headW + 2 * p, 4 * p);
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(headX + headW - 2 * p, headY, 6 * p, 2 * p);
      break;
      
    case 'hat_knight':
      ctx.fillStyle = '#7f8c8d';
      ctx.fillRect(headX - p, headY - 4 * p, headW + 2 * p, 5 * p);
      ctx.fillRect(headX + p, headY - 6 * p, headW - 2 * p, 2 * p);
      ctx.fillStyle = '#bdc3c7';
      ctx.fillRect(headX + p, headY + p, headW - 2 * p, 2 * p);
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(headX + headW / 2 - p, headY - 8 * p, 2 * p, 4 * p);
      break;
      
    case 'hat_astronaut':
      ctx.fillStyle = '#ecf0f1';
      ctx.beginPath();
      ctx.arc(headX + headW / 2, headY + 2 * p, headW / 2 + 3 * p, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3498db';
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(headX + headW / 2, headY + 2 * p, headW / 2 + p, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
      
    case 'hat_cat':
      ctx.fillStyle = '#e91e63';
      ctx.beginPath();
      ctx.moveTo(headX - p, headY);
      ctx.lineTo(headX - p, headY - 6 * p);
      ctx.lineTo(headX + 3 * p, headY - 2 * p);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(headX + headW + p, headY);
      ctx.lineTo(headX + headW + p, headY - 6 * p);
      ctx.lineTo(headX + headW - 3 * p, headY - 2 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ff69b4';
      ctx.fillRect(headX, headY - 4 * p, 2 * p, 2 * p);
      ctx.fillRect(headX + headW - 2 * p, headY - 4 * p, 2 * p, 2 * p);
      break;
      
    case 'hat_bunny':
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(headX + p, headY - 12 * p, 3 * p, 10 * p);
      ctx.fillRect(headX + headW - 4 * p, headY - 12 * p, 3 * p, 10 * p);
      ctx.fillStyle = '#ffb6c1';
      ctx.fillRect(headX + 2 * p, headY - 10 * p, p, 6 * p);
      ctx.fillRect(headX + headW - 3 * p, headY - 10 * p, p, 6 * p);
      break;
      
    case 'hat_mohawk':
      ctx.fillStyle = '#2ecc71';
      for (let i = 0; i < 5; i++) {
        ctx.fillRect(headX + headW / 2 - p + i * p - 2 * p, headY - 8 * p + Math.abs(i - 2) * 2 * p, 2 * p, 8 * p - Math.abs(i - 2) * 2 * p);
      }
      break;
      
    case 'hat_afro':
      ctx.fillStyle = '#2c3e50';
      ctx.beginPath();
      ctx.arc(headX + headW / 2, headY, headW / 2 + 4 * p, 0, Math.PI * 2);
      ctx.fill();
      break;
      
    case 'hat_santa':
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(headX - p, headY - 2 * p, headW + 2 * p, 3 * p);
      ctx.beginPath();
      ctx.moveTo(headX - p, headY - 2 * p);
      ctx.lineTo(headX + headW + 4 * p, headY - 8 * p);
      ctx.lineTo(headX + headW + p, headY - 2 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(headX - 2 * p, headY - p, headW + 4 * p, 2 * p);
      ctx.beginPath();
      ctx.arc(headX + headW + 4 * p, headY - 8 * p, 2 * p, 0, Math.PI * 2);
      ctx.fill();
      break;
      
    case 'hat_party':
      ctx.fillStyle = '#9b59b6';
      ctx.beginPath();
      ctx.moveTo(headX + headW / 2, headY - 10 * p);
      ctx.lineTo(headX - p, headY - p);
      ctx.lineTo(headX + headW + p, headY - p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(headX + 2 * p, headY - 4 * p, 2 * p, 2 * p);
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(headX + headW - 3 * p, headY - 6 * p, 2 * p, 2 * p);
      break;
      
    case 'hat_dragon':
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(headX - p, headY - 4 * p, headW + 2 * p, 5 * p);
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath();
      ctx.moveTo(headX - 2 * p, headY - 4 * p);
      ctx.lineTo(headX - 4 * p, headY - 10 * p);
      ctx.lineTo(headX + 2 * p, headY - 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(headX + headW / 2, headY - 4 * p);
      ctx.lineTo(headX + headW / 2, headY - 12 * p);
      ctx.lineTo(headX + headW / 2 + 3 * p, headY - 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(headX + headW + 2 * p, headY - 4 * p);
      ctx.lineTo(headX + headW + 4 * p, headY - 10 * p);
      ctx.lineTo(headX + headW - 2 * p, headY - 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(headX + 2 * p, headY - 2 * p, 2 * p, 2 * p);
      ctx.fillRect(headX + headW - 4 * p, headY - 2 * p, 2 * p, 2 * p);
      break;
      
    case 'hat_phoenix':
      ctx.fillStyle = '#e67e22';
      ctx.fillRect(headX - p, headY - 3 * p, headW + 2 * p, 4 * p);
      ctx.fillStyle = '#f39c12';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(headX + 2 * p + i * 4 * p, headY - 3 * p);
        ctx.lineTo(headX + 4 * p + i * 4 * p, headY - 12 * p + i * 2 * p);
        ctx.lineTo(headX + 6 * p + i * 4 * p, headY - 3 * p);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(headX + headW / 2 - p, headY - 8 * p, 2 * p, 2 * p);
      break;
      
    case 'hat_demon':
      ctx.fillStyle = '#4a0000';
      ctx.fillRect(headX, headY - 2 * p, headW, 3 * p);
      ctx.fillRect(headX + p, headY - 5 * p, 2 * p, 3 * p);
      ctx.fillRect(headX + headW / 2 - p, headY - 7 * p, 2 * p, 5 * p);
      ctx.fillRect(headX + headW - 3 * p, headY - 5 * p, 2 * p, 3 * p);
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(headX + headW / 2 - p, headY - 4 * p, 2 * p, p);
      break;
      
    // === LEGENDARY HATS (with animations) ===
    case 'hat_golden':
      // Animated golden crown
      const goldenShimmer = Math.sin(time * 0.003) * 0.3 + 0.7;
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(headX, headY - 2 * p, headW, 3 * p);
      ctx.fillRect(headX + p, headY - 5 * p, 2 * p, 3 * p);
      ctx.fillRect(headX + headW / 2 - p, headY - 8 * p, 2 * p, 6 * p);
      ctx.fillRect(headX + headW - 3 * p, headY - 5 * p, 2 * p, 3 * p);
      
      // Animated jewels that twinkle
      const jewel1 = Math.sin(time * 0.005) * 0.4 + 0.6;
      const jewel2 = Math.sin(time * 0.004 + 1) * 0.4 + 0.6;
      const jewel3 = Math.sin(time * 0.006 + 2) * 0.4 + 0.6;
      ctx.fillStyle = `rgba(255, 248, 220, ${jewel1})`;
      ctx.fillRect(headX + 2 * p, headY - p, p, p);
      ctx.fillStyle = `rgba(255, 248, 220, ${jewel2})`;
      ctx.fillRect(headX + headW - 3 * p, headY - p, p, p);
      ctx.fillStyle = `rgba(255, 248, 220, ${jewel3})`;
      ctx.fillRect(headX + headW / 2 - p, headY - 5 * p, 2 * p, p);
      
      // Moving shimmer
      const shimmerPos = ((time * 0.002) % headW);
      ctx.fillStyle = `rgba(255, 255, 255, ${goldenShimmer * 0.5})`;
      ctx.fillRect(headX + shimmerPos, headY - p, 2 * p, p);
      break;
      
    case 'hat_phoenix_legendary':
      // Animated fire feathers
      ctx.fillStyle = '#ff4500';
      ctx.fillRect(headX - p, headY - 3 * p, headW + 2 * p, 4 * p);
      
      // Flickering flames
      for (let i = 0; i < 5; i++) {
        const flameFlicker = Math.sin(time * 0.008 + i * 0.5) * 2;
        const h = 10 - Math.abs(i - 2) * 2 + flameFlicker;
        const flameColor = Math.sin(time * 0.006 + i) > 0 ? '#ffd700' : '#ffff00';
        ctx.fillStyle = flameColor;
        ctx.beginPath();
        ctx.moveTo(headX + i * 3 * p, headY - 3 * p);
        ctx.lineTo(headX + i * 3 * p + p, headY - h * p);
        ctx.lineTo(headX + i * 3 * p + 2 * p, headY - 3 * p);
        ctx.closePath();
        ctx.fill();
      }
      
      // Glowing ember
      const emberGlow = Math.sin(time * 0.004) * 0.3 + 0.7;
      ctx.fillStyle = `rgba(255, 102, 0, ${emberGlow})`;
      ctx.fillRect(headX + headW / 2 - p, headY - p, 2 * p, p);
      break;
      
    case 'hat_void':
      // Pulsing void darkness
      const voidPulse = Math.sin(time * 0.003) * 0.2 + 0.8;
      ctx.fillStyle = `rgba(26, 10, 46, ${voidPulse})`;
      ctx.fillRect(headX - p, headY - 4 * p, headW + 2 * p, 5 * p);
      
      ctx.fillStyle = '#4b0082';
      ctx.fillRect(headX, headY - 6 * p, headW, 2 * p);
      
      // Swirling void orbs
      const voidOrb1 = Math.sin(time * 0.004) * 0.5 + 0.5;
      const voidOrb2 = Math.sin(time * 0.005 + 1) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(148, 0, 211, ${voidOrb1})`;
      ctx.fillRect(headX + 2 * p, headY - p, 2 * p, p);
      ctx.fillStyle = `rgba(148, 0, 211, ${voidOrb2})`;
      ctx.fillRect(headX + headW - 4 * p, headY - p, 2 * p, p);
      
      // Dark energy center
      const darkPulse = Math.sin(time * 0.002) * p * 0.5;
      ctx.fillStyle = '#000000';
      ctx.fillRect(headX + headW / 2 - p, headY - 5 * p - darkPulse, 2 * p, p);
      break;
      
    case 'hat_celestial':
      // Rotating halo
      const haloRotation = time * 0.001;
      const haloGlow = Math.sin(time * 0.003) * 0.2 + 0.7;
      
      ctx.strokeStyle = `rgba(255, 255, 255, ${haloGlow})`;
      ctx.lineWidth = 2 * p;
      ctx.beginPath();
      ctx.ellipse(headX + headW / 2, headY - 8 * p, headW / 2 + 2 * p, 2 * p, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(255, 250, 205, ${haloGlow * 0.5})`;
      ctx.fill();
      
      // Twinkling star on top
      const starTwinkle = Math.sin(time * 0.006) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(255, 250, 205, ${starTwinkle})`;
      ctx.fillRect(headX + headW / 2 - p, headY - 10 * p, 2 * p, p);
      
      // Extra twinkle arms
      if (starTwinkle > 0.7) {
        ctx.fillRect(headX + headW / 2 - 2 * p, headY - 10 * p, p, p);
        ctx.fillRect(headX + headW / 2 + p, headY - 10 * p, p, p);
      }
      break;
      
    case 'hat_galaxy':
      // Swirling galaxy colors
      const galaxySwirl = time * 0.001;
      ctx.fillStyle = '#1a0a3e';
      ctx.fillRect(headX, headY - 2 * p, headW, 3 * p);
      ctx.fillRect(headX + p, headY - 5 * p, 2 * p, 3 * p);
      ctx.fillRect(headX + headW / 2 - p, headY - 8 * p, 2 * p, 6 * p);
      ctx.fillRect(headX + headW - 3 * p, headY - 5 * p, 2 * p, 3 * p);
      
      // Animated blue/purple swirl
      const blueIntensity = Math.sin(galaxySwirl) * 0.3 + 0.7;
      const purpleIntensity = Math.sin(galaxySwirl + Math.PI) * 0.3 + 0.7;
      ctx.fillStyle = `rgba(65, 105, 225, ${blueIntensity})`;
      ctx.fillRect(headX + 2 * p, headY - p, p, p);
      ctx.fillStyle = `rgba(148, 0, 211, ${purpleIntensity})`;
      ctx.fillRect(headX + headW - 3 * p, headY - p, p, p);
      
      // Twinkling stars
      const star1Twinkle = Math.sin(time * 0.008) > 0.3;
      const star2Twinkle = Math.sin(time * 0.007 + 1) > 0.3;
      if (star1Twinkle) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(headX + 3 * p, headY - 4 * p, p, p);
      }
      if (star2Twinkle) {
        ctx.fillStyle = '#00ced1';
        ctx.fillRect(headX + headW - 4 * p, headY - 5 * p, p, p);
      }
      break;
      
    case 'hat_rainbow':
      // Animated shifting rainbow bands
      const rainbowShift = (time * 0.003) % 7;
      const rainbowColors = ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#4b0082', '#8b00ff'];
      
      for (let i = 0; i < 4; i++) {
        const colorIdx = Math.floor((i + rainbowShift) % 7);
        ctx.fillStyle = rainbowColors[colorIdx];
        ctx.fillRect(headX, headY - i * p, headW, p);
      }
      
      // Top sections with shifting colors
      const topColorIdx = Math.floor((4 + rainbowShift) % 7);
      ctx.fillStyle = rainbowColors[topColorIdx];
      ctx.fillRect(headX + p, headY - 5 * p, headW - 2 * p, 2 * p);
      
      const peakColorIdx = Math.floor((6 + rainbowShift) % 7);
      ctx.fillStyle = rainbowColors[peakColorIdx];
      ctx.fillRect(headX + headW / 2 - p, headY - 7 * p, 2 * p, 2 * p);
      
      // Shimmer effect
      const hatShimmerPos = ((time * 0.005) % (headW / p)) * p;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillRect(headX + hatShimmerPos, headY - 6 * p, p, 6 * p);
      break;
      
    // === GODLIKE HATS (void/chaos themed with intense animations) ===
    case 'hat_godlike_void':
      // Intense void energy crown with swirling darkness
      const voidCrownPulse = Math.sin(time * 0.005) * 0.3 + 0.7;
      const voidSwirl = time * 0.004;
      
      // Base crown with pulsing void energy
      ctx.fillStyle = `rgba(0, 0, 0, ${voidCrownPulse})`;
      ctx.fillRect(headX - 2 * p, headY - 3 * p, headW + 4 * p, 4 * p);
      ctx.fillRect(headX + p, headY - 6 * p, 2 * p, 3 * p);
      ctx.fillRect(headX + headW / 2 - 2 * p, headY - 10 * p, 4 * p, 7 * p);
      ctx.fillRect(headX + headW - 3 * p, headY - 6 * p, 2 * p, 3 * p);
      
      // Swirling void tendrils
      for (let i = 0; i < 3; i++) {
        const tendrilPhase = voidSwirl + i * 2;
        const tendrilX = headX + headW / 2 + Math.sin(tendrilPhase) * 3 * p;
        const tendrilY = headY - 8 * p + Math.cos(tendrilPhase) * 2 * p;
        ctx.fillStyle = `rgba(75, 0, 130, ${voidCrownPulse})`;
        ctx.beginPath();
        ctx.arc(tendrilX, tendrilY, 1.5 * p, 0, Math.PI * 2);
        ctx.fill();
      }
      
      // Pulsing void orbs
      const godlikeVoidOrb1 = Math.sin(time * 0.006) * 0.5 + 0.5;
      const godlikeVoidOrb2 = Math.sin(time * 0.007 + 1) * 0.5 + 0.5;
      const godlikeVoidOrb3 = Math.sin(time * 0.008 + 2) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(148, 0, 211, ${godlikeVoidOrb1})`;
      ctx.fillRect(headX + 2 * p, headY - p, 2 * p, p);
      ctx.fillStyle = `rgba(75, 0, 130, ${godlikeVoidOrb2})`;
      ctx.fillRect(headX + headW / 2 - p, headY - 8 * p, 2 * p, p);
      ctx.fillStyle = `rgba(128, 0, 128, ${godlikeVoidOrb3})`;
      ctx.fillRect(headX + headW - 4 * p, headY - p, 2 * p, p);
      
      // Dark energy center with distortion
      const darkDistortion = Math.sin(time * 0.003) * p;
      ctx.fillStyle = '#000000';
      ctx.fillRect(headX + headW / 2 - p - darkDistortion, headY - 6 * p, 2 * p + darkDistortion * 2, p);
      break;
      
    case 'hat_godlike_chaos':
      // Chaos diadem with chaotic energy swirls
      const chaosPulse = Math.sin(time * 0.006) * 0.4 + 0.6;
      const chaosSwirl = time * 0.005;
      
      // Base diadem with chaotic colors
      ctx.fillStyle = `rgba(139, 0, 0, ${chaosPulse})`;
      ctx.fillRect(headX - p, headY - 2 * p, headW + 2 * p, 3 * p);
      ctx.fillStyle = `rgba(75, 0, 130, ${chaosPulse})`;
      ctx.fillRect(headX, headY - 5 * p, headW, 3 * p);
      ctx.fillStyle = `rgba(0, 0, 0, ${chaosPulse})`;
      ctx.fillRect(headX + headW / 2 - 2 * p, headY - 9 * p, 4 * p, 7 * p);
      
      // Chaotic energy swirls
      for (let i = 0; i < 5; i++) {
        const swirlPhase = chaosSwirl + i * 1.2;
        const swirlX = headX + (i + 1) * headW / 6 + Math.sin(swirlPhase) * 2 * p;
        const swirlY = headY - 4 * p + Math.cos(swirlPhase * 1.5) * 2 * p;
        const swirlColor = i % 2 === 0 ? '#8b0000' : '#4b0082';
        ctx.fillStyle = `rgba(${swirlColor === '#8b0000' ? '139, 0, 0' : '75, 0, 130'}, ${chaosPulse})`;
        ctx.beginPath();
        ctx.arc(swirlX, swirlY, 1.5 * p, 0, Math.PI * 2);
        ctx.fill();
      }
      
      // Distortion effects
      const distortion1 = Math.sin(time * 0.004) * p;
      const distortion2 = Math.sin(time * 0.005 + 1) * p;
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(headX + headW / 2 - p + distortion1, headY - 7 * p, p, p);
      ctx.fillStyle = '#9400d3';
      ctx.fillRect(headX + headW / 2 + distortion2, headY - 5 * p, p, p);
      break;
      
    case 'hat_godlike_abyss':
      // Abyssal helm with deep void energy
      const abyssPulse = Math.sin(time * 0.004) * 0.3 + 0.7;
      const abyssDepth = time * 0.003;
      
      // Base helm with deep void
      ctx.fillStyle = `rgba(0, 0, 0, ${abyssPulse})`;
      ctx.fillRect(headX - 2 * p, headY - 4 * p, headW + 4 * p, 5 * p);
      ctx.fillRect(headX + p, headY - 7 * p, 2 * p, 3 * p);
      ctx.fillRect(headX + headW / 2 - 3 * p, headY - 12 * p, 6 * p, 8 * p);
      ctx.fillRect(headX + headW - 3 * p, headY - 7 * p, 2 * p, 3 * p);
      
      // Deep abyssal portal effect
      const portalPhase = abyssDepth;
      for (let i = 0; i < 4; i++) {
        const ringPhase = portalPhase + i * 0.5;
        const ringSize = 2 * p + i * p + Math.sin(ringPhase) * p;
        ctx.strokeStyle = `rgba(75, 0, 130, ${abyssPulse * (1 - i * 0.2)})`;
        ctx.lineWidth = p;
        ctx.beginPath();
        ctx.arc(headX + headW / 2, headY - 8 * p, ringSize, 0, Math.PI * 2);
        ctx.stroke();
      }
      
      // Abyssal energy tendrils
      for (let i = 0; i < 4; i++) {
        const tendrilPhase = abyssDepth + i * 1.5;
        const tendrilX = headX + headW / 2 + Math.sin(tendrilPhase) * 4 * p;
        const tendrilY = headY - 10 * p + Math.cos(tendrilPhase * 0.8) * 3 * p;
        ctx.fillStyle = `rgba(128, 0, 128, ${abyssPulse * 0.8})`;
        ctx.beginPath();
        ctx.arc(tendrilX, tendrilY, 2 * p, 0, Math.PI * 2);
        ctx.fill();
      }
      
      // Deep void center
      const voidCenter = Math.sin(time * 0.002) * p * 0.5;
      ctx.fillStyle = '#000000';
      ctx.fillRect(headX + headW / 2 - 2 * p, headY - 9 * p - voidCenter, 4 * p, 2 * p);
      break;
  }
  
  // Clear glow after drawing hat
  clearGlow(ctx);
}

// Draw cape when facing camera (down direction) - shows clasp and cape behind legs
function drawCapeFromFront(
  ctx: CanvasRenderingContext2D, 
  player: PlayerWithChat, 
  scaledX: number, 
  scaledY: number, 
  scaledWidth: number, 
  p: number, 
  isMoving: boolean, 
  time: number,
  colors: { main: string; accent?: string; trim?: string; pattern?: string },
  capeId: string
): void {
  // Apply rarity glow
  applyRarityGlow(ctx, capeId);
  
  const centerX = scaledX + scaledWidth / 2;
  const legBottomY = scaledY + 24 * p; // Where legs end
  
  // When facing camera, draw cape the same as side/back view
  // Single cape hanging behind legs, waving at the bottom
  
  // Use same dimensions as the main drawCape function
  const capeWidth = scaledWidth - 4 * p;
  const capeLength = 16 * p;
  const capeStartX = scaledX + 2 * p;
  const capeStartY = scaledY + 10 * p;
  
  // Animation timing - same as main cape
  const windSpeed = isMoving ? 0.012 : 0.003;
  const waveTime = time * windSpeed;
  const baseWave = isMoving ? 3 * p : 1 * p;
  
  ctx.fillStyle = colors.main;
  ctx.beginPath();
  
  // Top edge - fixed at shoulders
  ctx.moveTo(capeStartX, capeStartY);
  ctx.lineTo(capeStartX + capeWidth, capeStartY);
  
  // Right edge
  ctx.quadraticCurveTo(
    capeStartX + capeWidth + baseWave,
    capeStartY + capeLength * 0.5,
    capeStartX + capeWidth + Math.sin(waveTime) * baseWave,
    capeStartY + capeLength
  );
  
  // Bottom edge - wavy
  const bottomY = capeStartY + capeLength;
  const wave1 = Math.sin(waveTime) * baseWave;
  const wave2 = Math.sin(waveTime + 1) * baseWave;
  const wave3 = Math.sin(waveTime + 2) * baseWave;
  
  ctx.quadraticCurveTo(
    capeStartX + capeWidth * 0.75 + wave1,
    bottomY + wave1,
    capeStartX + capeWidth * 0.5 + wave2,
    bottomY + wave2 * 0.5
  );
  ctx.quadraticCurveTo(
    capeStartX + capeWidth * 0.25 + wave3,
    bottomY + wave3,
    capeStartX + Math.sin(waveTime + 3) * baseWave,
    capeStartY + capeLength
  );
  
  // Left edge
  ctx.quadraticCurveTo(
    capeStartX - baseWave,
    capeStartY + capeLength * 0.5,
    capeStartX,
    capeStartY
  );
  
  ctx.closePath();
  ctx.fill();
  
  // Add accent stripe if available
  if (colors.accent) {
    ctx.fillStyle = colors.accent;
    const stripeWidth = 2 * p;
    ctx.fillRect(
      capeStartX + capeWidth / 2 - stripeWidth / 2,
      capeStartY + 2 * p,
      stripeWidth,
      capeLength - 6 * p
    );
  }
  
  clearGlow(ctx);
}

// Cape color definitions
const CAPE_COLORS: Record<string, { main: string; accent?: string; trim?: string; pattern?: string }> = {
  // Basic capes
  'cape_red': { main: '#c0392b', accent: '#e74c3c' },
  'cape_blue': { main: '#2980b9', accent: '#3498db' },
  'cape_green': { main: '#27ae60', accent: '#2ecc71' },
  'cape_black': { main: '#1a1a1a', accent: '#2c2c2c' },
  'cape_white': { main: '#ecf0f1', accent: '#ffffff', trim: '#bdc3c7' },
  'cape_purple': { main: '#8e44ad', accent: '#9b59b6' },
  
  // Themed capes
  'cape_royal': { main: '#9b59b6', accent: '#8e44ad', trim: '#f1c40f' },
  'cape_knight': { main: '#34495e', accent: '#2c3e50', trim: '#95a5a6' },
  'cape_wizard': { main: '#2c3e50', accent: '#34495e', pattern: 'trim' },
  'cape_vampire': { main: '#1a0a0a', accent: '#4a0000', trim: '#8b0000' },
  'cape_ninja': { main: '#0a0a0a', accent: '#1a1a1a' },
  'cape_pirate': { main: '#2c1810', accent: '#3d2314', trim: '#f1c40f' },
  
  // Elemental capes
  'cape_fire': { main: '#e74c3c', accent: '#f39c12', pattern: 'flames' },
  'cape_ice': { main: '#74b9ff', accent: '#a29bfe', pattern: 'frost' },
  'cape_lightning': { main: '#9b59b6', accent: '#f1c40f', pattern: 'lightning' },
  'cape_nature': { main: '#27ae60', accent: '#2ecc71', pattern: 'leaves' },
  
  // Premium capes
  'cape_dragon': { main: '#2c3e50', accent: '#c0392b', pattern: 'scales' },
  'cape_phoenix': { main: '#e74c3c', accent: '#f39c12', pattern: 'feathers' },
  'cape_void': { main: '#0a0010', accent: '#1a0030', pattern: 'void' },
  'cape_celestial': { main: '#1a1a4e', accent: '#ffd700', pattern: 'stars' },
  'cape_rainbow': { main: '#e74c3c', pattern: 'rainbow' },
  'cape_galaxy': { main: '#0a0020', accent: '#4a0080', pattern: 'galaxy' },
  
  // Godlike capes (void/chaos themed)
  'cape_godlike_void': { main: '#000000', accent: '#4b0082', pattern: 'void' },
  'cape_godlike_chaos': { main: '#1a0000', accent: '#8b0000', pattern: 'chaos' },
  'cape_godlike_abyss': { main: '#000000', accent: '#9400d3', pattern: 'abyss' },
  
  // Legacy capes (from old accessory system)
  'acc_cape_red': { main: '#c0392b', accent: '#e74c3c' },
  'acc_cape_black': { main: '#1a1a1a', accent: '#2c2c2c' },
  'acc_cape_royal': { main: '#9b59b6', accent: '#8e44ad', trim: '#f1c40f' },
};

function drawCape(ctx: CanvasRenderingContext2D, player: PlayerWithChat, scaledX: number, scaledY: number, scaledWidth: number, p: number, isMoving: boolean, time: number, forceDirection?: 'front' | 'back'): void {
  const outfit = player.sprite.outfit;
  const direction = player.direction;
  
  // Find equipped cape - get the LAST one (most recently equipped)
  // Filter to get all capes, then take the last one
  const allCapes = outfit.filter(item => item.startsWith('cape_') || item.startsWith('acc_cape_'));
  if (allCapes.length === 0) return;
  
  // Use the last cape (most recently equipped)
  const capeId = allCapes[allCapes.length - 1];
  
  // Get cape colors
  const colors = CAPE_COLORS[capeId] || { main: '#666666', accent: '#888888' };
  
  // Cape visibility based on direction:
  // - 'up' (back to camera): cape visible, drawn AFTER body (forceDirection === 'front')
  // - 'down' (facing camera): show clasp and cape peeking behind legs
  // - 'left'/'right': cape drawn behind body (forceDirection === 'back' or undefined)
  
  if (forceDirection === 'front') {
    // Only draw if facing up (back to camera)
    if (direction !== 'up') return;
  } else {
    // Drawing behind body - skip if facing up (will draw later in front)
    if (direction === 'up') return;
    
    // For 'down' direction, draw simplified cape behind legs (scaledY already includes bounceY)
    if (direction === 'down') {
      drawCapeFromFront(ctx, player, scaledX, scaledY, scaledWidth, p, isMoving, time, colors, capeId);
      return;
    }
  }
  
  // Apply rarity glow
  applyRarityGlow(ctx, capeId);
  
  // Cape dimensions - cape hangs from shoulders
  const capeWidth = scaledWidth - 4 * p;
  const capeLength = 16 * p;
  const capeStartX = scaledX + 2 * p;
  const capeStartY = scaledY + 10 * p;
  
  // Animation timing
  const windSpeed = isMoving ? 0.012 : 0.003;
  const waveTime = time * windSpeed;
  
  // Flow direction based on movement (bottom of cape flows opposite to movement)
  let flowX = 0;
  if (isMoving) {
    if (direction === 'left') flowX = 1;      // Flow right when moving left
    else if (direction === 'right') flowX = -1; // Flow left when moving right
  }
  
  // Wave amplitude - stronger when moving
  const baseWave = isMoving ? 3 * p : 1 * p;
  
  ctx.beginPath();
  
  // Top edge - fixed at shoulders
  ctx.moveTo(capeStartX, capeStartY);
  ctx.lineTo(capeStartX + capeWidth, capeStartY);
  
  // Right edge - slight outward curve, more when moving horizontally
  const rightFlowBonus = flowX < 0 ? 2 * p : 0; // Extra curve when flowing left
  ctx.quadraticCurveTo(
    capeStartX + capeWidth + baseWave + rightFlowBonus,
    capeStartY + capeLength * 0.5,
    capeStartX + capeWidth + flowX * baseWave * 2 + Math.sin(waveTime) * baseWave,
    capeStartY + capeLength
  );
  
  // Bottom edge - wavy, flows in wind direction
  const bottomY = capeStartY + capeLength;
  const wave1 = Math.sin(waveTime) * baseWave;
  const wave2 = Math.sin(waveTime + 1) * baseWave;
  const wave3 = Math.sin(waveTime + 2) * baseWave;
  const flowOffset = flowX * baseWave * 3;
  
  ctx.quadraticCurveTo(
    capeStartX + capeWidth * 0.75 + flowOffset + wave1,
    bottomY + wave1,
    capeStartX + capeWidth * 0.5 + flowOffset + wave2,
    bottomY + wave2
  );
  ctx.quadraticCurveTo(
    capeStartX + capeWidth * 0.25 + flowOffset + wave3,
    bottomY + wave3,
    capeStartX + flowX * baseWave * 2 + Math.sin(waveTime + Math.PI) * baseWave,
    capeStartY + capeLength
  );
  
  // Left edge - slight outward curve
  const leftFlowBonus = flowX > 0 ? 2 * p : 0; // Extra curve when flowing right
  ctx.quadraticCurveTo(
    capeStartX - baseWave - leftFlowBonus,
    capeStartY + capeLength * 0.5,
    capeStartX,
    capeStartY
  );
  
  ctx.closePath();
  
  // Fill with gradient or pattern
  if (colors.pattern === 'rainbow') {
    // Rainbow gradient
    const gradient = ctx.createLinearGradient(capeStartX, capeStartY, capeStartX + capeWidth, capeStartY + capeLength);
    gradient.addColorStop(0, '#e74c3c');
    gradient.addColorStop(0.17, '#f39c12');
    gradient.addColorStop(0.33, '#f1c40f');
    gradient.addColorStop(0.5, '#2ecc71');
    gradient.addColorStop(0.67, '#3498db');
    gradient.addColorStop(0.83, '#9b59b6');
    gradient.addColorStop(1, '#e74c3c');
    ctx.fillStyle = gradient;
  } else if (colors.pattern === 'galaxy') {
    // Galaxy gradient
    const gradient = ctx.createRadialGradient(
      capeStartX + capeWidth / 2, capeStartY + capeLength / 2, 0,
      capeStartX + capeWidth / 2, capeStartY + capeLength / 2, capeLength
    );
    gradient.addColorStop(0, '#4a0080');
    gradient.addColorStop(0.3, '#1a0040');
    gradient.addColorStop(0.6, '#0a0020');
    gradient.addColorStop(1, '#000010');
    ctx.fillStyle = gradient;
  } else if (colors.pattern === 'flames') {
    // Fire gradient
    const gradient = ctx.createLinearGradient(capeStartX, capeStartY, capeStartX, capeStartY + capeLength);
    gradient.addColorStop(0, '#e74c3c');
    gradient.addColorStop(0.5, '#f39c12');
    gradient.addColorStop(1, '#f1c40f');
    ctx.fillStyle = gradient;
  } else if (colors.pattern === 'frost') {
    // Ice gradient
    const gradient = ctx.createLinearGradient(capeStartX, capeStartY, capeStartX, capeStartY + capeLength);
    gradient.addColorStop(0, '#a29bfe');
    gradient.addColorStop(0.5, '#74b9ff');
    gradient.addColorStop(1, '#dfe6e9');
    ctx.fillStyle = gradient;
  } else {
    // Standard gradient from main to accent
    const gradient = ctx.createLinearGradient(capeStartX, capeStartY, capeStartX, capeStartY + capeLength);
    gradient.addColorStop(0, colors.accent || colors.main);
    gradient.addColorStop(1, colors.main);
    ctx.fillStyle = gradient;
  }
  
  ctx.fill();
  
  // Draw trim if present
  if (colors.trim) {
    ctx.strokeStyle = colors.trim;
    ctx.lineWidth = 2 * p;
    ctx.stroke();
  }
  
  // Draw pattern details
  if (colors.pattern === 'stars' || colors.pattern === 'galaxy') {
    // Draw sparkles/stars
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 5; i++) {
      const starX = capeStartX + (capeWidth * 0.2) + (capeWidth * 0.6 * ((i * 37) % 100) / 100);
      const starY = capeStartY + (capeLength * 0.2) + (capeLength * 0.6 * ((i * 53) % 100) / 100);
      const twinkle = Math.sin(time * 0.005 + i) * 0.5 + 0.5;
      ctx.globalAlpha = 0.3 + twinkle * 0.7;
      ctx.fillRect(starX, starY, p, p);
    }
    ctx.globalAlpha = 1;
  }
  
  if (colors.pattern === 'scales') {
    // Draw dragon scale pattern
    ctx.fillStyle = colors.accent || '#c0392b';
    ctx.globalAlpha = 0.3;
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 3; col++) {
        const scaleX = capeStartX + 2 * p + col * 4 * p + (row % 2) * 2 * p;
        const scaleY = capeStartY + 4 * p + row * 4 * p;
        ctx.beginPath();
        ctx.arc(scaleX + 2 * p, scaleY, 2 * p, 0, Math.PI);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
  
  if (colors.pattern === 'void') {
    // Void swirl effect
    ctx.strokeStyle = '#6a0dad';
    ctx.lineWidth = p;
    ctx.globalAlpha = 0.5;
    const swirl = time * 0.002;
    ctx.beginPath();
    for (let i = 0; i < 20; i++) {
      const angle = swirl + (i / 20) * Math.PI * 4;
      const radius = (i / 20) * 6 * p;
      const cx = capeStartX + capeWidth / 2;
      const cy = capeStartY + capeLength * 0.6;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius * 0.5;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  
  clearGlow(ctx);
}

function drawBackAccessories(ctx: CanvasRenderingContext2D, player: PlayerWithChat, scaledX: number, scaledY: number, scaledWidth: number, p: number, isMoving: boolean = false, time: number = Date.now()): void {
  const outfit = player.sprite.outfit;
  
  // Helper to apply glow for an accessory
  const applyAccGlow = (itemId: string) => applyRarityGlow(ctx, itemId);
  // Helper to apply glow for wings
  const applyWingGlow = (itemId: string) => applyRarityGlow(ctx, itemId);
  
  // Draw capes first (they go behind everything) (scaledY already includes bounceY)
  drawCape(ctx, player, scaledX, scaledY, scaledWidth, p, isMoving, time);
  
  // Note: Wings are now drawn separately in drawWings() function
  // Smooth wave motion - wings gently rotate/wave
  const waveAngle = Math.sin(time * 0.003) * 0.15; // Gentle wave, ~2 second cycle
  
  // Wing attachment point - closer to body
  const leftWingX = scaledX + p;
  const rightWingX = scaledX + scaledWidth - p;
  const wingY = scaledY + 8 * p;
  const centerY = scaledY + 10 * p; // Pivot point for rotation
  
  if (outfit.includes('acc_wings_angel')) {
    applyWingGlow('acc_wings_angel');
    ctx.fillStyle = '#ffffff';
    // Left wing - rotate around attachment point
    ctx.save();
    ctx.translate(leftWingX, centerY);
    ctx.rotate(-waveAngle);
    ctx.translate(-leftWingX, -centerY);
    ctx.beginPath();
    ctx.moveTo(leftWingX, wingY);
    ctx.lineTo(scaledX - 10 * p, scaledY);
    ctx.lineTo(scaledX - 12 * p, scaledY + 6 * p);
    ctx.lineTo(scaledX - 8 * p, scaledY + 12 * p);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Right wing
    ctx.save();
    ctx.translate(rightWingX, centerY);
    ctx.rotate(waveAngle);
    ctx.translate(-rightWingX, -centerY);
    ctx.beginPath();
    ctx.moveTo(rightWingX, wingY);
    ctx.lineTo(scaledX + scaledWidth + 10 * p, scaledY);
    ctx.lineTo(scaledX + scaledWidth + 12 * p, scaledY + 6 * p);
    ctx.lineTo(scaledX + scaledWidth + 8 * p, scaledY + 12 * p);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    clearGlow(ctx);
  }
  
  if (outfit.includes('acc_wings_devil')) {
    applyWingGlow('acc_wings_devil');
    ctx.fillStyle = '#4a0000';
    // Left wing
    ctx.save();
    ctx.translate(leftWingX, centerY);
    ctx.rotate(-waveAngle);
    ctx.translate(-leftWingX, -centerY);
    ctx.beginPath();
    ctx.moveTo(leftWingX, wingY);
    ctx.lineTo(scaledX - 8 * p, scaledY - 2 * p);
    ctx.lineTo(scaledX - 12 * p, scaledY + 4 * p);
    ctx.lineTo(scaledX - 10 * p, scaledY + 10 * p);
    ctx.lineTo(scaledX - 6 * p, scaledY + 14 * p);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Right wing
    ctx.save();
    ctx.translate(rightWingX, centerY);
    ctx.rotate(waveAngle);
    ctx.translate(-rightWingX, -centerY);
    ctx.beginPath();
    ctx.moveTo(rightWingX, wingY);
    ctx.lineTo(scaledX + scaledWidth + 8 * p, scaledY - 2 * p);
    ctx.lineTo(scaledX + scaledWidth + 12 * p, scaledY + 4 * p);
    ctx.lineTo(scaledX + scaledWidth + 10 * p, scaledY + 10 * p);
    ctx.lineTo(scaledX + scaledWidth + 6 * p, scaledY + 14 * p);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    clearGlow(ctx);
  }
  
  if (outfit.includes('acc_wings_fairy')) {
    applyWingGlow('acc_wings_fairy');
    ctx.fillStyle = 'rgba(255, 182, 193, 0.7)';
    // Fairy wings wave faster
    const fairyWave = Math.sin(time * 0.008) * 0.2;
    ctx.beginPath();
    ctx.ellipse(scaledX - 4 * p, scaledY + 8 * p, 8 * p, 12 * p, -0.3 - fairyWave, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(scaledX + scaledWidth + 4 * p, scaledY + 8 * p, 8 * p, 12 * p, 0.3 + fairyWave, 0, Math.PI * 2);
    ctx.fill();
    clearGlow(ctx);
  }
  
  if (outfit.includes('acc_wings_dragon')) {
    // Legendary dragon wings with gentle fiery glow
    const dragonTime = Date.now();
    const firePulse = Math.sin(dragonTime * 0.0015) * 0.15 + 0.85; // Slower, subtler pulse
    
    // Enhanced glow effect
    ctx.shadowColor = '#ff4500';
    ctx.shadowBlur = 15 + firePulse * 10;
    
    ctx.fillStyle = '#2c3e50';
    // Left wing
    ctx.save();
    ctx.translate(leftWingX, centerY);
    ctx.rotate(-waveAngle * 1.2); // Dragon wings wave slightly more
    ctx.translate(-leftWingX, -centerY);
    ctx.beginPath();
    ctx.moveTo(leftWingX, scaledY + 6 * p);
    ctx.lineTo(scaledX - 6 * p, scaledY - 6 * p);
    ctx.lineTo(scaledX - 14 * p, scaledY);
    ctx.lineTo(scaledX - 16 * p, scaledY + 8 * p);
    ctx.lineTo(scaledX - 12 * p, scaledY + 14 * p);
    ctx.lineTo(scaledX - 6 * p, scaledY + 16 * p);
    ctx.closePath();
    ctx.fill();
    // Fiery veins on wing
    ctx.fillStyle = `rgba(255, 69, 0, ${0.6 + firePulse * 0.4})`;
    ctx.fillRect(scaledX - 8 * p, scaledY + 2 * p, 2 * p, 6 * p);
    ctx.fillRect(scaledX - 12 * p, scaledY + 4 * p, 2 * p, 4 * p);
    ctx.restore();
    // Right wing
    ctx.save();
    ctx.translate(rightWingX, centerY);
    ctx.rotate(waveAngle * 1.2);
    ctx.translate(-rightWingX, -centerY);
    ctx.fillStyle = '#2c3e50';
    ctx.beginPath();
    ctx.moveTo(rightWingX, scaledY + 6 * p);
    ctx.lineTo(scaledX + scaledWidth + 6 * p, scaledY - 6 * p);
    ctx.lineTo(scaledX + scaledWidth + 14 * p, scaledY);
    ctx.lineTo(scaledX + scaledWidth + 16 * p, scaledY + 8 * p);
    ctx.lineTo(scaledX + scaledWidth + 12 * p, scaledY + 14 * p);
    ctx.lineTo(scaledX + scaledWidth + 6 * p, scaledY + 16 * p);
    ctx.closePath();
    ctx.fill();
    // Fiery veins on wing
    ctx.fillStyle = `rgba(255, 69, 0, ${0.6 + firePulse * 0.4})`;
    ctx.fillRect(scaledX + scaledWidth + 6 * p, scaledY + 2 * p, 2 * p, 6 * p);
    ctx.fillRect(scaledX + scaledWidth + 10 * p, scaledY + 4 * p, 2 * p, 4 * p);
    ctx.restore();
    clearGlow(ctx);
  }
  
  // === LEGENDARY WINGS ===
  
  // Golden Wings
  if (outfit.includes('acc_wings_golden')) {
    const goldenWingTime = Date.now();
    const goldenPulse = Math.sin(goldenWingTime * 0.0015) * 0.15 + 0.85;
    
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 12 + goldenPulse * 8;
    
    ctx.fillStyle = '#ffd700';
    // Left wing
    ctx.save();
    ctx.translate(leftWingX, centerY);
    ctx.rotate(-waveAngle * 1.1);
    ctx.translate(-leftWingX, -centerY);
    ctx.beginPath();
    ctx.moveTo(leftWingX, scaledY + 6 * p);
    ctx.lineTo(scaledX - 6 * p, scaledY - 6 * p);
    ctx.lineTo(scaledX - 14 * p, scaledY);
    ctx.lineTo(scaledX - 16 * p, scaledY + 8 * p);
    ctx.lineTo(scaledX - 12 * p, scaledY + 14 * p);
    ctx.lineTo(scaledX - 6 * p, scaledY + 16 * p);
    ctx.closePath();
    ctx.fill();
    // Golden shimmer on wing
    ctx.fillStyle = `rgba(255, 236, 139, ${0.6 + goldenPulse * 0.4})`;
    ctx.fillRect(scaledX - 8 * p, scaledY + 2 * p, 2 * p, 6 * p);
    ctx.fillRect(scaledX - 12 * p, scaledY + 4 * p, 2 * p, 4 * p);
    ctx.restore();
    // Right wing
    ctx.save();
    ctx.translate(rightWingX, centerY);
    ctx.rotate(waveAngle * 1.1);
    ctx.translate(-rightWingX, -centerY);
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.moveTo(rightWingX, scaledY + 6 * p);
    ctx.lineTo(scaledX + scaledWidth + 6 * p, scaledY - 6 * p);
    ctx.lineTo(scaledX + scaledWidth + 14 * p, scaledY);
    ctx.lineTo(scaledX + scaledWidth + 16 * p, scaledY + 8 * p);
    ctx.lineTo(scaledX + scaledWidth + 12 * p, scaledY + 14 * p);
    ctx.lineTo(scaledX + scaledWidth + 6 * p, scaledY + 16 * p);
    ctx.closePath();
    ctx.fill();
    // Golden shimmer on wing
    ctx.fillStyle = `rgba(255, 236, 139, ${0.6 + goldenPulse * 0.4})`;
    ctx.fillRect(scaledX + scaledWidth + 6 * p, scaledY + 2 * p, 2 * p, 6 * p);
    ctx.fillRect(scaledX + scaledWidth + 10 * p, scaledY + 4 * p, 2 * p, 4 * p);
    ctx.restore();
    clearGlow(ctx);
  }
  
  // Phoenix Wings
  if (outfit.includes('acc_wings_phoenix')) {
    const phoenixWingTime = Date.now();
    const phoenixPulse = Math.sin(phoenixWingTime * 0.0015) * 0.15 + 0.85;
    
    ctx.shadowColor = '#ff6600';
    ctx.shadowBlur = 15 + phoenixPulse * 10;
    
    ctx.fillStyle = '#ff4500';
    // Left wing
    ctx.save();
    ctx.translate(leftWingX, centerY);
    ctx.rotate(-waveAngle * 1.2);
    ctx.translate(-leftWingX, -centerY);
    ctx.beginPath();
    ctx.moveTo(leftWingX, scaledY + 6 * p);
    ctx.lineTo(scaledX - 6 * p, scaledY - 6 * p);
    ctx.lineTo(scaledX - 14 * p, scaledY);
    ctx.lineTo(scaledX - 16 * p, scaledY + 8 * p);
    ctx.lineTo(scaledX - 12 * p, scaledY + 14 * p);
    ctx.lineTo(scaledX - 6 * p, scaledY + 16 * p);
    ctx.closePath();
    ctx.fill();
    // Fiery feathers
    ctx.fillStyle = `rgba(255, 215, 0, ${0.6 + phoenixPulse * 0.4})`;
    ctx.fillRect(scaledX - 8 * p, scaledY + 2 * p, 2 * p, 6 * p);
    ctx.fillRect(scaledX - 12 * p, scaledY + 4 * p, 2 * p, 4 * p);
    ctx.fillRect(scaledX - 10 * p, scaledY + 8 * p, 2 * p, 3 * p);
    ctx.restore();
    // Right wing
    ctx.save();
    ctx.translate(rightWingX, centerY);
    ctx.rotate(waveAngle * 1.2);
    ctx.translate(-rightWingX, -centerY);
    ctx.fillStyle = '#ff4500';
    ctx.beginPath();
    ctx.moveTo(rightWingX, scaledY + 6 * p);
    ctx.lineTo(scaledX + scaledWidth + 6 * p, scaledY - 6 * p);
    ctx.lineTo(scaledX + scaledWidth + 14 * p, scaledY);
    ctx.lineTo(scaledX + scaledWidth + 16 * p, scaledY + 8 * p);
    ctx.lineTo(scaledX + scaledWidth + 12 * p, scaledY + 14 * p);
    ctx.lineTo(scaledX + scaledWidth + 6 * p, scaledY + 16 * p);
    ctx.closePath();
    ctx.fill();
    // Fiery feathers
    ctx.fillStyle = `rgba(255, 215, 0, ${0.6 + phoenixPulse * 0.4})`;
    ctx.fillRect(scaledX + scaledWidth + 6 * p, scaledY + 2 * p, 2 * p, 6 * p);
    ctx.fillRect(scaledX + scaledWidth + 10 * p, scaledY + 4 * p, 2 * p, 4 * p);
    ctx.fillRect(scaledX + scaledWidth + 8 * p, scaledY + 8 * p, 2 * p, 3 * p);
    ctx.restore();
    clearGlow(ctx);
  }
  
  // Void Wings
  if (outfit.includes('acc_wings_void')) {
    const voidWingTime = Date.now();
    const voidPulse = Math.sin(voidWingTime * 0.0015) * 0.15 + 0.85;
    
    ctx.shadowColor = '#9400d3';
    ctx.shadowBlur = 14 + voidPulse * 8;
    
    ctx.fillStyle = '#1a0a2e';
    // Left wing
    ctx.save();
    ctx.translate(leftWingX, centerY);
    ctx.rotate(-waveAngle * 1.1);
    ctx.translate(-leftWingX, -centerY);
    ctx.beginPath();
    ctx.moveTo(leftWingX, scaledY + 6 * p);
    ctx.lineTo(scaledX - 6 * p, scaledY - 6 * p);
    ctx.lineTo(scaledX - 14 * p, scaledY);
    ctx.lineTo(scaledX - 16 * p, scaledY + 8 * p);
    ctx.lineTo(scaledX - 12 * p, scaledY + 14 * p);
    ctx.lineTo(scaledX - 6 * p, scaledY + 16 * p);
    ctx.closePath();
    ctx.fill();
    // Void energy veins
    ctx.fillStyle = `rgba(148, 0, 211, ${0.6 + voidPulse * 0.4})`;
    ctx.fillRect(scaledX - 8 * p, scaledY + 2 * p, 2 * p, 6 * p);
    ctx.fillRect(scaledX - 12 * p, scaledY + 4 * p, 2 * p, 4 * p);
    ctx.restore();
    // Right wing
    ctx.save();
    ctx.translate(rightWingX, centerY);
    ctx.rotate(waveAngle * 1.1);
    ctx.translate(-rightWingX, -centerY);
    ctx.fillStyle = '#1a0a2e';
    ctx.beginPath();
    ctx.moveTo(rightWingX, scaledY + 6 * p);
    ctx.lineTo(scaledX + scaledWidth + 6 * p, scaledY - 6 * p);
    ctx.lineTo(scaledX + scaledWidth + 14 * p, scaledY);
    ctx.lineTo(scaledX + scaledWidth + 16 * p, scaledY + 8 * p);
    ctx.lineTo(scaledX + scaledWidth + 12 * p, scaledY + 14 * p);
    ctx.lineTo(scaledX + scaledWidth + 6 * p, scaledY + 16 * p);
    ctx.closePath();
    ctx.fill();
    // Void energy veins
    ctx.fillStyle = `rgba(148, 0, 211, ${0.6 + voidPulse * 0.4})`;
    ctx.fillRect(scaledX + scaledWidth + 6 * p, scaledY + 2 * p, 2 * p, 6 * p);
    ctx.fillRect(scaledX + scaledWidth + 10 * p, scaledY + 4 * p, 2 * p, 4 * p);
    ctx.restore();
    clearGlow(ctx);
  }
  
  // Celestial Wings
  if (outfit.includes('acc_wings_celestial')) {
    const celestialWingTime = Date.now();
    const celestialPulse = Math.sin(celestialWingTime * 0.0015) * 0.15 + 0.85;
    
    ctx.shadowColor = '#fffacd';
    ctx.shadowBlur = 12 + celestialPulse * 8;
    
    ctx.fillStyle = '#ffffff';
    // Left wing
    ctx.save();
    ctx.translate(leftWingX, centerY);
    ctx.rotate(-waveAngle * 1.1);
    ctx.translate(-leftWingX, -centerY);
    ctx.beginPath();
    ctx.moveTo(leftWingX, scaledY + 6 * p);
    ctx.lineTo(scaledX - 6 * p, scaledY - 6 * p);
    ctx.lineTo(scaledX - 14 * p, scaledY);
    ctx.lineTo(scaledX - 16 * p, scaledY + 8 * p);
    ctx.lineTo(scaledX - 12 * p, scaledY + 14 * p);
    ctx.lineTo(scaledX - 6 * p, scaledY + 16 * p);
    ctx.closePath();
    ctx.fill();
    // Star patterns
    ctx.fillStyle = `rgba(255, 250, 205, ${0.6 + celestialPulse * 0.4})`;
    ctx.fillRect(scaledX - 8 * p, scaledY + 2 * p, p, p);
    ctx.fillRect(scaledX - 12 * p, scaledY + 6 * p, p, p);
    ctx.fillRect(scaledX - 10 * p, scaledY + 10 * p, p, p);
    ctx.restore();
    // Right wing
    ctx.save();
    ctx.translate(rightWingX, centerY);
    ctx.rotate(waveAngle * 1.1);
    ctx.translate(-rightWingX, -centerY);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(rightWingX, scaledY + 6 * p);
    ctx.lineTo(scaledX + scaledWidth + 6 * p, scaledY - 6 * p);
    ctx.lineTo(scaledX + scaledWidth + 14 * p, scaledY);
    ctx.lineTo(scaledX + scaledWidth + 16 * p, scaledY + 8 * p);
    ctx.lineTo(scaledX + scaledWidth + 12 * p, scaledY + 14 * p);
    ctx.lineTo(scaledX + scaledWidth + 6 * p, scaledY + 16 * p);
    ctx.closePath();
    ctx.fill();
    // Star patterns
    ctx.fillStyle = `rgba(255, 250, 205, ${0.6 + celestialPulse * 0.4})`;
    ctx.fillRect(scaledX + scaledWidth + 6 * p, scaledY + 2 * p, p, p);
    ctx.fillRect(scaledX + scaledWidth + 10 * p, scaledY + 6 * p, p, p);
    ctx.fillRect(scaledX + scaledWidth + 8 * p, scaledY + 10 * p, p, p);
    ctx.restore();
    clearGlow(ctx);
  }
  
  // Galaxy Wings
  if (outfit.includes('acc_wings_galaxy')) {
    const galaxyWingTime = Date.now();
    const galaxyPulse = Math.sin(galaxyWingTime * 0.0015) * 0.15 + 0.85;
    
    ctx.shadowColor = '#9400d3';
    ctx.shadowBlur = 15 + galaxyPulse * 10;
    
    ctx.fillStyle = '#1a0a3e';
    // Left wing
    ctx.save();
    ctx.translate(leftWingX, centerY);
    ctx.rotate(-waveAngle * 1.1);
    ctx.translate(-leftWingX, -centerY);
    ctx.beginPath();
    ctx.moveTo(leftWingX, scaledY + 6 * p);
    ctx.lineTo(scaledX - 6 * p, scaledY - 6 * p);
    ctx.lineTo(scaledX - 14 * p, scaledY);
    ctx.lineTo(scaledX - 16 * p, scaledY + 8 * p);
    ctx.lineTo(scaledX - 12 * p, scaledY + 14 * p);
    ctx.lineTo(scaledX - 6 * p, scaledY + 16 * p);
    ctx.closePath();
    ctx.fill();
    // Cosmic patterns
    ctx.fillStyle = `rgba(65, 105, 225, ${0.6 + galaxyPulse * 0.4})`;
    ctx.fillRect(scaledX - 8 * p, scaledY + 2 * p, 2 * p, 6 * p);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(scaledX - 10 * p, scaledY + 4 * p, p, p);
    ctx.fillRect(scaledX - 12 * p, scaledY + 8 * p, p, p);
    ctx.restore();
    // Right wing
    ctx.save();
    ctx.translate(rightWingX, centerY);
    ctx.rotate(waveAngle * 1.1);
    ctx.translate(-rightWingX, -centerY);
    ctx.fillStyle = '#1a0a3e';
    ctx.beginPath();
    ctx.moveTo(rightWingX, scaledY + 6 * p);
    ctx.lineTo(scaledX + scaledWidth + 6 * p, scaledY - 6 * p);
    ctx.lineTo(scaledX + scaledWidth + 14 * p, scaledY);
    ctx.lineTo(scaledX + scaledWidth + 16 * p, scaledY + 8 * p);
    ctx.lineTo(scaledX + scaledWidth + 12 * p, scaledY + 14 * p);
    ctx.lineTo(scaledX + scaledWidth + 6 * p, scaledY + 16 * p);
    ctx.closePath();
    ctx.fill();
    // Cosmic patterns
    ctx.fillStyle = `rgba(65, 105, 225, ${0.6 + galaxyPulse * 0.4})`;
    ctx.fillRect(scaledX + scaledWidth + 6 * p, scaledY + 2 * p, 2 * p, 6 * p);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(scaledX + scaledWidth + 8 * p, scaledY + 4 * p, p, p);
    ctx.fillRect(scaledX + scaledWidth + 10 * p, scaledY + 8 * p, p, p);
    ctx.restore();
    clearGlow(ctx);
  }
  
  // Rainbow Wings
  if (outfit.includes('acc_wings_rainbow')) {
    const rainbowWingTime = Date.now();
    const rainbowCycle = (rainbowWingTime * 0.001) % 1;
    
    ctx.shadowBlur = 12;
    
    // Left wing with rainbow gradient
    ctx.save();
    ctx.translate(leftWingX, centerY);
    ctx.rotate(-waveAngle * 1.1);
    ctx.translate(-leftWingX, -centerY);
    const leftGradient = ctx.createLinearGradient(scaledX - 16 * p, scaledY, leftWingX, scaledY + 16 * p);
    const rainbowColors = ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#8b00ff'];
    for (let i = 0; i < 6; i++) {
      const colorIndex = Math.floor((i + rainbowCycle * 6) % 6);
      leftGradient.addColorStop(i / 6, rainbowColors[colorIndex]);
    }
    ctx.fillStyle = leftGradient;
    ctx.beginPath();
    ctx.moveTo(leftWingX, scaledY + 6 * p);
    ctx.lineTo(scaledX - 6 * p, scaledY - 6 * p);
    ctx.lineTo(scaledX - 14 * p, scaledY);
    ctx.lineTo(scaledX - 16 * p, scaledY + 8 * p);
    ctx.lineTo(scaledX - 12 * p, scaledY + 14 * p);
    ctx.lineTo(scaledX - 6 * p, scaledY + 16 * p);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Right wing with rainbow gradient
    ctx.save();
    ctx.translate(rightWingX, centerY);
    ctx.rotate(waveAngle * 1.1);
    ctx.translate(-rightWingX, -centerY);
    const rightGradient = ctx.createLinearGradient(rightWingX, scaledY, scaledX + scaledWidth + 16 * p, scaledY + 16 * p);
    for (let i = 0; i < 6; i++) {
      const colorIndex = Math.floor((i + rainbowCycle * 6) % 6);
      rightGradient.addColorStop(i / 6, rainbowColors[colorIndex]);
    }
    ctx.fillStyle = rightGradient;
    ctx.beginPath();
    ctx.moveTo(rightWingX, scaledY + 6 * p);
    ctx.lineTo(scaledX + scaledWidth + 6 * p, scaledY - 6 * p);
    ctx.lineTo(scaledX + scaledWidth + 14 * p, scaledY);
    ctx.lineTo(scaledX + scaledWidth + 16 * p, scaledY + 8 * p);
    ctx.lineTo(scaledX + scaledWidth + 12 * p, scaledY + 14 * p);
    ctx.lineTo(scaledX + scaledWidth + 6 * p, scaledY + 16 * p);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    clearGlow(ctx);
  }
  
  // === GODLIKE WINGS ===
  
  // Void Godlike Wings
  if (outfit.includes('acc_wings_godlike_void')) {
    applyWingGlow('acc_wings_godlike_void');
    const voidWingTime = Date.now();
    const voidWingPulse = Math.sin(voidWingTime * 0.005) * 0.3 + 0.7;
    const voidWingSwirl = voidWingTime * 0.004;
    
    ctx.shadowColor = '#ef4444';
    ctx.shadowBlur = 25 + voidWingPulse * 15;
    
    ctx.fillStyle = `rgba(0, 0, 0, ${voidWingPulse})`;
    // Left wing
    ctx.save();
    ctx.translate(leftWingX, centerY);
    ctx.rotate(-waveAngle * 1.1);
    ctx.translate(-leftWingX, -centerY);
    ctx.beginPath();
    ctx.moveTo(leftWingX, scaledY + 6 * p);
    ctx.lineTo(scaledX - 6 * p, scaledY - 6 * p);
    ctx.lineTo(scaledX - 14 * p, scaledY);
    ctx.lineTo(scaledX - 16 * p, scaledY + 8 * p);
    ctx.lineTo(scaledX - 12 * p, scaledY + 14 * p);
    ctx.lineTo(scaledX - 6 * p, scaledY + 16 * p);
    ctx.closePath();
    ctx.fill();
    // Intense void energy veins
    ctx.fillStyle = `rgba(75, 0, 130, ${voidWingPulse})`;
    ctx.fillRect(scaledX - 8 * p, scaledY + 2 * p, 2 * p, 6 * p);
    ctx.fillRect(scaledX - 12 * p, scaledY + 4 * p, 2 * p, 4 * p);
    ctx.fillStyle = `rgba(239, 68, 68, ${voidWingPulse * 0.8})`;
    ctx.fillRect(scaledX - 10 * p, scaledY + 3 * p, 1.5 * p, 4 * p);
    ctx.restore();
    // Right wing
    ctx.save();
    ctx.translate(rightWingX, centerY);
    ctx.rotate(waveAngle * 1.1);
    ctx.translate(-rightWingX, -centerY);
    ctx.fillStyle = `rgba(0, 0, 0, ${voidWingPulse})`;
    ctx.beginPath();
    ctx.moveTo(rightWingX, scaledY + 6 * p);
    ctx.lineTo(scaledX + scaledWidth + 6 * p, scaledY - 6 * p);
    ctx.lineTo(scaledX + scaledWidth + 14 * p, scaledY);
    ctx.lineTo(scaledX + scaledWidth + 16 * p, scaledY + 8 * p);
    ctx.lineTo(scaledX + scaledWidth + 12 * p, scaledY + 14 * p);
    ctx.lineTo(scaledX + scaledWidth + 6 * p, scaledY + 16 * p);
    ctx.closePath();
    ctx.fill();
    // Intense void energy veins
    ctx.fillStyle = `rgba(75, 0, 130, ${voidWingPulse})`;
    ctx.fillRect(scaledX + scaledWidth + 6 * p, scaledY + 2 * p, 2 * p, 6 * p);
    ctx.fillRect(scaledX + scaledWidth + 10 * p, scaledY + 4 * p, 2 * p, 4 * p);
    ctx.fillStyle = `rgba(239, 68, 68, ${voidWingPulse * 0.8})`;
    ctx.fillRect(scaledX + scaledWidth + 8 * p, scaledY + 3 * p, 1.5 * p, 4 * p);
    ctx.restore();
    // Swirling void energy particles
    for (let i = 0; i < 6; i++) {
      const swirlPhase = voidWingSwirl + i * 1;
      const swirlX = scaledX + scaledWidth / 2 + Math.cos(swirlPhase) * 8 * p;
      const swirlY = centerY + Math.sin(swirlPhase) * 6 * p;
      ctx.fillStyle = `rgba(75, 0, 130, ${voidWingPulse})`;
      ctx.beginPath();
      ctx.arc(swirlX, swirlY, 2.5 * p, 0, Math.PI * 2);
      ctx.fill();
    }
    clearGlow(ctx);
  }
  
  // Chaos Godlike Wings
  if (outfit.includes('acc_wings_godlike_chaos')) {
    applyWingGlow('acc_wings_godlike_chaos');
    const chaosWingTime = Date.now();
    const chaosWingPulse = Math.sin(chaosWingTime * 0.005) * 0.3 + 0.7;
    const chaosWingSwirl = chaosWingTime * 0.004;
    
    ctx.shadowColor = '#ef4444';
    ctx.shadowBlur = 25 + chaosWingPulse * 15;
    
    ctx.fillStyle = `rgba(139, 0, 0, ${chaosWingPulse})`;
    // Left wing
    ctx.save();
    ctx.translate(leftWingX, centerY);
    ctx.rotate(-waveAngle * 1.1);
    ctx.translate(-leftWingX, -centerY);
    ctx.beginPath();
    ctx.moveTo(leftWingX, scaledY + 6 * p);
    ctx.lineTo(scaledX - 6 * p, scaledY - 6 * p);
    ctx.lineTo(scaledX - 14 * p, scaledY);
    ctx.lineTo(scaledX - 16 * p, scaledY + 8 * p);
    ctx.lineTo(scaledX - 12 * p, scaledY + 14 * p);
    ctx.lineTo(scaledX - 6 * p, scaledY + 16 * p);
    ctx.closePath();
    ctx.fill();
    // Chaos energy veins
    ctx.fillStyle = `rgba(75, 0, 130, ${chaosWingPulse})`;
    ctx.fillRect(scaledX - 8 * p, scaledY + 2 * p, 2 * p, 6 * p);
    ctx.fillRect(scaledX - 12 * p, scaledY + 4 * p, 2 * p, 4 * p);
    ctx.fillStyle = `rgba(239, 68, 68, ${chaosWingPulse * 0.8})`;
    ctx.fillRect(scaledX - 10 * p, scaledY + 3 * p, 1.5 * p, 4 * p);
    ctx.restore();
    // Right wing
    ctx.save();
    ctx.translate(rightWingX, centerY);
    ctx.rotate(waveAngle * 1.1);
    ctx.translate(-rightWingX, -centerY);
    ctx.fillStyle = `rgba(139, 0, 0, ${chaosWingPulse})`;
    ctx.beginPath();
    ctx.moveTo(rightWingX, scaledY + 6 * p);
    ctx.lineTo(scaledX + scaledWidth + 6 * p, scaledY - 6 * p);
    ctx.lineTo(scaledX + scaledWidth + 14 * p, scaledY);
    ctx.lineTo(scaledX + scaledWidth + 16 * p, scaledY + 8 * p);
    ctx.lineTo(scaledX + scaledWidth + 12 * p, scaledY + 14 * p);
    ctx.lineTo(scaledX + scaledWidth + 6 * p, scaledY + 16 * p);
    ctx.closePath();
    ctx.fill();
    // Chaos energy veins
    ctx.fillStyle = `rgba(75, 0, 130, ${chaosWingPulse})`;
    ctx.fillRect(scaledX + scaledWidth + 6 * p, scaledY + 2 * p, 2 * p, 6 * p);
    ctx.fillRect(scaledX + scaledWidth + 10 * p, scaledY + 4 * p, 2 * p, 4 * p);
    ctx.fillStyle = `rgba(239, 68, 68, ${chaosWingPulse * 0.8})`;
    ctx.fillRect(scaledX + scaledWidth + 8 * p, scaledY + 3 * p, 1.5 * p, 4 * p);
    ctx.restore();
    // Swirling chaos energy particles
    for (let i = 0; i < 6; i++) {
      const swirlPhase = chaosWingSwirl + i * 1;
      const swirlX = scaledX + scaledWidth / 2 + Math.cos(swirlPhase) * 8 * p;
      const swirlY = centerY + Math.sin(swirlPhase) * 6 * p;
      ctx.fillStyle = `rgba(139, 0, 0, ${chaosWingPulse})`;
      ctx.beginPath();
      ctx.arc(swirlX, swirlY, 2.5 * p, 0, Math.PI * 2);
      ctx.fill();
    }
    clearGlow(ctx);
  }
  
  // Abyss Godlike Wings
  if (outfit.includes('acc_wings_godlike_abyss')) {
    applyWingGlow('acc_wings_godlike_abyss');
    const abyssWingTime = Date.now();
    const abyssWingPulse = Math.sin(abyssWingTime * 0.005) * 0.3 + 0.7;
    const abyssWingSwirl = abyssWingTime * 0.004;
    
    ctx.shadowColor = '#ef4444';
    ctx.shadowBlur = 25 + abyssWingPulse * 15;
    
    ctx.fillStyle = `rgba(0, 0, 0, ${abyssWingPulse})`;
    // Left wing
    ctx.save();
    ctx.translate(leftWingX, centerY);
    ctx.rotate(-waveAngle * 1.1);
    ctx.translate(-leftWingX, -centerY);
    ctx.beginPath();
    ctx.moveTo(leftWingX, scaledY + 6 * p);
    ctx.lineTo(scaledX - 6 * p, scaledY - 6 * p);
    ctx.lineTo(scaledX - 14 * p, scaledY);
    ctx.lineTo(scaledX - 16 * p, scaledY + 8 * p);
    ctx.lineTo(scaledX - 12 * p, scaledY + 14 * p);
    ctx.lineTo(scaledX - 6 * p, scaledY + 16 * p);
    ctx.closePath();
    ctx.fill();
    // Abyss energy veins
    ctx.fillStyle = `rgba(75, 0, 130, ${abyssWingPulse})`;
    ctx.fillRect(scaledX - 8 * p, scaledY + 2 * p, 2 * p, 6 * p);
    ctx.fillRect(scaledX - 12 * p, scaledY + 4 * p, 2 * p, 4 * p);
    ctx.fillStyle = `rgba(239, 68, 68, ${abyssWingPulse * 0.8})`;
    ctx.fillRect(scaledX - 10 * p, scaledY + 3 * p, 1.5 * p, 4 * p);
    ctx.restore();
    // Right wing
    ctx.save();
    ctx.translate(rightWingX, centerY);
    ctx.rotate(waveAngle * 1.1);
    ctx.translate(-rightWingX, -centerY);
    ctx.fillStyle = `rgba(0, 0, 0, ${abyssWingPulse})`;
    ctx.beginPath();
    ctx.moveTo(rightWingX, scaledY + 6 * p);
    ctx.lineTo(scaledX + scaledWidth + 6 * p, scaledY - 6 * p);
    ctx.lineTo(scaledX + scaledWidth + 14 * p, scaledY);
    ctx.lineTo(scaledX + scaledWidth + 16 * p, scaledY + 8 * p);
    ctx.lineTo(scaledX + scaledWidth + 12 * p, scaledY + 14 * p);
    ctx.lineTo(scaledX + scaledWidth + 6 * p, scaledY + 16 * p);
    ctx.closePath();
    ctx.fill();
    // Abyss energy veins
    ctx.fillStyle = `rgba(75, 0, 130, ${abyssWingPulse})`;
    ctx.fillRect(scaledX + scaledWidth + 6 * p, scaledY + 2 * p, 2 * p, 6 * p);
    ctx.fillRect(scaledX + scaledWidth + 10 * p, scaledY + 4 * p, 2 * p, 4 * p);
    ctx.fillStyle = `rgba(239, 68, 68, ${abyssWingPulse * 0.8})`;
    ctx.fillRect(scaledX + scaledWidth + 8 * p, scaledY + 3 * p, 1.5 * p, 4 * p);
    ctx.restore();
    // Swirling abyss energy particles
    for (let i = 0; i < 6; i++) {
      const swirlPhase = abyssWingSwirl + i * 1;
      const swirlX = scaledX + scaledWidth / 2 + Math.cos(swirlPhase) * 8 * p;
      const swirlY = centerY + Math.sin(swirlPhase) * 6 * p;
      ctx.fillStyle = `rgba(0, 0, 0, ${abyssWingPulse})`;
      ctx.beginPath();
      ctx.arc(swirlX, swirlY, 2.5 * p, 0, Math.PI * 2);
      ctx.fill();
    }
    clearGlow(ctx);
  }
}

// Separate function for drawing wings (can be equipped alongside accessories)
function drawWings(ctx: CanvasRenderingContext2D, player: PlayerWithChat, scaledX: number, scaledY: number, scaledWidth: number, p: number, time: number = Date.now()): void {
  const outfit = player.sprite.outfit;
  
  // Helper to apply glow for wings
  const applyWingGlow = (itemId: string) => applyRarityGlow(ctx, itemId);
  // Helper to apply glow for accessories
  const applyAccGlow = (itemId: string) => applyRarityGlow(ctx, itemId);
  
  // Wings - with gentle wave animation
  if (outfit.includes('acc_backpack')) {
    applyAccGlow('acc_backpack');
    ctx.fillStyle = '#8b4513';
    ctx.fillRect(scaledX + scaledWidth / 2 - 4 * p, scaledY + 12 * p, 8 * p, 10 * p);
    ctx.fillStyle = '#a0522d';
    ctx.fillRect(scaledX + scaledWidth / 2 - 3 * p, scaledY + 14 * p, 6 * p, 2 * p);
    clearGlow(ctx);
  }
  
  // Jetpack
  if (outfit.includes('acc_jetpack')) {
    applyAccGlow('acc_jetpack');
    ctx.fillStyle = '#7f8c8d';
    ctx.fillRect(scaledX + scaledWidth / 2 - 5 * p, scaledY + 10 * p, 4 * p, 12 * p);
    ctx.fillRect(scaledX + scaledWidth / 2 + p, scaledY + 10 * p, 4 * p, 12 * p);
    ctx.fillStyle = '#e67e22';
    ctx.fillRect(scaledX + scaledWidth / 2 - 4 * p, scaledY + 22 * p, 2 * p, 4 * p);
    ctx.fillRect(scaledX + scaledWidth / 2 + 2 * p, scaledY + 22 * p, 2 * p, 4 * p);
    clearGlow(ctx);
  }
  
  // Auras (legendary animated effects - calm, gentle)
  const auraTime = Date.now();
  
  if (outfit.includes('acc_aura_fire')) {
    // Gentle fire aura with slow pulsing
    const firePulse = Math.sin(auraTime * 0.002) * 0.08 + 0.92; // Slower, subtler pulse
    const fireFlicker = Math.sin(auraTime * 0.005) * 0.05; // Very gentle flicker
    
    ctx.shadowColor = '#ff4500';
    ctx.shadowBlur = 20 * firePulse;
    
    // Outer fire ring
    ctx.fillStyle = `rgba(231, 76, 60, ${0.3 + fireFlicker})`;
    ctx.beginPath();
    ctx.ellipse(scaledX + scaledWidth / 2, scaledY + 12 * p, 
      (scaledWidth / 2 + 8 * p) * firePulse, 
      16 * p * firePulse, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Inner glow
    ctx.fillStyle = `rgba(241, 196, 15, ${0.25 + fireFlicker})`;
    ctx.beginPath();
    ctx.ellipse(scaledX + scaledWidth / 2, scaledY + 12 * p, 
      (scaledWidth / 2 + 4 * p) * firePulse, 
      12 * p * firePulse, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Core fire glow
    ctx.fillStyle = 'rgba(255, 255, 200, 0.2)';
    ctx.beginPath();
    ctx.ellipse(scaledX + scaledWidth / 2, scaledY + 12 * p, 
      scaledWidth / 3, 8 * p, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.shadowBlur = 0;
  }
  
  if (outfit.includes('acc_aura_ice')) {
    // Gentle ice aura with slow shimmering
    const icePulse = Math.sin(auraTime * 0.0015) * 0.06 + 0.94; // Slower, subtler pulse
    const iceShimmer = Math.cos(auraTime * 0.003) * 0.04; // Very gentle shimmer
    
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 15 * icePulse;
    
    // Outer frost ring
    ctx.fillStyle = `rgba(52, 152, 219, ${0.35 + iceShimmer})`;
    ctx.beginPath();
    ctx.ellipse(scaledX + scaledWidth / 2, scaledY + 12 * p, 
      (scaledWidth / 2 + 8 * p) * icePulse, 
      16 * p * icePulse, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Inner frost
    ctx.fillStyle = `rgba(236, 240, 241, ${0.3 + iceShimmer})`;
    ctx.beginPath();
    ctx.ellipse(scaledX + scaledWidth / 2, scaledY + 12 * p, 
      (scaledWidth / 2 + 4 * p) * icePulse, 
      12 * p * icePulse, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Ice crystal sparkles around the aura (slow rotation)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    for (let i = 0; i < 6; i++) {
      const angle = (auraTime * 0.0002 + i * Math.PI / 3) % (Math.PI * 2); // Very slow rotation
      const dist = scaledWidth / 2 + 6 * p;
      const sparkleX = scaledX + scaledWidth / 2 + Math.cos(angle) * dist;
      const sparkleY = scaledY + 12 * p + Math.sin(angle) * dist * 0.6;
      const sparkleSize = 1.5 + Math.sin(auraTime * 0.002 + i) * 0.5; // Gentler size variation
      ctx.beginPath();
      ctx.arc(sparkleX, sparkleY, sparkleSize, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.shadowBlur = 0;
  }
  
  // Golden Aura
  if (outfit.includes('acc_aura_golden')) {
    const goldenPulse = Math.sin(auraTime * 0.002) * 0.08 + 0.92;
    const goldenShimmer = Math.sin(auraTime * 0.003) * 0.05;
    
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 18 * goldenPulse;
    
    ctx.fillStyle = `rgba(255, 215, 0, ${0.3 + goldenShimmer})`;
    ctx.beginPath();
    ctx.ellipse(scaledX + scaledWidth / 2, scaledY + 12 * p, 
      (scaledWidth / 2 + 8 * p) * goldenPulse, 
      16 * p * goldenPulse, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = `rgba(255, 236, 139, ${0.25 + goldenShimmer})`;
    ctx.beginPath();
    ctx.ellipse(scaledX + scaledWidth / 2, scaledY + 12 * p, 
      (scaledWidth / 2 + 4 * p) * goldenPulse, 
      12 * p * goldenPulse, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.shadowBlur = 0;
  }
  
  // Phoenix Aura
  if (outfit.includes('acc_aura_phoenix')) {
    const phoenixPulse = Math.sin(auraTime * 0.002) * 0.08 + 0.92;
    const phoenixFlicker = Math.sin(auraTime * 0.005) * 0.05;
    
    ctx.shadowColor = '#ff6600';
    ctx.shadowBlur = 20 * phoenixPulse;
    
    ctx.fillStyle = `rgba(255, 102, 0, ${0.3 + phoenixFlicker})`;
    ctx.beginPath();
    ctx.ellipse(scaledX + scaledWidth / 2, scaledY + 12 * p, 
      (scaledWidth / 2 + 8 * p) * phoenixPulse, 
      16 * p * phoenixPulse, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = `rgba(255, 215, 0, ${0.25 + phoenixFlicker})`;
    ctx.beginPath();
    ctx.ellipse(scaledX + scaledWidth / 2, scaledY + 12 * p, 
      (scaledWidth / 2 + 4 * p) * phoenixPulse, 
      12 * p * phoenixPulse, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.shadowBlur = 0;
  }
  
  // Void Aura
  if (outfit.includes('acc_aura_void')) {
    const voidPulse = Math.sin(auraTime * 0.0015) * 0.06 + 0.94;
    const voidSwirl = Math.sin(auraTime * 0.002) * 0.04;
    
    ctx.shadowColor = '#9400d3';
    ctx.shadowBlur = 16 * voidPulse;
    
    ctx.fillStyle = `rgba(75, 0, 130, ${0.4 + voidSwirl})`;
    ctx.beginPath();
    ctx.ellipse(scaledX + scaledWidth / 2, scaledY + 12 * p, 
      (scaledWidth / 2 + 8 * p) * voidPulse, 
      16 * p * voidPulse, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = `rgba(148, 0, 211, ${0.3 + voidSwirl})`;
    ctx.beginPath();
    ctx.ellipse(scaledX + scaledWidth / 2, scaledY + 12 * p, 
      (scaledWidth / 2 + 4 * p) * voidPulse, 
      12 * p * voidPulse, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.shadowBlur = 0;
  }
  
  // Celestial Aura
  if (outfit.includes('acc_aura_celestial')) {
    const celestialPulse = Math.sin(auraTime * 0.002) * 0.08 + 0.92;
    const celestialTwinkle = Math.sin(auraTime * 0.003) * 0.05;
    
    ctx.shadowColor = '#fffacd';
    ctx.shadowBlur = 18 * celestialPulse;
    
    ctx.fillStyle = `rgba(255, 250, 205, ${0.3 + celestialTwinkle})`;
    ctx.beginPath();
    ctx.ellipse(scaledX + scaledWidth / 2, scaledY + 12 * p, 
      (scaledWidth / 2 + 8 * p) * celestialPulse, 
      16 * p * celestialPulse, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = `rgba(255, 255, 255, ${0.25 + celestialTwinkle})`;
    ctx.beginPath();
    ctx.ellipse(scaledX + scaledWidth / 2, scaledY + 12 * p, 
      (scaledWidth / 2 + 4 * p) * celestialPulse, 
      12 * p * celestialPulse, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Twinkling stars
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    for (let i = 0; i < 6; i++) {
      const angle = (auraTime * 0.0003 + i * Math.PI / 3) % (Math.PI * 2);
      const dist = scaledWidth / 2 + 6 * p;
      const sparkleX = scaledX + scaledWidth / 2 + Math.cos(angle) * dist;
      const sparkleY = scaledY + 12 * p + Math.sin(angle) * dist * 0.6;
      const sparkleSize = 1.5 + Math.sin(auraTime * 0.002 + i) * 0.5;
      ctx.beginPath();
      ctx.arc(sparkleX, sparkleY, sparkleSize, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.shadowBlur = 0;
  }
  
  // Galaxy Aura
  if (outfit.includes('acc_aura_galaxy')) {
    const galaxyPulse = Math.sin(auraTime * 0.002) * 0.08 + 0.92;
    const galaxyTwinkle = Math.sin(auraTime * 0.003) * 0.05;
    
    ctx.shadowColor = '#9400d3';
    ctx.shadowBlur = 20 * galaxyPulse;
    
    ctx.fillStyle = `rgba(26, 10, 62, ${0.4 + galaxyTwinkle})`;
    ctx.beginPath();
    ctx.ellipse(scaledX + scaledWidth / 2, scaledY + 12 * p, 
      (scaledWidth / 2 + 8 * p) * galaxyPulse, 
      16 * p * galaxyPulse, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = `rgba(65, 105, 225, ${0.3 + galaxyTwinkle})`;
    ctx.beginPath();
    ctx.ellipse(scaledX + scaledWidth / 2, scaledY + 12 * p, 
      (scaledWidth / 2 + 4 * p) * galaxyPulse, 
      12 * p * galaxyPulse, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Cosmic sparkles
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    for (let i = 0; i < 8; i++) {
      const angle = (auraTime * 0.0004 + i * Math.PI / 4) % (Math.PI * 2);
      const dist = scaledWidth / 2 + 6 * p;
      const sparkleX = scaledX + scaledWidth / 2 + Math.cos(angle) * dist;
      const sparkleY = scaledY + 12 * p + Math.sin(angle) * dist * 0.6;
      const sparkleSize = 1.5 + Math.sin(auraTime * 0.002 + i) * 0.5;
      ctx.beginPath();
      ctx.arc(sparkleX, sparkleY, sparkleSize, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.shadowBlur = 0;
  }
  
  // Rainbow Aura
  if (outfit.includes('acc_aura_rainbow')) {
    const rainbowPulse = Math.sin(auraTime * 0.002) * 0.08 + 0.92;
    const rainbowCycle = (auraTime * 0.001) % 1;
    
    ctx.shadowBlur = 18 * rainbowPulse;
    
    // Create rainbow gradient
    const gradient = ctx.createRadialGradient(
      scaledX + scaledWidth / 2, scaledY + 12 * p, 0,
      scaledX + scaledWidth / 2, scaledY + 12 * p, scaledWidth / 2 + 8 * p
    );
    const colors = ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#8b00ff'];
    for (let i = 0; i < 6; i++) {
      const colorIndex = Math.floor((i + rainbowCycle * 6) % 6);
      gradient.addColorStop(i / 6, colors[colorIndex] + '80');
    }
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(scaledX + scaledWidth / 2, scaledY + 12 * p, 
      (scaledWidth / 2 + 8 * p) * rainbowPulse, 
      16 * p * rainbowPulse, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.shadowBlur = 0;
  }
}

function drawFaceAccessories(ctx: CanvasRenderingContext2D, player: PlayerWithChat, headX: number, headY: number, headW: number, p: number): void {
  const outfit = player.sprite.outfit;
  
  // Helper to apply glow for an accessory
  const applyAccGlow = (itemId: string) => applyRarityGlow(ctx, itemId);
  
  if (outfit.includes('acc_glasses')) {
    applyAccGlow('acc_glasses');
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(headX, headY + 4 * p, 3 * p, 3 * p);
    ctx.fillRect(headX + headW - 3 * p, headY + 4 * p, 3 * p, 3 * p);
    ctx.fillRect(headX + 3 * p, headY + 5 * p, headW - 6 * p, p);
    clearGlow(ctx);
  }
  
  if (outfit.includes('acc_sunglasses')) {
    applyAccGlow('acc_sunglasses');
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(headX - p, headY + 4 * p, 4 * p, 3 * p);
    ctx.fillRect(headX + headW - 3 * p, headY + 4 * p, 4 * p, 3 * p);
    ctx.fillRect(headX + 3 * p, headY + 5 * p, headW - 6 * p, p);
    clearGlow(ctx);
  }
  
  if (outfit.includes('acc_monocle')) {
    applyAccGlow('acc_monocle');
    ctx.strokeStyle = '#f1c40f';
    ctx.lineWidth = p;
    ctx.beginPath();
    ctx.arc(headX + headW - 2 * p, headY + 5 * p, 2 * p, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(headX + headW, headY + 7 * p);
    ctx.lineTo(headX + headW + 2 * p, headY + 12 * p);
    ctx.stroke();
    clearGlow(ctx);
  }
  
  if (outfit.includes('acc_eyepatch')) {
    applyAccGlow('acc_eyepatch');
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(headX, headY + 4 * p, 4 * p, 3 * p);
    ctx.fillRect(headX - 2 * p, headY + 3 * p, 2 * p, p);
    ctx.fillRect(headX + headW, headY + 3 * p, 2 * p, p);
    clearGlow(ctx);
  }
  
  if (outfit.includes('acc_mask')) {
    applyAccGlow('acc_mask');
    ctx.fillStyle = '#ecf0f1';
    ctx.fillRect(headX - p, headY + 3 * p, headW + 2 * p, 5 * p);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(headX + p, headY + 4 * p, 2 * p, 2 * p);
    ctx.fillRect(headX + headW - 3 * p, headY + 4 * p, 2 * p, 2 * p);
    clearGlow(ctx);
  }
  
  if (outfit.includes('acc_cybervisor')) {
    applyAccGlow('acc_cybervisor');
    ctx.fillStyle = '#00ffff';
    ctx.globalAlpha = 0.7;
    ctx.fillRect(headX - 2 * p, headY + 3 * p, headW + 4 * p, 4 * p);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(headX - 2 * p, headY + 3 * p, headW + 4 * p, p);
    ctx.fillRect(headX - 2 * p, headY + 6 * p, headW + 4 * p, p);
    clearGlow(ctx);
  }
  
  // Neck accessories
  if (outfit.includes('acc_scarf')) {
    applyAccGlow('acc_scarf');
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(headX - p, headY + headW + 2 * p, headW + 2 * p, 3 * p);
    ctx.fillRect(headX + headW / 2, headY + headW + 5 * p, 4 * p, 6 * p);
    clearGlow(ctx);
  }
  
  if (outfit.includes('acc_bowtie')) {
    applyAccGlow('acc_bowtie');
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.moveTo(headX + headW / 2, headY + headW + 4 * p);
    ctx.lineTo(headX + headW / 2 - 3 * p, headY + headW + 2 * p);
    ctx.lineTo(headX + headW / 2 - 3 * p, headY + headW + 6 * p);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(headX + headW / 2, headY + headW + 4 * p);
    ctx.lineTo(headX + headW / 2 + 3 * p, headY + headW + 2 * p);
    ctx.lineTo(headX + headW / 2 + 3 * p, headY + headW + 6 * p);
    ctx.closePath();
    ctx.fill();
    clearGlow(ctx);
  }
  
  if (outfit.includes('acc_necklace')) {
    applyAccGlow('acc_necklace');
    ctx.fillStyle = '#f1c40f';
    ctx.fillRect(headX + 2 * p, headY + headW + 2 * p, headW - 4 * p, p);
    ctx.fillRect(headX + headW / 2 - p, headY + headW + 3 * p, 2 * p, 3 * p);
    clearGlow(ctx);
  }
}

function drawFrontAccessories(ctx: CanvasRenderingContext2D, player: PlayerWithChat, scaledX: number, scaledY: number, scaledWidth: number, p: number, time: number = Date.now()): void {
  const outfit = player.sprite.outfit;
  
  // Helper to apply glow for an accessory
  const applyAccGlow = (itemId: string) => applyRarityGlow(ctx, itemId);
  
  if (outfit.includes('acc_sword')) {
    applyAccGlow('acc_sword');
    ctx.fillStyle = '#7f8c8d';
    ctx.fillRect(scaledX + scaledWidth + 2 * p, scaledY + 6 * p, 3 * p, 16 * p);
    ctx.fillStyle = '#8b4513';
    ctx.fillRect(scaledX + scaledWidth + p, scaledY + 18 * p, 5 * p, 4 * p);
    ctx.fillStyle = '#f1c40f';
    ctx.fillRect(scaledX + scaledWidth + 3 * p, scaledY + 4 * p, p, 2 * p);
    clearGlow(ctx);
  }
  
  if (outfit.includes('acc_staff')) {
    applyAccGlow('acc_staff');
    ctx.fillStyle = '#8b4513';
    ctx.fillRect(scaledX + scaledWidth + 4 * p, scaledY, 2 * p, 26 * p);
    ctx.fillStyle = '#9b59b6';
    ctx.beginPath();
    ctx.arc(scaledX + scaledWidth + 5 * p, scaledY - 2 * p, 4 * p, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f1c40f';
    ctx.beginPath();
    ctx.arc(scaledX + scaledWidth + 5 * p, scaledY - 2 * p, 2 * p, 0, Math.PI * 2);
    ctx.fill();
    clearGlow(ctx);
  }
  
  if (outfit.includes('acc_shield')) {
    applyAccGlow('acc_shield');
    ctx.fillStyle = '#7f8c8d';
    ctx.fillRect(scaledX - 8 * p, scaledY + 8 * p, 8 * p, 12 * p);
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(scaledX - 6 * p, scaledY + 10 * p, 4 * p, 8 * p);
    clearGlow(ctx);
  }
  
  if (outfit.includes('acc_guitar')) {
    applyAccGlow('acc_guitar');
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.ellipse(scaledX + scaledWidth + 6 * p, scaledY + 16 * p, 5 * p, 7 * p, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8b4513';
    ctx.fillRect(scaledX + scaledWidth + 4 * p, scaledY + 2 * p, 3 * p, 14 * p);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(scaledX + scaledWidth + 5 * p, scaledY + 14 * p, p, 4 * p);
    clearGlow(ctx);
  }
  
  if (outfit.includes('acc_wand')) {
    applyAccGlow('acc_wand');
    ctx.fillStyle = '#f1c40f';
    ctx.fillRect(scaledX + scaledWidth + 2 * p, scaledY + 8 * p, 2 * p, 12 * p);
    ctx.fillStyle = '#ff69b4';
    ctx.beginPath();
    ctx.arc(scaledX + scaledWidth + 3 * p, scaledY + 6 * p, 3 * p, 0, Math.PI * 2);
    ctx.fill();
    clearGlow(ctx);
  }
  
  // === LEGENDARY DUAL-WIELD WEAPONS ===
  // Hand positions for dual-wield (one in each hand)
  const leftHandX = scaledX - 2 * p;
  const rightHandX = scaledX + scaledWidth + 2 * p;
  const handY = scaledY + 8 * p;
  const weaponBob = Math.sin(time * 0.003) * 0.5; // Gentle floating animation
  
  // Golden Dual Blades
  if (outfit.includes('acc_weapon_golden')) {
    const goldenWeaponPulse = Math.sin(time * 0.002) * 0.3 + 0.7;
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 8;
    // Left blade
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(leftHandX - 2 * p, handY + weaponBob, 2 * p, 14 * p);
    ctx.fillStyle = `rgba(255, 236, 139, ${goldenWeaponPulse})`;
    ctx.fillRect(leftHandX - 2 * p, handY + weaponBob, 2 * p, 4 * p);
    // Right blade
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(rightHandX, handY - weaponBob, 2 * p, 14 * p);
    ctx.fillStyle = `rgba(255, 236, 139, ${goldenWeaponPulse})`;
    ctx.fillRect(rightHandX, handY - weaponBob, 2 * p, 4 * p);
    ctx.shadowBlur = 0;
  }
  
  // Phoenix Dual Flames
  if (outfit.includes('acc_weapon_phoenix')) {
    const phoenixWeaponPulse = Math.sin(time * 0.003) * 0.3 + 0.7;
    ctx.shadowColor = '#ff6600';
    ctx.shadowBlur = 10;
    // Left flame
    ctx.fillStyle = '#ff4500';
    ctx.beginPath();
    ctx.moveTo(leftHandX - 2 * p, handY + weaponBob + 14 * p);
    ctx.lineTo(leftHandX - 4 * p, handY + weaponBob + 4 * p);
    ctx.lineTo(leftHandX, handY + weaponBob + 2 * p);
    ctx.lineTo(leftHandX + 2 * p, handY + weaponBob + 6 * p);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgba(255, 215, 0, ${phoenixWeaponPulse})`;
    ctx.fillRect(leftHandX - 2 * p, handY + weaponBob + 8 * p, 2 * p, 4 * p);
    // Right flame
    ctx.fillStyle = '#ff4500';
    ctx.beginPath();
    ctx.moveTo(rightHandX, handY - weaponBob + 14 * p);
    ctx.lineTo(rightHandX + 2 * p, handY - weaponBob + 4 * p);
    ctx.lineTo(rightHandX - 2 * p, handY - weaponBob + 2 * p);
    ctx.lineTo(rightHandX - 4 * p, handY - weaponBob + 6 * p);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgba(255, 215, 0, ${phoenixWeaponPulse})`;
    ctx.fillRect(rightHandX, handY - weaponBob + 8 * p, 2 * p, 4 * p);
    ctx.shadowBlur = 0;
  }
  
  // Void Dual Scythes
  if (outfit.includes('acc_weapon_void')) {
    const voidWeaponPulse = Math.sin(time * 0.002) * 0.3 + 0.7;
    ctx.shadowColor = '#9400d3';
    ctx.shadowBlur = 8;
    // Left scythe
    ctx.fillStyle = '#1a0a2e';
    ctx.fillRect(leftHandX - 2 * p, handY + weaponBob, 2 * p, 12 * p);
    ctx.beginPath();
    ctx.moveTo(leftHandX - 2 * p, handY + weaponBob);
    ctx.lineTo(leftHandX - 6 * p, handY + weaponBob - 2 * p);
    ctx.lineTo(leftHandX - 4 * p, handY + weaponBob + 2 * p);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgba(148, 0, 211, ${voidWeaponPulse})`;
    ctx.fillRect(leftHandX - 2 * p, handY + weaponBob + 4 * p, 2 * p, 3 * p);
    // Right scythe
    ctx.fillStyle = '#1a0a2e';
    ctx.fillRect(rightHandX, handY - weaponBob, 2 * p, 12 * p);
    ctx.beginPath();
    ctx.moveTo(rightHandX, handY - weaponBob);
    ctx.lineTo(rightHandX + 4 * p, handY - weaponBob - 2 * p);
    ctx.lineTo(rightHandX + 2 * p, handY - weaponBob + 2 * p);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgba(148, 0, 211, ${voidWeaponPulse})`;
    ctx.fillRect(rightHandX, handY - weaponBob + 4 * p, 2 * p, 3 * p);
    ctx.shadowBlur = 0;
  }
  
  // Celestial Dual Orbs
  if (outfit.includes('acc_weapon_celestial')) {
    const celestialOrbPulse = Math.sin(time * 0.002) * 0.3 + 0.7;
    ctx.shadowColor = '#fffacd';
    ctx.shadowBlur = 10;
    // Left orb
    ctx.fillStyle = `rgba(255, 250, 205, ${celestialOrbPulse})`;
    ctx.beginPath();
    ctx.arc(leftHandX - 3 * p, handY + weaponBob + 6 * p, 4 * p, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(leftHandX - 3 * p, handY + weaponBob + 6 * p, 2 * p, 0, Math.PI * 2);
    ctx.fill();
    // Right orb
    ctx.fillStyle = `rgba(255, 250, 205, ${celestialOrbPulse})`;
    ctx.beginPath();
    ctx.arc(rightHandX + 3 * p, handY - weaponBob + 6 * p, 4 * p, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(rightHandX + 3 * p, handY - weaponBob + 6 * p, 2 * p, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  
  // Galaxy Dual Blades
  if (outfit.includes('acc_weapon_galaxy')) {
    const galaxyWeaponPulse = Math.sin(time * 0.002) * 0.3 + 0.7;
    ctx.shadowColor = '#9400d3';
    ctx.shadowBlur = 10;
    // Left blade
    ctx.fillStyle = '#1a0a3e';
    ctx.fillRect(leftHandX - 2 * p, handY + weaponBob, 2 * p, 14 * p);
    ctx.fillStyle = `rgba(65, 105, 225, ${galaxyWeaponPulse})`;
    ctx.fillRect(leftHandX - 2 * p, handY + weaponBob, 2 * p, 4 * p);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(leftHandX - 2 * p, handY + weaponBob + 6 * p, p, p);
    // Right blade
    ctx.fillStyle = '#1a0a3e';
    ctx.fillRect(rightHandX, handY - weaponBob, 2 * p, 14 * p);
    ctx.fillStyle = `rgba(65, 105, 225, ${galaxyWeaponPulse})`;
    ctx.fillRect(rightHandX, handY - weaponBob, 2 * p, 4 * p);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(rightHandX + p, handY - weaponBob + 6 * p, p, p);
    ctx.shadowBlur = 0;
  }
  
  // Rainbow Dual Prisms
  if (outfit.includes('acc_weapon_rainbow')) {
    const rainbowCycle = (time * 0.001) % 1;
    ctx.shadowBlur = 8;
    // Left prism
    const leftPrismGradient = ctx.createLinearGradient(leftHandX - 4 * p, handY + weaponBob, leftHandX, handY + weaponBob + 14 * p);
    const rainbowColors = ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#8b00ff'];
    for (let i = 0; i < 6; i++) {
      const colorIndex = Math.floor((i + rainbowCycle * 6) % 6);
      leftPrismGradient.addColorStop(i / 6, rainbowColors[colorIndex]);
    }
    ctx.fillStyle = leftPrismGradient;
    ctx.fillRect(leftHandX - 2 * p, handY + weaponBob, 2 * p, 14 * p);
    // Right prism
    const rightPrismGradient = ctx.createLinearGradient(rightHandX, handY - weaponBob, rightHandX + 2 * p, handY - weaponBob + 14 * p);
    for (let i = 0; i < 6; i++) {
      const colorIndex = Math.floor((i + rainbowCycle * 6) % 6);
      rightPrismGradient.addColorStop(i / 6, rainbowColors[colorIndex]);
    }
    ctx.fillStyle = rightPrismGradient;
    ctx.fillRect(rightHandX, handY - weaponBob, 2 * p, 14 * p);
    ctx.shadowBlur = 0;
  }
}

// Draw infinity icon for NPCs (purple)
function drawNPCInfinityIcon(ctx: CanvasRenderingContext2D, x: number, y: number, p: number): void {
  const iconSize = 12 * p;
  const iconY = y - iconSize / 2;
  
  // Draw infinity symbol (∞) in purple
  ctx.save();
  ctx.strokeStyle = '#a855f7'; // Purple
  ctx.fillStyle = '#a855f7';
  ctx.lineWidth = 2 * p;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  // Draw infinity symbol as two overlapping circles
  const radius = iconSize / 3;
  const centerX1 = x - radius;
  const centerX2 = x + radius;
  
  // Left loop
  ctx.beginPath();
  ctx.arc(centerX1, iconY, radius, Math.PI / 2, -Math.PI / 2, false);
  ctx.stroke();
  
  // Right loop
  ctx.beginPath();
  ctx.arc(centerX2, iconY, radius, -Math.PI / 2, Math.PI / 2, false);
  ctx.stroke();
  
  // Add glow effect
  ctx.shadowColor = '#a855f7';
  ctx.shadowBlur = 4 * p;
  ctx.stroke();
  ctx.stroke();
  
  ctx.restore();
}

// Generate rainbow color based on time (cycles through spectrum)
function getRainbowColor(time: number): string {
  // Cycle through 360 degrees of hue over 3 seconds
  const hue = (time * 0.001 * 60) % 360; // 60 degrees per second = full cycle in 6 seconds
  return `hsl(${hue}, 100%, 60%)`;
}

export function drawNameTag(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, orbs: number = 0, zoom: number = 1, playerId?: string, time: number = Date.now()): void {
  // Scale font size and dimensions inversely to zoom (bigger when zoomed out, smaller when zoomed in)
  const baseFontSize = 10;
  const fontSize = baseFontSize / zoom;
  ctx.font = `${fontSize}px "Press Start 2P", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  
  // Check if orbs is infinity (for NPCs)
  const isInfinity = !isFinite(orbs);
  
  // Get orb color based on affordability (use 0 for infinity to get default color)
  const orbColorInfo = getOrbCountColor(isInfinity ? 0 : orbs);
  
  // Format orb count
  const orbText = formatOrbCount(orbs);
  const orbMetrics = ctx.measureText(orbText);
  const nameMetrics = ctx.measureText(name);
  
  // Calculate total width (orb icon + orb count + spacing + name) - scale inversely to zoom
  const orbIconSize = 8 / zoom;
  const spacing = 6 / zoom;
  // For infinity, don't include orb count text in width calculation (just icon + spacing + name)
  const totalWidth = orbIconSize + 3 / zoom + (isInfinity ? 0 : orbMetrics.width) + spacing + nameMetrics.width;
  
  const padding = 6 / zoom;
  const bgHeight = 16 / zoom;
  const bgY = y - bgHeight;
  
  // Draw background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  const bgX = x - totalWidth / 2 - padding;
  const bgWidth = totalWidth + padding * 2;
  
  // Rounded rectangle background - scale inversely to zoom
  const radius = 4 / zoom;
  ctx.beginPath();
  ctx.moveTo(bgX + radius, bgY);
  ctx.lineTo(bgX + bgWidth - radius, bgY);
  ctx.quadraticCurveTo(bgX + bgWidth, bgY, bgX + bgWidth, bgY + radius);
  ctx.lineTo(bgX + bgWidth, bgY + bgHeight - radius);
  ctx.quadraticCurveTo(bgX + bgWidth, bgY + bgHeight, bgX + bgWidth - radius, bgY + bgHeight);
  ctx.lineTo(bgX + radius, bgY + bgHeight);
  ctx.quadraticCurveTo(bgX, bgY + bgHeight, bgX, bgY + bgHeight - radius);
  ctx.lineTo(bgX, bgY + radius);
  ctx.quadraticCurveTo(bgX, bgY, bgX + radius, bgY);
  ctx.closePath();
  ctx.fill();
  
  // Starting position for content
  let contentX = x - totalWidth / 2;
  const contentY = y - 3;
  
  // Draw orb icon colored by affordability (or infinity icon for NPCs)
  const orbCenterX = contentX + orbIconSize / 2;
  const orbCenterY = bgY + bgHeight / 2;
  
  if (isInfinity) {
    // Draw infinity icon - red for centurions, purple for other NPCs
    const isCenturion = playerId?.startsWith('centurion_');
    const infinityColor = isCenturion ? '#ff0000' : '#a855f7'; // Red for centurions, purple for others
    ctx.save();
    ctx.strokeStyle = infinityColor;
    ctx.fillStyle = infinityColor;
    ctx.lineWidth = 2 / zoom;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Make infinity icon same visual size as orb icon
    const infinityRadius = orbIconSize / 3;
    const infinityX1 = orbCenterX - infinityRadius / 2;
    const infinityX2 = orbCenterX + infinityRadius / 2;
    
    // Left loop
    ctx.beginPath();
    ctx.arc(infinityX1, orbCenterY, infinityRadius, Math.PI / 2, -Math.PI / 2, false);
    ctx.stroke();
    
    // Right loop
    ctx.beginPath();
    ctx.arc(infinityX2, orbCenterY, infinityRadius, -Math.PI / 2, Math.PI / 2, false);
    ctx.stroke();
    
    // Add glow - red for centurions, purple for others - scale inversely to zoom
    ctx.shadowColor = infinityColor;
    ctx.shadowBlur = 6 / zoom;
    ctx.stroke();
    ctx.stroke();
    
    ctx.restore();
    
    // Move past infinity icon (same spacing as regular orb icon)
    contentX += orbIconSize + 3;
    
    // Draw separator (same as regular players, but with spacing to match where orb count would be)
    // For regular players: contentX += orbMetrics.width + spacing / 2, then separator
    // For infinity: we skip the orb count, so add spacing to maintain similar layout
    contentX += spacing; // Add spacing to account for missing orb count text
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillRect(contentX - 1, bgY + 3, 1, bgHeight - 6);
    contentX += spacing / 2;
  } else {
    // Orb glow (only for rare+) - scale inversely to zoom
    if (orbColorInfo.glow) {
      ctx.shadowColor = orbColorInfo.glow;
      ctx.shadowBlur = 6 / zoom;
    }
    
    // Orb body
    ctx.fillStyle = orbColorInfo.color;
    ctx.beginPath();
    ctx.arc(orbCenterX, orbCenterY, orbIconSize / 2, 0, Math.PI * 2);
    ctx.fill();
    
    // Orb highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.beginPath();
    ctx.arc(orbCenterX - 1, orbCenterY - 1, orbIconSize / 4, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.shadowBlur = 0;
    
    // Draw orb count with rarity color
    contentX += orbIconSize + 3 / zoom;
    
    // Add glow to text for rare+ - scale inversely to zoom
    if (orbColorInfo.glow) {
      ctx.shadowColor = orbColorInfo.glow;
      ctx.shadowBlur = 4 / zoom;
    }
    
    ctx.fillStyle = orbColorInfo.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom'; // Ensure baseline is set correctly
    ctx.fillText(orbText, contentX, contentY);
    
    ctx.shadowBlur = 0;
    
    // Draw separator
    contentX += orbMetrics.width + spacing / 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillRect(contentX - 1, bgY + 3, 1, bgHeight - 6);
    contentX += spacing / 2;
  }
  
  // Draw name (ensure text alignment and baseline are correct)
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom'; // Match the baseline used for other text
  
  // Check if this is YON - apply rainbow animated color
  const isYON = name === 'YON';
  
  // Use orb color for player names (NPCs use white)
  const isNPC = playerId && (playerId.startsWith('villager_') || playerId.startsWith('centurion_') || playerId.startsWith('npc_'));
  if (isYON) {
    // Rainbow animated color for YON
    const rainbowColor = getRainbowColor(time);
    ctx.fillStyle = rainbowColor;
    ctx.shadowColor = rainbowColor;
    ctx.shadowBlur = 8 / zoom; // Glowing rainbow effect
  } else if (isNPC || isInfinity) {
    ctx.fillStyle = '#ffffff'; // NPCs and game NPCs use white
  } else {
    // Use orb color for player names
    ctx.fillStyle = orbColorInfo.color;
    if (orbColorInfo.glow) {
      ctx.shadowColor = orbColorInfo.glow;
      ctx.shadowBlur = 2;
    }
  }
  ctx.fillText(name, contentX, contentY);
  // Reset shadow
  ctx.shadowBlur = 0;
  
  ctx.textAlign = 'center';
}

function formatOrbCount(orbs: number): string {
  if (orbs >= 1000000) {
    return (orbs / 1000000).toFixed(1) + 'M';
  } else if (orbs >= 1000) {
    return (orbs / 1000).toFixed(1) + 'K';
  }
  return orbs.toString();
}

export function drawChatBubble(ctx: CanvasRenderingContext2D, player: PlayerWithChat, time: number, zoom: number = 1): void {
  if (!player.chatBubble) return;
  
  const { text, createdAt } = player.chatBubble;
  
  // Parse message into segments with colors (matching chat format)
  // Rarity color map (matching ChatBar.tsx)
  const rarityColorMap: Record<ItemRarity, string> = {
    common: '#d1d5db',      // gray-300
    uncommon: '#86efac',   // green-300
    rare: '#93c5fd',        // blue-300
    epic: '#c084fc',       // purple-300
    legendary: '#fcd34d',  // amber-300
    godlike: '#9333ea',    // purple-600
  };
  
  interface TextSegment {
    text: string;
    color: string;
  }
  
  // Parse message into segments
  const segments: TextSegment[] = [];
  // Updated regex to handle [ITEM:rarity][itemName][/ITEM] format (with square brackets around item name)
  const itemRegex = /\[ITEM:([^\]]+)\]\[([^\]]+)\]\[\/ITEM\]/g;
  let lastIndex = 0;
  let match;
  
  while ((match = itemRegex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      segments.push({ text: text.substring(lastIndex, match.index), color: '' }); // Will use default color
    }
    
    // Add the item name with rarity color
    const rarity = match[1] as ItemRarity;
    const itemName = match[2];
    segments.push({ text: itemName, color: rarityColorMap[rarity] || rarityColorMap.common });
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({ text: text.substring(lastIndex), color: '' }); // Will use default color
  }
  
  // If no matches, use whole text as one segment
  if (segments.length === 0) {
    segments.push({ text, color: '' });
  }
  
  const elapsed = time - createdAt;
  const duration = GAME_CONSTANTS.CHAT_BUBBLE_DURATION;
  
  let opacity = 1;
  if (elapsed > duration - 1000) {
    opacity = (duration - elapsed) / 1000;
  }
  if (opacity <= 0) return;
  
  const scaledX = player.x * SCALE;
  const scaledY = player.y * SCALE;
  const scaledWidth = PLAYER_WIDTH * SCALE;
  
  const bubbleX = scaledX + scaledWidth / 2;
  
  // Calculate nameplate position (same as in drawNameTag)
  // Nameplate is drawn at scaledY - 20 * SCALE, with height 16 / zoom
  const nameplateY = scaledY - 20 * SCALE;
  const nameplateHeight = 16 / zoom;
  const nameplateTop = nameplateY - nameplateHeight;
  
  // Position bubble above nameplate with spacing
  const spacing = 4 / zoom; // Small gap between nameplate and bubble
  const bubbleY = nameplateTop - spacing; // Bottom of bubble (where pointer attaches)
  
  // Get color based on player's orb count (for default text)
  const orbColorInfo = getOrbCountColor(player.orbs || 0);
  const defaultTextColor = orbColorInfo.color;
  
  // Determine bubble background and border based on rarity
  let bubbleBg = 'rgba(30, 30, 40, 0.95)';
  let bubbleBorder = orbColorInfo.color;
  
  ctx.save();
  ctx.globalAlpha = opacity;
  
  // Scale font size and dimensions inversely to zoom (bigger when zoomed out, smaller when zoomed in)
  const baseFontSize = 10;
  const fontSize = baseFontSize / zoom;
  ctx.font = `${fontSize}px "Press Start 2P", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  const maxWidth = 200 / zoom;
  
  // Build lines with segments (handle word wrapping)
  interface LineSegment {
    text: string;
    color: string;
    width: number;
  }
  
  const lines: LineSegment[][] = [];
  let currentLine: LineSegment[] = [];
  let currentLineWidth = 0;
  
  // Split segments into words and build lines
  for (const segment of segments) {
    const words = segment.text.split(' ');
    const segmentColor = segment.color || defaultTextColor;
    
    for (const word of words) {
      const wordWithSpace = currentLine.length > 0 ? ` ${word}` : word;
      const wordWidth = ctx.measureText(wordWithSpace).width;
      
      if (currentLineWidth + wordWidth > maxWidth && currentLine.length > 0) {
        // Start new line
        lines.push(currentLine);
        currentLine = [{ text: word, color: segmentColor, width: ctx.measureText(word).width }];
        currentLineWidth = ctx.measureText(word).width;
      } else {
        // Add to current line
        if (currentLine.length > 0 && currentLine[currentLine.length - 1].color === segmentColor) {
          // Merge with previous segment if same color
          currentLine[currentLine.length - 1].text += wordWithSpace;
          currentLine[currentLine.length - 1].width += wordWidth;
        } else {
          currentLine.push({ text: wordWithSpace, color: segmentColor, width: wordWidth });
        }
        currentLineWidth += wordWidth;
      }
    }
  }
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }
  
  const lineHeight = 14 / zoom;
  const padding = 8 / zoom;
  let bubbleWidth = 0;
  for (const line of lines) {
    const lineWidth = line.reduce((sum, seg) => sum + seg.width, 0);
    bubbleWidth = Math.max(bubbleWidth, lineWidth);
  }
  bubbleWidth += padding * 2;
  const bubbleHeight = lines.length * lineHeight + padding * 2;
  
  const bubbleLeft = bubbleX - bubbleWidth / 2;
  const bubbleTop = bubbleY - bubbleHeight;
  
  // Dark background with player-colored border
  ctx.fillStyle = bubbleBg;
  ctx.strokeStyle = bubbleBorder;
  ctx.lineWidth = 2 / zoom;
  
  const radius = 8 / zoom;
  ctx.beginPath();
  ctx.moveTo(bubbleLeft + radius, bubbleTop);
  ctx.lineTo(bubbleLeft + bubbleWidth - radius, bubbleTop);
  ctx.quadraticCurveTo(bubbleLeft + bubbleWidth, bubbleTop, bubbleLeft + bubbleWidth, bubbleTop + radius);
  ctx.lineTo(bubbleLeft + bubbleWidth, bubbleTop + bubbleHeight - radius);
  ctx.quadraticCurveTo(bubbleLeft + bubbleWidth, bubbleTop + bubbleHeight, bubbleLeft + bubbleWidth - radius, bubbleTop + bubbleHeight);
  ctx.lineTo(bubbleLeft + radius, bubbleTop + bubbleHeight);
  ctx.quadraticCurveTo(bubbleLeft, bubbleTop + bubbleHeight, bubbleLeft, bubbleTop + bubbleHeight - radius);
  ctx.lineTo(bubbleLeft, bubbleTop + radius);
  ctx.quadraticCurveTo(bubbleLeft, bubbleTop, bubbleLeft + radius, bubbleTop);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  
  // Pointer - scale inversely to zoom
  const pointerSize = 6 / zoom;
  const pointerHeight = 8 / zoom;
  ctx.beginPath();
  ctx.moveTo(bubbleX - pointerSize, bubbleTop + bubbleHeight);
  ctx.lineTo(bubbleX, bubbleTop + bubbleHeight + pointerHeight);
  ctx.lineTo(bubbleX + pointerSize, bubbleTop + bubbleHeight);
  ctx.fillStyle = bubbleBg;
  ctx.fill();
  ctx.stroke();
  
  // Render text with appropriate colors per segment
  // Change to left alignment for proper segment rendering
  ctx.textAlign = 'left';
  lines.forEach((line, lineIndex) => {
    const lineWidth = line.reduce((sum, seg) => sum + seg.width, 0);
    const lineStartX = bubbleX - lineWidth / 2; // Center the line
    
    let xOffset = 0;
    for (const segment of line) {
      ctx.fillStyle = segment.color;
      ctx.fillText(segment.text, lineStartX + xOffset, bubbleTop + padding + lineHeight / 2 + lineIndex * lineHeight);
      xOffset += segment.width;
    }
  });
  
  ctx.restore();
}

export function clearCanvas(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
}

// Draw click target indicator (League of Legends style)
export function drawClickTarget(ctx: CanvasRenderingContext2D, worldX: number, worldY: number, time: number, playerOrbs: number = 0): void {
  const p = SCALE;
  const x = worldX * SCALE;
  const y = worldY * SCALE;
  
  // Get color based on player's orb balance
  const orbColorInfo = getOrbCountColor(playerOrbs);
  const indicatorColor = orbColorInfo.color;
  const glowColor = orbColorInfo.glow || indicatorColor;
  
  // Multiple animation effects (slowed down 50%)
  const pulseSpeed = 0.006; // 50% slower
  const pulse = Math.sin(time * pulseSpeed) * 0.25 + 0.75; // 0.5 to 1.0
  const bounce = Math.sin(time * 0.0075) * 0.1; // Vertical bounce (50% slower)
  const rotation = Math.sin(time * 0.005) * 0.1; // Slight rotation (50% slower)
  const alphaPulse = Math.sin(time * pulseSpeed * 1.5) * 0.2 + 0.8; // Alpha pulse
  
  ctx.save();
  
  // Draw animated glow rings if player has high orb count
  if (orbColorInfo.glow) {
    const glowPulse = Math.sin(time * pulseSpeed * 0.8) * 0.3 + 0.7;
    ctx.globalAlpha = 0.3 * glowPulse;
    ctx.shadowBlur = 12 * p * pulse;
    ctx.shadowColor = glowColor;
    
    // Draw expanding glow rings (50% slower)
    for (let i = 0; i < 3; i++) {
      const ringDelay = (time * 0.004 + i * 0.5) % 2; // 50% slower
      const ringAlpha = Math.max(0, 1 - ringDelay) * 0.4;
      const ringSize = 8 * p + ringDelay * 15 * p;
      ctx.globalAlpha = ringAlpha;
      ctx.beginPath();
      ctx.arc(x, y + bounce * 10 * p, ringSize, 0, Math.PI * 2);
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 2 * p;
      ctx.stroke();
    }
  }
  
  // Draw the arrow/chevron pointing down (LoL style) with animation
  const baseArrowSize = 12 * p;
  const arrowSize = baseArrowSize * pulse;
  const arrowHeight = arrowSize * 0.8;
  const animatedY = y + bounce * 8 * p;
  
  ctx.fillStyle = indicatorColor;
  ctx.strokeStyle = indicatorColor;
  ctx.lineWidth = 2.5 * p * pulse;
  ctx.globalAlpha = alphaPulse;
  
  // Apply slight rotation
  ctx.translate(x, animatedY);
  ctx.rotate(rotation);
  ctx.translate(-x, -animatedY);
  
  // Draw arrow pointing down with animated size
  ctx.beginPath();
  ctx.moveTo(x, animatedY + arrowHeight * 0.3); // Bottom point
  ctx.lineTo(x - arrowSize * 0.5, animatedY - arrowHeight * 0.2); // Left
  ctx.lineTo(x - arrowSize * 0.25, animatedY - arrowHeight * 0.1); // Left inner
  ctx.lineTo(x, animatedY - arrowHeight * 0.5); // Top center
  ctx.lineTo(x + arrowSize * 0.25, animatedY - arrowHeight * 0.1); // Right inner
  ctx.lineTo(x + arrowSize * 0.5, animatedY - arrowHeight * 0.2); // Right
  ctx.closePath();
  ctx.fill();
  
  // Draw outline for better visibility with pulse
  ctx.globalAlpha = alphaPulse * 1.2;
  ctx.stroke();
  
  // Animated circle at the tip with pulsing
  const tipPulse = Math.sin(time * pulseSpeed * 2) * 0.3 + 0.7;
  ctx.fillStyle = indicatorColor;
  ctx.globalAlpha = alphaPulse * tipPulse;
  ctx.beginPath();
  ctx.arc(x, animatedY + arrowHeight * 0.3, 2.5 * p * tipPulse, 0, Math.PI * 2);
  ctx.fill();
  
  // Draw small particles around the indicator (50% slower)
  ctx.globalAlpha = 0.6 * alphaPulse;
  for (let i = 0; i < 4; i++) {
    const angle = (time * 0.0025 + i * Math.PI / 2) % (Math.PI * 2); // 50% slower
    const distance = 8 * p + Math.sin(time * 0.005 + i) * 3 * p; // 50% slower
    const particleX = x + Math.cos(angle) * distance;
    const particleY = animatedY + Math.sin(angle) * distance;
    const particleSize = 1.5 * p * (0.5 + Math.sin(time * 0.01 + i) * 0.5); // 50% slower
    
    ctx.fillStyle = indicatorColor;
    ctx.beginPath();
    ctx.arc(particleX, particleY, particleSize, 0, Math.PI * 2);
    ctx.fill();
  }
  
  ctx.restore();
}

// ============ SHRINE RENDERING ============

// Shrine speech bubble state
interface ShrineSpeechBubble {
  text: string;
  createdAt: number;
}

const shrineSpeechBubbles: Map<string, ShrineSpeechBubble> = new Map();
const SHRINE_SPEECH_DURATION = 4000; // 4 seconds

// Set shrine speech bubble
export function setShrineSpeechBubble(shrineId: string, text: string): void {
  shrineSpeechBubbles.set(shrineId, {
    text,
    createdAt: Date.now(),
  });
  
  // Auto-remove after duration
  setTimeout(() => {
    const bubble = shrineSpeechBubbles.get(shrineId);
    if (bubble && bubble.createdAt === shrineSpeechBubbles.get(shrineId)?.createdAt) {
      shrineSpeechBubbles.delete(shrineId);
    }
  }, SHRINE_SPEECH_DURATION);
}

// Draw shrine progress bar
function drawShrineProgressBar(ctx: CanvasRenderingContext2D, shrine: Shrine, x: number, y: number, time: number): void {
  const p = SCALE;
  const now = time;
  
  if (!shrine.cooldownEndTime || now >= shrine.cooldownEndTime) {
    return; // No cooldown, don't draw progress bar
  }
  
  const cooldownDuration = 60000; // 60 seconds
  const elapsed = now - (shrine.cooldownEndTime - cooldownDuration);
  const progress = Math.max(0, Math.min(1, elapsed / cooldownDuration));
  
  const barWidth = 40 * p;
  const barHeight = 4 * p;
  const barX = x - barWidth / 2;
  const barY = y + 30 * p; // Below shrine
  
  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(barX, barY, barWidth, barHeight);
  
  // Progress fill (purple to gold gradient)
  const gradient = ctx.createLinearGradient(barX, barY, barX + barWidth, barY);
  gradient.addColorStop(0, '#a855f7'); // Purple
  gradient.addColorStop(1, '#fbbf24'); // Gold
  ctx.fillStyle = gradient;
  ctx.fillRect(barX, barY, barWidth * progress, barHeight);
  
  // Border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 1 * p;
  ctx.strokeRect(barX, barY, barWidth, barHeight);
}

// Draw shrine
export function drawShrine(
  ctx: CanvasRenderingContext2D,
  shrine: Shrine,
  time: number,
  isHovered: boolean = false
): void {
  const p = SCALE;
  // Shrine coordinates from server are in unscaled pixel coordinates (like orbs and players)
  // We need to scale them by SCALE to match the rendering system
  const x = shrine.x * SCALE;
  const y = shrine.y * SCALE;
  const now = time;
  
  ctx.save();
  
  // Hover glow effect (more prominent - drawn first so it's visible)
  if (isHovered) {
    // Draw bright glow ring around shrine
    ctx.globalAlpha = 0.6;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, 30 * p);
    gradient.addColorStop(0, 'rgba(251, 191, 36, 0.8)');
    gradient.addColorStop(0.5, 'rgba(251, 191, 36, 0.4)');
    gradient.addColorStop(1, 'rgba(251, 191, 36, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, 30 * p, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw outer glow ring
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)';
    ctx.lineWidth = 4 * p;
    ctx.beginPath();
    ctx.arc(x, y, 25 * p, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 30 * p;
    ctx.shadowColor = 'rgba(251, 191, 36, 1.0)'; // Bright gold glow for all shrine elements
  }
  
  // Mystical particles around shrine
  ctx.globalAlpha = 0.6;
  for (let i = 0; i < 6; i++) {
    const angle = (now * 0.001 + i * Math.PI / 3) % (Math.PI * 2);
    const distance = 15 * p + Math.sin(now * 0.002 + i) * 5 * p;
    const particleX = x + Math.cos(angle) * distance;
    const particleY = y + Math.sin(angle) * distance;
    const particleSize = 2 * p * (0.5 + Math.sin(now * 0.003 + i) * 0.5);
    
    ctx.fillStyle = i % 2 === 0 ? '#a855f7' : '#fbbf24'; // Purple and gold
    ctx.beginPath();
    ctx.arc(particleX, particleY, particleSize, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  
  // Base stone platform
  ctx.fillStyle = '#4a4a4a';
  ctx.beginPath();
  ctx.arc(x, y + 8 * p, 12 * p, 0, Math.PI * 2);
  ctx.fill();
  
  // Stone base shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.ellipse(x, y + 18 * p, 12 * p, 4 * p, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Main stone pillar
  const pillarWidth = 10 * p;
  const pillarHeight = 20 * p;
  ctx.fillStyle = '#5a5a5a';
  ctx.fillRect(x - pillarWidth / 2, y - pillarHeight, pillarWidth, pillarHeight);
  
  // Stone texture/details
  ctx.strokeStyle = '#3a3a3a';
  ctx.lineWidth = 1 * p;
  ctx.beginPath();
  ctx.moveTo(x - pillarWidth / 2, y - pillarHeight + 8 * p);
  ctx.lineTo(x + pillarWidth / 2, y - pillarHeight + 8 * p);
  ctx.moveTo(x - pillarWidth / 2, y - pillarHeight + 16 * p);
  ctx.lineTo(x + pillarWidth / 2, y - pillarHeight + 16 * p);
  ctx.stroke();
  
  // Top mystical crystal/ornament
  const crystalSize = 6 * p;
  const crystalY = y - pillarHeight - crystalSize / 2;
  
  // Crystal glow
  ctx.shadowBlur = 8 * p;
  ctx.shadowColor = 'rgba(168, 85, 247, 0.6)';
  ctx.fillStyle = '#a855f7';
  ctx.beginPath();
  ctx.arc(x, crystalY, crystalSize, 0, Math.PI * 2);
  ctx.fill();
  
  // Crystal highlight
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.arc(x - 1 * p, crystalY - 1 * p, crystalSize * 0.4, 0, Math.PI * 2);
  ctx.fill();
  
  // Decorative runes on sides
  ctx.strokeStyle = '#a855f7';
  ctx.lineWidth = 1.5 * p;
  ctx.globalAlpha = 0.7;
  
  // Left rune
  ctx.beginPath();
  ctx.moveTo(x - pillarWidth / 2 - 2 * p, y - pillarHeight + 6 * p);
  ctx.lineTo(x - pillarWidth / 2 - 4 * p, y - pillarHeight + 4 * p);
  ctx.lineTo(x - pillarWidth / 2 - 2 * p, y - pillarHeight + 2 * p);
  ctx.stroke();
  
  // Right rune
  ctx.beginPath();
  ctx.moveTo(x + pillarWidth / 2 + 2 * p, y - pillarHeight + 6 * p);
  ctx.lineTo(x + pillarWidth / 2 + 4 * p, y - pillarHeight + 4 * p);
  ctx.lineTo(x + pillarWidth / 2 + 2 * p, y - pillarHeight + 2 * p);
  ctx.stroke();
  
  ctx.globalAlpha = 1;
  
  // Reset shadow after drawing shrine elements (so it doesn't affect other elements)
  if (isHovered) {
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }
  
  // Draw progress bar if on cooldown
  drawShrineProgressBar(ctx, shrine, x, y, now);
  
  ctx.restore();
}

// Draw shrine speech bubble (matching NPC chat bubble style)
export function drawShrineSpeechBubble(ctx: CanvasRenderingContext2D, shrine: Shrine, time: number, zoom: number = 1): void {
  const bubble = shrineSpeechBubbles.get(shrine.id);
  if (!bubble) return;
  
  const { text, createdAt } = bubble;
  const elapsed = time - createdAt;
  const duration = SHRINE_SPEECH_DURATION;
  
  let opacity = 1;
  if (elapsed > duration - 1000) {
    opacity = (duration - elapsed) / 1000;
  }
  if (opacity <= 0) {
    shrineSpeechBubbles.delete(shrine.id);
    return;
  }
  
  // Scale coordinates to match rendering system
  const scaledX = shrine.x * SCALE;
  const scaledY = shrine.y * SCALE;
  
  const bubbleX = scaledX;
  
  // Position bubble above shrine (similar to NPC bubbles above nameplates)
  // Shrine is approximately 30 pixels tall, so position bubble above it
  const shrineTop = scaledY - 30 * SCALE; // Top of shrine
  const spacing = 4 / zoom; // Small gap
  const bubbleY = shrineTop - spacing; // Bottom of bubble (where pointer attaches)
  
  // Use purple color for shrine bubbles (matching mystical theme)
  const bubbleBg = 'rgba(30, 30, 40, 0.95)';
  const bubbleBorder = '#a855f7'; // Purple
  const textColor = '#ffffff'; // White text
  
  ctx.save();
  ctx.globalAlpha = opacity;
  
  // Scale font size and dimensions inversely to zoom (bigger when zoomed out, smaller when zoomed in)
  const baseFontSize = 10;
  const fontSize = baseFontSize / zoom;
  ctx.font = `${fontSize}px "Press Start 2P", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  const maxWidth = 200 / zoom;
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';
  
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  
  const lineHeight = 14 / zoom;
  const padding = 8 / zoom;
  let bubbleWidth = 0;
  for (const line of lines) {
    bubbleWidth = Math.max(bubbleWidth, ctx.measureText(line).width);
  }
  bubbleWidth += padding * 2;
  const bubbleHeight = lines.length * lineHeight + padding * 2;
  
  const bubbleLeft = bubbleX - bubbleWidth / 2;
  const bubbleTop = bubbleY - bubbleHeight;
  
  // Dark background with purple border (matching NPC style)
  ctx.fillStyle = bubbleBg;
  ctx.strokeStyle = bubbleBorder;
  ctx.lineWidth = 2 / zoom;
  
  const radius = 8 / zoom;
  ctx.beginPath();
  ctx.moveTo(bubbleLeft + radius, bubbleTop);
  ctx.lineTo(bubbleLeft + bubbleWidth - radius, bubbleTop);
  ctx.quadraticCurveTo(bubbleLeft + bubbleWidth, bubbleTop, bubbleLeft + bubbleWidth, bubbleTop + radius);
  ctx.lineTo(bubbleLeft + bubbleWidth, bubbleTop + bubbleHeight - radius);
  ctx.quadraticCurveTo(bubbleLeft + bubbleWidth, bubbleTop + bubbleHeight, bubbleLeft + bubbleWidth - radius, bubbleTop + bubbleHeight);
  ctx.lineTo(bubbleLeft + radius, bubbleTop + bubbleHeight);
  ctx.quadraticCurveTo(bubbleLeft, bubbleTop + bubbleHeight, bubbleLeft, bubbleTop + bubbleHeight - radius);
  ctx.lineTo(bubbleLeft, bubbleTop + radius);
  ctx.quadraticCurveTo(bubbleLeft, bubbleTop, bubbleLeft + radius, bubbleTop);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  
  // Pointer pointing down to shrine (matching NPC style)
  const pointerSize = 6 / zoom;
  const pointerHeight = 8 / zoom;
  ctx.beginPath();
  ctx.moveTo(bubbleX - pointerSize, bubbleTop + bubbleHeight);
  ctx.lineTo(bubbleX, bubbleTop + bubbleHeight + pointerHeight);
  ctx.lineTo(bubbleX + pointerSize, bubbleTop + bubbleHeight);
  ctx.fillStyle = bubbleBg;
  ctx.fill();
  ctx.stroke();
  
  // Text in white
  ctx.fillStyle = textColor;
  lines.forEach((line, i) => {
    ctx.fillText(line, bubbleX, bubbleTop + padding + lineHeight / 2 + i * lineHeight);
  });
  
  ctx.restore();
}

// Check if a click is on a shrine (returns shrine even if far away, for movement targeting)
export function getClickedShrine(worldX: number, worldY: number, shrines: Shrine[]): Shrine | null {
  const p = SCALE;
  const clickRadius = 25 * p; // Click detection radius
  
  for (const shrine of shrines) {
    // Scale shrine coordinates to match world coordinates
    const shrineX = shrine.x * SCALE;
    const shrineY = shrine.y * SCALE;
    const dx = worldX - shrineX;
    const dy = worldY - shrineY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < clickRadius) {
      return shrine;
    }
  }
  return null;
}

// Check if player is within activation range of a shrine
export function isPlayerInShrineRange(playerX: number, playerY: number, shrine: Shrine): boolean {
  const p = SCALE;
  const activationRadius = 25 * p; // Same as click radius (red circle)
  
  // Scale shrine coordinates
  const shrineX = shrine.x * SCALE;
  const shrineY = shrine.y * SCALE;
  
  // Scale player coordinates
  const scaledPlayerX = playerX * SCALE;
  const scaledPlayerY = playerY * SCALE;
  
  const dx = scaledPlayerX - shrineX;
  const dy = scaledPlayerY - shrineY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  return dist < activationRadius;
}

// Check if mouse is hovering over a shrine
export function getHoveredShrine(worldX: number, worldY: number, shrines: Shrine[]): Shrine | null {
  const p = SCALE;
  const hoverRadius = 40 * p; // Hover detection radius (larger than click for better UX)
  
  for (const shrine of shrines) {
    // Scale shrine coordinates to match world coordinates
    const shrineX = shrine.x * SCALE;
    const shrineY = shrine.y * SCALE;
    const dx = worldX - shrineX;
    const dy = worldY - shrineY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < hoverRadius) {
      return shrine;
    }
  }
  return null;
}

// ============ TREASURE CHEST RENDERING ============

// Track chests that are relocating (disappearing)
const relocatingChests: Map<string, number> = new Map(); // chestId -> startTime
const CHEST_RELOCATE_FADE_DURATION = 500; // ms

// Mark a chest as relocating (disappearing)
export function markChestRelocating(chestId: string): void {
  relocatingChests.set(chestId, Date.now());
}

// Clear relocating state
export function clearChestRelocating(chestId: string): void {
  relocatingChests.delete(chestId);
}

// Draw treasure chest
export function drawTreasureChest(
  ctx: CanvasRenderingContext2D,
  chest: TreasureChest,
  time: number,
  isHovered: boolean = false
): void {
  const p = SCALE;
  const x = chest.x * SCALE;
  const y = chest.y * SCALE;
  const now = time;
  
  ctx.save();
  
  // Check if chest is relocating (fading out)
  const relocatingStartTime = relocatingChests.get(chest.id);
  let relocatingAlpha = 1;
  if (relocatingStartTime !== undefined) {
    const elapsed = now - relocatingStartTime;
    const fadeProgress = Math.min(1, elapsed / CHEST_RELOCATE_FADE_DURATION);
    relocatingAlpha = 1 - fadeProgress; // Fade from 1 to 0
    if (fadeProgress >= 1) {
      // Fully faded, don't draw
      ctx.restore();
      return;
    }
  }
  
  // Hover glow effect
  if (isHovered) {
    ctx.globalAlpha = 0.6 * relocatingAlpha;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, 25 * p);
    gradient.addColorStop(0, 'rgba(245, 158, 11, 0.8)');
    gradient.addColorStop(0.5, 'rgba(245, 158, 11, 0.4)');
    gradient.addColorStop(1, 'rgba(245, 158, 11, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, 25 * p, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.globalAlpha = 0.3 * relocatingAlpha;
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.8)';
    ctx.lineWidth = 3 * p;
    ctx.beginPath();
    ctx.arc(x, y, 20 * p, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.globalAlpha = relocatingAlpha;
    ctx.shadowBlur = 25 * p;
    ctx.shadowColor = 'rgba(245, 158, 11, 1.0)';
  }
  
  // Cooldown indicator
  const isOnCooldown = chest.cooldownEndTime && now < chest.cooldownEndTime;
  if (isOnCooldown) {
    ctx.globalAlpha = 0.5 * relocatingAlpha;
  } else {
    ctx.globalAlpha = relocatingAlpha;
  }
  
  // Draw chest base (brown wooden box)
  ctx.fillStyle = '#8B4513'; // Brown
  ctx.fillRect(x - 12 * p, y - 8 * p, 24 * p, 16 * p);
  
  // Draw chest lid (slightly lighter brown, with slight angle for 3D effect)
  ctx.fillStyle = '#A0522D'; // Sienna
  ctx.beginPath();
  ctx.moveTo(x - 12 * p, y - 8 * p);
  ctx.lineTo(x - 10 * p, y - 12 * p);
  ctx.lineTo(x + 10 * p, y - 12 * p);
  ctx.lineTo(x + 12 * p, y - 8 * p);
  ctx.closePath();
  ctx.fill();
  
  // Draw chest lock (golden)
  ctx.fillStyle = '#FFD700'; // Gold
  ctx.beginPath();
  ctx.arc(x, y - 2 * p, 3 * p, 0, Math.PI * 2);
  ctx.fill();
  
  // Draw lock keyhole
  ctx.fillStyle = '#654321'; // Dark brown
  ctx.beginPath();
  ctx.arc(x, y - 2 * p, 1.5 * p, 0, Math.PI * 2);
  ctx.fill();
  
  // Draw chest straps (dark brown)
  ctx.strokeStyle = '#654321';
  ctx.lineWidth = 2 * p;
  ctx.beginPath();
  ctx.moveTo(x - 10 * p, y - 4 * p);
  ctx.lineTo(x + 10 * p, y - 4 * p);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(x - 10 * p, y + 2 * p);
  ctx.lineTo(x + 10 * p, y + 2 * p);
  ctx.stroke();
  
  // Draw vertical straps
  ctx.beginPath();
  ctx.moveTo(x - 6 * p, y - 8 * p);
  ctx.lineTo(x - 6 * p, y + 8 * p);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(x + 6 * p, y - 8 * p);
  ctx.lineTo(x + 6 * p, y + 8 * p);
  ctx.stroke();
  
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  
  // Draw progress bar if on cooldown
  drawTreasureChestProgressBar(ctx, chest, x, y, now);
  
  ctx.restore();
}

// Draw treasure chest progress bar
function drawTreasureChestProgressBar(ctx: CanvasRenderingContext2D, chest: TreasureChest, x: number, y: number, time: number): void {
  const p = SCALE;
  const now = time;
  
  if (!chest.cooldownEndTime || now >= chest.cooldownEndTime) {
    return; // No cooldown, don't draw progress bar
  }
  
  const cooldownDuration = 60000; // 60 seconds
  const elapsed = now - (chest.cooldownEndTime - cooldownDuration);
  const progress = Math.max(0, Math.min(1, elapsed / cooldownDuration));
  
  const barWidth = 40 * p;
  const barHeight = 4 * p;
  const barX = x - barWidth / 2;
  const barY = y + 20 * p; // Below chest
  
  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(barX, barY, barWidth, barHeight);
  
  // Progress fill (amber to gold gradient)
  const gradient = ctx.createLinearGradient(barX, barY, barX + barWidth, barY);
  gradient.addColorStop(0, '#f59e0b'); // Amber
  gradient.addColorStop(1, '#fbbf24'); // Gold
  ctx.fillStyle = gradient;
  ctx.fillRect(barX, barY, barWidth * progress, barHeight);
  
  // Border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 1 * p;
  ctx.strokeRect(barX, barY, barWidth, barHeight);
}

// Check if a click is on a treasure chest
export function getClickedTreasureChest(worldX: number, worldY: number, chests: TreasureChest[]): TreasureChest | null {
  const p = SCALE;
  const clickRadius = 20 * p; // Click detection radius
  
  for (const chest of chests) {
    const chestX = chest.x * SCALE;
    const chestY = chest.y * SCALE;
    const dx = worldX - chestX;
    const dy = worldY - chestY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < clickRadius) {
      return chest;
    }
  }
  return null;
}

// Check if player is within activation range of a treasure chest
export function isPlayerInChestRange(playerX: number, playerY: number, chest: TreasureChest): boolean {
  const p = SCALE;
  const activationRadius = 20 * p;
  
  const chestX = chest.x * SCALE;
  const chestY = chest.y * SCALE;
  
  const scaledPlayerX = playerX * SCALE;
  const scaledPlayerY = playerY * SCALE;
  
  const dx = scaledPlayerX - chestX;
  const dy = scaledPlayerY - chestY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  return dist < activationRadius;
}

// Check if mouse is hovering over a treasure chest
export function getHoveredTreasureChest(worldX: number, worldY: number, chests: TreasureChest[]): TreasureChest | null {
  return getClickedTreasureChest(worldX, worldY, chests);
}

// Draw treasure chest speech bubble (for cooldown messages)
export function drawTreasureChestSpeechBubble(ctx: CanvasRenderingContext2D, chest: TreasureChest, time: number, zoom: number = 1): void {
  // Speech bubble removed - using progress bar instead
  return;
}

// ============ PET RENDERING ============

// Draw a pet following a player
export function drawPet(
  ctx: CanvasRenderingContext2D,
  playerId: string,
  petItemId: string,
  playerX: number,
  playerY: number,
  playerDirection: Direction,
  time: number,
  player?: PlayerWithChat // Optional player object for mini me pet
): void {
  const p = SCALE;
  let petState = petStates.get(playerId);
  
  if (!petState) {
    // Initialize pet at left side of player
    petState = {
      x: playerX + PET_OFFSET_X,
      y: playerY + PET_OFFSET_Y,
      lastUpdateTime: time,
    };
    petStates.set(playerId, petState);
  }
  
  // Check if player has wings equipped - if so, offset pet further left
  const hasWings = player && player.sprite.outfit.some(itemId => 
    itemId.startsWith('acc_wings_') || itemId.includes('wings')
  );
  const wingOffset = hasWings ? -10 : 0; // Additional offset when wings are equipped
  
  // Simply position pet to the left of player (smoothly follow)
  const targetX = playerX + PET_OFFSET_X + wingOffset;
  const targetY = playerY + PET_OFFSET_Y;
  
  // Smoothly move pet to target position
  const deltaTime = Math.min(time - petState.lastUpdateTime, 100) / 16;
  const dx = targetX - petState.x;
  const dy = targetY - petState.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  if (distance > 0.1) {
    // Smooth interpolation
    const lerpSpeed = 0.2 * deltaTime;
    petState.x += dx * lerpSpeed;
    petState.y += dy * lerpSpeed;
  } else {
    // Close enough, snap to target
    petState.x = targetX;
    petState.y = targetY;
  }
  
  petState.lastUpdateTime = time;
  
  const petScaledX = petState.x * SCALE;
  const petScaledY = petState.y * SCALE;
  const bobOffset = Math.sin(time * 0.003) * PET_BOBBING_AMPLITUDE * p;
  const finalY = petScaledY + bobOffset;
  
  // Draw pet based on type
  if (petItemId === 'pet_golden') {
    drawGoldenPet(ctx, petScaledX, finalY, p, time);
  } else if (petItemId === 'pet_phoenix') {
    drawPhoenixPet(ctx, petScaledX, finalY, p, time);
  } else if (petItemId === 'pet_void') {
    drawVoidPet(ctx, petScaledX, finalY, p, time);
  } else if (petItemId === 'pet_celestial') {
    drawCelestialPet(ctx, petScaledX, finalY, p, time);
  } else if (petItemId === 'pet_galaxy') {
    drawGalaxyPet(ctx, petScaledX, finalY, p, time);
  } else if (petItemId === 'pet_rainbow') {
    drawRainbowPet(ctx, petScaledX, finalY, p, time);
  } else if (petItemId === 'pet_godlike_void') {
    drawGodlikeVoidPet(ctx, petScaledX, finalY, p, time);
  } else if (petItemId === 'pet_godlike_chaos') {
    drawGodlikeChaosPet(ctx, petScaledX, finalY, p, time);
  } else if (petItemId === 'pet_godlike_abyss') {
    drawGodlikeAbyssPet(ctx, petScaledX, finalY, p, time);
  } else if (petItemId === 'pet_mini_me') {
    if (player) {
      drawMiniMePet(ctx, petScaledX, finalY, p, time, player, playerDirection);
    }
  }
}

export function drawGoldenPet(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, time: number): void {
  const centerX = x;
  const centerY = y;
  const size = 8 * p;
  const pulse = Math.sin(time * 0.002) * 0.2 + 0.8;
  ctx.shadowColor = '#ffd700';
  ctx.shadowBlur = 8 * p * pulse;
  ctx.fillStyle = '#ffd700';
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, size, size * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  const wingFlap = Math.sin(time * 0.005) * 0.3;
  ctx.fillStyle = `rgba(255, 215, 0, ${0.7 + wingFlap})`;
  ctx.beginPath();
  ctx.ellipse(centerX - size * 0.6, centerY, size * 0.4, size * 0.6, -0.3 + wingFlap, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(centerX + size * 0.6, centerY, size * 0.4, size * 0.6, 0.3 - wingFlap, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ff6b00';
  ctx.fillRect(centerX - size * 0.3, centerY - size * 0.2, 2 * p, 2 * p);
  ctx.fillRect(centerX + size * 0.1, centerY - size * 0.2, 2 * p, 2 * p);
  const sparkleTime = (time * 0.001) % 1;
  if (sparkleTime < 0.5) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(centerX - size * 0.8, centerY - size * 0.5, p, p);
    ctx.fillRect(centerX + size * 0.6, centerY - size * 0.3, p, p);
  }
  ctx.shadowBlur = 0;
}

export function drawPhoenixPet(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, time: number): void {
  const centerX = x;
  const centerY = y;
  const size = 8 * p;
  const firePulse = Math.sin(time * 0.003) * 0.2 + 0.8;
  ctx.shadowColor = '#ff4500';
  ctx.shadowBlur = 10 * p * firePulse;
  ctx.fillStyle = '#ff4500';
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, size, size * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  const wingFlap = Math.sin(time * 0.005) * 0.3;
  ctx.fillStyle = `rgba(255, 102, 0, ${0.7 + wingFlap})`;
  ctx.beginPath();
  ctx.ellipse(centerX - size * 0.6, centerY, size * 0.4, size * 0.6, -0.3 + wingFlap, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(centerX + size * 0.6, centerY, size * 0.4, size * 0.6, 0.3 - wingFlap, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(255, 215, 0, ${firePulse})`;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY + size * 0.7);
  ctx.lineTo(centerX - size * 0.3, centerY + size * 1.2);
  ctx.lineTo(centerX, centerY + size);
  ctx.lineTo(centerX + size * 0.3, centerY + size * 1.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffd700';
  ctx.fillRect(centerX - size * 0.3, centerY - size * 0.2, 2 * p, 2 * p);
  ctx.fillRect(centerX + size * 0.1, centerY - size * 0.2, 2 * p, 2 * p);
  const emberY = centerY - size - (time * 0.1) % (8 * p);
  ctx.fillStyle = `rgba(255, 150, 0, ${0.6 + Math.sin(time * 0.005) * 0.4})`;
  ctx.fillRect(centerX - size * 0.4, emberY, 2 * p, 2 * p);
  ctx.fillRect(centerX + size * 0.2, emberY - 2 * p, 2 * p, 2 * p);
  ctx.shadowBlur = 0;
}

export function drawVoidPet(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, time: number): void {
  const centerX = x;
  const centerY = y;
  const size = 8 * p;
  const voidPulse = Math.sin(time * 0.002) * 0.15 + 0.85;
  ctx.shadowColor = '#9400d3';
  ctx.shadowBlur = 12 * p * voidPulse;
  ctx.fillStyle = '#1a0a2e';
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, size, size * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  const swirlAngle = (time * 0.001) % (Math.PI * 2);
  for (let i = 0; i < 4; i++) {
    const angle = swirlAngle + (i * Math.PI / 2);
    const dist = size * 0.6;
    const px = centerX + Math.cos(angle) * dist;
    const py = centerY + Math.sin(angle) * dist * 0.6;
    ctx.fillStyle = `rgba(148, 0, 211, ${voidPulse})`;
    ctx.fillRect(px - p, py - p, 2 * p, 2 * p);
  }
  ctx.fillStyle = '#9400d3';
  ctx.fillRect(centerX - size * 0.3, centerY - size * 0.2, 2 * p, 2 * p);
  ctx.fillRect(centerX + size * 0.1, centerY - size * 0.2, 2 * p, 2 * p);
  ctx.shadowBlur = 0;
}

export function drawCelestialPet(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, time: number): void {
  const centerX = x;
  const centerY = y;
  const size = 8 * p;
  const starPulse = Math.sin(time * 0.002) * 0.2 + 0.8;
  ctx.shadowColor = '#fffacd';
  ctx.shadowBlur = 10 * p * starPulse;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, size, size * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  const starRotation = (time * 0.0005) % (Math.PI * 2);
  for (let i = 0; i < 5; i++) {
    const angle = starRotation + (i * Math.PI * 2 / 5);
    const dist = size * 0.8;
    const px = centerX + Math.cos(angle) * dist;
    const py = centerY + Math.sin(angle) * dist * 0.6;
    ctx.fillStyle = `rgba(255, 250, 205, ${starPulse})`;
    ctx.fillRect(px - p, py - p, 2 * p, 2 * p);
  }
  const twinkleTime = (time * 0.003) % 1;
  if (twinkleTime < 0.5) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(centerX - size * 1.2, centerY - size * 0.5, p, p);
    ctx.fillRect(centerX + size * 0.8, centerY - size * 0.3, p, p);
    ctx.fillRect(centerX, centerY - size * 1.1, p, p);
  }
  ctx.fillStyle = '#fffacd';
  ctx.fillRect(centerX - size * 0.3, centerY - size * 0.2, 2 * p, 2 * p);
  ctx.fillRect(centerX + size * 0.1, centerY - size * 0.2, 2 * p, 2 * p);
  ctx.shadowBlur = 0;
}

export function drawGalaxyPet(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, time: number): void {
  const centerX = x;
  const centerY = y;
  const size = 8 * p;
  const cosmicPulse = Math.sin(time * 0.002) * 0.2 + 0.8;
  ctx.shadowColor = '#9400d3';
  ctx.shadowBlur = 12 * p * cosmicPulse;
  const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, size);
  gradient.addColorStop(0, '#4a0080');
  gradient.addColorStop(0.5, '#1a0a3e');
  gradient.addColorStop(1, '#0a0020');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, size, size * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  const swirlAngle = (time * 0.0008) % (Math.PI * 2);
  ctx.strokeStyle = `rgba(65, 105, 225, ${cosmicPulse})`;
  ctx.lineWidth = 2 * p;
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 3 + swirlAngle;
    const radius = (i / 12) * size * 0.6;
    const px = centerX + Math.cos(angle) * radius;
    const py = centerY + Math.sin(angle) * radius * 0.6;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(centerX - size * 0.6, centerY - size * 0.4, p, p);
  ctx.fillRect(centerX + size * 0.4, centerY - size * 0.2, p, p);
  ctx.fillRect(centerX, centerY - size * 0.7, p, p);
  ctx.fillStyle = '#4169e1';
  ctx.fillRect(centerX - size * 0.3, centerY - size * 0.2, 2 * p, 2 * p);
  ctx.fillRect(centerX + size * 0.1, centerY - size * 0.2, 2 * p, 2 * p);
  ctx.shadowBlur = 0;
}

export function drawRainbowPet(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, time: number): void {
  const centerX = x;
  const centerY = y;
  const size = 8 * p;
  const rainbowCycle = (time * 0.001) % 1;
  const rainbowColors = ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#8b00ff'];
  const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, size);
  for (let i = 0; i < 6; i++) {
    const colorIndex = Math.floor((i + rainbowCycle * 6) % 6);
    gradient.addColorStop(i / 6, rainbowColors[colorIndex]);
  }
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, size, size * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  const trailGradient = ctx.createLinearGradient(centerX, centerY, centerX, centerY + size * 1.2);
  for (let i = 0; i < 6; i++) {
    const colorIndex = Math.floor((i + rainbowCycle * 6) % 6);
    trailGradient.addColorStop(i / 6, rainbowColors[colorIndex] + '80');
  }
  ctx.fillStyle = trailGradient;
  ctx.beginPath();
  ctx.moveTo(centerX - size * 0.3, centerY + size * 0.7);
  ctx.lineTo(centerX, centerY + size * 1.2);
  ctx.lineTo(centerX + size * 0.3, centerY + size * 0.7);
  ctx.closePath();
  ctx.fill();
  const sparkleTime = (time * 0.002) % 1;
  if (sparkleTime < 0.5) {
    const sparkleColor = rainbowColors[Math.floor((sparkleTime * 12) % 6)];
    ctx.fillStyle = sparkleColor;
    ctx.fillRect(centerX - size * 0.8, centerY - size * 0.5, p, p);
    ctx.fillRect(centerX + size * 0.6, centerY - size * 0.3, p, p);
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(centerX - size * 0.3, centerY - size * 0.2, 2 * p, 2 * p);
  ctx.fillRect(centerX + size * 0.1, centerY - size * 0.2, 2 * p, 2 * p);
}

// Draw player direction arrows at screen edges (for off-screen players)
export function drawPlayerDirectionArrows(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  players: Map<string, PlayerWithChat>,
  localPlayerId: string | null,
  canvasWidth: number,
  canvasHeight: number
): void {
  if (!localPlayerId) return;
  
  const localPlayer = players.get(localPlayerId);
  if (!localPlayer) return;
  
  const arrowSize = 16;
  const edgePadding = 25; // Distance from edge
  const opacity = 0.5; // 50% opacity
  
  // Local player position in screen coordinates (center of screen)
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;
  
  ctx.save();
  ctx.globalAlpha = opacity;
  
  for (const [playerId, player] of players.entries()) {
    if (playerId === localPlayerId) continue;
    if (typeof player.x !== 'number' || typeof player.y !== 'number') continue;
    
    // Convert player world position to screen coordinates
    const playerScreenPos = worldToScreen(camera, player.x, player.y);
    
    // Check if player is off-screen (with some margin)
    const margin = 50;
    const isOnScreen = playerScreenPos.x >= -margin && playerScreenPos.x <= canvasWidth + margin &&
                       playerScreenPos.y >= -margin && playerScreenPos.y <= canvasHeight + margin;
    
    if (isOnScreen) continue; // Skip players that are visible
    
    // Calculate direction from center (local player) to other player in screen space
    const dx = playerScreenPos.x - centerX;
    const dy = playerScreenPos.y - centerY;
    const angle = Math.atan2(dy, dx);
    
    // Calculate arrow position at screen edge
    let arrowX = centerX;
    let arrowY = centerY;
    
    // Find intersection with screen edge
    const halfWidth = canvasWidth / 2 - edgePadding;
    const halfHeight = canvasHeight / 2 - edgePadding;
    
    // Calculate which edge the arrow should be on
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    
    if (absDx / halfWidth > absDy / halfHeight) {
      // Closer to left/right edge
      arrowX = dx > 0 ? canvasWidth - edgePadding : edgePadding;
      arrowY = centerY + dy * (halfWidth / absDx);
      arrowY = Math.max(edgePadding, Math.min(canvasHeight - edgePadding, arrowY));
    } else {
      // Closer to top/bottom edge
      arrowY = dy > 0 ? canvasHeight - edgePadding : edgePadding;
      arrowX = centerX + dx * (halfHeight / absDy);
      arrowX = Math.max(edgePadding, Math.min(canvasWidth - edgePadding, arrowX));
    }
    
    // Draw arrow
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    
    ctx.save();
    ctx.translate(arrowX, arrowY);
    ctx.rotate(angle);
    
    // Draw arrow shape (pointing right, will be rotated)
    ctx.beginPath();
    ctx.moveTo(arrowSize, 0);
    ctx.lineTo(-arrowSize * 0.6, -arrowSize * 0.4);
    ctx.lineTo(-arrowSize * 0.3, 0);
    ctx.lineTo(-arrowSize * 0.6, arrowSize * 0.4);
    ctx.closePath();
    
    ctx.fill();
    ctx.stroke();
    
    ctx.restore();
  }
  
  ctx.restore();
}

// Draw mini me pet - a scaled-down copy of the player
export function drawMiniMePet(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  p: number,
  time: number,
  player: PlayerWithChat,
  direction: Direction
): void {
  // Mini me scale factor (0.5 = half size)
  const MINI_SCALE = 0.5;
  
  // Save context state
  ctx.save();
  
  // x and y are already in scaled coordinates (petScaledX, finalY)
  // Convert to unscaled world coordinates for drawPlayer
  const unscaledX = x / SCALE;
  const unscaledY = y / SCALE;
  
  // Create a mini player object with the same outfit (excluding the pet itself)
  // Use a unique ID for the mini me pet to avoid animation state conflicts
  // IMPORTANT: Use a fixed position to prevent animation glitches from smooth following
  const miniPlayer: PlayerWithChat = {
    ...player,
    id: `${player.id}_mini_me`, // Unique ID to prevent animation state conflicts
    x: unscaledX,
    y: unscaledY,
    direction: direction,
    sprite: {
      ...player.sprite,
      outfit: player.sprite.outfit.filter(itemId => !itemId.startsWith('pet_')) // Remove pet items
    }
  };
  
  // Lock the mini me pet's animation state to always be idle
  // The pet position updates every frame (smooth following), which would trigger movement animation
  // We prevent this by pre-setting the animation state before drawPlayer calls getPlayerAnimation
  const miniMeAnimId = miniPlayer.id;
  let miniAnim = extendedPlayerAnimations.get(miniMeAnimId);
  if (!miniAnim) {
    miniAnim = {
      lastX: unscaledX,
      lastY: unscaledY,
      frame: 0,
      lastFrameTime: time,
      isMoving: false,
      idleTime: time,
      idleBobPhase: 0,
      distanceTraveled: 0,
      isChopping: false,
      chopFrame: 0,
      chopStartTime: 0
    };
    extendedPlayerAnimations.set(miniMeAnimId, miniAnim);
  }
  // Force idle state - update last position to current to prevent movement detection
  miniAnim.lastX = unscaledX;
  miniAnim.lastY = unscaledY;
  miniAnim.isMoving = false;
  miniAnim.frame = 0; // Always idle pose
  miniAnim.lastFrameTime = time;
  
  // Apply scale transform to make the player half size
  // The key insight: drawPlayer expects unscaled coordinates and scales them internally
  // So we pass unscaled coordinates, drawPlayer scales them to (x, y)
  // Then we apply a 0.5x scale transform to make everything half size
  // We need to scale around the top-left corner (x, y) so the player stays in the right position
  
  // Scale around the pet position (top-left corner)
  ctx.translate(x, y);
  ctx.scale(MINI_SCALE, MINI_SCALE);
  ctx.translate(-x, -y);
  
  // Draw the mini player (skip nameplate)
  // drawPlayer will scale unscaledX/unscaledY by SCALE to get back to (x, y)
  // Then our transform will scale it by 0.5, making it half size at the correct position
  drawPlayer(ctx, miniPlayer, false, time, true);
  
  // Restore context state
  ctx.restore();
}

// Draw mini me pet preview for shop/inventory
export function drawMiniMePetPreview(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  p: number,
  time: number
): void {
  // Draw a simple placeholder - a small generic character
  const MINI_SCALE = 0.5;
  const size = 8 * p * MINI_SCALE;
  const centerX = cx;
  const centerY = cy;
  
  // Simple body
  ctx.fillStyle = '#8B4513'; // Brown
  ctx.fillRect(centerX - size / 2, centerY - size / 2, size, size);
  
  // Simple head
  ctx.fillStyle = '#FFDBAC'; // Skin color
  ctx.fillRect(centerX - size / 3, centerY - size, size * 2 / 3, size * 2 / 3);
  
  // Eyes
  ctx.fillStyle = '#2c2c2c';
  ctx.fillRect(centerX - size / 4, centerY - size * 0.7, 1 * p, 1 * p);
  ctx.fillRect(centerX + size / 4 - 1 * p, centerY - size * 0.7, 1 * p, 1 * p);
}

// Draw pet preview for shop/inventory icons
export function drawPetPreview(ctx: CanvasRenderingContext2D, itemId: string, cx: number, cy: number, p: number, time: number = 0): void {
  // Add bobbing animation for preview
  const bobOffset = Math.sin(time * 0.003) * 2 * p;
  const previewY = cy + bobOffset;
  
  // Draw pet based on type
  if (itemId === 'pet_golden') {
    drawGoldenPet(ctx, cx, previewY, p, time);
  } else if (itemId === 'pet_phoenix') {
    drawPhoenixPet(ctx, cx, previewY, p, time);
  } else if (itemId === 'pet_void') {
    drawVoidPet(ctx, cx, previewY, p, time);
  } else if (itemId === 'pet_celestial') {
    drawCelestialPet(ctx, cx, previewY, p, time);
  } else if (itemId === 'pet_galaxy') {
    drawGalaxyPet(ctx, cx, previewY, p, time);
  } else if (itemId === 'pet_rainbow') {
    drawRainbowPet(ctx, cx, previewY, p, time);
  } else if (itemId === 'pet_godlike_void') {
    drawGodlikeVoidPet(ctx, cx, previewY, p, time);
  } else if (itemId === 'pet_godlike_chaos') {
    drawGodlikeChaosPet(ctx, cx, previewY, p, time);
  } else if (itemId === 'pet_godlike_abyss') {
    drawGodlikeAbyssPet(ctx, cx, previewY, p, time);
  } else if (itemId === 'pet_mini_me') {
    // For preview, draw a simple placeholder (mini me needs player data)
    drawMiniMePetPreview(ctx, cx, previewY, p, time);
  }
}

function drawGodlikeVoidPet(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, time: number): void {
  const centerX = x;
  const centerY = y;
  const size = 10 * p;
  const voidPulse = Math.sin(time * 0.005) * 0.3 + 0.7;
  const voidSwirl = time * 0.004;
  ctx.shadowColor = '#4b0082';
  ctx.shadowBlur = 8 * p;
  
  // Main void orb
  ctx.fillStyle = `rgba(0, 0, 0, ${voidPulse})`;
  ctx.beginPath();
  ctx.arc(centerX, centerY, size, 0, Math.PI * 2);
  ctx.fill();
  
  // Swirling void energy
  for (let i = 0; i < 6; i++) {
    const swirlPhase = voidSwirl + i * 1;
    const swirlX = centerX + Math.cos(swirlPhase) * (size + 2 * p);
    const swirlY = centerY + Math.sin(swirlPhase) * (size + 2 * p);
    ctx.fillStyle = `rgba(75, 0, 130, ${voidPulse})`;
    ctx.beginPath();
    ctx.arc(swirlX, swirlY, 2 * p, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Void portal center
  ctx.strokeStyle = `rgba(148, 0, 211, ${voidPulse})`;
  ctx.lineWidth = 2 * p;
  ctx.beginPath();
  ctx.arc(centerX, centerY, size * 0.5 + Math.sin(voidSwirl) * p, 0, Math.PI * 2);
  ctx.stroke();
}

function drawGodlikeChaosPet(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, time: number): void {
  const centerX = x;
  const centerY = y;
  const size = 10 * p;
  const chaosPulse = Math.sin(time * 0.006) * 0.4 + 0.6;
  const chaosSwirl = time * 0.005;
  ctx.shadowColor = '#8b0000';
  ctx.shadowBlur = 10 * p;
  
  // Main chaos orb
  ctx.fillStyle = `rgba(139, 0, 0, ${chaosPulse})`;
  ctx.beginPath();
  ctx.arc(centerX, centerY, size, 0, Math.PI * 2);
  ctx.fill();
  
  // Chaotic energy swirls
  for (let i = 0; i < 8; i++) {
    const swirlPhase = chaosSwirl + i * 0.8;
    const swirlX = centerX + Math.cos(swirlPhase) * (size + 2 * p);
    const swirlY = centerY + Math.sin(swirlPhase) * (size + 2 * p);
    const swirlColor = i % 2 === 0 ? '#8b0000' : '#4b0082';
    ctx.fillStyle = `rgba(${swirlColor === '#8b0000' ? '139, 0, 0' : '75, 0, 130'}, ${chaosPulse})`;
    ctx.beginPath();
    ctx.arc(swirlX, swirlY, 2.5 * p, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGodlikeAbyssPet(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, time: number): void {
  const centerX = x;
  const centerY = y;
  const size = 10 * p;
  const abyssPulse = Math.sin(time * 0.004) * 0.3 + 0.7;
  const abyssDepth = time * 0.003;
  ctx.shadowColor = '#800080';
  ctx.shadowBlur = 12 * p;
  
  // Main abyssal orb
  ctx.fillStyle = `rgba(0, 0, 0, ${abyssPulse})`;
  ctx.beginPath();
  ctx.arc(centerX, centerY, size, 0, Math.PI * 2);
  ctx.fill();
  
  // Deep abyssal portal layers
  for (let i = 0; i < 3; i++) {
    const ringPhase = abyssDepth + i * 0.5;
    const ringSize = size * 0.3 + i * 2 * p + Math.sin(ringPhase) * p;
    ctx.strokeStyle = `rgba(75, 0, 130, ${abyssPulse * (1 - i * 0.25)})`;
    ctx.lineWidth = 2 * p;
    ctx.beginPath();
    ctx.arc(centerX, centerY, ringSize, 0, Math.PI * 2);
    ctx.stroke();
  }
  
  // Abyssal energy tendrils
  for (let i = 0; i < 4; i++) {
    const tendrilPhase = abyssDepth + i * 1.5;
    const tendrilX = centerX + Math.sin(tendrilPhase) * (size + 3 * p);
    const tendrilY = centerY + Math.cos(tendrilPhase * 0.7) * (size + 3 * p);
    ctx.fillStyle = `rgba(128, 0, 128, ${abyssPulse * 0.8})`;
    ctx.beginPath();
    ctx.arc(tendrilX, tendrilY, 3 * p, 0, Math.PI * 2);
    ctx.fill();
  }
}
