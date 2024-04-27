// file: src/server/pub/index.ts
import { getRequestEvent } from 'solid-js/web';
import { makeChat, makeClientReply, type ChatMessage } from '../chat';
import { PUB_SUB_LINK, type PubBound } from '../pub-sub';
import { epochTimestamp } from '../../lib/shame';
import { MessageCache } from './message-cache';

const messageCache = new MessageCache();
let channel: BroadcastChannel | undefined;

const messageTimestamp = (messages: ChatMessage[]) =>
	messages.length > 0 ? messages[0].timestamp : epochTimestamp();

// Note: this module doesn't reply to requests
// until the first `broadcast` call loads the module.
// This makes it necessary for the `src/server/sub`
// to time out with an empty Welcome

// Listen for requests for messages and reply with
// those found in the cache;
function listenForRequests() {
	if (channel) return;

	channel = new BroadcastChannel(PUB_SUB_LINK);

	const receiver = (event: MessageEvent<PubBound>) => {
		if (!channel) return;

		const message = event.data;
		const messages = messageCache.sliceAfter(message.lastTime);
		channel.postMessage(
			makeClientReply(
				messages,
				messageTimestamp(messages),
				message.id,
				message.lastTime
			)
		);
	};
	channel.addEventListener('message', receiver);
}

// Cache the message for later
// Set up the channel it necessary.
async function broadcast(body: string) {
	console.log('PUB', body);
	if (!channel) listenForRequests();

	const event = getRequestEvent();
	if (!event) return false;

	const message = {
		timestamp: epochTimestamp(),
		from: event.locals.clientId,
		body,
	};
	messageCache.cache(message);

	const chat = makeChat([message], message.timestamp);
	channel?.postMessage(chat);
	return true;
}

export { broadcast };
