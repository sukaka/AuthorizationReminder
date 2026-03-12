const buildHelmetCspDirectives = ({ withNonce = false } = {}) => {
  const scriptSrc = withNonce
    ? ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`]
    : ["'self'"];

  return {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    frameAncestors: ["'self'"],
    objectSrc: ["'none'"],
    scriptSrc,
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:'],
    fontSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"],
    // Public HTTP deployments in this repo expose raw ports directly.
    // Enabling upgrade-insecure-requests forces same-origin fetches to https://host:port,
    // which breaks on ports without TLS.
    upgradeInsecureRequests: null,
  };
};

module.exports = {
  buildHelmetCspDirectives,
};
