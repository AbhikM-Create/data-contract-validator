// What kind of file these bytes are — by content, never by the name alone.
// Kept apart from parseXlsx.js so the page can ask without loading the
// workbook reader, which only the worker needs.

const ZIP = [0x50, 0x4b, 0x03, 0x04] // .xlsx is a zip
const OLE = [0xd0, 0xcf, 0x11, 0xe0] // legacy .xls

const view = (bytes) => (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
const startsWith = (bytes, magic) => magic.every((b, i) => bytes[i] === b)

export const isZip = (bytes) => startsWith(view(bytes), ZIP)
export const isLegacyXls = (bytes) => startsWith(view(bytes), OLE)

// A workbook this app reads (.xlsx), or one it refuses with the fix (.xls).
export const looksLikeWorkbook = (bytes) => isZip(bytes) || isLegacyXls(bytes)
