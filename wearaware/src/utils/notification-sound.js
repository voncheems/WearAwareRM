// Synthesized locally: no audio downloads, microphone access or new dependencies.
export function createNotificationSound({ createContext = () => {
  const Audio = window.AudioContext || window.webkitAudioContext;
  return Audio ? new Audio() : null;
}, now = () => Date.now() } = {}) {
  let context = null;
  let enabled = true;
  let disposed = false;
  let lastPlayed = -Infinity;
  const seen = new Set();
  return {
    activate() { disposed = false; },
    setEnabled(value) { enabled = Boolean(value); },
    async unlock() {
      if (!enabled || disposed) return false;
      try {
        context ||= createContext();
        if (!context) return false;
        const activeContext = context;
        if (activeContext.state === 'suspended') await activeContext.resume();
        return !disposed && context === activeContext && activeContext.state === 'running';
      } catch { return false; } // Browser audio restrictions must not interrupt alerts.
    },
    play(eventId) {
      if (disposed || !enabled || !context || context.state !== 'running') return false;
      if (eventId != null) {
        if (seen.has(eventId)) return false;
        seen.add(eventId);
        if (seen.size > 100) seen.delete(seen.values().next().value);
      }
      if (now() - lastPlayed < 1500) return false;
      try {
        const start = context.currentTime;
        [740, 988].forEach((frequency, index) => {
          const tone = context.createOscillator();
          const volume = context.createGain();
          const at = start + index * .18;
          tone.type = 'sine';
          tone.frequency.setValueAtTime(frequency, at);
          volume.gain.setValueAtTime(0, at);
          volume.gain.linearRampToValueAtTime(.12, at + .015);
          volume.gain.exponentialRampToValueAtTime(.001, at + .28);
          tone.connect(volume); volume.connect(context.destination);
          tone.onended = () => { tone.disconnect(); volume.disconnect(); };
          tone.start(at); tone.stop(at + .3);
        });
        lastPlayed = now();
        return true;
      } catch { return false; }
    },
    dispose() {
      disposed = true;
      seen.clear();
      if (context && context.state !== 'closed') context.close().catch(() => {});
      context = null;
    },
  };
}
