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
npm i -s @engineersamuel/fetch-event-source-stream
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

## Differences with Azure/fetch-event-source

[Azure/fetch-event-source](https://github.com/Azure/fetch-event-source) is callback based, which works well, but the code required to set that up with React is very tedious and verbose, see [useStreamCallback](https://github.com/langchain-ai/langserve/blob/main/langserve/chat_playground/src/useStreamCallback.tsx).

Using generator functions dramatically simplify the boilerplate code here. You'll need to see the full code to appreciate the difference however here are two snippets, one showing how to accomplish this in React and another in Qwik with generator functions.

### React with Callbacks

```ts
// Note the above reference to useStreamCallback which is required here

useStreamCallback("onStart", () => {
  setMessages((prevMessages) => [...prevMessages, { type: "ai", content: "" }]);
});
useStreamCallback("onChunk", (_chunk, aggregatedState) => {
  const finalOutput = aggregatedState?.final_output;
  if (typeof finalOutput === "string") {
    setMessages((prevMessages) => [
      ...prevMessages.slice(0, -1),
      { type: "ai", content: finalOutput, runId: aggregatedState?.id },
    ]);
  } else if (isAIMessage(finalOutput)) {
    setMessages((prevMessages) => [
      ...prevMessages.slice(0, -1),
      { type: "ai", content: finalOutput.content, runId: aggregatedState?.id },
    ]);
  }
});
useStreamCallback("onSuccess", () => {
  setIsLoading(false);
});
useStreamCallback("onError", (e) => {
  setIsLoading(false);
  toast(e.message + "\nCheck your backend logs for errors.", {
    hideProgressBar: true,
  });
  setCurrentInputValue(messages[messages.length - 2]?.content);
  setMessages((prevMessages) => [...prevMessages.slice(0, -2)]);
});

// ...

const startStream = useCallback(async (input: unknown, config: unknown) => {
  const controller = new AbortController();
  setController(controller);
  startRef.current?.({ input });

  let innerLatest: RunState | null = null;

  await fetchEventSource(resolveApiUrl("/stream_log").toString(), {
    signal: controller.signal,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, config }),
    onmessage(msg) {
      if (msg.event === "data") {
        innerLatest = reducer(innerLatest, JSON.parse(msg.data)?.ops);
        setLatest(innerLatest);
        chunkRef.current?.(JSON.parse(msg.data), innerLatest);
      }
    },
    openWhenHidden: true,
    onclose() {
      setController(null);
      successRef.current?.({ input, output: innerLatest?.final_output });
    },
    onerror(error) {
      setController(null);
      errorRef.current?.(error);
      throw error;
    },
  });
}, []);
```

### Qwik with generator functions

```ts
const sendPayload = server$(async function* (input: unknown, config: unknown) {
  const self = this as unknown as RequestEventBase;
  for await (const s of fetchEventSource("/stream_log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, config }),
    signal: self.signal,
  })) {
    yield s;
  }
});

// ...

const initiateStream = $(async (input: unknown, config: unknown) => {
  const response = await sendPayload(input, config);
  for await (const r of response) {
    switch (r.event) {
      case EventSourceEvent.OPEN:
        messages.value = [...messages.value, { type: "ai", content: "" }];
        break;
      case EventSourceEvent.MESSAGE:
        const finalOutput = r.aggregatedState?.final_output;
        const lookbackIdx = [null, ""].includes(
          messages.value[messages.value.length - 2]?.content,
        )
          ? -2
          : -1;
        if (typeof finalOutput === "string") {
          messages.value = [
            ...messages.value.slice(0, lookbackIdx),
            { type: "ai", content: finalOutput, runId: r.aggregatedState?.id },
          ];
        } else if (isAIMessage(finalOutput)) {
          messages.value = [
            ...messages.value.slice(0, lookbackIdx),
            {
              type: "ai",
              content: finalOutput.content,
              runId: r.aggregatedState?.id,
            },
          ];
        }
        break;
      case EventSourceEvent.CLOSE:
        isLoading.value = false;
        break;
      case EventSourceEvent.ERROR:
        isLoading.value = false;
        toast.error(`${r.error?.message}\nCheck your backend logs for errors.`);
        console.error(
          messages.value[messages.value.length - 2]?.content,
          r.error,
        );
        currentInputValue.value =
          messages.value[messages.value.length - 2]?.content;
        messages.value = [...messages.value.slice(0, -2)];
    }
  }
});
```

# Known issues

- Unlike the upstream fork, this version does not currently use the [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
