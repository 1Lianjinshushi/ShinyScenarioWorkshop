'use strict';

(function exposeScenarioCsvTranslation(globalScope) {
    function parseCsvRows(text) {
        const rows = [];
        let row = [];
        let field = '';
        let quoted = false;

        for (let i = 0; i < String(text || '').length; i++) {
            const ch = text[i];
            if (quoted) {
                if (ch === '"') {
                    if (text[i + 1] === '"') {
                        field += '"';
                        i++;
                    } else {
                        quoted = false;
                    }
                } else {
                    field += ch;
                }
                continue;
            }

            if (ch === '"' && field.length === 0) {
                quoted = true;
            } else if (ch === ',') {
                row.push(field);
                field = '';
            } else if (ch === '\r' || ch === '\n') {
                if (ch === '\r' && text[i + 1] === '\n') i++;
                row.push(field);
                rows.push(row);
                row = [];
                field = '';
            } else {
                field += ch;
            }
        }

        if (field.length > 0 || row.length > 0) {
            row.push(field);
            rows.push(row);
        }
        return rows;
    }

    function parseScenarioCsv(text) {
        const rows = parseCsvRows(String(text || '').replace(/^\uFEFF/, ''));
        const headerIndex = rows.findIndex((row) => {
            const normalized = row.map(cell => String(cell || '').trim().toLowerCase());
            return ['id', 'name', 'text', 'trans'].every(key => normalized.includes(key));
        });
        if (headerIndex < 0) {
            throw new Error('CSV header id,name,text,trans was not found.');
        }

        const header = rows[headerIndex].map(cell => String(cell || '').trim().toLowerCase());
        const indexes = Object.fromEntries(['id', 'name', 'text', 'trans'].map(key => [key, header.indexOf(key)]));
        return rows.slice(headerIndex + 1).map((row, offset) => ({
            id: String(row[indexes.id] || '').trim(),
            name: String(row[indexes.name] || '').trim(),
            text: String(row[indexes.text] || ''),
            trans: String(row[indexes.trans] || ''),
            rowNumber: headerIndex + offset + 2,
        }));
    }

    function encodeCsvCell(value) {
        const text = String(value == null ? '' : value);
        return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    function serializeCsvRows(rows) {
        return `${rows.map(row => row.map(encodeCsvCell).join(',')).join('\n')}\n`;
    }

    function toStoredTranslation(value) {
        return String(value == null ? '' : value)
            .replace(/\\n/g, '\n')
            .replace(/\r\n|\r|\n/g, '\\n');
    }

    function createEditableScenarioCsv(tracks) {
        if (!Array.isArray(tracks)) throw new Error('Scenario JSON must be an array.');
        const rows = [['id', 'name', 'text', 'trans']];
        tracks.forEach((track) => {
            if (!track || typeof track !== 'object' || Array.isArray(track)) return;
            const field = typeof track.text === 'string'
                ? 'text'
                : typeof track.select === 'string'
                    ? 'select'
                    : '';
            if (!field) return;
            const id = field === 'select'
                ? 'select'
                : String(track.id == null || track.id === '' ? '0000000000000' : track.id);
            const name = field === 'select' ? '' : String(track.speaker || '');
            const source = toStoredTranslation(track[field]);
            rows.push([id, name, source, '']);
        });
        return `\uFEFF${serializeCsvRows(rows)}`;
    }

    function updateScenarioCsvTranslation(csvText, rowNumber, translatedText) {
        const input = String(csvText || '');
        const hasBom = input.startsWith('\uFEFF');
        const rows = parseCsvRows(input.replace(/^\uFEFF/, ''));
        const headerIndex = rows.findIndex((row) => {
            const normalized = row.map(cell => String(cell || '').trim().toLowerCase());
            return ['id', 'name', 'text', 'trans'].every(key => normalized.includes(key));
        });
        if (headerIndex < 0) throw new Error('CSV header id,name,text,trans was not found.');
        const header = rows[headerIndex].map(cell => String(cell || '').trim().toLowerCase());
        const transIndex = header.indexOf('trans');
        const rowIndex = Number(rowNumber) - 1;
        if (!Number.isInteger(rowIndex) || rowIndex <= headerIndex || !rows[rowIndex]) {
            throw new Error(`CSV row ${rowNumber} was not found.`);
        }
        while (rows[rowIndex].length <= transIndex) rows[rowIndex].push('');
        rows[rowIndex][transIndex] = toStoredTranslation(translatedText);
        return `${hasBom ? '\uFEFF' : ''}${serializeCsvRows(rows)}`;
    }

    function inferScenarioEventId(rowsOrText) {
        const rows = Array.isArray(rowsOrText) ? rowsOrText : parseScenarioCsv(rowsOrText);
        const trackIds = rows
            .map(row => String(row && row.id != null ? row.id : '').trim())
            .filter(id => /^\d+$/.test(id) && !/^0+$/.test(id));
        if (!trackIds.length) {
            throw new Error('CSV 的 id 列中没有可用于识别剧情编号的原始轨道 ID。');
        }

        const eventIds = new Set();
        trackIds.forEach((trackId) => {
            if (trackId.length <= 4) return;
            const eventId = trackId.slice(0, -4);
            if (/^\d{6,12}$/.test(eventId)) eventIds.add(eventId);
        });
        if (!eventIds.size) {
            throw new Error('CSV 的轨道 ID 不是“剧情编号 + 四位轨道序号”格式，无法自动识别剧情编号。');
        }
        if (eventIds.size > 1) {
            throw new Error(`CSV 的 id 列包含多个剧情编号：${Array.from(eventIds).slice(0, 4).join('、')}`);
        }
        return Array.from(eventIds)[0];
    }

    function normalizeForMatch(value) {
        return String(value == null ? '' : value)
            .replace(/\\n/g, '\n')
            .replace(/\r\n|\r/g, '\n')
            .trim();
    }

    function toScenarioText(value) {
        return String(value == null ? '' : value)
            .replace(/\\n/g, '\n')
            .replace(/\r\n|\r|\n/g, '\r\n');
    }

    function isGenericId(id) {
        const normalized = String(id == null ? '' : id).trim().toLowerCase();
        // Choice rows exported by the translation tools use the semantic id
        // "select". Source scenario choice tracks have no matching id, so
        // these rows must be matched sequentially by their Japanese text.
        return !normalized || /^0+$/.test(normalized) || normalized === 'select';
    }

    function chooseField(track, sourceText) {
        const source = normalizeForMatch(sourceText);
        if (typeof track.text === 'string' && normalizeForMatch(track.text) === source) return 'text';
        if (typeof track.select === 'string' && normalizeForMatch(track.select) === source) return 'select';
        if (typeof track.text === 'string') return 'text';
        if (typeof track.select === 'string') return 'select';
        return null;
    }

    function mergeScenarioTranslation(tracks, csvText) {
        if (!Array.isArray(tracks)) throw new Error('Scenario JSON must be an array.');
        const translatedTracks = tracks.map(track => (
            track && typeof track === 'object' && !Array.isArray(track)
                ? Object.assign({}, track)
                : track
        ));
        const sourceRows = parseScenarioCsv(csvText);
        const translationRows = sourceRows.filter(row => (
            row.id && row.id !== 'info' && row.id !== '译者' && row.trans.trim()
        ));
        const report = {
            total: translationRows.length,
            applied: 0,
            explicitId: 0,
            sequential: 0,
            sourceMismatches: 0,
            missing: 0,
            problems: [],
            bindings: [],
        };

        const genericCandidates = translatedTracks
            .map((track, index) => ({ track, index }))
            .filter(({ track }) => {
                if (!track || typeof track !== 'object') return false;
                if (!isGenericId(String(track.id == null ? '' : track.id))) return false;
                return typeof track.text === 'string' || typeof track.select === 'string';
            });
        let genericCursor = 0;

        const applyRow = (track, trackIndex, row, method) => {
            const field = chooseField(track, row.text);
            if (!field) {
                report.missing++;
                report.problems.push(`CSV row ${row.rowNumber}: matching track has no text/select field.`);
                return;
            }
            if (normalizeForMatch(track[field]) !== normalizeForMatch(row.text)) {
                report.sourceMismatches++;
                report.problems.push(`CSV row ${row.rowNumber}: source text differs for id ${row.id}.`);
            }
            track[`${field}_cn`] = toScenarioText(row.trans);
            report.applied++;
            report[method]++;
            report.bindings.push({
                trackIndex,
                rowNumber: row.rowNumber,
                field,
                id: row.id,
                name: row.name,
                text: row.text,
                trans: row.trans,
                method,
            });
        };

        translationRows.forEach((row) => {
            if (!isGenericId(row.id)) {
                const trackIndex = translatedTracks.findIndex(item => (
                    item && typeof item === 'object' && String(item.id == null ? '' : item.id) === row.id
                ));
                if (trackIndex < 0) {
                    report.missing++;
                    report.problems.push(`CSV row ${row.rowNumber}: track id ${row.id} was not found.`);
                    return;
                }
                applyRow(translatedTracks[trackIndex], trackIndex, row, 'explicitId');
                return;
            }

            const wantedText = normalizeForMatch(row.text);
            let matchAt = -1;
            for (let i = genericCursor; i < genericCandidates.length; i++) {
                const candidate = genericCandidates[i].track;
                const textMatches = typeof candidate.text === 'string'
                    && normalizeForMatch(candidate.text) === wantedText;
                const selectMatches = typeof candidate.select === 'string'
                    && normalizeForMatch(candidate.select) === wantedText;
                if (textMatches || selectMatches) {
                    matchAt = i;
                    break;
                }
            }
            if (matchAt < 0) {
                report.missing++;
                report.problems.push(`CSV row ${row.rowNumber}: zero-id source text was not found in sequence.`);
                return;
            }
            genericCursor = matchAt + 1;
            applyRow(genericCandidates[matchAt].track, genericCandidates[matchAt].index, row, 'sequential');
        });

        // Editing mode also needs a stable CSV-row binding for untranslated rows.
        // Build these independently from the applied-translation report so the
        // existing applied/missing counters keep their original meaning.
        const bindingRows = sourceRows.filter(row => (
            row.id && row.id !== 'info' && row.id !== '译者' && (row.text || row.trans)
        ));
        const editBindings = [];
        let editGenericCursor = 0;
        bindingRows.forEach((row) => {
            let trackIndex = -1;
            let method = 'explicitId';
            if (!isGenericId(row.id)) {
                trackIndex = translatedTracks.findIndex(item => (
                    item && typeof item === 'object' && String(item.id == null ? '' : item.id) === row.id
                ));
            } else {
                method = 'sequential';
                const wantedText = normalizeForMatch(row.text);
                for (let i = editGenericCursor; i < genericCandidates.length; i++) {
                    const candidate = genericCandidates[i].track;
                    const textMatches = typeof candidate.text === 'string'
                        && normalizeForMatch(candidate.text) === wantedText;
                    const selectMatches = typeof candidate.select === 'string'
                        && normalizeForMatch(candidate.select) === wantedText;
                    if (textMatches || selectMatches) {
                        trackIndex = genericCandidates[i].index;
                        editGenericCursor = i + 1;
                        break;
                    }
                }
            }
            if (trackIndex < 0) return;
            const track = translatedTracks[trackIndex];
            const field = chooseField(track, row.text);
            if (!field) return;
            editBindings.push({
                trackIndex,
                rowNumber: row.rowNumber,
                field,
                id: row.id,
                name: row.name,
                text: row.text,
                trans: row.trans,
                method,
            });
        });
        report.bindings = editBindings;

        return { tracks: translatedTracks, report };
    }

    async function loadTranslation(eventType, eventId) {
        const safeType = String(eventType || '').replace(/[^a-z0-9_-]/gi, '');
        const safeId = String(eventId || '').replace(/[^a-z0-9_-]/gi, '');
        const candidates = [
            `./translations/${safeType}/${safeId}.csv`,
            `./translations/${safeId}.csv`,
        ];
        const errors = [];
        for (const url of candidates) {
            try {
                const response = await fetch(`${url}?_=${Date.now()}`, { cache: 'no-store' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return { url, text: await response.text() };
            } catch (error) {
                errors.push(`${url}: ${error.message}`);
            }
        }
        return { url: null, text: null, errors };
    }

    const api = {
        parseCsvRows,
        parseScenarioCsv,
        serializeCsvRows,
        toStoredTranslation,
        createEditableScenarioCsv,
        updateScenarioCsvTranslation,
        inferScenarioEventId,
        mergeScenarioTranslation,
        loadTranslation,
        normalizeForMatch,
        toScenarioText,
    };
    globalScope.ScenarioCsvTranslation = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
