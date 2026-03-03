/**
 * websocket.js
 *
 * Manages the WebSocket connection to the FastAPI voice backend.
 *
 * Emitted events (callbacks set externally via WS.on*):
 *   onReady(hasData)          – session initialised
 *   onTranscript(text)        – STT result received
 *   onReply(text)             – LLM reply text received
 *   onAudioStart()            – TTS audio incoming
 *   onAudioDone()             – TTS audio stream done
 *   onAudioChunk(arrayBuffer) – binary TTS chunk
 *   onError(message)          – error from server
 *   onClose()                 – connection closed
 */

const WS = (() => {
  const BACKEND_WS = 'ws://localhost:8000/api/voice/ws';

  let _socket   = null;
  let _sessionId = null;

  // ── Callbacks (wired by app.js) ──────────────────────────────────
  let onReady      = () => {};
  let onTranscript = () => {};
  let onReply      = () => {};
  let onAudioStart = () => {};
  let onAudioDone  = () => {};
  let onAudioChunk = () => {};
  let onError      = () => {};
  let onClose      = () => {};

  // ── Connect ──────────────────────────────────────────────────────
  function connect(sessionId) {
    _sessionId = sessionId;

    if (_socket && (_socket.readyState === WebSocket.OPEN ||
                    _socket.readyState === WebSocket.CONNECTING)) {
      _socket.close();
    }

    _socket = new WebSocket(BACKEND_WS);
    _socket.binaryType = 'arraybuffer';

    _socket.onopen = () => {
      console.log('[WS] Connected');
      _send({ type: 'init', session_id: sessionId });
    };

    _socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // Binary frame = TTS audio chunk
        onAudioChunk(event.data);
        return;
      }
      // Text frame = JSON control message
      let msg;
      try { msg = JSON.parse(event.data); }
      catch { console.error('[WS] Bad JSON', event.data); return; }

      switch (msg.type) {
        case 'ready':      onReady(msg.has_data);    break;
        case 'transcript': onTranscript(msg.text);   break;
        case 'reply':      onReply(msg.text);         break;
        case 'audio_start':onAudioStart();            break;
        case 'audio_done': onAudioDone();             break;
        case 'pong':       /* heartbeat */            break;
        case 'error':      onError(msg.message);      break;
        default:
          console.warn('[WS] Unknown event type:', msg.type);
      }
    };

    _socket.onerror = (err) => {
      console.error('[WS] Error', err);
      onError('WebSocket connection error.');
    };

    _socket.onclose = (ev) => {
      console.log('[WS] Closed', ev.code, ev.reason);
      onClose();
    };
  }

  // ── Send audio (binary) ──────────────────────────────────────────
  function sendAudio(blob) {
    if (!_isOpen()) { console.warn('[WS] Not open – cannot send audio.'); return; }
    blob.arrayBuffer().then(buf => _socket.send(buf));
  }

  // ── Ping (keepalive) ─────────────────────────────────────────────
  function ping() {
    _send({ type: 'ping' });
  }

  // ── Helpers ──────────────────────────────────────────────────────
  function _send(obj) {
    if (_isOpen()) _socket.send(JSON.stringify(obj));
  }

  function _isOpen() {
    return _socket && _socket.readyState === WebSocket.OPEN;
  }

  function disconnect() {
    if (_socket) _socket.close();
  }

  return {
    connect, disconnect, sendAudio, ping,
    // Expose setters for callbacks
    set onReady(fn)      { onReady = fn; },
    set onTranscript(fn) { onTranscript = fn; },
    set onReply(fn)      { onReply = fn; },
    set onAudioStart(fn) { onAudioStart = fn; },
    set onAudioDone(fn)  { onAudioDone = fn; },
    set onAudioChunk(fn) { onAudioChunk = fn; },
    set onError(fn)      { onError = fn; },
    set onClose(fn)      { onClose = fn; },
  };
})();
