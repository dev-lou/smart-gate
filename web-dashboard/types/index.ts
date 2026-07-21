/**
 * Smart School Gate System - TypeScript Type Definitions
 */

export type PersonType = "student" | "faculty" | "staff";
export type AccessDirection = "entry" | "exit";
export type AccessMethod = "face" | "qr" | "manual";

export interface Student {
  id: string;
  name: string;
  student_id: string | null;
  person_type?: PersonType;
  face_embedding: string | null; // base64 encoded
  uniform_type: string | null;
  photo_url: string | null;
  department: string | null;
  grade: string | null;
  section: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface GuestCard {
  id: string;
  card_uid: string;
  holder_name: string;
  purpose: string | null;
  is_active: boolean;
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface GuestVisit {
  id: string;
  visitor_name: string | null;
  purpose: string | null;
  host_person_id: string | null;
  host_name: string | null;
  department: string | null;
  contact_number: string | null;
  photo_url: string | null;
  qr_token_hash: string;
  status:
    | "pending_approval"
    | "inside_pending_details"
    | "inside_details_complete"
    | "completed"
    | "manual_checkout"
    | "cancelled"
    | string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  entry_gate_id: string | null;
  exit_gate_id: string | null;
  guard_in_id: string | null;
  guard_in_name: string | null;
  guard_out_id: string | null;
  guard_out_name: string | null;
  remarks: string | null;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccessLog {
  id: string;
  person_id: string | null;
  person_name: string | null;
  person_type: PersonType | "guest" | "manual" | string | null;
  guest_visit_id: string | null;
  direction: AccessDirection;
  method: AccessMethod;
  success: boolean;
  confidence: number | null;
  uniform_ok: boolean | null;
  photo_url: string | null;
  gate_id: string;
  failure_reason: string | null;
  override_operator_id: string | null;
  override_operator_name: string | null;
  override_reason: string | null;
  override_source: string | null;
  device_timestamp: string;
  synced_at: string;
  created_at: string;
}

export interface SystemSetting {
  id: string;
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

export interface SyncResponse {
  students: Student[];
  guest_cards: GuestCard[];
  guest_visits: GuestVisit[];
  settings: SystemSetting[];
  sync_time: string;
}

export interface LogPushPayload {
  logs: Array<{
    person_id: string | null;
    person_name: string | null;
    person_type?: string | null;
    guest_visit_id?: string | null;
    direction?: AccessDirection;
    method: string;
    success: boolean;
    confidence: number | null;
    uniform_ok: boolean | null;
    photo_url: string | null;
    gate_id: string;
    failure_reason: string | null;
    override_operator_id?: string | null;
    override_operator_name?: string | null;
    override_reason?: string | null;
    override_source?: string | null;
    device_timestamp: string;
  }>;
}

export interface StudentFormData {
  name: string;
  department?: string;
  grade?: string;
  section?: string;
  uniform_type?: string;
  photo?: File | null;
}

export interface CardFormData {
  card_uid: string;
  holder_name: string;
  purpose: string;
  valid_until: string;
}

export interface GuestVisitFormData {
  visitor_name: string;
  purpose: string;
  host_name: string;
  department: string;
  contact_number: string;
  valid_until: string;
  remarks: string;
}

// ISUFST Dingle Campus departments requiring uniform detection
export const DEPARTMENT_OPTIONS: string[] = [
  "BSIT",
  "CHM",
  "COAGRI",
  "Education",
];

// Uniform types match department names for YOLO11 nano training
export type UniformType = "BSIT" | "CHM" | "COAGRI" | "Education";

export const UNIFORM_OPTIONS: { value: UniformType; label: string }[] = [
  { value: "BSIT", label: "BSIT Uniform" },
  { value: "CHM", label: "CHM Uniform" },
  { value: "COAGRI", label: "COAGRI Uniform" },
  { value: "Education", label: "Education Uniform" },
];

// Department to Uniform mapping (auto-assigned for students)
export const DEPARTMENT_TO_UNIFORM: Record<string, UniformType> = {
  BSIT: "BSIT",
  CHM: "CHM",
  COAGRI: "COAGRI",
  Education: "Education",
};
