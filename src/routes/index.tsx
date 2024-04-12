// file: src/routes/index.tsx
import { onCleanup, createEffect } from 'solid-js';
import { useSubmission } from '@solidjs/router';
import { sendMessage } from '../api';
import { disposeMessages, useMessages } from '../components/message-context';

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
	const messages = useMessages();
	console.log(messages);
	onCleanup(disposeMessages);

	const isSending = useSubmission(sendMessage);
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
				<h1>Client: ???</h1>
				<form
					action={sendMessage}
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
				<ul role="list"></ul>
			</main>
		</>
	);
}
