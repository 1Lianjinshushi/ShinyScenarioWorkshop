'use strict';

// PIXI can calculate an empty Container hit area inconsistently when its
// children use trimmed textures. Give each choice card an explicit rectangle
// so mouse and touch selection are both reliable at every canvas scale.
const ssvOriginalSelectListAddItem = SelectList.prototype.addItem;
const ssvOriginalSelectListAppear = SelectList.prototype.appear;
const ssvOriginalSelectListReset = SelectList.prototype.reset;
const ssvOriginalSelectListOnSelectItem = SelectList.prototype._onSelectItem;

function ssvDetachChoiceKeyboard(selectList) {
    if (!selectList._ssvChoiceKeyHandler) return;
    document.removeEventListener('keydown', selectList._ssvChoiceKeyHandler);
    selectList._ssvChoiceKeyHandler = null;
}

SelectList.prototype.addItem = function addItemWithStableHitArea(text, nextLabel, metadata = null) {
    const before = this._items.length;
    // Preserve the edit/log binding supplied by AdvPlayer.  Dropping this
    // third argument made live choice edits unable to locate the on-screen
    // card, and the selected choice was then logged without a track identity.
    ssvOriginalSelectListAddItem.call(this, text, nextLabel, metadata);
    const item = this._items[before];
    if (!item || !item._frame) return;
    const width = Math.max(280, Number(item._frame.width) || 0);
    const height = Math.max(110, Number(item._frame.height) || 0);
    item.hitArea = new PIXI.Rectangle(-width / 2, -height / 2, width, height);
    item._ssvChoiceText = text;
    item._ssvNextLabel = nextLabel;
};

// Number keys are also an accessibility fallback for canvas choices. They
// exercise exactly the same selection path as mouse and touch input.
SelectList.prototype.appear = function appearWithChoiceKeyboard() {
    ssvOriginalSelectListAppear.call(this);
    ssvDetachChoiceKeyboard(this);
    this._ssvChoiceKeyHandler = (event) => {
        const match = /^(?:Digit|Numpad)([1-5])$/.exec(event.code || '');
        if (!match || !this._active || this._selecting) return;
        const item = this._items[Number(match[1]) - 1];
        if (!item) return;
        event.preventDefault();
        this._onSelectItem(item, item._textValue, item._ssvNextLabel, item._metadata);
    };
    document.addEventListener('keydown', this._ssvChoiceKeyHandler);
};

SelectList.prototype._onSelectItem = function selectItemAndDetachKeyboard(selected, text, nextLabel, metadata = null) {
    if (this._active && !this._selecting) ssvDetachChoiceKeyboard(this);
    ssvOriginalSelectListOnSelectItem.call(this, selected, text, nextLabel, metadata);
};

SelectList.prototype.reset = function resetAndDetachChoiceKeyboard() {
    ssvDetachChoiceKeyboard(this);
    ssvOriginalSelectListReset.call(this);
};
