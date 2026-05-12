# Allanime API

A fast, lightweight Node.js API to search anime, get episode lists, and stream videos — powered by Allanime.

## Deployment Options

### Option 1: Cloudflare Workers (Free, Serverless)

Deploy to Cloudflare's edge network. **Note:** Some video sources (fast4speed) may return 403 when proxied through CF — these will redirect to direct URL instead.

```bash
cd worker
npm install
npx wrangler deploy
```

**Limits:** 100K requests/day, 10ms CPU time per request

---

### Option 2: Vercel (Free, Best Streaming Support)

Full video proxy support — works with all video sources including fast4speed. **Note:** 100GB bandwidth limit/month.

```bash
npm install -g vercel
vercel --prod
```

Or deploy via GitHub: [vercel.com/new](https://vercel.com/new)

---

### Option 3: Local / Node.js Server

Run locally on your machine.

```bash
npm install
npm start
```

Server runs on `http://localhost:5678`. Set `PORT` in `.env` to change.

---

## Endpoints

### `GET /search?query=<query>`

Search for anime titles.

**Example:**
```
GET /search?query=one piece
```

**Response:**
```json
[
  {
    "id": "ReooPAxPMsHM4KPMY",
    "title": "One Piece",
    "episodes_sub": 1159,
    "episodes_dub": 1149
  }
]
```

---

### `GET /anime/<id>`

Get details for a specific anime.

**Example:**
```
GET /anime/ReooPAxPMsHM4KPMY
```

---

### `GET /episodes/<id>?mode=<sub|dub>`

Get the list of available episode numbers.

**Example:**
```
GET /episodes/ReooPAxPMsHM4KPMY?mode=sub
```

---

### `GET /episode_info?show_id=<id>&ep_no=<num>`

Get metadata for a specific episode, including thumbnails, title, and description.

---

### `GET /episode_url?show_id=<id>&ep_no=<num>&mode=<sub|dub>&quality=<best|worst|1080p>`

Get the direct video URL for an episode.

---

### `GET /play?show_id=<id>&ep_no=<num>&mode=<sub|dub>&quality=<best|worst|1080p>`

**Stream the video directly** in your browser or any video player. This proxies the video through the API with required headers.

**Example:**
```
/play?show_id=ReooPAxPMsHM4KPMY&ep_no=1
```

---

### `GET /download?show_id=<id>&ep_no=<num>&mode=<sub|dub>&quality=<best|worst|1080p>&season=<S1>&title=<custom>`

**Download the video file** directly to your device.

**Auto-generated filename:**
```
Anime_Title_S1E01_1080p.mp4
```

---

### `POST /thumbnails`

Get thumbnails for multiple anime in one request.

**Body:**
```json
{
  "ids": ["ReooPAxPMsHM4KPMY", "2NxpL4ikTQvnri9Cm"]
}
```

---

## Parameters

| Parameter | Values | Default | Description |
|-----------|--------|---------|-------------|
| `mode` | `sub`, `dub` | `sub` | Subbed or dubbed version |
| `quality` | `best`, `worst`, `1080p`, `720p`, `480p` | `best` | Video quality |
| `season` | `S1`, `S2`, etc. | `S1` | Season number (for download) |
| `title` | any string | - | Custom filename (download) |

---

## Deployment Comparison

| Platform | Video Proxy | Bandwidth/Requests | Best For |
|----------|------------|-------------------|----------|
| **Vercel** | Full support | 100GB/mo | Best streaming, limited bandwidth |
| **Cloudflare Workers** | Partial (redirect for fast4speed) | 100K/day | Free, global edge, some sources blocked |
| **Local** | Full support | Unlimited | Development, self-hosting |

---

## License

MIT
