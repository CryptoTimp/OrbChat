import { PlayerWithChat, Direction, GAME_CONSTANTS, MapType } from '../types';
import { checkTreeCollision } from './renderer';

const { TILE_SIZE, MAP_WIDTH, MAP_HEIGHT, PLAYER_WIDTH, PLAYER_HEIGHT, MOVEMENT_SPEED, SCALE } = GAME_CONSTANTS;

export interface InterpolatedPlayer extends PlayerWithChat {
  targetX: number;
  targetY: number;
  renderX: number;
  renderY: number;
}

export function createInterpolatedPlayer(player: PlayerWithChat): InterpolatedPlayer {
  return {
    ...player,
    targetX: player.x,
    targetY: player.y,
    renderX: player.x,
    renderY: player.y,
  };
}

export function updateInterpolation(player: InterpolatedPlayer, deltaTime: number): void {
  const interpolationSpeed = 0.15;
  
  player.renderX += (player.targetX - player.renderX) * interpolationSpeed;
  player.renderY += (player.targetY - player.renderY) * interpolationSpeed;
  
  // Snap if very close
  if (Math.abs(player.targetX - player.renderX) < 0.5) {
    player.renderX = player.targetX;
  }
  if (Math.abs(player.targetY - player.renderY) < 0.5) {
    player.renderY = player.targetY;
  }
}

export function setTargetPosition(player: InterpolatedPlayer, x: number, y: number, direction: Direction): void {
  player.targetX = x;
  player.targetY = y;
  player.x = x;
  player.y = y;
  player.direction = direction;
}

export function calculateMovement(
  currentX: number,
  currentY: number,
  keys: { up: boolean; down: boolean; left: boolean; right: boolean },
  deltaTime: number,
  speedMultiplier: number = 1.0,
  mapType: MapType = 'cafe',
  clickTarget: { x: number; y: number } | null = null,
  treeStates?: Map<string, { treeId: string; isCut: boolean; cutBy: string | null; respawnAt: number }>
): { x: number; y: number; direction: Direction | null; moved: boolean } {
  let dx = 0;
  let dy = 0;
  let direction: Direction | null = null;
  
  // Use fixed timestep for consistent movement regardless of frame rate
  // This ensures smooth movement even when frame rate drops in busy areas
  // Target 60 FPS = 16.67ms per frame
  const FIXED_DELTA_TIME = 16.67; // ms
  const deltaSeconds = FIXED_DELTA_TIME / 1000;
  
  // Base movement speed in pixels per second - reduced by 75% for slower base movement
  // At 2.5x multiplier (Phantom Velocity), this gives 300 pixels/second = fast running speed
  const BASE_SPEED_PPS = 120; // pixels per second (75% reduction from 480, keeping 25%)
  
  // Apply speed multiplier with fixed timestep for consistent movement
  // Movement is now completely independent of actual frame rate
  const adjustedSpeed = BASE_SPEED_PPS * speedMultiplier * deltaSeconds;
  
  // Check if any key is pressed (keyboard takes priority)
  const anyKeyPressed = keys.up || keys.down || keys.left || keys.right;
  
  if (anyKeyPressed) {
    // Keyboard movement (priority)
    if (keys.up) {
      dy -= adjustedSpeed;
      direction = 'up';
    }
    if (keys.down) {
      dy += adjustedSpeed;
      direction = 'down';
    }
    if (keys.left) {
      dx -= adjustedSpeed;
      direction = 'left';
    }
    if (keys.right) {
      dx += adjustedSpeed;
      direction = 'right';
    }
    
    // Normalize diagonal movement
    if (dx !== 0 && dy !== 0) {
      const factor = 1 / Math.sqrt(2);
      dx *= factor;
      dy *= factor;
    }
  } else if (clickTarget) {
    // Click-to-move: move towards target
    const targetX = clickTarget.x;
    const targetY = clickTarget.y;
    
    // Calculate distance to target
    const dxToTarget = targetX - currentX;
    const dyToTarget = targetY - currentY;
    const distanceToTarget = Math.sqrt(dxToTarget * dxToTarget + dyToTarget * dyToTarget);
    
    // If we're close enough, stop moving (within 2 pixels)
    if (distanceToTarget < 2) {
      return { x: currentX, y: currentY, direction: null, moved: false };
    }
    
    // Normalize direction and apply speed
    const normalizedDx = dxToTarget / distanceToTarget;
    const normalizedDy = dyToTarget / distanceToTarget;
    
    dx = normalizedDx * adjustedSpeed;
    dy = normalizedDy * adjustedSpeed;
    
    // Determine direction based on movement
    if (Math.abs(dx) > Math.abs(dy)) {
      direction = dx > 0 ? 'right' : 'left';
    } else {
      direction = dy > 0 ? 'down' : 'up';
    }
  }
  
  // Calculate new position with bounds
  const maxX = TILE_SIZE * MAP_WIDTH - PLAYER_WIDTH;
  const maxY = TILE_SIZE * MAP_HEIGHT - PLAYER_HEIGHT;
  
  let newX = Math.max(0, Math.min(currentX + dx, maxX));
  let newY = Math.max(0, Math.min(currentY + dy, maxY));
  
  // Check tree collision in forest map (convert to pixel coords for collision check)
  if (mapType === 'forest') {
    const pixelX = newX * SCALE;
    const pixelY = newY * SCALE;
    const pixelW = PLAYER_WIDTH * SCALE;
    const pixelH = PLAYER_HEIGHT * SCALE;
    
    if (checkTreeCollision(pixelX, pixelY, pixelW, pixelH, treeStates)) {
      // Try moving only in X
      const testX = currentX + dx;
      const testPixelX = testX * SCALE;
      if (!checkTreeCollision(testPixelX, currentY * SCALE, pixelW, pixelH, treeStates)) {
        newX = Math.max(0, Math.min(testX, maxX));
        newY = currentY;
      }
      // Try moving only in Y
      else {
        const testY = currentY + dy;
        const testPixelY = testY * SCALE;
        if (!checkTreeCollision(currentX * SCALE, testPixelY, pixelW, pixelH, treeStates)) {
          newX = currentX;
          newY = Math.max(0, Math.min(testY, maxY));
        }
        // Can't move at all
        else {
          newX = currentX;
          newY = currentY;
        }
      }
    }
  }
  
  const moved = newX !== currentX || newY !== currentY;
  
  return { x: newX, y: newY, direction, moved };
}

export function checkOrbCollision(
  playerX: number,
  playerY: number,
  orbX: number,
  orbY: number
): boolean {
  const playerCenterX = playerX + PLAYER_WIDTH / 2;
  const playerCenterY = playerY + PLAYER_HEIGHT / 2;
  const orbCenterX = orbX + GAME_CONSTANTS.ORB_SIZE / 2;
  const orbCenterY = orbY + GAME_CONSTANTS.ORB_SIZE / 2;
  
  const dx = playerCenterX - orbCenterX;
  const dy = playerCenterY - orbCenterY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  return distance < GAME_CONSTANTS.COLLECTION_RADIUS;
}
