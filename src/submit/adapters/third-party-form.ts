import type { SubmitAdapter, SubmitProposal, SubmitResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

// Third-party registries/directories where submission is a per-site form or a
// human-reviewed process. We prepare the field packet; a human submits it. This
// is deliberately NOT auto-posting (no browser automation, no ToS/CAPTCHA risk).
const THIRD_PARTY_SURFACES = new Set([
  'mcp-so',
  'smithery-ai',
  'glama-ai-mcp',
  'awesome-mcp-servers-github',
  'saashub',
  'long-tail-ai-saas-directories-100s',
]);

function buildFields(record: any): Record<string, unknown> {
  return {
    name: record?.subject?.canonical_name ?? record?.subject?.slug ?? 'unknown',
    category: record?.subject?.category ?? '',
    description: record?.positioning?.one_liner ?? '',
    homepage: record?.links?.homepage ?? '',
    repository: record?.links?.repository ?? '',
  };
}

export const thirdPartyFormAdapter: SubmitAdapter = {
  matches: (s: Surface) => THIRD_PARTY_SURFACES.has(s.surfaceId),

  plan(record, surface): SubmitProposal {
    const fields = buildFields(record);
    const preview = `Submit to ${surface.name} (human step):\n${JSON.stringify(fields, null, 2)}`;
    return { mechanism: 'assisted_manual', payload: { surfaceName: surface.name, fields }, preview };
  },

  async execute(proposal, surface): Promise<SubmitResult> {
    const name = String((proposal.payload as any).surfaceName ?? surface.name);
    return { outcome: 'needs_human', notes: `Submit the prepared details to ${name} — see the preview for the exact fields.` };
  },
};
