"use client";

import React, { useMemo } from "react";
import Select, { MultiValue, SingleValue, ActionMeta } from "react-select";
import { useTheme } from "./ThemeProvider";

interface Option {
  label: string;
  value: string;
}

interface CustomSelectProps {
  options: Option[];
  value: Option | null;
  onChange: (option: Option | null) => void;
  placeholder?: string;
  disabled?: boolean;
  isClearable?: boolean;
  isSearchable?: boolean;
  isMulti?: boolean;
}

const lightStyles = {
  control: (base: any) => ({
    ...base,
    background: "#ffffff",
    border: "1.5px solid #c8d5e8",
    borderRadius: "10px",
    padding: "0.25rem 0",
    fontSize: "0.9375rem",
    minHeight: "auto",
    cursor: "pointer",
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
    boxShadow: "none",
    "&:hover": {
      borderColor: "#9eb0c8",
    },
  }),
  input: (base: any) => ({
    ...base,
    color: "#1e293b",
    fontSize: "0.9375rem",
  }),
  placeholder: (base: any) => ({
    ...base,
    color: "#9baec4",
    fontSize: "0.9375rem",
  }),
  menu: (base: any) => ({
    ...base,
    background: "#ffffff",
    border: "1px solid #d1d9e6",
    borderRadius: "12px",
    boxShadow: "0 4px 16px rgba(15, 23, 42, 0.15)",
    marginTop: "0.5rem",
    zIndex: 50,
  }),
  menuList: (base: any) => ({
    ...base,
    padding: "0.5rem",
    borderRadius: "8px",
  }),
  option: (base: any, state: any) => ({
    ...base,
    background: state.isSelected
      ? "#1d4ed8"
      : state.isFocused
        ? "#edf0f7"
        : "#ffffff",
    color: state.isSelected ? "#ffffff" : "#1e293b",
    borderRadius: "8px",
    padding: "0.625rem 0.75rem",
    cursor: "pointer",
    fontSize: "0.9375rem",
    margin: "0.25rem 0",
    transition: "all 0.15s ease",
    fontWeight: state.isSelected ? "600" : "400",
    "&:active": {
      background: state.isSelected ? "#1e40af" : "#e2e8f0",
    },
  }),
  singleValue: (base: any) => ({
    ...base,
    color: "#1e293b",
    fontSize: "0.9375rem",
  }),
  multiValue: (base: any) => ({
    ...base,
    background: "#eef2ff",
    borderRadius: "6px",
  }),
  multiValueLabel: (base: any) => ({
    ...base,
    color: "#1d4ed8",
    fontSize: "0.875rem",
  }),
  multiValueRemove: (base: any) => ({
    ...base,
    color: "#1d4ed8",
    "&:hover": {
      background: "#fee2e2",
      color: "#ef4444",
      borderRadius: "0 6px 6px 0",
    },
  }),
  valueContainer: (base: any) => ({
    ...base,
    padding: "0.5rem 0.75rem",
  }),
  indicatorsContainer: (base: any) => ({
    ...base,
    padding: "0.25rem 0.75rem",
  }),
  indicatorSeparator: (base: any) => ({
    ...base,
    backgroundColor: "#d1d9e6",
    margin: "0.5rem 0",
  }),
  dropdownIndicator: (base: any) => ({
    ...base,
    color: "#5a6a85",
    padding: "0.5rem",
    transition: "color 0.15s ease",
    "&:hover": {
      color: "#1d4ed8",
    },
  }),
  clearIndicator: (base: any) => ({
    ...base,
    color: "#5a6a85",
    padding: "0.5rem",
    transition: "color 0.15s ease",
    "&:hover": {
      color: "#ef4444",
      background: "#fee2e2",
      borderRadius: "6px",
    },
  }),
};

const darkStyles = {
  control: (base: any) => ({
    ...base,
    background: "#0f172a",
    border: "1.5px solid #475569",
    borderRadius: "10px",
    padding: "0.25rem 0",
    fontSize: "0.9375rem",
    minHeight: "auto",
    cursor: "pointer",
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
    boxShadow: "none",
    "&:hover": {
      borderColor: "#64748b",
    },
  }),
  input: (base: any) => ({
    ...base,
    color: "#e2e8f0",
    fontSize: "0.9375rem",
  }),
  placeholder: (base: any) => ({
    ...base,
    color: "#64748b",
    fontSize: "0.9375rem",
  }),
  menu: (base: any) => ({
    ...base,
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "12px",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
    marginTop: "0.5rem",
    zIndex: 50,
  }),
  menuList: (base: any) => ({
    ...base,
    padding: "0.5rem",
    borderRadius: "8px",
  }),
  option: (base: any, state: any) => ({
    ...base,
    background: state.isSelected
      ? "#3b82f6"
      : state.isFocused
        ? "#334155"
        : "#1e293b",
    color: state.isSelected ? "#ffffff" : "#e2e8f0",
    borderRadius: "8px",
    padding: "0.625rem 0.75rem",
    cursor: "pointer",
    fontSize: "0.9375rem",
    margin: "0.25rem 0",
    transition: "all 0.15s ease",
    fontWeight: state.isSelected ? "600" : "400",
    "&:active": {
      background: state.isSelected ? "#2563eb" : "#475569",
    },
  }),
  singleValue: (base: any) => ({
    ...base,
    color: "#e2e8f0",
    fontSize: "0.9375rem",
  }),
  multiValue: (base: any) => ({
    ...base,
    background: "#1e3a5f",
    borderRadius: "6px",
  }),
  multiValueLabel: (base: any) => ({
    ...base,
    color: "#93c5fd",
    fontSize: "0.875rem",
  }),
  multiValueRemove: (base: any) => ({
    ...base,
    color: "#93c5fd",
    "&:hover": {
      background: "#7f1d1d",
      color: "#fca5a5",
      borderRadius: "0 6px 6px 0",
    },
  }),
  valueContainer: (base: any) => ({
    ...base,
    padding: "0.5rem 0.75rem",
  }),
  indicatorsContainer: (base: any) => ({
    ...base,
    padding: "0.25rem 0.75rem",
  }),
  indicatorSeparator: (base: any) => ({
    ...base,
    backgroundColor: "#475569",
    margin: "0.5rem 0",
  }),
  dropdownIndicator: (base: any) => ({
    ...base,
    color: "#94a3b8",
    padding: "0.5rem",
    transition: "color 0.15s ease",
    "&:hover": {
      color: "#60a5fa",
    },
  }),
  clearIndicator: (base: any) => ({
    ...base,
    color: "#94a3b8",
    padding: "0.5rem",
    transition: "color 0.15s ease",
    "&:hover": {
      color: "#fca5a5",
      background: "rgba(127, 29, 29, 0.3)",
      borderRadius: "6px",
    },
  }),
};

export default function CustomSelect({
  options,
  value,
  onChange,
  placeholder = "Select option...",
  disabled = false,
  isClearable = false,
  isSearchable = true,
  isMulti = false,
}: CustomSelectProps) {
  const { theme } = useTheme();
  const styles = theme === "dark" ? darkStyles : lightStyles;

  const handleChange = (
    newValue: MultiValue<Option> | SingleValue<Option>,
    actionMeta: ActionMeta<Option>
  ) => {
    if (isMulti) {
      onChange(newValue as Option | null);
    } else {
      onChange((newValue as SingleValue<Option>) || null);
    }
  };

  return (
    <Select
      options={options}
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      isDisabled={disabled}
      isClearable={isClearable}
      isSearchable={isSearchable}
      isMulti={isMulti}
      styles={styles}
      classNamePrefix="react-select"
      unstyled={false}
    />
  );
}