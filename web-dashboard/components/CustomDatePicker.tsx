"use client";

import React from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

interface CustomDatePickerProps {
  selected: Date | null;
  onChange: (date: Date | null) => void;
  placeholder?: string;
  disabled?: boolean;
  showTimeSelect?: boolean;
  timeCaption?: string;
  dateFormat?: string;
}

export default function CustomDatePicker({
  selected,
  onChange,
  placeholder = "Select date",
  disabled = false,
  showTimeSelect = false,
  timeCaption = "Time",
  dateFormat = showTimeSelect ? "dd/MM/yyyy HH:mm" : "dd/MM/yyyy",
}: CustomDatePickerProps) {
  return (
    <DatePicker
      selected={selected}
      onChange={onChange}
      placeholderText={placeholder}
      disabled={disabled}
      showTimeSelect={showTimeSelect}
      timeCaption={timeCaption}
      dateFormat={dateFormat}
      className="custom-date-picker-input cursor-pointer"
      wrapperClassName="custom-date-picker-wrapper"
      onKeyDown={(e) => e.preventDefault()}
    />
  );
}

