export const LOCAL_ALERT_EVENT = 'wearaware:local-alert';
export const ALERT_TYPES = Object.freeze({
  COMPLIANT: 'compliant',
  NON_COMPLIANT: 'non_compliant',
  MANUAL_REVIEW: 'manual_review',
});

let audioContext;

function context() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  audioContext ||= new AudioContext();
  return audioContext;
}

export async function unlockLocalAlerts() {
  const audio = context();
  if (audio?.state === 'suspended') await audio.resume();
  return audio?.state === 'running';
}

function tone(audio, frequency, start, duration, volume = 0.12) {
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain); gain.connect(audio.destination);
  oscillator.start(start); oscillator.stop(start + duration + 0.02);
}

export async function emitLocalAlert(detail, soundEnabled) {
  window.dispatchEvent(new CustomEvent(LOCAL_ALERT_EVENT, { detail }));
  if (!soundEnabled) return false;
  const unlocked = await unlockLocalAlerts().catch(() => false);
  if (!unlocked) return false;
  const now = audioContext.currentTime;
  if (detail.alertType === ALERT_TYPES.COMPLIANT) {
    tone(audioContext, 660, now, 0.12); tone(audioContext, 880, now + 0.14, 0.2);
  } else if (detail.alertType === ALERT_TYPES.NON_COMPLIANT) {
    tone(audioContext, 240, now, 0.22, 0.16); tone(audioContext, 190, now + 0.26, 0.3, 0.16);
  } else {
    tone(audioContext, 440, now, 0.14, 0.13); tone(audioContext, 440, now + 0.22, 0.14, 0.13); tone(audioContext, 520, now + 0.44, 0.2, 0.13);
  }
  return true;
}
