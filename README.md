# Fetch Event Source Stream

This library is forked from [Azure/fetch-event-source](https://github.com/Azure/fetch-event-source) which is the library used by [Langserve Chat Playground](https://github.com/langchain-ai/langserve/tree/main/langserve/chat_playground).

The reason for the fork was to transform the library into using generator functions instead of callbacks. Generator functions are much more compact and readable then 2-3 levels deep of function callbacks and lend themselves well to Server Side Rendered apps that can leverage them.

The Api encapsulates [Event Source requests](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) - also known as server-sent events - with all the features available in the [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API).

The [default browser EventSource API](https://developer.mozilla.org/en-US/docs/Web/API/EventSource) imposes several restrictions on the type of request you're allowed to make: the [only parameters](https://developer.mozilla.org/en-US/docs/Web/API/EventSource/EventSource#Parameters) you're allowed to pass in are the `url` and `withCredentials`, so:

- You cannot pass in a request body: you have to encode all the information necessary to execute the request inside the URL, which is [limited to 2000 characters](https://stackoverflow.com/questions/417142) in most browsers.
- You cannot pass in custom request headers
- You can only make GET requests - there is no way to specify another method.
- If the connection is cut, you don't have any control over the retry strategy: the browser will silently retry for you a few times and then stop, which is not good enough for any sort of robust application.

This library provides an alternate interface for consuming server-sent events, based on the Fetch API. It is fully compatible with the [Event Stream format](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format), so if you already have a server emitting these events, you can consume it just like before. However, you now have greater control over the request and response so:

- You can use any request method/headers/body, plus all the other functionality exposed by fetch(). You can even provide an alternate fetch() implementation, if the default browser implementation doesn't work for you.
- You have access to the response object if you want to do some custom validation/processing before parsing the event source. This is useful in case you have API gateways (like nginx) in front of your application server: if the gateway returns an error, you might want to handle it correctly.
- If the connection gets cut or an error occurs, you have full control over the retry strategy.

# Install

```sh
npm i engineersamuel/fetch-event-source-stream
```

# Usage

```ts
// BEFORE:
const sse = new EventSource("/api/sse");
sse.onmessage = (ev) => {
  console.log(ev.data);
};

// AFTER:
import { fetchEventSource } from "engineersamuel/fetch-event-source-stream";

for await (const s of fetchEventSource("/api/stream_log")) {
  yield s; // EventSourceResponse
}
```

You can pass in all the [other parameters](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch#Parameters) exposed by the default fetch API, for example:

```ts
import { fetchEventSource } from "engineersamuel/fetch-event-source-stream";

const ctrl = new AbortController();
for await (const s of fetchEventSource("/api/stream_log", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    foo: "bar",
  }),
  signal: ctrl.signal,
})) {
  yield s; // EventSourceResponse
}
```

# Known issues

- Unlike the upstreak fork, this version does not currently use the [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
