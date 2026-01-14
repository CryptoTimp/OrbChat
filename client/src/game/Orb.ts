import { Orb } from '../types';

export interface AnimatedOrb extends Orb {
  spawnTime: number;
}

export function createAnimatedOrb(orb: Orb): AnimatedOrb {
  return {
    ...orb,
    spawnTime: Date.now(),
  };
}

export function getOrbAnimation(orb: AnimatedOrb, currentTime: number): {
  scale: number;
  yOffset: number;
  glowIntensity: number;
} {
  const elapsed = currentTime - orb.spawnTime;
  
  // Pulsing scale
  const scale = 1 + Math.sin(elapsed / 300) * 0.15;
  
  // Floating y offset
  const yOffset = Math.sin(elapsed / 500) * 2;
  
  // Glow intensity
  const glowIntensity = 0.5 + Math.sin(elapsed / 400) * 0.3;
  
  return { scale, yOffset, glowIntensity };
}
