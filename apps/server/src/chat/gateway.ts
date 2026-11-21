export interface SendSpec {
  communityId: string;
  subchannelId: string;
  fromUserId: string;
  messageType: string;
  /** Object for custom (pt:*) types; built-in types use Nexconn's server JSON format (RC:TxtMsg {content}, RC:ImgMsg {content, imageUri}). */
  content: Record<string, unknown>;
  pushContent?: string;
  mentionUserIds?: string[];
  /** Status message: delivered to online users only, not stored, not counted. */
  transient?: boolean;
  counted?: boolean;
  metadata?: Record<string, string>;
}

export interface ChatGateway {
  mode: 'nexconn' | 'local';
  issueToken(userId: string, name: string, avatarUrl?: string): Promise<string>;
  createCommunity(communityId: string, ownerUserId: string, name: string): Promise<void>;
  joinCommunity(communityId: string, userId: string): Promise<void>;
  createSubchannel(communityId: string, subchannelId: string, isPrivate: boolean): Promise<void>;
  addPrivateMembers(communityId: string, subchannelId: string, userIds: string[]): Promise<void>;
  send(spec: SendSpec): Promise<{ messageId: string | null }>;
  setMetadata(communityId: string, subchannelId: string, messageId: string, metadata: Record<string, string>): Promise<void>;
  dismissCommunity(communityId: string): Promise<void>;
}

let current: ChatGateway | null = null;
export const setGateway = (g: ChatGateway) => { current = g; };
export const gateway = (): ChatGateway => {
  if (!current) throw new Error('Chat gateway not initialised');
  return current;
};
