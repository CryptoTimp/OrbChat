import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { GameCanvas } from './game/GameCanvas';
import { ChatBar } from './ui/ChatBar';
import { HUD } from './ui/HUD';
import { ShopModal } from './ui/ShopModal';
import { InventoryModal } from './ui/InventoryModal';
import { SettingsModal } from './ui/SettingsModal';
import { LogDealerModal } from './ui/LogDealerModal';
import { LootBoxModal } from './ui/LootBoxModal';
import { JoinScreen } from './ui/JoinScreen';
import { AuthScreen } from './ui/AuthScreen';
import { Notifications } from './ui/Notifications';
import { MusicManager } from './ui/MusicManager';
import { useSocket } from './hooks/useSocket';
import { useGameStore } from './state/gameStore';
import { onAuthChange, getCurrentUser } from './firebase/auth';

function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [hasJoined, setHasJoined] = useState(false);
  
  // Initialize socket connection
  useSocket();
  
  const localPlayer = useGameStore(state => state.localPlayer);
  const roomId = useGameStore(state => state.roomId);
  const playerName = useGameStore(state => state.playerName);
  const selectedLootBox = useGameStore(state => state.selectedLootBox);
  const setSelectedLootBox = useGameStore(state => state.setSelectedLootBox);
  
  // Listen to Firebase auth state
  useEffect(() => {
    const unsubscribe = onAuthChange((firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
    });
    
    return () => unsubscribe();
  }, []);
  
  // Check if we should auto-rejoin (e.g., after HMR)
  // IMPORTANT: Only auto-rejoin if we have a localPlayer (successful previous join)
  // Don't auto-rejoin if we just have roomId from a failed join attempt
  useEffect(() => {
    if (roomId && playerName && localPlayer && !hasJoined && user) {
      // Only set hasJoined if we have a localPlayer (meaning we successfully joined before)
      setHasJoined(true);
    } else if (roomId && !localPlayer && hasJoined) {
      // If we have roomId but no localPlayer and hasJoined is true, it means a join failed
      // Reset hasJoined to go back to JoinScreen
      setHasJoined(false);
    }
  }, [roomId, playerName, localPlayer, hasJoined, user]);
  
  // Show loading while checking auth state
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-400 text-sm">Loading...</p>
        </div>
      </div>
    );
  }
  
  // Show auth screen if not logged in
  if (!user) {
    return <AuthScreen onAuthSuccess={() => {}} />;
  }
  
  // Show join screen if not joined yet
  if (!hasJoined) {
    return <JoinScreen onJoin={() => setHasJoined(true)} user={user} />;
  }
  
  // Show loading state while waiting for player data
  if (!localPlayer) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-400 font-pixel text-sm">Connecting to room...</p>
        </div>
      </div>
    );
  }
  
  const handleLeaveRoom = () => {
    setHasJoined(false);
  };
  
  return (
    <div className="h-screen w-screen overflow-hidden bg-gray-900 relative">
      {/* Game canvas - full screen */}
      <GameCanvas />
      
      {/* HUD overlay */}
      <HUD onLeaveRoom={handleLeaveRoom} />
      
      {/* Chat bar overlay */}
      <ChatBar />
      
      {/* Shop modal */}
      <ShopModal />
      
      {/* Loot Box Modal - rendered independently */}
      <LootBoxModal 
        lootBox={selectedLootBox} 
        onClose={() => setSelectedLootBox(null)} 
      />
      
      {/* Inventory modal */}
      <InventoryModal />
      
      {/* Settings modal */}
      <SettingsModal />
      
      {/* Log dealer modal */}
      <LogDealerModal />
      
      {/* Music manager */}
      <MusicManager />
      
      {/* Notifications */}
      <Notifications />
    </div>
  );
}

export default App;
