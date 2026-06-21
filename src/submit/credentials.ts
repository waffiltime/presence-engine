// Maps a manageable surface to the .env token it needs and how to cheaply verify
// that token. verify() does ONE authenticated read and returns true if the token
// is valid. Throwing (network/no endpoint) is treated as "present but unverified".
export interface CredentialSpec {
  surfaceId: string;
  envVar: string;
  mintUrl: string;
  verify: (token: string) => Promise<boolean>;
}

export const CREDENTIAL_SPECS: CredentialSpec[] = [
  {
    surfaceId: 'github-repo-about-topics-readme-releases',
    envVar: 'GITHUB_TOKEN',
    mintUrl: 'https://github.com/settings/tokens',
    async verify(token: string): Promise<boolean> {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'presence-engine', Accept: 'application/vnd.github+json' },
      });
      return res.status === 200;
    },
  },
];

export function credentialSpecFor(surfaceId: string): CredentialSpec | undefined {
  return CREDENTIAL_SPECS.find(c => c.surfaceId === surfaceId);
}
