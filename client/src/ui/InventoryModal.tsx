import { useState, useEffect } from 'react';
import { useGameStore } from '../state/gameStore';
import { useSocket } from '../hooks/useSocket';
import { RARITY_COLORS, ItemRarity } from '../types';
import { ItemPreview } from './ItemPreview';
import { CharacterPreview } from './CharacterPreview';
import { playClickSound, playCloseSound, playEquipSound } from '../utils/sounds';

const RARITY_ORDER: ItemRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

export function InventoryModal() {
  const inventoryOpen = useGameStore(state => state.inventoryOpen);
  const toggleInventory = useGameStore(state => state.toggleInventory);
  const shopItems = useGameStore(state => state.shopItems);
  const inventory = useGameStore(state => state.inventory);
  const localPlayer = useGameStore(state => state.localPlayer);
  const { equipItem } = useSocket();
  
  const [activeTab, setActiveTab] = useState<'all' | 'tools' | 'hats' | 'shirts' | 'legs' | 'capes' | 'wings' | 'accessories' | 'boosts' | 'pets'>('all');
  const [rarityFilter, setRarityFilter] = useState<ItemRarity | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [previewItem, setPreviewItem] = useState<string | undefined>(undefined);

  // Clear search and preview when modal closes
  useEffect(() => {
    if (!inventoryOpen) {
      setSearchQuery('');
      setPreviewItem(undefined);
    }
  }, [inventoryOpen]);

  if (!inventoryOpen) return null;

  const equippedItems = inventory.filter(inv => inv.equipped).map(inv => inv.itemId);

  // Separate logs from cosmetic items
  const logs = inventory.filter(inv => inv.itemId === 'log');
  const logCount = logs.length;
  const cosmeticItems = inventory.filter(inv => inv.itemId !== 'log');

  // Get owned items with their shop details (excluding logs)
  const ownedItems = cosmeticItems.map(inv => {
    const shopItem = shopItems.find(item => item.id === inv.itemId);
    return {
      ...inv,
      details: shopItem,
    };
  }).filter(item => item.details);
  
  // Sort by rarity
  const sortByRarity = (items: typeof ownedItems) => {
    return [...items].sort((a, b) => {
      const aIndex = RARITY_ORDER.indexOf(a.details?.rarity || 'common');
      const bIndex = RARITY_ORDER.indexOf(b.details?.rarity || 'common');
      return aIndex - bIndex;
    });
  };
  
  // Filter items by rarity and search query
  const filterItems = (items: typeof ownedItems) => {
    let filtered = items;
    
    // Apply rarity filter
    if (rarityFilter) {
      filtered = filtered.filter(item => (item.details?.rarity || 'common') === rarityFilter);
    }
    
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(item => 
        item.details?.name.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  };

  // Group items by layer (with filters applied)
  // Separate tools from accessories (tools have id starting with 'tool_')
  const tools = sortByRarity(filterItems(ownedItems.filter(item => item.itemId.startsWith('tool_'))));
  const accessories = sortByRarity(filterItems(ownedItems.filter(item => item.details?.spriteLayer === 'accessory' && !item.itemId.startsWith('tool_'))));
  const hats = sortByRarity(filterItems(ownedItems.filter(item => item.details?.spriteLayer === 'hat')));
  const shirts = sortByRarity(filterItems(ownedItems.filter(item => item.details?.spriteLayer === 'shirt')));
  const legs = sortByRarity(filterItems(ownedItems.filter(item => item.details?.spriteLayer === 'legs')));
  const capes = sortByRarity(filterItems(ownedItems.filter(item => item.details?.spriteLayer === 'cape')));
  const wings = sortByRarity(filterItems(ownedItems.filter(item => item.details?.spriteLayer === 'wings')));
  const boosts = sortByRarity(filterItems(ownedItems.filter(item => item.details?.spriteLayer === 'boost')));
  const pets = sortByRarity(filterItems(ownedItems.filter(item => item.details?.spriteLayer === 'pet')));

  const handleEquip = (itemId: string, currentlyEquipped: boolean) => {
    playEquipSound();
    equipItem(itemId, !currentlyEquipped);
  };

  const handlePreview = (itemId: string) => {
    playClickSound();
    setPreviewItem(prev => prev === itemId ? undefined : itemId);
  };

  const renderItem = (item: typeof ownedItems[0]) => {
    if (!item.details) return null;
    const rarityColor = RARITY_COLORS[item.details.rarity || 'common'];
    const isPreviewing = previewItem === item.itemId;
    
    return (
      <div
        key={item.itemId}
        className={`
          bg-gray-800 rounded-lg p-2 transition-all relative
          ${item.equipped 
            ? 'border-2 border-emerald-500 shadow-lg shadow-emerald-500/20' 
            : isPreviewing
            ? 'border-2 border-amber-500 shadow-lg shadow-amber-500/20'
            : `border-2 ${rarityColor.border} hover:shadow-lg`}
        `}
        style={!item.equipped && !isPreviewing ? { boxShadow: `0 0 8px ${rarityColor.glow}` } : undefined}
      >
        {/* Rarity indicator */}
        <div className={`absolute top-1 right-1 px-1.5 py-0.5 rounded text-[8px] font-pixel ${rarityColor.bg} ${rarityColor.text}`}>
          {(item.details.rarity || 'common').charAt(0).toUpperCase()}
        </div>
        
        {/* Item preview */}
        <div className="w-full aspect-square bg-gray-900 rounded-lg mb-2 flex items-center justify-center relative">
          <ItemPreview item={item.details} size={64} />
          {item.equipped && (
            <div className="absolute top-1 left-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
        </div>

        {/* Item name */}
        <p className={`font-pixel text-[10px] text-center truncate ${rarityColor.text}`}>
          {item.details.name}
        </p>
        
        {/* Boost indicators */}
        {item.details.speedMultiplier && (
          <p className="text-[8px] font-pixel text-center" style={{ color: item.details.trailColor }}>
            ⚡ {Math.round((item.details.speedMultiplier - 1) * 100)}% Speed
          </p>
        )}
        {item.details.orbMultiplier && (
          <p className="text-[8px] font-pixel text-center" style={{ color: '#fbbf24' }}>
            $ {Math.round((item.details.orbMultiplier - 1) * 100)}% More Orbs
          </p>
        )}

        {/* Action buttons - hide for tools */}
        {!item.itemId.startsWith('tool_') && (
          <div className="flex gap-1 mt-1">
            <button
              onClick={() => handleEquip(item.itemId, item.equipped)}
              className={`
                flex-1 py-1.5 rounded font-pixel text-[10px] transition-colors
                ${item.equipped 
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white' 
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                }
              `}
            >
              {item.equipped ? '✓' : 'Equip'}
            </button>
            
            {/* Preview button */}
            <button
              onClick={() => handlePreview(item.itemId)}
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
        )}
      </div>
    );
  };

  const renderEmptyState = (category: string) => (
    <div className="col-span-full py-8 text-center">
      <p className="text-gray-500 font-pixel text-[10px]">No {category} owned</p>
      <p className="text-gray-600 font-pixel text-[10px] mt-1">Visit the shop to buy some!</p>
    </div>
  );
  
  const renderTabContent = () => {
    switch (activeTab) {
      case 'all':
        // Combine all items from all categories and sort by rarity (common at top)
        const allItems = sortByRarity([...tools, ...hats, ...shirts, ...legs, ...capes, ...wings, ...accessories, ...boosts, ...pets]);
        return (
          <div>
            {/* Logs section */}
            {logCount > 0 && (
              <div className="mb-4">
                <h3 className="text-gray-300 font-pixel text-sm mb-2">🪵 Resources</h3>
                <div className="bg-gray-800 rounded-lg p-4 border-2 border-amber-500">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="text-4xl">🪵</div>
                      <div>
                        <p className="text-white font-pixel text-sm">Logs</p>
                        <p className="text-gray-400 font-pixel text-xs">Sell to log dealer for 100 orbs each</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-amber-300 font-pixel text-lg">{logCount}</p>
                      <p className="text-cyan-300 font-pixel text-xs">● {logCount * 100}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {/* Tools section */}
            {tools.length > 0 && (
              <div className="mb-4">
                <h3 className="text-gray-300 font-pixel text-sm mb-2">🪓 Tools</h3>
                <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2">
                  {tools.map(renderItem)}
                </div>
              </div>
            )}
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2">
              {allItems.length > 0 ? allItems.map(renderItem) : (
                <div className="col-span-full py-8 text-center">
                  <p className="text-gray-500 font-pixel text-[10px]">No items found</p>
                  <p className="text-gray-600 font-pixel text-[10px] mt-1">Visit the shop to buy some!</p>
                </div>
              )}
            </div>
          </div>
        );
      case 'hats':
        return (
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2">
            {hats.length > 0 ? hats.map(renderItem) : renderEmptyState('hats')}
          </div>
        );
      case 'shirts':
        return (
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2">
            {shirts.length > 0 ? shirts.map(renderItem) : renderEmptyState('shirts')}
          </div>
        );
      case 'legs':
        return (
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2">
            {legs.length > 0 ? legs.map(renderItem) : renderEmptyState('legs')}
          </div>
        );
      case 'capes':
        return (
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2">
            {capes.length > 0 ? capes.map(renderItem) : renderEmptyState('capes')}
          </div>
        );
      case 'wings':
        return (
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2">
            {wings.length > 0 ? wings.map(renderItem) : renderEmptyState('wings')}
          </div>
        );
      case 'accessories':
        return (
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2">
            {accessories.length > 0 ? accessories.map(renderItem) : renderEmptyState('accessories')}
          </div>
        );
      case 'boosts':
        return (
          <div>
            {boosts.length > 0 ? (
              <>
                <p className="text-gray-400 font-pixel text-xs mb-4">
                  ⚡ Equipped boosts enhance your gameplay! Speed boosts increase movement speed, orb boosts increase orb rewards!
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                  {boosts.map(renderItem)}
                </div>
              </>
            ) : (
              renderEmptyState('boosts')
            )}
          </div>
        );
      case 'pets':
        return (
          <div>
            {pets.length > 0 ? (
              <>
                <p className="text-gray-400 font-pixel text-xs mb-4">
                  🐾 Legendary pets follow you around! They're purely cosmetic and visible to all players.
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                  {pets.map(renderItem)}
                </div>
              </>
            ) : (
              renderEmptyState('pets')
            )}
          </div>
        );
      case 'tools':
        return (
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2">
            {tools.length > 0 ? tools.map(renderItem) : renderEmptyState('tools')}
          </div>
        );
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-2">
      <div className="bg-gray-900 rounded-xl border border-gray-700 shadow-2xl w-[95vw] h-[95vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700 shrink-0">
          <h2 className="text-xl font-pixel text-purple-400 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
            My Inventory
          </h2>

          {/* Item count & close */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-gray-800 px-3 py-1 rounded-lg">
              <span className="text-purple-300 font-pixel text-sm">{ownedItems.length} items</span>
            </div>

            <button
              onClick={() => { playCloseSound(); toggleInventory(); }}
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
                className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm font-pixel text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
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
                  activeTab === 'all' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                📦 All ({[...tools, ...hats, ...shirts, ...legs, ...capes, ...wings, ...accessories, ...boosts, ...pets].length})
              </button>
              
              {/* Cosmetics Section */}
              <p className="text-gray-500 font-pixel text-[10px] mb-1 mt-2">Cosmetics</p>
              <button
                onClick={() => { playClickSound(); setActiveTab('hats'); }}
                className={`px-3 py-2 rounded transition-all text-left text-[10px] font-pixel ${
                  activeTab === 'hats' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                👒 Hats ({hats.length})
              </button>
              <button
                onClick={() => { playClickSound(); setActiveTab('shirts'); }}
                className={`px-3 py-2 rounded transition-all text-left text-[10px] font-pixel ${
                  activeTab === 'shirts' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                👕 Shirts ({shirts.length})
              </button>
              <button
                onClick={() => { playClickSound(); setActiveTab('legs'); }}
                className={`px-3 py-2 rounded transition-all text-left text-[10px] font-pixel ${
                  activeTab === 'legs' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                👖 Legs ({legs.length})
              </button>
              <button
                onClick={() => { playClickSound(); setActiveTab('capes'); }}
                className={`px-3 py-2 rounded transition-all text-left text-[10px] font-pixel ${
                  activeTab === 'capes' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                🦸 Capes ({capes.length})
              </button>
              <button
                onClick={() => { playClickSound(); setActiveTab('wings'); }}
                className={`px-3 py-2 rounded transition-all text-left text-[10px] font-pixel ${
                  activeTab === 'wings' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                🦅 Wings ({wings.length})
              </button>
              <button
                onClick={() => { playClickSound(); setActiveTab('accessories'); }}
                className={`px-3 py-2 rounded transition-all text-left text-[10px] font-pixel ${
                  activeTab === 'accessories' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                ✨ Accessories ({accessories.length})
              </button>
              <button
                onClick={() => { playClickSound(); setActiveTab('pets'); }}
                className={`px-3 py-2 rounded transition-all text-left text-[10px] font-pixel ${
                  activeTab === 'pets' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                🐾 Pets ({pets.length})
              </button>
              
              {/* Utility Section */}
              <p className="text-gray-500 font-pixel text-[10px] mb-1 mt-2">Utility</p>
              <button
                onClick={() => { playClickSound(); setActiveTab('tools'); }}
                className={`px-3 py-2 rounded transition-all text-left text-[10px] font-pixel ${
                  activeTab === 'tools' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                🪓 Tools ({tools.length})
              </button>
              <button
                onClick={() => { playClickSound(); setActiveTab('boosts'); }}
                className={`px-3 py-2 rounded transition-all text-left text-[10px] font-pixel ${
                  activeTab === 'boosts' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                ⚡ Boosts ({boosts.length})
              </button>
            </div>
          </div>
          
          {/* Center: Item list */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Items */}
            <div className="flex-1 p-4 overflow-y-auto chat-scroll">
              {ownedItems.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="w-16 h-16 mx-auto mb-4 bg-gray-800 rounded-full flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                    </svg>
                  </div>
                  <p className="text-gray-400 font-pixel text-sm">Your inventory is empty</p>
                  <p className="text-gray-500 font-pixel text-xs mt-2">Visit the shop to buy cosmetics!</p>
                </div>
              ) : (
                renderTabContent()
              )}
            </div>
          </div>

          {/* Right: Character preview */}
          <div className="w-96 border-l border-gray-700 p-6 flex flex-col items-center bg-gray-800/30 shrink-0">
            <h3 className="text-gray-400 font-pixel text-sm mb-4">Your Character</h3>
            
            <CharacterPreview 
              equippedItems={equippedItems}
              previewItem={previewItem}
              size={280}
              playerName={localPlayer?.name}
              playerOrbs={localPlayer?.orbs || 0}
            />
            
            {/* Current outfit summary */}
            <div className="mt-4 pt-3 w-full border-t border-gray-700">
              <p className="text-gray-500 font-pixel text-[10px] mb-2">Currently Equipped:</p>
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                {equippedItems.length === 0 ? (
                  <span className="text-gray-600 font-pixel text-[10px]">Nothing equipped</span>
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
              
              {/* Quick unequip all button */}
              {equippedItems.length > 0 && (
                <button
                  onClick={() => {
                    equippedItems.forEach(itemId => {
                      equipItem(itemId, false);
                    });
                  }}
                  className="mt-3 w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded font-pixel text-xs text-gray-300"
                >
                  Unequip All
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
