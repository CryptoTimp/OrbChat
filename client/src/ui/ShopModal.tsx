import { useState, useEffect, useMemo } from 'react';
import { useGameStore } from '../state/gameStore';
import { useSocket } from '../hooks/useSocket';
import { ShopItem, RARITY_COLORS, ItemRarity } from '../types';
import { ItemPreview } from './ItemPreview';
import { CharacterPreview } from './CharacterPreview';
import { LootBoxModal, LootBox } from './LootBoxModal';
import { playClickSound, playCloseSound, playPurchaseSound, playEquipSound, playBuyOrbsSound } from '../utils/sounds';

const RARITY_ORDER: ItemRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'godlike'];

export function ShopModal() {
  const shopOpen = useGameStore(state => state.shopOpen);
  const shopInitialTab = useGameStore(state => state.shopInitialTab);
  const shopInitialRarity = useGameStore(state => state.shopInitialRarity);
  const toggleShop = useGameStore(state => state.toggleShop);
  const shopItems = useGameStore(state => state.shopItems);
  const inventory = useGameStore(state => state.inventory);
  const localPlayer = useGameStore(state => state.localPlayer);
  // Use direct selector for reactive orb balance updates
  const playerOrbs = useGameStore(state => state.localPlayer?.orbs || 0);
  const { purchaseItem, purchaseLootBox, equipItem } = useSocket();
  
  const [previewItem, setPreviewItem] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<'all' | 'hats' | 'shirts' | 'legs' | 'capes' | 'wings' | 'accessories' | 'boosts' | 'pets' | 'lootboxes'>('all');
  const selectedLootBox = useGameStore(state => state.selectedLootBox);
  const setSelectedLootBox = useGameStore(state => state.setSelectedLootBox);
  const [rarityFilter, setRarityFilter] = useState<ItemRarity | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // Generate loot boxes (reused from LootBoxesTab logic) - must be at top level with other hooks
  const lootBoxes = useMemo(() => {
    const categories: Array<'hats' | 'shirts' | 'legs' | 'capes' | 'wings' | 'accessories' | 'boosts' | 'pets'> = [
      'hats', 'shirts', 'legs', 'capes', 'wings', 'accessories', 'boosts', 'pets'
    ];
    
    const boxes = categories.map(category => {
      // Get all items for this category (without filters for loot boxes)
      const categoryItems = shopItems.filter(item => {
        // Exclude axe from all lootboxes
        if (item.id === 'tool_axe') return false;
        // Exclude common items from all cases
        if ((item.rarity || 'common') === 'common') return false;
        // Exclude godlike items from regular cases (only available in godlike cases)
        if ((item.rarity || 'common') === 'godlike') return false;
        if (category === 'hats') return item.spriteLayer === 'hat';
        if (category === 'shirts') return item.spriteLayer === 'shirt';
        if (category === 'legs') return item.spriteLayer === 'legs';
        if (category === 'capes') return item.spriteLayer === 'cape';
        if (category === 'wings') return item.spriteLayer === 'wings';
        if (category === 'accessories') return item.spriteLayer === 'accessory';
        if (category === 'boosts') return item.spriteLayer === 'boost';
        if (category === 'pets') return item.spriteLayer === 'pet';
        return false;
      });
      
      if (categoryItems.length === 0) return null;
      
      // Group items by rarity
      const itemsByRarity: Record<ItemRarity, ShopItem[]> = {
        common: [],
        uncommon: [],
        rare: [],
        epic: [],
        legendary: [],
        godlike: [],
      };
      
      categoryItems.forEach(item => {
        const rarity = item.rarity || 'common';
        itemsByRarity[rarity].push(item);
      });
      
      // Adjusted odds: removed common (62%), redistributed proportionally to remaining rarities
      // Original: uncommon 25%, rare 10%, epic 2.5%, legendary 0.5% = 38% total
      // New: scaled to 100% maintaining proportions
      const rarityTotals: Record<ItemRarity, number> = {
        common: 0,
        uncommon: 65.78947368421053,  // 25/38 * 100
        rare: 26.31578947368421,      // 10/38 * 100
        epic: 6.578947368421053,       // 2.5/38 * 100
        legendary: 1.3157894736842105, // 0.5/38 * 100
      };
      
      // Create items with chances distributed evenly within each rarity
      // Special handling for pets: gold, phoenix, void = 20% each, rest = 13.3% each
      let itemsWithChances;
      if (category === 'pets') {
        itemsWithChances = categoryItems.map(item => {
          let chance = 0;
          if (item.id === 'pet_golden' || item.id === 'pet_phoenix' || item.id === 'pet_void') {
            chance = 20.0;
          } else if (item.id === 'pet_celestial' || item.id === 'pet_galaxy' || item.id === 'pet_rainbow') {
            chance = 13.3;
          }
          return {
            item,
            chance,
          };
        });
      } else {
        itemsWithChances = categoryItems.map(item => {
          const rarity = item.rarity || 'common';
          const itemsInRarity = itemsByRarity[rarity].length;
          // Distribute the rarity's total percentage evenly among all items of that rarity
          const chancePerItem = itemsInRarity > 0 ? rarityTotals[rarity] / itemsInRarity : 0;
          
          return {
            item,
            chance: chancePerItem,
          };
        });
      }
      
      // Check if case only contains legendary items
      const onlyLegendary = categoryItems.every(item => (item.rarity || 'common') === 'legendary');
      // Wings case costs 500k, pet case costs 900k, legendary-only cases cost 200k, others cost 2.5k
      let price = 2500;
      if (category === 'wings') {
        price = 500000;
      } else if (category === 'pets') {
        price = 900000;
      } else if (onlyLegendary) {
        price = 200000;
      }
      
      return {
        id: `lootbox_${category}`,
        name: `${category.charAt(0).toUpperCase() + category.slice(1)} Case`,
        category,
        price, // Wings: 500k, pet: 900k, legendary-only: 200k, others: 2.5k
        items: itemsWithChances,
      } as LootBox;
    }).filter((box): box is LootBox => box !== null);
    
    // Sort by price (most expensive first)
    return boxes.sort((a, b) => b.price - a.price);
  }, [shopItems]);
  
  // Update tab and filter when shop opens with initial values
  useEffect(() => {
    if (shopOpen && shopInitialTab) {
      setActiveTab(shopInitialTab);
    }
    if (shopOpen && shopInitialRarity) {
      setRarityFilter(shopInitialRarity);
    }
  }, [shopOpen, shopInitialTab, shopInitialRarity]);
  
  // Clear initial values and search when modal closes
  useEffect(() => {
    if (!shopOpen) {
      if (shopInitialTab || shopInitialRarity) {
        useGameStore.setState({ shopInitialTab: undefined, shopInitialRarity: undefined });
      }
      setSearchQuery('');
    }
  }, [shopOpen, shopInitialTab, shopInitialRarity]);
  
  if (!shopOpen) return null;
  const equippedItems = inventory.filter(inv => inv.equipped).map(inv => inv.itemId);
  
  // Filter by rarity and search query
  const filterItems = (items: ShopItem[]) => {
    let filtered = items;
    
    // Apply rarity filter
    if (rarityFilter) {
      filtered = filtered.filter(item => (item.rarity || 'common') === rarityFilter);
    }
    
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(item => 
        item.name.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  };

  // Filter lootboxes based on current filters
  const filterLootBoxes = (boxes: LootBox[]) => {
    let filtered = boxes;
    
    // Apply rarity filter - show lootboxes that contain items of the selected rarity
    if (rarityFilter) {
      filtered = filtered.filter(box => 
        box.items.some(itemWithChance => (itemWithChance.item.rarity || 'common') === rarityFilter)
      );
    }
    
    // Apply search filter - match lootbox name
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(box => 
        box.name.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  };

  // Check if any filters are active (including "All Rarities" which means show all lootboxes)
  const hasActiveFilters = rarityFilter !== null || searchQuery.trim() !== '';
  const shouldShowLootBoxes = rarityFilter === null || hasActiveFilters; // Show all when "All Rarities", filtered when specific rarity
  
  // Get filtered lootboxes (or all lootboxes when "All Rarities" is selected)
  const filteredLootBoxes = shouldShowLootBoxes 
    ? (hasActiveFilters ? filterLootBoxes(lootBoxes) : lootBoxes)
    : [];
  
  // Group items by layer (with filters applied)
  const hats = filterItems(shopItems.filter(item => item.spriteLayer === 'hat'));
  const shirts = filterItems(shopItems.filter(item => item.spriteLayer === 'shirt'));
  const legs = filterItems(shopItems.filter(item => item.spriteLayer === 'legs'));
  const capes = filterItems(shopItems.filter(item => item.spriteLayer === 'cape'));
  const wings = filterItems(shopItems.filter(item => item.spriteLayer === 'wings'));
  const accessories = filterItems(shopItems.filter(item => item.spriteLayer === 'accessory'));
  const boosts = filterItems(shopItems.filter(item => item.spriteLayer === 'boost'));
  const pets = filterItems(shopItems.filter(item => item.spriteLayer === 'pet'));
  
  // Sort items by rarity
  const sortByRarity = (items: ShopItem[]) => {
    return [...items].sort((a, b) => {
      const aIndex = RARITY_ORDER.indexOf(a.rarity || 'common');
      const bIndex = RARITY_ORDER.indexOf(b.rarity || 'common');
      return aIndex - bIndex;
    });
  };
  
  const isOwned = (itemId: string) => inventory.some(inv => inv.itemId === itemId);
  const isEquipped = (itemId: string) => inventory.some(inv => inv.itemId === itemId && inv.equipped);
  
  const handlePurchase = (item: ShopItem) => {
    if (playerOrbs >= item.price && !isOwned(item.id)) {
      playPurchaseSound();
      purchaseItem(item.id);
    }
  };
  
  const handleEquip = (itemId: string, currentlyEquipped: boolean) => {
    playEquipSound();
    equipItem(itemId, !currentlyEquipped);
  };
  
  const handlePreview = (itemId: string) => {
    playClickSound();
    setPreviewItem(prev => prev === itemId ? undefined : itemId);
  };
  
  const getRarityBorderClass = (rarity: ItemRarity) => {
    const colors = RARITY_COLORS[rarity];
    return `border-2 ${colors.border.replace('border-', 'border-')}`;
  };
  
  const renderItem = (item: ShopItem) => {
    const owned = isOwned(item.id);
    const equipped = isEquipped(item.id);
    const canAfford = playerOrbs >= item.price;
    const isPreviewing = previewItem === item.id;
    const rarityColor = RARITY_COLORS[item.rarity || 'common'];
    
    return (
      <div 
        key={item.id}
        className={`
          bg-gray-800 rounded-lg p-2 transition-all relative
          ${equipped ? 'border-2 border-emerald-500 shadow-lg shadow-emerald-500/20' : 
            isPreviewing ? 'border-2 border-amber-500 shadow-lg shadow-amber-500/20' : 
            `border-2 ${rarityColor.border}`}
          ${!owned && canAfford ? 'hover:shadow-lg' : ''}
        `}
        style={!equipped && !isPreviewing ? { boxShadow: `0 0 10px ${rarityColor.glow}` } : undefined}
      >
        {/* Rarity indicator */}
        <div className={`absolute top-1 right-1 px-1.5 py-0.5 rounded text-[8px] font-pixel ${rarityColor.bg} ${rarityColor.text}`}>
          {(item.rarity || 'common').charAt(0).toUpperCase()}
        </div>
        
        {/* Item preview */}
        <div className="w-full aspect-square bg-gray-900 rounded-lg mb-2 flex items-center justify-center">
          <ItemPreview item={item} size={64} />
        </div>
        
        {/* Item name */}
        <p className={`font-pixel text-[10px] text-center truncate mb-1 ${rarityColor.text}`}>
          {item.name}
        </p>
        
        {/* Boost indicators */}
        {item.speedMultiplier && (
          <p className="text-[8px] font-pixel text-center mb-1" style={{ color: item.trailColor }}>
            ⚡ {Math.round((item.speedMultiplier - 1) * 100)}% Speed
          </p>
        )}
        {item.orbMultiplier && (
          <p className="text-[8px] font-pixel text-center mb-1" style={{ color: '#fbbf24' }}>
            $ {Math.round((item.orbMultiplier - 1) * 100)}% More Orbs
          </p>
        )}
        
        {/* Action buttons */}
        <div className="flex gap-1">
          {owned ? (
            <button
              onClick={() => handleEquip(item.id, equipped)}
              className={`
                flex-1 py-1.5 rounded font-pixel text-[10px] transition-colors
                ${equipped 
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white' 
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                }
              `}
            >
              {equipped ? '✓' : 'Equip'}
            </button>
          ) : (
            <button
              onClick={() => handlePurchase(item)}
              disabled={!canAfford}
              className={`
                flex-1 py-1.5 rounded font-pixel text-[10px] transition-colors
                flex items-center justify-center gap-1
                ${canAfford 
                  ? 'bg-amber-600 hover:bg-amber-500 text-white' 
                  : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                }
              `}
            >
              <span className="text-cyan-300">●</span>
              {item.price}
            </button>
          )}
          
          {/* Preview button */}
          <button
            onClick={() => handlePreview(item.id)}
            className={`
              px-2 py-1.5 rounded font-pixel text-[10px] transition-colors
              ${isPreviewing 
                ? 'bg-amber-500 text-white' 
                : 'bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-white'
              }
            `}
            title="Preview on character"
          >
            👁
          </button>
        </div>
      </div>
    );
  };

  // Render filtered lootboxes section (reusable component)
  const renderFilteredLootBoxes = () => {
    if (!shouldShowLootBoxes || filteredLootBoxes.length === 0) return null;
    
    return (
      <div className="mb-6">
        <h3 className="text-gray-300 font-pixel text-sm mb-3">📦 Filtered Loot Boxes</h3>
        <div className="flex gap-4 overflow-x-auto pb-2 lootbox-scroll">
          {filteredLootBoxes.map(lootBox => {
            const canAfford = playerOrbs >= lootBox.price;
            return (
              <div
                key={lootBox.id}
                className={`
                  bg-gray-800 rounded-lg p-4 border-2 transition-all cursor-pointer flex-shrink-0 w-52 h-72 flex flex-col
                  ${canAfford 
                    ? 'border-amber-500 hover:border-amber-400 hover:shadow-lg hover:shadow-amber-500/30' 
                    : 'border-gray-600 opacity-60'
                  }
                `}
                onClick={() => {
                  if (canAfford) {
                    playClickSound();
                    setSelectedLootBox(lootBox);
                  }
                }}
              >
                <div className="text-center mb-3 flex-shrink-0 h-[120px] flex flex-col justify-center px-2">
                  <div className="text-4xl mb-2">📦</div>
                  <h3 className="font-pixel text-sm text-amber-400 mb-1 line-clamp-2 min-h-[40px] flex items-center justify-center break-words">
                    {lootBox.name}
                  </h3>
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-cyan-300 font-pixel">●</span>
                    <span className="text-white font-pixel text-sm">{lootBox.price.toLocaleString()}</span>
                  </div>
                </div>
                
                {/* Rarity distribution preview - flex-grow to fill space */}
                <div className="flex gap-1 justify-center items-center flex-wrap mb-3 flex-grow min-h-[40px]">
                  {RARITY_ORDER.map(rarity => {
                    const count = lootBox.items.filter(i => i.item.rarity === rarity).length;
                    if (count === 0) return null;
                    const color = RARITY_COLORS[rarity];
                    return (
                      <div
                        key={rarity}
                        className={`px-2 py-1 rounded text-[8px] font-pixel ${color.bg} ${color.text}`}
                        title={`${count} ${rarity} items`}
                      >
                        {count}
                      </div>
                    );
                  })}
                </div>
                
                {canAfford ? (
                  <button
                    className="w-full py-2 rounded font-pixel text-xs transition-all flex-shrink-0 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white"
                  >
                    Open Case
                  </button>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation(); // Prevent opening the loot box modal
                      playBuyOrbsSound();
                      toggleShop();
                      useGameStore.getState().toggleBuyOrbs();
                    }}
                    className="relative overflow-hidden w-full py-2 rounded font-pixel text-xs transition-all flex-shrink-0
                               bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 
                               text-white shadow-lg shadow-amber-500/40 hover:shadow-amber-500/60
                               transition-all duration-200 flex items-center justify-center gap-2"
                  >
                    {/* Small particle effects */}
                    <span className="absolute w-1 h-1 bg-yellow-300 rounded-full animate-btn-particle-1 opacity-60" />
                    <span className="absolute w-0.5 h-0.5 bg-amber-200 rounded-full animate-btn-particle-2 opacity-50" />
                    <span className="absolute w-1 h-1 bg-orange-300 rounded-full animate-btn-particle-3 opacity-60" />
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="relative z-10">Buy Orbs</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'all':
        // Combine all items from all categories
        const allItems = [...hats, ...shirts, ...legs, ...capes, ...wings, ...accessories, ...boosts, ...pets];
        return (
          <div>
            {/* Loot boxes horizontal row at top */}
            <div className="mb-6">
              <h3 className="text-gray-300 font-pixel text-sm mb-3">📦 Loot Boxes</h3>
              <div className="flex gap-4 overflow-x-auto pb-2 lootbox-scroll">
                {lootBoxes.map(lootBox => {
                  const canAfford = playerOrbs >= lootBox.price;
                  return (
                    <div
                      key={lootBox.id}
                      className={`
                        bg-gray-800 rounded-lg p-4 border-2 transition-all cursor-pointer flex-shrink-0 w-52 h-72 flex flex-col
                        ${canAfford 
                          ? 'border-amber-500 hover:border-amber-400 hover:shadow-lg hover:shadow-amber-500/30' 
                          : 'border-gray-600 opacity-60'
                        }
                      `}
                      onClick={() => {
                        if (canAfford) {
                          playClickSound();
                          setSelectedLootBox(lootBox);
                        }
                      }}
                    >
                      <div className="text-center mb-3 flex-shrink-0 h-[120px] flex flex-col justify-center px-2">
                        <div className="text-4xl mb-2">📦</div>
                        <h3 className="font-pixel text-sm text-amber-400 mb-1 line-clamp-2 min-h-[40px] flex items-center justify-center break-words">
                          {lootBox.name}
                        </h3>
                        <div className="flex items-center justify-center gap-2">
                          <span className="text-cyan-300 font-pixel">●</span>
                          <span className="text-white font-pixel text-sm">{lootBox.price.toLocaleString()}</span>
                        </div>
                      </div>
                      
                      {/* Rarity distribution preview - flex-grow to fill space */}
                      <div className="flex gap-1 justify-center items-center flex-wrap mb-3 flex-grow min-h-[40px]">
                        {RARITY_ORDER.map(rarity => {
                          const count = lootBox.items.filter(i => i.item.rarity === rarity).length;
                          if (count === 0) return null;
                          const color = RARITY_COLORS[rarity];
                          return (
                            <div
                              key={rarity}
                              className={`px-2 py-1 rounded text-[8px] font-pixel ${color.bg} ${color.text}`}
                              title={`${count} ${rarity} items`}
                            >
                              {count}
                            </div>
                          );
                        })}
                      </div>
                      
                      {canAfford ? (
                        <button
                          className="w-full py-2 rounded font-pixel text-xs transition-all flex-shrink-0 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white"
                        >
                          Open Case
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent opening the loot box modal
                            playBuyOrbsSound();
                            toggleShop();
                            useGameStore.getState().toggleBuyOrbs();
                          }}
                          className="relative overflow-hidden w-full py-2 rounded font-pixel text-xs transition-all flex-shrink-0
                                     bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 
                                     text-white shadow-lg shadow-amber-500/40 hover:shadow-amber-500/60
                                     transition-all duration-200 flex items-center justify-center gap-2"
                        >
                          {/* Small particle effects */}
                          <span className="absolute w-1 h-1 bg-yellow-300 rounded-full animate-btn-particle-1 opacity-60" />
                          <span className="absolute w-0.5 h-0.5 bg-amber-200 rounded-full animate-btn-particle-2 opacity-50" />
                          <span className="absolute w-1 h-1 bg-orange-300 rounded-full animate-btn-particle-3 opacity-60" />
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="relative z-10">Buy Orbs</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            
            {/* Regular items grid below */}
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2">
              {sortByRarity(allItems).map(renderItem)}
            </div>
          </div>
        );
      case 'hats':
        return (
          <div>
            {renderFilteredLootBoxes()}
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2">
              {sortByRarity(hats).map(renderItem)}
            </div>
          </div>
        );
      case 'shirts':
        return (
          <div>
            {renderFilteredLootBoxes()}
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2">
              {sortByRarity(shirts).map(renderItem)}
            </div>
          </div>
        );
      case 'legs':
        return (
          <div>
            {renderFilteredLootBoxes()}
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2">
              {sortByRarity(legs).map(renderItem)}
            </div>
          </div>
        );
      case 'capes':
        return (
          <div>
            {renderFilteredLootBoxes()}
            <p className="text-gray-400 font-pixel text-xs mb-4">
              🦸 Capes flow in the wind as you move!
            </p>
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2">
              {sortByRarity(capes).map(renderItem)}
            </div>
          </div>
        );
      case 'wings':
        return (
          <div>
            {renderFilteredLootBoxes()}
            <p className="text-gray-400 font-pixel text-xs mb-4">
              🦅 Wings can be equipped alongside accessories!
            </p>
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2">
              {sortByRarity(wings).map(renderItem)}
            </div>
          </div>
        );
      case 'accessories':
        return (
          <div>
            {renderFilteredLootBoxes()}
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2">
              {sortByRarity(accessories).map(renderItem)}
            </div>
          </div>
        );
      case 'boosts':
        return (
          <div>
            {renderFilteredLootBoxes()}
            <p className="text-gray-400 font-pixel text-xs mb-4">
              ⚡ Boosts enhance your gameplay! Speed boosts increase movement speed, orb boosts increase orb rewards!
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
              {sortByRarity(boosts).map(renderItem)}
            </div>
          </div>
        );
      case 'pets':
        return (
          <div>
            {renderFilteredLootBoxes()}
            <p className="text-gray-400 font-pixel text-xs mb-4">
              🐾 Legendary pets follow you around! They're purely cosmetic and visible to all players.
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
              {sortByRarity(pets).map(renderItem)}
            </div>
          </div>
        );
      case 'lootboxes':
        return <LootBoxesTab shopItems={shopItems} onOpenLootBox={setSelectedLootBox} />;
    }
  };
  
  if (!shopOpen) {
    return null;
  }
  
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-2">
      <div className="bg-gray-900 rounded-xl border border-gray-700 shadow-2xl w-[95vw] h-[95vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700 shrink-0">
          <h2 className="text-xl font-pixel text-amber-400 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
            Cosmetic Shop
          </h2>
          
          {/* Balance & Actions */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-gray-800 px-3 py-1 rounded-lg">
              <div className="w-4 h-4 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500" />
              <span className="text-cyan-300 font-pixel text-sm">{playerOrbs.toLocaleString()}</span>
            </div>
            
            {/* Buy Orbs button */}
            <button
              onClick={() => {
                playBuyOrbsSound();
                toggleShop();
                useGameStore.getState().toggleBuyOrbs();
              }}
              className="relative overflow-hidden bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 
                         text-white font-pixel text-xs px-4 py-2 rounded-lg 
                         shadow-lg shadow-amber-500/40 hover:shadow-amber-500/60
                         transition-all duration-200 flex items-center gap-2"
            >
              {/* Small particle effects */}
              <span className="absolute w-1 h-1 bg-yellow-300 rounded-full animate-btn-particle-1 opacity-60" />
              <span className="absolute w-0.5 h-0.5 bg-amber-200 rounded-full animate-btn-particle-2 opacity-50" />
              <span className="absolute w-1 h-1 bg-orange-300 rounded-full animate-btn-particle-3 opacity-60" />
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="relative z-10">Buy Orbs</span>
            </button>
            
            <button
              onClick={() => { playCloseSound(); toggleShop(); }}
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-gray-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        
        {/* Content - Three columns */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Filters & Search */}
          <div className="w-64 border-r border-gray-700 p-4 bg-gray-800/30 shrink-0 flex flex-col">
            <h3 className="text-gray-400 font-pixel text-sm mb-3">Filters</h3>
            
            {/* Search Bar */}
            <div className="mb-4">
              <input
                type="text"
                placeholder="Search items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm font-pixel text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                onFocus={() => playClickSound()}
              />
            </div>
            
            {/* Rarity Filters */}
            <div className="flex flex-col gap-2 mb-6">
              <p className="text-gray-500 font-pixel text-[10px] mb-1">Rarity</p>
              <button
                onClick={() => { playClickSound(); setRarityFilter(null); }}
                className={`px-3 py-2 rounded transition-all text-left text-[10px] font-pixel ${
                  rarityFilter === null 
                    ? 'bg-white text-gray-900 ring-2 ring-white' 
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                All Rarities
              </button>
              {RARITY_ORDER.map(rarity => (
                <button 
                  key={rarity} 
                  onClick={() => { playClickSound(); setRarityFilter(rarityFilter === rarity ? null : rarity); }}
                  className={`px-3 py-2 rounded transition-all text-left text-[10px] font-pixel ${RARITY_COLORS[rarity].bg} ${RARITY_COLORS[rarity].text} ${
                    rarityFilter === rarity 
                      ? 'ring-2 ring-white scale-105' 
                      : 'hover:scale-[1.02] opacity-80 hover:opacity-100'
                  }`}
                >
                  {rarity.charAt(0).toUpperCase() + rarity.slice(1)}
                </button>
              ))}
            </div>
            
            {/* Category Filters */}
            <div className="flex flex-col gap-2">
              <p className="text-gray-500 font-pixel text-[10px] mb-1">Category</p>
              <button
                onClick={() => { playClickSound(); setActiveTab('all'); }}
                className={`px-3 py-2 rounded transition-all text-left text-[10px] font-pixel ${
                  activeTab === 'all' ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                📦 All ({[...hats, ...shirts, ...legs, ...capes, ...wings, ...accessories, ...boosts, ...pets].length})
              </button>
              <button
                onClick={() => { playClickSound(); setActiveTab('hats'); }}
                className={`px-3 py-2 rounded transition-all text-left text-[10px] font-pixel ${
                  activeTab === 'hats' ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                👒 Hats ({hats.length})
              </button>
              <button
                onClick={() => { playClickSound(); setActiveTab('shirts'); }}
                className={`px-3 py-2 rounded transition-all text-left text-[10px] font-pixel ${
                  activeTab === 'shirts' ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                👕 Shirts ({shirts.length})
              </button>
              <button
                onClick={() => { playClickSound(); setActiveTab('legs'); }}
                className={`px-3 py-2 rounded transition-all text-left text-[10px] font-pixel ${
                  activeTab === 'legs' ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                👖 Legs ({legs.length})
              </button>
              <button
                onClick={() => { playClickSound(); setActiveTab('capes'); }}
                className={`px-3 py-2 rounded transition-all text-left text-[10px] font-pixel ${
                  activeTab === 'capes' ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                🦸 Capes ({capes.length})
              </button>
              <button
                onClick={() => { playClickSound(); setActiveTab('wings'); }}
                className={`px-3 py-2 rounded transition-all text-left text-[10px] font-pixel ${
                  activeTab === 'wings' ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                🦅 Wings ({wings.length})
              </button>
              <button
                onClick={() => { playClickSound(); setActiveTab('accessories'); }}
                className={`px-3 py-2 rounded transition-all text-left text-[10px] font-pixel ${
                  activeTab === 'accessories' ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                ✨ Accessories ({accessories.length})
              </button>
              <button
                onClick={() => { playClickSound(); setActiveTab('boosts'); }}
                className={`px-3 py-2 rounded transition-all text-left text-[10px] font-pixel ${
                  activeTab === 'boosts' ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                ⚡ Boosts ({boosts.length})
              </button>
              <button
                onClick={() => { playClickSound(); setActiveTab('pets'); }}
                className={`px-3 py-2 rounded transition-all text-left text-[10px] font-pixel ${
                  activeTab === 'pets' ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                🐾 Pets ({pets.length})
              </button>
              <button
                onClick={() => { playClickSound(); setActiveTab('lootboxes'); }}
                className={`px-3 py-2 rounded transition-all text-left text-[10px] font-pixel ${
                  activeTab === 'lootboxes' ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                📦 Loot Boxes
              </button>
            </div>
          </div>
          
          {/* Center: Item list */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Items */}
            <div className="flex-1 p-4 overflow-y-auto chat-scroll">
              {renderTabContent()}
            </div>
          </div>
          
          {/* Right: Character preview */}
          <div className="w-96 border-l border-gray-700 p-6 flex flex-col items-center bg-gray-800/30 shrink-0">
            <h3 className="text-gray-400 font-pixel text-sm mb-4">Character Preview</h3>
            
            <CharacterPreview 
              equippedItems={equippedItems}
              previewItem={previewItem}
              size={280}
              playerName={localPlayer?.name}
              playerOrbs={playerOrbs}
            >
              {/* Action buttons for preview item */}
              {previewItem && (() => {
                const previewingItem = shopItems.find(i => i.id === previewItem);
                if (!previewingItem) return null;
                
                const owned = isOwned(previewItem);
                const equipped = isEquipped(previewItem);
                const canAfford = playerOrbs >= previewingItem.price;
                const rarityColor = RARITY_COLORS[previewingItem.rarity || 'common'];
                
                return (
                  <div className="flex flex-col gap-2 w-full">
                    <p className={`font-pixel text-sm text-center ${rarityColor.text}`}>
                      {previewingItem.name}
                    </p>
                    
                    {!owned && (
                      <>
                        <button
                          onClick={() => handlePurchase(previewingItem)}
                          disabled={!canAfford}
                          className={`w-full py-2 rounded-lg font-pixel text-sm transition-all flex items-center justify-center gap-2 ${
                            canAfford 
                              ? 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white shadow-lg shadow-amber-500/30' 
                              : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                          }`}
                        >
                          <div className="w-4 h-4 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500" />
                          Buy for {previewingItem.price.toLocaleString()}
                        </button>
                        
                        {!canAfford && (
                          <button
                            onClick={() => {
                              playBuyOrbsSound();
                              toggleShop();
                              useGameStore.getState().toggleBuyOrbs();
                            }}
                            className="relative overflow-hidden w-full py-2 rounded-lg font-pixel text-sm 
                                       bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 
                                       text-white shadow-lg shadow-amber-500/40 hover:shadow-amber-500/60
                                       transition-all duration-200 flex items-center justify-center gap-2"
                          >
                            {/* Small particle effects */}
                            <span className="absolute w-1 h-1 bg-yellow-300 rounded-full animate-btn-particle-1 opacity-60" />
                            <span className="absolute w-0.5 h-0.5 bg-amber-200 rounded-full animate-btn-particle-2 opacity-50" />
                            <span className="absolute w-1 h-1 bg-orange-300 rounded-full animate-btn-particle-3 opacity-60" />
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="relative z-10">Buy Orbs</span>
                          </button>
                        )}
                      </>
                    )}
                    
                    {owned && !equipped && (
                      <button
                        onClick={() => handleEquip(previewItem, false)}
                        className="w-full py-2 rounded-lg font-pixel text-sm bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-lg shadow-emerald-500/30 transition-all"
                      >
                        ✓ Equip Item
                      </button>
                    )}
                    
                    {owned && equipped && (
                      <button
                        onClick={() => handleEquip(previewItem, true)}
                        className="w-full py-2 rounded-lg font-pixel text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 transition-all"
                      >
                        Unequip Item
                      </button>
                    )}
                    
                    <button
                      onClick={() => setPreviewItem(undefined)}
                      className="w-full py-1.5 bg-gray-800 hover:bg-gray-700 rounded font-pixel text-xs text-gray-400 transition-colors"
                    >
                      Clear Preview
                    </button>
                  </div>
                );
              })()}
            </CharacterPreview>
            
            {!previewItem && (
              <p className="text-gray-500 font-pixel text-[10px] text-center mt-2">
                Click 👁 on an item to preview
              </p>
            )}
            
            {/* Current outfit summary */}
            <div className="mt-4 pt-3 w-full border-t border-gray-700">
              <p className="text-gray-500 font-pixel text-[10px] mb-2">Currently Equipped:</p>
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                {equippedItems.length === 0 ? (
                  <span className="text-gray-600 font-pixel text-[10px]">Nothing</span>
                ) : (
                  equippedItems.map(itemId => {
                    const item = shopItems.find(i => i.id === itemId);
                    if (!item) return null;
                    const rarityColor = RARITY_COLORS[item.rarity || 'common'];
                    return (
                      <span key={itemId} className={`px-2 py-1 rounded text-[10px] font-pixel ${rarityColor.bg} ${rarityColor.text}`}>
                        {item.name}
                      </span>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Loot Boxes Tab Component
function LootBoxesTab({ shopItems, onOpenLootBox }: { shopItems: ShopItem[]; onOpenLootBox: (lootBox: LootBox) => void }) {
  const playerOrbs = useGameStore(state => state.localPlayer?.orbs || 0);
  const toggleShop = useGameStore(state => state.toggleShop);
  
  // Generate loot boxes from shop items
  const lootBoxes = useMemo(() => {
    const categories: Array<'hats' | 'shirts' | 'legs' | 'capes' | 'wings' | 'accessories' | 'boosts' | 'pets'> = [
      'hats', 'shirts', 'legs', 'capes', 'wings', 'accessories', 'boosts', 'pets'
    ];
    
    const boxes = categories.map(category => {
      // Get all items for this category
      const categoryItems = shopItems.filter(item => {
        // Exclude axe from all lootboxes
        if (item.id === 'tool_axe') return false;
        // Exclude common items from all cases
        if ((item.rarity || 'common') === 'common') return false;
        // Exclude godlike items from regular cases (only available in godlike cases)
        if ((item.rarity || 'common') === 'godlike') return false;
        if (category === 'hats') return item.spriteLayer === 'hat';
        if (category === 'shirts') return item.spriteLayer === 'shirt';
        if (category === 'legs') return item.spriteLayer === 'legs';
        if (category === 'capes') return item.spriteLayer === 'cape';
        if (category === 'wings') return item.spriteLayer === 'wings';
        if (category === 'accessories') return item.spriteLayer === 'accessory';
        if (category === 'boosts') return item.spriteLayer === 'boost';
        if (category === 'pets') return item.spriteLayer === 'pet';
        return false;
      });
      
      if (categoryItems.length === 0) return null;
      
      // Group items by rarity
      const itemsByRarity: Record<ItemRarity, ShopItem[]> = {
        common: [],
        uncommon: [],
        rare: [],
        epic: [],
        legendary: [],
        godlike: [],
      };
      
      categoryItems.forEach(item => {
        const rarity = item.rarity || 'common';
        itemsByRarity[rarity].push(item);
      });
      
      // Adjusted odds: removed common (62%), redistributed proportionally to remaining rarities
      // Original: uncommon 25%, rare 10%, epic 2.5%, legendary 0.5% = 38% total
      // New: scaled to 100% maintaining proportions
      const rarityTotals: Record<ItemRarity, number> = {
        common: 0,
        uncommon: 65.78947368421053,  // 25/38 * 100
        rare: 26.31578947368421,      // 10/38 * 100
        epic: 6.578947368421053,       // 2.5/38 * 100
        legendary: 1.3157894736842105, // 0.5/38 * 100
      };
      
      // Create items with chances distributed evenly within each rarity
      // Special handling for pets: gold, phoenix, void = 20% each, rest = 13.3% each
      let itemsWithChances;
      if (category === 'pets') {
        itemsWithChances = categoryItems.map(item => {
          let chance = 0;
          if (item.id === 'pet_golden' || item.id === 'pet_phoenix' || item.id === 'pet_void') {
            chance = 20.0;
          } else if (item.id === 'pet_celestial' || item.id === 'pet_galaxy' || item.id === 'pet_rainbow') {
            chance = 13.3;
          }
          return {
            item,
            chance,
          };
        });
      } else {
        itemsWithChances = categoryItems.map(item => {
          const rarity = item.rarity || 'common';
          const itemsInRarity = itemsByRarity[rarity].length;
          // Distribute the rarity's total percentage evenly among all items of that rarity
          const chancePerItem = itemsInRarity > 0 ? rarityTotals[rarity] / itemsInRarity : 0;
          
          return {
            item,
            chance: chancePerItem,
          };
        });
      }
      
      // Items are already normalized to sum to 100% (uncommon ~65.79% + rare ~26.32% + epic ~6.58% + legendary ~1.32% = 100%)
      const normalizedItems = itemsWithChances;
      
      // Check if case only contains legendary items
      const onlyLegendary = categoryItems.every(item => (item.rarity || 'common') === 'legendary');
      // Wings case costs 500k, pet case costs 900k, legendary-only cases cost 200k, others cost 2.5k
      let price = 2500;
      if (category === 'wings') {
        price = 500000;
      } else if (category === 'pets') {
        price = 900000;
      } else if (onlyLegendary) {
        price = 200000;
      }
      
      return {
        id: `lootbox_${category}`,
        name: `${category.charAt(0).toUpperCase() + category.slice(1)} Case`,
        category,
        price, // Wings: 500k, legendary-only: 200k, others: 2.5k
        items: normalizedItems,
      } as LootBox;
    }).filter((box): box is LootBox => box !== null);
    
    // Sort by price (most expensive first)
    return boxes.sort((a, b) => b.price - a.price);
  }, [shopItems]);
  
  return (
    <div>
      <p className="text-gray-400 font-pixel text-xs mb-4">
        📦 Open cases to get random items! Each case contains all items from that category with weighted chances based on rarity.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {lootBoxes.map(lootBox => {
          const canAfford = playerOrbs >= lootBox.price;
          return (
            <div
              key={lootBox.id}
              className={`
                bg-gray-800 rounded-lg p-4 border-2 transition-all cursor-pointer
                ${canAfford 
                  ? 'border-amber-500 hover:border-amber-400 hover:shadow-lg hover:shadow-amber-500/30' 
                  : 'border-gray-600 opacity-60'
                }
              `}
              onClick={() => {
                if (canAfford) {
                  playClickSound();
                  onOpenLootBox(lootBox);
                }
              }}
            >
              <div className="text-center mb-3">
                <div className="text-4xl mb-2">📦</div>
                <h3 className="font-pixel text-lg text-amber-400 mb-1">
                  {lootBox.name}
                </h3>
                <div className="flex items-center justify-center gap-2 mb-2">
                  <span className="text-cyan-300 font-pixel">●</span>
                  <span className="text-white font-pixel">{lootBox.price.toLocaleString()}</span>
                </div>
              </div>
              
              {/* Rarity distribution preview */}
              <div className="flex gap-1 justify-center mb-3">
                {RARITY_ORDER.map(rarity => {
                  const count = lootBox.items.filter(i => i.item.rarity === rarity).length;
                  if (count === 0) return null;
                  const color = RARITY_COLORS[rarity];
                  return (
                    <div
                      key={rarity}
                      className={`px-2 py-1 rounded text-[8px] font-pixel ${color.bg} ${color.text}`}
                      title={`${count} ${rarity} items`}
                    >
                      {count}
                    </div>
                  );
                })}
              </div>
              
              {canAfford ? (
                <button
                  className="w-full py-2 rounded font-pixel text-sm transition-all bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white"
                >
                  Open Case
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation(); // Prevent opening the loot box modal
                    playBuyOrbsSound();
                    toggleShop();
                    useGameStore.getState().toggleBuyOrbs();
                  }}
                  className="relative overflow-hidden w-full py-2 rounded font-pixel text-sm transition-all
                             bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 
                             text-white shadow-lg shadow-amber-500/40 hover:shadow-amber-500/60
                             transition-all duration-200 flex items-center justify-center gap-2"
                >
                  {/* Small particle effects */}
                  <span className="absolute w-1 h-1 bg-yellow-300 rounded-full animate-btn-particle-1 opacity-60" />
                  <span className="absolute w-0.5 h-0.5 bg-amber-200 rounded-full animate-btn-particle-2 opacity-50" />
                  <span className="absolute w-1 h-1 bg-orange-300 rounded-full animate-btn-particle-3 opacity-60" />
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="relative z-10">Buy Orbs</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
