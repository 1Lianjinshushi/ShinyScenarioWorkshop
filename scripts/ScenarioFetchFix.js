'use strict';

const SSV_JAPANESE_FONT = 'FOT-Humming Pro B';
const SSV_CHINESE_FONT = '方正FW轻吟体 简 B';

const ssvLegacyFontPromise = Promise.all([
    new FontFace(SSV_JAPANESE_FONT, 'url("./fonts/FOT-HummingPro-B.OTF") format("opentype")').load(),
    new FontFace(SSV_CHINESE_FONT, 'url("./fonts/FZFWQINGYINTIJWB.TTF") format("truetype")').load(),
]).then((faces) => {
    faces.forEach(face => document.fonts.add(face));
    return faces;
});

// Match the supplied player fonts: FOT Humming for Japanese and FZ FW QingYin
// for all Chinese dialogue, including localized speaker names.
applyScenarioLanguage = function applyLegacyScenarioLanguage(language) {
    const selectedFont = language === 'cn' ? SSV_CHINESE_FONT : SSV_JAPANESE_FONT;
    USED_FONT.length = 0;
    USED_FONT.push(selectedFont);
    USED_FONT_SPEAKER.length = 0;
    USED_FONT_SPEAKER.push(selectedFont);
};

loadScenarioFonts = function loadLegacyScenarioFonts() {
    return Promise.race([
        ssvLegacyFontPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('font timeout')), FONT_TIMEOUT)),
    ]);
};

ScenarioPlayer.prototype._ensureSpeakerObj = function ensureLegacySpeakerObj() {
    if (this._speakerObj) return;
    this._speakerObj = new PIXI.Text('', {
        fontFamily: USED_FONT_SPEAKER,
        fontSize: 25,
        fill: 0x555555,
        align: 'center',
        padding: 3,
    });
    this._speakerObj.position.set(this._speakerPos.x, this._speakerPos.y);
    this._container.addChild(this._speakerObj);
};

// service.sc-viewer.top treats cache-busting query strings as a different
// route and returns an HTML fallback page. Request scenario JSON by exact path.
ssvFetchScenarioJson = async function ssvFetchScenarioJsonExactPath(url) {
    const response = await fetch(url, { cache: 'no-store', mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const body = await response.text();
    let data;
    try {
        data = JSON.parse(body);
    } catch (_) {
        const contentType = response.headers.get('content-type') || 'unknown content type';
        const preview = body.slice(0, 80).replace(/\s+/g, ' ').trim();
        throw new Error(`Expected JSON, got ${contentType}: ${preview}`);
    }

    if (!Array.isArray(data) || data.length === 0) {
        throw new Error('JSON is not a non-empty track array');
    }
    return data;
};

// Load the persistent speaker-name archive alongside the selected translation.
let ssvSpeakerTranslations = new Map();
const ssvOriginalTranslationLoader = ScenarioCsvTranslation.loadTranslation;
ScenarioCsvTranslation.loadTranslation = async function loadTranslationAndSpeakers(eventType, eventId) {
    const [translation, speakerResponse] = await Promise.all([
        ssvOriginalTranslationLoader(eventType, eventId),
        fetch('./speaker/speaker.csv', { cache: 'no-store' }).catch(() => null),
    ]);
    if (speakerResponse && speakerResponse.ok) {
        const rows = ScenarioCsvTranslation.parseCsvRows((await speakerResponse.text()).replace(/^\uFEFF/, ''));
        const header = rows.shift() || [];
        const nameIndex = header.findIndex(cell => String(cell).trim().toLowerCase() === 'name');
        const transIndex = header.findIndex(cell => String(cell).trim().toLowerCase() === 'trans');
        ssvSpeakerTranslations = new Map(rows
            .map(row => [String(row[nameIndex] || '').trim(), String(row[transIndex] || '').trim()])
            .filter(([name, trans]) => name && trans));
    }
    return translation;
};

const ssvOriginalTranslationMerger = ScenarioCsvTranslation.mergeScenarioTranslation;
ScenarioCsvTranslation.mergeScenarioTranslation = function mergeTextAndSpeakerTranslations(tracks, csvText) {
    const merged = ssvOriginalTranslationMerger(tracks, csvText);
    let translatedSpeakers = 0;
    merged.tracks = merged.tracks.map((track) => {
        if (!track || typeof track !== 'object' || !track.speaker) return track;
        const translated = ssvSpeakerTranslations.get(String(track.speaker).trim());
        if (!translated || translated === track.speaker) return track;
        translatedSpeakers++;
        return Object.assign({}, track, {
            speaker_ja: track.speaker,
            speaker_cn: translated,
            speaker: translated,
        });
    });
    merged.report.translatedSpeakers = translatedSpeakers;
    return merged;
};

// Correct the hybrid layer's status label without changing upstream player UI.
ssvAddStatusToOverlay = function ssvAddReadableStatus(overlay, source, translationReport) {
    const parts = [source.kind === 'remote' ? 'Remote assets' : 'Local assets'];
    if (translationReport) {
        parts.push(`中文 ${translationReport.applied}/${translationReport.total}`);
    }
    const status = new PIXI.Text(parts.join('  ·  '), {
        fontFamily: USED_FONT,
        fontSize: 18,
        fill: translationReport && translationReport.applied < translationReport.total ? 0xffc266 : 0xc8bfd8,
        align: 'center',
    });
    status.anchor.set(0.5);
    status.position.set(568, 402);
    overlay.addChild(status);
};
