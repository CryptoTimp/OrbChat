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

// Play the log received sound (when cutting completes)
export const playLogReceivedSound = () => {
  const state = useGameStore.getState();
  if (state.sfxEnabled) {
    const sound = new Audio('/knife-and-cutting-board-foley-3-184692.mp3');
    sound.volume = state.sfxVolume / 100;
    sound.play().catch((err) => {
      console.error('Failed to play log received sound:', err);
    });
    console.log('Playing log received sound, volume:', state.sfxVolume / 100, 'enabled:', state.sfxEnabled);
  } else {
    console.log('Log received sound disabled - sfxEnabled:', state.sfxEnabled);
  }
};

// Play the chopping tree sound (every hit)
export const playChoppingSound = () => {
  const state = useGameStore.getState();
  if (state.sfxEnabled) {
    const sound = new Audio('/chopping-tree-root-212654.mp3');
    sound.volume = state.sfxVolume / 100;
    sound.play().catch((err) => {
      console.error('Failed to play chopping sound:', err);
    });
    console.log('Playing chopping sound, volume:', state.sfxVolume / 100, 'enabled:', state.sfxEnabled);
  } else {
    console.log('Chopping sound disabled - sfxEnabled:', state.sfxEnabled);
  }
};

// Play the level-up sound for rare/epic/legendary case rewards
export const playLevelUpSound = () => {
  const state = useGameStore.getState();
  if (state.sfxEnabled) {
    const sound = new Audio('/level-up-08-402152.mp3');
    sound.volume = state.sfxVolume / 100;
    sound.play().catch((err) => {
      console.error('Failed to play level-up sound:', err);
    });
  }
};

// Play the bonus trigger sound for slot machine bonus games
export const playBonusTriggerSound = () => {
  const state = useGameStore.getState();
  if (state.sfxEnabled) {
    const sound = new Audio('/level-up-retro-video-game-438908.mp3');
    sound.volume = state.sfxVolume / 100;
    sound.play().catch((err) => {
      console.error('Failed to play bonus trigger sound:', err);
    });
  }
};

// Play the sell item sound
export const playSellSound = () => {
  const state = useGameStore.getState();
  if (state.sfxEnabled) {
    const sound = new Audio('/click-sound-432501.mp3');
    sound.volume = state.sfxVolume / 100;
    sound.play().catch(() => {});
  }
};

// Play the treasure chest opening sound
export const playChestOpenSound = () => {
  const state = useGameStore.getState();
  if (state.sfxEnabled) {
    const sound = new Audio('/chest-stones-shake-46877.mp3');
    sound.volume = state.sfxVolume / 100;
    sound.play().catch(() => {});
  }
};

// Play the treasure chest reward sound (coins found)
export const playChestRewardSound = () => {
  const state = useGameStore.getState();
  if (state.sfxEnabled) {
    const sound = new Audio('/level-up-08-402152.mp3');
    sound.volume = state.sfxVolume / 100;
    sound.play().catch(() => {});
  }
};

// Play the treasure chest empty sound (no reward)
export const playChestEmptySound = () => {
  const state = useGameStore.getState();
  if (state.sfxEnabled) {
    const sound = new Audio('/classic-game-action-negative-8-224414.mp3');
    sound.volume = state.sfxVolume / 100;
    sound.play().catch(() => {});
  }
};

// Play the portal sound (when entering casino or return portal)
export const playPortalSound = () => {
  const state = useGameStore.getState();
  if (state.sfxEnabled) {
    const sound = new Audio('/sci-fi-portal-jump-02-416162.mp3');
    sound.volume = state.sfxVolume / 100;
    sound.play().catch(() => {});
  }
};

// Play the blackjack loss sound
export const playBlackjackLossSound = () => {
  const state = useGameStore.getState();
  if (state.sfxEnabled) {
    const sound = new Audio('/classic-game-action-negative-8-224414.mp3');
    sound.volume = state.sfxVolume / 100;
    sound.play().catch(() => {});
  }
};

// Play the bonus symbol sound with pitch control (pitch increases with count: 1.0, 1.15, 1.3 for 1, 2, 3 bonus symbols)
export const playBonusSymbolSound = (bonusCount: number) => {
  const state = useGameStore.getState();
  if (state.sfxEnabled) {
    // Calculate pitch: 1.0 for 1 bonus, 1.15 for 2, 1.3 for 3
    const pitch = 1.0 + (bonusCount - 1) * 0.15;
    
    // Use Web Audio API to control pitch
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    fetch('/level-up-289723.mp3')
      .then(response => response.arrayBuffer())
      .then(arrayBuffer => audioContext.decodeAudioData(arrayBuffer))
      .then(audioBuffer => {
        const source = audioContext.createBufferSource();
        const gainNode = audioContext.createGain();
        
        source.buffer = audioBuffer;
        source.playbackRate.value = pitch; // Control pitch via playback rate
        gainNode.gain.value = state.sfxVolume / 100;
        
        source.connect(gainNode);
        gainNode.connect(audioContext.destination);
        source.start(0);
      })
      .catch(() => {});
  }
};
