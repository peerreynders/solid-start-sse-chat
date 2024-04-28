// file: src/types.ts
import type { ChatMessage } from './lib/chat';

export type History = Array<ChatMessage>;

export type HistoryAccess = {
	messages: () => Promise<History>;
	clientId: () => Promise<string | undefined>;
};
