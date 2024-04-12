// file: src/components/message-context/streamer.ts

type Core = {
	source: EventSource | undefined;
	waiting: boolean;
	beforeDisconnect: () => void;
	afterConnect: () => void;
};
// `waiting` is set to `true` right after the `EventSource` is created
// and then set to `false` once the first `message` event is received.
// It's used to detect whether an `error` event is the first event
// after the `EventSource` is created

const READY_STATE_CLOSED = 2;

// Symbol used as an obfuscated property on
// Streamer class in lieu of using # for real
// private property (casual, rather than enforced privacy)
const _core = Symbol('Streamer');

// Constructor argument
// The "Link" between the data/eventId consumer and
//	the Streamer instance managing the event source object
//
// - beforeDisconnect: thunk to stop keepAlive timer
// - afterConnect: thunk that is called after a new event source
//		has been set up (at the end of connect method
// - streamFailed: thunk that is called after the event source
//		disconnects because of an error event. This typically happens
//		when the original event source request fails to establish a
//		connection at which point long polling is the only viable
//		alternative.
// - handleMessageData: callback delivering the data string and
// 		`eventId` from a server event.
//
type Link = Pick<Core, 'beforeDisconnect' | 'afterConnect'> & {
	streamFailed: () => void;
	handleMessageData: (data: string, eventId: string | undefined) => void;
};

// This is implemented as EventListenerObject
// https://gist.github.com/WebReflection/35ca0e2ef2fb929143ea725f55bc0d63
// so it can add itself as a event listener
// while all the event handling code is in `handleEvent`
//
// - `disconnect()` removes the event listeners, closes
// 	and discards the event source after first calling `beforeDisconnect`
// - `connect()` creates EventSource with the specified `href` and
// 	add itself as an event Listener before calling `afterConnect`
// - `active()` is `true` if this instance is managing an
// 	EventSource right now; i.e. is after a `connect()` but before
// 	a disconnect.

class Streamer implements EventListenerObject {
	readonly [_core]: Core;
	readonly handleEvent: (event: Event) => void;
	constructor(link: Link) {
		const core: Core = {
			source: undefined,
			waiting: true,
			beforeDisconnect: link.beforeDisconnect,
			afterConnect: link.afterConnect,
		};

		this.handleEvent = (event: Event) => {
			if (event.type === 'message' && event instanceof MessageEvent) {
				this[_core].waiting = false;
				link.handleMessageData(event.data, event.lastEventId);
				return;
			}

			if (event.type === 'error') {
				const { source, waiting } = this[_core];
				// No way to identify the reason here so try long polling next
				if (source?.readyState === READY_STATE_CLOSED && waiting) {
					this.disconnect();
					link.streamFailed();
				}
				console.log('onError', event);
				return;
			}
		};

		this[_core] = core;
	}

	// Needs to be safe to call at any time
	disconnect() {
		const core = this[_core];
		if (core.source === undefined) return;

		core.beforeDisconnect();
		core.source.removeEventListener('message', this);
		core.source.removeEventListener('error', this);
		core.source.close();
		core.source = undefined;
	}

	connect(href: string) {
		const core = this[_core];
		core.source = new EventSource(href);
		core.waiting = true;
		core.source.addEventListener('error', this);
		core.source.addEventListener('message', this);
		core.afterConnect();
	}

	get active() {
		return this[_core].source !== undefined;
	}
}

export { Streamer };
