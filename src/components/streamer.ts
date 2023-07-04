type Core = {
	source: EventSource | undefined;
	waiting: boolean;
	stopKeepAlive: () => void;
	streamWaiting: () => void;
};

const READY_STATE_CLOSED = 2;

const _core = Symbol('Streamer');

type Link = Pick<Core, 'stopKeepAlive' | 'streamWaiting'> & {
	streamFailed: () => void;
	handleMessageData: (data: string, eventId: string | undefined) => void;
};

class Streamer implements EventListenerObject {
	readonly [_core]: Core;
	readonly handleEvent: (event: Event) => void;
	constructor(link: Link) {
		const core: Core = {
			source: undefined,
			waiting: true,
			stopKeepAlive: link.stopKeepAlive,
			streamWaiting: link.streamWaiting,
		};

		this.handleEvent = (event: Event) => {
			if (event.type === 'message' && event instanceof MessageEvent) {
				this[_core].waiting = false;
				link.handleMessageData(event.data, event.lastEventId);
				return;
			}

			if (event.type === 'Error') {
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

	disconnect() {
		const core = this[_core];
		if (core.source === undefined) return;

		core.stopKeepAlive();
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
		core.streamWaiting();
	}

	get active() {
		return this[_core].source !== undefined;
	}
}

export { Streamer };
