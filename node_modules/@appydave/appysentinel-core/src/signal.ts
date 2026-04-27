/**
 * Signal envelope and payload types.
 *
 * The Signal is the atomic unit of telemetry that a Sentinel emits. The envelope is
 * a stable common contract; the payload is collector-specific. See the boilerplate
 * spec §6 for the full rationale.
 *
 * Naming:
 * - Signal     — the envelope type (this interface).
 * - Telemetry  — the problem domain.
 * - Sentinel   — the runtime identity (one process per machine).
 * - Collector  — the functional role (input recipe).
 */

import { ulid } from 'ulid';

/** Current schema version of the Signal envelope itself (not the payload). */
export const SIGNAL_SCHEMA_VERSION = '1.0.0';

/**
 * High-level classification — used for routing and storage partitioning.
 *
 * - `log`    — point-in-time record (e.g. a console line)
 * - `metric` — numeric measurement (e.g. CPU %)
 * - `event`  — domain occurrence (e.g. file.created)
 * - `state`  — snapshot of system state
 * - `span`   — time-bounded operation (optional / future)
 */
export type SignalKind = 'log' | 'metric' | 'event' | 'state' | 'span';

/**
 * Severity for log-like signals. Optional for non-log kinds.
 */
export type SignalSeverity = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Base marker — every collector payload implements this. Acts as a brand,
 * not a structural constraint.
 */
export interface SignalPayload {}

/**
 * Signal — the common outer envelope every emitted record conforms to.
 *
 * Outer fields are stable; payload is recipe-specific and typed through the
 * Payload interface pattern (see spec §6.4).
 */
export interface Signal<P extends SignalPayload = SignalPayload> {
  /** Unique ID (ULID). */
  id: string;

  /** ISO 8601 timestamp when the signal was minted. */
  ts: string;

  /** Schema version for the outer envelope. */
  schema_version: string;

  /** Logical source within this Sentinel (e.g. 'watch-directory', 'poll-command'). */
  source: string;

  /** Machine identifier. */
  machine: string;

  /** Sentinel instance identifier (multiple Sentinels per machine are allowed). */
  sentinel_id: string;

  /** Kind of signal — high-level classification for routing. */
  kind: SignalKind;

  /** Name — collector-local semantic label (e.g. 'file.created', 'cpu.usage'). */
  name: string;

  /** Severity for log-like signals; optional for others. */
  severity?: SignalSeverity;

  /** Flat key/value attributes for indexing and filtering (OTEL-style). */
  attributes?: Record<string, string | number | boolean | null>;

  /** Collector-specific typed payload. */
  payload: P;
}

/**
 * Per-Sentinel ambient metadata applied to every emitted Signal.
 */
export interface SignalContext {
  machine: string;
  sentinel_id: string;
}

/**
 * Subset of fields a collector supplies when emitting. The bus fills in
 * `id`, `ts`, `schema_version`, `machine`, and `sentinel_id` if absent.
 */
export type SignalInput<P extends SignalPayload = SignalPayload> = {
  source: string;
  kind: SignalKind;
  name: string;
  payload: P;
  severity?: SignalSeverity;
  attributes?: Record<string, string | number | boolean | null>;
  /** Optional override; defaults to a fresh ULID. */
  id?: string;
  /** Optional override; defaults to ISO now. */
  ts?: string;
};

/**
 * Mint a fully-formed Signal from a partial input plus the Sentinel's ambient context.
 *
 * @param input   Collector-supplied subset of signal fields.
 * @param context Sentinel-wide context (machine + sentinel_id).
 * @returns A complete Signal with id, timestamp, and schema_version filled in.
 */
export function mintSignal<P extends SignalPayload>(
  input: SignalInput<P>,
  context: SignalContext
): Signal<P> {
  return {
    id: input.id ?? ulid(),
    ts: input.ts ?? new Date().toISOString(),
    schema_version: SIGNAL_SCHEMA_VERSION,
    source: input.source,
    machine: context.machine,
    sentinel_id: context.sentinel_id,
    kind: input.kind,
    name: input.name,
    payload: input.payload,
    ...(input.severity !== undefined ? { severity: input.severity } : {}),
    ...(input.attributes !== undefined ? { attributes: input.attributes } : {}),
  };
}
