import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Encapsulates the cloud-sync lifecycle: state, retry queue, and last-write
 * timestamp. Surfaces failures instead of swallowing them with console.error.
 *
 * State machine:
 *   off → no supabase client configured
 *   ok  → at least one successful write, queue empty
 *   busy → a write is in flight
 *   warn → at least one write failed and is pending retry
 */
export default function useCloudSync(supabase) {
  const [state, setState] = useState(() => (supabase ? 'ok' : 'off'));
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [queueSize, setQueueSize] = useState(0);
  const queueRef = useRef([]);
  const inFlightRef = useRef(false);

  // Tick-tock state when supabase client appears or disappears
  useEffect(() => {
    if (!supabase) {
      setState('off');
      setQueueSize(0);
      queueRef.current = [];
      return;
    }
    setState((s) => (s === 'off' ? 'ok' : s));
  }, [supabase]);

  const flush = useCallback(async () => {
    if (!supabase || inFlightRef.current) return;
    if (queueRef.current.length === 0) {
      setState('ok');
      return;
    }
    inFlightRef.current = true;
    setState('busy');

    const job = queueRef.current[0];
    try {
      await job.run(supabase);
      // success → drop from queue
      queueRef.current.shift();
      setQueueSize(queueRef.current.length);
      setLastSyncAt(Date.now());
      inFlightRef.current = false;

      if (queueRef.current.length === 0) {
        setState('ok');
      } else {
        // continue draining
        setTimeout(flush, 30);
      }
    } catch (err) {
      console.error('[cloudSync]', job.label, err);
      inFlightRef.current = false;
      setState('warn');
      // retry the same job after backoff
      setTimeout(flush, 4000);
    }
  }, [supabase]);

  /** Enqueue a write. The job is { label, run(client) → Promise } */
  const enqueue = useCallback((job) => {
    if (!supabase) return;
    queueRef.current.push(job);
    setQueueSize(queueRef.current.length);
    flush();
  }, [supabase, flush]);

  /** Manual retry trigger (used by the badge button). */
  const retry = useCallback(() => {
    if (state === 'warn') flush();
  }, [state, flush]);

  return { state, lastSyncAt, queueSize, enqueue, retry };
}
