import { useState, useEffect } from 'react';
import { useGameStore } from '../state/gameStore';
import { useSocket } from '../hooks/useSocket';
import { playClickSound, playCloseSound, playPurchaseSound } from '../utils/sounds';

const LOG_PRICE = 100; // Orbs per log
const AXE_PRICE = 5000; // Orbs for axe
const AXE_ITEM_ID = 'tool_axe';

export function LogDealerModal() {
  const logDealerOpen = useGameStore(state => state.logDealerOpen);
  const toggleLogDealer = useGameStore(state => state.toggleLogDealer);
  const inventory = useGameStore(state => state.inventory);
  const localPlayer = useGameStore(state => state.localPlayer);
  const playerId = useGameStore(state => state.playerId);
  const { sellLogs, purchaseItem } = useSocket();
  
  const [isSelling, setIsSelling] = useState(false);
  const [isPurchasingAxe, setIsPurchasingAxe] = useState(false);
  
  // Count logs in inventory
  const logCount = inventory.filter(item => item.itemId === 'log').length;
  const totalOrbs = logCount * LOG_PRICE;
  
  // Check if player has axe
  const hasAxe = inventory.some(item => item.itemId === AXE_ITEM_ID);
  
  useEffect(() => {
    if (!logDealerOpen) {
      setIsSelling(false);
    }
  }, [logDealerOpen]);
  
  if (!logDealerOpen) return null;
  
  const handleSellLogs = () => {
    if (logCount === 0 || isSelling) return;
    
    setIsSelling(true);
    playPurchaseSound();
    sellLogs();
    
    // Reset after a short delay
    setTimeout(() => {
      setIsSelling(false);
    }, 1000);
  };

  const handlePurchaseAxe = async () => {
    if (!playerId || !localPlayer || hasAxe || isPurchasingAxe) return;
    
    if (localPlayer.orbs < AXE_PRICE) {
      console.log('Insufficient orbs for axe');
      return;
    }
    
    setIsPurchasingAxe(true);
    playPurchaseSound();
    
    try {
      // Purchase axe using the same logic as regular shop items
      await purchaseItem(AXE_ITEM_ID);
    } catch (error) {
      console.error('Failed to purchase axe:', error);
    } finally {
      setIsPurchasingAxe(false);
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50" onClick={() => { playCloseSound(); toggleLogDealer(); }}>
      <div className="bg-gray-900 rounded-lg p-8 border-2 border-amber-500 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-pixel text-amber-400">🪵 Log Dealer</h2>
          <button
            onClick={() => { playCloseSound(); toggleLogDealer(); }}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>
        
        <div className="mb-6">
          <p className="text-gray-300 font-pixel text-sm mb-4">
            I'll buy your logs for {LOG_PRICE} orbs each.
          </p>
          
          {/* Axe Purchase Section - only show if player doesn't have axe */}
          {!hasAxe && (
            <div className="bg-gray-800 rounded-lg p-4 mb-4 border-2 border-amber-500/50">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-amber-400 font-pixel text-sm mb-1">🪓 Axe</h3>
                  <p className="text-gray-400 font-pixel text-xs">Required to cut trees</p>
                </div>
                <div className="text-cyan-300 font-pixel text-sm">● {AXE_PRICE.toLocaleString()}</div>
              </div>
              <button
                onClick={handlePurchaseAxe}
                disabled={!localPlayer || localPlayer.orbs < AXE_PRICE || isPurchasingAxe}
                className={`
                  w-full py-2 rounded font-pixel text-sm transition-all
                  ${localPlayer && localPlayer.orbs >= AXE_PRICE && !isPurchasingAxe
                    ? 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed opacity-60'
                  }
                `}
              >
                {isPurchasingAxe ? 'Purchasing...' : localPlayer && localPlayer.orbs < AXE_PRICE ? 'Not Enough Orbs' : 'Buy Axe'}
              </button>
            </div>
          )}
          
          <div className="bg-gray-800 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-300 font-pixel text-sm">Your Logs:</span>
              <span className="text-white font-pixel text-lg">{logCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-300 font-pixel text-sm">Total Value:</span>
              <span className="text-cyan-300 font-pixel text-lg">● {totalOrbs.toLocaleString()}</span>
            </div>
          </div>
          
          {localPlayer && (
            <div className="bg-gray-800 rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between">
                <span className="text-gray-300 font-pixel text-sm">Current Balance:</span>
                <span className="text-cyan-300 font-pixel text-lg">● {localPlayer.orbs.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-gray-300 font-pixel text-sm">After Sale:</span>
                <span className="text-green-300 font-pixel text-lg">● {(localPlayer.orbs + totalOrbs).toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>
        
        <button
          onClick={handleSellLogs}
          disabled={logCount === 0 || isSelling}
          className={`
            w-full py-3 rounded-lg font-pixel text-lg transition-all
            ${logCount > 0 && !isSelling
              ? 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white shadow-lg shadow-amber-500/30'
              : 'bg-gray-700 text-gray-500 cursor-not-allowed opacity-60'
            }
          `}
        >
          {isSelling ? 'Selling...' : logCount === 0 ? 'No Logs to Sell' : `Sell All Logs (${logCount})`}
        </button>
      </div>
    </div>
  );
}
