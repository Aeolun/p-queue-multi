export class TimeoutError extends Error {
	constructor(message?: string) {
		super(message);
		this.name = 'TimeoutError';
	}
}

/**
An error to be thrown when the request is aborted by AbortController.
DOMException is thrown instead of this Error when DOMException is available.
 */
export class AbortError extends Error {
	constructor(message?: string) {
		super(message);
		this.name = 'AbortError';
	}
}

/**
TODO: Remove AbortError and just throw DOMException when targeting Node 18.
 */
const getDomException = (errorMessage: string) => globalThis.DOMException === undefined
	? new AbortError(errorMessage)
	: new DOMException(errorMessage);

/**
TODO: Remove below function and just 'reject(signal.reason)' when targeting Node 18.
 */
const getAbortedReason = (signal: AbortSignal): AbortError | DOMException | Error => {
	const reason: any = signal.reason === undefined
		? getDomException('This operation was aborted.')
		: signal.reason;

	return reason instanceof Error ? reason : getDomException(reason);
};

type Options<R> = {
	/**
	Timeout in milliseconds.
	 */
	milliseconds: number;

	/**
	Fallback value to return when the promise times out.
	 */
	fallback?: () => R;

	/**
	Custom error message to use when the promise times out.
	 */
	message?: string | Error | false;

	/**
	Signal to abort the promise.
	 */
	signal?: AbortSignal;

	/**
	Custom timers to use.
	 */
	customTimers?: {
		setTimeout: typeof setTimeout;
		clearTimeout: typeof clearTimeout;
	};
};

export default async function pTimeout<R>(promise: Promise<R | undefined>, options: Options<R>): Promise<any> {
	const {
		milliseconds,
		fallback,
		message,
		customTimers = {setTimeout, clearTimeout},
	} = options;

	let timer: NodeJS.Timeout | undefined;
	type CancelablePromise = Promise<R | undefined> & {
		clear?: () => void;
	};

	const wrappedPromise: CancelablePromise = new Promise<R | undefined>((resolve, reject) => {
		if (typeof milliseconds !== 'number' || Math.sign(milliseconds) !== 1) {
			throw new TypeError(`Expected \`milliseconds\` to be a positive number, got \`${milliseconds}\``);
		}

		if (options.signal) {
			const {signal} = options;
			if (signal.aborted) {
				reject(getAbortedReason(signal));
			}

			signal.addEventListener('abort', () => {
				reject(getAbortedReason(signal));
			});
		}

		if (milliseconds === Number.POSITIVE_INFINITY) {
			promise.then(resolve, reject);
			return;
		}

		// We create the error outside of `setTimeout` to preserve the stack trace.
		const timeoutError = new TimeoutError();

		timer = customTimers.setTimeout.call(undefined, () => {
			if (fallback) {
				try {
					resolve(fallback());
				} catch (error) {
					reject(error);
				}

				return;
			}

			if ('cancel' in promise && typeof promise.cancel === 'function') {
				promise.cancel();
			}

			if (message === false) {
				resolve(undefined);
			} else if (message instanceof Error) {
				reject(message);
			} else {
				timeoutError.message = message ?? `Promise timed out after ${milliseconds} milliseconds`;
				reject(timeoutError);
			}
		}, milliseconds);

		(async () => {
			try {
				resolve(await promise);
			} catch (error) {
				reject(error);
			}
		})();
	});

	wrappedPromise.clear = () => {
		customTimers.clearTimeout.call(undefined, timer);
		timer = undefined;
	};

	promise.finally(() => {
		wrappedPromise.clear?.();
	});

	return wrappedPromise;
}
