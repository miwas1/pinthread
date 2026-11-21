// Nexconn ID rules (docs.nexconn.ai): community IDs letters/digits ≤ 64, subchannel IDs letters/digits ≤ 20.
import type { Role } from './roles';

export const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
export const BOT_USER_ID = 'ptbot';
export const FIXED_SUBCHANNELS = ['board', 'discmep', 'discstruct', 'discarch', 'discsite'] as const;
export const MAX_SUBCHANNELS_PER_COMMUNITY = 50;

const ALNUM = /^[A-Za-z0-9]+$/;
export const isValidCommunityId = (id: string) => ALNUM.test(id) && id.length <= 64;
export const isValidSubchannelId = (id: string) => ALNUM.test(id) && id.length <= 20;
export const isValidUserId = (id: string) => ALNUM.test(id) && id.length <= 64;

export const communityIdFor = (projectId: string) => `c${projectId}`;
export const pinSubchannelFor = (pinId: string) => `p${pinId}`;
export const demoUserIdFor = (projectId: string, role: Role) => `u${projectId}${role}`;
export const rfiNumber = (n: number) => `RFI-${String(n).padStart(3, '0')}`;
