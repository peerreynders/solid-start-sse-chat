// file: src/components/message-context/keep-alive.ts

type TimerId = ReturnType<typeof setTimeout>;

type Core = {
	actionId: TimerId | undefined;
	lastTime: number;
	actionMs: number;
	action: () => void;
	timeMs: () => number;
	schedule: (fn: (core: Core) => void, delayMs: number, core: Core) => TimerId;
	clearTimer: (id: TimerId) => void;
};

function keepAlive(core: Core) {
	const delay = core.actionMs - (core.timeMs() - core.lastTime);
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

class KeepAlive {
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

export { KeepAlive };
