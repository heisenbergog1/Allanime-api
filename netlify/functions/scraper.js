const axios = require('axios');
const crypto = require('crypto');

const AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0';
const ALLANIME_REFR = 'https://allmanga.to';
const ALLANIME_BASE = 'allanime.day';
const ALLANIME_API = `https://api.${ALLANIME_BASE}`;
const ALLANIME_KEY = crypto.createHash('sha256').update('Xot36i3lK3:v1').digest('hex');
const EPISODE_QUERY_HASH = 'd405d0edd690624b66baba3068e0edc3ac90f1597d898a1ec8db4e5c43c00fec';

function decrypt(blob) {
    try {
        const data = Buffer.from(blob, 'base64');
        const iv = data.slice(1, 13);
        const ctLen = data.length - 13 - 16;
        const ciphertext = data.slice(13, 13 + ctLen);
        const ctr = Buffer.concat([iv, Buffer.from([0, 0, 0, 2])]);
        const decipher = crypto.createDecipheriv('aes-256-ctr', Buffer.from(ALLANIME_KEY, 'hex'), ctr);
        let d1 = decipher.update(ciphertext);
        let d2 = decipher.final();
        return Buffer.concat([d1, d2]).toString('utf8');
    } catch (e) {
        return null;
    }
}

function b64urlToHex(b64url) {
    let padded = b64url;
    const mod = padded.length % 4;
    if (mod === 2) padded += '==';
    else if (mod === 3) padded += '=';
    const b64 = padded.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(b64, 'base64').toString('hex');
}

async function getFilemoonLinks(providerPath) {
    const allLinks = [];
    const fetchUrl = providerPath.startsWith('http') ? providerPath : `https://${ALLANIME_BASE}${providerPath}`;

    try {
        const response = await axios.get(fetchUrl, { timeout: 4000, headers: { 'User-Agent': AGENT, 'Referer': ALLANIME_REFR } });
        const fmData = response.data;

        if (fmData && fmData.iv && fmData.payload && fmData.key_parts) {
            const kp1 = fmData.key_parts[0];
            const kp2 = fmData.key_parts[1];
            const keyHex = b64urlToHex(kp1) + b64urlToHex(kp2);
            const ivHex = b64urlToHex(fmData.iv) + '00000002';

            let payloadB64 = fmData.payload;
            const pMod = payloadB64.length % 4;
            if (pMod === 2) payloadB64 += '==';
            else if (pMod === 3) payloadB64 += '=';
            payloadB64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
            const payloadBuf = Buffer.from(payloadB64, 'base64');

            const ctLen = payloadBuf.length - 16;
            const ciphertext = payloadBuf.slice(0, ctLen);

            const decipher = crypto.createDecipheriv('aes-256-ctr', Buffer.from(keyHex, 'hex'), Buffer.from(ivHex, 'hex'));
            let d1 = decipher.update(ciphertext);
            let d2 = decipher.final();
            const plain = Buffer.concat([d1, d2]).toString('utf8');

            const parts = plain.replace(/[{}\[\]]/g, '\n').split('\n');
            for (const part of parts) {
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
    } catch (e) {}

    return allLinks;
}

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

async function apiFetch(query, variables) {
    const response = await axios.post(`${ALLANIME_API}/api`, { query, variables }, {
        headers: { 'Content-Type': 'application/json', 'User-Agent': AGENT, 'Referer': ALLANIME_REFR },
        timeout: 8000
    });
    return response.data;
}

async function getLinks(providerPath) {
    let allLinks = [];

    if (providerPath.includes('tools.fast4speed.rsvp')) {
        let validatedUrl = providerPath;
        if (!providerPath.includes('?v=')) {
            validatedUrl = providerPath + (providerPath.includes('?') ? '&' : '?') + 'v=1';
        }
        allLinks.push({ resolution: 'Yt', url: validatedUrl });
        return allLinks;
    }

    const fetchUrl = providerPath.startsWith('http') ? providerPath : `https://${ALLANIME_BASE}${providerPath}`;

    try {
        const response = await axios.get(fetchUrl, { timeout: 4000, headers: { 'User-Agent': AGENT, 'Referer': ALLANIME_REFR } });
        const providerData = response.data;

        if (providerData.links && Array.isArray(providerData.links)) {
            for (const link of providerData.links) {
                const url = link.link;
                const res = link.resolutionStr || 'unknown';

                if (url && url.includes('repackager.wixmp.com')) {
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
    } catch (e) {}

    return allLinks;
}

function parseSourceLines(apiData) {
    let respLines = [];

    const extractFromBlob = (blob) => {
        if (!blob || blob.length < 50) return;
        const plain = decrypt(blob);
        if (!plain) return;

        // Direct video path from episodeInfo.vidInfors
        const vidMatch = plain.match(/"vidPath":"(\/data2\/[^"]+)"/);
        if (vidMatch) {
            const path = vidMatch[1];
            if (path.includes('fast4speed.rsvp')) {
                const cleanPath = path.replace('/data2', '');
                const validatedUrl = cleanPath + (cleanPath.includes('?') ? '&' : '?') + 'v=1';
                respLines.push({ sourceName: 'Yt-mp4', url: validatedUrl });
            }
        }

        // Hex-encoded source URLs
        const parts = plain.replace(/[{}]/g, '\n').split('\n');
        for (const part of parts) {
            const m = part.match(/"sourceUrl":"--([^"]*)".*"sourceName":"([^"]*)"/);
            if (m) respLines.push({ sourceName: m[2], hex: m[1] });
        }
    };

    if (apiData.data && apiData.data._m && apiData.data._m.length > 10) extractFromBlob(apiData.data._m);
    if (apiData.data && apiData.data.tobeparsed) extractFromBlob(apiData.data.tobeparsed);
    if (apiData.tobeparsed) extractFromBlob(apiData.tobeparsed);
    if (apiData.data && apiData.data.episode && apiData.data.episode.sourceUrls) {
        const raw = JSON.stringify(apiData.data.episode.sourceUrls);
        const cleaned = raw.replace(/\\u002F/g, '/').replace(/\\/g, '');
        const parts = cleaned.replace(/[{}]/g, '\n').split('\n');
        for (const part of parts) {
            const m = part.match(/"sourceUrl":"--([^"]*)".*"sourceName":"([^"]*)"/);
            if (m) respLines.push({ sourceName: m[2], hex: m[1] });
        }
    }

    return respLines;
}

exports.searchAnime = async function(query) {
    try {
        const data = await apiFetch(`query($search: SearchInput $limit: Int $page: Int $countryOrigin: VaildCountryOriginEnumType) {
            shows( search: $search limit: $limit page: $page countryOrigin: $countryOrigin ) {
                edges { _id name englishName nativeName availableEpisodes __typename }
            }
        }`, { search: { allowAdult: false, allowUnknown: false, query }, limit: 40, page: 1, countryOrigin: 'ALL' });

        return data.data.shows.edges.map(show => ({
            id: show._id,
            title: show.englishName || show.name.replace(/\\"/g, '"'),
            episodes_sub: parseInt(show.availableEpisodes.sub) || 0,
            episodes_dub: parseInt(show.availableEpisodes.dub) || 0
        }));
    } catch (e) { return []; }
};

exports.getAnimeDetails = async function(showId) {
    try {
        const data = await apiFetch(`query ($showId: String!) {
            show( _id: $showId ) { _id name englishName nativeName thumbnail description status availableEpisodesDetail }
        }`, { showId });

        const show = data.data.show;
        if (!show) return null;

        return {
            id: show._id,
            title: show.englishName || show.name,
            thumbnail_url: show.thumbnail,
            synopsis: show.description ? show.description.replace(/<[^>]*>?/gm, '') : '',
            status: show.status,
            episodes_sub: show.availableEpisodesDetail.sub ? show.availableEpisodesDetail.sub.length : 0,
            episodes_dub: show.availableEpisodesDetail.dub ? show.availableEpisodesDetail.dub.length : 0
        };
    } catch (e) { return null; }
};

exports.getEpisodesList = async function(showId, mode = 'sub') {
    try {
        const data = await apiFetch(`query ($showId: String!) {
            show( _id: $showId ) { _id availableEpisodesDetail }
        }`, { showId });
        const episodes = data.data.show.availableEpisodesDetail[mode] || [];
        return episodes.sort((a, b) => parseFloat(a) - parseFloat(b));
    } catch (e) { return []; }
};

exports.getEpisodeUrl = async function(showId, epNo, mode = 'sub', quality = 'best') {
    try {
        let apiData = null;

        // Try GET request first
        try {
            const queryVars = JSON.stringify({ showId, translationType: mode, episodeString: epNo });
            const queryExt = JSON.stringify({ persistedQuery: { version: 1, sha256Hash: EPISODE_QUERY_HASH } });
            const apiUrl = `${ALLANIME_API}/api?variables=${encodeURIComponent(queryVars)}&extensions=${encodeURIComponent(queryExt)}`;

            const resp = await axios.get(apiUrl, {
                headers: { 'User-Agent': AGENT, 'Referer': ALLANIME_REFR, 'Origin': 'https://youtu-chan.com' },
                timeout: 5000
            });

            const rawText = JSON.stringify(resp.data);
            if (rawText && (rawText.includes('tobeparsed') || rawText.includes('"_m"'))) {
                apiData = resp.data;
            }
        } catch (e) {}

        // Fallback to POST
        if (!apiData) {
            apiData = await apiFetch(`query ($showId: String!, $translationType: VaildTranslationTypeEnumType!, $episodeString: String!) {
                episode( showId: $showId translationType: $translationType episodeString: $episodeString ) {
                    episodeString sourceUrls
                }
            }`, { showId, translationType: mode, episodeString: epNo });
        }

        if (apiData.errors && apiData.errors.length > 0) {
            const captchaErr = apiData.errors.find(e => e.message === 'NEED_CAPTCHA');
            if (captchaErr) throw new Error('NEED_CAPTCHA');
            throw new Error(apiData.errors.map(e => e.message).join(', '));
        }

        let respLines = parseSourceLines(apiData);
        if (respLines.length === 0) return null;

        const providerDefs = [
            { name: 'Default', filemoon: false },
            { name: 'Yt-mp4', filemoon: false },
            { name: 'S-mp4', filemoon: false },
            { name: 'Luf-Mp4', filemoon: false },
            { name: 'Fm-mp4', filemoon: true }
        ];

        const results = await Promise.all(providerDefs.map(async (prov) => {
            const entry = respLines.find(r => r.sourceName === prov.name);
            if (!entry) return [];
            if (entry.url) return [{ resolution: entry.resolution || 'Yt', url: entry.url }];
            const decodedPath = decodeProviderId(entry.hex);
            if (!decodedPath) return [];
            return prov.filemoon ? getFilemoonLinks(decodedPath) : getLinks(decodedPath);
        }));

        let allLinks = results.flat();
        if (allLinks.length === 0) return null;

        allLinks.sort((a, b) => (parseInt(b.resolution) || 0) - (parseInt(a.resolution) || 0));

        let selected;
        if (quality === 'best') selected = allLinks[0];
        else if (quality === 'worst') {
            const numeric = allLinks.filter(l => /^\d+/.test(l.resolution));
            selected = numeric.length > 0 ? numeric[numeric.length - 1] : allLinks[allLinks.length - 1];
        } else {
            selected = allLinks.find(l => l.resolution.includes(quality)) || allLinks[0];
        }

        return selected.url.replace(/([^:])\/\//g, '$1/');
    } catch (e) {
        if (e.message && e.message.startsWith('NEED_CAPTCHA')) throw e;
        return null;
    }
};

exports.getEpisodeInfo = async function(showId, epNo) {
    try {
        const epNum = parseFloat(epNo);
        const data = await apiFetch(`query ($showId: String!, $epNum: Float!) {
            episodeInfos( showId: $showId episodeNumStart: $epNum episodeNumEnd: $epNum ) {
                episodeIdNum notes description thumbnails
            }
        }`, { showId, epNum });

        const infos = data.data.episodeInfos;
        if (!infos || infos.length === 0) return null;

        const info = infos[0];
        let thumbnails = (info.thumbnails || []).map(t => t.startsWith('/') ? `https://${ALLANIME_BASE}${t}` : t);

        return {
            episode_no: info.episodeIdNum,
            title: info.notes || '',
            description: info.description || '',
            thumbnails
        };
    } catch (e) { return null; }
};