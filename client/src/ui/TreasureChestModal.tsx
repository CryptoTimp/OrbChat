import { useState, useEffect } from 'react';
import { useGameStore } from '../state/gameStore';
import { useSocket } from '../hooks/useSocket';
import { playClickSound, playCloseSound, playChestOpenSound, playChestRewardSound, playChestEmptySound } from '../utils/sounds';

export function TreasureChestModal() {
  const treasureChestModalOpen = useGameStore(state => state.treasureChestModalOpen);
  const selectedTreasureChest = useGameStore(state => state.selectedTreasureChest);
  const toggleTreasureChestModal = useGameStore(state => state.toggleTreasureChestModal);
  const setSelectedTreasureChest = useGameStore(state => state.setSelectedTreasureChest);
  
  const [isOpening, setIsOpening] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [coinsFound, setCoinsFound] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  
  // Always call useSocket hook before any early returns (Rules of Hooks)
  const { socket } = useSocket();
  
  // Listen for treasure chest opened event to get coins found (always listen)
  useEffect(() => {
    const handleTreasureChestOpened = (event: Event) => {
      const customEvent = event as CustomEvent<{ coinsFound?: number }>;
      console.log('[TreasureChestModal] Received treasureChestOpened event:', customEvent.detail);
      if (customEvent.detail && customEvent.detail.coinsFound !== undefined) {
        const found = customEvent.detail.coinsFound;
        console.log('[TreasureChestModal] Setting coinsFound to:', found);
        setCoinsFound(found);
        
        // Note: Sound is now played for all players via the socket event handler
        // No need to play it here again to avoid duplicate sounds
        
        // Show result after a short delay to allow animation to play
        setTimeout(() => {
          setShowResult(true);
        }, 1000);
      }
    };
    
    // Always listen for the event (even when modal is closed, in case it fires before modal opens)
    window.addEventListener('treasureChestOpened', handleTreasureChestOpened);
    
    return () => {
      window.removeEventListener('treasureChestOpened', handleTreasureChestOpened);
    };
  }, []);
  
  useEffect(() => {
    if (treasureChestModalOpen && selectedTreasureChest) {
      // Prevent modal from closing if chest is selected
      // Reset state when modal opens (but preserve coinsFound if already set)
      setIsOpening(true);
      setIsOpen(false);
      setShowResult(false);
      
      // Play chest opening sound immediately when modal opens
      playChestOpenSound();
      
      // Check if coins were already set (from event that fired before modal opened)
      // We'll keep the coinsFound value if it was already set
      if (coinsFound === null) {
        // Check global fallback
        const lastCoins = (window as any).__lastTreasureChestCoins;
        if (lastCoins !== undefined) {
          setCoinsFound(lastCoins);
          delete (window as any).__lastTreasureChestCoins;
        }
      }
      
      // Start opening animation
      const openTimeout = setTimeout(() => {
        setIsOpen(true);
      }, 500);
      
      // Show result after animation completes (fallback if event hasn't fired yet)
      const resultTimeout = setTimeout(() => {
        setIsOpening(false);
        // Only set to 0 if coinsFound is still null (event hasn't fired)
        setCoinsFound(prev => {
          if (prev === null) {
            // Play empty sound if we're falling back to empty
            playChestEmptySound();
            return 0; // Empty as fallback
          }
          return prev; // Keep existing value
        });
        setShowResult(true);
      }, 1500);
      
      // Cleanup timeouts if component unmounts or modal closes
      return () => {
        clearTimeout(openTimeout);
        clearTimeout(resultTimeout);
      };
    } else {
      // Reset when modal closes
      setIsOpening(false);
      setIsOpen(false);
      setCoinsFound(null);
      setShowResult(false);
    }
  }, [treasureChestModalOpen, selectedTreasureChest]); // Removed coinsFound from dependencies
  
  if (!treasureChestModalOpen || !selectedTreasureChest) return null;
  
  const handleClose = () => {
    playCloseSound();
    const chest = selectedTreasureChest;
    toggleTreasureChestModal();
    setSelectedTreasureChest(null);
    
    // Request chest relocation after closing modal
    if (chest && socket && socket.connected) {
      socket.emit('treasure_chest_relocate', { chestId: chest.id });
    }
  };
  
  const hasCoins = coinsFound !== null && coinsFound > 0;
  const isEmpty = coinsFound === 0;
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50" onClick={handleClose}>
      <div className="bg-gray-900 rounded-lg p-6 border-2 border-amber-500 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-pixel text-amber-400">💎 Treasure Chest</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white transition-colors text-xl leading-none"
          >
            ✕
          </button>
        </div>
        
        <div className="mb-4 flex flex-col items-center">
          {/* Animated chest */}
          <div className="relative mb-4" style={{ width: '128px', height: '96px' }}>
            {/* Glow effect coming out of chest when opening */}
            {isOpen && (
              <div 
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                style={{
                  animation: 'chestGlow 1.5s ease-out forwards',
                }}
              >
                <div 
                  className="absolute w-40 h-40 rounded-full opacity-0"
                  style={{
                    background: 'radial-gradient(circle, rgba(255, 215, 0, 0.8) 0%, rgba(255, 215, 0, 0.4) 30%, rgba(255, 215, 0, 0) 70%)',
                    animation: 'glowExpand 1.5s ease-out forwards',
                    transform: 'translate(-50%, -50%)',
                    top: '50%',
                    left: '50%',
                  }}
                />
                <div 
                  className="absolute w-32 h-32 rounded-full opacity-0"
                  style={{
                    background: 'radial-gradient(circle, rgba(245, 158, 11, 0.9) 0%, rgba(245, 158, 11, 0.5) 40%, rgba(245, 158, 11, 0) 80%)',
                    animation: 'glowExpand 1.2s ease-out 0.2s forwards',
                    transform: 'translate(-50%, -50%)',
                    top: '50%',
                    left: '50%',
                  }}
                />
              </div>
            )}
            
            {/* Chest container */}
            <div className="relative" style={{ width: '128px', height: '96px' }}>
              {/* Chest base */}
              <div className="absolute bottom-0 left-0 w-32 h-16 bg-amber-800 rounded-lg border-4 border-amber-900" style={{ zIndex: 1 }}>
                {/* Chest straps */}
                <div className="absolute top-2 left-2 right-2 h-0.5 bg-amber-900"></div>
                <div className="absolute bottom-2 left-2 right-2 h-0.5 bg-amber-900"></div>
                <div className="absolute top-0 bottom-0 left-8 w-0.5 bg-amber-900"></div>
                <div className="absolute top-0 bottom-0 right-8 w-0.5 bg-amber-900"></div>
              </div>
              
              {/* Chest lid - animated opening */}
              <div 
                className="absolute top-0 left-0 w-32 h-16 bg-amber-700 rounded-t-lg border-4 border-amber-900"
                style={{
                  transformOrigin: 'bottom center',
                  transform: isOpen ? 'rotateX(-120deg)' : 'rotateX(0deg)',
                  transition: 'transform 1s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  zIndex: 2,
                }}
              >
                {/* Lock */}
                <div className="absolute top-1 left-1/2 transform -translate-x-1/2 w-6 h-6 bg-yellow-400 rounded-full border-2 border-yellow-500">
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-amber-900 rounded-full"></div>
                </div>
                
                {/* Lid straps */}
                <div className="absolute top-1 left-2 right-2 h-0.5 bg-amber-900"></div>
              </div>
              
              {/* Inner glow when open */}
              {isOpen && (
                <div 
                  className="absolute bottom-2 left-1/2 transform -translate-x-1/2 w-24 h-12 rounded-lg pointer-events-none"
                  style={{
                    background: 'linear-gradient(to top, rgba(255, 215, 0, 0.6) 0%, rgba(245, 158, 11, 0.3) 50%, rgba(255, 215, 0, 0) 100%)',
                    animation: 'innerGlow 1s ease-out forwards',
                    zIndex: 0,
                  }}
                />
              )}
              
              {/* Coins reveal animation */}
              {isOpen && hasCoins && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 3 }}>
                  <div className="relative">
                    {Array.from({ length: Math.min(coinsFound || 0, 20) }).map((_, i) => (
                      <span
                        key={i}
                        className="text-2xl absolute"
                        style={{
                          left: `${50 + (Math.random() - 0.5) * 40}%`,
                          top: `${50 + (Math.random() - 0.5) * 40}%`,
                          animationDelay: `${i * 0.05}s`,
                          animation: 'coinPop 0.8s ease-out forwards',
                        }}
                      >
                        🪙
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Result message - shows below chest */}
          <div className="text-center w-full" style={{ minHeight: '100px' }}>
            {coinsFound !== null ? (
              hasCoins ? (
                <div className="space-y-2">
                  <p className="text-amber-400 font-pixel text-xl leading-tight">
                    You found {coinsFound} gold coins!
                  </p>
                  <p className="text-gray-300 font-pixel text-sm leading-tight">
                    Take them to the treasure chest dealer to sell for orbs.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-gray-400 font-pixel text-xl leading-tight">
                    The chest is empty...
                  </p>
                  <p className="text-gray-500 font-pixel text-sm leading-tight">
                    Better luck next time!
                  </p>
                </div>
              )
            ) : (
              <p className="text-gray-300 font-pixel text-lg leading-tight py-4">
                Opening chest...
              </p>
            )}
          </div>
        </div>
        
        <button
          onClick={handleClose}
          className="w-full py-2.5 rounded-lg font-pixel text-base bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white shadow-lg shadow-amber-500/30 transition-all mt-2"
        >
          Close
        </button>
      </div>
      
      <style>{`
        @keyframes coinPop {
          0% {
            opacity: 0;
            transform: scale(0) translateY(0);
          }
          50% {
            opacity: 1;
            transform: scale(1.2) translateY(-20px);
          }
          100% {
            opacity: 0.8;
            transform: scale(1) translateY(-40px);
          }
        }
        
        @keyframes glowExpand {
          0% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.5);
          }
          30% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(2);
          }
        }
        
        @keyframes innerGlow {
          0% {
            opacity: 0;
            transform: translateX(-50%) scaleY(0);
          }
          50% {
            opacity: 1;
            transform: translateX(-50%) scaleY(1);
          }
          100% {
            opacity: 0.6;
            transform: translateX(-50%) scaleY(1);
          }
        }
        
        @keyframes chestGlow {
          0% {
            opacity: 0;
          }
          50% {
            opacity: 1;
          }
          100% {
            opacity: 0.3;
          }
        }
      `}</style>
    </div>
  );
}
