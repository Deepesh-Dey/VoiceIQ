/**
 * app.js  –  Main application controller
 *
 * Wires together: FileUpload · WS · VoiceInterface · AudioPlayer
 * and manages UI state transitions.
 *
 * State machine (voice):
 *   IDLE  → LISTENING (mic btn click)
 *   LISTENING → PROCESSING (VAD speech-end)
 *   PROCESSING → PLAYING (audio_start received)
 *   PLAYING → LISTENING (audio_done + playback finished)
 *   any → IDLE (mic btn click while active)
 */

const App = (() => {

  // ── App state ─────────────────────────────────────────────────────
  let _sessionId    = null;
  let _voiceActive  = false;     // mic loop running
  let _processing   = false;     // awaiting STT/LLM/TTS
  let _history      = [];        // text chat history

  // ── DOM refs ──────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  let _micBtn, _micIcon, _stopBtn, _endChatBtn, _vadStatus, _vadWave,
      _conversation, _convEmpty,
      _textInput, _sendBtn, _overlay, _overlayMsg, _voiceSelect;

  // ── Boot ──────────────────────────────────────────────────────────
  function _init() {
    _micBtn       = $('mic-btn');
    _micIcon      = $('mic-icon');
    _stopBtn      = $('stop-btn');
    _endChatBtn   = $('end-chat-btn');
    _vadStatus    = $('vad-status');
    _vadWave      = $('vad-wave');
    _conversation = $('conversation');
    _convEmpty    = $('conversation-empty');
    _textInput    = $('text-input');
    _sendBtn      = $('send-btn');
    _overlay      = $('overlay');
    _overlayMsg   = $('overlay-msg');
    _voiceSelect  = $('voice-select');

    FileUpload.init();
    _wireVoice();
    _wireWebSocket();
    _wireTextInput();
    _wireStopBtn();
    _wireEndChat();
    _initVoicePicker();

    // Start periodic WebSocket keepalive
    setInterval(() => { try { WS.ping(); } catch (_) {} }, 20_000);
  }

  // ── Voice picker ──────────────────────────────────────────────────
  function _initVoicePicker() {
    if (!_voiceSelect) return;

    function _populate() {
      const voices = speechSynthesis.getVoices();
      if (!voices.length) return;

      // Save current selection
      const prev = _voiceSelect.value;

      // Clear & re-populate
      _voiceSelect.innerHTML = '<option value="">Default voice</option>';

      // Separate English voices first, then the rest
      const en    = voices.filter(v => v.lang.startsWith('en'));
      const other = voices.filter(v => !v.lang.startsWith('en'));

      if (en.length) {
        const grp = document.createElement('optgroup');
        grp.label = 'English';
        en.forEach(v => {
          const opt = document.createElement('option');
          opt.value       = v.name;
          opt.textContent = `${v.name} (${v.lang})${v.localService ? '' : ' ☁'}`;
          grp.appendChild(opt);
        });
        _voiceSelect.appendChild(grp);
      }

      if (other.length) {
        const grp = document.createElement('optgroup');
        grp.label = 'Other languages';
        other.forEach(v => {
          const opt = document.createElement('option');
          opt.value       = v.name;
          opt.textContent = `${v.name} (${v.lang})`;
          grp.appendChild(opt);
        });
        _voiceSelect.appendChild(grp);
      }

      // Restore previous selection if still available
      if (prev && _voiceSelect.querySelector(`option[value="${CSS.escape(prev)}"]`)) {
        _voiceSelect.value = prev;
      }
    }

    // Chrome fires onvoiceschanged; Firefox populates synchronously
    speechSynthesis.addEventListener('voiceschanged', _populate);
    _populate(); // attempt immediate (works in Firefox)
  }

  // Return the currently selected SpeechSynthesisVoice (or null for default)
  function _getSelectedVoice() {
    if (!_voiceSelect || !_voiceSelect.value) return null;
    return speechSynthesis.getVoices().find(v => v.name === _voiceSelect.value) || null;
  }

  // ── Called by FileUpload when a file is successfully uploaded ─────
  function onFileUploaded(sessionId, filename) {
    _sessionId = sessionId;

    // Enable UI
    _micBtn.disabled    = false;
    _textInput.disabled = false;
    _sendBtn.disabled   = false;

    _vadStatus.textContent = 'Ready — click the mic to start talking';
    _setVadStatus('ready');
    _endChatBtn.disabled = false;

    // Connect WebSocket with the new session
    WS.connect(sessionId);

    _addBubble('assistant',
      `✅ "${filename}" loaded! Ask me anything about your data using your voice or the text box below.`);
  }

  // ── Voice Interface wiring ────────────────────────────────────────
  function _wireVoice() {
    VoiceInterface.onSpeechStart = () => {
      _setVadStatus('speaking');
    };

    VoiceInterface.onSpeechEnd = (blob) => {
      if (!_processing) {
        _setVadStatus('processing');
        _processing = true;
        WS.sendAudio(blob);
      }
    };

    VoiceInterface.onVolumeLevel = (level) => {
      // Animate wave bars height based on volume
      const spans = _vadWave.querySelectorAll('span');
      const base  = [8, 16, 22, 16, 8];
      spans.forEach((s, i) => {
        const h = Math.max(4, base[i] * (0.3 + level * 0.7));
        s.style.height = h + 'px';
      });
    };

    _micBtn.addEventListener('click', _toggleMic);
  }

  // ── End Chat button ───────────────────────────────────────────────
  function _wireEndChat() {
    _endChatBtn.addEventListener('click', _endChat);
  }

  // The END_CHAT_PHRASES list is checked against voice transcripts.
  const END_CHAT_PHRASES = [
    'end chat', 'end the chat', 'stop chat',
    'end conversation', 'stop conversation',
    'goodbye', 'good bye', 'bye bye', 'see you',
    'exit', 'quit', 'close chat',
  ];

  function _isEndChatCommand(text) {
    const lower = text.toLowerCase().trim();
    return END_CHAT_PHRASES.some(p => lower.includes(p));
  }

  function _endChat() {
    // 1. Stop everything in flight
    speechSynthesis.cancel();
    if (_voiceActive) {
      VoiceInterface.stop();
      _voiceActive = false;
    }
    WS.disconnect();

    // 2. Reset state
    _sessionId  = null;
    _processing = false;
    _history    = [];

    // 3. Clear conversation
    _conversation.innerHTML = '';
    _convEmpty.hidden = false;
    _conversation.appendChild(_convEmpty);

    // 4. Disable controls
    _micBtn.disabled    = true;
    _textInput.disabled = true;
    _sendBtn.disabled   = true;
    _endChatBtn.disabled = true;
    _stopBtn.hidden     = true;
    _setVadStatus('idle');

    // 5. Brief spoken farewell
    const bye = new SpeechSynthesisUtterance('Goodbye! Upload a new file to start a fresh session.');
    bye.lang = 'en-US';
    const selectedVoice = _getSelectedVoice();
    if (selectedVoice) bye.voice = selectedVoice;
    speechSynthesis.speak(bye);
  }

  // ── Stop speaking button ──────────────────────────────────────────
  function _wireStopBtn() {
    _stopBtn.addEventListener('click', () => {
      speechSynthesis.cancel();   // triggers utterance.onend automatically
    });
  }

  async function _toggleMic() {
    if (!_sessionId) return;

    if (_voiceActive) {
      // Stop
      VoiceInterface.stop();
      _voiceActive = false;
      _setVadStatus('idle');
    } else {
      // Start
      try {
        await VoiceInterface.start();
        _voiceActive = true;
        _setVadStatus('listening');
      } catch (err) {
        alert(err.message);
      }
    }
  }

  // ── WebSocket wiring ──────────────────────────────────────────────
  function _wireWebSocket() {
    WS.onReady = (hasData) => {
      console.log('[App] WS ready, hasData:', hasData);
    };

    WS.onTranscript = (text) => {
      // Voice command: end the chat session
      if (_isEndChatCommand(text)) {
        _endChat();
        return;
      }
      _addBubble('user', text);
      _showThinking();
    };

    WS.onReply = (text) => {
      _removeThinking();
      _addBubble('assistant', text);
      _history.push({ role: 'user',      content: _getLastUserText() });
      _history.push({ role: 'assistant', content: text });

      // ── Pause mic so the assistant doesn't hear itself ─────────────
      VoiceInterface.pause();

      // ── Browser Web Speech API (TTS) ──────────────────────────────
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate  = 1.0;
      utterance.pitch = 1.0;
      utterance.lang  = 'en-US';      const selectedVoice = _getSelectedVoice();
      if (selectedVoice) utterance.voice = selectedVoice;
      _setVadStatus('playing');

      const _onSpeechDone = () => {
        _processing = false;
        if (_voiceActive) {
          // Resume mic and go straight back to listening
          VoiceInterface.resume();
          _setVadStatus('listening');
        } else {
          _setVadStatus('ready');
        }
      };

      utterance.onend   = _onSpeechDone;
      utterance.onerror = (e) => {
        console.warn('[TTS] SpeechSynthesis error:', e.error);
        _onSpeechDone();
      };

      speechSynthesis.speak(utterance);
    };

    // audio_start / audio_chunk / audio_done are no longer used for voice replies
    // (TTS is handled entirely in the browser via SpeechSynthesis above).
    WS.onAudioStart = () => {};
    WS.onAudioChunk = () => {};
    WS.onAudioDone  = () => {};

    WS.onError = (msg) => {
      _removeThinking();
      _processing = false;
      _addBubble('assistant', `⚠️ ${msg}`);
      if (_voiceActive) _setVadStatus('listening');
    };

    WS.onClose = () => {
      console.warn('[App] WS closed');
    };
  }

  // ── Text input wiring ─────────────────────────────────────────────
  function _wireTextInput() {
    const _send = async () => {
      const text = _textInput.value.trim();
      if (!text || !_sessionId) return;
      _textInput.value = '';
      _textInput.disabled = true;
      _sendBtn.disabled   = true;

      _addBubble('user', text);
      _showThinking();

      try {
        const res = await fetch('http://localhost:8000/api/chat/', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: _sessionId,
            message:    text,
            history:    _history.slice(-10),
          }),
        });
        const data = await res.json();
        _removeThinking();

        if (!res.ok) {
          _addBubble('assistant', `⚠️ ${data.detail || 'Error from server.'}`);
        } else {
          _addBubble('assistant', data.reply);
          _history.push({ role: 'user',      content: text });
          _history.push({ role: 'assistant', content: data.reply });
        }
      } catch (err) {
        _removeThinking();
        _addBubble('assistant', `⚠️ Network error: ${err.message}`);
      } finally {
        _textInput.disabled = false;
        _sendBtn.disabled   = false;
        _textInput.focus();
      }
    };

    _sendBtn.addEventListener('click', _send);
    _textInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _send(); }
    });
  }

  // ── UI helpers ────────────────────────────────────────────────────
  function _setVadStatus(state) {
    const labels = {
      idle:       'Upload a file to start',
      ready:      'Ready — click the mic to start talking',
      listening:  '🎙 Listening…',
      speaking:   '🗣 Detected speech…',
      processing: '⏳ Processing…',
      playing:    '🔊 Speaking… (click ⏸ to interrupt)',
    };
    _vadStatus.textContent = labels[state] || '';

    _micBtn.classList.toggle('is-listening',  state === 'listening' || state === 'speaking');
    _micBtn.classList.toggle('is-processing', state === 'processing' || state === 'playing');
    _micIcon.textContent = (state === 'listening' || state === 'speaking') ? '⏹' : '🎙';

    // Show stop button only while the assistant is speaking
    _stopBtn.hidden = (state !== 'playing');

    _vadWave.classList.toggle('active', state === 'speaking');
  }

  function _addBubble(role, text) {
    _convEmpty.hidden = true;
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = role === 'user' ? 'flex-end' : 'flex-start';

    const label = document.createElement('div');
    label.className = 'bubble--label';
    label.textContent = role === 'user' ? 'You' : 'Assistant';

    const bubble = document.createElement('div');
    bubble.className = `bubble bubble--${role}`;
    bubble.textContent = text;

    wrap.appendChild(label);
    wrap.appendChild(bubble);
    _conversation.appendChild(wrap);
    _conversation.scrollTop = _conversation.scrollHeight;

    // Store last user text for history pairing
    if (role === 'user') _lastUserText = text;
  }

  let _thinkingEl = null;
  let _lastUserText = '';

  function _showThinking() {
    if (_thinkingEl) return;
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = 'flex-start';
    wrap.id = '__thinking';

    const label = document.createElement('div');
    label.className = 'bubble--label';
    label.textContent = 'Assistant';

    const bubble = document.createElement('div');
    bubble.className = 'bubble bubble--assistant bubble--thinking';
    bubble.innerHTML = '<span></span><span></span><span></span>';

    wrap.appendChild(label);
    wrap.appendChild(bubble);
    _conversation.appendChild(wrap);
    _conversation.scrollTop = _conversation.scrollHeight;
    _thinkingEl = wrap;
  }

  function _removeThinking() {
    if (_thinkingEl) {
      _thinkingEl.remove();
      _thinkingEl = null;
    }
  }

  function _getLastUserText() { return _lastUserText; }

  // ── Boot on DOM ready ─────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', _init);

  return { onFileUploaded };
})();
