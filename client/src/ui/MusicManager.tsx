import { useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../state/gameStore';

// Automatically import all MP3 files from the soundtracks folder (excluding casino subfolder)
// This pattern excludes files in subdirectories like casino/
const soundtrackModules = import.meta.glob('/public/soundtracks/*.mp3', { eager: true, query: '?url', import: 'default' });

// Automatically import all MP3 files from the casino soundtracks folder
// IMPORTANT: Files must be in client/public/soundtracks/casino/ for this to work
// Vite's import.meta.glob only works at build time, so files must exist in public/ during build
// They will be automatically copied to dist/soundtracks/casino/ during the build process
const casinoSoundtrackModules = import.meta.glob('/public/soundtracks/casino/*.mp3', { eager: true, query: '?url', import: 'default' });

// Extract the URLs from the glob imports
const SOUNDTRACKS: string[] = Object.keys(soundtrackModules).map(path => {
  // Convert /public/soundtracks/file.mp3 to /soundtracks/file.mp3
  return path.replace('/public', '');
});

// Extract casino soundtrack URLs
// The glob pattern should match files in public/soundtracks/casino/ at build time
const CASINO_SOUNDTRACKS: string[] = Object.keys(casinoSoundtrackModules).map(path => {
  // Convert /public/soundtracks/casino/file.mp3 to /soundtracks/casino/file.mp3
  return path.replace('/public', '');
});

console.log('Loaded soundtracks:', SOUNDTRACKS);
console.log('Loaded casino soundtracks:', CASINO_SOUNDTRACKS);
console.log('Casino soundtrack modules keys:', Object.keys(casinoSoundtrackModules));
console.log('Casino soundtrack modules:', casinoSoundtrackModules);

// Warn if casino folder doesn't exist
if (CASINO_SOUNDTRACKS.length === 0) {
  console.warn('⚠️ No casino soundtracks found in /public/soundtracks/casino/.');
  console.warn('⚠️ To fix: Place MP3 files in client/public/soundtracks/casino/ and rebuild.');
  console.warn('⚠️ Casino map will fall back to regular soundtracks until casino tracks are added.');
}

// Singleton audio instance to prevent duplicates
let globalAudio: HTMLAudioElement | null = null;
let currentTrackIndex: number = -1;
let shuffledPlaylist: string[] = [];
let isInRoom: boolean = false;

// Music is background, so scale it down relative to SFX
const MUSIC_VOLUME_SCALE = 0.3;

// Shuffle array using Fisher-Yates algorithm
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Initialize or reshuffle playlist based on map type
function initializePlaylist(mapType: string) {
  let tracks: string[];
  if (mapType === 'casino') {
    // Use casino tracks if available, otherwise fall back to regular tracks
    if (CASINO_SOUNDTRACKS.length > 0) {
      tracks = CASINO_SOUNDTRACKS;
      console.log('Using casino soundtracks:', tracks.length, 'tracks');
    } else {
      tracks = SOUNDTRACKS;
      console.warn('No casino soundtracks found, falling back to regular soundtracks:', tracks.length, 'tracks');
    }
  } else {
    tracks = SOUNDTRACKS;
    console.log('Using regular soundtracks:', tracks.length, 'tracks');
  }
  
  if (tracks.length === 0) {
    console.error('No soundtracks available for map type:', mapType);
    shuffledPlaylist = [];
    currentTrackIndex = 0;
    return;
  }
  
  shuffledPlaylist = shuffleArray(tracks);
  currentTrackIndex = 0;
  console.log('Initialized playlist for map type:', mapType, 'with', shuffledPlaylist.length, 'tracks');
}

// Get next track (cycles through shuffled playlist, reshuffles when done)
function getNextTrack(mapType: string): string | null {
  if (shuffledPlaylist.length === 0 || currentTrackIndex >= shuffledPlaylist.length) {
    initializePlaylist(mapType);
    // If still empty after reinitializing, return null
    if (shuffledPlaylist.length === 0) {
      return null;
    }
  }
  const track = shuffledPlaylist[currentTrackIndex];
  currentTrackIndex++;
  return track;
}

function stopGlobalAudio() {
  if (globalAudio) {
    globalAudio.pause();
    globalAudio.src = '';
    globalAudio.remove();
    globalAudio = null;
  }
}

export function MusicManager() {
  const roomId = useGameStore(state => state.roomId);
  const mapType = useGameStore(state => state.mapType);
  const musicEnabled = useGameStore(state => state.musicEnabled);
  const musicVolume = useGameStore(state => state.musicVolume);
  
  const interactionHandlerRef = useRef<(() => void) | null>(null);
  const previousMapTypeRef = useRef<string>('');
  
  // Cleanup interaction listeners
  const cleanupListeners = useCallback(() => {
    if (interactionHandlerRef.current) {
      document.removeEventListener('click', interactionHandlerRef.current);
      document.removeEventListener('keydown', interactionHandlerRef.current);
      interactionHandlerRef.current = null;
    }
  }, []);
  
  // Play a specific track
  const playTrack = useCallback((trackUrl: string) => {
    const baseVolume = (useGameStore.getState().musicVolume / 100) * MUSIC_VOLUME_SCALE;
    
    // Reduce all tracks volume by 50% (both casino and regular plaza tracks)
    const volume = baseVolume * 0.5;
    
    // Create new audio instance
    const audio = new Audio(trackUrl);
    audio.loop = false; // Don't loop single track, we'll play next when it ends
    audio.volume = volume;
    
    // When track ends, play next shuffled track
    audio.onended = () => {
      if (isInRoom && useGameStore.getState().musicEnabled) {
        const currentMapType = useGameStore.getState().mapType;
        const nextTrack = getNextTrack(currentMapType);
        if (nextTrack) {
          playTrack(nextTrack);
        }
      }
    };
    
    globalAudio = audio;
    
    // Try to play
    audio.play().catch(err => {
      console.log('Music autoplay blocked, waiting for interaction:', err.message);
    });
  }, []);
  
  // Handle music playback based on room state and map type
  useEffect(() => {
    const wasInRoom = isInRoom;
    isInRoom = !!roomId;
    const mapChanged = previousMapTypeRef.current !== mapType;
    
    // If we left the room, stop music
    if (!roomId) {
      stopGlobalAudio();
      cleanupListeners();
      previousMapTypeRef.current = '';
      return;
    }
    
    // If map changed or we just joined a room, reinitialize playlist
    if ((!wasInRoom && roomId) || (wasInRoom && mapChanged)) {
      stopGlobalAudio();
      cleanupListeners();
      
      // Initialize fresh shuffled playlist based on current map type
      initializePlaylist(mapType);
      previousMapTypeRef.current = mapType;
      
      if (!musicEnabled) {
        return;
      }
      
      // Check if we have tracks available
      if (shuffledPlaylist.length === 0) {
        console.warn('No tracks available for map type:', mapType);
        return;
      }
      
      // Start playing first random track
      const firstTrack = getNextTrack(mapType);
      if (firstTrack) {
        playTrack(firstTrack);
      } else {
        console.error('Failed to get track for map type:', mapType);
      }
      
      // Setup interaction handler for autoplay policy
      const handleInteraction = () => {
        if (globalAudio && globalAudio.paused && useGameStore.getState().musicEnabled) {
          globalAudio.play().catch(() => {});
        }
        cleanupListeners();
      };
      
      interactionHandlerRef.current = handleInteraction;
      document.addEventListener('click', handleInteraction, { once: true });
      document.addEventListener('keydown', handleInteraction, { once: true });
    }
    
    // Cleanup on unmount
    return () => {
      cleanupListeners();
    };
  }, [roomId, mapType, musicEnabled, cleanupListeners, playTrack]);
  
  // Handle volume changes separately
  useEffect(() => {
    if (globalAudio) {
      const baseVolume = (musicVolume / 100) * MUSIC_VOLUME_SCALE;
      // Reduce all tracks volume by 50% (both casino and regular plaza tracks)
      globalAudio.volume = baseVolume * 0.5;
    }
  }, [musicVolume, mapType]);
  
  // Handle music enable/disable toggle
  useEffect(() => {
    if (!globalAudio) return;
    
    if (musicEnabled) {
      globalAudio.play().catch(() => {});
    } else {
      globalAudio.pause();
    }
  }, [musicEnabled]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopGlobalAudio();
      cleanupListeners();
      isInRoom = false;
    };
  }, [cleanupListeners]);
  
  return null;
}
