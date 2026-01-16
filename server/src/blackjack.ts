import {
  BlackjackTable,
  BlackjackTableState,
  BlackjackPlayer,
  BlackjackHand,
  BlackjackCard,
  CardSuit,
  CardRank,
  BlackjackGameState,
  BLACKJACK_CONSTANTS,
} from './types';

// All blackjack tables
const tables: Map<string, BlackjackTable> = new Map();

// Initialize 4 blackjack tables
export function initializeBlackjackTables(): void {
  for (let i = 1; i <= 4; i++) {
    const tableId = `blackjack_table_${i}`;
    const dealerId = `blackjack_dealer_${i}`;
    
    const initialState: BlackjackTableState = {
      tableId,
      dealerId,
      dealerHand: [],
      dealerHasBlackjack: false,
      players: [],
      deck: createDeck(),
      gameState: 'waiting',
      currentPlayerIndex: null,
      roundNumber: 0,
    };
    
    tables.set(tableId, {
      id: tableId,
      dealerId,
      state: initialState,
    });
  }
  console.log(`[Blackjack] Initialized ${tables.size} blackjack tables`);
}

// Create a standard 52-card deck
function createDeck(): BlackjackCard[] {
  const suits: CardSuit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
  const ranks: CardRank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck: BlackjackCard[] = [];
  
  for (const suit of suits) {
    for (const rank of ranks) {
      let value: number;
      if (rank === 'A') {
        value = 11; // Default to 11, will be adjusted in hand calculation
      } else if (rank === 'J' || rank === 'Q' || rank === 'K') {
        value = 10;
      } else {
        value = parseInt(rank);
      }
      
      deck.push({ suit, rank, value });
    }
  }
  
  return shuffleDeck(deck);
}

// Fisher-Yates shuffle
function shuffleDeck(deck: BlackjackCard[]): BlackjackCard[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Calculate hand value (handles Aces as 1 or 11)
export function calculateHandValue(cards: BlackjackCard[]): number {
  let value = 0;
  let aces = 0;
  
  for (const card of cards) {
    if (card.rank === 'A') {
      aces++;
      value += 11;
    } else {
      value += card.value;
    }
  }
  
  // Adjust for aces (if over 21, count ace as 1 instead of 11)
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }
  
  return value;
}

// Check if hand is blackjack (21 with 2 cards)
function isBlackjack(cards: BlackjackCard[]): boolean {
  return cards.length === 2 && calculateHandValue(cards) === 21;
}

// Check if hand is bust (over 21)
function isBust(cards: BlackjackCard[]): boolean {
  return calculateHandValue(cards) > 21;
}

// Check if hand can be split (two cards of same rank)
function canSplit(cards: BlackjackCard[]): boolean {
  return cards.length === 2 && cards[0].rank === cards[1].rank;
}

// Get table by ID
export function getTable(tableId: string): BlackjackTable | undefined {
  return tables.get(tableId);
}

// Get all tables
export function getAllTables(): BlackjackTable[] {
  return Array.from(tables.values());
}

// Join a table
export function joinTable(tableId: string, playerId: string, playerName: string): { success: boolean; message?: string; seat?: number } {
  const table = tables.get(tableId);
  if (!table) {
    return { success: false, message: 'Table not found' };
  }
  
  // Check if player is already at this table
  const existingPlayer = table.state.players.find(p => p.playerId === playerId);
  if (existingPlayer) {
    return { success: true, seat: existingPlayer.seat };
  }
  
  // Check if table is full
  if (table.state.players.length >= BLACKJACK_CONSTANTS.MAX_PLAYERS_PER_TABLE) {
    return { success: false, message: 'Table is full' };
  }
  
  // Find available seat (0-6)
  const occupiedSeats = new Set(table.state.players.map(p => p.seat));
  let seat = -1;
  for (let i = 0; i < BLACKJACK_CONSTANTS.MAX_PLAYERS_PER_TABLE; i++) {
    if (!occupiedSeats.has(i)) {
      seat = i;
      break;
    }
  }
  
  if (seat === -1) {
    return { success: false, message: 'No available seats' };
  }
  
  // Add player
  const newPlayer: BlackjackPlayer = {
    playerId,
    playerName,
    seat,
    hands: [],
    currentHandIndex: 0,
    hasPlacedBet: false,
    isActive: true,
  };
  
  table.state.players.push(newPlayer);
  return { success: true, seat };
}

// Leave a table
export function leaveTable(tableId: string, playerId: string): { success: boolean; message?: string } {
  const table = tables.get(tableId);
  if (!table) {
    return { success: false, message: 'Table not found' };
  }
  
  const playerIndex = table.state.players.findIndex(p => p.playerId === playerId);
  if (playerIndex === -1) {
    return { success: false, message: 'Player not at table' };
  }
  
  const player = table.state.players[playerIndex];
  
  // If player has active bets, they forfeit them (handled by caller)
  // Remove player
  table.state.players.splice(playerIndex, 1);
  
  // Adjust current player index if needed
  if (table.state.currentPlayerIndex !== null) {
    if (table.state.currentPlayerIndex > playerIndex) {
      table.state.currentPlayerIndex--;
    } else if (table.state.currentPlayerIndex === playerIndex) {
      // Current player left, move to next
      advanceToNextPlayer(table);
    }
  }
  
  return { success: true };
}

// Place a bet
export function placeBet(tableId: string, playerId: string, amount: number, playerOrbs: number): { success: boolean; message?: string } {
  const table = tables.get(tableId);
  if (!table) {
    return { success: false, message: 'Table not found' };
  }
  
  // Validate bet amount
  if (amount < BLACKJACK_CONSTANTS.MIN_BET) {
    return { success: false, message: `Minimum bet is ${BLACKJACK_CONSTANTS.MIN_BET.toLocaleString()} orbs` };
  }
  if (amount > BLACKJACK_CONSTANTS.MAX_BET) {
    return { success: false, message: `Maximum bet is ${BLACKJACK_CONSTANTS.MAX_BET.toLocaleString()} orbs` };
  }
  if (amount > playerOrbs) {
    return { success: false, message: 'Insufficient orbs' };
  }
  
  // Check game state
  if (table.state.gameState !== 'betting' && table.state.gameState !== 'waiting') {
    return { success: false, message: 'Cannot place bet at this time' };
  }
  
  const player = table.state.players.find(p => p.playerId === playerId);
  if (!player) {
    return { success: false, message: 'Player not at table' };
  }
  
  if (player.hasPlacedBet) {
    return { success: false, message: 'Bet already placed for this round' };
  }
  
  // Create initial hand with bet
  console.log(`[Blackjack placeBet] Creating hand for player ${playerId} with bet amount: ${amount} (type: ${typeof amount})`);
  player.hands = [{
    cards: [],
    bet: amount, // CRITICAL: Store the exact bet amount
    isSplit: false,
    isDoubleDown: false,
    isStand: false,
    isBust: false,
    isBlackjack: false,
  }];
  player.currentHandIndex = 0;
  player.hasPlacedBet = true;
  
  // Verify bet was stored correctly
  console.log(`[Blackjack placeBet] Verified hand created: hand.bet=${player.hands[0].bet}, expected=${amount}`);
  if (player.hands[0].bet !== amount) {
    console.error(`[Blackjack placeBet] CRITICAL ERROR: Bet mismatch! Stored: ${player.hands[0].bet}, Expected: ${amount}`);
  }
  
  // If this is the first bet, start the round
  if (table.state.gameState === 'waiting') {
    table.state.gameState = 'betting';
  }
  
  return { success: true };
}

// Start dealing (called when all players have placed bets or timeout)
export function startDealing(tableId: string): { success: boolean; message?: string } {
  const table = tables.get(tableId);
  if (!table) {
    return { success: false, message: 'Table not found' };
  }
  
  if (table.state.gameState !== 'betting') {
    return { success: false, message: 'Cannot start dealing at this time' };
  }
  
  // Check if any players have placed bets
  const playersWithBets = table.state.players.filter(p => p.hasPlacedBet);
  if (playersWithBets.length === 0) {
    return { success: false, message: 'No players have placed bets' };
  }
  
  // Shuffle and create new deck
  table.state.deck = createDeck();
  table.state.dealerHand = [];
  table.state.roundNumber++;
  
  // Deal initial cards: each player gets 2 cards, dealer gets 2 cards (one hidden)
  for (const player of playersWithBets) {
    // Preserve the bet amount when resetting hand
    if (!player.hands || player.hands.length === 0) {
      console.error(`[Blackjack] Player ${player.playerId} has no hands!`);
      continue;
    }
    const originalBet = player.hands[0]?.bet;
    console.log(`[Blackjack startDealing] Player ${player.playerId}: originalBet=${originalBet} (type: ${typeof originalBet})`);
    
    // CRITICAL: Ensure bet is a number and validate it
    const numericBet = Number(originalBet);
    if (isNaN(numericBet) || numericBet <= 0) {
      console.error(`[Blackjack] CRITICAL: Invalid bet amount for player ${player.playerId}: ${originalBet} (numeric: ${numericBet}). This will cause payout errors!`);
      console.error(`[Blackjack] Player hands state:`, JSON.stringify(player.hands));
      // Don't continue if bet is invalid
      continue;
    }
    
    // Validate bet is reasonable (should be at least MIN_BET)
    if (numericBet < BLACKJACK_CONSTANTS.MIN_BET) {
      console.error(`[Blackjack] CRITICAL: Bet amount ${numericBet} is below minimum ${BLACKJACK_CONSTANTS.MIN_BET}!`);
    }
    
    // Create new hand with preserved bet
    player.hands[0] = {
      cards: [],
      bet: numericBet, // CRITICAL: Preserve the bet amount as a number
      isSplit: false,
      isDoubleDown: false,
      isStand: false,
      isBust: false,
      isBlackjack: false,
    };
    console.log(`[Blackjack startDealing] Player ${player.playerId}: After dealing, hand.bet=${player.hands[0].bet}, originalBet=${originalBet}, numericBet=${numericBet}`);
    if (player.hands[0].bet !== numericBet) {
      console.error(`[Blackjack] CRITICAL ERROR: Bet lost during dealing! Before: ${originalBet} (numeric: ${numericBet}), After: ${player.hands[0].bet}`);
    }
    player.hands[0].isStand = false;
    player.hands[0].isBust = false;
    player.hands[0].isBlackjack = false;
    player.currentHandIndex = 0;
    
    // Deal 2 cards to player
    for (let i = 0; i < 2; i++) {
      const card = table.state.deck.pop();
      if (card) {
        player.hands[0].cards.push(card);
      }
    }
    
    // Check for blackjack
    if (isBlackjack(player.hands[0].cards)) {
      player.hands[0].isBlackjack = true;
      player.hands[0].isStand = true;
    }
  }
  
  // Deal 2 cards to dealer
  for (let i = 0; i < 2; i++) {
    const card = table.state.deck.pop();
    if (card) {
      table.state.dealerHand.push(card);
    }
  }
  
  // Check dealer blackjack
  table.state.dealerHasBlackjack = isBlackjack(table.state.dealerHand);
  
  // If dealer has blackjack, end round immediately
  if (table.state.dealerHasBlackjack) {
    table.state.gameState = 'finished';
    return { success: true };
  }
  
  // Move to playing phase
  table.state.gameState = 'playing';
  table.state.currentPlayerIndex = 0;
  
  // Skip players who already have blackjack
  while (table.state.currentPlayerIndex < playersWithBets.length) {
    const currentPlayer = playersWithBets[table.state.currentPlayerIndex];
    if (currentPlayer.hands[0].isBlackjack) {
      table.state.currentPlayerIndex++;
    } else {
      break;
    }
  }
  
  // If all players have blackjack, move to dealer turn
  if (table.state.currentPlayerIndex >= playersWithBets.length) {
    table.state.gameState = 'dealer_turn';
    table.state.currentPlayerIndex = null;
    playDealerHand(table);
  }
  
  return { success: true };
}

// Hit (deal one card)
export function hit(tableId: string, playerId: string, handIndex: number = 0): { success: boolean; message?: string } {
  const table = tables.get(tableId);
  if (!table) {
    return { success: false, message: 'Table not found' };
  }
  
  if (table.state.gameState !== 'playing') {
    return { success: false, message: 'Not in playing phase' };
  }
  
  const player = table.state.players.find(p => p.playerId === playerId);
  if (!player) {
    return { success: false, message: 'Player not at table' };
  }
  
  // Check if it's this player's turn
  const playerIndex = table.state.players.findIndex(p => p.playerId === playerId);
  if (table.state.currentPlayerIndex !== playerIndex) {
    return { success: false, message: 'Not your turn' };
  }
  
  const hand = player.hands[handIndex];
  if (!hand) {
    return { success: false, message: 'Invalid hand' };
  }
  
  if (hand.isStand || hand.isBust || hand.isBlackjack) {
    return { success: false, message: 'Cannot hit this hand' };
  }
  
  // Deal one card
  const card = table.state.deck.pop();
  if (!card) {
    // Reshuffle if deck is empty
    table.state.deck = createDeck();
    const newCard = table.state.deck.pop();
    if (newCard) {
      hand.cards.push(newCard);
    }
  } else {
    hand.cards.push(card);
  }
  
  // Check for bust
  if (isBust(hand.cards)) {
    hand.isBust = true;
    hand.isStand = true;
    advanceToNextPlayer(table);
  }
  
  return { success: true };
}

// Stand (end turn)
export function stand(tableId: string, playerId: string, handIndex: number = 0): { success: boolean; message?: string } {
  const table = tables.get(tableId);
  if (!table) {
    return { success: false, message: 'Table not found' };
  }
  
  if (table.state.gameState !== 'playing') {
    return { success: false, message: 'Not in playing phase' };
  }
  
  const player = table.state.players.find(p => p.playerId === playerId);
  if (!player) {
    return { success: false, message: 'Player not at table' };
  }
  
  // Check if it's this player's turn
  const playerIndex = table.state.players.findIndex(p => p.playerId === playerId);
  if (table.state.currentPlayerIndex !== playerIndex) {
    return { success: false, message: 'Not your turn' };
  }
  
  const hand = player.hands[handIndex];
  if (!hand) {
    return { success: false, message: 'Invalid hand' };
  }
  
  if (hand.isStand || hand.isBust) {
    return { success: false, message: 'Hand already finished' };
  }
  
  hand.isStand = true;
  advanceToNextPlayer(table);
  
  return { success: true };
}

// Double down
export function doubleDown(tableId: string, playerId: string, handIndex: number = 0, playerOrbs: number): { success: boolean; message?: string } {
  const table = tables.get(tableId);
  if (!table) {
    return { success: false, message: 'Table not found' };
  }
  
  if (table.state.gameState !== 'playing') {
    return { success: false, message: 'Not in playing phase' };
  }
  
  const player = table.state.players.find(p => p.playerId === playerId);
  if (!player) {
    return { success: false, message: 'Player not at table' };
  }
  
  // Check if it's this player's turn
  const playerIndex = table.state.players.findIndex(p => p.playerId === playerId);
  if (table.state.currentPlayerIndex !== playerIndex) {
    return { success: false, message: 'Not your turn' };
  }
  
  const hand = player.hands[handIndex];
  if (!hand) {
    return { success: false, message: 'Invalid hand' };
  }
  
  if (hand.cards.length !== 2) {
    return { success: false, message: 'Can only double down on first two cards' };
  }
  
  if (hand.isStand || hand.isBust || hand.isBlackjack) {
    return { success: false, message: 'Cannot double down on this hand' };
  }
  
  // Check if player has enough orbs
  if (playerOrbs < hand.bet) {
    return { success: false, message: 'Insufficient orbs to double down' };
  }
  
  // Double the bet
  hand.bet *= 2;
  hand.isDoubleDown = true;
  
  // Deal one card and stand
  const card = table.state.deck.pop();
  if (!card) {
    table.state.deck = createDeck();
    const newCard = table.state.deck.pop();
    if (newCard) {
      hand.cards.push(newCard);
    }
  } else {
    hand.cards.push(card);
  }
  
  // Check for bust
  if (isBust(hand.cards)) {
    hand.isBust = true;
  }
  
  hand.isStand = true;
  advanceToNextPlayer(table);
  
  return { success: true };
}

// Split
export function split(tableId: string, playerId: string, handIndex: number = 0, playerOrbs: number): { success: boolean; message?: string } {
  const table = tables.get(tableId);
  if (!table) {
    return { success: false, message: 'Table not found' };
  }
  
  if (table.state.gameState !== 'playing') {
    return { success: false, message: 'Not in playing phase' };
  }
  
  const player = table.state.players.find(p => p.playerId === playerId);
  if (!player) {
    return { success: false, message: 'Player not at table' };
  }
  
  // Check if it's this player's turn
  const playerIndex = table.state.players.findIndex(p => p.playerId === playerId);
  if (table.state.currentPlayerIndex !== playerIndex) {
    return { success: false, message: 'Not your turn' };
  }
  
  const hand = player.hands[handIndex];
  if (!hand) {
    return { success: false, message: 'Invalid hand' };
  }
  
  if (!canSplit(hand.cards)) {
    return { success: false, message: 'Cannot split this hand' };
  }
  
  // Check if player has enough orbs for additional bet
  if (playerOrbs < hand.bet) {
    return { success: false, message: 'Insufficient orbs to split' };
  }
  
  // Split the hand
  const card1 = hand.cards[0];
  const card2 = hand.cards[1];
  
  // Create two new hands
  const newHand1: BlackjackHand = {
    cards: [card1],
    bet: hand.bet,
    isSplit: true,
    isDoubleDown: false,
    isStand: false,
    isBust: false,
    isBlackjack: false,
  };
  
  const newHand2: BlackjackHand = {
    cards: [card2],
    bet: hand.bet,
    isSplit: true,
    isDoubleDown: false,
    isStand: false,
    isBust: false,
    isBlackjack: false,
  };
  
  // Deal one card to each split hand
  const card1New = table.state.deck.pop();
  if (card1New) {
    newHand1.cards.push(card1New);
  }
  
  const card2New = table.state.deck.pop();
  if (card2New) {
    newHand2.cards.push(card2New);
  }
  
  // Check for blackjack on split hands
  if (isBlackjack(newHand1.cards)) {
    newHand1.isBlackjack = true;
    newHand1.isStand = true;
  }
  if (isBlackjack(newHand2.cards)) {
    newHand2.isBlackjack = true;
    newHand2.isStand = true;
  }
  
  // Replace the original hand with the two split hands
  player.hands.splice(handIndex, 1, newHand1, newHand2);
  player.currentHandIndex = handIndex; // Play first split hand
  
  return { success: true };
}

// Advance to next player
function advanceToNextPlayer(table: BlackjackTable): void {
  const activePlayers = table.state.players.filter(p => p.hasPlacedBet);
  
  if (table.state.currentPlayerIndex === null) {
    table.state.currentPlayerIndex = 0;
    return;
  }
  
  // Find next player with an active hand
  let nextIndex = table.state.currentPlayerIndex;
  let found = false;
  
  for (let i = 0; i < activePlayers.length; i++) {
    nextIndex = (table.state.currentPlayerIndex + i + 1) % activePlayers.length;
    const player = activePlayers[nextIndex];
    
    // Check if player has any hands that need to be played
    for (let handIdx = 0; handIdx < player.hands.length; handIdx++) {
      const hand = player.hands[handIdx];
      if (!hand.isStand && !hand.isBust && !hand.isBlackjack) {
        table.state.currentPlayerIndex = nextIndex;
        player.currentHandIndex = handIdx;
        found = true;
        break;
      }
    }
    
    if (found) break;
  }
  
  // If no more players need to play, move to dealer turn
  if (!found) {
    table.state.gameState = 'dealer_turn';
    table.state.currentPlayerIndex = null;
    playDealerHand(table);
  }
}

// Play dealer hand (dealer must hit until 17 or higher)
function playDealerHand(table: BlackjackTable): void {
  // Dealer reveals hidden card (already dealt, just need to play)
  while (calculateHandValue(table.state.dealerHand) < BLACKJACK_CONSTANTS.DEALER_STAND_VALUE) {
    const card = table.state.deck.pop();
    if (!card) {
      table.state.deck = createDeck();
      const newCard = table.state.deck.pop();
      if (newCard) {
        table.state.dealerHand.push(newCard);
      }
    } else {
      table.state.dealerHand.push(card);
    }
  }
  
  // Move to finished state
  table.state.gameState = 'finished';
}

// Calculate payouts for all players
export function calculatePayouts(tableId: string): Map<string, number> {
  const table = tables.get(tableId);
  const payouts = new Map<string, number>();
  
  if (!table || table.state.gameState !== 'finished') {
    return payouts;
  }
  
  const dealerValue = calculateHandValue(table.state.dealerHand);
  const dealerBust = isBust(table.state.dealerHand);
  
  for (const player of table.state.players) {
    if (!player.hasPlacedBet) continue;
    
    console.log(`[Blackjack Payout] Calculating payout for player ${player.playerId}, hands: ${player.hands.length}`);
    let totalPayout = 0;
    
    for (const hand of player.hands) {
      console.log(`[Blackjack Payout] Processing hand for player ${player.playerId}:`);
      console.log(`  - hand.bet=${hand.bet} (type: ${typeof hand.bet})`);
      console.log(`  - cards=${hand.cards.length}`);
      console.log(`  - isBust=${hand.isBust}`);
      console.log(`  - isBlackjack=${hand.isBlackjack}`);
      
      // CRITICAL: Validate bet amount
      const numericBet = Number(hand.bet);
      if (isNaN(numericBet) || numericBet <= 0) {
        console.error(`[Blackjack Payout] CRITICAL ERROR: Invalid bet amount ${hand.bet} (numeric: ${numericBet}) for player ${player.playerId}!`);
        console.error(`[Blackjack Payout] Full hand object:`, JSON.stringify(hand));
        continue; // Skip this hand
      }
      
      // Validate bet is reasonable
      if (numericBet < BLACKJACK_CONSTANTS.MIN_BET) {
        console.error(`[Blackjack Payout] CRITICAL ERROR: Bet amount ${numericBet} is suspiciously low (below minimum ${BLACKJACK_CONSTANTS.MIN_BET})!`);
        console.error(`[Blackjack Payout] This suggests the bet was corrupted. Original bet should have been at least ${BLACKJACK_CONSTANTS.MIN_BET}`);
      }
      
      // Use numeric bet for all calculations
      const bet = numericBet;
      
      // CRITICAL: Recalculate hand value and bust status to ensure accuracy
      // The isBust flag might not be set correctly, so we recalculate it here
      const playerHandValue = calculateHandValue(hand.cards);
      const actuallyBust = isBust(hand.cards);
      
      console.log(`[Blackjack Payout] Hand value calculation: playerHandValue=${playerHandValue}, actuallyBust=${actuallyBust}, hand.isBust=${hand.isBust}`);
      
      // If the hand is actually bust (value > 21), treat it as a loss regardless of the flag
      if (actuallyBust || hand.isBust) {
        // Player loses - bet already deducted, no payout (net loss = -bet)
        console.log(`[Blackjack Payout] *** PLAYER BUST (LOSS) ***`);
        console.log(`[Blackjack Payout] Hand value ${playerHandValue} > 21, player loses`);
        console.log(`[Blackjack Payout] Bet was ${bet}, payout=0 (bet already deducted, no return)`);
        totalPayout = 0; // Use assignment, not +=
      } else if (hand.isBlackjack && !table.state.dealerHasBlackjack) {
        // Player blackjack pays 3:2
        // Return bet + win (bet * 1.5) = bet * 2.5 total
        const blackjackWin = Math.floor(bet * BLACKJACK_CONSTANTS.BLACKJACK_PAYOUT);
        const blackjackPayout = bet + blackjackWin;
        console.log(`[Blackjack Payout] Player blackjack: bet=${bet}, win=${blackjackWin}, total payout=${blackjackPayout} (should be ${bet * 2.5})`);
        if (blackjackPayout !== Math.floor(bet * 2.5)) {
          console.error(`[Blackjack Payout] CRITICAL ERROR: Blackjack payout wrong! Expected ${Math.floor(bet * 2.5)}, got ${blackjackPayout}`);
        }
        totalPayout = blackjackPayout; // Use assignment, not +=
      } else if (table.state.dealerHasBlackjack) {
        // Dealer blackjack beats all (except player blackjack which is handled above)
        if (!hand.isBlackjack) {
          // Player loses - bet already deducted, no payout (net loss = -bet)
          console.log(`[Blackjack Payout] *** PLAYER LOSS (DEALER BLACKJACK) ***`);
          console.log(`[Blackjack Payout] Dealer has blackjack, player loses`);
          totalPayout = 0; // Use assignment, not +=
        } else {
          // Push (both have blackjack) - return bet only
          console.log(`[Blackjack Payout] *** PUSH (BOTH BLACKJACK) ***`);
          totalPayout = bet; // Use assignment, not +=
        }
      } else if (dealerBust) {
        // Dealer busts, player wins
        // Return bet + win = bet * 2
        const winPayout = bet + bet;
        console.log(`[Blackjack Payout] *** PLAYER WIN (DEALER BUST) ***`);
        console.log(`[Blackjack Payout] Dealer bust - Player win: bet=${bet}, payout=${winPayout} (bet return + win, should be ${bet * 2})`);
        if (winPayout !== bet * 2) {
          console.error(`[Blackjack Payout] CRITICAL ERROR: Win payout wrong! Expected ${bet * 2}, got ${winPayout}`);
        }
        totalPayout = winPayout; // Use assignment, not +=
      } else {
        // Compare player value vs dealer value
        // Use the already-calculated playerHandValue from above (or recalculate if not set)
        const playerValue = playerHandValue || calculateHandValue(hand.cards);
        console.log(`[Blackjack Payout] Comparing values: player=${playerValue}, dealer=${dealerValue}, dealerBust=${dealerBust}`);
        console.log(`[Blackjack Payout] Player cards:`, hand.cards.map(c => `${c.rank}${c.suit}`).join(', '));
        console.log(`[Blackjack Payout] Dealer cards:`, table.state.dealerHand.map(c => `${c.rank}${c.suit}`).join(', '));
        
        // CRITICAL: Double-check that player is not bust before comparing
        // This is a safety check in case the isBust flag wasn't set correctly
        if (playerValue > 21) {
          console.error(`[Blackjack Payout] CRITICAL ERROR: Player hand value ${playerValue} > 21 but not marked as bust!`);
          console.error(`[Blackjack Payout] Treating as bust - no payout`);
          totalPayout += 0;
        } else {
          // CRITICAL: Ensure we're comparing numbers, not strings or other types
          const playerVal = Number(playerValue);
          const dealerVal = Number(dealerValue);
          
          console.log(`[Blackjack Payout] Type-checked comparison: player=${playerVal} (type: ${typeof playerVal}), dealer=${dealerVal} (type: ${typeof dealerVal}), dealerBust=${dealerBust}`);
          
          if (isNaN(playerVal) || isNaN(dealerVal)) {
            console.error(`[Blackjack Payout] CRITICAL ERROR: Invalid hand values! player=${playerVal}, dealer=${dealerVal}`);
            totalPayout = 0; // Default to loss if values are invalid
          } else if (dealerBust) {
            // Dealer busted - player wins (unless player also busted, which is already handled above)
            // Return bet + win = bet * 2
            const winPayout = bet + bet;
            console.log(`[Blackjack Payout] *** PLAYER WIN (DEALER BUST) ***`);
            console.log(`[Blackjack Payout] Dealer busted with ${dealerVal}, player wins with ${playerVal}`);
            console.log(`[Blackjack Payout] Payout: ${winPayout} (bet ${bet} + win ${bet})`);
            totalPayout = winPayout; // Use assignment, not +=
          } else if (playerVal > dealerVal) {
            // Player wins - return bet + win = bet * 2
            // Standard blackjack: 1:1 payout (bet returned + equal win)
            const winAmount = bet; // Win amount equals bet
            const winPayout = bet + winAmount; // Total: bet return (10k) + win (10k) = 20k for 10k bet
            console.log(`[Blackjack Payout] *** PLAYER WIN ***`);
            console.log(`[Blackjack Payout] Player win calculation:`);
            console.log(`  - bet=${bet} (from hand.bet=${hand.bet})`);
            console.log(`  - winAmount=${winAmount}`);
            console.log(`  - winPayout=${winPayout} (should be ${bet * 2})`);
            if (winPayout !== bet * 2) {
              console.error(`[Blackjack Payout] CRITICAL ERROR: Payout calculation wrong! Expected ${bet * 2}, got ${winPayout}`);
            }
            totalPayout = winPayout; // Use assignment, not +=
          } else if (playerVal < dealerVal) {
            // Player loses - bet already deducted, no payout (net loss = -bet)
            console.log(`[Blackjack Payout] *** PLAYER LOSS ***`);
            console.log(`[Blackjack Payout] Player loss: playerValue=${playerVal} < dealerValue=${dealerVal}`);
            console.log(`[Blackjack Payout] Bet was ${bet}, payout=0 (bet already deducted, no return)`);
            // CRITICAL: Explicitly set to 0, don't add anything
            totalPayout = 0; // Use assignment, not +=
            console.log(`[Blackjack Payout] Verified: totalPayout after loss = ${totalPayout}`);
          } else {
            // Push (tie) - return bet only
            console.log(`[Blackjack Payout] *** PUSH (TIE) ***`);
            console.log(`[Blackjack Payout] Push: playerValue=${playerVal} == dealerValue=${dealerVal}`);
            console.log(`[Blackjack Payout] Bet was ${bet}, returning bet only: ${bet}`);
            totalPayout = bet; // Use assignment, not +=
          }
        }
      }
    }
    
    // CRITICAL: Final validation - if player lost, payout MUST be 0
    // Check if player actually lost by recalculating hand values
    const finalPlayerValue = player.hands.length > 0 
      ? calculateHandValue(player.hands[0].cards) 
      : 0;
    const finalDealerValue = dealerValue;
    const finalDealerBust = dealerBust; // Use the already-calculated dealerBust
    const finalPlayerBust = finalPlayerValue > 21;
    
    // Get the bet amount from the first hand for validation
    const finalBet = player.hands.length > 0 ? Number(player.hands[0].bet) : 0;
    
    // If player busted, payout should be 0
    // If dealer busted, player wins (unless player also busted)
    // If neither busted and player < dealer, payout should be 0
    const playerActuallyLost = finalPlayerBust || (!finalDealerBust && !finalPlayerBust && finalPlayerValue < finalDealerValue);
    
    if (playerActuallyLost && totalPayout !== 0) {
      console.error(`[Blackjack Payout] CRITICAL ERROR: Player lost but payout is not 0!`);
      console.error(`[Blackjack Payout] Player value: ${finalPlayerValue}, Dealer value: ${finalDealerValue}, Player bust: ${finalPlayerBust}, Dealer bust: ${finalDealerBust}`);
      console.error(`[Blackjack Payout] Calculated payout: ${totalPayout}, FORCING to 0`);
      totalPayout = 0; // Force to 0 for losses
    } else if (finalDealerBust && !finalPlayerBust && finalBet > 0 && totalPayout !== finalBet * 2) {
      // If dealer busted and player didn't, payout should be bet * 2 (bet return + win)
      console.error(`[Blackjack Payout] CRITICAL ERROR: Dealer busted, player should win but payout is wrong!`);
      console.error(`[Blackjack Payout] Player value: ${finalPlayerValue}, Dealer value: ${finalDealerValue} (BUST), Expected payout: ${finalBet * 2}, Got: ${totalPayout}`);
      console.error(`[Blackjack Payout] FORCING payout to ${finalBet * 2}`);
      totalPayout = finalBet * 2; // Force to correct win payout
    }
    
    console.log(`[Blackjack Payout] Total payout for player ${player.playerId}: ${totalPayout} orbs`);
    console.log(`[Blackjack Payout] Final validation: playerValue=${finalPlayerValue}, dealerValue=${finalDealerValue}, isBust=${finalPlayerBust}, payout=${totalPayout}`);
    payouts.set(player.playerId, totalPayout);
  }
  
  return payouts;
}

// Reset table for next round
export function resetTable(tableId: string): void {
  const table = tables.get(tableId);
  if (!table) return;
  
  // Clear all player hands and bets
  for (const player of table.state.players) {
    player.hands = [];
    player.hasPlacedBet = false;
    player.currentHandIndex = 0;
  }
  
  // Reset dealer
  table.state.dealerHand = [];
  table.state.dealerHasBlackjack = false;
  
  // Reset game state
  table.state.gameState = 'waiting';
  table.state.currentPlayerIndex = null;
  table.state.deck = createDeck();
}
