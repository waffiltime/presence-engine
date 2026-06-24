import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SubmitAdapter, SubmitProposal, SubmitResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

function buildManifest(record: any): Record<string, unknown> {
  return {
    name: record?.subject?.canonical_name ?? record?.subject?.slug ?? 'unknown',
    endpoint: record?.links?.agent_endpoint ?? '',
    x402Version: 1,
  };
}

export const x402Adapter: SubmitAdapter = {
  matches: (s: Surface) => s.surfaceId === 'x402-manifest-well-known-x402',

  plan(record, _surface): SubmitProposal {
    const body = buildManifest(record);
    return {
      mechanism: 'manifest',
      payload: { ...body, _slug: record?.subject?.slug, _path: '.well-known/x402', _domain: record?.disambiguation?.official_domain },
      preview: JSON.stringify(body, null, 2),
    };
  },

  async execute(proposal, _surface): Promise<SubmitResult> {
    const slug = String(proposal.payload._slug ?? 'project');
    const relPath = String(proposal.payload._path ?? '.well-known/x402');
    const domain = String(proposal.payload._domain ?? 'your-domain');
    const { _slug, _path, _domain, ...body } = proposal.payload as Record<string, unknown>;
    const outPath = `out/${slug}/${relPath}`;
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(body, null, 2), 'utf-8');
    return {
      outcome: 'needs_human',
      evidenceUrl: `https://${domain}/.well-known/x402`,
      notes: `Generated ${outPath}. Deploy it to your domain to go live.`,
    };
  },
};
