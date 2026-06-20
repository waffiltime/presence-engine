import type { Surface } from '../surfaces/resolve.js';

export type Mechanism = 'api' | 'github_pr' | 'manifest' | 'assisted_manual' | 'draft';

export type SubmitOutcome = 'submitted' | 'pending_external' | 'needs_human' | 'failed';

export interface SubmitProposal {
  mechanism: Mechanism;
  payload: Record<string, unknown>;
  preview: string;
}

export interface SubmitResult {
  outcome: SubmitOutcome;
  evidenceUrl?: string;
  notes?: string;
}

export interface SubmitAdapter {
  matches(surface: Surface): boolean;
  plan(record: any, surface: Surface): SubmitProposal;
  execute(proposal: SubmitProposal, surface: Surface): Promise<SubmitResult>;
}
