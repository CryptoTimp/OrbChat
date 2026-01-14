# Deployment Guide

This guide will help you deploy your ChatApp so your friends can play together!

## 🚀 Quick Start Options

### Option 1: Railway (Recommended - Easiest)
Railway is great for full-stack apps with Socket.IO. Free tier available.

### Option 2: Render
Similar to Railway, good free tier with persistent connections.

### Option 3: VPS (DigitalOcean, AWS, etc.)
More control, requires more setup but very flexible.

---

## 📋 Pre-Deployment Checklist

1. **Firebase Configuration**: Make sure your Firebase project is set up
2. **Environment Variables**: Prepare all needed env vars
3. **Build the Client**: Test the production build locally

---

## 🎯 Option 1: Deploy to Railway (Recommended)

### Step 1: Create Railway Account
1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub
3. Create a new project

### Step 2: Deploy Server
1. Click "New" → "GitHub Repo"
2. Select your repository
3. Railway will auto-detect it's a Node.js project
4. Set the **Root Directory** to `server`
5. Add environment variables:
   ```
   PORT=3001
   ALLOWED_ORIGINS=https://your-app.railway.app,https://your-client-domain.com
   ```
6. Railway will auto-deploy

### Step 3: Deploy Client
1. In Railway, create a **new service**
2. Connect the same GitHub repo
3. Set **Root Directory** to `client`
4. Set **Build Command**: `npm run build`
5. Set **Start Command**: `npm run preview` (or use a static file server)
6. Add environment variable:
   ```
   VITE_SOCKET_URL=https://your-server.railway.app
   ```

### Step 4: Update Client Socket URL
Update `client/src/hooks/useSocket.ts`:
```typescript
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 
  (import.meta.env.DEV ? 'http://localhost:3001' : '');
```

### Step 5: Get Your URLs
- Server URL: `https://your-server.railway.app`
- Client URL: `https://your-client.railway.app`

### Step 6: Update CORS
Update the server's `ALLOWED_ORIGINS` to include your client URL.

---

## 🎯 Option 2: Deploy to Render

### Step 1: Deploy Server
1. Go to [render.com](https://render.com)
2. Create new **Web Service**
3. Connect GitHub repo
4. Settings:
   - **Root Directory**: `server`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Environment**: Node
5. Add environment variables:
   ```
   PORT=10000
   ALLOWED_ORIGINS=https://your-client.onrender.com
   ```

### Step 2: Deploy Client
1. Create new **Static Site**
2. Connect GitHub repo
3. Settings:
   - **Root Directory**: `client`
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `dist`
4. Add environment variable:
   ```
   VITE_SOCKET_URL=https://your-server.onrender.com
   ```

---

## 🎯 Option 3: Deploy to VPS (DigitalOcean Droplet)

### Step 1: Create Droplet
1. Go to [digitalocean.com](https://digitalocean.com)
2. Create Ubuntu 22.04 droplet ($6/month minimum)
3. SSH into your droplet

### Step 2: Install Dependencies
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2 (process manager)
sudo npm install -g pm2

# Install Nginx
sudo apt install -y nginx
```

### Step 3: Clone and Build
```bash
# Clone your repo
git clone https://github.com/yourusername/ChatApp.git
cd ChatApp

# Build server
cd server
npm install
npm run build

# Build client
cd ../client
npm install
npm run build
```

### Step 4: Configure Server
```bash
cd ~/ChatApp/server

# Create .env file
nano .env
```
Add:
```
PORT=3001
ALLOWED_ORIGINS=http://your-domain.com,https://your-domain.com
NODE_ENV=production
```

### Step 5: Start Server with PM2
```bash
pm2 start dist/index.js --name chatapp-server
pm2 save
pm2 startup  # Follow instructions to enable auto-start
```

### Step 6: Configure Nginx
```bash
sudo nano /etc/nginx/sites-available/chatapp
```

Add:
```nginx
# Server (Socket.IO)
server {
    listen 80;
    server_name api.your-domain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# Client (Static files)
server {
    listen 80;
    server_name your-domain.com;

    root /home/youruser/ChatApp/client/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/chatapp /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Step 7: Setup SSL (Let's Encrypt)
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com -d api.your-domain.com
```

---

## 🔧 Environment Variables

### Server (.env)
```env
PORT=3001
ALLOWED_ORIGINS=https://your-client-domain.com
NODE_ENV=production
```

### Client (.env.production)
```env
VITE_SOCKET_URL=https://your-server-domain.com
```

---

## 📝 Important Notes

### 1. CORS Configuration
The server now uses `ALLOWED_ORIGINS` environment variable. Make sure to include:
- Your client domain
- `http://localhost:5173` for local development (optional)

### 2. Socket.IO Considerations
- Railway/Render: Works out of the box
- VPS: Make sure firewall allows port 3001 (or use Nginx proxy)
- Some platforms may need sticky sessions for Socket.IO

### 3. Database
The JSON file database (`server/data.json`) will work on most platforms. For production, consider:
- PostgreSQL (Railway/Render have easy add-ons)
- MongoDB Atlas (free tier)
- Supabase (free tier)

### 4. Firebase
Make sure your Firebase project allows your production domain:
- Firebase Console → Authentication → Settings → Authorized domains
- Add your production domain

### 5. Static Files
The server serves sprites from `client/public/sprites`. Make sure these files are included in deployment.

---

## 🧪 Testing Before Going Live

1. **Build locally**:
   ```bash
   cd client
   npm run build
   npm run preview
   ```

2. **Test server**:
   ```bash
   cd server
   npm run build
   npm start
   ```

3. **Check Socket.IO connection** in browser console

---

## 🐛 Troubleshooting

### Socket.IO Connection Issues
- Check CORS settings
- Verify `ALLOWED_ORIGINS` includes client URL
- Check firewall/security groups

### Build Failures
- Ensure Node.js version matches (check `.nvmrc` if you add one)
- Clear `node_modules` and reinstall
- Check for TypeScript errors: `npm run build`

### Database Issues
- Ensure `server/data.json` is writable
- Check file permissions on VPS
- Consider migrating to a real database for production

---

## 🎉 After Deployment

1. Share your client URL with friends
2. Test multiplayer functionality
3. Monitor server logs for errors
4. Consider setting up error tracking (Sentry, etc.)

---

## 💰 Cost Estimates

- **Railway**: Free tier (500 hours/month), then $5/month
- **Render**: Free tier available, then $7/month
- **DigitalOcean**: $6/month (droplet) + domain (~$12/year)
- **Vercel/Netlify**: Free for static sites (client only)

---

## 📚 Additional Resources

- [Railway Docs](https://docs.railway.app)
- [Render Docs](https://render.com/docs)
- [Socket.IO Deployment](https://socket.io/docs/v4/deployment/)
- [Vite Deployment](https://vitejs.dev/guide/static-deploy.html)
