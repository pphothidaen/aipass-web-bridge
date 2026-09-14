// AiPASS Chat WebView - handles all DOM events and message passing with the extension host.
// This file is loaded by the webview in VS Code and tested with jsdom.
(function () {
  const vscode = acquireVsCodeApi();

  var input = document.getElementById('input');
  var sendButton = document.getElementById('send-btn');
  var history = document.getElementById('chat-history');
  var status = document.getElementById('status');
  var modelSelect = document.getElementById('model-select');
  var modelName = document.getElementById('model-name');
  var targetPathInput = document.getElementById('target-path');
  var browsePathBtn = document.getElementById('browse-path-btn');
  var pathLabelBtn = document.getElementById('path-label-btn');
  var resetPathBtn = document.getElementById('reset-path-btn');
  var modeSelect = document.getElementById('mode-select');
  var refreshModelsBtn = document.getElementById('refresh-models-btn');

  var currentMode = 'agent';
  var isRunning = false;

  function setRunningState(running) {
    isRunning = running;
    if (running) {
      sendButton.textContent = '⏹ Stop';
      sendButton.className = 'stop-button';
    } else {
      sendButton.textContent = '↵ Enter';
      sendButton.className = 'send-button';
    }
  }

  function triggerBrowseFolder() {
    vscode.postMessage({ type: 'browseTargetPath', currentPath: targetPathInput.value });
  }

  if (browsePathBtn) {
    browsePathBtn.addEventListener('click', triggerBrowseFolder);
  }

  if (pathLabelBtn) {
    pathLabelBtn.addEventListener('click', triggerBrowseFolder);
    pathLabelBtn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        triggerBrowseFolder();
      }
    });
  }

  if (resetPathBtn) {
    resetPathBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'resetTargetPath' });
    });
  }

  if (targetPathInput) {
    targetPathInput.addEventListener('change', function () {
      vscode.postMessage({ type: 'saveTargetPath', path: targetPathInput.value });
    });
    targetPathInput.addEventListener('blur', function () {
      vscode.postMessage({ type: 'saveTargetPath', path: targetPathInput.value });
    });
  }

  if (refreshModelsBtn) {
    refreshModelsBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'refreshModels' });
    });
  }

  if (sendButton) {
    sendButton.onclick = send;
  }

  if (input) {
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    });
  }

  function send() {
    if (isRunning) {
      vscode.postMessage({ type: 'cancelAgent' });
      status.textContent = 'กำลังยกเลิกการทำงาน...';
      setRunningState(false);
      return;
    }

    var text = input.value.trim();
    if (!text) return;

    vscode.postMessage({
      type: 'sendMessage',
      value: text,
      model: modelSelect.value,
      mode: currentMode,
      targetPath: targetPathInput.value.trim()
    });

    input.value = '';
    setRunningState(true);
    status.textContent = currentMode === 'agent' ? '⚡ Agent กำลังเริ่มทำงาน...' : 'กำลังรอคำตอบ...';
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (data.type === 'setModels') {
      renderModels(data.models || []);
    }
    if (data.type === 'initData' || data.type === 'setTargetPath') {
      var newPath = data.path || data.basePath;
      if (newPath) {
        targetPathInput.value = newPath;
      }
    }
  });

  function renderModels(models) {
    modelSelect.innerHTML = '';
    models.forEach(function (model) {
      var option = document.createElement('option');
      option.value = model.id;
      option.textContent = (model.name || model.id) + (model.provider ? ' · ' + model.provider : '');
      modelSelect.appendChild(option);
    });
  }

  vscode.postMessage({ type: 'webviewReady' });
})();
