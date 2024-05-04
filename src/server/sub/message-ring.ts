// file: src/server/sub/message-ring.ts
import { MAX_TIMEVALUE } from '../../lib/shame';
import { makeChat, makeKeepAlive, type Chat, type ChatMessage, type Message } from '../chat';

type Core = {
	historyInterval: number;
	lowerBound: number;
	data: Array<ChatMessage>;
	capacity: number;
	head: number;
	tail: number;
}

// lowerBound needs to be the
// timestamp of **very first** message going onto the ring 
// and after that the time on the last message dropped.
	
// update lowerbound when oldest message is dropped
// when the last message is dropped keep it's time as 
// the lowest bound until the next message comes in.

// `head` is the index to the most recent message (least recently added)
// `tail` is the index to the oldest message (least recently added)
// both are -1 when the buffer is empty.
/*
const size = ({ capacity, head, tail }: Core) =>
  head < 0
    ? 0
    : head >= tail
      ? head - tail + 1
      : capacity - tail + head + 1;
*/
const free = ({ capacity, head, tail }: Core) =>
  head < 0
		? capacity
		: tail > head 
			? tail - head - 1
			: capacity - head - 1 + tail;

const CAPACITY_INCREMENT = 32;

function resize(core: Core, freeNeeded: number) {
	const newCapacity = (Math.trunc((core.capacity + (freeNeeded - free(core)))/CAPACITY_INCREMENT) + 1) * CAPACITY_INCREMENT;
	const newBuffer: Array<ChatMessage> = [];

	// Copy existing data over if there is any
	if (core.head > -1) {
		for(let source = core.tail, i = 0;; i += 1) {
			newBuffer[i] = core.data[source];

			if (source === core.head) 
				break;

			source = (source + 1) % core.capacity; 
		}

		core.tail = 0;
		core.head = newBuffer.length - 1;
	}

	core.data = newBuffer;
	core.capacity = newCapacity;
}

function purge(core: Core, now: number) {
	if (core.tail < 0) return;

	const bound = now - core.historyInterval;

	// Copy least to most recent message
	for (let i = core.tail;;) {
		const message = core.data[i];
		if (message.timestamp >= bound) {
			// Keep the remaining entries
			// making this the last one
			core.tail = i;
			break;
		}

		// discarding this entry
		// but retain the time
		core.lowerBound = message.timestamp;
		if (i === core.head) {
			// Reached the last entry
			// the buffer is now empty
			core.head = -1;
			core.tail = -1;
			break;
		}

		i = (i + 1) % core.capacity; 
	}
}

function push(core: Core, chat: Chat, now: number) {
	purge(core, now);
	const length = chat.messages.length;
	if (length < 1) 
		return;

	if (free(core) < length) 
		resize(core, length);

	let target = core.head;
	if (target < 0) {
		// prepare empty buffer
		target = 0;
		core.tail = 0;

		// Initialize lowerBound the very first time
		if (core.lowerBound === MAX_TIMEVALUE)
			core.lowerBound = chat.messages[length -1].timestamp;

	} else {
		target = (target + 1) % core.capacity;
	}

	// Copy least to most recent message
	for (let i = length - 1; i >= 0; i -= 1) {
		if (target === core.tail && target !== 0) 
			throw new Error('Buffer overrun');

		core.data[target] = chat.messages[i];
		core.head = target;

		target = (target + 1) % core.capacity;
	}
}

// MessageRing caches the ChatMessages that have occurred within the most recent
// `historyInterval` timeframe (usually set to double of the keepAlive interval)
// - `countAfter(lastTime)` returns the number of messages that are buffered that
//    are timestamped more recently than `lastTime`
//    If `count >= 0` it's OK to pass a longpoll to the poll yard as there 
//    shouldn't be any missed messages
//    Otherwise (-1) the poll should just be serviced with a full Welcome message.
// - `toMessage()` returns a message based on `lastTime`. 
// 		If there are no messages more recent than `lastTime` then a `KeepAlive` 
// 		message is returned.
// 		Otherwise a `Chat` message is assembled containing all the messages that
// 		are more recent than `lastTime`. 
//	- push() adds the message to the internal buffer.
// 		This operation may truncate the internal buffer of older messages.
//    This operation may resize/reallocate the internal buffer to accomodate 
//    the additional message
//
class MessageRing {
	readonly countAfter: (now: number, lastTime: number, margin: number) => number;
	readonly push: (now: number, message: Chat) => void;
	readonly toMessage : (now: number, clientId: string, lastTime: number) => Message;

	constructor(
		historyInterval: number
	) {
		const core: Core = {
			historyInterval,
			lowerBound: MAX_TIMEVALUE,
			data: [],
			capacity: CAPACITY_INCREMENT,
			head: -1,
			tail: -1,
		}

		this.countAfter = (now, lastTime, minWait = 0) => {
			// If there could be missing messages
			if(core.lowerBound > lastTime) 
				return -1;
			
			// If there is nothing to be missed
			if (core.tail < 0) 
				return 0;

			// count starting from the most recent message
			// how many messages have a more recent timestamps
			const retainBound = now + minWait - core.historyInterval;
			let count = 0;
			// Traverse most to least recent
			for (let i = core.head;;) {
				const timestamp = core.data[i].timestamp;

				// If we don't need this message
				if (timestamp <= lastTime) 
					break;

				// If we could lose this message
				if (timestamp <= retainBound)
					return -1;

				count += 1;

				// If we traversed all the messages
				if (i === core.tail)
					break;

				i = i < 1 ? core.capacity - 1 : i - 1;
			}
			return count;;
		};

		this.push = (now, message) => push(core, message, now);

		this.toMessage = (now, clientId, lastTime) => {
			let source = core.head;
			// Return a KeepAlive message if there are
			// no relevant ChatMessages
			let current = source > -1 ? core.data[source] : undefined;
			if (!current || current.timestamp <= lastTime) 
				return makeKeepAlive(now);

			const messages: Array<ChatMessage> = [];
			// Copy most to least recent.
			for (;;) {
				messages.push(current);

				// Copied last one?
				if (source === core.tail) 
					break;

				source = source < 1 ? core.capacity - 1 : source - 1;
				current = core.data[source];

				// Is this one still relevant?
				if (current.timestamp <= lastTime) 
					break;
			}
			return makeChat(messages, messages[0].timestamp, clientId);
		};
	}
}

export {
	MessageRing
};
