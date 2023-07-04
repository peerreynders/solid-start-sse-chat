type TimerId = ReturnType<typeof setTimeout>;

type PreparedFetch = {
	(): Promise<boolean>;
	abort: () => void;
};

type Core = {
	startId: TimerId | undefined;
	aborted: number;
	prepared: PreparedFetch | undefined;
	disconnect: () => void;
	href: string;
	betweenMs: number;
	backoffMs: number;
	schedule: (
		fetchPoll: (core: Core) => Promise<void>,
		delayMs: number,
		core: Core
	) => TimerId;
	prepareMessageFetch: (path: string) => PreparedFetch;
	pollFailed: () => void;
};

async function fetchByPoll(core: Core) {
	console.assert(
		core.prepared === undefined,
		'prepared fetch  unexpectedly set (fetchByPoll)'
	);
	const { href, betweenMs, prepareMessageFetch, schedule } = core;

	core.prepared = prepareMessageFetch(href);
	core.startId = undefined;
	try {
		core.aborted = (await core.prepared()) ? 0 : core.aborted;

		if (!core.startId) {
			// keepAlive & connect didn't already schedule another fetchByPoll
			core.startId = schedule(fetchByPoll, betweenMs, core);
			core.prepared = undefined;
		}
	} catch (error) {
		console.error('fetchPoll', error instanceof Error ? error.name : error);
		core.prepared = undefined;
		core.disconnect();
		core.pollFailed();
	}
}

const _core = Symbol('Longpoller');

export type Link = Pick<
	Core,
	'betweenMs' | 'backoffMs' | 'schedule' | 'prepareMessageFetch' | 'pollFailed'
> & {
	clearTimer: (id: TimerId) => void;
	stopKeepAlive: () => void;
};

class Longpoller {
	readonly [_core]: Core;
	readonly disconnect: () => void;

	constructor(link: Link) {
		const core: Core = {
			startId: undefined,
			aborted: 0,
			prepared: undefined,
			disconnect: () => {
				link.stopKeepAlive();
				if (core.startId) {
					link.clearTimer(core.startId);
					core.startId = undefined;
				}

				if (core.prepared) {
					core.aborted += 1;
					core.prepared.abort();
					core.prepared = undefined;
				}
			},
			href: '',
			betweenMs: link.betweenMs,
			backoffMs: link.backoffMs,
			schedule: link.schedule,
			prepareMessageFetch: link.prepareMessageFetch,
			pollFailed: link.pollFailed,
		};
		this.disconnect = core.disconnect;
		this[_core] = core;
	}

	connect(href: string) {
		const core = this[_core];
		console.assert(
			core.prepared === undefined && core.startId === undefined,
			'prepared fetch unexpectedly set (connect)'
		);
		core.href = href;
		const delay = core.aborted < 1 ? core.betweenMs : core.backoffMs;
		core.startId = core.schedule(fetchByPoll, delay, core);
	}

	get active() {
		return this[_core].prepared || this[_core].startId;
	}
}

export { Longpoller };
