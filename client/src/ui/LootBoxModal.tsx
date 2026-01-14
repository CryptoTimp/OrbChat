import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useGameStore } from '../state/gameStore';
import { useSocket } from '../hooks/useSocket';
import { ShopItem, RARITY_COLORS, ItemRarity } from '../types';
import { ItemPreview } from './ItemPreview';
import { playClickSound, playCloseSound, playPurchaseSound, playBuyOrbsSound, playLevelUpSound } from '../utils/sounds';

const RARITY_ORDER: ItemRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

// Map rarity to actual border color values (hex)
const RARITY_BORDER_COLORS: Record<ItemRarity, string> = {
  common: '#6b7280',      // gray-500
  uncommon: '#22c55e',     // green-500
  rare: '#3b82f6',         // blue-500
  epic: '#a855f7',         // purple-500
  legendary: '#fbbf24',    // amber-400
};

// Format price with K or M suffix
function formatPrice(price: number): string {
  if (price >= 1000000) {
    return `${(price / 1000000).toFixed(1)}M`;
  } else if (price >= 1000) {
    return `${(price / 1000).toFixed(1)}K`;
  }
  return price.toString();
}

export interface LootBox {
  id: string;
  name: string;
  category: 'hats' | 'shirts' | 'legs' | 'capes' | 'wings' | 'accessories' | 'boosts' | 'pets';
  price: number;
  items: Array<{
    item: ShopItem;
    chance: number; // Percentage chance (0-100)
  }>;
}

interface LootBoxModalProps {
  lootBox: LootBox | null;
  onClose: () => void;
}

export function LootBoxModal({ lootBox, onClose }: LootBoxModalProps) {
  const localPlayer = useGameStore(state => state.localPlayer);
  const shopItems = useGameStore(state => state.shopItems);
  const inventory = useGameStore(state => state.inventory);
  const toggleShop = useGameStore(state => state.toggleShop);
  const setSelectedLootBox = useGameStore(state => state.setSelectedLootBox);
  const toggleBuyOrbs = useGameStore(state => state.toggleBuyOrbs);
  const { purchaseLootBox } = useSocket();
  
  // Generate all available loot boxes
  const allLootBoxes = useMemo(() => {
    const categories: Array<'hats' | 'shirts' | 'legs' | 'capes' | 'wings' | 'accessories' | 'boosts' | 'pets'> = [
      'hats', 'shirts', 'legs', 'capes', 'wings', 'accessories', 'boosts', 'pets'
    ];
    
    const boxes = categories.map(category => {
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
      
      if (categoryItems.length === 0) return null;
      
      const itemsByRarity: Record<ItemRarity, ShopItem[]> = {
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
      const rarityTotals: Record<ItemRarity, number> = {
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
      let price = 1000;
      if (category === 'wings') {
        price = 100000;
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
      } as LootBox;
    }).filter((box): box is LootBox => box !== null);
    
    return boxes.sort((a, b) => b.price - a.price);
  }, [shopItems]);
  
  // Close shop when loot box modal opens
  useEffect(() => {
    if (lootBox) {
      const shopOpen = useGameStore.getState().shopOpen;
      if (shopOpen) {
        // Use setTimeout to ensure the modal renders before closing shop
        setTimeout(() => {
          toggleShop();
        }, 0);
      }
    }
  }, [lootBox, toggleShop]);
  
  const [isOpening, setIsOpening] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ShopItem | null>(null);
  // Initial scroll position to show items to the left of center
  // Start at 2 full sets of items (so items are visible to left of center)
  const [scrollPosition, setScrollPosition] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const isResettingRef = useRef(false);
  const lastScrollPositionRef = useRef(0);
  const lastItemIndexRef = useRef(-1);
  const activeTickSoundsRef = useRef<HTMLAudioElement[]>([]); // Track all active tick sounds
  const itemAlreadyOwnedRef = useRef(false); // Track if the selected item was already owned
  const pendingSelectedItemRef = useRef<ShopItem | null>(null); // Track item to display even during re-renders
  const isOpeningRef = useRef(false); // Synchronous ref to prevent spam clicking
  
  // Get orbs directly from store so it updates when purchase completes
  const playerOrbs = useGameStore(state => state.localPlayer?.orbs || 0);
  const canAfford = lootBox ? playerOrbs >= lootBox.price : false;
  
  // Calculate normalized chances (memoized to prevent recalculation on every render)
  // Must be defined before any useEffect that uses it
  // Note: Chances from ShopModal should already sum to 100%, but we normalize to ensure accuracy
  const normalizedItems = useMemo(() => {
    if (!lootBox) return [];
    const totalChance = lootBox.items.reduce((sum, i) => sum + i.chance, 0);
    // Normalize to ensure they sum to exactly 100 (handles floating point errors)
    return lootBox.items.map(item => ({
      ...item,
      normalizedChance: totalChance > 0 ? (item.chance / totalChance) * 100 : 0,
    }));
  }, [lootBox?.id, lootBox?.items]);
  
  // Calculate initial scroll position when items are available (only on mount or when loot box changes)
  // Don't reset when selectedItem changes - that's handled by the animation
  // IMPORTANT: Don't reset when isOpening is true, as that would interfere with the animation
  useEffect(() => {
    if (lootBox && normalizedItems.length > 0 && !selectedItem && !isOpening) {
      const itemWidth = 144; // 128px + 16px gap
      
      // Find the first legendary item index in the normalized items (for spinner)
      // Note: sortedItems is for display only, spinner uses normalizedItems order
      const firstLegendaryIndex = normalizedItems.findIndex(item => (item.item.rarity || 'common') === 'legendary');
      
      // If legendary items exist, start at the first legendary item
      // Otherwise, start at 2 full sets of items
      let initialPosition;
      if (firstLegendaryIndex >= 0) {
        // Start at the first legendary item in the 2nd set (so it's visible)
        initialPosition = normalizedItems.length * itemWidth + (firstLegendaryIndex * itemWidth);
      } else {
        // Fallback: Start at 2 full sets of items
        initialPosition = normalizedItems.length * itemWidth * 2;
      }
      
      // Only set if it's different to avoid unnecessary updates
      setScrollPosition(prev => {
        if (Math.abs(prev - initialPosition) > 1) {
          return initialPosition;
        }
        return prev;
      });
    }
  }, [lootBox?.id, normalizedItems.length, selectedItem, isOpening]); // Include selectedItem and isOpening to prevent interference
  
  // Track previous orbs for animation
  const [previousOrbs, setPreviousOrbs] = useState(playerOrbs);
  const [orbAnimation, setOrbAnimation] = useState<'decrease' | 'increase' | null>(null);
  
  // Detect orb balance changes and trigger animation
  useEffect(() => {
    if (previousOrbs !== playerOrbs) {
      if (playerOrbs < previousOrbs) {
        setOrbAnimation('decrease');
      } else if (playerOrbs > previousOrbs) {
        setOrbAnimation('increase');
      }
      setPreviousOrbs(playerOrbs);
      
      // Clear animation after it completes
      const timer = setTimeout(() => {
        setOrbAnimation(null);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [playerOrbs, previousOrbs]);
  
  // Check if selected item was already owned BEFORE purchase (use ref, not current inventory)
  // The current inventory check would be wrong because purchaseLootBox adds the item to inventory
  const isItemOwned = selectedItem ? itemAlreadyOwnedRef.current : false;
  const refundAmount = (lootBox && isItemOwned) ? Math.floor(lootBox.price / 2) : 0;
  
  // Sort items by rarity (legendary to common) for display - highest rarity at top
  const sortedItems = useMemo(() => {
    if (!normalizedItems.length) return [];
    return [...normalizedItems].sort((a, b) => {
      const aRarity = a.item.rarity || 'common';
      const bRarity = b.item.rarity || 'common';
      const aIndex = RARITY_ORDER.indexOf(aRarity);
      const bIndex = RARITY_ORDER.indexOf(bRarity);
      return bIndex - aIndex; // Reverse order: legendary first
    });
  }, [normalizedItems]);
  
  // Cleanup function to stop all animations and sounds
  const cleanup = useCallback(() => {
    setIsOpening(false);
    isOpeningRef.current = false;
    
    // Cancel animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    
    // Stop all active tick sounds
    activeTickSoundsRef.current.forEach(sound => {
      sound.pause();
      sound.currentTime = 0;
    });
    activeTickSoundsRef.current = [];
  }, []);

  // Weighted random selection (uses original order, not sorted)
  const selectRandomItem = useCallback((): ShopItem => {
    if (!lootBox || normalizedItems.length === 0) {
      throw new Error('No items in loot box');
    }
    
    // Generate a fresh random number each time (0 to 100)
    const random = Math.random() * 100;
    let cumulative = 0;
    
    // Verify chances sum correctly
    const totalChance = normalizedItems.reduce((sum, i) => sum + i.normalizedChance, 0);
    if (Math.abs(totalChance - 100) > 0.01) {
      console.warn('Chances do not sum to 100:', totalChance, normalizedItems.map(i => ({ name: i.item.name, chance: i.normalizedChance })));
    }
    
    // Select item based on weighted random
    for (const { item, normalizedChance } of normalizedItems) {
      cumulative += normalizedChance;
      if (random < cumulative) { // Use < instead of <= to handle edge case
        console.log('Selected item:', item.name, 'rarity:', item.rarity, 'chance:', normalizedChance.toFixed(2) + '%', 'random:', random.toFixed(2));
        return item;
      }
    }
    
    // Fallback to last item (shouldn't happen if chances sum to 100)
    console.warn('Fallback to last item - random:', random, 'total cumulative:', cumulative);
    return normalizedItems[normalizedItems.length - 1].item;
  }, [normalizedItems, lootBox]);
  
  const handleOpen = useCallback(() => {
    // CRITICAL: Block if already opening - check ref first (synchronous)
    if (isOpeningRef.current) {
      return;
    }
    // Also check state
    if (isOpening) {
      return;
    }
    
    // Basic validation
    if (!lootBox || !canAfford) {
      return;
    }
    
    // Set ref IMMEDIATELY (synchronous) - this blocks any subsequent clicks
    isOpeningRef.current = true;
    // Set state for UI (async)
    setIsOpening(true);
    
    console.log('Starting case opening animation...');
    playPurchaseSound();
    setSelectedItem(null);
    // Reset the flag now that we're starting a new opening
    isResettingRef.current = false;
    
    // No need to pre-initialize tick sound - we'll create new instances for each tick
    // This allows overlapping sounds when ticks happen rapidly
    
    // Reset scroll tracking - initialize to one less than the starting index
    // so we detect the first item crossing immediately
    lastScrollPositionRef.current = scrollPosition;
    const itemWidth = 144;
    const startingItemIndex = Math.floor(scrollPosition / itemWidth);
    lastItemIndexRef.current = startingItemIndex - 1; // Start one less to detect first crossing
    
    // Select the item first (server-side would do this, but for now client-side)
    const item = selectRandomItem();
    
    // Check if item is already owned immediately (before purchase)
    // Store this in a ref so it persists through the animation
    itemAlreadyOwnedRef.current = inventory.some(inv => inv.itemId === item.id);
    
    // Update orb balance optimistically - decrease immediately when clicking unlock
    const state = useGameStore.getState();
    const currentOrbs = state.localPlayer?.orbs || 0;
    const optimisticOrbs = currentOrbs - lootBox.price;
    state.updatePlayerOrbs(state.playerId || '', optimisticOrbs);
    if (state.localPlayer) {
      state.localPlayer.orbs = optimisticOrbs;
    }
    
    // Start scrolling animation
    const itemIndex = normalizedItems.findIndex(i => i.item.id === item.id);
    // Calculate target position - we start at 2 sets in, so find the item in one of the sets
    // We'll scroll to the item in the 3rd set (index 2) to ensure it's visible
    const initialOffset = normalizedItems.length * itemWidth * 2;
    const targetPosition = initialOffset + (itemIndex * itemWidth);
    
    // Animate scrolling - use requestAnimationFrame to ensure we have the latest scroll position
    // This is important because state updates are async and we might be using a stale value
    requestAnimationFrame(() => {
      const startTime = Date.now();
      const duration = 3000; // 3 seconds
      // Get the current scroll position from state (should be up to date now)
      const currentScrollPos = scrollPosition;
      const startPosition = currentScrollPos; // Start from current scroll position
      // Calculate extra scroll to go through items multiple times before landing
      const extraScroll = normalizedItems.length * itemWidth * 2; // Scroll through 2 more sets
      
      console.log('Animation setup:', { startPosition, targetPosition, extraScroll, itemIndex, itemName: item.name, scrollDistance: targetPosition + extraScroll - startPosition });
      
      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Safety check: if animation was cancelled, stop
        if (!animationRef.current) {
          console.log('Animation cancelled, stopping');
          return;
        }
        
        // Ease out cubic for smooth deceleration
        const easeOut = 1 - Math.pow(1 - progress, 3);
        
        // Scroll through items multiple times, then settle on target
        // We scroll from startPosition to (targetPosition + extraScroll), then ease to targetPosition
        const scrollDistance = targetPosition + extraScroll - startPosition;
        const currentPosition = startPosition + scrollDistance * easeOut;
        
        setScrollPosition(currentPosition);
        
        // Play ticking sound as items scroll past
        const itemWidth = 144;
        const currentItemIndex = Math.floor(currentPosition / itemWidth);
        const lastItemIndex = lastItemIndexRef.current;
        
        // If we've crossed an item boundary, play tick sound
        if (currentItemIndex !== lastItemIndex) {
          lastItemIndexRef.current = currentItemIndex;
          
          // Calculate velocity based on progress (ease-out slows down over time)
          // Velocity is the derivative of ease-out: 3 * (1 - progress)^2
          // Higher velocity = faster scrolling = more frequent ticks
          const velocityFactor = 3 * Math.pow(1 - progress, 2);
          
          // Play tick sound with volume based on scroll speed
          // Create a new Audio instance for each tick to allow overlapping sounds
          const state = useGameStore.getState();
          if (state.sfxEnabled) {
            // Volume decreases as scrolling slows down (matches the ease-out)
            // velocityFactor ranges from 3 (fast start) to 0 (slow end), normalize to 0-1
            const volume = (state.sfxVolume / 100) * Math.max(0.3, Math.min(1, velocityFactor / 3));
            
            // Create a new audio instance for each tick to allow overlapping
            const tickSound = new Audio('/click-sound-432501.mp3');
            tickSound.volume = volume;
            // Track this audio instance for cleanup
            activeTickSoundsRef.current.push(tickSound);
            // Remove from tracking when sound ends (prevents memory leak)
            tickSound.addEventListener('ended', () => {
              activeTickSoundsRef.current = activeTickSoundsRef.current.filter(s => s !== tickSound);
            });
            tickSound.play().catch(() => {});
          }
        }
        
        lastScrollPositionRef.current = currentPosition;
        
        if (progress < 1) {
          // Animation still running - keep isOpening true
          animationRef.current = requestAnimationFrame(animate);
        } else {
          // Animation complete - set final position
          setScrollPosition(targetPosition);
          animationRef.current = null;
          
          // Stop all active tick sounds when animation completes
          activeTickSoundsRef.current.forEach(sound => {
            sound.pause();
            sound.currentTime = 0;
          });
          activeTickSoundsRef.current = [];
          
          // Use requestAnimationFrame to ensure scroll position is set and rendered before showing result
          requestAnimationFrame(() => {
            // Always set the selected item so it displays, even if already owned
            console.log('Setting selected item:', item.name, 'already owned:', itemAlreadyOwnedRef.current);
            // Store in ref first to ensure it persists
            pendingSelectedItemRef.current = item;
            setSelectedItem(item);
            
            // Play level-up sound for rare, epic, or legendary items
            const rarity = item.rarity || 'common';
            if (rarity === 'rare' || rarity === 'epic' || rarity === 'legendary') {
              playLevelUpSound();
            }
            
            // If item is already owned, add refund immediately (optimistic)
            if (itemAlreadyOwnedRef.current) {
              const refundAmount = Math.floor(lootBox.price / 2);
              const currentState = useGameStore.getState();
              const currentOrbs = currentState.localPlayer?.orbs || optimisticOrbs;
              const refundedOrbs = currentOrbs + refundAmount;
              currentState.updatePlayerOrbs(currentState.playerId || '', refundedOrbs);
              if (currentState.localPlayer) {
                currentState.localPlayer.orbs = refundedOrbs;
              }
            }
            
            // Purchase the loot box after animation completes (will sync with Firebase)
            purchaseLootBox(lootBox.id, item.id, lootBox.price);
            
            // NOW that animation is done and item is shown, allow opening again
            setIsOpening(false);
            isOpeningRef.current = false;
          });
        }
      };
      
      // Start animation immediately
      console.log('Starting animation frame, startPosition:', startPosition, 'targetPosition:', targetPosition, 'extraScroll:', extraScroll);
      animationRef.current = requestAnimationFrame(animate);
    });
  }, [lootBox, canAfford, isOpening, normalizedItems, scrollPosition, selectRandomItem, inventory, purchaseLootBox]);
  
  // Reset state when loot box changes (only when switching to a different loot box)
  useEffect(() => {
    if (lootBox) {
      // Only reset if we're switching to a different loot box (not just an update)
      setIsOpening(false);
      isOpeningRef.current = false;
      setSelectedItem(null);
      // Reset orb animation state
      setPreviousOrbs(playerOrbs);
      setOrbAnimation(null);
      // Cancel any ongoing animation
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      // Stop all active tick sounds
      activeTickSoundsRef.current.forEach(sound => {
        sound.pause();
        sound.currentTime = 0;
      });
      activeTickSoundsRef.current = [];
      // Reset scroll position will be handled by the other effect
    }
  }, [lootBox?.id, playerOrbs]); // Only depend on lootBox.id - this ensures it only runs when switching loot boxes
  
  // Cleanup when loot box becomes null (modal closes)
  useEffect(() => {
    if (!lootBox) {
      cleanup();
    }
  }, [lootBox, cleanup]);
  
  // Cleanup on unmount or when modal closes
  useEffect(() => {
    return () => {
      // Cancel animation
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      // Stop all active tick sounds
      activeTickSoundsRef.current.forEach(sound => {
        sound.pause();
        sound.currentTime = 0;
      });
      activeTickSoundsRef.current = [];
    };
  }, []);
  
  if (!lootBox) return null;

  return (
    <>
      <style>{`
        @keyframes glow-pulse {
          0%, 100% {
            opacity: 1;
            filter: brightness(1);
          }
          50% {
            opacity: 0.8;
            filter: brightness(1.2);
          }
        }
        @keyframes particle-rise {
          0% {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
          100% {
            transform: translateY(-100px) scale(0);
            opacity: 0;
          }
        }
        @keyframes orb-decrease {
          0% {
            transform: scale(1);
            color: rgb(239, 68, 68);
          }
          50% {
            transform: scale(1.15);
            color: rgb(220, 38, 38);
            text-shadow: 0 0 10px rgba(239, 68, 68, 0.8);
          }
          100% {
            transform: scale(1);
            color: rgb(255, 255, 255);
          }
        }
        @keyframes orb-increase {
          0% {
            transform: scale(1);
            color: rgb(34, 197, 94);
          }
          50% {
            transform: scale(1.15);
            color: rgb(22, 163, 74);
            text-shadow: 0 0 10px rgba(34, 197, 94, 0.8);
          }
          100% {
            transform: scale(1);
            color: rgb(255, 255, 255);
          }
        }
        @keyframes crate-wobble {
          0%, 100% {
            transform: rotate(-2deg) translateY(0);
          }
          25% {
            transform: rotate(2deg) translateY(-3px);
          }
          50% {
            transform: rotate(-2deg) translateY(0);
          }
          75% {
            transform: rotate(2deg) translateY(-3px);
          }
        }
        .orb-animate-decrease {
          animation: orb-decrease 0.6s ease-out;
        }
        .orb-animate-increase {
          animation: orb-increase 0.6s ease-out;
        }
        .crate-wobble {
          animation: crate-wobble 1.5s ease-in-out infinite;
        }
      `}</style>
      <div className="fixed inset-0 flex items-center justify-start z-50 p-4 pointer-events-none">
        <div 
          className="bg-gray-900 rounded-xl border-2 border-amber-500 shadow-2xl w-[800px] max-h-[85vh] overflow-hidden flex flex-col pointer-events-auto ml-4 relative" 
          style={{ boxShadow: '0 0 30px rgba(251, 191, 36, 0.5), 0 0 60px rgba(0, 0, 0, 0.8)' }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* Rising particle effects for the modal - from all four sides */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-xl">
            {[...Array(40)].map((_, i) => {
              const side = i % 4; // 0: bottom, 1: top, 2: left, 3: right
              const colorIndex = i % 3;
              const backgroundColor = colorIndex === 0 
                ? 'rgba(251, 191, 36, 0.6)' // amber
                : colorIndex === 1
                ? 'rgba(249, 115, 22, 0.6)' // orange
                : 'rgba(251, 191, 36, 0.4)'; // lighter amber
              
              let positionStyle: { left?: string; right?: string; top?: string; bottom?: string } = {};
              
              if (side === 0) {
                // Bottom edge
                positionStyle = {
                  left: `${Math.random() * 100}%`,
                  bottom: '-10px',
                };
              } else if (side === 1) {
                // Top edge
                positionStyle = {
                  left: `${Math.random() * 100}%`,
                  top: '-10px',
                };
              } else if (side === 2) {
                // Left edge
                positionStyle = {
                  left: '-10px',
                  top: `${Math.random() * 100}%`,
                };
              } else {
                // Right edge
                positionStyle = {
                  right: '-10px',
                  top: `${Math.random() * 100}%`,
                };
              }
              
              return (
                <div
                  key={i}
                  className="absolute rounded-full"
                  style={{
                    width: `${3 + Math.random() * 3}px`,
                    height: `${3 + Math.random() * 3}px`,
                    backgroundColor: backgroundColor,
                    ...positionStyle,
                    animation: `particle-rise ${2 + Math.random() * 2}s ease-out infinite`,
                    animationDelay: `${Math.random() * 2}s`,
                    boxShadow: `0 0 4px rgba(251, 191, 36, 0.8), 0 0 8px rgba(251, 191, 36, 0.4)`,
                    zIndex: 1,
                  }}
                />
              );
            })}
          </div>
          
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-700 shrink-0">
            <h2 className="text-2xl font-pixel text-amber-400 flex items-center gap-2">
              📦 {lootBox.name}
            </h2>
            <button
              onClick={() => {
                playCloseSound();
                cleanup();
                onClose();
              }}
              className="text-gray-400 hover:text-white transition-colors text-2xl"
            >
              ×
            </button>
          </div>
          
          {/* Content */}
          <div className="flex-1 overflow-hidden flex flex-col p-6">
            {/* Orb balance at top */}
            <div className="mb-4 flex items-center justify-center shrink-0">
              <div className="flex items-center gap-2">
              <span className="text-cyan-300 font-pixel">●</span>
              <span 
                className={`font-pixel text-lg transition-colors ${
                  orbAnimation === 'decrease' 
                    ? 'orb-animate-decrease text-white' 
                    : orbAnimation === 'increase' 
                    ? 'orb-animate-increase text-white' 
                    : 'text-white'
                }`}
              >
                {playerOrbs.toLocaleString()}
              </span>
              <span className="text-gray-400 font-pixel text-sm">orbs</span>
              <span className="text-gray-500 font-pixel text-xs">({lootBox.price.toLocaleString()} per case)</span>
              {!canAfford && (
                <button
                  onClick={() => {
                    playBuyOrbsSound();
                    toggleBuyOrbs();
                  }}
                  className="relative overflow-hidden ml-4 px-4 py-2 rounded-lg font-pixel text-sm 
                             bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 
                             text-white shadow-lg shadow-amber-500/40 hover:shadow-amber-500/60
                             transition-all duration-200 flex items-center justify-center gap-2"
                >
                  {/* Small particle effects */}
                  <span className="absolute w-1 h-1 bg-yellow-300 rounded-full animate-btn-particle-1 opacity-60" />
                  <span className="absolute w-0.5 h-0.5 bg-amber-200 rounded-full animate-btn-particle-2 opacity-50" />
                  <span className="absolute w-1 h-1 bg-orange-300 rounded-full animate-btn-particle-3 opacity-60" />
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="relative z-10">Buy Orbs</span>
                </button>
              )}
              </div>
            </div>
            
            {/* Reward box area - always visible to keep UI static */}
            <div className="mb-4 shrink-0 min-h-[280px] flex items-center justify-center gap-4">
              {(selectedItem || pendingSelectedItemRef.current) ? (() => {
                const displayItem = selectedItem || pendingSelectedItemRef.current;
                if (!displayItem) return null;
                return (
                  // Show reward when item is selected - same size box as crate, with info box on the right
                  <>
                    <div 
                      className="bg-gray-800 rounded-lg p-6 border-2 w-[280px] h-[280px] flex items-center justify-center"
                      style={{ borderColor: RARITY_BORDER_COLORS[displayItem.rarity || 'common'] }}
                    >
                      <ItemPreview item={displayItem} size={128} />
                    </div>
                    <div className="bg-gray-800 rounded-lg p-6 border-2 w-[280px] h-[280px] flex flex-col justify-center overflow-hidden" style={{ borderColor: RARITY_BORDER_COLORS[displayItem.rarity || 'common'] }}>
                      <h3 className={`font-pixel text-xl mb-1 text-center break-words line-clamp-2 ${RARITY_COLORS[displayItem.rarity || 'common'].text}`}>
                        {displayItem.name}
                      </h3>
                      <p className={`font-pixel text-sm mb-2 text-center ${RARITY_COLORS[displayItem.rarity || 'common'].text}`}>
                        [{displayItem.rarity || 'common'}]
                      </p>
                      <div className="mb-2 text-center">
                        <p className="text-gray-300 font-pixel text-xs">
                          Shop Value:
                        </p>
                        <p className="text-cyan-300 font-pixel text-sm flex items-center justify-center gap-1">
                          <span>●</span>
                          <span>{displayItem.price.toLocaleString()}</span>
                        </p>
                      </div>
                      {isItemOwned ? (
                        <div className="mt-2">
                          <p className="text-yellow-400 font-pixel text-xs mb-1 text-center">
                            ⚠️ You already own this item!
                          </p>
                          <p className="text-cyan-300 font-pixel text-xs text-center">
                            Refunded {refundAmount.toLocaleString()} orbs ({lootBox ? Math.floor((refundAmount / lootBox.price) * 100) : 50}% of case value)
                          </p>
                        </div>
                      ) : (
                        <p className="text-gray-300 font-pixel text-xs mt-2 text-center">
                          You received a {displayItem.rarity || 'common'} item!
                        </p>
                      )}
                    </div>
                  </>
                );
              })() : (
                // Show wobbling crate when waiting to unlock - same size box as reward
                <div className="bg-gray-800 rounded-lg p-6 border-2 border-amber-400 w-[280px] h-[280px] flex items-center justify-center">
                  <div className="crate-wobble text-8xl">📦</div>
                </div>
              )}
            </div>
            
            {/* Buttons below crate/reward box */}
            {selectedItem && (
              <div className="flex gap-3 justify-center mb-4">
                  <button
                    onClick={() => {
                      playClickSound();
                      // Reset to allow opening another case - reset to initial position showing items to left
                      setSelectedItem(null);
                      pendingSelectedItemRef.current = null;
                      setIsOpening(false);
                      isOpeningRef.current = false;
                      isResettingRef.current = true; // Mark that we're resetting to unlock another
                      
                      if (normalizedItems.length > 0) {
                        const itemWidth = 144;
                        
                        // Find the first legendary item index in the normalized items (for spinner)
                        const firstLegendaryIndex = normalizedItems.findIndex(item => (item.item.rarity || 'common') === 'legendary');
                        
                        // If legendary items exist, start at the first legendary item
                        // Otherwise, start at 2 full sets of items
                        let initialPosition;
                        if (firstLegendaryIndex >= 0) {
                          // Start at the first legendary item in the 2nd set (so it's visible)
                          initialPosition = normalizedItems.length * itemWidth + (firstLegendaryIndex * itemWidth);
                        } else {
                          // Fallback: Start at 2 full sets of items
                          initialPosition = normalizedItems.length * itemWidth * 2;
                        }
                        
                        // Smoothly transition back to initial position
                        setScrollPosition(initialPosition);
                      }
                      
                      // Wait a moment for the reset, then open the next case
                      setTimeout(() => {
                        if (canAfford && lootBox) {
                          handleOpen();
                        }
                      }, 100);
                    }}
                    disabled={!canAfford || isOpening}
                    className={`
                      px-6 py-2 rounded-lg font-pixel transition-all
                      ${canAfford
                        ? 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white shadow-lg shadow-amber-500/30'
                        : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                      }
                    `}
                  >
                    🔓 Unlock Another
                  </button>
                  <button
                    onClick={() => {
                      playCloseSound();
                      cleanup();
                      onClose();
                    }}
                    className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-pixel transition-colors"
                  >
                    Close
                  </button>
                </div>
            )}
            
            {/* Unlock button below crate when waiting */}
            {!selectedItem && (
              <div className="flex justify-center mb-4">
                {canAfford ? (
                  <button
                    onClick={(e) => {
                      // Double-check guards before allowing click - ref check is synchronous
                      if (isOpeningRef.current || isOpening) {
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                      }
                      handleOpen();
                    }}
                    disabled={isOpening}
                    className={`px-8 py-3 rounded-lg font-pixel text-lg transition-all flex items-center justify-center gap-2
                               ${isOpening
                                 ? 'bg-gray-700 text-gray-500 cursor-not-allowed opacity-60 pointer-events-none' 
                                 : 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white shadow-lg shadow-amber-500/30'
                               }`}
                    style={isOpening ? { pointerEvents: 'none' } : undefined}
                  >
                    <span>🔓</span>
                    <span>Unlock</span>
                    <span className={isOpening ? "text-gray-500" : "text-cyan-300"}>●</span>
                    <span>{lootBox.price.toLocaleString()}</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-3 px-8 py-3 rounded-lg bg-gray-700">
                    <span className="text-gray-500 font-pixel text-lg">Not Enough Orbs</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        playBuyOrbsSound();
                        toggleBuyOrbs();
                      }}
                      className="relative overflow-hidden px-4 py-2 rounded font-pixel text-sm 
                                 bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 
                                 text-white shadow-md shadow-amber-500/40 hover:shadow-amber-500/60
                                 transition-all duration-200 flex items-center gap-2"
                    >
                      {/* Small particle effects */}
                      <span className="absolute w-1 h-1 bg-yellow-300 rounded-full animate-btn-particle-1 opacity-60" />
                      <span className="absolute w-0.5 h-0.5 bg-amber-200 rounded-full animate-btn-particle-2 opacity-50" />
                      <span className="absolute w-1 h-1 bg-orange-300 rounded-full animate-btn-particle-3 opacity-60" />
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="relative z-10">Buy Orbs</span>
                    </button>
                  </div>
                )}
              </div>
            )}
            
            {/* Scroller - always visible */}
            <div className="relative h-48 mb-6 shrink-0 overflow-hidden" style={{ paddingTop: '10px', paddingBottom: '10px' }}>
              {/* Center highlight */}
              <div className="absolute left-1/2 top-0 bottom-0 w-32 -translate-x-1/2 border-2 border-amber-400 bg-amber-400/10 z-10 pointer-events-none" />
              
              {/* Scrolling items container with overflow for particles */}
              <div className="relative h-full overflow-visible">
              <div
                ref={scrollRef}
                className="flex gap-4 h-full"
                style={{
                  transform: `translateX(calc(50% - 64px - ${scrollPosition}px))`,
                  // No transition during opening animation, smooth transition when resetting, no transition when showing result
                  transition: (isOpening && !selectedItem) || selectedItem ? 'none' : 'transform 0.3s ease-out',
                  willChange: isOpening && !selectedItem ? 'transform' : 'auto',
                }}
              >
              {/* Duplicate items multiple times for seamless scrolling - need extra at start for left visibility */}
              {[...normalizedItems, ...normalizedItems, ...normalizedItems, ...normalizedItems, ...normalizedItems].map(({ item }, index) => {
                const baseIndex = index % normalizedItems.length;
                const originalIndex = normalizedItems.findIndex(i => i.item.id === item.id);
                const rarityColor = RARITY_COLORS[item.rarity || 'common'];
                const isSelected = selectedItem?.id === item.id && baseIndex === originalIndex;
                const rarity = item.rarity || 'common';
                const isHighRarity = rarity === 'epic' || rarity === 'legendary';
                const glowColor = rarityColor.glow;
                const borderColor = RARITY_BORDER_COLORS[rarity];
                
                return (
                  <div
                    key={`${item.id}-${index}`}
                    className={`
                      flex-shrink-0 w-32 h-32 rounded-lg p-2 relative transition-all
                      ${isSelected 
                        ? 'border-4 border-amber-400 scale-110 shadow-2xl z-20' 
                        : 'border-2 opacity-60'
                      }
                    `}
                    style={{
                      borderColor: isSelected ? '#fbbf24' : borderColor,
                      backgroundColor: isSelected ? 'rgba(251, 191, 36, 0.1)' : 'rgba(17, 24, 39, 0.8)',
                      boxShadow: isHighRarity ? `0 0 10px ${glowColor}, 0 0 20px ${glowColor}, 0 0 30px ${glowColor}` : undefined,
                      overflow: 'visible',
                      zIndex: isHighRarity ? 5 : 1,
                    }}
                  >
                    <div className="w-full h-full bg-gray-900 rounded flex items-center justify-center relative" style={{ overflow: 'visible' }}>
                      <ItemPreview item={item} size={80} animate={false} />
                      {isHighRarity && (
                        <>
                          {/* Particle effects going up */}
                          {[...Array(8)].map((_, i) => (
                            <div
                              key={i}
                              className="absolute rounded-full pointer-events-none"
                              style={{
                                width: '4px',
                                height: '4px',
                                backgroundColor: glowColor,
                                left: `${15 + (i * 12)}%`,
                                bottom: '-8px',
                                animation: `particle-rise ${1.5 + (i * 0.15)}s ease-out infinite`,
                                animationDelay: `${i * 0.1}s`,
                                boxShadow: `0 0 6px ${glowColor}, 0 0 12px ${glowColor}`,
                                zIndex: 50,
                              }}
                            />
                          ))}
                        </>
                      )}
                    </div>
                    {isSelected && (
                      <div className="absolute -top-2 -right-2 bg-amber-400 text-gray-900 rounded-full w-8 h-8 flex items-center justify-center font-pixel text-xs font-bold z-30">
                        ✓
                      </div>
                    )}
                  </div>
                );
              })}
              </div>
              </div>
            </div>
            
            {/* Possible items list - scrollable */}
            <div className="flex-1 overflow-y-auto">
              <p className="text-gray-300 font-pixel text-sm mb-4">
                This case contains {sortedItems.length} possible items:
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-2">
              {sortedItems.map(({ item, normalizedChance }) => {
                const rarityColor = RARITY_COLORS[item.rarity || 'common'];
                const rarity = item.rarity || 'common';
                const borderColor = RARITY_BORDER_COLORS[rarity];
                
                return (
                  <div
                    key={item.id}
                    className="bg-gray-800 rounded p-1.5 border relative"
                    style={{ 
                      borderColor: borderColor,
                      willChange: 'auto',
                    }}
                  >
                    <div className="w-full aspect-square bg-gray-900 rounded mb-1 flex items-center justify-center relative" style={{ willChange: 'auto' }}>
                      <ItemPreview item={item} size={40} animate={false} />
                    </div>
                    <p className={`font-pixel text-[9px] text-center mb-0.5 truncate ${rarityColor.text}`} title={item.name}>
                      {item.name}
                    </p>
                    <div className={`text-center px-1 py-0.5 rounded mb-0.5 ${rarityColor.bg} ${rarityColor.text}`}>
                      <p className="font-pixel text-[8px]">
                        {normalizedChance.toFixed(2)}%
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="font-pixel text-[8px] text-gray-400">
                        {formatPrice(item.price || 0)}
                      </p>
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
            
            {/* Case selector menu at bottom */}
            <div className="mt-4 pt-4 border-t border-gray-700 shrink-0">
              <p className="text-gray-300 font-pixel text-sm mb-2">Switch Case:</p>
              <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
                {allLootBoxes.map(box => {
                  const isSelected = lootBox?.id === box.id;
                  const canAffordBox = playerOrbs >= box.price;
                  return (
                    <button
                      key={box.id}
                      onClick={() => {
                        if (!isSelected) {
                          playClickSound();
                          setSelectedLootBox(box);
                        }
                      }}
                      className={`
                        flex-shrink-0 px-4 py-2 rounded-lg border-2 font-pixel text-xs transition-all
                        ${isSelected
                          ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                          : canAffordBox
                          ? 'bg-gray-800 border-gray-600 text-white hover:bg-gray-700 hover:border-gray-500'
                          : 'bg-gray-800/50 border-gray-700 text-gray-500 opacity-60'
                        }
                      `}
                    >
                      <div className="text-center">
                        <div className="text-lg mb-1">📦</div>
                        <div className="font-bold truncate max-w-[100px]">{box.name}</div>
                        <div className={`text-[10px] ${canAffordBox ? 'text-cyan-300' : 'text-gray-500'}`}>
                          {box.price.toLocaleString()}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
