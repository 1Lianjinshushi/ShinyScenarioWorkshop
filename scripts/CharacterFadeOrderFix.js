'use strict';

// The source data can change a pose and fade a character out on the same
// track. Enza starts both operations together, so a very short fade-out hides
// the new pose before its Spine mix becomes visible. CharacterStage normally
// snapshots after applying animations, which can freeze the new face for the
// whole fade. Snapshot the previous pose first, then update the hidden Spine.
(function installCharacterFadeOrderFix() {
    const originalControl = CharacterStage.prototype.control;
    const poseKeys = [
        'anim1', 'anim2', 'anim3', 'anim4', 'anim5',
        'anim1Loop', 'anim2Loop', 'anim3Loop', 'anim4Loop', 'anim5Loop',
        'lipAnim', 'lipAnimDuration', 'lipMarks', 'keepsLipAnimation', 'voiceObj',
    ];
    const animationKeys = ['anim1', 'anim2', 'anim3', 'anim4', 'anim5', 'lipAnim'];

    CharacterStage.prototype.control = function controlWithFaithfulFadeOrder(params) {
        const effect = params && params.effect;
        const isFadeOut = effect
            && effect.type !== 'from'
            && effect.alpha !== undefined
            && Number(effect.alpha) <= 0;
        const changesPose = params && animationKeys.some(key => params[key] !== undefined);
        if (!isFadeOut || !changesPose || !params.label) {
            return originalControl.call(this, params);
        }

        const fadeParams = { ...params };
        poseKeys.forEach(key => { delete fadeParams[key]; });
        const fadePromise = originalControl.call(this, fadeParams);

        const hiddenPoseParams = { label: params.label };
        poseKeys.forEach(key => {
            if (params[key] !== undefined) hiddenPoseParams[key] = params[key];
        });
        originalControl.call(this, hiddenPoseParams);
        return fadePromise;
    };
}());
