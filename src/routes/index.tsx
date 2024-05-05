// file: src/routes/index.tsx
import { createEffect, For, onCleanup } from 'solid-js';
import { createAsync, createAsyncStore, useSubmission } from '@solidjs/router';
import { formatUTCTimeOnly } from '~/lib/shame';
import { broadcast } from '../api';
import { disposeHistory, useHistory } from '../components/history-context';

const MESSAGE_ERROR =
	'At least one non-whitespace character is required to send';

function onMessageInvalid(event: Event) {
	if (!(event.target instanceof HTMLInputElement)) return;

	event.target.setCustomValidity(MESSAGE_ERROR);
	event.stopPropagation();
}

function onMessageInput(event: Event) {
	if (!(event.target instanceof HTMLInputElement)) return;

	event.target.setCustomValidity('');
	event.stopPropagation();
}

export default function Home() {
	const history = useHistory();
	const clientId = createAsync(history.clientId, { deferStream: true });
	const messages = createAsyncStore(history.messages, {
		deferStream: true,
		initialValue: [],
		reconcile: { key: 'timestamp', merge: true },
	});
	onCleanup(disposeHistory);

	const isSending = useSubmission(broadcast);
	createEffect(() => {
		if (isSending.result !== false) return;

		console.error('sendMessage failed!');
	});

	let formRef: HTMLFormElement | undefined;
	const clearFormTask = () => formRef?.reset();
	const clearAfterSubmit = (event: SubmitEvent) => {
		if (event.currentTarget !== formRef) return;

		requestAnimationFrame(clearFormTask);
	};

	return (
		<>
			<header>
				Visit{' '}
				<a href="https://start.solidjs.com" target="_blank">
					start.solidjs.com
				</a>{' '}
				to learn how to build SolidStart apps.
			</header>
			<main class="messages">
				<h1>Client: {clientId() ?? '???'}</h1>
				<form
					action={broadcast}
					method="post"
					ref={formRef}
					onSubmit={clearAfterSubmit}
				>
					<label>
						Message:
						<input
							type="text"
							name="message"
							required
							pattern="^.*\S.*$"
							onInvalid={onMessageInvalid}
							onInput={onMessageInput}
							title={MESSAGE_ERROR}
						/>
					</label>
					<button type="submit" disabled={isSending.pending}>
						Send
					</button>
				</form>
				<ul role="list">
					<For each={messages()}>
						{({ timestamp, from, body }) => {
							const chatTime = formatUTCTimeOnly(timestamp);
							return (
								<li>
									<time datetime={chatTime}>{chatTime}</time>
									<span class="message__from">{from}</span>
									{body}
								</li>
							);
						}}
					</For>
				</ul>
			</main>
		</>
	);
}
