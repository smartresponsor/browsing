export function classifyChallengeText(text) {
  const normalized = String(text || '');
  // A failed reCAPTCHA loader is not proof of an active verification widget.
  const loaderError = /could not connect to the recaptcha service\.\s*please check your internet connection and reload to get a recaptcha challenge\.?/gi;
  const remaining = normalized.replace(loaderError, ' ');
  const recaptchaServiceUnavailable = remaining !== normalized;

  if (/captcha|verify you are human|bot detection|i'm not a robot|not a robot/i.test(remaining)) {
    return {
      type: 'captcha',
      requestedAction: 'Complete the human-verification challenge manually in the bound browser target.'
    };
  }

  if (/(?:enter|provide|type|verify with|use your|we sent|sent you|check your)[\s\S]{0,120}(?:2fa|two-factor|two factor|authentication code|authenticator code|verification code|one-time code|one time code)|(?:2fa|two-factor|two factor)[\s\S]{0,80}(?:code|verification|authentication)/i.test(normalized)) {
    return {
      type: 'two_factor',
      requestedAction: 'Complete the second-factor verification manually in the bound browser target.'
    };
  }

  // Only treat a standalone security alert as a blocking challenge. Ordinary
  // application/help text may discuss security without requesting user action.
  const strongSecurityChallenge = /(?:^|\n)\s*(?:(?:security (?:check|challenge)|access denied|verify (?:your )?identity|complete (?:the )?challenge|challenge (?:required|verification))\s*(?::|[.!?]|$)|(?:unusual|suspicious) activity(?: detected| has been detected|\s*[:.!?])(?:\s|$))/im;
  if (strongSecurityChallenge.test(normalized)) {
    return {
      type: 'security_challenge',
      requestedAction: 'Resolve the security challenge manually in the bound browser target.'
    };
  }

  if (recaptchaServiceUnavailable) {
    return {
      type: 'captcha_service_unavailable',
      requestedAction: 'The reCAPTCHA service could not load. Check connectivity before attempting a form submission.'
    };
  }

  return null;
}

export function canInspectCaptchaServiceError({ boundary, hasVisibleChallengeWidget = false, readOnlyDomCapture = false } = {}) {
  return readOnlyDomCapture === true && boundary?.type === 'captcha_service_unavailable' && hasVisibleChallengeWidget === false;
}

// A provider redirect is not a credential operation. It may be initiated only
// through an exact, user-approved, text-labelled provider entry point; never
// through arbitrary selectors, nth matches, passwords or submit controls.
export function isSafeGoogleSsoTrigger({ text = '', selector = '', nth = 0 } = {}) {
  return !String(selector || '').trim() && nth === 0
    && /^(?:continue|sign\s?in|log\s?in|register|create account) (?:with|using) google$/i.test(String(text || '').trim());
}

export function classifyHumanBoundary({
  text,
  url = '',
  hasPasswordField = false,
  hasCredentialIdentifierField = false,
  consentText = '',
  alertDialogText = '',
  unsupportedControl = null,
} = {}) {
  const challenge = classifyChallengeText(text);
  // A broken CAPTCHA service does not mask a distinct login/consent/modal boundary.
  if (challenge && challenge.type !== 'captcha_service_unavailable') {
    return challenge;
  }

  const normalizedConsent = String(consentText || '');
  const consentContext = /\b(cookies?|privacy preferences?|tracking consent|consent preferences?)\b/i.test(normalizedConsent);
  const consentAction = /\b(accept|agree|allow|reject|manage preferences?|save preferences?)\b/i.test(normalizedConsent);
  if (consentContext && consentAction) {
    return {
      type: 'consent_required',
      requestedAction: 'Review and resolve the privacy/cookie consent choice manually in the bound browser target.'
    };
  }

  const normalizedText = String(text || '');
  const normalizedUrl = String(url || '');
  const loginText = /\b(sign[ -]?in|log[ -]?in|login|password)\b/i.test(normalizedText);
  const loginUrl = /\/(?:login|log-in|signin|sign-in|auth)(?:[/?#]|$)/i.test(normalizedUrl);

  if ((hasPasswordField && (loginText || loginUrl)) || (loginUrl && hasCredentialIdentifierField)) {
    return {
      type: 'login_required',
      requestedAction: 'Complete login manually in the bound browser target. Web will not read or enter credentials.'
    };
  }

  if (String(alertDialogText || '').trim()) {
    return {
      type: 'unexpected_modal',
      requestedAction: 'Review and resolve the blocking alert dialog manually before Web continues.'
    };
  }

  if (unsupportedControl && typeof unsupportedControl === 'object') {
    return {
      type: 'unsupported_control',
      requestedAction: 'Complete or resolve the unsupported control manually, then re-inspect the form before Web resumes.'
    };
  }

  return challenge || null;
}
