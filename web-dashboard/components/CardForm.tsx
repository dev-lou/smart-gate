"use client";

import { useState } from "react";
import CustomDatePicker from "./CustomDatePicker";

interface CardFormProps {
  onSubmit: (data: { card_uid: string; holder_name: string; purpose: string; valid_until: string }) => Promise<void>;
  initialData?: { card_uid?: string; holder_name?: string; purpose?: string; valid_until?: string };
  loading?: boolean;
  onCancel?: () => void;
}

export default function CardForm({ onSubmit, initialData, loading = false, onCancel }: CardFormProps) {
  const [cardUid, setCardUid] = useState(initialData?.card_uid || "");
  const [holderName, setHolderName] = useState(initialData?.holder_name || "");
  const [purpose, setPurpose] = useState(initialData?.purpose || "");
  const [validUntil, setValidUntil] = useState<Date | null>(
    initialData?.valid_until ? new Date(initialData.valid_until) : null
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      card_uid: cardUid,
      holder_name: holderName,
      purpose,
      valid_until: validUntil ? validUntil.toISOString().slice(0, 16) : "",
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <label htmlFor="card-uid" className="input-label">Card UID *</label>
          <input
            id="card-uid"
            className="input-field"
            placeholder="e.g., A1B2C3D4"
            value={cardUid}
            onChange={(e) => setCardUid(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="card-holder" className="input-label">Holder Name *</label>
          <input
            id="card-holder"
            className="input-field"
            placeholder="Guest full name"
            value={holderName}
            onChange={(e) => setHolderName(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="card-purpose" className="input-label">Purpose</label>
          <input
            id="card-purpose"
            className="input-field"
            placeholder="e.g., Parent visit"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="card-valid" className="input-label">Valid Until</label>
          <CustomDatePicker
            selected={validUntil}
            onChange={setValidUntil}
            placeholder="Select date & time"
            showTimeSelect
            dateFormat="dd/MM/yyyy HH:mm"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button type="submit" disabled={loading} className="btn-primary disabled:opacity-50">
          {loading ? "Saving..." : "Add Card"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
