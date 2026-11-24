// Pure undo/redo stack for the structure screen (V-004). Entries are opaque to the stack; the screen stores what it
// needs to reverse and repeat one deletion. A step is taken first and finished or failed afterwards so a slow or
// failing server call never loses or duplicates an entry, and a second key press during a call is ignored.
export function createUndoStack(limit = 50) {
  const undo = [];
  const redo = [];
  let busy = false;
  const take = (from) => {
    if (busy || !from.length) return null;
    busy = true;
    return from.pop();
  };
  const finish = (entry, to) => { to.push(entry); busy = false; };
  const fail = (entry, back, keep) => { if (keep) back.push(entry); busy = false; };
  return {
    push(entry) {
      undo.push(entry);
      redo.length = 0;
      if (undo.length > limit) undo.shift();
    },
    takeUndo: () => take(undo),
    doneUndo: (entry) => finish(entry, redo),
    failUndo: (entry, keep = true) => fail(entry, undo, keep),
    takeRedo: () => take(redo),
    doneRedo: (entry) => finish(entry, undo),
    failRedo: (entry, keep = true) => fail(entry, redo, keep),
    peekUndo: () => undo[undo.length - 1] ?? null,
    peekRedo: () => redo[redo.length - 1] ?? null,
    get busy() { return busy; },
    get undoCount() { return undo.length; },
    get redoCount() { return redo.length; },
    clear() { undo.length = 0; redo.length = 0; busy = false; },
  };
}
