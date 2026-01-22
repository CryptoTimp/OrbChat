// Slot machine game logic

export type SlotSymbol = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'godlike' | 'orb' | 'bonus';

// Slot machine seat management
export interface SlotMachinePlayer {
  playerId: string;
  playerName: string;
  seat: number; // 0-7 (8 seats per machine)
}

export interface SlotMachineState {
  slotMachineId: string;
  players: SlotMachinePlayer[];
}

// All slot machines
const slotMachines: Map<string, SlotMachineState> = new Map();

// Bonus game state tracking per player AND per slot machine
export interface BonusGameState {
  freeSpinsRemaining: number;
  isInBonus: boolean;
}

// Key format: `${playerId}:${slotMachineId}` to track bonus state per slot machine
const bonusGameStates: Map<string, BonusGameState> = new Map();

// Get bonus game state for a player on a specific slot machine
export function getBonusGameState(playerId: string, slotMachineId: string): BonusGameState | undefined {
  const key = `${playerId}:${slotMachineId}`;
  return bonusGameStates.get(key);
}

// Set bonus game state for a player on a specific slot machine
export function setBonusGameState(playerId: string, slotMachineId: string, state: BonusGameState): void {
  const key = `${playerId}:${slotMachineId}`;
  bonusGameStates.set(key, state);
}

// Clear bonus game state for a player on a specific slot machine
export function clearBonusGameState(playerId: string, slotMachineId: string): void {
  const key = `${playerId}:${slotMachineId}`;
  bonusGameStates.delete(key);
}

// Initialize slot machines
export function initializeSlotMachines(): void {
  const slotMachineIds = ['slot_machine_north', 'slot_machine_east', 'slot_machine_south', 'slot_machine_west'];
  for (const slotMachineId of slotMachineIds) {
    slotMachines.set(slotMachineId, {
      slotMachineId,
      players: []
    });
  }
  console.log(`[Slots] Initialized ${slotMachines.size} slot machines`);
}

// Get slot machine state
export function getSlotMachine(slotMachineId: string): SlotMachineState | undefined {
  return slotMachines.get(slotMachineId);
}

// Join a slot machine (find available seat)
export function joinSlotMachine(slotMachineId: string, playerId: string, playerName: string): { success: boolean; message?: string; seat?: number } {
  const machine = slotMachines.get(slotMachineId);
  if (!machine) {
    return { success: false, message: 'Slot machine not found' };
  }
  
  // Check if player is already at this machine
  const existingPlayer = machine.players.find(p => p.playerId === playerId);
  if (existingPlayer) {
    return { success: true, seat: existingPlayer.seat };
  }
  
  // Check if machine is full (8 seats)
  if (machine.players.length >= 8) {
    return { success: false, message: 'Slot machine is full' };
  }
  
  // Find available seat (0-7)
  const occupiedSeats = new Set(machine.players.map(p => p.seat));
  let seat = -1;
  for (let i = 0; i < 8; i++) {
    if (!occupiedSeats.has(i)) {
      seat = i;
      break;
    }
  }
  
  if (seat === -1) {
    return { success: false, message: 'No available seats' };
  }
  
  // Add player
  const newPlayer: SlotMachinePlayer = {
    playerId,
    playerName,
    seat
  };
  
  machine.players.push(newPlayer);
  return { success: true, seat };
}

// Leave a slot machine
export function leaveSlotMachine(slotMachineId: string, playerId: string): { success: boolean; message?: string } {
  const machine = slotMachines.get(slotMachineId);
  if (!machine) {
    return { success: true }; // Already not at machine
  }
  
  const index = machine.players.findIndex(p => p.playerId === playerId);
  if (index === -1) {
    return { success: true }; // Already not at machine
  }
  
  machine.players.splice(index, 1);
  return { success: true };
}

// Symbol weights for probability (adjusted to increase rare/epic/legendary combinations)
// Further reduced common/uncommon by 15%, increased rare/epic/legendary by 15% for more profitable wins
const SYMBOL_WEIGHTS: Record<SlotSymbol, number> = {
  common: 30,      // Reduced by 15% from 35 (was 50%)
  uncommon: 13,    // Reduced by 15% from 15 (was 20%)
  rare: 21,        // Increased by 15% from 18 (was 10%)
  epic: 17,        // Increased by 15% from 15 (was 8%)
  legendary: 14,   // Increased by 15% from 12 (was 6%)
  godlike: 3,      // Same (3%)
  orb: 1,          // Same (1%)
  bonus: 25        // Bonus symbol only appears on row 2 (middle row) of any column (~21.5% per symbol, bonus trigger ~1 in 100 spins for 3 on row 2)
};

const TOTAL_WEIGHT = Object.values(SYMBOL_WEIGHTS).reduce((sum, weight) => sum + weight, 0);

// Bonus game symbol weights (skewed toward higher rarity rewards)
// Reduced uncommon, increased rare/epic/legendary/godlike/orb for better rewards
const BONUS_SYMBOL_WEIGHTS: Record<SlotSymbol, number> = {
  common: 30,        // Reduced from 40
  uncommon: 80,     // Reduced from 160 (was too high at 37.7%)
  rare: 120,        // Increased from 80 (better rewards)
  epic: 100,        // Increased from 64 (better rewards)
  legendary: 80,    // Increased from 48 (better rewards)
  godlike: 50,      // Increased from 24 (better rewards)
  orb: 20,          // Increased from 8 (better rewards)
  bonus: 0          // Bonus symbol removed during bonus game (can't retrigger)
};

const BONUS_TOTAL_WEIGHT = Object.values(BONUS_SYMBOL_WEIGHTS).reduce((sum, weight) => sum + weight, 0);

// Payout multipliers (adjusted - common/uncommon give kickback but always less than bet)
// Payouts are multipliers of bet amount
// Common and uncommon payouts are < 1.0x to ensure players always lose money but get small kickback
const PAYOUTS: Record<string, number> = {
  '5_orb': 1000,
  '5_godlike': 500,
  '5_legendary': 250,
  '5_epic': 100,
  '5_rare': 50,
  '5_uncommon': 0.95,  // 95% of bet (bet 5k = 4.75k payout, lose 0.25k)
  '5_common': 0.9,     // 90% of bet (bet 5k = 4.5k payout, lose 0.5k)
  '4_orb': 200,
  '4_godlike': 100,
  '4_legendary': 50,
  '4_epic': 25,
  '4_rare': 15,
  '4_uncommon': 0.8,   // 80% of bet (bet 5k = 4k payout, lose 1k)
  '4_common': 0.7,     // 70% of bet (bet 5k = 3.5k payout, lose 1.5k)
  '3_orb': 50,
  '3_godlike': 25,
  '3_legendary': 10,
  '3_epic': 5,
  '3_rare': 3,
  '3_uncommon': 0.6,   // 60% of bet (bet 5k = 3k payout, lose 2k)
  '3_common': 0.5,     // 50% of bet (bet 5k = 2.5k payout, lose 2.5k)
};

// Debug helper to log payout calculation
export function debugPayoutCalculation(symbols: SlotSymbol[], betAmount: number): void {
  console.log('[Slots Debug] Symbols:', symbols.join(', '));
  let maxConsecutive = 0;
  let maxSymbol: SlotSymbol | null = null;
  let currentConsecutive = 0;
  let currentSymbol: SlotSymbol | null = null;
  
  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    if (symbol === 'bonus') {
      if (currentConsecutive > maxConsecutive) {
        maxConsecutive = currentConsecutive;
        maxSymbol = currentSymbol;
      }
      currentConsecutive = 0;
      currentSymbol = null;
      continue;
    }
    if (symbol === currentSymbol) {
      currentConsecutive++;
    } else {
      if (currentConsecutive > maxConsecutive) {
        maxConsecutive = currentConsecutive;
        maxSymbol = currentSymbol;
      }
      currentConsecutive = 1;
      currentSymbol = symbol;
    }
  }
  if (currentConsecutive > maxConsecutive) {
    maxConsecutive = currentConsecutive;
    maxSymbol = currentSymbol;
  }
  
  console.log('[Slots Debug] Max consecutive:', maxConsecutive, 'Symbol:', maxSymbol);
  if (maxConsecutive >= 3 && maxSymbol) {
    const payoutCount = Math.min(maxConsecutive, 5);
    const payoutKey = `${payoutCount}_${maxSymbol}`;
    const multiplier = PAYOUTS[payoutKey] || 0;
    console.log('[Slots Debug] Payout key:', payoutKey, 'Multiplier:', multiplier, 'Payout:', Math.floor(betAmount * multiplier));
  } else {
    console.log('[Slots Debug] No payout - consecutive count:', maxConsecutive);
  }
}

// Generate a random symbol based on weights
function generateSymbol(): SlotSymbol {
  let random = Math.random() * TOTAL_WEIGHT;
  const symbols: SlotSymbol[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'godlike', 'orb', 'bonus'];
  
  for (const symbol of symbols) {
    random -= SYMBOL_WEIGHTS[symbol];
    if (random <= 0) {
      return symbol;
    }
  }
  
  return 'common'; // Fallback
}

// Generate a random symbol for bonus game (with increased weights, no bonus symbol)
function generateBonusSymbol(): SlotSymbol {
  let random = Math.random() * BONUS_TOTAL_WEIGHT;
  const symbols: SlotSymbol[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'godlike', 'orb'];
  
  for (const symbol of symbols) {
    random -= BONUS_SYMBOL_WEIGHTS[symbol];
    if (random <= 0) {
      return symbol;
    }
  }
  
  return 'common'; // Fallback
}

// Spin the slot machine (generate 15 symbols: 3 rows × 5 columns)
// Bonus symbols can ONLY appear on row 1 (middle row, index 1) - any column can have bonus symbols
// However, if 3 bonus symbols land on row 2, at least one must be in the middle column (column 2)
// This prevents misleading scenarios where 3 bonus symbols appear but don't trigger the bonus
export function spinSlots(): SlotSymbol[][] {
  const symbols: SlotSymbol[][] = [
    [generateSymbol(), generateSymbol(), generateSymbol(), generateSymbol(), generateSymbol()], // Top row
    [generateSymbol(), generateSymbol(), generateSymbol(), generateSymbol(), generateSymbol()], // Middle row
    [generateSymbol(), generateSymbol(), generateSymbol(), generateSymbol(), generateSymbol()]  // Bottom row
  ];
  
  // Ensure bonus symbols only appear on middle row (row 1, index 1) - any column can have bonus symbols
  // If a bonus symbol was generated elsewhere, replace it with a regular symbol
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) {
      // If it's a bonus symbol and NOT on middle row (row 1), replace it
      if (symbols[row][col] === 'bonus' && row !== 1) {
        // Replace with a weighted random symbol (excluding bonus to avoid infinite loop)
        let random = Math.random() * (TOTAL_WEIGHT - SYMBOL_WEIGHTS.bonus);
        const regularSymbols: SlotSymbol[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'godlike', 'orb'];
        for (const symbol of regularSymbols) {
          random -= SYMBOL_WEIGHTS[symbol];
          if (random <= 0) {
            symbols[row][col] = symbol;
            break;
          }
        }
      }
    }
  }
  
  // Check if we have 3 bonus symbols on row 2 but none in the middle column
  // If so, replace one of the non-middle-column bonus symbols with a regular symbol
  const middleRow = symbols[1];
  const bonusCount = middleRow.filter(s => s === 'bonus').length;
  const hasBonusInMiddleColumn = middleRow[2] === 'bonus';
  
  if (bonusCount >= 3 && !hasBonusInMiddleColumn) {
    // Find bonus symbols not in the middle column and replace one of them
    const nonMiddleBonusIndices: number[] = [];
    for (let col = 0; col < 5; col++) {
      if (col !== 2 && middleRow[col] === 'bonus') {
        nonMiddleBonusIndices.push(col);
      }
    }
    
    // Replace one of the non-middle-column bonus symbols
    if (nonMiddleBonusIndices.length > 0) {
      const indexToReplace = nonMiddleBonusIndices[Math.floor(Math.random() * nonMiddleBonusIndices.length)];
      // Replace with a weighted random symbol (excluding bonus to avoid infinite loop)
      let random = Math.random() * (TOTAL_WEIGHT - SYMBOL_WEIGHTS.bonus);
      const regularSymbols: SlotSymbol[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'godlike', 'orb'];
      for (const symbol of regularSymbols) {
        random -= SYMBOL_WEIGHTS[symbol];
        if (random <= 0) {
          middleRow[indexToReplace] = symbol;
          console.log(`[Slots] Replaced bonus symbol at column ${indexToReplace} to prevent misleading 3-bonus without middle column trigger`);
          break;
        }
      }
    }
  }
  
  return symbols;
}

// Spin slots with bonus game weights (increased probability)
export function spinSlotsWithBonus(): SlotSymbol[][] {
  return [
    [generateBonusSymbol(), generateBonusSymbol(), generateBonusSymbol(), generateBonusSymbol(), generateBonusSymbol()], // Top row
    [generateBonusSymbol(), generateBonusSymbol(), generateBonusSymbol(), generateBonusSymbol(), generateBonusSymbol()], // Middle row
    [generateBonusSymbol(), generateBonusSymbol(), generateBonusSymbol(), generateBonusSymbol(), generateBonusSymbol()]  // Bottom row
  ];
}

// Check if bonus trigger is activated (3 bonus symbols horizontally on row 2, with one being the middle column)
export function checkBonusTrigger(symbols: SlotSymbol[][]): boolean {
  // Requirement: "3 bonus symbols horizontally on row 2 (middle row, index 1), with one being the middle column (column 2)"
  // Bonus symbols only appear on middle row (row 1, index 1)
  const middleRow = symbols[1]; // Row 2 (middle row) - array of 5 columns
  const bonusCount = middleRow.filter(s => s === 'bonus').length;
  const hasBonusInMiddleColumn = middleRow[2] === 'bonus'; // Check if middle column (column 2) has bonus
  
  // Trigger when we have 3 bonus symbols on the middle row AND at least one is in the middle column
  return bonusCount >= 3 && hasBonusInMiddleColumn;
}

// Calculate payout based on symbols (ONLY checks middle row for 3+ of a kind)
export function calculatePayout(symbols: SlotSymbol[][], betAmount: number): number {
  // ONLY check the middle row (index 1) for payouts
  const middleRow = symbols[1];
  
  // Count occurrences of each symbol in the middle row (exclude bonus from payout calculation)
  const counts: Record<SlotSymbol, number> = {
    common: 0,
    uncommon: 0,
    rare: 0,
    epic: 0,
    legendary: 0,
    godlike: 0,
    orb: 0,
    bonus: 0  // Bonus symbols don't count for payouts
  };
  
  for (const symbol of middleRow) {
    if (symbol !== 'bonus') {
      counts[symbol]++;
    }
  }
  
  // Check for winning combinations (3, 4, or 5 of a kind)
  // Priority: orb > godlike > legendary > epic > rare > uncommon > common
  const symbolOrder: SlotSymbol[] = ['orb', 'godlike', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
  
  for (const symbol of symbolOrder) {
    const count = counts[symbol];
    if (count >= 3) {
      const payoutKey = `${count}_${symbol}`;
      const multiplier = PAYOUTS[payoutKey];
      
      if (multiplier === undefined) {
        console.warn(`[Slots] Missing payout entry for: ${payoutKey}. Middle row: ${middleRow.join(', ')}`);
        return 0;
      }
      
      const payout = Math.floor(betAmount * multiplier);
      console.log(`[Slots] Middle row payout: ${payoutKey} (${count} of ${symbol}) = ${multiplier}x bet = ${payout} orbs (bet: ${betAmount})`);
      return payout;
    }
  }
  
  console.log(`[Slots] No payout - no 3+ of a kind found in middle row: ${middleRow.join(', ')}`);
  return 0; // No win
}
