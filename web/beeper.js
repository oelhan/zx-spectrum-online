/* beeper.js
 *
 * AudioWorklet that plays the beeper samples app.js posts after each
 * frame. Samples queue in a ring buffer; playback waits until `prebuffer`
 * samples are queued so small timing jitter doesn't cause gaps, and waits
 * again after running dry.
 */
'use strict';

class Beeper extends AudioWorkletProcessor {
	constructor(options) {
		super();
		const { prebuffer, capacity } = options.processorOptions;
		this.prebuffer = prebuffer;
		this.ring = new Float32Array(capacity);
		this.read = 0;
		this.size = 0;
		this.playing = false;
		this.last = 0;
		this.port.onmessage = (e) => this.push(e.data);
	}

	push(samples) {
		const cap = this.ring.length;
		// Too far behind: drop the oldest samples rather than build up latency
		const over = this.size + samples.length - cap;
		if (over > 0) {
			this.read = (this.read + over) % cap;
			this.size -= over;
		}
		let write = (this.read + this.size) % cap;
		for (let i = 0; i < samples.length; i++) {
			this.ring[write] = samples[i];
			write = write + 1 === cap ? 0 : write + 1;
		}
		this.size += samples.length;
	}

	process(inputs, outputs) {
		const out = outputs[0][0];
		const cap = this.ring.length;
		if (!this.playing && this.size >= this.prebuffer) this.playing = true;
		for (let i = 0; i < out.length; i++) {
			if (this.playing && this.size > 0) {
				this.last = this.ring[this.read];
				this.read = this.read + 1 === cap ? 0 : this.read + 1;
				this.size--;
			} else {
				// Ran dry: fade out instead of clicking, then refill first
				this.playing = false;
				this.last *= 0.99;
			}
			out[i] = this.last;
		}
		return true;
	}
}

registerProcessor('beeper', Beeper);
