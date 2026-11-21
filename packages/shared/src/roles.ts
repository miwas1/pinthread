export const ROLES = ['site', 'mep', 'struct', 'arch'] as const;
export type Role = (typeof ROLES)[number];

export interface RoleInfo {
  role: Role;
  /** Short discipline label used in status text: "Waiting for Structural" */
  label: string;
  /** Job title shown under a name */
  title: string;
  /** Public discipline subchannel that receives Jump to pin alerts */
  discChannel: string;
  canHold: boolean;
}

export const ROLE_INFO: Record<Role, RoleInfo> = {
  site: { role: 'site', label: 'Site', title: 'Site lead', discChannel: 'discsite', canHold: false },
  mep: { role: 'mep', label: 'MEP', title: 'MEP lead', discChannel: 'discmep', canHold: false },
  struct: { role: 'struct', label: 'Structural', title: 'Structural engineer', discChannel: 'discstruct', canHold: true },
  arch: { role: 'arch', label: 'Architect', title: 'Architect', discChannel: 'discarch', canHold: true },
};

export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);

/** "Structural", "MEP and Structural", "Architect, MEP and Structural" */
export function roleList(roles: Role[]): string {
  const labels = roles.map(r => ROLE_INFO[r].label);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}
