const connectButton = document.getElementById('connectButton');
const firmwareActionsDiv = document.getElementById('firmwareActions');
const flashButtons = document.querySelectorAll('.flash-button');
const disconnectButton = document.getElementById('disconnectButton');
const resetButton = document.getElementById('resetButton');
const logDiv = document.getElementById('log');

let device = null;      // Raw SerialPort object
let transport = null;
let esploader = null;

const FIRMWARE_BASE_URL = './firmware/'; // Adjust if your .bin files are hosted elsewhere
const APP_FIRMWARE_OFFSET = 0x10000; // Common offset for main application firmware on ESP32

// --- Logger ---
function log(message) {
    console.log(message);
    const timestamp = new Date().toLocaleTimeString();
    logDiv.innerHTML += `[${timestamp}] ${message}\n`;
    logDiv.scrollTop = logDiv.scrollHeight;
}

function clearLog() {
    logDiv.innerHTML = '';
}

// --- UI State Management ---
function updateUiState(isConnected) {
    connectButton.classList.toggle('hidden', isConnected);
    firmwareActionsDiv.classList.toggle('hidden', !isConnected);
    resetButton.classList.add('hidden'); // Hide reset by default, show after flash
    flashButtons.forEach(btn => btn.disabled = !isConnected);
    disconnectButton.disabled = !isConnected;
}

// --- Web Serial Connection ---
connectButton.addEventListener('click', async () => {
    clearLog();
    if (!navigator.serial) {
        log('Error: Web Serial API is not supported by your browser. Try Chrome or Edge (HTTPS required).');
        alert('Web Serial API not supported. Please use Chrome or Edge.');
        return;
    }

    log('Requesting serial port...');
    try {
        device = await navigator.serial.requestPort();
        log('Serial port selected. Opening...');

        // ESPLoader.js will handle opening the port with specific options
        // For now, we just store the 'device' (SerialPort instance)
        
        transport = new ESPLoader.Transport(device);
        const flashBaudRate = parseInt(prompt("Enter Baud Rate for flashing (e.g., 115200, 460800, 921600):", "460800"), 10);
        if (isNaN(flashBaudRate)) {
            log("Invalid baud rate. Defaulting to 115200.");
            flashBaudRate = 115200;
        }

        esploader = new ESPLoader.ESPLoader({
            transport,
            baudrate: flashBaudRate,
            romBaudrate: 115200, // Standard ROM bootloader baud rate
            log: (...args) => log(args.join(' ')),
            debug: (...args) => console.debug(...args), // For more verbose esptool-js output
            error: (...args) => console.error(...args)
        });

        log('Connecting to ESP32 chip...');
        // This main_fn (or main) connects, syncs, and reads chip info.
        // It will also try to reset into bootloader via DTR/RTS if the board supports it.
        await esploader.main(); 
        log(`Connected to: ${esploader.chip.CHIP_NAME}`);
        log(`MAC Address: ${esploader.chip.MAC}`);
        log('ESP32 connected successfully. Ready to flash firmware.');
        updateUiState(true);

    } catch (e) {
        log(`Error connecting: ${e.message || e}`);
        console.error(e);
        if (esploader) await esploader.hardReset(); // Try to reset if connection failed mid-way
        if (transport) await transport.disconnect();
        if (device && device.readable) { // Check if port was actually opened
            try { await device.close(); } catch (err) { /* ignore */ }
        }
        device = null;
        transport = null;
        esploader = null;
        updateUiState(false);
    }
});

// --- Disconnect ---
disconnectButton.addEventListener('click', async () => {
    if (esploader) {
        // await esploader.hardReset(); // Optional: reset before disconnecting
    }
    if (transport) {
        await transport.disconnect();
    }
    if (device && device.readable) {
        // Transport should handle closing, but as a fallback
        try { await device.close(); } catch (e) { /* ignore */ }
    }
    device = null;
    transport = null;
    esploader = null;
    log('Disconnected from ESP32.');
    updateUiState(false);
});

// --- Reset Device ---
resetButton.addEventListener('click', async () => {
    if (esploader) {
        log('Attempting to reset device...');
        try {
            await esploader.hardReset();
            log('Device reset command sent.');
        } catch (e) {
            log(`Could not reset: ${e.message}`);
        }
    } else {
        log('Not connected or ESPLoader not initialized. Please manually reset the device.');
    }
});

// --- Flashing Logic ---
flashButtons.forEach(button => {
    button.addEventListener('click', async (event) => {
        if (!esploader || !esploader.chip) {
            log('Error: Not connected to ESP32 or connection lost.');
            return;
        }

        const firmwareFile = event.target.dataset.firmware;
        const firmwareName = event.target.dataset.name;
        const firmwareUrl = `${FIRMWARE_BASE_URL}${firmwareFile}`;
        const offset = APP_FIRMWARE_OFFSET; // Assuming all are app firmware

        log(`Starting flash for: ${firmwareName} (${firmwareFile})`);
        log(`Firmware URL: ${firmwareUrl}`);
        log(`Flash Offset: 0x${offset.toString(16)}`);

        // Disable buttons during flash
        flashButtons.forEach(btn => btn.disabled = true);
        disconnectButton.disabled = true;
        resetButton.classList.add('hidden');

        try {
            log(`Fetching ${firmwareFile}...`);
            const response = await fetch(firmwareUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch firmware ${firmwareFile}: ${response.statusText}`);
            }
            const fileBlob = await response.blob();
            const fileArrayBuffer = await fileBlob.arrayBuffer();
            log(`Fetched ${firmwareFile} (${fileArrayBuffer.byteLength} bytes).`);
            
            const flashOptions = {
                fileArray: [{ data: fileArrayBuffer, address: offset }],
                flashSize: "keep",  // 'keep' uses detected size. Or '4MB', '8MB' etc.
                flashMode: "keep",  // 'keep', 'dio', 'qio'
                flashFreq: "keep",  // 'keep', '40m', '80m'
                eraseAll: false,    // Set to 'true' to erase entire flash before writing this part.
                                    // Usually for application partition, eraseAll=false is fine if the partition is erased by partitions.bin or first boot.
                                    // For a more robust single app flash, you might consider `esploader.eraseRegion(offset, fileArrayBuffer.byteLength)` first.
                compress: true,     // GZIP compress image before sending (ESP ROM decompresses)
                
                // Progress callback
                reportProgress: (fileIndex,- written, total) => {
                    const percentage = Math.floor((written / total) * 100);
                    log(`Flashing ${firmwareName}: ${percentage}% (${written}/${total} bytes)`);
                    // You can update a progress bar UI element here
                },
                // MD5 hash calculation (esptool-js needs CryptoJS)
                calculateMD5Hash: (data) => CryptoJS.MD5(CryptoJS.lib.WordArray.create(data)).toString(),
            };

            log('Writing to flash. This may take a moment...');
            await esploader.writeFlash(flashOptions);
            log(`${firmwareName} flashed successfully!`);
            resetButton.classList.remove('hidden'); // Show reset button

        } catch (e) {
            log(`Error flashing ${firmwareName}: ${e.message || e}`);
            console.error(e);
        } finally {
            // Re-enable buttons
            flashButtons.forEach(btn => btn.disabled = false);
            disconnectButton.disabled = false;
        }
    });
});

// --- Initial UI State ---
updateUiState(false);
if (!navigator.serial) {
    log('Web Serial API not supported. Please use Chrome or Edge (HTTPS required).');
    connectButton.disabled = true;
} else {
    log('Page loaded. Please connect your Mini GS and put it into bootloader mode.');
}
