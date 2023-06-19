import { suite } from 'uvub';
import * as assert from 'uvub/assert';

import { Longpoller, type Link } from '../../src/server/longpoller';

const suiteRuns: (() => void)[] = [];

const longpoll = suite('Longpoll');

function makeClient(clientId: string | undefined) {
	const client: {
		id: string | undefined;
		data: string | undefined;
		headers: Record<string,string> | undefined;
		close: (data: string, headers?: Record<string,string>) => void;
	} = {
		id: clientId,
		data: undefined,
		headers: undefined,
		close: (data: string, headers?: Record<string,string>) => {
			client.data = data;
			client.headers = headers;
		}
	};

	return client;
}

function makeLinkHolder(time = 0) {
	const holder: {
		nextClientId: number;
		nextTimerId: number;
		timerId: number;
		nextTime: number;
		fn: Function | undefined;
		arg: any | undefined;
		time: number;
		runTask: () => void,
		link: Link<ReturnType<typeof setTimeout>>;
	} = {
		nextClientId: 9999999,
		nextTimerId: 9999999,
		timerId: 0,
		nextTime: 0,
		fn:  undefined,
		arg: undefined,
		time,
		runTask: () => {
			if (!holder.fn) 
				throw new assert.Assertion({ message: "No task to run" });

			const fn = holder.fn;
			const arg = holder.arg;

			holder.timerId = 0;
      holder.nextTime = 0;
			holder.fn = undefined;
			holder.arg = undefined;

			fn(arg);
		},
		link: {
			respondChat: (
		    close: (data: string, headers?: Record<string,string>) => void,
				lastTime: number
			) => close(`chat,${lastTime}`),
			respondKeepAlive: (
		    close: (data: string, headers?: Record<string,string>) => void,
			) => close(`keep-alive,${holder.time}`),
			respondWelcome: (
		    close: (data: string, headers?: Record<string,string>) => void,
				clientId: string | undefined
			) => {
				if (clientId) {
					close(`welcome,${clientId},${holder.time}`);
					return;
				}
				const id = holder.nextClientId--;
				close(`welcome,${id},${holder.time}`, { 'set-cookie': String(id) });
				return;
			},
			minMs: 2000,
			maxMs: 15000,
			timeMs: () => holder.time,
			clearTimer: (id: number) => {
				if (id !== holder.timerId) 
					throw new assert.Assertion({ message: "Cleared timerId doesn't match" });
				
				holder.timerId = 0;
        holder.nextTime = 0;
				holder.fn = undefined;
				holder.arg = undefined;
			},
			setTimer: (fn: Function, delay: number, arg: any) => {
				const id = holder.nextTimerId--;

				if (holder.timerId) 
					throw new assert.Assertion({ message: "timerId already taken" });

				holder.timerId = id;
				holder.nextTime = holder.time + delay;
				holder.fn = fn;
				holder.arg = arg;

				return id;
			}
		}
	}
	return holder;
}

// --- TESTS ---

longpoll('Immediate Welcome message and client Id header', () => {
	// Given
	const lastTime = 0; // This triggers the "welcome"
	const holder = makeLinkHolder(1000);
	const poller = new Longpoller(holder.link);
	const client = makeClient(undefined); // This triggers additional header

	poller.add(client.close, client.id, lastTime);

	// Then
	assert.is(client.data, 'welcome,9999999,1000', 'Welcome message was not dispatched');
	assert.equal(client.headers, { 'set-cookie': '9999999' }, 'Missing client header');

	// No further sweep scheduled
	assert.ok(holder.nextTime === 0 && holder.timerId === 0, 'Unexpected timer scheduled');
	assert.type(holder.fn,'undefined', 'sweep function unexpectedly scheduled');
	assert.type(holder.arg, 'undefined', 'unexpected sweep core argument');
});

longpoll('Immediate Welcome message with client ID', () => {
	// Given
	const lastTime = 0; // This triggers the "welcome"
	const holder = makeLinkHolder(1000);
	const poller = new Longpoller(holder.link);
	const client = makeClient('AAAAAAA'); // This supresses the additional headers

	poller.add(client.close, client.id, lastTime);

	// Then
	assert.is(client.data, 'welcome,AAAAAAA,1000', 'Welcome message was not dispatched');
	assert.type(client.headers, 'undefined', 'unexpected client headers');

	// No further sweep scheduled
	assert.ok(holder.nextTime === 0 && holder.timerId === 0, 'Unexpected timer scheduled');
	assert.type(holder.fn,'undefined', 'sweep function unexpectedly scheduled');
	assert.type(holder.arg, 'undefined', 'unexpected sweep core argument');
});

longpoll('send keep alive after maxMs', () => {
	// Given
	const lastTime = 1_800_000_000_000;
	const holder = makeLinkHolder(1000);
	const poller = new Longpoller(holder.link);
	const client = makeClient('AAAAAAA');

	poller.add(client.close, client.id, lastTime);

	assert.type(holder.fn,'function', 'sweep function not scheduled');
	assert.type(holder.arg, 'object', 'missing core argument');
	assert.is(holder.nextTime, 16000, 'not scheduled with maxMs');

	// When
	holder.time += 15000 + 5;
	holder.runTask();

	// Then
	assert.is(client.data, 'keep-alive,16005', 'keep alive message was not dispatched');
	assert.type(client.headers, 'undefined', 'unexpected client headers');

	// No further sweep scheduled
	assert.ok(holder.nextTime === 0 && holder.timerId === 0, 'Unexpected timer scheduled');
});

longpoll('send existing message after minMs', () => {
	// Given
	const lastTime = 1_800_000_000_000;
	const holder = makeLinkHolder(1000);
	const poller = new Longpoller(holder.link);
	const client = makeClient('AAAAAAA');

	poller.add(client.close, client.id, lastTime, 1);

	assert.type(holder.fn,'function', 'sweep function not scheduled');
	assert.type(holder.arg, 'object', 'missing core argument');
	assert.is(holder.nextTime, 3000, 'not scheduled with minMs');

	// When
	holder.time += 2000 + 5;
	holder.runTask();
	
  // Then
	assert.is(client.data, 'chat,1800000000000', 'chat message was not dispatched');
	assert.type(client.headers, 'undefined', 'unexpected client headers');
	
	// No further sweep scheduled
	assert.ok(holder.nextTime === 0 && holder.timerId === 0, 'Unexpected timer scheduled');
});

longpoll('send recent message after minMs', () => {
	// Given
	const lastTime = 1_800_000_000_000;
	const holder = makeLinkHolder(1000);
	const poller = new Longpoller(holder.link);
	const client = makeClient('AAAAAAA');

	poller.add(client.close, client.id, lastTime, 0);

	assert.type(holder.fn,'function', 'sweep function not scheduled');
	assert.type(holder.arg, 'object', 'missing core argument');
	assert.is(holder.nextTime, 16000, 'not scheduled with minMs');

	holder.time += 1000;
	poller.markMessage();
	assert.is(holder.nextTime, 3000, 'not scheduled with minMs');

	// When
	holder.time += 1000 + 5;
	holder.runTask();
	
  // Then
	assert.is(client.data, 'chat,1800000000000', 'chat message was not dispatched');
	assert.type(client.headers, 'undefined', 'unexpected client headers');

	// No further sweep scheduled
	assert.ok(holder.nextTime === 0 && holder.timerId === 0, 'Unexpected timer scheduled');
});

longpoll('After minMs send message immediately', () => {
	// Given
	const lastTime = 1_800_000_000_000;
	const holder = makeLinkHolder(1000);
	const poller = new Longpoller(holder.link);
	const client = makeClient('AAAAAAA');

	poller.add(client.close, client.id, lastTime, 0);

	assert.type(holder.fn,'function', 'sweep function not scheduled');
	assert.type(holder.arg, 'object', 'missing core argument');
	assert.is(holder.nextTime, 16000, 'not scheduled with minMs');

	holder.time += 3000;
	poller.markMessage();

  // Then
	assert.is(client.data, 'chat,1800000000000', 'chat message was not dispatched');
	assert.type(client.headers, 'undefined', 'unexpected client headers');

	// No further sweep scheduled
	assert.ok(holder.nextTime === 0 && holder.timerId === 0, 'Unexpected timer scheduled');
});

longpoll('send existing message after minMs each (2 clients)', () => {
	// Given
	const lastTime = 1_800_000_001_000;
	const messages = 1;
	const holder = makeLinkHolder(1000);
	const poller = new Longpoller(holder.link);
	const clientA = makeClient('AAAAAAA');
	const clientB = makeClient('BBBBBBB');

	poller.add(clientA.close, clientA.id, lastTime, messages);

	assert.type(holder.fn,'function', 'sweep function not scheduled');
	assert.type(holder.arg, 'object', 'missing core argument');
	assert.is(holder.nextTime, 3000, 'not scheduled with minMs');

	holder.time += 1000;
	poller.add(clientB.close, clientB.id, lastTime + 1000, messages);

	assert.is(holder.nextTime, 3000, 'not scheduled with minMs');

	// When
	holder.time += 1000 + 5;
	holder.runTask();

	assert.is(clientA.data, 'chat,1800000001000', 'chat A message was not dispatched');
	assert.type(clientB.data, 'undefined', 'chat B dispatched too early');
	assert.is(holder.nextTime, 4000, 'client B not scheduled with minMs');

	holder.time += 1000;
	holder.runTask();
	
	assert.is(clientB.data, 'chat,1800000002000', 'chat B message was not dispatched');

	// No further sweep scheduled
	assert.ok(holder.nextTime === 0 && holder.timerId === 0, 'Unexpected timer scheduled');
});

longpoll('send recent message after minMs each (2 clients)', () => {
	// Given
	const lastTime = 1_800_000_001_000;
	const messages = 0;
	const holder = makeLinkHolder(1000);
	const poller = new Longpoller(holder.link);
	const clientA = makeClient('AAAAAAA');
	const clientB = makeClient('BBBBBBB');

	poller.add(clientA.close, clientA.id, lastTime, messages);

	assert.type(holder.fn,'function', 'sweep function not scheduled');
	assert.type(holder.arg, 'object', 'missing core argument');
	assert.is(holder.nextTime, 16000, 'not scheduled with maxMs');

	holder.time += 1000;
	poller.add(clientB.close, clientB.id, lastTime + 1000, messages);

	assert.is(holder.nextTime, 16000, 'not scheduled with maxMs');

	holder.time += 100;
	poller.markMessage();
	assert.is(holder.nextTime, 3000, 'not scheduled with minMs');

	// When
	holder.time += 900 + 5;
	holder.runTask();

	assert.is(clientA.data, 'chat,1800000001000', 'chat A message was not dispatched');
	assert.type(clientB.data, 'undefined', 'chat B dispatched too early');
	assert.is(holder.nextTime, 4000, 'client B not scheduled with minMs');

	holder.time += 1000;
	holder.runTask();
	
	assert.is(clientB.data, 'chat,1800000002000', 'chat B message was not dispatched');

	// No further sweep scheduled
	assert.ok(holder.nextTime === 0 && holder.timerId === 0, 'Unexpected timer scheduled');
});

longpoll('send keep alive after maxMs each (2 clients)', () => {
	// Given
	const lastTime = 1_800_000_001_000;
	const messages = 0;
	const holder = makeLinkHolder(1000);
	const poller = new Longpoller(holder.link);
	const clientA = makeClient('AAAAAAA');
	const clientB = makeClient('BBBBBBB');

	poller.add(clientA.close, clientA.id, lastTime, messages);

	assert.type(holder.fn,'function', 'sweep function not scheduled');
	assert.type(holder.arg, 'object', 'missing core argument');
	assert.is(holder.nextTime, 16000, 'not scheduled with maxMs');

	holder.time += 8000;
	poller.add(clientB.close, clientB.id, lastTime + 1000, messages);

	assert.is(holder.nextTime, 16000, 'not scheduled with maxMs');


	// When
	holder.time += 7000 + 5;
	holder.runTask();

	assert.is(clientA.data, 'keep-alive,16005', 'chat A message was not dispatched');
	assert.type(clientB.data, 'undefined', 'chat B dispatched too early');
	assert.is(holder.nextTime, 24000, 'client B not scheduled with maxMs');

	holder.time += 8000;
	holder.runTask();
	
	assert.is(clientB.data, 'keep-alive,24005', 'chat B message was not dispatched');

	// No further sweep scheduled
	assert.ok(holder.nextTime === 0 && holder.timerId === 0, 'Unexpected timer scheduled');
});

// --- TESTS END ---

suiteRuns.push(longpoll.run);

function all() {
	return suiteRuns.slice();
}

export {
	all
};
