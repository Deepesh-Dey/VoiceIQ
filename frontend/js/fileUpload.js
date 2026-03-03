/**
 * fileUpload.js
 *
 * Handles drag-and-drop / file-input upload of business data files.
 * POSTs to the FastAPI /api/upload endpoint and renders the preview table.
 * On success, calls App.onFileUploaded(sessionId) to unlock the voice UI.
 */

const FileUpload = (() => {
  // Auto-detect: localhost dev → port 8000, production → same origin
  const _fh = window.location.hostname;
  const API_UPLOAD = ((_fh === 'localhost' || _fh === '127.0.0.1') ? 'http://localhost:8000' : '') + '/api/upload/';

  // DOM refs (initialised in init())
  let _dropZone, _fileInput, _uploadStatus, _uploadIcon,
      _uploadFilename, _uploadMeta, _previewWrapper, _previewBadge,
      _previewThead, _previewTbody, _overlay, _overlayMsg;

  function init() {
    _dropZone       = document.getElementById('drop-zone');
    _fileInput      = document.getElementById('file-input');
    _uploadStatus   = document.getElementById('upload-status');
    _uploadIcon     = document.getElementById('upload-icon');
    _uploadFilename = document.getElementById('upload-filename');
    _uploadMeta     = document.getElementById('upload-meta');
    _previewWrapper = document.getElementById('preview-wrapper');
    _previewBadge   = document.getElementById('preview-badge');
    _previewThead   = document.getElementById('preview-thead');
    _previewTbody   = document.getElementById('preview-tbody');
    _overlay        = document.getElementById('overlay');
    _overlayMsg     = document.getElementById('overlay-msg');

    // ── Drag & Drop ────────────────────────────────────────────────
    _dropZone.addEventListener('dragover',  e => { e.preventDefault(); _dropZone.classList.add('is-over'); });
    _dropZone.addEventListener('dragleave', ()   => _dropZone.classList.remove('is-over'));
    _dropZone.addEventListener('drop',      e => {
      e.preventDefault();
      _dropZone.classList.remove('is-over');
      const file = e.dataTransfer.files[0];
      if (file) _upload(file);
    });

    // ── File input (click) ─────────────────────────────────────────
    // The <input> sits over drop zone via position:absolute, opacity:0
    _fileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) _upload(file);
      _fileInput.value = ''; // reset so same file can be re-uploaded
    });

    // ── Keyboard accessibility on drop zone ────────────────────────
    _dropZone.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') _fileInput.click();
    });
  }

  // ── Upload ─────────────────────────────────────────────────────────
  async function _upload(file) {
    _showOverlay(`Uploading & parsing "${file.name}"…`);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(API_UPLOAD, { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        _hideOverlay();
        alert(`Upload failed: ${data.detail || res.statusText}`);
        return;
      }

      _renderStatus(data);
      _renderPreview(data);
      _hideOverlay();

      // Notify app
      if (typeof App !== 'undefined') {
        App.onFileUploaded(data.session_id, data.filename);
      }

    } catch (err) {
      _hideOverlay();
      alert(`Network error: ${err.message}`);
    }
  }

  // ── Render upload status badge ─────────────────────────────────────
  function _renderStatus(data) {
    _uploadIcon.textContent    = '✅';
    _uploadFilename.textContent = data.filename;
    _uploadMeta.textContent    = `${data.rows.toLocaleString()} rows · ${data.columns.length} columns`;
    _uploadStatus.hidden = false;
  }

  // ── Render preview table ───────────────────────────────────────────
  function _renderPreview(data) {
    // Header
    _previewThead.innerHTML = '<tr>' +
      data.columns.map(c => `<th>${_esc(c)}</th>`).join('') + '</tr>';

    // Rows
    _previewTbody.innerHTML = data.preview.map(row =>
      '<tr>' + data.columns.map(c => `<td>${_esc(row[c] ?? '')}</td>`).join('') + '</tr>'
    ).join('');

    _previewBadge.textContent = `${data.rows.toLocaleString()} rows`;
    _previewWrapper.hidden = false;
  }

  // ── Helpers ───────────────────────────────────────────────────────
  function _showOverlay(msg) {
    _overlayMsg.textContent = msg;
    _overlay.hidden = false;
  }
  function _hideOverlay() { _overlay.hidden = true; }

  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  return { init };
})();
