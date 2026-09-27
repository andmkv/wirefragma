import { useEffect } from "react";
import { useT } from "../i18n";

interface PrivacyPolicyProps {
  operator: string;
  contactEmail: string;
  version: string;
  onClose: () => void;
}

/** The short, plain-language privacy policy accepted at sign-up (shown in the UI language). */
export function PrivacyPolicy({ operator, contactEmail, version, onClose }: PrivacyPolicyProps) {
  const t = useT();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const contactMarker = "\u0000contact\u0000";
  const [rightsBefore, rightsAfter] = t("privacy.rights", { contact: contactMarker }).split(contactMarker);
  const contact = contactEmail ? <a href={`mailto:${contactEmail}`}>{contactEmail}</a> : t("privacy.operatorFallback");

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal privacy-modal" role="dialog" aria-modal="true" aria-label={t("privacy.title")}>
        <div className="modal-header">
          <h2>{t("privacy.title")}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </div>
        <div className="privacy-body">
          <p className="privacy-meta">{t("privacy.meta", { version, operator })}</p>
          <p>{t("privacy.intro")}</p>

          <h3>{t("privacy.storeTitle")}</h3>
          <ul>
            <li>
              <strong>{t("privacy.storeAccountLabel")}</strong> {t("privacy.storeAccount")}
            </li>
            <li>
              <strong>{t("privacy.storeWorkLabel")}</strong> {t("privacy.storeWork")}
            </li>
            <li>
              <strong>{t("privacy.storeTechLabel")}</strong> {t("privacy.storeTech")}
            </li>
          </ul>

          <h3>{t("privacy.useTitle")}</h3>
          <p>{t("privacy.use")}</p>

          <h3>{t("privacy.whereTitle")}</h3>
          <p>{t("privacy.where")}</p>

          <h3>{t("privacy.rightsTitle")}</h3>
          <p>
            {rightsBefore}
            {contact}
            {rightsAfter}
          </p>

          <h3>{t("privacy.changesTitle")}</h3>
          <p>{t("privacy.changes")}</p>
        </div>
        <div className="modal-footer">
          <div className="modal-actions">
            <button type="button" className="primary" onClick={onClose}>
              {t("common.close")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
