import React from 'react';

export default function BladderVisual({ initialValue, currentValue, alarmThreshold }) {
  // Calculate filling percentage
  const getFullnessPercentage = () => {
    if (initialValue === null || currentValue === null) return 0;
    if (currentValue >= initialValue) return 0;

    // Use calibrated threshold if available, otherwise default to a 35 Ohm drop as full
    const limit = alarmThreshold > 0 && alarmThreshold < initialValue 
      ? alarmThreshold 
      : initialValue - 35;

    const totalSpan = initialValue - limit;
    if (totalSpan <= 0) return 0;

    const currentDrop = initialValue - currentValue;
    const percentage = (currentDrop / totalSpan) * 100;
    
    return Math.max(0, Math.min(100, percentage)); // Cap between 0 and 100%
  };

  const percentage = getFullnessPercentage();
  
  // Calculate bladder volume in ml (typical capacity ~500ml)
  const estimatedVolumeMl = Math.round((percentage / 100) * 500);

  // Dynamic fluid color based on filling level using HSL properties
  const getFluidColor = () => {
    if (percentage < 50) {
      return 'linear-gradient(180deg, hsl(176, 56%, 55%) 0%, hsl(176, 56%, 40%) 100%)'; // Cyan/Teal
    } else if (percentage < 80) {
      return 'linear-gradient(180deg, hsl(48, 100%, 62%) 0%, hsl(24, 100%, 63%) 100%)';   // Yellow to Orange
    } else {
      return 'linear-gradient(180deg, hsl(0, 100%, 71%) 0%, hsl(354, 100%, 55%) 100%)';    // Pulsing Red
    }
  };

  const getGlassBorderColor = () => {
    if (percentage > 80) return 'hsl(0, 100%, 71%)';
    if (percentage > 50) return 'hsl(24, 100%, 63%)';
    return 'hsl(var(--accent-cyan))';
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '320px', marginBottom: 0 }}>
      <div className="card-header" style={{ width: '100%', marginBottom: '20px' }}>
        <div>
          <h2>Monitoreo de Volumen Vesical</h2>
          <span className="card-subtitle">Estimación volumétrica basada en atenuación por impedancia</span>
        </div>
      </div>

      <div style={{ position: 'relative', width: '160px', height: '220px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        
        {/* Glassmorphic Beaker/Bladder Outer Container */}
        <div 
          style={{
            position: 'absolute',
            bottom: '20px',
            width: '130px',
            height: '180px',
            borderRadius: '50px 50px 35px 35px',
            border: `3px solid ${getGlassBorderColor()}`,
            background: 'rgba(255, 255, 255, 0.03)',
            boxShadow: 'inset 0 8px 32px rgba(255, 255, 255, 0.05), var(--shadow-md)',
            overflow: 'hidden',
            transition: 'border-color 0.5s ease'
          }}
        >
          {/* Inner Liquid Container */}
          <div 
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: `${percentage}%`,
              background: getFluidColor(),
              transition: 'height 0.8s cubic-bezier(0.25, 0.8, 0.25, 1), background 0.5s ease',
              overflow: 'hidden'
            }}
          >
            {/* Animated Liquid Wave Overlay 1 */}
            <div 
              style={{
                position: 'absolute',
                top: '-15px',
                left: '-100px',
                width: '350px',
                height: '35px',
                background: 'rgba(255, 255, 255, 0.2)',
                borderRadius: '45%',
                animation: 'waveMove 4.5s linear infinite'
              }}
            />
            {/* Animated Liquid Wave Overlay 2 */}
            <div 
              style={{
                position: 'absolute',
                top: '-18px',
                left: '-100px',
                width: '350px',
                height: '35px',
                background: 'rgba(255, 255, 255, 0.1)',
                borderRadius: '43%',
                animation: 'waveMoveInverse 6s linear infinite'
              }}
            />
          </div>
        </div>

        {/* Volume Metric Display centered in Beaker */}
        <div 
          style={{
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textShadow: '0 2px 8px rgba(0,0,0,0.5)',
            transform: 'translateY(-10px)'
          }}
        >
          <span 
            style={{ 
              fontSize: '34px', 
              fontWeight: 800, 
              color: '#ffffff',
              animation: percentage > 85 ? 'pulse 1s infinite' : 'none'
            }}
          >
            {percentage.toFixed(0)}%
          </span>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'rgba(255, 255, 255, 0.8)', textTransform: 'uppercase', letterSpacing: '1px' }}>
            {estimatedVolumeMl} ml
          </span>
          <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.6)', marginTop: '2px' }}>
            Vejiga Ext. Est.
          </span>
        </div>

      </div>

      {/* WAVE CSS STYLES INJECTED DYNAMICALLY */}
      <style>{`
        @keyframes waveMove {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes waveMoveInverse {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(-360deg); }
        }
      `}</style>
    </div>
  );
}
