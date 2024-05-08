/* eslint-disable no-new */
import EventEmitter from 'eventemitter3';
import {test, expect} from 'vitest';
import delay from 'delay';
import inRange from 'in-range';
import timeSpan from 'time-span';
import randomInt from 'random-int';
import pDefer from 'p-defer';
import PQueue, {TimeoutError} from '../src/index.js';

const fixture = Symbol('fixture');

test('.add()', async t => {
	const queue = new PQueue();
	const promise = queue.add(async () => fixture);
	expect(queue.size).toBe(0);
	expect(queue.pending).toBe(1);
	expect(await promise).toBe(fixture);
});

test('.add() - limited concurrency', async t => {
	const queue = new PQueue({concurrency: 2});
	const promise = queue.add(async () => fixture);
	const promise2 = queue.add(async () => {
		await delay(100);
		return fixture;
	});
	const promise3 = queue.add(async () => fixture);
	expect(queue.size).toBe(1);
	expect(queue.pending).toBe(2);
	expect(await promise).toBe(fixture);
	expect(await promise2).toBe(fixture);
	expect(await promise3).toBe(fixture);
});

test('.add() - concurrency: 1', async t => {
	const input = [
		[10, 300],
		[20, 200],
		[30, 100],
	];

	const end = timeSpan();
	const queue = new PQueue({concurrency: 1});

	const mapper = async ([value, ms]: readonly number[]) => queue.add(async () => {
		await delay(ms!);
		return value!;
	});

	await expect(Promise.all(input.map(mapper))).resolves.toMatchObject([10, 20, 30]);
	expect(inRange(end(), {start: 590, end: 650})).toBeTruthy();
});

test('.add() - concurrency: 5', async t => {
	const concurrency = 5;
	const queue = new PQueue({concurrency});
	let running = 0;

	const input = Array.from({length: 100}).fill(0).map(async () => queue.add(async () => {
		running++;
		expect(running <= concurrency).toBeTruthy();
		expect(queue.pending <= concurrency).toBeTruthy();
		await delay(randomInt(30, 200));
		running--;
	}));

	await Promise.all(input);
});

test('.add() - update concurrency', async t => {
	let concurrency = 5;
	const queue = new PQueue({concurrency});
	let running = 0;

	const input = Array.from({length: 100}).fill(0).map(async (_value, index) => queue.add(async () => {
		running++;

		expect(running <= concurrency).toBeTruthy();
		expect(queue.pending <= concurrency).toBeTruthy();

		await delay(randomInt(30, 200));
		running--;

		if (index % 30 === 0) {
			queue.concurrency = --concurrency;
			expect(queue.concurrency).toBe(concurrency);
		}
	}));

	await Promise.all(input);
}, {
	timeout: 15000
});

test('.add() - priority', async t => {
	const result: number[] = [];
	const queue = new PQueue({concurrency: 1});
	queue.add(async () => result.push(1), {priority: 1});
	queue.add(async () => result.push(0), {priority: 0});
	queue.add(async () => result.push(1), {priority: 1});
	queue.add(async () => result.push(2), {priority: 1});
	queue.add(async () => result.push(3), {priority: 2});
	queue.add(async () => result.push(0), {priority: -1});
	await queue.onEmpty();
	expect(result).toMatchObject([1, 3, 1, 2, 0, 0]);
});

test('.sizeBy() - priority', async t => {
	const queue = new PQueue();
	queue.pause();
	queue.add(async () => 0, {priority: 1});
	queue.add(async () => 0, {priority: 0});
	queue.add(async () => 0, {priority: 1});
	expect(queue.sizeBy({priority: 1})).toBe(2);
	expect(queue.sizeBy({priority: 0})).toBe(1);
	queue.clear();
	await queue.onEmpty();
	expect(queue.sizeBy({priority: 1})).toBe(0);
	expect(queue.sizeBy({priority: 0})).toBe(0);
});

test('.add() - timeout without throwing', async t => {
	const result: string[] = [];
	const queue = new PQueue({timeout: 300, throwOnTimeout: false});
	const promises: any[] = [];
	promises.push(queue.add(async () => {
		await delay(400);
		result.push('🐌');
	}));
	promises.push(queue.add(async () => {
		await delay(250);
		result.push('🦆');
	}));
	promises.push(queue.add(async () => {
		await delay(310);
		result.push('🐢');
	}));
	promises.push(queue.add(async () => {
		await delay(100);
		result.push('🐅');
	}));
	promises.push(queue.add(async () => {
		result.push('⚡️');
	}));
	await queue.onIdle();
	expect(result).toStrictEqual(['⚡️', '🐅', '🦆']);
	await Promise.allSettled(promises);
});

test('.add() - timeout with throwing', async t => {
	const result: string[] = [];
	const queue = new PQueue({timeout: 300, throwOnTimeout: true});
	const delayedPromise = expect(async () => {
		try {
			await queue.add(async () => {
				await delay(400);
				result.push('🐌');
			})
		} catch(error) {
			expect(error).toBeInstanceOf(TimeoutError);
		}
	}).rejects;
	await queue.add(async () => {
		await delay(200);
		result.push('🦆');
	});
	await queue.onIdle();
	expect(result).toMatchObject(['🦆']);
});

test('.add() - change timeout in between', async t => {
	const result: string[] = [];
	const initialTimeout = 50;
	const newTimeout = 200;
	const queue = new PQueue({timeout: initialTimeout, throwOnTimeout: false, concurrency: 2});
	queue.add(async () => {
		const {timeout} = queue;
		expect(timeout).toMatchObject(initialTimeout);
		await delay(300);
		result.push('🐌');
	});
	queue.timeout = newTimeout;
	queue.add(async () => {
		const {timeout} = queue;
		expect(timeout).toMatchObject(newTimeout);
		await delay(100);
		result.push('🐅');
	});
	await queue.onIdle();
	expect(result).toMatchObject(['🐅']);
	await delay(300)
});

test('.onEmpty()', async t => {
	const queue = new PQueue({concurrency: 1});

	queue.add(async () => 0);
	queue.add(async () => 0);
	expect(queue.size).toBe(1);
	expect(queue.pending).toBe(1);
	await queue.onEmpty();
	expect(queue.size).toBe(0);

	queue.add(async () => 0);
	queue.add(async () => 0);
	expect(queue.size).toBe(1);
	expect(queue.pending).toBe(1);
	await queue.onEmpty();
	expect(queue.size).toBe(0);

	// Test an empty queue
	await queue.onEmpty();
	expect(queue.size).toBe(0);
});

test('.onIdle()', async t => {
	const queue = new PQueue({concurrency: 2});

	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	expect(queue.size).toBe(1);
	expect(queue.pending).toBe(2);
	await queue.onIdle();
	expect(queue.size).toBe(0);
	expect(queue.pending).toBe(0);

	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	expect(queue.size).toBe(1);
	expect(queue.pending).toBe(2);
	await queue.onIdle();
	expect(queue.size).toBe(0);
	expect(queue.pending).toBe(0);
});

test('.onSizeLessThan()', async t => {
	const queue = new PQueue({concurrency: 1});

	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));

	await queue.onSizeLessThan(4);
	expect(queue.size).toBe(3);
	expect(queue.pending).toBe(1);

	await queue.onSizeLessThan(2);
	expect(queue.size).toBe(1);
	expect(queue.pending).toBe(1);

	await queue.onSizeLessThan(10);
	expect(queue.size).toBe(1);
	expect(queue.pending).toBe(1);

	await queue.onSizeLessThan(1);
	expect(queue.size).toBe(0);
	expect(queue.pending).toBe(1);
});

test('.onIdle() - no pending', async t => {
	const queue = new PQueue();
	expect(queue.size).toBe(0);
	expect(queue.pending).toBe(0);

	// eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
	expect(queue.onIdle()).resolves.toBe(undefined);
});

test('.clear()', t => {
	const queue = new PQueue({concurrency: 2});
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	expect(queue.size).toBe(4);
	expect(queue.pending).toBe(2);
	queue.clear();
	expect(queue.size).toBe(0);
});

test('.addAll()', async t => {
	const queue = new PQueue();
	const fn = async (): Promise<symbol> => fixture;
	const functions = [fn, fn];
	const promise = queue.addAll(functions);
	expect(queue.size).toBe(0);
	expect(queue.pending).toBe(2);
	expect(await promise).toMatchObject([fixture, fixture]);
});

test('enforce number in options.concurrency', t => {
	expect(
		() => {
			new PQueue({concurrency: 0});
		}).toThrow(TypeError);

	expect(
		() => {
			new PQueue({concurrency: undefined});
		}).toThrow(TypeError);

	expect(() => {
		new PQueue({concurrency: 1});
	}).not.toThrow();

	expect(() => {
		new PQueue({concurrency: 10});
	}).not.toThrow();

	expect(() => {
		new PQueue({concurrency: Number.POSITIVE_INFINITY});
	}).not.toThrow();
});

test('enforce number in queue.concurrency', t => {
	expect(
		() => {
			(new PQueue()).concurrency = 0;
		},
	).toThrow(TypeError);

	expect(
		() => {
			// @ts-expect-error Testing
			(new PQueue()).concurrency = undefined;
		},
	).toThrow(TypeError);

	expect(() => {
		(new PQueue()).concurrency = 1;
	}).not.toThrow();

	expect(() => {
		(new PQueue()).concurrency = 10;
	}).not.toThrow();

	expect(() => {
		(new PQueue()).concurrency = Number.POSITIVE_INFINITY;
	}).not.toThrow();
});

test('enforce number in options.intervalCap', t => {
	expect(
		() => {
			new PQueue({intervalCap: 0});
		},
	).toThrow(TypeError);

	expect(
		() => {
			new PQueue({intervalCap: undefined});
		},
	)
		.toThrow(TypeError);

	expect(() => {
		new PQueue({intervalCap: 1});
	}).not.toThrow();

	expect(() => {
		new PQueue({intervalCap: 10});
	}).not.toThrow();

	expect(() => {
		new PQueue({intervalCap: Number.POSITIVE_INFINITY});
	}).not.toThrow();
});

test('enforce finite in options.interval', t => {
	expect(
		() => {
			new PQueue({interval: -1});
		},
	).toThrow(TypeError);

	expect(
		() => {
			new PQueue({interval: undefined});
		},
	).toThrow(TypeError);

	expect(() => {
		new PQueue({interval: Number.POSITIVE_INFINITY});
	}).toThrow(TypeError);

	expect(() => {
		new PQueue({interval: 0});
	}).not.toThrow();

	expect(() => {
		new PQueue({interval: 10});
	}).not.toThrow();

	expect(() => {
		new PQueue({interval: Number.POSITIVE_INFINITY});
	}).toThrow();
});

test('autoStart: false', t => {
	const queue = new PQueue({concurrency: 2, autoStart: false});

	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	expect(queue.size).toBe(4);
	expect(queue.pending).toBe(0);
	expect(queue.isPaused).toBe(true);

	queue.start();
	expect(queue.size).toBe(2);
	expect(queue.pending).toBe(2);
	expect(queue.isPaused).toBe(false);

	queue.clear();
	expect(queue.size).toBe(0);
});

test('.start() - return this', async t => {
	const queue = new PQueue({concurrency: 2, autoStart: false});

	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	expect(queue.size).toBe(3);
	expect(queue.pending).toBe(0);
	await queue.start().onIdle();
	expect(queue.size).toBe(0);
	expect(queue.pending).toBe(0);
});

test('.start() - not paused', t => {
	const queue = new PQueue();

	expect(queue.isPaused).toBeFalsy();

	queue.start();

	expect(queue.isPaused).toBeFalsy();
});

test('.pause()', t => {
	const queue = new PQueue({concurrency: 2});

	queue.pause();
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	expect(queue.size).toBe(5);
	expect(queue.pending).toBe(0);
	expect(queue.isPaused).toBe(true);

	queue.start();
	expect(queue.size).toBe(3);
	expect(queue.pending).toBe(2);
	expect(queue.isPaused).toBe(false);

	queue.add(async () => delay(20_000));
	queue.pause();
	expect(queue.size).toBe(4);
	expect(queue.pending).toBe(2);
	expect(queue.isPaused).toBe(true);

	queue.start();
	expect(queue.size).toBe(4);
	expect(queue.pending).toBe(2);
	expect(queue.isPaused).toBe(false);

	queue.clear();
	expect(queue.size).toBe(0);
});

test('.add() sync/async mixed tasks', async t => {
	const queue = new PQueue({concurrency: 1});
	queue.add(() => 'sync 1');
	queue.add(async () => delay(1000));
	queue.add(() => 'sync 2');
	queue.add(() => fixture);
	expect(queue.size).toBe(3);
	expect(queue.pending).toBe(1);
	await queue.onIdle();
	expect(queue.size).toBe(0);
	expect(queue.pending).toBe(0);
});

test.fails('.add() - handle task throwing error', async t => {
	const queue = new PQueue({concurrency: 1});

	queue.add(() => 'sync 1');
	await expect(
		queue.add(
			() => {
				throw new Error('broken');
			},
		),
	).rejects.toThrow('broken');
	queue.add(() => 'sync 2');

	expect(queue.size).toBe(2);

	await queue.onIdle();
});

test('.add() - handle task promise failure', async t => {
	const queue = new PQueue({concurrency: 1});

	await expect(
		queue.add(
			async () => {
				throw new Error('broken');
			},
		),
	).rejects.toThrow('broken');

	queue.add(() => 'task #1');

	expect(queue.pending).toBe(1);

	await queue.onIdle();

	expect(queue.pending).toBe(0);
});

test('.addAll() sync/async mixed tasks', async t => {
	const queue = new PQueue();

	const functions: Array<() => (string | Promise<void> | Promise<unknown>)> = [
		() => 'sync 1',
		async () => delay(2000),
		() => 'sync 2',
		async () => fixture,
	];

	const promise = queue.addAll(functions);

	expect(queue.size).toBe(0);
	expect(queue.pending).toBe(4);
	expect(await promise).toMatchObject(['sync 1', undefined, 'sync 2', fixture]);
});

test('should resolve empty when size is zero', async t => {
	const queue = new PQueue({concurrency: 1, autoStart: false});

	// It should take 1 seconds to resolve all tasks
	for (let index = 0; index < 100; index++) {
		queue.add(async () => delay(10));
	}

	(async () => {
		await queue.onEmpty();
		expect(queue.size).toBe(0);
	})();

	queue.start();

	// Pause at 0.5 second
	setTimeout(
		async () => {
			queue.pause();
			await delay(10);
			queue.start();
		},
		500,
	);

	await queue.onIdle();
});

test('.add() - throttled', async t => {
	const result: number[] = [];
	const queue = new PQueue({
		intervalCap: 1,
		interval: 500,
		autoStart: false,
	});
	queue.add(async () => result.push(1));
	queue.start();
	await delay(250);
	queue.add(async () => result.push(2));
	expect(result).toMatchObject([1]);
	await delay(300);
	expect(result).toMatchObject([1, 2]);
});

test('.add() - throttled, carryoverConcurrencyCount false', async t => {
	const result: number[] = [];

	const queue = new PQueue({
		intervalCap: 1,
		carryoverConcurrencyCount: false,
		interval: 500,
		autoStart: false,
	});

	const values = [0, 1];
	for (const value of values) {
		queue.add(async () => {
			await delay(600);
			result.push(value);
		});
	}

	queue.start();

	(async () => {
		await delay(550);
		expect(queue.pending).toBe(2);
		expect(result).toMatchObject([]);
	})();

	(async () => {
		await delay(650);
		expect(queue.pending).toBe(1);
		expect(result).toMatchObject([0]);
	})();

	await delay(1250);
	expect(result).toMatchObject(values);
});

test('.add() - throttled, carryoverConcurrencyCount true', async t => {
	const result: number[] = [];

	const queue = new PQueue({
		carryoverConcurrencyCount: true,
		intervalCap: 1,
		interval: 500,
		autoStart: false,
	});

	const values = [0, 1];
	for (const value of values) {
		queue.add(async () => {
			await delay(600);
			result.push(value);
		});
	}

	queue.start();

	(async () => {
		await delay(100);
		expect(result).toMatchObject([]);
		expect(queue.pending).toBe(1);
	})();

	(async () => {
		await delay(550);
		expect(result).toMatchObject([]);
		expect(queue.pending).toBe(1);
	})();

	(async () => {
		await delay(650);
		expect(result).toMatchObject([0]);
		expect(queue.pending).toBe(0);
	})();

	(async () => {
		await delay(1550);
		expect(result).toMatchObject([0]);
	})();

	await delay(1650);
	expect(result).toMatchObject(values);
});

test('.add() - throttled 10, concurrency 5', async t => {
	const result: number[] = [];

	const queue = new PQueue({
		concurrency: 5,
		intervalCap: 10,
		interval: 1000,
		autoStart: false,
	});

	const firstValue = [...Array.from({length: 5}).keys()];
	const secondValue = [...Array.from({length: 10}).keys()];
	const thirdValue = [...Array.from({length: 13}).keys()];

	for (const value of thirdValue) {
		queue.add(async () => {
			await delay(300);
			result.push(value);
		});
	}

	queue.start();

	expect(result).toMatchObject([]);

	(async () => {
		await delay(400);
		expect(result).toMatchObject(firstValue);
		expect(queue.pending).toBe(5);
	})();

	(async () => {
		await delay(700);
		expect(result).toMatchObject(secondValue);
	})();

	(async () => {
		await delay(1200);
		expect(queue.pending).toBe(3);
		expect(result).toMatchObject(secondValue);
	})();

	await delay(1400);
	expect(result).toMatchObject(thirdValue);
});

test('.add() - throttled finish and resume', async t => {
	const result: number[] = [];

	const queue = new PQueue({
		concurrency: 1,
		intervalCap: 2,
		interval: 2000,
		autoStart: false,
	});

	const values = [0, 1];
	const firstValue = [0, 1];
	const secondValue = [0, 1, 2];

	for (const value of values) {
		queue.add(async () => {
			await delay(100);
			result.push(value);
		});
	}

	queue.start();

	(async () => {
		await delay(1000);
		expect(result).toMatchObject(firstValue);

		queue.add(async () => {
			await delay(100);
			result.push(2);
		});
	})();

	(async () => {
		await delay(1500);
		expect(result).toMatchObject(firstValue);
	})();

	await delay(2200);
	expect(result).toMatchObject(secondValue);
});

test('pause should work when throttled', async t => {
	const result: number[] = [];

	const queue = new PQueue({
		concurrency: 2,
		intervalCap: 2,
		interval: 1000,
		autoStart: false,
	});

	const values = [0, 1, 2, 3];
	const firstValue = [0, 1];
	const secondValue = [0, 1, 2, 3];

	for (const value of values) {
		queue.add(async () => {
			await delay(100);
			result.push(value);
		});
	}

	queue.start();

	(async () => {
		await delay(300);
		expect(result).toMatchObject(firstValue);
	})();

	(async () => {
		await delay(600);
		queue.pause();
	})();

	(async () => {
		await delay(1400);
		expect(result).toMatchObject(firstValue);
	})();

	(async () => {
		await delay(1500);
		queue.start();
	})();

	(async () => {
		await delay(2200);
		expect(result).toMatchObject(secondValue);
	})();

	await delay(2500);
});

test('clear interval on pause', async t => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 1,
	});

	queue.add(() => {
		queue.pause();
	});

	queue.add(() => 'task #1');

	await delay(300);

	expect(queue.size).toBe(1);
});

test('should be an event emitter', t => {
	const queue = new PQueue();
	expect(queue instanceof EventEmitter).toBeTruthy();
});

test('should emit active event per item', async t => {
	const items = [0, 1, 2, 3, 4];
	const queue = new PQueue();

	let eventCount = 0;
	queue.on('active', () => {
		eventCount++;
	});

	for (const item of items) {
		queue.add(() => item);
	}

	await queue.onIdle();

	expect(eventCount).toBe(items.length);
});

test('should emit idle event when idle', async t => {
	const queue = new PQueue({concurrency: 1});

	let timesCalled = 0;
	queue.on('idle', () => {
		timesCalled++;
	});

	const job1 = queue.add(async () => delay(100));
	const job2 = queue.add(async () => delay(100));

	expect(queue.pending).toBe(1);
	expect(queue.size).toBe(1);
	expect(timesCalled).toBe(0);

	await job1;

	expect(queue.pending).toBe(1);
	expect(queue.size).toBe(0);
	expect(timesCalled).toBe(0);

	await job2;

	expect(queue.pending).toBe(0);
	expect(queue.size).toBe(0);
	expect(timesCalled).toBe(1);

	const job3 = queue.add(async () => delay(100));

	expect(queue.pending).toBe(1);
	expect(queue.size).toBe(0);
	expect(timesCalled).toBe(1);

	await job3;
	expect(queue.pending).toBe(0);
	expect(queue.size).toBe(0);
	expect(timesCalled).toBe(2);
});

test('should emit empty event when empty', async t => {
	const queue = new PQueue({concurrency: 1});

	let timesCalled = 0;
	queue.on('empty', () => {
		timesCalled++;
	});

	const {resolve: resolveJob1, promise: job1Promise} = pDefer();
	const {resolve: resolveJob2, promise: job2Promise} = pDefer();

	const job1 = queue.add(async () => job1Promise);
	const job2 = queue.add(async () => job2Promise);
	expect(queue.size).toBe(1);
	expect(queue.pending).toBe(1);
	expect(timesCalled).toBe(0);

	resolveJob1();
	await job1;

	expect(queue.size).toBe(0);
	expect(queue.pending).toBe(1);
	expect(timesCalled).toBe(0);

	resolveJob2();
	await job2;

	expect(queue.size).toBe(0);
	expect(queue.pending).toBe(0);
	expect(timesCalled).toBe(1);
});

test('should emit add event when adding task', async t => {
	const queue = new PQueue({concurrency: 1});

	let timesCalled = 0;
	queue.on('add', () => {
		timesCalled++;
	});

	const job1 = queue.add(async () => delay(100));

	expect(queue.pending).toBe(1);
	expect(queue.size).toBe(0);
	expect(timesCalled).toBe(1);

	const job2 = queue.add(async () => delay(100));

	expect(queue.pending).toBe(1);
	expect(queue.size).toBe(1);
	expect(timesCalled).toBe(2);

	await job1;

	expect(queue.pending).toBe(1);
	expect(queue.size).toBe(0);
	expect(timesCalled).toBe(2);

	await job2;

	expect(queue.pending).toBe(0);
	expect(queue.size).toBe(0);
	expect(timesCalled).toBe(2);

	const job3 = queue.add(async () => delay(100));

	expect(queue.pending).toBe(1);
	expect(queue.size).toBe(0);
	expect(timesCalled).toBe(3);

	await job3;
	expect(queue.pending).toBe(0);
	expect(queue.size).toBe(0);
	expect(timesCalled).toBe(3);
});

test('should emit next event when completing task', async t => {
	const queue = new PQueue({concurrency: 1});

	let timesCalled = 0;
	queue.on('next', () => {
		timesCalled++;
	});

	const job1 = queue.add(async () => delay(100));

	expect(queue.pending).toBe(1);
	expect(queue.size).toBe(0);
	expect(timesCalled).toBe(0);

	const job2 = queue.add(async () => delay(100));

	expect(queue.pending).toBe(1);
	expect(queue.size).toBe(1);
	expect(timesCalled).toBe(0);

	await job1;

	expect(queue.pending).toBe(1);
	expect(queue.size).toBe(0);
	expect(timesCalled).toBe(1);

	await job2;

	expect(queue.pending).toBe(0);
	expect(queue.size).toBe(0);
	expect(timesCalled).toBe(2);

	const job3 = queue.add(async () => delay(100));

	expect(queue.pending).toBe(1);
	expect(queue.size).toBe(0);
	expect(timesCalled).toBe(2);

	await job3;
	expect(queue.pending).toBe(0);
	expect(queue.size).toBe(0);
	expect(timesCalled).toBe(3);
});

test('should emit completed / error events', async t => {
	const queue = new PQueue({concurrency: 1});

	let errorEvents = 0;
	let completedEvents = 0;
	queue.on('error', () => {
		errorEvents++;
	});
	queue.on('completed', () => {
		completedEvents++;
	});

	const job1 = queue.add(async () => delay(100));

	expect(queue.pending).toBe(1);
	expect(queue.size).toBe(0);
	expect(errorEvents).toBe(0);
	expect(completedEvents).toBe(0);

	const job2 = queue.add(async () => {
		await delay(1);
		throw new Error('failure');
	});

	expect(queue.pending).toBe(1);
	expect(queue.size).toBe(1);
	expect(errorEvents).toBe(0);
	expect(completedEvents).toBe(0);

	await job1;

	expect(queue.pending).toBe(1);
	expect(queue.size).toBe(0);
	expect(errorEvents).toBe(0);
	expect(completedEvents).toBe(1);

	await expect(job2).rejects.toThrow();

	expect(queue.pending).toBe(0);
	expect(queue.size).toBe(0);
	expect(errorEvents).toBe(1);
	expect(completedEvents).toBe(1);

	const job3 = queue.add(async () => delay(100));

	expect(queue.pending).toBe(1);
	expect(queue.size).toBe(0);
	expect(errorEvents).toBe(1);
	expect(completedEvents).toBe(1);

	await job3;
	expect(queue.pending).toBe(0);
	expect(queue.size).toBe(0);
	expect(errorEvents).toBe(1);
	expect(completedEvents).toBe(2);
});

test('should verify timeout overrides passed to add', async t => {
	const queue = new PQueue({timeout: 200, throwOnTimeout: true});

	await expect(queue.add(async () => {
		await delay(400);
	})).rejects.toThrow();

	await expect(queue.add(async () => {
		await delay(400);
	}, {throwOnTimeout: false})).resolves.not.toThrow();

	await expect(queue.add(async () => {
		await delay(400);
	}, {timeout: 600})).resolves.not.toThrow();

	await expect(queue.add(async () => {
		await delay(100);
	})).resolves.not.toThrow();

	await expect(queue.add(async () => {
		await delay(100);
	}, {timeout: 50})).rejects.toThrow();

	await queue.onIdle();
});

test('should skip an aborted job', async t => {
	const queue = new PQueue();
	const controller = new AbortController();

	controller.abort();
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	await expect(queue.add(() => {}, {signal: controller.signal})).rejects.toThrow(DOMException);
});

test('should pass AbortSignal instance to job', async t => {
	const queue = new PQueue();
	const controller = new AbortController();

	await queue.add(async ({signal}) => {
		expect(controller.signal).toBe(signal);
	}, {signal: controller.signal});
});

test('aborting multiple jobs at the same time', async t => {
	const queue = new PQueue({concurrency: 1});

	const controller1 = new AbortController();
	const controller2 = new AbortController();

	const task1 = queue.add(async () => new Promise(() => {}), {signal: controller1.signal}); // eslint-disable-line @typescript-eslint/no-empty-function
	const task2 = queue.add(async () => new Promise(() => {}), {signal: controller2.signal}); // eslint-disable-line @typescript-eslint/no-empty-function

	setTimeout(() => {
		controller1.abort();
		controller2.abort();
	}, 0);

	await expect(task1).rejects.toThrow(DOMException);
	await expect(task2).rejects.toThrow(DOMException);
	expect(queue).toMatchObject({size: 0, pending: 0});
});
