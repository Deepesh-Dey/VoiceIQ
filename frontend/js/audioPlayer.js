/**
 * audioPlayer.js
 *
 * Plays raw audio bytes (WAV) received from the WebSocket TTS channel.
 * Uses the Web Audio API for gapless, low-latency playback.
 */

const AudioPlayer = (() => {
  let _audioCtx = null;
  let _onDoneCallback = null;

  function _getCtx() {
    if (!_audioCtx || _audioCtx.state === 'closed') {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume if suspended (browser autoplay policy)
    if (_audioCtx.state === 'suspended') {
      _audioCtx.resume();
    }
    return _audioCtx;
  }

  /**
   * Play raw audio bytes (WAV / any format decodeable by the browser).
   * @param {ArrayBuffer} arrayBuffer - The audio data.
   * @param {Function}    onDone      - Called when playback finishes.
   */
  async function play(arrayBuffer, onDone) {
    const ctx = _getCtx();
    try {
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => {
        if (typeof onDone === 'function') onDone();
      };
      source.start(0);
    } catch (err) {
      console.error('[AudioPlayer] Decode/play error:', err);
      if (typeof onDone === 'function') onDone(); // always unblock the pipeline
    }
  }

  /**
   * Accumulate binary ArrayBuffer chunks (for streaming),
   * then play once finalized.
   */
  const _chunks = [];
  let   _streaming = false;

  function startStream() {
    _chunks.length = 0;
    _streaming = true;
  }

  function pushChunk(arrayBuffer) {
    if (_streaming) _chunks.push(new Uint8Array(arrayBuffer));
  }

  async function endStream(onDone) {
    _streaming = false;
    if (_chunks.length === 0) {
      if (typeof onDone === 'function') onDone();
      return;
    }
    // Concatenate all chunks into one ArrayBuffer
    const totalLen = _chunks.reduce((s, c) => s + c.length, 0);
    const merged   = new Uint8Array(totalLen);
    let   offset   = 0;
    for (const chunk of _chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    _chunks.length = 0;
    await play(merged.buffer, onDone);
  }

  return { play, startStream, pushChunk, endStream };
})();
