import * as parse from './parse';

import { describe, it, expect } from 'vitest';

export function wait(ms = 0) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('parse', () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    describe('getLines', () => {
        it('single line', async () => {
            let lineNum = 0;
            const content = 'id: abc\n';

            const next = parse.getLines();
            for await (const output of next(encoder.encode(content))) {
                ++lineNum;
                expect(decoder.decode(output.line)).toEqual('id: abc');
                expect(output.fieldLength).toEqual(2);
            }

            expect(lineNum).toBe(1);
        });

        it('multiple lines', async () => {
            let lineNum = 0;
            const content = `id: abc\ndata: def\n`;

            const next = parse.getLines();
            for await (const output of next(encoder.encode(content))) {
                ++lineNum;
                expect(decoder.decode(output.line)).toEqual(lineNum === 1 ? 'id: abc' : 'data: def');
                expect(output.fieldLength).toEqual(lineNum === 1 ? 2 : 4);
            }

            expect(lineNum).toBe(2);
        });

        it('single line split across multiple arrays', async () => {
            let lineNum = 0;
            const next = parse.getLines();
            // Note we have to feed the next function with the first part of the line but
            // there's nothing to do here, so don't assert in the first for of gen loop
            for await (const _ of next(encoder.encode('id: a'))) { }
            for await (const output of next(encoder.encode('bc\n'))) {
                ++lineNum;
                expect(decoder.decode(output.line)).toEqual('id: abc');
                expect(output.fieldLength).toEqual(2);
            }
            expect(lineNum).toBe(1);
        });

        it('multiple lines split across multiple arrays', async () => {
            let lineNum = 0;

            const next = parse.getLines();
            for await (const _ of next(encoder.encode('id: ab'))) { }
            for await (const output of next(encoder.encode('c\nda'))) {
                ++lineNum;
                expect(decoder.decode(output.line)).toEqual('id: abc');
                expect(output.fieldLength).toEqual(2);
            }
            for await (const output of next(encoder.encode('ta: def\n'))) {
                ++lineNum;
                expect(decoder.decode(output.line)).toEqual('data: def');
                expect(output.fieldLength).toEqual(4);
            }

            expect(lineNum).toBe(2);
        });

        it('new line', async () => {
            let lineNum = 0;

            const next = parse.getLines();
            for await (const output of next(encoder.encode('\n'))) {
                ++lineNum;
                expect(decoder.decode(output.line)).toEqual('');
                expect(output.fieldLength).toEqual(-1);
            }

            expect(lineNum).toBe(1);
        });

        it('comment line', async () => {
            let lineNum = 0;

            const next = parse.getLines();
            for await (const output of next(encoder.encode(': this is a comment\n'))) {
                ++lineNum;
                expect(decoder.decode(output.line)).toEqual(': this is a comment');
                expect(output.fieldLength).toEqual(0);
            }

            expect(lineNum).toBe(1);
        });

        it('line with no field', async () => {
            let lineNum = 0;

            const next = parse.getLines();
            for await (const output of next(encoder.encode('this is an invalid line\n'))) {
                ++lineNum;
                expect(decoder.decode(output.line)).toEqual('this is an invalid line');
                expect(output.fieldLength).toEqual(-1);
            }

            expect(lineNum).toBe(1);
        });

        it('line with multiple colons', async () => {
            let lineNum = 0;

            const next = parse.getLines();
            for await (const output of next(encoder.encode('id: abc: def\n'))) {
                ++lineNum;
                expect(decoder.decode(output.line)).toEqual('id: abc: def');
                expect(output.fieldLength).toEqual(2);
            }

            expect(lineNum).toBe(1);
        });

        it('single byte array with multiple lines separated by \\n', async () => {
            let lineNum = 0;

            const next = parse.getLines();
            for await (const output of next(encoder.encode('id: abc\ndata: def\n'))) {
                ++lineNum;
                expect(decoder.decode(output.line)).toEqual(lineNum === 1 ? 'id: abc' : 'data: def');
                expect(output.fieldLength).toEqual(lineNum === 1 ? 2 : 4);
            }

            expect(lineNum).toBe(2);
        });

        it('single byte array with multiple lines separated by \\r', async () => {
            let lineNum = 0;

            const next = parse.getLines();
            for await (const output of next(encoder.encode('id: abc\rdata: def\r'))) {
                ++lineNum;
                expect(decoder.decode(output.line)).toEqual(lineNum === 1 ? 'id: abc' : 'data: def');
                expect(output.fieldLength).toEqual(lineNum === 1 ? 2 : 4);
            }

            expect(lineNum).toBe(2);
        });

        it('single byte array with multiple lines separated by \\r\\n', async () => {
            let lineNum = 0;

            const next = parse.getLines();
            for await (const output of next(encoder.encode('id: abc\r\ndata: def\r\n'))) {
                ++lineNum;
                expect(decoder.decode(output.line)).toEqual(lineNum === 1 ? 'id: abc' : 'data: def');
                expect(output.fieldLength).toEqual(lineNum === 1 ? 2 : 4);
            }

            expect(lineNum).toBe(2);
        });

        describe('getMessages', () => {
            it('happy path', async () => {
                let msgNum = 0;

                const onLine = parse.getMessages();
                for await (const msg of onLine(encoder.encode('retry: 42'), 5)) {
                    expect(msg.retry).toEqual(42);
                }
                for await (const msg of onLine(encoder.encode('id: abc'), 2)) {
                    expect(msg.id).toEqual('abc');
                }
                for await (const _ of onLine(encoder.encode('event:def'), 5)) {
                    throw new Error('should not be called');
                }
                for await (const _ of onLine(encoder.encode('data:ghi'), 4)) {
                    throw new Error('should not be called');
                }
                for await (const msg of onLine(encoder.encode(''), -1)) {
                    ++msgNum;
                    expect(msg).toEqual({
                        retry: 42,
                        id: 'abc',
                        event: 'def',
                        data: 'ghi'
                    });
                }

                expect(msgNum).toBe(1);
            });

            it('skip unknown fields', async () => {
                let msgNum = 0;

                const onLine = parse.getMessages();

                for await (const msg of onLine(encoder.encode('id: abc'), 2)) {
                    expect(msg.id).toEqual('abc');
                }
                for await (const _ of onLine(encoder.encode('foo: null'), 3)) {
                    throw new Error('should not be called');
                }
                for await (const msg of onLine(encoder.encode(''), -1)) {
                    ++msgNum;
                    expect(msg).toEqual({
                        id: 'abc',
                        data: '',
                        event: '',
                        retry: undefined,
                    });
                }

                expect(msgNum).toBe(1);
            });

            it('ignore non-integer retry', async () => {
                let msgNum = 0;

                const onLine = parse.getMessages();

                for await (const _ of onLine(encoder.encode('retry: def'), 5)) {
                    throw new Error('should not be called');
                }
                for await (const msg of onLine(encoder.encode(''), -1)) {
                    ++msgNum;
                    expect(msg).toEqual({
                        id: '',
                        data: '',
                        event: '',
                        retry: undefined,
                    });
                }

                expect(msgNum).toBe(1);
            });

            it('skip comment-only messages', async () => {
                let msgNum = 0;

                const onLine = parse.getMessages();

                for await (const output of onLine(encoder.encode('id:123'), 2)) {
                    expect(output.id).toEqual('123');
                }
                for await (const _ of onLine(encoder.encode(':'), 0)) {
                    throw new Error('should not be called');
                }
                for await (const _ of onLine(encoder.encode(':    '), 0)) {
                    throw new Error('should not be called');
                }
                for await (const _ of onLine(encoder.encode('event: foo '), 5)) {
                    throw new Error('should not be called');
                }
                for await (const msg of onLine(encoder.encode(''), -1)) {
                    ++msgNum;
                    expect(msg).toEqual({
                        retry: undefined,
                        id: '123',
                        event: 'foo ',
                        data: '',
                    });
                }

                expect(msgNum).toBe(1);
            });

            it('should append data split across multiple lines', async () => {
                let msgNum = 0;

                const onLine = parse.getMessages();

                for await (const _ of onLine(encoder.encode('data:YHOO'), 4)) {
                    throw new Error('should not be called');
                }
                for await (const _ of onLine(encoder.encode('data: +2'), 4)) {
                    throw new Error('should not be called');
                }
                for await (const _ of onLine(encoder.encode('data'), 4)) {
                    throw new Error('should not be called');
                }
                for await (const _ of onLine(encoder.encode('data: 10'), 4)) {
                    throw new Error('should not be called');
                }
                for await (const msg of onLine(encoder.encode(''), -1)) {
                    ++msgNum;
                    expect(msg).toEqual({
                        data: 'YHOO\n+2\n\n10',
                        id: '',
                        event: '',
                        retry: undefined,
                    });
                }

                expect(msgNum).toBe(1);
            });

            it('should reset id if sent multiple times', async () => {
                let idsIdx = 0;
                let msgNum = 0;

                const onLine = parse.getMessages();

                for await (const msg of onLine(encoder.encode('id: foo'), 2)) {
                    ++idsIdx;
                    expect(msg.id).toBe('foo');
                }
                for await (const msg of onLine(encoder.encode('id'), 2)) {
                    ++idsIdx;
                    expect(msg.id).toBe('');
                }
                for await (const msg of onLine(encoder.encode(''), -1)) {
                    ++msgNum;
                    expect(msg).toEqual({
                        data: '',
                        id: '',
                        event: '',
                        retry: undefined,
                    });
                }

                expect(idsIdx).toBe(2);
                expect(msgNum).toBe(1);
            });
        });
    });
});
