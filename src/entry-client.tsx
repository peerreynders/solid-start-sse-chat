// @refresh reload
// src/entry-client.tsx
import { mount, StartClient } from '@solidjs/start/client';

mount(() => <StartClient />, document.getElementById('app')!);
