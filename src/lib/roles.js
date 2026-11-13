// Roles inside an organisation (user state 5). Pure.
//
// Four roles, fixed. The database enforces them (supabase/schema.sql: every
// policy on an organisation's rows reads the member's role); this module only
// says the same thing on screen, so a button is not offered that the server
// would refuse. A role grants rights over the organisation's objects, never
// over a member's personal ones.

export const ROLES = [
  { id: 'admin', label: 'Admin', can: 'Manages members and invitations, deletes objects; everything below' },
  { id: 'editor', label: 'Editor', can: 'Writes definitions, opens files, runs checks, saves objects' },
  { id: 'approver', label: 'Approver', can: 'Records decisions and signs off, and saves the record' },
  { id: 'viewer', label: 'Viewer', can: 'Reads objects, results and records — an auditor, for instance' },
]
export const ROLE_IDS = ROLES.map((role) => role.id)

const RIGHTS = {
  read: ['admin', 'editor', 'approver', 'viewer'],
  save: ['admin', 'editor', 'approver'],
  delete: ['admin'],
  manageMembers: ['admin'],
}

// can('editor', 'save') -> true. An unknown role or action is false.
export const can = (role, action) => Boolean(RIGHTS[action]?.includes(role))

export const roleLabel = (id) => ROLES.find((role) => role.id === id)?.label ?? id

export const cleanEmail = (email) => String(email ?? '').trim().toLowerCase()
export const looksLikeEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(email))
