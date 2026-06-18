"use client";

import { useState } from "react";

const emptyForm = {
  name: "",
  email: "",
  phone: "",
  company: "",
  package: "AI Sales Agent",
  message: "",
  website: ""
};

export default function AuditForm() {
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState("idle");
  const [leadId, setLeadId] = useState("");
  const [error, setError] = useState("");

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submitForm(event) {
    event.preventDefault();
    setStatus("loading");
    setError("");

    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Please check the form and try again.");
      }
      window.localStorage.setItem("brothers-ad-latest-audit", JSON.stringify({ ...form, leadId: data.leadId }));
      setLeadId(data.leadId);
      setStatus("success");
      setForm(emptyForm);
    } catch (formError) {
      setError(formError.message);
      setStatus("error");
    }
  }

  return (
    <form className="audit-form" onSubmit={submitForm}>
      <div className="form-row">
        <label>
          Name
          <input name="name" value={form.name} onChange={updateField} autoComplete="name" required />
        </label>
        <label>
          Work Email
          <input name="email" type="email" value={form.email} onChange={updateField} autoComplete="email" required />
        </label>
      </div>
      <div className="form-row">
        <label>
          Phone
          <input name="phone" value={form.phone} onChange={updateField} autoComplete="tel" required />
        </label>
        <label>
          Company
          <input name="company" value={form.company} onChange={updateField} autoComplete="organization" required />
        </label>
      </div>
      <label>
        Package Interest
        <select name="package" value={form.package} onChange={updateField}>
          <option>AI Sales Agent</option>
          <option>AI Operations OS</option>
          <option>Brothers AI Starter</option>
          <option>AI Enterprise</option>
          <option>Not sure yet</option>
        </select>
      </label>
      <label>
        What do you want AI to handle first?
        <textarea name="message" value={form.message} onChange={updateField} rows={4} />
      </label>
      <input
        type="text"
        name="website"
        value={form.website}
        onChange={updateField}
        autoComplete="off"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
      />
      <button className="btn primary" type="submit" disabled={status === "loading"}>
        {status === "loading" ? "Sending..." : "Schedule AI Audit"}
      </button>
      <p className="form-note">This creates a Brothers.ad audit request and gives you a confirmation ID immediately.</p>
      {status === "success" ? (
        <p className="form-success">Request received. Confirmation ID: {leadId}. We will follow up at the contact details provided.</p>
      ) : null}
      {status === "error" ? <p className="form-error">{error}</p> : null}
    </form>
  );
}
