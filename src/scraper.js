const axios = require('axios');
const crypto = require('crypto');

const AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0";
const ALLANIME_REFR = "https://youtu-chan.com";
const ALLANIME_BASE = "allanime.day";
const ALLANIME_API = `https://api.${ALLANIME_BASE}`;
const ALLANIME_KEY = crypto.createHash('sha256').update('Xot36i3lK3:v1').digest('hex');

// Persisted query hash for episode embeds (from ani-cli v4.14.0)
const EPISODE_QUERY_HASH = "d405d0edd690624b66baba3068e0edc3ac90f1597d898a1ec8db4e5c43c00fec";

const axiosInstance = axios.create({
    headers: {
        'User-Agent': AGENT,
        'Referer': ALLANIME_REFR
    },
    timeout: 8000
});


function decrypt(blob) {
    try {
        const data = Buffer.from(blob, 'base64');
        // v4.13+: skip 1st byte (version), IV = next 12 bytes, last 16 bytes = auth tag, middle = ciphertext
        const iv = data.slice(1, 13);
        const ctLen = data.length - 13 - 16;
        const ciphertext = data.slice(13, 13 + ctLen);
        const ctr = Buffer.concat([iv, Buffer.from([0, 0, 0, 2])]);
        
        const decipher = crypto.createDecipheriv('aes-256-ctr', Buffer.from(ALLANIME_KEY, 'hex'), ctr);
        let decrypted = decipher.update(ciphertext);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString('utf8');
    } catch (e) {
        return null;
    }
}

// Filemoon provider decryption (v4.14.0)
// Decodes base64url to hex
function b64urlToHex(b64url) {
    // Add padding
    let padded = b64url;
    const mod = padded.length % 4;
    if (mod === 2) padded += '==';
    else if (mod === 3) padded += '=';
    // Convert base64url to standard base64
    const b64 = padded.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(b64, 'base64').toString('hex');
}

async function getFilemoonLinks(providerPath) {
    const allLinks = [];
    const fetchUrl = providerPath.startsWith('http') ? providerPath : `https://${ALLANIME_BASE}${providerPath}`;
    
    try {
        const response = await axiosInstance.get(fetchUrl, { timeout: 4000 });
        const fmData = response.data;

        if (fmData && fmData.iv && fmData.payload && fmData.key_parts) {
            const kp1 = fmData.key_parts[0];
            const kp2 = fmData.key_parts[1];
            const keyHex = b64urlToHex(kp1) + b64urlToHex(kp2);
            const ivHex = b64urlToHex(fmData.iv) + '00000002';

            // Decode payload from base64url
            let payloadB64 = fmData.payload;
            const pMod = payloadB64.length % 4;
            if (pMod === 2) payloadB64 += '==';
            else if (pMod === 3) payloadB64 += '=';
            payloadB64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
            const payloadBuf = Buffer.from(payloadB64, 'base64');

            // Strip last 16 bytes (auth tag)
            const ctLen = payloadBuf.length - 16;
            const ciphertext = payloadBuf.slice(0, ctLen);

            const decipher = crypto.createDecipheriv('aes-256-ctr', Buffer.from(keyHex, 'hex'), Buffer.from(ivHex, 'hex'));
            let decrypted = decipher.update(ciphertext);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            const plain = decrypted.toString('utf8');

            // Parse the decrypted JSON for video URLs
            const parts = plain.replace(/[{}\[\]]/g, '\n').split('\n');
            for (const part of parts) {
                // Match "url":"..." and "height":NNN in either order
                const m1 = part.match(/"url":"([^"]*)".*"height":(\d+)/);
                const m2 = part.match(/"height":(\d+).*"url":"([^"]*)"/);
                if (m1) {
                    let url = m1[1].replace(/\\u0026/g, '&').replace(/\\u003D/g, '=');
                    allLinks.push({ resolution: m1[2], url });
                } else if (m2) {
                    let url = m2[2].replace(/\\u0026/g, '&').replace(/\\u003D/g, '=');
                    allLinks.push({ resolution: m2[1], url });
                }
            }
        }
    } catch (e) {
        // Filemoon provider fetch failed
    }

    return allLinks;
}

// Custom hex decoding from anime.sh (provider_init)
const decodeMapping = {
    '79': 'A', '7a': 'B', '7b': 'C', '7c': 'D', '7d': 'E', '7e': 'F', '7f': 'G', '70': 'H', '71': 'I', '72': 'J', '73': 'K', '74': 'L', '75': 'M', '76': 'N', '77': 'O',
    '68': 'P', '69': 'Q', '6a': 'R', '6b': 'S', '6c': 'T', '6d': 'U', '6e': 'V', '6f': 'W', '60': 'X', '61': 'Y', '62': 'Z',
    '59': 'a', '5a': 'b', '5b': 'c', '5c': 'd', '5d': 'e', '5e': 'f', '5f': 'g', '50': 'h', '51': 'i', '52': 'j', '53': 'k', '54': 'l', '55': 'm', '56': 'n', '57': 'o',
    '48': 'p', '49': 'q', '4a': 'r', '4b': 's', '4c': 't', '4d': 'u', '4e': 'v', '4f': 'w', '40': 'x', '41': 'y', '42': 'z',
    '08': '0', '09': '1', '0a': '2', '0b': '3', '0c': '4', '0d': '5', '0e': '6', '0f': '7', '00': '8', '01': '9',
    '15': '-', '16': '.', '67': '_', '46': '~', '02': ':', '17': '/', '07': '?', '1b': '#', '63': '[', '65': ']', '78': '@', '19': '!', '1c': '$', '1e': '&', '10': '(', '11': ')', '12': '*', '13': '+', '14': ',', '03': ';', '05': '=', '1d': '%'
};

function decodeProviderId(hex) {
    let result = '';
    for (let i = 0; i < hex.length; i += 2) {
        const part = hex.substring(i, i + 2);
        result += decodeMapping[part] || '';
    }
    return result.replace('/clock', '/clock.json');
}

// Scrape mp4upload.com HTML page for direct video URL
async function getMp4UploadLinks(pageUrl) {
    const allLinks = [];
    try {
        const response = await axios.get(pageUrl, {
            headers: {
                'User-Agent': AGENT,
                'Referer': ALLANIME_REFR
            },
            timeout: 25000,
            maxRedirects: 5
        });
        const html = typeof response.data === 'string' ? response.data : '';
        // Extract src: "...mp4" or file: "...mp4" pattern from the page
        const m = html.match(/(?:src|file):\s*"([^"]+\.mp4[^"]*)"/i);
        if (m) {
            let mp4Url = m[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
            allLinks.push({ resolution: 'Mp4', url: mp4Url, referer: 'https://www.mp4upload.com/' });
        }
    } catch (e) {
        // mp4upload fetch failed
    }
    return allLinks;
}

// Mirrors get_links() from anime.sh
async function getLinks(providerPath) {
    let allLinks = [];

    // tools.fast4speed.rsvp URLs are direct mp4 links that need Referer header
    if (providerPath.includes('tools.fast4speed.rsvp')) {
        allLinks.push({ resolution: 'Yt', url: providerPath, needsReferer: true });
        return allLinks;
    }

    // mp4upload.com — scrape the HTML page for direct mp4 link
    if (providerPath.includes('mp4upload.com')) {
        return getMp4UploadLinks(providerPath);
    }

    // For non-direct URLs, fetch the provider JSON
    const fetchUrl = providerPath.startsWith('http') ? providerPath : `https://${ALLANIME_BASE}${providerPath}`;

    try {
        const response = await axiosInstance.get(fetchUrl, { timeout: 4000 });
        const providerData = response.data;

        if (providerData.links && Array.isArray(providerData.links)) {
            for (const link of providerData.links) {
                const url = link.link;
                const res = link.resolutionStr || 'unknown';

                if (url && url.includes('repackager.wixmp.com')) {
                    // wixmp repackager: extract individual quality URLs (anime.sh lines 35-40)
                    const cleaned = url.replace('repackager.wixmp.com/', '').replace(/\.urlset.*/, '');
                    const qualitiesMatch = url.match(/\/,([^/]*),\/mp4/);
                    if (qualitiesMatch) {
                        const qualities = qualitiesMatch[1].split(',');
                        for (const q of qualities) {
                            const qUrl = cleaned.replace(/,[^/]*/, q);
                            allLinks.push({ resolution: q, url: qUrl });
                        }
                    } else {
                        allLinks.push({ resolution: res, url });
                    }
                } else if (url) {
                    allLinks.push({ resolution: res, url });
                }
            }
        }

        if (providerData.hls && providerData.hls.url) {
            allLinks.push({ resolution: 'hls', url: providerData.hls.url });
        }
    } catch (e) {
        // Provider fetch failed — timed out or returned error
    }

    return allLinks;
}

async function searchAnime(query) {
    const searchGql = `query($search: SearchInput $limit: Int $page: Int $translationType: VaildTranslationTypeEnumType $countryOrigin: VaildCountryOriginEnumType) {
        shows( search: $search limit: $limit page: $page translationType: $translationType countryOrigin: $countryOrigin ) {
            edges {
                _id
                name
                englishName
                nativeName
                availableEpisodes
                __typename
            }
        }
    }`;

    try {
        const response = await axiosInstance.post(`${ALLANIME_API}/api`, {
            variables: {
                search: {
                    allowAdult: false,
                    allowUnknown: false,
                    query: query
                },
                limit: 40,
                page: 1,
                translationType: "sub",
                countryOrigin: "ALL"
            },
            query: searchGql
        });

        const shows = response.data.data.shows.edges;
        return shows.map(show => ({
            id: show._id,
            title: show.englishName || show.name.replace(/\\"/g, '"'),
            episodes_sub: parseInt(show.availableEpisodes.sub) || 0,
            episodes_dub: parseInt(show.availableEpisodes.dub) || 0
        }));
    } catch (e) {
        console.error('[search] API error:', e.response?.status, e.response?.data || e.message);
        return [];
    }
}

async function getAnimeDetails(showId) {
    const query = `query ($showId: String!) {
        show( _id: $showId ) {
            _id
            name
            englishName
            nativeName
            thumbnail
            description
            status
            availableEpisodesDetail
        }
    }`;

    try {
        const response = await axiosInstance.post(`${ALLANIME_API}/api`, {
            variables: { showId },
            query: query
        });

        const show = response.data.data.show;
        if (!show) return null;

        return {
            id: show._id,
            title: show.englishName || show.name,
            title_english: show.englishName || show.name,
            thumbnail_url: show.thumbnail,
            synopsis: show.description ? show.description.replace(/<[^>]*>?/gm, '') : '',
            status: show.status,
            episodes_sub: show.availableEpisodesDetail.sub ? show.availableEpisodesDetail.sub.length : 0,
            episodes_dub: show.availableEpisodesDetail.dub ? show.availableEpisodesDetail.dub.length : 0
        };
    } catch (e) {
        return null;
    }
}

async function getEpisodesList(showId, mode = 'sub') {
    const episodesListGql = `query ($showId: String!) {
        show( _id: $showId ) {
            _id
            availableEpisodesDetail
        }
    }`;

    try {
        const response = await axiosInstance.post(`${ALLANIME_API}/api`, {
            variables: { showId },
            query: episodesListGql
        });

        const details = response.data.data.show.availableEpisodesDetail;
        const episodes = details[mode] || [];
        return episodes.sort((a, b) => parseFloat(a) - parseFloat(b));
    } catch (e) {
        return [];
    }
}

// Parse tobeparsed/sourceUrls from API response into respLines
function parseSourceLines(apiData) {
    const rawJson = JSON.stringify(apiData);
    let respLines = [];

    // Unescape unicode sequences in a source line
    function unescapeSource(str) {
        return str
            .replace(/\\u002F/g, '/')
            .replace(new RegExp('\\\\/', 'g'), '/')
            .replace(/\\u0026/g, '&')
            .replace(/\\u003D/g, '=')
            .replace(/\\/g, '');
    }

    // Helper to decrypt and extract source lines from a blob
    const extractFromBlob = (blob) => {
        if (!blob || blob.length < 50) return;
        const plain = decrypt(blob);
        if (!plain) return;

        const parts = plain.replace(/[{}]/g, '\n').split('\n');
        for (const part of parts) {
            const m = part.match(/"sourceUrl":"([^"]*)".*"sourceName":"([^"]*)"/);
            if (m) {
                let sourceUrl = unescapeSource(m[1]);
                const sourceName = m[2];
                if (sourceUrl.startsWith('--')) {
                    // Hex-encoded: strip '--' prefix, decode via mapping
                    respLines.push({ sourceName, hex: sourceUrl.substring(2) });
                } else if (sourceUrl.startsWith('http') || sourceUrl.startsWith('/')) {
                    // Direct URL
                    respLines.push({ sourceName, directUrl: sourceUrl });
                } else {
                    // Bare hex (no -- prefix)
                    respLines.push({ sourceName, hex: sourceUrl });
                }
            }
        }
    };

    // Try each blob location independently
    if (apiData.data && apiData.data._m && apiData.data._m.length > 10) {
        extractFromBlob(apiData.data._m);
    }
    if (apiData.data && apiData.data.tobeparsed) {
        extractFromBlob(apiData.data.tobeparsed);
    }
    if (apiData.tobeparsed) {
        extractFromBlob(apiData.tobeparsed);
    }
    if (apiData.data && apiData.data.episode && apiData.data.episode.sourceUrls) {
        const raw = JSON.stringify(apiData.data.episode.sourceUrls);
        const cleaned = unescapeSource(raw);
        const parts = cleaned.replace(/[{}]/g, '\n').split('\n');
        for (const part of parts) {
            const m = part.match(/"sourceUrl":"([^"]*)".*"sourceName":"([^"]*)"/);
            if (m) {
                let sourceUrl = m[1];
                const sourceName = m[2];
                if (sourceUrl.startsWith('--')) {
                    respLines.push({ sourceName, hex: sourceUrl.substring(2) });
                } else if (sourceUrl.startsWith('http') || sourceUrl.startsWith('/')) {
                    respLines.push({ sourceName, directUrl: sourceUrl });
                } else {
                    respLines.push({ sourceName, hex: sourceUrl });
                }
            }
        }
    }

    return respLines;
}

async function getEpisodeUrl(showId, epNo, mode = 'sub', quality = 'best') {
    const episodeEmbedGql = `query ($showId: String!, $translationType: VaildTranslationTypeEnumType!, $episodeString: String!) {
        episode( showId: $showId translationType: $translationType episodeString: $episodeString ) {
            episodeString
            sourceUrls
        }
    }`;

    try {
        let apiData = null;

        // v4.14.0: Try persisted query GET request first (bypasses captcha)
        try {
            const queryVars = JSON.stringify({ showId, translationType: mode, episodeString: epNo });
            const queryExt = JSON.stringify({ persistedQuery: { version: 1, sha256Hash: EPISODE_QUERY_HASH } });
            const apiUrl = `${ALLANIME_API}/api?variables=${encodeURIComponent(queryVars)}&extensions=${encodeURIComponent(queryExt)}`;

            const getResp = await axios.get(apiUrl, {
                headers: {
                    'User-Agent': AGENT,
                    'Referer': ALLANIME_REFR,
                    'Origin': ALLANIME_REFR
                },
                timeout: 5000
            });

            const rawText = JSON.stringify(getResp.data);
            // Accept both old format (tobeparsed) and new format (_m in data)
            if (rawText && (rawText.includes('tobeparsed') || rawText.includes('"_m"'))) {
                apiData = getResp.data;
            }
        } catch (e) {
            // GET request failed, will fall back to POST
        }

        // Fallback: POST request (original method)
        if (!apiData) {
            const postResp = await axiosInstance.post(`${ALLANIME_API}/api`, {
                variables: {
                    showId: showId,
                    translationType: mode,
                    episodeString: epNo
                },
                query: episodeEmbedGql
            });
            apiData = postResp.data;
        }

        // Check for NEED_CAPTCHA or other API-level errors
        if (apiData.errors && apiData.errors.length > 0) {
            const captchaErr = apiData.errors.find(e => e.message === 'NEED_CAPTCHA');
            if (captchaErr) {
                throw new Error('NEED_CAPTCHA: AllAnime API is currently requiring captcha verification. This is an upstream issue affecting all clients.');
            }
            throw new Error(`AllAnime API error: ${apiData.errors.map(e => e.message).join(', ')}`);
        }

        // Parse source lines from the API response
        let respLines = parseSourceLines(apiData);

        if (respLines.length === 0) return null;

        // Provider order (matches fix/mp4upload-fallback):
        // 1=Default(wixmp), 2=Mp4(mp4upload), 3=Yt-mp4(youtube/fast4speed),
        // 4=S-mp4(sharepoint), 5=Fm-mp4(filemoon), 6=Luf-Mp4(hianime)
        const providerDefs = [
            { name: 'Default', filemoon: false },
            { name: 'Mp4', filemoon: false },
            { name: 'Yt-mp4', filemoon: false },
            { name: 'S-mp4', filemoon: false },
            { name: 'Fm-mp4', filemoon: true },
            { name: 'Luf-Mp4', filemoon: false }
        ];

        // Fetch all providers in parallel
        const linkPromises = providerDefs.map(async (prov) => {
            const entry = respLines.find(r => r.sourceName === prov.name);
            if (!entry) return [];

            // Resolve the provider path: direct URL or hex-decoded
            let resolvedPath;
            if (entry.directUrl) {
                resolvedPath = entry.directUrl;
            } else if (entry.hex) {
                resolvedPath = decodeProviderId(entry.hex);
            }
            if (!resolvedPath) return [];

            if (prov.filemoon) {
                return getFilemoonLinks(resolvedPath);
            } else {
                return getLinks(resolvedPath);
            }
        });

        const results = await Promise.all(linkPromises);
        let allLinks = results.flat();

        if (allLinks.length === 0) return null;

        // Sort: numeric resolutions descending, then deprioritize fast4speed
        // (prefer wixmp/sharepoint/filemoon which don't need special headers)
        allLinks.sort((a, b) => {
            const aFast = a.needsReferer ? 1 : 0;
            const bFast = b.needsReferer ? 1 : 0;
            if (aFast !== bFast) return aFast - bFast; // non-referer first
            const resA = parseInt(a.resolution) || 0;
            const resB = parseInt(b.resolution) || 0;
            return resB - resA;
        });

        let selected;
        if (quality === 'best') {
            selected = allLinks[0];
        } else if (quality === 'worst') {
            const numeric = allLinks.filter(l => /^\d+/.test(l.resolution));
            selected = numeric.length > 0 ? numeric[numeric.length - 1] : allLinks[allLinks.length - 1];
        } else {
            selected = allLinks.find(l => l.resolution.includes(quality)) || allLinks[0];
        }

        // Clean up double slashes in URL path (but not in https://)
        let finalUrl = selected.url.replace(/([^:])\/\//g, '$1/');

        // Return object with URL and required headers
        const result = { url: finalUrl };
        if (selected.needsReferer || finalUrl.includes('tools.fast4speed.rsvp')) {
            result.headers = { Referer: ALLANIME_REFR };
        } else if (selected.referer) {
            result.headers = { Referer: selected.referer };
        }
        return result;

    } catch (e) {
        console.error("Failed to get episode URL:", e.message);
        // Re-throw NEED_CAPTCHA so callers can handle it appropriately
        if (e.message && e.message.startsWith('NEED_CAPTCHA')) {
            throw e;
        }
        return null;
    }
}

async function getEpisodeInfo(showId, epNo) {
    const epNum = parseFloat(epNo);
    const query = `query ($showId: String!, $epNum: Float!) {
        episodeInfos( showId: $showId episodeNumStart: $epNum episodeNumEnd: $epNum ) {
            episodeIdNum
            notes
            description
            thumbnails
        }
    }`;

    try {
        const response = await axiosInstance.post(`${ALLANIME_API}/api`, {
            variables: { showId, epNum },
            query: query
        });

        const infos = response.data.data.episodeInfos;
        if (!infos || infos.length === 0) return null;

        const info = infos[0];

        // Format thumbnails (some are relative paths)
        let thumbnails = info.thumbnails || [];
        thumbnails = thumbnails.map(t => t.startsWith('/') ? `https://${ALLANIME_BASE}${t}` : t);

        return {
            episode_no: info.episodeIdNum,
            title: info.notes || '',
            description: info.description || '',
            thumbnails: thumbnails
        };
    } catch (e) {
        return null;
    }
}

module.exports = {
    searchAnime,
    getAnimeDetails,
    getEpisodesList,
    getEpisodeUrl,
    getEpisodeInfo
};
