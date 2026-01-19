import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../state/gameStore';
import { useSocket } from '../hooks/useSocket';
import { playClickSound, playCloseSound, playLevelUpSound, playBlackjackLossSound } from '../utils/sounds';
import { BlackjackTableState, BlackjackPlayer, BlackjackHand, BlackjackCard, PlayerWithChat } from '../types';
import { getOrbCountColor, setDealerSpeechBubble } from '../game/renderer';
import { GAME_CONSTANTS } from '../types';

const MIN_BET = 10000;
const MAX_BET = 1000000;

// Helper function to calculate hand value (client-side)
function calculateHandValueClient(cards: BlackjackCard[]): number {
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

// Get card display text
function getCardText(card: BlackjackCard): string {
  return `${card.rank}${card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'}`;
}

// Get card color
function getCardColor(card: BlackjackCard): string {
  return card.suit === 'hearts' || card.suit === 'diamonds' ? 'text-red-500' : 'text-black';
}

// Card component with animation
function AnimatedCard({ 
  card, 
  index, 
  isHidden, 
  isAnimating,
  animationProgress 
}: { 
  card: BlackjackCard | null; 
  index: number; 
  isHidden?: boolean;
  isAnimating?: boolean;
  animationProgress?: number;
}) {
  const baseClasses = "w-16 h-24 rounded-lg border-2 flex flex-col items-center justify-center font-pixel text-sm shadow-xl transition-all duration-300";
  
  if (isAnimating && animationProgress !== undefined) {
    // Animate from dealer position (top center) to player position
    const startX = 50; // Center of table
    const startY = 20; // Dealer area
    const endX = 50;
    const endY = 80;
    const currentX = startX + (endX - startX) * animationProgress;
    const currentY = startY + (endY - startY) * animationProgress;
    const scale = 0.5 + (1 - 0.5) * animationProgress;
    const rotation = (animationProgress - 0.5) * 20; // Flip during animation
    
    return (
      <div
        className={`${baseClasses} bg-white border-gray-400 ${card ? getCardColor(card) : ''}`}
        style={{
          position: 'absolute',
          left: `${currentX}%`,
          top: `${currentY}%`,
          transform: `translate(-50%, -50%) scale(${scale}) rotate(${rotation}deg)`,
          zIndex: 1000,
          opacity: animationProgress < 0.1 ? 0 : 1,
        }}
      >
        {card && !isHidden ? (
          <>
            <span className="text-xs">{card.rank}</span>
            <span className="text-lg">{card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'}</span>
          </>
        ) : (
          <span className="text-gray-500 text-xl">?</span>
        )}
      </div>
    );
  }
  
  return (
    <div
      className={`${baseClasses} ${
        isHidden 
          ? 'bg-gray-700 border-gray-600' 
          : 'bg-white border-gray-400'
      } ${!isHidden && card ? getCardColor(card) : ''}`}
      style={{ 
        transform: `rotate(${(index - 2) * 3}deg)`,
        animation: isAnimating ? 'cardDeal 0.5s ease-out' : undefined
      }}
    >
      {isHidden ? (
        <span className="text-gray-500 text-xl">?</span>
      ) : card ? (
        <>
          <span className="text-xs">{card.rank}</span>
          <span className="text-lg">{card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'}</span>
        </>
      ) : (
        <span className="text-gray-400 text-xs">No card</span>
      )}
    </div>
  );
}

export function BlackjackModal() {
  const blackjackTableOpen = useGameStore(state => state.blackjackTableOpen);
  const selectedTableId = useGameStore(state => state.selectedTableId);
  const blackjackGameState = useGameStore(state => state.blackjackGameState);
  const localPlayer = useGameStore(state => state.localPlayer);
  const players = useGameStore(state => state.players);
  const closeBlackjackTable = useGameStore(state => state.closeBlackjackTable);
  const updateBlackjackState = useGameStore(state => state.updateBlackjackState);
  
  const { 
    joinBlackjackTable, 
    leaveBlackjackTable, 
    placeBlackjackBet, 
    blackjackHit, 
    blackjackStand, 
    blackjackDoubleDown, 
    blackjackSplit 
  } = useSocket();
  
  const [betAmount, setBetAmount] = useState(50000); // Start with minimum button value
  const [isJoining, setIsJoining] = useState(false);
  const [lastPayout, setLastPayout] = useState<number | null>(null);
  const [balanceBeforeRound, setBalanceBeforeRound] = useState<number | null>(null);
  const lastBlackjackPayoutRef = useRef<number | null>(null); // Track payout from server events
  
  // Session stats - track since joining the table
  const [sessionStartingBalance, setSessionStartingBalance] = useState<number | null>(null);
  const [sessionProfitLoss, setSessionProfitLoss] = useState<number>(0);
  const [sessionLastWin, setSessionLastWin] = useState<number | null>(null);
  const sessionBlackjackChangesRef = useRef<number>(0); // Track cumulative blackjack balance changes (excludes idle rewards)
  const previousCardCountsRef = useRef<Map<string, { dealer: number; players: Map<string, number> }>>(new Map());
  const [cardAnimations, setCardAnimations] = useState<Map<string, { progress: number; startTime: number }>>(new Map());
  const previousBustStatesRef = useRef<Map<string, boolean>>(new Map()); // Track previous bust state for each hand (key: playerId-handIndex)
  
  useEffect(() => {
    if (blackjackTableOpen && selectedTableId) {
      setIsJoining(true);
      console.log('[BlackjackModal] Joining table:', selectedTableId);
      
      // Initialize session stats when joining table
      if (localPlayer?.orbs !== undefined) {
        setSessionStartingBalance(localPlayer.orbs);
        setSessionProfitLoss(0);
        setSessionLastWin(null);
        sessionBlackjackChangesRef.current = 0; // Reset cumulative blackjack changes
        console.log('[BlackjackModal] Session stats initialized - starting balance:', localPlayer.orbs);
      }
      
      joinBlackjackTable(selectedTableId);
      const timeout = setTimeout(() => {
        setIsJoining(false);
      }, 2000);
      
      return () => {
        clearTimeout(timeout);
        if (selectedTableId) {
          leaveBlackjackTable(selectedTableId);
        }
        // Reset session stats when leaving
        setSessionStartingBalance(null);
        setSessionProfitLoss(0);
        setSessionLastWin(null);
        sessionBlackjackChangesRef.current = 0;
      };
    }
  }, [blackjackTableOpen, selectedTableId]);
  
  useEffect(() => {
    if (blackjackGameState) {
      setIsJoining(false);
    }
  }, [blackjackGameState]);
  
  // Track card changes and trigger animations
  useEffect(() => {
    if (!blackjackGameState) return;
    
    const tableId = selectedTableId || '';
    const currentDealerCount = blackjackGameState.dealerHand.length;
    const currentPlayerCounts = new Map<string, number>();
    
    blackjackGameState.players.forEach(player => {
      const handIndex = player.currentHandIndex || 0;
      const hand = player.hands && player.hands[handIndex];
      if (hand && hand.cards) {
        currentPlayerCounts.set(player.playerId, hand.cards.length);
      } else {
        currentPlayerCounts.set(player.playerId, 0);
      }
    });
    
    const previous = previousCardCountsRef.current.get(tableId);
    
    if (previous) {
      // Check for new dealer cards
      if (currentDealerCount > previous.dealer) {
        for (let i = previous.dealer; i < currentDealerCount; i++) {
          const cardId = `dealer-${i}`;
          setCardAnimations(prev => {
            const newMap = new Map(prev);
            newMap.set(cardId, { progress: 0, startTime: Date.now() });
            return newMap;
          });
        }
      }
      
      // Check for new player cards
      blackjackGameState.players.forEach(player => {
        const currentCount = currentPlayerCounts.get(player.playerId) || 0;
        const previousCount = previous.players.get(player.playerId) || 0;
        
        if (currentCount > previousCount) {
          for (let i = previousCount; i < currentCount; i++) {
            const cardId = `${player.playerId}-${i}`;
            setCardAnimations(prev => {
              const newMap = new Map(prev);
              newMap.set(cardId, { progress: 0, startTime: Date.now() });
              return newMap;
            });
          }
        }
      });
    }
    
    // Update previous counts
    previousCardCountsRef.current.set(tableId, {
      dealer: currentDealerCount,
      players: currentPlayerCounts
    });
  }, [blackjackGameState, selectedTableId]);
  
  // Animate cards
  useEffect(() => {
    if (cardAnimations.size === 0) return;
    
    const animate = () => {
      const now = Date.now();
      const duration = 500; // 500ms animation
      
      setCardAnimations(prev => {
        const newMap = new Map();
        let hasActive = false;
        
        prev.forEach((anim, cardId) => {
          const elapsed = now - anim.startTime;
          const progress = Math.min(1, elapsed / duration);
          
          if (progress < 1) {
            newMap.set(cardId, { progress, startTime: anim.startTime });
            hasActive = true;
          }
        });
        
        return hasActive ? newMap : new Map();
      });
      
      if (cardAnimations.size > 0) {
        requestAnimationFrame(animate);
      }
    };
    
    const frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [cardAnimations]);
  
  // Track game state transitions and listen for payout events from server
  const previousGameStateRef = useRef<string | null>(null);
  
  // Listen for payout events from server (avoids including idle rewards)
  useEffect(() => {
    const handlePayout = (event: CustomEvent<{ payout: number; playerId: string }>) => {
      if (event.detail.playerId === localPlayer?.id) {
        console.log('[BlackjackModal] Received payout from server:', event.detail.payout);
        // Only show payout if it's positive (win) or negative (bet deduction)
        // 0 payouts (losses) are not sent by server, so we don't show anything
        if (event.detail.payout !== 0) {
          setLastPayout(event.detail.payout);
          lastBlackjackPayoutRef.current = event.detail.payout; // Track that we received a payout
          
          // Update session last win if payout is positive
          if (event.detail.payout > 0) {
            setSessionLastWin(event.detail.payout);
            // Play win sound
            playLevelUpSound();
          }
          
          setTimeout(() => {
            setLastPayout(null);
            lastBlackjackPayoutRef.current = null;
          }, 5000);
        }
      }
    };
    
    window.addEventListener('blackjack_payout', handlePayout as EventListener);
    return () => {
      window.removeEventListener('blackjack_payout', handlePayout as EventListener);
    };
  }, [localPlayer?.id]);
  
  // Listen for blackjack balance changes and update session P/L
  useEffect(() => {
    const handleBlackjackBalanceChange = (event: CustomEvent<{ rewardAmount: number; playerId: string }>) => {
      if (event.detail.playerId === localPlayer?.id && sessionStartingBalance !== null) {
        // Accumulate blackjack-related balance changes (bets and payouts)
        sessionBlackjackChangesRef.current += event.detail.rewardAmount;
        setSessionProfitLoss(sessionBlackjackChangesRef.current);
        console.log('[BlackjackModal] Session P/L updated:', {
          change: event.detail.rewardAmount,
          cumulative: sessionBlackjackChangesRef.current
        });
      }
    };
    
    window.addEventListener('blackjack_balance_change', handleBlackjackBalanceChange as EventListener);
    return () => {
      window.removeEventListener('blackjack_balance_change', handleBlackjackBalanceChange as EventListener);
    };
  }, [localPlayer?.id, sessionStartingBalance]);
  
  useEffect(() => {
    if (localPlayer && blackjackGameState) {
      const currentPlayer = blackjackGameState.players.find(p => p.playerId === localPlayer.id);
      const currentGameState = blackjackGameState.gameState;
      const previousGameState = previousGameStateRef.current;
      
      // Store balance when bet is placed (for reference, but we use server payout now)
      if (currentPlayer?.hasPlacedBet && balanceBeforeRound === null) {
        setBalanceBeforeRound(localPlayer.orbs);
        console.log('[BlackjackModal] Stored balance after bet:', localPlayer.orbs);
      }
      
      // Detect when a hand becomes bust (play sound immediately)
      if (currentPlayer) {
        currentPlayer.hands.forEach((hand, handIndex) => {
          const handKey = `${currentPlayer.playerId}-${handIndex}`;
          const previousBustState = previousBustStatesRef.current.get(handKey) || false;
          const currentBustState = hand.isBust || false;
          
          // If hand just became bust, play loss sound
          if (!previousBustState && currentBustState) {
            playBlackjackLossSound();
            console.log('[BlackjackModal] Hand busted - playing loss sound', { handIndex, handValue: calculateHandValueClient(hand.cards) });
          }
          
          // Update previous bust state
          previousBustStatesRef.current.set(handKey, currentBustState);
        });
      }
      
      // Detect when round finishes and player lost (not by busting)
      // This happens when: gameState becomes 'finished', player didn't bust, but dealer won
      if (currentGameState === 'finished' && previousGameState !== 'finished' && currentPlayer) {
        const dealerValue = calculateHandValueClient(blackjackGameState.dealerHand);
        const dealerBust = dealerValue > 21;
        const dealerHasBlackjack = blackjackGameState.dealerHasBlackjack;
        
        // Check each hand to see if player lost (not by busting)
        currentPlayer.hands.forEach((hand, handIndex) => {
          const handValue = calculateHandValueClient(hand.cards);
          const isBust = handValue > 21;
          const isBlackjack = hand.isBlackjack;
          
          // Player lost if:
          // 1. Dealer has blackjack and player doesn't (and player didn't bust)
          // 2. Dealer didn't bust and player value < dealer value (and player didn't bust)
          const lostByStanding = !isBust && (
            (dealerHasBlackjack && !isBlackjack) ||
            (!dealerBust && !isBlackjack && handValue < dealerValue)
          );
          
          if (lostByStanding) {
            playBlackjackLossSound();
            console.log('[BlackjackModal] Lost by standing - playing loss sound', { 
              handIndex, 
              handValue, 
              dealerValue, 
              dealerBust, 
              dealerHasBlackjack 
            });
          }
        });
      }
      
      // Reset bust state tracking when round resets
      if (currentGameState === 'waiting' || (currentGameState === 'betting' && !currentPlayer?.hasPlacedBet)) {
        previousBustStatesRef.current.clear();
      }
      
      // Reset when new round starts
      if (currentGameState === 'waiting' || (currentGameState === 'betting' && !currentPlayer?.hasPlacedBet)) {
        setBalanceBeforeRound(null);
        setLastPayout(null);
        lastBlackjackPayoutRef.current = null;
      }
      
      // Detect when round finishes and set dealer speech bubbles
      if (currentGameState === 'finished' && previousGameState !== 'finished' && selectedTableId) {
        // Extract table number from tableId (e.g., "blackjack_table_1" -> 1)
        const tableNumber = selectedTableId.replace('blackjack_table_', '');
        const dealerId = `blackjack_dealer_${tableNumber}`;
        
        // Check if any players won or lost
        const dealerValue = calculateHandValueClient(blackjackGameState.dealerHand);
        const dealerBust = dealerValue > 21;
        const dealerHasBlackjack = blackjackGameState.dealerHasBlackjack;
        
        let hasWinners = false;
        let hasLosers = false;
        
        for (const player of blackjackGameState.players) {
          if (!player.hasPlacedBet) continue;
          
          for (const hand of player.hands) {
            const handValue = calculateHandValueClient(hand.cards);
            const isBust = handValue > 21;
            const isBlackjack = hand.isBlackjack;
            
            // Player busts = loss
            if (isBust) {
              hasLosers = true;
            }
            // Player blackjack beats dealer (unless dealer also has blackjack, which is a push)
            else if (isBlackjack && !dealerHasBlackjack) {
              hasWinners = true;
            }
            // Dealer busts = all non-bust players win
            else if (dealerBust && !isBust) {
              hasWinners = true;
            }
            // Compare values (only if neither busted and neither has blackjack)
            else if (!dealerBust && !isBust && !isBlackjack && !dealerHasBlackjack) {
              if (handValue > dealerValue) {
                hasWinners = true;
              } else if (handValue < dealerValue) {
                hasLosers = true;
              }
              // If handValue === dealerValue, it's a push (neither wins nor loses)
            }
            // If dealer has blackjack and player doesn't, player loses (unless player also has blackjack, which is handled above)
            else if (dealerHasBlackjack && !isBlackjack && !isBust) {
              hasLosers = true;
            }
          }
        }
        
        // Set dealer speech bubble based on results
        if (hasWinners && !hasLosers) {
          // All players won
          const messages = [
            'Congratulations, winners!',
            'Well played!',
            'Great hands!',
            'You beat the house!',
            'Excellent!'
          ];
          const message = messages[Math.floor(Math.random() * messages.length)];
          setDealerSpeechBubble(dealerId, message);
        } else if (hasLosers && !hasWinners) {
          // All players lost
          const messages = [
            'Better luck next time!',
            'The house always wins!',
            'Try again!',
            'Don\'t give up!',
            'Next round could be yours!'
          ];
          const message = messages[Math.floor(Math.random() * messages.length)];
          setDealerSpeechBubble(dealerId, message);
        } else if (hasWinners && hasLosers) {
          // Mixed results
          const messages = [
            'Some winners, some losers!',
            'Mixed results this round!',
            'Good luck next time!',
            'The house takes some, gives some!'
          ];
          const message = messages[Math.floor(Math.random() * messages.length)];
          setDealerSpeechBubble(dealerId, message);
        } else {
          // Push (ties) or no players
          const messages = [
            'Push! Try again!',
            'Tie game!',
            'No winners this round!'
          ];
          const message = messages[Math.floor(Math.random() * messages.length)];
          setDealerSpeechBubble(dealerId, message);
        }
      }
      
      // Update previous game state
      previousGameStateRef.current = currentGameState;
    }
  }, [blackjackGameState?.gameState, blackjackGameState?.players, localPlayer?.orbs, balanceBeforeRound]);
  
  // Force re-render when balance changes
  useEffect(() => {
    // This effect ensures the modal updates when localPlayer.orbs changes
    // The balance display will automatically update via the localPlayer dependency
  }, [localPlayer?.orbs]);
  
  // Player sprite rendering removed - was causing glitches
  
  if (!blackjackTableOpen) return null;
  
  const currentPlayer = blackjackGameState?.players.find(p => p.playerId === localPlayer?.id);
  const currentHand = currentPlayer?.hands[currentPlayer.currentHandIndex || 0];
  const dealerValue = blackjackGameState ? calculateHandValueClient(blackjackGameState.dealerHand) : 0;
  
  const canHit = blackjackGameState?.gameState === 'playing' && 
    currentPlayer && 
    blackjackGameState.currentPlayerIndex === blackjackGameState.players.indexOf(currentPlayer) &&
    currentHand && 
    !currentHand.isBust && 
    !currentHand.isStand && 
    !currentHand.isBlackjack;
  
  const canStand = canHit;
  const canDoubleDown = canHit && currentHand.cards.length === 2 && !currentHand.isDoubleDown;
  const canSplit = canHit && currentHand.cards.length === 2 && 
    currentHand.cards[0].value === currentHand.cards[1].value &&
    (localPlayer?.orbs || 0) >= currentHand.bet;
  
  const balanceColorInfo = localPlayer ? getOrbCountColor(localPlayer.orbs) : null;
  
  const handleBet = () => {
    if (!selectedTableId || betAmount < MIN_BET || betAmount > MAX_BET) return;
    console.log('[BlackjackModal] Placing bet:', {
      tableId: selectedTableId,
      betAmount: betAmount,
      betAmountType: typeof betAmount,
      minBet: MIN_BET,
      maxBet: MAX_BET,
      currentBalance: localPlayer?.orbs
    });
    playClickSound();
    placeBlackjackBet(selectedTableId, betAmount);
  };
  
  const handleHit = () => {
    if (!canHit || !currentHand) {
      console.log('[BlackjackModal] Cannot hit - canHit:', canHit, 'currentHand:', currentHand);
      return;
    }
    console.log('[BlackjackModal] Hitting - tableId:', selectedTableId, 'handIndex:', currentPlayer?.currentHandIndex || 0);
    playClickSound();
    blackjackHit(selectedTableId, currentPlayer?.currentHandIndex || 0);
  };
  
  const handleStand = () => {
    if (!canStand || !currentHand) {
      console.log('[BlackjackModal] Cannot stand - canStand:', canStand, 'currentHand:', currentHand);
      return;
    }
    console.log('[BlackjackModal] Standing - tableId:', selectedTableId, 'handIndex:', currentPlayer?.currentHandIndex || 0);
    playClickSound();
    blackjackStand(selectedTableId, currentPlayer?.currentHandIndex || 0);
  };
  
  const handleDoubleDown = () => {
    if (!canDoubleDown || !currentHand) {
      console.log('[BlackjackModal] Cannot double down - canDoubleDown:', canDoubleDown, 'currentHand:', currentHand);
      return;
    }
    console.log('[BlackjackModal] Double down - tableId:', selectedTableId, 'handIndex:', currentPlayer?.currentHandIndex || 0);
    playClickSound();
    blackjackDoubleDown(selectedTableId, currentPlayer?.currentHandIndex || 0);
  };
  
  const handleSplit = () => {
    if (!canSplit || !currentHand) return;
    playClickSound();
    blackjackSplit(selectedTableId, currentPlayer?.currentHandIndex || 0);
  };
  
  const handleLeave = () => {
    playCloseSound();
    if (selectedTableId) {
      leaveBlackjackTable(selectedTableId);
    }
    closeBlackjackTable();
  };
  
  return (
    <div 
      className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none"
      onClick={handleLeave}
    >
      <style>{`
        @keyframes cardDeal {
          0% {
            transform: translateY(-200px) scale(0.5) rotate(180deg);
            opacity: 0;
          }
          100% {
            transform: translateY(0) scale(1) rotate(0deg);
            opacity: 1;
          }
        }
        @keyframes cardFlip {
          0% { transform: rotateY(0deg); }
          50% { transform: rotateY(90deg); }
          100% { transform: rotateY(0deg); }
        }
      `}</style>
      
      <div className="bg-gray-900 rounded-lg p-4 border-2 border-amber-500 max-w-[1200px] w-full mx-2 max-h-[95vh] overflow-y-auto overflow-x-hidden pointer-events-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-pixel text-amber-400">🃏 Blackjack Table {selectedTableId?.replace('blackjack_table_', '')}</h2>
          <div className="flex items-center gap-4">
            {localPlayer && balanceColorInfo && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 font-pixel text-sm">Balance:</span>
                  <span className="font-pixel text-lg font-bold" style={{ color: balanceColorInfo.color }}>
                    {localPlayer.orbs.toLocaleString()} <span className="text-cyan-400 text-sm">orbs</span>
                  </span>
                </div>
                {sessionStartingBalance !== null && (
                  <div className="flex items-center gap-3 text-xs">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-400 font-pixel">Session P/L:</span>
                      <span className={`font-pixel font-bold ${
                        sessionProfitLoss > 0 ? 'text-green-400' : 
                        sessionProfitLoss < 0 ? 'text-red-400' : 
                        'text-gray-400'
                      }`}>
                        {sessionProfitLoss >= 0 ? '+' : ''}{sessionProfitLoss.toLocaleString()}
                      </span>
                    </div>
                    {sessionLastWin !== null && (
                      <div className="flex items-center gap-1">
                        <span className="text-gray-400 font-pixel">Last Win:</span>
                        <span className="font-pixel font-bold text-green-400">
                          +{sessionLastWin.toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <button
              onClick={handleLeave}
              className="text-gray-400 hover:text-white transition-colors text-xl"
            >
              ✕
            </button>
          </div>
        </div>
        
        {(!blackjackGameState && isJoining) ? (
          <div className="text-center py-8">
            <p className="text-gray-300 font-pixel">Joining table...</p>
          </div>
        ) : !blackjackGameState ? (
          <div className="text-center py-8">
            <p className="text-red-400 font-pixel mb-2">Failed to join table.</p>
            <button
              onClick={() => {
                setIsJoining(true);
                joinBlackjackTable(selectedTableId);
              }}
              className="mt-4 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded font-pixel"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Table Layout - Proper Perspective */}
            <div className="relative bg-gradient-to-b from-green-900 to-green-800 rounded-lg p-4 border-4 border-amber-600" style={{ minHeight: '500px', height: '55vh' }}>
              
              {/* Dealer Section - Top (Opposite Side) */}
              <div className="absolute top-2 left-1/2 transform -translate-x-1/2 text-center w-full">
                <div className="inline-block bg-gray-800 rounded-lg px-6 py-3 mb-4 border-2 border-gray-600">
                  <h3 className="text-xl font-pixel text-amber-300">Dealer</h3>
                  {(blackjackGameState.gameState === 'finished' || blackjackGameState.gameState === 'dealer_turn') && (
                    <p className="text-gray-300 font-pixel text-sm mt-1">
                      Value: {dealerValue} {blackjackGameState.dealerHasBlackjack && '(Blackjack!)'}
                    </p>
                  )}
                </div>
                
                {/* Dealer Cards */}
                <div className="flex justify-center gap-3 flex-wrap">
                  {blackjackGameState.dealerHand.map((card, idx) => {
                    const isHidden = (blackjackGameState.gameState === 'playing' || blackjackGameState.gameState === 'dealing') && idx === 0;
                    const cardId = `dealer-${idx}`;
                    const anim = cardAnimations.get(cardId);
                    const isAnimating = anim !== undefined && anim.progress < 1;
                    
                    return (
                      <AnimatedCard
                        key={idx}
                        card={card}
                        index={idx}
                        isHidden={isHidden}
                        isAnimating={isAnimating}
                        animationProgress={anim?.progress}
                      />
                    );
                  })}
                  {blackjackGameState.dealerHand.length === 0 && (
                    <div className="w-16 h-24 rounded-lg border-2 border-gray-600 bg-gray-800/50 flex items-center justify-center">
                      <span className="text-gray-500 text-xs"></span>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Players Section - Semi-Circle (Our Side) */}
              <div className="absolute bottom-0 left-0 right-0 top-0">
                <div className="relative w-full h-full">
                  {/* Player Positions - Semi-Circle */}
                  <div className="relative w-full h-full">
                    {Array.from({ length: 4 }).map((_, seatIndex) => {
                      const player = blackjackGameState.players.find(p => p.seat === seatIndex);
                      const isCurrentPlayer = player?.playerId === localPlayer?.id;
                      const playerIndex = player ? blackjackGameState.players.indexOf(player) : -1;
                      const isTheirTurn = playerIndex >= 0 && blackjackGameState.currentPlayerIndex === playerIndex;
                      const totalBet = player ? player.hands.reduce((sum, hand) => sum + hand.bet, 0) : 0;
                      const hand = player ? player.hands[player.currentHandIndex || 0] : null;
                      const handValue = hand && hand.cards.length > 0 ? calculateHandValueClient(hand.cards) : null;
                      
                      // Calculate position in semi-circle below dealer
                      // Dealer is at top center (50%, 12%), players arranged in bottom-half-of-circle arc (center lower, edges higher)
                      const totalSeats = 4;
                      const centerX = 50; // 50% from left (center)
                      const centerY = 35; // 15% from top (center of arc is lowest point, moved up to reduce space below)
                      const arcRadius = 38; // 38% of container (reduced to add padding on sides and prevent card overflow)
                      // Angles for bottom-half-of-circle: from 20° (right) to 160° (left)
                      // This creates a proper bottom-half arc where center (90°) is lowest, edges are higher
                      const arcStartAngle = 20; // 20 degrees (right, down)
                      const arcEndAngle = 160; // 160 degrees (left, down)
                      const t = seatIndex / (totalSeats - 1); // 0 to 1
                      const angleDeg = arcStartAngle + (arcEndAngle - arcStartAngle) * t;
                      const angleRad = (angleDeg * Math.PI) / 180;
                      const seatX = centerX + Math.cos(angleRad) * arcRadius;
                      const seatY = centerY + Math.sin(angleRad) * arcRadius;
                      
                      return (
                        <div
                          key={seatIndex}
                          className="absolute flex flex-col items-center"
                          style={{ 
                            left: `${seatX}%`,
                            top: `${seatY}%`,
                            transform: 'translate(-50%, -50%)',
                            width: '140px',
                            minHeight: '280px'
                          }}
                        >
                          {/* Turn Indicator - Top */}
                          {isTheirTurn && (
                            <div className="absolute -top-14 left-1/2 transform -translate-x-1/2 z-30">
                              <div className="bg-green-500 rounded-full w-10 h-10 flex items-center justify-center animate-pulse shadow-lg border-2 border-green-300">
                                <span className="text-white text-xl">👈</span>
                              </div>
                            </div>
                          )}
                          
                          {/* Bet Display - Below turn indicator */}
                          {player && totalBet > 0 && (
                            <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 z-30">
                              <div className="bg-gradient-to-b from-amber-600 to-amber-700 rounded-full px-3 py-1.5 border-2 border-amber-400 shadow-xl">
                                <span className="font-pixel text-xs text-white font-bold">
                                  {totalBet.toLocaleString()}
                                </span>
                              </div>
                            </div>
                          )}
                          
                          {/* Player Cards - Middle section */}
                          {player && hand && hand.cards.length > 0 ? (
                            <div className="absolute top-8 left-1/2 transform -translate-x-1/2 flex gap-1 justify-center z-20">
                              {hand.cards.map((card, cardIdx) => {
                                const cardId = `${player.playerId}-${cardIdx}`;
                                const anim = cardAnimations.get(cardId);
                                const isAnimating = anim !== undefined && anim.progress < 1;
                                
                                return (
                                  <AnimatedCard
                                    key={cardIdx}
                                    card={card}
                                    index={cardIdx}
                                    isAnimating={isAnimating}
                                    animationProgress={anim?.progress}
                                  />
                                );
                              })}
                            </div>
                          ) : (
                            // Show "No cards" placeholder for empty seats or players without cards
                            <div className="absolute top-8 left-1/2 transform -translate-x-1/2 flex gap-1 justify-center z-20">
                              <div className="w-16 h-24 rounded-lg border-2 border-gray-600 bg-gray-800/50 flex items-center justify-center">
                                <span className="text-gray-500 text-xs"></span>
                              </div>
                              <div className="w-16 h-24 rounded-lg border-2 border-gray-600 bg-gray-800/50 flex items-center justify-center">
                                <span className="text-gray-500 text-xs"></span>
                              </div>
                            </div>
                          )}
                          
                          {/* Hand Value - Below cards */}
                          {player && handValue !== null && (
                            <div className="absolute top-36 left-1/2 transform -translate-x-1/2 z-20">
                              <div className="bg-blue-600 rounded-full w-8 h-8 flex items-center justify-center border-2 border-blue-400 shadow-lg">
                                <span className="font-pixel text-xs text-white font-bold">{handValue}</span>
                              </div>
                            </div>
                          )}
                          
                          {/* Player Name - Above player sprite */}
                          {player ? (
                            <div className={`absolute top-48 left-1/2 transform -translate-x-1/2 px-3 py-1.5 rounded text-xs font-pixel border-2 shadow-lg z-30 ${
                              isCurrentPlayer 
                                ? 'bg-amber-500 text-white border-amber-400' 
                                : isTheirTurn 
                                  ? 'bg-green-500 text-white border-green-400' 
                                  : 'bg-gray-800 text-gray-300 border-gray-600'
                            }`}>
                              {player.playerName} {isCurrentPlayer && '(You)'}
                            </div>
                          ) : (
                            <div className="absolute top-48 left-1/2 transform -translate-x-1/2 px-3 py-1.5 rounded text-xs font-pixel bg-gray-800/50 text-gray-600 border border-dashed border-gray-700 z-30">
                              Seat {seatIndex + 1}
                            </div>
                          )}
                          
                          {/* Player Sprite Area - Below nameplate */}
                          <div className="absolute top-56 left-1/2 transform -translate-x-1/2 w-16 h-20 z-10">
                            {/* Player sprite rendered on canvas at this position */}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Action Buttons */}
            {currentPlayer && (
              <div className="bg-gray-800 rounded-lg p-4 border-2 border-gray-700">
                <h3 className="text-lg font-pixel text-amber-300 mb-4">Your Actions</h3>
                
                {blackjackGameState.gameState === 'waiting' || blackjackGameState.gameState === 'betting' ? (
                  <div>
                    {!currentPlayer.hasPlacedBet ? (
                      <div className="space-y-3">
                        <label className="block text-gray-300 font-pixel text-sm text-center">
                          Select Bet Amount
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                          {[50000, 100000, 250000, 500000, 750000, 1000000].map((amount) => {
                            const isSelected = betAmount === amount;
                            const canAfford = (localPlayer?.orbs || 0) >= amount;
                            return (
                              <button
                                key={amount}
                                onClick={() => setBetAmount(amount)}
                                disabled={!canAfford}
                                className={`px-4 py-2 rounded font-pixel text-sm border-2 transition-all ${
                                  isSelected
                                    ? 'bg-amber-600 text-white border-amber-400 shadow-lg scale-105'
                                    : canAfford
                                      ? 'bg-gray-700 text-gray-200 border-gray-600 hover:bg-gray-600 hover:border-gray-500'
                                      : 'bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed opacity-50'
                                }`}
                              >
                                {amount >= 1000000 
                                  ? `${(amount / 1000000).toFixed(0)}M`
                                  : amount >= 1000
                                    ? `${(amount / 1000).toFixed(0)}k`
                                    : amount.toLocaleString()}
                              </button>
                            );
                          })}
                        </div>
                        <button
                          onClick={handleBet}
                          disabled={betAmount < MIN_BET || betAmount > MAX_BET || betAmount > (localPlayer?.orbs || 0)}
                          className="w-full px-6 py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded font-pixel text-lg"
                        >
                          Place Bet ({betAmount.toLocaleString()} orbs)
                        </button>
                      </div>
                    ) : (
                      <p className="text-gray-300 font-pixel">Waiting for other players to place bets...</p>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {canHit && (
                      <button
                        onClick={handleHit}
                        className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded font-pixel text-lg"
                      >
                        Hit
                      </button>
                    )}
                    {canStand && (
                      <button
                        onClick={handleStand}
                        className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded font-pixel text-lg"
                      >
                        Stand
                      </button>
                    )}
                    {canDoubleDown && (
                      <button
                        onClick={handleDoubleDown}
                        className="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded font-pixel text-lg"
                      >
                        Double Down
                      </button>
                    )}
                    {/* Split button hidden for now - will add proper logic later */}
                    {false && canSplit && (
                      <button
                        onClick={handleSplit}
                        className="px-6 py-3 bg-yellow-600 hover:bg-yellow-500 text-white rounded font-pixel text-lg"
                      >
                        Split
                      </button>
                    )}
                    {!canHit && !canStand && (
                      <p className="text-gray-400 font-pixel">Waiting for your turn or round to finish...</p>
                    )}
                  </div>
                )}
              </div>
            )}
            
            {/* Payout Display */}
            {lastPayout !== null && (
              <div className={`p-4 rounded-lg border-2 font-pixel text-center ${
                lastPayout > 0 
                  ? 'bg-green-900/50 border-green-500 text-green-300' 
                  : lastPayout < 0 
                    ? 'bg-red-900/50 border-red-500 text-red-300' 
                    : 'bg-gray-800 border-gray-600 text-gray-300'
              }`}>
                {lastPayout > 0 && <p className="text-xl">🎉 You won {lastPayout.toLocaleString()} orbs!</p>}
                {lastPayout < 0 && <p className="text-xl">You lost {Math.abs(lastPayout).toLocaleString()} orbs</p>}
                {lastPayout === 0 && <p className="text-xl">Push - Bet returned</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
