import { type ReactNode } from "react";

export function SectionCard(props: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="studio-card">
      <div className="studio-card-head">
        <div>
          <h2>{props.title}</h2>
          {props.subtitle ? <p>{props.subtitle}</p> : null}
        </div>
        {props.right ? <div>{props.right}</div> : null}
      </div>
      <div className="studio-card-body">{props.children}</div>
    </section>
  );
}

export function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="studio-field">
      <div className="studio-field-label">{props.label}</div>
      {props.children}
      {props.hint ? <div className="studio-field-hint">{props.hint}</div> : null}
    </label>
  );
}

export function Toast(props: { message: string; onClose: () => void }) {
  return (
    <div className="studio-toast" role="status" aria-live="polite">
      <span>{props.message}</span>
      <button className="btn" onClick={props.onClose}>
        Dismiss
      </button>
    </div>
  );
}
