'use strict';

// Some PIXI v6/browser combinations report canvas taps as click/touchstart
// without a pointertap. Mirror the upstream viewer's start-overlay listeners
// when a one-shot pointertap handler is registered.
(function patchOneShotPointerTap() {
    const proto = PIXI.Container && PIXI.Container.prototype;
    if (!proto || proto.__pointerTapCompat) return;
    const originalOnce = proto.once;
    proto.once = function onceWithClickFallback(event, handler, context) {
        const result = originalOnce.call(this, event, handler, context);
        if (event === 'pointertap' && typeof handler === 'function') {
            originalOnce.call(this, 'click', handler, context);
            originalOnce.call(this, 'touchstart', handler, context);
        }
        return result;
    };
    proto.__pointerTapCompat = true;
})();
