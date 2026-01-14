# Pixel Chatroom

A web-based multiplayer pixel chatroom where players can walk around a grass field, chat with speech bubbles, collect orbs, and customize their characters with cosmetic items.

## Features

- **Real-time Multiplayer**: See other players move around in real-time
- **Habbo-style Chat**: Speech bubbles appear above your character
- **Orb Economy**: Collect orbs that spawn periodically to earn currency
- **Cosmetic Shop**: Buy and equip hats, shirts, and accessories
- **Pixel Art Style**: Pokémon GBA-inspired graphics

## Tech Stack

### Frontend
- React + Vite
- TypeScript
- HTML5 Canvas for game rendering
- Zustand for state management
- Socket.IO client for real-time communication
- Tailwind CSS for UI styling

### Backend
- Node.js + Express
- Socket.IO for WebSocket communication
- SQLite for data persistence
- TypeScript

## Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Installation

1. **Install server dependencies:**
   ```bash
   cd server
   npm install
   ```

2. **Install client dependencies:**
   ```bash
   cd client
   npm install
   ```

### Running the Application

1. **Start the server:**
   ```bash
   cd server
   npm run dev
   ```
   Server runs on `http://localhost:3001`

2. **Start the client (in a new terminal):**
   ```bash
   cd client
   npm run dev
   ```
   Client runs on `http://localhost:5173`

3. **Open your browser** and navigate to `http://localhost:5173`

## How to Play

1. Enter your name and optionally a room code
2. Use **WASD** or **Arrow Keys** to move your character
3. Press **Enter** to focus the chat input, type a message, and press Enter to send
4. Walk over blue orbs to collect them
5. Click the **Shop** button to buy cosmetic items with your orbs
6. Share your room code with friends to play together!

## Project Structure

```
/client
  /src
    /game          - Canvas rendering, game loop
    /ui            - React UI components
    /state         - Zustand stores
    /hooks         - Custom React hooks
    /types         - TypeScript type definitions

/server
  /src
    index.ts       - Express + Socket.IO server
    db.ts          - SQLite database
    rooms.ts       - Room management
    players.ts     - Player management
    orbs.ts        - Orb spawning system
    shop.ts        - Shop & inventory
```

## Socket Events

### Client → Server
- `join_room` - Join a room with name
- `move` - Send position update
- `chat_message` - Send chat message
- `collect_orb` - Attempt to collect an orb
- `purchase_item` - Buy a shop item
- `equip_item` - Equip/unequip an item

### Server → Client
- `room_state` - Full room state on join
- `player_joined` - New player joined
- `player_moved` - Player position update
- `player_left` - Player disconnected
- `chat_message` - Chat message broadcast
- `orb_spawned` - New orb appeared
- `orb_collected` - Orb was collected
- `inventory_updated` - Inventory changed
- `shop_items` - Available shop items

## Customization

### Adding New Shop Items

Edit `server/src/db.ts` and add items to the `seedShopItems()` function:

```typescript
{ 
  id: 'hat_new', 
  name: 'New Hat', 
  price: 100, 
  sprite_layer: 'hat', 
  sprite_path: '/sprites/hat_new.png' 
}
```

Then update `client/src/game/renderer.ts` to render the new item in `drawHat()` or similar functions.

### Changing Map Size

Edit the constants in `server/src/types/index.ts` and `client/src/types/index.ts`:

```typescript
MAP_WIDTH: 25,  // tiles
MAP_HEIGHT: 20, // tiles
```

## License

MIT
