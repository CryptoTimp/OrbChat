// Trade state management

interface TradeOffer {
  items: Array<{ itemId: string; quantity: number }>;
  orbs: number;
}

interface Trade {
  player1Id: string;
  player2Id: string;
  player1Offer: TradeOffer;
  player2Offer: TradeOffer;
  player1Accepted: boolean;
  player2Accepted: boolean;
  createdAt: number;
}

const activeTrades: Map<string, Trade> = new Map(); // Key: player1Id_player2Id (sorted)

function getTradeKey(player1Id: string, player2Id: string): string {
  // Always use sorted order for consistent key
  const [p1, p2] = [player1Id, player2Id].sort();
  return `${p1}_${p2}`;
}

export function createTrade(player1Id: string, player2Id: string): Trade | null {
  const key = getTradeKey(player1Id, player2Id);
  
  // Check if trade already exists
  if (activeTrades.has(key)) {
    return null; // Trade already exists
  }
  
  const trade: Trade = {
    player1Id,
    player2Id,
    player1Offer: { items: [], orbs: 0 },
    player2Offer: { items: [], orbs: 0 },
    player1Accepted: false,
    player2Accepted: false,
    createdAt: Date.now(),
  };
  
  activeTrades.set(key, trade);
  return trade;
}

export function getTrade(player1Id: string, player2Id: string): Trade | null {
  const key = getTradeKey(player1Id, player2Id);
  return activeTrades.get(key) || null;
}

export function updateTradeOffer(
  playerId: string,
  otherPlayerId: string,
  items: Array<{ itemId: string; quantity: number }>,
  orbs: number
): boolean {
  const trade = getTrade(playerId, otherPlayerId);
  if (!trade) return false;
  
  // Reset accept states when offer changes
  if (trade.player1Id === playerId) {
    trade.player1Offer = { items, orbs };
    trade.player1Accepted = false;
    trade.player2Accepted = false; // Reset other player's accept too
  } else if (trade.player2Id === playerId) {
    trade.player2Offer = { items, orbs };
    trade.player2Accepted = false;
    trade.player1Accepted = false; // Reset other player's accept too
  } else {
    return false;
  }
  
  return true;
}

export function acceptTrade(playerId: string, otherPlayerId: string): boolean {
  const trade = getTrade(playerId, otherPlayerId);
  if (!trade) return false;
  
  if (trade.player1Id === playerId) {
    trade.player1Accepted = true;
  } else if (trade.player2Id === playerId) {
    trade.player2Accepted = true;
  } else {
    return false;
  }
  
  return true;
}

export function cancelTrade(playerId: string, otherPlayerId: string): boolean {
  const key = getTradeKey(playerId, otherPlayerId);
  return activeTrades.delete(key);
}

export function isTradeReady(player1Id: string, player2Id: string): boolean {
  const trade = getTrade(player1Id, player2Id);
  if (!trade) return false;
  return trade.player1Accepted && trade.player2Accepted;
}

export function getTradeForPlayer(playerId: string): Trade | null {
  for (const trade of activeTrades.values()) {
    if (trade.player1Id === playerId || trade.player2Id === playerId) {
      return trade;
    }
  }
  return null;
}

export function getOtherPlayerId(trade: Trade, playerId: string): string {
  return trade.player1Id === playerId ? trade.player2Id : trade.player1Id;
}

export function getPlayerOffer(trade: Trade, playerId: string): TradeOffer {
  return trade.player1Id === playerId ? trade.player1Offer : trade.player2Offer;
}

export function getOtherPlayerOffer(trade: Trade, playerId: string): TradeOffer {
  return trade.player1Id === playerId ? trade.player2Offer : trade.player1Offer;
}

export function isPlayerAccepted(trade: Trade, playerId: string): boolean {
  return trade.player1Id === playerId ? trade.player1Accepted : trade.player2Accepted;
}

export function completeTrade(player1Id: string, player2Id: string): Trade | null {
  const trade = getTrade(player1Id, player2Id);
  if (!trade) return null;
  
  // Remove trade
  const key = getTradeKey(player1Id, player2Id);
  activeTrades.delete(key);
  
  return trade;
}
