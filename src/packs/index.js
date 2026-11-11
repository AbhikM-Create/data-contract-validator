// The packs shipped with the app and the CLI (v3-spec §6). Data, not engine:
// src/lib/packs.js reads them and never imports this file.
import finance from './finance-tally-zoho-books.js'
import hr from './hr-payroll-zoho-payroll.js'

export const PACKS = [finance, hr]

export const findPack = (id) => PACKS.find((pack) => pack.id === id) ?? null
