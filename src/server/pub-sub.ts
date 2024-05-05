// file: pub-sub.ts
import type { Chat, Welcome } from './chat';

// Using channels uni-directionally for narrower types
// and read/write segregation

export type PubBound = {
	id: Welcome['id'];
	lastTime?: Welcome['timestamp'];
};

export type SubBound = Chat | Welcome;

const PUB_SUB_LINK = 'pub-sub-link';

export { PUB_SUB_LINK };
