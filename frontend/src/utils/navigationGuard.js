// Shared navigation guard for unsaved changes
let _dirty = false;
let _onNavigateAway = null; // callback when navigating away while dirty
let _dirtyMessage = '有未保存的更改，是否保存？';

export const setDirty = (dirty) => { _dirty = dirty; };
export const isDirty = () => _dirty;
export const setOnNavigateAway = (cb) => { _onNavigateAway = cb; };
export const getOnNavigateAway = () => _onNavigateAway;
export const setDirtyMessage = (msg) => { _dirtyMessage = msg; };
export const getDirtyMessage = () => _dirtyMessage;
export const clearGuard = () => { _dirty = false; _onNavigateAway = null; _dirtyMessage = '有未保存的更改，是否保存？'; };
