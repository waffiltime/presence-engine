import type { SubmitAdapter, SubmitProposal, SubmitResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

function keywords(record: any): string[] {
  const out = new Set<string>();
  const cat: string | undefined = record?.subject?.category;
  if (cat) for (const w of cat.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) out.add(w);
  return [...out];
}

export const npmListingAdapter: SubmitAdapter = {
  matches: (s: Surface) => s.surfaceId === 'npm',

  plan(record, _surface): SubmitProposal {
    const fields = {
      description: record?.positioning?.one_liner ?? '',
      homepage: record?.links?.homepage ?? '',
      repository: record?.links?.repository ?? '',
      keywords: keywords(record),
    };
    const pkg = record?.links?.npm_package ?? '(your package)';
    const preview = `Set these fields in package.json for ${pkg}, then \`npm publish\`:\n${JSON.stringify(fields, null, 2)}`;
    return { mechanism: 'assisted_manual', payload: { package: pkg, fields }, preview };
  },

  async execute(proposal, _surface): Promise<SubmitResult> {
    const pkg = String((proposal.payload as any).package ?? 'your package');
    return { outcome: 'needs_human', notes: `Apply the package.json changes for ${pkg} and run npm publish to update the listing.` };
  },
};
