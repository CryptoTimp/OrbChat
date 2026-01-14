import { useEffect, useRef } from 'react';
import { ShopItem } from '../types';
import { drawPetPreview } from '../game/renderer';

interface ItemPreviewProps {
  item: ShopItem;
  size?: number;
}

export function ItemPreview({ item, size = 48 }: ItemPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    let time = Date.now();
    
    const animate = () => {
      // Clear canvas
      ctx.clearRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = false;
      
      const p = size / 24; // Scale factor
      const centerX = size / 2;
      const centerY = size / 2;
      
      const currentTime = Date.now();
      const deltaTime = currentTime - time;
      time = currentTime;
      
      // Draw item based on type
      if (item.spriteLayer === 'hat') {
        drawHatPreview(ctx, item.id, centerX, centerY, p, currentTime);
      } else if (item.spriteLayer === 'shirt') {
        drawShirtPreview(ctx, item.id, centerX, centerY, p, currentTime);
      } else if (item.spriteLayer === 'legs') {
        drawLegsPreview(ctx, item.id, centerX, centerY, p, currentTime);
      } else if (item.spriteLayer === 'cape') {
        drawCapePreview(ctx, item.id, centerX, centerY, p, currentTime);
      } else if (item.spriteLayer === 'wings') {
        drawWingsPreview(ctx, item.id, centerX, centerY, p, currentTime);
      } else if (item.spriteLayer === 'accessory') {
        // Check if it's a tool (starts with 'tool_')
        if (item.id.startsWith('tool_')) {
          drawToolPreview(ctx, item.id, centerX, centerY, p, currentTime);
        } else {
          drawAccessoryPreview(ctx, item.id, centerX, centerY, p, currentTime);
        }
      } else if (item.spriteLayer === 'boost') {
        drawBoostPreview(ctx, item.id, centerX, centerY, p, item.rarity, item, currentTime);
      } else if (item.spriteLayer === 'pet') {
        drawPetPreview(ctx, item.id, centerX, centerY, p, currentTime);
      }
      
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    
    animate();
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [item, size]);
  
  return (
    <canvas 
      ref={canvasRef} 
      width={size} 
      height={size}
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

function drawHatPreview(ctx: CanvasRenderingContext2D, itemId: string, cx: number, cy: number, p: number, time: number = 0): void {
  switch (itemId) {
    case 'hat_cowboy':
      ctx.fillStyle = '#8b4513';
      ctx.fillRect(cx - 10 * p, cy - 2 * p, 20 * p, 4 * p);
      ctx.fillRect(cx - 6 * p, cy - 8 * p, 12 * p, 6 * p);
      ctx.fillStyle = '#a0522d';
      ctx.fillRect(cx - 5 * p, cy - 6 * p, 10 * p, 2 * p);
      break;
      
    case 'hat_beanie':
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(cx - 7 * p, cy - 4 * p, 14 * p, 10 * p);
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(cx - 7 * p, cy - 4 * p, 14 * p, 2 * p);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 7 * p, cy + 4 * p, 14 * p, 2 * p);
      break;
      
    case 'hat_cap':
      ctx.fillStyle = '#3498db';
      ctx.fillRect(cx - 7 * p, cy - 2 * p, 14 * p, 6 * p);
      ctx.fillRect(cx - 12 * p, cy + p, 8 * p, 3 * p);
      ctx.fillStyle = '#2980b9';
      ctx.fillRect(cx - 6 * p, cy - p, 12 * p, 2 * p);
      break;
      
    case 'hat_beret':
      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 10 * p, 6 * p, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#a93226';
      ctx.beginPath();
      ctx.ellipse(cx + 4 * p, cy - 2 * p, 4 * p, 3 * p, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
      
    case 'hat_wizard':
      ctx.fillStyle = '#9b59b6';
      ctx.fillRect(cx - 8 * p, cy + 2 * p, 16 * p, 4 * p);
      ctx.beginPath();
      ctx.moveTo(cx, cy - 10 * p);
      ctx.lineTo(cx - 8 * p, cy + 2 * p);
      ctx.lineTo(cx + 8 * p, cy + 2 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f1c40f';
      ctx.beginPath();
      ctx.arc(cx, cy - 4 * p, 2 * p, 0, Math.PI * 2);
      ctx.fill();
      // Stars
      ctx.fillRect(cx - 4 * p, cy - 2 * p, 2 * p, 2 * p);
      ctx.fillRect(cx + 3 * p, cy - 5 * p, 2 * p, 2 * p);
      break;
      
    case 'hat_crown':
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(cx - 7 * p, cy, 14 * p, 6 * p);
      ctx.fillRect(cx - 6 * p, cy - 4 * p, 3 * p, 4 * p);
      ctx.fillRect(cx - p, cy - 6 * p, 3 * p, 6 * p);
      ctx.fillRect(cx + 4 * p, cy - 4 * p, 3 * p, 4 * p);
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(cx - 5 * p, cy + 2 * p, 2 * p, 2 * p);
      ctx.fillStyle = '#3498db';
      ctx.fillRect(cx + 4 * p, cy + 2 * p, 2 * p, 2 * p);
      ctx.fillStyle = '#2ecc71';
      ctx.fillRect(cx, cy - 3 * p, 2 * p, 2 * p);
      break;
      
    case 'hat_halo':
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 3 * p;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 10 * p, 4 * p, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 215, 0, 0.3)';
      ctx.fill();
      break;
      
    case 'hat_horns':
      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.moveTo(cx - 8 * p, cy + 4 * p);
      ctx.lineTo(cx - 10 * p, cy - 8 * p);
      ctx.lineTo(cx - 3 * p, cy + 2 * p);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 8 * p, cy + 4 * p);
      ctx.lineTo(cx + 10 * p, cy - 8 * p);
      ctx.lineTo(cx + 3 * p, cy + 2 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#922b21';
      ctx.fillRect(cx - 6 * p, cy + 2 * p, 12 * p, 4 * p);
      break;
      
    case 'hat_tiara':
      ctx.fillStyle = '#c0c0c0';
      ctx.fillRect(cx - 8 * p, cy + p, 16 * p, 4 * p);
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(cx - 2 * p, cy - 6 * p, 4 * p, 7 * p);
      ctx.fillRect(cx - 6 * p, cy - 3 * p, 3 * p, 4 * p);
      ctx.fillRect(cx + 4 * p, cy - 3 * p, 3 * p, 4 * p);
      ctx.fillStyle = '#ff69b4';
      ctx.fillRect(cx - p, cy - 4 * p, 2 * p, 2 * p);
      break;
      
    case 'hat_chef':
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 7 * p, cy + 2 * p, 14 * p, 4 * p);
      ctx.beginPath();
      ctx.arc(cx - 4 * p, cy - 2 * p, 5 * p, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + 4 * p, cy - 2 * p, 5 * p, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy - 4 * p, 6 * p, 0, Math.PI * 2);
      ctx.fill();
      break;
      
    case 'hat_tophat':
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(cx - 10 * p, cy + 2 * p, 20 * p, 4 * p);
      ctx.fillRect(cx - 6 * p, cy - 8 * p, 12 * p, 10 * p);
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(cx - 6 * p, cy - 2 * p, 12 * p, 2 * p);
      break;
      
    case 'hat_hardhat':
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(cx - 9 * p, cy + p, 18 * p, 4 * p);
      ctx.beginPath();
      ctx.arc(cx, cy, 8 * p, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#e67e22';
      ctx.fillRect(cx - 6 * p, cy - 2 * p, 12 * p, 2 * p);
      break;
      
    case 'hat_pirate':
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(cx - 9 * p, cy + p, 18 * p, 4 * p);
      ctx.beginPath();
      ctx.moveTo(cx - 10 * p, cy + p);
      ctx.lineTo(cx, cy - 8 * p);
      ctx.lineTo(cx + 10 * p, cy + p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 2 * p, cy - 4 * p, 4 * p, 4 * p);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(cx - p, cy - 3 * p, 2 * p, 2 * p);
      break;
      
    case 'hat_viking':
      ctx.fillStyle = '#8b4513';
      ctx.fillRect(cx - 8 * p, cy - 2 * p, 16 * p, 8 * p);
      ctx.fillStyle = '#ecf0f1';
      ctx.beginPath();
      ctx.moveTo(cx - 10 * p, cy + 2 * p);
      ctx.lineTo(cx - 12 * p, cy - 10 * p);
      ctx.lineTo(cx - 6 * p, cy - 2 * p);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 10 * p, cy + 2 * p);
      ctx.lineTo(cx + 12 * p, cy - 10 * p);
      ctx.lineTo(cx + 6 * p, cy - 2 * p);
      ctx.closePath();
      ctx.fill();
      break;
      
    case 'hat_ninja':
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(cx - 8 * p, cy - 2 * p, 16 * p, 6 * p);
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(cx + 6 * p, cy, 8 * p, 2 * p);
      ctx.fillRect(cx + 10 * p, cy - 2 * p, 2 * p, 6 * p);
      break;
      
    case 'hat_knight':
      ctx.fillStyle = '#7f8c8d';
      ctx.fillRect(cx - 7 * p, cy - 4 * p, 14 * p, 10 * p);
      ctx.fillStyle = '#bdc3c7';
      ctx.fillRect(cx - 5 * p, cy + 2 * p, 10 * p, 2 * p);
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(cx - p, cy - 8 * p, 3 * p, 6 * p);
      break;
      
    case 'hat_astronaut':
      ctx.fillStyle = '#ecf0f1';
      ctx.beginPath();
      ctx.arc(cx, cy, 10 * p, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3498db';
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 7 * p, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#bdc3c7';
      ctx.lineWidth = 2 * p;
      ctx.beginPath();
      ctx.arc(cx, cy, 10 * p, 0, Math.PI * 2);
      ctx.stroke();
      break;
      
    case 'hat_cat':
      ctx.fillStyle = '#e91e63';
      ctx.beginPath();
      ctx.moveTo(cx - 8 * p, cy + 4 * p);
      ctx.lineTo(cx - 10 * p, cy - 8 * p);
      ctx.lineTo(cx - 2 * p, cy);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 8 * p, cy + 4 * p);
      ctx.lineTo(cx + 10 * p, cy - 8 * p);
      ctx.lineTo(cx + 2 * p, cy);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ff69b4';
      ctx.fillRect(cx - 7 * p, cy - 4 * p, 3 * p, 3 * p);
      ctx.fillRect(cx + 5 * p, cy - 4 * p, 3 * p, 3 * p);
      break;
      
    case 'hat_bunny':
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 6 * p, cy - 10 * p, 4 * p, 14 * p);
      ctx.fillRect(cx + 2 * p, cy - 10 * p, 4 * p, 14 * p);
      ctx.fillStyle = '#ffb6c1';
      ctx.fillRect(cx - 5 * p, cy - 8 * p, 2 * p, 10 * p);
      ctx.fillRect(cx + 3 * p, cy - 8 * p, 2 * p, 10 * p);
      break;
      
    case 'hat_mohawk':
      ctx.fillStyle = '#2ecc71';
      for (let i = 0; i < 5; i++) {
        const h = 10 - Math.abs(i - 2) * 2;
        ctx.fillRect(cx - 6 * p + i * 3 * p, cy - h * p, 3 * p, (h + 4) * p);
      }
      break;
      
    case 'hat_afro':
      ctx.fillStyle = '#2c3e50';
      ctx.beginPath();
      ctx.arc(cx, cy, 11 * p, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1a252f';
      ctx.beginPath();
      ctx.arc(cx - 4 * p, cy - 4 * p, 3 * p, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + 4 * p, cy - 2 * p, 4 * p, 0, Math.PI * 2);
      ctx.fill();
      break;
      
    case 'hat_santa':
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(cx - 8 * p, cy + p, 16 * p, 4 * p);
      ctx.beginPath();
      ctx.moveTo(cx - 8 * p, cy + p);
      ctx.lineTo(cx + 10 * p, cy - 8 * p);
      ctx.lineTo(cx + 8 * p, cy + p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 9 * p, cy + 3 * p, 18 * p, 3 * p);
      ctx.beginPath();
      ctx.arc(cx + 10 * p, cy - 8 * p, 3 * p, 0, Math.PI * 2);
      ctx.fill();
      break;
      
    case 'hat_party':
      ctx.fillStyle = '#9b59b6';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 10 * p);
      ctx.lineTo(cx - 8 * p, cy + 4 * p);
      ctx.lineTo(cx + 8 * p, cy + 4 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(cx - 4 * p, cy - 2 * p, 2 * p, 2 * p);
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(cx + 3 * p, cy - 5 * p, 2 * p, 2 * p);
      ctx.fillStyle = '#3498db';
      ctx.fillRect(cx - 2 * p, cy + p, 2 * p, 2 * p);
      break;
      
    case 'hat_dragon':
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(cx - 8 * p, cy - 2 * p, 16 * p, 8 * p);
      ctx.fillStyle = '#e74c3c';
      // Spikes
      ctx.beginPath();
      ctx.moveTo(cx - 8 * p, cy - 2 * p);
      ctx.lineTo(cx - 10 * p, cy - 10 * p);
      ctx.lineTo(cx - 4 * p, cy - 4 * p);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx, cy - 2 * p);
      ctx.lineTo(cx, cy - 12 * p);
      ctx.lineTo(cx + 4 * p, cy - 4 * p);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 8 * p, cy - 2 * p);
      ctx.lineTo(cx + 10 * p, cy - 10 * p);
      ctx.lineTo(cx + 4 * p, cy - 4 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(cx - 5 * p, cy + 2 * p, 2 * p, 2 * p);
      ctx.fillRect(cx + 3 * p, cy + 2 * p, 2 * p, 2 * p);
      break;
      
    case 'hat_phoenix':
      ctx.fillStyle = '#e67e22';
      ctx.fillRect(cx - 8 * p, cy, 16 * p, 6 * p);
      ctx.fillStyle = '#f39c12';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - 6 * p + i * 6 * p, cy);
        ctx.lineTo(cx - 4 * p + i * 6 * p, cy - 10 * p + i * 2 * p);
        ctx.lineTo(cx - 2 * p + i * 6 * p, cy);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(cx - p, cy - 6 * p, 2 * p, 2 * p);
      break;
      
    case 'hat_demon':
      // Demon crown with dark flames
      ctx.fillStyle = '#4a0000';
      ctx.fillRect(cx - 8 * p, cy, 16 * p, 6 * p);
      ctx.fillStyle = '#8b0000';
      ctx.fillRect(cx - 6 * p, cy - 4 * p, 3 * p, 4 * p);
      ctx.fillRect(cx - p, cy - 6 * p, 3 * p, 6 * p);
      ctx.fillRect(cx + 4 * p, cy - 4 * p, 3 * p, 4 * p);
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(cx, cy - 4 * p, 2 * p, 2 * p);
      break;
      
    // === LEGENDARY HATS ===
    case 'hat_golden':
      // Golden crown - radiant gold with shimmer
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(cx - 8 * p, cy, 16 * p, 6 * p);
      ctx.fillRect(cx - 7 * p, cy - 5 * p, 4 * p, 5 * p);
      ctx.fillRect(cx - 2 * p, cy - 8 * p, 4 * p, 8 * p);
      ctx.fillRect(cx + 4 * p, cy - 5 * p, 4 * p, 5 * p);
      ctx.fillStyle = '#fff8dc';
      ctx.fillRect(cx - 5 * p, cy + p, 2 * p, 2 * p);
      ctx.fillRect(cx + 4 * p, cy + p, 2 * p, 2 * p);
      ctx.fillRect(cx, cy - 5 * p, 2 * p, 2 * p);
      ctx.fillStyle = '#ffec8b';
      ctx.fillRect(cx - 6 * p, cy - 3 * p, 2 * p, 2 * p);
      ctx.fillRect(cx + 5 * p, cy - 3 * p, 2 * p, 2 * p);
      // Animated shimmer
      const shimmer = Math.sin(time * 0.003) * 0.3 + 0.5;
      ctx.fillStyle = `rgba(255, 255, 255, ${shimmer * 0.6})`;
      ctx.fillRect(cx - 6 * p, cy - 2 * p, 12 * p, 3 * p);
      // Sparkles
      const sparklePhase = (time * 0.002) % 1;
      if (sparklePhase < 0.3) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx - 8 * p, cy - 6 * p, p, p);
        ctx.fillRect(cx + 7 * p, cy - 4 * p, p, p);
      }
      break;
      
    case 'hat_phoenix_legendary':
      // Phoenix crown - blazing flames with animation
      ctx.fillStyle = '#ff4500';
      ctx.fillRect(cx - 8 * p, cy, 16 * p, 6 * p);
      ctx.fillStyle = '#ffd700';
      const flameOffset = Math.sin(time * 0.004) * 0.5;
      for (let i = 0; i < 5; i++) {
        const h = 12 - Math.abs(i - 2) * 3 + flameOffset * 2;
        ctx.beginPath();
        ctx.moveTo(cx - 8 * p + i * 4 * p, cy);
        ctx.lineTo(cx - 6 * p + i * 4 * p, cy - h * p);
        ctx.lineTo(cx - 4 * p + i * 4 * p, cy);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = '#ff6600';
      ctx.fillRect(cx - 2 * p, cy + p, 4 * p, 3 * p);
      // Rising embers
      const emberY = cy - 10 * p - (time * 0.1) % 8;
      ctx.fillStyle = `rgba(255, 200, 0, ${0.6 + Math.sin(time * 0.005) * 0.4})`;
      ctx.fillRect(cx - 3 * p, emberY, 2 * p, 2 * p);
      ctx.fillRect(cx + 2 * p, emberY - 3 * p, 2 * p, 2 * p);
      break;
      
    case 'hat_void':
      // Void helm - dark matter with swirling particles
      ctx.fillStyle = '#1a0a2e';
      ctx.fillRect(cx - 8 * p, cy - 2 * p, 16 * p, 8 * p);
      ctx.fillStyle = '#4b0082';
      ctx.fillRect(cx - 6 * p, cy - 6 * p, 12 * p, 4 * p);
      ctx.fillStyle = '#9400d3';
      ctx.fillRect(cx - 3 * p, cy, 6 * p, 4 * p);
      ctx.fillStyle = '#000000';
      ctx.fillRect(cx - 5 * p, cy + 2 * p, 4 * p, 2 * p);
      ctx.fillRect(cx + 2 * p, cy + 2 * p, 4 * p, 2 * p);
      // Swirling void particles
      const voidAngle = (time * 0.001) % (Math.PI * 2);
      const voidRadius = 6 * p;
      const voidX = cx + Math.cos(voidAngle) * voidRadius;
      const voidY = cy - 2 * p + Math.sin(voidAngle) * voidRadius * 0.5;
      ctx.fillStyle = `rgba(148, 0, 211, ${0.5 + Math.sin(time * 0.003) * 0.5})`;
      ctx.fillRect(voidX - p, voidY - p, 2 * p, 2 * p);
      break;
      
    case 'hat_celestial':
      // Celestial halo - divine light with twinkling stars
      const haloPulse = Math.sin(time * 0.002) * 0.2 + 0.8;
      ctx.strokeStyle = `rgba(255, 255, 255, ${haloPulse})`;
      ctx.lineWidth = 4 * p;
      ctx.beginPath();
      ctx.ellipse(cx, cy - 2 * p, 10 * p, 5 * p, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(255, 250, 205, ${0.3 * haloPulse})`;
      ctx.fill();
      ctx.fillStyle = '#fffacd';
      ctx.fillRect(cx - 2 * p, cy - 4 * p, 4 * p, 4 * p);
      ctx.fillRect(cx - 8 * p, cy - p, 3 * p, 2 * p);
      ctx.fillRect(cx + 6 * p, cy - p, 3 * p, 2 * p);
      // Twinkling stars
      const starPhase = (time * 0.003) % 1;
      if (starPhase < 0.5) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx - 6 * p, cy - 6 * p, p, p);
        ctx.fillRect(cx + 5 * p, cy - 4 * p, p, p);
        ctx.fillRect(cx - 2 * p, cy - 8 * p, p, p);
      }
      break;
      
    case 'hat_galaxy':
      // Galaxy crown - cosmic swirls with animated stars
      ctx.fillStyle = '#1a0a3e';
      ctx.fillRect(cx - 8 * p, cy, 16 * p, 6 * p);
      ctx.fillRect(cx - 6 * p, cy - 5 * p, 3 * p, 5 * p);
      ctx.fillRect(cx - p, cy - 7 * p, 3 * p, 7 * p);
      ctx.fillRect(cx + 4 * p, cy - 5 * p, 3 * p, 5 * p);
      ctx.fillStyle = '#4169e1';
      ctx.fillRect(cx - 5 * p, cy + p, 2 * p, 2 * p);
      ctx.fillRect(cx + 4 * p, cy + p, 2 * p, 2 * p);
      ctx.fillStyle = '#9400d3';
      ctx.fillRect(cx, cy - 4 * p, 2 * p, 2 * p);
      // Animated stars
      const starTwinkle = Math.sin(time * 0.004) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(255, 255, 255, ${starTwinkle})`;
      ctx.fillRect(cx - 4 * p, cy - 3 * p, p, p);
      ctx.fillRect(cx + 2 * p, cy - 5 * p, p, p);
      ctx.fillRect(cx + 5 * p, cy - 3 * p, p, p);
      // Swirling cosmic particles
      const cosmicAngle = (time * 0.0015) % (Math.PI * 2);
      const cosmicX = cx + Math.cos(cosmicAngle) * 5 * p;
      const cosmicY = cy - 2 * p + Math.sin(cosmicAngle) * 3 * p;
      ctx.fillStyle = '#00ced1';
      ctx.fillRect(cosmicX - p, cosmicY - p, 2 * p, 2 * p);
      break;
      
    case 'hat_rainbow':
      // Prismatic crown - rainbow bands with color cycling
      const rainbowOffset = (time * 0.001) % 1;
      const colors = ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#8b00ff'];
      for (let i = 0; i < 6; i++) {
        const colorIndex = Math.floor((i + rainbowOffset * 6) % 6);
        ctx.fillStyle = colors[colorIndex];
        if (i < 3) {
          ctx.fillRect(cx - 8 * p, cy + (4 - i * 2) * p, 16 * p, 2 * p);
        } else if (i === 3) {
          ctx.fillRect(cx - 6 * p, cy - 4 * p, 12 * p, 4 * p);
        } else if (i === 4) {
          ctx.fillRect(cx - 3 * p, cy - 6 * p, 6 * p, 2 * p);
        } else {
          ctx.fillRect(cx - p, cy - 8 * p, 2 * p, 2 * p);
        }
      }
      break;
      
    default:
      // Generic hat
      ctx.fillStyle = '#888888';
      ctx.fillRect(cx - 8 * p, cy, 16 * p, 4 * p);
      ctx.fillRect(cx - 5 * p, cy - 4 * p, 10 * p, 4 * p);
  }
}

function drawShirtPreview(ctx: CanvasRenderingContext2D, itemId: string, cx: number, cy: number, p: number, time: number = 0): void {
  // Base shirt shape
  const shirtW = 16 * p;
  const shirtH = 12 * p;
  const x = cx - shirtW / 2;
  const y = cy - shirtH / 2;
  
  // Get color based on item
  let color = '#888888';
  let detail = '';
  
  switch (itemId) {
    case 'shirt_red': color = '#e74c3c'; break;
    case 'shirt_blue': color = '#3498db'; break;
    case 'shirt_green': color = '#27ae60'; break;
    case 'shirt_yellow': color = '#f1c40f'; break;
    case 'shirt_purple': color = '#9b59b6'; break;
    case 'shirt_pink': color = '#e91e9b'; break;
    case 'shirt_black': color = '#2c3e50'; break;
    case 'shirt_white': color = '#ecf0f1'; break;
    case 'shirt_hoodie': color = '#7f8c8d'; detail = 'hoodie'; break;
    case 'shirt_hawaiian': color = '#e67e22'; detail = 'hawaiian'; break;
    case 'shirt_striped': color = '#34495e'; detail = 'striped'; break;
    case 'shirt_tuxedo': color = '#1a1a2e'; detail = 'tuxedo'; break;
    case 'robe_wizard': color = '#8e44ad'; detail = 'robe'; break;
    case 'robe_dark': color = '#1a1a1a'; detail = 'robe'; break;
    case 'dress_princess': color = '#ff69b4'; detail = 'dress'; break;
    case 'robe_angel': color = '#ffefd5'; detail = 'robe'; break;
    case 'armor_knight': color = '#7f8c8d'; detail = 'armor'; break;
    case 'armor_samurai': color = '#c0392b'; detail = 'armor'; break;
    case 'armor_gold': color = '#f39c12'; detail = 'armor'; break;
    case 'coat_chef': color = '#ffffff'; detail = 'coat'; break;
    case 'coat_lab': color = '#ffffff'; detail = 'coat'; break;
    case 'suit_space': color = '#ecf0f1'; detail = 'space'; break;
    case 'coat_pirate': color = '#8b0000'; detail = 'pirate'; break;
    case 'gi_ninja': color = '#2c3e50'; detail = 'gi'; break;
    case 'vest_cowboy': color = '#8b4513'; detail = 'vest'; break;
    case 'tunic_viking': color = '#a0522d'; break;
    case 'jacket_punk': color = '#1a1a1a'; detail = 'punk'; break;
    case 'jacket_neon': color = '#00ff88'; detail = 'neon'; break;
    case 'jacket_leather': color = '#3d3d3d'; break;
    case 'robe_dragon': color = '#c0392b'; detail = 'dragon'; break;
    case 'armor_demon': color = '#4a0000'; detail = 'demon'; break;
    case 'robe_phoenix': color = '#ff4500'; detail = 'phoenix'; break;
    // Legendary shirts
    case 'armor_golden': color = '#ffd700'; detail = 'legendary_golden'; break;
    case 'robe_phoenix_legendary': color = '#ff4500'; detail = 'legendary_phoenix'; break;
    case 'armor_void': color = '#2d0a4e'; detail = 'legendary_void'; break;
    case 'robe_celestial': color = '#e8e8ff'; detail = 'legendary_celestial'; break;
    case 'armor_galaxy': color = '#1a0a3e'; detail = 'legendary_galaxy'; break;
    case 'robe_rainbow': color = '#ff6b6b'; detail = 'legendary_rainbow'; break;
  }
  
  // Draw base shirt
  ctx.fillStyle = color;
  ctx.fillRect(x, y, shirtW, shirtH);
  
  // Sleeves
  ctx.fillRect(x - 4 * p, y + 2 * p, 4 * p, 6 * p);
  ctx.fillRect(x + shirtW, y + 2 * p, 4 * p, 6 * p);
  
  // Details based on type
  switch (detail) {
    case 'striped':
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < shirtH; i += 4 * p) {
        ctx.fillRect(x, y + i, shirtW, 2 * p);
      }
      break;
      
    case 'hawaiian':
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(x + 3 * p, y + 3 * p, 3 * p, 3 * p);
      ctx.fillRect(x + 10 * p, y + 6 * p, 3 * p, 3 * p);
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(x + 7 * p, y + 2 * p, 2 * p, 2 * p);
      break;
      
    case 'tuxedo':
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - p, y, 2 * p, shirtH);
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(cx - p, y + 2 * p, 2 * p, 3 * p);
      break;
      
    case 'robe':
      ctx.fillRect(x - 2 * p, y + shirtH - 2 * p, shirtW + 4 * p, 4 * p);
      if (itemId === 'robe_wizard') {
        ctx.fillStyle = '#f1c40f';
        ctx.fillRect(cx - 2 * p, y + 3 * p, 4 * p, 4 * p);
      }
      break;
      
    case 'armor':
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillRect(x + 2 * p, y + 2 * p, shirtW - 4 * p, 3 * p);
      if (itemId === 'armor_gold') {
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(cx - 3 * p, cy - p, 6 * p, 3 * p);
      }
      break;
      
    case 'pirate':
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(x + 2 * p, y + 2 * p, 2 * p, 2 * p);
      ctx.fillRect(x + shirtW - 4 * p, y + 2 * p, 2 * p, 2 * p);
      ctx.fillRect(x + 2 * p, y + 6 * p, 2 * p, 2 * p);
      ctx.fillRect(x + shirtW - 4 * p, y + 6 * p, 2 * p, 2 * p);
      break;
      
    case 'neon':
      ctx.fillStyle = '#ff00ff';
      ctx.fillRect(x, y, 2 * p, shirtH);
      ctx.fillRect(x + shirtW - 2 * p, y, 2 * p, shirtH);
      ctx.fillStyle = '#00ffff';
      ctx.fillRect(cx - p, y, 2 * p, shirtH);
      break;
      
    case 'space':
      ctx.fillStyle = '#3498db';
      ctx.fillRect(cx - 3 * p, y + 3 * p, 6 * p, 6 * p);
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(x + 2 * p, y + shirtH - 3 * p, 3 * p, 3 * p);
      break;
      
    case 'dress':
      ctx.fillRect(x - 3 * p, y + shirtH - 2 * p, shirtW + 6 * p, 6 * p);
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(cx - 2 * p, y + 2 * p, 4 * p, 3 * p);
      break;
      
    case 'demon':
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(cx - 2 * p, y + 2 * p, 4 * p, 4 * p);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(x + 2 * p, y + shirtH - 2 * p, shirtW - 4 * p, 2 * p);
      break;
      
    case 'dragon':
      ctx.fillStyle = '#f39c12';
      ctx.fillRect(cx - 3 * p, y + 2 * p, 6 * p, 6 * p);
      ctx.fillStyle = '#2c3e50';
      ctx.fillRect(cx - p, y + 4 * p, 2 * p, 2 * p);
      break;
      
    case 'phoenix':
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(cx - 3 * p, y + 2 * p, 6 * p, 5 * p);
      ctx.fillStyle = '#ff6600';
      ctx.fillRect(cx - 2 * p, y + shirtH - 3 * p, 4 * p, 3 * p);
      break;
      
    case 'legendary_golden':
      // Golden plate armor with animated shine
      const goldenShimmer = Math.sin(time * 0.003) * 0.3 + 0.5;
      ctx.fillStyle = `rgba(255,255,255,${goldenShimmer * 0.5})`;
      ctx.fillRect(x + 2 * p, y + p, shirtW - 4 * p, 3 * p);
      ctx.fillStyle = '#ffec8b';
      ctx.fillRect(cx - 3 * p, cy - 2 * p, 6 * p, 4 * p);
      ctx.fillStyle = '#fff8dc';
      ctx.fillRect(cx - p, y + 2 * p, 2 * p, 2 * p);
      // Sparkles
      const goldenSparkle = (time * 0.002) % 1;
      if (goldenSparkle < 0.3) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + 4 * p, y + 3 * p, p, p);
        ctx.fillRect(x + shirtW - 5 * p, y + 5 * p, p, p);
      }
      break;
      
    case 'legendary_phoenix':
      // Phoenix vestments with animated flame pattern
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(cx - 4 * p, y + 2 * p, 8 * p, 6 * p);
      ctx.fillStyle = '#ff6600';
      ctx.fillRect(cx - 2 * p, y + shirtH - 4 * p, 4 * p, 4 * p);
      ctx.fillRect(x + p, y + shirtH - 2 * p, 3 * p, 2 * p);
      ctx.fillRect(x + shirtW - 4 * p, y + shirtH - 2 * p, 3 * p, 2 * p);
      // Animated embers
      const emberY2 = y + shirtH - (time * 0.08) % 6;
      ctx.fillStyle = `rgba(255, 150, 0, ${0.6 + Math.sin(time * 0.005) * 0.4})`;
      ctx.fillRect(cx - 3 * p, emberY2, 2 * p, 2 * p);
      ctx.fillRect(cx + 2 * p, emberY2 - 2 * p, 2 * p, 2 * p);
      break;
      
    case 'legendary_void':
      // Void armor with animated dark energy
      ctx.fillStyle = '#4b0082';
      ctx.fillRect(x + 2 * p, y + 2 * p, shirtW - 4 * p, 3 * p);
      const voidPulse = Math.sin(time * 0.002) * 0.3 + 0.7;
      ctx.fillStyle = `rgba(148, 0, 211, ${voidPulse})`;
      ctx.fillRect(cx - 2 * p, cy - p, 4 * p, 3 * p);
      ctx.fillStyle = '#000000';
      ctx.fillRect(cx - p, y + 3 * p, 2 * p, 2 * p);
      // Swirling void particles
      const voidAngle2 = (time * 0.001) % (Math.PI * 2);
      const voidX2 = cx + Math.cos(voidAngle2) * 4 * p;
      const voidY2 = cy + Math.sin(voidAngle2) * 2 * p;
      ctx.fillStyle = `rgba(75, 0, 130, ${0.5 + Math.sin(time * 0.003) * 0.5})`;
      ctx.fillRect(voidX2 - p, voidY2 - p, 2 * p, 2 * p);
      break;
      
    case 'legendary_celestial':
      // Celestial robes with twinkling stars
      ctx.fillRect(x - 2 * p, y + shirtH - 2 * p, shirtW + 4 * p, 4 * p);
      const celestialPulse = Math.sin(time * 0.002) * 0.3 + 0.7;
      ctx.fillStyle = `rgba(255, 250, 205, ${celestialPulse})`;
      ctx.fillRect(cx - 2 * p, y + 2 * p, 4 * p, 4 * p);
      const starPhase2 = (time * 0.003) % 1;
      if (starPhase2 < 0.5) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + 3 * p, y + 5 * p, 2 * p, 2 * p);
        ctx.fillRect(x + shirtW - 5 * p, y + 4 * p, 2 * p, 2 * p);
      }
      break;
      
    case 'legendary_galaxy':
      // Galactic armor with animated cosmic swirls
      ctx.fillStyle = '#4169e1';
      ctx.fillRect(x + 2 * p, y + 2 * p, shirtW - 4 * p, 4 * p);
      ctx.fillStyle = '#9400d3';
      ctx.fillRect(cx - 3 * p, cy - p, 6 * p, 3 * p);
      const galaxyTwinkle = Math.sin(time * 0.004) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(255, 255, 255, ${galaxyTwinkle})`;
      ctx.fillRect(cx - p, y + 3 * p, 2 * p, 2 * p);
      ctx.fillRect(x + 3 * p, y + 5 * p, p, p);
      ctx.fillRect(x + shirtW - 4 * p, y + 6 * p, p, p);
      // Swirling cosmic particle
      const cosmicAngle2 = (time * 0.0015) % (Math.PI * 2);
      const cosmicX2 = cx + Math.cos(cosmicAngle2) * 3 * p;
      const cosmicY2 = cy + Math.sin(cosmicAngle2) * 2 * p;
      ctx.fillStyle = '#00ced1';
      ctx.fillRect(cosmicX2 - p, cosmicY2 - p, 2 * p, 2 * p);
      break;
      
    case 'legendary_rainbow':
      // Prismatic robes with animated rainbow bands
      ctx.fillRect(x - 2 * p, y + shirtH - 2 * p, shirtW + 4 * p, 4 * p);
      const rainbowOffset2 = (time * 0.001) % 1;
      const rainbowColors = ['#ff7f00', '#ffff00', '#00ff00', '#0000ff'];
      for (let i = 0; i < 4; i++) {
        const colorIndex = Math.floor((i + rainbowOffset2 * 4) % 4);
        ctx.fillStyle = rainbowColors[colorIndex];
        ctx.fillRect(x, y + (2 + i * 2) * p, shirtW, 2 * p);
      }
      break;
  }
}

function drawAccessoryPreview(ctx: CanvasRenderingContext2D, itemId: string, cx: number, cy: number, p: number, time: number = 0): void {
  switch (itemId) {
    case 'acc_glasses':
      ctx.fillStyle = '#2c3e50';
      ctx.fillRect(cx - 10 * p, cy - p, 8 * p, 4 * p);
      ctx.fillRect(cx + 2 * p, cy - p, 8 * p, 4 * p);
      ctx.fillRect(cx - 2 * p, cy, 4 * p, 2 * p);
      ctx.fillStyle = '#87ceeb';
      ctx.globalAlpha = 0.5;
      ctx.fillRect(cx - 8 * p, cy, 4 * p, 2 * p);
      ctx.fillRect(cx + 4 * p, cy, 4 * p, 2 * p);
      ctx.globalAlpha = 1;
      break;
      
    case 'acc_sunglasses':
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(cx - 10 * p, cy - p, 9 * p, 5 * p);
      ctx.fillRect(cx + p, cy - p, 9 * p, 5 * p);
      ctx.fillRect(cx - p, cy, 2 * p, 2 * p);
      break;
      
    case 'acc_monocle':
      ctx.strokeStyle = '#f1c40f';
      ctx.lineWidth = 2 * p;
      ctx.beginPath();
      ctx.arc(cx, cy, 6 * p, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy + 6 * p);
      ctx.lineTo(cx + 2 * p, cy + 12 * p);
      ctx.stroke();
      break;
      
    case 'acc_eyepatch':
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(cx - 5 * p, cy - 2 * p, 8 * p, 6 * p);
      ctx.fillRect(cx - 10 * p, cy - p, 5 * p, 2 * p);
      ctx.fillRect(cx + 3 * p, cy - p, 7 * p, 2 * p);
      break;
      
    case 'acc_mask':
      ctx.fillStyle = '#ecf0f1';
      ctx.fillRect(cx - 10 * p, cy - 3 * p, 20 * p, 8 * p);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(cx - 7 * p, cy - p, 4 * p, 3 * p);
      ctx.fillRect(cx + 3 * p, cy - p, 4 * p, 3 * p);
      break;
      
    case 'acc_cybervisor':
      ctx.fillStyle = '#00ffff';
      ctx.globalAlpha = 0.7;
      ctx.fillRect(cx - 11 * p, cy - 2 * p, 22 * p, 6 * p);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#2c3e50';
      ctx.fillRect(cx - 11 * p, cy - 2 * p, 22 * p, 2 * p);
      ctx.fillRect(cx - 11 * p, cy + 2 * p, 22 * p, 2 * p);
      break;
      
    case 'acc_scarf':
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(cx - 8 * p, cy - 4 * p, 16 * p, 5 * p);
      ctx.fillRect(cx + 2 * p, cy + p, 6 * p, 10 * p);
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(cx - 8 * p, cy - 2 * p, 16 * p, 2 * p);
      break;
      
    case 'acc_bowtie':
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx - 8 * p, cy - 5 * p);
      ctx.lineTo(cx - 8 * p, cy + 5 * p);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + 8 * p, cy - 5 * p);
      ctx.lineTo(cx + 8 * p, cy + 5 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(cx - 2 * p, cy - 2 * p, 4 * p, 4 * p);
      break;
      
    case 'acc_necklace':
      ctx.strokeStyle = '#f1c40f';
      ctx.lineWidth = 2 * p;
      ctx.beginPath();
      ctx.arc(cx, cy - 2 * p, 8 * p, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = '#f1c40f';
      ctx.beginPath();
      ctx.moveTo(cx, cy + 6 * p);
      ctx.lineTo(cx - 4 * p, cy + 2 * p);
      ctx.lineTo(cx + 4 * p, cy + 2 * p);
      ctx.closePath();
      ctx.fill();
      break;
      
    case 'acc_cape_red':
    case 'acc_cape_black':
    case 'acc_cape_royal':
      const capeColor = itemId === 'acc_cape_red' ? '#c0392b' : 
                        itemId === 'acc_cape_black' ? '#1a1a1a' : '#9b59b6';
      ctx.fillStyle = capeColor;
      ctx.fillRect(cx - 8 * p, cy - 6 * p, 16 * p, 16 * p);
      ctx.fillStyle = itemId === 'acc_cape_royal' ? '#f1c40f' : 'rgba(255,255,255,0.2)';
      ctx.fillRect(cx - 8 * p, cy - 6 * p, 16 * p, 3 * p);
      break;
      
    // Wings are now handled in drawWingsPreview() - skip them here
    case 'acc_wings_angel':
    case 'acc_wings_devil':
    case 'acc_wings_fairy':
    case 'acc_wings_dragon':
    case 'acc_wings_golden':
      // Golden wings with shimmer
      const goldenWingPulse = Math.sin(time * 0.002) * 0.1 + 0.9;
      ctx.fillStyle = '#ffd700';
      // Left wing
      ctx.beginPath();
      ctx.moveTo(cx - 2 * p, cy);
      ctx.lineTo(cx - 8 * p, cy - 10 * p);
      ctx.lineTo(cx - 14 * p, cy - 4 * p);
      ctx.lineTo(cx - 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255, 236, 139, ${goldenWingPulse})`;
      ctx.fillRect(cx - 10 * p, cy - 2 * p, 2 * p, 4 * p);
      // Right wing
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.moveTo(cx + 2 * p, cy);
      ctx.lineTo(cx + 8 * p, cy - 10 * p);
      ctx.lineTo(cx + 14 * p, cy - 4 * p);
      ctx.lineTo(cx + 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255, 236, 139, ${goldenWingPulse})`;
      ctx.fillRect(cx + 8 * p, cy - 2 * p, 2 * p, 4 * p);
      break;
      
    case 'acc_wings_phoenix':
      // Phoenix wings with flames
      const phoenixWingPulse = Math.sin(time * 0.002) * 0.1 + 0.9;
      ctx.fillStyle = '#ff4500';
      // Left wing
      ctx.beginPath();
      ctx.moveTo(cx - 2 * p, cy);
      ctx.lineTo(cx - 8 * p, cy - 10 * p);
      ctx.lineTo(cx - 14 * p, cy - 4 * p);
      ctx.lineTo(cx - 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255, 215, 0, ${phoenixWingPulse})`;
      ctx.fillRect(cx - 10 * p, cy - 2 * p, 2 * p, 4 * p);
      // Right wing
      ctx.fillStyle = '#ff4500';
      ctx.beginPath();
      ctx.moveTo(cx + 2 * p, cy);
      ctx.lineTo(cx + 8 * p, cy - 10 * p);
      ctx.lineTo(cx + 14 * p, cy - 4 * p);
      ctx.lineTo(cx + 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255, 215, 0, ${phoenixWingPulse})`;
      ctx.fillRect(cx + 8 * p, cy - 2 * p, 2 * p, 4 * p);
      // Rising embers
      const emberY5 = cy - 10 * p - (time * 0.1) % 8;
      ctx.fillStyle = `rgba(255, 150, 0, ${0.6 + Math.sin(time * 0.005) * 0.4})`;
      ctx.fillRect(cx - 6 * p, emberY5, 2 * p, 2 * p);
      ctx.fillRect(cx + 5 * p, emberY5 - 2 * p, 2 * p, 2 * p);
      break;
      
    case 'acc_wings_void':
      // Void wings with dark energy
      const voidWingPulse = Math.sin(time * 0.0015) * 0.08 + 0.92;
      ctx.fillStyle = '#1a0a2e';
      // Left wing
      ctx.beginPath();
      ctx.moveTo(cx - 2 * p, cy);
      ctx.lineTo(cx - 8 * p, cy - 10 * p);
      ctx.lineTo(cx - 14 * p, cy - 4 * p);
      ctx.lineTo(cx - 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(148, 0, 211, ${voidWingPulse})`;
      ctx.fillRect(cx - 10 * p, cy - 2 * p, 2 * p, 4 * p);
      // Right wing
      ctx.fillStyle = '#1a0a2e';
      ctx.beginPath();
      ctx.moveTo(cx + 2 * p, cy);
      ctx.lineTo(cx + 8 * p, cy - 10 * p);
      ctx.lineTo(cx + 14 * p, cy - 4 * p);
      ctx.lineTo(cx + 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(148, 0, 211, ${voidWingPulse})`;
      ctx.fillRect(cx + 8 * p, cy - 2 * p, 2 * p, 4 * p);
      break;
      
    case 'acc_wings_celestial':
      // Celestial wings with stars
      const celestialWingPulse = Math.sin(time * 0.002) * 0.1 + 0.9;
      ctx.fillStyle = '#ffffff';
      // Left wing
      ctx.beginPath();
      ctx.moveTo(cx - 2 * p, cy);
      ctx.lineTo(cx - 8 * p, cy - 10 * p);
      ctx.lineTo(cx - 14 * p, cy - 4 * p);
      ctx.lineTo(cx - 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255, 250, 205, ${celestialWingPulse})`;
      ctx.fillRect(cx - 10 * p, cy - 2 * p, p, p);
      ctx.fillRect(cx - 12 * p, cy + 2 * p, p, p);
      // Right wing
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(cx + 2 * p, cy);
      ctx.lineTo(cx + 8 * p, cy - 10 * p);
      ctx.lineTo(cx + 14 * p, cy - 4 * p);
      ctx.lineTo(cx + 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255, 250, 205, ${celestialWingPulse})`;
      ctx.fillRect(cx + 8 * p, cy - 2 * p, p, p);
      ctx.fillRect(cx + 10 * p, cy + 2 * p, p, p);
      // Twinkling stars
      const starTwinkle5 = (time * 0.003) % 1;
      if (starTwinkle5 < 0.5) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx - 6 * p, cy - 8 * p, p, p);
        ctx.fillRect(cx + 5 * p, cy - 6 * p, p, p);
      }
      break;
      
    case 'acc_wings_galaxy':
      // Galaxy wings with cosmic patterns
      const galaxyWingPulse = Math.sin(time * 0.002) * 0.1 + 0.9;
      ctx.fillStyle = '#1a0a3e';
      // Left wing
      ctx.beginPath();
      ctx.moveTo(cx - 2 * p, cy);
      ctx.lineTo(cx - 8 * p, cy - 10 * p);
      ctx.lineTo(cx - 14 * p, cy - 4 * p);
      ctx.lineTo(cx - 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(65, 105, 225, ${galaxyWingPulse})`;
      ctx.fillRect(cx - 10 * p, cy - 2 * p, 2 * p, 4 * p);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 12 * p, cy, p, p);
      // Right wing
      ctx.fillStyle = '#1a0a3e';
      ctx.beginPath();
      ctx.moveTo(cx + 2 * p, cy);
      ctx.lineTo(cx + 8 * p, cy - 10 * p);
      ctx.lineTo(cx + 14 * p, cy - 4 * p);
      ctx.lineTo(cx + 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(65, 105, 225, ${galaxyWingPulse})`;
      ctx.fillRect(cx + 8 * p, cy - 2 * p, 2 * p, 4 * p);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx + 10 * p, cy, p, p);
      break;
      
    case 'acc_wings_rainbow':
      // Rainbow wings with color cycling
      const rainbowWingCycle = (time * 0.001) % 1;
      const rainbowColors5 = ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#8b00ff'];
      // Left wing
      const leftWingGradient = ctx.createLinearGradient(cx - 14 * p, cy - 10 * p, cx - 2 * p, cy + 6 * p);
      for (let i = 0; i < 6; i++) {
        const colorIndex = Math.floor((i + rainbowWingCycle * 6) % 6);
        leftWingGradient.addColorStop(i / 6, rainbowColors5[colorIndex]);
      }
      ctx.fillStyle = leftWingGradient;
      ctx.beginPath();
      ctx.moveTo(cx - 2 * p, cy);
      ctx.lineTo(cx - 8 * p, cy - 10 * p);
      ctx.lineTo(cx - 14 * p, cy - 4 * p);
      ctx.lineTo(cx - 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      // Right wing
      const rightWingGradient = ctx.createLinearGradient(cx + 2 * p, cy - 10 * p, cx + 14 * p, cy + 6 * p);
      for (let i = 0; i < 6; i++) {
        const colorIndex = Math.floor((i + rainbowWingCycle * 6) % 6);
        rightWingGradient.addColorStop(i / 6, rainbowColors5[colorIndex]);
      }
      ctx.fillStyle = rightWingGradient;
      ctx.beginPath();
      ctx.moveTo(cx + 2 * p, cy);
      ctx.lineTo(cx + 8 * p, cy - 10 * p);
      ctx.lineTo(cx + 14 * p, cy - 4 * p);
      ctx.lineTo(cx + 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      break;
      
    case 'acc_weapon_golden':
      // Golden dual blades
      const goldenWeaponPulse = Math.sin(time * 0.002) * 0.3 + 0.7;
      ctx.fillStyle = '#ffd700';
      // Left blade
      ctx.fillRect(cx - 8 * p, cy - 4 * p, 2 * p, 12 * p);
      ctx.fillStyle = `rgba(255, 236, 139, ${goldenWeaponPulse})`;
      ctx.fillRect(cx - 8 * p, cy - 4 * p, 2 * p, 4 * p);
      // Right blade
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(cx + 6 * p, cy - 4 * p, 2 * p, 12 * p);
      ctx.fillStyle = `rgba(255, 236, 139, ${goldenWeaponPulse})`;
      ctx.fillRect(cx + 6 * p, cy - 4 * p, 2 * p, 4 * p);
      break;
      
    case 'acc_weapon_phoenix':
      // Phoenix dual flames
      const phoenixWeaponPulse = Math.sin(time * 0.003) * 0.3 + 0.7;
      ctx.fillStyle = '#ff4500';
      // Left flame
      ctx.beginPath();
      ctx.moveTo(cx - 8 * p, cy + 8 * p);
      ctx.lineTo(cx - 10 * p, cy);
      ctx.lineTo(cx - 6 * p, cy - 2 * p);
      ctx.lineTo(cx - 4 * p, cy + 2 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255, 215, 0, ${phoenixWeaponPulse})`;
      ctx.fillRect(cx - 8 * p, cy + 4 * p, 2 * p, 4 * p);
      // Right flame
      ctx.fillStyle = '#ff4500';
      ctx.beginPath();
      ctx.moveTo(cx + 8 * p, cy + 8 * p);
      ctx.lineTo(cx + 10 * p, cy);
      ctx.lineTo(cx + 6 * p, cy - 2 * p);
      ctx.lineTo(cx + 4 * p, cy + 2 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255, 215, 0, ${phoenixWeaponPulse})`;
      ctx.fillRect(cx + 6 * p, cy + 4 * p, 2 * p, 4 * p);
      break;
      
    case 'acc_weapon_void':
      // Void dual scythes
      const voidWeaponPulse = Math.sin(time * 0.002) * 0.3 + 0.7;
      ctx.fillStyle = '#1a0a2e';
      // Left scythe
      ctx.fillRect(cx - 8 * p, cy, 2 * p, 10 * p);
      ctx.beginPath();
      ctx.moveTo(cx - 8 * p, cy);
      ctx.lineTo(cx - 12 * p, cy - 2 * p);
      ctx.lineTo(cx - 10 * p, cy + 2 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(148, 0, 211, ${voidWeaponPulse})`;
      ctx.fillRect(cx - 8 * p, cy + 2 * p, 2 * p, 3 * p);
      // Right scythe
      ctx.fillStyle = '#1a0a2e';
      ctx.fillRect(cx + 6 * p, cy, 2 * p, 10 * p);
      ctx.beginPath();
      ctx.moveTo(cx + 8 * p, cy);
      ctx.lineTo(cx + 12 * p, cy - 2 * p);
      ctx.lineTo(cx + 10 * p, cy + 2 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(148, 0, 211, ${voidWeaponPulse})`;
      ctx.fillRect(cx + 6 * p, cy + 2 * p, 2 * p, 3 * p);
      break;
      
    case 'acc_weapon_celestial':
      // Celestial dual orbs
      const celestialOrbPulse = Math.sin(time * 0.002) * 0.3 + 0.7;
      ctx.shadowBlur = 6;
      // Left orb
      ctx.fillStyle = `rgba(255, 250, 205, ${celestialOrbPulse})`;
      ctx.beginPath();
      ctx.arc(cx - 6 * p, cy + 2 * p, 4 * p, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx - 6 * p, cy + 2 * p, 2 * p, 0, Math.PI * 2);
      ctx.fill();
      // Right orb
      ctx.fillStyle = `rgba(255, 250, 205, ${celestialOrbPulse})`;
      ctx.beginPath();
      ctx.arc(cx + 6 * p, cy + 2 * p, 4 * p, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx + 6 * p, cy + 2 * p, 2 * p, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      break;
      
    case 'acc_weapon_galaxy':
      // Galaxy dual blades
      const galaxyWeaponPulse = Math.sin(time * 0.002) * 0.3 + 0.7;
      ctx.fillStyle = '#1a0a3e';
      // Left blade
      ctx.fillRect(cx - 8 * p, cy - 4 * p, 2 * p, 12 * p);
      ctx.fillStyle = `rgba(65, 105, 225, ${galaxyWeaponPulse})`;
      ctx.fillRect(cx - 8 * p, cy - 4 * p, 2 * p, 4 * p);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 8 * p, cy + 2 * p, p, p);
      // Right blade
      ctx.fillStyle = '#1a0a3e';
      ctx.fillRect(cx + 6 * p, cy - 4 * p, 2 * p, 12 * p);
      ctx.fillStyle = `rgba(65, 105, 225, ${galaxyWeaponPulse})`;
      ctx.fillRect(cx + 6 * p, cy - 4 * p, 2 * p, 4 * p);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx + 7 * p, cy + 2 * p, p, p);
      break;
      
    case 'acc_weapon_rainbow':
      // Rainbow dual prisms
      const rainbowWeaponCycle = (time * 0.001) % 1;
      const rainbowColors6 = ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#8b00ff'];
      // Left prism
      const leftPrismGradient = ctx.createLinearGradient(cx - 10 * p, cy - 4 * p, cx - 6 * p, cy + 8 * p);
      for (let i = 0; i < 6; i++) {
        const colorIndex = Math.floor((i + rainbowWeaponCycle * 6) % 6);
        leftPrismGradient.addColorStop(i / 6, rainbowColors6[colorIndex]);
      }
      ctx.fillStyle = leftPrismGradient;
      ctx.fillRect(cx - 8 * p, cy - 4 * p, 2 * p, 12 * p);
      // Right prism
      const rightPrismGradient = ctx.createLinearGradient(cx + 6 * p, cy - 4 * p, cx + 10 * p, cy + 8 * p);
      for (let i = 0; i < 6; i++) {
        const colorIndex = Math.floor((i + rainbowWeaponCycle * 6) % 6);
        rightPrismGradient.addColorStop(i / 6, rainbowColors6[colorIndex]);
      }
      ctx.fillStyle = rightPrismGradient;
      ctx.fillRect(cx + 6 * p, cy - 4 * p, 2 * p, 12 * p);
      break;
      
    case 'acc_backpack':
      ctx.fillStyle = '#8b4513';
      ctx.fillRect(cx - 6 * p, cy - 6 * p, 12 * p, 14 * p);
      ctx.fillStyle = '#a0522d';
      ctx.fillRect(cx - 5 * p, cy - 3 * p, 10 * p, 3 * p);
      ctx.fillStyle = '#654321';
      ctx.fillRect(cx - 4 * p, cy + 2 * p, 8 * p, 4 * p);
      break;
      
    case 'acc_jetpack':
      ctx.fillStyle = '#7f8c8d';
      ctx.fillRect(cx - 7 * p, cy - 6 * p, 6 * p, 14 * p);
      ctx.fillRect(cx + p, cy - 6 * p, 6 * p, 14 * p);
      ctx.fillStyle = '#e67e22';
      ctx.fillRect(cx - 6 * p, cy + 8 * p, 4 * p, 4 * p);
      ctx.fillRect(cx + 2 * p, cy + 8 * p, 4 * p, 4 * p);
      ctx.fillStyle = '#f39c12';
      ctx.fillRect(cx - 5 * p, cy + 10 * p, 2 * p, 4 * p);
      ctx.fillRect(cx + 3 * p, cy + 10 * p, 2 * p, 4 * p);
      break;
      
    case 'acc_sword':
      ctx.fillStyle = '#7f8c8d';
      ctx.fillRect(cx - p, cy - 10 * p, 3 * p, 16 * p);
      ctx.fillStyle = '#bdc3c7';
      ctx.fillRect(cx, cy - 10 * p, p, 14 * p);
      ctx.fillStyle = '#8b4513';
      ctx.fillRect(cx - 3 * p, cy + 4 * p, 7 * p, 4 * p);
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(cx, cy - 10 * p, p, 2 * p);
      break;
      
    case 'acc_staff':
      ctx.fillStyle = '#8b4513';
      ctx.fillRect(cx - p, cy - 6 * p, 3 * p, 18 * p);
      ctx.fillStyle = '#9b59b6';
      ctx.beginPath();
      ctx.arc(cx, cy - 8 * p, 5 * p, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f1c40f';
      ctx.beginPath();
      ctx.arc(cx, cy - 8 * p, 2 * p, 0, Math.PI * 2);
      ctx.fill();
      break;
      
    case 'acc_shield':
      ctx.fillStyle = '#7f8c8d';
      ctx.fillRect(cx - 8 * p, cy - 8 * p, 16 * p, 18 * p);
      ctx.fillStyle = '#bdc3c7';
      ctx.fillRect(cx - 6 * p, cy - 6 * p, 12 * p, 14 * p);
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(cx - 2 * p, cy - 4 * p, 4 * p, 10 * p);
      ctx.fillRect(cx - 4 * p, cy - p, 8 * p, 4 * p);
      break;
      
    case 'acc_guitar':
      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 4 * p, 7 * p, 9 * p, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8b4513';
      ctx.fillRect(cx - 2 * p, cy - 12 * p, 4 * p, 16 * p);
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(cx - 4 * p, cy - 12 * p, 8 * p, 3 * p);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(cx - p, cy + p, 2 * p, 6 * p);
      break;
      
    case 'acc_wand':
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(cx - p, cy - 2 * p, 3 * p, 14 * p);
      ctx.fillStyle = '#ff69b4';
      ctx.beginPath();
      ctx.arc(cx, cy - 6 * p, 5 * p, 0, Math.PI * 2);
      ctx.fill();
      // Sparkles
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 6 * p, cy - 10 * p, 2 * p, 2 * p);
      ctx.fillRect(cx + 4 * p, cy - 8 * p, 2 * p, 2 * p);
      ctx.fillRect(cx - 2 * p, cy - 12 * p, 2 * p, 2 * p);
      break;
      
    case 'acc_aura_fire':
      ctx.fillStyle = 'rgba(231, 76, 60, 0.5)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 11 * p, 11 * p, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(241, 196, 15, 0.4)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 7 * p, 7 * p, 0, 0, Math.PI * 2);
      ctx.fill();
      // Flames
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath();
      ctx.moveTo(cx - 8 * p, cy + 4 * p);
      ctx.lineTo(cx - 6 * p, cy - 8 * p);
      ctx.lineTo(cx - 4 * p, cy + 2 * p);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 4 * p, cy + 4 * p);
      ctx.lineTo(cx + 6 * p, cy - 10 * p);
      ctx.lineTo(cx + 8 * p, cy + 2 * p);
      ctx.closePath();
      ctx.fill();
      break;
      
    case 'acc_aura_ice':
      ctx.fillStyle = 'rgba(52, 152, 219, 0.5)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 11 * p, 11 * p, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(236, 240, 241, 0.4)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 7 * p, 7 * p, 0, 0, Math.PI * 2);
      ctx.fill();
      // Ice crystals
      ctx.fillStyle = '#ecf0f1';
      ctx.fillRect(cx - p, cy - 10 * p, 2 * p, 8 * p);
      ctx.fillRect(cx - 8 * p, cy - 4 * p, 6 * p, 2 * p);
      ctx.fillRect(cx + 2 * p, cy + 2 * p, 6 * p, 2 * p);
      break;
      
    case 'acc_aura_golden':
      // Golden aura with shimmer
      const goldenPulse = Math.sin(time * 0.002) * 0.1 + 0.9;
      ctx.fillStyle = `rgba(255, 215, 0, ${0.4 * goldenPulse})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 11 * p * goldenPulse, 11 * p * goldenPulse, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 236, 139, ${0.3 * goldenPulse})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 7 * p * goldenPulse, 7 * p * goldenPulse, 0, 0, Math.PI * 2);
      ctx.fill();
      // Sparkles
      const goldenSparkle = (time * 0.002) % 1;
      if (goldenSparkle < 0.3) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx - 8 * p, cy - 6 * p, p, p);
        ctx.fillRect(cx + 7 * p, cy - 4 * p, p, p);
        ctx.fillRect(cx - 2 * p, cy + 6 * p, p, p);
      }
      break;
      
    case 'acc_aura_phoenix':
      // Phoenix aura with flames
      const phoenixPulse = Math.sin(time * 0.002) * 0.1 + 0.9;
      ctx.fillStyle = `rgba(255, 102, 0, ${0.4 * phoenixPulse})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 11 * p * phoenixPulse, 11 * p * phoenixPulse, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 215, 0, ${0.3 * phoenixPulse})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 7 * p * phoenixPulse, 7 * p * phoenixPulse, 0, 0, Math.PI * 2);
      ctx.fill();
      // Rising embers
      const emberY4 = cy - 8 * p - (time * 0.1) % 6;
      ctx.fillStyle = `rgba(255, 200, 0, ${0.6 + Math.sin(time * 0.005) * 0.4})`;
      ctx.fillRect(cx - 3 * p, emberY4, 2 * p, 2 * p);
      ctx.fillRect(cx + 2 * p, emberY4 - 2 * p, 2 * p, 2 * p);
      break;
      
    case 'acc_aura_void':
      // Void aura with swirling particles
      const voidPulse4 = Math.sin(time * 0.0015) * 0.08 + 0.92;
      ctx.fillStyle = `rgba(75, 0, 130, ${0.4 * voidPulse4})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 11 * p * voidPulse4, 11 * p * voidPulse4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(148, 0, 211, ${0.3 * voidPulse4})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 7 * p * voidPulse4, 7 * p * voidPulse4, 0, 0, Math.PI * 2);
      ctx.fill();
      // Swirling void particles
      const voidAngle4 = (time * 0.001) % (Math.PI * 2);
      const voidX4 = cx + Math.cos(voidAngle4) * 6 * p;
      const voidY4 = cy + Math.sin(voidAngle4) * 4 * p;
      ctx.fillStyle = `rgba(75, 0, 130, ${0.5 + Math.sin(time * 0.003) * 0.5})`;
      ctx.fillRect(voidX4 - p, voidY4 - p, 2 * p, 2 * p);
      break;
      
    case 'acc_aura_celestial':
      // Celestial aura with twinkling stars
      const celestialPulse2 = Math.sin(time * 0.002) * 0.1 + 0.9;
      ctx.fillStyle = `rgba(255, 250, 205, ${0.4 * celestialPulse2})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 11 * p * celestialPulse2, 11 * p * celestialPulse2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 255, 255, ${0.3 * celestialPulse2})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 7 * p * celestialPulse2, 7 * p * celestialPulse2, 0, 0, Math.PI * 2);
      ctx.fill();
      // Twinkling stars
      const starTwinkle4 = (time * 0.003) % 1;
      if (starTwinkle4 < 0.5) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx - 8 * p, cy - 6 * p, p, p);
        ctx.fillRect(cx + 7 * p, cy - 4 * p, p, p);
        ctx.fillRect(cx - 2 * p, cy + 6 * p, p, p);
        ctx.fillRect(cx + 3 * p, cy + 5 * p, p, p);
      }
      break;
      
    case 'acc_aura_galaxy':
      // Galaxy aura with cosmic sparkles
      const galaxyPulse2 = Math.sin(time * 0.002) * 0.1 + 0.9;
      ctx.fillStyle = `rgba(26, 10, 62, ${0.4 * galaxyPulse2})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 11 * p * galaxyPulse2, 11 * p * galaxyPulse2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(65, 105, 225, ${0.3 * galaxyPulse2})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 7 * p * galaxyPulse2, 7 * p * galaxyPulse2, 0, 0, Math.PI * 2);
      ctx.fill();
      // Cosmic sparkles
      const galaxyTwinkle3 = Math.sin(time * 0.004) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(255, 255, 255, ${galaxyTwinkle3})`;
      ctx.fillRect(cx - 8 * p, cy - 6 * p, p, p);
      ctx.fillRect(cx + 7 * p, cy - 4 * p, p, p);
      ctx.fillRect(cx - 2 * p, cy + 6 * p, p, p);
      // Swirling cosmic particle
      const cosmicAngle4 = (time * 0.0015) % (Math.PI * 2);
      const cosmicX4 = cx + Math.cos(cosmicAngle4) * 5 * p;
      const cosmicY4 = cy + Math.sin(cosmicAngle4) * 3 * p;
      ctx.fillStyle = '#00ced1';
      ctx.fillRect(cosmicX4 - p, cosmicY4 - p, 2 * p, 2 * p);
      break;
      
    case 'acc_aura_rainbow':
      // Rainbow aura with color cycling
      const rainbowPulse2 = Math.sin(time * 0.002) * 0.1 + 0.9;
      const rainbowCycle2 = (time * 0.001) % 1;
      const gradient2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, 11 * p);
      const rainbowColors4 = ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#8b00ff'];
      for (let i = 0; i < 6; i++) {
        const colorIndex = Math.floor((i + rainbowCycle2 * 6) % 6);
        gradient2.addColorStop(i / 6, rainbowColors4[colorIndex] + '80');
      }
      ctx.fillStyle = gradient2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 11 * p * rainbowPulse2, 11 * p * rainbowPulse2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
      
    default:
      // Generic accessory
      ctx.fillStyle = '#888888';
      ctx.fillRect(cx - 6 * p, cy - 6 * p, 12 * p, 12 * p);
  }
}

function drawToolPreview(ctx: CanvasRenderingContext2D, itemId: string, cx: number, cy: number, p: number, time: number = 0): void {
  switch (itemId) {
    case 'tool_axe':
      // Draw axe - handle and blade
      // Handle (vertical brown stick)
      ctx.fillStyle = '#8b4513'; // Brown handle
      ctx.fillRect(cx - p, cy - 8 * p, 2 * p, 16 * p);
      
      // Blade (diagonal gray metal)
      ctx.fillStyle = '#7f8c8d'; // Gray metal
      // Main blade shape - triangle pointing down-right
      ctx.beginPath();
      ctx.moveTo(cx + p, cy - 6 * p);
      ctx.lineTo(cx + 8 * p, cy - 2 * p);
      ctx.lineTo(cx + 6 * p, cy + 2 * p);
      ctx.closePath();
      ctx.fill();
      
      // Blade edge (lighter gray)
      ctx.fillStyle = '#bdc3c7';
      ctx.beginPath();
      ctx.moveTo(cx + p, cy - 6 * p);
      ctx.lineTo(cx + 7 * p, cy - 2 * p);
      ctx.lineTo(cx + 5 * p, cy + p);
      ctx.closePath();
      ctx.fill();
      
      // Blade tip (sharp edge)
      ctx.fillStyle = '#ecf0f1';
      ctx.fillRect(cx + 7 * p, cy - 2 * p, p, p);
      
      // Handle grip (darker brown bands)
      ctx.fillStyle = '#654321';
      ctx.fillRect(cx - p, cy + 4 * p, 2 * p, 2 * p);
      ctx.fillRect(cx - p, cy + 8 * p, 2 * p, 2 * p);
      break;
      
    default:
      // Generic tool
      ctx.fillStyle = '#888888';
      ctx.fillRect(cx - 6 * p, cy - 6 * p, 12 * p, 12 * p);
  }
}

function drawLegsPreview(ctx: CanvasRenderingContext2D, itemId: string, cx: number, cy: number, p: number, time: number = 0): void {
  // Draw two legs
  const legW = 6 * p;
  const legH = 12 * p;
  const gap = 2 * p;
  
  let color = '#3498db'; // Default blue pants
  let detail = '';
  
  switch (itemId) {
    case 'legs_jeans_blue': color = '#3b5998'; break;
    case 'legs_jeans_black': color = '#1a1a1a'; break;
    case 'legs_shorts': color = '#6b8e23'; detail = 'shorts'; break;
    case 'legs_sweatpants': color = '#696969'; break;
    case 'legs_chef': color = '#ffffff'; break;
    case 'legs_suit': color = '#2c2c2c'; break;
    case 'legs_lab': color = '#f5f5f5'; break;
    case 'legs_wizard': color = '#6b4c9a'; detail = 'robe'; break;
    case 'legs_knight': color = '#7f8c8d'; detail = 'armor'; break;
    case 'legs_samurai': color = '#8b0000'; detail = 'armor'; break;
    case 'legs_ninja': color = '#1a1a1a'; break;
    case 'legs_pirate': color = '#4a3728'; break;
    case 'legs_viking': color = '#8b6914'; break;
    case 'legs_cowboy': color = '#8b4513'; detail = 'chaps'; break;
    case 'legs_astronaut': color = '#ecf0f1'; detail = 'space'; break;
    case 'legs_punk': color = '#1a1a1a'; detail = 'ripped'; break;
    case 'legs_neon': color = '#1a1a2e'; detail = 'neon'; break;
    case 'legs_princess': color = '#ff69b4'; detail = 'skirt'; break;
    case 'legs_angel': color = '#fff8dc'; detail = 'robe'; break;
    case 'legs_dragon': color = '#8b0000'; detail = 'scales'; break;
    case 'legs_demon': color = '#2c0000'; detail = 'demon'; break;
    case 'legs_phoenix': color = '#ff4500'; detail = 'flame'; break;
    case 'legs_gold': color = '#daa520'; detail = 'gold'; break;
    // Legendary legs
    case 'legs_phoenix_legendary': color = '#ff4500'; detail = 'phoenix_legendary'; break;
    case 'legs_void': color = '#2d0a4e'; detail = 'void'; break;
    case 'legs_celestial': color = '#e8e8ff'; detail = 'celestial'; break;
    case 'legs_galaxy': color = '#1a0a3e'; detail = 'galaxy'; break;
    case 'legs_rainbow': color = '#ff6b6b'; detail = 'rainbow'; break;
  }
  
  // Left leg
  const leftX = cx - legW - gap / 2;
  const rightX = cx + gap / 2;
  const legY = cy - legH / 2;
  
  // Draw legs outline
  ctx.fillStyle = '#2c3e50';
  ctx.fillRect(leftX - p, legY - p, legW + 2 * p, legH + 2 * p);
  ctx.fillRect(rightX - p, legY - p, legW + 2 * p, legH + 2 * p);
  
  // Draw legs fill
  ctx.fillStyle = color;
  ctx.fillRect(leftX, legY, legW, legH);
  ctx.fillRect(rightX, legY, legW, legH);
  
  // Draw details based on type
  switch (detail) {
    case 'shorts':
      // Show skin below shorts
      ctx.fillStyle = '#ffd5b5';
      ctx.fillRect(leftX, legY + legH * 0.5, legW, legH * 0.5);
      ctx.fillRect(rightX, legY + legH * 0.5, legW, legH * 0.5);
      break;
      
    case 'robe':
      // Flowing robe bottom
      ctx.fillRect(leftX - 2 * p, legY + legH - 3 * p, legW + 4 * p, 3 * p);
      ctx.fillRect(rightX - 2 * p, legY + legH - 3 * p, legW + 4 * p, 3 * p);
      break;
      
    case 'armor':
      // Metal shine
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(leftX + p, legY + 2 * p, 2 * p, legH - 4 * p);
      ctx.fillRect(rightX + p, legY + 2 * p, 2 * p, legH - 4 * p);
      break;
      
    case 'chaps':
      // Leather fringe
      ctx.fillStyle = '#a0522d';
      ctx.fillRect(leftX + legW - 2 * p, legY + 2 * p, 2 * p, legH - 4 * p);
      ctx.fillRect(rightX, legY + 2 * p, 2 * p, legH - 4 * p);
      break;
      
    case 'space':
      // Blue accents
      ctx.fillStyle = '#3498db';
      ctx.fillRect(leftX + 2 * p, legY + 3 * p, 2 * p, 3 * p);
      ctx.fillRect(rightX + 2 * p, legY + 3 * p, 2 * p, 3 * p);
      break;
      
    case 'ripped':
      // Ripped holes showing skin
      ctx.fillStyle = '#ffd5b5';
      ctx.fillRect(leftX + 2 * p, legY + 3 * p, 2 * p, 2 * p);
      ctx.fillRect(rightX + p, legY + 5 * p, 3 * p, 2 * p);
      break;
      
    case 'neon':
      // Neon stripes
      ctx.fillStyle = '#00ffff';
      ctx.fillRect(leftX, legY, p, legH);
      ctx.fillRect(rightX + legW - p, legY, p, legH);
      ctx.fillStyle = '#ff00ff';
      ctx.fillRect(leftX + legW - p, legY, p, legH);
      ctx.fillRect(rightX, legY, p, legH);
      break;
      
    case 'skirt':
      // Flowing skirt
      ctx.fillRect(leftX - 3 * p, legY, legW * 2 + gap + 6 * p, 4 * p);
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(leftX + 2 * p, legY + p, 2 * p, 2 * p);
      ctx.fillRect(rightX + 2 * p, legY + p, 2 * p, 2 * p);
      break;
      
    case 'scales':
      // Dragon scale pattern
      ctx.fillStyle = '#ff4500';
      ctx.fillRect(leftX + 2 * p, legY + 2 * p, 2 * p, 2 * p);
      ctx.fillRect(leftX + 2 * p, legY + 6 * p, 2 * p, 2 * p);
      ctx.fillRect(rightX + 2 * p, legY + 4 * p, 2 * p, 2 * p);
      ctx.fillRect(rightX + 2 * p, legY + 8 * p, 2 * p, 2 * p);
      break;
      
    case 'demon':
      // Glowing red accents
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(leftX, legY + legH - 2 * p, legW, 2 * p);
      ctx.fillRect(rightX, legY + legH - 2 * p, legW, 2 * p);
      break;
      
    case 'flame':
      // Phoenix flame details
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(leftX + 2 * p, legY + legH - 3 * p, 2 * p, 3 * p);
      ctx.fillRect(rightX + 2 * p, legY + legH - 3 * p, 2 * p, 3 * p);
      break;
      
    case 'gold':
      // Golden shine
      ctx.fillStyle = '#fff8dc';
      ctx.fillRect(leftX + 2 * p, legY + 2 * p, 2 * p, legH - 4 * p);
      ctx.fillRect(rightX + 2 * p, legY + 2 * p, 2 * p, legH - 4 * p);
      ctx.fillStyle = '#b8860b';
      ctx.fillRect(leftX, legY, legW, 2 * p);
      ctx.fillRect(rightX, legY, legW, 2 * p);
      break;
      
    // === LEGENDARY LEGS ===
    case 'phoenix_legendary':
      // Phoenix greaves with animated flame pattern
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(leftX + p, legY + 2 * p, 2 * p, 3 * p);
      ctx.fillRect(rightX + p, legY + 2 * p, 2 * p, 3 * p);
      const flamePulse = Math.sin(time * 0.003) * 0.3 + 0.7;
      ctx.fillStyle = `rgba(255, 102, 0, ${flamePulse})`;
      ctx.fillRect(leftX + 2 * p, legY + legH - 3 * p, 2 * p, 3 * p);
      ctx.fillRect(rightX + 2 * p, legY + legH - 3 * p, 2 * p, 3 * p);
      break;
      
    case 'void':
      // Void leggings with animated dark energy
      const voidPulse2 = Math.sin(time * 0.002) * 0.3 + 0.7;
      ctx.fillStyle = `rgba(75, 0, 130, ${voidPulse2})`;
      ctx.fillRect(leftX + p, legY + 2 * p, p, legH - 4 * p);
      ctx.fillRect(rightX + legW - 2 * p, legY + 2 * p, p, legH - 4 * p);
      ctx.fillStyle = `rgba(148, 0, 211, ${voidPulse2})`;
      ctx.fillRect(leftX + 3 * p, legY + 4 * p, p, p);
      ctx.fillRect(rightX + p, legY + 6 * p, p, p);
      break;
      
    case 'celestial':
      // Celestial pants with twinkling star pattern
      const starTwinkle2 = (time * 0.003) % 1;
      if (starTwinkle2 < 0.5) {
        ctx.fillStyle = '#fffacd';
        ctx.fillRect(leftX + 2 * p, legY + 3 * p, p, p);
        ctx.fillRect(rightX + 3 * p, legY + 5 * p, p, p);
        ctx.fillRect(leftX + 3 * p, legY + 7 * p, p, p);
        ctx.fillRect(rightX + p, legY + 9 * p, p, p);
      }
      break;
      
    case 'galaxy':
      // Galactic leggings with animated cosmic swirls
      ctx.fillStyle = '#4169e1';
      ctx.fillRect(leftX + p, legY + 2 * p, 2 * p, 3 * p);
      ctx.fillRect(rightX + p, legY + 5 * p, 2 * p, 3 * p);
      const galaxyTwinkle2 = Math.sin(time * 0.004) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(255, 255, 255, ${galaxyTwinkle2})`;
      ctx.fillRect(leftX + 3 * p, legY + 4 * p, p, p);
      ctx.fillRect(rightX + 3 * p, legY + 7 * p, p, p);
      break;
      
    case 'rainbow':
      // Prismatic pants with animated rainbow bands
      const rainbowOffset3 = (time * 0.001) % 1;
      const rainbowColors2 = ['#ff7f00', '#ffff00', '#00ff00', '#0000ff'];
      for (let i = 0; i < 4; i++) {
        const colorIndex = Math.floor((i + rainbowOffset3 * 4) % 4);
        ctx.fillStyle = rainbowColors2[colorIndex];
        ctx.fillRect(leftX, legY + (1 + i * 2) * p, legW, p);
        ctx.fillRect(rightX, legY + (1 + i * 2) * p, legW, p);
      }
      break;
  }
  
  // Draw shoes
  ctx.fillStyle = '#2c3e50';
  ctx.fillRect(leftX - p, legY + legH - 2 * p, legW + p, 3 * p);
  ctx.fillRect(rightX, legY + legH - 2 * p, legW + p, 3 * p);
}

function drawBoostPreview(ctx: CanvasRenderingContext2D, itemId: string, cx: number, cy: number, p: number, rarity?: string, item?: ShopItem, time: number = 0): void {
  // Get rarity color for the boost
  let primaryColor = '#27ae60'; // green default
  let secondaryColor = '#2ecc71';
  let glowColor = 'rgba(46, 204, 113, 0.5)';
  
  switch (rarity) {
    case 'common':
      primaryColor = '#7f8c8d';
      secondaryColor = '#95a5a6';
      glowColor = 'rgba(149, 165, 166, 0.4)';
      break;
    case 'uncommon':
      primaryColor = '#27ae60';
      secondaryColor = '#2ecc71';
      glowColor = 'rgba(46, 204, 113, 0.5)';
      break;
    case 'rare':
      primaryColor = '#2980b9';
      secondaryColor = '#3498db';
      glowColor = 'rgba(52, 152, 219, 0.5)';
      break;
    case 'epic':
      primaryColor = '#8e44ad';
      secondaryColor = '#9b59b6';
      glowColor = 'rgba(155, 89, 182, 0.5)';
      break;
    case 'legendary':
      primaryColor = '#d68910';
      secondaryColor = '#f39c12';
      glowColor = 'rgba(243, 156, 18, 0.5)';
      break;
  }
  
  // Draw glow background
  ctx.fillStyle = glowColor;
  ctx.beginPath();
  ctx.arc(cx, cy, 10 * p, 0, Math.PI * 2);
  ctx.fill();
  
  // Check if this is a speed boost or orb multiplier boost
  const isOrbBoost = item && item.orbMultiplier && item.orbMultiplier > 1;
  const isSpeedBoost = item && item.speedMultiplier && item.speedMultiplier > 1;
  
  if (isOrbBoost) {
    // Draw dollar sign for orb multiplier boosts (pixelated style)
    const dollarSize = 8 * p;
    const dollarX = cx;
    const dollarY = cy;
    
    // Draw dollar sign using rectangles for pixelated look
    ctx.fillStyle = primaryColor;
    
    // Vertical line (main part)
    ctx.fillRect(dollarX - 1.5 * p, dollarY - 6 * p, 3 * p, 12 * p);
    
    // Top horizontal line
    ctx.fillRect(dollarX - 4 * p, dollarY - 4 * p, 8 * p, 2 * p);
    
    // Middle horizontal line
    ctx.fillRect(dollarX - 4 * p, dollarY, 8 * p, 2 * p);
    
    // Bottom horizontal line
    ctx.fillRect(dollarX - 4 * p, dollarY + 4 * p, 8 * p, 2 * p);
    
    // Add highlight/shine effect
    ctx.fillStyle = secondaryColor;
    ctx.fillRect(dollarX - 1.5 * p, dollarY - 6 * p, 2 * p, 3 * p); // Top highlight
    ctx.fillRect(dollarX - 3 * p, dollarY - 4 * p, 5 * p, 1 * p); // Top line highlight
    ctx.fillRect(dollarX - 3 * p, dollarY, 5 * p, 1 * p); // Middle line highlight
    ctx.fillRect(dollarX - 3 * p, dollarY + 4 * p, 5 * p, 1 * p); // Bottom line highlight
  } else if (isSpeedBoost) {
    // Draw speed lines / motion blur effect
    ctx.strokeStyle = secondaryColor;
    ctx.lineWidth = 2 * p;
    ctx.globalAlpha = 0.6;
    
    // Motion lines
    for (let i = 0; i < 3; i++) {
      const y = cy - 4 * p + i * 4 * p;
      ctx.beginPath();
      ctx.moveTo(cx - 10 * p, y);
      ctx.lineTo(cx - 4 * p, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    
    // Draw lightning bolt (speed symbol)
    ctx.fillStyle = primaryColor;
    ctx.beginPath();
    ctx.moveTo(cx + 2 * p, cy - 8 * p);  // Top
    ctx.lineTo(cx - 4 * p, cy + p);       // Left middle
    ctx.lineTo(cx - p, cy + p);           // Inner left
    ctx.lineTo(cx - 3 * p, cy + 8 * p);   // Bottom
    ctx.lineTo(cx + 4 * p, cy - p);       // Right middle
    ctx.lineTo(cx + p, cy - p);           // Inner right
    ctx.closePath();
    ctx.fill();
    
    // Highlight on lightning
    ctx.fillStyle = secondaryColor;
    ctx.beginPath();
    ctx.moveTo(cx + p, cy - 6 * p);
    ctx.lineTo(cx - 2 * p, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + 2 * p, cy - 4 * p);
    ctx.closePath();
    ctx.fill();
  } else {
    // Fallback: draw lightning bolt if we can't determine type
    ctx.fillStyle = primaryColor;
    ctx.beginPath();
    ctx.moveTo(cx + 2 * p, cy - 8 * p);
    ctx.lineTo(cx - 4 * p, cy + p);
    ctx.lineTo(cx - p, cy + p);
    ctx.lineTo(cx - 3 * p, cy + 8 * p);
    ctx.lineTo(cx + 4 * p, cy - p);
    ctx.lineTo(cx + p, cy - p);
    ctx.closePath();
    ctx.fill();
  }
  
  // Sparkles around based on rarity
  if (rarity === 'epic' || rarity === 'legendary') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - 8 * p, cy - 6 * p, 2 * p, 2 * p);
    ctx.fillRect(cx + 6 * p, cy - 4 * p, 2 * p, 2 * p);
    ctx.fillRect(cx + 5 * p, cy + 5 * p, 2 * p, 2 * p);
    ctx.fillRect(cx - 7 * p, cy + 4 * p, 2 * p, 2 * p);
  }
  
  if (rarity === 'legendary') {
    // Animated golden sparkles
    const sparklePhase2 = (time * 0.002) % 1;
    if (sparklePhase2 < 0.3) {
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(cx - 9 * p, cy, 2 * p, 2 * p);
      ctx.fillRect(cx + 8 * p, cy, 2 * p, 2 * p);
      ctx.fillRect(cx, cy - 10 * p, 2 * p, 2 * p);
      ctx.fillRect(cx, cy + 8 * p, 2 * p, 2 * p);
    }
  }
}

function drawCapePreview(ctx: CanvasRenderingContext2D, itemId: string, cx: number, cy: number, p: number, time: number = 0): void {
  const capeW = 14 * p;
  const capeH = 18 * p;
  const x = cx - capeW / 2;
  const y = cy - capeH / 2;
  
  // Cape colors based on item
  const CAPE_COLORS: Record<string, { main: string; accent: string; pattern?: string }> = {
    'cape_red': { main: '#c0392b', accent: '#e74c3c' },
    'cape_blue': { main: '#2980b9', accent: '#3498db' },
    'cape_green': { main: '#27ae60', accent: '#2ecc71' },
    'cape_black': { main: '#1a1a1a', accent: '#2c2c2c' },
    'cape_white': { main: '#ecf0f1', accent: '#ffffff' },
    'cape_purple': { main: '#8e44ad', accent: '#9b59b6' },
    'cape_royal': { main: '#9b59b6', accent: '#f1c40f', pattern: 'trim' },
    'cape_knight': { main: '#34495e', accent: '#95a5a6', pattern: 'trim' },
    'cape_wizard': { main: '#2c3e50', accent: '#f1c40f', pattern: 'stars' },
    'cape_vampire': { main: '#1a0a0a', accent: '#8b0000', pattern: 'trim' },
    'cape_ninja': { main: '#0a0a0a', accent: '#1a1a1a' },
    'cape_pirate': { main: '#2c1810', accent: '#f1c40f', pattern: 'trim' },
    'cape_fire': { main: '#e74c3c', accent: '#f39c12', pattern: 'flames' },
    'cape_ice': { main: '#74b9ff', accent: '#dfe6e9', pattern: 'frost' },
    'cape_lightning': { main: '#9b59b6', accent: '#f1c40f', pattern: 'lightning' },
    'cape_nature': { main: '#27ae60', accent: '#2ecc71', pattern: 'leaves' },
    'cape_dragon': { main: '#2c3e50', accent: '#c0392b', pattern: 'scales' },
    'cape_phoenix': { main: '#e74c3c', accent: '#f39c12', pattern: 'feathers' },
    'cape_void': { main: '#0a0010', accent: '#6a0dad', pattern: 'void' },
    'cape_celestial': { main: '#1a1a4e', accent: '#ffd700', pattern: 'stars' },
    'cape_rainbow': { main: '#ff0000', accent: '#ff00ff', pattern: 'rainbow' },
    'cape_galaxy': { main: '#0a0020', accent: '#4a0080', pattern: 'galaxy' },
  };
  
  const colors = CAPE_COLORS[itemId] || { main: '#666666', accent: '#888888' };
  
  // Draw cape shape with wavy bottom
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + capeW, y);
  ctx.lineTo(x + capeW, y + capeH - 4 * p);
  // Wavy bottom
  ctx.quadraticCurveTo(x + capeW * 0.75, y + capeH + 2 * p, x + capeW / 2, y + capeH - 2 * p);
  ctx.quadraticCurveTo(x + capeW * 0.25, y + capeH + 2 * p, x, y + capeH - 4 * p);
  ctx.closePath();
  
  // Fill with gradient or pattern
  if (colors.pattern === 'rainbow') {
    // Animated rainbow with color cycling
    const rainbowOffset4 = (time * 0.001) % 1;
    const gradient = ctx.createLinearGradient(x, y, x + capeW, y + capeH);
    const rainbowColors3 = ['#e74c3c', '#f39c12', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6'];
    for (let i = 0; i < 7; i++) {
      const colorIndex = Math.floor((i + rainbowOffset4 * 6) % 6);
      gradient.addColorStop(i / 6, rainbowColors3[colorIndex]);
    }
    ctx.fillStyle = gradient;
  } else if (colors.pattern === 'flames') {
    const gradient = ctx.createLinearGradient(x, y, x, y + capeH);
    gradient.addColorStop(0, colors.main);
    gradient.addColorStop(0.5, colors.accent);
    gradient.addColorStop(1, '#f1c40f');
    ctx.fillStyle = gradient;
  } else if (colors.pattern === 'frost') {
    const gradient = ctx.createLinearGradient(x, y, x, y + capeH);
    gradient.addColorStop(0, '#a29bfe');
    gradient.addColorStop(0.5, colors.main);
    gradient.addColorStop(1, colors.accent);
    ctx.fillStyle = gradient;
  } else if (colors.pattern === 'galaxy') {
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, capeH);
    gradient.addColorStop(0, '#4a0080');
    gradient.addColorStop(0.5, '#1a0040');
    gradient.addColorStop(1, colors.main);
    ctx.fillStyle = gradient;
  } else {
    const gradient = ctx.createLinearGradient(x, y, x, y + capeH);
    gradient.addColorStop(0, colors.accent);
    gradient.addColorStop(1, colors.main);
    ctx.fillStyle = gradient;
  }
  ctx.fill();
  
  // Draw patterns
  if (colors.pattern === 'trim') {
    ctx.fillStyle = colors.accent;
    ctx.fillRect(x, y, capeW, 3 * p); // Top trim
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 2 * p;
    ctx.stroke();
  }
  
  if (colors.pattern === 'stars' || colors.pattern === 'galaxy') {
    // Twinkling stars
    const starTwinkle3 = (time * 0.003) % 1;
    if (starTwinkle3 < 0.5) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + 3 * p, y + 4 * p, p, p);
      ctx.fillRect(x + 8 * p, y + 6 * p, p, p);
      ctx.fillRect(x + 5 * p, y + 10 * p, p, p);
      ctx.fillRect(x + 10 * p, y + 12 * p, p, p);
    }
    // For galaxy, add swirling particle
    if (colors.pattern === 'galaxy') {
      const cosmicAngle3 = (time * 0.0015) % (Math.PI * 2);
      const cosmicX3 = cx + Math.cos(cosmicAngle3) * 4 * p;
      const cosmicY3 = cy + Math.sin(cosmicAngle3) * 3 * p;
      ctx.fillStyle = '#00ced1';
      ctx.fillRect(cosmicX3 - p, cosmicY3 - p, 2 * p, 2 * p);
    }
  }
  
  if (colors.pattern === 'scales') {
    ctx.fillStyle = colors.accent;
    ctx.globalAlpha = 0.4;
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 3; col++) {
        const scaleX = x + 2 * p + col * 4 * p + (row % 2) * 2 * p;
        const scaleY = y + 3 * p + row * 4 * p;
        ctx.beginPath();
        ctx.arc(scaleX + 2 * p, scaleY, 2 * p, 0, Math.PI);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
  
  if (colors.pattern === 'lightning') {
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.moveTo(cx, y + 4 * p);
    ctx.lineTo(cx - 3 * p, y + 9 * p);
    ctx.lineTo(cx, y + 8 * p);
    ctx.lineTo(cx - 2 * p, y + 14 * p);
    ctx.lineTo(cx + 2 * p, y + 10 * p);
    ctx.lineTo(cx, y + 11 * p);
    ctx.closePath();
    ctx.fill();
  }
  
  if (colors.pattern === 'void') {
    // Animated void swirl
    const voidPulse3 = Math.sin(time * 0.002) * 0.3 + 0.7;
    ctx.strokeStyle = `rgba(106, 13, 173, ${voidPulse3 * 0.6})`;
    ctx.lineWidth = p;
    ctx.globalAlpha = voidPulse3 * 0.6;
    ctx.beginPath();
    const voidRotation = (time * 0.0005) % (Math.PI * 2);
    for (let i = 0; i < 15; i++) {
      const angle = (i / 15) * Math.PI * 3 + voidRotation;
      const radius = (i / 15) * 5 * p;
      const px = cx + Math.cos(angle) * radius;
      const py = cy + Math.sin(angle) * radius * 0.6;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  
  if (colors.pattern === 'feathers') {
    // Animated phoenix feathers with embers
    const featherPulse = Math.sin(time * 0.003) * 0.3 + 0.7;
    ctx.fillStyle = `rgba(241, 196, 15, ${featherPulse})`;
    ctx.fillRect(x + 2 * p, y + capeH - 6 * p, 2 * p, 4 * p);
    ctx.fillRect(x + 6 * p, y + capeH - 8 * p, 2 * p, 4 * p);
    ctx.fillRect(x + 10 * p, y + capeH - 6 * p, 2 * p, 4 * p);
    // Rising embers
    const emberY3 = y + capeH - (time * 0.08) % 8;
    ctx.fillStyle = `rgba(255, 150, 0, ${0.6 + Math.sin(time * 0.005) * 0.4})`;
    ctx.fillRect(x + 3 * p, emberY3, 2 * p, 2 * p);
    ctx.fillRect(x + 7 * p, emberY3 - 2 * p, 2 * p, 2 * p);
  }
  
  // Collar/clasp
  ctx.fillStyle = colors.accent;
  ctx.fillRect(cx - 4 * p, y - p, 8 * p, 3 * p);
}

function drawWingsPreview(ctx: CanvasRenderingContext2D, itemId: string, cx: number, cy: number, p: number, time: number = 0): void {
  switch (itemId) {
    case 'acc_wings_angel':
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(cx - 2 * p, cy);
      ctx.lineTo(cx - 12 * p, cy - 8 * p);
      ctx.lineTo(cx - 10 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 2 * p, cy);
      ctx.lineTo(cx + 12 * p, cy - 8 * p);
      ctx.lineTo(cx + 10 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      break;
      
    case 'acc_wings_devil':
      ctx.fillStyle = '#4a0000';
      ctx.beginPath();
      ctx.moveTo(cx - 2 * p, cy);
      ctx.lineTo(cx - 10 * p, cy - 10 * p);
      ctx.lineTo(cx - 12 * p, cy);
      ctx.lineTo(cx - 8 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 2 * p, cy);
      ctx.lineTo(cx + 10 * p, cy - 10 * p);
      ctx.lineTo(cx + 12 * p, cy);
      ctx.lineTo(cx + 8 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      break;
      
    case 'acc_wings_fairy':
      ctx.fillStyle = 'rgba(255, 182, 193, 0.7)';
      ctx.beginPath();
      ctx.ellipse(cx - 7 * p, cy, 6 * p, 10 * p, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + 7 * p, cy, 6 * p, 10 * p, 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
      
    case 'acc_wings_dragon':
      ctx.fillStyle = '#2c3e50';
      ctx.beginPath();
      ctx.moveTo(cx - 2 * p, cy);
      ctx.lineTo(cx - 8 * p, cy - 10 * p);
      ctx.lineTo(cx - 14 * p, cy - 4 * p);
      ctx.lineTo(cx - 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 2 * p, cy);
      ctx.lineTo(cx + 8 * p, cy - 10 * p);
      ctx.lineTo(cx + 14 * p, cy - 4 * p);
      ctx.lineTo(cx + 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(cx - 10 * p, cy - 2 * p, 2 * p, 4 * p);
      ctx.fillRect(cx + 8 * p, cy - 2 * p, 2 * p, 4 * p);
      break;
      
    case 'acc_wings_golden':
      const goldenWingPulse = Math.sin(time * 0.002) * 0.1 + 0.9;
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.moveTo(cx - 2 * p, cy);
      ctx.lineTo(cx - 8 * p, cy - 10 * p);
      ctx.lineTo(cx - 14 * p, cy - 4 * p);
      ctx.lineTo(cx - 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255, 236, 139, ${goldenWingPulse})`;
      ctx.fillRect(cx - 10 * p, cy - 2 * p, 2 * p, 4 * p);
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.moveTo(cx + 2 * p, cy);
      ctx.lineTo(cx + 8 * p, cy - 10 * p);
      ctx.lineTo(cx + 14 * p, cy - 4 * p);
      ctx.lineTo(cx + 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255, 236, 139, ${goldenWingPulse})`;
      ctx.fillRect(cx + 8 * p, cy - 2 * p, 2 * p, 4 * p);
      break;
      
    case 'acc_wings_phoenix':
      const phoenixWingPulse = Math.sin(time * 0.002) * 0.1 + 0.9;
      ctx.fillStyle = '#ff4500';
      ctx.beginPath();
      ctx.moveTo(cx - 2 * p, cy);
      ctx.lineTo(cx - 8 * p, cy - 10 * p);
      ctx.lineTo(cx - 14 * p, cy - 4 * p);
      ctx.lineTo(cx - 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255, 215, 0, ${phoenixWingPulse})`;
      ctx.fillRect(cx - 10 * p, cy - 2 * p, 2 * p, 4 * p);
      ctx.fillStyle = '#ff4500';
      ctx.beginPath();
      ctx.moveTo(cx + 2 * p, cy);
      ctx.lineTo(cx + 8 * p, cy - 10 * p);
      ctx.lineTo(cx + 14 * p, cy - 4 * p);
      ctx.lineTo(cx + 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255, 215, 0, ${phoenixWingPulse})`;
      ctx.fillRect(cx + 8 * p, cy - 2 * p, 2 * p, 4 * p);
      const emberY = cy - 10 * p - (time * 0.1) % 8;
      ctx.fillStyle = `rgba(255, 150, 0, ${0.6 + Math.sin(time * 0.005) * 0.4})`;
      ctx.fillRect(cx - 6 * p, emberY, 2 * p, 2 * p);
      ctx.fillRect(cx + 5 * p, emberY - 2 * p, 2 * p, 2 * p);
      break;
      
    case 'acc_wings_void':
      const voidWingPulse = Math.sin(time * 0.0015) * 0.08 + 0.92;
      ctx.fillStyle = '#1a0a2e';
      ctx.beginPath();
      ctx.moveTo(cx - 2 * p, cy);
      ctx.lineTo(cx - 8 * p, cy - 10 * p);
      ctx.lineTo(cx - 14 * p, cy - 4 * p);
      ctx.lineTo(cx - 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(148, 0, 211, ${voidWingPulse})`;
      ctx.fillRect(cx - 10 * p, cy - 2 * p, 2 * p, 4 * p);
      ctx.fillStyle = '#1a0a2e';
      ctx.beginPath();
      ctx.moveTo(cx + 2 * p, cy);
      ctx.lineTo(cx + 8 * p, cy - 10 * p);
      ctx.lineTo(cx + 14 * p, cy - 4 * p);
      ctx.lineTo(cx + 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(148, 0, 211, ${voidWingPulse})`;
      ctx.fillRect(cx + 8 * p, cy - 2 * p, 2 * p, 4 * p);
      break;
      
    case 'acc_wings_celestial':
      const celestialWingPulse = Math.sin(time * 0.002) * 0.1 + 0.9;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(cx - 2 * p, cy);
      ctx.lineTo(cx - 8 * p, cy - 10 * p);
      ctx.lineTo(cx - 14 * p, cy - 4 * p);
      ctx.lineTo(cx - 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255, 250, 205, ${celestialWingPulse})`;
      ctx.fillRect(cx - 10 * p, cy - 2 * p, p, p);
      ctx.fillRect(cx - 12 * p, cy + 2 * p, p, p);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(cx + 2 * p, cy);
      ctx.lineTo(cx + 8 * p, cy - 10 * p);
      ctx.lineTo(cx + 14 * p, cy - 4 * p);
      ctx.lineTo(cx + 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255, 250, 205, ${celestialWingPulse})`;
      ctx.fillRect(cx + 8 * p, cy - 2 * p, p, p);
      ctx.fillRect(cx + 10 * p, cy + 2 * p, p, p);
      const starTwinkle = (time * 0.003) % 1;
      if (starTwinkle < 0.5) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx - 6 * p, cy - 8 * p, p, p);
        ctx.fillRect(cx + 5 * p, cy - 6 * p, p, p);
      }
      break;
      
    case 'acc_wings_galaxy':
      const galaxyWingPulse = Math.sin(time * 0.002) * 0.1 + 0.9;
      ctx.fillStyle = '#1a0a3e';
      ctx.beginPath();
      ctx.moveTo(cx - 2 * p, cy);
      ctx.lineTo(cx - 8 * p, cy - 10 * p);
      ctx.lineTo(cx - 14 * p, cy - 4 * p);
      ctx.lineTo(cx - 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(65, 105, 225, ${galaxyWingPulse})`;
      ctx.fillRect(cx - 10 * p, cy - 2 * p, 2 * p, 4 * p);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 12 * p, cy, p, p);
      ctx.fillStyle = '#1a0a3e';
      ctx.beginPath();
      ctx.moveTo(cx + 2 * p, cy);
      ctx.lineTo(cx + 8 * p, cy - 10 * p);
      ctx.lineTo(cx + 14 * p, cy - 4 * p);
      ctx.lineTo(cx + 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(65, 105, 225, ${galaxyWingPulse})`;
      ctx.fillRect(cx + 8 * p, cy - 2 * p, 2 * p, 4 * p);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx + 10 * p, cy, p, p);
      break;
      
    case 'acc_wings_rainbow':
      const rainbowWingCycle = (time * 0.001) % 1;
      const rainbowColors = ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#8b00ff'];
      const leftWingGradient = ctx.createLinearGradient(cx - 14 * p, cy - 10 * p, cx - 2 * p, cy + 6 * p);
      for (let i = 0; i < 6; i++) {
        const colorIndex = Math.floor((i + rainbowWingCycle * 6) % 6);
        leftWingGradient.addColorStop(i / 6, rainbowColors[colorIndex]);
      }
      ctx.fillStyle = leftWingGradient;
      ctx.beginPath();
      ctx.moveTo(cx - 2 * p, cy);
      ctx.lineTo(cx - 8 * p, cy - 10 * p);
      ctx.lineTo(cx - 14 * p, cy - 4 * p);
      ctx.lineTo(cx - 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      const rightWingGradient = ctx.createLinearGradient(cx + 2 * p, cy - 10 * p, cx + 14 * p, cy + 6 * p);
      for (let i = 0; i < 6; i++) {
        const colorIndex = Math.floor((i + rainbowWingCycle * 6) % 6);
        rightWingGradient.addColorStop(i / 6, rainbowColors[colorIndex]);
      }
      ctx.fillStyle = rightWingGradient;
      ctx.beginPath();
      ctx.moveTo(cx + 2 * p, cy);
      ctx.lineTo(cx + 8 * p, cy - 10 * p);
      ctx.lineTo(cx + 14 * p, cy - 4 * p);
      ctx.lineTo(cx + 12 * p, cy + 6 * p);
      ctx.closePath();
      ctx.fill();
      break;
  }
}
