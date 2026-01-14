import { useGameStore } from '../state/gameStore';

// Play a generic click sound for UI interactions
export const playClickSound = () => {
  const state = useGameStore.getState();
  if (state.sfxEnabled) {
    const sound = new Audio('/click-sound-432501.mp3');
    sound.volume = state.sfxVolume / 100;
    sound.play().catch(() => {});
  }
};

// Play a pitched-down click sound for closing menus
export const playCloseSound = () => {
  const state = useGameStore.getState();
  if (state.sfxEnabled) {
    // Use Web Audio API to pitch down the click sound
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    fetch('/click-sound-432501.mp3')
      .then(response => response.arrayBuffer())
      .then(arrayBuffer => audioContext.decodeAudioData(arrayBuffer))
      .then(audioBuffer => {
        const source = audioContext.createBufferSource();
        const gainNode = audioContext.createGain();
        
        source.buffer = audioBuffer;
        source.playbackRate.value = 0.7; // Pitch down by reducing playback rate
        gainNode.gain.value = state.sfxVolume / 100;
        
        source.connect(gainNode);
        gainNode.connect(audioContext.destination);
        source.start(0);
      })
      .catch(() => {});
  }
};

// Play the shop entrance bell sound
export const playShopBellSound = () => {
  const state = useGameStore.getState();
  if (state.sfxEnabled) {
    const sound = new Audio('/store-entrance-bell-188054.mp3');
    sound.volume = state.sfxVolume / 100;
    sound.play().catch(() => {});
  }
};

// Play the inventory/bag open sound
export const playInventoryOpenSound = () => {
  const state = useGameStore.getState();
  if (state.sfxEnabled) {
    const sound = new Audio('/inventory-open-94932.mp3');
    sound.volume = state.sfxVolume / 100;
    sound.play().catch(() => {});
  }
};

// Play the purchase success sound
export const playPurchaseSound = () => {
  const state = useGameStore.getState();
  if (state.sfxEnabled) {
    const sound = new Audio('/purchase-success-384963.mp3');
    sound.volume = state.sfxVolume / 100;
    sound.play().catch(() => {});
  }
};

// Play the equip item sound
export const playEquipSound = () => {
  const state = useGameStore.getState();
  if (state.sfxEnabled) {
    const sound = new Audio('/equip-sound-272428.mp3');
    sound.volume = state.sfxVolume / 100;
    sound.play().catch(() => {});
  }
};

// Play the orb pickup sound (scaled down 50%)
export const playPickupSound = () => {
  const state = useGameStore.getState();
  if (state.sfxEnabled) {
    const sound = new Audio('/pickup-278300.mp3');
    sound.volume = (state.sfxVolume / 100) * 0.5;
    sound.play().catch(() => {});
  }
};

// Play the orb collection bubble pop sound
export const playOrbCollectionSound = () => {
  const state = useGameStore.getState();
  if (state.sfxEnabled) {
    const sound = new Audio('/bubblepop-254773.mp3');
    sound.volume = state.sfxVolume / 100;
    sound.play().catch(() => {});
  }
};

// Play the shrine rejection sound
export const playShrineRejectionSound = () => {
  const state = useGameStore.getState();
  if (state.sfxEnabled) {
    const sound = new Audio('/classic-game-action-negative-8-224414.mp3');
    sound.volume = state.sfxVolume / 100;
    sound.play().catch(() => {});
  }
};

// Play the shrine reward sound
export const playShrineRewardSound = () => {
  const state = useGameStore.getState();
  if (state.sfxEnabled) {
    const sound = new Audio('/awesome-level-up-351714.mp3');
    sound.volume = state.sfxVolume / 100;
    sound.play().catch(() => {});
  }
};

// Play the buy orbs / level up sound
export const playBuyOrbsSound = () => {
  const state = useGameStore.getState();
  if (state.sfxEnabled) {
    const sound = new Audio('/awesome-level-up-351714.mp3');
    sound.volume = state.sfxVolume / 100;
    sound.play().catch(() => {});
  }
};
