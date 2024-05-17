import { Operation, applyPatch } from 'fast-json-patch/module/core';
import { getBytes } from './parse';

export const EventStreamContentType = 'text/event-stream';
const DefaultRetries = 2;
const DefaultRetryInterval = 1000;

export enum EventSourceEvent {
    OPEN = 'onOpen', // maps to onStart in langserve
    MESSAGE = 'onMessage', // maps to onChunk in langserve
    CLOSE = 'onClose', // maps to onSuccess in langserve
    ERROR = 'onError', // maps to onError in langserve
};
export type EventSourceResponse = {
    event: EventSourceEvent;
    data?: Operation[];
    aggregatedState?: RunState;
    error?: Error;
}

export interface LogEntry {
    // ID of the sub-run.
    id: string;
    // Name of the object being run.
    name: string;
    // Type of the object being run, eg. prompt, chain, llm, etc.
    type: string;
    // List of tags for the run.
    tags: string[];
    // Key-value pairs of metadata for the run.
    metadata: { [key: string]: unknown };
    // ISO-8601 timestamp of when the run started.
    start_time: string;
    // List of LLM tokens streamed by this run, if applicable.
    streamed_output_str: string[];
    // Final output of this run.
    // Only available after the run has finished successfully.
    final_output?: unknown;
    // ISO-8601 timestamp of when the run ended.
    // Only available after the run has finished.
    end_time?: string;
}

export interface RunState {
    // ID of the run.
    id: string;
    // List of output chunks streamed by Runnable.stream()
    streamed_output: unknown[];
    // Final output of the run, usually the result of aggregating (`+`) streamed_output.
    // Only available after the run has finished successfully.
    final_output?: unknown;

    // Map of run names to sub-runs. If filters were supplied, this list will
    // contain only the runs that matched the filters.
    logs: { [name: string]: LogEntry };
}


export interface FetchEventSourceInit extends RequestInit {
    /**
     * The request headers. FetchEventSource only supports the Record<string,string> format.
     */
    headers?: Record<string, string>,

    /** The Fetch function to use. Defaults to window.fetch */
    fetch?: typeof fetch;
}

export async function* fetchEventSource(input: RequestInfo, {
    signal: inputSignal,
    headers: inputHeaders,
    ...rest
}: FetchEventSourceInit) {
    // make a copy of the input headers since we may modify it below:
    const headers = { ...inputHeaders };
    if (!headers.accept) {
        headers.accept = EventStreamContentType;
    }

    function reducer(state: RunState | null, action: Operation[]) {
        return applyPatch(state, action, true, false).newDocument;
    }

    async function* retryWithDelay(generatorFunc: any, maxRetries = 1, delayMs = DefaultRetryInterval) {
        let retryCount = 0;

        while (retryCount <= maxRetries) {
            try {
                if (inputSignal?.aborted) {
                    yield { event: EventSourceEvent.CLOSE } as EventSourceResponse;
                    return;
                }

                for await (const data of generatorFunc()) {
                    yield data;
                }
                break; // If everything went fine, exit loop
            } catch (error) {
                if (retryCount === maxRetries) throw error; // Rethrow error after max retries
                await new Promise(resolve => setTimeout(resolve, delayMs));
                retryCount++;
            }
        }
    }

    async function* create() {
        let innerLatest: RunState | null = null;

        const response = await fetch(input, {
            ...rest,
            headers,
            signal: inputSignal,
        });

        yield { event: EventSourceEvent.OPEN } as EventSourceResponse;

        for await (const msg of getBytes(response.body!)) {

            // NOTE: You can throw an error here to test retrying, note though that yield MESSAGE with empty content can still be
            // emitted during the retry process so handle that accordingly in the consumer.

            try {
                if (msg.event === 'data') {
                    innerLatest = reducer(innerLatest, JSON.parse(msg.data)?.ops);
                    yield { event: EventSourceEvent.MESSAGE, aggregatedState: innerLatest } as EventSourceResponse;
                }
            } catch (e) {
                yield { event: EventSourceEvent.ERROR, error: e } as EventSourceResponse;
            }
        }

        yield { event: EventSourceEvent.CLOSE } as EventSourceResponse;
    }

    try {
        for await (const data of retryWithDelay(create, DefaultRetries, DefaultRetryInterval)) {
            yield data as EventSourceResponse;
        }
    } catch (err) {
        yield { event: EventSourceEvent.ERROR, error: err } as EventSourceResponse;
    }
}
