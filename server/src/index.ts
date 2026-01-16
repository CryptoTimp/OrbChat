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
import { startOrbSpawner, stopOrbSpawner, startFountainOrbSpawner, stopFountainOrbSpawner } from './orbs';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  Direction,
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
              orbs: rooms.getOrbsInRoom(roomId),
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
    
    // Start orb spawner for this room
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
      orbs: rooms.getOrbsInRoom(roomId),
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
    
    // Broadcast updated room_state to ALL players so everyone has the latest player list
    io.to(roomId).emit('room_state', {
      roomId,
      players: allPlayers,
      orbs: rooms.getOrbsInRoom(roomId),
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
  socket.on('treasure_chest_relocate', ({ chestId }) => {
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) return;

    const { roomId } = mapping;
    const chest = rooms.getTreasureChest(roomId, chestId);
    
    if (!chest) {
      socket.emit('error', { message: 'Treasure chest not found' });
      return;
    }

    // Store old position for animation
    const oldX = chest.x;
    const oldY = chest.y;

    // Relocate the chest
    const result = rooms.relocateTreasureChest(roomId, chestId);
    
    if (!result.success) {
      socket.emit('error', { message: result.message || 'Failed to relocate chest' });
      return;
    }

    // Broadcast relocation to all players in room
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
      console.log(`[TreasureChest] Relocated chest ${chestId} from (${oldX}, ${oldY}) to (${result.newX}, ${result.newY})`);
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

  // Handle disconnection
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
    
    // Check and auto-relocate treasure chests whose cooldown has expired
    const relocatedChests = rooms.checkTreasureChestRespawn(roomId);
    for (const { chestId, chest, oldX, oldY, newX, newY } of relocatedChests) {
      // Broadcast relocation to all players in room
      io.to(roomId).emit('treasure_chest_relocated', {
        chestId,
        chest,
        oldX,
        oldY,
        newX,
        newY,
      });
      console.log(`[TreasureChest] Auto-relocated chest ${chestId} in room ${roomId}`);
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
