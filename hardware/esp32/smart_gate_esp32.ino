/**
 * Smart Gate — ESP32 Wi-Fi Controller
 * =====================================
 * Replaces the Arduino Uno + USB cable with a Wi-Fi gate controller.
 *
 * Hardware:
 *   - ESP32 DevKit V1 (WROOM-32)
 *   - SG90 servo on GPIO 13 (PWM) — powered from 5V/VIN pin
 *   - Physical button on GPIO 4 → GND (INPUT_PULLUP, pressed = LOW)
 *   - Powered by any USB phone charger
 *
 * Network:
 *   - Creates its OWN hotspot (SoftAP):  SSID "SmartGate-Gate1"
 *                                        Pass  "smartgate123"
 *   - Tablet connects to the hotspot and opens a WebSocket to
 *     ws://192.168.4.1:81  (no internet / broker needed)
 *
 * Protocol (identical to the old USB serial protocol, over WebSocket):
 *   Tablet → ESP32:  'O' = open gate    'C' = close gate    'S' = status query
 *   ESP32 → Tablet:  'R' = ready        'K' = command ack   'B' = button pressed
 *                    'S:IDLE' / 'S:OPEN' / 'S:OPENING' / 'S:CLOSING' / 'S:ERROR'
 *
 * State machine: IDLE → OPENING → OPEN (auto-close 5s) → CLOSING → IDLE
 *
 * Libraries (Arduino IDE → Library Manager):
 *   - "WebSockets" by Markus Sattler (links2004)
 */

#include <WiFi.h>
#include <WebSocketsServer.h>
#include <Servo.h>

// ─── Pin Definitions ───────────────────────────────────────
const int SERVO_PIN = 13;
const int BUTTON_PIN = 4;
const int LED_PIN = 2; // ESP32 onboard LED

// ─── Servo Setup ───────────────────────────────────────────
Servo gateServo;
const int SERVO_OPEN = 90;
const int SERVO_CLOSE = 0;

// ─── Wi-Fi (SoftAP — own hotspot) ──────────────────────────
const char *AP_SSID = "SmartGate-Gate1";
const char *AP_PASS = "smartgate123"; // WPA2 needs >= 8 chars

// ─── WebSocket Server ──────────────────────────────────────
WebSocketsServer webSocket(81);

// ─── Gate State Machine ────────────────────────────────────
enum GateState {
  STATE_IDLE,
  STATE_OPENING,
  STATE_OPEN,
  STATE_CLOSING,
  STATE_ERROR,
};

GateState currentState = STATE_IDLE;
unsigned long stateStartTime = 0;

// ─── Timing ─────────────────────────────────────────────────
const unsigned long SERVO_TRANSIT_TIME = 1500; // ms for servo to move
const unsigned long AUTO_CLOSE_DELAY = 5000;   // 5 seconds open
const unsigned long BUTTON_COOLDOWN = 2000;    // Min time between presses
const unsigned long DEBOUNCE_DELAY = 50;       // Button debounce ms

// ─── Button ─────────────────────────────────────────────────
int lastButtonReading = HIGH; // INPUT_PULLUP: released = HIGH
unsigned long lastDebounceTime = 0;
unsigned long lastButtonPressTime = 0;

// ─── Status string helpers ──────────────────────────────────

const char *stateName(GateState s) {
  switch (s) {
    case STATE_IDLE:    return "IDLE";
    case STATE_OPENING: return "OPENING";
    case STATE_OPEN:    return "OPEN";
    case STATE_CLOSING: return "CLOSING";
    default:            return "ERROR";
  }
}

// ─── Setup ──────────────────────────────────────────────────

void setup() {
  Serial.begin(9600);
  Serial.println("\n[ESP32] Smart Gate controller booting...");

  // Servo
  gateServo.attach(SERVO_PIN);
  gateServo.write(SERVO_CLOSE);
  currentState = STATE_IDLE;

  // Button (pull-up: pressed = LOW)
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  // LED
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // Start own Wi-Fi hotspot
  WiFi.softAP(AP_SSID, AP_PASS);
  Serial.print("[ESP32] Hotspot ready: ");
  Serial.print(AP_SSID);
  Serial.print(" → http://");
  Serial.println(WiFi.softAPIP().toString());

  // WebSocket server
  webSocket.begin();
  webSocket.onEvent(handleWebSocketEvent);
  Serial.println("[ESP32] WebSocket server on ws://192.168.4.1:81");

  // Signal ready (broadcast once someone connects; also over Serial)
  Serial.println("R");
  blinkLed(3);
}

// ─── Main Loop ──────────────────────────────────────────────

void loop() {
  webSocket.loop();

  handleSerialCommands(); // Serial mirror (debugging / wired fallback)
  handleButton();
  updateStateMachine();
  updateStatusLED();

  delay(5);
}

// ─── WebSocket Event Handler ────────────────────────────────

void handleWebSocketEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.printf("[ESP32] Tablet connected (client %u)\n", num);
      webSocket.sendTXT(num, "R"); // Ready signal
      webSocket.sendTXT(num, String("S:") + stateName(currentState));
      break;

    case WStype_DISCONNECTED:
      Serial.printf("[ESP32] Tablet disconnected (client %u)\n", num);
      break;

    case WStype_TEXT: {
      if (length == 0) break;
      char cmd = (char)payload[0];
      handleCommand(cmd);
      break;
    }

    default:
      break;
  }
}

// ─── Command Handler (shared by WebSocket + Serial) ─────────

void handleCommand(char cmd) {
  switch (cmd) {
    case 'O': // Open gate
      if (currentState == STATE_IDLE) {
        transitionTo(STATE_OPENING);
        sendToTablet("K"); // Acknowledge
      }
      break;

    case 'C': // Close gate
      if (currentState == STATE_OPEN) {
        transitionTo(STATE_CLOSING);
        sendToTablet("K");
      } else if (currentState == STATE_OPENING) {
        // Interrupt opening — immediately close
        gateServo.write(SERVO_CLOSE);
        transitionTo(STATE_CLOSING);
        sendToTablet("K");
      }
      break;

    case 'S': // Status query
      sendState();
      break;

    default:
      // Unknown command — ignore
      break;
  }
}

void handleSerialCommands() {
  if (Serial.available() <= 0) return;
  char cmd = (char)Serial.read();
  handleCommand(cmd);
}

// ─── Button Handler (debounced, pull-up) ────────────────────

void handleButton() {
  int reading = digitalRead(BUTTON_PIN);

  if (reading != lastButtonReading) {
    lastDebounceTime = millis();
  }

  if ((millis() - lastDebounceTime) > DEBOUNCE_DELAY) {
    if (reading == LOW && lastButtonReading == HIGH) {
      // Button pressed — check cooldown
      unsigned long now = millis();
      if (now - lastButtonPressTime > BUTTON_COOLDOWN) {
        lastButtonPressTime = now;

        // Notify tablet
        sendToTablet("B");

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
  sendState(); // Broadcast every state change (feedback loop)
}

void updateStateMachine() {
  unsigned long now = millis();
  unsigned long elapsed = now - stateStartTime;

  switch (currentState) {
    case STATE_IDLE:
      break;

    case STATE_OPENING:
      gateServo.write(SERVO_OPEN);
      if (elapsed >= SERVO_TRANSIT_TIME) {
        transitionTo(STATE_OPEN);
      }
      break;

    case STATE_OPEN:
      // Auto-close after delay
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
      break;
  }
}

// ─── Messaging ──────────────────────────────────────────────

void sendToTablet(const String &msg) {
  webSocket.broadcastTXT(msg);
  Serial.println(msg); // Mirror to Serial for debugging
}

void sendState() {
  String msg = String("S:") + stateName(currentState);
  sendToTablet(msg);
}

// ─── LED Status ─────────────────────────────────────────────

void updateStatusLED() {
  switch (currentState) {
    case STATE_IDLE:
      digitalWrite(LED_PIN, LOW);
      break;
    case STATE_OPENING:
    case STATE_CLOSING:
      digitalWrite(LED_PIN, (millis() / 200) % 2 == 0 ? HIGH : LOW);
      break;
    case STATE_OPEN:
      digitalWrite(LED_PIN, HIGH);
      break;
    case STATE_ERROR:
      digitalWrite(LED_PIN, (millis() / 500) % 2 == 0 ? HIGH : LOW);
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