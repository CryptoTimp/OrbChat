import { useRef, useEffect } from 'react';
import { drawPlayer, drawOrb, drawFloatingTexts, spawnFloatingText, spawnOrbCollectionParticles, drawGoldenPet, drawPhoenixPet, drawVoidPet, drawCelestialPet, drawGalaxyPet, drawRainbowPet } from '../game/renderer';
import { checkOrbCollision } from '../game/Player';
import { PlayerWithChat, GAME_CONSTANTS, Orb, OrbType } from '../types';

const { SCALE, ORB_SIZE, PLAYER_WIDTH, PLAYER_HEIGHT } = GAME_CONSTANTS;

// Legendary items for NPCs to wear
const LEGENDARY_ITEMS = {
  hats: ['hat_golden', 'hat_phoenix_legendary', 'hat_void', 'hat_celestial', 'hat_galaxy', 'hat_rainbow'],
  shirts: ['armor_golden', 'robe_phoenix_legendary', 'armor_void', 'robe_celestial', 'armor_galaxy', 'robe_rainbow'],
  legs: ['legs_gold', 'legs_phoenix_legendary', 'legs_void', 'legs_celestial', 'legs_galaxy', 'legs_rainbow'],
  capes: ['cape_phoenix', 'cape_void', 'cape_celestial', 'cape_galaxy', 'cape_rainbow'],
  accessories: [
    // Wings
    'acc_wings_dragon', 'acc_wings_golden', 'acc_wings_phoenix', 'acc_wings_void', 
    'acc_wings_celestial', 'acc_wings_galaxy', 'acc_wings_rainbow',
    // Auras
    'acc_aura_fire', 'acc_aura_ice', 'acc_aura_golden', 'acc_aura_phoenix', 
    'acc_aura_void', 'acc_aura_celestial', 'acc_aura_galaxy', 'acc_aura_rainbow',
    // Weapons
    'acc_weapon_golden', 'acc_weapon_phoenix', 'acc_weapon_void', 
    'acc_weapon_celestial', 'acc_weapon_galaxy', 'acc_weapon_rainbow',
  ],
};

// All available pets
const ALL_PETS = ['pet_golden', 'pet_phoenix', 'pet_void', 'pet_celestial', 'pet_galaxy', 'pet_rainbow'];
const PET_OFFSET_X = -25; // Distance to the left of player (in unscaled pixels) - same as player pets
const PET_OFFSET_Y = 0; // Vertical offset from player center (in unscaled pixels) - same as player pets
const PET_BOBBING_AMPLITUDE = 2; // Vertical bobbing amplitude (in scaled pixels)

// NPC names
const NPC_NAMES = [
  'Aether', 'Nova', 'Zephyr', 'Orion', 'Luna', 'Stella', 'Phoenix', 'Vortex',
  'Celestia', 'Nebula', 'Aurora', 'Cosmos', 'Eclipse', 'Solaris', 'Atlas', 'Meridian'
];

interface NPC {
  id: string;
  name: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  direction: 'up' | 'down' | 'left' | 'right';
  outfit: string[];
  speed: number;
  changeDirectionTime: number;
  orbTarget: Orb | null; // Current orb the NPC is targeting
  orbs: number; // NPC's orb balance
  petId: string | null; // Pet assigned to this NPC (50% chance)
}

function createRandomNPC(id: string, canvasWidth: number, canvasHeight: number, time: number): NPC {
  // Random legendary outfit
  const hat = LEGENDARY_ITEMS.hats[Math.floor(Math.random() * LEGENDARY_ITEMS.hats.length)];
  const shirt = LEGENDARY_ITEMS.shirts[Math.floor(Math.random() * LEGENDARY_ITEMS.shirts.length)];
  const legs = LEGENDARY_ITEMS.legs[Math.floor(Math.random() * LEGENDARY_ITEMS.legs.length)];
  const cape = Math.random() > 0.5 ? LEGENDARY_ITEMS.capes[Math.floor(Math.random() * LEGENDARY_ITEMS.capes.length)] : null;
  const accessory = Math.random() > 0.3 ? LEGENDARY_ITEMS.accessories[Math.floor(Math.random() * LEGENDARY_ITEMS.accessories.length)] : null;
  
  const outfit = [
    hat,
    shirt,
    legs,
    ...(cape ? [cape] : []),
    ...(accessory ? [accessory] : []),
  ];

  const x = Math.random() * (canvasWidth / SCALE);
  const y = Math.random() * (canvasHeight / SCALE);
  
  // Random orb balance between 300k and 1.2m
  const orbs = 300000 + Math.random() * 900000; // 300k to 1.2m
  
  // 50% chance to have a pet
  const hasPet = Math.random() > 0.5;
  const petId = hasPet ? ALL_PETS[Math.floor(Math.random() * ALL_PETS.length)] : null;
  
  return {
    id,
    name: NPC_NAMES[Math.floor(Math.random() * NPC_NAMES.length)],
    x,
    y,
    targetX: x,
    targetY: y,
    direction: 'down',
    outfit,
    speed: 0.5 + Math.random() * 0.5, // 0.5 to 1.0 speed
    changeDirectionTime: time + 2000 + Math.random() * 3000, // Change direction every 2-5 seconds
    orbTarget: null,
    orbs: Math.floor(orbs), // Round to whole number
    petId,
  };
}

// Orb values by type
const ORB_VALUES: Record<OrbType, number> = {
  'common': 10,
  'uncommon': 20,
  'rare': 40,
  'epic': 80,
  'legendary': 150,
  'normal': 10,
  'gold': 20,
  'shrine': 0, // Shrine orbs use their own value system
};

// Create a random orb
function createRandomOrb(canvasWidth: number, canvasHeight: number): Orb {
  const orbTypes: OrbType[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  const weights = [0.4, 0.3, 0.15, 0.1, 0.05]; // Probability weights
  let rand = Math.random();
  let orbType: OrbType = 'common';
  for (let i = 0; i < weights.length; i++) {
    rand -= weights[i];
    if (rand <= 0) {
      orbType = orbTypes[i];
      break;
    }
  }
  
  return {
    id: `orb_${Date.now()}_${Math.random()}`,
    x: Math.random() * (canvasWidth / SCALE - ORB_SIZE),
    y: Math.random() * (canvasHeight / SCALE - ORB_SIZE),
    value: ORB_VALUES[orbType],
    orbType,
  };
}

export function BackgroundNPCs() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const npcsRef = useRef<NPC[]>([]);
  const orbsRef = useRef<Orb[]>([]);
  const animationFrameRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      // Respawn orbs if canvas resized
      orbsRef.current = Array.from({ length: 15 }, () => 
        createRandomOrb(canvas.width, canvas.height)
      );
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Create NPCs
    const npcCount = 8;
    const startTime = Date.now();
    npcsRef.current = Array.from({ length: npcCount }, (_, i) => 
      createRandomNPC(`npc_${i}`, canvas.width, canvas.height, startTime)
    );

    // Create initial orbs
    orbsRef.current = Array.from({ length: 15 }, () => 
      createRandomOrb(canvas.width, canvas.height)
    );

    let lastTime = startTime;
    let lastOrbSpawn = startTime;

    const animate = () => {
      const currentTime = Date.now();
      const deltaTime = currentTime - lastTime;
      lastTime = currentTime;

      // Spawn new orbs periodically
      if (currentTime - lastOrbSpawn > 3000 && orbsRef.current.length < 20) {
        orbsRef.current.push(createRandomOrb(canvas.width, canvas.height));
        lastOrbSpawn = currentTime;
      }

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw orbs first (behind NPCs)
      orbsRef.current.forEach((orb) => {
        drawOrb(ctx, orb, currentTime);
      });

      // Update and draw NPCs
      npcsRef.current.forEach((npc) => {
        // Check for nearby orbs to collect
        const ORB_DETECTION_RANGE = 150; // pixels
        let nearestOrb: Orb | null = null;
        let nearestDistance = Infinity;

        for (const orb of orbsRef.current) {
          const dx = orb.x - npc.x;
          const dy = orb.y - npc.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance < ORB_DETECTION_RANGE && distance < nearestDistance) {
            nearestOrb = orb;
            nearestDistance = distance;
          }
        }

        // If we found a nearby orb and don't have a target, or found a closer one, target it
        if (nearestOrb && (!npc.orbTarget || nearestDistance < Math.sqrt(
          Math.pow(npc.orbTarget.x - npc.x, 2) + Math.pow(npc.orbTarget.y - npc.y, 2)
        ))) {
          npc.orbTarget = nearestOrb;
          npc.targetX = nearestOrb.x;
          npc.targetY = nearestOrb.y;
        }

        // If we have an orb target, move towards it
        if (npc.orbTarget) {
          const dx = npc.orbTarget.x - npc.x;
          const dy = npc.orbTarget.y - npc.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          // Check collision
          if (checkOrbCollision(npc.x, npc.y, npc.orbTarget.x, npc.orbTarget.y)) {
            // Collect orb!
            const orbValue = npc.orbTarget.value;
            const orbType = npc.orbTarget.orbType || 'common';
            
            // Update NPC's orb balance
            npc.orbs += orbValue;
            
            // Spawn collection particles
            const orbCenterX = (npc.orbTarget.x + ORB_SIZE / 2) * SCALE;
            const orbCenterY = (npc.orbTarget.y + ORB_SIZE / 2) * SCALE;
            spawnOrbCollectionParticles(orbCenterX, orbCenterY, orbType);
            
            // Spawn floating text above NPC head (smaller scale for background)
            const npcHeadX = npc.x * SCALE + (GAME_CONSTANTS.PLAYER_WIDTH / 2) * SCALE;
            const npcHeadY = npc.y * SCALE - 10;
            spawnFloatingText(npcHeadX, npcHeadY, orbValue, orbType, 0.6); // 60% size for background
            
            // Remove orb
            orbsRef.current = orbsRef.current.filter(o => o.id !== npc.orbTarget!.id);
            npc.orbTarget = null;
            
            // Pick new random target
            npc.changeDirectionTime = currentTime;
          } else if (distance > 2) {
            // Move towards orb
            const moveX = (dx / distance) * npc.speed * (deltaTime / 16);
            const moveY = (dy / distance) * npc.speed * (deltaTime / 16);
            
            npc.x += moveX;
            npc.y += moveY;
            
            // Determine direction
            if (Math.abs(dx) > Math.abs(dy)) {
              npc.direction = dx > 0 ? 'right' : 'left';
            } else {
              npc.direction = dy > 0 ? 'down' : 'up';
            }
          } else {
            // Very close but not colliding, try again next frame
            npc.orbTarget = null;
            npc.changeDirectionTime = currentTime;
          }
        } else {
          // No orb target, random walk
          // Check if it's time to change direction
          if (currentTime >= npc.changeDirectionTime) {
            // Pick a new random target
            const angle = Math.random() * Math.PI * 2;
            const distance = 100 + Math.random() * 200; // 100-300 pixels
            npc.targetX = npc.x + Math.cos(angle) * distance;
            npc.targetY = npc.y + Math.sin(angle) * distance;
            
            // Clamp to canvas bounds
            npc.targetX = Math.max(0, Math.min(canvas.width / SCALE, npc.targetX));
            npc.targetY = Math.max(0, Math.min(canvas.height / SCALE, npc.targetY));
            
            // Determine direction
            const dx = npc.targetX - npc.x;
            const dy = npc.targetY - npc.y;
            
            if (Math.abs(dx) > Math.abs(dy)) {
              npc.direction = dx > 0 ? 'right' : 'left';
            } else {
              npc.direction = dy > 0 ? 'down' : 'up';
            }
            
            npc.changeDirectionTime = currentTime + 2000 + Math.random() * 3000;
          }

          // Move towards target
          const dx = npc.targetX - npc.x;
          const dy = npc.targetY - npc.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance > 2) {
            // Move towards target
            const moveX = (dx / distance) * npc.speed * (deltaTime / 16); // Normalize to 60fps
            const moveY = (dy / distance) * npc.speed * (deltaTime / 16);
            
            npc.x += moveX;
            npc.y += moveY;
          } else {
            // Reached target, pick new one
            npc.changeDirectionTime = currentTime;
          }
        }

        // Create player object for rendering
        const player: PlayerWithChat = {
          id: npc.id,
          name: npc.name,
          x: npc.x,
          y: npc.y,
          direction: npc.direction,
          orbs: npc.orbs, // Use NPC's actual orb balance
          roomId: '',
          sprite: {
            body: 'default',
            outfit: npc.outfit,
          },
        };

        // Draw NPC
        ctx.save();
        drawPlayer(ctx, player, false, currentTime);
        ctx.restore();
        
        // Draw pet if NPC has one (same distance as player pets)
        if (npc.petId) {
          // Use same calculation as player pets: position relative to NPC's top-left coordinates
          const petX = npc.x + PET_OFFSET_X;
          const petY = npc.y + PET_OFFSET_Y;
          
          // Draw the pet with bobbing animation
          const petScaledX = petX * SCALE;
          const petScaledY = petY * SCALE;
          const bobOffset = Math.sin(currentTime * 0.003) * PET_BOBBING_AMPLITUDE * SCALE;
          const finalY = petScaledY + bobOffset;
          
          ctx.save();
          ctx.imageSmoothingEnabled = false;
          
          // Draw pet based on type
          if (npc.petId === 'pet_golden') {
            drawGoldenPet(ctx, petScaledX, finalY, SCALE, currentTime);
          } else if (npc.petId === 'pet_phoenix') {
            drawPhoenixPet(ctx, petScaledX, finalY, SCALE, currentTime);
          } else if (npc.petId === 'pet_void') {
            drawVoidPet(ctx, petScaledX, finalY, SCALE, currentTime);
          } else if (npc.petId === 'pet_celestial') {
            drawCelestialPet(ctx, petScaledX, finalY, SCALE, currentTime);
          } else if (npc.petId === 'pet_galaxy') {
            drawGalaxyPet(ctx, petScaledX, finalY, SCALE, currentTime);
          } else if (npc.petId === 'pet_rainbow') {
            drawRainbowPet(ctx, petScaledX, finalY, SCALE, currentTime);
          }
          
          ctx.restore();
        }
      });

      // Draw floating texts (from orb collections)
      drawFloatingTexts(ctx);

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 0, imageRendering: 'pixelated' }}
    />
  );
}
