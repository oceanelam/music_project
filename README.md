# 🎵 Aura MP-1 • Last.fm Spatial Proxy & Floating MP3 Player

A resilient, secure web application connected to the **Last.fm API**, engineered with an **Express.js reverse-proxy backend**, **server-side in-memory caching**, and an **interactive 3D floating MP3 player** built with frosted-glassmorphism and spatial depth.

---

## 🌟 Highlights & Requirements Matrix

| Requirement | Implementation Details | Where to Inspect |
| :--- | :--- | :--- |
| **1. Backend as a Proxy** | Browser communicates **only** with our backend API at `/api/recent-tracks`. Zero calls to `ws.audioscrobbler.com` appear in the browser's Network tab. | `backend/server.js`, `backend/lastfmService.js`, `frontend/app.js` |
| **2. API Key Protection** | `LASTFM_API_KEY` is strictly stored in server-side `.env`, never bundled in frontend code, never hardcoded, and ignored by Git. | `.env.example`, `.gitignore`, `backend/server.js` |
| **3. Server-Side Caching** | Custom In-Memory RAM Cache (`SimpleCache`) with 60s TTL. Reloading twice triggers **only 1** actual Last.fm request. Live `X-Cache: HIT / MISS` headers and UI indicator. | `backend/cache.js`, `backend/server.js` |
| **4. Creative MP3 Player UI** | Replaces basic track lists with an iconic **Frosted Glass MP3 Player** that blossoms into **3D floating cards** in spatial depth with vinyl disc animations and tactile controls. | `frontend/index.html`, `frontend/style.css`, `frontend/app.js` |
| **5. Resilience & Fallbacks** | Clean error handling with 6s timeouts; returns structured fallback demo tracks with user warnings if Last.fm is down or if no key is configured yet. | `backend/lastfmService.js`, `frontend/app.js` |
| **6. Dockerized Setup** | Multi-container setup with Node.js backend and Nginx reverse-proxy frontend started with a single `docker compose up --build` command. | `docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile` |

---

## 🚀 Quick Start with Docker (Recommended)

### 1. Set Up Your Environment Variable

Copy the `.env.example` file to create your real `.env`:

```bash
cp .env.example .env
```

Open `.env` in any text editor and add your Last.fm API Key:

```env
LASTFM_API_KEY=your_actual_lastfm_api_key_here
LASTFM_DEFAULT_USER=rj
PORT=5000
CACHE_TTL_SECONDS=60
```

> **Note:** If you don't have an API key yet, you can obtain one in 30 seconds for free at [last.fm/api/account/create](https://www.last.fm/api/account/create). If left blank, the app will gracefully activate its built-in fallback tracks so you can test immediately!

### 2. Launch with a Single Command

```bash
docker compose up --build
```
*(or `docker-compose up --build` depending on your Docker installation)*

Both services will build and start together:
- **Frontend UI (Spatial MP3 Player):** Open [http://localhost:3000](http://localhost:3000)
- **Backend API Proxy:** [http://localhost:5000/api/recent-tracks](http://localhost:5000/api/recent-tracks)
- **Backend Health & Cache Stats:** [http://localhost:5000/api/health](http://localhost:5000/api/health)

To stop the containers:
```bash
docker compose down
```

---

## 💻 Local Development (Without Docker)

You can also run the application directly using Node.js:

1. **Install backend dependencies:**
   ```bash
   cd backend
   npm install
   ```

2. **Configure `.env`:**
   ```bash
   cp .env.example .env
   # Edit .env with your LASTFM_API_KEY
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Open in your browser:**
   Open [http://localhost:5000](http://localhost:5000). The Express backend serves both the API endpoints (`/api/*`) and the static frontend simultaneously.

---

## ⏱️ 3-Minute Live Presentation Guide

Use this exact script and checklist during your oral exam / live demo:

### Minute 1: Architecture & Proxy Security (Requirement 1 & 2)
1. Open the app at `http://localhost:3000` (or `http://localhost:5000`).
2. Open **Browser DevTools** (`F12`) ➔ Go to the **Network** tab.
3. Filter by `Fetch/XHR`.
4. Point out to the evaluator:
   > *"Notice that the browser communicates strictly with `/api/recent-tracks`. You will see zero outbound requests to `ws.audioscrobbler.com` from the browser. My backend acts as a secure reverse-proxy, ensuring my `LASTFM_API_KEY` stays securely hidden in the server `.env` file."*

### Minute 2: In-Memory Caching Verification (Requirement 1.3)
1. Show the terminal where the backend server is running.
2. Click **Fetch** or reload the page:
   - In terminal: `[CACHE MISS] Fetching fresh data from Last.fm API...`
   - In DevTools response headers: `X-Cache: MISS`
   - In UI: Top badge displays `🌐 LIVE MISS (Cached 60s)`.
3. Immediately reload the page a second time:
   - In terminal: `[CACHE HIT] Key: 'recent-tracks:rj:8' | TTL Remaining: 58s`
   - In DevTools response headers: `X-Cache: HIT`
   - In UI: Top badge turns green `⚡ CACHE HIT (58s remaining)`.
4. Point out to the evaluator:
   > *"Our backend includes a 60-second in-memory cache (`backend/cache.js`). Reloading twice in a row triggered only one actual call to Last.fm, reducing response time from ~400ms down to 1ms and respecting Last.fm rate limits."*

### Minute 3: Spatial Glassmorphic UI & Resilience (Requirement 2 & 3)
1. Show the **Closed State**: The sleek frosted-glass digital MP3 player widget resting on an airy neutral stone canvas.
2. Tap anywhere on the MP3 player or the center **EXPAND** trigger:
   > *"Clicking the player triggers a fluid opening transition where recent tracks blossom outward in 3D spatial orbit."*
3. Interact with the cards:
   - Click any floating card: it smoothly flies into the foreground as the active track.
   - The vinyl disc slides out from behind the album sleeve and spins when **Play** is toggled.
   - The scrubbable progress bar advances, and ambient synth audio plays via the Web Audio API.
4. Show the **Dock Player** button to collapse back into the compact handheld MP3 player widget.
5. Resize the window to mobile width (<600px) to prove full **mobile responsiveness**.
6. Mention resilience:
   > *"If Last.fm goes down or the API key is invalid, the backend intercepts the error and returns a clean fallback payload with a user warning banner, ensuring the UI never crashes."*

---

## 📁 Project Architecture & Directory Structure

```
music_project/
├── .env.example              # Root template for docker compose
├── .gitignore                # Ignores .env and node_modules
├── docker-compose.yml        # Multi-container orchestration (backend + frontend)
├── README.md                 # Complete project documentation & demo guide
│
├── backend/
│   ├── Dockerfile            # Node.js 20 Alpine container definition
│   ├── package.json          # Express, cors, dotenv
│   ├── server.js             # Main proxy server & route controllers
│   ├── cache.js              # In-memory RAM cache with TTL & hit/miss tracking
│   ├── lastfmService.js      # Last.fm API client, timeout protection & fallbacks
│   └── .env.example          # Local backend template
│
└── frontend/
    ├── Dockerfile            # Nginx Alpine container definition
    ├── nginx.conf            # Nginx reverse proxy configuration (/api/ -> backend)
    ├── index.html            # Spatial UI markup (Closed MP3 + 3D Floating arena)
    ├── style.css             # Frosted glassmorphism, 3D perspective & mobile media queries
    └── app.js                # Proxy API fetcher, audio synth & 3D layout physics
```

---

## 🔒 Security Best Practices

- **Zero Client-Side Keys:** The frontend source code contains no API keys or secret credentials.
- **Git Protection:** `.gitignore` explicitly prevents `.env` and `.env.local` from ever being checked into version control.
- **Backend Timeouts:** Last.fm API calls are bound to a strict 6-second `AbortSignal` timeout to avoid hanging worker threads.
- **Input Sanitization:** User query parameters are URI-encoded and track limits are clamped between 1 and 20.
