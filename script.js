// DOM Elements
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const downloadBtn = document.getElementById("downloadBtn");
const playback = document.getElementById("playback");
const volumeBar = document.getElementById("volumeBar");
const volumeLevel = document.getElementById("volumeLevel");
const timerEl = document.getElementById("timer");
const statusEl = document.getElementById("status");
const statusIndicator = document.getElementById("statusIndicator");
const gainControl = document.getElementById("gainControl");
const gainValue = document.getElementById("gainValue");
const loopbackToggle = document.getElementById("loopbackToggle");
const noiseToggle = document.getElementById("noiseSuppressionToggle");
const micSelect = document.getElementById("micSelect");

// Audio Variables
let mediaStream = null;
let audioContext = null;
let analyser = null;
let gainNode = null;
let source = null;
let recorder = null;
let dataChunks = [];
let recordingStartTime = 0;
let recordingTimer = null;
let selectedDeviceId = null;
const volumeHistory = new Array(60).fill(0);

// Canvas Elements
const waveformCanvas = document.getElementById("waveform");
const spectrumCanvas = document.getElementById("spectrum");
const wfCtx = waveformCanvas.getContext("2d");
const spCtx = spectrumCanvas.getContext("2d");

// Initialize microphone list (without requesting permission)
async function populateMicrophoneList() {
  try {
    // Try to enumerate devices directly (won't work without permission in most browsers)
    const devices = await navigator.mediaDevices.enumerateDevices();
    micSelect.innerHTML = "";
    const mics = devices.filter((d) => d.kind === "audioinput");

    if (mics.length === 0) {
      micSelect.innerHTML = '<option value="">No microphones found</option>';
      return;
    }

    mics.forEach((mic, index) => {
      const option = document.createElement("option");
      option.value = mic.deviceId;
      option.textContent = mic.label || `Microphone ${index + 1}`;
      micSelect.appendChild(option);
    });

    selectedDeviceId = mics[0].deviceId;
    micSelect.value = selectedDeviceId;
  } catch (err) {
    console.error("Error enumerating devices:", err);
    micSelect.innerHTML =
      '<option value="">Microphone list unavailable</option>';
  }
}

// Set canvas dimensions
function resizeCanvases() {
  waveformCanvas.width = waveformCanvas.offsetWidth * window.devicePixelRatio;
  waveformCanvas.height = waveformCanvas.offsetHeight * window.devicePixelRatio;
  spectrumCanvas.width = spectrumCanvas.offsetWidth * window.devicePixelRatio;
  spectrumCanvas.height = spectrumCanvas.offsetHeight * window.devicePixelRatio;

  wfCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
  spCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

// Visualizer drawing
function drawVisualizer() {
  if (!analyser) return;

  const bufferLength = analyser.frequencyBinCount;
  const waveformData = new Uint8Array(bufferLength);
  const spectrumData = new Uint8Array(bufferLength);

  analyser.getByteTimeDomainData(waveformData);
  analyser.getByteFrequencyData(spectrumData);

  // Calculate volume
  const volume = Math.max(...spectrumData) / 255;
  volumeHistory.shift();
  volumeHistory.push(volume);
  const avgVolume =
    volumeHistory.reduce((a, b) => a + b, 0) / volumeHistory.length;

  // Update volume display
  const volumePercent = Math.round(avgVolume * 100);
  volumeBar.style.width = `${volumePercent}%`;
  volumeLevel.textContent = `${volumePercent}%`;

  // Clear canvases
  wfCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
  spCtx.clearRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);

  // Draw waveform
  wfCtx.beginPath();
  wfCtx.lineWidth = 2;
  wfCtx.strokeStyle = "#393E46";

  const sliceWidth =
    waveformCanvas.width / bufferLength / window.devicePixelRatio;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {
    const v = waveformData[i] / 128.0;
    const y = (v * waveformCanvas.height) / window.devicePixelRatio / 2;

    if (i === 0) {
      wfCtx.moveTo(x, y);
    } else {
      wfCtx.lineTo(x, y);
    }

    x += sliceWidth;
  }

  wfCtx.lineTo(
    waveformCanvas.width / window.devicePixelRatio,
    waveformCanvas.height / window.devicePixelRatio / 2
  );
  wfCtx.stroke();

  // Draw spectrum
  const barWidth =
    (spectrumCanvas.width / bufferLength / window.devicePixelRatio) * 2.5;
  let barX = 0;

  for (let i = 0; i < bufferLength; i++) {
    const barHeight =
      (spectrumData[i] / 255) *
      (spectrumCanvas.height / window.devicePixelRatio);

    const gradient = spCtx.createLinearGradient(
      0,
      spectrumCanvas.height / window.devicePixelRatio - barHeight,
      0,
      spectrumCanvas.height / window.devicePixelRatio
    );
    gradient.addColorStop(0, "#948979");
    gradient.addColorStop(1, "#393E46");

    spCtx.fillStyle = gradient;
    spCtx.fillRect(
      barX,
      spectrumCanvas.height / window.devicePixelRatio - barHeight,
      barWidth,
      barHeight
    );

    barX += barWidth + 1;
  }

  requestAnimationFrame(drawVisualizer);
}

// Update timer display
function updateTimer() {
  const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
  const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const secs = String(elapsed % 60).padStart(2, "0");
  timerEl.textContent = `${mins}:${secs}`;
}

// Start recording - now with proper permission request
startBtn.onclick = async () => {
  try {
    // UI Feedback while connecting
    startBtn.disabled = true;
    startBtn.innerHTML =
      '<span class="spinner-border spinner-border-sm me-2" role="status"></span>Connecting...';
    statusEl.textContent = "Connecting...";
    statusIndicator.className = "status-indicator blinking";

    const constraints = {
      audio: {
        deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
        noiseSuppression: noiseToggle.checked,
        autoGainControl: false,
        echoCancellation: false,
      },
    };

    // REQUEST MICROPHONE ACCESS HERE - only when user clicks
    mediaStream = await navigator.mediaDevices
      .getUserMedia(constraints)
      .catch((err) => {
        throw err;
      });

    // Now that we have permission, refresh microphone list with labels
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter((d) => d.kind === "audioinput");
    if (mics.length > 0) {
      micSelect.innerHTML = "";
      mics.forEach((mic, index) => {
        const option = document.createElement("option");
        option.value = mic.deviceId;
        option.textContent = mic.label || `Microphone ${index + 1}`;
        micSelect.appendChild(option);
      });
      selectedDeviceId = mediaStream.getAudioTracks()[0].getSettings().deviceId;
      micSelect.value = selectedDeviceId;
    }

    // Initialize audio context
    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // Create audio nodes
    source = audioContext.createMediaStreamSource(mediaStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    gainNode = audioContext.createGain();
    gainNode.gain.value = parseFloat(gainControl.value);

    // Connect nodes
    source.connect(gainNode);
    gainNode.connect(analyser);

    if (loopbackToggle.checked) {
      analyser.connect(audioContext.destination);
    }

    // Set up recording
    const dest = audioContext.createMediaStreamDestination();
    analyser.connect(dest);

    recorder = new MediaRecorder(dest.stream);
    dataChunks = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        dataChunks.push(e.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(dataChunks, { type: "audio/webm" });
      const audioURL = URL.createObjectURL(blob);
      playback.src = audioURL;
      playback.hidden = false;
      downloadBtn.disabled = false;
    };

    // Start recording
    recorder.start(100); // Collect data every 100ms

    // Start timer
    recordingStartTime = Date.now();
    recordingTimer = setInterval(updateTimer, 1000);

    // Update UI
    statusEl.textContent = "Connected";
    statusEl.className = "text-success";
    statusIndicator.className = "status-indicator status-success";
    stopBtn.disabled = false;
    startBtn.innerHTML = '<i class="bi bi-mic-fill me-2"></i>Start';

    // Start visualization
    resizeCanvases();
    drawVisualizer();
  } catch (err) {
    console.error("Recording Error:", err);

    // Reset UI
    startBtn.disabled = false;
    startBtn.innerHTML = '<i class="bi bi-mic-fill me-2"></i>Start Recording';
    statusEl.textContent =
      "Error: " + (err.message || "Failed to access microphone");
    statusEl.className = "text-danger";
    statusIndicator.className = "status-indicator status-danger";

    // Clean up if partially initialized
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
    }

    // Specific error messages
    if (err.name === "NotAllowedError") {
      alert(
        "❌ Microphone access was denied. Please allow microphone access to use this feature."
      );
    } else if (err.name === "NotFoundError") {
      alert(
        "🔍 No microphone found. Please connect a microphone and try again."
      );
    } else if (err.name === "NotReadableError") {
      alert(
        "⚠️ Couldn't access the microphone. Another application might be using it."
      );
    } else if (err.name === "OverconstrainedError") {
      alert(
        "⚙️ Couldn't match the requested microphone constraints. Try different settings."
      );
    }
  }
};

// Stop recording
stopBtn.onclick = () => {
  // Stop recording if active
  if (recorder && recorder.state === "recording") {
    recorder.stop();
  }

  // Stop timer
  if (recordingTimer) {
    clearInterval(recordingTimer);
  }

  // Stop media stream
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
  }

  // Close audio context
  if (audioContext) {
    audioContext
      .close()
      .catch((e) => console.log("AudioContext close error:", e));
  }

  // Reset variables
  mediaStream = null;
  audioContext = null;
  analyser = null;
  gainNode = null;
  source = null;
  recorder = null;

  // Update UI
  statusEl.textContent = "Stopped";
  statusEl.className = "text-danger";
  statusIndicator.className = "status-indicator status-danger";
  startBtn.disabled = false;
  stopBtn.disabled = true;
  timerEl.textContent = "00:00";
  volumeBar.style.width = "0%";
  volumeLevel.textContent = "0%";

  // Clear canvases
  wfCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
  spCtx.clearRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
};

// Initialize application
window.addEventListener("load", async () => {
  try {
    // Set up UI controls
    gainControl.addEventListener("input", () => {
      gainValue.textContent = gainControl.value;
      if (gainNode) {
        gainNode.gain.value = parseFloat(gainControl.value);
      }
    });

    micSelect.onchange = () => {
      selectedDeviceId = micSelect.value;
    };

    // Handle window resize
    window.addEventListener("resize", () => {
      resizeCanvases();
      if (analyser) drawVisualizer();
    });

    // Set up download button
    downloadBtn.onclick = () => {
      if (!playback.src) return;

      const a = document.createElement("a");
      a.href = playback.src;
      a.download = `recording-${new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:T]/g, "-")}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };

    // Initial setup
    resizeCanvases();
    await populateMicrophoneList();
  } catch (err) {
    console.error("Initialization Error:", err);
    statusEl.textContent = "Initialization error";
    statusEl.className = "text-danger";
    statusIndicator.className = "status-indicator status-danger";
  }
});
