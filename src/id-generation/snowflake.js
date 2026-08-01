import { encode } from './base62.js';
import { env } from '../config/env.js';

const TINYURL_EPOCH = 1704067200000n;

const TIMESTAMP_BITS = 41n;
const MACHINE_BITS   = 10n;
const SEQUENCE_BITS  = 12n;

const MAX_MACHINE_ID = (1n << MACHINE_BITS) - 1n;
const MAX_SEQUENCE   = (1n << SEQUENCE_BITS) - 1n;

const MACHINE_SHIFT   = SEQUENCE_BITS;
const TIMESTAMP_SHIFT = SEQUENCE_BITS + MACHINE_BITS;

class SnowflakeGenerator {
  #machineId;
  #sequence      = 0n;
  #lastTimestamp = -1n;

  constructor(machineId) {
    const mid = BigInt(machineId);
    if (mid < 0n || mid > MAX_MACHINE_ID) {
      throw new RangeError(
        `MACHINE_ID must be between 0 and ${MAX_MACHINE_ID}. Got: ${machineId}`
      );
    }
    this.#machineId = mid;
    console.log(`[Snowflake] Initialized with MACHINE_ID=${machineId}`);
  }

  #currentMs() {
    return BigInt(Date.now()) - TINYURL_EPOCH;
  }

  #waitNextMs(lastMs) {
    let ts = this.#currentMs();
    while (ts <= lastMs) {
      ts = this.#currentMs();
    }
    return ts;
  }

  nextRawId() {
    let timestamp = this.#currentMs();

    if (timestamp < this.#lastTimestamp) {
      const drift = this.#lastTimestamp - timestamp;
      console.warn(`[Snowflake] Clock moved backward by ${drift}ms. Waiting for recovery...`);
      timestamp = this.#waitNextMs(this.#lastTimestamp);
    }

    if (timestamp === this.#lastTimestamp) {
      this.#sequence = (this.#sequence + 1n) & MAX_SEQUENCE;
      if (this.#sequence === 0n) {
        timestamp = this.#waitNextMs(this.#lastTimestamp);
      }
    } else {
      this.#sequence = 0n;
    }

    this.#lastTimestamp = timestamp;

    return (timestamp << TIMESTAMP_SHIFT)
      | (this.#machineId << MACHINE_SHIFT)
      | this.#sequence;
  }

  nextId() {
    return encode(this.nextRawId());
  }

  static decompose(rawId) {
    const sequence  = rawId & MAX_SEQUENCE;
    const machineId = (rawId >> MACHINE_SHIFT) & MAX_MACHINE_ID;
    const tsOffset  = rawId >> TIMESTAMP_SHIFT;
    const tsMs      = tsOffset + TINYURL_EPOCH;

    return {
      timestamp: new Date(Number(tsMs)),
      machineId: Number(machineId),
      sequence:  Number(sequence),
    };
  }
}

const MACHINE_ID = parseInt(env.MACHINE_ID ?? '0', 10);

export const snowflake = new SnowflakeGenerator(MACHINE_ID);
export { SnowflakeGenerator };
