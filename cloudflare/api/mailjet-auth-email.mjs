// Trusted-only transport for Auth verification/reset messages. A Mailjet API
// acceptance is not a delivery receipt; unknown outcomes must not be retried
// blindly because Send API v3.1 has no request idempotency guarantee.
const ENDPOINT = 'https://api.mailjet.com/v3.1/send';

export class MailjetSendError extends Error {
  constructor(code) {
    super('mailjet-' + code);
    this.name = 'MailjetSendError';
    this.code = code;
  }
}

function validEmail(value) {
  return typeof value === 'string' && value.length <= 254
    && /^[^\\s@<>]+@[^\\s@<>]+\\.[^\\s@<>]+$/.test(value);
}

function validCredential(value, allowColon = false) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && /^[\\x21-\\x7e]+$/.test(value) && (allowColon || !value.includes(':'));
}

export function createMailjetAuthSender({ apiKey, secretKey, fromEmail, fetchImpl = fetch }) {
  if (!validCredential(apiKey) || !validCredential(secretKey, true)
      || !validEmail(fromEmail) || typeof fetchImpl !== 'function') {
    throw new MailjetSendError('configuration');
  }

  const authorization = 'Basic ' + btoa(apiKey + ':' + secretKey);
  return async function sendAuthEmail({ to, subject, text }) {
    if (!validEmail(to) || typeof subject !== 'string' || subject.length < 1
        || subject.length > 150 || /[\\r\\n]/.test(subject)
        || typeof text !== 'string' || text.length < 1 || text.length > 10000) {
      throw new MailjetSendError('invalid-message');
    }

    // Text-only message and explicit per-message opt-out. Account-wide Mailjet
    // tracking must also be disabled and verified on the raw received MIME.
    const body = JSON.stringify({
      Messages: [{
        From: { Email: fromEmail, Name: 'TheLogBook' },
        To: [{ Email: to }],
        Subject: subject,
        TextPart: text,
        TrackOpens: 'disabled',
        TrackClicks: 'disabled',
      }],
    });

    let response;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      // Timeout/network errors can happen after Mailjet has accepted a send.
      throw new MailjetSendError('outcome-unknown');
    }
    if (response.status === 429) throw new MailjetSendError('rate-limited');
    if (!response.ok) {
      throw new MailjetSendError(response.status >= 500 ? 'outcome-unknown' : 'rejected');
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new MailjetSendError('outcome-unknown');
    }
    const messages = result?.Messages;
    const message = Array.isArray(messages) && messages.length === 1 ? messages[0] : null;
    if (message?.Status !== 'success' || !Array.isArray(message.To)
        || message.To.length !== 1
        || message.To[0]?.Email?.toLowerCase() !== to.toLowerCase()) {
      // An HTTP 2xx with error/missing recipient does not prove acceptance.
      throw new MailjetSendError('outcome-unknown');
    }
    return { kind: 'provider-accepted' };
  };
}
