/* sound.js
 *
 * Beeper sound. Each frame's samples go to an AudioWorklet (beeper.js).
 * Browsers only allow audio to start from a click or key press, so it
 * starts on the first one. While it plays, the audio clock paces the
 * emulator (see clock()), so sound and emulation can't drift apart.
 */
import { loadSetting, saveSetting } from './settings.js';

const PREBUFFER_MS = 60; // sound queued before playback starts, absorbs jitter

export function createSound(zx, button, showError) {
	let on = loadSetting('zx-sound', 'on') === 'on';
	let audio = null; // { ctx, node } once started
	let starting = false;

	function running() {
		return audio !== null && on && audio.ctx.state === 'running';
	}

	function apply() {
		button.textContent = on ? 'Sound: on' : 'Sound: off';
		button.setAttribute('aria-pressed', String(on));
		if (!audio) return;
		if (on) {
			audio.ctx.resume();
			zx._zx_audio_init(audio.ctx.sampleRate);
		} else {
			audio.ctx.suspend();
			zx._zx_audio_init(0);
		}
	}

	async function start() {
		if (audio || starting || !on) return;
		starting = true;
		try {
			// Created before the first await, while the gesture still counts
			const actx = new AudioContext({ latencyHint: 'interactive' });
			await actx.audioWorklet.addModule('beeper.js');
			const node = new AudioWorkletNode(actx, 'beeper', {
				numberOfInputs: 0,
				outputChannelCount: [1],
				processorOptions: {
					prebuffer: Math.round(actx.sampleRate * PREBUFFER_MS / 1000),
					capacity: Math.round(actx.sampleRate / 4),
				},
			});
			node.connect(actx.destination);
			audio = { ctx: actx, node };
			apply();
		} catch (err) {
			showError(`No sound: ${err.message}`);
		} finally {
			starting = false;
		}
	}

	function gesture() {
		if (!audio) start();
		else if (on && audio.ctx.state !== 'running') audio.ctx.resume();
	}
	// On touch screens only the end of a tap counts as a gesture
	window.addEventListener('pointerdown', gesture, true);
	window.addEventListener('pointerup', gesture, true);
	window.addEventListener('keydown', gesture, true);

	button.addEventListener('click', () => {
		on = !on;
		saveSetting('zx-sound', on ? 'on' : 'off');
		if (audio) apply();
		else start();
	});
	apply();

	return {
		running,

		// Milliseconds on the audio clock while sound plays, else wall clock
		clock() {
			return running() ? audio.ctx.currentTime * 1000 : performance.now();
		},

		// Hand the samples from the frames just run to the worklet
		send() {
			const n = zx._zx_audio_take();
			if (!n || !running()) return;
			const ptr = zx._zx_audio_buffer();
			const samples = new Float32Array(zx.HEAPU8.buffer, ptr, n).slice();
			audio.node.port.postMessage(samples, [samples.buffer]);
		},

		// Throw away samples made without real-time playback (e.g. loading)
		discard() {
			zx._zx_audio_take();
		},
	};
}
