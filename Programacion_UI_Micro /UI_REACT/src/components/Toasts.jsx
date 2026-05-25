import React from 'react';
import { Info, CheckCircle2, AlertTriangle } from 'lucide-react';

const ICON = {
  info:    Info,
  success: CheckCircle2,
  warn:    AlertTriangle,
};

const CLASS = {
  info:    't-info',
  success: 't-success',
  warn:    't-warn',
};

/**
 * Ephemeral, low-volume notification stack.
 * Never used for alarms (those go through AlarmBanner).
 */
export default function Toasts({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((t) => {
        const Icon = ICON[t.type] || Info;
        return (
          <div key={t.id} className={`toast ${CLASS[t.type] || ''}`}>
            <Icon size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{t.text}</span>
          </div>
        );
      })}
    </div>
  );
}
