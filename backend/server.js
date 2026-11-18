/**
 * ============================================================================
 * EXPRESS PROXY SERVER (backend/server.js)
 * ============================================================================
 * Key Rules:
 * 1. Dotenv loaded at the very top, resolving both ./backend/.env and ../.env
 * 2. Reverse proxy endpoint /api/recent-tracks
 * 3. Default limit=15 and user from process.env.LASTFM_USERNAME
 * 4. In-memory cache for successful responses (60s TTL)
 * 5. Passes structured error messages cleanly to client without crashes
 */

const path = require('path');
const { Readable } = require('stream');

// Ensure dotenv is loaded properly at the very top from both local and root .env
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const cache = require('./cache');
const { fetchRecentTracks } = require('./lastfmService');

const app = express();
const PORT = process.env.PORT || 5000;
const CACHE_TTL = parseInt(process.env.CACHE_TTL_SECONDS || '60', 10);

app.use(cors());
app.use(express.json());

// Log incoming API calls to terminal
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[HTTP] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// Serve static frontend assets
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));

/**
 * GET /api/recent-tracks
 * Proxies user.getrecenttracks for process.env.LASTFM_USERNAME (default limit: 15)
 */
app.get('/api/recent-tracks', async (req, res) => {
  try {
    const user = (req.query.user || process.env.LASTFM_USERNAME || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '15', 10), 1), 50);

    const cacheKey = `recent-tracks:${user.toLowerCase()}:${limit}`;

    // 1. Check in-memory cache
    const cached = cache.get(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('X-Cache-TTL', cached.ttlRemainingSeconds);
      return res.json({
        ...cached.data,
        _cache: {
          hit: true,
          cachedAt: cached.cachedAt,
          ttlRemainingSeconds: cached.ttlRemainingSeconds,
        },
      });
    }

    // 2. Cache miss: Fetch from Last.fm via server proxy
    console.log(`[CACHE MISS] Fetching fresh data from Last.fm API for user '${user}'...`);
    const freshData = await fetchRecentTracks(user, limit);

    // Only cache successful track lists (never cache errors)
    if (!freshData.error && Array.isArray(freshData.tracks) && freshData.tracks.length > 0) {
      cache.set(cacheKey, freshData, CACHE_TTL);
    }

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('X-Cache-TTL', CACHE_TTL);

    // If Last.fm returned an error, return 502 with structured message
    if (freshData.error) {
      return res.status(freshData.statusCode || 502).json({
        success: false,
        error: true,
        user: freshData.user,
        message: freshData.message,
        tracks: [],
      });
    }

    return res.json({
      ...freshData,
      _cache: {
        hit: false,
        cachedAt: new Date().toISOString(),
        ttlRemainingSeconds: CACHE_TTL,
      },
    });
  } catch (error) {
    console.error('[API FATAL ERROR]', error);
    res.status(500).json({
      success: false,
      error: true,
      message: 'Internal server proxy error.',
      details: error.message,
      tracks: [],
    });
  }
});

/**
 * GET /api/preview
 * Resolves free 30s audio preview via iTunes Search API with in-memory caching.
 * The browser only calls this route (never external domains).
 */
app.get('/api/preview', async (req, res) => {
  try {
    const track = (req.query.track || '').trim();
    const artist = (req.query.artist || '').trim();

    if (!track && !artist) {
      return res.status(400).json({ error: true, message: 'track or artist query parameter required' });
    }

    const cacheKey = `preview:${artist.toLowerCase()}:${track.toLowerCase()}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({
        ...cached.data,
        _cache: { hit: true, cachedAt: cached.cachedAt },
      });
    }

    const searchTerm = `${track} ${artist}`.trim();
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=song&limit=1`;
    console.log(`[PREVIEW SEARCH] Querying iTunes preview proxy for: "${searchTerm}"`);

    const response = await fetch(itunesUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });

    if (!response.ok) {
      throw new Error(`iTunes Search API returned HTTP ${response.status}`);
    }

    const data = await response.json();
    const item = data.results && data.results[0];

    if (!item || !item.previewUrl) {
      console.log(`[PREVIEW] No preview found for "${searchTerm}"`);
      const payload = {
        success: true,
        hasPreview: false,
        track,
        artist,
        previewUrl: null,
        message: 'No audio preview available for this track',
      };
      cache.set(cacheKey, payload, 300); // 5 min negative cache
      res.setHeader('X-Cache', 'MISS');
      return res.json(payload);
    }

    const proxiedUrl = `/api/preview/stream?url=${encodeURIComponent(item.previewUrl)}`;
    const payload = {
      success: true,
      hasPreview: true,
      track: item.trackName || track,
      artist: item.artistName || artist,
      album: item.collectionName || '',
      artwork: item.artworkUrl100 || null,
      previewUrl: proxiedUrl,
      durationSeconds: 30,
    };

    cache.set(cacheKey, payload, 7200); // 2 hours cache
    res.setHeader('X-Cache', 'MISS');
    return res.json(payload);
  } catch (err) {
    console.error(`[PREVIEW ERROR] Failed to fetch preview for "${req.query.track} - ${req.query.artist}":`, err.message);
    return res.json({
      success: true,
      hasPreview: false,
      track: req.query.track || '',
      artist: req.query.artist || '',
      previewUrl: null,
      message: 'Preview service temporarily unavailable: ' + err.message,
    });
  }
});

/**
 * GET /api/preview/stream
 * Proxies the remote 30s audio preview stream so ZERO external network requests appear in the browser tab.
 */
app.get('/api/preview/stream', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl || !targetUrl.startsWith('https://')) {
    return res.status(400).json({ error: true, message: 'Invalid or missing audio URL' });
  }

  try {
    const audioRes = await fetch(targetUrl, {
      signal: AbortSignal.timeout(8000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        ...(req.headers.range ? { Range: req.headers.range } : {}),
      },
    });

    if (!audioRes.ok && audioRes.status !== 206) {
      return res.status(audioRes.status).send('Unable to stream preview audio');
    }

    res.status(audioRes.status);
    const contentType = audioRes.headers.get('content-type') || 'audio/x-m4a';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    if (audioRes.headers.get('content-range')) {
      res.setHeader('Content-Range', audioRes.headers.get('content-range'));
    }
    if (audioRes.headers.get('content-length')) {
      res.setHeader('Content-Length', audioRes.headers.get('content-length'));
    }

    Readable.fromWeb(audioRes.body).pipe(res);
  } catch (err) {
    console.error('[AUDIO PROXY ERROR]', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: true, message: 'Audio stream proxy error' });
    }
  }
});

/**
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    configuredUser: process.env.LASTFM_USERNAME || null,
    apiKeyConfigured: Boolean(process.env.LASTFM_API_KEY && process.env.LASTFM_API_KEY !== 'YOUR_LASTFM_API_KEY'),
    cache: cache.getStats(),
  });
});

/**
 * POST /api/clear-cache
 */
app.post('/api/clear-cache', (req, res) => {
  cache.clear();
  res.json({ success: true, message: 'In-memory cache cleared.' });
});

// SPA fallback
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  const user = process.env.LASTFM_USERNAME || '(not set - configure in .env)';
  const keySet = Boolean(process.env.LASTFM_API_KEY && process.env.LASTFM_API_KEY !== 'YOUR_LASTFM_API_KEY');

  console.log(`
┌─────────────────────────────────────────────────────────────┐
│  EDITORIAL LAST.FM PROXY SERVER RUNNING                     │
├─────────────────────────────────────────────────────────────┤
│  • URL:           http://localhost:${PORT}                      │
│  • Endpoint:      http://localhost:${PORT}/api/recent-tracks     │
│  • Configured User: ${user.padEnd(40)}│
│  • API Key Set:   ${(keySet ? 'YES (Secured in .env)' : 'NO (Add to .env)').padEnd(40)}│
│  • Cache TTL:     ${(CACHE_TTL + ' seconds').padEnd(40)}│
└─────────────────────────────────────────────────────────────┘
  `);
});
