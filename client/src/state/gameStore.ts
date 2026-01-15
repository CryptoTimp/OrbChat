import { create } from 'zustand';
import { PlayerWithChat, Orb, ShopItem, InventoryItem, Direction, GAME_CONSTANTS, MapType, ItemRarity, Shrine, TreasureChest, OrbType, TreeState } from '../types';

interface GameState {
  // Connection state
  connected: boolean;
  playerId: string | null;
  roomId: string | null;
  playerName: string;
  mapType: MapType;
  
  // Game entities
  players: Map<string, PlayerWithChat>;
  orbs: Orb[];
  shrines: Shrine[];
  treasureChests: TreasureChest[];
  treeStates: Map<string, TreeState>;
  
  // Local player state
  localPlayer: PlayerWithChat | null;
  clickTarget: { x: number; y: number } | null;
  lastOrbValue?: number; // Last orb value collected (for HUD floating text)
  
  // Shop & Inventory
  shopItems: ShopItem[];
  inventory: InventoryItem[];
  
  // Chat
  chatMessages: Array<{ playerId: string; text: string; createdAt: number }>;
  
  // Session stats (client-side only, resets on room leave)
  sessionStats: {
    totalCollected: number;
    sessionStartTime: number;
    orbTypeCounts: Record<OrbType, number>;
  };
  
  // UI state
  shopOpen: boolean;
  shopInitialTab?: 'hats' | 'shirts' | 'legs' | 'capes' | 'wings' | 'accessories' | 'boosts' | 'pets' | 'lootboxes';
  shopInitialRarity?: ItemRarity;
  selectedLootBox: any | null; // LootBox type from LootBoxModal
  inventoryOpen: boolean;
  settingsOpen: boolean;
  buyOrbsOpen: boolean;
  logDealerOpen: boolean;
  treasureChestModalOpen: boolean;
  selectedTreasureChest: TreasureChest | null;
  treasureChestDealerOpen: boolean;
  confirmModal: {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel?: () => void;
    confirmText?: string;
    cancelText?: string;
    confirmColor?: 'red' | 'green' | 'amber';
  };
  
  // Audio state
  musicEnabled: boolean;
  musicVolume: number;
  sfxEnabled: boolean;
  sfxVolume: number;
  
  // Actions
  setConnected: (connected: boolean) => void;
  setPlayerId: (id: string) => void;
  setRoomId: (id: string) => void;
  setPlayerName: (name: string) => void;
  setMapType: (mapType: MapType) => void;
  
  // Room actions
  setRoomState: (players: PlayerWithChat[], orbs: Orb[], shrines: Shrine[], treasureChests?: TreasureChest[], treeStates?: TreeState[]) => void;
  setRoomStateWithLocalPlayer: (players: PlayerWithChat[], orbs: Orb[], shrines: Shrine[], localPlayer: PlayerWithChat | undefined, treasureChests?: TreasureChest[], treeStates?: TreeState[]) => void;
  setShrines: (shrines: Shrine[]) => void;
  updateShrine: (shrineId: string, updates: Partial<Shrine>) => void;
  setTreasureChests: (chests: TreasureChest[]) => void;
  updateTreasureChest: (chestId: string, updates: Partial<TreasureChest>) => void;
  setTreeState: (treeId: string, state: TreeState) => void;
  updateTreeStates: (treeStates: TreeState[]) => void;
  addPlayer: (player: PlayerWithChat) => void;
  removePlayer: (playerId: string) => void;
  updatePlayerPosition: (playerId: string, x: number, y: number, direction: Direction) => void;
  updatePlayerChat: (playerId: string, text: string, createdAt: number) => void;
  
  // Orb actions
  addOrb: (orb: Orb) => void;
  removeOrb: (orbId: string) => void;
  getOrbById: (orbId: string) => Orb | undefined;
  updatePlayerOrbs: (playerId: string, orbs: number, lastOrbValue?: number) => void;
  
  // Session stats actions
  recordOrbCollection: (orbType: OrbType, value: number) => void;
  resetSessionStats: () => void;
  
  // Shop actions
  setShopItems: (items: ShopItem[]) => void;
  setInventory: (items: InventoryItem[], orbs: number) => void;
  toggleShop: () => void;
  openShopWithFilter: (tab: 'hats' | 'shirts' | 'legs' | 'capes' | 'wings' | 'accessories' | 'boosts' | 'pets' | 'lootboxes', rarity?: ItemRarity) => void;
  setSelectedLootBox: (lootBox: any | null) => void;
  toggleInventory: () => void;
  toggleSettings: () => void;
  toggleBuyOrbs: () => void;
  toggleLogDealer: () => void;
  toggleTreasureChestModal: () => void;
  setSelectedTreasureChest: (chest: TreasureChest | null) => void;
  toggleTreasureChestDealer: () => void;
  setConfirmModal: (modal: GameState['confirmModal']) => void;
  
  // Audio actions
  setMusicEnabled: (enabled: boolean) => void;
  setMusicVolume: (volume: number) => void;
  setSfxEnabled: (enabled: boolean) => void;
  setSfxVolume: (volume: number) => void;
  
  // Chat actions
  addChatMessage: (playerId: string, text: string, createdAt: number) => void;
  
  // Local player actions
  setLocalPlayerPosition: (x: number, y: number, direction: Direction) => void;
  setClickTarget: (x: number | null, y: number | null) => void;
  
  // Room actions
  leaveRoom: () => void;
}

// Get stored player ID from localStorage
const getStoredPlayerId = (): string | null => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('playerId');
  }
  return null;
};

// Store player ID in localStorage
const storePlayerId = (id: string) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('playerId', id);
  }
};

// Get stored audio settings
const getStoredAudioSettings = () => {
  if (typeof window !== 'undefined') {
    return {
      musicEnabled: localStorage.getItem('musicEnabled') !== 'false',
      musicVolume: Number(localStorage.getItem('musicVolume') ?? 40),
      sfxEnabled: localStorage.getItem('sfxEnabled') !== 'false',
      sfxVolume: Number(localStorage.getItem('sfxVolume') ?? 80),
    };
  }
  return { musicEnabled: true, musicVolume: 40, sfxEnabled: true, sfxVolume: 80 };
};

export const useGameStore = create<GameState>((set, get) => ({
  // Initial state
  connected: false,
  playerId: getStoredPlayerId(),
  roomId: null,
  playerName: '',
  mapType: 'cafe' as MapType,
  players: new Map(),
  orbs: [],
  shrines: [],
  treasureChests: [],
  treeStates: new Map(),
  localPlayer: null,
  clickTarget: null,
  shopItems: [],
  inventory: [],
  chatMessages: [],
  sessionStats: {
    totalCollected: 0,
    sessionStartTime: Date.now(),
    orbTypeCounts: {
      common: 0,
      uncommon: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
      normal: 0,
      gold: 0,
      shrine: 0,
    },
  },
  shopOpen: false,
  selectedLootBox: null,
  inventoryOpen: false,
  settingsOpen: false,
  buyOrbsOpen: false,
  logDealerOpen: false,
  treasureChestModalOpen: false,
  selectedTreasureChest: null,
  treasureChestDealerOpen: false,
  confirmModal: {
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  },
  
  // Audio state (loaded from localStorage)
  ...getStoredAudioSettings(),
  
  // Connection actions
  setConnected: (connected) => set({ connected }),
  
  setPlayerId: (id) => {
    if (id) {
      storePlayerId(id);
      set({ playerId: id });
    } else {
      // Clear on sign out
      if (typeof window !== 'undefined') {
        localStorage.removeItem('playerId');
      }
      set({ playerId: null, localPlayer: null, roomId: null, playerName: '' });
    }
  },
  
  setRoomId: (id) => set({ roomId: id }),
  setPlayerName: (name) => set({ playerName: name }),
  setMapType: (mapType) => set({ mapType }),
  
  // Room state actions
  setRoomState: (playersList, orbs, shrines, treasureChests, treeStates) => {
    const currentState = get();
    const players = new Map<string, PlayerWithChat>();
    
    // Preserve existing orb counts for players when new data doesn't include orb count
    // This prevents resetting orb counts when room_state is received without orb data
    for (const player of playersList) {
      // If player exists in current state and has an orb count, preserve it if new player data doesn't include orbs
      const existingPlayer = currentState.players.get(player.id);
      if (existingPlayer && existingPlayer.orbs !== undefined && existingPlayer.orbs !== null && 
          (player.orbs === undefined || player.orbs === null)) {
        // Preserve existing orb count if new player data doesn't include orb count (undefined/null)
        // Note: 0 is a valid orb count, so we don't preserve if new player has 0
        players.set(player.id, { ...player, orbs: existingPlayer.orbs });
      } else {
        // Use new player data (has orb count or is a new player)
        players.set(player.id, player);
      }
      
      // Identify local player
      if (player.id === currentState.playerId) {
        set({ localPlayer: player });
      }
    }
    
    const treeStatesMap = new Map<string, TreeState>();
    if (treeStates) {
      for (const treeState of treeStates) {
        treeStatesMap.set(treeState.treeId, treeState);
      }
    }
    
    set({ players, orbs, shrines, treasureChests: treasureChests || [], treeStates: treeStatesMap });
  },
  
  setRoomStateWithLocalPlayer: (playersList, orbs, shrines, localPlayer, treasureChests, treeStates) => {
    const currentState = get();
    const players = new Map<string, PlayerWithChat>();
    
    // Preserve existing orb counts for players when new data doesn't include orb count
    // This prevents resetting orb counts when room_state is received without orb data
    for (const player of playersList) {
      // If player exists in current state and has an orb count, preserve it if new player data doesn't include orbs
      const existingPlayer = currentState.players.get(player.id);
      if (existingPlayer && existingPlayer.orbs !== undefined && existingPlayer.orbs !== null && 
          (player.orbs === undefined || player.orbs === null)) {
        // Preserve existing orb count if new player data doesn't include orb count (undefined/null)
        // Note: 0 is a valid orb count, so we don't preserve if new player has 0
        players.set(player.id, { ...player, orbs: existingPlayer.orbs });
      } else {
        // Use new player data (has orb count or is a new player)
        players.set(player.id, player);
      }
    }
    
    const treeStatesMap = new Map<string, TreeState>();
    if (treeStates) {
      for (const treeState of treeStates) {
        treeStatesMap.set(treeState.treeId, treeState);
      }
    }
    
    set({ players, orbs, shrines, treasureChests: treasureChests || [], treeStates: treeStatesMap, localPlayer: localPlayer || null });
  },
  
  setShrines: (shrines) => set({ shrines }),
  
  updateShrine: (shrineId, updates) => {
    const shrines = [...get().shrines];
    const index = shrines.findIndex(s => s.id === shrineId);
    if (index !== -1) {
      shrines[index] = { ...shrines[index], ...updates };
      set({ shrines });
    }
  },
  
  setTreasureChests: (chests) => set({ treasureChests: chests }),
  
  updateTreasureChest: (chestId, updates) => {
    const chests = [...get().treasureChests];
    const index = chests.findIndex(c => c.id === chestId);
    if (index !== -1) {
      chests[index] = { ...chests[index], ...updates };
      set({ treasureChests: chests });
    }
  },
  
  setTreeState: (treeId, state) => {
    const treeStates = new Map(get().treeStates);
    treeStates.set(treeId, state);
    set({ treeStates });
  },
  
  updateTreeStates: (treeStatesList) => {
    const treeStates = new Map<string, TreeState>();
    for (const treeState of treeStatesList) {
      treeStates.set(treeState.treeId, treeState);
    }
    set({ treeStates });
  },
  
  addPlayer: (player) => {
    // Ensure player has all required fields
    const completePlayer: PlayerWithChat = {
      ...player,
      sprite: player.sprite || { body: 'default', outfit: [] },
      direction: player.direction || 'down',
      x: typeof player.x === 'number' ? player.x : 0,
      y: typeof player.y === 'number' ? player.y : 0,
      orbs: typeof player.orbs === 'number' ? player.orbs : 0,
    };
    
    const players = new Map(get().players);
    players.set(completePlayer.id, completePlayer);
    
    // Check if this is the local player
    if (completePlayer.id === get().playerId) {
      set({ localPlayer: completePlayer, players });
    } else {
      set({ players });
    }
  },
  
  removePlayer: (playerId) => {
    const players = new Map(get().players);
    players.delete(playerId);
    set({ players });
  },
  
  updatePlayerPosition: (playerId, x, y, direction) => {
    const players = new Map(get().players);
    const player = players.get(playerId);
    
    if (player) {
      players.set(playerId, { ...player, x, y, direction });
      
      // Update local player reference if needed
      if (playerId === get().playerId) {
        set({ 
          players, 
          localPlayer: { ...player, x, y, direction } 
        });
      } else {
        set({ players });
      }
    }
  },
  
  updatePlayerChat: (playerId, text, createdAt) => {
    const players = new Map(get().players);
    const player = players.get(playerId);
    const state = get();
    
    if (player) {
      const updatedPlayer = { 
        ...player, 
        chatBubble: { text, createdAt } 
      };
      players.set(playerId, updatedPlayer);
      
      // Also update localPlayer if this is us
      if (playerId === state.playerId) {
        set({ players, localPlayer: updatedPlayer });
      } else {
        set({ players });
      }
      
      // Clear bubble after duration
      setTimeout(() => {
        const currentPlayers = new Map(get().players);
        const currentPlayer = currentPlayers.get(playerId);
        const currentState = get();
        
        if (currentPlayer && currentPlayer.chatBubble?.createdAt === createdAt) {
          const clearedPlayer = { ...currentPlayer, chatBubble: undefined };
          currentPlayers.set(playerId, clearedPlayer);
          
          // Also clear localPlayer bubble if this is us
          if (playerId === currentState.playerId) {
            set({ players: currentPlayers, localPlayer: clearedPlayer });
          } else {
            set({ players: currentPlayers });
          }
        }
      }, GAME_CONSTANTS.CHAT_BUBBLE_DURATION);
    }
  },
  
  // Orb actions
  addOrb: (orb) => {
    set({ orbs: [...get().orbs, orb] });
  },
  
  removeOrb: (orbId) => {
    set({ orbs: get().orbs.filter(o => o.id !== orbId) });
  },
  
  getOrbById: (orbId) => {
    return get().orbs.find(o => o.id === orbId);
  },
  
  updatePlayerOrbs: (playerId, orbs, lastOrbValue) => {
    const players = new Map(get().players);
    const player = players.get(playerId);
    
    if (player) {
      players.set(playerId, { ...player, orbs });
      
      if (playerId === get().playerId) {
        set({ 
          players, 
          localPlayer: { ...get().localPlayer!, orbs },
          lastOrbValue: lastOrbValue || undefined // Store last orb value for HUD
        });
      } else {
        set({ players });
      }
    }
  },
  
  // Session stats actions
  recordOrbCollection: (orbType, value) => {
    const stats = get().sessionStats;
    const updatedCounts = { ...stats.orbTypeCounts };
    updatedCounts[orbType] = (updatedCounts[orbType] || 0) + 1;
    
    set({
      sessionStats: {
        totalCollected: stats.totalCollected + value,
        sessionStartTime: stats.sessionStartTime,
        orbTypeCounts: updatedCounts,
      },
    });
  },
  
  resetSessionStats: () => {
    set({
      sessionStats: {
        totalCollected: 0,
        sessionStartTime: Date.now(),
        orbTypeCounts: {
          common: 0,
          uncommon: 0,
          rare: 0,
          epic: 0,
          legendary: 0,
          normal: 0,
          gold: 0,
          shrine: 0,
        },
      },
    });
  },
  
  // Shop actions
  setShopItems: (items) => set({ shopItems: items }),
  
  setInventory: (items, orbs) => {
    set({ inventory: items });
    
    // Also update local player orbs
    const localPlayer = get().localPlayer;
    if (localPlayer) {
      const players = new Map(get().players);
      players.set(localPlayer.id, { ...localPlayer, orbs });
      set({ 
        localPlayer: { ...localPlayer, orbs },
        players 
      });
    }
  },
  
    toggleShop: () => set({ shopOpen: !get().shopOpen }),
    openShopWithFilter: (tab, rarity?) => {
      set({ 
        shopOpen: true,
        shopInitialTab: tab,
        shopInitialRarity: rarity, // Optional - if not provided, no filter is applied
      });
    },
    setSelectedLootBox: (lootBox) => set({ selectedLootBox: lootBox }),
  toggleInventory: () => set({ inventoryOpen: !get().inventoryOpen }),
  toggleSettings: () => set({ settingsOpen: !get().settingsOpen }),
  toggleBuyOrbs: () => set({ buyOrbsOpen: !get().buyOrbsOpen }),
  toggleLogDealer: () => set({ logDealerOpen: !get().logDealerOpen }),
  toggleTreasureChestModal: () => set({ treasureChestModalOpen: !get().treasureChestModalOpen }),
  setSelectedTreasureChest: (chest) => set({ selectedTreasureChest: chest }),
  toggleTreasureChestDealer: () => set({ treasureChestDealerOpen: !get().treasureChestDealerOpen }),
  setConfirmModal: (modal) => set({ confirmModal: modal }),
  
  // Audio actions
  setMusicEnabled: (enabled) => {
    localStorage.setItem('musicEnabled', String(enabled));
    set({ musicEnabled: enabled });
  },
  setMusicVolume: (volume) => {
    localStorage.setItem('musicVolume', String(volume));
    set({ musicVolume: volume });
  },
  setSfxEnabled: (enabled) => {
    localStorage.setItem('sfxEnabled', String(enabled));
    set({ sfxEnabled: enabled });
  },
  setSfxVolume: (volume) => {
    localStorage.setItem('sfxVolume', String(volume));
    set({ sfxVolume: volume });
  },
  
  // Chat actions
  addChatMessage: (playerId, text, createdAt) => {
    const currentMessages = get().chatMessages;
    console.log('addChatMessage called:', { playerId, text, createdAt, currentCount: currentMessages.length });
    
    // Deduplicate: check if this exact message already exists (same player, text, and within 1 second)
    const isDuplicate = currentMessages.some(msg => 
      msg.playerId === playerId && 
      msg.text === text && 
      Math.abs(msg.createdAt - createdAt) < 1000 // Within 1 second
    );
    
    if (isDuplicate) {
      console.log('Skipping duplicate chat message:', playerId, text);
      return;
    }
    
    const messages = [...currentMessages, { playerId, text, createdAt }];
    // Keep only last 50 messages
    if (messages.length > 50) {
      messages.shift();
    }
    console.log('Setting chat messages, new count:', messages.length);
    set({ chatMessages: messages });
    console.log('Chat messages updated, current state:', get().chatMessages.length);
  },
  
  // Local player movement
  setLocalPlayerPosition: (x, y, direction) => {
    const localPlayer = get().localPlayer;
    if (localPlayer) {
      const updatedPlayer = { ...localPlayer, x, y, direction };
      const players = new Map(get().players);
      players.set(localPlayer.id, updatedPlayer);
      set({ localPlayer: updatedPlayer, players });
    }
  },
  
  // Set click target for movement
  setClickTarget: (x, y) => {
    if (x === null || y === null) {
      set({ clickTarget: null });
    } else {
      set({ clickTarget: { x, y } });
    }
  },
  
  // Leave current room
  leaveRoom: () => {
    const state = get();
    // Reset session stats when leaving room
    state.resetSessionStats();
    set({
      roomId: null,
      localPlayer: null,
      players: new Map(),
      orbs: [],
      shrines: [],
      chatMessages: [],
      clickTarget: null,
    });
  },
}));
