document.addEventListener('DOMContentLoaded', () => {
  // --- Initialization ---
  const simulator = new ArduinoSimulator();

  // Elements
  const codeEditor = document.getElementById('code-editor');
  const btnRun = document.getElementById('btn-run');
  const btnPause = document.getElementById('btn-pause');
  const btnReset = document.getElementById('btn-reset');
  const btnAddLed = document.getElementById('btn-add-led');
  const btnClearConsole = document.getElementById('btn-clear-console');
  const componentsArea = document.getElementById('components-area');
  const templateSelect = document.getElementById('template-select');
  const consoleOutput = document.getElementById('console-output');
  const simStatus = document.getElementById('sim-status');
  const btnDownload = document.getElementById('btn-download');
  const btnSave = document.getElementById('btn-save');
  const fileLoad = document.getElementById('file-load');

  // State
  let leds = []; // Array of { element, pin, color }
  let ledIdCounter = 0;

  // --- Engine Callbacks ---

  simulator.onLog = (entry) => {
    const line = document.createElement('div');
    line.className = `log-line ${entry.type}`;
    const timeParams = new Date(entry.time).toTimeString().split(' ')[0];
    line.textContent = `[${timeParams}] ${entry.msg}`;
    consoleOutput.appendChild(line);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  };

  simulator.onPinChange = (pin, value, pwm) => {
    // Update Board UI
    const pinRow = document.querySelector(`.pin-row[data-pin="${pin}"]`);
    if (pinRow) {
      const hole = pinRow.querySelector('.pin-hole');
      if (value) {
        hole.style.backgroundColor = 'var(--neon-green)';
        hole.style.boxShadow = '0 0 5px var(--neon-green)';
      } else {
        hole.style.backgroundColor = '#111';
        hole.style.boxShadow = 'inset 1px 1px 2px #000';
      }
    }

    // Update Connected LEDs
    leds.forEach(led => {
      if (led.pin == pin) {
        const bulb = led.element.querySelector('.led-bulb');
        if (value) {
          bulb.classList.add('lit');
          // Handle PWM brightness if applicable
          if (pwm > 0) {
            bulb.style.opacity = pwm / 255;
          } else {
            bulb.style.opacity = 1;
          }
        } else {
          bulb.classList.remove('lit');
          bulb.style.opacity = 1; // Reset opacity for next ON state
        }
      }
    });
  };

  // --- UI Interactions ---

  // 1. Controls
  btnRun.addEventListener('click', () => {
    if (!simulator.isRunning) {
      const code = codeEditor.value;
      simulator.run(code).then(() => {
        // Determine if natural finish or stopped
        if (!simulator.isRunning) {
          setSimStatus('STOPPED');
        }
      });
      setSimStatus('RUNNING');
    } else {
      // Resume if paused? No, run button usually restarts or nothing.
      // If we want resume, we use Pause button toggle.
      // But valid flow is: Run -> Stop -> Run.
      // If running, maybe restart?
      simulator.stop();
      setTimeout(() => {
        simulator.run(codeEditor.value);
        setSimStatus('RUNNING');
      }, 100);
    }
  });

  btnPause.addEventListener('click', () => {
    if (simulator.isRunning) {
      if (simulator.isPaused) {
        simulator.resume();
        btnPause.textContent = "⏸ PAUSE";
        btnPause.classList.remove('paused-btn');
        setSimStatus('RUNNING');
      } else {
        simulator.pause();
        btnPause.textContent = "▶ RESUME";
        btnPause.classList.add('paused-btn');
        setSimStatus('PAUSED');
      }
    }
  });

  btnReset.addEventListener('click', () => {
    simulator.stop();
    setSimStatus('OFFLINE');
    simulator.resetPins();
    // Clear all LEDs visually
    document.querySelectorAll('.led-bulb').forEach(b => b.classList.remove('lit'));
  });

  function setSimStatus(status) {
    simStatus.textContent = status;
    simStatus.className = 'status-indicator ' + status.toLowerCase();

    if (status === 'RUNNING') {
      btnRun.textContent = "⏹ STOP";
      btnRun.classList.add('stop-mode');
      btnPause.disabled = false;
    } else if (status === 'OFFLINE' || status === 'STOPPED') {
      btnRun.textContent = "▶ RUN";
      btnRun.classList.remove('stop-mode');
      btnPause.disabled = true;
      btnPause.textContent = "⏸ PAUSE";
    }
  }

  // 2. Add LED
  btnAddLed.addEventListener('click', () => {
    createLedComponent();
  });

  function createLedComponent() {
    const id = ledIdCounter++;
    const template = document.getElementById('led-template');
    const clone = template.content.cloneNode(true);
    const el = clone.querySelector('.led-component');

    el.dataset.id = id;

    // Pin Selector
    const select = el.querySelector('.pin-selector');
    // Populate pins 0-13 + A0-A5
    const pins = [];
    for (let i = 0; i <= 13; i++) pins.push(i);
    ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'].forEach(p => pins.push(p));

    pins.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      select.appendChild(opt);
    });

    // Event Listeners for Component
    const btnRemove = el.querySelector('.btn-remove');
    btnRemove.addEventListener('click', () => {
      el.remove();
      leds = leds.filter(l => l.id !== id);
    });

    const colorPicker = el.querySelector('.color-picker');

    // Function to update color
    const updateColor = (color) => {
      el.querySelector('.led-bulb').style.setProperty('--led-color', color);
      const led = leds.find(l => l.id === id);
      if (led) led.color = color;
      colorPicker.value = color; // Sync picker
    };

    // Native Picker
    colorPicker.addEventListener('input', (e) => {
      updateColor(e.target.value);
    });

    // Swatches
    el.querySelectorAll('.swatch').forEach(s => {
      s.addEventListener('click', (e) => {
        const color = e.target.dataset.color;
        updateColor(color);
      });
    });

    select.addEventListener('change', (e) => {
      const newPin = e.target.value;
      // Check conflict
      const conflict = leds.find(l => l.id !== id && l.pin === newPin);
      if (conflict) {
        // Show warning in console (simulator.log is not directly accessible here easily unless we expose it or use simple alert/console)
        // Let's use the consoleOutput if possible, or just browser alert/console.
        // The prompt asked to "show warning".
        alert(`⚠️ Warning: Pin ${newPin} is already in use by another LED!`);
      }

      const led = leds.find(l => l.id === id);
      if (led) led.pin = newPin;

      // Update Connection Line Visual
      const line = el.querySelector('.connection-line');
      if (newPin) {
        line.textContent = `Wire: ${newPin} ⏚ GND`;
        line.style.color = 'var(--neon-green)';
        line.style.fontSize = '0.7em';
        line.style.marginTop = '5px';
      } else {
        line.textContent = '';
      }
    });

    // Add to DOM
    componentsArea.appendChild(el);

    // Add to State
    leds.push({
      id: id,
      element: el,
      pin: null, // User must select
      color: '#00FF00'
    });
  }

  // 3. Clear Console
  btnClearConsole.addEventListener('click', () => {
    consoleOutput.innerHTML = '';
    simulator.consoleLog = [];
  });

  // 4. Templates
  const templates = {
    blink: `void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}`,
    fade: `int brightness = 0;
int fadeAmount = 5;

void setup() {
  pinMode(9, OUTPUT);
}

void loop() {
  analogWrite(9, brightness);
  brightness = brightness + fadeAmount;

  if (brightness <= 0 || brightness >= 255) {
    fadeAmount = -fadeAmount;
  }
  delay(30);
}`,
    siren: `void setup() {
  pinMode(12, OUTPUT);
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(12, HIGH);
  digitalWrite(13, LOW);
  delay(200);
  digitalWrite(12, LOW);
  digitalWrite(13, HIGH);
  delay(200);
}`,
    knight_rider: `// Connect LEDs to pins 2, 3, 4, 5, 6
void setup() {
  for (int i = 2; i < 7; i++) {
    pinMode(i, OUTPUT);
  }
}

void loop() {
  for (int i = 2; i < 7; i++) {
    digitalWrite(i, HIGH);
    delay(50);
    digitalWrite(i, LOW);
  }
  for (int i = 5; i > 2; i--) {
    digitalWrite(i, HIGH);
    delay(50);
    digitalWrite(i, LOW);
  }
}`,
    complex: `// ====== LED Pins ======
// Connect LEDs to pins 2, 3, 4, 5, 6
int leds[] = {2, 3, 4, 5, 6};
int totalLEDs = 5;

// ====== Setup ======
void setup() {
  for (int i = 0; i < totalLEDs; i++) {
    pinMode(leds[i], OUTPUT);
  }
}

// ====== Main Loop ======
void loop() {
  pattern1();  // Running light
  pattern2();  // Blink all
  pattern3();  // Bounce
  pattern4();  // Alternate
  pattern5();  // Random
}

// ====== Pattern 1: Running Light ======
void pattern1() {
  for (int i = 0; i < totalLEDs; i++) {
    digitalWrite(leds[i], HIGH);
    delay(150);
    digitalWrite(leds[i], LOW);
  }
}

// ====== Pattern 2: Blink All ======
void pattern2() {
  for (int i = 0; i < 3; i++) {
    for (int j = 0; j < totalLEDs; j++) {
      digitalWrite(leds[j], HIGH);
    }
    delay(300);

    for (int j = 0; j < totalLEDs; j++) {
      digitalWrite(leds[j], LOW);
    }
    delay(300);
  }
}

// ====== Pattern 3: Bounce Effect ======
void pattern3() {
  // Forward
  for (int i = 0; i < totalLEDs; i++) {
    digitalWrite(leds[i], HIGH);
    delay(100);
    digitalWrite(leds[i], LOW);
  }

  // Backward
  for (int i = totalLEDs - 1; i >= 0; i--) {
    digitalWrite(leds[i], HIGH);
    delay(100);
    digitalWrite(leds[i], LOW);
  }
}

// ====== Pattern 4: Alternate LEDs ======
void pattern4() {
  for (int i = 0; i < 4; i++) {
    for (int j = 0; j < totalLEDs; j++) {
      if (j % 2 == 0)
        digitalWrite(leds[j], HIGH);
      else
        digitalWrite(leds[j], LOW);
    }
    delay(300);

    for (int j = 0; j < totalLEDs; j++) {
      if (j % 2 == 0)
        digitalWrite(leds[j], LOW);
      else
        digitalWrite(leds[j], HIGH);
    }
    delay(300);
  }

  // Turn off all
  for (int j = 0; j < totalLEDs; j++) {
    digitalWrite(leds[j], LOW);
  }
}

// ====== Pattern 5: Random Blink ======
void pattern5() {
  for (int i = 0; i < 10; i++) {
    int randLED = random(0, totalLEDs);
    digitalWrite(leds[randLED], HIGH);
    delay(100);
    digitalWrite(leds[randLED], LOW);
  }
}`
  };

  templateSelect.addEventListener('change', (e) => {
    const key = e.target.value;
    if (key && templates[key]) {
      codeEditor.value = templates[key];
    }
  });

  // 5. Download
  btnDownload.addEventListener('click', () => {
    const text = codeEditor.value;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sketch.ino';
    a.click();
    URL.revokeObjectURL(url);
  });

  // 6. Save/Load Project
  btnSave.addEventListener('click', () => {
    const project = {
      code: codeEditor.value,
      leds: leds.map(l => ({
        id: l.id,
        pin: l.pin,
        color: l.color
      }))
    };
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'neoled_project.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  fileLoad.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const project = JSON.parse(event.target.result);

        // Load Code
        if (project.code) codeEditor.value = project.code;

        // Load LEDs
        if (project.leds && Array.isArray(project.leds)) {
          // Clear existing
          document.querySelectorAll('.led-component').forEach(el => el.remove());
          leds = [];
          ledIdCounter = 0; // Reset or continue? Safe to continue or reset if we clear leds.

          // Recreate
          project.leds.forEach(ledData => {
            createLedComponent(); // Adds to end of Main leds array
            const newLed = leds[leds.length - 1];

            // Restore properties
            newLed.pin = ledData.pin;
            newLed.color = ledData.color;
            newLed.id = ledData.id; // Keep original ID if needed, or let createLedComponent assign new one.
            // Actually createLedComponent increments counter. 
            // Let's just update the UI specific to this new LED

            // Update UI Pin
            const select = newLed.element.querySelector('.pin-selector');
            select.value = ledData.pin || "";

            // Update UI Color
            const colorPicker = newLed.element.querySelector('.color-picker');
            colorPicker.value = ledData.color;
            newLed.element.querySelector('.led-bulb').style.setProperty('--led-color', ledData.color);
          });
        }
        alert("Project loaded successfully!");
      } catch (err) {
        console.error(err);
        alert("Error loading project file.");
      }
    };
    reader.readAsText(file);
    // Reset input
    e.target.value = '';
  });
});
