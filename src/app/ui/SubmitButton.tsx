"use client";

import { useFormStatus } from "react-dom";
import { button } from "./styles";

export default function SubmitButton({
  children,
  pending = "Saving…",
  className = button,
  name,
  value,
  confirm,
}: {
  children: React.ReactNode;
  pending?: string;
  className?: string;
  name?: string;
  value?: string;
  confirm?: string;
}) {
  const status = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={status.pending}
      className={className}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {status.pending ? pending : children}
    </button>
  );
}
