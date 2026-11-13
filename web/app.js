/* app.js
 *
 * Browser front end for zxem.wasm: runs the 50Hz frame loop and draws the
 * framebuffer to a canvas, loads games (file picker, drag and drop, URL,
 * game library), and handles pause, fullscreen and save states. Input is in
 * input.js and sound in sound.js.
 */
import { createInput } from './input.js';
import { createSound } from './sound.js';
import { loadSetting, saveSetting } from './settings.js';

const FRAME_MS = 20;    // Spectrum runs at 50 frames a second
const MAX_CATCHUP = 4;  // frames to run at once after a stall (e.g. hidden tab)
const JOYSTICKS = ['keys', 'kempston', 'sinclair', 'cursor'];

const $ = (id) => document.getElementById(id);
const canvas = $('screen');
const machine = $('machine');
const statusEl = $('status');
const infoEl = $('info');
const ctx = canvas.getContext('2d');

function toBase64(bytes) {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(s);
}

function fromBase64(text) {
	return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

createZXEM().then(async (zx) => {
	if (!zx._zx_init()) {
		statusEl.textContent = 'Failed to start the emulator';
		return;
	}

	const w = zx._zx_fb_width();
	const h = zx._zx_fb_height();
	canvas.width = w;
	canvas.height = h;
	const image = ctx.createImageData(w, h);
	const fbPtr = zx._zx_framebuffer();

	const input = createInput(zx);
	const promptEl = $('soundprompt');
	if (matchMedia('(pointer: coarse)').matches) promptEl.innerHTML = '&#128264; Tap for sound';
	const sound = createSound(zx, $('sound'), promptEl, (msg) => { statusEl.textContent = msg; });

	// --- Screen size -------------------------------------------------------

	const touchEl = $('touch');
	const keysEl = $('zxkeys');

	// Largest whole-number scale that fits, so pixels stay square and crisp.
	// Below 1x (narrow phones) any scale will do.
	function fitCanvas() {
		const full = document.fullscreenElement === machine;
		const below = (touchEl.hidden ? 0 : touchEl.offsetHeight) +
			(keysEl.hidden ? 0 : keysEl.offsetHeight);
		const availW = full ? window.innerWidth : document.documentElement.clientWidth - 32;
		const availH = (full ? window.innerHeight : window.innerHeight - 140) - below;
		let scale = Math.min(availW / w, availH / h);
		scale = scale >= 1 ? Math.floor(scale) : Math.max(scale, availW / w * 0.5);
		canvas.style.width = Math.floor(w * scale) + 'px';
		canvas.style.height = Math.floor(h * scale) + 'px';
	}
	window.addEventListener('resize', fitCanvas);
	document.addEventListener('fullscreenchange', fitCanvas);

	// --- Controls ----------------------------------------------------------

	const joystickEl = $('joystick');
	function setJoystick(mode) {
		if (!JOYSTICKS.includes(mode)) return;
		joystickEl.value = mode;
		input.mode = mode;
	}
	setJoystick(loadSetting('zx-joystick', 'keys'));
	joystickEl.addEventListener('change', () => {
		input.mode = joystickEl.value;
		saveSetting('zx-joystick', joystickEl.value);
		input.focusSink();
	});

	// Touch d-pad and fire on touch screens, the Spectrum keyboard on request
	input.bindDpad($('dpad'));
	input.bindFire($('fire'));
	input.buildKeyboard(keysEl);
	touchEl.hidden = !matchMedia('(pointer: coarse)').matches;
	$('keyboard').addEventListener('click', (e) => {
		keysEl.hidden = !keysEl.hidden;
		e.currentTarget.setAttribute('aria-pressed', String(!keysEl.hidden));
		fitCanvas();
	});
	fitCanvas();

	$('reset').addEventListener('click', () => {
		input.releaseAll();
		zx._zx_reset();
		setPaused(false);
	});

	let paused = false;
	const overlay = $('overlay');
	function setPaused(p) {
		paused = p;
		overlay.hidden = !p;
		$('pause').textContent = p ? 'Resume' : 'Pause';
		if (p) input.releaseAll();
		resetClock();
	}
	$('pause').addEventListener('click', () => setPaused(!paused));
	overlay.addEventListener('click', () => setPaused(false));

	if (document.fullscreenEnabled) {
		$('fullscreen').addEventListener('click', () => {
			if (document.fullscreenElement) document.exitFullscreen();
			else machine.requestFullscreen().catch(() => {});
		});
	} else {
		$('fullscreen').hidden = true; // e.g. iPhone Safari
	}

	// --- Loading games -----------------------------------------------------

	// The game being played: its file name, and its library entry if any
	let current = { name: '', entry: null };

	function showInfo() {
		const e = current.entry;
		infoEl.textContent = e?.controls ? `Controls: ${e.controls}` : '';
		updateSaveButtons();
	}

	// Copy the file into WASM memory and hand it to the C loaders
	function loadGame(name, bytes, entry = null) {
		const ext = name.includes('.') ? name.split('.').pop() : '';
		const ptr = zx._malloc(bytes.length);
		zx.HEAPU8.set(bytes, ptr);
		input.releaseAll();
		const ok = zx.ccall('zx_load', 'number', ['number', 'number', 'string'],
			[ptr, bytes.length, ext]);
		zx._free(ptr);
		if (ok) {
			current = { name, entry };
			if (entry?.joystick) setJoystick(entry.joystick);
			statusEl.textContent = `Playing ${entry?.title ?? name}`;
		} else {
			statusEl.textContent = `Could not load ${name}: ${zx.UTF8ToString(zx._zx_load_error())}`;
		}
		showInfo();
		// The loaders may run many frames (tapes boot and type LOAD "");
		// don't try to catch up on that time, or play its sound
		sound.discard();
		setPaused(false);
		return ok;
	}

	// Same origin, or a server allowing CORS
	async function loadFromUrl(url, entry = null) {
		statusEl.textContent = `Fetching ${entry?.title ?? url}…`;
		try {
			const res = await fetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const name = new URL(url, location.href).pathname.split('/').pop();
			return loadGame(name, new Uint8Array(await res.arrayBuffer()), entry);
		} catch (err) {
			statusEl.textContent = `Could not fetch ${url}: ${err.message}`;
			return false;
		}
	}

	const fileEl = $('file');
	$('load').addEventListener('click', () => fileEl.click());
	fileEl.addEventListener('change', async () => {
		const file = fileEl.files[0];
		if (file) loadGame(file.name, new Uint8Array(await file.arrayBuffer()));
		fileEl.value = '';
		input.focusSink();
	});

	// Drag and drop anywhere on the page
	let dragDepth = 0;
	window.addEventListener('dragenter', (e) => {
		e.preventDefault();
		if (dragDepth++ === 0) document.body.classList.add('dragging');
	});
	window.addEventListener('dragleave', () => {
		if (--dragDepth === 0) document.body.classList.remove('dragging');
	});
	window.addEventListener('dragover', (e) => e.preventDefault());
	window.addEventListener('drop', async (e) => {
		e.preventDefault();
		dragDepth = 0;
		document.body.classList.remove('dragging');
		const file = e.dataTransfer.files[0];
		if (file) loadGame(file.name, new Uint8Array(await file.arrayBuffer()));
	});

	// --- Game library (games/manifest.json) --------------------------------

	// Returns the listed games, and the entry to start on page load if the
	// manifest names one with "start"
	async function loadLibrary() {
		let games = [];
		let start = null;
		try {
			const res = await fetch('games/manifest.json', { cache: 'no-cache' });
			if (res.ok) ({ games = [], start = null } = await res.json());
		} catch {
			// No library is fine: games can still be loaded from files
		}
		games = games.filter((g) => typeof g?.title === 'string' && typeof g?.file === 'string');

		const list = $('games');
		for (const g of games) {
			const card = document.createElement('button');
			card.type = 'button';
			card.className = 'game';
			const cover = document.createElement('div');
			cover.className = 'cover';
			if (typeof g.cover === 'string') {
				const img = document.createElement('img');
				img.src = 'games/' + g.cover;
				img.alt = '';
				img.loading = 'lazy';
				cover.append(img);
			}
			const title = document.createElement('div');
			title.className = 'title';
			title.textContent = g.title;
			const meta = document.createElement('div');
			meta.className = 'meta';
			meta.textContent = [g.author, g.year].filter(Boolean).join(' · ');
			card.append(cover, title, meta);
			card.addEventListener('click', async () => {
				const url = 'games/' + g.file;
				if (await loadFromUrl(url, g)) {
					history.replaceState(null, '', '?game=' + encodeURIComponent(url));
					window.scrollTo({ top: 0, behavior: 'smooth' });
				}
			});
			list.append(card);
		}
		$('library').hidden = games.length === 0;
		return { games, start: games.find((g) => g.file === start) ?? null };
	}

	// --- Save states -------------------------------------------------------

	// One save per game, kept in this browser
	const stateKey = () => 'zx-state:' + (current.name || 'basic');

	function updateSaveButtons() {
		$('restore').disabled = loadSetting(stateKey(), null) === null;
	}

	$('save').addEventListener('click', () => {
		const n = zx._zx_save_state();
		const ptr = zx._zx_state_buffer();
		const state = {
			z80: toBase64(zx.HEAPU8.subarray(ptr, ptr + n)),
			tape: zx._zx_tape_pos(),
			saved: new Date().toISOString(),
		};
		statusEl.textContent = saveSetting(stateKey(), JSON.stringify(state))
			? 'State saved in this browser'
			: 'Could not save: browser storage is full or blocked';
		updateSaveButtons();
	});

	$('restore').addEventListener('click', () => {
		let state;
		try {
			state = JSON.parse(loadSetting(stateKey(), 'null'));
		} catch {
			state = null;
		}
		if (!state?.z80) return;
		const bytes = fromBase64(state.z80);
		const ptr = zx._malloc(bytes.length);
		zx.HEAPU8.set(bytes, ptr);
		input.releaseAll();
		const ok = zx._zx_restore_state(ptr, bytes.length);
		zx._free(ptr);
		if (ok) zx._zx_set_tape_pos(state.tape ?? 0);
		statusEl.textContent = ok
			? `State from ${new Date(state.saved).toLocaleString()} restored`
			: `Could not restore: ${zx.UTF8ToString(zx._zx_load_error())}`;
		sound.discard();
		setPaused(false);
	});

	// --- Frame loop --------------------------------------------------------

	// Frame timing runs off the audio clock while sound plays, otherwise off
	// performance.now(); restart the count whenever the clock changes
	let clockAudio = false;
	let last = sound.clock();
	let acc = 0;
	function resetClock() {
		last = sound.clock();
		acc = 0;
	}

	function tick() {
		if (sound.running() !== clockAudio) {
			clockAudio = !clockAudio;
			resetClock();
		}
		input.poll();
		const now = sound.clock();
		acc += now - last;
		last = now;
		let frames = paused ? 0 : Math.floor(acc / FRAME_MS);
		acc = paused ? 0 : acc - frames * FRAME_MS;
		if (frames > MAX_CATCHUP) frames = MAX_CATCHUP;
		if (frames > 0) {
			for (let i = 0; i < frames; i++) zx._zx_run_frame();
			image.data.set(zx.HEAPU8.subarray(fbPtr, fbPtr + w * h * 4));
			ctx.putImageData(image, 0, 0);
			sound.send();
		}
		requestAnimationFrame(tick);
	}

	statusEl.textContent = 'Ready. Type on your keyboard, or load a game.';
	updateSaveButtons();
	input.focusSink();
	requestAnimationFrame(tick);

	// ?game=<url> loads a game on start, with its library details if listed.
	// Otherwise the library's start entry (e.g. a demo) runs, if it has one.
	const { games, start } = await loadLibrary();
	const game = new URLSearchParams(location.search).get('game');
	if (game) loadFromUrl(game, games.find((g) => 'games/' + g.file === game) ?? null);
	else if (start) loadFromUrl('games/' + start.file, start);
});
