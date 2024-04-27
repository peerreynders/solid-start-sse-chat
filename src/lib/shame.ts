// file src/lib/shame.ts
//
// `shame` as in ashamed for not thinking
// of a better name (or place) than "utils" or "helpers".
// credit: https://csswizardry.com/2013/04/shame-css/

// https://tc39.es/ecma262/#sec-time-values-and-time-range
const MAX_TIMEVALUE = 8.64e15;
const MIN_TIMEVALUE = -MAX_TIMEVALUE;

const isTimeValue = (value: unknown): value is number =>
	typeof value === 'number' &&
	Number.isInteger(value) &&
	MIN_TIMEVALUE <= value &&
	value <= MAX_TIMEVALUE;

const utcTimeOnly = new Intl.DateTimeFormat([], {
	timeZone: 'UTC',
	hour12: false,
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
	fractionalSecondDigits: 3,
});
const formatUTCTimeOnly = utcTimeOnly.format;

const msSinceStart = () => Math.trunc(performance.now());

const epochTimestamp = Date.now;

export {
	epochTimestamp,
	formatUTCTimeOnly,
	isTimeValue,
	MIN_TIMEVALUE,
	msSinceStart,
};
