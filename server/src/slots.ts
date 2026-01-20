// Slot machine game logic

type SlotSymbol = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'godlike' | 'orb';

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

// Symbol weights for probability (based on user testing)
// Common: 50%, Uncommon: 20%, Rare: 10%, Epic: 8%, Legendary: 6%, Godlike: 3%, Orb: 1%
const SYMBOL_WEIGHTS: Record<SlotSymbol, number> = {
  common: 50,
  uncommon: 20,
  rare: 10,
  epic: 8,
  legendary: 6,
  godlike: 3,
  orb: 1
};

const TOTAL_WEIGHT = Object.values(SYMBOL_WEIGHTS).reduce((sum, weight) => sum + weight, 0);

// Payout multipliers (adjusted based on user testing - common odds increased to 50%, so payouts reduced)
// Payouts are multipliers of bet amount
const PAYOUTS: Record<string, number> = {
  '5_orb': 1000,
  '5_godlike': 500,
  '5_legendary': 250,
  '5_epic': 100,
  '5_rare': 50,
  '5_uncommon': 20,
  '5_common': 5, // 5 commons: 25k (bet 5k = 25k, bet 25k = 125k) - reduced since odds increased
  '4_orb': 200,
  '4_godlike': 100,
  '4_legendary': 50,
  '4_epic': 25,
  '4_rare': 15,
  '4_uncommon': 8,
  '4_common': 3, // 4 commons: 15k (bet 5k = 15k, bet 25k = 75k) - reduced from 5x
  '3_orb': 50,
  '3_godlike': 25,
  '3_legendary': 10,
  '3_epic': 5,
  '3_rare': 3,
  '3_uncommon': 2,
  '3_common': 0.5, // 3 commons: 2.5k (bet 5k = 2.5k, bet 25k = 12.5k) - lose half bet since odds increased
};

// Generate a random symbol based on weights
function generateSymbol(): SlotSymbol {
  let random = Math.random() * TOTAL_WEIGHT;
  const symbols: SlotSymbol[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'godlike', 'orb'];
  
  for (const symbol of symbols) {
    random -= SYMBOL_WEIGHTS[symbol];
    if (random <= 0) {
      return symbol;
    }
  }
  
  return 'common'; // Fallback
}

// Spin the slot machine (generate 5 symbols)
export function spinSlots(): SlotSymbol[] {
  return [
    generateSymbol(),
    generateSymbol(),
    generateSymbol(),
    generateSymbol(),
    generateSymbol()
  ];
}

// Calculate payout based on symbols
export function calculatePayout(symbols: SlotSymbol[], betAmount: number): number {
  // Count occurrences of each symbol
  const counts: Record<SlotSymbol, number> = {
    common: 0,
    uncommon: 0,
    rare: 0,
    epic: 0,
    legendary: 0,
    godlike: 0,
    orb: 0
  };
  
  for (const symbol of symbols) {
    counts[symbol]++;
  }
  
  // Check for winning combinations (3, 4, or 5 of a kind)
  // Priority: orb > godlike > legendary > epic > rare > uncommon > common
  const symbolOrder: SlotSymbol[] = ['orb', 'godlike', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
  
  for (const symbol of symbolOrder) {
    const count = counts[symbol];
    if (count >= 3) {
      const payoutKey = `${count}_${symbol}`;
      const multiplier = PAYOUTS[payoutKey] || 0;
      return Math.floor(betAmount * multiplier);
    }
  }
  
  return 0; // No win
}
