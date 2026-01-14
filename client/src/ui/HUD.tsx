import { useState, useEffect, useRef, memo, useMemo } from 'react';
import { useGameStore } from '../state/gameStore';
import { useSocket } from '../hooks/useSocket';
import { playClickSound, playShopBellSound, playInventoryOpenSound, playCloseSound, playBuyOrbsSound } from '../utils/sounds';
import { getOrbCountColor } from '../game/renderer';

// Get color based on orb value (for floating text)
const getOrbColor = (value: number): string => {
  if (value >= 500) return '#dc143c'; // Red for shrine
  if (value >= 150) return '#ffd700'; // Gold for legendary
  if (value >= 80) return '#9b59b6';  // Purple for epic
  if (value >= 40) return '#3498db';   // Blue for rare
  if (value >= 20) return '#2ecc71';  // Green for uncommon
  return '#00dcff'; // Cyan for common
};

import { ItemPreview } from './ItemPreview';

// Orb purchase packages (£15 ≈ multiple legendary items)
const ORB_PACKAGES = [
  { id: 'starter', name: 'Starter Pack', orbs: 25000, price: 1.99, popular: false, bonus: null },
  { id: 'small', name: 'Small Pack', orbs: 75000, price: 4.99, popular: false, bonus: null },
  { id: 'medium', name: 'Medium Pack', orbs: 175000, price: 9.99, popular: true, bonus: '+25K bonus' },
  { id: 'large', name: 'Large Pack', orbs: 250000, price: 14.99, popular: false, bonus: '+25K bonus' },
  { id: 'mega', name: 'Mega Pack', orbs: 600000, price: 29.99, popular: false, bonus: '+100K bonus' },
  { id: 'ultimate', name: 'Ultimate Pack', orbs: 1250000, price: 49.99, popular: false, bonus: '+250K bonus' },
];


interface HUDProps {
  onLeaveRoom?: () => void;
}

export function HUD({ onLeaveRoom }: HUDProps) {
  const localPlayer = useGameStore(state => state.localPlayer);
  const toggleShop = useGameStore(state => state.toggleShop);
  const toggleInventory = useGameStore(state => state.toggleInventory);
  const toggleSettings = useGameStore(state => state.toggleSettings);
  const buyOrbsOpen = useGameStore(state => state.buyOrbsOpen);
  const toggleBuyOrbs = useGameStore(state => state.toggleBuyOrbs);
  const setSelectedLootBox = useGameStore(state => state.setSelectedLootBox);
  const connected = useGameStore(state => state.connected);
  const roomId = useGameStore(state => state.roomId);
  const players = useGameStore(state => state.players);
  const mapType = useGameStore(state => state.mapType);
  const shopItems = useGameStore(state => state.shopItems);
  const inventory = useGameStore(state => state.inventory);
  const lastOrbValue = useGameStore(state => state.lastOrbValue);
  const { leaveRoom: socketLeaveRoom } = useSocket();
  
  // Generate first available loot box to open
  const getFirstLootBox = useMemo(() => {
    const categories: Array<'hats' | 'shirts' | 'legs' | 'capes' | 'wings' | 'accessories' | 'boosts' | 'pets'> = [
      'hats', 'shirts', 'legs', 'capes', 'wings', 'accessories', 'boosts', 'pets'
    ];
    
    for (const category of categories) {
      const categoryItems = shopItems.filter(item => {
        if (item.id === 'tool_axe') return false;
        // Exclude common items from all cases
        if ((item.rarity || 'common') === 'common') return false;
        if (category === 'hats') return item.spriteLayer === 'hat';
        if (category === 'shirts') return item.spriteLayer === 'shirt';
        if (category === 'legs') return item.spriteLayer === 'legs';
        if (category === 'capes') return item.spriteLayer === 'cape';
        if (category === 'wings') return item.spriteLayer === 'wings';
        if (category === 'accessories') return item.spriteLayer === 'accessory';
        if (category === 'boosts') return item.spriteLayer === 'boost';
        if (category === 'pets') return item.spriteLayer === 'pet';
        return false;
      });
      
      if (categoryItems.length === 0) continue;
      
      const itemsByRarity: Record<string, any[]> = {
        common: [],
        uncommon: [],
        rare: [],
        epic: [],
        legendary: [],
      };
      
      categoryItems.forEach(item => {
        const rarity = item.rarity || 'common';
        itemsByRarity[rarity].push(item);
      });
      
      // Adjusted odds: removed common (62%), redistributed proportionally to remaining rarities
      // Original: uncommon 25%, rare 10%, epic 2.5%, legendary 0.5% = 38% total
      // New: scaled to 100% maintaining proportions
      const rarityTotals: Record<string, number> = {
        common: 0,
        uncommon: 65.78947368421053,  // 25/38 * 100
        rare: 26.31578947368421,      // 10/38 * 100
        epic: 6.578947368421053,       // 2.5/38 * 100
        legendary: 1.3157894736842105, // 0.5/38 * 100
      };
      
      let itemsWithChances;
      if (category === 'pets') {
        itemsWithChances = categoryItems.map(item => {
          let chance = 0;
          if (item.id === 'pet_golden' || item.id === 'pet_phoenix' || item.id === 'pet_void') {
            chance = 20.0;
          } else if (item.id === 'pet_celestial' || item.id === 'pet_galaxy' || item.id === 'pet_rainbow') {
            chance = 13.3;
          }
          return { item, chance };
        });
      } else {
        itemsWithChances = categoryItems.map(item => {
          const rarity = item.rarity || 'common';
          const itemsInRarity = itemsByRarity[rarity].length;
          const chancePerItem = itemsInRarity > 0 ? rarityTotals[rarity] / itemsInRarity : 0;
          return { item, chance: chancePerItem };
        });
      }
      
      const onlyLegendary = categoryItems.every(item => (item.rarity || 'common') === 'legendary');
      let price = 2500;
      if (category === 'wings') {
        price = 500000;
      } else if (category === 'pets') {
        price = 900000;
      } else if (onlyLegendary) {
        price = 200000;
      }
      
      return {
        id: `lootbox_${category}`,
        name: `${category.charAt(0).toUpperCase() + category.slice(1)} Case`,
        category,
        price,
        items: itemsWithChances,
      };
    }
    return null;
  }, [shopItems]);
  
  const handleOpenLootBoxes = () => {
    playBuyOrbsSound();
    if (getFirstLootBox) {
      setSelectedLootBox(getFirstLootBox);
    }
  };
  
  // Animated orb count
  const currentOrbs = localPlayer?.orbs || 0;
  const [displayedOrbs, setDisplayedOrbs] = useState(currentOrbs);
  const displayedOrbsRef = useRef(currentOrbs); // Track displayed value for animation start point
  const animationRef = useRef<number | null>(null);
  const previousOrbsRef = useRef(currentOrbs);
  const orbBalanceRef = useRef<HTMLDivElement>(null);
  const [showSessionStats, setShowSessionStats] = useState(true); // Expanded by default
  
  // Get orbs per hour for flaming effect
  const sessionStats = useGameStore(state => state.sessionStats);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [orbsPerHour, setOrbsPerHour] = useState(0);
  
  // Update time every second for live rate calculation
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  
  // Calculate orbs per hour
  useEffect(() => {
    const sessionDurationMs = currentTime - sessionStats.sessionStartTime;
    const sessionDurationHours = sessionDurationMs / (1000 * 60 * 60);
    const rate = sessionDurationHours > 0 
      ? Math.round(sessionStats.totalCollected / sessionDurationHours)
      : 0;
    setOrbsPerHour(rate);
  }, [currentTime, sessionStats]);
  
  const hasFlamingEffect = orbsPerHour > 50000;
  
  // Floating text animation state - use canvas-style approach (ref-based, independent of React)
  interface FloatingText {
    id: string;
    value: number;
    createdAt: number;
    progress: number; // Store progress in the object itself
  }
  const floatingTextsRef = useRef<FloatingText[]>([]);
  const [, forceUpdate] = useState(0); // Force re-render trigger
  const animationFrameRef = useRef<number | null>(null);
  
  // Animation loop - runs independently of React re-renders (like game canvas)
  useEffect(() => {
    const animate = () => {
      const now = Date.now();
      let needsUpdate = false;
      
      // Update all floating texts
      for (const ft of floatingTextsRef.current) {
        const age = now - ft.createdAt;
        const totalDuration = 1200;
        ft.progress = Math.min(age / totalDuration, 1);
      }
      
      // Remove expired texts
      const beforeLength = floatingTextsRef.current.length;
      floatingTextsRef.current = floatingTextsRef.current.filter(ft => ft.progress < 1);
      if (floatingTextsRef.current.length !== beforeLength) {
        needsUpdate = true;
      }
      
      // Force re-render if needed
      if (needsUpdate || floatingTextsRef.current.length > 0) {
        forceUpdate(prev => prev + 1);
      }
      
      // Continue animation if there are active texts
      if (floatingTextsRef.current.length > 0) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        animationFrameRef.current = null;
      }
    };
    
    // Start animation loop if there are texts and loop isn't running
    if (floatingTextsRef.current.length > 0 && !animationFrameRef.current) {
      animationFrameRef.current = requestAnimationFrame(animate);
    }
    
    return () => {
      // Don't cancel on cleanup - let it run until texts expire
      // This ensures animation continues even when component re-renders
    };
  }); // Run on every render to check if we need to start animation
  
  useEffect(() => {
    // Update displayedOrbsRef whenever displayedOrbs changes
    displayedOrbsRef.current = displayedOrbs;
  }, [displayedOrbs]);
  
  // Sync displayedOrbs with currentOrbs if they're out of sync (e.g., from external updates)
  useEffect(() => {
    if (currentOrbs !== displayedOrbs && !animationRef.current) {
      // If there's no animation running and values are different, sync immediately
      setDisplayedOrbs(currentOrbs);
      displayedOrbsRef.current = currentOrbs;
    }
  }, [currentOrbs, displayedOrbs]);
  
  useEffect(() => {
    // Update previousOrbsRef at the start to track the change
    const previousOrbs = previousOrbsRef.current;
    
    // Only animate if orbs increased
    if (currentOrbs > previousOrbs) {
      // Start from the current displayed value (not the previous stored value)
      // This ensures smooth animation even if multiple updates happen quickly
      const startValue = displayedOrbsRef.current;
      const endValue = currentOrbs;
      const difference = endValue - startValue;
      
      // Only animate if there's actually a difference to animate
      if (difference > 0) {
        const duration = Math.min(800, Math.max(300, difference * 2)); // 300-800ms based on amount
        const startTime = Date.now();
        
        // Spawn +X animation from orb balance (canvas-style, ref-based)
        // Use the last orb value from store if available, otherwise use the difference
        // This prevents showing red for normal orbs after shrine rewards
        const displayValue = lastOrbValue !== undefined ? lastOrbValue : difference;
        
        // Clear lastOrbValue immediately after using it to prevent reuse
        // This ensures each orb collection only triggers one floating text with the correct value
        if (lastOrbValue !== undefined) {
          useGameStore.setState({ lastOrbValue: undefined });
        }
        
        if (orbBalanceRef.current) {
          const newFloatingText: FloatingText = {
            id: `ft_${Date.now()}_${Math.random()}`,
            value: displayValue, // Use the actual orb value, not the total difference
            createdAt: Date.now(),
            progress: 0,
          };
          floatingTextsRef.current.push(newFloatingText);
          
          // Trigger animation loop start if not already running
          forceUpdate(prev => prev + 1);
        }
        
        // Cancel any existing animation
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
        
        const animate = () => {
          const elapsed = Date.now() - startTime;
          const progress = Math.min(elapsed / duration, 1);
          
          // Ease out cubic for smooth deceleration
          const easeOutCubic = 1 - Math.pow(1 - progress, 3);
          const currentValue = Math.floor(startValue + difference * easeOutCubic);
          
          setDisplayedOrbs(currentValue);
          
          if (progress < 1) {
            animationRef.current = requestAnimationFrame(animate);
          } else {
            // Set final value and clean up
            setDisplayedOrbs(endValue);
            animationRef.current = null;
          }
        };
        
        animationRef.current = requestAnimationFrame(animate);
      } else {
        // No difference to animate, just update immediately
        setDisplayedOrbs(endValue);
      }
    } else if (currentOrbs < previousOrbs) {
      // If orbs decreased (e.g., purchase), update immediately
      setDisplayedOrbs(currentOrbs);
      displayedOrbsRef.current = currentOrbs;
      // Cancel any running animation
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    } else if (currentOrbs !== previousOrbs && !animationRef.current) {
      // If orbs changed but no animation is running (e.g., from external update), sync immediately
      setDisplayedOrbs(currentOrbs);
      displayedOrbsRef.current = currentOrbs;
    }
    
    // Update previousOrbsRef at the end
    previousOrbsRef.current = currentOrbs;
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [currentOrbs, lastOrbValue]);
  
  // Get orb balance color based on total orbs (same as nameplates)
  const orbColorInfo = getOrbCountColor(displayedOrbs);
  
  // Get equipped items
  const equippedItems = inventory.filter(inv => inv.equipped).map(inv => inv.itemId);
  
  // Get all equipped boosts (up to 4)
  const equippedBoosts = shopItems.filter(item => 
    equippedItems.includes(item.id) && item.spriteLayer === 'boost'
  ).slice(0, 4); // Limit to 4
  
  const handleLeaveRoom = () => {
    socketLeaveRoom();
    useGameStore.getState().leaveRoom();
    onLeaveRoom?.();
  };
  
  // Handle Escape key to close modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const state = useGameStore.getState();
        // Close any open modals
        if (state.shopOpen) {
          state.toggleShop();
        }
        if (state.inventoryOpen) {
          state.toggleInventory();
        }
        if (state.buyOrbsOpen) {
          state.toggleBuyOrbs();
        }
        if (state.settingsOpen) {
          state.toggleSettings();
        }
        if (state.logDealerOpen) {
          state.toggleLogDealer();
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);
  
  return (
    <>
      {/* Top center bar with info */}
      <div className="fixed top-0 left-0 right-0 p-3 pointer-events-none z-40">
        <div className="flex justify-center">
          <div className="bg-gray-900/90 backdrop-blur-sm rounded-xl px-4 py-2 border border-gray-700 pointer-events-auto flex items-center gap-5">
            {/* Connection & Player */}
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-gray-200 font-pixel text-sm leading-none">
                {localPlayer?.name || 'Guest'}
              </span>
            </div>
            
            {/* Divider */}
            <div className="w-px h-5 bg-gray-600" />
            
            {/* Room info - all inline with proper alignment */}
            <div className="flex items-center gap-3 text-xs font-pixel">
              <span className="text-gray-400 leading-none">
                Room: <span className="text-emerald-400">{roomId || '---'}</span>
              </span>
              <span className="text-gray-400 leading-none">
                Map: <span className="text-amber-400">{mapType}</span>
              </span>
              <span className="text-gray-400 leading-none">
                Players: <span className="text-emerald-400">{players.size}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Bottom right - Action buttons stacked with background */}
      <div className="fixed bottom-4 right-4 z-40 pointer-events-auto">
        <div className="bg-gray-900/70 backdrop-blur-sm rounded-xl p-3 border border-gray-700/50 flex flex-col gap-3 min-w-[200px]">
          {/* Powerup icons - above orb balance */}
          {equippedBoosts.length > 0 && (
            <div className="flex items-center gap-2 mb-1 justify-center flex-wrap max-w-[200px]">
              {equippedBoosts.map((boost) => (
                <div
                  key={boost.id}
                  className="relative bg-gray-800/80 backdrop-blur-sm rounded-lg p-1.5 border border-gray-600/50"
                  style={{
                    borderColor: boost.trailColor ? `${boost.trailColor}80` : undefined,
                  }}
                  title={boost.name}
                >
                  <ItemPreview item={boost} size={32} />
                  {/* Glow effect based on rarity */}
                  {boost.rarity === 'legendary' && (
                    <div 
                      className="absolute inset-0 rounded-lg pointer-events-none"
                      style={{
                        boxShadow: `0 0 8px ${boost.trailColor || '#ffd700'}40`,
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          
          {/* Orb balance display - above Bag button */}
          <div className="flex flex-col gap-1 mb-1 w-full">
            <div 
              ref={orbBalanceRef}
              onClick={() => setShowSessionStats(!showSessionStats)}
              className="relative bg-gray-800/80 backdrop-blur-sm rounded-lg px-4 py-2 border border-gray-600/50 flex items-center justify-center gap-2 cursor-pointer hover:bg-gray-700/80 transition-colors w-full"
              style={{
                borderColor: orbColorInfo.color + '80', // 50% opacity border
              }}
            >
            <div 
              className="w-4 h-4 rounded-full shadow-lg transition-all duration-150 relative"
              style={{
                background: `radial-gradient(circle at 30% 30%, ${orbColorInfo.color}dd, ${orbColorInfo.color})`,
                boxShadow: orbColorInfo.glow 
                  ? `0 0 8px ${orbColorInfo.glow}, 0 0 12px ${orbColorInfo.glow}40`
                  : '0 0 4px rgba(0, 0, 0, 0.3)',
              }}
            >
              {/* Flaming effect when rate > 50k/hr - rises above orb */}
              {hasFlamingEffect && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 pointer-events-none" style={{ width: '10px', height: '16px' }}>
                  {/* Left flame */}
                  <div 
                    className="absolute bottom-0 left-0 animate-pulse"
                    style={{
                      width: '3px',
                      height: '12px',
                      background: 'linear-gradient(to top, rgba(255, 200, 0, 0.9) 0%, rgba(255, 100, 0, 0.8) 50%, rgba(255, 50, 0, 0.6) 100%)',
                      clipPath: 'polygon(0% 100%, 100% 100%, 80% 60%, 100% 30%, 50% 0%, 0% 30%)',
                      boxShadow: '0 0 4px rgba(255, 100, 0, 0.8)',
                      transform: 'rotate(-5deg)',
                    }}
                  />
                  {/* Center flame - tallest */}
                  <div 
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 animate-pulse"
                    style={{
                      width: '4px',
                      height: '16px',
                      background: 'linear-gradient(to top, rgba(255, 255, 150, 1) 0%, rgba(255, 200, 0, 0.9) 40%, rgba(255, 100, 0, 0.7) 80%, rgba(255, 50, 0, 0.5) 100%)',
                      clipPath: 'polygon(20% 100%, 80% 100%, 100% 70%, 80% 40%, 50% 0%, 20% 40%, 0% 70%)',
                      boxShadow: '0 0 6px rgba(255, 200, 0, 0.9), 0 0 10px rgba(255, 100, 0, 0.6)',
                      animationDelay: '0.1s',
                    }}
                  />
                  {/* Right flame */}
                  <div 
                    className="absolute bottom-0 right-0 animate-pulse"
                    style={{
                      width: '3px',
                      height: '10px',
                      background: 'linear-gradient(to top, rgba(255, 200, 0, 0.9) 0%, rgba(255, 100, 0, 0.8) 50%, rgba(255, 50, 0, 0.6) 100%)',
                      clipPath: 'polygon(0% 100%, 100% 100%, 20% 60%, 0% 30%, 50% 0%, 100% 30%)',
                      boxShadow: '0 0 4px rgba(255, 100, 0, 0.8)',
                      transform: 'rotate(5deg)',
                      animationDelay: '0.2s',
                    }}
                  />
                  {/* Rising embers/sparks */}
                  {[...Array(3)].map((_, i) => (
                    <div
                      key={i}
                      className="absolute rounded-full"
                      style={{
                        width: '1px',
                        height: '1px',
                        background: i === 0 ? '#ffaa00' : i === 1 ? '#ffdd00' : '#fff',
                        left: `${40 + i * 10}%`,
                        bottom: `${30 + i * 25}%`,
                        animation: `rise ${1 + i * 0.3}s ease-out infinite`,
                        animationDelay: `${i * 0.3}s`,
                        boxShadow: '0 0 2px currentColor',
                      }}
                    />
                  ))}
                  <style>{`
                    @keyframes rise {
                      0% {
                        transform: translateY(0) scale(1);
                        opacity: 1;
                      }
                      100% {
                        transform: translateY(-20px) scale(0.5);
                        opacity: 0;
                      }
                    }
                  `}</style>
                </div>
              )}
            </div>
            <span 
              className="font-pixel text-sm leading-none transition-all duration-150"
              style={{
                color: orbColorInfo.color,
                textShadow: orbColorInfo.glow 
                  ? `0 0 4px ${orbColorInfo.glow}, 0 0 8px ${orbColorInfo.glow}40`
                  : 'none',
              }}
            >
              {displayedOrbs.toLocaleString()}
            </span>
            
            {/* Floating +X animations - canvas-style, ref-based (independent of React re-renders) */}
            {floatingTextsRef.current.map((ft) => {
              // Use ease-out for smoother movement
              const easeOut = 1 - Math.pow(1 - ft.progress, 2);
              const yOffset = -60 * easeOut;
              
              // Smooth linear opacity fade - fully visible for first 60%, then fade out
              const opacity = ft.progress < 0.6 ? 1 : Math.max(0, 1 - ((ft.progress - 0.6) / 0.4));
              
              const scale = 1 + easeOut * 0.5;
              const color = getOrbColor(ft.value);
              
              // Don't render if completely faded or animation complete
              if (opacity <= 0 || ft.progress >= 1) return null;
              
              return (
                <div
                  key={ft.id}
                  className="absolute pointer-events-none"
                  style={{
                    left: '50%',
                    top: 0,
                    transform: `translateX(-50%) translateY(${yOffset}px) scale(${scale})`,
                    opacity,
                    color,
                    textShadow: `0 0 10px ${color}, 0 0 20px ${color}`,
                    zIndex: 1000,
                    willChange: 'transform, opacity',
                  }}
                >
                  <span className="font-pixel text-lg font-bold">+{ft.value.toLocaleString()}</span>
                </div>
              );
            })}
            </div>
            
            {/* Session stats - toggleable with animation */}
            <div 
              className={`overflow-hidden transition-all duration-300 ease-in-out ${
                showSessionStats ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
              }`}
            >
              <SessionStatsDisplay />
            </div>
          </div>
          
          <button
            onClick={() => { playInventoryOpenSound(); toggleInventory(); }}
            className="bg-gradient-to-br from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 
                       text-white font-pixel text-sm px-6 py-3 rounded-lg 
                       shadow-lg shadow-purple-500/40 hover:shadow-purple-500/60
                       transition-all duration-200 flex items-center gap-3 w-full justify-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
            Bag
          </button>
          
          {/* Shop button hidden - players use vendors in plaza */}
          {/* <button
            onClick={() => { playShopBellSound(); toggleShop(); }}
            className="bg-gradient-to-br from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 
                       text-white font-pixel text-sm px-6 py-3 rounded-lg 
                       shadow-lg shadow-cyan-500/40 hover:shadow-cyan-500/60
                       transition-all duration-200 flex items-center gap-3 w-full justify-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
            Shop
          </button> */}
          
          {/* Loot Boxes button */}
          <button
            onClick={handleOpenLootBoxes}
            className="relative overflow-hidden bg-gradient-to-br from-purple-500 to-pink-600 hover:from-purple-400 hover:to-pink-500 
                       text-white font-pixel text-sm px-6 py-3 rounded-lg 
                       shadow-lg shadow-purple-500/50 hover:shadow-purple-500/70
                       transition-all duration-200 flex items-center gap-3 w-full justify-center"
          >
            {/* Particle effects inside button */}
            <span className="absolute w-1.5 h-1.5 bg-purple-300 rounded-full animate-btn-particle-1 opacity-70" />
            <span className="absolute w-1 h-1 bg-pink-200 rounded-full animate-btn-particle-2 opacity-60" />
            <span className="absolute w-1.5 h-1.5 bg-purple-300 rounded-full animate-btn-particle-3 opacity-70" />
            <span className="absolute w-1 h-1 bg-pink-200 rounded-full animate-btn-particle-4 opacity-60" />
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <span className="relative z-10">Loot Boxes</span>
          </button>
          
          <button
            onClick={() => { playBuyOrbsSound(); toggleBuyOrbs(); }}
            className="relative overflow-hidden bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 
                       text-white font-pixel text-sm px-6 py-3 rounded-lg 
                       shadow-lg shadow-amber-500/50 hover:shadow-amber-500/70
                       transition-all duration-200 flex items-center gap-3 w-full justify-center"
          >
            {/* Particle effects inside button */}
            <span className="absolute w-1.5 h-1.5 bg-yellow-300 rounded-full animate-btn-particle-1 opacity-70" />
            <span className="absolute w-1 h-1 bg-amber-200 rounded-full animate-btn-particle-2 opacity-60" />
            <span className="absolute w-1.5 h-1.5 bg-orange-300 rounded-full animate-btn-particle-3 opacity-70" />
            <span className="absolute w-1 h-1 bg-yellow-200 rounded-full animate-btn-particle-4 opacity-60" />
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="relative z-10">Buy Orbs</span>
          </button>
          
          {/* Settings button */}
          <button
            onClick={() => { playClickSound(); toggleSettings(); }}
            className="bg-gray-700 hover:bg-gray-600 text-white font-pixel text-sm px-6 py-3 rounded-lg 
                       transition-all duration-200 flex items-center gap-3 w-full justify-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </button>
          
          {/* Leave room button */}
          <button
            onClick={() => { playClickSound(); handleLeaveRoom(); }}
            className="bg-gray-800 hover:bg-red-600 text-gray-400 hover:text-white font-pixel text-sm px-6 py-3 rounded-lg 
                       transition-all duration-200 flex items-center gap-3 w-full justify-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Leave
          </button>
        </div>
      </div>
      
      {/* Buy Orbs Modal */}
      {buyOrbsOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-700 bg-gradient-to-r from-emerald-900/50 to-teal-900/50">
              <div>
                <h2 className="text-xl font-pixel text-emerald-400 flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Buy Orbs
                </h2>
                <p className="text-gray-400 text-xs mt-1">Get orbs instantly to unlock cosmetics!</p>
              </div>
              
              <button
                onClick={() => { playCloseSound(); toggleBuyOrbs(); }}
                className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-gray-200"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {/* Current Balance */}
            <div className="p-4 bg-gray-800/50 border-b border-gray-700">
              <div className="flex items-center justify-center gap-3">
                <span className="text-gray-400 font-pixel text-sm">Your Balance:</span>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 shadow-lg shadow-cyan-500/30" />
                  <span className="text-cyan-300 font-pixel text-lg">{displayedOrbs.toLocaleString()}</span>
                </div>
              </div>
            </div>
            
            {/* Packages Grid */}
            <div className="p-5 pt-8 overflow-y-auto max-h-[60vh]">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
                {ORB_PACKAGES.map((pkg) => (
                  <div
                    key={pkg.id}
                    className={`relative bg-gray-800 rounded-xl p-4 border-2 transition-all hover:scale-105 cursor-pointer overflow-visible ${
                      pkg.popular 
                        ? 'border-amber-500 shadow-lg shadow-amber-500/40' 
                        : 'border-gray-700 hover:border-gray-600'
                    }`}
                    onClick={() => {
                      alert(`[MOCKUP] Would purchase ${pkg.orbs.toLocaleString()} orbs for £${pkg.price.toFixed(2)}`);
                    }}
                  >
                    {/* Popular badge with legendary styling */}
                    {pkg.popular && (
                      <>
                        {/* Legendary particle effects */}
                        <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
                          <div className="absolute w-1.5 h-1.5 bg-amber-400 rounded-full animate-float-particle-1 opacity-80" style={{ left: '10%', bottom: '-10%' }} />
                          <div className="absolute w-1 h-1 bg-yellow-300 rounded-full animate-float-particle-2 opacity-70" style={{ left: '30%', bottom: '-5%' }} />
                          <div className="absolute w-1.5 h-1.5 bg-orange-400 rounded-full animate-float-particle-3 opacity-80" style={{ left: '50%', bottom: '-10%' }} />
                          <div className="absolute w-1 h-1 bg-amber-300 rounded-full animate-float-particle-4 opacity-70" style={{ left: '70%', bottom: '-5%' }} />
                          <div className="absolute w-1.5 h-1.5 bg-yellow-400 rounded-full animate-float-particle-5 opacity-80" style={{ left: '90%', bottom: '-10%' }} />
                        </div>
                        {/* Badge */}
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[10px] font-pixel px-3 py-1 rounded-full shadow-lg shadow-amber-500/50 whitespace-nowrap z-10">
                          ⭐ BEST VALUE
                        </div>
                        {/* Glow effect */}
                        <div className="absolute inset-0 bg-gradient-to-t from-amber-500/10 to-transparent rounded-xl pointer-events-none" />
                      </>
                    )}
                    
                    {/* Orb icon */}
                    <div className="flex justify-center mb-3 mt-1">
                      <div className={`w-12 h-12 rounded-full bg-gradient-to-br shadow-lg flex items-center justify-center ${
                        pkg.popular 
                          ? 'from-amber-400 to-orange-500 shadow-amber-500/50' 
                          : 'from-cyan-400 to-blue-500 shadow-cyan-500/50'
                      }`}>
                        <span className="text-white font-bold text-lg">💎</span>
                      </div>
                    </div>
                    
                    {/* Package name */}
                    <h3 className={`text-center font-pixel text-sm mb-1 ${pkg.popular ? 'text-amber-200' : 'text-gray-200'}`}>{pkg.name}</h3>
                    
                    {/* Orb amount */}
                    <p className={`text-center font-pixel text-lg mb-1 ${pkg.popular ? 'text-amber-400' : 'text-cyan-400'}`}>
                      {pkg.orbs.toLocaleString()}
                    </p>
                    
                    {/* Bonus */}
                    {pkg.bonus && (
                      <p className={`text-center text-[10px] font-pixel mb-2 ${pkg.popular ? 'text-amber-300' : 'text-emerald-400'}`}>{pkg.bonus}</p>
                    )}
                    
                    {/* Price */}
                    <div className={`rounded-lg py-2 px-3 text-center ${pkg.popular ? 'bg-gradient-to-r from-amber-900/50 to-orange-900/50' : 'bg-gray-900'}`}>
                      <span className={`font-pixel text-sm ${pkg.popular ? 'text-amber-200' : 'text-white'}`}>£{pkg.price.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Info text */}
              <div className="mt-5 text-center">
                <p className="text-gray-500 text-xs font-pixel">
                  💡 Tip: 1 Legendary item costs ~45,000 orbs • Full outfit ~225,000 orbs
                </p>
                <p className="text-gray-600 text-[10px] mt-2">
                  Purchases are processed securely. All sales are final.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Format number with k notation (e.g., 1100 -> 1.1k, 10000 -> 10k)
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return num.toString();
}

// Session stats display component - permanently visible under orb balance
function SessionStatsDisplay() {
  const sessionStats = useGameStore(state => state.sessionStats);
  const [currentTime, setCurrentTime] = useState(Date.now());
  
  // Update time every second for live rate calculation
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  
  // Calculate orbs per hour
  const sessionDurationMs = currentTime - sessionStats.sessionStartTime;
  const sessionDurationHours = sessionDurationMs / (1000 * 60 * 60);
  const orbsPerHour = sessionDurationHours > 0 
    ? Math.round(sessionStats.totalCollected / sessionDurationHours)
    : 0;
  
  // Format session duration
  const formatDuration = (ms: number): string => {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };
  
  // Orb type labels
  const orbTypeLabels: Record<string, string> = {
    common: 'Common',
    uncommon: 'Uncommon',
    rare: 'Rare',
    epic: 'Epic',
    legendary: 'Legendary',
    normal: 'Normal',
    gold: 'Gold',
    shrine: 'Shrine',
  };
  
  return (
    <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-gray-600/50 w-full">
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <span className="text-xs text-gray-400 font-pixel">Orbs:</span>
          <span className="text-xs text-emerald-400 font-pixel">{formatNumber(sessionStats.totalCollected)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-gray-400 font-pixel">Rate:</span>
          <span className="text-xs text-emerald-400 font-pixel">{formatNumber(orbsPerHour)}/hr</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-gray-500 font-pixel">Duration:</span>
          <span className="text-xs text-gray-500 font-pixel">{formatDuration(sessionDurationMs)}</span>
        </div>
        
        {/* Orb type breakdown - only show types with counts > 0 */}
        <div className="pt-1 border-t border-gray-700/50">
          <div className="text-xs text-gray-400 font-pixel mb-1">By Type</div>
          <div className="space-y-0.5">
            {(Object.keys(sessionStats.orbTypeCounts) as string[]).map((type) => {
              const count = sessionStats.orbTypeCounts[type];
              if (count === 0) return null;
              return (
                <div key={type} className="flex justify-between text-xs font-pixel">
                  <span className="text-gray-300">{orbTypeLabels[type]}:</span>
                  <span className="text-emerald-400">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
