// file: src/components/history-context/deadman-timer.ts

export type ActionId = ReturnType<typeof setTimeout>;

type Core = {
	actionId: ActionId | undefined;
	lastTime: number;
	actionMs: number;
	action: () => void;
	timeMs: () => number;
	schedule: (fn: (core: Core) => void, delayMs: number, core: Core) => ActionId;
	clearTimer: (id: ActionId) => void;
};

// This function **will** run
// The difference is whether or not `start` was called
// recently enough. If it was the function simply reschedules itself
// Otherwise it invokes the action and stops
//
function keepAlive(core: Core) {
	const delay = core.actionMs - (core.timeMs() - core.lastTime);
	console.log('countdown', delay);
	if (delay > 0) {
		core.actionId = core.schedule(keepAlive, delay, core);
		return;
	}

	core.actionId = undefined;
	core.action();
}

export type Link = Pick<
	Core,
	'actionMs' | 'action' | 'timeMs' | 'schedule' | 'clearTimer'
>;

class DeadmanTimer {
	// Implemented as properties rather than methods
	// so we can pass around the functions without
	// giving access to the whole object
	readonly start: () => void;
	readonly stop: () => void;

	constructor(link: Link) {
		const core: Core = {
			actionId: undefined,
			lastTime: 0,
			actionMs: link.actionMs,
			action: link.action,
			timeMs: link.timeMs,
			schedule: link.schedule,
			clearTimer: link.clearTimer,
		};

		this.start = () => {
			core.lastTime = core.timeMs();

			// Just let keepAlive run
			if (core.actionId) return;

			core.actionId = core.schedule(keepAlive, core.actionMs, core);
		};

		this.stop = () => {
			if (!core.actionId) return;

			core.clearTimer(core.actionId);
			core.actionId = undefined;
		};
	}
}

export { DeadmanTimer };
