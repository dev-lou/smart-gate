/**
 * Smart Gate — ESP32 Wi-Fi Controller
 * =====================================
 * Replaces the Arduino Uno + USB cable with a Wi-Fi gate controller.
 *
 * Hardware:
 *   - ESP32 DevKit V1 (WROOM-32)
 *   - SG90 servo on GPIO 13 (PWM) — powered from 5V/VIN pin
 *   - Physical button on GPIO 4 → GND (INPUT_PULLUP): tap = manual gate
 *     override, hold 10 s = forget Wi-Fi and reboot to defaults
 *   - Powered by any USB phone charger
 *
 * Network:
 *   - Always creates its OWN hotspot (SoftAP), stored in NVS:
 *       default SSID "SmartGate-Gate1" / Pass "smartgate123"
 *   - Optionally joins an upstream Wi-Fi network (STA) — home router or
 *     school LAN — while the hotspot stays up, so the kiosk keeps working
 *     at ws://192.168.4.1:81 either way.
 *   - Provisioning portal at http://192.168.4.1/ (port 80, captive-portal
 *     DNS redirect): scan + join a network (SSID + password), rename the
 *     hotspot, or forget everything.
 *   - Shared gate button on GPIO 4: hold 10 s to forget saved credentials
 *     and reboot back to defaults (LED fast-blinks while a hold registers).
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
 * Libraries (Arduino IDE → Library Manager, PlatformIO → lib_deps):
 *   - "WebSockets" by Markus Sattler (links2004)
 *   - "ESP32Servo" by Kevin Harrington (madhephaestus)
 */

#include <WiFi.h>
#include <WebSocketsServer.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <ESP32Servo.h>

// ─── Pin Definitions ───────────────────────────────────────
const int SERVO_PIN = 13;
const int BUTTON_PIN = 4; // tap = gate override, hold 10 s = Wi-Fi reset
const int LED_PIN = 2; // ESP32 onboard LED

// ─── Servo Setup (GPIO 13 barrier arm, external 5 V supply + common GND) ──
//
// Travel calibration. `write(angle)` maps 0-180 onto the attached pulse range
// (1000-2000 us), so a 0 -> 90 command only ever uses HALF the horn's throw —
// that is why the arm stopped around 45 deg of real movement. A full open now
// drives the far end of the range (180 deg). If the arm bottoms out against
// the linkage before that, nudge down with '-' and press 'Z' to save it in
// NVS; the value survives reboots and reflashes. Resting pose stays 0 deg.
Servo gateServo;
const int SERVO_CLOSE = 0;               // resting pose — the arm parks here
const int SERVO_OPEN_DEFAULT = 180;      // full horn throw
int servoOpenAngle = SERVO_OPEN_DEFAULT; // calibrated open pose (NVS)
int servoTestAngle = SERVO_CLOSE;        // last angle written (bench sweep/nudge)

// ─── Wi-Fi provisioning (SoftAP + optional upstream STA) ───
// Everything persists in NVS ("smartgate" namespace). Hold the shared
// GPIO 4 button for 10 s to forget it all and reboot to defaults.
const char *DEFAULT_AP_SSID = "SmartGate-Gate1";
const char *DEFAULT_AP_PASS = "smartgate123"; // WPA2 needs >= 8 chars
String apSsid;   // this device's own hotspot
String apPass;
String staSsid;  // upstream network to join (blank = hotspot only)
String staPass;
WebServer webServer(80);
DNSServer dnsServer;
bool wifiResetHeld = false;
const unsigned long WIFI_RESET_HOLD_MS = 10000; // hold-to-reset time

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

  // Servo (50 Hz analog servo: SG90 / MG996R)
  loadServoConfig();
  gateServo.setPeriodHertz(50);
  gateServo.attach(SERVO_PIN, 1000, 2000);
  gateServo.write(SERVO_CLOSE);
  currentState = STATE_IDLE;
  Serial.print("[ESP32] Servo attached on GPIO ");
  Serial.print(SERVO_PIN);
  Serial.print(" (closed = ");
  Serial.print(SERVO_CLOSE);
  Serial.print(" deg, open = ");
  Serial.print(servoOpenAngle);
  Serial.println(" deg - calibrate with + / - then Z)");

  // Button (pull-up: pressed = LOW)
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  // LED
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // Bring up the hotspot first (SSID/pass from NVS, else defaults),
  // then try to join the saved upstream network as a station.
  loadWifiConfig();
  startAccessPoint();
  startStation();

  // Provisioning portal (http://192.168.4.1/) + captive-portal DNS
  webServer.on("/", HTTP_GET, handlePortalRoot);
  webServer.on("/save", HTTP_POST, handlePortalSave);        // hotspot settings
  webServer.on("/wifi", HTTP_POST, handlePortalSaveWifi);    // upstream network
  webServer.on("/reset", HTTP_POST, handlePortalReset);      // forget everything
  webServer.onNotFound([]() {
    webServer.sendHeader("Location", "http://192.168.4.1/", true);
    webServer.send(302, "text/plain", "Redirect to config portal");
  });
  webServer.begin();
  dnsServer.start(53, "*", WiFi.softAPIP());
  Serial.println("[ESP32] Config portal: http://192.168.4.1/ (join the hotspot to set up Wi-Fi)");

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
  dnsServer.processNextRequest();
  webServer.handleClient();

  handleSerialCommands(); // Serial mirror (debugging / wired fallback)
  handleButton();
  updateStateMachine();
  updateStatusLED();
  updateWifiStatus();

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

    // ── Bench checks (serial only; harmless from the tablet) ──
    case 'W': // watch the button pin for 120 s (wiring diagnosis)
      watchButton(120000);
      break;

    case 'P': // scan every free GPIO so a mis-wired button can be located
      scanPins(120000);
      break;

    case 'T': // full servo sweep, 0 -> 180 -> 0
      if (currentState == STATE_IDLE) {
        runServoSweep();
      } else {
        Serial.println("[ESP32] Servo test ignored - gate is mid-cycle");
      }
      break;

    case 'M': // centre the horn (90 deg)
      if (currentState == STATE_IDLE) writeServoAngle(90);
      break;

    case '+': // nudge 15 deg open
      if (currentState == STATE_IDLE) writeServoAngle(servoTestAngle + 15);
      break;

    case '-': // nudge 15 deg closed
      if (currentState == STATE_IDLE) writeServoAngle(servoTestAngle - 15);
      break;

    case 'Z': // save the current horn position as the OPEN pose (persists)
      if (currentState == STATE_IDLE) {
        servoOpenAngle = servoTestAngle;
        saveServoConfig();
        Serial.print("[ESP32] Open pose saved: ");
        Serial.print(servoOpenAngle);
        Serial.println(" deg");
      }
      break;

    case 'X': // forget the saved pose, back to the default full throw
      if (currentState == STATE_IDLE) {
        servoOpenAngle = SERVO_OPEN_DEFAULT;
        saveServoConfig();
        writeServoAngle(SERVO_CLOSE);
        Serial.println("[ESP32] Open pose reset to default (180 deg)");
      }
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

// ─── Servo bench test ──────────────────────────────────────
// The gate protocol can be perfect while the arm never moves: that points at
// the signal wire, the servo supply or a missing common ground. These helpers
// drive the horn directly so a wiring fault can be told apart from a logic one.

void writeServoAngle(int angle) {
  servoTestAngle = constrain(angle, 0, 180);
  gateServo.write(servoTestAngle);
  Serial.print("[ESP32] Servo -> ");
  Serial.print(servoTestAngle);
  Serial.print(" deg");
  if (servoTestAngle == servoOpenAngle) Serial.print(" (open pose)");
  Serial.println();
}

// Open pose lives in NVS (namespace "smartgate", key open_deg) so the arm can
// be dialled in by eye and survive reboots without reflashing.
void loadServoConfig() {
  Preferences prefs;
  prefs.begin("smartgate", true);
  servoOpenAngle = prefs.getInt("open_deg", SERVO_OPEN_DEFAULT);
  prefs.end();
  servoOpenAngle = constrain(servoOpenAngle, 10, 180);
}

void saveServoConfig() {
  Preferences prefs;
  prefs.begin("smartgate", false);
  prefs.putInt("open_deg", servoOpenAngle);
  prefs.end();
}

// Prints every raw level change of the button pin while still running the
// normal handler, so a dead button can be told apart from a wiring fault.
void watchButton(unsigned long durationMs) {
  Serial.println("[ESP32] Button watch for 120 s - press it now");
  int prev = digitalRead(BUTTON_PIN);
  Serial.print("[ESP32] Button starts ");
  Serial.println(prev == LOW ? "LOW (pressed)" : "HIGH (released)");
  unsigned long started = millis();
  while (millis() - started < durationMs) {
    int level = digitalRead(BUTTON_PIN);
    if (level != prev) {
      prev = level;
      Serial.print("[ESP32] Button -> ");
      Serial.println(level == LOW ? "LOW (pressed)" : "HIGH (released)");
    }
    handleButton();
    delay(2);
  }
  Serial.println("[ESP32] Button watch done");
}

// Reports which header pin actually changes level, so a button wired to the
// wrong hole (or a dead row on the breadboard) can be found in one pass.
void scanPins(unsigned long durationMs) {
  const int pins[] = {4, 0, 5, 12, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33};
  const int count = sizeof(pins) / sizeof(pins[0]);
  int last[18];

  for (int i = 0; i < count; i++) pinMode(pins[i], INPUT_PULLUP);
  delay(60);
  for (int i = 0; i < count; i++) last[i] = digitalRead(pins[i]);

  Serial.println("[ESP32] Pin scan for 120 s - press the button / touch the jumper now");
  unsigned long started = millis();
  while (millis() - started < durationMs) {
    for (int i = 0; i < count; i++) {
      int level = digitalRead(pins[i]);
      if (level != last[i]) {
        last[i] = level;
        Serial.print("[ESP32] GPIO");
        Serial.print(pins[i]);
        Serial.print(" -> ");
        Serial.println(level == LOW ? "LOW (closed to GND)" : "HIGH (released)");
      }
    }
    delay(100);
  }
  Serial.println("[ESP32] Pin scan done");
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
}

void runServoSweep() {
  Serial.println("[ESP32] Servo sweep 0 -> 180 -> 0 (watch the horn)");
  const int path[] = {0, 30, 60, 90, 120, 150, 180, 120, 60, 0};
  for (unsigned int i = 0; i < sizeof(path) / sizeof(path[0]); i++) {
    writeServoAngle(path[i]);
    delay(700);
  }
  writeServoAngle(SERVO_CLOSE);
  Serial.println("[ESP32] Sweep done - no movement means signal, power or ground");
}

// ─── Button Handler (debounced, pull-up) ────────────────────
// Tap = manual gate override. Hold 10 s = forget Wi-Fi, reboot to
// defaults (LED fast-blinks after ~1.5 s so the hold reads as intentional).

void handleButton() {
  static int stableState = HIGH;
  static unsigned long pressStart = 0;
  static bool resetTriggered = false;
  unsigned long now = millis();
  int reading = digitalRead(BUTTON_PIN);

  if (reading != lastButtonReading) {
    lastDebounceTime = now;
  }
  lastButtonReading = reading;

  if ((now - lastDebounceTime) <= DEBOUNCE_DELAY) return;

  if (reading != stableState) {
    stableState = reading;
    if (stableState == LOW) {
      // Fresh press — manual override (with cooldown)
      pressStart = now;
      resetTriggered = false;
      if (now - lastButtonPressTime > BUTTON_COOLDOWN) {
        lastButtonPressTime = now;
        sendToTablet("B"); // Notify tablet
        if (currentState == STATE_IDLE) {
          transitionTo(STATE_OPENING);
        }
      }
    } else {
      // Released
      pressStart = 0;
      wifiResetHeld = false;
    }
    return;
  }

  // Still in the same stable state — check for a 10 s hold
  if (stableState == LOW && pressStart != 0) {
    unsigned long held = now - pressStart;
    if (held >= 1500) wifiResetHeld = true; // LED feedback: hold is registering
    if (!resetTriggered && held >= WIFI_RESET_HOLD_MS) {
      resetTriggered = true;
      wifiResetHeld = false;
      Preferences prefs;
      prefs.begin("smartgate", false);
      prefs.clear();
      prefs.end();
      Serial.println("[ESP32] Wi-Fi reset (10 s hold): credentials cleared, rebooting to defaults");
      blinkLed(5);
      ESP.restart();
    }
  }
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
      gateServo.write(servoOpenAngle);
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

void sendToTablet(String msg) {
  webSocket.broadcastTXT(msg);
  Serial.println(msg); // Mirror to Serial for debugging
}

void sendState() {
  String msg = String("S:") + stateName(currentState);
  sendToTablet(msg);
}

// ─── Wi-Fi provisioning ─────────────────────────────────────
//
// Two independent things are stored in NVS (namespace "smartgate"):
//   ssid / pass          → the gate's OWN hotspot (SoftAP)
//   sta_ssid / sta_pass  → upstream network the gate joins (STA)
//
// The hotspot always stays up, so the kiosk's ws://192.168.4.1:81
// keeps working even after the gate joins a school/home network.

void loadWifiConfig() {
  Preferences prefs;
  prefs.begin("smartgate", true); // read-only
  apSsid = prefs.getString("ssid", DEFAULT_AP_SSID);
  apPass = prefs.getString("pass", DEFAULT_AP_PASS);
  staSsid = prefs.getString("sta_ssid", "");
  staPass = prefs.getString("sta_pass", "");
  prefs.end();

  apSsid.trim();
  staSsid.trim();
  if (apSsid.length() == 0 || apSsid.length() > 32) apSsid = DEFAULT_AP_SSID;
  if (apPass.length() > 0 && apPass.length() < 8) apPass = DEFAULT_AP_PASS; // WPA2 minimum
  if (apPass.length() > 63) apPass = DEFAULT_AP_PASS;
  if (staSsid.length() > 32) staSsid = "";
}

void startAccessPoint() {
  // AP + STA when an upstream network is configured, AP-only otherwise.
  WiFi.mode(staSsid.length() > 0 ? WIFI_AP_STA : WIFI_AP);
  bool ok = (apPass.length() == 0)
      ? WiFi.softAP(apSsid.c_str()) // open hotspot (no password stored)
      : WiFi.softAP(apSsid.c_str(), apPass.c_str());
  if (!ok) { // fall back to defaults if the saved values fail
    apSsid = DEFAULT_AP_SSID;
    apPass = DEFAULT_AP_PASS;
    WiFi.softAP(apSsid.c_str(), apPass.c_str());
  }
  Serial.print("[ESP32] Hotspot ready: ");
  Serial.print(apSsid);
  Serial.print(" -> http://");
  Serial.println(WiFi.softAPIP().toString());
}

void startStation() {
  if (staSsid.length() == 0) {
    Serial.println("[ESP32] Upstream Wi-Fi: none saved (hotspot only)");
    return;
  }
  Serial.print("[ESP32] Joining saved network: ");
  Serial.println(staSsid);

  WiFi.begin(staSsid.c_str(), staPass.c_str());

  // Give it a head start (15 s) but never block the gate indefinitely:
  // the driver keeps retrying in the background either way.
  unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 15000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[ESP32] Joined ");
    Serial.print(staSsid);
    Serial.print(" -> http://");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("[ESP32] Upstream Wi-Fi unavailable (hotspot still up, retrying in background)");
  }
}

void updateWifiStatus() {
  static unsigned long lastCheck = 0;
  static bool wasConnected = false;
  if (millis() - lastCheck < 5000) return;
  lastCheck = millis();

  bool nowConnected = (WiFi.status() == WL_CONNECTED);
  if (nowConnected == wasConnected) return;
  wasConnected = nowConnected;

  if (nowConnected) {
    Serial.print("[ESP32] Upstream Wi-Fi connected -> http://");
    Serial.println(WiFi.localIP());
  } else if (staSsid.length() > 0) {
    Serial.println("[ESP32] Upstream Wi-Fi dropped, retrying...");
  }
}

// ─── Portal page (embedded UI) ─────────────────────────────

const char *PORTAL_CSS = R"CSS(
*{box-sizing:border-box}
body{margin:0;padding:26px 16px 40px;background:#0b1017;color:#e7eef6;
font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
background-image:radial-gradient(900px 420px at 15% -12%,rgba(45,212,191,.16),transparent 70%);
-webkit-text-size-adjust:100%}
.wrap{max-width:560px;margin:0 auto}
.top{display:flex;align-items:center;gap:12px;margin-bottom:18px}
.dot{flex:0 0 auto;width:11px;height:11px;border-radius:50%;background:#2dd4bf;
box-shadow:0 0 14px rgba(45,212,191,.9)}
.kicker{font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:#7d8b9c;font-weight:800}
h1{font-size:22px;margin:3px 0 0;letter-spacing:-.015em;font-weight:700}
.chips{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 18px}
.chip{font-size:11.5px;padding:6px 11px;border:1px solid #24313f;border-radius:999px;
background:#121a24;color:#9fb0c2;white-space:nowrap}
.chip b{color:#e7eef6;font-weight:650}
.chip.ok{border-color:#1d5c4c;background:#0f2a24;color:#6ee7b7}
.chip.warn{border-color:#6b4a14;background:#251c0d;color:#fbbf24}
.card{background:#101823;border:1px solid #1e2a38;border-radius:16px;padding:18px;margin-bottom:13px}
.card h2{font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:#8fa0b3;
margin:0 0 6px;font-weight:800}
.card p.sub{margin:0 0 6px;font-size:12.5px;color:#7d8b9c}
label{display:block;font-size:11.5px;color:#93a3b5;margin:13px 0 6px;font-weight:700;
letter-spacing:.02em}
input,select{width:100%;padding:11px 12px;border-radius:10px;border:1px solid #26333f;
background:#0b141d;color:#e7eef6;font-size:15px;outline:none;-webkit-appearance:none;
appearance:none}
select{background-image:linear-gradient(45deg,transparent 50%,#5c6b7b 50%),
linear-gradient(135deg,#5c6b7b 50%,transparent 50%);
background-position:calc(100% - 18px) 19px,calc(100% - 13px) 19px;
background-size:5px 5px,5px 5px;background-repeat:no-repeat;padding-right:36px}
input:focus,select:focus{border-color:#2dd4bf;box-shadow:0 0 0 3px rgba(45,212,191,.15)}
button{width:100%;margin-top:16px;padding:12px 16px;border:0;border-radius:10px;
background:#2dd4bf;color:#04241e;font-size:14px;font-weight:800;letter-spacing:.02em;
cursor:pointer;font-family:inherit}
button:active{transform:translateY(1px)}
button.ghost{background:#1a2532;color:#d7e2ee;border:1px solid #2a3a4a}
button.danger{background:#2a1315;color:#fca5a5;border:1px solid #5b1f24}
.hint{font-size:11.5px;color:#6f7f90;margin:11px 0 0;line-height:1.6}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:#a7f3d0}
a.link{color:#5eead4;text-decoration:none;font-weight:700}
.foot{text-align:center;font-size:10.5px;color:#55636f;margin-top:20px;line-height:1.7}
.notice{padding:14px 16px;border-radius:12px;border:1px solid #1d5c4c;background:#0f2a24;
color:#a7f3d0;font-size:13.5px;margin-bottom:14px}
.notice.err{border-color:#5b1f24;background:#2a1315;color:#fca5a5}
)CSS";

String escHtml(const String &s) {
  String out;
  out.reserve(s.length() + 8);
  for (unsigned int i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '&') out += "&amp;";
    else if (c == '<') out += "&lt;";
    else if (c == '>') out += "&gt;";
    else if (c == '"') out += "&quot;";
    else if (c == '\'') out += "&#39;";
    else out += c;
  }
  return out;
}

String chip(const char *label, const String &value, const char *cls) {
  return String("<span class='chip ") + cls + "'>" + label + ": <b>" + value + "</b></span>";
}

void sendPortalPage(const String &inner, const char *title, int code = 200) {
  String html;
  html.reserve(inner.length() + 1400);
  html += F("<!doctype html><html lang='en'><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>");
  html += title;
  html += F("</title><style>");
  html += PORTAL_CSS;
  html += F("</style></head><body><div class='wrap'>");
  html += inner;
  html += F("<p class='foot'>Smart Gate &middot; ESP32 gate controller</p></div></body></html>");
  webServer.send(code, "text/html; charset=utf-8", html);
}

void handlePortalRoot() {
  // Scan for nearby networks — blocking (~2-4 s) but this page is only
  // opened while provisioning, never during normal gate operation.
  int found = WiFi.scanNetworks();
  bool staUp = (WiFi.status() == WL_CONNECTED);

  String html;
  html.reserve(7600);

  html += F("<div class='top'><span class='dot'></span><div>"
            "<div class='kicker'>Smart Gate</div>"
            "<h1>Gate 1 &middot; Wi-Fi setup</h1></div></div>");

  html += F("<div class='chips'>");
  html += chip("Gate", stateName(currentState), currentState == STATE_ERROR ? "warn" : "ok");
  html += chip("Hotspot", escHtml(apSsid), "ok");
  html += chip("Address", WiFi.softAPIP().toString(), "");
  if (staUp) {
    html += chip("Network", escHtml(staSsid) + " &middot; " + WiFi.localIP().toString(), "ok");
  } else if (staSsid.length() > 0) {
    html += chip("Network", "retrying", "warn");
  } else {
    html += chip("Network", "not set", "warn");
  }
  html += F("</div>");

  // ── Card 1: join an upstream network ──
  html += F("<div class='card'><h2>Join a network</h2>"
            "<p class='sub'>The gate joins your router or school Wi-Fi. Its own hotspot "
            "stays online, so the kiosk always reaches it at "
            "<code>ws://192.168.4.1:81</code>.</p>"
            "<form method='POST' action='/wifi'>"
            "<label>Detected networks</label>"
            "<select name='net'><option value=''>&mdash; pick a network &mdash;</option>");
  if (found <= 0) {
    html += F("<option value='' disabled>No networks found &mdash; type the name below</option>");
  } else {
    String seen[16];
    int seenCount = 0;
    for (int i = 0; i < found && seenCount < 16; i++) {
      String name = WiFi.SSID(i);
      if (name.length() == 0) continue;

      bool duplicate = false;
      for (int j = 0; j < seenCount; j++) {
        if (seen[j] == name) { duplicate = true; break; }
      }
      if (duplicate) continue;
      seen[seenCount++] = name;

      bool secured = (WiFi.encryptionType(i) != WIFI_AUTH_OPEN);
      html += F("<option value='");
      html += escHtml(name);
      html += F("'>");
      html += escHtml(name);
      html += F(" &middot; ");
      html += String(WiFi.RSSI(i));
      html += F(" dBm");
      html += secured ? F(" &middot; secured") : F(" &middot; open");
      html += F("</option>");
    }
  }
  html += F("</select>"
            "<label>Network name (SSID)</label>"
            "<input name='ssid' maxlength='32' autocapitalize='none' autocorrect='off' "
            "spellcheck='false' placeholder='Use this for hidden or missing networks'>"
            "<label>Network password</label>"
            "<input name='pass' type='password' maxlength='63' placeholder='Leave blank if the network is open'>"
            "<button type='submit'>Connect &amp; reboot</button>"
            "<p class='hint'>");
  if (staUp) {
    html += String("Connected to <b>") + escHtml(staSsid) + "</b> at " + WiFi.localIP().toString();
  } else if (staSsid.length() > 0) {
    html += String("Saved network <b>") + escHtml(staSsid) +
            "</b> is not reachable &mdash; re-enter the password if it changed.";
  } else {
    html += F("No network saved yet &mdash; the gate is hotspot-only.");
  }
  html += F(" <a class='link' href='/'>Rescan</a></p></div>");

  // ── Card 2: the gate's own hotspot ──
  html += F("<div class='card'><h2>Gate hotspot</h2>"
            "<p class='sub'>This is the network the kiosk tablet joins.</p>"
            "<form method='POST' action='/save'>"
            "<label>Hotspot name (SSID)</label>"
            "<input name='ssid' maxlength='32' value='");
  html += escHtml(apSsid);
  html += F("'><label>New hotspot password</label>"
            "<input name='pass' type='password' maxlength='63' placeholder='8+ characters &mdash; blank keeps the current one'>"
            "<button type='submit' class='ghost'>Save hotspot</button>"
            "<p class='hint'>WPA2 requires 8+ characters. The gate reboots to apply it.</p></form></div>");

  // ── Card 3: reset ──
  html += F("<div class='card'><h2>Reset</h2>"
            "<p class='sub'>Forget the hotspot settings and the joined network.</p>"
            "<form method='POST' action='/reset' "
            "onsubmit=\"return confirm('Forget all saved Wi-Fi and reboot to defaults?')\">"
            "<button type='submit' class='danger'>Forget all Wi-Fi</button></form>"
            "<p class='hint'>Same as holding the gate button (GPIO 4) for 10 seconds. "
            "Defaults come back as <code>SmartGate-Gate1</code> / <code>smartgate123</code>.</p></div>");

  sendPortalPage(html, "Smart Gate - Wi-Fi setup");
}

void handlePortalSave() { // hotspot (SoftAP) settings
  String ssid = webServer.arg("ssid");
  String pass = webServer.arg("pass");
  ssid.trim();

  if (ssid.length() == 0 || ssid.length() > 32) {
    sendPortalPage("<div class='notice err'>Hotspot name must be 1&ndash;32 characters.</div>"
                   "<p><a class='link' href='/'>&larr; Back to setup</a></p>",
                   "Invalid hotspot name", 400);
    return;
  }
  if (pass.length() > 0 && pass.length() < 8) {
    sendPortalPage("<div class='notice err'>Hotspot password needs 8+ characters "
                   "(or leave it blank to keep the current one).</div>"
                   "<p><a class='link' href='/'>&larr; Back to setup</a></p>",
                   "Password too short", 400);
    return;
  }

  Preferences prefs;
  prefs.begin("smartgate", false);
  prefs.putString("ssid", ssid);
  if (pass.length() >= 8) prefs.putString("pass", pass);
  prefs.end();

  Serial.print("[ESP32] Hotspot settings saved, rebooting with SSID: ");
  Serial.println(ssid);

  String body = "<div class='notice'>Hotspot saved as <b>" + escHtml(ssid) +
                "</b>. The gate is rebooting &mdash; reconnect to the hotspot and open "
                "<code>http://192.168.4.1/</code> again.</div>";
  sendPortalPage(body, "Saved");
  delay(1200);
  ESP.restart();
}

void handlePortalSaveWifi() { // upstream (STA) network
  String ssid = webServer.arg("ssid");
  String pass = webServer.arg("pass");
  String picked = webServer.arg("net");
  ssid.trim();

  if (ssid.length() == 0) ssid = picked; // dropdown selection
  ssid.trim();

  if (ssid.length() == 0 || ssid.length() > 32) {
    sendPortalPage("<div class='notice err'>Pick a network or type its name (1&ndash;32 characters).</div>"
                   "<p><a class='link' href='/'>&larr; Back to setup</a></p>",
                   "Network name missing", 400);
    return;
  }
  if (pass.length() > 0 && pass.length() < 8) {
    sendPortalPage("<div class='notice err'>Wi-Fi passwords are at least 8 characters. "
                   "Check it and try again.</div>"
                   "<p><a class='link' href='/'>&larr; Back to setup</a></p>",
                   "Password too short", 400);
    return;
  }
  if (pass.length() > 63) {
    sendPortalPage("<div class='notice err'>Password is too long (max 63 characters).</div>"
                   "<p><a class='link' href='/'>&larr; Back to setup</a></p>",
                   "Password too long", 400);
    return;
  }

  Preferences prefs;
  prefs.begin("smartgate", false);
  prefs.putString("sta_ssid", ssid);
  prefs.putString("sta_pass", pass);
  prefs.end();

  Serial.print("[ESP32] Upstream Wi-Fi saved: ");
  Serial.println(ssid);

  String body = "<div class='notice'>Saved <b>" + escHtml(ssid) +
                "</b>. The gate is rebooting and joining it now &mdash; the hotspot "
                "<code>" + escHtml(apSsid) + "</code> stays online, so you can stay "
                "connected to it and open <code>http://192.168.4.1/</code> to check the result.</div>";
  sendPortalPage(body, "Network saved");
  delay(1200);
  ESP.restart();
}

void handlePortalReset() {
  Preferences prefs;
  prefs.begin("smartgate", false);
  prefs.clear();
  prefs.end();
  Serial.println("[ESP32] Portal reset: all Wi-Fi credentials cleared");

  sendPortalPage("<div class='notice'>All Wi-Fi settings cleared. The gate is rebooting "
                 "with defaults: hotspot <code>SmartGate-Gate1</code> / "
                 "<code>smartgate123</code>.</div>",
                 "Reset");
  delay(1200);
  ESP.restart();
}

// ─── LED Status ─────────────────────────────────────────────

void updateStatusLED() {
  if (wifiResetHeld) { // fast blink while the Wi-Fi reset button is held
    digitalWrite(LED_PIN, (millis() / 100) % 2 == 0 ? HIGH : LOW);
    return;
  }
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
