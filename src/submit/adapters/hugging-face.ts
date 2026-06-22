import type { SubmitAdapter, SubmitProposal, SubmitResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

function buildCard(record: any): string {
  const name = String(record?.subject?.canonical_name ?? record?.subject?.slug ?? 'Model');
  const oneLiner = String(record?.positioning?.one_liner ?? '');
  const long = String(record?.positioning?.long_description ?? oneLiner);
  const homepage = String(record?.links?.homepage ?? '');
  const license = String(record?.attributes?.license ?? 'other');
  const front = ['---', `license: ${license}`, 'tags:', '  - presence-engine', '---'].join('\n');
  return `${front}\n\n# ${name}\n\n${oneLiner}\n\n${long}\n\n${homepage}`.trim();
}

export const huggingFaceAdapter: SubmitAdapter = {
  matches: (s: Surface) => s.surfaceId === 'hugging-face',

  plan(record, _surface): SubmitProposal {
    const card = buildCard(record);
    const model = record?.links?.hf_model ?? '(your model repo)';
    const preview = `Commit this as README.md in the Hugging Face model repo ${model}:\n\n${card}`;
    return { mechanism: 'assisted_manual', payload: { model, card }, preview };
  },

  async execute(proposal, _surface): Promise<SubmitResult> {
    const model = String((proposal.payload as any).model ?? 'your model repo');
    return { outcome: 'needs_human', notes: `Commit the prepared README.md to your Hugging Face model repo ${model} to update the model card.` };
  },
};
