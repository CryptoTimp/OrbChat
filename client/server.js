import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

const distPath = path.join(__dirname, 'dist');
const indexPath = path.join(distPath, 'index.html');

// Debug: Check if dist folder exists
console.log('Current directory:', __dirname);
console.log('Dist path:', distPath);
console.log('Dist exists:', existsSync(distPath));
console.log('Index.html exists:', existsSync(indexPath));

// List files in dist if it exists
if (existsSync(distPath)) {
  try {
    console.log('Files in dist:', readdirSync(distPath));
  } catch (err) {
    console.error('Error reading dist:', err);
  }
}

// Serve static files from the dist directory
app.use(express.static(distPath));

// Handle React Router - serve index.html for all routes
app.get('*', (req, res) => {
  console.log('Requested path:', req.path);
  if (existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('index.html not found');
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
