import { useState, useEffect, useCallback, useRef } from 'react';
import { User } from 'firebase/auth';
import { useSocket } from '../hooks/useSocket';
import { useGameStore } from '../state/gameStore';
import { signOut, getUserProfile, UserProfile } from '../firebase/auth';
import { MapType, RoomInfo } from '../types';
import { BackgroundNPCs } from './BackgroundNPCs';
import { playClickSound, playShrineRejectionSound } from '../utils/sounds';
import { addNotification } from './Notifications';

interface JoinScreenProps {
  onJoin: () => void;
  user: User;
}

const MAP_OPTIONS: { id: MapType; name: string; emoji: string; description: string; color: string }[] = [
  { id: 'market', name: 'Market Square', emoji: '🏰', description: 'Medieval town center', color: 'from-amber-700 to-stone-600' },
  { id: 'forest', name: 'Forest', emoji: '🌲', description: 'Mystical woodland', color: 'from-emerald-700 to-green-800' },
  { id: 'cafe', name: 'Cafe', emoji: '☕', description: 'Cozy coffee shop', color: 'from-amber-600 to-orange-700' },
];

const MAP_EMOJI: Record<MapType, string> = {
  market: '🏰',
  forest: '🏛️',
  cafe: '☕',
  casino: '🎰',
  millionaires_lounge: '💎',
};

type Tab = 'join' | 'create';

export function JoinScreen({ onJoin, user }: JoinScreenProps) {
  const defaultName = user.displayName || user.email?.split('@')[0] || 'Player';
  const [playerName, setPlayerName] = useState(defaultName);
  const [activeTab, setActiveTab] = useState<Tab>('join');
  
  // Force activeTab to 'join' if it's 'create' (since create tab is hidden)
  useEffect(() => {
    if (activeTab === 'create') {
      setActiveTab('join');
    }
  }, [activeTab]);
  const [isJoining, setIsJoining] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  
  // Create tab state
  const [newRoomId, setNewRoomId] = useState('');
  const [selectedMap, setSelectedMap] = useState<MapType>('forest');
  const [isPrivate, setIsPrivate] = useState(false);
  const [roomPassword, setRoomPassword] = useState('');
  
  // Join tab state
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [roomToJoin, setRoomToJoin] = useState<RoomInfo | null>(null);
  const [passwordError, setPasswordError] = useState('');
  
  // Use ref to track modal state and join state for error handler (avoids stale closure)
  const showPasswordModalRef = useRef(showPasswordModal);
  const isJoiningRef = useRef(isJoining);
  const joinCancelledRef = useRef(false);
  
  useEffect(() => {
    showPasswordModalRef.current = showPasswordModal;
  }, [showPasswordModal]);
  
  useEffect(() => {
    isJoiningRef.current = isJoining;
    if (!isJoining) {
      joinCancelledRef.current = false;
    }
  }, [isJoining]);
  
  const { joinRoom, listRooms, socket } = useSocket();
  
  // Load user profile
  useEffect(() => {
    async function loadProfile() {
      const userProfile = await getUserProfile(user.uid);
      setProfile(userProfile);
      if (userProfile?.displayName) {
        setPlayerName(userProfile.displayName);
      }
    }
    loadProfile();
  }, [user.uid]);
  
  // Pre-fill room name when player name changes
  useEffect(() => {
    if (playerName.trim() && activeTab === 'create') {
      const roomName = `${playerName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')}-room`;
      setNewRoomId(roomName);
      // Reset private settings when room name changes
      setIsPrivate(false);
      setRoomPassword('');
    }
  }, [playerName, activeTab]);
  
  // Reset private settings when switching tabs
  useEffect(() => {
    if (activeTab === 'join') {
      setIsPrivate(false);
      setRoomPassword('');
    }
  }, [activeTab]);
  
  // Fetch rooms when Join tab is active
  const fetchRooms = useCallback(() => {
    setLoadingRooms(true);
    listRooms((roomList) => {
      setRooms(roomList as RoomInfo[]);
      setLoadingRooms(false);
    });
  }, [listRooms]);
  
  useEffect(() => {
    if (activeTab === 'join') {
      fetchRooms();
      // Refresh every 5 seconds
      const interval = setInterval(fetchRooms, 5000);
      return () => clearInterval(interval);
    }
  }, [activeTab, fetchRooms]);
  
  // Listen for socket errors (especially password errors)
  useEffect(() => {
    const handleError = ({ message }: { message: string }) => {
      console.log('Socket error received:', message, 'showPasswordModal:', showPasswordModalRef.current, 'isJoining:', isJoiningRef.current);
      // Cancel any pending join success detection IMMEDIATELY
      joinCancelledRef.current = true;
      
      // Always reset joining state on ANY error
      setIsJoining(false);
      
      // Clear roomId from store on error to prevent App.tsx from showing "Connecting to room..." screen
      // This prevents the auto-rejoin effect in App.tsx from setting hasJoined=true
      useGameStore.getState().setRoomId('');
      
      // Handle password-related errors
      if (message.includes('password') || message.includes('Password') || message.includes('private room') || message.includes('Incorrect password')) {
        console.log('Password error detected, showing in modal');
        
        // Use ref to get current modal state (avoids stale closure)
        // If modal is open, show error there. If not, open it.
        if (showPasswordModalRef.current) {
          // Show error in password modal and keep it open
          setPasswordError(message);
          console.log('Setting password error in modal:', message);
          // Ensure modal stays open
          setShowPasswordModal(true);
        } else {
          // Modal not open - this shouldn't happen for password errors, but handle it
          console.warn('Password error but modal not open, opening modal');
          setShowPasswordModal(true);
          setPasswordError(message);
        }
      } else {
        // For other errors, just reset joining state (already done above)
        console.log('Non-password error, resetting join state');
      }
    };
    
    if (socket) {
      console.log('Setting up error handler in JoinScreen');
      socket.on('error', handleError);
      return () => {
        console.log('Cleaning up error handler in JoinScreen');
        socket.off('error', handleError);
      };
    } else {
      console.warn('No socket available for error handler in JoinScreen');
    }
  }, [socket]);
  
  const handleJoinRoom = (roomId: string, mapType: MapType, password?: string) => {
    if (!playerName.trim()) return;
    
    // Check if this is a private room and password is required
    const room = rooms.find(r => r.id === roomId);
    if (room?.isPrivate && !password) {
      // This should never happen if UI is working correctly, but add safeguard
      console.warn('Attempted to join private room without password');
      handleRoomClick(room);
      return;
    }
    
    setIsJoining(true);
    useGameStore.getState().setPlayerId(user.uid);
    useGameStore.getState().setMapType(mapType);
    localStorage.setItem('playerId', user.uid);
    
    joinRoom(roomId, playerName.trim(), mapType, password);
    
    // Don't call onJoin() immediately - wait for successful room_state event
    // This will be handled by the useEffect that watches for successful join
  };
  
  // Watch for successful room join (when localPlayer is set)
  useEffect(() => {
    if (!isJoining) return; // Only watch when we're actually joining
    
    joinCancelledRef.current = false; // Reset cancel flag when starting new join
    let timeoutId: NodeJS.Timeout;
    const checkJoin = () => {
      // Don't proceed if join was cancelled due to error
      if (joinCancelledRef.current) {
        return;
      }
      
      const state = useGameStore.getState();
      // If we have a local player and room ID, and we're in joining state, the join was successful
      if (state.localPlayer && state.roomId) {
        joinCancelledRef.current = false; // Success, clear cancel flag
        setIsJoining(false);
        // Close password modal if open
        if (showPasswordModal) {
          setShowPasswordModal(false);
          setRoomToJoin(null);
          setPasswordInput('');
          setPasswordError('');
        }
        // Small delay to ensure state is fully set
        timeoutId = setTimeout(() => {
          onJoin();
        }, 100);
      }
    };
    
    // Check immediately
    checkJoin();
    
    // Subscribe to store changes (only while joining)
    const unsubscribe = useGameStore.subscribe(checkJoin);
    
    return () => {
      unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isJoining, showPasswordModal, onJoin]);
  
  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    playClickSound();
    if (!playerName.trim() || !newRoomId.trim()) return;
    if (isPrivate && !roomPassword.trim()) {
      console.warn('Cannot create private room without password');
      return; // Don't create if private but no password
    }
    
    const passwordToSend = isPrivate ? roomPassword.trim() : undefined;
    console.log('Creating room:', newRoomId.trim(), 'isPrivate:', isPrivate, 'hasPassword:', !!passwordToSend, 'passwordLength:', passwordToSend?.length || 0);
    handleJoinRoom(newRoomId.trim(), selectedMap, passwordToSend);
  };
  
  const handleRoomClick = (room: RoomInfo) => {
    playClickSound();
    
    // Check casino orb requirement
    if (room.mapType === 'casino') {
      const playerOrbs = profile?.orbs || 0;
      const CASINO_ORB_REQUIREMENT = 5000000;
      if (playerOrbs < CASINO_ORB_REQUIREMENT) {
        playShrineRejectionSound(); // Play negative sound
        addNotification(`You need ${CASINO_ORB_REQUIREMENT.toLocaleString()} orbs to access the casino!`, 'error');
        return;
      }
    }
    
    // Check millionaire's lounge orb requirement
    if (room.mapType === 'millionaires_lounge') {
      const playerOrbs = profile?.orbs || 0;
      const LOUNGE_ORB_REQUIREMENT = 25000000;
      if (playerOrbs < LOUNGE_ORB_REQUIREMENT) {
        playShrineRejectionSound(); // Play negative sound
        addNotification(`You need ${LOUNGE_ORB_REQUIREMENT.toLocaleString()} orbs to access the Millionaire's Lounge!`, 'error');
        return;
      }
    }
    
    if (room.isPrivate) {
      // Show password modal for private rooms - never join directly
      setRoomToJoin(room);
      setShowPasswordModal(true);
      setPasswordInput('');
      setPasswordError('');
      setSelectedRoom(room.id); // Also select it for visual feedback
    } else {
      // For public rooms, join directly
        handleJoinRoom(room.id, room.mapType);
    }
  };
  
  const handlePasswordSubmit = () => {
    if (!passwordInput.trim()) {
      setPasswordError('Password is required');
      return;
    }
    
    if (!roomToJoin) return;
    
    setPasswordError('');
    setIsJoining(true);
    // Don't close modal yet - wait for success or error
    handleJoinRoom(roomToJoin.id, roomToJoin.mapType, passwordInput.trim());
  };
  
  const handleSignOut = async () => {
    playClickSound();
    await signOut();
    localStorage.removeItem('playerId');
    useGameStore.getState().setPlayerId('');
  };
  
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 relative">
      {/* Background NPCs */}
      <BackgroundNPCs />
      
      {/* Animated background overlay */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 1 }}>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan-900/20 via-transparent to-transparent" />
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute w-2 h-2 rounded-full bg-cyan-500/30 animate-float"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 3}s`,
              animationDuration: `${3 + Math.random() * 2}s`,
            }}
          />
        ))}
      </div>
      
      <div className="relative z-10 w-full max-w-lg">
        {/* User info & sign out */}
        <div className="flex items-center justify-between mb-6 bg-slate-800/50 rounded-lg px-4 py-2 border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-purple-500 rounded-full flex items-center justify-center text-white font-bold text-sm">
              {(user.displayName || user.email)?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="flex flex-col">
              <span className="text-slate-300 text-sm truncate max-w-[150px]">
                {user.displayName || user.email?.split('@')[0]}
              </span>
              <span className="text-cyan-400 text-xs flex items-center gap-1">
                🔮 {profile?.orbs ?? '...'} orbs
              </span>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="text-slate-400 hover:text-red-400 text-sm transition-colors"
          >
            Sign Out
          </button>
        </div>
        
        {/* Logo */}
        <div className="text-center mb-6">
          <h1 className="text-4xl font-pixel text-cyan-400 mb-2 drop-shadow-lg">
            Orb Chat
          </h1>
          <p className="text-slate-400 font-pixel text-xs">
            Walk, Talk, Collect Orbs!
          </p>
        </div>
        
        {/* Name input (always visible) */}
        <div className="bg-slate-900/80 backdrop-blur-sm rounded-xl p-4 border border-slate-700 mb-4">
          <label className="block text-slate-400 font-pixel text-xs mb-2">
            Your Name
          </label>
          <input
            type="text"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Enter your name..."
            maxLength={16}
            required
            className="w-full bg-slate-800 text-slate-100 rounded-lg px-4 py-3 text-sm 
                       placeholder-slate-500 border border-slate-600
                       focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent
                       font-pixel"
          />
        </div>
        
        {/* Tab buttons */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => {
              playClickSound();
              setActiveTab('join');
            }}
            className={`flex-1 py-3 rounded-lg font-pixel text-sm transition-all duration-200 flex items-center justify-center gap-2
              ${activeTab === 'join' 
                ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-500/30' 
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 border border-slate-700'}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            Join Room
          </button>
          {/* Create Room button hidden for now */}
          {/* <button
            onClick={() => setActiveTab('create')}
            className={`flex-1 py-3 rounded-lg font-pixel text-sm transition-all duration-200 flex items-center justify-center gap-2
              ${activeTab === 'create' 
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-500/30' 
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 border border-slate-700'}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Room
          </button> */}
        </div>
        
        {/* Content area */}
        <div className="bg-slate-900/80 backdrop-blur-sm rounded-xl border border-slate-700 shadow-2xl overflow-hidden">
          {activeTab === 'join' ? (
            /* JOIN TAB */
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-slate-300 font-pixel text-sm">Rooms</h3>
                <button 
                  onClick={() => {
                    playClickSound();
                    fetchRooms();
                  }}
                  disabled={loadingRooms}
                  className="text-cyan-400 hover:text-cyan-300 text-xs font-pixel flex items-center gap-1"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 ${loadingRooms ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Refresh
                </button>
              </div>
              
              {loadingRooms && rooms.length === 0 ? (
                <div className="text-center py-8">
                  <div className="animate-spin w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full mx-auto mb-3" />
                  <p className="text-slate-500 font-pixel text-xs">Loading rooms...</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Global Rooms Section */}
                  <div>
                    <h4 className="text-slate-400 font-pixel text-xs mb-2 flex items-center gap-2">
                      <span className="text-emerald-400">🌍</span>
                      Global Rooms
                    </h4>
                    <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1 custom-scrollbar">
                      {rooms.filter(r => r.isGlobal && r.mapType !== 'casino' && r.mapType !== 'millionaires_lounge').length === 0 ? (
                        <p className="text-slate-500 font-pixel text-xs text-center py-2">No global rooms available</p>
                      ) : (
                        rooms.filter(r => r.isGlobal && r.mapType !== 'casino' && r.mapType !== 'millionaires_lounge').map((room) => {
                          // Find casino room for this base room
                          const casinoRoom = rooms.find(r => r.isGlobal && r.mapType === 'casino' && r.id === `casino-${room.id}`);
                          // Find millionaire's lounge room for this base room
                          const loungeRoom = rooms.find(r => r.isGlobal && r.mapType === 'millionaires_lounge' && r.id === `millionaires_lounge-${room.id}`);
                          const isSelected = selectedRoom === room.id;
                          const isCasinoSelected = casinoRoom && selectedRoom === casinoRoom.id;
                          const isLoungeSelected = loungeRoom && selectedRoom === loungeRoom.id;
                          // Show casino dropdown if forest is selected OR if casino is selected (keep it open)
                          const showCasinoDropdown = isSelected || isCasinoSelected;
                          // Show lounge dropdown if forest is selected OR if lounge is selected (keep it open)
                          const showLoungeDropdown = isSelected || isLoungeSelected;
                          
                          return (
                            <div key={room.id} className="space-y-1">
                          <button
                            onClick={() => {
                              playClickSound();
                                  // If clicking the same room, deselect. Otherwise select it.
                              setSelectedRoom(selectedRoom === room.id ? null : room.id);
                            }}
                                className={`w-full p-3 rounded-lg border-2 transition-all duration-200 text-left
                                  ${isSelected 
                                    ? 'bg-emerald-900/30 border-emerald-500 shadow-lg shadow-emerald-500/20' 
                                : 'bg-slate-800/50 border-slate-700 hover:border-slate-600 hover:bg-slate-800'}`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <span className="text-2xl">{MAP_EMOJI[room.mapType]}</span>
                                <div>
                                  <p className="text-slate-200 font-pixel text-sm">
                                    {room.id === 'eu-1' ? 'EU 1' : room.id === 'eu-2' ? 'EU 2' : room.id === 'eu-3' ? 'EU 3' : room.id.toUpperCase()}
                                  </p>
                                      <p className="text-slate-500 font-pixel text-xs capitalize">{room.mapType === 'forest' ? 'Plaza' : room.mapType}</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-emerald-400 font-pixel text-sm">{room.playerCount} 👤</p>
                                <p className="text-slate-500 font-pixel text-xs truncate max-w-[100px]">
                                  {room.players.length > 0 
                                    ? room.players.slice(0, 2).join(', ') + (room.players.length > 2 ? '...' : '')
                                    : 'Empty'}
                                </p>
                              </div>
                            </div>
                          </button>
                              
                              {/* Casino room dropdown below selected room - keep open if casino is selected */}
                              {showCasinoDropdown && casinoRoom && (
                                <div className="ml-4 mt-1 mb-2">
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      playClickSound();
                                      
                                      const playerOrbs = profile?.orbs || 0;
                                      const CASINO_ORB_REQUIREMENT = 5000000;
                                      
                                      if (playerOrbs < CASINO_ORB_REQUIREMENT) {
                                        playShrineRejectionSound(); // Play negative sound
                                        addNotification(`You need ${CASINO_ORB_REQUIREMENT.toLocaleString()} orbs to access the casino!`, 'error');
                                        return;
                                      }
                                      
                                      // Toggle casino selection (if already selected, deselect. Otherwise select it)
                                      setSelectedRoom(selectedRoom === casinoRoom.id ? null : casinoRoom.id);
                                    }}
                                    className={`w-full p-2 rounded-lg border-2 transition-all duration-200 text-left
                                               ${isCasinoSelected
                                                 ? 'bg-amber-900/30 border-amber-500 shadow-lg shadow-amber-500/20'
                                                 : 'bg-amber-900/20 border-amber-700/50 hover:border-amber-600 hover:bg-amber-900/30'}`}
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <span className="text-xl">🎰</span>
                                        <div>
                                          <p className={`font-pixel text-xs ${isCasinoSelected ? 'text-amber-200' : 'text-amber-200'}`}>
                                            Casino - {room.id === 'eu-1' ? 'EU 1' : room.id === 'eu-2' ? 'EU 2' : room.id === 'eu-3' ? 'EU 3' : room.id.toUpperCase()}
                                          </p>
                                          {((profile?.orbs || 0) < 5000000) && (
                                            <p className="text-red-400 font-pixel text-[10px]">
                                              Requires 5,000,000 orbs
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                      <div className="text-right">
                                        <p className="text-amber-400 font-pixel text-xs">{casinoRoom.playerCount} 👤</p>
                                      </div>
                                    </div>
                                  </button>
                                </div>
                              )}
                              
                              {/* Millionaire's Lounge room dropdown below selected room - keep open if lounge is selected */}
                              {showLoungeDropdown && loungeRoom && (
                                <div className="ml-4 mt-1 mb-2">
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      playClickSound();
                                      
                                      const playerOrbs = profile?.orbs || 0;
                                      const LOUNGE_ORB_REQUIREMENT = 25000000;
                                      
                                      if (playerOrbs < LOUNGE_ORB_REQUIREMENT) {
                                        playShrineRejectionSound(); // Play negative sound
                                        addNotification(`You need ${LOUNGE_ORB_REQUIREMENT.toLocaleString()} orbs to access the Millionaire's Lounge!`, 'error');
                                        return;
                                      }
                                      
                                      // Toggle lounge selection (if already selected, deselect. Otherwise select it)
                                      setSelectedRoom(selectedRoom === loungeRoom.id ? null : loungeRoom.id);
                                    }}
                                    className={`w-full p-2 rounded-lg border-2 transition-all duration-200 text-left
                                               ${isLoungeSelected
                                                 ? 'bg-yellow-900/30 border-yellow-500 shadow-lg shadow-yellow-500/20'
                                                 : 'bg-yellow-900/20 border-yellow-700/50 hover:border-yellow-600 hover:bg-yellow-900/30'}`}
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <span className="text-xl">💎</span>
                                        <div>
                                          <p className={`font-pixel text-xs ${isLoungeSelected ? 'text-yellow-200' : 'text-yellow-200'}`}>
                                            Millionaire's Lounge - {room.id === 'eu-1' ? 'EU 1' : room.id === 'eu-2' ? 'EU 2' : room.id === 'eu-3' ? 'EU 3' : room.id.toUpperCase()}
                                          </p>
                                          {((profile?.orbs || 0) < 25000000) && (
                                            <p className="text-red-400 font-pixel text-[10px]">
                                              Requires 25,000,000 orbs
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                      <div className="text-right">
                                        <p className="text-yellow-400 font-pixel text-xs">{loungeRoom.playerCount} 👤</p>
                                      </div>
                                    </div>
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                  
                  {/* Player Rooms Section - hidden for now */}
                  {/* <div>
                    <h4 className="text-slate-400 font-pixel text-xs mb-2 flex items-center gap-2">
                      <span className="text-cyan-400">👥</span>
                      Player Rooms
                    </h4>
                    <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1 custom-scrollbar">
                      {rooms.filter(r => !r.isGlobal).length === 0 ? (
                        <p className="text-slate-500 font-pixel text-xs text-center py-2">No player rooms available</p>
                      ) : (
                        rooms.filter(r => !r.isGlobal).map((room) => (
                          <button
                            key={room.id}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              playClickSound();
                              handleRoomClick(room);
                            }}
                            className={`w-full p-3 rounded-lg border transition-all duration-200 text-left
                              ${selectedRoom === room.id 
                                ? 'bg-cyan-900/30 border-cyan-500' 
                                : 'bg-slate-800/50 border-slate-700 hover:border-slate-600 hover:bg-slate-800'}`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <span className="text-2xl">{MAP_EMOJI[room.mapType]}</span>
                                <div className="flex items-center gap-2">
                                  <div>
                                    <p className="text-slate-200 font-pixel text-sm">{room.id}</p>
                                    <p className="text-slate-500 font-pixel text-xs capitalize">{room.mapType}</p>
                                  </div>
                                  {room.isPrivate && (
                                    <span className="text-slate-400" title="Private room">🔒</span>
                                  )}
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-cyan-400 font-pixel text-sm">{room.playerCount} 👤</p>
                                <p className="text-slate-500 font-pixel text-xs truncate max-w-[100px]">
                                  {room.players.slice(0, 2).join(', ')}
                                  {room.players.length > 2 && '...'}
                                </p>
                              </div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div> */}
                </div>
              )}
              
              {/* Join selected room button */}
              {selectedRoom && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                    if (!playerName.trim() || isJoining || showPasswordModal) return;
                  playClickSound();
                  const room = rooms.find(r => r.id === selectedRoom);
                  if (room) {
                    handleRoomClick(room);
                  }
                }}
                  disabled={!playerName.trim() || isJoining || showPasswordModal}
                className="w-full mt-4 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 
                           hover:from-cyan-500 hover:to-blue-500
                           disabled:from-slate-700 disabled:to-slate-700 disabled:cursor-not-allowed
                           text-white font-pixel text-sm rounded-lg
                           shadow-lg shadow-cyan-500/30 hover:shadow-cyan-500/50
                           transition-all duration-200
                           flex items-center justify-center gap-2"
              >
                {isJoining ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Joining...
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                    </svg>
                      {(() => {
                        const room = rooms.find(r => r.id === selectedRoom);
                        if (!room) return 'Select a Room';
                        if (room.mapType === 'casino') {
                          const baseRoomId = room.id.replace(/^casino-/, '');
                          const displayName = baseRoomId === 'eu-1' ? 'EU 1' : baseRoomId === 'eu-2' ? 'EU 2' : baseRoomId === 'eu-3' ? 'EU 3' : baseRoomId.toUpperCase();
                          return `Join Casino ${displayName}`;
                        } else if (room.mapType === 'millionaires_lounge') {
                          const baseRoomId = room.id.replace(/^millionaires_lounge-/, '');
                          const displayName = baseRoomId === 'eu-1' ? 'EU 1' : baseRoomId === 'eu-2' ? 'EU 2' : baseRoomId === 'eu-3' ? 'EU 3' : baseRoomId.toUpperCase();
                          return `Join Millionaire's Lounge ${displayName}`;
                        } else {
                          const displayName = room.id === 'eu-1' ? 'EU 1' : room.id === 'eu-2' ? 'EU 2' : room.id === 'eu-3' ? 'EU 3' : room.id.toUpperCase();
                          const roomTypeName = room.mapType === 'forest' ? 'Plaza' : room.mapType === 'market' ? 'Market' : room.mapType === 'cafe' ? 'Cafe' : room.mapType;
                          return `Join ${roomTypeName} ${displayName}`;
                        }
                      })()}
                  </>
                )}
              </button>
              )}
            </div>
          ) : null}
        </div>
        
        {/* Features */}
        <div className="mt-6 grid grid-cols-3 gap-3">
          <div className="bg-slate-900/50 rounded-lg p-3 text-center border border-slate-800">
            <div className="text-2xl mb-1">🚶</div>
            <p className="text-slate-400 text-xs font-pixel">Walk Around</p>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3 text-center border border-slate-800">
            <div className="text-2xl mb-1">💬</div>
            <p className="text-slate-400 text-xs font-pixel">Chat</p>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3 text-center border border-slate-800">
            <div className="text-2xl mb-1">🔮</div>
            <p className="text-slate-400 text-xs font-pixel">Collect Orbs</p>
          </div>
        </div>
      </div>
      
      {/* Password Prompt Modal */}
      {showPasswordModal && roomToJoin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-900 rounded-xl border border-slate-700 p-6 max-w-md w-full mx-4 shadow-2xl">
            <h3 className="text-slate-200 font-pixel text-lg mb-2">Private Room</h3>
            <p className="text-slate-400 font-pixel text-xs mb-4">
              Enter password to join <span className="text-cyan-400">{roomToJoin.id}</span>
            </p>
            
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => {
                setPasswordInput(e.target.value);
                setPasswordError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handlePasswordSubmit();
                }
              }}
              placeholder="Password"
              autoFocus
              className="w-full bg-slate-800 text-slate-100 rounded-lg px-4 py-3 text-sm 
                         placeholder-slate-500 border border-slate-600
                         focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent
                         font-pixel mb-2"
            />
            
            {passwordError && (
              <p className="text-red-400 font-pixel text-xs mb-4">{passwordError}</p>
            )}
            
            <div className="flex gap-2">
              <button
                onClick={handlePasswordSubmit}
                disabled={!passwordInput.trim() || isJoining}
                className="flex-1 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 
                           hover:from-cyan-500 hover:to-blue-500
                           disabled:from-slate-700 disabled:to-slate-700 disabled:cursor-not-allowed
                           text-white font-pixel text-sm rounded-lg
                           transition-all duration-200 flex items-center justify-center gap-2"
              >
                {isJoining ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Joining...
                  </>
                ) : (
                  'Join'
                )}
              </button>
              <button
                onClick={() => {
                  playClickSound();
                  setShowPasswordModal(false);
                  setRoomToJoin(null);
                  setPasswordInput('');
                  setPasswordError('');
                }}
                className="px-4 py-2 bg-slate-800 text-slate-400 hover:text-slate-200 
                           font-pixel text-sm rounded-lg border border-slate-700
                           transition-all duration-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
