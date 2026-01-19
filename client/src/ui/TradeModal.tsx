import { useState, useEffect, useMemo } from 'react';
import { useGameStore } from '../state/gameStore';
import { useSocket } from '../hooks/useSocket';
import { ShopItem, RARITY_COLORS, ItemRarity } from '../types';
import { ItemPreview } from './ItemPreview';
import { playClickSound, playCloseSound } from '../utils/sounds';

const MAX_TRADE_ITEMS = 12; // 4 rows × 3 columns

export function TradeModal() {
  const trade = useGameStore(state => state.trade);
  const { closeTrade, updateTrade } = useGameStore();
  const { 
    modifyTradeOffer, 
    acceptTrade, 
    declineTrade, 
    cancelTrade
  } = useSocket();
  const shopItems = useGameStore(state => state.shopItems);
  const inventory = useGameStore(state => state.inventory);
  const localPlayer = useGameStore(state => state.localPlayer);
  const playerId = useGameStore(state => state.playerId);
  
  const [orbInput, setOrbInput] = useState<string>('0');
  const [showInventory, setShowInventory] = useState<boolean>(true); // Open by default
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRarity, setSelectedRarity] = useState<ItemRarity | 'all'>('all');

  // Reset orb input when trade opens/closes
  useEffect(() => {
    if (!trade.isOpen) {
      setOrbInput('0');
      setShowInventory(true); // Keep open by default
      setSearchQuery('');
      setSelectedRarity('all');
    } else {
      setOrbInput(trade.myOrbs.toString());
    }
  }, [trade.isOpen, trade.myOrbs]);

  // Calculate trade values for display
  const calculateTradeValues = (items: Array<{ itemId: string; quantity: number }>, orbs: number) => {
    let shopValue = 0;
    items.forEach(tradeItem => {
      const itemDetails = shopItems.find(item => item.id === tradeItem.itemId);
      if (itemDetails) {
        shopValue += itemDetails.price * tradeItem.quantity;
      }
    });
    const resaleValue = Math.floor(shopValue * 0.5); // -50% of shop value
    return {
      orbs,
      shopValue,
      resaleValue,
      totalValue: orbs + resaleValue
    };
  };

  const myTradeValues = calculateTradeValues(trade.myItems, trade.myOrbs);
  const theirTradeValues = calculateTradeValues(trade.theirItems || [], trade.theirOrbs);

  // Get my available items (not equipped, not already in trade)
  // Group by itemId and count quantities
  const myAvailableItems = useMemo(() => {
    if (!trade.isOpen || !trade.otherPlayerId) return [];
    
    // Count available items by itemId (excluding equipped and logs)
    const itemCounts = new Map<string, number>();
    inventory
      .filter(inv => !inv.equipped && inv.itemId !== 'log')
      .forEach(inv => {
        const count = itemCounts.get(inv.itemId) || 0;
        itemCounts.set(inv.itemId, count + 1);
      });
    
    // Convert to array with quantities
    const items: Array<{ itemId: string; quantity: number; shopItem?: ShopItem }> = [];
    itemCounts.forEach((quantity, itemId) => {
      const shopItem = shopItems.find(item => item.id === itemId);
      if (shopItem) {
        items.push({ itemId, quantity, shopItem });
      }
    });
    
    return items;
  }, [inventory, shopItems, trade.isOpen, trade.otherPlayerId]);

  // Get quantities of items already in trade
  const tradedItemQuantities = useMemo(() => {
    const quantities = new Map<string, number>();
    trade.myItems.forEach(item => {
      const current = quantities.get(item.itemId) || 0;
      quantities.set(item.itemId, current + item.quantity);
    });
    return quantities;
  }, [trade.myItems]);

  // Calculate available items after subtracting what's in trade
  const itemsNotInTrade = useMemo(() => {
    return myAvailableItems
      .map(item => {
        const tradedQty = tradedItemQuantities.get(item.itemId) || 0;
        const availableQty = item.quantity - tradedQty;
        return { ...item, quantity: availableQty };
      })
      .filter(item => item.quantity > 0);
  }, [myAvailableItems, tradedItemQuantities]);

  // Filter items based on search and rarity
  const filteredItems = useMemo(() => {
    return itemsNotInTrade.filter(item => {
      if (!item.shopItem) return false;
      
      // Rarity filter
      if (selectedRarity !== 'all' && item.shopItem.rarity !== selectedRarity) {
        return false;
      }
      
      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        return item.shopItem.name.toLowerCase().includes(query);
      }
      
      return true;
    });
  }, [itemsNotInTrade, selectedRarity, searchQuery]);

  if (!trade.isOpen || !trade.otherPlayerId) return null;

  const handleClose = () => {
    playCloseSound();
    cancelTrade();
    closeTrade();
  };

  const handleAddItem = (itemId: string) => {
    if (trade.myItems.length >= MAX_TRADE_ITEMS) {
      return; // Trade is full
    }

    playClickSound();
    const existingItem = trade.myItems.find(item => item.itemId === itemId);
    const newItems = existingItem
      ? trade.myItems.map(item => 
          item.itemId === itemId 
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      : [...trade.myItems, { itemId, quantity: 1 }];

    updateTrade({ myItems: newItems, myAccepted: false });
    modifyTradeOffer(newItems, parseInt(orbInput) || 0);
  };

  const handleRemoveItem = (itemId: string) => {
    playClickSound();
    const newItems = trade.myItems
      .map(item => 
        item.itemId === itemId 
          ? { ...item, quantity: item.quantity - 1 }
          : item
      )
      .filter(item => item.quantity > 0);

    updateTrade({ myItems: newItems, myAccepted: false });
    modifyTradeOffer(newItems, parseInt(orbInput) || 0);
  };

  const handleOrbChange = (value: string) => {
    const numValue = parseInt(value) || 0;
    const maxOrbs = localPlayer?.orbs || 0;
    const clampedValue = Math.min(Math.max(0, numValue), maxOrbs);
    setOrbInput(clampedValue.toString());
    
    updateTrade({ myOrbs: clampedValue, myAccepted: false });
    modifyTradeOffer(trade.myItems, clampedValue);
  };

  const handleAccept = () => {
    playClickSound();
    if (!trade.myAccepted) {
      updateTrade({ myAccepted: true });
      acceptTrade();
    } else {
      // Un-accept
      updateTrade({ myAccepted: false });
      acceptTrade(); // This will toggle on server
    }
  };

  const handleDecline = () => {
    playClickSound();
    declineTrade();
    closeTrade();
  };

  const getItemDetails = (itemId: string): ShopItem | undefined => {
    return shopItems.find(item => item.id === itemId);
  };

  const formatOrbs = (orbs: number): string => {
    if (orbs >= 1000000) {
      return `${(orbs / 1000000).toFixed(2)}M`;
    } else if (orbs >= 1000) {
      return `${(orbs / 1000).toFixed(1)}K`;
    }
    return orbs.toString();
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(2)}M`;
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toLocaleString();
  };

  // Get hex color for rarity border (matching RARITY_COLORS)
  const getRarityBorderColor = (rarity: string): string => {
    const colorMap: Record<string, string> = {
      common: '#6b7280',      // gray-500
      uncommon: '#22c55e',    // green-500
      rare: '#3b82f6',        // blue-500
      epic: '#a855f7',        // purple-500
      legendary: '#fbbf24',   // amber-400
      godlike: '#ef4444',     // red-500
    };
    return colorMap[rarity] || colorMap.common;
  };

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
      onClick={handleClose}
    >
      <div 
        className="bg-gray-900 rounded-lg border-2 border-amber-500 max-w-5xl w-full mx-4 max-h-[95vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 flex-shrink-0">
          <h2 className="text-xl font-pixel text-amber-400">Trading with {trade.otherPlayerName}</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Trade Diff Box */}
        <div className="px-4 py-2 border-b border-gray-700 flex-shrink-0">
          <div className="bg-gray-800 rounded-lg px-3 py-2 border-2 border-amber-500">
            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-300">
                <span className="text-blue-400">Your Total:</span> {formatNumber(myTradeValues.totalValue)}
              </div>
              <div className="text-base font-bold text-amber-400">
                {myTradeValues.totalValue > theirTradeValues.totalValue ? '→' : 
                 myTradeValues.totalValue < theirTradeValues.totalValue ? '←' : '='}
              </div>
              <div className="text-xs text-gray-300">
                <span className="text-green-400">{trade.otherPlayerName}'s Total:</span> {formatNumber(theirTradeValues.totalValue)}
              </div>
            </div>
            <div className="mt-1 text-center">
              <span className="text-xs text-gray-400">Difference: </span>
              <span className={`text-xs font-bold ${
                myTradeValues.totalValue > theirTradeValues.totalValue 
                  ? 'text-red-400' 
                  : myTradeValues.totalValue < theirTradeValues.totalValue 
                  ? 'text-green-400' 
                  : 'text-gray-400'
              }`}>
                {myTradeValues.totalValue > theirTradeValues.totalValue 
                  ? `-${formatNumber(myTradeValues.totalValue - theirTradeValues.totalValue)}`
                  : myTradeValues.totalValue < theirTradeValues.totalValue
                  ? `+${formatNumber(theirTradeValues.totalValue - myTradeValues.totalValue)}`
                  : 'Even Trade'}
              </span>
            </div>
          </div>
        </div>

        {/* Trade Window - No scroll, fixed height */}
        <div className="p-3 flex-1 min-h-0 flex flex-col">
          <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
            {/* My Side */}
            <div className="bg-gray-800 rounded-lg p-3 border-2 border-blue-500 flex flex-col min-h-0">
              <div className="text-center mb-1 flex-shrink-0">
                <span className="text-blue-400 font-bold text-sm">You</span>
              </div>
              
              {/* My Items Grid - 2 rows with scrollbar */}
              <div className="grid grid-cols-3 gap-1.5 mb-2 overflow-y-auto" style={{ maxHeight: '220px' }}>
                {Array.from({ length: MAX_TRADE_ITEMS }).map((_, index) => {
                  const item = trade.myItems[index];
                  if (!item) {
                    return (
                      <div
                        key={index}
                        className="w-full bg-gray-700 border border-gray-600 rounded flex items-center justify-center"
                        style={{ minHeight: '100px' }}
                      />
                    );
                  }
                  
                  const itemDetails = getItemDetails(item.itemId);
                  if (!itemDetails) return null;
                  const rarityColor = RARITY_COLORS[itemDetails.rarity] || RARITY_COLORS.common;
                  const borderColor = getRarityBorderColor(itemDetails.rarity);
                  const resaleValue = Math.floor(itemDetails.price * 0.5);

                  return (
                    <div
                      key={index}
                      className="bg-gray-700 rounded cursor-pointer hover:opacity-80 transition-opacity relative p-1.5"
                      onClick={() => handleRemoveItem(item.itemId)}
                      style={{ border: `2px solid ${borderColor}` }}
                    >
                      {/* Quantity badge */}
                      {item.quantity > 1 && (
                        <div className="absolute top-1 right-1 bg-blue-500 text-white text-xs px-1 rounded font-bold z-10">
                          {item.quantity}
                        </div>
                      )}
                      
                      {/* Item preview */}
                      <div className="flex justify-center mb-1">
                        <ItemPreview item={itemDetails} size={48} />
                      </div>
                      
                      {/* Item info */}
                      <div className="space-y-0.5 text-xs">
                        <div className="font-bold text-white truncate" style={{ color: rarityColor.text }}>
                          {itemDetails.name}
                        </div>
                        <div className="text-gray-400 capitalize text-xs">
                          {itemDetails.rarity}
                        </div>
                        <div className="text-yellow-400 text-xs">
                          Shop: {formatNumber(itemDetails.price)}
                        </div>
                        <div className="text-green-400 text-xs">
                          Resale: {formatNumber(resaleValue)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* My Trade Values */}
              <div className="mb-2 space-y-0.5 text-xs flex-shrink-0">
                <div className="flex justify-between text-gray-300">
                  <span>Orbs:</span>
                  <span className="text-blue-400">{formatOrbs(myTradeValues.orbs)}</span>
                </div>
                <div className="flex justify-between text-gray-300">
                  <span>Shop:</span>
                  <span className="text-yellow-400">{formatNumber(myTradeValues.shopValue)}</span>
                </div>
                <div className="flex justify-between text-gray-300">
                  <span>Resale:</span>
                  <span className="text-green-400">{formatNumber(myTradeValues.resaleValue)}</span>
                </div>
                <div className="flex justify-between text-gray-300 border-t border-gray-600 pt-0.5">
                  <span className="font-bold">Total:</span>
                  <span className="font-bold text-amber-400">{formatNumber(myTradeValues.totalValue)}</span>
                </div>
              </div>

              {/* My Orbs Input */}
              <div className="mb-2 flex-shrink-0">
                <label className="block text-xs text-gray-300 mb-0.5">Orbs:</label>
                <input
                  type="number"
                  value={orbInput}
                  onChange={(e) => handleOrbChange(e.target.value)}
                  className="w-full bg-gray-700 text-white px-2 py-1 text-sm rounded border border-gray-600 focus:border-blue-400 focus:outline-none"
                  min="0"
                  max={localPlayer?.orbs || 0}
                />
                <div className="text-xs text-gray-400 mt-0.5">
                  Available: {formatOrbs(localPlayer?.orbs || 0)}
                </div>
              </div>

              {/* My Accept Button */}
              <button
                onClick={handleAccept}
                disabled={trade.theirAccepted && trade.myAccepted}
                className={`w-full py-1.5 px-3 rounded text-sm font-bold transition-colors flex-shrink-0 ${
                  trade.myAccepted
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                } ${trade.theirAccepted && trade.myAccepted ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {trade.myAccepted ? 'Accepted!' : 'Accept'}
              </button>
            </div>

            {/* Their Side */}
            <div className="bg-gray-800 rounded-lg p-3 border-2 border-green-500 flex flex-col min-h-0">
              <div className="text-center mb-1 flex-shrink-0">
                <span className="text-green-400 font-bold text-sm">{trade.otherPlayerName}</span>
              </div>
              
              {/* Their Items Grid - 2 rows with scrollbar */}
              <div className="grid grid-cols-3 gap-1.5 mb-2 overflow-y-auto" style={{ maxHeight: '220px' }}>
                {Array.from({ length: MAX_TRADE_ITEMS }).map((_, index) => {
                  const item = trade.theirItems && trade.theirItems[index] ? trade.theirItems[index] : null;
                  if (!item) {
                    return (
                      <div
                        key={index}
                        className="w-full bg-gray-700 border border-gray-600 rounded flex items-center justify-center"
                        style={{ minHeight: '100px' }}
                      />
                    );
                  }
                  
                  const itemDetails = getItemDetails(item.itemId);
                  if (!itemDetails) return null;
                  const rarityColor = RARITY_COLORS[itemDetails.rarity] || RARITY_COLORS.common;
                  const borderColor = getRarityBorderColor(itemDetails.rarity);
                  const resaleValue = Math.floor(itemDetails.price * 0.5);

                  return (
                    <div
                      key={index}
                      className="bg-gray-700 rounded relative p-1.5"
                      style={{ border: `2px solid ${borderColor}` }}
                    >
                      {/* Quantity badge */}
                      {item.quantity > 1 && (
                        <div className="absolute top-1 right-1 bg-green-500 text-white text-xs px-1 rounded font-bold z-10">
                          {item.quantity}
                        </div>
                      )}
                      
                      {/* Item preview */}
                      <div className="flex justify-center mb-1">
                        <ItemPreview item={itemDetails} size={48} />
                      </div>
                      
                      {/* Item info */}
                      <div className="space-y-0.5 text-xs">
                        <div className="font-bold text-white truncate" style={{ color: rarityColor.text }}>
                          {itemDetails.name}
                        </div>
                        <div className="text-gray-400 capitalize text-xs">
                          {itemDetails.rarity}
                        </div>
                        <div className="text-yellow-400 text-xs">
                          Shop: {formatNumber(itemDetails.price)}
                        </div>
                        <div className="text-green-400 text-xs">
                          Resale: {formatNumber(resaleValue)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Their Trade Values */}
              <div className="mb-2 space-y-0.5 text-xs flex-shrink-0">
                <div className="flex justify-between text-gray-300">
                  <span>Orbs:</span>
                  <span className="text-green-400">{formatOrbs(theirTradeValues.orbs)}</span>
                </div>
                <div className="flex justify-between text-gray-300">
                  <span>Shop:</span>
                  <span className="text-yellow-400">{formatNumber(theirTradeValues.shopValue)}</span>
                </div>
                <div className="flex justify-between text-gray-300">
                  <span>Resale:</span>
                  <span className="text-green-400">{formatNumber(theirTradeValues.resaleValue)}</span>
                </div>
                <div className="flex justify-between text-gray-300 border-t border-gray-600 pt-0.5">
                  <span className="font-bold">Total:</span>
                  <span className="font-bold text-amber-400">{formatNumber(theirTradeValues.totalValue)}</span>
                </div>
              </div>

              {/* Their Orbs */}
              <div className="mb-2 flex-shrink-0">
                <div className="text-xs text-gray-300 mb-0.5">Orbs:</div>
                <div className="bg-gray-700 text-white px-2 py-1 text-sm rounded border border-gray-600">
                  {formatOrbs(trade.theirOrbs)}
                </div>
              </div>

              {/* Their Accept Status */}
              <div className={`w-full py-1.5 px-3 rounded text-sm font-bold text-center flex-shrink-0 ${
                trade.theirAccepted
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-600 text-gray-400'
              }`}>
                {trade.theirAccepted ? 'Accepted!' : 'Waiting...'}
              </div>
            </div>
          </div>

          {/* Status Message */}
          {trade.myAccepted && !trade.theirAccepted && (
            <div className="mt-2 text-center text-yellow-400 font-bold text-xs flex-shrink-0">
              Waiting for {trade.otherPlayerName} to accept...
            </div>
          )}
          {trade.myAccepted && trade.theirAccepted && (
            <div className="mt-2 text-center text-green-400 font-bold text-xs flex-shrink-0">
              Both players have accepted! Trade will complete shortly...
            </div>
          )}

          {/* Inventory Selection - Always visible, fits on screen */}
          <div className="mt-2 flex-shrink-0">
            <button
              onClick={() => {
                playClickSound();
                setShowInventory(!showInventory);
              }}
              className="w-full py-1 px-3 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition-colors mb-2"
            >
              {showInventory ? 'Hide' : 'Show'} Inventory
            </button>

            {showInventory && (
              <div className="bg-gray-800 rounded-lg p-2 flex flex-col overflow-hidden" style={{ maxHeight: 'calc(95vh - 600px)' }}>
                {/* Filters Row - Horizontal */}
                <div className="flex gap-2 mb-2 flex-shrink-0">
                  {/* Search Bar */}
                  <div className="flex-1">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => {
                        playClickSound();
                        setSearchQuery(e.target.value);
                      }}
                      placeholder="Search items..."
                      className="w-full bg-gray-700 text-white px-2 py-1 text-sm rounded border border-gray-600 focus:border-blue-400 focus:outline-none"
                    />
                  </div>

                  {/* Rarity Dropdown */}
                  <div className="flex-shrink-0">
                    <select
                      value={selectedRarity}
                      onChange={(e) => {
                        playClickSound();
                        setSelectedRarity(e.target.value as ItemRarity | 'all');
                      }}
                      className="bg-gray-700 text-white px-3 py-1 text-sm rounded border border-gray-600 focus:border-blue-400 focus:outline-none cursor-pointer"
                    >
                      <option value="all">All Rarities</option>
                      {(['common', 'uncommon', 'rare', 'epic', 'legendary', 'godlike'] as ItemRarity[]).map((rarity) => (
                        <option key={rarity} value={rarity} className="capitalize">
                          {rarity}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Inventory Grid - 4 columns, 2 rows visible, then scrollbar */}
                <div className="overflow-y-auto" style={{ maxHeight: '280px' }}>
                  <div className="grid grid-cols-4 gap-2">
                    {filteredItems.map((invItem, index) => {
                      if (!invItem.shopItem) return null;
                      const resaleValue = Math.floor(invItem.shopItem.price * 0.5);
                      const rarityColor = RARITY_COLORS[invItem.shopItem.rarity] || RARITY_COLORS.common;
                      const borderColor = getRarityBorderColor(invItem.shopItem.rarity);
                      
                      return (
                        <div
                          key={`${invItem.itemId}-${index}`}
                          className="bg-gray-700 rounded-lg p-2 hover:opacity-80 transition-opacity cursor-pointer relative"
                          onClick={() => handleAddItem(invItem.itemId)}
                          style={{ border: `2px solid ${borderColor}` }}
                        >
                          {/* Quantity badge */}
                          {invItem.quantity > 1 && (
                            <div className="absolute top-1 right-1 bg-blue-500 text-white text-xs px-1.5 py-0.5 rounded font-bold">
                              {invItem.quantity}
                            </div>
                          )}
                          
                          {/* Centered, enlarged item preview */}
                          <div className="flex justify-center mb-1">
                            <div className="flex items-center justify-center">
                              <ItemPreview item={invItem.shopItem} size={48} />
                            </div>
                          </div>
                          
                          {/* Item info text */}
                          <div className="space-y-0.5 text-xs">
                            <div className="font-bold text-white truncate" style={{ color: rarityColor.text }}>
                              {invItem.shopItem.name}
                            </div>
                            <div className="text-gray-400 capitalize text-xs">
                              {invItem.shopItem.rarity}
                            </div>
                            <div className="text-yellow-400 text-xs">
                              Shop: {formatNumber(invItem.shopItem.price)}
                            </div>
                            <div className="text-green-400 text-xs">
                              Resale: {formatNumber(resaleValue)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {filteredItems.length === 0 && (
                    <div className="text-center text-gray-400 py-4">
                      {itemsNotInTrade.length === 0 
                        ? 'No items available to trade'
                        : 'No items match your filters'}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="mt-2 flex gap-2 flex-shrink-0">
            <button
              onClick={handleDecline}
              className="flex-1 py-1.5 px-3 bg-red-600 hover:bg-red-700 text-white text-sm rounded font-bold transition-colors"
            >
              Decline
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
