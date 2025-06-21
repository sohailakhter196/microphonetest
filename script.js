const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const downloadBtn = document.getElementById("downloadBtn");
const playback = document.getElementById("playback");
const volumeBar = document.getElementById("volumeBar");
const timerEl = document.getElementById("timer");
const statusEl = document.getElementById("status");
const gainControl = document.getElementById("gainControl");
const loopbackToggle = document.getElementById("loopbackToggle");
const noiseToggle = document.getElementById("noiseSuppressionToggle");
const micSelect = document.getElementById("micSelect");

let mediaStream, audioContext, analyser, gainNode, source, recorder;
let dataChunks = [],
  recordingStartTime,
  recordingTimer;
let selectedDeviceId = null;

const waveformCanvas = document.getElementById("waveform");
const spectrumCanvas = document.getElementById("spectrum");
const wfCtx = waveformCanvas.getContext("2d");
const spCtx = spectrumCanvas.getContext("2d");

waveformCanvas.width = waveformCanvas.offsetWidth;
waveformCanvas.height = waveformCanvas.offsetHeight;
spectrumCanvas.width = spectrumCanvas.offsetWidth;
spectrumCanvas.height = spectrumCanvas.offsetHeight;

async function populateMicrophoneList() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  micSelect.innerHTML = "";
  const mics = devices.filter((d) => d.kind === "audioinput");
  mics.forEach((mic) => {
    const option = document.createElement("option");
    option.value = mic.deviceId;
    option.textContent = mic.label || `Microphone ${micSelect.length + 1}`;
    micSelect.appendChild(option);
  });
  if (mics.length) {
    selectedDeviceId = mics[0].deviceId;
    micSelect.value = selectedDeviceId;
  }
}

micSelect.onchange = () => {
  selectedDeviceId = micSelect.value;
};

function drawVisualizer() {
  if (!analyser) return;

  const bufferLength = analyser.fftSize;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteTimeDomainData(dataArray);

  // Waveform
  wfCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
  wfCtx.beginPath();
  const sliceWidth = waveformCanvas.width / bufferLength;
  dataArray.forEach((val, i) => {
    const y = ((val / 128.0) * waveformCanvas.height) / 2;
    if (i === 0) {
      wfCtx.moveTo(0, y);
    } else {
      wfCtx.lineTo(i * sliceWidth, y);
    }
  });
  wfCtx.strokeStyle = "#007bff";
  wfCtx.lineWidth = 2;
  wfCtx.stroke();

  // Spectrum
  analyser.getByteFrequencyData(dataArray);
  spCtx.clearRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
  dataArray.forEach((val, i) => {
    const barHeight = val / 2;
    spCtx.fillStyle = `rgb(${val + 100}, 50, 200)`;
    spCtx.fillRect(i * 2, spectrumCanvas.height - barHeight, 1, barHeight);
  });

  volumeBar.style.width = (Math.max(...dataArray) / 255) * 100 + "%";

  requestAnimationFrame(drawVisualizer);
}

startBtn.onclick = async () => {
  const constraints = {
    audio: {
      deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: noiseToggle.checked,
    },
  };

  mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
  statusEl.textContent = "Connected";
  statusEl.classList.remove("text-danger", "text-dark");
  statusEl.classList.add("text-success");

  audioContext = new AudioContext();
  source = audioContext.createMediaStreamSource(mediaStream);

  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;

  gainNode = audioContext.createGain();
  source.connect(gainNode);
  gainNode.connect(analyser);

  if (loopbackToggle.checked) {
    analyser.connect(audioContext.destination);
  }

  const dest = audioContext.createMediaStreamDestination();
  analyser.connect(dest);

  recorder = new MediaRecorder(dest.stream);
  recorder.ondataavailable = (e) => dataChunks.push(e.data);
  recorder.onstop = () => {
    const blob = new Blob(dataChunks, { type: "audio/webm" });
    playback.src = URL.createObjectURL(blob);
    playback.hidden = false;
    downloadBtn.disabled = false;
    downloadBtn.onclick = () => {
      const a = document.createElement("a");
      a.href = playback.src;
      a.download = "mic-recording.webm";
      a.click();
    };
  };

  gainControl.oninput = () => {
    gainNode.gain.value = parseFloat(gainControl.value);
  };

  recorder.start();
  recordingStartTime = Date.now();
  recordingTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const secs = String(elapsed % 60).padStart(2, "0");
    timerEl.textContent = `${mins}:${secs}`;
  }, 1000);

  startBtn.disabled = true;
  stopBtn.disabled = false;

  drawVisualizer();
};

stopBtn.onclick = () => {
  recorder.stop();
  clearInterval(recordingTimer);
  mediaStream.getTracks().forEach((track) => track.stop());

  startBtn.disabled = false;
  stopBtn.disabled = true;
  statusEl.textContent = "Stopped";
  statusEl.classList.remove("text-success");
  statusEl.classList.add("text-danger");
};

window.onload = async () => {
  await populateMicrophoneList();
};
