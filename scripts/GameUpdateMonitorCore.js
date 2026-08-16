(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.GameUpdateMonitorCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const SCENARIO_TYPES = new Set([
        'business_unit_communication',
        'produce_communication_auditions',
        'produce_communication_promise_results',
        'produce_communication_televisions',
        'support_skills',
        'game_event_communications',
        'produce_communication_cheers',
        'produce_communications',
        'produce_events',
        'mypage_communications',
        'produce_communication_judges',
        'produce_communications_promises',
        'special_communications',
    ]);

    const TRAINING_SCENARIO_TYPES = new Set([
        'produce_communication_auditions',
        'produce_communication_promise_results',
        'produce_communication_televisions',
        'produce_communication_cheers',
        'produce_communications',
        'produce_communication_judges',
        'produce_communications_promises',
        'support_skills',
    ]);

    const CHARACTERS = Object.freeze({
        '001': { jp: '櫻木真乃', zh: '樱木真乃' },
        '002': { jp: '風野灯織', zh: '风野灯织' },
        '003': { jp: '八宮めぐる', zh: '八宫巡' },
        '004': { jp: '月岡恋鐘', zh: '月冈恋钟' },
        '005': { jp: '田中摩美々', zh: '田中摩美美' },
        '006': { jp: '白瀬咲耶', zh: '白濑咲耶' },
        '007': { jp: '三峰結華', zh: '三峰结华' },
        '008': { jp: '幽谷霧子', zh: '幽谷雾子' },
        '009': { jp: '小宮果穂', zh: '小宫果穗' },
        '010': { jp: '園田智代子', zh: '园田智代子' },
        '011': { jp: '西城樹里', zh: '西城树里' },
        '012': { jp: '杜野凛世', zh: '杜野凛世' },
        '013': { jp: '有栖川夏葉', zh: '有栖川夏叶' },
        '014': { jp: '大崎甘奈', zh: '大崎甘奈' },
        '015': { jp: '大崎甜花', zh: '大崎甜花' },
        '016': { jp: '桑山千雪', zh: '桑山千雪' },
        '017': { jp: '芹沢あさひ', zh: '芹泽朝日' },
        '018': { jp: '黛冬優子', zh: '黛冬优子' },
        '019': { jp: '和泉愛依', zh: '和泉爱依' },
        '020': { jp: '浅倉透', zh: '浅仓透' },
        '021': { jp: '樋口円香', zh: '樋口圆香' },
        '022': { jp: '福丸小糸', zh: '福丸小糸' },
        '023': { jp: '市川雛菜', zh: '市川雏菜' },
        '024': { jp: '七草にちか', zh: '七草日花' },
        '025': { jp: '緋田美琴', zh: '绯田美琴' },
        '026': { jp: '斑鳩ルカ', zh: '斑鸠路加' },
        '027': { jp: '鈴木羽那', zh: '铃木羽那' },
        '028': { jp: '郁田はるき', zh: '郁田阳希' },
        '091': { jp: '七草はづき', zh: '七草叶月' },
        '801': { jp: 'ルビー', zh: '露比' },
        '802': { jp: '有馬かな', zh: '加奈' },
        '803': { jp: 'MEMちょ', zh: 'MEM啾' },
        '804': { jp: '黒川あかね', zh: '茜音' },
    });

    const CHARACTER_SHORT_NAMES = Object.freeze({
        '001': '真乃', '002': '灯织', '003': '巡', '004': '恋钟',
        '005': '摩美美', '006': '咲耶', '007': '结华', '008': '雾子',
        '009': '果穗', '010': '智代子', '011': '树里', '012': '凛世',
        '013': '夏叶', '014': '甘奈', '015': '甜花', '016': '千雪',
        '017': '朝日', '018': '冬优子', '019': '爱依', '020': '透',
        '021': '圆香', '022': '小糸', '023': '雏菜', '024': '日花',
        '025': '美琴', '026': '路加', '027': '羽那', '028': '阳希',
        '091': '叶月',
        '801': '露比', '802': '加奈',
        '803': 'MEM啾', '804': '茜音',
    });

    const CHARACTER_DISPLAY_ORDER = Object.freeze([
        '001', '002', '003', '004', '005', '006', '007', '008',
        '009', '010', '011', '012', '013', '014', '015', '016',
        '017', '018', '019', '020', '021', '022', '023', '024',
        '025', '026', '027', '028', '091',
    ]);

    // Four 2020 birthday rows were placed under 49021 instead of the regular
    // 4902002 batch. Keep the correction exact so the unrelated 4902100
    // anniversary-like batch is never swallowed by the birthday rule.
    const BIRTHDAY_ID_EXCEPTIONS = Object.freeze({
        '490210108': { batchKey: '4902002', birthdayBatch: '002', birthdayYear: 2020, characterId: '008' },
        '490210112': { batchKey: '4902002', birthdayBatch: '002', birthdayYear: 2020, characterId: '012' },
        '490210113': { batchKey: '4902002', birthdayBatch: '002', birthdayYear: 2020, characterId: '013' },
        '490210119': { batchKey: '4902002', birthdayBatch: '002', birthdayYear: 2020, characterId: '019' },
    });

    const UNITS = Object.freeze({
        stars: { label: '星组', official: 'illumination STARS', eventLabel: '星组组活', sortKey: '01' },
        lantica: { label: '安提卡', official: "L'Antica", eventLabel: '安提卡组活', sortKey: '02' },
        houkago: { label: '放课后', official: '放課後クライマックスガールズ', eventLabel: '放课后组活', sortKey: '03' },
        alstroemeria: { label: '花组', official: 'ALSTROEMERIA', eventLabel: '花组组活', sortKey: '04' },
        straylight: { label: '迷光', official: 'Straylight', eventLabel: '迷光组活', sortKey: '05' },
        noctchill: { label: '水组', official: 'noctchill', eventLabel: '水组组活', sortKey: '06' },
        shhis: { label: '嘘组', official: 'SHHis', eventLabel: '嘘组组活', sortKey: '07' },
        cometik: { label: '黑星', official: 'CoMETIK', eventLabel: '黑星组活', sortKey: '08' },
        office: { label: '283Pro', official: '283プロ', eventLabel: '283Pro剧情', sortKey: '09' },
        bkomachi: { label: 'B小町', official: 'B小町', eventLabel: 'B小町联动', sortKey: '80' },
        lalalai: { label: '剧团Lalalai', official: '劇団ラライ', eventLabel: '剧团Lalalai联动', sortKey: '81' },
        unknown: { label: '其他角色', official: '未分组', eventLabel: '组别待确认', sortKey: '99' },
    });

    const CHARACTER_UNITS = Object.freeze({
        '001': 'stars', '002': 'stars', '003': 'stars',
        '004': 'lantica', '005': 'lantica', '006': 'lantica', '007': 'lantica', '008': 'lantica',
        '009': 'houkago', '010': 'houkago', '011': 'houkago', '012': 'houkago', '013': 'houkago',
        '014': 'alstroemeria', '015': 'alstroemeria', '016': 'alstroemeria',
        '017': 'straylight', '018': 'straylight', '019': 'straylight',
        '020': 'noctchill', '021': 'noctchill', '022': 'noctchill', '023': 'noctchill',
        '024': 'shhis', '025': 'shhis',
        '026': 'cometik', '027': 'cometik', '028': 'cometik',
        '091': 'office',
        '801': 'bkomachi', '802': 'bkomachi', '803': 'bkomachi', '804': 'lalalai',
    });

    const PRODUCE_MODE_LABELS = Object.freeze({
        '000': 'WING序章',
        '001': 'WING',
        '002': '粉丝感谢祭',
        '003': 'GRAD',
        '004': 'LP',
        '005': 'STEP',
    });

    const PRODUCE_MODE_SECTION_LABELS = Object.freeze({
        '000': 'W.I.N.G.序章',
        '001': 'W.I.N.G.篇',
        '002': '283事务所粉丝感谢祭篇',
        '003': 'G.R.A.D.篇',
        '004': 'Landing Point篇',
        '005': 'S.T.E.P.篇',
        common: '共通育成剧情',
    });

    const PRODUCE_COMMON_GROUP_LABELS = Object.freeze({
        '5/002': '粉丝感谢祭篇《偶像／组合》',
        '5/004': 'Landing Point篇《组合》',
        '6/001': 'W.I.N.G.篇・半决赛／决赛',
        '6/002': '粉丝感谢祭篇・正式演出',
        '6/003': 'G.R.A.D.篇・比赛剧情',
        '6/004': 'Landing Point篇《个人》',
        '7/001': 'W.I.N.G.篇・赛季结果',
    });

    const PRODUCE_COMMON_STORY_LABELS = Object.freeze({
        '6/001/01': '準決勝前コミュ',
        '6/001/02': '敗退コミュ',
        '6/001/03': '準決勝後コミュ',
        '6/001/04': '決勝前コミュ',
        '6/001/06': '決勝後コミュ',
        '6/001/07': '未来へ羽ばたく',
        '6/001/09': 'これからも飛んでいきたい',
        '7/001/01': 'シーズン1（クリア）',
        '7/001/02': 'シーズン1（失敗）',
        '7/001/03': 'シーズン2（クリア）',
        '7/001/04': 'シーズン2（失敗）',
        '7/001/05': 'シーズン3（クリア）',
        '7/001/06': 'シーズン3（失敗）',
        '7/001/07': 'シーズン4（クリア）',
        '7/001/08': 'シーズン4（失敗）',
    });

    // 同一节日曾先后使用 49010BBII 与 490BB0III 两套编号。
    // 这里按 SC-VIEWER Common 目录及已核对的实际台词维护稳定名称。
    const HOLIDAY_BATCH_INFO = Object.freeze({
        halloween2019: { label: '2019年万圣节剧情', kind: '万圣节' },
        '4901007': { label: '2019年圣诞节剧情', kind: '圣诞节' },
        '4901008': { label: '2020年情人节剧情', kind: '情人节' },
        '4901009': { label: '2020年白色情人节剧情', kind: '白色情人节' },
        '4901016': { label: '2020年万圣节剧情', kind: '万圣节' },
        '4901017': { label: '2020年圣诞节剧情', kind: '圣诞节' },
        '4901018': { label: '2021年情人节剧情', kind: '情人节' },
        '4901019': { label: '2021年白色情人节剧情', kind: '白色情人节' },
        '4901025': { label: '2021年万圣节剧情', kind: '万圣节' },
        '4901026': { label: '2021年圣诞节剧情', kind: '圣诞节' },
        '4901028': { label: '2022年情人节剧情', kind: '情人节' },
        '4901029': { label: '2022年白色情人节剧情', kind: '白色情人节' },
        '4901034': { label: '2022年万圣节剧情', kind: '万圣节' },
        '4901035': { label: '2022年圣诞节剧情', kind: '圣诞节' },
        '4901037': { label: '2023年情人节剧情', kind: '情人节' },
        '4901038': { label: '2023年白色情人节剧情', kind: '白色情人节' },
        '4901043': { label: '2023年万圣节剧情', kind: '万圣节' },
        '49011': { label: '2023年圣诞节剧情', kind: '圣诞节' },
        '49012': { label: '2024年情人节剧情', kind: '情人节' },
        '49013': { label: '2024年白色情人节剧情', kind: '白色情人节' },
        '49016': { label: '2024年万圣节剧情', kind: '万圣节' },
        '49017': { label: '2024年圣诞节剧情', kind: '圣诞节' },
        '49018': { label: '2025年情人节剧情', kind: '情人节' },
        '49019': { label: '2025年白色情人节剧情', kind: '白色情人节' },
        '49022': { label: '2025年万圣节剧情', kind: '万圣节' },
        '49023': { label: '2025年圣诞节剧情', kind: '圣诞节' },
        '49024': { label: '2026年情人节剧情', kind: '情人节' },
        '49025': { label: '2026年白色情人节剧情', kind: '白色情人节' },
    });

    const SCENARIO_TYPE_LABELS = Object.freeze({
        business_unit_communication: '事务所剧情',
        produce_communication_auditions: '试镜剧情',
        produce_communication_promise_results: '约定结果剧情',
        produce_communication_televisions: '电视出演剧情',
        support_skills: 'Support技能剧情',
        game_event_communications: '活动剧情',
        produce_communication_cheers: '应援剧情',
        produce_communications: '育成交流剧情',
        produce_events: '偶像剧情',
        mypage_communications: '主页剧情',
        produce_communication_judges: '评审剧情',
        produce_communications_promises: '约定剧情',
        special_communications: '特殊剧情',
    });

    function normalizePath(value) {
        return String(value || '')
            .replace(/\\/g, '/')
            .replace(/[?#].*$/, '')
            .replace(/^https?:\/\/[^/]+\//i, '')
            .replace(/^\/+/, '');
    }

    function parseScenarioPath(value) {
        const path = normalizePath(value);
        const match = path.match(/(?:^|\/)json\/([a-z0-9_-]+)\/([a-z0-9_-]+)\.json$/i);
        if (!match) return null;
        const eventType = match[1].toLowerCase();
        if (!SCENARIO_TYPES.has(eventType)) return null;
        const eventId = match[2];
        return {
            key: `${eventType}/${eventId}`,
            eventType,
            eventId,
            path: `json/${eventType}/${eventId}.json`,
        };
    }

    function inferCardIdentity(eventType, eventId) {
        const value = String(eventId || '');
        if (eventType !== 'produce_events' || !/^[23]\d{8}$/.test(value)) return {};
        const characterId = value.slice(1, 4);
        const character = CHARACTERS[characterId] || {};
        const cardType = value[0] === '2' ? 'Produce' : 'Support';
        return {
            characterId,
            characterName: character.zh || character.jp || `角色${characterId}`,
            characterNameJp: character.jp || '',
            cardType,
            cardSequence: value.slice(4, 7),
            storySequence: value.slice(7, 9),
        };
    }

    function characterIdentity(characterId) {
        const character = CHARACTERS[characterId] || {};
        return {
            characterId,
            characterName: character.zh || character.jp || `角色${characterId}`,
            characterNameJp: character.jp || '',
        };
    }

    function storyLabel(sequence) {
        if (!sequence) return '';
        if (sequence === '11') return 'True End';
        return `第${sequence}话`;
    }

    function isProduceModeMainSequence(mode, sequence) {
        const value = String(sequence || '');
        const rules = {
            '000': new Set(['01', '02']),
            '001': new Set(['01', '02', '03', '04', '05', '11']),
            '002': new Set(['01', '02', '11']),
            '003': new Set(['01', '02', '03', '04', '05', '09']),
            '004': new Set(['01', '02', '03', '04', '05', '06']),
            '005': new Set(['01', '02', '03', '04', '05', '06']),
        };
        return Boolean(rules[mode] && rules[mode].has(value));
    }

    function holidayScenarioInfo(eventType, eventId) {
        const type = String(eventType || '').toLowerCase();
        const value = String(eventId || '');
        if (!['special_communications', 'mypage_communications'].includes(type)) return null;
        if (/^halloween2019_/i.test(value)) {
            return Object.assign({ batchKey: 'halloween2019', storySequence: value.split('_').pop() || '' }, HOLIDAY_BATCH_INFO.halloween2019);
        }
        let match = value.match(/^(49010(\d{2}))(\d{2})$/);
        if (match && HOLIDAY_BATCH_INFO[match[1]]) {
            return Object.assign({ batchKey: match[1], storySequence: match[3] }, HOLIDAY_BATCH_INFO[match[1]]);
        }
        match = value.match(/^(490(\d{2}))0(\d{3})$/);
        if (match && HOLIDAY_BATCH_INFO[match[1]]) {
            return Object.assign({ batchKey: match[1], storySequence: match[3] }, HOLIDAY_BATCH_INFO[match[1]]);
        }
        return null;
    }

    function birthdayScenarioInfo(eventType, eventId) {
        if (String(eventType || '').toLowerCase() !== 'special_communications') return null;
        const value = String(eventId || '');
        if (BIRTHDAY_ID_EXCEPTIONS[value]) return Object.assign({}, BIRTHDAY_ID_EXCEPTIONS[value]);
        const match = value.match(/^(4902(00\d))(\d{2,3})$/);
        if (!match) return null;
        const batch = Number(match[2]);
        if (!batch) return null;
        const characterId = String(match[3]).padStart(3, '0');
        return {
            batchKey: match[1],
            birthdayBatch: match[2],
            birthdayYear: 2018 + batch,
            characterId,
        };
    }

    function inferTrainingMode(eventType, eventId) {
        const type = String(eventType || '');
        if (!TRAINING_SCENARIO_TYPES.has(type)) return '';
        const match = String(eventId || '').match(/^\d\d{3}(\d{3})/);
        return match && Object.prototype.hasOwnProperty.call(PRODUCE_MODE_SECTION_LABELS, match[1])
            ? match[1]
            : '';
    }

    function classifyScenario(eventType, eventId) {
        const type = String(eventType || '').toLowerCase();
        const value = String(eventId || '');
        const typeLabel = SCENARIO_TYPE_LABELS[type] || type || '其他剧情';
        const fallback = {
            category: 'other',
            categoryLabel: typeLabel,
            groupKey: `${type}/${value}`,
            groupCode: value,
            groupLabel: typeLabel,
            storySequence: '',
            storyLabel: '',
        };

        let match = value.match(/^([23])(\d{3})(\d{3})(\d{2})$/);
        if (type === 'produce_events' && match) {
            const cardType = match[1] === '2' ? 'Produce' : 'Support';
            const identity = characterIdentity(match[2]);
            return Object.assign({}, fallback, identity, {
                category: cardType === 'Produce' ? 'produce-card' : 'support-card',
                categoryLabel: cardType === 'Produce' ? 'P卡剧情' : 'S卡剧情',
                cardType,
                cardSequence: match[3],
                storySequence: match[4],
                storyLabel: storyLabel(match[4]),
                groupKey: `${type}/${value.slice(0, 7)}`,
                groupCode: `${value.slice(0, 7)}__`,
                groupLabel: `${identity.characterName}${cardType === 'Produce' ? 'P卡' : 'S卡'}`,
            });
        }

        match = value.match(/^1(\d{3})(\d{3})(\d{2,3})$/);
        if (type === 'produce_events' && match) {
            const identity = characterIdentity(match[1]);
            const modeLabel = PRODUCE_MODE_LABELS[match[2]] || `育成模式 ${match[2]}`;
            return Object.assign({}, fallback, identity, {
                category: 'produce-mode',
                categoryLabel: '个人育成剧情',
                produceMode: match[2],
                produceModeLabel: modeLabel,
                storySequence: match[3],
                storyLabel: storyLabel(match[3]),
                groupKey: `${type}/${value.slice(0, 7)}`,
                groupCode: `${value.slice(0, 7)}${'_'.repeat(match[3].length)}`,
                groupLabel: `${identity.characterName} · ${modeLabel}`,
            });
        }

        match = value.match(/^([567])(\d{3})(\d{3})(\d{2})$/);
        if (type === 'produce_events' && match) {
            const identity = characterIdentity(match[2]);
            const sectionLabel = PRODUCE_MODE_SECTION_LABELS[match[3]] || `育成模式 ${match[3]}`;
            const groupLabel = PRODUCE_COMMON_GROUP_LABELS[`${match[1]}/${match[3]}`] || sectionLabel;
            const commonStoryLabel = PRODUCE_COMMON_STORY_LABELS[`${match[1]}/${match[3]}/${match[4]}`];
            return Object.assign({}, fallback, identity, {
                category: 'produce-common',
                categoryLabel: '共通育成剧情',
                produceMode: match[3],
                produceModeLabel: sectionLabel,
                produceCommonKind: match[1],
                storySequence: match[4],
                storyLabel: commonStoryLabel || storyLabel(match[4]),
                groupKey: `${type}/${value.slice(0, 7)}`,
                groupCode: `${value.slice(0, 7)}__`,
                groupLabel,
            });
        }

        match = value.match(/^2000(\d{3})(\d{3})$/);
        if (type === 'produce_events' && match && CHARACTERS[match[1]]) {
            const identity = characterIdentity(match[1]);
            return Object.assign({}, fallback, identity, {
                category: 'produce-common',
                categoryLabel: '共通育成剧情',
                produceMode: 'common',
                produceModeLabel: PRODUCE_MODE_SECTION_LABELS.common,
                storySequence: match[2],
                storyLabel: storyLabel(match[2]),
                groupKey: `${type}/${value.slice(0, 7)}`,
                groupCode: `${value.slice(0, 7)}___`,
                groupLabel: '共通剧情',
            });
        }

        match = value.match(/^4001(\d{3})(\d{2})$/);
        if (type === 'game_event_communications' && match) {
            return Object.assign({}, fallback, {
                category: 'game-event',
                categoryLabel: '活动剧情',
                eventSequence: match[1],
                storySequence: match[2],
                storyLabel: storyLabel(match[2]),
                groupKey: `${type}/${value.slice(0, 7)}`,
                groupCode: `${value.slice(0, 7)}__`,
                groupLabel: `第${compactSequence(match[1])}次组活`,
            });
        }

        const birthdayInfo = birthdayScenarioInfo(type, value);
        if (birthdayInfo) {
            const identity = CHARACTERS[birthdayInfo.characterId] ? characterIdentity(birthdayInfo.characterId) : {};
            return Object.assign({}, fallback, identity, {
                category: 'special',
                categoryLabel: '生日剧情',
                specialKind: 'birthday',
                specialKindLabel: '生日剧情',
                specialBatch: birthdayInfo.birthdayBatch,
                birthdayYear: birthdayInfo.birthdayYear,
                groupKey: `${type}/birthday/${birthdayInfo.batchKey}`,
                groupCode: `${birthdayInfo.batchKey}___`,
                groupLabel: `${birthdayInfo.birthdayYear}年生日剧情`,
                storyLabel: identity.characterName || '',
            });
        }

        const holiday = holidayScenarioInfo(type, value);
        if (holiday) {
            return Object.assign({}, fallback, {
                category: 'special',
                categoryLabel: '节日剧情',
                specialKind: 'holiday',
                specialKindLabel: '节日剧情',
                holidayKind: holiday.kind,
                specialBatch: holiday.batchKey,
                storySequence: holiday.storySequence,
                storyLabel: storyLabel(holiday.storySequence),
                groupKey: `${type}/holiday/${holiday.batchKey}`,
                groupCode: `${holiday.batchKey}${'_'.repeat(Math.max(2, value.length - holiday.batchKey.length))}`,
                groupLabel: holiday.label,
            });
        }

        match = value.match(/^490(\d{2})0(\d{3})$/);
        if (type === 'special_communications' && match) {
            const identity = CHARACTERS[match[2]] ? characterIdentity(match[2]) : {};
            return Object.assign({}, fallback, identity, {
                category: 'special',
                categoryLabel: '特殊剧情',
                specialKind: 'special',
                specialKindLabel: '其他特殊剧情',
                specialBatch: match[1],
                groupKey: `${type}/490${match[1]}`,
                groupCode: `490${match[1]}____`,
                groupLabel: '特殊剧情',
                storyLabel: identity.characterName || '',
            });
        }

        if (/^\d{3,}$/.test(value)) {
            const sequence = value.slice(-2);
            const prefix = value.slice(0, -2);
            return Object.assign({}, fallback, {
                groupKey: `${type}/${prefix}`,
                groupCode: `${prefix}__`,
                storySequence: sequence,
                // Generic training/support snippets do not encode a story
                // order in their final two digits.  Treating 13/19/11 as
                // episode numbers (or True End) produced misleading labels.
                storyLabel: '',
            });
        }
        return fallback;
    }

    function specialSemanticLabel(entry, classification, partNumber) {
        const shortName = CHARACTER_SHORT_NAMES[classification.characterId]
            || classification.characterName
            || entry.characterName
            || '';
        const title = String(entry.storyTitle || '').trim();
        let semantic = '';
        if (classification.specialKind === 'birthday') {
            semantic = shortName ? `${shortName}生日` : '生日剧情';
        } else if (classification.specialKind === 'holiday') {
            const kind = classification.holidayKind || '节日';
            const suffix = partNumber ? String(partNumber).padStart(2, '0') : '';
            semantic = `${shortName || ''}${kind}${suffix}` || classification.groupLabel;
        }
        return semantic && title ? `${semantic}・${title}` : semantic || title;
    }

    function holidayRosterSize(group) {
        const total = group.length;
        if (total >= 58 && total % 29 === 0) return 29;
        if (total >= 56 && total % 28 === 0) return 28;
        const label = String(group[0] && group[0].classification.groupLabel || '');
        const yearMatch = label.match(/^(\d{4})年/);
        const year = yearMatch ? Number(yearMatch[1]) : 0;
        const historicalSize = year >= 2024 ? 28
            : year >= 2023 ? 26
                : year >= 2021 ? 25
                    : year >= 2020 ? 23
                        : year ? 19 : 0;
        return historicalSize && total % historicalSize === 0 ? historicalSize : 0;
    }

    // Add stable, semantic child labels before building either the full tree or
    // the update log. Official Japanese titles are optional suffixes: missing
    // catalogue data must never make a birthday/holiday row lose its identity.
    function decorateSpecialEntries(entries) {
        const result = (Array.isArray(entries) ? entries : []).map(entry => Object.assign({}, entry));
        const holidayGroups = new Map();
        for (const row of result) {
            const classification = classifyScenario(row.eventType, row.eventId);
            if (classification.specialKind === 'birthday') {
                row.characterId = row.characterId || classification.characterId || '';
                row.characterName = row.characterName || classification.characterName || '';
                row.stableStoryLabel = specialSemanticLabel(row, classification, 0);
            } else if (classification.specialKind === 'holiday') {
                const key = classification.groupKey;
                if (!holidayGroups.has(key)) holidayGroups.set(key, []);
                holidayGroups.get(key).push({ row, classification });
            }
        }
        for (const group of holidayGroups.values()) {
            group.sort((a, b) => String(a.row.eventId || '').localeCompare(
                String(b.row.eventId || ''), undefined, { numeric: true }
            ));
            const rosterSize = holidayRosterSize(group);
            const storiesPerCharacter = rosterSize ? group.length / rosterSize : 0;
            const partCounts = new Map();
            group.forEach((item, index) => {
                let characterId = String(item.row.characterId || item.classification.characterId || '');
                if (!characterId && storiesPerCharacter) {
                    characterId = CHARACTER_DISPLAY_ORDER[Math.floor(index / storiesPerCharacter)] || '';
                }
                if (characterId) {
                    item.classification = Object.assign({}, item.classification, characterIdentity(characterId));
                    item.row.characterId = characterId;
                    item.row.characterName = item.classification.characterName;
                }
                const countKey = characterId || `unknown/${index}`;
                const partNumber = (partCounts.get(countKey) || 0) + 1;
                partCounts.set(countKey, partNumber);
                item.row.specialPartNumber = partNumber;
                item.row.stableStoryLabel = specialSemanticLabel(item.row, item.classification, partNumber);
            });
        }
        return result;
    }

    function groupScenarioEntries(entries, updateLogMode) {
        const groups = new Map();
        for (const entry of decorateSpecialEntries(entries)) {
            let classification = classifyScenario(entry.eventType, entry.eventId);
            if (updateLogMode && classification.specialKind === 'birthday' && classification.characterId) {
                classification = Object.assign({}, classification, {
                    groupKey: `${classification.groupKey}/${classification.characterId}`,
                    groupCode: `${classification.groupCode}/${classification.characterId}`,
                    groupLabel: `${classification.characterName || classification.characterId}生日剧情`,
                });
            }
            let group = groups.get(classification.groupKey);
            if (!group) {
                group = Object.assign({}, classification, {
                    eventType: entry.eventType,
                    children: [],
                    unreadCount: 0,
                });
                groups.set(classification.groupKey, group);
            }
            const child = Object.assign({}, classification, entry);
            group.children.push(child);
            if (entry.unread) group.unreadCount++;
            if (entry.cardName && /-card$/.test(classification.category)) {
                group.groupLabel = `${classification.groupLabel} · ${entry.cardName}`;
                group.cardName = entry.cardName;
            }
            if (entry.activityLabel && classification.category === 'game-event') {
                group.groupLabel = entry.activityLabel;
                group.activityLabel = entry.activityLabel;
            }
        }
        for (const group of groups.values()) {
            group.children.sort((a, b) => {
                const storyOrder = String(a.storySequence || '').localeCompare(String(b.storySequence || ''), undefined, { numeric: true });
                return storyOrder || String(a.eventId || '').localeCompare(String(b.eventId || ''), undefined, { numeric: true });
            });
        }
        const categoryOrder = {
            'game-event': 0,
            'produce-card': 1,
            'support-card': 2,
            'produce-mode': 3,
            'produce-common': 3,
            special: 4,
            other: 5,
        };
        return Array.from(groups.values()).sort((a, b) => {
            const typeOrder = (categoryOrder[a.category] ?? 99) - (categoryOrder[b.category] ?? 99);
            if (typeOrder) return typeOrder;
            return String(b.groupCode || '').localeCompare(String(a.groupCode || ''), undefined, { numeric: true });
        });
    }

    function compactSequence(value) {
        const text = String(value || '');
        if (!/^\d+$/.test(text)) return text;
        return String(Number(text));
    }

    function inferTrainingCharacterId(eventType, eventId) {
        const type = String(eventType || '');
        const value = String(eventId || '');
        if (type === 'produce_events') {
            let match = value.match(/^[1567](\d{3})/);
            if (!match) match = value.match(/^2000(\d{3})/);
            return match && CHARACTERS[match[1]] ? match[1] : '';
        }
        if (!TRAINING_SCENARIO_TYPES.has(type)) return '';
        const match = value.match(/^\d(\d{3})/);
        return match && CHARACTERS[match[1]] ? match[1] : '';
    }

    function aggregateBranch(node) {
        const children = Array.isArray(node.children) ? node.children : [];
        node.unreadCount = children.reduce((total, child) => total + Number(child.unreadCount || 0), 0);
        node.totalCount = children.reduce((total, child) => total + Number(child.totalCount || 0), 0);
        return node;
    }

    function compareLabel(a, b) {
        return String(a.sortKey || a.label || '').localeCompare(
            String(b.sortKey || b.label || ''), undefined, { numeric: true }
        );
    }

    function hierarchyGroup(group) {
        const isCard = group.category === 'produce-card' || group.category === 'support-card';
        const cardNumber = compactSequence(group.cardSequence);
        const isProduceMode = group.category === 'produce-mode';
        const isProduceCommon = group.category === 'produce-common';
        const isTrainingGroup = isProduceMode || isProduceCommon || TRAINING_SCENARIO_TYPES.has(group.eventType);
        const holidayYear = group.specialKind === 'holiday' && String(group.groupLabel || '').match(/^(\d{4})年/);
        const holidayKindOrder = { 情人节: '1', 白色情人节: '2', 万圣节: '3', 圣诞节: '4' };
        const specialSortKey = holidayYear
            ? `${String(9999 - Number(holidayYear[1])).padStart(4, '0')}/${holidayKindOrder[group.holidayKind] || '9'}`
            : group.groupCode;
        return {
            kind: 'scenario-group',
            treeKey: `group/${group.groupKey}`,
            label: isCard
                ? `第${cardNumber}张${group.cardName ? ` · ${group.cardName}` : ''}`
                : isProduceMode ? (group.produceMode === '000' ? '序章' : '个人剧情') : isProduceCommon ? group.groupLabel : group.groupLabel,
            code: group.groupCode,
            description: group.categoryLabel,
            category: group.category,
            eventType: group.eventType,
            cardName: group.cardName || '',
            activityLabel: group.activityLabel || '',
            specialKind: group.specialKind || '',
            produceMode: group.produceMode || '',
            trainingGroup: isTrainingGroup,
            sortKey: isCard
                ? String(9999 - Number(group.cardSequence || 0)).padStart(4, '0')
                : isProduceMode ? '0' : isProduceCommon ? `1/${group.groupCode}` : specialSortKey,
            unreadCount: Number(group.unreadCount || 0),
            totalCount: group.children.length,
            children: group.children,
        };
    }

    function hierarchyGroupWithChildren(group, children, suffix, label) {
        const selected = Array.isArray(children) ? children : [];
        const clone = Object.assign({}, group, {
            children: selected,
            unreadCount: selected.filter(row => row && row.unread).length,
        });
        const leaf = hierarchyGroup(clone);
        leaf.treeKey = `${leaf.treeKey}/${suffix}`;
        leaf.children = selected;
        leaf.totalCount = selected.length;
        if (label) leaf.label = label;
        return leaf;
    }

    function buildScenarioHierarchy(entries) {
        const groups = groupScenarioEntries(entries);
        const activityGroups = [];
        const trainingCharacters = new Map();
        const specialTypes = new Map();
        const characters = new Map();

        function specialType(group) {
            const rawKey = group.specialKind || group.eventType || group.category || 'other';
            const key = ['special', 'special_communications', 'game_event_communications'].includes(rawKey) ? 'other-special' : rawKey;
            const labels = {
                holiday: ['节日剧情', '按年份与节日整理情人节、白色情人节、万圣节及圣诞剧情', '1'],
                birthday: ['生日剧情', '按年份批次汇总当年已实装的角色生日剧情', '2'],
                mypage_communications: ['主页剧情', '主页短对话与限时交流', '3'],
                'other-special': ['其他特殊剧情', '纪念日、独立短篇及其他特殊交流', '4'],
                produce_events: ['其他偶像剧情', '尚未归入卡片或育成目录的偶像剧情', '5'],
            };
            const info = labels[key] || [SCENARIO_TYPE_LABELS[key] || group.categoryLabel || '其他剧情', '特殊剧情细分类', `9/${key}`];
            if (!specialTypes.has(key)) {
                specialTypes.set(key, {
                    kind: 'special-type',
                    treeKey: `special/${key}`,
                    label: info[0],
                    description: info[1],
                    sortKey: info[2],
                    children: [],
                });
            }
            return specialTypes.get(key);
        }

        function characterBranch(group) {
            const characterId = group.characterId || 'unknown';
            if (!characters.has(characterId)) {
                const identity = characterIdentity(characterId);
                characters.set(characterId, {
                    kind: 'character',
                    treeKey: `character/${characterId}`,
                    label: CHARACTER_SHORT_NAMES[characterId] || identity.characterName,
                    description: `${identity.characterName} · 角色 ${characterId}`,
                    sortKey: characterId,
                    unitId: CHARACTER_UNITS[characterId] || 'unknown',
                    children: new Map(),
                });
            }
            return characters.get(characterId);
        }

        function characterType(character, group) {
            let typeKey;
            let label;
            let description;
            let sortKey;
            if (group.category === 'produce-card') {
                typeKey = 'produce'; label = 'P卡'; description = 'Produce 卡剧情'; sortKey = '1';
            } else {
                typeKey = 'support'; label = 'S卡'; description = 'Support 卡剧情'; sortKey = '2';
            }
            if (!character.children.has(typeKey)) {
                character.children.set(typeKey, {
                    kind: 'character-type',
                    treeKey: `${character.treeKey}/${typeKey}`,
                    label,
                    description,
                    sortKey,
                    children: [],
                });
            }
            return character.children.get(typeKey);
        }

        function trainingCharacter(group) {
            const firstStory = group.children && group.children[0];
            const inferredId = group.characterId
                || inferTrainingCharacterId(group.eventType, firstStory && firstStory.eventId)
                || 'unknown';
            const characterId = CHARACTERS[inferredId] ? inferredId : 'unknown';
            if (!trainingCharacters.has(characterId)) {
                const identity = characterIdentity(characterId);
                trainingCharacters.set(characterId, {
                    kind: 'training-character',
                    treeKey: `training/character/${characterId}`,
                    label: characterId === 'unknown' ? '共通育成' : CHARACTER_SHORT_NAMES[characterId] || identity.characterName,
                    description: characterId === 'unknown'
                        ? '无法按单角色编号拆分的共通育成内容'
                        : `${identity.characterName} · 角色 ${characterId}`,
                    sortKey: characterId,
                    unitId: CHARACTER_UNITS[characterId] || 'unknown',
                    children: [],
                    typeBranches: new Map(),
                });
            }
            return trainingCharacters.get(characterId);
        }

        function trainingType(character, group) {
            const isMode = ['produce-mode', 'produce-common'].includes(group.category);
            const firstStory = group.children && group.children[0];
            const detectedMode = isMode
                ? group.produceMode
                : inferTrainingMode(group.eventType, firstStory && firstStory.eventId);
            const normalizedMode = detectedMode === '000' ? '001' : detectedMode;
            const hasCommonMode = ['001', '002', '003', '004', '005'].includes(normalizedMode);
            const typeKey = hasCommonMode ? `mode/${normalizedMode}` : 'misc';
            const sectionLabel = hasCommonMode
                ? PRODUCE_MODE_SECTION_LABELS[normalizedMode]
                : '育成模式杂项';
            const sectionDescription = hasCommonMode
                ? `${sectionLabel}；按 Common 目录与编号中的模式段归类`
                : '无法对应 W.I.N.G.、感谢祭、G.R.A.D.、Landing Point 或 S.T.E.P. 的培育内容';
            const sectionSort = hasCommonMode
                ? `1/${String(normalizedMode).padStart(3, '0')}`
                : '9/misc';
            if (!character.typeBranches.has(typeKey)) {
                character.typeBranches.set(typeKey, {
                    kind: 'training-type',
                    treeKey: `${character.treeKey}/${typeKey}`,
                    label: sectionLabel,
                    description: sectionDescription,
                    sortKey: sectionSort,
                    children: [],
                    miscChildren: [],
                });
            }
            return character.typeBranches.get(typeKey);
        }

        for (const group of groups) {
            if (group.category === 'game-event') {
                activityGroups.push(hierarchyGroup(group));
            } else if (['produce-mode', 'produce-common'].includes(group.category) || TRAINING_SCENARIO_TYPES.has(group.eventType)) {
                const character = trainingCharacter(group);
                const type = trainingType(character, group);
                if (group.category === 'produce-mode') {
                    const mainRows = group.children.filter(row => isProduceModeMainSequence(group.produceMode, row.storySequence));
                    const miscRows = group.children.filter(row => !isProduceModeMainSequence(group.produceMode, row.storySequence));
                    if (mainRows.length) {
                        type.children.push(hierarchyGroupWithChildren(
                            group,
                            mainRows,
                            'main',
                            group.produceMode === '000' ? '序章' : '主线剧情',
                        ));
                    }
                    if (miscRows.length) {
                        type.miscChildren.push(hierarchyGroupWithChildren(group, miscRows, 'misc', '其他过场'));
                    }
                } else {
                    type.miscChildren.push(hierarchyGroup(group));
                }
            } else if (
                group.characterId
                && ['produce-card', 'support-card'].includes(group.category)
            ) {
                const character = characterBranch(group);
                characterType(character, group).children.push(hierarchyGroup(group));
            } else {
                specialType(group).children.push(hierarchyGroup(group));
            }
        }

        const characterNodes = Array.from(characters.values()).map(character => {
            character.children = Array.from(character.children.values()).map(type => {
                type.children.sort(compareLabel);
                return aggregateBranch(type);
            }).sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));
            return aggregateBranch(character);
        }).sort(compareLabel);

        const characterUnits = new Map();
        for (const character of characterNodes) {
            const unitId = character.unitId || 'unknown';
            const unit = UNITS[unitId] || UNITS.unknown;
            if (!characterUnits.has(unitId)) {
                characterUnits.set(unitId, {
                    kind: 'character-unit',
                    treeKey: `character-unit/${unitId}`,
                    label: unit.label,
                    description: unit.official === unit.label ? '角色分组' : unit.official,
                    sortKey: unit.sortKey,
                    children: [],
                });
            }
            characterUnits.get(unitId).children.push(character);
        }
        const characterUnitNodes = Array.from(characterUnits.values()).map(unit => {
            unit.children.sort(compareLabel);
            return aggregateBranch(unit);
        }).sort(compareLabel);

        const trainingCharacterNodes = Array.from(trainingCharacters.values()).map(character => {
            const typeNodes = Array.from(character.typeBranches.values()).map(type => {
                if (type.miscChildren.length) {
                    type.miscChildren.sort(compareLabel);
                    if (type.sortKey === '9/misc') {
                        // Content that cannot be assigned to one of the five
                        // main modes already lives in the global training-misc
                        // branch.  Do not misleadingly wrap it as chapter misc.
                        type.children.push(...type.miscChildren);
                    } else {
                        type.children.push(aggregateBranch({
                            kind: 'training-subtype',
                            treeKey: `${type.treeKey}/misc`,
                            label: '篇章杂项',
                            description: `${type.label}内部的约定、试镜、评审、应援、电视出演及短过场`,
                            sortKey: '9/misc',
                            children: type.miscChildren,
                        }));
                    }
                }
                delete type.miscChildren;
                type.children.sort(compareLabel);
                return aggregateBranch(type);
            });
            delete character.typeBranches;
            character.children.push(...typeNodes);
            character.children.sort(compareLabel);
            return aggregateBranch(character);
        }).sort(compareLabel);

        const trainingUnits = new Map();
        for (const character of trainingCharacterNodes) {
            const unitId = character.unitId || 'unknown';
            const unit = UNITS[unitId] || UNITS.unknown;
            if (!trainingUnits.has(unitId)) {
                trainingUnits.set(unitId, {
                    kind: 'training-unit',
                    treeKey: `training/unit/${unitId}`,
                    label: unitId === 'unknown' ? '共通／杂项' : unit.label,
                    description: unitId === 'unknown' ? '无法归入单一组合的培育内容' : unit.official,
                    sortKey: unit.sortKey,
                    children: [],
                });
            }
            trainingUnits.get(unitId).children.push(character);
        }
        const trainingNodes = Array.from(trainingUnits.values()).map(unit => {
            unit.children.sort(compareLabel);
            return aggregateBranch(unit);
        }).sort(compareLabel);

        const specialNodes = Array.from(specialTypes.values()).map(type => {
            type.children.sort(compareLabel);
            return aggregateBranch(type);
        }).sort(compareLabel);
        activityGroups.sort(compareLabel);

        return [
            aggregateBranch({
                kind: 'root', treeKey: 'root/activity', label: '活动',
                description: '按活动批次整理', sortKey: '1', children: activityGroups,
            }),
            aggregateBranch({
                kind: 'root', treeKey: 'root/training', label: '育成',
                description: '按组合 → 角色 → Common五大模式／育成模式杂项整理；每个主篇章另设篇章杂项', sortKey: '2', children: trainingNodes,
            }),
            aggregateBranch({
                kind: 'root', treeKey: 'root/special', label: '特殊剧情',
                description: '分为节日、生日、主页及其他独立短篇；育成过场不再混入', sortKey: '3', children: specialNodes,
            }),
            aggregateBranch({
                kind: 'root', treeKey: 'root/characters', label: '角色',
                description: '按组合 → 角色 → P卡／S卡 → 卡片批次整理', sortKey: '4', children: characterUnitNodes,
            }),
        ];
    }

    function updateLogGroupLabel(group) {
        if (group.category === 'produce-card' || group.category === 'support-card') {
            const shortName = CHARACTER_SHORT_NAMES[group.characterId] || group.characterName || `角色${group.characterId || '?'}`;
            const type = group.category === 'produce-card' ? 'P' : 'S';
            return `${shortName}-${type}${group.cardName ? ` · ${group.cardName}` : ''}`;
        }
        if (group.category === 'game-event') return group.groupLabel;
        if (group.category === 'produce-mode' || group.category === 'produce-common') {
            const shortName = CHARACTER_SHORT_NAMES[group.characterId] || group.characterName || '共通';
            return `${shortName}-${group.produceModeLabel || '育成'}`;
        }
        if (group.category === 'special') {
            if (group.specialKind === 'birthday') {
                const shortName = CHARACTER_SHORT_NAMES[group.characterId] || group.characterName || `角色${group.characterId || '?'}`;
                return `${shortName}生日`;
            }
            return group.groupLabel || '特殊剧情';
        }
        const first = group.children && group.children[0];
        const characterId = first && inferTrainingCharacterId(first.eventType, first.eventId);
        const shortName = CHARACTER_SHORT_NAMES[characterId] || '';
        return `${shortName ? `${shortName}-` : ''}${group.categoryLabel || group.groupLabel || '其他剧情'}`;
    }

    function buildUpdateLog(entries) {
        const dates = new Map();
        // Decorate against the complete known library before splitting by date.
        // Holiday batches may be detected across more than one scan; deriving the
        // speaker only from a single day's subset would make labels unstable.
        for (const entry of decorateSpecialEntries(Array.isArray(entries) ? entries : [])) {
            if (!entry.updateDetectedAt) continue;
            const detected = new Date(entry.updateDetectedAt);
            const dateKey = Number.isNaN(detected.getTime())
                ? String(entry.updateDetectedAt).slice(0, 10)
                : `${detected.getFullYear()}-${String(detected.getMonth() + 1).padStart(2, '0')}-${String(detected.getDate()).padStart(2, '0')}`;
            if (!dates.has(dateKey)) dates.set(dateKey, []);
            dates.get(dateKey).push(entry);
        }
        return Array.from(dates, ([dateKey, rows]) => {
            const groups = groupScenarioEntries(rows, true).map(group => {
                const node = hierarchyGroup(group);
                node.treeKey = `update-day/${dateKey}/${node.treeKey}`;
                node.label = updateLogGroupLabel(group);
                node.logDate = dateKey;
                return node;
            });
            return {
                kind: 'update-day',
                treeKey: `update-day/${dateKey}`,
                label: dateKey.replace(/-/g, '/'),
                description: `${groups.length} 组更新`,
                sortKey: dateKey,
                unreadCount: rows.filter(row => row.unread).length,
                totalCount: rows.length,
                children: groups,
            };
        }).sort((a, b) => String(b.sortKey).localeCompare(String(a.sortKey)));
    }

    function childDisplayLine(entry) {
        const classification = classifyScenario(entry.eventType, entry.eventId);
        const parts = [entry.eventId || ''];
        if (entry.stableStoryLabel) {
            parts.push(entry.stableStoryLabel);
            return parts.filter(Boolean).join(' · ');
        }
        const title = String(entry.storyTitle || '').trim();
        const numberedCard = classification.category === 'produce-card' || classification.category === 'support-card';
        const numberedTrainingMain = classification.category === 'produce-mode'
            && isProduceModeMainSequence(classification.produceMode, classification.storySequence);
        if (title && (numberedCard || numberedTrainingMain)) {
            const sequence = classification.storySequence === '11'
                ? 'TE'
                : classification.storySequence;
            const alreadyNumbered = /^(?:TE|True\s*End|\d{1,2})\s*[.．、_-]/i.test(title);
            parts.push(alreadyNumbered || !sequence ? title : `${sequence}.${title}`);
        } else if (classification.category === 'game-event') {
            if (classification.storyLabel) parts.push(classification.storyLabel);
            if (title) parts.push(title);
        } else if (title) {
            parts.push(title);
        } else if (numberedCard || numberedTrainingMain) {
            if (classification.storyLabel) parts.push(classification.storyLabel);
        }
        return parts.filter(Boolean).join(' · ');
    }

    function extractScenarioEntries(paths) {
        const result = new Map();
        for (const path of Array.isArray(paths) ? paths : []) {
            const parsed = parseScenarioPath(path);
            if (!parsed || result.has(parsed.key)) continue;
            result.set(parsed.key, Object.assign(parsed, inferCardIdentity(parsed.eventType, parsed.eventId)));
        }
        return Array.from(result.values()).sort((a, b) => a.key.localeCompare(b.key));
    }

    function cardResourcePaths(cardType, cardId) {
        const safeId = String(cardId || '').trim();
        if (!safeId) return { staticPath: '', dynamicPath: '' };
        if (cardType === 'Produce') {
            return {
                staticPath: `images/content/idols/card/${safeId}.jpg`,
                dynamicPath: `movies/idols/card/${safeId}.mp4`,
            };
        }
        if (cardType === 'Support') {
            return {
                staticPath: `images/content/support_idols/card/${safeId}.jpg`,
                dynamicPath: '',
            };
        }
        return { staticPath: '', dynamicPath: '' };
    }

    function extractCardResources(assetUrls) {
        const resources = new Map();
        const ensure = (cardType, cardId) => {
            const key = `${cardType}/${cardId}`;
            if (!resources.has(key)) {
                resources.set(key, {
                    key, cardType, cardId,
                    staticCardStatus: 'missing',
                    dynamicCardStatus: cardType === 'Produce' ? 'missing' : 'not-applicable',
                    implementationSource: 'official-game-asset-map',
                });
            }
            return resources.get(key);
        };
        for (const value of Array.isArray(assetUrls) ? assetUrls : []) {
            const path = normalizePath(value);
            let match = path.match(/^images\/content\/idols\/card\/([A-Za-z0-9_-]+)\.jpg$/i);
            if (match) {
                const row = ensure('Produce', match[1]);
                row.staticCardStatus = 'available';
                row.staticCardPath = path;
                continue;
            }
            match = path.match(/^images\/content\/support_idols\/card\/([A-Za-z0-9_-]+)\.jpg$/i);
            if (match) {
                const row = ensure('Support', match[1]);
                row.staticCardStatus = 'available';
                row.staticCardPath = path;
                continue;
            }
            match = path.match(/^movies\/idols\/card\/([A-Za-z0-9_-]+)\.mp4$/i);
            if (match) {
                const row = ensure('Produce', match[1]);
                row.dynamicCardStatus = 'available';
                row.dynamicCardPath = path;
            }
        }
        return Array.from(resources.values()).sort((a, b) => a.key.localeCompare(b.key));
    }

    function applyImplementationStatus(entries, metadataRows, assetUrls) {
        const metadataMap = new Map();
        for (const row of Array.isArray(metadataRows) ? metadataRows : []) {
            if (!row || !row.eventType || !row.eventId) continue;
            metadataMap.set(`${row.eventType}/${row.eventId}`, row);
        }
        const paths = new Set((Array.isArray(assetUrls) ? assetUrls : []).map(normalizePath));
        return (Array.isArray(entries) ? entries : []).map(value => {
            const key = `${value.eventType || ''}/${value.eventId || ''}`;
            const row = Object.assign({}, value, metadataMap.get(key) || {});
            row.scenarioStatus = 'available';
            const isCard = row.eventType === 'produce_events' && /^[23]\d{8}$/.test(String(row.eventId || ''));
            if (!isCard) {
                row.metadataStatus = 'not-applicable';
                row.staticCardStatus = 'not-applicable';
                row.dynamicCardStatus = 'not-applicable';
                return row;
            }
            row.metadataStatus = row.cardName && row.storyTitle
                ? 'available'
                : row.cardId ? 'partial' : 'pending';
            const resourcePaths = cardResourcePaths(row.cardType, row.cardId);
            row.staticCardPath = resourcePaths.staticPath;
            row.dynamicCardPath = resourcePaths.dynamicPath;
            row.staticCardStatus = resourcePaths.staticPath
                ? (paths.has(resourcePaths.staticPath) ? 'available' : 'missing')
                : 'pending';
            row.dynamicCardStatus = row.cardType === 'Support'
                ? 'not-applicable'
                : resourcePaths.dynamicPath
                    ? (paths.has(resourcePaths.dynamicPath) ? 'available' : 'missing')
                    : 'pending';
            row.implementationSource = 'official-game-asset-map';
            row.pageImplementationStatus = row.staticCardStatus === 'available'
                ? 'available'
                : row.staticCardStatus === 'missing' ? 'missing' : 'pending';
            return row;
        });
    }

    function cardMetadata(cardType, payload) {
        const isProduce = cardType === 'Produce';
        const card = isProduce ? payload && payload.idol : payload && payload.supportIdol;
        if (!card || typeof card !== 'object') return [];
        const events = isProduce
            ? [...(card.produceIdolEvents || []), ...(card.produceAfterEvents || [])]
            : (card.produceSupportIdolEvents || []);
        const characterId = String(card.character && card.character.id || '').padStart(3, '0');
        const character = CHARACTERS[characterId] || {};
        return events.filter(item => item && item.id).map(item => ({
            eventType: 'produce_events',
            eventId: String(item.id),
            characterId,
            characterName: character.zh || character.jp || '',
            characterNameJp: character.jp || '',
            cardType,
            cardId: String(card.id || ''),
            cardName: String(card.name || ''),
            storyTitle: String(item.title || ''),
            metadataSource: 'official-game-api',
        }));
    }

    function extractMetadataFromApi(path, body) {
        const route = String(path || '').replace(/^\/+|\?.*$/g, '');
        if (/^(?:userIdols\/\d+|userIdols\/statusMax|produceTeachingIdols\/\d+)$/.test(route)) {
            return cardMetadata('Produce', body);
        }
        if (/^(?:userSupportIdols\/\d+|userSupportIdols\/statusMax|produceTeachingSupportIdols\/\d+)$/.test(route)) {
            return cardMetadata('Support', body);
        }
        return [];
    }

    function displayLine(entry) {
        const classification = classifyScenario(entry.eventType, entry.eventId);
        if (!/-card$/.test(classification.category)) {
            return `${classification.groupLabel} - ${childDisplayLine(entry)}`;
        }
        const identity = entry.characterName || entry.characterNameJp || '角色待确认';
        const card = entry.cardName || `${entry.cardType || '卡片'} #${entry.cardSequence || '?'}`;
        const title = entry.storyTitle || `剧情 #${entry.storySequence || '?'}（待主数据）`;
        return `${identity} - ${card} - ${entry.eventId || ''} - ${title}`;
    }

    return {
        SCENARIO_TYPES,
        TRAINING_SCENARIO_TYPES,
        CHARACTERS,
        CHARACTER_SHORT_NAMES,
        UNITS,
        CHARACTER_UNITS,
        PRODUCE_MODE_LABELS,
        SCENARIO_TYPE_LABELS,
        normalizePath,
        parseScenarioPath,
        inferCardIdentity,
        classifyScenario,
        inferTrainingCharacterId,
        decorateSpecialEntries,
        groupScenarioEntries,
        buildScenarioHierarchy,
        buildUpdateLog,
        childDisplayLine,
        isProduceModeMainSequence,
        extractScenarioEntries,
        cardResourcePaths,
        extractCardResources,
        applyImplementationStatus,
        extractMetadataFromApi,
        displayLine,
    };
});
