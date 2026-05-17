import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as scraper from './scraper.js';

const app = new Hono();
app.use('*', cors());

app.get('/', (c) => c.json({
    title: "Anime API (Cloudflare Worker)",
    status: "running",
    source: "Allanime Direct",
    available_endpoints: [
        "/search?query=<query>",
        "/anime/<id>",
        "/thumbnails (POST with {'ids': ['id1', 'id2', ...]})",
        "/episodes/<id>?mode=<sub|dub>",
        "/episode_info?show_id=<id>&ep_no=<ep_no>",
        "/episode_url?show_id=<id>&ep_no=<ep_no>&quality=<quality>&mode=<sub|dub>",
        "/play?show_id=<id>&ep_no=<ep_no>&quality=<quality>&mode=<sub|dub> (streams video directly)",
        "/download?show_id=<id>&ep_no=<ep_no>&quality=<quality>&mode=<sub|dub>&title=<optional> (downloads video)"
    ]
}));

app.get('/search', async (c) => {
    const query = c.req.query('query') || '';
    if (!query) return c.json({ error: "Missing query parameter" }, 400);
    try {
        const results = await scraper.searchAnime(query);
        return c.json(results);
    } catch (e) {
        return c.json({ error: e.message }, 500);
    }
});

app.get('/anime/:id', async (c) => {
    try {
        const id = c.req.param('id');
        const details = await scraper.getAnimeDetails(id);
        if (!details) return c.json({ error: "Anime not found on Allanime" }, 404);
        return c.json(details);
    } catch (e) {
        return c.json({ error: e.message }, 500);
    }
});

app.get('/episodes/:id', async (c) => {
    const id = c.req.param('id');
    const mode = c.req.query('mode') === 'dub' ? 'dub' : 'sub';
    try {
        const episodes = await scraper.getEpisodesList(id, mode);
        return c.json({ mode, episodes });
    } catch (e) {
        return c.json({ error: e.message }, 500);
    }
});

app.get('/episode_url', async (c) => {
    const id = c.req.query('show_id');
    const epNo = c.req.query('ep_no');
    const quality = c.req.query('quality') || 'best';
    const mode = c.req.query('mode') === 'dub' ? 'dub' : 'sub';

    if (!id || !epNo) return c.json({ error: "Missing show_id or ep_no" }, 400);

    try {
        const result = await scraper.getEpisodeUrl(id, epNo, mode, quality);
        if (!result) return c.json({ error: "Episode not found or URL not available" }, 404);
        const response = { episode_url: result.url, mode };
        if (result.headers) {
            response.headers = result.headers;
        }
        return c.json(response);
    } catch (e) {
        const status = e.message && e.message.startsWith('NEED_CAPTCHA') ? 503 : 500;
        return c.json({ error: e.message }, status);
    }
});

// Cache resolved video URLs so seeking (Range requests) don't re-scrape
const urlCache = new Map();
const URL_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCacheKey(id, epNo, mode, quality) {
    return `${id}:${epNo}:${mode}:${quality}`;
}

function getCachedUrl(key) {
    const entry = urlCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > URL_CACHE_TTL) {
        urlCache.delete(key);
        return null;
    }
    return entry.result;
}

app.get('/play', async (c) => {
    const id = c.req.query('show_id');
    const epNo = c.req.query('ep_no');
    const quality = c.req.query('quality') || 'best';
    const mode = c.req.query('mode') === 'dub' ? 'dub' : 'sub';

    if (!id || !epNo) return c.json({ error: "Missing show_id or ep_no" }, 400);

    try {
        const cacheKey = getCacheKey(id, epNo, mode, quality);
        let result = getCachedUrl(cacheKey);
        if (!result) {
            result = await scraper.getEpisodeUrl(id, epNo, mode, quality);
            if (result) {
                urlCache.set(cacheKey, { result, ts: Date.now() });
            }
        }
        if (!result) return c.json({ error: "Episode not found or URL not available" }, 404);

        const url = result.url;

        const range = c.req.header('Range');
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0',
            'Referer': 'https://youtu-chan.com',
            'Accept': '*/*',
            ...(result.headers || {})
        };
        if (range) headers['Range'] = range;

        const videoResp = await fetch(url, { headers, redirect: 'follow' });

        if (videoResp.status >= 400) {
            // URL might be stale — clear cache and retry once
            urlCache.delete(cacheKey);
            return c.json({ error: `Video source returned ${videoResp.status}` }, 502);
        }

        const respHeaders = new Headers();
        respHeaders.set('Content-Type', 'video/mp4');
        respHeaders.set('Content-Disposition', 'inline');
        respHeaders.set('Access-Control-Allow-Origin', '*');
        respHeaders.set('Accept-Ranges', 'bytes');
        if (videoResp.headers.get('content-length')) {
            respHeaders.set('Content-Length', videoResp.headers.get('content-length'));
        }
        if (videoResp.headers.get('content-range')) {
            respHeaders.set('Content-Range', videoResp.headers.get('content-range'));
        }
        respHeaders.set('Cache-Control', 'no-store');

        return new Response(videoResp.body, { status: videoResp.status, headers: respHeaders });
    } catch (e) {
        const status = e.message && e.message.startsWith('NEED_CAPTCHA') ? 503 : 500;
        return c.json({ error: e.message }, status);
    }
});

app.get('/download', async (c) => {
    const id = c.req.query('show_id');
    const epNo = c.req.query('ep_no');
    const qualityParam = c.req.query('quality') || 'best';
    const mode = c.req.query('mode') === 'dub' ? 'dub' : 'sub';
    const customTitle = c.req.query('title');
    const season = c.req.query('season') || 'S1';

    if (!id || !epNo) return c.json({ error: "Missing show_id or ep_no" }, 400);

    try {
        const [details, result] = await Promise.all([
            scraper.getAnimeDetails(id).catch(() => null),
            scraper.getEpisodeUrl(id, epNo, mode, qualityParam)
        ]);

        if (!result) return c.json({ error: "Episode not found or URL not available" }, 404);

        const url = result.url;

        let animeTitle = id;
        if (details && details.title) {
            animeTitle = details.title.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
        }

        let resolvedQuality = qualityParam;
        if (qualityParam === 'best' || qualityParam === 'worst') {
            const qualityMatch = url.match(/(\d{3,4}p)/);
            resolvedQuality = qualityMatch ? qualityMatch[1] : '1080p';
        }

        const filename = customTitle
            ? `${customTitle}.mp4`
            : `${animeTitle}_${season}E${epNo}_${resolvedQuality}.mp4`;

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0',
            'Referer': 'https://youtu-chan.com',
            'Accept': '*/*',
            ...(result.headers || {})
        };

        const videoResp = await fetch(url, { headers, redirect: 'follow' });

        if (videoResp.status >= 400) {
            return c.json({ error: `Video source returned ${videoResp.status}` }, 502);
        }

        const respHeaders = new Headers();
        respHeaders.set('Content-Type', 'video/mp4');
        respHeaders.set('Content-Disposition', `attachment; filename="${filename}"`);
        respHeaders.set('Access-Control-Allow-Origin', '*');
        if (videoResp.headers.get('content-length')) {
            respHeaders.set('Content-Length', videoResp.headers.get('content-length'));
        }
        respHeaders.set('Cache-Control', 'no-store');

        return new Response(videoResp.body, {
            status: videoResp.status,
            headers: respHeaders
        });
    } catch (e) {
        const status = e.message && e.message.startsWith('NEED_CAPTCHA') ? 503 : 500;
        return c.json({ error: e.message }, status);
    }
});

app.get('/episode_info', async (c) => {
    const id = c.req.query('show_id');
    const epNo = c.req.query('ep_no');

    if (!id || !epNo) return c.json({ error: "Missing show_id or ep_no" }, 400);

    try {
        const info = await scraper.getEpisodeInfo(id, epNo);
        if (!info) return c.json({ error: "Episode info not found" }, 404);
        return c.json(info);
    } catch (e) {
        return c.json({ error: e.message }, 500);
    }
});

app.post('/thumbnails', async (c) => {
    try {
        const body = await c.req.json();
        const inputIds = body.ids || body.mal_ids;

        if (!inputIds || !Array.isArray(inputIds)) {
            return c.json({ error: "Missing 'ids' list in request body" }, 400);
        }

        const results = {};
        for (const id of inputIds) {
            try {
                const details = await scraper.getAnimeDetails(id);
                if (details && details.thumbnail_url) {
                    results[id] = details.thumbnail_url;
                }
            } catch (err) { /* ignore */ }
        }

        return c.json(results);
    } catch (e) {
        return c.json({ error: e.message }, 500);
    }
});

export default app;
