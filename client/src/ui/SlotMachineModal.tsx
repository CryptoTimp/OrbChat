import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../state/gameStore';
import { useSocket } from '../hooks/useSocket';
import { playClickSound, playCloseSound, playLevelUpSound, playBlackjackLossSound } from '../utils/sounds';
import { ItemRarity } from '../types';
import { updateUserOrbs } from '../firebase/auth';

const MIN_BET = 5000;
const MAX_BET = 25000;
const BET_OPTIONS = [5000, 10000, 15000, 20000, 25000];

// Slot symbols based on rarity types + orbs
type SlotSymbol = ItemRarity | 'orb';

const SYMBOL_ORDER: SlotSymbol[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'godlike', 'orb'];

// Standard 5-reel slot machine odds (weighted probabilities)
const SYMBOL_WEIGHTS: Record<SlotSymbol, number> = {
  common: 40,      // Most common
  uncommon: 25,    // Common
  rare: 15,        // Uncommon
  epic: 10,        // Rare
  legendary: 6,    // Very rare
  godlike: 3,      // Extremely rare
  orb: 1           // Rarest (jackpot symbol)
};

// Calculate total weight for probability normalization
const TOTAL_WEIGHT = Object.values(SYMBOL_WEIGHTS).reduce((sum, weight) => sum + weight, 0);

// Payout multipliers for winning combinations
const PAYOUTS: Record<string, number> = {
  '5_orb': 1000,           // 5 orbs = 1000x
  '5_godlike': 500,        // 5 godlike = 500x
  '5_legendary': 250,      // 5 legendary = 250x
  '5_epic': 100,           // 5 epic = 100x
  '5_rare': 50,            // 5 rare = 50x
  '5_uncommon': 20,        // 5 uncommon = 20x
  '5_common': 10,          // 5 common = 10x
  '4_orb': 200,            // 4 orbs = 200x
  '4_godlike': 100,        // 4 godlike = 100x
  '4_legendary': 50,       // 4 legendary = 50x
  '4_epic': 25,            // 4 epic = 25x
  '4_rare': 15,            // 4 rare = 15x
  '4_uncommon': 8,         // 4 uncommon = 8x
  '4_common': 5,           // 4 common = 5x
  '3_orb': 50,             // 3 orbs = 50x
  '3_godlike': 25,         // 3 godlike = 25x
  '3_legendary': 10,       // 3 legendary = 10x
  '3_epic': 5,             // 3 epic = 5x
  '3_rare': 3,             // 3 rare = 3x
  '3_uncommon': 2,         // 3 uncommon = 2x
  '3_common': 1.5,         // 3 common = 1.5x
};

// Get symbol color based on rarity
function getSymbolColor(symbol: SlotSymbol): string {
  switch (symbol) {
    case 'common': return '#9ca3af';      // Gray
    case 'uncommon': return '#10b981';    // Green
    case 'rare': return '#3b82f6';        // Blue
    case 'epic': return '#8b5cf6';        // Purple
    case 'legendary': return '#f59e0b';   // Orange
    case 'godlike': return '#ef4444';     // Red
    case 'orb': return '#fbbf24';         // Gold
    default: return '#ffffff';
  }
}

// Get symbol display - returns orb emoji
function getSymbolText(symbol: SlotSymbol): string {
  return '●'; // Always show orb symbol
}

interface ReelState {
  symbols: SlotSymbol[];
  spinning: boolean;
  currentIndex: number;
  targetIndex: number;
  startSpinIndex?: number; // Store starting index when spin begins
}

interface SlotMachineModalProps {
  slotMachineId: string;
}

export function SlotMachineModal({ slotMachineId }: SlotMachineModalProps) {
  const openSlotMachines = useGameStore(state => state.openSlotMachines);
  const closeSlotMachine = useGameStore(state => state.closeSlotMachine);
  const localPlayer = useGameStore(state => state.localPlayer);
  const { spinSlotMachine } = useSocket();
  
  const slotMachineOpen = openSlotMachines.has(slotMachineId);
  
  const [betAmount, setBetAmount] = useState(5000); // Default to minimum bet
  const [slotMachineName, setSlotMachineName] = useState<string>('Slot Machine');
  
  // Particle system for slot machine effects
  interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    size: number;
    color: string;
  }
  
  const [particles, setParticles] = useState<Particle[]>([]);
  const particleAnimationRef = useRef<number>();
  const lastParticleSpawnRef = useRef<number>(0);
  const [reels, setReels] = useState<ReelState[]>([
    { symbols: [], spinning: false, currentIndex: 0, targetIndex: 0 },
    { symbols: [], spinning: false, currentIndex: 0, targetIndex: 0 },
    { symbols: [], spinning: false, currentIndex: 0, targetIndex: 0 },
    { symbols: [], spinning: false, currentIndex: 0, targetIndex: 0 },
    { symbols: [], spinning: false, currentIndex: 0, targetIndex: 0 },
  ]);
  const [isSpinning, setIsSpinning] = useState(false);
  const [activeReelIndex, setActiveReelIndex] = useState<number | null>(null); // Which reel is currently spinning (0-4)
  const [lastResult, setLastResult] = useState<{ symbols: SlotSymbol[]; payout: number } | null>(null);
  const [balance, setBalance] = useState(localPlayer?.orbs || 0);
  const [gameHistory, setGameHistory] = useState<Array<{ won: boolean; amount: number; bet: number }>>([]);
  const [showInfo, setShowInfo] = useState(false);
  const [sessionStartingBalance, setSessionStartingBalance] = useState<number | null>(null);
  const [lastSpinTime, setLastSpinTime] = useState<number>(0); // Track last spin time for cooldown
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0); // Cooldown remaining in seconds
  const pendingResultRef = useRef<{ symbols: SlotSymbol[]; payout: number; bet: number; newBalance?: number } | null>(null);
  const sessionSlotChangesRef = useRef<number>(0); // Track only slot machine balance changes for session P/L
  
  // Drag state for modal
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [modalPosition, setModalPosition] = useState({ x: 0, y: 0 });
  const [initialDragPosition, setInitialDragPosition] = useState({ x: 0, y: 0 });
  const modalRef = useRef<HTMLDivElement>(null);
  
  // Resize state for modal
  const [modalSize, setModalSize] = useState({ width: 0, height: 0 });
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<HTMLDivElement>(null);
  
  // Minimum and maximum sizes (in pixels)
  const MIN_WIDTH = 600;
  const MAX_WIDTH = 1400;
  const MIN_HEIGHT = 500;
  const MAX_HEIGHT = 900;
  
  const animationFrameRef = useRef<number>();
  const reelStartTimesRef = useRef<number[]>([]); // Start time for each reel
  const finalSymbolsRef = useRef<SlotSymbol[] | null>(null); // Store final symbols from server
  const reelLandedSoundPlayedRef = useRef<boolean[]>([]); // Track if landing sound has been played for each reel
  
  // Slot machine names map
  const SLOT_MACHINE_NAMES: Record<string, string> = {
    'slot_machine_north': 'Orb Fortune',
    'slot_machine_east': 'Orb Destiny',
    'slot_machine_south': 'Orb Glory',
    'slot_machine_west': 'Orb Victory'
  };

  // Slot machine themes
  interface SlotMachineTheme {
    primary: string;      // Main border/accents
    secondary: string;    // Secondary accents
    background: string;   // Modal background
    text: string;         // Primary text
    glow: string;         // Glow color
    particles: string[];  // Particle colors
  }

  const SLOT_MACHINE_THEMES: Record<string, SlotMachineTheme> = {
    'Orb Fortune': {
      primary: '#fbbf24',      // Gold
      secondary: '#f59e0b',    // Amber
      background: '#1f2937',    // Dark gray
      text: '#fbbf24',          // Gold text
      glow: '#fbbf24',          // Gold glow
      particles: ['#fbbf24', '#f59e0b', '#fcd34d', '#fef3c7'] // Gold variations
    },
    'Orb Destiny': {
      primary: '#8b5cf6',      // Purple
      secondary: '#7c3aed',     // Deep purple
      background: '#1e1b2e',    // Dark purple-gray
      text: '#a78bfa',          // Light purple text
      glow: '#8b5cf6',          // Purple glow
      particles: ['#8b5cf6', '#7c3aed', '#a78bfa', '#c4b5fd'] // Purple variations
    },
    'Orb Glory': {
      primary: '#3b82f6',      // Blue
      secondary: '#2563eb',     // Deep blue
      background: '#1e293b',    // Dark blue-gray
      text: '#60a5fa',          // Light blue text
      glow: '#3b82f6',          // Blue glow
      particles: ['#3b82f6', '#2563eb', '#60a5fa', '#93c5fd'] // Blue variations
    },
    'Orb Victory': {
      primary: '#10b981',      // Green
      secondary: '#059669',    // Deep green
      background: '#1e2e24',    // Dark green-gray
      text: '#34d399',          // Light green text
      glow: '#10b981',          // Green glow
      particles: ['#10b981', '#059669', '#34d399', '#6ee7b7'] // Green variations
    }
  };

  // Get current theme
  const currentTheme = SLOT_MACHINE_THEMES[slotMachineName] || SLOT_MACHINE_THEMES['Orb Fortune'];
  
  // Initialize reels with symbols (only when modal first opens)
  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (slotMachineOpen && !hasInitializedRef.current) {
      // Set slot machine name based on ID
      setSlotMachineName(SLOT_MACHINE_NAMES[slotMachineId] || 'Slot Machine');
      
      // Only initialize once when modal first opens
      const extendedSymbols: SlotSymbol[] = [];
      for (let i = 0; i < 100; i++) {
        // Weighted random selection
        let random = Math.random() * TOTAL_WEIGHT;
        for (const symbol of SYMBOL_ORDER) {
          random -= SYMBOL_WEIGHTS[symbol];
          if (random <= 0) {
            extendedSymbols.push(symbol);
            break;
          }
        }
      }
      
      setReels([
        { symbols: extendedSymbols, spinning: false, currentIndex: Math.floor(Math.random() * extendedSymbols.length), targetIndex: 0 },
        { symbols: extendedSymbols, spinning: false, currentIndex: Math.floor(Math.random() * extendedSymbols.length), targetIndex: 0 },
        { symbols: extendedSymbols, spinning: false, currentIndex: Math.floor(Math.random() * extendedSymbols.length), targetIndex: 0 },
        { symbols: extendedSymbols, spinning: false, currentIndex: Math.floor(Math.random() * extendedSymbols.length), targetIndex: 0 },
        { symbols: extendedSymbols, spinning: false, currentIndex: Math.floor(Math.random() * extendedSymbols.length), targetIndex: 0 },
      ]);
      
      const startingBalance = localPlayer?.orbs || 0;
      setBalance(startingBalance);
      setSessionStartingBalance(startingBalance); // Track starting balance for session stats
      sessionSlotChangesRef.current = 0; // Reset slot changes tracking
      hasInitializedRef.current = true;
    } else if (!slotMachineOpen) {
      // Reset initialization flag when modal closes
      hasInitializedRef.current = false;
      setSessionStartingBalance(null); // Reset session stats when modal closes
      sessionSlotChangesRef.current = 0; // Reset slot changes tracking
    }
  }, [slotMachineOpen, slotMachineId]); // Depend on slotMachineId to update name
  
  // Track when we've just updated balance from slot machine result for THIS specific modal
  const justUpdatedFromSlotRef = useRef(false);
  const pendingBalanceUpdateRef = useRef<number | null>(null);
  
  // Always sync balance from localPlayer.orbs, but use pendingBalanceUpdateRef for optimistic updates during animation
  // This ensures all modals stay in sync
  useEffect(() => {
    // Only use pending balance if we're currently spinning (optimistic update)
    // Otherwise, always use the actual player balance from the store
    if (isSpinning && pendingBalanceUpdateRef.current !== null) {
      setBalance(pendingBalanceUpdateRef.current);
    } else if (localPlayer?.orbs !== undefined) {
      setBalance(localPlayer.orbs);
      // Clear pending update when we sync from store
      if (pendingBalanceUpdateRef.current !== null) {
        pendingBalanceUpdateRef.current = null;
      }
    }
  }, [localPlayer?.orbs, isSpinning]);
  
  // Sequential reel animation (left to right, 3 seconds per reel)
  useEffect(() => {
    if (!isSpinning) {
      // Reset when not spinning
      setActiveReelIndex(null);
      reelStartTimesRef.current = [];
      reelLandedSoundPlayedRef.current = [];
      return;
    }
    
    const SPIN_DURATION = 1000; // 1 second - all reels spin together
    const STOP_DELAY = 200; // 0.2 seconds between each reel stopping
    let animationStartTime: number | null = null;

    const animate = (currentTime: number) => {
      if (animationStartTime === null) {
        animationStartTime = currentTime;
      }

      // Initialize start times for all reels
      // All reels start spinning at the same time
      // Then they stop sequentially with STOP_DELAY between each
      if (reelStartTimesRef.current.length === 0) {
        reelStartTimesRef.current = reels.map((_, index) => {
          // All start at the same time, but stop at different times
          // First reel stops at SPIN_DURATION, then each subsequent reel stops STOP_DELAY later
          return animationStartTime!;
        });
      }
      
      setReels(prev => prev.map((reel, index) => {
        const reelStartTime = reelStartTimesRef.current[index];
        const elapsed = currentTime - reelStartTime;
        
        // Calculate when this reel should stop (declare once at the top)
        // All reels spin for SPIN_DURATION, then stop sequentially
        const reelStopTime = SPIN_DURATION + (index * STOP_DELAY);
        
        // Check if this reel should be spinning
        if (elapsed < 0) {
          // Not started yet - keep current state
          return reel;
        }
        
        if (elapsed >= reelStopTime) {
          // Reel has finished - ensure it's on the correct final position
          // Always use targetIndex from server result, double-check with finalSymbolsRef
          let finalIndex = reel.targetIndex;
          
          if (finalSymbolsRef.current && finalSymbolsRef.current[index]) {
            const targetSymbol = finalSymbolsRef.current[index];
            const symbolIndex = reel.symbols.findIndex(s => s === targetSymbol);
            if (symbolIndex >= 0) {
              finalIndex = symbolIndex;
            }
          }
          
          // CRITICAL: Ensure we're exactly on the target index (no rounding errors)
          // Force the index to match the target exactly
          finalIndex = finalIndex % reel.symbols.length;
          if (finalIndex < 0) finalIndex += reel.symbols.length;
          
          // CRITICAL: Ensure finalIndex is valid and within bounds
          if (finalIndex < 0 || finalIndex >= reel.symbols.length) {
            finalIndex = 0; // Fallback to first symbol if invalid
          }
          
          // CRITICAL: Verify the symbol at finalIndex matches the target symbol from server
          // If not, update it to ensure correct display
          // Create a new symbols array to avoid mutating the original
          const updatedSymbols = [...reel.symbols];
          if (finalSymbolsRef.current && finalSymbolsRef.current[index]) {
            const targetSymbol = finalSymbolsRef.current[index];
            const currentSymbolAtIndex = updatedSymbols[finalIndex];
            
            // If the symbol at the final index doesn't match the target, update it
            if (currentSymbolAtIndex !== targetSymbol) {
              updatedSymbols[finalIndex] = targetSymbol;
              console.log('[SlotMachine] Updated symbol at index', finalIndex, 'to match target:', targetSymbol);
            }
          }
          
          // Play click sound when reel lands (only once per reel)
          if (!reelLandedSoundPlayedRef.current[index]) {
            playClickSound();
            reelLandedSoundPlayedRef.current[index] = true;
          }
          
          // CRITICAL: Keep the reel at final position and DO NOT reset
          // The reel should stay here until the next spin
          // IMPORTANT: Preserve the symbols array - DO NOT reset it
          return {
            ...reel,
            symbols: updatedSymbols, // Use updated symbols array with correct target symbol
            spinning: false, // Stop spinning
            currentIndex: finalIndex, // Stay at final position - DO NOT RESET
            targetIndex: finalIndex, // Ensure targetIndex matches final position
            startSpinIndex: undefined, // Clear start index
            // CRITICAL: Keep symbols array unchanged - preserve the reel state
            // DO NOT reset currentIndex or targetIndex - they should persist
          };
        }
        
        // Reel is spinning - calculate position with strong ease-out for dramatic slowdown
        // Progress is based on how far through the spin we are (0 to reelStopTime)
        // reelStopTime is already declared above
        const progress = Math.min(elapsed / reelStopTime, 1.0); // Clamp to 1.0
        
        // Early lock to target if we're very close (prevents visual drift)
        if (progress >= 0.95) {
          // In the last 5%, immediately lock to target to prevent any visual mismatch
          let finalIndex = reel.targetIndex % reel.symbols.length;
          if (finalIndex < 0) finalIndex += reel.symbols.length;
          
          // Ensure finalIndex is valid
          if (finalIndex < 0 || finalIndex >= reel.symbols.length) {
            finalIndex = 0;
          }
          
          // Double-check with finalSymbolsRef to ensure correct target
          if (finalSymbolsRef.current && finalSymbolsRef.current[index]) {
            const targetSymbol = finalSymbolsRef.current[index];
            const symbolIndex = reel.symbols.findIndex(s => s === targetSymbol);
            if (symbolIndex >= 0) {
              finalIndex = symbolIndex;
            }
          }
          
          // CRITICAL: Preserve symbols array - DO NOT modify it
          return {
            ...reel,
            spinning: true, // Still spinning for visual effect
            currentIndex: finalIndex, // Lock to exact target
            startSpinIndex: reel.startSpinIndex,
            targetIndex: finalIndex,
            // Keep symbols array unchanged - preserve the reel state
          };
        }
        
        // Calculate scroll position with smooth easing
        // Store the starting index when reel begins spinning (first frame)
        const startSpinIndex = reel.startSpinIndex !== undefined 
          ? reel.startSpinIndex 
          : reel.currentIndex;
        
        // Always use the targetIndex from server result (finalSymbolsRef)
        let targetIndex = reel.targetIndex;
        
        // Double-check with finalSymbolsRef if available to ensure correct target
        if (finalSymbolsRef.current && finalSymbolsRef.current[index]) {
          const targetSymbol = finalSymbolsRef.current[index];
          const symbolIndex = reel.symbols.findIndex(s => s === targetSymbol);
          if (symbolIndex >= 0) {
            targetIndex = symbolIndex;
          }
        }
        
        // Calculate total distance (accounting for wrap-around)
        let distance = targetIndex - startSpinIndex;
        if (distance < 0) distance += reel.symbols.length;
        
        // Smooth animation with proper deceleration
        // Use a smoother ease-out curve for better visual effect
        // Start at moderate speed, gradually slow down to a complete stop
        const baseSpins = 15; // Base number of spins for visual effect
        const finalDistance = distance + baseSpins;
        
        // Use a smoother ease-out curve (cubic ease-out)
        // This creates a more natural deceleration: starts fast, ends slow
        const smoothEaseOut = 1 - Math.pow(1 - progress, 3);
        
        // Calculate current distance traveled with smooth easing
        const currentDistance = smoothEaseOut * finalDistance;
        
        // Calculate current position
        let currentScrollIndex = (startSpinIndex + Math.floor(currentDistance)) % reel.symbols.length;
        if (currentScrollIndex < 0) currentScrollIndex += reel.symbols.length;
        
        // In the final phase (last 20%), smoothly transition to exact target
        // This ensures we always land exactly on the target symbol with smooth deceleration
        if (progress >= 0.80) {
          const finalPhaseProgress = (progress - 0.80) / 0.20; // 0 to 1 in last 20%
          // Use a strong ease-in for the final approach (slows down dramatically)
          const finalEase = 1 - Math.pow(1 - finalPhaseProgress, 5);
          
          // Calculate the shortest path to target (handling wrap-around)
          let currentPos = currentScrollIndex;
          let targetPos = targetIndex;
          
          // Find shortest distance to target (accounting for wrap-around)
          let diff = targetPos - currentPos;
          if (diff > reel.symbols.length / 2) {
            diff -= reel.symbols.length;
          } else if (diff < -reel.symbols.length / 2) {
            diff += reel.symbols.length;
          }
          
          // Interpolate smoothly to target
          const interpolatedPos = currentPos + diff * finalEase;
          currentScrollIndex = Math.round(interpolatedPos) % reel.symbols.length;
          if (currentScrollIndex < 0) currentScrollIndex += reel.symbols.length;
          
          // In the very last frames (last 3%), lock to exact target to prevent any drift
          if (progress >= 0.97) {
            currentScrollIndex = targetIndex;
          }
        }
        
        // No sound during spinning - sound will play when reel lands
        
        // Update active reel index for visual feedback
        // reelStopTime is already declared above
        if (activeReelIndex !== index && elapsed >= 0 && elapsed < reelStopTime) {
          setActiveReelIndex(index);
        }
        
        return {
          ...reel,
          spinning: true,
          currentIndex: currentScrollIndex,
          startSpinIndex: startSpinIndex,
          targetIndex: targetIndex // Ensure targetIndex is always correct
        };
      }));
      
      // Check if all reels are done
      const allDone = reels.every((reel, index) => {
        const reelStartTime = reelStartTimesRef.current[index];
        const elapsed = currentTime - reelStartTime;
        const reelStopTime = SPIN_DURATION + (index * STOP_DELAY);
        return elapsed >= reelStopTime;
      });
      
      if (allDone) {
        // All reels finished - now show result and play sounds
        // IMPORTANT: Reels are already at their final positions from the animation loop above
        // DO NOT modify the reels here - they should stay at final positions
        // CRITICAL: Ensure all reels are at their final positions with correct symbols
        setReels(prev => prev.map((reel, index) => {
          // Get the final target symbol from server
          let finalIndex = reel.currentIndex; // Use current position (already set by animation)
          
          if (finalSymbolsRef.current && finalSymbolsRef.current[index]) {
            const targetSymbol = finalSymbolsRef.current[index];
            // Find or ensure the target symbol is at the final index
            const symbolIndex = reel.symbols.findIndex(s => s === targetSymbol);
            if (symbolIndex >= 0) {
              finalIndex = symbolIndex;
            }
            
            // Ensure the symbol at finalIndex matches the target
            const updatedSymbols = [...reel.symbols];
            if (updatedSymbols[finalIndex] !== targetSymbol) {
              updatedSymbols[finalIndex] = targetSymbol;
            }
            
            return {
              ...reel,
              symbols: updatedSymbols,
              spinning: false,
              currentIndex: finalIndex,
              targetIndex: finalIndex,
              startSpinIndex: undefined
            };
          }
          
          // If no final symbols, just stop spinning and preserve current state
          return {
            ...reel,
            spinning: false,
            startSpinIndex: undefined
          };
        }));
        
        setIsSpinning(false);
        setActiveReelIndex(null);
        reelStartTimesRef.current = [];
        animationStartTime = null;
        
        // Process pending result - NOW update balance and show result
        if (pendingResultRef.current) {
          const { symbols, payout, bet, newBalance } = pendingResultRef.current;
          
          // Update balance NOW (after animation completes)
          // newBalance from server is the final balance (after bet deduction + payout)
          if (newBalance !== undefined) {
            // We already deducted the bet optimistically, so current balance is (original - bet)
            // Server's newBalance is (original - bet + payout), so we just need to add the payout
            // But to be safe, we'll use the server's newBalance directly as the source of truth
            setBalance(newBalance);
            // Clear pending update since animation is complete and we have the final balance
            pendingBalanceUpdateRef.current = null;
            
            // Track slot machine balance change for session P/L (exclude idle rewards)
            // Calculate from the balance before the spin started (before bet was deducted)
            // payout is net payout (payout - bet), so we can use it directly
            const slotChange = payout; // payout is already net (win - bet, or -bet if loss)
            sessionSlotChangesRef.current += slotChange;
            
            console.log('[SlotMachine] Balance update after animation:', {
              currentBalance: balance,
              newBalance,
              payout,
              bet,
              slotChange,
              sessionPL: sessionSlotChangesRef.current
            });
            
            const state = useGameStore.getState();
            const playerId = state.playerId;
            if (playerId) {
              // Update local state
              state.updatePlayerOrbs(playerId, newBalance);
              
              // CRITICAL: Update Firebase to persist the balance
              updateUserOrbs(playerId, newBalance).catch(error => {
                console.error('[SlotMachine] Failed to update Firebase orbs:', error);
              });
              console.log('[SlotMachine] Updated Firebase with new balance:', newBalance);
            }
          }
          
          setLastResult({ symbols, payout });
          
          // Add to game history (keep last 10)
          setGameHistory(prev => {
            const newHistory = [...prev, { won: payout > 0, amount: payout > 0 ? payout : -bet, bet }];
            return newHistory.slice(-10); // Keep last 10
          });
          
          // Play sounds
          // Only play win sound if total payout is at least 10x bet size
          // payout is net payout (totalPayout - bet), so totalPayout = payout + bet
          // We want: totalPayout >= bet * 10, which means: payout + bet >= bet * 10
          // Simplifying: payout >= bet * 9
          const totalPayout = payout + bet; // Total payout including bet return
          const isBigWin = totalPayout >= bet * 10;
          
          if (payout > 0) {
            if (isBigWin) {
              playLevelUpSound();
            }
            // Small wins don't play sound
          } else {
            playBlackjackLossSound();
          }
          
          pendingResultRef.current = null;
        }
        
        // DO NOT continue animation - reels are done and should stay at final positions
        return; // Exit animation loop - reels stay at final positions
      } else {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    };
    
    animationFrameRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isSpinning, reels, activeReelIndex]);
  
  // Cooldown timer effect
  useEffect(() => {
    const COOLDOWN_DURATION = 2500; // 2.5 seconds in milliseconds
    
    const updateCooldown = () => {
      const now = Date.now();
      const timeSinceLastSpin = now - lastSpinTime;
      const remaining = Math.max(0, COOLDOWN_DURATION - timeSinceLastSpin);
      setCooldownRemaining(remaining / 1000); // Convert to seconds
    };
    
    // Update immediately
    updateCooldown();
    
    // Update every 100ms for smooth countdown
    const interval = setInterval(updateCooldown, 100);
    
    return () => clearInterval(interval);
  }, [lastSpinTime]);
  
  const handleSpin = () => {
    // Always use the current balance from localPlayer.orbs to ensure sync across all modals
    const currentBalance = localPlayer?.orbs || 0;
    const COOLDOWN_DURATION = 2500; // 2.5 seconds in milliseconds
    const now = Date.now();
    const timeSinceLastSpin = now - lastSpinTime;
    
    // Check cooldown
    if (timeSinceLastSpin < COOLDOWN_DURATION) {
      // Still on cooldown - don't allow spin
      return;
    }
    
    if (isSpinning || !slotMachineId || currentBalance < betAmount) return;
    
    playClickSound();
    
    // IMMEDIATELY deduct bet from balance (optimistic update)
    // Server will also deduct it, but we want instant feedback
    const balanceAfterBet = currentBalance - betAmount;
    setBalance(balanceAfterBet);
    // Store pending update for this modal during animation
    pendingBalanceUpdateRef.current = balanceAfterBet;
    
    // Update game store balance immediately
    const state = useGameStore.getState();
    const playerId = state.playerId;
    if (playerId) {
      state.updatePlayerOrbs(playerId, balanceAfterBet);
      
      // CRITICAL: Update Firebase immediately when bet is deducted
      // This ensures the balance is persisted even if something goes wrong
      updateUserOrbs(playerId, balanceAfterBet).catch(error => {
        console.error('[SlotMachine] Failed to update Firebase orbs after bet deduction:', error);
      });
      console.log('[SlotMachine] Deducted bet, updated Firebase balance to:', balanceAfterBet);
    }
    
    // Clear previous result
    setLastResult(null);
    
          // Reset animation state
          reelStartTimesRef.current = [];
          finalSymbolsRef.current = null;
          reelLandedSoundPlayedRef.current = [false, false, false, false, false]; // Reset landing sounds for all 5 reels
          setActiveReelIndex(0); // Start with first reel
    
    // Store current indices as starting positions (preserve current positions - DO NOT RESET)
    // The reels should keep showing the last result until animation starts
    setReels(prev => prev.map(reel => ({
      ...reel,
      spinning: false, // Don't start spinning yet - wait for server result
      startSpinIndex: reel.currentIndex, // Start from current position (last result)
      targetIndex: reel.currentIndex, // Will be updated by server
      // Keep currentIndex unchanged - preserve what's showing (last result)
      // Keep symbols array unchanged - preserve the reel state
    })));
    
    // Emit spin to server (server will deduct bet, add payout, and send final balance)
           spinSlotMachine(slotMachineId, betAmount);
    
    // Set last spin time for cooldown
    setLastSpinTime(Date.now());
    
    // Don't set isSpinning yet - wait for server result
  };
  
  // Listen for slot machine result from server
  useEffect(() => {
    const handleSlotResult = (event: CustomEvent<{ slotMachineId: string; slotMachineName: string; symbols: SlotSymbol[]; payout: number; newBalance?: number }>) => {
      const { slotMachineId: resultSlotMachineId, slotMachineName, symbols, payout, newBalance } = event.detail;
      
      // Only process results for this specific slot machine
      if (resultSlotMachineId !== slotMachineId) return;
      
      // Update slot machine name if provided
      if (slotMachineName) {
        setSlotMachineName(slotMachineName);
      }
      
      // DON'T update balance yet - wait for animation to complete
      // Store final symbols for animation
      finalSymbolsRef.current = symbols;
      
      // Update reels to show result - set target indices and start animation
      // IMPORTANT: Preserve current positions - don't reset them
      setReels(prev => prev.map((reel, index) => {
        // Find the symbol in the reel's symbol array
        const targetSymbol = symbols[index];
        
        // CRITICAL: Ensure the target symbol exists in the symbols array
        // If not found, add it to the array at a specific position
        let symbolIndex = reel.symbols.findIndex(s => s === targetSymbol);
        
        if (symbolIndex < 0) {
          // Target symbol not found - this shouldn't happen, but handle it
          console.warn('[SlotMachine] Target symbol not found in reel symbols array:', targetSymbol, 'for reel', index);
          // Add the target symbol to the array at index 0
          reel.symbols[0] = targetSymbol;
          symbolIndex = 0;
        }
        
        const finalTargetIndex = symbolIndex;
        
        // Use current position as start (preserve what's currently showing - the last result)
        const startIndex = reel.currentIndex;
        
        return {
          ...reel,
          spinning: true, // Start spinning now that we have the target
          targetIndex: finalTargetIndex, // Set target for animation
          startSpinIndex: startIndex, // Start from current position (last result)
          currentIndex: startIndex, // Keep current position until animation starts
          // CRITICAL: Keep symbols array - it now contains the target symbol at the correct index
        };
      }));
      
      // Start the animation now that we have the correct targets
      setIsSpinning(true);
      setActiveReelIndex(0);
      
      // Store result but don't show/play sounds or update balance until animation completes
      // payout is net payout (payout - bet)
      // If payout > 0: we won (payout is the net win amount)
      // If payout <= 0: we lost (payout is negative or 0, meaning we lost the bet)
      // Use betAmount from component state (the bet that was placed)
      pendingResultRef.current = { symbols, payout, bet: betAmount, newBalance };
    };
    
    window.addEventListener('slot_machine_result', handleSlotResult as EventListener);
    return () => {
      window.removeEventListener('slot_machine_result', handleSlotResult as EventListener);
    };
  }, [slotMachineId, betAmount]);

  // Drag handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (modalRef.current) {
      e.preventDefault();
      e.stopPropagation();
      
      // Calculate the modal's center position based on the current modalPosition state
      // The modal is centered with transform: translate(calc(50% + ${modalPosition.x}px), calc(50% + ${modalPosition.y}px))
      // So the center in screen coordinates = viewport center + modalPosition
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const modalCenterX = centerX + modalPosition.x;
      const modalCenterY = centerY + modalPosition.y;
      
      // Calculate offset from click position to modal's center
      // This ensures the cursor stays exactly where the user clicked
      setDragOffset({
        x: e.clientX - modalCenterX,
        y: e.clientY - modalCenterY
      });
      setIsDragging(true);
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        e.preventDefault();
        // Calculate new center position based on mouse position and offset
        // The offset is the distance from click point to modal center
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        
        // New center = mouse position - offset from click to center
        const newCenterX = e.clientX - dragOffset.x;
        const newCenterY = e.clientY - dragOffset.y;
        
        // Convert to offset from viewport center
        setModalPosition({
          x: newCenterX - centerX,
          y: newCenterY - centerY
        });
      } else if (isResizing && modalRef.current) {
        // Calculate new size based on mouse position
        const rect = modalRef.current.getBoundingClientRect();
        const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, e.clientX - rect.left + 10));
        const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, e.clientY - rect.top + 10));
        setModalSize({ width: newWidth, height: newHeight });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = 'none'; // Prevent text selection during drag/resize
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
    };
  }, [isDragging, isResizing, dragOffset]);

  const handleResizeStart = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
  };

  if (!slotMachineOpen) return null;
  
  // Calculate paid amount from last result
  const paidAmount = lastResult ? (lastResult.payout > 0 ? lastResult.payout : 0) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div
        ref={modalRef}
        className="rounded-lg border-2 mx-4 pointer-events-auto relative overflow-hidden"
        style={{
          transform: modalPosition.x !== 0 || modalPosition.y !== 0 
            ? `translate(calc(50% + ${modalPosition.x}px), calc(50% + ${modalPosition.y}px))` 
            : undefined,
          cursor: isDragging ? 'grabbing' : 'default',
          width: modalSize.width > 0 ? `${modalSize.width}px` : undefined,
          minWidth: `${MIN_WIDTH}px`,
          maxWidth: `${MAX_WIDTH}px`,
          height: modalSize.height > 0 ? `${modalSize.height}px` : undefined,
          minHeight: `${MIN_HEIGHT}px`,
          maxHeight: `${MAX_HEIGHT}px`,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: currentTheme.background,
          borderColor: currentTheme.primary,
          boxShadow: `0 0 20px ${currentTheme.glow}40, 0 0 40px ${currentTheme.glow}20`
        }}
      >
        {/* Particle effects overlay */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 1 }}>
          {particles.map((particle, index) => (
            <div
              key={index}
              className="absolute rounded-full"
              style={{
                left: `${particle.x}%`,
                top: `${particle.y}%`,
                width: `${particle.size}px`,
                height: `${particle.size}px`,
                backgroundColor: particle.color,
                opacity: particle.life,
                boxShadow: `0 0 ${particle.size * 2}px ${particle.color}`,
                transform: 'translate(-50%, -50%)'
              }}
            />
          ))}
        </div>
        {/* Header with title and close - draggable */}
        <div 
          className="flex items-center justify-between p-3 sm:p-4 cursor-grab active:cursor-grabbing select-none flex-wrap gap-2 relative z-10"
          style={{ borderBottomColor: currentTheme.primary }}
          onMouseDown={handleMouseDown}
        >
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <h2 className="text-xl sm:text-2xl font-pixel" style={{ color: currentTheme.text, textShadow: `0 0 10px ${currentTheme.glow}` }}>
              {slotMachineName}
            </h2>
            <button
              onClick={() => { playClickSound(); setShowInfo(true); }}
              className="transition-colors text-lg sm:text-xl font-pixel border-2 rounded px-1.5 sm:px-2 py-0.5 sm:py-1 flex-shrink-0"
              style={{ 
                color: currentTheme.text,
                borderColor: currentTheme.primary,
                textShadow: `0 0 5px ${currentTheme.glow}`
              }}
              onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
              onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
              title="View odds and paytable"
            >
              i
            </button>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            {sessionStartingBalance !== null && (
              <div className="flex items-center gap-1 sm:gap-2">
                <span className="text-xs sm:text-sm font-pixel text-gray-400 whitespace-nowrap"></span>
                <span className={`text-sm sm:text-lg font-pixel whitespace-nowrap ${
                  sessionSlotChangesRef.current >= 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {sessionSlotChangesRef.current >= 0 ? '+' : ''}
                  {sessionSlotChangesRef.current.toLocaleString()}
                </span>
              </div>
            )}
            <button
              onClick={() => { playCloseSound(); closeSlotMachine(slotMachineId); }}
              className="text-gray-400 hover:text-white transition-colors text-xl sm:text-2xl flex-shrink-0"
            >
              ✕
            </button>
          </div>
        </div>
        
        {/* Main content area: Left controls, Center reels, Right spin button */}
        <div className="flex items-center gap-2 p-4 flex-1 overflow-hidden min-h-0">
          {/* Left side: Bet controls */}
          <div className="flex flex-col items-center gap-3 w-20 flex-shrink-0 justify-center self-stretch">
            <div className="text-xs font-pixel text-gray-300 text-center">BET</div>
            <div className="flex flex-col items-center gap-1.5">
              <button
                onClick={() => {
                  playClickSound();
                  const currentIndex = BET_OPTIONS.indexOf(betAmount);
                  if (currentIndex < BET_OPTIONS.length - 1) {
                    setBetAmount(BET_OPTIONS[currentIndex + 1]);
                  }
                }}
                disabled={betAmount >= MAX_BET}
                className="w-10 h-10 rounded-full disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center justify-center text-white font-bold text-lg transition-all"
                style={{
                  backgroundColor: betAmount >= MAX_BET ? '#4b5563' : currentTheme.secondary,
                  boxShadow: betAmount >= MAX_BET ? 'none' : `0 0 10px ${currentTheme.glow}40`
                }}
                onMouseEnter={(e) => {
                  if (betAmount < MAX_BET) {
                    e.currentTarget.style.backgroundColor = currentTheme.primary;
                    e.currentTarget.style.boxShadow = `0 0 15px ${currentTheme.glow}60`;
                  }
                }}
                onMouseLeave={(e) => {
                  if (betAmount < MAX_BET) {
                    e.currentTarget.style.backgroundColor = currentTheme.secondary;
                    e.currentTarget.style.boxShadow = `0 0 10px ${currentTheme.glow}40`;
                  }
                }}
                title="Increase bet"
              >
                ▲
              </button>
              <div 
                className="bg-gray-800 border-2 rounded-lg px-2 py-2 text-center"
                style={{ 
                  borderColor: currentTheme.primary,
                  boxShadow: `0 0 10px ${currentTheme.glow}30`
                }}
              >
                <div className="text-xs font-pixel" style={{ color: currentTheme.text }}>
                  {Math.floor(betAmount / 1000)}K
                </div>
              </div>
              <button
                onClick={() => {
                  playClickSound();
                  const currentIndex = BET_OPTIONS.indexOf(betAmount);
                  if (currentIndex > 0) {
                    setBetAmount(BET_OPTIONS[currentIndex - 1]);
                  }
                }}
                disabled={betAmount <= MIN_BET}
                className="w-10 h-10 rounded-full disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center justify-center text-white font-bold text-lg transition-all"
                style={{
                  backgroundColor: betAmount <= MIN_BET ? '#4b5563' : currentTheme.secondary,
                  boxShadow: betAmount <= MIN_BET ? 'none' : `0 0 10px ${currentTheme.glow}40`
                }}
                onMouseEnter={(e) => {
                  if (betAmount > MIN_BET) {
                    e.currentTarget.style.backgroundColor = currentTheme.primary;
                    e.currentTarget.style.boxShadow = `0 0 15px ${currentTheme.glow}60`;
                  }
                }}
                onMouseLeave={(e) => {
                  if (betAmount > MIN_BET) {
                    e.currentTarget.style.backgroundColor = currentTheme.secondary;
                    e.currentTarget.style.boxShadow = `0 0 10px ${currentTheme.glow}40`;
                  }
                }}
                title="Decrease bet"
              >
                ▼
              </button>
            </div>
          </div>

          {/* Center: Reels Display */}
          <div 
            className="flex-1 rounded-lg p-6 border-2 min-h-0 flex items-stretch self-stretch relative z-10"
            style={{ 
              backgroundColor: '#000000',
              borderColor: currentTheme.primary,
              boxShadow: `inset 0 0 30px ${currentTheme.glow}20`
            }}
          >
            <div className="grid grid-cols-5 gap-4 w-full h-full">
              {reels.map((reel, reelIndex) => (
                <div key={reelIndex} className="flex flex-col items-center h-full">
                  <div 
                    className="bg-gray-800 rounded border-2 w-full overflow-hidden relative transition-all"
                    style={{ 
                      height: '100%', 
                      minHeight: '200px',
                      borderColor: activeReelIndex === reelIndex && reel.spinning
                        ? currentTheme.primary
                        : currentTheme.secondary,
                      boxShadow: activeReelIndex === reelIndex && reel.spinning
                        ? `0 0 20px ${currentTheme.glow}50, 0 0 40px ${currentTheme.glow}30`
                        : `0 0 5px ${currentTheme.glow}20`
                    }}
                  >
                    {/* Display symbols with smooth scrolling animation */}
                    {reel.spinning ? (
                      // While spinning, show continuous scrolling with more symbols for smooth effect
                      Array.from({ length: 7 }).map((_, i) => {
                        const offset = i - 3; // -3, -2, -1, 0, 1, 2, 3
                        const symbolIndex = (reel.currentIndex + offset + reel.symbols.length) % reel.symbols.length;
                        const symbol = reel.symbols[symbolIndex];
                        const isCenter = offset === 0;
                        
                        // Safety check: ensure symbol is valid
                        const safeSymbol: SlotSymbol = symbol || 'common';
                        
                        // Calculate position with smooth scrolling
                        // Use fractional index for smooth visual scrolling
                        const basePosition = 50; // Center at 50%
                        const symbolHeight = 100 / 7; // Each symbol takes 1/7 of height
                        // Apply fractional offset for smooth scrolling effect
                        const fractionalOffset = (reel.currentIndex % 1) || 0; // Get fractional part if stored
                        const position = basePosition + (offset * symbolHeight) - (fractionalOffset * symbolHeight);
                        
                        return (
                          <div
                            key={i}
                            className={`absolute w-full flex items-center justify-center ${
                              isCenter ? 'border-2 z-10' : ''
                            }`}
                            style={{
                              top: `${position}%`,
                              height: `${symbolHeight}%`,
                              transition: 'none', // No transition during spin for smooth scrolling
                              ...(isCenter ? {
                                borderColor: currentTheme.primary,
                                backgroundColor: `${currentTheme.primary}20`
                              } : {})
                            }}
                          >
                            <div
                              className="text-5xl font-bold"
                              style={{ 
                                color: getSymbolColor(safeSymbol),
                                textShadow: `0 0 10px ${getSymbolColor(safeSymbol)}, 0 0 20px ${getSymbolColor(safeSymbol)}`
                              }}
                            >
                              {getSymbolText(safeSymbol)}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      // When stopped, show 3 symbols (current, above, below)
                      // CRITICAL: Ensure we use the correct currentIndex and symbols array from the last spin
                      [-1, 0, 1].map(offset => {
                        // Ensure currentIndex is valid and within bounds
                        const safeCurrentIndex = reel.currentIndex >= 0 && reel.currentIndex < reel.symbols.length 
                          ? reel.currentIndex 
                          : (reel.symbols.length > 0 ? 0 : 0);
                        const symbolIndex = (safeCurrentIndex + offset + reel.symbols.length) % reel.symbols.length;
                        const symbol = reel.symbols[symbolIndex];
                        const isCenter = offset === 0;
                        
                        // Safety check: if symbol is undefined, use the targetIndex or finalSymbolsRef
                        let safeSymbol: SlotSymbol = symbol;
                        if (!safeSymbol) {
                          // Try to get from finalSymbolsRef if available (the actual result from server)
                          if (finalSymbolsRef.current && finalSymbolsRef.current[reelIndex] && offset === 0) {
                            safeSymbol = finalSymbolsRef.current[reelIndex];
                          } else if (reel.symbols.length > 0) {
                            // Fallback to targetIndex or currentIndex
                            const fallbackIndex = reel.targetIndex >= 0 ? reel.targetIndex : reel.currentIndex;
                            safeSymbol = reel.symbols[fallbackIndex % reel.symbols.length] || 'common';
                          } else {
                            safeSymbol = 'common';
                          }
                        }
                        
                        return (
                          <div
                            key={offset}
                            className={`absolute w-full h-1/3 flex items-center justify-center transition-all ${
                              isCenter ? 'border-2' : ''
                            }`}
                            style={{
                              top: `${(offset + 1) * 33.33}%`,
                              ...(isCenter ? {
                                borderColor: currentTheme.primary,
                                backgroundColor: `${currentTheme.primary}20`
                              } : {})
                            }}
                          >
                            <div
                              className="text-5xl font-bold"
                              style={{ 
                                color: getSymbolColor(safeSymbol),
                                textShadow: `0 0 10px ${getSymbolColor(safeSymbol)}, 0 0 20px ${getSymbolColor(safeSymbol)}`
                              }}
                            >
                              {getSymbolText(safeSymbol)}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right side: Spin button */}
          <div className="flex flex-col items-center gap-3 w-20 flex-shrink-0 justify-center self-stretch">
            <div className="text-xs font-pixel text-gray-300 text-center">SPIN</div>
            <button
              onClick={handleSpin}
              disabled={isSpinning || balance < betAmount || cooldownRemaining > 0}
              className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold transition-all text-white relative"
              style={{
                backgroundColor: isSpinning || balance < betAmount || cooldownRemaining > 0 ? '#4b5563' : currentTheme.secondary,
                boxShadow: isSpinning || balance < betAmount || cooldownRemaining > 0
                  ? 'none' 
                  : `0 0 20px ${currentTheme.glow}50, 0 0 40px ${currentTheme.glow}30`,
                cursor: isSpinning || balance < betAmount || cooldownRemaining > 0 ? 'not-allowed' : 'pointer'
              }}
              onMouseEnter={(e) => {
                if (!isSpinning && balance >= betAmount && cooldownRemaining <= 0) {
                  e.currentTarget.style.backgroundColor = currentTheme.primary;
                  e.currentTarget.style.boxShadow = `0 0 30px ${currentTheme.glow}70, 0 0 60px ${currentTheme.glow}40`;
                }
              }}
              onMouseLeave={(e) => {
                const currentBal = pendingBalanceUpdateRef.current !== null ? pendingBalanceUpdateRef.current : (localPlayer?.orbs || 0);
                if (!isSpinning && currentBal >= betAmount && cooldownRemaining <= 0) {
                  e.currentTarget.style.backgroundColor = currentTheme.secondary;
                  e.currentTarget.style.boxShadow = `0 0 20px ${currentTheme.glow}50, 0 0 40px ${currentTheme.glow}30`;
                }
              }}
              title={
                isSpinning 
                  ? 'Spinning...' 
                  : cooldownRemaining > 0 
                    ? `Cooldown: ${cooldownRemaining.toFixed(1)}s` 
                    : 'Spin the reels'
              }
            >
              {isSpinning ? '⟳' : cooldownRemaining > 0 ? cooldownRemaining.toFixed(1) : '⟳'}
            </button>
          </div>
        </div>

        {/* Bottom bar: Balance, Paid */}
        <div 
          className="border-t p-2 sm:p-4 flex-shrink-0 relative z-10"
          style={{ 
            borderTopColor: currentTheme.primary,
            backgroundColor: currentTheme.background
          }}
        >
          <div className="flex flex-wrap items-center justify-center sm:justify-between gap-2 sm:gap-4 overflow-x-auto">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
              <span className="text-xs sm:text-sm font-pixel text-gray-400 whitespace-nowrap">BALANCE:</span>
              <span className="text-sm sm:text-lg font-pixel whitespace-nowrap" style={{ color: currentTheme.text }}>
                {balance.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
              <span className="text-xs sm:text-sm font-pixel text-gray-400 whitespace-nowrap">PAID:</span>
              <span className={`text-sm sm:text-lg font-pixel whitespace-nowrap ${paidAmount > 0 ? 'text-green-400' : 'text-gray-500'}`}>
                {paidAmount.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
        
        {/* Resize handle */}
        <div
          ref={resizeRef}
          onMouseDown={handleResizeStart}
          className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize transition-colors"
          style={{
            clipPath: 'polygon(100% 0, 100% 100%, 0 100%)',
            backgroundColor: `${currentTheme.primary}30`
          }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = `${currentTheme.primary}50`}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = `${currentTheme.primary}30`}
          title="Drag to resize"
        >
          <div className="absolute bottom-1 right-1 w-2 h-2 border-r-2 border-b-2 border-amber-400"></div>
        </div>
      </div>
      
      {/* Info Modal */}
      {showInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-gray-900 rounded-lg border-2 border-amber-500 max-w-2xl w-full mx-4 pointer-events-auto">
            <div className="flex items-center justify-between p-4 border-b border-amber-500">
              <h2 className="text-2xl font-pixel text-amber-400">Slot Machine Odds & Paytable</h2>
              <button
                onClick={() => { playCloseSound(); setShowInfo(false); }}
                className="text-gray-400 hover:text-white transition-colors text-2xl"
              >
                ✕
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[70vh]">
              <div className="space-y-6">
                {/* Symbol Probabilities */}
                <div>
                  <h3 className="text-xl font-pixel text-amber-400 mb-3">Symbol Probabilities</h3>
                  <div className="space-y-2 text-sm font-pixel">
                    <div className="flex justify-between text-gray-300">
                      <span>Common:</span>
                      <span className="text-gray-400">~40%</span>
                    </div>
                    <div className="flex justify-between text-gray-300">
                      <span>Uncommon:</span>
                      <span className="text-gray-400">~25%</span>
                    </div>
                    <div className="flex justify-between text-gray-300">
                      <span>Rare:</span>
                      <span className="text-gray-400">~15%</span>
                    </div>
                    <div className="flex justify-between text-gray-300">
                      <span>Epic:</span>
                      <span className="text-gray-400">~10%</span>
                    </div>
                    <div className="flex justify-between text-gray-300">
                      <span>Legendary:</span>
                      <span className="text-gray-400">~6%</span>
                    </div>
                    <div className="flex justify-between text-gray-300">
                      <span>Godlike:</span>
                      <span className="text-gray-400">~3%</span>
                    </div>
                    <div className="flex justify-between text-amber-400">
                      <span>Orb:</span>
                      <span className="text-amber-300">~1%</span>
                    </div>
                  </div>
                </div>
                
                {/* Payout Table */}
                <div>
                  <h3 className="text-xl font-pixel text-amber-400 mb-3">Payout Multipliers (x Bet Amount)</h3>
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-lg font-pixel text-green-400 mb-2">5 of a Kind:</h4>
                      <div className="grid grid-cols-2 gap-2 text-sm font-pixel text-gray-300">
                        <div>5 Orbs: <span className="text-amber-400">1000x</span></div>
                        <div>5 Godlike: <span className="text-red-400">500x</span></div>
                        <div>5 Legendary: <span className="text-orange-400">250x</span></div>
                        <div>5 Epic: <span className="text-purple-400">100x</span></div>
                        <div>5 Rare: <span className="text-blue-400">50x</span></div>
                        <div>5 Uncommon: <span className="text-green-400">20x</span></div>
                        <div>5 Common: <span className="text-gray-400">10x</span></div>
                      </div>
                    </div>
                    <div>
                      <h4 className="text-lg font-pixel text-green-400 mb-2">4 of a Kind:</h4>
                      <div className="grid grid-cols-2 gap-2 text-sm font-pixel text-gray-300">
                        <div>4 Orbs: <span className="text-amber-400">200x</span></div>
                        <div>4 Godlike: <span className="text-red-400">100x</span></div>
                        <div>4 Legendary: <span className="text-orange-400">50x</span></div>
                        <div>4 Epic: <span className="text-purple-400">25x</span></div>
                        <div>4 Rare: <span className="text-blue-400">15x</span></div>
                        <div>4 Uncommon: <span className="text-green-400">8x</span></div>
                        <div>4 Common: <span className="text-gray-400">5x</span></div>
                      </div>
                    </div>
                    <div>
                      <h4 className="text-lg font-pixel text-green-400 mb-2">3 of a Kind:</h4>
                      <div className="grid grid-cols-2 gap-2 text-sm font-pixel text-gray-300">
                        <div>3 Orbs: <span className="text-amber-400">50x</span></div>
                        <div>3 Godlike: <span className="text-red-400">25x</span></div>
                        <div>3 Legendary: <span className="text-orange-400">10x</span></div>
                        <div>3 Epic: <span className="text-purple-400">5x</span></div>
                        <div>3 Rare: <span className="text-blue-400">3x</span></div>
                        <div>3 Uncommon: <span className="text-green-400">2x</span></div>
                        <div>3 Common: <span className="text-gray-400">1.5x</span></div>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="text-sm font-pixel text-gray-400 border-t border-amber-500 pt-4">
                  <p className="mb-2">• You need 3 or more matching symbols to win</p>
                  <p className="mb-2">• Higher rarity symbols have better payouts</p>
                  <p>• Net payout = (Bet × Multiplier) - Bet</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
