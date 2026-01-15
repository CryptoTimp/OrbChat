import { useState, useEffect } from 'react';
import { useGameStore } from '../state/gameStore';
import { useSocket } from '../hooks/useSocket';
import { playClickSound, playCloseSound, playPurchaseSound } from '../utils/sounds';
import { getOrbCountColor } from '../game/renderer';

const LOG_PRICE = 100; // Orbs per log

export function LogDealerModal() {
  const logDealerOpen = useGameStore(state => state.logDealerOpen);
  const toggleLogDealer = useGameStore(state => state.toggleLogDealer);
  const inventory = useGameStore(state => state.inventory);
  const localPlayer = useGameStore(state => state.localPlayer);
  const shopItems = useGameStore(state => state.shopItems);
  const { sellLogs } = useSocket();
  
  const [isSelling, setIsSelling] = useState(false);
  
  // Count logs in inventory
  const logCount = inventory.filter(item => item.itemId === 'log').length;
  const baseOrbs = logCount * LOG_PRICE;
  
  // Calculate orb multiplier from equipped items
  let orbMultiplier = 1.0;
  if (localPlayer?.sprite?.outfit) {
    for (const itemId of localPlayer.sprite.outfit) {
      const item = shopItems.find(s => s.id === itemId);
      if (item?.orbMultiplier && isFinite(item.orbMultiplier)) {
        orbMultiplier = Math.min(3.0, Math.max(orbMultiplier, item.orbMultiplier));
      }
    }
  }
  
  const totalOrbs = Math.floor(baseOrbs * orbMultiplier);
  
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
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50" onClick={() => { playCloseSound(); toggleLogDealer(); }}>
      <div className="bg-gray-900 rounded-lg p-8 border-2 border-amber-500 max-w-lg w-full mx-4" onClick={(e) => e.stopPropagation()}>
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
          
          <div className="bg-gray-800 rounded-lg p-5 mb-4">
            <div className="text-center mb-3">
              <div className="text-gray-400 font-pixel text-xs mb-1">You'll Receive</div>
              <div className="text-cyan-300 font-pixel text-3xl font-bold">
                {totalOrbs.toLocaleString()} <span className="text-cyan-400 text-xl">orbs</span>
              </div>
            </div>
            
            <div className="border-t border-gray-700 pt-3 mt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-400 font-pixel text-xs">Logs:</span>
                <span className="text-white font-pixel text-sm">{logCount}</span>
              </div>
              {orbMultiplier > 1.0 && (
                <div className="flex items-center justify-between">
                  <span className="text-yellow-400 font-pixel text-xs">Boost Applied:</span>
                  <span className="text-yellow-400 font-pixel text-xs">+{Math.round((orbMultiplier - 1) * 100)}%</span>
                </div>
              )}
            </div>
          </div>
          
          {localPlayer && (() => {
            const currentOrbColorInfo = getOrbCountColor(localPlayer.orbs);
            const newOrbColorInfo = getOrbCountColor(localPlayer.orbs + totalOrbs);
            return (
              <div className="bg-gray-800 rounded-lg p-4 mb-4">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 font-pixel text-xs whitespace-nowrap">Current:</span>
                  <span className="font-pixel text-sm flex items-center" style={{ color: currentOrbColorInfo.color }}>
                    <span className="inline-block mr-1">●</span>
                    <span>{localPlayer.orbs.toLocaleString()}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-gray-400 font-pixel text-xs whitespace-nowrap">New:</span>
                  <span className="font-pixel text-sm flex items-center" style={{ color: newOrbColorInfo.color }}>
                    <span className="inline-block mr-1">●</span>
                    <span>{(localPlayer.orbs + totalOrbs).toLocaleString()}</span>
                  </span>
                </div>
              </div>
            );
          })()}
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
          {isSelling ? 'Selling...' : logCount === 0 ? 'No Logs to Sell' : `Sell for ${totalOrbs.toLocaleString()} orbs`}
        </button>
      </div>
    </div>
  );
}