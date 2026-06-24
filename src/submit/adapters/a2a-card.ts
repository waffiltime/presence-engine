import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SubmitAdapter, SubmitProposal, SubmitResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

function buildCard(record: any): Record<string, unknown> {
  return {
    name: record?.subject?.canonical_name ?? record?.subject?.slug ?? 'unknown',
    description: record?.positioning?.one_liner ?? '',
    url: record?.links?.agent_endpoint ?? record?.links?.homepage ?? '',
    provider: { organization: record?.disambiguation?.official_domain ?? '' },
    version: record?.attributes?.current_version ?? '1.0',
  };
}

export const a2aCardAdapter: SubmitAdapter = {
  matches: (s: Surface) => s.surfaceId === 'a2a-agent-card-well-known-agent-json',

  plan(record, _surface): SubmitProposal {
    const body = buildCard(record);
    const preview = JSON.stringify(body, null, 2);
    return { mechanism: 'manifest', payload: { ...body, _slug: record?.subject?.slug, _path: '.well-known/agent.json' }, preview };
  },

  async execute(proposal, _surface): Promise<SubmitResult> {
    const slug = String(proposal.payload._slug ?? 'project');
    const relPath = String(proposal.payload._path ?? '.well-known/agent.json');
    const { _slug, _path, ...body } = proposal.payload as Record<string, unknown>;
    const outPath = `out/${slug}/${relPath}`;
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(body, null, 2), 'utf-8');
    const domain = String((body as any).provider?.organization ?? 'your-domain');
    return {
      outcome: 'needs_human',
      evidenceUrl: `https://${domain}/.well-known/agent.json`,
      notes: `Generated ${outPath}. Deploy it to your domain to go live.`,
    };
  },
};
