const GATES = Object.freeze({
  backend: 'AUTH_CUSTOMER_ENABLED',
  preview: 'AUTH_CUSTOMER_PREVIEW_ENABLED',
  publicLinks: 'AUTH_CUSTOMER_PUBLIC_LINKS_ENABLED',
});

function parseGate(env, variableName) {
  const value = env?.[variableName];
  if (value === undefined || value === null || value === '') {
    return {requested: false, issue: null};
  }
  if (value === 'false') {
    return {requested: false, issue: null};
  }
  if (value === 'true') {
    return {requested: true, issue: null};
  }
  return {
    requested: false,
    issue: {
      variable: variableName,
      code: 'invalid_boolean',
    },
  };
}

export function getCustomerAuthConfig(env = {}) {
  const backend = parseGate(env, GATES.backend);
  const preview = parseGate(env, GATES.preview);
  const publicLinks = parseGate(env, GATES.publicLinks);
  const issues = [backend.issue, preview.issue, publicLinks.issue].filter(Boolean);

  return {
    requested: {
      backend: backend.requested,
      preview: preview.requested,
      publicLinks: publicLinks.requested,
    },
    issues,
  };
}

export const customerAuthGateNames = GATES;
