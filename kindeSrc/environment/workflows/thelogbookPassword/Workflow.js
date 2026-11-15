// Candidate Kinde workflow; a GitHub merge does not enable it on the provider.
export const workflowSettings = {
  id: 'thelogbook-minimum-password-15',
  name: 'TheLogBook password: minimum 15 code points',
  trigger: 'user:new_password_provided',
  failurePolicy: { action: 'stop' },
  bindings: { 'kinde.widget': {} },
};

export default async function Workflow(event) {
  const password = event?.context?.auth?.firstPassword;
  if (typeof password !== 'string') {
    // The provider must stop when the event shape is missing or unsupported.
    throw new Error('password-policy-input-unavailable');
  }
  if (Array.from(password).length < 15) {
    // Kinde runs this trigger for both first-time signup and password reset.
    globalThis.kinde.widget.invalidateFormField(
      'p_first_password', 'La password deve contenere almeno 15 caratteri.',
    );
  }
}
