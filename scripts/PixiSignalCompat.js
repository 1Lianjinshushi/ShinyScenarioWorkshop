'use strict';

// PIXI v6 MiniSignal#detach expects the SignalBinding returned by add().
// Some loaders and older examples pass the original callback instead. Keep a
// callback-to-binding lookup so both forms are accepted without leaking error
// listeners across scenario reloads.
(function patchLoaderErrorSignal() {
    const signal = PIXI.Loader.shared.onError;
    if (!signal || signal.__callbackDetachCompat) return;
    const bindings = new WeakMap();
    const originalAdd = signal.add.bind(signal);
    const originalDetach = signal.detach.bind(signal);

    signal.add = function addWithBindingLookup(callback, context) {
        const binding = originalAdd(callback, context);
        if (typeof callback === 'function') bindings.set(callback, binding);
        return binding;
    };
    signal.detach = function detachCallbackOrBinding(value) {
        const binding = typeof value === 'function' ? bindings.get(value) : value;
        if (!binding) return false;
        return originalDetach(binding);
    };
    signal.__callbackDetachCompat = true;
})();
