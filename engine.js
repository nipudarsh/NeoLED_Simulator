class ArduinoSimulator {
    constructor() {
        this.pins = {};
        this.isRunning = false;
        this.isPaused = false;
        this.loopId = null;
        this.consoleLog = [];
        this.onPinChange = null; // Callback for UI updates
        this.onLog = null;       // Callback for Console
        this.resetPins();
    }

    resetPins() {
        // Initialize digital pins 0-13 and analog A0-A5
        for (let i = 0; i <= 13; i++) {
            this.pins[i] = { mode: 'INPUT', value: 0, pwm: 0 };
        }
        ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'].forEach(p => {
            this.pins[p] = { mode: 'INPUT', value: 0, pwm: 0 };
        });
    }

    // --- API Mocks (exposed to user code) ---
    _pinMode(pin, mode) {
        if (!this.pins[pin]) {
            this.log(`Error: Invalid pin ${pin}`, 'error');
            return;
        }
        this.pins[pin].mode = mode;
        // this.log(`pinMode(${pin}, ${mode})`, 'info');
    }

    _digitalWrite(pin, value) {
        if (!this.pins[pin]) {
            this.log(`Error: Invalid pin ${pin}`, 'error');
            return;
        }
        // In Arduino, HIGH is 1, LOW is 0
        const val = (value === 'HIGH' || value === 1 || value === true) ? 1 : 0;
        this.pins[pin].value = val;
        this.pins[pin].pwm = 0; // Reset PWM if digital used

        if (this.onPinChange) this.onPinChange(pin, val, 0);
        // this.log(`digitalWrite(${pin}, ${val ? 'HIGH' : 'LOW'})`);
    }

    _analogWrite(pin, value) {
        if (!this.pins[pin]) {
            this.log(`Error: Invalid pin ${pin}`, 'error');
            return;
        }
        // Clamp 0-255
        let pwm = Math.max(0, Math.min(255, parseInt(value)));
        this.pins[pin].value = pwm > 0 ? 1 : 0; // Digital value is HIGH if pwm > 0
        this.pins[pin].pwm = pwm;

        if (this.onPinChange) this.onPinChange(pin, this.pins[pin].value, pwm);
        // this.log(`analogWrite(${pin}, ${pwm})`);
    }

    async _delay(ms) {
        if (!this.isRunning) return; // Exit if stopped

        // Return a promise that resolves after ms
        return new Promise(resolve => {
            const start = Date.now();
            const check = () => {
                if (!this.isRunning) {
                    resolve();
                    return;
                }
                if (this.isPaused) {
                    requestAnimationFrame(check); // Spin wait if paused
                    return;
                }
                if (Date.now() - start >= ms) {
                    resolve();
                } else {
                    setTimeout(check, 10); // Check again in 10ms
                }
            };
            setTimeout(check, ms);
        });
    }

    _random(min, max) {
        // Arduino random(max) -> 0 to max-1
        // Arduino random(min, max) -> min to max-1
        if (max === undefined) {
            max = min;
            min = 0;
        }
        return Math.floor(Math.random() * (max - min)) + min;
    }

    // --- System ---

    log(msg, type = 'output') {
        const entry = { time: Date.now(), msg, type };
        this.consoleLog.push(entry);
        if (this.onLog) this.onLog(entry);
    }

    // Transpiler
    transpile(arduinoCode) {
        let code = arduinoCode;

        // 1. Remove comments
        code = code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

        // 2. Data Types
        // Replace 'int var[]' -> 'let var' (arrays)
        // Must happen before 'int var'
        // Matches: int name[]
        code = code.replace(/\b(int|float|long|double|boolean|byte|char|String|unsigned\s+int|unsigned\s+long)\s+(\w+)\s*\[\s*\]/g, 'let $2');

        // Replace 'int ' -> 'let '
        const types = ['int', 'float', 'long', 'double', 'boolean', 'byte', 'char', 'String', 'unsigned'];
        types.forEach(type => {
            const regex = new RegExp(`\\b${type}\\b\\s+`, 'g');
            code = code.replace(regex, 'let ');
        });

        // 3. Array Initialization: {1, 2, 3} -> [1, 2, 3]
        // Look for assignment to { ... }
        code = code.replace(/=\s*\{([\s\S]*?)\};/g, '= [$1];');

        // 4. Function Definitions
        // Identify all user-defined functions to handle 'await' later
        const functionNames = [];
        const funcDefRegex = /void\s+(\w+)\s*\(([^)]*)\)\s*\{/g;
        let match;
        // Make a passing copy to find names
        while ((match = funcDefRegex.exec(code)) !== null) {
            if (match[1] !== 'setup' && match[1] !== 'loop') {
                functionNames.push(match[1]);
            }
        }

        // Convert definitions to async
        code = code.replace(/void\s+setup\s*\(\s*\)\s*\{/g, 'async function user_setup() {');
        code = code.replace(/void\s+loop\s*\(\s*\)\s*\{/g, 'async function user_loop() {');
        // Other void functions
        code = code.replace(/void\s+(\w+)\s*\(([^)]*)\)\s*\{/g, 'async function $1($2) {');

        // 5. Function Calls & Await
        // delay -> await _delay
        code = code.replace(/\bdelay\s*\(/g, 'await _delay(');

        // user functions -> await func()
        functionNames.forEach(name => {
            // We need to match calls "name(" but NOT "async function name(" 
            // Since we already replaced "void name" with "async function name", 
            // we can use a negative lookbehind if supported, OR simply check that it's not preceded by 'function '

            // Simple, robust replacement:
            // 1. Replace all usages of 'name(' with 'await name('
            // 2. Fix the definition that we broke: 'async function await name(' back to 'async function name('

            const callRegex = new RegExp(`\\b${name}\\s*\\(`, 'g');
            code = code.replace(callRegex, `await ${name}(`);

            const fixDefRegex = new RegExp(`async\\s+function\\s+await\\s+${name}\\(`, 'g');
            code = code.replace(fixDefRegex, `async function ${name}(`);
        });

        // 6. System Functions & Constants
        code = code.replace(/\bpinMode\s*\(/g, '_pinMode(');
        code = code.replace(/\bdigitalWrite\s*\(/g, '_digitalWrite(');
        code = code.replace(/\banalogWrite\s*\(/g, '_analogWrite(');
        code = code.replace(/\brandom\s*\(/g, '_random(');

        code = code.replace(/\bHIGH\b/g, '1');
        code = code.replace(/\bLOW\b/g, '0');
        code = code.replace(/\bOUTPUT\b/g, '"OUTPUT"');
        code = code.replace(/\bINPUT\b/g, '"INPUT"');
        code = code.replace(/\bINPUT_PULLUP\b/g, '"INPUT_PULLUP"');

        // 7. Math functions wrapper (optional, ensuring Math is used)
        // Arduino 'sin', 'cos', etc -> Math.sin, Math.cos
        // But users usually use standard C math. JS Math is close.

        console.log("Transpiled Code:\n", code); // For debug
        return code;
    }

    async run(userCode) {
        if (this.isRunning) this.stop();
        this.isRunning = true;
        this.isPaused = false;
        this.resetPins();
        this.log("Compiling...", "system");

        try {
            const transpiledCode = this.transpile(userCode);

            // Create the execution context
            const _pinMode = this._pinMode.bind(this);
            const _digitalWrite = this._digitalWrite.bind(this);
            const _analogWrite = this._analogWrite.bind(this);
            const _delay = this._delay.bind(this);
            const _random = this._random.bind(this);

            // Create a safe-ish scope for variables
            // 'let' variables at top level of transpiled code need to be accessible to setup/loop
            // If we wrap everything in a function, they are closure variables. 
            // This works perfectly.

            const completeCode = `
                ${transpiledCode}
                return { user_setup, user_loop };
            `;

            const runFn = new Function('_pinMode', '_digitalWrite', '_analogWrite', '_delay', '_random', completeCode);

            const { user_setup, user_loop } = runFn(_pinMode, _digitalWrite, _analogWrite, _delay, _random);

            this.log("Upload execution started.", "system");

            // Run Setup
            if (user_setup) await user_setup();

            // Run Loop repeatedly
            if (user_loop) {
                while (this.isRunning) {
                    if (this.isPaused) {
                        await new Promise(r => setTimeout(r, 100));
                        continue;
                    }
                    await user_loop();
                    await new Promise(r => setTimeout(r, 10)); // Yield to event loop
                }
            } else {
                this.log("No loop() function found.", "error");
            }

        } catch (e) {
            this.log(e.toString(), "error");
            console.error(e);
            this.stop();
        }
    }

    stop() {
        this.isRunning = false;
        this.loopId = null;
        this.log("Execution stopped.", "system");
        this.resetPins();
        if (this.onPinChange) {
            Object.keys(this.pins).forEach(p => this.onPinChange(p, 0, 0));
        }
    }

    pause() {
        this.isPaused = true;
        this.log("Execution paused.", "system");
    }

    resume() {
        this.isPaused = false;
        this.log("Execution resumed.", "system");
    }
}
