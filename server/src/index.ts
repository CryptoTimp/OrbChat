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

// Initialize global rooms
rooms.initializeGlobalRooms();

// Track socket -> player mapping
const socketToPlayer: Map<string, { playerId: string; roomId: string }> = new Map();

// Socket connection handler
io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
  console.log(`Client connected: ${socket.id}`);

  // Handle listing available rooms
  socket.on('list_rooms', () => {
    const roomList = rooms.getRoomList();
    console.log(`Sending room list: ${roomList.length} rooms`);
    socket.emit('room_list', roomList);
  });

  // Handle joining a room
  socket.on('join_room', async ({ roomId, playerName, orbs, equippedItems, mapType, password }) => {
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
    
    // Create player with data from Firebase
    const player = players.createPlayerFromFirebase(playerId, playerName, roomId, orbs || 0, equippedItems || [], roomMapType);
    
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
    
    // Store mapping
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
      treeStates: rooms.getTreeStatesInRoom(roomId),
      yourPlayerId: player.id,
      mapType: roomMapType,
    });
    
    console.log(`Sent room_state to ${player.name} with ${allPlayers.length} players, map: ${roomMapType}`);
    
    // Send shop items
    socket.emit('shop_items', shop.getShopItems());
    
    // IMPORTANT: Broadcast to other players BEFORE async Firebase calls
    // This ensures the broadcast doesn't get blocked by slow/failing Firebase operations
    const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
    const numSockets = socketsInRoom ? socketsInRoom.size : 0;
    console.log(`Broadcasting player_joined for ${player.name} to room ${roomId} (${numSockets} sockets in room)`);
    
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
    if (!mapping) return;

    const { playerId, roomId } = mapping;
    
    // Remove player from room
    rooms.removePlayerFromRoom(roomId, playerId);
    
    // Leave socket room
    socket.leave(roomId);
    
    // Remove mapping
    socketToPlayer.delete(socket.id);
    
    // Notify others
    socket.to(roomId).emit('player_left', { playerId });
    
    console.log(`Player ${playerId} left room ${roomId}`);
  });

  // Handle movement
  socket.on('move', ({ x, y, direction }) => {
    const mapping = socketToPlayer.get(socket.id);
    if (!mapping) return;

    const { playerId, roomId } = mapping;
    const updated = rooms.updatePlayerPosition(roomId, playerId, x, y, direction as Direction);
    
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

  // Handle loot box purchase (client does Firebase update, server just validates and updates room state)
  socket.on('purchase_lootbox', async (data: { lootBoxId: string; itemId: string; newOrbs?: number; newInventory?: string[]; alreadyOwned?: boolean }) => {
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
      
      console.log(`Player ${player.name} opened loot box and received item ${itemId}, new balance: ${newOrbs}`);
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
    const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
    const numSockets = socketsInRoom ? socketsInRoom.size : 0;
    console.log(`  Broadcasting player_joined to ${numSockets} sockets in room ${roomId}`);
    
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
          const orbValue = valuePerOrb + (i === 0 ? remainder : 0);

          // Create red shrine orb (bypass max orbs limit for shrine rewards)
          const orb = rooms.createOrbAtPosition(roomId, orbX, orbY, orbValue, 'shrine', true);
          if (orb) {
            actualOrbsSpawned++;
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
    // Server just needs to broadcast the update
    // Get current orbs from Firebase to ensure accuracy
    const { getUserData } = await import('./firebase');
    const userData = await getUserData(playerId);
    const newBalance = userData?.orbs || player.orbs;
    
    // Use client-provided values if available, otherwise check Firebase (fallback)
    let logCount = data?.logCount;
    let orbsReceived = data?.orbsReceived;

    if (logCount === undefined || orbsReceived === undefined) {
      // Fallback: check Firebase if client didn't provide data
      const { getUserInventory } = await import('./firebase');
      const firebaseInventory = await getUserInventory(playerId);
      const logs = firebaseInventory.filter(itemId => itemId === 'log');
      logCount = logs.length;

      if (logCount === 0) {
        socket.emit('error', { message: 'You have no logs to sell' });
        return;
      }

      // Calculate orbs to receive (100 per log)
      const orbsPerLog = 100;
      orbsReceived = logCount * orbsPerLog;
    } else if (logCount === 0) {
      // Client sent 0 logs - show error
      socket.emit('error', { message: 'You have no logs to sell' });
      return;
    }
    
    // Update database to keep it in sync
    await players.updatePlayerOrbs(playerId, newBalance);
    // Update room state
    player.orbs = newBalance;

    // Broadcast updates
    io.to(roomId).emit('logs_sold', { playerId, logCount, orbsReceived, newBalance });
    io.to(roomId).emit('player_orbs_updated', { playerId, orbs: newBalance });

    console.log(`Player ${player.name} sold ${logCount} logs for ${orbsReceived} orbs, new balance: ${newBalance}`);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const mapping = socketToPlayer.get(socket.id);
    if (mapping) {
      const { playerId, roomId } = mapping;
      
      // Clean up mapping first
      socketToPlayer.delete(socket.id);
      
      // Check if there are any other sockets for this player
      const hasOtherSockets = Array.from(socketToPlayer.values()).some(
        m => m.playerId === playerId && m.roomId === roomId
      );
      
      // Only remove player from room if no other sockets exist for this player
      if (!hasOtherSockets) {
        rooms.removePlayerFromRoom(roomId, playerId);
        
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
    }
    
    console.log(`Client disconnected: ${socket.id}`);
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
