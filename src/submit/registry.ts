import type { Surface } from '../surfaces/resolve.js';
import type { SubmitAdapter } from './types.js';
import { a2aCardAdapter } from './adapters/a2a-card.js';
import { x402Adapter } from './adapters/x402.js';
import { padXmlAdapter } from './adapters/pad-xml.js';
import { githubRepoAdapter } from './adapters/github-repo.js';
import { npmListingAdapter } from './adapters/npm-listing.js';
import { pypiListingAdapter } from './adapters/pypi-listing.js';

// No catch-all: a surface with no adapter is simply not actionable yet.
export const SUBMIT_ADAPTERS: SubmitAdapter[] = [
  a2aCardAdapter, x402Adapter, padXmlAdapter,
  githubRepoAdapter, npmListingAdapter, pypiListingAdapter,
];

export function adapterFor(surface: Surface): SubmitAdapter | undefined {
  return SUBMIT_ADAPTERS.find(a => a.matches(surface));
}
