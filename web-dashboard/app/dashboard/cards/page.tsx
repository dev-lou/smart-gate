"use client";

import { useEffect, useState, useCallback } from "react";
import { GuestCard } from "@/types";
import CardForm from "@/components/CardForm";

export default function CardsPage() {
  const [cards, setCards] = useState<GuestCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [formLoading, setFormLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);

  const fetchCards = useCallback(async () => {
    try {
      const res = await fetch("/api/cards");
      const data = await res.json();
      setCards(data.cards || []);
    } catch (err) {
      console.error("Failed to fetch cards:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

  const handleSubmit = async (formData: {
    card_uid: string;
    holder_name: string;
    purpose: string;
    valid_until: string;
  }) => {
    setFormLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await res.json();

      if (res.ok) {
        setMessage({ type: "success", text: "Guest card added!" });
        setShowForm(false);
        fetchCards();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to add card" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error" });
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm("Deactivate this guest card?")) return;
    try {
      const res = await fetch(`/api/cards?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setMessage({ type: "success", text: "Card deactivated" });
        fetchCards();
      }
    } catch {
      setMessage({ type: "error", text: "Failed to deactivate card" });
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "No expiry";
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">
            Guest Cards
          </h1>
          <p className="text-surface-500 dark:text-surface-400 text-sm mt-1">
            Manage RFID guest access cards
          </p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          {showForm ? "Close" : "Add Card"}
        </button>
      </div>

      {/* Messages */}
      {message && (
        <div
          className={`p-4 rounded-xl animate-slide-up ${
            message.type === "success"
              ? "bg-success-50 dark:bg-success-950/40 border border-success-200 dark:border-success-800 text-success-700 dark:text-success-300"
              : "bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="glass-card p-6 animate-slide-up">
          <h2 className="text-lg font-semibold mb-5">Add New Guest Card</h2>
          <CardForm
            onSubmit={handleSubmit}
            loading={formLoading}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {/* Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-primary-200 dark:border-primary-800 border-t-primary-600 dark:border-t-primary-400 rounded-full animate-spin" />
          </div>
        ) : cards.length === 0 ? (
          <div className="col-span-full text-center py-16">
            <svg className="w-16 h-16 mx-auto text-surface-400 dark:text-surface-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0" />
            </svg>
            <p className="text-surface-500 dark:text-surface-400 text-lg">No guest cards registered</p>
          </div>
        ) : (
          cards.map((card) => (
            <div
              key={card.id}
              className="glass-card glass-card-hover p-5 space-y-3"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-surface-900 dark:text-white">{card.holder_name}</h3>
                  <p className="text-surface-500 dark:text-surface-400 text-sm font-mono mt-1">
                    UID: {card.card_uid}
                  </p>
                </div>
                <span className={`badge ${card.is_active ? "badge-success" : "badge-danger"}`}>
                  {card.is_active ? "Active" : "Inactive"}
                </span>
              </div>

              {card.purpose && (
                <p className="text-surface-500 dark:text-surface-400 text-sm">
                  {card.purpose}
                </p>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-surface-200 dark:border-surface-700">
                <span className="text-surface-500 dark:text-surface-400 text-xs">
                  Valid until: {formatDate(card.valid_until)}
                </span>
                {card.is_active && (
                  <button
                    onClick={() => handleDeactivate(card.id)}
                    className="btn-danger text-xs py-1.5 px-3"
                  >
                    Deactivate
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
