import type { SubmitAdapter, SubmitProposal, SubmitResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

function parseImage(record: any): { namespace: string; repository: string } | undefined {
  const img: string | undefined = record?.links?.docker_image;
  if (!img) return undefined;
  const m = img.match(/^([^/]+)\/([^/:]+)/);
  if (!m) return undefined;
  return { namespace: m[1], repository: m[2] };
}

export const dockerHubAdapter: SubmitAdapter = {
  matches: (s: Surface) => s.surfaceId === 'docker-hub',

  plan(record, _surface): SubmitProposal {
    const parsed = parseImage(record);
    const full = record?.positioning?.long_description ?? record?.positioning?.one_liner ?? '';
    const payload = {
      namespace: parsed?.namespace ?? '',
      repository: parsed?.repository ?? '',
      full_description: full,
    };
    const preview = parsed
      ? `Update Docker Hub ${payload.namespace}/${payload.repository} full description:\n${full}`
      : 'No links.docker_image declared — cannot update.';
    return { mechanism: 'api', payload, preview };
  },

  async execute(proposal, _surface): Promise<SubmitResult> {
    const username = process.env.DOCKERHUB_USERNAME;
    const token = process.env.DOCKERHUB_TOKEN;
    if (!username || !token) return { outcome: 'failed', notes: 'no DOCKERHUB_USERNAME/DOCKERHUB_TOKEN set — run submit:connect' };
    const { namespace, repository, full_description } = proposal.payload as {
      namespace: string; repository: string; full_description: string;
    };
    if (!namespace || !repository) return { outcome: 'failed', notes: 'no links.docker_image declared' };

    const login = await fetch('https://hub.docker.com/v2/users/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: token }),
    });
    if (login.status !== 200) return { outcome: 'failed', notes: `Docker Hub login returned ${login.status}` };
    const { token: jwt } = (await login.json()) as { token?: string };
    if (!jwt) return { outcome: 'failed', notes: 'Docker Hub login returned no token' };

    const patch = await fetch(`https://hub.docker.com/v2/repositories/${namespace}/${repository}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `JWT ${jwt}` },
      body: JSON.stringify({ full_description }),
    });
    if (patch.status !== 200) return { outcome: 'failed', notes: `Docker Hub PATCH returned ${patch.status}` };
    return { outcome: 'submitted', evidenceUrl: `https://hub.docker.com/r/${namespace}/${repository}`, notes: 'updated Docker Hub description' };
  },
};
