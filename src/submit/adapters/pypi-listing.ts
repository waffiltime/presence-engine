import type { SubmitAdapter, SubmitProposal, SubmitResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

export const pypiListingAdapter: SubmitAdapter = {
  matches: (s: Surface) => s.surfaceId === 'pypi',

  plan(record, _surface): SubmitProposal {
    const fields = {
      description: record?.positioning?.one_liner ?? '',
      homepage: record?.links?.homepage ?? '',
      repository: record?.links?.repository ?? '',
    };
    const pkg = record?.links?.pypi_package ?? '(your package)';
    const preview = `Set these in pyproject.toml [project] for ${pkg}, then publish a new release:\n${JSON.stringify(fields, null, 2)}`;
    return { mechanism: 'assisted_manual', payload: { package: pkg, fields }, preview };
  },

  async execute(proposal, _surface): Promise<SubmitResult> {
    const pkg = String((proposal.payload as any).package ?? 'your package');
    return { outcome: 'needs_human', notes: `Apply the pyproject.toml changes for ${pkg} and publish a new release to update the listing.` };
  },
};
