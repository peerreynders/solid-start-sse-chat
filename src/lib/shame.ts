// file src/lib/shame.ts

// https://tc39.es/ecma262/#sec-time-values-and-time-range
const MAX_TIMEVALUE = 8.64e15;
const MIN_TIMEVALUE = -MAX_TIMEVALUE;

const isTimeValue = (value: unknown): value is number =>
	typeof value === 'number' &&
	Number.isInteger(value) &&
	MIN_TIMEVALUE <= value &&
	value <= MAX_TIMEVALUE;

export { isTimeValue };
