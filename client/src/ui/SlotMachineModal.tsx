import { useState, useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../state/gameStore';
import { useSocket } from '../hooks/useSocket';
import { playClickSound, playCloseSound, playLevelUpSound, playBlackjackLossSound, playBonusSymbolSound, playBonusTriggerSound } from '../utils/sounds';
import { ItemRarity } from '../types';
import { updateUserOrbs } from '../firebase/auth';

const MIN_BET = 5000;
const MAX_BET = 10000;
const BET_OPTIONS = [5000, 10000];

// Slot symbols based on rarity types + orbs + bonus
type SlotSymbol = ItemRarity | 'orb' | 'bonus';

const SYMBOL_ORDER: SlotSymbol[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'godlike', 'orb', 'bonus'];

// Standard 5-reel slot machine odds (weighted probabilities)
// NOTE: These should match server/src/slots.ts SYMBOL_WEIGHTS
// Further adjusted: reduced common/uncommon by 15%, increased rare/epic/legendary by 15%
const SYMBOL_WEIGHTS: Record<SlotSymbol, number> = {
  common: 30,      // Reduced by 15% from 35 (was 50%)
  uncommon: 13,    // Reduced by 15% from 15 (was 20%)
  rare: 21,        // Increased by 15% from 18 (was 10%)
  epic: 17,        // Increased by 15% from 15 (was 8%)
  legendary: 14,   // Increased by 15% from 12 (was 6%)
  godlike: 3,      // Same (3%)
  orb: 1,          // Rarest (1% - jackpot symbol)
  bonus: 25        // Bonus symbol only appears on row 2 (middle row) of any column (~21.5% per symbol, bonus trigger ~1 in 100 spins for 3 on row 2)
};

// Calculate total weight for probability normalization
const TOTAL_WEIGHT = Object.values(SYMBOL_WEIGHTS).reduce((sum, weight) => sum + weight, 0);

// Spinning animation weights - bonus symbols appear more often during spins for visual excitement
// but actual win odds remain the same (determined by server)
const SPIN_ANIMATION_WEIGHTS: Record<SlotSymbol, number> = {
  common: 35,      // Reduced to make room for more bonus symbols
  uncommon: 15,    // Reduced slightly
  rare: 8,         // Reduced slightly
  epic: 6,         // Reduced slightly
  legendary: 4,    // Reduced slightly
  godlike: 2,      // Same
  orb: 1,          // Same
  bonus: 29        // Much higher (~29% vs 0.2%) - creates excitement during spins on middle reel
};

// Calculate total weight for spin animation
const SPIN_ANIMATION_TOTAL_WEIGHT = Object.values(SPIN_ANIMATION_WEIGHTS).reduce((sum, weight) => sum + weight, 0);

// Bonus game symbol weights (matching server - skewed toward higher rarity rewards)
const BONUS_SYMBOL_WEIGHTS: Record<SlotSymbol, number> = {
  common: 30,
  uncommon: 80,
  rare: 120,
  epic: 100,
  legendary: 80,
  godlike: 50,
  orb: 20,
  bonus: 0
};

const BONUS_TOTAL_WEIGHT = Object.values(BONUS_SYMBOL_WEIGHTS).reduce((sum, weight) => sum + weight, 0);

// Calculate probability percentage
function calculateProbability(weight: number, totalWeight: number): number {
  return (weight / totalWeight) * 100;
}

// Payout multipliers for winning combinations (must match server/src/slots.ts)
// Common and uncommon payouts are < 1.0x to ensure players always lose money but get small kickback
const PAYOUTS: Record<string, number> = {
  '5_orb': 1000,           // 5 orbs = 1000x
  '5_godlike': 500,        // 5 godlike = 500x
  '5_legendary': 250,      // 5 legendary = 250x
  '5_epic': 100,           // 5 epic = 100x
  '5_rare': 50,            // 5 rare = 50x
  '5_uncommon': 0.95,      // 5 uncommon = 0.95x (95% of bet - small kickback)
  '5_common': 0.9,         // 5 common = 0.9x (90% of bet - small kickback)
  '4_orb': 200,            // 4 orbs = 200x
  '4_godlike': 100,        // 4 godlike = 100x
  '4_legendary': 50,       // 4 legendary = 50x
  '4_epic': 25,            // 4 epic = 25x
  '4_rare': 15,            // 4 rare = 15x
  '4_uncommon': 0.8,       // 4 uncommon = 0.8x (80% of bet - small kickback)
  '4_common': 0.7,         // 4 common = 0.7x (70% of bet - small kickback)
  '3_orb': 50,             // 3 orbs = 50x
  '3_godlike': 25,         // 3 godlike = 25x
  '3_legendary': 10,       // 3 legendary = 10x
  '3_epic': 5,             // 3 epic = 5x
  '3_rare': 3,             // 3 rare = 3x
  '3_uncommon': 0.6,       // 3 uncommon = 0.6x (60% of bet - small kickback)
  '3_common': 0.5,         // 3 common = 0.5x (50% of bet - small kickback)
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
    case 'bonus': return '#9333ea';       // Cosmic purple (will be animated)
    default: return '#ffffff';
  }
}

// Get symbol display - returns orb emoji or "B" for bonus
function getSymbolText(symbol: SlotSymbol): string {
  if (symbol === 'bonus') {
    return 'B'; // Animated "B" for bonus symbol
  }
  return '●'; // Orb symbol for all other symbols
}

// Format number with K/M abbreviations
function formatNumber(num: number): string {
  // Ensure we're working with an integer
  const intNum = Math.floor(num);
  
  if (intNum >= 1000000) {
    const value = intNum / 1000000;
    // Check if value is effectively a whole number (accounting for floating point precision)
    return (Math.abs(value % 1) < 0.0001 ? Math.round(value).toString() : value.toFixed(1)) + 'M';
  } else if (intNum >= 1000) {
    const value = intNum / 1000;
    // Check if value is effectively a whole number (accounting for floating point precision)
    return (Math.abs(value % 1) < 0.0001 ? Math.round(value).toString() : value.toFixed(1)) + 'K';
  }
  return intNum.toString();
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
  
  // Bonus symbol particles (for base game bonus symbols)
  const [bonusSymbolParticles, setBonusSymbolParticles] = useState<Particle[]>([]);
  const bonusParticleAnimationRef = useRef<number>();
  const bonusSymbolPositionsRef = useRef<Array<{ reelIndex: number; x: number; y: number }>>([]);
  const [reels, setReels] = useState<ReelState[]>([
    { symbols: [], spinning: false, currentIndex: 0, targetIndex: 0 },
    { symbols: [], spinning: false, currentIndex: 0, targetIndex: 0 },
    { symbols: [], spinning: false, currentIndex: 0, targetIndex: 0 },
    { symbols: [], spinning: false, currentIndex: 0, targetIndex: 0 },
    { symbols: [], spinning: false, currentIndex: 0, targetIndex: 0 },
  ]);
  const [isSpinning, setIsSpinning] = useState(false);
  const [activeReelIndex, setActiveReelIndex] = useState<number | null>(null); // Which reel is currently spinning (0-4)
  const [lastResult, setLastResult] = useState<{ symbols: SlotSymbol[][]; payout: number } | null>(null);
  const [balance, setBalance] = useState(localPlayer?.orbs || 0);
  const [gameHistory, setGameHistory] = useState<Array<{ won: boolean; amount: number; bet: number }>>([]);
  const [showInfo, setShowInfo] = useState(false);
  const [sessionStartingBalance, setSessionStartingBalance] = useState<number | null>(null);
  const [lastSpinTime, setLastSpinTime] = useState<number>(0); // Track last spin time for cooldown
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0); // Cooldown remaining in seconds
  const pendingResultRef = useRef<{ slotMachineId: string; symbols: SlotSymbol[][]; payout: number; bet: number; newBalance?: number; bonusTriggered?: boolean; bonusGameState?: { isBonusGame: boolean; freeSpinsRemaining: number; bonusTriggered: boolean } } | null>(null);
  const sessionSlotChangesRef = useRef<number>(0); // Track only slot machine balance changes for session P/L
  const autoSpinTimeoutRef = useRef<number | null>(null); // Track auto-spin timeout
  const isBonusGameRef = useRef<boolean>(false); // Track bonus game state for auto-spin
  const freeSpinsRemainingRef = useRef<number>(0); // Track free spins for auto-spin
  const wasSpinningRef = useRef<boolean>(false); // Track previous spinning state
  
  // Bonus game state
  const [isBonusGame, setIsBonusGame] = useState(false);
  const [freeSpinsRemaining, setFreeSpinsRemaining] = useState(0);
  const [bonusTriggered, setBonusTriggered] = useState(false);
  const [cumulativeBonusPayout, setCumulativeBonusPayout] = useState(0); // Track total winnings during bonus game
  const [showBonusWinModal, setShowBonusWinModal] = useState(false); // Show final bonus win modal
  const [displayedBonusWin, setDisplayedBonusWin] = useState(0); // Animated displayed amount
  const tickUpIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null); // Track tick-up animation interval
  const bonusModalClosedRef = useRef<boolean>(false); // Track if bonus modal was manually closed
  
  // Dev toggle for testing
  const [devForceBonus, setDevForceBonus] = useState(false);
  
  // Debug: Log when bonus game state changes
  useEffect(() => {
    console.log('[SlotMachineModal] Bonus game state changed:', {
      isBonusGame,
      freeSpinsRemaining,
      bonusTriggered
    });
  }, [isBonusGame, freeSpinsRemaining, bonusTriggered]);
  
  // Animate bonus win tick-up effect
  useEffect(() => {
    // Clear any existing interval first
    if (tickUpIntervalRef.current) {
      clearInterval(tickUpIntervalRef.current);
      tickUpIntervalRef.current = null;
    }
    
    if (showBonusWinModal && cumulativeBonusPayout > 0) {
      // Reset displayed value to 0 when modal opens
      setDisplayedBonusWin(0);
      
      const duration = 2000; // 2 seconds to tick up
      const steps = 60; // 60 animation steps
      const increment = cumulativeBonusPayout / steps;
      const stepDuration = duration / steps;
      
      let currentStep = 0;
      const targetPayout = cumulativeBonusPayout; // Capture the target value
      
      const interval = setInterval(() => {
        currentStep++;
        // Calculate the animated value, but ensure we always use whole numbers for display
        const animatedValue = increment * currentStep;
        // Use Math.floor and ensure it's an integer
        const newValue = Math.min(targetPayout, Math.floor(animatedValue));
        
        // Ensure we always set an integer value
        setDisplayedBonusWin(Math.floor(newValue));
        
        if (currentStep >= steps || newValue >= targetPayout) {
          setDisplayedBonusWin(Math.floor(targetPayout)); // Ensure final value is exact integer
          clearInterval(interval);
          tickUpIntervalRef.current = null;
        }
      }, stepDuration);
      
      tickUpIntervalRef.current = interval;
      
      return () => {
        if (tickUpIntervalRef.current) {
          clearInterval(tickUpIntervalRef.current);
          tickUpIntervalRef.current = null;
        }
      };
    } else if (!showBonusWinModal) {
      // Reset displayed value when modal closes
      setDisplayedBonusWin(0);
    }
  }, [showBonusWinModal, cumulativeBonusPayout]);
  
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
  const finalSymbolsRef = useRef<SlotSymbol[][] | null>(null); // Store final symbols from server (3 rows × 5 columns)
  const reelLandedSoundPlayedRef = useRef<boolean[]>([]); // Track if landing sound has been played for each reel
  const bonusSymbolCountRef = useRef<number>(0); // Track how many bonus symbols have landed during current spin
  const bonusSymbolSoundPlayedRef = useRef<boolean[]>([]); // Track if bonus sound has been played for each reel
  
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

  // Get current theme (bonus game uses fire theme)
  const baseTheme = SLOT_MACHINE_THEMES[slotMachineName] || SLOT_MACHINE_THEMES['Orb Fortune'];
  const currentTheme = isBonusGame ? {
    primary: '#ff6b35',      // Fire orange
    secondary: '#ff4500',    // Deep orange
    background: '#2a0f0f',   // Dark red background
    text: '#ff6b35',         // Orange text
    glow: '#ff6b35',         // Orange glow
    particles: ['#ff6b35', '#ff4500', '#ff8c42', '#ffa500'] // Fire colors
  } : baseTheme;
  
  // Initialize reels with symbols (only when modal first opens)
  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (slotMachineOpen && !hasInitializedRef.current) {
      // Set slot machine name based on ID
      setSlotMachineName(SLOT_MACHINE_NAMES[slotMachineId] || 'Slot Machine');
      
      // Only initialize once when modal first opens
      // Use SPIN_ANIMATION_WEIGHTS to make bonus symbols appear more often during spins
      // (actual win odds are determined by server, so this is just visual)
      const extendedSymbols: SlotSymbol[] = [];
      for (let i = 0; i < 100; i++) {
        // Weighted random selection using spin animation weights (bonus appears more often)
        let random = Math.random() * SPIN_ANIMATION_TOTAL_WEIGHT;
        const allSymbols: SlotSymbol[] = [...SYMBOL_ORDER, 'bonus'];
        for (const symbol of allSymbols) {
          random -= SPIN_ANIMATION_WEIGHTS[symbol] || 0;
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
  
  // Particle animation effect (flaming particles during bonus game) - DISABLED for performance
  useEffect(() => {
    // Disabled particle effects to prevent lag with multiple slot machines open
    setParticles([]);
    if (particleAnimationRef.current) {
      cancelAnimationFrame(particleAnimationRef.current);
    }
  }, [slotMachineOpen, isBonusGame]);
  
  // Bonus symbol particle effect (for base game bonus symbols) - DISABLED for performance
  useEffect(() => {
    // Disabled particle effects to prevent lag with multiple slot machines open
    setBonusSymbolParticles([]);
    if (bonusParticleAnimationRef.current) {
      cancelAnimationFrame(bonusParticleAnimationRef.current);
    }
  }, [slotMachineOpen, reels, isSpinning]);
  
  // Sequential reel animation (left to right, 3 seconds per reel)
  useEffect(() => {
    if (!isSpinning) {
      // Reset when not spinning
      setActiveReelIndex(null);
      reelStartTimesRef.current = [];
      reelLandedSoundPlayedRef.current = [];
      return;
    }
    
    const SPIN_DURATION = 500; // 0.5 seconds - all reels spin together (reduced from 1 second)
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
          
          // finalSymbolsRef is [topRow, middleRow, bottomRow] where each row is [col0, col1, col2, col3, col4]
          // index is the column/reel index (0-4), so we need to get the middle row (index 1) for this column
          if (finalSymbolsRef.current && finalSymbolsRef.current[1] && finalSymbolsRef.current[1][index]) {
            const targetSymbol = finalSymbolsRef.current[1][index]; // Middle row, this column
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
          if (finalSymbolsRef.current && finalSymbolsRef.current[1] && finalSymbolsRef.current[1][index]) {
            const targetSymbol = finalSymbolsRef.current[1][index]; // Middle row, this column
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
          
          // Check if this reel landed on a bonus symbol on row 2 (middle row) and play sound immediately
          // finalSymbolsRef is [topRow, middleRow, bottomRow] where each row is [col0, col1, col2, col3, col4]
          // index is the column/reel index (0-4), so we check the middle row (index 1) for this column
          if (!bonusSymbolSoundPlayedRef.current[index] && finalSymbolsRef.current && finalSymbolsRef.current[1]) {
            const middleRow = finalSymbolsRef.current[1];
            if (middleRow[index] === 'bonus') {
              // Bonus symbol landed on row 2 - increment count and play sound with increasing pitch
              bonusSymbolCountRef.current++;
              playBonusSymbolSound(bonusSymbolCountRef.current);
              bonusSymbolSoundPlayedRef.current[index] = true;
            }
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
          // finalSymbolsRef is [topRow, middleRow, bottomRow] where each row is [col0, col1, col2, col3, col4]
          // index is the column/reel index (0-4), so we need to get the middle row (index 1) for this column
          if (finalSymbolsRef.current && finalSymbolsRef.current[1] && finalSymbolsRef.current[1][index]) {
            const targetSymbol = finalSymbolsRef.current[1][index]; // Middle row, this column
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
        // finalSymbolsRef is [topRow, middleRow, bottomRow] where each row is [col0, col1, col2, col3, col4]
        // index is the column/reel index (0-4), so we need to get the middle row (index 1) for this column
        if (finalSymbolsRef.current && finalSymbolsRef.current[1] && finalSymbolsRef.current[1][index]) {
          const targetSymbol = finalSymbolsRef.current[1][index]; // Middle row, this column
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
          
          // finalSymbolsRef is [topRow, middleRow, bottomRow] where each row is [col0, col1, col2, col3, col4]
          // index is the column/reel index (0-4), so we need to get the middle row (index 1) for this column
          if (finalSymbolsRef.current && finalSymbolsRef.current[1] && finalSymbolsRef.current[1][index]) {
            const targetSymbol = finalSymbolsRef.current[1][index]; // Middle row, this column
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
          // Verify this result is for this specific slot machine
          if (pendingResultRef.current.slotMachineId !== slotMachineId) {
            console.log('[SlotMachineModal] Ignoring pending result - wrong slotMachineId:', pendingResultRef.current.slotMachineId, 'expected:', slotMachineId);
            return; // Don't process results for other slot machines
          }
          
          const { symbols, payout, bet, newBalance, bonusTriggered: wasBonusTriggered, bonusGameState } = pendingResultRef.current;
          
          // Apply bonus game state AFTER animation completes (so reels play out first)
          // Capture state before updating
          const wasInBonusGame = isBonusGame;
          const previousFreeSpins = freeSpinsRemaining;
          
          // Track cumulative bonus payout during bonus game
          // In bonus game: payout is already the win amount (no bet deducted, it's pure win)
          // In base game: payout is net (payout - bet)
          // For bonus game, we want to accumulate the actual win amount
          const actualPayout = wasInBonusGame ? payout : (payout > 0 ? payout : 0); // In bonus game, payout is already the win
          
          // Reset cumulative when bonus game starts (when bonus is triggered)
          if (bonusGameState?.bonusTriggered && !wasInBonusGame) {
            setCumulativeBonusPayout(0); // Reset at start of bonus game
          }
          
          if (wasInBonusGame && actualPayout > 0) {
            // During bonus game, accumulate payouts (use wasInBonusGame to check before state update)
            setCumulativeBonusPayout(prev => prev + actualPayout);
          }
          
          if (bonusGameState) {
            // Don't apply bonus game state if user manually closed the bonus modal
            if (bonusModalClosedRef.current && !bonusGameState.bonusTriggered) {
              // User closed the modal, don't re-apply bonus state unless it's a new bonus trigger
              console.log('[SlotMachineModal] Skipping bonus state application - modal was manually closed');
              bonusModalClosedRef.current = false; // Reset flag after skipping
            } else {
              console.log('[SlotMachineModal] Applying bonus game state after animation:', {
                isBonusGame: bonusGameState.isBonusGame,
                freeSpinsRemaining: bonusGameState.freeSpinsRemaining,
                bonusTriggered: bonusGameState.bonusTriggered
              });
              // CRITICAL: Always use the exact value from server, don't increment
              setIsBonusGame(bonusGameState.isBonusGame);
              setFreeSpinsRemaining(bonusGameState.freeSpinsRemaining); // Use server value directly
              setBonusTriggered(bonusGameState.bonusTriggered);
              // Update refs
              isBonusGameRef.current = bonusGameState.isBonusGame;
              freeSpinsRemainingRef.current = bonusGameState.freeSpinsRemaining;
              
              // Check if bonus game just ended (was in bonus, now not, or freeSpins went to 0)
              if (wasInBonusGame && (!bonusGameState.isBonusGame || bonusGameState.freeSpinsRemaining === 0)) {
                // Bonus game ended - wait a moment for reels to fully settle, then show final win modal
                setTimeout(() => {
                  setShowBonusWinModal(true);
                  setDisplayedBonusWin(0); // Start from 0 for tick-up animation
                }, 500); // 500ms delay to let reels fully settle and user see the final result
              }
              
              if (bonusGameState.bonusTriggered) {
                // Play special sound for bonus trigger (after reels finish)
                playBonusTriggerSound();
                bonusModalClosedRef.current = false; // Reset flag on new bonus trigger
              }
            }
          } else {
            // Only clear bonus state if we're not currently in a bonus game
            // This prevents clearing the state during a bonus game spin
            if (!isBonusGame) {
              console.log('[SlotMachineModal] No bonusGameState provided, clearing bonus state');
              // Clear bonus game state if not provided (bonus game ended)
              setIsBonusGame(false);
              setFreeSpinsRemaining(0);
              setBonusTriggered(false);
              // Update refs
              isBonusGameRef.current = false;
              freeSpinsRemainingRef.current = 0;
            }
          }
          
          // Get current bonus game state for reference
          const currentIsBonusGame = isBonusGame;
          const currentFreeSpins = freeSpinsRemaining;
          
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
          
          // Note: Bonus symbol sounds are now played as each reel stops (in the animation loop)
          // This allows players to hear the incremental pitch increase as multiple bonus symbols land
          
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
          
          // Don't play loss sound if bonus was triggered (bonus trigger sound already played)
          if (payout > 0) {
            if (isBigWin) {
              playLevelUpSound();
            }
            // Small wins (including kickback payouts) don't play sound
          } else if (payout === 0 && !wasBonusTriggered) {
            // Only play loss sound when payout is exactly 0 (no win at all) and bonus wasn't triggered
            playBlackjackLossSound();
          }
          
          pendingResultRef.current = null;
          
          // Auto-spin removed - players must manually click spin during bonus games
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
    const COOLDOWN_DURATION = 2500; // 2.5 seconds in milliseconds (reduced from 3.0 seconds)
    
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
  
  const handleSpin = useCallback(() => {
    // Always use the current balance from localPlayer.orbs to ensure sync across all modals
    const currentBalance = localPlayer?.orbs || 0;
    const COOLDOWN_DURATION = 2500; // 2.5 seconds in milliseconds (reduced from 3.0 seconds)
    const now = Date.now();
    const timeSinceLastSpin = now - lastSpinTime;
    
    // Check cooldown
    if (timeSinceLastSpin < COOLDOWN_DURATION) {
      // Still on cooldown - don't allow spin
      return;
    }
    
    // In bonus game, don't check balance (free spins)
    if (isSpinning || !slotMachineId || (!isBonusGame && currentBalance < betAmount)) return;
    
    playClickSound();
    
    // Only deduct bet if not in bonus game AND not forcing bonus (free spins don't cost)
    // Don't deduct optimistically when forceBonus is true, as server won't deduct it
    if (!isBonusGame && !devForceBonus) {
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
    } else {
      // Bonus game or force bonus - no bet deduction
      pendingBalanceUpdateRef.current = currentBalance;
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
    // Don't pass forceBonus if already in bonus game (prevents adding extra free spins)
    const shouldForceBonus = devForceBonus && !isBonusGame;
    spinSlotMachine(slotMachineId, betAmount, shouldForceBonus);
    
    // Set last spin time for cooldown
    setLastSpinTime(Date.now());
    
    // Don't set isSpinning yet - wait for server result
  }, [slotMachineId, betAmount, isBonusGame, devForceBonus, isSpinning, localPlayer?.orbs, lastSpinTime]);
  
  // Cleanup auto-spin timeout on unmount
  useEffect(() => {
    return () => {
      if (autoSpinTimeoutRef.current) {
        clearTimeout(autoSpinTimeoutRef.current);
      }
    };
  }, []);
  
  // Auto-spin removed - players must manually click spin during bonus games
  useEffect(() => {
    // Update ref for tracking animation state (still used for other purposes)
    wasSpinningRef.current = isSpinning;
    
    // Clear auto-spin timeout if not in bonus game (cleanup)
    if (!isSpinning && !isBonusGame) {
      // Clear timeout if not in bonus game
      if (autoSpinTimeoutRef.current) {
        clearTimeout(autoSpinTimeoutRef.current);
        autoSpinTimeoutRef.current = null;
      }
    }
  }, [isSpinning, isBonusGame, freeSpinsRemaining, slotMachineOpen, handleSpin]);
  
  // Listen for slot machine result from server
  useEffect(() => {
    // Capture slotMachineId in closure to ensure we're checking against the correct one
    const currentSlotMachineId = slotMachineId;
    
    const handleSlotResult = (event: CustomEvent<{ 
      slotMachineId: string; 
      slotMachineName: string; 
      symbols: SlotSymbol[][]; // Now 3 rows × 5 columns
      payout: number; 
      newBalance?: number;
      bonusGameState?: {
        isBonusGame: boolean;
        freeSpinsRemaining: number;
        bonusTriggered: boolean;
      };
    }>) => {
      const { slotMachineId: resultSlotMachineId, slotMachineName, symbols, payout, newBalance, bonusGameState } = event.detail;
      
      console.log('[SlotMachineModal] Received slot_machine_result:', { 
        resultSlotMachineId,
        currentSlotMachineId,
        slotMachineName, 
        symbols, 
        payout, 
        newBalance, 
        bonusGameState 
      });
      
      // Only process results for this specific slot machine - check early and return immediately
      // This MUST be the first check to prevent any state updates for other slot machines
      if (resultSlotMachineId !== currentSlotMachineId) {
        console.log('[SlotMachineModal] Ignoring result - slotMachineId mismatch:', resultSlotMachineId, '!==', currentSlotMachineId);
        return; // Exit immediately - don't process anything for other slot machines
      }
      
      console.log('[SlotMachineModal] Processing result for slot machine:', currentSlotMachineId);
      
      // Update slot machine name if provided
      if (slotMachineName) {
        setSlotMachineName(slotMachineName);
      }
      
      // DON'T update balance yet - wait for animation to complete
      // Store final symbols for animation (3 rows × 5 columns)
      finalSymbolsRef.current = symbols;
      
      // Update reels to show result - set target indices and start animation
      // IMPORTANT: Preserve current positions - don't reset them
      // symbols is now [topRow, middleRow, bottomRow] where each row is [col0, col1, col2, col3, col4]
      setReels(prev => prev.map((reel, columnIndex) => {
        // Get the middle row symbol for this column (for the center position of the reel)
        const targetSymbol = symbols[1][columnIndex]; // Middle row, this column
        
        // CRITICAL: Ensure the target symbol exists in the symbols array
        // If not found, add it to the array at a specific position
        let symbolIndex = reel.symbols.findIndex(s => s === targetSymbol);
        
        if (symbolIndex < 0) {
          // Target symbol not found - this shouldn't happen, but handle it
          console.warn('[SlotMachine] Target symbol not found in reel symbols array:', targetSymbol, 'for reel', columnIndex);
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
      
      // Reset bonus symbol tracking for new spin
      bonusSymbolCountRef.current = 0;
      bonusSymbolSoundPlayedRef.current = [false, false, false, false, false]; // Reset for all 5 reels
      
      // Store bonus game state but don't apply it yet - wait for animation to complete
      // This allows the reels to play out before showing the bonus screen
      console.log('[SlotMachineModal] Received bonusGameState (will apply after animation):', bonusGameState);
      
      // Store result but don't show/play sounds or update balance until animation completes
      // payout is net payout (payout - bet)
      // If payout > 0: we won (payout is the net win amount)
      // If payout <= 0: we lost (payout is negative or 0, meaning we lost the bet)
      // Use betAmount from component state (the bet that was placed)
      // Store bonusGameState to apply after animation completes
      pendingResultRef.current = { 
        slotMachineId: resultSlotMachineId, // Store slotMachineId to verify it matches when processing
        symbols, 
        payout, 
        bet: betAmount, 
        newBalance, 
        bonusTriggered: bonusGameState?.bonusTriggered || false,
        bonusGameState: bonusGameState || undefined // Store full bonus game state to apply after animation
      };
    };
    
    window.addEventListener('slot_machine_result', handleSlotResult as EventListener);
    return () => {
      window.removeEventListener('slot_machine_result', handleSlotResult as EventListener);
    };
  }, [slotMachineId]); // Only depend on slotMachineId - handler will be recreated when it changes

  // Drag handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (modalRef.current) {
      e.preventDefault();
      e.stopPropagation();
      
      // Calculate offset from click position to where the user clicked on the modal
      // The modal is centered with transform: translate(calc(50% + ${modalPosition.x}px), ...)
      // So we need to calculate the offset relative to the modal's current center position
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
  // During bonus game: payout is already the win amount (no bet deducted), show cumulative
  // During base game: Server sends netPayout (payout - bet), so we need to add bet back to get actual payout amount
  // Show actual payout amount in green, or 0 if no payout
  let paidAmount = 0;
  if (isBonusGame) {
    // During bonus game, show cumulative payout
    paidAmount = cumulativeBonusPayout;
  } else if (lastResult) {
    // Base game: payout is net (payout - bet), add bet back to get actual payout
    const netPayout = lastResult.payout; // This is payout - bet from server
    paidAmount = Math.max(0, netPayout + betAmount); // Add bet back to get actual payout, but don't go below 0
  }

  return (
    <>
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
          boxShadow: isBonusGame
            ? `0 0 30px ${currentTheme.glow}60, 0 0 60px ${currentTheme.glow}40, 0 0 90px ${currentTheme.glow}20`
            : `0 0 20px ${currentTheme.glow}40, 0 0 40px ${currentTheme.glow}20`,
          backgroundImage: isBonusGame
            ? 'radial-gradient(ellipse at center bottom, rgba(255, 107, 53, 0.15) 0%, transparent 60%)'
            : 'none'
        }}
      >
        {/* Particle effects overlay - flaming particles during bonus game */}
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
                opacity: particle.life * 0.8,
                boxShadow: `0 0 ${particle.size * 3}px ${particle.color}, 0 0 ${particle.size * 6}px ${particle.color}40`,
                transform: 'translate(-50%, -50%)',
                transition: 'none'
              }}
            />
          ))}
        </div>
        
        {/* Bonus symbol particles overlay - particles around bonus symbols in base game */}
        {!isBonusGame && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 2 }}>
            {bonusSymbolParticles.map((particle, index) => (
              <div
                key={index}
                className="absolute rounded-full"
                style={{
                  left: `${particle.x}%`,
                  top: `${particle.y}%`,
                  width: `${particle.size}px`,
                  height: `${particle.size}px`,
                  backgroundColor: particle.color,
                  opacity: particle.life * 0.9,
                  boxShadow: `0 0 ${particle.size * 2}px ${particle.color}, 0 0 ${particle.size * 4}px ${particle.color}60`,
                  transform: 'translate(-50%, -50%)',
                  transition: 'none'
                }}
              />
            ))}
          </div>
        )}
        
        {/* Bonus Game Overlay - positioned at top to not overlap controls */}
        {isBonusGame && (
          <div 
            className="absolute top-0 left-0 right-0 pointer-events-none flex flex-col items-center justify-center py-4"
            style={{ 
              zIndex: 100,
              backgroundColor: 'rgba(0, 0, 0, 0.5)' // Semi-transparent dark overlay
            }}
          >
            <div 
              className="text-2xl sm:text-4xl font-pixel mb-2 animate-pulse"
              style={{ 
                color: '#ff6b35',
                textShadow: '0 0 20px #ff6b35, 0 0 40px #ff6b35, 0 0 60px #ff4500'
              }}
            >
              BONUS GAME
            </div>
            <div 
              className="text-xl sm:text-2xl font-pixel"
              style={{ 
                color: '#ffa500',
                textShadow: '0 0 15px #ffa500, 0 0 30px #ff6b35'
              }}
            >
              FREE SPINS: {freeSpinsRemaining}
            </div>
          </div>
        )}
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
            {/* Dev Toggle: Force Bonus Spin - Hidden */}
            {/* <label className="flex items-center gap-2 text-xs font-pixel text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={devForceBonus}
                onChange={(e) => setDevForceBonus(e.target.checked)}
                className="w-4 h-4 cursor-pointer"
                style={{ accentColor: currentTheme.primary }}
                title="Dev: Force bonus trigger on next spin"
              />
              <span className="whitespace-nowrap">Force Bonus</span>
            </label> */}
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
              backgroundColor: isBonusGame ? '#1a0505' : '#000000', // Darker red background during bonus
              borderColor: currentTheme.primary,
              boxShadow: isBonusGame 
                ? `inset 0 0 30px ${currentTheme.glow}40, 0 0 50px ${currentTheme.glow}30`
                : `inset 0 0 30px ${currentTheme.glow}20`,
              backgroundImage: isBonusGame 
                ? 'radial-gradient(circle at 50% 100%, rgba(255, 107, 53, 0.1) 0%, transparent 50%)'
                : 'none'
            }}
          >
            <div className="grid grid-cols-5 gap-4 w-full h-full">
              {reels.map((reel, reelIndex) => {
                // Check if middle reel (index 2) has bonus symbols for highlighting
                const isMiddleReel = reelIndex === 2;
                // Check if middle row of middle reel has bonus symbol
                const hasBonusSymbol = finalSymbolsRef.current && finalSymbolsRef.current[1] && finalSymbolsRef.current[1][reelIndex] === 'bonus';
                const shouldHighlight = isMiddleReel && (bonusTriggered || hasBonusSymbol);
                
                return (
                <div key={reelIndex} className="flex flex-col items-center h-full">
                  <div 
                    className="bg-gray-800 rounded border-2 w-full overflow-hidden relative transition-all"
                    style={{ 
                      height: '100%', 
                      minHeight: '200px',
                      borderColor: shouldHighlight
                        ? '#ff6b35' // Bright orange for bonus reel
                        : (activeReelIndex === reelIndex && reel.spinning
                          ? currentTheme.primary
                          : currentTheme.secondary),
                      boxShadow: shouldHighlight
                        ? `0 0 30px #ff6b35, 0 0 60px #ff4500, 0 0 90px #ff6b3540`
                        : (activeReelIndex === reelIndex && reel.spinning
                          ? `0 0 20px ${currentTheme.glow}50, 0 0 40px ${currentTheme.glow}30`
                          : `0 0 5px ${currentTheme.glow}20`)
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
                        
                        // During spinning, show bonus symbols on middle row (offset 0) of any column for visual excitement
                        // When stopped, only middle row will show bonus symbols (handled in stopped state)
                        const isMiddleRow = offset === 0; // Middle row is offset 0 (center position)
                        // Allow bonus symbols on middle row of any column during spinning (for excitement)
                        const isBonus = safeSymbol === 'bonus' && isMiddleRow;
                        // If bonus symbol is not on middle row, replace it with common symbol
                        const displaySymbol = (safeSymbol === 'bonus' && !isMiddleRow) ? 'common' : safeSymbol;
                        const displayIsBonus = isBonus;
                        
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
                              ...(isCenter && displayIsBonus ? {
                                borderColor: '#9333ea',
                                backgroundColor: 'rgba(147, 51, 234, 0.1)',
                                boxShadow: '0 0 20px rgba(147, 51, 234, 0.5), 0 0 40px rgba(79, 70, 229, 0.3)'
                              } : isCenter ? {
                                borderColor: currentTheme.primary,
                                backgroundColor: `${currentTheme.primary}20`
                              } : {})
                            }}
                          >
                            <div
                              className="text-4xl font-bold flex items-center justify-center"
                              style={{ 
                                color: displayIsBonus ? '#9333ea' : getSymbolColor(displaySymbol),
                                textShadow: displayIsBonus
                                  ? `0 0 20px rgba(147, 51, 234, 0.8), 0 0 40px rgba(79, 70, 229, 0.6), 0 0 60px rgba(59, 130, 246, 0.4)`
                                  : `0 0 10px ${getSymbolColor(displaySymbol)}, 0 0 20px ${getSymbolColor(displaySymbol)}`,
                                filter: displayIsBonus ? 'drop-shadow(0 0 12px rgba(147, 51, 234, 0.9))' : 'none',
                                background: displayIsBonus ? 'linear-gradient(135deg, #9333ea 0%, #4f46e5 50%, #3b82f6 100%)' : 'none',
                                WebkitBackgroundClip: displayIsBonus ? 'text' : 'initial',
                                WebkitTextFillColor: displayIsBonus ? 'transparent' : 'initial',
                                backgroundClip: displayIsBonus ? 'text' : 'initial',
                                lineHeight: '1',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '100%',
                                height: '100%'
                              }}
                            >
                              {getSymbolText(displaySymbol)}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      // When stopped, show 3 symbols (top row, middle row, bottom row)
                      // Use finalSymbolsRef which contains [topRow, middleRow, bottomRow] where each row is [col0, col1, col2, col3, col4]
                      [-1, 0, 1].map(offset => {
                        const isCenter = offset === 0;
                        const rowIndex = offset + 1; // -1 -> 0 (top), 0 -> 1 (middle), 1 -> 2 (bottom)
                        
                        // Get symbol from finalSymbolsRef (3 rows × 5 columns)
                        // finalSymbolsRef is [topRow, middleRow, bottomRow] where each row is [col0, col1, col2, col3, col4]
                        let safeSymbol: SlotSymbol = 'common';
                        if (finalSymbolsRef.current && finalSymbolsRef.current[rowIndex] && finalSymbolsRef.current[rowIndex][reelIndex] !== undefined) {
                          // Use the actual symbol from the server result
                          safeSymbol = finalSymbolsRef.current[rowIndex][reelIndex];
                        } else {
                          // Fallback: use the reel's symbol array (for display before server result arrives)
                          const safeCurrentIndex = reel.currentIndex >= 0 && reel.currentIndex < reel.symbols.length 
                            ? reel.currentIndex 
                            : (reel.symbols.length > 0 ? 0 : 0);
                          const symbolIndex = (safeCurrentIndex + offset + reel.symbols.length) % reel.symbols.length;
                          safeSymbol = reel.symbols[symbolIndex] || 'common';
                        }
                        
                        // Show bonus symbols on row 2 (middle row, offset 0) of any column
                        // Bonus symbols only appear on the middle row (row 1, index 1)
                        const isMiddleRow = offset === 0; // Middle row is offset 0 (center position)
                        
                        // Show bonus symbols on middle row of any column when they land
                        // This allows players to see "near-miss" scenarios (1 or 2 bonus symbols)
                        let isBonus = false;
                        if (safeSymbol === 'bonus' && isMiddleRow) {
                          // Bonus symbol on middle row - show it (even if bonus didn't trigger)
                          isBonus = true;
                        } else if (safeSymbol === 'bonus') {
                          // Bonus symbol on other rows - replace with common (bonus only on middle row)
                          safeSymbol = 'common';
                        }
                        
                        const displaySymbol = safeSymbol;
                        const displayIsBonus = isBonus;
                        
                        return (
                          <div
                            key={offset}
                            className={`absolute w-full h-1/3 flex items-center justify-center transition-all ${
                              isCenter ? 'border-2' : ''
                            }`}
                            style={{
                              top: `${(offset + 1) * 33.33}%`,
                              ...(isCenter && displayIsBonus ? {
                                borderColor: '#9333ea',
                                backgroundColor: 'rgba(147, 51, 234, 0.1)',
                                boxShadow: '0 0 20px rgba(147, 51, 234, 0.5), 0 0 40px rgba(79, 70, 229, 0.3)'
                              } : isCenter ? {
                                borderColor: currentTheme.primary,
                                backgroundColor: `${currentTheme.primary}20`
                              } : {})
                            }}
                          >
                            <div
                              className="text-4xl font-bold flex items-center justify-center"
                              style={{ 
                                color: displayIsBonus ? '#9333ea' : getSymbolColor(displaySymbol),
                                textShadow: displayIsBonus
                                  ? `0 0 20px rgba(147, 51, 234, 0.8), 0 0 40px rgba(79, 70, 229, 0.6), 0 0 60px rgba(59, 130, 246, 0.4)`
                                  : `0 0 10px ${getSymbolColor(displaySymbol)}, 0 0 20px ${getSymbolColor(displaySymbol)}`,
                                filter: displayIsBonus ? 'drop-shadow(0 0 12px rgba(147, 51, 234, 0.9))' : 'none',
                                background: displayIsBonus ? 'linear-gradient(135deg, #9333ea 0%, #4f46e5 50%, #3b82f6 100%)' : 'none',
                                WebkitBackgroundClip: displayIsBonus ? 'text' : 'initial',
                                WebkitTextFillColor: displayIsBonus ? 'transparent' : 'initial',
                                backgroundClip: displayIsBonus ? 'text' : 'initial',
                                lineHeight: '1',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '100%',
                                height: '100%'
                              }}
                            >
                              {getSymbolText(displaySymbol)}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
              })}
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
              <span className={`text-sm sm:text-lg font-pixel whitespace-nowrap ${
                paidAmount > 0 ? 'text-green-400' : 'text-gray-500'
              }`}>
                {paidAmount > 0 ? '+' : ''}{paidAmount.toLocaleString()}
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
        
        {/* Bonus Win Modal - Shows total winnings after bonus game ends, positioned over the slot modal */}
        {showBonusWinModal && (
          <div className="absolute inset-0 z-[100] flex items-center justify-center pointer-events-auto">
            <div className="absolute inset-0 bg-black/80" onClick={() => {}}></div>
            <div 
              className="relative bg-gradient-to-b from-orange-900/95 to-red-900/95 border-4 border-orange-400 rounded-2xl p-8 sm:p-12 max-w-md w-full mx-4 shadow-2xl"
              style={{
                boxShadow: '0 0 50px rgba(255, 107, 53, 0.8), 0 0 100px rgba(255, 69, 0, 0.6), inset 0 0 30px rgba(255, 107, 53, 0.3)'
              }}
            >
              <button
                onClick={() => {
                  playCloseSound();
                  setShowBonusWinModal(false);
                  setCumulativeBonusPayout(0); // Reset cumulative after closing
                  // Clear bonus game state to return to base game
                  setIsBonusGame(false);
                  setFreeSpinsRemaining(0);
                  setBonusTriggered(false);
                  isBonusGameRef.current = false;
                  freeSpinsRemainingRef.current = 0;
                  bonusModalClosedRef.current = true; // Mark that modal was manually closed
                }}
                className="absolute top-4 right-4 text-white hover:text-orange-300 transition-colors text-2xl sm:text-3xl font-bold"
                style={{ textShadow: '0 0 10px rgba(255, 107, 53, 0.8)' }}
              >
                ✕
              </button>
              
              <div className="text-center">
                <h2 
                  className="text-3xl sm:text-4xl font-pixel mb-4 animate-pulse"
                  style={{ 
                    color: '#ffa500',
                    textShadow: '0 0 20px #ffa500, 0 0 40px #ff6b35, 0 0 60px #ff4500'
                  }}
                >
                  BONUS WIN!
                </h2>
                
                <div className="mb-6">
                  <div className="text-sm sm:text-base font-pixel text-orange-200 mb-2">Total Winnings:</div>
                  <div 
                    className="text-5xl sm:text-6xl font-pixel font-bold"
                    style={{ 
                      color: '#ffa500',
                      textShadow: '0 0 30px #ffa500, 0 0 60px #ff6b35, 0 0 90px #ff4500'
                    }}
                  >
                    +{formatNumber(displayedBonusWin)}
                  </div>
                </div>
                
                <div className="text-xs sm:text-sm font-pixel text-orange-200">
                  Click ✕ to continue
                </div>
              </div>
            </div>
          </div>
        )}
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
                {/* Base Game Symbol Probabilities */}
                <div>
                  <h3 className="text-xl font-pixel text-amber-400 mb-3">Base Game Symbol Probabilities</h3>
                  <div className="space-y-2 text-sm font-pixel">
                    <div className="flex justify-between text-gray-300">
                      <span>Common:</span>
                      <span className="text-gray-400">{calculateProbability(SYMBOL_WEIGHTS.common, TOTAL_WEIGHT).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between text-gray-300">
                      <span>Uncommon:</span>
                      <span className="text-gray-400">{calculateProbability(SYMBOL_WEIGHTS.uncommon, TOTAL_WEIGHT).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between text-gray-300">
                      <span>Rare:</span>
                      <span className="text-gray-400">{calculateProbability(SYMBOL_WEIGHTS.rare, TOTAL_WEIGHT).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between text-gray-300">
                      <span>Epic:</span>
                      <span className="text-gray-400">{calculateProbability(SYMBOL_WEIGHTS.epic, TOTAL_WEIGHT).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between text-gray-300">
                      <span>Legendary:</span>
                      <span className="text-gray-400">{calculateProbability(SYMBOL_WEIGHTS.legendary, TOTAL_WEIGHT).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between text-gray-300">
                      <span>Godlike:</span>
                      <span className="text-gray-400">{calculateProbability(SYMBOL_WEIGHTS.godlike, TOTAL_WEIGHT).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between text-amber-400">
                      <span>Orb:</span>
                      <span className="text-amber-300">{calculateProbability(SYMBOL_WEIGHTS.orb, TOTAL_WEIGHT).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between text-orange-400">
                      <span>Bonus:</span>
                      <span className="text-orange-300">{calculateProbability(SYMBOL_WEIGHTS.bonus, TOTAL_WEIGHT).toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
                
                {/* Bonus Game Symbol Probabilities */}
                <div>
                  <h3 className="text-xl font-pixel text-orange-400 mb-3">Bonus Game Symbol Probabilities</h3>
                  <div className="space-y-2 text-sm font-pixel">
                    <div className="flex justify-between text-gray-300">
                      <span>Common:</span>
                      <span className="text-gray-400">{calculateProbability(BONUS_SYMBOL_WEIGHTS.common, BONUS_TOTAL_WEIGHT).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between text-gray-300">
                      <span>Uncommon:</span>
                      <span className="text-green-400">{calculateProbability(BONUS_SYMBOL_WEIGHTS.uncommon, BONUS_TOTAL_WEIGHT).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between text-gray-300">
                      <span>Rare:</span>
                      <span className="text-blue-400">{calculateProbability(BONUS_SYMBOL_WEIGHTS.rare, BONUS_TOTAL_WEIGHT).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between text-gray-300">
                      <span>Epic:</span>
                      <span className="text-purple-400">{calculateProbability(BONUS_SYMBOL_WEIGHTS.epic, BONUS_TOTAL_WEIGHT).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between text-gray-300">
                      <span>Legendary:</span>
                      <span className="text-orange-400">{calculateProbability(BONUS_SYMBOL_WEIGHTS.legendary, BONUS_TOTAL_WEIGHT).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between text-gray-300">
                      <span>Godlike:</span>
                      <span className="text-red-400">{calculateProbability(BONUS_SYMBOL_WEIGHTS.godlike, BONUS_TOTAL_WEIGHT).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between text-amber-400">
                      <span>Orb:</span>
                      <span className="text-amber-300">{calculateProbability(BONUS_SYMBOL_WEIGHTS.orb, BONUS_TOTAL_WEIGHT).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between text-gray-500">
                      <span>Bonus:</span>
                      <span className="text-gray-500">0% (Cannot retrigger)</span>
                    </div>
                  </div>
                  <div className="mt-3 p-3 bg-orange-900/20 border border-orange-500/30 rounded text-xs font-pixel text-orange-300">
                    <p className="mb-1">• Bonus game triggers when you get 3 bonus symbols horizontally on row 2 (middle row), with one being the middle column</p>
                    <p className="mb-1">• Bonus trigger odds: ~1.0% (1 in 100 spins) - Bonus symbols only appear on row 2 (middle row) of any column</p>
                    <p className="mb-1">• You can see 1-2 bonus symbols on row 2 during regular play (near-miss scenarios)</p>
                    <p className="mb-1">• Bonus game gives you 10 free spins with increased probability for rare+ symbols</p>
                    <p>• Bonus symbols cannot appear during bonus game (no retriggers)</p>
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
                        <div>5 Uncommon: <span className="text-yellow-400">0.95x</span> <span className="text-xs text-gray-500">(kickback)</span></div>
                        <div>5 Common: <span className="text-yellow-400">0.9x</span> <span className="text-xs text-gray-500">(kickback)</span></div>
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
                        <div>4 Uncommon: <span className="text-yellow-400">0.8x</span> <span className="text-xs text-gray-500">(kickback)</span></div>
                        <div>4 Common: <span className="text-yellow-400">0.7x</span> <span className="text-xs text-gray-500">(kickback)</span></div>
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
                        <div>3 Uncommon: <span className="text-yellow-400">0.6x</span> <span className="text-xs text-gray-500">(kickback)</span></div>
                        <div>3 Common: <span className="text-yellow-400">0.5x</span> <span className="text-xs text-gray-500">(kickback)</span></div>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="text-sm font-pixel text-gray-400 border-t border-amber-500 pt-4">
                  <p className="mb-2">• You need 3 or more matching symbols to win</p>
                  <p className="mb-2">• Higher rarity symbols have better payouts</p>
                  <p className="mb-2">• Net payout = (Bet × Multiplier) - Bet</p>
                  <p className="mb-2">• Bonus game: Free spins don't cost, and you keep all winnings</p>
                  <p>• Bonus trigger: 3+ bonus symbols with middle reel (3rd column) being bonus = 10 free spins</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
