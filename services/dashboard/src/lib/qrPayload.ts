/**
 * School-ID QR payload — must stay in sync with the kiosk parser in
 * `services/kiosk/src/lib/qr.ts` (`QR_PREFIX`, `SG1:`).
 */
export const QR_PREFIX = "SG1:";

export function encodeStudentQr(studentId: string): string {
  return `${QR_PREFIX}${studentId.trim()}`;
}
