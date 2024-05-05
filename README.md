# SolidStart SSE Chat

**Updated** for [SolidStart v1.0.0-rc.0](https://github.com/solidjs/solid-start/releases/tag/v1.0.0-rc.0) 

Basic Chat demonstration with [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) (SSE) for server to client communication. 

If HTTP/1.1 compatibility is desired a client application shouldn't use more that one SSE connection as there is a limit of 6 connections per domain on a browser (the limit is significantly higher with HTTP/2). Typically SSE is less resource intensive compared to [WebSockets](https://datatracker.ietf.org/doc/html/rfc6455) (which aren't part of the HTTP spec either). 

With HTTP/3 both will likely be replaced with [WebTransport](https://www.w3.org/TR/webtransport/) ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API), [web.dev](https://developer.chrome.com/articles/webtransport/)).

For [EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)s the [HTML Living Standard](https://html.spec.whatwg.org/multipage/server-sent-events.html#authoring-notes) recommends:

> Clients that support HTTP's per-server connection limitation might run into trouble **when opening multiple pages from a site if each page has an `EventSource` to the same domain**. Authors can avoid this using the relatively complex mechanism of using unique domain names per connection, or by allowing the user to enable or disable the `EventSource` functionality on a per-page basis, or by sharing a single `EventSource` object using a [shared worker](https://html.spec.whatwg.org/multipage/workers.html#sharedworkerglobalscope). 

From that perspective it's likely a mistake to create an `EventSource` inside an ordinary component as it may be construed from [the remix-utils `useEventSource()` example](https://github.com/remix-run/examples/blob/c59ee8eb2b06002b22d53e91df48a0b77b49091c/sse-counter/app/root.tsx) (the example *does* actually only use it in the top-level `App` component though that detail is easily missed.).

Here the `EventSource` is centrally handled in [`history-context`](./src/components/history-context/index.tsx) where the messages are staged and expose via [`cache`](https://docs.solidjs.com/solid-router/reference/data-apis/cache) async access points which are made accessible via a [context](https://docs.solidjs.com/reference/component-apis/create-context) to the rest of the application. A [component](./src/routes/index.tsx) can then use [`createAsync`](https://docs.solidjs.com/solid-router/reference/data-apis/create-async) (or in this case `createAsyncStore`) to get reactive access to the messages.

Ideally in a larger application with multiple server-to-client information streams, the streams should be multiplexed onto a single SSE connection and demultiplexed client-side into the appropriate parts of client state.

```shell
cd solid-start-sse-chat

pnpm install

    Lockfile is up to date, resolution step is skipped
    Packages: +572
    +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    Progress: resolved 572, reused 572, downloaded 0, added 572, done

    dependencies:
    + @solidjs/meta 0.29.3
    + @solidjs/router 0.13.2
    + @solidjs/start 1.0.0-rc.0
    + nanoid 5.0.7
    + solid-js 1.8.17
    + vinxi 0.3.11

    devDependencies:
    + @typescript-eslint/eslint-plugin 7.8.0
    + @typescript-eslint/parser 7.8.0
    + eslint 8.57.0
    + eslint-config-prettier 9.1.0
    + prettier 3.2.5
    + typescript 5.4.5

    Done in 1.7s

cp .env.example .env

pnpm run dev

    > solid-start-sse-chat@0.0.0 dev
    > vinxi dev

    vinxi v0.3.11
    vinxi starting dev server

        ➜ Local:    http://localhost:3000/
        ➜ Network:  use --host to expose
```

---

## Notes

- To force the application to use the [long polling](https://javascript.info/long-polling#long-polling) fallback [instead of SSE](./src/components/history-context/index.tsx):

```TypeScript
// file: src/components/history-context/index.tsx
// …

// To start with long polling, set to: connectStatus.LONGPOLL;
let status: ConnectStatus = connectStatus.IDLE;

// …
```

- The messages streamed **to the browser** are handled via the [`/api/messages`](./src/routes/api/messages.ts) API route. Messages sent **to the server** are handled with the [`broadcast`](./src/api.ts) [server](https://docs.solidjs.com/solid-start/reference/server/use-server) [action](https://docs.solidjs.com/solid-router/reference/data-apis/action). Server functions and route handling seem to operate in isolated memory spaces on the server. This lead to [`BroadcastChannel`](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API) being used for communication between the [`pub`](./src/server/pub/index.ts)lish and [`sub`](./src/server/sub/index.ts)scription portion of the server logic. 

- Concurrent (SSR) requests share the same memory space and thereby JS modules and their globals. This made it necessary to isolate the context values used during SSR in [`app-store`](./src/app-store.ts). 
