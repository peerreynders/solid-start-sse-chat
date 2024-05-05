// file src/components/history-context/longpoller.ts

// A prepared fetch will return
// - `true` if it has received a message payload (perhaps empty)
// - `false` if the response is not OK (which increments the `abort` count on `Core`)
// `abort` activates the fetch's abort (used when the when the
// poller is disconnected)
//
type PreparedFetch = {
	(): Promise<boolean>;
	abort: () => void;
};

// aborted: number of consecutive failed fetches
//   Resets to 0 on the next successful connection
type Core<Tid> = {
	startId: Tid | undefined;
	aborted: number;
	prepared: PreparedFetch | undefined;
	disconnect: () => void;
	path: string;
	betweenMs: number;
	backoffMs: number;
	schedule: (
		fetchPoll: (core: Core<Tid>) => Promise<void>,
		delayMs: number,
		core: Core<Tid>
	) => Tid;
	prepareMessageFetch: (path: string) => PreparedFetch;
	pollFailed: () => void;
};

// fetchByPoll prepares and executes a single fetch
// for messages which the server will respond to in a
// delayed fashion to maximize the messages sent back.
// If successful the function reschedules itself
// If not successful it just increments the abort count
//   and exits expecting the LongPoller's `connect` to
//   be invoked from the outside
// On failure it disconnects (cleans up) and notifies
//   the poll's failure (leading to a higher level connection failure)
async function fetchByPoll<Tid>(core: Core<Tid>) {
	console.assert(
		core.prepared === undefined,
		'prepared fetch  unexpectedly set (fetchByPoll)'
	);
	const { path, betweenMs, prepareMessageFetch, schedule } = core;

	core.prepared = prepareMessageFetch(path);
	core.startId = undefined;
	try {
		const success = await core.prepared();
		core.prepared = undefined;

		if (success) {
			core.startId = schedule(fetchByPoll, betweenMs, core);
			core.aborted = 0;
		} else {
			// Aborted: Leave it to keepAlive/connect to
			// schedule another fetchByPoll
			core.aborted += 1;
		}
	} catch (error) {
		console.error('fetchPoll', error instanceof Error ? error.name : error);
		core.prepared = undefined;
		core.disconnect();
		core.pollFailed();
	}
}

export type Link<Tid> = Pick<
	Core<Tid>,
	'betweenMs' | 'backoffMs' | 'schedule' | 'prepareMessageFetch' | 'pollFailed'
> & {
	clearTimer: (id: Tid) => void;
	cancelTimeout: () => void;
};

// A Longpoller instance acts as the controller handle
// to `fetchByPoll` for the "owner"
// It exposes `connect` to schedule the (self scheduling)
// fetchByPoll and an `isActive()` query.
// The Longpoller is active if either `fetchByPoll` is
// scheduled or in progress.

class Longpoller<Tid> {
	// Implemented as properties rather than methods
	// so we can pass around the functions without
	// giving access to the whole object
	readonly connect: (path: string) => void;
	readonly disconnect: () => void;
	readonly isActive: () => boolean;

	constructor(link: Link<Tid>) {
		const core: Core<Tid> = {
			startId: undefined,
			aborted: 0,
			prepared: undefined,
			disconnect: () => {
				link.cancelTimeout();
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
			path: '',
			betweenMs: link.betweenMs,
			backoffMs: link.backoffMs,
			schedule: link.schedule,
			prepareMessageFetch: link.prepareMessageFetch,
			pollFailed: link.pollFailed,
		};

		this.connect = (path: string) => {
			console.assert(
				core.prepared === undefined && core.startId === undefined,
				'prepared fetch unexpectedly set (connect)'
			);
			core.path = path;
			// schedule the larger `backoffMs` if at least one
			// unsuccessful fetch just happend
			const delay = core.aborted < 1 ? core.betweenMs : core.backoffMs;
			core.startId = core.schedule(fetchByPoll, delay, core);
		};

		this.disconnect = core.disconnect;

		this.isActive = () => Boolean(core.prepared || core.startId);
	}
}

export { Longpoller };
