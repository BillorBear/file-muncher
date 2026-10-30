export const MAC_FILE_DRAG_SCRIPT: string = String.raw`
ObjC.import('AppKit');
ObjC.import('ApplicationServices');
ObjC.bindFunction('getppid', ['int', []]);
ObjC.bindFunction('usleep', ['int', ['unsigned int']]);
ObjC.bindFunction('write', ['long', ['int', 'char *', 'unsigned long']]);

var POLL_INTERVAL_US = 50000;
var COMBINED_SESSION_STATE = 0;
var LEFT_MOUSE_BUTTON_MASK = 1;
var KEY_DOWN_EVENT = 10;
var ESCAPE_KEY_CODE = 53;
var parentPid = Number($.getppid());
var dragPasteboard = $.NSPasteboard.pasteboardWithName($.NSPasteboardNameDrag);
var fileTypes = $(['public.file-url', 'NSFilenamesPboardType']);

function sampleDrag() {
  var revision = Number(dragPasteboard.changeCount);
  var leftDown = (Number($.NSEvent.pressedMouseButtons) & LEFT_MOUSE_BUTTON_MASK) !== 0;
  var fileType = ObjC.unwrap(dragPasteboard.availableTypeFromArray(fileTypes));
  if (revision !== Number(dragPasteboard.changeCount)) return null;
  return {
    revision: revision,
    leftDown: leftDown,
    hasFiles: typeof fileType === 'string',
    escapeDown: Boolean($.CGEventSourceKeyState(COMBINED_SESSION_STATE, ESCAPE_KEY_CODE)),
    keyDownRevision: Number($.CGEventSourceCounterForEventType(COMBINED_SESSION_STATE, KEY_DOWN_EVENT)),
    sampledAt: Date.now()
  };
}

while (parentPid > 1 && Number($.getppid()) === parentPid) {
  var sample = sampleDrag();
  if (sample !== null) {
    // Keep native allocations inside bridge calls; do not retain per-sample Cocoa objects.
    // These JSON fields are ASCII, so the character count is also the UTF-8 byte count.
    var line = JSON.stringify(sample) + '\n';
    if (Number($.write(1, line, line.length)) !== line.length) {
      throw new Error('Unable to publish the file drag state.');
    }
  }
  if (Number($.usleep(POLL_INTERVAL_US)) !== 0) {
    throw new Error('File drag sampling was interrupted.');
  }
}
`;
