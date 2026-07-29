const inFlight = new Map();
export async function singleFlight(key, fn) {
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = fn().finally(() => {
        inFlight.delete(key);
    });
    inFlight.set(key, promise);
    return promise;
}