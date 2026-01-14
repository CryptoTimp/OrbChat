import { useRef, useCallback, useEffect, useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { useGameLoop } from '../hooks/useGameLoop';
import { useKeyboard } from '../hooks/useKeyboard';
import { useSocket } from '../hooks/useSocket';
import { 
  drawBackground, 
  drawOrb, 
  drawPlayer, 
  drawChatBubble, 
  clearCanvas,
  updatePlayerTrail,
  drawParticleTrails,
  clearPlayerTrail,
  setShopItems,
  drawForestFoliage,
  getForestTrees,
  getTreeId,
  drawTreeProgressBar,
  setPlayerChopping,
  isPlayerChopping,
  getClickedTree,
  getHoveredTree,
  isPlayerInTreeRange,
  getClickedLogDealer,
  getClickedDealer,
  getHoveredDealer,
  dealerPositions,
  type TreeData,
  drawForestFountain,
  drawGuardTower,
  drawFlagBunting,
  spawnOrbCollectionParticles,
  drawOrbCollectionParticles,
  spawnFloatingText,
  drawFloatingTexts,
  drawClickTarget,
  updateAndDrawFountainOrbSprays,
  getClickedNPCStall,
  getHoveredNPCStall,
  isPlayerInNPCStallRange,
  getNPCStalls,
  spawnSmokeEffect,
  updateAndDrawSmokeParticles,
  drawPlazaWallTop,
  drawShrine,
  drawShrineSpeechBubble,
  getClickedShrine,
  getHoveredShrine,
  isPlayerInShrineRange,
  updateAndDrawShrineOrbLaunches,
  isShrineOrbHidden,
  setShrineSpeechBubble,
  drawPet,
  updateVillagers,
  getCenturionPlayers,
  updateCenturionPlayers,
  getClickedNPC,
  handleNPCClick,
  drawNameTag
} from './renderer';
import { 
  calculateMovement, 
  checkOrbCollision,
  InterpolatedPlayer,
  createInterpolatedPlayer,
  updateInterpolation,
  setTargetPosition 
} from './Player';
import { playShopBellSound, playOrbCollectionSound, playShrineRejectionSound, playClickSound, playLogReceivedSound, playChoppingSound } from '../utils/sounds';
import { 
  Camera, 
  createCamera, 
  updateCamera, 
  adjustZoom,
  worldToScreen,
  screenToWorld,
  isVisible 
} from './Camera';
import { CANVAS_WIDTH, CANVAS_HEIGHT, GAME_CONSTANTS, PlayerWithChat, ItemRarity, WORLD_WIDTH, WORLD_HEIGHT } from '../types';

const { SCALE, PLAYER_WIDTH, PLAYER_HEIGHT } = GAME_CONSTANTS;

// Track orbs we've already spawned particles for (prevents duplicates)
const collectedOrbsWithParticles = new Set<string>();

export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { getKeys } = useKeyboard();
  const { move, collectOrb, interactWithShrine, startCuttingTree, completeCuttingTree, cancelCuttingTree } = useSocket();
  const toggleLogDealer = useGameStore(state => state.toggleLogDealer);
  
  // Track container size for responsive canvas
  const [canvasSize, setCanvasSize] = useState({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
  
  // Store actions
  const setLocalPlayerPosition = useGameStore(state => state.setLocalPlayerPosition);
  const clickTarget = useGameStore(state => state.clickTarget);
  const setClickTarget = useGameStore(state => state.setClickTarget);
  const openShopWithFilter = useGameStore(state => state.openShopWithFilter);
  
  // Camera
  const cameraRef = useRef<Camera>(createCamera());
  
  // Interpolated players for smooth rendering
  const interpolatedPlayersRef = useRef<Map<string, InterpolatedPlayer>>(new Map());
  
  // Last move time for throttling
  const lastMoveTimeRef = useRef(0);
  const moveThrottle = 50;
  
  // Hovered shrine state (use ref so game loop can always read latest value)
  const hoveredShrineRef = useRef<string | null>(null);
  const [hoveredShrine, setHoveredShrine] = useState<string | null>(null);
  
  // Tree cutting state
  const cuttingTreeRef = useRef<{ treeId: string; startTime: number; duration: number; startX: number; startY: number } | null>(null);
  const [cuttingTree, setCuttingTree] = useState<{ treeId: string; progress: number } | null>(null);
  const lastChopSoundSecondRef = useRef<number>(-1); // Track last second when chopping sound was played
  
  // Update ref when state changes
  useEffect(() => {
    hoveredShrineRef.current = hoveredShrine;
  }, [hoveredShrine]);
  
  // Pending shrine interaction (shrine to activate when player gets in range)
  const pendingShrineInteractionRef = useRef<string | null>(null);
  
  // Pending NPC stall interaction (stall to open when player gets in range)
  const pendingNPCStallInteractionRef = useRef<{ tab: 'hats' | 'shirts' | 'legs' | 'capes' | 'wings' | 'accessories' | 'boosts' | 'pets'; rarity: ItemRarity } | null>(null);
  
  // Pending tree interaction (tree to cut when player gets in range)
  const pendingTreeInteractionRef = useRef<TreeData | null>(null);
  const pendingLogDealerInteractionRef = useRef<boolean>(false);
  const pendingLootBoxDealerInteractionRef = useRef<boolean>(false);
  
  // Hovered dealer state
  const [hoveredDealerId, setHoveredDealerId] = useState<string | null>(null);
  
  // Hovered NPC stall state
  const hoveredNPCStallRef = useRef<{ tab: 'hats' | 'shirts' | 'legs' | 'capes' | 'wings' | 'accessories' | 'boosts' | 'pets'; rarity: ItemRarity } | null>(null);
  const [hoveredNPCStall, setHoveredNPCStall] = useState<{ tab: 'hats' | 'shirts' | 'legs' | 'capes' | 'wings' | 'accessories' | 'boosts' | 'pets'; rarity: ItemRarity } | null>(null);
  
  // Update ref when state changes
  useEffect(() => {
    hoveredNPCStallRef.current = hoveredNPCStall;
  }, [hoveredNPCStall]);
  
  // Handle window resize - update canvas to fill screen with integer scaling
  useEffect(() => {
    const updateSize = () => {
      const container = containerRef.current;
      if (!container) return;
      
      const containerWidth = window.innerWidth;
      const containerHeight = window.innerHeight;
      
      // Calculate the scale factor to fill the screen while maintaining aspect ratio
      const scaleX = containerWidth / CANVAS_WIDTH;
      const scaleY = containerHeight / CANVAS_HEIGHT;
      const scale = Math.max(scaleX, scaleY);
      
      // Use the scaled dimensions (this fills the screen)
      setCanvasSize({
        width: Math.ceil(CANVAS_WIDTH * scale),
        height: Math.ceil(CANVAS_HEIGHT * scale)
      });
    };
    
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);
  
  // Handle mouse wheel zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1;
      adjustZoom(cameraRef.current, zoomDelta);
    };
    
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);
  
  // Handle click-to-move
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const handleClick = (e: MouseEvent) => {
      // Only handle clicks directly on canvas
      if (e.target !== canvas) {
        return;
      }
      
      // Don't move if clicking on UI elements
      const target = e.target as HTMLElement;
      const clickedElement = document.elementFromPoint(e.clientX, e.clientY);
      if (clickedElement && clickedElement !== canvas) {
        const isUIElement = clickedElement.closest('button, input, textarea, select, [role="button"], a, [class*="modal"], [class*="HUD"], [class*="ChatBar"]');
        if (isUIElement) {
          return;
        }
      }
      
      e.preventDefault();
      e.stopPropagation();
      
      const rect = canvas.getBoundingClientRect();
      
      // Get click position relative to canvas (in actual canvas pixels)
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;
      
      // Account for render scale - canvas might be scaled up to fill screen
      const renderScale = canvasSize.width / CANVAS_WIDTH;
      const scaledX = canvasX / renderScale;
      const scaledY = canvasY / renderScale;
      
      // Convert screen coordinates to world coordinates
      const camera = cameraRef.current;
      const worldPos = screenToWorld(camera, scaledX, scaledY);
      
      // Left click = interactions only (no movement)
      // Check if clicking on a shrine (in scaled world coordinates)
      const worldXScaled = worldPos.x * SCALE;
      const worldYScaled = worldPos.y * SCALE;
      const currentShrines = useGameStore.getState().shrines;
      const clickedShrine = getClickedShrine(worldXScaled, worldYScaled, currentShrines);
      
      if (clickedShrine) {
        console.log('Shrine clicked!', clickedShrine.id, 'at world pos:', worldXScaled, worldYScaled, 'shrine pos:', clickedShrine.x * SCALE, clickedShrine.y * SCALE);
        const now = Date.now();
        // Get fresh local player from store
        const localPlayer = useGameStore.getState().localPlayer;
        
        // Check if shrine is on cooldown
        if (clickedShrine.cooldownEndTime && now < clickedShrine.cooldownEndTime) {
          // Shrine is on cooldown - play sound and show message with variation
          playShrineRejectionSound();
          const cooldownMessages = [
            'Do not frustrate the gods',
            'The shrine needs rest',
            'Patience, mortal',
            'The gods are not ready',
            'Wait for the divine energy to return',
            'The shrine slumbers',
            'Respect the cooldown',
            'The spirits need time',
          ];
          const message = cooldownMessages[Math.floor(Math.random() * cooldownMessages.length)];
          setShrineSpeechBubble(clickedShrine.id, message);
          return;
        }
        
        // Always walk to shrine first, then auto-activate when in range
        if (localPlayer) {
          // Set click target to shrine position (in unscaled world coordinates)
          setClickTarget(clickedShrine.x, clickedShrine.y);
          // Store pending interaction to activate when in range
          pendingShrineInteractionRef.current = clickedShrine.id;
          console.log('Clicked shrine, walking to:', clickedShrine.id, 'at', clickedShrine.x, clickedShrine.y);
        } else {
          console.log('No local player, cannot walk to shrine');
        }
        return; // Don't move to shrine via normal click handling
      }
      
      // Clear pending shrine interaction if clicking elsewhere
      if (pendingShrineInteractionRef.current) {
        pendingShrineInteractionRef.current = null;
      }
      
      // Check if clicking on an NPC stall (in scaled world coordinates)
      const npcStall = getClickedNPCStall(worldXScaled, worldYScaled);
      
      if (npcStall) {
        // Get fresh local player from store
        const localPlayer = useGameStore.getState().localPlayer;
        
        if (localPlayer) {
          // Check if player is within interaction range
          const inRange = isPlayerInNPCStallRange(localPlayer.x, localPlayer.y, npcStall);
          
          if (inRange) {
            // Player is in range, open shop immediately
            playShopBellSound();
            openShopWithFilter(npcStall.tab); // No rarity filter for NPC shops
            pendingNPCStallInteractionRef.current = null; // Clear any pending interaction
          } else {
            // Player is far away, walk to stall first
            // Set click target to stall position (in unscaled world coordinates)
            setClickTarget(npcStall.x / SCALE, npcStall.y / SCALE);
            // Store pending interaction to open when in range
            pendingNPCStallInteractionRef.current = { tab: npcStall.tab, rarity: npcStall.rarity };
          }
        }
        return; // Don't move via normal click handling
      }
      
      // Clear pending NPC stall interaction if clicking elsewhere
      if (pendingNPCStallInteractionRef.current) {
        pendingNPCStallInteractionRef.current = null;
      }
      
      // Clear pending log dealer interaction if clicking elsewhere
      if (pendingLogDealerInteractionRef.current) {
        pendingLogDealerInteractionRef.current = false;
      }
      
      // Check if clicking on log dealer (only in forest map)
      const currentMapType = useGameStore.getState().mapType;
      if (currentMapType === 'forest') {
        const clickedDealerId = getClickedDealer(worldXScaled, worldYScaled);
        if (clickedDealerId === 'log_dealer') {
          const localPlayer = useGameStore.getState().localPlayer;
          if (localPlayer) {
            // Get log dealer position from dealerPositions map
            const dealerPos = dealerPositions.get('log_dealer');
            if (dealerPos) {
              // Player position is in unscaled coordinates, convert to scaled for comparison
              const playerCenterX = localPlayer.x * SCALE + (PLAYER_WIDTH * SCALE) / 2;
              const playerCenterY = localPlayer.y * SCALE + (PLAYER_HEIGHT * SCALE) / 2;
              const dx = dealerPos.x - playerCenterX;
              const dy = dealerPos.y - playerCenterY;
              const dist = Math.sqrt(dx * dx + dy * dy);
              
              // Use same range as NPC stalls (25 * SCALE)
              const INTERACTION_RANGE = 25 * SCALE;
              if (dist < INTERACTION_RANGE) {
                // Player is near log dealer, open modal
                playClickSound();
                toggleLogDealer();
                pendingLogDealerInteractionRef.current = false; // Clear pending
              } else {
                // Player is far away, walk to dealer first
                // Convert dealer position to unscaled coordinates for click target
                setClickTarget(dealerPos.x / SCALE, dealerPos.y / SCALE);
                pendingLogDealerInteractionRef.current = true; // Set pending interaction
              }
            }
          }
          return; // Don't move via normal click handling
        }
        
        // Check if clicking on loot box dealer
        if (clickedDealerId === 'loot_box_dealer') {
          const localPlayer = useGameStore.getState().localPlayer;
          if (localPlayer) {
            // Get loot box dealer position from dealerPositions map
            const dealerPos = dealerPositions.get('loot_box_dealer');
            if (dealerPos) {
              // Player position is in unscaled coordinates, convert to scaled for comparison
              const playerCenterX = localPlayer.x * SCALE + (PLAYER_WIDTH * SCALE) / 2;
              const playerCenterY = localPlayer.y * SCALE + (PLAYER_HEIGHT * SCALE) / 2;
              const dx = dealerPos.x - playerCenterX;
              const dy = dealerPos.y - playerCenterY;
              const dist = Math.sqrt(dx * dx + dy * dy);
              
              // Use same range as NPC stalls (25 * SCALE)
              const INTERACTION_RANGE = 25 * SCALE;
              if (dist < INTERACTION_RANGE) {
                // Player is near loot box dealer, open shop on lootboxes tab
                playClickSound();
                openShopWithFilter('lootboxes');
                pendingLootBoxDealerInteractionRef.current = false; // Clear pending
              } else {
                // Player is far away, walk to dealer first
                // Convert dealer position to unscaled coordinates for click target
                setClickTarget(dealerPos.x / SCALE, dealerPos.y / SCALE);
                pendingLootBoxDealerInteractionRef.current = true; // Set pending interaction
              }
            }
          }
          return; // Don't move via normal click handling
        }
      }
      
      // Check if clicking on an NPC (villager or centurion)
      const clickedNPC = getClickedNPC(worldPos.x, worldPos.y);
      if (clickedNPC) {
        playClickSound();
        handleNPCClick(clickedNPC.id, clickedNPC.profession);
        return; // Don't move via normal click handling
      }
      
      // Check if clicking on a tree (only in forest map)
      if (currentMapType === 'forest') {
        const clickedTree = getClickedTree(worldXScaled, worldYScaled);
        if (clickedTree) {
          const localPlayer = useGameStore.getState().localPlayer;
          if (localPlayer) {
            const treeId = getTreeId(clickedTree);
            const treeStates = useGameStore.getState().treeStates;
            const treeState = treeStates.get(treeId);
            
            // Check if tree is already cut or being cut
            if (treeState && (treeState.isCut || treeState.cutBy !== null)) {
              return; // Tree is unavailable
            }
            
            // Check if player is near tree
            if (isPlayerInTreeRange(localPlayer.x, localPlayer.y, clickedTree)) {
              // Player is near tree, start cutting immediately
              const playerId = useGameStore.getState().playerId;
              const duration = 3000 + Math.random() * 5000; // 3-8 seconds
              const startTime = Date.now();
              const currentLocalPlayer = useGameStore.getState().localPlayer;
              const startX = currentLocalPlayer?.x || 0;
              const startY = currentLocalPlayer?.y || 0;
              cuttingTreeRef.current = { treeId, startTime, duration, startX, startY };
              // Set progress bar state immediately
              setCuttingTree({ treeId, progress: 0 });
              // Clear player trail to prevent ghost image during chopping
              if (playerId) {
                clearPlayerTrail(playerId);
                setPlayerChopping(playerId, true);
              }
              // Start cutting on server FIRST
              startCuttingTree(treeId);
              playClickSound();
            } else {
              // Player is far away, walk to tree first
              const treeCenterX = clickedTree.trunkX + clickedTree.trunkW / 2;
              const treeCenterY = clickedTree.trunkY + clickedTree.trunkH / 2;
              
              // Cancel current tree cutting if clicking on a different tree or clicking to move
              if (cuttingTreeRef.current) {
                const { treeId } = cuttingTreeRef.current;
                console.log('Clicked while cutting tree, canceling');
                const playerId = useGameStore.getState().playerId;
                if (playerId) {
                  setPlayerChopping(playerId, false);
                  cancelCuttingTree(treeId);
                }
                cuttingTreeRef.current = null;
                setCuttingTree(null);
                lastChopSoundSecondRef.current = -1;
              }
              
              setClickTarget(treeCenterX / SCALE, treeCenterY / SCALE);
              pendingTreeInteractionRef.current = clickedTree;
            }
          }
          return; // Don't move via normal click handling
        }
      }
      
      // Clear pending tree interaction if clicking elsewhere (but not moving)
      if (pendingTreeInteractionRef.current) {
        pendingTreeInteractionRef.current = null;
      }
      
      // Left click with no interaction = do nothing (movement is right click only)
    };
    
    // Handle right-click for movement (mousedown event)
    const handleRightClick = (e: MouseEvent) => {
      // Only handle right-clicks (button 2) directly on canvas
      if (e.button !== 2 || e.target !== canvas) {
        return;
      }
      
      // Don't move if clicking on UI elements
      const clickedElement = document.elementFromPoint(e.clientX, e.clientY);
      if (clickedElement && clickedElement !== canvas) {
        const isUIElement = clickedElement.closest('button, input, textarea, select, [role="button"], a, [class*="modal"], [class*="HUD"], [class*="ChatBar"]');
        if (isUIElement) {
          return;
        }
      }
      
      e.preventDefault();
      e.stopPropagation();
      
      const rect = canvas.getBoundingClientRect();
      
      // Get click position relative to canvas (in actual canvas pixels)
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;
      
      // Account for render scale - canvas might be scaled up to fill screen
      const renderScale = canvasSize.width / CANVAS_WIDTH;
      const scaledX = canvasX / renderScale;
      const scaledY = canvasY / renderScale;
      
      // Convert screen coordinates to world coordinates
      const camera = cameraRef.current;
      const worldPos = screenToWorld(camera, scaledX, scaledY);
      
      // Cancel tree cutting if moving
      if (cuttingTreeRef.current) {
        const { treeId } = cuttingTreeRef.current;
        console.log('Right clicked while cutting tree, canceling');
        const playerId = useGameStore.getState().playerId;
        if (playerId) {
          setPlayerChopping(playerId, false);
          cancelCuttingTree(treeId);
        }
        cuttingTreeRef.current = null;
        setCuttingTree(null);
        lastChopSoundSecondRef.current = -1;
      }
      
      // Set movement target
      setClickTarget(worldPos.x, worldPos.y);
    };
    
    canvas.addEventListener('click', handleClick, true); // Use capture phase - left click only
    canvas.addEventListener('mousedown', handleRightClick, true); // Right click for movement
    canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // Prevent right-click context menu
    return () => {
      canvas.removeEventListener('click', handleClick, true);
      canvas.removeEventListener('mousedown', handleRightClick, true);
      canvas.removeEventListener('contextmenu', (e) => e.preventDefault());
    };
  }, [canvasSize, setClickTarget, interactWithShrine, openShopWithFilter, cancelCuttingTree]);
  
  // Handle mouse move for shrine hover detection
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;
      const renderScale = canvasSize.width / CANVAS_WIDTH;
      const scaledX = canvasX / renderScale;
      const scaledY = canvasY / renderScale;
      
      const camera = cameraRef.current;
      const worldPos = screenToWorld(camera, scaledX, scaledY);
      const worldXScaled = worldPos.x * SCALE;
      const worldYScaled = worldPos.y * SCALE;
      
      // Get fresh shrines from store
      const currentShrines = useGameStore.getState().shrines;
      const currentMapType = useGameStore.getState().mapType || 'cafe';
      
      // Check for hover on shrines (forest maps)
      let hoveredShrineId: string | null = null;
      if (currentMapType === 'forest' && currentShrines.length > 0) {
        const hovered = getHoveredShrine(worldXScaled, worldYScaled, currentShrines);
        hoveredShrineId = hovered?.id || null;
        setHoveredShrine(hoveredShrineId);
      } else {
        setHoveredShrine(null);
      }
      
      // Check for hover on NPC stalls
      const hoveredStall = getHoveredNPCStall(worldXScaled, worldYScaled);
      const hoveredStallData = hoveredStall ? { tab: hoveredStall.tab, rarity: hoveredStall.rarity } : null;
      setHoveredNPCStall(hoveredStallData);
      
      // Check for hover on dealers (forest map)
      let hoveredDealerData: string | null = null;
      if (currentMapType === 'forest') {
        hoveredDealerData = getHoveredDealer(worldXScaled, worldYScaled);
        setHoveredDealerId(hoveredDealerData);
      } else {
        setHoveredDealerId(null);
      }
      
      // Check for hover on trees (forest map) - for cursor only, no visual highlight
      let hoveredTreeData: TreeData | null = null;
      if (currentMapType === 'forest') {
        hoveredTreeData = getHoveredTree(worldXScaled, worldYScaled);
      }
      
      // Change cursor style when hovering over shrine, NPC stall, dealer, or tree
      if (hoveredShrineId || hoveredStall || hoveredDealerData || hoveredTreeData) {
        canvas.style.cursor = 'pointer';
      } else {
        canvas.style.cursor = 'default';
      }
    };
    
    canvas.addEventListener('mousemove', handleMouseMove);
    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.style.cursor = 'default';
    };
  }, [canvasSize]);
  
  // Game loop
  const gameLoop = useCallback((deltaTime: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Calculate render scale based on canvas size vs base resolution
    const renderScale = canvasSize.width / CANVAS_WIDTH;
    
    const currentTime = Date.now();
    const camera = cameraRef.current;
    
    // Get fresh state from store
    const currentPlayers = useGameStore.getState().players;
    const currentOrbs = useGameStore.getState().orbs;
    const currentShrines = useGameStore.getState().shrines;
    const treeStates = useGameStore.getState().treeStates;
    const npcStalls = getNPCStalls();
    const currentLocalPlayer = useGameStore.getState().localPlayer;
    const currentPlayerId = useGameStore.getState().playerId;
    const currentMapType = useGameStore.getState().mapType || 'cafe';
    const currentClickTarget = useGameStore.getState().clickTarget;
    
    // Handle tree cutting progress
    if (cuttingTreeRef.current) {
      const { treeId, startTime, duration, startX, startY } = cuttingTreeRef.current;
      
      // Check if player has moved - cancel cutting if they moved
      const currentLocalPlayer = useGameStore.getState().localPlayer;
      if (currentLocalPlayer) {
        const dx = Math.abs(currentLocalPlayer.x - startX);
        const dy = Math.abs(currentLocalPlayer.y - startY);
        const MOVEMENT_THRESHOLD = 0.5; // Allow small movement for rounding errors
        
        if (dx > MOVEMENT_THRESHOLD || dy > MOVEMENT_THRESHOLD) {
          // Player moved, cancel cutting
          console.log('Player moved while cutting tree, canceling');
          const playerId = useGameStore.getState().playerId;
          if (playerId) {
            setPlayerChopping(playerId, false);
            // Cancel on server
            cancelCuttingTree(treeId);
          }
          // Clear cutting state
          cuttingTreeRef.current = null;
          setCuttingTree(null);
          lastChopSoundSecondRef.current = -1;
          // Skip rest of cutting logic
          return;
        }
      }
      
      const elapsed = currentTime - startTime;
      const progress = Math.min(1, elapsed / duration);
      
      // Always update progress state to ensure it's visible
      setCuttingTree({ treeId, progress });
      
      // Set player chopping animation (only set once, don't reset startTime)
      if (currentPlayerId && !isPlayerChopping(currentPlayerId)) {
        // Only set if not already chopping (to preserve startTime)
        setPlayerChopping(currentPlayerId, true);
      }
      
      // Play chopping sound every second (for the cutting player)
      const currentSecond = Math.floor(elapsed / 1000);
      if (currentSecond !== lastChopSoundSecondRef.current && currentSecond >= 0) {
        lastChopSoundSecondRef.current = currentSecond;
        console.log('Playing chopping sound at second:', currentSecond, 'elapsed:', elapsed);
        playChoppingSound(); // Always play for the cutting player
        
        // Check if other players are nearby and play sound for them too
        const trees = getForestTrees();
        const tree = trees.find(t => getTreeId(t) === treeId);
        if (tree) {
          const treeCenterX = tree.trunkX + tree.trunkW / 2;
          const treeCenterY = tree.trunkY + tree.trunkH / 2;
          const PROXIMITY_DISTANCE = 200; // Distance in unscaled pixels (about 2 tiles)
          
          // Check all players in the room
          const allPlayers = useGameStore.getState().players;
          allPlayers.forEach(player => {
            if (player.id !== currentPlayerId) {
              // Calculate distance from player to tree center
              const playerCenterX = player.x + PLAYER_WIDTH / 2;
              const playerCenterY = player.y + PLAYER_HEIGHT / 2;
              const dx = playerCenterX - treeCenterX;
              const dy = playerCenterY - treeCenterY;
              const distance = Math.sqrt(dx * dx + dy * dy);
              
              if (distance <= PROXIMITY_DISTANCE) {
                // Player is nearby, play chopping sound for them
                playChoppingSound();
              }
            }
          });
        }
      }
      
      // Debug log every second
      if (Math.floor(elapsed / 1000) !== Math.floor((elapsed - deltaTime) / 1000)) {
        const currentCuttingState = cuttingTreeRef.current;
        console.log('Cutting progress:', progress, 'treeId:', treeId, 'cuttingTree ref:', currentCuttingState);
      }
      
      if (progress >= 1) {
        // Cutting complete - clear everything
        console.log('Tree cutting complete, playing log received sound');
        completeCuttingTree(treeId);
        // Play log received sound (only for the cutting player)
        playLogReceivedSound();
        // Stop chopping animation first
        if (currentPlayerId) {
          setPlayerChopping(currentPlayerId, false);
        }
        // Clear ref and state
        cuttingTreeRef.current = null;
        setCuttingTree(null);
        lastChopSoundSecondRef.current = -1; // Reset sound tracking
      }
    } else {
      setCuttingTree(null);
      // Stop chopping animation if not cutting
      if (currentPlayerId) {
        setPlayerChopping(currentPlayerId, false);
      }
    }
    
    // Get shop items and update renderer cache for rarity glow
    const shopItems = useGameStore.getState().shopItems;
    if (shopItems.length > 0) {
      setShopItems(shopItems);
    }
    
    // Handle local player movement
    if (currentLocalPlayer) {
      const keys = getKeys();
      
      // Calculate speed multiplier from equipped boosts
      let speedMultiplier = 1.0;
      const equippedOutfit = currentLocalPlayer.sprite?.outfit || [];
      for (const itemId of equippedOutfit) {
        const item = shopItems.find(s => s.id === itemId);
        if (item?.speedMultiplier && isFinite(item.speedMultiplier)) {
          // Use highest boost (don't stack), cap at reasonable maximum
          speedMultiplier = Math.min(3.0, Math.max(speedMultiplier, item.speedMultiplier));
        }
      }
      
      // Clear click target if keyboard is pressed
      const anyKeyPressed = keys.up || keys.down || keys.left || keys.right;
      
      // Cancel tree cutting if player presses movement keys
      if (anyKeyPressed && cuttingTreeRef.current) {
        const { treeId } = cuttingTreeRef.current;
        console.log('WASD pressed while cutting tree, canceling');
        const playerId = useGameStore.getState().playerId;
        if (playerId) {
          setPlayerChopping(playerId, false);
          cancelCuttingTree(treeId);
        }
        cuttingTreeRef.current = null;
        setCuttingTree(null);
        lastChopSoundSecondRef.current = -1;
      }
      
      if (anyKeyPressed && currentClickTarget) {
        setClickTarget(null, null);
        // Also clear pending shrine interaction if player moves manually
        if (pendingShrineInteractionRef.current) {
          pendingShrineInteractionRef.current = null;
        }
        // Also clear pending NPC stall interaction if player moves manually
        if (pendingNPCStallInteractionRef.current) {
          pendingNPCStallInteractionRef.current = null;
        }
        // Also clear pending tree interaction if player moves manually
        if (pendingTreeInteractionRef.current) {
          pendingTreeInteractionRef.current = null;
        }
        // Also clear pending log dealer interaction if player moves manually
        if (pendingLogDealerInteractionRef.current) {
          pendingLogDealerInteractionRef.current = false;
        }
        // Also clear pending loot box dealer interaction if player moves manually
        if (pendingLootBoxDealerInteractionRef.current) {
          pendingLootBoxDealerInteractionRef.current = false;
        }
      }
      
      // Lock player position if cutting a tree
      let newX = currentLocalPlayer.x;
      let newY = currentLocalPlayer.y;
      let newDirection = currentLocalPlayer.direction;
      let moved = false;
      
      // Cancel tree cutting if WASD keys are pressed
      if (cuttingTreeRef.current && (keys.up || keys.down || keys.left || keys.right)) {
        const { treeId } = cuttingTreeRef.current;
        console.log('WASD pressed while cutting tree, canceling');
        const playerId = useGameStore.getState().playerId;
        if (playerId) {
          setPlayerChopping(playerId, false);
          cancelCuttingTree(treeId);
        }
        cuttingTreeRef.current = null;
        setCuttingTree(null);
        lastChopSoundSecondRef.current = -1;
      }
      
      if (!cuttingTreeRef.current) {
        // Normal movement
        const movement = calculateMovement(
          currentLocalPlayer.x,
          currentLocalPlayer.y,
          keys,
          deltaTime,
          speedMultiplier,
          currentMapType,
          anyKeyPressed ? null : currentClickTarget, // Only use click target if no keys pressed
          treeStates // Pass treeStates for collision detection (cut trees have no collision)
        );
        newX = movement.x;
        newY = movement.y;
        newDirection = movement.direction;
        moved = movement.moved;
      } else {
        // Player is cutting, lock position and set animation to 'chop'
        newDirection = currentLocalPlayer.direction; // Keep facing the tree
        // Don't update position
      }
      
      const x = newX;
      const y = newY;
      const direction = newDirection;
      
      // Clear click target if we've reached it (or are very close)
      if (currentClickTarget && !anyKeyPressed) {
        const dx = currentClickTarget.x - x;
        const dy = currentClickTarget.y - y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 3) {
          setClickTarget(null, null);
        }
      }
      
      // Check if player reached pending log dealer interaction
      if (pendingLogDealerInteractionRef.current) {
        const dealerPos = dealerPositions.get('log_dealer');
        if (dealerPos) {
          const playerCenterX = x * SCALE + (PLAYER_WIDTH * SCALE) / 2;
          const playerCenterY = y * SCALE + (PLAYER_HEIGHT * SCALE) / 2;
          const dx = dealerPos.x - playerCenterX;
          const dy = dealerPos.y - playerCenterY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const INTERACTION_RANGE = 25 * SCALE;
          
          if (dist < INTERACTION_RANGE) {
            // Player is now in range, open log dealer modal
            toggleLogDealer();
            pendingLogDealerInteractionRef.current = false;
          }
        }
      }
      
      // Check if player reached pending loot box dealer interaction
      if (pendingLootBoxDealerInteractionRef.current) {
        const dealerPos = dealerPositions.get('loot_box_dealer');
        if (dealerPos) {
          const playerCenterX = x * SCALE + (PLAYER_WIDTH * SCALE) / 2;
          const playerCenterY = y * SCALE + (PLAYER_HEIGHT * SCALE) / 2;
          const dx = dealerPos.x - playerCenterX;
          const dy = dealerPos.y - playerCenterY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const INTERACTION_RANGE = 25 * SCALE;
          
          if (dist < INTERACTION_RANGE) {
            // Player is now in range, open shop on lootboxes tab
            openShopWithFilter('lootboxes');
            pendingLootBoxDealerInteractionRef.current = false;
          }
        }
      }
      
      // Check if player is within range of pending tree interaction
      if (pendingTreeInteractionRef.current && !cuttingTreeRef.current) {
        const pendingTree = pendingTreeInteractionRef.current;
        const inRange = isPlayerInTreeRange(x, y, pendingTree);
        
        if (inRange) {
          // Player is now in range, start cutting
          const treeId = getTreeId(pendingTree);
          const treeStates = useGameStore.getState().treeStates;
          const treeState = treeStates.get(treeId);
          
          // Check if tree is still available
          if (!treeState || (!treeState.isCut && treeState.cutBy === null)) {
            const duration = 3000 + Math.random() * 5000; // 3-8 seconds
            const startTime = Date.now();
            const startX = x;
            const startY = y;
            cuttingTreeRef.current = { treeId, startTime, duration, startX, startY };
            // Set progress bar state immediately
            setCuttingTree({ treeId, progress: 0 });
            // Clear player trail to prevent ghost image during chopping
            if (currentPlayerId) {
              clearPlayerTrail(currentPlayerId);
              setPlayerChopping(currentPlayerId, true);
            }
            startCuttingTree(treeId);
            setClickTarget(null, null); // Stop movement
            pendingTreeInteractionRef.current = null;
          } else {
            // Tree is no longer available, clear pending interaction
            pendingTreeInteractionRef.current = null;
            setClickTarget(null, null);
          }
        }
      }
      
      // Check if player is within range of pending shrine interaction
      if (pendingShrineInteractionRef.current) {
        const pendingShrineId = pendingShrineInteractionRef.current;
        const pendingShrine = currentShrines.find(s => s.id === pendingShrineId);
        
        if (pendingShrine) {
          const inRange = isPlayerInShrineRange(x, y, pendingShrine);
          
          if (inRange) {
            // Player is now in range, activate shrine
            const now = Date.now();
            if (!pendingShrine.cooldownEndTime || now >= pendingShrine.cooldownEndTime) {
              console.log('Player in range of shrine, activating:', pendingShrineId);
              interactWithShrine(pendingShrineId);
              pendingShrineInteractionRef.current = null;
              setClickTarget(null, null); // Clear click target
            } else {
              // Shrine went on cooldown, clear pending interaction
              console.log('Shrine went on cooldown, clearing pending interaction');
              pendingShrineInteractionRef.current = null;
            }
          }
        } else {
          // Shrine no longer exists, clear pending interaction
          console.log('Pending shrine no longer exists, clearing');
          pendingShrineInteractionRef.current = null;
        }
      }
      
      // Check if player is within range of pending NPC stall interaction
      if (pendingNPCStallInteractionRef.current) {
        const pendingStall = pendingNPCStallInteractionRef.current;
        // Find the stall in the current stalls array
        const currentStall = npcStalls.find(s => s.tab === pendingStall.tab && s.rarity === pendingStall.rarity);
        
        if (currentStall) {
          const inRange = isPlayerInNPCStallRange(x, y, currentStall);
          
          if (inRange) {
            // Player is now in range, open shop
            playShopBellSound();
            openShopWithFilter(pendingStall.tab); // No rarity filter for NPC shops
            pendingNPCStallInteractionRef.current = null;
            setClickTarget(null, null); // Clear click target
          }
        } else {
          // Stall no longer exists, clear pending interaction
          pendingNPCStallInteractionRef.current = null;
        }
      }
      
      if (moved && direction) {
        setLocalPlayerPosition(x, y, direction);
        
        if (currentTime - lastMoveTimeRef.current > moveThrottle) {
          move(x, y, direction);
          lastMoveTimeRef.current = currentTime;
        }
        
        for (const orb of currentOrbs) {
          if (checkOrbCollision(x, y, orb.x, orb.y)) {
            // Only spawn particles once per orb
            if (!collectedOrbsWithParticles.has(orb.id)) {
              collectedOrbsWithParticles.add(orb.id);
              // Spawn collection particles at orb location (scaled to match rendering)
              const orbCenterX = (orb.x + GAME_CONSTANTS.ORB_SIZE / 2) * SCALE;
              const orbCenterY = (orb.y + GAME_CONSTANTS.ORB_SIZE / 2) * SCALE;
              const orbType = orb.orbType || 'normal';
              spawnOrbCollectionParticles(orbCenterX, orbCenterY, orbType);
              // Spawn "+X" floating text above player head
              const playerHeadX = x * SCALE + (GAME_CONSTANTS.PLAYER_WIDTH / 2) * SCALE;
              const playerHeadY = y * SCALE - 10; // Above head
              
              // Use the actual orb value from the orb object
              let actualOrbValue = orb.value || 10;
              
              // Calculate orb multiplier from equipped items (only for non-shrine orbs)
              if (orbType !== 'shrine') {
                let orbMultiplier = 1.0;
                const equippedOutfit = currentLocalPlayer.sprite?.outfit || [];
                for (const itemId of equippedOutfit) {
                  const item = shopItems.find(s => s.id === itemId);
                  if (item?.orbMultiplier && isFinite(item.orbMultiplier)) {
                    orbMultiplier = Math.min(2.5, Math.max(orbMultiplier, item.orbMultiplier));
                  }
                }
                actualOrbValue = Math.floor(actualOrbValue * orbMultiplier);
              }
              
              spawnFloatingText(playerHeadX, playerHeadY, actualOrbValue, orbType);
              // Play orb collection sound
              playOrbCollectionSound();
              // Clean up tracking after a short delay
              setTimeout(() => collectedOrbsWithParticles.delete(orb.id), 1000);
            }
            collectOrb(orb.id);
          }
        }
      }
      
      // Update camera to follow local player
      updateCamera(camera, currentLocalPlayer.x, currentLocalPlayer.y, deltaTime);
    }
    
    // Update interpolated players
    const interpolatedPlayers = interpolatedPlayersRef.current;
    
    currentPlayers.forEach((player, id) => {
      if (id === currentPlayerId) return;
      
      if (typeof player.x !== 'number' || typeof player.y !== 'number') return;
      
      if (!player.sprite) {
        player.sprite = { body: 'default', outfit: [] };
      }
      
      let interpolated = interpolatedPlayers.get(id);
      if (!interpolated) {
        interpolated = createInterpolatedPlayer(player);
        interpolatedPlayers.set(id, interpolated);
      } else {
        setTargetPosition(interpolated, player.x, player.y, player.direction);
        interpolated.chatBubble = player.chatBubble;
        interpolated.sprite = player.sprite || { body: 'default', outfit: [] };
        interpolated.orbs = player.orbs;
        interpolated.name = player.name;
      }
      updateInterpolation(interpolated, deltaTime);
    });
    
    // Remove disconnected players
    for (const id of interpolatedPlayers.keys()) {
      if (!currentPlayers.has(id)) {
        interpolatedPlayers.delete(id);
      }
    }
    
    // === RENDERING ===
    
    // Clear canvas
    ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
    
    // Apply render scale for full-screen canvas, then camera transform
    ctx.save();
    ctx.scale(renderScale, renderScale); // Scale up to fill screen
    clearCanvas(ctx);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
    
    // Draw background (draws the full map, context clips to viewport)
    drawBackground(ctx, currentMapType);
    
    // Draw fountain orb sprays (before orbs so they appear behind)
    if (currentMapType === 'forest') {
      updateAndDrawFountainOrbSprays(ctx, deltaTime);
      // Draw shrine orb launches (explosion animation)
      updateAndDrawShrineOrbLaunches(ctx, deltaTime);
    }
    
    // Draw smoke particles (for spawn/despawn effects) - before orbs
    updateAndDrawSmokeParticles(ctx, deltaTime);
    
    // Draw orbs (only visible ones)
    // Note: isVisible expects unscaled world coordinates (like orb.x, orb.y)
    for (const orb of currentOrbs) {
      // Hide orbs that are animating from shrines
      if (isShrineOrbHidden(orb.id)) {
        continue;
      }
      if (isVisible(camera, orb.x, orb.y, GAME_CONSTANTS.ORB_SIZE, GAME_CONSTANTS.ORB_SIZE)) {
        drawOrb(ctx, orb, currentTime);
      }
    }
    
    // Draw shrines (before players, only for forest map)
    if (currentMapType === 'forest') {
      if (currentShrines.length > 0) {
        // Debug: log shrine positions
        if (currentTime % 5000 < 100) { // Log every 5 seconds
          console.log(`Drawing ${currentShrines.length} shrines. First shrine:`, {
            id: currentShrines[0].id,
            x: currentShrines[0].x,
            y: currentShrines[0].y,
            cameraX: camera.x,
            cameraY: camera.y,
            zoom: camera.zoom
          });
        }
        for (const shrine of currentShrines) {
          // isVisible expects unscaled world coordinates (like orb.x, orb.y)
          // Shrine size is approximately 30 pixels (unscaled)
          if (isVisible(camera, shrine.x, shrine.y, 30, 30)) {
            // Read from ref to get latest hover state
            const isHovered = hoveredShrineRef.current === shrine.id;
            drawShrine(ctx, shrine, currentTime, isHovered);
          }
        }
      } else {
        // Debug: log when we expect shrines but don't have any
        if (currentTime % 5000 < 100) { // Log every 5 seconds
          console.log('Forest map but no shrines in store. Shrines array:', currentShrines);
        }
      }
    }
    
    // Helper to get trail color from equipped items
    const getTrailColor = (outfit: string[]): string | undefined => {
      if (!outfit || !Array.isArray(outfit)) return undefined;
      // Check all equipped items for trail colors (prioritize first found)
      for (const itemId of outfit) {
        if (!itemId) continue;
        const shopItem = shopItems.find(s => s.id === itemId);
        if (shopItem?.trailColor && typeof shopItem.trailColor === 'string') {
          return shopItem.trailColor;
        }
      }
      return undefined;
    };
    
    // Update particle trails for all players
    if (currentLocalPlayer) {
      const trailColor = getTrailColor(currentLocalPlayer.sprite?.outfit || []);
      // Check if local player is pressing movement keys
      const keys = getKeys();
      // Don't update trail if player is chopping (to prevent ghost image)
      const isChopping = cuttingTreeRef.current !== null;
      const localIsMoving = !isChopping && (keys.up || keys.down || keys.left || keys.right);
      updatePlayerTrail(currentLocalPlayer.id, currentLocalPlayer.x, currentLocalPlayer.y, trailColor, currentTime, localIsMoving);
    }
    
    interpolatedPlayers.forEach((interpolated, id) => {
      const trailColor = getTrailColor(interpolated.sprite?.outfit || []);
      updatePlayerTrail(id, interpolated.renderX, interpolated.renderY, trailColor, currentTime, interpolated.renderX !== interpolated.targetX || interpolated.renderY !== interpolated.targetY);
    });
    
    // Draw particle trails (behind players)
    drawParticleTrails(ctx, currentTime);
    
    // Draw orb collection particles
    drawOrbCollectionParticles(ctx, deltaTime);
    
    // Collect all players for rendering
    const allPlayers: Array<{ player: PlayerWithChat; isLocal: boolean; renderY: number }> = [];
    
    if (currentLocalPlayer) {
      allPlayers.push({ 
        player: currentLocalPlayer, 
        isLocal: true, 
        renderY: currentLocalPlayer.y 
      });
    }
    
    interpolatedPlayers.forEach((interpolated, id) => {
      if (typeof interpolated.renderX === 'number' && typeof interpolated.renderY === 'number') {
        // Only render if visible
        if (isVisible(camera, interpolated.renderX, interpolated.renderY, GAME_CONSTANTS.PLAYER_WIDTH, GAME_CONSTANTS.PLAYER_HEIGHT)) {
          const playerToRender = { 
            ...interpolated, 
            x: interpolated.renderX, 
            y: interpolated.renderY,
            sprite: interpolated.sprite || { body: 'default', outfit: [] },
            direction: interpolated.direction || 'down',
            name: interpolated.name || 'Unknown',
            id: interpolated.id || id,
          };
          allPlayers.push({ 
            player: playerToRender,
            isLocal: false,
            renderY: interpolated.renderY
          });
        }
      }
    });
    
    // Add wandering villagers and centurions to the player list (so they're sorted and drawn together)
    if (currentMapType === 'forest') {
      // Villagers hidden for now
      // const villagerPlayers = updateVillagers(currentTime, deltaTime);
      // for (const villager of villagerPlayers) {
      //   allPlayers.push({
      //     player: villager,
      //     isLocal: false,
      //     renderY: villager.y * SCALE
      //   });
      // }
      
      const centurionPlayers = updateCenturionPlayers(currentTime, deltaTime);
      for (const centurion of centurionPlayers) {
        allPlayers.push({
          player: centurion,
          isLocal: false,
          renderY: centurion.y * SCALE
        });
      }
    }
    
    // Sort by Y for depth ordering
    allPlayers.sort((a, b) => a.renderY - b.renderY);
    
    // Separate NPCs from real players (exclude centurions - they're drawn separately after towers)
    const npcs: typeof allPlayers = [];
    const realPlayers: typeof allPlayers = [];
    const centurions: typeof allPlayers = [];
    
    for (const playerData of allPlayers) {
      if (playerData.player.id.startsWith('centurion_')) {
        centurions.push(playerData);
      } else if (playerData.player.id.startsWith('villager_') || 
                  playerData.player.id.startsWith('npc_')) {
        npcs.push(playerData);
      } else {
        realPlayers.push(playerData);
      }
    }
    
    // Draw NPC pets first
    for (const { player } of npcs) {
      const petItemId = player.sprite.outfit.find(itemId => itemId.startsWith('pet_'));
      if (petItemId) {
        drawPet(ctx, player.id, petItemId, player.x, player.y, player.direction, currentTime);
      }
    }
    
    // Draw NPCs first (so they appear below real players)
    // Skip trader NPCs - they're drawn separately in drawNPCStalls
    for (const { player, isLocal } of npcs) {
      const idParts = player.id.split('_');
      const isTraderNPC = player.id.startsWith('npc_') && idParts.length >= 3 && 
                          (idParts[2] === 'legendary' || idParts[2] === 'epic' || idParts[2] === 'rare');
      // Skip trader NPCs - they're drawn in drawNPCStalls
      if (!isTraderNPC) {
        drawPlayer(ctx, player, isLocal, currentTime);
      }
    }
    
    // Draw real player pets
    for (const { player } of realPlayers) {
      const petItemId = player.sprite.outfit.find(itemId => itemId.startsWith('pet_'));
      if (petItemId) {
        drawPet(ctx, player.id, petItemId, player.x, player.y, player.direction, currentTime);
      }
    }
    
      // Draw real players (nameplates are drawn inside drawPlayer, so pets will be below them)
      for (const { player, isLocal } of realPlayers) {
        drawPlayer(ctx, player, isLocal, currentTime);
      }
    
    // Draw flag bunting BEFORE trader NPCs (so it appears behind them, their nameplates, and speech bubbles)
    if (currentMapType === 'forest') {
      const p = SCALE;
      const centerX = WORLD_WIDTH / 2;
      const centerY = WORLD_HEIGHT / 2;
      const plazaRadius = 540 * p;
      drawFlagBunting(ctx, centerX, centerY, plazaRadius, currentTime);
    }
    
    // Draw animated fountain (before foliage so it's behind trees)
    // This includes trader NPCs (bodies and speech bubbles)
    if (currentMapType === 'forest') {
      drawForestFountain(ctx, currentTime, deltaTime, hoveredNPCStallRef.current, hoveredDealerId);
    }
    
    // Draw forest foliage on TOP of players (so they walk behind trees)
    if (currentMapType === 'forest') {
      drawForestFoliage(ctx, treeStates);
      
      // Draw plaza wall top AFTER players (so they walk under the wall)
      drawPlazaWallTop(ctx);
      
      // Draw tree cutting progress bars AFTER foliage (so it's visible on top)
      // Use ref as source of truth since state might be stale
      if (cuttingTreeRef.current) {
        const { treeId, startTime, duration } = cuttingTreeRef.current;
        const trees = getForestTrees();
        const tree = trees.find(t => getTreeId(t) === treeId);
        if (tree) {
          // Calculate progress from ref
          const elapsed = currentTime - startTime;
          const progress = Math.min(1, elapsed / duration);
          // Pass camera.zoom (not full transform which includes renderScale)
          drawTreeProgressBar(ctx, tree, progress, currentTime, camera.zoom);
        }
      }
    }
    
    // Draw guard towers on top of everything (so they're not covered by terrain and players walk behind them)
    if (currentMapType === 'forest') {
      const p = SCALE;
      const centerX = WORLD_WIDTH / 2;
      const centerY = WORLD_HEIGHT / 2;
      const plazaRadius = 540 * p;
      const flagCount = 8;
      const flagRadius = plazaRadius + 15 * p; // Just outside the plaza edge
      
      for (let i = 0; i < flagCount; i++) {
        const angle = (i / flagCount) * Math.PI * 2;
        const towerX = centerX + Math.cos(angle) * flagRadius;
        const towerY = centerY + Math.sin(angle) * flagRadius;
        
        // Draw guard tower (multi-tiered like podiums, but taller)
        drawGuardTower(ctx, towerX, towerY, currentTime, i);
      }
    }
    
    // Draw centurions on top of towers (so they're not hidden by the towers)
    for (const { player, isLocal } of centurions) {
      drawPlayer(ctx, player, isLocal);
    }
    
    // Draw NPC nameplates (background NPCs, etc.) - only if visible
    // Note: Trader NPCs are drawn with their nameplates in drawNPCStalls, so they're already handled
    const zoom = camera.zoom;
    for (const { player } of npcs) {
      const idParts = player.id.split('_');
      const isGameNPC = player.id.startsWith('npc_') && idParts.length >= 3;
      // Skip trader NPCs - they're drawn in drawNPCStalls with their nameplates
      // Trader NPCs have IDs like "npc_hats_legendary", "npc_shirts_epic", etc.
      const isTraderNPC = isGameNPC && (idParts[2] === 'legendary' || idParts[2] === 'epic' || idParts[2] === 'rare');
      if (isGameNPC && !isTraderNPC) {
        // Only draw if visible on screen (isVisible expects unscaled world coordinates)
        if (isVisible(camera, player.x, player.y, PLAYER_WIDTH, PLAYER_HEIGHT)) {
          const scaledX = player.x * SCALE;
          const scaledY = player.y * SCALE;
          const scaledWidth = PLAYER_WIDTH * SCALE;
          drawNameTag(ctx, player.name, scaledX + scaledWidth / 2, scaledY - 20 * SCALE, Infinity, zoom, player.id);
        }
      }
    }
    
    // Draw centurion name tags on top of everything (so they're always visible)
    for (const { player } of centurions) {
      const scaledX = player.x * SCALE;
      const scaledY = player.y * SCALE;
      const scaledWidth = PLAYER_WIDTH * SCALE;
      drawNameTag(ctx, player.name, scaledX + scaledWidth / 2, scaledY - 20 * SCALE, Infinity, zoom, player.id);
    }
    
    // Draw chat bubbles on top of everything (NPCs first, then real players, then centurions)
    for (const { player } of npcs) {
      if (player.chatBubble) {
        drawChatBubble(ctx, player, currentTime, camera.zoom);
      }
    }
    for (const { player } of realPlayers) {
      if (player.chatBubble) {
        drawChatBubble(ctx, player, currentTime, camera.zoom);
      }
    }
    for (const { player } of centurions) {
      if (player.chatBubble) {
        drawChatBubble(ctx, player, currentTime, camera.zoom);
      }
    }
    
    // Draw shrine speech bubbles (after players and chat bubbles)
    if (currentMapType === 'forest') {
      for (const shrine of currentShrines) {
        // isVisible expects unscaled world coordinates
        if (isVisible(camera, shrine.x, shrine.y, 30, 30)) {
          drawShrineSpeechBubble(ctx, shrine, currentTime, camera.zoom);
        }
      }
    }
    
    // Draw click target indicator
    const renderClickTarget = useGameStore.getState().clickTarget;
    const renderKeys = getKeys();
    const renderAnyKeyPressed = renderKeys.up || renderKeys.down || renderKeys.left || renderKeys.right;
    if (renderClickTarget && !renderAnyKeyPressed && currentLocalPlayer) {
      const playerOrbs = currentLocalPlayer.orbs || 0;
      drawClickTarget(ctx, renderClickTarget.x, renderClickTarget.y, currentTime, playerOrbs);
    }
    
    // Draw floating texts ("+X" for orb collection)
    drawFloatingTexts(ctx);
    
    ctx.restore();
    
    // Draw zoom indicator (UI overlay, scaled for full screen)
    const uiScale = renderScale;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(10 * uiScale, canvasSize.height - 30 * uiScale, 80 * uiScale, 20 * uiScale);
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.round(12 * uiScale)}px "Press Start 2P", monospace`;
    ctx.fillText(`${Math.round(camera.zoom * 100)}%`, 20 * uiScale, canvasSize.height - 15 * uiScale);
    
  }, [getKeys, move, collectOrb, setLocalPlayerPosition, canvasSize]);
  
  useGameLoop(gameLoop, true);
  
  return (
    <div ref={containerRef} className="absolute inset-0 w-full h-full overflow-hidden bg-gray-900">
      <canvas
        ref={canvasRef}
        width={canvasSize.width}
        height={canvasSize.height}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer"
        style={{ 
          imageRendering: 'pixelated',
          pointerEvents: 'auto',
        }}
      />
    </div>
  );
}
