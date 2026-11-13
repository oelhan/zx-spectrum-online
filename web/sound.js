/* sound.js
 *
 * Sound. Each frame's samples go to an AudioWorklet (beeper.js). The audio
 * is set up as soon as the page loads, but most browsers keep it silent
 * until the visitor clicks, taps or presses a key. Until then the page
 * says so (the prompt over the screen, and the Sound button), and the
 * first interaction starts it. While it plays, the audio clock paces the
 * emulator (see clock()), so sound and emulation can't drift apart.
 */
import { loadSetting, saveSetting } from './settings.js';

const PREBUFFER_MS = 60; // sound queued before playback starts, absorbs jitter

export function createSound(zx, button, prompt, showError) {
	let on = loadSetting('zx-sound', 'on') === 'on';
	let audio = null;    // { ctx, node } once set up
	let starting = null; // the set-up in progress

	function running() {
		return audio !== null && on && audio.ctx.state === 'running';
	}

	// Waiting for the browser to allow sound
	function blocked() {
		return on && !running();
	}

	function render() {
		button.textContent = !on ? 'Sound: off' : blocked() ? 'Sound: click to start' : 'Sound: on';
		button.setAttribute('aria-pressed', String(running()));
		prompt.hidden = !blocked();
	}

	// Match the audio to the on/off setting
	function apply() {
		if (audio) {
			if (on) {
				audio.ctx.resume().catch(() => {}); // waits for a gesture if blocked
				zx._zx_audio_init(audio.ctx.sampleRate);
			} else {
				audio.ctx.suspend();
				zx._zx_audio_init(0);
			}
		}
		render();
	}

	function start() {
		starting ??= (async () => {
			try {
				// Created before the first await, so a gesture that started
				// this still counts
				const actx = new AudioContext({ latencyHint: 'interactive' });
				actx.addEventListener('statechange', render);
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
			}
		})();
		return starting;
	}

	// Any click, tap or key press lets blocked sound start. On touch screens
	// only the end of a tap counts, hence pointerup too.
	function gesture() {
		if (!on) return;
		if (!audio) start();
		else if (audio.ctx.state !== 'running') audio.ctx.resume().catch(() => {});
	}
	window.addEventListener('pointerdown', gesture, true);
	window.addEventListener('pointerup', gesture, true);
	window.addEventListener('keydown', gesture, true);

	// While sound is blocked, the button only starts it. The gesture
	// listeners above run first and resume the audio asynchronously, so note
	// whether it was blocked when the press began, not when the click lands.
	let pressedWhileBlocked = false;
	button.addEventListener('pointerdown', () => { pressedWhileBlocked = blocked(); });
	button.addEventListener('click', () => {
		const wasBlocked = pressedWhileBlocked || blocked();
		pressedWhileBlocked = false;
		if (wasBlocked) return; // the gesture is already starting it
		on = !on;
		saveSetting('zx-sound', on ? 'on' : 'off');
		if (on && !audio) start();
		apply();
	});

	// Set up straight away. Where the browser allows sound without a click
	// it plays at once; otherwise the prompt shows. Firefox can say ahead of
	// time, which avoids a console warning.
	const policy = navigator.getAutoplayPolicy?.('audiocontext');
	if (on && policy !== 'disallowed') start();
	render();

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
