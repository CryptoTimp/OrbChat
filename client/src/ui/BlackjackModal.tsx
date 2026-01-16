import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../state/gameStore';
import { useSocket } from '../hooks/useSocket';
import { playClickSound, playCloseSound, playPurchaseSound } from '../utils/sounds';
import { BlackjackTableState, BlackjackPlayer, BlackjackHand, BlackjackCard, PlayerWithChat } from '../types';
import { getOrbCountColor, drawPlayer } from '../game/renderer';
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
  
  const [betAmount, setBetAmount] = useState(MIN_BET);
  const [isJoining, setIsJoining] = useState(false);
  const [lastPayout, setLastPayout] = useState<number | null>(null);
  const [balanceBeforeRound, setBalanceBeforeRound] = useState<number | null>(null);
  const lastBlackjackPayoutRef = useRef<number | null>(null); // Track payout from server events
  const playerCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const previousCardCountsRef = useRef<Map<string, { dealer: number; players: Map<string, number> }>>(new Map());
  const [cardAnimations, setCardAnimations] = useState<Map<string, { progress: number; startTime: number }>>(new Map());
  
  useEffect(() => {
    if (blackjackTableOpen && selectedTableId) {
      setIsJoining(true);
      console.log('[BlackjackModal] Joining table:', selectedTableId);
      joinBlackjackTable(selectedTableId);
      const timeout = setTimeout(() => {
        setIsJoining(false);
      }, 2000);
      
      return () => {
        clearTimeout(timeout);
        if (selectedTableId) {
          leaveBlackjackTable(selectedTableId);
        }
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
          setTimeout(() => {
            setLastPayout(null);
          }, 5000);
        }
      }
    };
    
    window.addEventListener('blackjack_payout', handlePayout as EventListener);
    return () => {
      window.removeEventListener('blackjack_payout', handlePayout as EventListener);
    };
  }, [localPlayer?.id]);
  
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
      
      // Reset when new round starts
      if (currentGameState === 'waiting' || (currentGameState === 'betting' && !currentPlayer?.hasPlacedBet)) {
        setBalanceBeforeRound(null);
        setLastPayout(null);
        lastBlackjackPayoutRef.current = null;
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
  
  // Render player sprites at table seats
  useEffect(() => {
    if (!playerCanvasRef.current || !blackjackGameState) return;
    
    const canvas = playerCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const updateCanvasSize = () => {
      const container = canvas.parentElement;
      if (container) {
        const rect = container.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
    };
    
    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    
    let lastRenderTime = Date.now();
    let isRendering = true;
    
    const renderPlayers = () => {
      if (!isRendering || !ctx) {
        animationFrameRef.current = null;
        return;
      }
      
      // Get fresh state on each render to avoid stale closures
      const currentGameState = useGameStore.getState().blackjackGameState;
      const currentPlayers = useGameStore.getState().players;
      const currentLocalPlayer = useGameStore.getState().localPlayer;
      
      if (!currentGameState) {
        animationFrameRef.current = requestAnimationFrame(renderPlayers);
        return;
      }
      
      const now = Date.now();
      const deltaTime = now - lastRenderTime;
      lastRenderTime = now;
      
      // Throttle rendering to prevent spam - only render every 200ms
      if (deltaTime < 200) {
        animationFrameRef.current = requestAnimationFrame(renderPlayers);
        return;
      }
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      
      const currentTime = Date.now();
      const { SCALE, PLAYER_WIDTH, PLAYER_HEIGHT } = GAME_CONSTANTS;
      
      // Render players aligned with their seat positions
      // Seats are arranged in a horizontal row, evenly spaced
      const totalSeats = 7;
      const tableWidth = canvas.width;
      const seatWidth = tableWidth / totalSeats;
      
      // Render each seat position
      for (let seatIndex = 0; seatIndex < totalSeats; seatIndex++) {
        const player = currentGameState.players.find(p => p.seat === seatIndex);
        if (!player) continue;
        
        // Try to get player from store, but create a fallback if not found
        let actualPlayer = Array.from(currentPlayers.values()).find(p => p.id === player.playerId);
        
        // If player not in store yet, create a minimal player object from blackjack state
        if (!actualPlayer) {
          // Use localPlayer if it's the current player, otherwise create a basic player object
          if (player.playerId === currentLocalPlayer?.id && currentLocalPlayer) {
            actualPlayer = currentLocalPlayer;
          } else {
            // Create a minimal player object for rendering
            actualPlayer = {
              id: player.playerId,
              name: player.playerName,
              x: 0,
              y: 0,
              direction: 'up' as const,
              sprite: {
                body: 'default',
                outfit: [],
              },
              orbs: 0,
              roomId: '',
            };
          }
        }
        
        // Calculate seat position to match the HTML layout
        // Position player ABOVE the nameplate (which is at top-40 = ~160px from top of container)
        const seatX = (seatIndex + 0.5) * seatWidth;
        const seatY = canvas.height * 0.55; // Position above nameplate, visible on table
        
        const playerToRender: PlayerWithChat = {
          ...actualPlayer,
          x: seatX / SCALE - PLAYER_WIDTH / 2,
          y: seatY / SCALE - PLAYER_HEIGHT / 2,
          direction: 'up' as const,
        };
        
        ctx.save();
        try {
          // Use a fixed time to prevent animation spam
          drawPlayer(ctx, playerToRender, player.playerId === currentLocalPlayer?.id, currentTime, true);
        } catch (error) {
          console.error(`[BlackjackModal] Error drawing player ${player.playerName}:`, error);
        }
        ctx.restore();
      }
      
      if (isRendering) {
        animationFrameRef.current = requestAnimationFrame(renderPlayers);
      } else {
        animationFrameRef.current = null;
      }
    };
    
    renderPlayers();
    
    return () => {
      isRendering = false;
      window.removeEventListener('resize', updateCanvasSize);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [blackjackGameState, localPlayer?.id]); // Removed 'players' from dependencies to prevent unnecessary re-renders
  
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
    playPurchaseSound();
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
    playPurchaseSound();
    blackjackDoubleDown(selectedTableId, currentPlayer?.currentHandIndex || 0);
  };
  
  const handleSplit = () => {
    if (!canSplit || !currentHand) return;
    playPurchaseSound();
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
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
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
      
      <div className="bg-gray-900 rounded-lg p-4 border-2 border-amber-500 max-w-[95vw] w-full mx-2 max-h-[95vh] overflow-y-auto overflow-x-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-pixel text-amber-400">🃏 Blackjack Table {selectedTableId?.replace('blackjack_table_', '')}</h2>
          <div className="flex items-center gap-4">
            {localPlayer && balanceColorInfo && (
              <div className="flex items-center gap-2">
                <span className="text-gray-400 font-pixel text-sm">Balance:</span>
                <span className="font-pixel text-lg font-bold" style={{ color: balanceColorInfo.color }}>
                  {localPlayer.orbs.toLocaleString()} <span className="text-cyan-400 text-sm">orbs</span>
                </span>
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
            <div className="relative bg-gradient-to-b from-green-900 to-green-800 rounded-lg p-4 border-4 border-amber-600" style={{ minHeight: '450px', maxHeight: '55vh' }}>
              
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
                      <span className="text-gray-500 text-xs">No cards</span>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Players Section - Bottom Row (Our Side) */}
              <div className="absolute bottom-2 left-0 right-0">
                <div className="relative" style={{ height: '220px' }}>
                  {/* Canvas for player sprites - behind nameplates */}
                  <canvas
                    ref={playerCanvasRef}
                    className="absolute inset-0 pointer-events-none z-0"
                    style={{ imageRendering: 'pixelated' }}
                  />
                  
                  {/* Player Positions - Horizontal Row */}
                  <div className="relative flex justify-around items-end" style={{ height: '100%', paddingTop: '100px' }}>
                    {Array.from({ length: 7 }).map((_, seatIndex) => {
                      const player = blackjackGameState.players.find(p => p.seat === seatIndex);
                      const isCurrentPlayer = player?.playerId === localPlayer?.id;
                      const playerIndex = player ? blackjackGameState.players.indexOf(player) : -1;
                      const isTheirTurn = playerIndex >= 0 && blackjackGameState.currentPlayerIndex === playerIndex;
                      const totalBet = player ? player.hands.reduce((sum, hand) => sum + hand.bet, 0) : 0;
                      const hand = player ? player.hands[player.currentHandIndex || 0] : null;
                      const handValue = hand && hand.cards.length > 0 ? calculateHandValueClient(hand.cards) : null;
                      
                      return (
                        <div
                          key={seatIndex}
                          className="relative flex flex-col items-center"
                          style={{ width: '140px', minHeight: '280px' }}
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
                          {player && hand && hand.cards.length > 0 && (
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
                      <div className="space-y-4">
                        <div>
                          <label className="block text-gray-300 font-pixel text-sm mb-2">
                            Bet Amount (Min: {MIN_BET.toLocaleString()}, Max: {MAX_BET.toLocaleString()})
                          </label>
                          <input
                            type="number"
                            min={MIN_BET}
                            max={MAX_BET}
                            value={betAmount}
                            onChange={(e) => setBetAmount(Math.max(MIN_BET, Math.min(MAX_BET, parseInt(e.target.value) || MIN_BET)))}
                            className="w-full px-4 py-2 bg-gray-700 text-white rounded font-pixel border-2 border-gray-600"
                          />
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
                    {canSplit && (
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
