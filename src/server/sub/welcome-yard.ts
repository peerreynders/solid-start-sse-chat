// file: src/server/sub/welcome-yard.ts
import { MAX_TIMEVALUE } from '../../lib/shame';
import type { SubBound } from '../pub-sub';

// WelcomeYard holds `Pending<T>` entries
// until
// 1. the entry is `take`n (either because of an `unsubscribe` or because the message for `send` is ready)
// 2. the entry times out. At that point `send` is passed the message that is produced by `makeTimedout`
//
export type Pending<Tdata = unknown> = {
	id: string;
	expire: number;
	send: (message: SubBound) => void;
	data: Tdata;
};

type Core<Tid> = {
	pending: Map<string, Pending<unknown>>;
	makeTimedout: (item: Pending<unknown>) => SubBound;
	nextTimeout: number;
	timerId: Tid | undefined;
	clearTimer: (id: Tid | undefined) => void;
	setTimer: (cb: (c: Core<Tid>) => void, delay: number, c: Core<Tid>) => Tid;
	timeMs: () => number;
	cancelNext: () => void;
};

type Link<Tid> = Pick<
	Core<Tid>,
	'makeTimedout' | 'clearTimer' | 'setTimer' | 'timeMs'
>;

// Note: this function is intentionally kept synchronous
function sweep<Tid>(core: Core<Tid>) {
	const now = core.timeMs();
	const replyTo = [];

	// Find:
	// 1. All timed out entries
	// 2. The next timeout needed
	let nextExpire = MAX_TIMEVALUE;
	for (const item of core.pending.values()) {
		if (item.expire <= now) {
			// done waiting
			replyTo.push(item);
			core.pending.delete(item.id);
			continue;
		}

		// still waiting
		if (item.expire < nextExpire) nextExpire = item.expire;
	}

	// Sort out the next timeout first
	if (core.pending.size > 0) {
		// There are entries still waiting
		if (core.timerId && nextExpire < core.nextTimeout) core.cancelNext();

		// Now schedule for the closest expiry
		if (!core.timerId) core.setTimer(sweep, nextExpire - now, core);
	} else if (core.timerId) {
		// No pending entries; no timeout needed.
		core.cancelNext();
	}

	// Dispatch timed out messages
	for (let i = 0; i < replyTo.length; i += 1) {
		const item = replyTo[i];
		// Just start it, no need to wait around
		item.send(core.makeTimedout(item));
	}
}

class WelcomeYard<Tid> {
	readonly add: <T>(item: Pending<T>) => void;
	readonly take: (id: string) => Pending<unknown> | undefined;

	constructor(link: Link<Tid>) {
		const core: Core<Tid> = {
			pending: new Map<string, Pending<unknown>>(),
			makeTimedout: link.makeTimedout,
			nextTimeout: 0,
			timerId: undefined,
			clearTimer: link.clearTimer,
			setTimer: link.setTimer,
			timeMs: link.timeMs,
			cancelNext: () => {
				if (!core.timerId) return;
				core.clearTimer(core.timerId);
				core.timerId = undefined;
				core.nextTimeout = 0;
			},
		};

		this.add = (item) => {
			core.pending.set(item.id, item);
			sweep(core);
		};

		this.take = (id) => {
			const item = core.pending.get(id);
			if (!item) return undefined;

			core.pending.delete(id);
			return item;
		};
	}
}

export { WelcomeYard };
