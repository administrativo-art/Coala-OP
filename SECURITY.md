# Security policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting flow in this repository: open the **Security** tab, choose **Advisories**, and select **Report a vulnerability**.

Do not disclose a suspected vulnerability in a public issue, pull request, discussion, or commit. Do not include production credentials, access tokens, cookies, personal data, banking data, HR information, or complete production payloads in a report. If evidence may contain sensitive material, describe its type and location without copying the value.

Include, when safely available:

- the affected component and release or commit;
- reproducible steps using synthetic data;
- the observed and expected behavior;
- the likely impact and required privileges;
- a minimal, sanitized proof of concept;
- suggested mitigations, if known.

Submitting a report does not authorize testing against production, access to other users' data, denial-of-service testing, social engineering, or persistence. Stop testing if you encounter real user data or credentials.

The maintainers will validate the evidence privately, distinguish confirmed cause from hypothesis, and coordinate remediation and disclosure. Response times depend on severity and operational coverage; this policy does not establish a public bug-bounty program or a guaranteed reward.

## Supported code

Security reports should target the current protected `main` branch or the release currently promoted through the protected `production` branch. Historical code that is no longer deployed may be recorded as backlog unless it demonstrates current exposure.
