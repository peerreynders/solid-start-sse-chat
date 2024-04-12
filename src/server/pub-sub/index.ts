// file: src/server/pub-sub/index.ts
import { makeChat, makeWelcome } from '../../lib/chat';
import { isTimeValue } from '../../lib/shame';
import { MessageCache } from './message-cache';
import { Streamer } from './streamer';

import type { Chat, ChatMessage, Welcome } from '../../lib/chat';
import type { SourceController } from '../event-stream';

const epochTimestamp = Date.now;
const messageId = (timestamp: number) => String(timestamp);
const messageTimestamp = (messages: ChatMessage[]) =>
	messages.length > 0 ? messages[0].timestamp : epochTimestamp();

function timeFromLastEventId(lastEventId: string | undefined) {
	const lastId = Number(lastEventId);
	return Number.isNaN(lastId) || !isTimeValue(lastId) ? 0 : lastId;
}

// The messageCache is used to hold historical messages
// to be included in the `Welcome` message
const messageCache = new MessageCache();

const makeInitialPayload = (clientId: string, lastTime = 0) =>
	function initialPayload(): [data: string, eventId: string] {
		let message: Chat | Welcome;
		if (lastTime > 0) {
			const messages = messageCache.sliceAfter(lastTime);
			message = makeChat(messages, messageTimestamp(messages));
		} else {
			const messages = messageCache.sliceAfter();
			message = makeWelcome(clientId, messages, messageTimestamp(messages));
		}
		return [JSON.stringify(message), messageId(message.timestamp)];
	};

// `streamer` manages all the client connections
// that use an event stream
const streamer = new Streamer({
	schedule: (addReceiverThunk) => setTimeout(addReceiverThunk, 0),
	clearTimer: (id) => clearTimeout(id),
	onChange: (_kind) => void 0,
});

const subscribe = (
	controller: SourceController,
	args: { clientId: string; lastEventId: string | undefined }
) =>
	streamer.add(
		controller.send,
		args.clientId,
		makeInitialPayload(args.clientId, timeFromLastEventId(args.lastEventId))
	);

// `send` caches the message and passes it
// to the `streamer` and `longpoller`
// so they can forward it to their respective clients
function send(body: string, clientId: string) {
	const message: ChatMessage = {
		timestamp: epochTimestamp(),
		from: clientId,
		body,
	};
	console.log('SERVER send', message, messageId(message.timestamp));
	messageCache.cache(message);
	streamer.send(
		JSON.stringify(makeChat([message], message.timestamp)),
		messageId(message.timestamp)
	);
	//longpoller.markMessage();
}

export { send, subscribe };

console.log('PUB-SUB', Date.now());
