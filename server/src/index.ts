import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { initializeDatabase } from './db';
import * as db from './db';
import * as rooms from './rooms';
import * as players from './players';
import * as shop from './shop';
import * as blackjack from './blackjack';
import * as trades from './trades';
import * as slots from './slots';
import { startOrbSpawner, stopOrbSpawner, startFountainOrbSpawner, stopFountainOrbSpawner } from './orbs';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  Direction,
  GAME_CONSTANTS,
} from './types';

const PORT = process.env.PORT || 3001;

// Initialize Express
const app = express();
app.use(cors());
app.use(express.json());

// Serve static files (sprites) from client assets folder
app.use('/sprites', express.static(path.join(__dirname, '../../client/public/sprites')));

// Create HTTP server
const httpServer = createServer(app);

// Initialize Socket.IO
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:5173', 'http://localhost:3000'];

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Initialize database
initializeDatabase();

// Verify idle collector items are loaded
const shopItems = shop.getShopItems();
const idleCollectors = shopItems.filter(item => item.idleRewardRate && item.idleRewardRate > 0);
console.log(`[Idle Reward System] Found ${idleCollectors.length} idle collector items in shop:`, 
  idleCollectors.map(item => `${item.name} (${item.idleRewardRate}/sec)`).join(', '));

// Initialize global rooms
rooms.initializeGlobalRooms();

// Initialize blackjack tables
blackjack.initializeBlackjackTables();

// Initialize slot machines
let slotMachinesInitialized = false;

// Track socket -> player mapping
// Note: This is cleared on server restart (new Map instance)
const socketToPlayer: Map<string, { playerId: string; roomId: string }> = new Map();

// Track last movement time for each player (for idle collectors)
// Map: playerId -> lastMovementTime (timestamp)
const playerLastMovement: Map<string, number> = new Map();

// Track last idle reward time for each player (to prevent double rewards)
// Map: playerId -> lastRewardTime (timestamp)
const playerLastIdleReward: Map<string, number> = new Map();

// Track players currently purchasing loot boxes (prevent concurrent purchases)
// Map: playerId -> true if purchasing
const playerPurchasingLootBox: Map<string, boolean> = new Map();

// Clean up any lingering socket state on server startup
// (Socket.IO rooms are automatically cleared when server restarts, but we ensure clean state)
function clearAllSocketState() {
  socketToPlayer.clear();
  // Socket.IO rooms are automatically empty on server restart since 'io' is a new instance
  console.log('Socket state cleared on server startup');
}

// Clear socket state on startup
clearAllSocketState();

// Idle reward system - check every 1 second and reward idle players
console.log('[Idle Reward System] Starting idle reward interval (every 1 second)');
let intervalRunCount = 0;
setInterval(async () => {
  intervalRunCount++;
  const now = Date.now();
  const IDLE_THRESHOLD = 3000; // 3 seconds of no movement to be considered idle (first reward)
  const REWARD_INTERVAL = 5000; // Reward every 5 seconds after the first reward
  
  
  // Iterate through all rooms and check players
  const allRooms = rooms.getAllRooms();
  
  if (allRooms.length === 0) {
    return; // No rooms, skip
  }
  
  for (const roomId of allRooms) {
    const playersInRoom = rooms.getPlayersInRoom(roomId);
    
    if (playersInRoom.length === 0) {
      continue; // No players in this room
    }
    
    for (const player of playersInRoom) {
      const lastMove = playerLastMovement.get(player.id);
      if (!lastMove) {
        // Player not tracked yet, initialize them
        playerLastMovement.set(player.id, now);
        continue;
      }
      
      const idleTime = now - lastMove;
      
      // Player must be idle for at least IDLE_THRESHOLD
      if (idleTime >= IDLE_THRESHOLD) {
        // Check if player has idle collector equipped
        const shopItems = shop.getShopItems();
        let maxIdleRewardRate = 0;
        
        if (!player.sprite?.outfit || player.sprite.outfit.length === 0) {
          // No outfit equipped, skip
          continue;
        }
        
        // Check equipped items for idle collectors
        for (const itemId of player.sprite.outfit) {
          const item = shopItems.find(s => s.id === itemId);
          if (item?.idleRewardRate && isFinite(item.idleRewardRate)) {
            // Use highest idle reward rate (don't stack)
            maxIdleRewardRate = Math.max(maxIdleRewardRate, item.idleRewardRate);
          }
        }
        
        // If player has an idle collector equipped, reward them
        if (maxIdleRewardRate > 0) {
          const lastReward = playerLastIdleReward.get(player.id) || 0;
          const timeSinceLastReward = now - lastReward;
          
          // Only reward if enough time has passed since last reward
          if (timeSinceLastReward >= REWARD_INTERVAL) {
            // Calculate orbs to reward (rate per second * interval in seconds)
            const rewardIntervalSeconds = REWARD_INTERVAL / 1000;
            const orbsToReward = Math.floor(maxIdleRewardRate * rewardIntervalSeconds);
            
            if (orbsToReward > 0) {
              // Emit idle reward event to the player's client
              // Client will update Firebase directly (like selling logs does)
              // Then client will emit back with updated balance
              const playerSocket = Array.from(io.sockets.sockets.values()).find(socket => {
                const mapping = socketToPlayer.get(socket.id);
                return mapping && mapping.playerId === player.id;
              });
              
              if (playerSocket) {
                // Send idle reward event to client - client will update Firebase
                playerSocket.emit('idle_reward', { 
                  rewardAmount: orbsToReward,
                  maxIdleRewardRate 
                });
              }
              
              // Update last reward time
              playerLastIdleReward.set(player.id, now);
              
              // Estimate new balance for immediate room state update
              // Client will confirm the actual balance after Firebase update
              const estimatedNewBalance = (player.orbs || 0) + orbsToReward;
              player.orbs = estimatedNewBalance;
              await players.updatePlayerOrbs(player.id, estimatedNewBalance);
              
              // Broadcast update with reward amount for client-side visual feedback
              // Client will receive this and show floating text
              io.to(roomId).emit('player_orbs_updated', { 
                playerId: player.id, 
                orbs: estimatedNewBalance,
                rewardAmount: orbsToReward, // Include reward amount for idle rewards
                rewardType: 'idle' // Mark as idle reward
              });
              
              // Log reward (only occasionally to reduce spam)
              if (Math.random() < 0.1) { // 10% chance
                console.log(`[Idle Reward] ${player.name} received ${orbsToReward} orbs (${maxIdleRewardRate}/sec)`);
              }
            }
          }
        }
      }
    }
  }
}, 1000); // Check every 1 second for more accurate timing

// Socket connection handler
io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
  console.log('[Socket] New connection:', socket.id);
  // Only log if it's a new connection (not a reconnection)
  // Socket.IO reconnections create new socket IDs, so we can't easily distinguish
  // For now, we'll track connection count instead
  const connectionCount = io.sockets.sockets.size;
  if (connectionCount <= 2) {
    // Only log first few connections to avoid spam
    console.log(`Client connected: ${socket.id} (Total: ${connectionCount})`);
  }

  // Handle listing available rooms
  socket.on('list_rooms', () => {
    const roomList = rooms.getRoomList();
    console.log(`Sending room list: ${roomList.length} rooms`);
    socket.emit('room_list', roomList);
  });

  // Handle joining a room
  socket.on('join_room', async ({ roomId, playerName, orbs, equippedItems, mapType, password }) => {
    // Check if this socket is already in this room for this player (prevent duplicate joins)
    const existingMapping = socketToPlayer.get(socket.id);
    if (existingMapping && existingMapping.roomId === roomId) {
      const existingPlayer = rooms.getPlayerInRoom(roomId, existingMapping.playerId);
      if (existingPlayer) {
        // Already in room - just update player data and send room_state, don't rejoin
        console.log(`Socket ${socket.id} already in room ${roomId}, updating player data only`);
        const playerId = socket.handshake.auth?.playerId as string | undefined;
        if (playerId === existingMapping.playerId) {
          // Update player data
          existingPlayer.orbs = orbs || existingPlayer.orbs;
          existingPlayer.sprite.outfit = equippedItems || existingPlayer.sprite.outfit;
          
          // Send room_state without re-joining
          const room = rooms.getRoom(roomId);
          if (room) {
            const allPlayers = rooms.getPlayersInRoom(roomId);
            socket.emit('room_state', {
              roomId,
              players: allPlayers,
              orbs: (room.mapType === 'casino' || room.mapType === 'millionaires_lounge') ? [] : rooms.getOrbsInRoom(roomId), // Don't send orbs for casino/lounge maps
              shrines: rooms.getShrinesInRoom(roomId),
              treasureChests: rooms.getTreasureChestsInRoom(roomId),
              treeStates: rooms.getTreeStatesInRoom(roomId),
              yourPlayerId: playerId,
              mapType: room.mapType,
            });
          }
          return; // Exit early, don't process as new join
        }
      }
    }
    
    console.log(`join_room received: room=${roomId}, player=${playerName}, requestedMap=${mapType}, password=${password ? `provided (length: ${password.length})` : 'none'}`);
    
    // Extract player ID from handshake (Firebase UID)
    const playerId = socket.handshake.auth?.playerId as string | undefined;
    
    if (!playerId) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }
    
    // Check if room exists
    const existingRoom = rooms.getRoom(roomId);
    const isNewRoom = !existingRoom;
    const shouldBePrivate = !!password; // If password is provided, room should be private
    
    console.log(`Room ${roomId} exists: ${!!existingRoom}, isNewRoom: ${isNewRoom}, existingRoom.isPrivate: ${existingRoom?.isPrivate}, password provided: ${!!password}`);
    
    // Check if room is truly empty (no players OR no active sockets)
    const playersInRoom = existingRoom ? rooms.getPlayersInRoom(roomId) : [];
    const roomSockets = io.sockets.adapter.rooms.get(roomId);
    const activeSocketCount = roomSockets ? roomSockets.size : 0;
    const isEmptyRoom = playersInRoom.length === 0 || activeSocketCount === 0;
    
    // Check if the current player is the only one in the room (allowing them to convert their own room)
    const isOnlyPlayerInRoom = existingRoom && playersInRoom.length === 1 && playersInRoom[0]?.id === playerId;
    const canConvertToPrivate = isEmptyRoom || isOnlyPlayerInRoom;
    
    console.log(`Room ${roomId} check: players=${playersInRoom.length}, activeSockets=${activeSocketCount}, isEmpty=${isEmptyRoom}, isOnlyPlayer=${isOnlyPlayerInRoom}, canConvert=${canConvertToPrivate}`);
    
    // IMPORTANT: Check if room is private, but allow recreating empty private rooms
    // If room is empty and password is provided, allow recreating it (overwriting the old password)
    if (existingRoom && existingRoom.isPrivate && !isEmptyRoom) {
      // Room is private and has players - must validate password
      console.log(`[PASSWORD CHECK] Room ${roomId} is private with players, validating password...`);
      if (!password) {
        console.log(`[PASSWORD CHECK] Password required for private room ${roomId}, emitting error`);
        socket.emit('error', { message: 'Password required for private room' });
        return;
      }
      
      console.log(`[PASSWORD CHECK] Validating password for room ${roomId}...`);
      const isValidPassword = await rooms.validateRoomPassword(roomId, password);
      if (!isValidPassword) {
        console.log(`[PASSWORD CHECK] Incorrect password for room ${roomId}, emitting error`);
        socket.emit('error', { message: 'Incorrect password' });
        return;
      }
      console.log(`[PASSWORD CHECK] Password validated successfully for room ${roomId}`);
    }
    
    // Hash password if creating new private room or converting empty/public room
    let passwordHash: string | undefined;
    let finalIsPrivate = false;
    
    if (isNewRoom && password) {
      // Creating new private room
      passwordHash = await rooms.hashPassword(password);
      finalIsPrivate = true;
      console.log(`Creating new private room ${roomId} with password`);
    } else if (existingRoom && existingRoom.isPrivate && !isEmptyRoom) {
      // Joining existing private room with players - use existing hash (password already validated above)
      passwordHash = existingRoom.passwordHash;
      finalIsPrivate = true;
    } else if (existingRoom && existingRoom.isPrivate && isEmptyRoom && password) {
      // Recreating empty private room with new password
      passwordHash = await rooms.hashPassword(password);
      finalIsPrivate = true;
      existingRoom.passwordHash = passwordHash;
      console.log(`Recreating empty private room ${roomId} with new password`);
    } else if (existingRoom && !existingRoom.isPrivate && password && canConvertToPrivate) {
      // Converting public room to private - ALLOW if empty or if only current player is in it
      // Clean up any stale players if there are no active sockets
      if (activeSocketCount === 0 && existingRoom.players.size > 0) {
        console.log(`Cleaning up ${existingRoom.players.size} stale players from room ${roomId}`);
        existingRoom.players.clear();
      }
      passwordHash = await rooms.hashPassword(password);
      finalIsPrivate = true;
      existingRoom.isPrivate = true;
      existingRoom.passwordHash = passwordHash;
      console.log(`Converting public room ${roomId} to private (empty or only creator present)`);
    } else if (existingRoom && !existingRoom.isPrivate && password && !canConvertToPrivate) {
      // Room has other players, can't convert - but give helpful error
      socket.emit('error', { 
        message: `Room "${roomId}" already exists as a public room with ${existingRoom.players.size} player(s). Please choose a different room name or join the existing room.` 
      });
      return;
    } else if (existingRoom && !existingRoom.isPrivate && !password) {
      // Joining existing public room - this is fine
      finalIsPrivate = false;
    }
    
    // Get or create room with map type and privacy settings
    const room = rooms.getOrCreateRoom(
      roomId, 
      mapType, 
      finalIsPrivate, 
      passwordHash
    );
    const roomMapType = room.mapType;
    console.log(`Room ${roomId} mapType: ${roomMapType} (requested: ${mapType}), isPrivate: ${room.isPrivate}, passwordHash: ${room.passwordHash ? 'set' : 'none'}`);
    
    // Check if player is returning from casino or lounge (before creating player, so we can check old rooms)
    // This needs to be done before we remove them from old rooms, so we check first
    let wasInCasinoRoom = false;
    let wasInLoungeRoom = false;
    const allRoomIds = rooms.getAllRooms();
    for (const oldRoomId of allRoomIds) {
      if (oldRoomId !== roomId && oldRoomId.startsWith('casino-')) {
        const wasInOldRoom = rooms.getPlayerInRoom(oldRoomId, playerId);
        if (wasInOldRoom) {
          // Check if player has other active sockets in the old room
          const hasOtherSocketsInOldRoom = Array.from(socketToPlayer.entries()).some(
            ([otherSocketId, otherMapping]) => 
              otherSocketId !== socket.id && 
              otherMapping.playerId === playerId && 
              otherMapping.roomId === oldRoomId
          );
          // If no other sockets, they're switching from casino
          if (!hasOtherSocketsInOldRoom) {
            wasInCasinoRoom = true;
            break;
          }
        }
      } else if (oldRoomId !== roomId && oldRoomId.startsWith('millionaires_lounge-')) {
        const wasInOldRoom = rooms.getPlayerInRoom(oldRoomId, playerId);
        if (wasInOldRoom) {
          // Check if player has other active sockets in the old room
          const hasOtherSocketsInOldRoom = Array.from(socketToPlayer.entries()).some(
            ([otherSocketId, otherMapping]) => 
              otherSocketId !== socket.id && 
              otherMapping.playerId === playerId && 
              otherMapping.roomId === oldRoomId
          );
          // If no other sockets, they're switching from lounge
          if (!hasOtherSocketsInOldRoom) {
            wasInLoungeRoom = true;
            break;
          }
        }
      }
    }
    
    // Check if player is trying to join casino with insufficient balance
    if (roomId.startsWith('casino-')) {
      const playerBalance = orbs || 0;
      if (playerBalance < 5000000) {
        console.log(`[Casino] Rejecting join: Player ${playerId} has insufficient balance (${playerBalance} < 5000000)`);
        socket.emit('error', { 
          message: `You need at least 5M orbs to enter the casino. You currently have ${playerBalance.toLocaleString()} orbs.` 
        });
        return;
      }
    }
    
    // Create player with data from Firebase
    // If joining forest room and was in casino/lounge, spawn at portal
    const returningFromCasino = wasInCasinoRoom && roomMapType === 'forest';
    const returningFromLounge = wasInLoungeRoom && roomMapType === 'forest';
    const player = players.createPlayerFromFirebase(playerId, playerName, roomId, orbs || 0, equippedItems || [], roomMapType, returningFromCasino, returningFromLounge);
    
    // Initialize player movement tracking for idle rewards
    playerLastMovement.set(player.id, Date.now());
    
    // Initialize last movement time for idle tracking
    playerLastMovement.set(player.id, Date.now());
    
    // Sync server's local database with Firebase orb balance (source of truth)
    // This ensures shrine checks and other operations use the correct balance
    if (orbs !== undefined && orbs !== null) {
      await players.updatePlayerOrbs(playerId, orbs);
    }
    
    // Check if player is already in room (from another socket)
    const existingPlayer = rooms.getPlayerInRoom(roomId, player.id);
    if (existingPlayer) {
      // Update existing player data (orbs, equipped items might have changed)
      existingPlayer.orbs = player.orbs;
      existingPlayer.sprite.outfit = player.sprite.outfit;
      // Keep existing position and direction
      player.x = existingPlayer.x;
      player.y = existingPlayer.y;
      player.direction = existingPlayer.direction;
    }
    
    // IMPORTANT: Check if player is switching rooms and remove them from ALL other rooms
    // Check ALL rooms to see if player exists in any other room (more robust than just checking sockets)
    // Reuse allRoomIds from above (already declared)
    for (const oldRoomId of allRoomIds) {
      if (oldRoomId !== roomId) {
        // Check if player exists in this room
        const wasInOldRoom = rooms.getPlayerInRoom(oldRoomId, player.id);
        if (wasInOldRoom) {
          // Check if player has other active sockets in the old room
          const hasOtherSocketsInOldRoom = Array.from(socketToPlayer.entries()).some(
            ([otherSocketId, otherMapping]) => 
              otherSocketId !== socket.id && 
              otherMapping.playerId === player.id && 
              otherMapping.roomId === oldRoomId
          );
          
          // Only remove player if no other active sockets exist for them in the old room
          if (!hasOtherSocketsInOldRoom) {
            // Check if player is using a portal (joining casino/lounge or returning from one)
            const isJoiningCasino = roomId.startsWith('casino-');
            const isJoiningLounge = roomId.startsWith('millionaires_lounge-');
            const isReturningFromCasino = oldRoomId.startsWith('casino-') && roomMapType === 'forest';
            const isReturningFromLounge = oldRoomId.startsWith('millionaires_lounge-') && roomMapType === 'forest';
            
            // Broadcast portal sound to other players
            if (isJoiningCasino || isJoiningLounge || isReturningFromCasino || isReturningFromLounge) {
              let portalType: 'casino' | 'lounge' | 'return' = 'return';
              if (isJoiningCasino) {
                portalType = 'casino';
              } else if (isJoiningLounge) {
                portalType = 'lounge';
              } else if (isReturningFromCasino || isReturningFromLounge) {
                portalType = 'return';
              }
              
              // Broadcast portal sound to other players in the room being left (for casino/lounge portals)
              // For return portals, also broadcast to the room being entered (forest room)
              if (isJoiningCasino || isJoiningLounge) {
                // Player is leaving forest room to enter casino/lounge - broadcast to forest room
                io.to(oldRoomId).emit('portal_used', {
                  playerId: player.id,
                  playerName: player.name,
                  portalType
                });
                console.log(`Broadcasting portal_used event to room ${oldRoomId} for player ${player.name} using ${portalType} portal`);
              } else if (isReturningFromCasino || isReturningFromLounge) {
                // Player is returning from casino/lounge - broadcast to both rooms
                // Broadcast to casino/lounge room (room being left)
                io.to(oldRoomId).emit('portal_used', {
                  playerId: player.id,
                  playerName: player.name,
                  portalType: 'return'
                });
                // Also broadcast to forest room (room being entered) so players there hear the return
                io.to(roomId).emit('portal_used', {
                  playerId: player.id,
                  playerName: player.name,
                  portalType: 'return'
                });
                console.log(`Broadcasting portal_used event to rooms ${oldRoomId} and ${roomId} for player ${player.name} returning`);
              }
            }
            
            rooms.removePlayerFromRoom(oldRoomId, player.id);
            // Notify others in the old room that player left
            io.to(oldRoomId).emit('player_left', { playerId: player.id });
            console.log(`Player ${player.name} (${player.id}) left room ${oldRoomId} to join ${roomId}`);
            
            // Stop spawners if room is now empty
            const playersLeft = rooms.getPlayersInRoom(oldRoomId);
            if (playersLeft.length === 0) {
              stopOrbSpawner(oldRoomId);
              stopFountainOrbSpawner(oldRoomId);
            }
          } else {
            console.log(`Player ${player.name} (${player.id}) has other sockets in room ${oldRoomId}, not removing`);
          }
        }
      }
    }
    
    // IMPORTANT: Clean up any old sockets for this player in this room BEFORE adding the new one
    // This prevents accumulation of multiple sockets for the same player
    for (const [oldSocketId, oldMapping] of socketToPlayer.entries()) {
      if (oldMapping.playerId === player.id && oldMapping.roomId === roomId) {
        // This is an old socket for the same player - remove it
        const oldSocket = io.sockets.sockets.get(oldSocketId);
        if (oldSocket) {
          // Remove old socket from room
          oldSocket.leave(roomId);
        }
        // Remove old mapping
        socketToPlayer.delete(oldSocketId);
        console.log(`Cleaned up old socket ${oldSocketId} for player ${player.id} in room ${roomId}`);
      }
    }
    
    // Store mapping for new socket
    socketToPlayer.set(socket.id, { playerId: player.id, roomId });
    
    // Join socket room
    socket.join(roomId);
    
    // Add/update player in room (this will update if already exists)
    rooms.addPlayerToRoom(roomId, player);
    
    // Clear all orbs from casino/millionaires_lounge maps (they shouldn't have orbs)
    if (roomMapType === 'casino' || roomMapType === 'millionaires_lounge') {
      rooms.clearOrbsInRoom(roomId);
      // Notify all clients to remove orbs
      io.to(roomId).emit('orbs_cleared');
    }
    
    // Start orb spawner for this room (skips casino and millionaires_lounge maps)
    startOrbSpawner(io, roomId);
    
    // Start fountain orb spawner for forest maps
    if (roomMapType === 'forest') {
      startFountainOrbSpawner(io, roomId);
    }
    
    // Get all players in room (including the one we just added)
    let allPlayers = rooms.getPlayersInRoom(roomId);
    
    // Refresh orb values from database for all players (to ensure accurate balances)
    // Prioritize current player orb value (from Firebase) if it's valid, otherwise use database
    for (const p of allPlayers) {
      // If player already has a valid orb value (from Firebase), keep it
      if (p.orbs && p.orbs > 0) {
        // Player has a valid orb value, ensure it's in the database
        const dbPlayer = db.getPlayer(p.id);
        if (!dbPlayer || dbPlayer.orbs !== p.orbs) {
          // Update database to match player's current value
          db.updatePlayerOrbs(p.id, p.orbs);
        }
        // Keep the player's current orb value
        continue;
      }
      
      // If player's orb value is 0 or undefined, try to get from database
      const dbPlayer = db.getPlayer(p.id);
      if (dbPlayer && dbPlayer.orbs !== undefined && dbPlayer.orbs > 0) {
        // Update from database if it has a valid value
        p.orbs = dbPlayer.orbs;
        // Update in room as well
        const roomPlayer = rooms.getPlayerInRoom(roomId, p.id);
        if (roomPlayer) {
          roomPlayer.orbs = dbPlayer.orbs;
        }
      }
      // If neither has a value, keep 0 (new player)
    }
    
    console.log(`Room ${roomId} (${roomMapType}) now has ${allPlayers.length} players:`, allPlayers.map(p => `${p.name} (${p.id}) - ${p.orbs} orbs`));
    
    // Send room state to joining player (include their player ID and map type)
    socket.emit('room_state', {
      roomId,
      players: allPlayers,
      orbs: (roomMapType === 'casino' || roomMapType === 'millionaires_lounge') ? [] : rooms.getOrbsInRoom(roomId), // Don't send orbs for casino/lounge maps
      shrines: rooms.getShrinesInRoom(roomId),
      treasureChests: rooms.getTreasureChestsInRoom(roomId),
      treeStates: rooms.getTreeStatesInRoom(roomId),
      yourPlayerId: player.id,
      mapType: roomMapType,
    });
    
    console.log(`Sent room_state to ${player.name} with ${allPlayers.length} players, map: ${roomMapType}`);
    
    // Send shop items
    socket.emit('shop_items', shop.getShopItems());
    
    // IMPORTANT: Broadcast to other players BEFORE async Firebase calls
    // This ensures the broadcast doesn't get blocked by slow/failing Firebase operations
    // Count only connected sockets that are properly mapped (not disconnected ones)
    const joinSocketsInRoom = io.sockets.adapter.rooms.get(roomId);
    let numSockets = 0;
    if (joinSocketsInRoom) {
      // Only count sockets that are actually connected and mapped
      for (const socketId of joinSocketsInRoom) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket && socket.connected && socketToPlayer.has(socketId)) {
          numSockets++;
        }
      }
    }
    console.log(`Broadcasting player_joined for ${player.name} to room ${roomId} (${numSockets} active sockets in room)`);
    
    // Emit player_joined event to notify others
    io.to(roomId).emit('player_joined', player);
    
    // Refresh orb values from database for all players before broadcasting
    // CRITICAL: Always prefer room state over database to avoid stale data (especially during blackjack)
    for (const p of allPlayers) {
      // First, check room state (most up-to-date, especially during blackjack)
      const roomPlayer = rooms.getPlayerInRoom(roomId, p.id);
      if (roomPlayer && roomPlayer.orbs !== undefined && roomPlayer.orbs > 0) {
        // Room state has the most recent balance - use it
        p.orbs = roomPlayer.orbs;
        // Ensure database is in sync (but don't overwrite room state)
        const dbPlayer = db.getPlayer(p.id);
        if (!dbPlayer || dbPlayer.orbs !== roomPlayer.orbs) {
          db.updatePlayerOrbs(p.id, roomPlayer.orbs);
        }
        continue;
      }
      
      // If player already has a valid orb value (from Firebase), keep it
      if (p.orbs && p.orbs > 0) {
        // Player has a valid orb value, ensure it's in the database
        const dbPlayer = db.getPlayer(p.id);
        if (!dbPlayer || dbPlayer.orbs !== p.orbs) {
          // Update database to match player's current value
          db.updatePlayerOrbs(p.id, p.orbs);
        }
        // Keep the player's current orb value
        continue;
      }
      
      // If player's orb value is 0 or undefined, try to get from database
      const dbPlayer = db.getPlayer(p.id);
      if (dbPlayer && dbPlayer.orbs !== undefined && dbPlayer.orbs > 0) {
        // Update from database if it has a valid value
        p.orbs = dbPlayer.orbs;
        // Update in room as well
        if (roomPlayer) {
          roomPlayer.orbs = dbPlayer.orbs;
        }
      }
      // If neither has a value, keep 0 (new player)
    }
    
    // Broadcast updated room_state to ALL players so everyone has the latest player list
    io.to(roomId).emit('room_state', {
      roomId,
      players: allPlayers,
      orbs: (roomMapType === 'casino' || roomMapType === 'millionaires_lounge') ? [] : rooms.getOrbsInRoom(roomId), // Don't send orbs for casino/lounge maps
      shrines: rooms.getShrinesInRoom(roomId),
      treasureChests: rooms.getTreasureChestsInRoom(roomId),
      treeStates: rooms.getTreeStatesInRoom(roomId),
      mapType: room.mapType, // Include map type in broadcast
      // Don't send yourPlayerId here since this is a broadcast update
    });
    
    console.log(`Broadcast complete for ${player.name}`);
    
    // Note: Client loads its own inventory from Firebase directly
    // Server just sends orbs count that was passed during join
    socket.emit('inventory_updated', { items: [], orbs: player.orbs });
    
    console.log(`Player ${player.name} (${player.id}) joined room ${roomId}`);
  });

  // Handle leaving a room
  socket.on('leave_room', () => {
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) {
      // Socket wasn't in mapping, but might still be in a room - clean it up
      const socketRooms = Array.from(socket.rooms);
      for (const room of socketRooms) {
        // Skip the default room (socket.id) and system rooms
        if (room !== socket.id && !room.startsWith('_')) {
          socket.leave(room);
        }
      }
      return;
    }

    const { playerId, roomId } = mapping;
    
    // Leave socket room first
    socket.leave(roomId);
    
    // Remove mapping for this socket
    socketToPlayer.delete(socket.id);
    
    // Check if player has other sockets in this room
    const hasOtherSockets = Array.from(socketToPlayer.entries()).some(
      ([otherSocketId, otherMapping]) => 
        otherSocketId !== socket.id && 
        otherMapping.playerId === playerId && 
        otherMapping.roomId === roomId
    );
    
    // Only remove player from room if no other sockets exist for this player
    if (!hasOtherSockets) {
      rooms.removePlayerFromRoom(roomId, playerId);
      
      // Clean up idle tracking when player leaves
      playerLastMovement.delete(playerId);
      playerLastIdleReward.delete(playerId);
      
      // Clean up purchase lock
      playerPurchasingLootBox.delete(playerId);
      
      // Check if room is empty and stop spawner
      const playersLeft = rooms.getPlayersInRoom(roomId);
      if (playersLeft.length === 0) {
        stopOrbSpawner(roomId);
        stopFountainOrbSpawner(roomId);
      }
      
      // Notify others
      io.to(roomId).emit('player_left', { playerId });
      
      console.log(`Player ${playerId} left room ${roomId} (no more sockets)`);
    } else {
      console.log(`Socket ${socket.id} left room ${roomId} for player ${playerId}, but player still has other sockets`);
    }
  });

  // Track ping for each player (playerId -> last ping measurement)
  const playerPings: Map<string, number> = new Map();
  
  // Handle ping for latency measurement
  // Respond immediately (synchronously) to minimize server processing delay
  // This ensures ping measurements reflect true network latency, not server load
  socket.on('ping', ({ timestamp }: { timestamp: number }) => {
    // Send pong immediately without any async delay, echo the timestamp
    socket.emit('pong', { timestamp });
    
    // Note: Server does NOT calculate ping - client calculates it from round-trip time
    // This prevents clock skew issues and ensures accurate ping measurement
  });

  // Handle movement
  socket.on('move', ({ x, y, direction }) => {
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) return;

    const { playerId, roomId } = mapping;
    const player = rooms.getPlayerInRoom(roomId, playerId);
    if (!player) return;
    
    // Check if player actually moved (not just direction change)
    const moved = player.x !== x || player.y !== y;
    
    const updated = rooms.updatePlayerPosition(roomId, playerId, x, y, direction as Direction);
    
    // Update last movement time if player actually moved
    if (updated && moved) {
      playerLastMovement.set(playerId, Date.now());
    }
    
    if (updated) {
      io.to(roomId).emit('player_moved', { playerId, x, y, direction: direction as Direction });
    }
  });

  // Handle chat messages
  socket.on('chat_message', async ({ text }) => {
    console.log(`Chat message received from socket ${socket.id}:`, text);
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) {
      console.log('No mapping found for socket', socket.id);
      return;
    }

    const { playerId, roomId } = mapping;
    console.log(`Player ${playerId} in room ${roomId} says: ${text}`);
    
    // Sanitize and limit text
    const sanitizedText = text.slice(0, 200).trim();
    if (!sanitizedText) {
      console.log('Empty sanitized text, skipping');
      return;
    }

    const createdAt = rooms.updatePlayerChat(roomId, playerId, sanitizedText);
    
    // Get all sockets in the room to verify broadcast
    const roomSockets = await io.in(roomId).fetchSockets();
    console.log(`Broadcasting chat message to ${roomSockets.length} sockets in room ${roomId}`);
    
    io.to(roomId).emit('chat_message', { playerId, text: sanitizedText, createdAt });
    console.log('Chat message broadcasted:', { playerId, text: sanitizedText, createdAt });
  });

  // Handle orb collection
  socket.on('collect_orb', async ({ orbId }) => {
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) return;

    const { playerId, roomId } = mapping;
    const orb = rooms.collectOrb(roomId, orbId, playerId);
    
    if (orb) {
      // Get player from room state (client already updates Firebase, so we use room state as source)
      const player = rooms.getPlayerInRoom(roomId, playerId);
      if (!player) return;
      
      // Use player's current orb balance from room state (client keeps this in sync with Firebase)
      // This matches the pattern used in purchase_item and purchase_lootbox where client is source of truth
      const currentOrbs = player.orbs || 0;
      
      // Calculate orb multiplier from equipped items
      let orbMultiplier = 1.0;
      if (player.sprite?.outfit) {
        const shopItems = shop.getShopItems();
        for (const itemId of player.sprite.outfit) {
          const item = shopItems.find(s => s.id === itemId);
          if (item?.orbMultiplier && isFinite(item.orbMultiplier)) {
            // Use highest boost (don't stack), cap at reasonable maximum
            orbMultiplier = Math.min(2.5, Math.max(orbMultiplier, item.orbMultiplier));
          }
        }
      }
      
      // Apply multiplier to orb value
      const actualOrbValue = Math.floor(orb.value * orbMultiplier);
      const newBalance = currentOrbs + actualOrbValue;
      
      // Update room state (client will update Firebase and sync back via player_orbs_updated)
      player.orbs = newBalance;
      
      // Update local database to keep it in sync (same pattern as purchase_item)
      await players.updatePlayerOrbs(playerId, newBalance);
      
      // Broadcast collection and orb balance update to all players
      io.to(roomId).emit('orb_collected', { 
        orbId, 
        playerId, 
        newBalance,
        orbValue: actualOrbValue  // Send multiplied orb value so client can update Firebase
      });
      
      // Check if player balance dropped below 5M in casino - kick them to plaza
      if (roomId.startsWith('casino-') && newBalance < 5000000) {
        // Extract server region from casino room ID (e.g., "casino-eu-1" -> "eu-1")
        const serverRegion = roomId.replace('casino-', '');
        const plazaRoomId = `plaza-${serverRegion}`;
        
        console.log(`[Casino] Player ${playerId} balance dropped below 5M (${newBalance}), kicking to plaza: ${plazaRoomId}`);
        
        // Find all sockets for this player in the casino room
        const playerSockets = Array.from(socketToPlayer.entries())
          .filter(([_, playerMapping]) => playerMapping.playerId === playerId && playerMapping.roomId === roomId)
          .map(([socketId]) => io.sockets.sockets.get(socketId))
          .filter(Boolean) as Socket[];
        
        // Remove player from casino room
        rooms.removePlayerFromRoom(roomId, playerId);
        
        // Broadcast player_left to all clients in the room
        io.to(roomId).emit('player_left', { playerId });
        
        // Remove socket mappings and emit kick event BEFORE disconnecting
        playerSockets.forEach(playerSocket => {
          // Emit event first so client can receive it
          playerSocket.emit('force_room_change', { 
            roomId: plazaRoomId,
            reason: 'Your balance dropped below 5M. You have been moved to the plaza.'
          });
          // Disconnect after a short delay to ensure event is received
          setTimeout(() => {
            socketToPlayer.delete(playerSocket.id);
            playerSocket.disconnect();
          }, 100);
        });
        
        // Don't send balance update since player is being kicked
        return;
      }
      
      // Also emit player_orbs_updated to ensure all clients see the updated balance
      io.to(roomId).emit('player_orbs_updated', { playerId, orbs: newBalance });
    }
  });

  // Handle item purchase (client does Firebase update, server just validates and updates room state)
  socket.on('purchase_item', async (data: { itemId: string; newOrbs?: number; newInventory?: string[] }) => {
    const { itemId, newOrbs } = data;
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) return;

    const { playerId, roomId } = mapping;
    const player = rooms.getPlayerInRoom(roomId, playerId);
    
    if (player) {
      // Prevent purchasing godlike items (only available in godlike cases)
      const shopItems = shop.getShopItems();
      const item = shopItems.find(s => s.id === itemId);
      if (item && (item.rarity || 'common') === 'godlike') {
        console.log(`Player ${player.name} attempted to purchase godlike item ${itemId} - blocked`);
        return; // Silently reject the purchase
      }
      
      // Update player's orbs in room state and database (client already updated Firebase)
      if (typeof newOrbs === 'number') {
        // Update database to keep it in sync
        await players.updatePlayerOrbs(playerId, newOrbs);
        // Update room state
        player.orbs = newOrbs;
        // Broadcast orb update to all players in the room
        io.to(roomId).emit('player_orbs_updated', { playerId, orbs: newOrbs });
      }
      
      console.log(`Player ${player.name} purchased item ${itemId}, new balance: ${newOrbs}`);
    }
  });

  // Handle item sale (client does Firebase update, server just validates and updates room state)
  socket.on('sell_item', async (data: { itemId: string; newOrbs?: number; newInventory?: string[] }) => {
    const { itemId, newOrbs } = data;
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) return;

    const { playerId, roomId } = mapping;
    const player = rooms.getPlayerInRoom(roomId, playerId);
    
    if (player) {
      // Update player's orbs in room state and database (client already updated Firebase)
      if (typeof newOrbs === 'number') {
        // Update database to keep it in sync
        await players.updatePlayerOrbs(playerId, newOrbs);
        // Update room state
        player.orbs = newOrbs;
        // Broadcast orb update to all players in the room
        io.to(roomId).emit('player_orbs_updated', { playerId, orbs: newOrbs });
      }
      
      console.log(`Player ${player.name} sold item ${itemId}, new balance: ${newOrbs}`);
    }
  });

  // Handle loot box purchase (client does Firebase update, server validates and updates room state)
  socket.on('purchase_lootbox', async (data: { lootBoxId: string; itemId: string; newOrbs?: number; newInventory?: string[]; alreadyOwned?: boolean }) => {
    const { lootBoxId, itemId, newOrbs } = data;
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) return;

    const { playerId, roomId } = mapping;
    const player = rooms.getPlayerInRoom(roomId, playerId);
    
    if (!player) return;
    
    // Prevent concurrent purchases for the same player
    if (playerPurchasingLootBox.get(playerId)) {
      console.warn(`Player ${player.name} attempted concurrent loot box purchase - blocked`);
      return;
    }
    
    // Set purchase lock
    playerPurchasingLootBox.set(playerId, true);
    
    try {
      // Calculate expected price from balance change
      const currentOrbs = player.orbs || 0;
      
      if (typeof newOrbs !== 'number') {
        console.error(`Player ${player.name} purchase missing newOrbs`);
        playerPurchasingLootBox.delete(playerId);
        return;
      }
      
      // Calculate the price from the balance change
      const calculatedPrice = currentOrbs - newOrbs;
      
      // Validate price is reasonable (between 1 and 10M orbs)
      if (calculatedPrice < 1 || calculatedPrice > 10000000) {
        console.warn(`Player ${player.name} attempted purchase with invalid price: ${calculatedPrice}`);
        playerPurchasingLootBox.delete(playerId);
        return;
      }
      
      // Validate balance (check room state, which should be in sync with Firebase)
      if (currentOrbs < calculatedPrice) {
        console.warn(`Player ${player.name} attempted to purchase loot box with insufficient orbs. Current: ${currentOrbs}, Required: ${calculatedPrice}`);
        playerPurchasingLootBox.delete(playerId);
        return;
      }
      
      // Validate the new balance matches expected calculation
      const expectedNewOrbs = currentOrbs - calculatedPrice;
      // Allow small difference due to rounding, but flag large discrepancies
      if (Math.abs(newOrbs - expectedNewOrbs) > 1) {
        console.warn(`Player ${player.name} purchase balance mismatch. Expected: ${expectedNewOrbs}, Got: ${newOrbs}`);
        // Still accept it, but log the warning
      }
      
      // Update database to keep it in sync
      await players.updatePlayerOrbs(playerId, newOrbs);
      // Update room state
      player.orbs = newOrbs;
      // Broadcast orb update to all players in the room
      io.to(roomId).emit('player_orbs_updated', { playerId, orbs: newOrbs });
      
      console.log(`Player ${player.name} opened loot box ${lootBoxId} and received item ${itemId}, new balance: ${newOrbs}`);
    } catch (error) {
      console.error(`Error processing loot box purchase for player ${player.name}:`, error);
    } finally {
      // Always release the lock after a short delay to prevent rapid-fire purchases
      setTimeout(() => {
        playerPurchasingLootBox.delete(playerId);
      }, 500); // 500ms cooldown between purchases
    }
  });

  // Handle item equip/unequip (client does Firebase update, server broadcasts sprite change)
  socket.on('equip_item', (data: { itemId: string; equipped: boolean; equippedItems?: string[] }) => {
    const { itemId, equipped, equippedItems } = data;
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) {
      console.warn('equip_item: No mapping found for socket', socket.id);
      return;
    }

    const { playerId, roomId } = mapping;
    const player = rooms.getPlayerInRoom(roomId, playerId);
    
    if (!player) {
      console.warn(`equip_item: Player ${playerId} not found in room ${roomId}`);
      return;
    }
    
    if (!equippedItems) {
      console.warn(`equip_item: No equippedItems provided for player ${player.name}`);
      return;
    }
    
    // Update player sprite in room (client already updated Firebase)
    const oldOutfit = [...player.sprite.outfit];
    player.sprite.outfit = equippedItems;
    
    console.log(`Player ${player.name} ${equipped ? 'equipped' : 'unequipped'} item ${itemId}`);
    console.log(`  Old outfit:`, oldOutfit);
    console.log(`  New outfit:`, equippedItems);
    
    // Broadcast player update to ALL players in room (including sender) so everyone sees the cosmetic change
    // Count only connected sockets that are properly mapped
    const equipSocketsInRoom = io.sockets.adapter.rooms.get(roomId);
    let numActiveSockets = 0;
    if (equipSocketsInRoom) {
      for (const socketId of equipSocketsInRoom) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket && socket.connected && socketToPlayer.has(socketId)) {
          numActiveSockets++;
        }
      }
    }
    console.log(`  Broadcasting player_joined to ${numActiveSockets} active sockets in room ${roomId}`);
    
    io.to(roomId).emit('player_joined', player);
    
    console.log(`  Broadcast complete for ${player.name}'s sprite update`);
  });

  // Handle shrine interaction
  socket.on('shrine_interact', async ({ shrineId, firebaseOrbs }) => {
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) {
      console.log(`[Shrine] No mapping found for socket ${socket.id}`);
      return;
    }

    const { playerId, roomId } = mapping;
    console.log(`[Shrine] Player ${playerId} attempting to interact with shrine ${shrineId}`);
    try {
      const result = await rooms.interactWithShrine(roomId, shrineId, playerId, firebaseOrbs);
      console.log(`[Shrine] Interaction result:`, result);

      if (!result.success) {
        // For shrine interaction errors, emit a special event instead of generic error
        // This prevents the client from disconnecting on orb balance issues
        const shrine = rooms.getShrine(roomId, shrineId);
        if (shrine) {
          // Emit shrine_interaction_error event (cast to any to avoid TypeScript strict checking)
          (socket as any).emit('shrine_interaction_error', { shrineId, message: result.message });
        } else {
          socket.emit('error', { message: result.message });
        }
        return;
      }

      const shrine = rooms.getShrine(roomId, shrineId);
      if (!shrine) {
        socket.emit('error', { message: 'Shrine not found' });
        return;
      }

      // If blessed, spawn red shrine orbs around the shrine base
      let actualOrbsSpawned = 0;
      let actualTotalValue = 0; // Track total value of orbs actually spawned
      if (result.blessed && result.orbCount && result.totalValue) {
        const TILE_SIZE = 16;
        const SCALE = 3;
        const shrineX = shrine.x;
        const shrineY = shrine.y;
        // Spawn orbs very close to the base of the shrine (at ground level)
        // Shrine base platform is approximately 12 * SCALE pixels radius
        // Spawn orbs just outside the base platform, very close
        const baseRadius = 12 * SCALE; // Shrine base radius
        const orbRadius = baseRadius + 5 * SCALE; // Just outside base (about 15-20 pixels from center)
        
        // Split total value across the orb count (red shrine orbs)
        const valuePerOrb = Math.floor(result.totalValue / result.orbCount);
        const remainder = result.totalValue % result.orbCount;

        for (let i = 0; i < result.orbCount; i++) {
          // Evenly distribute around the shrine base
          const angle = (Math.PI * 2 * i) / result.orbCount + (Math.random() - 0.5) * 0.2;
          // Spawn very close to base with minimal variation
          const distance = orbRadius * (0.9 + Math.random() * 0.1); // 90-100% of radius (very tight)
          
          const orbX = shrineX + Math.cos(angle) * distance;
          // Spawn at shrine base level (shrine.y is center, base platform is at y + 8*SCALE)
          const orbY = shrineY + 8 * SCALE; // At base platform level

          // Calculate orb value (distribute total evenly, add remainder to first orb)
          // Note: totalValue already has orb multiplier applied from interactWithShrine
          const orbValue = valuePerOrb + (i === 0 ? remainder : 0);

          // Create red shrine orb (bypass max orbs limit for shrine rewards)
          const orb = rooms.createOrbAtPosition(roomId, orbX, orbY, orbValue, 'shrine', true);
          if (orb) {
            actualOrbsSpawned++;
            actualTotalValue += orbValue; // Sum up actual orb values
            // Mark orb as coming from shrine for client animation
            orb.fromShrine = {
              shrineId: shrine.id,
              shrineX: shrine.x,
              shrineY: shrine.y,
            };
            io.to(roomId).emit('orb_spawned', orb);
          }
        }
      }

      // Broadcast shrine interaction to all players in room (after spawning orbs to get accurate count)
      // Since we bypass max orbs for shrine rewards, orbs should always spawn if blessed
      io.to(roomId).emit('shrine_interacted', {
        shrineId,
        shrine,
        message: result.message,
        blessed: result.blessed && actualOrbsSpawned === result.orbCount, // Blessed if all orbs spawned successfully
        orbsSpawned: actualOrbsSpawned,
      });
      
      // Send chat message only if blessed (remove "no blessing" messages)
      if (result.blessed && actualOrbsSpawned > 0 && actualTotalValue > 0) {
        const player = rooms.getPlayerInRoom(roomId, playerId);
        if (player) {
          const chatMessage = `${player.name} was blessed by the shrine and received ${actualTotalValue.toLocaleString()} orbs! ✨`;
          const createdAt = rooms.updatePlayerChat(roomId, playerId, chatMessage);
          io.to(roomId).emit('chat_message', { playerId, text: chatMessage, createdAt });
          console.log(`[Shrine] Chat message sent: ${chatMessage}`);
        }
      }
    } catch (error: any) {
      console.error(`[Shrine] Error during shrine interaction for player ${playerId}:`, error);
      const shrine = rooms.getShrine(roomId, shrineId);
      if (shrine) {
        (socket as any).emit('shrine_interaction_error', { 
          shrineId, 
          message: 'An error occurred while interacting with the shrine. Please try again.' 
        });
      } else {
        socket.emit('error', { message: 'Shrine interaction failed' });
      }
    }
  });

  // Handle treasure chest interaction
  socket.on('treasure_chest_interact', async ({ chestId, firebaseOrbs }) => {
    console.log(`[TreasureChest] Received treasure_chest_interact event from socket ${socket.id}, chestId: ${chestId}, firebaseOrbs: ${firebaseOrbs}`);
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) {
      console.log(`[TreasureChest] No mapping found for socket ${socket.id}`);
      return;
    }

    const { playerId, roomId } = mapping;
    console.log(`[TreasureChest] Player ${playerId} attempting to interact with chest ${chestId} in room ${roomId}`);
    try {
      const result = await rooms.interactWithTreasureChest(roomId, chestId, playerId, firebaseOrbs);
      console.log(`[TreasureChest] Interaction result:`, result);

      if (!result.success) {
        const chest = rooms.getTreasureChest(roomId, chestId);
        if (chest) {
          (socket as any).emit('treasure_chest_interaction_error', { chestId, message: result.message });
        } else {
          socket.emit('error', { message: result.message });
        }
        return;
      }

      const chest = rooms.getTreasureChest(roomId, chestId);
      if (!chest) {
        socket.emit('error', { message: 'Treasure chest not found' });
        return;
      }

      // Client will handle Firebase update (same pattern as logs)
      // Server just calculates the result and emits the event

      // Emit directly to the interacting player with full data (including coinsFound for modal)
      const eventDataForOpener = {
        chestId,
        chest,
        message: result.message,
        coinsFound: result.coinsFound || 0,
        openedBy: playerId, // Include who opened it
      };
      console.log(`[TreasureChest] Emitting treasure_chest_opened directly to socket ${socket.id}, coinsFound: ${result.coinsFound || 0}`);
      socket.emit('treasure_chest_opened', eventDataForOpener);
      
      // Broadcast to other players in room (include coinsFound for sound, but they won't see modal)
      const eventDataForOthers = {
        chestId,
        chest,
        message: result.message,
        coinsFound: result.coinsFound || 0, // Include for sound broadcasting
        openedBy: playerId,
      };
      console.log(`[TreasureChest] Broadcasting treasure_chest_opened to room ${roomId} (excluding opener), coinsFound: ${result.coinsFound || 0}`);
      socket.to(roomId).emit('treasure_chest_opened', eventDataForOthers);
      
      // Send chat message if coins were found (broadcast to ALL players including opener)
      if (result.coinsFound && result.coinsFound > 0) {
        const player = rooms.getPlayerInRoom(roomId, playerId);
        if (player) {
          const chatMessage = `${player.name} found ${result.coinsFound} gold coins in a treasure chest! 🪙`;
          const createdAt = rooms.updatePlayerChat(roomId, playerId, chatMessage);
          // Broadcast to entire room including opener
          io.to(roomId).emit('chat_message', { playerId, text: chatMessage, createdAt });
          console.log(`[TreasureChest] Chat message sent to all players: ${chatMessage}`);
        }
      }
      
      console.log(`[TreasureChest] Event emitted successfully`);
    } catch (error: any) {
      console.error(`[TreasureChest] Error during chest interaction for player ${playerId}:`, error);
      const chest = rooms.getTreasureChest(roomId, chestId);
      if (chest) {
        (socket as any).emit('treasure_chest_interaction_error', { 
          chestId, 
          message: 'An error occurred while opening the chest. Please try again.' 
        });
      } else {
        socket.emit('error', { message: 'Treasure chest interaction failed' });
      }
    }
  });

  // Handle treasure chest relocation (after chest is opened and modal is closed)
  // Note: Chests no longer relocate - they stay in place and just clear cooldown
  socket.on('treasure_chest_relocate', ({ chestId }) => {
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) return;

    const { roomId } = mapping;
    const chest = rooms.getTreasureChest(roomId, chestId);
    
    if (!chest) {
      socket.emit('error', { message: 'Treasure chest not found' });
      return;
    }

    // Store old position (will be same as new position now)
    const oldX = chest.x;
    const oldY = chest.y;

    // Clear cooldown - chest stays in same position
    const result = rooms.relocateTreasureChest(roomId, chestId);
    
    if (!result.success) {
      socket.emit('error', { message: result.message || 'Failed to clear chest cooldown' });
      return;
    }

    // Broadcast that chest is available again (same position)
    const updatedChest = rooms.getTreasureChest(roomId, chestId);
    if (updatedChest) {
      io.to(roomId).emit('treasure_chest_relocated', {
        chestId,
        chest: updatedChest,
        oldX,
        oldY,
        newX: result.newX!,
        newY: result.newY!,
      });
      console.log(`[TreasureChest] Cleared cooldown for chest ${chestId} at (${result.newX}, ${result.newY})`);
    }
  });

  // Handle tree cutting - start cutting
  socket.on('start_cutting_tree', ({ treeId }) => {
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) return;

    const { playerId, roomId } = mapping;
    
    const success = rooms.setTreeCutting(roomId, treeId, playerId);
    
    if (!success) {
      socket.emit('error', { message: 'Tree is already cut or being cut by another player' });
      return;
    }

    // Broadcast tree state update
    const treeStates = rooms.getTreeStatesInRoom(roomId);
    io.to(roomId).emit('tree_state_updated', { treeStates });
  });

  // Handle tree cutting - cancel cutting
  socket.on('cancel_cutting_tree', ({ treeId }) => {
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) return;

    const { playerId, roomId } = mapping;
    rooms.cancelTreeCutting(roomId, treeId, playerId);

    // Broadcast tree state update
    const treeStates = rooms.getTreeStatesInRoom(roomId);
    io.to(roomId).emit('tree_state_updated', { treeStates });
  });

  // Handle tree cutting - complete cutting
  socket.on('complete_cutting_tree', async ({ treeId }) => {
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) return;

    const { playerId, roomId } = mapping;
    const player = rooms.getPlayerInRoom(roomId, playerId);
    if (!player) return;

    // Check if player is actually cutting this tree
    const treeState = rooms.getTreeState(roomId, treeId);
    if (!treeState || treeState.cutBy !== playerId) {
      socket.emit('error', { message: 'You are not cutting this tree' });
      return;
    }

    // Mark tree as cut
    rooms.setTreeCut(roomId, treeId, playerId);

    // Calculate log drop amount (2-8 logs, weighted towards lower amounts)
    // Weighted distribution: 2=40%, 3=25%, 4=15%, 5=10%, 6=5%, 7=3%, 8=2%
    const rand = Math.random();
    let logCount: number;
    if (rand < 0.40) {
      logCount = 2;
    } else if (rand < 0.65) {
      logCount = 3;
    } else if (rand < 0.80) {
      logCount = 4;
    } else if (rand < 0.90) {
      logCount = 5;
    } else if (rand < 0.95) {
      logCount = 6;
    } else if (rand < 0.98) {
      logCount = 7;
    } else {
      logCount = 8;
    }

    // Add logs to player inventory (client will handle Firebase update)
    for (let i = 0; i < logCount; i++) {
      await players.addToInventory(playerId, 'log');
    }

    // Broadcast tree state update with log count
    const treeStates = rooms.getTreeStatesInRoom(roomId);
    io.to(roomId).emit('tree_state_updated', { treeStates });
    
    // Notify the player about the logs received
    socket.emit('tree_cut_complete', { treeId, logCount });

    console.log(`Player ${player.name} cut down tree ${treeId} and received ${logCount} log${logCount !== 1 ? 's' : ''}`);
  });

  // Handle selling logs
  socket.on('sell_logs', async (data) => {
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) return;

    const { playerId, roomId } = mapping;
    const player = rooms.getPlayerInRoom(roomId, playerId);
    if (!player) return;

    // Client already handles removing logs from Firebase and updating orbs
    // Server validates and also updates Firebase to keep it in sync
    // Use client-provided values if available, otherwise check Firebase (fallback)
    let logCount = data?.logCount;
    let orbsReceived = data?.orbsReceived;

    if (logCount === undefined || orbsReceived === undefined) {
      // Fallback: check Firebase if client didn't provide data
      const { getUserInventory, getUserData } = await import('./firebase');
      const firebaseInventory = await getUserInventory(playerId);
      const logs = firebaseInventory.filter(itemId => itemId === 'log');
      logCount = logs.length;

      if (logCount === 0) {
        socket.emit('error', { message: 'You have no logs to sell' });
        return;
      }

      // Calculate orbs to receive (100 per log) with orb boost
      const orbsPerLog = 100;
      const baseOrbsReceived = logCount * orbsPerLog;
      
      // Calculate orb multiplier from equipped items
      let orbMultiplier = 1.0;
      if (player.sprite?.outfit) {
        const shopItems = shop.getShopItems();
        for (const itemId of player.sprite.outfit) {
          const item = shopItems.find(s => s.id === itemId);
          if (item?.orbMultiplier && isFinite(item.orbMultiplier)) {
            // Use highest boost (don't stack), cap at reasonable maximum
            orbMultiplier = Math.min(3.0, Math.max(orbMultiplier, item.orbMultiplier));
          }
        }
      }
      
      orbsReceived = Math.floor(baseOrbsReceived * orbMultiplier);
    } else if (logCount === 0) {
      // Client sent 0 logs - show error
      socket.emit('error', { message: 'You have no logs to sell' });
      return;
    }
    
    // Get current orbs from Firebase (source of truth) and add orbs received
    const { getUserData, updateUserOrbs } = await import('./firebase');
    const userData = await getUserData(playerId);
    const currentOrbs = userData?.orbs || player.orbs || 0;
    const newBalance = currentOrbs + orbsReceived;
    
    // Update Firebase to keep it in sync (same way as elsewhere in the app)
    await updateUserOrbs(playerId, newBalance);
    // Update room state
    player.orbs = newBalance;

    // Broadcast updates
    io.to(roomId).emit('logs_sold', { playerId, logCount, orbsReceived, newBalance });
    io.to(roomId).emit('player_orbs_updated', { playerId, orbs: newBalance });

    console.log(`Player ${player.name} sold ${logCount} logs for ${orbsReceived} orbs, new balance: ${newBalance}`);
  });

  // Handle idle reward confirmation from client (after client updates Firebase)
  socket.on('idle_reward_confirmed', ({ newOrbs }) => {
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) return;
    
    const { playerId, roomId } = mapping;
    const player = rooms.getPlayerInRoom(roomId, playerId);
    if (!player) return;
    
    // Update room state with confirmed balance from Firebase (source of truth)
    player.orbs = newOrbs;
    players.updatePlayerOrbs(playerId, newOrbs);
    
    // Balance was already broadcast with reward info, just sync the confirmed value
    // No need to broadcast again to avoid duplicate floating text
  });

  // ============ BLACKJACK HANDLERS ============
  
  // Debug: Log all events to see if blackjack events are received
  socket.onAny((eventName, ...args) => {
    if (eventName.includes('blackjack') || eventName === 'join_blackjack_table') {
      console.log(`[Socket Debug] Event received: ${eventName}`, args, 'on socket', socket.id);
    }
  });
  
  // Join blackjack table
  socket.on('join_blackjack_table', ({ tableId }) => {
    console.log('[Blackjack] ===== join_blackjack_table event received =====');
    console.log('[Blackjack] Table ID:', tableId);
    console.log('[Blackjack] Socket ID:', socket.id);
    console.log('[Blackjack] Socket connected:', socket.connected);
    console.log('[Blackjack] All socket rooms:', Array.from(socket.rooms));
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) {
      console.log('[Blackjack] No mapping found for socket', socket.id);
      socket.emit('blackjack_error', { tableId, message: 'Not connected to a room' });
      return;
    }
    
    const { playerId, roomId } = mapping;
    console.log('[Blackjack] Found mapping - playerId:', playerId, 'roomId:', roomId);
    
    const player = rooms.getPlayerInRoom(roomId, playerId);
    if (!player) {
      console.log('[Blackjack] Player not found in room', playerId, roomId);
      socket.emit('blackjack_error', { tableId, message: 'Player not found in room' });
      return;
    }
    
    console.log('[Blackjack] Player', playerId, '(' + player.name + ')', 'joining table', tableId);
    const result = blackjack.joinTable(tableId, playerId, player.name);
    console.log('[Blackjack] Join result:', result);
    
    if (result.success && result.seat !== undefined) {
      const table = blackjack.getTable(tableId);
      if (table) {
        // Calculate seat position for the player in world coordinates
        // Match the client's table positioning logic
        // Client uses scaled pixels, server uses unscaled pixels
        // Client: WORLD_WIDTH = TILE_SIZE * MAP_WIDTH * SCALE (scaled)
        // Server: WORLD_WIDTH = TILE_SIZE * MAP_WIDTH (unscaled)
        const SCALE = GAME_CONSTANTS.SCALE;
        const WORLD_WIDTH_SCALED = GAME_CONSTANTS.TILE_SIZE * GAME_CONSTANTS.MAP_WIDTH * SCALE;
        const WORLD_HEIGHT_SCALED = GAME_CONSTANTS.TILE_SIZE * GAME_CONSTANTS.MAP_HEIGHT * SCALE;
        const centerXScaled = WORLD_WIDTH_SCALED / 2;
        const centerYScaled = WORLD_HEIGHT_SCALED / 2;
        const plazaRadiusScaled = 600 * SCALE; // Doubled from 300 to 600 for more space (same as client)
        // Map table numbers to angles: table 2 = top left (3π/4), table 4 = bottom right (7π/4)
        const tableNumber = parseInt(tableId.replace('blackjack_table_', ''));
        const tableAngleMap: Record<number, number> = {
          2: 3 * Math.PI / 4,  // Top left
          4: 7 * Math.PI / 4   // Bottom right
        };
        const tableAngle = tableAngleMap[tableNumber];
        if (tableAngle === undefined) {
          console.error(`[Blackjack] Invalid table ID: ${tableId}`);
          return;
        }
        const tableRadiusScaled = plazaRadiusScaled * 0.6;
        const tableXScaled = centerXScaled + Math.cos(tableAngle) * tableRadiusScaled;
        const tableYScaled = centerYScaled + Math.sin(tableAngle) * tableRadiusScaled;
        const tableRadiusSizeScaled = 60 * SCALE;
        const tableMinorRadiusScaled = tableRadiusSizeScaled * 0.6; // Minor radius for ellipse (matching client)
        // Updated for 4 seats: evenly spaced in semi-circle (matching client renderer.ts)
        const seatAngle = Math.PI + (result.seat - 1.5) * (Math.PI / 3); // Seats on player side - 4 seats evenly spaced
        // Calculate edge position first (matching client logic)
        const edgeXScaled = tableXScaled + Math.cos(seatAngle) * tableRadiusSizeScaled;
        const edgeYScaled = tableYScaled + Math.sin(seatAngle) * tableMinorRadiusScaled;
        // Then add seat offset (matching client: 12 * SCALE)
        const seatOffsetScaled = 12 * SCALE;
        const seatXScaled = edgeXScaled + Math.cos(seatAngle) * seatOffsetScaled;
        const seatYScaled = edgeYScaled + Math.sin(seatAngle) * seatOffsetScaled;
        
        // Convert from scaled pixels to unscaled pixels (server coordinates)
        const seatX = seatXScaled / SCALE;
        const seatY = seatYScaled / SCALE;
        
        // Update player position to seat (center player sprite on seat)
        const seatWorldX = seatX - GAME_CONSTANTS.PLAYER_WIDTH / 2;
        const seatWorldY = seatY - GAME_CONSTANTS.PLAYER_HEIGHT / 2;
        player.x = seatWorldX;
        player.y = seatWorldY;
        
        console.log(`[Blackjack] Seat position calculation for seat ${result.seat}:`, {
          tableId,
          tableNumber,
          tableAngle: tableAngle * 180 / Math.PI,
          tableX: tableXScaled / SCALE,
          tableY: tableYScaled / SCALE,
          seatAngle: seatAngle * 180 / Math.PI,
          seatX,
          seatY,
          seatWorldX,
          seatWorldY,
          playerWidth: GAME_CONSTANTS.PLAYER_WIDTH,
          playerHeight: GAME_CONSTANTS.PLAYER_HEIGHT
        });
        
        // Set direction based on seat: seat 0 faces up, seats 1-2 face right, seat 3 faces down
        let seatDirection: 'up' | 'down' | 'left' | 'right' = 'up';
        if (result.seat === 1 || result.seat === 2) {
          seatDirection = 'right';
        } else if (result.seat === 3) {
          seatDirection = 'down';
        }
        
        player.direction = seatDirection;
        const positionUpdated = rooms.updatePlayerPosition(mapping.roomId, playerId, seatWorldX, seatWorldY, seatDirection);
        
        // Always broadcast position update when joining table (even if position didn't change)
        // This ensures the player is positioned correctly on their screen when rejoining
        io.to(mapping.roomId).emit('player_moved', { 
          playerId, 
          x: seatWorldX, 
          y: seatWorldY, 
          direction: seatDirection 
        });
        
        if (positionUpdated) {
          console.log(`[Blackjack] Positioned and broadcasted player ${playerId} at seat ${result.seat} (${seatWorldX}, ${seatWorldY})`);
        } else {
          console.log(`[Blackjack] Position update returned false, but still broadcasting position for player ${playerId} at seat ${result.seat} (${seatWorldX}, ${seatWorldY})`);
        }
        
        console.log('[Blackjack] Join successful, broadcasting state to', table.state.players.length, 'players');
        // Emit blackjack_joined event with seat info (similar to slot_machine_joined)
        socket.emit('blackjack_joined', { tableId, seat: result.seat });
        // First, send state directly to the joining player
        socket.emit('blackjack_state_update', { tableId, state: table.state });
        console.log('[Blackjack] Sent state update to joining player', playerId);
        
        // Then broadcast state update to all other players at table
        const tablePlayers = table.state.players.map(p => p.playerId);
        for (const tablePlayerId of tablePlayers) {
          // Skip the joining player (already sent above)
          if (tablePlayerId === playerId) continue;
          
          // Find socket for each player at table
          const playerSockets = Array.from(io.sockets.sockets.values()).filter(s => {
            const m = socketToPlayer.get(s.id);
            return m && m.playerId === tablePlayerId;
          });
          for (const playerSocket of playerSockets) {
            playerSocket.emit('blackjack_state_update', { tableId, state: table.state });
          }
        }
      } else {
        console.error('[Blackjack] Table not found after successful join!', tableId);
        socket.emit('blackjack_error', { tableId, message: 'Table state error' });
      }
    } else {
      console.log('[Blackjack] Join failed:', result.message, 'for player', playerId, 'table', tableId);
      socket.emit('blackjack_error', { tableId, message: result.message || 'Failed to join table' });
    }
  });
  
  // Leave blackjack table
  socket.on('leave_blackjack_table', ({ tableId }) => {
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) return;
    
    const { playerId } = mapping;
    
    const table = blackjack.getTable(tableId);
    if (table) {
      const player = table.state.players.find(p => p.playerId === playerId);
      if (player) {
        // Forfeit any active bets
        let totalForfeit = 0;
        for (const hand of player.hands) {
          totalForfeit += hand.bet;
        }
        
        // Update player orbs if they had bets
        if (totalForfeit > 0) {
          const roomPlayer = rooms.getPlayerInRoom(mapping.roomId, playerId);
          if (roomPlayer) {
            // Note: In a real implementation, you might want to refund or handle this differently
            // For now, we'll just remove them from the table
          }
        }
      }
    }
    
    const result = blackjack.leaveTable(tableId, playerId);
    if (result.success) {
      const table = blackjack.getTable(tableId);
      if (table) {
        // Broadcast state update to all remaining players at table
        const tablePlayers = table.state.players.map(p => p.playerId);
        for (const tablePlayerId of tablePlayers) {
          const playerSockets = Array.from(io.sockets.sockets.values()).filter(s => {
            const m = socketToPlayer.get(s.id);
            return m && m.playerId === tablePlayerId;
          });
          for (const playerSocket of playerSockets) {
            playerSocket.emit('blackjack_state_update', { tableId, state: table.state });
          }
        }
        // Also send to the leaving player
        socket.emit('blackjack_state_update', { tableId, state: table.state });
      }
    } else {
      // Only emit error if it's a real error (e.g., table not found), not if player is already not at table
      if (result.message && result.message !== 'Player not at table') {
        socket.emit('blackjack_error', { tableId, message: result.message });
      }
    }
  });
  
  // Place bet
  socket.on('place_blackjack_bet', async ({ tableId, amount }) => {
    console.log(`[Blackjack] ===== place_blackjack_bet event received =====`);
    console.log(`[Blackjack] Table ID: ${tableId}`);
    console.log(`[Blackjack] Amount received: ${amount} (type: ${typeof amount})`);
    
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) {
      console.error('[Blackjack] No mapping found for socket', socket.id);
      return;
    }
    
    const { playerId } = mapping;
    const player = rooms.getPlayerInRoom(mapping.roomId, playerId);
    if (!player) {
      console.error('[Blackjack] Player not found in room', playerId, mapping.roomId);
      return;
    }
    
    // Ensure amount is a number
    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      console.error(`[Blackjack] Invalid bet amount: ${amount} (converted to ${numericAmount})`);
      socket.emit('blackjack_error', { tableId, message: 'Invalid bet amount' });
      return;
    }
    
    // Get current orbs - prefer room state (in-memory) over Firebase to avoid stale data
    // Room state is updated immediately after blackjack wins, while Firebase may lag
    // Only fall back to Firebase if room state is missing
    const { getUserData } = await import('./firebase');
    let currentOrbs = player.orbs || 0;
    
    // If room state is 0 or missing, try Firebase as fallback
    if (currentOrbs === 0) {
      const userData = await getUserData(playerId);
      currentOrbs = userData?.orbs || 0;
      // Update room state with Firebase value if we got it
      if (currentOrbs > 0) {
        player.orbs = currentOrbs;
        players.updatePlayerOrbs(playerId, currentOrbs);
      }
    }
    
    console.log(`[Blackjack] Placing bet: player=${playerId}, amount=${numericAmount}, currentOrbs=${currentOrbs} (from ${player.orbs > 0 ? 'room state' : 'Firebase'})`);
    
    const result = blackjack.placeBet(tableId, playerId, numericAmount, currentOrbs);
    if (result.success) {
      // CRITICAL: Server manages ALL balance updates for blackjack
      // 1. Calculate new balance
      // 2. Update Firebase (server is source of truth)
      // 3. Update room state
      // 4. Broadcast to clients (clients only receive and display, never update Firebase)
      
      // Deduct bet from player orbs
      const newBalance = currentOrbs - numericAmount;
      console.log(`[Blackjack] Bet placed: deducting ${numericAmount}, balance ${currentOrbs} -> ${newBalance}`);
      
      // Note: Client will update Firebase (server Firebase Admin SDK may not be initialized)
      // Server calculates balance and updates room state, client handles Firebase update
      console.log(`[Blackjack] Balance calculated: ${playerId} -> ${newBalance} orbs (client will update Firebase)`);
      
      // Update room state (keep in sync with Firebase)
      player.orbs = newBalance;
      players.updatePlayerOrbs(playerId, newBalance);
      console.log(`[Blackjack] Updated room state: ${playerId} -> ${newBalance} orbs`);
      
      // Broadcast orb update to clients (clients receive and display only, do NOT update Firebase)
      // CRITICAL: Only emit AFTER Firebase update is complete to prevent race conditions
      console.log(`[Blackjack] Emitting player_orbs_updated: playerId=${playerId}, orbs=${newBalance}, rewardAmount=${-numericAmount}, rewardType=blackjack`);
      io.to(mapping.roomId).emit('player_orbs_updated', { 
        playerId, 
        orbs: newBalance, // This is the new balance after deduction (server already updated Firebase)
        rewardAmount: -numericAmount, // Negative to show deduction (for UI feedback)
        rewardType: 'blackjack'
      });
      console.log(`[Blackjack] Emitted player_orbs_updated event for bet placement`);
      
      // Verify bet was stored correctly
      const table = blackjack.getTable(tableId);
      if (table) {
        const blackjackPlayer = table.state.players.find(p => p.playerId === playerId);
        if (blackjackPlayer && blackjackPlayer.hands.length > 0) {
          const storedBet = blackjackPlayer.hands[0].bet;
          console.log(`[Blackjack] Verified bet stored: hand.bet=${storedBet}, expected=${amount}`);
          if (storedBet !== amount) {
            console.error(`[Blackjack] CRITICAL ERROR: Bet mismatch after placement! Stored: ${storedBet}, Expected: ${amount}`);
          }
        } else {
          console.error(`[Blackjack] CRITICAL ERROR: Could not find player or hand after bet placement!`);
        }
        
        // Check if all players have placed bets, then start dealing
        const playersWithBets = table.state.players.filter(p => p.hasPlacedBet);
        const allPlayersHaveBetted = table.state.players.length > 0 && 
          playersWithBets.length === table.state.players.length;
        
        // Auto-start dealing if all players have bet
        // For single player games, start immediately (1v1 against dealer)
        if (allPlayersHaveBetted && table.state.gameState === 'betting') {
          // Very short delay for single player (almost immediate), longer for multiple players
          const delay = table.state.players.length === 1 ? 500 : 3000;
          setTimeout(async () => {
            const dealResult = blackjack.startDealing(tableId);
            if (dealResult.success) {
              const updatedTable = blackjack.getTable(tableId);
              if (updatedTable) {
                console.log('[Blackjack] Started dealing for table', tableId, 'with', updatedTable.state.players.length, 'players');
                
                // CRITICAL: If game finished immediately (dealer blackjack OR all players have blackjack), process payouts now
                if (updatedTable.state.gameState === 'finished') {
                  const finishReason = updatedTable.state.dealerHasBlackjack 
                    ? 'dealer blackjack' 
                    : 'all players have blackjack (dealer finished)';
                  console.log(`[Blackjack] Game finished immediately - ${finishReason} - processing payouts now`);
                  const payouts = blackjack.calculatePayouts(tableId);
                  
                  // Get roomId from first player's socket mapping
                  let roomIdForPayouts = mapping.roomId;
                  const firstPlayerId = updatedTable.state.players[0]?.playerId;
                  if (firstPlayerId) {
                    const firstPlayerSocket = Array.from(io.sockets.sockets.values()).find(s => {
                      const m = socketToPlayer.get(s.id);
                      return m && m.playerId === firstPlayerId;
                    });
                    if (firstPlayerSocket) {
                      const firstPlayerMapping = socketToPlayer.get(firstPlayerSocket.id);
                      if (firstPlayerMapping) {
                        roomIdForPayouts = firstPlayerMapping.roomId;
                      }
                    }
                  }
                  
                  // Helper function to broadcast win/loss to chat
                  const tableForPayouts = blackjack.getTable(tableId);
                  const broadcastBlackjackResult = (playerId: string, payout: number, roomId: string) => {
                    const roomPlayer = rooms.getPlayerInRoom(roomId, playerId);
                    if (!roomPlayer) return;
                    
                    // Calculate total bet for this player (sum of all hands)
                    let totalBet = 0;
                    if (tableForPayouts) {
                      const blackjackPlayer = tableForPayouts.state.players.find(p => p.playerId === playerId);
                      if (blackjackPlayer) {
                        for (const hand of blackjackPlayer.hands) {
                          totalBet += Number(hand.bet) || 0;
                        }
                      }
                    }
                    
                    // Calculate win/loss amount
                    let winAmount = 0;
                    let lossAmount = 0;
                    if (payout === 0) {
                      // Loss: payout is 0, bet was already deducted
                      lossAmount = totalBet;
                    } else {
                      // Win: payout includes bet return + winnings, show total payout amount
                      winAmount = payout; // Show total payout (bet return + winnings)
                    }
                    
                    // Broadcast win/loss to chat and show chat bubble
                    if (winAmount > 0) {
                      const winMessage = `won ${winAmount.toLocaleString()} orbs at blackjack!`;
                      const textColor = '#22c55e'; // Green for wins
                      const createdAt = rooms.updatePlayerChat(roomId, playerId, winMessage, textColor);
                      io.to(roomId).emit('chat_message', { playerId, text: winMessage, createdAt, textColor });
                      console.log(`[Blackjack] Player ${playerId} (${roomPlayer.name}) ${winMessage}`);
                    } else if (lossAmount > 0) {
                      const lossMessage = `lost ${lossAmount.toLocaleString()} orbs at blackjack`;
                      const textColor = '#ef4444'; // Red for losses
                      const createdAt = rooms.updatePlayerChat(roomId, playerId, lossMessage, textColor);
                      io.to(roomId).emit('chat_message', { playerId, text: lossMessage, createdAt, textColor });
                      console.log(`[Blackjack] Player ${playerId} (${roomPlayer.name}) ${lossMessage}`);
                    }
                  };
                  
                  // Apply payouts for all players
                  for (const [payoutPlayerId, payout] of payouts.entries()) {
                    // Broadcast win/loss to chat for all players (wins and losses)
                    broadcastBlackjackResult(payoutPlayerId, payout, roomIdForPayouts);
                    
                    const roomPlayer = rooms.getPlayerInRoom(roomIdForPayouts, payoutPlayerId);
                    if (roomPlayer) {
                      // CRITICAL: Server calculates balance updates for blackjack
                      // 1. Calculate new balance from room state (source of truth)
                      // 2. Update room state
                      // 3. Broadcast to clients (clients will update Firebase)
                      const currentOrbs = roomPlayer.orbs || 0;
                      // For losses (payout === 0), balance was already deducted when bet was placed
                      // For wins, add the payout to current balance
                      const newBalance = payout === 0 ? currentOrbs : (currentOrbs + payout);
                      
                      // Update balance if it changed (wins only, losses already deducted)
                      if (payout > 0) {
                        roomPlayer.orbs = newBalance;
                        players.updatePlayerOrbs(payoutPlayerId, newBalance);
                      }
                      
                      // Check if player balance dropped below 5M in casino - kick them to plaza
                      // This check applies to both wins and losses
                      if (roomIdForPayouts.startsWith('casino-') && newBalance < 5000000) {
                        // Extract server region from casino room ID (e.g., "casino-eu-1" -> "eu-1")
                        const serverRegion = roomIdForPayouts.replace('casino-', '');
                        const plazaRoomId = `plaza-${serverRegion}`;
                        
                        console.log(`[Casino] Player ${payoutPlayerId} balance dropped below 5M (${newBalance}), kicking to plaza: ${plazaRoomId}`);
                        
                        // Find all sockets for this player in the casino room
                        const playerSockets = Array.from(socketToPlayer.entries())
                          .filter(([_, playerMapping]) => playerMapping.playerId === payoutPlayerId && playerMapping.roomId === roomIdForPayouts)
                          .map(([socketId]) => io.sockets.sockets.get(socketId))
                          .filter(Boolean) as Socket[];
                        
                        // Remove player from casino room
                        rooms.removePlayerFromRoom(roomIdForPayouts, payoutPlayerId);
                        
                        // Broadcast player_left to all clients in the room
                        io.to(roomIdForPayouts).emit('player_left', { playerId: payoutPlayerId });
                        
                        // Remove socket mappings and emit kick event BEFORE disconnecting
                        playerSockets.forEach(playerSocket => {
                          // Emit event first so client can receive it
                          playerSocket.emit('force_room_change', { 
                            roomId: plazaRoomId,
                            reason: 'Your balance dropped below 5M. You have been moved to the plaza.'
                          });
                          // Disconnect after a short delay to ensure event is received
                          setTimeout(() => {
                            socketToPlayer.delete(playerSocket.id);
                            playerSocket.disconnect();
                          }, 100);
                        });
                        
                        // Don't send balance update since player is being kicked
                        continue;
                      }
                      
                      // CRITICAL: Skip losses (payout = 0) - bet was already deducted when placed
                      // Don't send any event for losses to avoid confusing the client
                      if (payout === 0) {
                        console.log(`[Blackjack] Player ${payoutPlayerId} lost - payout is 0, bet already deducted (no event sent)`);
                        continue;
                      }
                      
                      io.to(roomIdForPayouts).emit('player_orbs_updated', { 
                        playerId: payoutPlayerId, 
                        orbs: newBalance, // Client will update Firebase
                        rewardAmount: payout,
                        rewardType: 'blackjack'
                      });
                      
                      console.log(`[Blackjack] Payout for ${payoutPlayerId} (${finishReason}): ${payout > 0 ? '+' : ''}${payout} orbs (balance: ${currentOrbs} -> ${newBalance})`);
                    }
                  }
                  
                  // Reset table after 5 seconds
                  setTimeout(() => {
                    blackjack.resetTable(tableId);
                    const resetTable = blackjack.getTable(tableId);
                    if (resetTable) {
                      const tablePlayers = resetTable.state.players.map(p => p.playerId);
                      for (const tablePlayerId of tablePlayers) {
                        const playerSockets = Array.from(io.sockets.sockets.values()).filter(s => {
                          const m = socketToPlayer.get(s.id);
                          return m && m.playerId === tablePlayerId;
                        });
                        for (const playerSocket of playerSockets) {
                          playerSocket.emit('blackjack_state_update', { tableId, state: resetTable.state });
                        }
                      }
                    }
                  }, 5000);
                }
                
                // Broadcast state to all players at table
                const tablePlayers = updatedTable.state.players.map(p => p.playerId);
                for (const tablePlayerId of tablePlayers) {
                  const playerSockets = Array.from(io.sockets.sockets.values()).filter(s => {
                    const m = socketToPlayer.get(s.id);
                    return m && m.playerId === tablePlayerId;
                  });
                  for (const playerSocket of playerSockets) {
                    playerSocket.emit('blackjack_state_update', { tableId, state: updatedTable.state });
                  }
                }
                // Also broadcast to all players in casino room so they can see dealer announcements
                const mappingForRoom = socketToPlayer.get(socket.id);
                if (mappingForRoom && mappingForRoom.roomId && mappingForRoom.roomId.startsWith('casino-')) {
                  io.to(mappingForRoom.roomId).emit('blackjack_state_update', { tableId, state: updatedTable.state });
                }
              }
            } else {
              console.error('[Blackjack] Failed to start dealing:', dealResult.message);
            }
          }, delay);
        }
        
        // Broadcast state update
        const tablePlayers = table.state.players.map(p => p.playerId);
        for (const tablePlayerId of tablePlayers) {
          const playerSockets = Array.from(io.sockets.sockets.values()).filter(s => {
            const m = socketToPlayer.get(s.id);
            return m && m.playerId === tablePlayerId;
          });
          for (const playerSocket of playerSockets) {
            playerSocket.emit('blackjack_state_update', { tableId, state: table.state });
          }
        }
      }
    } else {
      socket.emit('blackjack_error', { tableId, message: result.message || 'Failed to place bet' });
    }
  });
  
  // Hit
  socket.on('blackjack_hit', ({ tableId, handIndex = 0 }) => {
    console.log('[Blackjack] ===== blackjack_hit event received =====');
    console.log('[Blackjack] Table ID:', tableId);
    console.log('[Blackjack] Hand Index:', handIndex);
    console.log('[Blackjack] Socket ID:', socket.id);
    
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) {
      console.log('[Blackjack] No mapping found for socket', socket.id);
      socket.emit('blackjack_error', { tableId, message: 'Not connected to a room' });
      return;
    }
    
    const { playerId } = mapping;
    console.log('[Blackjack] Player ID:', playerId);
    
    const result = blackjack.hit(tableId, playerId, handIndex);
    console.log('[Blackjack] Hit result:', result);
    
    if (result.success) {
      const table = blackjack.getTable(tableId);
      if (table) {
        // Check if round is finished and calculate payouts
        if (table.state.gameState === 'finished') {
          const payouts = blackjack.calculatePayouts(tableId);
          const table = blackjack.getTable(tableId);
          
          // Helper function to broadcast win/loss to chat
          const broadcastBlackjackResult = (playerId: string, payout: number, roomId: string) => {
            const roomPlayer = rooms.getPlayerInRoom(roomId, playerId);
            if (!roomPlayer) return;
            
            // Calculate total bet for this player (sum of all hands)
            let totalBet = 0;
            if (table) {
              const blackjackPlayer = table.state.players.find(p => p.playerId === playerId);
              if (blackjackPlayer) {
                for (const hand of blackjackPlayer.hands) {
                  totalBet += Number(hand.bet) || 0;
                }
              }
            }
            
            // Calculate win/loss amount
            let winAmount = 0;
            let lossAmount = 0;
            if (payout === 0) {
              // Loss: payout is 0, bet was already deducted
              lossAmount = totalBet;
            } else {
              // Win: payout includes bet return + winnings, show total payout amount
              winAmount = payout; // Show total payout (bet return + winnings)
            }
            
            // Broadcast win/loss to chat and show chat bubble
            if (winAmount > 0) {
              const winMessage = `won ${winAmount.toLocaleString()} orbs at blackjack!`;
              const textColor = '#22c55e'; // Green for wins
              const createdAt = rooms.updatePlayerChat(roomId, playerId, winMessage, textColor);
              io.to(roomId).emit('chat_message', { playerId, text: winMessage, createdAt, textColor });
              console.log(`[Blackjack] Player ${playerId} (${roomPlayer.name}) ${winMessage}`);
            } else if (lossAmount > 0) {
              const lossMessage = `lost ${lossAmount.toLocaleString()} orbs at blackjack`;
              const textColor = '#ef4444'; // Red for losses
              const createdAt = rooms.updatePlayerChat(roomId, playerId, lossMessage, textColor);
              io.to(roomId).emit('chat_message', { playerId, text: lossMessage, createdAt, textColor });
              console.log(`[Blackjack] Player ${playerId} (${roomPlayer.name}) ${lossMessage}`);
            }
          };
          
          // Apply payouts and update player orbs
          // Note: payout includes bet return + winnings (or 0 for loss)
          payouts.forEach(async (payout, payoutPlayerId) => {
            // Broadcast win/loss to chat for all players (wins and losses)
            broadcastBlackjackResult(payoutPlayerId, payout, mapping.roomId);
            
            // CRITICAL: Skip losses (payout = 0) - bet was already deducted when placed
            // Don't send orb update event for losses to avoid confusing the client
            if (payout === 0) {
              console.log(`[Blackjack] Player ${payoutPlayerId} lost - payout is 0, bet already deducted (no orb event sent)`);
              return; // Don't process further - bet was already deducted when placed
            }
            
            const roomPlayer = rooms.getPlayerInRoom(mapping.roomId, payoutPlayerId);
            if (roomPlayer) {
              const currentOrbs = roomPlayer.orbs || 0;
              
              console.log(`[Blackjack] ===== PROCESSING PAYOUT =====`);
              console.log(`[Blackjack] Player: ${payoutPlayerId}`);
              console.log(`[Blackjack] Calculated payout from calculatePayouts(): ${payout} orbs`);
              console.log(`[Blackjack] Current balance (from room state): ${currentOrbs} orbs`);
              
              // CRITICAL: Validate payout amount
              if (payout < 0) {
                console.error(`[Blackjack] CRITICAL ERROR: Negative payout! ${payout}`);
                console.error(`[Blackjack] Skipping payout application for player ${payoutPlayerId}`);
                return; // Don't apply negative payout
              }
              
              // Validate payout is reasonable
              // For a loss: payout should be 0 (already handled above)
              // For a win: payout should be at least the bet amount (bet return + winnings)
              // For a push: payout should equal the bet amount
              const { BLACKJACK_CONSTANTS } = await import('./types');
              if (payout > 0 && payout < BLACKJACK_CONSTANTS.MIN_BET) {
                console.error(`[Blackjack] CRITICAL ERROR: Suspiciously low payout! ${payout} (expected at least ${BLACKJACK_CONSTANTS.MIN_BET} for a win/push)`);
                console.error(`[Blackjack] This suggests either: 1) Bet was corrupted, or 2) Payout calculation is wrong`);
              }
              
              const newBalance = currentOrbs + payout;
              console.log(`[Blackjack] Balance calculation: ${currentOrbs} + ${payout} = ${newBalance}`);
              
              console.log(`[Blackjack] New balance will be: ${newBalance} orbs`);
              console.log(`[Blackjack] Net change: ${newBalance - currentOrbs} orbs`);
              console.log(`[Blackjack] ===== END PAYOUT PROCESSING =====`);
              
              // CRITICAL: Server calculates balance updates for blackjack
              // 1. Calculate new balance from room state (source of truth)
              // 2. Update room state
              // 3. Broadcast to clients (clients will update Firebase)
              console.log(`[Blackjack] Balance calculated: ${payoutPlayerId} -> ${newBalance} orbs (client will update Firebase)`);
              
              // Update room state
              roomPlayer.orbs = newBalance;
              players.updatePlayerOrbs(payoutPlayerId, newBalance);
              console.log(`[Blackjack] Updated room state: ${payoutPlayerId} -> ${newBalance} orbs`);
              
              // Broadcast to clients (clients receive and display only, do NOT update Firebase)
              // payout is the TOTAL amount to add (includes bet return + winnings)
              // For a 10k bet win: payout = 20k (10k bet return + 10k win)
              // For blackjack: payout = 25k (10k bet return + 15k win at 3:2)
              io.to(mapping.roomId).emit('player_orbs_updated', { 
                playerId: payoutPlayerId, 
                orbs: newBalance, // Server already updated Firebase
                rewardAmount: payout, // Total payout amount (bet return + winnings)
                rewardType: 'blackjack'
              });
              
              console.log(`[Blackjack] Payout applied: ${payoutPlayerId} received ${payout} orbs total (${currentOrbs} -> ${newBalance})`);
              console.log(`[Blackjack] Breakdown: bet was already deducted, payout=${payout} includes bet return + winnings`);
            }
          });
          
          // Reset table after 5 seconds
          setTimeout(() => {
            blackjack.resetTable(tableId);
            const resetTable = blackjack.getTable(tableId);
            if (resetTable) {
              const tablePlayers = resetTable.state.players.map(p => p.playerId);
              for (const tablePlayerId of tablePlayers) {
                const playerSockets = Array.from(io.sockets.sockets.values()).filter(s => {
                  const m = socketToPlayer.get(s.id);
                  return m && m.playerId === tablePlayerId;
                });
                for (const playerSocket of playerSockets) {
                  playerSocket.emit('blackjack_state_update', { tableId, state: resetTable.state });
                }
              }
            }
          }, 5000);
        }
        
        // Broadcast state update
        const tablePlayers = table.state.players.map(p => p.playerId);
        for (const tablePlayerId of tablePlayers) {
          const playerSockets = Array.from(io.sockets.sockets.values()).filter(s => {
            const m = socketToPlayer.get(s.id);
            return m && m.playerId === tablePlayerId;
          });
          for (const playerSocket of playerSockets) {
            playerSocket.emit('blackjack_state_update', { tableId, state: table.state });
          }
        }
        // Also broadcast to all players in casino room so they can see dealer announcements
        const mappingForRoom = socketToPlayer.get(socket.id);
        if (mappingForRoom && mappingForRoom.roomId && mappingForRoom.roomId.startsWith('casino-')) {
          io.to(mappingForRoom.roomId).emit('blackjack_state_update', { tableId, state: table.state });
        }
      }
    } else {
      console.log('[Blackjack] Hit failed:', result.message);
      socket.emit('blackjack_error', { tableId, message: result.message || 'Failed to hit' });
    }
  });
  
  // Stand
  socket.on('blackjack_stand', ({ tableId, handIndex = 0 }) => {
    console.log('[Blackjack] ===== blackjack_stand event received =====');
    console.log('[Blackjack] Table ID:', tableId);
    console.log('[Blackjack] Hand Index:', handIndex);
    console.log('[Blackjack] Socket ID:', socket.id);
    
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) {
      console.log('[Blackjack] No mapping found for socket', socket.id);
      socket.emit('blackjack_error', { tableId, message: 'Not connected to a room' });
      return;
    }
    
    const { playerId } = mapping;
    console.log('[Blackjack] Player ID:', playerId);
    
    const result = blackjack.stand(tableId, playerId, handIndex);
    console.log('[Blackjack] Stand result:', result);
    
    if (result.success) {
      const table = blackjack.getTable(tableId);
      if (table) {
        // Check if round is finished
        if (table.state.gameState === 'finished') {
          const payouts = blackjack.calculatePayouts(tableId);
          const tableForPayouts = blackjack.getTable(tableId);
          
          // Helper function to broadcast win/loss to chat
          const broadcastBlackjackResult = (playerId: string, payout: number, roomId: string) => {
            const roomPlayer = rooms.getPlayerInRoom(roomId, playerId);
            if (!roomPlayer) return;
            
            // Calculate total bet for this player (sum of all hands)
            let totalBet = 0;
            if (tableForPayouts) {
              const blackjackPlayer = tableForPayouts.state.players.find(p => p.playerId === playerId);
              if (blackjackPlayer) {
                for (const hand of blackjackPlayer.hands) {
                  totalBet += Number(hand.bet) || 0;
                }
              }
            }
            
            // Calculate win/loss amount
            let winAmount = 0;
            let lossAmount = 0;
            if (payout === 0) {
              // Loss: payout is 0, bet was already deducted
              lossAmount = totalBet;
            } else {
              // Win: payout includes bet return + winnings, show total payout amount
              winAmount = payout; // Show total payout (bet return + winnings)
            }
            
            // Broadcast win/loss to chat and show chat bubble
            if (winAmount > 0) {
              const winMessage = `won ${winAmount.toLocaleString()} orbs at blackjack!`;
              const textColor = '#22c55e'; // Green for wins
              const createdAt = rooms.updatePlayerChat(roomId, playerId, winMessage, textColor);
              io.to(roomId).emit('chat_message', { playerId, text: winMessage, createdAt, textColor });
              console.log(`[Blackjack] Player ${playerId} (${roomPlayer.name}) ${winMessage}`);
            } else if (lossAmount > 0) {
              const lossMessage = `lost ${lossAmount.toLocaleString()} orbs at blackjack`;
              const textColor = '#ef4444'; // Red for losses
              const createdAt = rooms.updatePlayerChat(roomId, playerId, lossMessage, textColor);
              io.to(roomId).emit('chat_message', { playerId, text: lossMessage, createdAt, textColor });
              console.log(`[Blackjack] Player ${playerId} (${roomPlayer.name}) ${lossMessage}`);
            }
          };
          
          payouts.forEach(async (payout, payoutPlayerId) => {
            // Broadcast win/loss to chat for all players (wins and losses)
            broadcastBlackjackResult(payoutPlayerId, payout, mapping.roomId);
            
            // CRITICAL: Skip losses (payout = 0) - bet was already deducted when placed
            // Don't send any event for losses to avoid confusing the client
            if (payout === 0) {
              console.log(`[Blackjack] Player ${payoutPlayerId} lost - payout is 0, bet already deducted (no event sent)`);
              return; // Don't process losses - bet was already deducted when placed
            }
            
            const roomPlayer = rooms.getPlayerInRoom(mapping.roomId, payoutPlayerId);
            if (roomPlayer) {
              // CRITICAL: Server calculates balance updates for blackjack
              // 1. Calculate new balance from room state (source of truth)
              // 2. Update room state
              // 3. Broadcast to clients (clients will update Firebase)
              const currentOrbs = roomPlayer.orbs || 0;
              const newBalance = currentOrbs + payout;
              
              roomPlayer.orbs = newBalance;
              players.updatePlayerOrbs(payoutPlayerId, newBalance);
              
              io.to(mapping.roomId).emit('player_orbs_updated', { 
                playerId: payoutPlayerId, 
                orbs: newBalance, // Client will update Firebase
                rewardAmount: payout, // Total payout amount (bet return + winnings)
                rewardType: 'blackjack'
              });
              
              console.log(`[Blackjack] Payout for ${payoutPlayerId}: ${payout > 0 ? '+' : ''}${payout} orbs (balance: ${currentOrbs} -> ${newBalance})`);
            }
          });
          
          setTimeout(() => {
            blackjack.resetTable(tableId);
            const resetTable = blackjack.getTable(tableId);
            if (resetTable) {
              const tablePlayers = resetTable.state.players.map(p => p.playerId);
              for (const tablePlayerId of tablePlayers) {
                const playerSockets = Array.from(io.sockets.sockets.values()).filter(s => {
                  const m = socketToPlayer.get(s.id);
                  return m && m.playerId === tablePlayerId;
                });
                for (const playerSocket of playerSockets) {
                  playerSocket.emit('blackjack_state_update', { tableId, state: resetTable.state });
                }
              }
            }
          }, 5000);
        }
        
        // Broadcast state update
        const tablePlayers = table.state.players.map(p => p.playerId);
        for (const tablePlayerId of tablePlayers) {
          const playerSockets = Array.from(io.sockets.sockets.values()).filter(s => {
            const m = socketToPlayer.get(s.id);
            return m && m.playerId === tablePlayerId;
          });
          for (const playerSocket of playerSockets) {
            playerSocket.emit('blackjack_state_update', { tableId, state: table.state });
          }
        }
        // Also broadcast to all players in casino room so they can see dealer announcements
        const mappingForRoom = socketToPlayer.get(socket.id);
        if (mappingForRoom && mappingForRoom.roomId && mappingForRoom.roomId.startsWith('casino-')) {
          io.to(mappingForRoom.roomId).emit('blackjack_state_update', { tableId, state: table.state });
        }
      }
    } else {
      console.log('[Blackjack] Stand failed:', result.message);
      socket.emit('blackjack_error', { tableId, message: result.message || 'Failed to stand' });
    }
  });
  
  // Double down
  socket.on('blackjack_double_down', async ({ tableId, handIndex = 0 }) => {
    console.log('[Blackjack] ===== blackjack_double_down event received =====');
    console.log('[Blackjack] Table ID:', tableId);
    console.log('[Blackjack] Hand Index:', handIndex);
    console.log('[Blackjack] Socket ID:', socket.id);
    
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) {
      console.log('[Blackjack] No mapping found for socket', socket.id);
      socket.emit('blackjack_error', { tableId, message: 'Not connected to a room' });
      return;
    }
    
    const { playerId } = mapping;
    console.log('[Blackjack] Player ID:', playerId);
    
    const player = rooms.getPlayerInRoom(mapping.roomId, playerId);
    if (!player) {
      console.log('[Blackjack] Player not found in room', playerId, mapping.roomId);
      socket.emit('blackjack_error', { tableId, message: 'Player not found in room' });
      return;
    }
    
    const table = blackjack.getTable(tableId);
    if (!table) {
      console.log('[Blackjack] Table not found', tableId);
      socket.emit('blackjack_error', { tableId, message: 'Table not found' });
      return;
    }
    
    const blackjackPlayer = table.state.players.find(p => p.playerId === playerId);
    if (!blackjackPlayer) {
      console.log('[Blackjack] Player not at table', playerId);
      socket.emit('blackjack_error', { tableId, message: 'Player not at table' });
      return;
    }
    
    const hand = blackjackPlayer.hands[handIndex];
    if (!hand) {
      console.log('[Blackjack] Invalid hand index', handIndex);
      socket.emit('blackjack_error', { tableId, message: 'Invalid hand' });
      return;
    }
    
    // Store original bet BEFORE doubling (we need to deduct this amount)
    const originalBet = hand.bet;
    console.log('[Blackjack] Original bet before double down:', originalBet);
    
    // Get current orbs
    const { getUserData } = await import('./firebase');
    const userData = await getUserData(playerId);
    const currentOrbs = userData?.orbs || player.orbs || 0;
    console.log('[Blackjack] Current orbs:', currentOrbs);
    
    const result = blackjack.doubleDown(tableId, playerId, handIndex, currentOrbs);
    console.log('[Blackjack] Double down result:', result);
    
    if (result.success) {
      // Deduct the additional bet (original bet amount, since bet was doubled)
      // The bet was doubled in blackjack.doubleDown, so we need to deduct the original bet amount
      const additionalBet = originalBet;
      const newBalance = currentOrbs - additionalBet;
      console.log(`[Blackjack] Deducting additional bet: ${additionalBet}, balance ${currentOrbs} -> ${newBalance} (client will update Firebase)`);
      player.orbs = newBalance;
      players.updatePlayerOrbs(playerId, newBalance);
      
      // Broadcast orb update with rewardType so client handles it correctly
      console.log(`[Blackjack] Emitting player_orbs_updated for double down: playerId=${playerId}, orbs=${newBalance}, rewardAmount=${-additionalBet}, rewardType=blackjack`);
      io.to(mapping.roomId).emit('player_orbs_updated', { 
        playerId, 
        orbs: newBalance,
        rewardAmount: -additionalBet, // Negative to show deduction
        rewardType: 'blackjack'
      });
      
      // Check if round finished
      const updatedTable = blackjack.getTable(tableId);
      if (updatedTable && updatedTable.state.gameState === 'finished') {
        const payouts = blackjack.calculatePayouts(tableId);
        const tableForPayouts = blackjack.getTable(tableId);
        
        // Helper function to broadcast win/loss to chat
        const broadcastBlackjackResult = (playerId: string, payout: number, roomId: string) => {
          const roomPlayer = rooms.getPlayerInRoom(roomId, playerId);
          if (!roomPlayer) return;
          
          // Calculate total bet for this player (sum of all hands)
          let totalBet = 0;
          if (tableForPayouts) {
            const blackjackPlayer = tableForPayouts.state.players.find(p => p.playerId === playerId);
            if (blackjackPlayer) {
              for (const hand of blackjackPlayer.hands) {
                totalBet += Number(hand.bet) || 0;
              }
            }
          }
          
          // Calculate win/loss amount
          let winAmount = 0;
          let lossAmount = 0;
          if (payout === 0) {
            // Loss: payout is 0, bet was already deducted
            lossAmount = totalBet;
          } else {
            // Win: payout includes bet return + winnings, show total payout amount
            winAmount = payout; // Show total payout (bet return + winnings)
          }
          
          // Broadcast win/loss to chat and show chat bubble
          if (winAmount > 0) {
            const winMessage = `won ${winAmount.toLocaleString()} orbs at blackjack!`;
            const textColor = '#22c55e'; // Green for wins
            const createdAt = rooms.updatePlayerChat(roomId, playerId, winMessage, textColor);
            io.to(roomId).emit('chat_message', { playerId, text: winMessage, createdAt, textColor });
            console.log(`[Blackjack] Player ${playerId} (${roomPlayer.name}) ${winMessage}`);
          } else if (lossAmount > 0) {
            const lossMessage = `lost ${lossAmount.toLocaleString()} orbs at blackjack`;
            const textColor = '#ef4444'; // Red for losses
            const createdAt = rooms.updatePlayerChat(roomId, playerId, lossMessage, textColor);
            io.to(roomId).emit('chat_message', { playerId, text: lossMessage, createdAt, textColor });
            console.log(`[Blackjack] Player ${playerId} (${roomPlayer.name}) ${lossMessage}`);
          }
        };
        
        payouts.forEach(async (payout, payoutPlayerId) => {
          // Broadcast win/loss to chat for all players (wins and losses)
          broadcastBlackjackResult(payoutPlayerId, payout, mapping.roomId);
          
          const roomPlayer = rooms.getPlayerInRoom(mapping.roomId, payoutPlayerId);
          if (roomPlayer) {
            // CRITICAL: Server calculates balance updates for blackjack
            // 1. Calculate new balance from room state (source of truth)
            // 2. Update room state
            // 3. Broadcast to clients (clients will update Firebase)
            const currentOrbs = roomPlayer.orbs || 0;
            // For losses (payout === 0), balance was already deducted when bet was placed
            // For wins, add the payout to current balance
            const newBalance = payout === 0 ? currentOrbs : (currentOrbs + payout);
            
            // Update balance if it changed (wins only, losses already deducted)
            if (payout > 0) {
              roomPlayer.orbs = newBalance;
              players.updatePlayerOrbs(payoutPlayerId, newBalance);
            }
            
            // Check if player balance dropped below 5M in casino - kick them to plaza
            // This check applies to both wins and losses
            if (mapping.roomId.startsWith('casino-') && newBalance < 5000000) {
              // Extract server region from casino room ID (e.g., "casino-eu-1" -> "eu-1")
              const serverRegion = mapping.roomId.replace('casino-', '');
              const plazaRoomId = `plaza-${serverRegion}`;
              
              console.log(`[Casino] Player ${payoutPlayerId} balance dropped below 5M (${newBalance}), kicking to plaza: ${plazaRoomId}`);
              
              // Find all sockets for this player in the casino room
              const playerSockets = Array.from(socketToPlayer.entries())
                .filter(([_, playerMapping]) => playerMapping.playerId === payoutPlayerId && playerMapping.roomId === mapping.roomId)
                .map(([socketId]) => io.sockets.sockets.get(socketId))
                .filter(Boolean) as Socket[];
              
              // Remove player from casino room
              rooms.removePlayerFromRoom(mapping.roomId, payoutPlayerId);
              
              // Broadcast player_left to all clients in the room
              io.to(mapping.roomId).emit('player_left', { playerId: payoutPlayerId });
              
              // Remove socket mappings and emit kick event BEFORE disconnecting
              playerSockets.forEach(playerSocket => {
                // Emit event first so client can receive it
                playerSocket.emit('force_room_change', { 
                  roomId: plazaRoomId,
                  reason: 'Your balance dropped below 5M. You have been moved to the plaza.'
                });
                // Disconnect after a short delay to ensure event is received
                setTimeout(() => {
                  socketToPlayer.delete(playerSocket.id);
                  playerSocket.disconnect();
                }, 100);
              });
              
              // Don't send balance update since player is being kicked
              return;
            }
            
            // CRITICAL: Skip losses (payout = 0) - bet was already deducted when placed
            // Don't send any event for losses - bet deduction event was already sent when bet was placed
            if (payout === 0) {
              console.log(`[Blackjack] Player ${payoutPlayerId} lost - payout is 0, bet already deducted (no event sent)`);
              return; // Don't process further - bet was already deducted when placed
            }
            
            io.to(mapping.roomId).emit('player_orbs_updated', { 
              playerId: payoutPlayerId, 
              orbs: newBalance, // Client will update Firebase
              rewardAmount: payout, // Total payout amount (bet return + winnings)
              rewardType: 'blackjack'
            });
            
            console.log(`[Blackjack] Payout for ${payoutPlayerId}: ${payout > 0 ? '+' : ''}${payout} orbs (balance: ${currentOrbs} -> ${newBalance})`);
          }
        });
        
        setTimeout(() => {
          blackjack.resetTable(tableId);
          const resetTable = blackjack.getTable(tableId);
          if (resetTable) {
            const tablePlayers = resetTable.state.players.map(p => p.playerId);
            for (const tablePlayerId of tablePlayers) {
              const playerSockets = Array.from(io.sockets.sockets.values()).filter(s => {
                const m = socketToPlayer.get(s.id);
                return m && m.playerId === tablePlayerId;
              });
              for (const playerSocket of playerSockets) {
                playerSocket.emit('blackjack_state_update', { tableId, state: resetTable.state });
              }
            }
          }
        }, 5000);
      }
      
      // Broadcast state update
      const tablePlayers = updatedTable.state.players.map(p => p.playerId);
      for (const tablePlayerId of tablePlayers) {
        const playerSockets = Array.from(io.sockets.sockets.values()).filter(s => {
          const m = socketToPlayer.get(s.id);
          return m && m.playerId === tablePlayerId;
        });
        for (const playerSocket of playerSockets) {
          playerSocket.emit('blackjack_state_update', { tableId, state: updatedTable.state });
        }
      }
      // Also broadcast to all players in casino room so they can see dealer announcements
      const mappingForRoom = socketToPlayer.get(socket.id);
      if (mappingForRoom && mappingForRoom.roomId && mappingForRoom.roomId.startsWith('casino-')) {
        io.to(mappingForRoom.roomId).emit('blackjack_state_update', { tableId, state: updatedTable.state });
      }
    } else {
      console.log('[Blackjack] Double down failed:', result.message);
      socket.emit('blackjack_error', { tableId, message: result.message || 'Failed to double down' });
    }
  });
  
  // Split
  socket.on('blackjack_split', async ({ tableId, handIndex = 0 }) => {
    console.log('[Blackjack] ===== blackjack_split event received =====');
    console.log('[Blackjack] Table ID:', tableId);
    console.log('[Blackjack] Hand Index:', handIndex);
    console.log('[Blackjack] Socket ID:', socket.id);
    
    try {
      const mapping = socketToPlayer.get(socket.id);
      if (!mapping) {
        console.log('[Blackjack] No mapping found for socket', socket.id);
        socket.emit('blackjack_error', { tableId, message: 'Not connected to a room' });
        return;
      }
      
      const { playerId } = mapping;
      console.log('[Blackjack] Player ID:', playerId);
      
      const player = rooms.getPlayerInRoom(mapping.roomId, playerId);
      if (!player) {
        console.log('[Blackjack] Player not found in room', playerId, mapping.roomId);
        socket.emit('blackjack_error', { tableId, message: 'Player not found in room' });
        return;
      }
      
      const table = blackjack.getTable(tableId);
      if (!table) {
        console.log('[Blackjack] Table not found', tableId);
        socket.emit('blackjack_error', { tableId, message: 'Table not found' });
        return;
      }
      
      const blackjackPlayer = table.state.players.find(p => p.playerId === playerId);
      if (!blackjackPlayer) {
        console.log('[Blackjack] Player not at table', playerId);
        socket.emit('blackjack_error', { tableId, message: 'Player not at table' });
        return;
      }
      
      const hand = blackjackPlayer.hands[handIndex];
      if (!hand) {
        console.log('[Blackjack] Invalid hand index', handIndex);
        socket.emit('blackjack_error', { tableId, message: 'Invalid hand' });
        return;
      }
      
      // Get current orbs - prefer room state (in-memory) over Firebase to avoid stale data
      // Room state is updated immediately after blackjack actions, while Firebase may lag
      // Only fall back to Firebase if room state is missing
      let currentOrbs = player.orbs || 0;
      
      // If room state is 0 or missing, try Firebase as fallback (but don't require it)
      if (currentOrbs === 0) {
        const { getUserData } = await import('./firebase');
        const userData = await getUserData(playerId);
        if (userData?.orbs) {
          currentOrbs = userData.orbs;
          // Update room state with Firebase value if we got it
          player.orbs = currentOrbs;
          players.updatePlayerOrbs(playerId, currentOrbs);
        }
      }
      
      console.log(`[Blackjack] Split: player=${playerId}, currentOrbs=${currentOrbs} (from ${player.orbs > 0 ? 'room state' : 'Firebase/fallback'})`);
      
      const result = blackjack.split(tableId, playerId, handIndex, currentOrbs);
      console.log('[Blackjack] Split result:', result);
      
      if (result.success) {
        // Deduct additional bet for split
        const additionalBet = hand.bet;
        const newBalance = currentOrbs - additionalBet;
        console.log(`[Blackjack] Split: deducting ${additionalBet}, balance ${currentOrbs} -> ${newBalance} (client will update Firebase)`);
        player.orbs = newBalance;
        players.updatePlayerOrbs(playerId, newBalance);
        
        // Broadcast orb update with rewardType so client handles it correctly
        console.log(`[Blackjack] Emitting player_orbs_updated for split: playerId=${playerId}, orbs=${newBalance}, rewardAmount=${-additionalBet}, rewardType=blackjack`);
        io.to(mapping.roomId).emit('player_orbs_updated', { 
          playerId, 
          orbs: newBalance, 
          rewardAmount: -additionalBet, 
          rewardType: 'blackjack'
        });
        
        // Broadcast state update
        const updatedTable = blackjack.getTable(tableId);
        if (updatedTable) {
          const tablePlayers = updatedTable.state.players.map(p => p.playerId);
          for (const tablePlayerId of tablePlayers) {
            const playerSockets = Array.from(io.sockets.sockets.values()).filter(s => {
              const m = socketToPlayer.get(s.id);
              return m && m.playerId === tablePlayerId;
            });
            for (const playerSocket of playerSockets) {
              playerSocket.emit('blackjack_state_update', { tableId, state: updatedTable.state });
            }
          }
        }
    } else {
      console.log('[Blackjack] Split failed:', result.message);
      socket.emit('blackjack_error', { tableId, message: result.message || 'Failed to split' });
    }
    } catch (error: any) {
      console.error('[Blackjack] Error in split handler:', error);
      socket.emit('blackjack_error', { tableId, message: error.message || 'An error occurred while splitting' });
    }
  });

  // Handle gold coins sale
  socket.on('sell_gold_coins', async (data) => {
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) return;

    const { playerId, roomId } = mapping;
    const player = rooms.getPlayerInRoom(roomId, playerId);
    if (!player) return;

    // Client already handles Firebase update, server just validates and broadcasts
    // Get coin count and orbs received from client (they've already updated Firebase)
    let { coinCount, orbsReceived } = data || {};
    
    // If client didn't provide values, calculate them with boost
    if (!coinCount || coinCount === 0) {
      // Try to get from Firebase
      const { getUserData } = await import('./firebase');
      const userData = await getUserData(playerId);
      coinCount = userData?.gold_coins || 0;
      
      if (coinCount === 0) {
        socket.emit('error', { message: 'You have no gold coins to sell' });
        return;
      }
    }
    
    // If orbsReceived not provided or we need to recalculate, apply boost
    if (!orbsReceived) {
      const orbsPerCoin = 250;
      const baseOrbsReceived = coinCount * orbsPerCoin;
      
      // Calculate orb multiplier from equipped items
      let orbMultiplier = 1.0;
      if (player.sprite?.outfit) {
        const shopItems = shop.getShopItems();
        for (const itemId of player.sprite.outfit) {
          const item = shopItems.find(s => s.id === itemId);
          if (item?.orbMultiplier && isFinite(item.orbMultiplier)) {
            // Use highest boost (don't stack), cap at reasonable maximum
            orbMultiplier = Math.min(3.0, Math.max(orbMultiplier, item.orbMultiplier));
          }
        }
      }
      
      orbsReceived = Math.floor(baseOrbsReceived * orbMultiplier);
    }

    // Get current orbs from Firebase (source of truth) and add orbs received
    const { getUserData, updateUserOrbs } = await import('./firebase');
    const userData = await getUserData(playerId);
    const currentOrbs = userData?.orbs || player.orbs || 0;
    const newBalance = currentOrbs + orbsReceived;
    
    // Update Firebase to keep it in sync (same way as elsewhere in the app)
    await updateUserOrbs(playerId, newBalance);
    // Update room state
    player.orbs = newBalance;

    // Broadcast updates
    io.to(roomId).emit('gold_coins_sold', { playerId, coinCount, orbsReceived, newBalance });
    io.to(roomId).emit('player_orbs_updated', { playerId, orbs: newBalance });

    console.log(`Player ${player.name} sold ${coinCount} gold coins for ${orbsReceived} orbs, new balance: ${newBalance}`);
  });

  // ============ TRADING SYSTEM ============
  
  // Trade request
  socket.on('trade_request', ({ otherPlayerId }) => {
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) return;
    
    const { playerId, roomId } = mapping;
    const player = rooms.getPlayerInRoom(roomId, playerId);
    if (!player) return;
    
    const otherPlayer = rooms.getPlayerInRoom(roomId, otherPlayerId);
    if (!otherPlayer) {
      socket.emit('trade_error', { message: 'Player not found in room' });
      return;
    }
    
    // Check if players are in the same room
    if (otherPlayer.roomId !== roomId) {
      socket.emit('trade_error', { message: 'Player is not in the same room' });
      return;
    }
    
    // Check if trade already exists
    const existingTrade = trades.getTrade(playerId, otherPlayerId);
    if (existingTrade) {
      // Trade already exists, just notify the other player
      const otherPlayerSockets = Array.from(io.sockets.sockets.values()).filter(s => {
        const m = socketToPlayer.get(s.id);
        return m && m.playerId === otherPlayerId;
      });
      for (const otherSocket of otherPlayerSockets) {
        otherSocket.emit('trade_opened', { otherPlayerId: playerId, otherPlayerName: player.name });
      }
      socket.emit('trade_opened', { otherPlayerId, otherPlayerName: otherPlayer.name });
      return;
    }
    
    // Create new trade
    const trade = trades.createTrade(playerId, otherPlayerId);
    if (!trade) {
      socket.emit('trade_error', { message: 'Failed to create trade' });
      return;
    }
    
    // Notify the other player - send both events so they get the notification and open the trade
    const otherPlayerSockets = Array.from(io.sockets.sockets.values()).filter(s => {
      const m = socketToPlayer.get(s.id);
      return m && m.playerId === otherPlayerId;
    });
    for (const otherSocket of otherPlayerSockets) {
      otherSocket.emit('trade_requested', { fromPlayerId: playerId, fromPlayerName: player.name });
      otherSocket.emit('trade_opened', { otherPlayerId: playerId, otherPlayerName: player.name });
    }
    
    // Notify requesting player
    socket.emit('trade_opened', { otherPlayerId, otherPlayerName: otherPlayer.name });
  });
  
  // Modify trade offer
  socket.on('trade_modify', ({ items, orbs }) => {
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) return;
    
    const { playerId, roomId } = mapping;
    const trade = trades.getTradeForPlayer(playerId);
    if (!trade) {
      socket.emit('trade_error', { message: 'No active trade found' });
      return;
    }
    
    const otherPlayerId = trades.getOtherPlayerId(trade, playerId);
    const otherPlayer = rooms.getPlayerInRoom(roomId, otherPlayerId);
    if (!otherPlayer) {
      socket.emit('trade_error', { message: 'Other player not found' });
      return;
    }
    
    // Validate orbs (check player has enough) - use room state, not Firebase
    const player = rooms.getPlayerInRoom(roomId, playerId);
    if (!player) return;
    
    // Use player's current orbs from room state
    const currentOrbs = player.orbs || 0;
    
    if (orbs > currentOrbs) {
      socket.emit('trade_error', { message: 'You do not have enough orbs' });
      return;
    }
    
    // Note: Item validation is handled client-side and on trade completion
    // The client manages its own inventory and will validate before sending
    
    // Update trade offer
    const success = trades.updateTradeOffer(playerId, otherPlayerId, items, orbs);
    if (!success) {
      socket.emit('trade_error', { message: 'Failed to update trade offer' });
      return;
    }
    
    // Notify other player
    const otherPlayerSockets = Array.from(io.sockets.sockets.values()).filter(s => {
      const m = socketToPlayer.get(s.id);
      return m && m.playerId === otherPlayerId;
    });
    const updatedTrade = trades.getTrade(playerId, otherPlayerId);
    if (updatedTrade) {
      const otherOffer = trades.getOtherPlayerOffer(updatedTrade, otherPlayerId);
      const otherAccepted = trades.isPlayerAccepted(updatedTrade, otherPlayerId);
      // Ensure items is always an array
      const itemsArray = Array.isArray(otherOffer.items) ? otherOffer.items : [];
      for (const otherSocket of otherPlayerSockets) {
        otherSocket.emit('trade_modified', { 
          items: itemsArray, 
          orbs: otherOffer.orbs || 0,
          accepted: otherAccepted || false
        });
      }
    }
  });
  
  // Accept trade
  socket.on('trade_accept', () => {
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) return;
    
    const { playerId, roomId } = mapping;
    const trade = trades.getTradeForPlayer(playerId);
    if (!trade) {
      socket.emit('trade_error', { message: 'No active trade found' });
      return;
    }
    
    const otherPlayerId = trades.getOtherPlayerId(trade, playerId);
    const wasAccepted = trades.isPlayerAccepted(trade, playerId);
    
    // Toggle accept (RuneScape style - can un-accept)
    const success = trades.acceptTrade(playerId, otherPlayerId);
    if (!success) {
      socket.emit('trade_error', { message: 'Failed to accept trade' });
      return;
    }
    
    const updatedTrade = trades.getTrade(playerId, otherPlayerId);
    if (!updatedTrade) return;
    
    // Notify both players
    const allSockets = Array.from(io.sockets.sockets.values());
    for (const s of allSockets) {
      const m = socketToPlayer.get(s.id);
      if (m && (m.playerId === playerId || m.playerId === otherPlayerId)) {
        s.emit('trade_accepted', { playerId });
      }
    }
    
    // Check if both players accepted - complete trade
    if (trades.isTradeReady(playerId, otherPlayerId)) {
      // Complete the trade
      const completedTrade = trades.completeTrade(playerId, otherPlayerId);
      if (!completedTrade) return;
      
      // Get players from room state (not Firebase)
      const player1 = rooms.getPlayerInRoom(roomId, completedTrade.player1Id);
      const player2 = rooms.getPlayerInRoom(roomId, completedTrade.player2Id);
      
      if (!player1 || !player2) {
        for (const s of allSockets) {
          const m = socketToPlayer.get(s.id);
          if (m && (m.playerId === completedTrade.player1Id || m.playerId === completedTrade.player2Id)) {
            s.emit('trade_error', { message: 'Trade failed: One or both players not found in room' });
          }
        }
        return;
      }
      
      const player1Name = player1.name || completedTrade.player1Id;
      const player2Name = player2.name || completedTrade.player2Id;
      const player1Orbs = player1.orbs || 0;
      const player2Orbs = player2.orbs || 0;
      
      console.log('[server] Validating trade completion:', {
        player1Id: completedTrade.player1Id,
        player1Name,
        player1Orbs,
        player1OfferOrbs: completedTrade.player1Offer.orbs,
        player2Id: completedTrade.player2Id,
        player2Name,
        player2Orbs,
        player2OfferOrbs: completedTrade.player2Offer.orbs
      });
      
      // Validate both players still have enough orbs (using room state)
      // Check player1
      if (player1Orbs < completedTrade.player1Offer.orbs) {
        console.error('[server] Trade validation failed: player1 does not have enough orbs', {
          player1Id: completedTrade.player1Id,
          player1Name,
          has: player1Orbs,
          needs: completedTrade.player1Offer.orbs
        });
        for (const s of allSockets) {
          const m = socketToPlayer.get(s.id);
          if (m && (m.playerId === completedTrade.player1Id || m.playerId === completedTrade.player2Id)) {
            s.emit('trade_error', { message: `Trade failed: ${player1Name} does not have enough orbs (has ${player1Orbs.toLocaleString()}, needs ${completedTrade.player1Offer.orbs.toLocaleString()})` });
          }
        }
        return;
      }
      
      // Check player2
      if (player2Orbs < completedTrade.player2Offer.orbs) {
        console.error('[server] Trade validation failed: player2 does not have enough orbs', {
          player2Id: completedTrade.player2Id,
          player2Name,
          has: player2Orbs,
          needs: completedTrade.player2Offer.orbs
        });
        for (const s of allSockets) {
          const m = socketToPlayer.get(s.id);
          if (m && (m.playerId === completedTrade.player1Id || m.playerId === completedTrade.player2Id)) {
            s.emit('trade_error', { message: `Trade failed: ${player2Name} does not have enough orbs (has ${player2Orbs.toLocaleString()}, needs ${completedTrade.player2Offer.orbs.toLocaleString()})` });
          }
        }
        return;
      }
      
      // Note: Item validation is handled client-side
      // The client manages its own inventory and validates before accepting
      
      // Calculate new orb balances (server is source of truth)
      const newPlayer1Orbs = player1Orbs - completedTrade.player1Offer.orbs + completedTrade.player2Offer.orbs;
      const newPlayer2Orbs = player2Orbs - completedTrade.player2Offer.orbs + completedTrade.player1Offer.orbs;
      
      console.log(`[Trade] Completed trade between ${player1Name} and ${player2Name}`);
      console.log(`[Trade] Items exchanged:`, {
        [`${player1Name} gave`]: {
          items: completedTrade.player1Offer.items.map(item => `${item.quantity}x ${item.itemId}`),
          orbs: completedTrade.player1Offer.orbs
        },
        [`${player1Name} received`]: {
          items: completedTrade.player2Offer.items.map(item => `${item.quantity}x ${item.itemId}`),
          orbs: completedTrade.player2Offer.orbs
        },
        [`${player2Name} gave`]: {
          items: completedTrade.player2Offer.items.map(item => `${item.quantity}x ${item.itemId}`),
          orbs: completedTrade.player2Offer.orbs
        },
        [`${player2Name} received`]: {
          items: completedTrade.player1Offer.items.map(item => `${item.quantity}x ${item.itemId}`),
          orbs: completedTrade.player1Offer.orbs
        }
      });
      console.log(`[Trade] Balance changes:`, {
        player1Name,
        player1OldOrbs: player1Orbs,
        player1NewOrbs: newPlayer1Orbs,
        player1Change: newPlayer1Orbs - player1Orbs,
        player2Name,
        player2OldOrbs: player2Orbs,
        player2NewOrbs: newPlayer2Orbs,
        player2Change: newPlayer2Orbs - player2Orbs
      });
      
      // Update room state
      player1.orbs = newPlayer1Orbs;
      player2.orbs = newPlayer2Orbs;
      players.updatePlayerOrbs(completedTrade.player1Id, newPlayer1Orbs);
      players.updatePlayerOrbs(completedTrade.player2Id, newPlayer2Orbs);
      
      // Broadcast orb updates to entire room - server is source of truth
      // Clients will update Firebase and display these values
      io.to(roomId).emit('player_orbs_updated', { 
        playerId: completedTrade.player1Id, 
        orbs: newPlayer1Orbs,
        rewardType: 'trade'
      });
      io.to(roomId).emit('player_orbs_updated', { 
        playerId: completedTrade.player2Id, 
        orbs: newPlayer2Orbs,
        rewardType: 'trade'
      });
      
      // Notify trading players about trade completion - includes items to update inventory
      for (const s of allSockets) {
        const m = socketToPlayer.get(s.id);
        if (m && m.playerId === completedTrade.player1Id) {
          s.emit('trade_completed', { 
            items: completedTrade.player2Offer.items, 
            orbs: completedTrade.player2Offer.orbs,
            newBalance: newPlayer1Orbs // Server's calculated balance
          });
        } else if (m && m.playerId === completedTrade.player2Id) {
          s.emit('trade_completed', { 
            items: completedTrade.player1Offer.items, 
            orbs: completedTrade.player1Offer.orbs,
            newBalance: newPlayer2Orbs // Server's calculated balance
          });
        }
      }
    }
  });
  
  // Decline trade
  socket.on('trade_decline', () => {
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) return;
    
    const { playerId } = mapping;
    const trade = trades.getTradeForPlayer(playerId);
    if (!trade) return;
    
    const otherPlayerId = trades.getOtherPlayerId(trade, playerId);
    trades.cancelTrade(playerId, otherPlayerId);
    
    // Notify both players
    const allSockets = Array.from(io.sockets.sockets.values());
    for (const s of allSockets) {
      const m = socketToPlayer.get(s.id);
      if (m && (m.playerId === playerId || m.playerId === otherPlayerId)) {
        s.emit('trade_declined');
      }
    }
  });
  
  // Cancel trade
  socket.on('trade_cancel', () => {
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) return;
    
    const { playerId } = mapping;
    const trade = trades.getTradeForPlayer(playerId);
    if (!trade) return;
    
    const otherPlayerId = trades.getOtherPlayerId(trade, playerId);
    trades.cancelTrade(playerId, otherPlayerId);
    
    // Notify both players
    const allSockets = Array.from(io.sockets.sockets.values());
    for (const s of allSockets) {
      const m = socketToPlayer.get(s.id);
      if (m && (m.playerId === playerId || m.playerId === otherPlayerId)) {
        s.emit('trade_cancelled');
      }
    }
  });
  
  // Handle disconnection
  // Slot machine names
  const SLOT_MACHINE_NAMES: Record<string, string> = {
    'slot_machine_north': 'Orb Fortune',
    'slot_machine_east': 'Orb Destiny',
    'slot_machine_south': 'Orb Glory',
    'slot_machine_west': 'Orb Victory'
  };
  
  // Initialize slot machines on server start
  if (!slotMachinesInitialized) {
    slots.initializeSlotMachines();
    slotMachinesInitialized = true;
  }
  
  // Join slot machine
  socket.on('join_slot_machine', ({ slotMachineId }) => {
    console.log('[Slots] ===== join_slot_machine event received =====');
    console.log('[Slots] Slot Machine ID:', slotMachineId);
    console.log('[Slots] Socket ID:', socket.id);
    console.log('[Slots] Socket rooms:', Array.from(socket.rooms));
    console.log('[Slots] All socket mappings:', Array.from(socketToPlayer.entries()).map(([sid, m]) => ({ socketId: sid, playerId: m.playerId, roomId: m.roomId })));
    
    let mapping = socketToPlayer.get(socket.id);
    
    // If no mapping found, try to find player by auth playerId (socket might have reconnected)
    if (!mapping) {
      const authPlayerId = socket.handshake.auth?.playerId as string | undefined;
      if (authPlayerId) {
        // Find any existing mapping for this player
        const existingMapping = Array.from(socketToPlayer.entries()).find(
          ([_, m]) => m.playerId === authPlayerId
        );
        
        if (existingMapping) {
          // Found existing mapping - use it and update to new socket
          const [oldSocketId, oldMapping] = existingMapping;
          mapping = oldMapping;
          // Update mapping to use new socket ID
          socketToPlayer.delete(oldSocketId);
          socketToPlayer.set(socket.id, mapping);
          // Ensure socket is in the room
          socket.join(mapping.roomId);
          console.log(`[Slots] Recovered mapping for reconnected socket: ${socket.id} -> player ${mapping.playerId} in room ${mapping.roomId}`);
        }
      }
    }
    
    if (!mapping) {
      console.error('[Slots] No mapping found for socket', socket.id);
      console.error('[Slots] Available socket IDs:', Array.from(socketToPlayer.keys()));
      console.error('[Slots] This might indicate the socket was recreated or room join failed');
      socket.emit('slot_machine_error', { slotMachineId, message: 'Not connected to a room. Please try rejoining the room.' });
      return;
    }
    
    const { playerId, roomId } = mapping;
    console.log('[Slots] Player ID:', playerId, 'Room ID:', roomId);
    
    const player = rooms.getPlayerInRoom(roomId, playerId);
    if (!player) {
      console.error('[Slots] Player not found in room');
      socket.emit('slot_machine_error', { slotMachineId, message: 'Player not found' });
      return;
    }
    
    const result = slots.joinSlotMachine(slotMachineId, playerId, player.name);
    console.log('[Slots] Join result:', result);
    
    if (result.success && result.seat !== undefined) {
      // Calculate seat position for the player in world coordinates
      const SCALE = GAME_CONSTANTS.SCALE;
      const WORLD_WIDTH_SCALED = GAME_CONSTANTS.TILE_SIZE * GAME_CONSTANTS.MAP_WIDTH * SCALE;
      const WORLD_HEIGHT_SCALED = GAME_CONSTANTS.TILE_SIZE * GAME_CONSTANTS.MAP_HEIGHT * SCALE;
      const centerXScaled = WORLD_WIDTH_SCALED / 2;
      const centerYScaled = WORLD_HEIGHT_SCALED / 2;
      const plazaRadiusScaled = 600 * SCALE; // Doubled from 300 to 600 for more space
      const slotMachineDistance = plazaRadiusScaled * 0.85;
      
      // Slot machine positions (N/S/E/W)
      const directions = [
        { angle: 0, id: 'slot_machine_north' },
        { angle: Math.PI / 2, id: 'slot_machine_east' },
        { angle: Math.PI, id: 'slot_machine_south' },
        { angle: 3 * Math.PI / 2, id: 'slot_machine_west' }
      ];
      
      const dir = directions.find(d => d.id === slotMachineId);
      if (!dir) {
        console.error('[Slots] Invalid slot machine ID:', slotMachineId);
        socket.emit('slot_machine_error', { slotMachineId, message: 'Invalid slot machine' });
        return;
      }
      
      const slotXScaled = centerXScaled + Math.cos(dir.angle) * slotMachineDistance;
      const slotYScaled = centerYScaled + Math.sin(dir.angle) * slotMachineDistance;
      
      // 8 seats around slot machine (evenly spaced in a circle)
      const seatRadiusScaled = 38 * SCALE; // Distance from machine center (immediately around machine)
      const seatAngle = (result.seat / 8) * Math.PI * 2; // Evenly spaced around circle
      const seatXScaled = slotXScaled + Math.cos(seatAngle) * seatRadiusScaled;
      const seatYScaled = slotYScaled + Math.sin(seatAngle) * seatRadiusScaled;
      
      // Convert from scaled pixels to unscaled pixels (server coordinates)
      const seatX = seatXScaled / SCALE;
      const seatY = seatYScaled / SCALE;
      
      // Update player position to seat (center player sprite on seat)
      const seatWorldX = seatX - GAME_CONSTANTS.PLAYER_WIDTH / 2;
      const seatWorldY = seatY - GAME_CONSTANTS.PLAYER_HEIGHT / 2;
      
      // Determine direction based on seat angle (face towards machine)
      let seatDirection: Direction = 'down';
      const normalizedAngle = ((seatAngle + Math.PI) % (Math.PI * 2) + (Math.PI * 2)) % (Math.PI * 2);
      if (normalizedAngle >= 0 && normalizedAngle < Math.PI / 4) {
        seatDirection = 'right';
      } else if (normalizedAngle >= Math.PI / 4 && normalizedAngle < 3 * Math.PI / 4) {
        seatDirection = 'down';
      } else if (normalizedAngle >= 3 * Math.PI / 4 && normalizedAngle < 5 * Math.PI / 4) {
        seatDirection = 'left';
      } else if (normalizedAngle >= 5 * Math.PI / 4 && normalizedAngle < 7 * Math.PI / 4) {
        seatDirection = 'up';
      } else {
        seatDirection = 'right';
      }
      
      // Update player position
      const positionUpdated = rooms.updatePlayerPosition(roomId, playerId, seatWorldX, seatWorldY, seatDirection);
      
      if (positionUpdated) {
        console.log(`[Slots] Positioned and broadcasted player ${playerId} at seat ${result.seat} (${seatWorldX}, ${seatWorldY})`);
        // Broadcast position update
        io.to(roomId).emit('player_moved', {
          playerId,
          x: seatWorldX,
          y: seatWorldY,
          direction: seatDirection
        });
      } else {
        console.log(`[Slots] Position update returned false, but still broadcasting position for player ${playerId} at seat ${result.seat} (${seatWorldX}, ${seatWorldY})`);
        // Still broadcast position even if updatePlayerPosition returned false
        io.to(roomId).emit('player_moved', {
          playerId,
          x: seatWorldX,
          y: seatWorldY,
          direction: seatDirection
        });
      }
      
      // Notify player of successful join
      socket.emit('slot_machine_joined', { slotMachineId, seat: result.seat });
    } else {
      socket.emit('slot_machine_error', { slotMachineId, message: result.message || 'Failed to join slot machine' });
    }
  });
  
  // Leave slot machine
  socket.on('leave_slot_machine', ({ slotMachineId }) => {
    console.log('[Slots] ===== leave_slot_machine event received =====');
    console.log('[Slots] Slot Machine ID:', slotMachineId);
    
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) return;
    
    const { playerId } = mapping;
    const result = slots.leaveSlotMachine(slotMachineId, playerId);
    
    if (result.success) {
      socket.emit('slot_machine_left', { slotMachineId });
    }
  });
  
  // Slot machine handler
  socket.on('spin_slot_machine', async ({ slotMachineId, betAmount, forceBonus }) => {
    console.log('[Slots] ===== spin_slot_machine event received =====');
    console.log('[Slots] Slot Machine ID:', slotMachineId);
    console.log('[Slots] Bet Amount:', betAmount);
    console.log('[Slots] Socket ID:', socket.id);
    
    let mapping = socketToPlayer.get(socket.id);
    
    // If no mapping found, try to find player by auth playerId (socket might have reconnected)
    if (!mapping) {
      const authPlayerId = socket.handshake.auth?.playerId as string | undefined;
      if (authPlayerId) {
        // Find any existing mapping for this player
        const existingMapping = Array.from(socketToPlayer.entries()).find(
          ([_, m]) => m.playerId === authPlayerId
        );
        
        if (existingMapping) {
          // Found existing mapping - use it and update to new socket
          const [oldSocketId, oldMapping] = existingMapping;
          mapping = oldMapping;
          // Update mapping to use new socket ID
          socketToPlayer.delete(oldSocketId);
          socketToPlayer.set(socket.id, mapping);
          // Ensure socket is in the room
          socket.join(mapping.roomId);
          console.log(`[Slots] Recovered mapping for reconnected socket: ${socket.id} -> player ${mapping.playerId} in room ${mapping.roomId}`);
        }
      }
    }
    
    if (!mapping) {
      console.error('[Slots] No mapping found for socket', socket.id);
      socket.emit('slot_machine_error', { slotMachineId, message: 'Not connected to a room' });
      return;
    }
    
    const { playerId, roomId } = mapping;
    console.log('[Slots] Player ID:', playerId, 'Room ID:', roomId);
    
    const player = rooms.getPlayerInRoom(roomId, playerId);
    
    if (!player) {
      console.error('[Slots] Player not found in room');
      socket.emit('slot_machine_error', { slotMachineId, message: 'Player not found' });
      return;
    }
    
    // Validate bet amount
    const numericBet = Number(betAmount);
    console.log('[Slots] Validating bet amount:', { betAmount, numericBet, type: typeof betAmount });
    if (isNaN(numericBet) || numericBet < 5000 || numericBet > 10000) {
      console.error('[Slots] Invalid bet amount:', { betAmount, numericBet, isNaN: isNaN(numericBet), lessThanMin: numericBet < 5000, greaterThanMax: numericBet > 10000 });
      socket.emit('slot_machine_error', { slotMachineId, message: `Invalid bet amount: ${numericBet}. Must be between 5,000 and 10,000 orbs.` });
      return;
    }
    
    // Check if player has enough orbs
    const currentOrbs = player.orbs || 0;
    console.log('[Slots] Current balance:', currentOrbs, 'Bet amount:', numericBet);
    
    if (currentOrbs < numericBet) {
      console.error('[Slots] Insufficient orbs. Current:', currentOrbs, 'Required:', numericBet);
      socket.emit('slot_machine_error', { slotMachineId, message: 'Insufficient orbs' });
      return;
    }
    
    try {
      // Import slot machine logic
      const slotModule = await import('./slots');
      const { 
        spinSlots, 
        spinSlotsWithBonus, 
        calculatePayout, 
        checkBonusTrigger,
        getBonusGameState,
        setBonusGameState,
        clearBonusGameState
      } = slotModule;
      // Use SlotSymbol type - define it directly to match slots.ts
      type SlotSymbol = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'godlike' | 'orb' | 'bonus';
      
      // Check if player is in bonus game
      let bonusState = getBonusGameState(playerId, slotMachineId);
      const isInBonusGame = bonusState?.isInBonus ?? false;
      
      // Spin the reels FIRST to check if bonus will trigger (before deducting bet)
      let symbols: SlotSymbol[][];
      let bonusTriggered = false;
      
      if (forceBonus && !isInBonusGame) {
        // Dev toggle: force 3 bonus symbols on middle reel (only if not already in bonus game)
        // Generate 3 rows, with all 3 rows of middle reel being bonus
        const topRow: SlotSymbol[] = ['common', 'common', 'bonus', 'common', 'common'];
        const middleRow: SlotSymbol[] = ['common', 'common', 'bonus', 'common', 'common'];
        const bottomRow: SlotSymbol[] = ['common', 'common', 'bonus', 'common', 'common'];
        symbols = [topRow, middleRow, bottomRow] as SlotSymbol[][];
        bonusTriggered = true;
        console.log('[Slots] Dev toggle: Forced bonus trigger');
      } else if (forceBonus && isInBonusGame) {
        // If forceBonus is true but already in bonus game, just use bonus weights (don't retrigger)
        symbols = spinSlotsWithBonus() as SlotSymbol[][];
        bonusTriggered = false; // Don't retrigger bonus if already in bonus game
        console.log('[Slots] Dev toggle: Already in bonus game, using bonus weights without retrigger');
      } else if (isInBonusGame) {
        // Use bonus game weights (increased probability)
        symbols = spinSlotsWithBonus() as SlotSymbol[][];
        console.log('[Slots] Bonus game spin - Generated symbols (3 rows)');
      } else {
        // Regular spin
        symbols = spinSlots() as SlotSymbol[][];
        console.log('[Slots] Generated symbols (3 rows)');
        
        // Check for bonus trigger (3 bonus symbols on middle reel)
        bonusTriggered = checkBonusTrigger(symbols);
        if (bonusTriggered) {
          console.log('[Slots] Bonus trigger activated!');
        }
      }
      
      // Determine if this spin should be free (bonus game or bonus trigger)
      const isFreeSpin = isInBonusGame || bonusTriggered;
      
      // If in bonus game or bonus triggered, don't deduct bet (free spin)
      let balanceAfterBet = currentOrbs;
      if (!isFreeSpin) {
        // Deduct bet from player's balance
        balanceAfterBet = currentOrbs - numericBet;
        console.log('[Slots] Deducting bet. Balance:', currentOrbs, '->', balanceAfterBet);
        
        if (balanceAfterBet < 0) {
          socket.emit('slot_machine_error', {
            slotMachineId,
            message: 'Insufficient balance'
          });
          return;
        }
        
        // Update player balance immediately
        player.orbs = balanceAfterBet;
        players.updatePlayerOrbs(playerId, balanceAfterBet);
        
        // Broadcast bet deduction immediately
        io.to(roomId).emit('player_orbs_updated', {
          playerId,
          orbs: balanceAfterBet,
          rewardAmount: -numericBet,
          rewardType: 'slots'
        });
        console.log('[Slots] Broadcasted bet deduction. New balance:', balanceAfterBet);
      } else {
        console.log('[Slots] Free spin - no bet deducted (bonus game or bonus trigger)');
      }
      
      // Handle bonus game state
      if (bonusTriggered && !isInBonusGame) {
        // Start bonus game with 10 free spins
        bonusState = {
          freeSpinsRemaining: 10,
          isInBonus: true
        };
        setBonusGameState(playerId, slotMachineId, bonusState);
        console.log('[Slots] Started bonus game with 10 free spins');
      } else if (bonusTriggered && isInBonusGame) {
        // Retrigger: add 10 more free spins
        bonusState!.freeSpinsRemaining += 10;
        setBonusGameState(playerId, slotMachineId, bonusState!);
        console.log('[Slots] Bonus retriggered! Added 10 more free spins. Total:', bonusState!.freeSpinsRemaining);
      } else if (isInBonusGame) {
        // Decrement free spins AFTER processing the spin
        // This ensures the final spin (when freeSpinsRemaining is 1) is still processed as a bonus game spin
        bonusState!.freeSpinsRemaining--;
        if (bonusState!.freeSpinsRemaining <= 0) {
          // Bonus game ended - but keep isInBonus true for this result so client knows it was a bonus spin
          // We'll clear it after sending the result
          bonusState = { freeSpinsRemaining: 0, isInBonus: true }; // Keep isInBonus true for final spin
          console.log('[Slots] Bonus game ended (final spin completed, but keeping isInBonus true for result)');
        } else {
          setBonusGameState(playerId, slotMachineId, bonusState!);
          console.log('[Slots] Free spins remaining:', bonusState!.freeSpinsRemaining);
        }
      }
      
      // Re-fetch bonus state after updates to ensure we have the latest state
      // This ensures bonusState is correct even if there were any issues with the local variable
      const currentBonusState = getBonusGameState(playerId, slotMachineId);
      const finalBonusState = currentBonusState || bonusState;
      
      // Calculate payout (use original bet amount for multiplier, even in bonus game)
      const payout = calculatePayout(symbols, numericBet);
      const netPayout = isFreeSpin ? payout : (payout - numericBet); // In bonus game or trigger, payout is pure win
      const finalBalance = balanceAfterBet + payout;
      
      // Debug logging for payout issues
      const symbolsFlat = symbols.flat(); // Flatten for logging
      console.log('[Slots] Payout calculation:', {
        symbols: symbolsFlat.join(', '),
        payout,
        betAmount: numericBet,
        netPayout,
        isFreeSpin,
        finalBalance
      });
      
      // Update player balance with final result
      player.orbs = finalBalance;
      players.updatePlayerOrbs(playerId, finalBalance);
      console.log('[Slots] Updated player balance to:', finalBalance);
      
      // Check if player balance dropped below 5M in casino - kick them to plaza
      if (roomId.startsWith('casino-') && finalBalance < 5000000) {
        // Extract server region from casino room ID (e.g., "casino-eu-1" -> "eu-1")
        const serverRegion = roomId.replace('casino-', '');
        const plazaRoomId = `plaza-${serverRegion}`;
        
        console.log(`[Casino] Player ${playerId} balance dropped below 5M (${finalBalance}), kicking to plaza: ${plazaRoomId}`);
        
        // Find all sockets for this player in the casino room
        const playerSockets = Array.from(socketToPlayer.entries())
          .filter(([_, playerMapping]) => playerMapping.playerId === playerId && playerMapping.roomId === roomId)
          .map(([socketId]) => io.sockets.sockets.get(socketId))
          .filter(Boolean) as Socket[];
        
        // Remove player from casino room
        rooms.removePlayerFromRoom(roomId, playerId);
        
        // Broadcast player_left to all clients in the room
        io.to(roomId).emit('player_left', { playerId });
        
        // Remove socket mappings and emit kick event BEFORE disconnecting
        playerSockets.forEach(playerSocket => {
          // Emit event first so client can receive it
          playerSocket.emit('force_room_change', { 
            roomId: plazaRoomId,
            reason: 'Your balance dropped below 5M. You have been moved to the plaza.'
          });
          // Disconnect after a short delay to ensure event is received
          setTimeout(() => {
            socketToPlayer.delete(playerSocket.id);
            playerSocket.disconnect();
          }, 100);
        });
        
        return; // Don't send slot result since player is being kicked
      }
      
      // Get slot machine name
      const slotMachineName = SLOT_MACHINE_NAMES[slotMachineId] || 'Slot Machine';
      
      // Broadcast chat message and speech bubble ONLY for wins
      if (payout > 0) {
        const playerName = player.name;
        const chatMessage = `${playerName} spun ${slotMachineName} and won ${payout.toLocaleString()} orbs!`;
        const textColor = '#22c55e'; // Green for wins
        
        // Update player chat bubble and broadcast to room
        const createdAt = rooms.updatePlayerChat(roomId, playerId, chatMessage, textColor);
        io.to(roomId).emit('chat_message', { playerId, text: chatMessage, createdAt, textColor });
        console.log(`[Slots] Chat message sent: ${chatMessage}`);
      } else {
        console.log(`[Slots] Loss - no chat message broadcast`);
      }
      
      // Emit result to player
      // Always include bonusGameState when bonus triggers or when in bonus game
      // Include it even if freeSpinsRemaining is 0 (so client knows it was the final bonus spin)
      const bonusGameStatePayload = (bonusTriggered || finalBonusState) ? {
        isBonusGame: finalBonusState?.isInBonus ?? (bonusTriggered ? true : false),
        freeSpinsRemaining: finalBonusState?.freeSpinsRemaining ?? (bonusTriggered ? 10 : 0),
        bonusTriggered: bonusTriggered
      } : undefined;
      
      // Clear bonus state AFTER sending result if it's ended
      // This ensures the final spin is still processed as a bonus game spin
      if (finalBonusState && finalBonusState.freeSpinsRemaining <= 0 && !bonusTriggered) {
        // Update state to mark bonus game as ended, then clear it
        setBonusGameState(playerId, slotMachineId, { freeSpinsRemaining: 0, isInBonus: false });
        clearBonusGameState(playerId, slotMachineId);
        console.log('[Slots] Cleared bonus game state after sending final result');
      }
      
      // Send all 3 rows to client (3 rows × 5 columns)
      socket.emit('slot_machine_result', {
        slotMachineId,
        slotMachineName,
        symbols: symbols, // Send all 3 rows (top, middle, bottom)
        payout: netPayout, // Net payout (win - bet, or -bet if loss, or pure win in bonus)
        newBalance: finalBalance,
        bonusGameState: bonusGameStatePayload
      });
      console.log('[Slots] Emitted slot_machine_result to player. Final balance:', finalBalance, 'Bonus game state:', bonusGameStatePayload);
      
      // Broadcast final balance update (with net payout)
      io.to(roomId).emit('player_orbs_updated', {
        playerId,
        orbs: finalBalance,
        rewardAmount: netPayout,
        rewardType: 'slots'
      });
      console.log('[Slots] Broadcasted final balance update. Balance:', finalBalance, 'Net payout:', netPayout);
      
      // Check if player balance dropped below 5M in casino AFTER result - kick them to plaza
      if (roomId.startsWith('casino-') && finalBalance < 5000000) {
        // Extract server region from casino room ID (e.g., "casino-eu-1" -> "eu-1")
        const serverRegion = roomId.replace('casino-', '');
        const plazaRoomId = `plaza-${serverRegion}`;
        
        console.log(`[Casino] Player ${playerId} balance dropped below 5M (${finalBalance}), kicking to plaza: ${plazaRoomId}`);
        
        // Find all sockets for this player in the casino room
        const playerSockets = Array.from(socketToPlayer.entries())
          .filter(([_, playerMapping]) => playerMapping.playerId === playerId && playerMapping.roomId === roomId)
          .map(([socketId]) => io.sockets.sockets.get(socketId))
          .filter(Boolean) as Socket[];
        
        // Remove player from casino room
        rooms.removePlayerFromRoom(roomId, playerId);
        
        // Broadcast player_left to all clients in the room
        io.to(roomId).emit('player_left', { playerId });
        
        // Remove socket mappings and emit kick event BEFORE disconnecting
        playerSockets.forEach(playerSocket => {
          // Emit event first so client can receive it
          playerSocket.emit('force_room_change', { 
            roomId: plazaRoomId,
            reason: 'Your balance dropped below 5M. You have been moved to the plaza.'
          });
          // Disconnect after a short delay to ensure event is received
          setTimeout(() => {
            socketToPlayer.delete(playerSocket.id);
            playerSocket.disconnect();
          }, 100);
        });
      }
      
    } catch (error) {
      console.error('[Slots] Error processing spin:', error);
      socket.emit('slot_machine_error', { slotMachineId, message: 'Server error processing spin' });
    }
  });
  
  // Handle kicking a player from the game
  socket.on('kick_player', ({ targetPlayerId }) => {
    // Only allow specific UID to kick players
    const kickerUid = socket.handshake.auth?.playerId as string | undefined;
    const ALLOWED_KICK_UID = 'mCY7QgXzKwRJA8YRzP90qJppE1y2';
    
    if (kickerUid !== ALLOWED_KICK_UID) {
      socket.emit('error', { message: 'You do not have permission to kick players' });
      return;
    }
    
    const kickerMapping = socketToPlayer.get(socket.id);
    if (!kickerMapping) {
      socket.emit('error', { message: 'You must be in a room to kick players' });
      return;
    }
    
    const { playerId: kickerId, roomId } = kickerMapping;
    
    // Check if target player is in the same room
    const targetPlayer = rooms.getPlayerInRoom(roomId, targetPlayerId);
    if (!targetPlayer) {
      socket.emit('error', { message: 'Player not found in this room' });
      return;
    }
    
    // Prevent self-kick
    if (targetPlayerId === kickerId) {
      socket.emit('error', { message: 'You cannot kick yourself' });
      return;
    }
    
    console.log(`[Kick] Player ${kickerId} is kicking player ${targetPlayerId} from room ${roomId}`);
    
    // Find all sockets for the target player in this room
    const targetSockets = Array.from(io.sockets.sockets.values()).filter(s => {
      const mapping = socketToPlayer.get(s.id);
      return mapping && mapping.playerId === targetPlayerId && mapping.roomId === roomId;
    });
    
    if (targetSockets.length === 0) {
      socket.emit('error', { message: 'Target player has no active connections' });
      return;
    }
    
    // Notify the kicked player before disconnecting
    for (const targetSocket of targetSockets) {
      targetSocket.emit('player_kicked', { 
        message: `You have been kicked from the room by ${rooms.getPlayerInRoom(roomId, kickerId)?.name || 'another player'}` 
      });
    }
    
    // Disconnect all sockets for the target player
    for (const targetSocket of targetSockets) {
      // Leave Socket.IO room
      targetSocket.leave(roomId);
      
      // Clean up mapping
      socketToPlayer.delete(targetSocket.id);
      
      // Disconnect the socket
      targetSocket.disconnect(true);
    }
    
    // Remove player from room
    rooms.removePlayerFromRoom(roomId, targetPlayerId);
    
    // Clean up idle tracking
    playerLastMovement.delete(targetPlayerId);
    playerLastIdleReward.delete(targetPlayerId);
    
    // Clean up purchase lock
    playerPurchasingLootBox.delete(targetPlayerId);
    
    // Leave any blackjack tables
    const allTables = blackjack.getAllTables();
    for (const table of allTables) {
      const playerAtTable = table.state.players.find(p => p.playerId === targetPlayerId);
      if (playerAtTable) {
        blackjack.leaveTable(table.id, targetPlayerId);
        // Broadcast update to remaining players
        const tablePlayers = table.state.players.map(p => p.playerId);
        for (const tablePlayerId of tablePlayers) {
          const playerSockets = Array.from(io.sockets.sockets.values()).filter(s => {
            const m = socketToPlayer.get(s.id);
            return m && m.playerId === tablePlayerId;
          });
          for (const playerSocket of playerSockets) {
            playerSocket.emit('blackjack_state_update', { tableId: table.id, state: table.state });
          }
        }
      }
    }
    
    // Leave any slot machines
    const slotMachineIds = ['slot_machine_north', 'slot_machine_east', 'slot_machine_south', 'slot_machine_west'];
    for (const slotMachineId of slotMachineIds) {
      const machine = slots.getSlotMachine(slotMachineId);
      if (machine) {
        const playerAtMachine = machine.players.find(p => p.playerId === targetPlayerId);
        if (playerAtMachine) {
          slots.leaveSlotMachine(slotMachineId, targetPlayerId);
        }
      }
    }
    
    // Check if room is empty and stop spawner
    const playersLeft = rooms.getPlayersInRoom(roomId);
    if (playersLeft.length === 0) {
      stopOrbSpawner(roomId);
      stopFountainOrbSpawner(roomId);
    }
    
    // Notify others in the room
    const kickerName = rooms.getPlayerInRoom(roomId, kickerId)?.name || 'Someone';
    io.to(roomId).emit('player_left', { playerId: targetPlayerId });
    
    // Send chat message about the kick
    const createdAt = Date.now();
    io.to(roomId).emit('chat_message', {
      playerId: targetPlayerId,
      text: `${targetPlayer.name} was kicked by ${kickerName}`,
      createdAt,
      textColor: '#ff6b6b'
    });
    
    console.log(`[Kick] Player ${targetPlayerId} has been kicked from room ${roomId} by ${kickerId}`);
  });
  
  socket.on('disconnect', () => {
    const mapping = socketToPlayer.get(socket.id);
    if (mapping) {
      const { playerId, roomId } = mapping;
      
      // IMPORTANT: Leave Socket.IO room first to prevent disconnected sockets from being counted
      socket.leave(roomId);
      
      // Clean up mapping
      socketToPlayer.delete(socket.id);
      
      // Check if there are any other sockets for this player
      const hasOtherSockets = Array.from(socketToPlayer.values()).some(
        m => m.playerId === playerId && m.roomId === roomId
      );
      
      // Only remove player from room if no other sockets exist for this player
      if (!hasOtherSockets) {
        rooms.removePlayerFromRoom(roomId, playerId);
        // Clean up idle tracking when player leaves
        playerLastMovement.delete(playerId);
        playerLastIdleReward.delete(playerId);
        
        // Clean up purchase lock
        playerPurchasingLootBox.delete(playerId);
        
        // Leave any blackjack tables
        const allTables = blackjack.getAllTables();
        for (const table of allTables) {
          const playerAtTable = table.state.players.find(p => p.playerId === playerId);
          if (playerAtTable) {
            blackjack.leaveTable(table.id, playerId);
            // Broadcast update to remaining players
            const tablePlayers = table.state.players.map(p => p.playerId);
            for (const tablePlayerId of tablePlayers) {
              const playerSockets = Array.from(io.sockets.sockets.values()).filter(s => {
                const m = socketToPlayer.get(s.id);
                return m && m.playerId === tablePlayerId;
              });
              for (const playerSocket of playerSockets) {
                playerSocket.emit('blackjack_state_update', { tableId: table.id, state: table.state });
              }
            }
          }
        }
        
        // Check if room is empty and stop spawner
        const playersLeft = rooms.getPlayersInRoom(roomId);
        if (playersLeft.length === 0) {
          stopOrbSpawner(roomId);
          stopFountainOrbSpawner(roomId);
        }
        
        // Notify others
        io.to(roomId).emit('player_left', { playerId });
        
        console.log(`Player ${playerId} left room ${roomId} (no more sockets)`);
      } else {
        console.log(`Socket ${socket.id} disconnected for player ${playerId}, but player still has other sockets`);
      }
    } else {
      // Socket wasn't in mapping, but might still be in a room - clean it up
      // Get all rooms this socket might be in and leave them
      const socketRooms = Array.from(socket.rooms);
      for (const room of socketRooms) {
        // Skip the default room (socket.id) and system rooms
        if (room !== socket.id && !room.startsWith('_')) {
          socket.leave(room);
        }
      }
    }
    
    const remainingConnections = io.sockets.sockets.size;
    if (remainingConnections <= 2) {
      // Only log disconnections when there are few connections
      console.log(`Client disconnected: ${socket.id} (Remaining: ${remainingConnections})`);
    }
  });
});

// Periodic tree respawn check (every 5 seconds)
setInterval(() => {
  const allRooms = rooms.getAllRooms();
  for (const roomId of allRooms) {
    const respawnedStates = rooms.checkTreeRespawn(roomId);
    if (respawnedStates.length > 0) {
      // Broadcast updated tree states
      const treeStates = rooms.getTreeStatesInRoom(roomId);
      io.to(roomId).emit('tree_state_updated', { treeStates });
    }
    
    // Check and clear cooldown for treasure chests whose cooldown has expired
    // Chests stay in place and just become available again
    const respawnedChests = rooms.checkTreasureChestRespawn(roomId);
    for (const { chestId, chest } of respawnedChests) {
      // Broadcast that the chest is available again (same position)
      io.to(roomId).emit('treasure_chest_relocated', {
        chestId,
        chest,
        oldX: chest.x, // Same position
        oldY: chest.y, // Same position
        newX: chest.x, // Same position
        newY: chest.y, // Same position
      });
      console.log(`[TreasureChest] Chest ${chestId} in room ${roomId} is now available again at (${chest.x}, ${chest.y})`);
    }
  }
}, 5000);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', rooms: rooms.getAllRooms().length });
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
