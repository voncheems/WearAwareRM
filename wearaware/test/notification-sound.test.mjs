import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationSound } from '../src/utils/notification-sound.js';

function fixture() {
  let time = 0, creations = 0;
  const tones = [];
  const context = {
    state: 'suspended', currentTime: 1, destination: {},
    async resume() { this.state = 'running'; },
    async close() { this.state = 'closed'; },
    createOscillator() {
      const tone = { frequency: { setValueAtTime() {} }, connect() {}, disconnect() {}, start() {}, stop() {} };
      tones.push(tone); return tone;
    },
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; },
  };
  const sound = createNotificationSound({ createContext: () => { creations++; return context; }, now: () => time });
  return { sound, context, tones, advance: () => { time += 2000; }, creations: () => creations };
}
test('audio waits for user-interaction unlock and reuses its context', async () => {
  const f = fixture(); assert.equal(f.sound.play('1'), false); assert.equal(f.creations(), 0);
  assert.equal(await f.sound.unlock(), true); assert.equal(await f.sound.unlock(), true); assert.equal(f.creations(), 1);
  assert.equal(f.sound.play('1'), true); assert.equal(f.tones.length, 2);
  for (const tone of f.tones) assert.equal(typeof tone.onended, 'function');
});
test('mute, repeated alerts and rapid bursts do not repeatedly chime', async () => {
  const f = fixture(); await f.sound.unlock();
  f.sound.setEnabled(false); assert.equal(f.sound.play('muted'), false);
  f.sound.setEnabled(true); assert.equal(f.sound.play('one'), true);
  assert.equal(f.sound.play('two'), false); f.advance();
  assert.equal(f.sound.play('one'), false); assert.equal(f.sound.play('three'), true);
  assert.equal(f.tones.length, 4);
});
test('unsupported or blocked browser audio fails safely', async () => {
  for (const createContext of [() => null, () => { throw new Error('Audio unavailable'); }, () => ({ state: 'suspended', resume: async () => { throw new Error('Autoplay blocked'); } })]) {
    const sound = createNotificationSound({ createContext });
    assert.equal(await sound.unlock(), false); assert.equal(sound.play('one'), false);
  }
});
test('cleanup closes audio and effect reactivation supports React development remounts', async () => {
  const f = fixture(); await f.sound.unlock(); f.sound.dispose();
  assert.equal(f.context.state, 'closed'); assert.equal(f.sound.play('one'), false); assert.equal(await f.sound.unlock(), false);
  f.context.state = 'suspended'; f.sound.activate(); assert.equal(await f.sound.unlock(), true);
});
