import { useEffect } from "react";

interface PrivacyPolicyProps {
  operator: string;
  contactEmail: string;
  version: string;
  onClose: () => void;
}

/** The short, plain-language privacy policy accepted at sign-up. */
export function PrivacyPolicy({ operator, contactEmail, version, onClose }: PrivacyPolicyProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const contact = contactEmail ? <a href={`mailto:${contactEmail}`}>{contactEmail}</a> : "the site operator";

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal privacy-modal" role="dialog" aria-modal="true" aria-label="Privacy policy">
        <div className="modal-header">
          <h2>Privacy policy</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="privacy-body">
          <p className="privacy-meta">
            Version {version} · Operator: {operator}
          </p>
          <p>
            Wirefragma is a wireframe editor. This policy explains what happens to your data when you
            create an account on this server. Without an account, nothing leaves your browser.
          </p>

          <h3>What we store</h3>
          <ul>
            <li>
              <strong>Account data:</strong> your email address, an optional display name, and your
              password as a one-way hash (we never see or store the password itself).
            </li>
            <li>
              <strong>Your work:</strong> the projects and wireframes you save, including element
              names, labels and LLM notes.
            </li>
            <li>
              <strong>Technical data:</strong> a session cookie that keeps you signed in, the date you
              accepted this policy, and short-lived records of request counts per IP address used only
              to stop abuse (deleted within a day).
            </li>
          </ul>

          <h3>What we use it for</h3>
          <p>
            Only to run the service: signing you in, saving and showing your wireframes, and sending
            account emails (address confirmation and password reset). No advertising, no tracking, no
            analytics, no selling or sharing of data. There are no third-party cookies; if the server
            uses Cloudflare Turnstile as its captcha, Cloudflare processes the check under its own
            privacy policy.
          </p>

          <h3>Where it lives</h3>
          <p>
            In a database on this server's hosting provider. Wireframes are not encrypted at rest, so do
            not put secrets or personal data of others into them.
          </p>

          <h3>Your rights</h3>
          <p>
            You can export any wireframe at any time (Export → Markdown / JSON), and you can delete your
            account from the account menu — this permanently removes your account, projects and
            wireframes. For any other request (access, correction, questions) contact {contact}.
          </p>

          <h3>Changes</h3>
          <p>
            When this policy changes, the version and date above change too. The version you accepted
            is recorded with your account.
          </p>
        </div>
        <div className="modal-footer">
          <div className="modal-actions">
            <button type="button" className="primary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
