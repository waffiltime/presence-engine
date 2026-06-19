// Closed-set actor strings — a typo becomes a compile error, not a bad log row.
export const ACTORS = {
  researcher: 'researcher', // web-reading code path (no creds)
  drafter: 'drafter',       // LLM code path (no browsing)
  publisher: 'publisher',   // the only path that loads credentials
  human: 'human',
  system: 'system',
} as const;
export type Actor = (typeof ACTORS)[keyof typeof ACTORS];
