// @refresh reload
import { Suspense } from 'solid-js';
import {
	// A,
	Body,
	ErrorBoundary,
	FileRoutes,
	Head,
	Html,
	Meta,
	Routes,
	Scripts,
	Title,
} from 'solid-start';

import { MessageProvider } from '~/components/message-context';

export default function Root() {
	return (
		<Html lang="en">
			<Head>
				<Title>SolidStart - SSE Chat</Title>
				<Meta charset="utf-8" />
				<Meta name="viewport" content="width=device-width, initial-scale=1" />
				<link href="styles.css" rel="stylesheet" />
			</Head>
			<Body>
				<Suspense>
					<ErrorBoundary>
						<MessageProvider>
							<Routes>
								<FileRoutes />
							</Routes>
						</MessageProvider>
					</ErrorBoundary>
				</Suspense>
				<Scripts />
			</Body>
		</Html>
	);
}
