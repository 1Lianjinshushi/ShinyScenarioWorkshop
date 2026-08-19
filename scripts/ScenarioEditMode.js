'use strict';

(function exposeScenarioEditMode(root) {
    function previousCodePoint(value, position) {
        if (position <= 0) return 0;
        const last = value.charCodeAt(position - 1);
        const before = position > 1 ? value.charCodeAt(position - 2) : 0;
        return last >= 0xDC00 && last <= 0xDFFF && before >= 0xD800 && before <= 0xDBFF
            ? position - 2
            : position - 1;
    }

    function nextCodePoint(value, position) {
        if (position >= value.length) return value.length;
        const first = value.charCodeAt(position);
        const after = position + 1 < value.length ? value.charCodeAt(position + 1) : 0;
        return first >= 0xD800 && first <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF
            ? position + 2
            : position + 1;
    }

    function lineCaretTarget(value, position, key) {
        const lineStart = value.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
        const foundEnd = value.indexOf('\n', position);
        const lineEnd = foundEnd < 0 ? value.length : foundEnd;
        if (key === 'Home') return lineStart;
        if (key === 'End') return lineEnd;
        const column = position - lineStart;
        if (key === 'ArrowUp') {
            if (lineStart === 0) return position;
            const previousEnd = lineStart - 1;
            const previousStart = value.lastIndexOf('\n', Math.max(0, previousEnd - 1)) + 1;
            return previousStart + Math.min(column, previousEnd - previousStart);
        }
        if (key === 'ArrowDown') {
            if (lineEnd >= value.length) return position;
            const nextStart = lineEnd + 1;
            const foundNextEnd = value.indexOf('\n', nextStart);
            const nextEnd = foundNextEnd < 0 ? value.length : foundNextEnd;
            return nextStart + Math.min(column, nextEnd - nextStart);
        }
        return position;
    }

    function moveTextareaCaret(field, event) {
        if (!field || !event || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
            return false;
        }
        const key = event.key;
        if (!['ArrowLeft', 'ArrowRight'].includes(key)) {
            return false;
        }
        const value = String(field.value || '');
        const start = Math.max(0, Number(field.selectionStart || 0));
        const end = Math.max(start, Number(field.selectionEnd || start));
        const backward = field.selectionDirection === 'backward';
        const focus = backward ? start : end;
        let target;
        if (!event.shiftKey && start !== end && key === 'ArrowLeft') target = start;
        else if (!event.shiftKey && start !== end && key === 'ArrowRight') target = end;
        else if (key === 'ArrowLeft') target = previousCodePoint(value, focus);
        else target = nextCodePoint(value, focus);

        event.preventDefault();
        if (!event.shiftKey) {
            field.setSelectionRange(target, target);
            return true;
        }
        const anchor = backward ? end : start;
        field.setSelectionRange(
            Math.min(anchor, target),
            Math.max(anchor, target),
            target < anchor ? 'backward' : 'forward',
        );
        return true;
    }

    class ScenarioEditMode {
        static prepareLayout() {
            const viewportWidth = Math.max(0, Number(root.innerWidth || 0));
            const reservedWidth = viewportWidth >= 900
                ? Math.min(440, Math.max(360, Math.round(viewportWidth * 0.30)))
                : 0;
            root.__scenarioReservedWidth = reservedWidth;
            document.body.classList.add('scenario-edit-mode');
            document.documentElement.style.setProperty('--scenario-editor-width', `${reservedWidth || Math.min(420, viewportWidth)}px`);
            return reservedWidth;
        }

        constructor(options) {
            this._eventType = options.eventType;
            this._eventId = options.eventId;
            try {
                this._translator = String(localStorage.getItem('ssv-workshop-translator') || '').trim();
            } catch (_) {
                this._translator = '';
            }
            this._csvText = ScenarioCsvTranslation.ensureScenarioCsvMetadata(
                String(options.csvText || ''),
                options.eventType,
                options.eventId,
                this._translator,
            );
            this._exportWorkflow = options.exportWorkflow === 'correction'
                ? 'correction'
                : 'translation';
            this._advPlayer = options.advPlayer;
            this._currentTrack = null;
            this._currentBinding = null;
            this._currentTrackIndex = -1;
            this._currentHistoryPosition = -1;
            this._dirty = false;
            this._saveTimer = 0;
            this._saving = null;
            this._buildPanel();
            if (this._advPlayer && this._advPlayer.enableLogJumping) {
                this._advPlayer.enableLogJumping(true);
            }
            this._onTrack = this._onTrack.bind(this);
            this._advPlayer.on('track', this._onTrack);
            this._onLogJump = this._onLogJump.bind(this);
            this._advPlayer.on('logJump', this._onLogJump);
            this._onAppearSelectList = this._onAppearSelectList.bind(this);
            this._advPlayer.on('appearSelectList', this._onAppearSelectList);
            this._onChoiceReturn = this._onChoiceReturn.bind(this);
            this._advPlayer.on('choiceReturn', this._onChoiceReturn);
            this._onKeyDown = this._onKeyDown.bind(this);
            root.addEventListener('keydown', this._onKeyDown);
        }

        _buildPanel() {
            const panel = document.createElement('aside');
            panel.id = 'scenario-edit-panel';
            panel.innerHTML = `
                <header class="scenario-edit-header">
                    <div>
                        <span class="scenario-edit-kicker">编辑模式</span>
                        <strong>${this._eventId}</strong>
                    </div>
                    <button class="scenario-edit-return" type="button">返回工坊</button>
                </header>
                <div class="scenario-edit-meta">
                    <span class="scenario-edit-row">等待对白轨道</span>
                    <span class="scenario-edit-speaker">—</span>
                </div>
                <div class="scenario-edit-choices" hidden>
                    <span>选择支（点选要校对的选项，不会触发剧情选择）</span>
                    <div class="scenario-edit-choice-list"></div>
                </div>
                <div class="scenario-edit-field">
                    <div class="scenario-edit-field-heading">
                        <span>日文原文</span>
                        <button class="scenario-edit-copy" type="button" aria-label="复制本句日文" title="复制本句日文" disabled>
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <rect x="8" y="8" width="11" height="11" rx="2"></rect>
                                <path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </button>
                    </div>
                    <textarea class="scenario-edit-source" readonly></textarea>
                </div>
                <label class="scenario-edit-field scenario-edit-translation-field">
                    <span>当前译文（修改会立即反映到画面）</span>
                    <textarea class="scenario-edit-translation" disabled></textarea>
                </label>
                <div class="scenario-edit-actions">
                    <button class="scenario-edit-save" type="button" disabled>保存 CSV</button>
                    <button class="scenario-edit-export" type="button">导出编辑后 CSV</button>
                    <span class="scenario-edit-status">正在等待可编辑对白……</span>
                </div>
                <p class="scenario-edit-help">Ctrl+S 保存。普通对白可实时预览；选择支译文会保存到 CSV，但当前已经展开的选项需重新播放后刷新。</p>`;
            document.body.appendChild(panel);
            this._panel = panel;
            this._row = panel.querySelector('.scenario-edit-row');
            this._speaker = panel.querySelector('.scenario-edit-speaker');
            this._source = panel.querySelector('.scenario-edit-source');
            this._translation = panel.querySelector('.scenario-edit-translation');
            this._copyButton = panel.querySelector('.scenario-edit-copy');
            this._saveButton = panel.querySelector('.scenario-edit-save');
            this._exportButton = panel.querySelector('.scenario-edit-export');
            this._status = panel.querySelector('.scenario-edit-status');
            this._choices = panel.querySelector('.scenario-edit-choices');
            this._choiceList = panel.querySelector('.scenario-edit-choice-list');
            this._translation.addEventListener('input', () => this._applyInput());
            // Player/debug/end-screen hotkeys are installed on document/window.
            // Keep editor keystrokes local.  Up/Down/Home/End deliberately use
            // the browser's native textarea navigation: only the browser knows
            // the visual rows created by soft wrapping, so an explicit-newline
            // calculation cannot move from a wrapped second row to the third.
            [this._source, this._translation].forEach((field) => {
                field.addEventListener('keydown', (event) => {
                    event.stopPropagation();
                    if (moveTextareaCaret(field, event)) return;
                    if ((event.ctrlKey || event.metaKey)
                        && String(event.key).toLowerCase() === 's') {
                        event.preventDefault();
                        this.save();
                    }
                });
                field.addEventListener('keyup', event => event.stopPropagation());
            });
            this._saveButton.addEventListener('click', () => this.save());
            this._exportButton.addEventListener('click', () => this.exportCsv());
            this._copyButton.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this._copyCurrentSource();
            });
            panel.querySelector('.scenario-edit-return').addEventListener('click', async () => {
                await this.save();
                if (this._dirty) {
                    this._status.textContent = 'CSV 尚未成功保存，已留在当前页面，请重试。';
                    return;
                }
                if (root.opener && !root.opener.closed) {
                    root.opener.focus();
                    root.close();
                    return;
                }
                root.location.href = './app.html';
            });
            const help = panel.querySelector('.scenario-edit-help');
            if (help) {
                help.textContent = 'Ctrl+S 保存。普通对白与选择支都会实时同步到当前画面和「ログ」；打开「ログ」后，点击任意一句记录即可跳回并重新播放该句。';
            }
        }

        _onLogJump(payload) {
            const index = payload && Number.isInteger(payload.index) ? payload.index : '?';
            if (payload && payload.track) this._onTrack({
                track: payload.track,
                index,
                historyPosition: payload.historyPosition,
            });
            this._status.textContent = `已从日志跳回轨道 ${index}；当前句已重新播放并定位到对应 CSV。`;
        }

        _onAppearSelectList(payload) {
            const items = payload && Array.isArray(payload.items) ? payload.items : [];
            this._choiceList.replaceChildren();
            items.forEach((item) => {
                const track = item && item.track;
                if (!track) return;
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'scenario-edit-choice';
                button.textContent = String(track.select || track.select_ja || '（空选项）')
                    .replace(/\\n/g, '\n');
                button.dataset.trackIndex = String(item.index);
                button.dataset.historyPosition = String(item.historyPosition);
                button.addEventListener('click', () => {
                    this._onTrack(item);
                    this._markActiveChoice(item.index, item.historyPosition);
                });
                this._choiceList.appendChild(button);
            });
            this._choices.hidden = this._choiceList.children.length === 0;
            this._markActiveChoice(this._currentTrackIndex, this._currentHistoryPosition);
        }

        _onChoiceReturn(payload) {
            const index = payload && Number.isInteger(payload.index) ? payload.index : '?';
            this._status.textContent = `已退回选择节点（轨道 ${index}）；可校对或选择另一条分支。`;
        }

        _markActiveChoice(trackIndex, historyPosition) {
            this._choiceList.querySelectorAll('.scenario-edit-choice').forEach((button) => {
                const sameHistory = Number(button.dataset.historyPosition) === historyPosition;
                const sameTrack = Number(button.dataset.trackIndex) === trackIndex;
                button.classList.toggle('is-active', sameHistory || (historyPosition < 0 && sameTrack));
            });
        }

        _onTrack(payload) {
            const track = payload && payload.track;
            const binding = track && track.__ssvEditBinding;
            if (!binding) {
                this._currentTrack = null;
                this._currentBinding = null;
                this._currentTrackIndex = -1;
                this._currentHistoryPosition = -1;
                this._row.textContent = '当前轨道未绑定 CSV 行';
                this._speaker.textContent = track && track.speaker ? track.speaker : '—';
                this._source.value = String((track && (track.text_ja || track.select_ja || track.text || track.select)) || '')
                    .replace(/\\n/g, '\n');
                this._copyButton.disabled = !this._source.value;
                this._translation.value = '';
                this._translation.disabled = true;
                this._status.textContent = '这条内容在 CSV 中没有对应行，已暂停编辑以免误改上一句。';
                return;
            }
            this._currentTrack = track;
            this._currentBinding = binding;
            this._currentTrackIndex = Number.isInteger(payload.index) ? payload.index : -1;
            this._currentHistoryPosition = Number.isInteger(payload.historyPosition)
                ? payload.historyPosition
                : -1;
            if (!track.select) this._choices.hidden = true;
            this._markActiveChoice(this._currentTrackIndex, this._currentHistoryPosition);
            this._row.textContent = `CSV 第 ${binding.rowNumber} 行 · 轨道 ${binding.id || payload.index}`;
            this._speaker.textContent = track.speaker || binding.name || '无发言人';
            this._source.value = String(track.text_ja || track.select_ja || binding.text || '').replace(/\\n/g, '\n');
            this._copyButton.disabled = !this._source.value;
            this._translation.value = ScenarioCsvTranslation.toScenarioText(binding.trans)
                .replace(/\r\n|\r/g, '\n');
            this._translation.disabled = false;
            this._saveButton.disabled = !this._dirty;
            this._status.textContent = binding.field === 'select'
                ? '当前行为选择支；可保存，重新播放后刷新选项。'
                : '已定位到当前画面的 CSV 译文。';
        }

        async _copyCurrentSource() {
            const text = String(this._source && this._source.value || '');
            if (!text) {
                this._status.textContent = '当前没有可复制的日文台词。';
                return;
            }
            try {
                if (root.navigator && root.navigator.clipboard
                    && typeof root.navigator.clipboard.writeText === 'function') {
                    await root.navigator.clipboard.writeText(text);
                } else {
                    const helper = document.createElement('textarea');
                    helper.value = text;
                    helper.readOnly = true;
                    helper.style.position = 'fixed';
                    helper.style.opacity = '0';
                    helper.style.pointerEvents = 'none';
                    document.body.appendChild(helper);
                    helper.select();
                    const copied = document.execCommand && document.execCommand('copy');
                    helper.remove();
                    if (!copied) throw new Error('浏览器未允许访问剪贴板');
                }
                this._copyButton.classList.add('is-copied');
                this._copyButton.setAttribute('aria-label', '已复制本句日文');
                this._status.textContent = '已复制当前日文单句。';
                root.setTimeout(() => {
                    if (!this._copyButton) return;
                    this._copyButton.classList.remove('is-copied');
                    this._copyButton.setAttribute('aria-label', '复制本句日文');
                }, 1200);
            } catch (error) {
                this._status.textContent = `复制失败：${error.message || error}`;
            }
        }

        _applyInput() {
            const binding = this._currentBinding;
            const track = this._currentTrack;
            if (!binding || !track) return;
            const displayText = this._translation.value.replace(/\r\n|\r/g, '\n');
            this._csvText = ScenarioCsvTranslation.updateScenarioCsvTranslation(
                this._csvText,
                binding.rowNumber,
                displayText,
            );
            const stored = ScenarioCsvTranslation.toStoredTranslation(displayText);
            const scenarioText = ScenarioCsvTranslation.toScenarioText(stored);
            binding.trans = stored;
            track[`${binding.field}_cn`] = scenarioText;
            track[binding.field] = scenarioText;
            if (this._advPlayer.updateLogTrackText) {
                this._advPlayer.updateLogTrackText(
                    this._currentTrackIndex,
                    this._currentHistoryPosition,
                    scenarioText,
                );
            }
            if (binding.field === 'select') {
                if (this._advPlayer.updateActiveSelectText) {
                    this._advPlayer.updateActiveSelectText(
                        this._currentTrackIndex,
                        this._currentHistoryPosition,
                        scenarioText,
                    );
                }
                const activeChoice = this._choiceList.querySelector('.scenario-edit-choice.is-active');
                if (activeChoice) activeChoice.textContent = scenarioText.replace(/\r\n|\r/g, '\n');
            }
            if (binding.field === 'text') {
                this._advPlayer.scenarioPlayer.replaceCurrentText(scenarioText);
            }
            this._dirty = true;
            this._saveButton.disabled = false;
            this._status.textContent = '尚未保存；停止输入后会自动保存。';
            clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => this.save(), 700);
        }

        async save() {
            clearTimeout(this._saveTimer);
            let latestTranslator = this._translator;
            try {
                latestTranslator = String(localStorage.getItem('ssv-workshop-translator') || '').trim();
            } catch (_) {}
            const signedCsv = ScenarioCsvTranslation.ensureScenarioCsvMetadata(
                this._csvText,
                this._eventType,
                this._eventId,
                latestTranslator,
            );
            if (signedCsv !== this._csvText) {
                this._translator = latestTranslator;
                this._csvText = signedCsv;
                this._dirty = true;
            }
            if (this._saving) {
                await this._saving;
                if (this._dirty) return this.save();
                return;
            }
            if (!this._dirty) return;
            const snapshot = this._csvText;
            this._dirty = false;
            this._saveButton.disabled = true;
            this._status.textContent = '正在保存 CSV……';
            this._saving = fetch('./api/save-translation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    eventType: this._eventType,
                    eventId: this._eventId,
                    content: snapshot,
                    translator: this._translator,
                }),
            }).then(async response => {
                const body = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
                this._status.textContent = `已保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
                if (root.opener && !root.opener.closed) {
                    root.opener.postMessage({
                        type: 'ssv-translation-saved',
                        eventType: this._eventType,
                        eventId: this._eventId,
                        content: snapshot,
                    }, root.location.origin);
                }
            }).catch(error => {
                this._dirty = true;
                this._saveButton.disabled = false;
                this._status.textContent = `保存失败：${error.message}`;
            }).finally(() => {
                this._saving = null;
                if (this._csvText !== snapshot) {
                    this._dirty = true;
                    this._saveButton.disabled = false;
                    clearTimeout(this._saveTimer);
                    this._saveTimer = setTimeout(() => this.save(), 700);
                }
            });
            await this._saving;
        }

        async exportCsv() {
            this._exportButton.disabled = true;
            await this.save();
            if (this._dirty) {
                this._exportButton.disabled = false;
                this._status.textContent = 'CSV 尚未成功保存，已取消导出；请重试。';
                return;
            }
            const filename = root.ScenarioStoryMetadata
                ? await root.ScenarioStoryMetadata.resolveCsvFilename(
                    this._eventType,
                    this._eventId,
                    { workflow: this._exportWorkflow },
                )
                : `${this._exportWorkflow === 'correction' ? '【校】' : '【翻】'}${this._eventId}.csv`;
            const blob = new Blob([this._csvText], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 0);
            this._exportButton.disabled = false;
            this._status.textContent = `已导出 ${filename}`;
        }

        _onKeyDown(event) {
            if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 's') {
                event.preventDefault();
                this.save();
            }
        }
    }

    ScenarioEditMode.moveTextareaCaret = moveTextareaCaret;
    root.ScenarioEditMode = ScenarioEditMode;
    if (typeof module !== 'undefined' && module.exports) module.exports = ScenarioEditMode;
}(typeof globalThis !== 'undefined' ? globalThis : window));
