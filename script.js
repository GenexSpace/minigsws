// DOM Elements
const connectButton = document.getElementById('connectButton');
const disconnectButton = document.getElementById('disconnectButton');
const mainInterfaceDiv = document.getElementById('mainInterface');

const deviceInfoDiv = document.getElementById('deviceInfo');
const serialPortNameSpan = document.getElementById('serialPortName');
const usbVidSpan = document.getElementById('usbVid');
const usbPidSpan = document.getElementById('usbPid');
const espChipDetailsDiv = document.getElementById('espChipDetails');
const espChipNameSpan = document.getElementById('espChipName');
const espMacAddressSpan = document.getElementById('espMacAddress');
const espFeaturesSpan = document.getElementById('espFeatures');

const flasherSection = document.getElementById('flasherSection');
const flashButtons = document.querySelectorAll('.flash-button');
const resetEspButton = document.getElementById('resetEspButton');

const serialMonitorSection = document.getElementById('serialMonitorSection');
const startSerialMonitorButton = document.getElementById('startSerialMonitorButton');
const stopSerialMonitorButton = document.getElementById('stopSerialMonitorButton');
const serialMonitorBaudRateInput = document.getElementById('serialMonitorBaudRate');
const serialMonitorOutput = document.getElementById('serialMonitorOutput');
const serialSendCommandInput = document.getElementById('serialSendCommand');
const serialSendButton = document.getElementById('serialSendButton');
const sendNewlineCheckbox = document.getElementById('sendNewlineCheckbox');

const logDiv = document.getElementById('log');
const currentYearSpan = document.getElementById('currentYear');

// Global state variables
let device = null; // The selected SerialPort object
let esploader = null;
let transport = null;

let serialReader = null;
let serialWriter = null;
let keepSerialReading = false;
let isSerialMonitorActive = false;
let textDecoder = new TextDecoder();
let textEncoder = new TextEncoder();

const FIRMWARE_BASE_URL = './firmware/';
const APP_FIRMWARE_OFFSET = 0x10000;

// --- Logging ---
function logMsg(message) {
    console.log(message);
    const timestamp = new Date().toLocaleTimeString();
    logDiv.innerHTML += `[${timestamp}] ${message}\n`;
    logDiv.scrollTop = logDiv.scrollHeight;
}

function clearLog() {
    logDiv.innerHTML = '';
}

// --- UI Update Functions ---
function updateUiForConnected() {
    connectButton.classList.add('hidden');
    disconnectButton.classList.remove('hidden');
    mainInterfaceDiv.classList.remove('hidden');
    espChipDetailsDiv.classList.add('hidden'); // Hide ESP details until flash attempt
    startSerialMonitorButton.disabled = false;
    stopSerialMonitorButton.disabled = true;
    serialSendButton.disabled = true;
    flashButtons.forEach(btn => btn.disabled = false);
    resetEspButton.classList.add('hidden');
}

function updateUiForDisconnected() {
    connectButton.classList.remove('hidden');
    disconnectButton.classList.add('hidden');
    mainInterfaceDiv.classList.add('hidden');
    serialPortNameSpan.textContent = '-';
    usbVidSpan.textContent = '-';
    usbPidSpan.textContent = '-';
    clearEspChipInfo();
    if (isSerialMonitorActive) stopSerialMonitorLogic(false); // Stop monitor if active, no port close needed here
    isSerialMonitorActive = false; // Ensure monitor state is reset
    startSerialMonitorButton.disabled = true;
    stopSerialMonitorButton.disabled = true;
    serialSendButton.disabled = true;
    flashButtons.forEach(btn => btn.disabled = true);
    resetEspButton.classList.add('hidden');
}

function updateUiForSerialMonitorActive(isActive) {
    isSerialMonitorActive = isActive;
    startSerialMonitorButton.disabled = isActive;
    stopSerialMonitorButton.disabled = !isActive;
    serialMonitorBaudRateInput.disabled = isActive;
    serialSendButton.disabled = !isActive;
    // Disable flashing while monitor is active
    flashButtons.forEach(btn => btn.disabled = isActive);
    resetEspButton.classList.add('hidden'); // Hide reset button when monitor starts/stops
}

function populateSerialPortInfo(portInfo) {
    serialPortNameSpan.textContent = portInfo.usbProductId ? `Selected` : 'Selected (Unknown VID/PID)';
    usbVidSpan.textContent = portInfo.usbVendorId ? `0x${portInfo.usbVendorId.toString(16).padStart(4, '0')}` : 'N/A';
    usbPidSpan.textContent = portInfo.usbProductId ? `0x${portInfo.usbProductId.toString(16).padStart(4, '0')}` : 'N/A';
}

function populateEspChipInfo(chipInfo) {
    if (chipInfo) {
        espChipNameSpan.textContent = chipInfo.CHIP_NAME || 'Unknown';
        espMacAddressSpan.textContent = chipInfo.MAC || 'Unknown';
        espFeaturesSpan.textContent = Array.isArray(chipInfo.features) ? chipInfo.features.join(', ') : (chipInfo.features || 'Unknown');
        espChipDetailsDiv.classList.remove('hidden');
    }
}
function clearEspChipInfo() {
    espChipNameSpan.textContent = '-';
    espMacAddressSpan.textContent = '-';
    espFeaturesSpan.textContent = '-';
    espChipDetailsDiv.classList.add('hidden');
}

// --- Core Logic ---
connectButton.addEventListener('click', async () => {
    clearLog();
    if (!navigator.serial) {
        logMsg('Error: Web Serial API is not supported. Use Chrome/Edge (HTTPS).');
        alert('Web Serial API not supported.');
        return;
    }
    try {
        logMsg('Requesting serial port...');
        device = await navigator.serial.requestPort();
        populateSerialPortInfo(device.getInfo());
        logMsg('Serial port selected.');
        updateUiForConnected();
    } catch (e) {
        logMsg(`Error selecting port: ${e.message || e}`);
    }
});

disconnectButton.addEventListener('click', async () => {
    logMsg('Disconnecting...');
    if (isSerialMonitorActive) {
        await stopSerialMonitorLogic(true); // true to close port
    }
    if (transport) { // If flasher was active or interrupted
        try { await transport.disconnect(); } catch (e) { /* ignore */ }
        transport = null;
        esploader = null;
    }
    if (device && device.readable) { // If port somehow still open by us (not by esptool-js's transport)
        try { await device.close(); } catch (e) { /* ignore */ }
    }
    device = null;
    updateUiForDisconnected();
    logMsg('Disconnected.');
});

// --- Flashing Logic ---
flashButtons.forEach(button => {
    button.addEventListener('click', async (event) => {
        if (!device) {
            logMsg('Error: No serial port selected.');
            return;
        }
        if (isSerialMonitorActive) {
            alert('Please stop the Serial Monitor before flashing.');
            logMsg('Flashing blocked: Serial Monitor is active.');
            return;
        }

        const firmwareFile = event.target.dataset.firmware;
        const firmwareName = event.target.dataset.name;
        const firmwareUrl = `${FIRMWARE_BASE_URL}${firmwareFile}`;
        const offset = APP_FIRMWARE_OFFSET;

        logMsg(`Preparing to flash: ${firmwareName} from ${firmwareUrl}`);
        flashButtons.forEach(btn => btn.disabled = true);
        resetEspButton.classList.add('hidden');
        clearEspChipInfo(); // Clear previous chip info

        try {
            logMsg('Initializing flasher... Ensure ESP32 is in bootloader mode.');
            // ESPLoader's Transport will open the port.
            transport = new ESPLoader.Transport(device, true); // true for slip_reader_enabled
            
            const flashBaudRate = parseInt(prompt("Enter Baud Rate for flashing (e.g., 460800, 921600):", "460800"), 10) || 460800;

            esploader = new ESPLoader.ESPLoader({
                transport,
                baudrate: flashBaudRate,
                romBaudrate: 115200,
                log: (...args) => logMsg(args.join(' ')),
                debug: (...args) => console.debug(...args),
                error: (...args) => console.error(...args)
            });

            logMsg('Connecting to ESP32 chip...');
            await esploader.main(); // This connects, syncs, reads chip info, and may reset to bootloader
            populateEspChipInfo(esploader.chip);
            logMsg(`Connected to ${esploader.chip.CHIP_NAME}. MAC: ${esploader.chip.MAC}`);

            logMsg(`Fetching ${firmwareFile}...`);
            const response = await fetch(firmwareUrl);
            if (!response.ok) throw new Error(`Failed to fetch ${firmwareFile}: ${response.statusText}`);
            const fileArrayBuffer = await response.arrayBuffer();
            logMsg(`Fetched ${firmwareFile} (${fileArrayBuffer.byteLength} bytes).`);

            const flashOptions = {
                fileArray: [{ data: fileArrayBuffer, address: offset }],
                flashSize: "keep", flashMode: "keep", flashFreq: "keep",
                eraseAll: false, compress: true,
                reportProgress: (fileIndex, written, total) => {
                    logMsg(`Flashing ${firmwareName}: ${Math.floor((written / total) * 100)}%`);
                },
                calculateMD5Hash: (data) => CryptoJS.MD5(CryptoJS.lib.WordArray.create(data)).toString(),
            };

            logMsg('Writing to flash...');
            await esploader.writeFlash(flashOptions);
            logMsg(`${firmwareName} flashed successfully!`);
            resetEspButton.classList.remove('hidden');

        } catch (e) {
            logMsg(`Error during flashing: ${e.message || e}`);
            console.error(e);
        } finally {
            if (transport) {
                await transport.disconnect(); // transport.disconnect() should close the port
            }
            transport = null;
            esploader = null; // Clear esploader instance
            // Re-enable flash buttons only if still connected at a high level
            if (device) {
                flashButtons.forEach(btn => btn.disabled = false);
            }
        }
    });
});

resetEspButton.addEventListener('click', async () => {
    if (!device) {
        logMsg("Cannot reset: No device selected.");
        return;
    }
    if (isSerialMonitorActive) {
        alert("Stop serial monitor before attempting ESP32 reset via flasher logic.");
        return;
    }

    logMsg("Attempting to reset ESP32 via DTR/RTS (flasher logic)...");
    // This re-initializes transport/esploader briefly to send a reset.
    // This is because `esploader.hardReset()` needs an active connection.
    try {
        const tempTransport = new ESPLoader.Transport(device, true);
        const tempEsploader = new ESPLoader.ESPLoader({
            transport: tempTransport,
            baudrate: 115200, // Baud rate doesn't matter much for just reset
            log: (...args) => logMsg(args.join(' ')),
        });
        // We don't need to connect to the chip, just toggle lines.
        // `hardReset` itself doesn't require `main_fn` to be called prior if just for reset signal.
        await tempEsploader.hardReset();
        logMsg("ESP32 reset command sent.");
        resetEspButton.classList.add('hidden'); // Hide after use
        await tempTransport.disconnect();
    } catch (e) {
        logMsg(`Error resetting ESP32: ${e.message}. Try manual reset.`);
        console.error(e);
    }
});


// --- Serial Monitor Logic ---
startSerialMonitorButton.addEventListener('click', async () => {
    if (!device) {
        logMsg('Serial Monitor: No device selected.');
        return;
    }
    if (isSerialMonitorActive) {
        logMsg('Serial Monitor: Already active.');
        return;
    }

    const baudRate = parseInt(serialMonitorBaudRateInput.value, 10);
    if (isNaN(baudRate) || baudRate <= 0) {
        logMsg('Serial Monitor: Invalid baud rate.');
        alert('Please enter a valid baud rate.');
        return;
    }

    try {
        logMsg(`Serial Monitor: Opening port at ${baudRate} baud...`);
        await device.open({ baudRate: baudRate });
        logMsg('Serial Monitor: Port opened.');
        updateUiForSerialMonitorActive(true);
        serialMonitorOutput.innerHTML = ''; // Clear previous output

        keepSerialReading = true;
        serialReader = device.readable.getReader();
        serialWriter = device.writable.getWriter();

        // Start read loop
        readLoop();
    } catch (e) {
        logMsg(`Serial Monitor: Error opening port: ${e.message || e}`);
        updateUiForSerialMonitorActive(false);
        if (device && device.readable) await device.close(); // Ensure port is closed on error
    }
});

async function readLoop() {
    while (device.readable && keepSerialReading) {
        try {
            const { value, done } = await serialReader.read();
            if (done) {
                // Reader has been canceled.
                break;
            }
            if (value) {
                serialMonitorOutput.append(textDecoder.decode(value, { stream: true }));
                serialMonitorOutput.scrollTop = serialMonitorOutput.scrollHeight;
            }
        } catch (error) {
            logMsg(`Serial Monitor: Read error: ${error.message || error}`);
            await stopSerialMonitorLogic(true); // Stop and close on error
            break;
        }
    }
    // Ensure final part of a multi-byte character is decoded if stream ends.
    serialMonitorOutput.append(textDecoder.decode());
}

async function stopSerialMonitorLogic(shouldClosePort) {
    if (!isSerialMonitorActive && !keepSerialReading) return; // Already stopped or stopping

    keepSerialReading = false; // Signal readLoop to stop
    updateUiForSerialMonitorActive(false);

    if (serialReader) {
        try {
            await serialReader.cancel(); // This will cause readLoop to exit
            serialReader.releaseLock();
        } catch (e) { logMsg(`Serial Monitor: Error cancelling reader: ${e.message}`); }
        serialReader = null;
    }

    if (serialWriter) {
        try {
            // await serialWriter.close(); // Can cause issues if peer hasn't closed
            serialWriter.releaseLock();
        } catch (e) { logMsg(`Serial Monitor: Error releasing writer: ${e.message}`); }
        serialWriter = null;
    }

    if (shouldClosePort && device && device.readable) {
        try {
            await device.close();
            logMsg('Serial Monitor: Port closed.');
        } catch (e) {
            logMsg(`Serial Monitor: Error closing port: ${e.message || e}`);
        }
    }
    logMsg('Serial Monitor: Stopped.');
}


stopSerialMonitorButton.addEventListener('click', async () => {
    await stopSerialMonitorLogic(true); // true to close port
});

serialSendButton.addEventListener('click', async () => {
    if (!serialWriter) {
        logMsg('Serial Monitor: Writer not available.');
        return;
    }
    let dataToSend = serialSendCommandInput.value;
    if (sendNewlineCheckbox.checked) {
        dataToSend += '\n';
    }
    try {
        await serialWriter.write(textEncoder.encode(dataToSend));
        serialSendCommandInput.value = ''; // Clear input after send
    } catch (e) {
        logMsg(`Serial Monitor: Send error: ${e.message || e}`);
    }
});
serialSendCommandInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter' && !serialSendButton.disabled) {
        serialSendButton.click();
    }
});

// --- Initialization ---
function initializePage() {
    updateUiForDisconnected(); // Initial state
    if (!navigator.serial) {
        logMsg('Web Serial API not supported. Use Chrome/Edge (HTTPS).');
        connectButton.disabled = true;
    } else {
        logMsg('Page loaded. Select a serial port to begin.');
    }
    if (currentYearSpan) {
        currentYearSpan.textContent = new Date().getFullYear();
    }
}

initializePage();
