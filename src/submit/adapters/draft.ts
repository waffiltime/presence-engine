import type { SubmitAdapter, SubmitProposal, SubmitResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

// Community/social surfaces where auto-promotion is banned/risky. We DRAFT post
// copy; a human reviews and posts it. There is intentionally NO network-write
// path here — these can never fire themselves.
const DRAFT_SURFACES = new Set([
  'hacker-news-show-hn',
  'reddit-relevant-subs',
  'dev-to',
  'lobsters-indie-hackers',
  'x-twitter',
  'product-hunt',
]);

function draftFor(surfaceId: string, record: any): string {
  const name = String(record?.subject?.canonical_name ?? record?.subject?.slug ?? 'the project');
  const oneLiner = String(record?.positioning?.one_liner ?? '');
  const homepage = String(record?.links?.homepage ?? '');
  const repo = String(record?.links?.repository ?? '');

  switch (surfaceId) {
    case 'hacker-news-show-hn':
      return `Show HN: ${name} – ${oneLiner}\n\n${homepage}\n\nWhat it is: ${oneLiner}\nRepo: ${repo}\n\n(Be ready to answer questions in the thread.)`;
    case 'x-twitter': {
      const base = `${name}: ${oneLiner}`;
      const withLink = `${base} ${homepage}`.trim();
      return withLink.length <= 280 ? withLink : `${base.slice(0, 279 - homepage.length - 2)}… ${homepage}`.trim();
    }
    case 'product-hunt':
      return `Tagline: ${name} — ${oneLiner}\n\nDescription:\n${oneLiner}\n${homepage}`;
    case 'dev-to':
      return `# Introducing ${name}\n\n${oneLiner}\n\nLink: ${homepage}\nSource: ${repo}\n\n(Write a short walkthrough of the problem it solves.)`;
    case 'reddit-relevant-subs':
    case 'lobsters-indie-hackers':
    default:
      return `Title: ${name} — ${oneLiner}\n\n${oneLiner}\n${homepage}\n\n(Post only in genuinely relevant communities; lead with the problem, not the pitch.)`;
  }
}

export const draftAdapter: SubmitAdapter = {
  matches: (s: Surface) => DRAFT_SURFACES.has(s.surfaceId),

  plan(record, surface): SubmitProposal {
    const draft = draftFor(surface.surfaceId, record);
    return { mechanism: 'draft', payload: { surfaceName: surface.name, draft }, preview: `Draft for ${surface.name}:\n\n${draft}` };
  },

  async execute(proposal, surface): Promise<SubmitResult> {
    const name = String((proposal.payload as any).surfaceName ?? surface.name);
    return { outcome: 'needs_human', notes: `Draft ready for ${name} — review and post it yourself. The tool never auto-posts here.` };
  },
};
