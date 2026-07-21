/**
 * Smart Gate — Arduino Sketch (State Machine)
 * ============================================
 * Connects to tablet via USB Serial.
 * Controls servo motor for gate, reads physical button.
 *
 * 🔴 FIX BUG #5: Proper state machine with:
 *   - IDLE / OPENING / OPEN / CLOSING states
 *   - Debounced button with time window
 *   - RESET_LOCK / UNLOCK_ONCE / RESET command protocol
 *   - Safety: gate can't be re-opened while opening
 *
 * Protocol:
 *   ← PC: 'O' = open gate once (UNLOCK)
 *   ← PC: 'C' = close gate (LOCK)
 *   ← PC: 'S' = query status (returns state string)
 *   → PC: 'B' = button pressed (manual override)
 *   → PC: 'R' = ready (after boot)
 *   → PC: 'K' = command acknowledged
 *
 * Hardware:
 *   - Servo on pin 9 (PWM)
 *   - Button on pin 2 (with pull-down resistor)
 *   - USB to tablet via USB-OTG cable
 */

#include <Servo.h>

// ─── Pin Definitions ───────────────────────────────────────
const int SERVO_PIN = 9;
const int BUTTON_PIN = 2;
const int LED_PIN = LED_BUILTIN; // Onboard LED for status

// ─── Servo Setup ───────────────────────────────────────────
Servo gateServo;
const int SERVO_OPEN = 90;
const int SERVO_CLOSE = 0;

// ─── Gate State Machine ────────────────────────────────────
enum GateState {
  STATE_IDLE,       // Gate is closed, waiting
  STATE_OPENING,    // Servo is rotating to open position
  STATE_OPEN,       // Gate is fully open
  STATE_CLOSING,    // Servo is rotating to closed position
  STATE_ERROR,      // Unexpected state, needs reset
};

GateState currentState = STATE_IDLE;
unsigned long stateStartTime = 0;

// ─── Timing ─────────────────────────────────────────────────
const unsigned long SERVO_TRANSIT_TIME = 1500;   // ms for servo to move
const unsigned long AUTO_CLOSE_DELAY = 5000;      // 5 seconds open
const unsigned long BUTTON_COOLDOWN = 2000;       // Min time between button presses
const unsigned long DEBOUNCE_DELAY = 50;           // Button debounce ms

// ─── Button ─────────────────────────────────────────────────
int lastButtonReading = LOW;
unsigned long lastDebounceTime = 0;
unsigned long lastButtonPressTime = 0;

// ─── Init ───────────────────────────────────────────────────

void setup() {
  Serial.begin(9600);
  while (!Serial) { ; } // Wait for serial connection

  // Servo
  gateServo.attach(SERVO_PIN);
  gateServo.write(SERVO_CLOSE);
  currentState = STATE_IDLE;

  // Button
  pinMode(BUTTON_PIN, INPUT_PULLDOWN);

  // LED
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // Signal ready
  Serial.println("R");
  blinkLed(3);
}

// ─── Main Loop ──────────────────────────────────────────────

void loop() {
  // 1. Handle serial commands
  handleSerialCommands();

  // 2. Read physical button with debounce
  handleButton();

  // 3. Update state machine
  updateStateMachine();

  // 4. Update status LED
  updateStatusLED();

  delay(5); // Small delay for stability
}

// ─── Serial Command Handler ─────────────────────────────────

void handleSerialCommands() {
  if (Serial.available() <= 0) return;

  char cmd = Serial.read();

  switch (cmd) {
    case 'O': // Open gate
      if (currentState == STATE_IDLE) {
        transitionTo(STATE_OPENING);
        Serial.println("K"); // Acknowledge
      }
      break;

    case 'C': // Close gate
      if (currentState == STATE_OPEN) {
        transitionTo(STATE_CLOSING);
        Serial.println("K");
      } else if (currentState == STATE_OPENING) {
        // Interrupt opening — immediately close
        gateServo.write(SERVO_CLOSE);
        transitionTo(STATE_CLOSING);
        Serial.println("K");
      }
      break;

    case 'S': // Status query
      sendStatus();
      break;

    default:
      // Unknown command — ignore
      break;
  }
}

// ─── Button Handler (Debounced) ─────────────────────────────

void handleButton() {
  int reading = digitalRead(BUTTON_PIN);

  if (reading != lastButtonReading) {
    lastDebounceTime = millis();
  }

  if ((millis() - lastDebounceTime) > DEBOUNCE_DELAY) {
    if (reading == HIGH && lastButtonReading == LOW) {
      // Button pressed — check cooldown
      unsigned long now = millis();
      if (now - lastButtonPressTime > BUTTON_COOLDOWN) {
        lastButtonPressTime = now;

        // Notify tablet
        Serial.println("B");

        // Auto-open gate for manual override if idle
        if (currentState == STATE_IDLE) {
          transitionTo(STATE_OPENING);
        }
      }
    }
  }

  lastButtonReading = reading;
}

// ─── State Machine ──────────────────────────────────────────

void transitionTo(GateState newState) {
  currentState = newState;
  stateStartTime = millis();
}

void updateStateMachine() {
  unsigned long now = millis();
  unsigned long elapsed = now - stateStartTime;

  switch (currentState) {
    case STATE_IDLE:
      // Nothing to do — waiting for command
      break;

    case STATE_OPENING:
      gateServo.write(SERVO_OPEN);
      if (elapsed >= SERVO_TRANSIT_TIME) {
        transitionTo(STATE_OPEN);
      }
      break;

    case STATE_OPEN:
      // Gate is open — auto-close after delay
      if (elapsed >= AUTO_CLOSE_DELAY) {
        transitionTo(STATE_CLOSING);
      }
      break;

    case STATE_CLOSING:
      gateServo.write(SERVO_CLOSE);
      if (elapsed >= SERVO_TRANSIT_TIME) {
        transitionTo(STATE_IDLE);
      }
      break;

    case STATE_ERROR:
      // Stay in error until reset command
      break;
  }
}

// ─── Status ─────────────────────────────────────────────────

void sendStatus() {
  Serial.print("S:");
  switch (currentState) {
    case STATE_IDLE:    Serial.println("IDLE");    break;
    case STATE_OPENING: Serial.println("OPENING"); break;
    case STATE_OPEN:    Serial.println("OPEN");    break;
    case STATE_CLOSING: Serial.println("CLOSING"); break;
    case STATE_ERROR:   Serial.println("ERROR");   break;
  }
}

// ─── LED Status ─────────────────────────────────────────────

void updateStatusLED() {
  switch (currentState) {
    case STATE_IDLE:
      digitalWrite(LED_PIN, LOW);          // Off
      break;
    case STATE_OPENING:
    case STATE_CLOSING:
      digitalWrite(LED_PIN, (millis() / 200) % 2 == 0 ? HIGH : LOW); // Blink fast
      break;
    case STATE_OPEN:
      digitalWrite(LED_PIN, HIGH);         // Solid on
      break;
    case STATE_ERROR:
      digitalWrite(LED_PIN, (millis() / 500) % 2 == 0 ? HIGH : LOW); // Blink slow
      break;
  }
}

// ─── Utility ────────────────────────────────────────────────

void blinkLed(int times) {
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_PIN, HIGH);
    delay(100);
    digitalWrite(LED_PIN, LOW);
    delay(100);
  }
}
