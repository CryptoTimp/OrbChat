import { ShopItem, InventoryItem, ItemRarity } from './types';
import * as db from './db';

// Get shop items from local database (static data)
export function getShopItems(): ShopItem[] {
  const items = db.getShopItems();
  return items.map(item => ({
    id: item.id,
    name: item.name,
    price: item.price,
    spriteLayer: item.sprite_layer as 'hat' | 'shirt' | 'legs' | 'accessory' | 'cape' | 'boost' | 'wings' | 'pet',
    spritePath: item.sprite_path,
    rarity: (item.rarity || 'common') as ItemRarity,
    speedMultiplier: item.speed_multiplier,
    orbMultiplier: item.orb_multiplier,
    trailColor: item.trail_color,
  }));
}

// Get shop item by ID
export function getShopItem(itemId: string): ShopItem | undefined {
  const item = db.getShopItem(itemId);
  if (!item) return undefined;
  
  return {
    id: item.id,
    name: item.name,
    price: item.price,
    spriteLayer: item.sprite_layer as 'hat' | 'shirt' | 'legs' | 'accessory' | 'cape' | 'boost' | 'wings' | 'pet',
    spritePath: item.sprite_path,
    rarity: (item.rarity || 'common') as ItemRarity,
    speedMultiplier: item.speed_multiplier,
    orbMultiplier: item.orb_multiplier,
    trailColor: item.trail_color,
  };
}

// Server-side validation for purchase (client handles actual Firebase update)
// Returns the item price for validation purposes
export function validatePurchase(itemId: string, playerOrbs: number, ownedItems: string[]): { 
  success: boolean; 
  error?: string;
  price?: number;
} {
  const item = db.getShopItem(itemId);

  if (!item) {
    return { success: false, error: 'Item not found' };
  }

  // Check if already owned
  if (ownedItems.includes(itemId)) {
    return { success: false, error: 'Item already owned' };
  }

  // Check balance
  if (playerOrbs < item.price) {
    return { success: false, error: 'Insufficient orbs' };
  }

  return { success: true, price: item.price };
}

// Note: Inventory management is now handled client-side via Firebase
// The server only provides shop item data and basic validation
// Client is responsible for:
// - Loading inventory from Firebase on join
// - Updating Firebase when purchasing/equipping items
// - Sending equipped items to server for sprite updates
