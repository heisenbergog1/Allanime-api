const scraper = require('../src/scraper');

exports.handler = async function (event, context) {
  const path = event.path || '/';
  const method = event.httpMethod || 'GET';
  const params = event.queryStringParameters || {};

  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.body); } catch (e) {}
  }

  const allParams = { ...params, ...body };
  const showId = allParams.show_id;
  const epNo = allParams.ep_no;
  const quality = allParams.quality || 'best';
  const mode = allParams.mode === 'dub' ? 'dub' : 'sub';
  const season = allParams.season || 'S1';
  const customTitle = allParams.title;

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  // OPTIONS for CORS preflight
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  try {
    // Root
    if (path === '/' || path === '') {
      return { statusCode: 200, headers, body: JSON.stringify({
        title: 'Anime API (Netlify)',
        status: 'running',
        available_endpoints: [
          '/search?query=<query>', '/anime/<id>', '/episodes/<id>',
          '/episode_info', '/episode_url', '/play', '/download'
        ]
      })};
    }

    // Search
    if (path.startsWith('/search')) {
      const query = allParams.query || '';
      if (!query) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing query' }) };
      const results = await scraper.searchAnime(query);
      return { statusCode: 200, headers, body: JSON.stringify(results) };
    }

    // Anime details
    const animeMatch = path.match(/^\/anime\/([^\/]+)/);
    if (animeMatch) {
      const details = await scraper.getAnimeDetails(animeMatch[1]);
      if (!details) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };
      return { statusCode: 200, headers, body: JSON.stringify(details) };
    }

    // Episodes list
    const epsMatch = path.match(/^\/episodes\/([^\/]+)/);
    if (epsMatch) {
      const episodes = await scraper.getEpisodesList(epsMatch[1], mode);
      return { statusCode: 200, headers, body: JSON.stringify({ mode, episodes }) };
    }

    // Episode info
    if (path.startsWith('/episode_info')) {
      if (!showId || !epNo) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing params' }) };
      const info = await scraper.getEpisodeInfo(showId, epNo);
      if (!info) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };
      return { statusCode: 200, headers, body: JSON.stringify(info) };
    }

    // Episode URL - returns direct video URL
    if (path.startsWith('/episode_url')) {
      if (!showId || !epNo) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing params' }) };
      const url = await scraper.getEpisodeUrl(showId, epNo, mode, quality);
      if (!url) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };
      return { statusCode: 200, headers, body: JSON.stringify({ episode_url: url, mode }) };
    }

    // PLAY - Redirect to direct video URL
    if (path.startsWith('/play')) {
      if (!showId || !epNo) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing params' }) };

      const url = await scraper.getEpisodeUrl(showId, epNo, mode, quality);
      if (!url) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };

      return {
        statusCode: 302,
        headers: {
          ...headers,
          'Content-Type': 'video/mp4',
          'Content-Disposition': 'inline',
          'Location': url
        },
        body: ''
      };
    }

    // DOWNLOAD - Redirect with filename
    if (path.startsWith('/download')) {
      if (!showId || !epNo) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing params' }) };

      const [details, url] = await Promise.all([
        scraper.getAnimeDetails(showId).catch(() => null),
        scraper.getEpisodeUrl(showId, epNo, mode, quality)
      ]);

      if (!url) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };

      let animeTitle = showId;
      if (details && details.title) {
        animeTitle = details.title.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
      }

      const qualityMatch = url.match(/(\d{3,4}p)/);
      const resolvedQuality = qualityMatch ? qualityMatch[1] : '1080p';
      const filename = customTitle
        ? `${customTitle}.mp4`
        : `${animeTitle}_${season}E${epNo}_${resolvedQuality}.mp4`;

      return {
        statusCode: 302,
        headers: {
          ...headers,
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Location': url
        },
        body: ''
      };
    }

    // Thumbnails POST
    if (path.startsWith('/thumbnails') && method === 'POST') {
      const inputIds = body.ids || body.mal_ids;
      if (!inputIds || !Array.isArray(inputIds)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing 'ids' list" }) };
      }
      const results = {};
      for (const id of inputIds) {
        try {
          const details = await scraper.getAnimeDetails(id);
          if (details && details.thumbnail_url) results[id] = details.thumbnail_url;
        } catch (err) {}
      }
      return { statusCode: 200, headers, body: JSON.stringify(results) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };

  } catch (e) {
    console.error('Error:', e.message);
    const status = e.message && e.message.startsWith('NEED_CAPTCHA') ? 503 : 500;
    return { statusCode: status, headers, body: JSON.stringify({ error: e.message }) };
  }
};