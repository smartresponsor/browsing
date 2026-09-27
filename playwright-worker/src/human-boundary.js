export function classifyChallengeText(text) {
  const normalized = String(text || '');

  if (/captcha|verify you are human|bot detection|i'm not a robot|not a robot/i.test(normalized)) {
    return {
      type: 'captcha',
      requestedAction: 'Complete the human-verification challenge manually in the bound browser target.'
    };
  }

  if (/2fa|two-factor|two factor|authentication code|authenticator|verification code|one-time code|one time code/i.test(normalized)) {
    return {
      type: 'two_factor',
      requestedAction: 'Complete the second-factor verification manually in the bound browser target.'
    };
  }

  if (/security check|security challenge|unusual activity|access denied|challenge/i.test(normalized)) {
    return {
      type: 'security_challenge',
      requestedAction: 'Resolve the security challenge manually in the bound browser target.'
    };
  }

  return null;
}

export function classifyHumanBoundary({ text, url = '', hasPasswordField = false } = {}) {
  const challenge = classifyChallengeText(text);
  if (challenge) {
    return challenge;
  }

  const normalizedText = String(text || '');
  const normalizedUrl = String(url || '');
  const loginText = /\b(sign[ -]?in|log[ -]?in|login|password)\b/i.test(normalizedText);
  const loginUrl = /\/(?:login|log-in|signin|sign-in|auth)(?:[/?#]|$)/i.test(normalizedUrl);

  if (hasPasswordField && (loginText || loginUrl)) {
    return {
      type: 'login_required',
      requestedAction: 'Complete login manually in the bound browser target. Network will not read or enter credentials.'
    };
  }

  return null;
}
