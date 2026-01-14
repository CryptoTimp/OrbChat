# Railway Deployment Guide

## Quick Start (5 Steps)

### Step 1: Deploy the Server

1. In Railway dashboard, click **"New Project"** → **"Deploy from GitHub repo"**
2. Select your `OrbChat` repository
3. Railway will create a service. Click on it to open settings
4. In the service settings, find **"Root Directory"** and set it to: `server`
5. Go to the **Variables** tab and add:
   ```
   ALLOWED_ORIGINS=https://placeholder.railway.app
   ```
   ⚠️ **Note**: We'll update this after getting the client URL.

6. Railway will automatically deploy and generate a domain. 
   - Click on the service → **Settings** → **Networking** → **Generate Domain**
   - **Copy this URL** (e.g., `https://your-server-production.up.railway.app`)
   - Save it somewhere!

### Step 2: Deploy the Client

1. In the same Railway project, click **"New"** → **"Service"** → **"GitHub Repo"**
2. Select the same `OrbChat` repository
3. In the service settings:
   - **Root Directory**: Set to `client`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npx serve -s dist -l $PORT`

4. Go to the **Variables** tab and add:
   ```
   VITE_SOCKET_URL=https://your-server-production.up.railway.app
   ```
   ⚠️ **Replace** with the actual server URL from Step 1.

5. Railway will automatically deploy. Generate a domain:
   - Click on the service → **Settings** → **Networking** → **Generate Domain**
   - **Copy this URL** (e.g., `https://your-client-production.up.railway.app`)
   - Save it!

### Step 3: Update CORS Settings

1. Go back to your **Server** service
2. Go to **Variables** tab
3. Update the `ALLOWED_ORIGINS` variable:
   - Click the edit icon (pencil) next to `ALLOWED_ORIGINS`
   - Replace the value with your client URL:
     ```
     https://your-client-production.up.railway.app
     ```
   - Click **Save**
4. Railway will automatically redeploy (watch the Deployments tab)

### Step 4: Update Client Socket URL (if needed)

If the client didn't pick up the environment variable:
1. Go to your **Client** service
2. Verify `VITE_SOCKET_URL` is set correctly
3. If it's still not working, you may need to rebuild:
   - Go to **Settings** → **Deploy** → Click **"Redeploy"**

### Step 5: Test Your Deployment

1. Open your client URL in a browser
2. Open browser console (F12) and check for:
   - Socket.IO connection success
   - No CORS errors
   - Game loads correctly

## Environment Variables Summary

### Server Service
- `ALLOWED_ORIGINS=https://your-client-url.railway.app`
  - ⚠️ Must match your client URL exactly (no trailing slash)
  - Railway automatically sets `PORT`, so you don't need to set it

### Client Service
- `VITE_SOCKET_URL=https://your-server-url.railway.app`
  - ⚠️ Must match your server URL exactly (no trailing slash)

## Troubleshooting

### Build Fails
- Check Railway logs for errors
- Ensure Node.js version is compatible (Railway auto-detects)
- Verify all dependencies are in `package.json`

### Socket.IO Connection Fails
- Check `ALLOWED_ORIGINS` includes client URL exactly (no trailing slash)
- Verify `VITE_SOCKET_URL` is set correctly
- Check Railway logs for CORS errors

### Client Shows Blank Page
- Check build logs for errors
- Verify `dist` folder is being generated
- Check that `serve` package is available (it's installed via npx)

### Port Issues
- Railway automatically sets `PORT` environment variable
- Don't hardcode ports in your code
- Use `process.env.PORT || 3001` for server
- Use `$PORT` in start command for client

## Custom Domains (Optional)

1. Go to your service → **Settings** → **Networking**
2. Click **"Generate Domain"** or **"Custom Domain"**
3. Follow Railway's instructions to set up your domain

## Monitoring

- View logs in Railway dashboard
- Set up alerts in Railway settings
- Monitor usage in Railway dashboard (free tier: 500 hours/month)

## Cost

- **Free Tier**: 500 hours/month, $5 credit
- **Hobby Plan**: $5/month for more resources
- Both services count toward your usage
