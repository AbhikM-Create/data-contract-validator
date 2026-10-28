// The version every report, JUnit file and evidence pack is stamped with, so a
// verdict can be traced to the code that produced it. Kept equal to
// package.json's version by a test.
export const VERSION = '2.0.0'

// The git commit the browser bundle was built from, set by vite.config.js;
// null where it is not known (Node, tests). The CLI finds its own commit.
// oxlint-disable-next-line no-undef
export const BUILD_COMMIT = typeof __DCV_COMMIT__ === 'string' ? __DCV_COMMIT__ : null

// Report formats: a downstream job reads the JSON a CLI prints, so its shape is
// versioned and described by a JSON Schema in schemas/. A change that removes or
// renames a field bumps the number.
export const REPORT_SCHEMAS = {
  reconcile: 'urn:data-contract-validator:schema:reconcile-report:1',
  readiness: 'urn:data-contract-validator:schema:readiness-report:1',
  board: 'urn:data-contract-validator:schema:board-report:1',
}
