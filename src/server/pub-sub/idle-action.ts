// file: src/server/pub-sub/idle-action.ts

export type Link<T> = {
	maxIdleMs: number;
	timeMs: () => number;
	setTimer: (cb: () => void, delay: number) => T;
	clearTimer: (id: T) => void;
	idleAction: () => void;
};

const keepAlive = Symbol('keepAlive');

class IdleAction<T> {
	link: Link<T>;
	lastTime: number;
	timer: T | undefined;

	constructor(link: Link<T>) {
		this.link = link;
		this.lastTime = link.timeMs();
	}

	// Only used by setTimeout
	// so there should be no active timer
	// that needs to be canceled
	[keepAlive] = () => {
		const { idleAction, maxIdleMs, timeMs, setTimer } = this.link;
		const remain = maxIdleMs - (timeMs() - this.lastTime);
		const delay = remain > 0 ? remain : maxIdleMs;
		this.timer = setTimer(this[keepAlive], delay);
		if (delay < maxIdleMs) return;

		idleAction();
	};

	// Just note last action time.
	// When the next time expires `keepAlive` will
	// take the correct action. Saves having to cancel
	// the timer and registering a new one.
	markAction() {
		this.lastTime = this.link.timeMs();
	}

	stop() {
		if (!this.timer) return;

		this.link.clearTimer(this.timer);
		this.timer = undefined;
	}

	start() {
		if (this.timer) return;

		const { maxIdleMs, setTimer } = this.link;
		this.timer = setTimer(this[keepAlive], maxIdleMs);
	}
}

export { IdleAction };
