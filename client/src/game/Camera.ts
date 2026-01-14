import { GAME_CONSTANTS, CANVAS_WIDTH, CANVAS_HEIGHT, WORLD_WIDTH, WORLD_HEIGHT } from '../types';

const { MIN_ZOOM, MAX_ZOOM, DEFAULT_ZOOM, SCALE } = GAME_CONSTANTS;

export interface Camera {
  x: number;      // Camera position (top-left corner in world coords)
  y: number;
  zoom: number;   // Zoom level (1.0 = normal)
  targetX: number; // Smooth follow target
  targetY: number;
}

// Create a new camera centered at origin
export function createCamera(): Camera {
  return {
    x: 0,
    y: 0,
    zoom: DEFAULT_ZOOM,
    targetX: 0,
    targetY: 0,
  };
}

// Update camera to follow a target position (typically the player)
export function updateCamera(camera: Camera, targetWorldX: number, targetWorldY: number, deltaTime: number): void {
  // Scale target position
  const scaledTargetX = targetWorldX * SCALE;
  const scaledTargetY = targetWorldY * SCALE;
  
  // Calculate viewport size at current zoom
  const viewportWidth = CANVAS_WIDTH / camera.zoom;
  const viewportHeight = CANVAS_HEIGHT / camera.zoom;
  
  // Center camera on target
  camera.targetX = scaledTargetX - viewportWidth / 2;
  camera.targetY = scaledTargetY - viewportHeight / 2;
  
  // Clamp target to world bounds
  camera.targetX = Math.max(0, Math.min(camera.targetX, WORLD_WIDTH - viewportWidth));
  camera.targetY = Math.max(0, Math.min(camera.targetY, WORLD_HEIGHT - viewportHeight));
  
  // Smooth follow (lerp towards target)
  const smoothing = 0.1; // Lower = smoother, higher = snappier
  camera.x += (camera.targetX - camera.x) * smoothing;
  camera.y += (camera.targetY - camera.y) * smoothing;
  
  // Clamp final position
  camera.x = Math.max(0, Math.min(camera.x, WORLD_WIDTH - viewportWidth));
  camera.y = Math.max(0, Math.min(camera.y, WORLD_HEIGHT - viewportHeight));
}

// Adjust zoom level
export function setZoom(camera: Camera, newZoom: number): void {
  // Get center point before zoom
  const viewportWidth = CANVAS_WIDTH / camera.zoom;
  const viewportHeight = CANVAS_HEIGHT / camera.zoom;
  const centerX = camera.x + viewportWidth / 2;
  const centerY = camera.y + viewportHeight / 2;
  
  // Apply new zoom (clamped)
  camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
  
  // Recalculate position to keep same center point
  const newViewportWidth = CANVAS_WIDTH / camera.zoom;
  const newViewportHeight = CANVAS_HEIGHT / camera.zoom;
  camera.x = centerX - newViewportWidth / 2;
  camera.y = centerY - newViewportHeight / 2;
  camera.targetX = camera.x;
  camera.targetY = camera.y;
  
  // Clamp to bounds
  camera.x = Math.max(0, Math.min(camera.x, WORLD_WIDTH - newViewportWidth));
  camera.y = Math.max(0, Math.min(camera.y, WORLD_HEIGHT - newViewportHeight));
}

// Zoom in/out by a delta amount
export function adjustZoom(camera: Camera, delta: number): void {
  setZoom(camera, camera.zoom + delta);
}

// Convert world coordinates to screen coordinates
export function worldToScreen(camera: Camera, worldX: number, worldY: number): { x: number; y: number } {
  return {
    x: (worldX * SCALE - camera.x) * camera.zoom,
    y: (worldY * SCALE - camera.y) * camera.zoom,
  };
}

// Convert screen coordinates to world coordinates
export function screenToWorld(camera: Camera, screenX: number, screenY: number): { x: number; y: number } {
  return {
    x: (screenX / camera.zoom + camera.x) / SCALE,
    y: (screenY / camera.zoom + camera.y) / SCALE,
  };
}

// Check if a world position is visible on screen
export function isVisible(camera: Camera, worldX: number, worldY: number, width: number, height: number): boolean {
  const screenPos = worldToScreen(camera, worldX, worldY);
  const scaledWidth = width * SCALE * camera.zoom;
  const scaledHeight = height * SCALE * camera.zoom;
  
  return (
    screenPos.x + scaledWidth > 0 &&
    screenPos.x < CANVAS_WIDTH &&
    screenPos.y + scaledHeight > 0 &&
    screenPos.y < CANVAS_HEIGHT
  );
}

// Get the visible world bounds
export function getVisibleBounds(camera: Camera): { x: number; y: number; width: number; height: number } {
  const viewportWidth = CANVAS_WIDTH / camera.zoom;
  const viewportHeight = CANVAS_HEIGHT / camera.zoom;
  
  return {
    x: camera.x / SCALE,
    y: camera.y / SCALE,
    width: viewportWidth / SCALE,
    height: viewportHeight / SCALE,
  };
}
