// AdvPlayer — coordinator. Mirrors enza's _e class.
// State machine, _onTap, _forward, _onEndText, _changeToWaiting, _playTrack
// reproduce the original behavior. Driven by app.ticker via update(delta).
class AdvPlayer extends PIXI.utils.EventEmitter {
    constructor(app, opts = {}) {
        super();
        this._app    = app;
        this._loader = PIXI.Loader.shared;

        this._bgLayer        = new BgLayer();
        this._middleFgLayer  = new MiddleFgLayer();
        this._characterStage = new CharacterStage(app);
        this._fgLayer        = new FgLayer();
        this._stillLayer     = new StillLayer();
        this._scenarioPlayer = new ScenarioPlayer();
        this._effectLayer    = new EffectLayer();
        this._movieLayer     = new MovieLayer();
        this._soundController = new SoundController(opts);
        this._selectList     = new SelectList(this._soundController);
        this._mainController = new MainController(this._soundController);
        this._scenarioLogLayer = new ScenarioLogLayer();
        this._tapEffectLayer = new TapEffectLayer();

        this._schedule       = new Schedule();
        this._trackManager   = null;
        this._tracks         = [];
        this._pendingSelectEntries = [];
        this._lastChoiceCheckpoint = null;
        this._playHistory    = [];
        this._currentHistoryPosition = -1;
        this._logJumpEnabled = false;
        this._isRebuildingLogJump = false;

        this._state          = State.FREE;
        this._mode           = SpeedMode.MANUAL;
        this._effectSpeed    = 1;
        this._textSpeed      = 100;
        this._waitTime       = 200;
        this._autoWaitTime   = 0;
        this._isFast4Mode    = false;
        this._skipReserved   = false;
        this._currentSkipActionType = 'no_wait';
        this._currentVoice   = null;
        this._currentVoiceKeepActive = false;
        this._currentVoiceEndHandler = null;
        this._deferredTasks  = [];
        this._fatalError     = null;
        this._isMoviePlaying = false;
        this._instantStillAfterMovie = false;

        this._container = new PIXI.Container();

        // interactionLayer — full-canvas tap surface. Use Container with an
        // explicit hitArea (more reliable across PIXI v6 builds than a 0-alpha
        // Graphics fill).
        this._interactionLayer = new PIXI.Container();
        this._interactionLayer.interactive = true;
        this._interactionLayer.hitArea = new PIXI.Rectangle(0, 0, 1136, 640);
        this._interactionLayer.on('pointertap', () => this._onTap());

        // Z-order matches enza: interaction layer is below selectable/content layers.
        const layers = [
            { stageObj: this._interactionLayer },
            this._bgLayer, this._middleFgLayer, this._characterStage,
            this._fgLayer, this._stillLayer,
            this._selectList, this._scenarioPlayer, this._effectLayer,
        ];
        layers.forEach(l => this._container.addChild(l.stageObj));
        this._container.addChild(this._mainController.stageObj);
        this._container.addChild(this._movieLayer.stageObj);
        this._container.addChild(this._scenarioLogLayer.stageObj);
        this._container.addChild(this._tapEffectLayer.stageObj);

        // Wire ScenarioPlayer events (per enza _setupScenarioPlayer)
        this._scenarioPlayer.on('play',    this._onPlayText, this);
        this._scenarioPlayer.on('endText', this._onEndText,  this);

        // Wire MainController control events (per enza _setupMainController)
        this._mainController.on('control', this._onControl, this);
        this._mainController.on('skip', () => this.returnToLastChoice());

        // Log overlay close → resume playback (enza emits 'closeLog')
        this._scenarioLogLayer.on('closeLog', () => this._closeLog());
        this._scenarioLogLayer.on('replayVoice', (voice) => this._replayLogVoice(voice));
        this._scenarioLogLayer.on('jumpToTrack', (entry) => this._jumpToLogEntry(entry));

        // Wire SelectList
        this._selectList.on('appear', () => this._onAppearSelectList());
        this._selectList.on('select', (e) => this._onSelect(e));
        this._bindGlobalTapEffect();
    }

    get stageObj()         { return this._container; }
    get scenarioPlayer()   { return this._scenarioPlayer; }
    get soundController()  { return this._soundController; }

    // ───────────────────────────────────────────────────────────────────
    // Lifecycle
    // ───────────────────────────────────────────────────────────────────
    start(tracks) {
        this._tracks = Array.isArray(tracks) ? tracks : [];
        this._pendingSelectEntries = [];
        this._lastChoiceCheckpoint = this._findInitialChoiceCheckpoint(this._tracks);
        this._playHistory = [];
        this._currentHistoryPosition = -1;
        this._trackManager = new TrackManager(tracks);
        this._mainController.init(this._scenarioPlayer.stageObj);
        if (this._mainController.setChoiceSkipVisible) {
            this._mainController.setChoiceSkipVisible(this.canReturnToLastChoice());
        }
        this._setMode(SpeedMode.MANUAL);
        this._playTrack(this._trackManager.currentTrack);
        this.emit('startAdvPlayer');
    }

    update(delta) {
        if (this._fatalError) return;
        try {
            this._tapEffectLayer.update(delta);
            if (this._paused) return;
            this._schedule.update(delta);
            this._runDeferredTasks();
            this._scenarioPlayer.update(delta);
        } catch (err) {
            this._handleFatalError('[AdvPlayer] update failed', err);
        }
    }

    pause()  { this._paused = true; }
    resume() { this._paused = false; }
    setAutoEnabled(enabled) {
        if (this._mainController && this._mainController.setAutoEnabled) {
            this._mainController.setAutoEnabled(enabled);
        }
    }

    enableLogJumping(enabled = true) {
        this._logJumpEnabled = !!enabled;
        this._scenarioLogLayer.setJumpEnabled(this._logJumpEnabled);
    }

    updateLogTrackText(trackIndex, historyPosition, text) {
        return this._scenarioLogLayer.updateTrackText(trackIndex, historyPosition, text);
    }

    updateActiveSelectText(trackIndex, historyPosition, text) {
        return this._selectList.updateItemText(trackIndex, historyPosition, text);
    }

    mountEndCorrectionControls(host) {
        if (!host || this._endCorrectionMount) return;
        const main = this._mainController.stageObj;
        const log = this._scenarioLogLayer.stageObj;
        this._endCorrectionMount = {
            mainIndex: this._container.getChildIndex(main),
            logIndex: this._container.getChildIndex(log),
        };
        host.addChild(main);
        host.addChild(log);
        main.visible = true;
        main.interactiveChildren = true;
    }

    restoreEndCorrectionControls() {
        const mount = this._endCorrectionMount;
        this._container.visible = true;
        if (!mount) return;
        const main = this._mainController.stageObj;
        const log = this._scenarioLogLayer.stageObj;
        this._container.addChildAt(main, Math.min(mount.mainIndex, this._container.children.length));
        this._container.addChildAt(log, Math.min(mount.logIndex, this._container.children.length));
        this._endCorrectionMount = null;
    }

    canReturnToLastChoice() {
        const checkpoint = this._lastChoiceCheckpoint;
        return !!checkpoint
            && Number.isInteger(checkpoint.startIndex)
            && Array.isArray(checkpoint.pathBeforeChoice);
    }

    _findInitialChoiceCheckpoint(tracks) {
        const startIndex = Array.isArray(tracks)
            ? tracks.findIndex(track => track && track.select)
            : -1;
        if (startIndex < 0) return null;
        return {
            startIndex,
            // Choice stories are linear before their first select group. This
            // preliminary path makes the top-right jump available immediately;
            // _onAppearSelectList replaces it with the actually played path.
            pathBeforeChoice: Array.from({ length: startIndex }, (_, index) => index),
        };
    }

    playChoiceReturnTransition(movieUrl) {
        if (!this.canReturnToLastChoice() || !movieUrl) return Promise.resolve(false);
        if (this._choiceReturnTransitionPromise) return this._choiceReturnTransitionPromise;

        const mainStage = this._mainController.stageObj;
        const restoreAuto = this._mode === SpeedMode.AUTO && !this._isFast4Mode;
        this._container.visible = true;
        this.pause();
        this._soundController.removeAll();
        // The source movie is chroma-keyed. Keep the authored black scene
        // visible underneath its transparent opening instead of exposing the
        // renderer's empty (black) background.
        mainStage.visible = true;
        mainStage.interactiveChildren = false;
        this._interactionLayer.interactive = false;
        this._scenarioLogLayer.hideImmediately();
        this._isMoviePlaying = true;
        this.emit('choiceReturnTransitionStart', { movieUrl });

        let returnAttempted = false;
        let returned = false;
        const revealChoiceUnderTransition = () => {
            if (returnAttempted) return returned;
            returnAttempted = true;
            returned = this.returnToLastChoice({
                preserveMovie: true,
                restoreAuto,
            });

            // returnToLastChoice rebuilds the stage synchronously and normally
            // re-enables controls. The colour wipe is still covering it here,
            // so keep input locked until the transparent retreat has ended.
            mainStage.visible = true;
            mainStage.interactiveChildren = false;
            this._interactionLayer.interactive = false;
            this._isMoviePlaying = true;
            return returned;
        };

        const finish = () => {
            // A load/playback failure may finish before the timed cue. Still
            // restore the choice node so the player never remains on black.
            revealChoiceUnderTransition();
            this._movieLayer.reset();
            this._isMoviePlaying = false;
            mainStage.visible = true;
            mainStage.interactiveChildren = true;
            this._interactionLayer.interactive = true;
            this.emit('choiceReturnTransitionEnd', { movieUrl, returned });
            return returned;
        };

        this._choiceReturnTransitionPromise = this._movieLayer.control(movieUrl, {
            // This is an authored editing transition. Preserve its first and
            // last frames instead of adding MovieLayer's scenario-movie fade.
            fadeInSeconds: 0,
            fadeOutSeconds: 0,
            // The wipe is fully opaque by ~0.5 s and starts retreating from
            // the lower-left at ~1.2 s. Rebuild while it fully covers the
            // screen, leaving enough time for the choice assets to settle.
            cueTimeSeconds: 0.7,
            onCue: revealChoiceUnderTransition,
            chromaKey: {
                threshold: 0.08,
                softness: 0.18,
                despill: 1,
            },
        }).then(finish, (error) => {
            console.warn('[AdvPlayer] choice return transition failed', error);
            return finish();
        }).finally(() => {
            this._choiceReturnTransitionPromise = null;
        });
        return this._choiceReturnTransitionPromise;
    }

    returnToLastChoice(options = {}) {
        if (!this.canReturnToLastChoice() || !this._trackManager) return false;
        const checkpoint = {
            startIndex: this._lastChoiceCheckpoint.startIndex,
            pathBeforeChoice: this._lastChoiceCheckpoint.pathBeforeChoice.slice(),
        };

        this._scenarioLogLayer.hideImmediately();
        this._resetForLogJump({ preserveMovie: !!options.preserveMovie });
        this._scenarioLogLayer.clear();
        this._playHistory = [];
        this._currentHistoryPosition = -1;

        this._isRebuildingLogJump = true;
        try {
            checkpoint.pathBeforeChoice.forEach((index) => {
                const track = this._tracks[index];
                if (!track) return;
                const position = this._playHistory.push(index) - 1;
                this._currentHistoryPosition = position;
                this._applyHistoricalTrack(track, index, position);
            });
        } finally {
            this._isRebuildingLogJump = false;
        }

        this._trackManager.seekToIndex(checkpoint.startIndex);
        const firstChoiceTrack = this._trackManager.currentTrack;
        this._changeToFree();
        if (options.restoreAuto
            && this._mainController
            && this._mainController.setAutoEnabled) {
            this._mainController.setAutoEnabled(true);
        } else if (this._mainController && this._mainController.setManualMode) {
            this._mainController.setManualMode();
        } else {
            this._setMode(options.restoreAuto ? SpeedMode.AUTO : SpeedMode.MANUAL);
        }
        if (this._soundController.setSoundDisabled) this._soundController.setSoundDisabled(false);
        if (this._mainController && this._mainController.setChoiceSkipVisible) {
            this._mainController.setChoiceSkipVisible(true);
        }
        this.resume();
        this._playTrack(firstChoiceTrack);
        this.emit('choiceReturn', {
            index: checkpoint.startIndex,
            track: firstChoiceTrack,
        });
        return true;
    }

    _bindGlobalTapEffect() {
        const view = this._app && this._app.view;
        if (!view) return;
        view.addEventListener('pointerdown', (e) => {
            if (this._isMoviePlaying) return;
            const rect = view.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (1136 / rect.width);
            const y = (e.clientY - rect.top) * (640 / rect.height);
            if (x < 0 || x > 1136 || y < 0 || y > 640) return;
            this._tapEffectLayer.play(x, y);
        });
    }

    // ───────────────────────────────────────────────────────────────────
    // State helpers
    // ───────────────────────────────────────────────────────────────────
    _setMode(m) {
        this._scenarioPlayer.isAuto = (m === SpeedMode.AUTO);
        this._mode = m;
    }
    _isFree()    { return this._state === State.FREE; }
    _isLocked()  { return this._state === State.LOCKED; }
    _isWaiting() { return this._state === State.WAITING; }
    _changeToFree()    { this._state = State.FREE; }
    _changeToPlaying() { this._state = State.PLAYING; }
    _changeToLocked()  { this._state = State.LOCKED; }

    _changeToWaiting() {
        this._state = State.WAITING;
        if (this._mode !== SpeedMode.AUTO) return;
        if (this._autoWaitTime > 0) return;
        if (this._isFast4Mode) {
            this._registerScheduleForward();
            return;
        }

        const v = this._currentVoice;
        // Producer bubble loops forever — don't wait for it; just auto-advance.
        if (!v || this._currentVoiceIsLooping) {
            this._registerScheduleForward();
            return;
        }

        // Regular voice: wait for it to end before auto-advancing (mirrors enza).
        // Attach 'end' listener with a fallback timeout in case the event never fires.
        const onEnd = () => {
            if (this._currentVoice !== v) return;
            this._registerScheduleForward();
        };
        if (typeof v.once === 'function') {
            v.once('end', onEnd);
            const dur = (v.duration && v.duration > 0) ? v.duration * 1000 + 800 : 6000;
            const tid = setTimeout(() => { this._detachVoiceEndListener(); onEnd(); }, dur);
            this._voiceEndListener = { voice: v, fn: onEnd, tid };
        } else {
            this._registerScheduleForward();
        }
    }

    _detachVoiceEndListener() {
        const e = this._voiceEndListener;
        if (!e) return;
        try {
            if (e.voice && typeof e.voice.off === 'function') e.voice.off('end', e.fn);
            else if (e.voice && typeof e.voice.removeListener === 'function') e.voice.removeListener('end', e.fn);
        } catch(_) {}
        if (e.tid != null) clearTimeout(e.tid);
        this._voiceEndListener = null;
    }

    _detachCurrentVoiceEndHandler() {
        const e = this._currentVoiceEndHandler;
        if (!e) return;
        try {
            if (e.voice && typeof e.voice.off === 'function') {
                e.voice.off('end', e.fn);
                e.voice.off('ended', e.fn);
            } else if (e.voice && typeof e.voice.removeListener === 'function') {
                e.voice.removeListener('end', e.fn);
                e.voice.removeListener('ended', e.fn);
            }
        } catch(_) {}
        this._currentVoiceEndHandler = null;
    }

    _bindCurrentVoiceEndHandler(voice, keepActive) {
        this._detachCurrentVoiceEndHandler();
        this._currentVoiceKeepActive = !!keepActive;
        if (!voice || typeof voice.once !== 'function') return;
        let done = false;
        const onEnd = () => {
            if (done || this._currentVoice !== voice) return;
            done = true;
            this._currentVoiceKeepActive = false;
            this._currentVoiceEndHandler = null;
            this._scenarioPlayer.controlVoicePlayingAnimation(null);
        };
        voice.once('end', onEnd);
        voice.once('ended', onEnd);
        this._currentVoiceEndHandler = { voice, fn: onEnd };
    }

    _registerScheduleForward(extra = 0) {
        this._schedule.register(() => this._forward(), this._waitTime + extra);
    }

    _addDeferredTask(fn) {
        if (typeof fn === 'function') this._deferredTasks.push(fn);
    }

    _runDeferredTasks() {
        const tasks = this._deferredTasks;
        if (tasks.length === 0) return;
        this._deferredTasks = [];
        tasks.forEach(fn => {
            try { fn(); }
            catch (err) {
                this._handleFatalError('[AdvPlayer] deferred task failed', err);
            }
        });
    }

    _handleFatalError(message, err, context = {}) {
        if (this._fatalError) return;
        this._fatalError = { message, err, context };
        console.error(message, context, err);
        const box = new PIXI.Container();
        const bg = new PIXI.Graphics();
        bg.beginFill(0x000000, 0.82);
        bg.drawRoundedRect(40, 40, 1056, 220, 16);
        bg.endFill();
        box.addChild(bg);
        const detail = err && (err.stack || err.message || String(err));
        const text = new PIXI.Text(
            `${message}\n${detail || ''}\n${JSON.stringify(context, null, 2)}`,
            { fontFamily: 'monospace', fontSize: 18, fill: 0xffdddd, wordWrap: true, wordWrapWidth: 1010 }
        );
        text.position.set(64, 62);
        box.addChild(text);
        this._container.addChild(box);
    }

    // ───────────────────────────────────────────────────────────────────
    // Tap / forward / control
    // ───────────────────────────────────────────────────────────────────
    _onTap() {
        this.emit('tap');
        if (this._mode !== SpeedMode.MANUAL) return;
        if (this._state === State.PLAYING)      this._endTrack();
        else if (this._state === State.WAITING) this._forward();
        else if (this._state === State.LOCKED
            && this._logJumpEnabled
            && this._currentSkipActionType === 'time'
            && this._schedule.hasEvents) {
            // Correction mode must not look frozen during a scripted black
            // wait (choice branches commonly end with a 4-second fade). Keep
            // the authored wait when untouched, but let a tap complete it.
            this._forceEndSkippableTrack();
        }
    }

    _endTrack() {
        // First click during PLAYING: only finish the typewriter immediately.
        // Voice keeps playing; mouth keeps moving (its stop is owned by
        // CharacterStage, triggered by the voice's own 'end' event).
        // Producer bubble is stopped in _onEndText() which fires from endText() below.
        this._scenarioPlayer.endText();
    }

    _forward() {
        if (!this._trackManager) return;
        if (!this._trackManager.currentTrack) return;
        if (this._selectList.active) return;
        this._scenarioPlayer.hideIndicators();

        // Detach any pending AUTO 'voice end' listener — otherwise it can fire
        // on the now-orphaned voice and stop the next track's lip animation.
        this._detachVoiceEndListener();

        this._soundController.removeSe();

        const cur = this._trackManager.currentTrack;
        const shouldKeepVoice = !!cur.voiceKeep || this._currentVoiceKeepActive;
        if (!shouldKeepVoice) {
            this._soundController.removeVoice();
            this._detachCurrentVoiceEndHandler();
            this._currentVoice = null;
            this._currentVoiceIsLooping = false;
            this._currentVoiceKeepActive = false;
            this._scenarioPlayer.controlVoicePlayingAnimation(null);
            if (cur.text && this._characterStage.stopLipAnimations) {
                this._characterStage.stopLipAnimations();
            }
        }
        if (this._trackManager.reachesStopTrack) {
            this._trackManager.resetStopTrack();
            this.emit('skipped');
            if (!this._isFree()) return;
        }

        const next = this._trackManager.forward();
        if (next) {
            try {
                this._playTrack(next);
            } catch (err) {
                this._handleFatalError('[AdvPlayer] _playTrack failed', err, {
                    current: cur && cur.id,
                    next: next && next.id,
                    nextTrack: next,
                });
            }
        } else {
            this._changeToLocked();
            this.emit('end');
        }
    }

    _onPlayText() {
        if (this._isRebuildingLogJump) return;
        this._changeToPlaying();
    }

    _onEndText(ctrl) {
        if (this._isRebuildingLogJump) return;
        // Stop the producer looping bubble — fires whether typewriter finished
        // naturally OR via tap (endText() path also goes through here).
        if (this._currentVoiceIsLooping && this._currentVoice) {
            this._soundController.removeVoice();
            this._detachCurrentVoiceEndHandler();
            this._currentVoice = null;
            this._currentVoiceIsLooping = false;
            this._currentVoiceKeepActive = false;
            this._scenarioPlayer.controlVoicePlayingAnimation(null);
        }

        if (ctrl && ctrl.lock) {
            if (!this._isLocked()) this._changeToWaiting();
        } else {
            this._forward();
        }
    }

    _onControl(e) {
        if (!e) return;
        if (e.opensLog) { this._openLog(); return; }
        // Mode change — if waiting and there are scheduled events, complete them;
        // otherwise step forward right now (matches enza _changeMode)
        if (this._isWaiting()) {
            if (this._schedule.hasEvents) this._schedule.completeAll();
            else this._forward();
        }
        this._setMode(e.mode);
        this._effectSpeed = e.effectSpeed || 1;
        this._isFast4Mode = !!e.soundDisabled && this._effectSpeed >= 8;
        this._bgLayer.speed = this._effectSpeed;
        this._scenarioPlayer.speed = e.speed;
        this._waitTime = e.waitTime;
        // FAST mode disables voice/SE per enza soundDisabled flag.
        if (this._soundController.setSoundDisabled) {
            this._soundController.setSoundDisabled(!!e.soundDisabled);
            if (e.soundDisabled) {
                this._detachCurrentVoiceEndHandler();
                this._detachVoiceEndListener();
                this._currentVoice = null;
                this._currentVoiceIsLooping = false;
                this._currentVoiceKeepActive = false;
                this._scenarioPlayer.controlVoicePlayingAnimation(null);
            }
        }
        if (this._isFast4Mode) {
            this._forceEndSkippableTrack();
        }
    }

    _openLog() {
        this.pause();
        this._soundController.pauseSeAndVoice();
        this._scenarioLogLayer.open();
        this.emit('openLog');
    }
    _closeLog() {
        if (this._soundController.removeLogVoice) this._soundController.removeLogVoice();
        this.resume();
        this._soundController.resumeSeAndVoice();
    }

    _replayLogVoice(voice) {
        if (!voice || !this._soundController.playLogVoice) return;
        this._soundController.playLogVoice(voice);
    }

    _jumpToLogEntry(entry) {
        if (!this._logJumpEnabled || !entry || !this._trackManager) return;
        const trackIndex = Number(entry.trackIndex);
        const historyPosition = Number(entry.historyPosition);
        if (!Number.isInteger(trackIndex) || !Number.isInteger(historyPosition)) return;
        if (historyPosition < 0 || historyPosition >= this._playHistory.length) return;
        if (this._playHistory[historyPosition] !== trackIndex) return;

        const pathBeforeTarget = this._playHistory.slice(0, historyPosition);
        this._scenarioLogLayer.hideImmediately();
        this._resetForLogJump();
        this._scenarioLogLayer.clear();
        this._playHistory = [];
        this._currentHistoryPosition = -1;

        this._isRebuildingLogJump = true;
        try {
            let previousWasSelect = false;
            pathBeforeTarget.forEach(index => {
                const track = this._tracks[index];
                if (!track) return;
                if (previousWasSelect && !track.select) this._selectList.reset();
                const position = this._playHistory.push(index) - 1;
                this._currentHistoryPosition = position;
                this._applyHistoricalTrack(track, index, position);
                previousWasSelect = !!track.select;
            });
            const target = this._tracks[trackIndex];
            if (previousWasSelect && target && !target.select) this._selectList.reset();
        } finally {
            this._isRebuildingLogJump = false;
        }

        this._trackManager.seekToIndex(trackIndex);
        const targetTrack = this._trackManager.currentTrack;
        this._changeToFree();
        if (this._mainController && this._mainController.setManualMode) {
            this._mainController.setManualMode();
        } else {
            this._setMode(SpeedMode.MANUAL);
        }
        if (this._soundController.setSoundDisabled) this._soundController.setSoundDisabled(false);
        this.resume();
        this._playTrack(targetTrack);
        this.emit('logJump', {
            track: targetTrack,
            index: trackIndex,
            historyPosition,
            text: entry.text || '',
        });
    }

    _resetForLogJump(options = {}) {
        this.pause();
        this._detachVoiceEndListener();
        this._detachCurrentVoiceEndHandler();
        this._soundController.removeAll();
        this._schedule.cancelAll();
        this._deferredTasks = [];
        this._selectList.reset();
        this._pendingSelectEntries = [];
        this._scenarioPlayer.reset();
        this._bgLayer.reset();
        this._middleFgLayer.reset();
        this._characterStage.endEffects();
        this._characterStage.reset();
        this._fgLayer.reset();
        this._stillLayer.reset();
        this._effectLayer.reset();
        if (!options.preserveMovie) this._movieLayer.reset();
        this._mainController.stageObj.visible = true;
        this._mainController.stageObj.interactiveChildren = true;
        this._interactionLayer.interactive = true;
        this._state = State.FREE;
        this._skipReserved = false;
        this._currentSkipActionType = 'no_wait';
        this._currentVoice = null;
        this._currentVoiceIsLooping = false;
        this._currentVoiceKeepActive = false;
        if (!options.preserveMovie) this._isMoviePlaying = false;
        this._instantStillAfterMovie = false;
    }

    _applyHistoricalTrack(track, trackIndex, historyPosition) {
        const {
            speaker, text, textCtrl, textFrame,
            bg, bgEffect, bgEffectTime,
            middleFg, middleFgEffect, middleFgEffectTime,
            fg, fgEffect, fgEffectTime,
            bgm,
            charStill, stillCtrl, still,
            charSpine, charLabel, charPosition, charScale,
            charAnim1, charAnim2, charAnim3, charAnim4, charAnim5,
            charAnim1Loop, charAnim2Loop, charAnim3Loop, charAnim4Loop, charAnim5Loop,
            charEffect,
            effectLabel, effectTarget, effectValue,
        } = track;

        this._scenarioPlayer.applyTextControl();
        if (speaker !== undefined) this._scenarioPlayer.controlSpeaker(speaker);
        if (text) {
            this._scenarioPlayer.setTextControl(textCtrl || 'p');
            this._scenarioPlayer.play(text, 0);
            this._scenarioPlayer.endText();
            this._scenarioLogLayer.stackTrack(track, { trackIndex, historyPosition });
        } else if (textCtrl) {
            this._scenarioPlayer.setTextControl(textCtrl);
        }
        if (textFrame !== undefined) this._scenarioPlayer.controlFrame(textFrame);

        if (bg !== undefined) {
            this._bgLayer.control(bg, bgEffect, bgEffectTime, 100000);
            this._bgLayer.endEffect();
        }
        if (middleFg !== undefined) {
            this._middleFgLayer.control(middleFg, middleFgEffect, middleFgEffectTime, 100000);
            this._middleFgLayer.endEffect();
        }
        if (fg !== undefined) {
            this._fgLayer.control(fg, fgEffect, fgEffectTime, 100000);
            this._fgLayer.endEffect();
        }

        if (charStill !== undefined) this._stillLayer.control(charStill, { instant: true });
        if (still !== undefined) this._stillLayer.control(still, { instant: true });
        if (stillCtrl !== undefined) this._stillLayer.control(stillCtrl, { instant: true });
        if (bgm) this._soundController.control('bgm', bgm === 'fade_out' ? 'off' : bgm, 0);

        if (charSpine || charLabel) {
            this._characterStage.control({
                asset: charSpine, label: charLabel,
                position: charPosition, scale: charScale,
                anim1: charAnim1, anim2: charAnim2, anim3: charAnim3,
                anim4: charAnim4, anim5: charAnim5,
                anim1Loop: charAnim1Loop, anim2Loop: charAnim2Loop,
                anim3Loop: charAnim3Loop, anim4Loop: charAnim4Loop,
                anim5Loop: charAnim5Loop,
                effect: charEffect, effectSpeed: 100000,
            });
            this._characterStage.endEffects();
        }

        if (effectValue) {
            const instantValue = Object.assign({}, effectValue, { time: 0 });
            this._effectLayer.control(effectLabel, effectTarget, instantValue, 100000);
        }

        if (track.select) {
            this._selectList.addItem(track.select, track.nextLabel, {
                sourceTrack: track,
                trackIndex,
                historyPosition,
            });
        }
    }

    // ───────────────────────────────────────────────────────────────────
    // Select
    // ───────────────────────────────────────────────────────────────────
    _onAppearSelectList() {
        const first = this._pendingSelectEntries[0];
        if (first && Number.isInteger(first.index) && Number.isInteger(first.historyPosition)) {
            this._lastChoiceCheckpoint = {
                startIndex: first.index,
                pathBeforeChoice: this._playHistory.slice(0, first.historyPosition),
            };
            if (this._mainController && this._mainController.setChoiceSkipVisible) {
                this._mainController.setChoiceSkipVisible(true);
            }
        }
        this.emit('appearSelectList', {
            items: this._pendingSelectEntries.slice(),
        });
        this._changeToLocked();
    }
    _addSelectItem(item, fallbackNextLabel) {
        const text = (item && typeof item === 'object')
            ? (item.select !== undefined ? item.select : item.text)
            : item;
        const sourceTrack = (item && typeof item === 'object') ? item : null;
        const nextLabel = (item && typeof item === 'object' && item.nextLabel !== undefined)
            ? item.nextLabel
            : fallbackNextLabel;
        this._selectList.addItem(text, nextLabel, sourceTrack ? {
            sourceTrack,
            trackIndex: this._trackManager.currentIndex,
            historyPosition: this._currentHistoryPosition,
        } : null);
        if (sourceTrack) {
            this._pendingSelectEntries.push({
                track: sourceTrack,
                index: this._trackManager.currentIndex,
                historyPosition: this._currentHistoryPosition,
            });
        }
        // If next track itself is also a select, the original delays appear()
        const nt = this._trackManager.nextTrack;
        if (!nt || !nt.select) this._selectList.appear();
    }
    _onSelect(e) {
        this._scenarioPlayer.setTextControl('cm');
        this.emit('select', e.nextLabel);
        this._trackManager.nextLabel = e.nextLabel;
        const metadata = e.metadata || {};
        const logTrack = Object.assign({}, metadata.sourceTrack || {}, {
            text: e.text,
            isSelectedItem: true,
        });
        this._scenarioLogLayer.stackTrack(logTrack, {
            trackIndex: metadata.trackIndex,
            historyPosition: metadata.historyPosition,
        });
        this._pendingSelectEntries = [];
        this._forward();
    }

    // ───────────────────────────────────────────────────────────────────
    // _playTrack — full dispatch (mirrors enza)
    // ───────────────────────────────────────────────────────────────────
    _playTrack(e) {
        if (!e) return;
        const currentIndex = this._trackManager ? this._trackManager.currentIndex : -1;
        const historyPosition = this._playHistory.push(currentIndex) - 1;
        this._currentHistoryPosition = historyPosition;
        if (e.__ssvEditBinding || e.text || e.select) {
            this.emit('track', {
                track: e,
                index: currentIndex,
                historyPosition,
            });
        }
        this._changeToFree();
        this._skipReserved = false;

        const {
            speaker, text, textCtrl, textWait, textFrame,
            bg, bgEffect, bgEffectTime,
            middleFg, middleFgEffect, middleFgEffectTime,
            fg, fgEffect, fgEffectTime,
            bgm, bgmFadeTime, se, voice, voiceKeep, lip,
            select, nextLabel,
            charStill, stillCtrl, still,
            movie, gameEventCommunicationMovie, gameEventCommunicationSe,
            charSpine, charLabel, charPosition, charScale,
            charAnim1, charAnim2, charAnim3, charAnim4, charAnim5,
            charAnim1Loop, charAnim2Loop, charAnim3Loop, charAnim4Loop, charAnim5Loop,
            charLipAnim, charEffect,
            effectLabel, effectTarget, effectValue,
            waitType, waitTime, autoWaitTime,
            command, commandKey,
        } = e;

        const Q = [];
        let lipDuration;
        const skipActionType = (text || movie || gameEventCommunicationMovie) ? 'unskippable'
            : waitType === WaitType.TIME ? 'time'
            : waitType === WaitType.EFFECT ? 'effect'
            : 'no_wait';
        this._currentSkipActionType = skipActionType;

        // Apply previously-stored textCtrl (clear / addLine / noop) BEFORE new text
        this._scenarioPlayer.applyTextControl();

        // Producer bubble: if the speaker is the producer and no voice is specified,
        // play the looping bubble sound (mirrors EventViewer SoundManager lines 54-57)
        const isProducer = (speaker === 'プロデューサー' || speaker === '制作人');
        const effectiveVoice = voice || (isProducer ? PRODUCER_BUBBLE_KEY : null);
        const voiceIsLooping = !voice && isProducer;

        // Voice & lipDuration
        if (e.lipAnimDuration) {
            lipDuration = e.lipAnimDuration;          // seconds (CharacterStage convention)
        } else if (effectiveVoice) {
            this._detachCurrentVoiceEndHandler();
            this._currentVoice = this._soundController.control('voice', effectiveVoice, null, voiceIsLooping);
            this._currentVoiceIsLooping = voiceIsLooping;
            this._bindCurrentVoiceEndHandler(this._currentVoice, !!voice && !!voiceKeep);
            lipDuration = (this._currentVoice && this._currentVoice.duration)
                ? this._currentVoice.duration : undefined;   // already seconds
        }

        const commandJumped = this._handleCommand(command, commandKey, nextLabel);

        // nextLabel (only when select is NOT present)
        if (!commandJumped && nextLabel !== undefined && !select && command !== 'conditional_jump') {
            this._trackManager.nextLabel = nextLabel;
        }

        // Speaker / text / textCtrl
        if (speaker !== undefined) this._scenarioPlayer.controlSpeaker(speaker);
        if (text) {
            this._scenarioPlayer.setTextControl(textCtrl || 'p');
            this._scenarioPlayer.play(text, textWait || 0);
            this._scenarioLogLayer.stackTrack(e, { trackIndex: currentIndex, historyPosition });
        } else if (textCtrl) {
            this._scenarioPlayer.setTextControl(textCtrl);
        }
        if (textFrame !== undefined) this._scenarioPlayer.controlFrame(textFrame);
        this._scenarioPlayer.controlVoicePlayingAnimation(this._currentVoice);

        // Layers
        if (bg !== undefined)       Q.push(this._bgLayer.control(bg, bgEffect, bgEffectTime, this._effectSpeed));
        if (middleFg !== undefined) Q.push(this._middleFgLayer.control(middleFg, middleFgEffect, middleFgEffectTime, this._effectSpeed));
        if (fg !== undefined)       Q.push(this._fgLayer.control(fg, fgEffect, fgEffectTime, this._effectSpeed));

        // Stills
        const instantStillPending = this._instantStillAfterMovie;
        const instantStill = instantStillPending && (charStill !== undefined || still !== undefined);
        if (charStill !== undefined) this._stillLayer.control(charStill, { instant: instantStill });
        if (still     !== undefined) this._stillLayer.control(still, { instant: instantStill });
        if (stillCtrl !== undefined) this._stillLayer.control(stillCtrl);
        if (instantStillPending) this._instantStillAfterMovie = false;

        // BGM / SE
        if (bgm) this._soundController.control('bgm', bgm, bgmFadeTime);
        if (se && !movie) this._soundController.control('se',  se);

        // Character (asset = converted charSpine URL)
        if (charSpine || charLabel) {
            const p = this._characterStage.control({
                asset: charSpine, label: charLabel,
                position: charPosition, scale: charScale,
                anim1: charAnim1, anim2: charAnim2, anim3: charAnim3, anim4: charAnim4, anim5: charAnim5,
                anim1Loop: charAnim1Loop, anim2Loop: charAnim2Loop, anim3Loop: charAnim3Loop,
                anim4Loop: charAnim4Loop, anim5Loop: charAnim5Loop,
                lipAnim: charLipAnim, lipAnimDuration: lipDuration,
                lipMarks: lip, keepsLipAnimation: voiceKeep,
                voiceObj: this._currentVoice,
                effect: charEffect, effectSpeed: this._effectSpeed,
            });
            Q.push(p);
        }

        // Select
        if (select) this._addSelectItem(e, nextLabel);

        // Effect
        if (effectValue) Q.push(this._effectLayer.control(effectLabel, effectTarget, effectValue, this._effectSpeed));

        // Movie
        if (movie)                       { this._changeToLocked(); this._controlMovie(movie, se); }
        if (gameEventCommunicationMovie) { this._changeToLocked(); this._controlMovie(gameEventCommunicationMovie, gameEventCommunicationSe); }

        // autoWaitTime — enza disables it in FAST4 / instant-skip mode.
        const effectiveAutoWaitTime = this._isFast4Mode ? 0 : autoWaitTime;
        this._autoWaitTime = (effectiveAutoWaitTime > 0 && this._mode === SpeedMode.AUTO)
            ? effectiveAutoWaitTime : 0;
        if (this._autoWaitTime > 0) {
            this._changeToLocked();
            this._registerScheduleForward(this._autoWaitTime);
        }

        // waitType — enza registers time waits as waitTime/effectSpeed, then FAST4
        // completes skippable time waits on the next frame via schedule.completeAll().
        if (waitType) {
            this._changeToLocked();
            if (waitType === WaitType.TIME) {
                const delay = (waitTime || 0) / this._effectSpeed;
                const choiceReturnLead = this._choiceReturnLeadDelay(e, delay);
                if (choiceReturnLead != null) {
                    this._schedule.register(() => {
                        if (this._trackManager
                            && this._trackManager.currentTrack === e
                            && !this._choiceReturnTransitionPromise) {
                            this.emit('choiceReturnLeadIn', {
                                track: e,
                                index: currentIndex,
                                leadMilliseconds: delay - choiceReturnLead,
                            });
                        }
                    }, choiceReturnLead);
                }
                this._schedule.register(() => this._handleWaitEnd(), delay);
            } else if (waitType === WaitType.EFFECT) {
                Promise.all(Q).then(() => {
                    // Enza defers wait completion through FrameTween/update, not a browser timer.
                    this._addDeferredTask(() => this._handleWaitEnd());
                });
            }
        }

        if (this._isFast4Mode && skipActionType !== 'unskippable') {
            this._forceEndSkippableTrack();
        }

        // _onEndTrack: if still FREE (no text, no wait, no movie, no select) → forward
        this._onEndTrack();
    }

    _onEndTrack() {
        if (this._isFree()) this._forward();
    }

    _choiceReturnLeadDelay(track, fullDelay) {
        if (!track
            || !this.canReturnToLastChoice()
            || track.waitType !== WaitType.TIME
            || !track.nextLabel
            || track.text
            || track.voice
            || track.select
            || track.movie
            || track.gameEventCommunicationMovie
            || fullDelay < 1200
            || !this._isTerminalLabel(track.nextLabel)) {
            return null;
        }
        // Choice branches normally end with a 4 s black-fade track.  Begin the
        // keyed wipe just before that authored wait ends: the fade and final
        // voice remain intact, while the otherwise empty black hold is shorter.
        return Math.max(0, fullDelay - 900);
    }

    _isTerminalLabel(label) {
        const targetIndex = this._tracks.findIndex(track => track && track.label === label);
        if (targetIndex < 0) return false;
        return this._tracks.slice(targetIndex).every(track => {
            if (!track) return true;
            return Object.keys(track).every(key => key === 'label' || key.startsWith('__ssv'));
        });
    }

    _handleCommand(command, commandKey, nextLabel) {
        if (command !== 'conditional_jump' || !commandKey || nextLabel === undefined) return false;
        const storageKey = this._commandStorageKey(commandKey);
        let wasRead = false;
        try {
            wasRead = window.localStorage.getItem(storageKey) === '1';
            window.localStorage.setItem(storageKey, '1');
        } catch (_) {
            wasRead = false;
        }
        if (wasRead) {
            this._trackManager.nextLabel = nextLabel;
            return true;
        }
        return false;
    }

    _commandStorageKey(commandKey) {
        const params = new URLSearchParams(window.location.search || '');
        const eventType = params.get('eventType') || 'unknown';
        const eventId = params.get('eventId') || 'unknown';
        return `shinymaster.scenario.command.${eventType}.${eventId}.${commandKey}`;
    }

    _handleWaitEnd() {
        this._addDeferredTask(() => {
            this._changeToFree();
            this._forward();
        });
    }

    _forceEndSkippableTrack() {
        if (this._currentSkipActionType === 'unskippable') return;
        if (this._skipReserved) return;
        this._skipReserved = true;
        [this._bgLayer, this._middleFgLayer, this._fgLayer, this._effectLayer, this._characterStage]
            .forEach(layer => {
                if (layer && typeof layer.endEffect === 'function') layer.endEffect();
                else if (layer && typeof layer.endEffects === 'function') layer.endEffects();
            });
        if (this._currentSkipActionType === 'time') {
            this._addDeferredTask(() => this._schedule.completeAll());
        }
    }

    _controlMovie(url, seUrl) {
        const mainStage = this._mainController.stageObj;
        const prevMainVisible = mainStage.visible;
        const prevMainInteractiveChildren = mainStage.interactiveChildren;
        const prevInteractionInteractive = this._interactionLayer.interactive;

        this._isMoviePlaying = true;
        this._soundController.removeSe();
        mainStage.visible = false;
        mainStage.interactiveChildren = false;
        this._interactionLayer.interactive = false;

        this._movieLayer.control(url, {
            seUrl,
            soundController: this._soundController,
        }).then(() => {
            mainStage.visible = prevMainVisible;
            mainStage.interactiveChildren = prevMainInteractiveChildren;
            this._interactionLayer.interactive = prevInteractionInteractive;
            this._instantStillAfterMovie = true;
            this._handleWaitEnd();
            this._addDeferredTask(() => {
                this._movieLayer.reset();
                this._isMoviePlaying = false;
            });
        });
    }
}
