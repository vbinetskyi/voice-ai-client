// AudioWorklet processor — runs in the audio rendering thread.
// Receives Float32 mic samples in [-1, 1] and converts them to
// Int16 LE (PCM16) before posting to the main thread for WebSocket send.
class MicProcessor extends AudioWorkletProcessor {
	process(inputs) {
		const channel = inputs[0]?.[0];
		if (!channel?.length) return true;
		const int16 = new Int16Array(channel.length);
		for (let i = 0; i < channel.length; i++) {
			// Clamp to [-1, 1] then scale to Int16 range.
			const s = Math.max(-1, Math.min(1, channel[i]));
			int16[i] = s < 0 ? s * 32768 : s * 32767;
		}
		// Transfer ownership of the buffer to avoid a copy.
		this.port.postMessage(int16.buffer, [int16.buffer]);
		return true;
	}
}

registerProcessor("mic-processor", MicProcessor);
