# Building and Testing Locally (Production Mode)

This guide will help you build and test your app in production mode locally to check performance.

## 🚀 Quick Build & Test

### Step 1: Build the Server

```bash
cd server
npm install  # If you haven't already
npm run build
```

This compiles TypeScript to JavaScript in the `server/dist` folder.

### Step 2: Build the Client

```bash
cd ../client
npm install  # If you haven't already
npm run build
```

This creates an optimized production build in the `client/dist` folder.

### Step 3: Start the Server (Production Mode)

In one terminal:

```bash
cd server
npm start
```

The server will run on `http://localhost:3001` (or whatever PORT is set in your environment).

### Step 4: Preview the Client (Production Build)

In another terminal:

```bash
cd client
npm run preview
```

This serves the production build. It will typically run on `http://localhost:4173` (Vite's default preview port).

### Step 5: Test Performance

1. Open `http://localhost:4173` in your browser
2. Open DevTools (F12) → Performance tab
3. Record a session while playing the game
4. Check for:
   - Frame rate (should be 60 FPS)
   - Memory usage
   - CPU usage
   - Any dropped frames

## 🔧 Environment Variables (Optional)

If you need to set environment variables:

### Server
Create `server/.env`:
```env
PORT=3001
ALLOWED_ORIGINS=http://localhost:4173
NODE_ENV=production
```

### Client
Create `client/.env.production`:
```env
VITE_SOCKET_URL=http://localhost:3001
```

Note: The client will default to `http://localhost:3001` in production mode if `VITE_SOCKET_URL` is not set (see `useSocket.ts`).

## 📊 Performance Testing Tips

1. **Use Chrome DevTools Performance Tab**:
   - Record while playing
   - Look for long tasks (>50ms)
   - Check frame rate graph

2. **Monitor Network Tab**:
   - Check bundle sizes
   - Verify assets are minified

3. **Check Console**:
   - Look for warnings/errors
   - Monitor WebSocket connection

4. **Test with Multiple Players** (if possible):
   - Open multiple browser windows
   - Test multiplayer performance

## 🐛 Troubleshooting

### Server won't start
- Make sure port 3001 is not in use
- Check `server/dist/index.js` exists (run `npm run build`)

### Client preview shows blank page
- Check browser console for errors
- Verify `client/dist` folder exists
- Make sure server is running

### Socket.IO connection fails
- Verify server is running on port 3001
- Check CORS settings in server
- Verify `VITE_SOCKET_URL` is set correctly (or defaults work)

## 🔄 Rebuilding After Changes

After making code changes:

1. **Rebuild server**:
   ```bash
   cd server
   npm run build
   # Restart: Ctrl+C then npm start
   ```

2. **Rebuild client**:
   ```bash
   cd client
   npm run build
   # Preview will auto-reload
   ```

## 💡 Development vs Production

- **Development** (`npm run dev`): Hot reload, source maps, unminified
- **Production** (`npm run build` + `npm run preview`): Optimized, minified, no source maps

Production builds are typically:
- 3-5x smaller bundle sizes
- Faster load times
- Better runtime performance
- No dev tools overhead
