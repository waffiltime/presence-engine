import { db } from '../db.js';
import { surfaces } from '../schema.js';

export type Surface = typeof surfaces.$inferSelect;

// The canonical-record `subject.kind` taxonomy (saas, web_app, dev_tool, library,
// api, ai_agent, model, desktop_app, mobile_app) differs from the surface-registry's
// shorter relevant-kinds vocabulary (agent, api, dev, lib, web, model, desktop, mobile).
// Map record kind → registry kind so resolution agrees across the boundary.
const KIND_TO_REGISTRY: Record<string, string> = {
  ai_agent: 'agent',
  api: 'api',
  library: 'lib',
  dev_tool: 'dev',
  web_app: 'web',
  saas: 'web',
  model: 'model',
  desktop_app: 'desktop',
  mobile_app: 'mobile',
};

export async function resolveSurfaces(kind: string): Promise<Surface[]> {
  // Accept either vocabulary; fall back to the raw kind if it's already a registry kind.
  const registryKind = KIND_TO_REGISTRY[kind] ?? kind;
  const all = await db.select().from(surfaces);
  return all.filter(s => {
    if (!Array.isArray(s.relevantKinds)) return false;
    const kinds = s.relevantKinds as string[];
    // 'all' is the registry's wildcard (HN, Reddit, open web search, …) — relevant to every kind.
    return kinds.includes('all') || kinds.includes(registryKind);
  });
}
