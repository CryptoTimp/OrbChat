import { useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useGameStore } from '../state/gameStore';
import { Direction, InventoryItem, GAME_CONSTANTS, BlackjackTableState, BlackjackCard } from '../types';
import { updateUserOrbs, getUserProfile, updateEquippedItems, addToInventory, updateGoldCoins } from '../firebase/auth';
import { ref, set } from 'firebase/database';
import { database } from '../firebase/config';
import { addNotification } from '../ui/Notifications';
import { playPickupSound, playShrineRejectionSound, playShrineRewardSound, playSellSound } from '../utils/sounds';
import { setShrineSpeechBubble, spawnFloatingText, setDealerSpeechBubble } from '../game/renderer';

// Socket.IO server URL
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 
  (import.meta.env.DEV ? 'http://localhost:3001' : '');

// Singleton socket instance - survives HMR
let socket: Socket | null = null;
let listenersAttached = false;
let pendingRejoin = false;  // Prevent duplicate rejoins
let hasAttemptedRejoin = false;  // Track if we've attempted rejoin in this session
let isJoiningRoom = false;  // Prevent concurrent join attempts
let isPurchasingLootBox = false;  // Prevent concurrent loot box purchases

  // Track previous blackjack states per table to detect changes (for dealer announcements)
const previousBlackjackStates = new Map<string, BlackjackTableState | null>();
// Track round numbers to detect new rounds
const previousRoundNumbers = new Map<string, number>();

// Sync orb balance from Firebase (source of truth for non-blackjack transactions)
// CRITICAL: For blackjack, server is the source of truth - do NOT sync from Firebase during blackjack
async function syncOrbsFromFirebase(playerId: string): Promise<void> {
  try {
    const state = useGameStore.getState();
    const isInBlackjack = state.blackjackTableOpen;
    
    // NEVER sync from Firebase during blackjack - server manages all balance updates
    if (isInBlackjack) {
      console.log(`[useSocket] syncOrbsFromFirebase - Skipping: in blackjack game, server manages balance`);
      return;
    }
    
    const profile = await getUserProfile(playerId);
    if (profile) {
      const firebaseOrbs = profile.orbs || 0;
      const currentOrbs = state.localPlayer?.orbs || 0;
      
      // Only update if the value is different to avoid triggering floating text unnecessarily
      if (firebaseOrbs !== currentOrbs) {
        // For non-blackjack, prefer higher balance (might be from recent transaction)
        if (currentOrbs > firebaseOrbs && currentOrbs - firebaseOrbs > 1000) {
          console.log(`[useSocket] syncOrbsFromFirebase - Skipping update: current balance ${currentOrbs} is higher than Firebase ${firebaseOrbs}`);
          return;
        }
        
        console.log(`[useSocket] syncOrbsFromFirebase - Updating balance: ${currentOrbs} -> ${firebaseOrbs}`);
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
    
    // Track ping for local player using timestamp-based approach
    let pingStartTime: number | null = null;
    let pingInterval: NodeJS.Timeout | null = null;
    
    // Measure ping using timestamp echo
    const measurePing = () => {
      pingStartTime = Date.now();
      socket?.emit('ping', { timestamp: pingStartTime });
    };
    
    socket.on('connect', () => {
      // Measure ping every 2 seconds
      pingInterval = setInterval(measurePing, 2000);
      measurePing(); // Initial measurement
    });
    
    socket.on('pong', (data: { timestamp?: number }) => {
      if (pingStartTime !== null) {
        const ping = Date.now() - pingStartTime;
        const state = useGameStore.getState();
        if (state.playerId) {
          state.setPlayerPing(state.playerId, ping);
        }
        pingStartTime = null;
      }
    });
    
    // Clean up interval on disconnect
    socket.on('disconnect', () => {
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
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
    // Only log initial connection, not reconnections (to reduce spam)
    if (!sock.recovered) {
      console.log('Connected to server, socket id:', sock.id);
    }
    useGameStore.getState().setConnected(true);
    
    // Auto-rejoin room if we were in one (but only once per connection)
    // IMPORTANT: Only auto-rejoin if we have a localPlayer (meaning we were successfully in a room before)
    // Don't auto-rejoin if we just have roomId from a failed join attempt
    const state = useGameStore.getState();
    if (state.roomId && state.playerName && state.localPlayer && !pendingRejoin && !hasAttemptedRejoin && !isJoiningRoom) {
      pendingRejoin = true;
      hasAttemptedRejoin = true;
      isJoiningRoom = true;
      console.log('[connect event] Auto-rejoining room:', state.roomId, 'with map:', state.mapType);
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
    // Only log unexpected disconnects, not normal reconnections
    if (reason !== 'io client disconnect') {
      console.log('Disconnected from server, reason:', reason);
    }
    useGameStore.getState().setConnected(false);
    pendingRejoin = false;  // Allow rejoin on next connect
    hasAttemptedRejoin = false;  // Reset rejoin flag on disconnect
    isJoiningRoom = false;  // Reset join flag on disconnect
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
    
    // CRITICAL: For blackjack, server manages all balance updates and updates Firebase
    // Client should NOT sync from Firebase during blackjack - server is the source of truth
    if (yourPlayerId) {
      const currentState = useGameStore.getState();
      const isInBlackjack = currentState.blackjackTableOpen;
      const currentBalance = currentState.localPlayer?.orbs || 0;
      
      if (!isInBlackjack) {
        // Only sync from Firebase when NOT in blackjack (server manages blackjack balances)
        await syncOrbsFromFirebase(yourPlayerId);
      } else {
        console.log('[useSocket] Skipping Firebase sync - in blackjack game, server manages all balance updates', {
          currentBalance,
          blackjackTableOpen: currentState.blackjackTableOpen,
          hasGameState: !!currentState.blackjackGameState
        });
      }
    }
    
    const store = useGameStore.getState();
    const wasInRoom = store.roomId === roomId && store.localPlayer; // Check if already fully in this room
    
    // Preserve previousRoomId when joining casino/lounge (don't clear it)
    const preservePreviousRoomId = roomId.startsWith('casino-') || roomId.startsWith('millionaires_lounge-');
    const savedPreviousRoomId = preservePreviousRoomId ? store.previousRoomId : null;
    
    // Reset rejoin flags after successful join
    pendingRejoin = false;
    hasAttemptedRejoin = false;  // Reset so we can rejoin if we disconnect and reconnect
    isJoiningRoom = false;  // Reset join flag after successful join
    store.setRoomId(roomId);
    
    // Restore previousRoomId if we're joining a casino/lounge (it should already be set, but ensure it persists)
    if (preservePreviousRoomId && savedPreviousRoomId) {
      console.log(`[Room State] Preserving previousRoomId ${savedPreviousRoomId} when joining ${roomId}`);
      store.setPreviousRoomId(savedPreviousRoomId);
    }
    
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
    
    // CRITICAL: If we're in a blackjack game, log the balance from room_state to detect stale data
    if (store.blackjackTableOpen && localPlayerToUse) {
      const currentBalance = store.localPlayer?.orbs || 0;
      const roomStateBalance = localPlayerToUse.orbs || 0;
      const difference = currentBalance - roomStateBalance;
      const isStale = roomStateBalance > currentBalance && Math.abs(difference) > 1000;
      
      console.log('[useSocket] room_state received during blackjack (modal open):', {
        currentBalance,
        roomStateBalance,
        difference,
        isStale,
        wouldRegainBet: isStale && Math.abs(difference) >= 10000, // Common bet amounts
        blackjackGameState: store.blackjackGameState?.gameState || 'null'
      });
      
      // CRITICAL: If room_state has higher balance (stale data), warn about it
      if (isStale) {
        console.error('[useSocket] ⚠️ STALE room_state detected during blackjack - will be rejected by gameStore');
      }
    }
    
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
    if (playerId === state.playerId) {
      // Only update local player position if it's a significant change (e.g., blackjack table teleport)
      // This prevents feedback loops from normal movement while still handling special positioning
      const localPlayer = state.localPlayer;
      if (localPlayer) {
        const dx = Math.abs(x - localPlayer.x);
        const dy = Math.abs(y - localPlayer.y);
        const distance = Math.sqrt(dx * dx + dy * dy);
        // If position change is significant (>50 pixels), it's likely a special teleport (e.g., blackjack table)
        // OR if the distance is moderate (20-50 pixels), it might be a server correction due to desync
        // Update animation state to prevent jump detection in both cases
        if (distance > 20) {
          // For large changes (>50), update position (teleportation)
          // For moderate changes (20-200), it's a server correction - smoothly reconcile
          if (distance > 50) {
            state.setLocalPlayerPosition(x, y, direction);
          } else if (distance > 20 && distance <= 200) {
            // Server correction - update position smoothly to reconcile
            // This prevents the client from continuing to move from the wrong position
            state.setLocalPlayerPosition(x, y, direction);
          }
          // Always update animation state position to match server position without resetting
          // This prevents jump detection and back-and-forth teleportation with speed boosts
          // This is especially important for players with network latency or frame rate issues
          import('../game/renderer').then(({ updatePlayerAnimationPosition }) => {
            updatePlayerAnimationPosition(playerId, x, y);
          });
          
          // Track server correction to prevent sending moves immediately after (prevents feedback loop)
          if (distance > 20 && distance <= 200) {
            // This is a server correction (not a teleport), mark it so client doesn't send conflicting moves
            window.dispatchEvent(new CustomEvent('server_position_correction', { 
              detail: { x, y, time: Date.now() } 
            }));
          }
        }
      }
    } else {
      state.updatePlayerPosition(playerId, x, y, direction);
    }
  });
  
  // Chat events
  sock.on('chat_message', ({ playerId, text, createdAt, textColor }) => {
    console.log('Received chat_message from server:', playerId, text, 'createdAt:', createdAt, 'textColor:', textColor);
    const state = useGameStore.getState();
    console.log('Current playerId:', state.playerId, 'Received playerId:', playerId, 'Match:', playerId === state.playerId);
    
    // Skip if this is our own message (already added via optimistic update)
    if (playerId === state.playerId) {
      console.log('Skipping own message (already shown via optimistic update)');
      return;
    }
    
    console.log('Adding chat message from other player');
    state.updatePlayerChat(playerId, text, createdAt, textColor);
    state.addChatMessage(playerId, text, createdAt, textColor);
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
  
  // Player orb balance updated (e.g. from purchases, idle rewards, trades, etc.)
  sock.on('player_orbs_updated', async ({ playerId, orbs, rewardAmount, rewardType }) => {
    const state = useGameStore.getState();
    
    if (playerId === state.playerId) {
      // For our own balance update, check if the value matches what we already have
      // BUT: Always process blackjack updates (server is source of truth, even if values match)
      const currentOrbs = state.localPlayer?.orbs || 0;
      if (orbs === currentOrbs && rewardType !== 'blackjack') {
        // Value already matches, no need to sync (except for blackjack where server is always source of truth)
        console.log('[useSocket] Balance already matches, skipping update:', orbs);
        return;
      }
      
      console.log('[useSocket] player_orbs_updated received:', { 
        playerId, 
        newOrbs: orbs, 
        currentOrbs, 
        rewardAmount, 
        rewardType,
        netChange: orbs - currentOrbs,
        timestamp: Date.now()
      });
      
      // Special handling for slots - don't update balance immediately, let animation complete first
      if (rewardType === 'slots') {
        // Don't update balance here - the SlotMachineModal will handle it after animation completes
        // This prevents immediate balance updates that reveal win/loss before animation
        // BUT: Still update Firebase if this is the final balance (after payout)
        // The modal will handle the local state update, but we should ensure Firebase is updated
        console.log('[useSocket] Slots balance update - deferring to SlotMachineModal after animation');
        console.log('[useSocket] Slots balance update - orbs:', orbs, 'rewardAmount:', rewardAmount);
        
        // If this is the final balance update (after payout), update Firebase
        // The first update (bet deduction with negative rewardAmount) is handled by the modal's optimistic update
        // The second update (final balance with net payout) should also update Firebase
        // We can detect the final update because rewardAmount will be different from a simple bet deduction
        if (playerId === state.playerId && rewardAmount !== undefined) {
          // This is likely the final balance update (includes payout)
          // The modal will also update Firebase, but this ensures it's updated even if modal is closed
          updateUserOrbs(playerId, orbs).catch(error => {
            console.error('[useSocket] Failed to update Firebase orbs for slots final balance:', error);
          });
          console.log('[useSocket] Updated Firebase for slots balance:', orbs, 'rewardAmount:', rewardAmount);
        }
        
        return; // Skip local state update - modal will handle it
      }
      
      // Special handling for idle rewards - show incremental update with floating text
      if (rewardType === 'idle' && rewardAmount && rewardAmount > 0) {
        // Update balance directly with the reward amount for visual feedback
        // This ensures the balance ticks up smoothly and shows floating text
        // Note: Server already updated Firebase before emitting this event, so no need to sync
        state.updatePlayerOrbs(playerId, orbs, rewardAmount);
        
        // Spawn floating text above player's head (like when collecting orbs from ground)
        const localPlayer = state.localPlayer;
        if (localPlayer && localPlayer.x !== undefined && localPlayer.y !== undefined) {
          const { SCALE, PLAYER_WIDTH } = GAME_CONSTANTS;
          const playerHeadX = localPlayer.x * SCALE + (PLAYER_WIDTH / 2) * SCALE;
          const playerHeadY = localPlayer.y * SCALE - 10; // Above head
          
          // Use 'idle' as orb type for idle rewards (will use appropriate color)
          spawnFloatingText(playerHeadX, playerHeadY, rewardAmount, 'idle');
        }
      } else if (rewardType === 'blackjack') {
        // CRITICAL: For blackjack, server is the source of truth for balance calculation
        // Server calculates the new balance and updates room state, but client updates Firebase
        // (Server Firebase Admin SDK may not be initialized, so client handles Firebase updates)
        // rewardAmount can be:
        // - Negative for bet deduction (e.g., -10000 when placing bet)
        // - Positive for payout (e.g., 20000 when winning)
        // - 0 for push (bet returned) - but we skip processing 0 payouts on server
        // The `orbs` value is the authoritative new balance from the server
        console.log('[useSocket] Blackjack balance update - server is source of truth:', { 
          playerId, 
          newOrbs: orbs, 
          currentOrbs, 
          rewardAmount, 
          netChange: orbs - currentOrbs,
          note: 'Client will update Firebase with server-calculated balance'
        });
        
        // CRITICAL: Always use the `orbs` value directly from server - it's the source of truth
        // Update local state immediately
        const previousOrbs = state.localPlayer?.orbs;
        state.updatePlayerOrbs(playerId, orbs, rewardAmount);
        
        // Update Firebase with the server-calculated balance (client handles Firebase updates)
        if (playerId === state.playerId) {
          updateUserOrbs(playerId, orbs).catch(error => {
            console.error('[useSocket] Failed to update Firebase orbs after blackjack balance change:', error);
          });
        }
        
        console.log('[useSocket] Blackjack balance update applied:', {
          playerId,
          previousOrbs,
          newOrbs: orbs,
          rewardAmount,
          change: orbs - (previousOrbs || 0),
          timestamp: new Date().toISOString()
        });
        
        // Dispatch balance change event for session stats tracking (excludes idle rewards)
        if (rewardAmount !== undefined && rewardAmount !== 0) {
          window.dispatchEvent(new CustomEvent('blackjack_balance_change', { 
            detail: { rewardAmount, playerId } 
          }));
        }
        
        // Store the payout amount for the BlackjackModal to display
        // Only store if it's a positive payout (win) - negative amounts are bet deductions
        // Skip 0 payouts (losses) as they're not processed on server
        // Dispatch for positive payouts (wins) - server only sends these when game finishes
        if (rewardAmount !== undefined && rewardAmount > 0) {
          window.dispatchEvent(new CustomEvent('blackjack_payout', { 
            detail: { payout: rewardAmount, playerId } 
          }));
        }
      } else if (rewardType === 'trade') {
        // Trade update - server is source of truth, use server's calculated balance directly
        // Update display immediately, trade_completed will update Firebase
        // Pass a special flag to bypass blackjack checks
        console.log('[useSocket] Trade balance update - using server value directly:', { 
          playerId, 
          currentOrbs: state.localPlayer?.orbs || 0,
          newOrbs: orbs,
          change: orbs - (state.localPlayer?.orbs || 0)
        });
        // Force update by passing undefined for lastOrbValue (not a bet deduction)
        state.updatePlayerOrbs(playerId, orbs, undefined);
      } else {
        // Other update - sync from Firebase (source of truth)
        await syncOrbsFromFirebase(playerId);
      }
    } else {
      // For other players, update the balance
      // We trust server updates for purchases/transactions (they decrease balance)
      // But we're more careful with orb collection updates (they should only increase)
      const currentPlayer = state.players.get(playerId);
      const currentOrbs = currentPlayer?.orbs;
      
      console.log('[useSocket] player_orbs_updated for other player:', {
        playerId,
        currentOrbs,
        newOrbs: orbs,
        willUpdate: !currentPlayer || currentOrbs === undefined || currentOrbs === null || currentOrbs === 0 || orbs !== currentOrbs
      });
      
      // For trade updates, always trust the server (server is source of truth)
      if (rewardType === 'trade') {
        console.log('[useSocket] Trade balance update for other player:', { 
          playerId, 
          currentOrbs: currentOrbs || 0,
          newOrbs: orbs,
          change: orbs - (currentOrbs || 0)
        });
        state.updatePlayerOrbs(playerId, orbs);
        return;
      }
      
      // Always update if:
      // 1. Player doesn't exist yet (new player)
      // 2. Current balance is 0 or undefined (initial state)
      // 3. New balance is different (could be increase or decrease from purchases/trades)
      if (!currentPlayer || currentOrbs === undefined || currentOrbs === null || currentOrbs === 0 || orbs !== currentOrbs) {
        state.updatePlayerOrbs(playerId, orbs);
        console.log('[useSocket] Updated other player balance:', { playerId, oldOrbs: currentOrbs, newOrbs: orbs });
      }
    }
  });
  
  // Shop events
  sock.on('shop_items', (items) => {
    useGameStore.getState().setShopItems(items);
  });
  
  // Idle reward event - client updates Firebase directly (like selling logs)
  sock.on('idle_reward', async ({ rewardAmount, maxIdleRewardRate }) => {
    const state = useGameStore.getState();
    const playerId = state.playerId;
    
    if (!playerId) return;
    
    try {
      // Get current orbs from Firebase (source of truth)
      const profile = await getUserProfile(playerId);
      if (!profile) return;
      
      const currentOrbs = profile.orbs || 0;
      const newOrbs = currentOrbs + rewardAmount;
      
      // Update Firebase directly (using client credentials)
      await updateUserOrbs(playerId, newOrbs);
      
      // Update local state
      state.updatePlayerOrbs(playerId, newOrbs, rewardAmount);
      
      // Record idle reward in session stats
      state.recordOrbCollection('normal', rewardAmount);
      
      // Notify server with updated balance (so server can update room state)
      const sock = getOrCreateSocket();
      if (sock.connected) {
        sock.emit('idle_reward_confirmed', { newOrbs });
      }
    } catch (error) {
      console.error('Failed to process idle reward:', error);
    }
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
          // BUT: Don't overwrite balance during blackjack games (stale Firebase data)
          const firebaseOrbs = profile.orbs || 0;
          const currentOrbs = state.localPlayer?.orbs || 0;
          const isInBlackjack = state.blackjackTableOpen && state.blackjackGameState;
          
          // If in blackjack and current balance is higher, preserve it
          const orbsToUse = (isInBlackjack && currentOrbs > firebaseOrbs && currentOrbs - firebaseOrbs > 1000)
            ? currentOrbs
            : firebaseOrbs;
          
          if (isInBlackjack && currentOrbs > firebaseOrbs) {
            console.warn(`[useSocket] inventory_loaded - Preserving balance during blackjack:`, {
              currentOrbs,
              firebaseOrbs,
              difference: currentOrbs - firebaseOrbs,
              using: orbsToUse
            });
          }
          
          state.setInventory(inventoryItems, orbsToUse);
          state.updatePlayerOrbs(state.playerId, orbsToUse);
          console.log('Loaded inventory from Firebase:', inventoryItems.length, 'items,', orbsToUse, 'orbs');
        }
      } catch (error) {
        console.error('Failed to load inventory from Firebase:', error);
        // Fall back to empty inventory
        state.setInventory([], orbs);
      }
    }
  });
  
  sock.on('player_kicked', ({ message }) => {
    console.log('You have been kicked:', message);
    addNotification(message, 'error');
    // The server will disconnect the socket, so we don't need to manually leave
    // The disconnect handler will clean up the state
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
  
  // Portal used event (broadcast to all players in room when someone uses a portal)
  sock.on('portal_used', ({ playerId, playerName, portalType }) => {
    const state = useGameStore.getState();
    const currentPlayerId = state.playerId;
    
    // Don't play sound for the player who used the portal (they already heard it)
    if (playerId === currentPlayerId) {
      return;
    }
    
    // Play portal sound for other players
    import('../utils/sounds').then(({ playPortalSound }) => {
      playPortalSound();
    });
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
  
  // Trade event listeners
  sock.on('trade_requested', ({ fromPlayerId, fromPlayerName }) => {
    const state = useGameStore.getState();
    const { openTrade } = state;
    openTrade(fromPlayerId, fromPlayerName);
    addNotification(`${fromPlayerName} wants to trade with you`, 'join');
  });
  
  sock.on('trade_opened', ({ otherPlayerId, otherPlayerName }) => {
    const state = useGameStore.getState();
    const { openTrade } = state;
    openTrade(otherPlayerId, otherPlayerName);
  });
  
  sock.on('trade_modified', ({ items, orbs, accepted }) => {
    const state = useGameStore.getState();
    const { updateTrade } = state;
    // Ensure items is always an array
    const itemsArray = Array.isArray(items) ? items : [];
    updateTrade({ 
      theirItems: itemsArray, 
      theirOrbs: orbs || 0,
      theirAccepted: accepted || false
    });
  });
  
  sock.on('trade_accepted', ({ playerId }) => {
    const state = useGameStore.getState();
    const { trade, updateTrade, playerId: myPlayerId } = state;
    if (playerId === myPlayerId) {
      updateTrade({ myAccepted: true });
    } else {
      updateTrade({ theirAccepted: true });
    }
  });
  
  sock.on('trade_completed', async ({ items, orbs, newBalance }) => {
    const state = useGameStore.getState();
    const { closeTrade, playerId, trade, shopItems, localPlayer } = state;
    
    if (playerId) {
      try {
        // Server is source of truth - use the balance server calculated
        const newOrbs = newBalance !== undefined ? newBalance : (state.localPlayer?.orbs || 0);
        
        // Get current profile for inventory
        const profile = await getUserProfile(playerId);
        if (!profile) {
          console.error('Failed to get profile after trade');
          closeTrade();
          return;
        }
        
        // Update inventory: remove items we gave, add items we received
        let newInventory = [...(profile.inventory || [])];
        
        // Remove items we gave (from trade.myItems)
        for (const item of trade.myItems) {
          for (let i = 0; i < item.quantity; i++) {
            const index = newInventory.indexOf(item.itemId);
            if (index !== -1) {
              newInventory.splice(index, 1);
            }
          }
        }
        
        // Add items we received
        for (const item of items) {
          for (let i = 0; i < item.quantity; i++) {
            newInventory.push(item.itemId);
          }
        }
        
        // Update Firebase: inventory and orbs (server's calculated balance)
        const { ref, set } = await import('firebase/database');
        const { database } = await import('../firebase/config');
        await Promise.all([
          set(ref(database, `users/${playerId}/inventory`), newInventory),
          updateUserOrbs(playerId, newOrbs)
        ]);
        
        console.log('[useSocket] Trade completed - updated Firebase:', {
          playerId,
          newOrbs,
          orbsWeGave: trade.myOrbs || 0,
          orbsWeReceived: orbs || 0,
          itemsGiven: trade.myItems.length,
          itemsReceived: items.length
        });
        
        // Update local state - use server's balance (already set by player_orbs_updated, but ensure consistency)
        const inventoryItems: InventoryItem[] = newInventory.map((itemId: string) => ({
          playerId,
          itemId,
          equipped: (profile.equippedItems || []).includes(itemId),
        }));
        state.setInventory(inventoryItems, newOrbs);
        state.updatePlayerOrbs(playerId, newOrbs);
        
        // Publish trade results to chat and show floating text
        const formatOrbs = (orbs: number): string => {
          if (orbs >= 1000000) {
            return `${(orbs / 1000000).toFixed(2)}M`;
          } else if (orbs >= 1000) {
            return `${(orbs / 1000).toFixed(1)}K`;
          }
          return orbs.toString();
        };
        
        // Build chat message
        const itemsGiven = trade.myItems.length > 0 
          ? trade.myItems.map(item => {
              const itemDetails = shopItems.find(si => si.id === item.itemId);
              return `${item.quantity}x ${itemDetails?.name || item.itemId}`;
            }).join(', ')
          : 'nothing';
        const orbsGiven = trade.myOrbs > 0 ? `${formatOrbs(trade.myOrbs)} orbs` : '';
        const gaveText = [itemsGiven, orbsGiven].filter(Boolean).join(' and ') || 'nothing';

        const itemsReceived = items.length > 0
          ? items.map(item => {
              const itemDetails = shopItems.find(si => si.id === item.itemId);
              return `${item.quantity}x ${itemDetails?.name || item.itemId}`;
            }).join(', ')
          : 'nothing';
        const orbsReceived = orbs > 0 ? `${formatOrbs(orbs)} orbs` : '';
        const receivedText = [itemsReceived, orbsReceived].filter(Boolean).join(' and ') || 'nothing';

        // Send chat message
        const chatMessage = `Traded ${gaveText} to ${trade.otherPlayerName} for ${receivedText}`;
        const sock = getOrCreateSocket();
        if (sock.connected && playerId) {
          sock.emit('chat_message', { text: chatMessage });
          // Optimistic update - show message immediately
          const createdAt = Date.now();
          state.updatePlayerChat(playerId, chatMessage, createdAt);
          state.addChatMessage(playerId, chatMessage, createdAt);
        }

        // Show floating text above player head
        if (localPlayer && localPlayer.x !== undefined && localPlayer.y !== undefined) {
          const { SCALE, PLAYER_WIDTH } = GAME_CONSTANTS;
          const playerHeadX = localPlayer.x * SCALE + (PLAYER_WIDTH / 2) * SCALE;
          const playerHeadY = localPlayer.y * SCALE - 10;
          
          // Show orb change if any
          const orbChange = orbs - trade.myOrbs;
          if (orbChange !== 0) {
            spawnFloatingText(
              playerHeadX, 
              playerHeadY, 
              Math.abs(orbChange), 
              orbChange > 0 ? 'idle' : 'normal',
              1.0
            );
          }
        }
      } catch (error) {
        console.error('Failed to update Firebase after trade:', error);
      }
    }
    
    addNotification('Trade completed successfully!', 'success');
    closeTrade();
  });
  
  sock.on('trade_declined', () => {
    const state = useGameStore.getState();
    const { closeTrade } = state;
    addNotification('Trade was declined', 'error');
    closeTrade();
  });
  
  sock.on('trade_cancelled', () => {
    const state = useGameStore.getState();
    const { closeTrade } = state;
    addNotification('Trade was cancelled', 'join');
    closeTrade();
  });
  
  sock.on('trade_error', ({ message }) => {
    addNotification(message || 'Trade error occurred', 'error');
  });
  
  // Blackjack events
  // Helper function to calculate hand value
  function calculateHandValue(cards: BlackjackCard[]): number {
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
    while (value > 21 && aces > 0) {
      value -= 10;
      aces--;
    }
    return value;
  }
  
  // Helper function to get card display text
  function getCardText(card: BlackjackCard): string {
    return `${card.rank}${card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'}`;
  }
  
  // Helper function to format orb count
  function formatOrbCount(orbs: number): string {
    if (orbs >= 1000000) {
      return (orbs / 1000000).toFixed(1) + 'M';
    } else if (orbs >= 1000) {
      return (orbs / 1000).toFixed(1) + 'K';
    }
    return orbs.toString();
  }
  
  // Helper function to set dealer speech bubble with color
  function setDealerSpeechForTable(tableId: string, message: string, color: 'white' | 'green' | 'red' = 'white'): void {
    const tableNumber = tableId.replace('blackjack_table_', '');
    const dealerId = `blackjack_dealer_${tableNumber}`;
    setDealerSpeechBubble(dealerId, message, color);
  }
  
  sock.on('blackjack_state_update', ({ tableId, state: gameState }) => {
    console.log('[useSocket] Received blackjack_state_update for table:', tableId, 'gameState:', gameState?.gameState, 'players:', gameState?.players?.length || 0);
    const store = useGameStore.getState();
    
    // Get previous state for this table
    const previousState = previousBlackjackStates.get(tableId);
    const previousRoundNumber = previousRoundNumbers.get(tableId) || 0;
    const currentRoundNumber = gameState?.roundNumber || 0;
    const isNewRound = currentRoundNumber > previousRoundNumber;
    
    console.log('[useSocket] Previous state for table:', tableId, 'previousGameState:', previousState?.gameState, 'previousPlayers:', previousState?.players?.length || 0, 'previousRound:', previousRoundNumber, 'currentRound:', currentRoundNumber, 'isNewRound:', isNewRound);
    
    // IMPORTANT: Don't store state yet - we need to use the previous state for comparison first
    // We'll store it at the end after all comparisons are done
    
    // Update state if this is the selected table
    if (store.selectedTableId === tableId) {
      console.log('[useSocket] Updating blackjack state for selected table');
      // Only update if we have a valid state (not null)
      if (gameState) {
        store.updateBlackjackState(gameState);
      } else {
        console.log('[useSocket] Received null state, clearing blackjack state');
        store.updateBlackjackState(null);
      }
    }
    
    // Process dealer announcements for all players (even without modal open)
    // Note: We need previousState to detect transitions, but round end can be detected even without it
    if (gameState) {
      // Detect state changes and announce them
      
      // Detect round reset (transition from finished/waiting to betting/dealing, OR round number increased)
      const isRoundReset = isNewRound || (previousState && 
        (previousState.gameState === 'finished' || previousState.gameState === 'waiting') &&
        (gameState.gameState === 'betting' || gameState.gameState === 'dealing'));
      
      if (isRoundReset) {
        console.log('[useSocket] ✓✓✓ ROUND RESET detected: isNewRound:', isNewRound, 'from', previousState?.gameState, 'to', gameState.gameState, 'round:', previousRoundNumber, '->', currentRoundNumber);
      }
      
      // Check for new cards dealt (initial deal) - including after round reset
      if (gameState.gameState === 'dealing' && (!previousState || previousState.gameState !== 'dealing' || isRoundReset)) {
        console.log('[useSocket] ✓ Detected dealing state, isRoundReset:', isRoundReset);
        setDealerSpeechForTable(tableId, 'Dealing cards...', 'white');
      }
      
      // Check for initial cards after dealing (transition from dealing to playing, or when cards first appear)
      if (gameState.gameState === 'playing') {
        // Check if we just transitioned from dealing, or if this is the first time we see cards, or after round reset
        const justTransitioned = previousState && previousState.gameState === 'dealing';
        const firstTimeSeeingCards = !previousState || (previousState.gameState !== 'playing' && gameState.dealerHand.length > 0);
        
        if (justTransitioned || firstTimeSeeingCards || isRoundReset) {
          console.log('[useSocket] ✓ Detected initial cards deal, transitioned:', justTransitioned, 'firstTime:', firstTimeSeeingCards, 'afterReset:', isRoundReset);
          // Announce initial cards for each player
          for (const player of gameState.players) {
            if (!player.hasPlacedBet) continue;
            const hand = player.hands[0];
            if (hand && hand.cards.length >= 2) {
              // Check if we already announced this (compare with previous state, but allow after reset)
              const prevPlayer = previousState?.players.find(p => p.playerId === player.playerId);
              const prevHand = prevPlayer?.hands[0];
              const alreadyAnnounced = prevHand && prevHand.cards.length >= 2 && !isRoundReset;
              
              if (!alreadyAnnounced) {
                const handValue = calculateHandValue(hand.cards);
                if (hand.isBlackjack) {
                  setDealerSpeechForTable(tableId, `${player.playerName} has Blackjack!`, 'green');
                } else {
                  const card1 = getCardText(hand.cards[0]);
                  const card2 = getCardText(hand.cards[1]);
                  setDealerSpeechForTable(tableId, `${player.playerName} has ${card1} ${card2} - ${handValue}`, 'white');
                }
              }
            }
          }
          // Announce dealer's visible card (if we haven't already, or after reset)
          if (gameState.dealerHand.length >= 1 && (!previousState || previousState.dealerHand.length === 0 || isRoundReset)) {
            const visibleCard = gameState.dealerHand[0];
            setDealerSpeechForTable(tableId, `Dealer shows ${getCardText(visibleCard)}`, 'white');
          }
        }
      }
      
      // Check for player actions (hit, stand, double down)
      // Only check if we're in the same round (roundNumber matches) to avoid false positives after round reset
      if (gameState.gameState === 'playing' && previousState && !isNewRound) {
        console.log('[useSocket] Checking for player actions, current players:', gameState.players.length, 'previous players:', previousState.players.length, 'same round:', !isNewRound);
        // Check each player for changes
        for (const player of gameState.players) {
          if (!player.hasPlacedBet) continue;
          
          const prevPlayer = previousState.players.find(p => p.playerId === player.playerId);
          if (!prevPlayer) {
            console.log('[useSocket] Player', player.playerName, 'not found in previous state - might be new player');
            continue;
          }
          
          // Check each hand
          for (let handIndex = 0; handIndex < player.hands.length; handIndex++) {
            const hand = player.hands[handIndex];
            const prevHand = prevPlayer.hands[handIndex];
            
            if (!prevHand) {
              console.log('[useSocket] Hand', handIndex, 'not found in previous state for', player.playerName, '- might be new hand');
              continue;
            }
            
            // Detect new card (hit) - check if card count increased
            if (hand.cards.length > prevHand.cards.length) {
              console.log('[useSocket] ✓ Detected HIT for', player.playerName, 'cards:', prevHand.cards.length, '->', hand.cards.length);
              const handValue = calculateHandValue(hand.cards);
              const newCard = hand.cards[hand.cards.length - 1];
              const cardText = getCardText(newCard);
              
              if (hand.isBust) {
                setDealerSpeechForTable(tableId, `${player.playerName} hit, got ${cardText} - Bust! (${handValue})`, 'red');
              } else if (hand.isBlackjack) {
                setDealerSpeechForTable(tableId, `${player.playerName} hit, got ${cardText} - Blackjack!`, 'green');
              } else {
                setDealerSpeechForTable(tableId, `${player.playerName} hit, got ${cardText} - ${handValue}`, 'white');
              }
            }
            
            // Detect stand
            if (!prevHand.isStand && hand.isStand) {
              console.log('[useSocket] ✓ Detected STAND for', player.playerName);
              const handValue = calculateHandValue(hand.cards);
              setDealerSpeechForTable(tableId, `${player.playerName} stands with ${handValue}`, 'white');
            }
            
            // Detect double down
            if (!prevHand.isDoubleDown && hand.isDoubleDown) {
              console.log('[useSocket] ✓ Detected DOUBLE DOWN for', player.playerName);
              const handValue = calculateHandValue(hand.cards);
              const betAmount = Number(hand.bet) || 0;
              setDealerSpeechForTable(tableId, `${player.playerName} doubles down (${formatOrbCount(betAmount)}) - ${handValue}`, 'white');
            }
          }
        }
      } else if (gameState.gameState === 'playing' && !previousState) {
        console.log('[useSocket] In playing state but no previousState - first update for this table');
      } else if (gameState.gameState === 'playing' && isNewRound) {
        console.log('[useSocket] In playing state but new round detected - skipping action detection, will handle in initial cards section');
      }
      
      // Check for dealer turn
      if (gameState.gameState === 'dealer_turn' && (!previousState || previousState.gameState !== 'dealer_turn')) {
        const dealerValue = calculateHandValue(gameState.dealerHand);
        if (gameState.dealerHasBlackjack) {
          setDealerSpeechForTable(tableId, 'Dealer has Blackjack!', 'white');
        } else {
          const visibleCard = gameState.dealerHand[0];
          if (visibleCard) {
            setDealerSpeechForTable(tableId, `Dealer shows ${getCardText(visibleCard)}`, 'white');
          }
        }
      }
      
      // Check for dealer hitting
      if (gameState.gameState === 'dealer_turn' && previousState && previousState.gameState === 'dealer_turn') {
        if (gameState.dealerHand.length > previousState.dealerHand.length) {
          const dealerValue = calculateHandValue(gameState.dealerHand);
          const newCard = gameState.dealerHand[gameState.dealerHand.length - 1];
          const cardText = getCardText(newCard);
          
          if (dealerValue > 21) {
            setDealerSpeechForTable(tableId, `Dealer hit, got ${cardText} - Bust! (${dealerValue})`, 'white');
          } else {
            setDealerSpeechForTable(tableId, `Dealer hit, got ${cardText} - ${dealerValue}`, 'white');
          }
        }
      }
      
      // Check for bets placed (announce stake amount)
      if (gameState.gameState === 'betting' && previousState && previousState.gameState === 'betting') {
        for (const player of gameState.players) {
          const prevPlayer = previousState.players.find(p => p.playerId === player.playerId);
          if (prevPlayer && !prevPlayer.hasPlacedBet && player.hasPlacedBet) {
            const hand = player.hands[0];
            const betAmount = hand ? (Number(hand.bet) || 0) : 0;
            setDealerSpeechForTable(tableId, `${player.playerName} staked ${formatOrbCount(betAmount)}`, 'white');
          }
        }
      }
      
      // Check for round end (finished state)
      if (gameState.gameState === 'finished' && (!previousState || previousState.gameState !== 'finished')) {
        console.log('[useSocket] Round finished detected for table:', tableId, 'previousState:', previousState?.gameState);
        // Check if any players won or lost
        const dealerValue = calculateHandValue(gameState.dealerHand);
        const dealerBust = dealerValue > 21;
        const dealerHasBlackjack = gameState.dealerHasBlackjack;
        
        let hasWinners = false;
        let hasLosers = false;
        
        for (const player of gameState.players) {
          if (!player.hasPlacedBet) continue;
          
          for (const hand of player.hands) {
            const handValue = calculateHandValue(hand.cards);
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
        
        // Set dealer speech bubble based on results (with colors)
        if (hasWinners && !hasLosers) {
          // All players won - green
          const messages = [
            'Congratulations, winners!',
            'Well played!',
            'Great hands!',
            'You beat the house!',
            'Excellent!'
          ];
          const message = messages[Math.floor(Math.random() * messages.length)];
          setDealerSpeechForTable(tableId, message, 'green');
        } else if (hasLosers && !hasWinners) {
          // All players lost - red
          const messages = [
            'Better luck next time!',
            'The house always wins!',
            'Try again!',
            'Don\'t give up!',
            'Next round could be yours!'
          ];
          const message = messages[Math.floor(Math.random() * messages.length)];
          setDealerSpeechForTable(tableId, message, 'red');
        } else if (hasWinners && hasLosers) {
          // Mixed results - white
          const messages = [
            'Some winners, some losers!',
            'Mixed results this round!',
            'Good luck next time!',
            'The house takes some, gives some!'
          ];
          const message = messages[Math.floor(Math.random() * messages.length)];
          setDealerSpeechForTable(tableId, message, 'white');
        } else {
          // Push (ties) or no players - white
          const messages = [
            'Push! Try again!',
            'Tie game!',
            'No winners this round!'
          ];
          const message = messages[Math.floor(Math.random() * messages.length)];
          console.log('[useSocket] Setting dealer speech for round end:', message, 'table:', tableId);
          setDealerSpeechForTable(tableId, message, 'white');
        }
      }
    }
    
    // Store current state as previous for next update (AFTER all comparisons)
    // This ensures we can detect transitions in the next update, including round resets
    previousBlackjackStates.set(tableId, gameState);
    if (gameState) {
      previousRoundNumbers.set(tableId, gameState.roundNumber || 0);
    }
    console.log('[useSocket] Stored state for next update, gameState:', gameState?.gameState, 'roundNumber:', gameState?.roundNumber);
  });
  
  sock.on('blackjack_error', ({ tableId, message }) => {
    console.log('[useSocket] Blackjack error received:', tableId, message);
    const store = useGameStore.getState();
    // If this error is for the currently selected table, clear the joining state
    if (store.selectedTableId === tableId) {
      store.updateBlackjackState(null); // Clear state to show error
    }
    addNotification(`Blackjack Error: ${message}`, 'error');
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

  // Slot machine result
  sock.on('slot_machine_joined', ({ slotMachineId, seat }) => {
    console.log('[useSocket] Slot machine joined:', slotMachineId, 'seat:', seat);
    const state = useGameStore.getState();
    // Open the slot machine modal when player is seated
    state.openSlotMachine(slotMachineId);
    
    // Calculate seat position and store it for movement detection
    const SCALE = GAME_CONSTANTS.SCALE;
    const WORLD_WIDTH_SCALED = GAME_CONSTANTS.TILE_SIZE * GAME_CONSTANTS.MAP_WIDTH * SCALE;
    const WORLD_HEIGHT_SCALED = GAME_CONSTANTS.TILE_SIZE * GAME_CONSTANTS.MAP_HEIGHT * SCALE;
    const centerXScaled = WORLD_WIDTH_SCALED / 2;
    const centerYScaled = WORLD_HEIGHT_SCALED / 2;
    const plazaRadiusScaled = 300 * SCALE;
    const slotMachineDistance = plazaRadiusScaled * 0.85;
    
    const directions = [
      { angle: 0, id: 'slot_machine_north' },
      { angle: Math.PI / 2, id: 'slot_machine_east' },
      { angle: Math.PI, id: 'slot_machine_south' },
      { angle: 3 * Math.PI / 2, id: 'slot_machine_west' }
    ];
    
    const dir = directions.find(d => d.id === slotMachineId);
    if (dir) {
      const slotXScaled = centerXScaled + Math.cos(dir.angle) * slotMachineDistance;
      const slotYScaled = centerYScaled + Math.sin(dir.angle) * slotMachineDistance;
      const seatRadiusScaled = 38 * SCALE; // Distance from machine center (immediately around machine)
      const seatAngle = (seat / 8) * Math.PI * 2;
      const seatXScaled = slotXScaled + Math.cos(seatAngle) * seatRadiusScaled;
      const seatYScaled = slotYScaled + Math.sin(seatAngle) * seatRadiusScaled;
      
      // Convert to unscaled coordinates
      const seatX = seatXScaled / SCALE;
      const seatY = seatYScaled / SCALE;
      
      // Store seat position in window for GameCanvas to access
      (window as any).currentSlotMachineSeat = { slotMachineId, seatX, seatY };
    }
  });
  
  sock.on('slot_machine_left', ({ slotMachineId }) => {
    console.log('[useSocket] Slot machine left:', slotMachineId);
    const state = useGameStore.getState();
    // Close the slot machine modal when player leaves
    state.closeSlotMachine(slotMachineId);
    
    // Clear seat position
    if ((window as any).currentSlotMachineSeat?.slotMachineId === slotMachineId) {
      (window as any).currentSlotMachineSeat = null;
    }
  });
  
  sock.on('slot_machine_left', ({ slotMachineId }) => {
    console.log('[useSocket] Slot machine left:', slotMachineId);
    const state = useGameStore.getState();
    // Close the slot machine modal when player leaves
    state.closeSlotMachine(slotMachineId);
  });
  
  sock.on('slot_machine_result', ({ slotMachineId, slotMachineName, symbols, payout, newBalance }) => {
    console.log('[useSocket] Received slot_machine_result:', { slotMachineId, slotMachineName, symbols, payout, newBalance });
    
    // DON'T update balance here - let the SlotMachineModal handle it after animation completes
    // This prevents immediate balance updates that reveal win/loss before animation
    
    // Dispatch custom event for SlotMachineModal to listen to
    const event = new CustomEvent('slot_machine_result', {
      detail: { slotMachineId, slotMachineName, symbols, payout, newBalance }
    });
    window.dispatchEvent(event);
  });

  // Slot machine error
  sock.on('slot_machine_error', ({ slotMachineId, message }) => {
    console.error('[useSocket] Slot machine error:', slotMachineId, message);
    addNotification('error', message);
  });
}

export function useSocket() {
  useEffect(() => {
    const sock = getOrCreateSocket();
    attachListeners(sock);
    
    // If socket is already connected when we attach listeners (e.g., after HMR),
    // the 'connect' event won't fire again, so we need to handle rejoin here
    // But only if the connect event handler hasn't already handled it
    if (sock.connected && !pendingRejoin && !hasAttemptedRejoin && !isJoiningRoom) {
      const state = useGameStore.getState();
      if (state.roomId && state.playerName && state.localPlayer) {
        pendingRejoin = true;
        hasAttemptedRejoin = true;
        isJoiningRoom = true;
        console.log('[useEffect] Socket already connected, auto-rejoining room:', state.roomId, 'with map:', state.mapType);
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
    // Prevent duplicate joins - if we're already in this room, don't join again
    const state = useGameStore.getState();
    if (state.roomId === roomId && state.localPlayer && state.playerName === playerName) {
      console.log('Already in room', roomId, 'as', playerName, '- skipping duplicate join');
      return;
    }
    
    // Prevent concurrent join attempts
    if (isJoiningRoom) {
      console.log('Join already in progress, skipping duplicate join request');
      return;
    }
    
    // Prevent auto-rejoin from firing during manual join
    pendingRejoin = true;
    hasAttemptedRejoin = true;  // Mark that we've attempted a join (manual or auto)
    isJoiningRoom = true;  // Mark that we're currently joining
    
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
    // Prevent concurrent purchases
    if (isPurchasingLootBox) {
      console.warn('Purchase already in progress, ignoring duplicate request');
      return;
    }
    
    const state = useGameStore.getState();
    const playerId = state.playerId;
    
    if (!playerId) {
      console.error('Cannot purchase loot box: no player ID');
      return;
    }
    
    // Set purchase lock
    isPurchasingLootBox = true;
    
    // Store original state for rollback
    let originalOrbs: number | null = null;
    let originalInventory: string[] | null = null;
    
    // For now, we'll use the same logic as purchaseItem but with the selected item
    // In a real implementation, the server would handle the random selection
    try {
      const profile = await getUserProfile(playerId);
      if (!profile) {
        console.error('User profile not found');
        isPurchasingLootBox = false;
        return;
      }
      
      // Store original state for rollback
      originalOrbs = profile.orbs || 0;
      originalInventory = [...(profile.inventory || [])];
      
      // Use the provided loot box price
      const firebaseOrbs = profile.orbs || 0;
      
      if (firebaseOrbs < lootBoxPrice) {
        console.log('Insufficient orbs for loot box');
        addNotification('Insufficient orbs!', 'error');
        isPurchasingLootBox = false;
        return;
      }
      
      // Handle "nothing" result (empty itemId for exclusive cases)
      if (!selectedItemId || selectedItemId === '') {
        // Exclusive case gave nothing - just deduct orbs
        const newOrbs = firebaseOrbs - lootBoxPrice;
        
        // Update Firebase with retry logic
        let retries = 3;
        let success = false;
        while (retries > 0 && !success) {
          try {
            // Re-read orbs before updating to prevent race conditions
            const currentProfile = await getUserProfile(playerId);
            if (!currentProfile) {
              throw new Error('Profile not found');
            }
            const currentOrbs = currentProfile.orbs || 0;
            
            // Verify we still have enough orbs (might have changed due to concurrent purchase)
            if (currentOrbs < lootBoxPrice) {
              throw new Error('Insufficient orbs (balance changed)');
            }
            
            // Update with current balance
            const finalOrbs = currentOrbs - lootBoxPrice;
            await updateUserOrbs(playerId, finalOrbs);
            success = true;
            
            state.updatePlayerOrbs(playerId, finalOrbs);
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
              sock.emit('purchase_lootbox', { lootBoxId, itemId: '', newOrbs: finalOrbs, newInventory: currentProfile.inventory || [], alreadyOwned: false });
            }
          } catch (error) {
            retries--;
            if (retries === 0) {
              // Rollback: restore original state
              if (originalOrbs !== null) {
                await updateUserOrbs(playerId, originalOrbs);
                state.updatePlayerOrbs(playerId, originalOrbs);
              }
              addNotification('Purchase failed. Please try again.', 'error');
              console.error('Loot box purchase failed after retries:', error);
              isPurchasingLootBox = false;
              return;
            }
            // Wait a bit before retry
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        isPurchasingLootBox = false;
        return;
      }
      
      // Check if already owned (re-read to get latest state)
      const currentProfile = await getUserProfile(playerId);
      if (!currentProfile) {
        throw new Error('Profile not found during purchase');
      }
      
      const firebaseInventory = currentProfile.inventory || [];
      const currentFirebaseOrbs = currentProfile.orbs || 0;
      
      // Verify we still have enough orbs (might have changed due to concurrent purchase)
      if (currentFirebaseOrbs < lootBoxPrice) {
        throw new Error('Insufficient orbs (balance changed)');
      }
      
      const alreadyOwned = firebaseInventory.includes(selectedItemId);
      
      let newOrbs: number;
      let newInventory: string[];
      
      if (alreadyOwned) {
        // If already owned, deduct full price (no refund)
        newOrbs = currentFirebaseOrbs - lootBoxPrice;
        newInventory = firebaseInventory; // Don't add item to inventory
      } else {
        // Normal purchase: deduct orbs and add selected item to inventory
        newOrbs = currentFirebaseOrbs - lootBoxPrice;
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
      
      // Now update Firebase with retry logic
      let retries = 3;
      let success = false;
      while (retries > 0 && !success) {
        try {
          // Re-read profile before updating to prevent race conditions
          const latestProfile = await getUserProfile(playerId);
          if (!latestProfile) {
            throw new Error('Profile not found');
          }
          const latestOrbs = latestProfile.orbs || 0;
          const latestInventory = latestProfile.inventory || [];
          
          // Verify we still have enough orbs
          if (latestOrbs < lootBoxPrice) {
            throw new Error('Insufficient orbs (balance changed during purchase)');
          }
          
          // Calculate final values based on latest state
          const finalOrbs = latestOrbs - lootBoxPrice;
          const finalInventory = alreadyOwned ? latestInventory : [...latestInventory, selectedItemId];
          
          // Update Firebase atomically
          if (alreadyOwned) {
            await updateUserOrbs(playerId, finalOrbs);
          } else {
            await Promise.all([
              updateUserOrbs(playerId, finalOrbs),
              addToInventory(playerId, selectedItemId),
            ]);
          }
          
          success = true;
          
          // Update local state with final values
          state.updatePlayerOrbs(playerId, finalOrbs);
          const finalInventoryItems: InventoryItem[] = finalInventory.map(itemId => {
            const existingItem = currentInventory.find(inv => inv.itemId === itemId);
            return {
              playerId,
              itemId,
              equipped: existingItem?.equipped || false,
            };
          });
          state.setInventory(finalInventoryItems, finalOrbs);
          
          if (alreadyOwned) {
            addNotification(`Item already owned!`, 'error');
            console.log('Loot box item already owned, no refund. new orbs:', finalOrbs);
          } else {
            // Simple, clean notification message
            const itemName = item ? item.name : selectedItemId;
            addNotification(`Unlocked ${itemName}!`, 'success');
            console.log('Loot box purchase successful:', selectedItemId, 'new orbs:', finalOrbs);
          }
          
          // Notify server
          const sock = getOrCreateSocket();
          if (sock.connected) {
            sock.emit('purchase_lootbox', { lootBoxId, itemId: selectedItemId, newOrbs: finalOrbs, newInventory: finalInventory, alreadyOwned });
          }
        } catch (error) {
          retries--;
          if (retries === 0) {
            // Rollback: restore original state
            if (originalOrbs !== null) {
              await updateUserOrbs(playerId, originalOrbs);
              state.updatePlayerOrbs(playerId, originalOrbs);
            }
            if (originalInventory !== null) {
              const rollbackInventoryItems: InventoryItem[] = originalInventory.map(itemId => {
                const existingItem = currentInventory.find(inv => inv.itemId === itemId);
                return {
                  playerId,
                  itemId,
                  equipped: existingItem?.equipped || false,
                };
              });
              state.setInventory(rollbackInventoryItems, originalOrbs);
            }
            addNotification('Purchase failed. Please try again.', 'error');
            console.error('Loot box purchase failed after retries:', error);
            isPurchasingLootBox = false;
            return;
          }
          // Wait a bit before retry
          await new Promise(resolve => setTimeout(resolve, 100));
        }
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
      // Rollback on error
      if (originalOrbs !== null) {
        try {
          await updateUserOrbs(playerId, originalOrbs);
          state.updatePlayerOrbs(playerId, originalOrbs);
        } catch (rollbackError) {
          console.error('Failed to rollback orbs:', rollbackError);
        }
      }
      if (originalInventory !== null) {
        try {
          const currentInventory = state.inventory;
          const rollbackInventoryItems: InventoryItem[] = originalInventory.map(itemId => {
            const existingItem = currentInventory.find(inv => inv.itemId === itemId);
            return {
              playerId,
              itemId,
              equipped: existingItem?.equipped || false,
            };
          });
          state.setInventory(rollbackInventoryItems, originalOrbs || 0);
        } catch (rollbackError) {
          console.error('Failed to rollback inventory:', rollbackError);
        }
      }
      addNotification('Purchase failed. Please try again.', 'error');
    } finally {
      // Always release the lock
      isPurchasingLootBox = false;
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
  
  // Blackjack functions
  const joinBlackjackTable = useCallback((tableId: string) => {
    const sock = getOrCreateSocket();
    console.log('[useSocket] Emitting join_blackjack_table for table:', tableId, 'socket connected:', sock.connected, 'socket id:', sock.id);
    
    // Add error handler for this specific emit
    const errorHandler = (error: any) => {
      console.error('[useSocket] Error emitting join_blackjack_table:', error);
    };
    
    sock.emit('join_blackjack_table', { tableId }, errorHandler);
    
    // Also listen for any errors
    const oneTimeErrorListener = (error: any) => {
      console.error('[useSocket] Socket error:', error);
      sock.off('error', oneTimeErrorListener);
    };
    sock.once('error', oneTimeErrorListener);
  }, []);
  
  const leaveBlackjackTable = useCallback((tableId: string) => {
    const sock = getOrCreateSocket();
    sock.emit('leave_blackjack_table', { tableId });
  }, []);
  
  const placeBlackjackBet = useCallback((tableId: string, amount: number) => {
    console.log('[useSocket] Emitting place_blackjack_bet:', { tableId, amount, amountType: typeof amount });
    const sock = getOrCreateSocket();
    if (!sock.connected) {
      console.error('[useSocket] Socket not connected!');
      return;
    }
    // Ensure amount is a number
    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      console.error('[useSocket] Invalid bet amount:', amount);
      return;
    }
    sock.emit('place_blackjack_bet', { tableId, amount: numericAmount });
  }, []);
  
  const blackjackHit = useCallback((tableId: string, handIndex?: number) => {
    console.log('[useSocket] Emitting blackjack_hit:', { tableId, handIndex });
    const sock = getOrCreateSocket();
    if (!sock.connected) {
      console.error('[useSocket] Socket not connected!');
      return;
    }
    sock.emit('blackjack_hit', { tableId, handIndex });
  }, []);
  
  const blackjackStand = useCallback((tableId: string, handIndex?: number) => {
    console.log('[useSocket] Emitting blackjack_stand:', { tableId, handIndex });
    const sock = getOrCreateSocket();
    if (!sock.connected) {
      console.error('[useSocket] Socket not connected!');
      return;
    }
    sock.emit('blackjack_stand', { tableId, handIndex });
  }, []);
  
  const blackjackDoubleDown = useCallback((tableId: string, handIndex?: number) => {
    console.log('[useSocket] Emitting blackjack_double_down:', { tableId, handIndex });
    const sock = getOrCreateSocket();
    if (!sock.connected) {
      console.error('[useSocket] Socket not connected!');
      return;
    }
    sock.emit('blackjack_double_down', { tableId, handIndex });
  }, []);
  
  const blackjackSplit = useCallback((tableId: string, handIndex?: number) => {
    const sock = getOrCreateSocket();
    sock.emit('blackjack_split', { tableId, handIndex });
  }, []);
  
  // Slot machine seat functions
  const joinSlotMachine = useCallback((slotMachineId: string) => {
    const sock = getOrCreateSocket();
    const state = useGameStore.getState();
    
    // Check if player is fully in a room before attempting to join
    // Need both roomId and localPlayer to ensure room join is complete
    if (!state.roomId) {
      console.error('[useSocket] Cannot join slot machine - not in a room. roomId:', state.roomId);
      return;
    }
    
    if (!state.localPlayer) {
      console.error('[useSocket] Cannot join slot machine - room join not complete. localPlayer:', state.localPlayer);
      return;
    }
    
    if (!sock.connected) {
      console.error('[useSocket] Cannot join slot machine - socket not connected');
      return;
    }
    
    console.log('[useSocket] Emitting join_slot_machine for machine:', slotMachineId, 'socket connected:', sock.connected, 'socket id:', sock.id, 'roomId:', state.roomId, 'hasLocalPlayer:', !!state.localPlayer);
    
    // Add error handler for this specific emit
    const errorHandler = (error: any) => {
      console.error('[useSocket] Error emitting join_slot_machine:', error);
    };
    
    sock.emit('join_slot_machine', { slotMachineId }, errorHandler);
    
    // Also listen for any errors
    const oneTimeErrorListener = (error: any) => {
      console.error('[useSocket] Socket error:', error);
      sock.off('error', oneTimeErrorListener);
    };
    sock.once('error', oneTimeErrorListener);
  }, []);
  
  const leaveSlotMachine = useCallback((slotMachineId: string) => {
    const sock = getOrCreateSocket();
    sock.emit('leave_slot_machine', { slotMachineId });
  }, []);
  
  const spinSlotMachine = useCallback((slotMachineId: string, betAmount: number) => {
    const sock = getOrCreateSocket();
    if (!sock.connected) {
      console.error('[useSocket] Socket not connected!');
      return;
    }
    console.log('[useSocket] Emitting spin_slot_machine:', { slotMachineId, betAmount });
    sock.emit('spin_slot_machine', { slotMachineId, betAmount });
  }, []);
  
  // Trade functions
  const requestTrade = useCallback((otherPlayerId: string) => {
    const sock = getOrCreateSocket();
    if (!sock.connected) {
      console.error('[useSocket] Socket not connected!');
      return;
    }
    sock.emit('trade_request', { otherPlayerId });
  }, []);
  
  const modifyTradeOffer = useCallback((items: Array<{ itemId: string; quantity: number }>, orbs: number) => {
    const sock = getOrCreateSocket();
    if (!sock.connected) {
      console.error('[useSocket] Socket not connected!');
      return;
    }
    sock.emit('trade_modify', { items, orbs });
  }, []);
  
  const acceptTrade = useCallback(() => {
    const sock = getOrCreateSocket();
    if (!sock.connected) {
      console.error('[useSocket] Socket not connected!');
      return;
    }
    sock.emit('trade_accept');
  }, []);
  
  const declineTrade = useCallback(() => {
    const sock = getOrCreateSocket();
    if (!sock.connected) {
      console.error('[useSocket] Socket not connected!');
      return;
    }
    sock.emit('trade_decline');
  }, []);
  
  const cancelTrade = useCallback(() => {
    const sock = getOrCreateSocket();
    if (!sock.connected) {
      console.error('[useSocket] Socket not connected!');
      return;
    }
    sock.emit('trade_cancel');
  }, []);
  
  // Kick player function
  const kickPlayer = useCallback((targetPlayerId: string) => {
    const sock = getOrCreateSocket();
    if (!sock.connected) {
      console.error('[useSocket] Socket not connected!');
      return;
    }
    sock.emit('kick_player', { targetPlayerId });
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
            // Calculate orb multiplier from equipped items
            let orbMultiplier = 1.0;
            const equippedOutfit = profile.equippedItems || [];
            const shopItems = state.shopItems;
            for (const itemId of equippedOutfit) {
              const item = shopItems.find(s => s.id === itemId);
              if (item?.orbMultiplier && isFinite(item.orbMultiplier)) {
                // Use highest boost (don't stack), cap at reasonable maximum
                orbMultiplier = Math.min(3.0, Math.max(orbMultiplier, item.orbMultiplier));
              }
            }
            
            // Calculate orbs to receive (with boost)
            const orbsPerLog = 100;
            const baseOrbsReceived = logCount * orbsPerLog;
            const orbsReceived = Math.floor(baseOrbsReceived * orbMultiplier);
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
            // Calculate orb multiplier from equipped items
            let orbMultiplier = 1.0;
            const equippedOutfit = profile.equippedItems || [];
            const shopItems = state.shopItems;
            for (const itemId of equippedOutfit) {
              const item = shopItems.find(s => s.id === itemId);
              if (item?.orbMultiplier && isFinite(item.orbMultiplier)) {
                // Use highest boost (don't stack), cap at reasonable maximum
                orbMultiplier = Math.min(3.0, Math.max(orbMultiplier, item.orbMultiplier));
              }
            }
            
            // Calculate orbs to receive (with boost)
            const orbsPerCoin = 250;
            const baseOrbsReceived = coinCount * orbsPerCoin;
            const orbsReceived = Math.floor(baseOrbsReceived * orbMultiplier);
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
    joinBlackjackTable,
    leaveBlackjackTable,
    placeBlackjackBet,
    blackjackHit,
    blackjackStand,
    blackjackDoubleDown,
    blackjackSplit,
    joinSlotMachine,
    leaveSlotMachine,
    spinSlotMachine,
    requestTrade,
    modifyTradeOffer,
    acceptTrade,
    declineTrade,
    cancelTrade,
    kickPlayer,
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
