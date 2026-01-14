import * as fs from 'fs';
import * as path from 'path';

// Simple JSON file-based persistence (no native dependencies needed)
const DATA_FILE = path.join(__dirname, '..', 'data.json');

export interface PlayerData {
  id: string;
  name: string;
  orbs: number;
  sprite_body: string;
  sprite_outfit: string;
  created_at: string;
  last_seen: string;
}

export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface ShopItemData {
  id: string;
  name: string;
  price: number;
  sprite_layer: string;
  sprite_path: string;
  rarity: ItemRarity;
  speed_multiplier?: number; // For speed boost items
  orb_multiplier?: number; // For orb boost items: 1.0 = normal, 2.5 = 150% more orbs
  trail_color?: string; // Particle trail color for boosts
}

export interface InventoryData {
  player_id: string;
  item_id: string;
  equipped: boolean;
  purchased_at: string;
}

interface DatabaseData {
  players: Record<string, PlayerData>;
  shop_items: Record<string, ShopItemData>;
  inventory: InventoryData[];
}

let data: DatabaseData = {
  players: {},
  shop_items: {},
  inventory: [],
};

function loadData(): void {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      data = JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error loading data:', err);
  }
}

function saveData(): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error saving data:', err);
  }
}

// Initialize database
export function initializeDatabase(): void {
  loadData();
  
  // Seed shop items if empty
  if (Object.keys(data.shop_items).length === 0) {
    seedShopItems();
  } else {
    // Migration: Add leg items if they don't exist
    migrateAddLegItems();
    // Migration: Add cape items
    migrateAddCapeItems();
    // Migration: Add legendary set items
    migrateAddLegendarySetItems();
    // Migration: Add orb boost items
    migrateAddOrbBoostItems();
    // Migration: Update orb boost multipliers
    migrateUpdateOrbBoostMultipliers();
    // Migration: Move wings from accessory to wings layer
    migrateWingsToSeparateLayer();
    // Migration: Update prices to new economy
    migrateUpdatePrices();
  }
  
  console.log('Database initialized');
}

// Migration: Add legendary set items (hats, shirts, legs)
function migrateAddLegendarySetItems(): void {
  const legendaryItems: ShopItemData[] = [
    // Legendary Hats
    { id: 'hat_golden', name: 'Golden Crown', price: 255000, sprite_layer: 'hat', sprite_path: '/sprites/hat_golden.png', rarity: 'legendary' },
    { id: 'hat_phoenix_legendary', name: 'Phoenix Crown', price: 285000, sprite_layer: 'hat', sprite_path: '/sprites/hat_phoenix_legendary.png', rarity: 'legendary' },
    { id: 'hat_void', name: 'Void Helm', price: 330000, sprite_layer: 'hat', sprite_path: '/sprites/hat_void.png', rarity: 'legendary' },
    { id: 'hat_celestial', name: 'Celestial Halo', price: 450000, sprite_layer: 'hat', sprite_path: '/sprites/hat_celestial.png', rarity: 'legendary' },
    { id: 'hat_galaxy', name: 'Galaxy Crown', price: 600000, sprite_layer: 'hat', sprite_path: '/sprites/hat_galaxy.png', rarity: 'legendary' },
    { id: 'hat_rainbow', name: 'Prismatic Crown', price: 540000, sprite_layer: 'hat', sprite_path: '/sprites/hat_rainbow.png', rarity: 'legendary' },
    
    // Epic Hats (missing)
    { id: 'hat_demon', name: 'Demon Crown', price: 48000, sprite_layer: 'hat', sprite_path: '/sprites/hat_demon.png', rarity: 'epic' },
    
    // Legendary Shirts - 200% price increase
    { id: 'armor_golden', name: 'Golden Plate Armor', price: 270000, sprite_layer: 'shirt', sprite_path: '/sprites/armor_golden.png', rarity: 'legendary' },
    { id: 'robe_phoenix_legendary', name: 'Phoenix Vestments', price: 300000, sprite_layer: 'shirt', sprite_path: '/sprites/robe_phoenix_legendary.png', rarity: 'legendary' },
    { id: 'armor_void', name: 'Void Armor', price: 345000, sprite_layer: 'shirt', sprite_path: '/sprites/armor_void.png', rarity: 'legendary' },
    { id: 'robe_celestial', name: 'Celestial Robes', price: 465000, sprite_layer: 'shirt', sprite_path: '/sprites/robe_celestial.png', rarity: 'legendary' },
    { id: 'armor_galaxy', name: 'Galactic Armor', price: 630000, sprite_layer: 'shirt', sprite_path: '/sprites/armor_galaxy.png', rarity: 'legendary' },
    { id: 'robe_rainbow', name: 'Prismatic Robes', price: 555000, sprite_layer: 'shirt', sprite_path: '/sprites/robe_rainbow.png', rarity: 'legendary' },
    
    // Epic Shirts (missing)
    { id: 'robe_phoenix', name: 'Phoenix Robe', price: 48000, sprite_layer: 'shirt', sprite_path: '/sprites/robe_phoenix.png', rarity: 'epic' },
    
    // Legendary Legs - 200% price increase
    { id: 'legs_phoenix_legendary', name: 'Phoenix Greaves', price: 285000, sprite_layer: 'legs', sprite_path: '/sprites/legs_phoenix_legendary.png', rarity: 'legendary' },
    { id: 'legs_void', name: 'Void Leggings', price: 315000, sprite_layer: 'legs', sprite_path: '/sprites/legs_void.png', rarity: 'legendary' },
    { id: 'legs_celestial', name: 'Celestial Pants', price: 435000, sprite_layer: 'legs', sprite_path: '/sprites/legs_celestial.png', rarity: 'legendary' },
    { id: 'legs_galaxy', name: 'Galactic Leggings', price: 585000, sprite_layer: 'legs', sprite_path: '/sprites/legs_galaxy.png', rarity: 'legendary' },
    { id: 'legs_rainbow', name: 'Prismatic Pants', price: 525000, sprite_layer: 'legs', sprite_path: '/sprites/legs_rainbow.png', rarity: 'legendary' },
    
    // Legendary Accessories (matching each set) - 200% price increase
    { id: 'acc_aura_golden', name: 'Golden Aura', price: 264000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_aura_golden.png', rarity: 'legendary' },
    { id: 'acc_aura_phoenix', name: 'Phoenix Aura', price: 294000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_aura_phoenix.png', rarity: 'legendary' },
    { id: 'acc_aura_void', name: 'Void Aura', price: 324000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_aura_void.png', rarity: 'legendary' },
    { id: 'acc_aura_celestial', name: 'Celestial Aura', price: 444000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_aura_celestial.png', rarity: 'legendary' },
    { id: 'acc_aura_galaxy', name: 'Galactic Aura', price: 594000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_aura_galaxy.png', rarity: 'legendary' },
    { id: 'acc_aura_rainbow', name: 'Prismatic Aura', price: 534000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_aura_rainbow.png', rarity: 'legendary' },
    
    // Legendary Wings (matching each legendary set) - 200% price increase
    { id: 'acc_wings_golden', name: 'Golden Wings', price: 276000, sprite_layer: 'wings', sprite_path: '/sprites/acc_wings_golden.png', rarity: 'legendary' },
    { id: 'acc_wings_phoenix', name: 'Phoenix Wings', price: 306000, sprite_layer: 'wings', sprite_path: '/sprites/acc_wings_phoenix.png', rarity: 'legendary' },
    { id: 'acc_wings_void', name: 'Void Wings', price: 336000, sprite_layer: 'wings', sprite_path: '/sprites/acc_wings_void.png', rarity: 'legendary' },
    { id: 'acc_wings_celestial', name: 'Celestial Wings', price: 456000, sprite_layer: 'wings', sprite_path: '/sprites/acc_wings_celestial.png', rarity: 'legendary' },
    { id: 'acc_wings_galaxy', name: 'Galactic Wings', price: 606000, sprite_layer: 'wings', sprite_path: '/sprites/acc_wings_galaxy.png', rarity: 'legendary' },
    { id: 'acc_wings_rainbow', name: 'Prismatic Wings', price: 546000, sprite_layer: 'wings', sprite_path: '/sprites/acc_wings_rainbow.png', rarity: 'legendary' },
    
    // Legendary Dual Weapons (matching each legendary set) - 200% price increase
    { id: 'acc_weapon_golden', name: 'Golden Dual Blades', price: 270000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_weapon_golden.png', rarity: 'legendary' },
    { id: 'acc_weapon_phoenix', name: 'Phoenix Dual Flames', price: 300000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_weapon_phoenix.png', rarity: 'legendary' },
    { id: 'acc_weapon_void', name: 'Void Dual Scythes', price: 330000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_weapon_void.png', rarity: 'legendary' },
    { id: 'acc_weapon_celestial', name: 'Celestial Dual Orbs', price: 450000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_weapon_celestial.png', rarity: 'legendary' },
    { id: 'acc_weapon_galaxy', name: 'Galactic Dual Blades', price: 600000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_weapon_galaxy.png', rarity: 'legendary' },
    { id: 'acc_weapon_rainbow', name: 'Prismatic Dual Prisms', price: 540000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_weapon_rainbow.png', rarity: 'legendary' },
    
    // Legendary Pets (matching each legendary set) - 200% price increase
    { id: 'pet_golden', name: 'Golden Dragon', price: 750000, sprite_layer: 'pet', sprite_path: '/sprites/pet_golden.png', rarity: 'legendary' },
    { id: 'pet_phoenix', name: 'Phoenix Companion', price: 840000, sprite_layer: 'pet', sprite_path: '/sprites/pet_phoenix.png', rarity: 'legendary' },
    { id: 'pet_void', name: 'Void Shadow', price: 900000, sprite_layer: 'pet', sprite_path: '/sprites/pet_void.png', rarity: 'legendary' },
    { id: 'pet_celestial', name: 'Celestial Star', price: 1050000, sprite_layer: 'pet', sprite_path: '/sprites/pet_celestial.png', rarity: 'legendary' },
    { id: 'pet_galaxy', name: 'Galactic Nebula', price: 1200000, sprite_layer: 'pet', sprite_path: '/sprites/pet_galaxy.png', rarity: 'legendary' },
    { id: 'pet_rainbow', name: 'Prismatic Spirit', price: 1140000, sprite_layer: 'pet', sprite_path: '/sprites/pet_rainbow.png', rarity: 'legendary' },
    // Epic Pet - Mini Me
    { id: 'pet_mini_me', name: 'Mini Me', price: 500000, sprite_layer: 'pet', sprite_path: '/sprites/pet_mini_me.png', rarity: 'epic' },
  ];
  
  let addedCount = 0;
  for (const item of legendaryItems) {
    if (!data.shop_items[item.id]) {
      data.shop_items[item.id] = item;
      addedCount++;
    }
  }
  
  if (addedCount > 0) {
    saveData();
    console.log(`Migration: Added ${addedCount} legendary set items to shop`);
  }
}

// Price mapping for the new economy (based on rarity)
const ECONOMY_PRICES: Record<string, number> = {
  // HATS - Common
  'hat_beanie': 150, 'hat_cap': 200, 'hat_beret': 250, 'hat_hardhat': 300, 'hat_party': 100,
  // HATS - Uncommon
  'hat_cowboy': 800, 'hat_wizard': 1200, 'hat_chef': 600, 'hat_tophat': 1500, 'hat_pirate': 1000,
  'hat_ninja': 900, 'hat_cat': 750, 'hat_bunny': 750, 'hat_mohawk': 850, 'hat_afro': 950, 'hat_santa': 1200,
  // HATS - Rare
  'hat_halo': 6000, 'hat_horns': 5000, 'hat_tiara': 7500, 'hat_viking': 4500, 'hat_knight': 8000,
  // HATS - Epic
  'hat_crown': 25000, 'hat_astronaut': 35000, 'hat_dragon': 45000, 'hat_phoenix': 50000, 'hat_demon': 48000,
  // HATS - Legendary - 200% price increase
  'hat_golden': 255000, 'hat_phoenix_legendary': 285000, 'hat_void': 330000,
  'hat_celestial': 450000, 'hat_galaxy': 600000, 'hat_rainbow': 540000,
  
  // SHIRTS - Common
  'shirt_red': 100, 'shirt_blue': 100, 'shirt_green': 100, 'shirt_yellow': 100, 'shirt_purple': 100,
  'shirt_pink': 100, 'shirt_black': 150, 'shirt_white': 150, 'shirt_striped': 200,
  // SHIRTS - Uncommon
  'shirt_hoodie': 800, 'shirt_hawaiian': 700, 'robe_wizard': 1500, 'coat_chef': 600, 'coat_lab': 700,
  'coat_pirate': 1200, 'gi_ninja': 1100, 'vest_cowboy': 650, 'tunic_viking': 900,
  'jacket_punk': 1000, 'jacket_leather': 1100,
  // SHIRTS - Rare
  'shirt_tuxedo': 5000, 'robe_dark': 6000, 'dress_princess': 7000, 'robe_angel': 8000,
  'armor_knight': 9000, 'armor_samurai': 9500, 'suit_space': 10000, 'jacket_neon': 7500,
  // SHIRTS - Epic
  'armor_gold': 35000, 'robe_dragon': 40000, 'armor_demon': 45000, 'robe_phoenix': 48000,
  // SHIRTS - Legendary - 200% price increase
  'armor_golden': 270000, 'robe_phoenix_legendary': 300000, 'armor_void': 345000,
  'robe_celestial': 465000, 'armor_galaxy': 630000, 'robe_rainbow': 555000,
  
  // LEGS - Common
  'legs_jeans_blue': 100, 'legs_jeans_black': 100, 'legs_shorts': 80, 'legs_sweatpants': 100,
  // LEGS - Uncommon
  'legs_chef': 500, 'legs_suit': 600, 'legs_lab': 550, 'legs_wizard': 800, 'legs_ninja': 900,
  'legs_pirate': 750, 'legs_viking': 1000, 'legs_cowboy': 700, 'legs_punk': 650,
  // LEGS - Rare
  'legs_knight': 5000, 'legs_samurai': 5500, 'legs_astronaut': 8000, 'legs_neon': 6000,
  'legs_princess': 6500, 'legs_angel': 7000,
  // LEGS - Epic
  'legs_dragon': 30000, 'legs_demon': 35000, 'legs_phoenix': 40000,
  // LEGS - Legendary - 200% price increase
  'legs_gold': 255000, 'legs_phoenix_legendary': 285000, 'legs_void': 315000,
  'legs_celestial': 435000, 'legs_galaxy': 585000, 'legs_rainbow': 525000,
  
  // ACCESSORIES - Common
  'acc_glasses': 200, 'acc_sunglasses': 250, 'acc_eyepatch': 150, 'acc_scarf': 300, 'acc_bowtie': 200,
  // ACCESSORIES - Uncommon
  'acc_monocle': 800, 'acc_mask': 700, 'acc_cybervisor': 1500, 'acc_necklace': 1000,
  'acc_cape_red': 1200, 'acc_cape_black': 1300, 'acc_backpack': 600, 'acc_shield': 1400, 'acc_wand': 900,
  // ACCESSORIES - Rare
  'acc_cape_royal': 8000, 'acc_wings_fairy': 9000, 'acc_sword': 5000, 'acc_staff': 6000, 'acc_guitar': 7000,
  // ACCESSORIES - Epic
  'acc_wings_angel': 25000, 'acc_wings_devil': 25000, 'acc_jetpack': 35000,
  // ACCESSORIES - Legendary - 200% price increase
  'acc_wings_dragon': 300000, 'acc_aura_fire': 375000, 'acc_aura_ice': 375000,
  'acc_aura_golden': 264000, 'acc_aura_phoenix': 294000, 'acc_aura_void': 324000,
  'acc_aura_celestial': 444000, 'acc_aura_galaxy': 594000, 'acc_aura_rainbow': 534000,
  'acc_wings_golden': 276000, 'acc_wings_phoenix': 306000, 'acc_wings_void': 336000,
  'acc_wings_celestial': 456000, 'acc_wings_galaxy': 606000, 'acc_wings_rainbow': 546000,
  'acc_weapon_golden': 270000, 'acc_weapon_phoenix': 300000, 'acc_weapon_void': 330000,
  'acc_weapon_celestial': 450000, 'acc_weapon_galaxy': 600000, 'acc_weapon_rainbow': 540000,
  
  // PETS - Legendary (very expensive) - 200% price increase
  'pet_golden': 750000, 'pet_phoenix': 840000, 'pet_void': 900000,
  'pet_celestial': 1050000, 'pet_galaxy': 1200000, 'pet_rainbow': 1140000,
  
  // CAPES - Common
  'cape_red': 250, 'cape_blue': 250, 'cape_green': 250,
  // CAPES - Uncommon
  'cape_black': 800, 'cape_white': 800, 'cape_purple': 1000, 'cape_ninja': 1500, 'cape_pirate': 1400,
  // CAPES - Rare
  'cape_royal': 6000, 'cape_knight': 7000, 'cape_wizard': 8000, 'cape_vampire': 9000, 'cape_nature': 8500,
  // CAPES - Epic
  'cape_fire': 25000, 'cape_ice': 25000, 'cape_lightning': 30000, 'cape_dragon': 45000,
  // CAPES - Legendary - 200% price increase
  'cape_phoenix': 240000, 'cape_void': 300000, 'cape_celestial': 450000, 'cape_rainbow': 600000, 'cape_galaxy': 750000,
  
  // BOOSTS (Speed) - Legendary items with 200% price increase
  'boost_swift': 2000, 'boost_runner': 8000, 'boost_dash': 25000,
  'boost_lightning': 40000, 'boost_sonic': 240000, 'boost_phantom': 600000,
  // BOOSTS (Orb) - Legendary items with 200% price increase
  'boost_orb_lucky': 3000, 'boost_orb_fortune': 12000, 'boost_orb_wealth': 35000,
  'boost_orb_treasure': 55000, 'boost_orb_platinum': 360000, 'boost_orb_divine': 900000,
};

function migrateUpdatePrices(): void {
  let updatedCount = 0;
  
  for (const [itemId, newPrice] of Object.entries(ECONOMY_PRICES)) {
    const item = data.shop_items[itemId];
    if (item && item.price !== newPrice) {
      item.price = newPrice;
      updatedCount++;
    }
  }
  
  if (updatedCount > 0) {
    saveData();
    console.log(`Migration: Updated prices for ${updatedCount} shop items`);
  }
}

function migrateAddLegItems(): void {
  const legItems: ShopItemData[] = [
    // Basic Legs (Common) - 80-100 orbs
    { id: 'legs_jeans_blue', name: 'Blue Jeans', price: 100, sprite_layer: 'legs', sprite_path: '/sprites/legs_jeans_blue.png', rarity: 'common' },
    { id: 'legs_jeans_black', name: 'Black Jeans', price: 100, sprite_layer: 'legs', sprite_path: '/sprites/legs_jeans_black.png', rarity: 'common' },
    { id: 'legs_shorts', name: 'Casual Shorts', price: 80, sprite_layer: 'legs', sprite_path: '/sprites/legs_shorts.png', rarity: 'common' },
    { id: 'legs_sweatpants', name: 'Comfy Sweats', price: 100, sprite_layer: 'legs', sprite_path: '/sprites/legs_sweatpants.png', rarity: 'common' },
    
    // Professional Legs (Uncommon) - 500-1000 orbs
    { id: 'legs_chef', name: 'Chef Trousers', price: 500, sprite_layer: 'legs', sprite_path: '/sprites/legs_chef.png', rarity: 'uncommon' },
    { id: 'legs_suit', name: 'Suit Pants', price: 600, sprite_layer: 'legs', sprite_path: '/sprites/legs_suit.png', rarity: 'uncommon' },
    { id: 'legs_lab', name: 'Lab Pants', price: 550, sprite_layer: 'legs', sprite_path: '/sprites/legs_lab.png', rarity: 'uncommon' },
    
    // Fantasy/Adventure Legs (Uncommon-Rare) - 700-8000 orbs
    { id: 'legs_wizard', name: 'Wizard Robes', price: 800, sprite_layer: 'legs', sprite_path: '/sprites/legs_wizard.png', rarity: 'uncommon' },
    { id: 'legs_knight', name: 'Knight Greaves', price: 5000, sprite_layer: 'legs', sprite_path: '/sprites/legs_knight.png', rarity: 'rare' },
    { id: 'legs_samurai', name: 'Samurai Hakama', price: 5500, sprite_layer: 'legs', sprite_path: '/sprites/legs_samurai.png', rarity: 'rare' },
    { id: 'legs_ninja', name: 'Ninja Pants', price: 900, sprite_layer: 'legs', sprite_path: '/sprites/legs_ninja.png', rarity: 'uncommon' },
    { id: 'legs_pirate', name: 'Pirate Breeches', price: 750, sprite_layer: 'legs', sprite_path: '/sprites/legs_pirate.png', rarity: 'uncommon' },
    { id: 'legs_viking', name: 'Viking Leggings', price: 1000, sprite_layer: 'legs', sprite_path: '/sprites/legs_viking.png', rarity: 'uncommon' },
    { id: 'legs_cowboy', name: 'Cowboy Chaps', price: 700, sprite_layer: 'legs', sprite_path: '/sprites/legs_cowboy.png', rarity: 'uncommon' },
    { id: 'legs_astronaut', name: 'Space Suit Legs', price: 8000, sprite_layer: 'legs', sprite_path: '/sprites/legs_astronaut.png', rarity: 'rare' },
    
    // Stylish Legs (Uncommon-Rare) - 650-7000 orbs
    { id: 'legs_punk', name: 'Punk Ripped Jeans', price: 650, sprite_layer: 'legs', sprite_path: '/sprites/legs_punk.png', rarity: 'uncommon' },
    { id: 'legs_neon', name: 'Neon Cyber Pants', price: 6000, sprite_layer: 'legs', sprite_path: '/sprites/legs_neon.png', rarity: 'rare' },
    { id: 'legs_princess', name: 'Princess Skirt', price: 6500, sprite_layer: 'legs', sprite_path: '/sprites/legs_princess.png', rarity: 'rare' },
    { id: 'legs_angel', name: 'Angelic Robes', price: 7000, sprite_layer: 'legs', sprite_path: '/sprites/legs_angel.png', rarity: 'rare' },
    
    // Premium Legs (Epic-Legendary) - 30000-85000 orbs
    { id: 'legs_dragon', name: 'Dragon Leg Armor', price: 30000, sprite_layer: 'legs', sprite_path: '/sprites/legs_dragon.png', rarity: 'epic' },
    { id: 'legs_demon', name: 'Demon Greaves', price: 35000, sprite_layer: 'legs', sprite_path: '/sprites/legs_demon.png', rarity: 'epic' },
    { id: 'legs_phoenix', name: 'Phoenix Leggings', price: 40000, sprite_layer: 'legs', sprite_path: '/sprites/legs_phoenix.png', rarity: 'epic' },
    { id: 'legs_gold', name: 'Golden Armor Legs', price: 255000, sprite_layer: 'legs', sprite_path: '/sprites/legs_gold.png', rarity: 'legendary' },
  ];
  
  let addedCount = 0;
  for (const item of legItems) {
    if (!data.shop_items[item.id]) {
      data.shop_items[item.id] = item;
      addedCount++;
    }
  }
  
  if (addedCount > 0) {
    saveData();
    console.log(`Migration: Added ${addedCount} leg items to shop`);
  }
}

function migrateAddCapeItems(): void {
  const capeItems: ShopItemData[] = [
    // Basic Capes (Common) - 200-400 orbs
    { id: 'cape_red', name: 'Red Cape', price: 250, sprite_layer: 'cape', sprite_path: '/sprites/cape_red.png', rarity: 'common' },
    { id: 'cape_blue', name: 'Blue Cape', price: 250, sprite_layer: 'cape', sprite_path: '/sprites/cape_blue.png', rarity: 'common' },
    { id: 'cape_green', name: 'Green Cape', price: 250, sprite_layer: 'cape', sprite_path: '/sprites/cape_green.png', rarity: 'common' },
    
    // Uncommon Capes - 600-2000 orbs
    { id: 'cape_black', name: 'Shadow Cape', price: 800, sprite_layer: 'cape', sprite_path: '/sprites/cape_black.png', rarity: 'uncommon' },
    { id: 'cape_white', name: 'Pure Cape', price: 800, sprite_layer: 'cape', sprite_path: '/sprites/cape_white.png', rarity: 'uncommon' },
    { id: 'cape_purple', name: 'Mystic Cape', price: 1000, sprite_layer: 'cape', sprite_path: '/sprites/cape_purple.png', rarity: 'uncommon' },
    { id: 'cape_ninja', name: 'Ninja Shroud', price: 1500, sprite_layer: 'cape', sprite_path: '/sprites/cape_ninja.png', rarity: 'uncommon' },
    { id: 'cape_pirate', name: 'Captain\'s Cape', price: 1400, sprite_layer: 'cape', sprite_path: '/sprites/cape_pirate.png', rarity: 'uncommon' },
    
    // Rare Capes - 4000-10000 orbs
    { id: 'cape_royal', name: 'Royal Cape', price: 6000, sprite_layer: 'cape', sprite_path: '/sprites/cape_royal.png', rarity: 'rare' },
    { id: 'cape_knight', name: 'Knight\'s Cloak', price: 7000, sprite_layer: 'cape', sprite_path: '/sprites/cape_knight.png', rarity: 'rare' },
    { id: 'cape_wizard', name: 'Wizard\'s Mantle', price: 8000, sprite_layer: 'cape', sprite_path: '/sprites/cape_wizard.png', rarity: 'rare' },
    { id: 'cape_vampire', name: 'Vampire Cloak', price: 9000, sprite_layer: 'cape', sprite_path: '/sprites/cape_vampire.png', rarity: 'rare' },
    { id: 'cape_nature', name: 'Nature\'s Embrace', price: 8500, sprite_layer: 'cape', sprite_path: '/sprites/cape_nature.png', rarity: 'rare' },
    
    // Epic Capes - 20000-50000 orbs
    { id: 'cape_fire', name: 'Flame Cape', price: 25000, sprite_layer: 'cape', sprite_path: '/sprites/cape_fire.png', rarity: 'epic' },
    { id: 'cape_ice', name: 'Frost Cape', price: 25000, sprite_layer: 'cape', sprite_path: '/sprites/cape_ice.png', rarity: 'epic' },
    { id: 'cape_lightning', name: 'Storm Cape', price: 30000, sprite_layer: 'cape', sprite_path: '/sprites/cape_lightning.png', rarity: 'epic' },
    { id: 'cape_dragon', name: 'Dragonscale Cape', price: 45000, sprite_layer: 'cape', sprite_path: '/sprites/cape_dragon.png', rarity: 'epic' },
    
    // Legendary Capes - 75000-250000 orbs - 200% price increase
    { id: 'cape_phoenix', name: 'Phoenix Plume', price: 240000, sprite_layer: 'cape', sprite_path: '/sprites/cape_phoenix.png', rarity: 'legendary' },
    { id: 'cape_void', name: 'Void Shroud', price: 300000, sprite_layer: 'cape', sprite_path: '/sprites/cape_void.png', rarity: 'legendary' },
    { id: 'cape_celestial', name: 'Celestial Mantle', price: 450000, sprite_layer: 'cape', sprite_path: '/sprites/cape_celestial.png', rarity: 'legendary' },
    { id: 'cape_rainbow', name: 'Prismatic Cape', price: 600000, sprite_layer: 'cape', sprite_path: '/sprites/cape_rainbow.png', rarity: 'legendary' },
    { id: 'cape_galaxy', name: 'Galactic Shroud', price: 750000, sprite_layer: 'cape', sprite_path: '/sprites/cape_galaxy.png', rarity: 'legendary' },
  ];
  
  // Remove old accessory capes if they exist (migrate to new cape layer)
  const oldCapeIds = ['acc_cape_red', 'acc_cape_black', 'acc_cape_royal'];
  for (const oldId of oldCapeIds) {
    if (data.shop_items[oldId]) {
      delete data.shop_items[oldId];
    }
  }
  
  let addedCount = 0;
  for (const item of capeItems) {
    if (!data.shop_items[item.id]) {
      data.shop_items[item.id] = item;
      addedCount++;
    }
  }
  
  if (addedCount > 0) {
    saveData();
    console.log(`Migration: Added ${addedCount} cape items to shop`);
  }
}

function seedShopItems(): void {
  const items: ShopItemData[] = [
    // === HATS === (Headwear)
    // Basic (Common) - 100-400 orbs
    { id: 'hat_beanie', name: 'Cozy Beanie', price: 150, sprite_layer: 'hat', sprite_path: '/sprites/hat_beanie.png', rarity: 'common' },
    { id: 'hat_cap', name: 'Baseball Cap', price: 200, sprite_layer: 'hat', sprite_path: '/sprites/hat_cap.png', rarity: 'common' },
    { id: 'hat_beret', name: 'Artist Beret', price: 250, sprite_layer: 'hat', sprite_path: '/sprites/hat_beret.png', rarity: 'common' },
    { id: 'hat_hardhat', name: 'Hard Hat', price: 300, sprite_layer: 'hat', sprite_path: '/sprites/hat_hardhat.png', rarity: 'common' },
    { id: 'hat_party', name: 'Party Hat', price: 100, sprite_layer: 'hat', sprite_path: '/sprites/hat_party.png', rarity: 'common' },
    
    // Uncommon - 500-2000 orbs
    { id: 'hat_cowboy', name: 'Cowboy Hat', price: 800, sprite_layer: 'hat', sprite_path: '/sprites/hat_cowboy.png', rarity: 'uncommon' },
    { id: 'hat_wizard', name: 'Wizard Hat', price: 1200, sprite_layer: 'hat', sprite_path: '/sprites/hat_wizard.png', rarity: 'uncommon' },
    { id: 'hat_chef', name: 'Chef Hat', price: 600, sprite_layer: 'hat', sprite_path: '/sprites/hat_chef.png', rarity: 'uncommon' },
    { id: 'hat_tophat', name: 'Top Hat', price: 1500, sprite_layer: 'hat', sprite_path: '/sprites/hat_tophat.png', rarity: 'uncommon' },
    { id: 'hat_pirate', name: 'Pirate Tricorn', price: 1000, sprite_layer: 'hat', sprite_path: '/sprites/hat_pirate.png', rarity: 'uncommon' },
    { id: 'hat_ninja', name: 'Ninja Headband', price: 900, sprite_layer: 'hat', sprite_path: '/sprites/hat_ninja.png', rarity: 'uncommon' },
    { id: 'hat_cat', name: 'Cat Ears', price: 750, sprite_layer: 'hat', sprite_path: '/sprites/hat_cat.png', rarity: 'uncommon' },
    { id: 'hat_bunny', name: 'Bunny Ears', price: 750, sprite_layer: 'hat', sprite_path: '/sprites/hat_bunny.png', rarity: 'uncommon' },
    { id: 'hat_mohawk', name: 'Punk Mohawk', price: 850, sprite_layer: 'hat', sprite_path: '/sprites/hat_mohawk.png', rarity: 'uncommon' },
    { id: 'hat_afro', name: 'Groovy Afro', price: 950, sprite_layer: 'hat', sprite_path: '/sprites/hat_afro.png', rarity: 'uncommon' },
    { id: 'hat_santa', name: 'Santa Hat', price: 1200, sprite_layer: 'hat', sprite_path: '/sprites/hat_santa.png', rarity: 'uncommon' },
    
    // Rare - 3000-10000 orbs
    { id: 'hat_halo', name: 'Angel Halo', price: 6000, sprite_layer: 'hat', sprite_path: '/sprites/hat_halo.png', rarity: 'rare' },
    { id: 'hat_horns', name: 'Devil Horns', price: 5000, sprite_layer: 'hat', sprite_path: '/sprites/hat_horns.png', rarity: 'rare' },
    { id: 'hat_tiara', name: 'Princess Tiara', price: 7500, sprite_layer: 'hat', sprite_path: '/sprites/hat_tiara.png', rarity: 'rare' },
    { id: 'hat_viking', name: 'Viking Helm', price: 4500, sprite_layer: 'hat', sprite_path: '/sprites/hat_viking.png', rarity: 'rare' },
    { id: 'hat_knight', name: 'Knight Helmet', price: 8000, sprite_layer: 'hat', sprite_path: '/sprites/hat_knight.png', rarity: 'rare' },
    
    // Epic - 15000-50000 orbs
    { id: 'hat_crown', name: 'Royal Crown', price: 25000, sprite_layer: 'hat', sprite_path: '/sprites/hat_crown.png', rarity: 'epic' },
    { id: 'hat_astronaut', name: 'Space Helmet', price: 35000, sprite_layer: 'hat', sprite_path: '/sprites/hat_astronaut.png', rarity: 'epic' },
    { id: 'hat_dragon', name: 'Dragon Helm', price: 45000, sprite_layer: 'hat', sprite_path: '/sprites/hat_dragon.png', rarity: 'epic' },
    { id: 'hat_phoenix', name: 'Phoenix Crest', price: 50000, sprite_layer: 'hat', sprite_path: '/sprites/hat_phoenix.png', rarity: 'epic' },
    { id: 'hat_demon', name: 'Demon Crown', price: 48000, sprite_layer: 'hat', sprite_path: '/sprites/hat_demon.png', rarity: 'epic' },
    
    // Legendary - 75000-250000 orbs (Complete Sets) - 200% price increase
    { id: 'hat_golden', name: 'Golden Crown', price: 255000, sprite_layer: 'hat', sprite_path: '/sprites/hat_golden.png', rarity: 'legendary' },
    { id: 'hat_phoenix_legendary', name: 'Phoenix Crown', price: 285000, sprite_layer: 'hat', sprite_path: '/sprites/hat_phoenix_legendary.png', rarity: 'legendary' },
    { id: 'hat_void', name: 'Void Helm', price: 330000, sprite_layer: 'hat', sprite_path: '/sprites/hat_void.png', rarity: 'legendary' },
    { id: 'hat_celestial', name: 'Celestial Halo', price: 450000, sprite_layer: 'hat', sprite_path: '/sprites/hat_celestial.png', rarity: 'legendary' },
    { id: 'hat_galaxy', name: 'Galaxy Crown', price: 600000, sprite_layer: 'hat', sprite_path: '/sprites/hat_galaxy.png', rarity: 'legendary' },
    { id: 'hat_rainbow', name: 'Prismatic Crown', price: 540000, sprite_layer: 'hat', sprite_path: '/sprites/hat_rainbow.png', rarity: 'legendary' },
    
    // === SHIRTS === (Body/Chest)
    // Basic Colors (Common) - 100-400 orbs
    { id: 'shirt_red', name: 'Red Shirt', price: 100, sprite_layer: 'shirt', sprite_path: '/sprites/shirt_red.png', rarity: 'common' },
    { id: 'shirt_blue', name: 'Blue Shirt', price: 100, sprite_layer: 'shirt', sprite_path: '/sprites/shirt_blue.png', rarity: 'common' },
    { id: 'shirt_green', name: 'Green Shirt', price: 100, sprite_layer: 'shirt', sprite_path: '/sprites/shirt_green.png', rarity: 'common' },
    { id: 'shirt_yellow', name: 'Yellow Shirt', price: 100, sprite_layer: 'shirt', sprite_path: '/sprites/shirt_yellow.png', rarity: 'common' },
    { id: 'shirt_purple', name: 'Purple Shirt', price: 100, sprite_layer: 'shirt', sprite_path: '/sprites/shirt_purple.png', rarity: 'common' },
    { id: 'shirt_pink', name: 'Pink Shirt', price: 100, sprite_layer: 'shirt', sprite_path: '/sprites/shirt_pink.png', rarity: 'common' },
    { id: 'shirt_black', name: 'Black Shirt', price: 150, sprite_layer: 'shirt', sprite_path: '/sprites/shirt_black.png', rarity: 'common' },
    { id: 'shirt_white', name: 'White Shirt', price: 150, sprite_layer: 'shirt', sprite_path: '/sprites/shirt_white.png', rarity: 'common' },
    { id: 'shirt_striped', name: 'Striped Tee', price: 200, sprite_layer: 'shirt', sprite_path: '/sprites/shirt_striped.png', rarity: 'common' },
    
    // Uncommon - 500-2000 orbs
    { id: 'shirt_hoodie', name: 'Cozy Hoodie', price: 800, sprite_layer: 'shirt', sprite_path: '/sprites/shirt_hoodie.png', rarity: 'uncommon' },
    { id: 'shirt_hawaiian', name: 'Hawaiian Shirt', price: 700, sprite_layer: 'shirt', sprite_path: '/sprites/shirt_hawaiian.png', rarity: 'uncommon' },
    { id: 'robe_wizard', name: 'Wizard Robe', price: 1500, sprite_layer: 'shirt', sprite_path: '/sprites/robe_wizard.png', rarity: 'uncommon' },
    { id: 'coat_chef', name: 'Chef Coat', price: 600, sprite_layer: 'shirt', sprite_path: '/sprites/coat_chef.png', rarity: 'uncommon' },
    { id: 'coat_lab', name: 'Lab Coat', price: 700, sprite_layer: 'shirt', sprite_path: '/sprites/coat_lab.png', rarity: 'uncommon' },
    { id: 'coat_pirate', name: 'Pirate Coat', price: 1200, sprite_layer: 'shirt', sprite_path: '/sprites/coat_pirate.png', rarity: 'uncommon' },
    { id: 'gi_ninja', name: 'Ninja Gi', price: 1100, sprite_layer: 'shirt', sprite_path: '/sprites/gi_ninja.png', rarity: 'uncommon' },
    { id: 'vest_cowboy', name: 'Cowboy Vest', price: 650, sprite_layer: 'shirt', sprite_path: '/sprites/vest_cowboy.png', rarity: 'uncommon' },
    { id: 'tunic_viking', name: 'Viking Tunic', price: 900, sprite_layer: 'shirt', sprite_path: '/sprites/tunic_viking.png', rarity: 'uncommon' },
    { id: 'jacket_punk', name: 'Punk Jacket', price: 1000, sprite_layer: 'shirt', sprite_path: '/sprites/jacket_punk.png', rarity: 'uncommon' },
    { id: 'jacket_leather', name: 'Leather Jacket', price: 1100, sprite_layer: 'shirt', sprite_path: '/sprites/jacket_leather.png', rarity: 'uncommon' },
    
    // Rare - 3000-10000 orbs
    { id: 'shirt_tuxedo', name: 'Tuxedo', price: 5000, sprite_layer: 'shirt', sprite_path: '/sprites/shirt_tuxedo.png', rarity: 'rare' },
    { id: 'robe_dark', name: 'Dark Robes', price: 6000, sprite_layer: 'shirt', sprite_path: '/sprites/robe_dark.png', rarity: 'rare' },
    { id: 'dress_princess', name: 'Princess Dress', price: 7000, sprite_layer: 'shirt', sprite_path: '/sprites/dress_princess.png', rarity: 'rare' },
    { id: 'robe_angel', name: 'Angel Robes', price: 8000, sprite_layer: 'shirt', sprite_path: '/sprites/robe_angel.png', rarity: 'rare' },
    { id: 'armor_knight', name: 'Knight Armor', price: 9000, sprite_layer: 'shirt', sprite_path: '/sprites/armor_knight.png', rarity: 'rare' },
    { id: 'armor_samurai', name: 'Samurai Armor', price: 9500, sprite_layer: 'shirt', sprite_path: '/sprites/armor_samurai.png', rarity: 'rare' },
    { id: 'suit_space', name: 'Space Suit', price: 10000, sprite_layer: 'shirt', sprite_path: '/sprites/suit_space.png', rarity: 'rare' },
    { id: 'jacket_neon', name: 'Neon Cyber Jacket', price: 7500, sprite_layer: 'shirt', sprite_path: '/sprites/jacket_neon.png', rarity: 'rare' },
    
    // Epic - 15000-50000 orbs
    { id: 'armor_gold', name: 'Golden Armor', price: 35000, sprite_layer: 'shirt', sprite_path: '/sprites/armor_gold.png', rarity: 'epic' },
    { id: 'robe_dragon', name: 'Dragon Robe', price: 40000, sprite_layer: 'shirt', sprite_path: '/sprites/robe_dragon.png', rarity: 'epic' },
    { id: 'armor_demon', name: 'Demon Armor', price: 45000, sprite_layer: 'shirt', sprite_path: '/sprites/armor_demon.png', rarity: 'epic' },
    { id: 'robe_phoenix', name: 'Phoenix Robe', price: 48000, sprite_layer: 'shirt', sprite_path: '/sprites/robe_phoenix.png', rarity: 'epic' },
    
    // Legendary - 75000-250000 orbs (Complete Sets) - 200% price increase
    { id: 'armor_golden', name: 'Golden Plate Armor', price: 270000, sprite_layer: 'shirt', sprite_path: '/sprites/armor_golden.png', rarity: 'legendary' },
    { id: 'robe_phoenix_legendary', name: 'Phoenix Vestments', price: 300000, sprite_layer: 'shirt', sprite_path: '/sprites/robe_phoenix_legendary.png', rarity: 'legendary' },
    { id: 'armor_void', name: 'Void Armor', price: 345000, sprite_layer: 'shirt', sprite_path: '/sprites/armor_void.png', rarity: 'legendary' },
    { id: 'robe_celestial', name: 'Celestial Robes', price: 465000, sprite_layer: 'shirt', sprite_path: '/sprites/robe_celestial.png', rarity: 'legendary' },
    { id: 'armor_galaxy', name: 'Galactic Armor', price: 630000, sprite_layer: 'shirt', sprite_path: '/sprites/armor_galaxy.png', rarity: 'legendary' },
    { id: 'robe_rainbow', name: 'Prismatic Robes', price: 555000, sprite_layer: 'shirt', sprite_path: '/sprites/robe_rainbow.png', rarity: 'legendary' },
    
    // === LEGS === (Pants/Trousers)
    // Basic (Common) - 100-400 orbs
    { id: 'legs_jeans_blue', name: 'Blue Jeans', price: 100, sprite_layer: 'legs', sprite_path: '/sprites/legs_jeans_blue.png', rarity: 'common' },
    { id: 'legs_jeans_black', name: 'Black Jeans', price: 100, sprite_layer: 'legs', sprite_path: '/sprites/legs_jeans_black.png', rarity: 'common' },
    { id: 'legs_shorts', name: 'Casual Shorts', price: 80, sprite_layer: 'legs', sprite_path: '/sprites/legs_shorts.png', rarity: 'common' },
    { id: 'legs_sweatpants', name: 'Comfy Sweats', price: 100, sprite_layer: 'legs', sprite_path: '/sprites/legs_sweatpants.png', rarity: 'common' },
    
    // Uncommon - 500-2000 orbs
    { id: 'legs_chef', name: 'Chef Trousers', price: 500, sprite_layer: 'legs', sprite_path: '/sprites/legs_chef.png', rarity: 'uncommon' },
    { id: 'legs_suit', name: 'Suit Pants', price: 600, sprite_layer: 'legs', sprite_path: '/sprites/legs_suit.png', rarity: 'uncommon' },
    { id: 'legs_lab', name: 'Lab Pants', price: 550, sprite_layer: 'legs', sprite_path: '/sprites/legs_lab.png', rarity: 'uncommon' },
    { id: 'legs_wizard', name: 'Wizard Robes', price: 800, sprite_layer: 'legs', sprite_path: '/sprites/legs_wizard.png', rarity: 'uncommon' },
    { id: 'legs_ninja', name: 'Ninja Pants', price: 900, sprite_layer: 'legs', sprite_path: '/sprites/legs_ninja.png', rarity: 'uncommon' },
    { id: 'legs_pirate', name: 'Pirate Breeches', price: 750, sprite_layer: 'legs', sprite_path: '/sprites/legs_pirate.png', rarity: 'uncommon' },
    { id: 'legs_viking', name: 'Viking Leggings', price: 1000, sprite_layer: 'legs', sprite_path: '/sprites/legs_viking.png', rarity: 'uncommon' },
    { id: 'legs_cowboy', name: 'Cowboy Chaps', price: 700, sprite_layer: 'legs', sprite_path: '/sprites/legs_cowboy.png', rarity: 'uncommon' },
    { id: 'legs_punk', name: 'Punk Ripped Jeans', price: 650, sprite_layer: 'legs', sprite_path: '/sprites/legs_punk.png', rarity: 'uncommon' },
    
    // Rare - 3000-10000 orbs
    { id: 'legs_knight', name: 'Knight Greaves', price: 5000, sprite_layer: 'legs', sprite_path: '/sprites/legs_knight.png', rarity: 'rare' },
    { id: 'legs_samurai', name: 'Samurai Hakama', price: 5500, sprite_layer: 'legs', sprite_path: '/sprites/legs_samurai.png', rarity: 'rare' },
    { id: 'legs_astronaut', name: 'Space Suit Legs', price: 8000, sprite_layer: 'legs', sprite_path: '/sprites/legs_astronaut.png', rarity: 'rare' },
    { id: 'legs_neon', name: 'Neon Cyber Pants', price: 6000, sprite_layer: 'legs', sprite_path: '/sprites/legs_neon.png', rarity: 'rare' },
    { id: 'legs_princess', name: 'Princess Skirt', price: 6500, sprite_layer: 'legs', sprite_path: '/sprites/legs_princess.png', rarity: 'rare' },
    { id: 'legs_angel', name: 'Angelic Robes', price: 7000, sprite_layer: 'legs', sprite_path: '/sprites/legs_angel.png', rarity: 'rare' },
    
    // Epic - 15000-50000 orbs
    { id: 'legs_dragon', name: 'Dragon Leg Armor', price: 30000, sprite_layer: 'legs', sprite_path: '/sprites/legs_dragon.png', rarity: 'epic' },
    { id: 'legs_demon', name: 'Demon Greaves', price: 35000, sprite_layer: 'legs', sprite_path: '/sprites/legs_demon.png', rarity: 'epic' },
    { id: 'legs_phoenix', name: 'Phoenix Leggings', price: 40000, sprite_layer: 'legs', sprite_path: '/sprites/legs_phoenix.png', rarity: 'epic' },
    
    // Legendary - 75000-250000 orbs (Complete Sets) - 200% price increase
    { id: 'legs_gold', name: 'Golden Armor Legs', price: 255000, sprite_layer: 'legs', sprite_path: '/sprites/legs_gold.png', rarity: 'legendary' },
    { id: 'legs_phoenix_legendary', name: 'Phoenix Greaves', price: 285000, sprite_layer: 'legs', sprite_path: '/sprites/legs_phoenix_legendary.png', rarity: 'legendary' },
    { id: 'legs_void', name: 'Void Leggings', price: 315000, sprite_layer: 'legs', sprite_path: '/sprites/legs_void.png', rarity: 'legendary' },
    { id: 'legs_celestial', name: 'Celestial Pants', price: 435000, sprite_layer: 'legs', sprite_path: '/sprites/legs_celestial.png', rarity: 'legendary' },
    { id: 'legs_galaxy', name: 'Galactic Leggings', price: 585000, sprite_layer: 'legs', sprite_path: '/sprites/legs_galaxy.png', rarity: 'legendary' },
    { id: 'legs_rainbow', name: 'Prismatic Pants', price: 525000, sprite_layer: 'legs', sprite_path: '/sprites/legs_rainbow.png', rarity: 'legendary' },
    
    // === ACCESSORIES === (Face/Back/Extras)
    // Common - 100-400 orbs
    { id: 'acc_glasses', name: 'Cool Glasses', price: 200, sprite_layer: 'accessory', sprite_path: '/sprites/acc_glasses.png', rarity: 'common' },
    { id: 'acc_sunglasses', name: 'Sunglasses', price: 250, sprite_layer: 'accessory', sprite_path: '/sprites/acc_sunglasses.png', rarity: 'common' },
    { id: 'acc_eyepatch', name: 'Pirate Eyepatch', price: 150, sprite_layer: 'accessory', sprite_path: '/sprites/acc_eyepatch.png', rarity: 'common' },
    { id: 'acc_scarf', name: 'Cozy Scarf', price: 300, sprite_layer: 'accessory', sprite_path: '/sprites/acc_scarf.png', rarity: 'common' },
    { id: 'acc_bowtie', name: 'Dapper Bowtie', price: 200, sprite_layer: 'accessory', sprite_path: '/sprites/acc_bowtie.png', rarity: 'common' },
    
    // Uncommon - 500-2000 orbs
    { id: 'acc_monocle', name: 'Fancy Monocle', price: 800, sprite_layer: 'accessory', sprite_path: '/sprites/acc_monocle.png', rarity: 'uncommon' },
    { id: 'acc_mask', name: 'Mystery Mask', price: 700, sprite_layer: 'accessory', sprite_path: '/sprites/acc_mask.png', rarity: 'uncommon' },
    { id: 'acc_cybervisor', name: 'Cyber Visor', price: 1500, sprite_layer: 'accessory', sprite_path: '/sprites/acc_cybervisor.png', rarity: 'uncommon' },
    { id: 'acc_necklace', name: 'Gold Necklace', price: 1000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_necklace.png', rarity: 'uncommon' },
    { id: 'acc_cape_red', name: 'Red Cape', price: 1200, sprite_layer: 'accessory', sprite_path: '/sprites/acc_cape_red.png', rarity: 'uncommon' },
    { id: 'acc_cape_black', name: 'Dark Cape', price: 1300, sprite_layer: 'accessory', sprite_path: '/sprites/acc_cape_black.png', rarity: 'uncommon' },
    { id: 'acc_backpack', name: 'Adventure Pack', price: 600, sprite_layer: 'accessory', sprite_path: '/sprites/acc_backpack.png', rarity: 'uncommon' },
    { id: 'acc_shield', name: 'Knight Shield', price: 1400, sprite_layer: 'accessory', sprite_path: '/sprites/acc_shield.png', rarity: 'uncommon' },
    { id: 'acc_wand', name: 'Sparkle Wand', price: 900, sprite_layer: 'accessory', sprite_path: '/sprites/acc_wand.png', rarity: 'uncommon' },
    
    // Rare - 3000-10000 orbs
    { id: 'acc_cape_royal', name: 'Royal Cape', price: 8000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_cape_royal.png', rarity: 'rare' },
    { id: 'acc_wings_fairy', name: 'Fairy Wings', price: 9000, sprite_layer: 'wings', sprite_path: '/sprites/acc_wings_fairy.png', rarity: 'rare' },
    { id: 'acc_sword', name: 'Hero Sword', price: 5000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_sword.png', rarity: 'rare' },
    { id: 'acc_staff', name: 'Magic Staff', price: 6000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_staff.png', rarity: 'rare' },
    { id: 'acc_guitar', name: 'Rock Guitar', price: 7000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_guitar.png', rarity: 'rare' },
    
    // Epic - 15000-50000 orbs
    { id: 'acc_wings_angel', name: 'Angel Wings', price: 25000, sprite_layer: 'wings', sprite_path: '/sprites/acc_wings_angel.png', rarity: 'epic' },
    { id: 'acc_wings_devil', name: 'Devil Wings', price: 25000, sprite_layer: 'wings', sprite_path: '/sprites/acc_wings_devil.png', rarity: 'epic' },
    { id: 'acc_jetpack', name: 'Jetpack', price: 35000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_jetpack.png', rarity: 'epic' },
    
    // Legendary - 75000+ orbs - 200% price increase
    { id: 'acc_wings_dragon', name: 'Dragon Wings', price: 300000, sprite_layer: 'wings', sprite_path: '/sprites/acc_wings_dragon.png', rarity: 'legendary' },
    { id: 'acc_aura_fire', name: 'Fire Aura', price: 375000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_aura_fire.png', rarity: 'legendary' },
    { id: 'acc_aura_ice', name: 'Ice Aura', price: 375000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_aura_ice.png', rarity: 'legendary' },
    
    // Legendary Set Accessories (matching each legendary set) - 200% price increase
    { id: 'acc_aura_golden', name: 'Golden Aura', price: 264000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_aura_golden.png', rarity: 'legendary' },
    { id: 'acc_aura_phoenix', name: 'Phoenix Aura', price: 294000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_aura_phoenix.png', rarity: 'legendary' },
    { id: 'acc_aura_void', name: 'Void Aura', price: 324000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_aura_void.png', rarity: 'legendary' },
    { id: 'acc_aura_celestial', name: 'Celestial Aura', price: 444000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_aura_celestial.png', rarity: 'legendary' },
    { id: 'acc_aura_galaxy', name: 'Galactic Aura', price: 594000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_aura_galaxy.png', rarity: 'legendary' },
    { id: 'acc_aura_rainbow', name: 'Prismatic Aura', price: 534000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_aura_rainbow.png', rarity: 'legendary' },
    
    // Legendary Wings (matching each legendary set) - 200% price increase
    { id: 'acc_wings_golden', name: 'Golden Wings', price: 276000, sprite_layer: 'wings', sprite_path: '/sprites/acc_wings_golden.png', rarity: 'legendary' },
    { id: 'acc_wings_phoenix', name: 'Phoenix Wings', price: 306000, sprite_layer: 'wings', sprite_path: '/sprites/acc_wings_phoenix.png', rarity: 'legendary' },
    { id: 'acc_wings_void', name: 'Void Wings', price: 336000, sprite_layer: 'wings', sprite_path: '/sprites/acc_wings_void.png', rarity: 'legendary' },
    { id: 'acc_wings_celestial', name: 'Celestial Wings', price: 456000, sprite_layer: 'wings', sprite_path: '/sprites/acc_wings_celestial.png', rarity: 'legendary' },
    { id: 'acc_wings_galaxy', name: 'Galactic Wings', price: 606000, sprite_layer: 'wings', sprite_path: '/sprites/acc_wings_galaxy.png', rarity: 'legendary' },
    { id: 'acc_wings_rainbow', name: 'Prismatic Wings', price: 546000, sprite_layer: 'wings', sprite_path: '/sprites/acc_wings_rainbow.png', rarity: 'legendary' },
    
    // Legendary Dual Weapons (matching each legendary set) - 200% price increase
    { id: 'acc_weapon_golden', name: 'Golden Dual Blades', price: 270000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_weapon_golden.png', rarity: 'legendary' },
    { id: 'acc_weapon_phoenix', name: 'Phoenix Dual Flames', price: 300000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_weapon_phoenix.png', rarity: 'legendary' },
    { id: 'acc_weapon_void', name: 'Void Dual Scythes', price: 330000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_weapon_void.png', rarity: 'legendary' },
    { id: 'acc_weapon_celestial', name: 'Celestial Dual Orbs', price: 450000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_weapon_celestial.png', rarity: 'legendary' },
    { id: 'acc_weapon_galaxy', name: 'Galactic Dual Blades', price: 600000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_weapon_galaxy.png', rarity: 'legendary' },
    { id: 'acc_weapon_rainbow', name: 'Prismatic Dual Prisms', price: 540000, sprite_layer: 'accessory', sprite_path: '/sprites/acc_weapon_rainbow.png', rarity: 'legendary' },
    
    // === SPEED BOOSTS === (Special)
    // Uncommon boost - 2000 orbs (~8 min)
    { id: 'boost_swift', name: 'Swift Sneakers', price: 2000, sprite_layer: 'boost', sprite_path: '/sprites/boost_swift.png', rarity: 'uncommon', speed_multiplier: 1.15, trail_color: '#22c55e' },
    
    // Rare boost - 8000 orbs (~30 min)
    { id: 'boost_runner', name: 'Runner\'s Rush', price: 8000, sprite_layer: 'boost', sprite_path: '/sprites/boost_runner.png', rarity: 'rare', speed_multiplier: 1.3, trail_color: '#3b82f6' },
    
    // Epic boost - 25000 orbs (~1.5 hours)
    { id: 'boost_dash', name: 'Dash Master', price: 25000, sprite_layer: 'boost', sprite_path: '/sprites/boost_dash.png', rarity: 'epic', speed_multiplier: 1.45, trail_color: '#a855f7' },
    
    // Epic boost - 40000 orbs (~2.5 hours)
    { id: 'boost_lightning', name: 'Lightning Step', price: 40000, sprite_layer: 'boost', sprite_path: '/sprites/boost_lightning.png', rarity: 'epic', speed_multiplier: 1.6, trail_color: '#f59e0b' },
    
    // Legendary boost - 80000 orbs (~5 hours) - 200% price increase
    { id: 'boost_sonic', name: 'Sonic Surge', price: 240000, sprite_layer: 'boost', sprite_path: '/sprites/boost_sonic.png', rarity: 'legendary', speed_multiplier: 1.75, trail_color: '#ef4444' },
    
    // Ultra Legendary - 200000 orbs (~13+ hours) - 200% price increase
    { id: 'boost_phantom', name: 'Phantom Velocity', price: 600000, sprite_layer: 'boost', sprite_path: '/sprites/boost_phantom.png', rarity: 'legendary', speed_multiplier: 2.0, trail_color: '#ec4899' },
    
    // === ORB BOOSTS === (Special)
    // Uncommon orb boost - 3000 orbs (~12 min)
    { id: 'boost_orb_lucky', name: 'Lucky Charm', price: 3000, sprite_layer: 'boost', sprite_path: '/sprites/boost_orb_lucky.png', rarity: 'uncommon', orb_multiplier: 1.1, trail_color: '#fbbf24' },
    
    // Rare orb boost - 12000 orbs (~45 min)
    { id: 'boost_orb_fortune', name: 'Fortune Finder', price: 12000, sprite_layer: 'boost', sprite_path: '/sprites/boost_orb_fortune.png', rarity: 'rare', orb_multiplier: 1.25, trail_color: '#3b82f6' },
    
    // Epic orb boost - 35000 orbs (~2 hours)
    { id: 'boost_orb_wealth', name: 'Wealth Magnet', price: 35000, sprite_layer: 'boost', sprite_path: '/sprites/boost_orb_wealth.png', rarity: 'epic', orb_multiplier: 1.5, trail_color: '#a855f7' },
    
    // Epic orb boost - 55000 orbs (~3.5 hours)
    { id: 'boost_orb_treasure', name: 'Treasure Seeker', price: 55000, sprite_layer: 'boost', sprite_path: '/sprites/boost_orb_treasure.png', rarity: 'epic', orb_multiplier: 1.75, trail_color: '#f59e0b' },
    
    // Legendary orb boost - 120000 orbs (~8 hours)
    { id: 'boost_orb_platinum', name: 'Platinum Collector', price: 120000, sprite_layer: 'boost', sprite_path: '/sprites/boost_orb_platinum.png', rarity: 'legendary', orb_multiplier: 2.0, trail_color: '#ef4444' },
    
    // Ultra Legendary orb boost - 300000 orbs (~20+ hours)
    { id: 'boost_orb_divine', name: 'Divine Harvest', price: 300000, sprite_layer: 'boost', sprite_path: '/sprites/boost_orb_divine.png', rarity: 'legendary', orb_multiplier: 3.0, trail_color: '#ec4899' },
    
    // === LEGENDARY PETS === (Cosmetic companions that follow you) - 200% price increase
    { id: 'pet_golden', name: 'Golden Dragon', price: 750000, sprite_layer: 'pet', sprite_path: '/sprites/pet_golden.png', rarity: 'legendary' },
    { id: 'pet_phoenix', name: 'Phoenix Companion', price: 840000, sprite_layer: 'pet', sprite_path: '/sprites/pet_phoenix.png', rarity: 'legendary' },
    { id: 'pet_void', name: 'Void Shadow', price: 900000, sprite_layer: 'pet', sprite_path: '/sprites/pet_void.png', rarity: 'legendary' },
    { id: 'pet_celestial', name: 'Celestial Star', price: 1050000, sprite_layer: 'pet', sprite_path: '/sprites/pet_celestial.png', rarity: 'legendary' },
    { id: 'pet_galaxy', name: 'Galactic Nebula', price: 1200000, sprite_layer: 'pet', sprite_path: '/sprites/pet_galaxy.png', rarity: 'legendary' },
    { id: 'pet_rainbow', name: 'Prismatic Spirit', price: 1140000, sprite_layer: 'pet', sprite_path: '/sprites/pet_rainbow.png', rarity: 'legendary' },
    // Epic Pet - Mini Me
    { id: 'pet_mini_me', name: 'Mini Me', price: 500000, sprite_layer: 'pet', sprite_path: '/sprites/pet_mini_me.png', rarity: 'epic' },
  ];

  for (const item of items) {
    data.shop_items[item.id] = item;
  }
  
  saveData();
  console.log(`Shop items seeded: ${items.length} items`);
}

// Migration: Add orb boost items
function migrateAddOrbBoostItems(): void {
  const orbBoostItems: ShopItemData[] = [
    // Uncommon orb boost - 3000 orbs (~12 min)
    { id: 'boost_orb_lucky', name: 'Lucky Charm', price: 3000, sprite_layer: 'boost', sprite_path: '/sprites/boost_orb_lucky.png', rarity: 'uncommon', orb_multiplier: 1.1, trail_color: '#fbbf24' },
    
    // Rare orb boost - 12000 orbs (~45 min)
    { id: 'boost_orb_fortune', name: 'Fortune Finder', price: 12000, sprite_layer: 'boost', sprite_path: '/sprites/boost_orb_fortune.png', rarity: 'rare', orb_multiplier: 1.25, trail_color: '#3b82f6' },
    
    // Epic orb boost - 35000 orbs (~2 hours)
    { id: 'boost_orb_wealth', name: 'Wealth Magnet', price: 35000, sprite_layer: 'boost', sprite_path: '/sprites/boost_orb_wealth.png', rarity: 'epic', orb_multiplier: 1.5, trail_color: '#a855f7' },
    
    // Epic orb boost - 55000 orbs (~3.5 hours)
    { id: 'boost_orb_treasure', name: 'Treasure Seeker', price: 55000, sprite_layer: 'boost', sprite_path: '/sprites/boost_orb_treasure.png', rarity: 'epic', orb_multiplier: 1.75, trail_color: '#f59e0b' },
    
    // Legendary orb boost - 120000 orbs (~8 hours)
    { id: 'boost_orb_platinum', name: 'Platinum Collector', price: 120000, sprite_layer: 'boost', sprite_path: '/sprites/boost_orb_platinum.png', rarity: 'legendary', orb_multiplier: 2.0, trail_color: '#ef4444' },
    
    // Ultra Legendary orb boost - 300000 orbs (~20+ hours)
    { id: 'boost_orb_divine', name: 'Divine Harvest', price: 300000, sprite_layer: 'boost', sprite_path: '/sprites/boost_orb_divine.png', rarity: 'legendary', orb_multiplier: 3.0, trail_color: '#ec4899' },
  ];
  
  let addedCount = 0;
  for (const item of orbBoostItems) {
    if (!data.shop_items[item.id]) {
      data.shop_items[item.id] = item;
      addedCount++;
    }
  }
  
  if (addedCount > 0) {
    saveData();
    console.log(`Migration: Added ${addedCount} orb boost items to shop`);
  }
}

// Migration: Update orb boost multipliers to new max (200%)
function migrateUpdateOrbBoostMultipliers(): void {
  const updates: { id: string; multiplier: number }[] = [
    { id: 'boost_orb_divine', multiplier: 3.0 }, // Update to 200% (was 2.5 = 150%)
  ];
  
  let updatedCount = 0;
  for (const update of updates) {
    if (data.shop_items[update.id] && data.shop_items[update.id].orb_multiplier !== update.multiplier) {
      data.shop_items[update.id].orb_multiplier = update.multiplier;
      updatedCount++;
    }
  }
  
  if (updatedCount > 0) {
    saveData();
    console.log(`Migration: Updated ${updatedCount} orb boost multipliers`);
  }
}

// Migration: Move wings from accessory layer to wings layer
function migrateWingsToSeparateLayer(): void {
  const wingIds = [
    'acc_wings_fairy',
    'acc_wings_angel',
    'acc_wings_devil',
    'acc_wings_dragon',
    'acc_wings_golden',
    'acc_wings_phoenix',
    'acc_wings_void',
    'acc_wings_celestial',
    'acc_wings_galaxy',
    'acc_wings_rainbow',
  ];
  
  let updatedCount = 0;
  for (const wingId of wingIds) {
    if (data.shop_items[wingId] && data.shop_items[wingId].sprite_layer === 'accessory') {
      data.shop_items[wingId].sprite_layer = 'wings';
      updatedCount++;
    }
  }
  
  if (updatedCount > 0) {
    saveData();
    console.log(`Migration: Moved ${updatedCount} wing items from accessory to wings layer`);
  }
}

// Player queries
export function getPlayer(id: string): PlayerData | undefined {
  return data.players[id];
}

export function createPlayer(id: string, name: string): PlayerData {
  const player: PlayerData = {
    id,
    name,
    orbs: 0,
    sprite_body: 'default',
    sprite_outfit: '[]',
    created_at: new Date().toISOString(),
    last_seen: new Date().toISOString(),
  };
  data.players[id] = player;
  saveData();
  return player;
}

export function updatePlayerOrbs(id: string, orbs: number): void {
  if (data.players[id]) {
    data.players[id].orbs = orbs;
    data.players[id].last_seen = new Date().toISOString();
    saveData();
  }
}

export function updatePlayerSprite(id: string, outfit: string[]): void {
  if (data.players[id]) {
    data.players[id].sprite_outfit = JSON.stringify(outfit);
    data.players[id].last_seen = new Date().toISOString();
    saveData();
  }
}

export function updatePlayerLastSeen(id: string): void {
  if (data.players[id]) {
    data.players[id].last_seen = new Date().toISOString();
    saveData();
  }
}

// Shop queries
export function getShopItems(): ShopItemData[] {
  return Object.values(data.shop_items);
}

export function getShopItem(id: string): ShopItemData | undefined {
  return data.shop_items[id];
}

// Inventory queries
export function getPlayerInventory(playerId: string): InventoryData[] {
  return data.inventory.filter(inv => inv.player_id === playerId);
}

export function addToInventory(playerId: string, itemId: string): void {
  // Check if already exists
  const exists = data.inventory.some(
    inv => inv.player_id === playerId && inv.item_id === itemId
  );
  
  if (!exists) {
    data.inventory.push({
      player_id: playerId,
      item_id: itemId,
      equipped: false,
      purchased_at: new Date().toISOString(),
    });
    saveData();
  }
}

export function setItemEquipped(playerId: string, itemId: string, equipped: boolean): void {
  const item = data.inventory.find(
    inv => inv.player_id === playerId && inv.item_id === itemId
  );
  if (item) {
    item.equipped = equipped;
    saveData();
  }
}

export function hasItem(playerId: string, itemId: string): boolean {
  return data.inventory.some(
    inv => inv.player_id === playerId && inv.item_id === itemId
  );
}

export function removeFromInventory(playerId: string, itemId: string): void {
  const index = data.inventory.findIndex(
    inv => inv.player_id === playerId && inv.item_id === itemId
  );
  if (index !== -1) {
    data.inventory.splice(index, 1);
    saveData();
  }
}
