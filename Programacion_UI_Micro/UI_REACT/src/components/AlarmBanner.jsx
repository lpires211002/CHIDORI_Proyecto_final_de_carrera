import React, { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Persistent alarm state. Replaces the prior 4.5s ephemeral toast.
 * Sticky top, strobing surface, repeating tone, document.title flash,
 * dismissed only by explicit acknowledge.
 */
export default function AlarmBanner({ active, message, hint, onAcknowledge }) {
  const audioCtxRef = useRef(null);
  const intervalRef = useRef(null);
  const originalTitleRef = useRef(null);

  // Stop any in-flight oscillators and tear down audio + title flash + interval.
  const teardown = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (originalTitleRef.current !== null) {
      document.title = originalTitleRef.current;
      originalTitleRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch { /* noop */ }
      audioCtxRef.current = null;
    }
  };

  useEffect(() => {
    if (!active) {
      teardown();
      return;
    }

    // Snapshot original title and start flash
    originalTitleRef.current = document.title;
    let flashOn = false;
    const flashTitle = () => {
      flashOn = !flashOn;
      document.title = flashOn ? '⚠ ATENCION · Chidori' : originalTitleRef.current;
    };

    // Repeating low-mid tone (every 1.6s)
    const playTone = () => {
      try {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        }
        const ctx = audioCtxRef.current;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 660;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.42);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.45);
      } catch {
        // Audio unavailable: visual + title flash still convey the state
      }
    };

    playTone();
    flashTitle();
    intervalRef.current = setInterval(() => {
      playTone();
      flashTitle();
    }, 1600);

    // Try a desktop Notification if the user has previously allowed it
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Chidori · umbral alcanzado', {
          body: message || 'Atención requerida del paciente.',
          tag: 'chidori-alarm',
          silent: true,
        });
      } catch { /* noop */ }
    }

    return teardown;
  }, [active, message]);

  // Defensive: ensure unmount tears down even if React skips the cleanup path
  useEffect(() => teardown, []);

  if (!active) return null;

  return (
    <div className="alarm-banner" role="alert" aria-live="assertive">
      <span className="alarm-banner-dot" aria-hidden="true" />
      <div>
        <div className="alarm-banner-text">
          <AlertTriangle size={18} style={{ verticalAlign: '-3px', marginRight: 8 }} />
          {message || 'Umbral preventivo alcanzado'}
        </div>
        {hint && <div className="alarm-banner-help">{hint}</div>}
      </div>
      <button type="button" className="button button-danger" onClick={onAcknowledge}>
        Reconocer alarma
      </button>
    </div>
  );
}
