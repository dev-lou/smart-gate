# Chapter IV — Results and Discussion (ready-to-paste draft)

> Scope note: this chapter reports what the deployed prototype actually
> measures. Numbers that were never measured against the enrolled population
> are named as open work rather than quoted as results.

## 4.1 What Was Verified, and How

Three kinds of evidence support the claims made for this system:

1. **Unit tests** — 146 assertions over the pure logic that decides access:
   cosine matching, the confirmation gate, the re-arm state machine, gate
   message parsing, heartbeat row shaping, audio throttling, the uniform
   gate and the school-ID QR fallback. `vitest run` in `services/kiosk`
   passes 146/146 (the dashboard suite adds 15/15).
2. **Offline rehearsal** — the tablet was put in airplane mode and driven
   through a full visit: detection, recognition, decision, gate command and
   queued logging all complete with the network down. Only the sync half of the
   log write waits for connectivity.
3. **Physical cycling** — the servo arm was driven through open/close cycles
   from the kiosk, with the firmware's `S:OPEN` state report used to confirm the
   barrier actually released before the screen claims it did.

## 4.2 Face Matching Posture

Identity uses MediaPipe BlazeFace detection with ArcFace (`w600k_mbf`, 512-dim)
embeddings, compared by cosine similarity against every enrolled angle.

The deployed configuration applies three independent conditions before a match
may become a decision:

| Condition | Value | Purpose |
|-----------|-------|---------|
| Similarity floor | **0.70** | The winning template must clear the floor |
| Confirmation | **5 consecutive reads** (≈2.5 s) | A single motion-blurred frame can never grant |
| Margin over runner-up | **0.08** | Two lookalikes (0.71 vs 0.70) stay undecided |

The floor was raised from 0.65 after field observation showed strangers
matching enrolled students on isolated blurred frames. Below every condition
the outcome is an unknown face — never a wrong name.

**What is not claimed.** The 99.4% figure often quoted for ArcFace is the
model's published LFW benchmark, not this system's measured false-accept rate.
No target-FMR sweep has been run against the enrolled population, so this
prototype cannot state a false-accept rate for the school's own students.

The uniform check is a separate gate, not part of the face score. A torso
crop is judged zero-shot by CLIP against the grey-uniform prompt and grants
only at P(uniform) ≥ 0.60 with a 0.20 margin over plain-clothes prompts;
otherwise the decision is NO_UNIFORM / WRONG_UNIFORM. The school-ID QR path
skips the face step but never the uniform step.

## 4.3 Decision Integrity

Early field use produced one student with 140 access rows from a single stay:
recognition kept running after the verdict and re-decided whoever remained in
frame. The fix is a small, fully unit-tested state machine:

- the scanner re-arms only after the gate area has been **empty for 1.5 s**;
- a repeat decision inside **60 s** is displayed but writes no second row;
- a low similarity reading counts as "unrecognised" only after it persists for
  **2.5 s**, because a walking-up frame measurably reads low (≈0.26 before
  settling near 0.63);
- one person therefore produces exactly one row per visit.

Gate reporting was corrected in the same spirit. A command sent with no
controller linked is not an open barrier, so the kiosk reports one of three
states — **OPEN** (controller confirmed), **AWAITING** (linked, not yet
confirmed), **SENT** (no controller, demo mode) — and logs `open`,
`unconfirmed` or `simulated` accordingly.

## 4.4 Policy Layer

Access is decided by face match *plus* a policy that can change without
releasing new code:

| Outcome | Reason code | Behaviour |
|---------|-------------|-----------|
| Student match | `POLICY_PASS` | Granted |
| Guest within validity | `GUEST_PASS_VALID` | Granted |
| Guest past `valid_until` | `GUEST_EXPIRED` | Denied, guard told to renew |
| Campus lockdown | `LOCKDOWN_ACTIVE` | Denied for everyone; guard override remains |

Each row stores `reason_code` and a human-readable `decision_note`, so a denial
can be explained to the person at the gate and audited later.

## 4.5 Deployment Fidelity

The kiosk runs the same recognition path in the browser as the desktop
reference: 112×112 crop, `(pixel − 127.5) / 127.5` normalisation, L2-normalised
embedding, cosine comparison. The heavy model runs in a shared Web Worker, so
frame delivery is not blocked by inference.

## 4.6 Limitations of This Evaluation

- No false-accept/false-reject rate measured on the enrolled population.
- No presentation-attack (photo/screen replay) testing.
- Throughput at a real morning rush was not measured; the prototype was tested
  with small cohorts.
- Fairness across skin tones and lighting conditions was not evaluated.
- One gate, one kiosk. Multi-gate coordination is untested.

The remedy for each is the recommendation set: recognise several students per
frame (per-person identity plus uniform), add liveness before claiming
security, add a tailgating alarm, and evaluate fairness across skin tones and
lighting before wider deployment.
