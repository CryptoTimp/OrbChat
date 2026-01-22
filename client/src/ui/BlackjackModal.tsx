import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../state/gameStore';
import { useSocket } from '../hooks/useSocket';
import { playClickSound, playCloseSound, playLevelUpSound, playBlackjackLossSound } from '../utils/sounds';
import { BlackjackTableState, BlackjackPlayer, BlackjackHand, BlackjackCard, PlayerWithChat } from '../types';
import { getOrbCountColor, setDealerSpeechBubble } from '../game/renderer';
import { GAME_CONSTANTS } from '../types';

// Red particle effect for max bet (1M)
function MaxBetParticleEffect() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const particlesRef = useRef<Array<{x: number; y: number; vx: number; vy: number; life: number; size: number; color: string}>>([]);
  const timeRef = useRef(0);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Set canvas size
    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    
    // Initialize particles
    const initParticles = () => {
      particlesRef.current = [];
      for (let i = 0; i < 30; i++) {
        particlesRef.current.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2,
          life: Math.random(),
          size: Math.random() * 3 + 2,
          color: ['#ff0000', '#ff3333', '#ff6666', '#ff9999', '#ffcccc'][Math.floor(Math.random() * 5)]
        });
      }
    };
    initParticles();
    
    const animate = () => {
      timeRef.current += 0.02;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Update and draw particles
      particlesRef.current.forEach((p, i) => {
        // Update position
        p.x += p.vx;
        p.y += p.vy;
        
        // Wrap around edges
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        
        // Update life for pulsing effect
        p.life += 0.03;
        if (p.life > 1) p.life = 0;
        
        // Calculate alpha with pulsing
        const pulse = Math.sin(p.life * Math.PI * 2) * 0.5 + 0.5;
        const alpha = 0.3 + pulse * 0.5;
        
        // Draw particle with glow
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        
        // Inner bright core
        ctx.globalAlpha = alpha * 0.8;
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.4, 0, Math.PI * 2);
        ctx.fill();
      });
      
      // Draw gradient overlay
      const gradient = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, 0,
        canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) / 2
      );
      gradient.addColorStop(0, 'rgba(255, 0, 0, 0.2)');
      gradient.addColorStop(0.5, 'rgba(255, 50, 50, 0.1)');
      gradient.addColorStop(1, 'rgba(255, 0, 0, 0)');
      
      ctx.globalAlpha = 0.3 + Math.sin(timeRef.current) * 0.2;
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      
      animationRef.current = requestAnimationFrame(animate);
    };
    
    animate();
    
    return () => {
      window.removeEventListener('resize', resize);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);
  
  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none rounded-full"
      style={{ zIndex: -1 }}
    />
  );
}

// Galactic background component with animated stars and nebula
function GalacticBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const starsRef = useRef<Array<{x: number; y: number; size: number; brightness: number; speed: number}>>([]);
  const timeRef = useRef(0);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Set canvas size
    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    
    // Initialize stars
    if (starsRef.current.length === 0) {
      for (let i = 0; i < 150; i++) {
        starsRef.current.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: Math.random() * 2 + 0.5,
          brightness: Math.random(),
          speed: Math.random() * 0.3 + 0.1
        });
      }
    }
    
    const animate = () => {
      timeRef.current += 0.01;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw nebula clouds
      const gradient1 = ctx.createRadialGradient(
        canvas.width * 0.3, canvas.height * 0.2, 0,
        canvas.width * 0.3, canvas.height * 0.2, canvas.width * 0.5
      );
      gradient1.addColorStop(0, 'rgba(147, 51, 234, 0.15)');
      gradient1.addColorStop(1, 'rgba(147, 51, 234, 0)');
      ctx.fillStyle = gradient1;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      const gradient2 = ctx.createRadialGradient(
        canvas.width * 0.7, canvas.height * 0.8, 0,
        canvas.width * 0.7, canvas.height * 0.8, canvas.width * 0.4
      );
      gradient2.addColorStop(0, 'rgba(79, 70, 229, 0.15)');
      gradient2.addColorStop(1, 'rgba(79, 70, 229, 0)');
      ctx.fillStyle = gradient2;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw animated stars
      starsRef.current.forEach(star => {
        star.brightness += star.speed * 0.01;
        if (star.brightness > 1) star.brightness = 0;
        
        const alpha = 0.3 + Math.sin(star.brightness * Math.PI * 2) * 0.5;
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
        ctx.shadowBlur = 3;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();
      });
      
      // Draw twinkling particles
      for (let i = 0; i < 20; i++) {
        const x = (Math.sin(timeRef.current + i) * 0.5 + 0.5) * canvas.width;
        const y = (Math.cos(timeRef.current * 0.7 + i) * 0.5 + 0.5) * canvas.height;
        const size = Math.sin(timeRef.current * 2 + i) * 1.5 + 2;
        const alpha = Math.sin(timeRef.current * 3 + i) * 0.3 + 0.4;
        
        const colors = ['#9400d3', '#4169e1', '#00ced1', '#ff69b4'];
        const color = colors[i % colors.length];
        
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        ctx.shadowColor = color;
        ctx.shadowBlur = 5;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      
      animationRef.current = requestAnimationFrame(animate);
    };
    
    animate();
    
    return () => {
      window.removeEventListener('resize', resize);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);
  
  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}

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

// Get card color - always white for visibility on galactic background
function getCardColor(card: BlackjackCard): string {
  return 'text-white';
}

// Card component with animation and particle effects
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
  const [particles, setParticles] = useState<Array<{x: number; y: number; vx: number; vy: number; life: number; size: number; color: string}>>([]);
  const particleRef = useRef<number>();
  
  // Particle effect for cards
  useEffect(() => {
    if (!card || isHidden) {
      setParticles([]);
      if (particleRef.current) {
        cancelAnimationFrame(particleRef.current);
      }
      return;
    }
    
    const animate = () => {
      setParticles(prev => {
        const now = Date.now();
        const newParticles = prev.map(p => ({
          ...p,
          x: p.x + p.vx,
          y: p.y + p.vy,
          life: p.life - 0.015,
          size: p.size * 0.99
        })).filter(p => p.life > 0 && p.size > 0);
        
        // Spawn new particles occasionally
        if (Math.random() < 0.1) {
          const galacticColors = ['#ffffff', '#9400d3', '#4169e1', '#00ced1', '#ff69b4', '#9370db'];
          newParticles.push({
            x: 50 + (Math.random() - 0.5) * 20,
            y: 50 + (Math.random() - 0.5) * 20,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5,
            life: 1.0,
            size: Math.random() * 2 + 1,
            color: galacticColors[Math.floor(Math.random() * galacticColors.length)]
          });
        }
        
        return newParticles;
      });
      
      particleRef.current = requestAnimationFrame(animate);
    };
    
    particleRef.current = requestAnimationFrame(animate);
    return () => {
      if (particleRef.current) {
        cancelAnimationFrame(particleRef.current);
      }
    };
  }, [card, isHidden]);
  
  const baseClasses = "w-16 h-24 rounded-lg border-2 flex flex-col items-center justify-center font-pixel text-sm shadow-xl transition-all duration-300 relative overflow-visible";
  
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
        className={`${baseClasses} bg-gradient-to-br from-slate-900 via-purple-900 to-indigo-900 border-purple-400 ${card ? getCardColor(card) : ''}`}
        style={{
          position: 'absolute',
          left: `${currentX}%`,
          top: `${currentY}%`,
          transform: `translate(-50%, -50%) scale(${scale}) rotate(${rotation}deg)`,
          zIndex: 1000,
          opacity: animationProgress < 0.1 ? 0 : 1,
          boxShadow: '0 0 20px rgba(147, 51, 234, 0.5), 0 0 40px rgba(79, 70, 229, 0.3)',
        }}
      >
        {card && !isHidden ? (
          <>
            <span className="text-xs text-white relative z-10 font-bold">{card.rank}</span>
            <span className="text-lg text-white relative z-10 font-bold">{card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'}</span>
          </>
        ) : (
          <span className="text-purple-200 text-xl">?</span>
        )}
      </div>
    );
  }
  
  return (
    <div
      className={`${baseClasses} ${
        isHidden 
          ? 'bg-gradient-to-br from-slate-800 via-purple-800 to-indigo-800 border-purple-500' 
          : 'bg-gradient-to-br from-slate-900 via-purple-900 to-indigo-900 border-purple-400'
      } ${!isHidden && card ? getCardColor(card) : ''}`}
      style={{ 
        transform: `rotate(${(index - 2) * 3}deg)`,
        animation: isAnimating ? 'cardDeal 0.5s ease-out' : undefined,
        boxShadow: !isHidden && card ? '0 0 15px rgba(147, 51, 234, 0.4), 0 0 30px rgba(79, 70, 229, 0.2)' : undefined,
      }}
    >
      {/* Particle effects */}
      {particles.map((p, i) => (
        <div
          key={i}
          className="absolute rounded-full pointer-events-none"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            backgroundColor: p.color,
            opacity: p.life,
            transform: 'translate(-50%, -50%)',
            boxShadow: `0 0 ${p.size * 2}px ${p.color}`,
          }}
        />
      ))}
      
      {isHidden ? (
        <span className="text-purple-200 text-xl relative z-10">?</span>
      ) : card ? (
        <>
          <span className="text-xs text-white relative z-10 font-bold">{card.rank}</span>
          <span className="text-lg text-white relative z-10 font-bold">{card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'}</span>
        </>
      ) : (
        <span className="text-purple-300 text-xs">No card</span>
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
  
  // Drag state for modal
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [modalPosition, setModalPosition] = useState({ x: 0, y: 0 });
  const modalRef = useRef<HTMLDivElement>(null);
  
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
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = 'none'; // Prevent text selection during drag
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
    };
  }, [isDragging, dragOffset]);
  
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
      
      <div 
        ref={modalRef}
        className="bg-gradient-to-br from-slate-900 via-purple-900 to-indigo-900 rounded-lg p-4 border-2 border-purple-400 max-w-[1200px] w-full mx-2 max-h-[95vh] overflow-y-auto overflow-x-hidden pointer-events-auto shadow-2xl" 
        style={{ 
          boxShadow: '0 0 50px rgba(147, 51, 234, 0.5)',
          transform: modalPosition.x !== 0 || modalPosition.y !== 0 
            ? `translate(calc(50% + ${modalPosition.x}px), calc(50% + ${modalPosition.y}px))` 
            : undefined,
          cursor: isDragging ? 'grabbing' : 'default',
        }} 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - draggable */}
        <div 
          className="flex items-center justify-between mb-4 cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
        >
          <h2 className="text-2xl font-pixel text-purple-200" style={{ textShadow: '0 0 10px rgba(147, 51, 234, 0.8)' }}> Blackjack Table {selectedTableId?.replace('blackjack_table_', '')}</h2>
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
            <p className="text-purple-200 font-pixel" style={{ textShadow: '0 0 10px rgba(147, 51, 234, 0.8)' }}>Joining table...</p>
          </div>
        ) : !blackjackGameState ? (
          <div className="text-center py-8">
            <p className="text-red-300 font-pixel mb-2" style={{ textShadow: '0 0 10px rgba(239, 68, 68, 0.8)' }}>Failed to join table.</p>
            <button
              onClick={() => {
                setIsJoining(true);
                joinBlackjackTable(selectedTableId);
              }}
              className="mt-4 px-4 py-2 bg-gradient-to-br from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded font-pixel shadow-lg transition-all"
              style={{ boxShadow: '0 0 15px rgba(147, 51, 234, 0.5)' }}
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Table Layout - Galactic Theme */}
            <div 
              className="relative rounded-lg p-4 border-4 border-purple-400 overflow-hidden" 
              style={{ 
                minHeight: '500px', 
                height: '55vh',
                background: 'radial-gradient(ellipse at center, #1a0a2e 0%, #0d0520 50%, #000000 100%)',
                boxShadow: 'inset 0 0 100px rgba(147, 51, 234, 0.3), 0 0 50px rgba(79, 70, 229, 0.5)',
                position: 'relative',
              }}
            >
              {/* Galactic background with stars */}
              <GalacticBackground />
              
              {/* Dealer Section - Top (Opposite Side) */}
              <div className="absolute top-2 left-1/2 transform -translate-x-1/2 text-center w-full z-10">
                <div className="inline-block bg-gradient-to-br from-purple-900/80 to-indigo-900/80 backdrop-blur-sm rounded-lg px-6 py-3 mb-4 border-2 border-purple-400 shadow-lg" style={{ boxShadow: '0 0 20px rgba(147, 51, 234, 0.5)' }}>
                  <h3 className="text-xl font-pixel text-purple-200" style={{ textShadow: '0 0 10px rgba(147, 51, 234, 0.8)' }}>Dealer</h3>
                  {(blackjackGameState.gameState === 'finished' || blackjackGameState.gameState === 'dealer_turn') && (
                    <p className="text-purple-200 font-pixel text-sm mt-1">
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
                    <div className="w-16 h-24 rounded-lg border-2 border-purple-500 bg-gradient-to-br from-slate-800/50 via-purple-800/50 to-indigo-800/50 flex items-center justify-center">
                      <span className="text-purple-300 text-xs"></span>
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
                              <div className="bg-purple-500 rounded-full w-10 h-10 flex items-center justify-center animate-pulse shadow-lg border-2 border-purple-300" style={{ boxShadow: '0 0 20px rgba(147, 51, 234, 0.8)' }}>
                                <span className="text-white text-xl">👈</span>
                              </div>
                            </div>
                          )}
                          
                          {/* Bet Display - Below turn indicator */}
                          {player && totalBet > 0 && (
                            <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 z-30">
                              <div 
                                className={`rounded-full px-3 py-1.5 border-2 shadow-xl relative overflow-hidden ${
                                  totalBet >= 1000000 
                                    ? 'bg-gradient-to-b from-red-600 to-red-800 border-red-400' 
                                    : 'bg-gradient-to-b from-purple-600 to-indigo-700 border-purple-400'
                                }`} 
                                style={{ 
                                  boxShadow: totalBet >= 1000000 
                                    ? '0 0 20px rgba(255, 0, 0, 0.8), 0 0 40px rgba(255, 50, 50, 0.5)' 
                                    : '0 0 15px rgba(147, 51, 234, 0.6)',
                                  width: 'fit-content',
                                  minWidth: '80px',
                                  height: '32px'
                                }}
                              >
                                {totalBet >= 1000000 && <MaxBetParticleEffect />}
                                <span className="font-pixel text-xs text-white font-bold relative z-10">
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
                              <div className="w-16 h-24 rounded-lg border-2 border-purple-500 bg-gradient-to-br from-slate-800/50 via-purple-800/50 to-indigo-800/50 flex items-center justify-center">
                                <span className="text-purple-300 text-xs"></span>
                              </div>
                              <div className="w-16 h-24 rounded-lg border-2 border-purple-500 bg-gradient-to-br from-slate-800/50 via-purple-800/50 to-indigo-800/50 flex items-center justify-center">
                                <span className="text-purple-300 text-xs"></span>
                              </div>
                            </div>
                          )}
                          
                          {/* Hand Value - Below cards */}
                          {player && handValue !== null && (
                            <div className="absolute top-36 left-1/2 transform -translate-x-1/2 z-20">
                              <div className="bg-gradient-to-br from-cyan-600 to-blue-600 rounded-full w-8 h-8 flex items-center justify-center border-2 border-cyan-400 shadow-lg" style={{ boxShadow: '0 0 15px rgba(6, 182, 212, 0.6)' }}>
                                <span className="font-pixel text-xs text-white font-bold">{handValue}</span>
                              </div>
                            </div>
                          )}
                          
                          {/* Player Name - Above player sprite */}
                          {player ? (
                            <div className={`absolute top-48 left-1/2 transform -translate-x-1/2 px-3 py-1.5 rounded text-xs font-pixel border-2 shadow-lg z-30 ${
                              isCurrentPlayer 
                                ? 'bg-gradient-to-br from-purple-600 to-indigo-600 text-white border-purple-400' 
                                : isTheirTurn 
                                  ? 'bg-gradient-to-br from-cyan-600 to-blue-600 text-white border-cyan-400' 
                                  : 'bg-gradient-to-br from-slate-800/80 to-purple-900/80 text-purple-200 border-purple-600'
                            }`} style={isCurrentPlayer || isTheirTurn ? { boxShadow: '0 0 15px rgba(147, 51, 234, 0.6)' } : {}}>
                              {player.playerName} {isCurrentPlayer && '(You)'}
                            </div>
                          ) : (
                            <div className="absolute top-48 left-1/2 transform -translate-x-1/2 px-3 py-1.5 rounded text-xs font-pixel bg-slate-800/50 text-purple-400 border border-dashed border-purple-600 z-30">
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
              <div className="bg-gradient-to-br from-slate-800/90 via-purple-900/90 to-indigo-900/90 backdrop-blur-sm rounded-lg p-4 border-2 border-purple-500 shadow-lg" style={{ boxShadow: '0 0 20px rgba(147, 51, 234, 0.4)' }}>
                <h3 className="text-lg font-pixel text-purple-200 mb-4" style={{ textShadow: '0 0 10px rgba(147, 51, 234, 0.8)' }}>Your Actions</h3>
                
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
                                    ? 'bg-gradient-to-br from-purple-600 to-indigo-600 text-white border-purple-400 shadow-lg scale-105'
                                    : canAfford
                                      ? 'bg-gradient-to-br from-slate-700 to-purple-800 text-purple-200 border-purple-600 hover:bg-gradient-to-br hover:from-purple-700 hover:to-indigo-700 hover:border-purple-400'
                                      : 'bg-slate-800 text-purple-500 border-purple-700 cursor-not-allowed opacity-50'
                                }`}
                                style={isSelected ? { boxShadow: '0 0 15px rgba(147, 51, 234, 0.6)' } : {}}
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
                          className="w-full px-6 py-3 bg-gradient-to-br from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded font-pixel text-lg transition-all shadow-lg"
                          style={{ boxShadow: '0 0 20px rgba(147, 51, 234, 0.5)' }}
                        >
                          Place Bet ({betAmount.toLocaleString()} orbs)
                        </button>
                      </div>
                    ) : (
                      <p className="text-purple-200 font-pixel">Waiting for other players to place bets...</p>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {canHit && (
                      <button
                        onClick={handleHit}
                        className="px-6 py-3 bg-gradient-to-br from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded font-pixel text-lg shadow-lg transition-all"
                        style={{ boxShadow: '0 0 15px rgba(6, 182, 212, 0.5)' }}
                      >
                        Hit
                      </button>
                    )}
                    {canStand && (
                      <button
                        onClick={handleStand}
                        className="px-6 py-3 bg-gradient-to-br from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded font-pixel text-lg shadow-lg transition-all"
                        style={{ boxShadow: '0 0 15px rgba(79, 70, 229, 0.5)' }}
                      >
                        Stand
                      </button>
                    )}
                    {canDoubleDown && (
                      <button
                        onClick={handleDoubleDown}
                        className="px-6 py-3 bg-gradient-to-br from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded font-pixel text-lg shadow-lg transition-all"
                        style={{ boxShadow: '0 0 15px rgba(147, 51, 234, 0.5)' }}
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
                      <p className="text-purple-300 font-pixel">Waiting for your turn or round to finish...</p>
                    )}
                  </div>
                )}
              </div>
            )}
            
            {/* Payout Display */}
            {lastPayout !== null && (
              <div className={`p-4 rounded-lg border-2 font-pixel text-center backdrop-blur-sm ${
                lastPayout > 0 
                  ? 'bg-gradient-to-br from-cyan-900/70 to-blue-900/70 border-cyan-400 text-cyan-200' 
                  : lastPayout < 0 
                    ? 'bg-gradient-to-br from-red-900/70 to-pink-900/70 border-red-400 text-red-200' 
                    : 'bg-gradient-to-br from-slate-800/70 to-purple-900/70 border-purple-500 text-purple-200'
              }`} style={lastPayout > 0 ? { boxShadow: '0 0 20px rgba(6, 182, 212, 0.5)' } : lastPayout < 0 ? { boxShadow: '0 0 20px rgba(239, 68, 68, 0.5)' } : { boxShadow: '0 0 20px rgba(147, 51, 234, 0.4)' }}>
                {lastPayout > 0 && <p className="text-xl" style={{ textShadow: '0 0 10px rgba(6, 182, 212, 0.8)' }}>🎉 You won {lastPayout.toLocaleString()} orbs!</p>}
                {lastPayout < 0 && <p className="text-xl" style={{ textShadow: '0 0 10px rgba(239, 68, 68, 0.8)' }}>You lost {Math.abs(lastPayout).toLocaleString()} orbs</p>}
                {lastPayout === 0 && <p className="text-xl" style={{ textShadow: '0 0 10px rgba(147, 51, 234, 0.8)' }}>Push - Bet returned</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
