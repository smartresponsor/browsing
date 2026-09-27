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

