import { useEffect, useRef, useState } from 'react';
import { drawPlayer, drawPetPreview } from '../game/renderer';
import { PlayerWithChat, GAME_CONSTANTS } from '../types';

type Direction = 'up' | 'down' | 'left' | 'right';

interface CharacterPreviewProps {
  equippedItems: string[];
  previewItem?: string;
  size?: number;
  playerName?: string;
  playerOrbs?: number;
  showRotateButtons?: boolean;
  children?: React.ReactNode; // For additional content below the preview
}

const { PLAYER_WIDTH, PLAYER_HEIGHT, SCALE } = GAME_CONSTANTS;

const DIRECTIONS: Direction[] = ['up', 'right', 'down', 'left'];

export function CharacterPreview({ 
  equippedItems, 
  previewItem, 
  size = 160, 
  playerName,
  playerOrbs = 0,
  showRotateButtons = true,
  children
}: CharacterPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [direction, setDirection] = useState<Direction>('down');
  const directionRef = useRef<Direction>('down');
  const prevPreviewItemRef = useRef<string | undefined>(undefined);
  
  // Keep directionRef in sync with direction state
  useEffect(() => {
    directionRef.current = direction;
  }, [direction]);
  
  // Combine equipped items with preview item
  const displayItems = previewItem 
    ? [...equippedItems.filter(item => {
        const previewType = getItemType(previewItem);
        return getItemType(item) !== previewType;
      }), previewItem]
    : equippedItems;
  
  // Calculate canvas dimensions based on game scale
  const gameCharWidth = PLAYER_WIDTH * SCALE;  // 48px at SCALE=3
  const gameCharHeight = PLAYER_HEIGHT * SCALE; // 72px at SCALE=3
  
  // Scale factor to fit the preview size - make character smaller to fit with accessories
  const previewScale = (size * 0.32) / gameCharWidth;
  
  // Canvas dimensions - extra height for nameplate at top
  const canvasWidth = size;
  const canvasHeight = Math.floor(size * 1.6);
  
  const rotateLeft = () => {
    const currentIndex = DIRECTIONS.indexOf(direction);
    const newIndex = (currentIndex - 1 + DIRECTIONS.length) % DIRECTIONS.length;
    setDirection(DIRECTIONS[newIndex]);
  };
  
  const rotateRight = () => {
    const currentIndex = DIRECTIONS.indexOf(direction);
    const newIndex = (currentIndex + 1) % DIRECTIONS.length;
    setDirection(DIRECTIONS[newIndex]);
  };
  
  // Auto-rotate to show cape when previewing a cape, or spin back to front when not
  useEffect(() => {
    const prevPreviewItem = prevPreviewItemRef.current;
    prevPreviewItemRef.current = previewItem;
    
    // Only rotate if previewItem actually changed
    if (previewItem === prevPreviewItem) return;
    
    let rotateInterval: NodeJS.Timeout | null = null;
    
    if (previewItem && previewItem.startsWith('cape_')) {
      // Rotate to show the cape (180 degrees to 'up' - back view)
      const currentDir = directionRef.current;
      if (currentDir === 'up') {
        // Already showing back, no rotation needed
        return;
      }
      
      let currentIndex = DIRECTIONS.indexOf(currentDir);
      let rotationStep = 0;
      
      // Calculate shortest path to 'up' (back view)
      const targetIndex = DIRECTIONS.indexOf('up');
      const stepsToTarget = (targetIndex - currentIndex + DIRECTIONS.length) % DIRECTIONS.length;
      
      rotateInterval = setInterval(() => {
        currentIndex = (currentIndex + 1) % DIRECTIONS.length;
        const newDirection = DIRECTIONS[currentIndex];
        setDirection(newDirection);
        directionRef.current = newDirection;
        rotationStep++;
        
        // Stop when we reach 'up' (back view)
        if (rotationStep >= stepsToTarget || newDirection === 'up') {
          if (rotateInterval) clearInterval(rotateInterval);
          setDirection('up'); // Final position showing the back
          directionRef.current = 'up';
        }
      }, 300); // Rotate every 300ms for smooth animation
    } else {
      // If no preview or previewing something that isn't a cape, spin back to face forward
      const currentDir = directionRef.current;
      if (currentDir !== 'down') {
        let currentIndex = DIRECTIONS.indexOf(currentDir);
        let rotationStep = 0;
        
        // Calculate shortest path to 'down'
        const targetIndex = DIRECTIONS.indexOf('down');
        const stepsToTarget = (targetIndex - currentIndex + DIRECTIONS.length) % DIRECTIONS.length;
        
        rotateInterval = setInterval(() => {
          currentIndex = (currentIndex + 1) % DIRECTIONS.length;
          const newDirection = DIRECTIONS[currentIndex];
          setDirection(newDirection);
          directionRef.current = newDirection;
          rotationStep++;
          
          // Stop when we reach 'down' (face forward)
          if (rotationStep >= stepsToTarget || newDirection === 'down') {
            if (rotateInterval) clearInterval(rotateInterval);
            setDirection('down'); // Final position facing forward
            directionRef.current = 'down';
          }
        }, 300); // Rotate every 300ms for smooth animation
      }
    }
    
    return () => {
      if (rotateInterval) clearInterval(rotateInterval);
    };
  }, [previewItem]);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    let animationId: number;
    
    const animate = () => {
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      ctx.imageSmoothingEnabled = false;
      
      const time = Date.now();
      
      // Check if we're previewing a pet
      const isPreviewingPet = previewItem && previewItem.startsWith('pet_');
      
      if (isPreviewingPet && previewItem) {
        // Draw pet floating in the center
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        
        // Center the pet in the canvas
        const centerX = canvasWidth / 2;
        const centerY = canvasHeight / 2;
        const p = SCALE * previewScale; // Scale for preview size
        
        // Draw the pet with floating animation
        drawPetPreview(ctx, previewItem, centerX, centerY, p, time);
        
        ctx.restore();
      } else {
        // Create a fake player object for rendering
        const fakePlayer: PlayerWithChat = {
          id: 'preview',
          name: playerName || '',
          x: 0,
          y: 0,
          direction: direction,
          sprite: {
            body: 'default',
            outfit: displayItems,
          },
          orbs: playerOrbs,
          roomId: '',
        };
        
        // Save context and apply scaling
        ctx.save();
        
        // Scale the entire context to fit the preview
        ctx.scale(previewScale, previewScale);
        
        // Calculate position to center the character
        // The game draws at (player.x * SCALE, player.y * SCALE)
        // We want it centered in our canvas - extra offset at top for nameplate
        const offsetX = (canvasWidth / previewScale - gameCharWidth) / 2 / SCALE;
        const offsetY = (canvasHeight / previewScale - gameCharHeight) / 2 / SCALE + 8;
        
        // Set the fake player position so it draws centered
        fakePlayer.x = offsetX;
        fakePlayer.y = offsetY;
        
        // Use the actual game renderer!
        drawPlayer(ctx, fakePlayer, false, time);
        
        ctx.restore();
      }
      
      animationId = requestAnimationFrame(animate);
    };
    
    animate();
    
    return () => cancelAnimationFrame(animationId);
  }, [displayItems, canvasWidth, canvasHeight, previewScale, direction, playerName, playerOrbs, previewItem]);
  
  return (
    <div className="flex flex-col items-center flex-1">
      {/* Canvas with rotate buttons */}
      <div className="relative">
        <canvas 
          ref={canvasRef} 
          width={canvasWidth} 
          height={canvasHeight}
          className="bg-gradient-to-b from-gray-800/80 to-gray-900/80 rounded-xl border border-gray-600 shadow-inner"
          style={{ imageRendering: 'pixelated' }}
        />
        
        {/* Rotate buttons overlaid on canvas - hide when previewing pets */}
        {showRotateButtons && !(previewItem && previewItem.startsWith('pet_')) && (
          <>
            <button
              onClick={rotateLeft}
              className="absolute left-1 top-1/2 -translate-y-1/2 w-8 h-8 bg-gray-700/80 hover:bg-gray-600 rounded-full flex items-center justify-center text-white transition-colors border border-gray-500"
              title="Rotate Left"
            >
              ◀
            </button>
            <button
              onClick={rotateRight}
              className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 bg-gray-700/80 hover:bg-gray-600 rounded-full flex items-center justify-center text-white transition-colors border border-gray-500"
              title="Rotate Right"
            >
              ▶
            </button>
          </>
        )}
      </div>
      
      {/* Preview indicator */}
      {previewItem && (
        <p className="text-amber-400 font-pixel text-xs mt-1 animate-pulse">👁 Preview Mode</p>
      )}
      
      {/* Additional content (like purchase button) */}
      {children && (
        <div className="mt-3 w-full">
          {children}
        </div>
      )}
    </div>
  );
}

function getItemType(itemId: string): string {
  if (itemId.startsWith('hat_')) return 'hat';
  if (itemId.startsWith('shirt_') || itemId.startsWith('robe_') || 
      itemId.startsWith('armor_') || itemId.startsWith('coat_') ||
      itemId.startsWith('dress_') || itemId.startsWith('suit_') ||
      itemId.startsWith('gi_') || itemId.startsWith('vest_') ||
      itemId.startsWith('tunic_') || itemId.startsWith('jacket_')) return 'shirt';
  if (itemId.startsWith('legs_')) return 'legs';
  if (itemId.startsWith('acc_') || itemId.startsWith('cape_')) return 'accessory';
  if (itemId.startsWith('boost_')) return 'boost';
  if (itemId.startsWith('pet_')) return 'pet';
  if (itemId.startsWith('wings_')) return 'wings';
  return 'unknown';
}
