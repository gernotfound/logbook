import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMailjetAuthSender, MailjetSendError } from '../../cloudflare/api/mailjet-auth-email.mjs';

const settings = {
  apiKey: 'synthetic-public-key',
  secretKey: 'synthetic-private-key',
  fromEmail: 'test@example.invalid',
};
const request = {
  to: 'user@example.invalid',
  subject: 'Confirm your account',
  text: 'Verification: https://example.invalid/verify?token=synthetic',
};
const success = {
  Messages: [{ Status: 'success', To: [{ Email: request.to, MessageID: 123 }] }],
};

function senderFor({ status = 200, result = success, error = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (error) throw error;
    return new Response(JSON.stringify(result), { status });
  };
  return { sender: createMailjetAuthSender({ ...settings, fetchImpl }), calls };
}

void test('Mailjet sends one text-only auth message without open/click tracking', async () => {
  const { sender, calls } = senderFor();
  assert.deepEqual(await sender(request), { kind: 'provider-accepted' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.mailjet.com/v3.1/send');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization,
    'Basic ' + btoa('synthetic-public-key:synthetic-private-key'));
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.Messages.length, 1);
  assert.deepEqual(body.Messages[0], {
    From: { Email: settings.fromEmail, Name: 'TheLogBook' },
    To: [{ Email: request.to }],
    Subject: request.subject,
    TextPart: request.text,
    TrackOpens: 'disabled',
    TrackClicks: 'disabled',
  });
  assert.equal('HTMLPart' in body.Messages[0], false);
});

void test('configuration and invalid messages fail before making any request', async () => {
  for (const config of [
    { ...settings, apiKey: '' },
    { ...settings, secretKey: '' },
    { ...settings, apiKey: 'a:b' },
    { ...settings, fromEmail: 'invalid' },
  ]) {
    assert.throws(() => createMailjetAuthSender(config),
      error => error instanceof MailjetSendError && error.code === 'configuration');
  }
  const { sender, calls } = senderFor();
  for (const message of [
    { ...request, to: 'not-an-email' },
    { ...request, subject: 'A\r\nB' },
    { ...request, text: '' },
    { ...request, text: 'x'.repeat(10001) },
  ]) {
    await assert.rejects(sender(message),
      error => error instanceof MailjetSendError && error.code === 'invalid-message');
  }
  assert.equal(calls.length, 0);
});

void test('rejected, rate-limited, uncertain and malformed responses never return acceptance', async () => {
  const cases = [
    { response: { status: 400 }, expected: 'rejected' },
    { response: { status: 401 }, expected: 'rejected' },
    { response: { status: 429 }, expected: 'rate-limited' },
    { response: { status: 503 }, expected: 'outcome-unknown' },
    { response: { status: 200, result: { Messages: [{ Status: 'error', Errors: [] }] } }, expected: 'outcome-unknown' },
    { response: { status: 200, result: { Messages: [] } }, expected: 'outcome-unknown' },
    { response: { status: 200, result: { Messages: [{ Status: 'success', To: [] }] } }, expected: 'outcome-unknown' },
    { response: { error: new Error('synthetic network failure') }, expected: 'outcome-unknown' },
  ];
  for (const { response, expected } of cases) {
    const { sender, calls } = senderFor(response);
    await assert.rejects(sender(request),
      error => error instanceof MailjetSendError && error.code === expected);
    assert.equal(calls.length, 1);
  }
});

void test('an invalid 2xx JSON body is an uncertain result, not a successful delivery', async () => {
  const sender = createMailjetAuthSender({
    ...settings,
    fetchImpl: async () => new Response('not json', { status: 200 }),
  });
  await assert.rejects(sender(request),
    error => error instanceof MailjetSendError && error.code === 'outcome-unknown');
});
