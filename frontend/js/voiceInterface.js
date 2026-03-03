/**
 * voiceInterface.js
 *
 * Handles:
 *  - Microphone access (getUserMedia)
 *  - Voice Activity Detection (VAD) – client-side AnalyserNode RMS polling
 *  - Raw PCM capture via ScriptProcessorNode → encoded as 16-bit WAV Blob
 *    (WAV is universally accepted by Whisper / HuggingFace inference API)
 *
 * Why WAV instead of WebM/Opus from MediaRecorder?
 *   The HuggingFace Whisper inference endpoint requires PCM-compatible audio.
 *   WebM/Opus is a compressed container that causes 400 errors on the API.
 *   We capture raw Float32 PCM from Web Audio and encode it ourselves.
 *
 * VAD logic:
 *  1. Poll RMS energy every POLL_MS ms via AnalyserNode.
 *  2. RMS > SPEECH_THRESHOLD  → user is speaking, collect PCM samples.
 *  3. RMS < SPEECH_THRESHOLD for SILENCE_MS → end of utterance.
 *  4. If utterance >= MIN_SPEECH_MS → encode + fire onSpeechEnd(wavBlob).
 */

const VoiceInterface = (() => {

  // ── VAD configuration ─────────────────────────────────────────────
  const CFG = {
    SPEECH_THRESHOLD:  0.018,  // RMS level to classify as speech
    SILENCE_MS:        1500,   // ms of silence before speech is considered done
    MIN_SPEECH_MS:     300,    // discard utterances shorter than this
    POLL_MS:           30,     // RMS sampling interval (ms)
    SAMPLE_RATE:       16000,  // target sample rate sent to Whisper
  };

  // ── State ─────────────────────────────────────────────────────────
  let _stream        = null;
  let _audioCtx      = null;
  let _analyser      = null;
  let _scriptNode    = null;   // ScriptProcessorNode for raw PCM capture
  let _pollTimer     = null;

  let _speaking      = false;
  let _silenceStart  = null;
  let _speechStart   = null;
  let _active        = false;
  let _pcmSamples    = [];     // Float32 PCM collected during speech

  // ── Callbacks ─────────────────────────────────────────────────────
  let _onSpeechStart = () => {};
  let _onSpeechEnd   = () => {};   // receives WAV Blob
  let _onVolumeLevel = () => {};   // receives 0..1 float

  // ── Public: start ─────────────────────────────────────────────────
  async function start() {
    if (_active) return;
    _active = true;

    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
    } catch (err) {
      _active = false;
      throw new Error('Microphone access denied: ' + err.message);
    }

    _audioCtx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: CFG.SAMPLE_RATE,
    });

    // ── AnalyserNode for VAD RMS ──────────────────────────────────
    _analyser = _audioCtx.createAnalyser();
    _analyser.fftSize = 512;
    _analyser.smoothingTimeConstant = 0.5;

    // ── ScriptProcessorNode for raw PCM capture ───────────────────
    // bufferSize 4096 = ~256ms at 16kHz (low latency, no dropout)
    _scriptNode = _audioCtx.createScriptProcessor(4096, 1, 1);
    _scriptNode.onaudioprocess = (e) => {
      if (_speaking) {
        // Copy the channel data so it's not overwritten next frame
        _pcmSamples.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      }
    };

    const src = _audioCtx.createMediaStreamSource(_stream);
    src.connect(_analyser);
    src.connect(_scriptNode);
    _scriptNode.connect(_audioCtx.destination); // must be connected to run

    _speaking     = false;
    _silenceStart = null;
    _speechStart  = null;
    _pcmSamples   = [];

    _pollTimer = setInterval(_vadTick, CFG.POLL_MS);
  }

  // ── Public: stop ──────────────────────────────────────────────────
  function stop() {
    _active = false;
    clearInterval(_pollTimer);
    _pollTimer = null;

    if (_scriptNode) { _scriptNode.disconnect(); _scriptNode = null; }
    if (_stream)     { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
    if (_audioCtx)   { _audioCtx.close(); _audioCtx = null; }

    _speaking   = false;
    _pcmSamples = [];
  }

  // ── Public: pause ─────────────────────────────────────────────────
  // Freezes VAD polling without tearing down the mic stream.
  // Call this before the assistant starts speaking so it doesn't
  // accidentally pick up its own voice.
  function pause() {
    if (!_active) return;
    clearInterval(_pollTimer);
    _pollTimer    = null;
    _speaking     = false;
    _silenceStart = null;
    _pcmSamples   = [];   // discard any partial utterance captured so far
  }

  // ── Public: resume ────────────────────────────────────────────────
  // Restarts VAD polling after the assistant has finished speaking.
  function resume() {
    if (!_active || _pollTimer) return;  // not started or already polling
    _speaking     = false;
    _silenceStart = null;
    _speechStart  = null;
    _pcmSamples   = [];
    _pollTimer    = setInterval(_vadTick, CFG.POLL_MS);
  }

  // ── VAD tick ──────────────────────────────────────────────────────
  function _vadTick() {
    if (!_analyser) return;
    const rms = _getRMS();
    _onVolumeLevel(Math.min(rms / CFG.SPEECH_THRESHOLD, 1));

    const now = Date.now();

    if (rms > CFG.SPEECH_THRESHOLD) {
      _silenceStart = null;
      if (!_speaking) {
        _speaking    = true;
        _speechStart = now;
        _pcmSamples  = [];
        _onSpeechStart();
      }
    } else {
      if (_speaking) {
        if (_silenceStart === null) {
          _silenceStart = now;
        } else if (now - _silenceStart >= CFG.SILENCE_MS) {
          _speaking     = false;
          _silenceStart = null;
          const duration = _speechStart ? (now - _speechStart) : 0;

          if (duration >= CFG.MIN_SPEECH_MS && _pcmSamples.length > 0) {
            const wavBlob = _encodePCMasWAV(_pcmSamples, CFG.SAMPLE_RATE);
            _pcmSamples = [];
            _onSpeechEnd(wavBlob);
          } else {
            _pcmSamples = [];
          }
        }
      }
    }
  }

  // ── RMS helper ────────────────────────────────────────────────────
  function _getRMS() {
    const buf = new Float32Array(_analyser.fftSize);
    _analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  // ── WAV encoder ───────────────────────────────────────────────────
  // Takes an array of Float32Arrays (PCM chunks) and returns a WAV Blob.
  function _encodePCMasWAV(chunks, sampleRate) {
    // 1. Concatenate all Float32 chunks
    const totalSamples = chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    // 2. Convert Float32 [-1, 1] → Int16 PCM
    const int16 = new Int16Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      const s = Math.max(-1, Math.min(1, merged[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // 3. Build WAV container (44-byte header + PCM data)
    const dataBytes  = int16.byteLength;
    const buffer     = new ArrayBuffer(44 + dataBytes);
    const view       = new DataView(buffer);
    const numCh      = 1;
    const bitsPerSmp = 16;
    const byteRate   = sampleRate * numCh * (bitsPerSmp / 8);
    const blockAlign = numCh * (bitsPerSmp / 8);

    // RIFF chunk
    _writeStr(view, 0, 'RIFF');
    view.setUint32( 4, 36 + dataBytes, true);
    _writeStr(view, 8, 'WAVE');
    // fmt sub-chunk
    _writeStr(view, 12, 'fmt ');
    view.setUint32(16, 16,          true);  // sub-chunk size
    view.setUint16(20,  1,          true);  // PCM format
    view.setUint16(22, numCh,       true);
    view.setUint32(24, sampleRate,  true);
    view.setUint32(28, byteRate,    true);
    view.setUint16(32, blockAlign,  true);
    view.setUint16(34, bitsPerSmp,  true);
    // data sub-chunk
    _writeStr(view, 36, 'data');
    view.setUint32(40, dataBytes, true);
    // PCM payload
    new Uint8Array(buffer, 44).set(new Uint8Array(int16.buffer));

    return new Blob([buffer], { type: 'audio/wav' });
  }

  function _writeStr(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  return {
    start, stop, pause, resume,
    set onSpeechStart(fn) { _onSpeechStart = fn; },
    set onSpeechEnd(fn)   { _onSpeechEnd   = fn; },
    set onVolumeLevel(fn) { _onVolumeLevel = fn; },
  };
})();
