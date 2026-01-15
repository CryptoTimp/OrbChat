import { useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useGameStore } from '../state/gameStore';
import { Direction, InventoryItem } from '../types';
import { updateUserOrbs, getUserProfile, updateEquippedItems, addToInventory, updateGoldCoins } from '../firebase/auth';
import { ref, set } from 'firebase/database';
import { database } from '../firebase/config';
import { addNotification } from '../ui/Notifications';
import { playPickupSound, playShrineRejectionSound, playShrineRewardSound, playSellSound } from '../utils/sounds';
import { setShrineSpeechBubble } from '../game/renderer';

// Socket.IO server URL
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 
  (import.meta.env.DEV ? 'http://localhost:3001' : '');

// Singleton socket instance - survives HMR
let socket: Socket | null = null;
let listenersAttached = false;
let pendingRejoin = false;  // Prevent duplicate rejoins

// Sync orb balance from Firebase (source of truth)
async function syncOrbsFromFirebase(playerId: string): Promise<void> {
  try {
    const profile = await getUserProfile(playerId);
    if (profile) {
      const firebaseOrbs = profile.orbs || 0;
      const state = useGameStore.getState();
      
      // Only update if the value is different to avoid triggering floating text unnecessarily
      const currentOrbs = state.localPlayer?.orbs || 0;
      if (firebaseOrbs !== currentOrbs) {
        // Update game store with Firebase value (without lastOrbValue to avoid floating text)
        state.updatePlayerOrbs(playerId, firebaseOrbs);
      }
    }
  } catch (error) {
    console.error('Failed to sync orbs from Firebase:', error);
  }
}

function getOrCreateSocket(): Socket {
  if (!socket) {
    // Get the current player ID from store (Firebase UID) or localStorage
    const playerId = useGameStore.getState().playerId || localStorage.getItem('playerId');
    
    socket = io(SOCKET_URL, {
      auth: { playerId },
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 10000,
    });
  }
  return socket;
}

// Force recreate socket with new auth (e.g., after login)
function recreateSocket(): Socket {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  listenersAttached = false;
  pendingRejoin = false;
  return getOrCreateSocket();
}

function attachListeners(sock: Socket) {
  if (listenersAttached) return;
  listenersAttached = true;
  
  // Connection events
  sock.on('connect', () => {
    console.log('Connected to server, socket id:', sock.id);
    useGameStore.getState().setConnected(true);
    
    // Auto-rejoin room if we were in one (but only once)
    // IMPORTANT: Only auto-rejoin if we have a localPlayer (meaning we were successfully in a room before)
    // Don't auto-rejoin if we just have roomId from a failed join attempt
    const state = useGameStore.getState();
    if (state.roomId && state.playerName && state.localPlayer && !pendingRejoin) {
      pendingRejoin = true;
      console.log('Auto-rejoining room:', state.roomId, 'with map:', state.mapType);
      sock.emit('join_room', { 
        roomId: state.roomId, 
        playerName: state.playerName,
        mapType: state.mapType,
        orbs: state.localPlayer?.orbs || 0,
        equippedItems: state.localPlayer?.sprite?.outfit || [],
      });
    } else if (state.roomId && !state.localPlayer) {
      // If we have roomId but no localPlayer, it means a join failed - clear it
      console.log('Clearing stale roomId (no localPlayer):', state.roomId);
      state.setRoomId('');
      state.setPlayerName('');
    }
  });
  
  sock.on('disconnect', (reason) => {
    console.log('Disconnected from server, reason:', reason);
    useGameStore.getState().setConnected(false);
    pendingRejoin = false;  // Allow rejoin on next connect
  });
  
  sock.on('connect_error', (error) => {
    console.error('Connection error:', error.message);
  });
  
  // Room state events
  sock.on('room_state', async ({ roomId, players, orbs, shrines, treasureChests, treeStates, yourPlayerId, mapType }) => {
    console.log('Received room_state:', roomId, 'players:', players?.length || 0, 'yourPlayerId:', yourPlayerId, 'map:', mapType);
    console.log('Tree states received:', treeStates?.length || 0);
    console.log('Player list:', players?.map((p: any) => `${p.name} (${p.id})`) || 'NO PLAYERS');
    
    // Ensure players is an array
    if (!Array.isArray(players)) {
      console.error('Invalid players array received:', players);
      return;
    }
    
    // Sync orb balance from Firebase (source of truth) when joining room
    if (yourPlayerId) {
      await syncOrbsFromFirebase(yourPlayerId);
    }
    
    const store = useGameStore.getState();
    const wasInRoom = store.roomId === roomId && store.localPlayer; // Check if already fully in this room
    
    pendingRejoin = false;  // Reset rejoin flag after successful join
    store.setRoomId(roomId);
    
    // Set map type if provided by server (server is source of truth)
    if (mapType) {
      console.log(`Setting mapType from server: ${mapType} (was: ${store.mapType})`);
      store.setMapType(mapType);
    } else {
      console.warn('No mapType received from server, keeping current:', store.mapType);
    }
    
    // Use the explicit player ID from server if provided
    if (yourPlayerId) {
      store.setPlayerId(yourPlayerId);
    }
    
    // Find our player using the confirmed ID
    const confirmedId = yourPlayerId || store.playerId;
    const ourPlayer = players.find((p: any) => p.id === confirmedId);
    console.log('Found local player:', ourPlayer ? `${ourPlayer.name} (${ourPlayer.id})` : 'NOT FOUND');
    console.log('Setting', players.length, 'players in store');
    
    // If this is a broadcast update (no yourPlayerId), preserve existing localPlayer
    const localPlayerToUse = yourPlayerId ? ourPlayer : (store.localPlayer || ourPlayer);
    
    // Set room state with explicit localPlayer - this should set ALL players
    store.setRoomStateWithLocalPlayer(players, orbs, shrines || [], localPlayerToUse, treasureChests || [], treeStates);
    
    // Verify players were set
    const afterState = useGameStore.getState();
    console.log('After setRoomStateWithLocalPlayer - players in store:', afterState.players.size);
    console.log('Players in store:', Array.from(afterState.players.keys()));
    
    // Show notification that WE joined (only for initial join, not reconnects)
    if (!wasInRoom && ourPlayer && yourPlayerId) {
      addNotification(`You joined room "${roomId}"`, 'join');
    }
  });
  
  sock.on('player_joined', (player) => {
    const state = useGameStore.getState();
    const isLocalPlayer = player.id === state.playerId;
    
    console.log('Received player_joined event:', player.name, player.id, {
      x: player.x,
      y: player.y,
      direction: player.direction,
      sprite: player.sprite,
      outfit: player.sprite?.outfit,
      isLocalPlayer,
    });
    
    // Always update/add the player (even if it's ourselves, to update sprite)
    // This ensures sprite changes (like equipping items) are reflected
    const existingPlayer = state.players.get(player.id);
    const isNewPlayer = !existingPlayer;
    
    state.addPlayer(player);
    
    // Verify player was added/updated
    const afterState = useGameStore.getState();
    const wasAdded = afterState.players.has(player.id);
    const updatedPlayer = afterState.players.get(player.id);
    console.log(`Player ${player.name} ${isNewPlayer ? 'added' : 'updated'} in store:`, wasAdded, 
                'Total players:', afterState.players.size,
                'Updated sprite outfit:', updatedPlayer?.sprite?.outfit);
    
    // Spawn smoke effect at player position (for new players)
    if (isNewPlayer) {
      import('../game/renderer').then(({ spawnSmokeEffect }) => {
        import('../types').then(({ GAME_CONSTANTS }) => {
          const { SCALE, PLAYER_WIDTH, PLAYER_HEIGHT } = GAME_CONSTANTS;
          const smokeX = player.x * SCALE + (PLAYER_WIDTH * SCALE) / 2; // Center of player
          const smokeY = player.y * SCALE + (PLAYER_HEIGHT * SCALE) / 2; // Center of player
          spawnSmokeEffect(smokeX, smokeY);
        });
      });
    }
    
    // Only show notification for new players joining (not sprite updates)
    if (isNewPlayer && !isLocalPlayer) {
      addNotification(`${player.name} joined the room`, 'join');
      
      // Add chat message for player joining
      const createdAt = Date.now();
      state.addChatMessage(player.id, `${player.name} joined the room`, createdAt);
    }
  });
  
  sock.on('player_left', ({ playerId }) => {
    console.log('Player left:', playerId);
    // Get player name and position before removing
    const players = useGameStore.getState().players;
    const player = players.get(playerId);
    
    // Spawn smoke effect at player's last position
    if (player) {
      const playerName = player.name || 'Someone';
      const playerX = player.x;
      const playerY = player.y;
      
      import('../game/renderer').then(({ spawnSmokeEffect }) => {
        import('../types').then(({ GAME_CONSTANTS }) => {
          const { SCALE, PLAYER_WIDTH, PLAYER_HEIGHT } = GAME_CONSTANTS;
          const smokeX = playerX * SCALE + (PLAYER_WIDTH * SCALE) / 2; // Center of player
          const smokeY = playerY * SCALE + (PLAYER_HEIGHT * SCALE) / 2; // Center of player
          spawnSmokeEffect(smokeX, smokeY);
        });
      });
      
      useGameStore.getState().removePlayer(playerId);
      addNotification(`${playerName} left the room`, 'leave');
      
      // Add chat message for player leaving
      const createdAt = Date.now();
      useGameStore.getState().addChatMessage(playerId, `${playerName} left the room`, createdAt);
    } else {
      useGameStore.getState().removePlayer(playerId);
    }
  });
  
  sock.on('player_moved', ({ playerId, x, y, direction }) => {
    const state = useGameStore.getState();
    if (playerId !== state.playerId) {
      state.updatePlayerPosition(playerId, x, y, direction);
    }
  });
  
  // Chat events
  sock.on('chat_message', ({ playerId, text, createdAt }) => {
    console.log('Received chat_message from server:', playerId, text, 'createdAt:', createdAt);
    const state = useGameStore.getState();
    console.log('Current playerId:', state.playerId, 'Received playerId:', playerId, 'Match:', playerId === state.playerId);
    
    // Skip if this is our own message (already added via optimistic update)
    if (playerId === state.playerId) {
      console.log('Skipping own message (already shown via optimistic update)');
      return;
    }
    
    console.log('Adding chat message from other player');
    state.updatePlayerChat(playerId, text, createdAt);
    state.addChatMessage(playerId, text, createdAt);
    console.log('Chat message added, current messages count:', state.chatMessages.length);
  });
  
  // Orb events
  sock.on('orb_spawned', (orb) => {
    useGameStore.getState().addOrb(orb);
    
    // Check if this is a shrine orb and spawn launch animation
    if (orb.fromShrine) {
      import('../game/renderer').then(({ spawnShrineOrbLaunch }) => {
        spawnShrineOrbLaunch(orb);
      });
    } else {
      // Check if this is a fountain orb and spawn spray effect
      import('../game/renderer').then(({ spawnFountainOrbSpray }) => {
        spawnFountainOrbSpray(orb);
      });
    }
  });
  
  // Fountain spawn timing (synchronized across all clients)
  sock.on('fountain_next_spawn', ({ nextSpawnTime }) => {
    import('../game/renderer').then(({ setNextFountainSpawnTime }) => {
      setNextFountainSpawnTime(nextSpawnTime);
    });
  });
  
  sock.on('orb_collected', async ({ orbId, playerId, newBalance, orbValue }) => {
    const state = useGameStore.getState();
    
    // Get orb type before removing (for session stats)
    const orb = state.getOrbById(orbId);
    const orbType = orb?.orbType || 'normal';
    
    state.removeOrb(orbId);
    
    // If this is our orb collection, poll Firebase, add orb value, and update
    if (playerId === state.playerId) {
      // Record session stats
      state.recordOrbCollection(orbType, orbValue || 0);
      // Play pickup sound effect (disabled for now)
      // playPickupSound();
      
      if (orbValue && orbValue > 0) {
        try {
          // Poll Firebase for current balance (source of truth)
          const profile = await getUserProfile(playerId);
          const currentFirebaseOrbs = profile?.orbs || 0;
          
          // Add the orb value to the Firebase balance
          const newFirebaseOrbs = currentFirebaseOrbs + orbValue;
          
          // Update game store immediately with new balance (for instant UI feedback)
          // Pass the orb value for floating text color
          state.updatePlayerOrbs(playerId, newFirebaseOrbs, orbValue);
          
          // Update Firebase in the background (non-blocking)
          updateUserOrbs(playerId, newFirebaseOrbs).catch(error => {
            console.error('Failed to update Firebase orbs:', error);
          });
          
          console.log('Orb collected: +' + orbValue + ', new balance: ' + newFirebaseOrbs);
        } catch (error) {
          console.error('Failed to get Firebase profile:', error);
          // Fallback to server's newBalance if Firebase read fails
          state.updatePlayerOrbs(playerId, newBalance, orbValue);
        }
      } else {
        // If no orbValue, just use server's newBalance
        state.updatePlayerOrbs(playerId, newBalance, 0);
      }
    } else {
      // For other players, just use server's newBalance
      state.updatePlayerOrbs(playerId, newBalance);
    }
  });
  
  // Player orb balance updated (e.g. from purchases)
  sock.on('player_orbs_updated', async ({ playerId, orbs }) => {
    const state = useGameStore.getState();
    
    if (playerId === state.playerId) {
      // For our own balance update, check if the value matches what we already have
      // If it matches, skip the sync to avoid triggering floating text with total difference
      const currentOrbs = state.localPlayer?.orbs || 0;
      if (orbs === currentOrbs) {
        // Value already matches, no need to sync
        return;
      }
      // For our own balance update, sync from Firebase (source of truth)
      await syncOrbsFromFirebase(playerId);
    } else {
      // For other players, update the balance
      // We trust server updates for purchases/transactions (they decrease balance)
      // But we're more careful with orb collection updates (they should only increase)
      const currentPlayer = state.players.get(playerId);
      const currentOrbs = currentPlayer?.orbs;
      
      // Always update if:
      // 1. Player doesn't exist yet (new player)
      // 2. Current balance is 0 or undefined (initial state)
      // 3. New balance is different (could be increase or decrease from purchases)
      if (!currentPlayer || currentOrbs === undefined || currentOrbs === null || currentOrbs === 0 || orbs !== currentOrbs) {
        state.updatePlayerOrbs(playerId, orbs);
      }
    }
  });
  
  // Shop events
  sock.on('shop_items', (items) => {
    useGameStore.getState().setShopItems(items);
  });
  
  sock.on('inventory_updated', async ({ orbs }) => {
    const state = useGameStore.getState();
    
    // Server just sends orbs hint; client loads actual inventory from Firebase (source of truth)
    if (state.playerId) {
      try {
        const profile = await getUserProfile(state.playerId);
        if (profile) {
          // Build inventory items from Firebase data
          const inventoryItems: InventoryItem[] = (profile.inventory || []).map(itemId => ({
            playerId: state.playerId!,
            itemId,
            equipped: (profile.equippedItems || []).includes(itemId),
          }));
          
          // Use Firebase orbs as source of truth
          const firebaseOrbs = profile.orbs || 0;
          state.setInventory(inventoryItems, firebaseOrbs);
          state.updatePlayerOrbs(state.playerId, firebaseOrbs);
          console.log('Loaded inventory from Firebase:', inventoryItems.length, 'items,', firebaseOrbs, 'orbs');
        }
      } catch (error) {
        console.error('Failed to load inventory from Firebase:', error);
        // Fall back to empty inventory
        state.setInventory([], orbs);
      }
    }
  });
  
  sock.on('error', ({ message }) => {
    console.error('Server error:', message);
    
    const state = useGameStore.getState();
    
    // Handle non-critical gameplay errors gracefully (don't disconnect or clear room state)
    const nonCriticalErrors = [
      'enough orbs',
      'shrine',
      'Shrine',
      'need an axe',
      'already cut',
      'being cut',
      'already own',
      'Not enough',
      'no logs',
      'no stones',
      'not cutting',
      'not mining',
      'You are not',
    ];
    
    if (nonCriticalErrors.some(keyword => message.includes(keyword))) {
      // Sync orbs from Firebase to ensure client state is up to date (for orb-related errors)
      if (state.playerId && (message.includes('enough orbs') || message.includes('Not enough'))) {
        syncOrbsFromFirebase(state.playerId).catch(err => {
          console.error('Failed to sync orbs after error:', err);
        });
      }
      // Don't clear room state for gameplay errors - just show notification and continue
      console.log('Gameplay error (non-critical):', message);
      addNotification(message, 'error');
      return;
    }
    
    // ALWAYS clear roomId and playerName on critical errors (password, connection, etc.)
    // This is critical for password errors - we must prevent App.tsx from showing "Connecting to room..."
    console.log('Error handler: Clearing roomId and playerName. Current roomId:', state.roomId, 'Current playerName:', state.playerName);
    state.setRoomId('');
    state.setPlayerName('');
    // Also clear localPlayer if it exists (shouldn't on error, but be safe)
    if (state.localPlayer) {
      console.log('Error handler: Also clearing localPlayer');
      state.setRoomStateWithLocalPlayer([], [], [], undefined);
    }
    
    // Show error notification for password-related errors
    if (message.includes('password') || message.includes('Password') || message.includes('private room') || message.includes('Incorrect password')) {
      addNotification(message, 'error');
    }
  });
  
  // Shrine interaction events
  sock.on('shrine_interacted', ({ shrineId, shrine, message, blessed, orbsSpawned }) => {
    const state = useGameStore.getState();
    
    // Update shrine state
    state.updateShrine(shrineId, shrine);
    
    // Show speech bubble
    setShrineSpeechBubble(shrineId, message);
    
    // Only play reward sound if orbs were actually spawned
    if (blessed && orbsSpawned && orbsSpawned > 0) {
      playShrineRewardSound();
    } else {
      playShrineRejectionSound();
    }
  });
  
  // Shrine interaction errors (non-critical, don't disconnect)
  sock.on('treasure_chest_opened', async ({ chestId, chest, message, coinsFound, openedBy }) => {
    console.log('[useSocket] treasure_chest_opened received:', { chestId, coinsFound, message, chest, openedBy });
    const state = useGameStore.getState();
    const currentPlayerId = state.playerId;
    
    // Update chest state for all players
    if (chest) {
      state.updateTreasureChest(chestId, chest);
    } else {
      console.error('[useSocket] No chest object received in treasure_chest_opened event');
    }
    
    // Play sound for ALL players (reward or empty sound based on result)
    if (coinsFound !== undefined) {
      // Import sounds dynamically to avoid circular dependencies
      const { playChestRewardSound, playChestEmptySound } = await import('../utils/sounds');
      if (coinsFound > 0) {
        // Play reward sound for all players (after delay to sync with chest opening)
        setTimeout(() => {
          playChestRewardSound();
        }, 500);
      } else {
        // Play empty sound for all players (after delay to sync with chest opening)
        setTimeout(() => {
          playChestEmptySound();
        }, 500);
      }
    }
    
    // Only show modal and coins to the player who opened it
    const isOpener = openedBy && currentPlayerId && openedBy === currentPlayerId;
    
    if (isOpener) {
      // If coins found, update Firebase gold_coins (same pattern as logs)
      if (coinsFound && coinsFound > 0 && currentPlayerId) {
        try {
          const profile = await getUserProfile(currentPlayerId);
          if (profile) {
            const currentCoins = profile.gold_coins || 0;
            const newCoins = currentCoins + coinsFound;
            await updateGoldCoins(currentPlayerId, newCoins);
            console.log(`[useSocket] Updated gold coins: ${currentCoins} + ${coinsFound} = ${newCoins}`);
          }
        } catch (error: any) {
          console.error('[useSocket] Failed to update Firebase gold coins:', error);
          // Don't fail the interaction if Firebase update fails
        }
      }
      
      // Store coins found in global variable as fallback (in case event fires before modal listens)
      (window as any).__lastTreasureChestCoins = coinsFound || 0;
      
      // Dispatch custom event immediately (listener is always active)
      const event = new CustomEvent('treasureChestOpened', { 
        detail: { coinsFound: coinsFound || 0 } 
      });
      console.log('[useSocket] Dispatching treasureChestOpened event:', event.detail);
      window.dispatchEvent(event);
      
      // Show modal after dispatching event
      if (chest) {
        console.log('[useSocket] Setting selected chest and opening modal for opener');
        // Set chest first, then open modal (use setTimeout to ensure state updates in order)
        state.setSelectedTreasureChest(chest);
        // Small delay to ensure selectedTreasureChest is set before opening modal
        setTimeout(() => {
          state.toggleTreasureChestModal();
          console.log('[useSocket] Modal state after toggle:', state.treasureChestModalOpen);
        }, 10);
      } else {
        console.error('[useSocket] Cannot open modal: no chest object');
      }
    } else {
      console.log('[useSocket] Not the opener, skipping modal (openedBy:', openedBy, 'currentPlayerId:', currentPlayerId, ')');
    }
    
    // Clear interaction in progress flag (use setTimeout to ensure GameCanvas can access it)
    setTimeout(() => {
      // Access the ref through window or a global store
      if ((window as any).__chestInteractionInProgress) {
        (window as any).__chestInteractionInProgress.delete(chestId);
      }
    }, 100);
    
    // Don't show notification - the modal will display the result
  });
  
  sock.on('treasure_chest_interaction_error', async ({ chestId, message }) => {
    console.log(`[TreasureChest] Interaction error for chest ${chestId}:`, message);
    addNotification(message, 'error');
    
    // Clear interaction in progress flag
    setTimeout(() => {
      if ((window as any).__chestInteractionInProgress) {
        (window as any).__chestInteractionInProgress.delete(chestId);
      }
    }, 100);
  });
  
  sock.on('treasure_chest_relocated', async ({ chestId, chest, oldX, oldY, newX, newY }) => {
    console.log('[useSocket] treasure_chest_relocated received:', { chestId, oldX, oldY, newX, newY });
    const state = useGameStore.getState();
    
    // Mark chest as relocating (fading out) and spawn smoke at old position
    const { spawnSmokeEffect, markChestRelocating, clearChestRelocating } = await import('../game/renderer');
    markChestRelocating(chestId);
    spawnSmokeEffect(oldX, oldY);
    
    // After fade duration, update chest position and spawn smoke at new position
    setTimeout(() => {
      // Update chest state with new position
      if (chest) {
        state.updateTreasureChest(chestId, chest);
      }
      
      // Clear relocating state and spawn smoke at new position (chest appearing)
      clearChestRelocating(chestId);
      spawnSmokeEffect(newX, newY);
    }, 500);
  });
  
  sock.on('gold_coins_sold', async ({ playerId, coinCount, orbsReceived, newBalance }) => {
    const state = useGameStore.getState();
    
    // For our own sale, sync from Firebase to ensure we have the latest balance
    if (playerId === state.playerId) {
      try {
        // Sync orbs from Firebase (client already updated it, but ensure we have latest)
        await syncOrbsFromFirebase(playerId);
        // Get updated profile to ensure we have the correct balance
        const profile = await getUserProfile(playerId);
        if (profile) {
          const firebaseOrbs = profile.orbs || 0;
          state.updatePlayerOrbs(playerId, firebaseOrbs);
          if (state.localPlayer) {
            state.localPlayer.orbs = firebaseOrbs;
          }
        }
      } catch (error) {
        console.error('Failed to sync orbs from Firebase after selling coins:', error);
        // Fallback to server's balance
        state.updatePlayerOrbs(playerId, newBalance);
        if (state.localPlayer && state.localPlayer.id === playerId) {
          state.localPlayer.orbs = newBalance;
        }
      }
      // Show notification
      addNotification(`Sold ${coinCount} gold coins for ${orbsReceived.toLocaleString()} orbs!`, 'success');
    } else {
      // For other players, just update from server
      state.updatePlayerOrbs(playerId, newBalance);
    }
  });
  
  sock.on('shrine_interaction_error', async ({ shrineId, message }) => {
    const state = useGameStore.getState();
    
    // Sync orbs from Firebase to ensure client state is up to date
    if (state.playerId) {
      await syncOrbsFromFirebase(state.playerId);
    }
    
    // Show error message on shrine speech bubble
    setShrineSpeechBubble(shrineId, message);
    playShrineRejectionSound();
  });
  
  // Tree state events
  sock.on('tree_state_updated', ({ treeStates }) => {
    const state = useGameStore.getState();
    state.updateTreeStates(treeStates);
  });
  
  // Tree cut complete event (includes log count)
  sock.on('tree_cut_complete', async ({ treeId, logCount }) => {
    const state = useGameStore.getState();
    const playerId = state.playerId;
    
    if (playerId) {
      try {
        // Server has already added logs to local DB, now add to Firebase
        for (let i = 0; i < logCount; i++) {
          await addToInventory(playerId, 'log');
        }
        
        // Reload inventory from Firebase to get updated count
        const profile = await getUserProfile(playerId);
        if (profile) {
          const inventoryItems: InventoryItem[] = (profile.inventory || []).map(itemId => ({
            playerId,
            itemId,
            equipped: (profile.equippedItems || []).includes(itemId),
          }));
          
          state.setInventory(inventoryItems, profile.orbs || 0);
          
          // Show notification with log count
          addNotification(`You received ${logCount} log${logCount !== 1 ? 's' : ''}!`, 'success');
        }
      } catch (error) {
        console.error('Failed to update Firebase inventory after cutting tree:', error);
      }
    }
  });
  
  // Logs sold event
  sock.on('logs_sold', async ({ playerId, logCount, orbsReceived, newBalance }) => {
    const state = useGameStore.getState();
    
    if (playerId === state.playerId) {
      // For our own sale, use the server's newBalance (source of truth for the transaction)
      // Also update Firebase to keep it in sync
      try {
        await updateUserOrbs(playerId, newBalance);
      } catch (error) {
        console.error('Failed to update Firebase orbs after selling logs:', error);
      }
      // Update local state with server's confirmed balance
      state.updatePlayerOrbs(playerId, newBalance);
      addNotification(`Sold ${logCount} log${logCount !== 1 ? 's' : ''} for ${orbsReceived.toLocaleString()} orbs!`, 'success');
    } else {
      // For other players, just update from server
      state.updatePlayerOrbs(playerId, newBalance);
    }
  });
}

export function useSocket() {
  useEffect(() => {
    const sock = getOrCreateSocket();
    attachListeners(sock);
    
    // If socket is already connected (e.g., after HMR), trigger auto-rejoin
    if (sock.connected && !pendingRejoin) {
      const state = useGameStore.getState();
      if (state.roomId && state.playerName) {
        pendingRejoin = true;
        console.log('Socket already connected, auto-rejoining room:', state.roomId, 'with map:', state.mapType);
        sock.emit('join_room', { 
          roomId: state.roomId, 
          playerName: state.playerName,
          mapType: state.mapType,
          orbs: state.localPlayer?.orbs || 0,
          equippedItems: state.localPlayer?.sprite?.outfit || [],
        });
      }
    }
  }, []);
  
  // Action methods
  const joinRoom = useCallback(async (roomId: string, playerName: string, mapType?: string, password?: string) => {
    // Prevent auto-rejoin from firing during manual join
    pendingRejoin = true;
    
    // Recreate socket to ensure it has the latest auth (Firebase UID)
    const sock = recreateSocket();
    attachListeners(sock);
    
    const playerId = useGameStore.getState().playerId;
    const selectedMap = mapType || useGameStore.getState().mapType;
    console.log('joinRoom called:', roomId, 'as', playerName, 'with playerId:', playerId, 'map:', selectedMap, 'hasPassword:', !!password);
    useGameStore.getState().setPlayerName(playerName);
    // DON'T set roomId here - wait for successful room_state event
    // Setting it too early causes App.tsx to show "Connecting to room..." screen on errors
    
    // Load profile data from Firebase
    let orbs = 0;
    let equippedItems: string[] = [];
    
    if (playerId) {
      try {
        const profile = await getUserProfile(playerId);
        if (profile) {
          orbs = profile.orbs || 0;
          equippedItems = profile.equippedItems || [];
        }
      } catch (error) {
        console.error('Failed to load profile from Firebase:', error);
      }
    }
    
    // Wait for connection before joining
    const joinData = { roomId, playerName, orbs, equippedItems, mapType: selectedMap, password };
    
    if (sock.connected) {
      sock.emit('join_room', joinData);
    } else {
      sock.once('connect', () => {
        sock.emit('join_room', joinData);
      });
    }
  }, []);
  
  const move = useCallback((x: number, y: number, direction: Direction) => {
    const sock = getOrCreateSocket();
    if (sock.connected) {
      sock.emit('move', { x, y, direction });
    }
  }, []);
  
  const sendChat = useCallback((text: string) => {
    const sock = getOrCreateSocket();
    const state = useGameStore.getState();
    console.log('sendChat called, socket connected:', sock.connected, 'socket id:', sock.id, 'playerId:', state.playerId, 'roomId:', state.roomId);
    if (sock.connected && state.playerId) {
      sock.emit('chat_message', { text });
      console.log('chat_message emitted with text:', text);
      
      // Optimistic update - show message immediately for sender
      const createdAt = Date.now();
      state.updatePlayerChat(state.playerId, text, createdAt);
      state.addChatMessage(state.playerId, text, createdAt);
      console.log('Optimistic chat message added for player:', state.playerId);
    } else {
      console.warn('Socket not connected or no playerId, cannot send chat. Connected:', sock.connected, 'playerId:', state.playerId);
    }
  }, []);
  
  const collectOrb = useCallback((orbId: string) => {
    const sock = getOrCreateSocket();
    if (sock.connected) {
      sock.emit('collect_orb', { orbId });
    }
  }, []);
  
  const purchaseItem = useCallback(async (itemId: string) => {
    const state = useGameStore.getState();
    const playerId = state.playerId;
    
    if (!playerId) {
      console.error('Cannot purchase: no player ID');
      return;
    }
    
    // Find the shop item to get price
    const shopItem = state.shopItems.find(item => item.id === itemId);
    if (!shopItem) {
      console.error('Item not found in shop:', itemId);
      return;
    }
    
    // Check if already owned
    const alreadyOwned = state.inventory.some(inv => inv.itemId === itemId);
    if (alreadyOwned) {
      console.log('Item already owned');
      return;
    }
    
    // Check if user has enough orbs
    const currentOrbs = state.localPlayer?.orbs || 0;
    if (currentOrbs < shopItem.price) {
      console.log('Insufficient orbs');
      return;
    }
    
    try {
      // Get current profile from Firebase
      const profile = await getUserProfile(playerId);
      if (!profile) {
        console.error('User profile not found');
        return;
      }
      
      // Check Firebase orbs (source of truth)
      const firebaseOrbs = profile.orbs || 0;
      if (firebaseOrbs < shopItem.price) {
        console.log('Insufficient orbs in Firebase');
        return;
      }
      
      // Check if already owned in Firebase
      const firebaseInventory = profile.inventory || [];
      if (firebaseInventory.includes(itemId)) {
        console.log('Item already owned in Firebase');
        return;
      }
      
      // Update Firebase: deduct orbs and add to inventory
      const newOrbs = firebaseOrbs - shopItem.price;
      const newInventory = [...firebaseInventory, itemId];
      
      await Promise.all([
        updateUserOrbs(playerId, newOrbs),
        addToInventory(playerId, itemId),
      ]);
      
      // Update local state - preserve equipped status for existing items
      const currentInventory = state.inventory;
      const newInventoryItems: InventoryItem[] = newInventory.map(itemId => {
        // Check if this item was already in the inventory and preserve its equipped status
        const existingItem = currentInventory.find(inv => inv.itemId === itemId);
        return {
          playerId,
          itemId,
          equipped: existingItem?.equipped || false, // Preserve equipped status if it existed
        };
      });
      
      state.setInventory(newInventoryItems, newOrbs);
      
      // Update local player orbs
      if (state.localPlayer) {
        state.localPlayer.orbs = newOrbs;
      }
      
      // Notify server with updated values so it can update room state
      const sock = getOrCreateSocket();
      if (sock.connected) {
        sock.emit('purchase_item', { itemId, newOrbs, newInventory });
      }
      
      console.log('Purchase successful:', itemId, 'new orbs:', newOrbs);
      
      // Sync from Firebase to ensure consistency (source of truth)
      await syncOrbsFromFirebase(playerId);
    } catch (error) {
      console.error('Purchase failed:', error);
    }
  }, []);
  
  const purchaseLootBox = useCallback(async (lootBoxId: string, selectedItemId: string, lootBoxPrice: number) => {
    const state = useGameStore.getState();
    const playerId = state.playerId;
    
    if (!playerId) {
      console.error('Cannot purchase loot box: no player ID');
      return;
    }
    
    // For now, we'll use the same logic as purchaseItem but with the selected item
    // In a real implementation, the server would handle the random selection
    try {
      const profile = await getUserProfile(playerId);
      if (!profile) {
        console.error('User profile not found');
        return;
      }
      
      // Use the provided loot box price
      const firebaseOrbs = profile.orbs || 0;
      
      if (firebaseOrbs < lootBoxPrice) {
        console.log('Insufficient orbs for loot box');
        return;
      }
      
      // Handle "nothing" result (empty itemId for exclusive cases)
      if (!selectedItemId || selectedItemId === '') {
        // Exclusive case gave nothing - just deduct orbs
        const newOrbs = firebaseOrbs - lootBoxPrice;
        await updateUserOrbs(playerId, newOrbs);
        state.updatePlayerOrbs(playerId, newOrbs);
        addNotification(`Case was empty. Better luck next time!`, 'error');
        
        // Get loot box name from category (handle godlike cases)
        let lootBoxCategory = lootBoxId.replace('lootbox_', '');
        let lootBoxName: string;
        
        if (lootBoxCategory.startsWith('godlike_')) {
          // Handle godlike cases: "godlike_hats" -> "Godlike Hats Case"
          const category = lootBoxCategory.replace('godlike_', '');
          lootBoxName = `Godlike ${category.charAt(0).toUpperCase() + category.slice(1)} Case`;
        } else {
          // Regular cases: "hats" -> "Hats Case"
          lootBoxName = lootBoxCategory.charAt(0).toUpperCase() + lootBoxCategory.slice(1) + ' Case';
        }
        
        // Send chat message for "nothing" result
        const message = `opened a ${lootBoxName} but found nothing!`;
        console.log('Sending loot box chat message (nothing):', message);
        sendChat(message);
        
        // Notify server
        const sock = getOrCreateSocket();
        if (sock.connected) {
          sock.emit('purchase_lootbox', { lootBoxId, itemId: '', newOrbs, newInventory: profile.inventory || [], alreadyOwned: false });
        }
        return;
      }
      
      // Check if already owned
      const firebaseInventory = profile.inventory || [];
      const alreadyOwned = firebaseInventory.includes(selectedItemId);
      
      let newOrbs: number;
      let newInventory: string[];
      
      if (alreadyOwned) {
        // If already owned, deduct full price (no refund)
        newOrbs = firebaseOrbs - lootBoxPrice;
        newInventory = firebaseInventory; // Don't add item to inventory
      } else {
        // Normal purchase: deduct orbs and add selected item to inventory
        newOrbs = firebaseOrbs - lootBoxPrice;
        newInventory = [...firebaseInventory, selectedItemId];
      }
      
      // Update local state IMMEDIATELY (optimistic update) before Firebase
      const currentInventory = state.inventory;
      const newInventoryItems: InventoryItem[] = newInventory.map(itemId => {
        const existingItem = currentInventory.find(inv => inv.itemId === itemId);
        return {
          playerId,
          itemId,
          equipped: existingItem?.equipped || false,
        };
      });
      
      // Update local state - setInventory will update both inventory and localPlayer orbs
      state.setInventory(newInventoryItems, newOrbs);
      
      // Also explicitly update player orbs in the players map to ensure consistency
      state.updatePlayerOrbs(playerId, newOrbs);
      
      // Get item details for notifications and chat
      const shopItems = state.shopItems;
      const item = shopItems.find(i => i.id === selectedItemId);
      
      // Now update Firebase (this happens asynchronously, but UI is already updated)
      if (alreadyOwned) {
        await updateUserOrbs(playerId, newOrbs);
        addNotification(`Item already owned!`, 'error');
        console.log('Loot box item already owned, no refund. new orbs:', newOrbs);
      } else {
        await Promise.all([
          updateUserOrbs(playerId, newOrbs),
          addToInventory(playerId, selectedItemId),
        ]);
        // Simple, clean notification message
        const itemName = item ? item.name : selectedItemId;
        addNotification(`Unlocked ${itemName}!`, 'success');
        console.log('Loot box purchase successful:', selectedItemId, 'new orbs:', newOrbs);
      }
      
      // Notify server
      const sock = getOrCreateSocket();
      if (sock.connected) {
        sock.emit('purchase_lootbox', { lootBoxId, itemId: selectedItemId, newOrbs, newInventory, alreadyOwned });
      }
      
      // Send chat message about the loot box opening (always send, even if already owned or nothing)
      console.log('Loot box chat message - item found:', item, 'selectedItemId:', selectedItemId, 'shopItems length:', shopItems.length, 'alreadyOwned:', alreadyOwned);
      
      // Get loot box name from category (handle godlike cases)
      let lootBoxCategory = lootBoxId.replace('lootbox_', '');
      let lootBoxName: string;
      
      if (lootBoxCategory.startsWith('godlike_')) {
        // Handle godlike cases: "godlike_hats" -> "Godlike Hats Case"
        const category = lootBoxCategory.replace('godlike_', '');
        lootBoxName = `Godlike ${category.charAt(0).toUpperCase() + category.slice(1)} Case`;
      } else {
        // Regular cases: "hats" -> "Hats Case"
        lootBoxName = lootBoxCategory.charAt(0).toUpperCase() + lootBoxCategory.slice(1) + ' Case';
      }
      
      if (item) {
        // Format message with item name wrapped in special markers for coloring and square brackets
        const message = `opened a ${lootBoxName} and received [ITEM:${item.rarity || 'common'}][${item.name}][/ITEM] !`;
        console.log('Sending loot box chat message:', message);
        sendChat(message);
      } else {
        // Handle "nothing" result (for godlike cases)
        const message = `opened a ${lootBoxName} but found nothing!`;
        console.log('Sending loot box chat message (nothing):', message);
        sendChat(message);
      }
    } catch (error) {
      console.error('Loot box purchase failed:', error);
    }
  }, [sendChat]);
  
  const equipItem = useCallback(async (itemId: string, equipped: boolean) => {
    const state = useGameStore.getState();
    const playerId = state.playerId;
    
    if (!playerId) {
      console.error('Cannot equip: no player ID');
      return;
    }
    
    // Check if item is owned
    const isOwned = state.inventory.some(inv => inv.itemId === itemId);
    if (!isOwned) {
      console.log('Item not owned');
      return;
    }
    
    try {
      // Get current profile from Firebase
      const profile = await getUserProfile(playerId);
      if (!profile) {
        console.error('User profile not found');
        return;
      }
      
      // Get current equipped items - use player's actual outfit if available (more up-to-date)
      const localPlayer = state.localPlayer;
      let equippedItems = localPlayer?.sprite?.outfit || profile.equippedItems || [];
      
      // Ensure we have an array
      if (!Array.isArray(equippedItems)) {
        equippedItems = [];
      }
      
      // Get shop items to check layers
      const shopItem = state.shopItems.find(item => item.id === itemId);
      if (!shopItem) {
        console.error('Item not found in shop');
        return;
      }
      
      // If equipping, handle layer restrictions
      if (equipped) {
        const itemLayer = shopItem.spriteLayer;
        
        // Special handling for boosts: allow up to 4 boosts, but only 1 of each type
        if (itemLayer === 'boost') {
          // Determine the type of the item being equipped
          // A boost can be speed-only, orb-only, or theoretically both (though unlikely)
          const newBoostIsSpeed = !!(shopItem.speedMultiplier && shopItem.speedMultiplier > 1);
          const newBoostIsOrb = !!(shopItem.orbMultiplier && shopItem.orbMultiplier > 1);
          
          console.log('Equipping boost:', shopItem.name, {
            speedMultiplier: shopItem.speedMultiplier,
            orbMultiplier: shopItem.orbMultiplier,
            isSpeed: newBoostIsSpeed,
            isOrb: newBoostIsOrb
          });
          
          // If this item is already equipped, toggle it off
          if (equippedItems.includes(itemId)) {
            equippedItems = equippedItems.filter(id => id !== itemId);
            console.log('Toggling off boost:', shopItem.name);
          } else {
            // Get all current equipped boosts with their types
            const currentBoosts = equippedItems
              .map(eqItemId => {
                const eqItem = state.shopItems.find(si => si.id === eqItemId);
                if (eqItem?.spriteLayer === 'boost') {
                  const isSpeed = !!(eqItem.speedMultiplier && eqItem.speedMultiplier > 1);
                  const isOrb = !!(eqItem.orbMultiplier && eqItem.orbMultiplier > 1);
                  return {
                    id: eqItemId,
                    name: eqItem.name,
                    isSpeed,
                    isOrb,
                  };
                }
                return null;
              })
              .filter((b): b is { id: string; name: string; isSpeed: boolean; isOrb: boolean } => b !== null);
            
            console.log('Current equipped boosts:', currentBoosts.map(b => ({
              name: b.name,
              isSpeed: b.isSpeed,
              isOrb: b.isOrb
            })));
            
            // Remove any existing boost of the same type ONLY (speed and orb are independent)
            // Speed boosts only conflict with other speed boosts
            // Orb boosts only conflict with other orb boosts
            if (newBoostIsSpeed) {
              // Remove any existing speed boost (but not the one we're trying to equip)
              const existingSpeedBoost = currentBoosts.find(b => b.isSpeed && b.id !== itemId);
              if (existingSpeedBoost) {
                equippedItems = equippedItems.filter(id => id !== existingSpeedBoost.id);
                console.log('Removed existing speed boost:', existingSpeedBoost.name, 'to equip:', shopItem.name);
              } else {
                console.log('No existing speed boost to remove');
              }
            }
            
            // This is a separate check - orb boosts don't affect speed boosts
            if (newBoostIsOrb) {
              // Remove any existing orb multiplier boost (but not the one we're trying to equip)
              const existingOrbBoost = currentBoosts.find(b => b.isOrb && b.id !== itemId);
              if (existingOrbBoost) {
                equippedItems = equippedItems.filter(id => id !== existingOrbBoost.id);
                console.log('Removed existing orb boost:', existingOrbBoost.name, 'to equip:', shopItem.name);
              } else {
                console.log('No existing orb boost to remove');
              }
            }
            
            // Debug: Log all current boosts before adding new one
            const boostsBeforeAdd = equippedItems.filter(eqItemId => {
              const eqItem = state.shopItems.find(si => si.id === eqItemId);
              return eqItem?.spriteLayer === 'boost';
            });
            console.log('Boosts before adding new one:', boostsBeforeAdd.map(id => {
              const item = state.shopItems.find(s => s.id === id);
              return item?.name || id;
            }));
            
            // Now check if we're at max (after removing same-type boost)
            const remainingBoosts = equippedItems.filter(eqItemId => {
              const eqItem = state.shopItems.find(si => si.id === eqItemId);
              return eqItem?.spriteLayer === 'boost';
            });
            
            if (remainingBoosts.length >= 4) {
              console.log('Maximum of 4 boosts allowed. Current boosts:', remainingBoosts.length);
              return;
            }
            
            // Add the new boost item
            equippedItems.push(itemId);
            console.log('✅ Equipped boost:', shopItem.name, 'Type:', newBoostIsSpeed ? 'Speed' : newBoostIsOrb ? 'Orb' : 'Unknown', 'Total boosts:', remainingBoosts.length + 1);
          }
        } else {
          // For non-boost items, unequip other items in same layer (only one per layer)
          equippedItems = equippedItems.filter(eqItemId => {
            const eqItem = state.shopItems.find(si => si.id === eqItemId);
            return !eqItem || eqItem.spriteLayer !== itemLayer || eqItemId === itemId;
          });
          
          // Add the new item if not already there
          if (!equippedItems.includes(itemId)) {
            equippedItems.push(itemId);
          }
        }
      } else {
        // Unequip: remove item from equipped list
        equippedItems = equippedItems.filter(id => id !== itemId);
      }
      
      // Update Firebase
      await updateEquippedItems(playerId, equippedItems);
      
      // Update local inventory state
      const finalInventory = state.inventory.map(inv => {
        if (inv.itemId === itemId) {
          // Update the equipped item
          return { ...inv, equipped };
        }
        
        // For boost items, check if they're in the final equippedItems list
        const invItem = state.shopItems.find(si => si.id === inv.itemId);
        if (invItem?.spriteLayer === 'boost') {
          // For boosts, use the final equippedItems list to determine if equipped
          return { ...inv, equipped: equippedItems.includes(inv.itemId) };
        }
        
        // For non-boost items, if equipping and this item is in the same layer, unequip it
        if (equipped && shopItem.spriteLayer !== 'boost') {
          if (invItem && invItem.spriteLayer === shopItem.spriteLayer) {
            return { ...inv, equipped: false };
          }
        }
        
        return inv;
      });
      
      state.setInventory(finalInventory, state.localPlayer?.orbs || 0);
      
      // Update local player sprite
      if (state.localPlayer) {
        state.localPlayer.sprite.outfit = equippedItems;
      }
      
      // Update player in room state
      const players = new Map(state.players);
      if (players.has(playerId)) {
        const player = players.get(playerId)!;
        player.sprite.outfit = equippedItems;
        players.set(playerId, player);
        state.players = players;
      }
      
      // Notify server with equipped items so it can broadcast sprite change to others
      const sock = getOrCreateSocket();
      if (sock.connected) {
        sock.emit('equip_item', { itemId, equipped, equippedItems });
      }
      
      console.log('Equip successful:', itemId, equipped, 'equipped items:', equippedItems);
    } catch (error) {
      console.error('Equip failed:', error);
    }
  }, []);
  
  const leaveRoom = useCallback(() => {
    const sock = getOrCreateSocket();
    if (sock.connected) {
      sock.emit('leave_room');
      console.log('Left room');
    }
  }, []);
  
  const listRooms = useCallback((callback: (rooms: Array<{id: string; mapType: string; playerCount: number; players: string[]}>) => void) => {
    const sock = getOrCreateSocket();
    
    // One-time listener for room_list response
    sock.once('room_list', callback);
    
    if (sock.connected) {
      sock.emit('list_rooms');
    } else {
      sock.once('connect', () => {
        sock.emit('list_rooms');
      });
    }
  }, []);
  
  const interactWithShrine = useCallback((shrineId: string, firebaseOrbs?: number) => {
    const sock = getOrCreateSocket();
    if (sock.connected) {
      sock.emit('shrine_interact', { shrineId, firebaseOrbs });
    }
  }, []);
  
  const startCuttingTree = useCallback((treeId: string) => {
    const sock = getOrCreateSocket();
    if (sock.connected) {
      sock.emit('start_cutting_tree', { treeId });
    }
  }, []);
  
  const completeCuttingTree = useCallback(async (treeId: string) => {
    const sock = getOrCreateSocket();
    if (sock.connected) {
      sock.emit('complete_cutting_tree', { treeId });
      // Server will handle adding logs and emit 'tree_cut_complete' event
      // Client will sync inventory and show notification in the event handler
    }
  }, []);
  
  const cancelCuttingTree = useCallback((treeId: string) => {
    const sock = getOrCreateSocket();
    if (sock.connected) {
      sock.emit('cancel_cutting_tree', { treeId });
    }
  }, []);
  
  const sellItem = useCallback(async (itemId: string) => {
    const state = useGameStore.getState();
    const playerId = state.playerId;
    
    if (!playerId) {
      console.error('Cannot sell item: no player ID');
      return;
    }
    
    // Find the shop item to get price
    const shopItem = state.shopItems.find(item => item.id === itemId);
    if (!shopItem) {
      console.error('Item not found in shop:', itemId);
      return;
    }
    
    // Check if user owns the item
    const ownsItem = state.inventory.some(inv => inv.itemId === itemId);
    if (!ownsItem) {
      console.log('Item not owned');
      return;
    }
    
    // Calculate sell price (50% of original price)
    const sellPrice = Math.floor(shopItem.price * 0.5);
    
    try {
      // Get current profile from Firebase
      const profile = await getUserProfile(playerId);
      if (!profile) {
        console.error('User profile not found');
        return;
      }
      
      // Check if item is in Firebase inventory
      const firebaseInventory = profile.inventory || [];
      if (!firebaseInventory.includes(itemId)) {
        console.log('Item not in Firebase inventory');
        return;
      }
      
      // Update Firebase: add orbs and remove from inventory
      const firebaseOrbs = profile.orbs || 0;
      const newOrbs = firebaseOrbs + sellPrice;
      const newInventory = firebaseInventory.filter(id => id !== itemId);
      
      // Also remove from equipped items if it was equipped
      const firebaseEquippedItems = profile.equippedItems || [];
      const newEquippedItems = firebaseEquippedItems.filter(id => id !== itemId);
      
      await Promise.all([
        updateUserOrbs(playerId, newOrbs),
        set(ref(database, `users/${playerId}/inventory`), newInventory),
        updateEquippedItems(playerId, newEquippedItems),
      ]);
      
      // Update local state
      const currentInventory = state.inventory;
      const newInventoryItems: InventoryItem[] = newInventory.map(id => {
        const existingItem = currentInventory.find(inv => inv.itemId === id);
        return {
          playerId,
          itemId: id,
          equipped: existingItem?.equipped || false,
        };
      });
      
      state.setInventory(newInventoryItems, newOrbs);
      
      // Update local player orbs
      if (state.localPlayer) {
        state.localPlayer.orbs = newOrbs;
      }
      
      // Notify server with updated values so it can update room state
      const sock = getOrCreateSocket();
      if (sock.connected) {
        sock.emit('sell_item', { itemId, newOrbs, newInventory });
      }
      
      console.log('Item sold successfully:', itemId, 'received:', sellPrice, 'new orbs:', newOrbs);
      
      // Play sell sound
      playSellSound();
      
      // Sync from Firebase to ensure consistency (source of truth)
      await syncOrbsFromFirebase(playerId);
    } catch (error) {
      console.error('Sell failed:', error);
    }
  }, []);
  
  const sellLogs = useCallback(async () => {
    const sock = getOrCreateSocket();
    if (sock.connected) {
      const state = useGameStore.getState();
      const playerId = state.playerId;
      
      if (playerId) {
        // Get current inventory and count logs
        const profile = await getUserProfile(playerId);
        if (profile) {
          const logs = (profile.inventory || []).filter((id: string) => id === 'log');
          const logCount = logs.length;
          
          if (logCount > 0) {
            // Calculate orbs to receive
            const orbsPerLog = 100;
            const orbsReceived = logCount * orbsPerLog;
            const currentOrbs = profile.orbs || 0;
            const newOrbs = currentOrbs + orbsReceived;
            
            // Remove all logs from Firebase inventory
            const newInventory = (profile.inventory || []).filter((id: string) => id !== 'log');
            
            // Update Firebase
            await Promise.all([
              updateUserOrbs(playerId, newOrbs),
              // Update inventory by removing all logs
              set(ref(database, `users/${playerId}/inventory`), newInventory),
            ]);
            
            // Update local state
            const inventoryItems: InventoryItem[] = newInventory.map((itemId: string) => ({
              playerId,
              itemId,
              equipped: (profile.equippedItems || []).includes(itemId),
            }));
            state.setInventory(inventoryItems, newOrbs);
            state.updatePlayerOrbs(playerId, newOrbs);
            
            // Send log count and orbs received to server for broadcasting
            sock.emit('sell_logs', { logCount, orbsReceived });
          } else {
            // No logs to sell - let server handle the error message
            sock.emit('sell_logs', { logCount: 0, orbsReceived: 0 });
          }
        }
      }
    }
  }, []);

  const interactWithTreasureChest = useCallback(async (chestId: string) => {
    console.log('[interactWithTreasureChest] Called with chestId:', chestId);
    const sock = getOrCreateSocket();
    if (!sock.connected) {
      console.error('Cannot interact with treasure chest: socket not connected');
      return;
    }

    const state = useGameStore.getState();
    const playerId = state.playerId;
    if (!playerId) {
      console.error('Cannot interact with treasure chest: no player ID');
      return;
    }

    try {
      // Poll Firebase for current orbs (source of truth)
      const profile = await getUserProfile(playerId);
      const firebaseOrbs = profile?.orbs || 0;
      console.log('[interactWithTreasureChest] Firebase orbs:', firebaseOrbs, 'emitting treasure_chest_interact');

      // Emit interaction with Firebase orbs
      sock.emit('treasure_chest_interact', { chestId, firebaseOrbs });
      console.log('[interactWithTreasureChest] Event emitted successfully');
    } catch (error) {
      console.error('Failed to get Firebase orbs for treasure chest interaction:', error);
      // Still try to interact with room state orbs as fallback
      const localPlayer = state.localPlayer;
      const fallbackOrbs = localPlayer?.orbs || 0;
      console.log('[interactWithTreasureChest] Using fallback orbs:', fallbackOrbs);
      sock.emit('treasure_chest_interact', { chestId, firebaseOrbs: fallbackOrbs });
    }
  }, []);

  const sellGoldCoins = useCallback(async () => {
    const sock = getOrCreateSocket();
    if (sock.connected) {
      const state = useGameStore.getState();
      const playerId = state.playerId;
      
      if (playerId) {
        // Get current gold coins from Firebase
        const profile = await getUserProfile(playerId);
        if (profile) {
          const coinCount = profile.gold_coins || 0;
          
          if (coinCount > 0) {
            // Calculate orbs to receive
            const orbsPerCoin = 250;
            const orbsReceived = coinCount * orbsPerCoin;
            const currentOrbs = profile.orbs || 0;
            const newOrbs = currentOrbs + orbsReceived;
            
            // Update Firebase: set gold_coins to 0, add orbs
            await Promise.all([
              updateUserOrbs(playerId, newOrbs),
              updateGoldCoins(playerId, 0),
            ]);
            
            // Update local state
            state.updatePlayerOrbs(playerId, newOrbs);
            if (state.localPlayer) {
              state.localPlayer.orbs = newOrbs;
            }
            
            // Send coin count and orbs received to server for broadcasting
            sock.emit('sell_gold_coins', { coinCount, orbsReceived });
          } else {
            // No coins to sell - let server handle the error message
            sock.emit('sell_gold_coins', { coinCount: 0, orbsReceived: 0 });
          }
        }
      }
    }
  }, []);
  
  return {
    socket: getOrCreateSocket(),
    joinRoom,
    leaveRoom,
    listRooms,
    move,
    sendChat,
    collectOrb,
    purchaseItem,
    purchaseLootBox,
    equipItem,
    interactWithShrine,
    startCuttingTree,
    completeCuttingTree,
    cancelCuttingTree,
    sellItem,
    sellLogs,
    interactWithTreasureChest,
    sellGoldCoins,
  };
}

// Handle Vite HMR - preserve socket across hot reloads
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    // Reset flags so they can be re-attached
    listenersAttached = false;
    pendingRejoin = false;
  });
}
